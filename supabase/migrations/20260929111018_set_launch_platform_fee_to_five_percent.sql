-- Ops 2B2A: set the launch vendor platform fee to five percent.
begin;

set transaction isolation level repeatable read;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

lock table public.vendors in access exclusive mode;

do $schema_preflight$
declare
  decrement_stock_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
  activation_rpc_oid oid := pg_catalog.to_regprocedure(
    'public.activate_vendor_application(uuid,uuid)'
  );
  finalization_rpc_oid oid := pg_catalog.to_regprocedure(
    'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
  );
  relation_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = pg_catalog.to_regclass('public.vendors')
      and class.relkind = 'r'
      and class.relowner = 'postgres'::pg_catalog.regrole
      and class.relrowsecurity
      and not class.relforcerowsecurity
  ) then
    raise exception 'Ops 2B2A: public.vendors ownership or RLS baseline changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'platform_fee_pct'
      and attribute.attnum > 0
      and not attribute.attisdropped
      and not attribute.attnotnull
      and pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) = 'numeric(5,2)'
      and pg_catalog.pg_get_expr(
        default_value.adbin,
        default_value.adrelid
      ) = '10.00'
  ) then
    raise exception 'Ops 2B2A: platform_fee_pct type, nullability, or 10.00 default baseline changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.conname = 'vendors_platform_fee_pct_check'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(
        constraint_record.oid,
        true
      ) = 'CHECK (platform_fee_pct >= 0::numeric AND platform_fee_pct <= 100::numeric)'
  ) then
    raise exception 'Ops 2B2A: platform fee range constraint baseline changed.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'public.vendors'::pg_catalog.regclass
      and not trigger.tgisinternal
  ) <> 1 or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'public.vendors'::pg_catalog.regclass
      and trigger.tgname = 'vendors_updated_at'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgfoid = pg_catalog.to_regprocedure(
        'public.handle_updated_at()'
      )
      and pg_catalog.pg_get_triggerdef(trigger.oid, true) =
        'CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION handle_updated_at()'
  ) then
    raise exception 'Ops 2B2A: vendor updated_at trigger baseline changed.';
  end if;

  if activation_rpc_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid = activation_rpc_oid
      and procedure.proowner = 'postgres'::pg_catalog.regrole
      and procedure.prosecdef
      and procedure.proconfig is not distinct from
        array['search_path=""']::text[]
  ) or pg_catalog.has_function_privilege(
    'anon', activation_rpc_oid, 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', activation_rpc_oid, 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role', activation_rpc_oid, 'EXECUTE'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.vendors', 'is_active', 'UPDATE'
  ) then
    raise exception 'Ops 2B2A: vendor activation authority baseline changed.';
  end if;

  if decrement_stock_oid is not null and (
    not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language
        on language.oid = procedure.prolang
      where procedure.oid = decrement_stock_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.prorettype = 'boolean'::pg_catalog.regtype
        and procedure.proconfig is not distinct from
          array['search_path=""']::text[]
        and language.lanname = 'plpgsql'
        and pg_catalog.md5(pg_catalog.regexp_replace(
          procedure.prosrc,
          '[[:space:]]',
          '',
          'g'
        )) = '69bc5e9b0bd95769525f9816a9791145'
    )
    or pg_catalog.has_function_privilege(
      'public', decrement_stock_oid, 'EXECUTE'
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
  ) then
    raise exception 'Ops 2B2A: Ops 1A decrement_stock containment changed.';
  end if;

  foreach relation_name in array array[
    'public.payments',
    'public.payment_events'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class as class
      where class.oid = pg_catalog.to_regclass(relation_name)
        and class.relkind = 'r'
        and class.relowner = 'postgres'::pg_catalog.regrole
        and class.relrowsecurity
        and not class.relforcerowsecurity
    ) or exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = pg_catalog.split_part(relation_name, '.', 2)
    ) or pg_catalog.has_table_privilege(
      'anon', relation_name, 'SELECT,INSERT,UPDATE,DELETE'
    ) or pg_catalog.has_table_privilege(
      'authenticated', relation_name, 'SELECT,INSERT,UPDATE,DELETE'
    ) or not pg_catalog.has_table_privilege(
      'service_role', relation_name, 'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'Ops 2B2A: Ops 2B1 relation % authority changed.', relation_name;
    end if;
  end loop;

  if finalization_rpc_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_language as language
      on language.oid = procedure.prolang
    where procedure.oid = finalization_rpc_oid
      and procedure.proowner = 'postgres'::pg_catalog.regrole
      and not procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig is not distinct from
        array['search_path=""']::text[]
      and language.lanname = 'plpgsql'
      and pg_catalog.pg_get_function_result(procedure.oid) =
        'TABLE(outcome text, order_id uuid, retryable boolean)'
  ) or pg_catalog.has_function_privilege(
    'anon', finalization_rpc_oid, 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', finalization_rpc_oid, 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role', finalization_rpc_oid, 'EXECUTE'
  ) then
    raise exception 'Ops 2B2A: Ops 2B1 finalization authority changed.';
  end if;
