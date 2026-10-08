# Marketa Storefront V2 Specification

## Project goal

Improve the Marketa customer storefront into a complete,
functional multi-vendor marketplace experience.

This work must preserve the existing:

- Supabase integration
- Zustand cart
- Paystack checkout flow
- Supabase Edge Functions
- Vendor dashboard
- Marketa black, white and amber visual identity

Do not modify the vendor dashboard, payout workflows, refund
workflows or payment confirmation architecture unless a task
explicitly requires it.

---

## 1. Homepage improvements

The homepage should introduce Marketa, highlight selected products,
show important categories and direct users to dedicated pages.

### Required changes

- Remove the visible total product count such as “6 products”.
- Do not display the total number of products on the homepage.
- Remove the unsupported statistics:
  - 2,500+ Products
  - 340+ Vendors
  - 15,000+ Customers
- Replace those statistics with genuine marketplace benefits:
  - Secure Paystack Payments
  - Verified Nigerian Vendors
  - Order Updates
  - Customer Support
- Make every visible navigation link and button functional.
- Keep the current black, white and amber brand identity.
- Improve mobile spacing, readability and button sizing.

### Homepage sections

Use this order:

1. Navbar
2. Hero
3. Shop by Category
4. Featured Products
5. Featured Vendors
6. Why Shop on Marketa
7. Seller Call to Action
8. How Marketa Works
9. Footer

### Hero actions

- “Shop Now” must navigate to `/products`.
- “Become a Vendor” must navigate to `/sell-with-us`.
- “Sell With Us” must navigate to `/sell-with-us`.

### Homepage products

- Show only featured or recently added products.
- Do not show the total product count.
- Include a “View All Products” link to `/products`.
- Product cards must link to their product detail pages.

---

## 2. Navigation

The main customer navigation should include:

- Home → `/`
- Products → `/products`
- Categories → `/products`
- Vendors → `/vendors`
- About → `/about`
- Sell With Us → `/sell-with-us`

The account and vendor experiences must remain separate.

- Customer account → `/account`
- Vendor login → `/vendor/login`

Every navigation item must have a valid destination.
No visible link or button should remain inactive.

---

## 3. Product catalogue

Create a dedicated product catalogue at:

`/products`

The page must display all active products and support:

- Search
- Category filtering
- Price range filtering
- Availability filtering
- Vendor filtering
- Sorting
- Pagination or “Load more”
- Loading states
- Empty states
- Error states

### Search query

Search terms should be preserved in the URL:

`/products?q=ankara`

Search should cover:

- Product name
- Product description
- Category
- Vendor/store name

### Sorting options

- Relevance
- Newest
- Price: Low to High
- Price: High to Low

### Mobile filters

On mobile devices, filters should open in a drawer, modal or
bottom sheet rather than taking permanent horizontal space.

---

## 4. Product detail pages

Create product detail routes using either:

`/products/[slug]`

or:

`/products/[id]`

Choose the route style that best fits the current database schema.

Each product page should show:

- Product images
- Full product name
- Full description
- Price
- Stock status
- Vendor name
- Quantity selector
- Add to cart
- Delivery information
- Return information
- Related products
- More products from the same vendor

Do not introduce fake ratings, reviews or discounts.

---

## 5. Categories

Initial top-level categories:

1. Fashion
2. Phones & Tablets
3. Computing
4. Electronics
5. Home & Kitchen
6. Appliances
7. Beauty & Personal Care
8. Food & Groceries
9. Baby, Kids & Toys
10. Health & Wellness
11. Sports & Fitness
12. Automotive Accessories

Categories should eventually be stored in the database rather than
hard-coded throughout the frontend.

Do not create database migrations during the first homepage phase.

Category cards and filter controls must navigate to or update the
product catalogue.

Suggested URL format:

`/products?category=fashion`

---

## 6. Search

The navbar search icon must work.

When activated:

- Display a search input.
- Allow the customer to enter a product search.
- Submit to `/products?q=<search-term>`.
- Preserve the search term on the product catalogue page.
- Display a useful empty state when no results are found.

The search interaction must work on desktop and mobile.

---

## 7. Vendors

Create a vendor directory at:

`/vendors`

Each vendor card should display:

- Store name
- Store logo or placeholder
- Main category
- Location when available
- Verified status when genuinely verified
- Visit Store button

