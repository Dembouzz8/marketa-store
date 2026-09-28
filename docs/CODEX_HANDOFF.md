# Codex handoff — Marketa

Snapshot: 2026-09-28. Recheck the repository, linked migrations, and live
Supabase/Auth configuration before acting in a fresh conversation. The
repository and applied migrations take precedence over this handoff.

## Repository checkpoint

- Branch: `main`.
- HEAD: `9727fc76f86cf33d2ad7310566e99b6cea1464d6`
  (`stabilize historical batch scope tests`).
- Local `origin/main`: the same commit.
- The working tree was clean before this documentation update. This batch
  changes only `docs/CODEX_HANDOFF.md`, `README.md`, and `STOREFRONT_V2.md`.
- The repository and linked database contain 17 applied migrations through
  `20260926231820_add_vendor_activation_authority.sql`.
- The current Vercel production deployment is READY from `9727fc7`. That
  commit changes test harnesses only. The seller-activation runtime fix is
  `6c79fa15545a269061ff242347f7c146166209a3`
  (`fix seller activation server action exports`).

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
- Payment, order, outbox, payout, refund, stock, and n8n hardening contracts
  remain deferred and frozen unless separately authorized.
- The production Resend sending domain remains deferred.
- The final custom storefront domain remains deferred; the temporary canonical
  Vercel origin remains in use.
- Customer order detail at `/account/orders/[id]` remains deferred.
- Existing product/storefront cleanup remains a separate backlog.

## Documentation alignment

This handoff, `README.md`, and `STOREFRONT_V2.md` reflect the repository and
stated production validation through Batch 4C and the historical test-scope
maintenance at `9727fc7`. No disposable identifiers, emails, invite material,
recovery tokens, passwords, session tokens, cookies, service-role credentials,
Resend keys, or SMTP credentials belong in project documentation.
