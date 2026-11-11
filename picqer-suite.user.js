// ==UserScript==
// @name         Picqer Suite (TRL)
// @namespace    trl.picqer.suite
// @version      3.81
// @description  All TRL Picqer tools in one script: batcher, auto print + next, product colors, picker dashboard, ZAP, DAYSON, error handler and more. Teams decide who may use what. Shift+8 (*) = settings, teams, colors.
// @match        https://*.picqer.com/*
// @run-at       document-start
// @grant        none
// @require      https://raw.githubusercontent.com/Azanone/SABRBUNS/main/teams.js
// @require      https://raw.githubusercontent.com/Azanone/SABRBUNS/main/colors.js
// @updateURL    https://raw.githubusercontent.com/Azanone/SABRBUNS/main/picqer-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Azanone/SABRBUNS/main/picqer-suite.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.__pqSuite) return;
  window.__pqSuite = true;

  // SKIN FIRST (before anything else, document-start): the last skin this PC showed, exactly as it was,
  // so the new page is drawn in the skin right away instead of white first. The real check comes later.
  // on the login page nobody is logged in: forget whose skin was last, so the next person starts clean
  const ON_LOGIN = /^\/login(\/|$)/.test(location.pathname);
  if (ON_LOGIN) { try { localStorage.removeItem('pqsuite_skin_last_v1'); } catch (_) {} }
  const EARLY_SKIN = ON_LOGIN ? null : (() => {
    try {
      const l = JSON.parse(localStorage.getItem('pqsuite_skin_last_v1') || 'null');
      if (!l || !l.id || !l.base) return null;
      const fl = JSON.parse(localStorage.getItem('pqsuite_flags_v1') || 'null');
      if (fl && fl.skins === false) return null; // Ahmad switched skins off for everyone
      const r = document.documentElement;
      const put = (id, css) => { const st = document.createElement('style'); st.id = id; st.textContent = css; (document.head || r).appendChild(st); };
      if (l.vars) {
        r.classList.add('pq-dark');
        if (l.cls) r.classList.add(l.cls);
        for (const [k, v] of Object.entries(l.vars)) r.style.setProperty(k, v);
        const d = JSON.parse(localStorage.getItem('pqsuite_dark_css_v1') || 'null');
        put('pq-skin-dark', (d && d.css) || '');
      }
      put('pq-skin', l.base);
      return l.id;
    } catch (_) { return null; }
  })();

  /* =========================================================================
   *  SHARED FILES in the GitHub repo (not in this file):
   *    teams.js  = who may use what
   *    colors.js = product colors for picklist lines (each PC can add its own on top)
   *  Edit them on GitHub and commit. Every PC picks them up by itself within
   *  about 10 minutes. No @version bump needed.
   *  Easiest: Shift+8 -> Teams / Colors -> Copy ... -> paste over the file on GitHub -> commit.
   *
   *  Which copy counts: the newest copy this PC fetched from GitHub, else the copy
   *  Tampermonkey loaded with the script (@require), else the fallback below.
   * ========================================================================= */
  const RAW = 'https://raw.githubusercontent.com/Azanone/SABRBUNS/main/';
  const SUITE_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '3.81';
  const REMOTE_EVERY = 5 * 60 * 1000;              // fetch each file at most every 5 min per PC
  const FALLBACK_TEAMS = {                         // only if there is no teams.js at all
    teams: [{ name: 'Shift leaders', allow: '*', users: [32247, 'Ahmad Saber'] }],
    leftovers: { allow: ['comboAlert', 'shipErr', 'banner', 'autoNext', 'cardColor', 'pickAll', 'bulkSingles', 'skins'] },
  };
  const okAllow = (a) => a === '*' || (Array.isArray(a) && a.every((f) => typeof f === 'string'));
  function validTeams(d) {
    return !!d && Array.isArray(d.teams) && !!d.leftovers && okAllow(d.leftovers.allow) &&
      d.teams.every((t) => t && typeof t.name === 'string' && okAllow(t.allow) && Array.isArray(t.users) &&
        t.users.every((u) => typeof u === 'number' || typeof u === 'string'));
  }
  function validColors(d) {
    return !!d && typeof d === 'object' && !Array.isArray(d) &&
      Object.entries(d).every(([k, v]) => k.trim() && typeof v === 'string' && v.trim() && v.length <= 40);
  }
  const REMOTE = {
    teams: { file: 'teams.js', varName: 'PQ_TEAMS', ls: 'pqsuite_teams_remote_v1', lsTry: 'pqsuite_teams_try_v1', valid: validTeams, fallback: FALLBACK_TEAMS },
    colors: { file: 'colors.js', varName: 'PQ_COLORS', ls: 'pqsuite_colors_remote_v1', lsTry: 'pqsuite_colors_try_v1', valid: validColors, fallback: {} },
  };
  // teams.js / colors.js -> object. Reads what comes after "PQ_... =" like JSON, but also takes
  // // comments, 'single quotes', trailing commas and keys without quotes, so normal edits don't break it.
  function parseCfgFile(txt, varName = 'PQ_TEAMS', file = 'teams.js') {
    const m = new RegExp(varName + '\\s*=\\s*').exec(txt);
    let i = m ? m.index + m[0].length : txt.indexOf('{');
    if (i < 0) throw new Error(`no "${varName} = { … }" in ${file}`);
    const n = txt.length;
    let out = '', depth = 0;
    const dropTrailingComma = () => { const k = out.search(/,\s*$/); if (k >= 0) out = out.slice(0, k) + out.slice(k + 1); };
    for (; i < n; i++) {
      const c = txt[i];
      if (c === '/' && txt[i + 1] === '/') { while (i < n && txt[i] !== '\n') i++; out += '\n'; continue; }
      if (c === '/' && txt[i + 1] === '*') { const e = txt.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
      if (c === '"' || c === "'") {
        let s = '', j = i + 1;
        for (; j < n && txt[j] !== c; j++) {
          if (txt[j] === '\\' && j + 1 < n) { const x = txt[++j]; s += x === 'n' ? '\n' : x === 't' ? '\t' : x; continue; }
          if (txt[j] === '\n') throw new Error(`string not closed in ${file} near "${s.slice(0, 30)}"`);
          s += txt[j];
        }
        if (j >= n) throw new Error(`string not closed in ${file}`);
        out += JSON.stringify(s);
        i = j;
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < n && /[\w$]/.test(txt[j])) j++;
        const word = txt.slice(i, j);
        let k = j;
        while (k < n && /\s/.test(txt[k])) k++;
        if (txt[k] === ':') out += JSON.stringify(word);
        else if (['true', 'false', 'null'].includes(word)) out += word;
        else throw new Error(`unexpected "${word}" in ${file}`);
        i = j - 1;
        continue;
      }
      if (c === '{' || c === '[') { depth++; out += c; continue; }
      if (c === '}' || c === ']') {
        dropTrailingComma();
        out += c;
        if (--depth === 0) return JSON.parse(out);
        continue;
      }
      out += c;
    }
    throw new Error(`${file} ends too early (a } or ] is missing)`);
  }
  const parseTeamsFile = (txt) => parseCfgFile(txt, 'PQ_TEAMS', 'teams.js');
  function remoteSrc(r) {
    try {
      const c = JSON.parse(localStorage.getItem(r.ls) || 'null');
      if (c && r.valid(c.data)) return { data: c.data, from: 'github', ts: c.ts };
    } catch (_) {}
    try { if (r.valid(window[r.varName])) return { data: window[r.varName], from: 'require' }; } catch (_) {}
    return { data: r.fallback, from: 'fallback' };
  }
  const TEAMS_SRC = remoteSrc(REMOTE.teams);
  const TEAMS = TEAMS_SRC.data.teams;
  const LEFTOVERS = TEAMS_SRC.data.leftovers;
  let COLORS_SRC = remoteSrc(REMOTE.colors);       // colors can change live

  const FEATURE_INFO = {
    settings: 'Shift+8 settings + teams',
    comboBatcher: 'Combo batcher (Ctrl+Shift+B)',
    comboAlert: 'Combo changed popup',
    replenish: 'Replenish alert',
    shipErr: 'Shipment error handler',
    addrFix: 'Address fixer',
    banner: 'Error banner + hide comments',
    batchOpt: 'Batch overview tags',
    zap: 'ZAP',
    dayson: 'DAYSON',
    unpick: 'Unpick all',
    pickStats: 'Picker dashboard (Ctrl+Alt+P)',
    leaderboard: 'Leaderboard: your rank in closed picklists (last 15 min)',
    autoNext: 'Auto print + auto next (A)',
    cardColor: 'Product colors on picklists',
    colors: 'Edit this PC\'s colors (Shift+8)',
    pickAll: 'Picqer "Pick alles" buttons',
    truePickAll: 'True pick all: A picks every product of the picklist',
    bulkSingles: 'Picqer "Verwerk in bulk"',
    skins: 'Skins / themes (looks of Picqer)',
    chat: 'Chat with friends (🪙 panel)',
  };
  const FEATURES = Object.keys(FEATURE_INFO);
  const VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '';
  const normS = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const sameName = (a, b) => !!normS(a) && normS(a).toLowerCase() === normS(b).toLowerCase();
  const isIdLike = (u) => typeof u === 'number' || /^\d+$/.test(String(u));

  // who is logged in to Picqer right now (id from the page, name from the header)
  function readUser() {
    let id = null, name = '';
    try { id = JSON.parse(document.getElementById('bundle-script-tag-picqer').dataset.params).user.id; } catch (_) {}
    try { name = normS(document.querySelector('.layout-header-account .d-mobile-none')?.childNodes[0]?.textContent); } catch (_) {}
    return { id: id == null ? null : String(id), name };
  }
  function teamFor(user, teams = TEAMS) {
    for (const t of teams) {
      for (const u of t.users || []) {
        if (isIdLike(u) ? !!user.id && String(u) === user.id : !!user.name && sameName(u, user.name)) return t;
      }
    }
    return null;
  }
  let ME = { id: null, name: '' };
  // only the owner sees and changes the teams (Shift+8 -> Teams)
  const OWNER_ID = '32247'; // Ahmad Saber
  let openToolSettings = null; // ⚙ in a tool -> small settings card (set by settingsPanel)
  const isOwner = () => String(ME.id || '') === OWNER_ID;
  let TEAM = null;
  const allowOf = (t) => (t ? t.allow : LEFTOVERS.allow);
  const can = (f) => { const a = allowOf(TEAM); return a === '*' || (Array.isArray(a) && a.includes(f)); };
  const teamName = () => (TEAM ? TEAM.name : 'Leftovers');
  [...TEAMS, LEFTOVERS].forEach((t) => Array.isArray(t.allow) && t.allow.forEach((f) => {
    if (!FEATURES.includes(f)) console.warn(`[pq-suite] unknown feature "${f}" in team ${t.name || 'Leftovers'}`);
  }));

  /* =========================================================================
   *  SETTINGS
   * ========================================================================= */
  const SCHEMA = [
    { id: 'comboBatcher', title: 'Combo batcher', hint: 'Ctrl+Shift+B', fields: [
      { k: 'ignoreCodes', label: 'Ignore productcodes (flyers), comma separated', type: 'list', def: ['8720299635869'] },
      { k: 'minGroup', label: 'Min picklists per combo', type: 'num', def: 2 },
      { k: 'flyerOrder', label: 'Flyer order in grouped batch (first → last)', type: 'list', def: ['GLW-FLYER-NL', 'GLW-FLYER-DE'] },
      { k: 'skipParked', label: 'Skip picklists parked by zap / dayson / error handler', type: 'bool', def: true },
      { k: 'batchMax', label: 'Optimized batches: max picklists per batch', type: 'num', def: 15 },
      { k: 'highlightTags', label: 'BE pick-up tags (badge + always last in the batch), comma separated', type: 'list', def: ['BE pick-up'] },
      { k: 'skipTags', label: 'Never batch picklists with these tags (Optimized + auto batch), comma separated', type: 'list', def: ['EIGENAAR'] },
    ]},
    { id: 'comboAlert', title: 'Combo changed popup', hint: 'popup on [COMBO CHANGED] comment', fields: [
      { k: 'beep', label: 'Beep', type: 'bool', def: true },
    ]},
    { id: 'replenish', title: 'Replenish alert', hint: 'toast on new aanvuladvies', fields: [
      { k: 'intervalSec', label: 'Check every (sec)', type: 'num', def: 60 },
      { k: 'beep', label: 'Beep', type: 'bool', def: true },
    ]},
    { id: 'shipErr', title: 'Shipment error handler', hint: 'multi page + singles dialog', fields: [
      { k: 'comment', label: 'Write error in comments', type: 'bool', def: true },
      { k: 'urgent', label: 'Make urgent', type: 'bool', def: true },
      { k: 'unlink', label: 'Remove from batch', type: 'bool', def: true },
      { k: 'label', label: 'Print internal label with the error', type: 'bool', def: true },
      { k: 'assign', label: 'Assign to user', type: 'bool', def: true },
      { k: 'assignTo', label: 'Assign to user id (internal label)', type: 'num', def: 25084 },
    ]},
    { id: 'addrFix', title: 'Address fixer', hint: 'SendCloud address / city too long', fields: [
      { k: 'addrMax', label: 'Max address line length', type: 'num', def: 40 },
      { k: 'cityUkOnly', label: 'City fix UK only', type: 'bool', def: false },
    ]},
    { id: 'banner', title: 'Shipment error banner', hint: 'header banner + hide comments', fields: [
      { k: 'hidePinned', label: 'Hide pinned comments', type: 'bool', def: true },
      { k: 'hideComments', label: 'Hide comments + log on picklist page', type: 'bool', def: true },
    ]},
    { id: 'batchOpt', title: 'Batch optimizer', hint: 'batches overview', fields: [
      { k: 'unboundTag', label: 'UNBOUND tag', type: 'bool', def: true },
      { k: 'pickedTag', label: 'Green tag on dayson batches: open picklists that are picked', type: 'bool', def: true },
      { k: 'pickedOnlyPartial', label: 'Green tag: only half picked (leave out fully picked)', type: 'bool', def: true },
      { k: 'borderLines', label: 'Colored borders', type: 'bool', def: true },
      { k: 'deepScan', label: 'Deep scan batches', type: 'bool', def: true },
      { k: 'daysonThreshold', label: 'Dayson threshold (open picklists)', type: 'num', def: 3 },
      { k: 'scanInterval', label: 'Rescan every (ms)', type: 'num', def: 5000 },
      { k: 'maxConcurrent', label: 'Max parallel requests', type: 'num', def: 30 },
      { k: 'debugTiming', label: 'Log timing to console', type: 'bool', def: false },
    ]},
    { id: 'zap', title: 'ZAP & Print', hint: 'Z on picklist · Ctrl+Alt+Z overview', fields: [
      { k: 'assignTo', label: 'Assign to user id', type: 'num', def: 36135 },
      { k: 'hotkey', label: 'Hotkey', type: 'text', def: 'z' },
      { k: 'showHint', label: 'Show "press Z" hint', type: 'bool', def: true },
    ]},
    { id: 'dayson', title: 'DAYSON open picklists', hint: 'button on batch page', fields: [
      { k: 'assignTo', label: 'Assign to user id', type: 'num', def: 33549 },
      { k: 'skipIfAlready', label: 'Skip if already assigned', type: 'bool', def: true },
      { k: 'concurrency', label: 'Parallel lookups', type: 'num', def: 5 },
      { k: 'pickedTags', label: 'Green tag on picklists that are picked but not closed', type: 'bool', def: true },
      { k: 'pickedOnlyPartial', label: 'Green tag: only half picked (leave out fully picked)', type: 'bool', def: true },
    ]},
    { id: 'zaplog', title: 'ZAP log (shared)', hint: 'used by ZAP + DAYSON', always: true, fields: [
      { k: 'proxyIds', label: 'Proxy user ids (never count as picker)', type: 'list', def: ['36135', '29011', '33549'] },
      { k: 'cacheDays', label: 'Keep stats (days)', type: 'num', def: 7 },
      { k: 'postToChat', label: 'Post to chat', type: 'bool', def: true },
      { k: 'includeMissing', label: 'Missing lines in chat', type: 'bool', def: false },
    ]},
    { id: 'unpick', title: 'Unpick all', hint: 'button next to Pick alles', fields: [] },
    { id: 'autoNext', always: true, switchKey: 'goNext', title: 'Auto next', hint: 'after a shipment: the next picklist of the batch opens by itself',
      note: 'Works in a batch: as soon as the shipment is made you go to the next picklist that still needs packing.', fields: [
      { k: 'goNext', label: 'Go to the next picklist after a shipment', type: 'bool', def: true },
      { k: 'skipClosed', label: 'You land on a closed picklist: go on to the next one right away (not when you came back with <)', type: 'bool', def: true },
      { k: 'delayMs', label: 'Wait before going on (ms)', type: 'num', def: 800 },
    ] },
    { id: 'autoPrint', cfgId: 'autoNext', switchKey: 'printLabel', title: 'Auto print label', hint: 'prints the shipping label as soon as the shipment is made',
      note: 'Only fill in a printer id when the label does not come out of the right printer by itself.', fields: [
      { k: 'printLabel', label: 'Print the shipping label', type: 'bool', def: true },
      { k: 'printerId', label: 'Printer id (leave empty if it works)', type: 'text', def: '' },
    ] },
    { id: 'pickAllKey', cfgId: 'autoNext', title: 'Pick all (A)', hint: 'press A on a picklist to pick everything',
      note: () => `Two kinds — your team decides which one you get:\n• Pick all: A presses Picqer's own "Pick alles" button. Everything is picked in 1 go.\n• True pick all: A ticks every product line ✓ one by one, the same as picking them by hand, and waits for Picqer after each line (stops by itself if Picqer says it goes too fast). A bit slower, but every line is really picked.\nYou have: ${can('truePickAll') ? 'TRUE pick all' : can('pickAll') ? 'normal pick all' : 'no pick all (not for your team)'}.`, fields: [
      { k: 'pickAllKey', label: 'Key for pick all', type: 'text', def: 'a' },
    ] },
    { id: 'pickStats', title: 'Picker dashboard', hint: 'Ctrl+Alt+P · pick · pack · charts · TV: add #pickers to a Picqer link', fields: [
      { k: 'warehouse', label: 'Warehouse for auto batch (name or id)', type: 'text', def: 'Bunsenstraat' },
    ]},
    { id: 'leaderboard', title: 'Leaderboard', hint: 'points in the last 15 min · your rank bottom right · Ctrl+Alt+L = everyone · Ctrl+Alt+P = pick / pack / charts · 🪙 at the top = inventory, stats, shop', fields: [
      { k: 'url', label: 'Middle stop (Cloudflare worker link, empty = every PC asks Picqer itself)', type: 'text', def: 'https://sabrbuns.nitroxylazanone.workers.dev' },
      { k: 'windowMin', label: 'Count closed picklists of the last (min)', type: 'num', def: 15 },
      { k: 'warehouse', label: 'Only this warehouse (name or id, empty = all)', type: 'text', def: 'Bunsenstraat' },
      { k: 'widget', label: 'Show my rank bottom right', type: 'bool', def: true },
      { k: 'theme', label: 'Look: auto, light or dark', type: 'text', def: 'auto' },
      { k: 'feed', label: 'Live feed: pop up when someone gets an epic or legendary crate', type: 'bool', def: true },
      { k: 'trades', label: 'Others can send me trade requests', type: 'bool', def: true },
    ]},
    { id: 'cardColor', title: 'Product colors', hint: 'colored bar per exact product code · colors in Shift+8 → Colors', fields: [
      { k: 'qtyBadge', label: 'Show "2x" badge when more than 1', type: 'bool', def: true },
    ]},
  ];

  const LS_CFG = 'pqsuite_cfg_v1';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  // ---------- diagnostics log (Ctrl+Alt+D): what was slow, what waited, what broke. Copy it and send it to Ahmad / Claude ----------
  const DIAG_LS = 'pqsuite_diag_v1';
  let diagBuf = null, diagT = null;
  function diag(kind, text) {
    try {
      if (!diagBuf) diagBuf = lsGet(DIAG_LS, []) || [];
      diagBuf.push([Date.now(), kind, String(text).slice(0, 300), location.pathname.slice(0, 60)]);
      if (kind === 'SLOWPAGE' || kind === 'crash' || (kind === 'long' && /busy (\d{4,})/.test(text) && +RegExp.$1 > 5000)) diagSend();
      if (diagBuf.length > 600) diagBuf.splice(0, diagBuf.length - 600);
      clearTimeout(diagT);
      diagT = setTimeout(() => { const cur = lsGet(DIAG_LS, []) || []; const seen = new Set(cur.map((x) => x[0] + x[1] + x[2])); lsSet(DIAG_LS, cur.concat(diagBuf.filter((x) => !seen.has(x[0] + x[1] + x[2]))).slice(-600)); diagBuf = null; }, 1500);
    } catch (_) {}
  }
  // something was really slow / broke: the last lines go to Ahmad's Discord by themselves (max 1 per 10 min per PC)
  let diagSendT = null;
  function diagSend() {
    if (diagSendT) return;
    diagSendT = setTimeout(() => {
      diagSendT = null;
      try {
        const last = +lsGet('pqsuite_diag_sent', 0) || 0;
        const url = (lsGet('pqsuite_lb_url_v1', '') || '').replace(/\/+$/, '') || 'https://sabrbuns.nitroxylazanone.workers.dev';
        if (Date.now() - last < 10 * 60000 || !ME.id) return;
        lsSet('pqsuite_diag_sent', Date.now());
        const rows = (lsGet(DIAG_LS, []) || []).concat(diagBuf || []).slice(-35);
        const lines = rows.map((r) => `${new Date(r[0]).toLocaleTimeString('nl-NL')} ${r[1]} ${r[2]} [${r[3]}]`).join('\n');
        fetch(`${url}/diag`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ME.id, name: ME.name, ver: SUITE_VERSION, lines }), keepalive: true }).catch(() => {});
      } catch (_) {}
    }, 4000);
  }
  // barcode scanners "type" a few ms per key: a shortcut only counts as a lone key press (nothing right before or after)
  const KEY_T = [];
  window.addEventListener('keydown', (e) => { if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return; KEY_T.push(e.timeStamp); if (KEY_T.length > 40) KEY_T.shift(); }, true);
  function loneKey(e, fn) {
    const t = e.timeStamp;
    if (KEY_T.some((x) => x < t && t - x < 100)) { diag('scan', `ignored ${e.shiftKey ? 'Shift+' : ''}${e.key} (scanner)`); return; }
    setTimeout(() => { if (KEY_T.some((x) => x > t && x - t < 170)) diag('scan', `ignored ${e.shiftKey ? 'Shift+' : ''}${e.key} (scanner)`); else fn(); }, 180);
  }
  try {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    let lcp = 0;
    new PerformanceObserver((l) => { const es = l.getEntries(); if (es.length) lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((x) => { if (x.duration > 1000) diag('long', `page busy ${Math.round(x.duration)} ms (main thread blocked)`); })).observe({ type: 'longtask', buffered: true });
    window.addEventListener('load', () => setTimeout(() => {
      const n = (performance.getEntriesByType('navigation') || [])[0] || nav || {};
      const msg = `load ${Math.round(n.loadEventStart || 0)} ms · html ${Math.round(n.responseEnd || 0)} ms · biggest paint ${Math.round(lcp)} ms`;
      diag((n.loadEventStart || 0) > 8000 || lcp > 8000 ? 'SLOWPAGE' : 'page', msg);
    }, 3000));
    window.addEventListener('error', (e) => diag('jserr', `${e.message} @ ${String(e.filename || '').split('/').pop()}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => { const r = e.reason; diag('jserr', `promise: ${(r && (r.message || r)) || '?'}`.slice(0, 200)); });
  } catch (_) {}

  // ---------- API gate: all tabs on this PC together stay under Picqer's rate limit ----------
  //  every /api/v1 call from the suite waits for a slot (max API_PER_MIN a minute for the whole PC, a little gap between calls).
  //  Picqer says 429 (too many): every tab stops for a bit (Retry-After) and the call is tried again by itself.
  const API_PER_MIN = Math.max(20, +lsGet('pqsuite_api_per_min', 0) || 300);
  const GATE = 'pqsuite_api_gate_v1';
  const gateSleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let gateLast = 0;
  async function gateWait() {
    for (let n = 0; n < 400; n++) {
      const now = Date.now();
      const g = lsGet(GATE, null) || { t: [], pause: 0 };
      if (g.pause > now) { await gateSleep(Math.min(g.pause - now + 30 + Math.random() * 200, 30000)); continue; }
      if (now - gateLast < 25) { await gateSleep(25 - (now - gateLast)); continue; }
      const t = (g.t || []).filter((x) => now - x < 60000);
      if (t.length >= API_PER_MIN) { await gateSleep(Math.min(60000 - (now - t[0]) + 50 + Math.random() * 300, 30000)); continue; }
      t.push(now);
      gateLast = now;
      lsSet(GATE, { t, pause: g.pause || 0 });
      return;
    }
  }
  function gatePause(res, ms0) {
    let ra = ms0 ? ms0 / 1000 : NaN;
    try { ra = parseFloat(res.headers.get('Retry-After')); } catch (_) {}
    const ms = Math.min(120000, Math.max(5000, (Number.isFinite(ra) ? ra * 1000 : 15000)));
    const g = lsGet(GATE, null) || { t: [], pause: 0 };
    g.pause = Math.max(g.pause || 0, Date.now() + ms);
    lsSet(GATE, g);
    console.info(`[suite] Picqer says too many requests · all tabs wait ${Math.round(ms / 1000)} s`);
    diag('pause', `all tabs pause ${Math.round(ms / 1000)} s (Picqer limit almost reached)`);
  }
  // fast = the combo batcher (you clicked, you are waiting): no per-minute cap or gap, only waits when Picqer
  // really says too many (429) or almost nothing is left. Background stuff keeps the cap.
  let fastFetch = (input, init) => fetch(input, init);
  async function gateFastWait() {
    for (let n = 0; n < 60; n++) {
      const g = lsGet(GATE, null);
      const now = Date.now();
      if (!g || !(g.pause > now)) return;
      await gateSleep(Math.min(g.pause - now + 30, 30000));
    }
  }
  try {
    const realFetch = window.fetch.bind(window);
    const urlOf = (input) => { try { const u = new URL(typeof input === 'string' ? input : input.url, location.href); return u.pathname.replace('/api/v1', '') + (u.search.length > 60 ? u.search.slice(0, 60) + '…' : u.search); } catch (_) { return '?'; } };
    const gated = async (input, init, fast) => {
      // logged out (login page): never ask Picqer's API, its 401 makes Chrome show a "sign in" popup
      if (/^\/(login|password|logout)/.test(location.pathname)) return new Response('', { status: 401, statusText: 'logged out' });
      let res;
      for (let i = 0; i < 4; i++) {
        const w0 = performance.now();
        if (fast) await gateFastWait(); else await gateWait();
        const waited = performance.now() - w0;
        if (waited > 2000) diag('wait', `suite call waited ${Math.round(waited / 1000)} s in the line · ${urlOf(input)}`);
        const f0 = performance.now();
        res = await realFetch(input, init);
        const took = performance.now() - f0;
        if (took > 4000) diag('slow', `suite call ${Math.round(took / 1000)} s · ${res.status} · ${urlOf(input)}`);
        if (res.status === 429) diag('429', `Picqer: too many requests · ${urlOf(input)}`);
        // Picqer's limit (500 a minute) is shared by everyone on the same key: almost used up -> everyone here slows down first
        let left = NaN;
        try { left = parseInt(res.headers.get('X-RateLimit-Remaining'), 10); } catch (_) {}
        if (res.status !== 429 && Number.isFinite(left) && left < 40) gatePause(res, left < 15 ? 20000 : 6000);
        if (res.status !== 429) return res;
        gatePause(res);
      }
      return res;
    };
    fastFetch = (input, init) => gated(input, init, true);
    // Only the suite's own calls wait in the gate. Picqer's own page (it calls /api/v1 too) always goes straight through,
    // otherwise a busy batcher could make Picqer itself wait up to a minute.
    const OWN_FILE = (() => { try { const m = String(new Error().stack).split('\n').map((l) => (l.match(/\(?((?:https?|chrome-extension|moz-extension|blob|file):[^\s)]+?|userscript[^\s)]*?|<anonymous>):\d+:\d+\)?\s*$/) || [])[1]).filter(Boolean); return m[0] || ''; } catch (_) { return ''; } })();
    const fromSuite = () => {
      if (!OWN_FILE) return true;
      try {
        // first caller that is not one of the fetch wrappers (the suite wraps fetch more than once)
        // Chrome: "    at fn (url:1:2)", Firefox / Zen: "fn@url:1:2". Skip this check itself and the fetch wrappers.
        const callers = String(new Error().stack).split('\n').map((l) => l.trim())
          .filter((l) => /:\d+:\d+\)?$/.test(l) && !/^(at )?fromSuite\b|fromSuite@|^at (window\.)?fetch \(|^(window\.)?fetch@|^async\*?(window\.)?fetch@/.test(l));
        return !callers.length || callers[0].includes(OWN_FILE);
      } catch (_) { return true; }
    };
    window.fetch = async function (input, init) {
      let url = '';
      try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (_) {}
      if (!url || url.origin !== location.origin || !url.pathname.startsWith('/api/v1/')) return realFetch(input, init);
      if (!fromSuite()) { // Picqer itself: never wait (only timed for the log)
        const f0 = performance.now();
        const p = realFetch(input, init);
        p.then((r) => { const took = performance.now() - f0; if (took > 4000) diag('picqer', `Picqer's own call ${Math.round(took / 1000)} s · ${r.status} · ${urlOf(input)}`); }).catch(() => {});
        return p;
      }
      return gated(input, init, false);
    };
  } catch (_) {}

  // ---------- settings belong to the Picqer ACCOUNT, not the PC ----------
  //  On this PC: pqsuite_cfg_u_<user id> = {at, cfg}. In the cloud (middle stop): the same, so another PC gets them too.
  //  Before the page says who you are, the settings of whoever used this PC last are used; then they switch.
  const cfgKey = (uid) => `pqsuite_cfg_u_${uid}`;
  const LS_CFG_LAST = 'pqsuite_cfg_lastuid_v1';
  function savedCfg(uid) {
    const mine = uid ? lsGet(cfgKey(uid), null) : null;
    if (mine && mine.cfg) return mine.cfg;
    return lsGet(LS_CFG, {}) || {}; // first time for this account on this PC: start from the old PC settings
  }
  function loadCfg(uid) {
    const saved = savedCfg(uid);
    const out = {};
    for (const m of SCHEMA) {
      const id = m.cfgId || m.id; // some cards only show a part of another section (Auto print / Pick all = autoNext)
      const s = saved[id] || {};
      if (!out[id]) out[id] = { enabled: m.always ? true : s.enabled !== false };
      for (const f of m.fields) out[id][f.k] = s[f.k] !== undefined ? s[f.k] : f.def;
    }
    // old "Auto print + auto next" switched off as a whole: keep both off
    if (saved.autoNext && saved.autoNext.enabled === false && saved.autoNext.goNext !== false) { out.autoNext.goNext = false; out.autoNext.printLabel = false; }
    return out;
  }
  const CFG = loadCfg(lsGet(LS_CFG_LAST, null));
  // switch to another account's settings in place (features keep their reference to CFG.<section>)
  function useCfgOf(uid) {
    const fresh = loadCfg(uid);
    for (const id of Object.keys(fresh)) { if (!CFG[id]) CFG[id] = {}; Object.assign(CFG[id], fresh[id]); }
  }
  function saveCfg(out) {
    const uid = String(ME.id || '');
    const v = { at: Date.now(), cfg: out };
    if (uid) lsSet(cfgKey(uid), v); else lsSet(LS_CFG, out);
    const url = String((out.leaderboard && out.leaderboard.url) || '').trim().replace(/\/+$/, '');
    if (uid && url) {
      return fetch(`${url}/settings?id=${encodeURIComponent(uid)}`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v), keepalive: true })
        .catch(() => {});
    }
    return Promise.resolve();
  }
  // after the page knows who you are: newer settings in the cloud (changed on another PC)? use them
  async function syncCfg() {
    const uid = String(ME.id || '');
    const url = String((CFG.leaderboard && CFG.leaderboard.url) || '').trim().replace(/\/+$/, '');
    if (!uid || !url) return;
    const local = lsGet(cfgKey(uid), null);
    let remote;
    try { remote = await (await fetch(`${url}/settings?id=${encodeURIComponent(uid)}`, { credentials: 'omit', cache: 'no-store' })).json(); } catch (_) { return; }
    if (remote && remote.cfg && (!local || remote.at > local.at)) {
      const changed = JSON.stringify(remote.cfg) !== JSON.stringify(local && local.cfg);
      lsSet(cfgKey(uid), { at: remote.at, cfg: remote.cfg });
      // first time on this PC with this account: reload once so everything runs with your settings
      if (changed && !sessionStorage.getItem('pqsuite_cfg_synced_' + uid)) {
        try { sessionStorage.setItem('pqsuite_cfg_synced_' + uid, '1'); } catch (_) {}
        location.reload();
      }
    } else if (local && local.cfg && (!remote || !remote.cfg || local.at > remote.at)) {
      saveCfg(local.cfg); // this PC has newer ones (or the cloud has none yet): put them in the cloud
    }
  }
  const on = (id) => CFG[id] && CFG[id].enabled;

  /* =========================================================================
   *  SHARED HELPERS
   * ========================================================================= */
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
  const myUserId = () => {
    try { return JSON.parse(document.getElementById('bundle-script-tag-picqer').dataset.params).user.id; }
    catch (_) { return ''; }
  };
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jsonHeaders = () => ({
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-CSRF-TOKEN': csrf(),
    'X-Requested-With': 'XMLHttpRequest',
  });
  const PATH = location.pathname;
  const picklistPageId = () => (location.pathname.match(/^\/picklists\/(\d+)\/?$/) || [])[1] || null;
  const isTyping = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  // per picklist in a batch: how much is picked (at the table) and is it closed. from GET /api/v1/picklists/batches/{id}
  // normal batches have the counts per picklist inside each product line (products[].picklists[])
  async function batchPickState(idBatch) {
    const r = await fetch(`/api/v1/picklists/batches/${idBatch}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const out = new Map();
    const get = (id) => { const k = String(id); if (!out.has(k)) out.set(k, { id: k, alias: '', status: '', total: 0, picked: 0 }); return out.get(k); };
    for (const pl of d.picklists || []) { const e = get(pl.idpicklist); e.alias = pl.alias || ''; e.status = pl.status || ''; }
    for (const p of d.products || []) {
      for (const q of Array.isArray(p.picklists) ? p.picklists : []) {
        if (!q || q.amount == null || q.idpicklist == null) continue;
        const e = get(q.idpicklist), n = +q.amount || 0;
        e.total += n;
        e.picked += Math.min(n, +q.amount_picked || 0);
      }
    }
    for (const e of out.values()) e.closed = /^(closed|cancelled)$/i.test(e.status);
    return out;
  }
  // (partly) picked at the table but not closed yet
  const pickedNotClosed = (state) => [...state.values()].filter((e) => !e.closed && e.total > 0 && e.picked > 0)
    .sort((a, b) => String(a.alias).localeCompare(String(b.alias), 'nl', { numeric: true }));
  const SHIPERR_TAG_RE = /\[shiperr v\d/;
  const ADDRFIX_TAG_RE = /\[addrfix v\d/;

  function beep(freq = 700, vol = 0.07, len = 0.12) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + len);
    } catch (_) {}
  }

  // DOM_TICK goes up when Picqer adds or removes elements: timers skip their work when nothing changed
  let DOM_TICK = 0;
  try { new MutationObserver(() => { DOM_TICK++; }).observe(document.documentElement || document, { childList: true, subtree: true }); } catch (_) {}

  // ? = what is this. Click → a small card with the explanation, click anywhere else → gone
  const helpBtn = (text) => (text ? `<button type="button" class="pq-q" data-q="${escHtml(text)}" title="what is this?">?</button>` : '');
  function helpInit() {
    addStyle('pq-q-style', `
      .pq-q{display:inline-grid;place-items:center;width:16px;height:16px;padding:0;margin:0 0 0 6px;border-radius:50%;border:1px solid #cbd5e1;background:#f8fafc;color:#64748b;font:700 10.5px/1 system-ui,sans-serif;cursor:pointer;vertical-align:middle;flex:none}
      .pq-q:hover{color:#0f172a;border-color:#64748b}
      html.pq-dark .pq-q{background:#1e293b;border-color:#334155;color:#94a3b8}
      #pq-q-pop{position:fixed;z-index:2147483647;max-width:300px;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:10px 12px;font:500 12.5px/1.5 system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.3);white-space:pre-line}
    `);
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.pq-q');
      const old = document.getElementById('pq-q-pop');
      if (!b) { if (old && !e.target.closest('#pq-q-pop')) old.remove(); return; }
      e.preventDefault(); e.stopPropagation();
      if (old) { old.remove(); if (old.dataset.for === b.dataset.q) return; }
      const pop = document.createElement('div');
      pop.id = 'pq-q-pop';
      pop.dataset.for = b.dataset.q;
      pop.textContent = b.dataset.q;
      document.body.appendChild(pop);
      const r = b.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left - 10)) + 'px';
      pop.style.top = (r.bottom + pop.offsetHeight + 8 > innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
    }, true);
  }
  // switches for everyone, set by Ahmad (Shift+9), come with the leaderboard every 30 s. false = off on every PC
  const LS_FLAGS = 'pqsuite_flags_v1';
  const flagOff = (k) => { const f = lsGet(LS_FLAGS, null); return !!(f && f[k] === false); };
  window.addEventListener('storage', (e) => { if (e.key === LS_FLAGS) window.dispatchEvent(new Event('pq-flags')); });
  const HELP = {
    comboBatcher: 'Makes batches out of open picklists.\nPer combo: picklists with exactly the same products → 1 batch.\nGrouped: several combos in 1 batch (MEGAMULTI), in the order you choose.\nOptimized: the fewest different products per batch, named BELGIE / MIX / NON BELGIE.\nAuto batch: someone finishes a batch → they get the next one by themselves.',
    comboAlert: 'A picklist got a [COMBO CHANGED] comment (the products change from the one before in a grouped batch) → you get a popup so you don\'t miss it.',
    replenish: 'Picqer has new aanvuladvies (stock to refill) → a small message on screen.',
    shipErr: 'A shipment fails (address, carrier…) → the picklist is handled for you: the error in the comments, urgent, out of the batch, an internal label, given to the right person.',
    addrFix: 'SendCloud refuses addresses or cities that are too long → this shortens them so the label can be made.',
    banner: 'Shows a shipment error at the top of the picklist, and hides comments you don\'t need while packing.',
    batchOpt: 'On the batches page: tags per batch (UNBOUND, DAYSON, picked) and colored borders, so you see at a glance what is going on.',
    zap: 'Z on a picklist: it goes to the ZAP person and gets printed. Ctrl+Alt+Z = overview of everything that got zapped.',
    dayson: 'Button on a batch page: gives every open picklist of that batch to DAYSON.',
    zaplog: 'The shared log behind ZAP and DAYSON. Proxy ids are accounts that never count as a picker or packer.',
    unpick: 'A button next to Pick alles that takes back everything that was picked on the picklist.',
    autoNext: 'In a batch: the shipment is made → the next picklist that still needs packing opens by itself.',
    pickAllKey: 'A on a picklist = pick everything in 1 go.',
    pickStats: 'Ctrl+Alt+P: who is picking right now (last 15 min, idle time), who packs, and charts per hour for any day.',
    leaderboard: 'Packing points (multi 2, single 1,334) of the last 15 min. Your rank bottom right, Ctrl+Alt+L for everyone. Points are coins for the shop, crates and the pass (🪙 at the top).',
    cardColor: 'A colored bar per product code on picklists, so look-alike products are easy to tell apart.',
  };
  function addStyle(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* =========================================================================
   *  BANNER: early CSS (document-start)
   * ========================================================================= */
  function bannerEarly() {
    const C = CFG.banner;
    const onPl = /^\/picklists\/\d+\/?$/.test(PATH);
    let css = '';
    if (C.hidePinned) css += '.card.pinned-comment, .pinned-comment { display: none !important; }';
    if (onPl && C.hideComments) css += `
      .log-timeline { display: none !important; }
      html:not(.pq-show-comments) .card:has(#comments),
      html:not(.pq-show-comments) #comments { display: none !important; }
      #pq-show-comments-btn {
        display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 12px;
        padding: 2px 6px; border: 0; background: none; border-radius: 4px;
        font-size: 12px; color: inherit; opacity: .45; cursor: pointer;
      }
      #pq-show-comments-btn:hover { opacity: .8; background: rgba(0,0,0,.05); }
      html.pq-show-comments #pq-show-comments-btn { display: none; }`;
    if (css) addStyle('pq-hide-css', css);

    // backup: hide tagged comment blocks, debounced so it doesnt eat cpu
    const hideTagged = () => {
      const shown = document.documentElement.classList.contains('pq-show-comments');
      document.querySelectorAll(shown ? '.pinned-comment__body' : '.pinned-comment__body, .comment-body').forEach((b) => {
        if (SHIPERR_TAG_RE.test(b.textContent) || ADDRFIX_TAG_RE.test(b.textContent)) {
          const card = b.closest('.card, .pinned-comment, .comment');
          if (card) card.style.setProperty('display', 'none', 'important');
        }
      });
    };
    let t = null;
    // only when comments (or our style tag going missing) are involved
    const COMMENTISH = '.pinned-comment__body, .comment-body, .comment, .pinned-comment, #comments';
    const relevant = (recs) => recs.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches(COMMENTISH) || n.querySelector(COMMENTISH))) ||
      [...r.removedNodes].some((n) => n.id === 'pq-hide-css'));
    const mo = new MutationObserver((recs) => {
      if (t || !relevant(recs)) return;
      t = setTimeout(() => { t = null; if (css && !document.getElementById('pq-hide-css')) addStyle('pq-hide-css', css); hideTagged(); }, 250);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    return () => { mo.disconnect(); clearTimeout(t); document.getElementById('pq-hide-css')?.remove(); };
  }

  /* =========================================================================
   *  BANNER: main (picklist page)
   * ========================================================================= */
  function bannerMain() {
    const id = picklistPageId();
    if (!id) return;
    const C = CFG.banner;

    if (C.hideComments) {
      const card = document.getElementById('comments')?.closest('.card');
      if (card && !document.getElementById('pq-show-comments-btn')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'pq-show-comments-btn';
        btn.innerHTML = '<i class="far fa-comments"></i> Toon opmerkingen';
        btn.addEventListener('click', () => {
          document.documentElement.classList.add('pq-show-comments');
          card.querySelectorAll('.comment').forEach((c) => c.style.removeProperty('display'));
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        card.parentNode.insertBefore(btn, card);
      }
    }

    const API = `${location.origin}/api/v1/picklists/${id}`;
    const get = (url) => fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const dismissKey = (msg, fixed) => `pq-shiperr-dismiss-${id}-${fixed ? 'f' : 'e'}-${msg}`;
    const isDismissed = (k) => { try { return !!localStorage.getItem(k); } catch (_) { return false; } };

    function render({ msg, who, when, fixed, live }) {
      document.getElementById('pq-shiperr-banner')?.remove();
      const key = dismissKey(msg, fixed);
      if (isDismissed(key)) return;
      const notices = document.querySelector('header.layout-header .layout-header-notices');
      const el = document.createElement(notices ? 'li' : 'div');
      el.id = 'pq-shiperr-banner';
      const bg = fixed ? 'hsl(45, 90%, 78%)' : 'hsl(0, 83%, 82%)';
      const fg = fixed ? 'hsl(35, 80%, 20%)' : 'hsl(0, 70%, 25%)';
      el.style.cssText = `display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;
        padding:4px 10px;border-radius:6px;background:${bg};color:${fg};font-size:13px;line-height:1.3;list-style:none`
        + (notices ? '' : ';position:fixed;top:0;left:0;right:0;z-index:2147483647;border-radius:0');
      el.innerHTML = `
        <i class="far fa-triangle-exclamation" style="flex:none"></i>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(msg)}">
          <b>${fixed ? 'Adres aangepast, probeer opnieuw:' : 'Verzendfout:'}</b> ${escHtml(msg)}
          <span style="opacity:.75;font-size:11px;margin-left:4px">${live ? 'zojuist' : escHtml(`${who} · ${when}`)}</span>
        </span>
        <button type="button" title="Sluiten" style="flex:none;background:none;border:0;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 2px">&times;</button>`;
      el.querySelector('button').addEventListener('click', () => {
        try { localStorage.setItem(key, '1'); } catch (_) {}
        el.remove();
      });
      (notices || document.body).appendChild(el);
    }

    async function load() {
      const [pl, comments] = await Promise.all([get(API), get(`${API}/comments`)]);
      if (pl.status === 'closed' || pl.status === 'cancelled') return;
      const list = comments.sort((a, b) => b.idcomment - a.idcomment);
      const err = list.find((c) => SHIPERR_TAG_RE.test(c.body || ''));
      if (!err) return;
      const fix = list.find((c) => ADDRFIX_TAG_RE.test(c.body || ''));
      render({
        msg: err.body.split('\n')[0].replace(/^Verzendfout:\s*/, ''),
        who: err.author?.full_name || '',
        when: err.created_at,
        fixed: !!fix && fix.idcomment > err.idcomment,
      });
    }

    window.addEventListener('pq-shiperr', (e) => { if (e.detail?.id === id) render({ msg: e.detail.msg, live: true }); });
    window.addEventListener('pq-addrfix-done', () => load().catch(() => {}));
    load().catch((e) => console.warn('[shiperr-banner]', e));
  }

  /* =========================================================================
   *  SHIPMENT ERROR HANDLER
   * ========================================================================= */
  function shipErr() {
    const C = CFG.shipErr;
    const TAG = 'shiperr v2';
    const visible = (el) => !!el && !el.closest('.hidden') && el.getClientRects().length > 0;

    // only real shipment errors: red alert with .alert__container (like the original logger)
    // AND the text is about shipping. Works also when the error shows right after a page refresh.
    const SHIP_WORDS = /zending|verzend|shipment|label|sendcloud|postnl|dhl|dpd|gls|ups|carrier|vervoerder|parcel|pakket|adres|address|postcode|zipcode|city|plaats|receiver|validation/i;
    function findError(root) {
      for (const box of root.querySelectorAll('.alert.alert-danger .alert__container')) {
        if (!visible(box.closest('.alert'))) continue;
        const msg = norm(box.textContent);
        if (msg && SHIP_WORDS.test(msg)) return msg;
      }
      return null;
    }

    function current() {
      const dlg = document.getElementById('singles-picklist-dialogue');
      if (visible(dlg)) {
        const a = dlg.querySelector('.picklist-details a[href^="/picklists/"]');
        const id = a && (a.getAttribute('href').match(/^\/picklists\/(\d+)/) || [])[1];
        if (!id) return null;
        return { id, ref: norm(a.textContent), mode: 'single', err: findError(dlg) || findError(document) };
      }
      const id = picklistPageId();
      if (id) return { id, ref: '', mode: 'multi', err: findError(document) };
      return null;
    }

    async function post(url, body) {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: jsonHeaders(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${r.status}`);
      return r;
    }

    // same call as ZAP: form post, picqer prints it on your label printer
    const LABEL_MAX = 150;
    async function postForm(url, fields) {
      const fd = new FormData();
      fd.append('_token', csrf());
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-TOKEN': csrf() }, body: fd });
      if (!r.ok) throw new Error(`${r.status}`);
      return r;
    }
    async function printLabel(pid, err) {
      const note = `VERZENDFOUT: ${err}`;
      try {
        await postForm(`/picklists/${pid}/internal-label`, { note });
      } catch (e) {
        if (note.length <= LABEL_MAX) throw e;
        await postForm(`/picklists/${pid}/internal-label`, { note: note.slice(0, LABEL_MAX - 3) + '...' });
      }
    }

    async function lastLoggedError(id) {
      try {
        const r = await fetch(`/api/v1/picklists/${id}/comments`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) return null;
        const list = (await r.json()).sort((a, b) => b.idcomment - a.idcomment);
        const c = list.find((c) => SHIPERR_TAG_RE.test(c.body || ''));
        return c ? norm(c.body.split('\n')[0].replace(/^Verzendfout:\s*/, '')) : null;
      } catch (_) { return null; }
    }

    async function step(name, fn, out) {
      try { await fn(); out.push(`${name} ✓`); }
      catch (e) { out.push(`${name} ✗ (${e.message})`); }
    }

    function toast(ref, res) {
      const t = document.createElement('div');
      const ok = res.every((r) => r.includes('✓'));
      t.style.cssText = `position:fixed;top:16px;right:16px;z-index:100002;background:#fff;border-left:4px solid ${ok ? '#dc2626' : '#f59e0b'};
        border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px 14px;max-width:340px;
        font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937`;
      t.innerHTML = `<b>Verzendfout · ${escHtml(ref)}</b><div style="color:#6b7280;margin-top:3px">${escHtml(res.join(' · ') || 'gelogd')}</div>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 6000);
    }

    const done = new Set();
    let busy = false;

    async function handle({ id, ref, mode, err }) {
      const key = id + '|' + err;
      if (done.has(key) || busy) return;
      done.add(key);
      busy = true;
      try {
        window.dispatchEvent(new CustomEvent('pq-shiperr', { detail: { id, msg: err, mode } }));
        const pid = parseInt(id, 10);
        // same error already logged on this picklist = no 2nd label / comment
        const isNew = (await lastLoggedError(id)) !== err;
        const res = [];
        if (C.urgent) await step('urgent', () => post('/picklists/make-urgent', { idpicklists: [pid] }), res);
        if (C.unlink) await step('uit batch', () => post('/picklists/batches/unlink', { idpicklist: pid, idpicklists: [pid] }), res);
        if (C.label && isNew) await step('label', () => printLabel(pid, err), res);
        if (C.assign) await step('toegewezen', () => post(`/api/v1/picklists/${pid}/assign`, { iduser: +C.assignTo }), res);

        if (C.comment && isNew) {
          await post(`/api/v1/picklists/${pid}/comments`, {
            body: `Verzendfout: ${err}\nActies: ${res.join(' · ') || '-'}\n[${TAG} pl=${id} ${mode} by=${myUserId()} ts=${Date.now()}]`,
          });
        }
        console.log(`[shiperr] ${mode} ${ref || id}:`, err, res);
        toast(ref || `#${id}`, res);
      } catch (e) {
        console.warn('[shiperr]', e);
        done.delete(key);
      } finally {
        busy = false;
      }
    }

    let seenTick = -1;
    setInterval(() => {
      if (document.hidden || busy || seenTick === DOM_TICK) return; // nothing changed on the page
      seenTick = DOM_TICK;
      const c = current();
      if (c && c.err) handle(c);
    }, 700);
  }

  /* =========================================================================
   *  ADDRESS FIXER (picklist page)
   * ========================================================================= */
  function addrFix() {
    const id = picklistPageId();
    if (!id) return;
    const C = CFG.addrFix;
    const ADDR_TRIGGER = "The receiver's address line exceeds the 40-character limit";
    const CITY_RE = /validation_error \(city\): Ensure this value has at most (\d+) characters/i;
    const ADDR_MAX = +C.addrMax || 40;
    const API = `${location.origin}/api/v1/picklists/${id}`;

    const low = (s) => norm(s).toLowerCase();
    const flat = (s) => low(s).replace(/[\s,]/g, '');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const countryName = (code) => { try { return new Intl.DisplayNames(['nl'], { type: 'region' }).of(code) || code; } catch (_) { return code; } };
    const get = (url) => fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('api ' + r.status); return r.json(); });
    const log = (...a) => console.log('[addrfix]', ...a);
    const zipRegex = (zip) => new RegExp(esc(zip.replace(/\s+/g, '')).split('').join('\\s*'), 'gi');
    const splitParts = (s) => (s || '').split(',').map(norm).filter(Boolean);

    function fit(parts, max) {
      const head = [];
      let i = 0;
      for (; i < parts.length; i++) {
        if (head.length && [...head, parts[i]].join(', ').length > max) break;
        head.push(parts[i]);
      }
      let first = head.join(', ');
      let rest = parts.slice(i);
      if (first.length > max) {
        const words = first.split(' ');
        let cut = '', j = 0;
        for (; j < words.length; j++) {
          const next = cut ? cut + ' ' + words[j] : words[j];
          if (cut && next.length > max) break;
          cut = next;
        }
        rest = [words.slice(j).join(' '), ...rest].filter(Boolean);
        first = cut;
      }
      return { head: first, rest: rest.join(', ') };
    }
    const appendA2 = (a2, extra) => {
      if (!extra) return a2;
      if (a2 && flat(a2).includes(flat(extra))) return a2;
      return [a2, extra].filter(Boolean).join(', ');
    };
    function fixAddress(b) {
      let parts = splitParts(b.a1);
      if (b.zip) parts = parts.map((p) => norm(p.replace(zipRegex(b.zip), ''))).filter(Boolean);
      if (b.city) parts = parts.filter((p) => low(p) !== low(b.city));
      const { head, rest } = fit(parts, ADDR_MAX);
      return { ...b, a1: head, a2: rest ? [rest, b.a2].filter(Boolean).join(', ') : b.a2 };
    }
    function fixCity(b, limit) {
      let parts = splitParts(b.city);
      if (b.zip) parts = parts.map((p) => norm(p.replace(zipRegex(b.zip), ''))).filter(Boolean);
      parts = parts.map((p) => {
        const w = p.split(' ');
        if (w.length % 2 === 0) {
          const h = w.length / 2;
          if (low(w.slice(0, h).join(' ')) === low(w.slice(h).join(' '))) return w.slice(0, h).join(' ');
        }
        return p;
      });
      const addrParts = new Set([...splitParts(b.a1), ...splitParts(b.a2)].map(flat));
      const seen = new Set();
      parts = parts.filter((p, i) => {
        const k = flat(p);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        if (i > 0 && addrParts.has(k)) return false;
        return true;
      });
      const { head, rest } = fit(parts, limit);
      return { ...b, city: head, a2: appendA2(b.a2, rest) };
    }

    function confirmDialog(before, after, { title, subtitle, counts }) {
      return new Promise((resolve) => {
        const keep = new Map();
        `${after.a1} ${after.a2} ${after.city}`.split(/\s+/).forEach((w) => {
          const k = w.replace(/,/g, '').toLowerCase();
          if (k) keep.set(k, (keep.get(k) || 0) + 1);
        });
        const markRemoved = (str) => str.split(/(\s+)/).map((tok) => {
          const k = tok.replace(/,/g, '').trim().toLowerCase();
          if (!k) return escHtml(tok);
          if (keep.get(k) > 0) { keep.set(k, keep.get(k) - 1); return escHtml(tok); }
          return `<s style="color:#dc2626">${escHtml(tok)}</s>`;
        }).join('');
        const empty = '<i style="opacity:.4">leeg</i>';
        const cnt = (s, max, aft) => max == null ? '' :
          `<div style="font-size:11px;opacity:.5;${aft && s.length > max ? 'color:#dc2626;opacity:1' : ''}">${s.length}/${max} tekens</div>`;
        const row = (label, key, diff) => {
          const b = before[key], a = after[key], max = counts[key];
          return `<tr>
            <td style="padding:4px 8px;opacity:.6">${label}</td>
            <td style="padding:4px 8px">${b ? (diff ? markRemoved(b) : escHtml(b)) : empty}${cnt(b, max, false)}</td>
            <td style="padding:4px 8px;${b !== a ? 'font-weight:600' : ''}">${a ? escHtml(a) : empty}${cnt(a, max, true)}</td>
          </tr>`;
        };
        const wrapEl = document.createElement('div');
        wrapEl.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
        wrapEl.innerHTML = `
          <div style="background:#fff;color:#111;border-radius:8px;max-width:680px;width:100%;padding:18px;font:14px system-ui;box-shadow:0 10px 30px rgba(0,0,0,.3)">
            <div style="font-weight:600;font-size:16px;margin-bottom:4px">${escHtml(title)}</div>
            <div style="opacity:.7;margin-bottom:12px">${escHtml(subtitle)}</div>
            <table style="width:100%;border-collapse:collapse">
              <tr style="font-size:12px;opacity:.6"><th></th><th style="text-align:left;padding:4px 8px">Voor</th><th style="text-align:left;padding:4px 8px">Na</th></tr>
              ${row('Adres 1', 'a1', true)}
              ${row('Adres 2', 'a2', true)}
              ${row('Postcode', 'zip', false)}
              ${row('Plaats', 'city', true)}
              ${row('Land', 'countryLabel', false)}
            </table>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
              <button type="button" class="btn btn-default" data-x="no">Annuleer</button>
              <button type="button" class="btn btn-primary" data-x="yes">Opslaan</button>
            </div>
          </div>`;
        wrapEl.addEventListener('click', (e) => {
          const x = e.target.dataset?.x || (e.target === wrapEl ? 'no' : null);
          if (!x) return;
          wrapEl.remove();
          resolve(x === 'yes');
        });
        document.body.appendChild(wrapEl);
      });
    }

    async function save(p, a) {
      const body = new URLSearchParams({
        _token: csrf(), name: p.deliveryname || '', contactname: p.deliverycontact || '',
        address: a.a1, address2: a.a2, zipcode: a.zip, city: a.city,
        region: p.deliveryregion || '', country: p.deliverycountry || '', submit: '',
      });
      const r = await fetch(`${location.origin}/picklists/${id}/change-address`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body,
      });
      if (!r.ok) throw new Error('save ' + r.status);
    }

    async function logFix(kind, before, after) {
      const labels = { a1: 'Adres 1', a2: 'Adres 2', city: 'Plaats' };
      const changes = Object.keys(labels).filter((k) => before[k] !== after[k])
        .map((k) => `${labels[k]}: "${before[k]}" -> "${after[k]}"`).join('\n');
      const body = `${kind} aangepast:\n${changes}\n[addrfix v1 pl=${id} by=${myUserId()} ts=${Date.now()}]`;
      await fetch(`${API}/comments`, { method: 'POST', credentials: 'same-origin', headers: jsonHeaders(), body: JSON.stringify({ body }) }).catch(() => {});
    }

    let running = false;
    async function run(liveMsg) {
      if (running) return;
      running = true;
      try {
        const p = await get(API);
        if (p.status === 'closed' || p.status === 'cancelled') return log('skip: status', p.status);
        let msg = liveMsg;
        if (!msg) {
          const list = (await get(`${API}/comments`)).sort((a, b) => b.idcomment - a.idcomment);
          const err = list.find((c) => SHIPERR_TAG_RE.test(c.body || ''));
          if (!err) return;
          const fix = list.find((c) => ADDRFIX_TAG_RE.test(c.body || ''));
          if (fix && fix.idcomment > err.idcomment) return log('skip: already fixed after last error');
          msg = err.body;
        }
        const country = (p.deliverycountry || '').toUpperCase();
        const before = {
          a1: norm(p.deliveryaddress), a2: norm(p.deliveryaddress2),
          zip: norm(p.deliveryzipcode), city: norm(p.deliverycity), countryLabel: countryName(country),
        };
        let after, opts, kind;
        const cityMatch = msg.match(CITY_RE);
        if (msg.includes(ADDR_TRIGGER)) {
          if (country !== 'GB') return log('skip: address fix is UK only, country', country);
          after = fixAddress(before);
          kind = 'Adres';
          opts = { title: 'Adres aanpassen?', subtitle: `SendCloud: adresregel langer dan ${ADDR_MAX} tekens`, counts: { a1: ADDR_MAX, a2: ADDR_MAX } };
        } else if (cityMatch) {
          if (C.cityUkOnly && country !== 'GB') return log('skip: city fix is UK only, country', country);
          const limit = +cityMatch[1] || 30;
          after = fixCity(before, limit);
          kind = 'Plaats';
          opts = { title: 'Plaats aanpassen?', subtitle: `SendCloud: plaats langer dan ${limit} tekens`, counts: { city: limit, a2: ADDR_MAX } };
        } else {
          return;
        }
        if (['a1', 'a2', 'city'].every((k) => before[k] === after[k])) return log('skip: nothing to change');
        if (!(await confirmDialog(before, after, opts))) return log('cancelled');
        await save(p, after);
        await logFix(kind, before, after);
        window.dispatchEvent(new CustomEvent('pq-addrfix-done', { detail: { id } }));
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        console.warn('[addrfix]', e);
      } finally {
        running = false;
      }
    }

    window.addEventListener('pq-shiperr', (e) => { if (e.detail?.id === id) run(e.detail.msg); });
    run();
  }

  /* =========================================================================
   *  UNPICK ALL (picklist page)
   * ========================================================================= */
  function unpickAll() {
    const id = picklistPageId();
    if (!id) return;

    async function unpick(locationId, amount) {
      const r = await fetch(`/api/v1/picklists/${id}/pick`, {
        method: 'POST', credentials: 'same-origin', headers: jsonHeaders(),
        body: JSON.stringify({ idpicklist_product_location: Number(locationId), amount: -amount }),
      });
      if (!r.ok) throw new Error(`unpick failed for ${locationId}: ${r.status}`);
      return r.json();
    }

    async function run(button) {
      const jobs = [];
      document.querySelectorAll('.picklist-line').forEach((row) => {
        const span = row.querySelector('.amount-picked');
        const picked = span ? Number(span.textContent.trim()) : 0;
        if (picked > 0) jobs.push({ locationId: row.dataset.idpicklistProductLocation, amount: picked, code: row.dataset.productcode });
      });
      if (!jobs.length) { alert('Nothing picked on this picklist.'); return; }
      button.disabled = true;
      button.textContent = 'Unpicking...';
      try {
        for (const j of jobs) { await unpick(j.locationId, j.amount); console.log(`unpicked ${j.amount}x ${j.code}`); }
        location.reload();
      } catch (err) {
        console.error(err);
        alert('Something went wrong, check the console.');
        button.disabled = false;
        button.textContent = 'Unpick all';
      }
    }

    const draw = () => {
      if (document.getElementById('pq-unpick-btn')) return true;
      const controls = document.querySelector('.card-heading-controls .stack');
      if (!controls) return false;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'pq-unpick-btn';
      b.className = 'btn btn-sm';
      b.textContent = 'Unpick all';
      b.addEventListener('click', () => run(b));
      controls.prepend(b);
      return true;
    };
    if (!draw()) { let n = 0; const iv = setInterval(() => { if (draw() || ++n > 20) clearInterval(iv); }, 500); }
  }

  /* =========================================================================
   *  COMBO ALERT
   * ========================================================================= */
  function comboAlert() {
    const C = CFG.comboAlert;
    const MARKER = '[COMBO CHANGED]';
    addStyle('ca-style', `
      #ca-ov{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh}
      #ca-box{width:420px;max-width:92vw;background:#fff;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);
        font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937;overflow:hidden;animation:ca-in .12s ease-out}
      #ca-box .hd{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:15px}
      #ca-box .dot{width:8px;height:8px;border-radius:50%;background:#f59e0b}
      #ca-box .bd{padding:14px 18px;line-height:1.55}
      #ca-box .ln{padding:3px 0;font-weight:500}
      #ca-box .add{color:#15803d}
      #ca-box .rem{color:#b91c1c}
      #ca-box .ft{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#f9fafb;border-top:1px solid #e5e7eb}
      #ca-box .hint{font-size:12px;color:#6b7280}
      #ca-box button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 16px;font:600 13px inherit;cursor:pointer}
      #ca-box button:hover{background:#1d4ed8}
      @keyframes ca-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`);

    function body(combo) {
      combo = combo.replace(/^["'“”„\s]+|["'“”\s]+$/g, '');
      if (!combo) return 'Next picklists have a different combination.';
      const parts = combo.split(' ; ').map((p) => p.trim()).filter(Boolean);
      if (!parts.some((p) => /^[+-] /.test(p))) return escHtml(combo);
      return parts.map((p) => `<div class="ln ${p[0] === '+' ? 'add' : p[0] === '-' ? 'rem' : ''}">${escHtml(p)}</div>`).join('');
    }

    function show(text) {
      if (document.getElementById('ca-ov')) return;
      const ov = document.createElement('div');
      ov.id = 'ca-ov';
      ov.innerHTML = `
        <div id="ca-box">
          <div class="hd"><span class="dot"></span>Combo changed</div>
          <div class="bd">${body(text.replace(MARKER, '').trim())}</div>
          <div class="ft"><span class="hint">Space / Enter to continue</span><button>OK</button></div>
        </div>`;
      function onKey(e) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          kill();
        }
      }
      function kill() { ov.remove(); window.removeEventListener('keydown', onKey, true); }
      ov.querySelector('button').onclick = kill;
      ov.onclick = (e) => { if (e.target === ov) kill(); };
      window.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      if (C.beep) beep(660, 0.08, 0.12);
    }

    const seen = new Set();
    function scan() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => n.nodeValue.includes(MARKER) && !n.parentElement.closest('#ca-ov, #cb-overlay, #pqs-ov, textarea, input')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
      });
      const node = walker.nextNode();
      if (!node) return;
      const text = norm(node.parentElement.textContent || node.nodeValue);
      const key = location.pathname + '|' + text;
      if (seen.has(key)) return;
      seen.add(key);
      show(text);
    }
    // only look at what Picqer adds (a comment with the marker), not the whole page every second
    let maybe = document.body.textContent.indexOf(MARKER) !== -1;
    new MutationObserver((recs) => {
      if (maybe) return;
      for (const r of recs) for (const n of r.addedNodes) if ((n.nodeType === 1 || n.nodeType === 3) && (n.textContent || '').indexOf(MARKER) !== -1) { maybe = true; return; }
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (!maybe || document.hidden || document.getElementById('ca-ov')) return;
      maybe = false;
      scan();
    }, 1000);
  }

  /* =========================================================================
   *  REPLENISH ALERT
   * ========================================================================= */
  function replenish() {
    const C = CFG.replenish;
    const ADVICE_URL = '/products/replenish-advice';
    const EVERY = Math.max(15, +C.intervalSec || 60) * 1000;
    const LS_KNOWN = 'ra_known', LS_LAST = 'ra_last', LS_EVENT = 'ra_event';

    async function fetchAdvice() {
      const r = await fetch(ADVICE_URL, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return null;
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const table = doc.querySelector('.replenish-advice-table');
      if (!table) return null;
      const clean = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      return [...table.querySelectorAll('tbody tr')].map((tr) => {
        const a = tr.querySelector('a[data-product-bubble]');
        const tds = tr.querySelectorAll('td');
        return {
          id: a ? a.dataset.productBubble : clean(tds[1]),
          code: clean(a),
          name: clean(a && a.nextElementSibling),
          from: [...(tds[3] ? tds[3].querySelectorAll('.location-label') : [])].map((l) => l.childNodes[0].textContent.trim()).join(', '),
          to: clean(tds[5]),
          amount: clean(tds[6]),
        };
      });
    }

    async function poll() {
      if (Date.now() - lsGet(LS_LAST, 0) < EVERY - 2000) return;
      lsSet(LS_LAST, Date.now());
      let items;
      try { items = await fetchAdvice(); } catch (_) { return; }
      if (!items) return;
      const known = lsGet(LS_KNOWN, null);
      lsSet(LS_KNOWN, items.map((i) => i.id));
      if (known === null) return;
      const fresh = items.filter((i) => !known.includes(i.id));
      if (!fresh.length) return;
      lsSet(LS_EVENT, { t: Date.now(), items: fresh, total: items.length });
      toast(fresh, items.length);
    }

    window.addEventListener('storage', (e) => {
      if (e.key !== LS_EVENT || !e.newValue) return;
      try { const ev = JSON.parse(e.newValue); toast(ev.items, ev.total); } catch (_) {}
    });

    addStyle('ra-style', `
      #ra-wrap{position:fixed;top:16px;right:16px;z-index:100001;display:flex;flex-direction:column;gap:8px;width:340px;max-width:calc(100vw - 32px)}
      .ra-t{background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);border-left:4px solid #2563eb;
        font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937;animation:ra-in .15s ease-out;overflow:hidden}
      .ra-hd{display:flex;justify-content:space-between;align-items:center;padding:10px 12px 6px;font-weight:600;font-size:14px}
      .ra-x{background:none;border:0;color:#9ca3af;font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
      .ra-x:hover{color:#374151}
      .ra-bd{padding:0 12px 8px;max-height:220px;overflow:auto}
      .ra-row{padding:5px 0;border-top:1px solid #f1f5f9}
      .ra-row:first-child{border-top:0}
      .ra-row b{font-weight:600}
      .ra-row small{color:#6b7280;display:block}
      .ra-ft{padding:8px 12px;background:#f9fafb;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center}
      .ra-ft a{color:#2563eb;font-weight:600;text-decoration:none}
      .ra-ft span{color:#6b7280;font-size:12px}
      @keyframes ra-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}`);

    function toast(items, total) {
      let wrap = document.getElementById('ra-wrap');
      if (!wrap) { wrap = document.createElement('div'); wrap.id = 'ra-wrap'; document.body.appendChild(wrap); }
      const t = document.createElement('div');
      t.className = 'ra-t';
      t.innerHTML = `
        <div class="ra-hd">${items.length} new replenish advice${items.length > 1 ? 's' : ''}<button class="ra-x" title="Close">×</button></div>
        <div class="ra-bd">${items.map((i) => `
          <div class="ra-row"><b>${escHtml(i.code)}</b> · ${escHtml(i.amount)}
            <small>${escHtml(i.name)}</small>
            <small>${escHtml(i.from || '-')} → ${escHtml(i.to || '-')}</small></div>`).join('')}</div>
        <div class="ra-ft"><span>${total} on the list</span><a href="${ADVICE_URL}">Open aanvuladvies</a></div>`;
      t.querySelector('.ra-x').onclick = () => t.remove();
      wrap.prepend(t);
      while (wrap.children.length > 3) wrap.lastChild.remove();
      if (C.beep) beep(740, 0.06, 0.1);
    }

    setInterval(poll, EVERY);
    setTimeout(poll, 3000);
  }

  /* =========================================================================
   *  BATCH OPTIMIZER (batches overview)
   * ========================================================================= */
  function batchOpt() {
    if (!/^\/picklists\/batches\/?$/.test(PATH)) return;
    const C = CFG.batchOpt;
    const COLORS = { dayson: '#2563eb', unbound: '#6c757d', clear: '#28a745', picked: '#28a745' };
    try { localStorage.removeItem('picqerBatchCache'); } catch (_) {}

    let active = 0;
    const queue = [];
    const pump = () => {
      while (active < (+C.maxConcurrent || 30) && queue.length) { active++; queue.shift()(() => { active--; pump(); }); }
    };
    const schedule = (job) => { queue.push(job); pump(); };

    const createLoader = (target) => {
      const l = document.createElement('span');
      l.className = 'picqer-loader-tag';
      l.innerText = ' SCANNING...';
      l.style = 'background:#ffc107;color:#212529;padding:2px 6px;border-radius:4px;margin-left:8px;font-size:10px;font-weight:bold;animation:pqpulse 1s infinite;';
      target.after(l);
      return l;
    };
    const isClosed = (r) => r.classList.contains('picklist-closed') || r.querySelector('.fa-check') || r.textContent.includes('Verwerkt') || r.textContent.includes('Compleet');
    const addTag = (target, text, color, textColor, title) => {
      const s = document.createElement('span');
      s.innerText = text;
      if (title) s.title = title;
      s.style = `background:${color};color:${textColor || 'white'};padding:2px 6px;border-radius:4px;margin-left:8px;font-size:10px;font-weight:bold;`;
      target.after(s);
      return s;
    };

    const applyVisuals = (row, d) => {
      const target = row.querySelector('a[href*="/picklists/batches/"]');
      if (!target || target.hasAttribute('data-labeled')) return;
      target.setAttribute('data-labeled', 'true');
      const isDayson = d.openPicklists > 0 && d.openPicklists <= (+C.daysonThreshold || 3);
      if (C.unboundTag && d.unbound > 0) addTag(target, `UNBOUND (${d.unbound})`, COLORS.unbound);
      if (C.borderLines) row.style.borderLeft = `6px solid ${isDayson ? COLORS.dayson : COLORS.clear}`;
      return { isDayson, anchor: target };
    };
    // green tag: which open picklists of a dayson batch are already (partly) picked at the table
    const pickedTag = (anchor, all) => {
      const list = C.pickedOnlyPartial === false ? all : all.filter((e) => e.picked < e.total);
      if (!list.length) return;
      const txt = list.length <= 3 ? list.map((e) => `${e.alias || '?'} ${e.picked}/${e.total}`).join(' · ') : `${list.length} gepickt`;
      addTag(anchor, txt, COLORS.picked, 'white', `Gepickt maar nog niet gesloten:\n${list.map((e) => `${e.alias || e.id}: ${e.picked} van ${e.total}`).join('\n')}`)
        .classList.add('pq-picked-ov');
    };

    // FAST WAY: per batch 1 small API call (JSON) instead of loading the whole batch page.
    //  It lists every picklist with status, letter (alias), container and picked/total, so it also gives
    //  the "picked but not closed" tag without a second call. 6 at a time.
    let apiActive = 0;
    const apiQueue = [];
    const apiPump = () => { while (apiActive < 6 && apiQueue.length) { apiActive++; apiQueue.shift()(() => { apiActive--; apiPump(); }); } };
    const analyze = (row, url, batchId) => {
      const target = row.querySelector('a[href*="/picklists/batches/"]');
      const loader = createLoader(target);
      apiQueue.push((done) => {
        fastFetch(`/api/v1/picklists/batches/${batchId}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then((b) => {
            if (!b || !Array.isArray(b.picklists)) throw new Error('no picklists');
            loader.remove();
            const live = b.picklists.filter((p) => p.status !== 'closed' && p.status !== 'cancelled');
            const unbound = live.filter((p) => !String(p.alias || '').trim() || !p.picking_container).length;
            const v = applyVisuals(row, { openPicklists: live.length, totalPicklists: b.picklists.length, unbound });
            if (v && v.isDayson && C.pickedTag !== false) {
              const st = new Map(b.picklists.map((p) => [p.idpicklist, { id: p.picklistid, alias: p.alias, picked: +p.total_collected || 0, total: +p.total_products || 0, closed: p.status === 'closed' || p.status === 'cancelled' }]));
              pickedTag(v.anchor, pickedNotClosed(st));
            }
          })
          .catch((e) => { console.info('[suite] batch scan via API failed, opening the page', e && e.message); analyzeHtml(row, url, batchId, loader); })
          .finally(done);
      });
      apiPump();
    };
    // old way (only if the API does not work): open each batch page and read its table
    const analyzeHtml = (row, url, batchId, loader) => {
      schedule((done) => {
        const t0 = performance.now();
        fetch(url, { credentials: 'same-origin' }).then((r) => r.text()).then((html) => {
          const t1 = performance.now();
          loader.remove();
          let total = 0, open = 0, unbound = 0;
          const m = html.match(/<table[^>]*class="[^"]*batch-picklists-table[^"]*"[\s\S]*?<\/table>/i);
          if (m) {
            new DOMParser().parseFromString(m[0], 'text/html').querySelectorAll('tbody tr').forEach((r) => {
              total++;
              if (isClosed(r)) return;
              open++;
              const alias = r.querySelector('.picklist-alias');
              const cont = r.querySelector('.picklist-container-id');
              if (!alias?.textContent.trim() || !cont?.textContent.trim()) unbound++;
            });
          }
          const v = applyVisuals(row, { openPicklists: open, totalPicklists: total, unbound });
          if (C.debugTiming) console.log(`[Picqer] batch ${batchId}: open ${open}/${total} | unbound ${unbound} | fetch ${Math.round(t1 - t0)}ms | parse ${Math.round(performance.now() - t1)}ms`);
          if (!v || !v.isDayson || C.pickedTag === false) return done();
          return batchPickState(batchId).then((st) => pickedTag(v.anchor, pickedNotClosed(st))).catch(() => {}).then(done);
        }).catch(() => { loader.innerText = '⚠️ ERROR'; done(); });
      });
    };

    const scanTable = () => {
      document.querySelectorAll('.picqer-table tbody tr').forEach((row) => {
        const txt = row.textContent;
        if (txt.includes('Compleet') || txt.includes('Geannuleerd') || txt.toLowerCase().includes('singles')) {
          if (C.borderLines && !row.style.borderLeft) row.style.borderLeft = `6px solid ${COLORS.clear}`;
          return;
        }
        const link = row.querySelector('a[href*="/picklists/batches/"]');
        if (link && !link.hasAttribute('data-checked')) {
          link.setAttribute('data-checked', 'true');
          if (C.deepScan) analyze(row, link.href, link.href.split('/').pop());
        }
      });
    };

    addStyle('pq-pulse', '@keyframes pqpulse{0%{opacity:1}50%{opacity:.5}100%{opacity:1}}');
    scanTable();
    setInterval(scanTable, Math.max(1000, +C.scanInterval || 5000));
  }

  /* =========================================================================
   *  ZAPLOG CORE (shared by ZAP + DAYSON)
   * ========================================================================= */
  const ZL = (() => {
    const C = CFG.zaplog;
    const LS = { LOG: 'picqer_zaplog_events_v1', USERS: 'picqer_zaplog_users_v1', ME: 'picqer_zaplog_me_v1' };
    const DAY = 86400000;
    const TAG_RE = /\[zaplog v1([^\]]*)\]/g;
    const CHAT_EXTRA = { is_visible_fulfilment: false, show_at_related: false };
    const COMMENTS_TTL = 300000;
    let USERS = null;
    const isProxy = (id) => (C.proxyIds || []).map(String).includes(String(id));

    function toast(msg, ms = 3000) {
      let box = document.getElementById('zaplog-toast');
      if (!box) {
        box = document.createElement('div');
        box.id = 'zaplog-toast';
        box.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483646;display:flex;flex-direction:column;gap:6px;pointer-events:none;';
        document.body.appendChild(box);
      }
      const el = document.createElement('div');
      el.style.cssText = 'background:#22242b;color:#fff;font:600 13px/1.4 Arial,sans-serif;padding:9px 14px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:380px;';
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(() => el.remove(), ms);
    }

    const cacheDays = () => +C.cacheDays || 7;
    function loadEvents() {
      const cutoff = Date.now() - cacheDays() * DAY;
      const raw = lsGet(LS.LOG, []);
      const kept = Array.isArray(raw) ? raw.filter((e) => e && e.ts >= cutoff) : [];
      if (kept.length !== (raw || []).length) lsSet(LS.LOG, kept);
      return kept;
    }
    function addEvents(newOnes) {
      if (!newOnes.length) return;
      const all = loadEvents();
      const seen = new Set(all.map((e) => e.picklistId + '|' + e.ts));
      for (const e of newOnes) if (!seen.has(e.picklistId + '|' + e.ts)) all.push(e);
      const cutoff = Date.now() - cacheDays() * DAY;
      lsSet(LS.LOG, all.filter((e) => e && e.ts >= cutoff).slice(-4000));
    }

    async function loadUsers(force) {
      if (USERS && !force) return USERS;
      const cached = lsGet(LS.USERS, null);
      if (!force && cached && Date.now() - cached.ts < DAY) { USERS = cached.map; return USERS; }
      const map = (cached && cached.map) || {};
      try {
        const r = await fetch('/api/v1/users?limit=500', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (r.ok) {
          const j = await r.json();
          for (const u of (Array.isArray(j) ? j : (j.data || []))) {
            const id = String(u.iduser ?? u.id ?? '');
            if (!id) continue;
            map[id] = [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.username || u.name || ('Gebruiker #' + id);
          }
        }
      } catch (_) {}
      USERS = map;
      lsSet(LS.USERS, { ts: Date.now(), map });
      return USERS;
    }
    function nameFor(id) {
      if (id == null || id === '') return 'Niemand';
      const m = USERS || lsGet(LS.USERS, { map: {} }).map || {};
      return m[String(id)] || ('Gebruiker #' + id);
    }
    function learnNames(pairs) {
      const c = lsGet(LS.USERS, { ts: Date.now(), map: {} });
      let changed = false;
      for (const [id, name] of pairs) {
        if (!id || !name || c.map[String(id)] === name) continue;
        c.map[String(id)] = name;
        changed = true;
      }
      if (!changed) return;
      USERS = c.map;
      lsSet(LS.USERS, c);
    }

    async function whoAmI() {
      const stored = lsGet(LS.ME, null);
      if (stored && stored.id) return stored;
      let me = null;
      try {
        const acc = document.querySelector('.layout-header-account');
        const hit = acc && acc.querySelector('img')?.getAttribute('src')?.match(/\/users\/(\d+)\/avatar/);
        if (hit) me = { id: hit[1], name: norm(acc.querySelector('.d-mobile-none')?.childNodes[0]?.textContent) || null };
      } catch (_) {}
      if (!me && myUserId()) me = { id: String(myUserId()), name: null };
      if (me) {
        await loadUsers();
        if (!me.name) me.name = nameFor(me.id); else learnNames([[me.id, me.name]]);
        lsSet(LS.ME, me);
        return me;
      }
      return { id: null, name: 'Onbekend' };
    }
    function setMeInteractive() {
      const cur = lsGet(LS.ME, { id: '', name: '' });
      const id = prompt('Jouw Picqer gebruikers-ID:', cur.id || '');
      if (id === null) return;
      const name = prompt('Jouw naam:', cur.name || nameFor(id)) || nameFor(id);
      lsSet(LS.ME, { id: String(id).trim(), name: String(name).trim() });
      learnNames([[String(id).trim(), String(name).trim()]]);
      toast('Opgeslagen: ' + name);
    }

    const chatUrl = (pid) => `/api/v1/picklists/${pid}/comments`;
    const COMMENTS_CACHE = new Map();
    const COMMENTS_RE = /\/api\/v1\/picklists\/(\d+)\/comments/;
    function rememberComments(pid, arr) {
      if (!Array.isArray(arr)) return;
      COMMENTS_CACHE.set(String(pid), { ts: Date.now(), arr });
      learnNames(arr.map((c) => [c && c.author && c.author.iduser, c && c.author && (c.author.full_name || c.author.username)]));
    }
    function installCommentsCache() {
      if (window.__zaplogCache) return;
      window.__zaplogCache = true;
      const of = window.fetch;
      window.fetch = function (input, init) {
        const url = String(typeof input === 'string' ? input : (input && input.url) || '');
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        const p = of.apply(this, arguments);
        const m = method === 'GET' && url.match(COMMENTS_RE);
        if (m) p.then((res) => { try { res.clone().json().then((j) => rememberComments(m[1], Array.isArray(j) ? j : (j && j.data))).catch(() => {}); } catch (_) {} }).catch(() => {});
        return p;
      };
      const oo = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        const m = String(method).toUpperCase() === 'GET' && String(url).match(COMMENTS_RE);
        if (m) this.addEventListener('load', () => { try { const j = JSON.parse(this.responseText); rememberComments(m[1], Array.isArray(j) ? j : (j && j.data)); } catch (_) {} });
        return oo.apply(this, arguments);
      };
    }

    async function postChat(pid, text) {
      if (!C.postToChat) return false;
      try {
        const res = await fetch(chatUrl(pid), { method: 'POST', credentials: 'same-origin', headers: jsonHeaders(), body: JSON.stringify(Object.assign({ body: text }, CHAT_EXTRA)) });
        if (!res.ok) toast('Chatbericht mislukt (' + res.status + ')');
        COMMENTS_CACHE.delete(String(pid));
        return res.ok;
      } catch (_) { toast('Chatbericht mislukt'); return false; }
    }
    async function fetchComments(pid) {
      const hit = COMMENTS_CACHE.get(String(pid));
      if (hit && Date.now() - hit.ts < COMMENTS_TTL) return hit.arr;
      try {
        const r = await fetch(chatUrl(pid), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!r.ok) return null;
        const j = await r.json();
        const arr = Array.isArray(j) ? j : (j.data || j.comments || []);
        rememberComments(pid, arr);
        return arr;
      } catch (_) { return null; }
    }
    const commentsToText = (arr) => arr.map((c) => (typeof c === 'string' ? c : (c.body || c.comment || c.text || ''))).join('\n');

    const buildTag = (o) => `[zaplog v1 pl=${o.picklistId} from=${o.from.id || 0} to=${o.to.id || 0} by=${o.by.id || 0} ts=${o.ts} src=${o.src}]`;
    function parseTags(html) {
      const out = [];
      let m;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(html)) !== null) {
        const o = {};
        for (const kv of m[1].trim().split(/\s+/)) { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); }
        if (o.from) out.push({ from: o.from, to: o.to, by: o.by, ts: parseInt(o.ts, 10) || 0, src: o.src });
      }
      return out.sort((a, b) => a.ts - b.ts);
    }
    async function readTags(pid) {
      const hit = COMMENTS_CACHE.get(String(pid));
      if (hit && Date.now() - hit.ts < COMMENTS_TTL) return parseTags(commentsToText(hit.arr));
      if (String(picklistPageId()) === String(pid)) {
        const local = parseTags(document.documentElement.innerHTML);
        if (local.length) return local;
      }
      const arr = await fetchComments(pid);
      if (arr !== null) return parseTags(commentsToText(arr));
      try { const r = await fetch('/picklists/' + pid, { credentials: 'same-origin' }); if (r.ok) return parseTags(await r.text()); } catch (_) {}
      return [];
    }
    async function fetchAssignee(pid) {
      try {
        const r = await fetch('/api/v1/picklists/' + pid, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (r.ok) {
          const d = (await r.json());
          const x = d.data || d;
          const id = x.assigned_to_iduser ?? x.iduser_assigned ?? x.iduser ?? null;
          return { id: id == null ? null : String(id), ref: x.picklistid || null };
        }
      } catch (_) {}
      return { id: null, ref: null };
    }
    async function resolveOriginal(pid, currentId) {
      const tags = await readTags(pid);
      let cur = currentId ? String(currentId) : null;
      if (!tags.length) return { id: cur, via: cur ? 'toewijzing' : 'geen' };
      let idx = tags.length - 1, hops = 0;
      while (cur && idx >= 0 && hops < 25) {
        let found = -1;
        for (let i = idx; i >= 0; i--) if (String(tags[i].to) === cur) { found = i; break; }
        if (found < 0) break;
        cur = String(tags[found].from);
        idx = found - 1;
        hops++;
      }
      if (!cur || cur === '0' || isProxy(cur)) {
        const first = tags.find((t) => t.from && t.from !== '0' && !isProxy(t.from));
        if (first) return { id: first.from, via: 'opmerkingen' };
      }
      return { id: cur, via: hops ? 'opmerkingen' : (cur ? 'toewijzing' : 'geen') };
    }
    function chatMessage(o) {
      const lines = ['Toewijzing: ' + nameFor(o.from.id) + ' -> ' + nameFor(o.to.id)];
      if (C.includeMissing && o.missing && o.missing.length) {
        lines.push('Ontbrekend: ' + o.missing.length + ' regel(s)');
        for (const m of o.missing.slice(0, 15)) lines.push('  - ' + m.loc + ' : ' + m.name + (m.qty > 1 ? ' [' + m.qty + 'x]' : ''));
        if (o.missing.length > 15) lines.push('  - ... +' + (o.missing.length - 15) + ' meer');
      }
      lines.push(buildTag(o));
      return lines.join('\n');
    }

    // ---------- overview (Ctrl+Alt+Z) ----------
    const startOfDay = () => { const x = new Date(); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const startOfWeek = () => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const hhmm = (ts) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const dayLabel = (ts) => new Date(ts).toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: '2-digit' });
    function groupByPerson(events) {
      const map = new Map();
      for (const ev of events) {
        const key = ev.from.id ? 'id:' + ev.from.id : 'nm:' + (ev.from.name || 'onbekend');
        if (!map.has(key)) map.set(key, { id: ev.from.id, name: ev.from.name || nameFor(ev.from.id), count: 0, lines: 0, events: [] });
        const g = map.get(key);
        g.count++; g.lines += (ev.missing || []).length; g.events.push(ev);
      }
      return [...map.values()].sort((a, b) => b.count - a.count || b.lines - a.lines);
    }
    function injectStyle() {
      addStyle('zaplog-style', `
#zaplog-ov{position:fixed;inset:0;z-index:2147483647;background:rgba(10,11,14,.62);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif}
#zaplog-ov *{box-sizing:border-box}
#zaplog-card{width:min(760px,94vw);max-height:88vh;background:#191b21;color:#e9eaee;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden}
#zaplog-card h2{margin:0;font-size:16px;font-weight:700}
.zl-head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#20232b;border-bottom:1px solid #2c303a}
.zl-head .zl-sub{font-size:11px;color:#8d93a3}
.zl-x{margin-left:auto;background:none;border:0;color:#8d93a3;font-size:22px;line-height:1;cursor:pointer;padding:0 4px}
.zl-tabs{display:flex;gap:6px;padding:10px 18px 0}
.zl-tab{background:#23262f;border:1px solid #2c303a;color:#aeb4c2;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer}
.zl-tab.on{background:#6f42c1;border-color:#6f42c1;color:#fff}
.zl-body{padding:12px 18px 6px;overflow:auto;flex:1}
.zl-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer}
.zl-row:hover{background:#22252e}
.zl-cnt{min-width:46px;font-size:15px;font-weight:800;color:#c7a6ff}
.zl-nm{flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zl-meta{font-size:11px;color:#8d93a3;white-space:nowrap}
.zl-bar{height:4px;border-radius:3px;background:#6f42c1;min-width:3px}
.zl-barwrap{width:120px;background:#2a2e38;border-radius:3px;overflow:hidden}
.zl-det{display:none;padding:2px 10px 12px 56px;font-size:12px;color:#c3c8d4}
.zl-det.on{display:block}
.zl-pl{margin:8px 0 0;padding:8px 10px;background:#20232b;border-left:3px solid #6f42c1;border-radius:0 6px 6px 0}
.zl-pl a{color:#c7a6ff;text-decoration:none;font-weight:700}
.zl-it{margin:3px 0 0 2px;color:#9aa1b1}
.zl-it b{color:#ff8b8b}
.zl-empty{padding:28px 10px;text-align:center;color:#8d93a3;font-size:13px}
.zl-foot{display:flex;align-items:center;gap:10px;padding:10px 18px;background:#20232b;border-top:1px solid #2c303a;font-size:11px;color:#8d93a3}
.zl-btn{background:#2a2e38;border:1px solid #343945;color:#c3c8d4;border-radius:6px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer}
.zl-btn:hover{background:#333846;color:#fff}
.zl-btn.warn:hover{background:#7a2230;border-color:#7a2230;color:#fff}`);
    }
    function renderOverview(range) {
      const body = document.getElementById('zaplog-body');
      if (!body) return;
      const from = range === 'day' ? startOfDay() : range === 'week' ? startOfWeek() : Date.now() - 7 * DAY;
      const events = loadEvents().filter((e) => e.ts >= from);
      const groups = groupByPerson(events);
      if (!groups.length) {
        body.innerHTML = '<div class="zl-empty">Nog niks gelogd in deze periode.</div>';
      } else {
        const max = groups[0].count;
        body.innerHTML = groups.map((g, i) => {
          const det = g.events.slice().sort((a, b) => b.ts - a.ts).map((ev) => {
            const items = (ev.missing || []).length
              ? ev.missing.map((m) => `<div class="zl-it">${escHtml(m.loc)} : ${escHtml(m.name)}${m.qty > 1 ? ' <b>[' + m.qty + 'x]</b>' : ''}</div>`).join('')
              : '<div class="zl-it">geen regels vastgelegd</div>';
            return `<div class="zl-pl"><a href="/picklists/${escHtml(ev.picklistId)}" target="_blank">#${escHtml(ev.picklistRef || ev.picklistId)}</a>
              <span class="zl-meta"> ${escHtml(dayLabel(ev.ts))} ${escHtml(hhmm(ev.ts))} &middot; naar ${escHtml(ev.to.name || nameFor(ev.to.id))} &middot; door ${escHtml(ev.by.name || nameFor(ev.by.id))} &middot; ${escHtml(ev.src)}</span>${items}</div>`;
          }).join('');
          return `<div class="zl-row" data-i="${i}"><div class="zl-cnt">${g.count}x</div><div class="zl-nm">${escHtml(g.name)}</div>
            <div class="zl-barwrap"><div class="zl-bar" style="width:${Math.round(g.count / max * 100)}%"></div></div>
            <div class="zl-meta">${g.lines} regel(s)</div></div><div class="zl-det" data-d="${i}">${det}</div>`;
        }).join('');
        body.querySelectorAll('.zl-row').forEach((r) => r.addEventListener('click', () => body.querySelector(`.zl-det[data-d="${r.dataset.i}"]`)?.classList.toggle('on')));
      }
      const tot = document.getElementById('zaplog-tot');
      if (tot) tot.textContent = `${events.length} picklist(s) · ${groups.length} perso(o)n(en) · ${events.reduce((n, e) => n + (e.missing || []).length, 0)} ontbrekende regels`;
    }
    function closeOverview() { document.getElementById('zaplog-ov')?.remove(); }
    function openOverview() {
      if (document.getElementById('zaplog-ov')) return closeOverview();
      injectStyle();
      loadUsers();
      const me = lsGet(LS.ME, { name: null });
      const wrap = document.createElement('div');
      wrap.id = 'zaplog-ov';
      wrap.innerHTML = `<div id="zaplog-card">
        <div class="zl-head"><h2>ZAP overzicht</h2><span class="zl-sub">wie is er overgenomen &middot; cache ${cacheDays()} dagen</span>${can('settings') ? '<button class="zl-x zl-gear" id="zaplog-gear" title="ZAP settings" style="margin-left:auto;font-size:17px">⚙</button>' : ''}<button class="zl-x" id="zaplog-x"${can('settings') ? ' style="margin-left:0"' : ''}>&times;</button></div>
        <div class="zl-tabs"><button class="zl-tab on" data-r="day">Vandaag</button><button class="zl-tab" data-r="week">Deze week</button><button class="zl-tab" data-r="7d">7 dagen</button></div>
        <div class="zl-body" id="zaplog-body"></div>
        <div class="zl-foot"><span id="zaplog-tot"></span><span style="margin-left:auto"></span><span>ik: <b>${escHtml(me.name || 'onbekend')}</b></span>
          <button class="zl-btn" id="zaplog-me">wijzig</button><button class="zl-btn warn" id="zaplog-clr">wis log</button></div></div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) closeOverview(); });
      wrap.querySelector('#zaplog-x').addEventListener('click', closeOverview);
      wrap.querySelector('#zaplog-gear')?.addEventListener('click', () => { closeOverview(); openToolSettings && openToolSettings({ title: 'ZAP', mods: [{ id: 'zap' }, { id: 'zaplog' }, { id: 'dayson' }] }); });
      wrap.querySelectorAll('.zl-tab').forEach((t) => t.addEventListener('click', () => {
        wrap.querySelectorAll('.zl-tab').forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        renderOverview(t.dataset.r);
      }));
      wrap.querySelector('#zaplog-me').addEventListener('click', () => { setMeInteractive(); closeOverview(); });
      wrap.querySelector('#zaplog-clr').addEventListener('click', () => {
        if (confirm('Hele log wissen?')) { localStorage.removeItem(LS.LOG); renderOverview(document.querySelector('.zl-tab.on')?.dataset.r || 'day'); }
      });
      renderOverview('day');
    }
    let overviewInstalled = false;
    function installOverview() {
      if (overviewInstalled) return;
      overviewInstalled = true;
      window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.altKey && e.code === 'KeyZ') { e.preventDefault(); openOverview(); }
        else if (e.ctrlKey && e.altKey && e.code === 'KeyU') { e.preventDefault(); setMeInteractive(); }
        else if (e.key === 'Escape') closeOverview();
      }, true);
    }

    return { toast, addEvents, loadUsers, nameFor, whoAmI, postChat, fetchAssignee, resolveOriginal, chatMessage, installCommentsCache, installOverview };
  })();

  /* =========================================================================
   *  ZAP & PRINT (picklist page)
   * ========================================================================= */
  function zap() {
    const id = picklistPageId();
    if (!id) return;
    const C = CFG.zap;
    const ASSIGN_TO = String(C.assignTo);
    const HOTKEY = String(C.hotkey || 'z').toLowerCase();

    function collectMissing() {
      const missing = [];
      document.querySelectorAll('.picklist-line').forEach((line) => {
        const pickedEl = line.querySelector('.amount-picked');
        const totalEl = line.querySelector('.amount');
        if (!pickedEl || !totalEl) return;
        const picked = parseInt(pickedEl.innerText, 10) || 0;
        const total = parseInt(totalEl.innerText, 10) || 0;
        if (picked >= total) return;
        const loc = line.querySelector('.location-label')?.innerText.trim() || 'No Loc';
        let name = 'Unknown';
        const container = line.querySelector('.stack__item--grow');
        if (container) {
          const clone = container.cloneNode(true);
          clone.querySelectorAll('.stack, .label').forEach((el) => el.remove());
          name = clone.innerText.trim().split('\n')[0];
        }
        missing.push({ loc, name, qty: total - picked });
      });
      return missing;
    }
    const labelFor = (m) => (m.qty > 1 ? ` ${m.loc} : ${m.name} [!! ${m.qty}x !!]` : `${m.loc} : ${m.name}`);

    async function zapPicklist(btn) {
      if (btn && btn.disabled) return;
      const missing = collectMissing();
      if (!missing.length) { ZL.toast('Alles is al gepickt'); return; }
      if (btn) { btn.innerText = '⏳...'; btn.disabled = true; }
      const token = csrf();
      const headers = { 'X-CSRF-TOKEN': token, 'Content-Type': 'application/json', Accept: 'application/json' };
      const pid = parseInt(id, 10);
      try {
        await ZL.loadUsers();
        const [assignee, me] = await Promise.all([ZL.fetchAssignee(id), ZL.whoAmI()]);
        const original = await ZL.resolveOriginal(id, assignee.id);
        const ev = {
          ts: Date.now(), picklistId: String(id), picklistRef: assignee.ref, src: 'zap',
          from: { id: original.id, name: ZL.nameFor(original.id), via: original.via },
          to: { id: ASSIGN_TO, name: ZL.nameFor(ASSIGN_TO) },
          by: { id: me.id, name: me.name }, missing,
        };
        if (btn) btn.innerText = '💬...';
        await ZL.postChat(id, ZL.chatMessage(ev));
        if (btn) btn.innerText = '⏳...';
        await fetch('/picklists/make-urgent', { method: 'POST', headers, body: JSON.stringify({ idpicklists: [pid] }) });
        await fetch('/picklists/batches/unlink', { method: 'POST', headers, body: JSON.stringify({ idpicklist: pid, idpicklists: [pid] }) });
        for (const m of missing) {
          const fd = new FormData();
          fd.append('_token', token);
          fd.append('note', labelFor(m));
          await fetch(`/picklists/${id}/internal-label`, { method: 'POST', headers: { 'X-CSRF-TOKEN': token }, body: fd });
        }
        await fetch(`/api/v1/picklists/${id}/assign`, { method: 'POST', headers, body: JSON.stringify({ iduser: ASSIGN_TO }) });
        ZL.addEvents([ev]);
        ZL.toast(`Overgenomen van ${ev.from.name} · ${missing.length} regel(s)`);
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        console.error(e);
        if (btn) { btn.disabled = false; btn.innerText = 'Error'; }
      }
    }

    function drawButton() {
      if (document.getElementById('zap-btn')) return true;
      const ac = document.querySelector('.header-actions');
      if (!ac) return false;
      const btn = document.createElement('button');
      btn.id = 'zap-btn';
      btn.className = 'btn';
      btn.setAttribute('style', 'background:#6f42c1!important;color:#fff!important;margin-left:10px;font-weight:bold;border:none;padding:6px 16px;cursor:pointer;');
      btn.innerHTML = ' ZAP';
      btn.onclick = (e) => { e.preventDefault(); zapPicklist(btn); };
      ac.appendChild(btn);
      return true;
    }

    function hint() {
      if (!C.showHint || document.getElementById('picqer-zap-indicator')) return;
      const el = document.createElement('div');
      el.id = 'picqer-zap-indicator';
      el.innerHTML = `<div style="position:fixed;bottom:70px;left:20px;background:#6f42c1;color:#fff;padding:10px 15px;border-radius:5px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;z-index:9999;box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:pointer;user-select:none;line-height:1.4;">
        Druk <kbd style="background:#333;padding:2px 6px;border-radius:3px;font-family:monospace;">${escHtml(HOTKEY.toUpperCase())}</kbd> om te zappen
        <div style="font-weight:400;font-size:11px;opacity:.85;margin-top:3px;">Ctrl+Alt+Z = overzicht</div></div>`;
      el.addEventListener('click', () => el.remove());
      document.body.appendChild(el);
    }

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || isTyping(e)) return;
      if (document.getElementById('zaplog-ov') || document.getElementById('pqs-ov') || document.getElementById('ca-ov')) return;
      if (e.key.toLowerCase() === HOTKEY) loneKey(e, () => zapPicklist(document.getElementById('zap-btn')));
    });
    setTimeout(hint, 1000);
    ZL.loadUsers();
    if (!drawButton()) { let n = 0; const iv = setInterval(() => { if (drawButton() || ++n > 30) clearInterval(iv); }, 500); }
  }

  /* =========================================================================
   *  DAYSON (batch detail page)
   * ========================================================================= */
  function dayson() {
    if (!/^\/picklists\/batches\/\d+\/?$/.test(PATH)) return;
    const C = CFG.dayson;
    const ASSIGN_TO = String(C.assignTo);

    async function mapLimit(items, limit, fn) {
      const out = new Array(items.length);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
      }));
      return out;
    }
    const openPicklistIds = () => [...new Set(
      [...document.querySelectorAll('tr:not(.picklist-closed)')]
        .map((r) => r.querySelector('[data-idpicklist]')?.getAttribute('data-idpicklist')).filter(Boolean)
    )];

    // green tag on every picklist that is (partly) picked at the table but not closed
    const BATCH_ID = (PATH.match(/^\/picklists\/batches\/(\d+)/) || [])[1];
    let pickState = null;
    addStyle('pq-picked-style', `.pq-picked-tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:#dcfce7;color:#15803d;border:1px solid #86efac;font-size:11px;font-weight:700;white-space:nowrap;vertical-align:middle}
      .pq-picked-tag.full{background:#28a745;color:#fff;border-color:#28a745}`);
    const rowId = (tr) => tr.querySelector('[data-idpicklist]')?.getAttribute('data-idpicklist')
      || ((tr.querySelector('a[href*="/picklists/"]')?.getAttribute('href') || '').match(/\/picklists\/(\d+)/) || [])[1];
    function paintPicked() {
      if (!pickState || C.pickedTags === false) return;
      document.querySelectorAll('.batch-picklists-table tbody tr').forEach((tr) => {
        const e = pickState.get(String(rowId(tr) || ''));
        const show = e && !e.closed && e.total > 0 && e.picked > 0 && (C.pickedOnlyPartial === false || e.picked < e.total);
        const want = show ? `${e.picked}/${e.total} gepickt` : '';
        let tag = tr.querySelector('.pq-picked-tag');
        if (!want) { if (tag) tag.remove(); return; }
        if (!tag) {
          tag = document.createElement('span');
          tag.className = 'pq-picked-tag';
          tag.title = 'Gepickt maar nog niet gesloten';
          const alias = tr.querySelector('.picklist-alias');
          if (alias) alias.after(tag); else tr.firstElementChild?.appendChild(tag);
        }
        if (tag.textContent !== want) tag.textContent = want;
        tag.classList.toggle('full', e.picked >= e.total);
      });
    }
    async function loadPicked() {
      if (!BATCH_ID || C.pickedTags === false || document.hidden) return;
      try { pickState = await batchPickState(BATCH_ID); paintPicked(); } catch (_) {}
    }
    loadPicked();
    setInterval(loadPicked, 20000);
    setInterval(paintPicked, 1500);

    async function zapBatch(btn) {
      const ids = openPicklistIds();
      if (!ids.length) { ZL.toast('Geen open picklists in deze batch'); return; }
      btn.disabled = true;
      btn.innerText = `⏳ opzoeken (0/${ids.length})`;
      const headers = { 'X-CSRF-TOKEN': csrf(), 'Content-Type': 'application/json', Accept: 'application/json' };
      try {
        await ZL.loadUsers();
        const me = await ZL.whoAmI();
        let done = 0;
        const info = await mapLimit(ids, Math.max(1, +C.concurrency || 5), async (pid) => {
          const a = await ZL.fetchAssignee(pid);
          const original = await ZL.resolveOriginal(pid, a.id);
          btn.innerText = `⏳ opzoeken (${++done}/${ids.length})`;
          return { pid, current: a.id, ref: a.ref, original };
        });
        const todo = C.skipIfAlready ? info.filter((x) => String(x.current) !== ASSIGN_TO) : info;
        const skipped = info.length - todo.length;
        if (!todo.length) { ZL.toast('Alles stond al op ' + ZL.nameFor(ASSIGN_TO)); btn.disabled = false; btn.innerText = 'DAYSON Open Picklists'; return; }
        const events = [];
        for (let i = 0; i < todo.length; i++) {
          const x = todo[i];
          btn.innerText = `⏳ (${i + 1}/${todo.length})`;
          const ev = {
            ts: Date.now(), picklistId: String(x.pid), picklistRef: x.ref, src: 'batch',
            from: { id: x.original.id, name: ZL.nameFor(x.original.id), via: x.original.via },
            to: { id: ASSIGN_TO, name: ZL.nameFor(ASSIGN_TO) },
            by: { id: me.id, name: me.name }, missing: [],
          };
          await ZL.postChat(x.pid, ZL.chatMessage(ev));
          const pid = parseInt(x.pid, 10);
          await fetch('/picklists/batches/unlink', { method: 'POST', headers, body: JSON.stringify({ idpicklist: pid, idpicklists: [pid] }) });
          await fetch(`/api/v1/picklists/${x.pid}/assign`, { method: 'POST', headers, body: JSON.stringify({ iduser: ASSIGN_TO }) });
          events.push(ev);
        }
        ZL.addEvents(events);
        btn.innerText = 'Klaar!';
        ZL.toast(`${events.length} picklist(s) overgezet${skipped ? ` · ${skipped} overgeslagen` : ''}`);
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        console.error(e);
        btn.disabled = false;
        btn.innerText = 'Error';
      }
    }

    function drawButton() {
      if (document.getElementById('zap-btn')) return true;
      const ac = document.querySelector('.header-actions');
      if (!ac) return false;
      const btn = document.createElement('button');
      btn.id = 'zap-btn';
      btn.className = 'btn';
      btn.setAttribute('style', 'background:#FF0034!important;color:#fff!important;margin-left:10px;font-weight:bold;border:none;padding:6px 16px;cursor:pointer;');
      btn.innerHTML = 'DAYSON Open Picklists';
      btn.onclick = (e) => {
        e.preventDefault();
        const ids = openPicklistIds();
        const n = ids.length;
        if (!n) { ZL.toast('Geen open picklists in deze batch'); return; }
        const busy = pickState ? ids.map((id) => pickState.get(String(id))).filter((e) => e && !e.closed && e.picked > 0) : [];
        const warn = busy.length ? `\n\nLet op: ${busy.length} daarvan ${busy.length > 1 ? 'zijn' : 'is'} al (deels) gepickt: ${busy.map((e) => `${e.alias || e.id} ${e.picked}/${e.total}`).join(', ')}` : '';
        if (confirm(`${n} open picklist(s) overzetten naar ${ZL.nameFor(ASSIGN_TO)}?${warn}`)) zapBatch(btn);
      };
      ac.appendChild(btn);
      return true;
    }
    ZL.loadUsers();
    if (!drawButton()) { let n = 0; const iv = setInterval(() => { if (drawButton() || ++n > 30) clearInterval(iv); }, 500); }
  }

  /* =========================================================================
   *  COMBO BATCHER (Ctrl+Shift+B)
   * ========================================================================= */
  // ⚙ in the batcher: per tab only what matters there
  const CB_TAB_SETTINGS = {
    single: { title: 'Per combo', mods: [{ id: 'comboBatcher', keys: ['ignoreCodes', 'minGroup', 'skipParked'] }] },
    grouped: { title: 'Grouped batch', mods: [{ id: 'comboBatcher', keys: ['ignoreCodes', 'minGroup', 'flyerOrder', 'skipParked'] }] },
    opt: { title: 'Optimized batches + auto batch', mods: [{ id: 'comboBatcher', keys: ['batchMax', 'highlightTags', 'skipTags', 'skipParked', 'ignoreCodes'] }] },
    iso: { title: 'Isolated', mods: [{ id: 'comboBatcher', keys: ['skipParked'] }] },
  };
  function comboBatcher() {
    const C = CFG.comboBatcher;
    // always your own Picqer login (like before): no shared API key, so no shared rate limit with other PCs
    async function api(method, path, body) {
      const headers = jsonHeaders();
      const r = await fastFetch(location.origin + '/api/v1' + path, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
      const text = await r.text();
      if (!r.ok) {
        const e = new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
        e.status = r.status;
        e.rate = r.status === 429;
        throw e;
      }
      return text ? JSON.parse(text) : null;
    }
    buildComboBatcher({
      api,
      store: { get: lsGet, set: lsSet },
      conf: {
        ignoreCodes: C.ignoreCodes,
        minGroup: C.minGroup,
        flyerOrder: C.flyerOrder,
        skipAssignedTo: C.skipParked ? [CFG.shipErr.assignTo, CFG.zap.assignTo, CFG.dayson.assignTo] : [],
        batchMax: C.batchMax,
        highlightTags: C.highlightTags,
        skipTags: C.skipTags,
        openSettings: can('settings') ? (tab) => openToolSettings && openToolSettings(CB_TAB_SETTINGS[tab] || CB_TAB_SETTINGS.single) : null,
        autoWarehouse: CFG.pickStats ? CFG.pickStats.warehouse : '', // auto batch: same warehouse as the picker dashboard
        // batch name, the same call Picqer's own "edit title" makes
        setTitle: async (id, title) => {
          try {
            const r = await fastFetch(`${location.origin}/api/v1/picklists/batches/${id}/title`, { method: 'POST', credentials: 'same-origin',
              headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-CSRF-TOKEN': csrf(), 'X-Requested-With': 'XMLHttpRequest' },
              body: new URLSearchParams({ _method: 'patch', title }).toString() });
            return r.ok;
          } catch (_) { return false; }
        },
      },
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
    const setTitle = conf.setTitle || (async () => false);
    const nameBatch = async (id, title) => { if (!(await setTitle(id, title))) log(`⚠ could not name batch ${id} "${title}"`); };
    let isoStop = false; // stop button of the Isolated tab (also checked by pagesFast, which the scan uses)
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
      .cb-auto-sp{flex:1}
      .cb-auto-effall{font:800 15px system-ui,sans-serif;color:#059669;margin-left:6px}
      .cb-auto-effall small,.cb-auto-eff small{font-weight:500;font-size:10.5px;color:#64748b}
      .cb-auto-eff{font:700 12.5px system-ui,sans-serif;color:#059669;margin:0 8px;white-space:nowrap}
      .cb-tabq{display:inline-flex;align-items:center;margin-left:4px}
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
            <div class="cb-topbtns"><select class="cb-sel cb-snzsel" title="Snoozed picklists">${Object.entries(SNZ_MODES).map(([k, l]) => `<option value="${k}"${k === snoozeMode ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="cb-btn cb-shopbtn">Shops (0)</button><button class="cb-btn cb-scan">Scan</button>${conf.openSettings ? '<button class="cb-btn cb-gear" title="Settings for this tab">⚙</button>' : ''}<button class="cb-btn cb-x">✕</button></div>
          </div>
          <div id="cb-shops">
            <input type="text" placeholder="Search shop…">
            <div class="cb-chips"></div>
            <div class="cb-shops-act"><button class="cb-btn cb-all">All</button><button class="cb-btn cb-none">None</button></div>
          </div>
          <div class="cb-tabs"><button class="cb-tab on" data-tab="single">Per combo</button><button class="cb-tab" data-tab="grouped">Grouped batch</button><button class="cb-tab" data-tab="opt">Optimized batches</button><button class="cb-tab" data-tab="iso">Isolated</button><span class="cb-tabq"></span></div>
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
    let optShow = !!store.get('cb_opt_show', false); // the batches themselves: hidden, people + on/off is enough
    // efficiency per person today: picklists per different product (SKU) of the batches auto batch gave them
    const effDay = () => new Date().toISOString().slice(0, 10);
    function effGet() { const e = store.get('cb_auto_eff', null); return e && e.day === effDay() ? e : { day: effDay(), by: {} }; }
    function effAdd(uid, pl, sku) { const e = effGet(); const r = (e.by[uid] = e.by[uid] || { b: 0, pl: 0, sku: 0 }); r.b++; r.pl += pl; r.sku += sku; store.set('cb_auto_eff', e); }
    const effTxt = (r) => (r && r.sku ? (r.pl / r.sku).toFixed(1).replace('.', ',') : '–');
    let gAssign = String(store.get('cb_gassign', '') || '');

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
    const TAB_HELP = {
      single: 'Picklists with exactly the same products, per shop. Create batch = 1 batch of that combo.',
      grouped: 'Tick combos, put them in order, Create MEGAMULTI → 1 batch with every ticked combo after each other, named MEGAMULTI and given to who you pick. A comment marks every switch to the next combo.',
      opt: 'Auto batch: add people and turn it on. When someone has picked everything of their batch, they get the next one by themselves (fewest different products, BE pick-up last). Named BELGIE / MIX / NON BELGIE.\nEfficiency = picklists per different product (SKU) in their batches today. Higher = less walking.',
      iso: 'Picklists with a container that are not in a batch, picklists that are half picked, and picklists parked (ZAP / DAYSON / error person) for more than a day.',
    };
    function showTab(name) {
      tab = ['single', 'grouped', 'opt', 'iso'].includes(name) ? name : 'single';
      panel.querySelectorAll('.cb-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
      $single.style.display = tab === 'single' ? '' : 'none';
      $grouped.style.display = tab === 'grouped' ? '' : 'none';
      $opt.style.display = tab === 'opt' && optShow ? '' : 'none';
      $auto.style.display = tab === 'opt' ? '' : 'none';
      $iso.style.display = tab === 'iso' ? '' : 'none';
      $snz.style.display = tab === 'iso' ? 'none' : ''; // the isolated check always takes only active picklists
      store.set('cb_tab', tab);
      const q = panel.querySelector('.cb-tabq');
      if (q) q.innerHTML = helpBtn(TAB_HELP[tab]);
      renderAuto();
      if (tab === 'opt') renderOpt();
      if (tab === 'iso') { renderIso(); if (isOpen() && !isoBusy && (!isoData || Date.now() - isoAt > 5 * 60000)) isoCheck(); }
    }
    panel.querySelectorAll('.cb-tab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
    const gear = panel.querySelector('.cb-gear');
    if (gear) gear.onclick = () => conf.openSettings(tab);
    // first tab only once everything below exists (the Optimized / Isolated tab use things defined further down)
    const firstTab = store.get('cb_tab', 'single');
    $grouped.style.display = $opt.style.display = $auto.style.display = $iso.style.display = 'none';
    setTimeout(() => showTab(firstTab), 0);

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
        if (ids.length > 4) {
          // many shops: all open picklists in pages of 100 (4 at a time) and keep the chosen shops = way fewer calls
          const want = new Set(ids.map(String));
          for (const st of sts) {
            const list = await pagesFast(`/picklists?status=${st}`, (n) => { counts.set(`all|${st}`, n); prog(); });
            all.push(...list.filter((pl) => pl.status === st && want.has(String(pl.idfulfilment_customer))));
          }
        } else {
          await pool(ids, 3, async (id) => {
            for (const st of sts) {
              const list = await paginate(`/picklists?idfulfilment_customer=${id}&status=${st}`, (n) => { counts.set(`${id}|${st}`, n); prog(); });
              all.push(...list);
            }
          });
        }

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
    // isoStop: declared at the top (scan uses pagesFast too)
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
        setProg(`${open.length} open · ${inBatch} in a batch · containers…`);
        // 1 call per picklist without a batch (Picqer has tens of thousands of containers, so reading them all is slower)
        await pool(free, 6, async (pl) => {
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
        // half picked (something picked, not everything) and parked (zap / dayson / error person) for more than a day
        const tot = (pl) => +(pl.totalproducts ?? pl.total_products ?? 0) || (pl.products || []).reduce((n, p) => n + (+p.amount || 0), 0);
        const got = (pl) => +(pl.totalpicked ?? pl.total_picked ?? 0) || (pl.products || []).reduce((n, p) => n + (+p.amount_picked || 0), 0);
        const ageMs = (pl) => Date.now() - Date.parse(String(pl.updated || pl.created || '').replace(' ', 'T'));
        const half = open.filter((pl) => { const g = got(pl), t = tot(pl); return g > 0 && g < t; })
          .sort((a, b) => ageMs(b) - ageMs(a)).map((pl) => ({ pl, got: got(pl), tot: tot(pl) }));
        const parked = open.filter((pl) => pl.assigned_to_iduser != null && SKIP_USERS.includes(String(pl.assigned_to_iduser)) && ageMs(pl) > 86400000)
          .sort((a, b) => ageMs(b) - ageMs(a));
        isoData = { list, half, parked, nOpen: open.length, nInBatch: inBatch, nChecked: k, nFree: free.length, stopped: isoStop, wh: wid ? whNameOf(wid) : '' };
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
      if (isoData && !isoBusy) {
        const pRow = (pl, extra) => `<div class="cb-row cb-isorow"><div class="cb-items"><div><a href="/picklists/${pl.idpicklist}" target="_blank"><b>${esc(pl.picklistid || pl.idpicklist)}</b></a> · ${esc(shopName(pl.idfulfilment_customer))}</div>
          <small>${extra}${pl.created ? ` · made ${ageOf(pl.created)} ago` : ''}${pl.assigned_to_iduser ? ` · ${esc(userName(pl.assigned_to_iduser))}` : ''}${pl.idpicklist_batch ? ' · in a batch' : ''}</small></div>
          <a class="cb-go" href="/picklists/${pl.idpicklist}" target="_blank">Open</a></div>`;
        const half = isoData.half || [], parked = isoData.parked || [];
        html += `<section class="cb-card" style="--c:#f97316;--t:#f9731614"><header class="cb-card-hd"><span class="cb-dot"></span><b>Half picked</b><small>${half.length} · something picked, not everything</small></header>
          ${half.map((x) => pRow(x.pl, `<b>${x.got}/${x.tot}</b> picked`)).join('') || '<div class="cb-empty">none</div>'}</section>`;
        html += `<section class="cb-card" style="--c:#64748b;--t:#64748b14"><header class="cb-card-hd"><span class="cb-dot"></span><b>Parked for more than a day</b><small>${parked.length} · ZAP / DAYSON / error person</small></header>
          ${parked.map((pl) => pRow(pl, 'parked')).join('') || '<div class="cb-empty">none</div>'}</section>`;
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
          <div class="cb-acts"><select class="cb-sel cb-gassign" title="Who picks this MEGAMULTI">${assignOptions(gAssign)}</select><button class="cb-btn" data-act="opt">Optimize order</button><button class="cb-go" data-act="create">Create MEGAMULTI</button></div></div>
      </div>`;
      $grouped.innerHTML = html;
      $grouped.querySelectorAll('[data-ind="1"]').forEach((el) => (el.indeterminate = true));
      if (!users && !usersErr && !usersJob) loadUsers().then(() => { const sel = $grouped.querySelector('.cb-gassign'); if (sel) sel.innerHTML = assignOptions(gAssign); });
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

    $grouped.addEventListener('change', (e) => {
      if (e.target.matches('.cb-gassign')) { gAssign = e.target.value; store.set('cb_gassign', gAssign); }
    });
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
        await nameBatch(batchId, 'MEGAMULTI');
        if (gAssign) {
          try { await apiRetry('POST', `/picklists/batches/${batchId}/assign`, { iduser: Number(gAssign) }); log(`→ assigned to ${userName(gAssign)}`); }
          catch (e) { log(`⚠ assign failed: ${String(e.message).slice(0, 100)}`); }
        }
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
    // optimizer batches get a name: BELGIE (only BE pick-up), NON BELGIE (none), MIX
    const beTitle = (ms) => { const n = ms.filter(isBeM).length; return n === 0 ? 'NON BELGIE' : n === ms.length ? 'BELGIE' : 'MIX'; };
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
            if (k % 3 === 0) await sleep(0); // let the page breathe, without waiting for nothing
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

    function assignOptions(cur = assignee) {
      let o = `<option value="">${users ? 'Assign to nobody' : usersErr ? 'Assign to nobody (users not loaded)' : 'Loading users…'}</option>`;
      if (cur && !(users || []).some((u) => u.id === cur)) o += `<option value="${esc(cur)}" selected>${esc(userName(cur))}</option>`;
      for (const u of users || []) o += `<option value="${esc(u.id)}" ${u.id === cur ? 'selected' : ''}>${esc(u.name)}</option>`;
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
        await nameBatch(batch.idpicklist_batch, beTitle(plan.keep));
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
          await nameBatch(batch.idpicklist_batch, beTitle(b.ms));
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
      nameBatch(id, beTitle(seq));
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
        effAdd(uid, nIn, nSku);
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
        const ef = effGet().by[uid];
        return `<div class="cb-auto-p"><span class="cb-auto-dot ${cls}"></span><b>${esc(userName(uid))}</b>` +
          `<span class="cb-auto-eff" title="${ef ? `${ef.b} batches · ${ef.pl} picklists · ${ef.sku} SKUs today` : 'no batches yet today'}">${effTxt(ef)}<small>/SKU</small></span>` +
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
      const all = Object.values(effGet().by).reduce((t, r) => ({ b: t.b + r.b, pl: t.pl + r.pl, sku: t.sku + r.sku }), { b: 0, pl: 0, sku: 0 });
      $auto.innerHTML = `<div class="cb-auto${autoOn ? ' on' : ''}">
        <div class="cb-auto-hd"><b>Auto batch</b>${autoOn ? '<span class="cb-auto-live">ON</span>' : ''}
          <span class="cb-auto-effall" title="${all.b} batches today">${effTxt(all)}<small> picklists / SKU</small></span>
          <span class="cb-auto-sp"></span>
          ${beSelect()}${whSel}<button class="cb-btn" data-act="optshow" title="the batches themselves + log">${optShow ? 'Hide batches' : 'Batches'}</button><button class="${autoOn ? 'cb-btn cb-auto-stop' : 'cb-go'}" data-act="autotoggle">${autoOn ? 'Turn off' : 'Turn on'}</button></div>
        <div class="cb-auto-people">${people || '<div class="cb-muted">add who gets batches</div>'}<div class="cb-auto-add">${addSel}</div></div>
        ${notes.join('')}${optShow && logHtml ? `<div class="cb-auto-log">${logHtml}</div>` : ''}
      </div>`;
    }

    $auto.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      if (el.dataset.act === 'autotoggle') autoToggle();
      else if (el.dataset.act === 'optshow') { optShow = !optShow; store.set('cb_opt_show', optShow); showTab('opt'); }
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

  /* =========================================================================
   *  AUTO PRINT + AUTO NEXT (was "Picqer Automation Suite")
   *  After a shipment, also when Picqer refreshes the page to "Gesloten": print
   *  the label, then go to the next picklist of the batch. Double letters first,
   *  then Picqer's > in the batch bar. A = pick all, N or ▶ = next by hand.
   * ========================================================================= */
  function autoNext() {
    if (!PATH.startsWith('/picklists')) return;
    const C = CFG.autoNext;
    const STATUS = 'Zending succesvol aangemaakt';
    const PROCESSED_MIN = 3;          // "Verwerkt op ... door <you>" this recent counts as just made
    const LS_ON = 'pqsuite_autonext_on_v1';
    const pickKey = String(C.pickAllKey || 'a').toLowerCase();
    let isProcessing = false;
    const enabled = C.goNext !== false; // Shift+8 -> Auto print + auto next
    let rowsPromise = null, flashAtLoad = new Set(), arrival = null, pendingWarn = null;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const nm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const P_RE = /P\d{4}-\d+/;
    const ss = {
      get: (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
      set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} },
      del: (k) => { try { sessionStorage.removeItem(k); } catch (_) {} },
    };
    const idOf = (u) => { try { return (new URL(u, location.href).pathname.match(/^\/picklists\/(\d+)\/?$/) || [])[1] || null; } catch (_) { return null; } };
    const PID = picklistPageId();
    // the old separate script still installed? then stay passive so nothing prints twice
    const oldScript = () => !!document.getElementById('picqer-auto-toolbar');

    // no bar at the top anymore: warnings + the end of a batch show as a small toast bottom left
    function setInfo(txt, warn, loud) {
      if (!txt) return;
      console.log('[auto-next]', txt);
      if (!warn && !loud) return;
      if (setInfo.last === txt && Date.now() - setInfo.at < 8000) return; // same message again: once is enough
      setInfo.last = txt; setInfo.at = Date.now();
      let box = document.getElementById('pq-an-toast');
      if (!box) {
        box = document.createElement('div');
        box.id = 'pq-an-toast';
        box.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483646;display:flex;flex-direction:column;gap:6px;pointer-events:none;';
        document.body.appendChild(box);
      }
      const el = document.createElement('div');
      el.style.cssText = `background:${warn ? '#7c2d12' : '#22242b'};color:#fff;font:600 13px/1.4 Arial,sans-serif;padding:9px 14px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:380px;`;
      el.textContent = txt;
      box.appendChild(el);
      setTimeout(() => el.remove(), warn ? 6000 : 3000);
    }

    // ---------- this page ----------
    const currentRef = () => { const m = nm(document.querySelector('h1')?.textContent).match(P_RE) || document.title.match(P_RE); return m ? m[0] : null; };
    const myName = () => nm(document.querySelector('.layout-header-account .d-mobile-none')?.childNodes[0]?.textContent).toLowerCase();
    const isClosed = () => !!document.querySelector('.label-picklist-closed') || /\b(Gesloten|Closed)\b/.test(nm(document.querySelector('h1.page-title, h1')?.textContent));
    const batchNav = () => document.querySelector('.part-of-batch__batch-navigation');
    const currentLetter = () => (nm(batchNav()?.textContent).match(/Alias\s+([A-Z]+)/i) || [])[1] || null;
    function usable(a) {
      if (!a || a.classList.contains('disabled') || a.getAttribute('aria-disabled') === 'true') return null;
      const id = idOf(a.getAttribute('href') || '');
      return id && id !== PID ? a.href : null;
    }
    const batchArrow = () => usable(batchNav()?.querySelector('.fa-chevron-right')?.closest('a'));
    const headerArrow = () => usable(document.querySelector('.navigation-btn-group .fa-chevron-right')?.closest('a'));
    function liveBatchId() {
      for (const a of document.querySelectorAll('.part-of-batch a[href*="/picklists/batches/"]')) {
        const m = (a.getAttribute('href') || '').match(/\/picklists\/batches\/(\d+)/);
        if (m) return m[1];
      }
      return null;
    }

    // batch + letter + next arrow are saved while the picklist is open, so they are known after the refresh
    const CTX = 'an_ctx_' + PID, DONE = 'an_done_' + PID;
    let lastCtx = '';
    function saveCtx() {
      if (!PID || isClosed()) return;
      const c = { batchId: liveBatchId(), letter: currentLetter(), arrow: batchArrow() };
      const s = JSON.stringify(c);
      if (s === lastCtx) return;
      lastCtx = s;
      ss.set(CTX, JSON.stringify({ ...c, t: Date.now() }));
    }
    function savedCtx() { try { return JSON.parse(ss.get(CTX) || 'null'); } catch (_) { return null; } }
    function ctx() {
      const s = savedCtx() || {};
      return { batchId: liveBatchId() || s.batchId || null, letter: currentLetter() || s.letter || null, arrow: batchArrow() || s.arrow || null, header: headerArrow() };
    }
    const wasHandled = () => !!ss.get(DONE);
    const markHandled = () => ss.set(DONE, String(Date.now()));
    function prune() {
      try {
        const cut = Date.now() - 12 * 3600e3;
        for (let k = sessionStorage.length - 1; k >= 0; k--) {
          const key = sessionStorage.key(k);
          if (!/^an_(ctx|done)_/.test(key || '')) continue;
          const v = sessionStorage.getItem(key);
          let t = 0;
          if (key.startsWith('an_done_')) t = +v || 0;
          else { try { t = JSON.parse(v).t || 0; } catch (_) {} }
          if (t < cut) sessionStorage.removeItem(key);
        }
      } catch (_) {}
    }

    // ---------- was a shipment just made? ----------
    const FLASH_SEL = '.alert-success, .alert, [role="alert"], .toast, .notification, .flash, [class*="toast"]';
    const flashEls = () => [...document.querySelectorAll(FLASH_SEL)].filter((el) => (el.textContent || '').includes(STATUS));
    let procCache = null;
    function processed() {
      if (procCache) return procCache;
      const txt = nm(document.querySelector('.header-subtitle')?.textContent);
      const m = txt.match(/(?:Verwerkt op|Processed on)\s+(\d{1,2})-(\d{1,2})-(\d{4}),?\s+(?:om\s+|at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?(?:\s+(?:door|by)\s+(.+))?/i);
      if (!m) return null;
      const by = nm(m[6]).toLowerCase().split(/\s+(?:vanuit|from|toegewezen|assigned)\b/)[0].trim();
      procCache = { at: new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime(), by };
      return procCache;
    }
    function processedInfo() {
      const p = processed();
      if (!p) return { recent: false, byMe: false, byOther: false };
      const age = Date.now() - p.at, me = myName(), known = !!p.by && !!me;
      const byMe = known && (p.by === me || p.by.includes(me) || me.includes(p.by));
      return { recent: age > -2 * 60000 && age < PROCESSED_MIN * 60000, byMe, byOther: known && !byMe };
    }
    function shipmentJustMade() {
      if (!PID || wasHandled()) return null;
      const closed = isClosed();
      const flashes = flashEls();
      if (flashes.some((el) => !flashAtLoad.has(el)) && (closed || getShipmentId())) return 'shipment made';
      if (!closed) return null;
      if (flashes.length && !arrival) return 'shipment made';
      const p = processedInfo();
      if (p.byOther) return null;                       // someone else did it
      if (savedCtx()) return 'picklist closed';         // it was open in this tab, now closed
      if (p.byMe && p.recent) return 'picklist closed'; // you processed it just now
      return null;
    }

    // ---------- label ----------
    function getShipmentId() {
      const tag = document.getElementById('bundle-script-tag-picqer-picklists-show');
      if (tag) {
        try {
          const m = JSON.parse(tag.getAttribute('data-params'))?.createShipmentBackgroundActionStartUrl?.match(/shipment=(\d+)/);
          if (m && +m[1] > 0) return m[1];
        } catch (_) {}
      }
      let best = null;
      for (const a of document.querySelectorAll('a[href*="/shipments/"]')) {
        let u;
        try { u = new URL(a.getAttribute('href'), location.href); } catch (_) { continue; }
        if (u.host !== location.host) continue;
        const m = u.pathname.match(/\/shipments\/(\d+)/);
        if (m && (!best || +m[1] > +best)) best = m[1];
      }
      if (best) return best;
      const ids = [...document.documentElement.innerHTML.matchAll(/\/picklists\/shipments\/(\d+)/g)].map((x) => +x[1]).filter((n) => n > 0);
      return ids.length ? String(Math.max(...ids)) : null;
    }
    async function waitShipmentId(ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const id = getShipmentId(); if (id) return id; await wait(250); }
      return null;
    }
    async function printLabel(shipmentId) {
      try {
        const r = await fetch(`/picklists/shipments/${shipmentId}/printlabel`, {
          method: 'POST', credentials: 'same-origin', headers: jsonHeaders(),
          body: JSON.stringify({ amount: 1, printer_id: C.printerId || '', idpicklist_shipment: shipmentId }),
        });
        return r.ok;
      } catch (_) { return false; }
    }

    // ---------- batch page ----------
    const actionOf = (row) => [...row.querySelectorAll('a,button')].find((b) => /^(verwerk|process)$/i.test(nm(b.textContent)));
    function rowHref(row) {
      const links = [...row.querySelectorAll('a[href]')];
      const a = links.find((l) => P_RE.test(l.textContent) && idOf(l.getAttribute('href'))) || links.find((l) => idOf(l.getAttribute('href')));
      return a ? a.getAttribute('href') : null;
    }
    function aliasOf(row) {
      const tag = nm(row.querySelector('.picklist-alias')?.textContent);
      if (tag) return tag.split(' ')[0];
      const cell = [...row.querySelectorAll('td')].map((td) => nm(td.textContent)).find((t) => /^[A-Z]{1,3}$/.test(t));
      if (cell) return cell;
      const first = nm(row.querySelector('td')?.textContent).split(' ')[0];
      return /^[A-Z]{1,3}$/i.test(first) ? first : '';
    }
    function parseRows(doc) {
      let rows = [...doc.querySelectorAll('.batch-picklists-table tbody tr')];
      if (!rows.length) rows = [...doc.querySelectorAll('tbody tr')];
      rows = rows.filter((r) => P_RE.test(r.textContent) && rowHref(r));
      const anyAction = rows.some((r) => actionOf(r));
      return rows.map((r) => {
        const href = rowHref(r);
        const green = r.classList.contains('picklist-closed') || r.classList.contains('success') || r.classList.contains('table-success');
        return {
          id: idOf(href), ref: (r.textContent.match(P_RE) || [])[0], alias: aliasOf(r), url: new URL(href, location.href).href,
          open: !(green || (anyAction ? !actionOf(r) : /Verwerkt|Compleet|Geannuleerd/.test(r.textContent))),
        };
      });
    }
    async function loadRows(batchId) {
      if (!batchId) return null;
      try {
        const r = await fetch(`/picklists/batches/${batchId}`, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
        if (!r.ok) return null;
        const rows = parseRows(new DOMParser().parseFromString(await r.text(), 'text/html'));
        return rows.length ? rows : null;
      } catch (_) { return null; }
    }

    // ---------- next ----------
    function go(url, info, seen) {
      setInfo(info);
      ss.set('an_chain', JSON.stringify({ t: Date.now(), to: idOf(url), seen: [...seen, PID].slice(-80) }));
      if (pendingWarn) ss.set('an_warn', pendingWarn);
      location.assign(url);
    }
    function stop(info) {
      if (pendingWarn) setInfo(`${info} · ⚠ ${pendingWarn}`, true); else setInfo(info);
      isProcessing = false;
    }
    function takeChain() {
      let ch = null;
      try { ch = JSON.parse(ss.get('an_chain') || 'null'); } catch (_) {}
      ss.del('an_chain');
      return ch && ch.to === PID && Date.now() - ch.t < 20000 ? ch : null;
    }
    async function goNext(seen) {
      if (!PID) return stop('open a picklist first');
      const c = ctx();
      if (c.batchId && !rowsPromise) rowsPromise = loadRows(c.batchId);
      const rows = rowsPromise ? await Promise.race([rowsPromise, wait(2500).then(() => null)]) : null;
      const myRef = currentRef();
      const isMe = (p) => p.id === PID || (!!myRef && p.ref === myRef);
      const ok = (p) => p.open && !isMe(p) && !seen.includes(p.id);
      const i = rows ? rows.findIndex(isMe) : -1;
      const pick = (f) => !rows ? null : i < 0 ? (rows.find(f) || null) : (rows.slice(i + 1).find(f) || rows.slice(0, i).find(f) || null);
      if (c.letter) { // 1) same letter still open (the doubles: G, G, G)
        const L = c.letter.toUpperCase();
        const dup = pick((p) => ok(p) && p.alias.toUpperCase() === L);
        if (dup) return go(dup.url, `→ ${dup.alias} ${dup.ref} (same letter)`, seen);
      }
      if (c.arrow && !seen.includes(idOf(c.arrow))) { // 2) next letter = Picqer's > in the batch bar
        const row = rows && rows.find((p) => p.id === idOf(c.arrow));
        if (!row || row.open) return go(c.arrow, `→ next letter${row && row.alias ? ' ' + row.alias : ''}`, seen);
      }
      if (rows) { // 3) next one in the batch that is still open
        const nx = pick(ok);
        if (nx) return go(nx.url, `→ ${nx.alias} ${nx.ref}`, seen);
        setInfo('batch done ✓', false, true);
        return stop('batch done ✓');
      }
      if (!c.batchId && !c.letter && c.header && !seen.includes(idOf(c.header))) return go(c.header, '→ next', seen); // 4) no batch
      return stop(c.batchId || c.letter ? 'end of batch' : 'no next found');
    }

    async function printAndNext(why) {
      if (isProcessing) return;
      if (oldScript()) { setInfo('old "Picqer Automation Suite" still installed · delete it in Tampermonkey', true); return; }
      isProcessing = true;
      markHandled(); // never twice for the same picklist in this tab
      setInfo('✓ ' + why);
      const c = ctx();
      if (enabled && c.batchId && !rowsPromise) rowsPromise = loadRows(c.batchId); // load the batch while the label prints
      if (C.printLabel) {
        const shipmentId = await waitShipmentId(2500);
        if (shipmentId) {
          setInfo('printing label…');
          if (!(await printLabel(shipmentId))) pendingWarn = `${currentRef() || PID}: label print failed`;
        } else pendingWarn = `${currentRef() || PID}: no shipment found, label not printed`;
      }
      if (!enabled) return stop(pendingWarn ? 'auto next off' : C.printLabel ? 'label printed' : 'auto next off');
      if (pendingWarn) setInfo('⚠ ' + pendingWarn, true);
      await wait(+C.delayMs || 0);
      await goNext([]);
    }
    function check() {
      if (isProcessing) return;
      const why = shipmentJustMade();
      if (why) printAndNext(why);
    }

    // ---------- went back on purpose (< in the batch bar or the header, or the browser back button) ----------
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || !a.querySelector('.fa-chevron-left, .fa-angle-left, .fa-arrow-left')) return;
      const id = idOf(a.getAttribute('href') || '');
      if (id) ss.set('an_back', id);
    }, true);
    const cameBack = () => {
      const b = ss.get('an_back');
      if (b && b === PID) return true;
      try { return ['back_forward', 'reload'].includes((performance.getEntriesByType('navigation')[0] || {}).type); } catch (_) { return false; }
    };

    // ---------- true pick all ----------
    // clicks Picqer's own ✓ (pick this line) on every line, like picking by hand, so Picqer opens its
    // "Zending maken" popup itself (we don't touch that popup)
    // what is left on a line: the "1 / 1" text Picqer shows (its data-amount attributes don't always update)
    const lineLeft = (it) => {
      const m = nm(it.querySelector('.product-pick-status')?.textContent).match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return +m[2] - +m[1];
      const num = (el) => +(nm(el?.textContent) || el?.dataset.amount || 0);
      return num(it.querySelector('.amount')) - num(it.querySelector('.amount-picked'));
    };
    const lineBtn = (it) => { const b = it.querySelector('button.product-pick-all'); return b && !b.disabled ? b : null; };
    const openLines = () => [...document.querySelectorAll('.picklist-product-list__item')].filter((it) => lineLeft(it) > 0 && lineBtn(it));
    // Picqer's own pick calls (the ✓ sends POST /api/v1/picklists/<id>/pick): we watch their answers, so we go
    // 1 line at a time, only after Picqer said OK. Too fast = Picqer's rate limit (429) and the line is NOT picked
    const pickNet = { n: 0, status: 0 };
    try {
      const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__pqPick = /post/i.test(m) && /\/picklists\/\d+\/pick\/?(\?|$)/.test(String(u)); return XO.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        if (this.__pqPick) this.addEventListener('loadend', () => { pickNet.n++; pickNet.status = this.status; });
        return XS.apply(this, arguments);
      };
    } catch (_) {}
    async function pickByLines() {
      for (let guard = 0; guard < 300; guard++) {
        const it = openLines()[0];
        if (!it) return 'done';
        const code = it.dataset.productcode || 'a line';
        const before = lineLeft(it), n0 = pickNet.n;
        lineBtn(it).click();
        const t0 = Date.now();
        while (Date.now() - t0 < 2500 && pickNet.n === n0) await wait(50); // Picqer's answer to this pick
        if (pickNet.n !== n0 && pickNet.status && (pickNet.status < 200 || pickNet.status >= 300)) {
          setInfo(pickNet.status === 429 ? `Picqer: too many requests · ${code} not picked · page reloads, press A again in a few sec`
            : `Picqer said no (HTTP ${pickNet.status}) to ${code} · page reloads`, true);
          setTimeout(() => location.reload(), 3000); // show what really got picked
          return 'error';
        }
        if (pickNet.n === n0) { // never saw the call: go by the line itself
          if (it.isConnected && lineLeft(it) === before && lineBtn(it)) { setInfo(`pick all: ${code} did not get picked`, true); return 'error'; }
          await wait(800);
        }
        await wait(450); // about as fast as picking by hand
      }
      return 'done';
    }

    async function truePickAll() {
      if (!PID) return setInfo('open a picklist first', true);
      if (isClosed()) return setInfo('this picklist is closed', true);
      if (openLines().length) { // the normal way: Picqer's own buttons
        isProcessing = true;
        setInfo('picking everything…', false, true);
        const res = await pickByLines();
        isProcessing = false;
        if (res === 'done') setInfo('everything picked ✓', false, true); // Picqer opens its own "Zending maken" popup
        return;
      }
      if ([...document.querySelectorAll('.picklist-product-list__item')].length && ![...document.querySelectorAll('.picklist-product-list__item')].some((it) => lineLeft(it) > 0)) {
        return setInfo('everything is picked already', false, true);
      }
      // no pick buttons on this page: Picqer's pick call per location, then reload
      setInfo('picking everything…', false, true);
      let pl;
      try {
        const r = await fetch(`/api/v1/picklists/${PID}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        pl = await r.json();
      } catch (e) { return setInfo(`pick all: could not read the picklist (${e.message})`, true); }
      const todo = [];
      let noLoc = 0;
      for (const p of pl.products || []) {
        const left = (+p.amount || 0) - (+(p.amount_picked != null ? p.amount_picked : p.amountpicked) || 0);
        if (left <= 0) continue;
        const locs = (p.pick_locations || []).filter((l) => (+l.amount || 0) - (+l.amount_picked || 0) > 0);
        if (!locs.length) { if (!p.has_parts) noLoc++; continue; } // a set (has_parts) gets picked through its parts
        for (const l of locs) todo.push({ id: l.idpicklist_product_location, amount: (+l.amount || 0) - (+l.amount_picked || 0), code: p.productcode });
      }
      if (!todo.length) return setInfo(noLoc ? `nothing to pick here (${noLoc} without a location)` : 'everything is picked already', !!noLoc, true);
      let ok = 0;
      const bad = [];
      for (const t of todo) {
        try {
          const r = await fetch(`/api/v1/picklists/${PID}/pick`, { method: 'POST', credentials: 'same-origin', headers: jsonHeaders(),
            body: JSON.stringify({ idpicklist_product_location: t.id, amount: t.amount }) });
          if (r.ok) ok++; else bad.push(`${t.code} (HTTP ${r.status})`);
        } catch (_) { bad.push(`${t.code} (no connection)`); }
      }
      if (bad.length || noLoc) setInfo(`picked ${ok}/${todo.length}${bad.length ? ` · not: ${bad.join(', ')}` : ''}${noLoc ? ` · ${noLoc} without a location` : ''}`, true);
      else setInfo(`picked all ${ok} ✓`, false, true);
      setTimeout(() => location.reload(), bad.length ? 2500 : 400);
    }

    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (document.getElementById('pqs-ov') || document.getElementById('zaplog-ov') || document.getElementById('ca-ov')) return;
      const cb = document.getElementById('cb-overlay');
      if (cb && cb.style.display === 'flex') return;
      const k = (e.key || '').toLowerCase();
      if (k !== pickKey) return;
      // a scanner typing an "a" in a barcode is not you pressing A
      loneKey(e, () => {
        if (can('truePickAll') && PID) {
          if (isProcessing) return;
          truePickAll();
          return;
        }
        const btn = document.querySelector('.pick-all-button');
        if (!btn) return;
        if (!can('pickAll') || btn.disabled || btn.dataset.pqLock) { setInfo('Pick alles is not for your team'); return; }
        btn.click();
      });
    });

    if (!PID) return; // batch page, singles etc: only the A key
    prune();
    arrival = takeChain();
    const warn = ss.get('an_warn');
    const c0 = ctx();
    setInfo(isClosed() ? (wasHandled() ? 'done · ▶ = next' : 'closed') : c0.letter ? `letter ${c0.letter}` : c0.batchId ? 'in batch' : 'no batch');
    if (warn) { ss.del('an_warn'); setInfo('⚠ ' + warn, true); }
    const back = cameBack();
    if (ss.get('an_back') === PID) ss.del('an_back');
    if (isClosed() && arrival && !back) { // we jumped here ourselves but this one is done already: keep going
      const seen = arrival.seen || [];
      if (seen.includes(PID) || seen.length >= 60) { setInfo('went round the batch · stopped', true); return; }
      isProcessing = true;
      setInfo('already done → skipping');
      setTimeout(() => goNext(seen), 300);
      return;
    }
    saveCtx();
    flashAtLoad = new Set(flashEls());
    let t = null;
    new MutationObserver(() => {
      if (t || isProcessing) return;
      t = setTimeout(() => { t = null; saveCtx(); check(); }, 300);
    }).observe(document.body, { subtree: true, childList: true }); // elements only: text ticking on the page is no reason to look
    setTimeout(check, 600); // a moment later, so an old copy of the script shows up first if it is still installed
    setTimeout(check, 2000);
    // opened a picklist that is closed already (Gesloten) inside a batch: straight to the next one,
    // unless you went back to it on purpose, or it was just processed here (then the label goes first)
    if (enabled && C.skipClosed !== false && isClosed() && !back) {
      setTimeout(() => {
        if (isProcessing || shipmentJustMade()) return;
        const c = ctx();
        if (!c.batchId && !c.letter) return; // not in a batch: stay
        isProcessing = true;
        setInfo('closed → next', false, true);
        goNext([]);
      }, 750);
    }
  }

  /* =========================================================================
   *  PRODUCT COLORS (was "Picqer Card Color")
   *  Picklist lines get a colored bar when their PRODUCT CODE matches exactly
   *  (GLW-MASKER-75 does not match GLW-MASKER-750), plus a "2x" badge when more
   *  than 1. Colors: shared colors.js on GitHub + this PC's own (Shift+8 -> Colors),
   *  this PC's win.
   * ========================================================================= */
  const LS_COLORS_LOCAL = 'pqsuite_colors_local_v1';
  const okColor = (v) => /^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]{3,20}$/i.test(v) || /^(rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/i.test(v);
  const codeKey = (s) => String(s || '').trim().toUpperCase();
  function localColors() {
    let c = lsGet(LS_COLORS_LOCAL, null);
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      // first time: take over product codes the old Card Color script had on this PC
      // (names like "Testo Charge" are skipped, colors match on the exact code now)
      c = {};
      const old = lsGet('picqer_custom_colors', null);
      const shared = COLORS_SRC.data || {};
      if (old && typeof old === 'object') {
        for (const [k, v] of Object.entries(old)) if (k && !/\s/.test(k.trim()) && typeof v === 'string' && shared[k] !== v) c[k.trim()] = v;
      }
      lsSet(LS_COLORS_LOCAL, c);
    }
    return c;
  }
  // product code (upper case) -> color, this PC first
  function colorMap() {
    const map = new Map();
    for (const [k, v] of Object.entries(localColors())) if (codeKey(k) && okColor(v)) map.set(codeKey(k), v);
    for (const [k, v] of Object.entries(COLORS_SRC.data || {})) if (codeKey(k) && okColor(v) && !map.has(codeKey(k))) map.set(codeKey(k), v);
    return map;
  }
  // product code of a picklist line: data-productcode, else the code link at the top of the line
  const lineCode = (item) => (item.getAttribute('data-productcode') || item.querySelector('.picklist-product-list__item__label a')?.textContent || '').trim();
  const colorsChanged = () => window.dispatchEvent(new CustomEvent('pq-colors'));

  function cardColor() {
    if (!PATH.startsWith('/picklists')) return;
    const C = CFG.cardColor;
    addStyle('pq-cc-style', `.pq-cc-badge{position:absolute;left:-32px;top:50%;transform:translateY(-50%);background:#333;color:#fff;font-weight:700;font-size:13px;
      padding:3px 6px;border-radius:4px;box-shadow:1px 1px 4px rgba(0,0,0,.2);z-index:99;border:1px solid #fff;pointer-events:none}`);
    function paint() {
      const map = colorMap();
      document.querySelectorAll('.picklist-product-list__item').forEach((item) => {
        const code = lineCode(item);
        const color = flagOff('cardColor') ? '' : (code && map.get(codeKey(code))) || ''; // exact product code only
        const q = item.querySelector('.pickbuttons .amount');
        const qty = q ? parseInt(q.getAttribute('data-amount'), 10) || 1 : 1;
        const want = color && C.qtyBadge && qty > 1 ? `${qty}x` : '';
        const badge = item.querySelector(':scope > .pq-cc-badge');
        // already right? then leave the line alone (no extra page changes)
        if ((item.dataset.pqCc || '') === color && (badge ? badge.textContent : '') === want && (!color || item.style.borderLeft)) return;
        if (badge) badge.remove();
        if (!color) {
          if (item.dataset.pqCc) { item.style.borderLeft = ''; delete item.dataset.pqCc; }
          return;
        }
        item.style.borderLeft = `14px solid ${color}`;
        item.style.position = 'relative';
        item.dataset.pqCc = color;
        if (want) {
          const b = document.createElement('div');
          b.className = 'pq-cc-badge';
          b.textContent = want;
          item.appendChild(b);
        }
      });
    }
    let t = null;
    const later = () => { if (!t) t = setTimeout(() => { t = null; paint(); }, 200); };
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pq-colors', paint);
    window.addEventListener('pq-flags', paint);
    paint();
  }

  // =====================================================================
  //  LEADERBOARD + KING OF THE HILL + 🪙 PANEL (inventory · stats · shop) + SKINS + DROP CRATES
  //  points: multi 2 · single 1,334 · lines with has_parts don't count (their parts do)
  //  colors = points in the last 15 min (nothing extrapolated):
  //    46+ blue · 38+ turquoise · 30+ dark green · 21+ green · 14+ orange · less red
  //  king of the hill = #1 with 21+ points: +20 coins every minute on top. Packing points are coins too.
  //  The middle stop (Cloudflare worker) asks Picqer once a minute for everyone and keeps today, coins,
  //  the king and the skins. Without it every PC asks Picqer itself (then no king, coins or skins).
  // =====================================================================
  // dark: the whole of Picqer goes dark in the skin's colors (th = tint hue, ah/as = accent hue/saturation)
  const SKIN_LOOK = {
    midnight: { bg: 'linear-gradient(90deg,#070b16,#111a33)', accent: '#6366f1', dark: { th: 228, ah: 239, as: '84%', fx: 'none' } },
    forest: { bg: 'linear-gradient(90deg,#064e3b,#065f46)', accent: '#10b981' },
    ocean: { bg: 'linear-gradient(90deg,#0c4a6e,#0e7490)', accent: '#06b6d4' },
    sunset: { bg: 'linear-gradient(90deg,#7c2d12,#be185d)', accent: '#f97316' },
    carbon: { bg: 'repeating-linear-gradient(135deg,#141416 0 6px,#1c1c20 6px 12px)', accent: '#a1a1aa', dark: { th: 240, ah: 240, as: '6%', fx: 'full' } },
    aurora: { bg: 'radial-gradient(circle at 25% 20%,rgba(139,92,246,.45),transparent 50%),linear-gradient(90deg,#120f2e,#0b2a33 55%,#062a22)', accent: '#8b5cf6', dark: { th: 252, ah: 258, as: '90%', fx: 'full' } },
    voidescent: { bg: 'radial-gradient(circle at 50% 50%,transparent 18%,rgba(255,0,52,.6) 21%,transparent 30%),radial-gradient(circle at 50% 50%,#000 20%,transparent 21%),linear-gradient(90deg,#08080b,#1d040b)', accent: '#ff0034', dark: { th: 345, ah: 348, as: '100%', fx: 'full', stars: true } },
    sakura: { bg: 'linear-gradient(90deg,#831843,#db2777)', accent: '#ec4899' },
    arctic: { bg: 'linear-gradient(90deg,#1e3a5f,#3b82f6)', accent: '#38bdf8' },
    emerald: { bg: 'linear-gradient(90deg,#03140e,#06281c)', accent: '#10b981', dark: { th: 160, ah: 160, as: '84%', fx: 'none' } },
    lava: { bg: 'radial-gradient(circle at 15% 40%,rgba(249,115,22,.35),transparent 50%),linear-gradient(90deg,#1a0703,#3a0d06)', accent: '#f97316', dark: { th: 15, ah: 22, as: '95%', fx: 'none', onAcc: '#140700' } },
    nebula: { bg: 'radial-gradient(circle at 20% 30%,rgba(217,70,239,.4),transparent 45%),radial-gradient(circle at 70% 60%,rgba(59,130,246,.3),transparent 50%),linear-gradient(90deg,#0b0618,#1a0b2e)', accent: '#d946ef', dark: { th: 280, ah: 292, as: '84%', fx: 'full', stars: true } },
    neon: { bg: 'linear-gradient(90deg,#05010f,#1a0530 50%,#03141f)', accent: '#22d3ee', line: '#f0abfc', dark: { th: 250, ah: 188, as: '86%', fx: 'full', onAcc: '#03141a' } },
    gold: { bg: 'linear-gradient(90deg,#120e08,#2a1f0a)', accent: '#d4a017', line: '#fbbf24', dark: { th: 38, ah: 43, as: '81%', fx: 'none' } },
    crown: { bg: 'radial-gradient(circle at 18% 30%,rgba(251,191,36,.3),transparent 45%),linear-gradient(90deg,#120e08,#3f2d0c)', accent: '#d4a017', line: '#fbbf24', crown: true, dark: { th: 38, ah: 43, as: '81%', fx: 'none' } },
    // only from drop crates
    phantom: { bg: 'radial-gradient(circle at 30% 30%,rgba(203,213,225,.32),transparent 50%),linear-gradient(90deg,#06080b,#151c26)', accent: '#94a3b8', line: '#e2e8f0', dark: { th: 215, ah: 205, as: '28%', fx: 'none' } },
    inferno: { bg: 'radial-gradient(circle at 20% 85%,rgba(239,68,68,.6),transparent 50%),radial-gradient(circle at 70% 25%,rgba(251,146,60,.38),transparent 45%),linear-gradient(90deg,#0f0302,#2b0703)', accent: '#ef4444', line: '#fb923c', dark: { th: 5, ah: 10, as: '92%', fx: 'full', onAcc: '#1a0402' } },
    eclipse: { bg: 'radial-gradient(circle at 50% 50%,transparent 18%,rgba(251,191,36,.55) 21%,transparent 30%),radial-gradient(circle at 50% 50%,#000 20%,transparent 21%),linear-gradient(90deg,#05040a,#14101f)', accent: '#fbbf24', line: '#fde68a', dark: { th: 260, ah: 45, as: '95%', fx: 'full', stars: true, onAcc: '#1a1200' } },
    celestial: { bg: 'radial-gradient(circle at 25% 30%,rgba(250,204,21,.38),transparent 45%),radial-gradient(circle at 75% 65%,rgba(99,102,241,.42),transparent 50%),linear-gradient(90deg,#03051a,#0d1240)', accent: '#facc15', line: '#fde68a', dark: { th: 232, ah: 48, as: '96%', fx: 'full', stars: true, onAcc: '#1a1400' } },
  };
  // skins belong to a Picqer account: saved per user id on this PC
  const LS_SKIN = 'pqsuite_skin_v2';
  const skinOf = (uid) => ((lsGet(LS_SKIN, null) || {})[String(uid || '')] || null);
  const skinSave = (uid, id) => { if (!uid) return; const all = lsGet(LS_SKIN, null) || {}; all[String(uid)] = { id: id || null, at: Date.now() }; lsSet(LS_SKIN, all); };

  // ---------- dark skins: the whole of Picqer dark in the skin's colors ----------
  //  skins/dark.css (on GitHub) = every color of Picqer's own CSS turned dark, made from picqer.css, with the
  //  skin's colors as variables. Loaded once a day, kept on this PC. On top: header, glow and movement from here.
  const DARK_LS = 'pqsuite_dark_css_v1';
  const ACC = (pct) => `color-mix(in srgb,var(--acc) ${pct}%,transparent)`;
  const DARK_BASE = `
    html.pq-dark{color-scheme:dark;background:hsl(var(--th),14%,4%)}
    html.pq-dark body{background:hsl(var(--th),14%,4%);color:hsl(var(--th),10%,92%)}
    html.pq-dark .layout{background:hsl(var(--th),14%,4%)}
    html.pq-dark ::selection{background:var(--acc);color:#fff}
    @view-transition{navigation:auto}
    ::view-transition-old(root),::view-transition-new(root){animation-duration:.14s}
    html.pq-dark .layout-header{--header-background-color:#0a0a0e;background:var(--hbg) !important;color:#f4f4f6;position:relative;overflow:hidden;box-shadow:0 1px 0 ${ACC(45)},0 10px 30px -18px ${ACC(60)}}
    html.pq-dark .layout-header > *{position:relative;z-index:1}
    html.pq-dark .layout-header-logo img,html.pq-dark .layout-header-logo svg{filter:drop-shadow(0 0 6px ${ACC(55)})}
    html.pq-dark .layout-navigation{background:linear-gradient(180deg,hsl(var(--th),16%,6%),hsl(var(--th),14%,4%));box-shadow:inset -1px 0 0 ${ACC(14)}}
    html.pq-dark .menu a.active,html.pq-dark .menu button.active{text-shadow:0 0 12px ${ACC(55)}}
    html.pq-dark .btn.btn-primary,html.pq-dark .btn-primary{background:var(--acc) !important;border-color:var(--acc) !important;color:var(--on-acc) !important;transition:box-shadow .2s ease,transform .15s ease}
    html.pq-dark .btn.btn-primary:hover,html.pq-dark .btn-primary:hover{box-shadow:0 0 0 1px ${ACC(60)},0 6px 22px ${ACC(45)};transform:translateY(-1px)}
    html.pq-dark .card{transition:box-shadow .25s ease}
    html.pq-dark .card:hover{box-shadow:0 0 0 1px ${ACC(28)},0 12px 30px -14px ${ACC(35)} !important}
    html.pq-dark .page-heading h1,html.pq-dark .page-title{background:linear-gradient(90deg,#fff,color-mix(in srgb,var(--acc) 35%,#fff));-webkit-background-clip:text;background-clip:text;color:transparent}
    html.pq-dark input,html.pq-dark select,html.pq-dark textarea{caret-color:var(--acc)}
    html.pq-dark canvas{filter:invert(1) hue-rotate(180deg) saturate(1.4)}
    html.pq-dark :focus-visible{outline-color:var(--acc)}
    html.pq-dark ::-webkit-scrollbar{width:11px;height:11px}
    html.pq-dark ::-webkit-scrollbar-track{background:hsl(var(--th),14%,5%)}
    html.pq-dark ::-webkit-scrollbar-thumb{background:hsl(var(--ah),30%,14%);border-radius:8px;border:2px solid hsl(var(--th),14%,5%)}
    html.pq-dark ::-webkit-scrollbar-thumb:hover{background:var(--acc)}
    #pq-void-fx{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
    #pq-void-fx .st{position:absolute;inset:-20px;opacity:.4;
      background-image:radial-gradient(1px 1px at 8% 30%,#fff,transparent),radial-gradient(1px 1px at 23% 70%,#fff,transparent),radial-gradient(1.5px 1.5px at 41% 22%,#fff,transparent),
        radial-gradient(1px 1px at 57% 64%,#fff,transparent),radial-gradient(1.5px 1.5px at 73% 35%,var(--acc),transparent),radial-gradient(1px 1px at 88% 58%,#fff,transparent),radial-gradient(1px 1px at 96% 20%,#fff,transparent)}
    #pq-void-fx .st.b{transform:translateX(37px);opacity:.25}
    #pq-void-fx.live .st{animation:pqvTw 1.9s ease-in-out 2 alternate}
    #pq-void-fx.live .st.b{animation-delay:.4s}
    #pq-void-fx .sw{position:absolute;left:0;bottom:0;height:2px;width:30%;background:linear-gradient(90deg,transparent,var(--acc),color-mix(in srgb,var(--acc) 55%,#fff),var(--acc),transparent);
      transform:translateX(-110%);filter:drop-shadow(0 0 6px var(--acc))}
    #pq-void-fx.live .sw{animation:pqvSw 3.8s cubic-bezier(.45,0,.2,1) 1 both}
    #pq-void-fx .orb{position:absolute;top:-60px;left:12%;width:220px;height:160px;border-radius:50%;background:radial-gradient(closest-side,${ACC(35)},transparent);
      opacity:.75}
    #pq-void-fx.live .orb{animation:pqvOrb 4s ease-in-out 1}
    @keyframes pqvTw{from{opacity:.15}to{opacity:.6}}
    @keyframes pqvSw{from{transform:translateX(-110%)}to{transform:translateX(440%)}}
    @keyframes pqvOrb{0%,100%{opacity:.75}50%{opacity:1}}
    @media (prefers-reduced-motion:reduce){#pq-void-fx *{animation:none !important}}`;
  // Voidescent: a starry sky behind Picqer. Stars = still pictures (no work for the PC), only a slow fade in/out
  // of 2 layers (the graphics card does that, nothing gets redrawn). Cards stay solid so text stays readable.
  const STILL_CSS = `html.pq-dark .btn-primary,html.pq-dark .card{transition:none !important}
    html.pq-dark .btn.btn-primary:hover,html.pq-dark .btn-primary:hover{transform:none}`;
  const STAR = (x, y, s, c = '#fff') => `radial-gradient(${s}px ${s}px at ${x}% ${y}%,${c},transparent)`;
  const starTile = (seed, n, big) => { let a = seed; const r = () => ((a = (a * 9301 + 49297) % 233280) / 233280); return Array.from({ length: n }, () => STAR((r() * 100).toFixed(1), (r() * 100).toFixed(1), big && r() > .7 ? 1.6 : 1, r() > .85 ? '#ff8099' : r() > .7 ? '#ffd6de' : '#fff')).join(','); };
  const STARS_CSS = `
    html.pq-starry body,html.pq-starry .layout{background:transparent !important}
    html.pq-starry{background:radial-gradient(ellipse at 15% -10%,color-mix(in srgb,var(--acc) 16%,transparent),transparent 55%),radial-gradient(ellipse at 100% 110%,color-mix(in srgb,var(--acc) 12%,transparent),transparent 50%),hsl(var(--th),20%,3%) !important}
    html.pq-starry .layout-navigation{background:rgba(8,6,9,.55) !important}
    #pq-stars{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict}
    #pq-stars i{position:absolute;inset:0}
    #pq-stars .a{background-image:${starTile(7, 14, true)};background-size:420px 380px;opacity:.55}
    #pq-stars .b{background-image:${starTile(31, 10, false)};background-size:290px 330px;opacity:.35}
    html.pq-live #pq-stars .a{animation:pqStA 1.9s ease-in-out 2 alternate}
    html.pq-live #pq-stars .b{animation:pqStB 1.9s ease-in-out 2 alternate}
    #pq-stars .c{background-image:${starTile(97, 6, true)};background-size:610px 560px;opacity:.7}
    @keyframes pqStA{from{opacity:.25}to{opacity:.7}}
    @keyframes pqStB{from{opacity:.55}to{opacity:.15}}
    #pq-stars.still i{animation:none !important}
    @media (prefers-reduced-motion:reduce){#pq-stars i{animation:none !important}}`;
  function starsOn() {
    if (!document.documentElement.classList.contains('pq-starry') || document.getElementById('pq-stars') || !document.body) return !!document.getElementById('pq-stars');
    const d = document.createElement('div');
    d.id = 'pq-stars';
    d.innerHTML = '<i class="c"></i><i class="a"></i><i class="b"></i>';
    document.body.prepend(d);
    return true;
  }
  // does this PC keep up? Measure ~1.5 s of frames a bit after the page is there.
  // Under ~40 fps with the stars twinkling: they stand still from now on (still stars cost nothing).
  function starsLagCheck(d) {
    if (d.classList.contains('still') || document.hidden) return;
    setTimeout(() => {
      if (document.hidden || !d.isConnected) return;
      let n = 0, worst = 0, last = performance.now();
      const t0 = last;
      const f = (t) => {
        n++; worst = Math.max(worst, t - last); last = t;
        if (t - t0 < 1500) return requestAnimationFrame(f);
        const fps = (n * 1000) / (t - t0);
        if (fps < 40) { d.classList.add('still'); lsSet('pqsuite_stars_still_v1', true); console.info(`[suite] stars stand still on this PC (${Math.round(fps)} fps)`); }
      };
      requestAnimationFrame(f);
    }, 4000);
  }
  function darkCss() {
    const c = lsGet(DARK_LS, null);
    if (!c || Date.now() - c.at > 86400000 || c.v !== SUITE_VERSION) {
      fetch(`${RAW}skins/dark.css?t=${Math.floor(Date.now() / 3600000)}`, { credentials: 'omit', cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((css) => {
          if (!/\.pq-dark/.test(css)) return;
          const fresh = !c || c.css !== css;
          lsSet(DARK_LS, { at: Date.now(), css, v: SUITE_VERSION });
          if (fresh && document.getElementById('pq-skin-dark')) document.getElementById('pq-skin-dark').textContent = css;
        })
        .catch((e) => console.info('[suite] dark.css not loaded:', e.message));
    }
    return c ? c.css : '';
  }
  function skinFx(kind) {
    starsOn();
    if (kind === 'none') return true; // cheap skins: no movement at all
    const h = document.querySelector('.layout-header');
    if (!h || h.querySelector('#pq-void-fx')) return !!h;
    const fx = document.createElement('div');
    fx.id = 'pq-void-fx';
    fx.innerHTML = kind === 'full' ? '<div class="orb"></div><div class="st"></div><div class="st b"></div><div class="sw"></div>' : '<div class="sw"></div>';
    h.prepend(fx);
    // movement in bursts (4 s every 11 s, never in a hidden tab): looks alive, costs the PC ~nothing in between
    const ON = +window.__pqFxOn || 4000, EVERY = +window.__pqFxEvery || 11000;
    const burst = () => {
      if (!fx.isConnected) return;
      if (!document.hidden) { fx.classList.add('live'); document.documentElement.classList.add('pq-live'); setTimeout(() => { fx.classList.remove('live'); document.documentElement.classList.remove('pq-live'); }, ON); }
      setTimeout(burst, EVERY);
    };
    setTimeout(burst, 600);
    return true;
  }
  const SKIN_VARS = ['--th', '--ah', '--as', '--acc', '--on-acc', '--hbg'];
  const LS_SKIN_LAST = 'pqsuite_skin_last_v1'; // the skin this PC showed last: put on right away on the next page (no white flash)
  let skinNow = EARLY_SKIN, skinBuilt = false;
  window.addEventListener('pq-flags', () => { skinBuilt = false; applySkin(ON_LOGIN ? null : (skinOf(ME.id) || {}).id); }); // skins switched off / on for everyone
  function applySkin(id) {
    id = SKIN_LOOK[id] && !flagOff('skins') && can('skins') ? id : null; // off for everyone (Shift+9) or not for this team
    // the early skin (from the last page) can be from an older version: rebuild it once per page
    if (skinNow === id && skinBuilt) { if (id && SKIN_LOOK[id].dark) skinFx(SKIN_LOOK[id].dark.fx); return; }
    skinNow = id;
    skinBuilt = true;
    if (!id) lsSet(LS_SKIN_LAST, null);
    ['pq-skin', 'pq-skin-dark', 'pq-void-fx', 'pq-stars'].forEach((x) => document.getElementById(x)?.remove());
    const root = document.documentElement;
    root.classList.remove('pq-dark', 'pq-starry');
    SKIN_VARS.forEach((v) => root.style.removeProperty(v));
    const k = SKIN_LOOK[id];
    if (!k) return;
    if (k.dark) {
      root.classList.add('pq-dark');
      if (k.dark.stars) root.classList.add('pq-starry');
      const vars = { '--th': String(k.dark.th), '--ah': String(k.dark.ah), '--as': k.dark.as, '--acc': k.accent, '--on-acc': k.dark.onAcc || (id === 'carbon' || id === 'gold' || id === 'crown' ? '#111' : '#fff'), '--hbg': k.bg };
      Object.entries(vars).forEach(([v, x]) => root.style.setProperty(v, x));
      const base = DARK_BASE + (k.dark.fx === 'none' ? STILL_CSS : '') + (k.dark.stars ? STARS_CSS : '') + (k.crown ? '.layout-header-account .d-mobile-none::before{content:"👑 "}' : '');
      addStyle('pq-skin-dark', darkCss());
      addStyle('pq-skin', base);
      lsSet(LS_SKIN_LAST, { id, vars, base, cls: k.dark.stars ? 'pq-starry' : '' });
      if (!skinFx(k.dark.fx)) { let n = 0; const iv = setInterval(() => { if (skinFx(k.dark.fx) || ++n > 30) clearInterval(iv); }, 500); }
      return;
    }
    const light = `
      .layout-header{background:${k.bg} !important;box-shadow:inset 0 -3px 0 ${k.line || k.accent} !important}
      .btn-primary,.btn-primary:hover,.btn-primary:focus{background:${k.accent} !important;border-color:${k.accent} !important}
      .card{border-top:2px solid ${k.accent} !important}
      ${k.crown ? '.layout-header-account .d-mobile-none::before{content:"👑 "}' : ''}`;
    addStyle('pq-skin', light);
    lsSet(LS_SKIN_LAST, { id, base: light });
  }


  // crate colors, like CS:GO: blue common → purple → pink → red covert → gold ★
  const RARITY = { midnight: '#4b69ff', forest: '#4b69ff', ocean: '#4b69ff', sakura: '#4b69ff', arctic: '#4b69ff', sunset: '#8847ff', gold: '#8847ff', emerald: '#8847ff',
    aurora: '#d32ce6', lava: '#d32ce6', nebula: '#eb4b4b', neon: '#eb4b4b', crown: '#eb4b4b', carbon: '#eb4b4b', voidescent: '#e4ae39',
    phantom: '#d32ce6', inferno: '#eb4b4b', celestial: '#e4ae39', eclipse: '#e4ae39' };
  // ---------- newer version on GitHub? Tampermonkey only checks about once a day, so tell the person ----------
  const verNum = (v) => String(v || '0').split('.').map((x) => +x || 0);
  const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function updateCheck() {
    const c = lsGet('pqsuite_update_v1', null);
    let latest = c && Date.now() - c.at < 30 * 60000 ? c.v : null;
    if (!latest) {
      try {
        const head = await (await fetch(`${RAW}picqer-suite.user.js?t=${Math.floor(Date.now() / 600000)}`, { credentials: 'omit', headers: { Range: 'bytes=0-600' } })).text();
        latest = (head.match(/@version\s+([\d.]+)/) || [])[1];
        if (latest) lsSet('pqsuite_update_v1', { at: Date.now(), v: latest });
      } catch (_) { return; }
    }
    if (!latest || !newer(latest, SUITE_VERSION)) return;
    updLatest = latest;
    updIcon();
    if (!updTimer) updTimer = setInterval(updIcon, 1500); // Picqer can redraw its header: put it back
  }
  // newer version: a small download icon in Picqer's header (hover = "new update", click = update like Shift+R)
  let updLatest = null, updTimer = null;
  function updIcon() {
    if (!updLatest || document.getElementById('pq-upd')) return;
    const nav = document.querySelector('.layout-header-navigation');
    if (!nav) return;
    addStyle('pq-upd-style', `
      #pq-upd{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;opacity:.5;transition:opacity .15s;cursor:pointer;text-decoration:none !important}
      #pq-upd:hover{opacity:1}
      #pq-upd::after{content:"";position:absolute;top:9px;right:7px;width:6px;height:6px;border-radius:50%;background:#10b981}
      #pq-upd .pq-upd-tip{position:absolute;top:calc(100% + 4px);right:0;white-space:nowrap;font:600 11.5px system-ui,sans-serif;background:#111827;color:#fff;padding:5px 9px;border-radius:7px;box-shadow:0 6px 18px rgba(0,0,0,.25);opacity:0;pointer-events:none;transform:translateY(-3px);transition:opacity .15s,transform .15s;z-index:2147483001}
      #pq-upd:hover .pq-upd-tip{opacity:1;transform:none}
    `);
    const a = document.createElement('a');
    a.id = 'pq-upd';
    a.href = '#';
    a.setAttribute('aria-label', `New update ${updLatest}`);
    a.innerHTML = `<i class="far fa-download"></i><span class="pq-upd-tip">New update · ${escHtml(updLatest)} · click to update</span>`;
    a.addEventListener('click', (e) => { e.preventDefault(); hardUpdate(); });
    const before = document.getElementById('pq-hb') || nav.querySelector('.layout-header-account');
    if (before && before.parentNode) before.parentNode.insertBefore(a, before); else nav.appendChild(a);
  }

  function leaderboard() {
    const C = CFG.leaderboard || {};
    const WIN = Math.max(1, +C.windowMin || 15) * 60000;
    const POLL = 30000; // your rank bottom right: fresh every 30 s (the middle stop works every 15 s)
    const URL_ = norm(String(C.url || '')).replace(/\/+$/, '');
    const LS_DATA = 'pqsuite_lb_v3', LS_LOCK = 'pqsuite_lb_lock_v1', LS_USERS = 'pqsuite_lb_users_v1';
    const TAB = Math.random().toString(36).slice(2);
    const ME_ID = String(ME.id || '');
    const proxies = new Set(((CFG.zaplog && CFG.zaplog.proxyIds) || []).map(String));
    const low = (x) => norm(String(x == null ? '' : x)).toLowerCase();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const fmt = (x) => (Math.round((+x || 0) * 10) / 10).toLocaleString('nl-NL');
    const int = (x) => Math.floor(+x || 0).toLocaleString('nl-NL');
    let wh = null, data = lsGet(LS_DATA, null), shown = null, prevRank = null, listOpen = false, prof = null;

    async function api(path) {
      for (let i = 0; i < 4; i++) {
        const r = await fetch('/api/v1' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000 * (i + 1))); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }
      throw new Error('Picqer says too many requests');
    }
    async function warehouse() {
      const W = norm(String(C.warehouse == null ? '' : C.warehouse));
      if (!W || wh) return wh;
      const c = lsGet('pqsuite_warehouses_v1', null); // warehouses barely change: once a day per PC
      const list = c && Date.now() - c.at < 86400000 ? c.list : (await api('/warehouses')) || [];
      if (!c || c.list !== list) lsSet('pqsuite_warehouses_v1', { at: Date.now(), list: list.map((w) => ({ idwarehouse: w.idwarehouse, name: w.name })) });
      const hit = list.find((w) => String(w.idwarehouse) === W) || list.find((w) => low(w.name) === low(W)) || list.find((w) => low(w.name).includes(low(W)));
      wh = hit ? { id: +hit.idwarehouse, name: norm(hit.name) } : { id: null, name: '' };
      return wh;
    }
    async function names() {
      const c = lsGet(LS_USERS, null);
      if (c && Date.now() - c.at < 12 * 3600000) return c.map;
      const map = {};
      for (let off = 0; off < 2000; off += 100) {
        const page = await api(`/users?offset=${off}`);
        (page || []).forEach((u) => { map[u.iduser] = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username || `#${u.iduser}`; });
        if (!page || page.length < 100) break;
      }
      lsSet(LS_USERS, { at: Date.now(), map });
      return map;
    }
    function scoreRows(rows) {
      const by = new Map();
      for (const p of rows) {
        if (p.closed_by_iduser == null) continue;
        const codes = new Set((p.products || []).filter((x) => !x.has_parts).map((x) => x.productcode));
        if (!codes.size) continue;
        const r = by.get(String(p.closed_by_iduser)) || { id: String(p.closed_by_iduser), picklists: 0, multis: 0, singles: 0, points: 0 };
        r.picklists++;
        if (codes.size >= 2) r.multis++; else r.singles++;
        r.points = Math.round((r.multis * 2 + r.singles * 1.334) * 1000) / 1000;
        by.set(r.id, r);
      }
      return [...by.values()];
    }

    async function poll() {
      const lock = lsGet(LS_LOCK, null);
      if (lock && lock.tab !== TAB && Date.now() - lock.ts < POLL * 1.6) return; // another tab on this PC does it
      lsSet(LS_LOCK, { tab: TAB, ts: Date.now() });
      try {
        let people = null, whName = '', via = '', king = null, pickPeople = null, goal = null;
        if (URL_) {
          try {
            const r = await fetch(`${URL_}/leaderboard`, { credentials: 'omit', cache: 'no-store' });
            const j = await r.json();
            if (!r.ok || !j.people) throw new Error(j.err || `HTTP ${r.status}`);
            people = j.people; whName = j.wh || ''; king = j.king || null; via = 'middle stop'; feedCheck(j.feed); pickPeople = j.picks && j.picks.people; goal = j.goal || null;
            if (j.flags && JSON.stringify(j.flags) !== JSON.stringify(lsGet(LS_FLAGS, null))) { lsSet(LS_FLAGS, j.flags); window.dispatchEvent(new Event('pq-flags')); }
          } catch (e) { console.info('[leaderboard] middle stop:', e.message, '· asking Picqer myself'); }
        }
        if (!people) {
          const w = await warehouse();
          whName = w && w.name;
          const rows = [];
          for (let off = 0; off < 3000; off += 100) {
            const page = await api(`/picklists?status=closed&closed_after=${encodeURIComponent(stamp(Date.now() - WIN))}${w && w.id ? `&idwarehouse=${w.id}` : ''}&offset=${off}`);
            rows.push(...(page || []));
            if (!page || page.length < 100) break;
          }
          people = scoreRows(rows);
        }
        const map = await names().catch(() => ({}));
        const list = people.filter((r) => !proxies.has(String(r.id)))
          .map((r) => ({ ...r, id: String(r.id), name: map[r.id] || `#${r.id}`, n: r.picklists }))
          .sort((a, b) => b.points - a.points || b.n - a.n);
        const plist = (pickPeople || []).filter((r) => !proxies.has(String(r.id))).map((r) => ({ ...r, id: String(r.id), name: map[r.id] || `#${r.id}` }));
        data = { at: Date.now(), wh: norm(whName || ''), list, king, via: via || 'Picqer', err: '', picks: plist, goal };
        idleCheck(plist);
      } catch (e) {
        data = { ...(data || { list: [] }), at: Date.now(), err: e.message };
      }
      lsSet(LS_DATA, data);
      lsSet(LS_LOCK, { tab: TAB, ts: Date.now() });
      render();
    }

    // colors: only what they really did in the last 15 min
    const per15 = (pts) => pts * 900000 / WIN;
    const tierOf = (p) => (p >= 46 ? 'blue' : p >= 38 ? 'turq' : p >= 30 ? 'dgreen' : p >= 21 ? 'green' : p >= 14 ? 'orange' : 'red');
    // pickers: live from the open batches (what is collected), checked every minute by the middle stop
    //  colors = pick points in the last 15 min · only people who collected something in the last hour count as picking
    const pickTier = (m) => (m >= 75 ? 'blue' : m >= 60 ? 'turq' : m >= 45 ? 'dgreen' : m >= 30 ? 'green' : m >= 18 ? 'orange' : 'red');
    const picking = (r) => r.live && r.live.idleMin != null && r.live.idleMin < 60;
    const idleTxt = (r) => (!r.live || r.live.idleMin == null ? '' : r.live.idleMin < 2 ? 'picking now' : `idle ${r.live.idleMin} min`);
    const idleCls = (r) => (!r.live || r.live.idleMin == null || r.live.idleMin < 5 ? '' : r.live.idleMin < 10 ? 'pk-idle' : 'pk-idle bad');
    function pickSort(list) {
      const act = list.filter(picking).sort((a, b) => b.live.m15 - a.live.m15 || a.live.idleMin - b.live.idleMin);
      let rank = 0, prev = null;
      return act.map((r, i) => { if (prev === null || r.live.m15 !== prev) rank = i + 1; prev = r.live.m15; return { ...r, rank, tier: pickTier(r.live.m15) }; });
    }
    const pickRanked = () => pickSort((data && data.picks) || []);
    function ranked() {
      const list = (data && data.list) || [];
      const kingId = data && data.king ? String(data.king.id) : (data && data.via !== 'middle stop' && list[0] && per15(list[0].points) >= 21 ? list[0].id : null);
      let rank = 0, prev = null;
      return list.map((r, i) => {
        if (!prev || r.points !== prev.points) rank = i + 1;
        prev = r;
        const king = r.id === kingId;
        return { ...r, rank, king, kingMin: king && data.king ? data.king.min : null, tier: king ? 'gold' : tierOf(per15(r.points)) };
      });
    }

    const theme = () => {
      if (document.documentElement.classList.contains('pq-dark')) return 'dark';
      const t = low(C.theme || 'auto');
      if (t === 'light' || t === 'dark') return t;
      try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { return 'light'; }
    };
    addStyle('pq-lb-style', `
      .pq-lbx{--bg:#fff;--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--soft:#f8fafc;--hi:#eef2ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--fg)}
      .pq-lbx.dark{--bg:#111827;--fg:#f1f5f9;--mut:#94a3b8;--line:#1f2937;--soft:#0b1220;--hi:#1e293b}
      .pq-lbx .t-gold{--c:#d4a017} .pq-lbx .t-blue{--c:#3b82f6} .pq-lbx .t-turq{--c:#14b8a6} .pq-lbx .t-dgreen{--c:#059669}
      .pq-lbx .t-green{--c:#22c55e} .pq-lbx .t-orange{--c:#f97316} .pq-lbx .t-red{--c:#ef4444} .pq-lbx .t-none{--c:#94a3b8}
      #pq-lb{position:fixed;right:16px;bottom:16px;z-index:2147483000;cursor:pointer;user-select:none}
      #pq-lb .lb-card{display:flex;align-items:center;gap:12px;min-width:190px;padding:10px 14px 10px 12px;border-radius:12px;background:var(--bg);
        border:1px solid var(--line);border-left:4px solid var(--c);box-shadow:0 6px 20px rgba(15,23,42,.12);transition:transform .15s ease,box-shadow .15s ease}
      #pq-lb:hover .lb-card{transform:translateY(-2px);box-shadow:0 10px 26px rgba(15,23,42,.18)}
      #pq-lb .lb-rank{font:800 22px/1 system-ui,sans-serif;color:var(--c);min-width:34px;text-align:center}
      #pq-lb .lb-main{display:flex;flex-direction:column;gap:2px}
      #pq-lb .lb-pts{font:700 15px/1.2 system-ui,sans-serif}
      #pq-lb .lb-pts small{font-weight:500;color:var(--mut);font-size:12px}
      #pq-lb .lb-sub{font:500 11.5px/1.2 system-ui,sans-serif;color:var(--mut)}
      #pq-lb .lb-king{color:#b8860b;font-weight:700}
      #pq-lb.flash .lb-card{animation:lbFlash 1.2s ease}
      @keyframes lbFlash{0%{transform:translateY(6px);opacity:.4}40%{transform:none;opacity:1}}
      .pq-lb-ov{position:fixed;inset:0;z-index:2147483002;background:rgba(15,23,42,.38);display:flex;align-items:center;justify-content:center;padding:16px}
      .pq-lb-ov .lb-panel{width:min(560px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--bg);border-radius:14px;border:1px solid var(--line);box-shadow:0 24px 60px rgba(0,0,0,.25);padding:18px 20px}
      .pq-lb-ov h2{margin:0;font:700 18px system-ui,sans-serif;display:flex;align-items:center;justify-content:space-between}
      .pq-lb-ov .lb-gear{border:1px solid var(--line);background:var(--soft);color:var(--mut);border-radius:8px;width:30px;height:30px;font-size:15px;cursor:pointer}
      .pq-lb-ov .lb-gear:hover{color:var(--fg)}
      .pq-lb-ov .lb-row.click{cursor:pointer;transition:background .12s}
      .pq-lb-ov .lb-row.click:hover{background:var(--hi)}
      .pq-lb-ov .lb-back{border:1px solid var(--line);background:var(--soft);color:var(--fg);font:600 12px system-ui;padding:5px 10px;border-radius:7px;cursor:pointer;margin:10px 0 6px}
      .pq-lb-ov .lb-who{font:700 17px system-ui;margin:4px 0 0}
      .pq-lb-ov .lb-tabs{display:flex;gap:4px;margin:10px 0 2px;padding:3px;background:var(--soft);border:1px solid var(--line);border-radius:9px;width:max-content}
      .pq-lb-ov .lb-tabs button{border:0;background:none;color:var(--mut);font:600 12.5px system-ui;padding:5px 12px;border-radius:7px;cursor:pointer}
      .pq-lb-ov .lb-tabs button.on{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.12)}
      .pq-lb-ov .lb-meta{color:var(--mut);font-size:12px;margin:2px 0 14px}
      .pq-lb-ov .lb-row{display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border-left:3px solid var(--c)}
      .pq-lb-ov .lb-row+.lb-row{margin-top:4px}
      .pq-lb-ov .lb-row.me{background:var(--hi)}
      .pq-lb-ov .lb-row .r{font:700 15px system-ui;color:var(--c);text-align:center}
      .pq-lb-ov .lb-row .nm{font:600 14px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pq-lb-ov .lb-row .nm small{display:block;color:var(--mut);font-weight:500;font-size:11.5px}
      .pq-lb-ov .lb-row .v{font:700 15px system-ui;text-align:right}
      .pq-lb-ov .lb-row .v small{display:block;font:500 11px system-ui;color:var(--mut)}
      .pq-lb-ov .lb-empty{color:var(--mut);padding:18px 0;text-align:center}
      .pq-lb-ov .lb-legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;color:var(--mut);font-size:11px}
      .pq-lb-ov .lb-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:4px}
      .pq-lb-ov .pf-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .pq-lb-ov .pf-bal{text-align:right}
      .pq-lb-ov .pf-bal b{display:block;font:800 22px system-ui}
      .pq-lb-ov .pf-bal span{color:var(--mut);font-size:11px}
      .pq-lb-ov .pf-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
      .pq-lb-ov .pf-tile{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:9px 10px}
      .pq-lb-ov .pf-tile b{display:block;font:700 18px system-ui}
      .pq-lb-ov .pf-tile span{color:var(--mut);font-size:11px}
      .pq-lb-ov h3{font:700 13px system-ui;margin:16px 0 8px}
      .pq-lb-ov .pf-week{display:flex;align-items:flex-end;gap:6px;height:64px}
      .pq-lb-ov .pf-week div{flex:1;max-width:44px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;color:var(--mut)}
      .pq-lb-ov .pf-week i{display:block;width:100%;background:#6366f1;border-radius:4px 4px 0 0;min-height:2px}
      .pq-lb-ov .pf-shop{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
      .pq-lb-ov .pf-skin{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg)}
      .pq-lb-ov .pf-skin.on{outline:2px solid #6366f1}
      .pq-lb-ov .pf-sw{height:34px}
      .pq-lb-ov .pf-skin div.pf-in{padding:7px 8px}
      .pq-lb-ov .pf-skin b{font:600 12.5px system-ui;display:block}
      .pq-lb-ov .pf-skin span{color:var(--mut);font-size:11px}
      .pq-lb-ov .pf-skin button{margin-top:6px;width:100%;padding:5px 0;border-radius:7px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:600 12px system-ui;cursor:pointer}
      .pq-lb-ov .pf-skin button.buy{background:#6366f1;border-color:#6366f1;color:#fff}
      .pq-lb-ov .pf-skin button:disabled{opacity:.45;cursor:default}
      .pq-lb-ov .pf-lim{color:#e11d48;font-weight:700}
      #pq-pf-ov.sh .sh-panel{width:min(1080px,100%);padding:18px 22px}
      .sh .sh-top{display:flex;align-items:center;gap:16px;padding-bottom:12px;border-bottom:1px solid var(--line)}
      .sh .sh-top > div:first-child{flex:1;min-width:0}
      .sh .sh-top .lb-tabs{margin:0}
      .sh .sh-coins{text-align:right;padding:6px 12px;border-radius:10px;background:var(--soft);border:1px solid var(--line)}
      .sh .sh-coins b{display:block;font:800 20px system-ui;line-height:1.1}
      .sh .sh-coins span{color:var(--mut);font-size:11px}
      .sh .sh-x{border:0;background:none;color:var(--mut);font-size:18px;cursor:pointer;padding:4px 6px}
      .sh .sh-note{margin-top:10px;padding:8px 12px;border-radius:8px;background:var(--hi);font-size:12.5px}
      .sh .sh-body{display:grid;grid-template-columns:1fr 400px;gap:20px}
      .sh .sh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
      .sh .sh-skin{position:relative;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column}
      .sh .sh-skin::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--r)}
      .sh .sh-skin.on{outline:2px solid #6366f1}
      .sh .sh-sw{height:62px;display:flex;align-items:flex-end;justify-content:flex-end;padding:6px}
      .sh .sh-sw span{font:700 10.5px system-ui;color:#fff;background:rgba(0,0,0,.45);padding:2px 7px;border-radius:999px}
      .sh .sh-in{padding:8px 10px 4px}
      .sh .sh-in b{display:block;font:700 13.5px system-ui}
      .sh .sh-in small{color:var(--mut);font-size:11px}
      .sh .sh-skin button{margin:6px 10px 12px;padding:6px 0;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:700 12.5px system-ui;cursor:pointer}
      .sh .sh-skin button.buy::before{content:"🪙 "}
      .sh button.buy{background:#6366f1;border-color:#6366f1;color:#fff}
      .sh button.wear{background:#10b981;border-color:#10b981;color:#fff}
      .sh button:disabled{opacity:.45;cursor:default}
      .sh .sh-ltd{position:absolute;top:6px;left:6px;z-index:1;font-style:normal;font:800 9.5px system-ui;letter-spacing:.05em;color:#1c1400;background:linear-gradient(90deg,#fbbf24,#e4ae39);padding:2px 7px;border-radius:999px;box-shadow:0 0 12px rgba(228,174,57,.6)}
      .sh .sh-fine{display:block;color:var(--mut);font-size:11px;margin-top:10px}
      .sh .sh-crate{border-radius:14px;padding:14px;background:#0b0b12;color:#e2e8f0;border:1px solid #20202c;box-shadow:inset 0 0 50px rgba(99,102,241,.08)}
      .sh .sh-crate.jackpot{box-shadow:0 0 0 1px #e4ae39,0 0 30px rgba(228,174,57,.35),inset 0 0 50px rgba(228,174,57,.12)}
      .sh .sh-ct{display:flex;align-items:center;gap:10px}
      .sh .sh-ct b{display:block;font:700 14px system-ui;color:#fff}
      .sh .sh-ct small{color:#94a3b8;font-size:11.5px}
      .sh .sh-box{font-size:26px;width:44px;height:44px;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,#312e81,#831843)}
      .sh .sh-crate.spin .sh-box{animation:shShake .5s ease-in-out infinite}
      @keyframes shShake{0%,100%{transform:rotate(0)}25%{transform:rotate(-8deg)}75%{transform:rotate(8deg)}}
      .sh .cr-win{position:relative;margin:12px 0 10px;height:128px;overflow:hidden;border-radius:10px;background:#05050a;border:1px solid #1d1d28;box-shadow:inset 0 0 30px rgba(0,0,0,.9)}
      .sh .cr-win::before,.sh .cr-win::after{content:"";position:absolute;top:0;bottom:0;width:50px;z-index:2;pointer-events:none}
      .sh .cr-win::before{left:0;background:linear-gradient(90deg,#05050a,transparent)}
      .sh .cr-win::after{right:0;background:linear-gradient(-90deg,#05050a,transparent)}
      .sh .cr-strip{position:absolute;left:0;top:12px;display:flex;will-change:transform}
      .sh .cr-strip.go{transition:transform 6.2s cubic-bezier(.06,.62,.1,1)}
      .sh .cr-it{width:104px;height:102px;margin-right:8px;flex:none;border-radius:9px;background:#13131c;border-bottom:4px solid var(--r);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;box-shadow:inset 0 -26px 34px -26px var(--r)}
      .sh .cr-sw{width:78px;height:40px;border-radius:7px;border:1px solid rgba(255,255,255,.12)}
      .sh .cr-it b{color:#f1f5f9;font:700 11.5px system-ui}
      .sh .cr-it.won{outline:2px solid var(--r);box-shadow:0 0 24px var(--r),inset 0 -26px 34px -26px var(--r)}
      .sh .cr-mark{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;z-index:3;background:#fbbf24;box-shadow:0 0 10px #fbbf24}
      .sh .cr-mark::before,.sh .cr-mark::after{content:"";position:absolute;left:-6px;border:7px solid transparent}
      .sh .cr-mark::before{top:0;border-top-color:#fbbf24}
      .sh .cr-mark::after{bottom:0;border-bottom-color:#fbbf24}
      .sh .cr-res{text-align:center;min-height:20px;font:500 13.5px system-ui;color:#e2e8f0}
      .sh .cr-jp{color:#fbbf24;font-size:15px;letter-spacing:.04em}
      .sh .cr-btns{display:flex;gap:8px;justify-content:center;margin:10px 0 4px;min-height:36px}
      .sh .cr-btns button{padding:9px 16px;border-radius:9px;border:1px solid #2a2a38;font:800 13px system-ui;cursor:pointer}
      .sh .cr-btns button.buy{background:linear-gradient(90deg,#6366f1,#a855f7);border:0;box-shadow:0 6px 20px rgba(139,92,246,.35)}
      .sh .sh-odds{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:10px;font-size:11.5px;color:#cbd5e1}
      .sh .sh-odds div{display:flex;align-items:center;gap:6px}
      .sh .sh-odds i{width:8px;height:8px;border-radius:2px;background:var(--r);flex:none}
      .sh .sh-odds span{margin-left:auto;color:#94a3b8}
      .sh .sh-crate .sh-fine{color:#64748b}
      @media (max-width:860px){.sh .sh-body{grid-template-columns:1fr}.sh .sh-top{flex-wrap:wrap}}
      .pq-lb-ov .pf-note{color:var(--mut);font-size:11.5px;margin-top:10px}
      @media (max-width:560px){.pq-lb-ov .pf-tiles,.pq-lb-ov .pf-shop{grid-template-columns:repeat(2,1fr)}}
    `);

    const box = document.createElement('div');
    box.id = 'pq-lb';
    box.className = 'pq-lbx';
    box.title = 'Leaderboard · click for everyone (Ctrl+Alt+L) · 🪙 at the top = inventory, stats, shop';
    box.addEventListener('click', () => (box.dataset.mode === 'pick' ? openPk(false) : showList()));
    if (C.widget !== false) document.body.appendChild(box);

    // ---------- shift goal: thin bar under Picqer's header (only when Ahmad set a goal, Shift+9) ----------
    function goalBar() {
      const g = data && data.goal;
      let bar = document.getElementById('pq-goal');
      if (!g || !g.target) { bar?.remove(); return; }
      addStyle('pq-goal-style', `
        #pq-goal{min-height:30px;box-sizing:border-box;min-width:0;max-width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;padding:4px 24px;background:#fff;border-bottom:1px solid #e2e8f0;font:500 12.5px system-ui,sans-serif;color:#0f172a;position:sticky;top:var(--pq-hh,52px);z-index:5}
        #pq-goal b.t{font-weight:700;white-space:nowrap}
        #pq-goal .gb{flex:1;height:8px;border-radius:999px;background:#e2e8f0;position:relative;overflow:hidden;min-width:80px}
        #pq-goal .gb i{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:#4f46e5;transition:width .6s}
        #pq-goal .gb em{position:absolute;top:-2px;bottom:-2px;width:2px;background:#0f172a;opacity:.35}
        #pq-goal span{white-space:nowrap;font-variant-numeric:tabular-nums}
        #pq-goal .up{color:#059669;font-weight:600} #pq-goal .dn{color:#e11d48;font-weight:600} #pq-goal .mut{color:#64748b}
        html.pq-dark #pq-goal{background:var(--th-bg,#0f1117);border-color:rgba(255,255,255,.08);color:#e2e8f0}
        html.pq-dark #pq-goal .gb{background:rgba(255,255,255,.1)} html.pq-dark #pq-goal .gb em{background:#fff}
        html.pq-dark #pq-goal .mut{color:#94a3b8}
        @media (max-width:700px){#pq-goal .mut{display:none}}
      `);
      // plan: at `from` there were `start` open (e.g. 700 at 18:00), at `to` max `target` (e.g. 200 at 23:00) → a straight line in between
      const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
      const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
      const a = hm(g.from || '18:00'), z = hm(g.to || '23:00'), target = g.target, open = g.open, start = g.start;
      const fromTxt = g.from || '18:00', toTxt = g.to || '23:00';
      const ss = g.samples || [];
      const recent = ss.filter((x) => Date.now() - x.at < 70 * 60000);
      const rate = recent.length >= 2 ? ((recent[0].n - recent[recent.length - 1].n) / Math.max(10, (recent[recent.length - 1].at - recent[0].at) / 60000)) * 60 : null; // + = going down
      const rTxt = (r) => `${r >= 0 ? '−' : '+'}${int(Math.abs(Math.round(r)))}/h`;
      const planned = start != null && mins >= a ? Math.round(start - (start - target) * Math.min(1, (mins - a) / Math.max(1, z - a))) : null; // where it should be now
      const pct = open == null || start == null ? 0 : Math.min(100, Math.max(0, ((start - open) / Math.max(1, start - target)) * 100));
      const mark = planned == null || start == null ? null : Math.min(100, Math.max(0, ((start - planned) / Math.max(1, start - target)) * 100));
      const proj = open != null && rate != null && mins < z ? Math.round(open - rate * Math.max(0, (z - mins) / 60)) : null;
      let state = '';
      if (open != null && open <= target) state = '<span class="up">goal hit ✓</span>';
      else if (mins < a) state = `<span class="mut">starts ${escHtml(fromTxt)}</span>`;
      else if (planned != null && open != null) state = open <= planned ? `<span class="up">${int(planned - open)} ahead</span>` : `<span class="dn">${int(open - planned)} behind</span>`;
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'pq-goal';
      }
      // body is a css grid (header / nav + content): a loose child there blows up the nav column → put it on top of the content
      const host = document.querySelector('.layout-content');
      if (host && bar.parentNode !== host) { const hh = document.querySelector('.layout-header'); if (hh) bar.style.setProperty('--pq-hh', hh.offsetHeight + 'px'); host.prepend(bar); }
      else if (!host && !bar.parentNode) document.body.prepend(bar);
      bar.title = ss.length ? ss.slice(-12).map((x) => `${new Date(x.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}  ${x.n} open`).join('\n') : 'counting the open picklists… (every 3 min)';
      const info = [
        start != null ? `start: ${int(start)} open at ${fromTxt}` : `start: counting at ${fromTxt}`,
        `goal: max ${int(target)} open at ${toTxt}`,
        planned != null && mins < z ? `should be at ${int(planned)} now` : '',
        rate != null ? `pace: ${rTxt(rate)}` : '',
        proj != null && open > target ? `at this pace ~${int(Math.max(0, proj))} at ${toTxt}` : '',
        'the dark line on the bar = where it should be now',
      ].filter(Boolean).join('\n');
      bar.innerHTML = `<b class="t">Shift goal</b><div class="gb"><i style="width:${pct.toFixed(1)}%"></i>${mark != null && mins < z ? `<em style="left:${mark.toFixed(1)}%"></em>` : ''}</div>
        <span><b>${open == null ? '…' : int(open)}</b> → ${int(target)}</span>${state}${helpBtn(info)}`;
    }
    function render() {
      safe('goal-bar', goalBar);
      const th = theme();
      box.classList.toggle('dark', th === 'dark');
      const pl = pickRanked(), pme = pl.find((r) => r.id === ME_ID);
      const packMe = ranked().find((r) => r.id === ME_ID);
      box.dataset.mode = pme && !packMe ? 'pick' : 'pack'; // pme = only when picking (something collected in the last hour)
      if (C.widget !== false && box.dataset.mode === 'pick') {
        const key = JSON.stringify(['pick', th, pme.tier, pme.rank, pme.live.m15, pme.live.idleMin, pme.live.batch, pl.length]);
        if (key !== shown) {
          shown = key;
          const gap = pme.rank > 1 ? pl[0].live.m15 - pme.live.m15 : 0, bt = pme.live.batch;
          box.innerHTML = `<div class="lb-card t-${pme.tier}"><div class="lb-rank">#${pme.rank}</div><div class="lb-main">
            <div class="lb-pts">${fmt(pme.live.m15)} <small>pick pts · 15 min</small></div>
            <div class="lb-sub"><span class="${idleCls(pme)}">${idleTxt(pme)}</span>${bt ? ` · batch ${int(bt.items)}/${int(bt.total)}` : ''} · ${pme.rank === 1 ? `#1 of ${pl.length}` : `${fmt(gap)} behind #1`}</div></div></div>`;
          if (prevRank != null && pme.rank !== prevRank) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
          prevRank = pme.rank;
        }
      } else if (C.widget !== false) {
        const list = ranked();
        const me = list.find((r) => r.id === ME_ID);
        const key = JSON.stringify([th, me && me.tier, me && me.rank, me && me.points, me && me.kingMin, list.length]);
        if (key !== shown) {
          shown = key;
          const mins = Math.round(WIN / 60000);
          const gap = me && me.rank > 1 ? list[0].points - me.points : 0;
          box.innerHTML = `<div class="lb-card t-${me ? me.tier : 'none'}"><div class="lb-rank">${me ? '#' + me.rank : '–'}</div><div class="lb-main">
            <div class="lb-pts">${me ? fmt(me.points) : 0} <small>pts · ${mins} min</small></div>
            <div class="lb-sub">${me ? (me.king ? `<span class="lb-king">👑 king${me.kingMin != null ? ` · ${me.kingMin} min` : ''}</span>` : `${me.n} closed · ${me.rank === 1 ? `#1 of ${list.length}` : `${fmt(gap)} behind #1`}`) : list.length ? `${list.length} on the board` : 'nobody closed one yet'}</div></div></div>`;
          if (me && prevRank != null && me.rank !== prevRank) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
          prevRank = me ? me.rank : null;
        }
      }
      if (listOpen) showList(true);
      if (pkTab === 'pack') showPk(true);
    }

    function overlay(id) {
      let ov = document.getElementById(id);
      if (!ov) {
        ov = document.createElement('div');
        ov.id = id;
        ov.className = 'pq-lb-ov pq-lbx';
        ov.addEventListener('click', (e) => { if (e.target === ov) close(id); });
        document.body.appendChild(ov);
      }
      ov.classList.toggle('dark', theme() === 'dark');
      return ov;
    }
    function close(id) {
      document.getElementById(id)?.remove();
      if (id === 'pq-lb-ov') listOpen = false;
      if (id === 'pq-pf-ov') { aimUid = null; chatWatch(false); }
      if (id === 'pq-pk-ov') { clearInterval(pkTimer); pkTimer = null; pkTv = false; if (/^#pickers/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); }
    }

    const lbGear = () => openToolSettings && openToolSettings({ title: 'Leaderboard', mods: [{ id: 'leaderboard', keys: can('settings') ? null : ['theme', 'widget'] }] });
    // Ctrl+Alt+L: "15 min" = who is fast right now · "Total" = all packing points ever (from the middle stop)
    let listTab = 'now', totQ = '', tot = lsGet('pqsuite_tot_v1', null), totErr = '', totBusy = false, who = null, whoProf = null, whoErr = '';
    async function loadWho(id) {
      who = id; whoProf = null; whoErr = '';
      showList(true);
      try {
        const r = await fetch(`${URL_}/profile?id=${encodeURIComponent(id)}`, { credentials: 'omit', cache: 'no-store' });
        const j = await r.json();
        if (!r.ok || j.err) throw new Error(j.err || `HTTP ${r.status}`);
        if (who === id) whoProf = j;
      } catch (e) { whoErr = e.message; }
      if (listOpen && who === id) showList(true);
    }
    function whoHtml() {
      const p = whoProf, row = ((tot && tot.list) || []).find((x) => x.id === who) || {};
      const nm = escHtml(row.name || `#${who}`);
      const back = '<button class="lb-back" data-lb="back">← Total</button>';
      if (!p) return `${back}<h3 class="lb-who">${nm}</h3><div class="lb-meta">${whoErr ? '⚠ ' + escHtml(whoErr) : 'Loading…'}</div>`;
      const t = p.today || {}, maxW = Math.max(1, ...(p.week || []).map((w) => w.points || 0));
      const tile = (v, l) => `<div class="pf-tile"><b>${v}</b><span>${l}</span></div>`;
      return `${back}<div class="pf-head"><div><h3 class="lb-who">${nm}</h3><div class="lb-meta" style="margin:2px 0 0">${p.king ? `👑 king right now · ${p.king.min} min` : p.rankToday ? `#${p.rankToday} today of ${p.ofToday}` : 'nothing closed today'}${p.skin ? ' · wears ' + escHtml(p.skin) : ''}</div></div>
        <div class="pf-bal"><b>${int(p.balance)}</b><span>coins now</span></div></div>
        <div class="pf-tiles">
          ${tile(int(p.coins), 'coins earned in total')}${tile(int(p.spent), 'coins spent')}${tile(fmt(p.points), 'packing points in total')}${tile(int(p.picklists), 'closed in total')}
          ${tile((p.kingBest || 0) + ' min', 'longest king at once')}${tile((p.kingTotal || 0) + ' min', 'king in total')}${tile(int(Math.round((p.kingTotal || 0) * 20)), 'coins from king')}${tile((p.owned || []).length, 'skins owned')}
          ${tile(t.n || 0, 'closed today')}${tile(fmt(t.points), 'points today')}${tile(`${t.multis || 0} / ${t.singles || 0}`, 'multi / single today')}${tile((t.kingMin || 0) + ' min', 'king today')}
          ${tile(fmt(p.pickPoints), 'pick points in total')}${tile(int(p.batches), 'batches in total')}${tile(fmt((p.pickToday || {}).points), 'pick points today')}${tile(int((p.pickToday || {}).batches), 'batches today')}
        </div>
        <h3>Last days</h3>
        <div class="pf-week">${(p.week || []).map((w) => `<div title="${escHtml(w.day)} · ${fmt(w.points)} pts · ${w.n} closed"><i style="height:${Math.round(((w.points || 0) / maxW) * 48)}px"></i>${escHtml(w.day.slice(8, 10))}</div>`).join('')}</div>
        ${(p.owned || []).length ? `<div class="lb-meta" style="margin-top:10px">skins: ${p.owned.map(escHtml).join(', ')}</div>` : ''}`;
    }
    async function loadTotals() {
      if (!URL_ || totBusy) return;
      totBusy = true;
      try {
        const r = await fetch(`${URL_}/totals`, { credentials: 'omit', cache: 'no-store' });
        const j = await r.json();
        if (!r.ok || !j.people) throw new Error(j.err || `HTTP ${r.status}`);
        const map = await names().catch(() => ({}));
        tot = { at: j.at, list: j.people.filter((x) => !proxies.has(String(x.id))).map((x) => ({ ...x, id: String(x.id), name: map[x.id] || `#${x.id}` })) };
        lsSet('pqsuite_tot_v1', tot); // names for trading / items show up right away next time
        totErr = '';
      } catch (e) { totErr = e.message; } finally { totBusy = false; }
      if (listOpen && listTab === 'total') showList(true);
    }
    function showList(refresh) {
      if (refresh && !document.getElementById('pq-lb-ov')) return;
      const qf = document.activeElement && document.activeElement.classList.contains('lb-q') ? document.activeElement.selectionStart : null;
      close('pq-pf-ov');
      const ov = overlay('pq-lb-ov');
      listOpen = true;
      if (!isOwner()) listTab = 'now'; // Total: only Ahmad
      const tabs = !isOwner() ? '' : `<div class="lb-tabs"><button data-lt="now" class="${listTab === 'now' ? 'on' : ''}">Last ${Math.round(WIN / 60000)} min</button><button data-lt="total" class="${listTab === 'total' ? 'on' : ''}">Total</button></div>`;
      let body;
      if (listTab === 'total') {
        const hm = tot && tot.at ? new Date(tot.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
        const meta = !URL_ ? 'needs the middle stop (Shift+8 → Leaderboard)' : `coins everyone has now · click someone for everything · ${hm}${totErr ? ' · ⚠ ' + escHtml(totErr) : ''}`;
        const rows = (tot && tot.list) || [];
        let rank = 0, prev = null;
        const ql = low(totQ);
        body = who ? whoHtml() : `<div class="lb-meta">${meta}</div><input class="lb-q" placeholder="Search a name…" value="${escHtml(totQ)}">` + (rows.length ? rows.map((r, i) => {
          if (prev === null || r.balance !== prev) rank = i + 1;
          prev = r.balance;
          return `<div class="lb-row click t-${rank === 1 ? 'gold' : 'none'}${r.id === ME_ID ? ' me' : ''}${ql && !low(r.name).includes(ql) ? ' hide' : ''}" data-n="${escHtml(low(r.name))}" data-who="${escHtml(r.id)}" title="Click for everything about ${escHtml(r.name)}"><span class="r">${rank === 1 ? '🏆' : '#' + rank}</span>
            <span class="nm">${escHtml(r.name)}${r.badges ? `<i class="lb-bd">${escHtml(r.badges)}</i>` : ''}<small>${int(r.picklists)} closed · ${fmt(r.points)} pts${r.pickPoints ? ` · ${fmt(r.pickPoints)} pick pts` : ''}${r.kingTotal ? ` · king ${int(r.kingTotal)} min` : ''}</small></span>
            <span class="v">${int(r.balance)}<small>coins</small></span></div>`;
        }).join('') : `<div class="lb-empty">${URL_ ? (tot ? 'Nobody has coins yet' : 'Loading…') : ''}</div>`);
      } else body = packHtml();
      ov.innerHTML = `<div class="lb-panel"><h2>Leaderboard<button class="lb-gear" title="Leaderboard settings">⚙</button></h2>${tabs}${body}</div>`;
      ov.querySelector('.lb-gear').onclick = () => { close('pq-lb-ov'); lbGear(); };
      ov.querySelectorAll('[data-who]').forEach((b) => (b.onclick = () => loadWho(b.dataset.who)));
      ov.querySelector('[data-lb="back"]')?.addEventListener('click', () => { who = null; showList(true); });
      const q = ov.querySelector('.lb-q');
      if (q) {
        q.addEventListener('input', () => {
          totQ = q.value;
          const v = low(totQ);
          ov.querySelectorAll('.lb-row[data-n]').forEach((r) => r.classList.toggle('hide', !!v && !r.dataset.n.includes(v)));
        });
        if (qf != null) { q.focus(); try { q.setSelectionRange(qf, qf); } catch (_) {} }
      }
      ov.querySelectorAll('[data-lt]').forEach((b) => (b.onclick = () => {
        who = null;
        listTab = b.dataset.lt;
        showList(true);
        if (listTab === 'total' && (!tot || Date.now() - tot.at > 60000)) loadTotals();
      }));
    }

    // ---------- my profile (🪙 button at the top) ----------
    async function loadProfile() {
      if (!URL_ || !ME_ID) return null;
      const r = await fetch(`${URL_}/profile?id=${encodeURIComponent(ME_ID)}`, { credentials: 'omit', cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.err) throw new Error(j.err || `HTTP ${r.status}`);
      return setProf(j);
    }
    async function change(kind, skin) {
      const r = await fetch(`${URL_}/${kind}`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ME_ID, skin }) });
      const j = await r.json();
      if (j.profile) setProf(j.profile);
      return j;
    }
    // ---------- 🪙 panel: Inventory (drop crates, items) · Stats · Shop (skins left, skin crate right, CS-style reel) ----------
    let pfTab = 'inv', spinning = false;
    const nameOfSkin = (id) => ((prof && prof.skins) || []).find((x) => x.id === id)?.name || id;
    function skinCard(p, s) {
      if (!SKIN_LOOK[s.id]) return `<div class="sh-skin"><div class="sh-sw" style="background:repeating-linear-gradient(135deg,#334155 0 8px,#3f4b5f 8px 16px)"></div><div class="sh-in"><b>${escHtml(s.name)}</b><small>update the script</small></div></div>`;
      const worn = 'mySkin' in p ? p.mySkin : p.skin;
      const own = (p.owned || []).includes(s.id), on = worn === s.id, look = SKIN_LOOK[s.id];
      const btn = on ? '<button data-pf="off">Take off</button>' : own ? `<button class="wear" data-pf="wear" data-s="${s.id}">Wear</button>`
        : s.passOnly ? '<button disabled>🎟 Pass</button>'
        : s.crateOnly ? '<button disabled>📦 Drops</button>'
        : s.limit && !s.left ? '<button disabled>Sold out</button>'
        : `<button class="buy" data-pf="buy" data-s="${s.id}" ${p.balance < s.price ? 'disabled' : ''}>${int(s.price)}</button>`;
      return `<div class="sh-skin${on ? ' on' : ''}${own ? ' own' : ''}" style="--r:${RARITY[s.id] || '#94a3b8'}">
        ${s.limit ? `<em class="sh-ltd">★ ${s.left || 0}/${s.limit}</em>` : s.passOnly ? '<em class="sh-only pass">PASS</em>' : s.crateOnly ? '<em class="sh-only">DROP</em>' : ''}
        <div class="sh-sw" style="background:${look.bg}">${on ? '<span>✓</span>' : ''}</div>
        <div class="sh-in"><b>${escHtml(s.name)}${look.crown ? ' 👑' : ''}</b></div><button class="sh-try" data-try="${s.id}" title="try it on for 10 sec">👁</button>${btn}</div>`;
    }
    function spinHtml(p) {
      if (!p.crate) return '';
      const odds = p.crate.odds || [];
      const list = `<div class="sp-list">${odds.slice().sort((a, b) => a.pct - b.pct).map((o) => `<div class="sp-it" style="--r:${RARITY[o.id] || '#94a3b8'}"><i style="background:${(SKIN_LOOK[o.id] || {}).bg || '#334155'}"></i><b>${escHtml(nameOfSkin(o.id))}</b><small>${String(o.pct).replace('.', ',')}%</small>${(p.owned || []).includes(o.id) ? '<em>✓</em>' : ''}<button class="sh-try" data-try="${o.id}" title="try it on for 10 sec">👁</button></div>`).join('')}</div>`;
      return `<div class="sh-crate sp-card">
        <div class="sp-name"><b>Skin crate</b>${ii('crate')}</div>
        <div class="cr-win"><div class="cr-strip">${odds.slice().reverse().concat(odds).map((o) => reelCard(o.id)).join('')}</div><div class="cr-mark"></div></div>
        <div class="cr-res"></div>
        <div class="cr-btns"><button class="buy sp-go" data-crate ${p.balance < p.crate.price ? 'disabled' : ''}>🪙 ${int(p.crate.price)}</button></div>
        <small>${int(p.crates || 0)} opened</small>
      </div>${list}`;
    }
    const reelCard = (id) => { const look = SKIN_LOOK[id] || { bg: '#334155' }; return `<div class="cr-it" style="--r:${RARITY[id] || '#94a3b8'}"><div class="cr-sw" style="background:${look.bg}"></div><b>${escHtml(nameOfSkin(id))}</b></div>`; };
    function statsHtml(p) {
      const t = p.today || {}, maxW = Math.max(1, ...(p.week || []).map((w) => w.points || 0));
      const tile = (v, l) => `<div class="pf-tile"><b>${v}</b><span>${l}</span></div>`;
      return `<div class="pf-tiles">
          ${tile(t.n || 0, 'closed today')}${tile(fmt(t.points), 'points today')}${tile(`${t.multis || 0} / ${t.singles || 0}`, 'multi / single')}${tile((t.kingMin || 0) + ' min', 'king today')}
          ${tile(fmt((p.pickToday || {}).points), 'pick points today')}${tile(int((p.pickToday || {}).batches), 'batches today')}${tile(int((p.pickToday || {}).locations), 'locations today')}${tile(int((p.pickToday || {}).items), 'products picked today')}
          ${tile(int(p.picklists), 'closed in total')}${tile(fmt(p.pickPoints), 'pick points in total')}${tile(int(p.batches), 'batches in total')}${tile(int(p.spent), 'coins spent')}
          ${tile((p.kingTotal || 0) + ' min', 'king in total')}${tile((p.kingBest || 0) + ' min', 'longest king streak')}${tile(int(p.coins), 'coins earned in total')}${tile(int(p.crates || 0), 'skin crates opened')}
          ${tile('🔥 ' + ((p.streak || {}).n || 0), 'day streak')}${tile((p.streak || {}).best || 0, 'best streak')}${tile(`${fmt((p.streak || {}).today)} / ${(p.streak || {}).goal || 100}`, 'streak goal today')}${tile(`${int((p.pity || {}).dry)} / ${int((p.pity || {}).at || 3000)}`, 'rolls to a sure rare crate')}
        </div>
        ${(p.ach || []).length ? `<h3>Achievements <small>${(p.ach || []).filter((x) => x.at).length}/${(p.ach || []).length}</small></h3><div class="ac-grid">${(p.ach || []).map((x) => `<div class="ac${x.at ? ' on' : ''}" title="${escHtml(x.desc)}${x.at ? ' · ' + new Date(x.at).toLocaleDateString('nl-NL') : ''}"><span>${escHtml(x.icon)}</span><b>${escHtml(x.name)}</b><small>${escHtml(x.desc)}</small></div>`).join('')}</div>` : ''}
        <h3>Last days ${ii('coins')}</h3>
        <div class="pf-week">${(p.week || []).map((w) => `<div title="${escHtml(w.day)} · ${fmt(w.points)} pts · ${w.n} closed"><i style="height:${Math.round(((w.points || 0) / maxW) * 48)}px"></i>${escHtml(w.day.slice(8, 10))}</div>`).join('')}</div>`;
    }
    function showProfile(note) {
      if (spinning) return;
      if (aimUid && document.activeElement && document.activeElement.classList.contains('iv-q') && !note) return; // typing a name: leave it
      if (pfTab === 'chat' && !note && document.activeElement && document.activeElement.classList.contains('ch-q')) return;
      close('pq-lb-ov');
      const ov = overlay('pq-pf-ov');
      ov.classList.add('sh');
      const nm = escHtml(ME.name || 'You');
      if (!URL_) { ov.innerHTML = `<div class="lb-panel"><h2>${nm}</h2><div class="lb-meta">The shop needs the middle stop (Shift+8 → Leaderboard)</div></div>`; return; }
      if (!prof) { ov.innerHTML = `<div class="lb-panel"><h2>Shop</h2><div class="lb-meta">${note ? escHtml(note) : 'Loading…'}</div></div>`; return; }
      const p = prof;
      const T = (k, t) => `<button data-pt="${k}" class="${pfTab === k ? 'on' : ''}">${t}</button>`;
      const nInv = (p.inv || []).length;
      ov.innerHTML = `<div class="lb-panel sh-panel">
        <div class="sh-top">
          <div class="lb-tabs">${T('inv', `Inventory${nInv ? ` <i class="sh-n">${nInv}</i>` : ''}`)}${can('chat') ? T('chat', `Chat${unreadOf(p) ? ` <i class="sh-n">${unreadOf(p)}</i>` : ''}`) : ''}${T('pass', 'Pass')}${T('spin', 'Spin')}${T('stats', 'Stats')}${T('shop', 'Shop')}${T('set', '⚙')}</div>
          <div class="sh-coins">🪙 <b>${int(p.balance)}</b></div>
          <button class="sh-x" data-pf-close title="Esc">✕</button>
        </div>
        ${note ? `<div class="sh-note">${escHtml(note)}</div>` : ''}
        ${pfTab === 'inv' ? invHtml(p) : pfTab === 'chat' && can('chat') ? chatHtml(p) : pfTab === 'pass' ? passHtml(p) : pfTab === 'spin' ? spinHtml(p) : pfTab === 'stats' ? statsHtml(p) : pfTab === 'set' ? setHtml() : (() => {
          const notMine = (p.skins || []).filter((s) => !(p.owned || []).includes(s.id));
          return `<h3>Skins ${ii('skins')}</h3>${notMine.length ? `<div class="sh-grid">${notMine.map((s) => skinCard(p, s)).join('')}</div>` : '<div class="iv-empty">you own every skin</div>'}`;
        })()}
      </div>`;
      ov.querySelector('[data-pf-close]').onclick = () => close('pq-pf-ov');
      ov.querySelectorAll('[data-pt]').forEach((b) => (b.onclick = () => { pfTab = b.dataset.pt; aimUid = null; showProfile(); }));
      if (pfTab === 'inv') wireInv(ov);
      if (pfTab === 'set') wireSet(ov);
      ov.querySelectorAll('[data-try]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); trySkin(b.dataset.try); }));
      if (pfTab === 'pass') wirePass(ov);
      if (pfTab === 'chat') wireChat(ov); else chatWatch(false);
      wireInfo(ov);
      ov.querySelector('[data-crate]')?.addEventListener('click', (e) => openCrate(e.currentTarget));
      // park the idle reel somewhere in the middle
      const idle = ov.querySelector('.cr-strip');
      if (idle) idle.style.transform = `translate3d(${-Math.max(0, idle.scrollWidth / 2 - ov.querySelector('.cr-win').clientWidth / 2)}px,0,0)`;
      ov.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', async () => {
        const kind = b.dataset.pf === 'buy' ? 'buy' : 'equip';
        const skin = b.dataset.pf === 'off' ? null : b.dataset.s;
        if (b.dataset.pf === 'buy' && !confirm(`Buy ${nameOfSkin(skin)} for ${int((p.skins.find((s) => s.id === skin) || {}).price)} coins?`)) return;
        b.disabled = true;
        try { const j = await change(kind, skin); showProfile(j.err || (kind === 'buy' ? `${nameOfSkin(skin)} bought ✓` : '')); } catch (e) { showProfile('could not reach the middle stop'); }
      }));
    }
    // ---------- crate: the middle stop picks the skin, then the reel spins to it (right side of the shop) ----------
    async function openCrate(btn) {
      if (spinning) return;
      if (btn) btn.disabled = true;
      let j;
      try {
        const r = await fetch(`${URL_}/crate`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ME_ID }) });
        j = await r.json();
      } catch (e) { j = { err: 'could not reach the middle stop' }; }
      if (!j.ok) { showProfile(j.err || 'crate failed'); return; }
      const before = prof;
      if (j.profile) setProf(j.profile);
      spin(j, before);
    }
    function spin(j, before) {
      const box = document.querySelector('#pq-pf-ov .sh-crate');
      if (!box) { showProfile(); return; }
      spinning = true;
      const coins = document.querySelector('#pq-pf-ov .sh-coins b');
      if (coins && prof) coins.textContent = int(prof.balance - (j.dup ? j.back : 0));
      const odds = (prof && prof.crate && prof.crate.odds) || [];
      const tot = odds.reduce((n, o) => n + o.pct, 0) || 1;
      const pick = () => { let x = Math.random() * tot; for (const o of odds) { if (x < o.pct) return o.id; x -= o.pct; } return odds[0] ? odds[0].id : j.won; };
      const N = 60, WIN = 52, W = 112;
      const items = Array.from({ length: N }, (_, i) => (i === WIN ? j.won : i === WIN - 1 || i === WIN + 2 ? ['voidescent', 'carbon', 'crown'][Math.floor(Math.random() * 3)] : pick()));
      const winEl = box.querySelector('.cr-win');
      const old = box.querySelector('.cr-strip');
      const strip = document.createElement('div');
      strip.className = 'cr-strip go';
      strip.innerHTML = items.map(reelCard).join('');
      old.replaceWith(strip);
      box.querySelector('.cr-res').textContent = '';
      box.querySelector('.cr-btns').innerHTML = '';
      box.classList.add('spin');
      const stop = WIN * W + W / 2 - winEl.clientWidth / 2 + (Math.random() * 0.7 - 0.35) * (W - 14);
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        spinning = false;
        box.classList.remove('spin');
        strip.style.transition = 'none';
        strip.style.transform = `translate3d(${-stop}px,0,0)`;
        strip.children[WIN].classList.add('won');
        if (coins && prof) coins.textContent = int(prof.balance);
        const nm = escHtml(nameOfSkin(j.won)), rare = ['voidescent', 'carbon', 'crown'].includes(j.won);
        if (rare) box.classList.add('jackpot');
        box.querySelector('.cr-res').innerHTML = (rare ? '<b class="cr-jp">🔥 JACKPOT 🔥</b><br>' : '') + (j.dup
          ? `<b style="color:${RARITY[j.won]}">${nm}</b> · you already had it · <b>+${int(j.back)} coins</b>`
          : `You got <b style="color:${RARITY[j.won]}">${nm}</b>!`);
        const can = prof && prof.crate && prof.balance >= prof.crate.price;
        box.querySelector('.cr-btns').innerHTML = `${!j.dup ? '<button class="wear" data-cr="wear">Wear it</button>' : ''}<button class="buy" data-cr="again" ${can ? '' : 'disabled'}>Again · 🪙 ${int((prof && prof.crate && prof.crate.price) || 0)}</button>`;
        box.querySelectorAll('[data-cr]').forEach((b) => (b.onclick = async () => {
          if (b.dataset.cr === 'wear') { const r = await change('equip', j.won).catch(() => ({})); showProfile(r.err || `wearing ${nameOfSkin(j.won)} ✓`); }
          else { box.classList.remove('jackpot'); b.disabled = true; openCrate(null); }
        }));
        // the skins on the left (owned / balance) follow, without touching the reel
        const left = document.querySelector('#pq-pf-ov .sh-grid');
        if (left && prof) left.innerHTML = (prof.skins || []).map((s) => skinCard(prof, s)).join('');
        document.querySelectorAll('#pq-pf-ov .sh-grid [data-pf]').forEach((b) => b.addEventListener('click', async () => {
          const kind = b.dataset.pf === 'buy' ? 'buy' : 'equip';
          const skin = b.dataset.pf === 'off' ? null : b.dataset.s;
          if (b.dataset.pf === 'buy' && !confirm(`Buy ${nameOfSkin(skin)}?`)) return;
          b.disabled = true;
          const r = await change(kind, skin).catch(() => ({ err: 'could not reach the middle stop' }));
          showProfile(r.err || '');
        }));
      };
      requestAnimationFrame(() => requestAnimationFrame(() => {
        strip.style.transform = `translate3d(${-stop}px,0,0)`;
        strip.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 7500); // tab in the background: still finish
      }));
    }
    async function openProfile(tab) {
      if (document.getElementById('pq-pf-ov') && !tab) return close('pq-pf-ov');
      if (tab) pfTab = tab;
      else if (prof && (prof.inv || []).some((x) => x.kind === 'crate')) pfTab = 'inv';
      showProfile();
      try { await loadProfile(); showProfile(); } catch (e) { showProfile('could not load: ' + e.message); }
    }


    // ---------- 🪙 next to Picqer's own header buttons: coins + a tiny "+20 coins" when they go up ----------
    const TIER_COL = { common: '#b0c3d9', uncommon: '#5e98d9', rare: '#4b69ff', epic: '#d32ce6', legendary: '#e4ae39' };
    const TIER_ICON = { common: '📦', uncommon: '📦', rare: '🎁', epic: '🎁', legendary: '💎' };
    const TIER_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    const ITEM_ICON = { boost: '⚡', shield: '🛡️', freeze: '❄️', skinoff: '🧥', double: '✨' };
    const ITEM_COL = { boost: '#10b981', shield: '#0ea5e9', freeze: '#38bdf8', skinoff: '#ef4444', double: '#f59e0b' };
    const LS_PROF = 'pqsuite_prof_v1', LS_NEWS = 'pqsuite_news_seen_v1';
    const fmt3 = (x) => (Math.round((+x || 0) * 1000) / 1000).toLocaleString('nl-NL');
    const tierName = (t) => (((prof && prof.tiers) || []).find((x) => x.id === t) || {}).name || (t ? t[0].toUpperCase() + t.slice(1) : '');
    const tierOne = (t) => (((prof && prof.tiers) || []).find((x) => x.id === t) || {}).one || ({ common: 150, uncommon: 500, rare: 2000, epic: 8000, legendary: 30000 })[t] || 0;
    const itemDef = (k) => ((prof && prof.items) || {})[k] || { name: k || '?', desc: '' };
    const leftTxt = (until) => { const m = Math.max(1, Math.ceil((until - Date.now()) / 60000)); return m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`; };
    const agoTxt = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
    let lastBal = (() => { const c = lsGet(LS_PROF, null); return c && c.id === ME_ID && c.p ? c.p.balance : null; })();

    addStyle('pq-hb-style', `
      #pq-hb{display:inline-flex !important;align-items:center;gap:6px;width:auto !important;min-width:0 !important;padding:0 10px !important;position:relative;text-decoration:none !important;cursor:pointer}
      #pq-hb .pq-hb-n{font:600 12.5px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;opacity:.9;white-space:nowrap}
      #pq-hb.pq-hb-x2 .pq-hb-n::after{content:" x2";color:#f59e0b;font-weight:800}
      #pq-hb.pq-hb-frozen .pq-hb-n{opacity:.45}
      #pq-hb.pq-hb-new::before{content:"";position:absolute;top:9px;left:20px;width:7px;height:7px;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 2px rgba(0,0,0,.15)}
      #pq-hb .pq-hb-plus{position:absolute;right:8px;top:calc(100% - 6px);font:600 10.5px system-ui,sans-serif;color:#10b981;white-space:nowrap;pointer-events:none;opacity:0;animation:pqPlus 2.8s ease forwards}
      @keyframes pqPlus{0%{opacity:0;transform:translateY(5px)}18%{opacity:.8;transform:none}70%{opacity:.8}100%{opacity:0;transform:translateY(-6px)}}
      .pq-drop{position:fixed;left:50%;top:72px;z-index:2147483003;display:flex;align-items:center;gap:14px;padding:14px 24px 14px 16px;border-radius:14px;overflow:hidden;background:#0b0b12;color:#e2e8f0;
        border:1px solid color-mix(in srgb,var(--r) 60%,transparent);box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 44px color-mix(in srgb,var(--r) 35%,transparent);cursor:pointer;
        transform:translateX(-50%);animation:dpIn .65s cubic-bezier(.2,1.4,.4,1) both;font-family:system-ui,sans-serif}
      .pq-drop.out{animation:dpOut .4s ease forwards}
      .pq-drop .dp-box{font-size:30px;width:52px;height:52px;display:grid;place-items:center;border-radius:12px;background:radial-gradient(circle,color-mix(in srgb,var(--r) 45%,transparent),transparent 70%);animation:dpShake .45s ease-in-out .55s 3}
      .pq-drop .dp-t small{display:block;color:#94a3b8;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em}
      .pq-drop .dp-t b{display:block;font:800 18px system-ui,sans-serif;color:var(--r);letter-spacing:.02em;margin:1px 0}
      .pq-drop .dp-t span{font:700 12.5px system-ui,sans-serif;color:#cbd5e1}
      .pq-drop.t-epic::after,.pq-drop.t-legendary::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.2) 50%,transparent 65%);background-size:250% 100%;animation:dpShine 1.5s ease .6s 3;pointer-events:none}
      @keyframes dpIn{0%{opacity:0;transform:translate(-50%,-34px) scale(.8)}100%{opacity:1;transform:translate(-50%,0) scale(1)}}
      @keyframes dpOut{to{opacity:0;transform:translate(-50%,-16px) scale(.96)}}
      @keyframes dpShake{0%,100%{transform:rotate(0)}25%{transform:rotate(-10deg) scale(1.08)}75%{transform:rotate(10deg) scale(1.08)}}
      @keyframes dpShine{0%{background-position:150% 0}100%{background-position:-50% 0}}
      .iv-rev{position:fixed;inset:0;z-index:2147483004;background:rgba(5,5,10,.84);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#e2e8f0;font-family:system-ui,sans-serif}
      .iv-rev .rv-box{font-size:86px;filter:drop-shadow(0 0 34px var(--r));animation:rvShake .42s ease-in-out infinite}
      .iv-rev .rv-tier{font:800 22px system-ui,sans-serif;color:var(--r);letter-spacing:.08em;text-transform:uppercase}
      .iv-rev .rv-odds{color:#94a3b8;font:600 13px system-ui,sans-serif}
      .iv-rev .rv-sf{display:none;width:200px;height:200px;border-radius:20px;background:#0b0b12;border:1px solid color-mix(in srgb,var(--r) 70%,transparent);box-shadow:0 0 60px color-mix(in srgb,var(--r) 40%,transparent);align-items:center;justify-content:center;transition:border-color .15s,box-shadow .15s}
      .iv-rev.sf .rv-sf{display:flex}
      .iv-rev.sf .rv-box,.iv-rev.sf .rv-odds{display:none}
      .iv-rev.sf .rv-tier{display:block !important}
      .iv-rev .sf-it{display:flex;flex-direction:column;align-items:center;gap:10px;animation:sfPop .16s cubic-bezier(.2,1.6,.4,1)}
      .iv-rev .sf-it b{font:800 15px system-ui,sans-serif;color:#fff;text-align:center;max-width:180px}
      .iv-rev .sf-ic{font-size:64px;line-height:1}
      .iv-rev .sf-sw{width:130px;height:70px;border-radius:12px;border:1px solid rgba(255,255,255,.15)}
      .iv-rev .sf-it.win{animation:sfWin .6s cubic-bezier(.2,1.6,.4,1)}
      .iv-rev .sf-it.win b{color:var(--r);font-size:18px}
      .iv-rev.open .rv-sf{transform:scale(1.06);box-shadow:0 0 90px color-mix(in srgb,var(--r) 60%,transparent);transition:transform .4s}
      .iv-rev.jackpot .rv-sf{border-color:#fbbf24;box-shadow:0 0 0 2px #fbbf24,0 0 120px rgba(251,191,36,.55)}
      .iv-rev .rv-res{display:none;flex-direction:column;align-items:center;gap:8px;min-height:70px}
      .iv-rev.open .rv-res{display:flex;animation:rvIn .4s ease both}
      .iv-rev .rv-res span{color:#cbd5e1;font-size:13px}
      @keyframes sfPop{0%{transform:scale(.55);opacity:.2}100%{transform:scale(1);opacity:1}}
      @keyframes sfWin{0%{transform:scale(.4)}60%{transform:scale(1.25)}100%{transform:scale(1)}}
      .iv-rev .rv-got{display:none;flex-direction:column;align-items:center;gap:8px;min-width:240px;padding:24px 32px;border-radius:16px;background:#0b0b12;border:1px solid var(--r);box-shadow:0 0 70px color-mix(in srgb,var(--r) 45%,transparent);animation:rvIn .55s cubic-bezier(.2,1.4,.4,1) both;text-align:center}
      .iv-rev.open .rv-got{display:flex}
      .iv-rev.open .rv-box,.iv-rev.open .rv-tier,.iv-rev.open .rv-odds{display:none}
      .iv-rev .rv-ic{font-size:56px;line-height:1.1}
      .iv-rev .rv-sw{width:150px;height:62px;border-radius:10px;border:1px solid rgba(255,255,255,.15)}
      .iv-rev .rv-got small{color:var(--r);font:800 11px system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase}
      .iv-rev .rv-got b{font:800 21px system-ui,sans-serif;color:#fff}
      .iv-rev .rv-got span{color:#cbd5e1;font-size:13px}
      .iv-rev .rv-btns{display:flex;gap:8px;margin-top:8px}
      .iv-rev button{padding:9px 18px;border-radius:9px;border:1px solid #2a2a38;background:#16161f;color:#fff;font:800 13px system-ui,sans-serif;cursor:pointer}
      .iv-rev button.go{background:linear-gradient(90deg,#6366f1,#a855f7);border:0}
      .iv-rev button:disabled{opacity:.45;cursor:default}
      @keyframes rvShake{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-9deg) scale(1.07)}75%{transform:rotate(9deg) scale(1.07)}}
      @keyframes rvIn{0%{opacity:0;transform:scale(.55)}100%{opacity:1;transform:scale(1)}}
      .sh .iv-ev{margin:12px 0 0;padding:10px 14px;border-radius:10px;background:linear-gradient(90deg,#f59e0b,#ec4899);color:#fff;font:700 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(236,72,153,.3)}
      .sh .iv-eff{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
      .sh .iv-eff span{padding:5px 10px;border-radius:999px;font:600 12px system-ui,sans-serif;border:1px solid var(--line);background:var(--soft)}
      .sh .iv-eff .good{color:#059669} .sh .iv-eff .bad{color:#e11d48}
      .sh h3 small{color:var(--mut);font-weight:500;margin-left:4px}
      .sh .iv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
      .sh .iv-c{position:relative;border:1px solid var(--line);border-radius:12px;padding:12px 12px 10px;background:var(--bg);display:flex;flex-direction:column;align-items:center;text-align:center;gap:3px;overflow:hidden}
      .sh .iv-c::before{content:"";position:absolute;left:0;right:0;top:0;height:64px;background:radial-gradient(circle at 50% 0,color-mix(in srgb,var(--r) 32%,transparent),transparent 70%);pointer-events:none}
      .sh .iv-c::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--r)}
      .sh .iv-ic{font-size:30px;line-height:1.25;position:relative}
      .sh .iv-c b{font:700 13.5px system-ui,sans-serif;color:var(--r);position:relative}
      .sh .iv-c small{color:var(--mut);font-size:11px;min-height:28px;position:relative}
      .sh .iv-c button{margin-top:6px;width:100%;padding:6px 0;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:700 12.5px system-ui,sans-serif;cursor:pointer;position:relative}
      .sh .iv-empty{color:var(--mut);font-size:12.5px;padding:6px 0 4px}
      .sh .iv-odds{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px;font-size:11px;color:var(--mut)}
      .sh .iv-odds i{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--r);margin-right:5px}
      .sh .iv-aim{margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}
      .sh .iv-aim-h{display:flex;align-items:center;justify-content:space-between;font:700 13.5px system-ui,sans-serif}
      .sh .iv-aim input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:500 13px system-ui,sans-serif;margin:8px 0;outline:none}
      .sh .iv-aim input:focus{border-color:#6366f1}
      .sh .iv-ppl{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:2px}
      .sh .iv-ppl button{text-align:left;border:0;background:none;color:var(--fg);font:600 13px system-ui,sans-serif;padding:7px 10px;border-radius:7px;cursor:pointer;display:flex;justify-content:space-between;gap:10px}
      .sh .iv-ppl button:hover{background:var(--hi)}
      .sh .iv-ppl button small{color:var(--mut);font-weight:500}
      .sh .iv-ppl .hide{display:none}
      .sh .iv-streak{margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);display:flex;flex-direction:column;gap:7px}
      .sh .iv-streak b{display:block;font:800 15px system-ui,sans-serif}
      .sh .iv-streak small{color:var(--mut);font-size:11.5px}
      .sh .iv-bar{height:7px;border-radius:999px;background:var(--line);overflow:hidden}
      .sh .iv-bar i{display:block;height:100%;background:linear-gradient(90deg,#f97316,#facc15);border-radius:999px}
      .sh .iv-trade{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}
      .sh .iv-trade button{padding:7px 14px;border-radius:9px;border:1px solid var(--line);font:700 12.5px system-ui,sans-serif;cursor:pointer}
      .sh .iv-trade small{color:var(--mut);font-size:11.5px}
      .sh .iv-set{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);cursor:pointer;margin-bottom:8px}
      .sh .iv-set input{margin-top:3px;width:16px;height:16px;accent-color:#6366f1}
      .sh .iv-set b{display:block;font:700 13.5px system-ui,sans-serif}
      .sh .iv-set small{color:var(--mut);font-size:12px}
      .pq-drop.feed{top:auto;bottom:90px;left:auto;right:16px;transform:none;animation:dpInR .6s cubic-bezier(.2,1.3,.4,1) both;padding:10px 18px 10px 12px}
      .pq-drop.feed.out{animation:dpOutR .4s ease forwards}
      .pq-drop.feed .dp-box{font-size:22px;width:38px;height:38px}
      .pq-drop.feed .dp-t b{font-size:14.5px}
      @keyframes dpInR{0%{opacity:0;transform:translateX(40px)}100%{opacity:1;transform:none}}
      @keyframes dpOutR{to{opacity:0;transform:translateX(30px)}}
      .pq-drop.tr-ask{cursor:default}
      .pq-drop .tr-ab{display:flex;gap:6px;margin-left:8px}
      .pq-drop .tr-ab button{padding:7px 12px;border-radius:8px;border:1px solid #2a2a38;background:#16161f;color:#fff;font:700 12.5px system-ui,sans-serif;cursor:pointer}
      .pq-drop .tr-ab button.yes{background:#6366f1;border-color:#6366f1}
      #pq-trade{z-index:2147483003}
      #pq-trade .tr-panel{width:min(760px,100%)}
      #pq-trade h2 span{font:700 18px system-ui,sans-serif}
      #pq-trade .tr-cols,#pq-trade .tr-done{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:6px}
      #pq-trade .tr-col{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--soft);min-width:0}
      #pq-trade h3{font:700 13px system-ui,sans-serif;margin:0 0 8px}
      #pq-trade h3.tr-sub{margin:12px 0 8px}
      #pq-trade .tr-coins{display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:13px}
      #pq-trade .tr-coins input{width:110px;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:600 13px system-ui,sans-serif}
      #pq-trade .tr-coins small{color:var(--mut)}
      #pq-trade .tr-chips{display:flex;flex-wrap:wrap;gap:6px}
      #pq-trade .tr-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:600 12px system-ui,sans-serif;cursor:pointer}
      #pq-trade span.tr-chip{cursor:default}
      #pq-trade .tr-chip.on{border-color:var(--r);box-shadow:0 0 0 1px var(--r) inset;background:color-mix(in srgb,var(--r) 14%,var(--bg))}
      #pq-trade .tr-chip i{width:14px;height:14px;border-radius:4px;display:inline-block}
      #pq-trade .tr-none{color:var(--mut);font-size:12px}
      #pq-trade .tr-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
      #pq-trade .tr-foot button{padding:9px 20px;border-radius:9px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:800 13px system-ui,sans-serif;cursor:pointer}
      #pq-trade .tr-foot button.buy{background:#6366f1;border-color:#6366f1;color:#fff}
      #pq-trade .tr-foot button:disabled{opacity:.6;cursor:default}
      #pq-trade #tr-st{font:600 13px system-ui,sans-serif}
      @media (max-width:640px){#pq-trade .tr-cols,#pq-trade .tr-done{grid-template-columns:1fr}}
      .sh .lb-tabs .sh-n{font-style:normal;font-size:10.5px;background:#6366f1;color:#fff;border-radius:999px;padding:0 6px;margin-left:3px}
      .sh .sh-top{gap:12px}
      .sh .sh-top .lb-tabs{flex:1;width:auto;max-width:max-content}
      .sh .sh-coins{display:flex;align-items:center;gap:6px;padding:6px 12px;margin-left:auto}
      .sh .sh-coins b{display:inline;font:800 17px system-ui,sans-serif}
      .sh h3{display:flex;align-items:center;gap:6px}
      .pq-lbx .ii{width:16px;height:16px;border-radius:50%;border:1px solid var(--line);background:var(--soft);color:var(--mut);font:700 10px/14px system-ui,sans-serif;padding:0;cursor:pointer;flex:none;display:inline-grid;place-items:center}
      .pq-lbx .ii:hover{color:var(--fg);border-color:var(--mut)}
      .ii-pop{position:fixed;z-index:2147483005;width:260px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.22);padding:12px 14px;font:500 12.5px/1.45 system-ui,sans-serif}
      .ii-pop b{display:block;font:700 13px system-ui,sans-serif;margin-bottom:6px}
      .ii-pop p{margin:6px 0 0;color:var(--mut)}
      .ii-pop .ii-r{display:flex;align-items:center;gap:7px;padding:2px 0}
      .ii-pop .ii-r i{width:8px;height:8px;border-radius:2px;flex:none}
      .ii-pop .ii-r span{margin-left:auto;color:var(--mut);text-align:right;font-variant-numeric:tabular-nums;padding-left:10px}
      .sh .iv-top{display:flex;align-items:center;gap:8px;margin-top:14px}
      .sh .iv-top .iv-streak{flex:1;margin:0;flex-direction:row;align-items:center;gap:10px;padding:9px 12px}
      .sh .iv-streak b{font:800 14px system-ui,sans-serif;white-space:nowrap}
      .sh .iv-streak .iv-bar{flex:1}
      .sh .iv-streak small{white-space:nowrap;font-variant-numeric:tabular-nums}
      .sh .iv-tr{width:40px;height:40px;border-radius:10px;border:1px solid var(--line);background:var(--soft);font-size:18px;cursor:pointer}
      .sh .iv-tr:hover{background:var(--hi)}
      .sh .iv-c{padding:12px 10px 10px}
      .sh .iv-c b{font-size:13px}
      .sh .iv-empty{color:var(--mut)}
      .sh .iv-sets{display:flex;flex-direction:column;gap:6px;margin-top:14px;max-width:360px}
      .sh .iv-set{justify-content:space-between;align-items:center;margin:0;font:600 13.5px system-ui,sans-serif}
      .sh .iv-set input{margin:0}
      .sh .sh-only.pass{background:linear-gradient(90deg,#e4ae39,#f59e0b);color:#1c1400}
      .sh .sh-ct{justify-content:space-between}
      .sh .sh-ct > div:nth-child(2){flex:1}
      .sh .sh-crate .ii{border-color:#2a2a38;background:#16161f;color:#94a3b8}
      .sh .bp-head{display:flex;align-items:center;justify-content:space-between;margin-top:16px}
      .sh .bp-name{display:flex;align-items:center;gap:8px}
      .sh .bp-name b{font:800 18px system-ui,sans-serif}
      .sh .bp-name small{color:var(--mut);font-size:12px}
      .sh .bp-own{color:#10b981;font:800 15px system-ui,sans-serif}
      .sh .bp-buy{padding:8px 16px;border-radius:9px;border:0;font:800 13px system-ui,sans-serif;cursor:pointer}
      .sh .bp-lv{display:flex;align-items:center;gap:12px;margin:14px 0 12px}
      .sh .bp-n{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font:800 17px system-ui,sans-serif;background:linear-gradient(135deg,#e4ae39,#f59e0b);color:#1c1400}
      .sh .bp-bar{flex:1;height:8px;border-radius:999px;background:var(--line);overflow:hidden}
      .sh .bp-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#e4ae39,#f59e0b)}
      .sh .bp-x{color:var(--mut);font:600 12px system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}
      .sh .bp-track{display:flex;gap:8px;overflow-x:auto;padding:4px 2px 10px;scroll-behavior:smooth}
      .sh .bp-t{position:relative;flex:none;width:72px;height:88px;border-radius:12px;border:1px solid var(--line);background:var(--soft);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;overflow:hidden}
      .sh .bp-t::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--r);opacity:.5}
      .sh .bp-t small{position:absolute;top:5px;left:7px;color:var(--mut);font:700 10.5px system-ui,sans-serif}
      .sh .bp-t .bp-ic{font-size:24px;line-height:1}
      .sh .bp-t em{font:700 10.5px system-ui,sans-serif;font-style:normal;color:var(--mut);min-height:12px}
      .sh .bp-t.big{width:96px;background:radial-gradient(circle at 50% 30%,color-mix(in srgb,var(--r) 25%,transparent),var(--soft) 70%)}
      .sh .bp-sw{display:block;width:44px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,.2)}
      .sh .bp-t.reach{border-color:var(--r)}
      .sh .bp-t.got{border-color:var(--r);background:color-mix(in srgb,var(--r) 12%,var(--bg))}
      .sh .bp-t.got::before{content:"✓";position:absolute;top:4px;right:7px;color:#10b981;font:800 11px system-ui,sans-serif}
      .sh .bp-t.got::after{opacity:1}
      .sh .bp-t.next{outline:2px solid #e4ae39;outline-offset:1px}
      .sh .bp-track.locked .bp-t:not(.reach){opacity:.55}
      .pq-drop .dp-box .bp-sw{width:38px;height:24px;border-radius:6px;display:block}
      .sh .sp-card{margin:28px auto 8px;max-width:640px;padding:28px 24px 20px;border-radius:18px;background:#0b0b12;color:#e2e8f0;border:1px solid #20202c;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:inset 0 0 60px rgba(168,85,247,.12)}
      .sh .sp-box{font-size:64px;line-height:1;filter:drop-shadow(0 0 24px rgba(168,85,247,.6));animation:spFloat 3s ease-in-out infinite}
      .sh .sp-name{display:flex;align-items:center;gap:8px}
      .sh .sp-card .cr-win{align-self:stretch;margin:4px 0}
      .sh .sp-card .cr-res{min-height:20px}
      .sh .sp-name b{font:800 18px system-ui,sans-serif;color:#fff}
      .sh .sp-card .ii{border-color:#2a2a38;background:#16161f;color:#94a3b8}
      .sh .sp-row{display:flex;flex-wrap:wrap;justify-content:center;gap:5px;max-width:300px}
      .sh .sp-row i{width:26px;height:16px;border-radius:4px;border-bottom:2px solid var(--r)}
      .sh .sp-go{padding:11px 28px;border-radius:11px;border:0;font:800 14px system-ui,sans-serif;cursor:pointer;background:linear-gradient(90deg,#6366f1,#a855f7) !important;color:#fff;box-shadow:0 8px 24px rgba(139,92,246,.35)}
      .sh .sp-go:disabled{opacity:.45;cursor:default}
      .sh .sp-card small{color:#64748b;font-size:11.5px}
      @keyframes spFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
      .sh .ch-wrap{display:grid;grid-template-columns:240px 1fr;gap:14px;margin-top:14px;height:min(460px,60vh)}
      .sh .ch-left{display:flex;flex-direction:column;gap:4px;overflow:auto;min-width:0}
      .sh .ch-add{align-self:flex-start;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:700 12px system-ui,sans-serif;cursor:pointer;margin-bottom:4px}
      .sh .ch-find .iv-ppl{max-height:200px}
      .sh .ch-q{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:500 12.5px system-ui,sans-serif;margin-bottom:6px;outline:none}
      .sh .ch-req{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:9px;background:var(--hi);font:600 12.5px system-ui,sans-serif}
      .sh .ch-req span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sh .ch-req button{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;font-weight:800}
      .sh .ch-req button.buy{background:#6366f1;border-color:#6366f1;color:#fff}
      .sh .ch-f{position:relative;text-align:left;border:0;background:none;border-radius:9px;padding:8px 10px;cursor:pointer;color:var(--fg);display:grid;grid-template-columns:1fr auto;gap:2px 8px}
      .sh .ch-f:hover,.sh .ch-f.on{background:var(--hi)}
      .sh .ch-f b{font:700 13px system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sh .ch-f i{font-style:normal;background:#6366f1;color:#fff;border-radius:999px;padding:0 7px;font:700 11px/18px system-ui,sans-serif}
      .sh .ch-f small{grid-column:1/-1;color:var(--mut);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sh .ch-out{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
      .sh .ch-out span{font-size:11px;color:var(--mut);background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:2px 4px 2px 9px}
      .sh .ch-out button{border:0;background:none;color:var(--mut);cursor:pointer;font-size:11px}
      .sh .ch-right{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;background:var(--soft);min-width:0;overflow:hidden}
      .sh .ch-none{margin:auto;font-size:40px;opacity:.25}
      .sh .ch-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--bg)}
      .sh .ch-hd b{font:800 14px system-ui,sans-serif}
      .sh .ch-rm{border:0;background:none;color:var(--mut);cursor:pointer;font-size:16px}
      .sh .ch-msgs{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
      .sh .ch-m{max-width:75%;align-self:flex-start;background:var(--bg);border:1px solid var(--line);padding:7px 11px;border-radius:14px 14px 14px 4px;font:500 13px/1.4 system-ui,sans-serif;overflow-wrap:anywhere}
      .sh .ch-m.me{align-self:flex-end;background:#6366f1;border-color:#6366f1;color:#fff;border-radius:14px 14px 4px 14px}
      .sh .ch-day{align-self:center;color:var(--mut);font-size:11px;margin:6px 0}
      .sh .ch-in{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line);background:var(--bg)}
      .sh .ch-in input{flex:1;min-width:0;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:500 13px system-ui,sans-serif;outline:none}
      .sh .ch-in input:focus{border-color:#6366f1}
      .sh .ch-in button{width:40px;border-radius:10px;border:0;background:#6366f1;color:#fff;font:800 15px system-ui,sans-serif;cursor:pointer}
      .pq-drop.feed .dp-t span{display:block;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media (max-width:640px){.sh .ch-wrap{grid-template-columns:1fr;height:auto}.sh .ch-right{height:380px}}
      .pq-lbx .lb-bd{font-style:normal;font-size:12px;margin-left:5px;letter-spacing:1px}
      .sh .sh-skin{position:relative}
      .sh .sh-try{position:absolute;top:6px;right:6px;width:26px;height:22px;border-radius:7px;border:0;background:rgba(0,0,0,.45);color:#fff;font-size:12px;cursor:pointer;padding:0;margin:0}
      .sh .sh-skin .sh-try{margin:0}
      .sh .sp-list{max-width:640px;margin:10px auto 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px}
      .sh .sp-it{position:relative;display:flex;align-items:center;gap:8px;padding:7px 38px 7px 8px;border:1px solid var(--line);border-left:3px solid var(--r);border-radius:9px;background:var(--soft);font:600 12.5px system-ui,sans-serif}
      .sh .sp-it i{width:36px;height:22px;border-radius:5px;flex:none;border:1px solid rgba(0,0,0,.15)}
      .sh .sp-it b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sh .sp-it small{color:var(--mut);font-variant-numeric:tabular-nums}
      .sh .sp-it em{font-style:normal;color:#10b981;font-weight:800}
      .sh .sp-it .sh-try{top:50%;transform:translateY(-50%);right:6px;background:var(--bg);color:var(--fg);border:1px solid var(--line)}
      #pq-try{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483005;display:flex;align-items:center;gap:10px;padding:9px 10px 9px 16px;border-radius:999px;background:#0f172a;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      #pq-try button{border:0;border-radius:999px;padding:6px 12px;background:#6366f1;color:#fff;font:700 12px system-ui,sans-serif;cursor:pointer}
      .sh .qs{margin:14px 0 6px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);display:flex;flex-direction:column;gap:7px}
      .sh .qs-h{display:flex;align-items:center;gap:8px;margin-top:2px}
      .sh .qs-h b{font:800 13px system-ui,sans-serif} .sh .qs-h small{color:var(--mut);font-size:11px}
      .sh .qs-r{display:grid;grid-template-columns:minmax(0,1.4fr) 1fr auto auto;align-items:center;gap:10px;font:600 12.5px system-ui,sans-serif}
      .sh .qs-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sh .qs-bar{height:6px;border-radius:999px;background:var(--line);overflow:hidden}
      .sh .qs-bar i{display:block;height:100%;background:linear-gradient(90deg,#10b981,#34d399);border-radius:999px}
      .sh .qs-p{color:var(--mut);font-size:11.5px;font-variant-numeric:tabular-nums;min-width:52px;text-align:right}
      .sh .qs-x{color:#e4ae39;font:800 11.5px system-ui,sans-serif;min-width:44px;text-align:right}
      .sh .qs-r.done{opacity:.55} .sh .qs-r.done .qs-n{color:#10b981}
      .sh .ac-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
      .sh .ac{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;padding:10px 8px;border:1px solid var(--line);border-radius:12px;background:var(--soft);opacity:.4;filter:grayscale(1)}
      .sh .ac.on{opacity:1;filter:none;border-color:#e4ae39;background:color-mix(in srgb,#e4ae39 8%,var(--bg))}
      .sh .ac span{font-size:24px} .sh .ac b{font:700 12px system-ui,sans-serif} .sh .ac small{color:var(--mut);font-size:10.5px}
      .sh .sh-only{position:absolute;top:6px;left:6px;z-index:1;font-style:normal;font:800 9.5px system-ui,sans-serif;letter-spacing:.05em;color:#fff;background:linear-gradient(90deg,#d32ce6,#eb4b4b);padding:2px 7px;border-radius:999px}
      .pq-lbx .pk-idle{color:#f97316;font-weight:700} .pq-lbx .pk-idle.bad{color:#ef4444}
      .pq-lb-ov .lb-row .nm small b{font-weight:600}
      .pq-lb-ov .pk-h{font:700 13px system-ui,sans-serif;margin:18px 0 6px;color:var(--mut)}
      .pq-lb-ov .pk-h small{font-weight:500}
      .pq-lb-ov .lb-row.pk-off{opacity:.7}
      .pq-lb-ov .lb-q{width:100%;box-sizing:border-box;margin:0 0 10px;padding:8px 11px;border-radius:9px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:500 13px system-ui,sans-serif;outline:none}
      .pq-lb-ov .lb-q:focus{border-color:#6366f1}
      .pq-lb-ov .lb-row.hide{display:none}
      #pq-pk-ov .lb-panel{width:min(640px,100%)}
      #pq-pk-ov h2 span{display:flex;gap:6px}
      .pq-lb-ov .pk-date{display:flex;gap:6px;align-items:center;margin:4px 0 12px}
      .pq-lb-ov .pk-date input{padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:600 13px system-ui,sans-serif;color-scheme:light dark}
      .pq-lb-ov .pk-date button{border:1px solid var(--line);background:var(--soft);color:var(--fg);font:700 13px system-ui,sans-serif;padding:5px 10px;border-radius:8px;cursor:pointer}
      .pq-lb-ov .pk-date button:disabled{opacity:.4;cursor:default}
      .pq-lb-ov .pk-sum{display:flex;gap:8px;margin:6px 0 4px}
      .pq-lb-ov .pk-sum div{flex:1;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
      .pq-lb-ov .pk-sum b{display:block;font:800 18px system-ui,sans-serif}
      .pq-lb-ov .pk-sum span{color:var(--mut);font-size:11px}
      .pq-lb-ov .pk-bars{display:flex;align-items:flex-end;gap:3px;height:156px;padding-top:4px}
      .pq-lb-ov .pk-bars div{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:100%}
      .pq-lb-ov .pk-bars i{display:block;width:100%;border-radius:4px 4px 0 0;min-height:2px}
      .pq-lb-ov .pk-bars em{font:600 9.5px system-ui,sans-serif;font-style:normal;color:var(--mut);white-space:nowrap}
      .pq-lb-ov .pk-bars span{font-size:10px;color:var(--mut)}
      .pq-lb-ov.tv{background:var(--bg);padding:0}
      .pq-lb-ov.tv .lb-panel{width:100%;max-width:none;max-height:none;height:100%;border:0;border-radius:0;box-shadow:none;padding:28px 40px;zoom:1.35}
    `);

    function headerBtn() {
      if (!URL_ || !ME_ID) return;
      let a = document.getElementById('pq-hb');
      if (!a) {
        const nav = document.querySelector('.layout-header-navigation');
        if (!nav) return;
        a = document.createElement('a');
        a.id = 'pq-hb';
        a.href = '#';
        a.innerHTML = '<i class="far fa-coins"></i><span class="pq-hb-n"></span>';
        a.addEventListener('click', (e) => { e.preventDefault(); openProfile(); });
        const acc = nav.querySelector('.layout-header-account');
        if (acc && acc.parentNode) acc.parentNode.insertBefore(a, acc); else nav.appendChild(a);
      }
      const p = prof, now = Date.now();
      const n = a.querySelector('.pq-hb-n');
      const txt = p ? int(p.balance) : '';
      if (n.textContent !== txt) n.textContent = txt;
      const crates = p ? (p.inv || []).filter((x) => x.kind === 'crate').length : 0;
      const ev = p && ((p.event && p.event.until > now) || (p.effects && p.effects.boostUntil > now)), frozen = p && p.effects && p.effects.frozenUntil > now;
      const boost = p && p.effects && p.effects.boostUntil > now;
      a.classList.toggle('pq-hb-new', crates > 0 || (can('chat') && (unreadOf(p) > 0 || !!(p && p.social && p.social.reqIn && p.social.reqIn.length))));
      a.classList.toggle('pq-hb-x2', !!ev);
      a.classList.toggle('pq-hb-frozen', !!frozen);
      a.title = ['Inventory · stats · shop', crates ? `${crates} crate${crates > 1 ? 's' : ''} to open` : '', p && p.event && p.event.until > now ? 'double points event: x2 coins' : '', boost ? `coin boost x2 · ${leftTxt(p.effects.boostUntil)} left` : '', frozen ? `your coins are frozen (${leftTxt(p.effects.frozenUntil)})` : ''].filter(Boolean).join(' · ');
    }
    function coinGain(diff) {
      const a = document.getElementById('pq-hb');
      if (!a || !(diff > 0.0005)) return;
      a.querySelectorAll('.pq-hb-plus').forEach((x) => x.remove());
      const f = document.createElement('span');
      f.className = 'pq-hb-plus';
      f.textContent = `+${fmt3(diff)} coins`;
      a.appendChild(f);
      setTimeout(() => f.remove(), 2900);
    }
    // every new profile goes through here: header coins, the +X, crate drops / attacks on you
    function setProf(p) {
      if (!p) return p;
      prof = p;
      skinSave(ME_ID, p.skin);
      applySkin(p.skin);
      lsSet(LS_PROF, { id: ME_ID, at: Date.now(), p });
      if (lastBal != null && p.balance > lastBal + 0.0005) coinGain(p.balance - lastBal);
      lastBal = p.balance;
      headerBtn();
      newsCheck(p);
      if (p.trades) handleTrades(p.trades);
      chatNotify(p);
      return p;
    }
    async function pollProf() {
      if (!URL_ || !ME_ID || spinning || invBusy) return;
      const c = lsGet(LS_PROF, null);
      if (c && c.id === ME_ID && c.p && Date.now() - c.at < 25000) { if (c.at !== (prof && prof._at)) { c.p._at = c.at; setProf(c.p); } return; }
      try { await loadProfile(); } catch (_) {}
    }

    // ---------- something happened to you: a crate dropped, someone froze you, your shield blocked it ----------
    const newsQ = [];
    let newsBusy = false;
    function newsCheck(p) {
      const all = lsGet(LS_NEWS, null) || {};
      const seen = +all[ME_ID] || 0;
      const fresh = (p.news || []).filter((x) => x.at > seen).sort((a, b) => a.at - b.at);
      if (!fresh.length) return;
      const max = fresh[fresh.length - 1].at;
      all[ME_ID] = max;
      lsSet(LS_NEWS, all); // other tabs don't show it again
      newsQ.push(...fresh.slice(-6));
      showNews();
      fetch(`${URL_}/seen`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ME_ID, at: max }) }).catch(() => {});
    }
    async function showNews() {
      if (newsBusy || !newsQ.length) return;
      newsBusy = true;
      const x = newsQ.shift();
      const map = x.from ? await names().catch(() => ({})) : {};
      const who = escHtml(map[x.from] || 'someone');
      const el = document.createElement('div');
      el.className = 'pq-drop';
      let open = 'inv';
      if (x.kind === 'crate') {
        el.classList.add('t-' + x.tier);
        el.style.setProperty('--r', TIER_COL[x.tier] || '#94a3b8');
        el.innerHTML = `<div class="dp-box">${TIER_ICON[x.tier] || '📦'}</div><div class="dp-t"><small>${x.pity ? 'pity crate · no rare in a long time' : 'crate dropped'}</small><b>${escHtml(tierName(x.tier))} crate</b><span>1/${int(x.one || tierOne(x.tier))}</span></div>`;
      } else if (x.kind === 'feed') {
        const fm = await names().catch(() => ({}));
        el.classList.add('t-' + x.tier, 'feed');
        el.style.setProperty('--r', TIER_COL[x.tier] || '#94a3b8');
        el.innerHTML = `<div class="dp-box">${TIER_ICON[x.tier] || '🎁'}</div><div class="dp-t"><small>live drop</small><b>${escHtml(fm[x.id] || 'someone')} · ${escHtml(tierName(x.tier) || x.tier)} crate</b><span>1/${int(tierOne(x.tier))}</span></div>`;
        open = null;
      } else if (x.kind === 'streak') {
        el.style.setProperty('--r', '#f97316');
        el.innerHTML = `<div class="dp-box">🔥</div><div class="dp-t"><small>streak goal hit</small><b>Day ${int(x.n)} streak</b><span>+${int(x.coins)} coins${x.tier ? ` · ${escHtml(tierName(x.tier))} crate` : ''}</span></div>`;
      } else if (x.kind === 'idle') {
        el.style.setProperty('--r', '#f97316');
        el.classList.add('feed');
        el.innerHTML = `<div class="dp-box">💤</div><div class="dp-t"><small>idle ${int(x.min)} min</small><b>${escHtml(x.name)}</b>${x.batch ? `<span>batch ${int(x.batch.items)}/${int(x.batch.total)}</span>` : ''}</div>`;
        open = null;
        el.addEventListener('click', () => openPk(false));
      } else if (x.kind === 'quest') {
        el.style.setProperty('--r', '#10b981');
        el.innerHTML = `<div class="dp-box">✅</div><div class="dp-t"><small>${x.per === 'weekly' ? 'weekly' : 'daily'} quest done</small><b>${escHtml(x.name)}</b><span>+${int(x.xp)} XP</span></div>`;
        open = 'pass';
      } else if (x.kind === 'ach') {
        el.style.setProperty('--r', '#e4ae39');
        el.classList.add('t-legendary');
        el.innerHTML = `<div class="dp-box">${escHtml(x.icon)}</div><div class="dp-t"><small>achievement</small><b>${escHtml(x.name)}</b><span>${escHtml(x.desc)}</span></div>`;
        open = 'stats';
      } else if (x.kind === 'chat' || x.kind === 'freq') {
        el.style.setProperty('--r', '#6366f1');
        el.classList.add('feed');
        el.innerHTML = x.kind === 'chat' ? `<div class="dp-box">💬</div><div class="dp-t"><small>${escHtml(nameOf(x.from))}</small><span>${escHtml(x.text)}</span></div>` : `<div class="dp-box">🤝</div><div class="dp-t"><small>friend request</small><b>${escHtml(nameOf(x.from))}</b></div>`;
        open = 'chat';
        if (x.kind === 'chat') el.dataset.chat = x.from;
      } else if (x.kind === 'pass') {
        el.style.setProperty('--r', '#e4ae39');
        el.innerHTML = `<div class="dp-box">${rewardIc(x)}</div><div class="dp-t"><small>pass level</small><b>${int(x.lv)}</b><span>${escHtml(rewardTxt(x))}</span></div>`;
        open = 'pass';
      } else if (x.kind === 'toast') {
        el.style.setProperty('--r', '#6366f1');
        el.innerHTML = `<div class="dp-t"><span>${escHtml(x.msg)}</span></div>`;
        open = null;
      } else {
        const d = itemDef(x.item), blocked = x.kind === 'blocked';
        el.style.setProperty('--r', blocked ? '#10b981' : '#ef4444');
        const what = blocked ? 'your shield is used up' : x.item === 'freeze' ? `no coins for ${x.until ? leftTxt(x.until) : '20 min'}` : x.item === 'skinoff' ? `your skin is off for ${x.until ? leftTxt(x.until) : '30 min'}` : '';
        el.innerHTML = `<div class="dp-box">${blocked ? '🛡️' : ITEM_ICON[x.item] || '⚠️'}</div><div class="dp-t"><small>${blocked ? 'blocked' : 'you got hit'}</small><b>${who} · ${escHtml(d.name)}</b><span>${what}</span></div>`;
      }
      el.title = open ? 'click to open your inventory' : '';
      el.addEventListener('click', () => { el.remove(); if (el.dataset.chat) { chWith = el.dataset.chat; chMsgs = []; } if (open) openProfile(open); });
      document.body.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); newsBusy = false; showNews(); }, 420); }, x.kind === 'toast' ? 4000 : x.kind === 'crate' || x.kind === 'feed' ? 5200 : 7000);
    }

    // ---------- Inventory tab: crates (open) and items (use) ----------
    let invBusy = false, aimUid = null, aimQ = '';
    const post = async (path, body) => (await fetch(`${URL_}/${path}`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    function invHtml(p) {
      const now = Date.now(), e = p.effects || {};
      const eff = [];
      if (e.boostUntil > now) eff.push(['⚡ Coin boost x2', e.boostUntil, 'good']);
      if (e.shieldUntil > now) eff.push(['🛡️ Shield on', e.shieldUntil, 'good']);
      if (e.frozenUntil > now) eff.push(['❄️ Coins frozen', e.frozenUntil, 'bad']);
      if (e.skinOffUntil > now) eff.push(['🧥 Skin off', e.skinOffUntil, 'bad']);
      const crates = (p.inv || []).filter((x) => x.kind === 'crate').sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.at - b.at);
      const items = (p.inv || []).filter((x) => x.kind === 'item');
      const crateCard = (x) => `<div class="iv-c" style="--r:${TIER_COL[x.tier] || '#94a3b8'}" title="${agoTxt(x.at)}"><div class="iv-ic">${TIER_ICON[x.tier] || '📦'}</div><b>${escHtml(tierName(x.tier))}</b><button class="buy" data-open="${escHtml(x.uid)}">Open</button></div>`;
      const itemCard = (x) => { const d = itemDef(x.item); return `<div class="iv-c" style="--r:${ITEM_COL[x.item] || '#94a3b8'}" title="${escHtml(d.desc)}"><div class="iv-ic">${ITEM_ICON[x.item] || '❔'}</div><b>${escHtml(d.name)}</b><button class="${d.target ? 'buy' : 'wear'}" data-use="${escHtml(x.uid)}">${d.target ? 'Use on…' : 'Use'}</button></div>`; };
      let aim = '';
      if (aimUid) {
        const x = aimUid === 'TRADE' ? { item: '' } : items.find((i) => i.uid === aimUid);
        if (!x) aimUid = null;
        else {
          const d = aimUid === 'TRADE' ? { name: '🤝 Trade' } : itemDef(x.item), ql = low(aimQ);
          const ppl = ((tot && tot.list) || []).filter((r) => r.id !== ME_ID).slice().sort((a, b) => a.name.localeCompare(b.name));
          aim = `<div class="iv-aim"><div class="iv-aim-h"><span>${ITEM_ICON[x.item] || ''} ${escHtml(d.name)} ${aimUid === 'TRADE' ? 'with' : 'on'} who?</span><button class="sh-x" data-aim-x title="cancel">✕</button></div>
            <input class="iv-q" placeholder="Search a name…" value="${escHtml(aimQ)}">
            <div class="iv-ppl">${tot ? ppl.map((r) => `<button data-tg="${escHtml(r.id)}" data-n="${escHtml(low(r.name))}" class="${ql && !low(r.name).includes(ql) ? 'hide' : ''}">${escHtml(r.name)}<small>${int(r.balance)} coins</small></button>`).join('') || '<div class="iv-empty">nobody yet</div>' : '<div class="iv-empty">Loading…</div>'}</div></div>`;
        }
      }
      return `<div class="iv-top">${streakHtml(p)}<button class="iv-tr" data-trade title="Trade">🤝</button>${ii('trade')}</div>
        ${p.event && p.event.until > now ? `<div class="iv-ev">✨ x2 coins · ${leftTxt(p.event.until)}</div>` : ''}
        ${eff.length ? `<div class="iv-eff">${eff.map(([t, u, k]) => `<span class="${k}">${t} · ${leftTxt(u)}</span>`).join('')}</div>` : ''}
        ${aim}
        <h3>Crates <small>${crates.length || ''}</small> ${ii('drops')}</h3>
        ${crates.length ? `<div class="iv-grid">${crates.map(crateCard).join('')}</div>` : '<div class="iv-empty">–</div>'}
        <h3>Items <small>${items.length || ''}</small> ${ii('items')}</h3>
        ${items.length ? `<div class="iv-grid">${items.map(itemCard).join('')}</div>` : '<div class="iv-empty">–</div>'}
        <h3>Themes <small>${(p.owned || []).length || ''}</small></h3>
        ${(p.owned || []).length ? `<div class="sh-grid">${(p.skins || []).filter((s) => (p.owned || []).includes(s.id)).map((s) => skinCard(p, s)).join('')}</div>` : '<div class="iv-empty">–</div>'}`;
    }
    function wireInv(ov) {
      ov.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openDropCrate(b.dataset.open, b)));
      ov.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => {
        const x = ((prof && prof.inv) || []).find((i) => i.uid === b.dataset.use);
        if (!x) return;
        const d = itemDef(x.item);
        if (d.target) {
          aimUid = x.uid; aimQ = '';
          showProfile();
          if (!tot || Date.now() - tot.at > 60000) loadTotals().then(() => { if (aimUid) showProfile(); });
          setTimeout(() => document.querySelector('#pq-pf-ov .iv-q')?.focus(), 30);
          return;
        }
        if (x.item === 'double' && !confirm('Start a double points event? Everyone gets x2 coins for 1 hour.')) return;
        useIt(x.uid, null, b);
      }));
      ov.querySelector('[data-aim-x]')?.addEventListener('click', () => { aimUid = null; showProfile(); });
      ov.querySelector('[data-trade]')?.addEventListener('click', () => {
        aimUid = 'TRADE'; aimQ = '';
        showProfile();
        if (!tot || Date.now() - tot.at > 60000) loadTotals().then(() => { if (aimUid) showProfile(); });
        setTimeout(() => document.querySelector('#pq-pf-ov .iv-q')?.focus(), 30);
      });
      const q = ov.querySelector('.iv-q');
      if (q) q.addEventListener('input', () => {
        aimQ = q.value;
        const ql = low(aimQ);
        ov.querySelectorAll('.iv-ppl [data-n]').forEach((r) => r.classList.toggle('hide', !!ql && !r.dataset.n.includes(ql)));
      });
      ov.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = () => {
        const nm = b.firstChild ? b.firstChild.textContent : b.dataset.tg;
        if (aimUid === 'TRADE') { tradeRequest(b.dataset.tg, nm); return; }
        const x = ((prof && prof.inv) || []).find((i) => i.uid === aimUid);
        if (!x) return;
        if (!confirm(`Use ${itemDef(x.item).name} on ${nm}?`)) return;
        useIt(x.uid, b.dataset.tg, b, nm);
      }));
    }
    async function useIt(uid, target, btn, nm) {
      if (invBusy) return;
      invBusy = true;
      if (btn) btn.disabled = true;
      const x = ((prof && prof.inv) || []).find((i) => i.uid === uid);
      const d = itemDef(x && x.item);
      let j;
      try { j = await post('use', { id: ME_ID, uid, target }); } catch (e) { j = { err: 'could not reach the middle stop' }; }
      invBusy = false;
      aimUid = null;
      if (j.profile) setProf(j.profile);
      showProfile(j.err || (j.blocked ? `🛡️ ${nm || 'they'} had a shield · your ${d.name} got blocked` : target ? `${ITEM_ICON[x.item] || ''} ${d.name} used on ${nm} ✓` : `${ITEM_ICON[x.item] || ''} ${d.name} is on ✓`));
    }
    async function openDropCrate(uid, btn) {
      if (invBusy || spinning) return;
      const x = ((prof && prof.inv) || []).find((i) => i.uid === uid);
      if (!x) return;
      invBusy = true;
      if (btn) btn.disabled = true;
      const rv = openStage(TIER_COL[x.tier] || '#94a3b8', '', `${tierName(x.tier)} crate`, '');
      rv.classList.add('sf');
      const pool = (TIER_LOOT[x.tier] || TIER_LOOT.common).map((k) => (k.startsWith('c:') ? sfCoins(+k.slice(2)) : k.startsWith('s:') ? sfSkin(k.slice(2)) : sfItem(k)));
      // prizes pop right away (fast) while the middle stop decides, then it slows down onto what you got
      let j = null, g = {};
      const fin = post('open', { id: ME_ID, uid }).catch(() => ({ err: 'could not reach the middle stop' })).then((r) => {
        j = r; g = (r && r.got) || {};
        if (!r || !r.ok) return null;
        return g.kind === 'coins' ? sfCoins(g.coins) : g.kind === 'skin' ? sfSkin(g.skin) : sfItem(g.item);
      });
      shuffleTo(rv.querySelector('.rv-sf'), pool, fin, () => {
        if (!j || !j.ok) { rv.remove(); invBusy = false; showProfile((j && j.err) || 'could not open it'); return; }
        if (j.profile) setProf(j.profile);
        if (x.tier === 'legendary' || x.tier === 'epic' || g.kind === 'skin') rv.classList.add('jackpot');
        const sub = g.kind === 'skin' ? (g.dup ? `already yours · +${int(g.coins)} coins` : 'drop only skin · yours now') : g.kind === 'item' ? escHtml(itemDef(g.item).desc) : '';
        rv.querySelector('.rv-res').innerHTML = `${sub ? `<span>${sub}</span>` : ''}<div class="rv-btns">${g.kind === 'skin' && !g.dup ? '<button class="go" data-rv="wear">Wear</button>' : ''}<button data-rv="ok">Nice</button></div>`;
        rv.classList.add('open');
        const done = async (wear) => {
          rv.remove();
          invBusy = false;
          if (wear) { const r = await change('equip', g.skin).catch(() => ({ err: 'could not reach the middle stop' })); showProfile(r.err || ''); }
          else showProfile();
        };
        rv.querySelectorAll('[data-rv]').forEach((b) => (b.onclick = () => done(b.dataset.rv === 'wear')));
      });
    }
    // ---------- opening: things pop up one after another, slower and slower, until it lands on what you get ----------
    const TIER_LOOT = {
      common: ['c:80', 'boost', 'shield', 'c:140'], uncommon: ['c:300', 'boost', 'shield', 'freeze', 'skinoff', 'c:450'],
      rare: ['c:1200', 'freeze', 'skinoff', 'double', 's:phantom', 'c:1800'], epic: ['c:4000', 'double', 's:phantom', 's:inferno', 'c:5500'],
      legendary: ['c:12000', 'double', 's:inferno', 's:celestial', 'c:18000'],
    };
    const sfCoins = (n) => ({ col: '#e4ae39', html: `<div class="sf-ic">🪙</div><b>${int(n)}</b>` });
    const sfItem = (k) => ({ col: ITEM_COL[k] || '#94a3b8', html: `<div class="sf-ic">${ITEM_ICON[k] || '❔'}</div><b>${escHtml(itemDef(k).name)}</b>` });
    const sfSkin = (id) => ({ col: RARITY[id] || '#94a3b8', html: `<div class="sf-sw" style="background:${(SKIN_LOOK[id] || {}).bg || '#334155'}"></div><b>${escHtml(nameOfSkin(id))}</b>` });
    function openStage(col, icon, title, odds) {
      const rv = document.createElement('div');
      rv.className = 'iv-rev';
      rv.style.setProperty('--r', col);
      rv.innerHTML = `<div class="rv-box">${icon}</div><div class="rv-tier">${escHtml(title)}</div><div class="rv-odds">${escHtml(odds)}</div><div class="rv-sf"></div><div class="rv-res"></div>`;
      document.body.appendChild(rv);
      return rv;
    }
    function shuffleTo(box, pool, fin, done) {
      let delay = 55, last = -1, prize, ready = false;
      const t0 = Date.now();
      Promise.resolve(fin).then((x) => { prize = x; ready = true; });
      const show = (it, win) => { box.style.setProperty('--r', it.col); box.innerHTML = `<div class="sf-it${win ? ' win' : ''}">${it.html}</div>`; };
      const step = () => {
        if (!box.isConnected) return;
        if (ready && !prize) { done(); return; } // failed
        if (delay > 560) { show(prize, true); setTimeout(done, 700); return; }
        let k;
        do { k = Math.floor(Math.random() * pool.length); } while (pool.length > 1 && k === last);
        last = k;
        show(pool[k], false);
        if (ready && Date.now() - t0 > 500) delay *= 1.16;
        setTimeout(step, delay);
      };
      step();
    }


    // ---------- idle alert (people with the picker dashboard): a picker didn't collect anything for 6 min ----------
    const IDLE_MIN = 6, LS_IDLE = 'pqsuite_idle_seen_v1';
    function idleCheck(list) {
      if (!can('pickStats') || C.idleAlert === false) return;
      const seen = lsGet(LS_IDLE, null) || {};
      let changed = false;
      for (const r of list || []) {
        const L = r.live;
        if (!L || L.idleMin == null || L.idleMin < IDLE_MIN || L.idleMin >= 60 || !L.last) continue;
        const key = `${r.id}:${L.last}`;
        if (seen[key]) continue;
        seen[key] = Date.now(); changed = true;
        newsQ.push({ kind: 'idle', id: r.id, name: r.name, min: L.idleMin, batch: L.batch, at: Date.now() });
      }
      if (changed) { for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 4 * 3600000) delete seen[k]; lsSet(LS_IDLE, seen); showNews(); }
    }

    // ---------- live feed: everyone sees epic + legendary drops (turn off in 🪙 → ⚙) ----------
    const LS_FEED = 'pqsuite_feed_seen_v1';
    function feedCheck(feed) {
      if (!Array.isArray(feed) || !feed.length) return;
      const seen = +lsGet(LS_FEED, 0) || 0;
      const max = Math.max(...feed.map((x) => x.at));
      if (max <= seen) return;
      lsSet(LS_FEED, max); // other tabs: already shown
      if (C.feed === false) return;
      feed.filter((x) => x.at > seen && Date.now() - x.at < 15 * 60000 && String(x.id) !== ME_ID && !proxies.has(String(x.id)))
        .sort((a, b) => a.at - b.at).slice(-3).forEach((x) => newsQ.push({ ...x, kind: 'feed' }));
      showNews();
    }

    // ---------- streak + pity (inventory top, stats tab) ----------
    function streakHtml(p) {
      const s = p.streak;
      if (!s) return '<span></span>';
      const done = s.day === todayStr(), pct = Math.min(100, Math.round(((s.today || 0) / (s.goal || 100)) * 100));
      return `<div class="iv-streak" title="best ${s.best || 0}"><b>🔥 ${s.n || 0}</b><div class="iv-bar"><i style="width:${done ? 100 : pct}%"></i></div><small>${done ? '✓' : `${fmt(s.today)} / ${s.goal}`}</small>${ii('streak')}</div>`;
    }


    // ---------- 👁 try a skin for 10 sec (only on your screen) ----------
    let tryT = null;
    function trySkin(id) {
      if (flagOff('skins') || !can('skins')) return toast('skins are off right now');
      clearInterval(tryT);
      document.getElementById('pq-try')?.remove();
      close('pq-pf-ov');
      skinBuilt = false;
      applySkin(id);
      let left = 10;
      const pill = document.createElement('div');
      pill.id = 'pq-try';
      pill.innerHTML = `<span>👁 ${escHtml(nameOfSkin(id))} · <b>${left}</b></span><button>stop</button>`;
      document.body.appendChild(pill);
      const stop = () => { clearInterval(tryT); pill.remove(); skinBuilt = false; applySkin(prof ? prof.skin : (skinOf(ME_ID) || {}).id); openProfile(pfTab); };
      pill.querySelector('button').onclick = stop;
      tryT = setInterval(() => { left--; const b = pill.querySelector('b'); if (b) b.textContent = left; if (left <= 0) stop(); }, 1000);
    }

    // ---------- 🎟 battle pass ----------
    const rewardIc = (r) => (r.coins ? '🪙' : r.crate ? TIER_ICON[r.crate] || '📦' : r.item ? ITEM_ICON[r.item] || '❔' : r.skin ? `<i class="bp-sw" style="background:${(SKIN_LOOK[r.skin] || {}).bg || '#334155'}"></i>` : '');
    const rewardTxt = (r) => (r.coins ? `${int(r.coins)} coins` : r.crate ? `${tierName(r.crate)} crate` : r.item ? itemDef(r.item).name : r.skin ? `${nameOfSkin(r.skin)} skin` : '');
    const rewardCol = (r) => (r.coins ? '#e4ae39' : r.crate ? TIER_COL[r.crate] : r.item ? ITEM_COL[r.item] : r.skin ? RARITY[r.skin] || '#e4ae39' : '#94a3b8');
    function passHtml(p) {
      const P = p.pass;
      if (!P) return '<div class="iv-empty">update the middle stop</div>';
      const S = P.season, n = S.levels.length, lv = P.lv, into = P.xp - lv * S.per;
      const days = Math.max(0, Math.ceil((new Date(S.ends + 'T23:59:59') - Date.now()) / 864e5));
      return `<div class="bp-head"><div class="bp-name"><b>${escHtml(S.name)}</b>${ii('pass')}<small>${days}d</small></div>
          ${P.owned ? '<span class="bp-own">✓</span>' : `<button class="buy bp-buy" data-bp ${p.balance < S.price ? 'disabled' : ''}>🪙 ${int(S.price)}</button>`}</div>
        <div class="bp-lv"><span class="bp-n">${lv}</span><div class="bp-bar"><i style="width:${lv >= n ? 100 : Math.round((into / S.per) * 100)}%"></i></div><span class="bp-x">${lv >= n ? 'max' : `${int(into)} / ${int(S.per)}`}</span></div>
        ${questsHtml(p)}
        <div class="bp-track${P.owned ? '' : ' locked'}">${S.levels.map((r, i) => {
          const L = i + 1, got = P.owned && L <= P.got, reached = L <= lv;
          return `<div class="bp-t${got ? ' got' : ''}${reached && !got ? ' reach' : ''}${L === lv + 1 ? ' next' : ''}${r.skin ? ' big' : ''}" title="${L} · ${escHtml(rewardTxt(r))}" style="--r:${rewardCol(r)}"><small>${L}</small><div class="bp-ic">${rewardIc(r)}</div><em>${r.coins ? int(r.coins) : ''}</em></div>`;
        }).join('')}</div>`;
    }
    function questsHtml(p) {
      const qs = p.quests || [];
      if (!qs.length) return '';
      const now = new Date(), endDay = new Date(now); endDay.setHours(24, 0, 0, 0);
      const wd = (now.getDay() + 6) % 7, endWeek = new Date(now); endWeek.setDate(now.getDate() + (7 - wd)); endWeek.setHours(0, 0, 0, 0);
      const hl = (t) => { const m = Math.max(0, Math.round((t - now) / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`; };
      const row = (q) => `<div class="qs-r${q.done ? ' done' : ''}"><span class="qs-n">${q.done ? '✓ ' : ''}${escHtml(q.name)}</span><div class="qs-bar"><i style="width:${Math.round((q.prog / q.goal) * 100)}%"></i></div><span class="qs-p">${q.done ? '' : `${fmt(q.prog)}/${int(q.goal)}`}</span><span class="qs-x">+${int(q.xp)}</span></div>`;
      const d = qs.filter((q) => q.per === 'daily'), w = qs.filter((q) => q.per === 'weekly');
      return `<div class="qs"><div class="qs-h"><b>Daily</b><small>${hl(endDay)}</small>${ii('quests')}</div>${d.map(row).join('')}
        <div class="qs-h"><b>Weekly</b><small>${hl(endWeek)}</small></div>${w.map(row).join('')}</div>`;
    }
    function wirePass(ov) {
      ov.querySelector('[data-bp]')?.addEventListener('click', async (e) => {
        const S = prof.pass.season;
        if (!confirm(`${S.name} · ${int(S.price)} coins?`)) return;
        e.currentTarget.disabled = true;
        let j;
        try { j = await post('pass', { id: ME_ID }); } catch (_) { j = { err: 'could not reach the middle stop' }; }
        if (j.profile) setProf(j.profile);
        showProfile(j.err || '');
      });
      const cur = ov.querySelector('.bp-t.next') || ov.querySelector('.bp-t:last-child');
      if (cur) cur.parentNode.scrollLeft = cur.offsetLeft - 80;
    }

    // ---------- ⓘ: explanations only when you ask for them ----------
    const ii = (k) => `<button class="ii" data-ii="${k}" title="what is this?">?</button>`;
    function infoHtml(k) {
      const p = prof || {};
      const tiers = (p.tiers || []).slice().reverse();
      const odds = tiers.map((t) => `<div class="ii-r"><i style="background:${TIER_COL[t.id]}"></i>${escHtml(t.name)}<span>1/${int(t.one)}</span></div>`).join('');
      const S = p.pass && p.pass.season;
      const T = {
        drops: `<b>Drop crates</b>${odds}<p>1 roll per packed picklist · 3 per picked batch</p><p>${int((p.pity || {}).at || 3000)} rolls without rare = sure rare · you're at ${int((p.pity || {}).dry)}</p>`,
        items: `<b>Items</b>${Object.entries(p.items || {}).map(([k, d]) => `<div class="ii-r">${ITEM_ICON[k] || ''} ${escHtml(d.name)}<span>${escHtml(d.desc)}</span></div>`).join('')}<p>freeze / skin off: same person again after ${int(p.cooldown || 120)} min · a shield blocks 1</p>`,
        streak: `<b>Streak</b><p>${(p.streak || {}).goal || 100} points in a day (pack + pick)</p><p>+50 coins × day, max 500 · day 5 uncommon crate · day 10 rare</p><p>days off don't break it, a worked day under the goal does</p><p>best: ${(p.streak || {}).best || 0}</p>`,
        quests: '<b>Quests</b><p>3 a day, 3 a week, the same for everyone: 1 packing, 1 picking, 1 extra</p><p>done = XP for the pass by itself (also without the pass)</p><p>daily resets at midnight, weekly on Monday</p>',
        trade: '<b>Trade</b><p>pick someone · they accept · both put things in · both agree</p><p>changing anything = agree again</p>',
        pass: S ? `<b>${escHtml(S.name)}</b><p>20 XP per multi · 13 per single · 10 per pick point · ${int(S.per)} XP per level</p><p>rewards come in by themselves · bought later? you get every level you already reached</p><p>ends ${escHtml(S.ends.split('-').reverse().join('-'))} · level 25 = ${escHtml(nameOfSkin('eclipse'))}, only from the pass</p>` : '',
        crate: `<b>Skin crate</b>${((p.crate || {}).odds || []).map((o) => `<div class="ii-r"><i style="background:${RARITY[o.id] || '#94a3b8'}"></i>${escHtml(nameOfSkin(o.id))}<span>${String(o.pct).replace('.', ',')}%</span></div>`).join('')}<p>already have it: ¼ of its price back</p>`,
        skins: '<b>Skins</b><p>change Picqer for your account · dark skins make all of it dark</p><p>★ limited · DROP = only from drop crates · PASS = only from the pass</p>',
        coins: '<b>Coins</b><p>1 per packing point · 1 per picking point · +20 a minute as king</p><p>boost and double event: x2 each · frozen: 0</p>',
      };
      return T[k] || '';
    }
    function wireInfo(ov) {
      ov.querySelectorAll('[data-ii]').forEach((b) => (b.onclick = (e) => {
        e.stopPropagation();
        const was = document.querySelector('.ii-pop');
        was?.remove();
        if (was && was.dataset.k === b.dataset.ii) return;
        const pop = document.createElement('div');
        pop.className = 'ii-pop pq-lbx' + (theme() === 'dark' ? ' dark' : '');
        pop.dataset.k = b.dataset.ii;
        pop.innerHTML = infoHtml(b.dataset.ii);
        document.body.appendChild(pop);
        const r = b.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left - 12)) + 'px';
        pop.style.top = (r.bottom + pop.offsetHeight + 8 > innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
      }));
    }
    document.addEventListener('click', (e) => { if (!e.target.closest('.ii-pop')) document.querySelector('.ii-pop')?.remove(); }, true);


    // ---------- 💬 chat with friends (friend request → accept → chat). New messages pop up, even with the panel closed ----------
    let chWith = null, chMsgs = [], chTimer = null, chDraft = '', chAdd = false, chQ = '';
    const LS_CHAT = 'pqsuite_chat_seen_v1';
    const nameOf = (id) => (((tot && tot.list) || []).find((r) => r.id === String(id)) || {}).name || (namesMap[id]) || `#${id}`;
    let namesMap = {};
    names().then((m) => { namesMap = m || {}; }).catch(() => {});
    const unreadOf = (p) => Object.values(((p && p.social) || {}).unread || {}).reduce((n, x) => n + x, 0);
    function chatNotify(p) {
      const so = p.social;
      if (!so || !can('chat')) return;
      const seen = lsGet(LS_CHAT, null) || {};
      const mine = seen[ME_ID] || { msg: 0, req: [] };
      let maxAt = mine.msg;
      for (const [fid, m] of Object.entries(so.last || {})) {
        if (m.from === ME_ID || m.at <= mine.msg || !(so.unread || {})[fid]) continue;
        maxAt = Math.max(maxAt, m.at);
        if (C.chatPop === false || (chWith === fid && document.getElementById('pq-pf-ov') && pfTab === 'chat')) continue;
        newsQ.push({ kind: 'chat', from: fid, text: m.text, at: m.at });
      }
      for (const fid of so.reqIn || []) if (!mine.req.includes(fid) && C.chatPop !== false) newsQ.push({ kind: 'freq', from: fid, at: Date.now() });
      seen[ME_ID] = { msg: maxAt, req: (so.reqIn || []).slice() };
      lsSet(LS_CHAT, seen);
      showNews();
    }
    async function friendDo(op, to) {
      let j;
      try { j = await post('friend', { id: ME_ID, op, to }); } catch (_) { j = { err: 'could not reach the middle stop' }; }
      if (j.profile) setProf(j.profile);
      chAdd = false;
      showProfile(j.err || '');
    }
    function chatHtml(p) {
      const so = p.social || { friends: [], reqIn: [], reqOut: [], unread: {}, last: {} };
      const fr = so.friends.slice().sort((a, b) => ((so.last[b] || {}).at || 0) - ((so.last[a] || {}).at || 0));
      const left = `
        <button class="ch-add" data-chadd>＋ friend</button>
        ${chAdd ? `<div class="ch-find"><input class="iv-q ch-q" placeholder="Search…" value="${escHtml(chQ)}"><div class="iv-ppl">${((tot && tot.list) || []).filter((r) => r.id !== ME_ID && !so.friends.includes(r.id)).sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<button data-chreq="${escHtml(r.id)}" data-n="${escHtml(low(r.name))}" class="${chQ && !low(r.name).includes(low(chQ)) ? 'hide' : ''}">${escHtml(r.name)}${so.reqOut.includes(r.id) ? '<small>asked</small>' : ''}</button>`).join('')}</div></div>` : ''}
        ${so.reqIn.map((id) => `<div class="ch-req"><span>${escHtml(nameOf(id))}</span><button class="buy" data-chacc="${escHtml(id)}">✓</button><button data-chdec="${escHtml(id)}">✕</button></div>`).join('')}
        ${fr.map((id) => { const l = so.last[id], u = so.unread[id]; return `<button class="ch-f${chWith === id ? ' on' : ''}" data-chw="${escHtml(id)}"><b>${escHtml(nameOf(id))}</b>${u ? `<i>${u}</i>` : ''}<small>${l ? escHtml((l.from === ME_ID ? 'you: ' : '') + l.text) : ''}</small></button>`; }).join('') || (so.reqIn.length || chAdd ? '' : '<div class="iv-empty">add a friend to chat</div>')}
        ${so.reqOut.length ? `<div class="ch-out">${so.reqOut.map((id) => `<span>${escHtml(nameOf(id))} <button data-chcan="${escHtml(id)}" title="cancel">✕</button></span>`).join('')}</div>` : ''}`;
      const right = !chWith ? '<div class="ch-none">💬</div>' : `
        <div class="ch-hd"><b>${escHtml(nameOf(chWith))}</b><button class="ch-rm" data-chrm="${escHtml(chWith)}" title="remove friend">⋯</button></div>
        <div class="ch-msgs" id="ch-msgs"></div>
        <form class="ch-in"><input id="ch-text" maxlength="300" autocomplete="off" placeholder="Message…" value="${escHtml(chDraft)}"><button class="buy">↑</button></form>`;
      return `<div class="ch-wrap"><div class="ch-left">${left}</div><div class="ch-right">${right}</div></div>`;
    }
    function chatDraw() {
      const box = document.getElementById('ch-msgs');
      if (!box) return;
      const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      let lastDay = '';
      box.innerHTML = chMsgs.map((m) => {
        const d = new Date(m.at), day = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
        const sep = day !== lastDay ? `<div class="ch-day">${day}</div>` : '';
        lastDay = day;
        return `${sep}<div class="ch-m${m.from === ME_ID ? ' me' : ''}" title="${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}">${escHtml(m.text)}</div>`;
      }).join('') || '<div class="ch-day">say hi 👋</div>';
      if (atEnd || box.dataset.first !== '1') { box.scrollTop = box.scrollHeight; box.dataset.first = '1'; }
    }
    async function chatLoad(full) {
      if (!chWith) return;
      const w = chWith, since = full || !chMsgs.length ? 0 : chMsgs[chMsgs.length - 1].at;
      try {
        const j = await (await fetch(`${URL_}/chat?id=${ME_ID}&with=${w}&since=${since}`, { credentials: 'omit', cache: 'no-store' })).json();
        if (w !== chWith) return;
        if (j.msgs && j.msgs.length) { chMsgs = since ? chMsgs.concat(j.msgs) : j.msgs; chatDraw(); }
        else if (!since) { chMsgs = []; chatDraw(); }
        if (prof && prof.social && prof.social.unread && prof.social.unread[w]) { const u = { ...prof.social.unread }; delete u[w]; prof.social.unread = u; headerBtn(); }
      } catch (_) {}
    }
    function chatWatch(on) {
      clearInterval(chTimer); chTimer = null;
      if (on) chTimer = setInterval(() => { if (!document.getElementById('ch-msgs') || document.hidden) return; chatLoad(false); }, 4000);
    }
    function wireChat(ov) {
      ov.querySelector('[data-chadd]')?.addEventListener('click', () => {
        chAdd = !chAdd; chQ = ''; showProfile();
        if (chAdd && (!tot || Date.now() - tot.at > 60000)) loadTotals().then(() => { if (pfTab === 'chat') showProfile(); });
        setTimeout(() => document.querySelector('#pq-pf-ov .ch-q')?.focus(), 30);
      });
      const q = ov.querySelector('.ch-q');
      if (q) q.oninput = () => { chQ = q.value; const v = low(chQ); ov.querySelectorAll('[data-chreq]').forEach((b) => b.classList.toggle('hide', !!v && !b.dataset.n.includes(v))); };
      ov.querySelectorAll('[data-chreq]').forEach((b) => (b.onclick = () => friendDo('request', b.dataset.chreq)));
      ov.querySelectorAll('[data-chacc]').forEach((b) => (b.onclick = () => friendDo('accept', b.dataset.chacc)));
      ov.querySelectorAll('[data-chdec]').forEach((b) => (b.onclick = () => friendDo('decline', b.dataset.chdec)));
      ov.querySelectorAll('[data-chcan]').forEach((b) => (b.onclick = () => friendDo('cancel', b.dataset.chcan)));
      ov.querySelector('[data-chrm]')?.addEventListener('click', (e) => { if (confirm(`Remove ${nameOf(e.currentTarget.dataset.chrm)} as friend?`)) { const id = e.currentTarget.dataset.chrm; chWith = null; friendDo('remove', id); } });
      ov.querySelectorAll('[data-chw]').forEach((b) => (b.onclick = () => { if (chWith !== b.dataset.chw) { chWith = b.dataset.chw; chMsgs = []; chDraft = ''; } showProfile(); }));
      const f = ov.querySelector('.ch-in');
      if (f) {
        const inp = f.querySelector('#ch-text');
        inp.oninput = () => { chDraft = inp.value; };
        f.onsubmit = async (e) => {
          e.preventDefault();
          const text = inp.value.trim();
          if (!text) return;
          inp.value = ''; chDraft = '';
          chMsgs = chMsgs.concat({ at: Date.now(), from: ME_ID, text, temp: true });
          chatDraw();
          let j;
          try { j = await post('chat', { id: ME_ID, to: chWith, text }); } catch (_) { j = { err: 'not sent' }; }
          chMsgs = chMsgs.filter((m) => !m.temp);
          if (j.err) { inp.value = text; chDraft = text; toast('💬 ' + j.err); }
          chatLoad(false);
        };
        setTimeout(() => { inp.focus(); const n = inp.value.length; inp.setSelectionRange(n, n); }, 20);
        chatDraw();
        chatLoad(!chMsgs.length);
      }
      chatWatch(!!chWith);
    }

    // ---------- ⚙ settings tab in the panel (per account, synced like Shift+8) ----------
    function setHtml() {
      const row = (k, t) => `<label class="iv-set"><span>${t}</span><input type="checkbox" data-set="${k}" ${C[k] !== false ? 'checked' : ''}></label>`;
      return `<div class="iv-sets">${row('feed', 'Live drops')}${row('trades', 'Trade requests')}${row('widget', 'Rank card')}${can('chat') ? row('chatPop', 'Chat popups') : ''}${can('pickStats') ? row('idleAlert', 'Idle alert (6 min)') : ''}</div>`;
    }
    function wireSet(ov) {
      ov.querySelectorAll('[data-set]').forEach((b) => (b.onchange = () => { C[b.dataset.set] = b.checked; saveCfg(CFG); }));
    }

    // ---------- trading: request → they accept → both put things in → both agree → swap ----------
    let trades = [], trWatch = null, trOpen = null, trMine = null, trSendT = null, trBusy = false, trDirty = false;
    // remembered on this PC (all tabs, every page): a request / an ended trade only pops up once
    const lsIds = (key) => ({ has: (x) => (lsGet(key, []) || []).includes(x), add: (x) => { const a = lsGet(key, []) || []; if (!a.includes(x)) { a.push(x); lsSet(key, a.slice(-100)); } } });
    const trPrompted = lsIds('pqsuite_trade_asked_v1'), trSeenEnd = lsIds('pqsuite_trade_ended_v1');
    const trOther = (t) => (t.from === ME_ID ? t.to : t.from);
    async function tradePost(op, b) {
      let j;
      try { j = await post('trade', { id: ME_ID, op, ...b }); } catch (e) { j = { err: 'could not reach the middle stop' }; }
      if (j.trades) handleTrades(j.trades);
      return j;
    }
    async function tradeRequest(to, nm) {
      const j = await tradePost('request', { to });
      aimUid = null;
      showProfile(j.err || `🤝 trade request sent to ${nm} · waiting for them to accept`);
      watchTrades();
    }
    function watchTrades() {
      if (trWatch) return;
      trWatch = setInterval(async () => {
        if (document.hidden && !trOpen) return;
        try {
          const j = await (await fetch(`${URL_}/trades?id=${ME_ID}`, { credentials: 'omit', cache: 'no-store' })).json();
          if (j.trades) handleTrades(j.trades);
        } catch (_) {}
      }, 3000);
    }
    async function handleTrades(list) {
      trades = list || [];
      const live = trades.filter((t) => t.status === 'pending' || t.status === 'open');
      if (!live.length && !trOpen && trWatch) { clearInterval(trWatch); trWatch = null; }
      if (live.length) watchTrades();
      const map = await names().catch(() => ({}));
      for (const t of trades) {
        const nm = map[trOther(t)] || `#${trOther(t)}`;
        if (t.status === 'pending' && t.to === ME_ID && !trPrompted.has(t.id)) {
          trPrompted.add(t.id);
          if (C.trades === false) { tradePost('decline', { trade: t.id }); continue; }
          tradeAsk(t, nm);
        }
        if (t.status === 'open' && (!trOpen || trOpen === t.id) && !trSeenEnd.has(t.id)) tradeWin(t, nm);
        if ((t.status === 'closed' || t.status === 'done') && !trSeenEnd.has(t.id)) {
          trSeenEnd.add(t.id);
          document.querySelector(`.pq-drop[data-tr="${t.id}"]`)?.remove();
          if (trOpen === t.id) tradeWin(t, nm);
          else if (t.status === 'closed' && t.why && !t.why.endsWith(':' + ME_ID) && (t.ended || t.at) > Date.now() - 2 * 60000) toast(`🤝 ${nm} ${t.why.startsWith('declined') ? 'declined' : 'cancelled'} the trade`);
          else if (t.status === 'done' && (t.ended || t.at) > Date.now() - 2 * 60000) toast(`🤝 trade with ${nm} done ✓`);
        }
      }
    }
    function toast(msg) {
      newsQ.push({ kind: 'toast', msg, at: Date.now() });
      showNews();
    }
    function tradeAsk(t, nm) {
      const el = document.createElement('div');
      el.className = 'pq-drop tr-ask';
      el.dataset.tr = t.id;
      el.style.setProperty('--r', '#6366f1');
      el.innerHTML = `<div class="dp-box">🤝</div><div class="dp-t"><small>trade request</small><b>${escHtml(nm)}</b><span>wants to trade with you</span></div><div class="tr-ab"><button data-ta="no">Decline</button><button class="yes" data-ta="yes">Accept</button></div>`;
      el.querySelectorAll('[data-ta]').forEach((b) => (b.onclick = async (e) => {
        e.stopPropagation();
        el.remove();
        if (b.dataset.ta === 'yes') { const j = await tradePost('accept', { trade: t.id }); if (j.err) toast('🤝 ' + j.err); }
        else tradePost('decline', { trade: t.id });
      }));
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5 * 60000);
    }
    const trItemTxt = (x) => (x.kind === 'crate' ? `${TIER_ICON[x.tier] || '📦'} ${tierName(x.tier)} crate` : `${ITEM_ICON[x.item] || '❔'} ${itemDef(x.item).name}`);
    const trItemCol = (x) => (x.kind === 'crate' ? TIER_COL[x.tier] : ITEM_COL[x.item]) || '#94a3b8';
    function trSideHtml(o) {
      const bits = [];
      if (o.coins) bits.push(`<span class="tr-chip on" style="--r:#e4ae39">🪙 ${int(o.coins)} coins</span>`);
      (o.items || []).forEach((x) => bits.push(`<span class="tr-chip on" style="--r:${trItemCol(x)}">${escHtml(trItemTxt(x))}</span>`));
      (o.skins || []).forEach((s) => bits.push(`<span class="tr-chip on" style="--r:${RARITY[s] || '#94a3b8'}"><i style="background:${(SKIN_LOOK[s] || {}).bg || '#334155'}"></i>${escHtml(nameOfSkin(s))}</span>`));
      return bits.join('') || '<span class="tr-none">nothing yet</span>';
    }
    async function tradeWin(t, nm) {
      let ov = document.getElementById('pq-trade');
      const first = !ov || trOpen !== t.id;
      if (first) {
        if (!ov) {
          ov = document.createElement('div');
          ov.id = 'pq-trade';
          ov.className = 'pq-lb-ov pq-lbx';
          document.body.appendChild(ov);
        }
        ov.classList.toggle('dark', theme() === 'dark');
        trOpen = t.id;
        const mine = t.offer[ME_ID] || { coins: 0, items: [], skins: [] };
        trMine = { coins: mine.coins || 0, uids: new Set((mine.items || []).map((x) => x.uid)), skins: new Set(mine.skins || []) };
        try { await loadProfile(); } catch (_) {}
        ov.innerHTML = `<div class="lb-panel tr-panel"><h2><span>🤝 Trade with ${escHtml(nm)}</span><button class="lb-gear" data-tw="x" title="cancel the trade">✕</button></h2>
          <div class="lb-meta">put in what you give · both press Agree · changing anything resets Agree</div>
          <div class="tr-cols"><div class="tr-col"><h3>You give</h3><label class="tr-coins">🪙 <input type="number" min="0" step="1" id="tr-c" value="${trMine.coins}"> <small>of ${int(prof ? prof.balance : 0)} coins</small></label><div id="tr-mine"></div></div>
          <div class="tr-col"><h3>${escHtml(nm)} gives</h3><div id="tr-them" class="tr-chips"></div></div></div>
          <div class="tr-foot"><div id="tr-st"></div><button class="buy" id="tr-ok">Agree</button></div></div>`;
        ov.querySelector('[data-tw="x"]').onclick = () => { tradePost('cancel', { trade: t.id }); trClose(); };
        ov.querySelector('#tr-ok').onclick = async (e) => { e.currentTarget.disabled = true; clearTimeout(trSendT); if (trDirty) await trSend(true); const j = await tradePost('ok', { trade: t.id }); if (j.err) trStatus(j.err); };
        ov.querySelector('#tr-c').oninput = (e) => { trMine.coins = Math.max(0, Math.round(+e.target.value || 0)); trQueue(); };
        trMineRender();
      }
      ov.querySelector('#tr-them').innerHTML = trSideHtml(t.offer[trOther(t)] || {});
      const okMe = !!(t.ok || {})[ME_ID], okThem = !!(t.ok || {})[trOther(t)];
      const btn = ov.querySelector('#tr-ok');
      if (t.status === 'done') {
        trSeenEnd.add(t.id);
        ov.querySelector('.tr-panel').innerHTML = `<h2>🤝 Trade done ✓</h2><div class="tr-done"><div><h3>You got</h3><div class="tr-chips">${trSideHtml(t.offer[trOther(t)] || {})}</div></div><div><h3>You gave</h3><div class="tr-chips">${trSideHtml(t.offer[ME_ID] || {})}</div></div></div><div class="tr-foot"><span></span><button class="buy" data-tw="close">Nice</button></div>`;
        ov.querySelector('[data-tw="close"]').onclick = trClose;
        loadProfile().then(() => { if (document.getElementById('pq-pf-ov')) showProfile(); }).catch(() => {});
        return;
      }
      if (t.status === 'closed') {
        trSeenEnd.add(t.id);
        const byMe = (t.why || '').endsWith(':' + ME_ID);
        ov.querySelector('.tr-panel').innerHTML = `<h2>🤝 Trade stopped</h2><div class="lb-meta">${byMe ? 'you cancelled it' : `${escHtml(nm)} ${(t.why || '').startsWith('declined') ? 'declined' : 'cancelled'} it`}</div><div class="tr-foot"><span></span><button data-tw="close">Close</button></div>`;
        ov.querySelector('[data-tw="close"]').onclick = trClose;
        return;
      }
      if (btn && !trBusy) { btn.disabled = okMe; btn.textContent = okMe ? (okThem ? 'Swapping…' : 'Agreed ✓') : 'Agree'; }
      trStatus(`${okMe ? '✅' : '⬜'} you · ${okThem ? '✅' : '⬜'} ${escHtml(nm)}`);
    }
    function trStatus(h) { const s = document.getElementById('tr-st'); if (s) s.innerHTML = h; }
    function trMineRender() {
      const box = document.getElementById('tr-mine');
      if (!box || !prof) return;
      const inv = prof.inv || [];
      const owned = (prof.owned || []);
      box.innerHTML = `<div class="tr-chips">${inv.map((x) => `<button class="tr-chip${trMine.uids.has(x.uid) ? ' on' : ''}" data-tu="${escHtml(x.uid)}" style="--r:${trItemCol(x)}">${escHtml(trItemTxt(x))}</button>`).join('') || '<span class="tr-none">no crates or items</span>'}</div>
        <h3 class="tr-sub">Skins</h3><div class="tr-chips">${owned.map((s) => `<button class="tr-chip${trMine.skins.has(s) ? ' on' : ''}" data-ts="${escHtml(s)}" style="--r:${RARITY[s] || '#94a3b8'}"><i style="background:${(SKIN_LOOK[s] || {}).bg || '#334155'}"></i>${escHtml(nameOfSkin(s))}</button>`).join('') || '<span class="tr-none">no skins</span>'}</div>`;
      box.querySelectorAll('[data-tu]').forEach((b) => (b.onclick = () => { const u = b.dataset.tu; trMine.uids.has(u) ? trMine.uids.delete(u) : trMine.uids.add(u); trMineRender(); trQueue(); }));
      box.querySelectorAll('[data-ts]').forEach((b) => (b.onclick = () => { const s = b.dataset.ts; trMine.skins.has(s) ? trMine.skins.delete(s) : trMine.skins.add(s); trMineRender(); trQueue(); }));
    }
    function trQueue() { trDirty = true; clearTimeout(trSendT); trSendT = setTimeout(() => trSend(), 450); }
    async function trSend(quiet) {
      if (!trOpen || !trMine) return;
      trBusy = true;
      trDirty = false;
      const j = await tradePost('offer', { trade: trOpen, coins: trMine.coins, uids: [...trMine.uids], skins: [...trMine.skins] });
      trBusy = false;
      if (j.err && !quiet) trStatus('⚠ ' + escHtml(j.err));
      const btn = document.getElementById('tr-ok');
      if (btn && !quiet) { btn.disabled = false; btn.textContent = 'Agree'; }
    }
    function trClose() { document.getElementById('pq-trade')?.remove(); trOpen = null; trMine = null; }

    // ---------- Ctrl+Alt+P: pick · pack · charts (TV: any Picqer link with #pickers) ----------
    let pkTab = 'pick', picks = null, picksErr = '', chDate = null, chData = null, chBusy = '', chErr = '', chAt = 0, pkTv = false, pkTimer = null;
    const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const addDay = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    async function loadPicks() {
      try {
        const r = await fetch(`${URL_}/picks`, { credentials: 'omit', cache: 'no-store' });
        const j = await r.json();
        if (!r.ok || !j.people) throw new Error(j.err || `HTTP ${r.status}`);
        const map = await names().catch(() => ({}));
        picks = { at: j.at, list: j.people.filter((x) => !proxies.has(String(x.id))).map((x) => ({ ...x, id: String(x.id), name: map[x.id] || `#${x.id}` })) };
        picksErr = '';
      } catch (e) { picksErr = e.message; }
      showPk(true);
    }
    // packed per hour = closed picklists, straight from Picqer (past days kept on this PC: they don't change anymore)
    const LS_CH = 'pqsuite_chart_v1';
    async function packedFromPicqer(date) {
      const w = await warehouse();
      const out = Array(24).fill(0);
      let n = 0;
      for (let off = 0; off < 30000; off += 100) {
        const page = await api(`/picklists?status=closed&closed_after=${encodeURIComponent(date + ' 00:00:00')}&closed_before=${encodeURIComponent(addDay(date, 1) + ' 00:00:00')}${w && w.id ? `&idwarehouse=${w.id}` : ''}&offset=${off}`);
        (page || []).forEach((p) => { const h = +String(p.closed_at || '').slice(11, 13); if (String(p.closed_at || '').slice(0, 10) === date && h >= 0 && h < 24) out[h]++; });
        n += (page || []).length;
        if (chDate === date) { chBusy = `counting picklists… ${n}`; showPk(true); }
        if (!page || page.length < 100) break;
      }
      return out;
    }
    async function loadChart(date) {
      chDate = date; chErr = ''; chBusy = 'loading…';
      if (!chData || chData.date !== date) chData = null;
      showPk(true);
      try {
        const mid = URL_ ? await fetch(`${URL_}/chart?date=${date}`, { credentials: 'omit', cache: 'no-store' }).then((x) => x.json()).catch(() => null) : null;
        let packed;
        const c = lsGet(LS_CH, null) || {};
        if (date !== todayStr() && c[date]) packed = c[date];
        else {
          packed = await packedFromPicqer(date);
          if (date < todayStr()) { c[date] = packed; const ks = Object.keys(c).sort(); while (ks.length > 45) delete c[ks.shift()]; lsSet(LS_CH, c); }
        }
        if (chDate !== date) return;
        chData = { date, packed, picked: mid && mid.have ? mid.picked : null };
        chAt = Date.now();
      } catch (e) { if (chDate === date) chErr = e.message; }
      if (chDate === date) { chBusy = ''; showPk(true); }
    }
    function bars(arr, lo, hi, color, f) {
      const part = arr.slice(lo, hi + 1), max = Math.max(1, ...part);
      return `<div class="pk-bars">${part.map((v, i) => `<div title="${pad(lo + i)}:00 – ${pad(lo + i + 1)}:00 · ${f(v)}"><em>${v ? f(v) : ''}</em><i style="height:${Math.round((v / max) * 118)}px;background:${v ? color : 'var(--line)'}"></i><span>${pad(lo + i)}</span></div>`).join('')}</div>`;
    }
    function chartHtml() {
      const t = todayStr(), d = chDate || t;
      const nav = `<div class="pk-date"><button data-dd="-1" title="day before">‹</button><input type="date" class="pk-in" value="${d}" max="${t}"><button data-dd="1" title="day after" ${d >= t ? 'disabled' : ''}>›</button><button data-dd="0" ${d === t ? 'disabled' : ''}>Today</button></div>`;
      if (chErr) return `${nav}<div class="lb-empty">⚠ ${escHtml(chErr)}</div>`;
      if (!chData) return `${nav}<div class="lb-empty">${escHtml(chBusy || 'loading…')}</div>`;
      const P = chData.packed, K = chData.picked;
      const used = (a) => (a || []).map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      const hrs = [...used(P), ...used(K)];
      const lo = Math.min(6, ...hrs), hi = Math.max(21, ...hrs);
      const sum = (a) => (a || []).reduce((n, v) => n + v, 0);
      const peak = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
      const tp = sum(P), pk = peak(P);
      return `${nav}<div class="pk-sum"><div><b>${int(tp)}</b><span>picklists packed</span></div><div><b>${tp ? `${int(P[pk])}` : '–'}</b><span>${tp ? `busiest hour · ${pad(pk)}:00` : 'busiest hour'}</span></div><div><b>${K ? fmt(sum(K)) : '–'}</b><span>pick points</span></div></div>
        <h3>📦 Packed per hour <small style="color:var(--mut);font-weight:500">closed picklists · from Picqer</small></h3>${bars(P, lo, hi, '#6366f1', int)}
        <h3>⛏ Picked per hour <small style="color:var(--mut);font-weight:500">pick points of completed batches</small></h3>${K ? bars(K, lo, hi, '#10b981', fmt) : '<div class="lb-empty">no picking data for this day · the middle stop counts picking from 10 Nov 2026 on</div>'}
        ${chBusy ? `<div class="lb-meta" style="margin-top:8px">${escHtml(chBusy)}</div>` : ''}`;
    }
    function packHtml() {
      const list = ranked();
      const mins = Math.round(WIN / 60000);
      const at = data && data.at ? new Date(data.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
      return `<div class="lb-meta">last ${mins} min · multi 2 · single 1,334${data && data.wh ? ' · ' + escHtml(data.wh) : ''} · ${at}${data && data.err ? ' · ⚠ ' + escHtml(data.err) : ''}</div>
        ${list.length ? list.map((r) => `<div class="lb-row t-${r.tier}${r.id === ME_ID ? ' me' : ''}"><span class="r">${r.king ? '👑' : '#' + r.rank}</span>
          <span class="nm">${escHtml(r.name)}${r.badges ? `<i class="lb-bd">${escHtml(r.badges)}</i>` : ''}<small>${r.n} closed · ${r.multis} multi · ${r.singles} single${r.king && r.kingMin != null ? ` · king ${r.kingMin} min` : ''}</small></span>
          <span class="v">${fmt(r.points)}<small>pts</small></span></div>`).join('') : `<div class="lb-empty">Nobody closed a picklist in the last ${mins} min</div>`}
        <div class="lb-legend"><span class="t-blue"><i></i>46+</span><span class="t-turq"><i></i>38+</span><span class="t-dgreen"><i></i>30+</span><span class="t-green"><i></i>21+</span><span class="t-orange"><i></i>14+</span><span class="t-red"><i></i>less</span><span>👑 king = #1 with 21+ · +20 coins a minute</span></div>`;
    }
    function pickHtml() {
      const all = (picks && picks.list) || [];
      const act = pickSort(all);
      const rest = all.filter((r) => !picking(r) && r.points > 0).sort((a, b) => b.points - a.points);
      const hm = picks && picks.at ? new Date(picks.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
      const row = (r) => {
        const L = r.live, bt = L.batch;
        return `<div class="lb-row t-${r.tier}${r.id === ME_ID ? ' me' : ''}"><span class="r">${r.rank === 1 ? '🏆' : '#' + r.rank}</span>
          <span class="nm">${escHtml(r.name)}${r.badges ? `<i class="lb-bd">${escHtml(r.badges)}</i>` : ''}<small><b class="${idleCls(r)}">${idleTxt(r)}</b> · ${int(L.locs15)} locations · ${int(L.items15)} products in 15 min${bt ? ` · batch ${int(bt.items)}/${int(bt.total)}` : ''}</small></span>
          <span class="v">${fmt(L.m15)}<small>pts · 15 min · ${fmt(r.points)} today</small></span></div>`;
      };
      return `<div class="lb-meta">picking now · 3 per location + 0,2 per product collected · color = last 15 min · ${hm}${picksErr ? ' · ⚠ ' + escHtml(picksErr) : ''}</div>
        ${act.length ? act.map(row).join('') : `<div class="lb-empty">${picks ? 'Nobody collected anything in the last hour' : picksErr ? '' : 'Loading…'}</div>`}
        <div class="lb-legend"><span class="t-blue"><i></i>75+</span><span class="t-turq"><i></i>60+</span><span class="t-dgreen"><i></i>45+</span><span class="t-green"><i></i>30+</span><span class="t-orange"><i></i>18+</span><span class="t-red"><i></i>less</span><span>pick points in the last 15 min · idle = nothing collected</span></div>
        ${rest.length ? `<h3 class="pk-h">Not picking right now <small>completed today</small></h3>${rest.map((r) => `<div class="lb-row t-none pk-off${r.id === ME_ID ? ' me' : ''}"><span class="r">–</span>
          <span class="nm">${escHtml(r.name)}${r.badges ? `<i class="lb-bd">${escHtml(r.badges)}</i>` : ''}<small>${int(r.batches)} batch${r.batches === 1 ? '' : 'es'} · ${int(r.locations)} locations · ${int(r.items)} products${r.live && r.live.last ? ` · last pick ${new Date(r.live.last).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : ''}</small></span>
          <span class="v">${fmt(r.points)}<small>pts today</small></span></div>`).join('')}` : ''}`;
    }
    function showPk(refresh) {
      if (refresh && !document.getElementById('pq-pk-ov')) return;
      const ov = overlay('pq-pk-ov');
      ov.classList.toggle('tv', pkTv);
      const tab = (k, t) => `<button data-pk="${k}" class="${pkTab === k ? 'on' : ''}">${t}</button>`;
      const body = !URL_ ? '<div class="lb-empty">needs the middle stop (Shift+8 → Leaderboard)</div>' : pkTab === 'pack' ? packHtml() : pkTab === 'chart' ? chartHtml() : pickHtml();
      const keep = document.activeElement && document.activeElement.classList.contains('pk-in');
      if (keep) return; // don't throw away an open date picker
      ov.innerHTML = `<div class="lb-panel"><h2>Pickers &amp; packers<span><button class="lb-gear" data-pkx="tv" title="Copy the TV link">📺</button><button class="lb-gear" data-pkx="close" title="Esc">✕</button></span></h2>
        <div class="lb-tabs">${tab('pick', '⛏ Pick')}${tab('pack', '📦 Pack')}${tab('chart', '📈 Charts')}</div>${body}</div>`;
      ov.querySelectorAll('[data-pk]').forEach((b) => (b.onclick = () => {
        pkTab = b.dataset.pk;
        showPk(true);
        if (pkTab === 'pick') loadPicks();
        if (pkTab === 'chart' && (!chData || Date.now() - chAt > 300000)) loadChart(chDate || todayStr());
      }));
      ov.querySelector('[data-pkx="close"]').onclick = () => close('pq-pk-ov');
      ov.querySelector('[data-pkx="tv"]').onclick = async (e) => {
        const link = `${location.origin}/picklists/batches#pickers`;
        try { await navigator.clipboard.writeText(link); e.currentTarget.textContent = '✓'; } catch (_) { prompt('TV link:', link); }
      };
      ov.querySelectorAll('[data-dd]').forEach((b) => (b.onclick = () => { const n = +b.dataset.dd; loadChart(n ? addDay(chDate || todayStr(), n) : todayStr()); }));
      const din = ov.querySelector('.pk-in');
      if (din) din.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(din.value) && din.value <= todayStr()) { din.blur(); loadChart(din.value); } });
    }
    function openPk(tv) {
      if (document.getElementById('pq-pk-ov')) return;
      pkTv = !!tv;
      if (tv) pkTab = 'pick';
      showPk();
      if (!URL_) return;
      loadPicks();
      if (pkTab === 'chart') loadChart(chDate || todayStr());
      clearInterval(pkTimer);
      pkTimer = setInterval(() => {
        if (pkTab === 'pick') loadPicks();
        else if (pkTab === 'chart' && chDate === todayStr() && !chBusy && Date.now() - chAt > 300000) loadChart(chDate);
      }, 30000);
    }

    const typing = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key || '').toLowerCase() === 'l') { e.preventDefault(); if (document.getElementById('pq-lb-ov')) close('pq-lb-ov'); else showList(); return; }
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Digit9' && isOwner() && URL_ && !typing(e.target)) { loneKey(e, openAdmin); return; }
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyP' && use('pickStats')) { e.preventDefault(); if (document.getElementById('pq-pk-ov')) close('pq-pk-ov'); else openPk(false); return; }
      if (e.key === 'Escape') {
        const rv = document.querySelector('.iv-rev.open');
        if (rv) { rv.querySelector('[data-rv="ok"]')?.click(); return; }
        if (spinning || invBusy) return;
        close('pq-lb-ov'); close('pq-pf-ov'); close('pq-pk-ov'); close('pq-adm-ov');
      }
    });
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { shown = null; render(); }); } catch (_) {}
    window.addEventListener('storage', (e) => { if (e.key === LS_DATA) { data = lsGet(LS_DATA, data); render(); } });
    render();
    const due = !data || Date.now() - data.at > POLL;
    setTimeout(poll, due ? 1500 + Math.random() * 2000 : POLL - (Date.now() - data.at));
    setInterval(() => { if (!document.hidden || !data || Date.now() - data.at > POLL * 3) poll(); }, POLL);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && (!data || Date.now() - data.at > POLL)) poll(); });

    // ---------- Shift+9 (only Ahmad): give / take coins, crates, items, skins, pass, XP ----------
    let adm = { who: null, q: '', p: null, note: '', log: null, flags: null, hooks: null, hookOpen: false, goal: undefined, needKey: false };
    async function adminPost(op, target, extra = {}) {
      const key = lsGet('pqsuite_admin_key', '');
      const r = await fetch(`${URL_}/admin`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Admin-Key': key } : {}) }, body: JSON.stringify({ by: ME_ID, op, target, ...extra }) });
      const j = await r.json().catch(() => ({ err: `HTTP ${r.status}` }));
      // wrong / no key on this PC: ask for it in the panel itself (no browser prompt, those can be blocked or hide behind)
      if (r.status === 403) { adm.needKey = true; if (document.getElementById('pq-adm-ov')) showAdmin(); return { err: 'admin key needed on this PC' }; }
      adm.needKey = false;
      return j;
    }
    const admItems = () => Object.keys(ITEM_ICON);
    function showAdmin() {
      try { showAdminInner(); } catch (e) {
        diag('crash', `admin panel: ${e && e.message}`);
        const ov = overlay('pq-adm-ov');
        ov.innerHTML = `<div class="lb-panel sh-panel ad-panel"><h2>Admin</h2><div class="sh-note">⚠ ${escHtml((e && e.message) || String(e))} · Ctrl+Alt+D → Copy and send it</div></div>`;
      }
    }
    function showAdminInner() {
      const ov = overlay('pq-adm-ov');
      ov.classList.add('sh');
      const ppl = ((tot && tot.list) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const ql = low(adm.q);
      const p = adm.p, who = ppl.find((x) => x.id === adm.who);
      const opt = (arr) => arr.map(([v, t]) => `<option value="${escHtml(v)}">${escHtml(t)}</option>`).join('');
      const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'].map((t) => [t, tierName(t)]);
      const skins = ((prof && prof.skins) || []).map((x) => [x.id, x.name]);
      const right = !adm.who ? '<div class="iv-empty">pick someone</div>' : !p ? '<div class="iv-empty">…</div>' : `
        <div class="ad-who"><b>${escHtml(who ? who.name : '#' + adm.who)}</b><span>🪙 ${int(p.balance)}</span></div>
        <div class="ad-tags"><span>pass ${p.pass && p.pass.owned ? '✓' : '–'} · lv ${p.pass ? p.pass.lv : 0}</span><span>${(p.inv || []).length} in inventory</span><span>${(p.owned || []).length} skins</span>
          ${p.effects && p.effects.frozenUntil > Date.now() ? '<span class="bad">frozen</span>' : ''}${p.effects && p.effects.boostUntil > Date.now() ? `<span class="good">boost ${leftTxt(p.effects.boostUntil)}</span>` : ''}</div>
        <div class="ad-rows">
          <div class="ad-r"><label>Coins</label><input type="number" id="ad-coins" value="1000" min="1"><button class="buy" data-ad="coins">Give</button><button data-ad="coins-">Take</button></div>
          <div class="ad-r"><label>Crate</label><select id="ad-tier">${opt(tiers)}</select><input type="number" id="ad-cn" value="1" min="1"><button class="buy" data-ad="crate">Give</button><button data-ad="uncrate">Take</button></div>
          <div class="ad-r"><label>Item</label><select id="ad-item">${opt(admItems().map((k) => [k, itemDef(k).name]))}</select><input type="number" id="ad-in" value="1" min="1"><button class="buy" data-ad="item">Give</button><button data-ad="unitem">Take</button></div>
          <div class="ad-r"><label>Skin</label><select id="ad-skin">${opt(skins)}</select><button class="buy" data-ad="skin">Give</button><button data-ad="unskin">Take</button></div>
          <div class="ad-r"><label>Pass</label>${p.pass && p.pass.owned ? '<button data-ad="unpass">Take pass</button>' : '<button class="buy" data-ad="pass">Give pass</button>'}<input type="number" id="ad-xp" value="1000"><button data-ad="xp">+ XP</button></div>
          <div class="ad-r"><label>Effects</label><button data-ad="clear">Unfreeze</button><input type="number" id="ad-bm" value="30"><button data-ad="boost">Boost min</button></div>
        </div>`;
      const fl = adm.flags || {};
      const flagSw = (k, t) => `<label class="ad-flag"><input type="checkbox" data-adf="${k}" ${fl[k] === false ? '' : 'checked'} ${adm.flags ? '' : 'disabled'}>${t}</label>`;
      ov.innerHTML = `<div class="lb-panel sh-panel ad-panel"><div class="sh-top"><h2>Admin</h2><div class="ad-flags"><span>everyone</span>${flagSw('cardColor', 'Product colors')}${flagSw('skins', 'Skins')}</div><span class="cb-auto-sp" style="flex:1"></span><button class="lb-gear" data-ad-hook title="Discord: logs + end of shift report">🔔</button><button class="lb-gear" data-ad-log title="last 50 actions">📜</button><button class="sh-x" data-adx>✕</button></div>
        ${adm.needKey ? `<div class="ad-goal"><label>Admin key</label><input type="password" id="ad-key" placeholder="ADMIN_KEY from Cloudflare" style="width:260px" autocomplete="off"><button class="buy" data-adkey>Save on this PC</button></div>` : ''}
        ${adm.note ? `<div class="sh-note">${escHtml(adm.note)}</div>` : ''}
        <div class="ad-goal"><label>Shift goal</label><span>start</span><input type="time" id="ad-gf" value="${(adm.goal && adm.goal.from) || '18:00'}"><input type="number" id="ad-gs" min="0" placeholder="auto" title="open picklists at the start time (empty = counted by itself)" value="${adm.goal && adm.goal.start ? adm.goal.start : ''}"><span>→</span><input type="number" id="ad-gt" min="1" placeholder="goal" value="${adm.goal ? adm.goal.target : ''}" title="max open picklists at the end time"><span>at</span><input type="time" id="ad-gz" value="${(adm.goal && adm.goal.to) || '23:00'}"><button class="buy" data-adg="save">Set</button>${adm.goal ? '<button data-adg="off">Off</button>' : '<small>no goal = no bar</small>'}</div>
        ${adm.hookOpen ? `<div class="ad-hooks">
          <div class="ad-r"><label>Logs</label><input id="ad-hlog" placeholder="Discord webhook URL" value="${escHtml((adm.hooks || {}).log || '')}"><button data-adh="test-log">Test</button></div>
          <div class="ad-r"><label>Report</label><input id="ad-hrep" placeholder="Discord webhook URL" value="${escHtml((adm.hooks || {}).report || '')}"><input id="ad-hat" type="time" value="${escHtml((adm.hooks || {}).reportAt || '22:30')}"><button data-adh="test-report">Send now</button></div>
          <div class="ad-r"><label></label><button class="buy" data-adh="save">Save</button></div></div>` : ''}
        ${adm.log ? `<div class="ad-log">${adm.log.map((x) => `<div><span>${new Date(x.at).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>${escHtml(x.what.replace(/→ (\d+)$/, (m, id) => '→ ' + ((ppl.find((y) => y.id === id) || {}).name || '#' + id)))}${x.id && x.id !== '32247' && !/^admin/.test(x.what) ? ` · ${escHtml((ppl.find((y) => y.id === String(x.id)) || {}).name || '#' + x.id)}` : ''}</div>`).join('') || '–'}</div>` : ''}
        <div class="ad-body"><div class="ad-left"><input class="iv-q ad-q" placeholder="Search…" value="${escHtml(adm.q)}"><div class="iv-ppl">${ppl.map((r) => `<button data-adw="${escHtml(r.id)}" data-n="${escHtml(low(r.name))}" class="${ql && !low(r.name).includes(ql) ? 'hide' : ''}${r.id === adm.who ? ' on' : ''}">${escHtml(r.name)}<small>${int(r.balance)}</small></button>`).join('') || '<div class="iv-empty">…</div>'}</div></div>
        <div class="ad-right">${right}</div></div></div>`;
      ov.querySelector('[data-adx]').onclick = () => close('pq-adm-ov');
      ov.querySelectorAll('[data-adf]').forEach((b) => (b.onchange = async () => {
        b.disabled = true;
        const j = await adminPost('flags', '', { flags: { [b.dataset.adf]: b.checked } }).catch((e) => ({ err: e.message }));
        if (j.flags) { adm.flags = j.flags; lsSet(LS_FLAGS, j.flags); window.dispatchEvent(new Event('pq-flags')); }
        adm.note = j.err || `${b.parentNode.textContent.trim()} ${b.checked ? 'on' : 'OFF'} for everyone · every PC within ~30 s`;
        showAdmin();
      }));
      ov.querySelector('[data-adkey]')?.addEventListener('click', () => {
        const k = (ov.querySelector('#ad-key').value || '').trim();
        if (!k) return;
        lsSet('pqsuite_admin_key', k);
        adm.needKey = false; adm.note = 'key saved on this PC';
        showAdmin();
        adminPost('flags', '').then((j) => { if (j.flags) { adm.flags = j.flags; showAdmin(); } });
        adminPost('goal', '').then((j) => { if (!j.err) { adm.goal = j.goal; showAdmin(); } });
      });
      ov.querySelectorAll('[data-adg]').forEach((b) => (b.onclick = async () => {
        const goal = b.dataset.adg === 'off' ? { target: 0 } : { target: +ov.querySelector('#ad-gt').value || 0, from: ov.querySelector('#ad-gf').value, to: ov.querySelector('#ad-gz').value, start: +ov.querySelector('#ad-gs').value || 0 };
        b.disabled = true;
        const j = await adminPost('goal', '', { goal }).catch((e) => ({ err: e.message }));
        if (!j.err) adm.goal = j.goal;
        adm.note = j.err || (j.goal ? `shift goal: ${j.goal.start ? int(j.goal.start) : 'counted'} at ${j.goal.from} → ${int(j.goal.target)} at ${j.goal.to} · everyone sees it within ~3 min` : 'shift goal off · bar gone everywhere');
        showAdmin();
      }));
      ov.querySelector('[data-ad-hook]').onclick = async () => {
        adm.hookOpen = !adm.hookOpen;
        if (adm.hookOpen && !adm.hooks) { const j = await adminPost('hooks', ''); adm.hooks = j.hooks || {}; adm.note = j.err || ''; }
        showAdmin();
      };
      ov.querySelectorAll('[data-adh]').forEach((b) => (b.onclick = async () => {
        const hooks = { log: ov.querySelector('#ad-hlog').value, report: ov.querySelector('#ad-hrep').value, reportAt: ov.querySelector('#ad-hat').value || '22:30' };
        b.disabled = true;
        let j = await adminPost('hooks', '', { hooks }).catch((e) => ({ err: e.message }));
        if (!j.err && b.dataset.adh !== 'save') j = await adminPost('hooks', '', { test: b.dataset.adh === 'test-report' ? 'report' : 'log' }).catch((e) => ({ err: e.message }));
        if (j.hooks) adm.hooks = j.hooks;
        adm.note = j.err || (b.dataset.adh === 'save' ? 'saved ✓' : 'sent ✓ · check Discord');
        showAdmin();
      }));
      ov.querySelector('[data-ad-log]').onclick = async () => { if (adm.log) { adm.log = null; return showAdmin(); } const j = await adminPost('log', ''); adm.log = j.log || []; adm.note = j.err || ''; showAdmin(); };
      const q = ov.querySelector('.ad-q');
      q.oninput = () => { adm.q = q.value; const v = low(q.value); ov.querySelectorAll('[data-adw]').forEach((b) => b.classList.toggle('hide', !!v && !b.dataset.n.includes(v))); };
      ov.querySelectorAll('[data-adw]').forEach((b) => (b.onclick = async () => {
        adm.who = b.dataset.adw; adm.p = null; adm.note = '';
        showAdmin();
        try { adm.p = await (await fetch(`${URL_}/profile?id=${adm.who}`, { credentials: 'omit', cache: 'no-store' })).json(); } catch (_) {}
        showAdmin();
      }));
      const val = (id) => (ov.querySelector('#' + id) || {}).value;
      ov.querySelectorAll('[data-ad]').forEach((b) => (b.onclick = async () => {
        const k = b.dataset.ad;
        const body = k === 'coins' ? { n: +val('ad-coins') } : k === 'coins-' ? { n: -Math.abs(+val('ad-coins')) } : k === 'crate' || k === 'uncrate' ? { what: val('ad-tier'), n: +val('ad-cn') }
          : k === 'item' || k === 'unitem' ? { what: val('ad-item'), n: +val('ad-in') } : k === 'skin' || k === 'unskin' ? { what: val('ad-skin') } : k === 'xp' ? { n: +val('ad-xp') } : k === 'boost' ? { n: +val('ad-bm') } : {};
        b.disabled = true;
        const j = await adminPost(k === 'coins-' ? 'coins' : k, adm.who, body).catch((e) => ({ err: e.message }));
        if (j.profile) adm.p = j.profile;
        adm.note = j.err || '✓';
        if (adm.who === ME_ID && j.profile) setProf(j.profile);
        showAdmin();
        if (!j.err) loadTotals();
      }));
      setTimeout(() => { const i = ov.querySelector('.ad-q'); if (i && !adm.who) i.focus(); }, 20);
    }
    function openAdmin() {
      if (document.getElementById('pq-adm-ov')) return close('pq-adm-ov');
      showAdmin();
      adminPost('flags', '').then((j) => { if (j.flags) { adm.flags = j.flags; if (document.getElementById('pq-adm-ov')) showAdmin(); } }).catch(() => {});
      adminPost('goal', '').then((j) => { if (!j.err) { adm.goal = j.goal; if (document.getElementById('pq-adm-ov')) showAdmin(); } }).catch(() => {});
      if (!tot || Date.now() - tot.at > 60000) loadTotals().then(() => { if (document.getElementById('pq-adm-ov')) showAdmin(); });
    }
    addStyle('pq-adm-style', `
      .ad-panel{width:min(820px,100%) !important}
      .ad-flags{display:flex;align-items:center;gap:10px;margin-left:14px;padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--soft);font:600 12px system-ui,sans-serif}
      .ad-flags span{color:var(--mut)}
      .ad-flag{display:flex;align-items:center;gap:5px;cursor:pointer}
      .ad-goal{display:flex;align-items:center;gap:8px;margin-top:10px;font:600 12px system-ui,sans-serif;flex-wrap:wrap}
      .ad-goal label{color:var(--mut);width:72px}
      .ad-goal span,.ad-goal small{color:var(--mut)}
      .ad-goal input{padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:600 12.5px system-ui,sans-serif;width:100px}
      .ad-goal button{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:700 12px system-ui,sans-serif;cursor:pointer}
      .ad-goal button.buy{background:#6366f1;border-color:#6366f1;color:#fff}
      .ad-hooks{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}
      .ad-hooks .ad-r input:not([type=time]){flex:1;width:auto}
      .ad-q{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:500 13px system-ui,sans-serif;margin-bottom:8px;outline:none}
      .ad-body{display:grid;grid-template-columns:240px 1fr;gap:18px;margin-top:14px}
      .ad-left .iv-ppl{max-height:420px}
      .ad-left .iv-ppl button.on{background:var(--hi)}
      .ad-who{display:flex;justify-content:space-between;align-items:baseline}
      .ad-who b{font:800 17px system-ui,sans-serif} .ad-who span{font:700 15px system-ui,sans-serif}
      .ad-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
      .ad-tags span{padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:var(--soft);font:600 11.5px system-ui,sans-serif;color:var(--mut)}
      .ad-tags .bad{color:#e11d48} .ad-tags .good{color:#059669}
      .ad-rows{display:flex;flex-direction:column;gap:8px}
      .ad-r{display:flex;align-items:center;gap:8px}
      .ad-r label{width:62px;color:var(--mut);font:600 12px system-ui,sans-serif}
      .ad-r input,.ad-r select{padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:600 12.5px system-ui,sans-serif;min-width:0}
      .ad-r input{width:90px}
      .ad-r button{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:700 12px system-ui,sans-serif;cursor:pointer}
      .ad-r button.buy{background:#6366f1;border-color:#6366f1;color:#fff}
      .ad-r button:disabled{opacity:.45}
      .ad-log{max-height:200px;overflow:auto;margin-top:10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--soft);font:500 12px system-ui,sans-serif}
      .ad-log span{color:var(--mut);margin-right:8px;font-variant-numeric:tabular-nums}
      @media (max-width:700px){.ad-body{grid-template-columns:1fr}}
    `);
    // names for trading / items: load them quietly in the background, so the list is there when you need it
    if (URL_) setTimeout(() => { if (document.hidden) return; names().catch(() => {}); if (!tot || Date.now() - tot.at > 10 * 60000) loadTotals(); }, 12000 + Math.random() * 15000);
    // 🪙 button in Picqer's header (Picqer can redraw the header: put it back when it's gone)
    if (URL_ && ME_ID) {
      const c = lsGet(LS_PROF, null);
      if (c && c.id === ME_ID && c.p) prof = c.p;
      headerBtn();
      setInterval(() => { if (!document.getElementById('pq-hb')) headerBtn(); if (data && data.goal && !document.getElementById('pq-goal')) goalBar(); }, 1500);
      // coins, skin (also bought / taken off on another PC), crates: every minute while you look at the page
      setTimeout(pollProf, 2500 + Math.random() * 2500);
      setInterval(() => { if (!document.hidden) pollProf(); }, 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) pollProf(); });
    }
    const tvHash = () => /^#pickers/.test(location.hash);
    if (use('pickStats')) {
      if (tvHash()) setTimeout(() => openPk(true), 500);
      window.addEventListener('hashchange', () => { if (tvHash()) openPk(true); });
    }
  }

  /* =========================================================================
   *  LOCKS: hide Picqer's own power buttons for teams that may not use them
   * ========================================================================= */
  function locksCss() {
    if (can('pickAll')) document.getElementById('pq-lock-css')?.remove();
    // singles: Picqer's own "Pick alles" stays for everyone (only on multi picklists it is a team thing)
    else addStyle('pq-lock-css', 'html:not(:has(#bundle-script-tag-picqer-picklists-batches-show-singles)) .pick-all-button-container:not(#singles-picklist-dialogue .pick-all-button-container){display:none!important}');
  }
  const SINGLES_PAGE = () => /singles/i.test(location.pathname) || !!document.getElementById('bundle-script-tag-picqer-picklists-batches-show-singles');
  function locks() {
    locksCss();
    const rules = [];
    // "Ik heb ze allemaal" (singles) is for everyone: only Picqer's "Pick alles" on picklists is a team thing
    if (!can('pickAll') && !SINGLES_PAGE()) rules.push(/^(pick alles|pick all)$/i);
    if (!can('bulkSingles')) rules.push(/^(verwerk in bulk|process in bulk)$/i);
    if (!rules.length) return;
    const sweep = () => {
      document.querySelectorAll('button, a.btn').forEach((b) => {
        if (b.dataset.pqLock || b.closest('#singles-picklist-dialogue')) return; // singles: always allowed
        const t = norm(b.textContent);
        if (!t || t.length > 30 || !rules.some((re) => re.test(t))) return;
        b.dataset.pqLock = '1';
        b.style.setProperty('display', 'none', 'important');
        if ('disabled' in b) b.disabled = true;
      });
    };
    sweep();
    let seenTick = DOM_TICK;
    setInterval(() => { if (!document.hidden && seenTick !== DOM_TICK) { seenTick = DOM_TICK; sweep(); } }, 600);
  }

  /* =========================================================================
   *  SETTINGS PANEL (Shift+8 / *) + TEAMS EDITOR
   * ========================================================================= */
  const MOD_ICON = { comboBatcher: '📦', comboAlert: '🔔', replenish: '🔄', shipErr: '🚚', addrFix: '🏠', banner: '🚩', batchOpt: '🏷️', zap: '⚡', dayson: '📋',
    zaplog: '🧾', unpick: '↩️', autoNext: '⏭️', autoPrint: '🖨️', pickAllKey: '🅰️', pickStats: '📊', leaderboard: '🏆', cardColor: '🎨' };
  // these have a ⚙ in their own window: Shift+8 only shows their on/off switch
  const OWN_GEAR = { comboBatcher: 'Ctrl+Shift+B → ⚙', leaderboard: 'Ctrl+Alt+L → ⚙', zap: 'Ctrl+Alt+Z → ⚙', zaplog: 'Ctrl+Alt+Z → ⚙' };
  function settingsPanel() {
    addStyle('pqs-style', `
      #pqs-ov{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:16px}
      #pqs-card{width:700px;max-width:100%;max-height:90vh;display:flex;flex-direction:column;background:#fff;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.25);
        font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937;overflow:hidden}
      #pqs-card button,#pqs-card input,#pqs-card select,#pqs-card textarea{font-family:inherit}
      #pqs-card .hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5e7eb}
      #pqs-card .hd > div > b{font-size:15px}
      #pqs-card .hd small{color:#6b7280;margin-left:8px}
      .pqs-who{color:#6b7280;font-size:12px;margin-top:3px}
      .pqs-who b{color:#111827}
      .pqs-tabs{display:flex;gap:4px;padding:0 18px;border-bottom:1px solid #e5e7eb}
      .pqs-tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 10px;font-weight:600;font-size:12px;color:#6b7280;cursor:pointer}
      .pqs-tab.on{color:#111827;border-color:#111827}
      #pqs-card .bd{overflow:auto;padding:6px 0;flex:1}
      .pqs-mod{border-bottom:1px solid #f1f5f9;padding:10px 18px}
      .pqs-mod:last-child{border-bottom:0}
      .pqs-top{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
      .pqs-top .t{font-weight:600;flex:1}
      .pqs-top .h{color:#6b7280;font-size:12px;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pqs-top .car{color:#9ca3af;width:12px}
      .pqs-top .ic{width:22px;text-align:center;font-size:15px}
      .pqs-mod.gear .t{font-weight:500}
      .pqs-note{font-size:12px;line-height:1.5;color:#374151;background:#f3f4f6;border-radius:8px;padding:8px 10px;margin-bottom:4px}
      .pqs-sec{padding:14px 18px 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af}
      #pqs-card.mini{width:520px}
      #pqs-card.mini .pqs-fields{margin-left:32px}
      .pqs-fields{display:none;margin:10px 0 2px 32px;gap:8px;flex-direction:column}
      .pqs-mod.open .pqs-fields{display:flex}
      .pqs-f{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .pqs-f label{color:#374151}
      .pqs-f input[type=text],.pqs-f input[type=number]{width:220px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
      .pqs-f input[type=number]{width:110px}
      .pqs-sw{position:relative;width:34px;height:20px;flex:none}
      .pqs-sw input{opacity:0;width:0;height:0}
      .pqs-sw span{position:absolute;inset:0;background:#d1d5db;border-radius:999px;transition:.15s;cursor:pointer}
      .pqs-sw span:before{content:"";position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
      .pqs-sw input:checked+span{background:#2563eb}
      .pqs-sw input:checked+span:before{transform:translateX(14px)}
      #pqs-card .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 18px;background:#f9fafb;border-top:1px solid #e5e7eb}
      #pqs-card .ft span{color:#6b7280;font-size:12px}
      #pqs-card .ft > div{display:flex;gap:6px;flex:none}
      .pqs-b{border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;color:#1f2937}
      .pqs-b:disabled{opacity:.5;cursor:default}
      .pqs-b.p{background:#2563eb;border-color:#2563eb;color:#fff}
      .pqs-b.p:hover{background:#1d4ed8}
      .pqs-sec{padding:12px 18px}
      .pqs-sec h4{margin:16px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}
      .pqs-help{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:8px;padding:9px 11px;font-size:12px;line-height:1.6}
      .pqs-help code{background:#dbeafe;border-radius:4px;padding:0 4px;font-size:11px}
      .pqs-dirty{margin-top:6px;color:#b45309;font-weight:600}
      .pqs-src{margin-top:4px;color:#475569;font-size:11px}
      .pqs-gh{margin-top:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;font-size:12px;line-height:1.5}
      .pqs-gh .pqs-row{margin-top:6px}
      .pqs-gh input{flex:1}
      .pqs-gh small{color:#64748b}
      .pqs-gridwrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px}
      .pqs-grid{width:100%;border-collapse:collapse;font-size:12px}
      .pqs-grid th,.pqs-grid td{border-bottom:1px solid #f1f5f9;padding:6px 8px;text-align:center;white-space:nowrap}
      .pqs-grid th{background:#f9fafb;vertical-align:bottom}
      .pqs-grid th:first-child,.pqs-grid td:first-child{text-align:left;white-space:normal}
      .pqs-grid td small{display:block;color:#9ca3af;font-size:11px}
      .pqs-grid tr:last-child td{border-bottom:0}
      .pqs-grid input{cursor:pointer}
      .pqs-tname{font-weight:700;color:#111827}
      .pqs-tname span{cursor:pointer;border-bottom:1px dashed #9ca3af}
      .pqs-all{display:block;font-weight:400;color:#6b7280;margin-top:2px;cursor:pointer}
      .pqs-x{background:none;border:0;color:#9ca3af;cursor:pointer;font-size:12px;padding:0 2px}
      .pqs-x:hover{color:#dc2626}
      .pqs-row{display:flex;gap:8px;align-items:center;margin:8px 0}
      .pqs-row input[type=text]{flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
      .pqs-row select,.pqs-person select{padding:5px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;background:#fff}
      .pqs-people{max-height:260px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px}
      .pqs-person{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #f1f5f9}
      .pqs-person:last-child{border-bottom:0}
      .pqs-person .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pqs-person small{color:#9ca3af}
      .pqs-empty{padding:14px;color:#6b7280;text-align:center}
      .pqs-clist{border:1px solid #e5e7eb;border-radius:8px;max-height:210px;overflow:auto}
      .pqs-crow{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #f3f4f6}
      .pqs-crow:last-child{border-bottom:0}
      .pqs-crow .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
      .pqs-crow small{color:#9ca3af}
      .pqs-swatch{width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.15);flex:none}
      #pqs-card input[type=color]{width:40px;height:32px;padding:0 2px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;flex:none}
      .pqs-out{display:none;width:100%;height:170px;margin-top:10px;font:12px ui-monospace,Menlo,Consolas,monospace;border:1px solid #d1d5db;border-radius:8px;padding:8px;box-sizing:border-box;white-space:pre}
      .pqs-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;background:#111827;color:#fff;padding:9px 14px;border-radius:8px;
        font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)}`);

    const sw = (checked, attrs) => `<label class="pqs-sw"><input type="checkbox" ${checked ? 'checked' : ''} ${attrs}><span></span></label>`;

    function toast(msg, ms = 3500) {
      document.getElementById('pqs-toast')?.remove();
      const t = document.createElement('div');
      t.id = 'pqs-toast';
      t.className = 'pqs-toast';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), ms);
    }

    // ---------- tools tab (this PC) ----------
    const sec = (m) => m.cfgId || m.id;
    const fieldHtml = (m, f) => {
      const v = CFG[sec(m)][f.k];
      const a = `data-m="${sec(m)}" data-k="${f.k}" data-t="${f.type}"`;
      if (f.type === 'bool') return `<div class="pqs-f"><label>${escHtml(f.label)}${helpBtn(f.help)}</label>${sw(v, a)}</div>`;
      if (f.type === 'num') return `<div class="pqs-f"><label>${escHtml(f.label)}</label><input type="number" value="${escHtml(v)}" ${a}></div>`;
      const val = f.type === 'list' ? (v || []).join(', ') : v;
      return `<div class="pqs-f"><label>${escHtml(f.label)}</label><input type="text" value="${escHtml(val)}" ${a}></div>`;
    };
    const modHtml = (m, { keys, open, gear } = {}) => {
      // the card's on/off: its own feature switch, or one of its settings (Auto next / Auto print)
      const fields = gear ? [] : m.fields.filter((f) => (!keys || keys.includes(f.k)) && f.k !== m.switchKey);
      const note = typeof m.note === 'function' ? m.note() : m.note;
      const top = m.switchKey ? sw(CFG[sec(m)][m.switchKey], `data-m="${sec(m)}" data-k="${m.switchKey}" data-t="bool"`)
        : m.always || m.cfgId ? '' : sw(CFG[m.id].enabled, `data-en="${m.id}"`);
      return `
      <div class="pqs-mod${open ? ' open' : ''}${gear ? ' gear' : ''}" data-m="${m.id}">
        <div class="pqs-top">
          <span class="ic">${MOD_ICON[m.id] || '•'}</span>
          <span class="t">${escHtml(m.title)}${helpBtn(HELP[m.id] || HELP[m.cfgId])}</span><span class="h">${escHtml(gear || m.hint || '')}</span>
          ${(fields.length || note) && !open && !gear ? '<span class="car">▸</span>' : ''}
          ${top}
        </div>
        <div class="pqs-fields">${note && !gear ? `<div class="pqs-note">${escHtml(note).replace(/\n/g, '<br>')}</div>` : ''}${fields.map((f) => fieldHtml(m, f)).join('')}</div>
      </div>`;
    };
    // Shift+8 · Tools: everything without its own ⚙, then the ones with a ⚙ (only on/off)
    const toolsHtml = () => {
      const plain = SCHEMA.filter((m) => !OWN_GEAR[m.id]), own = SCHEMA.filter((m) => OWN_GEAR[m.id] && !m.always);
      return plain.map((m) => modHtml(m)).join('') +
        `<div class="pqs-sec">Settings in the tool itself (⚙)</div>` + own.map((m) => modHtml(m, { gear: OWN_GEAR[m.id] })).join('');
    };
    // read the inputs of a card into the saved settings (only the modules in it) and reload
    function saveFrom(root) {
      const out = JSON.parse(JSON.stringify(savedCfg(ME.id)));
      for (const m of SCHEMA) out[sec(m)] = { ...CFG[sec(m)], ...(out[sec(m)] || {}) };
      root.querySelectorAll('[data-en]').forEach((el) => { out[el.dataset.en].enabled = el.checked; });
      root.querySelectorAll('[data-k]').forEach((el) => {
        const { m, k, t: ty } = el.dataset;
        if (!out[m]) return;
        out[m][k] = ty === 'bool' ? el.checked : ty === 'num' ? Number(el.value) : ty === 'list' ? el.value.split(',').map((x) => x.trim()).filter(Boolean) : el.value.trim();
      });
      saveCfg(out).then(() => location.reload());
    }
    // ⚙ inside a tool: a small card with just its settings
    openToolSettings = (spec) => {
      document.getElementById('pqs-ov')?.remove();
      const ov = document.createElement('div');
      ov.id = 'pqs-ov';
      const mods = (spec.mods || []).map((x) => ({ m: SCHEMA.find((y) => y.id === x.id), keys: x.keys })).filter((x) => x.m);
      ov.innerHTML = `<div id="pqs-card" class="mini">
        <div class="hd"><div><b>⚙ ${escHtml(spec.title || 'Settings')}</b><small>your account · every PC</small></div><button class="pqs-b" data-x="close">✕</button></div>
        <div class="bd">${mods.map((x) => modHtml(x.m, { keys: x.keys, open: true })).join('')}</div>
        <div class="ft"><span>Everything else: Shift+8</span><div><button class="pqs-b" data-x="close">Cancel</button><button class="pqs-b p" data-x="msave">Save &amp; reload</button></div></div>
      </div>`;
      ov.addEventListener('click', (e) => {
        const x = e.target.closest('[data-x]')?.dataset.x;
        if (e.target === ov || x === 'close') ov.remove();
        if (x === 'msave') saveFrom(ov);
      });
      document.body.appendChild(ov);
    };

    // ---------- teams tab (builds the TEAMS block for GitHub) ----------
    const DRAFT_KEY = 'pqsuite_teams_draft_v1';
    const cleanAllow = (a) => (a === '*' ? '*' : (Array.isArray(a) ? a : []).filter((f) => FEATURES.includes(f)));
    const normTeams = (d) => ({
      teams: (d.teams || []).map((t) => ({ name: String(t.name || 'Team'), allow: cleanAllow(t.allow), users: (t.users || []).map(String) })),
      leftovers: { allow: cleanAllow((d.leftovers || {}).allow) },
    });
    const fromScript = () => normTeams({ teams: TEAMS, leftovers: LEFTOVERS });
    // a half-done edit only counts when it started from the teams.js this page has now
    // (else an old edit from this PC would throw away what was saved on GitHub since)
    const BASE_KEY = 'pqsuite_teams_draft_base_v1';
    let draft = lsGet(DRAFT_KEY, null);
    if (!draft || lsGet(BASE_KEY, null) !== JSON.stringify(fromScript())) draft = fromScript();
    const saveDraft = () => { lsSet(DRAFT_KEY, draft); lsSet(BASE_KEY, JSON.stringify(fromScript())); };
    let savedJson = null; // what we just saved to GitHub (this page still runs on the old teams until reload)
    const dirty = () => JSON.stringify(draft) !== (savedJson || JSON.stringify(fromScript()));
    let people = null, peopleErr = '', q = '', rows = [];

    async function loadPeople() {
      if (people) return;
      try {
        const out = [];
        for (let off = 0; off < 3000; off += 100) {
          const r = await fetch(`/api/v1/users?active=true&offset=${off}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const page = await r.json();
          out.push(...page);
          if (page.length < 100) break;
        }
        people = out.map((u) => ({
          id: String(u.iduser),
          name: normS([u.firstname || u.first_name, u.lastname || u.last_name].filter(Boolean).join(' ')) || u.username || ('#' + u.iduser),
        })).sort((a, b) => a.name.localeCompare(b.name));
      } catch (e) {
        people = [];
        peopleErr = e.message;
      }
    }

    const matchEntry = (u, p) => (isIdLike(u) ? !!p.id && String(u) === p.id : sameName(u, p.name));
    const teamOf = (p) => draft.teams.findIndex((t) => t.users.some((u) => matchEntry(u, p)));
    function entries() {
      const list = (people || []).map((p) => ({ ...p }));
      for (const t of draft.teams) {
        for (const u of t.users) {
          if (!list.some((p) => matchEntry(u, p))) list.unshift(isIdLike(u) ? { id: String(u), name: '', unknown: true } : { id: null, name: u, unknown: true });
        }
      }
      return list;
    }
    function setTeam(p, idx) {
      draft.teams.forEach((t) => (t.users = t.users.filter((u) => !matchEntry(u, p))));
      if (idx >= 0 && draft.teams[idx]) draft.teams[idx].users.push(p.id || p.name);
      saveDraft();
    }
    const colAllow = (i) => (i < 0 ? draft.leftovers.allow : draft.teams[i].allow);
    function setColAllow(i, a) {
      if (i < 0) draft.leftovers.allow = a; else draft.teams[i].allow = a;
      saveDraft();
    }

    // the whole teams.js file, ready to paste over the one on GitHub
    function genConfig() {
      const pName = (id) => ((people || []).find((p) => p.id === String(id)) || {}).name;
      const allowStr = (a) => (a === '*' ? '"*"' : `[${a.map((f) => JSON.stringify(f)).join(', ')}]`);
      const featLines = [];
      let cur = '';
      for (const f of FEATURES) { if (cur && (cur + ' ' + f).length > 62) { featLines.push(cur); cur = ''; } cur = cur ? cur + ' ' + f : f; }
      if (cur) featLines.push(cur);
      const out = [
        '// =====================================================================',
        '//  PICQER SUITE · TEAMS (who may use what)',
        '//  Edit here on GitHub and commit. Every PC has it within ~10 min.',
        '//  Easiest: Shift+8 -> Teams -> Copy config -> paste over this whole file.',
        '//',
        '//  users : Picqer user ids, or a full name in "quotes" (developers Picqer)',
        '//          someone in 2 teams -> the first team counts',
        '//  allow : "*" = everything, or a list of:',
        ...featLines.map((l) => `//          ${l}`),
        '//  leftovers: everyone who is in no team',
        '// =====================================================================',
        'window.PQ_TEAMS = {',
        '  "teams": [',
      ];
      draft.teams.forEach((t, ti) => {
        out.push('    {', `      "name": ${JSON.stringify(t.name)},`, `      "allow": ${allowStr(t.allow)},`, '      "users": [');
        t.users.forEach((u, ui) => {
          const comma = ui < t.users.length - 1 ? ',' : '';
          if (isIdLike(u)) { const nm = pName(u); out.push(`        ${u}${comma}${nm ? ' // ' + nm.replace(/[\r\n]+/g, ' ') : ''}`); }
          else out.push(`        ${JSON.stringify(u)}${comma}`);
        });
        out.push('      ]', `    }${ti < draft.teams.length - 1 ? ',' : ''}`);
      });
      out.push('  ],', `  "leftovers": { "allow": ${allowStr(draft.leftovers.allow)} }`, '};', '');
      return out.join('\n');
    }

    // ---------- save straight to GitHub (the token stays on this PC, never in the script or the repo) ----------
    const GH_REPO = 'Azanone/SABRBUNS', GH_KEY = 'pqsuite_gh_token_v1';
    const ghToken = () => String(lsGet(GH_KEY, '') || '').trim();
    const b64 = (str) => { let bin = ''; for (const x of new TextEncoder().encode(str)) bin += String.fromCharCode(x); return btoa(bin); };
    async function ghPut(file, text, msg, okToOverwrite) {
      const tok = ghToken();
      if (!tok) throw new Error('no GitHub token on this PC yet');
      const url = `https://api.github.com/repos/${GH_REPO}/contents/${file}`;
      const h = { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      for (let a = 0; a < 2; a++) {
        let g;
        try { g = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: h, credentials: 'omit', cache: 'no-store' }); }
        catch (_) { throw new Error('could not reach GitHub from this page (blocked?) · use Copy instead'); }
        if (g.status === 401) throw new Error('GitHub says the token is wrong or expired · make a new one');
        const cur = g.ok ? await g.json() : null;
        const sha = cur ? cur.sha : undefined;
        if (cur && okToOverwrite && a === 0) {
          let old = '';
          try { old = new TextDecoder().decode(Uint8Array.from(atob(String(cur.content || '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))); } catch (_) {}
          if (old && !okToOverwrite(old)) throw new Error('stopped, nothing changed');
        }
        const p = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, credentials: 'omit',
          body: JSON.stringify({ message: msg, content: b64(text), branch: 'main', ...(sha ? { sha } : {}) }) });
        if (p.ok) return true;
        if ((p.status === 409 || p.status === 422) && a === 0) continue; // someone saved in between: take the new version and try again
        const t = await p.text().catch(() => '');
        if (p.status === 401) throw new Error('GitHub says the token is wrong or expired · make a new one');
        if (p.status === 403 || p.status === 404) throw new Error(`GitHub says no (HTTP ${p.status}) · the token needs Contents: Read and write on ${GH_REPO}`);
        throw new Error(`GitHub HTTP ${p.status} ${t.slice(0, 120)}`);
      }
      throw new Error('someone else keeps saving at the same time · try again');
    }
    // this PC uses the new file right away (and does not take the old one back from GitHub's 5 min cache)
    const ghKeep = (r, data) => { lsSet(r.ls, { ts: Date.now(), data }); lsSet(r.lsTry, { ts: Date.now() + REMOTE_EVERY, err: '' }); };
    function ghHtml() {
      if (ghToken()) return `<div class="pqs-gh">GitHub: token saved on this PC · <b>Save to GitHub</b> commits straight to ${GH_REPO}
        <button class="pqs-b" data-x="ghforget">Forget token</button></div>`;
      return `<div class="pqs-gh"><b>Save straight to GitHub</b> (once per PC): on GitHub · Settings · Developer settings · Fine-grained tokens · Generate ·
        Repository access <i>Only select</i> → SABRBUNS · Permissions <i>Contents: Read and write</i> · copy the token, paste it here.
        <div class="pqs-row"><input type="password" data-gh="tok" placeholder="github_pat_…" autocomplete="off"><button class="pqs-b" data-x="ghsave">Save token</button></div>
        <small>Only on your own PC: whoever has the token can change the script for every PC.</small></div>`;
    }

    const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
    function teamsSource() {
      const src = TEAMS_SRC.from === 'github' ? `teams.js from GitHub, checked ${ago(TEAMS_SRC.ts)}`
        : TEAMS_SRC.from === 'require' ? 'teams.js that came with the script'
          : 'built-in fallback (no teams.js found)';
      const last = lsGet(REMOTE.teams.lsTry, null);
      return `Teams on this PC: ${src}${last && last.err ? ` · last check failed: ${escHtml(last.err)}` : ''}`;
    }

    // ---------- colors tab (shared colors.js + this PC) ----------
    function colorsSource() {
      const src = COLORS_SRC.from === 'github' ? `colors.js from GitHub, checked ${ago(COLORS_SRC.ts)}`
        : COLORS_SRC.from === 'require' ? 'colors.js that came with the script' : 'no colors.js found';
      const last = lsGet(REMOTE.colors.lsTry, null);
      return `Shared colors: ${src}${last && last.err ? ` · last check failed: ${escHtml(last.err)}` : ''}`;
    }
    // product code + name of every line on this page
    function pageProducts() {
      const found = new Map();
      document.querySelectorAll('.picklist-product-list__item').forEach((item) => {
        const code = lineCode(item);
        if (!code || found.has(codeKey(code))) return;
        let name = '';
        const grow = item.querySelector('.stack__item--grow');
        if (grow) {
          const clone = grow.cloneNode(true);
          clone.querySelectorAll('.stack, .picklist-product-locations, .label, picqer-product-lot').forEach((el) => el.remove());
          name = (clone.textContent || '').split('\n').map((p) => p.trim()).filter(Boolean)[0] || '';
        }
        found.set(codeKey(code), { code, name });
      });
      return [...found.values()];
    }
    function genColors(map) {
      const out = [
        '// =====================================================================',
        '//  PICQER SUITE · PRODUCT COLORS',
        '//  Picklist lines with exactly this PRODUCT CODE get that color',
        '//  ("GLW-MASKER-75" does not color "GLW-MASKER-750").',
        '//  Edit here on GitHub and commit. Every PC has it within ~10 min.',
        '//  A PC can add its own colors on top: Shift+8 -> Colors (those win on that PC).',
        '//  Colors like "#ff0034" (or red, orange, ...)',
        '// =====================================================================',
        'window.PQ_COLORS = {',
      ];
      const e = Object.entries(map);
      e.forEach(([k, v], i) => out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${i < e.length - 1 ? ',' : ''}`));
      out.push('};', '');
      return out.join('\n');
    }
    function renderColors(pane) {
      const local = localColors(), shared = COLORS_SRC.data || {};
      const prods = pageProducts();
      const nameOf = new Map(prods.map((p) => [codeKey(p.code), p.name]));
      const swatch = (c) => `<span class="pqs-swatch" style="background:${okColor(c) ? escHtml(c) : 'transparent'}"></span>`;
      const row = (k, v, extra) => `<div class="pqs-crow">${swatch(v)}<span class="n">${escHtml(k)}${nameOf.get(codeKey(k)) ? ` <small>${escHtml(nameOf.get(codeKey(k)))}</small>` : ''}</span>` +
        `<small>${escHtml(v)}${okColor(v) ? '' : ' · not a color'}${extra || ''}</small>`;
      pane.innerHTML = `<div class="pqs-sec">
        <div class="pqs-help">Picklist lines with exactly this <b>product code</b> get the color (GLW-MASKER-75 does not color GLW-MASKER-750).
          Shared colors are in <code>colors.js</code> on GitHub (every PC). Colors added here are for <b>this PC only</b> and win over the shared ones.
          <div class="pqs-src">${colorsSource()}</div>${can('settings') ? ghHtml() : ''}</div>
        <h4>Add a color on this PC</h4>
        <div class="pqs-row"><select data-c="prod">${prods.length
          ? '<option value="">-- pick a product from this page --</option>' + prods.map((p) => `<option value="${escHtml(p.code)}">${escHtml(p.code)}${p.name ? ' · ' + escHtml(p.name) : ''}</option>`).join('')
          : '<option value="">(open a picklist to pick products from it)</option>'}</select><input type="color" data-c="col" value="#ff3fff" title="Color"></div>
        <div class="pqs-row"><input type="text" data-c="txt" placeholder="or type the exact product code…"><button class="pqs-b p" data-c="add">Add</button></div>
        <h4>This PC (${Object.keys(local).length})</h4>
        <div class="pqs-clist">${Object.keys(local).length
          ? Object.entries(local).map(([k, v]) => row(k, v) + `<button class="pqs-x" data-c="del" data-k="${escHtml(k)}" title="Remove">✕</button></div>`).join('')
          : '<div class="pqs-empty">none</div>'}</div>
        <h4>Shared · colors.js (${Object.keys(shared).length})</h4>
        <div class="pqs-clist">${Object.keys(shared).length
          ? Object.entries(shared).map(([k, v]) => row(k, v, Object.keys(local).some((l) => codeKey(l) === codeKey(k)) ? ' · this PC uses its own' : '') + '</div>').join('')
          : '<div class="pqs-empty">none</div>'}</div>
        <textarea class="pqs-out" readonly></textarea>
      </div>`;
    }

    function peopleHtml() {
      if (people === null) return '<div class="pqs-empty">Loading people…</div>';
      const ql = q.toLowerCase();
      rows = entries().filter((p) => !ql || (p.name || '').toLowerCase().includes(ql) || (p.id || '').includes(ql));
      const opts = (sel) => draft.teams.map((t, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')
        + `<option value="-1" ${sel < 0 ? 'selected' : ''}>Leftovers</option>`;
      const err = peopleErr ? `<div class="pqs-empty">Could not load the people list (${escHtml(peopleErr)}). Add people by id or name below.</div>` : '';
      if (!rows.length) return err + '<div class="pqs-empty">Nobody found</div>';
      return err + rows.map((p, k) => `<div class="pqs-person"><span class="n">${escHtml(p.name || '(unknown)')} <small>${p.id ? '#' + escHtml(p.id) : 'by name'}${p.unknown ? ' · not in this Picqer' : ''}</small></span>
        <select data-t="pt" data-k="${k}">${opts(teamOf(p))}</select></div>`).join('');
    }

    function renderTeams(pane) {
      const cols = draft.teams.map((t, i) => ({ i, name: t.name, allow: t.allow })).concat([{ i: -1, name: 'Leftovers', allow: draft.leftovers.allow }]);
      const has = (a, f) => a === '*' || a.includes(f);
      pane.innerHTML = `<div class="pqs-sec">
        <div class="pqs-help"><b>How:</b> put people in a team · tick what each team may use · <b>Save to GitHub</b>
          (or Copy config and paste it over <code>teams.js</code> on GitHub). Every PC has it within ~10 min. Everyone in no team is a leftover.
          <div class="pqs-src">${teamsSource()}</div>
          ${dirty() ? '<div class="pqs-dirty">Changes here are not on GitHub yet</div>' : ''}${ghHtml()}</div>
        <h4>What each team may use</h4>
        <div class="pqs-gridwrap"><table class="pqs-grid"><thead><tr><th></th>${cols.map((c) => `<th>
          <div class="pqs-tname">${c.i >= 0 ? `<span data-t="ren" data-i="${c.i}" title="Rename">${escHtml(c.name)}</span> <button class="pqs-x" data-t="del" data-i="${c.i}" title="Delete team">✕</button>` : 'Leftovers'}</div>
          <label class="pqs-all"><input type="checkbox" data-t="all" data-i="${c.i}" ${c.allow === '*' ? 'checked' : ''}> all</label></th>`).join('')}</tr></thead>
          <tbody>${FEATURES.map((f) => `<tr><td>${escHtml(FEATURE_INFO[f])}<small>${f}</small></td>${cols.map((c) =>
            `<td><input type="checkbox" data-t="f" data-i="${c.i}" data-f="${f}" ${has(c.allow, f) ? 'checked' : ''} ${c.allow === '*' ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="pqs-row"><button class="pqs-b" data-t="add">+ Team</button></div>
        <h4>People</h4>
        <div class="pqs-row"><input type="text" placeholder="Search name or id…" data-t="q" value="${escHtml(q)}"></div>
        <div class="pqs-people">${peopleHtml()}</div>
        <div class="pqs-row"><input type="text" placeholder="Not in the list? id or full name" data-t="addp">
          <select data-t="addt">${draft.teams.map((t, i) => `<option value="${i}">${escHtml(t.name)}</option>`).join('')}</select>
          <button class="pqs-b" data-t="addpb" ${draft.teams.length ? '' : 'disabled'}>Add</button></div>
        <textarea class="pqs-out" readonly></textarea>
      </div>`;
    }

    function open() {
      if (document.getElementById('pqs-ov')) return close();
      const ov = document.createElement('div');
      ov.id = 'pqs-ov';
      // settings = tools + teams + colors · colors only = just the colors tab
      const full = can('settings');
      const tabs = full ? (isOwner() ? ['tools', 'teams', 'colors'] : ['tools', 'colors']) : ['colors'];
      const first = tabs[0];
      const label = { tools: '🧰 Tools', teams: '👥 Teams', colors: '🎨 Colors' };
      const hide = (t) => (t === first ? '' : ' style="display:none"');
      ov.innerHTML = `<div id="pqs-card">
        <div class="hd"><div><b>Picqer Suite</b><small>${VERSION ? 'v' + escHtml(VERSION) + ' · ' : ''}Shift+8</small>
          <div class="pqs-who">You: <b>${escHtml(ME.name || 'unknown')}</b>${ME.id ? ' #' + escHtml(ME.id) : ''} · team <b>${escHtml(teamName())}</b></div></div>
          <button class="pqs-b" data-x="close">✕</button></div>
        <div class="pqs-tabs">${tabs.map((t) => `<button class="pqs-tab${t === first ? ' on' : ''}" data-tab="${t}">${label[t]}</button>`).join('')}</div>
        ${full ? `<div class="bd" data-pane="tools"${hide('tools')}>${toolsHtml()}</div>
        ${isOwner() ? `<div class="bd" data-pane="teams"${hide('teams')}></div>` : ''}` : ''}
        <div class="bd" data-pane="colors"${hide('colors')}></div>
        ${full ? `<div class="ft" data-foot="tools"${hide('tools')}><span>Your account · follows you to every PC · after reload</span>
          <div><button class="pqs-b" data-x="reset">Reset</button><button class="pqs-b p" data-x="save">Save &amp; reload</button></div></div>
        ${isOwner() ? `<div class="ft" data-foot="teams"${hide('teams')}><span>Teams come from teams.js on GitHub</span>
          <div><button class="pqs-b" data-x="tstart">Start over</button><button class="pqs-b" data-x="tcopy">Copy config</button><button class="pqs-b p" data-x="tgh">Save to GitHub</button></div></div>` : ''}` : ''}
        <div class="ft" data-foot="colors"${hide('colors')}><span>This PC's colors win over colors.js</span>
          <div><button class="pqs-b" data-x="cclear">Clear this PC</button>${full ? '<button class="pqs-b" data-x="ccopy">Copy colors.js</button><button class="pqs-b p" data-x="cgh">Save to GitHub</button>' : ''}</div></div>
      </div>`;
      const cPane = ov.querySelector('[data-pane="colors"]');
      if (first === 'colors') renderColors(cPane);
      const pane = ov.querySelector('[data-pane="teams"]') || document.createElement('div');
      const reRender = () => renderTeams(pane);
      const updateDirty = () => {
        const help = pane.querySelector('.pqs-help');
        if (!help) return;
        help.querySelector('.pqs-dirty')?.remove();
        if (dirty()) help.insertAdjacentHTML('beforeend', '<div class="pqs-dirty">Changes here are not on GitHub yet</div>');
      };

      ov.querySelectorAll('.pqs-tab').forEach((t) => t.addEventListener('click', () => {
        const name = t.dataset.tab;
        ov.querySelectorAll('.pqs-tab').forEach((x) => x.classList.toggle('on', x === t));
        ov.querySelectorAll('[data-pane]').forEach((p) => (p.style.display = p.dataset.pane === name ? '' : 'none'));
        ov.querySelectorAll('[data-foot]').forEach((p) => (p.style.display = p.dataset.foot === name ? '' : 'none'));
        if (name === 'teams') {
          reRender();
          loadPeople().then(() => { const box = pane.querySelector('.pqs-people'); if (box) box.innerHTML = peopleHtml(); });
        }
        if (name === 'colors') renderColors(cPane);
      }));

      ov.querySelectorAll('.pqs-top').forEach((t) => t.addEventListener('click', (e) => {
        if (e.target.closest('.pqs-sw')) return;
        const mod = t.parentElement;
        if (!(mod.querySelector('.pqs-f') || mod.querySelector('.pqs-note')) || !t.querySelector('.car')) return;
        mod.classList.toggle('open');
        t.querySelector('.car').textContent = mod.classList.contains('open') ? '▾' : '▸';
      }));

      ov.addEventListener('change', (e) => {
        const el = e.target;
        const t = el.dataset && el.dataset.t;
        if (!t) return;
        const i = Number(el.dataset.i);
        if (t === 'all') { setColAllow(i, el.checked ? '*' : FEATURES.slice()); reRender(); }
        else if (t === 'f') {
          const a = colAllow(i);
          if (a === '*') return;
          const next = el.checked ? a.concat(el.dataset.f) : a.filter((x) => x !== el.dataset.f);
          setColAllow(i, FEATURES.filter((x) => next.includes(x)));
          updateDirty();
        } else if (t === 'pt') { const p = rows[Number(el.dataset.k)]; if (p) setTeam(p, Number(el.value)); updateDirty(); }
      });
      ov.addEventListener('input', (e) => {
        if (e.target.dataset && e.target.dataset.t === 'q') {
          q = e.target.value.trim();
          const box = pane.querySelector('.pqs-people');
          if (box) box.innerHTML = peopleHtml();
        }
      });

      ov.addEventListener('click', (e) => {
        if (e.target === ov) return close();
        // colors tab
        const cEl = e.target.closest('[data-c]');
        const cAct = cEl && cEl.dataset.c;
        if (cAct === 'add') {
          let key = normS(cPane.querySelector('[data-c="txt"]').value) || cPane.querySelector('[data-c="prod"]').value;
          const onPage = pageProducts().find((p) => codeKey(p.code) === codeKey(key));
          if (onPage) key = onPage.code; // typed glw-serum-30 -> stored as GLW-SERUM-30 like Picqer has it
          if (!key) { toast('Pick a product or type a name / SKU'); return; }
          const local = localColors();
          for (const k of Object.keys(local)) if (codeKey(k) === codeKey(key)) delete local[k]; // 1 entry per code
          local[key] = cPane.querySelector('[data-c="col"]').value;
          lsSet(LS_COLORS_LOCAL, local);
          colorsChanged();
          renderColors(cPane);
          toast(`Added on this PC: ${key}`);
          return;
        }
        if (cAct === 'del') {
          const local = localColors();
          delete local[cEl.dataset.k];
          lsSet(LS_COLORS_LOCAL, local);
          colorsChanged();
          renderColors(cPane);
          return;
        }
        const tEl = e.target.closest('[data-t]');
        const t = tEl && tEl.dataset.t;
        if (t === 'ren') {
          const i = Number(tEl.dataset.i);
          const n = prompt('Team name:', draft.teams[i].name);
          if (n && n.trim()) { draft.teams[i].name = n.trim(); saveDraft(); reRender(); }
          return;
        }
        if (t === 'del') {
          const i = Number(tEl.dataset.i);
          if (confirm(`Delete team "${draft.teams[i].name}"? Its people become leftovers.`)) { draft.teams.splice(i, 1); saveDraft(); reRender(); }
          return;
        }
        if (t === 'add') {
          const n = prompt('Name of the new team:');
          if (n && n.trim()) { draft.teams.push({ name: n.trim(), allow: [], users: [] }); saveDraft(); reRender(); }
          return;
        }
        if (t === 'addpb') {
          const v = normS(pane.querySelector('[data-t="addp"]').value);
          if (!v) return;
          setTeam(/^\d+$/.test(v) ? { id: v, name: '' } : { id: null, name: v }, Number(pane.querySelector('[data-t="addt"]').value));
          reRender();
          return;
        }
        const x = e.target.closest('[data-x]')?.dataset.x;
        if (x === 'close') close();
        if (x === 'reset' && confirm('Reset all your tool settings to default? (your account, every PC)')) { saveCfg({}).then(() => location.reload()); }
        if (x === 'save') saveFrom(ov.querySelector('[data-pane="tools"]'));
        if (x === 'tstart' && confirm('Throw away your changes and start from the teams.js this PC has now?')) {
          draft = fromScript();
          try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(BASE_KEY); } catch (_) {}
          reRender();
        }
        if (x === 'ghsave') {
          const v = String((ov.querySelector('[data-gh="tok"]') || {}).value || '').trim();
          if (!/^(github_pat_|ghp_)\w{20,}$/.test(v)) { toast('That does not look like a GitHub token (github_pat_…)'); return; }
          lsSet(GH_KEY, v);
          reRender(); renderColors(cPane);
          toast('Token saved on this PC');
          return;
        }
        if (x === 'ghforget' && confirm('Remove the GitHub token from this PC?')) { try { localStorage.removeItem(GH_KEY); } catch (_) {} reRender(); renderColors(cPane); return; }
        if (x === 'tgh' || x === 'cgh') {
          if (!ghToken()) { toast('First paste a GitHub token (box at the top)'); return; }
          const btn = e.target.closest('[data-x]');
          const isT = x === 'tgh';
          let text, data;
          if (isT) { text = genConfig(); data = parseCfgFile(text, 'PQ_TEAMS', 'teams.js'); }
          else {
            data = { ...(COLORS_SRC.data || {}) };
            for (const [k, v] of Object.entries(localColors())) { for (const s0 of Object.keys(data)) if (codeKey(s0) === codeKey(k)) delete data[s0]; data[k] = v; }
            text = genColors(data);
          }
          if (isT ? !validTeams(data) : !validColors(data)) { toast('Something is off in it, not saved'); return; }
          if (isT && !teamFor(ME, data.teams) && TEAMS_SRC && teamFor(ME, TEAMS)) {
            if (!confirm('You are not in any team in this version (you become a leftover and lose Shift+8 settings). Save anyway?')) return;
          }
          btn.disabled = true; btn.textContent = 'Saving…';
          // teams: if GitHub has a newer teams.js than this page started from, ask before overwriting it
          const guard = isT ? (old) => {
            let gh = null;
            try { gh = JSON.stringify(normTeams(parseCfgFile(old, 'PQ_TEAMS', 'teams.js'))); } catch (_) { return true; }
            if (gh === JSON.stringify(fromScript()) || gh === savedJson) return true;
            return confirm('teams.js on GitHub changed since this page loaded (saved from somewhere else).\n\nOK = overwrite it with what you see here\nCancel = stop (reload the page to start from the new one)');
          } : null;
          ghPut(isT ? 'teams.js' : 'colors.js', text, `${isT ? 'Teams' : 'Colors'} changed by ${ME.name || 'someone'} (Picqer Suite)`, guard)
            .then(() => {
              ghKeep(isT ? REMOTE.teams : REMOTE.colors, data);
              if (isT) { savedJson = JSON.stringify(draft); updateDirty(); }
              else { COLORS_SRC = remoteSrc(REMOTE.colors); lsSet(LS_COLORS_LOCAL, {}); colorsChanged(); renderColors(cPane); }
              toast(`Saved to GitHub · every PC has it within ~10 min${isT ? ' · reload to see it here' : ''}`);
            })
            .catch((err) => toast(`Not saved: ${err.message}`))
            .finally(() => { btn.disabled = false; btn.textContent = 'Save to GitHub'; });
          return;
        }
        if (x === 'tcopy') {
          const text = genConfig();
          const box = pane.querySelector('.pqs-out');
          box.value = text;
          box.style.display = 'block';
          const done = () => toast('Copied · on GitHub paste it over all of teams.js and commit');
          const fallback = () => { box.focus(); box.select(); try { document.execCommand('copy'); done(); } catch (_) { toast('Select the text below and copy it'); } };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
          else fallback();
        }
        if (x === 'cclear' && confirm('Remove all colors of this PC? The shared colors.js stays.')) {
          lsSet(LS_COLORS_LOCAL, {});
          colorsChanged();
          renderColors(cPane);
        }
        if (x === 'ccopy') {
          // shared + this PC (this PC wins) = the new colors.js for everyone
          const merged = { ...(COLORS_SRC.data || {}) };
          for (const [k, v] of Object.entries(localColors())) {
            for (const s of Object.keys(merged)) if (codeKey(s) === codeKey(k)) delete merged[s];
            merged[k] = v;
          }
          const text = genColors(merged);
          const box = cPane.querySelector('.pqs-out');
          box.value = text;
          box.style.display = 'block';
          const done = () => toast('Copied · on GitHub paste it over all of colors.js and commit');
          const fallback = () => { box.focus(); box.select(); try { document.execCommand('copy'); done(); } catch (_) { toast('Select the text below and copy it'); } };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
          else fallback();
        }
      });
      document.body.appendChild(ov);
    }
    function close() { document.getElementById('pqs-ov')?.remove(); }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('pqs-ov')) { close(); return; }
      if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
      if ((e.shiftKey && e.code === 'Digit8') || e.key === '*') {
        loneKey(e, () => {
          if (document.getElementById('pqs-ov')) return;
          if (!can('settings') && !can('colors')) { toast(`No access · team ${teamName()} · ${ME.name || 'unknown'}${ME.id ? ' #' + ME.id : ''}`); return; }
          open();
        });
      }
    }, true);
  }

  /* =========================================================================
   *  START
   * ========================================================================= */
  // how long each part takes to start (console: __pqSuiteTimes)
  const T0 = performance.now();
  window.__pqSuiteTimes = window.__pqSuiteTimes || {};
  const safe = (name, fn) => {
    const t = performance.now();
    try { return fn(); } catch (e) { console.warn(`[pq-suite] ${name} crashed`, e); diag('crash', `${name}: ${(e && e.message) || e}`); }
    finally { const ms = Math.round((performance.now() - t) * 10) / 10; window.__pqSuiteTimes[name] = ms; if (ms > 300) diag('init', `${name} took ${Math.round(ms)} ms to start`); }
  };
  const use = (id) => can(id) && on(id);

  // teams.js / colors.js from GitHub in the background (each max every 5 min per PC)
  function refreshRemote(r, onData) {
    const last = lsGet(r.lsTry, null);
    if (last && Date.now() - last.ts < REMOTE_EVERY) return;
    lsSet(r.lsTry, { ts: Date.now(), err: '' });
    fetch(`${RAW}${r.file}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store', credentials: 'omit' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('HTTP ' + res.status))))
      .then((txt) => {
        const data = parseCfgFile(txt, r.varName, r.file);
        if (!r.valid(data)) throw new Error(`${r.file} has the wrong shape`);
        lsSet(r.ls, { ts: Date.now(), data });
        if (onData) onData(data);
      })
      .catch((e) => {
        lsSet(r.lsTry, { ts: Date.now(), err: String((e && e.message) || e) });
        console.warn(`[pq-suite] ${r.file} from GitHub not loaded:`, (e && e.message) || e);
      });
  }
  // new teams count from the next page: tell the person when their tools change
  function onTeams(data) {
    const mine = (teams, left) => { const t = teamFor(ME, teams); return JSON.stringify(t ? [t.name, t.allow] : ['Leftovers', left.allow]); };
    if (mine(TEAMS, LEFTOVERS) !== mine(data.teams, data.leftovers)) teamsToast('Your tools changed (teams.js) · click to reload');
  }
  // new colors count right away
  function onColors(data) {
    const changed = JSON.stringify(COLORS_SRC.data) !== JSON.stringify(data);
    COLORS_SRC = { data, from: 'github', ts: Date.now() };
    if (changed) colorsChanged();
  }
  const refreshTeams = () => refreshRemote(REMOTE.teams, onTeams);

  // ---------- Shift+R: hard update — teams + colors fresh from GitHub, caches gone, newest script ----------
  let hardBusy = false;
  async function hardUpdate() {
    if (hardBusy) return;
    hardBusy = true;
    const box = document.createElement('div');
    box.id = 'pq-hard';
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483646;background:#111827;color:#fff;font:600 13.5px system-ui;padding:12px 18px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:90vw';
    const say = (t) => { box.textContent = t; };
    document.getElementById('pq-hard')?.remove();
    document.body.appendChild(box);
    say('⟳ Updating teams, colors and script…');
    const t = Date.now();
    const notes = [];
    for (const r of [REMOTE.teams, REMOTE.colors]) {
      try {
        const res = await fetch(`${RAW}${r.file}?t=${t}`, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = parseCfgFile(await res.text(), r.varName, r.file);
        if (!r.valid(data)) throw new Error('wrong shape');
        lsSet(r.ls, { ts: Date.now(), data });
        lsSet(r.lsTry, { ts: Date.now(), err: '' });
        notes.push(`${r.file} ✓`);
      } catch (e) { notes.push(`${r.file} ✗ (${e.message})`); }
    }
    // everything kept "for a while" on this PC: gone, so it is fetched new
    ['pqsuite_dark_css_v1', 'pqsuite_update_v1', 'pqsuite_warehouses_v1', 'pqsuite_lb_users_v1', 'pqsuite_batchscan_v1', 'pqsuite_lb_v3']
      .forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
    let latest = null;
    try { latest = ((await (await fetch(`${RAW}picqer-suite.user.js?t=${t}`, { cache: 'no-store', credentials: 'omit', headers: { Range: 'bytes=0-600' } })).text()).match(/@version\s+([\d.]+)/) || [])[1]; } catch (_) {}
    if (latest && newer(latest, SUITE_VERSION)) {
      say(`${notes.join(' · ')} · script ${latest} is out (you have ${SUITE_VERSION}): install it in the new tab, then come back here and reload`);
      const w = window.open(`${RAW}picqer-suite.user.js?t=${t}`, '_blank');
      if (!w) { box.innerHTML = ''; const a = document.createElement('a'); a.href = `${RAW}picqer-suite.user.js?t=${t}`; a.target = '_blank'; a.style.color = '#a5b4fc'; a.textContent = `Click here to install script ${latest}`; box.append(`${notes.join(' · ')} · `, a, ', then reload'); }
      hardBusy = false;
      return;
    }
    say(`${notes.join(' · ')} · script ${SUITE_VERSION} is the newest · reloading…`);
    setTimeout(() => location.reload(), 900);
  }
  document.addEventListener('keydown', (e) => {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.code !== 'KeyR' || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return; // typing a capital R
    loneKey(e, hardUpdate); // a scanner typing an R is not you pressing Shift+R
  }, true);
  // Ctrl+Alt+D: the log
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyD')) return;
    e.preventDefault();
    diagPanel();
  }, true);
  function diagPanel() {
    const old = document.getElementById('pq-diag');
    if (old) { old.remove(); return; }
    const rows = (lsGet(DIAG_LS, []) || []).concat(diagBuf || []);
    const fmtT = (t) => new Date(t).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const head = `Picqer Suite ${SUITE_VERSION} · ${ME.name || '?'} #${ME.id || '?'} · team ${typeof teamName === 'function' ? teamName() : '?'} · ${navigator.userAgent.match(/Chrome\/[\d.]+/) || ''} · ${new Date().toLocaleString('nl-NL')}`;
    const text = [head, ...rows.map((r) => `${fmtT(r[0])}  ${r[1].padEnd(8)} ${r[2]}  [${r[3]}]`)].join('\n');
    const ov = document.createElement('div');
    ov.id = 'pq-diag';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `<div style="width:min(900px,100%);max-height:85vh;display:flex;flex-direction:column;gap:10px;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:16px;font:500 12.5px system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">Log</b><span style="color:#94a3b8">${rows.length} lines · slow loads, waits, errors · Copy and send it</span><span style="flex:1"></span>
      <button data-d="copy" style="padding:7px 14px;border-radius:8px;border:0;background:#6366f1;color:#fff;font-weight:700;cursor:pointer">Copy</button>
      <button data-d="clear" style="padding:7px 12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer">Clear</button>
      <button data-d="x" style="padding:7px 10px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer">✕</button></div>
      <textarea readonly style="flex:1;min-height:50vh;background:#020617;color:#cbd5e1;border:1px solid #1e293b;border-radius:10px;padding:10px;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre;resize:none"></textarea></div>`;
    const ta = ov.querySelector('textarea');
    ta.value = text;
    ov.querySelector('[data-d="x"]').onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    ov.querySelector('[data-d="clear"]').onclick = () => { diagBuf = []; lsSet(DIAG_LS, []); ta.value = head; };
    ov.querySelector('[data-d="copy"]').onclick = async (e) => {
      try { await navigator.clipboard.writeText(ta.value); } catch (_) { ta.select(); document.execCommand('copy'); }
      e.currentTarget.textContent = 'Copied ✓';
    };
    document.body.appendChild(ov);
    ta.scrollTop = ta.scrollHeight;
  }
  function teamsToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.title = 'Click to reload';
    t.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;background:#111827;color:#fff;padding:9px 14px;' +
      'border-radius:8px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer';
    t.onclick = () => location.reload();
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 10000);
  }
  let earlyDone = false, stopBanner = null, tagWatch = null;

  // runs as soon as Picqer's user tag is in the page (it sits in <head>)
  function early() {
    if (earlyDone) return;
    earlyDone = true;
    ME = readUser();
    if (ME.id && String(ME.id) !== String(lsGet(LS_CFG_LAST, ''))) { useCfgOf(ME.id); lsSet(LS_CFG_LAST, String(ME.id)); }
    TEAM = teamFor(ME);
    if (use('banner')) stopBanner = safe('banner-early', bannerEarly);
    if (on('zap') || on('dayson')) safe('zaplog-cache', ZL.installCommentsCache);
    safe('locks-early', locksCss);
  }
  if (document.getElementById('bundle-script-tag-picqer') || document.readyState !== 'loading') early();
  else {
    tagWatch = new MutationObserver(() => { if (document.getElementById('bundle-script-tag-picqer')) { tagWatch.disconnect(); early(); } });
    tagWatch.observe(document.documentElement, { childList: true, subtree: true });
  }

  function main() {
    if (tagWatch) tagWatch.disconnect();
    safe('help', helpInit);
    early();
    ME = readUser(); // now the header is there too, so names match as well
    TEAM = teamFor(ME);
    if (use('banner') && !stopBanner) stopBanner = safe('banner-early', bannerEarly);
    if (!use('banner') && stopBanner) { stopBanner(); stopBanner = null; }
    safe('locks', locks);
    safe('settings', settingsPanel);
    setTimeout(() => safe('cfg-sync', syncCfg), 1500);
    setTimeout(() => safe('update-check', updateCheck), 4000);
    setInterval(() => safe('update-check', updateCheck), 30 * 60000);
    if (use('banner')) safe('banner', bannerMain);
    if (use('shipErr')) safe('shipErr', shipErr);
    if (use('addrFix')) safe('addrFix', addrFix);
    if (use('unpick')) safe('unpick', unpickAll);
    if (use('comboAlert')) safe('comboAlert', comboAlert);
    if (use('replenish')) safe('replenish', replenish);
    if (use('batchOpt')) safe('batchOpt', batchOpt);
    if (use('zap') || use('dayson')) safe('zaplog-overview', ZL.installOverview);
    if (use('zap')) safe('zap', zap);
    if (use('dayson')) safe('dayson', dayson);
    if (use('comboBatcher')) safe('comboBatcher', comboBatcher);
    if (use('autoNext')) safe('autoNext', autoNext);
    if (use('cardColor')) safe('cardColor', cardColor);
    // a new version: skin off, then on again after a moment (the same as doing it by hand, which fixes a bugged look)
    safe('skin', () => {
      const id = ON_LOGIN ? null : (skinOf(ME.id) || {}).id;
      const fresh = lsGet('pqsuite_skin_ver_v1', '') !== SUITE_VERSION;
      lsSet('pqsuite_skin_ver_v1', SUITE_VERSION);
      if (id && fresh) { applySkin(null); setTimeout(() => { skinBuilt = false; applySkin(id); }, 2500); }
      else applySkin(id);
    });
    if (use('leaderboard')) safe('leaderboard', leaderboard);
    safe('teams', refreshTeams);
    if (use('cardColor') || can('colors') || can('settings')) safe('colors', () => refreshRemote(REMOTE.colors, onColors));
    console.log(`[pq-suite] ${VERSION ? 'v' + VERSION + ' · ' : ''}${ME.name || '?'}${ME.id ? ' #' + ME.id : ''} · team ${teamName()} (teams: ${TEAMS_SRC.from})`);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
