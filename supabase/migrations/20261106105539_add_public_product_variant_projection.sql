-- Product Variants Batch 2C-D3-A1: sanitized public product and variant reads.
-- Publication remains disabled by the existing draft-only constraints. This
-- migration adds read contracts only; it does not activate products or variants.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  relation_name text;
  helper_oid oid;
  service_role_select_expected boolean;
begin
  if pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.product_option_axes') is null
    or pg_catalog.to_regclass('public.product_option_values') is null
    or pg_catalog.to_regclass('public.product_variant_option_values') is null
    or pg_catalog.to_regclass('public.product_variant_combination_identities') is null
  then
    raise exception 'D3-A1 preflight: required product-option relations are missing.';
  end if;

  if pg_catalog.to_regclass('public.public_storefront_products') is not null
    or pg_catalog.to_regprocedure(
      'public.get_public_product_variant_projection(uuid)'
    ) is not null
  then
    raise exception 'D3-A1 preflight: a public projection object is already occupied.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_variant_mode_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ANY (ARRAY[''none''::text, ''size''::text, ''colour''::text, ''size_colour''::text, ''options''::text]))'
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
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_draft_only_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (is_active IS FALSE)'
  ) then
    raise exception 'D3-A1 preflight: variant inventory or publication authority changed.';
  end if;

  helper_oid := pg_catalog.to_regprocedure('public.is_vendor_active(uuid)');
  if helper_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid = helper_oid
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.prorettype = 'boolean'::pg_catalog.regtype
      and procedure.proconfig is not distinct from array['search_path=""']::text[]
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
  ) or pg_catalog.has_function_privilege('public', helper_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE')
  then
    raise exception 'D3-A1 preflight: vendor eligibility authority changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.policyname = 'products_public_read'
      and policy.cmd = 'SELECT'
      and policy.permissive = 'PERMISSIVE'
      and policy.roles = array['public']::name[]
      and policy.qual is not null
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'product_variants'
      and policy.policyname = 'product_variants_public_read'
      and policy.cmd = 'SELECT'
      and policy.permissive = 'PERMISSIVE'
      and policy.roles = array['public']::name[]
      and policy.qual is not null
  ) then
    raise exception 'D3-A1 preflight: public product read policies changed.';
  end if;

  foreach relation_name in array array[
    'product_option_axes',
    'product_option_values',
    'product_variant_option_values',
    'product_variant_combination_identities'
  ]::text[] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      where relation.oid = pg_catalog.to_regclass('public.' || relation_name)
        and relation.relrowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
    ) or exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = relation_name
    ) then
      raise exception 'D3-A1 preflight: private relation % configuration changed.',
        relation_name;
    end if;

    -- D3_A1_PRIVATE_ACL_MATRIX_START
    service_role_select_expected := relation_name in (
      'product_variant_option_values',
      'product_variant_combination_identities'
    );

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
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
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
      case
        when service_role_select_expected then 'INSERT,UPDATE,REFERENCES'
        else 'SELECT,INSERT,UPDATE,REFERENCES'
      end
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.' || relation_name, 'SELECT'
    ) is distinct from service_role_select_expected
    or exists (
      select 1
      from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) as acl
      where relation.oid = pg_catalog.to_regclass('public.' || relation_name)
        and (
          acl.grantee = 0
          or coalesce(pg_catalog.pg_get_userbyid(acl.grantee), '')
            not in ('postgres', 'service_role')
          or (
            pg_catalog.pg_get_userbyid(acl.grantee) = 'service_role'
            and (
              not service_role_select_expected
              or acl.privilege_type <> 'SELECT'
              or acl.is_grantable
            )
          )
        )
    ) or (
      service_role_select_expected
      and not exists (
        select 1
        from pg_catalog.pg_class as relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) as acl
        where relation.oid = pg_catalog.to_regclass('public.' || relation_name)
          and acl.grantee = 'service_role'::pg_catalog.regrole
          and acl.privilege_type = 'SELECT'
          and not acl.is_grantable
      )
    ) or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) as acl
      where attribute.attrelid = pg_catalog.to_regclass('public.' || relation_name)
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) then
      -- D3_A1_PRIVATE_ACL_MATRIX_END
      raise exception 'D3-A1 preflight: private relation % authority changed.',
        relation_name;
    end if;
  end loop;
