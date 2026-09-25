-- Batch 4B1: allow active vendors to upload only within their own product-image namespace.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public, storage;

do $preflight$
declare
  vendor_select record;
  normalized_qual text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'storage'
      and class.relname = 'objects'
      and class.relkind = 'r'
      and class.relrowsecurity
  ) then
    raise exception 'Batch 4B1: storage.objects is missing, is not a table, or does not have RLS enabled.';
  end if;

  if not exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'product-images'
      and bucket.name = 'product-images'
      and bucket.public
  ) then
    raise exception 'Batch 4B1: the public product-images bucket is missing or no longer public.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
  ) then
    raise exception 'Batch 4B1: storage.objects policies no longer match the audited empty baseline.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'vendor_select_own_active_product_images',
        'vendor_insert_own_active_product_images'
      )
  ) then
    raise exception 'Batch 4B1: a product-image policy name is already occupied.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = pg_catalog.to_regclass('public.vendors')
      and relkind = 'r'
      and relrowsecurity
  ) then
    raise exception 'Batch 4B1: public.vendors is missing, is not a table, or does not have RLS enabled.';
  end if;

  select policy.*
  into vendor_select
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'vendors'
    and policy.policyname = 'vendor_select_own';

  normalized_qual := pg_catalog.lower(pg_catalog.replace(
    pg_catalog.regexp_replace(vendor_select.qual, '[[:space:]()]', '', 'g'),
    'public.',
    ''
  ));

  if vendor_select.policyname is null
    or vendor_select.cmd <> 'SELECT'
    or vendor_select.permissive <> 'PERMISSIVE'
    or vendor_select.roles is distinct from array['authenticated']::name[]
    or vendor_select.with_check is not null
    or normalized_qual not in (
      'user_id=auth.uid',
      'user_id=selectauth.uidasuid'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.vendors',
      'SELECT'
    )
  then
    raise exception 'Batch 4B1: authenticated vendor own-row SELECT no longer matches the audited baseline.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'false'
  )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.vendors',
      'UPDATE'
    )
    or pg_catalog.has_column_privilege(
      'authenticated',
      'public.vendors',
      'is_active',
      'UPDATE'
    )
  then
    raise exception 'Batch 4B1: vendor activation protection no longer matches the audited baseline.';
  end if;
end
$preflight$;

create policy vendor_select_own_active_product_images
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] in (
    select vendors.id::text as vendor_id_text
    from public.vendors
    where vendors.user_id = (select auth.uid())
      and vendors.is_active = true
  )
);

create policy vendor_insert_own_active_product_images
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] in (
    select vendors.id::text as vendor_id_text
    from public.vendors
    where vendors.user_id = (select auth.uid())
      and vendors.is_active = true
  )
);

