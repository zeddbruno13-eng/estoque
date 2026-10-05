-- Para o banco existente: execute este arquivo no SQL Editor do Supabase.
-- Não exclui equipamentos nem histórico. Pode ser executado novamente.
begin;

alter table public.estoque enable row level security;
alter table public.estoque_historico enable row level security;

-- Remove privilégios públicos e mantém somente as operações usadas pelo app.
revoke all on table public.estoque, public.estoque_historico from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.estoque to authenticated;
grant select on public.estoque_historico to authenticated;

-- Uma política restritiva também limita políticas permissivas antigas.
-- Contas anônimas do Auth não são usuários autorizados deste sistema.
drop policy if exists "estoque_exige_sessao" on public.estoque;
create policy "estoque_exige_sessao" on public.estoque
as restrictive for all to public
using (auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
with check (auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);

drop policy if exists "historico_exige_sessao" on public.estoque_historico;
create policy "historico_exige_sessao" on public.estoque_historico
as restrictive for all to public
using (auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
with check (auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);

drop policy if exists "estoque_select_authenticated" on public.estoque;
drop policy if exists "estoque_insert_authenticated" on public.estoque;
drop policy if exists "estoque_update_authenticated" on public.estoque;
drop policy if exists "estoque_delete_authenticated" on public.estoque;
drop policy if exists "historico_select_authenticated" on public.estoque_historico;
create policy "estoque_select_authenticated" on public.estoque for select to authenticated using (true);
create policy "estoque_insert_authenticated" on public.estoque for insert to authenticated with check (true);
create policy "estoque_update_authenticated" on public.estoque for update to authenticated using (true) with check (true);
create policy "estoque_delete_authenticated" on public.estoque for delete to authenticated using (true);
create policy "historico_select_authenticated" on public.estoque_historico for select to authenticated using (true);

-- Somente a sequência do estoque precisa ser acessível ao cliente.
do $$
declare seq text;
begin
  seq := pg_get_serial_sequence('public.estoque', 'id');
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
    execute format('grant usage, select on sequence %s to authenticated', seq);
  end if;
  seq := pg_get_serial_sequence('public.estoque_historico', 'id');
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
  end if;
end $$;

commit;
