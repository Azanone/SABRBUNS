// Leaderboard game state (pure functions, no Cloudflare stuff, so it can be tested anywhere)
//  · board: points per person in the last 15 min (multi 2, single 1.334, lines with has_parts don't count)
//  · today: every closed picklist counted once per day (Amsterdam date of closed_at)
//  · coins: every packing point = 1 coin, + 20 coins per minute as king of the hill (#1 with 15+ points)
//  · skins: bought with coins, 1 equipped
//  · picking: per batch (assigned picker) 3 points per different location + 0,2 per product picked there
//  · drops: every packed picklist / picked batch can drop a crate (common … legendary) into your inventory
//  · items from crates: boost, shield, freeze, skin off, double points event

export const MULTI = 2, SINGLE = 1.334;
export const KING_MIN_POINTS = 21;   // green or better in the last 15 min
export const KING_PER_MIN = 20;
export const SKINS = [
  { id: 'midnight', name: 'Midnight', price: 500 },
  { id: 'forest', name: 'Forest', price: 800 },
  { id: 'ocean', name: 'Ocean', price: 800 },
  { id: 'sakura', name: 'Sakura', price: 1200 },
  { id: 'arctic', name: 'Arctic', price: 1200 },
  { id: 'sunset', name: 'Sunset', price: 1500 },
  { id: 'emerald', name: 'Emerald', price: 3000 },
  { id: 'aurora', name: 'Aurora', price: 4000 },
  { id: 'lava', name: 'Lava', price: 6000 },
  { id: 'gold', name: 'Gold', price: 8000 },
  { id: 'nebula', name: 'Nebula', price: 12000 },
  { id: 'crown', name: 'Crown', price: 15000 },
  { id: 'neon', name: 'Neon', price: 20000 },
  { id: 'carbon', name: 'Carbon', price: 25000 },
  { id: 'voidescent', name: 'Voidescent', price: 50000, limit: 10 }, // limited edition: only 10 people can own it
  // only from drop crates
  { id: 'phantom', name: 'Phantom', price: 15000, crateOnly: true },
  { id: 'inferno', name: 'Inferno', price: 30000, crateOnly: true },
  { id: 'celestial', name: 'Celestial', price: 60000, crateOnly: true },
];
export const PICK_LOC = 3, PICK_ITEM = 0.2;
export const PITY = 3000;          // this many rolls without a rare or better = a rare crate for sure
export const STREAK_GOAL = 100;    // points in a day (packing + picking) to keep your streak
export const HIT_COOLDOWN = 120;   // min: the same person can't be frozen (or skin off'd) again for this long
export const FEED_TIERS = ['epic', 'legendary'];
const TRADE_TTL = { pending: 10 * 60000, open: 20 * 60000, done: 3 * 60000, closed: 3 * 60000 };
// drop chance per packed picklist (a picked batch counts as 3 rolls). 1 in N.
export const TIERS = [
  { id: 'legendary', name: 'Legendary', one: 30000 },
  { id: 'epic', name: 'Epic', one: 8000 },
  { id: 'rare', name: 'Rare', one: 2000 },
  { id: 'uncommon', name: 'Uncommon', one: 500 },
  { id: 'common', name: 'Common', one: 150 },
];
export const ITEMS = {
  boost: { name: 'Coin boost', desc: 'your coins x2 for 30 min', self: true, min: 30 },
  shield: { name: 'Shield', desc: 'blocks the next freeze or skin off on you (24 h)', self: true, min: 24 * 60 },
  freeze: { name: 'Freeze', desc: "someone's coins stop for 20 min", target: true, min: 20 },
  skinoff: { name: 'Skin off', desc: "someone's skin is gone for 30 min", target: true, min: 30 },
  double: { name: 'Double points event', desc: 'everyone gets x2 coins for 1 hour', self: true, min: 60 },
};
// what a drop crate can hold, weights per tier
const LOOT = {
  common: [['coins', 60, 50, 150], ['boost', 20], ['shield', 20]],
  uncommon: [['coins', 45, 200, 500], ['boost', 15], ['shield', 10], ['freeze', 15], ['skinoff', 15]],
  rare: [['coins', 35, 800, 2000], ['freeze', 15], ['skinoff', 15], ['double', 20], ['skin:phantom', 15]],
  epic: [['coins', 30, 3000, 6000], ['double', 25], ['skin:phantom', 20], ['skin:inferno', 25]],
  legendary: [['coins', 25, 10000, 20000], ['double', 15], ['skin:inferno', 30], ['skin:celestial', 30]],
};
// crate: pay, spin, get a skin. Weights out of 10.000. Crown, Carbon and Voidescent are very rare.
// Already have it? You get a quarter of its shop price back in coins.
export const CRATE = {
  price: 2000, back: 0.25,
  odds: [['midnight', 2400], ['forest', 1700], ['ocean', 1700], ['sakura', 1500], ['arctic', 1500], ['sunset', 1200], ['emerald', 800], ['gold', 600],
    ['lava', 300], ['aurora', 300], ['nebula', 40], ['neon', 25], ['crown', 20], ['carbon', 15], ['voidescent', 5]],
};
const r3 = (x) => Math.round(x * 1000) / 1000;

