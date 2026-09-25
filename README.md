# Marketa Storefront

Marketa is a premium multi-vendor marketplace storefront for Nigerian vendors. It lists active products from Supabase, lets shoppers filter categories, manage a persisted cart, and submit checkout payloads to a Supabase Edge Function.

## Tech Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- shadcn/ui components
- Supabase JavaScript client
- Supabase SSR auth helpers
- Zustand with persisted cart state
- Framer Motion animations
- lucide-react icons
- canvas-confetti for payment success feedback

## Getting Started

Install dependencies:

```bash
npm install
```

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL=https://your-project.supabase.co/functions/v1/handle-checkout
MARKETA_SITE_URL=https://your-explicit-development-origin.example
```

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`: Find this in Supabase under Project Settings > API > Project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Find this in Supabase under Project Settings > API > Project API keys > anon public.
- `NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL`: Use the public URL of the Supabase
  `handle-checkout` Edge Function. That function validates the current order
  data, creates the pending order, initializes the Paystack transaction, and
  returns `authorization_url`.
- `MARKETA_SITE_URL`: Required server-only authoritative origin used to build
  password-recovery redirects. The current production value is the temporary
  Vercel origin `https://marketa-store.vercel.app`. For local or development
  use, set an explicitly chosen HTTPS origin appropriate to that environment
  and configure the corresponding Supabase Auth URLs. The application does not
  infer this value from request or forwarded-host data and fails closed when
  the value is missing or invalid.

Configure Paystack's webhook URL to point to the Supabase
`paystack-webhook` Edge Function. That webhook is the server-side payment
authority responsible for confirming Paystack events. n8n may handle
downstream operational automation, but it does not initialize or confirm
customer payment.

Deploy the public `payment-status` Edge Function with JWT verification
disabled. It is a payment verification/status surface that performs a
read-only lookup using an exact order ID and payment reference and never
returns private order data. Purchase initialization remains authenticated and
is handled separately by `handle-checkout`. Production deployments should add
distributed rate limiting at the platform or gateway layer; this repository
does not include suitable shared rate-limit infrastructure, and an in-memory
Edge Function limiter would not be reliable.

## Customer Experience and Checkout

The homepage, catalogue, product details, public vendor storefronts and cart
are available without signing in. Purchase requires a Supabase Auth customer
account: signed-out checkout redirects to `/account/login?checkout=1`, which
supports both sign-in and account creation.

Customer account routes include `/account`, `/account/login`,
`/account/register`, `/account/profile`, `/account/orders`,
`/account/addresses`, `/account/auth/callback`, shared password setup and
shared password recovery. Registration uses email and password. Checkout
identity is not accepted from browser form fields: email comes from the
verified Auth user, while required full name and phone values come from the
separate `public.customer_profiles` table.

Authenticated checkout sends a Bearer access token plus a checkout attempt,
product IDs and quantities, and a shipping-address snapshot.
`handle-checkout` verifies the user and stores the verified Auth UUID in
`orders.customer_id`; customer order history at `/account/orders` is filtered
to that owner. Historical orders with `customer_id = NULL` remain unowned and
are not claimed by email. The MVP order-history page is paginated and newest
first; customer order detail at `/account/orders/[id]` is deferred.

Customers manage saved addresses at `/account/addresses`, including create,
edit, delete and default selection, with at most one default address. Checkout
can copy a saved address into its shipping snapshot or accept a manual address;
it does not send the saved-address ID or save addresses during checkout.
`customer_addresses` remains mutable convenience data, whereas
`orders.shipping_address` is an immutable historical snapshot with no foreign
key to a saved address. Editing or deleting a saved address therefore does not
change an existing order.

The persisted cart is retained through payment initialization, redirect,
abandonment, and pending, failed or unknown verification. After trusted
payment confirmation, the matching pending checkout clears the cart only when
the current cart fingerprint still matches the purchased cart, preserving
changed carts and unrelated or newly added items.

Customer account UX is separate from the vendor login and dashboard. A
customer session by itself does not grant vendor dashboard access.

### Shared customer and seller identity

Marketa uses one Supabase Auth identity for customer and seller access. An
Auth user may own a vendor without creating a second Auth user, and the
password belongs to that shared Marketa account.

After an invited seller explicitly finalizes enrollment, a seller who does
not already know a password is automatically routed to
`/account/security/password`. Password setup uses the browser session and
`auth.updateUser({ password })`; it does not use service-role or Auth Admin
authority. Existing customers whose confirmed email is reused keep their
existing identity and password and may skip password setup.

Both `/account/login` and `/vendor/login` link to the shared public recovery
page at `/account/password/forgot`. The scanner-safe recovery flow stores the
email token briefly in a recovery-specific HttpOnly, `SameSite=Lax` cookie,
removes it from the URL, and waits for an explicit POST from the token-free
confirmation page before calling
`verifyOtp({ token_hash, type: "recovery" })`. The protected reset page updates
the shared password with `auth.updateUser({ password })`. Recovery responses
do not disclose whether an account exists or expose raw provider errors.

