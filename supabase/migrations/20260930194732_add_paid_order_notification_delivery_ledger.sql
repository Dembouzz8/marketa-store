-- Ops 3C1B: add a dormant per-recipient delivery ledger below the existing
-- paid-order parent outbox. The parent remains the sole queue, scheduler,
-- retry-backoff, worker-lease, and dead-letter authority.

begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

create temporary table ops_3c1b_parent_baseline (
  parent_count bigint not null,
  parent_fingerprint text not null
) on commit drop;

insert into ops_3c1b_parent_baseline (parent_count, parent_fingerprint)
select
  pg_catalog.count(*),
  pg_catalog.md5(coalesce(
    string_agg(
      pg_catalog.md5(to_jsonb(parent_event)::text),
      '' order by parent_event.id::text
    ),
    ''
  ))
from public.outbox_events as parent_event;

-- OPS_3C1B_PREFLIGHT_START
do $preflight$
declare
  actual_columns text[];
  actual_constraints text[];
  actual_indexes text[];
begin
  if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = pg_catalog.to_regclass('public.outbox_events')
        and class.relkind = 'r'
        and class.relowner = 'postgres'::pg_catalog.regrole
        and class.relrowsecurity
        and not class.relforcerowsecurity
    )
    or exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'outbox_events'
    )
  then
    raise exception 'Ops 3C1B preflight: parent outbox table authority changed.';
  end if;

  select pg_catalog.array_agg(
    attribute.attname::text
      || ':' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
      || ':' || coalesce(
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), ''
      )
    order by attribute.attnum
  )
  into actual_columns
  from pg_catalog.pg_attribute as attribute
  left join pg_catalog.pg_attrdef as default_value
    on default_value.adrelid = attribute.attrelid
    and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.outbox_events'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if actual_columns is distinct from array[
    'id:uuid:true:gen_random_uuid()',
    'event_type:text:true:',
    'event_version:smallint:true:1',
    'order_id:uuid:true:',
    'idempotency_key:text:true:',
    'status:text:true:''pending''::text',
    'attempt_count:integer:true:0',
    'available_at:timestamp with time zone:true:now()',
    'locked_at:timestamp with time zone:false:',
    'locked_by:text:false:',
    'lease_token:uuid:false:',
    'delivered_at:timestamp with time zone:false:',
    'last_error_code:text:false:',
    'created_at:timestamp with time zone:true:now()',
    'updated_at:timestamp with time zone:true:now()'
  ]::text[] then
    raise exception 'Ops 3C1B preflight: parent outbox columns changed.';
  end if;

  select pg_catalog.array_agg(
    constraint_record.conname::text order by constraint_record.conname
  )
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
    raise exception 'Ops 3C1B preflight: parent outbox constraints changed.';
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
    raise exception 'Ops 3C1B preflight: parent outbox indexes changed.';
  end if;

  if not pg_catalog.has_table_privilege(
      'service_role', 'public.outbox_events', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.outbox_events', 'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.outbox_events', 'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.outbox_events', 'DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.outbox_events', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.outbox_events', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or exists (
      select 1
      from pg_catalog.pg_class as class
      cross join lateral pg_catalog.aclexplode(coalesce(
        class.relacl,
        pg_catalog.acldefault('r', class.relowner)
      )) as acl
      where class.oid = 'public.outbox_events'::pg_catalog.regclass
        and acl.grantee = 0
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    )
    or not exists (
      select 1 from pg_catalog.pg_roles as role_record
      where role_record.rolname = 'service_role'
        and role_record.rolbypassrls
    )
  then
    raise exception 'Ops 3C1B preflight: parent outbox grants changed.';
  end if;

  if pg_catalog.to_regprocedure(
      'public.claim_paid_order_outbox(text,integer)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.mark_paid_order_outbox_delivered(uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.mark_paid_order_outbox_failed(uuid,uuid,text)'
    ) is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.claim_paid_order_outbox(text,integer)'
    ))) <> '8ae6ff05b9cb70602e15dd863ccd08ef'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.mark_paid_order_outbox_delivered(uuid,uuid)'
    ))) <> '5e2fb6a338bc29bafbaa5e2d50dabd4b'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.mark_paid_order_outbox_failed(uuid,uuid,text)'
    ))) <> 'c4850d6e31b694358aee75304907e2c8'
  then
    raise exception 'Ops 3C1B preflight: parent outbox RPC foundation changed.';
  end if;

  if pg_catalog.to_regprocedure(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
    ) is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
    ))) <> 'a7bcbaa3cbcdc90140e7dd476e6bc18a'
  then
    raise exception 'Ops 3C1B preflight: paid-order producer changed.';
  end if;

  if (select pg_catalog.count(*) from public.outbox_events) <> 1
    or (select pg_catalog.count(*) from public.outbox_events
        where event_type = 'paid_order'
          and event_version = 1
          and status = 'pending'
          and attempt_count = 0
          and locked_at is null
          and locked_by is null
          and lease_token is null
          and delivered_at is null) <> 1
  then
    raise exception 'Ops 3C1B preflight: paid-order parent baseline changed.';
  end if;

  if pg_catalog.to_regclass('public.notification_deliveries') is not null
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'expand_paid_order_notification_deliveries',
          'begin_paid_order_notification_delivery',
          'mark_paid_order_notification_delivered',
          'mark_paid_order_notification_failed',
          'mark_paid_order_notification_unknown'
        )
    )
  then
    raise exception 'Ops 3C1B preflight: delivery-ledger namespace is occupied.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_extension as extension
    where extension.extname in ('pg_cron', 'pg_net')
  ) then
    raise exception 'Ops 3C1B preflight: prohibited scheduler/network extension is installed.';
  end if;
