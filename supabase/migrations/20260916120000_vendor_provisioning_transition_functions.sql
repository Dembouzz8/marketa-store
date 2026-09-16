-- Vendor Provisioning Batch 1B: internal transition functions only.
-- No function is invoked by this migration. No Auth API or admin bootstrap.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  v_table text;
  v_role text;
  v_privilege text;
  v_column text;
begin
  foreach v_table in array array[
    'public.admin_users', 'public.vendor_applications', 'public.vendors',
    'public.vendor_verifications', 'auth.users'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as c
      where c.oid = pg_catalog.to_regclass(v_table) and c.relkind = 'r'
    ) then
      raise exception 'Batch 1B: missing/unexpected prerequisite table %.', v_table;
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'review_vendor_application', 'claim_vendor_application_provisioning',
      'record_vendor_application_auth_identity', 'fail_vendor_application_provisioning',
      'finalize_vendor_application_provisioning'
    )
  ) then
    raise exception 'Batch 1B: a transition function name already exists; review before proceeding.';
  end if;

  if exists (
    select 1 from (values
      ('public.admin_users', 'user_id', 'uuid', true),
      ('public.admin_users', 'created_at', 'timestamp with time zone', true),
      ('public.vendor_applications', 'reviewed_by', 'uuid', false),
      ('public.vendor_applications', 'provisioning_status', 'text', true),
      ('public.vendor_applications', 'auth_user_id', 'uuid', false),
      ('public.vendor_applications', 'vendor_id', 'uuid', false),
      ('public.vendor_applications', 'provisioning_started_at', 'timestamp with time zone', false),
      ('public.vendor_applications', 'invited_at', 'timestamp with time zone', false),
      ('public.vendor_applications', 'provisioned_at', 'timestamp with time zone', false),
      ('public.vendor_applications', 'provisioning_error_code', 'text', false),
      ('auth.users', 'id', 'uuid', true),
      ('auth.users', 'email', 'character varying(255)', false),
      ('auth.users', 'email_confirmed_at', 'timestamp with time zone', false)
    ) as expected(table_name, column_name, type_name, not_null)
    left join pg_catalog.pg_attribute as a
      on a.attrelid = pg_catalog.to_regclass(expected.table_name)
        and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
    where a.attnum is null or pg_catalog.format_type(a.atttypid, a.atttypmod) <> expected.type_name
      or a.attnotnull is distinct from expected.not_null
  ) then
    raise exception 'Batch 1B: prerequisite columns/types/nullability changed.';
  end if;

  foreach v_table in array array[
    'public.admin_users', 'public.vendor_applications', 'public.vendor_verifications'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as c
      where c.oid = pg_catalog.to_regclass(v_table)
        and c.relrowsecurity and c.relowner = 'postgres'::regrole
    ) or exists (
      select 1 from pg_catalog.pg_policy as p where p.polrelid = pg_catalog.to_regclass(v_table)
    ) or exists (
      select 1 from pg_catalog.pg_class as c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) as acl
      where c.oid = pg_catalog.to_regclass(v_table)
        and acl.grantee not in ('postgres'::regrole, 'service_role'::regrole)
    ) or exists (
      select 1 from pg_catalog.pg_attribute as a
      where a.attrelid = pg_catalog.to_regclass(v_table)
        and a.attnum > 0 and not a.attisdropped and a.attacl is not null
    ) then
      raise exception 'Batch 1B: private table boundary changed for %.', v_table;
    end if;

    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] loop
      if pg_catalog.has_table_privilege('anon', v_table, v_privilege)
        or pg_catalog.has_table_privilege('authenticated', v_table, v_privilege)
        or not pg_catalog.has_table_privilege('service_role', v_table, v_privilege)
      then
        raise exception 'Batch 1B: unexpected % privilege on %.', v_privilege, v_table;
      end if;
    end loop;
  end loop;

  -- Compare actual definitions, not just constraint names.
  if exists (
    select 1 from (values
      ('public.vendor_applications', 'vendor_applications_location_check',
        'CHECK (((char_length(btrim(location)) >= 1) AND (char_length(btrim(location)) <= 120) AND (location ~ ''[^[:space:]]''::text)))'),
      ('public.vendors', 'vendors_location_public_profile_check',
        'CHECK (((location IS NULL) OR ((char_length(location) <= 120) AND (location ~ ''[^[:space:]]''::text))))'),
      ('public.vendors', 'vendors_platform_fee_pct_check',
        'CHECK (((platform_fee_pct >= (0)::numeric) AND (platform_fee_pct <= (100)::numeric)))'),
      ('public.vendors', 'vendors_user_id_fkey',
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('public.vendors', 'vendors_user_id_key',
        'UNIQUE (user_id)'),
      ('public.vendor_applications', 'vendor_applications_auth_user_id_fkey',
        'FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT'),
      ('public.vendor_applications', 'vendor_applications_failed_provisioning_check',
        'CHECK (((provisioning_status <> ''failed''::text) OR ((status = ''approved''::text) AND (((vendor_id IS NULL) AND (provisioned_at IS NULL)) OR ((vendor_id IS NOT NULL) AND (auth_user_id IS NOT NULL) AND (provisioned_at IS NOT NULL))))))'),
      ('public.vendor_applications', 'vendor_applications_pending_provisioning_check',
        'CHECK (((provisioning_status <> ALL (ARRAY[''not_started''::text, ''in_progress''::text, ''awaiting_enrollment''::text])) OR ((vendor_id IS NULL) AND (provisioned_at IS NULL))))'),
      ('public.vendor_applications', 'vendor_applications_provisioned_check',
        'CHECK (((provisioning_status <> ''provisioned''::text) OR ((status = ''approved''::text) AND (auth_user_id IS NOT NULL) AND (vendor_id IS NOT NULL) AND (provisioned_at IS NOT NULL))))'),
      ('public.vendor_applications', 'vendor_applications_provisioning_error_code_check',
        'CHECK (((provisioning_error_code IS NULL) OR (((char_length(provisioning_error_code) >= 1) AND (char_length(provisioning_error_code) <= 100)) AND (provisioning_error_code ~ ''^[A-Za-z][A-Za-z0-9_]*$''::text))))'),
      ('public.vendor_applications', 'vendor_applications_provisioning_status_check',
        'CHECK ((provisioning_status = ANY (ARRAY[''not_started''::text, ''in_progress''::text, ''awaiting_enrollment''::text, ''provisioned''::text, ''failed''::text])))'),
      ('public.vendor_applications', 'vendor_applications_review_provisioning_check',
        'CHECK (((status = ''approved''::text) OR ((provisioning_status = ''not_started''::text) AND (vendor_id IS NULL) AND (provisioned_at IS NULL))))'),
      ('public.vendor_applications', 'vendor_applications_reviewed_by_fkey',
        'FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('public.vendor_applications', 'vendor_applications_status_check',
        'CHECK ((status = ANY (ARRAY[''submitted''::text, ''under_review''::text, ''approved''::text, ''rejected''::text])))'),
      ('public.vendor_applications', 'vendor_applications_vendor_id_fkey',
        'FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT'),
      ('public.admin_users', 'admin_users_pkey',
        'PRIMARY KEY (user_id)'),
      ('public.admin_users', 'admin_users_user_id_fkey',
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
    ) as expected(table_name, constraint_name, definition)
    left join pg_catalog.pg_constraint as k
      on k.conrelid = pg_catalog.to_regclass(expected.table_name)
        and k.conname = expected.constraint_name
    where k.oid is null or not k.convalidated
      or pg_catalog.pg_get_constraintdef(k.oid) <> expected.definition
  ) then
    raise exception 'Batch 1B: Batch 1A state/linkage or vendor constraints changed.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger as t
    where t.tgrelid = 'public.vendor_applications'::regclass
      and t.tgname = 'vendor_applications_updated_at' and not t.tgisinternal
      and t.tgfoid = pg_catalog.to_regprocedure('public.handle_updated_at()')
      and t.tgtype = 19 and t.tgenabled = 'O'
  ) or not exists (
    select 1 from pg_catalog.pg_proc as p
    where p.oid = pg_catalog.to_regprocedure('public.handle_updated_at()')
      and p.prorettype = 'trigger'::regtype and not p.prosecdef
      and pg_catalog.regexp_replace(pg_catalog.lower(p.prosrc), '[[:space:]]', '', 'g')
        = 'beginnew.updated_at=now();returnnew;end;'
  ) then
    raise exception 'Batch 1B: application updated_at trigger/function changed.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index as i
    where i.indexrelid = pg_catalog.to_regclass('public.vendors_email_normalized_unique')
      and i.indrelid = 'public.vendors'::regclass and i.indisunique and i.indisvalid
      and i.indnkeyatts = 1 and i.indpred is null
      and pg_catalog.pg_get_expr(i.indexprs, i.indrelid) = 'lower(btrim(email))'
  ) or not exists (
    select 1 from pg_catalog.pg_index as i
    where i.indexrelid = pg_catalog.to_regclass('public.vendor_applications_active_email_unique')
      and i.indrelid = 'public.vendor_applications'::regclass
      and i.indisunique and i.indisvalid and i.indnkeyatts = 1
      and pg_catalog.pg_get_expr(i.indexprs, i.indrelid) = 'lower(btrim(email))'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid)
        = '(status = ANY (ARRAY[''submitted''::text, ''under_review''::text, ''approved''::text]))'
  ) then
    raise exception 'Batch 1B: normalized email uniqueness is missing or changed.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute as a
    join pg_catalog.pg_attrdef as d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.vendors'::regclass and a.attname = 'is_active'
      and a.attnotnull and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'false'
  ) or not exists (
    select 1 from pg_catalog.pg_attribute as a
    join pg_catalog.pg_attrdef as d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.vendors'::regclass and a.attname = 'platform_fee_pct'
      and a.atttypid = 'numeric'::regtype
  ) or not exists (
    select 1 from pg_catalog.pg_class as c
    where c.oid = 'public.vendors'::regclass and c.relrowsecurity
  ) then
    raise exception 'Batch 1B: vendor activation, fee default or RLS baseline changed.';
  end if;

  foreach v_column in array array[
    'id', 'user_id', 'email', 'platform_fee_pct', 'is_active', 'created_at', 'updated_at'
  ] loop
    if pg_catalog.has_column_privilege('authenticated', 'public.vendors', v_column, 'UPDATE') then
      raise exception 'Batch 1B: vendor protected column % is writable.', v_column;
    end if;
  end loop;
  if not pg_catalog.has_table_privilege('authenticated', 'public.vendors', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.vendors', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.vendors', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.vendors', 'UPDATE')
  then
    raise exception 'Batch 1B: vendor self-service table grants changed.';
  end if;
end
$preflight$;

-- Prevent concurrent application/vendor/admin writes from invalidating the
-- before/after preservation check. No test rows or operational RPC calls here.
lock table public.vendors, public.vendor_applications,
  public.vendor_verifications, public.admin_users in share mode;

do $snapshot$
begin
  perform pg_catalog.set_config('marketa_batch1b.baseline', pg_catalog.jsonb_build_object(
    'vendors', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(v)::text, E'\n' order by v.id), ''
    )) from public.vendors as v),
    'applications', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, E'\n' order by a.id), ''
    )) from public.vendor_applications as a),
    'verifications', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(v)::text, E'\n' order by v.vendor_id), ''
    )) from public.vendor_verifications as v),
    'admins', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, E'\n' order by a.user_id), ''
    )) from public.admin_users as a),
    'security', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'oid', c.oid, 'owner', c.relowner, 'acl', c.relacl,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'policies', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.polname)
                  from pg_catalog.pg_policy as p where p.polrelid = c.oid),
      'columns', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.attnum)
                  from pg_catalog.pg_attribute as a
                  where a.attrelid = c.oid and a.attnum > 0),
      'constraints', (select pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) order by k.conname)
                      from pg_catalog.pg_constraint as k where k.conrelid = c.oid),
      'triggers', (select pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid) order by t.tgname)
                   from pg_catalog.pg_trigger as t where t.tgrelid = c.oid)
    ) order by c.oid)
    from pg_catalog.pg_class as c
    where c.oid in ('public.vendors'::regclass, 'public.vendor_applications'::regclass,
      'public.vendor_verifications'::regclass, 'public.admin_users'::regclass))
  )::text, true);