Create public vendor storefront routes using:

`/vendors/[slug]`

or:

`/vendors/[id]`

A vendor storefront should show:

- Vendor information
- Store description
- Vendor products
- Shipping information
- Return information

Do not display fake ratings, fake order counts or fake sales figures.

---

## 8. Sell With Us

Create a seller landing page at:

`/sell-with-us`

The page should explain:

- Why vendors should join Marketa
- How selling works
- Seller requirements
- Marketplace commission information
- Secure payment and payout process
- Access to the vendor dashboard

Required actions:

- “Start Selling”
- “Already a Vendor? Log In”

The login action must navigate to `/vendor/login`.

The initial Start Selling action may open an application form or
navigate to a vendor application page.

---

## 9. About page

Create an About page at:

`/about`

It should explain:

- What Marketa is
- The problem Marketa solves
- Marketa’s focus on Nigerian buyers and vendors
- Vendor verification
- Secure payments
- Customer protection
- Marketa’s mission

Avoid unsupported claims and invented business statistics.

---

## 10. Footer

Every footer link must work or be removed until its destination
exists.

Suggested groups:

### Shop

- Products
- Categories
- Vendors

### Sell

- Sell With Us
- Vendor Login
- Seller Guide
- Commission Rates

### Support

- Help Centre
- Track Order
- Returns
- Contact

### Company

- About
- Privacy
- Terms
- Vendor Policy

During early phases, do not render links to unfinished pages unless
a properly designed temporary page exists.

---

## 11. Customer accounts

Customers may browse the homepage, catalogue, product details and public
vendor storefronts, and may manage a cart without signing in. Purchase is an
authenticated customer experience: signed-out customers who proceed to
checkout are sent to `/account/login?checkout=1`, where they may sign in or
create an account.

Customer authentication uses Supabase Auth with email and password. The
implemented customer routes are:

- `/account`
- `/account/login`
- `/account/register`
- `/account/profile`
- `/account/orders`
- `/account/addresses`
- `/account/auth/callback`
- `/account/security/password`
- `/account/password/forgot`
- `/account/auth/recovery`
- `/account/auth/recovery/confirm`
- `/account/password/reset`

Customer profile data is stored in `public.customer_profiles`, separately from
Auth metadata. A complete checkout profile requires `full_name` and `phone`.
Checkout identity comes from trusted sources:

- Email comes from the verified Supabase Auth user.
- Full name and phone come from `customer_profiles`.
- Browser checkout fields are not trusted as customer identity.

### Authenticated checkout and order ownership

The browser sends a Bearer Auth access token. Its checkout request contains,
logically:

```json
{
  "checkout_attempt_id": "...",
  "items": [
    {
      "product_id": "...",
      "quantity": 1
    }
  ],
  "shipping_address": {
    "address": "...",
    "city": "...",
    "state": "..."
  }
}
```

It does not supply customer ID, name, email or phone, product prices, or a
saved-address ID. `handle-checkout` independently verifies the authenticated
user, obtains customer identity from Auth and `customer_profiles`, and obtains
authoritative product and price data server-side.

New authenticated purchases store the verified Supabase Auth user UUID in
`orders.customer_id`. Customer order access is ownership-based, and customer
history queries explicitly filter `customer_id` to the authenticated user's
ID. Historical guest orders whose `customer_id` is `NULL` remain unowned; they
are not matched or claimed by email.

### Customer order history

`/account/orders` shows only the authenticated customer's orders, newest
first, with pagination. Each summary includes the order ID, placed date,
status, total, item quantity, and a safe product preview with a
`Product unavailable` fallback.

The customer order-detail route `/account/orders/[id]` is deferred and must
not be treated as implemented.

### Saved addresses and shipping snapshots

At `/account/addresses`, customers can create, edit and delete saved addresses
and set a default. Each customer may have zero or one default address. A saved
address contains a label, address, city and Nigerian state; it does not contain
customer email, name, phone or order-ownership data.

During checkout, a customer may select a saved address or enter an address
manually. Selection copies the address, city and state into the existing
checkout shipping snapshot. The saved-address row ID is not sent to
`handle-checkout`, and checkout does not offer a "Save this address" mutation;
saved-address CRUD remains under `/account/addresses`.