end
$preflight$;
-- OPS_3C1B_PREFLIGHT_END

-- OPS_3C1B_TABLE_START
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null,
  order_id uuid not null,
  recipient_kind text not null,
  vendor_id uuid,
  channel text not null,
  delivery_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  active_parent_lease_token uuid,
  attempt_token uuid,
  attempt_started_at timestamptz,
  provider text,
  provider_message_id text,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint notification_deliveries_outbox_event_id_fkey
    foreign key (outbox_event_id) references public.outbox_events(id)
    on delete restrict,
  constraint notification_deliveries_order_id_fkey
    foreign key (order_id) references public.orders(id)
    on delete restrict,
  constraint notification_deliveries_vendor_id_fkey
    foreign key (vendor_id) references public.vendors(id)
    on delete restrict,
  constraint notification_deliveries_delivery_key_key unique (delivery_key),
  constraint notification_deliveries_recipient_kind_check
    check (recipient_kind in ('customer', 'vendor')),
  constraint notification_deliveries_channel_check check (channel = 'email'),
  constraint notification_deliveries_recipient_shape_check check (
    (
      recipient_kind = 'customer'
      and vendor_id is null
      and delivery_key = 'paid-order:' || order_id::text || ':customer:email'
    ) or (
      recipient_kind = 'vendor'
      and vendor_id is not null
      and delivery_key = 'paid-order:' || order_id::text
        || ':vendor:' || vendor_id::text || ':email'
    )
  ),
  constraint notification_deliveries_status_check check (
    status in ('pending', 'processing', 'delivered', 'unknown', 'dead_letter')
  ),
  constraint notification_deliveries_attempt_count_check check (
    attempt_count between 0 and 12
  ),
  constraint notification_deliveries_provider_check check (
    provider is null or provider ~ '^[A-Za-z0-9._:-]{1,80}$'
  ),
  constraint notification_deliveries_provider_message_id_check check (
    provider_message_id is null or (
      pg_catalog.char_length(provider_message_id) between 1 and 255
      and provider_message_id !~ '[[:cntrl:]]'
    )
  ),
  constraint notification_deliveries_error_code_check check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,80}$'
  ),
  constraint notification_deliveries_state_tuple_check check (
    (
      status = 'pending'
      and attempt_count between 0 and 11
      and active_parent_lease_token is null
      and attempt_token is null
      and attempt_started_at is null
      and delivered_at is null
    ) or (
      status = 'processing'
      and attempt_count between 1 and 12
      and active_parent_lease_token is not null
      and attempt_token is not null
      and attempt_started_at is not null
      and provider is not null
      and provider_message_id is null
      and delivered_at is null
      and last_error_code is null
    ) or (
      status = 'delivered'
      and attempt_count between 1 and 12
      and active_parent_lease_token is null
      and attempt_token is null
      and attempt_started_at is null
      and provider is not null
      and delivered_at is not null
      and last_error_code is null
    ) or (
      status = 'unknown'
      and attempt_count between 1 and 12
      and active_parent_lease_token is null
      and attempt_token is null
      and attempt_started_at is null
      and delivered_at is null
      and last_error_code is not null
    ) or (
      status = 'dead_letter'
      and attempt_count between 1 and 12
      and active_parent_lease_token is null
      and attempt_token is null
      and attempt_started_at is null
      and delivered_at is null
      and last_error_code is not null
    )
  )
);

create index notification_deliveries_outbox_status_id_idx
  on public.notification_deliveries (outbox_event_id, status, id);

create index notification_deliveries_order_recipient_vendor_idx
  on public.notification_deliveries (order_id, recipient_kind, vendor_id);

alter table public.notification_deliveries owner to postgres;
alter table public.notification_deliveries enable row level security;

revoke all privileges on table public.notification_deliveries
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.notification_deliveries
  to service_role;
-- OPS_3C1B_TABLE_END

