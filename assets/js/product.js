// Product detail page — product.html?id=<uuid>
(async function () {
  await window.MHC.ready;   // signed-in buyer's saved cart is loaded first
  const { sb, esc, money, cover, param, Cart, toast, errMsg, getSellers, getSettings, sellerFor, waLink } = window.MHC;
  const box = document.getElementById('product');
  const id = param('id');
  if (!id) { box.innerHTML = '<p class="empty">Car not found. <a href="index.html">Back to shop</a></p>'; return; }

  let p;
  try {
    const { data, error } = await sb.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    p = data;
    var sellers = await getSellers();
    var settings = await getSettings().catch(() => null);
  } catch (e) {
    box.innerHTML = `<p class="empty">Couldn't load this car. ${esc(errMsg(e))}</p>`; return;
  }
  if (!p || !p.is_active) {
    box.innerHTML = '<p class="empty">This car is no longer listed. <a href="index.html">See other cars</a></p>'; return;
  }

  const seller = sellerFor(p.seller_id, sellers, settings);
  function sellerBlock() {
    if (!seller || !seller.whatsapp) return '';
    const msg = `Hi ${seller.shop_name}! I'm interested in ${p.name} (${money(p.price)}) on MHC Diecast: ${location.href}`;
    return `<div class="seller-box">
      <div><span class="muted small">Sold by</span><b>${esc(seller.shop_name)}</b></div>
      <a class="btn btn-wa" href="${esc(waLink(seller.whatsapp, msg))}" target="_blank" rel="noopener">Chat with seller</a>
    </div>`;
  }

  document.title = `${p.name} — ${p.brand} ${p.scale || ''} | MHC Diecast`;
  setSeo(p);
  const imgs = p.images && p.images.length ? p.images : [cover(p)];
  const sold = p.stock <= 0;
  const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const inCart = () => (Cart.items().find(i => i.id === p.id) || { qty: 0 }).qty;

  box.innerHTML = `
    <div class="gallery">
      <div class="gallery-main"><img id="mainImg" src="${esc(imgs[0])}" alt="${esc(p.name)}">
        ${sold ? '<span class="tag sold">Sold out</span>' : ''}</div>
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) =>
        `<button class="thumb${i ? '' : ' active'}" data-src="${esc(src)}" aria-label="Photo ${i + 1}">
           <img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
    </div>
    <div class="details">
      <span class="card-brand">${esc(p.brand)}</span>
      <h1 class="product-title">${esc(p.name)}</h1>
      ${p.series ? `<span class="card-series">${esc(p.series)}</span>` : ''}
      <div class="price-row big">
        <span class="price">${money(p.price)}</span>
        ${off ? `<span class="mrp">MRP ${money(p.mrp)}</span><span class="off">${off}% off</span>` : ''}
      </div>
      <ul class="specs">
        <li><span>Scale</span>${esc(p.scale || '—')}</li>
        ${p.category ? `<li><span>Category</span>${esc(p.category === 'Chase' ? 'Treasure Hunt / chase' : p.category)}</li>` : ''}
        <li><span>Availability</span>${sold ? '<b class="bad">Sold out</b>'
            : p.stock === 1 ? '<b class="warn">Only 1 left</b>' : `<b class="ok">In stock (${p.stock})</b>`}</li>
      </ul>
      ${sold ? '' : `
      <div class="buy-row">
        <div class="qty" aria-label="Quantity">
          <button type="button" id="minus" aria-label="Less">−</button>
          <input id="qty" type="number" min="1" max="${p.stock}" value="1" inputmode="numeric">
          <button type="button" id="plus" aria-label="More">+</button>
        </div>
        <button class="btn btn-primary grow" id="addBtn">Add to cart</button>
      </div>
      <button class="btn btn-dark btn-block" id="buyBtn">Buy now</button>`}
      ${p.category === 'Pre-owned' ? '<div class="notice">Pre-owned: priced on condition and rarity, not card MRP. Please read the description and check the photos.</div>' : ''}
      ${p.description ? `<div class="desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
      ${sellerBlock()}
      <div class="ship-note">
        <div>🏝️ <b>Free shipping</b> anywhere in Goa</div>
        <div>🚚 Pan-India delivery — ${seller.outside_goa_shipping > 0 ? `${money(seller.outside_goa_shipping)} shipping added at checkout` : 'shipping added at checkout'}</div>
        <div>✅ Pay by UPI — your order is confirmed once we verify the payment</div>
      </div>
      <button class="link-btn share-btn" id="shareBtn" type="button">↗ Share this car</button>
    </div>`;

  document.getElementById('shareBtn').onclick = async () => {
    const text = `${p.name} (${p.brand}) — ${money(p.price)} at MHC Diecast`;
    if (navigator.share) { try { await navigator.share({ title: p.name, text, url: location.href }); } catch (e) {} }
    else window.open(`https://wa.me/?text=${encodeURIComponent(text + '\n' + location.href)}`, '_blank');
  };

  box.querySelectorAll('.thumb').forEach(t => t.addEventListener('click', () => {
    document.getElementById('mainImg').src = t.dataset.src;
    box.querySelectorAll('.thumb').forEach(x => x.classList.toggle('active', x === t));
  }));
  if (sold) return;

  const qty = document.getElementById('qty');
  const clamp = v => Math.max(1, Math.min(p.stock, parseInt(v, 10) || 1));
  document.getElementById('minus').onclick = () => { qty.value = clamp(+qty.value - 1); };
  document.getElementById('plus').onclick = () => { qty.value = clamp(+qty.value + 1); };
  qty.onchange = () => { qty.value = clamp(qty.value); };

  function add() {
    const want = clamp(qty.value);
    const room = p.stock - inCart();
    if (room <= 0) { toast(`All ${p.stock} available are already in your cart.`, 'warn'); return false; }
    Cart.add(p, Math.min(want, room));
    if (want > room) toast(`Only ${room} more could be added.`, 'warn');
    return true;
  }
  document.getElementById('addBtn').onclick = () => { if (add()) toast('Added to cart 🏁', 'ok'); };
  document.getElementById('buyBtn').onclick = () => { if (add() || inCart()) location.href = 'cart.html'; };

  // ---------- SEO: description, social preview, Google product data ----------
  function setSeo(p) {
    const desc = `${p.brand} ${p.name}${p.series ? ' (' + p.series + ')' : ''}, ${p.scale || '1:64'} diecast — ${money(p.price)}. ` +
                 'Free shipping in Goa, delivery across India.';
    const meta = (attr, key, val) => {
      let m = document.querySelector(`meta[${attr}="${key}"]`);
      if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m); }
      m.setAttribute('content', val);
    };
    meta('name', 'description', desc);
    meta('property', 'og:title', `${p.name} — ${money(p.price)}`);
    meta('property', 'og:description', desc);
    if (p.images && p.images[0]) meta('property', 'og:image', p.images[0]);
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.name, brand: { '@type': 'Brand', name: p.brand },
      image: p.images || [], description: p.description || desc, sku: p.id,
      offers: { '@type': 'Offer', priceCurrency: 'INR', price: Number(p.price), url: location.href,
                availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
                itemCondition: 'https://schema.org/NewCondition' }
    });
    document.head.appendChild(ld);
  }
})();
