-- Equipa 1.4 — excluir vários equipamentos de vez.
--
-- Antes: equipamento nunca era apagado (gatilho prevent_equipment_delete e a
-- auditoria em equipment_units recusavam DELETE); "excluir" só tirava do catálogo.
-- Agora, por decisão da administração, a função equipa_purge_equipment(ids):
--   - APAGA de vez quem nunca teve retirada, manutenção nem uso mensal (os
--     registros de cadastro/desativação em equipment_history vão junto; itens de
--     carrinho saem pela FK em cascata);
--   - TIRA DO CATÁLOGO quem tem histórico (retiradas antigas não podem ficar órfãs);
--   - NÃO MEXE em emprestado ou com manutenção aberta (e informa).
-- Cada chamada registra em audit_events quem apagou e quais números.
-- As travas continuam valendo para qualquer DELETE fora desta função: a liberação
-- é uma configuração local da transação (equipa.allow_purge) ligada só aqui.

create or replace function private.equipment_purge_allowed()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('equipa.allow_purge', true), '') = 'on';
$$;

create or replace function private.prevent_equipment_delete()
 returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if private.equipment_purge_allowed() then
    return old;
  end if;
  raise exception 'EQUIPA_EQUIPMENT_DELETE_FORBIDDEN'
    using detail = 'Equipamentos cadastrados devem ser arquivados/desativados, nunca apagados.';
end;
$function$;

-- Mesma função de auditoria em produção; única mudança: DELETE em equipment_units é
-- aceito quando liberado pela exclusão em lote (que registra em audit_events).
create or replace function private.audit_row_change()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_actor uuid:=auth.uid();
  v_name text;
  v_old_all jsonb;
  v_new_all jsonb;
  v_old jsonb:='{}'::jsonb;
  v_new jsonb:='{}'::jsonb;
  v_keys text[];
  v_id text;
  v_fields jsonb;
  v_action smallint;
begin
  if TG_OP<>'INSERT' then v_old_all:=to_jsonb(old); end if;
  if TG_OP<>'DELETE' then v_new_all:=to_jsonb(new); end if;

  if TG_TABLE_NAME='equipment_units' then
    v_keys:=array[
      'id','code','status','is_active','variant_id','location_id',
      'serial_number','asset_tag','label','notes'
    ];

    if TG_OP='UPDATE' then
      select coalesce(jsonb_object_agg(k,v_old_all->k),'{}'::jsonb)
        into v_old
      from unnest(v_keys) k
      where (v_old_all->k) is distinct from (v_new_all->k);

      select coalesce(jsonb_object_agg(k,v_new_all->k),'{}'::jsonb)
        into v_new
      from unnest(v_keys) k
      where (v_old_all->k) is distinct from (v_new_all->k);

      if v_old='{}'::jsonb and v_new='{}'::jsonb then return new; end if;

      if old.is_active=true and new.is_active=false then
        v_action:=3;
      elsif old.is_active=false and new.is_active=true then
        v_action:=4;
      else
        v_action:=2;
      end if;
    elsif TG_OP='INSERT' then
      select coalesce(jsonb_object_agg(k,v_new_all->k),'{}'::jsonb)
        into v_new
      from unnest(v_keys) k
      where v_new_all?k;
      v_action:=1;
    else
      if private.equipment_purge_allowed() then
        return old;
      end if;
      raise exception 'EQUIPA_EQUIPMENT_DELETE_FORBIDDEN';
    end if;

    v_fields:=jsonb_strip_nulls(jsonb_build_object(
      'before',nullif(v_old,'{}'::jsonb),
      'after',nullif(v_new,'{}'::jsonb)
    ));

    insert into public.equipment_history(
      equipment_id,actor_id,action,changes
    )
    values(
      coalesce(new.id,old.id),v_actor,v_action,v_fields
    );

    return coalesce(new,old);
  end if;

  select full_name into v_name from public.profiles where id=v_actor;

  case TG_TABLE_NAME
    when 'withdrawals' then
      v_keys:=array['id','status','requested_by','class_name','destination',
                    'due_at','withdrawn_at','returned_at'];
    when 'withdrawal_items' then
      v_keys:=array['id','withdrawal_id','equipment_id','returned_at','return_condition'];
    when 'maintenance_events' then
      v_keys:=array['id','equipment_id','status','opened_at','closed_at'];
    when 'profiles' then
      v_keys:=array['id','role','is_active','disabled_at'];
    when 'legal_acceptances' then
      v_keys:=array['id','user_id','terms_version','privacy_version','accepted_at'];
    when 'equipment_carts' then
      v_keys:=array['id','number','is_active','location_text','capacity'];
    when 'equipment_cart_items' then
      v_keys:=array['cart_id','equipment_id','position'];
    else
      v_keys:=array['id'];
  end case;

  if TG_OP='UPDATE' then
    select coalesce(jsonb_object_agg(k,v_old_all->k),'{}'::jsonb)
      into v_old
    from unnest(v_keys) k
    where (v_old_all->k) is distinct from (v_new_all->k);

    select coalesce(jsonb_object_agg(k,v_new_all->k),'{}'::jsonb)
      into v_new
    from unnest(v_keys) k
    where (v_old_all->k) is distinct from (v_new_all->k);

    if v_old='{}'::jsonb and v_new='{}'::jsonb then return new; end if;
  elsif TG_OP='INSERT' then
    select coalesce(jsonb_object_agg(k,v_new_all->k),'{}'::jsonb)
      into v_new from unnest(v_keys) k where v_new_all?k;
  else
    select coalesce(jsonb_object_agg(k,v_old_all->k),'{}'::jsonb)
      into v_old from unnest(v_keys) k where v_old_all?k;
  end if;

  v_id:=coalesce(
    v_new->>'id',v_old->>'id',
    v_new->>'equipment_id',v_old->>'equipment_id',
    v_new->>'cart_id',v_old->>'cart_id'
  );

  v_fields:=jsonb_strip_nulls(jsonb_build_object(
    'before',nullif(v_old,'{}'::jsonb),
    'after',nullif(v_new,'{}'::jsonb)
  ));

  insert into public.audit_events(
    actor_id,actor_name,action,entity_type,entity_id,summary,details
  )
  values(
    v_actor,v_name,lower(TG_OP),TG_TABLE_NAME,v_id,
    TG_TABLE_NAME||' · '||lower(TG_OP),v_fields
  );

  return coalesce(new,old);
