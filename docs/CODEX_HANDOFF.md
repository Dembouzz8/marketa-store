# Codex handoff — Marketa

Snapshot: 2026-10-08. Recheck the repository, linked migrations, and live
Supabase/Auth configuration before acting in a fresh conversation. The
repository and applied migrations take precedence over this handoff.

## Repository checkpoint

- Branch: `main`.
- HEAD: `674b3a48b21e23c1a0d2972f962d7e2d1d47c14d`
  (`complete paid order stock integrity`).
- Local `origin/main`: the same commit.
- The working tree was clean before this documentation update. This batch
  changes only `docs/CODEX_HANDOFF.md`, `README.md`, and `STOREFRONT_V2.md`.
- The repository and linked database contain 24 applied migrations through
  `20261007135410_add_atomic_paid_order_stock_finalization.sql`.
- Five Edge Functions are active: `handle-checkout`, `paystack-webhook`,
  `payment-status`, `initiate-vendor-provisioning`, and
  `dispatch-paid-order-outbox`. The dispatcher is active with
  `verify_jwt=false` and performs its own bearer authentication.

## Current product state

The storefront includes the homepage, searchable and filterable product
catalogue, product details, public vendor directory and storefronts, seller
application submission, and a persisted cart. Customer Auth, profiles, order
history, saved addresses, authenticated checkout, server-side payment
confirmation, and confirmed-payment cart finalization are implemented.

Customer, seller, and admin entry points share Supabase browser-session
infrastructure while retaining separate authorization checks. One Supabase
Auth UUID can represent a customer identity and own a vendor. A separate Auth
user or password is not created for seller access. A customer session alone
does not grant seller or admin authorization.

Vendor provisioning, shared account Auth, product and Storage activation
boundaries, and protected admin seller activation are production validated
through Batch 4C. Approval, provisioning, activation, and verification remain
separate states. Activation allows an approved and provisioned seller to sell;
it does not confer verification.

Atomic payment and stock finalization, the durable paid-order outbox, the
notification delivery ledger, the provider-neutral dispatcher, and the direct
Resend adapter are implemented. Real paid-order delivery is paused only at the
sender enablement boundary described below; that pause does not block
independent Marketa operations work.

## Vendor provisioning status

The core invariant is: **approved != provisioned != active != verified**.

### Foundation and review

- **Batch 1A — COMPLETE/APPLIED:** private `admin_users` authorization;
  vendor-application provisioning fields and state model; inactive-by-default
  vendors; narrowed seller privileges. Location-length reconciliation was
  applied separately.
- **Admin bootstrap — COMPLETE:** a confirmed, non-vendor Auth account was
  deliberately added to `admin_users`; no account identifier is recorded here.
- **Batch 1B — COMPLETE/APPLIED:** service-role-only transition functions:
  - `review_vendor_application(...)`
  - `claim_vendor_application_provisioning(uuid)`
  - `record_vendor_application_auth_identity(uuid, uuid, boolean)`
  - `fail_vendor_application_provisioning(uuid, text)`
  - `finalize_vendor_application_provisioning(uuid, uuid)`
- **Batch 2 — COMPLETE/DEPLOYED:** minimal admin application review UI with
  server-side admin authorization. Approval leaves an application at
  `approved/not_started`; approval alone does not create an Auth identity or
  vendor and does not activate or verify a vendor.

### Auth identity, invitation, and initiation

- **Batch 3A — COMPLETE/APPLIED:**
  `public.resolve_vendor_application_auth_identity(uuid)` is an
  application-scoped, read-only, service-role-only resolver.
- **Batch 3B — COMPLETE/DEPLOYED:** vendor Auth callback, pre-vendor onboarding
  landing, fixed customer-login return, and narrow proxy exceptions. Vendor
  dashboard protection remains in force.
- **Batch 3C1 — COMPLETE/PRODUCTION VALIDATED:** invite acceptance is
  scanner-safe. GET validates and stores the invite token in a short-lived
  HttpOnly cookie without consuming it; a token-free confirmation page
  requires explicit seller action; POST verifies the invite and establishes
  the cookie-backed Auth session. Failure paths discard partial Auth cookies.
