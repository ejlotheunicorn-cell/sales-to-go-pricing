# Sales To Go Pricing

Upload your eBay **price & quantity** file, pull the last 90 days of eBay sold prices (and current active listings) for every model through Apify, compare them with your prices, tick the ones to change, and download an eBay **revise** file to upload in Seller Hub.

## How it works

1. **Upload.** Seller Hub → Listings → Active → *Edit price & quantity* → Download (or Reports → Downloads). Drop that CSV on the first screen.
2. **Pull comps.** The app finds each listing's model number and searches eBay through Apify (scraper: `memo23/ebay-search-scraper-ppe`). It runs on Apify's servers, so you can close the page and come back. A full file of ~600 listings takes about 15–40 minutes and roughly $5–15 of Apify credit; the spending cap you set is a hard limit. Listings with nothing on eBay then get an Amazon lookup (about 2½¢ each, scraper `junglee/Amazon-crawler`).
3. **Review.** Every listing shows your price, the median sold price, the lowest active price and a suggested new price (the median sold). *Show comps* lists the actual sales and listings behind each number with links to eBay.
4. **Download the upload file.** Only ticked listings go in it, and only the price changes; quantity is left blank so stock counts are not touched. Upload it in Seller Hub → Reports → Uploads.

Ticks and edited prices are saved in the browser you used.

### How the suggested price is worked out

1. **Comps:** exact model number, same brand. Left out: your own listings, lots and multi-packs, parts sold "for" a model, used or for-parts items, and titles that mention damage (read, scratch, scuff, defect, dent, crack, broken) unless your own title says *Read. Active listings from sellers under 98% positive feedback are left out.
2. **Shipping:** what the buyer paid for shipping is added to each price (your listings ship free).
3. **Outliers:** when there are 4 or more sold (or active) comps, any more than 20% above or below their median is left out.
4. **Sales:** the suggestion is the median sold price, with sales from the last 30 days counted 3×.
5. **Active all higher:** if every active listing is priced above every sale, the suggestion is 2% under the median price of active listings in *new* condition.
6. **No sales, only active listings:** 2% under the median active price.
7. **Nothing on eBay:** 10% under Amazon's new price.
8. **Nothing on Amazon either:** 25% under the retail price of that exact finish on Moen.com (shop.moen.com, read directly by the server, no Apify cost). If Moen.com doesn't sell it, 25% under Amazon's list price when there is one; otherwise no suggestion.

The numbers live at the top of the pricing section in `public/lib.js` (`RULES`). `node test/rules.test.cjs` checks each rule.

"Best offer" sales show the asking price, so the real sale was probably lower.

## Setup (one time)

You need an Apify account on a paid plan (the free plan's $5 runs out after a test) and the scraper above.

### Vercel

1. vercel.com → **Add New… → Project** → import `sales-to-go-pricing` from GitHub.
2. Framework preset: **Other**. Leave build settings empty.
3. **Environment Variables**:
   * `APIFY_TOKEN` — Apify Console → Settings → Integrations → Personal API token
   * `APP_PASSWORD` — the password you want people to type
4. **Deploy.** Every push to `main` redeploys.

### Netlify (alternative)

1. app.netlify.com → **Add new site → Import an existing project** → GitHub → `sales-to-go-pricing`.
2. Leave build settings as detected (`netlify.toml` sets them).
3. Site configuration → **Environment variables**: add `APIFY_TOKEN` and `APP_PASSWORD`.
4. **Deploys → Trigger deploy**.

Change the password by editing `APP_PASSWORD` and redeploying. The Apify token never reaches the browser; the page talks to `/api/apify`, which checks the password first.

## Files

* `public/` — the app (`index.html`, `style.css`, `app.js`) and the matching rules (`lib.js`)
* `netlify/functions/apify.mjs` — server function that talks to Apify (Netlify)
* `api/apify.mjs` — the same function for Vercel
* `test/rules.test.cjs` — checks each pricing rule on small examples
