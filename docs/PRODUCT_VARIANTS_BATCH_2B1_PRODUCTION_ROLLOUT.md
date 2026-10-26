# Product Variants Batch 2B1 Production Rollout

Batch 2B1 completed its approved production rollout on October 26, 2026. The
preflight, deployment, and recovery procedures below are retained as the
reviewed operational record; they do not authorize a repeat deployment.

## Deployment outcome

**Status: COMPLETE for the approved Batch 2B1 backend scope.** Both approved
migrations were applied to production project `jznuklvrhfivbdsxgiwv`:

1. `20261020150650_secure_vendor_variant_management_backend.sql`
2. `20261026072004_add_order_items_product_id_index.sql`

The production migration ledger contained 27 migrations after deployment.
Post-deployment verification confirmed:

- all five vendor variant-management RPCs were installed with the reviewed
  ownership and execution boundaries;
- both draft-only publication constraints were validated;
- all six relevant triggers were enabled;
- existing product and variant RLS policies were unchanged;
- `order_items_product_id_idx` was valid and ready;
- all 47 existing order items and all 9 existing products were preserved;
- payment and inventory function hashes were unchanged;
- backend tests and disposable PostgreSQL behavioral tests passed; and
- six production UI regression smoke tests passed for the
  storefront/catalogue, product details, cart, checkout form, vendor
  dashboard, and admin dashboard.

No real checkout or payment was performed during the production smoke test.
No production variant-write smoke test was performed; the variant-management
behavior was validated in the disposable database. A pre-deployment
public-schema backup was created and its archive readability was verified.
The Docker catalog-cache warning did not prevent deployment.

Batch 2B1 does not enable customer-facing variant purchasing. Variant products
remain subject to the draft-only publication restrictions. Customer variant
selection, checkout integration, and later variant phases remain deferred.
The next development batch is **Batch 2B2 — Vendor Sizes and Colours
Interface**.

## Fixed targets and artifacts

- Production project reference: `jznuklvrhfivbdsxgiwv`
- Disposable validation project reference: `fzxxyfvxqfmioebircug`
- Backend migration: `20261020150650_secure_vendor_variant_management_backend.sql`
- Approved backend migration SHA-256: `dc67edd94c1b7192483dadf9f10ba9c8010efb713fd2170f3d486e7dbb034dfb`
- Standalone index migration: `20261026072004_add_order_items_product_id_index.sql`
- Index: `public.order_items_product_id_idx` on `public.order_items (product_id)`

The linked project must be checked immediately before every remote command. Do not rely on a saved CLI link, a project display name, or a previous terminal session.

## Deployment automation boundary

The repository currently contains no `.github` workflow that runs Supabase migrations and no remote-specific `[remotes]` block in `supabase/config.toml`. Dashboard configuration is separate from the repository and must be checked manually under **Project Settings > Integrations > GitHub Integration**.

Supabase GitHub Branching must not deploy this rollout. Branching runs migrations inside transactions and does not honor the `-- pg-delta: transaction=false` directive. Disable or disconnect any GitHub integration that can run production migrations before committing or pushing these files. Keep it disabled until both migrations and all post-deployment checks are complete.

## Approval gates

Stop unless all of the following are true:

1. A reviewer approves the exact backend and index migration files.
2. The backend SHA-256 matches the approved value above.
3. The CLI's linked project reference is exactly `jznuklvrhfivbdsxgiwv`, and the deployed Marketa `NEXT_PUBLIC_SUPABASE_URL` identifies the same project reference.
4. Production migration history has no unexpected entry or gap.
5. The dry run lists exactly the two migrations in timestamp order.
6. GitHub Branching and other CI migration deployment are confirmed inactive for production.
7. No conflicting RPC, constraint, trigger, policy, or index exists.
8. Business-data preflights and lock-risk checks pass.
9. Backup/PITR availability, the recovery owner, the deployment window, and the maximum acceptable lock wait are recorded.
10. The explicit production approval gate has been satisfied.

## Read-only production preflight

### 1. Repository and migration history

Run locally:

