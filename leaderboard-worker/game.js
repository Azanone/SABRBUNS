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
// not people (machines / packing robots): never on a board, never coins, gone from the game · always, also when PROXIES is set
export const NOT_PEOPLE = ['16983'];
export const SKINS = [
  // blue · common
  { id: 'midnight', name: 'Midnight', price: 500 },
  { id: 'mint', name: 'Mint', price: 600 },
  { id: 'lavender', name: 'Lavender', price: 600 },
  { id: 'peach', name: 'Peach', price: 600 },
  { id: 'slate', name: 'Slate', price: 700 },
  { id: 'lemon', name: 'Lemon', price: 700 },
  { id: 'coral', name: 'Coral', price: 700 },
  { id: 'forest', name: 'Forest', price: 800 },
  { id: 'ocean', name: 'Ocean', price: 800 },
  { id: 'sand', name: 'Sand', price: 800 },
  { id: 'berry', name: 'Berry', price: 800 },
  { id: 'denim', name: 'Denim', price: 900 },
  { id: 'checkered', name: 'Checkered', price: 1000 },
  { id: 'camo', name: 'Camo', price: 1000 },
  { id: 'sakura', name: 'Sakura', price: 1200 },
  { id: 'arctic', name: 'Arctic', price: 1200 },
  { id: 'navy', name: 'Navy', price: 1200 },
  { id: 'mono', name: 'Mono', price: 1200 },
  { id: 'wine', name: 'Wine', price: 1200 },
  { id: 'olive', name: 'Olive', price: 1200 },
  // purple
  { id: 'sunset', name: 'Sunset', price: 1500 },
  { id: 'emerald', name: 'Emerald', price: 3000 },
  { id: 'blueprint', name: 'Blueprint', price: 3000 },
  { id: 'amethyst', name: 'Amethyst', price: 3000 },
  { id: 'crimson', name: 'Crimson', price: 3000 },
  { id: 'jade', name: 'Jade', price: 3500 },
  { id: 'honey', name: 'Honey', price: 3500 },
  { id: 'tidal', name: 'Tidal', price: 3500 },
  { id: 'orchid', name: 'Orchid', price: 3500 },
  { id: 'copper', name: 'Copper', price: 4000 },
  { id: 'terminal', name: 'Terminal', price: 4000 },
  { id: 'nightshade', name: 'Nightshade', price: 4500 },
  { id: 'gold', name: 'Gold', price: 8000 },
  // pink
  { id: 'aurora', name: 'Aurora', price: 4000 },
  { id: 'lava', name: 'Lava', price: 6000 },
  { id: 'starlight', name: 'Starlight', price: 6000 },
  { id: 'retro', name: 'Retro', price: 6000 },
  { id: 'twilight', name: 'Twilight', price: 6500 },
  { id: 'hanami', name: 'Hanami', price: 7000, crateOnly: true },
  { id: 'obsidian', name: 'Obsidian', price: 7000, crateOnly: true },
  { id: 'sapphire', name: 'Sapphire', price: 7000 },
  { id: 'plasma', name: 'Plasma', price: 7500 },
  { id: 'rosegold', name: 'Rose Gold', price: 8000 },
  { id: 'koi', name: 'Koi', price: 8000 },
  { id: 'cyber', name: 'Cyber', price: 8000 },
  // red
  { id: 'nebula', name: 'Nebula', price: 12000 },
  { id: 'crown', name: 'Crown', price: 15000 },
  { id: 'toxic', name: 'Toxic', price: 18000 },
  { id: 'frostbite', name: 'Frostbite', price: 18000 },
  { id: 'neon', name: 'Neon', price: 20000 },
  { id: 'stormcell', name: 'Storm Cell', price: 20000 },
  { id: 'circuit', name: 'Circuit', price: 20000 },
  { id: 'abyss', name: 'Abyss', price: 20000, crateOnly: true },
  { id: 'coderain', name: 'Code Rain', price: 22000 },
  { id: 'synthwave', name: 'Synthwave', price: 22000 },
  { id: 'carbon', name: 'Carbon', price: 25000 },
  { id: 'hologram', name: 'Hologram', price: 25000 },
  { id: 'bloodmoon', name: 'Blood Moon', price: 25000 },
  // gold
  { id: 'dragonfire', name: 'Dragonfire', price: 40000 },
  { id: 'milkyway', name: 'Milky Way', price: 40000 },
  { id: 'supernova', name: 'Supernova', price: 45000 },
  { id: 'borealis', name: 'Borealis', price: 45000 },
  { id: 'singularity', name: 'Singularity', price: 50000, crateOnly: true },
  { id: 'diamond', name: 'Diamond', price: 60000 },
  // a color, not a skin: paints any animated skin red and black (like Brawlhalla colors). Still only 10 people can own it.
  { id: 'voidescent', name: 'Voidescent', price: 50000, limit: 10, color: true },
  // only from drop crates
  { id: 'phantom', name: 'Phantom', price: 15000, crateOnly: true },
  { id: 'inferno', name: 'Inferno', price: 30000, crateOnly: true },
  { id: 'celestial', name: 'Celestial', price: 60000, crateOnly: true },
  // only from the battle pass (season 1, level 25)
  { id: 'eclipse', name: 'Eclipse', price: 40000, passOnly: true },
];
export const isColor = (id) => !!(SKINS.find((x) => x.id === id) || {}).color;
// battle pass: pay once per season, XP = packing + picking points, rewards come by themselves at every level
// pass XP: 20 per multi, 13 per single, picking 10 per pick point (same ratio as the points)
export const XP_MULTI = 20, XP_SINGLE = 13, XP_PICK = 10;
export const SEASON = {
  id: 1, name: 'Season 1', ends: '2026-12-31', price: 10000, per: 1000,
  levels: [
    { coins: 500 }, { crate: 'common' }, { item: 'boost' }, { coins: 750 }, { crate: 'uncommon' },
    { item: 'shield' }, { coins: 1000 }, { item: 'freeze' }, { crate: 'uncommon' }, { crate: 'rare' },
    { coins: 1250 }, { item: 'skinoff' }, { item: 'double' }, { coins: 1500 }, { crate: 'rare' },
    { item: 'boost' }, { coins: 1750 }, { item: 'shield' }, { crate: 'epic' }, { coins: 2000 },
    { crate: 'rare' }, { item: 'double' }, { coins: 2500 }, { crate: 'epic' }, { skin: 'eclipse' },
  ],
};
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
  epic: [['coins', 30, 3000, 6000], ['double', 25], ['skin:phantom', 20], ['skin:inferno', 25], ['skin:hanami', 12], ['skin:obsidian', 12]],
  legendary: [['coins', 25, 10000, 20000], ['double', 15], ['skin:inferno', 30], ['skin:celestial', 30], ['skin:abyss', 15], ['skin:singularity', 10]],
};
// crate: pay, spin, get a skin. Weights per rarity (blue 275 · purple 190 · pink 105 · red ~40 · gold 12 · Voidescent 5).
// Already have it? You get a quarter of its shop price back in coins.
const W = (w, ids) => ids.map((id) => [id, w]);
// pity: 49 spins in a row without red or gold (weight 40 or less) = the 50th is red or gold for sure
export const CRATE_PITY = 50, RARE_W = 40;
export const CRATE = {
  price: 2000, back: 0.25,
  odds: [
    ...W(275, ['midnight', 'mint', 'lavender', 'peach', 'slate', 'lemon', 'coral', 'forest', 'ocean', 'sand', 'berry', 'denim', 'checkered', 'camo', 'sakura', 'arctic', 'navy', 'mono', 'wine', 'olive']),
    ...W(190, ['sunset', 'emerald', 'gold', 'blueprint', 'amethyst', 'crimson', 'jade', 'honey', 'tidal', 'orchid', 'copper', 'terminal', 'nightshade']),
    ...W(105, ['aurora', 'lava', 'starlight', 'retro', 'twilight', 'hanami', 'obsidian', 'sapphire', 'plasma', 'rosegold', 'koi', 'cyber']),
    ['nebula', 40], ['neon', 25], ['crown', 20], ['carbon', 15],
    ...W(40, ['toxic', 'frostbite', 'stormcell', 'circuit', 'abyss', 'coderain', 'synthwave', 'hologram', 'bloodmoon']),
    ...W(12, ['dragonfire', 'milkyway', 'supernova', 'borealis', 'singularity', 'diamond']),
    ['voidescent', 5],
  ],
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
// warehouses: the main one (Bunsenstraat) keeps st.hours like before, every other one gets its own (st.hoursBy[id])
const isMain = (st, wh) => !wh || !st.mainWh || String(wh) === String(st.mainWh);
const hoursOf = (st, wh) => { if (isMain(st, wh)) return st.hours; st.hoursBy = st.hoursBy || {}; return (st.hoursBy[wh] = st.hoursBy[wh] || {}); };
const hoursFor = (st, wh) => (isMain(st, wh) ? st.hours : ((st.hoursBy || {})[wh] || {}));
const hourRow = (H, d) => (H[d] = H[d] || { packed: Array(24).fill(0), picked: Array(24).fill(0) });
const whName = (st, wh) => ((st.whNames || {})[wh] || '');
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
function giveCrate(st, id, tier, now, rnd, pity, quiet) {
  const a = acct(st, id), t = TIERS.find((x) => x.id === tier);
  if (!quiet) a.found = { ...(a.found || {}), [tier]: ((a.found || {})[tier] || 0) + 1 };
  a.inv = a.inv || [];
  const uid = `${now.toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`;
  a.inv.push({ uid, kind: 'crate', tier, at: now });
  if (!quiet) a.news = (a.news || []).concat({ at: now, kind: 'crate', tier, one: t.one, uid, ...(pity ? { pity: true } : {}) }).slice(-20);
  st.log = (st.log || []).concat({ at: now, id, what: `${t.name} crate${pity ? ' (pity)' : ''}` }).slice(-50);
  if (!quiet && FEED_TIERS.includes(tier)) st.feed = (st.feed || []).concat({ at: now, id, tier }).slice(-20);
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
  qCount(a, 'streak', 1);
  a.streakBest = Math.max(a.streakBest || 0, a.streak);
  const coins = Math.min(500, 50 * a.streak);
  a.coins = r3(a.coins + coins);
  const tier = a.streak % 10 === 0 ? 'rare' : a.streak % 5 === 0 ? 'uncommon' : null;
  if (tier) giveCrate(st, id, tier, now, rnd);
  a.news = (a.news || []).concat({ at: now + 1, kind: 'streak', n: a.streak, coins, tier }).slice(-20);
  return a.streak;
}
const acct = (st, id) => (st.acct[id] = st.acct[id] || { coins: 0, spent: 0, owned: [], skin: null, color: null, kingTotal: 0, kingBest: 0, picklists: 0 });
const dayRow = (st, d, id) => { st.days[d] = st.days[d] || {}; return (st.days[d][id] = st.days[d][id] || { n: 0, multis: 0, singles: 0, points: 0, kingMin: 0 }); };

// once per new batch of skins: Ahmad (owner) gets every skin
export function giftAll(st) {
  if (st.giftAll2) return;
  const a = acct(st, '32247');
  for (const sk of SKINS) if (!a.owned.includes(sk.id)) a.owned.push(sk.id);
  st.giftAll1 = st.giftAll2 = true;
}
// once: Voidescent became a color. It was Eclipse in red, so whoever owned it keeps that look:
// they get Eclipse, and if they wore Voidescent they now wear Eclipse in the Voidescent color.
export function voidColor(st) {
  if (st.voidColor1) return;
  for (const a of Object.values(st.acct)) {
    if (!(a.owned || []).includes('voidescent')) continue;
    if (!a.owned.includes('eclipse')) a.owned.push('eclipse');
    if (a.skin === 'voidescent') { a.skin = 'eclipse'; a.color = 'voidescent'; }
  }
  st.voidColor1 = true;
}
// rows = closed picklists of the last `min` minutes · now = ms · today = 'YYYY-MM-DD' (Amsterdam)
// rows have .wh (warehouse id) · whs = [{ id, name }] every warehouse we count · main = the id of the main one (shift goal, BE)
// every warehouse gets its own board + king. Coins, drops, streaks, pass: the same game everywhere.
export function tick(st, rows, { now, min = 15, today, proxies = [], wh = '', whs = [], main = '', rnd = Math.random }) {
  ensure(st);
  giftAll(st);
  voidColor(st);
  xpTimes10(st, now, rnd);
  if (main || whs.length) st.mainWh = String(main || whs[0].id);
  if (whs.length) st.whNames = Object.fromEntries(whs.map((w) => [String(w.id), String(w.name || '')]));
  if (!st.kings) { st.kings = {}; if (st.king && st.mainWh) st.kings[st.mainWh] = st.king; } // one king before → the main warehouse's king
  const whOf = (p) => String(p.wh || st.mainWh || '');
  const skip = new Set([...proxies.map(String), ...NOT_PEOPLE]);
  // machines: wipe whatever they got before (account, days, kings)
  for (const id of NOT_PEOPLE) {
    delete st.acct[id];
    for (const d of Object.values(st.days)) delete d[id];
    for (const d of Object.values(st.pdays || {})) delete d[id];
    for (const [w, k] of Object.entries(st.kings || {})) if (k && k.id === id) delete st.kings[w];
    st.precent = (st.precent || []).filter((x) => x.id !== id);
  }
  const byW = new Map(); // warehouse → (person → row)
  // the chart: every closed picklist per warehouse per hour (like Picqer's dashboard), kept for months
  for (const p of rows) {
    const d = String(p.closed_at || today).slice(0, 10), h = +String(p.closed_at || '').slice(11, 13) || 0;
    st.seenH[d] = st.seenH[d] || {};
    if (st.seenH[d][p.idpicklist]) continue;
    st.seenH[d][p.idpicklist] = 1;
    hourRow(hoursOf(st, whOf(p)), d).packed[h]++;
  }
  for (const p of rows) {
    const id = p.closed_by_iduser == null ? null : String(p.closed_by_iduser);
    if (!id || skip.has(id)) continue;
    const pt = pointsOf(p);
    if (!pt) continue;
    const w = whOf(p);
    // the board of that warehouse: last 15 min
    if (!byW.has(w)) byW.set(w, new Map());
    const by = byW.get(w);
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
    if (!t.w) t.w = t.n ? { [String(st.mainWh || '')]: { n: t.n, multis: t.multis, singles: t.singles, points: t.points } } : {}; // before warehouses: all main
    t.n++; t.multis += pt.multi; t.singles += pt.single; t.points = r3(t.points + pt.pts);
    const tw = (t.w[w] = t.w[w] || { n: 0, multis: 0, singles: 0, points: 0 });
    tw.n++; tw.multis += pt.multi; tw.singles += pt.single; tw.points = r3(tw.points + pt.pts);
    const a = acct(st, id);
    a.wh = w; // the last warehouse they worked in
    earn(st, id, pt.pts, now); a.picklists++;
    passXp(st, id, pt.multi * XP_MULTI + pt.single * XP_SINGLE, now, today, rnd);
    a.points = r3(a.points + pt.pts);
    rollDrop(st, id, 1, now, rnd);
    if (d === today) streakCheck(st, id, today, now, rnd);
  }
  // a board + king of the hill per warehouse (every warehouse we count, also when nobody closed one there)
  const need = KING_MIN_POINTS * min / 15;
  const ids = [...new Set([...whs.map((x) => String(x.id)), ...byW.keys()])];
  if (!ids.length) ids.push(String(st.mainWh || ''));
  for (const w of Object.keys(st.kings)) if (!ids.includes(w)) delete st.kings[w];
  const boards = ids.map((w) => {
    const by = byW.get(w) || new Map();
    const people = [...by.values()].sort((a, b) => b.points - a.points || b.picklists - a.picklists);
    const top = people[0] && people[0].points >= need ? people[0] : null;
    const k = st.kings[w];
    if (!top) delete st.kings[w];
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
    } else st.kings[w] = { id: top.id, since: now, last: now };
    const kk = st.kings[w];
    return { id: w, name: whName(st, w) || (w === String(st.mainWh || '') ? wh : ''), people, king: kk ? { id: kk.id, since: kk.since, min: Math.floor((now - kk.since) / 60000) } : null };
  });
  st.king = st.kings[String(st.mainWh || '')] || null; // the main warehouse's king (older code paths)
  // keep 8 days of stats, 2 days of "seen"
  const keepDays = Object.keys(st.days).sort().slice(-8);
  for (const d of Object.keys(st.days)) if (!keepDays.includes(d)) delete st.days[d];
  const keepSeen = Object.keys(st.seen).sort().slice(-2);
  for (const d of Object.keys(st.seen)) if (!keepSeen.includes(d)) delete st.seen[d];
  for (const d of Object.keys(st.seenH).sort().slice(0, -2)) delete st.seenH[d];
  for (const d of Object.keys(st.hours).sort().slice(0, -120)) delete st.hours[d];
  for (const H of Object.values(st.hoursBy || {})) for (const d of Object.keys(H).sort().slice(0, -120)) delete H[d];
  for (const d of Object.keys(st.pdays).sort().slice(0, -8)) delete st.pdays[d];
  if (st.event && st.event.until <= now) st.event = null;
  st.feed = (st.feed || []).filter((x) => now - x.at < 6 * 3600000);
  st.ann = (st.ann || []).filter((x) => now - x.until < 3 * 86400000); // announcements: gone 3 days after they ended
  for (const id of Object.keys(st.acct)) { questCheck(st, id, today, now, rnd); achCheck(st, id, now, today); }
  for (const bd of boards) bd.people.forEach((p) => { const x = badgesOf(st.acct[p.id]); if (x) p.badges = x; });
  // people / king / wh = the main warehouse, like before (older scripts) · whs = every warehouse
  const mb = boards.find((x) => x.id === String(st.mainWh || '')) || boards[0];
  st.board = { at: now, min, wh: mb.name || wh, main: String(st.mainWh || ''), people: mb.people, king: mb.king, whs: boards, feed: st.feed, event: st.event ? { until: st.event.until, by: st.event.by } : null };
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
    return { id, badges: badgesOf(a), points: totalPoints(st, id), picklists: a.picklists || 0, pickPoints: a.pickPoints || 0, batches: a.batches || 0, kingTotal: a.kingTotal || 0, kingBest: a.kingBest || 0, coins: a.coins || 0, balance: r3(a.coins - a.spent), wh: a.wh || '' };
  }).filter((x) => x.points > 0 || x.picklists > 0 || x.balance > 0 || x.pickPoints > 0).sort((x, y) => y.balance - x.balance || y.points - x.points);
}