end
$preflight$;

-- JSON contract:
-- {
--   product_id: uuid,
--   variant_mode: size | colour | size_colour | options,
--   axes: [{ id, label, position, values: [{ id, label, position, swatch_hex }] }],
--   combinations: [{ variant_id, stock, selections: [{ axis_id, value_id }] }]
-- }
-- Legacy axis/value IDs are deterministic, product-scoped UUID representations
-- derived from domain-separated canonical inputs. The normalized labels
-- themselves are not returned. Generalized IDs are the authoritative persisted
-- axis/value UUIDs. In every mode, product_variants.id remains the only
-- purchasable combination identity.
create function public.get_public_product_variant_projection(
  p_product_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with eligible_product as materialized (
  select
    product.id,
    product.vendor_id,
    product.variant_mode
  from public.products as product
  where $1 is not null
    and product.id = $1
    and product.is_active = true
    and product.variant_mode in ('size', 'colour', 'size_colour', 'options')
    and public.is_vendor_active(product.vendor_id)
),
eligible_variants as materialized (
  select
    variant.id,
    variant.product_id,
    variant.vendor_id,
    variant.size,
    variant.colour,
    variant.size_normalized,
    variant.colour_normalized,
    variant.stock,
    product.variant_mode
  from eligible_product as product
  join public.product_variants as variant
    on variant.product_id = product.id
   and variant.vendor_id = product.vendor_id
  where variant.is_active = true
    and (
      (
        product.variant_mode = 'size'
        and variant.size_normalized is not null
        and variant.colour_normalized is null
      ) or (
        product.variant_mode = 'colour'
        and variant.size_normalized is null
        and variant.colour_normalized is not null
      ) or (
        product.variant_mode = 'size_colour'
        and variant.size_normalized is not null
        and variant.colour_normalized is not null
      ) or (
        product.variant_mode = 'options'
        and variant.size is null
        and variant.colour is null
        and (
          select pg_catalog.count(*)
          from public.product_option_axes as axis
          where axis.product_id = product.id
            and axis.vendor_id = product.vendor_id
        ) between 1 and 3
        and (
          select pg_catalog.count(*)
          from public.product_variant_option_values as assignment
          where assignment.variant_id = variant.id
            and assignment.product_id = product.id
            and assignment.vendor_id = product.vendor_id
        ) = (
          select pg_catalog.count(*)
          from public.product_option_axes as axis
          where axis.product_id = product.id
            and axis.vendor_id = product.vendor_id
        )
        and not exists (
          select 1
          from public.product_variant_option_values as assignment
          left join public.product_option_axes as axis
            on axis.id = assignment.axis_id
           and axis.product_id = assignment.product_id
           and axis.vendor_id = assignment.vendor_id
          left join public.product_option_values as value
            on value.id = assignment.value_id
           and value.axis_id = assignment.axis_id
           and value.product_id = assignment.product_id
           and value.vendor_id = assignment.vendor_id
          where assignment.variant_id = variant.id
            and assignment.product_id = product.id
            and assignment.vendor_id = product.vendor_id
            and (axis.id is null or value.id is null)
        )
        and exists (
          select 1
          from public.product_variant_combination_identities as identity
          where identity.variant_id = variant.id
            and identity.product_id = product.id
            and identity.combination_signature = (
              select pg_catalog.string_agg(
                assignment.axis_id::text || '=' || assignment.value_id::text,
                '|' order by assignment.axis_id
              )
              from public.product_variant_option_values as assignment
              where assignment.variant_id = variant.id
                and assignment.product_id = product.id
                and assignment.vendor_id = product.vendor_id
            )
        )
      )
    )
),
legacy_value_seed as (
  select
    variant.product_id,
    'size'::text as axis_key,
    pg_catalog.md5(
      'marketa:d3-a1:legacy-axis:v1|product='
        || variant.product_id::text
        || '|axis=size'
    )::uuid::text as axis_id,
    'Size'::text as axis_label,
    1::integer as axis_position,
    variant.size_normalized as normalized_value,
    pg_catalog.btrim(variant.size) as display_label
  from eligible_variants as variant
  where variant.variant_mode in ('size', 'size_colour')
  union all
  select
    variant.product_id,
    'colour'::text,
    pg_catalog.md5(
      'marketa:d3-a1:legacy-axis:v1|product='
        || variant.product_id::text
        || '|axis=colour'
    )::uuid::text,
    'Colour'::text,
    case when variant.variant_mode = 'size_colour' then 2 else 1 end,
    variant.colour_normalized,
    pg_catalog.btrim(variant.colour)
  from eligible_variants as variant
  where variant.variant_mode in ('colour', 'size_colour')
),
legacy_value_catalog as (
  select
    seed.product_id,
    seed.axis_key,
    seed.axis_id,
    seed.axis_label,
    seed.axis_position,
    pg_catalog.md5(
      'marketa:d3-a1:legacy-value:v1|product='
        || seed.product_id::text
        || '|axis=' || seed.axis_key
        || '|value_bytes=' || pg_catalog.octet_length(seed.normalized_value)::text
        || '|value=' || seed.normalized_value
    )::uuid::text as value_id,
    pg_catalog.min(seed.display_label) as display_label,
    (
      pg_catalog.dense_rank() over (
        partition by seed.axis_id order by seed.normalized_value
      ) - 1
    )::integer as value_position,
    null::text as swatch_hex,
    seed.normalized_value
  from legacy_value_seed as seed
  group by
    seed.product_id,
    seed.axis_key,
    seed.axis_id,
    seed.axis_label,
    seed.axis_position,
    seed.normalized_value
),
generalized_value_catalog as (
  select distinct
    axis.id::text as axis_id,
    pg_catalog.btrim(axis.display_name) as axis_label,
    axis.position::integer as axis_position,
    value.id::text as value_id,
    pg_catalog.btrim(value.display_label) as display_label,
    value.sort_order as value_position,
    value.swatch_hex
  from eligible_variants as variant
  join public.product_variant_option_values as assignment
    on assignment.variant_id = variant.id
   and assignment.product_id = variant.product_id
   and assignment.vendor_id = variant.vendor_id
  join public.product_option_axes as axis
    on axis.id = assignment.axis_id
   and axis.product_id = assignment.product_id
   and axis.vendor_id = assignment.vendor_id
  join public.product_option_values as value
    on value.id = assignment.value_id
   and value.axis_id = assignment.axis_id
   and value.product_id = assignment.product_id
   and value.vendor_id = assignment.vendor_id
  where variant.variant_mode = 'options'
),
value_catalog as (
  select
    legacy.axis_id,
    legacy.axis_label,
    legacy.axis_position,
    legacy.value_id,
    legacy.display_label,
    legacy.value_position,
    legacy.swatch_hex
  from legacy_value_catalog as legacy
  union all
  select
    generalized.axis_id,
    generalized.axis_label,
    generalized.axis_position,
    generalized.value_id,
    generalized.display_label,
    generalized.value_position,
    generalized.swatch_hex
  from generalized_value_catalog as generalized
),
legacy_selection_links as (
  select
    variant.id as variant_id,
    catalog.axis_id,
    catalog.axis_position,
    catalog.value_id
  from eligible_variants as variant
  join legacy_value_catalog as catalog
    on catalog.product_id = variant.product_id
   and (
      (
        catalog.axis_key = 'size'
        and catalog.normalized_value = variant.size_normalized
      ) or (
        catalog.axis_key = 'colour'
        and catalog.normalized_value = variant.colour_normalized
      )
    )
  where variant.variant_mode in ('size', 'colour', 'size_colour')
),
generalized_selection_links as (
  select
    variant.id as variant_id,
    assignment.axis_id::text as axis_id,
    axis.position::integer as axis_position,
    assignment.value_id::text as value_id
  from eligible_variants as variant
  join public.product_variant_option_values as assignment
    on assignment.variant_id = variant.id
   and assignment.product_id = variant.product_id
   and assignment.vendor_id = variant.vendor_id
  join public.product_option_axes as axis
    on axis.id = assignment.axis_id
   and axis.product_id = assignment.product_id
   and axis.vendor_id = assignment.vendor_id
  where variant.variant_mode = 'options'
),
selection_links as (
  select * from legacy_selection_links
  union all
  select * from generalized_selection_links
),
axis_catalog as (
  select distinct
    value.axis_id,
    value.axis_label,
    value.axis_position
  from value_catalog as value
)
select pg_catalog.jsonb_build_object(
  'product_id', product.id,
  'variant_mode', product.variant_mode,
  'axes', (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', axis.axis_id,
        'label', axis.axis_label,
        'position', axis.axis_position,
        'values', (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', value.value_id,
              'label', value.display_label,
              'position', value.value_position,
              'swatch_hex', value.swatch_hex
            ) order by value.value_position, value.value_id
          )
          from value_catalog as value
          where value.axis_id = axis.axis_id
        )
      ) order by axis.axis_position, axis.axis_id
    )
    from axis_catalog as axis
  ),
  'combinations', (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variant_id', variant.id,
        'stock', variant.stock,
        'selections', (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'axis_id', selection.axis_id,
              'value_id', selection.value_id
            ) order by selection.axis_position, selection.axis_id
          )
          from selection_links as selection
          where selection.variant_id = variant.id
        )
      ) order by variant.id
    )
    from eligible_variants as variant
  )
)
from eligible_product as product
where exists (select 1 from eligible_variants)
  and not exists (
    select 1
    from eligible_variants as variant
    where (
      select pg_catalog.count(*)
      from selection_links as selection
      where selection.variant_id = variant.id
    ) is distinct from (
      select pg_catalog.count(*) from axis_catalog
    )
  )
