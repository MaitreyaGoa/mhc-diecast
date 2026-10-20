// Cart page — edit quantities, then go to checkout.
(async function () {
  const { esc, money, cover, Cart, getSettings, errMsg } = window.MHC;
  const itemsBox = document.getElementById('cartItems');
  const summary = document.getElementById('summary');
  const notesBox = document.getElementById('notes');

  // Refresh prices & stock from the database first
  try {
    const notes = await Cart.sync();
    notesBox.innerHTML = notes.map(n => `<div class="notice">${esc(n)}</div>`).join('');
  } catch (e) {
    notesBox.innerHTML = `<div class="notice bad">Couldn't check latest stock: ${esc(errMsg(e))}</div>`;
  }
  try {
    const s = await getSettings();
    document.getElementById('outsideRate').textContent = money(s.outside_goa_shipping);
  } catch (e) { document.getElementById('outsideRate').textContent = 'charges apply'; }

  function render() {
    const items = Cart.items();
    if (!items.length) {
      itemsBox.innerHTML = '<div class="empty">Your cart is empty.<br><br><a class="btn btn-primary" href="index.html">Browse cars</a></div>';
      summary.hidden = true;
      return;
    }
    itemsBox.innerHTML = items.map(i => `
      <div class="cart-row" data-id="${esc(i.id)}">
        <a href="product.html?id=${encodeURIComponent(i.id)}" class="cart-thumb">
          <img src="${esc(cover(i))}" alt="${esc(i.name)}"></a>
        <div class="cart-info">
          <span class="card-brand">${esc(i.brand || '')}</span>
          <a href="product.html?id=${encodeURIComponent(i.id)}" class="card-title">${esc(i.name)}</a>
          <span class="muted small">${money(i.price)} each${i.stock <= 3 ? ` · only ${i.stock} in stock` : ''}</span>
          <div class="cart-actions">
            <div class="qty sm">
              <button type="button" data-act="minus" aria-label="Less">−</button>
              <input type="number" value="${i.qty}" min="1" max="${i.stock}" data-act="qty" inputmode="numeric" aria-label="Quantity">
              <button type="button" data-act="plus" aria-label="More">+</button>
            </div>
            <button class="link-btn" data-act="remove">Remove</button>
          </div>
        </div>
        <b class="line-total">${money(i.price * i.qty)}</b>
      </div>`).join('');
    document.getElementById('subtotal').textContent = money(Cart.subtotal());
    summary.hidden = false;
  }

  itemsBox.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn || btn.tagName === 'INPUT') return;
    const id = btn.closest('.cart-row').dataset.id;
    const it = Cart.items().find(i => i.id === id); if (!it) return;
    if (btn.dataset.act === 'minus') Cart.setQty(id, it.qty - 1);
    if (btn.dataset.act === 'plus') Cart.setQty(id, it.qty + 1);
    if (btn.dataset.act === 'remove') Cart.remove(id);
    render();
  });
  itemsBox.addEventListener('change', e => {
    if (e.target.dataset.act !== 'qty') return;
    Cart.setQty(e.target.closest('.cart-row').dataset.id, parseInt(e.target.value, 10) || 1);
    render();
  });

  render();
})();
