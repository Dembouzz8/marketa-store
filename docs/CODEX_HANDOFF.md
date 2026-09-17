# Codex handoff — Marketa

Snapshot: 2026-09-17. Recheck repository, linked migrations, and live Auth
configuration before acting in a fresh conversation. The repository and
applied migrations take precedence over this handoff if they differ.

## Repository state

- Branch: `main`.
- HEAD: `f153dc6453fa43bb81a931f61148e7f11960ce4a` (`feat: add vendor enrollment auth landing flow`).
- Local `origin/main` tracking HEAD: the same commit.
- Working tree at this handoff: `README.md`, `STOREFRONT_V2.md`,
  `docs/CODEX_HANDOFF.md`, `src/app/vendor/auth/callback/route.ts`, and
  `src/proxy.ts` are modified. The confirmation page and isolated Batch 3C1
  test file are untracked. No migration was changed. Batch 3C1 is local and
  has not been committed or deployed.
- Linked migrations: all 14 local and remote versions match through
  `20260917120000_add_vendor_application_auth_identity_resolver.sql`. The
  Batch 3A migration is applied to the linked project and tracked locally.

## Overall Marketa status

The current storefront has a homepage, searchable/filterable product
catalogue and detail pages, public vendor directory/storefronts, seller
application submission, and a persisted cart. Customer Auth, profile, order
history, saved addresses, authenticated checkout, server-side payment
confirmation, and confirmed-payment cart finalization are implemented.
Vendor login/dashboard and the public vendor-verification presentation remain
separate from customer accounts. This summary does not declare every deferred
storefront or vendor enhancement complete.

## Vendor provisioning work completed

- **Vendor Provisioning Batch 1A — COMPLETE:** private `admin_users`
  authorization foundation; application provisioning state; future vendors
  inactive by default; protected vendor activation and platform-fee fields.
- **Location reconciliation — COMPLETE:** vendor-application location maximum
  aligned with the vendor profile's 120-character limit.
- **Vendor Provisioning Batch 1B — COMPLETE:** service-role-only
  `review_vendor_application`, `claim_vendor_application_provisioning`,
  `record_vendor_application_auth_identity`,
  `fail_vendor_application_provisioning`, and
  `finalize_vendor_application_provisioning` functions.
- **First admin bootstrap — COMPLETE:** one confirmed non-vendor Auth account
  was deliberately added to `admin_users`. No account identifier is recorded
  here.
- **Vendor Provisioning Batch 2 — COMPLETE:** `/admin/login`, protected admin
  vendor-application list/detail, and start-review/approve/reject actions.
  Reviewer identity comes from the authenticated admin session. There is no
  provisioning control, Auth Admin call, vendor activation, or verification.
- **Vendor Provisioning Batch 3A — COMPLETE:** application-scoped,
  service-role-only, read-only Auth identity resolution through
  `public.resolve_vendor_application_auth_identity(uuid)`. Its migration was
  source-reviewed, applied, and validated on the linked project.
- **Vendor Provisioning Batch 3B — COMPLETE/DEPLOYED:** a strict invite-token
  callback, pre-vendor onboarding landing, fixed customer-login return, and
  narrow proxy routing were committed and deployed. No real invitation was sent.
- **Batch 3C read-only audit — COMPLETE:** production Auth URL, redirect,
  template, and email-delivery configuration were checked. The chosen
  production origin is `https://marketa-store.vercel.app`; real invitations
  remain disabled.
- **Vendor Provisioning Batch 3C1 — IMPLEMENTED LOCALLY, PENDING SOURCE REVIEW:**
  scanner-safe invite acceptance now requires an explicit POST after a
  token-free confirmation page. It has not been deployed.

## Batch 3 status and boundary

- **Batch 3 read-only audit — COMPLETE.**
- **Batch 3 implementation — IN PROGRESS:** Batch 3A is complete and its
  migration is applied. Batch 3B is committed and deployed. The Batch 3C
  audit is complete. Batch 3C1 is implemented locally and validated with
  isolated tests, TypeScript, ESLint, and a production build; it awaits source
  review and has not been deployed.
- Goal: Auth identity resolution, invitation, and provisioning initiation.
  Admin approval leaves an application `approved/not_started`; an authorized
  admin must explicitly start provisioning.
- Required Batch 3 stopping point: `status = approved`,
  `provisioning_status = awaiting_enrollment`, `auth_user_id` recorded,
  `vendor_id = NULL`, and `provisioned_at = NULL`.
- Batch 3 must **not** call `finalize_vendor_application_provisioning()`.
  Finalization belongs to a later explicit, authenticated vendor-enrollment
  action by the recorded account owner.

Batch 3A accepts only an application UUID and derives the normalized email
inside the resolver. Linked validation confirmed owner `postgres`,
`SECURITY DEFINER`, an empty `search_path`, no EXECUTE for `anon` or
`authenticated`, and EXECUTE for `service_role`. An approved/not_started
application resolved read-only as expected, with no application, vendor, or
Auth data mutation. Batch 3A does not claim provisioning, send invitations,
create Auth users, record application Auth identity, create vendors, finalize
provisioning, activate vendors, or verify vendors.

