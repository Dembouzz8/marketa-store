-- Product Variants Batch 2C-B1: category and generalized option foundation.
-- Purchasing, publication, generic-mode creation, and vendor mutation remain unavailable.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  relation_name text;
  function_name text;
begin
  if pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.vendors') is null
  then
    raise exception 'Product options B1 preflight: required tables are missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.products'::pg_catalog.regclass
      and relation.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.product_variants'::pg_catalog.regclass
      and relation.relrowsecurity
  ) then
    raise exception 'Product options B1 preflight: existing product RLS changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_mode_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ANY (ARRAY[''none''::text, ''size''::text, ''colour''::text, ''size_colour''::text]))'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_inventory_authority_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ''none''::text OR stock = 0)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_draft_publication_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ''none''::text OR is_active IS FALSE)'
  ) then
    raise exception 'Product options B1 preflight: variant authority changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_product_vendor_fkey'
      and constraint_record.convalidated
      and constraint_record.confrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.confdeltype = 'c'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_id_product_id_key'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'UNIQUE (id, product_id)'
  ) then
    raise exception 'Product options B1 preflight: variant ownership identity changed.';
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
    'vendor_delete_ordinary_products_only',
    'vendor_delete_own_active_products',
    'vendor_insert_own_active_products',
    'vendor_select_own_products',
    'vendor_update_own_active_products'
  ]::text[] or (
    select pg_catalog.array_agg(
      policy.policyname::text order by policy.policyname
    )
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'product_variants'
  ) is distinct from array[
    'product_variants_public_read',
    'vendor_select_own_product_variants'
  ]::text[] then
    raise exception 'Product options B1 preflight: existing RLS policy inventory changed.';
  end if;

  foreach relation_name in array array[
    'catalogue_categories',
    'catalogue_category_aliases',
    'option_definitions',
    'option_units',
    'option_size_systems',
    'category_option_templates',
    'product_option_axes',
    'product_option_values',
    'product_variant_option_values',
    'product_variant_combination_identities',
    'product_option_policy'
  ]::text[] loop
    if pg_catalog.to_regclass('public.' || relation_name) is not null then
      raise exception 'Product options B1 preflight: relation %.% is occupied.',
        'public', relation_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'category_code'
      and not attribute.attisdropped
  ) then
    raise exception 'Product options B1 preflight: products.category_code is occupied.';
  end if;

  foreach function_name in array array[
    'lock_product_option_structure()',
    'validate_product_option_axis()',
    'validate_product_option_value()',
    'assert_product_option_completeness(uuid)',
    'enforce_product_option_completeness()',
    'enforce_product_option_policy()'
  ]::text[] loop
    if pg_catalog.to_regprocedure('public.' || function_name) is not null then
      raise exception 'Product options B1 preflight: helper function % is occupied.',
        function_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgname in (
      'a_product_option_axes_serialization_guard',
      'a_product_option_values_serialization_guard',
      'a_product_variant_values_serialization_guard',
      'a_product_variants_option_serialization_guard',
      'product_option_axes_shape_guard',
      'product_option_values_shape_guard',
      'product_option_axes_completeness_guard',
      'product_variant_values_completeness_guard',
      'product_variants_option_completeness_guard',
      'product_option_policy_guard'
    )
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Product options B1 preflight: trigger name collision.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.category is not null
      and pg_catalog.btrim(product.category) <> ''
      and pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(product.category),
            '&',
            ' and ',
            'g'
          ),
          '[^a-zA-Z0-9]+',
          '-',
          'g'
        )
      ) not in (
        'fashion', 'phones-and-tablets', 'phones', 'phone', 'tablets',
        'mobile-phones', 'computing', 'computers', 'laptops', 'electronics',
        'home-and-kitchen', 'home', 'kitchen', 'home-and-living', 'appliances',
        'beauty-and-personal-care', 'beauty', 'personal-care',
        'food-and-groceries', 'food', 'food-and-drinks', 'groceries',
        'baby-kids-and-toys', 'baby', 'kids', 'toys',
        'health-and-wellness', 'health', 'wellness',
        'sports-and-fitness', 'sports', 'fitness',
        'automotive-accessories', 'automotive', 'auto-accessories'
      )
  ) then
    raise exception 'Product options B1 preflight: an existing product category has no approved canonical mapping.';
  end if;

  perform pg_catalog.set_config(
    'marketa.options_b1.products_hash',
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
    'marketa.options_b1.variants_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
        '' order by variant.id
      ))
      from public.product_variants as variant
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.options_b1.products_policies_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.options_b1.variants_policies_hash',
    coalesce((
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'product_variants'
    ), pg_catalog.md5('')),
    true
  );

  perform pg_catalog.set_config(
    'marketa.options_b1.vendor_rpc_hash',
    (
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)),
        '' order by procedure.oid::pg_catalog.regprocedure::text
      ))
      from pg_catalog.pg_proc as procedure
      where procedure.oid in (
        'public.configure_vendor_product_variant_mode(uuid,text)'::pg_catalog.regprocedure,
        'public.create_vendor_product_variant(uuid,text,text,integer)'::pg_catalog.regprocedure,
        'public.update_vendor_product_variant_labels(uuid,text,text)'::pg_catalog.regprocedure,
        'public.update_vendor_product_variant_stock(uuid,integer,bigint)'::pg_catalog.regprocedure,
        'public.delete_vendor_product_variant(uuid,bigint)'::pg_catalog.regprocedure
      )
    ),
    true
  );
