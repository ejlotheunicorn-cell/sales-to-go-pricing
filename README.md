# Sales To Go Pricing

Upload your eBay **price & quantity** file, pull the last 90 days of eBay sold prices (and current active listings) for every model through Apify, compare them with your prices, tick the ones to change, and download an eBay **revise** file to upload in Seller Hub.

## How it works

1. **Upload.** Seller Hub → Listings → Active → *Edit price & quantity* → Download (or Reports → Downloads). Drop that CSV on the first screen.
2. **Pull comps.** The app finds each listing's model number and searches eBay through Apify (scraper: `memo23/ebay-search-scraper-ppe`). It runs on Apify's servers, so you can close the page and come back. A full file of ~600 listings takes about 15–40 minutes and roughly $5–15 of Apify credit; the spending cap you set is a hard limit.
3. **Review.** Every listing shows your price, the median sold price, the lowest active price and a suggested new price (the median sold). *Show comps* lists the actual sales and listings behind each number with links to eBay.
4. **Download the upload file.** Only ticked listings go in it, and only the price changes; quantity is left blank so stock counts are not touched. Upload it in Seller Hub → Reports → Uploads.

Ticks and edited prices are saved in the browser you used.

### What counts as a comp

* Exact model number in the title (84516 does not match 84516SRN or 84516BL).
* Same brand as your listing (drops trading cards, stamps and other products that share a number).
* Left out: your own listings (seller name on the setup screen), lots and multi-packs, parts sold "for" a model (aerators, handle kits, cartridges), used / pre-owned / for-parts items, prices far below the rest, and "no valve" comps when your title says the valve is included.
* "Best offer" sales show the asking price, so the real sale was probably lower.

Listings without a model number are searched by the first words of the title; check those comps by eye.

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