export function profile(st, id, today, now = Date.now()) {
  id = String(id);
  const a = st.acct[id] || { coins: 0, spent: 0, owned: [], skin: null, color: null, kingTotal: 0, kingBest: 0, picklists: 0 };
  const day = st.days[today] || {};
  const ranked = Object.entries(day).sort((x, y) => y[1].points - x[1].points);
  const pos = ranked.findIndex(([k]) => k === id);
  const week = Object.entries(st.days).filter(([d]) => d <= today).slice(-7).map(([d, v]) => ({ day: d, ...(v[id] || { n: 0, points: 0, kingMin: 0 }) }));
  return {
    id, today: day[id] || { n: 0, multis: 0, singles: 0, points: 0, kingMin: 0 }, rankToday: pos < 0 ? null : pos + 1, ofToday: ranked.length,
    balance: r3(a.coins - a.spent), coins: a.coins, spent: a.spent, points: st.acct[id] ? totalPoints(st, id) : 0, owned: a.owned,
    skin: a.skinOffUntil > now ? null : a.skin, mySkin: a.skin, color: a.skinOffUntil > now ? null : a.color || null, myColor: a.color || null, kingTotal: a.kingTotal, kingBest: a.kingBest, picklists: a.picklists,
    pickPoints: a.pickPoints || 0, batches: a.batches || 0, pickToday: ((st.pdays || {})[today] || {})[id] || { batches: 0, locations: 0, items: 0, points: 0 },
    inv: a.inv || [], news: a.news || [], items: ITEMS, tiers: TIERS,
    effects: { frozenUntil: a.frozenUntil || 0, skinOffUntil: a.skinOffUntil || 0, boostUntil: a.boostUntil || 0, shieldUntil: a.shieldUntil || 0 },
    event: st.event && st.event.until > now ? st.event : null,
    pass: passView(a),
    quests: questView(st, id, today),
    ach: achView(a),
    social: socialView(a),
    streak: { n: a.streak || 0, day: a.streakDay || null, best: a.streakBest || 0, goal: STREAK_GOAL, today: r3(dayTotal(st, today, id)) },
    pity: { dry: a.dry || 0, at: PITY }, cooldown: HIT_COOLDOWN, trades: tradesFor(st, id, now),
    king: kingOf(st, id, now),
    week, skins: shop(st), crate: crateInfo(st, a), crates: a.crates || 0,
    wh: a.wh || '', ann: annFor(st, id, now),
  };
}
// king right now in any warehouse?
function kingOf(st, id, now) {
  const all = Object.entries(st.kings || (st.king && st.mainWh ? { [st.mainWh]: st.king } : {}));
  const hit = all.find(([, k]) => k && k.id === id);
  return hit ? { min: Math.floor((now - hit[1].since) / 60000), wh: hit[0], whName: whName(st, hit[0]) } : null;
}

