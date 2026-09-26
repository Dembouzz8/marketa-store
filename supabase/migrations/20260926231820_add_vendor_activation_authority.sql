-- Batch 4C1: privileged seller activation authority and durable activation audit.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  user_id_attribute smallint;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = 'vendors'
      and class.relkind = 'r'
      and class.relrowsecurity
  ) then
    raise exception 'Batch 4C1: public.vendors is missing, is not a table, or does not have RLS enabled.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.vendor_applications'::pg_catalog.regclass
      and class.relkind = 'r'
  ) or not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.admin_users'::pg_catalog.regclass
      and class.relkind = 'r'
  ) then
    raise exception 'Batch 4C1: required application or admin table is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and attribute.atttypid = 'boolean'::pg_catalog.regtype
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(
        default_value.adbin,
        default_value.adrelid
      ) = 'false'
  ) then
    raise exception 'Batch 4C1: vendors.is_active no longer matches the audited baseline.';
  end if;

  if pg_catalog.has_table_privilege(
    'authenticated',
    'public.vendors',
    'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated',
    'public.vendors',
    'is_active',
    'UPDATE'
  ) then
    raise exception 'Batch 4C1: authenticated can update vendor activation state.';
  end if;

  select attribute.attnum
  into user_id_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
    and attribute.attname = 'user_id'
    and attribute.atttypid = 'uuid'::pg_catalog.regtype
    and attribute.attnotnull
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if user_id_attribute is null or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
      and constraint_record.conkey =
        array[user_id_attribute]::smallint[]
  ) then
    raise exception 'Batch 4C1: vendors.user_id is not the expected NOT NULL unique UUID.';
  end if;

  if exists (
    select 1
    from (values
      ('public.vendor_applications', 'id', 'uuid', true),
      ('public.vendor_applications', 'status', 'text', true),
      ('public.vendor_applications', 'provisioning_status', 'text', true),
      ('public.vendor_applications', 'auth_user_id', 'uuid', false),
      ('public.vendor_applications', 'vendor_id', 'uuid', false),
      ('public.vendor_applications', 'provisioned_at', 'timestamp with time zone', false),
      ('public.vendors', 'id', 'uuid', true),
      ('public.vendors', 'user_id', 'uuid', true),
      ('public.vendors', 'is_active', 'boolean', true),
      ('public.admin_users', 'user_id', 'uuid', true)
    ) as expected(table_name, column_name, data_type, not_null)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = pg_catalog.to_regclass(expected.table_name)
      and attribute.attname = expected.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped
    where attribute.attnum is null
      or pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) <> expected.data_type
      or attribute.attnotnull is distinct from expected.not_null
  ) then
    raise exception 'Batch 4C1: activation linkage columns or nullability changed.';
  end if;

  if exists (
    select 1
    from (values
      (
        'public.vendor_applications',
        'vendor_applications_status_check',
        'CHECK ((status = ANY (ARRAY[''submitted''::text, ''under_review''::text, ''approved''::text, ''rejected''::text])))'
      ),
      (
        'public.vendor_applications',
        'vendor_applications_provisioning_status_check',
        'CHECK ((provisioning_status = ANY (ARRAY[''not_started''::text, ''in_progress''::text, ''awaiting_enrollment''::text, ''provisioned''::text, ''failed''::text])))'
      ),
      (
        'public.vendor_applications',
        'vendor_applications_provisioned_check',
        'CHECK (((provisioning_status <> ''provisioned''::text) OR ((status = ''approved''::text) AND (auth_user_id IS NOT NULL) AND (vendor_id IS NOT NULL) AND (provisioned_at IS NOT NULL))))'
      ),
      (
        'public.vendor_applications',
        'vendor_applications_auth_user_id_fkey',
        'FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT'
      ),
      (
        'public.vendor_applications',
        'vendor_applications_vendor_id_fkey',
        'FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT'
      ),
      (
        'public.vendors',
        'vendors_user_id_fkey',
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
      )
    ) as expected(table_name, constraint_name, definition)
    left join pg_catalog.pg_constraint as constraint_record
      on constraint_record.conrelid =
        pg_catalog.to_regclass(expected.table_name)
      and constraint_record.conname = expected.constraint_name
    where constraint_record.oid is null
      or not constraint_record.convalidated
      or pg_catalog.pg_get_constraintdef(constraint_record.oid)
        <> expected.definition
  ) then
    raise exception 'Batch 4C1: application status, provisioning, or linkage constraints changed.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname in ('activated_at', 'activated_by')
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception 'Batch 4C1: a vendor activation audit column already exists.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.conname = 'vendors_activation_audit_pair_check'
  ) then
    raise exception 'Batch 4C1: vendor activation audit constraint name is occupied.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'activate_vendor_application'
  ) then
    raise exception 'Batch 4C1: vendor activation authority name is occupied.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'public.products'::pg_catalog.regclass
      and class.relrowsecurity
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) <> 5 then
    raise exception 'Batch 4C1: Batch 4A product RLS baseline changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = 'storage.objects'::pg_catalog.regclass
      and class.relrowsecurity
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
  ) <> 2 then
    raise exception 'Batch 4C1: Batch 4B1 Storage RLS baseline changed.';
  end if;
