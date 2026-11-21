-- A deletion request must hold its own persistent lease before touching public bytes.
-- Otherwise an overlapping retry could delete a later, newly approved publication.
do $$ declare v_constraint record; begin
  for v_constraint in select conname from pg_constraint
    where conrelid='private.media'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%operation_id%' loop
    execute format('alter table private.media drop constraint %I',v_constraint.conname);
  end loop;
end $$;
alter table private.media add constraint media_operation_lease_check check (
  (status='promoting' and operation_id is not null)
  or status='revoking'
  or (status not in ('promoting','revoking') and operation_id is null)
);

create function private.begin_retire_media(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  update private.media set operation_id=gen_random_uuid()
    where id=p_id and status='revoking' and operation_id is null returning * into v_row;
  if not found then raise exception 'Retirement lease unavailable' using errcode='40001'; end if;
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

drop function public.cms_media_retired(uuid);
drop function private.media_retired(uuid);
create function private.media_retired(p_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row private.media; begin
  perform pg_advisory_xact_lock(843019);
  select * into v_row from private.media where id=p_id for update;
  if not found or v_row.status<>'revoking' or p_operation_id is null
    or v_row.operation_id is distinct from p_operation_id then
    raise exception 'Retirement lease does not match' using errcode='40001'; end if;
  if exists(select 1 from storage.objects where bucket_id='cms-public' and name=p_id::text||'.webp') then
    raise exception 'Public object cleanup required' using errcode='23514'; end if;
  update private.media set status='pending',public_path=null,approved_by=null,approved_at=null,operation_id=null
    where id=p_id returning * into v_row;
  insert into private.audit(action,record_id) values('media.retired',p_id::text);
  return to_jsonb(v_row)-'uploaded_by'-'approved_by';
end $$;

create function public.cms_media_begin_retire(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.begin_retire_media(p_id) $$;
create function public.cms_media_retired(p_id uuid,p_operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.media_retired(p_id,p_operation_id) $$;
revoke all on function private.begin_retire_media(uuid),private.media_retired(uuid,uuid),
  public.cms_media_begin_retire(uuid),public.cms_media_retired(uuid,uuid)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function private.begin_retire_media(uuid),private.media_retired(uuid,uuid),
  public.cms_media_begin_retire(uuid),public.cms_media_retired(uuid,uuid) to service_role;
