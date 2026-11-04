-- Product Variants Batch 2C-C3: variant-aware atomic paid-order stock finalization.
-- This migration adds dormant finalizer support; it does not enable variant purchasing.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- C3_PREFLIGHT_START
do $preflight$
declare
  finalizer_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  guard_oid oid := pg_catalog.to_regprocedure(
    'public.guard_foundation_order_item_variant()'
  );
  decrement_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
  validator_oid oid := pg_catalog.to_regprocedure(
    'public.validate_order_item_variant_options_snapshot(jsonb)'
  );
  stock_guard_oid oid := pg_catalog.to_regprocedure(
    'public.enforce_product_variant_foundation()'
  );
begin
  if finalizer_oid is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(finalizer_oid))
      <> '37c763494aed0f4e13daa004b88b6dee'
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language on language.oid = procedure.prolang
      where procedure.oid = finalizer_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proconfig is not distinct from array['search_path=""']::text[]
        and language.lanname = 'plpgsql'
        and pg_catalog.pg_get_function_result(procedure.oid)
          = 'TABLE(outcome text, order_id uuid, retryable boolean)'
    )
    or pg_catalog.has_function_privilege('public', finalizer_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', finalizer_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', finalizer_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', finalizer_oid, 'EXECUTE')
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = finalizer_oid
    ) <> 2
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = finalizer_oid
        and (
          acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            'service_role'::pg_catalog.regrole
          )
        )
    )
  then
    raise exception 'C3 preflight: paid-order finalizer definition or authority changed.';
  end if;

  if decrement_oid is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(decrement_oid))
      <> '0094f1ea6602edbfe18ac8f9619677b8'
    or guard_oid is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(guard_oid))
      <> 'b7ef9997e19e38d33274104723faccee'
    or validator_oid is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(validator_oid))
      <> 'c34ac95900ffa3c7bd2072256a56f203'
    or stock_guard_oid is null
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(stock_guard_oid))
      <> 'ba55da82735b982b5d2f3f5ca04d223c'
  then
    raise exception 'C3 preflight: purchase guard, stock authority, or C2 validator changed.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
        and trigger_record.tgname = 'order_items_foundation_variant_guard'
        and trigger_record.tgfoid = guard_oid
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'O'
    )
    or not exists (
      select 1 from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.product_variants'::pg_catalog.regclass
        and trigger_record.tgname = 'product_variants_foundation_guard'
        and trigger_record.tgfoid = stock_guard_oid
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'O'
    )
  then
    raise exception 'C3 preflight: purchase or variant stock trigger changed.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
        and constraint_record.conname = 'product_variants_id_product_id_vendor_id_key'
        and constraint_record.contype = 'u'
        and constraint_record.convalidated
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'UNIQUE (id, product_id, vendor_id)'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
        and constraint_record.conname = 'order_items_product_variant_product_vendor_fkey'
        and constraint_record.contype = 'f'
        and constraint_record.convalidated
        and constraint_record.confupdtype = 'r'
        and constraint_record.confdeltype = 'r'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'FOREIGN KEY (product_variant_id, product_id, vendor_id) REFERENCES product_variants(id, product_id, vendor_id) ON UPDATE RESTRICT ON DELETE RESTRICT'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.order_items'::pg_catalog.regclass
        and constraint_record.conname = 'order_items_variant_identity_check'
        and constraint_record.contype = 'c'
        and constraint_record.convalidated
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          like '%validate_order_item_variant_options_snapshot(variant_options_snapshot) IS TRUE%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          like '%variant_options_snapshot ->> ''variant_id''::text%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          like '%variant_options_snapshot ->> ''product_id''::text%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          like '%variant_options_snapshot ->> ''vendor_id''::text%'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.product_variant_option_values'::pg_catalog.regclass
        and constraint_record.conname = 'product_variant_option_values_variant_fkey'
        and constraint_record.contype = 'f'
        and constraint_record.convalidated
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'FOREIGN KEY (variant_id, product_id) REFERENCES product_variants(id, product_id) ON UPDATE RESTRICT ON DELETE CASCADE'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.product_variant_combination_identities'::pg_catalog.regclass
        and constraint_record.conname = 'product_variant_combination_identities_product_signature_key'
        and constraint_record.contype = 'u'
        and constraint_record.convalidated
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'UNIQUE (product_id, combination_signature)'
    )
  then
    raise exception 'C3 preflight: B1/B2/C2 relational identity contract changed.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname = 'stock'
        and attribute.atttypid = 'integer'::pg_catalog.regtype
        and attribute.attnotnull
        and not attribute.attisdropped
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.product_variants'::pg_catalog.regclass
        and attribute.attname = 'stock'
        and attribute.atttypid = 'integer'::pg_catalog.regtype
        and attribute.attnotnull
        and not attribute.attisdropped
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.product_variants'::pg_catalog.regclass
        and attribute.attname = 'stock_version'
        and attribute.atttypid = 'bigint'::pg_catalog.regtype
        and attribute.attnotnull
        and not attribute.attisdropped
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = 'public.product_variants'::pg_catalog.regclass
        and constraint_record.conname = 'product_variants_stock_check'
        and constraint_record.contype = 'c'
        and constraint_record.convalidated
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          = 'CHECK (stock >= 0)'
    )
  then
    raise exception 'C3 preflight: ordinary or variant stock schema changed.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_roles as role_record
      where role_record.rolname = 'service_role' and role_record.rolbypassrls
    )
    or not pg_catalog.has_table_privilege('service_role', 'public.products', 'SELECT')
    or pg_catalog.has_table_privilege('service_role', 'public.products', 'UPDATE')
    or not pg_catalog.has_column_privilege(
      'service_role', 'public.products', 'stock', 'UPDATE'
    )
    or not pg_catalog.has_column_privilege(
      'service_role', 'public.products', 'updated_at', 'UPDATE'
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname not in ('stock', 'updated_at')
        and pg_catalog.has_column_privilege(
          'service_role',
          'public.products',
          attribute.attname,
          'UPDATE'
        )
    )
    or not pg_catalog.has_table_privilege('service_role', 'public.product_variants', 'SELECT')
    or pg_catalog.has_table_privilege('service_role', 'public.product_variants', 'UPDATE')
    or pg_catalog.has_any_column_privilege(
      'service_role', 'public.product_variants', 'UPDATE'
    )
    or not pg_catalog.has_table_privilege('service_role', 'public.order_items', 'SELECT')
    or not pg_catalog.has_table_privilege('service_role', 'public.order_items', 'UPDATE')
    or exists (
      select 1
      from pg_catalog.pg_roles as role_record
      where role_record.rolname in ('anon', 'authenticated')
        and (
          pg_catalog.has_table_privilege(
            role_record.rolname, 'public.product_variants', 'UPDATE'
          )
          or pg_catalog.has_any_column_privilege(
            role_record.rolname, 'public.product_variants', 'UPDATE'
          )
        )
    )
    or pg_catalog.has_table_privilege(
      'public', 'public.product_variants', 'UPDATE'
    )
    or pg_catalog.has_any_column_privilege(
      'public', 'public.product_variants', 'UPDATE'
    )
  then
    raise exception 'C3 preflight: service-role inventory authority changed.';
  end if;

  if exists (
      select 1
      from pg_catalog.pg_class as relation
      where relation.oid in (
        'public.products'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass,
        'public.product_variant_option_values'::pg_catalog.regclass,
        'public.product_variant_combination_identities'::pg_catalog.regclass
      )
        and (
          not relation.relrowsecurity
          or relation.relforcerowsecurity
        )
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_class as relation
      where relation.oid in (
        'public.products'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass,
        'public.product_variant_option_values'::pg_catalog.regclass,
        'public.product_variant_combination_identities'::pg_catalog.regclass
      )
    ) <> 5
    or not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.product_variants'::pg_catalog.regclass
        and trigger_record.tgname = 'product_variants_updated_at'
        and trigger_record.tgfoid = 'public.handle_updated_at()'::pg_catalog.regprocedure
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'O'
    )
  then
    raise exception 'C3 preflight: inventory RLS or timestamp trigger changed.';
  end if;

  if pg_catalog.has_table_privilege(
      'public', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'public', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variant_option_values', 'INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variant_combination_identities', 'INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_any_column_privilege(
      'public', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'anon', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'authenticated', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'public', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'anon', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'authenticated', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'service_role', 'public.product_variant_option_values', 'INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'service_role', 'public.product_variant_combination_identities', 'INSERT,UPDATE,REFERENCES'
    )
  then
    raise exception 'C3 preflight: private option identity table authority changed.';
  end if;
end
$preflight$;
-- C3_PREFLIGHT_END

grant update (stock) on table public.product_variants to service_role;
grant select on table public.product_variant_option_values to service_role;
grant select on table public.product_variant_combination_identities to service_role;

-- C3_RPC_START
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
  v_initial_item_count bigint;
  v_initial_product_identity_valid boolean;
  v_initial_quantities_valid boolean;
  v_stock_parent_product_ids uuid[];
  v_stock_parent_product_count bigint;
  v_stock_ordinary_product_ids uuid[];
  v_stock_ordinary_quantities numeric[];
  v_stock_ordinary_count bigint;
  v_stock_variant_ids uuid[];
  v_stock_variant_product_ids uuid[];
  v_stock_variant_vendor_ids uuid[];
  v_stock_variant_quantities numeric[];
  v_stock_variant_count bigint;
  v_rechecked_item_count bigint;
  v_rechecked_product_identity_valid boolean;
  v_rechecked_quantities_valid boolean;
  v_rechecked_parent_product_ids uuid[];
  v_rechecked_parent_product_count bigint;
  v_rechecked_ordinary_product_ids uuid[];
  v_rechecked_ordinary_quantities numeric[];
  v_rechecked_ordinary_count bigint;
  v_rechecked_variant_ids uuid[];
  v_rechecked_variant_product_ids uuid[];
  v_rechecked_variant_vendor_ids uuid[];
  v_rechecked_variant_quantities numeric[];
  v_rechecked_variant_count bigint;
  v_locked_parent_product_count bigint := 0;
  v_locked_variant_count bigint := 0;
  v_updated_ordinary_count integer;
  v_updated_variant_count integer;
  v_ordinary_stock_sufficient boolean;
  v_variant_stock_sufficient boolean;
  v_variant_identity_valid boolean;
  v_stock_diagnostic text;
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

    -- C3_INVENTORY_BOUNDARY_START
    -- Lock order: payment/order rows (above), parent products by UUID,
    -- variants by UUID, then immutable order-item identities by UUID NOWAIT.
    select
      pg_catalog.count(*),
      coalesce(pg_catalog.bool_and(
        item.product_id is not null
        and item.vendor_id is not null
      ), false),
      coalesce(pg_catalog.bool_and(item.quantity > 0), false)
    into
      v_initial_item_count,
      v_initial_product_identity_valid,
      v_initial_quantities_valid
    from public.order_items as item
    where item.order_id = v_order.id;

    if v_initial_item_count = 0 or not v_initial_quantities_valid then
      v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
    elsif not v_initial_product_identity_valid then
      v_stock_diagnostic := 'PAID_STOCK_PRODUCT_UNAVAILABLE';
    else
      select
        coalesce(pg_catalog.array_agg(
          requirement.product_id order by requirement.product_id
        ), array[]::uuid[]),
        pg_catalog.count(*)
      into v_stock_parent_product_ids, v_stock_parent_product_count
      from (
        select distinct item.product_id
        from public.order_items as item
        where item.order_id = v_order.id
      ) as requirement;

      select
        coalesce(pg_catalog.array_agg(
          requirement.product_id order by requirement.product_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.required_quantity order by requirement.product_id
        ), array[]::numeric[]),
        pg_catalog.count(*)
      into
        v_stock_ordinary_product_ids,
        v_stock_ordinary_quantities,
        v_stock_ordinary_count
      from (
        select
          item.product_id,
          pg_catalog.sum(item.quantity::numeric) as required_quantity
        from public.order_items as item
        where item.order_id = v_order.id
          and item.product_variant_id is null
        group by item.product_id
      ) as requirement;

      select
        coalesce(pg_catalog.array_agg(
          requirement.variant_id order by requirement.variant_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.product_id order by requirement.variant_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.vendor_id order by requirement.variant_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.required_quantity order by requirement.variant_id
        ), array[]::numeric[]),
        pg_catalog.count(*)
      into
        v_stock_variant_ids,
        v_stock_variant_product_ids,
        v_stock_variant_vendor_ids,
        v_stock_variant_quantities,
        v_stock_variant_count
      from (
        select
          item.product_variant_id as variant_id,
          item.product_id,
          item.vendor_id,
          pg_catalog.sum(item.quantity::numeric) as required_quantity
        from public.order_items as item
        where item.order_id = v_order.id
          and item.product_variant_id is not null
        group by item.product_variant_id, item.product_id, item.vendor_id
      ) as requirement;

      perform product.id
      from public.products as product
      join pg_catalog.unnest(
        v_stock_parent_product_ids
      ) as requirement(product_id)
        on requirement.product_id = product.id
      order by product.id
      for update of product;

      get diagnostics v_locked_parent_product_count = row_count;

      perform variant.id
      from public.product_variants as variant
      join rows from (
        pg_catalog.unnest(v_stock_variant_ids),
        pg_catalog.unnest(v_stock_variant_product_ids),
        pg_catalog.unnest(v_stock_variant_vendor_ids)
      ) as requirement(variant_id, product_id, vendor_id)
        on variant.id = requirement.variant_id
        and variant.product_id = requirement.product_id
        and variant.vendor_id = requirement.vendor_id
      order by variant.id
      for update of variant;

      get diagnostics v_locked_variant_count = row_count;
    end if;

    perform item.id
    from public.order_items as item
    where item.order_id = v_order.id
    order by item.id
    for update of item nowait;

    select
      pg_catalog.count(*),
      coalesce(pg_catalog.bool_and(
        item.product_id is not null
        and item.vendor_id is not null
      ), false),
      coalesce(pg_catalog.bool_and(item.quantity > 0), false)
    into
      v_rechecked_item_count,
      v_rechecked_product_identity_valid,
      v_rechecked_quantities_valid
    from public.order_items as item
    where item.order_id = v_order.id;

    if v_rechecked_item_count = 0 or not v_rechecked_quantities_valid then
      v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
    elsif not v_rechecked_product_identity_valid then
      v_stock_diagnostic := 'PAID_STOCK_PRODUCT_UNAVAILABLE';
    else
      select
        coalesce(pg_catalog.array_agg(
          requirement.product_id order by requirement.product_id
        ), array[]::uuid[]),
        pg_catalog.count(*)
      into v_rechecked_parent_product_ids, v_rechecked_parent_product_count
      from (
        select distinct item.product_id
        from public.order_items as item
        where item.order_id = v_order.id
      ) as requirement;

      select
        coalesce(pg_catalog.array_agg(
          requirement.product_id order by requirement.product_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.required_quantity order by requirement.product_id
        ), array[]::numeric[]),
        pg_catalog.count(*)
      into
        v_rechecked_ordinary_product_ids,
        v_rechecked_ordinary_quantities,
        v_rechecked_ordinary_count
      from (
        select
          item.product_id,
          pg_catalog.sum(item.quantity::numeric) as required_quantity
        from public.order_items as item
        where item.order_id = v_order.id
          and item.product_variant_id is null
        group by item.product_id
      ) as requirement;

      select
        coalesce(pg_catalog.array_agg(
          requirement.variant_id order by requirement.variant_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.product_id order by requirement.variant_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.vendor_id order by requirement.variant_id
        ), array[]::uuid[]),
        coalesce(pg_catalog.array_agg(
          requirement.required_quantity order by requirement.variant_id
        ), array[]::numeric[]),
        pg_catalog.count(*)
      into
        v_rechecked_variant_ids,
        v_rechecked_variant_product_ids,
        v_rechecked_variant_vendor_ids,
        v_rechecked_variant_quantities,
        v_rechecked_variant_count
      from (
        select
          item.product_variant_id as variant_id,
          item.product_id,
          item.vendor_id,
          pg_catalog.sum(item.quantity::numeric) as required_quantity
        from public.order_items as item
        where item.order_id = v_order.id
          and item.product_variant_id is not null
        group by item.product_variant_id, item.product_id, item.vendor_id
      ) as requirement;

      if v_rechecked_parent_product_ids
          is distinct from v_stock_parent_product_ids
        or v_rechecked_parent_product_count
          is distinct from v_stock_parent_product_count
        or v_rechecked_ordinary_product_ids
          is distinct from v_stock_ordinary_product_ids
        or v_rechecked_ordinary_quantities
          is distinct from v_stock_ordinary_quantities
        or v_rechecked_ordinary_count
          is distinct from v_stock_ordinary_count
        or v_rechecked_variant_ids is distinct from v_stock_variant_ids
        or v_rechecked_variant_product_ids
          is distinct from v_stock_variant_product_ids
        or v_rechecked_variant_vendor_ids
          is distinct from v_stock_variant_vendor_ids
        or v_rechecked_variant_quantities
          is distinct from v_stock_variant_quantities
        or v_rechecked_variant_count is distinct from v_stock_variant_count
        or v_rechecked_item_count is distinct from v_initial_item_count
      then
        v_stock_diagnostic := 'PAID_STOCK_REQUIREMENTS_CHANGED';
      elsif v_locked_parent_product_count <> v_stock_parent_product_count then
        v_stock_diagnostic := 'PAID_STOCK_PRODUCT_UNAVAILABLE';
      elsif v_locked_variant_count <> v_stock_variant_count then
        v_stock_diagnostic := 'PAID_STOCK_VARIANT_UNAVAILABLE';
      elsif exists (
        select 1
        from (
          select required_quantity
          from pg_catalog.unnest(
            v_rechecked_ordinary_quantities
          ) as ordinary(required_quantity)
          union all
          select required_quantity
          from pg_catalog.unnest(
            v_rechecked_variant_quantities
          ) as variant(required_quantity)
        ) as requirement
        where requirement.required_quantity <= 0
          or requirement.required_quantity > 2147483647
      ) then
        v_stock_diagnostic := 'PAID_STOCK_INSUFFICIENT';
      else
        select coalesce(pg_catalog.bool_and(
          product.stock::numeric >= requirement.required_quantity
        ), true)
        into v_ordinary_stock_sufficient
        from rows from (
          pg_catalog.unnest(v_rechecked_ordinary_product_ids),
          pg_catalog.unnest(v_rechecked_ordinary_quantities)
        ) as requirement(product_id, required_quantity)
        join public.products as product
          on product.id = requirement.product_id;

        select coalesce(pg_catalog.bool_and(
          variant.stock::numeric >= requirement.required_quantity
        ), true)
        into v_variant_stock_sufficient
        from rows from (
          pg_catalog.unnest(v_rechecked_variant_ids),
          pg_catalog.unnest(v_rechecked_variant_quantities)
        ) as requirement(variant_id, required_quantity)
        join public.product_variants as variant
          on variant.id = requirement.variant_id;

        select coalesce(pg_catalog.bool_and(
          coalesce(case
            when item.product_variant_id is null then
              item.variant_size_snapshot is null
              and item.variant_colour_snapshot is null
              and item.variant_options_snapshot is null
            when item.variant_options_snapshot is null then
              product.variant_mode in ('size', 'colour', 'size_colour')
              and (
                item.variant_size_snapshot is not null
                or item.variant_colour_snapshot is not null
              )
            when product.variant_mode = 'options' then
              item.variant_size_snapshot is null
              and item.variant_colour_snapshot is null
              and public.validate_order_item_variant_options_snapshot(
                item.variant_options_snapshot
              ) is true
              and item.variant_options_snapshot ->> 'variant_id'
                is not distinct from item.product_variant_id::text
              and item.variant_options_snapshot ->> 'product_id'
                is not distinct from item.product_id::text
              and item.variant_options_snapshot ->> 'vendor_id'
                is not distinct from item.vendor_id::text
              and identity_record.variant_id is not null
              and identity_record.combination_signature is not null
              and item.variant_options_snapshot ->> 'combination_signature'
                is not null
              and identity_record.combination_signature
                is not distinct from
                  item.variant_options_snapshot ->> 'combination_signature'
              and (
                select pg_catalog.count(*)
                from public.product_variant_option_values as assignment
                where assignment.variant_id = item.product_variant_id
                  and assignment.product_id = item.product_id
              ) = pg_catalog.jsonb_array_length(
                item.variant_options_snapshot -> 'options'
              )
              and not exists (
                select 1
                from public.product_variant_option_values as assignment
                where assignment.variant_id = item.product_variant_id
                  and assignment.product_id = item.product_id
                  and not exists (
                    select 1
                    from pg_catalog.jsonb_array_elements(
                      item.variant_options_snapshot -> 'options'
                    ) as snapshot_option(value)
                    where snapshot_option.value ->> 'axis_id'
                        = assignment.axis_id::text
                      and snapshot_option.value ->> 'value_id'
                        = assignment.value_id::text
                  )
              )
            else false
          end, false)
        ), false)
        into v_variant_identity_valid
        from public.order_items as item
        join public.products as product
          on product.id = item.product_id
        left join public.product_variant_combination_identities
          as identity_record
          on identity_record.variant_id = item.product_variant_id
          and identity_record.product_id = item.product_id
        where item.order_id = v_order.id;

        if not v_variant_identity_valid then
          v_stock_diagnostic := 'PAID_STOCK_VARIANT_IDENTITY_MISMATCH';
        elsif not v_ordinary_stock_sufficient
          or not v_variant_stock_sufficient
        then
          v_stock_diagnostic := 'PAID_STOCK_INSUFFICIENT';
        end if;
      end if;
    end if;

    if v_stock_diagnostic is not null then
      update public.payments as payment
      set finalization_state = 'reconciliation_required',
          outcome_code = 'RECONCILIATION_REQUIRED',
          financial_contract_version = null,
          finalized_at = null,
          updated_at = v_now
      where payment.id = v_payment.id;

      update public.payment_events as event
      set processing_state = 'reconciliation_required',
          completed_at = v_now,
          outcome_code = 'RECONCILIATION_REQUIRED',
          diagnostic_code = v_stock_diagnostic,
          payment_id = v_payment.id
      where event.id = v_event.id;

      return query
      select 'RECONCILIATION_REQUIRED'::text, v_order.id, false;
      return;
    end if;
    -- C3_INVENTORY_BOUNDARY_END

    begin
      -- C3_STOCK_SUCCESS_START
      update public.products as product
      set stock = product.stock - requirement.required_quantity::integer,
          updated_at = v_now
      from rows from (
        pg_catalog.unnest(v_rechecked_ordinary_product_ids),
        pg_catalog.unnest(v_rechecked_ordinary_quantities)
      ) as requirement(product_id, required_quantity)
      where product.id = requirement.product_id;

      get diagnostics v_updated_ordinary_count = row_count;
      if v_updated_ordinary_count <> v_rechecked_ordinary_count then
        raise exception 'C3 ordinary stock update count changed after locked validation.';
      end if;

      update public.product_variants as variant
      set stock = variant.stock - requirement.required_quantity::integer
      from rows from (
        pg_catalog.unnest(v_rechecked_variant_ids),
        pg_catalog.unnest(v_rechecked_variant_quantities)
      ) as requirement(variant_id, required_quantity)
      where variant.id = requirement.variant_id;

      get diagnostics v_updated_variant_count = row_count;
      if v_updated_variant_count <> v_rechecked_variant_count then
        raise exception 'C3 variant stock update count changed after locked validation.';
      end if;
      -- Existing product_variants_foundation_guard advances stock_version once
      -- for each variant row whose stock changes; the finalizer never sets it.
      -- C3_STOCK_SUCCESS_END

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
alter function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) owner to postgres;