Approval is not provisioning; provisioning is not activation; activation is
not verification. An existing customer Auth identity must be reused, never
duplicated merely because the customer becomes a vendor. Matching email alone
does not establish consent to vendor enrollment. The actual account owner
must authenticate before finalization. A vendor row, when eventually created,
starts inactive; verification is separate. Auth Admin/service-role credentials
remain server-only.

## Batch 3 implementation direction

Use a dedicated Supabase Edge Function as the trusted authority. The browser
may send only an application UUID with the admin session JWT. The function
must call `auth.getUser(jwt)`, derive the caller UUID, check private
`admin_users` membership, then use service-role provisioning RPCs and Auth
Admin operations. Do not accept browser-supplied admin/reviewer UUID, email,
Auth UUID, vendor UUID, fee, activation, verification, or redirect URL.

The installed Supabase SDK has no suitable get-user-by-email API. Batch 3A
added the narrow, service-role-only `SECURITY DEFINER` Auth resolver scoped
to an application ID. It derives the application email internally and returns
only controlled identity states, never a general arbitrary-email enumeration
surface. Edge orchestration and invitation remain unimplemented. Neither
Batch 3B nor Batch 3C1 calls this resolver or any provisioning RPC.

- Existing confirmed customer: reuse the Auth UUID, record it with
  `p_invited = false`, enter `awaiting_enrollment`, and send a separate
  approved/sign-in notification. Do not reinvite or finalize.
- New email: trusted server calls `auth.admin.inviteUserByEmail()` with a
  fixed vendor callback destination, verifies the returned UUID/email, and
  records with `p_invited = true`. Do not finalize.
- Existing unconfirmed Auth account: do not blindly reinvite or create a
  duplicate; use controlled remediation/recovery.
- Existing vendor collision: fail closed for manual review; never merge or
  adopt automatically.

Batch 1B's claim operation has no worker lease. Treat `in_progress` and
uncertain invite responses as reconciliation cases, not permission to send a
second invitation automatically. Auth Admin and database writes are not one
transaction.

### Vendor invitation callback — chosen direction

**Batch 3B is complete and deployed.** Its vendor Auth callback, onboarding
landing, fixed customer-login return, and narrow proxy routing let pre-vendor
paths be reached without granting vendor dashboard access. Batch 3B sent no
real invitations.

Because this app uses Next.js SSR/cookie Auth, a later invitation rollout must
customize the invite template to send a token hash to the fixed first-party
template target
`/vendor/auth/callback?token_hash={{ .TokenHash }}&type=invite` (template
syntax only; never record an issued invite link). Batch 3C1 changes the
deployed callback behavior locally: GET accepts only one bounded `token_hash`
and `type=invite`, rejects all other query parameters, stores a ten-minute
HttpOnly invite cookie scoped to `/vendor/auth`, and redirects to the clean
`/vendor/auth/confirm` page without verifying the token. An explicit,
same-origin POST reads only that cookie, calls `verifyOtp` once through an
anon SSR client, requires a session and user, confirms the same user with
`getUser`, clears the transient cookie, and redirects to `/vendor/onboarding`.
Failure uses a fixed customer-login destination and discards any response
containing partially written Auth cookies. An already consumed invite may not
be recoverable after a later verification failure. The callback and confirm
responses use `private, no-store` and `no-referrer` headers. The dynamic
onboarding page checks the authenticated user and vendor membership with a
user-scoped client; it redirects existing vendors to the dashboard, sends
signed-out users to customer login, and gives non-vendors an informational
landing. The proxy exempts only the exact callback and confirm paths from its
signed-out vendor gate; vendor dashboard, order, and product protections remain.
The customer login recognizes only `vendor_onboarding=1` as a fixed return to
`/vendor/onboarding`. Batch 3C1 has not been deployed. The hosted Auth
template and remote settings have not been changed.

## Live-invitation blockers and next rollout gate

The completed Batch 3C read-only audit confirmed the production origin
`https://marketa-store.vercel.app`, while hosted Auth still used
`http://localhost:3000` as its Site URL, had no additional allowed redirect
URLs, used the generic invite template with `.ConfirmationURL`, and had no
custom SMTP. The configured invite expiry was one hour and the email rate
limit was two per hour. The sender provider/domain remains undecided. No
existing Resend transactional-email helper was found in this repository.
Recheck hosted settings before rollout; they can change outside Git. Keep real
invitations disabled until Batch 3C1 is reviewed and deployed and production
Auth URLs/allow-list, invite template, and delivery provider are configured
and tested. Provisioning orchestration remains unimplemented.

## Documentation alignment

`README.md`, `STOREFRONT_V2.md`, and `docs/CODEX_HANDOFF.md` agree that
minimal admin application review and Batch 3A identity resolution are
implemented, Batch 3B is deployed, Batch 3C audit is complete, and Batch 3C1
is local pending source review. Batch 3 overall remains in progress.
Invitation, provisioning initiation, and finalization remain unimplemented.
