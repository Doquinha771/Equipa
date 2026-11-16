-- Equipa 1.0 — carrinhos confiáveis, modelos editáveis, campos personalizáveis e ajustes.
-- Migração ADITIVA: não apaga equipamentos, carrinhos, retiradas nem histórico.
-- Aplicar no Supabase → SQL Editor (ou `supabase db push`).

------------------------------------------------------------------------------
-- 1) Carrinhos
-- A função antiga chamava private.save_equipment_cart_internal, criada fora do
-- repositório. Ela falhava ao criar carrinho com número de um carrinho desativado
-- ou com equipamento que já estava em outro carrinho, sem mensagem clara.
-- Esta versão é completa e devolve erros com código:
--   EQUIPA_CART_NUMBER_INVALID / _CAPACITY_INVALID / _CODES_INVALID / _OVER_CAPACITY
--   EQUIPA_CART_UNKNOWN_CODES:<números>   EQUIPA_CART_EQUIPMENT_TAKEN:<números>
--   EQUIPA_CART_NUMBER_TAKEN               EQUIPA_CART_NOT_FOUND
-- Criar com o número de um carrinho DESATIVADO reaproveita esse carrinho (QR e
-- histórico preservados). p_move=true tira os equipamentos de outros carrinhos.
------------------------------------------------------------------------------
create or replace function private.save_equipment_cart_v3_internal(
  p_cart_id bigint, p_number integer, p_name text, p_equipment_codes text[],
  p_location_text text, p_capacity integer, p_notes text, p_move boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_cart bigint;
  v_codes text[];
  v_missing text[];
  v_taken text[];
  v_ids uuid[];
  v_qr_needs boolean;
  v_has_created_by boolean;
  v_reused boolean := false;
begin
  if auth.uid() is null or private.current_role() is distinct from 'admin'::public.app_role
    then raise exception 'EQUIPA_ADMIN_REQUIRED'; end if;
  if p_number is null or p_number < 1 or p_number > 100000 then raise exception 'EQUIPA_CART_NUMBER_INVALID'; end if;
  if p_capacity is not null and (p_capacity < 1 or p_capacity > 200) then raise exception 'EQUIPA_CART_CAPACITY_INVALID'; end if;

  select coalesce(array_agg(distinct btrim(c)) filter (where btrim(c) <> ''), array[]::text[])
    into v_codes from unnest(coalesce(p_equipment_codes, array[]::text[])) c;
  if cardinality(v_codes) = 0 or cardinality(v_codes) > 200 then raise exception 'EQUIPA_CART_CODES_INVALID'; end if;
  if p_capacity is not null and cardinality(v_codes) > p_capacity then raise exception 'EQUIPA_CART_OVER_CAPACITY'; end if;

  select array_agg(c order by c) into v_missing
    from unnest(v_codes) c
   where not exists (select 1 from public.equipments e where lower(e.code) = lower(c) and e.is_active);
  if v_missing is not null then
    raise exception 'EQUIPA_CART_UNKNOWN_CODES:%', array_to_string(v_missing[1:15], ', ');
  end if;

  select array_agg(e.id order by nullif(left(regexp_replace(e.code, '\D', '', 'g'), 15), '')::bigint nulls last, e.code)
    into v_ids from public.equipments e
   where e.is_active and lower(e.code) in (select lower(c) from unnest(v_codes) c);

  if p_cart_id is not null then
    select id into v_cart from public.equipment_carts where id = p_cart_id for update;
    if not found then raise exception 'EQUIPA_CART_NOT_FOUND'; end if;
  end if;

  if exists (select 1 from public.equipment_carts where number = p_number and is_active and id is distinct from v_cart)
    then raise exception 'EQUIPA_CART_NUMBER_TAKEN'; end if;

  if v_cart is null then
    select id into v_cart from public.equipment_carts where number = p_number and not is_active order by id limit 1 for update;
    v_reused := v_cart is not null;
  elsif exists (select 1 from public.equipment_carts where number = p_number and id <> v_cart) then
    raise exception 'EQUIPA_CART_NUMBER_TAKEN';
  end if;

  select array_agg(distinct e.code) into v_taken
    from public.equipment_cart_items ci
    join public.equipment_carts c on c.id = ci.cart_id
    join public.equipments e on e.id = ci.equipment_id
   where ci.equipment_id = any(v_ids) and c.is_active and c.id is distinct from v_cart;
  if v_taken is not null and not coalesce(p_move, false) then
    raise exception 'EQUIPA_CART_EQUIPMENT_TAKEN:%', array_to_string(v_taken[1:15], ', ');
  end if;
  -- Um equipamento fica em um carrinho só: sai de qualquer outro (desativados sempre).
  delete from public.equipment_cart_items ci
   using public.equipment_carts c
   where c.id = ci.cart_id and ci.equipment_id = any(v_ids) and c.id is distinct from v_cart;

  if v_cart is null then
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_carts' and column_name = 'qr_token' and column_default is null)
      into v_qr_needs;
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_carts' and column_name = 'created_by')
      into v_has_created_by;
    execute format(
      'insert into public.equipment_carts(number,name,is_active,location_text,capacity,notes%s%s) values ($1,$2,true,$3,$4,$5%s%s) returning id',
      case when v_qr_needs then ',qr_token' else '' end, case when v_has_created_by then ',created_by' else '' end,
      case when v_qr_needs then ',gen_random_uuid()' else '' end, case when v_has_created_by then ',$6' else '' end)
      into v_cart
      using p_number, nullif(btrim(p_name), ''), nullif(btrim(p_location_text), ''), p_capacity, nullif(btrim(p_notes), ''), auth.uid();
  else
    update public.equipment_carts
       set number = p_number, name = nullif(btrim(p_name), ''), is_active = true,
           location_text = nullif(btrim(p_location_text), ''), capacity = p_capacity,
           notes = nullif(btrim(p_notes), ''), updated_at = now()
     where id = v_cart;
  end if;

  delete from public.equipment_cart_items where cart_id = v_cart and not (equipment_id = any(v_ids));
  insert into public.equipment_cart_items(cart_id, equipment_id, position)
  select v_cart, x.id, x.ord::integer from unnest(v_ids) with ordinality as x(id, ord)
   where not exists (select 1 from public.equipment_cart_items ci where ci.cart_id = v_cart and ci.equipment_id = x.id);
  update public.equipment_cart_items ci set position = x.ord::integer
    from unnest(v_ids) with ordinality as x(id, ord)
   where ci.cart_id = v_cart and ci.equipment_id = x.id and ci.position is distinct from x.ord::integer;

  return jsonb_build_object('cart_id', v_cart, 'number', p_number, 'items', cardinality(v_ids),
    'moved', coalesce(cardinality(v_taken), 0), 'reused', v_reused);
end;
$$;
revoke all on function private.save_equipment_cart_v3_internal(bigint,integer,text,text[],text,integer,text,boolean) from public, anon;
grant execute on function private.save_equipment_cart_v3_internal(bigint,integer,text,text[],text,integer,text,boolean) to authenticated;

create or replace function public.equipa_save_cart(
  p_cart_id bigint, p_number integer, p_name text, p_equipment_codes text[],
  p_location_text text default null, p_capacity integer default null, p_notes text default null, p_move boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.save_equipment_cart_v3_internal(p_cart_id, p_number, p_name, p_equipment_codes, p_location_text, p_capacity, p_notes, p_move);
$$;
revoke all on function public.equipa_save_cart(bigint,integer,text,text[],text,integer,text,boolean) from public, anon;
grant execute on function public.equipa_save_cart(bigint,integer,text,text[],text,integer,text,boolean) to authenticated;

-- A chamada antiga passa a usar a implementação nova (mesma assinatura e retorno).
create or replace function private.save_equipment_cart_v2_internal(
  p_cart_id bigint, p_number integer, p_name text, p_equipment_codes text[], p_location_text text, p_capacity integer, p_notes text
) returns bigint language sql security definer set search_path='' as $$
  select (private.save_equipment_cart_v3_internal(p_cart_id, p_number, p_name, p_equipment_codes, p_location_text, p_capacity, p_notes, false) ->> 'cart_id')::bigint;
$$;

------------------------------------------------------------------------------
-- 2) Campos personalizáveis dos notes
-- No banco em produção `equipments` é uma VISÃO sobre equipment_units (com
-- gatilho INSTEAD OF). A coluna nova fica na tabela real, a visão passa a
-- expô-la (no fim, como exige CREATE OR REPLACE VIEW) e o gatilho a grava.
------------------------------------------------------------------------------
alter table public.equipment_units add column if not exists specs jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_units_specs_object_check') then
    alter table public.equipment_units add constraint equipment_units_specs_object_check
      check (jsonb_typeof(specs) = 'object' and pg_column_size(specs) <= 8192);
  end if;
end $$;

create or replace view public.equipments with (security_invoker = true) as
 SELECT u.id,
    u.code,
    u.asset_tag,
    mf.name AS brand,
    mc.name AS model,
        CASE
            WHEN u.label IS NOT NULL THEN u.label
            WHEN c.id IS NOT NULL AND c.code <> 'outro'::text THEN c.name
            ELSE NULL::text
        END AS label,
    u.status,
    u.is_active,
    u.created_by,
    u.created_at,
    u.updated_at,
    u.qr_token,
    c.code AS school_group,
    u.serial_number,
    l.name AS location_text,
    u.notes,
    v.processor,
    v.ram_gb,
    v.storage_gb,
    v.operating_system,
    mf.id AS manufacturer_id,
    mc.id AS model_id,
    v.id AS variant_id,
    l.id AS location_id,
    v.memory_type,
    v.storage_type,
    v.display_size_inches,
    v.display_resolution,
    v.spec_source,
    v.spec_notes,
    u.specs
   FROM equipment_units u
     JOIN equipment_variants v ON v.id = u.variant_id
     JOIN equipment_model_catalog mc ON mc.id = v.model_id
     JOIN equipment_manufacturers mf ON mf.id = mc.manufacturer_id
     LEFT JOIN equipment_categories c ON c.id = v.category_id
     LEFT JOIN equipment_locations l ON l.id = u.location_id;

-- Mesma função de escrita da visão, agora gravando `specs`.
create or replace function private.equipments_compat_write()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_variant_id integer;
  v_location_id integer;
  v_id uuid;
  v_row public.equipments%rowtype;
begin
  if auth.uid() is null or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'EQUIPA_ADMIN_REQUIRED';
  end if;

  if TG_OP='DELETE' then
    perform private.remove_equipment_internal(old.id);
    return old;
  end if;

  if TG_OP='INSERT' then
    v_variant_id:=coalesce(
      new.variant_id,
      private.resolve_equipment_variant(
        new.brand,new.model,new.school_group,new.processor,
        new.ram_gb,new.storage_gb,new.operating_system
      )
    );
    v_location_id:=coalesce(new.location_id,private.resolve_equipment_location(new.location_text));

    insert into public.equipment_units(
      id,code,asset_tag,serial_number,label,notes,variant_id,location_id,
      status,is_active,created_by,qr_token,specs
    )
    values(
      coalesce(new.id,gen_random_uuid()),
      btrim(new.code),
      nullif(btrim(coalesce(new.asset_tag,'')),''),
      nullif(btrim(coalesce(new.serial_number,'')),''),
      nullif(btrim(coalesce(new.label,'')),''),
      nullif(btrim(coalesce(new.notes,'')),''),
      v_variant_id,v_location_id,
      coalesce(new.status,'available'::public.equipment_status),
      coalesce(new.is_active,true),
      coalesce(new.created_by,auth.uid()),
      coalesce(new.qr_token,gen_random_uuid()),
      coalesce(new.specs,'{}'::jsonb)
    )
    returning id into v_id;
  else
    if new.variant_id is distinct from old.variant_id
       and new.variant_id is not null then
      v_variant_id:=new.variant_id;
    elsif new.brand is distinct from old.brand
       or new.model is distinct from old.model
       or new.school_group is distinct from old.school_group
       or new.processor is distinct from old.processor
       or new.ram_gb is distinct from old.ram_gb
       or new.storage_gb is distinct from old.storage_gb
       or new.operating_system is distinct from old.operating_system then
      v_variant_id:=private.resolve_equipment_variant(
        new.brand,new.model,new.school_group,new.processor,
        new.ram_gb,new.storage_gb,new.operating_system
      );
    else
      v_variant_id:=old.variant_id;
    end if;

    if new.location_id is distinct from old.location_id and new.location_id is not null then
      v_location_id:=new.location_id;
    elsif new.location_text is distinct from old.location_text then
      v_location_id:=private.resolve_equipment_location(new.location_text);
    else
      v_location_id:=old.location_id;
    end if;

    update public.equipment_units
    set code=btrim(new.code),
        asset_tag=nullif(btrim(coalesce(new.asset_tag,'')),''),
        serial_number=nullif(btrim(coalesce(new.serial_number,'')),''),
        label=case
          when new.label is null then null
          when new.school_group is not null
            and lower(btrim(new.label))=lower(btrim(new.school_group)) then null
          else nullif(btrim(new.label),'')
        end,
        notes=nullif(btrim(coalesce(new.notes,'')),''),
        variant_id=v_variant_id,
        location_id=v_location_id,
        status=new.status,
        is_active=new.is_active,
        specs=coalesce(new.specs,old.specs,'{}'::jsonb)
    where id=old.id
    returning id into v_id;
  end if;

  select * into v_row from public.equipments where id=v_id;
  return v_row;
end;
$function$;

------------------------------------------------------------------------------
-- 3) Fichas de modelo (fonte da herança no cadastro)
-- `equipment_models` é uma visão de leitura sobre o catálogo normalizado; as
-- fichas editáveis ficam numa tabela própria, sem alterar o catálogo.
------------------------------------------------------------------------------
create table if not exists public.equipa_model_profiles (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  manufacturer text check (manufacturer is null or length(manufacturer) <= 100),
  school_group text check (school_group is null or school_group in ('chromebook','positivo_novo','positivo_tecnico','positivo_antigo','thinkpad_lenovo','tablet','outro')),
  operating_system text check (operating_system is null or length(operating_system) <= 120),
  processor text check (processor is null or length(processor) <= 120),
  ram_gb integer check (ram_gb is null or ram_gb between 1 and 1024),
  storage_gb integer check (storage_gb is null or storage_gb between 1 and 1048576),
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object' and pg_column_size(specs) <= 8192),
  notes text check (notes is null or length(notes) <= 1200),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists equipa_model_profiles_name_key on public.equipa_model_profiles (lower(btrim(name)));
alter table public.equipa_model_profiles enable row level security;
drop policy if exists equipa_model_profiles_read on public.equipa_model_profiles;
create policy equipa_model_profiles_read on public.equipa_model_profiles for select to authenticated
  using (private.current_role() is not null);
drop policy if exists equipa_model_profiles_admin_write on public.equipa_model_profiles;
create policy equipa_model_profiles_admin_write on public.equipa_model_profiles for all to authenticated
  using (private.current_role() = 'admin'::public.app_role)
  with check (private.current_role() = 'admin'::public.app_role);
revoke all on public.equipa_model_profiles from anon;
grant select, insert, update, delete on public.equipa_model_profiles to authenticated;

------------------------------------------------------------------------------
-- 4) Ajustes da escola (campos personalizados, lista de locais)
------------------------------------------------------------------------------
create table if not exists public.equipa_settings (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  value jsonb not null check (pg_column_size(value) <= 32768),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);
alter table public.equipa_settings enable row level security;
drop policy if exists equipa_settings_read on public.equipa_settings;
create policy equipa_settings_read on public.equipa_settings for select to authenticated
  using (private.current_role() is not null);
drop policy if exists equipa_settings_admin_write on public.equipa_settings;
create policy equipa_settings_admin_write on public.equipa_settings for all to authenticated
  using (private.current_role() = 'admin'::public.app_role)
  with check (private.current_role() = 'admin'::public.app_role);
revoke all on public.equipa_settings from anon;
grant select, insert, update, delete on public.equipa_settings to authenticated;

notify pgrst, 'reload schema';
