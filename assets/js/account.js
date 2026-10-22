// My account — orders, saved addresses, profile (Sign in with Google)
(async function () {
  const { sb, esc, money, cover, param, Auth, ready, signOut, googleButton, waLink, toast, errMsg } = window.MHC;
  const $ = id => document.getElementById(id);
  const body = $('acctBody');
  await ready;

  // ---------- not signed in ----------
  if (!Auth.user) {
    body.innerHTML = signInCard('Sign in to see your orders',
      'Use your Google account — no password to remember. Your cart and addresses are saved and follow you to any device.');
    return;
  }

  const p = Auth.profile || {};
  const STATUS = { pending: 'Payment being verified', confirmed: 'Confirmed — packing', shipped: 'Shipped',
                   delivered: 'Delivered', rejected: 'Payment not verified', cancelled: 'Cancelled' };
  let tab = ['orders', 'addresses', 'profile'].includes(param('tab')) ? param('tab') : 'orders';
  let addresses = [];

  const avatar = () => p.avatar_url
    ? `<img src="${esc(p.avatar_url)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="acct-initial">${esc(((p.full_name || Auth.user.email || '?')[0]).toUpperCase())}</span>`;

  body.innerHTML = `
    <section class="panel account-head">
      <div class="avatar">${avatar()}</div>
      <div class="grow">
        <h2>${esc(p.full_name || 'Collector')}</h2>
        <div class="muted small">${esc(Auth.user.email || '')} · signed in with Google</div>
      </div>
      <button class="btn btn-ghost" id="signOutBtn">Sign out</button>
    </section>
    ${!p.phone ? '<div class="notice" style="margin-top:14px">Add your mobile number in <b>Profile</b> — sellers use it for WhatsApp updates and delivery.</div>' : ''}
    <div class="chips acct-tabs" id="acctTabs">
      <button class="chip" data-tab="orders">Orders</button>
      <button class="chip" data-tab="addresses">Addresses</button>
      <button class="chip" data-tab="profile">Profile</button>
    </div>
    <div id="acctPane"></div>`;
  $('signOutBtn').onclick = () => signOut();
  $('acctTabs').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    tab = b.dataset.tab; show();
  });

  function show() {
    document.querySelectorAll('#acctTabs .chip').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
    try { history.replaceState(null, '', 'account.html?tab=' + tab); } catch (e) {}
    ({ orders: showOrders, addresses: showAddresses, profile: showProfile })[tab]();
  }

  // ---------- orders ----------
  async function showOrders() {
    const pane = $('acctPane');
    pane.innerHTML = '<p class="empty">Loading your orders…</p>';
    const cols = 'order_code,status,items,subtotal,shipping,total,tracking_number,created_at,phone,seller_id';
    let res = await sb.from('orders').select(cols + ',sellers(shop_name,whatsapp)').order('created_at', { ascending: false });
    if (res.error) res = await sb.from('orders').select(cols).order('created_at', { ascending: false });
    if (res.error) { pane.innerHTML = `<p class="empty">Couldn't load orders. ${esc(errMsg(res.error))}</p>`; return; }
    const orders = res.data || [];
    if (!orders.length) {
      pane.innerHTML = '<div class="panel empty">No orders yet.<br><br><a class="btn btn-primary" href="index.html">Browse cars</a></div>';
      return;
    }
    pane.innerHTML = orders.map(o => {
      const s = o.sellers || {};
      const w = String(s.whatsapp || '').replace(/\D/g, '');
      const wa = w ? (w.length === 10 ? '91' + w : w) : '';
      return `
      <article class="panel my-order">
        <div class="order-head">
          <div><b class="mono">${esc(o.order_code)}</b>${s.shop_name ? `<span class="muted small"> · ${esc(s.shop_name)}</span>` : ''}</div>
          <span class="status ${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
        </div>
        <div class="muted small">Placed ${new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        ${o.tracking_number ? `<div class="notice" style="margin-top:12px">📦 Tracking number: <b class="mono">${esc(o.tracking_number)}</b></div>` : ''}
        <div class="order-items">${(o.items || []).map(i => `
          <div class="sum-item"><img src="${esc(cover(i))}" alt="">
            <span>${esc(i.name)} <span class="muted">× ${i.qty}</span></span><b>${money(i.price * i.qty)}</b></div>`).join('')}</div>
        <div class="sum-row"><span>Shipping</span><span>${Number(o.shipping) ? money(o.shipping) : 'FREE'}</span></div>
        <div class="sum-row total"><span>Total</span><b>${money(o.total)}</b></div>
        <div class="done-actions" style="justify-content:flex-start">
          <a class="btn btn-ghost" href="track.html?order=${encodeURIComponent(o.order_code)}&phone=${encodeURIComponent(o.phone)}">Track</a>
          ${wa ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(wa, `Hi ${s.shop_name}, I have a question about my order ${o.order_code}.`))}">WhatsApp ${esc(s.shop_name)}</a>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  // ---------- addresses ----------
  async function loadAddresses() {
    const { data, error } = await sb.from('addresses').select('*')
      .order('is_default', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    addresses = data || [];
  }
  async function showAddresses(editId) {
    const pane = $('acctPane');
    try { await loadAddresses(); }
    catch (e) { pane.innerHTML = `<p class="empty">Couldn't load addresses. ${esc(errMsg(e))}</p>`; return; }
    const editing = editId === 'new' ? {} : addresses.find(a => a.id === editId);
    pane.innerHTML = `
      <section class="panel">
        ${addresses.length ? addresses.map(a => `
          <div class="addr" data-id="${esc(a.id)}">
            <div><b>${esc(a.name)}</b>${a.is_default ? ' <span class="status confirmed">Default</span>' : ''}
              <div class="muted small">${esc(a.address)}${a.city ? ', ' + esc(a.city) : ''}${a.state ? ', ' + esc(a.state) : ''} – ${esc(a.pincode)} · ${esc(a.phone)}</div></div>
            <div class="addr-actions">
              ${a.is_default ? '' : '<button class="link-btn" data-act="default">Make default</button>'}
              <button class="link-btn" data-act="edit">Edit</button>
              <button class="link-btn danger" data-act="delete">Delete</button>
            </div>
          </div>`).join('') : '<p class="muted">No saved addresses yet. Addresses you use at checkout are saved here.</p>'}
        ${editing ? '' : '<button class="btn btn-ghost" id="addAddr" style="margin-top:14px">+ Add address</button>'}
      </section>
      ${editing ? addressForm(editing) : ''}`;
    if (!editing) $('addAddr').onclick = () => showAddresses('new');
    else bindAddressForm(editing);
  }
  function addressForm(a) {
    return `
      <form class="panel" id="addrForm" novalidate>
        <h2 class="panel-title">${a.id ? 'Edit address' : 'New address'}</h2>
        <div class="two">
          <div class="field"><label for="f_name">Full name *</label><input class="input" id="f_name" value="${esc(a.name || p.full_name || '')}"></div>
          <div class="field"><label for="f_phone">Mobile *</label><input class="input" id="f_phone" inputmode="numeric" maxlength="10" value="${esc(a.phone || p.phone || '')}"></div>
        </div>
        <div class="field"><label for="f_address">Address *</label><textarea class="input" id="f_address" rows="3">${esc(a.address || '')}</textarea></div>
        <div class="three">
          <div class="field"><label for="f_pincode">Pincode *</label><input class="input" id="f_pincode" inputmode="numeric" maxlength="6" value="${esc(a.pincode || '')}"></div>
          <div class="field"><label for="f_city">City / Town</label><input class="input" id="f_city" value="${esc(a.city || '')}"></div>
          <div class="field"><label for="f_state">State</label><input class="input" id="f_state" value="${esc(a.state || '')}"></div>
        </div>
        <p class="form-error" id="addrError" hidden></p>
        <div class="dialog-actions"><span class="grow"></span>
          <button type="button" class="btn btn-ghost" id="addrCancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save address</button></div>
      </form>`;
  }
  function bindAddressForm(a) {
    $('addrCancel').onclick = () => showAddresses();
    $('f_phone').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    $('f_pincode').addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '');
      if (e.target.value.startsWith('403') && !$('f_state').value) $('f_state').value = 'Goa';
    });
    $('addrForm').addEventListener('submit', async e => {
      e.preventDefault();
      const row = { name: $('f_name').value.trim(), phone: $('f_phone').value.trim(), address: $('f_address').value.trim(),
                    pincode: $('f_pincode').value.trim(), city: $('f_city').value.trim() || null, state: $('f_state').value.trim() || null };
      const err = m => { $('addrError').textContent = m; $('addrError').hidden = false; };
      if (!row.name) return err('Enter the name.');
      if (!/^[6-9]\d{9}$/.test(row.phone)) return err('Enter a valid 10-digit mobile number.');
      if (row.address.length < 8) return err('Enter the full address.');
      if (!/^[1-9]\d{5}$/.test(row.pincode)) return err('Enter a valid 6-digit pincode.');
      if (!a.id && !addresses.length) row.is_default = true;
      const { error } = a.id ? await sb.from('addresses').update(row).eq('id', a.id) : await sb.from('addresses').insert(row);
      if (error) return err(errMsg(error));
      toast('Address saved', 'ok');
      showAddresses();
    });
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('.addr [data-act]'); if (!b) return;
    const id = b.closest('.addr').dataset.id, act = b.dataset.act;
    if (act === 'edit') return showAddresses(id);
    if (act === 'delete') {
      if (!confirm('Delete this address?')) return;
      const { error } = await sb.from('addresses').delete().eq('id', id);
      if (error) return toast(errMsg(error), 'warn');
    }
    if (act === 'default') {
      await sb.from('addresses').update({ is_default: false }).neq('id', id);
      const { error } = await sb.from('addresses').update({ is_default: true }).eq('id', id);
      if (error) return toast(errMsg(error), 'warn');
    }
    showAddresses();
  });

  // ---------- profile ----------
  function showProfile() {
    $('acctPane').innerHTML = `
      <form class="panel" id="profileForm" novalidate>
        <h2 class="panel-title">Profile</h2>
        <div class="two">
          <div class="field"><label for="pf_name">Name</label><input class="input" id="pf_name" value="${esc(p.full_name || '')}"></div>
          <div class="field"><label for="pf_phone">Mobile / WhatsApp number *</label>
            <input class="input" id="pf_phone" inputmode="numeric" maxlength="10" value="${esc(p.phone || '')}" placeholder="10-digit number"></div>
        </div>
        <div class="field"><label>Email (from Google)</label><input class="input" value="${esc(Auth.user.email || '')}" readonly></div>
        <p class="form-error" id="pfError" hidden></p>
        <button class="btn btn-primary" type="submit">Save profile</button>
      </form>
      <section class="panel danger-zone">
        <h2 class="panel-title">Delete account</h2>
        <p class="muted small">Removes your profile, saved addresses and cart. Past orders stay with the seller for their records, without your account.</p>
        <button class="link-btn danger" id="deleteAcct">Delete my account</button>
      </section>`;
    $('pf_phone').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    $('profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const row = { full_name: $('pf_name').value.trim() || null, phone: $('pf_phone').value.trim() || null,
                    updated_at: new Date().toISOString() };
      if (row.phone && !/^[6-9]\d{9}$/.test(row.phone)) {
        $('pfError').textContent = 'Enter a valid 10-digit mobile number.'; $('pfError').hidden = false; return;
      }
      const { error } = await sb.from('profiles').update(row).eq('user_id', Auth.user.id);
      if (error) { $('pfError').textContent = errMsg(error); $('pfError').hidden = false; return; }
      Object.assign(p, row);
      toast('Profile saved', 'ok');
    });
    $('deleteAcct').onclick = async () => {
      if (!confirm('Delete your MHC Diecast account? This can\'t be undone.')) return;
      const { error } = await sb.rpc('delete_my_account');
      if (error) return toast(errMsg(error), 'warn');
      toast('Account deleted', 'ok');
      setTimeout(signOut, 600);
    };
  }

  function signInCard(title, text) {
    return `<section class="panel signin-card">
      <img class="signin-ico" data-logo src="${esc(window.MHC_LOGO || 'assets/img/logo-192.png')}" alt="">
      <h2>${esc(title)}</h2><p>${esc(text)}</p>${googleButton()}
      <p class="fine muted">By continuing you agree to our <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy Policy</a>.</p>
    </section>`;
  }
  show();
})();
