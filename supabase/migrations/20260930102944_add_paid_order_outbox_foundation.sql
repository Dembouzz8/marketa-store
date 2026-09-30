-- Ops 3B1: dormant paid-order durable outbox database foundation.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  required_table text;
  required_role text;
  finalization_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  decrement_stock_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
begin
  foreach required_table in array array[
    'public.orders',
    'public.order_items',
    'public.payments',
    'public.payment_events',
    'public.payout_ledger',
    'public.events_ledger',
    'public.products'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = pg_catalog.to_regclass(required_table)
        and class.relkind in ('r', 'p')
    ) then
      raise exception 'Ops 3B1: required table % is missing or has the wrong relation type.', required_table;
    end if;
  end loop;

  foreach required_role in array array['postgres', 'anon', 'authenticated', 'service_role']
  loop
    if pg_catalog.to_regrole(required_role) is null then
      raise exception 'Ops 3B1: required role % is missing.', required_role;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'service_role'
      and role.rolbypassrls
  ) then
    raise exception 'Ops 3B1: service_role cannot exercise SECURITY INVOKER lifecycle authority.';
  end if;

  if pg_catalog.to_regclass('public.outbox_events') is not null
    or pg_catalog.to_regclass('public.notification_deliveries') is not null
  then
    raise exception 'Ops 3B1: paid-order outbox namespace is unexpectedly occupied.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'claim_paid_order_outbox',
        'mark_paid_order_outbox_delivered',
        'mark_paid_order_outbox_failed'
      )
  ) then
    raise exception 'Ops 3B1: paid-order outbox function namespace is unexpectedly occupied.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_extension as extension
    where extension.extname in ('pg_cron', 'pg_net')
  ) then
    raise exception 'Ops 3B1: scheduler extensions are unexpectedly installed.';
  end if;

  if finalization_oid is null then
    raise exception 'Ops 3B1: atomic paid-order finalization authority is missing.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = finalization_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proconfig is not distinct from array['search_path=""']::text[]
    )
    or not pg_catalog.has_function_privilege(
      'service_role', finalization_oid, 'EXECUTE'
    )
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          (select procedure.proacl from pg_catalog.pg_proc as procedure where procedure.oid = finalization_oid),
          pg_catalog.acldefault(
            'f',
            (select procedure.proowner from pg_catalog.pg_proc as procedure where procedure.oid = finalization_oid)
          )
        )
      ) as acl
      where acl.privilege_type = 'EXECUTE'
        and acl.grantee not in (
          'postgres'::pg_catalog.regrole,
          'service_role'::pg_catalog.regrole
        )
    )
  then
    raise exception 'Ops 3B1: atomic paid-order finalization authority changed.';
  end if;

  if decrement_stock_oid is not null and (
      not exists (
        select 1
        from pg_catalog.pg_proc as procedure
        where procedure.oid = decrement_stock_oid
          and procedure.proowner = 'postgres'::pg_catalog.regrole
          and not procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.proconfig is not distinct from array['search_path=""']::text[]
      )
      or pg_catalog.has_function_privilege(
        'anon', decrement_stock_oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated', decrement_stock_oid, 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', decrement_stock_oid, 'EXECUTE'
      )
    )
  then
    raise exception 'Ops 3B1: Ops 1A decrement_stock containment changed.';
  end if;
end
$preflight$;

lock table public.orders in share mode;
lock table public.order_items in share mode;
lock table public.payments in share mode;
lock table public.payment_events in share mode;
lock table public.payout_ledger in share mode;
lock table public.events_ledger in share mode;
lock table public.products in share mode;

do $snapshot$
declare
  finalization_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  decrement_stock_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
