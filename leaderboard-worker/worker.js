// Picqer Suite · leaderboard middle stop (Cloudflare Worker + 1 Durable Object)
// Every minute (cron) it asks Picqer for the picklists closed in the last 15 min, once for everyone,
// keeps today's stats, the coins and king of the hill in a Durable Object, and every PC reads from here.
// Hands out user ids and numbers only (no names): every PC turns ids into names with its own Picqer login.
//
// Settings (Worker -> Settings -> Variables and Secrets):
//   PICQER_KEY   secret  the Picqer API key (never in GitHub)
//   PICQER_HOST  text    trl-fulfilment.picqer.com      (from wrangler.jsonc)
//   WAREHOUSE    text    Bunsenstraat                   (from wrangler.jsonc) the main one: shift goal + BE counter
//   WAREHOUSES   text    Bunsenstraat,Barnsteen         (from wrangler.jsonc) every warehouse with a board (name or id, comma separated)
//   PROXIES      text    user ids that never count, comma separated (optional)
//   ADMIN_KEY    secret  lets POST /admin/grant {id, coins} with header X-Admin-Key add or take coins (optional)
import { DurableObject } from 'cloudflare:workers';
import { newState, tick, profile, buy, equip, paint, grant, totals, crate, pickTick, pickBoard, chart, openDrop, useItem, tradeOp, tradesFor, buyPass, adminOp, OWNER, shiftReport, reportWhs, fxOp, dailyLogin, errPoints, friendOp, chatSend, chatRead, pairKey, liveDue, liveTick, liveBoard, LIVE_ACTIVE_MIN, annFor, annSeen } from './game.js';

const ams = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const amsNow = (t = Date.now()) => ams.format(new Date(t));
const BE_TAG = 'BE Pick-up'; // the Picqer tag the shift leaders' counter counts (open picklists)
// the header pills (team feature beCounter): key, label on the pill, tag name to find in Picqer, fallback tag id
const TAG_PILLS = [{ key: 'be', label: 'BE Pick-up', find: BE_TAG, id: 252185 }, { key: 'eig', label: 'EIGENAAR', find: 'EIGENAAR' }];
const cors = (h = {}) => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key', ...h });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) });
const PROXIES_DEFAULT = '36135,29011,33549,16983'; // 16983 = a machine, not a person

async function picqer(env, path) {
  const host = String(env.PICQER_HOST || '').replace(/\/+$/, '');
  const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
  const r = await fetch(`${base}/api/v1${path}`, {
    headers: { Authorization: 'Basic ' + btoa(`${String(env.PICQER_KEY || '').trim()}:`), Accept: 'application/json', 'User-Agent': 'SABR Picqer Suite leaderboard' },
  });
  if (!r.ok) throw new Error(`Picqer HTTP ${r.status}`);
  return r.json();
}
// warehouses: names → Picqer ids (asked once per 6 h). A name matches the exact name, else a name that contains it.
let whCache = null;
async function whAll(env) {
  if (whCache && Date.now() - whCache.at < 6 * 3600000) return whCache;
  const list = (await picqer(env, '/warehouses')) || [];
  const nm = (w) => String(w.name).trim().toLowerCase();
  const find = (x) => { const k = String(x || '').trim().toLowerCase(); return !k ? null : list.find((w) => String(w.idwarehouse) === k) || list.find((w) => nm(w) === k) || list.find((w) => nm(w).includes(k)) || null; };
  const asW = (w) => (w ? { id: String(w.idwarehouse), name: String(w.name).trim() } : null);
  const main = asW(find(env.WAREHOUSE));
  const want = String(env.WAREHOUSES || [env.WAREHOUSE, 'Barnsteen'].filter(Boolean).join(',')).split(',').map((x) => x.trim()).filter(Boolean);
  const whs = [];
  const missing = [];
  for (const x of want) { const w = asW(find(x)); if (!w) missing.push(x); else if (!whs.find((y) => y.id === w.id)) whs.push(w); }
  if (main && !whs.find((y) => y.id === main.id)) whs.unshift(main);
  whCache = { at: Date.now(), main, whs, missing };
  return whCache;
}
// the main warehouse (shift goal, BE counter) · null = no filter
async function warehouse(env) { return (await whAll(env)).main; }
// every warehouse with a board · [null] = no filter at all (nothing configured / found)
async function warehouses(env) { const w = await whAll(env); return w.whs.length ? w.whs : [w.main || null]; }
async function closedRows(env, min) {
  const since = amsNow(Date.now() - min * 60000);
  const ws = await warehouses(env), rows = [];
  for (const w of ws) {
    for (let off = 0; off < 5000; off += 100) {
      const page = await picqer(env, `/picklists?status=closed&closed_after=${encodeURIComponent(since)}${w ? `&idwarehouse=${w.id}` : ''}&offset=${off}`);
      // only what the game needs
      rows.push(...page.map((p) => ({ idpicklist: p.idpicklist, closed_by_iduser: p.closed_by_iduser, closed_at: p.closed_at, wh: w ? w.id : String(p.idwarehouse || ''), products: (p.products || []).map((x) => ({ productcode: x.productcode, has_parts: !!x.has_parts })) })));
      if (page.length < 100) break;
    }
  }
  const main = await warehouse(env);
  return { whs: ws.filter(Boolean), main: main ? main.id : '', wh: main ? main.name : '', rows };
}
// open / completed batches of every warehouse (the first page of each = the newest 100), each tagged with its warehouse
async function batchList(env, status) {
  const out = [];
  for (const w of await warehouses(env)) {
    const list = (await picqer(env, `/picklists/batches?status=${status}${w ? `&idwarehouse=${w.id}` : ''}`)) || [];
    out.push(...list.filter((b) => !w || String(b.idwarehouse) === String(w.id)).map((b) => ({ ...b, wh: w ? w.id : String(b.idwarehouse || '') })));
  }
  return out;
}