`customer_addresses` is mutable convenience data, while
`orders.shipping_address` is the historical order snapshot. Editing or
deleting a saved address does not change previous orders, and orders have no
foreign key to `customer_addresses`.

### Payment confirmation and cart finalization

The cart is not cleared when payment initialization begins or when the shopper
is redirected to Paystack. It remains intact for abandoned payments and for
pending, failed or unknown confirmation states.

After trusted payment confirmation, the storefront requires the matching
pending checkout and clears the cart only when its fingerprint still matches
the purchased cart. Changed cart contents and unrelated or newly added items
are preserved.

Customer account UX remains separate from vendor login and dashboard UX. A
customer session alone does not grant vendor dashboard access; vendor access
continues through `/vendor/login` and the vendor authorization model.

### Shared customer and seller authentication

Marketa uses one Supabase Auth UUID for a person's customer access and optional
vendor ownership. The Auth identity, customer profile, vendor row, vendor
verification, and vendor activation are distinct records or states. Seller
enrollment does not create a second Auth user or a separate vendor password.

After successful seller-owned finalization, newly invited sellers who do not
already know a password are automatically routed to
`/account/security/password`. Existing customers whose confirmed email is
reused keep their existing Auth identity and password and may skip changing
it. Password setup runs in the browser with `auth.updateUser({ password })`;
service-role and Auth Admin authority do not handle the password.

Both customer and vendor login link to `/account/password/forgot`. Shared
scanner-safe recovery uses this flow:

`/account/password/forgot -> resetPasswordForEmail() -> Recovery email`
`-> GET /account/auth/recovery -> transient HttpOnly recovery cookie`
`-> token-free confirmation page -> explicit POST`
`-> verifyOtp({ token_hash, type: "recovery" })`
`-> validated session -> /account/password/reset`
`-> updateUser({ password })`

Recovery GET does not consume the OTP. The recovery-specific cookie is
HttpOnly, `SameSite=Lax`, Secure in production, short-lived, and scoped to the
recovery flow. Malformed and expired links fail through controlled token-free
output, and the request UI does not disclose whether an account exists.

`MARKETA_SITE_URL` is the server-only authority used to construct the recovery
redirect. Its current production value, `https://marketa-store.vercel.app`, is
temporary until Marketa adopts a custom domain. A domain change must also
update the relevant Supabase Site URL, recovery allow-list, seller invitation
callback/origin settings, and public Auth-email links. The hosted Recovery
template builds its scanner-safe link from `{{ .RedirectTo }}` and
`{{ .TokenHash }}`.

---

## 12. Implementation phases

### Phase 1 — Homepage and navigation

**Status: Complete.**

- Remove the product count
- Remove unsupported statistics
- Fix all navigation links
- Make search functional
- Connect all homepage CTAs
- Create the initial Products, Vendors, About and Sell With Us pages
- Preserve the existing cart and checkout

### Phase 2 — Product discovery

**Status: Implemented and substantially complete in the current repository.**

- Full product catalogue
- Product search
- Filters
- Sorting
- Pagination or Load More
- Product detail pages
- Expanded categories

### Phase 3 — Vendors and seller onboarding

**Status: Complete for the agreed MVP scope.**

- Vendor directory at `/vendors`
- Public vendor storefronts at `/vendors/[id]`
- Public vendor profile data exposed through `public_active_vendors`
- Verified vendor presentation backed by `vendor_verifications`
- Sell With Us content at `/sell-with-us`
- Durable, private vendor application foundation
- Public application form and RPC submission at `/sell-with-us/apply`

Minimal application review tooling was implemented separately after the Phase
3 MVP scope. Authorized admins sign in at `/admin/login`, list applications at
`/admin/vendor-applications`, view application details, and start review,
approve, or reject. Admin membership is private and checked server-side;
reviewer identity is derived from the authenticated admin session. Approval
leaves `status = approved` and `provisioning_status = not_started`. It does not
provision an Auth identity, create or activate a vendor, or verify one.

Vendor provisioning, shared Auth, and seller activation are production
validated through Batch 4C:

- Batches 3A–3D provide application-scoped identity resolution, scanner-safe
  invitation acceptance, controlled admin initiation, Auth identity recording,
  and the `awaiting_enrollment` boundary.
