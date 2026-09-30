-- Ops 3B2: atomically create one durable paid-order outbox intent when a
-- genuinely new financial finalization commits. This migration performs no
-- historical backfill and adds no delivery worker, scheduler, or network call.

begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

-- OPS_3B2_PREFLIGHT_START
do $preflight$
declare
  actual_columns text[];
  actual_constraints text[];
  actual_indexes text[];
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  lifecycle_oid oid;
  lifecycle_signature text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = pg_catalog.to_regclass('public.outbox_events')
      and class.relkind = 'r'
      and class.relowner = 'postgres'::pg_catalog.regrole
      and class.relrowsecurity
      and not class.relforcerowsecurity
  ) then
    raise exception 'Ops 3B2 preflight: paid-order outbox table metadata changed.';
  end if;

  if exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'outbox_events'
    )
    or (select pg_catalog.count(*) from public.outbox_events) <> 0
  then
    raise exception 'Ops 3B2 preflight: paid-order outbox is not dormant.';
  end if;

  select pg_catalog.array_agg(
    attribute.attname::text
      || ':' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
      || ':' || coalesce(
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
        ''
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
    raise exception 'Ops 3B2 preflight: paid-order outbox columns changed.';
  end if;

  select pg_catalog.array_agg(
    constraint_record.conname::text
    order by constraint_record.conname
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
    raise exception 'Ops 3B2 preflight: paid-order outbox constraints changed.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_event_type_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (event_type = ''paid_order''::text)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_event_version_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (event_version = 1)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_idempotency_key_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (idempotency_key = (''paid-order:''::text || order_id::text))'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_order_id_fkey'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_state_tuple_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''pending''%attempt_count >= 0%attempt_count <= 11%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''processing''%attempt_count >= 1%attempt_count <= 12%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''delivered''%attempt_count >= 1%attempt_count <= 12%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''dead_letter''%attempt_count = 12%'
    )
  then
    raise exception 'Ops 3B2 preflight: paid-order outbox constraint definitions changed.';
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
    raise exception 'Ops 3B2 preflight: paid-order outbox indexes changed.';
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
    or not exists (
      select 1
      from pg_catalog.pg_roles as role_record
      where role_record.rolname = 'service_role'
        and role_record.rolbypassrls
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
      cross join lateral pg_catalog.aclexplode(
        coalesce(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) as acl
      where class.oid = 'public.outbox_events'::pg_catalog.regclass
        and acl.grantee = 0
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    )
  then
    raise exception 'Ops 3B2 preflight: paid-order outbox grants changed.';
  end if;

  foreach lifecycle_signature in array array[
    'public.claim_paid_order_outbox(text,integer)',
    'public.mark_paid_order_outbox_delivered(uuid,uuid)',
    'public.mark_paid_order_outbox_failed(uuid,uuid,text)'
  ]
  loop
    lifecycle_oid := pg_catalog.to_regprocedure(lifecycle_signature);

    if lifecycle_oid is null
      or (select procedure.proowner from pg_catalog.pg_proc as procedure
          where procedure.oid = lifecycle_oid)
        <> 'postgres'::pg_catalog.regrole
      or (select procedure.prosecdef from pg_catalog.pg_proc as procedure
          where procedure.oid = lifecycle_oid)
      or (select procedure.provolatile from pg_catalog.pg_proc as procedure
          where procedure.oid = lifecycle_oid) <> 'v'
      or (select procedure.proconfig from pg_catalog.pg_proc as procedure
          where procedure.oid = lifecycle_oid)
        is distinct from array['search_path=""']::text[]
      or pg_catalog.has_function_privilege('anon', lifecycle_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'authenticated', lifecycle_oid, 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', lifecycle_oid, 'EXECUTE'
      )
      or exists (
        select 1
        from pg_catalog.pg_proc as procedure
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) as acl
        where procedure.oid = lifecycle_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    then
      raise exception 'Ops 3B2 preflight: outbox lifecycle RPC % changed.',
        lifecycle_signature;
    end if;
  end loop;

  if rpc_oid is null
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'finalize_paystack_paid_order'
    ) <> 1
    or (select procedure.proowner from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid)
      <> 'postgres'::pg_catalog.regrole
    or (select procedure.prosecdef from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid)
    or (select procedure.provolatile from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid) <> 'v'
    or (select procedure.proconfig from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid)
      is distinct from array['search_path=""']::text[]
    or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', rpc_oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', rpc_oid, 'EXECUTE'
    )
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) as acl
      where procedure.oid = rpc_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(rpc_oid))
      <> '9d66b59ebfa95623d1e4e3905181199b'
  then
    raise exception 'Ops 3B2 preflight: atomic finalization RPC changed.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_extension as extension
    where extension.extname in ('pg_cron', 'pg_net')
  ) then
    raise exception 'Ops 3B2 preflight: prohibited scheduler/network extension is installed.';
  end if;