## Public Vendors and Seller Applications

- `/vendors` lists active sellers from the `public_active_vendors` view.
- `/vendors/[id]` shows the public vendor profile and that vendor's active
  products. Public storefront code does not read private `vendors` fields.
- The public projection contains only `id`, `name`, `slug`, `description`,
  `main_category`, `location`, `shipping_info`, `return_info`, and the derived
  `is_verified` value.
- Verification is controlled separately through `vendor_verifications`.
- `/sell-with-us/apply` submits prospective-seller information through the
  `submit_vendor_application` RPC. The underlying `vendor_applications` table
  is private to direct public, anonymous, and authenticated access.
- An application submission does not create an Auth user, vendor row, or
  dashboard access. Authorized admins can sign in at `/admin/login`, list
  applications at `/admin/vendor-applications`, view application details, and
  start review, approve, or reject. Admin membership is checked privately on
  the server, and reviewer identity comes from the authenticated admin session.
- Approval leaves `status = approved` and `provisioning_status = not_started`.
  It does not itself create an Auth identity or vendor and does not activate or
  verify a vendor.
- Provisioning initiation is deployed and production validated. An authorized
  admin starts enrollment; the server resolves or invites the application
  email, records the Auth UUID, and stops at `awaiting_enrollment`.
- Invite acceptance is scanner-safe and requires an explicit POST from a
  token-free confirmation page. Invitation acceptance establishes the shared
  Auth session but does not create the vendor.
- Seller-owned finalization requires explicit action by the authenticated
  owner. The server derives the Auth UUID and confirmed normalized email,
  derives the application without trusting a client application ID, and calls
  the existing privileged database finalization authority.
- Successful finalization links the application and creates an inactive
  vendor with `provisioning_status = provisioned`. It does not activate or
  verify the vendor and creates no `vendor_verifications` row.
- Production validation proved an application at `approved/provisioned`, an
  inactive vendor, and zero verification rows. Shared password setup and
  customer/seller password recovery were also production validated without
  changing that application or vendor state.

Vendor logo and storage support remains a deferred enhancement. Payment and
paid-order outbox redesign remains separately deferred and frozen.

## Vendor Portal

The vendor dashboard is available at `/vendor/login`. Authenticated vendor
owners are redirected to `/vendor/dashboard`, while unauthenticated visitors
are sent to the login page.

The intended new-seller journey is:

`application -> approval -> enrollment invitation -> explicit invite`
`confirmation -> onboarding -> seller-account finalization -> password setup`
`-> seller dashboard`

The finalization step creates the vendor inactive. Activation and verification
remain separate administrative stages.

### Deferred activation-boundary hardening

Inactive vendors can currently reach product-management surfaces. Public
product-read RLS relies on product active state without necessarily requiring
the owning vendor itself to be active. Storefront UI behavior may hide an
inactive vendor, and checkout rejects inactive vendors, but neither replaces a
direct Data API/RLS audit. A dedicated security batch must harden product
management and product-read policies and review new-product defaults and
vendor-dashboard wording.

When Marketa adopts a custom domain, update `MARKETA_SITE_URL`, relevant
Supabase Site URL and recovery redirect settings, seller invitation
callback/origin configuration, and public Auth-email links. The hosted
Recovery template uses `{{ .RedirectTo }}` and `{{ .TokenHash }}` to construct
the scanner-safe Marketa recovery link.

## Seed Test Data in Supabase

The tracked files in `supabase/migrations/` are the source of truth for the
current public vendor profile, verification, application, checkout, and product
policy changes. Do not replace the linked project's schema with simplified
`create table` snippets.

To seed storefront products, first create or identify a vendor through the
controlled administrative process described above. Ensure the vendor is active,
then use its real UUID when inserting products. For example, replace the
placeholder UUID below before running the statement:

```sql
insert into products
  (vendor_id, name, description, price, stock, category, images, is_active)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'Adire Tote Bag',
    'Handcrafted tote made with Nigerian adire fabric.',
    18500,
    12,
    'Fashion',
    array[]::text[],
    true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'Wireless Earbuds',
    'Compact earbuds with clear audio and long battery life.',
    42000,
    6,
    'Electronics',
    array[]::text[],
    true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'Lagos Spice Box',
    'A curated blend of spices for rich Nigerian meals.',
    9500,
    4,
    'Food',
    array[]::text[],
    true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'Glow Skincare Kit',
    'Daily skincare essentials for a simple routine.',
    26000,
    0,
    'Beauty',
    array[]::text[],
    true
  );
```

Populate optional public profile fields on the vendor row when needed. Add a
`vendor_verifications` row only through an authorized administrative path when
the vendor is genuinely verified. Do not seed `vendor_applications` directly;
use `/sell-with-us/apply` when testing the public submission flow with explicitly
approved disposable data.
