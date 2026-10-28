begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  delete_policy pg_catalog.pg_policies%rowtype;
  normalized_qual text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.products'::pg_catalog.regclass
      and relation.relkind = 'r'
      and relation.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'variant_mode'
      and attribute.atttypid = 'text'::pg_catalog.regtype
      and attribute.attnotnull
      and not attribute.attisdropped
  ) then
    raise exception 'Batch 2B2 deletion hardening preflight: products RLS or variant mode is unavailable.';
  end if;

  if (
    select pg_catalog.array_agg(
      policy.policyname::text order by policy.policyname
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) is distinct from array[
    'products_public_read',
    'vendor_delete_own_active_products',
    'vendor_insert_own_active_products',
    'vendor_select_own_products',
    'vendor_update_own_active_products'
  ]::text[] then
    raise exception 'Batch 2B2 deletion hardening preflight: product policy inventory changed.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.cmd in ('ALL', 'DELETE')
  ) <> 1 or exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.cmd in ('ALL', 'DELETE')
      and policy.policyname <> 'vendor_delete_own_active_products'
  ) then
    raise exception 'Batch 2B2 deletion hardening preflight: unexpected product DELETE policy applies.';
  end if;

  select policy.*
  into delete_policy
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_delete_own_active_products';

  normalized_qual := case
    when delete_policy.qual is null then null
    else pg_catalog.lower(pg_catalog.replace(
      pg_catalog.regexp_replace(
        delete_policy.qual,
        '[[:space:]()]',
        '',
        'g'
      ),
      'public.',
      ''
    ))
  end;

  if delete_policy.policyname is null
    or delete_policy.policyname <> 'vendor_delete_own_active_products'
    or delete_policy.permissive <> 'PERMISSIVE'
    or delete_policy.cmd <> 'DELETE'
    or delete_policy.roles is distinct from array['authenticated']::name[]
    or delete_policy.with_check is not null
    or normalized_qual is distinct from
      'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuidandvendors.is_active=true'
  then
    raise exception 'Batch 2B2 deletion hardening preflight: active-owner DELETE policy changed.';
  end if;

  if pg_catalog.has_table_privilege('public', 'public.products', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'DELETE')
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.products', 'DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.products', 'DELETE'
    )
  then
    raise exception 'Batch 2B2 deletion hardening preflight: product DELETE grants changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname =
        'product_variants_product_vendor_fkey'
      and constraint_record.confrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.confdeltype = 'c'
      and constraint_record.convalidated
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname in (
        'order_items_product_variant_id_fkey',
        'order_items_product_variant_product_id_fkey'
      )
      and constraint_record.confrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) <> 2 or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_product_id_fkey'
      and constraint_record.confrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.confdeltype = 'n'
      and constraint_record.convalidated
  ) then
    raise exception 'Batch 2B2 deletion hardening preflight: product deletion relationships changed.';
  end if;

  perform pg_catalog.set_config(
    'marketa.variant_parent_delete.other_policies_hash',
    coalesce((
      select pg_catalog.md5(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(policy) order by policy.policyname
        )::text
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
        and policy.policyname <> 'vendor_delete_own_active_products'
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_parent_delete.products_rows',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(product)::text),
        '' order by product.id
      ))
      from public.products as product
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_parent_delete.variant_rows',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
        '' order by variant.id
      ))
      from public.product_variants as variant
    ), pg_catalog.md5('')),
    true
  );
end
$preflight$;

create policy vendor_delete_ordinary_products_only
on public.products
as restrictive
for delete
to authenticated
using (variant_mode = 'none');

do $postcondition$
declare
  owner_policy pg_catalog.pg_policies%rowtype;
  ordinary_only_policy pg_catalog.pg_policies%rowtype;
  normalized_owner_qual text;
  normalized_guard_qual text;