```powershell
git branch --show-current
git rev-parse HEAD
git status -sb
Get-FileHash -Algorithm SHA256 supabase/migrations/20261020150650_secure_vendor_variant_management_backend.sql
npx supabase projects list
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Explicitly confirm that the CLI marks `jznuklvrhfivbdsxgiwv` as linked. If available, inspect `supabase/.temp/project-ref` and require its complete contents to equal `jznuklvrhfivbdsxgiwv`. Compare that reference with the deployed Marketa `NEXT_PUBLIC_SUPABASE_URL`: its Supabase hostname must identify `jznuklvrhfivbdsxgiwv`. Do not rely on the Supabase project display name.

The remote ledger must end at `20261012120923_add_product_variants_foundation`, and the dry run must list only:

1. `20261020150650_secure_vendor_variant_management_backend.sql`
2. `20261026072004_add_order_items_product_id_index.sql`

Abort if any other migration is pending. Do not use migration repair during this rollout.

Read-only ledger query:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
order by version;
```

### 2. RPC collision check

All five rows must be absent before deployment:

```sql
select
  namespace.nspname as schema_name,
  procedure.proname,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'configure_vendor_product_variant_mode',
    'create_vendor_product_variant',
    'update_vendor_product_variant_labels',
    'update_vendor_product_variant_stock',
    'delete_vendor_product_variant'
  )
order by procedure.proname, identity_arguments;
```

### 3. Foundation and Ops 4 function hashes

Use the exact original definition hash expression. Do not normalize case or whitespace:

```sql
with approved_function(signature, expected_hash, may_be_absent) as (
  values
    ('public.enforce_product_foundation_authority()', '624c42c4ab1c60bd67336e2e2b3682e9', false),
    ('public.enforce_product_variant_foundation()', 'e78b76b04116caa821c78c8b00f6d44e', false),
    ('public.guard_foundation_order_item_variant()', '686d43b726c7e89661d351d4129f0a9f', false),
    ('public.protect_order_item_variant_identity()', 'd296f4f90403c71faf597fcdd145914b', false),
    ('public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamptz)', '37c763494aed0f4e13daa004b88b6dee', false),
    ('public.decrement_stock(uuid,integer)', '0094f1ea6602edbfe18ac8f9619677b8', true)
)
select
  approved_function.signature,
  procedure.oid is not null as function_exists,
  case
    when procedure.oid is null then null
    else pg_catalog.md5(
      pg_catalog.pg_get_functiondef(procedure.oid)
    )
  end as actual_hash,
  approved_function.expected_hash,
  case
    when procedure.oid is null then approved_function.may_be_absent
    else pg_catalog.md5(
      pg_catalog.pg_get_functiondef(procedure.oid)
    ) = approved_function.expected_hash
  end as baseline_matches
from approved_function
left join pg_catalog.pg_proc as procedure
  on procedure.oid = pg_catalog.to_regprocedure(approved_function.signature)
order by approved_function.signature;
```

The exact approved signatures and hashes are:

- `public.enforce_product_foundation_authority()`: `624c42c4ab1c60bd67336e2e2b3682e9`
- `public.enforce_product_variant_foundation()`: `e78b76b04116caa821c78c8b00f6d44e`
- `public.guard_foundation_order_item_variant()`: `686d43b726c7e89661d351d4129f0a9f`
- `public.protect_order_item_variant_identity()`: `d296f4f90403c71faf597fcdd145914b`
- `public.finalize_paystack_paid_order(text,text,text,text,text,text,bigint,text,timestamptz)`: `37c763494aed0f4e13daa004b88b6dee`
- `public.decrement_stock(uuid,integer)`: `0094f1ea6602edbfe18ac8f9619677b8`

All six rows must report `baseline_matches = true`. The only approved absence is `public.decrement_stock(uuid,integer)`; when it is legitimately absent, `function_exists = false`, `actual_hash = null`, and `baseline_matches = true`. Every other missing function or hash mismatch requires aborting.

### 4. Constraints, triggers, RLS, and privileges

Capture the exact catalog state before deployment so it can be compared afterward:

