-- Vendor Provisioning Batch 1A: schema/security only; no admin seed or provisioning.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  relation_name text;
  privilege_name text;
  rpc_oid oid := to_regprocedure(
    'public.submit_vendor_application(text,text,text,text,text,text,text,text,text,boolean)'
  );
begin
  foreach relation_name in array array[
    'public.vendors', 'public.vendor_applications', 'auth.users',
    'public.vendor_verifications'
  ] loop
    if not exists (
      select 1 from pg_class
      where oid = to_regclass(relation_name) and relkind = 'r'
    ) then
      raise exception 'Batch 1A: required table % is missing or unexpected.', relation_name;
    end if;
  end loop;

  if to_regclass('public.admin_users') is not null then
    raise exception 'Batch 1A: admin_users already exists; review unexpected state.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = to_regclass('public.public_active_vendors') and relkind = 'v'
      and relowner = 'postgres'::regrole
      and reloptions @> array['security_barrier=true']
  ) then
    raise exception 'Batch 1A: expected public_active_vendors view is missing.';
  end if;

  if (select count(*) from pg_class
      where oid in ('public.vendors'::regclass, 'public.vendor_applications'::regclass)
        and relrowsecurity and not relforcerowsecurity
        and relowner = 'postgres'::regrole) <> 2 then
    raise exception 'Batch 1A: vendor/application owner or RLS baseline changed.';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.handle_updated_at()')
      and prorettype = 'trigger'::regtype and not prosecdef
      and prolang = (select oid from pg_language where lanname = 'plpgsql')
      and regexp_replace(lower(prosrc), '[[:space:]]', '', 'g')
        = 'beginnew.updated_at=now();returnnew;end;'
  ) then
    raise exception 'Batch 1A: handle_updated_at() has an unexpected implementation.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.vendors'::regclass
      and tgname = 'vendors_updated_at' and not tgisinternal
      and tgfoid = 'public.handle_updated_at()'::regprocedure
      and tgtype = 19 and tgenabled = 'O'
  ) or exists (
    select 1 from pg_trigger
    where tgrelid = 'public.vendor_applications'::regclass and not tgisinternal
  ) then
    raise exception 'Batch 1A: vendor/application trigger baseline changed.';
  end if;

  if rpc_oid is null or not exists (
    select 1 from pg_proc where oid = rpc_oid
      and prosecdef and proowner = 'postgres'::regrole
      and proconfig @> array['search_path=""']
      and pg_get_function_result(oid) = 'TABLE(outcome text, application_id uuid)'
      and md5(replace(prosrc, chr(13), '')) = '2c9075b555845b3e3608ad93aec3518b'
  ) then
    raise exception 'Batch 1A: submission RPC security or response contract changed.';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'vendors') <> 2
    or (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'vendors'
          and permissive = 'PERMISSIVE' and roles = array['public']::name[]
          and qual = '(auth.uid() = user_id)' and with_check is null
          and ((policyname = 'vendor_select_own' and cmd = 'SELECT')
            or (policyname = 'vendor_update_own' and cmd = 'UPDATE'))) <> 2
  then
    raise exception 'Batch 1A: unrecognized vendor policy baseline; no policies changed.';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid in ('public.vendors'::regclass, 'public.vendor_applications'::regclass)
      and attnum > 0 and not attisdropped and attacl is not null
  ) then
    raise exception 'Batch 1A: unexpected existing column grants; review before hardening.';
  end if;

  if (select count(*) from information_schema.table_privileges
      where table_schema = 'public' and table_name = 'vendors') <> 21
    or exists (
      select 1 from information_schema.table_privileges
      where table_schema = 'public' and table_name = 'vendors'
        and (grantee not in ('postgres', 'authenticated', 'service_role')
          or grantor <> 'postgres'
          or is_grantable <> case when grantee = 'postgres' then 'YES' else 'NO' end)
    )
  then
    raise exception 'Batch 1A: unrecognized vendor table grant baseline.';
  end if;

  foreach privilege_name in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] loop
    if not has_table_privilege('authenticated', 'public.vendors', privilege_name)
      or not has_table_privilege('service_role', 'public.vendors', privilege_name)
      or has_table_privilege('anon', 'public.vendors', privilege_name)
      or has_table_privilege('anon', 'public.vendor_applications', privilege_name)
      or has_table_privilege('authenticated', 'public.vendor_applications', privilege_name)
    then
      raise exception 'Batch 1A: unexpected effective privilege baseline for %.', privilege_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_applications'
  ) or exists (
    select 1 from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.vendor_applications'::regclass and a.grantee = 0
  ) then
    raise exception 'Batch 1A: application privacy baseline changed.';
  end if;

  if not exists (
    select 1 from pg_index
    where indexrelid = to_regclass('public.vendor_applications_active_email_unique')
      and indrelid = 'public.vendor_applications'::regclass
      and indisunique and indisvalid and indnkeyatts = 1
      and pg_get_expr(indexprs, indrelid) = 'lower(email)'
      and pg_get_expr(indpred, indrelid)
        = '(status = ANY (ARRAY[''submitted''::text, ''under_review''::text]))'
  ) then
    raise exception 'Batch 1A: active application email index baseline changed.';
  end if;

  if not exists (
    select 1 from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.vendors'::regclass and a.attname = 'is_active'
      and a.atttypid = 'boolean'::regtype and not a.attnotnull
      and pg_get_expr(d.adbin, d.adrelid) = 'true'
  ) then
    raise exception 'Batch 1A: vendors.is_active baseline changed.';
  end if;