// which skins can still come out of a crate for this person (a sold-out limited one only if they already have it)
function cratePool(st, a) {
  return CRATE.odds.filter(([s]) => { const sk = SKINS.find((x) => x.id === s); return !(sk.limit && !a.owned.includes(s) && owners(st, s) >= sk.limit); });
}
function crateInfo(st, a) {
  const pool = cratePool(st, a), tot = pool.reduce((n, [, w]) => n + w, 0);
  return { price: CRATE.price, odds: pool.map(([id, w]) => ({ id, pct: Math.round((w / tot) * 10000) / 100 })), pity: { dry: a.cdry || 0, at: CRATE_PITY } };
}
export function crate(st, id, rnd = Math.random) {
  id = String(id);
  const a = acct(st, id);
  if (a.coins - a.spent < CRATE.price) return { err: `not enough coins (${Math.floor(a.coins - a.spent)} of ${CRATE.price})` };
  const all = cratePool(st, a), rare = all.filter(([, w]) => w <= RARE_W);
  const pity = (a.cdry || 0) >= CRATE_PITY - 1 && rare.length > 0;
  const pool = pity ? rare : all, tot = pool.reduce((n, [, w]) => n + w, 0);
  let x = rnd() * tot, won = pool[pool.length - 1][0], ww = pool[pool.length - 1][1];
  for (const [s, w] of pool) { if (x < w) { won = s; ww = w; break; } x -= w; }
  a.spent += CRATE.price;
  a.crates = (a.crates || 0) + 1;
  a.cdry = ww <= RARE_W ? 0 : (a.cdry || 0) + 1;
  const sk = SKINS.find((s) => s.id === won);
  const dup = a.owned.includes(won);
  let back = 0;
  if (dup) { back = Math.round(sk.price * CRATE.back); a.coins = r3(a.coins + back); } else a.owned.push(won);
  return { ok: true, won, dup, back, pity };
}