export function pointsOf(p) {
  const codes = new Set((p.products || []).filter((x) => !x.has_parts).map((x) => x.productcode));
  if (!codes.size) return null;
  return codes.size >= 2 ? { multi: 1, single: 0, pts: MULTI } : { multi: 0, single: 1, pts: SINGLE };
}
export function newState() { return { v: 1, seen: {}, days: {}, acct: {}, king: null, board: null }; }
const ensure = (st) => {
  st.hours = st.hours || {}; st.seenH = st.seenH || {}; st.pdays = st.pdays || {}; st.pseen = st.pseen || []; st.precent = st.precent || [];
  st.event = st.event || null; st.log = st.log || [];
  return st;
};
// coins with effects: frozen = 0 · double event and own boost = x2 each
export function earn(st, id, amount, now) {
  const a = acct(st, id);
  if (a.frozenUntil > now) return 0;
  let x = amount;
  if (st.event && st.event.until > now) x *= 2;
  if (a.boostUntil > now) x *= 2;
  a.coins = r3(a.coins + x);
  return x;
}
// maybe a crate drops (rolls = how many tries) · pity: PITY rolls in a row without rare or better = a rare
function giveCrate(st, id, tier, now, rnd, pity) {
  const a = acct(st, id), t = TIERS.find((x) => x.id === tier);
  a.inv = a.inv || [];
  const uid = `${now.toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;
  a.inv.push({ uid, kind: 'crate', tier, at: now });
  a.news = (a.news || []).concat({ at: now, kind: 'crate', tier, one: t.one, uid, ...(pity ? { pity: true } : {}) }).slice(-20);
  st.log = (st.log || []).concat({ at: now, id, what: `${t.name} crate${pity ? ' (pity)' : ''}` }).slice(-50);
  if (FEED_TIERS.includes(tier)) st.feed = (st.feed || []).concat({ at: now, id, tier }).slice(-20);
  return uid;
}
function rollDrop(st, id, rolls, now, rnd) {
  const a = acct(st, id);
  for (let i = 0; i < rolls; i++) {
    const x = rnd();
    let acc = 0, got = null;
    for (const t of TIERS) { acc += 1 / t.one; if (x < acc) { got = t.id; break; } }
    a.dry = (a.dry || 0) + 1;
    if (got) { giveCrate(st, id, got, now, rnd); if (['rare', 'epic', 'legendary'].includes(got)) a.dry = 0; }
    else if (a.dry >= PITY) { giveCrate(st, id, 'rare', now, rnd, true); a.dry = 0; }
  }
}
// streak: hit STREAK_GOAL points in a day. Days you didn't work at all don't break it, a worked day under the goal does.
const dayTotal = (st, d, id) => (((st.days[d] || {})[id] || {}).points || 0) + ((((st.pdays || {})[d] || {})[id] || {}).points || 0);
export function streakCheck(st, id, today, now, rnd = Math.random) {
  const a = acct(st, id);
  if (a.streakDay === today || dayTotal(st, today, id) < STREAK_GOAL) return null;
  const worked = [...new Set([...Object.keys(st.days), ...Object.keys(st.pdays || {})])].filter((d) => d < today && dayTotal(st, d, id) > 0).sort();
  const prev = worked[worked.length - 1];
  a.streak = (prev ? prev === a.streakDay : !!a.streakDay) ? (a.streak || 0) + 1 : 1;
  a.streakDay = today;
  a.streakBest = Math.max(a.streakBest || 0, a.streak);
  const coins = Math.min(500, 50 * a.streak);
  a.coins = r3(a.coins + coins);
  const tier = a.streak % 10 === 0 ? 'rare' : a.streak % 5 === 0 ? 'uncommon' : null;
  if (tier) giveCrate(st, id, tier, now, rnd);
  a.news = (a.news || []).concat({ at: now + 1, kind: 'streak', n: a.streak, coins, tier }).slice(-20);
  return a.streak;
}
const acct = (st, id) => (st.acct[id] = st.acct[id] || { coins: 0, spent: 0, owned: [], skin: null, kingTotal: 0, kingBest: 0, picklists: 0 });
const dayRow = (st, d, id) => { st.days[d] = st.days[d] || {}; return (st.days[d][id] = st.days[d][id] || { n: 0, multis: 0, singles: 0, points: 0, kingMin: 0 }); };

// one time: Ahmad (owner) gets every skin
export function giftAll(st) {
  if (st.giftAll1) return;
  const a = acct(st, '32247');
  for (const sk of SKINS) if (!a.owned.includes(sk.id)) a.owned.push(sk.id);
  st.giftAll1 = true;
}
// rows = closed picklists of the last `min` minutes · now = ms · today = 'YYYY-MM-DD' (Amsterdam)
export function tick(st, rows, { now, min = 15, today, proxies = [], wh = '', rnd = Math.random }) {
  ensure(st);
  giftAll(st);
  const skip = new Set(proxies.map(String));
  const by = new Map();
  // the chart: every closed picklist of the warehouse per hour (like Picqer's dashboard), kept for months
  for (const p of rows) {
    const d = String(p.closed_at || today).slice(0, 10), h = +String(p.closed_at || '').slice(11, 13) || 0;
    st.seenH[d] = st.seenH[d] || {};
    if (st.seenH[d][p.idpicklist]) continue;
    st.seenH[d][p.idpicklist] = 1;
    st.hours[d] = st.hours[d] || { packed: Array(24).fill(0), picked: Array(24).fill(0) };
    st.hours[d].packed[h]++;
  }
  for (const p of rows) {
    const id = p.closed_by_iduser == null ? null : String(p.closed_by_iduser);
    if (!id || skip.has(id)) continue;
    const pt = pointsOf(p);
    if (!pt) continue;
    // the board: last 15 min
    const b = by.get(id) || { id, picklists: 0, multis: 0, singles: 0, points: 0 };
    b.picklists++; b.multis += pt.multi; b.singles += pt.single; b.points = r3(b.points + pt.pts);
    by.set(id, b);
    // today + coins: each picklist once
    const d = String(p.closed_at || today).slice(0, 10);
    st.seen[d] = st.seen[d] || {};
    if (st.seen[d][p.idpicklist]) continue;
    st.seen[d][p.idpicklist] = 1;
    totalPoints(st, id); // older accounts: count up what we had before this picklist
    const t = dayRow(st, d, id);
    t.n++; t.multis += pt.multi; t.singles += pt.single; t.points = r3(t.points + pt.pts);
    const a = acct(st, id);
    earn(st, id, pt.pts, now); a.picklists++;
    a.points = r3(a.points + pt.pts);
    rollDrop(st, id, 1, now, rnd);
    if (d === today) streakCheck(st, id, today, now, rnd);
  }
  const people = [...by.values()].sort((a, b) => b.points - a.points || b.picklists - a.picklists);
  // king of the hill
  const need = KING_MIN_POINTS * min / 15;
  const top = people[0] && people[0].points >= need ? people[0] : null;
  const k = st.king;
  if (!top) st.king = null;
  else if (k && (k.id === top.id || (by.get(k.id) && by.get(k.id).points === top.points))) { // still on top (a tie keeps the king)
    const add = Math.min(3, Math.floor((now - k.last) / 60000));
    if (add > 0) {
      const a = acct(st, k.id);
      earn(st, k.id, add * KING_PER_MIN, now);
      a.kingTotal += add;
      dayRow(st, today, k.id).kingMin += add;
      k.last += add * 60000;
    }
    acct(st, k.id).kingBest = Math.max(acct(st, k.id).kingBest, Math.floor((now - k.since) / 60000));
  } else st.king = { id: top.id, since: now, last: now };
  // keep 8 days of stats, 2 days of "seen"
  const keepDays = Object.keys(st.days).sort().slice(-8);
  for (const d of Object.keys(st.days)) if (!keepDays.includes(d)) delete st.days[d];
  const keepSeen = Object.keys(st.seen).sort().slice(-2);
  for (const d of Object.keys(st.seen)) if (!keepSeen.includes(d)) delete st.seen[d];
  for (const d of Object.keys(st.seenH).sort().slice(0, -2)) delete st.seenH[d];
  for (const d of Object.keys(st.hours).sort().slice(0, -120)) delete st.hours[d];
  for (const d of Object.keys(st.pdays).sort().slice(0, -8)) delete st.pdays[d];
  if (st.event && st.event.until <= now) st.event = null;
  st.feed = (st.feed || []).filter((x) => now - x.at < 6 * 3600000);
  st.board = { at: now, min, wh, people, feed: st.feed, event: st.event ? { until: st.event.until, by: st.event.by } : null, king: st.king ? { id: st.king.id, since: st.king.since, min: Math.floor((now - st.king.since) / 60000) } : null };
  return st.board;
}

const owners = (st, skin) => Object.values(st.acct).filter((a) => (a.owned || []).includes(skin)).length;
const shop = (st) => SKINS.map((s) => (s.limit ? { ...s, left: Math.max(0, s.limit - owners(st, s.id)) } : s));

// all packing points ever (king coins and given coins don't count). Older accounts: start from the days we still have.
function totalPoints(st, id) {
  const a = acct(st, id);
  if (a.points == null) a.points = r3(Object.values(st.days).reduce((sum, d) => sum + ((d[id] && d[id].points) || 0), 0));
  return a.points;
}
// everyone, most points first
export function totals(st) {
  return Object.keys(st.acct).map((id) => {
    const a = st.acct[id];
    return { id, points: totalPoints(st, id), picklists: a.picklists || 0, pickPoints: a.pickPoints || 0, batches: a.batches || 0, kingTotal: a.kingTotal || 0, kingBest: a.kingBest || 0, coins: a.coins || 0, balance: r3(a.coins - a.spent) };
  }).filter((x) => x.points > 0 || x.picklists > 0 || x.balance > 0 || x.pickPoints > 0).sort((x, y) => y.balance - x.balance || y.points - x.points);
}

export function profile(st, id, today, now = Date.now()) {
  id = String(id);
  const a = st.acct[id] || { coins: 0, spent: 0, owned: [], skin: null, kingTotal: 0, kingBest: 0, picklists: 0 };
  const day = st.days[today] || {};
  const ranked = Object.entries(day).sort((x, y) => y[1].points - x[1].points);
  const pos = ranked.findIndex(([k]) => k === id);
  const week = Object.entries(st.days).filter(([d]) => d <= today).slice(-7).map(([d, v]) => ({ day: d, ...(v[id] || { n: 0, points: 0, kingMin: 0 }) }));
  return {
    id, today: day[id] || { n: 0, multis: 0, singles: 0, points: 0, kingMin: 0 }, rankToday: pos < 0 ? null : pos + 1, ofToday: ranked.length,
    balance: r3(a.coins - a.spent), coins: a.coins, spent: a.spent, points: st.acct[id] ? totalPoints(st, id) : 0, owned: a.owned,
    skin: a.skinOffUntil > now ? null : a.skin, mySkin: a.skin, kingTotal: a.kingTotal, kingBest: a.kingBest, picklists: a.picklists,
    pickPoints: a.pickPoints || 0, batches: a.batches || 0, pickToday: ((st.pdays || {})[today] || {})[id] || { batches: 0, locations: 0, items: 0, points: 0 },
    inv: a.inv || [], news: a.news || [], items: ITEMS, tiers: TIERS,
    effects: { frozenUntil: a.frozenUntil || 0, skinOffUntil: a.skinOffUntil || 0, boostUntil: a.boostUntil || 0, shieldUntil: a.shieldUntil || 0 },
    event: st.event && st.event.until > now ? st.event : null,
    streak: { n: a.streak || 0, day: a.streakDay || null, best: a.streakBest || 0, goal: STREAK_GOAL, today: r3(dayTotal(st, today, id)) },
    pity: { dry: a.dry || 0, at: PITY }, cooldown: HIT_COOLDOWN, trades: tradesFor(st, id, now),
    king: st.king && st.king.id === id ? { min: Math.floor((Date.now() - st.king.since) / 60000) } : null,
    week, skins: shop(st), crate: crateInfo(st, a), crates: a.crates || 0,
  };
}

// which skins can still come out of a crate for this person (a sold-out limited one only if they already have it)
function cratePool(st, a) {
  return CRATE.odds.filter(([s]) => { const sk = SKINS.find((x) => x.id === s); return !(sk.limit && !a.owned.includes(s) && owners(st, s) >= sk.limit); });
}
function crateInfo(st, a) {
  const pool = cratePool(st, a), tot = pool.reduce((n, [, w]) => n + w, 0);
  return { price: CRATE.price, odds: pool.map(([id, w]) => ({ id, pct: Math.round((w / tot) * 10000) / 100 })) };
}
export function crate(st, id, rnd = Math.random) {
  id = String(id);
  const a = acct(st, id);
  if (a.coins - a.spent < CRATE.price) return { err: `not enough coins (${Math.floor(a.coins - a.spent)} of ${CRATE.price})` };
  const pool = cratePool(st, a), tot = pool.reduce((n, [, w]) => n + w, 0);
  let x = rnd() * tot, won = pool[pool.length - 1][0];
  for (const [s, w] of pool) { if (x < w) { won = s; break; } x -= w; }
  a.spent += CRATE.price;
  a.crates = (a.crates || 0) + 1;
  const sk = SKINS.find((s) => s.id === won);
  const dup = a.owned.includes(won);
  let back = 0;
  if (dup) { back = Math.round(sk.price * CRATE.back); a.coins = r3(a.coins + back); } else a.owned.push(won);
  return { ok: true, won, dup, back };
}

export function buy(st, id, skin) {
  id = String(id);
  const s = SKINS.find((x) => x.id === skin);
  if (!s) return { err: 'no such skin' };
  if (s.crateOnly && !acct(st, id).owned.includes(skin)) return { err: `${s.name} only comes out of drop crates` };
  const a = acct(st, id);
  if (!a.owned.includes(skin)) {
    if (s.limit && owners(st, skin) >= s.limit) return { err: `sold out (only ${s.limit} people can have ${s.name})` };
    if (a.coins - a.spent < s.price) return { err: `not enough coins (${Math.floor(a.coins - a.spent)} of ${s.price})` };
    a.spent += s.price;
    a.owned.push(skin);
  }
  a.skin = skin;
  return { ok: true };
}
export function equip(st, id, skin) {
  const a = acct(st, String(id));
  if (skin && !a.owned.includes(skin)) return { err: 'not bought yet' };
  a.skin = skin || null;
  return { ok: true };
}

// admin: add (or with a minus, take) coins
export function grant(st, id, coins) {
  const n = Number(coins);
  if (!Number.isFinite(n)) return { err: 'coins must be a number' };
  const a = acct(st, String(id));
  a.coins = r3(a.coins + n);
  return { ok: true };
}

// ---------- picking ----------
// batch = a completed batch from Picqer (with products[].stock_location and products[].picklists[].amount_picked)
export function batchPoints(b) {
  const locs = new Map();
  for (const pr of b.products || []) {
    const loc = String(pr.stock_location || '').trim() || '?';
    const n = (pr.picklists || []).reduce((s, x) => s + (+x.amount_picked || 0), 0);
    if (!n) continue;
    locs.set(loc, (locs.get(loc) || 0) + n);
  }
  const items = [...locs.values()].reduce((s, n) => s + n, 0);
  return { locations: locs.size, items, points: r3(locs.size * PICK_LOC + items * PICK_ITEM) };
}
export const pickerOf = (b) => String((b.assigned_to && b.assigned_to.iduser) || (b.completed_by && b.completed_by.iduser) || '');
// batches = details of newly completed batches · each batch counts once
export function pickTick(st, batches, { now, today, proxies = [], rnd = Math.random }) {
  ensure(st);
  const skip = new Set(proxies.map(String));
  for (const b of batches) {
    const bid = String(b.idpicklist_batch);
    if (st.pseen.includes(bid)) continue;
    st.pseen.push(bid);
    const id = pickerOf(b);
    if (!id || skip.has(id)) continue;
    const pt = batchPoints(b);
    if (!pt.points) continue;
    const d = String(b.completed_at || today).slice(0, 10), h = +String(b.completed_at || '').slice(11, 13) || 0;
    st.pdays[d] = st.pdays[d] || {};
    const r = (st.pdays[d][id] = st.pdays[d][id] || { batches: 0, locations: 0, items: 0, points: 0 });
    r.batches++; r.locations += pt.locations; r.items += pt.items; r.points = r3(r.points + pt.points);
    st.hours[d] = st.hours[d] || { packed: Array(24).fill(0), picked: Array(24).fill(0) };
    st.hours[d].picked[h] = r3((st.hours[d].picked[h] || 0) + pt.points);
    const a = acct(st, id);
    a.pickPoints = r3((a.pickPoints || 0) + pt.points);
    a.batches = (a.batches || 0) + 1;
    earn(st, id, pt.points, now);
    st.precent.push({ id, at: now, points: pt.points });
    rollDrop(st, id, 3, now, rnd);
    if (d === today) streakCheck(st, id, today, now, rnd);
  }
  st.pseen = st.pseen.slice(-600);
  st.precent = st.precent.filter((x) => now - x.at < 2 * 3600000);
  return pickBoard(st, now, today);
}
export function pickBoard(st, now, today) {
  ensure(st);
  const day = st.pdays[today] || {};
  const hour = {};
  for (const x of st.precent) if (now - x.at < 3600000) hour[x.id] = r3((hour[x.id] || 0) + x.points);
  const ids = new Set([...Object.keys(day), ...Object.keys(hour)]);
  const people = [...ids].map((id) => ({ id, ...(day[id] || { batches: 0, locations: 0, items: 0, points: 0 }), hour: hour[id] || 0 }))
    .sort((a, b) => b.points - a.points || b.hour - a.hour);
  return { at: now, day: today, people };
}
export function chart(st, date) {
  ensure(st);
  const h = st.hours[date];
  return { date, have: !!h, packed: h ? h.packed : Array(24).fill(0), picked: h ? h.picked : Array(24).fill(0) };
}

// ---------- inventory: open a drop crate, use an item ----------
function pick(rnd, list) {
  const tot = list.reduce((n, x) => n + x[1], 0);
  let x = rnd() * tot;
  for (const it of list) { if (x < it[1]) return it; x -= it[1]; }
  return list[list.length - 1];
}
export function openDrop(st, id, uid, now, rnd = Math.random) {
  id = String(id);
  const a = acct(st, id);
  const i = (a.inv || []).findIndex((x) => x.uid === uid && x.kind === 'crate');
  if (i < 0) return { err: 'no such crate' };
  const c = a.inv[i];
  a.inv.splice(i, 1);
  const it = pick(rnd, LOOT[c.tier] || LOOT.common);
  let got;
  if (it[0] === 'coins') {
    const n = Math.round(it[2] + rnd() * (it[3] - it[2]));
    a.coins = r3(a.coins + n);
    got = { kind: 'coins', coins: n };
  } else if (it[0].startsWith('skin:')) {
    const skin = it[0].slice(5), sk = SKINS.find((x) => x.id === skin);
    if (a.owned.includes(skin)) { const back = Math.round(sk.price * 0.25); a.coins = r3(a.coins + back); got = { kind: 'skin', skin, dup: true, coins: back }; }
    else { a.owned.push(skin); got = { kind: 'skin', skin }; }
  } else {
    const nu = `${now.toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;
    a.inv.push({ uid: nu, kind: 'item', item: it[0], at: now });
    got = { kind: 'item', item: it[0], uid: nu };
  }
  st.log = (st.log || []).concat({ at: now, id, what: `opened ${c.tier} crate` }).slice(-50);
  return { ok: true, tier: c.tier, got };
}
export function useItem(st, id, uid, target, now) {
  id = String(id);
  const a = acct(st, id);
  const i = (a.inv || []).findIndex((x) => x.uid === uid && x.kind === 'item');
  if (i < 0) return { err: 'no such item' };
  const item = a.inv[i].item, def = ITEMS[item];
  if (!def) return { err: 'unknown item' };
  const until = now + def.min * 60000;
  if (def.target) {
    target = String(target || '');
    if (!target || target === id) return { err: 'pick someone else' };
    if (!st.acct[target]) return { err: 'that person has no account here yet' };
    const t = acct(st, target);
    const last = (t.hitAt || {})[item] || 0;
    if (now - last < HIT_COOLDOWN * 60000) return { err: `they already got a ${def.name} ${Math.floor((now - last) / 60000)} min ago · again in ${Math.ceil((last + HIT_COOLDOWN * 60000 - now) / 60000)} min` };
    a.inv.splice(i, 1);
    if (t.shieldUntil > now) { t.shieldUntil = 0; t.news = (t.news || []).concat({ at: now, kind: 'blocked', item, from: id }).slice(-20); return { ok: true, blocked: true }; }
    t.hitAt = { ...(t.hitAt || {}), [item]: now };
    if (item === 'freeze') t.frozenUntil = Math.max(t.frozenUntil || 0, until);
    if (item === 'skinoff') t.skinOffUntil = Math.max(t.skinOffUntil || 0, until);
    t.news = (t.news || []).concat({ at: now, kind: 'hit', item, from: id, until }).slice(-20);
    st.log = (st.log || []).concat({ at: now, id, what: `${def.name} on ${target}` }).slice(-50);
    return { ok: true, until };
  }
  a.inv.splice(i, 1);
  if (item === 'boost') a.boostUntil = Math.max(a.boostUntil || 0, now) + def.min * 60000;
  if (item === 'shield') a.shieldUntil = until;
  if (item === 'double') st.event = { kind: 'double', until: Math.max((st.event && st.event.until) || 0, now) + def.min * 60000, by: id };
  st.log = (st.log || []).concat({ at: now, id, what: def.name }).slice(-50);
  return { ok: true, until };
}