end
$preflight$;

-- Hold the inspected data stable through uniqueness checks, DDL and assertions.
lock table public.vendors, public.vendor_applications in access exclusive mode;
lock table public.vendor_verifications in share mode;

do $data_preflight$
begin
  if exists (
    select 1 from public.vendors
    group by lower(btrim(email)) having count(*) > 1
  ) then
    raise exception 'Batch 1A: normalized vendor email collisions; resolve separately.';
  end if;
  if exists (
    select 1 from public.vendor_applications
    where status in ('submitted', 'under_review', 'approved')
    group by lower(btrim(email)) having count(*) > 1
  ) then
    raise exception 'Batch 1A: expanded active application email collisions; resolve separately.';
  end if;
  if exists (select 1 from public.vendors where is_active is null) then
    raise exception 'Batch 1A: NULL vendor activation values; no data will be rewritten.';
  end if;

  perform set_config('marketa_batch1a.vendors_data', (
    select md5(coalesce(string_agg(to_jsonb(v)::text, E'\n' order by id), ''))
    from public.vendors v
  ), true);
  perform set_config('marketa_batch1a.applications_data', (
    select md5(coalesce(string_agg(to_jsonb(a)::text, E'\n' order by id), ''))
    from public.vendor_applications a
  ), true);
  perform set_config('marketa_batch1a.verifications_data', (
    select md5(coalesce(string_agg(to_jsonb(v)::text, E'\n' order by vendor_id), ''))
    from public.vendor_verifications v
  ), true);
  perform set_config('marketa_batch1a.public_rows', (
    select md5(coalesce(string_agg(to_jsonb(v)::text, E'\n' order by id), ''))
    from public.public_active_vendors v
  ), true);
  perform set_config('marketa_batch1a.view_definition',
    pg_get_viewdef('public.public_active_vendors'::regclass, true), true);
  perform set_config('marketa_batch1a.frozen_security', (
    select jsonb_agg(jsonb_build_object(
      'oid', c.oid, 'acl', c.relacl, 'owner', c.relowner,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'options', c.reloptions,
      'policies', (select jsonb_agg(to_jsonb(p) order by p.polname)
                  from pg_policy p where p.polrelid = c.oid),
      'columns', (select jsonb_agg(to_jsonb(a) order by a.attnum)
                  from pg_attribute a where a.attrelid = c.oid and a.attnum > 0),
      'constraints', (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname)
                      from pg_constraint k where k.conrelid = c.oid),
      'triggers', (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname)
                   from pg_trigger t where t.tgrelid = c.oid)
    ) order by c.oid)::text
    from pg_class c where c.oid in (
      'public.vendor_verifications'::regclass, 'public.public_active_vendors'::regclass
    )
  ), true);
