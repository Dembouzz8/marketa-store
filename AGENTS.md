# AGENTS.md — Marketa Marketplace Storefront

This file is the single source of truth for building the
Marketa storefront. Read every section in order before writing
any code. Complete each section fully before moving to the next.
Do not skip steps. Do not summarise or partially implement any
section.

---

## SECTION 1 — PROJECT SETUP

Run these commands in the integrated terminal in order:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes
```

```bash
npx shadcn@latest init --defaults
```

```bash
npx shadcn@latest add button card badge sheet dialog toast skeleton separator input label select scroll-area avatar dropdown-menu
```

```bash
npm install @supabase/supabase-js zustand framer-motion lucide-react canvas-confetti @types/canvas-confetti next-themes clsx tailwind-merge
```

Verify the project compiles cleanly before continuing:

```bash
npm run build
```

---

## SECTION 2 — ENVIRONMENT VARIABLES

Create `.env.local` in the project root with exactly these
keys. Leave the values as placeholders — the developer will
fill them in:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL=your_n8n_checkout_webhook_url
```

---

## SECTION 3 — DESIGN SYSTEM

Apply this design language consistently across every component.

### Colors
- Page background: white `#ffffff`
- Secondary background: `zinc-50`
- Card background: white with `zinc-100` border
- Navbar + Footer: `zinc-900` (`#18181b`)
- Primary text: `zinc-900`
- Secondary text: `zinc-500`
- Accent / CTA / prices: `amber-500` (`#f59e0b`)
- Success states: `emerald-500`
- Error states: `red-500`
- Borders: `zinc-200`

### Typography
- Font: Inter (via `next/font/google`)
- Hero headline: `text-5xl font-bold tracking-tight` desktop,
  `text-3xl` mobile
- Section headlines: `text-3xl font-semibold`
- Product names: `text-base font-semibold`
- Prices: `text-lg font-bold text-amber-600`
- Body copy: `text-sm text-zinc-600`

### Layout
- Max width: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`
- Section padding: `py-16` desktop, `py-10` mobile
- Card padding: `p-4`

### Elevation
- Default card: `shadow-sm`
- Hovered card: `shadow-md` (transition)
- Modal: `shadow-2xl`
- Navbar: `border-b border-zinc-800`

### Border radius
- Cards: `rounded-xl`
- Buttons: `rounded-lg`
- Badges: `rounded-full`
- Inputs: `rounded-lg`

### Framer Motion — standard patterns
- Page entrance: `opacity 0→1`, `y 20→0`, duration `0.4s`
- Staggered grid: `staggerChildren: 0.05`
- Card hover: `scale 1.01`, shadow increase
- Cart sidebar: `x 100%→0`
- Modal: `scale 0.95→1` + fade

---

## SECTION 4 — PROJECT STRUCTURE

Create exactly this directory and file structure:

```
src/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── product/
│   │   └── [id]/
│   │       └── page.tsx
│   └── payment-success/
│       └── page.tsx
├── components/
│   ├── navbar.tsx
│   ├── hero.tsx
│   ├── category-filter.tsx
│   ├── product-grid.tsx
│   ├── product-card.tsx
│   ├── product-skeleton.tsx
│   ├── cart-sidebar.tsx
│   ├── checkout-modal.tsx
│   ├── footer.tsx
│   └── providers.tsx
├── lib/
│   ├── supabase.ts
│   ├── store.ts
│   └── utils.ts
└── types/
    └── index.ts
```

---

## SECTION 5 — TYPES

Create `src/types/index.ts`:

```typescript
export interface Product {
  id: string
  vendor_id: string
  name: string
  description: string | null
  price: number
  stock: number
  category: string | null
  images: string[]
  is_active: boolean
  created_at: string
}

export interface CartItem {
  product: Product
  quantity: number
}

export interface CheckoutFormData {
  full_name: string
  customer_email: string
  customer_phone: string
  shipping_address: {
    address: string
    city: string
    state: string
  }
}

