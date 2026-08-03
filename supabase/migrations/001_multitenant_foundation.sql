-- RadioTracker 云端多用户基础结构
-- 在 Supabase SQL Editor 或 CLI 中执行。所有私人表都启用 RLS。

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drama_catalog (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer,
  missevan_id bigint unique,
  title text not null,
  platform text not null default '猫耳',
  source text not null default 'manual',
  kind text,
  categories text[] not null default '{}',
  organization text,
  abstract text,
  cover_url text,
  total_episodes integer check (total_episodes is null or total_episodes >= 0),
  serialize_status text,
  update_info text,
  update_day text,
  price numeric(10, 2),
  detail_error text,
  detail_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_cvs (
  id uuid primary key default gen_random_uuid(),
  legacy_id integer,
  name text not null unique,
  missevan_id bigint unique,
  avatar_url text,
  note text,
  created_at timestamptz not null default now()
);

create table public.catalog_drama_cvs (
  drama_id uuid not null references public.drama_catalog(id) on delete cascade,
  cv_id uuid not null references public.catalog_cvs(id) on delete cascade,
  role_type text not null default '主役' check (role_type in ('主役', '配役')),
  character text,
  primary key (drama_id, cv_id, role_type)
);

create table public.user_dramas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  drama_id uuid not null references public.drama_catalog(id) on delete cascade,
  legacy_id integer,
  status text check (status is null or status in ('在听', '听完', '想听', '囤着', '搁置', '弃了')),
  purchased boolean not null default false,
  subscribed boolean not null default false,
  heard_episodes integer check (heard_episodes is null or heard_episodes >= 0),
  rating numeric(3, 2) check (rating is null or (rating >= 0 and rating <= 5)),
  finished_date date,
  rewatch_queued boolean not null default false,
  rewatch_status text,
  review text,
  bought_order integer,
  sub_order integer,
  sort_order integer not null default 0,
  sync_saw_episode text,
  sync_total_episodes integer check (sync_total_episodes is null or sync_total_episodes >= 0),
  sync_newest text,
  sync_serialize text,
  sync_purchased boolean,
  sync_subscribed boolean,
  synced_at timestamptz,
  custom_total_episodes integer check (custom_total_episodes is null or custom_total_episodes >= 0),
  custom_cover_object text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, drama_id)
);

create table public.rewatch_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  drama_id uuid not null references public.drama_catalog(id) on delete cascade,
  legacy_id integer,
  planned_at date,
  done_at date,
  round integer check (round is null or round > 0),
  note text,
  created_at timestamptz not null default now()
);

-- Cookie 只允许后端 service role 访问。密文、IV 和认证标签均由服务端生成。
create table public.user_missevan_credentials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  missevan_user_id bigint,
  credential_ciphertext text not null,
  credential_iv text not null,
  credential_tag text not null,
  encryption_version smallint not null default 1,
  saved_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  stage text,
  added integer not null default 0,
  updated integer not null default 0,
  removed integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.sync_jobs(id) on delete set null,
  legacy_id integer,
  kind text not null,
  added integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  detail jsonb,
  ran_at timestamptz not null default now()
);

create index drama_catalog_title_idx on public.drama_catalog (title);
create index user_dramas_user_status_idx on public.user_dramas (user_id, status);
create index user_dramas_user_bought_idx on public.user_dramas (user_id, purchased, bought_order);
create index user_dramas_user_subscribed_idx on public.user_dramas (user_id, subscribed, sub_order);
create index rewatch_plans_user_idx on public.rewatch_plans (user_id);
create index sync_jobs_user_created_idx on public.sync_jobs (user_id, created_at desc);
create index sync_logs_user_ran_idx on public.sync_logs (user_id, ran_at desc);

alter table public.profiles enable row level security;
alter table public.drama_catalog enable row level security;
alter table public.catalog_cvs enable row level security;
alter table public.catalog_drama_cvs enable row level security;
alter table public.user_dramas enable row level security;
alter table public.rewatch_plans enable row level security;
alter table public.user_missevan_credentials enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_logs enable row level security;

create policy "profiles_select_self" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_self" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "catalog_read_authenticated" on public.drama_catalog
  for select to authenticated using (true);
create policy "catalog_cvs_read_authenticated" on public.catalog_cvs
  for select to authenticated using (true);
create policy "catalog_drama_cvs_read_authenticated" on public.catalog_drama_cvs
  for select to authenticated using (true);

create policy "user_dramas_select_self" on public.user_dramas
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_dramas_insert_self" on public.user_dramas
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_dramas_update_self" on public.user_dramas
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_dramas_delete_self" on public.user_dramas
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "rewatch_plans_select_self" on public.rewatch_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "rewatch_plans_insert_self" on public.rewatch_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "rewatch_plans_update_self" on public.rewatch_plans
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "rewatch_plans_delete_self" on public.rewatch_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 登录 Cookie 不开放任何客户端策略，只有后端 service role 可以读写。

create policy "sync_jobs_select_self" on public.sync_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sync_logs_select_self" on public.sync_logs
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 私有封面存储规则：对象路径必须以当前用户 UUID 开头。
insert into storage.buckets (id, name, public)
values ('drama-covers', 'drama-covers', false)
on conflict (id) do nothing;

create policy "cover_objects_select_self" on storage.objects
  for select to authenticated
  using (bucket_id = 'drama-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cover_objects_insert_self" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'drama-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cover_objects_update_self" on storage.objects
  for update to authenticated
  using (bucket_id = 'drama-covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'drama-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cover_objects_delete_self" on storage.objects
  for delete to authenticated
  using (bucket_id = 'drama-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