end
$schema_preflight$;

do $data_preflight$
begin
  if exists (
    select 1
    from public.vendors as vendor
    where vendor.platform_fee_pct is null
      or vendor.platform_fee_pct < 0
      or vendor.platform_fee_pct > 100
      or vendor.platform_fee_pct is distinct from 10.00
  ) then
    raise exception 'Ops 2B2A: existing vendor fees no longer match the audited 10.00 launch baseline.';
  end if;

  perform pg_catalog.set_config(
    'marketa_ops2b2a.vendor_count',
    (select pg_catalog.count(*)::text from public.vendors),
    true
  );
end
$data_preflight$;

do $snapshot$
begin
  perform pg_catalog.set_config(
    'marketa_ops2b2a.vendor_non_fee_rows',
    (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        (pg_catalog.to_jsonb(vendor) - 'platform_fee_pct')::text,
        E'\n' order by vendor.id
      ), ''))
      from public.vendors as vendor
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops2b2a.vendor_security',
    (
      select pg_catalog.jsonb_build_object(
        'owner', pg_catalog.pg_get_userbyid(class.relowner),
        'acl', class.relacl,
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(policy)
            order by policy.policyname
          )
          from pg_catalog.pg_policies as policy
          where policy.schemaname = 'public'
            and policy.tablename = 'vendors'
        ), '[]'::pg_catalog.jsonb),
        'triggers', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', trigger.tgname,
            'enabled', trigger.tgenabled,
            'definition', pg_catalog.pg_get_triggerdef(trigger.oid, true)
          ) order by trigger.tgname)
          from pg_catalog.pg_trigger as trigger
          where trigger.tgrelid = class.oid
            and not trigger.tgisinternal
        ), '[]'::pg_catalog.jsonb),
        'non_fee_columns', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(
              attribute.atttypid,
              attribute.atttypmod
            ),
            'not_null', attribute.attnotnull,
            'acl', attribute.attacl,
            'default', pg_catalog.pg_get_expr(
              default_value.adbin,
              default_value.adrelid
            )
          ) order by attribute.attnum)
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_value
            on default_value.adrelid = attribute.attrelid
            and default_value.adnum = attribute.attnum
          where attribute.attrelid = class.oid
            and attribute.attnum > 0
            and not attribute.attisdropped
            and attribute.attname <> 'platform_fee_pct'
        ), '[]'::pg_catalog.jsonb),
        'constraints', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', constraint_record.conname,
            'type', constraint_record.contype,
            'validated', constraint_record.convalidated,
            'definition', pg_catalog.pg_get_constraintdef(
              constraint_record.oid,
              true
            )
          ) order by constraint_record.conname)
          from pg_catalog.pg_constraint as constraint_record
          where constraint_record.conrelid = class.oid
        ), '[]'::pg_catalog.jsonb),
        'indexes', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(index_record)
            order by index_record.indexname
          )
          from pg_catalog.pg_indexes as index_record
          where index_record.schemaname = 'public'
            and index_record.tablename = 'vendors'
        ), '[]'::pg_catalog.jsonb),
        'activation_rpc', (
          select pg_catalog.jsonb_build_object(
            'definition', pg_catalog.pg_get_functiondef(procedure.oid),
            'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
            'acl', procedure.proacl,
            'config', procedure.proconfig,
            'security_definer', procedure.prosecdef,
            'volatility', procedure.provolatile
          )
          from pg_catalog.pg_proc as procedure
          where procedure.oid = pg_catalog.to_regprocedure(
            'public.activate_vendor_application(uuid,uuid)'
          )
        )
      )::text
      from pg_catalog.pg_class as class
      where class.oid = 'public.vendors'::pg_catalog.regclass
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops2b2a.ops1a_state',
    coalesce((
      select pg_catalog.jsonb_build_object(
        'definition', pg_catalog.pg_get_functiondef(procedure.oid),
        'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
        'acl', procedure.proacl,
        'config', procedure.proconfig,
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile
      )::text
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.decrement_stock(uuid,integer)'
      )
    ), 'ABSENT'),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops2b2a.ops2b1_state',
    (
      select pg_catalog.jsonb_build_object(
        'payments', (
          select pg_catalog.jsonb_build_object(
            'owner', pg_catalog.pg_get_userbyid(class.relowner),
            'acl', class.relacl,
            'rls', class.relrowsecurity,
            'force_rls', class.relforcerowsecurity,
            'columns', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'name', attribute.attname,
                'type', pg_catalog.format_type(
                  attribute.atttypid,
                  attribute.atttypmod
                ),
                'not_null', attribute.attnotnull,
                'default', pg_catalog.pg_get_expr(
                  default_value.adbin,
                  default_value.adrelid
                )
              ) order by attribute.attnum)
              from pg_catalog.pg_attribute as attribute
              left join pg_catalog.pg_attrdef as default_value
                on default_value.adrelid = attribute.attrelid
                and default_value.adnum = attribute.attnum
              where attribute.attrelid = class.oid
                and attribute.attnum > 0
                and not attribute.attisdropped
            ), '[]'::pg_catalog.jsonb),
            'constraints', coalesce((
              select pg_catalog.jsonb_agg(
                pg_catalog.pg_get_constraintdef(
                  constraint_record.oid,
                  true
                ) order by constraint_record.conname
              )
              from pg_catalog.pg_constraint as constraint_record
              where constraint_record.conrelid = class.oid
            ), '[]'::pg_catalog.jsonb),
            'indexes', coalesce((
              select pg_catalog.jsonb_agg(
                index_record.indexdef order by index_record.indexname
              )
              from pg_catalog.pg_indexes as index_record
              where index_record.schemaname = 'public'
                and index_record.tablename = 'payments'
            ), '[]'::pg_catalog.jsonb)
          )
          from pg_catalog.pg_class as class
          where class.oid = 'public.payments'::pg_catalog.regclass
        ),
        'payment_events', (
          select pg_catalog.jsonb_build_object(
            'owner', pg_catalog.pg_get_userbyid(class.relowner),
            'acl', class.relacl,
            'rls', class.relrowsecurity,
            'force_rls', class.relforcerowsecurity,
            'columns', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'name', attribute.attname,
                'type', pg_catalog.format_type(
                  attribute.atttypid,
                  attribute.atttypmod
                ),
                'not_null', attribute.attnotnull,
                'default', pg_catalog.pg_get_expr(
                  default_value.adbin,
                  default_value.adrelid
                )
              ) order by attribute.attnum)
              from pg_catalog.pg_attribute as attribute
              left join pg_catalog.pg_attrdef as default_value
                on default_value.adrelid = attribute.attrelid
                and default_value.adnum = attribute.attnum
              where attribute.attrelid = class.oid
                and attribute.attnum > 0
                and not attribute.attisdropped
            ), '[]'::pg_catalog.jsonb),
            'constraints', coalesce((
              select pg_catalog.jsonb_agg(
                pg_catalog.pg_get_constraintdef(
                  constraint_record.oid,
                  true
                ) order by constraint_record.conname
              )
              from pg_catalog.pg_constraint as constraint_record
              where constraint_record.conrelid = class.oid
            ), '[]'::pg_catalog.jsonb),
            'indexes', coalesce((
              select pg_catalog.jsonb_agg(
                index_record.indexdef order by index_record.indexname
              )
              from pg_catalog.pg_indexes as index_record
              where index_record.schemaname = 'public'
                and index_record.tablename = 'payment_events'
            ), '[]'::pg_catalog.jsonb)
          )
          from pg_catalog.pg_class as class
          where class.oid = 'public.payment_events'::pg_catalog.regclass
        ),
        'legacy_relations', (
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', namespace.nspname || '.' || class.relname,
            'owner', pg_catalog.pg_get_userbyid(class.relowner),
            'acl', class.relacl,
            'rls', class.relrowsecurity,
            'force_rls', class.relforcerowsecurity,
            'columns', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'name', attribute.attname,
                'type', pg_catalog.format_type(
                  attribute.atttypid,
                  attribute.atttypmod
                ),
                'not_null', attribute.attnotnull,
                'acl', attribute.attacl,
                'default', pg_catalog.pg_get_expr(
                  default_value.adbin,
                  default_value.adrelid
                )
              ) order by attribute.attnum)
              from pg_catalog.pg_attribute as attribute
              left join pg_catalog.pg_attrdef as default_value
                on default_value.adrelid = attribute.attrelid
                and default_value.adnum = attribute.attnum
              where attribute.attrelid = class.oid
                and attribute.attnum > 0
                and not attribute.attisdropped
            ), '[]'::pg_catalog.jsonb),
            'constraints', coalesce((
              select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'name', constraint_record.conname,
                'validated', constraint_record.convalidated,
                'definition', pg_catalog.pg_get_constraintdef(
                  constraint_record.oid,
                  true
                )
              ) order by constraint_record.conname)
              from pg_catalog.pg_constraint as constraint_record
              where constraint_record.conrelid = class.oid
            ), '[]'::pg_catalog.jsonb),
            'indexes', coalesce((
              select pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(index_record)
                order by index_record.indexname
              )
              from pg_catalog.pg_indexes as index_record
              where index_record.schemaname = namespace.nspname
                and index_record.tablename = class.relname
            ), '[]'::pg_catalog.jsonb),
            'policies', coalesce((
              select pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(policy)
                order by policy.policyname
              )
              from pg_catalog.pg_policies as policy
              where policy.schemaname = namespace.nspname
                and policy.tablename = class.relname
            ), '[]'::pg_catalog.jsonb)
          ) order by namespace.nspname, class.relname)
          from pg_catalog.pg_class as class
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = class.relnamespace
          where class.oid in (
            'public.orders'::pg_catalog.regclass,
            'public.order_items'::pg_catalog.regclass,
            'public.payout_ledger'::pg_catalog.regclass,
            'public.events_ledger'::pg_catalog.regclass
          )
        ),
        'finalization_rpc', (
          select pg_catalog.jsonb_build_object(
            'definition', pg_catalog.pg_get_functiondef(procedure.oid),
            'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
            'acl', procedure.proacl,
            'config', procedure.proconfig,
            'security_definer', procedure.prosecdef,
            'volatility', procedure.provolatile
          )
          from pg_catalog.pg_proc as procedure
          where procedure.oid = pg_catalog.to_regprocedure(
            'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
          )
        )
      )::text
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops2b2a.protected_rows',
    (
      select pg_catalog.jsonb_build_object(
        'orders', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.orders as row_record
        ),
        'order_items', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.order_items as row_record
        ),
        'payments', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.payments as row_record
        ),
        'payment_events', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.payment_events as row_record
        ),
        'payout_ledger', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.payout_ledger as row_record
        ),
        'events_ledger', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.events_ledger as row_record
        ),
        'products', (
          select pg_catalog.md5(coalesce(pg_catalog.string_agg(
            pg_catalog.to_jsonb(row_record)::text,
            E'\n' order by row_record.id
          ), '')) from public.products as row_record
        )
      )::text
    ),
    true
  );