end
$preflight$;

lock table public.vendors, public.vendor_applications, public.admin_users
in access exclusive mode;

do $snapshot$
begin
  perform pg_catalog.set_config(
    'marketa_batch4c1.vendor_rows',
    (
      select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(vendor)::text,
          E'\n' order by vendor.id
        ),
        ''
      ))
      from public.vendors as vendor
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_batch4c1.application_rows',
    (
      select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(application)::text,
          E'\n' order by application.id
        ),
        ''
      ))
      from public.vendor_applications as application
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_batch4c1.vendors_acl',
    (
      select coalesce(class.relacl::text, 'NULL')
      from pg_catalog.pg_class as class
      where class.oid = 'public.vendors'::pg_catalog.regclass
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_batch4c1.products_security',
    (
      select pg_catalog.jsonb_build_object(
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(policy)
            order by policy.policyname
          )
          from pg_catalog.pg_policies as policy
          where policy.schemaname = 'public'
            and policy.tablename = 'products'
        ), '[]'::pg_catalog.jsonb)
      )::text
      from pg_catalog.pg_class as class
      where class.oid = 'public.products'::pg_catalog.regclass
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_batch4c1.storage_security',
    (
      select pg_catalog.jsonb_build_object(
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(policy)
            order by policy.policyname
          )
          from pg_catalog.pg_policies as policy
          where policy.schemaname = 'storage'
            and policy.tablename = 'objects'
        ), '[]'::pg_catalog.jsonb)
      )::text
      from pg_catalog.pg_class as class
      where class.oid = 'storage.objects'::pg_catalog.regclass
    ),
    true
  );
end
$snapshot$;

alter table public.vendors
  add column activated_at timestamptz,
  add column activated_by uuid,
  add constraint vendors_activation_audit_pair_check
    check (
      (
        activated_at is null
        and activated_by is null
      )
      or (
        activated_at is not null
        and activated_by is not null
      )
    );

