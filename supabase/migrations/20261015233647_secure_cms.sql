-- Offline-reviewed CMS. Run once through Supabase migrations after release approval.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role, supabase_auth_admin;

create table private.staff (
  email text primary key check (email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email) <= 254),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null check (role in ('owner','editor')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table private.session_activity (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  last_seen timestamptz not null default now()
);
create table private.quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (user_id,action)
);
create table private.content (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('event','article','history','officer','settings','policy')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  title text not null check (length(title) between 1 and 200),
  payload jsonb not null,
  media_ids uuid[] not null default '{}',
  version integer not null default 1 check(version > 0),
  status text not null default 'draft' check (status in ('draft','submitted','published','archived')),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(kind,slug)
);
create table private.content_publications (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references private.content(id),
  kind text not null,
  slug text not null,
  title text not null,
  payload jsonb not null,
  version integer not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  reason text not null,
  unique(content_id,version)
);
create table private.live_content (
  content_id uuid primary key references private.content(id),
  publication_id uuid not null unique references private.content_publications(id),
  kind text not null,
  slug text not null,
  unique(kind,slug)
);
create table private.upload_receipts (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  original_path text not null unique,
  derivative_path text not null unique,
  width integer not null check(width between 1 and 4096),
  height integer not null check(height between 1 and 4096),
  created_at timestamptz not null default now()
);
create table private.media (
  id uuid primary key references private.upload_receipts(id),
  uploaded_by uuid not null references auth.users(id),
  alt text not null,
  caption text not null,
  width integer not null check(width between 1 and 4096),
  height integer not null check(height between 1 and 4096),
  original_path text not null,
  derivative_path text not null,
  public_path text,
  rights_confirmed boolean not null,
  status text not null default 'pending' check(status in ('pending','approved','promoting','ready','revoking')),
  operation_id uuid,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and approved_by is null and approved_at is null and public_path is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null and public_path is null)
    or (status = 'promoting' and approved_by is not null and approved_at is not null and public_path is null)
    or (status in ('ready','revoking') and approved_by is not null and approved_at is not null and public_path = id::text || '.webp')),
  check ((status='promoting') = (operation_id is not null))
);
create table private.content_media (
  content_id uuid not null references private.content(id),
  media_id uuid not null references private.media(id),
  ordinal integer not null,
  primary key(content_id,media_id), unique(content_id,ordinal)
);
create table private.publication_media (
  publication_id uuid not null references private.content_publications(id),
  media_id uuid not null references private.media(id),
  ordinal integer not null,
  primary key(publication_id,media_id), unique(publication_id,ordinal)
);
create table private.finance_drafts (
  term_id text primary key check(term_id ~ '^[0-9]{4}-[AB]$'),
  payload jsonb not null,
  version integer not null check(version > 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table private.finance_publications (
  id uuid primary key default gen_random_uuid(),
  term_id text not null references private.finance_drafts(term_id),
  version integer not null,
  previous_id uuid references private.finance_publications(id),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  reason text not null,
  unique(term_id,version)
);
create table private.finance_terms (
  publication_id uuid primary key references private.finance_publications(id),
  id text not null,
  year integer not null check(year between 1900 and 2200),
  half text not null check(half in ('A','B')),
  opening bigint not null check(opening between 0 and 9000000000000),
  proposed_sponsors bigint not null check(proposed_sponsors between 0 and 9000000000000),
  proposed_fundraising bigint not null check(proposed_fundraising between 0 and 9000000000000),
  check(id = year::text || '-' || half),
  unique(publication_id,id)
);
create table private.finance_projects (
  publication_id uuid not null references private.finance_terms(publication_id),
  id text not null,
  term_id text not null,
  title text not null,
  event_publication_id uuid not null references private.content_publications(id),
  event_slug text not null,
  proposed bigint check(proposed between 0 and 9000000000000),
  notes text not null,
  responsible text not null,
  primary key(publication_id,id),
  foreign key(publication_id,term_id) references private.finance_terms(publication_id,id)
);
create table private.finance_income (
  publication_id uuid not null references private.finance_terms(publication_id),
  id text not null,
  term_id text not null,
  date date not null,
  kind text not null check(kind in ('sponsor','fundraising')),
  description text not null,
  amount bigint not null check(amount between 0 and 9000000000000),
  primary key(publication_id,id),
  foreign key(publication_id,term_id) references private.finance_terms(publication_id,id)
);
create table private.finance_expenses (
  publication_id uuid not null references private.finance_terms(publication_id),
  id text not null,
  project_id text not null,
  date date not null,
  category text not null,
  description text not null,
  amount bigint not null check(amount between 0 and 9000000000000),
  responsible text not null,
  primary key(publication_id,id),
  foreign key(publication_id,project_id) references private.finance_projects(publication_id,id)
);
create table private.live_finance (
  term_id text primary key references private.finance_drafts(term_id),
  publication_id uuid not null unique references private.finance_terms(publication_id)
);
create table private.audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  record_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table private.rebuild_outbox (
  id bigint generated always as identity primary key,
  action text not null check(action in ('publish','archive','finance')),
  record_id text not null,
  status text not null default 'pending' check(status in ('pending','success','failure')),
  detail text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table private.backup_runs (
  id uuid primary key,
  status text not null check(status in ('success','failure')),
  created_at timestamptz not null,
  manifest_id text,
  detail text not null
);

-- There are no client table grants. RLS also denies direct access if grants are added accidentally.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'private' loop
    execute format('alter table private.%I enable row level security',t.tablename);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t.tablename);
  end loop;
end $$;

create function private.validate_finance(p_payload jsonb) returns void language plpgsql set search_path = '' as $$
declare v_term jsonb; v jsonb; k text; v_day date; v_year integer; v_half text; begin
  perform private.object_keys(p_payload,array['term','projects','income','expenses']);
  if octet_length(p_payload::text)>262144 then raise exception 'Report exceeds 256 KiB' using errcode='22023'; end if;
  v_term := p_payload->'term';
  perform private.object_keys(v_term,array['id','year','half','opening','proposedSponsors','proposedFundraising']);
  perform private.text_value(v_term->'id',6,6); perform private.text_value(v_term->'half',1,1);
  if jsonb_typeof(v_term->'year') is distinct from 'number' or (v_term->>'year') !~ '^[0-9]{4}$' then raise exception 'Invalid term year' using errcode='22023'; end if;
  v_year := (v_term->>'year')::integer; v_half := v_term->>'half';
  if v_year not between 1900 and 2200 or v_half not in ('A','B') or v_term->>'id'<>v_year::text||'-'||v_half then raise exception 'Invalid term' using errcode='22023'; end if;
  perform private.money_value(v_term->'opening'); perform private.money_value(v_term->'proposedSponsors'); perform private.money_value(v_term->'proposedFundraising');
  foreach k in array array['projects','income','expenses'] loop
    if jsonb_typeof(p_payload->k) is distinct from 'array' then raise exception 'Invalid report rows' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->k)>(case when k='projects' then 100 else 1000 end) then raise exception 'Too many report rows' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_payload->k) a group by a->>'id' having count(*)>1) then raise exception 'Duplicate report row id' using errcode='22023'; end if;
  end loop;
  for v in select value from jsonb_array_elements(p_payload->'projects') loop
    perform private.object_keys(v,array['id','title','eventSlug','termId','proposed','notes','responsible']);
    perform private.text_value(v->'id',1,100); perform private.text_value(v->'title',1,200);
    perform private.text_value(v->'eventSlug',1,100); perform private.text_value(v->'termId',6,6);
    perform private.text_value(v->'notes',0,5000); perform private.text_value(v->'responsible',1,200);
    if v->>'termId'<>v_term->>'id' or v->>'eventSlug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid project reference' using errcode='22023'; end if;
    if v->'proposed'<>'null'::jsonb then perform private.money_value(v->'proposed'); end if;
  end loop;
  for v in select value from jsonb_array_elements(p_payload->'income') loop
    perform private.object_keys(v,array['id','termId','date','kind','description','amount']);
    perform private.text_value(v->'id',1,100); perform private.text_value(v->'termId',6,6); perform private.text_value(v->'kind',1,30);
    perform private.text_value(v->'description',1,200); perform private.money_value(v->'amount');
    if v->>'termId'<>v_term->>'id' or v->>'kind' not in ('sponsor','fundraising') then raise exception 'Invalid income reference' using errcode='22023'; end if;
    v_day := private.date_value(v->'date');
    if extract(year from v_day)<>v_year or (extract(month from v_day)<=6)<>(v_half='A') then raise exception 'Income date outside term' using errcode='22023'; end if;
  end loop;
  for v in select value from jsonb_array_elements(p_payload->'expenses') loop
    perform private.object_keys(v,array['id','projectId','date','category','description','amount','responsible']);
    perform private.text_value(v->'id',1,100); perform private.text_value(v->'projectId',1,100); perform private.text_value(v->'category',1,200);
    perform private.text_value(v->'description',1,200); perform private.text_value(v->'responsible',1,200); perform private.money_value(v->'amount');
    if not exists(select 1 from jsonb_array_elements(p_payload->'projects') pr where pr->>'id'=v->>'projectId') then raise exception 'Expense project not in term' using errcode='23514'; end if;
    v_day := private.date_value(v->'date');
    if extract(year from v_day)<>v_year or (extract(month from v_day)<=6)<>(v_half='A') then raise exception 'Expense date outside term' using errcode='22023'; end if;
  end loop;
