-- Ops 1A: contain the unused legacy stock decrement function to service-role callers.
begin;

set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  function_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
begin
  if function_oid is null then
    perform pg_catalog.set_config(
      'marketa_ops1a.legacy_function_existed',
      'false',
      true
    );
  else
    if not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language
        on language.oid = procedure.prolang
      where procedure.oid = function_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.prorettype = 'boolean'::pg_catalog.regtype
        and procedure.proconfig is null
        and language.lanname = 'plpgsql'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
          'p_product_id uuid, p_quantity integer'
        and pg_catalog.md5(pg_catalog.regexp_replace(
          procedure.prosrc,
          '[[:space:]]',
          '',
          'g'
        )) = 'f0b1f309f7f6b59f6e111d6dc6755962'
    ) then
      raise exception 'Ops 1A: decrement_stock no longer matches the audited live definition.';
    end if;

    if (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'decrement_stock'
    ) <> 1 then
      raise exception 'Ops 1A: decrement_stock has an unexpected overload.';
    end if;

    if (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = function_oid
    ) <> 5 or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = function_oid
        and (
          acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            0,
            'postgres'::pg_catalog.regrole,
            'anon'::pg_catalog.regrole,
            'authenticated'::pg_catalog.regrole,
            'service_role'::pg_catalog.regrole
          )
        )
    ) or not pg_catalog.has_function_privilege(
      'public',
      function_oid,
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'anon',
      function_oid,
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'authenticated',
      function_oid,
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'service_role',
      function_oid,
      'EXECUTE'
    ) then
      raise exception 'Ops 1A: decrement_stock grants no longer match the audited live baseline.';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_roles as role
      where role.rolname = 'service_role'
        and role.rolbypassrls
    ) or not pg_catalog.has_table_privilege(
      'service_role',
      'public.products',
      'SELECT'
    ) or not pg_catalog.has_table_privilege(
      'service_role',
      'public.products',
      'UPDATE'
    ) then
      raise exception 'Ops 1A: service_role lacks the product authority required for SECURITY INVOKER.';
    end if;

    perform pg_catalog.set_config(
      'marketa_ops1a.legacy_function_existed',
      'true',
      true
    );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = pg_catalog.to_regclass('public.products')
      and class.relkind = 'r'
      and class.relrowsecurity
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
  ) <> 5 then
    raise exception 'Ops 1A: Batch 4A product RLS baseline changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.products'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and not attribute.attnotnull
      and pg_catalog.pg_get_expr(
        default_value.adbin,
        default_value.adrelid
      ) = 'false'
  ) then
    raise exception 'Ops 1A: Batch 4A product activation default changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
      and attribute.attname = 'is_active'
      and attribute.attnotnull
      and pg_catalog.pg_get_expr(
        default_value.adbin,
        default_value.adrelid
      ) = 'false'
  ) or pg_catalog.has_column_privilege(
    'authenticated',
    'public.vendors',
    'is_active',
    'UPDATE'
  ) then
    raise exception 'Ops 1A: Batch 4A vendor activation boundary changed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as class
    where class.oid = pg_catalog.to_regclass('storage.objects')
      and class.relkind = 'r'
      and class.relrowsecurity
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
  ) <> 2 or not exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'product-images'
      and bucket.name = 'product-images'
      and bucket.public
      and bucket.file_size_limit = 5242880
      and bucket.allowed_mime_types is not distinct from array[
        'image/jpeg',
        'image/png',
        'image/webp'
      ]::text[]
  ) then
    raise exception 'Ops 1A: Batch 4B1 Storage boundary changed.';
  end if;
end
$preflight$;

lock table public.products in share mode;

