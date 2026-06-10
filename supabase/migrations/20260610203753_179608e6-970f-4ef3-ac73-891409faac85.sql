create table public.navegacao_externa (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  domain text not null,
  title text,
  inicio timestamptz not null default now(),
  fim timestamptz,
  duracao_segundos numeric,
  inativo_segundos numeric not null default 0,
  janela_focada boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.navegacao_externa to authenticated;
grant all on public.navegacao_externa to service_role;
alter table public.navegacao_externa enable row level security;
create policy "Users manage own navegacao_externa" on public.navegacao_externa for all to authenticated using (auth.uid() = usuario_id or public.has_role(auth.uid(), 'admin')) with check (auth.uid() = usuario_id or public.has_role(auth.uid(), 'admin'));
create index navegacao_externa_usuario_inicio_idx on public.navegacao_externa (usuario_id, inicio desc);