end $$;

create function private.finance_payload(p_publication_id uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'term',jsonb_build_object('id',t.id,'year',t.year,'half',t.half,'opening',t.opening,'proposedSponsors',t.proposed_sponsors,'proposedFundraising',t.proposed_fundraising),
    'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'termId',p.term_id,'title',p.title,'eventSlug',p.event_slug,'proposed',p.proposed,'notes',p.notes,'responsible',p.responsible) order by p.id) from private.finance_projects p where p.publication_id=t.publication_id),'[]'),
    'income',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'termId',i.term_id,'date',i.date,'kind',i.kind,'description',i.description,'amount',i.amount) order by i.date,i.id) from private.finance_income i where i.publication_id=t.publication_id),'[]'),
    'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'projectId',e.project_id,'date',e.date,'category',e.category,'description',e.description,'amount',e.amount,'responsible',e.responsible) order by e.date,e.id) from private.finance_expenses e where e.publication_id=t.publication_id),'[]'))
  from private.finance_terms t where t.publication_id=p_publication_id
$$;
create function private.list_finance() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('payload',f.payload,'version',f.version,'status',case when lf.publication_id is null then 'draft'
    when fp.version=f.version then 'published' else 'draft' end,'updated_at',f.updated_at,
    'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'previous_id',p.previous_id,'published_at',p.published_at,'reason',p.reason,'payload',private.finance_payload(p.id)) order by p.version desc)
      from private.finance_publications p where p.term_id=f.term_id),'[]')) order by f.term_id desc)
    from private.finance_drafts f left join private.live_finance lf on lf.term_id=f.term_id left join private.finance_publications fp on fp.id=lf.publication_id),'[]'));
end $$;
create function private.save_finance(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(); v_id text; v_row private.finance_drafts; begin
  perform private.rate_limit('finance'); perform private.validate_finance(p_payload); v_id := p_payload->'term'->>'id';
  -- Serialize new-ID upserts as well as updates, so a missing draft cannot bypass expectedVersion.
  perform pg_advisory_xact_lock(843020);
  select * into v_row from private.finance_drafts where term_id=v_id for update;
  if found then
    if p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='40001'; end if;
    update private.finance_drafts set payload=p_payload,version=version+1,updated_by=v_uid,updated_at=now() where term_id=v_id returning * into v_row;
  else
    if p_expected_version is not null then raise exception 'Version conflict' using errcode='40001'; end if;
    insert into private.finance_drafts(term_id,payload,version,updated_by) values(v_id,p_payload,1,v_uid) returning * into v_row;
  end if;
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'finance.save',v_id,jsonb_build_object('version',v_row.version));
  return jsonb_build_object('payload',v_row.payload,'version',v_row.version,'status','draft','updated_at',v_row.updated_at);
end $$;
create function private.finance_closing(p_id uuid) returns bigint language sql stable set search_path = '' as $$
  select t.opening+coalesce((select sum(i.amount) from private.finance_income i where i.publication_id=t.publication_id),0)
    -coalesce((select sum(e.amount) from private.finance_expenses e where e.publication_id=t.publication_id),0)
  from private.finance_terms t where t.publication_id=p_id
