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

The following remain outside the completed Phase 3 MVP scope:

- Vendor logo and storage support is a deferred enhancement.
- Application review and administrative tooling is not implemented.
- Automatic Auth user or vendor provisioning is not implemented.
- Payment and paid-order outbox redesign remains separately deferred and frozen.

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
blockers: payment/outbox hardening, refunds, payout scheduling, stock decrement
redesign, vendor portal/security cleanup, and seller-application
review/provisioning tooling.

---

## 13. Technical boundaries

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
