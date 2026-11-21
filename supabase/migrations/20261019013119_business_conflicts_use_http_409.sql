-- Business version and media lease conflicts are not serialization failures.
-- PT409 returns HTTP 409 without triggering PostgREST transaction retries.
-- CREATE OR REPLACE preserves existing signatures, ownership and EXECUTE grants.

create or replace function private.save_finance(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(); v_id text; v_row private.finance_drafts; begin
  perform private.rate_limit('finance'); perform private.validate_finance(p_payload); v_id := p_payload->'term'->>'id';
  -- Serialize new-ID upserts as well as updates, so a missing draft cannot bypass expectedVersion.
  perform pg_advisory_xact_lock(843020);
  select * into v_row from private.finance_drafts where term_id=v_id for update;
  if found then
    if p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='PT409'; end if;
    update private.finance_drafts set payload=p_payload,version=version+1,updated_by=v_uid,updated_at=now() where term_id=v_id returning * into v_row;
  else
    if p_expected_version is not null then raise exception 'Version conflict' using errcode='PT409'; end if;
    insert into private.finance_drafts(term_id,payload,version,updated_by) values(v_id,p_payload,1,v_uid) returning * into v_row;
  end if;
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'finance.save',v_id,jsonb_build_object('version',v_row.version));
  return jsonb_build_object('payload',v_row.payload,'version',v_row.version,'status','draft','updated_at',v_row.updated_at);
end $$;

create or replace function private.publish_finance(p_term_id text,p_expected_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(true,true,true); v_row private.finance_drafts; v_pub uuid; v_previous uuid;
  v_term jsonb; v jsonb; v_event uuid; v_closing bigint; v_before uuid; v_after uuid; v_order integer;
begin
  perform private.rate_limit('finance'); perform private.text_value(to_jsonb(p_reason),5,1000);
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.finance_drafts where term_id=p_term_id for update;
  if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='PT409'; end if;
  perform private.validate_finance(v_row.payload); v_term := v_row.payload->'term';
  select publication_id into v_previous from private.live_finance where term_id=p_term_id;
  if exists(select 1 from private.finance_publications where term_id=p_term_id and version=v_row.version) then raise exception 'Already published' using errcode='PT409'; end if;
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

create or replace function private.save_content(p_id uuid,p_kind text,p_slug text,p_title text,p_payload jsonb,p_media_ids uuid[],p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(); v_row private.content; begin
  perform private.rate_limit('save'); perform private.validate_content(p_kind,p_slug,p_title,p_payload);
  if p_media_ids is null or cardinality(p_media_ids)>20 or cardinality(p_media_ids)<>(select count(distinct x) from unnest(p_media_ids) x)
    or exists(select 1 from unnest(p_media_ids) x where x is null or not exists(select 1 from private.media m where m.id=x)) then
    raise exception 'Invalid registered media' using errcode='22023'; end if;
  if p_id is null then
    if p_expected_version is not null then raise exception 'Unexpected version' using errcode='PT409'; end if;
    insert into private.content(kind,slug,title,payload,media_ids,updated_by) values(p_kind,p_slug,p_title,p_payload,p_media_ids,v_uid) returning * into v_row;
  else
    select * into v_row from private.content where id=p_id for update;
    if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='PT409'; end if;
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

create or replace function private.transition_content(p_id uuid,p_expected_version integer,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_row private.content; v_pub uuid; begin
  v_uid := private.require_staff(true,p_action in ('publish','archive'),p_action in ('publish','archive'));
  perform private.rate_limit('transition');
  if p_action is null or p_action not in ('submit','publish','archive') then raise exception 'Invalid action' using errcode='22023'; end if;
  perform private.text_value(to_jsonb(p_reason),case when p_action='submit' then 0 else 5 end,1000);
  -- Serialize publication/archive with finance approval to avoid linked-event races.
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.content where id=p_id for update;
  if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='PT409'; end if;
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

create or replace function private.approve_media(p_ids uuid[],p_content_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_staff(true,true,true); v_row private.content; begin
  perform private.rate_limit('media_approve');
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.content where id=p_content_id for update;
  if not found or p_expected_version is distinct from v_row.version then raise exception 'Version conflict' using errcode='PT409'; end if;
  if v_row.status<>'submitted' or p_ids is null or cardinality(p_ids)>20
    or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x)
    or not p_ids @> v_row.media_ids or not p_ids <@ v_row.media_ids
    or exists(select 1 from unnest(p_ids) x where x is null or not exists(select 1 from private.media m where m.id=x and m.rights_confirmed)) then
    raise exception 'Approval must match submitted revision media' using errcode='23514'; end if;
  if exists(select 1 from private.media where id=any(p_ids) and status in ('promoting','revoking')) then
    raise exception 'Media operation in progress' using errcode='PT409'; end if;
  update private.media set status='approved',approved_by=v_uid,approved_at=now() where id=any(p_ids) and status='pending';
  insert into private.audit(actor_id,action,record_id,detail) values(v_uid,'media.approve',p_content_id::text,jsonb_build_object('version',p_expected_version,'media_ids',p_ids));
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m)-'uploaded_by'-'approved_by' order by m.id) from private.media m where id=any(p_ids)),'[]'));
end $$;

