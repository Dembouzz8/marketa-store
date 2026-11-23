-- Product Variants Batch 2C-D5-1: secure publication and deactivation authority.
-- Variant purchasing remains disabled. Installation creates no published rows.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare
  function_hash text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'D5-1 preflight: PostgreSQL 17 or newer is required.';
  end if;

  if pg_catalog.to_regnamespace('marketa_private') is null
    or pg_catalog.to_regclass('public.products') is null
    or pg_catalog.to_regclass('public.product_variants') is null
    or pg_catalog.to_regclass('public.vendors') is null
    or pg_catalog.to_regclass('public.product_option_policy') is null
    or pg_catalog.to_regclass('public.product_option_axes') is null
    or pg_catalog.to_regclass('public.product_option_values') is null
    or pg_catalog.to_regclass('public.product_variant_option_values') is null
    or pg_catalog.to_regclass(
      'public.product_variant_combination_identities'
    ) is null
  then
    raise exception 'D5-1 preflight: required variant relations are missing.';
  end if;

  if pg_catalog.to_regclass(
      'marketa_private.variant_publication_release_control'
    ) is not null
    or pg_catalog.to_regclass(
      'marketa_private.variant_publication_authorizations'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.set_vendor_product_variant_publication(uuid,boolean)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'marketa_private.assert_variant_publication_structure(uuid,boolean)'
    ) is not null
  then
    raise exception 'D5-1 preflight: publication authority objects already exist.';
  end if;

  if not exists (
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
    where constraint_record.conrelid =
        'public.product_variants'::pg_catalog.regclass
      and constraint_record.conname = 'product_variants_draft_only_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (is_active IS FALSE)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.products'::pg_catalog.regclass
      and constraint_record.conname = 'products_inventory_authority_check'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        = 'CHECK (variant_mode = ''none''::text OR stock = 0)'
  ) then
    raise exception 'D5-1 preflight: draft or inventory authority changed.';
  end if;

  if pg_catalog.to_regprocedure(
      'public.update_vendor_product_variant_stock(uuid,integer,bigint)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.get_public_product_variant_projection(uuid)'
    ) is null
  then
    raise exception 'D5-1 preflight: a protected variant contract is missing.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure;

  if function_hash is distinct from 'c34ac95900ffa3c7bd2072256a56f203' then
    raise exception 'D5-1 preflight: C2 snapshot validator changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure;

  if function_hash is distinct from '74a760039e13ce5ff09e3b9ef76d7c21' then
    raise exception 'D5-1 preflight: C3 finalizer changed.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.variant_mode <> 'none'
      and product.is_active is distinct from false
  ) or exists (
    select 1
    from public.product_variants as variant
    where variant.is_active is distinct from false
  ) then
    raise exception 'D5-1 preflight: existing variant publication state is incompatible.';
  end if;
end
$preflight$;

-- This singleton is intentionally not exposed through an RPC. PostgreSQL
-- administration must grant a separate trusted role before anyone other than
-- the owner can change it. A missing row or any value other than TRUE fails
-- closed. Publication takes FOR SHARE; an administrative UPDATE takes the
-- conflicting row lock, giving release changes and publications a total order.
create table marketa_private.variant_publication_release_control (
  singleton boolean primary key default true,
  release_enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint variant_publication_release_control_singleton_check
    check (singleton)
);

insert into marketa_private.variant_publication_release_control (
  singleton,
  release_enabled
) values (true, false);

create table marketa_private.variant_publication_authorizations (
  transaction_id bigint not null,
  backend_pid integer not null,
  actor_id uuid not null,
  product_id uuid not null,
  target_kind text not null,
  target_id uuid not null,
  target_active boolean not null,
  primary key (
    transaction_id,
    backend_pid,
    product_id,
    target_kind,
    target_id
  ),
  constraint variant_publication_authorizations_kind_check
    check (target_kind in ('parent', 'variant')),
  constraint variant_publication_authorizations_parent_check
    check (target_kind <> 'parent' or target_id = product_id)
);

alter table marketa_private.variant_publication_release_control
  enable row level security;
alter table marketa_private.variant_publication_release_control
  force row level security;
alter table marketa_private.variant_publication_authorizations
  enable row level security;
alter table marketa_private.variant_publication_authorizations
  force row level security;

revoke all privileges on schema marketa_private
  from public, anon, authenticated, service_role;
revoke all privileges on table
  marketa_private.variant_publication_release_control,
  marketa_private.variant_publication_authorizations
