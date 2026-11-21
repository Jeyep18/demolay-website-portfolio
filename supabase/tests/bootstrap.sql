-- Isolated PostgreSQL compatibility fixture; never run against Supabase itself.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
-- Legacy permissive table proves the migration closes access without deleting old data.
create table public.articles(id integer primary key,title text);
insert into public.articles values(1,'Existing legacy content');
grant all on public.articles to anon,authenticated;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}');
create table auth.sessions (id uuid primary key, user_id uuid references auth.users, created_at timestamptz default now(), not_after timestamptz);
create table auth.mfa_factors (id uuid primary key, user_id uuid references auth.users, factor_type text, status text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text not null, owner_id text);
alter table storage.objects enable row level security;
grant select on storage.objects to anon,authenticated;
-- Match the hosted legacy bucket and policies, including its unsafe anonymous upload grant.
insert into storage.buckets(id,name,public) values('public-assets','public-assets',true);
insert into storage.objects(bucket_id,name) values('public-assets','existing-chapter-image.webp');
grant insert on storage.objects to anon,authenticated;
create policy "Allow uploads to public-assets" on storage.objects for insert to public
  with check(bucket_id='public-assets');
create policy "Public Access to public-assets" on storage.objects for select to public
  using(bucket_id='public-assets');