export function buy(st, id, skin) {
  id = String(id);
  const s = SKINS.find((x) => x.id === skin);
  if (!s) return { err: 'no such skin' };
  if (s.crateOnly && !acct(st, id).owned.includes(skin)) return { err: `${s.name} only comes out of crates` };
  if (s.passOnly && !acct(st, id).owned.includes(skin)) return { err: `${s.name} only comes from the battle pass` };
  const a = acct(st, id);
  if (!a.owned.includes(skin)) {
    if (s.limit && owners(st, skin) >= s.limit) return { err: `sold out (only ${s.limit} people can have ${s.name})` };
    if (a.coins - a.spent < s.price) return { err: `not enough coins (${Math.floor(a.coins - a.spent)} of ${s.price})` };
    a.spent += s.price;
    a.owned.push(skin);
  }
  if (s.color) a.color = skin; else a.skin = skin;
  return { ok: true };
}
export function equip(st, id, skin) {
  const a = acct(st, String(id));
  if (skin && !a.owned.includes(skin)) return { err: 'not bought yet' };
  if (skin && isColor(skin)) { a.color = skin; return { ok: true }; } // a color goes on top of the skin
  a.skin = skin || null;
  return { ok: true };
}
// a color on / off (null = off). It only shows on animated skins, the script decides that.
export function paint(st, id, color) {
  const a = acct(st, String(id));
  if (!color) { a.color = null; return { ok: true }; }
  if (!isColor(color)) return { err: 'no such color' };
  if (!a.owned.includes(color)) return { err: 'not bought yet' };
  a.color = color;
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
export function pickTick(st, batches, { now, today, proxies = [], main = '', rnd = Math.random }) {
  ensure(st);
  if (main) st.mainWh = String(main);
  const skip = new Set([...proxies.map(String), ...NOT_PEOPLE]);
  for (const b of batches) {
    const bid = String(b.idpicklist_batch);
    if (st.pseen.includes(bid)) continue;
    st.pseen.push(bid);
    const id = pickerOf(b);
    if (!id || skip.has(id)) continue;
    const pt = batchPoints(b);
    if (!pt.points) continue;
    const w = String(b.wh || b.idwarehouse || st.mainWh || '');
    const d = String(b.completed_at || today).slice(0, 10), h = +String(b.completed_at || '').slice(11, 13) || 0;
    st.pdays[d] = st.pdays[d] || {};
    const r = (st.pdays[d][id] = st.pdays[d][id] || { batches: 0, locations: 0, items: 0, points: 0 });
    if (!r.w) r.w = r.batches ? { [String(st.mainWh || '')]: { batches: r.batches, points: r.points } } : {}; // before warehouses: all main
    r.batches++; r.locations += pt.locations; r.items += pt.items; r.points = r3(r.points + pt.points);
    const rw = (r.w[w] = r.w[w] || { batches: 0, points: 0 });
    rw.batches++; rw.points = r3(rw.points + pt.points);
    const hr = hourRow(hoursOf(st, w), d);
    hr.picked[h] = r3((hr.picked[h] || 0) + pt.points);
    const a = acct(st, id);
    a.wh = w;
    a.pickPoints = r3((a.pickPoints || 0) + pt.points);
    a.batches = (a.batches || 0) + 1;
    earn(st, id, pt.points, now);
    passXp(st, id, pt.points * XP_PICK, now, today, rnd);
    st.precent.push({ id, at: now, points: pt.points, wh: w });
    rollDrop(st, id, 3, now, rnd);
    if (d === today) streakCheck(st, id, today, now, rnd);
  }
  st.pseen = st.pseen.slice(-600);
  st.precent = st.precent.filter((x) => now - x.at < 2 * 3600000);
  return pickBoard(st, now, today);
}
// the warehouse someone mostly worked in (per-warehouse rows: { wh: { points } })
const topWh = (w) => { const e = Object.entries(w || {}).sort((x, y) => (y[1].points || 0) - (x[1].points || 0))[0]; return e ? e[0] : ''; };
export function pickBoard(st, now, today) {
  ensure(st);
  const day = st.pdays[today] || {};
  const hour = {}, lastWh = {};
  for (const x of st.precent) {
    if (now - x.at < 3600000) hour[x.id] = r3((hour[x.id] || 0) + x.points);
    if (x.wh) lastWh[x.id] = x.wh; // oldest first: the last batch wins
  }
  const ids = new Set([...Object.keys(day), ...Object.keys(hour)]);
  const people = [...ids].map((id) => {
    const { w, ...row } = day[id] || { batches: 0, locations: 0, items: 0, points: 0 };
    return { id, ...row, hour: hour[id] || 0, badges: badgesOf(st.acct[id]), wh: lastWh[id] || topWh(w) || String(st.mainWh || '') };
  }).sort((a, b) => b.points - a.points || b.hour - a.hour);
  return { at: now, day: today, people };
}
export function chart(st, date, wh = '') {
  ensure(st);
  const h = hoursFor(st, String(wh || ''))[date];
  return { date, wh: String(wh || st.mainWh || ''), have: !!h, packed: h ? h.packed : Array(24).fill(0), picked: h ? h.picked : Array(24).fill(0) };
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
  a.opened = (a.opened || 0) + 1;
  qCount(a, 'opened', 1);
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
    id: t.id, from: t.from, to: t.to, status: t.status, why: t.why || '', at: t.at, ended: t.ended || 0, ok: t.ok,
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
    t.ended = now;
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
      for (const s of o.skins) { A.owned = A.owned.filter((x) => x !== s); if (A.skin === s) A.skin = null; if (A.color === s) A.color = null; if (!B.owned.includes(s)) B.owned.push(s); }
    }
    t.status = 'done';
    for (const x of [t.from, t.to]) acct(st, x).trades = (acct(st, x).trades || 0) + 1;
    t.ended = now;
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
  const skip = new Set([...proxies.map(String), ...NOT_PEOPLE]);
  const openIds = new Set(open.map((b) => String(b.idpicklist_batch)));
  const whOf = new Map(open.map((b) => [String(b.idpicklist_batch), String(b.wh || b.idwarehouse || '')]));
  for (const k of Object.keys(L.b)) if (!openIds.has(k)) delete L.b[k];
  for (const d of details) {
    const bid = String(d.idpicklist_batch);
    const who = String((d.assigned_to && d.assigned_to.iduser) || '');
    if (!who || skip.has(who)) continue;
    const s = snap(d), prev = L.b[bid], wh = whOf.get(bid) || String(d.idwarehouse || '') || (prev && prev.wh) || '';
    let changed = prev ? prev.changed || 0 : 0;
    if (prev && prev.who === who) {
      const di = Math.max(0, s.items - prev.items), dl = Math.max(0, s.locs - prev.locs);
      if (di || dl) {
        L.ev.push({ id: who, at: now, items: di, locs: dl, pts: r3(dl * PICK_LOC + di * PICK_ITEM), wh });
        L.last[who] = now;
        changed = now;
      }
    }
    L.b[bid] = { who, wh, ...s, checked: now, changed };
  }
  L.ev = L.ev.filter((e) => now - e.at < 60 * 60000);
  for (const k of Object.keys(L.last)) if (now - L.last[k] > 12 * 3600000) delete L.last[k];
  return L;
}
export function liveBoard(L, now) {
  L = L || newLive();
  const by = {};
  const row = (id) => (by[id] = by[id] || { m15: 0, items15: 0, locs15: 0, h60: 0, last: L.last[id] || 0, batch: null, wh: '' });
  for (const e of L.ev) {
    const r = row(e.id);
    r.h60 = r3(r.h60 + e.pts);
    if (e.wh) r.wh = e.wh; // oldest first: where they picked last
    if (now - e.at < 15 * 60000) { r.m15 = r3(r.m15 + e.pts); r.items15 += e.items; r.locs15 += e.locs; }
  }
  for (const id of Object.keys(L.last)) row(id);
  // the batch they're on now: the one that changed last
  for (const s of Object.values(L.b)) {
    const r = by[s.who];
    if (r && (!r.batch || s.changed > r.batch.changed)) { r.batch = { items: s.items, total: s.total, locs: s.locs, locTotal: s.locTotal, changed: s.changed }; if (s.wh && (!r.wh || s.changed >= r.last)) r.wh = s.wh; }
  }
  for (const r of Object.values(by)) { r.idleMin = r.last ? Math.floor((now - r.last) / 60000) : null; if (r.batch) delete r.batch.changed; }
  return by;
}

