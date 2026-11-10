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
import { newState, tick, profile, buy, equip, grant, totals, crate, pickTick, pickBoard, chart, openDrop, useItem, tradeOp, tradesFor, buyPass, adminOp, OWNER, friendOp, chatSend, chatRead, pairKey, liveDue, liveTick, liveBoard, LIVE_ACTIVE_MIN } from './game.js';

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
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const board = tick(st, rows, { now: Date.now(), min: 15, today: amsNow().slice(0, 10), proxies, wh, rnd });
    await this.ctx.storage.put('state', st);
    await this.ensureAlarm();
    return board;
  }
  async board() { return (await this.load()).board; }
  async boardAll() { const st = await this.load(), b = st.board; return b ? { ...b, picks: await this.picks(), flags: st.flags || {} } : b; }
  // picking: which completed batches are new (not counted yet)
  async newBatchIds(ids) { const st = await this.load(); const seen = new Set(st.pseen || []); return ids.filter((x) => !seen.has(String(x))); }
  async markBatches(ids) { const st = await this.load(); st.pseen = (st.pseen || []).concat(ids.map(String)).slice(-600); await this.ctx.storage.put('state', st); }
  async pickTick(batches, proxies) {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const b = pickTick(st, batches, { now: Date.now(), today: amsNow().slice(0, 10), proxies, rnd });
    await this.ctx.storage.put('state', st);
    return b;
  }
  // picks = completed batches today (points, coins) + live picking (last 15 min, idle) per person
  async picks() {
    const now = Date.now();
    const b = pickBoard(await this.load(), now, amsNow().slice(0, 10));
    const live = liveBoard(await this.ctx.storage.get('live'), now);
    const ids = new Set([...b.people.map((p) => p.id), ...Object.keys(live)]);
    const zero = { batches: 0, locations: 0, items: 0, points: 0, hour: 0 };
    b.people = [...ids].map((id) => ({ ...zero, ...(b.people.find((p) => p.id === id) || { id }), live: live[id] || null }));
    b.activeMin = LIVE_ACTIVE_MIN;
    return b;
  }
  // every 15 s (own alarm, the cron is only a backup): packing board + coins, completed batches, live picking
  async ensureAlarm() { if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 3000); }
  async alarm() {
    const t0 = Date.now();
    try { await this.cycle(); await this.ctx.storage.delete('liveErr'); } catch (e) { console.log('cycle', e.message); await this.ctx.storage.put('liveErr', { at: Date.now(), err: String(e.message || e) }); }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 3000, t0 + 15000));
  }
  async cycle() {
    const env = this.env;
    try { const { wh: w, rows } = await closedRows(env, 15); await this.tick(rows, w, proxiesOf(env)); } catch (e) { console.log('pack', e.message); }
    try { await this.picksDone(); } catch (e) { console.log('picks', e.message); }
    await this.live();
  }
  // completed batches → pick points + coins (new ones only, max 15 details per round)
  async picksDone() {
    const env = this.env, w = await warehouse(env);
    const list = (await picqer(env, `/picklists/batches?status=completed${w ? `&idwarehouse=${w.id}` : ''}`)) || [];
    const today = amsNow().slice(0, 10);
    const mine = list.filter((b) => !w || String(b.idwarehouse) === String(w.id));
    const isNew = new Set((await this.newBatchIds(mine.map((b) => b.idpicklist_batch))).map(String));
    const old = mine.filter((b) => isNew.has(String(b.idpicklist_batch)) && String(b.completed_at || '').slice(0, 10) < today);
    if (old.length) await this.markBatches(old.map((b) => b.idpicklist_batch));
    const todo = mine.filter((b) => isNew.has(String(b.idpicklist_batch)) && String(b.completed_at || '').slice(0, 10) >= today).slice(0, 15);
    if (!todo.length) return;
    const full = (await Promise.all(todo.map((b) => picqer(env, `/picklists/batches/${b.idpicklist_batch}`).catch(() => null)))).filter(Boolean);
    await this.pickTick(full, proxiesOf(env));
  }
  // cron (every minute): only makes sure the 15 s loop runs; if it died, do a round now
  async kick() {
    await this.ensureAlarm();
    const st = await this.load();
    if (!st.board || Date.now() - st.board.at > 60000) await this.cycle();
  }
  async live() {
    const env = this.env, now = Date.now();
    const w = await warehouse(env);
    const list = (await picqer(env, `/picklists/batches?status=open${w ? `&idwarehouse=${w.id}` : ''}`)) || [];
    const open = list.filter((b) => b.status === 'open' && b.assigned_to && (!w || String(b.idwarehouse) === String(w.id)));
    const due = liveDue(await this.ctx.storage.get('live'), open, now, 40);
    const details = [];
    // 6 at a time: one batch with all its products takes Picqer a few seconds
    for (let i = 0; i < due.length; i += 6) {
      const got = await Promise.all(due.slice(i, i + 6).map((b) => picqer(env, `/picklists/batches/${b.idpicklist_batch}`).catch((e) => { console.log('live batch', b.idpicklist_batch, e.message); return null; })));
      details.push(...got.filter(Boolean));
    }
    await this.ctx.storage.put('liveTook', Date.now() - now);
    const L = liveTick(await this.ctx.storage.get('live'), open, details, { now, proxies: proxiesOf(env) });
    await this.ctx.storage.put('live', L);
  }
  async chart(date) { return chart(await this.load(), date); }
  async inv(kind, id, uid, target) {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const res = kind === 'open' ? openDrop(st, id, uid, Date.now(), rnd) : useItem(st, id, uid, target, Date.now());
    if (res.ok) await this.ctx.storage.put('state', st);
    return { ...res, profile: profile(st, id, amsNow().slice(0, 10)) };
  }
  async trade(id, op, b) {
    const st = await this.load();
    const res = tradeOp(st, id, op, b, Date.now());
    await this.ctx.storage.put('state', st);
    return { ...res, trades: tradesFor(st, String(id), Date.now()) };
  }
  async pass(id) {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const res = buyPass(st, id, Date.now(), amsNow().slice(0, 10), rnd);
    if (res.ok) await this.ctx.storage.put('state', st);
    return { ...res, profile: profile(st, id, amsNow().slice(0, 10)) };
  }
  async admin(op, target, b) {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const res = adminOp(st, op, target, b, Date.now(), amsNow().slice(0, 10), rnd);
    if (res.ok && op !== 'look' && op !== 'log' && !(op === 'flags' && !b.flags)) await this.ctx.storage.put('state', st);
    return { ...res, ...(target && st.acct[target] ? { profile: profile(st, target, amsNow().slice(0, 10)) } : {}) };
  }
  async trades(id) { return { trades: tradesFor(await this.load(), String(id), Date.now()) }; }
  async seenNews(id, at) { const st = await this.load(); const a = st.acct[String(id)]; if (a && a.news) { a.news = a.news.filter((x) => x.at > at); await this.ctx.storage.put('state', st); } return { ok: true }; }
  // Suite settings per Picqer account (own key each, so the game state stays small)
  async getSettings(id) { return (await this.ctx.storage.get('set:' + id)) || null; }
  async putSettings(id, cfg, at) {
    const cur = await this.ctx.storage.get('set:' + id);
    if (cur && cur.at > at) return { ok: false, err: 'newer settings already saved', ...cur };
    const v = { cfg, at };
    await this.ctx.storage.put('set:' + id, v);
    return { ok: true, at };
  }
  async health() {
    const st = await this.load(), L = (await this.ctx.storage.get('live')) || { b: {}, ev: [] };
    const bs = Object.values(L.b);
    return { stateBytes: JSON.stringify(st).length, accounts: Object.keys(st.acct).length, alarm: await this.ctx.storage.getAlarm(), liveErr: (await this.ctx.storage.get('liveErr')) || null, liveTookMs: (await this.ctx.storage.get('liveTook')) || null,
      live: { batches: bs.length, lastCheck: bs.length ? Math.max(...bs.map((b) => b.checked)) : null, events: L.ev.length, pickers: Object.keys(L.last || {}).length } };
  }
  async totals() { return { at: Date.now(), people: totals(await this.load()) }; }
  async profile(id) { return profile(await this.load(), id, amsNow().slice(0, 10)); }
  async friend(id, op, to) {
    const st = await this.load();
    const res = friendOp(st, id, op, to);
    if (res.ok) await this.ctx.storage.put('state', st);
    return { ...res, profile: profile(st, id, amsNow().slice(0, 10)) };
  }
  async chatGet(id, other, since) {
    const st = await this.load();
    if (!((st.acct[id] || {}).friends || []).includes(other)) return { err: 'only with friends', msgs: [] };
    const msgs = (await this.ctx.storage.get('chat:' + pairKey(id, other))) || [];
    if (chatRead(st, id, other)) await this.ctx.storage.put('state', st);
    return { msgs: msgs.filter((m) => m.at > since) };
  }
  async chatPost(id, to, text) {
    const st = await this.load(), k = 'chat:' + pairKey(id, to);
    const msgs = (await this.ctx.storage.get(k)) || [];
    const res = chatSend(st, msgs, id, to, text, Date.now());
    if (res.ok) { await this.ctx.storage.put(k, msgs); await this.ctx.storage.put('state', st); }
    return res;
  }
  async change(kind, id, skin) {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const res = kind === 'grant' ? grant(st, id, skin) : kind === 'crate' ? crate(st, id, rnd) : kind === 'buy' ? buy(st, id, skin) : equip(st, id, skin);
    if (res.ok) await this.ctx.storage.put('state', st);
    return { ...res, profile: profile(st, id, amsNow().slice(0, 10)) };
  }
}

