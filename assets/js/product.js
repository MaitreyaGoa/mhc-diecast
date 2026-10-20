// Product detail page — product.html?id=<uuid>
(async function () {
  const { sb, esc, money, cover, param, Cart, toast, errMsg } = window.MHC;
  const box = document.getElementById('product');
  const id = param('id');
  if (!id) { box.innerHTML = '<p class="empty">Car not found. <a href="index.html">Back to shop</a></p>'; return; }

  let p;
  try {
    const { data, error } = await sb.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    p = data;
  } catch (e) {
    box.innerHTML = `<p class="empty">Couldn't load this car. ${esc(errMsg(e))}</p>`; return;
  }
  if (!p || !p.is_active) {
    box.innerHTML = '<p class="empty">This car is no longer listed. <a href="index.html">See other cars</a></p>'; return;
  }

  document.title = `${p.name} — MHC Diecast`;
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
      <span class="card-brand">${esc(p.brand)}${p.series ? ' · ' + esc(p.series) : ''}</span>
      <h1 class="product-title">${esc(p.name)}</h1>
      <div class="price-row big">
        <span class="price">${money(p.price)}</span>
        ${off ? `<span class="mrp">MRP ${money(p.mrp)}</span><span class="off">${off}% off</span>` : ''}
      </div>
      <ul class="specs">
        <li><span>Scale</span>${esc(p.scale || '—')}</li>
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
      ${p.description ? `<div class="desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="ship-note">
        <div>🏝️ <b>Free shipping</b> anywhere in Goa</div>
        <div>🚚 Pan-India delivery — shipping charges added at checkout</div>
        <div>✅ Pay by UPI — your order is confirmed once we verify the payment</div>
      </div>
    </div>`;

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
})();