// ---------- battle pass ----------
function passOf(a) {
  if (!a.pass || a.pass.s !== SEASON.id) a.pass = { s: SEASON.id, xp: 0, owned: false, got: 0 };
  return a.pass;
}
function passGive(st, id, lv, now, rnd) {
  const a = acct(st, id), r = SEASON.levels[lv - 1];
  if (!r) return;
  if (r.coins) a.coins = r3(a.coins + r.coins);
  if (r.crate) giveCrate(st, id, r.crate, now, rnd, false, true);
  if (r.item) { a.inv = a.inv || []; a.inv.push({ uid: `${now.toString(36)}p${lv}${Math.floor(rnd() * 1e4).toString(36)}`, kind: 'item', item: r.item, at: now }); }
  if (r.skin && !a.owned.includes(r.skin)) a.owned.push(r.skin);
  a.news = (a.news || []).concat({ at: now + lv, kind: 'pass', lv, ...r }).slice(-20);
}
function passCatchUp(st, id, now, rnd) {
  const p = passOf(acct(st, id));
  if (!p.owned) return;
  const lv = Math.min(SEASON.levels.length, Math.floor(p.xp / SEASON.per));
  while (p.got < lv) passGive(st, id, ++p.got, now, rnd);
}
// one time: XP that was counted as 1 per point becomes x10 (the new 20 / 13 per picklist)
export function xpTimes10(st, now, rnd = Math.random) {
  if (st.xp10) return;
  for (const [id, a] of Object.entries(st.acct)) if (a.pass && a.pass.s === SEASON.id && a.pass.xp) { a.pass.xp = r3(a.pass.xp * 10); passCatchUp(st, id, now, rnd); }
  st.xp10 = true;
}
export function passXp(st, id, pts, now, today, rnd = Math.random) {
  if (!(pts > 0) || String(today) > SEASON.ends) return;
  const p = passOf(acct(st, id));
  p.xp = r3(p.xp + pts);
  passCatchUp(st, id, now, rnd);
}
export function buyPass(st, id, now, today, rnd = Math.random) {
  id = String(id);
  const a = acct(st, id), p = passOf(a);
  if (String(today) > SEASON.ends) return { err: 'this season is over' };
  if (p.owned) return { ok: true };
  if (a.coins - a.spent < SEASON.price) return { err: `not enough coins (${Math.floor(a.coins - a.spent)} of ${SEASON.price})` };
  a.spent = r3(a.spent + SEASON.price);
  p.owned = true;
  passCatchUp(st, id, now, rnd);
  return { ok: true };
}
export function passView(a) {
  const p = a.pass && a.pass.s === SEASON.id ? a.pass : { xp: 0, owned: false, got: 0 };
  return { season: { id: SEASON.id, name: SEASON.name, ends: SEASON.ends, price: SEASON.price, per: SEASON.per, levels: SEASON.levels },
    xp: p.xp, lv: Math.min(SEASON.levels.length, Math.floor(p.xp / SEASON.per)), owned: !!p.owned, got: p.got || 0 };
}