end
$data_preflight$;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users owner to postgres;
alter table public.admin_users enable row level security;
revoke all privileges on table public.admin_users from public, anon, authenticated;
grant all privileges on table public.admin_users to service_role;

alter table public.vendor_applications
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column provisioning_status text not null default 'not_started',
  add column auth_user_id uuid references auth.users(id) on delete restrict,
  add column vendor_id uuid references public.vendors(id) on delete restrict,
  add column provisioning_started_at timestamptz,
  add column invited_at timestamptz,
  add column provisioned_at timestamptz,
  add column provisioning_error_code text,
  add constraint vendor_applications_provisioning_status_check
    check (provisioning_status in (
      'not_started', 'in_progress', 'awaiting_enrollment', 'provisioned', 'failed'
    )),
  add constraint vendor_applications_provisioning_error_code_check
    check (provisioning_error_code is null or (
      char_length(provisioning_error_code) between 1 and 100
      and provisioning_error_code ~ '^[A-Za-z][A-Za-z0-9_]*$'
    )),
  add constraint vendor_applications_review_provisioning_check
    check (status = 'approved' or (
      provisioning_status = 'not_started'
      and vendor_id is null and provisioned_at is null
    )),
  add constraint vendor_applications_pending_provisioning_check
    check (provisioning_status not in (
      'not_started', 'in_progress', 'awaiting_enrollment'
    ) or (vendor_id is null and provisioned_at is null)),
  add constraint vendor_applications_provisioned_check
    check (provisioning_status <> 'provisioned' or (
      status = 'approved' and auth_user_id is not null
      and vendor_id is not null and provisioned_at is not null
    )),
  add constraint vendor_applications_failed_provisioning_check
    check (provisioning_status <> 'failed' or (
      status = 'approved' and (
        (vendor_id is null and provisioned_at is null)
        or (vendor_id is not null and auth_user_id is not null and provisioned_at is not null)
      )
    ));

-- No timestamp ordering/lease rules: Batch 1B will implement retry transitions.
-- A failed state may retain a complete finalization tuple, never a partial one.
-- Provisioning links explicitly restrict deletion of referenced Auth users/vendors.
-- Account/vendor deletion semantics require a future explicit deprovisioning design.
comment on column public.vendor_applications.provisioning_error_code is
  'Private safe machine code (1-100 ASCII letters/digits/underscores, leading letter); never raw exceptions or secrets.';

create trigger vendor_applications_updated_at
before update on public.vendor_applications
for each row execute function public.handle_updated_at();

-- Preserve the index name used by the public RPC's duplicate handler.
drop index public.vendor_applications_active_email_unique;
create unique index vendor_applications_active_email_unique
on public.vendor_applications (lower(btrim(email)))
where status in ('submitted', 'under_review', 'approved');

create unique index vendors_email_normalized_unique
on public.vendors (lower(btrim(email)));

alter table public.vendors
  alter column is_active set default false,
  alter column is_active set not null;

revoke all privileges on table public.vendors from public, anon, authenticated;
grant select on table public.vendors to authenticated;
grant update (name, phone, bank_details) on table public.vendors to authenticated;

alter policy vendor_select_own on public.vendors
to authenticated
using (user_id = (select auth.uid()));

