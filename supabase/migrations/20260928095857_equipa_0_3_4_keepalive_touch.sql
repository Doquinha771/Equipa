alter table public.equipa_keepalive
  add column if not exists last_ping timestamptz not null default now();
revoke update on table public.equipa_keepalive from anon, authenticated;
grant update(last_ping) on table public.equipa_keepalive to anon, authenticated;
drop policy if exists equipa_keepalive_update on public.equipa_keepalive;
create policy equipa_keepalive_update
on public.equipa_keepalive
for update
to anon, authenticated
using (id = 1 and last_ping <= now() - interval '4 days')
with check (
  id = 1
  and last_ping >= now() - interval '10 minutes'
  and last_ping <= now() + interval '10 minutes'
);
comment on column public.equipa_keepalive.last_ping is
  'Updated by the external GitHub keepalive at most once every four days; contains no user or equipment data.';
notify pgrst,'reload schema';
