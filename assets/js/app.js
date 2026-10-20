// =====================================================================
//  MHC Diecast — shared code for every customer page
//  (Supabase client, cart, header/footer, small helpers)
// =====================================================================
(function () {
  const C = window.MHC_CONFIG || {};
  const sb = window.supabase
    ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

  // ---------- safe localStorage ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  // ---------- helpers ----------
  const money = n => (C.CURRENCY || '₹') +
    Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const param = name => new URLSearchParams(location.search).get(name);

  const isGoa = pin => /^\d{6}$/.test(String(pin || '').trim()) &&
    String(pin).trim().startsWith(C.GOA_PINCODE_PREFIX || '403');

  const COLORS = ['#E4202E', '#0A5BD3', '#FFC72C', '#FF6A13', '#12855A', '#7B2FF7', '#15171C'];
  function placeholder(seed) {
    let h = 0; for (const ch of String(seed || 'x')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const c = COLORS[h % COLORS.length];
    return 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#F2F2EF'/>` +
      `<rect y='150' width='200' height='12' fill='#FF7A00'/>` +
      `<path d='M30 128 L48 104 Q60 92 80 92 L124 92 Q140 92 152 106 L170 118 Q178 122 178 132 L178 138 L22 138 L22 132 Q22 128 30 128Z' fill='${c}'/>` +
      `<path d='M62 104 L76 96 L118 96 L134 106Z' fill='#cfe3ff' opacity='.9'/>` +
      `<circle cx='58' cy='140' r='13' fill='#15171C'/><circle cx='58' cy='140' r='5' fill='#ccc'/>` +
      `<circle cx='146' cy='140' r='13' fill='#15171C'/><circle cx='146' cy='140' r='5' fill='#ccc'/></svg>`);
  }
  const cover = p => (p.images && p.images[0]) || p.image || placeholder(p.id || p.name);

  // ---------- cart (stored in the browser) ----------
  const CART_KEY = 'mhc_cart_v1';
  const Cart = {
    items() { return store.get(CART_KEY, []); },
    save(items) { store.set(CART_KEY, items); updateCartCount(); },
    count() { return this.items().reduce((n, i) => n + i.qty, 0); },
    subtotal() { return this.items().reduce((s, i) => s + i.price * i.qty, 0); },
    add(p, qty = 1) {
      const items = this.items();
      const found = items.find(i => i.id === p.id);
      const max = Math.max(0, p.stock || 0);
      if (found) found.qty = Math.min(found.qty + qty, max);
      else items.push({ id: p.id, name: p.name, brand: p.brand, price: Number(p.price),
                        mrp: Number(p.mrp), image: (p.images && p.images[0]) || '',
                        stock: max, qty: Math.min(qty, max) });
      this.save(items.filter(i => i.qty > 0));
    },
    setQty(id, qty) {
      const items = this.items();
      const it = items.find(i => i.id === id);
      if (it) it.qty = Math.max(1, Math.min(qty, it.stock || qty));
      this.save(items);
    },
    remove(id) { this.save(this.items().filter(i => i.id !== id)); },
    clear() { this.save([]); },
    // Refresh prices/stock from the database; returns list of change messages
    async sync() {
      const items = this.items();
      if (!items.length || !sb) return [];
      const { data, error } = await sb.from('products')
        .select('id,name,brand,price,mrp,stock,images,is_active')
        .in('id', items.map(i => i.id));
      if (error) throw error;
      const notes = [], next = [];
      for (const it of items) {
        const p = (data || []).find(d => d.id === it.id);
        if (!p || !p.is_active) { notes.push(`${it.name} is no longer available and was removed.`); continue; }
        if (p.stock <= 0) { notes.push(`${p.name} just sold out and was removed.`); continue; }
        if (Number(p.price) !== it.price) notes.push(`Price of ${p.name} changed to ${money(p.price)}.`);
        let qty = it.qty;
        if (qty > p.stock) { qty = p.stock; notes.push(`Only ${p.stock} left of ${p.name}; quantity updated.`); }
        next.push({ ...it, name: p.name, brand: p.brand, price: Number(p.price), mrp: Number(p.mrp),
                    image: (p.images && p.images[0]) || '', stock: p.stock, qty });
      }
      this.save(next);
      return notes;
    }
  };

  // ---------- settings (UPI, shipping) ----------
  let settingsCache = null;
  async function getSettings() {
    if (settingsCache) return settingsCache;
    const { data, error } = await sb.from('settings').select('*').eq('id', 1).single();
    if (error) throw error;
    settingsCache = data;
    return data;
  }
  const shippingFor = (pin, settings) => isGoa(pin) ? 0 : Number(settings.outside_goa_shipping || 0);

  const waLink = (number, text) =>
    `https://wa.me/${String(number || '').replace(/\D/g, '')}?text=${encodeURIComponent(text || '')}`;

  // ---------- header / footer ----------
  function renderChrome() {
    const page = location.pathname.split('/').pop() || 'index.html';
    const link = (href, label, extra = '') =>
      `<a href="${href}" class="${page === href ? 'active ' : ''}${extra}">${label}</a>`;
    const header = document.getElementById('siteHeader');
    if (header) header.innerHTML = `
      <header class="site-header">
        <div class="container nav">
          <a href="index.html" class="logo" aria-label="${esc(C.STORE_NAME)} home">
            <span class="mark">⚡</span><span>MHC <span class="accent">Diecast</span></span>
          </a>
          <nav class="nav-links">
            ${link('index.html', 'Shop')}
            ${link('track.html', 'Track order', 'hide-sm')}
            <a href="cart.html" class="cart-btn ${page === 'cart.html' ? 'active' : ''}" aria-label="Cart">🛒
              <span class="cart-count" id="cartCount" hidden>0</span></a>
          </nav>
        </div>
      </header>`;
    const footer = document.getElementById('siteFooter');
    if (footer) footer.innerHTML = `
      <footer class="site-footer">
        <div class="container footer-inner">
          <div><strong>${esc(C.STORE_NAME)}</strong> · Bicholim, Goa</div>
          <div><a href="track.html">Track your order</a> · Free shipping in Goa · Pan-India shipping charges apply</div>
        </div>
      </footer>`;
    updateCartCount();
  }
  function updateCartCount() {
    const el = document.getElementById('cartCount');
    if (!el) return;
    const n = Cart.count();
    el.textContent = n; el.hidden = n === 0;
  }

  // ---------- toast ----------
  function toast(msg, type = '') {
    let box = document.getElementById('toastBox');
    if (!box) { box = document.createElement('div'); box.id = 'toastBox'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  // Friendly message from a Supabase error
  const errMsg = e => (e && (e.message || e.error_description)) || 'Something went wrong. Please try again.';

  window.addEventListener('storage', e => { if (e.key === CART_KEY) updateCartCount(); });
  document.addEventListener('DOMContentLoaded', renderChrome);

  window.MHC = { C, sb, store, money, esc, param, isGoa, placeholder, cover, Cart,
                 getSettings, shippingFor, waLink, toast, errMsg, updateCartCount };
})();
