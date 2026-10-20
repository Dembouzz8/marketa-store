-- Product Variants Batch 2A.2: foundation schema and authority only.
-- Variant purchasing and ordinary-to-variant conversion remain unavailable.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  product_policies text[];
begin
  if pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.order_items') is null
    or pg_catalog.to_regclass('public.vendors') is null
  then
    raise exception 'Product variants foundation preflight: required tables are missing.';
  end if;

  if pg_catalog.to_regclass('public.product_variants') is not null
    or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname in ('variant_mode', 'stock_version')
        and not attribute.attisdropped
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.order_items'::pg_catalog.regclass
        and attribute.attname in (
          'product_variant_id',
          'variant_size_snapshot',
          'variant_colour_snapshot'
        )
        and not attribute.attisdropped
    )
  then
    raise exception 'Product variants foundation preflight: foundation objects already exist.';
  end if;

  if pg_catalog.to_regprocedure(
    'public.enforce_product_foundation_authority()'
  ) is not null
    or pg_catalog.to_regprocedure(
      'public.enforce_product_variant_foundation()'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.guard_foundation_order_item_variant()'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.protect_order_item_variant_identity()'
    ) is not null
  then
    raise exception 'Product variants foundation preflight: helper function name collision.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid in (
      'public.products'::pg_catalog.regclass,
      'public.order_items'::pg_catalog.regclass
    )
      and not trigger_record.tgisinternal
      and trigger_record.tgname in (
        'products_foundation_authority_guard',
        'order_items_foundation_variant_guard',
        'order_items_variant_identity_immutable'
      )
  ) then
    raise exception 'Product variants foundation preflight: trigger name collision.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.products'::pg_catalog.regclass
      and relation.relrowsecurity
  ) then
    raise exception 'Product variants foundation preflight: products RLS is disabled.';
  end if;

  if pg_catalog.to_regprocedure('public.handle_updated_at()') is null
    or not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.products'::pg_catalog.regclass
        and trigger_record.tgname = 'products_updated_at'
        and not trigger_record.tgisinternal
        and trigger_record.tgfoid =
          'public.handle_updated_at()'::pg_catalog.regprocedure
    )
  then
    raise exception 'Product variants foundation preflight: product timestamp trigger changed.';
  end if;

  perform pg_catalog.set_config(
    'marketa.variant_foundation.existing_trigger_count',
    (
      select pg_catalog.count(*)::text
      from pg_catalog.pg_trigger as trigger_record
      where not trigger_record.tgisinternal
        and trigger_record.tgrelid in (
          'public.products'::pg_catalog.regclass,
          'public.order_items'::pg_catalog.regclass
        )
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_foundation.existing_trigger_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.jsonb_build_array(
          trigger_record.tgrelid::text,
          trigger_record.tgname,
          trigger_record.tgenabled,
          trigger_record.tgtype,
          trigger_record.tgattr::text,
          trigger_record.tgfoid::text,
          pg_catalog.pg_get_triggerdef(trigger_record.oid, true),
          pg_catalog.pg_get_expr(
            trigger_record.tgqual,
            trigger_record.tgrelid
          )
        )::text),
        '' order by trigger_record.tgrelid, trigger_record.tgname
      ))
      from pg_catalog.pg_trigger as trigger_record
      where not trigger_record.tgisinternal
        and trigger_record.tgrelid in (
          'public.products'::pg_catalog.regclass,
          'public.order_items'::pg_catalog.regclass
        )
    ), pg_catalog.md5('')),
    true
  );

  select pg_catalog.array_agg(policy.policyname order by policy.policyname)
  into product_policies
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products';

  if product_policies is distinct from array[
    'products_public_read',
    'vendor_delete_own_active_products',
    'vendor_insert_own_active_products',
    'vendor_select_own_products',
    'vendor_update_own_active_products'
  ]::text[] then
    raise exception 'Product variants foundation preflight: product policies changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_stock_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (stock >= 0)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_product_id_fkey'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL'
  ) then
    raise exception 'Product variants foundation preflight: inventory or historical FK baseline changed.';
  end if;

  if pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  ) is null then
    raise exception 'Product variants foundation preflight: Ops 4 finalizer is missing.';
  end if;

  perform pg_catalog.set_config(
    'marketa.variant_foundation.finalizer_hash',
    pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure
    )),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_foundation.decrement_hash',
    coalesce(
      (
        select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
        from pg_catalog.pg_proc as procedure
        join pg_catalog.pg_namespace as namespace
          on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname = 'decrement_stock'
          and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
            = 'p_product_id uuid, p_quantity integer'
      ),
      'absent'
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_foundation.products_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.jsonb_build_array(
          product.id,
          product.vendor_id,
          product.name,
          product.description,
          product.price,
          product.stock,
          product.category,
          product.images,
          product.is_active,
          product.created_at,
          product.updated_at
        )::text),
        '' order by product.id
      ))
      from public.products as product
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_foundation.order_items_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(item)::text),
        '' order by item.id
      ))
      from public.order_items as item
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.variant_foundation.product_policies_hash',
    (
      select pg_catalog.md5(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(policy)
          order by policy.policyname
        )::text
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ),
    true
  );
