// =====================================================================
//  MHC Diecast — admin panel (master admin + sellers)
// =====================================================================
(function () {
  const { C, esc, money, placeholder, toast } = window.MHC;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mhc-admin-auth' }
  });
  const $ = id => document.getElementById(id);
  const SITE = location.origin + location.pathname.replace(/admin\.html$/, '');
  const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'rejected', 'cancelled'];

  const state = {
    status: 'pending', orders: [], counts: {}, shots: {},
    products: [], settings: null,
    role: null, me: null, uid: null, sellers: [], sellerFilter: '', productSellerFilter: '',
    edit: null, editImages: [], removedImages: [], uploading: 0,
    lastPending: null, poll: null
  };
  const errText = e => (e && (e.message || e.error_description)) || 'Something went wrong';

  // ------------------------------------------------------------------ AUTH
  const isMaster = () => state.role === 'admin';
  async function loadProfile() {
    const { data: u } = await sb.auth.getUser();
    state.uid = u && u.user ? u.user.id : null;
    const { data, error } = await sb.rpc('my_profile');
    if (!error && data && data.role) { state.role = data.role; state.me = data.seller || null; return true; }
    // before the multi-seller update is installed: fall back to the old admin check
    const old = await sb.rpc('is_admin');
    if (!old.error && old.data === true) { state.role = 'admin'; state.me = null; return true; }
    state.role = null; state.me = null; return false;
  }
  async function boot() {
    const { data } = await sb.auth.getSession();
    if (data.session && await loadProfile()) showApp();
    else { if (data.session) await sb.auth.signOut(); showLogin(); }
  }
  function showLogin() {
    $('appView').hidden = true; $('loginView').hidden = false;
    clearInterval(state.poll);
    $('email').focus();
  }
  function applyRole() {
    document.querySelectorAll('[data-role="admin"]').forEach(el => { el.hidden = !isMaster(); });
    $('roleLabel').textContent = isMaster() ? 'Master admin' : (state.me ? state.me.shop_name : '');
    document.body.classList.toggle('is-seller', !isMaster());
  }
  async function showApp() {
    $('loginView').hidden = true; $('appView').hidden = false;
    applyRole();
    await loadSellers();
    loadOrders(); loadProducts(); loadShop();
    if (isMaster()) loadSettings();
    if (!state.me) $('shopError').textContent = isMaster()
      ? 'Run supabase/phase7-sellers.sql in Supabase to set up your shop and sellers.' : '';
    $('shopError').hidden = !!state.me;
    clearInterval(state.poll);
    state.poll = setInterval(() => { if (!document.hidden) loadOrders(true); }, 60000);
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginBtn'), err = $('loginError');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Logging in…';
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (!error && await loadProfile()) { $('password').value = ''; showApp(); }
    else {
      if (!error) await sb.auth.signOut();
      err.textContent = error ? 'Wrong email or password.' : 'This account has no shop access yet, or it is paused. Contact the store admin.';
      err.hidden = false;
    }
    btn.disabled = false; btn.textContent = 'Log in';
  });
  $('logoutBtn').onclick = async () => { await sb.auth.signOut(); showLogin(); };

  // ------------------------------------------------------------------ SELLERS (data)
  const sellerName = id => { const s = state.sellers.find(x => x.id === id); return s ? s.shop_name : 'No seller'; };
  async function loadSellers() {
    if (isMaster()) {
      const { data, error } = await sb.rpc('admin_list_sellers');
      state.sellers = error ? [] : (data || []);
    } else state.sellers = state.me ? [state.me] : [];
    const opts = state.sellers.map(s => `<option value="${esc(s.id)}">${esc(s.shop_name)}${s.is_active ? '' : ' (paused)'}</option>`).join('');
    $('orderSeller').innerHTML = '<option value="">All sellers</option>' + opts;
    $('productSeller').innerHTML = '<option value="">All sellers</option>' + opts;
    $('orderSeller').value = state.sellerFilter; $('productSeller').value = state.productSellerFilter;
    $('p_seller').innerHTML = opts;
    if (isMaster()) renderSellers();
  }
  $('orderSeller').addEventListener('change', e => { state.sellerFilter = e.target.value; loadOrders(); });
  $('productSeller').addEventListener('change', e => { state.productSellerFilter = e.target.value; renderProducts(); });

  // ------------------------------------------------------------------ TABS
  $('tabs').addEventListener('click', e => {
    const t = e.target.closest('.a-tab'); if (!t) return;
    document.querySelectorAll('.a-tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.a-section').forEach(s => { s.hidden = s.id !== 'tab-' + t.dataset.tab; });
    window.scrollTo(0, 0);
  });

  // close buttons in dialogs
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target.closest('[data-close]') || e.target === d) d.close();
    });
  });

  // ------------------------------------------------------------------ ORDERS
  async function loadOrders(silent) {
    const list = $('orderList');
    if (!silent) list.innerHTML = '<p class="empty">Loading orders…</p>';
    try {
      const [cnt, res] = await Promise.all([
        (() => { let c = sb.from('orders').select('status').limit(5000);
                 if (isMaster() && state.sellerFilter) c = c.eq('seller_id', state.sellerFilter);
                 return c; })(),
        (() => {
          // Pending: oldest first so nothing waits too long. Others: newest first.
          let q = sb.from('orders').select('*').order('created_at', { ascending: state.status === 'pending' }).limit(150);
          if (state.status !== 'all') q = q.eq('status', state.status);
          if (isMaster() && state.sellerFilter) q = q.eq('seller_id', state.sellerFilter);
          return q;
        })()
      ]);
      if (cnt.error) throw cnt.error;
      if (res.error) throw res.error;
      state.counts = {};
      (cnt.data || []).forEach(r => { state.counts[r.status] = (state.counts[r.status] || 0) + 1; });
      state.orders = res.data || [];
      notifyPending();
      renderChips();
      await signShots();
      renderOrders();
    } catch (e) {
      if (!silent) list.innerHTML = `<p class="empty">Couldn't load orders: ${esc(errText(e))}</p>`;
    }
  }

  function notifyPending() {
    const p = state.counts.pending || 0;
    $('pendingBadge').textContent = p; $('pendingBadge').hidden = !p;
    document.title = (p ? `(${p}) ` : '') + 'Admin — MHC Diecast';
    if (state.lastPending !== null && p > state.lastPending) {
      toast(`🔔 ${p - state.lastPending} new order(s) to verify`, 'ok');
      try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) {}
    }
    state.lastPending = p;
  }

  function renderChips() {
    const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
    $('statusChips').innerHTML = [...STATUSES, 'all'].map(s => {
      const n = s === 'all' ? total : (state.counts[s] || 0);
      return `<button class="chip${state.status === s ? ' active' : ''}" data-status="${s}">
        ${s[0].toUpperCase() + s.slice(1)} <span class="chip-n">${n}</span></button>`;
    }).join('');
  }
  $('statusChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.status = c.dataset.status; loadOrders();
  });
  $('refreshOrders').onclick = () => loadOrders();
  $('orderSearch').addEventListener('input', renderOrders);

  async function signShots() {
    const paths = state.orders.map(o => o.screenshot_path).filter(p => p && !state.shots[p]);
    if (!paths.length) return;
    const { data } = await sb.storage.from('payment-screenshots').createSignedUrls(paths, 3600);
    (data || []).forEach(d => { if (d.signedUrl) state.shots[d.path] = d.signedUrl; });
  }

  function orderCard(o) {
    const shot = state.shots[o.screenshot_path];
    const date = new Date(o.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const items = (o.items || []).map(i =>
      `<li><img src="${esc(i.image || placeholder(i.id))}" alt=""><span>${esc(i.name)} <b>× ${i.qty}</b></span><span>${money(i.price * i.qty)}</span></li>`).join('');
    const acts = {
      pending:   `<button class="btn btn-ok" data-act="confirmed">✓ Approve payment</button>
                  <button class="btn btn-ghost danger" data-act="rejected">✕ Reject</button>`,
      confirmed: `<button class="btn btn-primary" data-act="shipped">🚚 Mark shipped</button>
                  <button class="btn btn-ghost danger" data-act="cancelled">Cancel order</button>`,
      shipped:   `<button class="btn btn-ok" data-act="delivered">✓ Mark delivered</button>`,
      delivered: '', rejected: `<button class="btn btn-ghost" data-act="pending">↺ Back to pending</button>`,
      cancelled: `<button class="btn btn-ghost" data-act="pending">↺ Back to pending</button>`
    }[o.status] || '';
    const hours = Math.floor((Date.now() - new Date(o.created_at)) / 36e5);
    const overdue = o.status === 'pending' && hours >= 24;
    return `
      <article class="a-order${overdue ? ' overdue' : ''}" data-id="${esc(o.id)}">
        ${overdue ? `<div class="overdue-bar">⏰ Waiting ${hours >= 48 ? Math.floor(hours / 24) + ' days' : hours + ' hours'} — please verify</div>` : ''}
        <header class="a-order-head">
          <div><b class="mono">${esc(o.order_code)}</b> <span class="status ${esc(o.status)}">${esc(o.status)}</span>
            ${isMaster() && state.sellers.length > 1 ? `<span class="pill seller">${esc(sellerName(o.seller_id))}</span>` : ''}</div>
          <span class="muted small">${date}</span>
        </header>
        <div class="a-order-body">
          <button class="a-shot" data-shot="${esc(shot || '')}" ${shot ? '' : 'disabled'} title="View payment screenshot">
            ${shot ? `<img src="${esc(shot)}" alt="Payment screenshot" loading="lazy">` : '<span>No image</span>'}
            <span class="a-shot-label">Payment</span>
          </button>
          <div class="a-order-info">
            <div class="a-amount">${money(o.total)} <span class="muted small">${o.shipping > 0 ? `incl. ${money(o.shipping)} shipping` : 'free shipping'}</span></div>
            ${o.utr ? `<div class="small">UTR: <b class="mono">${esc(o.utr)}</b></div>` : '<div class="small muted">No UTR given</div>'}
            <div class="a-cust">
              <div><b>${esc(o.customer_name)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
              <div class="small">${esc(o.address)}${o.city ? ', ' + esc(o.city) : ''}${o.state ? ', ' + esc(o.state) : ''} – <b>${esc(o.pincode)}</b>
                <span class="pill ${o.is_goa ? 'goa' : ''}">${o.is_goa ? 'Goa' : 'Outside Goa'}</span></div>
              ${o.email ? `<div class="small muted">${esc(o.email)}</div>` : ''}
            </div>
          </div>
        </div>
        <ul class="a-items">${items}</ul>
        ${o.tracking_number ? `<div class="small">📦 Tracking: <b class="mono">${esc(o.tracking_number)}</b></div>` : ''}
        ${o.admin_note ? `<div class="small muted">📝 ${esc(o.admin_note)}</div>` : ''}
        <div class="a-actions">
          ${acts}
          <span class="grow"></span>
          <button class="btn btn-ghost" data-act="copy" title="Copy shipping address">📋 Address</button>
          <button class="btn btn-wa" data-act="wa" title="WhatsApp buyer">WhatsApp</button>
        </div>
      </article>`;
  }

  function renderOrders() {
    const term = $('orderSearch').value.trim().toLowerCase();
    const list = state.orders.filter(o => !term ||
      [o.order_code, o.customer_name, o.phone, o.pincode, o.utr].join(' ').toLowerCase().includes(term));
    $('orderList').innerHTML = list.length ? list.map(orderCard).join('')
      : `<p class="empty">${term ? 'No orders match.' : state.status === 'pending' ? 'No payments waiting. 🏁' : 'No orders here yet.'}</p>`;
  }

  function waMessage(o, status) {
    const track = `${SITE}track.html?order=${encodeURIComponent(o.order_code)}&phone=${o.phone}`;
    const name = o.customer_name.split(' ')[0];
    return {
      pending:   `Hi ${name}, we've received your order ${o.order_code} (${money(o.total)}). We're verifying your payment and will confirm shortly.`,
      confirmed: `Hi ${name}, payment received ✅ Your order ${o.order_code} is confirmed and will be shipped soon.\nTrack: ${track}`,
      shipped:   `Hi ${name}, your order ${o.order_code} has been shipped 🚚${o.tracking_number ? `\nTracking no: ${o.tracking_number}` : ''}\nTrack: ${track}`,
      delivered: `Hi ${name}, your order ${o.order_code} has been delivered. Thank you for shopping with ${o.seller_id ? sellerName(o.seller_id) : C.STORE_NAME}! 🏁`,
      rejected:  `Hi ${name}, we couldn't verify the payment for order ${o.order_code}. Please reply with the correct screenshot / UTR so we can help.`,
      cancelled: `Hi ${name}, your order ${o.order_code} has been cancelled. Any amount paid will be refunded. Sorry for the trouble.`
    }[status || o.status];
  }
  const waUrl = (o, status) => `https://wa.me/91${o.phone}?text=${encodeURIComponent(waMessage(o, status))}`;

  $('orderList').addEventListener('click', async e => {
    const shotBtn = e.target.closest('.a-shot');
    if (shotBtn && shotBtn.dataset.shot) {
      $('imgFull').src = shotBtn.dataset.shot; $('imgOpen').href = shotBtn.dataset.shot;
      $('imgDialog').showModal(); return;
    }
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const o = state.orders.find(x => x.id === btn.closest('.a-order').dataset.id); if (!o) return;
    const act = btn.dataset.act;

    if (act === 'wa') { window.open(waUrl(o), '_blank'); return; }
    if (act === 'copy') {
      const txt = `${o.customer_name}\n${o.phone}\n${o.address}${o.city ? ', ' + o.city : ''}\n${o.state ? o.state + ' – ' : ''}${o.pincode}`;
      try { await navigator.clipboard.writeText(txt); toast('Address copied', 'ok'); } catch (_) { prompt('Copy address:', txt); }
      return;
    }

    const patch = { status: act };
    if (act === 'rejected' || act === 'cancelled') {
      const why = prompt(`${act === 'rejected' ? 'Reject' : 'Cancel'} ${o.order_code}? Stock will be put back.\nReason (optional, for your notes):`, '');
      if (why === null) return;
      if (why.trim()) patch.admin_note = why.trim();
    } else if (act === 'shipped') {
      const tn = prompt('Tracking / courier number (leave empty for hand delivery):', o.tracking_number || '');
      if (tn === null) return;
      patch.tracking_number = tn.trim() || null;
    } else if (act === 'confirmed') {
      if (!confirm(`Approve payment of ${money(o.total)} for ${o.order_code}?\nCheck the amount reached ${isMaster() && o.seller_id && (!state.me || o.seller_id !== state.me.id) ? sellerName(o.seller_id) + "'s" : 'your'} UPI account.`)) return;
    }

    btn.disabled = true;
    const { error } = await sb.from('orders').update(patch).eq('id', o.id);
    if (error) { toast(errText(error), 'warn'); btn.disabled = false; return; }
    toast(`${o.order_code} → ${act}`, 'ok');
    const updated = { ...o, ...patch };
    if (['confirmed', 'shipped', 'rejected', 'cancelled', 'delivered'].includes(act) &&
        confirm('Send WhatsApp update to the buyer?')) window.open(waUrl(updated, act), '_blank');
    if (['rejected', 'cancelled', 'pending'].includes(act)) loadProducts();
    loadOrders(true);
  });

  // ------------------------------------------------------------------ PRODUCTS
  async function loadProducts() {
    let q = sb.from('products').select('*').order('created_at', { ascending: false });
    if (!isMaster()) q = q.eq('seller_id', state.me ? state.me.id : '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q;
    if (error) { $('productList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    state.products = data || [];
    const uniq = k => [...new Set(state.products.map(p => p[k]).filter(Boolean))].sort();
    $('brandList').innerHTML = [...new Set([...CAT.BRANDS, ...uniq('brand')])]
      .map(b => `<option value="${esc(b)}">`).join('');
    fillSeries();
    renderProducts();
  }

  // ---------- catalogue suggestions (assets/js/catalog.js) ----------
  const CAT = window.MHC_CATALOG || { CATEGORIES: ['Mainline', 'Premium', 'Chase', 'Pre-owned', 'Accessory'],
                                       BRANDS: [], SERIES: {}, SCALES: ['1:64'], guessCategory: () => '' };
  $('p_category').innerHTML = '<option value="">Choose…</option>' +
    CAT.CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('scaleList').innerHTML = CAT.SCALES.map(s => `<option value="${esc(s)}">`).join('');
  function fillSeries() {
    const brand = $('p_brand').value.trim();
    const used = state.products.filter(p => p.brand === brand).map(p => p.series).filter(Boolean);
    const list = [...new Set([...(CAT.SERIES[brand] || []), ...used, ...(CAT.SERIES['*'] || [])])];
    $('seriesList').innerHTML = list.map(s => `<option value="${esc(s)}">`).join('');
  }
  $('p_brand').addEventListener('input', fillSeries);
  $('p_series').addEventListener('change', () => {
    if ($('p_category').value) return;           // never overwrite a choice
    const g = CAT.guessCategory($('p_series').value);
    if (g) $('p_category').value = g;
  });

  function renderProducts() {
    const term = $('productSearch').value.trim().toLowerCase();
    const ps = state.products.filter(p => !isMaster() || !state.productSellerFilter || p.seller_id === state.productSellerFilter);
    const live = ps.filter(p => p.is_active && p.stock > 0).length;
    $('productStats').textContent = `${ps.length} cars · ${live} on sale · ${ps.filter(p => p.stock <= 0).length} sold out · ${ps.filter(p => !p.is_active).length} hidden`;
    const list = ps.filter(p => !term || [p.name, p.brand, p.series, p.category].join(' ').toLowerCase().includes(term));
    $('productList').innerHTML = list.length ? list.map(p => `
      <div class="a-prod${p.is_active ? '' : ' hidden-prod'}" data-id="${esc(p.id)}">
        <img src="${esc((p.images && p.images[0]) || placeholder(p.id))}" alt="" loading="lazy">
        <div class="a-prod-info">
          <span class="card-brand">${esc(p.brand)}${p.series ? ' · ' + esc(p.series) : ''}</span>
          <b>${esc(p.name)}</b>
          <span class="a-pills">${p.category ? `<span class="pill cat">${esc(p.category)}</span>` : '<span class="pill bad">No category</span>'}
            ${isMaster() && state.sellers.length > 1 ? `<span class="pill seller">${esc(sellerName(p.seller_id))}</span>` : ''}</span>
          <span class="small">${money(p.price)} <span class="muted">MRP ${money(p.mrp)}</span>
            ${p.is_active ? '' : '<span class="pill">Hidden</span>'}${p.stock <= 0 ? '<span class="pill bad">Sold out</span>' : ''}</span>
        </div>
        <div class="a-prod-side">
          <div class="qty sm" title="Stock">
            <button data-act="dec" aria-label="Less stock">−</button><input value="${p.stock}" readonly aria-label="Stock"><button data-act="inc" aria-label="More stock">+</button>
          </div>
          <button class="btn btn-ghost sm" data-act="edit">Edit</button>
        </div>
      </div>`).join('')
      : `<p class="empty">${term ? 'No cars match.' : 'No cars yet — tap “+ Add car”.'}</p>`;
  }
  $('productSearch').addEventListener('input', renderProducts);

  $('productList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const p = state.products.find(x => x.id === btn.closest('.a-prod').dataset.id); if (!p) return;
    if (btn.dataset.act === 'edit') return openProduct(p);
    const stock = Math.max(0, p.stock + (btn.dataset.act === 'inc' ? 1 : -1));
    if (stock === p.stock) return;
    p.stock = stock; renderProducts();
    const { error } = await sb.from('products').update({ stock, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { toast(errText(error), 'warn'); loadProducts(); }
  });

  // ---------- product editor ----------
  $('addProduct').onclick = () => openProduct(null);

  function openProduct(p) {
    state.edit = p ? { ...p } : { id: (crypto.randomUUID ? crypto.randomUUID() : uuid()), _new: true };
    state.editImages = p ? [...(p.images || [])] : [];
    state.removedImages = [];
    $('productDialogTitle').textContent = p ? 'Edit car' : 'Add car';
    $('p_name').value = p ? p.name : '';
    $('p_brand').value = p ? p.brand : 'Hot Wheels';
    $('p_series').value = p ? (p.series || '') : '';
    $('p_mrp').value = p ? p.mrp : '';
    $('p_price').value = p ? p.price : '';
    $('p_stock').value = p ? p.stock : 1;
    $('p_scale').value = p ? (p.scale || '1:64') : '1:64';
    $('p_category').value = p ? (p.category || '') : '';
    if (isMaster()) $('p_seller').value = p ? (p.seller_id || '') : (state.productSellerFilter || (state.me && state.me.id) || (state.sellers[0] && state.sellers[0].id) || '');
    fillSeries();
    $('p_active').checked = p ? p.is_active : true;
    $('p_description').value = p ? (p.description || '') : '';
    $('deleteProduct').hidden = !p;
    $('productError').hidden = true;
    renderPhotos();
    $('productDialog').showModal();
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function renderPhotos() {
    $('photoGrid').innerHTML = state.editImages.map((src, i) => `
      <div class="photo" data-i="${i}">
        <img src="${esc(src)}" alt="">
        ${i === 0 ? '<span class="cover-tag">Cover</span>' : `<button type="button" class="ph-btn" data-ph="cover" title="Make cover">★</button>`}
        <button type="button" class="ph-btn ph-del" data-ph="del" title="Remove">✕</button>
      </div>`).join('') +
      Array.from({ length: state.uploading }, () => '<div class="photo loading"><span>Uploading…</span></div>').join('');
  }
  $('photoGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-ph]'); if (!b) return;
    const i = +b.closest('.photo').dataset.i;
    if (b.dataset.ph === 'del') state.removedImages.push(...state.editImages.splice(i, 1));
    if (b.dataset.ph === 'cover') state.editImages.unshift(...state.editImages.splice(i, 1));
    renderPhotos();
  });

  async function compress(file, max = 1200, quality = 0.85) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      return await new Promise(r => cv.toBlob(b => r(b || file), 'image/jpeg', quality));
    } catch (_) { return file; }
  }
  async function uploadImage(bucket, folder, file) {
    const blob = await compress(file);
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw error;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
  const pathFromUrl = (url, bucket) => {
    const i = url.indexOf(`/${bucket}/`); return i >= 0 ? decodeURIComponent(url.slice(i + bucket.length + 2)) : null;
  };

  $('photoFiles').addEventListener('change', async e => {
    const files = [...e.target.files].filter(f => f.type.startsWith('image/'));
    e.target.value = '';
    const folder = state.edit.id;
    await Promise.all(files.map(async f => {
      state.uploading++; renderPhotos();
      try { state.editImages.push(await uploadImage('product-images', folder, f)); }
      catch (err) { toast('Photo upload failed: ' + errText(err), 'warn'); }
      finally { state.uploading--; renderPhotos(); }
    }));
  });

  $('productForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('productError');
    const show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    const row = {
      id: state.edit.id,
      name: $('p_name').value.trim(),
      brand: $('p_brand').value.trim() || 'Hot Wheels',
      series: $('p_series').value.trim() || null,
      scale: $('p_scale').value.trim() || '1:64',
      category: $('p_category').value || null,
      seller_id: isMaster() ? ($('p_seller').value || null) : (state.me && state.me.id),
      mrp: Number($('p_mrp').value),
      price: Number($('p_price').value),
      stock: parseInt($('p_stock').value, 10),
      is_active: $('p_active').checked,
      description: $('p_description').value.trim() || null,
      images: state.editImages,
      updated_at: new Date().toISOString()
    };
    if (!row.name) return show('Enter the car name.', 'p_name');
    if (!row.category) return show('Choose a category.', 'p_category');
    if (!row.seller_id && state.sellers.length) return show('Choose the seller.', 'p_seller');
    if (!state.sellers.length) delete row.seller_id;   // before the multi-seller update
    if (!(row.mrp >= 0) || $('p_mrp').value === '') return show('Enter the MRP.', 'p_mrp');
    if (!(row.price >= 0) || $('p_price').value === '') return show('Enter the selling price.', 'p_price');
    if (!(row.stock >= 0)) return show('Stock must be 0 or more.', 'p_stock');
    if (state.uploading) return show('Wait for photos to finish uploading.');
    if (row.price > row.mrp && !confirm('Selling price is higher than MRP. Save anyway?')) return;

    const btn = $('saveProduct'); btn.disabled = true; btn.textContent = 'Saving…';
    const q = state.edit._new ? sb.from('products').insert(row) : sb.from('products').update(row).eq('id', row.id);
    const { error } = await q;
    btn.disabled = false; btn.textContent = 'Save';
    if (error && /category/i.test(error.message || '')) return show('Run supabase/phase6-categories.sql in Supabase first, then save again.');
    if (error) return show(errText(error));
    state.edit._saved = true;
    removeFiles(state.removedImages);
    $('productDialog').close();
    toast(state.edit._new ? 'Car added 🏁' : 'Car updated', 'ok');
    loadProducts();
  });

  // Clean up photos uploaded for a new car that was never saved
  $('productDialog').addEventListener('close', () => {
    if (state.edit && state.edit._new && !state.edit._saved) {
      removeFiles(state.editImages);
    }
  });

  function removeFiles(urls) {
    const paths = (urls || []).map(u => pathFromUrl(u, 'product-images')).filter(Boolean);
    if (paths.length) sb.storage.from('product-images').remove(paths);
  }

  $('deleteProduct').onclick = async () => {
    const p = state.edit;
    if (!confirm(`Delete "${p.name}" permanently?\nTip: to just stop selling it, untick "Visible in shop" instead.`)) return;
    const { error } = await sb.from('products').delete().eq('id', p.id);
    if (error) { toast(errText(error), 'warn'); return; }
    removeFiles([...(p.images || []), ...state.editImages]);
    state.edit = null;
    $('productDialog').close();
    toast('Car deleted', 'ok');
    loadProducts();
  };

  // ------------------------------------------------------------------ SETTINGS (master)
  const SFIELDS = ['store_name', 'whatsapp_number'];
  async function loadSettings() {
    const { data, error } = await sb.from('settings').select('*').eq('id', 1).single();
    if (error) { toast(errText(error), 'warn'); return; }
    state.settings = data;
    SFIELDS.forEach(k => { $('s_' + k).value = data[k] == null ? '' : data[k]; });
  }
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const row = {};
    SFIELDS.forEach(k => { row[k] = $('s_' + k).value.trim() || null; });
    row.whatsapp_number = row.whatsapp_number ? row.whatsapp_number.replace(/\D/g, '') : null;
    if (row.whatsapp_number && row.whatsapp_number.length === 10) row.whatsapp_number = '91' + row.whatsapp_number;
    row.store_name = row.store_name || 'MHC Diecast';
    row.updated_at = new Date().toISOString();
    const btn = $('saveSettings'); btn.disabled = true;
    const { error } = await sb.from('settings').update(row).eq('id', 1);
    btn.disabled = false;
    if (error) { toast(errText(error), 'warn'); return; }
    toast('Settings saved', 'ok');
    loadSettings();
  });

  // ------------------------------------------------------------------ MY SHOP (every seller)
  const MFIELDS = ['shop_name', 'whatsapp', 'upi_id', 'payee_name', 'outside_goa_shipping'];
  const validWa = v => /^[6-9]\d{9}$/.test(String(v).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''));
  const validUpi = v => /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v);
  function loadShop() {
    const m = state.me;
    $('shopForm').querySelectorAll('input, button').forEach(el => { el.disabled = !m; });
    if (!m) return;
    MFIELDS.forEach(k => { $('m_' + k).value = m[k] == null ? '' : m[k]; });
    showQr(m.qr_image_url);
  }
  function showQr(url) {
    $('qrPreview').hidden = !url; $('qrRemove').hidden = !url;
    if (url) $('qrPreview').src = url;
  }
  async function refreshMe() {
    const { data } = await sb.rpc('my_profile');
    if (data && data.seller) state.me = data.seller;
    await loadSellers(); applyRole(); loadShop();
  }
  $('shopForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('shopError');
    const show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    err.hidden = true;
    const row = {};
    MFIELDS.forEach(k => { row[k] = $('m_' + k).value.trim() || null; });
    if (!row.shop_name) return show('Enter your shop name.', 'm_shop_name');
    if (!row.whatsapp || !validWa(row.whatsapp)) return show('Enter a valid 10-digit WhatsApp number — buyers contact you on it.', 'm_whatsapp');
    if (!row.upi_id || !validUpi(row.upi_id)) return show('Enter a valid UPI ID (e.g. name@okicici) — buyers pay you on it.', 'm_upi_id');
    row.outside_goa_shipping = Number(row.outside_goa_shipping || 0);
    const btn = $('saveShop'); btn.disabled = true;
    const { error } = await sb.from('sellers').update(row).eq('id', state.me.id);
    btn.disabled = false;
    if (error) return show(errText(error));
    toast('Shop details saved', 'ok');
    refreshMe();
  });
  $('qrFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !state.me) return;
    try {
      const old = state.me.qr_image_url;
      const url = await uploadImage('site-assets', 'qr/' + state.me.id, f);
      const { error } = await sb.from('sellers').update({ qr_image_url: url }).eq('id', state.me.id);
      if (error) throw error;
      if (old) { const p = pathFromUrl(old, 'site-assets'); if (p) sb.storage.from('site-assets').remove([p]); }
      state.me.qr_image_url = url; showQr(url); toast('QR uploaded', 'ok');
    } catch (err) { toast('QR upload failed: ' + errText(err), 'warn'); }
  });
  $('qrRemove').onclick = async () => {
    const old = state.me.qr_image_url;
    const { error } = await sb.from('sellers').update({ qr_image_url: null }).eq('id', state.me.id);
    if (error) { toast(errText(error), 'warn'); return; }
    const p = pathFromUrl(old || '', 'site-assets'); if (p) sb.storage.from('site-assets').remove([p]);
    state.me.qr_image_url = null; showQr(null);
  };

  // ------------------------------------------------------------------ SELLERS TAB (master)
  const MAX_SELLERS = Number(C.MAX_SELLERS || 5);
  const others = () => state.sellers.filter(s => s.user_id !== state.uid);
  async function renderSellers() {
    const [cars, pend] = await Promise.all([
      sb.from('products').select('seller_id').limit(10000),
      sb.from('orders').select('seller_id').eq('status', 'pending').limit(10000)
    ]);
    const tally = rows => (rows.data || []).reduce((m, r) => (m[r.seller_id] = (m[r.seller_id] || 0) + 1, m), {});
    const nCars = tally(cars), nPend = tally(pend);
    const n = others().length;
    $('sellerStats').textContent = `${n} of ${MAX_SELLERS} sellers · plus your own shop`;
    $('addSeller').disabled = n >= MAX_SELLERS;
    $('sellerList').innerHTML = state.sellers.length ? state.sellers.map(s => `
      <div class="a-seller${s.is_active ? '' : ' hidden-prod'}" data-id="${esc(s.id)}">
        <div class="a-seller-info">
          <b>${esc(s.shop_name)}${s.user_id === state.uid ? ' <span class="pill cat">You</span>' : ''}${s.is_active ? '' : ' <span class="pill bad">Paused</span>'}</b>
          <span class="small">💬 <a href="https://wa.me/91${esc(s.whatsapp)}" target="_blank" rel="noopener">${esc(s.whatsapp)}</a>
            · ${s.upi_id ? 'UPI ' + esc(s.upi_id) : '<span class="bad">No UPI yet</span>'}
            · Outside Goa ${money(s.outside_goa_shipping)}</span>
          <span class="small muted">${s.login_email ? '🔑 ' + esc(s.login_email) : '<span class="warn">No login linked</span>'}
            · ${nCars[s.id] || 0} cars · ${nPend[s.id] || 0} pending orders</span>
        </div>
        <button class="btn btn-ghost sm" data-act="edit-seller">Edit</button>
      </div>`).join('')
      : '<p class="empty">Run supabase/phase7-sellers.sql first, then add sellers here.</p>';
  }
  $('addSeller').onclick = () => openSeller(null);
  $('sellerList').addEventListener('click', e => {
    const b = e.target.closest('[data-act="edit-seller"]'); if (!b) return;
    openSeller(state.sellers.find(s => s.id === b.closest('.a-seller').dataset.id));
  });
  let editingSeller = null;
  function openSeller(s) {
    editingSeller = s;
    $('sellerDialogTitle').textContent = s ? 'Edit seller' : 'Add seller';
    $('d_shop_name').value = s ? s.shop_name : '';
    $('d_whatsapp').value = s ? s.whatsapp : '';
    $('d_email').value = s ? (s.login_email || '') : '';
    $('d_upi_id').value = s ? (s.upi_id || '') : '';
    $('d_payee_name').value = s ? (s.payee_name || '') : '';
    $('d_outside_goa_shipping').value = s ? s.outside_goa_shipping : 100;
    $('d_active').checked = s ? s.is_active : true;
    $('d_active').disabled = !!(s && s.user_id === state.uid);   // can't pause yourself
    $('sellerError').hidden = true;
    $('sellerDialog').showModal();
  }
  $('sellerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('sellerError');
    const show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    const row = {
      shop_name: $('d_shop_name').value.trim(),
      whatsapp: $('d_whatsapp').value.trim(),
      upi_id: $('d_upi_id').value.trim() || null,
      payee_name: $('d_payee_name').value.trim() || null,
      outside_goa_shipping: Number($('d_outside_goa_shipping').value || 0),
      is_active: $('d_active').checked
    };
    const email = $('d_email').value.trim().toLowerCase();
    if (!row.shop_name) return show('Enter the shop name.', 'd_shop_name');
    if (!validWa(row.whatsapp)) return show('Enter a valid 10-digit WhatsApp number.', 'd_whatsapp');
    if (row.upi_id && !validUpi(row.upi_id)) return show('UPI ID looks wrong (e.g. name@okicici).', 'd_upi_id');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return show('Check the login email.', 'd_email');
    const btn = $('saveSeller'); btn.disabled = true;
    try {
      let id = editingSeller && editingSeller.id;
      if (id) {
        const { error } = await sb.from('sellers').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('sellers').insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
        // if linking the login fails below, a retry edits this seller instead of adding it twice
        editingSeller = { id, ...row, user_id: null, login_email: null, _justAdded: true };
        $('sellerDialogTitle').textContent = 'Edit seller';
      }
      const oldEmail = editingSeller ? (editingSeller.login_email || '') : '';
      if (email && email !== oldEmail) {
        const { error } = await sb.rpc('admin_link_seller', { p_seller: id, p_email: email });
        if (error) throw error;
      } else if (!email && oldEmail && !(editingSeller.user_id === state.uid)) {
        const { error } = await sb.from('sellers').update({ user_id: null, login_email: null }).eq('id', id);
        if (error) throw error;
      }
      $('sellerDialog').close();
      toast(editingSeller && !editingSeller._justAdded ? 'Seller updated' : 'Seller added', 'ok');
      await loadSellers(); loadProducts();
    } catch (x) { show(errText(x)); loadSellers(); }
    finally { btn.disabled = false; }
  });

  $('passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('newPass').value, b = $('newPass2').value;
    if (a.length < 8) { toast('Use at least 8 characters', 'warn'); return; }
    if (a !== b) { toast('Passwords do not match', 'warn'); return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { toast(errText(error), 'warn'); return; }
    $('newPass').value = $('newPass2').value = '';
    toast('Password updated', 'ok');
  });

  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') showLogin(); });
  boot();
})();
