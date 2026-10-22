# MHC Diecast — seller accounts guide

One **master admin** (you) plus up to **5 sellers**. Each seller logs in at `mhcdiecast.com/admin.html` and manages only their own shop.

| | Master admin | Seller |
|---|---|---|
| Add / edit cars | All sellers' cars, can assign any seller | Only their own |
| Orders | All orders, filter by seller | Only orders for their cars |
| Verify payment, ship, WhatsApp buyer | Yes, any order | Yes, their orders |
| My shop: name, WhatsApp, UPI, QR, shipping rate | Their own shop | Their own shop |
| Sellers tab: add, link login, pause | Yes | — |
| Settings (store name, store WhatsApp) | Yes | — |

## How buying works now
- Every car shows **"by <shop name>"**; the product page has **Chat with seller** (WhatsApp).
- Cart groups cars by seller. At checkout the buyer pays **each seller's UPI separately** and uploads one screenshot per seller.
- Each seller gets **their own order** (own order code). Goa shipping free; outside Goa uses **each seller's rate**.
- Order tracking shows the seller and a WhatsApp button to that seller.

## One-time setup
1. Supabase → SQL Editor → run `supabase/phase7-sellers.sql`.
   - Creates your own shop ("MHC Diecast") from your current Settings, and assigns all existing cars and orders to it.
2. Upload the website files to GitHub.
3. Log in to admin → **My shop** → check your WhatsApp, UPI and shipping → Save.

## Adding a seller (repeat for each)
1. Supabase → **Authentication → Users → Add user** → their email + a password → tick **Auto Confirm User**.
2. Admin → **Sellers → + Add seller** → shop name, WhatsApp number, and the same email → Save.
3. Send the seller: the link `mhcdiecast.com/admin.html`, their email and password.
4. They open **My shop**, fill in their **UPI ID** (required before buyers can pay them), then add cars.

## Pausing or removing a seller
- **Edit → untick Active**: their cars disappear from the shop and they can't log in. Tick again to restore.
- **Edit → clear the login email**: removes their access but keeps their shop and cars.

## Change the 5-seller limit
Edit `assets/js/config.js` → add `MAX_SELLERS: 8,` (any number).
