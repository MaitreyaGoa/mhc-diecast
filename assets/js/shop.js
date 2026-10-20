// Shop grid — loads live cars from the database.
(async function () {
  const { sb, esc, money, cover, errMsg } = window.MHC;
  const grid = document.getElementById('productGrid');
  const chips = document.getElementById('brandChips');
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  let all = [], brand = '', q = '';

  grid.innerHTML = Array.from({ length: 8 }, () =>
    '<div class="card skeleton"><div class="card-img"></div><div class="card-body"><span></span><span></span></div></div>').join('');

  try {
    const { data, error } = await sb.from('products')
      .select('id,name,brand,series,scale,mrp,price,stock,images,created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    all = data || [];
  } catch (e) {
    grid.innerHTML = `<p class="empty">Couldn't load cars right now. ${esc(errMsg(e))}</p>`;
    return;
  }

  // Brand chips from what's actually in stock
  const brands = [...new Set(all.map(p => p.brand).filter(Boolean))].sort();
  chips.innerHTML = '<button class="chip active" data-brand="">All</button>' +
    brands.map(b => `<button class="chip" data-brand="${esc(b)}">${esc(b)}</button>`).join('');

  function card(p) {
    const sold = p.stock <= 0;
    const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
    const tag = sold ? '<span class="tag sold">Sold out</span>'
              : p.stock === 1 ? '<span class="tag">Last one</span>'
              : (Date.now() - new Date(p.created_at)) < 7 * 864e5 ? '<span class="tag new">New</span>' : '';
    return `
      <a class="card${sold ? ' is-sold' : ''}" href="product.html?id=${encodeURIComponent(p.id)}">
        <div class="card-img">
          <img src="${esc(cover(p))}" alt="${esc(p.name)}" loading="lazy">${tag}
        </div>
        <div class="card-body">
          <span class="card-brand">${esc(p.brand)}${p.series ? ' · ' + esc(p.series) : ''}</span>
          <span class="card-title">${esc(p.name)}</span>
          <div class="price-row">
            <span class="price">${money(p.price)}</span>
            ${off ? `<span class="mrp">${money(p.mrp)}</span><span class="off">${off}% off</span>` : ''}
          </div>
        </div>
      </a>`;
  }

  function render() {
    const term = q.trim().toLowerCase();
    let list = all.filter(p => (!brand || p.brand === brand) &&
      (!term || [p.name, p.brand, p.series].join(' ').toLowerCase().includes(term)));
    if (sort.value === 'low') list.sort((a, b) => a.price - b.price);
    if (sort.value === 'high') list.sort((a, b) => b.price - a.price);
    list.sort((a, b) => (b.stock > 0) - (a.stock > 0));   // in-stock first, keeps order otherwise
    grid.innerHTML = list.length ? list.map(card).join('')
      : `<p class="empty">${all.length ? 'No cars match your search.' : 'New cars are on the way — check back soon! 🏁'}</p>`;
  }

  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === b));
    brand = b.dataset.brand; render();
  });
  search.addEventListener('input', e => { q = e.target.value; render(); });
  sort.addEventListener('change', render);
  render();
})();