export interface CheckoutPayload {
  customer_email: string
  customer_phone: string
  items: { product_id: string; quantity: number }[]
  shipping_address: {
    address: string
    city: string
    state: string
  }
}
```

---

## SECTION 6 — UTILITIES

Create `src/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)
```

Create `src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function getProductImage(images: string[], index = 0): string {
  if (images && images.length > index && images[index]) {
    return images[index]
  }
  return `https://placehold.co/400x400/f4f4f5/71717a?text=No+Image`
}
```

---

## SECTION 7 — CART STATE

Create `src/lib/store.ts` using Zustand with persist middleware.

Requirements:
- `items: CartItem[]`
- `isCartOpen: boolean`
- `addItem(product: Product): void` — increment if exists,
  add with quantity 1 if new
- `removeItem(productId: string): void`
- `updateQuantity(productId: string, quantity: number): void`
  — remove item if quantity reaches 0
- `clearCart(): void`
- `setCartOpen(open: boolean): void`
- `totalItems(): number` — sum of all quantities
- `totalPrice(): number` — sum of all subtotals

Use persist middleware with key `marketa-cart`.
Do NOT persist `isCartOpen` — always initialise it as `false`.

---

## SECTION 8 — PROVIDERS

Create `src/components/providers.tsx` as a client component.

Wrap children with `ThemeProvider` from `next-themes`:
- `attribute="class"`
- `defaultTheme="light"`
- `enableSystem={false}`
- `disableTransitionOnChange`

---

## SECTION 9 — ROOT LAYOUT

Create `src/app/layout.tsx`:

- Import Inter from `next/font/google`, subset `['latin']`
- Apply font className to body
- Use `Providers` component as wrapper
- Render `Navbar`, `CartSidebar`, `Footer` inside body
- Import `Toaster` from `@/components/ui/toaster`
- Body: `bg-white text-zinc-900 min-h-screen`
- Metadata:
  - title: `Marketa — Nigeria's Premium Marketplace`
  - description: `Shop unique products from verified vendors
    across Nigeria. Fast delivery, secure payments.`

---

## SECTION 10 — NAVBAR

Create `src/components/navbar.tsx` as a client component.

**Layout:** Full width, `sticky top-0 z-50`, `bg-zinc-900`,
`border-b border-zinc-800`.

Add a `useEffect` that adds a backdrop blur class when
`window.scrollY > 10`.

**Left:** `ShoppingBag` icon (amber-500, 24px) + "Marketa"
in white `font-bold text-xl`. Clicking navigates to `/`.

**Center (desktop only):** Nav links — Home, Products,
Vendors, About. Style: `text-zinc-400 hover:text-white
text-sm transition-colors`. Active link: `text-white`.

**Right:**
- `Search` icon: `text-zinc-400 hover:text-white`
- `ShoppingCart` icon with amber-500 count badge (top-right,
  small circle). Count from `useCartStore().totalItems()`.
  Clicking calls `setCartOpen(true)`.
- "Sell with us" button: `bg-amber-500 text-zinc-900 text-sm
  font-medium rounded-lg px-4 py-2`. Hidden on mobile.

**Mobile:** Hamburger (`Menu` icon) opens a shadcn `Sheet`
from the left with all nav links stacked vertically.
Cart icon always visible on mobile.

**Animation:** Navbar slides down on mount:
`y: -100 → 0`, `duration: 0.3s`.

---

## SECTION 11 — HERO

Create `src/components/hero.tsx` as a client component.

**Container:** Full width, `min-h-[85vh]` desktop,
`min-h-[70vh]` mobile. Background gradient:
`from-zinc-900 via-zinc-800 to-zinc-900`.
Two-column layout desktop, single column mobile.

**Left column:**
- Label pill: `🇳🇬 Nigeria's #1 Marketplace` —
  `bg-amber-500/10 text-amber-400 rounded-full text-sm
  font-medium px-4 py-1.5`
- Headline (white): "Shop From Nigeria's" line 1,
  "Best Vendors" line 2 with amber-500 text
- Subheadline (zinc-400, max-w-md): "Discover unique products
  from thousands of verified vendors across the country.
  Fast delivery, secure Paystack payments."
- CTA buttons:
  1. "Shop Now" — `bg-amber-500 text-zinc-900 font-semibold
     rounded-lg px-8 py-3`
  2. "Become a Vendor" — transparent, white border, white text,
     same sizing
- Stats row: `2,500+ Products | 340+ Vendors | 15,000+
  Customers` — amber-500 numbers, zinc-400 labels.
  Numbers count up on mount using `useEffect`.

