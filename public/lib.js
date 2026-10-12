/* Sales To Go pricing — matching and pricing logic.
   Shared by the browser app and the Node tests (no dependencies). */
(function (root) {
  'use strict';

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function csvCell(s) {
    s = s == null ? '' : String(s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Reads eBay's "edit price & quantity" download (or any export with the same headers).
  function readEbayExport(text) {
    const rows = parseCSV(text);
    const hi = rows.findIndex((r) => r.some((c) => /^item number$/i.test(c.trim())));
    if (hi < 0) throw new Error('This file has no "Item number" column. Download it from Seller Hub > Listings > Active > Edit price & quantity, or the Reports download.');
    const head = rows[hi].map((c) => c.trim().toLowerCase());
    const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
    const c = {
      id: col('item number'), title: col('title'), cat: col('category name'),
      start: col('start price', 'price'), bin: col('buy it now price'),
      qty: col('available quantity', 'quantity'), sku: col('custom label (sku)', 'custom label', 'sku'),
    };
    if (c.title < 0) throw new Error('This file has no "Title" column.');
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      const id = (r[c.id] || '').trim();
      if (!/^\d{6,}$/.test(id)) continue;
      const price = parseFloat(r[c.start]) || parseFloat(r[c.bin]) || 0;
      out.push({
        id, title: (r[c.title] || '').trim(), cat: c.cat >= 0 ? (r[c.cat] || '').trim() : '',
        price, qty: parseInt(r[c.qty], 10) || 0, sku: c.sku >= 0 ? (r[c.sku] || '').trim() : '',
      });
    }
    return out;
  }

  // ---------- model numbers and search terms ----------
  const BAD = /^(\d{1,3}|\d+\.\d+|\d+(\.\d+)?(GPM|IN|FT|MM|PSI|IN\.)|\d+-\d+\/\d+|\d+\/\d+|M-?CORE|\d+-(PACK|PK|FUNCTION|SPRAY|HANDLE|HOLE|LIGHT|SETTING|IN)S?|[A-Z]+)$/;

  function extractModel(title) {
    const toks = (title || '').match(/[A-Za-z0-9][A-Za-z0-9\-.]*[A-Za-z0-9]/g) || [];
    let best = null;
    for (const x of toks) {
      const u = x.toUpperCase().replace(/^[.\-]+|[.\-]+$/g, '');
      if (BAD.test(u)) continue;
      const d = (u.match(/\d/g) || []).length;
      if (d < 3) continue;
      if (/^\d+(\.\d+)?$/.test(u) && u.length < 4) continue;
      const score = d + (/[A-Z]/.test(u) ? 3 : 0) + (u.length >= 5 ? 1 : 0);
      if (!best || score > best.score || (score === best.score && u > best.u)) best = { score, u };
    }
    if (best) return best.u;
    // fallback: letter+digit codes with only two digits (PYOS-22, PFSH83BN)
    for (const x of toks) {
      const u = x.toUpperCase().replace(/^[.\-]+|[.\-]+$/g, '');
      const d = (u.match(/\d/g) || []).length;
      if (BAD.test(u) || d < 2 || u.length < 5 || !/[A-Z]/.test(u) || /^\d+-[A-Z]+$/.test(u)) continue;
      if (!best || d > best.d) best = { d, u };
    }
    return best ? best.u : '';
  }

  const NOT_BRAND = new Set(['new', 'sealed', 'nib', 'open', 'box', 'lot', 'of', 'pack', 'pk', 'pcs', 'set', 'read', 'used', 'brand', 'genuine', 'oem', 'the']);
  function brandOf(title) {
    const t = (title || '').toLowerCase();
    if (/\bmoen\b/.test(t)) return 'Moen';
    // only trust the first word as a brand (skipping "New", "Sealed" and the like)
    const words = (title || '').split(/\s+/).filter(Boolean);
    for (const w of words) {
      const clean = w.replace(/[’'`]s$/i, '').replace(/[^A-Za-z]/g, '');
      if (NOT_BRAND.has(clean.toLowerCase())) continue;
      if (!/^[A-Za-z][A-Za-z’'`.&-]*$/.test(w) || clean.length < 3) return '';
      return clean[0].toUpperCase() + clean.slice(1).toLowerCase();
    }
    return '';
  }

  const FILLER = new Set(['new', 'read', 'see', 'description', 'photos', 'with', 'and', 'the', 'in', 'for', 'of', 'w', 'only', 'nib', 'sealed', 'open', 'box']);
  function searchTerm(listing) {
    const model = listing.model;
    if (model) {
      if (/[A-Z]/.test(model) && model.length >= 5) return model;
      return (brandOf(listing.title) + ' ' + model).trim();
    }
    const words = listing.title.replace(/[^A-Za-z0-9\- ]/g, ' ').split(/\s+/).map((w) => w.replace(/^-+|-+$/g, '')).filter((w) => w.length > 1 && /^[A-Za-z]/.test(w) && !FILLER.has(w.toLowerCase()));
    return words.slice(0, 4).join(' ');
  }

  function prepareListings(listings, opts) {
    opts = opts || {};
    return listings
      .filter((l) => opts.includeZeroQty || l.qty > 0)
      .map((l) => {
        const model = l.model != null ? l.model : extractModel(l.title);
        const out = Object.assign({}, l, { model });
        out.query = l.query || searchTerm(out);
        return out;
      });
  }

  // ---------- comps ----------
  const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  const ACCESSORY = /\b(ac adapter|power adapter|adapter for|hose weight|compatible|fits|replacement (?:handle|cartridge|part)s?|for moen)\b/i;
  const LOT = /\blot of\b|\b\d+\s?(pk|pack|pcs)\b/i;
  const PART_WORDS = /\b(aerator|handle kit|cartridge|escutcheon|knob|o-ring|seal kit|repair kit|hose weight|wand only|sprayer only)\b/;
  const PART_WORDS_OWN = /\b(aerator|handle|cartridge|escutcheon|knob|o-ring|seal|repair|hose weight|wand|sprayer only)\b/;
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  function parseSoldDate(s) {
    const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(s || '');
    if (!m || !(m[1] in MONTHS)) return null;
    const d = new Date(Date.UTC(+m[3], MONTHS[m[1]], +m[2]));
    return d.toISOString().slice(0, 10);
  }
  function median(v) {
    if (!v.length) return null;
    const s = v.slice().sort((a, b) => a - b), h = s.length >> 1;
    return Math.round((s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) * 100) / 100;
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Joel's pricing rules. Change the numbers here to tune them.
  const RULES = {
    feedbackMin: 98,      // ignore active listings from sellers under this % positive feedback
    band: 0.20,           // ignore comps more than 20% above or below the median...
    bandMin: 4,           // ...when a pool (sold or active) has at least this many comps
    recentDays: 30,       // sales this recent...
    recentWeight: 3,      // ...count this many times as much as older ones (31-90 days)
    undercut: 0.02,       // when every active price is above every sold price: this much under the median NEW active price
    amazonOff: 0.10,      // no eBay data: this much under Amazon's new price
    retailOff: 0.25,      // nothing on Amazon: this much under retail (Amazon list price)
  };
  const DAMAGE = /\b(read|scratch(?:es|ed)?|scuff(?:s|ed)?|defect(?:s|ive)?|damaged?|dent(?:s|ed)?|crack(?:s|ed)?|broken|chip(?:s|ped)?|as[- ]is)\b/;
  const OWN_READ = /\bread\b/i;
  const r2 = (v) => Math.round(v * 100) / 100;

  // Weighted median: each value counts `w` times.
  function weightedMedian(items) {
    if (!items.length) return null;
    const s = items.slice().sort((a, b) => a.v - b.v);
    const total = s.reduce((t, x) => t + x.w, 0);
    let acc = 0;
    for (let i = 0; i < s.length; i++) {
      acc += s[i].w;
      if (acc > total / 2) return r2(s[i].v);
      if (acc === total / 2) return r2((s[i].v + s[i + 1].v) / 2);
    }
    return r2(s[s.length - 1].v);
  }

  function matcher(listing) {
    const ownTitle = listing.title, ownL = ownTitle.toLowerCase();
    const brand = /moen/i.test(ownTitle) ? 'moen' : (brandOf(ownTitle) || '').toLowerCase();
    const mnorm = listing.model ? norm(listing.model).replace(/ /g, '') : '';
    const pat = mnorm ? new RegExp('(^|[^A-Z0-9])' + escRe(mnorm) + '([^A-Z0-9]|$)') : null;
    const forPat = mnorm ? new RegExp('\\b(for|fits|compatible with)\\b[^|]{0,60}' + escRe(mnorm.toLowerCase())) : null;
    const ownHasValve = /\b(w\/ ?valve|with (rough[- ]in )?valve|valve included|w\/ rough)/.test(ownL);
    const ownIsRead = OWN_READ.test(ownTitle);
    // true when a comp's title describes the same item in comparable shape
    return function sameItem(t) {
      const tl = t.toLowerCase();
      if (pat && !pat.test(norm(t))) return false;
      if (brand.length > 2 && !tl.replace(/[^a-z]/g, '').includes(brand.replace(/[^a-z]/g, ''))) return false;
      if (LOT.test(t) && !LOT.test(ownTitle)) return false;
      if (ACCESSORY.test(t) && !ACCESSORY.test(ownTitle)) return false;
      if (forPat && forPat.test(tl.replace(/[^a-z0-9 ]/g, ''))) return false;
      if (PART_WORDS.test(tl) && !PART_WORDS_OWN.test(ownL)) return false;
      if (/\bused\b/.test(tl)) return false;
      if (DAMAGE.test(tl) && !ownIsRead) return false;
      if (ownHasValve && /no valve|valve (not included|required|sold separately)|trim only/.test(tl)) return false;
      return true;
    };
  }

  function compsFor(listing, rows, seller, opts) {
    const R = Object.assign({}, RULES, opts && opts.rules);
    const asOf = (opts && opts.asOf) || Date.now();
    const sameItem = matcher(listing);
    const me = (seller || '').toLowerCase();
    const sold = [], active = [];
    const seen = { s: new Set(), a: new Set() };
    let lowFeedback = 0;
    for (const x of rows) {
      const t = x.title || '';
      if (me && (x.sellerUsername || '').toLowerCase() === me) continue;
      if (!sameItem(t)) continue;
      const cond = (x.condition || '').toLowerCase();
      if (cond.includes('part') || cond.includes('pre-owned') || cond.includes('used')) continue;
      const p = x.priceValue;
      if (typeof p !== 'number' || !(p > 0)) continue;
      if (!x.sold && typeof x.sellerFeedbackPercentage === 'number' && x.sellerFeedbackPercentage < R.feedbackMin) { lowFeedback++; continue; }
      const key = x.sold ? 's' : 'a';
      if (seen[key].has(x.itemId)) continue;
      seen[key].add(x.itemId);
      const ship = typeof x.shippingCost === 'number' && x.shippingCost > 0 ? x.shippingCost : 0;
      const c = { p: r2(p), s: r2(ship), tot: r2(p + ship), t: t.slice(0, 90), c: x.condition || '', id: x.itemId,
        isNew: /\bnew\b/i.test(x.condition || '') && !/other|defect/i.test(x.condition || '') };
      if (x.sold) {
        c.d = parseSoldDate(x.soldDate);
        c.bo = !!x.bestOfferAccepted;
        c.recent = !!c.d && (asOf - Date.parse(c.d)) / 864e5 <= R.recentDays;
        sold.push(c);
      } else active.push(c);
    }
    // drop comps more than 20% from the median when a pool is big enough
    let outliers = 0;
    const band = (lst) => {
      if (lst.length < R.bandMin) return lst;
      const m = median(lst.map((c) => c.tot));
      const keep = lst.filter((c) => c.tot >= m * (1 - R.band) && c.tot <= m * (1 + R.band));
      outliers += lst.length - keep.length;
      return keep;
    };
    const S = band(sold).sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    const A = band(active).sort((a, b) => a.tot - b.tot);
    const st = S.map((c) => c.tot), at = A.map((c) => c.tot);
    const newActive = A.filter((c) => c.isNew).map((c) => c.tot);
    return {
      n: st.length, recentN: S.filter((c) => c.recent).length,
      med: median(st), wmed: weightedMedian(S.map((c) => ({ v: c.tot, w: c.recent ? R.recentWeight : 1 }))),
      lo: st.length ? Math.min(...st) : null, hi: st.length ? Math.max(...st) : null,
      last: S.reduce((m, c) => (c.d && (!m || c.d > m) ? c.d : m), null),
      bo: S.filter((c) => c.bo).length,
      an: at.length, alo: at.length ? Math.min(...at) : null, ahi: at.length ? Math.max(...at) : null,
      amed: median(at), anewMed: median(newActive), anewN: newActive.length,
      dropped: { outliers, lowFeedback },
      sold: S.slice(0, 25), active: A.slice(0, 10),
    };
  }

  // ---------- Amazon (only for listings with no eBay comps) ----------
  const amazonUrl = (q) => 'https://www.amazon.com/s?k=' + encodeURIComponent(q).replace(/%20/g, '+');
  function amazonFor(listing, rows) {
    const sameItem = matcher(listing);
    const hits = rows.filter((x) => x && sameItem(x.title || ''));
    const priced = hits.filter((x) => x.price && typeof x.price.value === 'number' && x.price.value > 0);
    const lists = hits.map((x) => x.getPriceBeforeDiscount && x.getPriceBeforeDiscount.value).filter((v) => typeof v === 'number' && v > 0);
    const best = priced.sort((a, b) => a.price.value - b.price.value)[0];
    if (!best && !lists.length) return hits.length ? { price: null, list: null, n: hits.length } : null;
    return {
      price: best ? r2(best.price.value) : null,
      list: lists.length ? r2(Math.max(...lists)) : null,
      title: best ? (best.title || '').slice(0, 110) : (hits[0].title || '').slice(0, 110),
      asin: best ? best.asin : hits[0].asin, n: hits.length,
    };
  }

  // ---------- the suggestion ----------
  function suggest(d, opts) {
    const R = Object.assign({}, RULES, opts && opts.rules);
    if (d.n) {
      if (d.an && d.alo > d.hi) {
        const base = d.anewMed != null ? d.anewMed : d.amed;
        return { price: r2(base * (1 - R.undercut)), rule: 'undercut',
          why: 'Every active listing is above every sale, so ' + Math.round(R.undercut * 100) + '% under the median ' + (d.anewMed != null ? 'new ' : '') + 'active price' };
      }
      return { price: d.wmed, rule: 'sold',
        why: d.recentN ? 'Median of ' + d.n + ' sales (incl. shipping), last-' + R.recentDays + '-day sales counted ' + R.recentWeight + '×' : 'Median of ' + d.n + ' sales (incl. shipping), none in the last ' + R.recentDays + ' days' };
    }
    if (d.an) {
      const base = d.anewMed != null ? d.anewMed : d.amed;
      return { price: r2(base * (1 - R.undercut)), rule: 'active', why: 'No sales in 90 days; ' + Math.round(R.undercut * 100) + '% under the median ' + (d.anewMed != null ? 'new ' : '') + 'active price' };
    }
    if (d.amz && d.amz.price) return { price: r2(d.amz.price * (1 - R.amazonOff)), rule: 'amazon', why: 'Nothing on eBay; ' + Math.round(R.amazonOff * 100) + '% under Amazon new price' };
    if (d.amz && d.amz.list) return { price: r2(d.amz.list * (1 - R.retailOff)), rule: 'retail', why: 'Nothing on eBay or for sale on Amazon; ' + Math.round(R.retailOff * 100) + '% under retail (Amazon list price)' };
    return { price: null, rule: 'none', why: 'No eBay comps and no Amazon match' };
  }

  function buildReview(listings, rows, seller, opts, amazonRows) {
    opts = Object.assign({ asOf: Date.now() }, opts);
    const byQ = new Map();
    for (const x of rows) {
      if (!byQ.has(x.searchQuery)) byQ.set(x.searchQuery, []);
      byQ.get(x.searchQuery).push(x);
    }
    const byUrl = new Map();
    for (const x of amazonRows || []) {
      const k = x.input || x.searchUrl || '';
      if (!byUrl.has(k)) byUrl.set(k, []);
      byUrl.get(k).push(x);
    }
    return listings.map((l) => {
      const d = Object.assign(
        { id: l.id, title: l.title, model: l.model, query: l.query, sku: l.sku, qty: l.qty, price: l.price, cat: l.cat },
        compsFor(l, byQ.get(l.query) || [], seller, opts));
      if (amazonRows) d.amz = amazonFor(l, byUrl.get(amazonUrl(l.query)) || []);
      d.sug = suggest(d, opts);
      return d;
    });
  }

  // Listings with nothing usable on eBay: these get an Amazon lookup.
  function needsAmazon(review) {
    return review.filter((d) => !d.n && !d.an);
  }

  function reviseCSV(items, priceOf) {
    const lines = [
      '#INFO,Version=1.0.0,Template= eBay-active-revise-price-quantity-download_US,,,,,,,,,',
      'Action,Category name,Item number,Title,Listing site,Currency,Start price,Buy It Now price,Available quantity,Relationship,Relationship details,Custom label (SKU)',
    ];
    items.forEach((d) => lines.push(['Revise', d.cat, d.id, d.title, 'US', 'USD', priceOf(d).toFixed(2), '', '', '', '', d.sku].map(csvCell).join(',')));
    return lines.join('\r\n') + '\r\n';
  }

  const api = { RULES, parseCSV, csvCell, readEbayExport, extractModel, brandOf, searchTerm, prepareListings, compsFor, buildReview, suggest, needsAmazon, amazonUrl, amazonFor, weightedMedian, reviseCSV, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.STG = api;
})(typeof window !== 'undefined' ? window : globalThis);
