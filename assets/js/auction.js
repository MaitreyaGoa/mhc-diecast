// =====================================================================
//  MHC Diecast — Auctions (mhcdiecast.com/auction)
//  List · one auction with live bidding · start an auction
//  All rules are checked again by the database (phase10-auctions.sql).
// =====================================================================
(async function () {
  const { sb, esc, money, param, Auth, ready, googleButton, waLink, toast, errMsg } = window.MHC;
  const $ = id => document.getElementById(id);
  const BUCKET = 'auction-photos';
  const COLS = 'id,seller_id,seller_name,title,description,photo_path,start_price,min_increment,buy_now_price,' +
               'end_time,status,current_bid,current_bidder,current_bidder_label,bid_count,extensions,closed_at,created_at';

  await ready;
  const me = Auth.user ? Auth.user.id : null;

  // ---------- server clock (bidding closes on the server's time, not the phone's) ----------
  let offset = 0;
  async function syncClock() {
    try {
      const t0 = Date.now();
      const { data, error } = await sb.rpc('server_now');
      if (!error && data) offset = new Date(data).getTime() - (t0 + Date.now()) / 2;
    } catch (e) { /* keep last offset */ }
  }
  const now = () => Date.now() + offset;

  // ---------- helpers ----------
  const photo = a => sb.storage.from(BUCKET).getPublicUrl(a.photo_path).data.publicUrl;
  const ended = a => a.status === 'sold' || (a.status === 'live' && new Date(a.end_time).getTime() <= now());
  const isLive = a => a.status === 'live' && new Date(a.end_time).getTime() > now();
  // Final 2 minutes: steps of at least ₹100, and every bid resets the clock to 2 minutes
  const LATE_MS = 2 * 60 * 1000, LATE_STEP = 100;
  const isLate = a => isLive(a) && new Date(a.end_time).getTime() - now() <= LATE_MS;
  const step = a => isLate(a) ? Math.max(a.min_increment, LATE_STEP) : a.min_increment;
  const nextMin = a => a.current_bid == null ? a.start_price : a.current_bid + step(a);
  const fmtDate = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const signInBlock = (text) =>
    `<div class="auc-signin"><p>${esc(text)}</p>${googleButton('Continue with Google')
      .replace('data-google-signin', `data-google-signin data-return-to="${esc(location.href.split('#')[0])}"`)}</div>`;

  function left(a) {
    let ms = new Date(a.end_time).getTime() - now();
    if (ms <= 0) return 'Ended';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
          m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  const urgent = a => isLive(a) && new Date(a.end_time).getTime() - now() < 5 * 60 * 1000;

  // Every [data-ends] element counts down by itself
  setInterval(() => {
    document.querySelectorAll('[data-ends]').forEach(el => {
      const a = { status: 'live', end_time: el.dataset.ends };
      el.textContent = left(a);
      el.classList.toggle('urgent', urgent(a));
      if (left(a) === 'Ended' && !el.dataset.done) { el.dataset.done = '1'; refreshSoon(); }
      // entering the final 2 minutes changes the minimum bid → redraw
      if (new Date(a.end_time).getTime() - now() <= LATE_MS && !el.dataset.late) { el.dataset.late = '1'; refreshSoon(); }
    });
  }, 1000);
  let refreshTimer = null, refreshFn = null;
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshFn && refreshFn(), 800); }

  function poll(fn, ms) {
    refreshFn = fn;
    setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncClock(); fn(); } });
  }

  function confirmBox(title, text, yes) {
    const d = $('confirmDlg');
    $('cfTitle').textContent = title; $('cfText').innerHTML = text; $('cfYes').textContent = yes || 'Confirm';
    return new Promise(res => {
      if (!d.showModal) return res(window.confirm(title));
      d.returnValue = ''; d.showModal();
      d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
    });
  }

  await syncClock();
  if (param('new') != null) return showNew();
  if (param('id')) return showDetail(param('id'));
  return showList();

  // =================================================================
  //  LIST
  // =================================================================
  async function showList() {
    $('listView').hidden = false;
    let tab = ['live', 'ended', 'mine', 'bids'].includes(param('tab')) ? param('tab') : 'live';
    $('newBtn').onclick = () => { location.href = 'auction.html?new=1'; };
    $('aucTabs').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      tab = b.dataset.tab; render(true);
    });
    poll(() => render(false), 15000);
    render(true);

    async function render(fresh) {
      document.querySelectorAll('#aucTabs .chip').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
      try { history.replaceState(null, '', 'auction.html' + (tab === 'live' ? '' : '?tab=' + tab)); } catch (e) {}
      const body = $('listBody');
      if (fresh) body.innerHTML = '<div class="grid">' + Array(4).fill(
        '<div class="card skeleton"><div class="card-img"></div><div class="card-body"><span></span><span></span></div></div>').join('') + '</div>';

      if ((tab === 'mine' || tab === 'bids') && !me) {
        body.innerHTML = `<div class="panel">${signInBlock(tab === 'mine' ? 'Sign in to see the auctions you started.' : 'Sign in to see the auctions you bid on.')}</div>`;
        return;
      }
      const iso = new Date(now()).toISOString();
      let q = sb.from('auctions').select(COLS);
      let myBids = null;
      if (tab === 'live') q = q.eq('status', 'live').gt('end_time', iso).order('end_time', { ascending: true }).limit(60);
      if (tab === 'ended') q = q.or(`status.eq.sold,and(status.eq.live,end_time.lte.${iso})`).order('end_time', { ascending: false }).limit(40);
      if (tab === 'mine') q = q.eq('seller_id', me).order('created_at', { ascending: false }).limit(60);
      if (tab === 'bids') {
        const r = await sb.from('auction_bids').select('auction_id,amount').order('created_at', { ascending: false }).limit(300);
        if (r.error) { body.innerHTML = `<p class="empty">${esc(errMsg(r.error))}</p>`; return; }
        myBids = {};
        (r.data || []).forEach(b => { myBids[b.auction_id] = Math.max(myBids[b.auction_id] || 0, b.amount); });
        const ids = Object.keys(myBids);
        if (!ids.length) { body.innerHTML = emptyBox('You haven\'t bid on anything yet.', 'See live auctions', 'auction.html'); return; }
        q = q.in('id', ids).order('end_time', { ascending: false });
      }
      const { data, error } = await q;
      if (error) {
        body.innerHTML = /auctions|relation|schema/i.test(error.message)
          ? '<p class="empty">Auctions are being set up — check back soon.</p>'
          : `<p class="empty">Couldn't load auctions. ${esc(errMsg(error))}</p>`;
        return;
      }
      const list = data || [];
      if (!list.length) {
        body.innerHTML = {
          live: emptyBox('No live auctions right now.', '+ Start an auction', 'auction.html?new=1'),
          ended: emptyBox('No finished auctions yet.'),
          mine: emptyBox('You haven\'t started an auction yet.', '+ Start an auction', 'auction.html?new=1'),
          bids: emptyBox('You haven\'t bid on anything yet.')
        }[tab];
        return;
      }
      body.innerHTML = '<div class="grid">' + list.map(a => card(a, myBids)).join('') + '</div>';
    }
  }

  function emptyBox(text, btn, href) {
    return `<div class="panel empty">${esc(text)}${btn ? `<br><br><a class="btn btn-primary" href="${href}">${esc(btn)}</a>` : ''}</div>`;
  }

  function card(a, myBids) {
    const live = isLive(a), done = ended(a);
    let tag = '';
    if (a.status === 'cancelled') tag = '<span class="tag sold">Cancelled</span>';
    else if (a.status === 'removed') tag = '<span class="tag sold">Removed</span>';
    else if (done) tag = `<span class="tag sold">${a.bid_count ? 'Sold' : 'Ended'}</span>`;
    else if (a.buy_now_price) tag = '<span class="tag new">Buy Now</span>';
    let mine = '';
    if (myBids && me) {
      if (a.current_bidder === me) mine = `<span class="auc-pill ${done ? 'won' : 'win'}">${done ? 'You won' : 'You\'re winning'}</span>`;
      else mine = `<span class="auc-pill out">${done ? 'Not won' : 'Outbid'}</span>`;
    } else if (me && a.seller_id === me && live) mine = '<span class="auc-pill">Your auction</span>';
    return `
      <a class="card auc-card${done || !live ? ' is-sold' : ''}" href="auction.html?id=${encodeURIComponent(a.id)}">
        <div class="card-img"><img src="${esc(photo(a))}" alt="${esc(a.title)}" loading="lazy">${tag}</div>
        <div class="card-body">
          <span class="card-title">${esc(a.title)}</span>
          <span class="card-brand">by ${esc(a.seller_name)}</span>
          <div class="auc-card-row">
            <div><span class="auc-k">${a.current_bid != null ? (done ? 'Winning bid' : 'Current bid') : 'Starting bid'}</span>
                 <b class="price">${money(a.current_bid != null ? a.current_bid : a.start_price)}</b></div>
            <div class="auc-right"><span class="auc-k">${a.bid_count} bid${a.bid_count === 1 ? '' : 's'}</span>
                 ${live ? `<span class="auc-time${urgent(a) ? ' urgent' : ''}" data-ends="${esc(a.end_time)}">${left(a)}</span>`
                        : `<span class="auc-time ended">${a.status === 'live' || a.status === 'sold' ? 'Ended' : esc(a.status)}</span>`}</div>
          </div>
          ${mine}
        </div>
      </a>`;
  }

  // =================================================================
  //  ONE AUCTION
  // =================================================================
  async function showDetail(id) {
    $('detailView').hidden = false;
    const box = $('detailBody');
    box.innerHTML = '<p class="empty">Loading…</p>';
    let a = null, bids = [], contact = null, busy = false, lastBidSeen = null;

    async function load() {
      const [r, b] = await Promise.all([
        sb.from('auctions').select(COLS).eq('id', id).maybeSingle(),
        sb.rpc('auction_bids_for', { p_auction: id })
      ]);
      if (r.error) throw r.error;
      a = r.data; bids = b.error ? [] : (b.data || []);
      if (a && ended(a) && me && (me === a.seller_id || me === a.current_bidder) && !contact) {
        const c = await sb.rpc('auction_contact', { p_auction: id });
        contact = c.error ? null : (c.data || [])[0] || null;
      }
    }

    async function refresh(first) {
      if (busy) return;
      try { await load(); }
      catch (e) { if (first) box.innerHTML = `<p class="empty">Couldn't load this auction. ${esc(errMsg(e))}</p>`; return; }
      if (!a) { box.innerHTML = '<div class="panel empty">This auction doesn\'t exist or was removed.<br><br><a class="btn btn-primary" href="auction.html">See all auctions</a></div>'; return; }
      // tell the user if someone outbid them while they were watching
      if (!first && me && lastBidSeen && lastBidSeen.bidder === me && a.current_bidder !== me && isLive(a))
        toast(`You've been outbid by ${a.current_bidder_label} — new bid ${money(a.current_bid)}`, 'warn');
      lastBidSeen = { bidder: a.current_bidder, amount: a.current_bid };
      const keep = $('bidAmt') && document.activeElement === $('bidAmt') ? $('bidAmt').value : null;
      render();
      if (keep != null && $('bidAmt') && Number(keep) >= nextMin(a)) { $('bidAmt').value = keep; $('bidAmt').focus(); }
    }

    function statusBox() {
      if (a.status === 'cancelled') return '<div class="notice">The seller cancelled this auction.</div>';
      if (a.status === 'removed') return '<div class="notice bad">This auction was removed by MHC Diecast.</div>';
      if (!ended(a)) {
        if (!me) return '';
        if (a.seller_id === me) return '<div class="auc-banner">This is your auction. You\'ll see the winner\'s contact here when it ends.</div>';
        if (a.current_bidder === me) return '<div class="auc-banner win">You\'re the highest bidder 🎉</div>';
        if (bids.some(b => b.is_me)) return '<div class="auc-banner out">You\'ve been outbid — bid again to win.</div>';
        return '';
      }
      if (!a.current_bidder) return '<div class="auc-banner">Auction ended with no bids.</div>';
      const price = money(a.current_bid);
      if (me === a.current_bidder) {
        const c = contact || {};
        const wa = c.seller_whatsapp ? '91' + c.seller_whatsapp : null;
        return `<div class="auc-result won">
          <div class="auc-result-ico">🏆</div>
          <h3>You won${a.status === 'sold' ? ' with Buy Now' : ''}!</h3>
          <p>Winning bid <b>${price}</b>. Contact <b>${esc(c.seller_name || a.seller_name)}</b> to arrange payment and delivery.</p>
          <div class="auc-result-actions">
            ${wa ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(wa, `Hi! I won your MHC Diecast auction "${a.title}" for ${price}. ${location.href}`))}">WhatsApp seller</a>` : ''}
            ${c.seller_email ? `<a class="btn btn-ghost" href="mailto:${esc(c.seller_email)}">Email seller</a>` : ''}
          </div></div>`;
      }
      if (me === a.seller_id) {
        const c = contact || {};
        return `<div class="auc-result">
          <div class="auc-result-ico">🔨</div>
          <h3>Sold for ${price}</h3>
          <p>Winner: <b>${esc(c.winner_name || a.current_bidder_label)}</b>${c.winner_email ? ` · ${esc(c.winner_email)}` : ''}</p>
          <div class="auc-result-actions">
            ${c.winner_phone ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink('91' + c.winner_phone, `Hi! You won my MHC Diecast auction "${a.title}" for ${price}.`))}">WhatsApp winner</a>` : ''}
            ${c.winner_email ? `<a class="btn btn-ghost" href="mailto:${esc(c.winner_email)}?subject=${encodeURIComponent('You won: ' + a.title)}">Email winner</a>` : ''}
          </div>
          ${!c.winner_phone ? '<p class="muted small">The winner hasn\'t added a mobile number — use email. They can also WhatsApp you.</p>' : ''}
          </div>`;
      }
      return `<div class="auc-banner">Ended — won by <b>${esc(a.current_bidder_label)}</b> for <b>${price}</b>.</div>`;
    }

    function bidBox() {
      if (!isLive(a)) return '';
      if (!me) return signInBlock('Sign in with Google to bid.');
      if (a.seller_id === me) {
        return a.bid_count === 0
          ? '<button class="btn btn-ghost btn-block" id="cancelBtn">Cancel auction</button><p class="muted small center">You can cancel only before the first bid.</p>'
          : '';
      }
      if (a.current_bidder === me) return '<p class="muted small">You\'ll be told here if someone outbids you. You can\'t outbid yourself.</p>';
      const min = nextMin(a);
      const inc = step(a);
      const quick = [min, min + inc, min + 4 * inc]
        .filter(v => !a.buy_now_price || v < a.buy_now_price);
      return `
        <form id="bidForm" class="auc-bid" novalidate>
          ${isLate(a) ? `<div class="auc-late">⏱ <b>Final 2 minutes</b> — bids must be ${money(inc)} higher, and each bid resets the clock to 2:00.</div>` : ''}
          <label for="bidAmt" class="auc-k">Your bid (₹${min.toLocaleString('en-IN')} or more)</label>
          <div class="auc-bid-row">
            <div class="auc-money"><span>₹</span><input id="bidAmt" class="input" type="number" inputmode="numeric" min="${min}" step="1" value="${min}" required></div>
            <button class="btn btn-primary" id="bidBtn">Place bid</button>
          </div>
          ${quick.length > 1 ? `<div class="auc-quick">${quick.map(v => `<button type="button" class="chip" data-v="${v}">${money(v)}</button>`).join('')}</div>` : ''}
          <div class="form-error" id="bidErr" hidden></div>
        </form>
        ${a.buy_now_price ? `<button class="btn btn-dark btn-block" id="binBtn">Buy Now for ${money(a.buy_now_price)}</button>` : ''}`;
    }

    function render() {
      document.title = a.title + ' — Auction — MHC Diecast';
      const live = isLive(a);
      box.innerHTML = `
        <div class="gallery">
          <div class="gallery-main auc-photo"><img src="${esc(photo(a))}" alt="${esc(a.title)}"></div>
        </div>
        <div class="details">
          <span class="card-brand">Auction · by ${esc(a.seller_name)}</span>
          <h1 class="product-title">${esc(a.title)}</h1>
          ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
          <div class="auc-panel">
            <div class="auc-stats">
              <div><span class="auc-k">${a.current_bid != null ? (live ? 'Current bid' : 'Winning bid') : 'Starting bid'}</span>
                   <b class="auc-big">${money(a.current_bid != null ? a.current_bid : a.start_price)}</b>
                   ${a.current_bid != null ? `<span class="muted small">by ${esc(a.current_bidder_label)}${a.current_bidder === me ? ' (you)' : ''}</span>` : ''}</div>
              <div class="auc-right"><span class="auc-k">${live ? 'Ends in' : 'Ended'}</span>
                   ${live ? `<b class="auc-big auc-time${urgent(a) ? ' urgent' : ''}" data-ends="${esc(a.end_time)}">${left(a)}</b>`
                          : `<b class="auc-big">${fmtDate(a.closed_at && a.status !== 'live' ? a.closed_at : a.end_time)}</b>`}
                   ${live ? `<span class="muted small">${fmtDate(a.end_time)}</span>` : ''}
                   ${a.extensions ? `<span class="auc-ext">Extended ${a.extensions}× by late bids</span>` : ''}</div>
            </div>
            <ul class="auc-facts">
              <li><span>Starting bid</span><b>${money(a.start_price)}</b></li>
              <li><span>Min. increment</span><b>${money(a.min_increment)}</b></li>
              <li><span>Last 2 min</span><b>+${money(Math.max(a.min_increment, LATE_STEP))}</b></li>
              ${a.buy_now_price ? `<li><span>Buy Now</span><b>${money(a.buy_now_price)}</b></li>` : ''}
              <li><span>Bids</span><b>${a.bid_count}</b></li>
            </ul>
            ${statusBox()}
            ${bidBox()}
          </div>
          <div class="auc-share">
            <button class="link-btn" id="shareBtn">Share this auction</button>
          </div>
          <h3 class="auc-h3">Bid history</h3>
          ${bids.length ? `<ol class="auc-bids">${bids.map((b, i) => `
            <li class="${i === 0 ? 'top' : ''}${b.is_me ? ' me' : ''}">
              <span>${esc(b.bidder)}${b.is_me ? ' <em>(you)</em>' : ''}${b.is_buy_now ? ' <span class="auc-pill win">Buy Now</span>' : ''}</span>
              <span class="muted small">${fmtDate(b.created_at)}</span>
              <b>${money(b.amount)}</b></li>`).join('')}</ol>`
            : '<p class="muted">No bids yet — be the first.</p>'}
        </div>`;
      wire();
    }

    function wire() {
      const f = $('bidForm');
      if (f) {
        f.querySelectorAll('.auc-quick .chip').forEach(c => c.onclick = () => { $('bidAmt').value = c.dataset.v; $('bidAmt').focus(); });
        f.onsubmit = async e => {
          e.preventDefault();
          const err = $('bidErr'); err.hidden = true;
          const v = $('bidAmt').value.trim(), amt = Number(v), min = nextMin(a);
          const fail = m => { err.textContent = m; err.hidden = false; };
          if (!/^\d+$/.test(v)) return fail('Enter a whole rupee amount, e.g. ' + min);
          if (amt < min) return fail(a.current_bid == null ? `Bid at least the starting bid of ${money(min)}.`
            : `Bid at least ${money(min)} (current bid + ${money(step(a))}${isLate(a) ? ' in the final 2 minutes' : ''}).`);
          if (a.buy_now_price && amt >= a.buy_now_price) return fail(`That's at or above the Buy Now price — use Buy Now for ${money(a.buy_now_price)}.`);
          const big = amt >= min * 3 && amt - min >= 1000;
          const ok = await confirmBox(`Bid ${money(amt)}?`,
            `${big ? '<b>That\'s much higher than the minimum bid of ' + money(min) + '.</b> ' : ''}Bids are final and can't be withdrawn. If you win, you agree to buy at this price.`,
            'Place bid');
          if (!ok) return;
          busy = true; $('bidBtn').disabled = true;
          const { error } = await sb.rpc('place_bid', { p_auction: a.id, p_amount: amt });
          busy = false;
          if (error) { fail(errMsg(error)); if ($('bidBtn')) $('bidBtn').disabled = false; await refresh(false); if ($('bidErr')) { $('bidErr').textContent = errMsg(error); $('bidErr').hidden = false; } return; }
          toast(`Bid placed: ${money(amt)} — you're the highest bidder`, 'ok');
          await refresh(false);
        };
      }
      const bin = $('binBtn');
      if (bin) bin.onclick = async () => {
        const ok = await confirmBox(`Buy now for ${money(a.buy_now_price)}?`,
          'This ends the auction immediately and you win the car at this price. It can\'t be undone.', 'Buy Now');
        if (!ok) return;
        busy = true; bin.disabled = true;
        const { error } = await sb.rpc('buy_now', { p_auction: a.id });
        busy = false;
        if (error) { toast(errMsg(error), 'warn'); bin.disabled = false; return refresh(false); }
        toast('You won it! Contact the seller below.', 'ok');
        contact = null; await refresh(false);
      };
      const cancel = $('cancelBtn');
      if (cancel) cancel.onclick = async () => {
        if (!(await confirmBox('Cancel this auction?', 'It will be closed and nobody can bid.', 'Cancel auction'))) return;
        const { error } = await sb.rpc('cancel_auction', { p_auction: a.id });
        if (error) { toast(errMsg(error), 'warn'); return refresh(false); }
        toast('Auction cancelled', 'ok'); refresh(false);
      };
      $('shareBtn').onclick = async () => {
        const url = location.origin + location.pathname + '?id=' + a.id;
        const text = `${a.title} — bid on MHC Diecast Auctions`;
        try {
          if (navigator.share) await navigator.share({ title: text, url });
          else { await navigator.clipboard.writeText(url); toast('Link copied', 'ok'); }
        } catch (e) { /* closed */ }
      };
    }

    await refresh(true);
    poll(() => refresh(false), 4000);
  }

  // =================================================================
  //  START AN AUCTION
  // =================================================================
  function showNew() {
    $('newView').hidden = false;
    const body = $('newBody');
    if (!me) { body.innerHTML = `<div class="panel">${signInBlock('Sign in with Google to start an auction.')}</div>`; return; }
    const p = Auth.profile || {};
    const pad = n => String(n).padStart(2, '0');
    const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const inDays = n => { const d = new Date(now() + n * 864e5); d.setSeconds(0, 0); return d; };

    body.innerHTML = `
      <form id="newForm" class="panel" novalidate>
        <div class="field"><label>Photo of the car *</label>
          <label class="upload" id="upBox"><input type="file" id="photo" accept="image/*">
            <span id="upText">📷 Tap to add one photo<br><span class="muted small">Clear, well-lit, card front visible</span></span></label></div>
        <div class="field"><label for="title">Title *</label>
          <input id="title" class="input" maxlength="80" placeholder="e.g. Hot Wheels '71 Datsun 510 — Super Treasure Hunt"></div>
        <div class="field"><label for="desc">Description</label>
          <textarea id="desc" class="input" rows="3" maxlength="600" placeholder="Condition, card, year, anything buyers should know"></textarea></div>
        <div class="three">
          <div class="field"><label for="start">Starting bid (₹) *</label><input id="start" class="input" type="number" inputmode="numeric" min="1" step="1" placeholder="100"></div>
          <div class="field"><label for="inc">Min. increment (₹) *</label><input id="inc" class="input" type="number" inputmode="numeric" min="1" step="1" value="10"></div>
          <div class="field"><label for="bin">Buy Now (₹)</label><input id="bin" class="input" type="number" inputmode="numeric" min="1" step="1" placeholder="Optional"></div>
        </div>
        <div class="field"><label for="end">Ends at *</label>
          <div class="chips auc-ends" id="endChips">
            <button type="button" class="chip" data-d="1">1 day</button>
            <button type="button" class="chip active" data-d="3">3 days</button>
            <button type="button" class="chip" data-d="7">7 days</button>
          </div>
          <input id="end" class="input" type="datetime-local" value="${local(inDays(3))}" min="${local(new Date(now() + 16 * 60000))}" max="${local(inDays(30))}">
          <span class="muted small">Between 15 minutes and 30 days from now. Bidding closes exactly at this time.</span></div>
        <div class="field"><label for="wa">Your WhatsApp number *</label>
          <input id="wa" class="input" type="tel" inputmode="numeric" maxlength="14" placeholder="10-digit mobile" value="${esc(p.phone || '')}">
          <span class="muted small">Shown only to the winner after the auction ends.</span></div>
        <div class="form-error" id="newErr" hidden></div>
        <button class="btn btn-primary btn-block" id="newSubmit">Start auction</button>
        <p class="muted small center">Once someone bids, the auction can't be edited or cancelled.</p>
      </form>`;

    let file = null;
    $('photo').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { toast('Please choose a photo', 'warn'); return; }
      try { file = await shrink(f); }
      catch (err) { toast('Couldn\'t read that photo — try another (JPG or PNG).', 'warn'); return; }
      $('upBox').classList.add('has-file');
      $('upText').innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview"><span class="muted small">Tap to change</span>`;
    };
    $('endChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      document.querySelectorAll('#endChips .chip').forEach(x => x.classList.toggle('active', x === c));
      $('end').value = local(inDays(Number(c.dataset.d)));
    });
    $('end').oninput = () => document.querySelectorAll('#endChips .chip').forEach(x => x.classList.remove('active'));

    $('newForm').onsubmit = async e => {
      e.preventDefault();
      const err = $('newErr'); err.hidden = true;
      const fail = m => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      const title = $('title').value.trim(), desc = $('desc').value.trim();
      const whole = id => { const v = $(id).value.trim(); return v === '' ? null : (/^\d+$/.test(v) ? Number(v) : NaN); };
      const start = whole('start'), inc = whole('inc'), bin = whole('bin');
      const endVal = $('end').value, end = endVal ? new Date(endVal) : null;
      let wa = $('wa').value.replace(/\D/g, ''); if (wa.length === 12 && wa.startsWith('91')) wa = wa.slice(2);
      if (!file) return fail('Please add a photo of the car.');
      if (title.length < 3) return fail('Please enter a title (at least 3 letters).');
      if (!start || start < 1) return fail('Starting bid must be a whole amount of at least ₹1.');
      if (!inc || inc < 1) return fail('Minimum increment must be a whole amount of at least ₹1.');
      if (Number.isNaN(bin)) return fail('Buy Now must be a whole rupee amount (or leave it empty).');
      if (bin != null && bin < start + inc) return fail(`Buy Now must be at least ${money(start + inc)} (starting bid + increment), or leave it empty.`);
      if (!end || isNaN(end)) return fail('Please choose when the auction ends.');
      if (end.getTime() < now() + 15 * 60000) return fail('End time must be at least 15 minutes from now.');
      if (end.getTime() > now() + 30 * 864e5) return fail('End time can be at most 30 days from now.');
      if (!/^[6-9]\d{9}$/.test(wa)) return fail('Please enter a valid 10-digit WhatsApp number.');

      const ok = await confirmBox('Start this auction?',
        `Starting bid ${money(start)}, +${money(inc)} per bid${bin ? `, Buy Now ${money(bin)}` : ''}.<br>Ends ${esc(fmtDate(end))}.`, 'Start auction');
      if (!ok) return;
      const btn = $('newSubmit'); btn.disabled = true; btn.textContent = 'Uploading photo…';
      const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: 'image/jpeg', upsert: false });
      if (up.error) { btn.disabled = false; btn.textContent = 'Start auction'; return fail('Photo upload failed: ' + errMsg(up.error)); }
      btn.textContent = 'Starting…';
      const { data, error } = await sb.rpc('create_auction', {
        p_title: title, p_description: desc, p_photo_path: path, p_start_price: start, p_min_increment: inc,
        p_buy_now_price: bin, p_end_time: end.toISOString(), p_whatsapp: wa });
      if (error) {
        sb.storage.from(BUCKET).remove([path]).catch(() => {});
        btn.disabled = false; btn.textContent = 'Start auction';
        return fail(errMsg(error));
      }
      toast('Your auction is live!', 'ok');
      location.href = 'auction.html?id=' + encodeURIComponent(data);
    };
  }

  // Resize to max 1600px and save as JPEG (keeps uploads small and fast)
  function shrink(f) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.86);
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(f);
    });
  }
})();