- **Batch 3C2 — COMPLETE FOR TEST-MODE INFRASTRUCTURE:** Supabase custom SMTP
  through Resend test mode, the seller invitation template, and invitation
  delivery were validated. A production sending domain and sender remain
  deferred.
- **Batch 3D1 — COMPLETE/DEPLOYED/PRODUCTION VALIDATED:** the
  `initiate-vendor-provisioning` Edge Function verifies the caller and private
  admin membership, accepts only `application_id`, safely resolves or invites
  the application email, records the Auth UUID, and stops at
  `awaiting_enrollment`. It does not create, activate, or verify a vendor.
  Uncertain cross-system invitation outcomes require reconciliation and never
  trigger an automatic reinvite.
- **Batch 3D2 — COMPLETE/DEPLOYED/PRODUCTION VALIDATED:** the admin application
  UI invokes initiation through a same-origin Server Action and the current
  admin's cookie-backed Supabase session. Stable outcomes are mapped to
  controlled UI results; transport and malformed results remain uncertain and
  are not retried.

## Batch 3E — seller-owned finalization

**COMPLETE/PRODUCTION VALIDATED.** Application approval and invitation
acceptance do not create a vendor. An authenticated owner must explicitly
finalize seller enrollment from `/vendor/onboarding`.

- The server derives the current identity with `auth.getUser()` and requires a
  valid, confirmed Auth UUID and normalized email.
- Candidate applications are derived server-side from that identity. No
  client-supplied application ID, Auth UUID, or email is trusted.
- The application must be `approved/awaiting_enrollment`, linked to the exact
  Auth UUID and email, and have no vendor or provisioning timestamp.
- The existing privileged
  `finalize_vendor_application_provisioning(application_id, auth_user_id)`
  database authority performs finalization.
- Successful finalization creates the vendor with `is_active = false`, links
  it to the application, and moves provisioning to `provisioned`.
- Finalization does not activate or verify the vendor and creates no
  `vendor_verifications` row.
- Uncertain RPC outcomes are reconciled read-only and are never automatically
  replayed.

Production validation proved the test application reached `approved` and
`provisioned`, with an inactive vendor and zero verification rows.

## Batch 3F1 — shared account password setup

**COMPLETE/PRODUCTION VALIDATED.** A Marketa password belongs to the shared
Supabase Auth identity used for customer and seller sign-in.

- Newly invited sellers who do not already know a password are automatically
  routed to `/account/security/password` after successful finalization.
- Password setup uses the browser session and exactly
  `auth.updateUser({ password })`; service-role and Auth Admin authority do not
  handle the password.
- An existing customer whose confirmed email was reused for seller enrollment
  keeps the same Auth identity and existing password. They do not need a
  second seller password and may skip changing a password they already know.
- Production validation proved password setup, local seller logout, and
  subsequent `/vendor/login` with the chosen password. The same Auth/vendor
  relationship remained linked, and the vendor remained inactive and
  unverified.

The intended new-seller journey is:

`application -> approval -> enrollment invitation -> explicit invite`
`confirmation -> onboarding -> seller-account finalization -> password setup`
`-> seller dashboard`

## Batch 3F2 — shared scanner-safe password recovery

**COMPLETE/PRODUCTION VALIDATED.** Customer and seller login both link to the
same `/account/password/forgot` route. Recovery belongs to the shared Marketa
Auth account and is not vendor-specific.

The implemented flow is:

`/account/password/forgot -> resetPasswordForEmail() -> Recovery email`
`-> GET /account/auth/recovery -> transient HttpOnly recovery cookie`
`-> token-free /account/auth/recovery/confirm -> explicit POST`
`-> verifyOtp({ token_hash, type: "recovery" })`
`-> validated recovery session -> /account/password/reset`
`-> updateUser({ password })`

- Recovery GET validates but does not verify or consume the OTP.
- GET stores the token in the recovery-specific
  `marketa-password-recovery` cookie and removes it from the URL before the
  explicit human POST.
- The cookie is HttpOnly, `SameSite=Lax`, Secure in production, short-lived,
  and path-scoped to the recovery flow.
- POST validates same-origin browser evidence, verifies the OTP exactly once,
  and requires a returned session, Auth cookie writes, and a matching live
  confirmed user from `auth.getUser()`.