do $snapshot$
begin
  perform pg_catalog.set_config(
    'marketa_ops1a.product_row_count',
    (
      select pg_catalog.count(*)::text
      from public.products
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops1a.product_rows',
    (
      select pg_catalog.md5(coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(product)::text,
          E'\n' order by product.id
        ),
        ''
      ))
      from public.products as product
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops1a.products_security',
    (
      select pg_catalog.jsonb_build_object(
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(policy)
            order by policy.policyname
          )
          from pg_catalog.pg_policies as policy
          where policy.schemaname = 'public'
            and policy.tablename = 'products'
        ), '[]'::pg_catalog.jsonb),
        'product_is_active', (
          select pg_catalog.jsonb_build_object(
            'not_null', attribute.attnotnull,
            'default', pg_catalog.pg_get_expr(
              default_value.adbin,
              default_value.adrelid
            )
          )
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_value
            on default_value.adrelid = attribute.attrelid
            and default_value.adnum = attribute.attnum
          where attribute.attrelid = 'public.products'::pg_catalog.regclass
            and attribute.attname = 'is_active'
        ),
        'vendor_is_active', (
          select pg_catalog.jsonb_build_object(
            'not_null', attribute.attnotnull,
            'default', pg_catalog.pg_get_expr(
              default_value.adbin,
              default_value.adrelid
            ),
            'authenticated_update', pg_catalog.has_column_privilege(
              'authenticated',
              'public.vendors',
              'is_active',
              'UPDATE'
            )
          )
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_value
            on default_value.adrelid = attribute.attrelid
            and default_value.adnum = attribute.attnum
          where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
            and attribute.attname = 'is_active'
        ),
        'vendor_active_helper', (
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
            'public.is_vendor_active(uuid)'
          )
        )
      )::text
      from pg_catalog.pg_class as class
      where class.oid = 'public.products'::pg_catalog.regclass
    ),
    true
  );

  perform pg_catalog.set_config(
    'marketa_ops1a.storage_security',
    (
      select pg_catalog.jsonb_build_object(
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(policy)
            order by policy.policyname
          )
          from pg_catalog.pg_policies as policy
          where policy.schemaname = 'storage'
            and policy.tablename = 'objects'
        ), '[]'::pg_catalog.jsonb),
        'bucket', (
          select pg_catalog.to_jsonb(bucket)
          from storage.buckets as bucket
          where bucket.id = 'product-images'
        ),
        'foldername', (
          select pg_catalog.pg_get_functiondef(procedure.oid)
          from pg_catalog.pg_proc as procedure
          where procedure.oid = pg_catalog.to_regprocedure(
            'storage.foldername(text)'
          )
        )
      )::text
      from pg_catalog.pg_class as class
      where class.oid = 'storage.objects'::pg_catalog.regclass
    ),
    true
  );
end
$snapshot$;

do $containment$
begin
  if pg_catalog.current_setting(
    'marketa_ops1a.legacy_function_existed'
  )::boolean then
    execute $ddl$
      create or replace function public.decrement_stock(
        p_product_id uuid,
        p_quantity integer
      )
      returns boolean
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $function$
      declare
        v_stock integer;
      begin
        if p_quantity is null or p_quantity <= 0 then
          return false;
        end if;

        select product.stock
        into v_stock
        from public.products as product
        where product.id = p_product_id
        for update;

        if v_stock is null or v_stock < p_quantity then
          return false;
        end if;

        update public.products as product
        set stock = product.stock - p_quantity,
            updated_at = pg_catalog.now()
        where product.id = p_product_id;

        return true;
      end
      $function$
    $ddl$;

    execute 'alter function public.decrement_stock(uuid, integer) owner to postgres';
    execute 'revoke all privileges on function public.decrement_stock(uuid, integer) from public, anon, authenticated, service_role';
    execute 'grant execute on function public.decrement_stock(uuid, integer) to service_role';
  end if;
end
$containment$;

do $postcondition$
declare
  function_oid oid := pg_catalog.to_regprocedure(
    'public.decrement_stock(uuid,integer)'
  );
  legacy_function_existed boolean := pg_catalog.current_setting(
    'marketa_ops1a.legacy_function_existed'
  )::boolean;
  products_security text;
  storage_security text;
