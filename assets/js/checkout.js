// Checkout: delivery details → UPI QR + screenshot upload → order placed.
(async function () {
  const { sb, esc, money, cover, Cart, store, getSettings, shippingFor, isGoa,
          waLink, toast, errMsg } = window.MHC;
  const $ = id => document.getElementById(id);
  const DETAILS_KEY = 'mhc_buyer_v1';
  const ORDERS_KEY = 'mhc_orders_v1';

  if (!Cart.items().length) { location.replace('cart.html'); return; }

  let settings = null;
  let customer = null;
  let amount = 0;

  // ---------- load latest stock + settings ----------
  try {
    const notes = await Cart.sync();
    if (!Cart.items().length) { location.replace('cart.html'); return; }
    notes.forEach(n => toast(n, 'warn'));
    settings = await getSettings();
  } catch (e) {
    $('detailsError').textContent = "Couldn't connect to the store. " + errMsg(e);
    $('detailsError').hidden = false;
    $('toPay').disabled = true;
    return;
  }

  // ---------- summary ----------
  function renderSummary() {
    const items = Cart.items();
    const pin = $('pincode').value.trim();
    const sub = Cart.subtotal();
    const pinOk = /^[1-9]\d{5}$/.test(pin);
    const ship = pinOk ? shippingFor(pin, settings) : null;
    $('sumItems').innerHTML = items.map(i => `
      <div class="sum-item"><img src="${esc(cover(i))}" alt="">
        <span>${esc(i.name)} <span class="muted">× ${i.qty}</span></span><b>${money(i.price * i.qty)}</b></div>`).join('');
    $('sumSubtotal').textContent = money(sub);
    $('sumShipping').innerHTML = ship === null ? '<span class="muted">Enter pincode</span>'
      : ship === 0 ? '<b class="ok">FREE (Goa)</b>' : money(ship);
    $('sumTotal').textContent = money(sub + (ship || 0));
    const hint = $('shipHint');
    if (pinOk) {
      hint.hidden = false;
      hint.className = 'ship-hint ' + (ship === 0 ? 'goa' : '');
      hint.textContent = ship === 0 ? '🏝️ Goa address — free shipping!'
        : `🚚 Outside Goa — shipping ${money(ship)} added.`;
    } else hint.hidden = true;
    return sub + (ship || 0);
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
    showError('detailsError', '');
    customer = c;
    store.set(DETAILS_KEY, c);
    amount = renderSummary();
    showPayment();
  });

  // ---------- step 2: payment ----------
  function setStep(n) {
    [...$('steps').children].forEach((li, i) => {
      li.classList.toggle('active', i === n); li.classList.toggle('done', i < n);
    });
    $('detailsForm').hidden = n !== 0;
    $('payBox').hidden = n !== 1;
    $('doneBox').hidden = n !== 2;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showPayment() {
    if (!settings.upi_id && !settings.qr_image_url) {
      showError('detailsError', 'Online payment is not set up yet. Please contact the store on WhatsApp.');
      return;
    }
    const amt = Number(amount).toFixed(2);
    $('payAmount').textContent = money(amount);
    $('payAmount2').textContent = money(amount);
    $('upiId').textContent = settings.upi_id || '—';
    $('copyUpi').hidden = !settings.upi_id;
    $('payee').textContent = settings.payee_name ? `Paying to: ${settings.payee_name}` : '';

    const qr = $('qr');
    qr.innerHTML = '';
    if (settings.upi_id) {
      const upi = `upi://pay?pa=${encodeURIComponent(settings.upi_id)}` +
                  `&pn=${encodeURIComponent(settings.payee_name || settings.store_name || 'MHC Diecast')}` +
                  `&am=${amt}&cu=INR&tn=${encodeURIComponent('MHC Diecast order')}`;
      $('upiApp').href = upi;
      $('upiApp').hidden = false;
      if (window.QRCode) new QRCode(qr, { text: upi, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
      else if (settings.qr_image_url) qr.innerHTML = `<img src="${esc(settings.qr_image_url)}" alt="UPI QR code">`;
      else qr.innerHTML = '<p class="muted small">QR could not load.<br>Pay using the UPI ID shown here.</p>';
    } else {
      qr.innerHTML = `<img src="${esc(settings.qr_image_url)}" alt="UPI QR code">`;
      $('upiApp').hidden = true;
    }
    setStep(1);
  }

  $('copyUpi').onclick = async () => {
    try { await navigator.clipboard.writeText(settings.upi_id); toast('UPI ID copied', 'ok'); }
    catch (e) { toast(settings.upi_id); }
  };
  $('backToDetails').onclick = () => setStep(0);

  // Screenshot preview
  $('shot').addEventListener('change', () => {
    const f = $('shot').files[0];
    const prev = $('shotPreview');
    if (!f) { prev.hidden = true; $('uploadText').hidden = false; return; }
    if (!f.type.startsWith('image/')) { showError('payError', 'Please choose an image file.'); $('shot').value = ''; return; }
    prev.src = URL.createObjectURL(f); prev.hidden = false;
    $('uploadText').hidden = true;
    $('uploadBox').classList.add('has-file');
    showError('payError', '');
  });

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

  // ---------- place order ----------
  $('payForm').addEventListener('submit', async e => {
    e.preventDefault();
    const file = $('shot').files[0];
    if (!file) return showError('payError', 'Please upload the payment screenshot.');
    const utr = $('utr').value.trim();
    if (utr && !/^[A-Za-z0-9]{6,22}$/.test(utr)) return showError('payError', 'UTR should be letters/numbers only.', 'utr');
    showError('payError', '');

    const btn = $('placeBtn');
    btn.disabled = true; btn.textContent = 'Uploading screenshot…';
    let path = null;
    try {
      const blob = await compress(file);
      const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const d = new Date();
      path = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/` +
             `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const up = await sb.storage.from('payment-screenshots').upload(path, blob, { contentType: type, upsert: false });
      if (up.error) throw up.error;

      btn.textContent = 'Placing order…';
      const { data, error } = await sb.rpc('place_order', {
        p_customer: customer,
        p_items: Cart.items().map(i => ({ id: i.id, qty: i.qty })),
        p_screenshot_path: path,
        p_utr: utr || null
      });
      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      onPlaced(res.out_code, Number(res.out_total));
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Submit payment & place order';
      let msg = errMsg(err);
      if (path) {   // screenshot uploaded but order failed (e.g. someone bought the last piece)
        msg += ' If you have already paid, please message us on WhatsApp with your screenshot and we will sort it out or refund you.';
      }
      showError('payError', msg);
      if (settings.whatsapp_number) {
        $('payError').innerHTML += ` <a href="${esc(waLink(settings.whatsapp_number,
          `Hi, I paid ${money(amount)} on MHC Diecast but the order didn't go through. Name: ${customer.name}`))}" target="_blank" rel="noopener">WhatsApp us</a>`;
      }
    }
  });

  function onPlaced(code, total) {
    Cart.clear();
    const mine = store.get(ORDERS_KEY, []);
    mine.unshift({ code, phone: customer.phone, total, at: new Date().toISOString() });
    store.set(ORDERS_KEY, mine.slice(0, 20));

    $('orderCode').textContent = code;
    $('trackLink').href = `track.html?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(customer.phone)}`;
    if (settings.whatsapp_number) {
      const wa = $('waLink');
      wa.href = waLink(settings.whatsapp_number,
        `Hi! I placed order ${code} for ${money(total)} on MHC Diecast and uploaded the payment screenshot.`);
      wa.hidden = false;
    }
    if (Math.abs(total - amount) > 0.009) {
      toast(`Note: final total is ${money(total)} (prices updated).`, 'warn');
    }
    $('summary').hidden = true;
    setStep(2);
  }
})();
