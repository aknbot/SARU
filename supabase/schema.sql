-- 検定ノート: 進捗同期テーブル
-- Supabase ダッシュボード → SQL Editor に貼り付けて Run する。
-- 1ユーザー × 1コースにつき 1行。state にはブラウザの localStorage と同じ JSON をそのまま保存する。

create table if not exists public.progress (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  course_id  text        not null,
  state      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

-- RLS: 自分の行しか読めない・書けない
alter table public.progress enable row level security;

drop policy if exists "progress: select own" on public.progress;
create policy "progress: select own" on public.progress
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "progress: insert own" on public.progress;
create policy "progress: insert own" on public.progress
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "progress: update own" on public.progress;
create policy "progress: update own" on public.progress
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "progress: delete own" on public.progress;
create policy "progress: delete own" on public.progress
  for delete to authenticated
  using (auth.uid() = user_id);

-- updated_at はサーバー時刻で上書き（端末の時計に依存しない）
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists progress_set_updated_at on public.progress;
create trigger progress_set_updated_at before insert or update on public.progress
  for each row execute function public.set_updated_at();

-- アカウント削除（本人のみ）。アプリの「設定 → アカウントを削除」から rpc('delete_own_account') で呼ばれる。
-- progress は on delete cascade で消える。
create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.progress where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end; $$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