-- OPS_3C1B_EXPAND_START
create function public.expand_paid_order_notification_deliveries(
  p_outbox_event_id uuid,
  p_parent_lease_token uuid
)
returns table (
  delivery_count bigint,
  pending_count bigint,
  processing_count bigint,
  delivered_count bigint,
  unknown_count bigint,
  dead_letter_count bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_parent public.outbox_events%rowtype;
  v_order public.orders%rowtype;
  v_payment_count bigint;
  v_payment_amount_kobo bigint;
  v_payment_currency text;
  v_payment_contract_version smallint;
  v_item_count bigint;
  v_vendor_count bigint;
  v_items_have_vendors boolean;
  v_expected_count bigint;
  v_actual_count bigint;
begin
  if p_outbox_event_id is null or p_parent_lease_token is null then
    raise exception 'Invalid paid-order delivery expansion request.'
      using errcode = '22023';
  end if;

  select parent_event.*
  into v_parent
  from public.outbox_events as parent_event
  where parent_event.id = p_outbox_event_id
  for update;

  if not found
    or v_parent.event_type is distinct from 'paid_order'
    or v_parent.event_version is distinct from 1
    or v_parent.status is distinct from 'processing'
    or v_parent.lease_token is distinct from p_parent_lease_token
    or v_parent.order_id is null
    or v_parent.idempotency_key is distinct from
      'paid-order:' || v_parent.order_id::text
  then
    raise exception 'Paid-order parent lease is unavailable.'
      using errcode = '55000';
  end if;

  select customer_order.*
  into v_order
  from public.orders as customer_order
  where customer_order.id = v_parent.order_id;

  if not found
    or v_order.id is distinct from v_parent.order_id
    or v_order.status is distinct from 'confirmed'
    or v_order.payment_finalized_at is null
  then
    raise exception 'Paid-order dispatch state is inconsistent.'
      using errcode = '55000';
  end if;

  select
    pg_catalog.count(*),
    min(payment.amount_kobo),
    min(payment.currency),
    min(payment.financial_contract_version)
  into
    v_payment_count,
    v_payment_amount_kobo,
    v_payment_currency,
    v_payment_contract_version
  from public.payments as payment
  where payment.order_id = v_order.id
    and payment.status = 'success'
    and payment.finalization_state = 'completed'
    and payment.outcome_code = 'FINALIZED';

  if v_payment_count <> 1
    or v_payment_contract_version
      is distinct from v_order.financial_contract_version
  then
    raise exception 'Paid-order payment state is inconsistent.'
      using errcode = '55000';
  end if;

  if v_order.financial_contract_version = 1 then
    if v_order.total_amount_kobo is null
      or v_order.total_amount_kobo <= 0
      or v_order.currency is distinct from 'NGN'
      or v_order.total_amount * 100
        is distinct from v_order.total_amount_kobo::numeric
      or v_payment_amount_kobo is distinct from v_order.total_amount_kobo
      or v_payment_currency is distinct from v_order.currency
      or v_payment_contract_version is distinct from 1
    then
      raise exception 'Paid-order financial contract is inconsistent.'
        using errcode = '55000';
    end if;
  elsif v_order.financial_contract_version = 2 then
    if v_order.total_amount_kobo is null
      or v_order.total_amount_kobo <= 0
      or v_order.currency is null
      or v_order.currency !~ '^[A-Z]{3}$'
      or v_order.total_amount * 100 <> v_order.total_amount_kobo::numeric
      or v_payment_amount_kobo is distinct from v_order.total_amount_kobo
      or v_payment_currency is distinct from v_order.currency
      or v_payment_contract_version is distinct from 2
    then
      raise exception 'Paid-order financial contract is inconsistent.'
        using errcode = '55000';
    end if;
  else
    raise exception 'Paid-order financial contract version is unsupported.'
      using errcode = '55000';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(distinct item.vendor_id),
    coalesce(pg_catalog.bool_and(item.vendor_id is not null), false)
  into v_item_count, v_vendor_count, v_items_have_vendors
  from public.order_items as item
  where item.order_id = v_order.id;

  if v_item_count < 1 or v_vendor_count < 1 or not v_items_have_vendors then
    raise exception 'Paid-order item ownership is inconsistent.'
      using errcode = '55000';
  end if;

  update public.notification_deliveries as delivery
  set status = 'unknown',
      active_parent_lease_token = null,
      attempt_token = null,
      attempt_started_at = null,
      delivered_at = null,
      last_error_code = 'INTERRUPTED_DELIVERY_ATTEMPT',
      updated_at = v_now
  where delivery.outbox_event_id = v_parent.id
    and delivery.status = 'processing'
    and delivery.active_parent_lease_token
      is distinct from p_parent_lease_token;

  insert into public.notification_deliveries (
    outbox_event_id,
    order_id,
    recipient_kind,
    vendor_id,
    channel,
    delivery_key
  )
  select
    v_parent.id,
    v_order.id,
    expected.recipient_kind,
    expected.vendor_id,
    'email',
    expected.delivery_key
  from (
    select
      'customer'::text as recipient_kind,
      null::uuid as vendor_id,
      'paid-order:' || v_order.id::text || ':customer:email'
        as delivery_key
    union all
    select
      'vendor'::text,
      item.vendor_id,
      'paid-order:' || v_order.id::text
        || ':vendor:' || item.vendor_id::text || ':email'
    from public.order_items as item
    where item.order_id = v_order.id
    group by item.vendor_id
  ) as expected
  on conflict (delivery_key) do nothing;

  v_expected_count := 1 + v_vendor_count;
  select pg_catalog.count(*)
  into v_actual_count
  from public.notification_deliveries as delivery
  where delivery.outbox_event_id = v_parent.id;

  if v_actual_count <> v_expected_count
    or not exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_event_id = v_parent.id
        and delivery.order_id = v_order.id
        and delivery.recipient_kind = 'customer'
        and delivery.vendor_id is null
        and delivery.channel = 'email'
        and delivery.delivery_key =
          'paid-order:' || v_order.id::text || ':customer:email'
    )
    or exists (
      select 1
      from (
        select distinct item.vendor_id
        from public.order_items as item
        where item.order_id = v_order.id
      ) as expected_vendor
      where not exists (
        select 1
        from public.notification_deliveries as delivery
        where delivery.outbox_event_id = v_parent.id
          and delivery.order_id = v_order.id
          and delivery.recipient_kind = 'vendor'
          and delivery.vendor_id = expected_vendor.vendor_id
          and delivery.channel = 'email'
          and delivery.delivery_key =
            'paid-order:' || v_order.id::text
              || ':vendor:' || expected_vendor.vendor_id::text || ':email'
      )
    )
    or exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_event_id = v_parent.id
        and (
          delivery.order_id is distinct from v_order.id
          or delivery.channel is distinct from 'email'
          or (
            delivery.recipient_kind = 'customer'
            and (
              delivery.vendor_id is not null
              or delivery.delivery_key is distinct from
                'paid-order:' || v_order.id::text || ':customer:email'
            )
          )
          or (
            delivery.recipient_kind = 'vendor'
            and (
              delivery.vendor_id is null
              or delivery.delivery_key is distinct from
                'paid-order:' || v_order.id::text
                  || ':vendor:' || delivery.vendor_id::text || ':email'
              or not exists (
                select 1 from public.order_items as item
                where item.order_id = v_order.id
                  and item.vendor_id = delivery.vendor_id
              )
            )
          )
          or delivery.recipient_kind not in ('customer', 'vendor')
        )
    )
  then
    raise exception 'Paid-order delivery child set is inconsistent.'
      using errcode = '55000';
  end if;

  return query
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where delivery.status = 'pending'),
    pg_catalog.count(*) filter (where delivery.status = 'processing'),
    pg_catalog.count(*) filter (where delivery.status = 'delivered'),
    pg_catalog.count(*) filter (where delivery.status = 'unknown'),
    pg_catalog.count(*) filter (where delivery.status = 'dead_letter')
  from public.notification_deliveries as delivery
  where delivery.outbox_event_id = v_parent.id;
