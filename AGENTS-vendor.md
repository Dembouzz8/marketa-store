# AGENTS-vendor.md — Marketa Vendor Dashboard

This file contains the full build specification for the Marketa
vendor dashboard. Read every section completely before starting.
Work through sections in order. Do not skip any section.

The vendor dashboard is built inside the existing marketa-store
Next.js project. Do not create a new project.

---

## SECTION 1 — INSTALL NEW DEPENDENCIES

Run this in the terminal from the marketa-store root:

```bash
npm install @supabase/ssr
```

---

## SECTION 2 — RESTRUCTURE APP DIRECTORY

The current root layout (src/app/layout.tsx) renders the customer
Navbar, CartSidebar, and Footer. Vendor pages must not show these.

Fix this by wrapping storefront pages in a route group.

### Step 1 — Create the (store) route group

Create this folder: src/app/(store)/

### Step 2 — Move existing storefront files into (store)

Move these files/folders into src/app/(store)/:
- src/app/page.tsx → src/app/(store)/page.tsx
- src/app/product/ → src/app/(store)/product/
- src/app/payment-success/ → src/app/(store)/payment-success/

### Step 3 — Create storefront layout

Create src/app/(store)/layout.tsx:

```tsx
import { Navbar } from "@/components/navbar"
import { CartSidebar } from "@/components/cart-sidebar"
import { Footer } from "@/components/footer"

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Navbar />
      <CartSidebar />
      {children}
      <Footer />
    </>
  )
}
```

### Step 4 — Simplify root layout

Replace src/app/layout.tsx with this minimal version:

```tsx
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Marketa — Nigeria's Premium Marketplace",
  description: "Shop unique products from verified vendors across Nigeria.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-white text-zinc-900 min-h-screen`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
```

### Step 5 — Verify storefront still works

Run npm run dev and confirm http://localhost:3000 still shows
the storefront with Navbar and Footer. Fix any import errors
before proceeding.

---

## SECTION 3 — SUPABASE SSR CLIENTS

Create two Supabase client utilities for server-side auth.

### Create src/lib/supabase-server.ts

```typescript
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

### Create src/lib/supabase-middleware.ts

```typescript
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isVendorRoute = request.nextUrl.pathname.startsWith("/vendor")
  const isLoginPage = request.nextUrl.pathname === "/vendor/login"

  if (isVendorRoute && !isLoginPage && !user) {
    const url = request.nextUrl.clone()
    url.pathname = "/vendor/login"
    return NextResponse.redirect(url)
  }

  if (isLoginPage && user) {
    const url = request.nextUrl.clone()
    url.pathname = "/vendor/dashboard"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

---

## SECTION 4 — MIDDLEWARE

Create src/middleware.ts in the project root:

```typescript
import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase-middleware"

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: ["/vendor/:path*"],
}
```

---

## SECTION 5 — VENDOR TYPES

Add these types to src/types/index.ts (append, do not replace):

```typescript
export interface Vendor {
  id: string
  user_id: string
  name: string
  email: string
  phone: string | null
  bank_details: {
    bank_name?: string
    account_number?: string
    account_name?: string
  }
  platform_fee_pct: number
  is_active: boolean
  created_at: string
}

export interface VendorOrder {
  id: string
  customer_email: string
  customer_phone: string | null
  status: string
  total_amount: number
  payment_ref: string | null
  shipping_address: {
    address?: string
    city?: string
    state?: string
  }
  created_at: string
  order_items: VendorOrderItem[]
}

export interface VendorOrderItem {
  id: string
  quantity: number
  unit_price: number
  subtotal: number
  product_id: string
  products: {
    name: string
    images: string[]
  }
}

export interface PayoutLedgerEntry {
  id: string
  amount: number
  type: "credit" | "debit"
  reference: string
  description: string | null
  created_at: string
  order_id: string | null
}