$$;
create function private.publish_finance(p_term_id text,p_expected_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(true,true,true); v_row private.finance_drafts; v_pub uuid; v_previous uuid;
  v_term jsonb; v jsonb; v_event uuid; v_closing bigint; v_before uuid; v_after uuid; v_order integer;
begin
  perform private.rate_limit('finance'); perform private.text_value(to_jsonb(p_reason),5,1000);
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.finance_drafts where term_id=p_term_id for update;
  if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='40001'; end if;
  perform private.validate_finance(v_row.payload); v_term := v_row.payload->'term';
  select publication_id into v_previous from private.live_finance where term_id=p_term_id;
  if exists(select 1 from private.finance_publications where term_id=p_term_id and version=v_row.version) then raise exception 'Already published' using errcode='40001'; end if;
  v_order := (v_term->>'year')::integer*2+case v_term->>'half' when 'A' then 0 else 1 end;
  select lf.publication_id into v_before from private.live_finance lf join private.finance_terms t on t.publication_id=lf.publication_id
    where t.year*2+case t.half when 'A' then 0 else 1 end<v_order order by t.year desc,t.half desc limit 1;
  select lf.publication_id into v_after from private.live_finance lf join private.finance_terms t on t.publication_id=lf.publication_id
    where t.year*2+case t.half when 'A' then 0 else 1 end>v_order order by t.year,t.half limit 1;
  -- Every adjacent published term must agree, including older-report corrections and backfills.
  if v_before is not null and private.finance_closing(v_before)<>(v_term->>'opening')::bigint then raise exception 'Opening balance differs from previous closing balance' using errcode='23514'; end if;
  v_closing := (v_term->>'opening')::bigint
    +coalesce((select sum((i->>'amount')::bigint) from jsonb_array_elements(v_row.payload->'income') i),0)
    -coalesce((select sum((e->>'amount')::bigint) from jsonb_array_elements(v_row.payload->'expenses') e),0);
  if v_closing<0 or v_closing>9000000000000 then raise exception 'Invalid closing balance' using errcode='23514'; end if;
  if v_after is not null and v_closing<>(select opening from private.finance_terms where publication_id=v_after) then raise exception 'Correction would break next term carryover' using errcode='23514'; end if;
  insert into private.finance_publications(term_id,version,previous_id,published_by,reason) values(p_term_id,v_row.version,v_previous,v_uid,p_reason) returning id into v_pub;
  insert into private.finance_terms(publication_id,id,year,half,opening,proposed_sponsors,proposed_fundraising)
    values(v_pub,p_term_id,(v_term->>'year')::integer,v_term->>'half',(v_term->>'opening')::bigint,(v_term->>'proposedSponsors')::bigint,(v_term->>'proposedFundraising')::bigint);
  for v in select value from jsonb_array_elements(v_row.payload->'projects') loop
    select cp.id into v_event from private.live_content lc join private.content_publications cp on cp.id=lc.publication_id
      where lc.kind='event' and lc.slug=v->>'eventSlug' and cp.payload->>'termId'=p_term_id;
    if v_event is null then raise exception 'Project requires a published event in this term' using errcode='23514'; end if;
    insert into private.finance_projects(publication_id,id,term_id,title,event_publication_id,event_slug,proposed,notes,responsible)
      values(v_pub,v->>'id',p_term_id,v->>'title',v_event,v->>'eventSlug',(v->>'proposed')::bigint,v->>'notes',v->>'responsible');
  end loop;
  insert into private.finance_income(publication_id,id,term_id,date,kind,description,amount)
    select v_pub,i->>'id',p_term_id,(i->>'date')::date,i->>'kind',i->>'description',(i->>'amount')::bigint from jsonb_array_elements(v_row.payload->'income') i;
  insert into private.finance_expenses(publication_id,id,project_id,date,category,description,amount,responsible)
    select v_pub,e->>'id',e->>'projectId',(e->>'date')::date,e->>'category',e->>'description',(e->>'amount')::bigint,e->>'responsible' from jsonb_array_elements(v_row.payload->'expenses') e;
  insert into private.live_finance(term_id,publication_id) values(p_term_id,v_pub) on conflict(term_id) do update set publication_id=excluded.publication_id;
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'finance.publish',p_term_id,jsonb_build_object('version',v_row.version,'publication_id',v_pub,'previous_id',v_previous,'reason',p_reason));
  insert into private.rebuild_outbox(action,record_id) values('finance',p_term_id);
  return jsonb_build_object('id',v_pub,'version',v_row.version,'status','published','previous_id',v_previous,'payload',private.finance_payload(v_pub));
end $$;

create function private.require_staff(p_aal2 boolean default true,p_owner boolean default false,p_recent boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_claims jsonb := auth.jwt(); v_uid uuid := auth.uid(); v_sid uuid;
  v_role text; v_started timestamptz; v_seen timestamptz; v_totp numeric;
begin
  if v_uid is null or coalesce(v_claims->>'is_anonymous','false') <> 'false' then
    raise exception 'Staff authentication required' using errcode='42501';
  end if;
  if coalesce((v_claims->>'exp') ~ '^[0-9]+$',false) is not true then
    raise exception 'Invalid access token expiry' using errcode='42501';
  end if;
  if (v_claims->>'exp')::numeric <= extract(epoch from now()) then
    raise exception 'Access token expired' using errcode='42501';
  end if;
  begin v_sid := (v_claims->>'session_id')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid session' using errcode='42501'; end;
  select s.role into v_role from private.staff s join auth.users u on u.id=v_uid
  where s.email=lower(u.email) and s.active and (s.user_id is null or s.user_id=v_uid)
    and u.email_confirmed_at is not null and u.raw_app_meta_data->>'provider'='google';
  if v_role is null or (p_owner and v_role <> 'owner') then
    raise exception 'Active staff membership required' using errcode='42501';
  end if;
  select s.created_at into v_started from auth.sessions s
  where s.id=v_sid and s.user_id=v_uid and (s.not_after is null or s.not_after>now());
  if v_started is null or v_started < now()-interval '8 hours' then
    raise exception 'Session expired or revoked' using errcode='42501';
  end if;
  select last_seen into v_seen from private.session_activity where session_id=v_sid for update;
  if coalesce(v_seen,v_started) < now()-interval '30 minutes' then
    raise exception 'Session idle timeout' using errcode='42501';
  end if;
  if p_aal2 and (v_claims->>'aal' is distinct from 'aal2' or not exists(
    select 1 from auth.mfa_factors f where f.user_id=v_uid and f.factor_type='totp' and f.status='verified')) then
    raise exception 'Verified TOTP required' using errcode='42501';
  end if;
  if p_recent then
    select max((a->>'timestamp')::numeric) into v_totp from jsonb_array_elements(coalesce(v_claims->'amr','[]')) a
    where a->>'method'='totp' and (a->>'timestamp') ~ '^[0-9]+(\.[0-9]+)?$';
    if v_totp is null or v_totp < extract(epoch from now()-interval '5 minutes')
      or v_totp > extract(epoch from now()+interval '30 seconds') then
      raise exception 'Recent TOTP verification required' using errcode='42501';
    end if;
  end if;
  update private.staff set user_id=v_uid where email=(select lower(email) from auth.users where id=v_uid) and user_id is null;
  insert into private.session_activity(session_id,user_id,last_seen) values(v_sid,v_uid,now())
    on conflict(session_id) do update set last_seen=excluded.last_seen;
  return v_uid;
end $$;

create function private.rate_limit(p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(); v_limit integer; v_count integer;
begin
  v_limit := case p_action when 'save' then 60 when 'transition' then 20 when 'finance' then 30
    when 'staff' then 10 when 'upload' then 20 when 'media_register' then 60 when 'media_approve' then 20 else null end;
  if v_limit is null then raise exception 'Unknown quota action' using errcode='22023'; end if;
  insert into private.quotas(user_id,action,window_start,count) values(v_uid,p_action,now(),1)
  on conflict(user_id,action) do update set
    count=case when private.quotas.window_start<=now()-interval '1 minute' then 1 else private.quotas.count+1 end,
    window_start=case when private.quotas.window_start<=now()-interval '1 minute' then now() else private.quotas.window_start end
  returning count into v_count;
  if v_count>v_limit then raise exception 'Rate limit exceeded' using errcode='P0001'; end if;
end $$;

create function private.object_keys(p_value jsonb,p_required text[],p_optional text[] default '{}') returns void
language plpgsql set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value)<>'object'
    or not (p_value ?& p_required) or exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_required||p_optional)) then
    raise exception 'Invalid object fields' using errcode='22023';
  end if;