```sql
select
  constraint_record.conrelid::pg_catalog.regclass::text as table_name,
  constraint_record.conname,
  constraint_record.contype,
  constraint_record.convalidated,
  pg_catalog.pg_get_constraintdef(constraint_record.oid, true) as definition
from pg_catalog.pg_constraint as constraint_record
where constraint_record.conrelid in (
  'public.products'::pg_catalog.regclass,
  'public.product_variants'::pg_catalog.regclass,
  'public.order_items'::pg_catalog.regclass
)
order by table_name, constraint_record.conname;

select
  policy.schemaname,
  policy.tablename,
  policy.policyname,
  policy.permissive,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check
from pg_catalog.pg_policies as policy
where policy.schemaname = 'public'
  and policy.tablename in ('products', 'product_variants', 'order_items')
order by policy.tablename, policy.policyname;

select
  trigger_record.tgrelid::pg_catalog.regclass::text as table_name,
  trigger_record.tgname,
  trigger_record.tgenabled,
  pg_catalog.pg_get_triggerdef(trigger_record.oid, true) as definition
from pg_catalog.pg_trigger as trigger_record
where not trigger_record.tgisinternal
  and trigger_record.tgrelid in (
    'public.products'::pg_catalog.regclass,
    'public.product_variants'::pg_catalog.regclass,
    'public.order_items'::pg_catalog.regclass
  )
order by table_name, trigger_record.tgname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('products', 'product_variants', 'order_items')
order by table_name, grantee, privilege_type;

select grantee, table_name, column_name, privilege_type
from information_schema.role_column_grants
where table_schema = 'public'
  and table_name in ('products', 'product_variants', 'order_items')
order by table_name, column_name, grantee, privilege_type;
```

Exactly six non-internal triggers must exist across these three tables:

- `products_updated_at`: sets `products.updated_at` through `public.handle_updated_at()`.
- `products_foundation_authority_guard`: protects product ownership, variant mode, and stock-version authority.
- `product_variants_foundation_guard`: enforces parent ownership/mode and variant inventory invariants.
- `product_variants_updated_at`: sets `product_variants.updated_at` through `public.handle_updated_at()`.
- `order_items_foundation_variant_guard`: validates ordinary foundation-stage order items and shares the product advisory lock.
- `order_items_variant_identity_immutable`: prevents changes to historical variant identity snapshots.

The four authority/variant guards and two `updated_at` triggers must match their approved definitions. The foundation constraints, foreign keys, two `product_variants` SELECT policies, and agreed effective privileges must also match the reviewed foundation migration. Abort on any missing, changed, or unexpected trigger or other drift.

### 5. Variant records and publication state

```sql
select
  (select count(*) from public.product_variants) as variant_rows,
  (select count(*) from public.products where variant_mode <> 'none') as variant_mode_products,
  (select count(*) from public.products where variant_mode <> 'none' and is_active) as published_variant_products,
  (select count(*) from public.product_variants where is_active) as active_variants;
```

Before Batch 2B1, all four counts are expected to be zero. Any nonzero count requires investigation and fresh approval.

### 6. Existing index validity

The named index is expected to be absent before deployment. If it exists, abort and inspect it rather than relying on `IF NOT EXISTS`.

```sql
select
  index_record.indexrelid::pg_catalog.regclass::text as index_name,
  index_record.indrelid::pg_catalog.regclass::text as table_name,
  index_record.indisvalid,
  index_record.indisready,
  pg_catalog.pg_get_indexdef(index_record.indexrelid) as definition
from pg_catalog.pg_index as index_record
where index_record.indexrelid = pg_catalog.to_regclass(
  'public.order_items_product_id_idx'
);
```

Also inspect equivalent indexes that could make the new index redundant:

```sql
select
  index_record.indexrelid::pg_catalog.regclass::text as index_name,
  index_record.indisvalid,
  index_record.indisready,
  pg_catalog.pg_get_indexdef(index_record.indexrelid) as definition
from pg_catalog.pg_index as index_record
where index_record.indrelid = 'public.order_items'::pg_catalog.regclass
order by index_name;
```

### 7. Business-data and lock-risk checks

Run during a quiet deployment window:

```sql
select
  (select count(*) from public.products) as products,
  (select count(*) from public.product_variants) as product_variants,
  (select count(*) from public.order_items) as order_items,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.payments) as payments,
  (select count(*) from public.payment_events) as payment_events;

select
  lock_record.pid,
  lock_record.locktype,
  lock_record.mode,
  lock_record.granted,
  lock_record.relation::pg_catalog.regclass::text as relation_name
from pg_catalog.pg_locks as lock_record
where lock_record.relation in (
  'public.products'::pg_catalog.regclass,
  'public.product_variants'::pg_catalog.regclass,
  'public.order_items'::pg_catalog.regclass,
  'public.vendors'::pg_catalog.regclass
)
order by lock_record.granted, relation_name, lock_record.pid;
```