// ---------- trading: request → the other accepts → both put things in → both agree → swap ----------
const side = () => ({ coins: 0, uids: [], skins: [] });
function tradeClean(st, now) {
  st.trades = st.trades || {};
  for (const t of Object.values(st.trades)) if (now - t.touched > (TRADE_TTL[t.status] || 60000)) delete st.trades[t.id];
}
function sideView(st, owner, o) {
  const a = st.acct[owner] || { inv: [] };
  return { coins: o.coins, skins: o.skins, items: o.uids.map((u) => (a.inv || []).find((x) => x.uid === u)).filter(Boolean) };
}
export function tradesFor(st, id, now) {
  tradeClean(st, now);
  return Object.values(st.trades).filter((t) => t.from === id || t.to === id).map((t) => ({
    id: t.id, from: t.from, to: t.to, status: t.status, why: t.why || '', at: t.at, ok: t.ok,
    offer: { [t.from]: sideView(st, t.from, t.offer[t.from]), [t.to]: sideView(st, t.to, t.offer[t.to]) },
  }));
}
function checkSide(st, owner, other, o) {
  const a = acct(st, owner), b = acct(st, other);
  if (!(o.coins >= 0) || o.coins > r3(a.coins - a.spent)) return 'not enough coins';
  for (const u of o.uids) if (!(a.inv || []).some((x) => x.uid === u)) return 'an item is not there anymore';
  for (const s of o.skins) {
    if (!(a.owned || []).includes(s)) return 'a skin is not there anymore';
    if ((b.owned || []).includes(s)) return `they already have ${(SKINS.find((x) => x.id === s) || {}).name || s}`;
  }
  return '';
}
export function tradeOp(st, id, op, b, now) {
  ensure(st);
  tradeClean(st, now);
  id = String(id);
  if (op === 'request') {
    const to = String(b.to || '');
    if (!to || to === id) return { err: 'pick someone else' };
    if (!st.acct[to]) return { err: 'that person has no account here yet' };
    const busy = Object.values(st.trades).find((t) => ['pending', 'open'].includes(t.status) && [t.from, t.to].includes(id) && [t.from, t.to].includes(to));
    if (busy) return { ok: true, trade: busy.id };
    if (Object.values(st.trades).filter((t) => t.from === id && t.status === 'pending').length >= 3) return { err: 'you already have 3 requests waiting' };
    const tid = `t${now.toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
    st.trades[tid] = { id: tid, from: id, to, status: 'pending', at: now, touched: now, offer: { [id]: side(), [to]: side() }, ok: {} };
    return { ok: true, trade: tid };
  }
  const t = st.trades[String(b.trade || '')];
  if (!t || (t.from !== id && t.to !== id)) return { err: 'that trade is gone' };
  const other = t.from === id ? t.to : t.from;
  t.touched = now;
  if (op === 'accept') {
    if (t.to !== id || t.status !== 'pending') return { err: 'cannot accept that' };
    t.status = 'open';
    return { ok: true };
  }
  if (op === 'decline' || op === 'cancel') {
    if (!['pending', 'open'].includes(t.status)) return { ok: true };
    t.status = 'closed';
    t.why = `${op === 'decline' ? 'declined' : 'cancelled'}:${id}`;
    return { ok: true };
  }
  if (t.status !== 'open') return { err: 'the trade is not open' };
  if (op === 'offer') {
    const o = { coins: Math.max(0, Math.round(Number(b.coins) || 0)), uids: [...new Set((b.uids || []).map(String))].slice(0, 30), skins: [...new Set((b.skins || []).map(String))].slice(0, 20) };
    const e = checkSide(st, id, other, o);
    if (e) return { err: e };
    t.offer[id] = o;
    t.ok = {};
    return { ok: true };
  }
  if (op === 'ok') {
    t.ok[id] = true;
    if (!t.ok[other]) return { ok: true };
    const e = checkSide(st, t.from, t.to, t.offer[t.from]) || checkSide(st, t.to, t.from, t.offer[t.to]);
    if (e) { t.ok = {}; return { err: e }; }
    for (const [g, r] of [[t.from, t.to], [t.to, t.from]]) {
      const o = t.offer[g], A = acct(st, g), B = acct(st, r);
      if (o.coins) { A.spent = r3(A.spent + o.coins); B.coins = r3(B.coins + o.coins); }
      for (const u of o.uids) { const i = A.inv.findIndex((x) => x.uid === u); if (i >= 0) { B.inv = B.inv || []; B.inv.push({ ...A.inv[i], at: now }); A.inv.splice(i, 1); } }
      for (const s of o.skins) { A.owned = A.owned.filter((x) => x !== s); if (A.skin === s) A.skin = null; if (!B.owned.includes(s)) B.owned.push(s); }
    }
    t.status = 'done';
    st.log = (st.log || []).concat({ at: now, id: t.from, what: `traded with ${t.to}` }).slice(-50);
    return { ok: true, done: true };
  }
  return { err: 'unknown' };
}

// ---------- live picking: open batches, how much is collected (amount_collected), checked every minute ----------
// Points like a completed batch (3 per location fully collected + 0,2 per product) but counted while picking.
// Only for the board (who is picking right now, last 15 min, how long idle). Coins still come when the batch is completed.
export const LIVE_ACTIVE_MIN = 60; // shown as "picking" when something was collected in the last hour
export function newLive() { return { b: {}, ev: [], last: {} }; }
function snap(d) {
  let items = 0, total = 0;
  const locs = {};
  for (const p of d.products || []) {
    const k = String(p.stock_location || p.idproduct);
    const L = (locs[k] = locs[k] || { need: 0, got: 0 });
    for (const x of p.picklists || []) { L.need += +x.amount || 0; L.got += Math.min(+x.amount_collected || 0, +x.amount || 0); }
  }
  let done = 0;
  for (const L of Object.values(locs)) { items += L.got; total += L.need; if (L.need > 0 && L.got >= L.need) done++; }
  return { items, total, locs: done, locTotal: Object.keys(locs).length };
}
// which open batches to look at this minute: new ones and busy ones every minute, quiet ones every 5 min
export function liveDue(L, open, now, max = 40) {
  L = L || newLive();
  const score = (b) => {
    const s = L.b[String(b.idpicklist_batch)];
    if (!s) return 0;
    if (now - (s.changed || 0) < 30 * 60000) return 1;
    return now - s.checked >= 5 * 60000 ? 2 : 9;
  };
  return open.map((b) => [score(b), b]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0]).slice(0, max).map(([, b]) => b);
}
export function liveTick(L, open, details, { now, proxies = [] }) {
  L = L || newLive();
  const skip = new Set(proxies.map(String));
  const openIds = new Set(open.map((b) => String(b.idpicklist_batch)));
  for (const k of Object.keys(L.b)) if (!openIds.has(k)) delete L.b[k];
  for (const d of details) {
    const bid = String(d.idpicklist_batch);
    const who = String((d.assigned_to && d.assigned_to.iduser) || '');
    if (!who || skip.has(who)) continue;
    const s = snap(d), prev = L.b[bid];
    let changed = prev ? prev.changed || 0 : 0;
    if (prev && prev.who === who) {
      const di = Math.max(0, s.items - prev.items), dl = Math.max(0, s.locs - prev.locs);
      if (di || dl) {
        L.ev.push({ id: who, at: now, items: di, locs: dl, pts: r3(dl * PICK_LOC + di * PICK_ITEM) });
        L.last[who] = now;
        changed = now;
      }
    }
    L.b[bid] = { who, ...s, checked: now, changed };
  }
  L.ev = L.ev.filter((e) => now - e.at < 60 * 60000);
  for (const k of Object.keys(L.last)) if (now - L.last[k] > 12 * 3600000) delete L.last[k];
  return L;
}
export function liveBoard(L, now) {
  L = L || newLive();
  const by = {};
  const row = (id) => (by[id] = by[id] || { m15: 0, items15: 0, locs15: 0, h60: 0, last: L.last[id] || 0, batch: null });
  for (const e of L.ev) {
    const r = row(e.id);
    r.h60 = r3(r.h60 + e.pts);
    if (now - e.at < 15 * 60000) { r.m15 = r3(r.m15 + e.pts); r.items15 += e.items; r.locs15 += e.locs; }
  }
  for (const id of Object.keys(L.last)) row(id);
  // the batch they're on now: the one that changed last
  for (const s of Object.values(L.b)) {
    const r = by[s.who];
    if (r && (!r.batch || s.changed > r.batch.changed)) r.batch = { items: s.items, total: s.total, locs: s.locs, locTotal: s.locTotal, changed: s.changed };
  }
  for (const r of Object.values(by)) { r.idleMin = r.last ? Math.floor((now - r.last) / 60000) : null; if (r.batch) delete r.batch.changed; }
  return by;
}
