# Codex handoff — Marketa

Snapshot: 2026-09-17. Recheck repository, linked migrations, and live Auth
configuration before acting in a fresh conversation. The repository and
applied migrations take precedence over this handoff if they differ.

## Repository state

- Branch: `main`.
- HEAD: `6cb1ae694d1e0d3a95d089f2dfa13ee1e6b53e70` (`docs: add codex handoff and sync provisioning status`).
- Local `origin/main` tracking HEAD: the same commit.
- Working tree at this handoff: `README.md`, `STOREFRONT_V2.md`, and this
  handoff are modified; the Batch 3A migration is present but untracked. No
  application source or migration file was edited by this documentation update.
- Linked migrations: all 14 local and remote versions match through
  `20260917120000_add_vendor_application_auth_identity_resolver.sql`. The
  Batch 3A migration is applied to the linked project; its local source is
  still untracked.

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

## Batch 3 status and boundary

- **Batch 3 read-only audit — COMPLETE.**
- **Batch 3 implementation — IN PROGRESS:** Batch 3A is complete; Batch 3B
  has not started.
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
surface. Edge orchestration and invitation remain unimplemented.

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

**Batch 3B is the next implementation sub-batch:** add the vendor Auth
callback, onboarding landing, and narrow proxy routing so the pre-vendor
paths are reachable. Batch 3B must not send real invitations.

Because this app uses Next.js SSR/cookie Auth, customize the invite template
to send a token hash to the fixed first-party template target
`/vendor/auth/callback?token_hash={{ .TokenHash }}&type=invite` (template
syntax only; never record an issued invite link). The route should verify it
with server-side Supabase
`verifyOtp`, establish the cookie session, then redirect to
`/vendor/onboarding`. This is a design requirement, not an existing route or
template. Do not rely on a client page consuming the default fragment
session. Do not reuse the customer `/account/auth/callback`, which handles a
different flow. Update the proxy narrowly so the vendor callback and
pre-vendor onboarding path are reachable before a vendor row exists.

## Live-invitation blockers and next rollout gate

The last read-only linked-project audit found the Auth Site URL set to
localhost, no allowed vendor callback redirect, no production SMTP/email
provider, and a generic invite template rather than a Marketa vendor-specific
one. No existing Resend transactional-email helper was found in this
repository. Recheck these settings before rollout; they can change outside
Git. Do not enable the admin provisioning action or send real invitations
until the callback/onboarding route, production Auth URLs/allow-list,
template, and delivery provider are configured and tested.

## Documentation alignment

`README.md`, `STOREFRONT_V2.md`, and `docs/CODEX_HANDOFF.md` agree that
minimal admin application review and Batch 3A identity resolution are
implemented. Batch 3 overall remains in progress. Vendor callback,
onboarding, invitation, provisioning initiation, and finalization remain
unimplemented.
