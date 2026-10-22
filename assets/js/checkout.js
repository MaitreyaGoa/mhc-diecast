// Checkout: delivery details → pay each seller by UPI + upload screenshot → order(s) placed.
// Cars from different sellers are paid separately (one UPI payment and one order per seller).
(async function () {
  const { sb, esc, money, cover, Cart, store, getSettings, getSellers, sellerFor, isGoa,
          waLink, toast, errMsg } = window.MHC;
  const $ = id => document.getElementById(id);
  const DETAILS_KEY = 'mhc_buyer_v1';
  const ORDERS_KEY = 'mhc_orders_v1';

  if (!Cart.items().length) { location.replace('cart.html'); return; }

  let settings = null, sellers = [], customer = null;
  let groups = [];          // [{ k, seller, items, subtotal, shipping, total, file, utr, placed: {code,total} }]

  // ---------- load latest stock + settings + sellers ----------
  try {
    const notes = await Cart.sync();
    if (!Cart.items().length) { location.replace('cart.html'); return; }
    notes.forEach(n => toast(n, 'warn'));
    [settings, sellers] = await Promise.all([getSettings(), getSellers()]);
  } catch (e) {
    $('detailsError').textContent = "Couldn't connect to the store. " + errMsg(e);
    $('detailsError').hidden = false;
    $('toPay').disabled = true;
    return;
  }

  // ---------- group the cart by seller ----------
  function buildGroups() {
    const pin = $('pincode').value.trim();
    const pinOk = /^[1-9]\d{5}$/.test(pin);
    const out = [];
    Cart.items().forEach(i => {
      const k = i.seller_id || 'store';
      let g = out.find(x => x.k === k);
      if (!g) out.push(g = { k, seller: sellerFor(i.seller_id, sellers, settings), items: [] });
      g.items.push(i);
    });
    out.forEach(g => {
      const old = groups.find(x => x.k === g.k) || {};
      g.subtotal = g.items.reduce((t, i) => t + i.price * i.qty, 0);
      g.shipping = !pinOk ? null : isGoa(pin) ? 0 : Number(g.seller.outside_goa_shipping || 0);
      g.total = g.subtotal + (g.shipping || 0);
      g.file = old.file || null; g.utr = old.utr || ''; g.placed = old.placed || null;
    });
    groups = out;
    return groups;
  }

  // ---------- summary ----------
  function renderSummary() {
    const gs = buildGroups();
    const pinOk = gs[0] && gs[0].shipping !== null;
    const multi = gs.length > 1;
    $('sumItems').innerHTML = gs.map(g => `
      ${multi ? `<div class="sum-seller">${esc(g.seller.shop_name)}</div>` : ''}
      ${g.items.map(i => `
        <div class="sum-item"><img src="${esc(cover(i))}" alt="">
          <span>${esc(i.name)} <span class="muted">× ${i.qty}</span></span><b>${money(i.price * i.qty)}</b></div>`).join('')}
      ${multi && pinOk ? `<div class="sum-row small muted"><span>Shipping from ${esc(g.seller.shop_name)}</span><span>${g.shipping ? money(g.shipping) : 'FREE'}</span></div>` : ''}`).join('');
    const sub = gs.reduce((t, g) => t + g.subtotal, 0);
    const ship = gs.reduce((t, g) => t + (g.shipping || 0), 0);
    $('sumSubtotal').textContent = money(sub);
    $('sumShipping').innerHTML = !pinOk ? '<span class="muted">Enter pincode</span>'
      : ship === 0 ? '<b class="ok">FREE (Goa)</b>' : money(ship);
    $('sumTotal').textContent = money(sub + ship);
    const hint = $('shipHint');
    if (pinOk) {
      hint.hidden = false;
      hint.className = 'ship-hint ' + (ship === 0 ? 'goa' : '');
      hint.textContent = ship === 0 ? '🏝️ Goa address — free shipping!'
        : `🚚 Outside Goa — shipping ${money(ship)} added${multi ? ' (each seller ships separately)' : ''}.`;
    } else hint.hidden = true;
  }

  // ---------- step 1: details ----------
  const saved = store.get(DETAILS_KEY, {});
  ['name', 'phone', 'email', 'address', 'pincode', 'city', 'state'].forEach(k => { if (saved[k]) $(k).value = saved[k]; });
  $('pincode').addEventListener('input', () => {
    $('pincode').value = $('pincode').value.replace(/\D/g, '');
    if (isGoa($('pincode').value) && !$('state').value) $('state').value = 'Goa';
    renderSummary();
  });
  $('phone').addEventListener('input', () => { $('phone').value = $('phone').value.replace(/\D/g, ''); });
  renderSummary();

  function showError(id, msg, field) {
    $(id).textContent = msg; $(id).hidden = !msg;
    if (field) $(field).focus();
  }

  $('detailsForm').addEventListener('submit', e => {
    e.preventDefault();
    const c = {};
    ['name', 'phone', 'email', 'address', 'pincode', 'city', 'state'].forEach(k => { c[k] = $(k).value.trim(); });
    if (!c.name) return showError('detailsError', 'Please enter your name.', 'name');
    if (!/^[6-9]\d{9}$/.test(c.phone)) return showError('detailsError', 'Please enter a valid 10-digit mobile number.', 'phone');
    if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return showError('detailsError', 'Please check your email address.', 'email');
    if (c.address.length < 8) return showError('detailsError', 'Please enter your full address.', 'address');
    if (!/^[1-9]\d{5}$/.test(c.pincode)) return showError('detailsError', 'Please enter a valid 6-digit pincode.', 'pincode');
    const noPay = buildGroups().find(g => !g.seller.upi_id && !g.seller.qr_image_url);
    if (noPay) return showError('detailsError', `${noPay.seller.shop_name} hasn't set up UPI payment yet. Please remove their cars or contact them on WhatsApp.`);
    showError('detailsError', '');
    customer = c;
    store.set(DETAILS_KEY, c);
    renderSummary();
    showPayment();
  });

  // ---------- step 2: payment (one card per seller) ----------
  function setStep(n) {
    [...$('steps').children].forEach((li, i) => {
      li.classList.toggle('active', i === n); li.classList.toggle('done', i < n);
    });
    $('detailsForm').hidden = n !== 0;
    $('payBox').hidden = n !== 1;
    $('doneBox').hidden = n !== 2;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const upiLink = (s, amount) => `upi://pay?pa=${encodeURIComponent(s.upi_id)}` +
    `&pn=${encodeURIComponent(s.payee_name || s.shop_name || 'MHC Diecast')}` +
    `&am=${Number(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent('MHC Diecast order')}`;

  function showPayment() {
    const multi = groups.length > 1;
    $('payIntro').innerHTML = multi
      ? `<div class="notice">Your cars come from <b>${groups.length} sellers</b>. Pay each one separately below and upload a screenshot for each — you'll get one order code per seller.</div>`
      : '';
    $('placeBtn').textContent = multi ? `Submit ${groups.length} payments & place orders` : 'Submit payment & place order';
    $('payGroups').innerHTML = groups.map((g, n) => `
      <section class="panel pay-card${g.placed ? ' is-placed' : ''}" data-k="${esc(g.k)}">
        <div class="pay-head">
          <h2 class="panel-title">${multi ? `Payment ${n + 1} of ${groups.length} · ` : ''}Pay <span class="amount">${money(g.total)}</span> to ${esc(g.seller.shop_name)}</h2>
          ${g.placed ? `<span class="status confirmed">Order ${esc(g.placed.code)} placed</span>` : ''}
        </div>
        ${multi ? `<div class="pay-items muted small">${g.items.map(i => `${esc(i.name)} × ${i.qty}`).join(' · ')}${g.shipping ? ` · shipping ${money(g.shipping)}` : ''}</div>` : ''}
        <div class="pay-grid">
          <div class="qr-wrap">
            <div class="qr" data-qr="${n}"></div>
            ${g.seller.upi_id ? `<a class="btn btn-dark btn-block upi-app" href="${esc(upiLink(g.seller, g.total))}">Open UPI app to pay</a>` : ''}
          </div>
          <div class="pay-info">
            <ol class="pay-steps">
              <li>Scan the QR with GPay, PhonePe, Paytm or any UPI app.</li>
              <li>Pay exactly <b>${money(g.total)}</b> to <b>${esc(g.seller.payee_name || g.seller.shop_name)}</b>.</li>
              <li>Upload the screenshot of the success screen below.</li>
            </ol>
            ${g.seller.upi_id ? `<div class="upi-id">UPI ID: <b>${esc(g.seller.upi_id)}</b> <button type="button" class="link-btn" data-copy="${esc(g.seller.upi_id)}">Copy</button></div>` : ''}
            ${g.seller.whatsapp ? `<a class="link-btn" href="${esc(waLink(g.seller.whatsapp, `Hi ${g.seller.shop_name}, I have a question about paying for my order on MHC Diecast.`))}" target="_blank" rel="noopener">Questions? WhatsApp ${esc(g.seller.shop_name)}</a>` : ''}
          </div>
        </div>
        ${g.placed ? '' : `
        <div class="field">
          <label>Payment screenshot${multi ? ` for ${esc(g.seller.shop_name)}` : ''} *</label>
          <label class="upload${g.file ? ' has-file' : ''}">
            <input type="file" accept="image/*" data-shot="${n}">
            <span class="upload-text"${g.file ? ' hidden' : ''}>📷 Tap to choose screenshot</span>
            <img class="shot-preview" alt="Screenshot preview"${g.file ? ` src="${URL.createObjectURL(g.file)}"` : ' hidden'}>
          </label>
        </div>
        <div class="field"><label>UPI reference / UTR number (optional)</label>
          <input class="input" inputmode="numeric" maxlength="22" placeholder="12-digit number shown after payment" data-utr="${n}" value="${esc(g.utr)}"></div>
        <p class="form-error group-error" hidden></p>`}
      </section>`).join('');

    groups.forEach((g, n) => {
      const box = $('payGroups').querySelector(`[data-qr="${n}"]`);
      if (g.seller.upi_id && window.QRCode) {
        new QRCode(box, { text: upiLink(g.seller, g.total), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
      } else if (g.seller.qr_image_url) {
        box.innerHTML = `<img src="${esc(g.seller.qr_image_url)}" alt="UPI QR code">`;
      } else {
        box.innerHTML = '<p class="muted small">QR could not load.<br>Pay using the UPI ID shown here.</p>';
      }
    });
    setStep(1);
  }

  $('payGroups').addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]'); if (!c) return;
    try { await navigator.clipboard.writeText(c.dataset.copy); toast('UPI ID copied', 'ok'); }
    catch (_) { toast(c.dataset.copy); }
  });
  $('payGroups').addEventListener('change', e => {
    const inp = e.target.closest('[data-shot]');
    if (!inp) return;
    const g = groups[+inp.dataset.shot], f = inp.files[0];
    const label = inp.closest('.upload');
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Please choose an image file.', 'warn'); inp.value = ''; return; }
    g.file = f;
    const prev = label.querySelector('.shot-preview');
    prev.src = URL.createObjectURL(f); prev.hidden = false;
    label.querySelector('.upload-text').hidden = true;
    label.classList.add('has-file');
    showError('payError', '');
  });
  $('payGroups').addEventListener('input', e => {
    const u = e.target.closest('[data-utr]'); if (u) groups[+u.dataset.utr].utr = u.value.trim();
  });
  $('backToDetails').onclick = () => setStep(0);

  // Shrink large phone screenshots before upload (keeps them readable, ~200–400 KB)
  async function compress(file, max = 1600, quality = 0.82) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      return blob || file;
    } catch (e) { return file; }
  }

  async function placeGroup(g) {
    const blob = await compress(g.file);
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const d = new Date();
    const path = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/` +
                 `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const up = await sb.storage.from('payment-screenshots').upload(path, blob, { contentType: type, upsert: false });
    if (up.error) throw up.error;
    const args = {
      p_customer: customer,
      p_items: g.items.map(i => ({ id: i.id, qty: i.qty })),
      p_screenshot_path: path,
      p_utr: g.utr || null
    };
    if (g.seller.id) args.p_seller_id = g.seller.id;   // multi-seller database
    const { data, error } = await sb.rpc('place_order', args);
    if (error) { error.uploaded = true; throw error; }
    const res = Array.isArray(data) ? data[0] : data;
    return { code: res.out_code, total: Number(res.out_total) };
  }

  // ---------- place order(s) ----------
  $('payForm').addEventListener('submit', async e => {
    e.preventDefault();
    const todo = groups.filter(g => !g.placed);
    const missing = todo.find(g => !g.file);
    if (missing) return showError('payError', groups.length > 1
      ? `Please upload the payment screenshot for ${missing.seller.shop_name}.` : 'Please upload the payment screenshot.');
    const badUtr = todo.find(g => g.utr && !/^[A-Za-z0-9]{6,22}$/.test(g.utr));
    if (badUtr) return showError('payError', 'UTR should be letters/numbers only.');
    showError('payError', '');

    const btn = $('placeBtn');
    btn.disabled = true;
    for (const g of todo) {
      const card = $('payGroups').querySelector(`[data-k="${CSS.escape(g.k)}"]`);
      const gErr = card && card.querySelector('.group-error');
      if (gErr) gErr.hidden = true;
      btn.textContent = groups.length > 1 ? `Placing order for ${g.seller.shop_name}…` : 'Placing order…';
      try {
        g.placed = await placeGroup(g);
        // remove these cars from the cart and remember the order on this phone
        const left = Cart.items().filter(i => !g.items.some(x => x.id === i.id));
        Cart.save(left);
        const mine = store.get(ORDERS_KEY, []);
        mine.unshift({ code: g.placed.code, phone: customer.phone, total: g.placed.total, seller: g.seller.shop_name, at: new Date().toISOString() });
        store.set(ORDERS_KEY, mine.slice(0, 30));
        if (Math.abs(g.placed.total - g.total) > 0.009) toast(`Note: final total for ${g.seller.shop_name} is ${money(g.placed.total)} (prices updated).`, 'warn');
      } catch (err) {
        let msg = errMsg(err);
        if (err && err.uploaded) msg += ' If you already paid, message the seller on WhatsApp with your screenshot — they will sort it out or refund you.';
        if (gErr) {
          gErr.innerHTML = esc(msg) + (g.seller.whatsapp ? ` <a href="${esc(waLink(g.seller.whatsapp,
            `Hi ${g.seller.shop_name}, I paid ${money(g.total)} on MHC Diecast but the order didn't go through. Name: ${customer.name}`))}" target="_blank" rel="noopener">WhatsApp ${esc(g.seller.shop_name)}</a>` : '');
          gErr.hidden = false;
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else showError('payError', msg);
        btn.disabled = false;
        btn.textContent = 'Try again';
        showPaymentPlacedState();
        return;
      }
    }
    onAllPlaced();
  });

  // keep successful payments marked while a later one is retried
  function showPaymentPlacedState() {
    groups.forEach(g => {
      if (!g.placed) return;
      const card = $('payGroups').querySelector(`[data-k="${CSS.escape(g.k)}"]`);
      if (!card || card.classList.contains('is-placed')) return;
      card.classList.add('is-placed');
      card.querySelectorAll('.field, .group-error').forEach(el => el.remove());
      card.querySelector('.pay-head').insertAdjacentHTML('beforeend', `<span class="status confirmed">Order ${esc(g.placed.code)} placed</span>`);
    });
  }

  function onAllPlaced() {
    const placed = groups.filter(g => g.placed);
    const multi = placed.length > 1;
    $('doneTitle').textContent = multi ? `${placed.length} orders placed!` : 'Order placed!';
    $('doneLead').textContent = multi ? 'One order per seller. Your order codes:' : 'Your order code is';
    $('doneCodes').innerHTML = placed.map(g => `
      <div class="done-order">
        <div class="order-code">${esc(g.placed.code)}</div>
        <div class="done-seller">${esc(g.seller.shop_name)} · ${money(g.placed.total)}</div>
        ${g.seller.whatsapp ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(g.seller.whatsapp,
          `Hi ${g.seller.shop_name}! I placed order ${g.placed.code} for ${money(g.placed.total)} on MHC Diecast and uploaded the payment screenshot.`))}">WhatsApp ${esc(g.seller.shop_name)}</a>` : ''}
      </div>`).join('');
    const first = placed[0];
    $('trackLink').href = multi ? 'track.html'
      : `track.html?code=${encodeURIComponent(first.placed.code)}&phone=${encodeURIComponent(customer.phone)}`;
    $('summary').hidden = true;
    setStep(2);
  }
})();
