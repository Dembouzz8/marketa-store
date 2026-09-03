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
- `NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL`: Use the public URL of the Supabase `handle-checkout` Edge Function. That function validates the current order data, creates the pending order, initializes the Paystack transaction, and returns `authorization_url`.

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
`/account/addresses` and `/account/auth/callback`. Registration uses email and
password. Checkout identity is not accepted from browser form fields: email
comes from the verified Auth user, while required full name and phone values
come from the separate `public.customer_profiles` table.

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
  dashboard access. Review tooling and automatic vendor provisioning are not
  implemented.

Vendor logo and storage support remains a deferred enhancement. Payment and
paid-order outbox redesign remains separately deferred and frozen.

## Vendor Portal

The vendor dashboard is available at `/vendor/login`. Authenticated vendor users are redirected to `/vendor/dashboard`, while unauthenticated visitors are sent back to the login page.

To create a vendor account:

1. In Supabase, open Authentication > Users and create a user with an email and password.
2. Copy the new auth user ID.
3. Insert a matching row into the `vendors` table where `user_id` is the auth user ID.
4. Sign in at `/vendor/login` with that email and password.

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
