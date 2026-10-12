// Server side of Sales To Go Pricing. Keeps the Apify token off the page.
// Settings (Netlify > Site configuration > Environment variables):
//   APIFY_TOKEN   — Apify Console > Settings > Integrations > Personal API token
//   APP_PASSWORD  — the password people type to use the app

const ACTOR = 'memo23~ebay-search-scraper-ppe';
const API = 'https://api.apify.com/v2';
const MAX_TERMS = 450; // the scraper accepts at most 500 search terms per run
const ITEM_FIELDS = 'searchQuery,sold,soldDate,priceValue,title,sellerUsername,bestOfferAccepted,condition,itemId';

const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function apify(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: 'Bearer ' + env('APIFY_TOKEN'), 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || ('Apify answered ' + res.status);
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return body;
}

export default async (req) => {
  if (!env('APP_PASSWORD') || !env('APIFY_TOKEN')) {
    return json(500, { error: 'The app is not set up yet: add APIFY_TOKEN and APP_PASSWORD in Netlify environment variables, then redeploy.' });
  }
  if (!timingSafeEqual(req.headers.get('x-app-password') || '', env('APP_PASSWORD'))) {
    return json(401, { error: 'Wrong password.' });
  }
  const url = new URL(req.url);
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  const action = body.action || url.searchParams.get('action');

  try {
    if (action === 'ping') return json(200, { ok: true });

    if (action === 'start') {
      const terms = Array.isArray(body.searchQueries) ? body.searchQueries.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
      if (!terms.length) return json(400, { error: 'No search terms were sent.' });
      if (terms.length > MAX_TERMS) return json(400, { error: 'At most ' + MAX_TERMS + ' search terms per run.' });
      const mode = ['sold', 'both'].includes(body.mode) ? body.mode : 'both';
      const maxItems = Math.min(Math.max(parseInt(body.maxItems, 10) || 25, 5), 60);
      const cap = Math.min(Math.max(Number(body.maxChargeUsd) || 10, 1), 100);
      const input = {
        searchQueries: terms, marketplace: 'ebay.com', mode, soldWithinDays: 90,
        titleMustMatchQuery: true, detailedItems: false, includeSummary: false, includeLegacyFields: false,
        maxItems, maxConcurrency: 3,
      };
      const run = await apify('/acts/' + ACTOR + '/runs?maxTotalChargeUsd=' + cap, { method: 'POST', body: JSON.stringify(input) });
      return json(200, { runId: run.data.id, datasetId: run.data.defaultDatasetId, status: run.data.status });
    }

    if (action === 'status') {
      const runId = url.searchParams.get('runId') || body.runId;
      if (!/^[A-Za-z0-9]{8,32}$/.test(runId || '')) return json(400, { error: 'Bad run id.' });
      const run = (await apify('/actor-runs/' + runId)).data;
      let itemCount = null;
      try { itemCount = (await apify('/datasets/' + run.defaultDatasetId)).data.itemCount; } catch { /* ignore */ }
      return json(200, {
        status: run.status, statusMessage: run.statusMessage || '', datasetId: run.defaultDatasetId,
        itemCount,
        startedAt: run.startedAt, finishedAt: run.finishedAt,
      });
    }

    if (action === 'items') {
      const ds = url.searchParams.get('datasetId');
      if (!/^[A-Za-z0-9]{8,32}$/.test(ds || '')) return json(400, { error: 'Bad dataset id.' });
      const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 2000, 1), 5000);
      const items = await apify('/datasets/' + ds + '/items?clean=true&format=json&fields=' + ITEM_FIELDS + '&offset=' + offset + '&limit=' + limit);
      return json(200, { items: Array.isArray(items) ? items : [], offset, limit });
    }

    if (action === 'abort') {
      const runId = body.runId;
      if (!/^[A-Za-z0-9]{8,32}$/.test(runId || '')) return json(400, { error: 'Bad run id.' });
      const run = (await apify('/actor-runs/' + runId + '/abort?gracefully=true', { method: 'POST' })).data;
      return json(200, { status: run.status });
    }

    return json(400, { error: 'Unknown action.' });
  } catch (e) {
    const s = e.status === 401 ? 'Apify rejected the API token. Check APIFY_TOKEN in Netlify.' :
      e.status === 402 || /usage|billing|limit/i.test(e.message) ? 'Apify says the account is out of credit: ' + e.message : e.message;
    return json(502, { error: s });
  }
};

export const config = { path: '/api/apify' };
