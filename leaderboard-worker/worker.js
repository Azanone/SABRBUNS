// Picqer Suite · leaderboard middle stop (Cloudflare Worker)
// Asks Picqer ONCE a minute for the closed picklists, every PC reads the answer from here.
// Gives user ids + numbers only (no names): every PC turns ids into names with its own Picqer login.
//
// Settings (Worker -> Settings -> Variables and Secrets):
//   PICQER_KEY   secret  your Picqer API key (never in GitHub)
//   PICQER_HOST  text    trl-fulfilment.picqer.com
//   WAREHOUSE    text    Bunsenstraat   (name or id, empty = all)
//
// Points: multi (2+ different products) = 2, single = 1.334.
// Products that have parts (has_parts, the "set" line) don't count, their parts do.

const MULTI = 2, SINGLE = 1.334;
let last = null, inflight = null, wh = null;

const ams = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const cors = (h = {}) => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', ...h });

async function picqer(env, path) {
  const r = await fetch(`https://${env.PICQER_HOST}/api/v1${path}`, {
    headers: { Authorization: 'Basic ' + btoa(`${env.PICQER_KEY}:`), Accept: 'application/json', 'User-Agent': 'SABR Picqer Suite leaderboard' },
  });
  if (!r.ok) throw new Error(`Picqer HTTP ${r.status}`);
  return r.json();
}

async function warehouse(env) {
  const want = String(env.WAREHOUSE || '').trim().toLowerCase();
  if (!want) return null;
  if (wh) return wh;
  const list = await picqer(env, '/warehouses');
  const hit = list.find((w) => String(w.idwarehouse) === want) || list.find((w) => String(w.name).toLowerCase() === want) || list.find((w) => String(w.name).toLowerCase().includes(want));
  wh = hit ? { id: hit.idwarehouse, name: hit.name } : null;
  return wh;
}

async function compute(env, min) {
  const w = await warehouse(env);
  const since = ams.format(new Date(Date.now() - min * 60000));
  const rows = [];
  for (let off = 0; off < 5000; off += 100) {
    const page = await picqer(env, `/picklists?status=closed&closed_after=${encodeURIComponent(since)}${w ? `&idwarehouse=${w.id}` : ''}&offset=${off}`);
    rows.push(...page);
    if (page.length < 100) break;
  }
  const by = new Map();
  for (const p of rows) {
    if (p.closed_by_iduser == null) continue;
    const codes = new Set((p.products || []).filter((x) => !x.has_parts).map((x) => x.productcode));
    if (!codes.size) continue;
    const multi = codes.size >= 2;
    const r = by.get(p.closed_by_iduser) || { id: String(p.closed_by_iduser), picklists: 0, multis: 0, singles: 0, points: 0 };
    r.picklists++;
    if (multi) r.multis++; else r.singles++;
    r.points = Math.round((r.multis * MULTI + r.singles * SINGLE) * 1000) / 1000;
    by.set(p.closed_by_iduser, r);
  }
  return { at: Date.now(), min, wh: w ? w.name : '', people: [...by.values()].sort((a, b) => b.points - a.points) };
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(req.url);
    if (url.pathname !== '/leaderboard') return new Response('Picqer Suite leaderboard · /leaderboard', { headers: cors() });
    const min = Math.min(120, Math.max(5, +url.searchParams.get('min') || 15));
    const key = new Request(`https://cache.local/leaderboard/${min}`);
    const hit = await caches.default.match(key);
    if (hit) return new Response(hit.body, { headers: cors({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) });
    try {
      inflight = inflight || compute(env, min).finally(() => { inflight = null; }); // 20 PCs at once = 1 Picqer round
      const data = await inflight;
      last = data;
      const body = JSON.stringify(data);
      ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=55' } })));
      return new Response(body, { headers: cors({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) });
    } catch (e) {
      if (last) return new Response(JSON.stringify({ ...last, err: e.message, stale: true }), { headers: cors({ 'Content-Type': 'application/json' }) });
      return new Response(JSON.stringify({ err: e.message }), { status: 502, headers: cors({ 'Content-Type': 'application/json' }) });
    }
  },
};
