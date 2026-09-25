# Codex handoff — Marketa

Snapshot: 2026-09-25. Recheck the repository, linked migrations, and live
Supabase/Auth configuration before acting in a fresh conversation. The
repository and applied migrations take precedence over this handoff.

## Repository checkpoint

- Branch: `main`.
- HEAD: `ff646404f19dda543fc99b4af387b9d5cd0fe5bb`
  (`add scanner-safe password recovery`).
- Local `origin/main`: the same commit.
- The working tree was clean before this documentation update. This batch
  changes only `docs/CODEX_HANDOFF.md`, `README.md`, and `STOREFRONT_V2.md`.
- Batches 3E, 3F1, and 3F2 added no migrations. The latest tracked migration
  remains `20260917120000_add_vendor_application_auth_identity_resolver.sql`;
  the prior linked check confirmed all 14 local and remote versions matched
  through that migration.

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

Vendor provisioning and shared account Auth are production validated through
Batch 3F2. The validated seller application is `approved/provisioned`, its
vendor is inactive, and it has zero verification rows. Approval, provisioning,
activation, and verification remain separate states.

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
replacement password. Application/vendor state remained approved,
provisioned, inactive, and without a verification row.

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

## Next security-hardening work: activation boundary

- Inactive vendors can currently reach product-management surfaces.
- Public product-read RLS relies on product active state without necessarily
  requiring the owning vendor itself to be active.
- Storefront UI behavior may hide inactive vendors, but direct Data API/RLS
  access must be audited and hardened independently.
- Checkout already rejects inactive vendors, but that does not replace
  product-management and product-read-policy hardening.
- Review new-product defaults and vendor-dashboard wording in the same batch.

This work is deferred and was not part of Batch 3F2. Do not activate or verify
vendors as an incidental fix.

## Frozen and parked boundaries

- Vendor activation and vendor verification remain deliberate later stages.
- Customer logout global/local semantics is a separate decision. Vendor logout
  uses local scope for the current browser session.
- The unrelated payout-table lint issue remains parked.
- Existing image warnings remain parked.
- Payment, order, outbox, payout, refund, stock, and n8n hardening contracts
  remain deferred and frozen unless separately authorized.
- The production Resend sending domain remains deferred.
- Customer order detail at `/account/orders/[id]` remains deferred.

## Documentation alignment

This handoff, `README.md`, and `STOREFRONT_V2.md` reflect the repository and
stated production validation through Batch 3F2. No disposable identifiers,
emails, invite material, recovery tokens, passwords, session tokens, cookies,
service-role credentials, Resend keys, or SMTP credentials belong in project
documentation.