begin
  perform pg_catalog.set_config('marketa_ops3b1.orders_count', (
    select pg_catalog.count(*)::text from public.orders
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.orders_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(customer_order)::text), '' order by customer_order.id
    ), '')) from public.orders as customer_order
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.order_items_count', (
    select pg_catalog.count(*)::text from public.order_items
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.order_items_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(item)::text), '' order by item.id
    ), '')) from public.order_items as item
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.payments_count', (
    select pg_catalog.count(*)::text from public.payments
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.payments_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(payment)::text), '' order by payment.id
    ), '')) from public.payments as payment
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.payment_events_count', (
    select pg_catalog.count(*)::text from public.payment_events
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.payment_events_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(payment_event)::text), '' order by payment_event.id
    ), '')) from public.payment_events as payment_event
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.payout_ledger_count', (
    select pg_catalog.count(*)::text from public.payout_ledger
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.payout_ledger_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(ledger)::text), '' order by ledger.id
    ), '')) from public.payout_ledger as ledger
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.events_ledger_count', (
    select pg_catalog.count(*)::text from public.events_ledger
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.events_ledger_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(event)::text), '' order by event.id
    ), '')) from public.events_ledger as event
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.products_count', (
    select pg_catalog.count(*)::text from public.products
  ), true);
  perform pg_catalog.set_config('marketa_ops3b1.products_rows', (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(product)::text), '' order by product.id
    ), '')) from public.products as product
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.finalization_authority', (
    select pg_catalog.jsonb_build_object(
      'definition', pg_catalog.pg_get_functiondef(procedure.oid),
      'owner', procedure.proowner,
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile,
      'config', procedure.proconfig,
      'acl', procedure.proacl
    )::text
    from pg_catalog.pg_proc as procedure
    where procedure.oid = finalization_oid
  ), true);

  perform pg_catalog.set_config('marketa_ops3b1.decrement_stock_authority',
    case
      when decrement_stock_oid is null then 'absent'
      else (
        select pg_catalog.jsonb_build_object(
          'definition', pg_catalog.pg_get_functiondef(procedure.oid),
          'owner', procedure.proowner,
          'security_definer', procedure.prosecdef,
          'volatility', procedure.provolatile,
          'config', procedure.proconfig,
          'acl', procedure.proacl
        )::text
        from pg_catalog.pg_proc as procedure
        where procedure.oid = decrement_stock_oid
      )
    end,
    true
  );
end
$snapshot$;

-- OPS_3B1_TABLE_START
create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_version smallint not null default 1,
  order_id uuid not null,
  idempotency_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default pg_catalog.now(),
  locked_at timestamptz,
  locked_by text,
  lease_token uuid,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint outbox_events_order_id_fkey
    foreign key (order_id) references public.orders (id) on delete restrict,
  constraint outbox_events_idempotency_key_key unique (idempotency_key),
  constraint outbox_events_event_type_order_id_key unique (event_type, order_id),
  constraint outbox_events_event_type_check check (event_type = 'paid_order'),
  constraint outbox_events_event_version_check check (event_version = 1),
  constraint outbox_events_idempotency_key_check check (
    idempotency_key = 'paid-order:' || order_id::text
  ),
  constraint outbox_events_status_check check (
    status in ('pending', 'processing', 'delivered', 'dead_letter')
  ),
  constraint outbox_events_attempt_count_check check (
    attempt_count between 0 and 12
  ),
  constraint outbox_events_worker_id_check check (
    locked_by is null or locked_by ~ '^[A-Za-z0-9._:-]{1,80}$'
  ),
  constraint outbox_events_error_code_check check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,80}$'
  ),
  constraint outbox_events_state_tuple_check check (
    (
      status = 'pending'
      and attempt_count between 0 and 11
      and locked_at is null
      and locked_by is null
      and lease_token is null
      and delivered_at is null
    ) or (
      status = 'processing'
      and attempt_count between 1 and 12
      and locked_at is not null
      and locked_by is not null
      and lease_token is not null
      and delivered_at is null
    ) or (
      status = 'delivered'
      and attempt_count between 1 and 12
      and locked_at is null
      and locked_by is null
      and lease_token is null
      and delivered_at is not null
      and last_error_code is null
    ) or (
      status = 'dead_letter'
      and locked_at is null
      and locked_by is null
      and lease_token is null
      and delivered_at is null
      and attempt_count = 12
      and last_error_code is not null
    )
  )
);

