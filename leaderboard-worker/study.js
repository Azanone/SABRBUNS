// Batch study: follow the next N batches from the moment someone gets them until everything is picked.
// Only reads Picqer (the batch details the live loop already reads every 15 s).
// Per batch: time to bind (letters + containers), time to the first pick, pick time, pauses, every location and
// when it was done. From that: a realistic target per batch (seconds per stop + per item) and how everyone does against it.
import { NOT_PEOPLE } from './game.js';

const PAUSE = 10 * 60; // a gap of 10+ min between two picks = a pause, not walking
const ms = (s) => { const t = Date.parse(String(s || '').replace(' ', 'T')); return isFinite(t) ? t : null; };
// aisle = the start of the location: letters ("A12-03" → A) or the first number ("12-03-01" → 12)
const aisleOf = (loc) => { const m = String(loc || '').trim().match(/^[A-Za-z]+|^\d+/); return m ? m[0].toUpperCase() : '?'; };
const med = (a) => { const s = a.filter((x) => isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const q = (a, p) => { const s = a.filter((x) => isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export function newStudy(want, wh, now) {
  return { on: true, want: Math.max(1, Math.min(200, +want || 50)), wh: wh ? String(wh) : null, started: now, ended: null, b: {}, order: [], skip: {} };
}

function look(d) {
  const locs = {};
  let items = 0, total = 0;
  for (const p of d.products || []) {
    const k = String(p.stock_location || '').trim() || `#${p.idproduct}`;
    const L = (locs[k] = locs[k] || { need: 0, got: 0, skus: 0 });
    L.skus++;
    for (const x of p.picklists || []) { L.need += +x.amount || 0; L.got += Math.min(+x.amount_collected || 0, +x.amount || 0); }
  }
  for (const L of Object.values(locs)) { items += L.got; total += L.need; }
  const pls = (d.picklists || []).filter((p) => p.status !== 'cancelled');
  const openPl = pls.filter((p) => p.status !== 'closed');
  const isB = (p) => !!String(p.alias || '').trim() && !!p.picking_container;
  return { locs, items, total, n: pls.length, anyBound: openPl.some(isB), allBound: openPl.length > 0 && openPl.every(isB) };
}
const whoOf = (b) => { const a = b.assigned_to; return a && typeof a === 'object' ? String(a.iduser ?? '') : a != null ? String(a) : b.assigned_to_iduser != null ? String(b.assigned_to_iduser) : ''; };

// ids the live loop must read every cycle (the ones being followed right now)
export function studyActive(S) {
  if (!S || !S.on) return [];
  return S.order.filter((id) => { const r = S.b[id]; return r && !r.end && !r.gone; });
}

export function studyTick(S, open, details, { now, proxies = [] }) {
  if (!S || !S.on) return S;
  const skipWho = new Set([...proxies.map(String), ...NOT_PEOPLE]);
  const det = new Map(details.map((d) => [String(d.idpicklist_batch), d]));
  const openIds = new Set(open.map((b) => String(b.idpicklist_batch)));
  const t = (x) => Math.round(x / 1000); // seconds since the epoch, compact

  // 1) the ones we follow
  for (const id of studyActive(S)) {
    const r = S.b[id];
    const d = det.get(id);
    if (!openIds.has(id) && !d) { // left the open list: all picked → done at the last look, else gone
      if (r.got >= r.total && r.total > 0) r.end = r.last; else r.gone = now;
      continue;
    }
    if (!d) continue;
    const s = look(d);
    const sec = t(now);
    r.last = sec;
    if (s.anyBound && !r.bindStart) r.bindStart = sec;
    if (s.allBound && !r.bound) r.bound = sec;
    if (s.items > 0 && !r.first) { r.first = sec; if (!r.bound) r.bound = sec; } // picking started = binding was done
    r.total = s.total; r.n = s.n;
    for (const [k, L] of Object.entries(s.locs)) {
      const o = (r.locs[k] = r.locs[k] || [L.need, null, L.skus]);
      o[0] = L.need; o[2] = L.skus;
      if (o[1] == null && L.need > 0 && L.got >= L.need) o[1] = sec;
    }
    r.got = s.items;
    if (s.total > 0 && s.items >= s.total) r.end = sec;
  }

  // 2) new ones: assigned, nothing picked yet, while there is room
  for (const b of open) {
    const id = String(b.idpicklist_batch);
    if (S.b[id] || S.skip[id]) continue;
    if (S.order.length >= S.want) break;
    const d = det.get(id);
    if (!d) continue;
    const who = whoOf(b);
    if (!who || skipWho.has(who)) { S.skip[id] = 1; continue; }
    if (S.wh && String(b.idwarehouse) !== S.wh) { S.skip[id] = 1; continue; }
    const s = look(d);
    if (s.items > 0) { S.skip[id] = 1; continue; } // already being picked: we missed the start
    const sec = t(now);
    S.b[id] = {
      id, nr: String(d.picklist_batchid || b.picklist_batchid || id), wh: String(b.idwarehouse || d.idwarehouse || ''), who,
      type: String(d.type || b.type || ''), created: ms(d.created_at || b.created_at) ? t(ms(d.created_at || b.created_at)) : null,
      seen: sec, preBound: s.allBound, bindStart: s.anyBound ? sec : null, bound: s.allBound ? sec : null, first: null, end: null, gone: null, last: sec,
      n: s.n, total: s.total, got: 0, locs: Object.fromEntries(Object.entries(s.locs).map(([k, L]) => [k, [L.need, null, L.skus]])),
    };
    S.order.push(id);
  }
  // forget skip marks of batches that are no longer open
  for (const id of Object.keys(S.skip)) if (!openIds.has(id)) delete S.skip[id];
  // all N followed and finished → the study stops by itself
  if (S.order.length >= S.want && !studyActive(S).length && !S.ended) { S.ended = t(now); S.on = false; }
  return S;
}

// one batch → its numbers
function rowOf(r) {
  const locs = Object.entries(r.locs).map(([k, v]) => ({ k, need: v[0], at: v[1], skus: v[2] }));
  const stops = locs.length, items = r.total, skus = locs.reduce((a, l) => a + l.skus, 0);
  const aisles = new Set(locs.map((l) => aisleOf(l.k))).size;
  const done = locs.filter((l) => l.at != null).sort((a, b) => a.at - b.at);
  // gaps between finished locations (15 s resolution); gaps of 10+ min are pauses
  const gaps = [];
  let pause = 0;
  for (let i = 1; i < done.length; i++) {
    const g = done[i].at - done[i - 1].at;
    if (g >= PAUSE) { pause += g; continue; }
    gaps.push({ g, sw: aisleOf(done[i].k) !== aisleOf(done[i - 1].k) });
  }
  const pick = r.end && r.first ? r.end - r.first : null;
  const active = pick != null ? Math.max(0, pick - pause) : null;
  return {
    id: r.id, nr: r.nr, wh: r.wh, who: r.who, type: r.type, n: r.n, items, stops, skus, aisles,
    state: r.end ? 'done' : r.gone ? 'gone' : r.first ? 'picking' : r.bound ? 'bound' : 'waiting',
    seen: r.seen, preBound: !!r.preBound,
    bind: r.bound != null && !r.preBound ? r.bound - r.seen : r.preBound ? 0 : null,
    toFirst: r.first && r.bound ? r.first - r.bound : null,
    pick, pause, active, total: r.end ? r.end - r.seen : null,
    got: r.got, gaps,
    perStop: active != null && stops ? active / stops : null, perItem: active != null && items ? active / items : null,
  };
}

// least squares: active = a + b*stops + c*items (falls back to seconds per stop alone with few batches)
function fit(rows) {
  const X = rows.map((r) => [1, r.stops, r.items]), y = rows.map((r) => r.active);
  if (rows.length >= 8) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    X.forEach((x, i) => { for (let a = 0; a < 3; a++) { v[a] += x[a] * y[i]; for (let b = 0; b < 3; b++) A[a][b] += x[a] * x[b]; } });
    for (let a = 0; a < 3; a++) A[a][a] += 1e-6; // tiny ridge
    const sol = solve3(A, v);
    if (sol && sol[1] >= 0 && sol[2] >= 0 && sol[0] >= 0) return { a: sol[0], b: sol[1], c: sol[2], kind: 'fit' };
  }
  const ps = med(rows.map((r) => r.active / Math.max(1, r.stops)));
  return ps == null ? null : { a: 0, b: ps, c: 0, kind: 'per stop' };
}
function solve3(A, v) {
  const M = A.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[3] / M[i][i]);
}

export function studyView(S, names = {}, whNames = {}) {
  if (!S) return { on: false, none: true };
  const rows = S.order.map((id) => rowOf(S.b[id]));
  const done = rows.filter((r) => r.state === 'done' && r.active > 0 && r.stops > 0);
  const model = done.length ? fit(done) : null;
  const pred = (r) => (model ? model.a + model.b * r.stops + model.c * r.items : null);
  done.forEach((r) => { r.pred = pred(r); r.ratio = r.pred ? r.active / r.pred : null; });
  // "good" = what the best quarter does: the 25th percentile of actual/predicted
  const good = q(done.map((r) => r.ratio), 0.25), typical = q(done.map((r) => r.ratio), 0.5);
  const target = (r) => (model ? { typical: pred(r) * (typical || 1), good: pred(r) * (good || 1) } : null);
  rows.forEach((r) => { if (r.state !== 'done' && model) r.pred = pred(r); r.target = target(r); r.name = names[r.who] || `#${r.who}`; r.whName = whNames[r.wh] || ''; });
  const allGaps = done.flatMap((r) => r.gaps);
  const people = {};
  for (const r of done) {
    const p = (people[r.who] = people[r.who] || { who: r.who, name: r.name, n: 0, ratios: [], binds: [], perStop: [] });
    p.n++; p.ratios.push(r.ratio); if (r.bind != null && !r.preBound) p.binds.push(r.bind); p.perStop.push(r.perStop);
  }
  const ppl = Object.values(people).map((p) => ({ who: p.who, name: p.name, n: p.n, ratio: r1(med(p.ratios) * 100), bind: med(p.binds), perStop: r1(med(p.perStop)) }))
    .sort((a, b) => (a.ratio ?? 999) - (b.ratio ?? 999));
  const binds = rows.filter((r) => r.bind != null && !r.preBound).map((r) => r.bind);
  rows.forEach((r) => { delete r.gaps; });
  return {
    on: !!S.on, want: S.want, wh: S.wh, whName: S.wh ? whNames[S.wh] || '' : '', started: S.started, ended: S.ended,
    counts: { tracked: rows.length, done: done.length, picking: rows.filter((r) => r.state === 'picking').length, waiting: rows.filter((r) => r.state === 'waiting' || r.state === 'bound').length, gone: rows.filter((r) => r.state === 'gone').length },
    model: model && { a: r1(model.a), b: r1(model.b), c: r1(model.c), kind: model.kind, good: r1(good), typical: r1(typical) },
    stats: {
      bind: { med: med(binds), p25: q(binds, 0.25), p75: q(binds, 0.75), n: binds.length },
      toFirst: med(done.map((r) => r.toFirst)),
      perStop: r1(med(done.map((r) => r.perStop))), perItem: r1(med(done.map((r) => r.perItem))),
      gapSame: r1(med(allGaps.filter((g) => !g.sw).map((g) => g.g))), gapSwitch: r1(med(allGaps.filter((g) => g.sw).map((g) => g.g))),
      pauses: done.filter((r) => r.pause > 0).length,
      stops: r1(med(done.map((r) => r.stops))), items: r1(med(done.map((r) => r.items))), active: med(done.map((r) => r.active)),
    },
    people: ppl,
    rows: rows.reverse(),
  };
}
