// =====================================================================
//  MHC Diecast — site configuration
//  These keys are public by design and safe to commit to GitHub.
//  NEVER paste the service_role / sb_secret_ key here.
// =====================================================================
window.MHC_CONFIG = {
  SUPABASE_URL: 'https://mmaoniudyamdyfzrxjxt.supabase.co',

  // New-style publishable key (recommended by Supabase)
  SUPABASE_ANON_KEY: 'sb_publishable_RcjWERtbD3bcXyFPMrhejQ_TkHupTbo',

  // Legacy anon key — kept as a fallback only. Swap it into the line above
  // if the publishable key ever gives an error.
  // 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tYW9uaXVkeWFtZHlmenJ4anh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0ODE2MDksImV4cCI6MjEwODA1NzYwOX0.w-JZwR8pOP0PqmQkbKeEb61-S9pSJ_oG2OpznOaFtXk'

  STORE_NAME: 'MHC Diecast',
  CURRENCY:   '₹',
  GOA_PINCODE_PREFIX: '403'      // free shipping for these pincodes
};