begin
  if (
    select pg_catalog.array_agg(
      policy.policyname::text order by policy.policyname
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) is distinct from array[
    'products_public_read',
    'vendor_delete_ordinary_products_only',
    'vendor_delete_own_active_products',
    'vendor_insert_own_active_products',
    'vendor_select_own_products',
    'vendor_update_own_active_products'
  ]::text[] then
    raise exception 'Batch 2B2 deletion hardening postcondition: product policy inventory is incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.cmd in ('ALL', 'DELETE')
  ) <> 2 or exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.cmd in ('ALL', 'DELETE')
      and policy.policyname not in (
        'vendor_delete_own_active_products',
        'vendor_delete_ordinary_products_only'
      )
  ) then
    raise exception 'Batch 2B2 deletion hardening postcondition: unexpected product DELETE policy applies.';
  end if;

  select policy.*
  into owner_policy
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_delete_own_active_products';

  select policy.*
  into ordinary_only_policy
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_delete_ordinary_products_only';

  normalized_owner_qual := case
    when owner_policy.qual is null then null
    else pg_catalog.lower(pg_catalog.replace(
      pg_catalog.regexp_replace(owner_policy.qual, '[[:space:]()]', '', 'g'),
      'public.',
      ''
    ))
  end;

  normalized_guard_qual := case
    when ordinary_only_policy.qual is null then null
    else pg_catalog.lower(pg_catalog.replace(
      pg_catalog.regexp_replace(
        ordinary_only_policy.qual,
        '[[:space:]()]',
        '',
        'g'
      ),
      '::text',
      ''
    ))
  end;

  if owner_policy.policyname is null
    or owner_policy.permissive <> 'PERMISSIVE'
    or owner_policy.cmd <> 'DELETE'
    or owner_policy.roles is distinct from array['authenticated']::name[]
    or owner_policy.with_check is not null
    or normalized_owner_qual is distinct from
      'vendor_idinselectvendors.idfromvendorswherevendors.user_id=selectauth.uidasuidandvendors.is_active=true'
  then
    raise exception 'Batch 2B2 deletion hardening postcondition: active-owner DELETE policy changed.';
  end if;

  if ordinary_only_policy.policyname is null
    or ordinary_only_policy.policyname <>
      'vendor_delete_ordinary_products_only'
    or ordinary_only_policy.permissive <> 'RESTRICTIVE'
    or ordinary_only_policy.cmd <> 'DELETE'
    or ordinary_only_policy.roles is distinct from
      array['authenticated']::name[]
    or ordinary_only_policy.with_check is not null
    or normalized_guard_qual is distinct from 'variant_mode=''none'''
  then
    raise exception 'Batch 2B2 deletion hardening postcondition: ordinary-product DELETE guard is incorrect.';
  end if;

  if pg_catalog.current_setting(
    'marketa.variant_parent_delete.other_policies_hash'
  ) is distinct from coalesce((
    select pg_catalog.md5(
      pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.policyname not in (
        'vendor_delete_own_active_products',
        'vendor_delete_ordinary_products_only'
      )
  ), pg_catalog.md5('')) then
    raise exception 'Batch 2B2 deletion hardening postcondition: unrelated product policies changed.';
  end if;

  if pg_catalog.has_table_privilege('public', 'public.products', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'DELETE')
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.products', 'DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.products', 'DELETE'
    )
  then
    raise exception 'Batch 2B2 deletion hardening postcondition: product DELETE grants changed.';
  end if;

  if pg_catalog.current_setting(
    'marketa.variant_parent_delete.products_rows'
  ) is distinct from coalesce((
    select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(product)::text),
      '' order by product.id
    ))
    from public.products as product
  ), pg_catalog.md5('')) or pg_catalog.current_setting(
    'marketa.variant_parent_delete.variant_rows'
  ) is distinct from coalesce((
    select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
      '' order by variant.id
    ))
    from public.product_variants as variant
  ), pg_catalog.md5('')) then
    raise exception 'Batch 2B2 deletion hardening postcondition: product or variant rows changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname =
        'product_variants_product_vendor_fkey'
      and constraint_record.confrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.confdeltype = 'c'
      and constraint_record.convalidated
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname in (
        'order_items_product_variant_id_fkey',
        'order_items_product_variant_product_id_fkey'
      )
      and constraint_record.confrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) <> 2 or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_product_id_fkey'
      and constraint_record.confrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.confdeltype = 'n'
      and constraint_record.convalidated
  ) then
    raise exception 'Batch 2B2 deletion hardening postcondition: product deletion relationships changed.';
  end if;
end
$postcondition$;

commit;
