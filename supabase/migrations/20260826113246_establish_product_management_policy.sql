begin;

do $preflight$
declare
  v_command text;
begin
  if to_regclass('public.products') is null then
    raise exception
      'Required table public.products is missing.';
  end if;

  select policy.cmd
  into v_command
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_manage_products';

  if v_command is null then
    raise exception
      'Required policy vendor_manage_products is missing.';
  end if;

  if v_command <> 'ALL' then
    raise exception
      'Unexpected vendor_manage_products command: %.',
      v_command;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.policyname = 'products_public_read'
      and policy.cmd = 'SELECT'
  ) then
    raise exception
      'Required products_public_read policy is missing.';
  end if;
end
$preflight$;

alter policy vendor_manage_products
on public.products
to authenticated;

do $postcondition$
declare
  v_roles name[];
begin
  select policy.roles
  into v_roles
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'products'
    and policy.policyname = 'vendor_manage_products';

  if v_roles is distinct from array['authenticated']::name[] then
    raise exception
      'vendor_manage_products is not restricted to authenticated.';
  end if;

  if not pg_catalog.has_table_privilege(
    'anon',
    'public.products',
    'SELECT'
  ) then
    raise exception
      'Anonymous product SELECT privilege is missing.';
  end if;

  if pg_catalog.has_table_privilege(
    'anon',
    'public.vendors',
    'SELECT'
  ) then
    raise exception
      'Anonymous access to public.vendors must remain revoked.';
  end if;
end
$postcondition$;

commit;