-- Vendor Provisioning Batch 3A: application-scoped, read-only Auth resolution.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.vendor_applications', 'public.vendors', 'auth.users'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as c
      where c.oid = pg_catalog.to_regclass(v_table) and c.relkind = 'r'
    ) then
      raise exception 'Batch 3A: missing or unexpected prerequisite table %.', v_table;
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_vendor_application_auth_identity'
  ) then
    raise exception 'Batch 3A: resolver name already exists; review before proceeding.';
  end if;

  if exists (
    select 1 from (values
      ('public.vendor_applications', 'id', 'uuid', true),
      ('public.vendor_applications', 'email', 'text', true),
      ('public.vendor_applications', 'status', 'text', true),
      ('public.vendor_applications', 'provisioning_status', 'text', true),
      ('public.vendor_applications', 'auth_user_id', 'uuid', false),
      ('public.vendor_applications', 'vendor_id', 'uuid', false),
      ('public.vendor_applications', 'provisioned_at', 'timestamp with time zone', false),
      ('public.vendors', 'user_id', 'uuid', true),
      ('public.vendors', 'email', 'text', true),
      ('auth.users', 'id', 'uuid', true),
      ('auth.users', 'email', 'character varying(255)', false),
      ('auth.users', 'email_confirmed_at', 'timestamp with time zone', false),
      ('auth.users', 'invited_at', 'timestamp with time zone', false)
    ) as expected(table_name, column_name, type_name, not_null)
    left join pg_catalog.pg_attribute as a
      on a.attrelid = pg_catalog.to_regclass(expected.table_name)
        and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
    where a.attnum is null
      or pg_catalog.format_type(a.atttypid, a.atttypmod) <> expected.type_name
      or a.attnotnull is distinct from expected.not_null
  ) then
    raise exception 'Batch 3A: prerequisite columns, types, or nullability changed.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint as k
    where k.conrelid = 'public.vendor_applications'::pg_catalog.regclass
      and k.conname = 'vendor_applications_email_check'
      and k.contype = 'c' and k.convalidated
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(k.oid),
        'email = lower(btrim(email))'
      ) > 0
  ) or not exists (
    select 1 from pg_catalog.pg_index as i
    where i.indexrelid = pg_catalog.to_regclass('public.vendors_email_normalized_unique')
      and i.indrelid = 'public.vendors'::pg_catalog.regclass
      and i.indisunique and i.indisvalid and i.indnkeyatts = 1
      and i.indpred is null
      and pg_catalog.pg_get_expr(i.indexprs, i.indrelid) = 'lower(btrim(email))'
  ) then
    raise exception 'Batch 3A: normalized application/vendor email baseline changed.';
  end if;
end
$preflight$;

-- Keep the before/after data snapshots stable while this migration adds only
-- the resolver. SHARE allows readers and blocks concurrent row mutations.
lock table public.vendor_applications, public.vendors, auth.users in share mode;

do $snapshot$
begin
  perform pg_catalog.set_config('marketa_batch3a.data',
    pg_catalog.jsonb_build_object(
      'applications', (select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, E'\n' order by a.id), ''
      )) from public.vendor_applications as a),
      'vendors', (select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(pg_catalog.to_jsonb(v)::text, E'\n' order by v.id), ''
      )) from public.vendors as v),
      'auth_users', (select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(pg_catalog.to_jsonb(u)::text, E'\n' order by u.id), ''
      )) from auth.users as u)
    )::text, true);
end
$snapshot$;

