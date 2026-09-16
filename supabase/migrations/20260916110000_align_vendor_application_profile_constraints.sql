-- Reconcile application location validation before Batch 1B provisioning.
-- Change only the location CHECK and the submission RPC's location validation.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $reconciliation$
declare
  v_rpc oid := pg_catalog.to_regprocedure(
    'public.submit_vendor_application(text,text,text,text,text,text,text,text,text,boolean)'
  );
  v_definition text;
  v_expected_definition text;
  v_rpc_metadata jsonb;
  v_data_before text;
  v_data_after text;
  v_other_checks_before text;
  v_other_checks_after text;
  v_role text;
  v_old_validation constant text := $old$
  if normalized_location is null
    or normalized_location = ''
    or pg_catalog.char_length(normalized_location) > 160
  then
    raise exception using
      errcode = '22023',
      message = 'location must be between 1 and 160 characters.';
  end if;
$old$;
  v_new_validation constant text := $new$
  if normalized_location is null
    or normalized_location = ''
    or normalized_location !~ '[^[:space:]]'
    or pg_catalog.char_length(normalized_location) > 120
  then
    raise exception using
      errcode = '22023',
      message = 'location must be nonblank and between 1 and 120 characters.';
  end if;
$new$;
begin
  if not exists (
    select 1 from pg_catalog.pg_class as c
    where c.oid = pg_catalog.to_regclass('public.vendor_applications')
      and c.relkind = 'r'
  ) then
    raise exception 'Location reconciliation: required vendor_applications table is missing.';
  end if;

  lock table public.vendor_applications in access exclusive mode;

  if not exists (
    select 1 from pg_catalog.pg_constraint as k
    where k.conrelid = 'public.vendor_applications'::regclass
      and k.conname = 'vendor_applications_location_check'
      and k.contype = 'c' and k.convalidated
      and pg_catalog.pg_get_constraintdef(k.oid)
        = 'CHECK (((char_length(btrim(location)) >= 1) AND (char_length(btrim(location)) <= 160)))'
  ) then
    raise exception 'Location reconciliation: expected 1-160 location CHECK changed.';
  end if;

  if exists (
    select 1 from public.vendor_applications as a
    where pg_catalog.char_length(pg_catalog.btrim(a.location)) > 120
      or pg_catalog.char_length(pg_catalog.btrim(a.location)) < 1
      or a.location !~ '[^[:space:]]'
  ) then
    raise exception 'Location reconciliation: existing locations violate the new boundary; no rows rewritten.';
  end if;

  if v_rpc is null or not exists (
    select 1 from pg_catalog.pg_proc as p
    where p.oid = v_rpc and p.proowner = 'postgres'::regrole and p.prosecdef
      and p.proconfig = array['search_path=""']
      and p.prokind = 'f' and p.proretset and p.pronargdefaults = 0
      and p.prolang = (select l.oid from pg_catalog.pg_language as l where l.lanname = 'plpgsql')
      and pg_catalog.pg_get_function_result(p.oid) = 'TABLE(outcome text, application_id uuid)'
      and pg_catalog.pg_get_function_arguments(p.oid)
        = 'p_business_name text, p_contact_name text, p_email text, p_phone text, p_business_category text, p_location text, p_business_description text, p_product_summary text, p_experience text, p_terms_accepted boolean'
      -- Exact reviewed/applied Batch 1A body, ignoring platform CR characters.
      and pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), ''))
        = '25555d81cbeb0b62730e43ec47f5d1bc'
  ) then
    raise exception 'Location reconciliation: submission RPC signature/security/body is unrecognized.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc as p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) as acl
    where p.oid = v_rpc and (
      acl.grantee not in ('postgres'::regrole, 'anon'::regrole,
        'authenticated'::regrole, 'service_role'::regrole)
      or acl.privilege_type <> 'EXECUTE'
      or (acl.grantee <> 'postgres'::regrole and acl.is_grantable)
    )
  ) then
    raise exception 'Location reconciliation: submission RPC has unexpected EXECUTE grants.';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if not pg_catalog.has_function_privilege(v_role, v_rpc, 'EXECUTE') then
      raise exception 'Location reconciliation: required RPC execution grant missing for %.', v_role;
    end if;
  end loop;

  select pg_catalog.to_jsonb(p) - 'prosrc', pg_catalog.pg_get_functiondef(p.oid)
  into v_rpc_metadata, v_definition from pg_catalog.pg_proc as p where p.oid = v_rpc;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    pg_catalog.to_jsonb(a)::text, E'\n' order by a.id
  ), '')) into v_data_before from public.vendor_applications as a;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    k.conname || ':' || pg_catalog.pg_get_constraintdef(k.oid), E'\n' order by k.conname
  ), '')) into v_other_checks_before
  from pg_catalog.pg_constraint as k
  where k.conrelid = 'public.vendor_applications'::regclass
    and k.conname <> 'vendor_applications_location_check';

  -- Edit a single recognized block of the trusted catalog definition, not an
  -- independently copied RPC. All normalization, other limits, and duplicate
  -- handling remain byte-for-byte unchanged in the function body.
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  if (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_validation, '')))
      / pg_catalog.length(v_old_validation) <> 1
  then
    raise exception 'Location reconciliation: expected exactly one location validation block.';
  end if;
  v_expected_definition := pg_catalog.replace(v_definition, v_old_validation, v_new_validation);

  alter table public.vendor_applications
    drop constraint vendor_applications_location_check;
  alter table public.vendor_applications
    add constraint vendor_applications_location_check check (
      pg_catalog.char_length(pg_catalog.btrim(location)) >= 1
      and pg_catalog.char_length(pg_catalog.btrim(location)) <= 120
      and location ~ '[^[:space:]]'
    );

  -- CREATE OR REPLACE preserves the existing owner and ACL. The only dynamic
  -- input is the checked catalog definition plus the constant replacement above.
  execute v_expected_definition;

  if not exists (
    select 1 from pg_catalog.pg_constraint as k
    where k.conrelid = 'public.vendor_applications'::regclass
      and k.conname = 'vendor_applications_location_check'
      and k.contype = 'c' and k.convalidated
      and pg_catalog.pg_get_constraintdef(k.oid)
        = 'CHECK (((char_length(btrim(location)) >= 1) AND (char_length(btrim(location)) <= 120) AND (location ~ ''[^[:space:]]''::text)))'
  ) then
    raise exception 'Location reconciliation: final location CHECK is not the exact 1-120 nonblank rule.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc as p
    where p.oid = v_rpc
      and pg_catalog.to_jsonb(p) - 'prosrc' = v_rpc_metadata
      and pg_catalog.replace(pg_catalog.pg_get_functiondef(p.oid), pg_catalog.chr(13), '')
        = v_expected_definition
  ) then
    raise exception 'Location reconciliation: RPC body/metadata/grants postcondition failed.';
  end if;

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    pg_catalog.to_jsonb(a)::text, E'\n' order by a.id
  ), '')) into v_data_after from public.vendor_applications as a;
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    k.conname || ':' || pg_catalog.pg_get_constraintdef(k.oid), E'\n' order by k.conname
  ), '')) into v_other_checks_after
  from pg_catalog.pg_constraint as k
  where k.conrelid = 'public.vendor_applications'::regclass
    and k.conname <> 'vendor_applications_location_check';

  if v_data_after is distinct from v_data_before
    or v_other_checks_after is distinct from v_other_checks_before
  then
    raise exception 'Location reconciliation: application data or unrelated constraints changed.';
  end if;
end
$reconciliation$;

commit;
