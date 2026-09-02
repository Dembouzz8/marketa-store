begin;

do $preflight$
declare
  updated_at_function oid := pg_catalog.to_regprocedure(
    'public.handle_updated_at()'
  );
  updated_at_result oid;
  updated_at_security_definer boolean;
begin
  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'customer_addresses'
  ) then
    raise exception
      'Conflicting relation public.customer_addresses already exists; migration stopped.';
  end if;

  if pg_catalog.to_regclass('auth.users') is null then
    raise exception
      'Required table auth.users is missing; migration stopped.';
  end if;

  if updated_at_function is null then
    raise exception
      'Required function public.handle_updated_at() is missing; migration stopped.';
  end if;

  select procedure.prorettype, procedure.prosecdef
  into updated_at_result, updated_at_security_definer
  from pg_catalog.pg_proc as procedure
  where procedure.oid = updated_at_function;

  if updated_at_result is distinct from pg_catalog.to_regtype('trigger') then
    raise exception
      'public.handle_updated_at() must return trigger; migration stopped.';
  end if;

  if updated_at_security_definer is distinct from false then
    raise exception
      'public.handle_updated_at() must remain SECURITY INVOKER; migration stopped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgfoid = updated_at_function
  ) then
    raise exception
      'public.handle_updated_at() is not used by an existing table; migration stopped.';
  end if;
end
$preflight$;

create table public.customer_addresses (
  id uuid not null primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  label text not null,
  address text not null,
  city text not null,
  state text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint customer_addresses_label_length_check
    check (
      pg_catalog.char_length(pg_catalog.btrim(label)) between 1 and 50
    ),
  constraint customer_addresses_address_length_check
    check (
      pg_catalog.char_length(pg_catalog.btrim(address)) between 5 and 300
    ),
  constraint customer_addresses_city_length_check
    check (
      pg_catalog.char_length(pg_catalog.btrim(city)) between 2 and 100
    ),
  constraint customer_addresses_state_check
    check (
      state in (
        'Abia',
        'Adamawa',
        'Akwa Ibom',
        'Anambra',
        'Bauchi',
        'Bayelsa',
        'Benue',
        'Borno',
        'Cross River',
        'Delta',
        'Ebonyi',
        'Edo',
        'Ekiti',
        'Enugu',
        'Federal Capital Territory',
        'Gombe',
        'Imo',
        'Jigawa',
        'Kaduna',
        'Kano',
        'Katsina',
        'Kebbi',
        'Kogi',
        'Kwara',
        'Lagos',
        'Nasarawa',
        'Niger',
        'Ogun',
        'Ondo',
        'Osun',
        'Oyo',
        'Plateau',
        'Rivers',
        'Sokoto',
        'Taraba',
        'Yobe',
        'Zamfara'
      )
    )
);

comment on table public.customer_addresses is
  'Private saved shipping addresses owned by customer Auth users.';

comment on column public.customer_addresses.user_id is
  'Address owner derived from the authenticated Auth user.';

comment on column public.customer_addresses.is_default is
  'Customer convenience preference; zero or one address may be default.';

create unique index customer_addresses_one_default_per_user_idx
on public.customer_addresses (user_id)
where is_default = true;

create index customer_addresses_user_id_created_at_idx
on public.customer_addresses (user_id, created_at desc);

create trigger customer_addresses_updated_at
before update on public.customer_addresses
for each row
execute function public.handle_updated_at();

alter table public.customer_addresses
  enable row level security;

revoke all privileges
on table public.customer_addresses
from public, anon, authenticated;

grant select, insert, update, delete
on table public.customer_addresses
to authenticated;

grant all privileges
on table public.customer_addresses
to service_role;

create policy customer_addresses_select_own
on public.customer_addresses
for select
to authenticated
using (user_id = (select auth.uid()));

create policy customer_addresses_insert_own
on public.customer_addresses
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy customer_addresses_update_own
on public.customer_addresses
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy customer_addresses_delete_own
on public.customer_addresses
for delete
to authenticated
using (user_id = (select auth.uid()));

