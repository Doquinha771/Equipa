-- Equipa 1.3 — corrige "Relatório indisponível" (erro 42803).
--
-- Causa: em private.reports_internal, o ranking "Mais usados" agrupava só por e.id
-- e exibia e.code. Isso valia quando public.equipments era tabela (e.id é chave
-- primária e determina e.code). Em produção, public.equipments passou a ser uma
-- VISÃO, que não tem chave primária, e o PostgreSQL passou a exigir e.code no
-- GROUP BY: "column e.code must appear in the GROUP BY clause".
--
-- Correção: a mesma função, idêntica à de produção, com "group by e.id, e.code".
-- Afeta Relatórios (equipa_admin_report_dashboard) e a exportação CSV
-- (equipa_admin_reports), que usam esta função. Não altera dados.
create or replace function private.reports_internal(p_from timestamp with time zone, p_to timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_data jsonb;
begin
  if auth.uid() is null
     or private.current_role() <> 'admin'::public.app_role then
    raise exception 'EQUIPA_ADMIN_REQUIRED';
  end if;

  if p_from is null
     or p_to is null
     or p_from >= p_to
     or p_to > now() + interval '1 day'
     or p_to - p_from > interval '370 days' then
    raise exception 'EQUIPA_REPORT_RANGE_INVALID';
  end if;

  select jsonb_build_object(
    'reservations',0,
    'cancelled',0,
    'expired',0,
    'withdrawals',(
      select count(*)
      from public.withdrawals w
      where w.withdrawn_at >= p_from
        and w.withdrawn_at < p_to
    ),
    'used_equipment',(
      select count(distinct wi.equipment_id)
      from public.withdrawal_items wi
      join public.withdrawals w on w.id = wi.withdrawal_id
      where w.withdrawn_at >= p_from
        and w.withdrawn_at < p_to
    ),
    'returned',(
      select count(*)
      from public.withdrawal_items wi
      where wi.returned_at >= p_from
        and wi.returned_at < p_to
    ),
    'damaged',(
      select count(*)
      from public.withdrawal_items wi
      where wi.returned_at >= p_from
        and wi.returned_at < p_to
        and wi.return_condition = 'damaged'
    ),
    'late_open',(
      select count(*)
      from public.withdrawals w
      where w.status = 'open'::public.withdrawal_status
        and w.due_at < now()
    ),
    'maintenance_open',(
      select count(*)
      from public.maintenance_events m
      where m.status = 'open'::public.maintenance_event_status
    ),
    'avg_minutes',(
      select round(avg(extract(epoch from wi.returned_at - w.withdrawn_at)/60))::integer
      from public.withdrawal_items wi
      join public.withdrawals w on w.id = wi.withdrawal_id
      where wi.returned_at >= p_from
        and wi.returned_at < p_to
    ),
    'top_equipment',(
      select coalesce(
        jsonb_agg(t.item order by t.use_count desc),
        '[]'::jsonb
      )
      from (
        select
          jsonb_build_object('code',e.code,'uses',count(*)) as item,
          count(*) as use_count
        from public.withdrawal_items wi
        join public.withdrawals w on w.id = wi.withdrawal_id
        join public.equipments e on e.id = wi.equipment_id
        where w.withdrawn_at >= p_from
          and w.withdrawn_at < p_to
        group by e.id, e.code
        order by count(*) desc
        limit 8
      ) t
    )
  )
  into v_data;

  return v_data;
end;
$function$;
