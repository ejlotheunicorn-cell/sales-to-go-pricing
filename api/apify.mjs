// Vercel entry point. The same handler runs on Netlify from netlify/functions/apify.mjs.
import handler from '../netlify/functions/apify.mjs';
export const GET = (req) => handler(req);
export const POST = (req) => handler(req);