$function$;

alter function public.get_public_product_variant_projection(uuid)
  owner to postgres;
revoke all privileges on function
  public.get_public_product_variant_projection(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.get_public_product_variant_projection(uuid)
  to anon, authenticated;

comment on function public.get_public_product_variant_projection(uuid) is
  'D3-A1 public customer-safe persisted variant projection; returns NULL unless parent, vendor, variants, assignments, and persisted identity are eligible.';

create view public.public_storefront_products
with (security_invoker = true, security_barrier = true)
as
select
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
  product.variant_mode,
  case
    when product.variant_mode = 'none' then product.stock::bigint
    else coalesce((
      select pg_catalog.sum((combination.value ->> 'stock')::bigint)
      from pg_catalog.jsonb_array_elements(
        coalesce(projection.payload -> 'combinations', '[]'::jsonb)
      ) as combination(value)
    ), 0::numeric)::bigint
  end as available_stock,
  case
    when product.variant_mode = 'none' then false
    else exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        coalesce(projection.payload -> 'combinations', '[]'::jsonb)
      ) as combination(value)
      where (combination.value ->> 'stock')::integer > 0
    )
  end as has_in_stock_combination
from public.products as product
left join lateral (
  select public.get_public_product_variant_projection(product.id) as payload
) as projection on product.variant_mode <> 'none'
where product.is_active = true
  and public.is_vendor_active(product.vendor_id);

