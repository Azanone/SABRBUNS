// Leaderboard game state (pure functions, no Cloudflare stuff, so it can be tested anywhere)
//  · board: points per person in the last 15 min (multi 2, single 1.334, lines with has_parts don't count)
//  · today: every closed picklist counted once per day (Amsterdam date of closed_at)
//  · coins: every packing point = 1 coin, + 20 coins per minute as king of the hill (#1 with 15+ points)
//  · skins: bought with coins, 1 equipped

export const MULTI = 2, SINGLE = 1.334;
export const KING_MIN_POINTS = 15;   // green or better in the last 15 min
export const KING_PER_MIN = 20;
export const SKINS = [
  { id: 'midnight', name: 'Midnight', price: 500 },
  { id: 'forest', name: 'Forest', price: 800 },
  { id: 'ocean', name: 'Ocean', price: 800 },
  { id: 'sunset', name: 'Sunset', price: 1500 },
  { id: 'carbon', name: 'Carbon', price: 2500 },
  { id: 'aurora', name: 'Aurora', price: 4000 },
  { id: 'voidescent', name: 'Voidescent', price: 6000, limit: 10 }, // only 10 people can own it
  { id: 'gold', name: 'Gold', price: 8000 },
  { id: 'crown', name: 'Crown', price: 15000 },
];
const r3 = (x) => Math.round(x * 1000) / 1000;

export function pointsOf(p) {
  const codes = new Set((p.products || []).filter((x) => !x.has_parts).map((x) => x.productcode));
  if (!codes.size) return null;
  return codes.size >= 2 ? { multi: 1, single: 0, pts: MULTI } : { multi: 0, single: 1, pts: SINGLE };
}
export function newState() { return { v: 1, seen: {}, days: {}, acct: {}, king: null, board: null }; }
const acct = (st, id) => (st.acct[id] = st.acct[id] || { coins: 0, spent: 0, owned: [], skin: null, kingTotal: 0, kingBest: 0, picklists: 0 });
const dayRow = (st, d, id) => { st.days[d] = st.days[d] || {}; return (st.days[d][id] = st.days[d][id] || { n: 0, multis: 0, singles: 0, points: 0, kingMin: 0 }); };

// rows = closed picklists of the last `min` minutes · now = ms · today = 'YYYY-MM-DD' (Amsterdam)
export function tick(st, rows, { now, min = 15, today, proxies = [], wh = '' }) {
  const skip = new Set(proxies.map(String));
  const by = new Map();
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
    const t = dayRow(st, d, id);
    t.n++; t.multis += pt.multi; t.singles += pt.single; t.points = r3(t.points + pt.pts);
    const a = acct(st, id);
    a.coins = r3(a.coins + pt.pts); a.picklists++;
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
      a.coins = r3(a.coins + add * KING_PER_MIN);
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
  st.board = { at: now, min, wh, people, king: st.king ? { id: st.king.id, since: st.king.since, min: Math.floor((now - st.king.since) / 60000) } : null };
  return st.board;
}

const owners = (st, skin) => Object.values(st.acct).filter((a) => (a.owned || []).includes(skin)).length;
const shop = (st) => SKINS.map((s) => (s.limit ? { ...s, left: Math.max(0, s.limit - owners(st, s.id)) } : s));

export function profile(st, id, today) {
  id = String(id);
  const a = st.acct[id] || { coins: 0, spent: 0, owned: [], skin: null, kingTotal: 0, kingBest: 0, picklists: 0 };
  const day = st.days[today] || {};
  const ranked = Object.entries(day).sort((x, y) => y[1].points - x[1].points);
  const pos = ranked.findIndex(([k]) => k === id);
  const week = Object.entries(st.days).filter(([d]) => d <= today).slice(-7).map(([d, v]) => ({ day: d, ...(v[id] || { n: 0, points: 0, kingMin: 0 }) }));
  return {
    id, today: day[id] || { n: 0, multis: 0, singles: 0, points: 0, kingMin: 0 }, rankToday: pos < 0 ? null : pos + 1, ofToday: ranked.length,
    balance: r3(a.coins - a.spent), coins: a.coins, spent: a.spent, owned: a.owned, skin: a.skin, kingTotal: a.kingTotal, kingBest: a.kingBest, picklists: a.picklists,
    king: st.king && st.king.id === id ? { min: Math.floor((Date.now() - st.king.since) / 60000) } : null,
    week, skins: shop(st),
  };
}

export function buy(st, id, skin) {
  id = String(id);
  const s = SKINS.find((x) => x.id === skin);
  if (!s) return { err: 'no such skin' };
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