**Right column:**
- Three floating product mockup cards at staggered positions
  and slight rotations (−3°, 0°, 3°).
- Each card: white bg, `rounded-xl shadow-2xl p-4`,
  shows a placeholder image, product name, amber price.
- Framer Motion infinite float:
  `animate={{ y: [0, -12, 0] }}`,
  `transition={{ duration: 3, repeat: Infinity }}`.
  Give each card a different duration (3s, 3.5s, 4s).

**Background:** Subtle amber-500/5 radial glow in center.

**Entrance animation:** All text content staggered slide-up
with `staggerChildren: 0.1`.

---

## SECTION 12 — CATEGORY FILTER

Create `src/components/category-filter.tsx` as a client
component.

**Props:**
```typescript
{
  categories: string[]
  selected: string
  onSelect: (category: string) => void
}
```

Horizontally scrollable row, hidden scrollbar.
"All" option always appears first.

Map each category to an emoji prefix:
- All → 🛍️ All
- Fashion → 👗 Fashion
- Electronics → 📱 Electronics
- Food → 🍔 Food & Drinks
- Beauty → 💄 Beauty
- Home → 🏠 Home & Living
- Sports → ⚽ Sports
- Any other → 📦 [name]

**Active pill:** `bg-zinc-900 text-white`
**Inactive pill:** `bg-white text-zinc-600 border
border-zinc-200 hover:border-zinc-400 hover:text-zinc-900`

All pills: `rounded-full px-4 py-2 text-sm font-medium
whitespace-nowrap transition-all`.

Animate pills in with stagger on mount.

---

## SECTION 13 — PRODUCT CARD

Create `src/components/product-card.tsx` as a client component.

**Props:** `{ product: Product, index: number }`

**Outer wrapper:** `motion.div` — entrance animation
`opacity 0→1, y 20→0` with `delay: index * 0.05`.
Hover: `scale: 1.01`, shadow increase.
Entire card is clickable → navigates to `/product/[id]`.

**Image area (`aspect-square relative overflow-hidden`):**
- Next.js `Image` component, `object-cover fill`
- Use `getProductImage(product.images)`
- Top-left badge: category, `bg-zinc-800/80 text-white
  rounded-full text-xs px-2.5 py-1`
- Top-right stock badge:
  - `stock > 5` → `bg-emerald-500 text-white` "In Stock"
  - `stock > 0 && stock <= 5` → `bg-amber-500 text-white`
    "Low Stock"
  - `stock === 0` → `bg-red-500 text-white` "Out of Stock"
- Out of stock overlay: `bg-zinc-900/50` covering full image
  with "Out of Stock" text centered in white

**Info area (`p-4`):**
- Product name: `font-semibold text-zinc-900 line-clamp-1`
- Description: `text-xs text-zinc-500 line-clamp-1 mt-0.5`
- Price: `text-lg font-bold text-amber-600 mt-2`
- Add to Cart button (`mt-3 w-full`):
  - Enabled: `bg-zinc-900 text-white hover:bg-zinc-700`
  - Disabled/out of stock: `bg-zinc-200 text-zinc-400
    cursor-not-allowed`
  - On click: call `addItem(product)`, show success toast
    "Added to cart! 🛒", `e.preventDefault()` and
    `e.stopPropagation()` to prevent card navigation

---

## SECTION 14 — PRODUCT SKELETON

Create `src/components/product-skeleton.tsx`.

A loading skeleton that matches `ProductCard` layout exactly
using shadcn `Skeleton` component for all visual areas.

Default export: a responsive grid of 8 skeleton cards
(same grid as product grid).

---

## SECTION 15 — CART SIDEBAR

Create `src/components/cart-sidebar.tsx` as a client component.

Use shadcn `Sheet`, `side="right"`.
Width: `sm:max-w-[400px]` desktop, full width mobile.
Controlled by `isCartOpen` and `setCartOpen` from store.

**Header:**
- "Your Cart" title with `ShoppingBag` icon
- Item count badge in amber
- Close button (X icon)

**Empty state (centered):**
- Large `ShoppingBag` icon (`text-zinc-200`, 80px)
- "Your cart is empty" heading
- "Add items from the store to get started" subtext
- "Continue Shopping" button that calls `setCartOpen(false)`