- Batch 3E requires explicit authenticated owner action to finalize. The server
  derives the Auth UUID and confirmed normalized email and derives the
  application without trusting a client-supplied application ID. The existing
  privileged database authority creates the vendor inactive and moves the
  application to `provisioned`.
- Batch 3F1 automatically routes newly invited sellers to shared Marketa
  password setup after finalization. Existing customers reuse their Auth
  identity and password.
- Batch 3F2 provides shared scanner-safe password recovery for customer and
  seller login.

Batch 3 production validation proved seller finalization, password setup,
seller logout/login, recovery-email delivery, token-free explicit
confirmation, replacement-password setup, and both seller and customer login
with the same replacement password. The application reached approved and
provisioned while the seller remained inactive until the separate activation
stage.

### Completed seller activation and product boundaries

- **Batch 4A complete:** inactive sellers retain dashboard, settings, orders,
  payouts, and read-only access to their own product history. They cannot
  create, edit, delete, change stock, or toggle product status. Active sellers
  can manage their own products, and new products default to inactive drafts.
- Public product visibility requires an active product and an active owning
  vendor. Own-product SELECT remains independent of vendor activation, and
  sellers cannot update `vendors.is_active`.
- **Batch 4B1 complete/applied:** the public `product-images` bucket retains a
  5 MiB limit and allows JPEG, PNG, and WebP. Authenticated active sellers may
  SELECT and INSERT only within their own vendor UUID namespace. Seller UPDATE
  and DELETE remain unavailable. Generated object names use
  `<vendorId>/<crypto.randomUUID()>.<mime-derived-extension>`, and legacy root
  objects remain untouched.
- The bucket remains public, so an exact known object URL can be fetched
  independently of product/vendor listing visibility. A real-image production
  smoke test is deferred until there is an actual product/image the project
  owner wants to use; Batch 4B1 itself is complete.
- **Batch 4C complete/production validated:** the protected admin application
  detail page activates an already approved and provisioned seller through a
  strict same-origin, server-authorized, explicit two-step action. Activation
  unlocks selling authority but does not verify the seller. Ambiguous mutation
  results are reconciled once read-only and are never automatically replayed.

Approval, provisioning, activation, and verification remain separate. Vendor
logo support remains deferred. The payment and paid-order outbox work has
advanced to the Ops 3 runtime checkpoint documented below.

### Phase 4 — Customer experience

**Status: Complete for MVP.**

- Supabase customer authentication and customer account routes
- Customer profiles with required checkout name and phone
- Authenticated purchase requirement
- Server-enforced order ownership
- Paginated customer order history
- Saved-address management
- Saved-address selection during checkout
- Confirmed-payment cart finalization

Deferred Phase 4 enhancements:

- Customer order detail at `/account/orders/[id]`
- Optional future account and customer UX enhancements

Separate existing backlogs remain outside Phase 4 and are not Phase 4
blockers: refunds, payout scheduling, stock decrement redesign, seller
suspension/deactivation/reactivation, verification workflow administration,
and other separately authorized vendor portal cleanup.

---

## 13. Operations checkpoint

### Completed paid-order foundations

- **Ops 3B1 complete:** durable `paid_order` parent outbox.
- **Ops 3B2 complete:** atomic paid-order producer inside payment
  finalization.
- **Ops 3C1B complete:** notification delivery child ledger.
- **Ops 3C1C complete:** provider-neutral dispatcher core.
- **Ops 3C1C.1 complete:** provider idempotency scoped to persisted child
  attempts.
- **Ops 3C1D complete:** direct Resend adapter, customer and vendor renderers,
  bounded provider timeout, conservative provider classification, dispatcher
  processing budget, and focused tests.

Payment finalization and notification delivery remain separate authorities:

`Paystack/webhook/finalizer -> financial finalization -> paid_order outbox`

`paid_order outbox -> Marketa dispatcher -> notification delivery ledger`
`-> provider`

Provider or email failure does not roll back or block completed financial
finalization. The dispatcher is not payment authority.

### Runtime state and pause

`dispatch-paid-order-outbox` is deployed, active, and configured with
`verify_jwt=false` plus internal bearer authentication through
`MARKETA_DISPATCHER_SECRET`. Its HTTP/authentication and provider-disabled
gates were proven without claiming a pending parent. Production currently has
24 applied migrations through `20261007135410`, two pending paid-order parents
while dispatcher scheduling is paused, zero notification delivery rows, and
no `pg_cron`, `pg_net`, or scheduler. The second parent was created by the
controlled Ops 4 production purchase proof.

