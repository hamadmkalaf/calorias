-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Cria uma única tabela onde cada usuário só enxerga os próprios registros.

create sequence if not exists public.records_seq;

create table if not exists public.records (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null,
  kind       text   not null check (kind in ('foods', 'entries', 'settings')),
  data       jsonb  not null,
  updated_at bigint not null default 0,
  deleted    boolean not null default false,
  seq        bigint not null default nextval('public.records_seq'),
  primary key (user_id, id)
);

create index if not exists records_user_seq on public.records (user_id, seq);

-- A cada gravação o registro recebe um novo número de sequência,
-- que os aparelhos usam para baixar só o que mudou.
create or replace function public.records_bump_seq() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('public.records_seq');
  return new;
end $$;

drop trigger if exists records_bump_seq on public.records;
create trigger records_bump_seq before insert or update on public.records
for each row execute function public.records_bump_seq();

alter table public.records enable row level security;

drop policy if exists "own records" on public.records;
create policy "own records" on public.records
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