export class Game extends DurableObject {
  async load() { return (await this.ctx.storage.get('state')) || newState(); }
  async tick(rows, wh, proxies, whs = [], main = '') {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const board = tick(st, rows, { now: Date.now(), min: 15, today: amsNow().slice(0, 10), proxies, wh, whs, main, rnd });
    await this.ctx.storage.put('state', st);
    await this.ensureAlarm();
    return board;
  }
  // packing: closed picklists of the last 15 min (every warehouse) → boards, coins, king
  async packRound() { const r = await closedRows(this.env, 15); return this.tick(r.rows, r.wh, proxiesOf(this.env), r.whs, r.main); }
  async board() { return (await this.load()).board; }
  async boardAll() {
    const st = await this.load(), b = st.board;
    if (!b) return b;
    const today = amsNow().slice(0, 10), packed = ((st.hours[today] || {}).packed) || Array(24).fill(0);
    const oc = st.goal && st.goal.target ? (await this.ctx.storage.get('openCount')) || null : null;
    let goal = null;
    if (st.goal && st.goal.target) {
      // start = the count typed in Shift+9, else the first count at / after the start time (else the first one we have)
      const ss = oc && oc.day === today ? oc.samples : [];
      const fromAt = Date.parse(`${today}T${st.goal.from || '18:00'}:00`) - 3600000; // Amsterdam (winter) → UTC, close enough for picking a sample
      const first = ss.find((x) => x.at >= fromAt) || null;
      goal = { ...st.goal, open: oc ? oc.n : null, openAt: oc ? oc.at : null, start: st.goal.start || (first ? first.n : null), startAuto: !st.goal.start, samples: ss.slice(-40), wh: String(st.mainWh || ''), whName: ((st.whNames || {})[st.mainWh] || '') };
    }
    return { ...b, picks: await this.picks(), flags: st.flags || {}, goal };
  }
  // picking: which completed batches are new (not counted yet)
  async newBatchIds(ids) { const st = await this.load(); const seen = new Set(st.pseen || []); return ids.filter((x) => !seen.has(String(x))); }
  async markBatches(ids) { const st = await this.load(); st.pseen = (st.pseen || []).concat(ids.map(String)).slice(-600); await this.ctx.storage.put('state', st); }
  async pickTick(batches, proxies) {
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const b = pickTick(st, batches, { now: Date.now(), today: amsNow().slice(0, 10), proxies, main: st.mainWh || '', rnd });
    await this.ctx.storage.put('state', st);
    return b;
  }
  // picks = completed batches today (points, coins) + live picking (last 15 min, idle) per person
  async picks() {
    const now = Date.now(), st = await this.load();
    const b = pickBoard(st, now, amsNow().slice(0, 10));
    const live = liveBoard(await this.ctx.storage.get('live'), now);
    const ids = new Set([...b.people.map((p) => p.id), ...Object.keys(live)]);
    const zero = { batches: 0, locations: 0, items: 0, points: 0, hour: 0 };
    const main = String(st.mainWh || '');
    // where are they now: live picking first (where they collected last), else today's batches
    const all = [...ids].map((id) => { const r = { ...zero, ...(b.people.find((p) => p.id === id) || { id }), live: live[id] || null }; r.wh = (r.live && r.live.wh) || r.wh || main; return r; });
    b.all = all;
    b.people = all.filter((r) => !main || r.wh === main); // older scripts: the main warehouse only
    b.whs = Object.entries(st.whNames || {}).map(([id, name]) => ({ id, name }));
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
    try { await this.packRound(); } catch (e) { console.log('pack', e.message); }
    try { await this.picksDone(); } catch (e) { console.log('picks', e.message); }
    await this.live();
    try { await this.report(); } catch (e) { console.log('report', e.message); }
    try { await this.openCount(); } catch (e) { console.log('open count', e.message); }
    try { await this.beCount(); } catch (e) { console.log('be count', e.message); }
  }
  // BE Pick-up: open picklists with that tag, every cycle (15 s) from 06:00 until 23:00 (Amsterdam), for the shift leaders' counter
  // header pills for the shift leaders (06:00-23:00, main warehouse): open picklists per tag. Only reads Picqer.
  // id = the Picqer tag id for the link (filter_tags_in), found by name in /tags (6 h), the BE id as a fallback
  async tagIds() {
    if (this._tags && Date.now() - this._tags.at < 6 * 3600000) return this._tags.list;
    const all = [];
    for (let off = 0; off < 2000; off += 100) { const page = (await picqer(this.env, `/tags?offset=${off}`)) || []; all.push(...page); if (page.length < 100) break; }
    const list = TAG_PILLS.map((t) => {
      const k = t.find.toLowerCase(), hit = all.find((x) => String(x.title || '').trim().toLowerCase() === k) || all.find((x) => String(x.title || '').toLowerCase().includes(k));
      return { ...t, title: hit ? String(hit.title).trim() : t.find, id: hit ? hit.idtag : t.id || null };
    });
    this._tags = { at: Date.now(), list };
    return list;
  }
  async beCount() {
    const hm = amsNow().slice(11, 16);
    if (hm >= '23:00' || hm < '06:00') return;
    const w = await warehouse(this.env);
    const tags = await this.tagIds().catch(() => TAG_PILLS.map((t) => ({ ...t, title: t.find, id: t.id || null })));
    const o = (await this.ctx.storage.get('beCount')) || {};
    const now = Date.now(), day = amsNow().slice(0, 10);
    if (o.day !== day) { o.day = day; o.peak = 0; o.tags = {}; }
    o.tags = o.tags || {};
    for (const t of tags) {
      let n = 0;
      for (let off = 0; off < 5000; off += 100) {
        const page = (await picqer(this.env, `/picklists?status=new&tag=${encodeURIComponent(t.title)}${w ? `&idwarehouse=${w.id}` : ''}&offset=${off}`)) || [];
        n += page.filter((p) => p.status === 'new').length;
        if (page.length < 100) break;
      }
      const x = (o.tags[t.key] = o.tags[t.key] || {});
      x.prev = x.n == null ? n : x.n; x.n = n; x.peak = Math.max(x.peak || 0, n); x.id = t.id; x.label = t.label;
      if (t.key === 'be') { o.prev = o.n == null ? n : o.n; o.n = n; o.peak = Math.max(o.peak || 0, n); } // older scripts read these
    }
    o.at = now;
    await this.ctx.storage.put('beCount', o);
  }
  async be() {
    const o = (await this.ctx.storage.get('beCount')) || null;
    if (!o || Date.now() - o.at >= 5 * 60000) return { n: null };
    const tags = TAG_PILLS.map((t) => ({ key: t.key, label: t.label, ...((o.tags || {})[t.key] || {}) })).filter((t) => t.n != null);
    return { n: o.n, prev: o.prev, peak: o.peak, at: o.at, tags };
  }
  // completed batches → pick points + coins (new ones only, max 15 details per round)
  // shift goal = how many picklists may still be open at the end time: count the open ones every 3 min (only with a goal)
  async openCount() {
    const st = await this.load();
    if (!st.goal || !st.goal.target) return;
    const o = (await this.ctx.storage.get('openCount')) || { samples: [] };
    if (o.at && Date.now() - o.at < 3 * 60000) return;
    const w = await warehouse(this.env);
    let n = 0;
    for (let off = 0; off < 20000; off += 100) {
      const page = (await picqer(this.env, `/picklists?status=new${w ? `&idwarehouse=${w.id}` : ''}&offset=${off}`)) || [];
      n += page.filter((p) => p.status === 'new').length;
      if (page.length < 100) break;
    }
    const now = Date.now(), day = amsNow().slice(0, 10);
    if (o.day !== day) { o.day = day; o.samples = []; }
    o.samples = (o.samples || []).concat({ at: now, n }).slice(-500); // today, every 3 min
    o.at = now; o.n = n;
    await this.ctx.storage.put('openCount', o);
  }
  async picksDone() {
    const env = this.env;
    const mine = await batchList(env, 'completed');
    const today = amsNow().slice(0, 10);
    const isNew = new Set((await this.newBatchIds(mine.map((b) => b.idpicklist_batch))).map(String));
    const old = mine.filter((b) => isNew.has(String(b.idpicklist_batch)) && String(b.completed_at || '').slice(0, 10) < today);
    if (old.length) await this.markBatches(old.map((b) => b.idpicklist_batch));
    const todo = mine.filter((b) => isNew.has(String(b.idpicklist_batch)) && String(b.completed_at || '').slice(0, 10) >= today).slice(0, 15);
    if (!todo.length) return;
    const full = (await Promise.all(todo.map((b) => picqer(env, `/picklists/batches/${b.idpicklist_batch}`).then((d) => (d ? { ...d, wh: b.wh } : null)).catch(() => null)))).filter(Boolean);
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
    const open = (await batchList(env, 'open')).filter((b) => b.status === 'open' && b.assigned_to);
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
  async chart(date, wh) { return chart(await this.load(), date, wh); }
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
    const logBefore = new Set(st.log || []);
    const res = adminOp(st, op, target, b, Date.now(), amsNow().slice(0, 10), rnd);
    // every new admin line → Discord right away (Admin webhook, else the Logs one)
    const fresh = (st.log || []).filter((x) => !logBefore.has(x) && /^admin/.test(x.what || ''));
    if (res.ok && fresh.length) await this.adminDiscord(st, fresh, op === 'announce' ? b : null).catch((e) => console.log('admin discord', e.message));
    if (res.ok && op !== 'look' && op !== 'log' && op !== 'anns' && !(op === 'flags' && !b.flags) && !(op === 'hooks' && !b.hooks) && !(op === 'goal' && !b.goal)) await this.ctx.storage.put('state', st);
    if (op === 'hooks' && b.test) {
      const which = b.test === 'report' ? 'report' : b.test === 'admin' ? 'admin' : 'log';
      const url = (st.hooks || {})[which];
      if (!url) return { ...res, err: 'no webhook for that yet' };
      if (which === 'report') {
        const today = amsNow().slice(0, 10), nm = await this.userNames();
        for (const w of reportWhs(st, today)) { const r = await discord(url, shiftReport(st, today, nm, w)); if (!r.ok) return { ...res, err: `Discord said ${r.status}` }; }
        return res;
      }
      const r = await discord(url, which === 'admin' ? '✅ Picqer Suite admin log webhook works' : '✅ Picqer Suite log webhook works');
      return { ...res, ...(r.ok ? {} : { err: `Discord said ${r.status}` }) };
    }
    return { ...res, ...(target && st.acct[target] ? { profile: profile(st, target, amsNow().slice(0, 10)) } : {}) };
  }
  // Shift+9 actions to Discord as they happen · ids → names (read from Picqer, never written)
  async adminDiscord(st, lines, ann) {
    const url = (st.hooks || {}).admin || (st.hooks || {}).log;
    if (!url) return;
    const nm = await this.userNames().catch(() => ({}));
    const t = amsNow().slice(11, 16);
    const txt = lines.map((x) => `🛠️ \`${t}\` ${String(x.what).replace(/^admin:\s*/, '').replace(/→ (\d+)$/, (m, id) => '→ ' + (nm[id] || '#' + id))}`).join('\n');
    const extra = ann && ann.text ? `\n> ${String(ann.text).slice(0, 500).replace(/\n/g, '\n> ')}` : '';
    await discord(url, txt + extra);
  }
  // names for the report (Picqer users, kept 12 h)
  async userNames() {
    const c = await this.ctx.storage.get('names');
    if (c && Date.now() - c.at < 12 * 3600000) return c.map;
    const map = {};
    for (let off = 0; off < 3000; off += 100) {
      const page = (await picqer(this.env, `/users?offset=${off}`).catch(() => [])) || [];
      for (const u of page) map[u.iduser] = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username || `#${u.iduser}`;
      if (page.length < 100) break;
    }
    await this.ctx.storage.put('names', { at: Date.now(), map });
    return map;
  }
  // a PC had a slow page / crash: its last log lines to Discord (max 1 per person per 5 min)
  async diag(id, name, ver, lines) {
    const st = await this.load(), url = (st.hooks || {}).log;
    if (!url) return { ok: false, err: 'no log webhook' };
    const last = (await this.ctx.storage.get('diagAt')) || {};
    if (Date.now() - (last[id] || 0) < 5 * 60000) return { ok: true, skipped: true };
    last[id] = Date.now();
    await this.ctx.storage.put('diagAt', last);
    const body = String(lines || '').slice(-1700);
    await discord(url, `🐢 **${String(name || '#' + id).slice(0, 60)}** · ${String(ver).slice(0, 10)}\n\`\`\`\n${body}\n\`\`\``);
    return { ok: true };
  }
  // end of shift report once a day at hooks.reportAt (Amsterdam time)
  async report() {
    const st = await this.load(), h = st.hooks || {};
    if (!h.report) return;
    const now = amsNow(), today = now.slice(0, 10), hm = now.slice(11, 16);
    if (st.reportDay === today || hm < (h.reportAt || '22:30')) return;
    st.reportDay = today;
    await this.ctx.storage.put('state', st);
    const nm = await this.userNames();
    for (const w of reportWhs(st, today)) await discord(h.report, shiftReport(st, today, nm, w)); // one per warehouse that worked today
  }
  async trades(id) { return { trades: tradesFor(await this.load(), String(id), Date.now()) }; }
  // announcements (Shift+9): what this person didn't see yet · seen = never again (on any PC)
  async ann(id) { return { ann: annFor(await this.load(), String(id), Date.now()) }; }
  async annSeen(id, aid) { const st = await this.load(); if (annSeen(st, String(id), String(aid), Date.now())) await this.ctx.storage.put('state', st); return { ok: true }; }
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
    const W = await whAll(this.env).catch((e) => ({ err: e.message }));
    return { stateBytes: JSON.stringify(st).length, accounts: Object.keys(st.acct).length, alarm: await this.ctx.storage.getAlarm(), liveErr: (await this.ctx.storage.get('liveErr')) || null, liveTookMs: (await this.ctx.storage.get('liveTook')) || null,
      warehouses: W.err ? W : { main: W.main, all: W.whs, notFound: W.missing },
      live: { batches: bs.length, lastCheck: bs.length ? Math.max(...bs.map((b) => b.checked)) : null, events: L.ev.length, pickers: Object.keys(L.last || {}).length } };
  }
  async totals() { return { at: Date.now(), people: totals(await this.load()) }; }
  // v = the script version asking (392 = 3.92). The daily login reward starts with 3.92 (older scripts can't show it).
  async profile(id, v = 0) {
    const st = await this.load(), today = amsNow().slice(0, 10), now = Date.now();
    if (v >= 392 && dailyLogin(st, id, today, now, () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296)) await this.ctx.storage.put('state', st);
    return profile(st, id, today, now, v);
  }
  // shipment error: half the points for the packer. Checks in Picqer (read only) that the picklist is real, open, ours, and has the error comment.
  async err(id, plId) {
    const env = this.env;
    const pl = await picqer(env, `/picklists/${plId}`).catch(() => null);
    if (!pl || !pl.idpicklist) return { err: 'no such picklist' };
    if (pl.status === 'closed' || pl.status === 'cancelled') return { err: 'that picklist is closed' };
    const ws = (await warehouses(env)).filter(Boolean), w = ws.find((x) => String(x.id) === String(pl.idwarehouse));
    if (ws.length && !w) return { err: 'not one of our warehouses' };
    const com = await picqer(env, `/picklists/${plId}/comments`).catch(() => null);
    if (!/Verzendfout/i.test(JSON.stringify(com || ''))) return { err: 'no shipment error on that picklist' };
    const st = await this.load();
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const res = errPoints(st, id, { idpicklist: pl.idpicklist, products: (pl.products || []).map((x) => ({ productcode: x.productcode, has_parts: !!x.has_parts })) }, { now: Date.now(), today: amsNow().slice(0, 10), wh: w ? w.id : '', proxies: proxiesOf(env), rnd });
    if (res.ok) await this.ctx.storage.put('state', st);
    return res;
  }
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
    const res = kind === 'grant' ? grant(st, id, skin) : kind === 'crate' ? crate(st, id, rnd) : kind === 'buy' ? buy(st, id, skin, amsNow().slice(0, 10)) : kind === 'fx' ? fxOp(st, id, skin) : kind === 'color' ? paint(st, id, skin) : equip(st, id, skin);
    if (res.ok) await this.ctx.storage.put('state', st);
    return { ...res, profile: profile(st, id, amsNow().slice(0, 10), Date.now(), 392) };
  }
}