create function public.activate_vendor_application(
  p_application_id uuid,
  p_admin_user_id uuid
)
returns table (
  outcome text,
  application_id uuid,
  vendor_id uuid,
  is_active boolean,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_application public.vendor_applications%rowtype;
  v_vendor public.vendors%rowtype;
  v_activated_at timestamptz;
begin
  application_id := p_application_id;

  if p_application_id is null or p_admin_user_id is null then
    outcome := 'invalid_input';
    vendor_id := null;
    is_active := null;
    activated_at := null;
    return next;
    return;
  end if;

  -- Lock membership so concurrent admin revocation cannot pass authorization.
  perform 1
  from public.admin_users as administrator
  where administrator.user_id = p_admin_user_id
  for share;

  if not found then
    outcome := 'unauthorized';
    vendor_id := null;
    is_active := null;
    activated_at := null;
    return next;
    return;
  end if;

  select application.*
  into v_application
  from public.vendor_applications as application
  where application.id = p_application_id
  for update;

  if not found then
    outcome := 'unavailable';
    vendor_id := null;
    is_active := null;
    activated_at := null;
    return next;
    return;
  end if;

  if v_application.status <> 'approved'
    or v_application.provisioning_status <> 'provisioned'
    or v_application.vendor_id is null
    or v_application.auth_user_id is null
    or v_application.provisioned_at is null
  then
    outcome := 'invalid_state';
    vendor_id := null;
    is_active := null;
    activated_at := null;
    return next;
    return;
  end if;

  select vendor.*
  into v_vendor
  from public.vendors as vendor
  where vendor.id = v_application.vendor_id
  for update;

  if not found
    or v_vendor.id is distinct from v_application.vendor_id
    or v_vendor.user_id is null
    or v_vendor.user_id is distinct from v_application.auth_user_id
  then
    outcome := 'invalid_state';
    vendor_id := null;
    is_active := null;
    activated_at := null;
    return next;
    return;
  end if;

  if v_vendor.is_active then
    outcome := 'already_active';
    vendor_id := v_vendor.id;
    is_active := true;
    activated_at := v_vendor.activated_at;
    return next;
    return;
  end if;

  v_activated_at := pg_catalog.transaction_timestamp();

  update public.vendors as vendor
  set is_active = true,
      activated_at = v_activated_at,
      activated_by = p_admin_user_id
  where vendor.id = v_vendor.id
    and vendor.is_active = false
  returning
    vendor.id,
    vendor.is_active,
    vendor.activated_at
  into vendor_id, is_active, activated_at;

  if not found
    or is_active is distinct from true
    or activated_at is distinct from v_activated_at
  then
    raise exception using
      errcode = 'P1001',
      message = 'Vendor activation update failed.';
  end if;

  outcome := 'activated';
  return next;
  return;
exception
  when others then
    -- The function subtransaction rolls back activation and audit writes.
    outcome := 'operation_failed';
    application_id := p_application_id;
    vendor_id := null;
    is_active := null;
    activated_at := null;
    return next;
    return;
end
$function$;

alter function public.activate_vendor_application(uuid, uuid)
owner to postgres;

revoke all privileges on function
public.activate_vendor_application(uuid, uuid)
from public, anon, authenticated;

grant execute on function
public.activate_vendor_application(uuid, uuid)
to service_role;

do $postcondition$
declare
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.activate_vendor_application(uuid,uuid)'
  );
  rpc_source text;
  activated_by_attribute smallint;
  products_security text;
  storage_security text;
