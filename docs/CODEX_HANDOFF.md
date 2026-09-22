# Codex handoff — Marketa

Snapshot: 2026-09-22. Recheck the repository, linked migrations, and live
Supabase/Auth configuration before acting in a fresh conversation. The
repository and applied migrations take precedence over this handoff.

## Repository checkpoint

- Branch: `main`.
- HEAD: `4b2cc05a89a2ab6db4ab28b583909ada4920ee3c`
  (`add admin vendor provisiong control`).
- Local `origin/main`: the same commit.
- Working tree before this documentation update was clean. At this handoff,
  only `docs/CODEX_HANDOFF.md` is modified.
- Linked migration state: all 14 local and remote versions match through
  `20260917120000_add_vendor_application_auth_identity_resolver.sql`. Batch 3D
  added no migration.

## Current product state

The storefront includes the homepage, searchable and filterable product
catalogue, product details, public vendor directory and storefronts, seller
application submission, and a persisted cart. Customer Auth, profiles, order
history, saved addresses, authenticated checkout, server-side payment
confirmation, and confirmed-payment cart finalization are implemented.

Customer, vendor, and admin entry points share Supabase browser-session
infrastructure while retaining separate authorization checks. A customer
session alone does not grant vendor or admin access.

## Vendor provisioning status

Batch 3 remains **IN PROGRESS**. It is production validated through the
`awaiting_enrollment` boundary; seller-owned finalization is the next batch.

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
  server-side admin authorization. Approval leaves the application at
  `approved/not_started`; it does not provision an identity or vendor.

The core invariant is: **approved != provisioned != active != verified**.

### Auth identity and invitation acceptance

- **Batch 3A — COMPLETE/APPLIED:**
  `public.resolve_vendor_application_auth_identity(uuid)` is an
  application-scoped, read-only, service-role-only resolver. Controlled
  outcomes are `existing_confirmed`, `existing_unconfirmed`, `not_found`,
  `vendor_collision`, `ambiguous_identity`, `invalid_state`, `unavailable`,
  and `invalid_input`. Linked validation confirmed owner `postgres`,
  `SECURITY DEFINER`, an empty `search_path`, no execution by `anon` or
  `authenticated`, and execution by `service_role`.
- **Batch 3B — COMPLETE/DEPLOYED:** vendor Auth callback, pre-vendor onboarding
  landing, fixed customer-login return, and narrow proxy exceptions. Vendor
  dashboard protection remains in force.
- **Batch 3C read-only audit — COMPLETE:** the production Auth URL, redirect,
  invitation-template, expiry/rate-limit, and email-delivery configuration
  were inspected before rollout.
- **Batch 3C1 — COMPLETE/PRODUCTION VALIDATED:** scanner-safe invite acceptance:
  - `GET /vendor/auth/callback` validates one bounded `token_hash` with
    `type=invite`, never calls `verifyOtp`, writes a transient HttpOnly cookie,
    and redirects without the token to `/vendor/auth/confirm`.
  - `/vendor/auth/confirm` requires an explicit seller action.
  - `POST /vendor/auth/callback` accepts a same-origin request or trustworthy
    same-origin browser metadata, reads the transient cookie, then calls
    `verifyOtp`. Success establishes the cookie-backed Auth session and
    redirects to `/vendor/onboarding`.
  - Failure paths clear the transient cookie and do not return partially
    written Auth cookies.
  - Production hotfix validation confirmed `Referrer-Policy: same-origin` on
    the confirmation page, `Referrer-Policy: no-referrer` on the callback,
    correct invite-cookie serialization, and a browser flow that reaches
    `/vendor/onboarding`.
- **Batch 3C2 — COMPLETE FOR TEST-MODE INFRASTRUCTURE:** Supabase custom SMTP
  through Resend test mode, the seller invitation template, and invitation
  delivery were validated. A production sending domain and sender remain
  deliberately deferred; no production sending domain is claimed here.

### Batch 3D provisioning initiation

- **Batch 3D1 — COMPLETE/COMMITTED/PUSHED/DEPLOYED/PRODUCTION VALIDATED:** the
  `initiate-vendor-provisioning` Supabase Edge Function is active with
  `verify_jwt = true`.
- The function explicitly calls `auth.getUser(accessToken)`, derives the caller
  from that verified user, checks private `admin_users` membership, and
  rechecks membership immediately before any invitation.
- A separate service-role client performs the narrow Auth Admin and
  provisioning-RPC operations. Service-role credentials never enter the
  browser.
- The request accepts only `application_id`. Admin/reviewer IDs, email, Auth
  UUID, vendor UUID, fees, activation, verification, and redirect URL cannot
  be supplied by the caller.
- The invitation destination is fixed to
  `https://marketa-store.vercel.app/vendor/auth/callback`.
- The function never finalizes provisioning, creates a vendor, activates a
  vendor, or verifies a vendor.