create index outbox_events_ready_queue_idx
  on public.outbox_events (available_at, created_at, id)
  where status = 'pending';

create index outbox_events_processing_lease_idx
  on public.outbox_events (locked_at, id)
  where status = 'processing';

alter table public.outbox_events owner to postgres;
alter table public.outbox_events enable row level security;

revoke all privileges on table public.outbox_events
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.outbox_events to service_role;
-- OPS_3B1_TABLE_END

-- OPS_3B1_CLAIM_START
create function public.claim_paid_order_outbox(
  p_worker_id text,
  p_batch_size integer default 10
)
returns table (
  event_id uuid,
  order_id uuid,
  idempotency_key text,
  event_version smallint,
  attempt_count integer,
  lease_token uuid
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
begin
  if p_worker_id is null
    or p_worker_id !~ '^[A-Za-z0-9._:-]{1,80}$'
  then
    raise exception 'Invalid paid-order outbox worker identifier.'
      using errcode = '22023';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 10 then
    raise exception 'Invalid paid-order outbox batch size.'
      using errcode = '22023';
  end if;

  update public.outbox_events as expired
  set status = 'dead_letter',
      locked_at = null,
      locked_by = null,
      lease_token = null,
      delivered_at = null,
      last_error_code = coalesce(
        expired.last_error_code,
        'LEASE_EXPIRED_MAX_ATTEMPTS'
      ),
      updated_at = v_now
  where expired.status = 'processing'
    and expired.locked_at <= v_now - interval '2 minutes'
    and expired.attempt_count >= 12;

  return query
  with claim_candidates as materialized (
    select queued.id
    from public.outbox_events as queued
    where (
        queued.status = 'pending'
        and queued.available_at <= v_now
        and queued.attempt_count < 12
      ) or (
        queued.status = 'processing'
        and queued.locked_at <= v_now - interval '2 minutes'
        and queued.attempt_count < 12
    )
    order by queued.available_at, queued.created_at, queued.id
    limit p_batch_size
    for update of queued skip locked
  ), claimed as (
    update public.outbox_events as queued
    set status = 'processing',
        attempt_count = queued.attempt_count + 1,
        locked_at = v_now,
        locked_by = p_worker_id,
        lease_token = gen_random_uuid(),
        delivered_at = null,
        updated_at = v_now
    from claim_candidates
    where queued.id = claim_candidates.id
      and queued.attempt_count < 12
    returning
      queued.id,
      queued.order_id,
      queued.idempotency_key,
      queued.event_version,
      queued.attempt_count,
      queued.lease_token,
      queued.available_at,
      queued.created_at
  )
  select
    claimed.id,
    claimed.order_id,
    claimed.idempotency_key,
    claimed.event_version,
    claimed.attempt_count,
    claimed.lease_token
  from claimed
  order by claimed.available_at, claimed.created_at, claimed.id;
end
$function$;
-- OPS_3B1_CLAIM_END

-- OPS_3B1_DELIVERED_START
create function public.mark_paid_order_outbox_delivered(
  p_event_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_updated_rows integer;
begin
  update public.outbox_events as queued
  set status = 'delivered',
      delivered_at = v_now,
      locked_at = null,
      locked_by = null,
      lease_token = null,
      last_error_code = null,
      updated_at = v_now
  where queued.id = p_event_id
    and queued.status = 'processing'
    and queued.lease_token = p_lease_token;

  get diagnostics v_updated_rows = row_count;
  return v_updated_rows = 1;
end
$function$;
-- OPS_3B1_DELIVERED_END

-- OPS_3B1_FAILURE_START
create function public.mark_paid_order_outbox_failed(
  p_event_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns table (
  outbox_status text,
  next_available_at timestamptz,
  outbox_attempt_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
begin
  if p_error_code is null
    or p_error_code !~ '^[A-Z0-9_]{1,80}$'
  then
    raise exception 'Invalid paid-order outbox error code.'
      using errcode = '22023';
  end if;

  return query
  update public.outbox_events as queued
  set status = case
        when queued.attempt_count >= 12 then 'dead_letter'
        else 'pending'
      end,
      available_at = case
        when queued.attempt_count >= 12 then queued.available_at
        else v_now + case queued.attempt_count
          when 1 then interval '1 minute'
          when 2 then interval '2 minutes'
          when 3 then interval '4 minutes'
          when 4 then interval '8 minutes'
          when 5 then interval '16 minutes'
          when 6 then interval '32 minutes'
          else interval '60 minutes'
        end
      end,
      locked_at = null,
      locked_by = null,
      lease_token = null,
      delivered_at = null,
      last_error_code = p_error_code,
      updated_at = v_now
  where queued.id = p_event_id
    and queued.status = 'processing'
    and queued.lease_token = p_lease_token
  returning queued.status, queued.available_at, queued.attempt_count;
end
$function$;
-- OPS_3B1_FAILURE_END

alter function public.claim_paid_order_outbox(text, integer) owner to postgres;
alter function public.mark_paid_order_outbox_delivered(uuid, uuid) owner to postgres;
alter function public.mark_paid_order_outbox_failed(uuid, uuid, text) owner to postgres;

revoke all privileges on function public.claim_paid_order_outbox(text, integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_paid_order_outbox_delivered(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_paid_order_outbox_failed(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_paid_order_outbox(text, integer)
  to service_role;
grant execute on function public.mark_paid_order_outbox_delivered(uuid, uuid)
  to service_role;
grant execute on function public.mark_paid_order_outbox_failed(uuid, uuid, text)
  to service_role;

do $postcondition$
declare
  actual_columns text[];
  actual_constraints text[];
  actual_indexes text[];
  actual_default text;
  expected_default text;
  function_oid oid;
  function_name text;
  function_signature text;
  function_result text;
  function_contract text[];
  finalization_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  decrement_stock_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
  current_authority text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = pg_catalog.to_regclass('public.outbox_events')
      and class.relkind = 'r'
      and class.relowner = 'postgres'::pg_catalog.regrole
      and class.relrowsecurity
  ) then
    raise exception 'Ops 3B1 postcondition: outbox table metadata is incorrect.';
  end if;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attnum)
  into actual_columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.outbox_events'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if actual_columns is distinct from array[
    'id', 'event_type', 'event_version', 'order_id', 'idempotency_key',
    'status', 'attempt_count', 'available_at', 'locked_at', 'locked_by',
    'lease_token', 'delivered_at', 'last_error_code', 'created_at', 'updated_at'
  ]::text[] then
    raise exception 'Ops 3B1 postcondition: outbox columns are incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.outbox_events'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        (attribute.attname in (
          'id', 'order_id', 'lease_token'
        ) and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <> 'uuid')
        or (attribute.attname in (
          'event_type', 'idempotency_key', 'status', 'locked_by', 'last_error_code'
        ) and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <> 'text')
        or (attribute.attname = 'event_version'
          and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <> 'smallint')
        or (attribute.attname = 'attempt_count'
          and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <> 'integer')
        or (attribute.attname in (
          'available_at', 'locked_at', 'delivered_at', 'created_at', 'updated_at'
        ) and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <> 'timestamp with time zone')
      )
  ) then
    raise exception 'Ops 3B1 postcondition: outbox column types are incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.outbox_events'::pg_catalog.regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attnotnull is distinct from (
        attribute.attname not in (
          'locked_at', 'locked_by', 'lease_token', 'delivered_at', 'last_error_code'
        )
      )
  ) then
    raise exception 'Ops 3B1 postcondition: outbox nullability is incorrect.';
  end if;

  foreach function_name in array array[
    'id', 'event_version', 'status', 'attempt_count',
    'available_at', 'created_at', 'updated_at'
  ]
  loop
    select pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
    into actual_default
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.outbox_events'::pg_catalog.regclass
      and attribute.attname = function_name;

    expected_default := case function_name
      when 'id' then 'gen_random_uuid()'
      when 'event_version' then '1'
      when 'status' then '''pending''::text'
      when 'attempt_count' then '0'
      else 'now()'
    end;

    if actual_default is distinct from expected_default then
      raise exception 'Ops 3B1 postcondition: default for % is incorrect.', function_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    left join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.outbox_events'::pg_catalog.regclass
      and attribute.attname not in (
        'id', 'event_version', 'status', 'attempt_count',
        'available_at', 'created_at', 'updated_at'
      )
      and default_value.oid is not null
  ) then
    raise exception 'Ops 3B1 postcondition: an unexpected outbox default exists.';
  end if;

  select pg_catalog.array_agg(constraint_record.conname::text order by constraint_record.conname)
  into actual_constraints
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass;

  if actual_constraints is distinct from array[
    'outbox_events_attempt_count_check',
    'outbox_events_error_code_check',
    'outbox_events_event_type_check',
    'outbox_events_event_type_order_id_key',
    'outbox_events_event_version_check',
    'outbox_events_idempotency_key_check',
    'outbox_events_idempotency_key_key',
    'outbox_events_order_id_fkey',
    'outbox_events_pkey',
    'outbox_events_state_tuple_check',
    'outbox_events_status_check',
    'outbox_events_worker_id_check'
  ]::text[] then
    raise exception 'Ops 3B1 postcondition: outbox constraints are incorrect.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_order_id_fkey'
        and constraint_record.contype = 'f'
        and constraint_record.confrelid = 'public.orders'::pg_catalog.regclass
        and constraint_record.confdeltype = 'r'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_idempotency_key_key'
        and constraint_record.contype = 'u'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_event_type_order_id_key'
        and constraint_record.contype = 'u'
    )
  then
    raise exception 'Ops 3B1 postcondition: outbox identity constraints are incorrect.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
      and constraint_record.conname = 'outbox_events_state_tuple_check'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
        '%status = ''pending''%attempt_count >= 0%attempt_count <= 11%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
        '%status = ''processing''%attempt_count >= 1%attempt_count <= 12%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
        '%status = ''delivered''%attempt_count >= 1%attempt_count <= 12%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike '%dead_letter%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike '%attempt_count = 12%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike '%delivered_at IS NOT NULL%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike '%lease_token IS NOT NULL%'
  ) then
    raise exception 'Ops 3B1 postcondition: outbox state constraint is incorrect.';
  end if;

  select pg_catalog.array_agg(class.relname::text order by class.relname)
  into actual_indexes
  from pg_catalog.pg_index as index_record
  join pg_catalog.pg_class as class on class.oid = index_record.indexrelid
  where index_record.indrelid = 'public.outbox_events'::pg_catalog.regclass;

  if actual_indexes is distinct from array[
    'outbox_events_event_type_order_id_key',
    'outbox_events_idempotency_key_key',
    'outbox_events_pkey',
    'outbox_events_processing_lease_idx',
    'outbox_events_ready_queue_idx'
  ]::text[] then
    raise exception 'Ops 3B1 postcondition: outbox indexes are incorrect.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_indexes as index_record
      where index_record.schemaname = 'public'
        and index_record.tablename = 'outbox_events'
        and index_record.indexname = 'outbox_events_ready_queue_idx'
        and index_record.indexdef ilike '%(available_at, created_at, id)%'
        and index_record.indexdef ilike '%WHERE (status = ''pending''::text)%'
    )
    or not exists (
      select 1
      from pg_catalog.pg_indexes as index_record
      where index_record.schemaname = 'public'
        and index_record.tablename = 'outbox_events'
        and index_record.indexname = 'outbox_events_processing_lease_idx'
        and index_record.indexdef ilike '%(locked_at, id)%'
        and index_record.indexdef ilike '%WHERE (status = ''processing''::text)%'
    )
  then
    raise exception 'Ops 3B1 postcondition: outbox partial indexes are incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'outbox_events'
  ) then
    raise exception 'Ops 3B1 postcondition: outbox table has an unexpected RLS policy.';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.outbox_events', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.outbox_events', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.outbox_events', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.outbox_events', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.outbox_events', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.outbox_events', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.outbox_events', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.outbox_events', 'DELETE')
    or not pg_catalog.has_table_privilege('service_role', 'public.outbox_events', 'SELECT')
    or not pg_catalog.has_table_privilege('service_role', 'public.outbox_events', 'INSERT')
    or not pg_catalog.has_table_privilege('service_role', 'public.outbox_events', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.outbox_events', 'DELETE')
    or not exists (
      select 1
      from pg_catalog.pg_roles as role
      where role.rolname = 'service_role'
        and role.rolbypassrls
    )
  then
    raise exception 'Ops 3B1 postcondition: outbox table grants are incorrect.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as class
    cross join lateral pg_catalog.aclexplode(
      coalesce(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) as acl
    where class.oid = 'public.outbox_events'::pg_catalog.regclass
      and acl.privilege_type in (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
      and (
        acl.grantee not in (
          'postgres'::pg_catalog.regrole,
          'service_role'::pg_catalog.regrole
        )
        or (
          acl.grantee = 'service_role'::pg_catalog.regrole
          and acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE')
        )
      )
  ) then
    raise exception 'Ops 3B1 postcondition: outbox table has unexpected authority.';
  end if;

  foreach function_contract slice 1 in array array[
    ['public.claim_paid_order_outbox(text,integer)', 'TABLE(event_id uuid, order_id uuid, idempotency_key text, event_version smallint, attempt_count integer, lease_token uuid)'],
    ['public.mark_paid_order_outbox_delivered(uuid,uuid)', 'boolean'],
    ['public.mark_paid_order_outbox_failed(uuid,uuid,text)', 'TABLE(outbox_status text, next_available_at timestamp with time zone, outbox_attempt_count integer)']
  ]
  loop
    function_signature := function_contract[1];
    function_result := function_contract[2];
    function_oid := pg_catalog.to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'Ops 3B1 postcondition: function % is missing.', function_signature;
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_proc as procedure
        where procedure.oid = function_oid
          and procedure.proowner = 'postgres'::pg_catalog.regrole
          and not procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.proconfig is not distinct from array['search_path=""']::text[]
          and pg_catalog.pg_get_function_result(procedure.oid) = function_result
      )
      or not pg_catalog.has_function_privilege(
        'service_role', function_oid, 'EXECUTE'
      )
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            (select procedure.proacl from pg_catalog.pg_proc as procedure where procedure.oid = function_oid),
            pg_catalog.acldefault(
              'f',
              (select procedure.proowner from pg_catalog.pg_proc as procedure where procedure.oid = function_oid)
            )
          )
        ) as acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee not in (
            'postgres'::pg_catalog.regrole,
            'service_role'::pg_catalog.regrole
          )
      )
    then
      raise exception 'Ops 3B1 postcondition: authority for % is incorrect.', function_signature;
    end if;
  end loop;

  if not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.claim_paid_order_outbox(text,integer)'
      )
        and procedure.pronargdefaults = 1
        and procedure.prosrc ilike '%for update of queued skip locked%'
        and procedure.prosrc ilike '%interval ''2 minutes''%'
        and procedure.prosrc ilike '%attempt_count = queued.attempt_count + 1%'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.mark_paid_order_outbox_delivered(uuid,uuid)'
      )
        and procedure.prosrc ilike '%queued.lease_token = p_lease_token%'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.mark_paid_order_outbox_failed(uuid,uuid,text)'
      )
        and procedure.prosrc ilike '%queued.lease_token = p_lease_token%'
        and procedure.prosrc ilike '%interval ''60 minutes''%'
    )
  then
    raise exception 'Ops 3B1 postcondition: outbox lifecycle definitions are incorrect.';
  end if;

  if (select pg_catalog.count(*) from public.outbox_events) <> 0 then
    raise exception 'Ops 3B1 postcondition: outbox foundation is not dormant.';
  end if;

  if pg_catalog.to_regclass('public.notification_deliveries') is not null
    or exists (
      select 1
      from pg_catalog.pg_extension as extension
      where extension.extname in ('pg_cron', 'pg_net')
    )
  then
    raise exception 'Ops 3B1 postcondition: scheduler or delivery scope changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'definition', pg_catalog.pg_get_functiondef(procedure.oid),
    'owner', procedure.proowner,
    'security_definer', procedure.prosecdef,
    'volatility', procedure.provolatile,
    'config', procedure.proconfig,
    'acl', procedure.proacl
  )::text
  into current_authority
  from pg_catalog.pg_proc as procedure
  where procedure.oid = finalization_oid;

  if current_authority is distinct from pg_catalog.current_setting(
    'marketa_ops3b1.finalization_authority'
  ) then
    raise exception 'Ops 3B1 postcondition: finalization authority changed.';
  end if;

  current_authority := case
    when decrement_stock_oid is null then 'absent'
    else (
      select pg_catalog.jsonb_build_object(
        'definition', pg_catalog.pg_get_functiondef(procedure.oid),
        'owner', procedure.proowner,
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile,
        'config', procedure.proconfig,
        'acl', procedure.proacl
      )::text
      from pg_catalog.pg_proc as procedure
      where procedure.oid = decrement_stock_oid
    )
  end;

  if current_authority is distinct from pg_catalog.current_setting(
    'marketa_ops3b1.decrement_stock_authority'
  ) then
    raise exception 'Ops 3B1 postcondition: decrement_stock authority changed.';
  end if;

  if decrement_stock_oid is not null and (
      pg_catalog.has_function_privilege('anon', decrement_stock_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', decrement_stock_oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', decrement_stock_oid, 'EXECUTE')
    )
  then
    raise exception 'Ops 3B1 postcondition: Ops 1A containment changed.';
  end if;

  if (select pg_catalog.count(*)::text from public.orders)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.orders_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(customer_order)::text), '' order by customer_order.id
    ), '')) from public.orders as customer_order)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.orders_rows')
    or (select pg_catalog.count(*)::text from public.order_items)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.order_items_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(item)::text), '' order by item.id
    ), '')) from public.order_items as item)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.order_items_rows')
    or (select pg_catalog.count(*)::text from public.payments)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.payments_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(payment)::text), '' order by payment.id
    ), '')) from public.payments as payment)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.payments_rows')
    or (select pg_catalog.count(*)::text from public.payment_events)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.payment_events_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(payment_event)::text), '' order by payment_event.id
    ), '')) from public.payment_events as payment_event)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.payment_events_rows')
    or (select pg_catalog.count(*)::text from public.payout_ledger)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.payout_ledger_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(ledger)::text), '' order by ledger.id
    ), '')) from public.payout_ledger as ledger)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.payout_ledger_rows')
    or (select pg_catalog.count(*)::text from public.events_ledger)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.events_ledger_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(event)::text), '' order by event.id
    ), '')) from public.events_ledger as event)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.events_ledger_rows')
    or (select pg_catalog.count(*)::text from public.products)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.products_count')
    or (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      pg_catalog.md5(pg_catalog.to_jsonb(product)::text), '' order by product.id
    ), '')) from public.products as product)
      is distinct from pg_catalog.current_setting('marketa_ops3b1.products_rows')
  then
    raise exception 'Ops 3B1 postcondition: protected financial or product rows changed.';
  end if;
end
$postcondition$;

commit;