end $$;
create function private.text_value(p_value jsonb,p_min integer default 1,p_max integer default 2000) returns void
language plpgsql set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value)<>'string' or length(trim(p_value#>>'{}'))<p_min
    or length(p_value#>>'{}')>p_max or (p_value#>>'{}') ~ '[<>\x00-\x08\x0B\x0C\x0E-\x1F]' then
    raise exception 'Invalid plain text' using errcode='22023';
  end if;
end $$;
create function private.text_array(p_value jsonb,p_min integer default 0,p_max integer default 80) returns void
language plpgsql set search_path = '' as $$
declare v jsonb; begin
  if p_value is null or jsonb_typeof(p_value)<>'array' then raise exception 'Expected text array' using errcode='22023'; end if;
  if jsonb_array_length(p_value) not between p_min and p_max then raise exception 'Invalid text array length' using errcode='22023'; end if;
  for v in select value from jsonb_array_elements(p_value) loop perform private.text_value(v,1,5000); end loop;
end $$;
create function private.date_value(p_value jsonb) returns date language plpgsql set search_path = '' as $$
declare v date; begin
  if p_value is null or jsonb_typeof(p_value)<>'string' or (p_value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid ISO date' using errcode='22023'; end if;
  begin v := (p_value#>>'{}')::date;
  exception when others then raise exception 'Invalid ISO date' using errcode='22023'; end;
  if v < date '1900-01-01' or v > date '2200-12-31' then raise exception 'Date out of range' using errcode='22023'; end if;
  return v;
end $$;
create function private.money_value(p_value jsonb) returns bigint language plpgsql set search_path = '' as $$
declare v numeric; begin
  if p_value is null or jsonb_typeof(p_value)<>'number' then raise exception 'Expected integer centavos' using errcode='22023'; end if;
  v := (p_value#>>'{}')::numeric;
  if v<>trunc(v) or v not between 0 and 9000000000000 then raise exception 'Invalid centavos' using errcode='22023'; end if;
  return v::bigint;
end $$;
create function private.validate_content(p_kind text,p_slug text,p_title text,p_payload jsonb) returns void
language plpgsql set search_path = '' as $$
declare v jsonb; k text; begin
  if p_kind is null or p_kind not in ('event','article','history','officer','settings','policy')
    or p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug)>100
    or p_title is null or octet_length(p_payload::text)>262144 then raise exception 'Invalid content or payload exceeds 256 KiB' using errcode='22023'; end if;
  perform private.text_value(to_jsonb(p_title),1,200);
  case p_kind
  when 'event' then
    perform private.object_keys(p_payload,array['iso','time','place','state','termId','host','lead','summary','sections']);
    perform private.date_value(p_payload->'iso');
    perform private.text_value(p_payload->'time',1,80); perform private.text_value(p_payload->'place',1,300);
    perform private.text_value(p_payload->'host',1,200); perform private.text_value(p_payload->'lead',1,200);
    perform private.text_value(p_payload->'summary',1,1500); perform private.text_value(p_payload->'termId',6,6);
    perform private.text_value(p_payload->'state',1,20);
    if p_payload->>'state' not in ('planned','completed') or p_payload->>'termId' !~ '^[0-9]{4}-[AB]$'
      or jsonb_typeof(p_payload->'sections') is distinct from 'array' then raise exception 'Invalid event' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'sections')>20 then raise exception 'Too many sections' using errcode='22023'; end if;
    for v in select value from jsonb_array_elements(p_payload->'sections') loop
      perform private.object_keys(v,array['id','title','paragraphs']);
      perform private.text_value(v->'id',1,100); perform private.text_value(v->'title',1,200); perform private.text_array(v->'paragraphs',1,80);
      if v->>'id' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid section id' using errcode='22023'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(p_payload->'sections') s group by s->>'id' having count(*)>1) then
      raise exception 'Duplicate section id' using errcode='22023'; end if;
  when 'article' then
    perform private.object_keys(p_payload,array['date','kicker','excerpt','body']);
    perform private.date_value(p_payload->'date'); perform private.text_value(p_payload->'kicker',1,200);
    perform private.text_value(p_payload->'excerpt',1,1500); perform private.text_array(p_payload->'body',1);
  when 'history' then
    perform private.object_keys(p_payload,array['year','label','snippet','body']);
    perform private.text_value(p_payload->'year',1,20); perform private.text_value(p_payload->'label',1,200); perform private.text_value(p_payload->'snippet',1,1500);
    perform private.text_array(p_payload->'body');
  when 'officer' then
    perform private.object_keys(p_payload,array['name','termId','eventSlug','summary','lesson']);
    perform private.text_value(p_payload->'name',1,200); perform private.text_value(p_payload->'termId',6,6); perform private.text_value(p_payload->'eventSlug',1,100);
    perform private.text_value(p_payload->'summary',1,5000); perform private.text_value(p_payload->'lesson',1,5000);
    if p_payload->>'termId' !~ '^[0-9]{4}-[AB]$' or p_payload->>'eventSlug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'Invalid officer references' using errcode='22023'; end if;
  else
    perform private.object_keys(p_payload,array['body']); perform private.text_array(p_payload->'body',1);
    if (p_kind='settings' and p_slug not in ('chapter','contact','home','history-intro'))
      or (p_kind='policy' and p_slug not in ('privacy','cookies','terms')) then raise exception 'Reserved slug required' using errcode='22023'; end if;
  end case;
end $$;

create function private.session() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(false); v_result jsonb; begin
  select jsonb_build_object('id',v_uid,'email',s.email,'role',s.role,'active',s.active,'aal',auth.jwt()->>'aal') into v_result
    from private.staff s where s.user_id=v_uid;
  return v_result;
end $$;
create function private.list_content(p_kind text,p_query text,p_page integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_total integer; v_items jsonb; begin
  perform private.require_staff();
  if p_kind is not null and p_kind not in ('event','article','history','officer','settings','policy') then raise exception 'Invalid kind' using errcode='22023'; end if;
  if p_page is null or p_page not between 1 and 10000 or length(coalesce(p_query,''))>200 then raise exception 'Invalid pagination' using errcode='22023'; end if;
  select count(*) into v_total from private.content c where (p_kind is null or c.kind=p_kind) and (coalesce(p_query,'')='' or position(lower(p_query) in lower(c.title||' '||c.slug))>0);
  select coalesce(jsonb_agg(to_jsonb(c)-'updated_by'),'[]') into v_items from (
    select * from private.content c where (p_kind is null or c.kind=p_kind) and (coalesce(p_query,'')='' or position(lower(p_query) in lower(c.title||' '||c.slug))>0)
    order by updated_at desc,id limit 20 offset (p_page-1)*20) c;
  return jsonb_build_object('items',v_items,'total',v_total);
end $$;
create function private.get_content(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; begin
  perform private.require_staff();
  select to_jsonb(c)-'updated_by' into v_result from private.content c where id=p_id;
  if v_result is null then raise exception 'Unknown content' using errcode='22023'; end if;
  return v_result;
end $$;
create function private.save_content(p_id uuid,p_kind text,p_slug text,p_title text,p_payload jsonb,p_media_ids uuid[],p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(); v_row private.content; begin
  perform private.rate_limit('save'); perform private.validate_content(p_kind,p_slug,p_title,p_payload);
  if p_media_ids is null or cardinality(p_media_ids)>20 or cardinality(p_media_ids)<>(select count(distinct x) from unnest(p_media_ids) x)
    or exists(select 1 from unnest(p_media_ids) x where x is null or not exists(select 1 from private.media m where m.id=x)) then
    raise exception 'Invalid registered media' using errcode='22023'; end if;
  if p_id is null then
    if p_expected_version is not null then raise exception 'Unexpected version' using errcode='40001'; end if;
    insert into private.content(kind,slug,title,payload,media_ids,updated_by) values(p_kind,p_slug,p_title,p_payload,p_media_ids,v_uid) returning * into v_row;
  else
    select * into v_row from private.content where id=p_id for update;
    if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='40001'; end if;
    if v_row.kind<>p_kind then raise exception 'Content kind cannot change' using errcode='22023'; end if;
    -- Published URL identities remain stable for linked reports and existing links.
    if exists(select 1 from private.content_publications where content_id=p_id) and v_row.slug<>p_slug then raise exception 'Published slug cannot change' using errcode='22023'; end if;
    update private.content set slug=p_slug,title=p_title,payload=p_payload,media_ids=p_media_ids,status='draft',version=version+1,updated_at=now(),updated_by=v_uid where id=p_id returning * into v_row;
  end if;
  delete from private.content_media where content_id=v_row.id;
  insert into private.content_media(content_id,media_id,ordinal) select v_row.id,m,ordinality from unnest(p_media_ids) with ordinality as ids(m,ordinality);
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'content.save',v_row.id::text,jsonb_build_object('version',v_row.version));
  return to_jsonb(v_row)-'updated_by';
end $$;
create function private.transition_content(p_id uuid,p_expected_version integer,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_row private.content; v_pub uuid; begin
  v_uid := private.require_staff(true,p_action in ('publish','archive'),p_action in ('publish','archive'));
  perform private.rate_limit('transition');
  if p_action is null or p_action not in ('submit','publish','archive') then raise exception 'Invalid action' using errcode='22023'; end if;
  perform private.text_value(to_jsonb(p_reason),case when p_action='submit' then 0 else 5 end,1000);
  -- Serialize publication/archive with finance approval to avoid linked-event races.
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.content where id=p_id for update;
  if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='40001'; end if;
  if (p_action='submit' and v_row.status<>'draft') or (p_action='publish' and v_row.status<>'submitted')
    or (p_action='archive' and v_row.status='archived') then raise exception 'Invalid transition' using errcode='22023'; end if;
  if p_action='publish' then
    perform private.validate_content(v_row.kind,v_row.slug,v_row.title,v_row.payload);
    if exists(select 1 from private.content_media cm join private.media m on m.id=cm.media_id where cm.content_id=p_id and (m.status<>'ready' or not m.rights_confirmed)) then
      raise exception 'Referenced media is not approved and promoted' using errcode='23514'; end if;
    if v_row.kind='event' and exists(select 1 from private.finance_projects fp join private.live_finance lf on lf.publication_id=fp.publication_id
      where fp.event_slug=v_row.slug and fp.term_id<>v_row.payload->>'termId') then raise exception 'Event term conflicts with live finance' using errcode='23514'; end if;
    if v_row.kind='event' and exists(select 1 from private.live_content lc join private.content_publications cp on cp.id=lc.publication_id
      where lc.kind='officer' and cp.payload->>'eventSlug'=v_row.slug and cp.payload->>'termId'<>v_row.payload->>'termId') then raise exception 'Event term conflicts with live officer' using errcode='23514'; end if;
    if v_row.kind='officer' and not exists(select 1 from private.live_content lc join private.content_publications cp on cp.id=lc.publication_id
      where lc.kind='event' and lc.slug=v_row.payload->>'eventSlug' and cp.payload->>'termId'=v_row.payload->>'termId') then raise exception 'Officer event reference is not live' using errcode='23514'; end if;
    insert into private.content_publications(content_id,kind,slug,title,payload,version,published_by,reason)
      values(p_id,v_row.kind,v_row.slug,v_row.title,v_row.payload,v_row.version+1,v_uid,p_reason) returning id into v_pub;
    insert into private.publication_media(publication_id,media_id,ordinal) select v_pub,media_id,ordinal from private.content_media where content_id=p_id;
    insert into private.live_content(content_id,publication_id,kind,slug) values(p_id,v_pub,v_row.kind,v_row.slug)
      on conflict(content_id) do update set publication_id=excluded.publication_id;
  elsif p_action='archive' then
    if v_row.kind='event' and (exists(select 1 from private.finance_projects fp join private.live_finance lf on lf.publication_id=fp.publication_id where fp.event_slug=v_row.slug)
      or exists(select 1 from private.live_content lc join private.content_publications cp on cp.id=lc.publication_id where lc.kind='officer' and cp.payload->>'eventSlug'=v_row.slug)) then
      raise exception 'Live records still reference this event' using errcode='23514'; end if;
    delete from private.live_content where content_id=p_id;
  end if;
  update private.content set status=case p_action when 'submit' then 'submitted' when 'publish' then 'published' else 'archived' end,
    version=version+1,updated_by=v_uid,updated_at=now() where id=p_id returning * into v_row;
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'content.'||p_action,p_id::text,jsonb_build_object('version',v_row.version,'reason',p_reason));
  if p_action<>'submit' then insert into private.rebuild_outbox(action,record_id) values(p_action,p_id::text); end if;
  return to_jsonb(v_row)-'updated_by';
end $$;

create function private.list_staff() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff(true,true,true);
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by s.email) from private.staff s),'[]'));
end $$;
create function private.save_staff(p_email text,p_role text,p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(true,true,true); v_email text := lower(trim(p_email)); v_row private.staff; begin
  perform private.rate_limit('staff');
  if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null or p_role not in ('owner','editor') or p_active is null then raise exception 'Invalid staff details' using errcode='22023'; end if;
  -- Serialize owner changes; row locks alone cannot protect the count across different owners.
  perform pg_advisory_xact_lock(843021);
  select * into v_row from private.staff where email=v_email for update;
  if found and v_row.role='owner' and v_row.active and (not p_active or p_role<>'owner')
    and (select count(*) from private.staff where role='owner' and active)<=1 then raise exception 'Cannot remove last active owner' using errcode='23514'; end if;
  insert into private.staff(email,user_id,role,active) values(v_email,(select id from auth.users where lower(email)=v_email),p_role,p_active)
    on conflict(email) do update set role=excluded.role,active=excluded.active,updated_at=now() returning * into v_row;
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'staff.save',v_email,jsonb_build_object('role',p_role,'active',p_active));
  return to_jsonb(v_row);
end $$;
create function private.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if event->'user'->'app_metadata'->>'provider' is distinct from 'google'
    or coalesce((event->'user'->>'is_anonymous')::boolean,true)
    or not exists(select 1 from private.staff s where s.email=lower(event->'user'->>'email') and s.active) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Only invited Google accounts can sign in.'));
  end if;
  return '{}'::jsonb;
end $$;

create function private.list_media() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m)-'uploaded_by'-'approved_by' order by m.created_at desc,m.id) from private.media m),'[]'));
end $$;
create function private.media_upload_ready(p_id uuid,p_user_id uuid,p_original_path text,p_derivative_path text,p_width integer,p_height integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.upload_receipts; begin
  if p_id is null or p_user_id is null or p_original_path is null or p_derivative_path is null
    or p_original_path<>p_user_id::text||'/'||p_id::text||'.original'
    or p_derivative_path<>p_id::text||'.webp' or p_width is null or p_height is null
    or p_width not between 1 and 4096 or p_height not between 1 and 4096
    or p_width::bigint*p_height>16000000
    or not exists(select 1 from private.staff s join auth.users u on u.id=p_user_id where s.email=lower(u.email) and s.active)
    or not exists(select 1 from storage.objects where bucket_id='cms-originals' and name=p_original_path)
    or not exists(select 1 from storage.objects where bucket_id='cms-derivatives' and name=p_derivative_path) then raise exception 'Invalid processed upload receipt' using errcode='22023'; end if;
  insert into private.upload_receipts(id,user_id,original_path,derivative_path,width,height)
    values(p_id,p_user_id,p_original_path,p_derivative_path,p_width,p_height) returning * into v_row;
  insert into private.audit(actor_id,action,record_id) values(p_user_id,'media.processed',p_id::text);
  return to_jsonb(v_row);
end $$;
create function private.register_media(p_id uuid,p_original_path text,p_derivative_path text,p_width integer,p_height integer,p_alt text,p_caption text,p_rights_confirmed boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(); v_receipt private.upload_receipts; v_row private.media; begin
  perform private.rate_limit('media_register'); perform private.text_value(to_jsonb(p_alt),1,500); perform private.text_value(to_jsonb(p_caption),0,1000);
  if p_rights_confirmed is distinct from true then raise exception 'Confirm media rights before registering' using errcode='22023'; end if;
  select * into v_receipt from private.upload_receipts where id=p_id and user_id=v_uid and created_at>now()-interval '1 hour';
  if not found or p_original_path is distinct from v_receipt.original_path or p_derivative_path is distinct from v_receipt.derivative_path
    or p_width is distinct from v_receipt.width or p_height is distinct from v_receipt.height then raise exception 'Validated upload receipt required' using errcode='23514'; end if;
  insert into private.media(id,uploaded_by,alt,caption,width,height,original_path,derivative_path,rights_confirmed)
    values(p_id,v_uid,p_alt,p_caption,p_width,p_height,p_original_path,p_derivative_path,p_rights_confirmed) returning * into v_row;
  insert into private.audit(actor_id,action,record_id) values(v_uid,'media.register',p_id::text);
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;
create function private.approve_media(p_ids uuid[],p_content_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(true,true,true); v_row private.content; begin
  perform private.rate_limit('media_approve');
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.content where id=p_content_id for update;
  if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='40001'; end if;
  if v_row.status<>'submitted' or p_ids is null or cardinality(p_ids)>20
    or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x)
    or not p_ids @> v_row.media_ids or not p_ids <@ v_row.media_ids
    or exists(select 1 from unnest(p_ids) x where x is null or not exists(select 1 from private.media m where m.id=x and m.rights_confirmed)) then
    raise exception 'Approval must match submitted revision media' using errcode='23514'; end if;
  if exists(select 1 from private.media where id=any(p_ids) and status in ('promoting','revoking')) then
    raise exception 'Media operation in progress' using errcode='40001'; end if;
  update private.media set status='approved',approved_by=v_uid,approved_at=now() where id=any(p_ids) and status='pending';
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'media.approve',p_content_id::text,jsonb_build_object('version',p_expected_version,'media_ids',p_ids));
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m)-'uploaded_by'-'approved_by' order by m.id) from private.media m where id=any(p_ids)),'[]'));
end $$;
create function private.begin_promote_media(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.media where id=p_id for update;
  if not found or v_row.status not in ('approved','ready') then
    raise exception 'Media unavailable for promotion' using errcode='40001'; end if;
  if v_row.status='approved' then
    update private.media set status='promoting',operation_id=gen_random_uuid() where id=p_id returning * into v_row;
  end if;
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;
create function private.promote_media(p_id uuid,p_public_path text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  if p_id is null or p_public_path is distinct from p_id::text||'.webp'
    or not exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_public_path) then raise exception 'Invalid promoted object' using errcode='22023'; end if;
  update private.media set public_path=p_public_path,status='ready',operation_id=null
    where id=p_id and status='promoting' and operation_id=p_operation_id and rights_confirmed returning * into v_row;
  if not found then raise exception 'Promotion lease does not match' using errcode='40001'; end if;
  insert into private.audit(action,record_id) values('media.promote',p_id::text);
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;
create function private.cancel_promote_media(p_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  -- The trusted caller must confirm public-object cleanup before releasing a lease.
  if exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_id::text||'.webp') then
    raise exception 'Public object cleanup required' using errcode='23514'; end if;
  update private.media set status='approved',operation_id=null where id=p_id and status='promoting'
    and operation_id=p_operation_id returning * into v_row;
  if not found then raise exception 'Promotion lease does not match' using errcode='40001'; end if;
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;
create function private.retire_media(p_content_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(true,true,true); v_ids uuid[]; begin
  perform private.rate_limit('media_approve');
  perform pg_advisory_xact_lock(843019);
  if not exists(select 1 from private.content where id=p_content_id and status='archived') then
    raise exception 'Archived content required' using errcode='23514'; end if;
  select array_agg(distinct media_id) into v_ids from (
    select cm.media_id from private.content_media cm where cm.content_id=p_content_id
    union select pm.media_id from private.publication_media pm join private.content_publications cp
      on cp.id=pm.publication_id where cp.content_id=p_content_id) related;
  if exists(select 1 from private.media where id=any(v_ids) and status='promoting') then
    raise exception 'Media promotion in progress' using errcode='40001'; end if;
  update private.media m set status='revoking',public_path=m.id::text||'.webp'
    where m.id=any(v_ids) and m.status in ('approved','ready','revoking')
    and not exists(select 1 from private.publication_media pm join private.live_content lc
      on lc.publication_id=pm.publication_id where pm.media_id=m.id);
  insert into private.audit(actor_id,action,record_id) values(v_uid,'media.retire',p_content_id::text);
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m)-'uploaded_by'-'approved_by' order by m.id)
    from private.media m where m.id=any(v_ids) and m.status='revoking'),'[]'));