end
$function$;
-- OPS_3C1B_EXPAND_END

-- OPS_3C1B_BEGIN_START
create function public.begin_paid_order_notification_delivery(
  p_outbox_event_id uuid,
  p_parent_lease_token uuid,
  p_delivery_id uuid,
  p_provider text
)
returns table (
  delivery_id uuid,
  delivery_key text,
  recipient_kind text,
  vendor_id uuid,
  attempt_count integer,
  attempt_token uuid
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if p_provider is null or p_provider !~ '^[A-Za-z0-9._:-]{1,80}$' then
    raise exception 'Invalid paid-order notification provider.'
      using errcode = '22023';
  end if;

  perform 1
  from public.outbox_events as parent_event
  where parent_event.id = p_outbox_event_id
    and parent_event.event_type = 'paid_order'
    and parent_event.event_version = 1
    and parent_event.status = 'processing'
    and parent_event.lease_token = p_parent_lease_token
  for update;

  if not found then return; end if;

  return query
  update public.notification_deliveries as delivery
  set status = 'processing',
      attempt_count = delivery.attempt_count + 1,
      active_parent_lease_token = p_parent_lease_token,
      attempt_token = gen_random_uuid(),
      attempt_started_at = pg_catalog.now(),
      provider = p_provider,
      provider_message_id = null,
      delivered_at = null,
      last_error_code = null,
      updated_at = pg_catalog.now()
  where delivery.id = p_delivery_id
    and delivery.outbox_event_id = p_outbox_event_id
    and delivery.status = 'pending'
    and delivery.attempt_count < 12
  returning
    delivery.id,
    delivery.delivery_key,
    delivery.recipient_kind,
    delivery.vendor_id,
    delivery.attempt_count,
    delivery.attempt_token;
end
$function$;
-- OPS_3C1B_BEGIN_END

-- OPS_3C1B_DELIVERED_START
create function public.mark_paid_order_notification_delivered(
  p_outbox_event_id uuid,
  p_parent_lease_token uuid,
  p_delivery_id uuid,
  p_attempt_token uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_updated_rows integer;
begin
  if p_provider_message_id is not null and (
    pg_catalog.char_length(p_provider_message_id) not between 1 and 255
    or p_provider_message_id ~ '[[:cntrl:]]'
  ) then
    raise exception 'Invalid paid-order provider message identifier.'
      using errcode = '22023';
  end if;

  perform 1
  from public.outbox_events as parent_event
  where parent_event.id = p_outbox_event_id
    and parent_event.event_type = 'paid_order'
    and parent_event.event_version = 1
    and parent_event.status = 'processing'
    and parent_event.lease_token = p_parent_lease_token
  for update;

  if not found then return false; end if;

  update public.notification_deliveries as delivery
  set status = 'delivered',
      active_parent_lease_token = null,
      attempt_token = null,
      attempt_started_at = null,
      provider_message_id = p_provider_message_id,
      delivered_at = pg_catalog.now(),
      last_error_code = null,
      updated_at = pg_catalog.now()
  where delivery.id = p_delivery_id
    and delivery.outbox_event_id = p_outbox_event_id
    and delivery.status = 'processing'
    and delivery.active_parent_lease_token = p_parent_lease_token
    and delivery.attempt_token = p_attempt_token;

  get diagnostics v_updated_rows = row_count;
  return v_updated_rows = 1;
end
$function$;
-- OPS_3C1B_DELIVERED_END

-- OPS_3C1B_FAILED_START
create function public.mark_paid_order_notification_failed(
  p_outbox_event_id uuid,
  p_parent_lease_token uuid,
  p_delivery_id uuid,
  p_attempt_token uuid,
  p_error_code text,
  p_permanent boolean
)
returns table (
  delivery_status text,
  delivery_attempt_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if p_error_code is null
    or p_error_code !~ '^[A-Z0-9_]{1,80}$'
    or p_permanent is null
  then
    raise exception 'Invalid paid-order notification failure.'
      using errcode = '22023';
  end if;

  perform 1
  from public.outbox_events as parent_event
  where parent_event.id = p_outbox_event_id
    and parent_event.event_type = 'paid_order'
    and parent_event.event_version = 1
    and parent_event.status = 'processing'
    and parent_event.lease_token = p_parent_lease_token
  for update;

  if not found then return; end if;

  return query
  update public.notification_deliveries as delivery
  set status = case
        when p_permanent or delivery.attempt_count >= 12 then 'dead_letter'
        else 'pending'
      end,
      active_parent_lease_token = null,
      attempt_token = null,
      attempt_started_at = null,
      delivered_at = null,
      last_error_code = p_error_code,
      updated_at = pg_catalog.now()
  where delivery.id = p_delivery_id
    and delivery.outbox_event_id = p_outbox_event_id
    and delivery.status = 'processing'
    and delivery.active_parent_lease_token = p_parent_lease_token
    and delivery.attempt_token = p_attempt_token
  returning delivery.status, delivery.attempt_count;
end
$function$;
-- OPS_3C1B_FAILED_END

-- OPS_3C1B_UNKNOWN_START
create function public.mark_paid_order_notification_unknown(
  p_outbox_event_id uuid,
  p_parent_lease_token uuid,
  p_delivery_id uuid,
  p_attempt_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_updated_rows integer;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'Invalid paid-order notification uncertainty.'
      using errcode = '22023';
  end if;

  perform 1
  from public.outbox_events as parent_event
  where parent_event.id = p_outbox_event_id
    and parent_event.event_type = 'paid_order'
    and parent_event.event_version = 1
    and parent_event.status = 'processing'
    and parent_event.lease_token = p_parent_lease_token
  for update;

  if not found then return false; end if;

  update public.notification_deliveries as delivery
  set status = 'unknown',
      active_parent_lease_token = null,
      attempt_token = null,
      attempt_started_at = null,
      delivered_at = null,
      last_error_code = p_error_code,
      updated_at = pg_catalog.now()
  where delivery.id = p_delivery_id
    and delivery.outbox_event_id = p_outbox_event_id
    and delivery.status = 'processing'
    and delivery.active_parent_lease_token = p_parent_lease_token
    and delivery.attempt_token = p_attempt_token;

  get diagnostics v_updated_rows = row_count;
  return v_updated_rows = 1;
end
$function$;
-- OPS_3C1B_UNKNOWN_END

-- OPS_3C1B_PARENT_DELIVERED_START
create or replace function public.mark_paid_order_outbox_delivered(
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
  v_order_id uuid;
  v_item_count bigint;
  v_vendor_count bigint;
  v_expected_count bigint;
  v_actual_count bigint;
  v_updated_rows integer;
begin
  select parent_event.order_id
  into v_order_id
  from public.outbox_events as parent_event
  where parent_event.id = p_event_id
    and parent_event.event_type = 'paid_order'
    and parent_event.event_version = 1
    and parent_event.status = 'processing'
    and parent_event.lease_token = p_lease_token
  for update;

  if not found then return false; end if;

  perform 1
  from public.notification_deliveries as delivery
  where delivery.outbox_event_id = p_event_id
  for update;

  select pg_catalog.count(*), pg_catalog.count(distinct item.vendor_id)
  into v_item_count, v_vendor_count
  from public.order_items as item
  where item.order_id = v_order_id
    and item.vendor_id is not null;

  if v_item_count < 1 or v_vendor_count < 1 then return false; end if;

  v_expected_count := 1 + v_vendor_count;
  select pg_catalog.count(*) into v_actual_count
  from public.notification_deliveries as delivery
  where delivery.outbox_event_id = p_event_id;

  if v_actual_count <> v_expected_count
    or exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_event_id = p_event_id
        and delivery.status <> 'delivered'
    )
    or not exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_event_id = p_event_id
        and delivery.order_id = v_order_id
        and delivery.recipient_kind = 'customer'
        and delivery.vendor_id is null
        and delivery.channel = 'email'
        and delivery.delivery_key =
          'paid-order:' || v_order_id::text || ':customer:email'
        and delivery.status = 'delivered'
    )
    or exists (
      select 1
      from (
        select distinct item.vendor_id
        from public.order_items as item
        where item.order_id = v_order_id
          and item.vendor_id is not null
      ) as expected_vendor
      where not exists (
        select 1
        from public.notification_deliveries as delivery
        where delivery.outbox_event_id = p_event_id
          and delivery.order_id = v_order_id
          and delivery.recipient_kind = 'vendor'
          and delivery.vendor_id = expected_vendor.vendor_id
          and delivery.channel = 'email'
          and delivery.delivery_key =
            'paid-order:' || v_order_id::text
              || ':vendor:' || expected_vendor.vendor_id::text || ':email'
          and delivery.status = 'delivered'
      )
    )
    or exists (
      select 1
      from public.notification_deliveries as delivery
      where delivery.outbox_event_id = p_event_id
        and (
          delivery.order_id is distinct from v_order_id
          or delivery.channel is distinct from 'email'
          or (
            delivery.recipient_kind = 'customer'
            and (
              delivery.vendor_id is not null
              or delivery.delivery_key is distinct from
                'paid-order:' || v_order_id::text || ':customer:email'
            )
          )
          or (
            delivery.recipient_kind = 'vendor'
            and (
              delivery.vendor_id is null
              or delivery.delivery_key is distinct from
                'paid-order:' || v_order_id::text
                  || ':vendor:' || delivery.vendor_id::text || ':email'
              or not exists (
                select 1 from public.order_items as item
                where item.order_id = v_order_id
                  and item.vendor_id = delivery.vendor_id
              )
            )
          )
          or delivery.recipient_kind not in ('customer', 'vendor')
        )
    )
  then
    return false;
  end if;

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
-- OPS_3C1B_PARENT_DELIVERED_END

alter function public.expand_paid_order_notification_deliveries(uuid, uuid)
  owner to postgres;
alter function public.begin_paid_order_notification_delivery(uuid, uuid, uuid, text)
  owner to postgres;
alter function public.mark_paid_order_notification_delivered(uuid, uuid, uuid, uuid, text)
  owner to postgres;
alter function public.mark_paid_order_notification_failed(uuid, uuid, uuid, uuid, text, boolean)
  owner to postgres;
alter function public.mark_paid_order_notification_unknown(uuid, uuid, uuid, uuid, text)
  owner to postgres;
alter function public.mark_paid_order_outbox_delivered(uuid, uuid)
  owner to postgres;

revoke all privileges on function public.expand_paid_order_notification_deliveries(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.begin_paid_order_notification_delivery(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_paid_order_notification_delivered(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_paid_order_notification_failed(uuid, uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_paid_order_notification_unknown(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_paid_order_outbox_delivered(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.expand_paid_order_notification_deliveries(uuid, uuid)
  to service_role;
grant execute on function public.begin_paid_order_notification_delivery(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.mark_paid_order_notification_delivered(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.mark_paid_order_notification_failed(uuid, uuid, uuid, uuid, text, boolean)
  to service_role;
grant execute on function public.mark_paid_order_notification_unknown(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.mark_paid_order_outbox_delivered(uuid, uuid)
  to service_role;

-- OPS_3C1B_POSTCONDITION_START
do $postcondition$
declare
  actual_columns text[];
  actual_constraints text[];
  actual_indexes text[];
  function_signature text;
  function_oid oid;
  function_definition text;
  current_parent_count bigint;
  current_parent_fingerprint text;
begin
  select pg_catalog.array_agg(
    attribute.attname::text
      || ':' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
      || ':' || coalesce(
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), ''
      )
    order by attribute.attnum
  )
  into actual_columns
  from pg_catalog.pg_attribute as attribute
  left join pg_catalog.pg_attrdef as default_value
    on default_value.adrelid = attribute.attrelid
    and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.notification_deliveries'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if actual_columns is distinct from array[
    'id:uuid:true:gen_random_uuid()',
    'outbox_event_id:uuid:true:',
    'order_id:uuid:true:',
    'recipient_kind:text:true:',
    'vendor_id:uuid:false:',
    'channel:text:true:',
    'delivery_key:text:true:',
    'status:text:true:''pending''::text',
    'attempt_count:integer:true:0',
    'active_parent_lease_token:uuid:false:',
    'attempt_token:uuid:false:',
    'attempt_started_at:timestamp with time zone:false:',
    'provider:text:false:',
    'provider_message_id:text:false:',
    'delivered_at:timestamp with time zone:false:',
    'last_error_code:text:false:',
    'created_at:timestamp with time zone:true:now()',
    'updated_at:timestamp with time zone:true:now()'
  ]::text[] then
    raise exception 'Ops 3C1B postcondition: delivery columns are incorrect.';
  end if;

  select pg_catalog.array_agg(
    constraint_record.conname::text order by constraint_record.conname
  )
  into actual_constraints
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid =
    'public.notification_deliveries'::pg_catalog.regclass;

  if actual_constraints is distinct from array[
    'notification_deliveries_attempt_count_check',
    'notification_deliveries_channel_check',
    'notification_deliveries_delivery_key_key',
    'notification_deliveries_error_code_check',
    'notification_deliveries_order_id_fkey',
    'notification_deliveries_outbox_event_id_fkey',
    'notification_deliveries_pkey',
    'notification_deliveries_provider_check',
    'notification_deliveries_provider_message_id_check',
    'notification_deliveries_recipient_kind_check',
    'notification_deliveries_recipient_shape_check',
    'notification_deliveries_state_tuple_check',
    'notification_deliveries_status_check',
    'notification_deliveries_vendor_id_fkey'
  ]::text[] then
    raise exception 'Ops 3C1B postcondition: delivery constraints are incorrect.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid =
        'public.notification_deliveries'::pg_catalog.regclass
        and constraint_record.conname = 'notification_deliveries_state_tuple_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''pending''%attempt_count >= 0%attempt_count <= 11%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''processing''%attempt_count >= 1%attempt_count <= 12%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''delivered''%attempt_count >= 1%attempt_count <= 12%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''unknown''%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''dead_letter''%'
    )
  then
    raise exception 'Ops 3C1B postcondition: delivery state tuples are incorrect.';
  end if;

  select pg_catalog.array_agg(class.relname::text order by class.relname)
  into actual_indexes
  from pg_catalog.pg_index as index_record
  join pg_catalog.pg_class as class on class.oid = index_record.indexrelid
  where index_record.indrelid =
    'public.notification_deliveries'::pg_catalog.regclass;

  if actual_indexes is distinct from array[
    'notification_deliveries_delivery_key_key',
    'notification_deliveries_order_recipient_vendor_idx',
    'notification_deliveries_outbox_status_id_idx',
    'notification_deliveries_pkey'
  ]::text[] then
    raise exception 'Ops 3C1B postcondition: delivery indexes are incorrect.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_class as class
      where class.oid = 'public.notification_deliveries'::pg_catalog.regclass
        and class.relowner = 'postgres'::pg_catalog.regrole
        and class.relrowsecurity
        and not class.relforcerowsecurity
    )
    or exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'notification_deliveries'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.notification_deliveries', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.notification_deliveries', 'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.notification_deliveries', 'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.notification_deliveries', 'DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or exists (
      select 1
      from pg_catalog.pg_class as class
      cross join lateral pg_catalog.aclexplode(coalesce(
        class.relacl,
        pg_catalog.acldefault('r', class.relowner)
      )) as acl
      where class.oid = 'public.notification_deliveries'::pg_catalog.regclass
        and acl.grantee = 0
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    )
    or not exists (
      select 1 from pg_catalog.pg_roles as role_record
      where role_record.rolname = 'service_role'
        and role_record.rolbypassrls
    )
  then
    raise exception 'Ops 3C1B postcondition: delivery authority is incorrect.';
  end if;

  foreach function_signature in array array[
    'public.expand_paid_order_notification_deliveries(uuid,uuid)',
    'public.begin_paid_order_notification_delivery(uuid,uuid,uuid,text)',
    'public.mark_paid_order_notification_delivered(uuid,uuid,uuid,uuid,text)',
    'public.mark_paid_order_notification_failed(uuid,uuid,uuid,uuid,text,boolean)',
    'public.mark_paid_order_notification_unknown(uuid,uuid,uuid,uuid,text)',
    'public.mark_paid_order_outbox_delivered(uuid,uuid)'
  ]
  loop
    function_oid := pg_catalog.to_regprocedure(function_signature);
    if function_oid is null
      or (select procedure.proowner from pg_catalog.pg_proc as procedure
          where procedure.oid = function_oid) <> 'postgres'::pg_catalog.regrole
      or (select procedure.prosecdef from pg_catalog.pg_proc as procedure
          where procedure.oid = function_oid)
      or (select procedure.provolatile from pg_catalog.pg_proc as procedure
          where procedure.oid = function_oid) <> 'v'
      or (select procedure.proconfig from pg_catalog.pg_proc as procedure
          where procedure.oid = function_oid)
        is distinct from array['search_path=""']::text[]
      or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'authenticated', function_oid, 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', function_oid, 'EXECUTE'
      )
      or exists (
        select 1
        from pg_catalog.pg_proc as procedure
        cross join lateral pg_catalog.aclexplode(coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )) as acl
        where procedure.oid = function_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    then
      raise exception 'Ops 3C1B postcondition: function % authority is incorrect.',
        function_signature;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.expand_paid_order_notification_deliveries(uuid,uuid)'
  )) into function_definition;
  if function_definition not ilike '%on conflict (delivery_key) do nothing%'
    or function_definition not ilike '%INTERRUPTED_DELIVERY_ATTEMPT%'
    or function_definition not ilike '%is distinct from p_parent_lease_token%'
    or function_definition not ilike '%Paid-order delivery child set is inconsistent%'
    or function_definition not ilike
      '%payment.outcome_code = ''FINALIZED''%'
    or function_definition not ilike
      '%v_payment_contract_version%is distinct from v_order.financial_contract_version%'
    or function_definition not ilike
      '%if v_order.financial_contract_version = 1 then%'
    or function_definition not ilike
      '%elsif v_order.financial_contract_version = 2 then%'
    or function_definition ilike
      '%financial_contract_version is null then%'
  then
    raise exception 'Ops 3C1B postcondition: expansion contract is incorrect.';
  end if;

  select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.mark_paid_order_outbox_delivered(uuid,uuid)'
  )) into function_definition;
  if function_definition not ilike '%notification_deliveries%'
    or function_definition not ilike '%delivery.status <> ''delivered''%'
    or function_definition not ilike '%v_actual_count <> v_expected_count%'
  then
    raise exception 'Ops 3C1B postcondition: parent completion is not child-gated.';
  end if;

  if pg_catalog.to_regprocedure(
      'public.claim_paid_order_outbox(text,integer)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.mark_paid_order_outbox_failed(uuid,uuid,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
    ) is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.claim_paid_order_outbox(text,integer)'
    ))) <> '8ae6ff05b9cb70602e15dd863ccd08ef'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.mark_paid_order_outbox_failed(uuid,uuid,text)'
    ))) <> 'c4850d6e31b694358aee75304907e2c8'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
    ))) <> 'a7bcbaa3cbcdc90140e7dd476e6bc18a'
  then
    raise exception 'Ops 3C1B postcondition: frozen parent or producer RPC changed.';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.md5(coalesce(
      string_agg(
        pg_catalog.md5(to_jsonb(parent_event)::text),
        '' order by parent_event.id::text
      ),
      ''
    ))
  into current_parent_count, current_parent_fingerprint
  from public.outbox_events as parent_event;

  if (select pg_catalog.count(*) from public.notification_deliveries) <> 0
    or not exists (
      select 1
      from ops_3c1b_parent_baseline as baseline
      where baseline.parent_count
        is not distinct from current_parent_count
        and baseline.parent_fingerprint
          is not distinct from current_parent_fingerprint
    )
  then
    raise exception 'Ops 3C1B postcondition: dormant row state changed.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_extension as extension
    where extension.extname in ('pg_cron', 'pg_net')
  ) then
    raise exception 'Ops 3C1B postcondition: prohibited scheduler/network extension is installed.';
  end if;
end
$postcondition$;
-- OPS_3C1B_POSTCONDITION_END

commit;