- Malformed, expired, invalid, or already-used recovery links fail through a
  controlled token-free route. Partial Auth cookie writes are not returned.
- The public request response is anti-enumerating and never exposes raw
  provider errors or whether an account exists.

Production validation proved that the recovery request was accepted, the
email arrived, the link reached the token-free confirmation page, explicit
POST reached the protected reset page, and the replacement password was set.
Seller logout/login and customer login both succeeded with that same
replacement password. At the Batch 3F2 validation point, application/vendor
state remained approved, provisioned, inactive, and without a verification
row. Activation was validated later as a separate Batch 4C action.

## Batch 4A — vendor product activation boundary

**COMPLETE/APPLIED/PRODUCTION VALIDATED.** Migration
`20260925120000_harden_vendor_product_activation_boundary.sql` enforces seller
activation at the product database boundary.

- Inactive sellers retain dashboard, settings, orders, payouts, and read-only
  access to their own product history.
- Inactive sellers cannot create, edit, delete, change stock, or toggle product
  status. Active sellers can manage their own products.
- New products default to inactive drafts.
- Public product visibility requires both `products.is_active = true` and an
  active owning vendor.
- Own-product SELECT remains independent of vendor activation.
- Authenticated sellers cannot update `vendors.is_active`.
- Verification is not part of this product-management or visibility boundary.

## Batch 4B1 — product-image Storage write boundary

**COMPLETE/APPLIED.** Migration
`20260925160000_harden_product_image_storage_write_boundary.sql` establishes
the seller Storage boundary for the public `product-images` bucket.

- The bucket remains public with a 5 MiB object limit and exactly JPEG, PNG,
  and WebP allowed MIME types.
- Authenticated active sellers may SELECT and INSERT only within their own
  vendor UUID namespace.
- Seller Storage UPDATE and DELETE authority is not granted.
- Application-generated names use
  `<vendorId>/<crypto.randomUUID()>.<mime-derived-extension>`.
- Six legacy root objects remained untouched during validation.
- Public bucket access means a person who already knows an exact object URL can
  fetch it independently of product/vendor listing visibility.

The real-image production smoke test is intentionally deferred until there is
an actual product/image the project owner wants to use. This does not make
Batch 4B1 incomplete.

## Batch 4C — seller activation

The governing business rule is: **activation and verification are separate.**
Activation allows an admin to permit an already approved and provisioned
seller to sell. Verification is a separate badge/status system and is not
required for activation.

### Batch 4C1 — database activation authority

**COMPLETE/APPLIED.** Migration
`20260926231820_add_vendor_activation_authority.sql` adds nullable
`vendors.activated_at timestamptz` and `vendors.activated_by uuid` fields.

- The activation-audit pair must be both null or both non-null.
- The existing legacy active seller received no fabricated audit metadata.
- `activated_by` is an unlinked UUID; no foreign key was added.
- Sellers cannot directly mutate activation authority.

`public.activate_vendor_application(p_application_id uuid,
p_admin_user_id uuid)` is postgres-owned, `SECURITY DEFINER`, uses an empty
fixed `search_path`, and grants execution only to `service_role`. It validates
current admin membership itself, locks and checks the application and linked
vendor, and requires an approved/provisioned application with consistent
linkage. A valid inactive seller is activated atomically with audit metadata;
a valid already-active seller returns the idempotent `already_active` outcome.
Unexpected failures return controlled `operation_failed` output without raw
internal errors.

Activation does not mutate verification, products, Storage, orders, payouts,
or application review/provisioning state.

### Batches 4C2, 4C3A, and 4C3B — admin flow and runtime hardening

**COMPLETE/DEPLOYED/PRODUCTION VALIDATED.** The protected admin
vendor-application detail page supports explicit seller activation.

- The route is admin-only and applies strict same-origin validation. Vercel
  production requires HTTPS forwarded protocol and a matching forwarded host.
- The browser submits only the application identity. Current admin identity
  and service-role RPC authority remain server-side.
- Uncertain transport or response outcomes never replay the mutation. Exactly
  one read-only reconciliation may prove the seller is active.
- The UI requires explicit two-step confirmation, explains the immediate
  selling effects, and states that activation does not verify the seller.