end $$;
create function private.media_retired(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  if exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_id::text||'.webp') then
    raise exception 'Public object cleanup required' using errcode='23514'; end if;
  update private.media set status='pending',public_path=null,approved_by=null,approved_at=null
    where id=p_id and status='revoking' returning * into v_row;
  if not found then raise exception 'Retirement state conflict' using errcode='40001'; end if;
  insert into private.audit(action,record_id) values('media.retired',p_id::text);
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

create function private.public_snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'revision',coalesce((select max(id) from private.rebuild_outbox),0),
    'content',coalesce((select jsonb_agg(jsonb_build_object('id',cp.content_id,'kind',cp.kind,'slug',cp.slug,'title',cp.title,'payload',cp.payload,
      'media_ids',coalesce((select jsonb_agg(pm.media_id order by pm.ordinal) from private.publication_media pm where pm.publication_id=cp.id),'[]')) order by cp.kind,cp.slug)
      from private.live_content lc join private.content_publications cp on cp.id=lc.publication_id),'[]'),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'alt',m.alt,'caption',m.caption,'width',m.width,'height',m.height,'public_path',m.public_path) order by m.id)
      from private.media m where m.status='ready' and m.rights_confirmed and exists(select 1 from private.publication_media pm join private.live_content lc on lc.publication_id=pm.publication_id where pm.media_id=m.id)),'[]'),
    'finance',coalesce((select jsonb_agg(private.finance_payload(lf.publication_id) order by lf.term_id) from private.live_finance lf),'[]'))