end;
$function$;

create or replace function private.purge_equipment_internal(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_unit record;
  v_deleted jsonb := '[]'::jsonb;
  v_archived jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
begin
  if v_actor is null or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'EQUIPA_ADMIN_REQUIRED';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'EQUIPA_PURGE_SIZE_INVALID';
  end if;
  select full_name into v_name from public.profiles where id = v_actor;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select u.id, u.code, u.status, u.is_active into v_unit
      from public.equipment_units u where u.id = v_id for update;
    if not found then continue; end if;

    -- Emprestado ou em manutenção aberta: não mexe.
    if v_unit.status = 'in_use'::public.equipment_status
       or exists (select 1 from public.withdrawal_items wi where wi.equipment_id = v_id and wi.returned_at is null) then
      v_blocked := v_blocked || jsonb_build_object('code', v_unit.code, 'reason', 'emprestado');
      continue;
    end if;
    if exists (select 1 from public.maintenance_events m where m.equipment_id = v_id and m.status = 'open'::public.maintenance_event_status) then
      v_blocked := v_blocked || jsonb_build_object('code', v_unit.code, 'reason', 'manutenção aberta');
      continue;
    end if;

    -- Com histórico de uso: só sai do catálogo (as retiradas antigas continuam válidas).
    if exists (select 1 from public.withdrawal_items wi where wi.equipment_id = v_id)
       or exists (select 1 from public.maintenance_events m where m.equipment_id = v_id)
       or exists (select 1 from public.equipment_usage_monthly x where x.equipment_id = v_id) then
      if v_unit.is_active then
        update public.equipment_units
           set is_active = false, status = 'unavailable'::public.equipment_status
         where id = v_id;
      end if;
      v_archived := v_archived || jsonb_build_object('code', v_unit.code);
      continue;
    end if;

    -- Sem uso: apaga de vez (registros de cadastro/desativação vão junto).
    perform set_config('equipa.allow_purge', 'on', true);
    delete from public.equipment_history h where h.equipment_id = v_id;
    delete from public.equipment_units u where u.id = v_id;
    perform set_config('equipa.allow_purge', 'off', true);
    v_deleted := v_deleted || jsonb_build_object('code', v_unit.code);
  end loop;

  if jsonb_array_length(v_deleted) + jsonb_array_length(v_archived) > 0 then
    insert into public.audit_events(actor_id, actor_name, action, entity_type, entity_id, summary, details)
    values (v_actor, v_name, 'delete', 'equipments', null,
      format('%s equipamento(s) apagado(s), %s fora do catálogo', jsonb_array_length(v_deleted), jsonb_array_length(v_archived)),
      jsonb_build_object('deleted', v_deleted, 'archived', v_archived, 'blocked', v_blocked));
  end if;

  return jsonb_build_object(
    'deleted', jsonb_array_length(v_deleted), 'archived', jsonb_array_length(v_archived),
    'blocked', v_blocked, 'deleted_codes', v_deleted);
end;
$$;
revoke all on function private.purge_equipment_internal(uuid[]) from public, anon;
grant execute on function private.purge_equipment_internal(uuid[]) to authenticated;
revoke all on function private.equipment_purge_allowed() from public, anon;
grant execute on function private.equipment_purge_allowed() to authenticated;

create or replace function public.equipa_purge_equipment(p_ids uuid[])
returns jsonb language sql security invoker set search_path = '' as $$
  select private.purge_equipment_internal(p_ids);
$$;
revoke all on function public.equipa_purge_equipment(uuid[]) from public, anon;
grant execute on function public.equipa_purge_equipment(uuid[]) to authenticated;

notify pgrst, 'reload schema';
