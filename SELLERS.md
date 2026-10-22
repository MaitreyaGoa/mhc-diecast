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

## Seller logins & passwords
- Run `supabase/phase9-seller-logins.sql` once — it creates logins for the 5 sellers
  (sharmaprateek.dev@gmail.com, harish@mhc.com, omkar@mhc.com, seller1@mhc.com, seller2@mhc.com)
  with the **default password `abcd`**, plus an empty shop for each.
- Send each seller: `mhcdiecast.com/admin.html`, their email, and `abcd`.
- **First login:** they must set their own password (8+ characters, not `abcd`) — until then they can't see or change anything.
  Next they must add their **WhatsApp number and UPI ID**; only then do the Orders and Cars tabs open.
- Logins work from any device. The login is kept only until the browser is closed (not saved on the device).
- **Change password anytime:** My shop → Change password.
- **Forgot password:** you (master) open Sellers → the seller → **Reset password** → it goes back to `abcd` and they set a new one at next login.
  Sellers with a real inbox (e.g. the Gmail one) can also use *Forgot password? → Email me a reset link* on the login screen.
  The `@mhc.com` addresses can't receive email, so for them use Reset password.
- **New seller later:** Sellers → + Add seller → shop name + email → Save. The login is created with `abcd` automatically — no Supabase step.
- Sellers tab shows **"On default password"** next to anyone who hasn't set their own yet.
- To change the default password: edit `default_seller_password()` at the top of the SQL file (and `DEFAULT_SELLER_PASSWORD` in `assets/js/config.js`), re-run the SQL.

## Pausing or removing a seller
- **Edit → untick Active**: their cars disappear from the shop and they can't log in. Tick again to restore.
- **Edit → clear the login email**: removes their access but keeps their shop and cars.

## Change the 5-seller limit
Edit `assets/js/config.js` → add `MAX_SELLERS: 8,` (any number).