const game = (env) => env.GAME.get(env.GAME.idFromName('main'));
const proxiesOf = (env) => String(env.PROXIES || PROXIES_DEFAULT).split(',').map((x) => x.trim()).filter(Boolean);
async function run(env) {
  const { wh: w, rows } = await closedRows(env, 15);
  const board = await game(env).tick(rows, w, proxiesOf(env));
  try { await runPicks(env); } catch (e) { console.log('picks', e.message); }
  return board;
}
// picking points: newly completed batches (Picqer lists the newest first). Max 15 details per minute.
async function runPicks(env) {
  const w = await warehouse(env);
  const list = (await picqer(env, `/picklists/batches?status=completed${w ? `&idwarehouse=${w.id}` : ''}`)) || [];
  const today = amsNow().slice(0, 10);
  const mine = list.filter((b) => !w || String(b.idwarehouse) === String(w.id));
  const fresh = await game(env).newBatchIds(mine.map((b) => b.idpicklist_batch));
  const isNew = new Set(fresh.map(String));
  const old = mine.filter((b) => isNew.has(String(b.idpicklist_batch)) && String(b.completed_at || '').slice(0, 10) < today);
  if (old.length) await game(env).markBatches(old.map((b) => b.idpicklist_batch)); // from before today: don't count
  const todo = mine.filter((b) => isNew.has(String(b.idpicklist_batch)) && String(b.completed_at || '').slice(0, 10) >= today).slice(0, 15);
  if (!todo.length) return;
  const full = [];
  for (const b of todo) { try { full.push(await picqer(env, `/picklists/batches/${b.idpicklist_batch}`)); } catch (e) { console.log('batch', b.idpicklist_batch, e.message); } }
  await game(env).pickTick(full, proxiesOf(env));
}