const game = (env) => env.GAME.get(env.GAME.idFromName('main'));
// send a message to a Discord webhook
async function discord(url, content) {
  try { return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: String(content).slice(0, 1990), allowed_mentions: { parse: [] } }) }); }
  catch (e) { return { ok: false, status: 0 }; }
}
const proxiesOf = (env) => String(env.PROXIES || PROXIES_DEFAULT).split(',').map((x) => x.trim()).filter(Boolean);
// the board is old (or the first time): a packing round + completed batches right now
async function run(env) {
  const g = game(env);
  // right after a deploy the object can still run the old code (no packRound yet): then the old way
  const board = await g.packRound().catch(async () => { const r = await closedRows(env, 15); return g.tick(r.rows, r.wh, proxiesOf(env)); });
  try { await g.picksDone(); } catch (e) { console.log('picks', e.message); }
  return board;
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
        const w = String(url.searchParams.get('wh') || '');
        return json(await game(env).chart(d, /^\d+$/.test(w) ? w : ''));
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
      if (url.pathname === '/diag' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || ''))) return json({ err: 'id needed' }, 400);
        return json(await game(env).diag(String(b.id), b.name, b.ver, b.lines));
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
      if (url.pathname === '/ann') {
        if (req.method === 'POST') {
          const b = await req.json().catch(() => ({}));
          if (!/^\d+$/.test(String(b.id || '')) || !b.aid) return json({ err: 'id and aid needed' }, 400);
          return json(await game(env).annSeen(String(b.id), String(b.aid)));
        }
        const id = String(url.searchParams.get('id') || '');
        if (!/^\d+$/.test(id)) return json({ err: 'id needed' }, 400);
        return json(await game(env).ann(id));
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
      if (url.pathname === '/be') return json(await game(env).be());
      if (url.pathname === '/err' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!/^\d+$/.test(String(b.id || '')) || !/^\d+$/.test(String(b.picklist || ''))) return json({ err: 'id and picklist needed' }, 400);
        return json(await game(env).err(String(b.id), String(b.picklist)));
      }
      if (url.pathname === '/profile') {
        const id = url.searchParams.get('id');
        if (!/^\d+$/.test(id || '')) return json({ err: 'id needed' }, 400);
        const v = Math.round(parseFloat(url.searchParams.get('v') || '0') * 100) || 0; // 3.92 → 392
        return json(await game(env).profile(id, v));
      }
      if ((url.pathname === '/buy' || url.pathname === '/equip' || url.pathname === '/crate' || url.pathname === '/color' || url.pathname === '/fx') && req.method === 'POST') {
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
