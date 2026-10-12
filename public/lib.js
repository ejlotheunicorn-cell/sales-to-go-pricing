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

  function compsFor(listing, rows, seller) {
    const ownTitle = listing.title, ownL = ownTitle.toLowerCase();
    const brand = /moen/i.test(ownTitle) ? 'moen' : (brandOf(ownTitle) || '').toLowerCase();
    const ownHasValve = /\b(w\/ ?valve|with (rough[- ]in )?valve|valve included|w\/ rough)/.test(ownL);
    const mnorm = listing.model ? norm(listing.model).replace(/ /g, '') : '';
    const pat = mnorm ? new RegExp('(^|[^A-Z0-9])' + escRe(mnorm) + '([^A-Z0-9]|$)') : null;
    const forPat = mnorm ? new RegExp('\\b(for|fits|compatible with)\\b[^|]{0,60}' + escRe(mnorm.toLowerCase())) : null;
    const me = (seller || '').toLowerCase();
    const sold = [], active = [];
    for (const x of rows) {
      const t = x.title || '', tl = t.toLowerCase();
      if (me && (x.sellerUsername || '').toLowerCase() === me) continue;
      if (pat && !pat.test(norm(t))) continue;
      if (brand.length > 2 && !tl.replace(/[^a-z]/g, '').includes(brand.replace(/[^a-z]/g, ''))) continue;
      if (LOT.test(t) && !LOT.test(ownTitle)) continue;
      if (ACCESSORY.test(t) && !ACCESSORY.test(ownTitle)) continue;
      if (forPat && forPat.test(tl.replace(/[^a-z0-9 ]/g, ''))) continue;
      if (PART_WORDS.test(tl) && !PART_WORDS_OWN.test(ownL)) continue;
      const cond = (x.condition || '').toLowerCase();
      if (cond.includes('part') || cond.includes('pre-owned') || cond.includes('used') || /\bused\b/.test(tl)) continue;
      if (ownHasValve && /no valve|valve (not included|required|sold separately)|trim only/.test(tl)) continue;
      const p = x.priceValue;
      if (typeof p !== 'number' || !(p > 0)) continue;
      const c = { p: Math.round(p * 100) / 100, t: t.slice(0, 90), c: x.condition || '', id: x.itemId };
      if (x.sold) { c.d = parseSoldDate(x.soldDate); c.bo = !!x.bestOfferAccepted; sold.push(c); }
      else active.push(c);
    }
    for (const lst of [sold, active]) {
      if (lst.length >= 3) {
        const m = median(lst.map((c) => c.p));
        const keep = lst.filter((c) => c.p >= 0.35 * m);
        lst.length = 0; keep.forEach((c) => lst.push(c));
      }
    }
    // one comp per eBay item (a listing can show in both sold and active, or twice)
    const dedupe = (lst) => { const seen = new Set(); return lst.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))); };
    const S = dedupe(sold).sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    const A = dedupe(active).sort((a, b) => a.p - b.p);
    const sp = S.map((c) => c.p), ap = A.map((c) => c.p);
    return {
      n: sp.length, med: median(sp), lo: sp.length ? Math.min(...sp) : null, hi: sp.length ? Math.max(...sp) : null,
      last: S.reduce((m, c) => (c.d && (!m || c.d > m) ? c.d : m), null),
      bo: S.filter((c) => c.bo).length,
      an: ap.length, alo: ap.length ? Math.min(...ap) : null, amed: median(ap),
      sold: S.slice(0, 25), active: A.slice(0, 10),
    };
  }

  function buildReview(listings, rows, seller) {
    const byQ = new Map();
    const seen = new Set();
    for (const x of rows) {
      const key = x.searchQuery + '|' + x.itemId + '|' + (x.sold ? 1 : 0);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byQ.has(x.searchQuery)) byQ.set(x.searchQuery, []);
      byQ.get(x.searchQuery).push(x);
    }
    return listings.map((l) => Object.assign(
      { id: l.id, title: l.title, model: l.model, query: l.query, sku: l.sku, qty: l.qty, price: l.price, cat: l.cat },
      compsFor(l, byQ.get(l.query) || [], seller)));
  }

  function reviseCSV(items, priceOf) {
    const lines = [
      '#INFO,Version=1.0.0,Template= eBay-active-revise-price-quantity-download_US,,,,,,,,,',
      'Action,Category name,Item number,Title,Listing site,Currency,Start price,Buy It Now price,Available quantity,Relationship,Relationship details,Custom label (SKU)',
    ];
    items.forEach((d) => lines.push(['Revise', d.cat, d.id, d.title, 'US', 'USD', priceOf(d).toFixed(2), '', '', '', '', d.sku].map(csvCell).join(',')));
    return lines.join('\r\n') + '\r\n';
  }

  const api = { parseCSV, csvCell, readEbayExport, extractModel, brandOf, searchTerm, prepareListings, compsFor, buildReview, reviseCSV, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.STG = api;
})(typeof window !== 'undefined' ? window : globalThis);