end
$preflight$;

alter table public.products
  add column variant_mode text not null default 'none',
  add column stock_version bigint not null default 0;

alter table public.products
  add constraint products_variant_mode_check
    check (variant_mode in ('none', 'size', 'colour', 'size_colour'))
    not valid,
  add constraint products_stock_version_check
    check (stock_version >= 0)
    not valid,
  add constraint products_inventory_authority_check
    check (variant_mode = 'none' or stock = 0)
    not valid;

alter table public.products
  validate constraint products_variant_mode_check,
  validate constraint products_stock_version_check,
  validate constraint products_inventory_authority_check;

alter table public.products
  add constraint products_id_vendor_id_key unique (id, vendor_id);

create function public.enforce_product_foundation_authority()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.vendor_id is distinct from old.vendor_id then
    raise exception using
      errcode = '23514',
      message = 'Product ownership cannot be reassigned.';
  end if;

  if new.stock is distinct from old.stock then
    new.stock_version := old.stock_version + 1;
  elsif new.stock_version is distinct from old.stock_version then
    raise exception using
      errcode = '23514',
      message = 'Product stock version is database-managed.';
  end if;

  return new;
end
$function$;

alter function public.enforce_product_foundation_authority() owner to postgres;
revoke all privileges on function public.enforce_product_foundation_authority()
  from public, anon, authenticated, service_role;

create trigger products_foundation_authority_guard
before update on public.products
for each row
execute function public.enforce_product_foundation_authority();

create table public.product_variants (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null,
  vendor_id uuid not null,
  size text,
  colour text,
  size_normalized text generated always as (
    case
      when size is null then null
      else nullif(
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(size),
            '[[:space:]]+',
            ' ',
            'g'
          )
        ),
        ''
      )
    end
  ) stored,
  colour_normalized text generated always as (
    case
      when colour is null then null
      else nullif(
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(colour),
            '[[:space:]]+',
            ' ',
            'g'
          )
        ),
        ''
      )
    end
  ) stored,
  stock integer not null default 0,
  stock_version bigint not null default 0,
  is_active boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_variants_product_vendor_fkey
    foreign key (product_id, vendor_id)
    references public.products (id, vendor_id)
    on delete cascade,
  constraint product_variants_vendor_id_fkey
    foreign key (vendor_id)
    references public.vendors (id)
    on delete cascade,
  constraint product_variants_label_required_check
    check (size_normalized is not null or colour_normalized is not null),
  constraint product_variants_size_length_check
    check (size is null or pg_catalog.char_length(size) <= 80),
  constraint product_variants_colour_length_check
    check (colour is null or pg_catalog.char_length(colour) <= 80),
  constraint product_variants_stock_check
    check (stock >= 0),
  constraint product_variants_stock_version_check
    check (stock_version >= 0),
  constraint product_variants_id_product_id_key
    unique (id, product_id)
);

create unique index product_variants_normalized_combination_key
on public.product_variants (
  product_id,
  size_normalized,
  colour_normalized
)
nulls not distinct;

create index product_variants_vendor_id_idx
on public.product_variants (vendor_id);

create function public.enforce_product_variant_foundation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  parent_mode text;
  parent_vendor_id uuid;
  normalized_size text;
  normalized_colour text;
