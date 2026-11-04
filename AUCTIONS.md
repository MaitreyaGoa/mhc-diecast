# MHC Diecast — Auctions (mhcdiecast.com/auction)

## What it does
- Anyone signed in with Google can **start an auction**: 1 photo, title, description,
  **starting bid**, **minimum increment**, optional **Buy Now** price and **end time** (15 min – 30 days).
- Others sign in with Google and **bid**. Every bid is checked by the database:
  - must be ≥ current bid + min increment (first bid ≥ starting bid), whole rupees only
  - auction must still be running (server clock — changing the phone's time doesn't help)
  - can't bid on your own auction or outbid yourself; bids can't be withdrawn
  - two bids at the same moment are handled one after another — only the valid one is accepted
- **Anti-sniping — final 2 minutes:** each new bid must be at least **₹100 higher** (or the seller's increment if bigger),
  and every bid **resets the clock to 2 minutes**. The auction ends only after 2 minutes with no new bid.
- **Buy Now** ends it immediately. Otherwise bidding closes exactly at the end time and the **highest bidder wins**.
- After it ends, only the **winner and seller** see each other's contact (WhatsApp / email).
  Payment and delivery are arranged between them.
- Bidders are shown by their **Google name** in the bid history. Pages refresh every few seconds; a bidder who gets outbid sees a notice.
- The seller can cancel only before the first bid.

## Setup (5 minutes)
1. Supabase → SQL Editor → run `supabase/phase10-auctions.sql` (after phase 8). It ends with "Auctions installed".
   Already ran it before? Run the new version again — it's safe and adds the 2-minute rule and real names.
2. Upload to GitHub: `auction.html`, the `assets` folder, the `supabase` folder → wait for the green ✓ → Ctrl+Shift+R.
3. Open `mhcdiecast.com/status.html` → "Auctions update installed" ✅.
4. Test: sign in with Google on your phone → Auction → **+ Start an auction** (end time 1 day).
   Then sign in with a different Google account on another device and bid.

## Removing a bad auction (admin)
Supabase → SQL Editor:
```sql
update public.auctions set status = 'removed' where title ilike '%part of the title%';
```
