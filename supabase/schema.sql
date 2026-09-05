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

-- 入力の検査（course_id の形式、state はオブジェクト、64KB まで）
alter table public.progress drop constraint if exists progress_course_id_chk;
alter table public.progress add constraint progress_course_id_chk check (course_id ~ '^[a-z0-9_-]{1,32}$');
alter table public.progress drop constraint if exists progress_state_obj_chk;
alter table public.progress add constraint progress_state_obj_chk check (jsonb_typeof(state) = 'object');
alter table public.progress drop constraint if exists progress_state_size_chk;
alter table public.progress add constraint progress_state_size_chk check (pg_column_size(state) <= 65536);
alter table public.progress add column if not exists created_at timestamptz not null default now();
revoke all on public.progress from anon;

-- RLS: 自分の行しか読めない・書けない
alter table public.progress enable row level security;

drop policy if exists "progress: select own" on public.progress;
create policy "progress: select own" on public.progress
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "progress: insert own" on public.progress;
create policy "progress: insert own" on public.progress
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "progress: update own" on public.progress;
create policy "progress: update own" on public.progress
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "progress: delete own" on public.progress;
create policy "progress: delete own" on public.progress
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- updated_at はサーバー時刻で上書きし、古い state（updatedAt が小さい）での上書きは捨てる（端末の時計ずれ・遅延到着への保険）
create or replace function public.progress_guard() returns trigger
language plpgsql as $$
declare
  new_ts bigint := case when jsonb_typeof(new.state->'updatedAt') = 'number' then (new.state->>'updatedAt')::bigint else 0 end;
  old_ts bigint := case when tg_op = 'UPDATE' and jsonb_typeof(old.state->'updatedAt') = 'number' then (old.state->>'updatedAt')::bigint else 0 end;
begin
  if tg_op = 'UPDATE' and new_ts < old_ts then
    return null;   -- 古い内容は無視（クライアントには成功として返る。次回の pull でマージされる）
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists progress_set_updated_at on public.progress;
drop trigger if exists progress_guard on public.progress;
create trigger progress_guard before insert or update on public.progress
  for each row execute function public.progress_guard();

-- アカウント削除（本人のみ）。アプリの「設定 → アカウントを削除」から rpc('delete_own_account') で呼ばれる。
-- progress は on delete cascade で消える。
create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.progress where user_id = uid;
  delete from auth.users where id = uid;   -- identities / sessions / refresh_tokens は cascade で消える
end; $$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