begin
  if tg_op = 'UPDATE' and (
    new.product_id is distinct from old.product_id
    or new.vendor_id is distinct from old.vendor_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Product variant ownership cannot be reassigned.';
  end if;

  select product.variant_mode, product.vendor_id
  into parent_mode, parent_vendor_id
  from public.products as product
  where product.id = new.product_id;

  if not found or parent_vendor_id is distinct from new.vendor_id then
    raise exception using
      errcode = '23514',
      message = 'Product variant ownership does not match its product.';
  end if;

  normalized_size := case
    when new.size is null then null
    else nullif(
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(new.size),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      ''
    )
  end;
  normalized_colour := case
    when new.colour is null then null
    else nullif(
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(new.colour),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      ''
    )
  end;

  if parent_mode = 'none' then
    raise exception using
      errcode = '23514',
      message = 'Variant creation is unavailable for an ordinary product.';
  elsif parent_mode = 'size' and not (
    normalized_size is not null
    and normalized_colour is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Size variants require size only.';
  elsif parent_mode = 'colour' and not (
    normalized_size is null
    and normalized_colour is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Colour variants require colour only.';
  elsif parent_mode = 'size_colour' and not (
    normalized_size is not null
    and normalized_colour is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Size-and-colour variants require both labels.';
  end if;

  if tg_op = 'INSERT' then
    new.stock_version := 0;
  else
    if new.stock is distinct from old.stock then
      new.stock_version := old.stock_version + 1;
    elsif new.stock_version is distinct from old.stock_version then
      raise exception using
        errcode = '23514',
        message = 'Product variant stock version is database-managed.';
    end if;
  end if;

  return new;
end
$function$;

alter function public.enforce_product_variant_foundation() owner to postgres;
revoke all privileges on function public.enforce_product_variant_foundation()
  from public, anon, authenticated, service_role;

create trigger product_variants_foundation_guard
before insert or update on public.product_variants
for each row
execute function public.enforce_product_variant_foundation();

create trigger product_variants_updated_at
before update on public.product_variants
for each row
execute function public.handle_updated_at();

alter table public.product_variants enable row level security;

create policy product_variants_public_read
on public.product_variants
for select
to public
using (
  is_active = true
  and exists (
    select 1
    from public.products as product
    where product.id = product_variants.product_id
      and product.vendor_id = product_variants.vendor_id
      and product.variant_mode <> 'none'
      and product.is_active = true
      and public.is_vendor_active(product.vendor_id)
  )
);

create policy vendor_select_own_product_variants
on public.product_variants
for select
to authenticated
using (
  vendor_id in (
    select vendor.id
    from public.vendors as vendor
    where vendor.user_id = (select auth.uid())
  )
);

revoke all privileges on table public.product_variants
  from public, anon, authenticated, service_role;
revoke insert (
  id,
  product_id,
  vendor_id,
  size,
  colour,
  size_normalized,
  colour_normalized,
  stock,
  stock_version,
  is_active,
  created_at,
  updated_at
) on public.product_variants from public, anon, authenticated, service_role;
revoke update (
  id,
  product_id,
  vendor_id,
  size,
  colour,
  size_normalized,
  colour_normalized,
  stock,
  stock_version,
  is_active,
  created_at,
  updated_at
) on public.product_variants from public, anon, authenticated, service_role;
revoke references (
  id,
  product_id,
  vendor_id,
  size,
  colour,
  size_normalized,
  colour_normalized,
  stock,
  stock_version,
  is_active,
  created_at,
  updated_at
) on public.product_variants from public, anon, authenticated, service_role;
grant select on table public.product_variants
  to anon, authenticated, service_role;

alter table public.order_items
  add column product_variant_id uuid,
  add column variant_size_snapshot text,
  add column variant_colour_snapshot text;

alter table public.order_items
  add constraint order_items_variant_identity_check
    check (
      (
        product_variant_id is null
        and variant_size_snapshot is null
        and variant_colour_snapshot is null
      )
      or (
        product_variant_id is not null
        and product_id is not null
        and (
          variant_size_snapshot is not null
          or variant_colour_snapshot is not null
        )
      )
    )
    not valid,
  add constraint order_items_variant_size_snapshot_length_check
    check (
      variant_size_snapshot is null
      or pg_catalog.char_length(variant_size_snapshot) <= 80
    )
    not valid,
  add constraint order_items_variant_colour_snapshot_length_check
    check (
      variant_colour_snapshot is null
      or pg_catalog.char_length(variant_colour_snapshot) <= 80
    )
    not valid;

alter table public.order_items
  validate constraint order_items_variant_identity_check,
  validate constraint order_items_variant_size_snapshot_length_check,
  validate constraint order_items_variant_colour_snapshot_length_check;

alter table public.order_items
  add constraint order_items_product_variant_id_fkey
    foreign key (product_variant_id)
    references public.product_variants (id)
    on delete restrict,
  add constraint order_items_product_variant_product_id_fkey
    foreign key (product_variant_id, product_id)
    references public.product_variants (id, product_id)
    on delete restrict;

create index order_items_product_variant_id_idx
on public.order_items (product_variant_id)
where product_variant_id is not null;

create function public.guard_foundation_order_item_variant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  parent_mode text;
begin
  if new.product_variant_id is not null
    or new.variant_size_snapshot is not null
    or new.variant_colour_snapshot is not null
  then
    raise exception using
      errcode = '23514',
      message = 'Variant purchasing is not available.';
  end if;

  if new.product_id is null then
    raise exception using
      errcode = '23514',
      message = 'Ordinary order items require a product.';
  end if;

  select product.variant_mode
  into parent_mode
  from public.products as product
  where product.id = new.product_id;

  if not found or parent_mode is distinct from 'none' then
    raise exception using
      errcode = '23514',
      message = 'Ordinary order items require an ordinary product.';
  end if;

  return new;
end
$function$;

alter function public.guard_foundation_order_item_variant() owner to postgres;
revoke all privileges on function public.guard_foundation_order_item_variant()
  from public, anon, authenticated, service_role;

create trigger order_items_foundation_variant_guard
before insert on public.order_items
for each row
execute function public.guard_foundation_order_item_variant();

create function public.protect_order_item_variant_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.product_variant_id is distinct from old.product_variant_id
    or new.variant_size_snapshot is distinct from old.variant_size_snapshot
    or new.variant_colour_snapshot is distinct from old.variant_colour_snapshot
  then
    raise exception using
      errcode = '23514',
      message = 'Order-item variant identity and snapshots are immutable.';
  end if;

  return new;
end
$function$;

alter function public.protect_order_item_variant_identity() owner to postgres;
revoke all privileges on function public.protect_order_item_variant_identity()
  from public, anon, authenticated, service_role;

create trigger order_items_variant_identity_immutable
before update of product_variant_id, variant_size_snapshot, variant_colour_snapshot
on public.order_items
for each row
execute function public.protect_order_item_variant_identity();

revoke all privileges on table public.products
  from public, anon, authenticated, service_role;
revoke insert (
  id,
  vendor_id,
  name,
  description,
  price,
  stock,
  category,
  images,
  is_active,
  created_at,
  updated_at,
  variant_mode,
  stock_version
) on public.products from public, anon, authenticated, service_role;
revoke update (
  id,
  vendor_id,
  name,
  description,
  price,
  stock,
  category,
  images,
  is_active,
  created_at,
  updated_at,
  variant_mode,
  stock_version
) on public.products from public, anon, authenticated, service_role;
revoke references (
  id,
  vendor_id,
  name,
  description,
  price,
  stock,
  category,
  images,
  is_active,
  created_at,
  updated_at,
  variant_mode,
  stock_version
) on public.products from public, anon, authenticated, service_role;

grant select on table public.products to anon, authenticated, service_role;
grant delete on table public.products to authenticated;
grant insert (
  vendor_id,
  name,
  description,
  price,
  stock,
  category,
  images,
  is_active
) on public.products to authenticated;
grant update (
  vendor_id,
  name,
  description,
  price,
  stock,
  category,
  images,
  is_active
) on public.products to authenticated;
grant update (stock, updated_at) on public.products to service_role;

do $postcondition$
declare
  column_record record;
  expected_authenticated_write boolean;
  expected_service_update boolean;
  function_record record;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'variant_mode'
      and attribute.atttypid = 'text'::pg_catalog.regtype
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
        = '''none''::text'
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'stock_version'
      and attribute.atttypid = 'bigint'::pg_catalog.regtype
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = '0'
  ) then
    raise exception 'Product variants foundation postcondition: product columns are incorrect.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.variant_mode <> 'none'
      or product.stock_version <> 0
  ) then
    raise exception 'Product variants foundation postcondition: existing products changed mode or version.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname in (
        'products_variant_mode_check',
        'products_stock_version_check',
        'products_inventory_authority_check',
        'products_id_vendor_id_key'
      )
      and constraint_record.convalidated
  ) <> 4 then
    raise exception 'Product variants foundation postcondition: product constraints are incomplete.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.product_variants'::pg_catalog.regclass
      and relation.relkind = 'r'
      and relation.relrowsecurity
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'product_variants'
  ) <> 2 then
    raise exception 'Product variants foundation postcondition: variant RLS is incorrect.';
  end if;

  if (
    select pg_catalog.array_agg(
      policy.policyname::text
      order by policy.policyname
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'product_variants'
  ) is distinct from array[
    'product_variants_public_read',
    'vendor_select_own_product_variants'
  ]::text[] then
    raise exception 'Product variants foundation postcondition: variant policies are incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname in (
        'order_items_product_variant_id_fkey',
        'order_items_product_variant_product_id_fkey'
      )
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
  ) <> 2 then
    raise exception 'Product variants foundation postcondition: historical variant FKs are incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
      and constraint_record.conname = 'order_items_product_id_fkey'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL'
  ) then
    raise exception 'Product variants foundation postcondition: ordinary historical deletion behavior changed.';
  end if;

  for function_record in
    select procedure.oid, procedure.prosecdef, procedure.provolatile,
           procedure.proconfig, pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.enforce_product_foundation_authority()'::pg_catalog.regprocedure,
      'public.enforce_product_variant_foundation()'::pg_catalog.regprocedure,
      'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure,
      'public.protect_order_item_variant_identity()'::pg_catalog.regprocedure
    )
  loop
    if function_record.owner <> 'postgres'
      or function_record.prosecdef
      or function_record.provolatile <> 'v'
      or function_record.proconfig is distinct from array['search_path=""']::text[]
    then
      raise exception 'Product variants foundation postcondition: trigger helper security is incorrect.';
    end if;

    if pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    then
      raise exception 'Product variants foundation postcondition: trigger helper is directly executable.';
    end if;
  end loop;

  if pg_catalog.pg_get_functiondef(
    'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
  ) ~* 'for[[:space:]]+update' then
    raise exception 'Product variants foundation postcondition: order-item guard acquires row locks.';
  end if;

  if (
    select pg_catalog.count(*)
    from (
      values
        (
          'public.products'::pg_catalog.regclass,
          'products_foundation_authority_guard'::text,
          'public.enforce_product_foundation_authority()'::pg_catalog.regprocedure,
          19::smallint,
          array[]::text[]
        ),
        (
          'public.product_variants'::pg_catalog.regclass,
          'product_variants_foundation_guard'::text,
          'public.enforce_product_variant_foundation()'::pg_catalog.regprocedure,
          23::smallint,
          array[]::text[]
        ),
        (
          'public.product_variants'::pg_catalog.regclass,
          'product_variants_updated_at'::text,
          'public.handle_updated_at()'::pg_catalog.regprocedure,
          19::smallint,
          array[]::text[]
        ),
        (
          'public.order_items'::pg_catalog.regclass,
          'order_items_foundation_variant_guard'::text,
          'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure,
          7::smallint,
          array[]::text[]
        ),
        (
          'public.order_items'::pg_catalog.regclass,
          'order_items_variant_identity_immutable'::text,
          'public.protect_order_item_variant_identity()'::pg_catalog.regprocedure,
          19::smallint,
          array[
            'product_variant_id',
            'variant_size_snapshot',
            'variant_colour_snapshot'
          ]::text[]
        )
    ) as expected_trigger(
      relation_oid,
      trigger_name,
      function_oid,
      trigger_type,
      update_columns
    )
    join pg_catalog.pg_trigger as trigger_record
      on trigger_record.tgrelid = expected_trigger.relation_oid
      and trigger_record.tgname = expected_trigger.trigger_name
      and trigger_record.tgfoid = expected_trigger.function_oid
      and trigger_record.tgtype = expected_trigger.trigger_type
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgnargs = 0
    where coalesce((
      select pg_catalog.array_agg(
        attribute.attname::text order by trigger_column.ordinality
      )
      from pg_catalog.unnest(
        trigger_record.tgattr::smallint[]
      ) with ordinality as trigger_column(attnum, ordinality)
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = trigger_record.tgrelid
        and attribute.attnum = trigger_column.attnum
    ), array[]::text[]) = expected_trigger.update_columns
  ) <> 5 then
    raise exception 'Product variants foundation postcondition: foundation triggers are incorrect.';
  end if;

  if pg_catalog.current_setting(
    'marketa.variant_foundation.existing_trigger_count'
  )::bigint is distinct from (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgrelid in (
        'public.products'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass
      )
      and trigger_record.tgname not in (
        'products_foundation_authority_guard',
        'order_items_foundation_variant_guard',
        'order_items_variant_identity_immutable'
      )
  ) or pg_catalog.current_setting(
    'marketa.variant_foundation.existing_trigger_hash'
  ) is distinct from coalesce((
    select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.jsonb_build_array(
        trigger_record.tgrelid::text,
        trigger_record.tgname,
        trigger_record.tgenabled,
        trigger_record.tgtype,
        trigger_record.tgattr::text,
        trigger_record.tgfoid::text,
        pg_catalog.pg_get_triggerdef(trigger_record.oid, true),
        pg_catalog.pg_get_expr(
          trigger_record.tgqual,
          trigger_record.tgrelid
        )
      )::text),
      '' order by trigger_record.tgrelid, trigger_record.tgname
    ))
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgrelid in (
        'public.products'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass
      )
      and trigger_record.tgname not in (
        'products_foundation_authority_guard',
        'order_items_foundation_variant_guard',
        'order_items_variant_identity_immutable'
      )
  ), pg_catalog.md5('')) then
    raise exception 'Product variants foundation postcondition: pre-existing triggers changed.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgrelid in (
        'public.products'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass
      )
  ) <> pg_catalog.current_setting(
    'marketa.variant_foundation.existing_trigger_count'
  )::bigint + 3 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgrelid in (
        'public.products'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass
      )
  ) <> pg_catalog.current_setting(
    'marketa.variant_foundation.existing_trigger_count'
  )::bigint + 5 then
    raise exception 'Product variants foundation postcondition: unexpected triggers exist.';
  end if;

  if not pg_catalog.has_table_privilege('anon', 'public.products', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'TRUNCATE')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'REFERENCES')
    or pg_catalog.has_table_privilege('anon', 'public.products', 'TRIGGER')
  then
    raise exception 'Product variants foundation postcondition: anonymous product privileges are incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) as acl
    where relation.oid in (
      'public.products'::pg_catalog.regclass,
      'public.product_variants'::pg_catalog.regclass
    )
      and acl.grantee = 0
  ) then
    raise exception 'Product variants foundation postcondition: PUBLIC table privileges remain.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    cross join lateral pg_catalog.aclexplode(attribute.attacl) as acl
    where attribute.attrelid in (
      'public.products'::pg_catalog.regclass,
      'public.product_variants'::pg_catalog.regclass
    )
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attacl is not null
      and acl.grantee = 0
  ) then
    raise exception 'Product variants foundation postcondition: PUBLIC column privileges remain.';
  end if;

  if not pg_catalog.has_table_privilege('authenticated', 'public.products', 'SELECT')
    or not pg_catalog.has_table_privilege('authenticated', 'public.products', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.products', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.products', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.products', 'TRUNCATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.products', 'REFERENCES')
    or pg_catalog.has_table_privilege('authenticated', 'public.products', 'TRIGGER')
  then
    raise exception 'Product variants foundation postcondition: authenticated product table privileges are incorrect.';
  end if;

  for column_record in
    select attribute.attname
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  loop
    expected_authenticated_write := column_record.attname in (
      'vendor_id',
      'name',
      'description',
      'price',
      'stock',
      'category',
      'images',
      'is_active'
    );
    expected_service_update := column_record.attname in ('stock', 'updated_at');

    if pg_catalog.has_column_privilege(
      'anon',
      'public.products',
      column_record.attname,
      'INSERT'
    ) or pg_catalog.has_column_privilege(
      'anon',
      'public.products',
      column_record.attname,
      'UPDATE'
    ) or pg_catalog.has_column_privilege(
      'anon',
      'public.products',
      column_record.attname,
      'REFERENCES'
    ) or pg_catalog.has_column_privilege(
      'authenticated',
      'public.products',
      column_record.attname,
      'INSERT'
    ) is distinct from expected_authenticated_write
      or pg_catalog.has_column_privilege(
        'authenticated',
        'public.products',
        column_record.attname,
        'UPDATE'
      ) is distinct from expected_authenticated_write
      or pg_catalog.has_column_privilege(
        'authenticated',
        'public.products',
        column_record.attname,
        'REFERENCES'
      )
      or pg_catalog.has_column_privilege(
        'service_role',
        'public.products',
        column_record.attname,
        'INSERT'
      )
      or pg_catalog.has_column_privilege(
        'service_role',
        'public.products',
        column_record.attname,
        'UPDATE'
      ) is distinct from expected_service_update
      or pg_catalog.has_column_privilege(
        'service_role',
        'public.products',
        column_record.attname,
        'REFERENCES'
      )
    then
      raise exception 'Product variants foundation postcondition: column privilege mismatch for %.',
        column_record.attname;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege('service_role', 'public.products', 'SELECT')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'DELETE')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'TRUNCATE')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'REFERENCES')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'TRIGGER')
  then
    raise exception 'Product variants foundation postcondition: service-role product privileges are incorrect.';
  end if;

  if not pg_catalog.has_table_privilege('anon', 'public.product_variants', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.product_variants', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or not pg_catalog.has_table_privilege('authenticated', 'public.product_variants', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.product_variants', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or not pg_catalog.has_table_privilege('service_role', 'public.product_variants', 'SELECT')
    or pg_catalog.has_table_privilege('service_role', 'public.product_variants', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  then
    raise exception 'Product variants foundation postcondition: variant table privileges are incorrect.';
  end if;

  for column_record in
    select attribute.attname
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.product_variants'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  loop
    if pg_catalog.has_column_privilege(
      'anon',
      'public.product_variants',
      column_record.attname,
      'INSERT'
    ) or pg_catalog.has_column_privilege(
      'anon',
      'public.product_variants',
      column_record.attname,
      'UPDATE'
    ) or pg_catalog.has_column_privilege(
      'anon',
      'public.product_variants',
      column_record.attname,
      'REFERENCES'
    ) or pg_catalog.has_column_privilege(
      'authenticated',
      'public.product_variants',
      column_record.attname,
      'INSERT'
    ) or pg_catalog.has_column_privilege(
      'authenticated',
      'public.product_variants',
      column_record.attname,
      'UPDATE'
    ) or pg_catalog.has_column_privilege(
      'authenticated',
      'public.product_variants',
      column_record.attname,
      'REFERENCES'
    ) or pg_catalog.has_column_privilege(
      'service_role',
      'public.product_variants',
      column_record.attname,
      'INSERT'
    ) or pg_catalog.has_column_privilege(
      'service_role',
      'public.product_variants',
      column_record.attname,
      'UPDATE'
    ) or pg_catalog.has_column_privilege(
      'service_role',
      'public.product_variants',
      column_record.attname,
      'REFERENCES'
    ) then
      raise exception 'Product variants foundation postcondition: variant column privilege mismatch for %.',
        column_record.attname;
    end if;
  end loop;

  if pg_catalog.current_setting(
    'marketa.variant_foundation.finalizer_hash'
  ) is distinct from pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure
  )) or pg_catalog.current_setting(
    'marketa.variant_foundation.decrement_hash'
  ) is distinct from coalesce(
    (
      select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'decrement_stock'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          = 'p_product_id uuid, p_quantity integer'
    ),
    'absent'
  ) then
    raise exception 'Product variants foundation postcondition: Ops 4 stock functions changed.';
  end if;

  if pg_catalog.current_setting(
    'marketa.variant_foundation.products_hash'
  ) is distinct from coalesce((
    select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.jsonb_build_array(
        product.id,
        product.vendor_id,
        product.name,
        product.description,
        product.price,
        product.stock,
        product.category,
        product.images,
        product.is_active,
        product.created_at,
        product.updated_at
      )::text),
      '' order by product.id
    ))
    from public.products as product
  ), pg_catalog.md5('')) or pg_catalog.current_setting(
    'marketa.variant_foundation.order_items_hash'
  ) is distinct from coalesce((
    select pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.md5((pg_catalog.to_jsonb(item)
        - 'product_variant_id'
        - 'variant_size_snapshot'
        - 'variant_colour_snapshot')::text),
      '' order by item.id
    ))
    from public.order_items as item
  ), pg_catalog.md5('')) then
    raise exception 'Product variants foundation postcondition: existing business rows changed.';
  end if;

  if pg_catalog.current_setting(
    'marketa.variant_foundation.product_policies_hash'
  ) is distinct from (
    select pg_catalog.md5(
      pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy)
        order by policy.policyname
      )::text
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) then
    raise exception 'Product variants foundation postcondition: product RLS policies changed.';
  end if;
end
$postcondition$;

commit;