end
$snapshot$;

alter table public.vendors disable trigger vendors_updated_at;

alter table public.vendors
  alter column platform_fee_pct set default 5.00;

update public.vendors as vendor
set platform_fee_pct = 5.00
where vendor.platform_fee_pct = 10.00;

alter table public.vendors enable trigger vendors_updated_at;

do $postcondition$
declare
  vendor_security text;
  ops1a_state text;
  ops2b1_state text;
  protected_rows text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'platform_fee_pct'
      and attribute.attnum > 0
      and not attribute.attisdropped
      and not attribute.attnotnull
      and pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) = 'numeric(5,2)'
      and pg_catalog.pg_get_expr(
        default_value.adbin,
        default_value.adrelid
      ) = '5.00'
  ) then
    raise exception 'Ops 2B2A postcondition: platform_fee_pct default is not 5.00.';
  end if;

  if exists (
    select 1
    from public.vendors as vendor
    where vendor.platform_fee_pct is distinct from 5.00
  ) then
    raise exception 'Ops 2B2A postcondition: an audited vendor fee is not 5.00.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.vendors'::pg_catalog.regclass
      and constraint_record.conname = 'vendors_platform_fee_pct_check'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and pg_catalog.pg_get_constraintdef(
        constraint_record.oid,
        true
      ) = 'CHECK (platform_fee_pct >= 0::numeric AND platform_fee_pct <= 100::numeric)'
  ) then
    raise exception 'Ops 2B2A postcondition: platform fee range constraint changed.';
  end if;

  if (select pg_catalog.count(*)::text from public.vendors)
      is distinct from pg_catalog.current_setting(
        'marketa_ops2b2a.vendor_count'
      ) then
    raise exception 'Ops 2B2A postcondition: vendor row count changed.';
  end if;

  if (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      (pg_catalog.to_jsonb(vendor) - 'platform_fee_pct')::text,
      E'\n' order by vendor.id
    ), ''))
    from public.vendors as vendor
  ) is distinct from pg_catalog.current_setting(
    'marketa_ops2b2a.vendor_non_fee_rows'
  ) then
    raise exception 'Ops 2B2A postcondition: a non-fee vendor field changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(class.relowner),
    'acl', class.relacl,
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy)
        order by policy.policyname
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'vendors'
    ), '[]'::pg_catalog.jsonb),
    'triggers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', trigger.tgname,
        'enabled', trigger.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(trigger.oid, true)
      ) order by trigger.tgname)
      from pg_catalog.pg_trigger as trigger
      where trigger.tgrelid = class.oid
        and not trigger.tgisinternal
    ), '[]'::pg_catalog.jsonb),
    'non_fee_columns', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', attribute.attname,
        'type', pg_catalog.format_type(
          attribute.atttypid,
          attribute.atttypmod
        ),
        'not_null', attribute.attnotnull,
        'acl', attribute.attacl,
        'default', pg_catalog.pg_get_expr(
          default_value.adbin,
          default_value.adrelid
        )
      ) order by attribute.attnum)
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = class.oid
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attname <> 'platform_fee_pct'
    ), '[]'::pg_catalog.jsonb),
    'constraints', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', constraint_record.conname,
        'type', constraint_record.contype,
        'validated', constraint_record.convalidated,
        'definition', pg_catalog.pg_get_constraintdef(
          constraint_record.oid,
          true
        )
      ) order by constraint_record.conname)
      from pg_catalog.pg_constraint as constraint_record
      where constraint_record.conrelid = class.oid
    ), '[]'::pg_catalog.jsonb),
    'indexes', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(index_record)
        order by index_record.indexname
      )
      from pg_catalog.pg_indexes as index_record
      where index_record.schemaname = 'public'
        and index_record.tablename = 'vendors'
    ), '[]'::pg_catalog.jsonb),
    'activation_rpc', (
      select pg_catalog.jsonb_build_object(
        'definition', pg_catalog.pg_get_functiondef(procedure.oid),
        'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
        'acl', procedure.proacl,
        'config', procedure.proconfig,
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile
      )
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.activate_vendor_application(uuid,uuid)'
      )
    )
  )::text
  into vendor_security
  from pg_catalog.pg_class as class
  where class.oid = 'public.vendors'::pg_catalog.regclass;

  if vendor_security is distinct from pg_catalog.current_setting(
    'marketa_ops2b2a.vendor_security'
  ) then
    raise exception 'Ops 2B2A postcondition: vendor ownership, RLS, policies, fields, trigger, indexes, or activation authority changed.';
  end if;

  if pg_catalog.has_column_privilege(
    'authenticated', 'public.vendors', 'is_active', 'UPDATE'
  ) then
    raise exception 'Ops 2B2A postcondition: authenticated can update vendors.is_active.';
  end if;

  select coalesce((
    select pg_catalog.jsonb_build_object(
      'definition', pg_catalog.pg_get_functiondef(procedure.oid),
      'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
      'acl', procedure.proacl,
      'config', procedure.proconfig,
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile
    )::text
    from pg_catalog.pg_proc as procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.decrement_stock(uuid,integer)'
    )
  ), 'ABSENT')
  into ops1a_state;

  if ops1a_state is distinct from pg_catalog.current_setting(
    'marketa_ops2b2a.ops1a_state'
  ) then
    raise exception 'Ops 2B2A postcondition: Ops 1A containment changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'payments', (
      select pg_catalog.jsonb_build_object(
        'owner', pg_catalog.pg_get_userbyid(class.relowner),
        'acl', class.relacl,
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'columns', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(
              attribute.atttypid,
              attribute.atttypmod
            ),
            'not_null', attribute.attnotnull,
            'default', pg_catalog.pg_get_expr(
              default_value.adbin,
              default_value.adrelid
            )
          ) order by attribute.attnum)
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_value
            on default_value.adrelid = attribute.attrelid
            and default_value.adnum = attribute.attnum
          where attribute.attrelid = class.oid
            and attribute.attnum > 0
            and not attribute.attisdropped
        ), '[]'::pg_catalog.jsonb),
        'constraints', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.pg_get_constraintdef(
              constraint_record.oid,
              true
            ) order by constraint_record.conname
          )
          from pg_catalog.pg_constraint as constraint_record
          where constraint_record.conrelid = class.oid
        ), '[]'::pg_catalog.jsonb),
        'indexes', coalesce((
          select pg_catalog.jsonb_agg(
            index_record.indexdef order by index_record.indexname
          )
          from pg_catalog.pg_indexes as index_record
          where index_record.schemaname = 'public'
            and index_record.tablename = 'payments'
        ), '[]'::pg_catalog.jsonb)
      )
      from pg_catalog.pg_class as class
      where class.oid = 'public.payments'::pg_catalog.regclass
    ),
    'payment_events', (
      select pg_catalog.jsonb_build_object(
        'owner', pg_catalog.pg_get_userbyid(class.relowner),
        'acl', class.relacl,
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'columns', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(
              attribute.atttypid,
              attribute.atttypmod
            ),
            'not_null', attribute.attnotnull,
            'default', pg_catalog.pg_get_expr(
              default_value.adbin,
              default_value.adrelid
            )
          ) order by attribute.attnum)
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_value
            on default_value.adrelid = attribute.attrelid
            and default_value.adnum = attribute.attnum
          where attribute.attrelid = class.oid
            and attribute.attnum > 0
            and not attribute.attisdropped
        ), '[]'::pg_catalog.jsonb),
        'constraints', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.pg_get_constraintdef(
              constraint_record.oid,
              true
            ) order by constraint_record.conname
          )
          from pg_catalog.pg_constraint as constraint_record
          where constraint_record.conrelid = class.oid
        ), '[]'::pg_catalog.jsonb),
        'indexes', coalesce((
          select pg_catalog.jsonb_agg(
            index_record.indexdef order by index_record.indexname
          )
          from pg_catalog.pg_indexes as index_record
          where index_record.schemaname = 'public'
            and index_record.tablename = 'payment_events'
        ), '[]'::pg_catalog.jsonb)
      )
      from pg_catalog.pg_class as class
      where class.oid = 'public.payment_events'::pg_catalog.regclass
    ),
    'legacy_relations', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', namespace.nspname || '.' || class.relname,
        'owner', pg_catalog.pg_get_userbyid(class.relowner),
        'acl', class.relacl,
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'columns', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(
              attribute.atttypid,
              attribute.atttypmod
            ),
            'not_null', attribute.attnotnull,
            'acl', attribute.attacl,
            'default', pg_catalog.pg_get_expr(
              default_value.adbin,
              default_value.adrelid
            )
          ) order by attribute.attnum)
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_value
            on default_value.adrelid = attribute.attrelid
            and default_value.adnum = attribute.attnum
          where attribute.attrelid = class.oid
            and attribute.attnum > 0
            and not attribute.attisdropped
        ), '[]'::pg_catalog.jsonb),
        'constraints', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', constraint_record.conname,
            'validated', constraint_record.convalidated,
            'definition', pg_catalog.pg_get_constraintdef(
              constraint_record.oid,
              true
            )
          ) order by constraint_record.conname)
          from pg_catalog.pg_constraint as constraint_record
          where constraint_record.conrelid = class.oid
        ), '[]'::pg_catalog.jsonb),
        'indexes', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(index_record)
            order by index_record.indexname
          )
          from pg_catalog.pg_indexes as index_record
          where index_record.schemaname = namespace.nspname
            and index_record.tablename = class.relname
        ), '[]'::pg_catalog.jsonb),
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(policy)
            order by policy.policyname
          )
          from pg_catalog.pg_policies as policy
          where policy.schemaname = namespace.nspname
            and policy.tablename = class.relname
        ), '[]'::pg_catalog.jsonb)
      ) order by namespace.nspname, class.relname)
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where class.oid in (
        'public.orders'::pg_catalog.regclass,
        'public.order_items'::pg_catalog.regclass,
        'public.payout_ledger'::pg_catalog.regclass,
        'public.events_ledger'::pg_catalog.regclass
      )
    ),
    'finalization_rpc', (
      select pg_catalog.jsonb_build_object(
        'definition', pg_catalog.pg_get_functiondef(procedure.oid),
        'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
        'acl', procedure.proacl,
        'config', procedure.proconfig,
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile
      )
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamp with time zone)'
      )
    )
  )::text
  into ops2b1_state;

  if ops2b1_state is distinct from pg_catalog.current_setting(
    'marketa_ops2b2a.ops2b1_state'
  ) then
    raise exception 'Ops 2B2A postcondition: Ops 2B1 objects changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'orders', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.orders as row_record
    ),
    'order_items', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.order_items as row_record
    ),
    'payments', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.payments as row_record
    ),
    'payment_events', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.payment_events as row_record
    ),
    'payout_ledger', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.payout_ledger as row_record
    ),
    'events_ledger', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.events_ledger as row_record
    ),
    'products', (
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(row_record)::text,
        E'\n' order by row_record.id
      ), '')) from public.products as row_record
    )
  )::text
  into protected_rows;

  if protected_rows is distinct from pg_catalog.current_setting(
    'marketa_ops2b2a.protected_rows'
  ) then
    raise exception 'Ops 2B2A postcondition: protected order, payment, ledger, or product rows changed.';
  end if;
end
$postcondition$;

commit;