$$;
create function private.backup_status() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff(true,true,false);
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from (select * from private.backup_runs order by created_at desc limit 30) b),'[]'),
    'rebuilds',coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from (select * from private.rebuild_outbox order by id desc limit 30) r),'[]'));
end $$;
create function private.record_backup(p_id uuid,p_status text,p_created_at timestamptz,p_manifest_id text,p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_status is null or p_status not in ('success','failure') or p_created_at is null
    or p_created_at>now()+interval '5 minutes' or p_created_at<now()-interval '30 days'
    or (p_status='success' and (p_manifest_id is null or p_manifest_id !~ '^[A-Za-z0-9_-]{1,200}$'))
    or (p_manifest_id is not null and p_manifest_id !~ '^[A-Za-z0-9_-]{1,200}$') then raise exception 'Invalid backup result' using errcode='22023'; end if;
  perform private.text_value(to_jsonb(p_detail),0,1000);
  insert into private.backup_runs values(p_id,p_status,p_created_at,p_manifest_id,p_detail);
end $$;
create function private.rebuild_pending() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from private.rebuild_outbox where status in ('pending','failure') order by id limit 100) r),'[]'))
$$;
create function private.record_rebuild(p_id bigint,p_status text,p_detail text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('success','failure') then raise exception 'Invalid rebuild result' using errcode='22023'; end if;
  perform private.text_value(to_jsonb(p_detail),0,1000);
  update private.rebuild_outbox set status=p_status,detail=p_detail,completed_at=now() where id=p_id and status<>'success';
  if not found then raise exception 'Unknown or completed rebuild' using errcode='22023'; end if;
  insert into private.audit(action,record_id,detail) values('rebuild.result',p_id::text,jsonb_build_object('status',p_status,'detail',p_detail));
end $$;

-- Exposed entrypoints are invokers. Only the explicitly granted private implementations elevate privileges.
create function public.cms_session() returns jsonb language sql security invoker set search_path='' as $$ select private.session() $$;
create function public.cms_list(p_kind text default null,p_query text default '',p_page integer default 1) returns jsonb language sql security invoker set search_path='' as $$ select private.list_content(p_kind,p_query,p_page) $$;
create function public.cms_content_get(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.get_content(p_id) $$;
create function public.cms_save(p_id uuid,p_kind text,p_slug text,p_title text,p_payload jsonb,p_media_ids uuid[],p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.save_content(p_id,p_kind,p_slug,p_title,p_payload,p_media_ids,p_expected_version) $$;
create function public.cms_transition(p_id uuid,p_expected_version integer,p_action text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select private.transition_content(p_id,p_expected_version,p_action,p_reason) $$;
create function public.cms_public_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select private.public_snapshot() $$;
create function public.cms_finance_list() returns jsonb language sql security invoker set search_path='' as $$ select private.list_finance() $$;
create function public.cms_finance_save(p_payload jsonb,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.save_finance(p_payload,p_expected_version) $$;
create function public.cms_finance_publish(p_term_id text,p_expected_version integer,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select private.publish_finance(p_term_id,p_expected_version,p_reason) $$;
create function public.cms_staff_list() returns jsonb language sql security invoker set search_path='' as $$ select private.list_staff() $$;
create function public.cms_staff_save(p_email text,p_role text,p_active boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.save_staff(p_email,p_role,p_active) $$;
create function public.cms_media_list() returns jsonb language sql security invoker set search_path='' as $$ select private.list_media() $$;
create function public.cms_media_register(p_id uuid,p_original_path text,p_derivative_path text,p_width integer,p_height integer,p_alt text,p_caption text,p_rights_confirmed boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.register_media(p_id,p_original_path,p_derivative_path,p_width,p_height,p_alt,p_caption,p_rights_confirmed) $$;
create function public.cms_media_approve(p_ids uuid[],p_content_id uuid,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.approve_media(p_ids,p_content_id,p_expected_version) $$;
create function public.cms_backup_status() returns jsonb language sql security invoker set search_path='' as $$ select private.backup_status() $$;
create function public.cms_rate_limit(p_action text) returns void language sql security invoker set search_path='' as $$ select private.rate_limit(p_action) $$;
create function public.cms_media_upload_ready(p_id uuid,p_user_id uuid,p_original_path text,p_derivative_path text,p_width integer,p_height integer) returns jsonb language sql security invoker set search_path='' as $$ select private.media_upload_ready(p_id,p_user_id,p_original_path,p_derivative_path,p_width,p_height) $$;
create function public.cms_media_begin_promote(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.begin_promote_media(p_id) $$;
create function public.cms_media_promote(p_id uuid,p_public_path text,p_operation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.promote_media(p_id,p_public_path,p_operation_id) $$;
create function public.cms_media_cancel_promote(p_id uuid,p_operation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.cancel_promote_media(p_id,p_operation_id) $$;
create function public.cms_media_retire(p_content_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.retire_media(p_content_id) $$;
create function public.cms_media_retired(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.media_retired(p_id) $$;
create function public.cms_record_backup(p_id uuid,p_status text,p_created_at timestamptz,p_manifest_id text,p_detail text) returns void language sql security invoker set search_path='' as $$ select private.record_backup(p_id,p_status,p_created_at,p_manifest_id,p_detail) $$;
create function public.cms_rebuild_pending() returns jsonb language sql security invoker set search_path='' as $$ select private.rebuild_pending() $$;
create function public.cms_record_rebuild(p_id bigint,p_status text,p_detail text) returns void language sql security invoker set search_path='' as $$ select private.record_rebuild(p_id,p_status,p_detail) $$;

-- Default PUBLIC execute is unsafe even for internal helper functions.
revoke execute on all functions in schema private from public,anon,authenticated,service_role,supabase_auth_admin;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cms\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('cms_media_upload_ready','cms_media_begin_promote','cms_media_promote','cms_media_cancel_promote','cms_media_retired','cms_record_backup','cms_rebuild_pending','cms_record_rebuild') then
      execute format('grant execute on function %s to service_role',f.signature);
    elsif f.proname='cms_public_snapshot' then
      execute format('grant execute on function %s to anon,authenticated',f.signature);
    else execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end $$;
grant execute on function private.session(),private.list_content(text,text,integer),private.get_content(uuid),private.save_content(uuid,text,text,text,jsonb,uuid[],integer),
  private.transition_content(uuid,integer,text,text),private.list_finance(),private.save_finance(jsonb,integer),private.publish_finance(text,integer,text),
  private.list_staff(),private.save_staff(text,text,boolean),private.list_media(),private.register_media(uuid,text,text,integer,integer,text,text,boolean),
  private.approve_media(uuid[],uuid,integer),private.retire_media(uuid),private.backup_status(),private.rate_limit(text) to authenticated;
grant execute on function private.public_snapshot() to anon,authenticated;
grant execute on function private.media_upload_ready(uuid,uuid,text,text,integer,integer),private.begin_promote_media(uuid),private.promote_media(uuid,text,uuid),private.cancel_promote_media(uuid,uuid),private.media_retired(uuid),
  private.record_backup(uuid,text,timestamptz,text,text),private.rebuild_pending(),private.record_rebuild(bigint,text,text) to service_role;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('cms-originals','cms-originals',false,10485760,array['image/jpeg','image/png','image/webp']),
  ('cms-derivatives','cms-derivatives',false,10485760,array['image/webp']),
  ('cms-public','cms-public',true,10485760,array['image/webp']);
-- Ordinary clients cannot read/write private originals or derivatives. Only the trusted processor uploads/copies.
-- Public bucket bytes become public only after recent owner media approval; metadata also requires a live reference.
-- Preserve existing legacy images while closing the hosted anonymous arbitrary-upload policy.
drop policy if exists "Allow uploads to public-assets" on storage.objects;
create policy cms_public_approved_objects on storage.objects for select to anon,authenticated using (
  bucket_id='cms-public' and exists(select 1 from jsonb_array_elements(private.public_snapshot()->'media') m where m->>'public_path'=name)
);

-- Preserve the unused legacy tables while closing their old direct Data API surfaces.
do $$ declare t text; begin
  foreach t in array array['articles','events','event_registrations','impact_stats','fundraisers','archive_terms','archive_projects','archive_awards','archive_photos'] loop
    if to_regclass('public.'||t) is not null then execute format('revoke all on table public.%I from public,anon,authenticated',t); end if;
  end loop;
end $$;

create function private.immutable_record() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Historical records are immutable' using errcode='23514'; end $$;
revoke all on function private.immutable_record() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['content_publications','publication_media','finance_publications','finance_terms','finance_projects','finance_income','finance_expenses','audit','upload_receipts','backup_runs'] loop
    execute format('create trigger immutable_history before update or delete on private.%I for each row execute function private.immutable_record()',t);
  end loop;
end $$;
create index content_updated_by_idx on private.content(updated_by);
create index content_publications_publisher_idx on private.content_publications(published_by);
create index content_media_media_idx on private.content_media(media_id);
create index publication_media_media_idx on private.publication_media(media_id);
create index upload_receipts_user_idx on private.upload_receipts(user_id);
create index media_uploader_idx on private.media(uploaded_by);
create index media_approver_idx on private.media(approved_by);
create index finance_drafts_editor_idx on private.finance_drafts(updated_by);
create index finance_publications_previous_idx on private.finance_publications(previous_id);
create index finance_publications_publisher_idx on private.finance_publications(published_by);
create index finance_projects_event_idx on private.finance_projects(event_publication_id);
create index finance_projects_term_idx on private.finance_projects(publication_id,term_id);
create index finance_income_term_idx on private.finance_income(publication_id,term_id);
create index finance_expenses_project_idx on private.finance_expenses(publication_id,project_id);
create index audit_actor_idx on private.audit(actor_id);
create index session_activity_user_idx on private.session_activity(user_id);

create function private.can_preview_media(p_name text) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.require_staff();
  return exists(select 1 from private.media m where m.derivative_path=p_name);
end $$;
revoke all on function private.can_preview_media(text) from public,anon,authenticated,service_role;
grant execute on function private.can_preview_media(text) to authenticated;
create policy cms_staff_derivative_preview on storage.objects for select to authenticated using (
  bucket_id='cms-derivatives' and private.can_preview_media(name)
);