Ops 3 is paused with reason `VERIFIED_SENDING_DOMAIN_REQUIRED`. Marketa does
not currently control a verified sending domain. `RESEND_API_KEY` and
`MARKETA_EMAIL_FROM` are intentionally not configured for the dispatcher.
Resend's onboarding/default test sender is not a production identity, and
`dantesportsacademy.com` is unavailable because Marketa does not control that
domain's DNS. Do not invent or hard-code a future domain.

Resume in this exact order:

`3C1D-S sender enablement -> 3C1E controlled first production dispatch`
`-> 3C2 scheduler -> 3D remove old n8n notification call`
`-> 3E failure/retry/idempotency operational proof -> Ops 3 complete`

Do not begin 3C2 or 3D before successful 3C1E. Pending outbox events must not
be deleted or manually marked delivered because delivery is paused. The old
direct n8n compatibility call remains in `paystack-webhook` until the
replacement path has completed controlled delivery proof.

Seller provisioning email is a separate path:

`application -> Supabase Auth inviteUserByEmail -> Auth-managed delivery`

It is not evidence that the paid-order dispatcher can use the same default
sender and must not be redesigned as part of this pause.

The sender-domain blocker does not prevent independent checkout, payment,
order, fulfilment, reconciliation, refund, fraud-control, admin, payout,
vendor, or other non-notification operations work.

### Ops 4 — Paid Order Stock Integrity

**Status: COMPLETE in production.** Ops 4A completed the read-only audit, Ops
4B completed the atomic paid-order stock design, and Ops 4C implemented that
design in
`20261007135410_add_atomic_paid_order_stock_finalization.sql`.

Disposable runtime validation initially exposed invalid schema-qualified
multi-array `UNNEST` usage. The corrected function uses paired `ROWS FROM`
array expansion. Its installed normalized body hash is
`7d381e91b5fe6585d4d5e60c4d7f6cc8`; `decrement_stock` remains unchanged at
`0094f1ea6602edbfe18ac8f9619677b8`.

Paid-order quantities are aggregated by product. Products are locked with
`FOR UPDATE` in deterministic UUID order, revalidated, and decremented inside
the same rollback boundary as payment completion, seller credits, order
confirmation, and the `paid_order` outbox insert. Exact replay does not
decrement again. Downstream failure rolls back tentative stock and financial
work together. Insufficient stock produces non-retryable
`RECONCILIATION_REQUIRED` without partial stock or financial effects, and an
unavailable product resolves safely to reconciliation. Valid legacy pending
orders also consume stock exactly once. Product and vendor activation state
is intentionally not a paid-time stock gate.

The controlled production proof purchased quantity `1`. Aggregate stock moved
from `278` to `277`; the order was confirmed; the payment succeeded with
financial contract version `2`; finalization returned `FINALIZED`; the payment
event completed; exactly one `paid_order` outbox event was created; and no
product had negative stock.

Genuine two-session last-unit, overlapping-product, finalizer/delete-race, and
order-item `NOWAIT` tests were not executed because independent disposable
PostgreSQL sessions were unavailable. They remain **deferred validation**, not
an Ops 4 completion blocker. Do not claim concurrency was proven.

Ops 4 does not implement stock reservation and does not impose an artificial
low-stock cutoff. Reservation is a possible future hardening item if
paid-but-out-of-stock cases become operationally meaningful. Vendor stale
absolute stock overwrites remain a separate future inventory-hardening item.
Refunds, payouts, reconciliation operations, and notification delivery remain
outside the completed Ops 4 scope. Ops 3 communications remains paused and
separate.

---

## 14. Technical boundaries

During storefront work:

- Do not expose the Supabase service role key.
- Do not trust prices received from the frontend.
- Do not move payment confirmation into the frontend.
- Do not move payment confirmation into n8n.
- Do not break the Zustand persisted cart.
- Do not modify the vendor dashboard without explicit approval.
- Do not modify payout, refund or reconciliation workflows.
- Do not create database migrations unless the current phase requires them.

After code changes, run:

```bash
npm run lint
npm run build
```

Fix all introduced errors before completing the task.