export default {
  async scheduled(_ev, env, ctx) { ctx.waitUntil(game(env).kick()); },
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/leaderboard') {
        // board + pickers in 1 call (the free plan counts calls); right after a deploy the old object may not know it yet
        let b = await game(env).boardAll().catch(() => game(env).board());
        if (!b || Date.now() - b.at > 3 * 60000) b = await run(env); // cron behind (or first time): do it now
        return json(b.picks ? b : { ...b, picks: await game(env).picks() });
      }
      if (url.pathname === '/totals') return json(await game(env).totals());
      if (url.pathname === '/picks') return json(await game(env).picks());
      if (url.pathname === '/chart') {
        const d = String(url.searchParams.get('date') || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ err: 'date needed (YYYY-MM-DD)' }, 400);
        return json(await game(env).chart(d));
      }
      if ((url.pathname === '/open' || url.pathname === '/use') && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || '')) || !b.uid) return json({ err: 'id and uid needed' }, 400);
        return json(await game(env).inv(url.pathname.slice(1), String(b.id), String(b.uid), b.target ? String(b.target) : null));
      }
      if (url.pathname === '/pass' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || ''))) return json({ err: 'id needed' }, 400);
        return json(await game(env).pass(String(b.id)));
      }
      if (url.pathname === '/trade' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || '')) || !b.op) return json({ err: 'id and op needed' }, 400);
        return json(await game(env).trade(String(b.id), String(b.op), b));
      }
      if (url.pathname === '/friend' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || '')) || !b.op) return json({ err: 'id and op needed' }, 400);
        return json(await game(env).friend(String(b.id), String(b.op), String(b.to || '')));
      }
      if (url.pathname === '/chat') {
        if (req.method === 'POST') {
          const b = await req.json().catch(() => ({}));
          if (!/^\d+$/.test(String(b.id || '')) || !/^\d+$/.test(String(b.to || ''))) return json({ err: 'id and to needed' }, 400);
          return json(await game(env).chatPost(String(b.id), String(b.to), String(b.text || '')));
        }
        const id = String(url.searchParams.get('id') || ''), w = String(url.searchParams.get('with') || '');
        if (!/^\d+$/.test(id) || !/^\d+$/.test(w)) return json({ err: 'id and with needed' }, 400);
        return json(await game(env).chatGet(id, w, +url.searchParams.get('since') || 0));
      }
      if (url.pathname === '/trades') {
        const id = String(url.searchParams.get('id') || '');
        if (!/^\d+$/.test(id)) return json({ err: 'id needed' }, 400);
        return json(await game(env).trades(id));
      }
      if (url.pathname === '/seen' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || ''))) return json({ err: 'id needed' }, 400);
        return json(await game(env).seenNews(String(b.id), +b.at || 0));
      }
      if (url.pathname === '/health') return json(await game(env).health());
      if (url.pathname === '/settings') {
        const id = String(url.searchParams.get('id') || '');
        if (!/^\d+$/.test(id)) return json({ err: 'id needed' }, 400);
        if (req.method === 'POST') {
          const b = await req.json().catch(() => ({}));
          const text = JSON.stringify(b.cfg || null);
          if (!b.cfg || typeof b.cfg !== 'object' || text.length > 60000) return json({ err: 'bad settings' }, 400);
          return json(await game(env).putSettings(id, b.cfg, +b.at || Date.now()));
        }
        return json((await game(env).getSettings(id)) || { cfg: null, at: 0 });
      }
      if (url.pathname === '/profile') {
        const id = url.searchParams.get('id');
        if (!/^\d+$/.test(id || '')) return json({ err: 'id needed' }, 400);
        return json(await game(env).profile(id));
      }
      if ((url.pathname === '/buy' || url.pathname === '/equip' || url.pathname === '/crate') && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || ''))) return json({ err: 'id needed' }, 400);
        return json(await game(env).change(url.pathname.slice(1), String(b.id), b.skin ? String(b.skin) : null));
      }
      // owner panel (Shift+9 on Ahmad's account). With ADMIN_KEY set as a secret, that key is needed too.
      if (url.pathname === '/admin' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const key = String(env.ADMIN_KEY || '').trim();
        if (String(b.by) !== OWNER || (key && req.headers.get('X-Admin-Key') !== key)) return json({ err: 'not allowed' }, 403);
        return json(await game(env).admin(String(b.op || ''), String(b.target || ''), b));
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