end
$preflight$;
-- OPS_3B2_PREFLIGHT_END

-- OPS_3B2_RPC_START
create or replace function public.finalize_paystack_paid_order(
  p_payload_sha256 text,
  p_event_type text,
  p_environment text,
  p_transaction_id text,
  p_reference text,
  p_status text,
  p_amount_kobo bigint,
  p_currency text,
  p_paid_at timestamptz
)
returns table (
  outcome text,
  order_id uuid,
  retryable boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_event public.payment_events%rowtype;
  v_payment public.payments%rowtype;
  v_transaction_payment public.payments%rowtype;
  v_reference_payment public.payments%rowtype;
  v_safe_transaction_id text;
  v_safe_reference text;
  v_order public.orders%rowtype;
  v_payment_was_inserted boolean := false;
  v_transaction_payment_found boolean := false;
  v_reference_payment_found boolean := false;
  v_existing_order_payment_id uuid;
  v_event_order_id uuid;
  v_contract_version smallint;
  v_item_count bigint;
  v_item_total numeric;
  v_item_total_kobo bigint;
  v_items_valid boolean;
  v_vendor_count bigint;
  v_valid_vendor_count bigint;
  v_updated_rows integer;
  v_credit record;
  v_constraint_name text;
begin
  if p_payload_sha256 is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_event_type is distinct from 'charge.success'
    or p_environment is null
    or p_environment not in ('test', 'live')
  then
    return query
    select 'INVALID_PROVIDER_PAYLOAD'::text, null::uuid, true;
    return;
  end if;

  v_safe_transaction_id := case
    when p_transaction_id ~ '^[1-9][0-9]{0,19}$' then p_transaction_id
    else null
  end;
  v_safe_reference := case
    when p_reference ~ '^[A-Za-z0-9._=-]{1,100}$' then p_reference
    else null
  end;

  insert into public.payment_events as existing_event (
    provider,
    environment,
    event_type,
    payload_sha256,
    transaction_id,
    reference,
    processing_state,
    attempt_count,
    first_received_at,
    last_attempted_at
  ) values (
    'paystack',
    p_environment,
    p_event_type,
    p_payload_sha256,
    v_safe_transaction_id,
    v_safe_reference,
    'received',
    1,
    v_now,
    v_now
  )
  on conflict (provider, environment, payload_sha256)
  do update set
    attempt_count = existing_event.attempt_count + 1,
    last_attempted_at = excluded.last_attempted_at
  returning * into v_event;

  if v_event.event_type is distinct from p_event_type
    or v_event.transaction_id is distinct from v_safe_transaction_id
    or v_event.reference is distinct from v_safe_reference
  then
    update public.payment_events as event
    set processing_state = 'reconciliation_required',
        completed_at = v_now,
        outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
        diagnostic_code = 'DELIVERY_IDENTITY_MISMATCH'
    where event.id = v_event.id;

    return query
    select 'PAYMENT_IDENTITY_CONFLICT'::text, null::uuid, false;
    return;
  end if;

  if v_event.processing_state = 'completed' then
    select payment.order_id
    into v_event_order_id
    from public.payments as payment
    where payment.id = v_event.payment_id;

    return query
    select 'EVENT_ALREADY_COMPLETED'::text, v_event_order_id, false;
    return;
  end if;

  if v_event.processing_state in ('terminal_rejected', 'reconciliation_required') then
    select payment.order_id
    into v_event_order_id
    from public.payments as payment
    where payment.id = v_event.payment_id;

    return query
    select v_event.outcome_code, v_event_order_id, false;
    return;
  end if;

  if p_transaction_id is null
    or p_transaction_id !~ '^[1-9][0-9]{0,19}$'
    or p_reference is null
    or p_reference !~ '^[A-Za-z0-9._=-]{1,100}$'
    or p_status is distinct from 'success'
    or p_amount_kobo is null
    or p_amount_kobo <= 0
    or p_currency is null
    or p_currency !~ '^[A-Z]{3}$'
  then
    update public.payment_events as event
    set processing_state = 'terminal_rejected',
        completed_at = v_now,
        outcome_code = 'INVALID_PROVIDER_PAYLOAD',
        diagnostic_code = 'INVALID_PAYMENT_FACTS'
    where event.id = v_event.id;

    return query
    select 'INVALID_PROVIDER_PAYLOAD'::text, null::uuid, false;
    return;
  end if;

  update public.payment_events as event
  set processing_state = 'processing',
      last_attempted_at = v_now,
      completed_at = null,
      outcome_code = null,
      diagnostic_code = null
  where event.id = v_event.id;

  begin
    insert into public.payments (
      provider,
      environment,
      transaction_id,
      reference,
      status,
      amount_kobo,
      currency,
      paid_at,
      finalization_state,
      created_at,
      updated_at
    ) values (
      'paystack',
      p_environment,
      p_transaction_id,
      p_reference,
      p_status,
      p_amount_kobo,
      p_currency,
      p_paid_at,
      'processing',
      v_now,
      v_now
    )
    on conflict do nothing
    returning id into v_existing_order_payment_id;

    v_payment_was_inserted := found;

    select payment.*
    into v_transaction_payment
    from public.payments as payment
    where payment.provider = 'paystack'
      and payment.environment = p_environment
      and payment.transaction_id = p_transaction_id
    for update;
    v_transaction_payment_found := found;

    select payment.*
    into v_reference_payment
    from public.payments as payment
    where payment.provider = 'paystack'
      and payment.environment = p_environment
      and payment.reference = p_reference
    for update;
    v_reference_payment_found := found;

    if not v_transaction_payment_found and not v_reference_payment_found then
      raise exception 'Ops 2B1 internal payment identity establishment failed.';
    end if;

    if v_transaction_payment_found
      and v_reference_payment_found
      and v_transaction_payment.id <> v_reference_payment.id
    then
      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          diagnostic_code = 'TRANSACTION_REFERENCE_SPLIT'
      where event.id = v_event.id;

      return query
      select 'PAYMENT_IDENTITY_CONFLICT'::text, null::uuid, false;
      return;
    end if;

    if v_transaction_payment_found then
      v_payment := v_transaction_payment;
    else
      v_payment := v_reference_payment;
    end if;

    if v_payment.transaction_id is distinct from p_transaction_id
      or v_payment.reference is distinct from p_reference
      or v_payment.status is distinct from p_status
      or v_payment.amount_kobo is distinct from p_amount_kobo
      or v_payment.currency is distinct from p_currency
      or v_payment.paid_at is distinct from p_paid_at
    then
      if v_payment.finalization_state <> 'completed' then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
            updated_at = v_now
        where payment.id = v_payment.id;
      end if;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          diagnostic_code = 'PAYMENT_FACT_MISMATCH',
          payment_id = v_payment.id
      where event.id = v_event.id;

      return query
      select 'PAYMENT_IDENTITY_CONFLICT'::text, v_payment.order_id, false;
      return;
    end if;

    update public.payment_events as event
    set payment_id = v_payment.id
    where event.id = v_event.id;

    if v_payment.finalization_state = 'completed' then
      select customer_order.*
      into v_order
      from public.orders as customer_order
      where customer_order.id = v_payment.order_id
      for update;

      if found
        and v_order.payment_ref = p_reference
        and v_order.status in ('confirmed', 'fulfilled')
        and v_order.payment_finalized_at is not null
      then
        update public.payment_events as event
        set processing_state = 'completed',
            completed_at = v_now,
            outcome_code = 'ALREADY_FINALIZED',
            diagnostic_code = null
        where event.id = v_event.id;

        return query
        select 'ALREADY_FINALIZED'::text, v_order.id, false;
        return;
      end if;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'COMPLETED_PAYMENT_STATE_MISMATCH'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_payment.order_id, false;
      return;
    end if;

    if v_payment.finalization_state in ('terminal_rejected', 'reconciliation_required') then
      update public.payment_events as event
      set processing_state = v_payment.finalization_state,
          completed_at = v_now,
          outcome_code = v_payment.outcome_code,
          diagnostic_code = 'PAYMENT_STATE_ALREADY_CLOSED'
      where event.id = v_event.id;

      return query
      select v_payment.outcome_code, v_payment.order_id, false;
      return;
    end if;

    update public.payments as payment
    set finalization_state = 'processing',
        outcome_code = null,
        updated_at = v_now
    where payment.id = v_payment.id;

    if p_currency <> 'NGN' then
      update public.payments as payment
      set finalization_state = 'terminal_rejected',
          outcome_code = 'CURRENCY_MISMATCH',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'terminal_rejected',
          completed_at = v_now,
          outcome_code = 'CURRENCY_MISMATCH',
          diagnostic_code = 'UNSUPPORTED_PAYMENT_CURRENCY'
      where event.id = v_event.id;

      return query
      select 'CURRENCY_MISMATCH'::text, null::uuid, false;
      return;
    end if;

    select customer_order.*
    into v_order
    from public.orders as customer_order
    where customer_order.payment_ref = p_reference
    for update;

    if not found then
      update public.payments as payment
      set finalization_state = 'retryable_failure',
          outcome_code = 'ORDER_NOT_FOUND_RETRYABLE',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'retryable_failure',
          completed_at = null,
          outcome_code = 'ORDER_NOT_FOUND_RETRYABLE',
          diagnostic_code = 'ORDER_REFERENCE_NOT_YET_VISIBLE'
      where event.id = v_event.id;

      return query
      select 'ORDER_NOT_FOUND_RETRYABLE'::text, null::uuid, true;
      return;
    end if;

    select payment.id
    into v_existing_order_payment_id
    from public.payments as payment
    where payment.order_id = v_order.id
      and payment.id <> v_payment.id
    for update;

    if found then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'PAYMENT_IDENTITY_CONFLICT',
          diagnostic_code = 'ORDER_HAS_DIFFERENT_PAYMENT'
      where event.id = v_event.id;

      return query
      select 'PAYMENT_IDENTITY_CONFLICT'::text, v_order.id, false;
      return;
    end if;

    update public.payments as payment
    set order_id = v_order.id,
        updated_at = v_now
    where payment.id = v_payment.id;

    if v_order.status = 'cancelled' then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'PAID_CANCELLED_ORDER'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if v_order.status in ('confirmed', 'fulfilled') then
      if v_order.financial_contract_version is null
        and v_payment_was_inserted
      then
        update public.payment_events as event
        set payment_id = null
        where event.id = v_event.id;

        delete from public.payments as payment
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'completed',
            completed_at = v_now,
            outcome_code = 'LEGACY_ALREADY_FINALIZED',
            diagnostic_code = null
        where event.id = v_event.id;

        return query
        select 'LEGACY_ALREADY_FINALIZED'::text, v_order.id, false;
        return;
      end if;

      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'UNPROVEN_EXISTING_FINALIZATION'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if v_order.status <> 'pending' then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'UNKNOWN_ORDER_STATE'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if exists (
      select 1
      from public.payout_ledger as ledger
      where ledger.order_id = v_order.id
        and ledger.type = 'credit'
    ) then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'CREDIT_CONFLICT',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'CREDIT_CONFLICT',
          diagnostic_code = 'PENDING_ORDER_HAS_CREDIT'
      where event.id = v_event.id;

      return query
      select 'CREDIT_CONFLICT'::text, v_order.id, false;
      return;
    end if;

    if v_order.financial_contract_version = 2 then
      if v_order.currency is distinct from 'NGN'
        or v_order.total_amount_kobo is null
        or v_order.total_amount_kobo <= 0
        or v_order.total_amount * 100 <> v_order.total_amount_kobo::numeric
      then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'RECONCILIATION_REQUIRED',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'RECONCILIATION_REQUIRED',
            diagnostic_code = 'INVALID_V2_ORDER_SNAPSHOT'
        where event.id = v_event.id;

        return query
        select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
        return;
      end if;

      select
        pg_catalog.count(*),
        coalesce(pg_catalog.sum(item.gross_amount_kobo), 0)::bigint,
        coalesce(pg_catalog.bool_and(
          item.financial_contract_version = 2
          and item.currency = 'NGN'
          and item.vendor_id is not null
          and item.unit_amount_kobo > 0
          and item.gross_amount_kobo > 0
          and item.platform_fee_bps between 0 and 10000
          and item.platform_fee_amount_kobo >= 0
          and item.vendor_net_amount_kobo >= 0
          and item.gross_amount_kobo = item.unit_amount_kobo * item.quantity::bigint
          and item.gross_amount_kobo = item.platform_fee_amount_kobo + item.vendor_net_amount_kobo
        ), false)
      into v_item_count, v_item_total_kobo, v_items_valid
      from public.order_items as item
      where item.order_id = v_order.id;

      if v_item_count = 0
        or not v_items_valid
        or v_item_total_kobo <> v_order.total_amount_kobo
      then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'RECONCILIATION_REQUIRED',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'RECONCILIATION_REQUIRED',
            diagnostic_code = 'INVALID_V2_ITEM_SNAPSHOT'
        where event.id = v_event.id;

        return query
        select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
        return;
      end if;

      v_contract_version := 2;
    elsif v_order.financial_contract_version is null then
      select
        pg_catalog.count(*),
        coalesce(pg_catalog.sum(item.subtotal), 0),
        coalesce(pg_catalog.bool_and(
          item.vendor_id is not null
          and item.quantity > 0
          and item.unit_price > 0
          and item.subtotal > 0
          and item.unit_price * item.quantity::numeric = item.subtotal
          and item.unit_price * 100 = pg_catalog.trunc(item.unit_price * 100)
          and item.subtotal * 100 = pg_catalog.trunc(item.subtotal * 100)
          and item.financial_contract_version is null
          and item.unit_amount_kobo is null
          and item.gross_amount_kobo is null
          and item.platform_fee_bps is null
          and item.platform_fee_amount_kobo is null
          and item.vendor_net_amount_kobo is null
          and item.currency is null
        ), false)
      into v_item_count, v_item_total, v_items_valid
      from public.order_items as item
      where item.order_id = v_order.id;

      if v_item_count = 0
        or not v_items_valid
        or v_order.total_amount <= 0
        or v_order.total_amount * 100 <> pg_catalog.trunc(v_order.total_amount * 100)
        or v_item_total <> v_order.total_amount
      then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            diagnostic_code = 'INVALID_LEGACY_FINANCIAL_FACTS'
        where event.id = v_event.id;

        return query
        select 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION'::text, v_order.id, false;
        return;
      end if;

      perform vendor.id
      from public.vendors as vendor
      where vendor.id in (
        select item.vendor_id
        from public.order_items as item
        where item.order_id = v_order.id
      )
      order by vendor.id
      for update;

      select
        pg_catalog.count(distinct item.vendor_id),
        pg_catalog.count(distinct item.vendor_id) filter (
          where vendor.id is not null
            and vendor.platform_fee_pct is not null
            and vendor.platform_fee_pct between 0 and 100
            and vendor.platform_fee_pct * 100 = pg_catalog.trunc(vendor.platform_fee_pct * 100)
        )
      into v_vendor_count, v_valid_vendor_count
      from public.order_items as item
      left join public.vendors as vendor on vendor.id = item.vendor_id
      where item.order_id = v_order.id;

      if v_vendor_count = 0 or v_valid_vendor_count <> v_vendor_count then
        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION',
            diagnostic_code = 'LEGACY_VENDOR_FEE_UNAVAILABLE'
        where event.id = v_event.id;

        return query
        select 'LEGACY_FINALIZATION_REQUIRES_RECONCILIATION'::text, v_order.id, false;
        return;
      end if;

      v_contract_version := 1;
    else
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = 'UNSUPPORTED_FINANCIAL_CONTRACT'
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;

    if (
      case
        when v_contract_version = 2 then v_order.total_amount_kobo
        else (v_order.total_amount * 100)::bigint
      end
    ) <> p_amount_kobo then
      update public.payments as payment
      set finalization_state = 'terminal_rejected',
          outcome_code = 'AMOUNT_MISMATCH',
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'terminal_rejected',
          completed_at = v_now,
          outcome_code = 'AMOUNT_MISMATCH',
          diagnostic_code = 'PROVIDER_ORDER_AMOUNT_MISMATCH'
      where event.id = v_event.id;

      return query
      select 'AMOUNT_MISMATCH'::text, v_order.id, false;
      return;
    end if;

    begin
      if v_contract_version = 1 then
        update public.order_items as item
        set unit_amount_kobo = (item.unit_price * 100)::bigint,
            gross_amount_kobo = (item.subtotal * 100)::bigint,
            platform_fee_bps = (vendor.platform_fee_pct * 100)::integer,
            platform_fee_amount_kobo = pg_catalog.round(
              (item.subtotal * 100)
              * (vendor.platform_fee_pct * 100)
              / 10000
            )::bigint,
            vendor_net_amount_kobo = (item.subtotal * 100)::bigint
              - pg_catalog.round(
                  (item.subtotal * 100)
                  * (vendor.platform_fee_pct * 100)
                  / 10000
                )::bigint,
            currency = 'NGN',
            financial_contract_version = 1
        from public.vendors as vendor
        where item.order_id = v_order.id
          and vendor.id = item.vendor_id;

        get diagnostics v_updated_rows = row_count;
        if v_updated_rows <> v_item_count then
          raise exception 'Ops 2B1 legacy item snapshot update count changed.';
        end if;

        update public.orders as customer_order
        set total_amount_kobo = (customer_order.total_amount * 100)::bigint,
            currency = 'NGN',
            financial_contract_version = 1
        where customer_order.id = v_order.id
          and customer_order.status = 'pending'
          and customer_order.financial_contract_version is null;

        get diagnostics v_updated_rows = row_count;
        if v_updated_rows <> 1 then
          raise exception 'Ops 2B1 legacy order snapshot transition lost its guard.';
        end if;
      end if;

      for v_credit in
        select
          item.vendor_id,
          pg_catalog.sum(item.gross_amount_kobo)::bigint as gross_kobo,
          pg_catalog.sum(item.platform_fee_amount_kobo)::bigint as fee_kobo,
          pg_catalog.sum(item.vendor_net_amount_kobo)::bigint as net_kobo
        from public.order_items as item
        where item.order_id = v_order.id
        group by item.vendor_id
        order by item.vendor_id
      loop
        insert into public.payout_ledger (
          vendor_id,
          order_id,
          amount,
          type,
          reference,
          description,
          source_kind,
          idempotency_key,
          gross_amount_kobo,
          platform_fee_amount_kobo,
          net_amount_kobo,
          currency,
          financial_contract_version
        ) values (
          v_credit.vendor_id,
          v_order.id,
          v_credit.net_kobo::numeric / 100,
          'credit',
          p_reference,
          'Sale credit for order ' || v_order.id::text,
          'sale',
          'sale:' || v_order.id::text || ':' || v_credit.vendor_id::text,
          v_credit.gross_kobo,
          v_credit.fee_kobo,
          v_credit.net_kobo,
          'NGN',
          v_contract_version
        );
      end loop;

      update public.orders as customer_order
      set status = 'confirmed',
          payment_finalized_at = v_now,
          updated_at = v_now
      where customer_order.id = v_order.id
        and customer_order.status = 'pending';

      get diagnostics v_updated_rows = row_count;
      if v_updated_rows <> 1 then
        raise exception 'Ops 2B1 guarded order confirmation did not update exactly one row.';
      end if;

      update public.payments as payment
      set order_id = v_order.id,
          financial_contract_version = v_contract_version,
          finalization_state = 'completed',
          outcome_code = 'FINALIZED',
          updated_at = v_now,
          finalized_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'completed',
          completed_at = v_now,
          outcome_code = 'FINALIZED',
          diagnostic_code = null,
          payment_id = v_payment.id
      where event.id = v_event.id;

      insert into public.outbox_events (
        event_type,
        event_version,
        order_id,
        idempotency_key
      ) values (
        'paid_order',
        1,
        v_order.id,
        'paid-order:' || v_order.id::text
      );
    exception
      when unique_violation then
        get stacked diagnostics
          v_constraint_name = constraint_name;

        if v_constraint_name in (
          'outbox_events_idempotency_key_key',
          'outbox_events_event_type_order_id_key'
        ) then
          update public.payments as payment
          set finalization_state = 'reconciliation_required',
              outcome_code = 'RECONCILIATION_REQUIRED',
              updated_at = v_now
          where payment.id = v_payment.id;

          update public.payment_events as event
          set processing_state = 'reconciliation_required',
              completed_at = v_now,
              outcome_code = 'RECONCILIATION_REQUIRED',
              diagnostic_code = 'OUTBOX_INTENT_CONFLICT',
              payment_id = v_payment.id
          where event.id = v_event.id;

          return query
          select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
          return;
        end if;

        update public.payments as payment
        set finalization_state = 'reconciliation_required',
            outcome_code = 'CREDIT_CONFLICT',
            updated_at = v_now
        where payment.id = v_payment.id;

        update public.payment_events as event
        set processing_state = 'reconciliation_required',
            completed_at = v_now,
            outcome_code = 'CREDIT_CONFLICT',
            diagnostic_code = 'SALE_CREDIT_UNIQUE_CONFLICT',
            payment_id = v_payment.id
        where event.id = v_event.id;

        return query
        select 'CREDIT_CONFLICT'::text, v_order.id, false;
        return;
    end;

    return query
    select 'FINALIZED'::text, v_order.id, false;
    return;
  exception
    when others then
      update public.payment_events as event
      set processing_state = 'retryable_failure',
          completed_at = null,
          outcome_code = 'RETRYABLE_FAILURE',
          diagnostic_code = 'UNEXPECTED_DATABASE_FAILURE',
          last_attempted_at = pg_catalog.now()
      where event.id = v_event.id;

      return query
      select 'RETRYABLE_FAILURE'::text, null::uuid, true;
      return;
  end;
end
$function$;
-- OPS_3B2_RPC_END

alter function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) owner to postgres;