end
$preflight$;

create table public.catalogue_categories (
  code text primary key,
  name text not null unique,
  is_active boolean not null default true,
  sort_order smallint not null unique,
  created_at timestamptz not null default pg_catalog.now(),
  constraint catalogue_categories_code_check
    check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint catalogue_categories_name_check
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 100),
  constraint catalogue_categories_sort_order_check
    check (sort_order > 0)
);

create table public.catalogue_category_aliases (
  alias_code text primary key,
  category_code text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint catalogue_category_aliases_code_check
    check (alias_code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint catalogue_category_aliases_category_fkey
    foreign key (category_code)
    references public.catalogue_categories (code)
    on update restrict
    on delete restrict
);

create table public.option_units (
  code text primary key,
  name text not null unique,
  symbol text not null,
  dimension_code text not null,
  is_active boolean not null default true,
  sort_order smallint not null unique,
  constraint option_units_code_check
    check (code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  constraint option_units_name_check
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 80),
  constraint option_units_symbol_check
    check (pg_catalog.char_length(pg_catalog.btrim(symbol)) between 1 and 20),
  constraint option_units_dimension_check
    check (dimension_code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  constraint option_units_sort_order_check
    check (sort_order > 0),
  constraint option_units_code_dimension_key unique (code, dimension_code)
);

create table public.option_size_systems (
  code text primary key,
  name text not null unique,
  is_active boolean not null default true,
  sort_order smallint not null unique,
  constraint option_size_systems_code_check
    check (code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  constraint option_size_systems_name_check
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 80),
  constraint option_size_systems_sort_order_check
    check (sort_order > 0)
);

create table public.option_definitions (
  code text primary key,
  name text not null unique,
  value_kind text not null,
  dimension_code text,
  requires_unit boolean not null default false,
  requires_size_system boolean not null default false,
  is_active boolean not null default true,
  sort_order smallint not null unique,
  constraint option_definitions_code_check
    check (code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  constraint option_definitions_name_check
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 80),
  constraint option_definitions_value_kind_check
    check (value_kind in ('label', 'measurement', 'colour')),
  constraint option_definitions_dimension_check
    check (
      (requires_unit and dimension_code is not null
        and value_kind = 'measurement')
      or (not requires_unit and dimension_code is null)
    ),
  constraint option_definitions_size_system_check
    check (not requires_size_system or value_kind = 'label'),
  constraint option_definitions_sort_order_check
    check (sort_order > 0),
  constraint option_definitions_code_dimension_key unique (code, dimension_code)
);

create table public.category_option_templates (
  category_code text not null,
  option_code text not null,
  sort_order smallint not null,
  default_unit_code text,
  default_size_system_code text,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (category_code, option_code),
  constraint category_option_templates_category_fkey
    foreign key (category_code)
    references public.catalogue_categories (code)
    on update restrict
    on delete restrict,
  constraint category_option_templates_option_fkey
    foreign key (option_code)
    references public.option_definitions (code)
    on update restrict
    on delete restrict,
  constraint category_option_templates_unit_fkey
    foreign key (default_unit_code)
    references public.option_units (code)
    on update restrict
    on delete restrict,
  constraint category_option_templates_size_system_fkey
    foreign key (default_size_system_code)
    references public.option_size_systems (code)
    on update restrict
    on delete restrict,
  constraint category_option_templates_sort_order_check
    check (sort_order > 0),
  constraint category_option_templates_order_key
    unique (category_code, sort_order)
);

create table public.product_option_policy (
  singleton boolean primary key default true,
  max_axes smallint not null default 3,
  max_combinations integer not null default 100,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_option_policy_singleton_check check (singleton),
  constraint product_option_policy_max_axes_check
    check (max_axes between 1 and 3),
  constraint product_option_policy_max_combinations_check
    check (max_combinations between 1 and 100)
);

create table public.product_option_axes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null,
  vendor_id uuid not null,
  option_code text not null,
  display_name text not null,
  position smallint not null,
  unit_code text,
  size_system_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_option_axes_product_vendor_fkey
    foreign key (product_id, vendor_id)
    references public.products (id, vendor_id)
    on update restrict
    on delete cascade,
  constraint product_option_axes_option_fkey
    foreign key (option_code)
    references public.option_definitions (code)
    on update restrict
    on delete restrict,
  constraint product_option_axes_unit_fkey
    foreign key (unit_code)
    references public.option_units (code)
    on update restrict
    on delete restrict,
  constraint product_option_axes_size_system_fkey
    foreign key (size_system_code)
    references public.option_size_systems (code)
    on update restrict
    on delete restrict,
  constraint product_option_axes_display_name_check
    check (pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 80),
  constraint product_option_axes_position_check check (position between 1 and 3),
  constraint product_option_axes_product_option_key unique (product_id, option_code),
  constraint product_option_axes_product_position_key unique (product_id, position),
  constraint product_option_axes_id_product_vendor_key
    unique (id, product_id, vendor_id)
);

create table public.product_option_values (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  axis_id uuid not null,
  product_id uuid not null,
  vendor_id uuid not null,
  display_label text not null,
  normalized_label text generated always as (
    nullif(
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(display_label),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      ''
    )
  ) stored,
  numeric_value numeric(18,6),
  swatch_hex text,
  sort_order integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_option_values_axis_fkey
    foreign key (axis_id, product_id, vendor_id)
    references public.product_option_axes (id, product_id, vendor_id)
    on update restrict
    on delete cascade,
  constraint product_option_values_label_check
    check (pg_catalog.char_length(pg_catalog.btrim(display_label)) between 1 and 80),
  constraint product_option_values_numeric_check
    check (numeric_value is null or numeric_value > 0),
  constraint product_option_values_swatch_check
    check (swatch_hex is null or swatch_hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint product_option_values_sort_order_check check (sort_order >= 0),
  constraint product_option_values_axis_label_key unique (axis_id, normalized_label),
  constraint product_option_values_axis_order_key unique (axis_id, sort_order),
  constraint product_option_values_id_axis_product_vendor_key
    unique (id, axis_id, product_id, vendor_id)
);

create table public.product_variant_option_values (
  variant_id uuid not null,
  axis_id uuid not null,
  value_id uuid not null,
  product_id uuid not null,
  vendor_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (variant_id, axis_id),
  constraint product_variant_option_values_variant_fkey
    foreign key (variant_id, product_id)
    references public.product_variants (id, product_id)
    on update restrict
    on delete cascade,
  constraint product_variant_option_values_axis_fkey
    foreign key (axis_id, product_id, vendor_id)
    references public.product_option_axes (id, product_id, vendor_id)
    on update restrict
    on delete cascade,
  constraint product_variant_option_values_value_fkey
    foreign key (value_id, axis_id, product_id, vendor_id)
    references public.product_option_values (id, axis_id, product_id, vendor_id)
    on update restrict
    on delete restrict,
  constraint product_variant_option_values_variant_value_key
    unique (variant_id, value_id)
);

create table public.product_variant_combination_identities (
  variant_id uuid primary key,
  product_id uuid not null,
  combination_signature text not null,
  constraint product_variant_combination_identities_variant_fkey
    foreign key (variant_id, product_id)
    references public.product_variants (id, product_id)
    on update restrict
    on delete cascade,
  constraint product_variant_combination_identities_signature_check
    check (pg_catalog.char_length(combination_signature) > 0),
  constraint product_variant_combination_identities_product_signature_key
    unique (product_id, combination_signature)
);

alter table public.products
  add column category_code text;

alter table public.products
  add constraint products_category_code_fkey
    foreign key (category_code)
    references public.catalogue_categories (code)
    on update restrict
    on delete restrict;

insert into public.catalogue_categories (code, name, sort_order)
values
  ('fashion', 'Fashion', 1),
  ('phones-and-tablets', 'Phones & Tablets', 2),
  ('computing', 'Computing', 3),
  ('electronics', 'Electronics', 4),
  ('home-and-kitchen', 'Home & Kitchen', 5),
  ('appliances', 'Appliances', 6),
  ('beauty-and-personal-care', 'Beauty & Personal Care', 7),
  ('food-and-groceries', 'Food & Groceries', 8),
  ('baby-kids-and-toys', 'Baby, Kids & Toys', 9),
  ('health-and-wellness', 'Health & Wellness', 10),
  ('sports-and-fitness', 'Sports & Fitness', 11),
  ('automotive-accessories', 'Automotive Accessories', 12);

insert into public.catalogue_category_aliases (alias_code, category_code)
values
  ('fashion', 'fashion'),
  ('phones-and-tablets', 'phones-and-tablets'),
  ('phones', 'phones-and-tablets'),
  ('phone', 'phones-and-tablets'),
  ('tablets', 'phones-and-tablets'),
  ('mobile-phones', 'phones-and-tablets'),
  ('computing', 'computing'),
  ('computers', 'computing'),
  ('laptops', 'computing'),
  ('electronics', 'electronics'),
  ('home-and-kitchen', 'home-and-kitchen'),
  ('home', 'home-and-kitchen'),
  ('kitchen', 'home-and-kitchen'),
  ('home-and-living', 'home-and-kitchen'),
  ('appliances', 'appliances'),
  ('beauty-and-personal-care', 'beauty-and-personal-care'),
  ('beauty', 'beauty-and-personal-care'),
  ('personal-care', 'beauty-and-personal-care'),
  ('food-and-groceries', 'food-and-groceries'),
  ('food', 'food-and-groceries'),
  ('food-and-drinks', 'food-and-groceries'),
  ('groceries', 'food-and-groceries'),
  ('baby-kids-and-toys', 'baby-kids-and-toys'),
  ('baby', 'baby-kids-and-toys'),
  ('kids', 'baby-kids-and-toys'),
  ('toys', 'baby-kids-and-toys'),
  ('health-and-wellness', 'health-and-wellness'),
  ('health', 'health-and-wellness'),
  ('wellness', 'health-and-wellness'),
  ('sports-and-fitness', 'sports-and-fitness'),
  ('sports', 'sports-and-fitness'),
  ('fitness', 'sports-and-fitness'),
  ('automotive-accessories', 'automotive-accessories'),
  ('automotive', 'automotive-accessories'),
  ('auto-accessories', 'automotive-accessories');

insert into public.option_units (
  code, name, symbol, dimension_code, sort_order
)
values
  ('mm', 'Millimetre', 'mm', 'length', 1),
  ('cm', 'Centimetre', 'cm', 'length', 2),
  ('m', 'Metre', 'm', 'length', 3),
  ('g', 'Gram', 'g', 'mass', 4),
  ('kg', 'Kilogram', 'kg', 'mass', 5),
  ('ml', 'Millilitre', 'ml', 'volume', 6),
  ('l', 'Litre', 'L', 'volume', 7),
  ('gb', 'Gigabyte', 'GB', 'digital_storage', 8),
  ('tb', 'Terabyte', 'TB', 'digital_storage', 9),
  ('v', 'Volt', 'V', 'electric_potential', 10),
  ('count', 'Count', 'unit', 'count', 11);

insert into public.option_size_systems (code, name, sort_order)
values
  ('eu', 'European', 1),
  ('uk', 'United Kingdom', 2),
  ('us_mens', 'United States Men', 3),
  ('us_womens', 'United States Women', 4),
  ('ng', 'Nigeria', 5),
  ('manufacturer', 'Manufacturer Defined', 6),
  ('manufacturer_unspecified', 'Manufacturer Unspecified', 7);

insert into public.option_definitions (
  code,
  name,
  value_kind,
  dimension_code,
  requires_unit,
  requires_size_system,
  sort_order
)
values
  ('size', 'Size', 'label', null, false, true, 1),
  ('colour', 'Colour', 'colour', null, false, false, 2),
  ('waist', 'Waist', 'measurement', 'length', true, false, 3),
  ('inseam', 'Inseam', 'measurement', 'length', true, false, 4),
  ('width', 'Width', 'measurement', 'length', true, false, 5),
  ('length', 'Length', 'measurement', 'length', true, false, 6),
  ('storage', 'Storage', 'measurement', 'digital_storage', true, false, 7),
  ('ram', 'RAM', 'measurement', 'digital_storage', true, false, 8),
  ('shade', 'Shade', 'colour', null, false, false, 9),
  ('volume', 'Volume', 'measurement', 'volume', true, false, 10),
  ('pack_size', 'Pack Size', 'measurement', 'count', true, false, 11),
  ('texture', 'Texture', 'label', null, false, false, 12),
  ('density', 'Density', 'label', null, false, false, 13),
  ('fragrance', 'Fragrance', 'label', null, false, false, 14),
  ('concentration', 'Concentration', 'label', null, false, false, 15),
  ('weight', 'Weight', 'measurement', 'mass', true, false, 16),
  ('flavour', 'Flavour', 'label', null, false, false, 17),
  ('material', 'Material', 'label', null, false, false, 18),
  ('firmness', 'Firmness', 'label', null, false, false, 19),
  ('finish', 'Finish', 'label', null, false, false, 20),
  ('gemstone', 'Gemstone', 'label', null, false, false, 21),
  ('capacity', 'Capacity', 'label', null, false, false, 22),
  ('plug_voltage', 'Plug Voltage', 'measurement', 'electric_potential', true, false, 23);

insert into public.category_option_templates (
  category_code,
  option_code,
  sort_order,
  default_unit_code,
  default_size_system_code
)
values
  -- Taxonomy review remains deferred for shoe, wig/hair, perfume, furniture,
  -- and jewellery-specific templates. B1 intentionally keeps the approved
  -- seed inventory and does not infer an Others mapping.
  ('fashion', 'size', 1, null, 'manufacturer_unspecified'),
  ('fashion', 'colour', 2, null, null),
  ('fashion', 'waist', 3, 'cm', null),
  ('fashion', 'inseam', 4, 'cm', null),
  ('phones-and-tablets', 'storage', 1, 'gb', null),
  ('phones-and-tablets', 'ram', 2, 'gb', null),
  ('phones-and-tablets', 'colour', 3, null, null),
  ('computing', 'storage', 1, 'gb', null),
  ('computing', 'ram', 2, 'gb', null),
  ('computing', 'colour', 3, null, null),
  ('electronics', 'colour', 1, null, null),
  ('electronics', 'storage', 2, 'gb', null),
  ('electronics', 'capacity', 3, null, null),
  ('home-and-kitchen', 'size', 1, null, 'manufacturer_unspecified'),
  ('home-and-kitchen', 'colour', 2, null, null),
  ('home-and-kitchen', 'material', 3, null, null),
  ('appliances', 'capacity', 1, null, null),
  ('appliances', 'colour', 2, null, null),
  ('appliances', 'plug_voltage', 3, 'v', null),
  ('beauty-and-personal-care', 'shade', 1, null, null),
  ('beauty-and-personal-care', 'volume', 2, 'ml', null),
  ('beauty-and-personal-care', 'colour', 3, null, null),
  ('food-and-groceries', 'pack_size', 1, 'count', null),
  ('food-and-groceries', 'weight', 2, 'g', null),
  ('food-and-groceries', 'flavour', 3, null, null),
  ('baby-kids-and-toys', 'size', 1, null, 'manufacturer_unspecified'),
  ('baby-kids-and-toys', 'colour', 2, null, null),
  ('baby-kids-and-toys', 'pack_size', 3, 'count', null),
  ('health-and-wellness', 'size', 1, null, 'manufacturer_unspecified'),
  ('health-and-wellness', 'volume', 2, 'ml', null),
  ('health-and-wellness', 'pack_size', 3, 'count', null),
  ('sports-and-fitness', 'size', 1, null, 'manufacturer_unspecified'),
  ('sports-and-fitness', 'colour', 2, null, null),
  ('sports-and-fitness', 'weight', 3, 'kg', null),
  ('automotive-accessories', 'size', 1, null, 'manufacturer_unspecified'),
  ('automotive-accessories', 'colour', 2, null, null),
  ('automotive-accessories', 'capacity', 3, null, null);

insert into public.product_option_policy (
  singleton, max_axes, max_combinations
)
values (true, 3, 100);

-- Product-option structural writes serialize on the same advisory-lock identity
-- used by the five existing vendor variant RPCs. Legitimate authenticated RPCs
-- keep their established order: vendor FOR SHARE, product advisory lock,
-- product FOR UPDATE, variant FOR UPDATE, then structural DML. These triggers
-- are defense in depth and re-enter the already-held lock for legacy inserts
-- and deletes. Stock, stock_version, and label-only variant updates are not
-- option-structure changes and intentionally do not acquire this advisory lock.
-- A future generic management RPC must use that same order before its first DML.
-- Cross-product privileged updates lock both product UUIDs in ascending order.
-- The count proof below supports PostgreSQL READ COMMITTED; generalized write
-- contracts must not opt into a weaker, stale-snapshot assumption.
create function public.lock_product_option_structure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  old_product_id uuid;
  new_product_id uuid;
  locked_product_id uuid;
begin
  if tg_op = 'INSERT' then
    new_product_id := new.product_id;
  elsif tg_op = 'DELETE' then
    old_product_id := old.product_id;
  else
    old_product_id := old.product_id;
    new_product_id := new.product_id;
  end if;

  for locked_product_id in
    select distinct candidate.product_id
    from pg_catalog.unnest(
      array[old_product_id, new_product_id]::uuid[]
    ) as candidate(product_id)
    where candidate.product_id is not null
    order by candidate.product_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(locked_product_id::text, 0)
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end
$function$;

create function public.validate_product_option_axis()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  definition_record record;
  unit_dimension text;
begin
  select
    definition.value_kind,
    definition.dimension_code,
    definition.requires_unit,
    definition.requires_size_system,
    definition.is_active
  into definition_record
  from public.option_definitions as definition
  where definition.code = new.option_code;

  if definition_record.value_kind is null or not definition_record.is_active then
    raise exception using
      errcode = '23514',
      message = 'The selected option definition is unavailable.';
  end if;

  if definition_record.requires_unit is distinct from (new.unit_code is not null)
    or definition_record.requires_size_system is distinct from
      (new.size_system_code is not null)
  then
    raise exception using
      errcode = '23514',
      message = 'Option unit or size-system requirements are not satisfied.';
  end if;

  if new.unit_code is not null then
    select unit.dimension_code
    into unit_dimension
    from public.option_units as unit
    where unit.code = new.unit_code
      and unit.is_active;

    if unit_dimension is distinct from definition_record.dimension_code then
      raise exception using
        errcode = '23514',
        message = 'The selected option unit has the wrong measurement dimension.';
    end if;
  end if;

  if new.size_system_code is not null and not exists (
    select 1
    from public.option_size_systems as size_system
    where size_system.code = new.size_system_code
      and size_system.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'The selected size system is unavailable.';
  end if;

  return new;
end
$function$;

create function public.validate_product_option_value()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  value_kind text;
begin
  select definition.value_kind
  into value_kind
  from public.product_option_axes as axis
  join public.option_definitions as definition
    on definition.code = axis.option_code
  where axis.id = new.axis_id
    and axis.product_id = new.product_id
    and axis.vendor_id = new.vendor_id;

  if value_kind is null then
    raise exception using
      errcode = '23514',
      message = 'The option value axis is unavailable.';
  end if;

  if (value_kind = 'measurement') is distinct from
    (new.numeric_value is not null)
  then
    raise exception using
      errcode = '23514',
      message = 'Measurement option values require a positive numeric value.';
  end if;

  if value_kind <> 'colour' and new.swatch_hex is not null then
    raise exception using
      errcode = '23514',
      message = 'Only colour option values may define a swatch.';
  end if;

  return new;
end
$function$;

create function public.assert_product_option_completeness(p_product_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  axis_count integer;
  variant_count integer;
  maximum_axes integer;
  maximum_combinations integer;
begin
  if p_product_id is null then
    return;
  end if;

  -- Re-enter the product lock defensively before any cross-row snapshot. Every
  -- structural write trigger acquires it before mutation and holds it through
  -- this deferred validation and transaction completion.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  select policy.max_axes, policy.max_combinations
  into maximum_axes, maximum_combinations
  from public.product_option_policy as policy
  where policy.singleton;

  if maximum_axes is null or maximum_combinations is null then
    raise exception using
      errcode = '23514',
      message = 'Product option policy is unavailable.';
  end if;

  select pg_catalog.count(*)::integer
  into axis_count
  from public.product_option_axes as axis
  where axis.product_id = p_product_id;

  if axis_count = 0 then
    delete from public.product_variant_combination_identities as identity
    where identity.product_id = p_product_id;
    return;
  end if;

  if axis_count > maximum_axes then
    raise exception using
      errcode = '23514',
      message = 'A product exceeds the configured option-axis limit.';
  end if;

  select pg_catalog.count(*)::integer
  into variant_count
  from public.product_variants as variant
  where variant.product_id = p_product_id;

  if variant_count > maximum_combinations then
    raise exception using
      errcode = '23514',
      message = 'A product exceeds the configured option-combination limit.';
  end if;

  if exists (
    select 1
    from public.product_variants as variant
    where variant.product_id = p_product_id
      and (
        select pg_catalog.count(*)
        from public.product_variant_option_values as assignment
        where assignment.variant_id = variant.id
          and assignment.product_id = variant.product_id
      ) <> axis_count
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every product variant must select one value for every option axis.';
  end if;

  -- Rebuild the private identity authority from complete assignments. The
  -- persisted UNIQUE (product_id, combination_signature) constraint, rather
  -- than this function's snapshot alone, arbitrates concurrent duplicates.
  delete from public.product_variant_combination_identities as identity
  where identity.product_id = p_product_id;

  begin
    insert into public.product_variant_combination_identities (
      variant_id,
      product_id,
      combination_signature
    )
    select
      variant.id,
      variant.product_id,
      pg_catalog.string_agg(
        assignment.axis_id::text || '=' || assignment.value_id::text,
        '|' order by assignment.axis_id
      )
    from public.product_variants as variant
    join public.product_variant_option_values as assignment
      on assignment.variant_id = variant.id
     and assignment.product_id = variant.product_id
    where variant.product_id = p_product_id
    group by variant.id, variant.product_id;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'Duplicate product option combination.';
  end;

  if (
    select pg_catalog.count(*)::integer
    from public.product_variant_combination_identities as identity
    where identity.product_id = p_product_id
  ) is distinct from variant_count then
    raise exception using
      errcode = '23514',
      message = 'Product option combination identity is incomplete.';
  end if;
end
$function$;

create function public.enforce_product_option_completeness()
returns trigger
language plpgsql
-- A deferred trigger can fire after a SECURITY DEFINER vendor RPC has returned.
-- Keep the trigger wrapper narrowly privileged so commit-time validation does
-- not inherit the authenticated caller's lack of access to private B1 tables.
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.assert_product_option_completeness(new.product_id);
  elsif tg_op = 'DELETE' then
    perform public.assert_product_option_completeness(old.product_id);
  else
    perform public.assert_product_option_completeness(old.product_id);
    if new.product_id is distinct from old.product_id then
      perform public.assert_product_option_completeness(new.product_id);
    end if;
  end if;

  return null;
end
$function$;

create function public.enforce_product_option_policy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  product_record record;
begin
  for product_record in
    select distinct axis.product_id
    from public.product_option_axes as axis
    order by axis.product_id
  loop
    perform public.assert_product_option_completeness(
      product_record.product_id
    );
  end loop;

  return null;
end
$function$;

alter function public.lock_product_option_structure() owner to postgres;
alter function public.validate_product_option_axis() owner to postgres;
alter function public.validate_product_option_value() owner to postgres;
alter function public.assert_product_option_completeness(uuid) owner to postgres;
alter function public.enforce_product_option_completeness() owner to postgres;
alter function public.enforce_product_option_policy() owner to postgres;

revoke all privileges on function public.lock_product_option_structure()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.validate_product_option_axis()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.validate_product_option_value()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.assert_product_option_completeness(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_product_option_completeness()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_product_option_policy()
  from public, anon, authenticated, service_role;

create trigger a_product_option_axes_serialization_guard
before insert or update or delete on public.product_option_axes
for each row
execute function public.lock_product_option_structure();

create trigger a_product_option_values_serialization_guard
before insert or update or delete on public.product_option_values
for each row
execute function public.lock_product_option_structure();

create trigger a_product_variant_values_serialization_guard
before insert or update or delete on public.product_variant_option_values
for each row
execute function public.lock_product_option_structure();

create trigger a_product_variants_option_serialization_guard
before insert or delete on public.product_variants
for each row
execute function public.lock_product_option_structure();

create trigger product_option_axes_shape_guard
before insert or update on public.product_option_axes
for each row
execute function public.validate_product_option_axis();

create trigger product_option_values_shape_guard
before insert or update on public.product_option_values
for each row
execute function public.validate_product_option_value();

create constraint trigger product_option_axes_completeness_guard
after insert or update or delete on public.product_option_axes
deferrable initially deferred
for each row
execute function public.enforce_product_option_completeness();

create constraint trigger product_variant_values_completeness_guard
after insert or update or delete on public.product_variant_option_values
deferrable initially deferred
for each row
execute function public.enforce_product_option_completeness();

create constraint trigger product_variants_option_completeness_guard
after insert or delete on public.product_variants
deferrable initially deferred
for each row
execute function public.enforce_product_option_completeness();

create constraint trigger product_option_policy_guard
after insert or update or delete on public.product_option_policy
deferrable initially deferred
for each row
execute function public.enforce_product_option_policy();

create index product_option_axes_product_id_idx
  on public.product_option_axes (product_id);
create index products_category_code_idx
  on public.products (category_code);
create index product_option_values_product_id_idx
  on public.product_option_values (product_id);
create index product_variant_option_values_product_id_idx
  on public.product_variant_option_values (product_id);
create index product_variant_option_values_value_id_idx
  on public.product_variant_option_values (value_id);

alter table public.catalogue_categories enable row level security;
alter table public.catalogue_category_aliases enable row level security;
alter table public.option_definitions enable row level security;
alter table public.option_units enable row level security;
alter table public.option_size_systems enable row level security;
alter table public.category_option_templates enable row level security;
alter table public.product_option_axes enable row level security;
alter table public.product_option_values enable row level security;
alter table public.product_variant_option_values enable row level security;
alter table public.product_variant_combination_identities enable row level security;
alter table public.product_option_policy enable row level security;

revoke all privileges on table
  public.catalogue_categories,
  public.catalogue_category_aliases,
  public.option_definitions,
  public.option_units,
  public.option_size_systems,
  public.category_option_templates,
  public.product_option_axes,
  public.product_option_values,
  public.product_variant_option_values,
  public.product_variant_combination_identities,
  public.product_option_policy
from public, anon, authenticated, service_role;

do $postcondition$
declare
  relation_name text;
  function_record record;
begin
  if (
    select pg_catalog.count(*)
    from public.catalogue_categories
  ) <> 12 or (
    select pg_catalog.count(*)
    from public.catalogue_category_aliases
  ) <> 35 or exists (
    select 1
    from public.catalogue_category_aliases as alias
    where alias.alias_code = 'others'
  ) then
    raise exception 'Product options B1 postcondition: category reference data is incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from public.option_units
  ) <> 11 or (
    select pg_catalog.count(*)
    from public.option_size_systems
  ) <> 7 or (
    select pg_catalog.count(*)
    from public.option_definitions
  ) <> 23 or (
    select pg_catalog.count(*)
    from public.category_option_templates
  ) <> 37 then
    raise exception 'Product options B1 postcondition: option reference data is incorrect.';
  end if;

  if not exists (
    select 1
    from public.product_option_policy as policy
    where policy.singleton
      and policy.max_axes = 3
      and policy.max_combinations = 100
  ) or (
    select pg_catalog.count(*) from public.product_option_policy
  ) <> 1 then
    raise exception 'Product options B1 postcondition: resource policy is incorrect.';
  end if;

  foreach relation_name in array array[
    'catalogue_categories',
    'catalogue_category_aliases',
    'option_definitions',
    'option_units',
    'option_size_systems',
    'category_option_templates',
    'product_option_axes',
    'product_option_values',
    'product_variant_option_values',
    'product_variant_combination_identities',
    'product_option_policy'
  ]::text[] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = relation_name
        and relation.relkind = 'r'
        and relation.relrowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
    ) then
      raise exception 'Product options B1 postcondition: table % ownership or RLS is incorrect.',
        relation_name;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = relation_name
    ) then
      raise exception 'Product options B1 postcondition: table % has an unexpected RLS policy.',
        relation_name;
    end if;

    if pg_catalog.has_table_privilege(
      'public', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_any_column_privilege(
      'public', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,REFERENCES'
    ) or pg_catalog.has_any_column_privilege(
      'anon', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,REFERENCES'
    ) or pg_catalog.has_any_column_privilege(
      'authenticated', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,REFERENCES'
    ) or pg_catalog.has_any_column_privilege(
      'service_role', 'public.' || relation_name,
      'SELECT,INSERT,UPDATE,REFERENCES'
    ) then
      raise exception 'Product options B1 postcondition: table % exposes unintended privileges.',
        relation_name;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'category_code'
      and not attribute.attisdropped
      and not attribute.attnotnull
      and attribute.atttypid = 'text'::pg_catalog.regtype
  ) or exists (
    select 1
    from public.products as product
    where product.category_code is not null
  ) then
    raise exception 'Product options B1 postcondition: nullable category compatibility is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
        'public.product_variant_combination_identities'::pg_catalog.regclass
      and constraint_record.conname =
        'product_variant_combination_identities_product_signature_key'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'UNIQUE (product_id, combination_signature)'
  ) or exists (
    select 1
    from public.product_variant_combination_identities
  ) then
    raise exception 'Product options B1 postcondition: combination identity authority is incorrect.';
  end if;

  if pg_catalog.has_column_privilege(
    'anon', 'public.products', 'category_code', 'INSERT'
  ) or pg_catalog.has_column_privilege(
    'anon', 'public.products', 'category_code', 'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.products', 'category_code', 'INSERT'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.products', 'category_code', 'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'service_role', 'public.products', 'category_code', 'INSERT'
  ) or pg_catalog.has_column_privilege(
    'service_role', 'public.products', 'category_code', 'UPDATE'
  ) then
    raise exception 'Product options B1 postcondition: category_code is browser writable.';
  end if;

  for function_record in
    select
      procedure.oid,
      procedure.oid::pg_catalog.regprocedure::text as signature,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.lock_product_option_structure()'::pg_catalog.regprocedure,
      'public.validate_product_option_axis()'::pg_catalog.regprocedure,
      'public.validate_product_option_value()'::pg_catalog.regprocedure,
      'public.assert_product_option_completeness(uuid)'::pg_catalog.regprocedure,
      'public.enforce_product_option_completeness()'::pg_catalog.regprocedure,
      'public.enforce_product_option_policy()'::pg_catalog.regprocedure
    )
  loop
    if function_record.owner <> 'postgres'
      or function_record.prosecdef is distinct from (
        function_record.oid =
          'public.enforce_product_option_completeness()'::pg_catalog.regprocedure
      )
      or function_record.provolatile <> 'v'
      or function_record.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.has_function_privilege('public', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    then
      raise exception 'Product options B1 postcondition: helper % authority is incorrect.',
        function_record.signature;
    end if;
  end loop;

  if position(
    'pg_catalog.pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(
      'public.lock_product_option_structure()'::pg_catalog.regprocedure
    )
  ) = 0 or position(
    'pg_catalog.hashtextextended' in pg_catalog.pg_get_functiondef(
      'public.lock_product_option_structure()'::pg_catalog.regprocedure
    )
  ) = 0 or position(
    'pg_catalog.pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(
      'public.assert_product_option_completeness(uuid)'::pg_catalog.regprocedure
    )
  ) = 0 then
    raise exception 'Product options B1 postcondition: product serialization authority is incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgname in (
        'a_product_option_axes_serialization_guard',
        'a_product_option_values_serialization_guard',
        'a_product_variant_values_serialization_guard',
        'a_product_variants_option_serialization_guard',
        'product_option_axes_shape_guard',
        'product_option_values_shape_guard',
        'product_option_axes_completeness_guard',
        'product_variant_values_completeness_guard',
        'product_variants_option_completeness_guard',
        'product_option_policy_guard'
      )
      and trigger_record.tgenabled = 'O'
  ) <> 10 then
    raise exception 'Product options B1 postcondition: option trigger inventory is incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.product_variants'::pg_catalog.regclass
      and trigger_record.tgname =
        'a_product_variants_option_serialization_guard'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 15
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.product_variants'::pg_catalog.regclass
      and trigger_record.tgname = 'product_variants_option_completeness_guard'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 13
      and trigger_record.tgdeferrable
      and trigger_record.tginitdeferred
  ) then
    raise exception 'Product options B1 postcondition: variant membership trigger scope is incorrect.';
  end if;

  if pg_catalog.current_setting('marketa.options_b1.products_hash')
    is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5((pg_catalog.to_jsonb(product) - 'category_code')::text),
        '' order by product.id
      ))
      from public.products as product
    ), pg_catalog.md5('')) or pg_catalog.current_setting(
      'marketa.options_b1.variants_hash'
    ) is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.to_jsonb(variant)::text),
        '' order by variant.id
      ))
      from public.product_variants as variant
    ), pg_catalog.md5('')) then
    raise exception 'Product options B1 postcondition: existing product or variant rows changed.';
  end if;

  if pg_catalog.current_setting('marketa.options_b1.products_policies_hash')
    is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ), pg_catalog.md5('')) or pg_catalog.current_setting(
      'marketa.options_b1.variants_policies_hash'
    ) is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy) order by policy.policyname
      )::text)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'product_variants'
    ), pg_catalog.md5('')) then
    raise exception 'Product options B1 postcondition: existing RLS policies changed.';
  end if;

  if pg_catalog.current_setting('marketa.options_b1.vendor_rpc_hash')
    is distinct from (
      select pg_catalog.md5(pg_catalog.string_agg(
        pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)),
        '' order by procedure.oid::pg_catalog.regprocedure::text
      ))
      from pg_catalog.pg_proc as procedure
      where procedure.oid in (
        'public.configure_vendor_product_variant_mode(uuid,text)'::pg_catalog.regprocedure,
        'public.create_vendor_product_variant(uuid,text,text,integer)'::pg_catalog.regprocedure,
        'public.update_vendor_product_variant_labels(uuid,text,text)'::pg_catalog.regprocedure,
        'public.update_vendor_product_variant_stock(uuid,integer,bigint)'::pg_catalog.regprocedure,
        'public.delete_vendor_product_variant(uuid,bigint)'::pg_catalog.regprocedure
      )
    ) then
    raise exception 'Product options B1 postcondition: existing vendor RPCs changed.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.variant_mode not in ('none', 'size', 'colour', 'size_colour')
  ) or exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_mode_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        <> 'CHECK (variant_mode = ANY (ARRAY[''none''::text, ''size''::text, ''colour''::text, ''size_colour''::text]))'
  ) then
    raise exception 'Product options B1 postcondition: generic purchasing mode was introduced.';
  end if;
end
$postcondition$;

commit;