alter view public.public_storefront_products owner to postgres;
revoke all privileges on table public.public_storefront_products
  from public, anon, authenticated, service_role;
grant select on table public.public_storefront_products
  to anon, authenticated;

comment on view public.public_storefront_products is
  'D3-A1 allowlisted public product projection with authoritative ordinary or persisted-variant availability.';

do $postcondition$
declare
  function_oid oid;
  relation_name text;
  service_role_select_expected boolean;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.public_storefront_products'::pg_catalog.regclass
      and relation.relkind = 'v'
      and relation.reloptions @> array[
        'security_invoker=true',
        'security_barrier=true'
      ]::text[]
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
  ) then
    raise exception 'D3-A1 postcondition: storefront view security is incorrect.';
  end if;

  if (
    select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.public_storefront_products'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) is distinct from array[
    'id', 'vendor_id', 'name', 'description', 'price', 'stock', 'category',
    'images', 'is_active', 'created_at', 'variant_mode', 'available_stock',
    'has_in_stock_combination'
  ]::text[] then
    raise exception 'D3-A1 postcondition: storefront view fields are incorrect.';
  end if;

  if pg_catalog.has_table_privilege(
    'public', 'public.public_storefront_products', 'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'anon', 'public.public_storefront_products', 'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'authenticated', 'public.public_storefront_products', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.public_storefront_products', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.public_storefront_products', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.public_storefront_products', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) then
    raise exception 'D3-A1 postcondition: storefront view ACL is incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(relation.relacl) as acl
    where relation.oid = 'public.public_storefront_products'::pg_catalog.regclass
      and (
        pg_catalog.pg_get_userbyid(acl.grantee)
          not in ('postgres', 'anon', 'authenticated')
        or (
          pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated')
          and (acl.privilege_type <> 'SELECT' or acl.is_grantable)
        )
      )
  ) then
    raise exception 'D3-A1 postcondition: storefront view has an unexpected grant.';
  end if;

  function_oid := pg_catalog.to_regprocedure(
    'public.get_public_product_variant_projection(uuid)'
  );
  if function_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_language as language
      on language.oid = procedure.prolang
    where procedure.oid = function_oid
      and language.lanname = 'sql'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.prorettype = 'jsonb'::pg_catalog.regtype
      and procedure.proconfig is not distinct from array['search_path=""']::text[]
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
  ) or pg_catalog.has_function_privilege('public', function_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
  then
    raise exception 'D3-A1 postcondition: projection function authority is incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.aclexplode((
      select procedure.proacl
      from pg_catalog.pg_proc as procedure
      where procedure.oid = function_oid
    )) as acl
    where acl.privilege_type = 'EXECUTE'
      and (
        pg_catalog.pg_get_userbyid(acl.grantee)
          not in ('postgres', 'anon', 'authenticated')
        or (
          pg_catalog.pg_get_userbyid(acl.grantee) <> 'postgres'
          and acl.is_grantable
        )
      )
  ) then
    raise exception 'D3-A1 postcondition: projection function has an unexpected grant.';
  end if;

  foreach relation_name in array array[
    'product_option_axes',
    'product_option_values',
    'product_variant_option_values',
    'product_variant_combination_identities'
  ]::text[] loop
    -- D3_A1_PRIVATE_ACL_MATRIX_START
    service_role_select_expected := relation_name in (
      'product_variant_option_values',
      'product_variant_combination_identities'
    );

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
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
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
      case
        when service_role_select_expected then 'INSERT,UPDATE,REFERENCES'
        else 'SELECT,INSERT,UPDATE,REFERENCES'
      end
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.' || relation_name, 'SELECT'
    ) is distinct from service_role_select_expected
    or exists (
      select 1
      from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) as acl
      where relation.oid = pg_catalog.to_regclass('public.' || relation_name)
        and (
          acl.grantee = 0
          or coalesce(pg_catalog.pg_get_userbyid(acl.grantee), '')
            not in ('postgres', 'service_role')
          or (
            pg_catalog.pg_get_userbyid(acl.grantee) = 'service_role'
            and (
              not service_role_select_expected
              or acl.privilege_type <> 'SELECT'
              or acl.is_grantable
            )
          )
        )
    ) or (
      service_role_select_expected
      and not exists (
        select 1
        from pg_catalog.pg_class as relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) as acl
        where relation.oid = pg_catalog.to_regclass('public.' || relation_name)
          and acl.grantee = 'service_role'::pg_catalog.regrole
          and acl.privilege_type = 'SELECT'
          and not acl.is_grantable
      )
    ) or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) as acl
      where attribute.attrelid = pg_catalog.to_regclass('public.' || relation_name)
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) then
      -- D3_A1_PRIVATE_ACL_MATRIX_END
      raise exception 'D3-A1 postcondition: private relation % gained authority.',
        relation_name;
    end if;
  end loop;
end
$postcondition$;

commit;
