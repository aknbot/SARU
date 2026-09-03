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
