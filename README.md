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

Deploy the guest-accessible `payment-status` Edge Function with JWT
verification disabled. It performs a read-only status lookup using an exact
order ID and payment reference and never returns private order data. Production
deployments should add distributed rate limiting at the platform or gateway
layer; this repository does not include suitable shared rate-limit
infrastructure, and an in-memory Edge Function limiter would not be reliable.

## Vendor Portal

The vendor dashboard is available at `/vendor/login`. Authenticated vendor users are redirected to `/vendor/dashboard`, while unauthenticated visitors are sent back to the login page.

To create a vendor account:

1. In Supabase, open Authentication > Users and create a user with an email and password.
2. Copy the new auth user ID.
3. Insert a matching row into the `vendors` table where `user_id` is the auth user ID.
4. Sign in at `/vendor/login` with that email and password.

## Seed Test Data in Supabase

Create a `products` table with columns matching the storefront type:

```sql
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null default gen_random_uuid(),
  name text not null,
  description text,
  price numeric not null,
  stock integer not null default 0,
  category text,
  images text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
```

Create the vendor tables used by the dashboard:

```sql
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  name text not null,
  email text not null,
  phone text,
  bank_details jsonb not null default '{}',
  platform_fee_pct numeric not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  customer_phone text,
  status text not null default 'pending',
  total_amount numeric not null default 0,
  payment_ref text,
  shipping_address jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  quantity integer not null,
  unit_price numeric not null,
  subtotal numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists payout_ledger (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  amount numeric not null,
  type text not null check (type in ('credit', 'debit')),
  reference text not null,
  description text,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);
```

Create the product image bucket:

```sql
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
```

Insert sample products:

```sql
insert into products
  (name, description, price, stock, category, images, is_active)
values
  (
    'Adire Tote Bag',
    'Handcrafted tote made with Nigerian adire fabric.',
    18500,
    12,
    'Fashion',
    array[]::text[],
    true
  ),
  (
    'Wireless Earbuds',
    'Compact earbuds with clear audio and long battery life.',
    42000,
    6,
    'Electronics',
    array[]::text[],
    true
  ),
  (
    'Lagos Spice Box',
    'A curated blend of spices for rich Nigerian meals.',
    9500,
    4,
    'Food',
    array[]::text[],
    true
  ),
  (
    'Glow Skincare Kit',
    'Daily skincare essentials for a simple routine.',
    26000,
    0,
    'Beauty',
    array[]::text[],
    true
  );
```