- Active state renders without another activation button. Internal actor UUIDs
  and raw database/server errors are not exposed.

The first controlled production attempts failed before RPC execution because a
`"use server"` module exported a non-function runtime object. Fixed diagnostic
markers identified the Next.js runtime failure. Commit `6c79fa1` moved the
initial action state out of the server-action runtime export surface. A later
controlled production activation succeeded, and no automatic or duplicate
mutation occurred during the failed attempts.

### Production validation snapshot — 2026-09-28

These counts are a dated validation snapshot, not permanent invariants:

- Vendors: 2 total, 2 active, 0 inactive.
- Complete activation-audit pairs: 1; partial pairs: 0.
- Vendor verification rows: 0.
- Products: 6.
- `product-images` Storage objects: 6.
- The newly activated disposable seller owned no products at activation time,
  so activation did not unexpectedly expose any of its own products.
- The application remained approved and provisioned, and the activation actor
  matched a valid admin.

No disposable email, Auth/admin/application/vendor UUID, IP address, password,
token, or private Vercel identifier is recorded here.

## Historical test-scope maintenance

**COMPLETE.** Commit `9727fc7` (`stabilize historical batch scope tests`)
replaced brittle present-working-tree positive allowlists in the closed Batch
4A, 4B1, and 4C1 tests.

- Closed-batch scope assertions now verify each immutable implementation
  commit's exact file set.
- Later legitimate changes no longer require extending historical allowlists.
- Existing functional and security invariant tests remain in place.
- A shallow or source-only checkout skips only an unavailable historical
  commit-scope assertion; it does not skip the functional/security suite.
- Validation passed 304 of 304 tests.

## Canonical site origin and hosted Auth configuration

`MARKETA_SITE_URL` is the server-only authoritative origin used to construct
the password-recovery redirect. Its current production value is:

```text
https://marketa-store.vercel.app
```

This Vercel origin is temporary until Marketa adopts its custom domain. At
that point, update `MARKETA_SITE_URL`, the Supabase Site URL where appropriate,
the recovery redirect allow-list, seller invitation callback/origin settings,
and public Auth-email links that depend on the canonical domain.

The hosted Supabase Recovery template constructs the scanner-safe link from
`{{ .RedirectTo }}` and `{{ .TokenHash }}`, with `type=recovery`, rather than
using a one-use verification URL directly.

## Paid-order operations checkpoint

### Completed Ops 3 implementation

- **Ops 3B1 — COMPLETE/APPLIED:** durable `paid_order` parent outbox.
- **Ops 3B2 — COMPLETE/APPLIED:** atomic paid-order producer inside the
  payment-finalization transaction.
- **Ops 3C1B — COMPLETE/APPLIED:** notification delivery child ledger.
- **Ops 3C1C — COMPLETE:** provider-neutral dispatcher core.
- **Ops 3C1C.1 — COMPLETE:** provider idempotency is scoped to each persisted
  child delivery attempt.
- **Ops 3C1D — COMPLETE:** direct Resend adapter, customer renderer, vendor
  renderer, bounded provider timeout, conservative provider outcome
  classification, dispatcher processing budget, and focused tests.

Payment finalization and notification delivery are separate authorities:

`Paystack/webhook/finalizer -> authoritative financial finalization`
`-> durable paid_order outbox event`

`paid_order outbox -> Marketa dispatcher -> notification delivery ledger`
`-> transactional provider`

The dispatcher is not payment authority. Missing sender configuration,
provider failure, or email delivery failure does not roll back or block a
completed financial finalization.

### Ops 3C1D runtime readiness

- `dispatch-paid-order-outbox` is deployed and `ACTIVE`.
- JWT gateway verification is disabled intentionally; the function validates
  its own `MARKETA_DISPATCHER_SECRET` bearer credential.
- `MARKETA_DISPATCHER_SECRET` is configured. No value is recorded here.
- Unsupported-method, missing-auth, wrong-auth, and valid-auth/provider-disabled
  gates were proven in production.
- The valid-auth provider-disabled request returned
  `DELIVERY_PROVIDER_NOT_CONFIGURED` before service-role client creation or a
  parent claim.
- The dispatcher has sent no paid-order email.

The sanitized live checkpoint is:

- 24 migrations are applied; the latest is `20261007135410`.
- Exactly two `paid_order` parents remain pending while dispatcher scheduling
  is paused. The controlled Ops 4 production purchase created the second.
- No parent is processing.
- `notification_deliveries` contains zero rows.
- `pg_cron` and `pg_net` are absent, and no scheduler is installed.

Do not record the order ID, event ID, payment reference, recipient addresses,
or any dispatcher/provider secret in repository documentation.

### Provider pause and sender decision

Ops 3 is **PAUSED**, with reason `VERIFIED_SENDING_DOMAIN_REQUIRED`.

- `RESEND_API_KEY` is intentionally not configured for the dispatcher.
- `MARKETA_EMAIL_FROM` is intentionally not configured.
- The connected Resend account has no verified Marketa-controlled sending
  domain and no established production direct-send identity.
- Resend's onboarding/default test sender must not be treated as a production
  sender.
- `dantesportsacademy.com` must not be used or depended on for Marketa
  notifications because Marketa does not control that domain's DNS.
- A future sender must use a Marketa-controlled domain. Once one is available,
  verify it in Resend and create/configure the dedicated dispatcher sending
  credential without reusing or changing the Supabase Auth SMTP credential.

Seller invitation and paid-order email remain distinct systems:

`application -> Supabase Auth inviteUserByEmail -> Auth-managed delivery`

`paid_order outbox -> dispatch-paid-order-outbox -> direct provider adapter`

Successful Auth-managed seller invitation delivery does not prove that the
paid-order dispatcher can use the same sender. Do not redesign seller
invitation email as part of the notification-domain pause.

### n8n transition and exact resume order

The Marketa-owned outbox, dispatcher, and delivery ledger are the replacement
critical notification architecture. The old direct n8n compatibility call
still exists in `paystack-webhook` and remains intentionally until the
replacement completes a real controlled delivery proof. Do not remove it yet.

Resume Ops 3 in exactly this order:

1. **3C1D-S — sender enablement:** verify a Marketa-controlled domain and
   configure the dedicated direct-send credential and sender.
2. **3C1E — controlled first production dispatch:** process the existing
   parent through the proven dispatcher path.
3. **3C2 — scheduler:** begin only after successful 3C1E.
4. **3D — remove the old n8n webhook notification call:** begin only after
   successful 3C1E.
5. **3E — failure/retry/idempotency operational proof:** remains after the
   scheduler and n8n transition work.
6. Mark Ops 3 complete only after those steps succeed.

Pending outbox events must never be deleted or manually marked delivered
merely because provider delivery is paused.

### Work unaffected by the pause

The sender-domain blocker does not prevent independent work on checkout,
payment finalization, order operations, fulfilment, reconciliation design,
refund design, fraud controls, admin operations, payout hardening, vendor
operations, or other work that does not require outbound customer/vendor
notification. These areas are not implied complete by this statement.

### Ops 4 — Paid Order Stock Integrity — COMPLETE

- **Ops 4A — COMPLETE:** read-only stock-integrity audit.
- **Ops 4B — COMPLETE:** atomic paid-order stock-finalization design.
- **Ops 4C — COMPLETE/APPLIED:** authoritative stock consumption was added to
  `finalize_paystack_paid_order` by
  `20261007135410_add_atomic_paid_order_stock_finalization.sql`.

Initial disposable runtime validation exposed invalid schema-qualified
multi-array `UNNEST` usage. The corrected migration uses paired `ROWS FROM`
expansion. Production applied it successfully. The installed normalized
finalizer body hash is `7d381e91b5fe6585d4d5e60c4d7f6cc8`; the contained
legacy `decrement_stock` definition remains unchanged at
`0094f1ea6602edbfe18ac8f9619677b8`.

The finalizer aggregates authoritative order-item quantities by product,
locks products with `FOR UPDATE` in deterministic product UUID order, and
performs the checked stock decrement inside the same rollback boundary as
payment completion, seller credits, order confirmation, and the `paid_order`
outbox insert. Disposable validation proved exact replay/idempotency,
downstream rollback, insufficient-stock reconciliation, product-unavailable
reconciliation, activation neutrality, and exact-once legacy pending-order
stock consumption.