**Items list (ScrollArea):**
Each item shows:
- Product image (48×48, `rounded-lg object-cover`)
- Product name (`font-medium line-clamp-1`)
- Price per item (`text-amber-600 text-sm`)
- Quantity controls: minus button | number | plus button
  (buttons: `bg-zinc-100 rounded w-7 h-7 flex items-center
  justify-center text-sm font-medium`)
- `Trash2` icon button: `text-red-400 hover:text-red-600`
  calls `removeItem`
- `Separator` between items

**Footer (sticky bottom):**
- Subtotal row: label left, `formatNaira(totalPrice())` right
  in `font-bold text-lg`
- `text-xs text-zinc-500`: "Shipping calculated at checkout"
- `Separator`
- "Proceed to Checkout" button: full width, `bg-amber-500
  text-zinc-900 font-semibold py-3 rounded-lg` — opens
  `CheckoutModal`
- "Continue Shopping" ghost button that closes the sidebar

---

## SECTION 16 — CHECKOUT MODAL

Create `src/components/checkout-modal.tsx` as a client
component.

Use shadcn `Dialog`. Opened from CartSidebar.

**Internal state:**
- `step: 1 | 2 | 3`
- `formData: CheckoutFormData`
- `isLoading: boolean`
- `error: string | null`

**Step indicator (top of modal):**
Three steps connected by a line:
1. Contact
2. Delivery
3. Summary

- Completed step: emerald-500 circle + checkmark icon
- Active step: amber-500 circle + step number
- Pending step: zinc-200 circle + step number

**Step 1 — Contact Details:**
- Full Name input (User icon prefix)
- Email input (Mail icon, `type="email"`)
- Phone input (Phone icon, placeholder "+2348...")
- Validate all three fields are non-empty before proceeding
- "Continue →" button

**Step 2 — Delivery Address:**
- Address line input (MapPin icon)
- City input
- State dropdown (all 36 Nigerian states + FCT — hardcode
  the complete list alphabetically)
- "← Back" and "Continue →" buttons

**Step 3 — Order Summary:**
- Scrollable list of all cart items with quantities and
  subtotals
- Delivery address recap
- Contact details recap
- Total: large amber-600 `font-bold`
- Paystack trust badge: "🔒 Secured by Paystack"
- "Pay ₦[total] Now" button:
  - `bg-amber-500 text-zinc-900 font-bold py-4 w-full
    rounded-xl text-lg`
  - Shows `Loader2` spin icon when `isLoading === true`
  - Disabled while loading

**On "Pay" click:**
1. `setIsLoading(true)`
2. `setError(null)`
3. Build payload:
   ```json
   {
     "customer_email": "...",
     "customer_phone": "...",
     "items": [{ "product_id": "...", "quantity": 1 }],
     "shipping_address": { "address": "...", "city": "...", "state": "..." }
   }
   ```
4. `POST` to `process.env.NEXT_PUBLIC_CHECKOUT_WEBHOOK_URL`
   with `Content-Type: application/json`
5. On success: `clearCart()` then
   `window.location.href = data.authorization_url`
6. On error: `setError(message)`, show error toast,
   `setIsLoading(false)`

---

## SECTION 17 — MAIN PAGE

Create `src/app/page.tsx` as a **server component**.

Fetch products server-side:

```typescript
const { data: products } = await supabase
  .from('products')
  .select('*')
  .eq('is_active', true)
  .order('created_at', { ascending: false })
```

Extract unique categories from the products array.

Pass all products to a `'use client'` wrapper component
called `ProductsSection` (defined in the same file or in
`src/components/product-grid.tsx`) that handles:
- `selectedCategory` state (default "All")
- `CategoryFilter` rendering
- Client-side filtering
- Responsive product grid:
  `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5`

The server component renders:
1. `<Hero />`
2. A section wrapper with heading "Browse Products" and
   product count badge
3. `<ProductsSection products={products} categories={...} />`
   wrapped in `<Suspense fallback={<ProductSkeleton />} />`

---

## SECTION 18 — PRODUCT DETAIL PAGE

Create `src/app/product/[id]/page.tsx` as a **server component**.

Fetch:
```typescript
const { data: product } = await supabase
  .from('products')
  .select('*')
  .eq('id', params.id)
  .single()

if (!product) notFound()
```