revoke all privileges on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) to service_role;

-- OPS_3B2_POSTCONDITION_START
do $postcondition$
declare
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  function_definition text;
  insert_token constant text := 'insert into public.outbox_events';
  insert_position integer;
  producer_count bigint;
  actual_constraints text[];
  actual_indexes text[];
begin
  if rpc_oid is null
    or (select procedure.proowner from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid)
      <> 'postgres'::pg_catalog.regrole
    or (select procedure.prosecdef from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid)
    or (select procedure.provolatile from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid) <> 'v'
    or (select procedure.proconfig from pg_catalog.pg_proc as procedure
        where procedure.oid = rpc_oid)
      is distinct from array['search_path=""']::text[]
    or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', rpc_oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', rpc_oid, 'EXECUTE'
    )
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) as acl
      where procedure.oid = rpc_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  then
    raise exception 'Ops 3B2 postcondition: finalization RPC authority changed.';
  end if;

  function_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(rpc_oid)
  );
  insert_position := position(insert_token in function_definition);

  if insert_position = 0
    or (
      pg_catalog.length(function_definition)
      - pg_catalog.length(
          pg_catalog.replace(function_definition, insert_token, '')
        )
    ) / pg_catalog.length(insert_token) <> 1
    or function_definition !~ (
      'insert into public[.]outbox_events[[:space:]]*[(]'
      || '[[:space:]]*event_type[[:space:]]*,'
      || '[[:space:]]*event_version[[:space:]]*,'
      || '[[:space:]]*order_id[[:space:]]*,'
      || '[[:space:]]*idempotency_key[[:space:]]*[)]'
      || '[[:space:]]*values[[:space:]]*[(]'
      || '[[:space:]]*''paid_order''[[:space:]]*,'
      || '[[:space:]]*1[[:space:]]*,'
      || '[[:space:]]*v_order[.]id[[:space:]]*,'
      || '[[:space:]]*''paid-order:''[[:space:]]*[|][|]'
      || '[[:space:]]*v_order[.]id::text[[:space:]]*[)]'
    )
    or position(
      'on conflict'
      in substring(function_definition from insert_position)
    ) > 0
  then
    raise exception 'Ops 3B2 postcondition: paid-order outbox producer is incorrect.';
  end if;

  if position(
      'insert into public.payout_ledger' in function_definition
    ) = 0
    or position(
      'insert into public.payout_ledger' in function_definition
    ) >= insert_position
    or position(
      'set status = ''confirmed''' in function_definition
    ) = 0
    or position(
      'set status = ''confirmed''' in function_definition
    ) >= insert_position
    or position(
      'get stacked diagnostics' in function_definition
    ) <= insert_position
    or position(
      'v_constraint_name = constraint_name' in function_definition
    ) <= insert_position
    or position(
      '''outbox_events_idempotency_key_key''' in function_definition
    ) <= insert_position
    or position(
      '''outbox_events_event_type_order_id_key''' in function_definition
    ) <= insert_position
    or position(
      '''outbox_intent_conflict''' in function_definition
    ) <= insert_position
    or position(
      '''sale_credit_unique_conflict''' in function_definition
    ) <= insert_position
  then
    raise exception 'Ops 3B2 postcondition: atomic conflict handling is incorrect.';
  end if;

  select pg_catalog.count(*)
  into producer_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prokind = 'f'
    and pg_catalog.lower(
      pg_catalog.pg_get_functiondef(procedure.oid)
    ) like '%insert into public.outbox_events%';

  if producer_count <> 1 then
    raise exception 'Ops 3B2 postcondition: finalization RPC is not the sole database producer.';
  end if;

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
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'outbox_events'
    )
    or (select pg_catalog.count(*) from public.outbox_events) <> 0
    or not pg_catalog.has_table_privilege(
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
    or not exists (
      select 1
      from pg_catalog.pg_roles as role_record
      where role_record.rolname = 'service_role'
        and role_record.rolbypassrls
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
      cross join lateral pg_catalog.aclexplode(
        coalesce(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) as acl
      where class.oid = 'public.outbox_events'::pg_catalog.regclass
        and acl.grantee = 0
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    )
  then
    raise exception 'Ops 3B2 postcondition: paid-order outbox foundation changed.';
  end if;

  select pg_catalog.array_agg(
    constraint_record.conname::text
    order by constraint_record.conname
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
    raise exception 'Ops 3B2 postcondition: paid-order outbox constraint set changed.';
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
    raise exception 'Ops 3B2 postcondition: paid-order outbox index set changed.';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_event_type_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (event_type = ''paid_order''::text)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_event_version_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (event_version = 1)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_idempotency_key_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (idempotency_key = (''paid-order:''::text || order_id::text))'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_attempt_count_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (attempt_count >= 0 AND attempt_count <= 12)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_order_id_fkey'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.outbox_events'::pg_catalog.regclass
        and constraint_record.conname = 'outbox_events_state_tuple_check'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''pending''%attempt_count >= 0%attempt_count <= 11%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''processing''%attempt_count >= 1%attempt_count <= 12%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''delivered''%attempt_count >= 1%attempt_count <= 12%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) ilike
          '%status = ''dead_letter''%attempt_count = 12%'
    )
  then
    raise exception 'Ops 3B2 postcondition: paid-order outbox constraints changed.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_extension as extension
    where extension.extname in ('pg_cron', 'pg_net')
  ) then
    raise exception 'Ops 3B2 postcondition: prohibited scheduler/network extension is installed.';
  end if;
end
$postcondition$;
-- OPS_3B2_POSTCONDITION_END

commit;