do $postcondition$
declare
  policy_record record;
  foldername_dependency_ok boolean;
  normalized_expression text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'storage'
      and class.relname = 'objects'
      and class.relkind = 'r'
      and class.relrowsecurity
  ) then
    raise exception 'Batch 4B1 postcondition: storage.objects RLS is not enabled.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
  ) <> 2 then
    raise exception 'Batch 4B1 postcondition: unexpected storage.objects policy count.';
  end if;

  select policy.*
  into policy_record
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'storage'
    and policy.tablename = 'objects'
    and policy.policyname = 'vendor_select_own_active_product_images';

  foldername_dependency_ok := exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_depend as dependency
      on dependency.classid = 'pg_policy'::pg_catalog.regclass
      and dependency.objid = policy.oid
      and dependency.refclassid = 'pg_proc'::pg_catalog.regclass
    where policy.polrelid = 'storage.objects'::pg_catalog.regclass
      and policy.polname = 'vendor_select_own_active_product_images'
      and dependency.refobjid =
        pg_catalog.to_regprocedure('storage.foldername(text)')
  );

  normalized_expression := pg_catalog.lower(pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.regexp_replace(
            policy_record.qual,
            '[[:space:]()]',
            '',
            'g'
          ),
          'public.',
          ''
        ),
        'objects.',
        ''
      ),
      '::text',
      ''
    ),
    'asvendor_id_text',
    ''
  ));

  if policy_record.policyname is null
    or policy_record.policyname <> 'vendor_select_own_active_product_images'
    or policy_record.permissive <> 'PERMISSIVE'
    or policy_record.cmd <> 'SELECT'
    or policy_record.roles is distinct from array['authenticated']::name[]
    or policy_record.with_check is not null
    or policy_record.qual is null
    or position('bucket_id=''product-images''' in normalized_expression) = 0
    or position('foldernamename[1]' in normalized_expression) = 0
    or not foldername_dependency_ok
    or position('vendors.id' in normalized_expression) = 0
    or position('vendors.user_id' in normalized_expression) = 0
    or position('auth.uid' in normalized_expression) = 0
    or position('vendors.is_active=true' in normalized_expression) = 0
    or position('fromvendors' in normalized_expression) = 0
    or policy_record.qual ~* '(^|[^[:alnum:]_])or([^[:alnum:]_]|$)'
  then
    raise exception using
      message = 'Batch 4B1 postcondition: product-image SELECT policy is incorrect.',
      detail = pg_catalog.format(
        'raw=%s | normalized=%s | name_ok=%s | permissive_ok=%s | cmd_ok=%s | roles_ok=%s | with_check_null=%s | qual_nonnull=%s | bucket_found=%s | folder_found=%s | foldername_dependency_ok=%s | vendor_id_found=%s | vendor_user_id_found=%s | auth_uid_found=%s | vendor_active_found=%s | from_vendors_found=%s | no_logical_or=%s',
        policy_record.qual,
        normalized_expression,
        policy_record.policyname is not null
          and policy_record.policyname = 'vendor_select_own_active_product_images',
        coalesce(policy_record.permissive = 'PERMISSIVE', false),
        coalesce(policy_record.cmd = 'SELECT', false),
        policy_record.roles is not distinct from array['authenticated']::name[],
        policy_record.with_check is null,
        policy_record.qual is not null,
        coalesce(position('bucket_id=''product-images''' in normalized_expression) > 0, false),
        coalesce(position('foldernamename[1]' in normalized_expression) > 0, false),
        foldername_dependency_ok,
        coalesce(position('vendors.id' in normalized_expression) > 0, false),
        coalesce(position('vendors.user_id' in normalized_expression) > 0, false),
        coalesce(position('auth.uid' in normalized_expression) > 0, false),
        coalesce(position('vendors.is_active=true' in normalized_expression) > 0, false),
        coalesce(position('fromvendors' in normalized_expression) > 0, false),
        coalesce(
          not (policy_record.qual ~* '(^|[^[:alnum:]_])or([^[:alnum:]_]|$)'),
          false
        )
      );
  end if;

  select policy.*
  into policy_record
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'storage'
    and policy.tablename = 'objects'
    and policy.policyname = 'vendor_insert_own_active_product_images';

  foldername_dependency_ok := exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_depend as dependency
      on dependency.classid = 'pg_policy'::pg_catalog.regclass
      and dependency.objid = policy.oid
      and dependency.refclassid = 'pg_proc'::pg_catalog.regclass
    where policy.polrelid = 'storage.objects'::pg_catalog.regclass
      and policy.polname = 'vendor_insert_own_active_product_images'
      and dependency.refobjid =
        pg_catalog.to_regprocedure('storage.foldername(text)')
  );

  normalized_expression := pg_catalog.lower(pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.regexp_replace(
            policy_record.with_check,
            '[[:space:]()]',
            '',
            'g'
          ),
          'public.',
          ''
        ),
        'objects.',
        ''
      ),
      '::text',
      ''
    ),
    'asvendor_id_text',
    ''
  ));

  if policy_record.policyname is null
    or policy_record.policyname <> 'vendor_insert_own_active_product_images'
    or policy_record.permissive <> 'PERMISSIVE'
    or policy_record.cmd <> 'INSERT'
    or policy_record.roles is distinct from array['authenticated']::name[]
    or policy_record.qual is not null
    or policy_record.with_check is null
    or position('bucket_id=''product-images''' in normalized_expression) = 0
    or position('foldernamename[1]' in normalized_expression) = 0
    or not foldername_dependency_ok
    or position('vendors.id' in normalized_expression) = 0
    or position('vendors.user_id' in normalized_expression) = 0
    or position('auth.uid' in normalized_expression) = 0
    or position('vendors.is_active=true' in normalized_expression) = 0
    or position('fromvendors' in normalized_expression) = 0
    or policy_record.with_check ~* '(^|[^[:alnum:]_])or([^[:alnum:]_]|$)'
  then
    raise exception using
      message = 'Batch 4B1 postcondition: product-image INSERT policy is incorrect.',
      detail = pg_catalog.format(
        'raw=%s | normalized=%s | name_ok=%s | permissive_ok=%s | cmd_ok=%s | roles_ok=%s | qual_null=%s | with_check_nonnull=%s | bucket_found=%s | folder_found=%s | foldername_dependency_ok=%s | vendor_id_found=%s | vendor_user_id_found=%s | auth_uid_found=%s | vendor_active_found=%s | from_vendors_found=%s | no_logical_or=%s',
        policy_record.with_check,
        normalized_expression,
        policy_record.policyname is not null
          and policy_record.policyname = 'vendor_insert_own_active_product_images',
        coalesce(policy_record.permissive = 'PERMISSIVE', false),
        coalesce(policy_record.cmd = 'INSERT', false),
        policy_record.roles is not distinct from array['authenticated']::name[],
        policy_record.qual is null,
        policy_record.with_check is not null,
        coalesce(position('bucket_id=''product-images''' in normalized_expression) > 0, false),
        coalesce(position('foldernamename[1]' in normalized_expression) > 0, false),
        foldername_dependency_ok,
        coalesce(position('vendors.id' in normalized_expression) > 0, false),
        coalesce(position('vendors.user_id' in normalized_expression) > 0, false),
        coalesce(position('auth.uid' in normalized_expression) > 0, false),
        coalesce(position('vendors.is_active=true' in normalized_expression) > 0, false),
        coalesce(position('fromvendors' in normalized_expression) > 0, false),
        coalesce(
          not (policy_record.with_check ~* '(^|[^[:alnum:]_])or([^[:alnum:]_]|$)'),
          false
        )
      );
  end if;
end
$postcondition$;

commit;
