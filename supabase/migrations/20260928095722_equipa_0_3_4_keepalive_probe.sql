create table if not exists public.equipa_keepalive (
  id smallint primary key default 1 check (id = 1),
  marker text not null default 'equipa',
  created_at timestamptz not null default now()
);
alter table public.equipa_keepalive enable row level security;
revoke all on table public.equipa_keepalive from public, anon, authenticated, service_role;
grant select on table public.equipa_keepalive to anon, authenticated;
drop policy if exists equipa_keepalive_read on public.equipa_keepalive;
create policy equipa_keepalive_read
on public.equipa_keepalive
for select
to anon, authenticated
using (id = 1);
insert into public.equipa_keepalive(id, marker)
values (1,'equipa')
on conflict (id) do nothing;
comment on table public.equipa_keepalive is
  'Public non-sensitive singleton used only for an external keepalive read; no equipment or user data.';
notify pgrst,'reload schema';
