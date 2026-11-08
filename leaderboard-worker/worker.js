// Picqer Suite · leaderboard middle stop (Cloudflare Worker + 1 Durable Object)
// Every minute (cron) it asks Picqer for the picklists closed in the last 15 min, once for everyone,
// keeps today's stats, the coins and king of the hill in a Durable Object, and every PC reads from here.
// Hands out user ids and numbers only (no names): every PC turns ids into names with its own Picqer login.
//
// Settings (Worker -> Settings -> Variables and Secrets):
//   PICQER_KEY   secret  the Picqer API key (never in GitHub)
//   PICQER_HOST  text    trl-fulfilment.picqer.com      (from wrangler.jsonc)
//   WAREHOUSE    text    Bunsenstraat                   (from wrangler.jsonc)
//   PROXIES      text    user ids that never count, comma separated (optional)
//   ADMIN_KEY    secret  lets POST /admin/grant {id, coins} with header X-Admin-Key add or take coins (optional)
import { DurableObject } from 'cloudflare:workers';
import { newState, tick, profile, buy, equip, grant } from './game.js';

const ams = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const amsNow = (t = Date.now()) => ams.format(new Date(t));
const cors = (h = {}) => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key', ...h });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) });
const PROXIES_DEFAULT = '36135,29011,33549';

async function picqer(env, path) {
  const host = String(env.PICQER_HOST || '').replace(/\/+$/, '');
  const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
  const r = await fetch(`${base}/api/v1${path}`, {
    headers: { Authorization: 'Basic ' + btoa(`${String(env.PICQER_KEY || '').trim()}:`), Accept: 'application/json', 'User-Agent': 'SABR Picqer Suite leaderboard' },
  });
  if (!r.ok) throw new Error(`Picqer HTTP ${r.status}`);
  return r.json();
}
let wh = null;
async function warehouse(env) {
  const want = String(env.WAREHOUSE || '').trim().toLowerCase();
  if (!want) return null;
  if (wh) return wh;
  const list = await picqer(env, '/warehouses');
  const nm = (w) => String(w.name).trim().toLowerCase();
  const hit = list.find((w) => String(w.idwarehouse) === want) || list.find((w) => nm(w) === want) || list.find((w) => nm(w).includes(want));
  wh = hit ? { id: hit.idwarehouse, name: String(hit.name).trim() } : null;
  return wh;
}
async function closedRows(env, min) {
  const w = await warehouse(env);
  const since = amsNow(Date.now() - min * 60000);
  const rows = [];
  for (let off = 0; off < 5000; off += 100) {
    const page = await picqer(env, `/picklists?status=closed&closed_after=${encodeURIComponent(since)}${w ? `&idwarehouse=${w.id}` : ''}&offset=${off}`);
    rows.push(...page);
    if (page.length < 100) break;
  }
  // only what the game needs
  return { wh: w ? w.name : '', rows: rows.map((p) => ({ idpicklist: p.idpicklist, closed_by_iduser: p.closed_by_iduser, closed_at: p.closed_at, products: (p.products || []).map((x) => ({ productcode: x.productcode, has_parts: !!x.has_parts })) })) };
}

export class Game extends DurableObject {
  async load() { return (await this.ctx.storage.get('state')) || newState(); }
  async tick(rows, wh, proxies) {
    const st = await this.load();
    const board = tick(st, rows, { now: Date.now(), min: 15, today: amsNow().slice(0, 10), proxies, wh });
    await this.ctx.storage.put('state', st);
    return board;
  }
  async board() { return (await this.load()).board; }
  async profile(id) { return profile(await this.load(), id, amsNow().slice(0, 10)); }
  async change(kind, id, skin) {
    const st = await this.load();
    const res = kind === 'grant' ? grant(st, id, skin) : kind === 'buy' ? buy(st, id, skin) : equip(st, id, skin);
    if (res.ok) await this.ctx.storage.put('state', st);
    return { ...res, profile: profile(st, id, amsNow().slice(0, 10)) };
  }
}

const game = (env) => env.GAME.get(env.GAME.idFromName('main'));
async function run(env) {
  const { wh: w, rows } = await closedRows(env, 15);
  return game(env).tick(rows, w, String(env.PROXIES || PROXIES_DEFAULT).split(',').map((x) => x.trim()).filter(Boolean));
}

export default {
  async scheduled(_ev, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/leaderboard') {
        let b = await game(env).board();
        if (!b || Date.now() - b.at > 3 * 60000) b = await run(env); // cron behind (or first time): do it now
        return json(b);
      }
      if (url.pathname === '/profile') {
        const id = url.searchParams.get('id');
        if (!/^\d+$/.test(id || '')) return json({ err: 'id needed' }, 400);
        return json(await game(env).profile(id));
      }
      if ((url.pathname === '/buy' || url.pathname === '/equip') && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || ''))) return json({ err: 'id needed' }, 400);
        return json(await game(env).change(url.pathname.slice(1), String(b.id), b.skin ? String(b.skin) : null));
      }
      if (url.pathname === '/admin/grant' && req.method === 'POST') {
        const key = String(env.ADMIN_KEY || '').trim();
        if (!key || req.headers.get('X-Admin-Key') !== key) return json({ err: 'not allowed' }, 403);
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || ''))) return json({ err: 'id needed' }, 400);
        return json(await game(env).change('grant', String(b.id), b.coins));
      }
      return new Response('Picqer Suite leaderboard · /leaderboard · /profile?id=', { headers: cors() });
    } catch (e) {
      return json({ err: e.message }, 502);
    }
  },
};