create or replace function private.begin_promote_media(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.media where id=p_id for update;
  if not found or v_row.status not in ('approved','ready') then
    raise exception 'Media unavailable for promotion' using errcode='PT409'; end if;
  if v_row.status='approved' then
    update private.media set status='promoting',operation_id=gen_random_uuid() where id=p_id returning * into v_row;
  end if;
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

create or replace function private.promote_media(p_id uuid,p_public_path text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  if p_id is null or p_public_path is distinct from p_id::text||'.webp'
    or not exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_public_path) then raise exception 'Invalid promoted object' using errcode='22023'; end if;
  update private.media set public_path=p_public_path,status='ready',operation_id=null
    where id=p_id and status='promoting' and operation_id=p_operation_id and rights_confirmed returning * into v_row;
  if not found then raise exception 'Promotion lease does not match' using errcode='PT409'; end if;
  insert into private.audit(action,record_id) values('media.promote',p_id::text);
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

create or replace function private.cancel_promote_media(p_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  -- The trusted caller must confirm public-object cleanup before releasing a lease.
  if exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_id::text||'.webp') then
    raise exception 'Public object cleanup required' using errcode='23514'; end if;
  update private.media set status='approved',operation_id=null where id=p_id and status='promoting'
    and operation_id=p_operation_id returning * into v_row;
  if not found then raise exception 'Promotion lease does not match' using errcode='PT409'; end if;
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

create or replace function private.retire_media(p_content_id uuid) returns jsonb
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
    raise exception 'Media promotion in progress' using errcode='PT409'; end if;
  update private.media m set status='revoking',public_path=m.id::text||'.webp'
    where m.id=any(v_ids) and m.status in ('approved','ready','revoking')
    and not exists(select 1 from private.publication_media pm join private.live_content lc
      on lc.publication_id=pm.publication_id where pm.media_id=m.id);
  insert into private.audit(actor_id,action,record_id) values(v_uid,'media.retire',p_content_id::text);
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m)-'uploaded_by'-'approved_by' order by m.id)
    from private.media m where m.id=any(v_ids) and m.status='revoking'),'[]'));
end $$;

create or replace function private.media_retired(p_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.media where id=p_id for update;
  if not found or v_row.status<>'revoking' or p_operation_id is null
    or v_row.operation_id is distinct from p_operation_id then
    raise exception 'Retirement lease does not match' using errcode='PT409'; end if;
  if exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_id::text||'.webp') then
    raise exception 'Public object cleanup required' using errcode='23514'; end if;
  update private.media set status='pending',public_path=null,approved_by=null,approved_at=null,operation_id=null
    where id=p_id returning * into v_row;
  insert into private.audit(action,record_id) values('media.retired',p_id::text);
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

create or replace function private.begin_retire_media(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  update private.media set operation_id=gen_random_uuid()
    where id=p_id and status='revoking' and operation_id is null returning * into v_row;
  if not found then raise exception 'Retirement lease unavailable' using errcode='PT409'; end if;
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;
