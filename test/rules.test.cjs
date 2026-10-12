// Checks each pricing rule on small made-up examples. Run: node test/rules.test.cjs
const assert = require('node:assert/strict');
const L = require('../public/lib.js');

const asOf = Date.parse('2026-10-12T12:00:00Z');
const daysAgo = (n) => new Date(asOf - n * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const mine = { id: '1', title: 'Moen 84516 Findlay Single-Handle Bathroom Faucet Chrome', model: '84516', query: 'Moen 84516', price: 80, qty: 1, sku: '', cat: '' };
const sold = (price, ago, extra) => Object.assign({ searchQuery: 'Moen 84516', sold: true, soldDate: 'Sold  ' + daysAgo(ago), priceValue: price, title: 'MOEN 84516 Findlay Chrome Faucet', condition: 'Brand New', itemId: 's' + price + '-' + ago, sellerFeedbackPercentage: 100 }, extra);
const act = (price, extra) => Object.assign({ searchQuery: 'Moen 84516', priceValue: price, title: 'MOEN 84516 Findlay Chrome Faucet', condition: 'Brand New', itemId: 'a' + price + Math.random(), sellerFeedbackPercentage: 100 }, extra);
const run = (rows, amazon, listing) => L.buildReview([listing || mine], rows, 'sales_2_go', { asOf }, amazon)[0];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('active listings from sellers under 98% feedback are ignored', () => {
  const d = run([act(60, { sellerFeedbackPercentage: 97.9 }), act(70, { sellerFeedbackPercentage: 98 })]);
  assert.equal(d.an, 1); assert.equal(d.alo, 70); assert.equal(d.dropped.lowFeedback, 1);
});

t('shipping the buyer paid is added to sold prices', () => {
  const d = run([sold(100, 10, { shippingCost: 15 })]);
  assert.equal(d.sold[0].tot, 115); assert.equal(d.sug.price, 115); assert.equal(d.sug.rule, 'sold');
});

t('comps more than 20% off the median are dropped when a pool has 4+', () => {
  const d = run([sold(100, 50), sold(102, 50), sold(98, 50), sold(160, 50)]);
  assert.equal(d.n, 3); assert.equal(d.dropped.outliers, 1);
  const small = run([sold(100, 50), sold(102, 50), sold(160, 50)]);
  assert.equal(small.n, 3);
});

t('sales in the last 30 days count 3x', () => {
  const d = run([sold(100, 60), sold(100, 61), sold(100, 62), sold(118, 5)]);
  assert.equal(d.recentN, 1);
  assert.equal(d.med, 100); // a plain median would say 100
  assert.equal(d.sug.price, 109); // 118 counts 3x: weights 1,1,1,3 -> midpoint of 100 and 118
});

t('when every active is above every sale, go 2% under the median NEW active price', () => {
  const d = run([sold(100, 10), sold(110, 20), act(150), act(160), act(140, { condition: 'Open Box' })]);
  assert.equal(d.anewMed, 155); assert.equal(d.sug.rule, 'undercut'); assert.equal(d.sug.price, 151.9);
});

t('damaged comps are ignored unless my listing says *Read', () => {
  const rows = [sold(100, 10), sold(40, 10, { title: 'MOEN 84516 Findlay Faucet SCRATCHED read description', itemId: 'dmg' })];
  assert.equal(run(rows).n, 1);
  assert.equal(run(rows, null, Object.assign({}, mine, { title: mine.title + ' *Read' })).n, 2);
});

t('no eBay data: 10% under Amazon new price; no Amazon price: 25% under list price', () => {
  const url = L.amazonUrl('Moen 84516');
  const amz = [{ input: url, title: 'MoenFindlay Chrome Single-Handle Bathroom Faucet, 84516', price: { value: 90 }, getPriceBeforeDiscount: { value: 120 } }];
  const d = run([], amz);
  assert.equal(d.sug.rule, 'amazon'); assert.equal(d.sug.price, 81);
  const noPrice = run([], [{ input: url, title: 'Moen Findlay 84516 Faucet', price: null, getPriceBeforeDiscount: { value: 120 } }]);
  assert.equal(noPrice.sug.rule, 'retail'); assert.equal(noPrice.sug.price, 90);
  const wrongModel = run([], [{ input: url, title: 'MoenFindlay Matte Black Faucet, 84516BL', price: { value: 106 } }]);
  assert.equal(wrongModel.sug.rule, 'none');
});

t('sold comps win over Amazon when there are sales but no active listings', () => {
  const d = run([sold(70, 10)], [{ input: L.amazonUrl('Moen 84516'), title: 'Moen 84516 Faucet', price: { value: 200 } }]);
  assert.equal(d.sug.rule, 'sold'); assert.equal(d.sug.price, 70);
});

console.log(n + ' rule checks passed');