// ---------- admin (owner only): give / take coins, crates, items, skins, pass, XP ----------
export const OWNER = '32247';
export function adminOp(st, op, target, b, now, today, rnd = Math.random) {
  ensure(st);
  target = String(target || '');
  if (op === 'log') return { ok: true, log: (st.log || []).slice(-50).reverse() };
  // shift goal: picklists for the day + shift times. target 0 = no goal (no bar anywhere)
  if (op === 'goal') {
    if (b.goal) {
      const t = Math.max(0, Math.round(Number(b.goal.target) || 0)), hm = (x, d) => (/^\d{2}:\d{2}$/.test(String(x || '')) ? String(x) : d);
      const sn = Math.max(0, Math.round(Number(b.goal.start) || 0));
      st.goal = t ? { target: t, from: hm(b.goal.from, '18:00'), to: hm(b.goal.to, '23:00'), ...(sn ? { start: sn } : {}) } : null;
      st.log = (st.log || []).concat({ at: now, id: OWNER, what: `admin: shift goal ${t ? `${t} (${st.goal.from}-${st.goal.to})` : 'off'}` }).slice(-50);
    }
    return { ok: true, goal: st.goal || null };
  }
  // Discord webhooks: logs (slow pages etc) and the end of shift report (+ time, Amsterdam)
  if (op === 'hooks') {
    st.hooks = st.hooks || {};
    if (b.hooks) for (const k of ['log', 'report', 'reportAt', 'admin']) if (typeof b.hooks[k] === 'string') st.hooks[k] = b.hooks[k].trim();
    return { ok: true, hooks: { log: st.hooks.log || '', report: st.hooks.report || '', reportAt: st.hooks.reportAt || '22:30', admin: st.hooks.admin || '' } };
  }
  // switches for everyone (false = off on every PC)
  if (op === 'flags') {
    const f = { ...(st.flags || {}) };
    for (const k of ['cardColor', 'skins']) if (b.flags && typeof b.flags[k] === 'boolean') f[k] = b.flags[k];
    if (b.flags) { st.flags = f; st.log = (st.log || []).concat({ at: now, id: OWNER, what: `admin: everyone ${JSON.stringify(f)}` }).slice(-50); }
    return { ok: true, flags: f };
  }
  // announcements: to 'all' or one Picqer user id · shown for `hours` (1-72) to everyone who opens Picqer, once
  if (op === 'announce') {
    const text = String(b.text || '').replace(/\r/g, '').trim().slice(0, ANN_MAX);
    const to = !b.to || b.to === 'all' ? 'all' : String(b.to).replace(/\D/g, '');
    if (!text) return { err: 'write something first' };
    if (!to) return { err: 'to who?' };
    const hours = Math.min(72, Math.max(1, Number(b.hours) || 8));
    const x = { id: `${now.toString(36)}${Math.floor(rnd() * 46656).toString(36)}`, at: now, until: now + hours * 3600000, text, to, byName: String(b.byName || '').slice(0, 60), seen: {} };
    st.ann = (st.ann || []).concat(x).slice(-30);
    st.log = (st.log || []).concat({ at: now, id: OWNER, what: `admin: announcement (${hours} h) → ${to === 'all' ? 'everyone' : to}` }).slice(-50);
    return { ok: true, anns: annList(st, now) };
  }
  if (op === 'anns') return { ok: true, anns: annList(st, now) };
  if (op === 'unannounce') {
    const before = (st.ann || []).length;
    st.ann = (st.ann || []).filter((x) => x.id !== String(b.aid));
    return st.ann.length === before ? { err: 'not there anymore' } : { ok: true, anns: annList(st, now) };
  }
  if (!st.acct[target]) return { err: 'no account for that person yet' };
  const a = acct(st, target), n = Math.round(Number(b.n) || 0);
  const note = (what) => { st.log = (st.log || []).concat({ at: now, id: OWNER, what: `admin: ${what} → ${target}` }).slice(-50); };
  if (op === 'look') return { ok: true, acct: { ...a, news: undefined } };
  if (op === 'coins') { if (!n) return { err: 'amount?' }; if (n > 0) a.coins = r3(a.coins + n); else a.spent = r3(a.spent - n); note(`${n} coins`); }
  else if (op === 'crate') { const t = TIERS.find((x) => x.id === b.what); if (!t) return { err: 'tier?' }; for (let i = 0; i < Math.max(1, n); i++) giveCrate(st, target, t.id, now + i, rnd); note(`${Math.max(1, n)} ${t.id} crate`); }
  else if (op === 'item') { if (!ITEMS[b.what]) return { err: 'item?' }; a.inv = a.inv || []; for (let i = 0; i < Math.max(1, n); i++) a.inv.push({ uid: `${(now + i).toString(36)}a${Math.floor(rnd() * 1e5).toString(36)}`, kind: 'item', item: b.what, at: now }); note(`${Math.max(1, n)} ${b.what}`); }
  else if (op === 'skin') { if (!SKINS.find((x) => x.id === b.what)) return { err: 'skin?' }; if (!a.owned.includes(b.what)) a.owned.push(b.what); note(`skin ${b.what}`); }
  else if (op === 'unskin') { a.owned = a.owned.filter((x) => x !== b.what); if (a.skin === b.what) a.skin = null; if (a.color === b.what) a.color = null; note(`took skin ${b.what}`); }
  else if (op === 'uncrate' || op === 'unitem') {
    const want = Math.max(1, n), inv = a.inv || [];
    let gone = 0;
    for (let i = 0; i < inv.length && gone < want;) {
      const x = inv[i];
      if (op === 'uncrate' ? x.kind === 'crate' && x.tier === b.what : x.kind === 'item' && x.item === b.what) { inv.splice(i, 1); gone++; } else i++;
    }
    if (!gone) return { err: `they have no ${b.what}` };
    note(`took ${gone} ${b.what}${op === 'uncrate' ? ' crate' : ''}`);
  }
  else if (op === 'unpass') { const p = passOf(a); p.owned = false; note('took battle pass'); }
  else if (op === 'pass') { const p = passOf(a); p.owned = true; passCatchUp(st, target, now, rnd); note('battle pass'); }
  else if (op === 'xp') { if (!n) return { err: 'amount?' }; const p = passOf(a); p.xp = Math.max(0, r3(p.xp + n)); passCatchUp(st, target, now, rnd); note(`${n} XP`); }
  else if (op === 'clear') { a.frozenUntil = 0; a.skinOffUntil = 0; note('cleared freeze / skin off'); }
  else if (op === 'boost') { a.boostUntil = Math.max(a.boostUntil || 0, now) + Math.max(1, n || 30) * 60000; note(`boost ${n || 30} min`); }
  else return { err: 'unknown' };
  return { ok: true };
}

// ---------- friends + chat (messages themselves live in their own storage key per pair, see worker.js) ----------
export const pairKey = (x, y) => (String(x) < String(y) ? `${x}-${y}` : `${y}-${x}`);
export function socialView(a) {
  return { friends: a.friends || [], reqIn: a.reqIn || [], reqOut: a.reqOut || [], unread: a.unread || {}, last: a.lastMsg || {} };
}
export function friendOp(st, id, op, to) {
  id = String(id); to = String(to || '');
  if (!to || to === id) return { err: 'pick someone else' };
  if (!st.acct[to]) return { err: 'that person has no account here yet' };
  const a = acct(st, id), b = acct(st, to);
  for (const x of [a, b]) { x.friends = x.friends || []; x.reqIn = x.reqIn || []; x.reqOut = x.reqOut || []; }
  const drop = (arr, v) => arr.filter((x) => x !== v);
  if (op === 'request') {
    if (a.friends.includes(to)) return { ok: true };
    if (a.reqIn.includes(to)) op = 'accept'; // they already asked you
    else { if (!a.reqOut.includes(to)) a.reqOut.push(to); if (!b.reqIn.includes(id)) b.reqIn.push(id); return { ok: true }; }
  }
  if (op === 'accept') {
    if (!a.reqIn.includes(to)) return { err: 'no request from them' };
    a.reqIn = drop(a.reqIn, to); b.reqOut = drop(b.reqOut, id);
    if (!a.friends.includes(to)) a.friends.push(to);
    if (!b.friends.includes(id)) b.friends.push(id);
    return { ok: true };
  }
  if (op === 'decline' || op === 'cancel') { a.reqIn = drop(a.reqIn, to); a.reqOut = drop(a.reqOut, to); b.reqIn = drop(b.reqIn, id); b.reqOut = drop(b.reqOut, id); return { ok: true }; }
  if (op === 'remove') { a.friends = drop(a.friends, to); b.friends = drop(b.friends, id); return { ok: true }; }
  return { err: 'unknown' };
}
// a message: only between friends. msgs = the pair's list (changed in place). Max 300 characters, 1 per second.
export function chatSend(st, msgs, id, to, text, now) {
  id = String(id); to = String(to);
  const a = acct(st, id), b = st.acct[to];
  if (!b || !(a.friends || []).includes(to)) return { err: 'only with friends' };
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) return { err: 'empty' };
  if (now - (a.lastSend || 0) < 1000) return { err: 'slow down' };
  a.lastSend = now;
  msgs.push({ at: now, from: id, text });
  if (msgs.length > 150) msgs.splice(0, msgs.length - 150);
  b.unread = { ...(b.unread || {}), [id]: ((b.unread || {})[id] || 0) + 1 };
  const prev = { at: now, from: id, text: text.slice(0, 80) };
  b.lastMsg = { ...(b.lastMsg || {}), [id]: prev };
  a.lastMsg = { ...(a.lastMsg || {}), [to]: prev };
  return { ok: true };
}
export function chatRead(st, id, other) {
  const a = st.acct[String(id)];
  if (a && a.unread && a.unread[other]) { const u = { ...a.unread }; delete u[other]; a.unread = u; return true; }
  return false;
}

