// Shop grid — loads live cars from the database.
(async function () {
  const { sb, esc, money, cover, errMsg } = window.MHC;
  const grid = document.getElementById('productGrid');
  const chips = document.getElementById('brandChips');
  const subChips = document.getElementById('typeChips');
  const scaleSel = document.getElementById('scale');
  const heading = document.getElementById('shopHeading');
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const CAT = window.MHC_CATALOG || { MENU: [{ key: 'all', label: 'All' }], SCALES: [] };
  const NOT_CARS = ['Pre-owned', 'Accessory'];
  const NAMED = CAT.MENU.filter(m => m.brand).map(m => m.brand);
  const url = new URLSearchParams(location.search);
  let all = [], q = '';
  let menu = CAT.MENU.find(m => m.key === url.get('c')) || CAT.MENU[0];
  let type = url.get('type') || '';
  let scale = url.get('scale') || '';

  grid.innerHTML = Array.from({ length: 8 }, () =>
    '<div class="card skeleton"><div class="card-img"></div><div class="card-body"><span></span><span></span></div></div>').join('');

  try {
    const { data, error } = await sb.from('products')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    all = data || [];
  } catch (e) {
    grid.innerHTML = `<p class="empty">Couldn't load cars right now. ${esc(errMsg(e))}</p>`;
    return;
  }

  setStage(all.find(p => p.stock > 0 && p.images && p.images[0]));

  // ---------- menu: brand / section, then type, then scale ----------
  function inMenu(p, m) {
    if (!m || m.key === 'all') return true;
    if (m.category) return p.category === m.category;
    if (NOT_CARS.includes(p.category)) return false;
    if (m.brand) return p.brand === m.brand;
    if (m.other) return !NAMED.includes(p.brand);
    return true;
  }
  const count = m => all.filter(p => inMenu(p, m)).length;
  function renderMenu() {
    chips.innerHTML = CAT.MENU.map(m => {
      const n = count(m);
      return `<button class="chip${m === menu ? ' active' : ''}${n ? '' : ' is-empty'}" data-key="${esc(m.key)}">${esc(m.label)}${m.key !== 'all' && n ? ` <span class="chip-n">${n}</span>` : ''}</button>`;
    }).join('');
    const inSet = all.filter(p => inMenu(p, menu));
    const types = ['Mainline', 'Premium', 'Chase'].filter(t => inSet.some(p => p.category === t));
    if (!types.includes(type)) type = '';
    subChips.hidden = types.length < 2 || !!menu.category;
    subChips.innerHTML = ['', ...types].map(t =>
      `<button class="chip${t === type ? ' active' : ''}" data-type="${esc(t)}">${t ? (t === 'Chase' ? 'Treasure Hunt & chase' : t) : 'All types'}</button>`).join('');
    const scales = [...new Set([...CAT.SCALES, ...all.map(p => p.scale)].filter(x => x && all.some(p => p.scale === x)))];
    if (!scales.includes(scale)) scale = '';
    scaleSel.innerHTML = '<option value="">All scales</option>' + scales.map(x => `<option${x === scale ? ' selected' : ''}>${esc(x)}</option>`).join('');
    scaleSel.hidden = scales.length < 2;
    heading.textContent = menu.key === 'all' ? 'In the case now' : menu.label;
  }
  function saveUrl() {
    const u = new URLSearchParams();
    if (menu.key !== 'all') u.set('c', menu.key);
    if (type) u.set('type', type);
    if (scale) u.set('scale', scale);
    const qs = u.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
  }

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
          <span class="card-brand">${esc(p.brand)}</span>
          <span class="card-title">${esc(p.name)}</span>
          ${p.series ? `<span class="card-series">${esc(p.series)}</span>` : ''}
          <div class="price-row">
            <span class="price">${money(p.price)}</span>
            ${off ? `<span class="mrp">${money(p.mrp)}</span><span class="off">${off}% off</span>` : ''}
          </div>
        </div>
      </a>`;
  }

  function render() {
    const term = q.trim().toLowerCase();
    let list = all.filter(p => inMenu(p, menu) && (!type || p.category === type) && (!scale || p.scale === scale) &&
      (!term || [p.name, p.brand, p.series, p.category].join(' ').toLowerCase().includes(term)));
    if (sort.value === 'low') list.sort((a, b) => a.price - b.price);
    if (sort.value === 'high') list.sort((a, b) => b.price - a.price);
    list.sort((a, b) => (b.stock > 0) - (a.stock > 0));   // in-stock first, keeps order otherwise
    grid.innerHTML = list.length ? list.map(card).join('')
      : `<p class="empty">${!all.length ? 'New cars are on the way — check back soon.'
          : term ? 'No cars match your search.'
          : `Nothing in ${esc(menu.label)} right now. Ask us on WhatsApp — we can source it.`}</p>`;
  }

  // Hero showroom: newest in-stock car with a photo (logo until then)
  function setStage(p) {
    const C = window.MHC.C;
    if (C.WHATSAPP_GROUP) { const g = document.getElementById('heroGroup'); g.href = C.WHATSAPP_GROUP; g.hidden = false; }
    const img = document.getElementById('stageImg'), refl = document.getElementById('stageReflect');
    const stage = document.getElementById('stage');
    if (p) {
      img.removeAttribute('data-logo'); img.src = p.images[0]; img.alt = p.name; img.classList.add('photo');
      stage.href = 'product.html?id=' + encodeURIComponent(p.id);
      const cap = document.getElementById('stageCaption');
      cap.innerHTML = `<div><span>Newest arrival</span><b>${esc(p.name)}</b></div><b class="price">${money(p.price)}</b>`;
      cap.hidden = false;
      refl.parentElement.hidden = true;
    } else {
      refl.src = img.src;
    }
  }

  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    menu = CAT.MENU.find(m => m.key === b.dataset.key) || CAT.MENU[0];
    type = ''; renderMenu(); saveUrl(); render();
  });
  subChips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    type = b.dataset.type; renderMenu(); saveUrl(); render();
  });
  scaleSel.addEventListener('change', () => { scale = scaleSel.value; saveUrl(); render(); });
  search.addEventListener('input', e => { q = e.target.value; render(); });
  sort.addEventListener('change', render);
  renderMenu();
  render();
  if (url.get('c')) document.getElementById('shop').scrollIntoView();
})();