create function public.resolve_vendor_application_auth_identity(
  p_application_id uuid
)
returns table (
  outcome text,
  auth_user_id uuid,
  email_confirmed boolean,
  was_invited boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
  v_email text;
  v_candidate record;
  v_candidate_id uuid;
  v_candidate_confirmed boolean;
  v_candidate_invited boolean;
  v_match_count integer := 0;
begin
  outcome := null;
  auth_user_id := null;
  email_confirmed := null;
  was_invited := null;

  if p_application_id is null then
    outcome := 'invalid_input'; return next; return;
  end if;

  -- SHARE prevents an application update or deletion during this resolution.
  select a.* into v_application
  from public.vendor_applications as a
  where a.id = p_application_id
  for share;
  if not found then
    outcome := 'unavailable'; return next; return;
  end if;

  if v_application.status <> 'approved'
    or v_application.provisioning_status not in (
      'not_started', 'in_progress', 'failed', 'awaiting_enrollment'
    )
    or v_application.vendor_id is not null
    or v_application.provisioned_at is not null
  then
    outcome := 'invalid_state'; return next; return;
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(v_application.email));
  if v_email is null or v_email = '' or v_application.email <> v_email then
    outcome := 'invalid_state'; return next; return;
  end if;

  -- Two locked matches are enough to detect ambiguity without choosing one.
  for v_candidate in
    select u.id, u.email_confirmed_at is not null as is_confirmed,
      u.invited_at is not null as is_invited
    from auth.users as u
    where pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    order by u.id
    limit 2
    for share
  loop
    v_match_count := v_match_count + 1;
    if v_match_count = 1 then
      v_candidate_id := v_candidate.id;
      v_candidate_confirmed := v_candidate.is_confirmed;
      v_candidate_invited := v_candidate.is_invited;
    end if;
  end loop;

  if v_match_count > 1 then
    outcome := 'ambiguous_identity'; return next; return;
  end if;

  -- A previously recorded identity must never be silently replaced.
  if v_application.auth_user_id is not null
    and v_application.auth_user_id is distinct from v_candidate_id
  then
    outcome := 'invalid_state'; return next; return;
  end if;

  -- Check the vendor email even when no Auth user matched. Lock a collision
  -- row while reporting it; later provisioning must recheck for new rows.
  perform 1 from public.vendors as v
  where (v_candidate_id is not null and v.user_id = v_candidate_id)
    or pg_catalog.lower(pg_catalog.btrim(v.email)) = v_email
  for share;
  if found then
    outcome := 'vendor_collision'; return next; return;
  end if;

  if v_match_count = 0 then
    outcome := 'not_found'; return next; return;
  end if;

  auth_user_id := v_candidate_id;
  email_confirmed := v_candidate_confirmed;
  was_invited := v_candidate_invited;
  outcome := case when v_candidate_confirmed
    then 'existing_confirmed' else 'existing_unconfirmed' end;
  return next;
exception when others then
  -- Keep database and Auth details out of the API response.
  raise exception using errcode = 'P0001',
    message = 'Unable to resolve vendor application Auth identity.';
end
$function$;

alter function public.resolve_vendor_application_auth_identity(uuid) owner to postgres;
revoke all privileges on function public.resolve_vendor_application_auth_identity(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_vendor_application_auth_identity(uuid)
  to service_role;

do $postcondition$
declare
  v_oid oid := pg_catalog.to_regprocedure(
    'public.resolve_vendor_application_auth_identity(uuid)'
  );
  v_snapshot text;
begin
  if v_oid is null or not exists (
    select 1 from pg_catalog.pg_proc as p
    where p.oid = v_oid and p.proowner = 'postgres'::pg_catalog.regrole
      and p.prosecdef and p.proconfig = array['search_path=""']
      and p.prokind = 'f' and p.proretset and p.pronargdefaults = 0
      and p.prolang = (
        select l.oid from pg_catalog.pg_language as l where l.lanname = 'plpgsql'
      )
      and pg_catalog.pg_get_function_arguments(p.oid) = 'p_application_id uuid'
      and pg_catalog.pg_get_function_result(p.oid)
        = 'TABLE(outcome text, auth_user_id uuid, email_confirmed boolean, was_invited boolean)'
  ) then
    raise exception 'Batch 3A: resolver signature or security properties are incorrect.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_vendor_application_auth_identity'
      and p.oid <> v_oid
  ) or exists (
    select 1 from pg_catalog.pg_proc as p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) as acl
    where p.oid = v_oid and (
      acl.grantee not in (
        'postgres'::pg_catalog.regrole, 'service_role'::pg_catalog.regrole
      )
      or acl.privilege_type <> 'EXECUTE'
      or (acl.grantee = 'service_role'::pg_catalog.regrole and acl.is_grantable)
    )
  ) or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
  then
    raise exception 'Batch 3A: resolver EXECUTE boundary is incorrect.';
  end if;

  select pg_catalog.jsonb_build_object(
    'applications', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, E'\n' order by a.id), ''
    )) from public.vendor_applications as a),
    'vendors', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(v)::text, E'\n' order by v.id), ''
    )) from public.vendors as v),
    'auth_users', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(u)::text, E'\n' order by u.id), ''
    )) from auth.users as u)
  )::text into v_snapshot;
  if v_snapshot is distinct from pg_catalog.current_setting('marketa_batch3a.data') then
    raise exception 'Batch 3A: application, vendor, or Auth data changed.';
  end if;
end
$postcondition$;

commit;