Do not continue while unexpected long-running transactions or conflicting locks are present. Batch 2B1 takes table locks while adding and validating constraints. The concurrent index avoids blocking normal writes for the full index build, but it still has startup and completion lock phases and can wait on old transactions.

### 8. Recovery readiness and deployment window

Before approval:

- Confirm the production backup/PITR capability that is already available; do not initiate restoration or change backup settings.
- Name the recovery owner and confirm that person is available throughout the deployment window.
- Record the start and end of the approved deployment window.
- Record the maximum acceptable lock wait and the operator responsible for stopping the rollout.
- Abort before deployment if relevant relations have unexpected ungranted locks or transactions old enough to threaten the approved window.
- During deployment, abort further steps if Batch 2B1 reaches its lock timeout or the concurrent index remains blocked beyond the recorded maximum. Preserve the error and lock evidence and follow the reviewed failure procedure.

## Controlled deployment sequence

1. Freeze migration changes and record hashes for both files.
2. Verify the linked project reference is exactly `jznuklvrhfivbdsxgiwv` and matches the project reference in the deployed Marketa `NEXT_PUBLIC_SUPABASE_URL`.
3. Confirm GitHub Branching and CI migration automation are inactive.
4. Run every read-only preflight above and preserve sanitized output.
5. Run `npx supabase db push --linked --dry-run` and review the exact ordered plan.
6. Obtain explicit production approval for the reviewed plan.
7. Run one controlled `npx supabase db push --linked` invocation. The CLI applies Batch 2B1 first, then executes the standalone index migration outside a transaction because of its first-line directive.
8. Do not retry automatically if either operation fails.
9. Verify migration history, database objects, security boundaries, index readiness, and business-data counts.
10. Run the manual vendor smoke test.

Do not use `--include-all`, `--include-seed`, migration repair, Dashboard SQL execution, GitHub Branching, or an Edge Function deployment for this rollout.

## Why the index migration is nontransactional

PostgreSQL rejects `CREATE INDEX CONCURRENTLY` inside a transaction block. Concurrent index creation uses multiple transactions and waits for transactions that could affect the index. Its main benefit is that normal inserts, updates, and deletes can continue during the index build. The standalone migration begins with `-- pg-delta: transaction=false`, contains no `BEGIN` or `COMMIT`, and contains only the one index statement.

Supabase CLI migration execution honors this directive. Supabase GitHub Branching currently runs migrations inside transactions and does not honor it, so GitHub Branching must not deploy this migration.

## Post-deployment verification

### 1. Migration history and index

Confirm both versions are recorded exactly once, then run the index query from the preflight. The expected result is:

- `table_name = public.order_items`
- `indisvalid = true`
- `indisready = true`
- definition equivalent to `CREATE INDEX order_items_product_id_idx ON public.order_items USING btree (product_id)`

If the row is absent, invalid, not ready, or points to a different table or expression, stop. Do not rerun the migration.

### 2. RPC signatures and authority

The exact functions must exist:

```text
public.configure_vendor_product_variant_mode(uuid,text)
public.create_vendor_product_variant(uuid,text,text,integer)
public.update_vendor_product_variant_labels(uuid,text,text)
public.update_vendor_product_variant_stock(uuid,integer,bigint)
public.delete_vendor_product_variant(uuid,bigint)
```

Verify owner, security mode, configuration, and effective execution rights:

```sql
select
  procedure.oid::pg_catalog.regprocedure::text as signature,
  owner_role.rolname as owner,
  procedure.prosecdef as security_definer,
  procedure.proconfig,
  pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
  pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_role_execute,
  exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) as acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_execute
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_roles as owner_role
  on owner_role.oid = procedure.proowner
where procedure.oid in (
  pg_catalog.to_regprocedure('public.configure_vendor_product_variant_mode(uuid,text)'),
  pg_catalog.to_regprocedure('public.create_vendor_product_variant(uuid,text,text,integer)'),
  pg_catalog.to_regprocedure('public.update_vendor_product_variant_labels(uuid,text,text)'),
  pg_catalog.to_regprocedure('public.update_vendor_product_variant_stock(uuid,integer,bigint)'),
  pg_catalog.to_regprocedure('public.delete_vendor_product_variant(uuid,bigint)')
)
order by signature;
```

