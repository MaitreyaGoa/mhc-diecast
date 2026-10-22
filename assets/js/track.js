// Order tracking — buyer enters order code + mobile number.
(async function () {
  await window.MHC.ready;
  const { sb, esc, money, cover, param, store, getSettings, waLink, errMsg, Auth, googleButton } = window.MHC;
  const $ = id => document.getElementById(id);
  const STEPS = ['pending', 'confirmed', 'shipped', 'delivered'];
  const LABEL = { pending: 'Payment being verified', confirmed: 'Confirmed — packing',
                  shipped: 'Shipped', delivered: 'Delivered' };

  $('phone').addEventListener('input', () => { $('phone').value = $('phone').value.replace(/\D/g, ''); });

  async function lookup(code, phone) {
    const err = $('trackError'); err.hidden = true;
    if (!/^MHC-[A-Z0-9]{6}$/i.test(code)) { err.textContent = 'Order code looks like MHC-7F3A2C.'; err.hidden = false; return; }
    if (!/^\d{10}$/.test(phone)) { err.textContent = 'Enter the 10-digit mobile number used for the order.'; err.hidden = false; return; }
    const btn = $('trackBtn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const { data, error } = await sb.rpc('get_order_status', { p_code: code, p_phone: phone });
      if (error) throw error;
      const o = data && data[0];
      if (!o) { $('result').innerHTML = '<div class="notice bad">No order found with that code and mobile number.</div>'; return; }
      render(o);
    } catch (e) {
      $('result').innerHTML = `<div class="notice bad">${esc(errMsg(e))}</div>`;
    } finally { btn.disabled = false; btn.textContent = 'Check status'; }
  }

  async function render(o) {
    const failed = o.status === 'rejected' || o.status === 'cancelled';
    const at = STEPS.indexOf(o.status);
    const timeline = failed ? '' : `<ol class="timeline">${STEPS.map((s, i) =>
      `<li class="${i < at ? 'done' : i === at ? 'current' : ''}">${LABEL[s]}</li>`).join('')}</ol>`;
    let help = '';
    try {
      const s = await getSettings();
      const w = String(o.seller_whatsapp || '').replace(/\D/g, '');
      const num = w ? (w.length === 10 ? '91' + w : w) : s.whatsapp_number;
      const who = o.seller_name || 'us';
      if (num) help = `<a class="btn btn-ghost btn-block" target="_blank" rel="noopener"
        href="${esc(waLink(num, `Hi ${o.seller_name || ''}, I have a question about my order ${o.order_code}.`))}">Questions? WhatsApp ${esc(who)}</a>`;
    } catch (e) { /* ignore */ }

    $('result').innerHTML = `
      <div class="panel order-card">
        <div class="order-head">
          <div><div class="muted small">Order</div><b class="mono">${esc(o.order_code)}</b></div>
          <span class="status ${esc(o.status)}">${esc(o.status)}</span>
        </div>
        ${o.seller_name ? `<div class="small">Sold by <b>${esc(o.seller_name)}</b></div>` : ''}
        <div class="muted small">Placed ${new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        ${failed ? `<div class="notice bad">This order was ${esc(o.status)}. If you paid, please contact us — we'll help right away.</div>` : timeline}
        ${o.tracking_number ? `<div class="notice">📦 Tracking number: <b class="mono">${esc(o.tracking_number)}</b></div>` : ''}
        <div class="order-items">${(o.items || []).map(i => `
          <div class="sum-item"><img src="${esc(cover(i))}" alt="">
            <span>${esc(i.name)} <span class="muted">× ${i.qty}</span></span><b>${money(i.price * i.qty)}</b></div>`).join('')}</div>
        <div class="sum-row"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
        <div class="sum-row"><span>Shipping</span><span>${Number(o.shipping) ? money(o.shipping) : 'FREE'}</span></div>
        <div class="sum-row total"><span>Total</span><b>${money(o.total)}</b></div>
        ${help}
      </div>`;
  }

  $('trackForm').addEventListener('submit', e => {
    e.preventDefault();
    lookup($('code').value.trim().toUpperCase(), $('phone').value.trim());
  });

  // Signed in: all orders live in My account. Signed out: orders placed from this browser.
  const mine = Auth.user ? [] : store.get('mhc_orders_v1', []);
  if (Auth.user) {
    $('recent').innerHTML = `<div class="panel signed-cta"><div><b>All your orders are in My account</b>
      <div class="muted small">Status, tracking numbers and seller contacts — on any device.</div></div>
      <a class="btn btn-primary" href="account.html?tab=orders">My orders</a></div>`;
  } else {
    $('recent').innerHTML = `<div class="panel signed-cta"><div><b>Placed an order?</b>
      <div class="muted small">Sign in with the same Google account to see all your orders.</div></div>${googleButton('Sign in')}</div>`;
  }
  if (mine.length) {
    $('recent').insertAdjacentHTML('beforeend', '<div id="recentList"></div>');
    $('recentList').innerHTML = `<h2 class="panel-title" style="margin-top:22px">Recent orders on this device</h2><div class="recent-list">${mine.map(m =>
      `<button class="recent" data-code="${esc(m.code)}" data-phone="${esc(m.phone)}">
         <b class="mono">${esc(m.code)}${m.seller ? `<span class="muted small"> · ${esc(m.seller)}</span>` : ''}</b><span>${money(m.total)}</span>
         <span class="muted small">${new Date(m.at).toLocaleDateString('en-IN')}</span></button>`).join('')}</div>`;
    $('recent').addEventListener('click', e => {
      const b = e.target.closest('.recent'); if (!b) return;
      $('code').value = b.dataset.code; $('phone').value = b.dataset.phone;
      lookup(b.dataset.code, b.dataset.phone);
    });
  }

  // ?order=MHC-XXXXXX (older links used ?code=)
  const code = param('order') || (/^MHC-/i.test(param('code') || '') ? param('code') : null), phone = param('phone');
  if (code) $('code').value = code;
  if (phone) $('phone').value = phone;
  if (code && phone) lookup(code.toUpperCase(), phone);
})();