begin
  if not legacy_function_existed then
    if function_oid is not null then
      raise exception 'Ops 1A postcondition: absent decrement_stock was unexpectedly created.';
    end if;
  else
    if function_oid is null or not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_language as language
        on language.oid = procedure.prolang
      where procedure.oid = function_oid
        and procedure.proowner = 'postgres'::pg_catalog.regrole
        and not procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.prorettype = 'boolean'::pg_catalog.regtype
        and procedure.proconfig is not distinct from
          array['search_path=""']::text[]
        and language.lanname = 'plpgsql'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
          'p_product_id uuid, p_quantity integer'
        and pg_catalog.md5(pg_catalog.regexp_replace(
          procedure.prosrc,
          '[[:space:]]',
          '',
          'g'
        )) = '69bc5e9b0bd95769525f9816a9791145'
    ) then
      raise exception 'Ops 1A postcondition: decrement_stock security or source contract is incorrect.';
    end if;

    if pg_catalog.has_function_privilege(
      'public',
      function_oid,
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon',
      function_oid,
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated',
      function_oid,
      'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'service_role',
      function_oid,
      'EXECUTE'
    ) or (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = function_oid
    ) <> 2 or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) as acl
      where procedure.oid = function_oid
        and (
          acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            'service_role'::pg_catalog.regrole
          )
        )
    ) then
      raise exception 'Ops 1A postcondition: decrement_stock EXECUTE grants are incorrect.';
    end if;
  end if;

  if (
    select pg_catalog.count(*)::text
    from public.products
  ) is distinct from pg_catalog.current_setting(
    'marketa_ops1a.product_row_count'
  ) or (
    select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(product)::text,
        E'\n' order by product.id
      ),
      ''
    ))
    from public.products as product
  ) is distinct from pg_catalog.current_setting(
    'marketa_ops1a.product_rows'
  ) then
    raise exception 'Ops 1A postcondition: product rows changed during the migration.';
  end if;

  select pg_catalog.jsonb_build_object(
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy)
        order by policy.policyname
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'products'
    ), '[]'::pg_catalog.jsonb),
    'product_is_active', (
      select pg_catalog.jsonb_build_object(
        'not_null', attribute.attnotnull,
        'default', pg_catalog.pg_get_expr(
          default_value.adbin,
          default_value.adrelid
        )
      )
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.products'::pg_catalog.regclass
        and attribute.attname = 'is_active'
    ),
    'vendor_is_active', (
      select pg_catalog.jsonb_build_object(
        'not_null', attribute.attnotnull,
        'default', pg_catalog.pg_get_expr(
          default_value.adbin,
          default_value.adrelid
        ),
        'authenticated_update', pg_catalog.has_column_privilege(
          'authenticated',
          'public.vendors',
          'is_active',
          'UPDATE'
        )
      )
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = attribute.attrelid
        and default_value.adnum = attribute.attnum
      where attribute.attrelid = 'public.vendors'::pg_catalog.regclass
        and attribute.attname = 'is_active'
    ),
    'vendor_active_helper', (
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
        'public.is_vendor_active(uuid)'
      )
    )
  )::text
  into products_security
  from pg_catalog.pg_class as class
  where class.oid = 'public.products'::pg_catalog.regclass;

  if products_security is distinct from pg_catalog.current_setting(
    'marketa_ops1a.products_security'
  ) then
    raise exception 'Ops 1A postcondition: Batch 4A product security boundary changed.';
  end if;

  select pg_catalog.jsonb_build_object(
    'rls', class.relrowsecurity,
    'force_rls', class.relforcerowsecurity,
    'policies', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(policy)
        order by policy.policyname
      )
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
    ), '[]'::pg_catalog.jsonb),
    'bucket', (
      select pg_catalog.to_jsonb(bucket)
      from storage.buckets as bucket
      where bucket.id = 'product-images'
    ),
    'foldername', (
      select pg_catalog.pg_get_functiondef(procedure.oid)
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'storage.foldername(text)'
      )
    )
  )::text
  into storage_security
  from pg_catalog.pg_class as class
  where class.oid = 'storage.objects'::pg_catalog.regclass;

  if storage_security is distinct from pg_catalog.current_setting(
    'marketa_ops1a.storage_security'
  ) then
    raise exception 'Ops 1A postcondition: Batch 4B1 Storage security boundary changed.';
  end if;
end
$postcondition$;

commit;