Expected for each function:

- owner `postgres`
- `security_definer = true`
- `proconfig` contains `search_path=""`
- authenticated EXECUTE is true
- anon EXECUTE is false
- service-role EXECUTE is false
- PUBLIC EXECUTE is false

### 3. Security and regression checks

Verify:

- `products_variant_draft_publication_check` is validated and requires a variant-mode product to remain inactive.
- `product_variants_draft_only_check` is validated and requires every variant to remain inactive.
- Existing `products`, `product_variants`, and `order_items` RLS policies exactly match the preflight snapshot.
- No direct variant mutation privilege has been granted to browser or service roles.
- The Ops 4 finalizer and `decrement_stock` definitions retain the preflight hashes.
- Existing product, order, payment, payment-event, and order-item counts have not changed due to migration execution.
- No product with `variant_mode <> 'none'` is published.
- No variant is active.
- No customer or order row was created, changed, or deleted by the rollout.

## Manual vendor smoke test

Use an approved nonproduction seller/product fixture whenever possible. If production smoke testing is explicitly approved, use a designated inactive draft product with no order-item history and record identifiers only in the private operational log.

1. Sign in as the owning active vendor.
2. Call `configure_vendor_product_variant_mode` for an eligible inactive, zero-stock, ordinary draft and confirm `configured`.
3. Create variants that satisfy the selected mode and confirm they remain inactive.
4. Attempt a duplicate normalized size/colour combination and confirm `duplicate_combination`.
5. Update labels as the owner and confirm no stock or ownership field changes.
6. Update stock with the current `stock_version`; confirm success and a version increment.
7. Repeat with a stale `stock_version`; confirm `conflict` and no overwrite.
8. Confirm a signed-out/anon caller cannot execute any of the five RPCs.
9. Confirm another authenticated vendor cannot view or mutate the fixture and receives the controlled denial/not-found outcome.
10. Confirm variant-mode products and variants cannot be published.
11. Create a disposable unreferenced variant, then delete it with the current version and confirm `deleted`.
12. Re-run storefront, checkout, Paystack webhook, and Ops 4 regression checks for ordinary products without making a real payment.

Do not activate variants, enable variant purchasing, alter checkout, or use a product with historical order-item references.

## Failure handling and recovery

### Preflight or dry-run failure

- Abort before any mutation.
- Preserve sanitized output and the exact file hashes.
- Do not repair migration history or edit production manually.
- Prepare a reviewed corrective change and obtain new approval.

### Batch 2B1 failure

Batch 2B1 is transactional. PostgreSQL should roll back that migration on error. Stop, verify its history entry is absent, verify the five RPCs and two new constraints are absent, and compare all protected snapshots. Do not continue to the index or retry automatically.

### Concurrent-index failure

Concurrent index creation can leave an invalid index even though its migration history entry is not recorded. Stop and run the index verification query.

- Do not rerun `db push` while an invalid or not-ready index remains.
- Do not use `DROP INDEX` or migration repair without explicit approval.
- Document the exact PostgreSQL error, index catalog row, migration history, and active locks.
- Prepare a separate reviewed recovery plan, normally involving an explicitly approved `DROP INDEX CONCURRENTLY` for the invalid artifact followed by a new forward migration.

### Post-deployment or smoke-test failure

- Stop all further variant operations.
- Do not roll back by editing the applied migration or replaying an RPC.
- Capture sanitized function, constraint, policy, privilege, index, migration-history, and business-count evidence.
- Require approval for every corrective migration or data repair.

## Completion record

Record:

- approver and deployment operator
- deployment date and window
- backup/PITR availability and recovery owner
- maximum acceptable lock wait and any observed lock waits
- repository commit and both migration hashes
- verified production project reference
- dry-run output
- migration-list output
- post-deployment SQL results
- vendor smoke-test outcomes
- any warnings, waits, failures, or corrective approvals
