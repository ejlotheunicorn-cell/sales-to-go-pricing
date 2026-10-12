/* Sales To Go Pricing — page logic. Matching rules live in lib.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const K = { pw: 'stg.pw', review: 'stg.review', approvals: 'stg.approvals', run: 'stg.run', settings: 'stg.settings' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const BATCH = 450;
  const DONE = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== id));
    window.scrollTo(0, 0);
  }
  function err(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
  const money = (v) => (v == null ? '—' : '$' + Number(v).toFixed(2));
  const pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ---------- server ----------
  async function api(action, opts) {
    opts = opts || {};
    const pw = store.get(K.pw, '');
    const url = '/api/apify' + (opts.params ? '?' + new URLSearchParams(Object.assign({ action }, opts.params)) : '?action=' + action);
    const res = await fetch(url, {
      method: opts.body ? 'POST' : 'GET',
      headers: Object.assign({ 'x-app-password': pw }, opts.body ? { 'content-type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(Object.assign({ action }, opts.body)) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    if (res.status === 401) { store.del(K.pw); show('gate'); err('gate-err', 'That password did not work.'); throw new Error('Wrong password.'); }
    if (!res.ok) throw new Error(data.error || 'The server answered ' + res.status + '.');
    return data;
  }

  // ---------- password ----------
  $('gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('gate-err');
    store.set(K.pw, $('pw').value);
    try { await api('ping'); $('pw').value = ''; goHome(); }
    catch (ex) { if (!/password/i.test(ex.message)) err('gate-err', ex.message); }
  });
  $('lock').addEventListener('click', () => { store.del(K.pw); show('gate'); });

  // ---------- home ----------
  function goHome() {
    const rv = store.get(K.review, null);
    $('resume').hidden = !rv;
    if (rv) $('resume-text').textContent = rv.meta.count + ' listings from ' + rv.meta.filename + ', comps pulled ' + fmtDate(rv.meta.pulledAt) + '.';
    $('running').hidden = !store.get(K.run, null);
    err('file-err');
    show('home');
  }
  $('resume-open').addEventListener('click', () => openReview());
  $('running-open').addEventListener('click', () => resumeRun());

  let fileListings = null, fileName = '';
  function loadFile(file) {
    err('file-err');
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        fileListings = STG.readEbayExport(String(r.result));
        if (!fileListings.length) throw new Error('No listings found in that file.');
        fileName = file.name;
        openPlan();
      } catch (ex) { err('file-err', ex.message); }
    };
    r.onerror = () => err('file-err', 'Could not read that file.');
    r.readAsText(file);
  }
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  // ---------- plan ----------
  function settings() {
    return {
      zero: $('opt-zero').checked, mode: $('opt-mode').value, maxItems: +$('opt-max').value,
      cap: Math.max(1, Math.min(100, +$('opt-cap').value || 15)), seller: $('opt-seller').value.trim(),
    };
  }
  function applySettings(s) {
    if (!s) return;
    $('opt-zero').checked = !!s.zero; $('opt-mode').value = s.mode || 'both'; $('opt-max').value = String(s.maxItems || 25);
    $('opt-cap').value = s.cap || 15; $('opt-seller').value = s.seller != null ? s.seller : 'sales_2_go';
  }
  let planned = null;
  function openPlan() {
    applySettings(store.get(K.settings, null));
    renderPlan();
    show('plan');
  }
  function renderPlan() {
    const s = settings();
    store.set(K.settings, s);
    const listings = STG.prepareListings(fileListings, { includeZeroQty: s.zero });
    const terms = new Map();
    listings.forEach((l) => { if (!terms.has(l.query)) terms.set(l.query, []); terms.get(l.query).push(l); });
    planned = { listings, terms: Array.from(terms.keys()) };
    $('plan-file').textContent = fileName;
    $('p-all').textContent = fileListings.length;
    $('p-check').textContent = listings.length;
    $('p-terms').textContent = terms.size;
    $('p-terms2').textContent = terms.size + ' searches';
    $('p-nomodel').textContent = listings.filter((l) => !l.model).length;
    const est = terms.size * (s.mode === 'both' ? 10 : 5) * 0.003;
    $('p-cost').textContent = '~$' + Math.max(1, Math.round(est));
    $('terms').innerHTML = Array.from(terms.entries()).map(([q, ls]) =>
      '<tr><td>' + esc(q) + '</td><td class="num">' + ls.length + '</td><td>' + esc(ls[0].title) + '</td></tr>').join('');
    $('start').disabled = !listings.length;
    const batches = Math.ceil(terms.size / BATCH);
    $('plan-note').textContent = (batches > 1 ? 'Runs in ' + batches + ' batches. ' : '') + 'A full file takes about 15–40 minutes. You can close the page; it keeps running.';
  }
  ['opt-zero', 'opt-mode', 'opt-max', 'opt-cap', 'opt-seller'].forEach((id) => $(id).addEventListener('change', renderPlan));
  $('plan-back').addEventListener('click', goHome);

  $('start').addEventListener('click', async () => {
    err('plan-err');
    if (store.get(K.run, null)) { err('plan-err', 'Another pull is still running. Open it from the first screen, or cancel it there.'); return; }
    const s = settings();
    const chunks = [];
    for (let i = 0; i < planned.terms.length; i += BATCH) chunks.push(planned.terms.slice(i, i + BATCH));
    const run = { filename: fileName, settings: s, listings: planned.listings, chunks, idx: 0, runs: [], startedAt: new Date().toISOString() };
    if (!store.set(K.run, run)) { err('plan-err', 'This browser would not save the job. Free up site storage and try again.'); return; }
    $('start').disabled = true;
    try { await startChunk(run); show('run'); poll(); }
    catch (ex) { store.del(K.run); err('plan-err', ex.message); }
    finally { $('start').disabled = false; }
  });

  // ---------- run ----------
  async function startChunk(run) {
    const capEach = Math.max(1, Math.round((run.settings.cap / run.chunks.length) * 100) / 100);
    const r = await api('start', { body: { searchQueries: run.chunks[run.idx], mode: run.settings.mode, maxItems: run.settings.maxItems, maxChargeUsd: capEach } });
    run.runs[run.idx] = { runId: r.runId, datasetId: r.datasetId };
    store.set(K.run, run);
  }
  let pollTimer = null, stopping = false;
  function resumeRun() { show('run'); poll(); }
  async function poll() {
    clearTimeout(pollTimer);
    const run = store.get(K.run, null);
    if (!run) { goHome(); return; }
    const cur = run.runs[run.idx];
    $('r-batch').textContent = (run.idx + 1) + ' of ' + run.chunks.length;
    $('r-time').textContent = Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 60000)) + ' min';
    try {
      if (!cur) { await startChunk(run); return poll(); }
      const st = await api('status', { params: { runId: cur.runId } });
      err('run-err');
      $('r-status').textContent = st.status === 'RUNNING' ? 'Searching' : st.status === 'READY' ? 'Starting' : st.status.toLowerCase();
      $('r-items').textContent = (st.itemCount == null ? '—' : st.itemCount);
      const m = /Crawled (\d+)\/(\d+) pages/.exec(st.statusMessage || '');
      const part = DONE.has(st.status) ? 1 : m ? Math.min(0.97, +m[1] / Math.max(+m[2], 1)) : 0.02;
      $('meter-fill').style.width = Math.round(((run.idx + part) / run.chunks.length) * 100) + '%';
      $('r-msg').textContent = st.statusMessage ? 'Apify: ' + st.statusMessage : '';
      if (DONE.has(st.status)) {
        if (st.status === 'FAILED') err('run-err', 'Batch ' + (run.idx + 1) + ' stopped with an error on Apify. Its results so far are kept.');
        if (!stopping && run.idx + 1 < run.chunks.length) {
          run.idx++; store.set(K.run, run);
          await startChunk(run);
          pollTimer = setTimeout(poll, 4000);
          return;
        }
        await finishRun(run);
        return;
      }
    } catch (ex) {
      err('run-err', ex.message + ' Trying again shortly.');
    }
    pollTimer = setTimeout(poll, 15000);
  }
  $('run-stop').addEventListener('click', async () => {
    const run = store.get(K.run, null); if (!run) return;
    stopping = true;
    $('run-stop').disabled = true;
    $('r-msg').textContent = 'Stopping. Collecting what has come in so far…';
    const cur = run.runs[run.idx];
    try { if (cur) await api('abort', { body: { runId: cur.runId } }); } catch { /* it may have finished already */ }
    run.chunks = run.chunks.slice(0, run.idx + 1); store.set(K.run, run);
    poll();
  });
  $('run-cancel').addEventListener('click', async () => {
    const run = store.get(K.run, null);
    const cur = run && run.runs[run.idx];
    try { if (cur) await api('abort', { body: { runId: cur.runId } }); } catch { /* ignore */ }
    clearTimeout(pollTimer);
    store.del(K.run);
    goHome();
  });

  async function finishRun(run) {
    $('r-status').textContent = 'Matching comps';
    $('r-msg').textContent = 'Downloading results and matching them to your listings…';
    const rows = [];
    for (const r of run.runs) {
      if (!r) continue;
      for (let offset = 0; ; offset += 2000) {
        const page = await api('items', { params: { datasetId: r.datasetId, offset, limit: 2000 } });
        rows.push(...page.items);
        if (page.items.length < 2000) break;
      }
    }
    const data = STG.buildReview(run.listings, rows, run.settings.seller);
    const review = { data, meta: { filename: run.filename, pulledAt: new Date().toISOString(), count: data.length, rows: rows.length, mode: run.settings.mode } };
    if (!store.set(K.review, review)) {
      err('run-err', 'The results are too large for this browser to keep. They are shown now but will be gone if you close the page.');
    }
    store.set(K.approvals, {});
    store.del(K.run);
    stopping = false;
    $('run-stop').disabled = false;
    openReview(review);
  }

  // ---------- review ----------
  let DATA = [], META = {}, byId = new Map(), approvals = {};
  let filter = 'over', term = '', sort = 'gap';
  const open = new Set();

  function openReview(review) {
    review = review || store.get(K.review, null);
    if (!review) { goHome(); return; }
    DATA = review.data; META = review.meta;
    byId = new Map(DATA.map((d) => [d.id, d]));
    approvals = store.get(K.approvals, {}) || {};
    open.clear();
    $('rv-sub').textContent = 'From ' + META.filename + ', comps pulled ' + fmtDate(META.pulledAt) + '. Each listing is compared with eBay sales of the exact model in the last 90 days. The new price starts at the median sold price; change it if you like, tick the ones to update, then download the upload file.';
    render();
    show('review');
  }
  $('rv-new').addEventListener('click', goHome);

  const saveApprovals = () => { if (!store.set(K.approvals, approvals)) setStatus('Could not save ticks in this browser.'); };
  const suggested = (d) => (d.med != null ? d.med : null);
  function newPrice(d) {
    const a = approvals[d.id];
    if (a && typeof a.price === 'number') return a.price;
    return suggested(d) != null ? suggested(d) : d.price;
  }
  const gap = (d) => (d.med ? d.price / d.med - 1 : null);
  const isOk = (d) => !!(approvals[d.id] && approvals[d.id].ok);
  function bucket(d) {
    const g = gap(d);
    if (g == null) return 'nosales';
    if (g > 0.15) return 'over';
    if (g < -0.15) return 'under';
    return 'near';
  }
  const matches = (d, f) => (f === 'all' ? true : f === 'ok' ? isOk(d) : bucket(d) === f);

  function confidence(d) {
    if (!d.n) return d.an ? '<span class="pill warn">No sales</span>' : '<span class="pill warn">No data</span>';
    if (d.n < 3) return '<span class="pill warn">' + d.n + ' sale' + (d.n > 1 ? 's' : '') + '</span>';
    return '<span class="pill flat">' + d.n + ' sales</span>';
  }
  function changePill(d) {
    const ch = newPrice(d) / d.price - 1;
    if (!isFinite(ch) || Math.abs(ch) < 0.005) return '<span class="pill flat">no change</span>';
    return '<span class="pill ' + (ch < 0 ? 'cut' : 'raise') + '">' + pct(ch) + '</span>';
  }
  const soldUrl = (d) => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(d.query) + '&LH_Sold=1&LH_Complete=1&_ipg=120';

  function rowHtml(d) {
    const g = gap(d);
    const gp = g == null ? '' : '<span class="pill ' + (g > 0.15 ? 'cut' : g < -0.15 ? 'raise' : 'flat') + '">' + pct(g) + ' vs median</span>';
    const np = newPrice(d);
    let h = '<div class="row' + (isOk(d) ? ' on' : '') + '" role="listitem" data-id="' + esc(d.id) + '">';
    h += '<input type="checkbox" id="ok-' + esc(d.id) + '" aria-label="Update this listing"' + (isOk(d) ? ' checked' : '') + '>';
    h += '<div class="t"><a href="' + esc(soldUrl(d)) + '" target="_blank" rel="noopener">' + esc(d.title) + '</a>';
    h += '<div class="meta"><span>' + esc(d.model || 'no model #') + '</span>' + (d.sku ? '<span>SKU ' + esc(d.sku) + '</span>' : '') + '<span>Qty ' + d.qty + '</span>';
    h += '<span class="mob num">Yours ' + money(d.price) + '</span>';
    h += (d.n || d.an) ? '<button type="button" data-act="comps">' + (open.has(d.id) ? 'Hide comps' : 'Show comps') + '</button>' : '';
    h += '</div></div>';
    h += '<div class="cell yours"><span class="num">' + money(d.price) + '</span>' + gp + '</div>';
    h += '<div class="cell sold"><span class="num">' + money(d.med) + '</span><span class="s">' + confidence(d) + (d.n ? ' ' + money(d.lo) + '–' + money(d.hi) : '') + '</span><span class="mob">' + gp + '</span></div>';
    h += '<div class="cell active"><span class="num">' + money(d.alo) + '</span><span class="s">' + (d.an ? d.an + ' listed' : '') + '</span></div>';
    h += '<div class="newp"><label>$<input type="number" step="0.01" min="0.99" inputmode="decimal" id="np-' + esc(d.id) + '" value="' + np.toFixed(2) + '" aria-label="New price"></label>' + changePill(d) + '</div>';
    if (open.has(d.id)) h += compsHtml(d);
    return h + '</div>';
  }
  function compsHtml(d) {
    let h = '<div class="comps">';
    h += '<div><h4>Sold, last 90 days</h4>' + (d.sold.length ? '<table>' + d.sold.map((c) =>
      '<tr><td class="d">' + esc(c.d || '') + '</td><td><a href="https://www.ebay.com/itm/' + esc(c.id) + '" target="_blank" rel="noopener">' + esc(c.t) + '</a> <span class="note">' + esc(c.c) + (c.bo ? ' · best offer' : '') + '</span></td><td class="p">' + money(c.p) + '</td></tr>').join('') + '</table>' : '<p class="note">None found.</p>') + '</div>';
    h += '<div><h4>Active now, lowest first</h4>' + (d.active.length ? '<table>' + d.active.map((c) =>
      '<tr><td><a href="https://www.ebay.com/itm/' + esc(c.id) + '" target="_blank" rel="noopener">' + esc(c.t) + '</a> <span class="note">' + esc(c.c) + '</span></td><td class="p">' + money(c.p) + '</td></tr>').join('') + '</table>' : '<p class="note">' + (META.mode === 'sold' ? 'Not pulled (sold-only run).' : 'None found.') + '</p>') + '</div>';
    return h + '</div>';
  }

  function visible() {
    let v = DATA.filter((d) => matches(d, filter));
    if (term) { const t = term.toLowerCase(); v = v.filter((d) => (d.title + ' ' + d.model + ' ' + d.sku).toLowerCase().includes(t)); }
    const key = {
      gap: (d) => -Math.abs(gap(d) == null ? -1e9 : gap(d)),
      value: (d) => -Math.abs((d.med != null ? d.price - d.med : 0) * d.qty),
      price: (d) => -d.price, sales: (d) => -d.n,
    }[sort];
    if (sort === 'title') v.sort((a, b) => a.title.localeCompare(b.title));
    else v.sort((a, b) => key(a) - key(b));
    return v;
  }
  function render() {
    const list = $('list');
    const head = list.firstElementChild;
    const v = visible();
    list.innerHTML = '';
    list.appendChild(head);
    if (!v.length) {
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = filter === 'ok' ? 'Nothing ticked yet. Tick a listing to add it to the upload file.' : 'No listings match.';
      list.appendChild(e);
    } else list.insertAdjacentHTML('beforeend', v.map(rowHtml).join(''));
    renderCounts();
  }
  function renderCounts() {
    const counts = { over: 0, under: 0, near: 0, nosales: 0, ok: 0, all: DATA.length };
    DATA.forEach((d) => { counts[bucket(d)]++; if (isOk(d)) counts.ok++; });
    document.querySelectorAll('#review .chip').forEach((c) => {
      c.setAttribute('aria-pressed', String(c.dataset.f === filter));
      c.querySelector('.c').textContent = counts[c.dataset.f];
    });
    $('s-total').textContent = DATA.length;
    $('s-sales').textContent = DATA.filter((d) => d.n).length;
    $('s-over').textContent = counts.over;
    $('s-ok').textContent = counts.ok;
    let delta = 0; DATA.forEach((d) => { if (isOk(d)) delta += (newPrice(d) - d.price) * d.qty; });
    $('s-delta').textContent = (delta < 0 ? '−$' : '+$') + Math.abs(delta).toFixed(0);
    $('export').disabled = counts.ok === 0;
    $('export').textContent = counts.ok ? 'Download eBay upload file (' + counts.ok + ')' : 'Download eBay upload file';
    setStatus();
  }
  function setStatus(msg) { $('status').textContent = msg || 'Ticks and prices save in this browser.'; }
  function refreshRow(id) {
    const el = document.querySelector('.row[data-id="' + CSS.escape(id) + '"]');
    if (el) el.outerHTML = rowHtml(byId.get(id));
    renderCounts();
  }

  $('list').addEventListener('change', (e) => {
    const row = e.target.closest('.row[data-id]'); if (!row) return;
    const d = byId.get(row.dataset.id);
    if (e.target.type === 'checkbox') {
      approvals[d.id] = { ok: e.target.checked, price: newPrice(d) };
    } else if (e.target.type === 'number') {
      const v = Math.round(parseFloat(e.target.value) * 100) / 100;
      if (!(v > 0)) { e.target.value = newPrice(d).toFixed(2); return; }
      approvals[d.id] = { ok: isOk(d), price: v };
    } else return;
    saveApprovals(); refreshRow(d.id);
  });
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act="comps"]'); if (!b) return;
    const id = b.closest('.row').dataset.id;
    open.has(id) ? open.delete(id) : open.add(id);
    refreshRow(id);
  });
  document.querySelectorAll('#review .chip').forEach((c) => c.addEventListener('click', () => { filter = c.dataset.f; render(); }));
  $('q').addEventListener('input', (e) => { term = e.target.value.trim(); render(); });
  $('sort').addEventListener('change', (e) => { sort = e.target.value; render(); });
  $('tick-view').addEventListener('click', () => {
    visible().filter((d) => d.n >= 3 && !isOk(d)).forEach((d) => { approvals[d.id] = { ok: true, price: newPrice(d) }; });
    saveApprovals(); render();
  });
  $('untick-view').addEventListener('click', () => {
    visible().filter(isOk).forEach((d) => { approvals[d.id] = { ok: false, price: newPrice(d) }; });
    saveApprovals(); render();
  });
  $('export').addEventListener('click', () => {
    const rows = DATA.filter(isOk);
    const blob = new Blob([STG.reviseCSV(rows, newPrice)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ebay-price-revise-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus('Downloaded the upload file with ' + rows.length + ' listings. Upload it in Seller Hub > Reports > Uploads.');
  });

  // ---------- start ----------
  (async function init() {
    if (!store.get(K.pw, '')) { show('gate'); return; }
    try { await api('ping'); } catch (ex) { if (!/password/i.test(ex.message)) { show('gate'); err('gate-err', ex.message); } return; }
    if (store.get(K.run, null)) { resumeRun(); return; }
    if (store.get(K.review, null)) { openReview(); return; }
    goHome();
  })();
})();