revoke all privileges on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.finalize_paystack_paid_order(
  text, text, text, text, text, text, bigint, text, timestamptz
) to service_role;
-- C3_RPC_END

-- C3_POSTCONDITION_START
do $postcondition$
declare
  finalizer_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  function_definition text;
  inventory_boundary text;
  inventory_position integer;
  ordinary_update_position integer;
  variant_update_position integer;
  credit_position integer;
begin
  if finalizer_oid is null
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language on language.oid = procedure.prolang
      where procedure.oid = finalizer_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proconfig is not distinct from array['search_path=""']::text[]
        and language.lanname = 'plpgsql'
        and pg_catalog.pg_get_function_result(procedure.oid)
          = 'TABLE(outcome text, order_id uuid, retryable boolean)'
    )
    or pg_catalog.has_function_privilege('public', finalizer_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', finalizer_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', finalizer_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', finalizer_oid, 'EXECUTE')
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = finalizer_oid
    ) <> 2
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = finalizer_oid
        and (
          acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            'service_role'::pg_catalog.regrole
          )
        )
    )
  then
    raise exception 'C3 postcondition: finalizer metadata or execution authority is incorrect.';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(finalizer_oid))
  into function_definition;

  inventory_position := position(
    '-- c3_inventory_boundary_start' in function_definition
  );
  ordinary_update_position := position(
    'update public.products as product' in function_definition
  );
  variant_update_position := position(
    'update public.product_variants as variant' in function_definition
  );
  credit_position := position(
    'insert into public.payout_ledger' in function_definition
  );
  inventory_boundary := substring(
    function_definition from inventory_position for position(
      '-- c3_inventory_boundary_end' in function_definition
    ) - inventory_position
  );

  if inventory_position = 0
    or ordinary_update_position = 0
    or variant_update_position = 0
    or credit_position = 0
    or inventory_position >= ordinary_update_position
    or ordinary_update_position >= variant_update_position
    or variant_update_position >= credit_position
    or function_definition not like '%order by product.id%for update of product%'
    or function_definition not like '%order by variant.id%for update of variant%'
    or function_definition not like '%order by item.id%for update of item nowait%'
    or function_definition like '%pg_advisory%'
    or function_definition not like '%sum(item.quantity::numeric)%'
    or function_definition not like '%required_quantity > 2147483647%'
    or function_definition not like '%paid_stock_variant_unavailable%'
    or function_definition not like '%paid_stock_variant_identity_mismatch%'
    or function_definition not like '%validate_order_item_variant_options_snapshot%'
    or function_definition not like '%product_variant_combination_identities%'
    or function_definition not like '%product_variant_option_values%'
    or function_definition not like '%stock = variant.stock - requirement.required_quantity::integer%'
    or function_definition like '%set stock = variant.stock - requirement.required_quantity::integer,%stock_version%'
    or inventory_boundary like '%product.is_active%'
    or inventory_boundary like '%vendor.is_active%'
  then
    raise exception 'C3 postcondition: inventory derivation, locking, identity, or mutation contract is incorrect.';
  end if;

  if function_definition not like '%event_already_completed%'
    or function_definition not like '%already_finalized%'
    or function_definition not like '%legacy_already_finalized%'
    or function_definition not like '%outbox_events%'
    or function_definition not like '%sale:%'
    or function_definition not like '%when unique_violation then%'
    or function_definition not like '%when others then%retryable_failure%'
  then
    raise exception 'C3 postcondition: payment, credit, outbox, or rollback behavior changed.';
  end if;

  if not pg_catalog.has_table_privilege(
      'service_role', 'public.products', 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.products', 'UPDATE'
    )
    or not pg_catalog.has_column_privilege(
      'service_role', 'public.products', 'stock', 'UPDATE'
    )
    or not pg_catalog.has_column_privilege(
      'service_role', 'public.products', 'updated_at', 'UPDATE'
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname not in ('stock', 'updated_at')
        and pg_catalog.has_column_privilege(
          'service_role',
          'public.products',
          attribute.attname,
          'UPDATE'
        )
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.product_variants', 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variants', 'UPDATE'
    )
    or not pg_catalog.has_column_privilege(
      'service_role', 'public.product_variants', 'stock', 'UPDATE'
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.product_variants'::pg_catalog.regclass
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
    or exists (
      select 1
      from pg_catalog.pg_roles as role_record
      where role_record.rolname in ('anon', 'authenticated')
        and (
          pg_catalog.has_table_privilege(
            role_record.rolname, 'public.product_variants', 'UPDATE'
          )
          or pg_catalog.has_any_column_privilege(
            role_record.rolname, 'public.product_variants', 'UPDATE'
          )
        )
    )
    or pg_catalog.has_table_privilege(
      'public', 'public.product_variants', 'UPDATE'
    )
    or pg_catalog.has_any_column_privilege(
      'public', 'public.product_variants', 'UPDATE'
    )
  then
    raise exception 'C3 postcondition: narrow inventory authority is incorrect.';
  end if;

  if exists (
      select 1
      from pg_catalog.pg_class as relation
      where relation.oid in (
        'public.products'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass,
        'public.product_variant_option_values'::pg_catalog.regclass,
        'public.product_variant_combination_identities'::pg_catalog.regclass
      )
        and (
          not relation.relrowsecurity
          or relation.relforcerowsecurity
        )
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_class as relation
      where relation.oid in (
        'public.products'::pg_catalog.regclass,
        'public.product_variants'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass,
        'public.product_variant_option_values'::pg_catalog.regclass,
        'public.product_variant_combination_identities'::pg_catalog.regclass
      )
    ) <> 5
    or not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.product_variants'::pg_catalog.regclass
        and trigger_record.tgname = 'product_variants_foundation_guard'
        and trigger_record.tgfoid =
          'public.enforce_product_variant_foundation()'::pg_catalog.regprocedure
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'O'
    )
    or not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.product_variants'::pg_catalog.regclass
        and trigger_record.tgname = 'product_variants_updated_at'
        and trigger_record.tgfoid = 'public.handle_updated_at()'::pg_catalog.regprocedure
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'O'
    )
  then
    raise exception 'C3 postcondition: inventory RLS or trigger authority changed.';
  end if;

  if not pg_catalog.has_table_privilege(
      'service_role', 'public.product_variant_option_values', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'service_role', 'public.product_variant_combination_identities', 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variant_option_values', 'INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'public.product_variant_combination_identities', 'INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'public', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'public', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_any_column_privilege(
      'public', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'anon', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'authenticated', 'public.product_variant_option_values', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'public', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'anon', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'authenticated', 'public.product_variant_combination_identities', 'SELECT,INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'service_role', 'public.product_variant_option_values', 'INSERT,UPDATE,REFERENCES'
    )
    or pg_catalog.has_any_column_privilege(
      'service_role', 'public.product_variant_combination_identities', 'INSERT,UPDATE,REFERENCES'
    )
  then
    raise exception 'C3 postcondition: private identity read authority is incorrect.';
  end if;

  if pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
    )) <> 'b7ef9997e19e38d33274104723faccee'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.decrement_stock(uuid,integer)'::pg_catalog.regprocedure
    )) <> '0094f1ea6602edbfe18ac8f9619677b8'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.validate_order_item_variant_options_snapshot(jsonb)'::pg_catalog.regprocedure
    )) <> 'c34ac95900ffa3c7bd2072256a56f203'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(
      'public.enforce_product_variant_foundation()'::pg_catalog.regprocedure
    )) <> 'ba55da82735b982b5d2f3f5ca04d223c'
    or not exists (
      select 1 from pg_catalog.pg_trigger as trigger_record
      where trigger_record.tgrelid = 'public.order_items'::pg_catalog.regclass
        and trigger_record.tgname = 'order_items_foundation_variant_guard'
        and trigger_record.tgfoid =
          'public.guard_foundation_order_item_variant()'::pg_catalog.regprocedure
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'O'
    )
  then
    raise exception 'C3 postcondition: purchase, snapshot, or stock authority changed.';
  end if;
end
$postcondition$;
-- C3_POSTCONDITION_END

commit;
