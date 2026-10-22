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
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>` +
      `<ellipse cx='102' cy='146' rx='78' ry='7' fill='#000' opacity='.18'/>` +
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
      else items.push({ id: p.id, name: p.name, brand: p.brand, price: Number(p.price), seller_id: p.seller_id || null,
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
        .select('*')
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
        next.push({ ...it, name: p.name, brand: p.brand, price: Number(p.price), mrp: Number(p.mrp), seller_id: p.seller_id || null,
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
    // WhatsApp links need the country code: 7358425108 → 917358425108
    const wa = String(data.whatsapp_number || '').replace(/\D/g, '');
    data.whatsapp_number = wa.length === 10 ? '91' + wa : (wa || null);
    settingsCache = data;
    return data;
  }
  // ---------- sellers (public details: shop name, WhatsApp, UPI, shipping) ----------
  let sellersCache = null;
  async function getSellers() {
    if (sellersCache) return sellersCache;
    try {
      const { data, error } = await sb.from('sellers')
        .select('id,shop_name,whatsapp,upi_id,payee_name,qr_image_url,outside_goa_shipping,is_active');
      sellersCache = error ? [] : (data || []).filter(s => s.is_active).map(s => {
        const w = String(s.whatsapp || '').replace(/\D/g, '');
        return { ...s, whatsapp: w.length === 10 ? '91' + w : (w || null) };
      });
    } catch (e) { sellersCache = []; }
    return sellersCache;
  }
  // Seller of a car; falls back to the store's own details (single-seller setup)
  function sellerFor(id, sellers, settings) {
    const s = (sellers || []).find(x => x.id === id);
    if (s) return s;
    return { id: null, shop_name: (settings && settings.store_name) || C.STORE_NAME,
             whatsapp: settings && settings.whatsapp_number, upi_id: settings && settings.upi_id,
             payee_name: settings && settings.payee_name, qr_image_url: settings && settings.qr_image_url,
             outside_goa_shipping: settings ? settings.outside_goa_shipping : 0 };
  }

  const shippingFor = (pin, settings) => isGoa(pin) ? 0 : Number(settings.outside_goa_shipping || 0);

  const waLink = (number, text) =>
    `https://wa.me/${String(number || '').replace(/\D/g, '')}?text=${encodeURIComponent(text || '')}`;

  // Logo: embedded copy from logo.js, falls back to the image file
  const LOGO = window.MHC_LOGO || 'assets/img/logo-192.png';
  function fillLogos() { document.querySelectorAll('img[data-logo]:not(.photo)').forEach(i => { i.src = LOGO; }); }

  // Small Facebook mark used in footer links
  const FB = '<svg class="fb-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>';

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
            <img class="logo-img" src="${LOGO}" alt="MHC Diecast logo" width="52" height="52"><span>MHC <span class="accent">Diecast</span></span>
          </a>
          <nav class="nav-links">
            ${link('index.html', 'Shop')}
            ${link('track.html', 'Track order', 'hide-sm')}
            <button type="button" class="theme-toggle" id="themeToggle" aria-label="Switch dark mode">
              <svg class="i-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20.2 14.6A8.5 8.5 0 0 1 9.4 3.8a.6.6 0 0 0-.8-.7A9.5 9.5 0 1 0 20.9 15.4a.6.6 0 0 0-.7-.8z"/></svg>
              <svg class="i-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>
            </button>
            <a href="cart.html" class="cart-btn ${page === 'cart.html' ? 'active' : ''}" aria-label="Cart">🛒
              <span class="cart-count" id="cartCount" hidden>0</span></a>
          </nav>
        </div>
      </header>`;
    const footer = document.getElementById('siteFooter');
    const phone = String(C.CONTACT_PHONE || '');
    const phoneNice = phone.replace(/(\d{5})(\d{5})/, '$1 $2');
    if (footer) footer.innerHTML = `
      <footer class="site-footer">
        <div class="container footer-grid">
          <div class="footer-brand">
            <img class="footer-logo" src="${LOGO}" alt="${esc(C.STORE_NAME)} logo" width="84" height="84" loading="lazy">
            <div>
              <strong>${esc(C.STORE_NAME)}</strong>
              <div class="footer-note">Hot Wheels and 1:64 diecasts from Bicholim. Free shipping across Goa, delivery across India.</div>
            </div>
          </div>
          <div class="footer-col">
            <h4>Shop</h4>
            <a href="index.html?c=hot-wheels">Hot Wheels</a>
            <a href="index.html?c=mini-gt">Mini GT</a>
            <a href="index.html?c=pre-owned">Pre-owned</a>
            <a href="index.html?c=accessories">Accessories</a>
            <a href="index.html">All cars</a>
          </div>
          <div class="footer-col">
            <h4>Help</h4>
            <a href="track.html">Track order</a>
            <a href="shipping.html">Shipping & returns</a>
            <a href="contact.html">Contact</a>
          </div>
          <div class="footer-col">
            <h4>Visit / call</h4>
            <span>📍 ${esc(C.STORE_LOCATION || 'Goa')}</span>
            ${phone ? `<a href="tel:+91${esc(phone)}">📞 +91 ${esc(phoneNice)}</a>
            <a href="${esc(waLink('91' + phone, 'Hi MHC Diecast! '))}" target="_blank" rel="noopener">💬 WhatsApp us</a>` : ''}
          </div>
          <div class="footer-col">
            <h4>Community</h4>
            ${C.WHATSAPP_GROUP ? `<a class="footer-group" href="${esc(C.WHATSAPP_GROUP)}" target="_blank" rel="noopener">Join the WhatsApp group</a>
            <span class="footer-note">New arrivals & drops first</span>` : ''}
            ${C.FACEBOOK_PAGE ? `<a class="fb-link" href="${esc(C.FACEBOOK_PAGE)}" target="_blank" rel="noopener">${FB}Follow MHC Diecast on Facebook</a>` : ''}
          </div>
        </div>
        <div class="container footer-credits">
          <span>Founder: ${C.FOUNDER_URL ? `<a class="fb-inline" href="${esc(C.FOUNDER_URL)}" target="_blank" rel="noopener" title="Maitreya Hinde on Facebook">${FB}${esc(C.FOUNDER_NAME)}</a>` : esc(C.FOUNDER_NAME || '')}</span>
          <span>Developed by ${C.DESIGNER_URL ? `<a class="fb-inline" href="${esc(C.DESIGNER_URL)}" target="_blank" rel="noopener" title="MHC Digital on Facebook">${FB}${esc(C.DESIGNER_NAME)}</a>` : esc(C.DESIGNER_NAME || '')}</span>
        </div>
        <div class="container footer-legal">© ${new Date().getFullYear()} ${esc(C.STORE_NAME)}, ${esc(C.STORE_LOCATION || 'Goa')}. Hot Wheels and other brand names are trademarks of their owners; we are an independent seller.</div>
      </footer>`;
    updateCartCount();
    if (page !== 'checkout.html' && page !== 'admin.html') addWhatsAppButton();
  }

  // Floating WhatsApp chat button (uses the number saved in Settings)
  async function addWhatsAppButton() {
    try {
      const s = await getSettings();
      if (!s.whatsapp_number || document.getElementById('waFloat')) return;
      const a = document.createElement('a');
      a.id = 'waFloat'; a.className = 'wa-float'; a.target = '_blank'; a.rel = 'noopener';
      a.href = waLink(s.whatsapp_number, 'Hi MHC Diecast! ');
      a.setAttribute('aria-label', 'Chat on WhatsApp');
      a.innerHTML = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path fill="#fff" d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.8 2 6.8L3 29l6.8-2.2c1.9 1 4 1.6 6.2 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3zm0 23.1c-2 0-3.9-.6-5.6-1.6l-.4-.2-4 1.3 1.3-3.9-.3-.4c-1.1-1.7-1.7-3.7-1.7-5.7C5.3 9.8 10.1 5 16 5s10.7 4.8 10.7 10.7S21.9 26.1 16 26.1zm5.9-8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.4c.2.2 2.4 3.6 5.7 5.1.8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.1-.3-.2-.6-.4z"/></svg>';
      document.body.appendChild(a);
    } catch (e) { /* no button if settings can't load */ }
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
  // ---------- 3D tilt: cards, hero stage, product photo (fine pointers only) ----------
  function enableTilt() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = '.card:not(.skeleton), .stage, .gallery-main';
    let active = null;
    document.addEventListener('pointermove', e => {
      const el = e.target.closest(targets);
      if (active && active !== el) reset(active);
      active = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const max = el.classList.contains('card') ? 6 : 8;
      const node = el.classList.contains('stage') ? el.querySelector('.stage-object') : el;
      if (!node) return;
      node.style.setProperty('--rx', ((0.5 - y) * max).toFixed(2) + 'deg');
      node.style.setProperty('--ry', ((x - 0.5) * max).toFixed(2) + 'deg');
      el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    }, { passive: true });
    document.addEventListener('pointerleave', () => active && reset(active));
    function reset(el) {
      const node = el.classList.contains('stage') ? el.querySelector('.stage-object') : el;
      if (node) { node.style.removeProperty('--rx'); node.style.removeProperty('--ry'); }
    }
  }

  // ---------- light / dark theme ----------
  const THEME_KEY = 'mhc-theme';
  function currentTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t, save) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0B0C10' : '#F5F5F7');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    if (save) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
  }
  function initTheme() {
    if (document.body.classList.contains('admin')) return;   // admin keeps its own look
    let saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(saved || (mq.matches ? 'dark' : 'light'), false);
    if (!saved && mq.addEventListener) mq.addEventListener('change', e => {
      let s = null; try { s = localStorage.getItem(THEME_KEY); } catch (_) {}
      if (!s) applyTheme(e.matches ? 'dark' : 'light', false);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#themeToggle')) return;
      document.documentElement.classList.add('theme-anim');
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
      setTimeout(() => document.documentElement.classList.remove('theme-anim'), 500);
    });
  }

  // ---------- floating background scene ----------
  function addScene() {
    if (document.body.classList.contains('admin') || document.querySelector('.bg-scene')) return;
    const s = document.createElement('div');
    s.className = 'bg-scene'; s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<div class="bg-layer"><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span><span class="orb o4"></span></div>' +
                  '<div class="bg-floor"></div><div class="bg-grain"></div>';
    document.body.prepend(s);
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = s.querySelector('.bg-layer');
    let raf = 0, tx = 0, ty = 0;
    window.addEventListener('pointermove', e => {
      tx = (e.clientX / innerWidth - 0.5) * -28; ty = (e.clientY / innerHeight - 0.5) * -20;
      if (!raf) raf = requestAnimationFrame(() => { layer.style.transform = `translate3d(${tx}px, ${ty}px, 0)`; raf = 0; });
    }, { passive: true });
  }

  initTheme();
  document.addEventListener('DOMContentLoaded', () => { addScene(); renderChrome(); fillLogos(); enableTilt(); applyTheme(currentTheme(), false); });

  window.MHC = { C, sb, store, money, esc, param, isGoa, placeholder, cover, Cart,
                 getSettings, getSellers, sellerFor, shippingFor, waLink, toast, errMsg, updateCartCount };
})();
