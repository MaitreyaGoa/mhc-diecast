// =====================================================================
//  MHC Diecast — catalogue: shop menu, categories, brand & series lists
//  (from "MHC Diecast — Category & Brand List"). Edit here to change
//  the shop menu or the suggestions shown in admin.
// =====================================================================
window.MHC_CATALOG = {
  // Category of a car (admin dropdown + shop sub-filters)
  CATEGORIES: ['Mainline', 'Premium', 'Chase', 'Pre-owned', 'Accessory'],

  // Shop menu, left to right. "brand" matches the car's brand;
  // "category" matches its category; "other" = any brand not listed above it.
  MENU: [
    { key: 'all',         label: 'All' },
    { key: 'hot-wheels',  label: 'Hot Wheels',   brand: 'Hot Wheels' },
    { key: 'matchbox',    label: 'Matchbox',     brand: 'Matchbox' },
    { key: 'mini-gt',     label: 'Mini GT',      brand: 'Mini GT' },
    { key: 'majorette',   label: 'Majorette',    brand: 'Majorette' },
    { key: 'other',       label: 'Other brands', other: true },
    { key: 'pre-owned',   label: 'Pre-owned',    category: 'Pre-owned' },
    { key: 'accessories', label: 'Accessories',  category: 'Accessory' }
  ],

  SCALES: ['1:64', '1:43', '1:32', '1:24', '1:18', '1:76'],

  BRANDS: [
    'Hot Wheels', 'Matchbox', 'Mini GT', 'Majorette', 'Tarmac Works', 'Kaido House',
    'Bburago', 'Maisto', 'Tomica', 'Pop Race', 'Inno64', 'Para64', 'CCA', 'Greenlight',
    'Johnny Lightning', 'M2 Machines', 'Racing Champions', 'Auto World', 'Kinsmart',
    'Corgi', 'Oxford', 'Lledo', 'Solido', 'Sparky', 'Tiny', 'Massdi', 'Centy'
  ],

  // Series suggestions per brand (admin)
  SERIES: {
    'Hot Wheels': ['Mainline', 'Mainline short card', 'Classic Mainlines', 'Color Shifters',
      'Car Culture', 'Boulevard', 'Pop Culture', 'Fast & Furious', 'Forza Motorsport', 'Ferrari',
      'Character Cars', 'Team Transport', 'Treasure Hunt', 'Super Treasure Hunt', 'RLC', 'Chase',
      '5-pack', 'Multipack', 'Factory sealed', '1:43', 'Tracks & playsets'],
    'Matchbox': ['Mainline', 'Collectors', 'Moving Parts', 'Superfast', 'Models of Yesteryear', 'Boxed'],
    'Majorette': ['Street Cars', 'Premium Cars', 'Deluxe Cars', 'JDM Legends', 'Porsche Edition',
      'Mercedes-AMG', 'Volkswagen', 'Vintage', 'Racing Cars', 'Showroom', 'Special', 'City', 'City Bus',
      'Construction', 'Farm', 'Rescue World', 'SOS', 'Transporters', 'Trailers', 'Gift Pack',
      'Color Changers', 'Monster Rockerz', 'Castheads'],
    'Tomica': ['Tomica', 'Tomica Premium', 'Tomica Limited Vintage'],
    '*': ['Formula 1', 'Disney Cars', 'Batman', 'Blister protector', 'Storage case', 'Diorama', 'Poster car']
  },

  // Guess a category from the series when adding a car (admin)
  guessCategory(series) {
    const s = String(series || '').toLowerCase();
    if (!s) return '';
    if (/treasure hunt|rlc|chase/.test(s)) return 'Chase';
    if (/protector|storage|diorama|poster/.test(s)) return 'Accessory';
    if (/car culture|boulevard|pop culture|fast & furious|forza|ferrari|team transport|premium|collectors|deluxe|limited/.test(s)) return 'Premium';
    if (/mainline|color shifters|classic|street cars|basic/.test(s)) return 'Mainline';
    return '';
  }
};