begin
  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    left join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname in ('activated_at', 'activated_by')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and not attribute.attnotnull
      and default_value.oid is null
      and (
        (
          attribute.attname = 'activated_at'
          and attribute.atttypid =
            'timestamp with time zone'::pg_catalog.regtype
        )
        or (
          attribute.attname = 'activated_by'
          and attribute.atttypid = 'uuid'::pg_catalog.regtype
        )
      )
  ) <> 2 then
    raise exception 'Batch 4C1 postcondition: activation audit columns are incorrect.';
  end if;

  select attribute.attnum
  into activated_by_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
    and attribute.attname = 'activated_by'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if activated_by_attribute is null or exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and activated_by_attribute = any(constraint_record.conkey)
  ) then
    raise exception 'Batch 4C1 postcondition: activated_by has an unexpected foreign key.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.conname = 'vendors_activation_audit_pair_check'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(
          constraint_record.conbin,
          constraint_record.conrelid
        ),
        '[[:space:]()]',
        '',
        'g'
      )) =
        'activated_atisnullandactivated_byisnulloractivated_atisnotnullandactivated_byisnotnull'
  ) then
    raise exception 'Batch 4C1 postcondition: activation audit pair constraint is incorrect.';
  end if;

  if pg_catalog.has_column_privilege(
    'authenticated',
    'public.vendors',
    'is_active',
    'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated',
    'public.vendors',
    'activated_at',
    'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated',
    'public.vendors',
    'activated_by',
    'UPDATE'
  ) then
    raise exception 'Batch 4C1 postcondition: authenticated can update activation columns.';
  end if;

  if (
    select coalesce(class.relacl::text, 'NULL')
    from pg_catalog.pg_class as class
    where class.oid = 'public.vendors'::pg_catalog.regclass
  ) is distinct from pg_catalog.current_setting(
    'marketa_batch4c1.vendors_acl'
  ) then
    raise exception 'Batch 4C1 postcondition: vendor table grants changed.';
  end if;

  if rpc_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_language as language
      on language.oid = procedure.prolang
    where procedure.oid = rpc_oid
      and procedure.proowner = 'postgres'::pg_catalog.regrole
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig is not distinct from
        array['search_path=""']::text[]
      and language.lanname = 'plpgsql'
      and pg_catalog.pg_get_function_result(procedure.oid) =
        'TABLE(outcome text, application_id uuid, vendor_id uuid, is_active boolean, activated_at timestamp with time zone)'
  ) then
    raise exception 'Batch 4C1 postcondition: activation RPC metadata is incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )) as acl
    where procedure.oid = rpc_oid
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee = 0
  ) or pg_catalog.has_function_privilege(
    'anon',
    rpc_oid,
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    rpc_oid,
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    rpc_oid,
    'EXECUTE'
  ) or exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )) as acl
    where procedure.oid = rpc_oid
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee not in (
        procedure.proowner,
        'service_role'::pg_catalog.regrole
      )
  ) then
    raise exception 'Batch 4C1 postcondition: activation RPC grants are incorrect.';
  end if;

  select pg_catalog.lower(procedure.prosrc)
  into rpc_source
  from pg_catalog.pg_proc as procedure
  where procedure.oid = rpc_oid;

  if rpc_source is null
    or position('public.admin_users' in rpc_source) = 0
    or position('public.vendor_applications' in rpc_source) = 0
    or position('public.vendors' in rpc_source) = 0
    or position('for share' in rpc_source) = 0
    or position('for update' in rpc_source) = 0
    or position('update public.vendors' in rpc_source) = 0
    or position('vendor_verifications' in rpc_source) > 0
    or position('products' in rpc_source) > 0
    or position('storage.' in rpc_source) > 0
    or position('orders' in rpc_source) > 0
    or position('payout' in rpc_source) > 0
  then
    raise exception 'Batch 4C1 postcondition: activation RPC structure is incorrect.';
  end if;

  if (
    select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(
        (
          pg_catalog.to_jsonb(vendor)
          - 'activated_at'
          - 'activated_by'
        )::text,
        E'\n' order by vendor.id
      ),
      ''
    ))
    from public.vendors as vendor
  ) is distinct from pg_catalog.current_setting(
    'marketa_batch4c1.vendor_rows'
  ) then
    raise exception 'Batch 4C1 postcondition: existing vendor rows were rewritten.';
  end if;

  if (
    select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(application)::text,
        E'\n' order by application.id
      ),
      ''
    ))
    from public.vendor_applications as application
  ) is distinct from pg_catalog.current_setting(
    'marketa_batch4c1.application_rows'
  ) then
    raise exception 'Batch 4C1 postcondition: application rows were rewritten.';
  end if;

  select pg_catalog.jsonb_build_object(
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy)
        order by policy.policyname
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ), '[]'::pg_catalog.jsonb)
  )::text
  into products_security
  from pg_catalog.pg_class as class
  where class.oid = 'public.products'::pg_catalog.regclass;

  if products_security is distinct from pg_catalog.current_setting(
    'marketa_batch4c1.products_security'
  ) then
    raise exception 'Batch 4C1 postcondition: product RLS changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy)
        order by policy.policyname
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
    ), '[]'::pg_catalog.jsonb)
  )::text
  into storage_security
  from pg_catalog.pg_class as class
  where class.oid = 'storage.objects'::pg_catalog.regclass;

  if storage_security is distinct from pg_catalog.current_setting(
    'marketa_batch4c1.storage_security'
  ) then
    raise exception 'Batch 4C1 postcondition: Storage RLS changed.';
  end if;
end
$postcondition$;

commit;
