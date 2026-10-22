# MHC Diecast — buyer accounts (Sign in with Google)

## How it works
- Anyone can browse and add cars to the cart without signing in.
- **Checkout requires Sign in with Google.** Google verifies the email; the site never sees a password.
- After sign-in the cart is **saved to the account** — the same cart appears on any phone or computer they sign in on. A cart built before signing in is merged in.
- **My account** (person icon in the header): orders with live status, saved addresses, mobile number, sign out, delete account.
- Checkout fills name, email, phone and address automatically; new addresses are saved for next time.
- Seller and admin logins (admin.html) are unchanged and separate. A Google buyer account has no admin access.

---

## Setup — do these in order (about 30 minutes)

### 1. Database
Supabase → **SQL Editor** → run `supabase/phase8-buyers.sql` (after phase6 and phase7).

### 2. Google Cloud (free)
1. Go to **console.cloud.google.com** → sign in with the Google account that should own the login (e.g. your MHC Digital account).
2. Top bar → project picker → **New project** → name `MHC Diecast` → Create, and select it.
3. Menu → **Google Auth Platform** (or *APIs & Services → OAuth consent screen*) → **Get started**:
   - App name: `MHC Diecast` · User support email: your email
   - Audience: **External**
   - Contact email: your email → agree → **Create**
4. **Branding** page:
   - App home page: `https://www.mhcdiecast.com`
   - Privacy policy: `https://www.mhcdiecast.com/privacy.html`
   - Terms of service: `https://www.mhcdiecast.com/terms.html`
   - Authorized domains: add `mhcdiecast.com` **and** `supabase.co`
   - Leave the logo empty for now (adding a logo needs Google review before it shows) → Save.
5. **Data Access** → Add or remove scopes → tick `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` → Update → Save. (No other scopes — that keeps it review-free.)
6. **Audience** → under Publishing status click **Publish app** → Confirm. (While in "Testing", only test users you list can sign in.)
7. **Clients** → **Create client**:
   - Application type: **Web application** · Name: `MHC Diecast website`
   - Authorized JavaScript origins: `https://www.mhcdiecast.com` and `https://mhcdiecast.com`
   - Authorized redirect URIs: `https://mmaoniudyamdyfzrxjxt.supabase.co/auth/v1/callback`
   - Create → copy the **Client ID** and **Client secret** (keep the secret private).

### 3. Supabase
1. **Authentication → Sign In / Providers → Google** → Enable → paste Client ID and Client secret → Save.
2. Same page, **User Signups → Allow new users to sign up → ON**.
   (Safe: new accounts are buyers only. Admin and seller access still comes only from your Admins and Sellers lists.)
3. **Authentication → URL Configuration**:
   - Site URL: `https://www.mhcdiecast.com`
   - Redirect URLs → Add: `https://www.mhcdiecast.com/**` and `https://mhcdiecast.com/**`

### 4. Website
Upload the files to GitHub as usual (assets folder, supabase folder, all .html files, robots.txt), wait for the green ✓, press Ctrl+Shift+R.

### 5. Test
1. On your phone (not signed in to admin), add a car → Checkout → **Continue with Google** → pick your account → you come back to checkout signed in, cart kept.
2. Open the site on your computer → sign in with the same Google account → the cart is there.
3. Place a test order → **My account → Orders** shows it; the seller sees it in admin.
4. `status.html` → "Buyer accounts update installed" ✅.

---

## Good to know
- **Google screen wording:** until Google brand verification is done, the account chooser may say *"to continue to mmaoniudyamdyfzrxjxt.supabase.co"*. It works fine. To show "MHC Diecast" instead, later: verify `mhcdiecast.com` in Google Search Console, add the logo in Branding, and submit **Verification** (free, a few business days). A Supabase custom auth domain (paid add-on) also removes the supabase.co address.
- Seller/admin email accounts **cannot place orders** — buyers use their own Google account.
- Deleting a buyer account removes profile, addresses and cart; past orders stay with the seller, unlinked.
- Review `privacy.html` and `terms.html` wording — they're written to match how the site works, but I'm not a lawyer.