// ---------- quests: 3 a day + 3 a week (same for everyone), done = pass XP by itself ----------
export const QUESTS = {
  daily: {
    pack: [{ id: 'd_multi', name: 'Pack 40 multis', goal: 40, stat: 'multis' }, { id: 'd_close', name: 'Close 80 picklists', goal: 80, stat: 'n' }, { id: 'd_pts', name: '100 packing points', goal: 100, stat: 'points' }],
    pick: [{ id: 'd_batch', name: 'Pick 5 batches', goal: 5, stat: 'batches' }, { id: 'd_loc', name: 'Pick 120 locations', goal: 120, stat: 'locations' }, { id: 'd_ppts', name: '400 pick points', goal: 400, stat: 'ppoints' }],
    any: [{ id: 'd_streak', name: 'Hit your streak goal', goal: 1, stat: 'streak' }, { id: 'd_crate', name: 'Open a crate', goal: 1, stat: 'opened' }],
    xp: 300,
  },
  weekly: {
    pack: [{ id: 'w_multi', name: 'Pack 300 multis', goal: 300, stat: 'multis' }, { id: 'w_close', name: 'Close 600 picklists', goal: 600, stat: 'n' }],
    pick: [{ id: 'w_batch', name: 'Pick 35 batches', goal: 35, stat: 'batches' }, { id: 'w_loc', name: 'Pick 900 locations', goal: 900, stat: 'locations' }],
    any: [{ id: 'w_streak', name: 'Streak goal on 4 days', goal: 4, stat: 'streak' }, { id: 'w_crate', name: 'Open 3 crates', goal: 3, stat: 'opened' }],
    xp: 2000,
  },
};
const hashStr = (t) => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
export function weekOf(day) { const d = new Date(day + 'T12:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
function questsFor(kind, key) {
  const Q = QUESTS[kind], h = hashStr(kind + key);
  return ['pack', 'pick', 'any'].map((g, i) => Q[g][(h >>> (i * 5)) % Q[g].length]).map((q) => ({ ...q, xp: Q.xp }));
}
// counters that don't live in the day stats (crates opened, streak goal hit): per day and per week
function qCount(a, stat, n) {
  const t = new Date(), day = new Date(t.getTime() + 3600000).toISOString().slice(0, 10); // close enough to Amsterdam for counting
  a.qc = a.qc || {};
  if (a.qc.day !== day) a.qc = { ...a.qc, day, d: {} };
  if (a.qc.week !== weekOf(day)) a.qc = { ...a.qc, week: weekOf(day), w: {} };
  a.qc.d[stat] = (a.qc.d[stat] || 0) + n;
  a.qc.w[stat] = (a.qc.w[stat] || 0) + n;
}
function qStat(st, id, stat, days, counter) {
  if (stat === 'opened' || stat === 'streak') return counter[stat] || 0;
  let n = 0;
  for (const d of days) {
    const p = ((st.days[d] || {})[id]) || {}, q = (((st.pdays || {})[d] || {})[id]) || {};
    n += stat === 'ppoints' ? q.points || 0 : stat in p ? p[stat] || 0 : q[stat] || 0;
  }
  return n;
}
function questList(st, id, today) {
  const a = st.acct[id] || {}, qc = a.qc || {};
  const wk = weekOf(today), wdays = Object.keys(st.days).concat(Object.keys(st.pdays || {})).filter((d, i, arr) => arr.indexOf(d) === i && d >= wk && d <= today);
  const dc = qc.day === today ? qc.d || {} : {}, wc = qc.week === wk ? qc.w || {} : {};
  return [
    ...questsFor('daily', today).map((q) => ({ ...q, per: 'daily', key: `d:${today}:${q.id}`, prog: qStat(st, id, q.stat, [today], dc) })),
    ...questsFor('weekly', wk).map((q) => ({ ...q, per: 'weekly', key: `w:${wk}:${q.id}`, prog: qStat(st, id, q.stat, wdays, wc) })),
  ];
}
export function questCheck(st, id, today, now, rnd = Math.random) {
  const a = st.acct[id];
  if (!a) return;
  a.qdone = a.qdone || {};
  for (const q of questList(st, id, today)) {
    if (a.qdone[q.key] || q.prog < q.goal) continue;
    a.qdone[q.key] = now;
    passXp(st, id, q.xp, now, today, rnd);
    a.news = (a.news || []).concat({ at: now + 2, kind: 'quest', name: q.name, xp: q.xp, per: q.per }).slice(-20);
  }
  const keep = Object.keys(a.qdone).sort((x, y) => a.qdone[y] - a.qdone[x]).slice(0, 30);
  if (keep.length < Object.keys(a.qdone).length) a.qdone = Object.fromEntries(keep.map((k) => [k, a.qdone[k]]));
}
export function questView(st, id, today) {
  const a = st.acct[id] || {};
  return questList(st, id, today).map((q) => ({ id: q.id, name: q.name, per: q.per, goal: q.goal, xp: q.xp, prog: Math.min(q.goal, Math.round(q.prog * 10) / 10), done: !!(a.qdone || {})[q.key] }));
}

// ---------- achievements: unlocked once, the rarest 3 show as badges next to your name ----------
export const ACH = [
  { id: 'crate1', icon: '📦', name: 'First crate', desc: 'open a drop crate', test: (a) => (a.opened || 0) >= 1 },
  { id: 'pack100', icon: '🥉', name: 'Packer', desc: 'close 100 picklists', test: (a) => (a.picklists || 0) >= 100 },
  { id: 'pick10', icon: '⛏️', name: 'Picker', desc: 'pick 10 batches', test: (a) => (a.batches || 0) >= 10 },
  { id: 'trade1', icon: '🤝', name: 'Trader', desc: 'finish a trade', test: (a) => (a.trades || 0) >= 1 },
  { id: 'streak7', icon: '🔥', name: 'On fire', desc: '7 day streak', test: (a) => (a.streakBest || 0) >= 7 },
  { id: 'king60', icon: '👑', name: 'King', desc: '60 min king in total', test: (a) => (a.kingTotal || 0) >= 60 },
  { id: 'pack1k', icon: '🥈', name: 'Pro packer', desc: 'close 1.000 picklists', test: (a) => (a.picklists || 0) >= 1000 },
  { id: 'pick100', icon: '⚒️', name: 'Pro picker', desc: 'pick 100 batches', test: (a) => (a.batches || 0) >= 100 },
  { id: 'skins10', icon: '🎨', name: 'Collector', desc: 'own 10 skins', test: (a) => (a.owned || []).length >= 10 },
  { id: 'rich', icon: '💰', name: 'Rich', desc: 'earn 50.000 coins', test: (a) => (a.coins || 0) >= 50000 },
  { id: 'epic', icon: '🎁', name: 'Epic find', desc: 'find an epic crate', test: (a) => ((a.found || {}).epic || 0) >= 1 },
  { id: 'pass25', icon: '🎟️', name: 'Season 1', desc: 'pass level 25', test: (a) => !!a.pass && a.pass.s === 1 && Math.floor((a.pass.xp || 0) / SEASON.per) >= 25 },
  { id: 'streak30', icon: '☄️', name: 'Unstoppable', desc: '30 day streak', test: (a) => (a.streakBest || 0) >= 30 },
  { id: 'pack5k', icon: '🥇', name: 'Legend packer', desc: 'close 5.000 picklists', test: (a) => (a.picklists || 0) >= 5000 },
  { id: 'pick500', icon: '🏆', name: 'Legend picker', desc: 'pick 500 batches', test: (a) => (a.batches || 0) >= 500 },
  { id: 'legend', icon: '💎', name: 'Legendary', desc: 'find a legendary crate', test: (a) => ((a.found || {}).legendary || 0) >= 1 },
];
export function achCheck(st, id, now) {
  const a = st.acct[id];
  if (!a) return;
  a.ach = a.ach || {};
  for (const x of ACH) {
    if (a.ach[x.id] || !x.test(a)) continue;
    a.ach[x.id] = now;
    a.news = (a.news || []).concat({ at: now + 3, kind: 'ach', icon: x.icon, name: x.name, desc: x.desc }).slice(-20);
  }
}
export function badgesOf(a) {
  if (!a || !a.ach) return '';
  return ACH.filter((x) => a.ach[x.id]).slice(-3).reverse().map((x) => x.icon).join('');
}
export function achView(a) { return ACH.map((x) => ({ id: x.id, icon: x.icon, name: x.name, desc: x.desc, at: (a.ach || {})[x.id] || 0 })); }

// ---------- end of shift report (Discord) ----------
export function shiftReport(st, today, names = {}, wh = '') {
  const nm = (id) => names[id] || `#${id}`;
  const W = String(wh || '');
  // the part of a day row for this warehouse (rows from before warehouses = the main one)
  const part = (r) => (!W ? r : r.w ? r.w[W] || null : isMain(st, W) ? r : null);
  const day = st.days[today] || {}, pday = (st.pdays || {})[today] || {}, h = (hoursFor(st, W)[today] || {}).packed || [];
  const packers = Object.entries(day).map(([id, r]) => { const x = part(r); return x && x.n ? { id, n: x.n, multis: x.multis || 0, singles: x.singles || 0, points: x.points || 0 } : null; }).filter(Boolean).sort((x, y) => y.points - x.points);
  const pickers = Object.entries(pday).map(([id, r]) => { const x = part(r); return x && x.batches ? { id, batches: x.batches, points: x.points || 0 } : null; }).filter(Boolean).sort((x, y) => y.points - x.points);
  const n = packers.reduce((t, r) => t + r.n, 0), mu = packers.reduce((t, r) => t + r.multis, 0), si = packers.reduce((t, r) => t + r.singles, 0);
  const bat = pickers.reduce((t, r) => t + r.batches, 0), pp = pickers.reduce((t, r) => t + r.points, 0);
  const busiest = h.reduce((b, v, i) => (v > (h[b] || 0) ? i : b), 0);
  const fmtN = (x) => (Math.round(x * 10) / 10).toLocaleString('nl-NL');
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const max = Math.max(1, ...h);
  const hours = h.map((v, i) => [i, v]).filter(([, v]) => v > 0).map(([i, v]) => `${String(i).padStart(2, '0')} ${'█'.repeat(Math.max(1, Math.round((v / max) * 18)))} ${v}`).join('\n');
  return [
    `**Shift report${W && whName(st, W) ? ` · ${whName(st, W)}` : ''} · ${today.split('-').reverse().join('-')}**`,
    `📦 **${fmtN(n)}** picklists packed · ${fmtN(mu)} multi · ${fmtN(si)} single${n ? ` · busiest ${String(busiest).padStart(2, '0')}:00 (${h[busiest]})` : ''}`,
    `⛏️ **${fmtN(bat)}** batches picked · ${fmtN(pp)} pick points`,
    packers.length ? `\n**Packers**\n${packers.slice(0, 5).map((r, i) => `${medal(i)} ${nm(r.id)} · ${fmtN(r.points)} pts · ${r.n} closed`).join('\n')}` : '',
    pickers.length ? `\n**Pickers**\n${pickers.slice(0, 5).map((r, i) => `${medal(i)} ${nm(r.id)} · ${fmtN(r.points)} pts · ${r.batches} batches`).join('\n')}` : '',
    hours ? `\n**Per hour**\n\`\`\`\n${hours}\n\`\`\`` : '',
  ].filter(Boolean).join('\n').slice(0, 1990);
}
// which warehouses had something today (for one report each) · none known = one report like before
export function reportWhs(st, today) {
  const ids = Object.keys(st.whNames || {});
  if (ids.length < 2) return [''];
  const any = (W) => { const r = hoursFor(st, W)[today]; return !!r && (r.packed.some((v) => v > 0) || r.picked.some((v) => v > 0)); };
  const out = ids.filter(any);
  return out.length ? out : [String(st.mainWh || ids[0])];
}

// ---------- announcements (Shift+9): a text for everyone or for one person, shown once to each person ----------
export const ANN_MAX = 500;
export function annFor(st, id, now) {
  id = String(id);
  return (st.ann || []).filter((x) => x.until > now && (x.to === 'all' || x.to === id) && !(x.seen || {})[id])
    .map((x) => ({ id: x.id, at: x.at, text: x.text, to: x.to === 'all' ? 'all' : 'you', by: x.byName || '' }));
}
export function annSeen(st, id, aid, now) {
  const x = (st.ann || []).find((y) => y.id === String(aid));
  if (!x || (x.to !== 'all' && x.to !== String(id))) return false;
  x.seen = x.seen || {};
  if (x.seen[id]) return false;
  x.seen[String(id)] = now;
  return true;
}
function annList(st, now) {
  return (st.ann || []).slice(-15).reverse().map((x) => ({ id: x.id, at: x.at, until: x.until, live: x.until > now, text: x.text, to: x.to, seen: x.seen || {} }));
}