**Layout:** Two columns desktop, single column mobile.

**Left — Image area:**
- Main image: `aspect-square rounded-xl object-cover`
- Image thumbnails below if `product.images.length > 1`
- Clicking thumbnail updates main image (needs `'use client'`
  sub-component for this interaction)
- Stock badge overlay on main image

**Right — Details:**
- Breadcrumb: Home › [category] › [name] (small, zinc-500)
- Category badge: `bg-zinc-100 text-zinc-600 rounded-full`
- Product name: `text-3xl font-bold`
- Price: `text-4xl font-bold text-amber-600`
- `Separator`
- Description: `text-zinc-600 leading-relaxed`
- Stock count text (emerald if > 5, amber if ≤ 5)
- Quantity selector (1 to stock max) — needs client component
- "Add to Cart" button: `w-full bg-zinc-900 text-white
  py-4 font-semibold rounded-xl text-lg` — needs client
- Trust row: small icons + text for "Fast Delivery",
  "Secure Payment", "Easy Returns" — `text-xs text-zinc-500`

Extract interactive elements into a `ProductActions` client
component that receives `product` as a prop.

"← Back to products" link at top: navigates to `/`.

---

## SECTION 19 — PAYMENT SUCCESS PAGE

Create `src/app/payment-success/page.tsx` as a **client
component**.

On mount (`useEffect`):
1. Read `reference` from `useSearchParams()`
2. Fire confetti:
   ```typescript
   confetti({
     particleCount: 150,
     spread: 70,
     origin: { y: 0.6 },
     colors: ['#f59e0b', '#18181b', '#ffffff', '#10b981'],
   })
   ```

**Layout:** `min-h-screen flex flex-col items-center
justify-center px-4`

**Content (card, max-w-md, centered):**
- Animated checkmark: `motion.div` scale `0→1` spring —
  `w-24 h-24 bg-emerald-500 rounded-full flex items-center
  justify-center` with white `Check` icon (48px)
- "Payment Successful!" — `text-3xl font-bold text-zinc-900`
- "Order Confirmed" — `text-emerald-600 font-medium`
- Paragraph explaining order processing + email/WhatsApp
  confirmation coming
- Reference: `font-mono text-sm text-zinc-500` showing the
  Paystack reference from URL params
- Two buttons: "Continue Shopping" (→ `/`),
  "Track Order" (shows "Coming soon!" toast)
- Order progress steps row below the card:
  ✅ Payment Received → 🔄 Processing → 📦 Preparing → 🚚 Delivery
  with connecting line, active step highlighted in amber

---

## SECTION 20 — FOOTER

Create `src/components/footer.tsx`.

**Background:** `bg-zinc-900 text-zinc-400`

**Four-column grid** (stack on mobile):
1. **Brand** — Logo, "Nigeria's premium multi-vendor
   marketplace", social icons (Twitter/X, Instagram,
   Facebook, LinkedIn) in zinc-600 hover:zinc-300
2. **Shop** — category links
3. **Vendors** — "Become a Vendor", "Vendor Login",
   "Seller Guide", "Commission Rates"
4. **Support** — "Help Center", "Track Order",
   "Returns Policy", "Contact Us"

All links: `hover:text-white transition-colors text-sm`.

**Bottom bar** (`border-t border-zinc-800 mt-12 pt-8`):
- Left: `© 2025 Marketa. All rights reserved.`
- Right: Payment method pill badges — Visa, Mastercard,
  Paystack (grey pills with text)

---

## SECTION 21 — FINAL CHECKS

After all files are created:

1. Run `npm run build` and fix every TypeScript or
   compilation error before stopping.

2. Run `npm run dev` and confirm no console errors.

3. Verify:
   - Every component that uses hooks or browser APIs has
     `'use client'` at the top
   - All imports resolve with no missing modules
   - Framer Motion `motion` components are in client files only
   - `useSearchParams()` is wrapped in `Suspense`
   - Checkout POST handles both success and error paths
   - Cart persists across page refreshes

4. Create `README.md` with:
   - Project name and description
   - Tech stack
   - Getting started instructions
   - All environment variables and where to get the values
   - How to seed test data in Supabase

5. Output a summary listing every file created and confirm
   `npm run build` passed with zero errors.

---

*End of AGENTS.md*