from public, anon, authenticated, service_role;

create function marketa_private.consume_variant_publication_authorization(
  p_product_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_target_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  consumed_target_id uuid;
begin
  if p_product_id is null
    or p_target_kind not in ('parent', 'variant')
    or p_target_id is null
    or p_target_active is null
  then
    return false;
  end if;

  delete from marketa_private.variant_publication_authorizations as pub_auth
  where pub_auth.transaction_id = pg_catalog.txid_current()
    and pub_auth.backend_pid = pg_catalog.pg_backend_pid()
    and pub_auth.actor_id = auth.uid()
    and pub_auth.product_id = p_product_id
    and pub_auth.target_kind = p_target_kind
    and pub_auth.target_id = p_target_id
    and pub_auth.target_active = p_target_active
  returning pub_auth.target_id into consumed_target_id;

  return consumed_target_id is not null;
end
$function$;

create function marketa_private.assert_variant_publication_structure(
  p_product_id uuid,
  p_require_positive_stock boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  product_record public.products%rowtype;
  variant_count integer;
  axis_count integer;
  maximum_axes integer;
begin
  if p_product_id is null or p_require_positive_stock is null then
    raise exception using
      errcode = '23514',
      message = 'Variant publication validation input is invalid.';
  end if;

  select product.*
  into product_record
  from public.products as product
  where product.id = p_product_id;

  if not found
    or product_record.variant_mode not in (
      'size', 'colour', 'size_colour', 'options'
    )
    or product_record.stock is distinct from 0
  then
    raise exception using
      errcode = '23514',
      message = 'Variant publication parent state is invalid.';
  end if;

  select pg_catalog.count(*)::integer
  into variant_count
  from public.product_variants as variant
  where variant.product_id = p_product_id;

  if variant_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'Variant publication requires at least one combination.';
  end if;

  if exists (
    select 1
    from public.product_variants as variant
    where variant.product_id = p_product_id
      and (
        variant.vendor_id is distinct from product_record.vendor_id
        or variant.stock is null
        or variant.stock < 0
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Variant publication combination ownership is invalid.';
  end if;

  if p_require_positive_stock and not exists (
    select 1
    from public.product_variants as variant
    where variant.product_id = p_product_id
      and variant.vendor_id = product_record.vendor_id
      and variant.stock > 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'Variant publication requires a positive-stock combination.';
  end if;

  if product_record.variant_mode in ('size', 'colour', 'size_colour') then
    if exists (
      select 1
      from public.product_variants as variant
      where variant.product_id = p_product_id
        and (
          case product_record.variant_mode
            when 'size' then not (
              variant.size is not null
              and variant.size_normalized is not null
              and variant.colour is null
              and variant.colour_normalized is null
            )
            when 'colour' then not (
              variant.size is null
              and variant.size_normalized is null
              and variant.colour is not null
              and variant.colour_normalized is not null
            )
            when 'size_colour' then not (
              variant.size is not null
              and variant.size_normalized is not null
              and variant.colour is not null
              and variant.colour_normalized is not null
            )
            else true
          end
        )
    ) or exists (
      select 1
      from public.product_variants as variant
      where variant.product_id = p_product_id
      group by variant.size_normalized, variant.colour_normalized
      having pg_catalog.count(*) <> 1
    ) then
      raise exception using
        errcode = '23514',
        message = 'Legacy variant publication structure is invalid.';
    end if;

    return;
  end if;

  select policy.max_axes
  into maximum_axes
  from public.product_option_policy as policy
  where policy.singleton;

  select pg_catalog.count(*)::integer
  into axis_count
  from public.product_option_axes as axis
  where axis.product_id = p_product_id
    and axis.vendor_id = product_record.vendor_id;

  if maximum_axes is null
    or maximum_axes not between 1 and 3
    or axis_count < 1
    or axis_count > maximum_axes
    or axis_count > 3
    or exists (
      select 1
      from public.product_option_axes as axis
      left join public.option_definitions as definition
        on definition.code = axis.option_code
      left join public.option_units as unit
        on unit.code = axis.unit_code
      left join public.option_size_systems as size_system
        on size_system.code = axis.size_system_code
      where axis.product_id = p_product_id
        and (
          axis.vendor_id is distinct from product_record.vendor_id
          or definition.code is null
          or definition.is_active is distinct from true
          or definition.requires_unit is distinct from
            (axis.unit_code is not null)
          or definition.requires_size_system is distinct from
            (axis.size_system_code is not null)
          or (
            axis.unit_code is not null
            and (
              unit.code is null
              or unit.is_active is distinct from true
              or unit.dimension_code is distinct from definition.dimension_code
            )
          )
          or (
            axis.size_system_code is not null
            and (
              size_system.code is null
              or size_system.is_active is distinct from true
            )
          )
        )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Generalized variant axes are invalid.';
  end if;

  if exists (
    select 1
    from public.product_variants as variant
    where variant.product_id = p_product_id
      and (
        variant.size is not null
        or variant.size_normalized is not null
        or variant.colour is not null
        or variant.colour_normalized is not null
        or (
          select pg_catalog.count(*)
          from public.product_variant_option_values as assignment
          where assignment.variant_id = variant.id
            and assignment.product_id = variant.product_id
            and assignment.vendor_id = variant.vendor_id
        ) <> axis_count
        or exists (
          select 1
          from public.product_option_axes as required_axis
          where required_axis.product_id = variant.product_id
            and required_axis.vendor_id = variant.vendor_id
            and not exists (
              select 1
              from public.product_variant_option_values as assignment
              where assignment.variant_id = variant.id
                and assignment.product_id = variant.product_id
                and assignment.vendor_id = variant.vendor_id
                and assignment.axis_id = required_axis.id
            )
        )
      )
  ) or exists (
    select 1
    from public.product_variant_option_values as assignment
    left join public.product_variants as variant
      on variant.id = assignment.variant_id
     and variant.product_id = assignment.product_id
     and variant.vendor_id = assignment.vendor_id
    left join public.product_option_axes as axis
      on axis.id = assignment.axis_id
     and axis.product_id = assignment.product_id
     and axis.vendor_id = assignment.vendor_id
    left join public.product_option_values as value
      on value.id = assignment.value_id
     and value.axis_id = assignment.axis_id
     and value.product_id = assignment.product_id
     and value.vendor_id = assignment.vendor_id
    where assignment.product_id = p_product_id
      and (
        assignment.vendor_id is distinct from product_record.vendor_id
        or variant.id is null
        or axis.id is null
        or value.id is null
        or value.normalized_label is null
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Generalized variant assignment coverage is invalid.';
  end if;

  if exists (
    select 1
    from public.product_variants as variant
    left join public.product_variant_combination_identities as identity
      on identity.variant_id = variant.id
     and identity.product_id = variant.product_id
    left join lateral (
      select pg_catalog.string_agg(
        assignment.axis_id::text || '=' || assignment.value_id::text,
        '|' order by assignment.axis_id
      ) as combination_signature
      from public.product_variant_option_values as assignment
      where assignment.variant_id = variant.id
        and assignment.product_id = variant.product_id
        and assignment.vendor_id = variant.vendor_id
    ) as computed on true
    where variant.product_id = p_product_id
      and (
        identity.variant_id is null
        or identity.combination_signature is null
        or computed.combination_signature is null
        or identity.combination_signature is distinct from
          computed.combination_signature
      )
  ) or exists (
    select 1
    from public.product_variant_combination_identities as identity
    left join public.product_variants as variant
      on variant.id = identity.variant_id
     and variant.product_id = identity.product_id
    where identity.product_id = p_product_id
      and variant.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Generalized variant combination identity is invalid.';
  end if;
end
$function$;

create function marketa_private.assert_variant_publication_consistency(
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  product_record public.products%rowtype;
begin
  if p_product_id is null then
    return;
  end if;

  select product.*
  into product_record
  from public.products as product
  where product.id = p_product_id;

  if not found then
    return;
  end if;

  -- Ordinary products retain their established direct activation path.
  if product_record.variant_mode = 'none' then
    return;
  end if;

  if product_record.variant_mode not in (
      'size', 'colour', 'size_colour', 'options'
    )
    or product_record.stock is distinct from 0
    or exists (
      select 1
      from public.product_variants as variant
      where variant.product_id = p_product_id
        and variant.is_active is distinct from product_record.is_active
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Variant parent and combination publication state disagree.';
  end if;

  if product_record.is_active then
    perform marketa_private.assert_variant_publication_structure(
      p_product_id,
      false
    );
  end if;
end
$function$;

create function marketa_private.enforce_variant_parent_publication_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.variant_mode <> 'none' and new.is_active then
      raise exception using
        errcode = '42501',
        message = 'Variant product publication is not authorized.';
    end if;
    return new;
  end if;

  if new.variant_mode is distinct from old.variant_mode then
    if not (
      old.variant_mode = 'none'
      and new.variant_mode in ('size', 'colour', 'size_colour', 'options')
      and old.is_active is false
      and new.is_active is false
      and new.stock = 0
    ) then
      raise exception using
        errcode = '42501',
        message = 'Variant product mode transition is not authorized.';
    end if;
  end if;

  if new.is_active is distinct from old.is_active
    and (old.variant_mode <> 'none' or new.variant_mode <> 'none')
    and not marketa_private.consume_variant_publication_authorization(
      new.id,
      'parent',
      new.id,
      new.is_active
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Variant product publication transition is not authorized.';
  end if;

  return new;
end
$function$;

create function marketa_private.enforce_variant_combination_publication_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parent_active boolean;
  affected_product_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_product_id := old.product_id;
  else
    affected_product_id := new.product_id;
  end if;

  select product.is_active
  into parent_active
  from public.products as product
  where product.id = affected_product_id;

  if tg_op = 'DELETE' then
    if parent_active is distinct from false then
      raise exception using
        errcode = '23514',
        message = 'Live variant combinations cannot be deleted.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if parent_active is distinct from false then
      raise exception using
        errcode = '23514',
        message = 'Live variant combinations cannot be inserted.';
    end if;
    if new.is_active and not
      marketa_private.consume_variant_publication_authorization(
        new.product_id,
        'variant',
        new.id,
        true
      )
    then
      raise exception using
        errcode = '42501',
        message = 'Variant combination publication is not authorized.';
    end if;
    return new;
  end if;

  if new.is_active is distinct from old.is_active
    and not marketa_private.consume_variant_publication_authorization(
      new.product_id,
      'variant',
      new.id,
      new.is_active
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Variant combination publication transition is not authorized.';
  end if;

  if parent_active is distinct from false and (
    new.product_id is distinct from old.product_id
    or new.vendor_id is distinct from old.vendor_id
    or new.size is distinct from old.size
    or new.colour is distinct from old.colour
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'Live variant combination structure cannot be changed.';
  end if;

  return new;
end
$function$;

create function marketa_private.enforce_live_option_structure_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_product_id uuid;
begin
  for affected_product_id in
    select distinct candidate.product_id
    from pg_catalog.unnest(
      array[
        case when tg_op <> 'INSERT' then old.product_id else null end,
        case when tg_op <> 'DELETE' then new.product_id else null end
      ]::uuid[]
    ) as candidate(product_id)
    where candidate.product_id is not null
    order by candidate.product_id
  loop
    if exists (
      select 1
      from public.products as product
      where product.id = affected_product_id
        and product.variant_mode = 'options'
        and product.is_active
    ) then
      raise exception using
        errcode = '23514',
        message = 'Live generalized variant structure cannot be changed.';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create function marketa_private.enforce_variant_publication_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_table_name = 'products' then
    perform marketa_private.assert_variant_publication_consistency(new.id);
  elsif tg_op = 'INSERT' then
    perform marketa_private.assert_variant_publication_consistency(new.product_id);
  elsif tg_op = 'DELETE' then
    perform marketa_private.assert_variant_publication_consistency(old.product_id);
  else
    perform marketa_private.assert_variant_publication_consistency(old.product_id);
    if new.product_id is distinct from old.product_id then
      perform marketa_private.assert_variant_publication_consistency(new.product_id);
    end if;
  end if;

  return null;
end
$function$;

alter function marketa_private.consume_variant_publication_authorization(
  uuid, text, uuid, boolean
) owner to postgres;
alter function marketa_private.assert_variant_publication_structure(
  uuid, boolean
) owner to postgres;
alter function marketa_private.assert_variant_publication_consistency(uuid)
  owner to postgres;
alter function marketa_private.enforce_variant_parent_publication_authority()
  owner to postgres;
alter function marketa_private.enforce_variant_combination_publication_authority()
  owner to postgres;
alter function marketa_private.enforce_live_option_structure_immutability()
  owner to postgres;
alter function marketa_private.enforce_variant_publication_consistency()
  owner to postgres;

revoke all privileges on function
  marketa_private.consume_variant_publication_authorization(
    uuid, text, uuid, boolean
  ),
  marketa_private.assert_variant_publication_structure(uuid, boolean),
  marketa_private.assert_variant_publication_consistency(uuid),
  marketa_private.enforce_variant_parent_publication_authority(),
  marketa_private.enforce_variant_combination_publication_authority(),
  marketa_private.enforce_live_option_structure_immutability(),
  marketa_private.enforce_variant_publication_consistency()
from public, anon, authenticated, service_role;

create trigger products_variant_publication_authority_guard
before insert or update on public.products
for each row
execute function
  marketa_private.enforce_variant_parent_publication_authority();

create trigger product_variants_publication_authority_guard
before insert or update or delete on public.product_variants
for each row
execute function
  marketa_private.enforce_variant_combination_publication_authority();

create trigger b_variant_publication_live_structure_guard
before insert or update or delete on public.product_option_axes
for each row
execute function marketa_private.enforce_live_option_structure_immutability();

create trigger b_variant_publication_live_structure_guard
before insert or update or delete on public.product_option_values
for each row
execute function marketa_private.enforce_live_option_structure_immutability();

create trigger b_variant_publication_live_structure_guard
before insert or update or delete on public.product_variant_option_values
for each row
execute function marketa_private.enforce_live_option_structure_immutability();

create trigger b_variant_publication_live_structure_guard
before insert or update or delete
on public.product_variant_combination_identities
for each row
execute function marketa_private.enforce_live_option_structure_immutability();

create constraint trigger products_variant_publication_consistency_guard
after insert or update on public.products
deferrable initially deferred
for each row
execute function marketa_private.enforce_variant_publication_consistency();

create constraint trigger product_variants_publication_consistency_guard
after insert or update or delete on public.product_variants
deferrable initially deferred
for each row
execute function marketa_private.enforce_variant_publication_consistency();

create function public.set_vendor_product_variant_publication(
  p_product_id uuid,
  p_active boolean
)
returns table (
  outcome text,
  publication_product_id uuid,
  publication_active boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  authorized_vendor_id uuid;
  product_record public.products%rowtype;
  release_enabled boolean;
  variant_record record;
  remaining_authorizations integer;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::boolean;
    return;
  end if;

  if p_product_id is null or p_active is null then
    return query select 'invalid_input'::text, null::uuid, null::boolean;
    return;
  end if;

  -- Lock order shared by vendor mutation RPCs:
  -- vendor SHARE -> product advisory EXCLUSIVE -> parent UPDATE -> variants
  -- UPDATE by UUID. Activation then takes the release row FOR SHARE.
  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = v_actor_id
    and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::uuid, null::boolean;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text, 0)
  );

  select product.*
  into product_record
  from public.products as product
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::boolean;
    return;
  end if;

  if product_record.variant_mode not in (
      'size', 'colour', 'size_colour', 'options'
    )
    or product_record.stock is distinct from 0
  then
    return query select
      'invalid_state'::text,
      p_product_id,
      product_record.is_active;
    return;
  end if;

  for variant_record in
    select variant.id
    from public.product_variants as variant
    where variant.product_id = p_product_id
      and variant.vendor_id = authorized_vendor_id
    order by variant.id
    for update
  loop
    null;
  end loop;

  if product_record.is_active is not distinct from p_active then
    begin
      if p_active then
        perform marketa_private.assert_variant_publication_structure(
          p_product_id,
          false
        );
      elsif exists (
        select 1
        from public.product_variants as variant
        where variant.product_id = p_product_id
          and variant.is_active is distinct from false
      ) then
        raise exception using
          errcode = '23514',
          message = 'Draft variant combinations must remain inactive.';
      end if;
    exception
      when check_violation or not_null_violation or foreign_key_violation then
        return query select
          'invalid_state'::text,
          p_product_id,
          product_record.is_active;
        return;
    end;

    return query select 'no_change'::text, p_product_id, p_active;
    return;
  end if;

  if p_active then
    select control.release_enabled
    into release_enabled
    from marketa_private.variant_publication_release_control as control
    where control.singleton
    for share;

    if not found or release_enabled is distinct from true then
      return query select
        'release_disabled'::text,
        p_product_id,
        product_record.is_active;
      return;
    end if;

    begin
      perform marketa_private.assert_variant_publication_structure(
        p_product_id,
        true
      );
    exception
      when check_violation or not_null_violation or foreign_key_violation
        or unique_violation then
        return query select
          'invalid_state'::text,
          p_product_id,
          product_record.is_active;
        return;
    end;
  end if;

  insert into marketa_private.variant_publication_authorizations (
    transaction_id,
    backend_pid,
    actor_id,
    product_id,
    target_kind,
    target_id,
    target_active
  ) values (
    pg_catalog.txid_current(),
    pg_catalog.pg_backend_pid(),
    v_actor_id,
    p_product_id,
    'parent',
    p_product_id,
    p_active
  );

  insert into marketa_private.variant_publication_authorizations (
    transaction_id,
    backend_pid,
    actor_id,
    product_id,
    target_kind,
    target_id,
    target_active
  )
  select
    pg_catalog.txid_current(),
    pg_catalog.pg_backend_pid(),
    v_actor_id,
    variant.product_id,
    'variant',
    variant.id,
    p_active
  from public.product_variants as variant
  where variant.product_id = p_product_id
    and variant.vendor_id = authorized_vendor_id
  order by variant.id;

  update public.product_variants as variant
  set is_active = p_active
  where variant.product_id = p_product_id
    and variant.vendor_id = authorized_vendor_id
    and variant.is_active is distinct from p_active;

  update public.products as product
  set is_active = p_active
  where product.id = p_product_id
    and product.vendor_id = authorized_vendor_id
    and product.is_active is distinct from p_active;

  select pg_catalog.count(*)::integer
  into remaining_authorizations
  from marketa_private.variant_publication_authorizations as pub_auth
  where pub_auth.transaction_id = pg_catalog.txid_current()
    and pub_auth.backend_pid = pg_catalog.pg_backend_pid()
    and pub_auth.actor_id = v_actor_id
    and pub_auth.product_id = p_product_id;

  if remaining_authorizations <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Variant publication authorization was not fully consumed.';
  end if;

  return query select
    case when p_active then 'published' else 'deactivated' end::text,
    p_product_id,
    p_active;
exception
  when check_violation or not_null_violation or foreign_key_violation
    or unique_violation then
    return query select 'invalid_state'::text, p_product_id, null::boolean;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::boolean;
end
$function$;

alter function public.set_vendor_product_variant_publication(uuid, boolean)
  owner to postgres;
revoke all privileges on function
  public.set_vendor_product_variant_publication(uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function
  public.set_vendor_product_variant_publication(uuid, boolean)
to authenticated;

comment on function public.set_vendor_product_variant_publication(
  uuid, boolean
) is
  'Authenticated active-vendor authority for atomic variant publication and deactivation. Publication is release-gated; deactivation is not.';

create or replace function public.update_vendor_product_variant_stock(
  p_variant_id uuid,
  p_stock integer,
  p_expected_stock_version bigint
)
returns table (
  outcome text,
  variant_id uuid,
  result_stock_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  authorized_vendor_id uuid;
  parent_product_id uuid;
  parent_mode text;
  parent_active boolean;
  parent_stock integer;
  variant_record public.product_variants%rowtype;
  updated_stock_version bigint;
begin
  actor_id := auth.uid();
  if actor_id is null then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  if p_variant_id is null
    or p_stock is null
    or p_stock < 0
    or p_expected_stock_version is null
    or p_expected_stock_version < 0
  then
    return query select 'invalid_input'::text, null::uuid, null::bigint;
    return;
  end if;

  select vendor.id
  into authorized_vendor_id
  from public.vendors as vendor
  where vendor.user_id = actor_id
    and vendor.is_active = true
  for share;

  if not found then
    return query select 'access_denied'::text, null::uuid, null::bigint;
    return;
  end if;

  select variant.product_id
  into parent_product_id
  from public.product_variants as variant
  where variant.id = p_variant_id
    and variant.vendor_id = authorized_vendor_id;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(parent_product_id::text, 0)
  );

  select product.variant_mode, product.is_active, product.stock
  into parent_mode, parent_active, parent_stock
  from public.products as product
  where product.id = parent_product_id
    and product.vendor_id = authorized_vendor_id
  for update;

  select variant.*
  into variant_record
  from public.product_variants as variant
  where variant.id = p_variant_id
    and variant.product_id = parent_product_id
    and variant.vendor_id = authorized_vendor_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  if parent_mode not in ('size', 'colour', 'size_colour', 'options')
    or parent_stock is distinct from 0
    or variant_record.is_active is distinct from parent_active
  then
    return query select
      'invalid_state'::text,
      p_variant_id,
      variant_record.stock_version;
    return;
  end if;

  if variant_record.stock_version <> p_expected_stock_version then
    return query select
      'conflict'::text,
      p_variant_id,
      variant_record.stock_version;
    return;
  end if;

  if variant_record.stock = p_stock then
    return query select
      'no_change'::text,
      p_variant_id,
      variant_record.stock_version;
    return;
  end if;

  update public.product_variants as variant
  set stock = p_stock
  where variant.id = p_variant_id
    and variant.stock_version = p_expected_stock_version
  returning variant.stock_version into updated_stock_version;

  if not found then
    return query select
      'conflict'::text,
      p_variant_id,
      variant_record.stock_version;
    return;
  end if;

  return query select 'updated'::text, p_variant_id, updated_stock_version;
exception
  when check_violation or not_null_violation then
    return query select 'invalid_input'::text, p_variant_id, null::bigint;
  when others then
    return query select 'operation_failed'::text, null::uuid, null::bigint;
end
$function$;

alter function public.update_vendor_product_variant_stock(uuid, integer, bigint)
  owner to postgres;
revoke all privileges on function
  public.update_vendor_product_variant_stock(uuid, integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function
  public.update_vendor_product_variant_stock(uuid, integer, bigint)
to authenticated;

-- The immediate transition guards and deferred final-state checks are in place
-- before the draft-only checks are removed, so the replacement is atomic.
alter table public.products
  drop constraint products_variant_draft_publication_check;
alter table public.product_variants
  drop constraint product_variants_draft_only_check;

do $postcondition$
declare
  function_record record;
  function_hash text;
  relation_name text;
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid in (
      'public.products'::pg_catalog.regclass,
      'public.product_variants'::pg_catalog.regclass
    )
      and constraint_record.conname in (
        'products_variant_draft_publication_check',
        'product_variants_draft_only_check'
      )
  ) then
    raise exception 'D5-1 postcondition: draft-only constraints remain.';
  end if;

  if (
    select pg_catalog.count(*)
    from marketa_private.variant_publication_release_control as control
    where control.singleton
      and control.release_enabled is false
  ) <> 1 or (
    select pg_catalog.count(*)
    from marketa_private.variant_publication_release_control
  ) <> 1 then
    raise exception 'D5-1 postcondition: release control is not default-off.';
  end if;

  foreach relation_name in array array[
    'variant_publication_release_control',
    'variant_publication_authorizations'
  ]::text[] loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'marketa_private'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
    ) or pg_catalog.has_table_privilege(
      'public', 'marketa_private.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'marketa_private.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'marketa_private.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'marketa_private.' || relation_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'D5-1 postcondition: private relation % leaked.',
        relation_name;
    end if;
  end loop;

  if pg_catalog.has_schema_privilege(
      'public', 'marketa_private', 'USAGE'
    ) or pg_catalog.has_schema_privilege(
      'anon', 'marketa_private', 'USAGE'
    ) or pg_catalog.has_schema_privilege(
      'authenticated', 'marketa_private', 'USAGE'
    ) or pg_catalog.has_schema_privilege(
      'service_role', 'marketa_private', 'USAGE'
    )
  then
    raise exception 'D5-1 postcondition: private schema authority leaked.';
  end if;

  if (
    select pg_catalog.count(*)
    from (
      values
        ('public.set_vendor_product_variant_publication(uuid,boolean)'::text),
        ('marketa_private.consume_variant_publication_authorization(uuid,text,uuid,boolean)'::text),
        ('marketa_private.assert_variant_publication_structure(uuid,boolean)'::text),
        ('marketa_private.assert_variant_publication_consistency(uuid)'::text),
        ('marketa_private.enforce_variant_parent_publication_authority()'::text),
        ('marketa_private.enforce_variant_combination_publication_authority()'::text),
        ('marketa_private.enforce_live_option_structure_immutability()'::text),
        ('marketa_private.enforce_variant_publication_consistency()'::text)
    ) as expected(signature)
    where pg_catalog.to_regprocedure(expected.signature) is not null
  ) <> 8 then
    raise exception 'D5-1 postcondition: publication function inventory is incomplete.';
  end if;

  for function_record in
    select expected.signature, expected.is_public,
           procedure.oid, procedure.prosecdef, procedure.proconfig,
           pg_catalog.pg_get_userbyid(procedure.proowner) as owner
    from (
      values
        ('public.set_vendor_product_variant_publication(uuid,boolean)'::text, true),
        ('marketa_private.consume_variant_publication_authorization(uuid,text,uuid,boolean)'::text, false),
        ('marketa_private.assert_variant_publication_structure(uuid,boolean)'::text, false),
        ('marketa_private.assert_variant_publication_consistency(uuid)'::text, false),
        ('marketa_private.enforce_variant_parent_publication_authority()'::text, false),
        ('marketa_private.enforce_variant_combination_publication_authority()'::text, false),
        ('marketa_private.enforce_live_option_structure_immutability()'::text, false),
        ('marketa_private.enforce_variant_publication_consistency()'::text, false)
    ) as expected(signature, is_public)
    join pg_catalog.pg_proc as procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  loop
    if function_record.owner <> 'postgres'
      or not function_record.prosecdef
      or function_record.proconfig is distinct from
        array['search_path=""']::text[]
      or pg_catalog.has_function_privilege(
        'public', function_record.oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'anon', function_record.oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'service_role', function_record.oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated', function_record.oid, 'EXECUTE'
      ) is distinct from function_record.is_public
    then
      raise exception 'D5-1 postcondition: function authority is incorrect for %.',
        function_record.signature;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and (
        (trigger_record.tgrelid = 'public.products'::pg_catalog.regclass
          and trigger_record.tgname in (
            'products_variant_publication_authority_guard',
            'products_variant_publication_consistency_guard'
          ))
        or (trigger_record.tgrelid =
              'public.product_variants'::pg_catalog.regclass
          and trigger_record.tgname in (
            'product_variants_publication_authority_guard',
            'product_variants_publication_consistency_guard'
          ))
      )
  ) <> 4 or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.products'::pg_catalog.regclass
      and trigger_record.tgname =
        'products_variant_publication_consistency_guard'
      and trigger_record.tgdeferrable
      and trigger_record.tginitdeferred
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid =
        'public.product_variants'::pg_catalog.regclass
      and trigger_record.tgname =
        'product_variants_publication_consistency_guard'
      and trigger_record.tgdeferrable
      and trigger_record.tginitdeferred
  ) then
    raise exception 'D5-1 postcondition: publication triggers are incomplete.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgname =
        'b_variant_publication_live_structure_guard'
      and trigger_record.tgrelid in (
        'public.product_option_axes'::pg_catalog.regclass,
        'public.product_option_values'::pg_catalog.regclass,
        'public.product_variant_option_values'::pg_catalog.regclass,
        'public.product_variant_combination_identities'::pg_catalog.regclass
      )
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid =
        'marketa_private.enforce_live_option_structure_immutability()'::pg_catalog.regprocedure
  ) <> 4 then
    raise exception 'D5-1 postcondition: live structure guards are incomplete.';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.variant_mode <> 'none'
      and product.is_active is distinct from false
  ) or exists (
    select 1
    from public.product_variants as variant
    where variant.is_active is distinct from false
  ) then
    raise exception 'D5-1 postcondition: installation activated variant inventory.';
  end if;

  if pg_catalog.has_table_privilege(
      'public', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'anon', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variants',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variants',
      'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or not pg_catalog.has_column_privilege(
      'service_role', 'public.product_variants', 'stock', 'UPDATE'
    ) or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid =
          'public.product_variants'::pg_catalog.regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname <> 'stock'
        and pg_catalog.has_column_privilege(
          'service_role',
          'public.product_variants',
          attribute.attname,
          'UPDATE'
        )
    )
  then
    raise exception 'D5-1 postcondition: variant write authority widened.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.update_vendor_product_variant_stock(uuid,integer,bigint)'::pg_catalog.regprocedure
      and procedure.prosecdef
      and procedure.proconfig is not distinct from
        array['search_path=""']::text[]
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and not pg_catalog.has_function_privilege(
        'public', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
  ) then
    raise exception 'D5-1 postcondition: stock CAS authority changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure;

  if function_hash is distinct from 'c34ac95900ffa3c7bd2072256a56f203' then
    raise exception 'D5-1 postcondition: C2 snapshot validator changed.';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid))
  into function_hash
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'::pg_catalog.regprocedure;

  if function_hash is distinct from '74a760039e13ce5ff09e3b9ef76d7c21' then
    raise exception 'D5-1 postcondition: C3 finalizer changed.';
  end if;

  if not pg_catalog.has_function_privilege(
      'service_role',
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)',
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated',
      'public.construct_trusted_checkout_order(uuid,uuid,text,text,text,jsonb,text,timestamp with time zone,jsonb)',
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'anon',
      'public.get_public_product_variant_projection(uuid)',
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_public_product_variant_projection(uuid)',
      'EXECUTE'
    )
  then
    raise exception 'D5-1 postcondition: protected D2 or D3 grants changed.';
  end if;

  if exists (
    select 1
    from marketa_private.variant_publication_authorizations
  ) then
    raise exception 'D5-1 postcondition: publication authorization rows remain.';
  end if;
end
$postcondition$;

commit;