alter policy vendor_update_own on public.vendors
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create or replace function public.submit_vendor_application(
  p_business_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_business_category text,
  p_location text,
  p_business_description text,
  p_product_summary text,
  p_experience text,
  p_terms_accepted boolean
)
returns table (
  outcome text,
  application_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_business_name text := pg_catalog.btrim(p_business_name);
  normalized_contact_name text := pg_catalog.btrim(p_contact_name);
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  normalized_phone text := pg_catalog.btrim(p_phone);
  normalized_business_category text := pg_catalog.btrim(p_business_category);
  normalized_location text := pg_catalog.btrim(p_location);
  normalized_business_description text := pg_catalog.btrim(p_business_description);
  normalized_product_summary text := pg_catalog.btrim(p_product_summary);
  normalized_experience text := case
    when p_experience is null then null
    else pg_catalog.btrim(p_experience)
  end;
  inserted_application_id uuid;
  violated_constraint text;
begin
  if normalized_business_name is null
    or normalized_business_name = ''
    or pg_catalog.char_length(normalized_business_name) > 120
  then
    raise exception using
      errcode = '22023',
      message = 'business_name must be between 1 and 120 characters.';
  end if;

  if normalized_contact_name is null
    or normalized_contact_name = ''
    or pg_catalog.char_length(normalized_contact_name) > 120
  then
    raise exception using
      errcode = '22023',
      message = 'contact_name must be between 1 and 120 characters.';
  end if;

  if normalized_email is null
    or pg_catalog.char_length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'Enter a valid email address (3-254 characters).';
  end if;

  if normalized_phone is null
    or normalized_phone = ''
    or pg_catalog.char_length(normalized_phone) > 32
  then
    raise exception using
      errcode = '22023',
      message = 'phone must be between 1 and 32 characters.';
  end if;

  if normalized_business_category is null
    or normalized_business_category = ''
    or pg_catalog.char_length(normalized_business_category) > 100
  then
    raise exception using
      errcode = '22023',
      message = 'business_category must be between 1 and 100 characters.';
  end if;

  if normalized_location is null
    or normalized_location = ''
    or pg_catalog.char_length(normalized_location) > 160
  then
    raise exception using
      errcode = '22023',
      message = 'location must be between 1 and 160 characters.';
  end if;

  if normalized_business_description is null
    or normalized_business_description = ''
    or pg_catalog.char_length(normalized_business_description) > 2000
  then
    raise exception using
      errcode = '22023',
      message = 'business_description must be between 1 and 2000 characters.';
  end if;

  if normalized_product_summary is null
    or normalized_product_summary = ''
    or pg_catalog.char_length(normalized_product_summary) > 2000
  then
    raise exception using
      errcode = '22023',
      message = 'product_summary must be between 1 and 2000 characters.';
  end if;

  if normalized_experience is not null
    and (
      normalized_experience = ''
      or pg_catalog.char_length(normalized_experience) > 2000
    )
  then
    raise exception using
      errcode = '22023',
      message = 'experience must be null or between 1 and 2000 characters.';
  end if;

  if p_terms_accepted is distinct from true then
    raise exception using
      errcode = '22023',
      message = 'terms_accepted must be true.';
  end if;

  begin
    insert into public.vendor_applications (
      business_name,
      contact_name,
      email,
      phone,
      business_category,
      location,
      business_description,
      product_summary,
      experience,
      terms_accepted,
      status,
      review_notes,
      reviewed_at
    )
    values (
      normalized_business_name,
      normalized_contact_name,
      normalized_email,
      normalized_phone,
      normalized_business_category,
      normalized_location,
      normalized_business_description,
      normalized_product_summary,
      normalized_experience,
      true,
      'submitted',
      null,
      null
    )
    returning id into inserted_application_id;

    return query
    select 'submitted'::text, inserted_application_id;
    return;

  exception
    when unique_violation then
      get stacked diagnostics
        violated_constraint = constraint_name;

      if violated_constraint = 'vendor_applications_active_email_unique' then
        return query
        select 'duplicate_active_application'::text, null::uuid;
        return;
      end if;

      raise exception using
        errcode = 'P0001', message = 'Unable to submit application.';
    when others then
      -- Do not expose raw database exceptions from the write.
      raise exception using
        errcode = 'P0001', message = 'Unable to submit application.';
  end;
end
$function$;

-- CREATE OR REPLACE preserves ownership/grants; make the allowed API explicit.
alter function public.submit_vendor_application(
  text, text, text, text, text, text, text, text, text, boolean
) owner to postgres;
revoke all privileges on function public.submit_vendor_application(
  text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.submit_vendor_application(
  text, text, text, text, text, text, text, text, text, boolean
) to anon, authenticated, service_role;

do $postcondition$
declare
  relation_name text;
  role_name text;
  privilege_name text;
  column_record record;
  expected_fk record;
  snapshot_value text;
begin
  if (select count(*) from pg_attribute
      where attrelid = 'public.admin_users'::regclass
        and attnum > 0 and not attisdropped) <> 2
    or not exists (
      select 1 from pg_attribute
      where attrelid = 'public.admin_users'::regclass
        and attname = 'user_id' and atttypid = 'uuid'::regtype and attnotnull
    ) or not exists (
      select 1 from pg_attribute a join pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.admin_users'::regclass
        and a.attname = 'created_at' and a.atttypid = 'timestamptz'::regtype
        and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'now()'
    ) or not exists (
      select 1 from pg_constraint where conrelid = 'public.admin_users'::regclass
        and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)'
    ) or exists (select 1 from public.admin_users)
  then
    raise exception 'Batch 1A postcondition: admin schema/empty bootstrap state is incorrect.';
  end if;

  for expected_fk in
    select * from (values
      ('public.admin_users', 'user_id', 'auth.users', 'c'),
      ('public.vendor_applications', 'reviewed_by', 'auth.users', 'n'),
      ('public.vendor_applications', 'auth_user_id', 'auth.users', 'r'),
      ('public.vendor_applications', 'vendor_id', 'public.vendors', 'r')
    ) as expected(table_name, column_name, target_table, delete_action)
  loop
    if (select count(*) from pg_constraint k
        join pg_attribute a on a.attrelid = k.conrelid
          and k.conkey = array[a.attnum]::smallint[]
        join pg_attribute target on target.attrelid = k.confrelid
          and k.confkey = array[target.attnum]::smallint[]
        where k.conrelid = to_regclass(expected_fk.table_name) and k.contype = 'f'
          and a.attname = expected_fk.column_name
          and k.confrelid = to_regclass(expected_fk.target_table) and target.attname = 'id'
          and k.confdeltype::text = expected_fk.delete_action and k.convalidated) <> 1
    then
      raise exception 'Batch 1A postcondition: incorrect FK for %.%.',
        expected_fk.table_name, expected_fk.column_name;
    end if;
  end loop;

  if exists (
    select 1 from (values
      ('reviewed_by', 'uuid', false),
      ('provisioning_status', 'text', true),
      ('auth_user_id', 'uuid', false),
      ('vendor_id', 'uuid', false),
      ('provisioning_started_at', 'timestamp with time zone', false),
      ('invited_at', 'timestamp with time zone', false),
      ('provisioned_at', 'timestamp with time zone', false),
      ('provisioning_error_code', 'text', false)
    ) expected(column_name, type_name, not_null)
    left join pg_attribute a
      on a.attrelid = 'public.vendor_applications'::regclass
        and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
    where a.attnum is null or format_type(a.atttypid, a.atttypmod) <> expected.type_name
      or a.attnotnull is distinct from expected.not_null
  ) or not exists (
    select 1 from pg_attribute a join pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.vendor_applications'::regclass
      and a.attname = 'provisioning_status'
      and pg_get_expr(d.adbin, d.adrelid) = '''not_started''::text'
  ) then
    raise exception 'Batch 1A postcondition: application columns/default are incorrect.';
  end if;

  if (select count(*) from pg_constraint
      where conrelid = 'public.vendor_applications'::regclass
        and contype = 'c' and convalidated and conname in (
          'vendor_applications_provisioning_status_check',
          'vendor_applications_provisioning_error_code_check',
          'vendor_applications_review_provisioning_check',
          'vendor_applications_pending_provisioning_check',
          'vendor_applications_provisioned_check',
          'vendor_applications_failed_provisioning_check'
        )) <> 6
    or not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.vendor_applications'::regclass
        and tgname = 'vendor_applications_updated_at' and not tgisinternal
        and tgfoid = 'public.handle_updated_at()'::regprocedure
        and tgtype = 19 and tgenabled = 'O'
    )
  then
    raise exception 'Batch 1A postcondition: application CHECKs/trigger are incomplete.';
  end if;

  foreach relation_name in array array['public.admin_users', 'public.vendor_applications'] loop
    if not exists (
      select 1 from pg_class where oid = to_regclass(relation_name)
        and relrowsecurity and relowner = 'postgres'::regrole
    ) or exists (
      select 1 from pg_policy where polrelid = to_regclass(relation_name)
    ) or exists (
      select 1 from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = to_regclass(relation_name)
        and a.grantee not in ('postgres'::regrole, 'service_role'::regrole)
    ) then
      raise exception 'Batch 1A postcondition: private security boundary incorrect on %.', relation_name;
    end if;

    foreach privilege_name in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] loop
      if has_table_privilege('anon', relation_name, privilege_name)
        or has_table_privilege('authenticated', relation_name, privilege_name)
        or not has_table_privilege('service_role', relation_name, privilege_name)
      then
        raise exception 'Batch 1A postcondition: incorrect % privilege on %.',
          privilege_name, relation_name;
      end if;
    end loop;
  end loop;

  if not exists (
    select 1 from pg_attribute a join pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.vendors'::regclass and a.attname = 'is_active'
      and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false'
  ) or not exists (
    select 1 from pg_class where oid = 'public.vendors'::regclass and relrowsecurity
  ) then
    raise exception 'Batch 1A postcondition: vendor activation default/nullability or RLS incorrect.';
  end if;

  if not has_table_privilege('authenticated', 'public.vendors', 'SELECT') then
    raise exception 'Batch 1A postcondition: vendor SELECT missing.';
  end if;
  foreach privilege_name in array array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] loop
    if has_table_privilege('authenticated', 'public.vendors', privilege_name) then
      raise exception 'Batch 1A postcondition: excess vendor table privilege %.', privilege_name;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c
    cross join lateral aclexplode(c.relacl) a
    where c.oid = 'public.vendors'::regclass
      and (a.grantee = 0
        or (a.grantee = 'authenticated'::regrole and a.is_grantable))
  ) then
    raise exception 'Batch 1A postcondition: PUBLIC/vendor grant options remain.';
  end if;

  for column_record in
    select attname from pg_attribute
    where attrelid = 'public.vendors'::regclass and attnum > 0 and not attisdropped
  loop
    if has_column_privilege('authenticated', 'public.vendors', column_record.attname, 'UPDATE')
      is distinct from (column_record.attname in ('name', 'phone', 'bank_details'))
      or has_column_privilege('authenticated', 'public.vendors', column_record.attname, 'INSERT')
      or has_column_privilege('authenticated', 'public.vendors', column_record.attname, 'REFERENCES')
      or has_column_privilege('authenticated', 'public.vendors', column_record.attname, 'UPDATE WITH GRANT OPTION')
    then
      raise exception 'Batch 1A postcondition: incorrect vendor column privilege on %.', column_record.attname;
    end if;
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_column_privilege('anon', 'public.vendors', column_record.attname, privilege_name) then
        raise exception 'Batch 1A postcondition: anonymous vendor column access remains.';
      end if;
    end loop;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vendors') <> 2
    or (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'vendors'
          and roles = array['authenticated']::name[] and permissive = 'PERMISSIVE'
          and regexp_replace(qual, '[[:space:]()]', '', 'g') = 'user_id=SELECTauth.uidASuid'
          and ((policyname = 'vendor_select_own' and cmd = 'SELECT' and with_check is null)
            or (policyname = 'vendor_update_own' and cmd = 'UPDATE'
              and regexp_replace(with_check, '[[:space:]()]', '', 'g') = 'user_id=SELECTauth.uidASuid'))) <> 2
  then
    raise exception 'Batch 1A postcondition: vendor ownership policy expressions are incorrect.';
  end if;

  if not exists (
    select 1 from pg_index
    where indexrelid = 'public.vendor_applications_active_email_unique'::regclass
      and indisunique and indisvalid and indnkeyatts = 1
      and pg_get_expr(indexprs, indrelid) = 'lower(btrim(email))'
      and pg_get_expr(indpred, indrelid)
        = '(status = ANY (ARRAY[''submitted''::text, ''under_review''::text, ''approved''::text]))'
  ) or not exists (
    select 1 from pg_index
    where indexrelid = 'public.vendors_email_normalized_unique'::regclass
      and indisunique and indisvalid and indnkeyatts = 1
      and pg_get_expr(indexprs, indrelid) = 'lower(btrim(email))' and indpred is null
  ) or not exists (
    select 1 from pg_constraint where conrelid = 'public.vendors'::regclass
      and conname = 'vendors_email_key' and contype = 'u'
  ) then
    raise exception 'Batch 1A postcondition: normalized email uniqueness is incorrect.';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.submit_vendor_application(text,text,text,text,text,text,text,text,text,boolean)'::regprocedure
      and prosecdef and proowner = 'postgres'::regrole
      and proconfig @> array['search_path=""']
      and pg_get_function_result(oid) = 'TABLE(outcome text, application_id uuid)'
  ) or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.submit_vendor_application(text,text,text,text,text,text,text,text,text,boolean)'::regprocedure
      and a.grantee not in ('postgres'::regrole, 'service_role'::regrole,
        'anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'Batch 1A postcondition: public submission RPC boundary changed.';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if not has_function_privilege(role_name,
      'public.submit_vendor_application(text,text,text,text,text,text,text,text,text,boolean)', 'EXECUTE')
    then
      raise exception 'Batch 1A postcondition: submission RPC execution missing for %.', role_name;
    end if;
  end loop;

  select md5(coalesce(string_agg(to_jsonb(v)::text, E'\n' order by id), ''))
  into snapshot_value from public.vendors v;
  if snapshot_value is distinct from current_setting('marketa_batch1a.vendors_data') then
    raise exception 'Batch 1A postcondition: existing vendor data changed.';
  end if;
  select md5(coalesce(string_agg((to_jsonb(a) - array[
    'reviewed_by', 'provisioning_status', 'auth_user_id', 'vendor_id',
    'provisioning_started_at', 'invited_at', 'provisioned_at', 'provisioning_error_code'
  ])::text, E'\n' order by id), ''))
  into snapshot_value from public.vendor_applications a;
  if snapshot_value is distinct from current_setting('marketa_batch1a.applications_data') then
    raise exception 'Batch 1A postcondition: existing application data changed.';
  end if;
  select md5(coalesce(string_agg(to_jsonb(v)::text, E'\n' order by vendor_id), ''))
  into snapshot_value from public.vendor_verifications v;
  if snapshot_value is distinct from current_setting('marketa_batch1a.verifications_data') then
    raise exception 'Batch 1A postcondition: verification data changed.';
  end if;
  select md5(coalesce(string_agg(to_jsonb(v)::text, E'\n' order by id), ''))
  into snapshot_value from public.public_active_vendors v;
  if snapshot_value is distinct from current_setting('marketa_batch1a.public_rows')
    or pg_get_viewdef('public.public_active_vendors'::regclass, true)
      is distinct from current_setting('marketa_batch1a.view_definition')
    or exists (
      select id from public.public_active_vendors
      except select id from public.vendors where is_active = true
    ) or exists (
      select id from public.vendors where is_active = true
      except select id from public.public_active_vendors
    )
  then
    raise exception 'Batch 1A postcondition: active vendor view definition/visibility changed.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'oid', c.oid, 'acl', c.relacl, 'owner', c.relowner,
    'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'options', c.reloptions,
    'policies', (select jsonb_agg(to_jsonb(p) order by p.polname)
                from pg_policy p where p.polrelid = c.oid),
    'columns', (select jsonb_agg(to_jsonb(a) order by a.attnum)
                from pg_attribute a where a.attrelid = c.oid and a.attnum > 0),
    'constraints', (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname)
                    from pg_constraint k where k.conrelid = c.oid),
    'triggers', (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname)
                 from pg_trigger t where t.tgrelid = c.oid)
  ) order by c.oid)::text into snapshot_value
  from pg_class c where c.oid in (
    'public.vendor_verifications'::regclass, 'public.public_active_vendors'::regclass
  );
  if snapshot_value is distinct from current_setting('marketa_batch1a.frozen_security') then
    raise exception 'Batch 1A postcondition: frozen verification/view metadata changed.';
  end if;
end
$postcondition$;

commit;
