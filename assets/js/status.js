// System check page — verifies Phase 1 setup without changing any data.
(async function () {
  const { C, sb, esc } = window.MHC;
  const list = document.getElementById('checks');

  function row(label) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ico">⏳</span><div><strong>${esc(label)}</strong><div class="detail"></div></div>`;
    list.appendChild(li);
    return (state, detail) => {
      li.querySelector('.ico').textContent = { ok: '✅', warn: '⚠️', bad: '❌' }[state];
      li.querySelector('.detail').textContent = detail || '';
    };
  }

  async function check(label, fn) {
    const set = row(label);
    try { const [state, detail] = await fn(); set(state, detail); return state !== 'bad'; }
    catch (e) { set('bad', (e && e.message) || String(e)); return false; }
  }

  const cfgOk = await check('Config file filled in', async () =>
    C.SUPABASE_URL && !C.SUPABASE_URL.includes('YOUR-PROJECT') && C.SUPABASE_ANON_KEY && !C.SUPABASE_ANON_KEY.startsWith('YOUR')
      ? ['ok', C.SUPABASE_URL] : ['bad', 'Edit assets/js/config.js with your Project URL and publishable key.']);

  const libOk = await check('Supabase library loaded', async () =>
    sb ? ['ok', ''] : ['bad', 'Could not load supabase-js from the CDN. Check your internet / ad-blocker.']);

  if (!cfgOk || !libOk) return;

  await check('Settings table readable', async () => {
    const { data, error } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data) return ['bad', 'No settings row. Re-run schema.sql.'];
    const missing = ['upi_id', 'payee_name', 'whatsapp_number'].filter(k => !data[k]);
    return missing.length
      ? ['warn', `Connected. Still empty: ${missing.join(', ')} (fill in Table Editor → settings).`]
      : ['ok', `UPI: ${data.upi_id} · Outside-Goa shipping: ₹${data.outside_goa_shipping}`];
  });

  await check('Products table readable', async () => {
    const { count, error } = await sb.from('products').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ? ['ok', `${count} active car(s) visible to customers.`]
                 : ['warn', 'Connected, but no cars yet. Run supabase/sample-products.sql to add test cars.'];
  });

  await check('Orders are private (customers cannot read them)', async () => {
    const { data, error } = await sb.from('orders').select('id').limit(1);
    if (error) return ['ok', 'Blocked as expected.'];
    return data.length === 0 ? ['ok', 'Blocked as expected.']
                             : ['bad', 'Orders are visible publicly! Re-run schema.sql.'];
  });

  await check('Order-tracking function installed', async () => {
    const { error } = await sb.rpc('get_order_status', { p_code: 'TEST', p_phone: '0000000000' });
    if (error) throw error;
    return ['ok', ''];
  });

  await check('Place-order function installed', async () => {
    // Sends an empty order on purpose: it must be rejected with a validation message.
    const { error } = await sb.rpc('place_order',
      { p_customer: {}, p_items: [], p_screenshot_path: '', p_utr: null });
    if (error && /enter your name/i.test(error.message)) return ['ok', 'Validation working.'];
    if (error) throw error;
    return ['bad', 'Function accepted an empty order — re-run schema.sql.'];
  });

  await check('Payment screenshots are private', async () => {
    const { data, error } = await sb.storage.from('payment-screenshots').list('', { limit: 1 });
    if (error) return ['ok', 'Blocked as expected.'];
    return (data || []).length === 0 ? ['ok', 'Not listable by customers.']
                                     : ['bad', 'Screenshots are listable publicly! Re-run schema.sql.'];
  });
})();
