// =====================================================================
//  MHC Diecast — site configuration
//  After creating your Supabase project, paste the two values from
//  Supabase → Project Settings → API.
//  The "anon public" key is MEANT to be public — it is safe in GitHub.
//  NEVER paste the "service_role" key here.
// =====================================================================
window.MHC_CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT-ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  STORE_NAME: 'MHC Diecast',
  CURRENCY:   '₹',
  GOA_PINCODE_PREFIX: '403'      // free shipping for these pincodes
};
