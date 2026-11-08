// ==UserScript==
// @name         Picqer Combo Batcher
// @namespace    sabr.picqer.combo
// @version      4.16
// @description  Ctrl+Shift+B: identical product combos per shop (flyers ignored, singles skipped). Grouped batch split per shop, ordered for the fewest product changes. Optimized batches: max 15 picklists with the fewest different products, combine batches, assign to someone, auto batch for whoever has picked everything. BE pick-up picklists get a tag and always the last letters.
// @match        https://trl-fulfilment.picqer.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      trl-fulfilment.picqer.com
// ==/UserScript==

(function () {
  'use strict';

  // ---------- CONFIG ----------
  const BASE = 'https://trl-fulfilment.picqer.com/api/v1';
  const CONF = {
    ignoreCodes: ['8720299635869'],               // flyers that never count (Eve Curls)
    minGroup: 2,                                  // min picklists per combo
    flyerOrder: ['GLW-FLYER-NL', 'GLW-FLYER-DE'], // grouped batch: combos with these flyers first, in this order
    skipAssignedTo: [25084, 36135, 33549],        // parked by error handler / zap / dayson -> never re-batch
    batchMax: 15,                                 // optimized tab: max picklists per batch (changeable in the tab)
    highlightTags: ['BE pick-up'],                // BE pick-up: badge + always the last letters of a batch
    autoWarehouse: 'Bunsenstraat',                // optimized tab, auto batch: only picklists of this warehouse (name or id)
  };

  // ---------- API ----------
  function getKey() {
    let k = GM_getValue('picqer_api_key', '');
    if (!k) {
      k = prompt('Picqer API key:') || '';
      if (k) GM_setValue('picqer_api_key', k.trim());
    }
    return k.trim();
  }
  GM_registerMenuCommand('Reset Picqer API key', () => {
    GM_setValue('picqer_api_key', '');
    alert('Key cleared');
  });

  function api(method, path, body) {
    const key = getKey();
    if (!key) return Promise.reject(new Error('No API key'));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: BASE + path,
        headers: {
          Authorization: 'Basic ' + btoa(key + ':'),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'ComboBatcher (TRL)',
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) {
            try { resolve(r.responseText ? JSON.parse(r.responseText) : null); } catch (e) { reject(e); }
            return;
          }
          const err = new Error(`HTTP ${r.status}: ${(r.responseText || '').slice(0, 200)}`);
          err.status = r.status;
          err.rate = r.status === 429;
          reject(err);
        },
        onerror: () => reject(Object.assign(new Error('Network error'), { status: 0 })),
      });
    });
  }

  // =====================================================================
  //  COMBO BATCHER CORE (same code in standalone + suite)
  // =====================================================================
  function buildComboBatcher({ api, store, conf }) {
    const IGNORE_CODES = (conf.ignoreCodes || []).map(String);
    const MIN_GROUP = Math.max(2, +conf.minGroup || 2);
    const FLYER_ORDER = (conf.flyerOrder || []).map(String).filter(Boolean);
    const SKIP_USERS = (conf.skipAssignedTo || []).map(String).filter((s) => s && s !== '0');
    const MARKER = '[COMBO CHANGED]';
    const PAGE = 100;
    const EXACT_MAX = 15; // exact best order up to this many combos per flyer block
    const BATCH_MAX = Math.min(200, Math.max(2, +conf.batchMax || 15)); // optimized tab: max picklists per batch
    const PALETTE = ['#2563eb', '#7c3aed', '#0d9488', '#ea580c', '#db2777', '#16a34a', '#ca8a04', '#0891b2', '#e11d48', '#4f46e5'];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // batches with picklists that have one of these tags get a lime badge (BE pick-up).
    // "BE pick-up", "BE Pickup", "Pick-up BE" all count as the same tag.
    const canonTag = (s) => String(s || '').toLowerCase().replace(/pick[\s_-]*up/g, 'pickup').split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
    const HL_TAGS = (conf.highlightTags || ['BE pick-up']).map(String).map((s) => s.trim()).filter(Boolean);
    const HL_CANON = HL_TAGS.map(canonTag).filter(Boolean);
    const HL_LABEL = HL_TAGS[0] || 'BE pick-up';
    function hasHlTag(pl) {
      if (!HL_CANON.length || !pl || !pl.tags) return false;
      const tags = Array.isArray(pl.tags) ? pl.tags : Object.values(pl.tags);
      return tags.some((t) => HL_CANON.includes(canonTag(t && typeof t === 'object' ? t.title || t.name : t)));
    }
    // picklists with one of these tags never go in an optimized / auto batch (EIGENAAR = owner's own orders)
    const SKIP_TAGS = (conf.skipTags || ['EIGENAAR']).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    function hasSkipTag(pl) {
      if (!SKIP_TAGS.length || !pl || !pl.tags) return false;
      const tags = Array.isArray(pl.tags) ? pl.tags : Object.values(pl.tags);
      return tags.some((t) => { const n = String(t && typeof t === 'object' ? t.title || t.name : t).toLowerCase(); return SKIP_TAGS.some((k) => n.includes(k)); });
    }
    const hlCount = (pls) => pls.reduce((n, pl) => n + (hasHlTag(pl) ? 1 : 0), 0);
    const hlBadge = (n) => (n ? `<span class="cb-delta cb-lime" title="${n} picklist${n === 1 ? '' : 's'} with the ${esc(HL_LABEL)} tag · they get the last letters (grouped batch: the last of their combo)">${esc(HL_LABEL)} ${n}</span>` : '');

    // snoozed picklists: leave them out (default), take them too, or only them
    const SNZ_MODES = { out: 'Without snoozed', with: 'With snoozed', only: 'Only snoozed' };
    let snoozeMode = SNZ_MODES[store.get('cb_snoozed', 'out')] ? store.get('cb_snoozed', 'out') : 'out';
    const statusesFor = (m) => (m === 'only' ? ['snoozed'] : m === 'with' ? ['new', 'snoozed'] : ['new']);
    let allowedStatus = new Set(statusesFor(snoozeMode));
    const isSnoozed = (pl) => !!pl && pl.status === 'snoozed';
    const snzCount = (pls) => pls.reduce((n, pl) => n + (isSnoozed(pl) ? 1 : 0), 0);
    const snzBadge = (n) => (n ? `<span class="cb-delta cb-snz" title="${n} snoozed picklist${n === 1 ? '' : 's'} · they get unsnoozed when they go in a batch">snoozed ${n}</span>` : '');
    // different products of some combos (what the picker walks to)
    const skuCount = (gs) => new Set(gs.flatMap((g) => g.items.map((i) => i.code))).size;

    // ---------- api helpers ----------
    async function apiRetry(method, path, body, opt = {}) {
      let fails = 0;
      for (let i = 0; i < 8; i++) {
        try { return await api(method, path, body); }
        catch (e) {
          if (e.rate) { await sleep(1500 * (i + 1)); continue; }
          if (opt.retry5xx && e.status >= 500 && fails < 2) { fails++; await sleep(800); continue; }
          throw e;
        }
      }
      throw new Error('Rate limited too many times');
    }

    async function pool(items, limit, fn) {
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) { const k = i++; await fn(items[k], k); }
      }));
    }

    async function paginate(path, onPage) {
      const out = [];
      const sep = path.includes('?') ? '&' : '?';
      for (let offset = 0; ; offset += PAGE) {
        const page = (await apiRetry('GET', `${path}${sep}offset=${offset}`, null, { retry5xx: true })) || [];
        out.push(...page);
        if (onPage) onPage(out.length);
        if (page.length < PAGE) break;
      }
      return out;
    }

    // ---------- shops ----------
    let shops = [];
    const selectedShops = new Set(store.get('cb_shops', []) || []);
    const saveShops = () => { store.set('cb_shops', [...selectedShops]); autoPl = null; }; // only called on clicks, after init
    const shopName = (id) => (shops.find((s) => s.idfulfilment_customer === id) || {}).name || `#${id}`;
    async function loadShops() {
      if (shops.length) return;
      shops = (await paginate('/fulfilment/customers')).sort((a, b) => a.name.localeCompare(b.name));
    }

    // ---------- grouping ----------
    let skippedSingles = 0, skippedParked = 0, gid = 0;
    let multis = []; // every picklist with 2+ products that may go in a batch (optimized tab)
    const byId = new Map();

    function comboKey(pl) {
      const map = {};
      for (const p of pl.products || []) {
        if (IGNORE_CODES.includes(String(p.productcode))) continue;
        if (p.has_parts) continue; // samenstelling: the parts are the real products
        map[p.productcode] = (map[p.productcode] || 0) + p.amount;
      }
      const codes = Object.keys(map).sort();
      if (!codes.length) return null;
      if (codes.length === 1) return { single: true }; // 1 different product = singles batch
      return {
        key: `${pl.idfulfilment_customer}|${pl.idwarehouse}|` + codes.map((c) => `${c}x${map[c]}`).join(','),
        items: codes.map((c) => ({ code: c, amount: map[c], name: ((pl.products.find((p) => p.productcode === c) || {}).name || c).trim() })),
        amt: new Map(codes.map((c) => [c, map[c]])),
      };
    }

    // may this picklist go in a batch? null = no, 'parked' / 'single' = no (counted), else its combo
    function classify(pl, statuses) {
      if (!pl || !statuses.has(pl.status) || pl.idpicklist_batch) return null;
      // parked by zap / dayson / error handler -> never put back in a batch
      if (SKIP_USERS.length && pl.assigned_to_iduser != null && SKIP_USERS.includes(String(pl.assigned_to_iduser))) return 'parked';
      const ck = comboKey(pl);
      if (!ck) return null;
      return ck.single ? 'single' : ck;
    }

    function group(picklists) {
      const groups = {};
      skippedSingles = 0;
      skippedParked = 0;
      multis = [];
      for (const pl of picklists) {
        const ck = classify(pl, allowedStatus);
        if (!ck) continue;
        if (ck === 'parked') { skippedParked++; continue; }
        if (ck === 'single') { skippedSingles++; continue; }
        multis.push({ pl, items: ck.items, combo: ck.key });
        let g = groups[ck.key];
        if (!g) {
          g = groups[ck.key] = {
            id: 'g' + (++gid), key: ck.key, shop: pl.idfulfilment_customer, warehouse: pl.idwarehouse,
            items: ck.items, amt: ck.amt, picklists: [], checked: false, used: false,
          };
        }
        g.picklists.push(pl);
      }
      const out = Object.values(groups).filter((g) => g.picklists.length >= MIN_GROUP);
      byId.clear();
      out.forEach((g) => byId.set(g.id, g));
      return out;
    }

    // which flyer block a combo belongs to (NL first, then DE, then the rest)
    function flyerRank(g) {
      let r = FLYER_ORDER.length;
      for (const it of g.items) { const i = FLYER_ORDER.indexOf(it.code); if (i >= 0 && i < r) r = i; }
      return r;
    }

    // number of products that change between 2 combos (added, removed or other amount)
    function diff(a, b) {
      let n = 0;
      for (const [code, amt] of a.amt) if (b.amt.get(code) !== amt) n++;
      for (const code of b.amt.keys()) if (!a.amt.has(code)) n++;
      return n;
    }

    function comboDiff(oldItems, newItems) {
      const k = (i) => `${i.code}x${i.amount}`;
      const oldK = new Set(oldItems.map(k)), newK = new Set(newItems.map(k));
      const plus = newItems.filter((i) => !oldK.has(k(i))).map((i) => `+ ${i.amount}x ${i.name}`);
      const min = oldItems.filter((i) => !newK.has(k(i))).map((i) => `- ${i.amount}x ${i.name}`);
      return [...plus, ...min].join(' ; ');
    }
    const comboLabel = (items) => items.map((i) => `${i.amount}x ${i.name}`).join(' + ');
    const aliasSort = (a, b) => (a.alias && b.alias ? a.alias.length - b.alias.length || a.alias.localeCompare(b.alias) : 0);

    function seqChanges(seq) {
      let n = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i].shop === seq[i - 1].shop) n += diff(seq[i - 1], seq[i]);
      return n;
    }

    // ---------- order optimizer ----------
    // Looks at the whole sequence, not just the next step: picks the order with the
    // fewest product changes in total. Flyer blocks stay in FLYER_ORDER, the switch
    // between blocks is optimized too. Ties -> start with the biggest combo.
    function optimize(list) {
      if (list.length < 2) return list.slice();
      const nodes = list.slice().sort((a, b) => b.picklists.length - a.picklists.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const N = nodes.length;
      const total = nodes.reduce((s, g) => s + g.picklists.length, 0);
      const eps = 0.5 / (total + 1); // tiny tie breaker, never outweighs 1 real change
      const w = new Float64Array(N);
      nodes.forEach((g, i) => (w[i] = eps * g.picklists.length));
      const M = new Float64Array(N * N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) M[i * N + j] = i === j ? 0 : diff(nodes[i], nodes[j]) + w[j];
      const byRank = new Map();
      nodes.forEach((g, i) => { const r = flyerRank(g); if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(i); });
      const blocks = [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r));
      const seq = blocks.every((b) => b.length <= EXACT_MAX) ? exactChain(blocks, M, N) : heuristic(blocks, M, N, w);
      return seq.map((i) => nodes[i]);
    }

    // exact: Held-Karp per block, chained over the blocks (end of block k feeds block k+1)
    function exactChain(blocks, M, N) {
      let prev = null;
      for (const block of blocks) {
        const n = block.length, S = 1 << n, full = S - 1;
        const dp = new Float64Array(S * n).fill(Infinity);
        const par = new Int8Array(S * n).fill(-1);
        const entry = new Int32Array(n).fill(-1);
        for (let v = 0; v < n; v++) {
          let best = 0, bi = -1;
          if (prev) {
            best = Infinity;
            for (let i = 0; i < prev.length; i++) {
              const c = prev[i].total + M[prev[i].node * N + block[v]];
              if (c < best) { best = c; bi = i; }
            }
          }
          dp[(1 << v) * n + v] = best;
          entry[v] = bi;
        }
        for (let mask = 1; mask < S; mask++) {
          for (let v = 0; v < n; v++) {
            if (!(mask & (1 << v))) continue;
            const cur = dp[mask * n + v];
            if (cur === Infinity) continue;
            const row = block[v] * N;
            for (let x = 0; x < n; x++) {
              if (mask & (1 << x)) continue;
              const j = (mask | (1 << x)) * n + x;
              const c = cur + M[row + block[x]];
              if (c < dp[j]) { dp[j] = c; par[j] = v; }
            }
          }
        }
        const states = [];
        for (let e = 0; e < n; e++) {
          const path = [];
          let mask = full, v = e;
          for (;;) {
            path.push(block[v]);
            const p = par[mask * n + v];
            if (p < 0) break;
            mask &= ~(1 << v);
            v = p;
          }
          path.reverse();
          const from = entry[block.indexOf(path[0])];
          states.push({ node: block[e], total: dp[full * n + e], path: (prev && from >= 0 ? prev[from].path : []).concat(path) });
        }
        prev = states;
      }
      let best = prev[0];
      for (const s of prev) if (s.total < best.total - 1e-12) best = s;
      return best.path;
    }

    // big blocks: multi start greedy + 2-opt + or-opt, moves stay inside their block
    function heuristic(blocks, M, N, w) {
      const blockOf = new Int32Array(N);
      blocks.forEach((b, bi) => b.forEach((x) => (blockOf[x] = bi)));
      const c = (a, b) => M[a * N + b];
      const seqCost = (s) => { let t = 0; for (let i = 1; i < s.length; i++) t += c(s[i - 1], s[i]); return t; };
      const reverse = (s, i, j) => { while (i < j) { const t = s[i]; s[i] = s[j]; s[j] = t; i++; j--; } };

      function greedy(start) {
        const used = new Uint8Array(N);
        const s = [start];
        used[start] = 1;
        for (let bi = 0; bi < blocks.length; bi++) {
          for (;;) {
            const last = s[s.length - 1];
            let best = -1, bc = Infinity;
            for (const x of blocks[bi]) if (!used[x]) { const v = c(last, x); if (v < bc) { bc = v; best = x; } }
            if (best < 0) break;
            used[best] = 1;
            s.push(best);
          }
        }
        return s;
      }

      function improve(s) {
        const n = s.length;
        for (let pass = 0; pass < 40; pass++) {
          let improved = false;
          for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n && blockOf[s[j]] === blockOf[s[i]]; j++) {
              let d = w[s[i]] - w[s[j]];
              if (i > 0) d += c(s[i - 1], s[j]) - c(s[i - 1], s[i]);
              if (j < n - 1) d += c(s[i], s[j + 1]) - c(s[j], s[j + 1]);
              if (d < -1e-9) { reverse(s, i, j); improved = true; }
            }
          }
          for (let L = 1; L <= 3; L++) {
            for (let i = 0; i + L <= n; i++) {
              const j = i + L - 1;
              const b = blockOf[s[i]];
              if (blockOf[s[j]] !== b) continue;
              const pv = i > 0 ? s[i - 1] : -1, nx = j < n - 1 ? s[j + 1] : -1;
              const gain = (pv >= 0 ? c(pv, s[i]) : 0) + (nx >= 0 ? c(s[j], nx) : 0) - (pv >= 0 && nx >= 0 ? c(pv, nx) : 0);
              const seg = s.slice(i, j + 1);
              const rest = s.slice(0, i).concat(s.slice(j + 1));
              let bestD = -1e-9, bestP = -1;
              for (let p = 0; p <= rest.length; p++) {
                if (p === i) continue;
                const A = p > 0 ? rest[p - 1] : -1, B = p < rest.length ? rest[p] : -1;
                if (!((A >= 0 && blockOf[A] === b) || (B >= 0 && blockOf[B] === b))) continue;
                const add = (A >= 0 ? c(A, seg[0]) : 0) + (B >= 0 ? c(seg[L - 1], B) : 0) - (A >= 0 && B >= 0 ? c(A, B) : 0);
                if (add - gain < bestD) { bestD = add - gain; bestP = p; }
              }
              if (bestP >= 0) {
                rest.splice(bestP, 0, ...seg);
                for (let k = 0; k < n; k++) s[k] = rest[k];
                improved = true;
              }
            }
          }
          if (!improved) break;
        }
        return s;
      }

      let best = null, bestC = Infinity;
      for (const st of blocks[0].slice(0, 12)) {
        const s = improve(greedy(st));
        const sc = seqCost(s);
        if (sc < bestC - 1e-9) { bestC = sc; best = s; }
      }
      return best;
    }

    const bestCache = new Map();
    function bestChanges(sel) {
      const k = sel.map((g) => g.id).sort().join(',');
      if (!bestCache.has(k)) bestCache.set(k, seqChanges(optimize(sel)));
      return bestCache.get(k);
    }

    // ---------- batch packer (optimized tab) ----------
    // sets = product ids per picklist, K = max picklists per batch. Returns batches (index lists)
    // with the fewest different products summed over all batches; on a tie, fewer batches.
    // Putting 2 batches together never adds products, so batches end up as full as they can.
    function packBatches(sets, K, opt = {}) {
      const n = sets.length;
      K = Math.max(1, K | 0);
      if (!n) return [];
      if (n <= K) return [sets.map((_, i) => i)];
      let M = 0;
      for (const s of sets) for (const x of s) if (x >= M) M = x + 1;
      const skuItems = Array.from({ length: M }, () => []);
      sets.forEach((s, i) => s.forEach((x) => skuItems[x].push(i)));
      const EPS = 1e-3;
      const runs = opt.runs || (n <= 400 ? 3 : 2);
      const budget = opt.iters || Math.min(500000, Math.max(40000, n * 1500));

      function mulberry32(a) {
        return function () {
          a |= 0; a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      // identical product sets = one type
      const typeOf = new Int32Array(n);
      const types = [];
      {
        const idx = new Map();
        sets.forEach((s, i) => {
          const k = s.slice().sort((a, b) => a - b).join(',');
          let t = idx.get(k);
          if (t == null) { t = types.length; idx.set(k, t); types.push([]); }
          types[t].push(i);
          typeOf[i] = t;
        });
      }

      // greedy start: build the cheapest full batch, take it out, repeat
      function construct(rnd) {
        const left = new Uint8Array(n).fill(1);
        const inBatch = new Uint8Array(n);
        const inB = new Int32Array(M);
        const ac = new Int32Array(n); // products this picklist would add to the batch being built
        const typeLeft = types.map((t) => t.length);
        const nSeeds = n > 500 ? 3 : 5;
        let nLeft = n;
        const out = [];
        while (nLeft > 0) {
          if (nLeft <= K) { const all = []; for (let i = 0; i < n; i++) if (left[i]) all.push(i); out.push(all); break; }
          const order = [];
          typeLeft.forEach((c, t) => { if (c > 0) order.push([c, t]); });
          order.sort((a, b) => b[0] - a[0]);
          const seeds = order.slice(0, nSeeds).map((x) => types[x[1]].find((i) => left[i]));
          for (let r = 0; r < 2; r++) { let i = (rnd() * n) | 0; for (let k = 0; k < n && !left[i]; k++) i = (i + 1) % n; seeds.push(i); }
          let best = null, bestU = Infinity;
          for (const s0 of new Set(seeds)) {
            for (let i = 0; i < n; i++) ac[i] = sets[i].length;
            const mem = [];
            let u = 0;
            const put = (b) => {
              mem.push(b); inBatch[b] = 1;
              for (const x of sets[b]) if (inB[x]++ === 0) { u++; for (const j of skuItems[x]) ac[j]--; }
            };
            put(s0);
            while (mem.length < K) {
              let bi = -1, bc = 1e9, bs = -1;
              for (let i = 0; i < n; i++) {
                if (!left[i] || inBatch[i]) continue;
                const c = ac[i];
                if (c < bc || (c === bc && sets[i].length > bs)) { bc = c; bs = sets[i].length; bi = i; }
              }
              if (bi < 0) break;
              put(bi);
            }
            for (const b of mem) { inBatch[b] = 0; for (const x of sets[b]) inB[x]--; }
            if (u < bestU) { bestU = u; best = mem; }
          }
          for (const i of best) { left[i] = 0; typeLeft[typeOf[i]]--; }
          nLeft -= best.length;
          out.push(best);
        }
        return out;
      }

      function solve(seed) {
        const rnd = mulberry32(seed);
        const start = construct(rnd);
        const B = start.length + 2;
        const cnt = new Int32Array(B * M);
        const size = new Int32Array(B), cost = new Int32Array(B);
        const where = new Int32Array(n).fill(-1), pos = new Int32Array(n);
        const mem = Array.from({ length: B }, () => []);
        const markI = new Int32Array(M), markJ = new Int32Array(M);
        let tag = 0;
        function add(i, b) {
          const base = b * M;
          for (const x of sets[i]) if (cnt[base + x]++ === 0) cost[b]++;
          pos[i] = mem[b].length; mem[b].push(i); where[i] = b; size[b]++;
        }
        function rem(i) {
          const b = where[i], base = b * M;
          for (const x of sets[i]) if (--cnt[base + x] === 0) cost[b]--;
          const m = mem[b], p = pos[i], last = m.pop();
          if (last !== i) { m[p] = last; pos[last] = p; }
          size[b]--; where[i] = -1;
        }
        const addCost = (i, b) => { let c = 0; const base = b * M; for (const x of sets[i]) if (cnt[base + x] === 0) c++; return c; };
        const remGain = (i, b) => { let c = 0; const base = b * M; for (const x of sets[i]) if (cnt[base + x] === 1) c++; return c; };
        function swapDelta(i, j) {
          const a = where[i] * M, b = where[j] * M;
          tag++;
          for (const x of sets[i]) markI[x] = tag;
          for (const x of sets[j]) markJ[x] = tag;
          let d = 0;
          for (const x of sets[i]) if (markJ[x] !== tag) { if (cnt[a + x] === 1) d--; if (cnt[b + x] === 0) d++; }
          for (const x of sets[j]) if (markI[x] !== tag) { if (cnt[b + x] === 1) d--; if (cnt[a + x] === 0) d++; }
          return d;
        }
        const total = () => { let t = 0, nb = 0; for (let b = 0; b < B; b++) if (size[b]) { t += cost[b]; nb++; } return t + EPS * nb; };
        start.forEach((m, b) => m.forEach((i) => add(i, b)));

        // simulated annealing: move or swap picklists between batches that share products
        let cur = total(), bestCur = cur;
        const bestWhere = Int32Array.from(where);
        const T0 = 1.2, T1 = 0.03;
        let T = T0;
        for (let it = 0; it < budget; it++) {
          if ((it & 1023) === 0) T = T0 * Math.pow(T1 / T0, it / budget);
          const i = (rnd() * n) | 0, A = where[i], si = sets[i];
          let Bt;
          if (rnd() < 0.85) { const lst = skuItems[si[(rnd() * si.length) | 0]]; Bt = where[lst[(rnd() * lst.length) | 0]]; }
          else Bt = (rnd() * B) | 0;
          if (Bt === A) continue;
          if (size[Bt] < K) {
            const delta = addCost(i, Bt) - remGain(i, A) + EPS * ((size[Bt] === 0 ? 1 : 0) - (size[A] === 1 ? 1 : 0));
            if (delta <= 0 || rnd() < Math.exp(-delta / T)) { rem(i); add(i, Bt); cur += delta; }
          } else {
            const m = mem[Bt], j = m[(rnd() * m.length) | 0];
            const delta = swapDelta(i, j);
            if (delta <= 0 || rnd() < Math.exp(-delta / T)) { rem(i); rem(j); add(i, Bt); add(j, A); cur += delta; }
          }
          if (cur < bestCur - 1e-9) { bestCur = cur; bestWhere.set(where); }
        }
        for (let i = 0; i < n; i++) if (where[i] >= 0) rem(i);
        for (let i = 0; i < n; i++) add(i, bestWhere[i]);

        // clean up: best single moves / swaps until nothing improves
        // a swap i<->j can only win if (move i alone) + (move j alone) < 0, so skip the rest fast
        const minR = new Float64Array(B * B);
        for (let pass = 0; pass < 30; pass++) {
          let improved = false;
          minR.fill(Infinity);
          for (let j = 0; j < n; j++) {
            const b = where[j], g = remGain(j, b);
            for (let a = 0; a < B; a++) { if (a === b) continue; const r = addCost(j, a) - g; if (r < minR[b * B + a]) minR[b * B + a] = r; }
          }
          for (let i = 0; i < n; i++) {
            const A = where[i], gi = remGain(i, A);
            let bestD = -1e-9, bestB = -1, bestJ = -1;
            for (let b = 0; b < B; b++) {
              if (b === A) continue;
              const ri = addCost(i, b) - gi;
              if (size[b] < K) {
                const d = ri + EPS * ((size[b] === 0 ? 1 : 0) - (size[A] === 1 ? 1 : 0));
                if (d < bestD) { bestD = d; bestB = b; bestJ = -1; }
              }
              if (!size[b] || ri + minR[b * B + A] >= 0) continue;
              for (const j of mem[b]) { const d = swapDelta(i, j); if (d < bestD) { bestD = d; bestB = b; bestJ = j; } }
            }
            if (bestB >= 0) {
              if (bestJ < 0) { rem(i); add(i, bestB); } else { rem(i); rem(bestJ); add(i, bestB); add(bestJ, A); }
              improved = true;
            }
          }
          // 2 batches that fit together: put them together (never costs extra products, saves a batch)
          for (;;) {
            let ba = -1, bb = -1, bd = Infinity;
            for (let a = 0; a < B; a++) {
              if (!size[a]) continue;
              for (let b = a + 1; b < B; b++) {
                if (!size[b] || size[a] + size[b] > K) continue;
                let u = cost[a];
                for (let x = 0; x < M; x++) if (cnt[b * M + x] && !cnt[a * M + x]) u++;
                const d = u - cost[a] - cost[b];
                if (d < bd) { bd = d; ba = a; bb = b; }
              }
            }
            if (ba < 0) break;
            for (const i of mem[bb].slice()) { rem(i); add(i, ba); }
            improved = true;
          }
          if (!improved) break;
        }
        const batches = [];
        let t = 0;
        for (let b = 0; b < B; b++) if (size[b]) { batches.push(mem[b].slice()); t += cost[b]; }
        return { batches, total: t };
      }

      let best = null;
      for (let r = 0; r < runs; r++) {
        const s = solve(1 + r * 7919);
        if (!best || s.total < best.total || (s.total === best.total && s.batches.length < best.batches.length)) best = s;
      }
      return best.batches;
    }

    // ---------- full batches (auto batch) ----------
    // for every size k = 1..K: k picklists with the fewest different products (SKUs); same count -> the oldest.
    // sets = product codes per picklist, ids = idpicklist (lower = older).
    // Returns res[k] = { pick: indexes, skus, age } (null when there are less than k picklists).
    // Grows a set of products from many starting points (each time the products that make the most picklists
    // complete per product added); for each size it drops the products not needed and takes the oldest that fit.
    function bestBySize(sets, ids, K) {
      const n = sets.length;
      const res = new Array(Math.max(0, K) + 1).fill(null);
      if (!(K > 0) || !n) return res;
      const skuIdx = new Map(), typeMap = new Map(), types = [];
      const typeOf = new Int32Array(n);
      sets.forEach((codes, i) => {
        const u = [...new Set(codes.map(String))].sort();
        const key = u.join('\u0001');
        let t = typeMap.get(key);
        if (t == null) {
          t = types.length;
          typeMap.set(key, t);
          types.push({ sk: u.map((c) => { if (!skuIdx.has(c)) skuIdx.set(c, skuIdx.size); return skuIdx.get(c); }), n: 0 });
        }
        types[t].n++;
        typeOf[i] = t;
      });
      const S = skuIdx.size, T = types.length;
      const cnt = types.map((t) => t.n);
      const withSku = Array.from({ length: S }, () => []);
      types.forEach((t, j) => t.sk.forEach((x) => withSku[x].push(j)));
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => ids[a] - ids[b]); // oldest first
      const inU = new Uint8Array(S), cov = new Uint8Array(T), seen = new Int32Array(T);
      const inU2 = new Uint8Array(S), cov2 = new Uint8Array(T);
      let mark = 0, have = 0;
      const fits = (j) => { for (const x of types[j].sk) if (!inU[x]) return false; return true; };

      // size k with the products we have now: drop the ones not needed, then the oldest k that fit.
      // every product left is needed, so any k of the picklists that fit use exactly those products
      function finish(k) {
        inU2.set(inU); cov2.set(cov);
        let h = have, usz = 0;
        for (let x = 0; x < S; x++) usz += inU2[x];
        for (;;) {
          let bx = -1, bLoss = Infinity;
          for (let x = 0; x < S; x++) {
            if (!inU2[x]) continue;
            let loss = 0;
            for (const j of withSku[x]) if (cov2[j]) loss += cnt[j];
            if (h - loss >= k && loss < bLoss) { bLoss = loss; bx = x; }
          }
          if (bx < 0) break;
          inU2[bx] = 0; usz--;
          for (const j of withSku[bx]) if (cov2[j]) { cov2[j] = 0; h -= cnt[j]; }
        }
        const r = res[k];
        if (r && r.skus < usz) return;
        const pick = [];
        let age = 0;
        for (const i of order) if (cov2[typeOf[i]]) { pick.push(i); age += ids[i]; if (pick.length === k) break; }
        if (!r || usz < r.skus || (usz === r.skus && age < r.age)) res[k] = { pick, skus: usz, age };
      }

      function grow(seed) {
        inU.fill(0); cov.fill(0);
        for (const x of seed) inU[x] = 1;
        have = 0;
        for (let j = 0; j < T; j++) if (fits(j)) { cov[j] = 1; have += cnt[j]; }
        for (let k = 1; ;) {
          for (; k <= Math.min(K, have); k++) finish(k);
          if (have >= K) return;
          let bi = -1, bScore = -1, bNew = Infinity;
          for (let i = 0; i < T; i++) {
            if (cov[i]) continue;
            const nw = types[i].sk.filter((x) => !inU[x]);
            for (const x of nw) inU[x] = 1;
            let gain = 0;
            mark++;
            for (const x of nw) for (const j of withSku[x]) if (!cov[j] && seen[j] !== mark) { seen[j] = mark; if (fits(j)) gain += cnt[j]; }
            for (const x of nw) inU[x] = 0;
            const score = gain / Math.max(1, nw.length);
            if (score > bScore + 1e-9 || (score > bScore - 1e-9 && nw.length < bNew)) { bScore = score; bi = i; bNew = nw.length; }
          }
          if (bi < 0) return;
          const nw = types[bi].sk.filter((x) => !inU[x]);
          for (const x of nw) inU[x] = 1;
          mark++;
          for (const x of nw) for (const j of withSku[x]) if (!cov[j] && seen[j] !== mark) { seen[j] = mark; if (fits(j)) { cov[j] = 1; have += cnt[j]; } }
        }
      }

      const seeds = [[]];
      types.map((t, j) => j).sort((a, b) => cnt[b] - cnt[a]).slice(0, 150).forEach((j) => seeds.push(types[j].sk));
      for (const sd of seeds) grow(sd);
      return res;
    }
    // exactly K picklists with the fewest SKUs (indexes), null when there are less than K
    function bestFull(sets, ids, K) { const r = bestBySize(sets, ids, K)[K]; return r ? r.pick : null; }

    // ---------- UI ----------
    const style = document.createElement('style');
    style.textContent = `
      #cb-overlay{position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center}
      #cb-panel{width:780px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;background:#f1f5f9;border-radius:12px;
        box-shadow:0 16px 48px rgba(0,0,0,.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#0f172a;overflow:hidden}
      #cb-panel button,#cb-panel input{font-family:inherit}
      .cb-head{background:#fff;border-bottom:1px solid #e2e8f0;flex:none}
      .cb-top{padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px}
      .cb-top b{font-size:15px}
      #cb-status{color:#64748b;font-size:12px;margin-top:2px}
      .cb-topbtns{display:flex;gap:6px}
      .cb-btn{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:600;color:#0f172a}
      .cb-btn:hover{background:#e2e8f0}
      .cb-btn:disabled{opacity:.5;cursor:default}
      .cb-btn.hot{background:#fef3c7;border-color:#f59e0b;color:#92400e}
      .cb-tabs{display:flex;padding:0 14px;gap:4px}
      .cb-tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 10px;font-size:12px;font-weight:600;color:#64748b;cursor:pointer}
      .cb-tab.on{color:#0f172a;border-color:#0f172a}
      .cb-log{display:none;max-height:120px;overflow:auto;padding:8px 14px;font:12px ui-monospace,Menlo,Consolas,monospace;color:#334155;white-space:pre-wrap;background:#f8fafc;border-top:1px solid #e2e8f0}
      .cb-body{flex:1;overflow:auto;min-height:120px}
      .cb-empty{padding:28px;text-align:center;color:#64748b}
      .cb-card{margin:12px;background:#fff;border:1px solid #e2e8f0;border-left:5px solid var(--c);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)}
      .cb-card-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--t);border-bottom:1px solid #e2e8f0}
      .cb-card-hd b{color:var(--c);font-size:13px}
      .cb-card-hd small{color:#64748b}
      .cb-sp{flex:1}
      .cb-dot{width:10px;height:10px;border-radius:3px;background:var(--c);flex:none}
      .cb-row{padding:10px 12px;border-top:1px solid #f1f5f9;display:flex;gap:12px;align-items:center}
      .cb-card-hd + .cb-row,.cb-sub + .cb-row{border-top:0}
      #cb-grouped .cb-row{cursor:pointer}
      #cb-grouped .cb-row:hover{background:#f8fafc}
      #cb-grouped .cb-row.on{background:var(--t)}
      .cb-count{font-size:18px;font-weight:700;min-width:42px;text-align:center}
      .cb-items{flex:1;min-width:0}
      .cb-items div{line-height:1.5}
      .cb-items small{color:#94a3b8}
      .cb-sub{padding:4px 12px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c);background:#f8fafc;border-top:1px solid #f1f5f9}
      .cb-delta{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
      .cb-ds{background:#f1f5f9;color:#64748b}
      .cb-dg{background:#dcfce7;color:#15803d}
      .cb-da{background:#fef3c7;color:#b45309}
      .cb-dr{background:#fee2e2;color:#b91c1c}
      .cb-go{background:#16a34a;color:#fff;border:0;border-radius:6px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
      .cb-go:disabled{background:#94a3b8;cursor:default}
      .cb-chk{width:16px;height:16px;flex:none;cursor:pointer;accent-color:var(--c)}
      .cb-ord{display:flex;flex-direction:column;gap:2px}
      .cb-ord button{background:#f1f5f9;border:0;border-radius:4px;width:22px;height:17px;cursor:pointer;font-size:9px;line-height:1;color:#475569}
      .cb-ord button:disabled{opacity:.35;cursor:default}
      .cb-bar{position:sticky;bottom:0;background:#fff;border-top:1px solid #e2e8f0;padding:10px 14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 -4px 12px rgba(15,23,42,.06)}
      .cb-strip{display:flex;gap:3px;overflow-x:auto;padding-bottom:2px}
      .cb-cube{flex:none;height:22px;min-width:24px;padding:0 6px;border-radius:5px;background:var(--c);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
      .cb-barrow{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
      .cb-acts{display:flex;gap:6px;flex:none}
      .cb-warn{color:#dc2626;font-weight:600}
      .cb-muted{color:#94a3b8}
      #cb-shops{padding:10px 14px;border-top:1px solid #f1f5f9;display:none}
      #cb-shops input[type=text]{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;font-size:13px}
      .cb-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow:auto}
      .cb-chip{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;color:#475569}
      .cb-chip.on{background:#0f172a;color:#fff;border-color:#0f172a}
      .cb-shops-act{display:flex;gap:6px;margin-top:8px}
      #cb-opt .cb-row{cursor:pointer}
      #cb-opt .cb-row:hover{background:#f8fafc}
      #cb-opt .cb-row.on{background:var(--t)}
      #cb-opt .cb-row.cb-done{cursor:default;opacity:.6;background:#f8fafc}
      .cb-optbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 12px 0;padding:8px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;color:#334155;font-size:12px}
      .cb-optbar input{width:54px;padding:4px 6px;margin:0 4px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;font-weight:700;text-align:center}
      .cb-sku{display:inline-block;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:top;background:#f1f5f9;border-radius:5px;padding:2px 7px;margin:0 4px 4px 0;font-size:12px;line-height:1.45}
      .cb-sku b{font-weight:700;color:#0f172a}
      .cb-sel{max-width:210px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-weight:600;background:#fff;color:#0f172a}
      .cb-lime{background:#a3e635;color:#1a2e05}
      .cb-snz{background:#ede9fe;color:#6d28d9}
      .cb-isobar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 12px 0;font-size:12px}
      .cb-isobar .cb-sp{flex:1}
      .cb-isocount{margin:12px 12px 0;font-size:13px;color:#334155}
      .cb-isorow .cb-items a{color:inherit;text-decoration:none}
      .cb-isorow .cb-items a:hover{text-decoration:underline}
      .cb-isorow a.cb-go{text-decoration:none}
      .cb-topbtns{flex:none;align-items:center}
      .cb-topbtns .cb-btn{white-space:nowrap}
      .cb-topbtns .cb-sel{max-width:150px;padding:5px 6px}
      .cb-shopskus{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:12px;color:#334155}
      .cb-shopskus span{white-space:nowrap}
      .cb-shopskus i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:var(--c)}
      .cb-sum .cb-muted{font-size:11px;margin-top:2px}
      .cb-auto{margin:12px 12px 0;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
      .cb-auto.on{border-color:#86efac;box-shadow:0 0 0 3px #dcfce7}
      .cb-auto-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid #f1f5f9}
      .cb-auto-hd b{font-size:13px}
      .cb-auto-how{flex:1 1 200px;font-size:11px;line-height:1.35}
      .cb-auto-live{background:#16a34a;color:#fff;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:999px}
      .cb-btn.cb-auto-stop{background:#fee2e2;border-color:#fecaca;color:#b91c1c}
      .cb-auto-people{padding:6px 12px 8px;display:flex;flex-direction:column;gap:3px}
      .cb-auto-p{display:flex;align-items:center;gap:8px;font-size:12px;min-height:24px}
      .cb-auto-p b{flex:none;min-width:120px;font-weight:600}
      .cb-auto-st{flex:1;color:#475569;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cb-auto-dot{width:8px;height:8px;border-radius:50%;flex:none;background:#cbd5e1}
      .cb-auto-dot.go{background:#16a34a}
      .cb-auto-dot.make{background:#2563eb;animation:cbpulse 1s infinite}
      .cb-auto-dot.wait{background:#f59e0b}
      .cb-auto-dot.bad{background:#dc2626}
      @keyframes cbpulse{50%{opacity:.3}}
      .cb-auto-x{background:none;border:0;color:#94a3b8;cursor:pointer;font-size:12px;padding:2px 4px}
      .cb-auto-x:hover{color:#dc2626}
      .cb-auto-skip{background:none;border:0;color:#64748b;cursor:pointer;font-size:11px;text-decoration:underline;padding:2px 4px;white-space:nowrap;flex:none}
      .cb-auto-skip:hover{color:#0f172a}
      .cb-auto-add{margin-top:3px}
      .cb-auto-note{padding:0 12px 8px;font-size:12px}
      .cb-auto-log{padding:6px 12px 8px;border-top:1px solid #f1f5f9;background:#f8fafc;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#334155;max-height:96px;overflow:auto}
      .cb-tab.cb-autotab::after{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a;margin-left:6px;vertical-align:1px}
      #cb-autopill{position:fixed;right:16px;bottom:96px;z-index:99998;display:flex;align-items:center;gap:8px;max-width:min(440px,calc(100vw - 32px));padding:7px 13px;border-radius:999px;
        background:#0f172a;color:#fff;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;box-sizing:border-box}
      #cb-autopill i{width:8px;height:8px;border-radius:50%;background:#22c55e;flex:none;animation:cbpulse 2s infinite}
      #cb-autopill.bad i{background:#ef4444;animation:none}
      #cb-autopill.other i{background:#f59e0b;animation:none}
      #cb-autopill b{white-space:nowrap}
      #cb-autopill span{white-space:nowrap;color:#cbd5e1}
      #cb-autopill small{color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}`;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'cb-overlay';
    overlay.innerHTML = `
      <div id="cb-panel">
        <div class="cb-head">
          <div class="cb-top">
            <div><b>Batches</b><div id="cb-status">-</div></div>
            <div class="cb-topbtns"><select class="cb-sel cb-snzsel" title="Snoozed picklists">${Object.entries(SNZ_MODES).map(([k, l]) => `<option value="${k}"${k === snoozeMode ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="cb-btn cb-shopbtn">Shops (0)</button><button class="cb-btn cb-scan">Scan</button><button class="cb-btn cb-x">✕</button></div>
          </div>
          <div id="cb-shops">
            <input type="text" placeholder="Search shop…">
            <div class="cb-chips"></div>
            <div class="cb-shops-act"><button class="cb-btn cb-all">All</button><button class="cb-btn cb-none">None</button></div>
          </div>
          <div class="cb-tabs"><button class="cb-tab on" data-tab="single">Per combo</button><button class="cb-tab" data-tab="grouped">Grouped batch</button><button class="cb-tab" data-tab="opt">Optimized batches</button><button class="cb-tab" data-tab="iso">Isolated</button></div>
          <div class="cb-log"></div>
        </div>
        <div class="cb-body">
          <div id="cb-single"></div>
          <div id="cb-grouped" style="display:none"></div>
          <div id="cb-auto" style="display:none"></div>
          <div id="cb-opt" style="display:none"></div>
          <div id="cb-iso" style="display:none"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // auto batch on in this tab -> small pill bottom right while the popup is closed
    const pill = document.createElement('div');
    pill.id = 'cb-autopill';
    pill.style.display = 'none';
    pill.title = 'Auto batch is on in this tab · click to open';
    document.body.appendChild(pill);

    const panel = overlay.querySelector('#cb-panel');
    const $status = panel.querySelector('#cb-status');
    const $single = panel.querySelector('#cb-single');
    const $grouped = panel.querySelector('#cb-grouped');
    const $opt = panel.querySelector('#cb-opt');
    const $auto = panel.querySelector('#cb-auto');
    const $iso = panel.querySelector('#cb-iso');
    const $shops = panel.querySelector('#cb-shops');
    const $chips = panel.querySelector('.cb-chips');
    const $search = $shops.querySelector('input');
    const $shopBtn = panel.querySelector('.cb-shopbtn');
    const $scanBtn = panel.querySelector('.cb-scan');
    const $log = panel.querySelector('.cb-log');
    const $snz = panel.querySelector('.cb-snzsel');

    let lastGroups = null;      // all combos of the last scan
    let shopOrder = [];         // shop ids, order of the cards
    let orderByShop = new Map(); // shop id -> combo ids in grouped order
    const colorOf = new Map();
    let busy = false;
    let tab = 'single';
    // isolated tab
    let isoData = null, isoBusy = false, isoAt = 0, isoErr = '', isoProg = '';
    let warehouses = null;
    const isoColor = new Map();

    // optimized tab
    let optMax = Math.min(200, Math.max(2, +store.get('cb_opt_max', BATCH_MAX) || BATCH_MAX));
    // BE pick-up in the optimized batches (and auto batch): mix = BE + the rest, no = without BE, only = BE only
    let beMode = ['mix', 'no', 'only'].includes(store.get('cb_opt_be', 'mix')) ? store.get('cb_opt_be', 'mix') : 'mix';
    let optGroups = [];          // per shop + warehouse: { key, shop, warehouse, batches, done, stale }
    let optReady = false, optJob = null, oid = 0;
    const taken = new Set();     // picklists this popup already put in a batch
    let users = null, usersErr = '', usersJob = null;
    let assignee = String(store.get('cb_assign', '') || '');

    // auto batch (optimized tab): on per browser tab, 1 tab per PC does the work
    const AUTO_POLL_MS = 30000;   // look at the watched people every 30 s
    const AUTO_GAP_MS = 60000;    // never 2 batches for 1 person within a minute
    const AUTO_PER_HOUR = 12;     // safety cap per person
    const AUTO_FRESH_MS = 15000;  // picklists older than this get fetched again before a batch is made
    const AUTO_IDLE_MS = 120000;  // nothing to batch: look again after 2 min
    const AUTO_RECHECK_MS = 300000; // a fully picked batch: read it again at least every 5 min
    const AUTO_LOCK = 'cb_auto_lock', AUTO_OFF = 'cb_auto_off';
    const AUTO_TAB = Math.random().toString(36).slice(2);
    const ss = {
      get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
      set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    };
    const ls = {
      get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
      del(k) { try { localStorage.removeItem(k); } catch (_) {} },
    };
    const AUTO_TOP = (() => { try { return window.top === window.self; } catch (_) { return false; } })(); // never inside an iframe
    let autoOnAt = +ss.get('cb_auto_on', 0) || 0;
    let autoOn = AUTO_TOP && autoOnAt > 0;
    let autoUsers = (store.get('cb_auto_users', []) || []).map(String);
    const autoSkip = new Set((store.get('cb_auto_skip', []) || []).map(String)); // batches "counted as done" by hand (stuck ones)
    let autoWh = String(store.get('cb_auto_wh', '') || '');
    let autoLog = ss.get('cb_auto_log', []) || [];
    const autoState = new Map();  // person -> what they are doing now
    const autoHalt = new Map();   // person -> why auto stopped for them
    const autoSeen = new Map();   // batch id -> last progress read
    const autoOnce = new Set();   // messages that go in the log once
    let autoRunning = false, autoOther = false, autoErr = '', autoStop = '', autoPl = null, autoIdleUntil = 0, autoIdleTxt = '', whTried = false;

    const log = (msg) => { $log.style.display = 'block'; $log.textContent += msg + '\n'; $log.scrollTop = $log.scrollHeight; };
    const clearLog = () => { $log.textContent = ''; $log.style.display = 'none'; };
    const orderedGroups = (shop) => (orderByShop.get(shop) || []).map((id) => byId.get(id)).filter((g) => g && !g.used);

    const isOpen = () => overlay.style.display === 'flex';
    async function open() {
      overlay.style.display = 'flex';
      renderPill();
      try { await loadShops(); } catch (e) { $status.textContent = 'Could not load shops: ' + e.message; }
      renderChips();
      if (tab === 'iso' && !isoBusy && (!isoData || Date.now() - isoAt > 5 * 60000)) isoCheck();
      if (tab === 'opt') renderAuto();
      if (!selectedShops.size) { $shops.style.display = 'block'; $status.textContent = 'Pick shops, then Scan'; }
      else if (!lastGroups) scan();
    }
    const close = () => { overlay.style.display = 'none'; renderPill(); };
    pill.onclick = () => { open(); showTab('opt'); };

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') { e.preventDefault(); e.stopPropagation(); isOpen() ? close() : open(); }
      else if (e.key === 'Escape' && isOpen()) close();
    }, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    panel.querySelector('.cb-x').onclick = close;
    $scanBtn.onclick = () => { $shops.style.display = 'none'; scan(); };
    $snz.onchange = () => {
      if (busy) { $snz.value = snoozeMode; return; }
      snoozeMode = SNZ_MODES[$snz.value] ? $snz.value : 'out';
      store.set('cb_snoozed', snoozeMode);
      if (selectedShops.size) scan();
    };
    $shopBtn.onclick = () => ($shops.style.display = $shops.style.display === 'block' ? 'none' : 'block');
    $search.oninput = renderChips;
    panel.querySelector('.cb-all').onclick = () => { visibleShops().forEach((s) => selectedShops.add(s.idfulfilment_customer)); saveShops(); renderChips(); };
    panel.querySelector('.cb-none').onclick = () => { selectedShops.clear(); saveShops(); renderChips(); };
    function showTab(name) {
      tab = ['single', 'grouped', 'opt', 'iso'].includes(name) ? name : 'single';
      panel.querySelectorAll('.cb-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
      $single.style.display = tab === 'single' ? '' : 'none';
      $grouped.style.display = tab === 'grouped' ? '' : 'none';
      $opt.style.display = tab === 'opt' ? '' : 'none';
      $auto.style.display = tab === 'opt' ? '' : 'none';
      $iso.style.display = tab === 'iso' ? '' : 'none';
      $snz.style.display = tab === 'iso' ? 'none' : ''; // the isolated check always takes only active picklists
      store.set('cb_tab', tab);
      renderAuto();
      if (tab === 'opt') renderOpt();
      if (tab === 'iso') { renderIso(); if (isOpen() && !isoBusy && (!isoData || Date.now() - isoAt > 5 * 60000)) isoCheck(); }
    }
    panel.querySelectorAll('.cb-tab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
    showTab(store.get('cb_tab', 'single'));

    function visibleShops() {
      const q = $search.value.trim().toLowerCase();
      return shops.filter((s) => !q || s.name.toLowerCase().includes(q));
    }
    function renderChips() {
      $shopBtn.textContent = `Shops (${selectedShops.size})`;
      $chips.innerHTML = '';
      for (const s of visibleShops()) {
        const c = document.createElement('button');
        c.className = 'cb-chip' + (selectedShops.has(s.idfulfilment_customer) ? ' on' : '');
        c.textContent = s.name;
        c.onclick = () => {
          const id = s.idfulfilment_customer;
          selectedShops.has(id) ? selectedShops.delete(id) : selectedShops.add(id);
          saveShops(); renderChips();
        };
        $chips.appendChild(c);
      }
    }

    // ---------- scan ----------
    async function scan() {
      if (busy) return;
      $single.innerHTML = '';
      $grouped.innerHTML = '';
      $opt.innerHTML = '';
      clearLog();
      lastGroups = null;
      shopOrder = [];
      orderByShop = new Map();
      bestCache.clear();
      multis = [];
      optGroups = [];
      optReady = false;
      taken.clear();
      autoPl = null; // auto fetches fresh too
      if (!selectedShops.size) { $status.textContent = 'No shops selected'; $shops.style.display = 'block'; return; }
      busy = true;
      $scanBtn.disabled = true;
      $snz.disabled = true;
      try {
        const ids = [...selectedShops];
        const counts = new Map();
        const all = [];
        const sts = statusesFor(snoozeMode);
        allowedStatus = new Set(sts);
        const prog = () => { let n = 0; counts.forEach((v) => (n += v)); $status.textContent = `Loading ${ids.length} shop${ids.length === 1 ? '' : 's'} · ${n} picklists…`; };
        prog();
        await pool(ids, 3, async (id) => {
          for (const st of sts) {
            const list = await paginate(`/picklists?idfulfilment_customer=${id}&status=${st}`, (n) => { counts.set(`${id}|${st}`, n); prog(); });
            all.push(...list);
          }
        });

        lastGroups = group(all);
        colorOf.clear();
        [...selectedShops].sort((a, b) => shopName(a).localeCompare(shopName(b))).forEach((s, i) => colorOf.set(s, PALETTE[i % PALETTE.length]));
        const totals = new Map();
        lastGroups.forEach((g) => totals.set(g.shop, (totals.get(g.shop) || 0) + g.picklists.length));
        shopOrder = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
        for (const shop of shopOrder) orderByShop.set(shop, optimize(lastGroups.filter((g) => g.shop === shop)).map((g) => g.id));

        const nSnz = snzCount(all);
        $status.textContent = `${all.length} picklists · ${lastGroups.length} combos · ${skippedSingles} singles skipped` +
          `${skippedParked ? ` · ${skippedParked} parked skipped` : ''} · ${selectedShops.size} shop${selectedShops.size === 1 ? '' : 's'}` +
          (snoozeMode === 'only' ? ' · only snoozed' : snoozeMode === 'with' ? ` · ${nSnz} snoozed in` : '');
      } catch (e) {
        $status.textContent = 'Error: ' + e.message;
      } finally {
        busy = false;
        $scanBtn.disabled = false;
        $snz.disabled = false;
        renderSingles();
        renderGrouped();
        renderOpt();
      }
    }

    // snoozed picklists are hidden in Picqer: wake them up first, then they go in the batch like the rest
    async function wakeUp(pls, onStep) {
      const sn = pls.filter(isSnoozed);
      if (!sn.length) return 0;
      let ok = 0, k = 0;
      await pool(sn, 3, async (pl) => {
        try { await apiRetry('POST', `/picklists/${pl.idpicklist}/snooze`, { snooze_until: null }, { retry5xx: true }); pl.status = 'new'; ok++; }
        catch (e) { log(`✗ unsnooze ${pl.picklistid || pl.idpicklist}: ${String(e.message).slice(0, 100)}`); }
        if (onStep) onStep(++k, sn.length);
      });
      log(`${ok}/${sn.length} snoozed picklist${sn.length === 1 ? '' : 's'} unsnoozed`);
      return sn.length;
    }
    const snzNote = (n) => (n ? `\n${n} snoozed picklist${n === 1 ? '' : 's'} get${n === 1 ? 's' : ''} unsnoozed first` : '');

    const itemsHtml = (g) => g.items.map((i) => `<div>${i.amount}× ${esc(i.name)} <small>${esc(i.code)}</small></div>`).join('');

    function card(shop, meta, controls, body) {
      const c = colorOf.get(shop) || '#64748b';
      return `<section class="cb-card" style="--c:${c};--t:${c}14">
        <header class="cb-card-hd">${controls.left || ''}<span class="cb-dot"></span><b>${esc(shopName(shop))}</b><small>${meta}</small><span class="cb-sp"></span>${controls.right || ''}</header>
        ${body}</section>`;
    }

    // ---------- tab 4: isolated = open picklist with a picking container linked, but not in a batch ----------
    // 1) all open picklists (status "new" = active, snoozed / paused / closed left out)
    // 2) the ones in a batch are fine, skip them
    // 3) only for the rest: ask Picqer if a container is linked to that picklist
    const ageOf = (s) => {
      const t = s ? new Date(String(s).replace(' ', 'T')).getTime() : NaN;
      if (!isFinite(t)) return '';
      const m = Math.max(0, Math.round((Date.now() - t) / 60000));
      return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
    };
    const boxName = (c) => { const n = String(c.name == null ? c.idpicking_container : c.name).trim(); return /^container/i.test(n) ? n : `Container ${n}`; };
    let isoStop = false;
    // pages of 100, 4 at a time
    async function pagesFast(path, onPage) {
      const out = [];
      const seen = new Set();
      const sep = path.includes('?') ? '&' : '?';
      for (let off = 0, done = false; !done && off < 200000; off += 4 * PAGE) {
        const pages = await Promise.all([0, 1, 2, 3].map((i) => apiRetry('GET', `${path}${sep}offset=${off + i * PAGE}`, null, { retry5xx: true }).then((p) => p || [])));
        for (const p of pages) {
          for (const x of p) { const k = String(x.idpicklist); if (!seen.has(k)) { seen.add(k); out.push(x); } }
          if (p.length < PAGE) done = true;
        }
        if (onPage) onPage(out.length);
        if (isoStop) break;
      }
      return out;
    }
    async function isoCheck() {
      if (isoBusy) return;
      isoBusy = true;
      isoStop = false;
      isoErr = '';
      const setProg = (t) => { isoProg = t; const el = $iso.querySelector('.cb-iso-prog'); if (el) el.textContent = t; };
      setProg('open picklists…');
      renderIso();
      try {
        await loadWarehouses();
        const wid = autoWhId(); // same warehouse as auto batch (Bunsenstraat), empty = all
        loadUsers().catch(() => {});
        const open = (await pagesFast('/picklists?status=new', (n) => setProg(`open picklists ${n}…`)))
          .filter((pl) => pl.status === 'new' && (!wid || String(pl.idwarehouse) === String(wid)));
        const free = open.filter((pl) => !pl.idpicklist_batch);
        const inBatch = open.length - free.length;
        const list = [];
        let k = 0, bad = 0, badMsg = '';
        setProg(`${open.length} open · ${inBatch} in a batch · containers 0/${free.length}…`);
        await pool(free, 3, async (pl) => {
          if (isoStop) return;
          try {
            const r = await apiRetry('GET', `/picking-containers?idpicklist=${pl.idpicklist}`, null, { retry5xx: true });
            const boxes = (Array.isArray(r) ? r : r ? [r] : []).filter((c) => c && String(c.idpicklist) === String(pl.idpicklist));
            if (boxes.length) list.push({ pl, boxes });
          } catch (e) { bad++; badMsg = e.message || String(e); }
          setProg(`${open.length} open · ${inBatch} in a batch · containers ${++k}/${free.length}…`);
        });
        list.sort((a, b) => String(a.pl.created || '').localeCompare(String(b.pl.created || '')));
        [...new Set(list.map((x) => x.pl.idfulfilment_customer))].sort((a, b) => shopName(a).localeCompare(shopName(b)))
          .forEach((s, i) => isoColor.set(s, colorOf.get(s) || PALETTE[i % PALETTE.length]));
        isoData = { list, nOpen: open.length, nInBatch: inBatch, nChecked: k, nFree: free.length, stopped: isoStop, wh: wid ? whNameOf(wid) : '' };
        isoAt = Date.now();
        if (bad) isoErr = `${bad} picklist${bad === 1 ? '' : 's'} could not be checked (${badMsg})`;
      } catch (e) {
        isoErr = e.message || String(e);
      } finally {
        isoBusy = false;
        renderIso();
      }
    }
    function renderIso() {
      if (tab !== 'iso') return;
      const hm = (t) => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const whName = (id) => ((warehouses || []).find((w) => w.idwarehouse === id) || {}).name || '';
      const userName = (id) => ((users || []).find((u) => u.id === String(id)) || {}).name || `#${id}`;
      const list = isoData ? isoData.list : [];
      const multiWh = new Set(list.map((x) => x.pl.idwarehouse)).size > 1;
      const info = isoBusy ? `<span class="cb-iso-prog">${esc(isoProg)}</span>`
        : isoData ? `checked ${hm(isoAt)}${isoData.wh ? ` · only ${isoData.wh}` : ''} · ${isoData.nOpen} open picklists · ${isoData.nInBatch} in a batch · ${isoData.nChecked}${isoData.stopped ? ` of ${isoData.nFree}` : ''} without a batch checked for a container${isoData.stopped ? ' · stopped' : ''}`
        : 'Open picklists (not snoozed or paused) that have a container but are not in a batch';
      let html = `<div class="cb-isobar">${isoBusy ? '<button class="cb-btn" data-act="isostop">Stop</button>' : `<button class="cb-btn" data-act="isocheck">${isoData ? 'Check again' : 'Check'}</button>`}
        <span class="cb-muted">${info}</span><span class="cb-sp"></span>${list.length && !isoBusy ? '<button class="cb-btn" data-act="isocopy">Copy list</button>' : ''}</div>`;
      if (isoErr && !isoBusy) html += `<div class="cb-isocount cb-warn">⚠ ${esc(isoErr)}</div>`;
      if (isoData && !isoBusy) {
        if (!list.length) html += `<div class="cb-empty">No isolated picklists${isoData.stopped ? ' so far' : ''}. Every open picklist with a container is in a batch</div>`;
        else {
          html += `<div class="cb-isocount"><b>${list.length}</b> isolated picklist${list.length === 1 ? '' : 's'} · oldest first</div>`;
          const shopsIn = [...new Set(list.map((x) => x.pl.idfulfilment_customer))].sort((a, b) => shopName(a).localeCompare(shopName(b)));
          html += shopsIn.map((shop) => {
            const rows = list.filter((x) => x.pl.idfulfilment_customer === shop);
            const c = isoColor.get(shop) || '#64748b';
            return `<section class="cb-card" style="--c:${c};--t:${c}14"><header class="cb-card-hd"><span class="cb-dot"></span><b>${esc(shopName(shop))}</b><small>${rows.length} isolated</small></header>
              ${rows.map(({ pl, boxes }) => {
                const units = (pl.products || []).reduce((n, p) => n + (+p.amount || 0), 0) || +pl.totalproducts || 0;
                return `<div class="cb-row cb-isorow">
                  <div class="cb-items"><div><a href="/picklists/${pl.idpicklist}" target="_blank"><b>${esc(pl.picklistid || pl.idpicklist)}</b></a> · <b>${esc(boxes.map(boxName).join(', '))}</b></div>
                  <small>${units ? `${units} unit${units === 1 ? '' : 's'} · ` : ''}${pl.created ? `made ${ageOf(pl.created)} ago` : ''}${pl.assigned_to_iduser ? ` · assigned to ${esc(userName(pl.assigned_to_iduser))}` : ''}${multiWh && whName(pl.idwarehouse) ? ` · ${esc(whName(pl.idwarehouse))}` : ''}</small></div>
                  ${hlBadge(hasHlTag(pl) ? 1 : 0)}
                  <a class="cb-go" href="/picklists/${pl.idpicklist}" target="_blank">Open</a>
                </div>`;
              }).join('')}</section>`;
          }).join('');
        }
      }
      $iso.innerHTML = html;
    }
    $iso.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      if (el.dataset.act === 'isocheck') isoCheck();
      else if (el.dataset.act === 'isostop') { isoStop = true; el.textContent = 'Stopping…'; el.disabled = true; }
      else if (el.dataset.act === 'isocopy' && isoData) {
        const txt = isoData.list.map(({ pl, boxes }) => `${pl.picklistid || pl.idpicklist}\t${boxes.map(boxName).join(', ')}\t${shopName(pl.idfulfilment_customer)}`).join('\n');
        try { await navigator.clipboard.writeText(txt); el.textContent = 'Copied ✓'; } catch (_) { el.textContent = 'Copy failed'; }
      }
    });

    // ---------- tab 1: one batch per combo ----------
    function renderSingles() {
      if (!lastGroups) return;
      if (!lastGroups.length) { $single.innerHTML = '<div class="cb-empty">No matching combos</div>'; return; }
      $single.innerHTML = shopOrder.map((shop) => {
        const list = lastGroups.filter((g) => g.shop === shop).sort((a, b) => b.picklists.length - a.picklists.length);
        const n = list.reduce((s, g) => s + g.picklists.length, 0);
        return card(shop, `${list.length} combos · ${n} picklists`, {}, list.map((g) => {
          const be = g.used ? 0 : hlCount(g.picklists);
          return `
          <div class="cb-row${be ? ' cb-be' : ''}">
            <div class="cb-count">${g.picklists.length}x</div>
            <div class="cb-items">${itemsHtml(g)}</div>
            ${hlBadge(be)}
            ${snzBadge(g.used ? 0 : snzCount(g.picklists))}
            <button class="cb-go" data-act="one" data-g="${g.id}" ${g.used ? 'disabled' : ''}>${g.used ? esc(g.usedLabel || 'Done') : 'Create batch'}</button>
          </div>`;
        }).join(''));
      }).join('');
    }

    $single.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="one"]');
      if (b && !b.disabled) createOne(byId.get(b.dataset.g), b);
    });

    async function createOne(g, btn) {
      if (busy || !g) return;
      if (!confirm(`Create batch with ${g.picklists.length} picklists?${snzNote(snzCount(g.picklists))}`)) return;
      busy = true;
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        await wakeUp(g.picklists, (k, n) => { btn.textContent = `Unsnoozing ${k}/${n}…`; });
        btn.textContent = 'Creating…';
        const be = g.picklists.filter(hasHlTag);
        const ids = g.picklists.filter((p) => !hasHlTag(p)).concat(be).map((p) => p.idpicklist);
        const { batch: res, failed } = await createBatchBeLast(ids, new Set(be.map((p) => p.idpicklist)));
        g.used = true;
        g.usedLabel = `Batch ${res.picklist_batchid}`;
        markTaken(ids.filter((id) => !failed.includes(id)));
        if (failed.length) log(`⚠ Batch ${res.picklist_batchid}: ${failed.length} picklist${failed.length === 1 ? '' : 's'} could not go in (not open anymore?)`);
        log(`✓ Batch ${res.picklist_batchid} · ${ids.length - failed.length} picklists · ${comboLabel(g.items)}${be.length ? ` · ${be.length} ${HL_LABEL} last` : ''}`);
      } catch (e) {
        alert('Failed: ' + e.message);
      } finally {
        busy = false;
        renderSingles();
        renderGrouped();
        renderOpt();
      }
    }

    // ---------- tab 2: one grouped batch ----------
    function renderGrouped() {
      if (!lastGroups) return;
      const shopsLeft = shopOrder.filter((s) => orderedGroups(s).length);
      if (!shopsLeft.length) { $grouped.innerHTML = `<div class="cb-empty">${lastGroups.length ? 'Nothing left to group' : 'No matching combos'}</div>`; return; }
      let html = '';
      shopsLeft.forEach((shop, si) => {
        const list = orderedGroups(shop);
        const nSel = list.filter((g) => g.checked).length;
        const n = list.reduce((s, g) => s + g.picklists.length, 0);
        const hasRanks = FLYER_ORDER.length > 0 && list.some((g) => flyerRank(g) < FLYER_ORDER.length);
        let lastSel = null, lastRow = null, lastRank = null;
        const rows = list.map((g, idx) => {
          let sub = '';
          if (hasRanks) {
            const r = flyerRank(g);
            if (r !== lastRank) { sub = `<div class="cb-sub">${esc(r < FLYER_ORDER.length ? FLYER_ORDER[r] : 'other')}</div>`; lastRank = r; }
          }
          const ref = g.checked ? lastSel : lastRow;
          const d = ref ? diff(ref, g) : null;
          const badge = d == null
            ? '<span class="cb-delta cb-ds">start</span>'
            : `<span class="cb-delta ${d <= 1 ? 'cb-dg' : d <= 3 ? 'cb-da' : 'cb-dr'}" title="${d} product${d === 1 ? '' : 's'} change vs the ${g.checked ? 'previous selected' : 'previous'} combo">${d} change${d === 1 ? '' : 's'}</span>`;
          if (g.checked) lastSel = g;
          lastRow = g;
          const be = hlCount(g.picklists);
          return `${sub}<div class="cb-row${g.checked ? ' on' : ''}${be ? ' cb-be' : ''}" data-g="${g.id}">
            <input type="checkbox" class="cb-chk" data-act="chk" ${g.checked ? 'checked' : ''}>
            <div class="cb-count">${g.picklists.length}x</div>
            <div class="cb-items">${itemsHtml(g)}</div>
            ${hlBadge(be)}
            ${snzBadge(snzCount(g.picklists))}
            ${badge}
            <div class="cb-ord"><button data-act="up" ${idx === 0 ? 'disabled' : ''}>▲</button><button data-act="down" ${idx === list.length - 1 ? 'disabled' : ''}>▼</button></div>
          </div>`;
        }).join('');
        const left = `<input type="checkbox" class="cb-chk" data-act="shopchk" data-shop="${shop}" title="Select whole shop" ${nSel && nSel === list.length ? 'checked' : ''} data-ind="${nSel > 0 && nSel < list.length ? 1 : 0}">`;
        const right = `<div class="cb-ord"><button data-act="sup" data-shop="${shop}" ${si === 0 ? 'disabled' : ''}>▲</button><button data-act="sdown" data-shop="${shop}" ${si === shopsLeft.length - 1 ? 'disabled' : ''}>▼</button></div>`;
        const sel = list.filter((g) => g.checked);
        html += card(shop, `${list.length} combos · ${n} picklists · ${skuCount(list)} SKUs${nSel ? ` · <b>${nSel} selected · ${skuCount(sel)} SKUs</b>` : ''}`, { left, right }, rows);
      });
      html += `<div class="cb-bar">
        <div class="cb-strip"></div>
        <div class="cb-barrow"><div class="cb-sum"></div>
          <div class="cb-acts"><button class="cb-btn" data-act="opt">Optimize order</button><button class="cb-go" data-act="create">Create grouped batch</button></div></div>
      </div>`;
      $grouped.innerHTML = html;
      $grouped.querySelectorAll('[data-ind="1"]').forEach((el) => (el.indeterminate = true));
      refreshFooter();
    }

    // selected combos -> per shop (in batch order): how many different products
    function shopSkus(seq) {
      const out = [];
      for (const g of seq) {
        let x = out.find((o) => o.shop === g.shop);
        if (!x) out.push((x = { shop: g.shop, gs: [] }));
        x.gs.push(g);
      }
      return out.map((x) => ({ shop: x.shop, skus: skuCount(x.gs) }));
    }

    function selectedSeq() {
      const out = [];
      for (const shop of shopOrder) for (const g of orderedGroups(shop)) if (g.checked) out.push(g);
      return out;
    }

    function refreshFooter() {
      const $sum = $grouped.querySelector('.cb-sum');
      if (!$sum) return;
      const $strip = $grouped.querySelector('.cb-strip');
      const go = $grouped.querySelector('[data-act="create"]');
      const opt = $grouped.querySelector('[data-act="opt"]');
      const seq = selectedSeq();
      const n = seq.reduce((s, g) => s + g.picklists.length, 0);
      const changes = seqChanges(seq);
      const nShops = new Set(seq.map((g) => g.shop)).size;
      const wh = new Set(seq.map((g) => g.warehouse)).size;
      const nBe = seq.reduce((s, g) => s + hlCount(g.picklists), 0);
      const nSnz = seq.reduce((s, g) => s + snzCount(g.picklists), 0);
      const perShop = shopSkus(seq);
      $sum.innerHTML = seq.length
        ? `<b>${n}</b> picklists · ${seq.length} combos${nShops > 1 ? ` · ${nShops} shops` : ''} · <b>${changes}</b> product change${changes === 1 ? '' : 's'}` +
          `${nBe ? ` · ${nBe} ${esc(HL_LABEL)} last per combo` : ''}${nSnz ? ` · ${nSnz} snoozed` : ''}${wh > 1 ? ' · <span class="cb-warn">mixed warehouses</span>' : ''}` +
          `<div class="cb-shopskus">${perShop.map((x) => `<span style="--c:${colorOf.get(x.shop) || '#64748b'}"><i></i>${esc(shopName(x.shop))} <b>${x.skus}</b> SKU${x.skus === 1 ? '' : 's'}</span>`).join('')}` +
          `${perShop.length > 1 ? `<span class="cb-muted">${skuCount(seq)} SKUs total</span>` : ''}</div>`
        : '<span class="cb-muted">Tick combos or a whole shop</span>';
      $strip.innerHTML = seq.map((g, i) => `<span class="cb-cube" style="--c:${colorOf.get(g.shop) || '#64748b'}${i && seq[i - 1].shop !== g.shop ? ';margin-left:10px' : ''}" title="${esc(shopName(g.shop))} · ${esc(comboLabel(g.items))}">${g.picklists.length}</span>`).join('');
      $strip.style.display = seq.length ? '' : 'none';
      let best = 0;
      for (const shop of shopOrder) {
        const sel = orderedGroups(shop).filter((g) => g.checked);
        if (sel.length > 1) best += bestChanges(sel);
      }
      const save = changes - best;
      opt.textContent = save > 0 ? `Optimize · −${save} change${save === 1 ? '' : 's'}` : 'Optimize order';
      opt.classList.toggle('hot', save > 0);
      go.disabled = busy || !seq.length || wh > 1;
    }

    function optimizeAll() {
      for (const shop of shopOrder) {
        const list = orderedGroups(shop);
        const sel = list.filter((g) => g.checked), rest = list.filter((g) => !g.checked);
        const ordered = sel.length ? optimize(sel).concat(optimize(rest)) : optimize(list);
        orderByShop.set(shop, ordered.map((g) => g.id));
      }
    }

    $grouped.addEventListener('click', (e) => {
      if (busy) return;
      const el = e.target.closest('[data-act]');
      const row = e.target.closest('.cb-row');
      const g = row && byId.get(row.dataset.g);
      if (!el) { if (g) { g.checked = !g.checked; renderGrouped(); } return; }
      if (el.disabled) return;
      const act = el.dataset.act;
      if (act === 'chk' && g) { g.checked = el.checked; renderGrouped(); }
      else if (act === 'shopchk') { const shop = Number(el.dataset.shop); orderedGroups(shop).forEach((x) => (x.checked = el.checked)); renderGrouped(); }
      else if ((act === 'up' || act === 'down') && g) {
        const ids = orderedGroups(g.shop).map((x) => x.id);
        const i = ids.indexOf(g.id), j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        orderByShop.set(g.shop, ids);
        renderGrouped();
      } else if (act === 'sup' || act === 'sdown') {
        const shop = Number(el.dataset.shop);
        const vis = shopOrder.filter((s) => orderedGroups(s).length);
        const i = vis.indexOf(shop), j = act === 'sup' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= vis.length) return;
        [vis[i], vis[j]] = [vis[j], vis[i]];
        shopOrder = vis.concat(shopOrder.filter((s) => !vis.includes(s)));
        renderGrouped();
      } else if (act === 'opt') { optimizeAll(); renderGrouped(); }
      else if (act === 'create') createGrouped(selectedSeq(), el);
    });

    async function createGrouped(seq, go) {
      if (busy || !seq.length) return;
      const total = seq.reduce((s, g) => s + g.picklists.length, 0);
      const nShops = new Set(seq.map((g) => g.shop)).size;
      // letter order: combo after combo, inside each combo the BE pick-up picklists last
      const plan = seq.flatMap((g) => g.picklists.filter((p) => !hasHlTag(p)).concat(g.picklists.filter(hasHlTag)));
      const nBe = plan.filter(hasHlTag).length;
      const nSnz = snzCount(plan);
      if (!confirm(`Create 1 batch with ${total} picklists · ${seq.length} combos${nShops > 1 ? ` · ${nShops} shops` : ''}, in this order?` +
        `\nSKUs: ${shopSkus(seq).map((x) => `${shopName(x.shop)} ${x.skus}`).join(' · ')}` +
        `${nBe ? `\n${nBe} ${HL_LABEL} picklist${nBe === 1 ? '' : 's'} go last in their combo` : ''}${snzNote(nSnz)}`)) return;
      busy = true;
      $scanBtn.disabled = true;
      $grouped.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
      clearLog();
      const t0 = Date.now();
      const secs = () => Math.round((Date.now() - t0) / 1000);
      const comboOf = new Map();
      seq.forEach((g) => g.picklists.forEach((p) => comboOf.set(p.idpicklist, g)));
      const ref = (pid) => ((comboOf.get(pid) || { picklists: [] }).picklists.find((p) => p.idpicklist === pid) || {}).picklistid || pid;
      const runs = [];
      plan.forEach((p) => { const g = comboOf.get(p.idpicklist); if (runs[runs.length - 1] !== g) runs.push(g); });
      let batchId = null, batchNr = null;
      try {
        await wakeUp(plan, (k, n) => { go.textContent = `Unsnoozing ${k}/${n}…`; });
        go.textContent = 'Creating batch…';
        // first call: the first run of 1 combo all at once
        let first = 1;
        while (first < plan.length && comboOf.get(plan[first].idpicklist) === runs[0] && hasHlTag(plan[first]) === hasHlTag(plan[0])) first++;
        const batch = await apiRetry('POST', '/picklists/batches', { idpicklists: plan.slice(0, first).map((p) => p.idpicklist), type: 'normal' });
        batchId = batch.idpicklist_batch;
        batchNr = batch.picklist_batchid;
        let added = first;
        log(`Batch ${batchNr} created · ${added} picklists`);

        // the rest in the planned order -> slots (A, B, C...) follow it, BE pick-up gets the last ones.
        // ONE BY ONE on purpose: adding several at the same time makes Picqer
        // hand out the same slot letter twice (G, G, G, G) and auto-next skips them.
        const failed = [];
        for (let k = first; k < plan.length; k++) {
          const pid = plan[k].idpicklist;
          go.textContent = `Adding ${added}/${total}${hasHlTag(plan[k]) ? ` · ${HL_LABEL}` : ''} · ${secs()}s`;
          try { await apiRetry('POST', `/picklists/batches/${batchId}/picklists`, { idpicklist: pid }, { retry5xx: true }); }
          catch (e) { failed.push(pid); log(`✗ ${ref(pid)}: ${String(e.message).slice(0, 120)}`); }
          added++;
        }

        // read the real order back, then 1 comment per combo switch
        go.textContent = 'Checking order…';
        const fresh = await apiRetry('GET', `/picklists/batches/${batchId}`, null, { retry5xx: true });
        const order = [...((fresh && fresh.picklists) || [])].sort(aliasSort);
        const slotCount = new Map();
        order.forEach((p) => p.alias && slotCount.set(p.alias, (slotCount.get(p.alias) || 0) + 1));
        const dups = [...slotCount].filter(([, c]) => c > 1).map(([a]) => a);
        if (dups.length) log(`⚠ Same slot letter twice: ${dups.join(', ')} · auto-next 3.1 still goes through all of them`);

        const toMark = [];
        let prev = null;
        for (const p of order) {
          const g = comboOf.get(p.idpicklist);
          if (!g) continue;
          if (prev && g !== prev) toMark.push({ p, g, prev });
          prev = g;
        }
        const expected = Math.max(0, runs.length - 1); // switches in the plan (the BE tail can repeat a combo)
        if (toMark.length > expected) {
          log(`✗ Picqer mixed the combos (${toMark.length} switches instead of ${expected}). NO comments placed.`);
          log(`  Order: ${order.map((p) => p.alias || p.picklistid).join(' ')}`);
          alert(`Batch ${batchNr} made but Picqer did not keep the combo order.\nNo comments placed. Check the log.`);
        } else {
          let c = 0;
          go.textContent = `Comments 0/${toMark.length}…`;
          await pool(toMark, 4, async ({ p, g, prev: pg }) => {
            const body = g.shop !== pg.shop
              ? `${MARKER} SHOP: ${shopName(g.shop)} ; ${g.items.map((i) => `+ ${i.amount}x ${i.name}`).join(' ; ')}`
              : `${MARKER} ${comboDiff(pg.items, g.items)}`;
            try { await apiRetry('POST', `/picklists/${p.idpicklist}/comments`, { body }); }
            catch (e) { log(`✗ comment ${p.picklistid}: ${String(e.message).slice(0, 80)}`); }
            go.textContent = `Comments ${++c}/${toMark.length}…`;
          });
        }
        const inBatch = order.filter((p) => comboOf.has(p.idpicklist)).length;
        const beIds = new Set(plan.filter(hasHlTag).map((p) => p.idpicklist));
        // every combo: once a BE pick-up came, no normal one of that combo after it
        const beSeen = new Set();
        let lastOk = true;
        for (const p of order) {
          const g = comboOf.get(p.idpicklist);
          if (!g) continue;
          if (beIds.has(p.idpicklist)) beSeen.add(g); else if (beSeen.has(g)) lastOk = false;
        }
        log(`✓ Batch ${batchNr} · ${inBatch}/${total} picklists · ${toMark.length} switches · ${seqChanges(runs)} product changes` +
          `${nBe ? ` · ${nBe} ${HL_LABEL} ${lastOk ? 'last in their combo' : 'NOT all last in their combo, check the batch'}` : ''} · ${secs()}s${failed.length ? ` · ${failed.length} failed` : ''}`);
      } catch (e) {
        log('✗ ' + e.message);
        alert('Failed: ' + e.message);
      } finally {
        if (batchId) {
          seq.forEach((g) => { g.used = true; g.usedLabel = `In batch ${batchNr}`; });
          markTaken(seq.flatMap((g) => g.picklists.map((p) => p.idpicklist)));
        }
        busy = false;
        $scanBtn.disabled = false;
        renderSingles();
        renderGrouped();
        renderOpt();
      }
    }

    // picklists that went in a batch: out of the combos, and redo the optimized batches they were in
    function markTaken(ids) {
      ids.forEach((id) => taken.add(id));
      bestCache.clear();
      for (const g of lastGroups || []) {
        if (g.used) continue;
        const before = g.picklists.length;
        g.picklists = g.picklists.filter((p) => !taken.has(p.idpicklist));
        if (g.picklists.length < before && g.picklists.length < MIN_GROUP) { g.used = true; g.usedLabel = 'Already in a batch'; g.checked = false; }
      }
      for (const og of optGroups) if (og.batches.some((b) => b.ms.some((m) => taken.has(m.pl.idpicklist)))) og.stale = true;
    }

    // ---------- tab 3: optimized batches (fewest different products per batch) ----------
    const comboOfItems = (items) => items.map((i) => `${i.code}x${i.amount}`).join(',');

    // inside a batch (= letter order): flyer NL block, then DE, then the rest; in a block the
    // same combo together and the most alike combo next
    // BE pick-up picklists always last
    const isBeM = (m) => hasHlTag(m.pl);
    function orderPicks(list) {
      return orderRun(list.filter((m) => !isBeM(m))).concat(orderRun(list.filter(isBeM)));
    }
    function orderRun(list) {
      const byCombo = new Map();
      for (const m of list) {
        const k = comboOfItems(m.items);
        if (!byCombo.has(k)) byCombo.set(k, []);
        byCombo.get(k).push(m);
      }
      const blocks = new Map();
      for (const ms of byCombo.values()) {
        ms.sort((a, b) => a.pl.idpicklist - b.pl.idpicklist);
        const g = { ms, items: ms[0].items, amt: new Map(ms[0].items.map((i) => [i.code, i.amount])) };
        const r = flyerRank(g);
        if (!blocks.has(r)) blocks.set(r, []);
        blocks.get(r).push(g);
      }
      const out = [];
      let prev = null;
      for (const r of [...blocks.keys()].sort((a, b) => a - b)) {
        const rest = blocks.get(r).sort((a, b) => b.ms.length - a.ms.length);
        for (;;) {
          let bi = -1, bd = Infinity;
          if (prev) rest.forEach((g, i) => { const d = diff(prev, g); if (d < bd || (d === bd && g.ms.length > rest[bi].ms.length)) { bd = d; bi = i; } });
          else if (rest.length) bi = 0;
          if (bi < 0) break;
          prev = rest.splice(bi, 1)[0];
          out.push(...prev.ms);
        }
      }
      return out;
    }

    function makeBatch(og, members, keepOrder) {
      const ms = keepOrder ? members.slice() : orderPicks(members);
      const sku = new Map();
      for (const m of ms) for (const it of m.items) {
        const s = sku.get(it.code) || { code: it.code, name: it.name, qty: 0, n: 0 };
        s.qty += it.amount;
        s.n++;
        sku.set(it.code, s);
      }
      return {
        id: 'o' + (++oid), og, ms,
        skus: [...sku.values()].sort((a, b) => b.n - a.n || b.qty - a.qty || a.name.localeCompare(b.name)),
        combos: new Set(ms.map((m) => comboOfItems(m.items))).size,
        be: hlCount(ms.map((m) => m.pl)),
        snz: snzCount(ms.map((m) => m.pl)),
        checked: false, done: null,
      };
    }

    // what you get when you just batch by date (oldest first), to compare
    function stopsByDate(list, K) {
      const s = list.slice().sort((a, b) => a.pl.idpicklist - b.pl.idpicklist);
      let t = 0;
      for (let i = 0; i < s.length; i += K) {
        const u = new Set();
        for (const m of s.slice(i, i + K)) for (const it of m.items) u.add(it.code);
        t += u.size;
      }
      return t;
    }

    // picklists of 1 shop -> batches of max optMax, cleanest first (fewest products per picklist)
    function packInto(og, members) {
      const codeId = new Map();
      const sets = members.map((m) => m.items.map((it) => {
        if (!codeId.has(it.code)) codeId.set(it.code, codeId.size);
        return codeId.get(it.code);
      }));
      return packBatches(sets, optMax)
        .map((idx) => makeBatch(og, idx.map((i) => members[i])))
        .sort((a, b) => a.skus.length / a.ms.length - b.skus.length / b.ms.length || b.ms.length - a.ms.length);
    }

    function beOk(pl) { return !hasSkipTag(pl) && (beMode === 'mix' || (beMode === 'only') === hasHlTag(pl)); }
    const BE_LABEL = { mix: 'België included', no: 'België excluded', only: 'België only' };
    const beSelect = () => `<select class="cb-sel cb-bemode" title="BE pick-up picklists (Optimized tab + auto batch)">${Object.entries(BE_LABEL).map(([k, v]) => `<option value="${k}"${k === beMode ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    function setBe(v) {
      if (!BE_LABEL[v] || v === beMode) return;
      beMode = v;
      store.set('cb_opt_be', beMode);
      optGroups.forEach((g) => (g.stale = true));
      if (autoPl) autoPl.plan = null;
      if (autoOn) autoAddLog(BE_LABEL[beMode]);
      renderOpt();
      renderAuto();
    }
    function computeGroup(og) {
      const free = multis.filter((m) => m.pl.idfulfilment_customer === og.shop && m.pl.idwarehouse === og.warehouse && !taken.has(m.pl.idpicklist) && beOk(m.pl));
      og.batches = packInto(og, free);
      og.free = free.length;
      og.stale = false;
    }

    function ensureOpt() {
      if (optJob) return optJob;
      optJob = (async () => {
        if (!optReady) {
          const map = new Map();
          for (const m of multis) {
            const k = m.pl.idfulfilment_customer + '|' + m.pl.idwarehouse;
            if (!map.has(k)) map.set(k, { key: k, shop: m.pl.idfulfilment_customer, warehouse: m.pl.idwarehouse, batches: [], done: [], stale: true, free: 0 });
          }
          optGroups = [...map.values()];
          optReady = true;
        }
        // again until nothing is stale: a batch made meanwhile (auto) can make another shop stale
        for (let todo = optGroups.filter((g) => g.stale); todo.length; todo = optGroups.filter((g) => g.stale)) {
          for (let k = 0; k < todo.length; k++) {
            $opt.innerHTML = `<div class="cb-empty">Optimizing ${esc(shopName(todo[k].shop))}${todo.length > 1 ? ` (${k + 1}/${todo.length})` : ''}…</div>`;
            await sleep(30); // let the page paint
            computeGroup(todo[k]);
          }
        }
      })().finally(() => { optJob = null; });
      return optJob;
    }

    function loadUsers() {
      if (users) return Promise.resolve(users);
      if (!usersJob) {
        usersJob = (async () => {
          try {
            const list = await paginate('/users?active=true');
            users = list.filter((u) => u && u.active !== false).map((u) => ({
              id: String(u.iduser),
              name: [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.username || `#${u.iduser}`,
            })).sort((a, b) => a.name.localeCompare(b.name));
            usersErr = '';
          } catch (e) {
            usersErr = (e && e.message) || 'could not load';
          }
          usersJob = null;
          return users;
        })();
      }
      return usersJob;
    }

    function userName(id) {
      const u = (users || []).find((x) => x.id === String(id));
      return u ? u.name : `user #${id}`;
    }

    function assignOptions() {
      let o = `<option value="">${users ? 'Assign to nobody' : usersErr ? 'Assign to nobody (users not loaded)' : 'Loading users…'}</option>`;
      if (assignee && !(users || []).some((u) => u.id === assignee)) o += `<option value="${esc(assignee)}" selected>${esc(userName(assignee))}</option>`;
      for (const u of users || []) o += `<option value="${esc(u.id)}" ${u.id === assignee ? 'selected' : ''}>${esc(u.name)}</option>`;
      return o;
    }

    function optShown() {
      return optGroups.filter((g) => g.batches.length || g.done.length).sort((a, b) => b.free - a.free || shopName(a.shop).localeCompare(shopName(b.shop)));
    }
    function optSelected() {
      const out = [];
      for (const g of optShown()) for (const b of g.batches) if (b.checked) out.push(b);
      return out;
    }
    function findOpt(id) {
      for (const g of optGroups) for (const b of g.batches) if (b.id === id) return b;
      return null;
    }

    function skuBadge(n) {
      return `<span class="cb-delta ${n <= 4 ? 'cb-dg' : n <= 8 ? 'cb-da' : 'cb-dr'}">${n} SKU${n === 1 ? '' : 's'}</span>`;
    }

    function optRow(b) {
      const chips = b.skus.map((s) => `<span class="cb-sku" title="${esc(s.code)} · in ${s.n} picklist${s.n === 1 ? '' : 's'}"><b>${s.qty}×</b> ${esc(s.name)}</span>`).join('');
      const sub = `<div class="cb-muted">${b.combos} combo${b.combos === 1 ? '' : 's'}</div>`;
      if (b.done) {
        return `<div class="cb-row cb-done"><div class="cb-count">${b.ms.length}x</div><div class="cb-items">${chips}</div>${hlBadge(b.be)}<span class="cb-delta cb-ds">${esc(b.done)}</span></div>`;
      }
      return `<div class="cb-row${b.checked ? ' on' : ''}${b.be ? ' cb-be' : ''}" data-b="${b.id}">
        <input type="checkbox" class="cb-chk" data-act="ochk" ${b.checked ? 'checked' : ''}>
        <div class="cb-count">${b.ms.length}x</div>
        <div class="cb-items">${chips}${sub}</div>
        ${hlBadge(b.be)}
        ${snzBadge(b.snz)}
        ${skuBadge(b.skus.length)}
      </div>`;
    }

    async function renderOpt() {
      if (tab !== 'opt') return;
      if (!lastGroups) { $opt.innerHTML = `<div class="cb-empty">${busy ? 'Scanning…' : 'Scan first'}</div>`; return; }
      try {
        await ensureOpt();
        drawOpt();
      } catch (e) {
        $opt.innerHTML = `<div class="cb-empty cb-warn">Optimizing failed: ${esc(e.message)}</div>`;
        return;
      }
      if (!users && !usersErr) {
        loadUsers().then(() => {
          const sel = $opt.querySelector('.cb-assign');
          if (sel) sel.innerHTML = assignOptions();
        });
      }
    }

    function drawOpt() {
      if (tab !== 'opt' || !lastGroups) return;
      const groups = optShown();
      if (!groups.length) {
        $opt.innerHTML = (beMode !== 'mix' ? `<div class="cb-optbar">${beSelect()}</div>` : '') +
          `<div class="cb-empty">No picklists with 2+ products to batch${beMode !== 'mix' ? ` (${BE_LABEL[beMode]})` : ''}</div>`;
        return;
      }
      const all = groups.flatMap((g) => g.batches);
      const stops = all.reduce((s, b) => s + b.skus.length, 0);
      groups.forEach((g) => (g.byDate = stopsByDate(g.batches.flatMap((b) => b.ms), optMax)));
      const byDate = groups.reduce((s, g) => s + g.byDate, 0);
      const twoWh = new Set(groups.map((g) => g.shop)).size < groups.length;
      let html = `<div class="cb-optbar">
          <label>Max <input type="number" class="cb-max" min="2" max="200" value="${optMax}"> picklists per batch</label>
          ${beSelect()}
          ${all.length ? `<button class="cb-btn" data-act="oall">${all.every((b) => b.checked) ? 'None' : 'All'}</button>` : ''}
          <span class="cb-sp"></span>
          <span>${all.length} batch${all.length === 1 ? '' : 'es'} · <b>${stops}</b> SKU stops${byDate > stops ? ` <span class="cb-muted">· by date ${byDate} (−${Math.round((1 - stops / byDate) * 100)}%)</span>` : ''}</span>
        </div>`;
      for (const g of groups) {
        const nSel = g.batches.filter((b) => b.checked).length;
        const nPl = g.batches.reduce((s, b) => s + b.ms.length, 0);
        const gStops = g.batches.reduce((s, b) => s + b.skus.length, 0);
        const left = g.batches.length
          ? `<input type="checkbox" class="cb-chk" data-act="oshop" data-k="${esc(g.key)}" title="Select whole shop" ${nSel && nSel === g.batches.length ? 'checked' : ''} data-ind="${nSel > 0 && nSel < g.batches.length ? 1 : 0}">`
          : '';
        const meta = g.batches.length
          ? `${g.batches.length} batch${g.batches.length === 1 ? '' : 'es'} · ${nPl} picklists · ${gStops} SKU stops${g.byDate > gStops ? ` · by date ${g.byDate}` : ''}${nSel ? ` · ${nSel} selected` : ''}`
          : 'all done';
        html += card(g.shop, meta + (twoWh ? ` · warehouse ${esc(g.warehouse)}` : ''), { left }, g.batches.map(optRow).join('') + g.done.map(optRow).join(''));
      }
      html += `<div class="cb-bar">
        <div class="cb-barrow"><div class="cb-sum"></div>
          <div class="cb-acts"><select class="cb-sel cb-assign" title="Assign the new batches to">${assignOptions()}</select><button class="cb-btn" data-act="ocombine">Combine into 1</button><button class="cb-go" data-act="ocreate">Create batches</button></div></div>
      </div>`;
      $opt.innerHTML = html;
      $opt.querySelectorAll('[data-ind="1"]').forEach((el) => (el.indeterminate = true));
      refreshOptFooter();
    }

    function refreshOptFooter() {
      const $sum = $opt.querySelector('.cb-sum');
      if (!$sum) return;
      const sel = optSelected();
      const nPl = sel.reduce((s, b) => s + b.ms.length, 0);
      const stops = sel.reduce((s, b) => s + b.skus.length, 0);
      const plan = sel.length >= 2 ? planCombined(sel) : null;
      let combLine = '';
      if (plan && plan.mixedWh) combLine = '<div class="cb-muted cb-warn">combine: different warehouses can not go in 1 batch</div>';
      else if (plan) {
        combLine = `<div class="cb-muted">combined: 1 batch · ${plan.keep.length} picklists · ${plan.skus} SKU${plan.skus === 1 ? '' : 's'}` +
          `${plan.out.length ? ` · ${plan.out.length} stay out (max ${optMax})` : ''}${plan.be ? ` · ${plan.be} ${esc(HL_LABEL)}` : ''}</div>`;
      }
      $sum.innerHTML = sel.length
        ? `<b>${sel.length}</b> batch${sel.length === 1 ? '' : 'es'} · ${nPl} picklists · <b>${stops}</b> SKU stops${combLine}`
        : '<span class="cb-muted">Tick batches or a whole shop</span>';
      const go = $opt.querySelector('[data-act="ocreate"]');
      go.disabled = busy || !sel.length;
      go.textContent = sel.length ? `Create ${sel.length} batch${sel.length === 1 ? '' : 'es'}` : 'Create batches';
      const comb = $opt.querySelector('[data-act="ocombine"]');
      comb.disabled = busy || !plan || plan.mixedWh;
      comb.textContent = plan && !plan.mixedWh ? `Combine into 1 (${plan.keep.length})` : 'Combine into 1';
      comb.title = plan ? (plan.mixedWh ? 'Different warehouses can not go in 1 batch' : `1 batch, max ${optMax} picklists`) : 'Tick 2 or more batches';
    }

    // ticked batches -> 1 batch, never more than optMax picklists. If they don't fit, keep the
    // set with the fewest different products (start from 1 ticked batch, add the picklists that
    // bring the fewest new products); the rest stays as a new batch in its shop.
    function planCombined(list) {
      const ogOf = new Map();
      list.forEach((b) => b.ms.forEach((m) => ogOf.set(m, b.og)));
      const all = list.flatMap((b) => b.ms);
      let keep = all;
      if (all.length > optMax) {
        let best = null, bestSkus = Infinity;
        for (const seed of list) {
          const chosen = seed.ms.slice(0, optMax);
          const have = new Set(chosen.flatMap((m) => m.items.map((it) => it.code)));
          const pool = all.filter((m) => !chosen.includes(m));
          while (chosen.length < optMax && pool.length) {
            let bi = -1, bc = Infinity, bo = -1;
            pool.forEach((m, i) => {
              let c = 0, o = 0;
              for (const it of m.items) { if (have.has(it.code)) o++; else c++; }
              const sameShop = ogOf.get(m) === seed.og;
              if (c < bc || (c === bc && (o > bo || (o === bo && sameShop && ogOf.get(pool[bi]) !== seed.og)))) { bc = c; bo = o; bi = i; }
            });
            const m = pool.splice(bi, 1)[0];
            chosen.push(m);
            m.items.forEach((it) => have.add(it.code));
          }
          if (have.size < bestSkus) { bestSkus = have.size; best = chosen; }
        }
        keep = best;
      }
      const keepSet = new Set(keep);
      const out = all.filter((m) => !keepSet.has(m));
      // letters: shop after shop as shown, inside a shop the normal order (NL flyers, then DE...),
      // all BE pick-up picklists at the very end
      const ogs = [...new Set(list.map((b) => b.og))];
      const part = (be) => ogs.flatMap((og) => orderRun(keep.filter((m) => ogOf.get(m) === og && isBeM(m) === be)));
      const ordered = part(false).concat(part(true));
      return {
        list, ogs, ogOf, keep: ordered, out,
        skus: new Set(ordered.flatMap((m) => m.items.map((it) => it.code))).size,
        be: hlCount(ordered.map((m) => m.pl)),
        mixedWh: new Set(list.map((b) => b.og.warehouse)).size > 1,
      };
    }

    async function createCombined(list, go) {
      if (busy || list.length < 2) return;
      const plan = planCombined(list);
      if (plan.mixedWh) return;
      const who = assignee ? userName(assignee) : '';
      const nShops = new Set(plan.keep.map((m) => plan.ogOf.get(m).shop)).size;
      if (!confirm(`Combine ${list.length} batches into 1 batch with ${plan.keep.length} picklists${nShops > 1 ? ` from ${nShops} shops` : ''}` +
        `${plan.out.length ? `\n${plan.out.length} picklists stay out (max ${optMax})` : ''}${who ? `\nAssign to ${who}` : ''}?${snzNote(snzCount(plan.keep.map((m) => m.pl)))}`)) return;
      busy = true;
      $scanBtn.disabled = true;
      $opt.querySelectorAll('button, input, select').forEach((el) => (el.disabled = true));
      clearLog();
      go.textContent = 'Creating…';
      const ids = plan.keep.map((m) => m.pl.idpicklist);
      try {
        await wakeUp(plan.keep.map((m) => m.pl), (k, n) => { go.textContent = `Unsnoozing ${k}/${n}…`; });
        go.textContent = 'Creating…';
        const { batch, failed } = await createBatchBeLast(ids, beSetOf(plan.keep));
        const nr = batch.picklist_batchid || batch.idpicklist_batch;
        let to = '';
        if (assignee) {
          try {
            await apiRetry('POST', `/picklists/batches/${batch.idpicklist_batch}/assign`, { iduser: Number(assignee) });
            to = ` → ${who}`;
          } catch (e) {
            to = ' · not assigned';
            log(`✗ assign batch ${nr}: ${String(e.message).slice(0, 120)}`);
          }
        }
        // each shop card: its part of the new batch as done, what did not fit goes back as new batches
        for (const og of plan.ogs) {
          og.batches = og.batches.filter((b) => !list.includes(b));
          const mine = plan.keep.filter((m) => plan.ogOf.get(m) === og);
          const rest = plan.out.filter((m) => plan.ogOf.get(m) === og);
          if (mine.length) {
            const d = makeBatch(og, mine);
            d.done = `✓ Batch ${nr} (combined)${to}`;
            og.done.push(d);
          }
          if (rest.length) og.batches.push(...packInto(og, rest));
        }
        markTaken(ids.filter((id) => !failed.includes(id)));
        if (failed.length) log(`⚠ Batch ${nr}: ${failed.length} picklist${failed.length === 1 ? '' : 's'} could not go in (not open anymore?)`);
        else if (batch.total_picklists != null && batch.total_picklists < ids.length) log(`⚠ Batch ${nr}: Picqer took ${batch.total_picklists} of ${ids.length} picklists`);
        const nIn = ids.length - failed.length;
        log(`✓ Batch ${nr} · ${list.length} batches combined · ${nIn} picklist${nIn === 1 ? '' : 's'} · ${plan.skus} SKUs${to}` +
          `${plan.out.length ? ` · ${plan.out.length} stayed out` : ''}`);
      } catch (e) {
        log(`✗ ${String(e.message).slice(0, 160)}`);
        alert('Failed: ' + e.message);
      } finally {
        busy = false;
        $scanBtn.disabled = false;
        renderSingles();
        renderGrouped();
        renderOpt();
      }
    }

    $opt.addEventListener('click', (e) => {
      if (busy) return;
      const el = e.target.closest('[data-act]');
      const row = e.target.closest('.cb-row[data-b]');
      const b = row && findOpt(row.dataset.b);
      if (!el) { if (b) { b.checked = !b.checked; drawOpt(); } return; }
      if (el.disabled) return;
      const act = el.dataset.act;
      if (act === 'ochk' && b) { b.checked = el.checked; drawOpt(); }
      else if (act === 'oshop') {
        const g = optGroups.find((x) => x.key === el.dataset.k);
        if (g) g.batches.forEach((x) => (x.checked = el.checked));
        drawOpt();
      } else if (act === 'oall') {
        const list = optGroups.flatMap((g) => g.batches);
        const on = !list.every((x) => x.checked);
        list.forEach((x) => (x.checked = on));
        drawOpt();
      } else if (act === 'ocreate') createOpt(optSelected(), el);
      else if (act === 'ocombine') createCombined(optSelected(), el);
    });

    $opt.addEventListener('change', (e) => {
      if (busy && !e.target.matches('.cb-bemode')) return; // the BE choice always counts (auto batch can be busy any moment)
      if (e.target.matches('.cb-bemode')) {
        setBe(e.target.value);
      } else if (e.target.matches('.cb-assign')) {
        assignee = e.target.value;
        store.set('cb_assign', assignee);
      } else if (e.target.matches('.cb-max')) {
        const v = Math.min(200, Math.max(2, parseInt(e.target.value, 10) || BATCH_MAX));
        e.target.value = v;
        if (v === optMax) return;
        optMax = v;
        store.set('cb_opt_max', v);
        optGroups.forEach((g) => (g.stale = true));
        if (autoPl) autoPl.plan = null;
        renderOpt();
        renderAuto();
      }
    });

    // 1 call per batch; only when Picqer refuses (a picklist not open anymore) go one by one
    async function createBatch(ids) {
      try {
        return { batch: await apiRetry('POST', '/picklists/batches', { idpicklists: ids, type: 'normal' }), failed: [] };
      } catch (e) {
        if (!(e.status >= 400 && e.status < 500)) throw e;
        const failed = [];
        let batch = null, k = 0;
        for (; k < ids.length && !batch; k++) {
          try { batch = await apiRetry('POST', '/picklists/batches', { idpicklists: [ids[k]], type: 'normal' }); }
          catch (e2) { if (!(e2.status >= 400 && e2.status < 500)) throw e2; failed.push(ids[k]); }
        }
        if (!batch) throw new Error(`Picqer refused all ${ids.length} picklists (${String(e.message).slice(0, 100)})`);
        for (; k < ids.length; k++) {
          try { await apiRetry('POST', `/picklists/batches/${batch.idpicklist_batch}/picklists`, { idpicklist: ids[k] }, { retry5xx: true }); }
          catch (_) { failed.push(ids[k]); }
        }
        return { batch, failed };
      }
    }

    // BE pick-up picklists get the last letters: make the batch with the rest, then add them
    // one by one (like "Toevoegen aan batch"), so Picqer hands them the next letters
    async function createBatchBeLast(ids, beIds) {
      const main = ids.filter((id) => !beIds.has(id));
      const be = ids.filter((id) => beIds.has(id));
      if (!main.length || !be.length) return createBatch(ids);
      const res = await createBatch(main);
      for (const id of be) {
        try { await apiRetry('POST', `/picklists/batches/${res.batch.idpicklist_batch}/picklists`, { idpicklist: id }, { retry5xx: true }); }
        catch (_) { res.failed.push(id); }
      }
      return res;
    }
    const beSetOf = (ms) => new Set(ms.filter(isBeM).map((m) => m.pl.idpicklist));

    async function createOpt(list, go) {
      if (busy || !list.length) return;
      const nPl = list.reduce((s, b) => s + b.ms.length, 0);
      const who = assignee ? userName(assignee) : '';
      if (!confirm(`Create ${list.length} batch${list.length === 1 ? '' : 'es'} with ${nPl} picklists${who ? ` and assign to ${who}` : ''}?${snzNote(list.reduce((s, b) => s + snzCount(b.ms.map((m) => m.pl)), 0))}`)) return;
      busy = true;
      $scanBtn.disabled = true;
      $opt.querySelectorAll('button, input, select').forEach((el) => (el.disabled = true));
      clearLog();
      const t0 = Date.now();
      let ok = 0;
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        go.textContent = `Batch ${k + 1}/${list.length}…`;
        const ids = b.ms.map((m) => m.pl.idpicklist);
        try {
          await wakeUp(b.ms.map((m) => m.pl), (i, n) => { go.textContent = `Batch ${k + 1}/${list.length} · unsnoozing ${i}/${n}…`; });
          go.textContent = `Batch ${k + 1}/${list.length}…`;
          const { batch, failed } = await createBatchBeLast(ids, beSetOf(b.ms));
          const nr = batch.picklist_batchid || batch.idpicklist_batch;
          let to = '';
          if (assignee) {
            try {
              await apiRetry('POST', `/picklists/batches/${batch.idpicklist_batch}/assign`, { iduser: Number(assignee) });
              to = ` → ${who}`;
            } catch (e) {
              to = ' · not assigned';
              log(`✗ assign batch ${nr}: ${String(e.message).slice(0, 120)}`);
            }
          }
          b.done = `✓ Batch ${nr}${to}`;
          b.checked = false;
          b.og.batches = b.og.batches.filter((x) => x !== b);
          b.og.done.push(b);
          markTaken(ids.filter((id) => !failed.includes(id)));
          if (failed.length) log(`⚠ Batch ${nr}: ${failed.length} picklist${failed.length === 1 ? '' : 's'} could not go in (not open anymore?)`);
          else if (batch.total_picklists != null && batch.total_picklists < ids.length) log(`⚠ Batch ${nr}: Picqer took ${batch.total_picklists} of ${ids.length} picklists`);
          const nIn = ids.length - failed.length;
          log(`✓ Batch ${nr} · ${nIn} picklist${nIn === 1 ? '' : 's'} · ${b.skus.length} SKU${b.skus.length === 1 ? '' : 's'}${to}`);
          ok++;
        } catch (e) {
          log(`✗ batch ${k + 1}: ${String(e.message).slice(0, 160)}`);
        }
      }
      log(`Done · ${ok}/${list.length} batches · ${Math.round((Date.now() - t0) / 1000)}s`);
      busy = false;
      $scanBtn.disabled = false;
      renderSingles();
      renderGrouped();
      renderOpt();
    }

    // ---------- auto batch: whoever has picked everything gets the next optimized batch ----------
    // done = every open batch assigned to them has amount_collected = amount (what the app shows as picked)
    // then: fresh active picklists of the ticked shops, only the chosen warehouse, packed like this tab
    // (max optMax), the batch with the fewest SKUs per picklist gets made and assigned to them
    // (function declarations: renderAuto can already run while the popup gets built)
    function hm(t) { return new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); }
    function short(e) { return String((e && e.message) || e || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
    function batchNr(b) { return (b && (b.picklist_batchid || b.idpicklist_batch)) || '?'; }
    function whNameOf(id) { return ((warehouses || []).find((w) => String(w.idwarehouse) === String(id)) || {}).name || (id ? `warehouse ${id}` : ''); }

    function assigneeOf(b) {
      const a = b && b.assigned_to;
      if (a && typeof a === 'object') return a.iduser != null ? String(a.iduser) : null;
      if (a != null && /^\d+$/.test(String(a))) return String(a);
      return b && b.assigned_to_iduser != null ? String(b.assigned_to_iduser) : null;
    }
    // picked in the app = amount_collected. normal batches: per picklist inside the product line, singles: on the line
    function progressOf(d) {
      let units = 0, v = 0;
      for (const p of (d && d.products) || []) {
        const parts = Array.isArray(p.picklists) && p.picklists.some((q) => q && q.amount != null) ? p.picklists : [p];
        for (const q of parts) { const n = +(q && q.amount) || 0; units += n; v += Math.min(n, +(q && q.amount_collected) || 0); }
      }
      return { units, v, done: units > 0 && v >= units };
    }
    // still busy: something not collected yet, or we can't tell
    function isInc(x) { return !!x.err || (x.units > 0 ? x.v < x.units : x.npl > 0); }

    function autoAddLog(txt) {
      autoLog.push({ t: Date.now(), txt });
      if (autoLog.length > 40) autoLog = autoLog.slice(-40);
      ss.set('cb_auto_log', autoLog);
    }
    function autoLogOnce(key, txt) { if (!autoOnce.has(key)) { autoOnce.add(key); autoAddLog(txt); } }
    function autoMadeAll() { return store.get('cb_auto_made', {}) || {}; }
    function autoMadeOf(uid) { return autoMadeAll()[uid] || null; }
    function autoSaveMade(uid, rec) { const all = autoMadeAll(); all[uid] = rec; store.set('cb_auto_made', all); }

    async function loadWarehouses() {
      whTried = true;
      if (warehouses && warehouses.length) return warehouses;
      try { warehouses = (await apiRetry('GET', '/warehouses', null, { retry5xx: true })) || []; } catch (_) { warehouses = warehouses || []; }
      return warehouses;
    }
    // chosen in the panel, else the configured one (suite: the picker dashboard's warehouse), else the only one
    function autoWhId() {
      const list = warehouses || [];
      if (autoWh && (!list.length || list.some((w) => String(w.idwarehouse) === autoWh))) return autoWh;
      const want = String(conf.autoWarehouse == null ? '' : conf.autoWarehouse).trim().toLowerCase();
      const nm = (w) => String(w.name || '').trim().toLowerCase();
      const hit = want ? list.find((w) => String(w.idwarehouse) === want) || list.find((w) => nm(w) === want) || list.find((w) => nm(w).includes(want)) : null;
      if (hit) return String(hit.idwarehouse);
      return list.length === 1 ? String(list[0].idwarehouse) : '';
    }
    function openBatches() { return paginate('/picklists/batches?status=open'); }

    // the open batches of 1 person + the one auto made for them, with how much is picked
    async function autoLook(uid, open) {
      const mine = new Map();
      for (const b of open) if (assigneeOf(b) === uid) mine.set(String(b.idpicklist_batch), b);
      const made = autoMadeOf(uid);
      if (made && made.id && !mine.has(String(made.id))) mine.set(String(made.id), null);
      const out = [];
      for (const [id, b] of mine) {
        if (autoSkip.has(id)) continue; // counted as done by hand
        const c = autoSeen.get(id);
        if (b && c && c.done && c.upd === b.updated_at && Date.now() - c.at < AUTO_RECHECK_MS) { out.push(c); continue; } // fully picked, nothing changed
        try {
          const d = await apiRetry('GET', `/picklists/batches/${id}`, null, { retry5xx: true });
          const gone = !d || (d.status && d.status !== 'open');
          if (gone || (!b && assigneeOf(d) !== uid)) { // completed, or given to someone else
            autoSeen.delete(id);
            if (!b && made && String(made.id) === id) autoSaveMade(uid, { ...made, id: null });
            continue;
          }
          const p = progressOf(d);
          const x = { id, nr: batchNr(d), upd: b ? b.updated_at : d.updated_at, at: Date.now(), units: p.units, v: p.v, done: p.done,
            npl: +(d.total_picklists != null ? d.total_picklists : (d.picklists || []).length) || 0 };
          autoSeen.set(id, x);
          out.push(x);
        } catch (e) {
          if (e.status === 404) { autoSeen.delete(id); if (!b && made && String(made.id) === id) autoSaveMade(uid, { ...made, id: null }); continue; }
          out.push({ id, nr: b ? batchNr(b) : made && String(made.id) === id ? made.nr : id, err: short(e) });
        }
      }
      return out;
    }

    // fresh picklists that may go in an auto batch, per shop (active only, this warehouse, ticked shops, not taken)
    function autoMembers(list, wid) {
      const NEW = new Set(['new']); // auto never takes snoozed picklists
      const byShop = new Map(), seen = new Set();
      for (const pl of list) {
        if (!pl || seen.has(pl.idpicklist)) continue;
        seen.add(pl.idpicklist);
        if (String(pl.idwarehouse) !== String(wid) || taken.has(pl.idpicklist) || !selectedShops.has(pl.idfulfilment_customer) || !beOk(pl)) continue;
        const ck = classify(pl, NEW);
        if (!ck || typeof ck === 'string') continue;
        const shop = pl.idfulfilment_customer;
        if (!byShop.has(shop)) byShop.set(shop, []);
        byShop.get(shop).push({ pl, items: ck.items, combo: ck.key });
      }
      return byShop;
    }
    // 1 batch from 1 or 2 shops: letters shop after shop (normal order inside), BE pick-up all at the very end
    function autoBatchOf(parts, wid) {
      parts = parts.slice().sort((a, b) => b.ms.length - a.ms.length || shopName(a.shop).localeCompare(shopName(b.shop)));
      const ordered = [false, true].flatMap((be) => parts.flatMap((p) => orderRun(p.ms.filter((m) => isBeM(m) === be))));
      const b = makeBatch({ key: `auto|${parts[0].shop}|${wid}`, shop: parts[0].shop, warehouse: +wid, batches: [], done: [], stale: false, free: 0 }, ordered, true);
      b.shops = parts.map((p) => p.shop);
      return b;
    }
    // the batch of EXACTLY optMax picklists with the fewest SKUs in total: from 1 shop, or 2 shops together.
    // same SKUs -> 1 shop, then the oldest picklists. Nothing makes optMax -> [] with .short = picklists left
    function autoPlanOf(list, wid) {
      const K = optMax;
      const shops = [];
      let total = 0;
      for (const [shop, ms] of autoMembers(list, wid)) {
        total += ms.length;
        shops.push({ shop, ms, r: bestBySize(ms.map((m) => m.items.map((it) => it.code)), ms.map((m) => m.pl.idpicklist), K) });
      }
      const part = (s, k) => ({ shop: s.shop, ms: s.r[k].pick.map((i) => s.ms[i]), age: s.r[k].age });
      let best = null;
      const consider = (parts) => {
        const skus = new Set(parts.flatMap((p) => p.ms.flatMap((m) => m.items.map((it) => it.code)))).size;
        const age = parts.reduce((t, p) => t + p.age, 0);
        if (!best || skus < best.skus || (skus === best.skus && (parts.length < best.parts.length || (parts.length === best.parts.length && age < best.age)))) best = { parts, skus, age };
      };
      for (const s of shops) if (s.r[K]) consider([part(s, K)]);
      for (let i = 0; i < shops.length; i++) {
        for (let j = i + 1; j < shops.length; j++) {
          for (let k = 1; k < K; k++) if (shops[i].r[k] && shops[j].r[K - k]) consider([part(shops[i], k), part(shops[j], K - k)]);
        }
      }
      const plan = best ? [autoBatchOf(best.parts, wid)] : [];
      plan.short = best ? 0 : total;
      return plan;
    }
    async function autoNext(wid) {
      if (!autoPl || autoPl.wid !== wid || Date.now() - autoPl.at > AUTO_FRESH_MS) {
        const list = [];
        await pool([...selectedShops], 3, async (id) => { list.push(...(await paginate(`/picklists?idfulfilment_customer=${id}&status=new`))); });
        autoPl = { at: Date.now(), wid, list, plan: null };
      }
      if (!autoPl.plan || autoPl.plan.k !== optMax || autoPl.plan.some((b) => b.ms.some((m) => taken.has(m.pl.idpicklist)))) {
        autoPl.plan = autoPlanOf(autoPl.list, wid);
        autoPl.plan.k = optMax;
      }
      return autoPl.plan[0] || null;
    }

    // make it with exactly as many picklists as planned. One Picqer refuses (not open anymore, someone else
    // batched it) gets swapped for the best other one of the same shop(s), before the BE pick-up ones go in,
    // so those still get the last letters
    async function autoCreate(b, wid) {
      const K = b.ms.length;
      const seq = b.ms; // letter order: shop after shop, BE pick-up at the end
      // the first shop's normal picklists in 1 call, the rest 1 by 1 so the letters follow (2 shops stay in 2 blocks)
      let cut = 1;
      while (cut < seq.length && !isBeM(seq[0]) && !isBeM(seq[cut]) && seq[cut].pl.idfulfilment_customer === seq[0].pl.idfulfilment_customer) cut++;
      const restMain = seq.slice(cut).filter((m) => !isBeM(m));
      const later = seq.slice(cut).filter(isBeM);
      const used = new Set(seq.map((m) => m.pl.idpicklist));
      const res = await createBatch(seq.slice(0, cut).map((m) => m.pl.idpicklist));
      const id = res.batch.idpicklist_batch;
      const failed = new Set(res.failed);
      const inB = seq.slice(0, cut).filter((m) => !failed.has(m.pl.idpicklist));
      let swapped = 0;
      const add = async (m) => {
        try { await apiRetry('POST', `/picklists/batches/${id}/picklists`, { idpicklist: m.pl.idpicklist }, { retry5xx: true }); inB.push(m); return true; }
        catch (_) { failed.add(m.pl.idpicklist); return false; }
      };
      const spare = (wantBe) => { // the one that brings the fewest new SKUs, then the oldest
        const have = new Set(inB.flatMap((m) => m.items.map((it) => it.code)));
        let best = null, bc = Infinity;
        const byShop = autoMembers(autoPl ? autoPl.list : [], wid);
        for (const m of (b.shops || [b.og.shop]).flatMap((sh) => byShop.get(sh) || [])) {
          if (used.has(m.pl.idpicklist) || isBeM(m) !== wantBe) continue;
          const c = m.items.filter((it) => !have.has(it.code)).length;
          if (c < bc || (c === bc && m.pl.idpicklist < best.pl.idpicklist)) { bc = c; best = m; }
        }
        if (best) used.add(best.pl.idpicklist);
        return best;
      };
      for (const m of restMain) await add(m);
      while (inB.length + later.length < K) { const m = spare(false); if (!m) break; if (await add(m)) swapped++; }
      for (const m of later) await add(m);
      while (inB.length < K) { const m = spare(true); if (!m) break; if (await add(m)) swapped++; } // a BE one was refused: another BE one
      return { batch: res.batch, inB, failed: [...failed], swapped };
    }

    async function autoMake(uid, wid) {
      const now = Date.now();
      const made = autoMadeOf(uid);
      const times = ((made && made.times) || []).filter((t) => now - t < 3600000);
      if (made && now - made.at < AUTO_GAP_MS) { autoState.set(uid, { st: 'wait', txt: `got batch ${made.nr} just now` }); return; }
      if (times.length >= AUTO_PER_HOUR) {
        autoState.set(uid, { st: 'cap', txt: `${times.length} batches in the last hour (max ${AUTO_PER_HOUR}) · waits` });
        autoLogOnce(`cap-${uid}`, `⚠ ${userName(uid)}: ${times.length} batches in the last hour · waits`);
        return;
      }
      if (now < autoIdleUntil) { autoState.set(uid, { st: 'wait', txt: autoIdleTxt }); return; }
      if (busy) { autoState.set(uid, { st: 'wait', txt: 'done · waits until the popup is free' }); return; }
      busy = true;
      try {
        $scanBtn.disabled = true;
        autoState.set(uid, { st: 'make' });
        renderAuto();
        const b = await autoNext(wid);
        if (!b) {
          const nLeft = autoPl && autoPl.plan ? autoPl.plan.short : 0; // picklists in shops that have less than optMax
          autoIdleUntil = Date.now() + AUTO_IDLE_MS;
          autoIdleTxt = nLeft
            ? `done · not ${optMax} picklists left, also not with 2 shops together (${nLeft} left) · looks again ${hm(autoIdleUntil)}`
            : `done · nothing to batch in ${whNameOf(wid)} · looks again ${hm(autoIdleUntil)}`;
          autoState.set(uid, { st: 'wait', txt: autoIdleTxt });
          autoLogOnce('idle', nLeft
            ? `Not ${optMax} picklists left in ${whNameOf(wid)}, also not with 2 shops together (${nLeft} left) · waits for more, looks again every ${Math.round(AUTO_IDLE_MS / 60000)} min`
            : `Nothing left to batch in ${whNameOf(wid)} · looks again every ${Math.round(AUTO_IDLE_MS / 60000)} min`);
          return;
        }
        // one more look right before: did they get a batch meanwhile (by hand, another PC)?
        const again = (await autoLook(uid, await openBatches())).filter(isInc);
        if (again.length) { autoState.set(uid, { st: 'busy', b: again[0], n: again.length }); return; }
        const { batch, inB, swapped } = await autoCreate(b, wid);
        const id = batch.idpicklist_batch, nr = batchNr(batch);
        autoSaveMade(uid, { id, nr, at: Date.now(), times: times.concat(Date.now()) });
        const inIds = inB.map((m) => m.pl.idpicklist);
        inB.forEach((m) => { m.pl.idpicklist_batch = id; }); // our copy of the picklists knows too
        markTaken(inIds);
        if (autoPl) autoPl.plan = null; // that shop changed: plan again next time
        autoOnce.delete('idle');
        autoOnce.delete(`cap-${uid}`);
        try {
          await apiRetry('POST', `/picklists/batches/${id}/assign`, { iduser: Number(uid) });
        } catch (e) {
          autoHalt.set(uid, `batch ${nr} made but not assigned (${short(e)}) · auto stopped for them`);
          autoAddLog(`✗ Batch ${nr} made but could not assign it to ${userName(uid)} (${short(e)}) · auto stops for them`);
          return;
        }
        const nIn = inIds.length;
        const nSku = new Set(inB.flatMap((m) => m.items.map((it) => it.code))).size;
        const perShop = [...new Set(inB.map((m) => m.pl.idfulfilment_customer))].map((sh) => ({ sh, n: inB.filter((m) => m.pl.idfulfilment_customer === sh).length }));
        const where = perShop.length > 1 ? perShop.map((x) => `${shopName(x.sh)} ${x.n}`).join(' + ') : shopName(b.og.shop);
        autoAddLog(`✓ Batch ${nr} → ${userName(uid)} · ${nIn} picklist${nIn === 1 ? '' : 's'} · ${nSku} SKU${nSku === 1 ? '' : 's'} · ${where}` +
          `${swapped ? ` · ${swapped} swapped in (others were not open anymore)` : ''}${nIn < b.ms.length ? ` · ⚠ only ${nIn} could go in` : ''}`);
        // read it back: if we can't see who has it or how much is picked, auto would keep making batches
        const d = await apiRetry('GET', `/picklists/batches/${id}`, null, { retry5xx: true });
        const p = progressOf(d);
        if (assigneeOf(d) !== String(uid) || !(p.units > 0)) {
          autoStop = `Batch ${nr}: Picqer does not show ${assigneeOf(d) !== String(uid) ? `it assigned to ${userName(uid)}` : 'how much of it is picked'} · auto stopped to be safe`;
          setAutoOn(false, 'safety stop');
          return;
        }
        const x = { id: String(id), nr, upd: d.updated_at, at: Date.now(), units: p.units, v: p.v, done: p.done, npl: nIn };
        autoSeen.set(String(id), x);
        autoState.set(uid, { st: 'busy', b: x, n: 1 });
      } catch (e) {
        autoPl = null;
        autoIdleUntil = Date.now() + Math.min(AUTO_IDLE_MS, 60000);
        autoIdleTxt = `done · last try failed, tries again ${hm(autoIdleUntil)}`;
        autoState.set(uid, { st: 'err', txt: `failed: ${short(e)}` });
        autoAddLog(`✗ ${userName(uid)}: ${short(e)}`);
      } finally {
        busy = false;
        $scanBtn.disabled = false;
        if (lastGroups) { renderSingles(); renderGrouped(); renderOpt(); }
      }
    }

    async function autoTick() {
      if (!AUTO_TOP || !autoOn || autoRunning) return;
      if ((+ls.get(AUTO_OFF) || 0) > autoOnAt) { setAutoOn(false, 'turned off in another tab'); return; }
      const lock = ls.get(AUTO_LOCK);
      if (lock && lock.tab !== AUTO_TAB && Date.now() - lock.ts < AUTO_POLL_MS * 2.5) { autoOther = true; renderAuto(); return; }
      autoOther = false;
      ls.set(AUTO_LOCK, { tab: AUTO_TAB, ts: Date.now() });
      autoRunning = true;
      try {
        if (!autoUsers.length) { autoErr = 'Nobody to watch'; return; }
        if (!selectedShops.size) { autoErr = 'No shops ticked'; return; }
        loadShops().catch(() => {});
        loadUsers().catch(() => {});
        await loadWarehouses();
        const wid = autoWhId();
        if (!wid) { autoErr = 'Pick the warehouse'; return; }
        const open = await openBatches();
        const done = [];
        for (const uid of autoUsers.slice()) {
          if (autoHalt.has(uid)) continue;
          const bs = await autoLook(uid, open);
          const inc = bs.filter(isInc);
          if (inc.length) { autoState.set(uid, { st: 'busy', b: inc[0], n: inc.length }); continue; }
          done.push(uid);
        }
        autoErr = '';
        for (const uid of done) {
          if (!autoOn || !autoUsers.includes(uid)) break;
          await autoMake(uid, wid);
        }
      } catch (e) {
        autoErr = short(e);
      } finally {
        autoRunning = false;
        if (autoOn) ls.set(AUTO_LOCK, { tab: AUTO_TAB, ts: Date.now() });
        renderAuto();
      }
    }

    function setAutoOn(on, why) {
      autoOn = on;
      autoState.clear();
      if (on) {
        autoOnAt = Date.now();
        ss.set('cb_auto_on', autoOnAt);
        autoStop = ''; autoErr = ''; autoOther = false;
        autoHalt.clear(); autoOnce.clear();
        autoIdleUntil = 0; autoPl = null;
        autoAddLog(`Auto on · ${autoUsers.map(userName).join(', ')} · ${whNameOf(autoWhId())}`);
        autoKick(50);
      } else {
        ss.set('cb_auto_on', 0);
        const l = ls.get(AUTO_LOCK);
        if (l && l.tab === AUTO_TAB) ls.del(AUTO_LOCK);
        autoAddLog(`Auto off${why ? ` · ${why}` : ''}`);
      }
      renderAuto();
    }

    async function autoToggle() {
      if (autoOn) { ls.set(AUTO_OFF, Date.now()); autoStop = ''; setAutoOn(false); return; } // off in every tab of this PC
      if (!AUTO_TOP) { alert('Open Picqer in its own tab for auto batch'); return; }
      if (!autoUsers.length) { alert('Add who should get batches first'); return; }
      if (!selectedShops.size) { alert('Tick shops first (Shops button at the top)'); return; }
      await loadWarehouses();
      const wid = autoWhId();
      if (!wid) { alert('Pick the warehouse first'); renderAuto(); return; }
      if (!confirm(`Auto batch ON for: ${autoUsers.map(userName).join(', ')}\n${whNameOf(wid)} · ${[...selectedShops].map(shopName).join(', ')} · always exactly ${optMax} picklists per batch (the Max box)\n\n` +
        `Every time one of them has picked everything (collected = total), the batch of ${optMax} with the fewest SKUs gets made and assigned to them. ` +
        `That can be 2 shops together when that means fewer SKUs. Less than ${optMax} left: it waits for more.\n` +
        'Only active picklists (no snoozed). Keep this tab open and use it on 1 PC only.')) return;
      if (!autoWh) { autoWh = wid; store.set('cb_auto_wh', wid); }
      setAutoOn(true);
    }

    function autoText(s) {
      if (s.st === 'off') return ['', 'auto is off'];
      if (s.st === 'look') return ['wait', 'checking…'];
      if (s.st === 'make') return ['make', 'done → making the next batch…'];
      if (s.st === 'busy') {
        const b = s.b;
        const more = s.n > 1 ? ` · +${s.n - 1} more open` : '';
        if (b.err) return ['wait', `batch ${b.nr} · can't read it (${b.err})${more}`];
        if (!b.units) return ['wait', `batch ${b.nr} · can't read how much is picked${more}`];
        return ['go', `batch ${b.nr} · ${b.v}/${b.units} picked${more}`];
      }
      return [s.st === 'cap' || s.st === 'err' ? 'bad' : 'wait', s.txt || ''];
    }

    function renderPill() {
      const show = autoOn && !isOpen();
      pill.style.display = show ? '' : 'none';
      if (!show) return;
      const last = autoLog.length ? autoLog[autoLog.length - 1] : null;
      pill.className = autoOther ? 'other' : autoStop || autoErr || autoHalt.size ? 'bad' : '';
      const n = autoUsers.length;
      pill.innerHTML = `<i></i><b>Auto batch</b><span>${autoOther ? 'runs in another tab' : `${n} ${n === 1 ? 'person' : 'people'}`}</span>` +
        `${last ? `<small>${esc(hm(last.t))} ${esc(last.txt)}</small>` : ''}`;
    }

    function renderAuto() {
      renderPill();
      const tb = panel.querySelector('.cb-tab[data-tab="opt"]');
      if (tb) tb.classList.toggle('cb-autotab', autoOn);
      if (tab !== 'opt') return;
      if (isOpen()) { // (each loads once, so no render loop)
        if (!users && !usersErr && !usersJob) loadUsers().then(renderAuto);
        if (!whTried && !(warehouses && warehouses.length)) loadWarehouses().then(renderAuto);
      }
      // don't pull an open dropdown away from under the mouse
      const f = document.activeElement;
      if (f && f.tagName === 'SELECT' && $auto.contains(f)) return;
      const wid = autoWhId();
      const whs = warehouses || [];
      const whSel = whs.length > 1 || (!wid && whs.length)
        ? `<select class="cb-sel cb-autowh" title="Only picklists of this warehouse"${autoOn ? ' disabled' : ''}>${wid ? '' : '<option value="">Pick warehouse…</option>'}` +
          `${whs.map((w) => `<option value="${esc(w.idwarehouse)}"${String(w.idwarehouse) === wid ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`
        : wid ? `<span class="cb-muted">${esc(whNameOf(wid))}</span>` : '';
      const people = autoUsers.map((uid) => {
        const halt = autoHalt.get(uid);
        const s = autoOn ? autoState.get(uid) || { st: 'look' } : { st: 'off' };
        const [cls, txt] = halt ? ['bad', halt] : autoText(s);
        // stuck batch (something can't be picked) -> count it as done by hand, then they get the next one
        const skip = !halt && s.st === 'busy' && s.b && s.b.id
          ? `<button class="cb-auto-skip" data-act="autoskip" data-u="${esc(uid)}" data-b="${esc(s.b.id)}" data-nr="${esc(s.b.nr)}" title="Stuck (something can't be picked)? Count this batch as done so they get the next one">count as done</button>`
          : '';
        return `<div class="cb-auto-p"><span class="cb-auto-dot ${cls}"></span><b>${esc(userName(uid))}</b>` +
          `<span class="cb-auto-st${cls === 'bad' ? ' cb-warn' : ''}" title="${esc(txt)}">${esc(txt)}</span>${skip}` +
          `<button class="cb-auto-x" data-act="autodel" data-u="${esc(uid)}" title="Stop watching">✕</button></div>`;
      }).join('');
      const pickable = (users || []).filter((u) => !autoUsers.includes(u.id) && !SKIP_USERS.includes(u.id));
      const addSel = `<select class="cb-sel cb-autoadd"><option value="">${users ? '+ Add person' : usersErr ? 'Users not loaded' : 'Loading users…'}</option>` +
        `${pickable.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>`;
      const notes = [];
      if (autoStop) notes.push(`<div class="cb-auto-note cb-warn">⚠ ${esc(autoStop)}</div>`);
      if (autoOn && autoOther) notes.push('<div class="cb-auto-note cb-muted">Runs in another tab on this PC</div>');
      if (autoOn && autoErr) notes.push(`<div class="cb-auto-note cb-warn">⚠ ${esc(autoErr)}</div>`);
      const logHtml = autoLog.slice(-8).reverse().map((l) => `<div><span class="cb-muted">${esc(hm(l.t))}</span> ${esc(l.txt)}</div>`).join('');
      $auto.innerHTML = `<div class="cb-auto${autoOn ? ' on' : ''}">
        <div class="cb-auto-hd"><b>Auto batch</b>${autoOn ? '<span class="cb-auto-live">ON</span>' : ''}
          <span class="cb-muted cb-auto-how">when someone has picked everything (collected = total) they get the next batch of exactly ${optMax} picklists with the fewest SKUs · 1 shop or 2 together · ticked shops</span>
          ${beSelect()}${whSel}<button class="${autoOn ? 'cb-btn cb-auto-stop' : 'cb-go'}" data-act="autotoggle">${autoOn ? 'Turn off' : 'Turn on'}</button></div>
        <div class="cb-auto-people">${people || '<div class="cb-muted">Nobody yet · add who should get batches</div>'}<div class="cb-auto-add">${addSel}</div></div>
        ${notes.join('')}${logHtml ? `<div class="cb-auto-log">${logHtml}</div>` : ''}
      </div>`;
    }

    $auto.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      if (el.dataset.act === 'autotoggle') autoToggle();
      else if (el.dataset.act === 'autoskip') {
        const u = el.dataset.u, id = String(el.dataset.b);
        if (!confirm(`Count batch ${el.dataset.nr} as done for ${userName(u)}?\nThen they get the next batch. For when something in it can't be picked.`)) return;
        autoSkip.add(id);
        store.set('cb_auto_skip', [...autoSkip].slice(-300));
        autoAddLog(`${userName(u)}: batch ${el.dataset.nr} counted as done by hand`);
        autoState.delete(u);
        renderAuto();
        if (autoOn) autoKick(50);
      } else if (el.dataset.act === 'autodel') {
        const u = el.dataset.u;
        autoUsers = autoUsers.filter((x) => x !== u);
        store.set('cb_auto_users', autoUsers);
        autoHalt.delete(u);
        autoState.delete(u);
        renderAuto();
      }
    });
    $auto.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('.cb-bemode')) setBe(t.value);
      else if (t.matches('.cb-autoadd')) {
        const u = t.value;
        t.blur();
        if (u && !autoUsers.includes(u)) {
          autoUsers.push(u);
          store.set('cb_auto_users', autoUsers);
          if (autoOn) { autoAddLog(`+ ${userName(u)}`); autoKick(50); }
        }
        renderAuto();
      } else if (t.matches('.cb-autowh')) {
        autoWh = t.value;
        store.set('cb_auto_wh', autoWh);
        autoPl = null;
        t.blur();
        renderAuto();
      }
    });

    // never let an error in a check go unseen or stop the next one
    function autoKick(ms) { setTimeout(() => { autoTick().catch((e) => console.warn('[auto batch]', e)); }, ms); }
    setInterval(() => { if (autoOn) autoTick().catch((e) => console.warn('[auto batch]', e)); }, AUTO_POLL_MS);
    window.addEventListener('pagehide', () => { const l = ls.get(AUTO_LOCK); if (l && l.tab === AUTO_TAB) ls.del(AUTO_LOCK); });
    if (autoOn) autoKick(1500); // was on in this tab before the page reloaded
    renderAuto();

    // test hook (harmless in real use)
    return { optimize, diff, flyerRank, seqChanges, packBatches, _byId: byId };
  }

  buildComboBatcher({
    api,
    store: { get: (k, d) => GM_getValue(k, d), set: (k, v) => GM_setValue(k, v) },
    conf: CONF,
  });
})();