Insufficient stock returns non-retryable `RECONCILIATION_REQUIRED` with
`PAID_STOCK_INSUFFICIENT` and no partial stock or financial effects. Missing
products use safe reconciliation. Product and vendor activation state is not
a paid-time stock gate.

The controlled production purchase proof passed:

- Purchased quantity: `1`.
- Aggregate product stock: `278 -> 277`.
- Order: confirmed.
- Payment: successful, financial contract version `2`.
- Finalization outcome: `FINALIZED`.
- Payment event: completed.
- New `paid_order` outbox events: exactly `1`.
- Products with negative stock: `0`.

Genuine two-session last-unit, overlapping-product, finalizer/delete-race, and
order-item `NOWAIT` tests were not executed because independent disposable
PostgreSQL sessions were unavailable. They remain **DEFERRED VALIDATION**, not
an Ops 4 completion blocker. Do not describe concurrency as proven.

Ops 4 does not add an artificial low-stock cutoff or a stock-reservation
system. Reservation remains a possible future hardening item if
paid-but-out-of-stock cases become operationally meaningful. Vendor stale
absolute stock overwrites remain a separate future inventory-hardening item.
Refunds, payouts, reconciliation operations, and notification delivery remain
outside the completed Ops 4 scope. Ops 3 communications remains paused and
separate. Do not restore historical WF3/WF4/WF5 ordering.

### Compact status summary

Completed:

- Storefront, shared account/payment recovery, and checkout hardening work
  recorded elsewhere in this handoff.
- Vendor provisioning, seller-owned finalization, shared Auth, activation,
  and product/Storage boundaries.
- Atomic payment finalization and the durable paid-order parent outbox.
- Paid-order notification child ledger, provider-neutral dispatcher,
  attempt-scoped provider idempotency, and direct Resend adapter.
- Dispatcher authentication and provider-disabled production deployment.
- Ops 4 paid-order stock integrity through production-applied Ops 4C and its
  controlled production purchase proof.

Paused:

- Real paid-order notification delivery.
- Reason: `VERIFIED_SENDING_DOMAIN_REQUIRED`.

Deferred behind sender readiness, in order:

- 3C1D-S
- 3C1E
- 3C2
- 3D
- 3E

Deferred validation:

- Genuine two-session Ops 4 concurrency and lock-contention exercises.

## Current next-safe-work boundaries

- The real product-image production smoke test remains deferred until the
  project owner has an actual product/image to use.
- Seller suspension, deactivation, and reactivation are a separate lifecycle.
- Verification workflow and badge administration remain separate from seller
  activation.
- Activation must continue to avoid incidental changes to verification,
  products, Storage objects, orders, payouts, and application
  review/provisioning state.

## Frozen and parked boundaries

- Seller suspension/deactivation/reactivation and verification administration
  remain separately authorized future work.
- Customer logout global/local semantics is a separate decision. Vendor logout
  uses local scope for the current browser session.
- The unrelated payout-table lint issue remains parked.
- Existing image warnings remain parked.
- Paid-order provider enablement and the ordered Ops 3 continuation remain
  paused at `VERIFIED_SENDING_DOMAIN_REQUIRED`.
- The old n8n compatibility call remains frozen until Ops 3D, after successful
  controlled delivery proof.
- Payment, order, payout, refund, and independent operations hardening require
  separately authorized work derived from a fresh audit.
- Stock reservation remains optional future hardening if paid-but-out-of-stock
  cases become operationally meaningful; Ops 4 does not implement it.
- Vendor stale absolute stock overwrites remain a separate future
  inventory-hardening item.
- The final custom storefront domain remains deferred; the temporary canonical
  Vercel origin remains in use.
- Customer order detail at `/account/orders/[id]` remains deferred.
- Existing product/storefront cleanup remains a separate backlog.

## Documentation alignment

This handoff, `README.md`, and `STOREFRONT_V2.md` reflect the repository and
stated production state through production-complete Ops 4 at `674b3a4`.
Real paid-order delivery remains paused before provider enablement. No
disposable identifiers, emails, invite material, recovery tokens, passwords,
session tokens, cookies, service-role credentials, dispatcher secrets, Resend
keys, or SMTP credentials belong in project documentation.
