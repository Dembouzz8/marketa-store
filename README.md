# Marketa Storefront

Marketa is a premium multi-vendor marketplace storefront for Nigerian vendors. It lists active products from Supabase, lets shoppers filter categories, manage a persisted cart, and submit checkout payloads to an n8n/Paystack workflow.

## Tech Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- shadcn/ui components
- Supabase JavaScript client
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
NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL=your_n8n_checkout_webhook_url
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
- `NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL`: Use the production webhook URL from the n8n workflow that creates a Paystack transaction and returns `authorization_url`.

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
    array['https://placehold.co/800x800/fef3c7/18181b?text=Adire+Tote'],
    true
  ),
  (
    'Wireless Earbuds',
    'Compact earbuds with clear audio and long battery life.',
    42000,
    6,
    'Electronics',
    array['https://placehold.co/800x800/e4e4e7/18181b?text=Earbuds'],
    true
  ),
  (
    'Lagos Spice Box',
    'A curated blend of spices for rich Nigerian meals.',
    9500,
    4,
    'Food',
    array['https://placehold.co/800x800/fed7aa/18181b?text=Spice+Box'],
    true
  ),
  (
    'Glow Skincare Kit',
    'Daily skincare essentials for a simple routine.',
    26000,
    0,
    'Beauty',
    array['https://placehold.co/800x800/fce7f3/18181b?text=Skincare'],
    true
  );
```