end
$snapshot$;

create function public.review_vendor_application(
  p_application_id uuid,
  p_reviewer_id uuid,
  p_action text,
  p_review_notes text default null
)
returns table (outcome text, application_id uuid, status text, provisioning_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
  v_notes text := nullif(pg_catalog.regexp_replace(
    p_review_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  ), '');
begin
  application_id := p_application_id;
  -- Lock membership so a concurrent revocation cannot pass this authorization.
  perform 1 from public.admin_users as administrator
  where administrator.user_id = p_reviewer_id
  for share;
  if not found then
    outcome := 'unauthorized'; return next; return;
  end if;
  if p_action is null or p_action not in ('start_review', 'approve', 'reject')
    or (v_notes is not null and pg_catalog.char_length(v_notes) > 4000)
  then
    outcome := 'invalid_input'; return next; return;
  end if;

  select a.* into v_application from public.vendor_applications as a
  where a.id = p_application_id for update;
  if not found then
    outcome := 'unavailable'; return next; return;
  end if;
  status := v_application.status;
  provisioning_status := v_application.provisioning_status;

  if p_action = 'start_review' and v_application.status = 'under_review' then
    outcome := 'already_under_review'; return next; return;
  elsif p_action = 'approve' and v_application.status = 'approved' then
    outcome := 'already_approved'; return next; return;
  elsif p_action = 'reject' and v_application.status = 'rejected' then
    outcome := 'already_rejected'; return next; return;
  end if;

  if v_application.status not in ('submitted', 'under_review')
    or v_application.provisioning_status <> 'not_started'
    or v_application.auth_user_id is not null
    or v_application.vendor_id is not null
    or v_application.provisioned_at is not null
  then
    outcome := 'invalid_state'; return next; return;
  end if;

  if p_action = 'start_review' then
    update public.vendor_applications as a
    set status = 'under_review', reviewed_by = p_reviewer_id,
        review_notes = coalesce(v_notes, a.review_notes)
    where a.id = v_application.id;
    status := 'under_review';
    outcome := 'review_started';
  else
    status := case when p_action = 'approve' then 'approved' else 'rejected' end;
    update public.vendor_applications as a
    set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
        reviewed_by = p_reviewer_id, reviewed_at = pg_catalog.now(),
        review_notes = coalesce(v_notes, a.review_notes)
    where a.id = v_application.id;
    outcome := case when p_action = 'approve' then 'approved' else 'rejected' end;
  end if;
  return next;
exception when others then
  -- This block's writes roll back before the controlled result is returned.
  outcome := 'operation_failed'; application_id := p_application_id;
  status := null; provisioning_status := null;
  return next;
end
$function$;

create function public.claim_vendor_application_provisioning(p_application_id uuid)
returns table (outcome text, application_id uuid, vendor_id uuid, provisioning_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
begin
  application_id := p_application_id;
  select a.* into v_application from public.vendor_applications as a
  where a.id = p_application_id for update;
  if not found then
    outcome := 'unavailable'; return next; return;
  end if;
  provisioning_status := v_application.provisioning_status;
  if v_application.status <> 'approved' then
    outcome := 'invalid_state'; return next; return;
  end if;

  if v_application.provisioning_status = 'provisioned' then
    perform 1 from public.vendors as v
    where v.id = v_application.vendor_id and v.user_id = v_application.auth_user_id
    for share;
    if not found or v_application.provisioned_at is null then
      outcome := 'invalid_state';
    else
      outcome := 'already_provisioned'; vendor_id := v_application.vendor_id;
    end if;
    return next; return;
  elsif v_application.provisioning_status = 'in_progress' then
    outcome := 'already_in_progress'; return next; return;
  elsif v_application.provisioning_status = 'awaiting_enrollment' then
    outcome := 'awaiting_enrollment'; return next; return;
  end if;

  -- Batch 1A permits a failed state with a complete historical finalization.
  -- Never regress that tuple; it requires explicit operator remediation.
  if v_application.provisioning_status not in ('not_started', 'failed')
    or v_application.vendor_id is not null or v_application.provisioned_at is not null
  then
    outcome := 'invalid_state'; return next; return;
  end if;
  update public.vendor_applications as a
  set provisioning_status = 'in_progress',
      provisioning_started_at = pg_catalog.now(), provisioning_error_code = null
  where a.id = v_application.id;
  provisioning_status := 'in_progress';
  outcome := 'claimed';
  return next;
exception when others then
  outcome := 'operation_failed'; application_id := p_application_id;
  vendor_id := null; provisioning_status := null;
  return next;
end
$function$;

create function public.record_vendor_application_auth_identity(
  p_application_id uuid,
  p_auth_user_id uuid,
  p_invited boolean
)
returns table (outcome text, application_id uuid, vendor_id uuid, provisioning_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
  v_auth_email text;
begin
  application_id := p_application_id;
  if p_auth_user_id is null or p_invited is null then
    outcome := 'invalid_input'; return next; return;
  end if;
  select a.* into v_application from public.vendor_applications as a
  where a.id = p_application_id for update;
  if not found then
    outcome := 'unavailable'; return next; return;
  end if;
  provisioning_status := v_application.provisioning_status;
  if v_application.status <> 'approved'
    or v_application.provisioning_status not in ('in_progress', 'awaiting_enrollment')
    or v_application.vendor_id is not null or v_application.provisioned_at is not null
  then
    outcome := 'invalid_state'; return next; return;
  end if;
  if v_application.auth_user_id is not null and v_application.auth_user_id <> p_auth_user_id then
    outcome := 'identity_conflict'; return next; return;
  end if;

  -- SHARE prevents email changes/deletion until the recorded link commits.
  select pg_catalog.lower(pg_catalog.btrim(u.email)) into v_auth_email
  from auth.users as u where u.id = p_auth_user_id for share;
  if not found or v_auth_email is null or v_auth_email = ''
    or v_auth_email <> v_application.email
  then
    outcome := 'identity_mismatch'; return next; return;
  end if;
  if exists (
    select 1 from public.vendors as v
    where v.user_id = p_auth_user_id
      or pg_catalog.lower(pg_catalog.btrim(v.email)) = v_application.email
  ) then
    outcome := 'vendor_collision'; return next; return;
  end if;

  if v_application.provisioning_status = 'awaiting_enrollment' then
    if v_application.auth_user_id is distinct from p_auth_user_id then
      outcome := 'invalid_state'; return next; return;
    end if;
    if p_invited and v_application.invited_at is null then
      update public.vendor_applications as a
      set invited_at = pg_catalog.now()
      where a.id = v_application.id;
    end if;
    outcome := 'already_awaiting_enrollment'; return next; return;
  end if;

  update public.vendor_applications as a
  set auth_user_id = p_auth_user_id, provisioning_status = 'awaiting_enrollment',
      invited_at = case when p_invited then coalesce(a.invited_at, pg_catalog.now())
                        else a.invited_at end
  where a.id = v_application.id;
  provisioning_status := 'awaiting_enrollment';
  outcome := 'awaiting_enrollment';
  return next;
exception when others then
  outcome := 'operation_failed'; application_id := p_application_id;
  vendor_id := null; provisioning_status := null;
  return next;
end
$function$;

create function public.fail_vendor_application_provisioning(
  p_application_id uuid,
  p_error_code text
)
returns table (outcome text, application_id uuid, vendor_id uuid, provisioning_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
begin
  application_id := p_application_id;
  if p_error_code is null or pg_catalog.char_length(p_error_code) not between 1 and 100
    or p_error_code !~ '^[A-Za-z][A-Za-z0-9_]*$'
  then
    outcome := 'invalid_input'; return next; return;
  end if;
  select a.* into v_application from public.vendor_applications as a
  where a.id = p_application_id for update;
  if not found then
    outcome := 'unavailable'; return next; return;
  end if;
  provisioning_status := v_application.provisioning_status;
  if v_application.status <> 'approved'
    or v_application.vendor_id is not null or v_application.provisioned_at is not null
  then
    outcome := 'invalid_state'; return next; return;
  end if;
  if v_application.provisioning_status = 'failed' then
    outcome := 'already_failed'; return next; return;
  end if;
  if v_application.provisioning_status not in ('in_progress', 'awaiting_enrollment') then
    outcome := 'invalid_state'; return next; return;
  end if;

  update public.vendor_applications as a
  set provisioning_status = 'failed', provisioning_error_code = p_error_code
  where a.id = v_application.id;
  provisioning_status := 'failed';
  outcome := 'failed';
  return next;
exception when others then
  outcome := 'operation_failed'; application_id := p_application_id;
  vendor_id := null; provisioning_status := null;
  return next;
end
$function$;

create function public.finalize_vendor_application_provisioning(
  p_application_id uuid,
  p_auth_user_id uuid
)
returns table (outcome text, application_id uuid, vendor_id uuid, provisioning_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_vendor_id uuid;
  v_fee numeric;
begin
  application_id := p_application_id;
  if p_auth_user_id is null then
    outcome := 'invalid_input'; return next; return;
  end if;
  select a.* into v_application from public.vendor_applications as a
  where a.id = p_application_id for update;
  if not found then
    outcome := 'unavailable'; return next; return;
  end if;
  provisioning_status := v_application.provisioning_status;
  if v_application.status <> 'approved' then
    outcome := 'invalid_state'; return next; return;
  end if;
  if v_application.provisioning_status not in ('awaiting_enrollment', 'provisioned') then
    outcome := 'invalid_state'; return next; return;
  end if;
  if v_application.auth_user_id is distinct from p_auth_user_id then
    outcome := 'identity_conflict'; return next; return;
  end if;

  if v_application.provisioning_status = 'provisioned' then
    perform 1 from public.vendors as v
    where v.id = v_application.vendor_id and v.user_id = p_auth_user_id
    for share;
    if not found or v_application.provisioned_at is null then
      outcome := 'invalid_state';
    else
      outcome := 'already_provisioned'; vendor_id := v_application.vendor_id;
    end if;
    return next; return;
  end if;
  if v_application.provisioning_status <> 'awaiting_enrollment'
    or v_application.vendor_id is not null or v_application.provisioned_at is not null
  then
    outcome := 'invalid_state'; return next; return;
  end if;

  select pg_catalog.lower(pg_catalog.btrim(u.email)), u.email_confirmed_at
  into v_auth_email, v_email_confirmed_at
  from auth.users as u where u.id = p_auth_user_id for share;
  if not found or v_auth_email is null or v_auth_email = ''
    or v_auth_email <> v_application.email
  then
    outcome := 'identity_mismatch'; return next; return;
  end if;
  -- confirmed_at may represent phone confirmation; require email confirmation.
  if v_email_confirmed_at is null then
    outcome := 'enrollment_not_verified'; return next; return;
  end if;
  if exists (
    select 1 from public.vendors as v
    where v.user_id = p_auth_user_id
      or pg_catalog.lower(pg_catalog.btrim(v.email)) = v_application.email
  ) then
    outcome := 'vendor_collision'; return next; return;
  end if;

  -- Application and vendor location contracts are both capped at 120.
  -- Retain this runtime check as defense against unexpected state.
  if pg_catalog.char_length(v_application.location) > 120 then
    outcome := 'application_data_invalid'; return next; return;
  end if;

  -- Omitted fee/bank fields use the Marketa-controlled database defaults.
  -- No caller-controlled activation, fee, slug, bank data, or verification.
  insert into public.vendors as v (
    user_id, name, email, phone, main_category, location, description,
    is_active, slug, shipping_info, return_info
  ) values (
    p_auth_user_id, v_application.business_name, v_application.email,
    v_application.phone, v_application.business_category, v_application.location,
    v_application.business_description, false, null, null, null
  )
  returning v.id, v.platform_fee_pct into v_vendor_id, v_fee;

  if v_fee is null or not (v_fee >= 0 and v_fee <= 100) then
    -- Raise into this block's handler so the INSERT is rolled back as well.
    raise exception using errcode = 'P1001', message = 'Invalid vendor defaults.';
  end if;

  update public.vendor_applications as a
  set vendor_id = v_vendor_id, provisioning_status = 'provisioned',
      provisioned_at = pg_catalog.now(), provisioning_error_code = null
  where a.id = v_application.id;
  vendor_id := v_vendor_id;
  provisioning_status := 'provisioned';
  outcome := 'provisioned';
  return next;
exception
  when sqlstate 'P1001' then
    outcome := 'invalid_vendor_defaults'; application_id := p_application_id;
    vendor_id := null; provisioning_status := null;
    return next;
  when unique_violation then
    -- Handles a competing vendor INSERT after the collision pre-read.
    outcome := 'vendor_collision'; application_id := p_application_id;
    vendor_id := null; provisioning_status := null;
    return next;
  when check_violation or not_null_violation or string_data_right_truncation then
    outcome := 'application_data_invalid'; application_id := p_application_id;
    vendor_id := null; provisioning_status := null;
    return next;
  when others then
    -- Both writes roll back together; never return SQLERRM or exception details.
    outcome := 'operation_failed'; application_id := p_application_id;
    vendor_id := null; provisioning_status := null;
    return next;
end
$function$;

alter function public.review_vendor_application(uuid, uuid, text, text) owner to postgres;
revoke all privileges on function public.review_vendor_application(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_vendor_application(uuid, uuid, text, text) to service_role;

alter function public.claim_vendor_application_provisioning(uuid) owner to postgres;
revoke all privileges on function public.claim_vendor_application_provisioning(uuid) from public, anon, authenticated;
grant execute on function public.claim_vendor_application_provisioning(uuid) to service_role;

alter function public.record_vendor_application_auth_identity(uuid, uuid, boolean) owner to postgres;
revoke all privileges on function public.record_vendor_application_auth_identity(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_vendor_application_auth_identity(uuid, uuid, boolean) to service_role;

alter function public.fail_vendor_application_provisioning(uuid, text) owner to postgres;
revoke all privileges on function public.fail_vendor_application_provisioning(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_vendor_application_provisioning(uuid, text) to service_role;

alter function public.finalize_vendor_application_provisioning(uuid, uuid) owner to postgres;
revoke all privileges on function public.finalize_vendor_application_provisioning(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_vendor_application_provisioning(uuid, uuid) to service_role;

do $postcondition$
declare
  v_expected record;
  v_oid oid;
  v_role text;
  v_snapshot text;
begin
  for v_expected in
    select * from (values
      ('public.review_vendor_application(uuid, uuid, text, text)', 1,
       'TABLE(outcome text, application_id uuid, status text, provisioning_status text)'),
      ('public.claim_vendor_application_provisioning(uuid)', 0,
       'TABLE(outcome text, application_id uuid, vendor_id uuid, provisioning_status text)'),
      ('public.record_vendor_application_auth_identity(uuid, uuid, boolean)', 0,
       'TABLE(outcome text, application_id uuid, vendor_id uuid, provisioning_status text)'),
      ('public.fail_vendor_application_provisioning(uuid, text)', 0,
       'TABLE(outcome text, application_id uuid, vendor_id uuid, provisioning_status text)'),
      ('public.finalize_vendor_application_provisioning(uuid, uuid)', 0,
       'TABLE(outcome text, application_id uuid, vendor_id uuid, provisioning_status text)')
    ) as expected(signature, default_count, result_type)
  loop
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    if v_oid is null or not exists (
      select 1 from pg_catalog.pg_proc as p
      where p.oid = v_oid and p.proowner = 'postgres'::regrole
        and p.prosecdef and p.proconfig = array['search_path=""']
        and p.prokind = 'f' and p.proretset
        and p.prolang = (select l.oid from pg_catalog.pg_language as l where l.lanname = 'plpgsql')
        and p.pronargdefaults = v_expected.default_count
        and pg_catalog.pg_get_function_result(p.oid) = v_expected.result_type
    ) then
      raise exception 'Batch 1B: function signature/security mismatch for %.', v_expected.signature;
    end if;

    -- postgres retains its inherent owner privileges; only service_role is an API executor.
    if exists (
      select 1 from pg_catalog.pg_proc as p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) as acl
      where p.oid = v_oid and (
        acl.grantee not in ('postgres'::regrole, 'service_role'::regrole)
        or acl.privilege_type <> 'EXECUTE'
        or (acl.grantee = 'service_role'::regrole and acl.is_grantable)
      )
    ) or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'Batch 1B: service-only function ACL mismatch for %.', v_expected.signature;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') then
        raise exception 'Batch 1B: ordinary API role can execute %.', v_expected.signature;
      end if;
    end loop;
  end loop;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'review_vendor_application', 'claim_vendor_application_provisioning',
        'record_vendor_application_auth_identity', 'fail_vendor_application_provisioning',
        'finalize_vendor_application_provisioning'
      )) <> 5 then
    raise exception 'Batch 1B: unexpected transition-function overloads.';
  end if;

  select pg_catalog.jsonb_build_object(
    'vendors', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(v)::text, E'\n' order by v.id), ''
    )) from public.vendors as v),
    'applications', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, E'\n' order by a.id), ''
    )) from public.vendor_applications as a),
    'verifications', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(v)::text, E'\n' order by v.vendor_id), ''
    )) from public.vendor_verifications as v),
    'admins', (select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text, E'\n' order by a.user_id), ''
    )) from public.admin_users as a),
    'security', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'oid', c.oid, 'owner', c.relowner, 'acl', c.relacl,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'policies', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.polname)
                  from pg_catalog.pg_policy as p where p.polrelid = c.oid),
      'columns', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.attnum)
                  from pg_catalog.pg_attribute as a
                  where a.attrelid = c.oid and a.attnum > 0),
      'constraints', (select pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) order by k.conname)
                      from pg_catalog.pg_constraint as k where k.conrelid = c.oid),
      'triggers', (select pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid) order by t.tgname)
                   from pg_catalog.pg_trigger as t where t.tgrelid = c.oid)
    ) order by c.oid)
    from pg_catalog.pg_class as c
    where c.oid in ('public.vendors'::regclass, 'public.vendor_applications'::regclass,
      'public.vendor_verifications'::regclass, 'public.admin_users'::regclass))
  )::text into v_snapshot;
  if v_snapshot is distinct from pg_catalog.current_setting('marketa_batch1b.baseline') then
    raise exception 'Batch 1B: existing data or table security/schema changed.';
  end if;
end
$postcondition$;

commit;