create function public.set_customer_default_address(p_address_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  caller_user_id uuid := (select auth.uid());
begin
  if caller_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  perform 1
  from public.customer_addresses as target_address
  where target_address.id = p_address_id
    and target_address.user_id = caller_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Address is unavailable.';
  end if;

  update public.customer_addresses
  set is_default = false
  where user_id = caller_user_id
    and is_default = true;

  update public.customer_addresses
  set is_default = true
  where id = p_address_id
    and user_id = caller_user_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Address is unavailable.';
  end if;
end
$function$;

alter function public.set_customer_default_address(uuid)
  owner to postgres;

revoke all privileges
on function public.set_customer_default_address(uuid)
from public, anon, authenticated;

grant execute
on function public.set_customer_default_address(uuid)
to authenticated, service_role;

do $postcondition$
declare
  address_table oid := pg_catalog.to_regclass(
    'public.customer_addresses'
  );
  auth_users_table oid := pg_catalog.to_regclass('auth.users');
  address_function oid := pg_catalog.to_regprocedure(
    'public.set_customer_default_address(uuid)'
  );
  updated_at_function oid := pg_catalog.to_regprocedure(
    'public.handle_updated_at()'
  );
  anon_role oid := pg_catalog.to_regrole('anon');
  authenticated_role oid := pg_catalog.to_regrole('authenticated');
  service_role_oid oid := pg_catalog.to_regrole('service_role');
  user_id_attribute smallint;
  auth_user_id_attribute smallint;
  created_at_attribute smallint;
  matching_fk_count integer;
  user_id_fk_count integer;
  default_index_predicate text;
  default_index_unique boolean;
  default_index_key_count smallint;
  default_index_first_key smallint;
  listing_index_unique boolean;
  listing_index_has_predicate boolean;
  listing_index_key_count smallint;
  listing_index_first_key smallint;
  listing_index_second_key smallint;
  listing_index_second_options smallint;
  function_security_definer boolean;
  function_result oid;
  function_configuration text[];
begin
  if address_table is null then
    raise exception
      'Postcondition failed: public.customer_addresses is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = address_table
      and relation.relkind in ('r', 'p')
  ) then
    raise exception
      'Postcondition failed: public.customer_addresses is not a table.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = address_table
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) <> 9 then
    raise exception
      'Postcondition failed: public.customer_addresses has unexpected columns.';
  end if;

  if exists (
    select 1
    from (
      values
        ('id', 'uuid', true),
        ('user_id', 'uuid', true),
        ('label', 'text', true),
        ('address', 'text', true),
        ('city', 'text', true),
        ('state', 'text', true),
        ('is_default', 'boolean', true),
        ('created_at', 'timestamp with time zone', true),
        ('updated_at', 'timestamp with time zone', true)
    ) as expected(column_name, type_name, is_not_null)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = address_table
      and attribute.attname = expected.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped
    where attribute.attnum is null
      or pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) <> expected.type_name
      or attribute.attnotnull is distinct from expected.is_not_null
  ) then
    raise exception
      'Postcondition failed: a customer_addresses column has an unexpected type or nullability.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = address_table
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attname not in (
        'id',
        'user_id',
        'label',
        'address',
        'city',
        'state',
        'is_default',
        'created_at',
        'updated_at'
      )
  ) then
    raise exception
      'Postcondition failed: an unexpected customer_addresses column exists.';
  end if;

  if coalesce((
    select pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid),
        '[[:space:]]',
        '',
        'g'
      )
    )
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_record
      on default_record.adrelid = attribute.attrelid
      and default_record.adnum = attribute.attnum
    where attribute.attrelid = address_table
      and attribute.attname = 'id'
  ), '') not in ('gen_random_uuid()', 'pg_catalog.gen_random_uuid()') then
    raise exception
      'Postcondition failed: customer_addresses.id has an unexpected default.';
  end if;

  if coalesce((
    select pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid),
        '[[:space:]]',
        '',
        'g'
      )
    )
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_record
      on default_record.adrelid = attribute.attrelid
      and default_record.adnum = attribute.attnum
    where attribute.attrelid = address_table
      and attribute.attname = 'is_default'
  ), '') not in ('false', 'false::boolean') then
    raise exception
      'Postcondition failed: customer_addresses.is_default has an unexpected default.';
  end if;

  if exists (
    select 1
    from (
      values ('created_at'), ('updated_at')
    ) as expected(column_name)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = address_table
      and attribute.attname = expected.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped
    left join pg_catalog.pg_attrdef as default_record
      on default_record.adrelid = attribute.attrelid
      and default_record.adnum = attribute.attnum
    where default_record.oid is null
      or pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(
            default_record.adbin,
            default_record.adrelid
          ),
          '[[:space:]]',
          '',
          'g'
        )
      ) not in ('now()', 'pg_catalog.now()')
  ) then
    raise exception
      'Postcondition failed: a customer_addresses timestamp has an unexpected default.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_record
      on default_record.adrelid = attribute.attrelid
      and default_record.adnum = attribute.attnum
    where attribute.attrelid = address_table
      and attribute.attname in ('user_id', 'label', 'address', 'city', 'state')
  ) then
    raise exception
      'Postcondition failed: an unexpected customer_addresses default exists.';
  end if;

  select attribute.attnum
  into user_id_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = address_table
    and attribute.attname = 'user_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select attribute.attnum
  into auth_user_id_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = auth_users_table
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select
    pg_catalog.count(*) filter (
      where constraint_record.confrelid = auth_users_table
        and constraint_record.conkey =
          pg_catalog.array_append(array[]::smallint[], user_id_attribute)
        and constraint_record.confkey =
          pg_catalog.array_append(array[]::smallint[], auth_user_id_attribute)
        and constraint_record.confdeltype = 'c'
    ),
    pg_catalog.count(*) filter (
      where user_id_attribute = any (constraint_record.conkey)
    )
  into matching_fk_count, user_id_fk_count
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = address_table
    and constraint_record.contype = 'f';

  if matching_fk_count <> 1 or user_id_fk_count <> 1 then
    raise exception
      'Postcondition failed: user_id must have exactly one FK to auth.users(id) ON DELETE CASCADE.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = address_table
      and constraint_record.contype = 'p'
      and constraint_record.conkey = array[
        (
          select attribute.attnum
          from pg_catalog.pg_attribute as attribute
          where attribute.attrelid = address_table
            and attribute.attname = 'id'
            and attribute.attnum > 0
            and not attribute.attisdropped
        )
      ]::smallint[]
  ) <> 1 then
    raise exception
      'Postcondition failed: customer_addresses.id is not the sole primary key.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = address_table
      and constraint_record.contype = 'c'
      and constraint_record.conname in (
        'customer_addresses_label_length_check',
        'customer_addresses_address_length_check',
        'customer_addresses_city_length_check',
        'customer_addresses_state_check'
      )
  ) <> 4 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = address_table
      and constraint_record.contype = 'c'
  ) <> 4 then
    raise exception
      'Postcondition failed: customer_addresses CHECK constraints are incomplete or unexpected.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = address_table
      and relation.relrowsecurity
  ) then
    raise exception
      'Postcondition failed: RLS is disabled on public.customer_addresses.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'customer_addresses'
      and policy.roles = array['authenticated']::name[]
      and (
        (policy.policyname = 'customer_addresses_select_own'
          and policy.cmd = 'SELECT'
          and policy.qual is not null)
        or (policy.policyname = 'customer_addresses_insert_own'
          and policy.cmd = 'INSERT'
          and policy.with_check is not null)
        or (policy.policyname = 'customer_addresses_update_own'
          and policy.cmd = 'UPDATE'
          and policy.qual is not null
          and policy.with_check is not null)
        or (policy.policyname = 'customer_addresses_delete_own'
          and policy.cmd = 'DELETE'
          and policy.qual is not null)
      )
  ) <> 4 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'customer_addresses'
  ) <> 4 then
    raise exception
      'Postcondition failed: customer_addresses policies are incomplete or unexpected.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) as table_privilege
    where relation.oid = address_table
      and table_privilege.grantee = 0
  ) then
    raise exception
      'Postcondition failed: PUBLIC retains customer_addresses privileges.';
  end if;

  if pg_catalog.has_table_privilege('anon', address_table, 'SELECT')
    or pg_catalog.has_table_privilege('anon', address_table, 'INSERT')
    or pg_catalog.has_table_privilege('anon', address_table, 'UPDATE')
    or pg_catalog.has_table_privilege('anon', address_table, 'DELETE')
    or pg_catalog.has_table_privilege('anon', address_table, 'TRUNCATE')
    or pg_catalog.has_table_privilege('anon', address_table, 'REFERENCES')
    or pg_catalog.has_table_privilege('anon', address_table, 'TRIGGER')
  then
    raise exception
      'Postcondition failed: anon retains customer_addresses privileges.';
  end if;

  if not (
    pg_catalog.has_table_privilege('authenticated', address_table, 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', address_table, 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', address_table, 'UPDATE')
    and pg_catalog.has_table_privilege('authenticated', address_table, 'DELETE')
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    address_table,
    'TRUNCATE'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    address_table,
    'REFERENCES'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    address_table,
    'TRIGGER'
  ) then
    raise exception
      'Postcondition failed: authenticated customer_addresses privileges are incorrect.';
  end if;

  if not (
    pg_catalog.has_table_privilege('service_role', address_table, 'SELECT')
    and pg_catalog.has_table_privilege('service_role', address_table, 'INSERT')
    and pg_catalog.has_table_privilege('service_role', address_table, 'UPDATE')
    and pg_catalog.has_table_privilege('service_role', address_table, 'DELETE')
    and pg_catalog.has_table_privilege('service_role', address_table, 'TRUNCATE')
    and pg_catalog.has_table_privilege('service_role', address_table, 'REFERENCES')
    and pg_catalog.has_table_privilege('service_role', address_table, 'TRIGGER')
  ) then
    raise exception
      'Postcondition failed: service_role customer_addresses administration is incomplete.';
  end if;

  select attribute.attnum
  into created_at_attribute
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = address_table
    and attribute.attname = 'created_at'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select
    index_record.indisunique,
    index_record.indnkeyatts,
    index_record.indkey[0],
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(
          index_record.indpred,
          index_record.indrelid
        ),
        '[[:space:]()]',
        '',
        'g'
      )
    )
  into
    default_index_unique,
    default_index_key_count,
    default_index_first_key,
    default_index_predicate
  from pg_catalog.pg_index as index_record
  where index_record.indexrelid = pg_catalog.to_regclass(
    'public.customer_addresses_one_default_per_user_idx'
  );

  if default_index_unique is distinct from true
    or default_index_key_count is distinct from 1::smallint
    or default_index_first_key is distinct from user_id_attribute
    or default_index_predicate not in ('is_default=true', 'is_default')
  then
    raise exception
      'Postcondition failed: the one-default-per-user index is incorrect.';
  end if;

  select
    index_record.indisunique,
    index_record.indpred is not null,
    index_record.indnkeyatts,
    index_record.indkey[0],
    index_record.indkey[1],
    index_record.indoption[1]
  into
    listing_index_unique,
    listing_index_has_predicate,
    listing_index_key_count,
    listing_index_first_key,
    listing_index_second_key,
    listing_index_second_options
  from pg_catalog.pg_index as index_record
  where index_record.indexrelid = pg_catalog.to_regclass(
    'public.customer_addresses_user_id_created_at_idx'
  );

  if listing_index_unique is distinct from false
    or listing_index_has_predicate is distinct from false
    or listing_index_key_count is distinct from 2::smallint
    or listing_index_first_key is distinct from user_id_attribute
    or listing_index_second_key is distinct from created_at_attribute
    or (listing_index_second_options & 1) <> 1
  then
    raise exception
      'Postcondition failed: the customer address listing index is incorrect.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = address_table
      and not trigger_record.tgisinternal
      and trigger_record.tgname = 'customer_addresses_updated_at'
      and trigger_record.tgfoid = updated_at_function
      and trigger_record.tgtype = 19
  ) <> 1 then
    raise exception
      'Postcondition failed: the customer_addresses updated_at trigger is incorrect.';
  end if;

  if address_function is null then
    raise exception
      'Postcondition failed: set_customer_default_address(uuid) is missing.';
  end if;

  select
    procedure.prosecdef,
    procedure.prorettype,
    procedure.proconfig
  into
    function_security_definer,
    function_result,
    function_configuration
  from pg_catalog.pg_proc as procedure
  where procedure.oid = address_function;

  if function_security_definer is distinct from false then
    raise exception
      'Postcondition failed: set_customer_default_address must be SECURITY INVOKER.';
  end if;

  if function_result is distinct from pg_catalog.to_regtype('void') then
    raise exception
      'Postcondition failed: set_customer_default_address must return void.';
  end if;

  if not (
    coalesce(function_configuration, array[]::text[])
    @> array['search_path=""']::text[]
  ) then
    raise exception
      'Postcondition failed: set_customer_default_address has an unsafe search_path.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) as function_privilege
    where procedure.oid = address_function
      and function_privilege.privilege_type = 'EXECUTE'
      and function_privilege.grantee in (0, anon_role)
  ) then
    raise exception
      'Postcondition failed: PUBLIC or anon can execute set_customer_default_address.';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    address_function,
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    address_function,
    'EXECUTE'
  ) then
    raise exception
      'Postcondition failed: required set_customer_default_address execution grant is missing.';
  end if;

  if anon_role is null
    or authenticated_role is null
    or service_role_oid is null
  then
    raise exception
      'Postcondition failed: a required API role is missing.';
  end if;
end
$postcondition$;

commit;