- There is no automatic invitation retry or `in_progress` takeover. Supabase
  Auth and Postgres are separate systems, so any uncertain invitation side
  effect returns `reconciliation_required` and must not trigger a reinvite.
- Pre-invite application read, admin recheck, and invalid application-data
  failures use the safe failure transition when its result can be proven. If
  the transition cannot be proven, the function returns
  `reconciliation_required` rather than claiming a safely retryable state.

Supported initiation paths:

1. `approved/not_started` or `approved/failed` is claimed, then the scoped
   identity resolver runs.
2. `existing_confirmed` reuses the confirmed Auth UUID, records
   `p_invited = false`, moves to `awaiting_enrollment`, and stops.
3. `not_found` sends exactly one controlled invitation, validates the returned
   identity, resolves again, records `p_invited = true`, moves to
   `awaiting_enrollment`, and stops.
4. `existing_unconfirmed`, vendor collision, or ambiguity enters a controlled
   manual/reconciliation path without a blind invitation.
5. `already_in_progress` returns `reconciliation_required` without work or
   takeover.

Batch 3D1 verification passed 28 focused tests, the project typecheck, Edge
static TypeScript check, changed-file lint, production build, and diff check.

- **Batch 3D2 — COMPLETE/COMMITTED/PUSHED/VERCEL PRODUCTION
  VALIDATED:** admin initiation now follows:

  `Admin form -> Next Server Action -> assertAdminOrigin() -> requireAdmin()`
  `-> cookie-backed Supabase server client`
  `-> functions.invoke("initiate-vendor-provisioning")`
  `-> Edge JWT/admin validation -> controlled UI result`

- `approved/not_started` shows **Start seller enrollment**.
- `approved/failed` shows an explicit **Retry seller enrollment** control.
- `in_progress` shows reconciliation guidance and no submit control.
- `awaiting_enrollment` shows waiting guidance and no submit control.
- A provisioned application, or an application with vendor/provisioned
  linkage, shows no initiation control.
- The Server Action sends only `application_id`, uses the user's cookie-backed
  session, does not use a service-role client, does not manually forward
  privileged credentials, and does not retry transport or uncertain failures.
  It maps only stable function outcomes, treats malformed or transport
  responses as uncertain, and revalidates the admin list and detail paths.

Batch 3D2 passed 8 focused admin tests. The combined Batch 3D report passed
36/36 tests, project typecheck, changed-file lint, production build, and diff
check before deployment.

## Production validation through awaiting enrollment

- The deployed Edge Function was verified active with `verify_jwt = true`.
- A request without authorization returned HTTP 401.
- A request with an invalid bearer JWT returned HTTP 401.
- A disposable approved application began at `approved/not_started` with no
  Auth linkage, vendor linkage, provisioning timestamp, matching Auth user, or
  matching vendor.
- One admin click reported that the invitation was sent, moved the application
  to `awaiting_enrollment`, created and recorded the Auth identity, and set the
  application and Auth invitation timestamps. It did not create a vendor or
  set `vendor_id` or `provisioned_at`.
- The seller accepted the delivered invitation through the confirmation page,
  explicitly continued enrollment, and reached `/vendor/onboarding`.
- Final verification showed an approved application still at
  `awaiting_enrollment`, the same linked Auth UUID, a confirmed Auth email,
  `last_sign_in_at`, and an active session. `vendor_id` and `provisioned_at`
  remained null, with no vendor or vendor-verification row.

No disposable identifiers, email addresses, invite material, session tokens,
cookies, service-role credentials, Resend keys, or SMTP credentials belong in
project documentation.

## Immediate next batch: seller-owned finalization

Implement only an explicit, authenticated seller finalization action:

1. Verify the current Auth session on the server.
2. Require the session user's UUID to exactly equal
   `vendor_applications.auth_user_id`.
3. Require the confirmed, normalized Auth email to exactly equal the
   application's normalized email.
4. Call the existing
   `finalize_vendor_application_provisioning(application_id, auth_user_id)`
   authority.
5. Create the inactive vendor, set `provisioning_status = provisioned`, and
   stop.

Do not trust a request-supplied Auth UUID or email. Invite acceptance alone
must not silently finalize enrollment. This batch must not activate or verify
the vendor, create `vendor_verifications`, or change payments, orders, outbox,
payouts, refunds, stock, or n8n.

## Frozen and parked boundaries

- Vendor activation and vendor verification remain deliberate later stages.
- Customer logout global/local semantics is a separate decision. The completed
  vendor logout uses local scope for the current browser session.
- The unrelated payout-table lint issue remains parked.
- Existing image warnings remain parked.
- Payment, order, outbox, payout, refund, stock, and n8n contracts remain
  frozen.
- The production Resend sending domain remains deferred.

## Documentation alignment

This handoff reflects the current repository and the stated production
validation through Batch 3D. `README.md` and `STOREFRONT_V2.md` still contain
older Batch 3 status text that predates 3C2 and 3D; they were intentionally not
modified in this handoff-only batch. Update their canonical status sections in
a separately approved documentation batch when required.
