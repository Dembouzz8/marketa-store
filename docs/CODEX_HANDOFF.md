# Codex handoff — Marketa

Snapshot: 2026-09-17. Recheck repository, linked migrations, and live Auth
configuration before acting in a fresh conversation. The repository and
applied migrations take precedence over this handoff if they differ.

## Repository state

- Branch: `main`.
- HEAD: `212062c777b2a1a218de60e21e45fbebfac59af7` (`feat: add vendor application auth identity resolver`).
- Local `origin/main` tracking HEAD: the same commit.
- Working tree at this handoff: `README.md`, `STOREFRONT_V2.md`,
  `docs/CODEX_HANDOFF.md`, `src/proxy.ts`, and the customer login page are
  modified. The vendor callback and onboarding page are untracked new files.
  No migration was changed. Batch 3B has not been committed or deployed.
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
- **Vendor Provisioning Batch 3B — IMPLEMENTED LOCALLY, PENDING SOURCE REVIEW:**
  a strict invite-token callback, pre-vendor onboarding landing, fixed
  customer-login return, and narrow proxy routing. No real invitation was sent.

## Batch 3 status and boundary

- **Batch 3 read-only audit — COMPLETE.**
- **Batch 3 implementation — IN PROGRESS:** Batch 3A is complete. Batch 3B is
  implemented locally and validated with isolated checks, TypeScript, ESLint,
  and a production build; it awaits source review and has not been deployed.
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
surface. Edge orchestration and invitation remain unimplemented. Batch 3B
does not call this resolver or any provisioning RPC.

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

**Batch 3B is implemented locally, pending source review.** Its vendor Auth
callback, onboarding landing, fixed customer-login return, and narrow proxy
routing let pre-vendor paths be reached without granting vendor dashboard
access. Batch 3B sends no real invitations.

Because this app uses Next.js SSR/cookie Auth, a later invitation rollout must
customize the invite template to send a token hash to the fixed first-party
template target
`/vendor/auth/callback?token_hash={{ .TokenHash }}&type=invite` (template
syntax only; never record an issued invite link). The implemented route accepts
only one `token_hash` and `type=invite`, rejects all other query parameters,
verifies with server-side `verifyOtp`, writes the returned session cookies to
its redirect response, confirms the same user with `getUser`, then redirects to
`/vendor/onboarding`. Every failure goes to a fixed customer-login URL with a
controlled message. The dynamic onboarding page checks the authenticated user
and vendor membership with a user-scoped client; it redirects existing vendors
to the dashboard, sends signed-out users to customer login, and gives
non-vendors an informational landing. The proxy exempts only the exact callback
and onboarding paths. The customer login recognizes only
`vendor_onboarding=1` as a fixed return to `/vendor/onboarding`. These local
routes are not yet deployed. The Auth template and remote settings have not
been changed.

## Live-invitation blockers and next rollout gate

The last read-only linked-project audit found the Auth Site URL set to
localhost, no allowed vendor callback redirect, no production SMTP/email
provider, and a generic invite template rather than a Marketa vendor-specific
one. No existing Resend transactional-email helper was found in this
repository. Recheck these settings before rollout; they can change outside
Git. Do not enable the admin provisioning action or send real invitations
until Batch 3B has passed source review and been deployed, and production Auth
URLs/allow-list, template, and delivery provider are configured and tested.

## Documentation alignment

`README.md`, `STOREFRONT_V2.md`, and `docs/CODEX_HANDOFF.md` agree that
minimal admin application review and Batch 3A identity resolution are
implemented. Batch 3B callback, onboarding, login return, and proxy routing
are implemented locally pending source review. Batch 3 overall remains in
progress. Invitation, provisioning initiation, and finalization remain
unimplemented.