export interface DashboardStats {
  totalOrders: number
  totalRevenue: number
  pendingPayout: number
  activeProducts: number
}
```

---

## SECTION 6 — FILE STRUCTURE

Create this exact structure inside src/app/vendor/:

```
src/app/vendor/
├── layout.tsx              ← vendor shell layout with sidebar
├── login/
│   └── page.tsx            ← login page
├── dashboard/
│   └── page.tsx            ← overview + stats
├── orders/
│   ├── page.tsx            ← orders list
│   └── [id]/
│       └── page.tsx        ← order detail
├── products/
│   ├── page.tsx            ← products list
│   ├── new/
│   │   └── page.tsx        ← add product form
│   └── [id]/
│       └── edit/
│           └── page.tsx    ← edit product form
├── payouts/
│   └── page.tsx            ← payout ledger
└── settings/
    └── page.tsx            ← vendor profile settings

src/components/vendor/
├── sidebar.tsx             ← navigation sidebar
├── stats-card.tsx          ← dashboard stat card
├── orders-table.tsx        ← orders data table
├── products-table.tsx      ← products data table
├── product-form.tsx        ← add/edit product form
└── payout-table.tsx        ← payout ledger table
```

---

## SECTION 7 — DESIGN SYSTEM FOR VENDOR DASHBOARD

Apply this consistently across all vendor pages.

### Colors
- Sidebar background: zinc-900
- Sidebar text: zinc-400, hover: white
- Sidebar active link: amber-500 text, zinc-800 background
- Page background: zinc-50
- Card background: white
- Card border: zinc-200
- Heading: zinc-900
- Body text: zinc-600
- Accent: amber-500
- Success: emerald-500
- Warning: amber-500
- Error: red-500
- Status badges:
  - pending: amber-100 bg, amber-700 text
  - confirmed: blue-100 bg, blue-700 text
  - fulfilled: emerald-100 bg, emerald-700 text
  - cancelled: red-100 bg, red-700 text

### Layout
- Sidebar: fixed left, w-64 on desktop, hidden on mobile
- Main content: ml-64 on desktop, full width on mobile
- Page padding: p-6 desktop, p-4 mobile
- Card radius: rounded-xl
- Shadow: shadow-sm

### Typography
- Page title: text-2xl font-semibold text-zinc-900
- Section title: text-lg font-medium text-zinc-900
- Table header: text-xs font-medium text-zinc-500 uppercase
- Table cell: text-sm text-zinc-900

---

## SECTION 8 — VENDOR SIDEBAR

Create src/components/vendor/sidebar.tsx as a client component.

### Structure
- Fixed position, left-0, top-0, h-screen, w-64
- Background: bg-zinc-900
- Border right: border-r border-zinc-800

### Top section
- Logo: ShoppingBag icon (amber-500) + "Marketa" text (white)
- Below logo: vendor store name in zinc-400 text-sm
- Separator

### Navigation links (with lucide icons)
- Dashboard → /vendor/dashboard (LayoutDashboard icon)
- Orders → /vendor/orders (ShoppingCart icon)
- Products → /vendor/products (Package icon)
- Payouts → /vendor/payouts (Wallet icon)
- Settings → /vendor/settings (Settings icon)

### Link styling
- Default: text-zinc-400 hover:text-white hover:bg-zinc-800
  flex items-center gap-3 px-4 py-3 rounded-lg mx-2 text-sm
- Active (current route): text-amber-500 bg-zinc-800
- Use usePathname() to detect active route

### Bottom section
- Vendor email in zinc-500 text-xs
- Logout button with LogOut icon
- On logout: call supabase.auth.signOut() then router.push('/vendor/login')

### Mobile
- Hidden on desktop via CSS
- Show hamburger toggle in top bar on mobile
- Slide in as overlay when toggled

---

## SECTION 9 — VENDOR LAYOUT

Create src/app/vendor/layout.tsx as a server component.

```tsx
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { Sidebar } from "@/components/vendor/sidebar"

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect("/vendor/login")

  // Fetch vendor record for this auth user
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, email")
    .eq("user_id", user.id)
    .single()

  // If no vendor record exists, this user is not a vendor
  if (!vendor) redirect("/vendor/login?error=not_a_vendor")

  return (
    <div className="flex h-screen bg-zinc-50">
      <Sidebar vendorName={vendor.name} vendorEmail={vendor.email} />
      <main className="flex-1 ml-64 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
```

---

## SECTION 10 — LOGIN PAGE

Create src/app/vendor/login/page.tsx as a client component.

### Layout
- Full screen centered: min-h-screen flex items-center
  justify-center bg-zinc-50
- Card: white, rounded-2xl, shadow-lg, p-8, max-w-md w-full

### Content
- Top: ShoppingBag icon (amber-500, 40px) + "Marketa" heading
- Subtitle: "Vendor Portal"
- Separator
- Form:
  - Email input (with Mail icon)
  - Password input (with Lock icon, show/hide toggle)
  - "Sign In" button: full width, bg-amber-500 text-zinc-900
    font-semibold py-3 rounded-lg
  - Loading state: spinner in button when submitting
- Error message shown below form if login fails

### Login logic
```typescript
const handleLogin = async () => {
  setIsLoading(true)
  setError(null)
  
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  
  if (error) {
    setError(error.message)
    setIsLoading(false)
    return
  }
  
  router.push('/vendor/dashboard')
  router.refresh()
}
```

### Check for error param
If URL has ?error=not_a_vendor, show:
"This account is not registered as a vendor."

---

## SECTION 11 — STATS CARD COMPONENT

Create src/components/vendor/stats-card.tsx:

Props: title, value, subtitle, icon, color, trend (optional)

### Design
- White card, rounded-xl, border border-zinc-200, p-6
- Icon in colored circle (40px): color prop determines bg
  e.g. amber-100 bg + amber-600 icon
- Title: text-sm text-zinc-500 font-medium
- Value: text-3xl font-bold text-zinc-900 mt-1
- Subtitle: text-xs text-zinc-400 mt-1
- Optional trend: small badge showing +X% in emerald or red

---

## SECTION 12 — DASHBOARD PAGE

Create src/app/vendor/dashboard/page.tsx as a server component.

### Data fetching
```typescript
const supabase = await createSupabaseServerClient()
const { data: { user } } = await supabase.auth.getUser()

// Get vendor
const { data: vendor } = await supabase
  .from("vendors")
  .select("id, name, platform_fee_pct")
  .eq("user_id", user!.id)
  .single()

// Get order items for this vendor to find orders
const { data: orderItems } = await supabase
  .from("order_items")
  .select("order_id, subtotal, orders(status, created_at)")
  .eq("vendor_id", vendor!.id)

// Get payout ledger
const { data: ledger } = await supabase
  .from("payout_ledger")
  .select("amount, type")
  .eq("vendor_id", vendor!.id)

// Get active products count
const { count: productCount } = await supabase
  .from("products")
  .select("*", { count: "exact" })
  .eq("vendor_id", vendor!.id)
  .eq("is_active", true)
```

### Calculate stats from fetched data
```typescript
const uniqueOrders = new Set(orderItems?.map(i => i.order_id)).size
const totalRevenue = ledger
  ?.filter(l => l.type === "credit")
  .reduce((sum, l) => sum + Number(l.amount), 0) ?? 0
const totalDebits = ledger
  ?.filter(l => l.type === "debit")
  .reduce((sum, l) => sum + Number(l.amount), 0) ?? 0
const pendingPayout = totalRevenue - totalDebits
```

### Layout
- Page title: "Dashboard" + greeting "Good morning, [vendor name]"
- Stats grid: 2 cols mobile, 4 cols desktop
  Four StatsCard components:
  1. Total Orders — ShoppingCart icon, blue
  2. Total Revenue — TrendingUp icon, emerald
  3. Pending Payout — Wallet icon, amber
  4. Active Products — Package icon, purple

- Recent Orders section below stats:
  Last 5 orders table with: Order ID (truncated), Date,
  Amount, Status badge
  "View all orders" link

- Quick actions section:
  Two buttons: "Add New Product" → /vendor/products/new
               "View Payouts" → /vendor/payouts

---

## SECTION 13 — ORDERS TABLE COMPONENT

Create src/components/vendor/orders-table.tsx as a client component.

Props: orders: VendorOrder[]

### Features
- Search input: filter by order ID or customer email
- Status filter dropdown: All, Pending, Confirmed, Fulfilled,
  Cancelled
- Table columns:
  - Order (truncated ID + date below)
  - Customer (email)
  - Items (count of items)
  - Amount (formatted Naira)
  - Status (colored badge)
  - Actions (View button → /vendor/orders/[id])
- Empty state: "No orders yet" with ShoppingCart illustration
- Responsive: horizontal scroll on mobile

---

## SECTION 14 — ORDERS LIST PAGE

Create src/app/vendor/orders/page.tsx as a server component.

Fetch all order_items for this vendor, join with orders:
```typescript
const { data: orderItems } = await supabase
  .from("order_items")
  .select(`
    order_id,
    quantity,
    unit_price,
    subtotal,
    orders (
      id,
      customer_email,
      customer_phone,
      status,
      total_amount,
      payment_ref,
      shipping_address,
      created_at
    )
  `)
  .eq("vendor_id", vendor.id)
  .order("created_at", { ascending: false })
```

Deduplicate by order_id to get unique orders.
Pass orders to OrdersTable component.

Page title: "Orders" + total count badge

---

## SECTION 15 — ORDER DETAIL PAGE

Create src/app/vendor/orders/[id]/page.tsx as a server component.

Fetch order + items for this vendor only:
```typescript
const { data: order } = await supabase
  .from("orders")
  .select("*")
  .eq("id", params.id)
  .single()

const { data: items } = await supabase
  .from("order_items")
  .select("*, products(name, images)")
  .eq("order_id", params.id)
  .eq("vendor_id", vendor.id)
```

If no items for this vendor in this order: redirect to
/vendor/orders (vendor shouldn't see other vendors' orders)

### Layout
- Back button: "← Back to Orders"
- Two column layout desktop, single column mobile

Left column:
- Order info card: ID, date, status badge, payment reference
- Customer info card: email, phone, shipping address

Right column:
- Items card: each item with image (48px), name, qty, price,
  subtotal
- Order total row
- Your earnings row: subtotal × (1 - platform_fee_pct/100)
  with "after 10% platform fee" note

---

## SECTION 16 — PRODUCTS TABLE COMPONENT

Create src/components/vendor/products-table.tsx as a client
component.

Props: products: Product[], onDelete: function,
       onToggleActive: function

### Features
- Search input: filter by name or category
- "Add Product" button top right → navigates to
  /vendor/products/new
- Table columns:
  - Product (image thumbnail 40px + name)
  - Category
  - Price (formatted Naira)
  - Stock (number, colored red if < 5, emerald if >= 5)
  - Status (Active/Inactive toggle switch)
  - Actions (Edit button, Delete button)
- Inline stock: clicking stock number makes it an input
  for quick update
- Delete: shows confirmation dialog before deleting
- Empty state: "No products yet — add your first product"

---

## SECTION 17 — PRODUCTS LIST PAGE

Create src/app/vendor/products/page.tsx as a server component.

```typescript
const { data: products } = await supabase
  .from("products")
  .select("*")
  .eq("vendor_id", vendor.id)
  .order("created_at", { ascending: false })
```

Pass products to ProductsTable component.
Page title: "Products" + active count badge

---

## SECTION 18 — PRODUCT FORM COMPONENT

Create src/components/vendor/product-form.tsx as a client
component.

Props: product?: Product (undefined = new product),
       vendorId: string, onSuccess: function

### Fields
- Product Name (required, text input)
- Description (textarea, 4 rows)
- Price in Naira (required, number input with ₦ prefix)
- Stock Quantity (required, number input)
- Category (select: Fashion, Electronics, Food & Drinks,
  Beauty, Home & Living, Sports, Others)
- Images: file upload input
  - Accepts: image/jpeg, image/png, image/webp
  - Max 4 images
  - Preview thumbnails after selection
  - On submit: upload each to Supabase Storage
    bucket: product-images
    path: vendor_id/timestamp-filename
  - Get public URLs after upload
- Is Active toggle switch

### Submit logic
For new product:
```typescript
// Upload images first
const imageUrls = await Promise.all(
  selectedFiles.map(async (file) => {
    const path = `${vendorId}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, file)
    if (error) throw error
    const { data } = supabase.storage
      .from("product-images")
      .getPublicUrl(path)
    return data.publicUrl
  })
)

// Insert product
const { error } = await supabase
  .from("products")
  .insert({
    vendor_id: vendorId,
    name, description, price, stock,
    category, images: imageUrls, is_active
  })
```

For editing: use UPDATE instead of INSERT.

### Validation
- Name: required, min 3 chars
- Price: required, must be > 0
- Stock: required, must be >= 0
- Show inline error messages

---

## SECTION 19 — NEW PRODUCT PAGE

Create src/app/vendor/products/new/page.tsx as a server
component.

Get vendor, pass vendorId to ProductForm.
Page title: "Add New Product"
Back link: "← Back to Products"
onSuccess: redirect to /vendor/products

---

## SECTION 20 — EDIT PRODUCT PAGE

Create src/app/vendor/products/[id]/edit/page.tsx as a
server component.

Fetch product and verify it belongs to this vendor:
```typescript
const { data: product } = await supabase
  .from("products")
  .select("*")
  .eq("id", params.id)
  .eq("vendor_id", vendor.id)
  .single()

if (!product) redirect("/vendor/products")
```

Pass product to ProductForm (pre-fills all fields).
Page title: "Edit Product"

---

## SECTION 21 — PAYOUT TABLE COMPONENT

Create src/components/vendor/payout-table.tsx as a client
component.

Props: entries: PayoutLedgerEntry[], balance: number

### Layout
- Balance summary card at top:
  - "Current Balance" label
  - Large balance amount in emerald-600
  - "Available for payout" subtext
  - Note: "Payouts are processed automatically at T+7 days"

- Table columns:
  - Date
  - Description
  - Order ID (truncated, if present)
  - Type badge: Credit (emerald) or Debit (red)
  - Amount: positive for credit, negative for debit
    Credits: text-emerald-600, Debits: text-red-600
  - Running balance column

- Summary row at top of table:
  Total Credits | Total Debits | Net Balance

- Empty state: "No transactions yet"

---

## SECTION 22 — PAYOUTS PAGE

Create src/app/vendor/payouts/page.tsx as a server component.

```typescript
const { data: entries } = await supabase
  .from("payout_ledger")
  .select("*")
  .eq("vendor_id", vendor.id)
  .order("created_at", { ascending: false })

const totalCredits = entries
  ?.filter(e => e.type === "credit")
  .reduce((sum, e) => sum + Number(e.amount), 0) ?? 0

const totalDebits = entries
  ?.filter(e => e.type === "debit")
  .reduce((sum, e) => sum + Number(e.amount), 0) ?? 0

const balance = totalCredits - totalDebits
```

Page title: "Payouts"
Pass entries and balance to PayoutTable component.

---

## SECTION 23 — SETTINGS PAGE

Create src/app/vendor/settings/page.tsx as a client component.

Fetch vendor on mount using supabase client (not server).

### Sections

Section 1 — Store Information
- Store name input
- Email input (read-only, greyed out)
- Phone number input

Section 2 — Bank Details
- Bank Name input
- Account Number input
- Account Name input

Each section has its own "Save Changes" button.

### Save logic
```typescript
const { error } = await supabase
  .from("vendors")
  .update({
    name: storeName,
    phone,
    bank_details: { bank_name, account_number, account_name }
  })
  .eq("user_id", user.id)
```

Show success toast on save. Show error toast on failure.

Section 3 — Account (read-only info)
- Member since date
- Platform fee percentage
- Vendor ID (for support reference)

---

## SECTION 24 — FINAL CHECKS

After all files are created:

1. Run: npm run build
   Fix every TypeScript and build error before finishing.

2. Verify:
   - Visiting /vendor redirects to /vendor/login
   - Logging in with vendor@test.com redirects to
     /vendor/dashboard
   - Non-vendor auth users get "not a vendor" error
   - Sidebar shows correct vendor name
   - Dashboard stats load without errors
   - All navigation links work
   - Logout clears session and redirects to /vendor/login
   - Storefront at / still works with Navbar and Footer

3. Run: npm run dev
   Confirm zero console errors on all vendor pages.

4. Update README.md to include:
   - Vendor portal section
   - How to access: /vendor/login
   - How to create a vendor account (via Supabase dashboard)

When everything builds cleanly, list every file created and
confirm build succeeded.
