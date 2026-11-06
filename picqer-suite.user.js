// ==UserScript==
// @name         Picqer Suite (TRL)
// @namespace    trl.picqer.suite
// @version      3.16
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
  const REMOTE_EVERY = 5 * 60 * 1000;              // fetch each file at most every 5 min per PC
  const FALLBACK_TEAMS = {                         // only if there is no teams.js at all
    teams: [{ name: 'Shift leaders', allow: '*', users: [32247, 'Ahmad Saber'] }],
    leftovers: { allow: ['comboAlert', 'shipErr', 'banner', 'autoNext', 'cardColor', 'pickAll', 'bulkSingles'] },
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
    autoNext: 'Auto print + auto next (A / N)',
    cardColor: 'Product colors on picklists',
    colors: 'Edit this PC\'s colors (Shift+8)',
    pickAll: 'Picqer "Pick alles" buttons',
    bulkSingles: 'Picqer "Verwerk in bulk"',
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
      { k: 'apiKey', label: 'API key (optional, leave empty = use login)', type: 'text', def: '' },
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
    { id: 'autoNext', title: 'Auto print + auto next', hint: 'after a shipment · A = pick all · N = next', fields: [
      { k: 'printLabel', label: 'Print the shipping label', type: 'bool', def: true },
      { k: 'printerId', label: 'Printer id (leave empty if it works)', type: 'text', def: '' },
      { k: 'delayMs', label: 'Wait before going next (ms)', type: 'num', def: 800 },
      { k: 'pickAllKey', label: 'Pick all key', type: 'text', def: 'a' },
      { k: 'nextKey', label: 'Next key', type: 'text', def: 'n' },
    ]},
    { id: 'pickStats', title: 'Picker dashboard', hint: 'Ctrl+Alt+P · TV: add #pickers to a Picqer link', fields: [
      { k: 'warehouse', label: 'Only this warehouse (name or id, empty = all)', type: 'text', def: 'Bunsenstraat' },
      { k: 'pollSec', label: 'Check the batches every (sec)', type: 'num', def: 30 },
      { k: 'background', label: 'Keep watching in the background on this PC (exact times all day)', type: 'bool', def: false },
      { k: 'idleMin', label: 'No progress for this long = idle (min)', type: 'num', def: 5 },
      { k: 'excludeIds', label: 'Leave these user ids out, comma separated', type: 'list', def: [] },
    ]},
    { id: 'cardColor', title: 'Product colors', hint: 'colored bar per exact product code · colors in Shift+8 → Colors', fields: [
      { k: 'qtyBadge', label: 'Show "2x" badge when more than 1', type: 'bool', def: true },
    ]},
  ];

  const LS_CFG = 'pqsuite_cfg_v1';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  function loadCfg() {
    const saved = lsGet(LS_CFG, {});
    const out = {};
    for (const m of SCHEMA) {
      const s = saved[m.id] || {};
      out[m.id] = { enabled: m.always ? true : s.enabled !== false };
      for (const f of m.fields) out[m.id][f.k] = s[f.k] !== undefined ? s[f.k] : f.def;
    }
    return out;
  }
  const CFG = loadCfg();
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
    const mo = new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => { t = null; if (css) addStyle('pq-hide-css', css); hideTagged(); }, 250);
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

    setInterval(() => {
      if (document.hidden || busy) return;
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
    setInterval(() => {
      if (document.hidden || document.getElementById('ca-ov')) return;
      if (document.body.textContent.indexOf(MARKER) === -1) return;
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

    const analyze = (row, url, batchId) => {
      const target = row.querySelector('a[href*="/picklists/batches/"]');
      const loader = createLoader(target);
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
        <div class="zl-head"><h2>ZAP overzicht</h2><span class="zl-sub">wie is er overgenomen &middot; cache ${cacheDays()} dagen</span><button class="zl-x" id="zaplog-x">&times;</button></div>
        <div class="zl-tabs"><button class="zl-tab on" data-r="day">Vandaag</button><button class="zl-tab" data-r="week">Deze week</button><button class="zl-tab" data-r="7d">7 dagen</button></div>
        <div class="zl-body" id="zaplog-body"></div>
        <div class="zl-foot"><span id="zaplog-tot"></span><span style="margin-left:auto"></span><span>ik: <b>${escHtml(me.name || 'onbekend')}</b></span>
          <button class="zl-btn" id="zaplog-me">wijzig</button><button class="zl-btn warn" id="zaplog-clr">wis log</button></div></div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) closeOverview(); });
      wrap.querySelector('#zaplog-x').addEventListener('click', closeOverview);
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
      if (e.key.toLowerCase() === HOTKEY) zapPicklist(document.getElementById('zap-btn'));
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
  function comboBatcher() {
    const C = CFG.comboBatcher;
    async function api(method, path, body) {
      const headers = jsonHeaders();
      if (C.apiKey) headers.Authorization = 'Basic ' + btoa(C.apiKey + ':');
      const r = await fetch(location.origin + '/api/v1' + path, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
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
        autoWarehouse: CFG.pickStats ? CFG.pickStats.warehouse : '', // auto batch: same warehouse as the picker dashboard
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
      #cb-autopill{position:fixed;right:16px;bottom:16px;z-index:99998;display:flex;align-items:center;gap:8px;max-width:min(440px,calc(100vw - 32px));padding:7px 13px;border-radius:999px;
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

    function computeGroup(og) {
      const free = multis.filter((m) => m.pl.idfulfilment_customer === og.shop && m.pl.idwarehouse === og.warehouse && !taken.has(m.pl.idpicklist));
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
          const sel = $opt.querySelector('.cb-sel');
          if (sel) sel.innerHTML = assignOptions();
        });
      }
    }

    function drawOpt() {
      if (tab !== 'opt' || !lastGroups) return;
      const groups = optShown();
      if (!groups.length) { $opt.innerHTML = '<div class="cb-empty">No picklists with 2+ products to batch</div>'; return; }
      const all = groups.flatMap((g) => g.batches);
      const stops = all.reduce((s, b) => s + b.skus.length, 0);
      groups.forEach((g) => (g.byDate = stopsByDate(g.batches.flatMap((b) => b.ms), optMax)));
      const byDate = groups.reduce((s, g) => s + g.byDate, 0);
      const twoWh = new Set(groups.map((g) => g.shop)).size < groups.length;
      let html = `<div class="cb-optbar">
          <label>Max <input type="number" class="cb-max" min="2" max="200" value="${optMax}"> picklists per batch</label>
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
          <div class="cb-acts"><select class="cb-sel" title="Assign the new batches to">${assignOptions()}</select><button class="cb-btn" data-act="ocombine">Combine into 1</button><button class="cb-go" data-act="ocreate">Create batches</button></div></div>
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
      if (busy) return;
      if (e.target.matches('.cb-sel')) {
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
        if (String(pl.idwarehouse) !== String(wid) || taken.has(pl.idpicklist) || !selectedShops.has(pl.idfulfilment_customer)) continue;
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
          ${whSel}<button class="${autoOn ? 'cb-btn cb-auto-stop' : 'cb-go'}" data-act="autotoggle">${autoOn ? 'Turn off' : 'Turn on'}</button></div>
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
      if (t.matches('.cb-autoadd')) {
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
    const nextKey = String(C.nextKey || 'n').toLowerCase();
    let isProcessing = false;
    let enabled = lsGet(LS_ON, true) !== false;
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

    addStyle('pq-an-style', `
      #pq-an-bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:12px;padding:6px 15px;background:#222;color:#fff;
        border-radius:8px;font-family:sans-serif;font-size:11px;box-shadow:0 0 10px rgba(0,0,0,.5),0 0 2px #007bff;border:1px solid #444;font-weight:bold}
      #pq-an-bar .dot{width:7px;height:7px;background:#00ff41;border-radius:50%;margin-right:5px;box-shadow:0 0 5px #00ff41}
      #pq-an-bar .dot.off{background:#777;box-shadow:none}
      #pq-an-bar .div{width:1px;height:14px;background:#555}
      #pq-an-bar .sw{position:relative;display:inline-block;width:30px;height:16px;margin-right:6px}
      #pq-an-bar .sw input{opacity:0;width:0;height:0}
      #pq-an-bar .sl{position:absolute;cursor:pointer;inset:0;background:#ff4d4d;transition:.3s;border-radius:20px}
      #pq-an-bar .sl:before{position:absolute;content:"";height:10px;width:10px;left:3px;bottom:3px;background:#fff;transition:.3s;border-radius:50%}
      #pq-an-bar input:checked + .sl{background:#007bff}
      #pq-an-bar input:checked + .sl:before{transform:translateX(14px)}
      #pq-an-bar label{cursor:pointer;display:flex;align-items:center;color:#eee}
      #pq-an-btn{background:#007bff;color:#fff;border:0;border-radius:5px;padding:3px 8px;font-weight:bold;font-size:11px;cursor:pointer}
      #pq-an-info{color:#9ecbff;font-weight:normal;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #pq-an-info.warn{color:#ffb020;font-weight:bold}`);

    const setInfo = (txt, warn) => {
      const el = document.getElementById('pq-an-info');
      if (el) { el.textContent = txt; el.title = txt; el.classList.toggle('warn', !!warn); }
      if (txt) console.log('[auto-next]', txt);
    };

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
        return nx ? go(nx.url, `→ ${nx.alias} ${nx.ref}`, seen) : stop('batch done ✓');
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

    // ---------- toolbar ----------
    const bar = document.createElement('div');
    bar.id = 'pq-an-bar';
    bar.innerHTML = `<div style="display:flex;align-items:center;letter-spacing:.5px"><span class="dot${C.printLabel ? '' : ' off'}"></span> PRINT</div>
      <div class="div"></div>
      <label><span class="sw"><input type="checkbox" id="pq-an-toggle" ${enabled ? 'checked' : ''}><span class="sl"></span></span>NEXT</label>
      <button id="pq-an-btn" title="next picklist (${escHtml(nextKey.toUpperCase())})">▶</button><span id="pq-an-info"></span>`;
    document.body.appendChild(bar);
    bar.querySelector('#pq-an-toggle').addEventListener('change', (e) => { enabled = e.target.checked; lsSet(LS_ON, enabled); });
    bar.querySelector('#pq-an-btn').addEventListener('click', () => { if (isProcessing) return; isProcessing = true; goNext([]); });

    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (document.getElementById('pqs-ov') || document.getElementById('zaplog-ov') || document.getElementById('ca-ov')) return;
      const cb = document.getElementById('cb-overlay');
      if (cb && cb.style.display === 'flex') return;
      const k = (e.key || '').toLowerCase();
      if (k === pickKey) {
        const btn = document.querySelector('.pick-all-button');
        if (!btn) return;
        if (!can('pickAll') || btn.disabled || btn.dataset.pqLock) { setInfo('Pick alles is not for your team'); return; }
        btn.click();
      } else if (k === nextKey && PID && !isProcessing) {
        isProcessing = true;
        goNext([]);
      }
    });

    if (!PID) return; // batch page, singles etc: only the A key + bar
    prune();
    arrival = takeChain();
    const warn = ss.get('an_warn');
    const c0 = ctx();
    setInfo(isClosed() ? (wasHandled() ? 'done · ▶ = next' : 'closed') : c0.letter ? `letter ${c0.letter}` : c0.batchId ? 'in batch' : 'no batch');
    if (warn) { ss.del('an_warn'); setInfo('⚠ ' + warn, true); }
    if (isClosed() && arrival) { // we jumped here ourselves but this one is done already: keep going
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
      t = setTimeout(() => { t = null; saveCtx(); check(); }, 150);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    setTimeout(check, 600); // a moment later, so an old copy of the script shows up first if it is still installed
    setTimeout(check, 2000);
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
        const color = (code && map.get(codeKey(code))) || ''; // exact product code only
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
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('pq-colors', paint);
    paint();
  }

  /* =========================================================================
   *  PICKER DASHBOARD (Ctrl+Alt+P · TV: open any Picqer page with #pickers)
   *  Picqer has no API for the app's picking itself, but every open batch shows
   *  per product how much is already collected (amount_collected). This checks
   *  the open batches every 30 s and writes down when collecting starts and when
   *  the batch is fully collected, per picker (= who the batch is assigned to).
   *  Exact times only for batches this PC saw while they were picked: keep the
   *  dashboard open on a screen (TV) or turn on background tracking.
   *  Batches nobody watched still count (batches, picklists, units) from Picqer's
   *  completed list, just without a time.
   * ========================================================================= */
  function pickStats() {
    const C = CFG.pickStats;
    const LS_B = 'pqsuite_pick2_batches';    // batches this PC watched + every change in their progress
    const LS_META = 'pqsuite_pick2_meta';
    const LS_LOCK = 'pqsuite_pick2_lock';    // 1 tab per PC does the checking
    for (const k of ['pqsuite_pick_track_v1', 'pqsuite_pick_done_v1', 'pqsuite_pick_lock_v1', 'pqsuite_pick_meta_v1']) { try { localStorage.removeItem(k); } catch (_) {} }
    const DAY = 86400000;
    const POLL = Math.max(15, +C.pollSec || 30) * 1000;
    const IDLE = Math.max(1, +C.idleMin || 5) * 60000;
    const KEEP = 8 * DAY;                     // the longest view is 7 days
    const WH = norm(String(C.warehouse == null ? '' : C.warehouse));
    const TAB = Math.random().toString(36).slice(2);
    const exclude = new Set((C.excludeIds || []).map(String));
    let busyPoll = false, lastErr = '', view = 'now', range = 'today', sortKey = 'units', timer = null, ticker = null, wh = null;
    const ts = (s) => (s ? new Date(String(s).replace(' ', 'T')).getTime() : null);
    const sec = (t) => Math.round(t / 1000);
    const low = (s) => norm(String(s == null ? '' : s)).toLowerCase();
    const person = (u) => (u && u.iduser ? { id: String(u.iduser), name: u.full_name || u.username || `#${u.iduser}` } : null);
    const hm = (t) => (t ? new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–');
    const dm = (t) => new Date(t).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' });
    const dur = (ms) => { if (ms == null || !isFinite(ms)) return '–'; const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`; };
    const perH = (n, ms) => (ms >= 60000 ? Math.round(n / (ms / 3600000)) : null); // at least 1 min of time, else no rate

    async function api(path) {
      for (let i = 0; i < 5; i++) {
        const r = await fetch('/api/v1' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
        if (r.status === 401 || r.status === 403) throw new Error('not logged in to Picqer (or no access)');
        if (!r.ok) throw new Error(`HTTP ${r.status} on ${path.split('?')[0]}`);
        return r.json();
      }
      throw new Error('Picqer says too many requests');
    }
    async function pool(items, n, fn) {
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
    }

    // only this warehouse (Shift+8 -> Tools -> Picker dashboard). name or id, empty = all
    async function warehouse() {
      if (!WH || wh) return wh;
      const list = (await api('/warehouses')) || [];
      const hit = list.find((w) => String(w.idwarehouse) === WH) || list.find((w) => low(w.name) === low(WH)) || list.find((w) => low(w.name).includes(low(WH)));
      if (!hit) throw new Error(`warehouse "${WH}" not found in Picqer (there is: ${list.map((w) => w.name).join(', ') || 'nothing'}) · Shift+8 → Tools → Picker dashboard`);
      wh = { id: +hit.idwarehouse, name: hit.name };
      return wh;
    }
    const inWh = (b) => !wh || b.idwarehouse == null || +b.idwarehouse === wh.id;
    async function allOpen() {
      const out = [];
      const q = wh ? `&idwarehouse=${wh.id}` : '';
      for (let off = 0; off < 3000; off += 100) {
        const p = (await api(`/picklists/batches?status=open${q}&offset=${off}`)) || [];
        out.push(...p);
        if (p.length < 100) break;
      }
      return out.filter(inWh);
    }

    // one batch from Picqer -> numbers
    //   picked in the app  = amount_collected ("11 / 135 gepickt")
    //   packed at the table = amount_picked (not counted here)
    //   singles batches have the numbers on the product line, normal batches per picklist inside the line
    function count(d) {
      let units = 0, v = 0, pk = 0, stops = 0, stopsDone = 0;
      for (const p of d.products || []) {
        const parts = Array.isArray(p.picklists) && p.picklists.some((q) => q && q.amount != null) ? p.picklists : [p];
        let a = 0, L = 0, P = 0;
        for (const q of parts) { const n = +(q && q.amount) || 0; a += n; L += Math.min(n, +q.amount_collected || 0); P += Math.min(n, +q.amount_picked || 0); }
        if (!a) continue;
        units += a; v += L; pk += P; stops++;
        if (L >= a) stopsDone++;
      }
      return { units, v, pk, stops, stopsDone };
    }

    // write down every change. log point = [time in s, picked, products done, timed 1/0]
    // timed = the move before it was also seen by us, so the time in between is real
    function observe(B, d, now) {
      const id = String(d.idpicklist_batch);
      const n = count(d);
      let b = B[id];
      if (!b) b = B[id] = { id, first: now, seen: 0, v: null, log: [], real: false, clean: false, start: null, doneAt: null };
      const watched = !!b.seen && now - b.seen <= 2.5 * POLL; // we also looked just before
      b.nr = d.picklist_batchid; b.title = d.display_title || d.title || ''; b.type = d.type; b.wh = d.idwarehouse;
      b.units = n.units; b.stops = n.stops; b.picklists = d.total_picklists || (d.picklists || []).length;
      b.pk = n.pk; b.upd = d.updated_at; b.open = d.status === 'open';
      const who = person(d.assigned_to);
      if (who) b.picker = who;
      if (b.v == null) {                                    // first look: only a starting point, nothing counts yet
        b.log.push([sec(now), n.v, n.stopsDone, 0]);
        b.clean = n.v === 0;                                 // we see this batch from the very start
        b.before = n.units > 0 && n.v >= n.units;            // already fully picked before we looked
      } else if (n.v !== b.v) {
        const t = watched ? now - (now - b.seen) / 2 : now;  // it happened between our last 2 checks
        if (!watched) b.clean = false;                        // it moved while we were not looking: time unknown
        if (b.v === 0 && n.v > 0 && b.start == null && b.clean) b.start = t;
        b.log.push([sec(t), n.v, n.stopsDone, watched && b.real ? 1 : 0]);
        b.real = watched;
        b.last = t;
        if (n.units > 0 && n.v >= n.units && !b.doneAt && !b.before) { b.doneAt = t; b.doneClean = b.clean && b.start != null && t - b.start >= 60000; }
      }
      b.v = n.v;
      b.sd = n.stopsDone;
      b.seen = now;
      return b;
    }

    async function poll(force) {
      if (busyPoll) return;
      const lock = lsGet(LS_LOCK, null);
      if (!force && lock && lock.tab !== TAB && Date.now() - lock.ts < POLL * 1.5) return; // another tab on this PC does it
      lsSet(LS_LOCK, { tab: TAB, ts: Date.now() });
      busyPoll = true;
      let bad = 0, badMsg = '';
      try {
        await warehouse();
        const now = Date.now();
        const B = lsGet(LS_B, {});
        const meta = lsGet(LS_META, {});
        const whId = wh ? wh.id : 0;
        if (meta.wh !== whId) { for (const k of Object.keys(B)) delete B[k]; meta.wh = whId; meta.since = null; meta.lastSweep = 0; } // other warehouse: start over
        const open = await allOpen();
        const openIds = new Set(open.map((b) => String(b.idpicklist_batch)));
        // look inside: new ones, changed ones, ones someone has, ones that move. all of them every 5 min
        const sweep = !meta.lastSweep || now - meta.lastSweep > 5 * 60000;
        const want = open.filter((b) => {
          const t = B[b.idpicklist_batch];
          if (sweep || !t || t.upd !== b.updated_at) return true;
          if (t.units > 0 && t.v >= t.units) return false; // fully picked, nothing left to see
          return !!b.assigned_to || t.v > 0;
        });
        await pool(want, 4, async (b) => {
          try {
            const d = await api(`/picklists/batches/${b.idpicklist_batch}`);
            if (!inWh(d)) return;
            observe(B, d, now);
          } catch (e) { bad++; badMsg = e.message; }
        });
        if (sweep) meta.lastSweep = now;
        // gone from the open list = completed (or removed): one last look for the last products
        const gone = Object.values(B).filter((t) => t.open && !openIds.has(t.id));
        await pool(gone, 3, async (t) => {
          try {
            const d = await api(`/picklists/batches/${t.id}`);
            observe(B, d, now);
            t.completedAt = ts(d.completed_at);
            t.open = false;
          } catch (e) { t.open = false; t.removed = true; }
        });
        for (const [id, t] of Object.entries(B)) if (Math.max(t.seen || 0, t.first || 0) < now - KEEP) delete B[id];
        lsSet(LS_B, B);
        meta.lastPoll = now;
        meta.whName = wh ? wh.name : '';
        if (!meta.since) meta.since = now;
        lsSet(LS_META, meta);
        lastErr = bad ? `${bad} batch${bad > 1 ? 'es' : ''} could not be read (${badMsg})` : '';
      } catch (e) {
        lastErr = e.message;
      } finally {
        busyPoll = false;
      }
    }

    function rangeOf(r) {
      const d0 = new Date();
      d0.setHours(0, 0, 0, 0);
      const t0 = d0.getTime();
      if (r === 'yesterday') return [t0 - DAY, t0];
      if (r === 'week') { const w = new Date(d0); w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); return [w.getTime(), t0 + DAY]; }
      if (r === '7d') return [t0 - 6 * DAY, t0 + DAY];
      return [t0, t0 + DAY];
    }

    // everything from the progress logs: units count when they get picked, also in batches that are not done
    function compute(from, to) {
      const B = lsGet(LS_B, {});
      const per = new Map(), buckets = new Map(), events = [];
      const byDay = to - from > DAY;
      const bucket = (t, u) => { const d = new Date(t); if (byDay) d.setHours(0, 0, 0, 0); else d.setMinutes(0, 0, 0); buckets.set(d.getTime(), (buckets.get(d.getTime()) || 0) + u); };
      const row = (p) => {
        const k = p ? p.id : '-';
        if (!per.has(k)) per.set(k, { id: k, name: p ? p.name : 'Not assigned', units: 0, stops: 0, tUnits: 0, tStops: 0, ms: 0, batches: new Set(), done: 0, doneTimed: 0, doneMs: 0, first: null, last: null, days: new Set() });
        return per.get(k);
      };
      for (const b of Object.values(B)) {
        if (b.picker && exclude.has(b.picker.id)) continue;
        const L = b.log || [];
        for (let i = 1; i < L.length; i++) {
          const t1 = L[i][0] * 1000;
          if (t1 < from || t1 >= to) continue;
          const du = L[i][1] - L[i - 1][1], ds = L[i][2] - L[i - 1][2];
          const r = row(b.picker);
          r.units += du; r.stops += ds; r.batches.add(b.id);
          if (L[i][3]) { r.tUnits += du; r.tStops += ds; r.ms += Math.min(t1 - L[i - 1][0] * 1000, IDLE); }
          r.first = r.first == null ? t1 : Math.min(r.first, t1);
          r.last = r.last == null ? t1 : Math.max(r.last, t1);
          r.days.add(new Date(t1).toDateString());
          bucket(t1, du);
          events.push({ t: t1, b, du, v: L[i][1] });
        }
        if (b.doneAt && b.doneAt >= from && b.doneAt < to) {
          const r = row(b.picker);
          r.done++;
          if (b.doneClean) { r.doneTimed++; r.doneMs += b.doneAt - b.start; }
        }
      }
      events.sort((a, b) => b.t - a.t);
      return { rows: [...per.values()].filter((r) => r.units || r.done), buckets, byDay, events };
    }

    // 1 person = 1 batch at a time: show each person once (the batch that moves), done batches never
    function current() {
      const now = Date.now(), B = lsGet(LS_B, {});
      const fresh = Object.values(B).filter((t) => t.open && t.seen > now - 3 * POLL - 60000 && !(t.picker && exclude.has(t.picker.id)));
      const people = new Map();
      for (const t of fresh) { const k = t.picker ? t.picker.id : `batch-${t.id}`; if (!people.has(k)) people.set(k, []); people.get(k).push(t); }
      const live = [], waiting = [];
      for (const list of people.values()) {
        const moving = list.filter((t) => t.units > 0 && t.v > 0 && t.v < t.units).sort((a, b) => (b.last || b.first) - (a.last || a.first));
        if (moving.length) { live.push(moving[0]); continue; }
        const next = list.filter((t) => t.units > 0 && t.v === 0 && !t.pk && t.picker).sort((a, b) => a.first - b.first); // not packed at the table either
        if (next.length) waiting.push({ t: next[0], more: next.length - 1 });
      }
      const name = (t) => (t.picker ? t.picker.name : '~');
      live.sort((a, b) => name(a).localeCompare(name(b)));
      waiting.sort((a, b) => name(a.t).localeCompare(name(b.t)));
      return { live, waiting, blind: fresh.filter((t) => !t.units).length };
    }

    // ---------- view ----------
    addStyle('pk-style', `
      #pk-ov{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto;
        font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a}
      #pk-ov.tv{background:#f1f5f9;padding:18px}
      #pk-card{width:1100px;max-width:100%;background:#f8fafc;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.3);overflow:hidden}
      #pk-ov.tv #pk-card{width:100%;box-shadow:none;background:none}
      #pk-card button{font-family:inherit}
      .pk-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:#fff;border-bottom:1px solid #e2e8f0}
      .pk-top b{font-size:16px}
      .pk-sub{color:#64748b;font-size:12px}
      .pk-sub.err{color:#dc2626;font-weight:600}
      .pk-tabs{display:flex;gap:4px;margin-left:auto}
      .pk-tab{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;color:#475569;cursor:pointer}
      .pk-tab.on{background:#0f172a;border-color:#0f172a;color:#fff}
      .pk-btn{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:600;color:#0f172a;cursor:pointer}
      .pk-btn:hover{background:#e2e8f0}
      .pk-body{padding:14px 16px 18px}
      .pk-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:16px}
      .pk-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
      .pk-kpi small{display:block;color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
      .pk-kpi b{font-size:22px;font-variant-numeric:tabular-nums}
      .pk-h{margin:16px 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#475569}
      .pk-bar{height:8px;background:#e2e8f0;border-radius:6px;overflow:hidden}
      .pk-bar i{display:block;height:100%;background:#2563eb;border-radius:6px}
      .pk-wait{margin-top:10px;color:#475569;font-size:12px;line-height:1.9}
      .pk-wait.err{color:#b45309;font-weight:600}
      .pk-count{font-size:13px;color:#475569;margin:0 0 10px}
      .pk-count b{color:#0f172a;font-size:15px}
      .pk-now{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
      .pk-nc{background:#fff;border:1px solid #e2e8f0;border-left:5px solid #2563eb;border-radius:10px;padding:10px 12px}
      .pk-nc.idle{border-left-color:#f59e0b;background:#fffbeb}
      .pk-nc .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
      .pk-nc .who{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pk-nc .time{font-weight:800;font-size:20px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .pk-nc .sub{display:flex;justify-content:space-between;gap:8px;color:#64748b;font-size:12px;margin:2px 0 8px}
      .pk-nc .sub a{color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pk-nc .sub a:hover{text-decoration:underline}
      .pk-nc .sub span{white-space:nowrap}
      .pk-nc .nums{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:13px;color:#334155;font-variant-numeric:tabular-nums}
      .pk-nc .nums b{font-size:15px;color:#0f172a}
      .pk-nc .nums small{color:#94a3b8}
      .pk-nc .foot{margin-top:4px;font-size:11px;color:#94a3b8}
      .pk-nc.idle .foot{color:#b45309;font-weight:600}
      .pk-nc.idle .pk-bar i{background:#f59e0b}
      .pk-wait span{display:inline-block;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:0 10px;margin:0 4px 4px 0;white-space:nowrap}
      .pk-empty{background:#fff;border:1px dashed #cbd5e1;border-radius:10px;padding:14px;text-align:center;color:#64748b}
      .pk-table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
      .pk-table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:right;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;cursor:pointer;white-space:nowrap}
      .pk-table th:first-child,.pk-table td:first-child{text-align:left}
      .pk-table th.on{color:#0f172a}
      .pk-table td{padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .pk-table tr:last-child td{border-bottom:0}
      .pk-table td small{color:#94a3b8}
      .pk-tw{overflow-x:auto;border-radius:10px}
      .pk-chart{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px 6px}
      .pk-cols{display:flex;align-items:flex-end;gap:6px;height:150px}
      .pk-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
      .pk-col i{display:block;width:100%;background:#2563eb;border-radius:4px 4px 0 0}
      .pk-col .v{font-size:11px;color:#334155;margin-bottom:3px;font-variant-numeric:tabular-nums}
      .pk-col .l{font-size:11px;color:#64748b;margin-top:5px;white-space:nowrap}
      .pk-log{background:#fff;border:1px solid #e2e8f0;border-radius:10px;max-height:320px;overflow:auto}
      .pk-le{display:grid;grid-template-columns:auto 1fr 2fr auto auto;gap:12px;padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;align-items:center;font-variant-numeric:tabular-nums}
      .pk-le:last-child{border-bottom:0}
      .pk-le .t{color:#64748b}
      .pk-le .n{font-weight:600}
      .pk-le .b{color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pk-le .d{font-weight:700;color:#15803d;text-align:right}
      .pk-le .d.neg{color:#dc2626}
      .pk-le .v{text-align:right;min-width:90px}
      .pk-note{margin-top:14px;color:#64748b;font-size:12px;line-height:1.5}
      #pk-ov.tv .pk-note,#pk-ov.tv [data-a="tv"],#pk-ov.tv .pk-logwrap{display:none}
      @media (max-width:760px){.pk-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pk-tabs{margin-left:0}.pk-le{grid-template-columns:auto 1fr auto}.pk-le .b,.pk-le .v{display:none}}`);

    function chart(buckets, byDay, from, to) {
      const keys = [];
      if (byDay) for (let t = from; t < to; t += DAY) { const d = new Date(t); d.setHours(0, 0, 0, 0); if (!keys.includes(d.getTime())) keys.push(d.getTime()); }
      else {
        const hs = [...buckets.keys()];
        if (!hs.length) return '<div class="pk-empty">Nothing picked in this period yet</div>';
        const a = Math.min(...hs, from + 7 * 3600000), b = Math.max(...hs, a + 9 * 3600000);
        for (let t = a; t <= b; t += 3600000) keys.push(t);
      }
      const vals = keys.map((k) => Math.max(0, buckets.get(k) || 0));
      const max = Math.max(1, ...vals);
      const lab = (k) => (byDay ? new Date(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : String(new Date(k).getHours()).padStart(2, '0'));
      return `<div class="pk-chart" role="img" aria-label="units picked ${byDay ? 'per day' : 'per hour'}"><div class="pk-cols">${keys.map((k, i) =>
        `<div class="pk-col" title="${vals[i]} units"><span class="v">${vals[i] || ''}</span><i style="height:${Math.round((vals[i] / max) * 110)}px"></i><span class="l">${lab(k)}</span></div>`).join('')}</div></div>`;
    }
    // when did this batch start? known = we saw the first pick. else: the first time we saw it moving (so "at least")
    function startOf(t) {
      if (t.start != null) return { t0: t.start, known: true };
      const p = (t.log || []).find((x) => x[1] > 0);
      return { t0: p ? p[0] * 1000 : t.first, known: false };
    }
    function nowCard(t, now) {
      const pct = t.units ? Math.round((t.v / t.units) * 100) : 0;
      const { t0, known } = startOf(t);
      const lastMove = t.last || t.first;
      const idle = now - lastMove > IDLE;
      const L = t.log || [];
      let u = 0, ms = 0;
      for (let i = 1; i < L.length; i++) if (L[i][3]) { u += L[i][1] - L[i - 1][1]; ms += Math.min((L[i][0] - L[i - 1][0]) * 1000, IDLE); }
      const pace = perH(u, ms);
      return `<div class="pk-nc${idle ? ' idle' : ''}">
        <div class="top"><span class="who">${escHtml(t.picker ? t.picker.name : 'Not assigned')}</span><span class="time" title="${known ? 'picking since the first product' : 'was already going when this PC started watching'}">${known ? dur(now - t0) : now - t0 < 60000 ? '–' : `≥ ${dur(now - t0)}`}</span></div>
        <div class="sub"><a href="/picklists/batches/${escHtml(t.id)}" target="_blank" title="${escHtml(t.title)}">${escHtml(t.title || 'Batch')} · ${escHtml(t.nr)}</a><span>${known ? 'since' : 'already going at'} ${hm(t0)}</span></div>
        <div class="pk-bar"><i style="width:${pct}%"></i></div>
        <div class="nums"><span><b>${t.v}</b> / ${t.units} units</span><span><b>${t.stops}</b> SKUs <small>· ${t.sd} done</small></span></div>
        <div class="foot">${idle ? `no pick for ${dur(now - lastMove)}` : pace ? `${pace} units/h` : '&nbsp;'}</div></div>`;
    }

    function render() {
      const ov = document.getElementById('pk-ov');
      if (!ov) return;
      if (view === 'now') renderNow(ov); else renderStats(ov);
      if (ov.classList.contains('tv')) fitTv(ov);
    }
    function statusLine() {
      const meta = lsGet(LS_META, {});
      return lastErr ? `<span class="pk-sub err">⚠ ${escHtml(lastErr)}</span>`
        : `<span class="pk-sub">checked ${meta.lastPoll ? hm(meta.lastPoll) : '–'} · every ${Math.round(POLL / 1000)} s${meta.since ? ` · watching on this PC since ${dm(meta.since)} ${hm(meta.since)}` : ''}</span>`;
    }
    const whLabel = () => (wh ? wh.name : (lsGet(LS_META, {}).whName || (WH ? WH : 'all warehouses')));
    const btns = (other) => `<button class="pk-btn" data-a="${other}">${other === 'stats' ? 'Stats' : 'In progress'}</button><button class="pk-btn" data-a="refresh" title="Check now">⟳</button><button class="pk-btn" data-a="tv" title="Copy the TV link">TV link</button><button class="pk-btn" data-a="close" title="Esc">✕</button>`;
    // only the batches being picked right now: who, how long, how many SKUs
    function renderNow(ov) {
      const now = Date.now();
      const cur = current();
      const nm = (t) => (t.picker ? t.picker.name : '~');
      const list = cur.live.map((t) => ({ t, el: now - startOf(t).t0 })).sort((a, b) => b.el - a.el || nm(a.t).localeCompare(nm(b.t))).map((x) => x.t);
      ov.querySelector('#pk-card').innerHTML = `
        <div class="pk-top"><b>In progress · ${escHtml(whLabel())}</b>${statusLine()}<div class="pk-tabs">${btns('stats')}</div></div>
        <div class="pk-body">
          <div class="pk-count"><b>${list.length}</b> batch${list.length === 1 ? '' : 'es'} being picked · longest first</div>
          ${list.length ? `<div class="pk-now">${list.map((t) => nowCard(t, now)).join('')}</div>` : '<div class="pk-empty">Nobody is picking a batch right now</div>'}
          ${cur.blind ? `<div class="pk-wait err">⚠ ${cur.blind} open batch${cur.blind > 1 ? 'es come' : ' comes'} back from Picqer without product lines, so their progress can't be seen</div>` : ''}
          <div class="pk-note">Time = since the first product of the batch was picked in the app. "≥" = the batch was already going when this PC started watching, so it is at least that long. SKUs = different products in the batch.</div>
        </div>`;
    }
    function renderStats(ov) {
      const [from, to] = rangeOf(range);
      const { rows, buckets, byDay, events } = compute(from, to);
      const meta = lsGet(LS_META, {});
      const now = Date.now();
      const tot = rows.reduce((s, r) => ({ u: s.u + r.units, tu: s.tu + r.tUnits, ms: s.ms + r.ms, d: s.d + r.done, p: s.p + (r.units > 0 ? 1 : 0) }), { u: 0, tu: 0, ms: 0, d: 0, p: 0 });
      const cur = range === 'today' ? current() : { live: [], waiting: [], blind: 0 };
      const val = (r) => ({ name: r.name, units: r.units, stops: r.stops, batches: r.batches.size, done: r.done, ms: r.ms,
        uph: perH(r.tUnits, r.ms) ?? -1, sph: perH(r.tStops, r.ms) ?? -1, avg: r.doneTimed ? r.doneMs / r.doneTimed : -1 }[sortKey]);
      rows.sort((a, b) => (sortKey === 'name' ? a.name.localeCompare(b.name) : (val(b) - val(a))) || b.units - a.units);
      const th = (k, label) => `<th data-s="${k}" class="${sortKey === k ? 'on' : ''}">${label}${sortKey === k ? ' ▾' : ''}</th>`;
      const whName = wh ? wh.name : (meta.whName || (WH ? WH : 'all warehouses'));
      const status = lastErr ? `<span class="pk-sub err">⚠ ${escHtml(lastErr)}</span>`
        : `<span class="pk-sub">checked ${meta.lastPoll ? hm(meta.lastPoll) : '–'} · every ${Math.round(POLL / 1000)} s${meta.since ? ` · watching on this PC since ${dm(meta.since)} ${hm(meta.since)}` : ''}</span>`;
      const watchingSince = meta.since ? `${dm(meta.since)} ${hm(meta.since)}` : 'now';
      ov.querySelector('#pk-card').innerHTML = `
        <div class="pk-top"><b>Pickers · ${escHtml(whName)}</b>${status}
          <div class="pk-tabs">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['7d', '7 days']].map(([k, l]) => `<button class="pk-tab${range === k ? ' on' : ''}" data-r="${k}">${l}</button>`).join('')}</div>
          ${btns('now')}</div>
        <div class="pk-body">
          <div class="pk-kpis">
            <div class="pk-kpi"><small>Units picked</small><b>${tot.u}</b></div>
            <div class="pk-kpi"><small>Units / hour</small><b>${perH(tot.tu, tot.ms) ?? '–'}</b></div>
            <div class="pk-kpi"><small>Batches done</small><b>${tot.d}</b></div>
            <div class="pk-kpi"><small>Pickers</small><b>${tot.p}</b></div>
            <div class="pk-kpi"><small>Picking now</small><b>${range === 'today' ? cur.live.length : '–'}</b></div>
          </div>
          <div class="pk-h">Per picker</div>
          ${rows.length ? `<div class="pk-tw"><table class="pk-table"><thead><tr>${th('name', 'Picker')}${th('units', 'Units')}${th('stops', 'Products')}${th('batches', 'Batches')}${th('done', 'Done')}${th('ms', 'Pick time')}${th('uph', 'Units/h')}${th('sph', 'Products/h')}${th('avg', 'Avg batch')}<th>${byDay ? 'Days' : 'Active'}</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td><b>${escHtml(r.name)}</b></td><td>${r.units}</td><td>${r.stops}</td><td>${r.batches.size}</td><td>${r.done}</td>
              <td>${r.ms ? dur(r.ms) : '<small>–</small>'}</td><td><b>${perH(r.tUnits, r.ms) ?? '<small>–</small>'}</b></td><td>${perH(r.tStops, r.ms) ?? '<small>–</small>'}</td>
              <td>${r.doneTimed ? dur(r.doneMs / r.doneTimed) : '<small>–</small>'}</td><td>${byDay ? r.days.size : `${hm(r.first)}–${hm(r.last)}`}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="pk-empty">Nothing picked in this period${meta.since ? ` (this PC watches since ${watchingSince})` : ''}</div>`}
          <div class="pk-h">${byDay ? 'Units per day' : 'Units per hour'}</div>
          ${chart(buckets, byDay, from, to)}
          <div class="pk-logwrap"><div class="pk-h">Progress log${events.length > 80 ? ' · last 80' : ''}</div>
          ${events.length ? `<div class="pk-log">${events.slice(0, 80).map((e) => `<div class="pk-le"><span class="t">${byDay ? `${dm(e.t)} ` : ''}${hm(e.t)}</span><span class="n">${escHtml(e.b.picker ? e.b.picker.name : 'Not assigned')}</span>
            <span class="b">${escHtml(e.b.title || 'Batch')} · ${escHtml(e.b.nr)}</span><span class="d${e.du < 0 ? ' neg' : ''}">${e.du > 0 ? '+' : ''}${e.du}</span><span class="v">${e.v} / ${e.b.units}${e.b.units && e.v >= e.b.units ? ' ✓' : ''}</span></div>`).join('')}</div>`
            : '<div class="pk-empty">Nothing picked in this period yet</div>'}</div>
          <div class="pk-note">Only batches in ${escHtml(whName)}. Picked = what the pickers collected in the app (packing at the table does not count). Every change gets logged, also for batches that are not done.
            Picker = who the batch is assigned to. Pick time = time between 2 picks (max ${Math.round(IDLE / 60000)} min per gap). The first pick of a batch, and picks after this PC was not looking, count as units but not as time.
            Only what this PC saw counts: keep it open on a screen or turn on background tracking (Shift+8 → Tools → Picker dashboard).</div>
        </div>`;
    }
    // TV: as big as the screen allows (wide screens get bigger text, long lists still fit)
    function fitTv(ov) {
      const card = ov.querySelector('#pk-card');
      if (!card || !('zoom' in card.style)) return;
      card.style.zoom = '';
      const w = ov.clientWidth - 36, h = ov.clientHeight - 36;
      const z = Math.max(1, Math.min(2.2, w / 1250, h / Math.max(1, card.offsetHeight)));
      card.style.zoom = z > 1.04 ? String(Math.round(z * 100) / 100) : '';
    }

    function close() {
      document.getElementById('pk-ov')?.remove();
      clearInterval(timer);
      clearInterval(ticker);
      if (/^#pickers/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    }
    async function open(tvMode) {
      if (document.getElementById('pk-ov')) return;
      const ov = document.createElement('div');
      ov.id = 'pk-ov';
      if (tvMode) ov.classList.add('tv');
      ov.innerHTML = '<div id="pk-card"><div class="pk-body"><div class="pk-empty">Checking the batches…</div></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', async (e) => {
        if (e.target === ov && !tvMode) return close();
        const el = e.target.closest('[data-r],[data-a],[data-s]');
        if (!el) return;
        if (el.dataset.r) { range = el.dataset.r; render(); }
        else if (el.dataset.s) { sortKey = el.dataset.s; render(); }
        else if (el.dataset.a === 'close') close();
        else if (el.dataset.a === 'stats' || el.dataset.a === 'now') { view = el.dataset.a; render(); }
        else if (el.dataset.a === 'refresh') { await poll(true); render(); }
        else if (el.dataset.a === 'tv') {
          const link = `${location.origin}/picklists/batches#pickers`;
          try { await navigator.clipboard.writeText(link); el.textContent = 'copied ✓'; } catch (_) { prompt('TV link:', link); }
        }
      });
      await poll(true);
      render();
      timer = setInterval(async () => { await poll(); render(); }, POLL);
      ticker = setInterval(render, 5000);
    }

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyP') { e.preventDefault(); document.getElementById('pk-ov') ? close() : open(false); }
      else if (e.key === 'Escape' && document.getElementById('pk-ov')) close();
    }, true);
    window.addEventListener('resize', () => { const ov = document.getElementById('pk-ov'); if (ov && ov.classList.contains('tv')) fitTv(ov); });
    const tvHash = () => /^#pickers/.test(location.hash);
    if (tvHash()) open(true);
    window.addEventListener('hashchange', () => { if (tvHash()) open(true); });
    if (C.background) {
      setTimeout(() => poll(), 3000);
      setInterval(() => { if (!document.getElementById('pk-ov')) poll(); }, POLL);
    }
    return { poll, compute, observe, rangeOf };
  }

  /* =========================================================================
   *  LOCKS: hide Picqer's own power buttons for teams that may not use them
   * ========================================================================= */
  function locksCss() {
    if (can('pickAll')) document.getElementById('pq-lock-css')?.remove();
    else addStyle('pq-lock-css', '.pick-all-button-container{display:none!important}');
  }
  function locks() {
    locksCss();
    const rules = [];
    if (!can('pickAll')) rules.push(/^(pick alles|pick all|ik heb ze allemaal|i have them all)$/i);
    if (!can('bulkSingles')) rules.push(/^(verwerk in bulk|process in bulk)$/i);
    if (!rules.length) return;
    const sweep = () => {
      document.querySelectorAll('button, a.btn').forEach((b) => {
        if (b.dataset.pqLock) return;
        const t = norm(b.textContent);
        if (!t || t.length > 30 || !rules.some((re) => re.test(t))) return;
        b.dataset.pqLock = '1';
        b.style.setProperty('display', 'none', 'important');
        if ('disabled' in b) b.disabled = true;
      });
    };
    sweep();
    setInterval(() => { if (!document.hidden) sweep(); }, 600);
  }

  /* =========================================================================
   *  SETTINGS PANEL (Shift+8 / *) + TEAMS EDITOR
   * ========================================================================= */
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
      .pqs-top .h{color:#6b7280;font-size:12px}
      .pqs-top .car{color:#9ca3af;width:12px}
      .pqs-fields{display:none;margin:10px 0 2px 22px;gap:8px;flex-direction:column}
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
    const toolsHtml = () => SCHEMA.map((m) => `
      <div class="pqs-mod" data-m="${m.id}">
        <div class="pqs-top">
          <span class="car">${m.fields.length ? '▸' : ''}</span>
          <span class="t">${escHtml(m.title)}</span><span class="h">${escHtml(m.hint || '')}</span>
          ${m.always ? '' : sw(CFG[m.id].enabled, `data-en="${m.id}"`)}
        </div>
        <div class="pqs-fields">${m.fields.map((f) => {
          const v = CFG[m.id][f.k];
          const a = `data-m="${m.id}" data-k="${f.k}" data-t="${f.type}"`;
          if (f.type === 'bool') return `<div class="pqs-f"><label>${escHtml(f.label)}</label>${sw(v, a)}</div>`;
          if (f.type === 'num') return `<div class="pqs-f"><label>${escHtml(f.label)}</label><input type="number" value="${escHtml(v)}" ${a}></div>`;
          const val = f.type === 'list' ? (v || []).join(', ') : v;
          return `<div class="pqs-f"><label>${escHtml(f.label)}</label><input type="text" value="${escHtml(val)}" ${a}></div>`;
        }).join('')}</div>
      </div>`).join('');

    // ---------- teams tab (builds the TEAMS block for GitHub) ----------
    const DRAFT_KEY = 'pqsuite_teams_draft_v1';
    const cleanAllow = (a) => (a === '*' ? '*' : (Array.isArray(a) ? a : []).filter((f) => FEATURES.includes(f)));
    const fromScript = () => ({
      teams: TEAMS.map((t) => ({ name: String(t.name || 'Team'), allow: cleanAllow(t.allow), users: (t.users || []).map(String) })),
      leftovers: { allow: cleanAllow(LEFTOVERS.allow) },
    });
    let draft = lsGet(DRAFT_KEY, null) || fromScript();
    const saveDraft = () => lsSet(DRAFT_KEY, draft);
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
    async function ghPut(file, text, msg) {
      const tok = ghToken();
      if (!tok) throw new Error('no GitHub token on this PC yet');
      const url = `https://api.github.com/repos/${GH_REPO}/contents/${file}`;
      const h = { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      for (let a = 0; a < 2; a++) {
        let g;
        try { g = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: h, credentials: 'omit', cache: 'no-store' }); }
        catch (_) { throw new Error('could not reach GitHub from this page (blocked?) · use Copy instead'); }
        if (g.status === 401) throw new Error('GitHub says the token is wrong or expired · make a new one');
        const sha = g.ok ? (await g.json()).sha : undefined;
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
      const tabs = full ? ['tools', 'teams', 'colors'] : ['colors'];
      const first = tabs[0];
      const label = { tools: 'Tools', teams: 'Teams', colors: 'Colors' };
      const hide = (t) => (t === first ? '' : ' style="display:none"');
      ov.innerHTML = `<div id="pqs-card">
        <div class="hd"><div><b>Picqer Suite</b><small>${VERSION ? 'v' + escHtml(VERSION) + ' · ' : ''}Shift+8</small>
          <div class="pqs-who">You: <b>${escHtml(ME.name || 'unknown')}</b>${ME.id ? ' #' + escHtml(ME.id) : ''} · team <b>${escHtml(teamName())}</b></div></div>
          <button class="pqs-b" data-x="close">✕</button></div>
        <div class="pqs-tabs">${tabs.map((t) => `<button class="pqs-tab${t === first ? ' on' : ''}" data-tab="${t}">${label[t]}</button>`).join('')}</div>
        ${full ? `<div class="bd" data-pane="tools"${hide('tools')}>${toolsHtml()}</div>
        <div class="bd" data-pane="teams"${hide('teams')}></div>` : ''}
        <div class="bd" data-pane="colors"${hide('colors')}></div>
        ${full ? `<div class="ft" data-foot="tools"${hide('tools')}><span>This PC only · for everyone on this PC, within their team · after reload</span>
          <div><button class="pqs-b" data-x="reset">Reset</button><button class="pqs-b p" data-x="save">Save &amp; reload</button></div></div>
        <div class="ft" data-foot="teams"${hide('teams')}><span>Teams come from teams.js on GitHub</span>
          <div><button class="pqs-b" data-x="tstart">Start over</button><button class="pqs-b" data-x="tcopy">Copy config</button><button class="pqs-b p" data-x="tgh">Save to GitHub</button></div></div>` : ''}
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
        if (!mod.querySelector('.pqs-f')) return;
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
        if (x === 'reset' && confirm('Reset all tool settings on this PC to default?')) { lsSet(LS_CFG, {}); location.reload(); }
        if (x === 'save') {
          const out = {};
          for (const m of SCHEMA) out[m.id] = { ...CFG[m.id] };
          ov.querySelectorAll('[data-en]').forEach((el) => { out[el.dataset.en].enabled = el.checked; });
          ov.querySelectorAll('[data-k]').forEach((el) => {
            const { m, k, t: ty } = el.dataset;
            out[m][k] = ty === 'bool' ? el.checked : ty === 'num' ? Number(el.value) : ty === 'list' ? el.value.split(',').map((s) => s.trim()).filter(Boolean) : el.value.trim();
          });
          lsSet(LS_CFG, out);
          location.reload();
        }
        if (x === 'tstart' && confirm('Throw away your changes and start from the teams.js this PC has now?')) {
          draft = fromScript();
          try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
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
          ghPut(isT ? 'teams.js' : 'colors.js', text, `${isT ? 'Teams' : 'Colors'} changed by ${ME.name || 'someone'} (Picqer Suite)`)
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
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!can('settings') && !can('colors')) { toast(`No access · team ${teamName()} · ${ME.name || 'unknown'}${ME.id ? ' #' + ME.id : ''}`); return; }
        open();
      }
    }, true);
  }

  /* =========================================================================
   *  START
   * ========================================================================= */
  const safe = (name, fn) => { try { return fn(); } catch (e) { console.warn(`[pq-suite] ${name} crashed`, e); } };
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
    early();
    ME = readUser(); // now the header is there too, so names match as well
    TEAM = teamFor(ME);
    if (use('banner') && !stopBanner) stopBanner = safe('banner-early', bannerEarly);
    if (!use('banner') && stopBanner) { stopBanner(); stopBanner = null; }
    safe('locks', locks);
    safe('settings', settingsPanel);
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
    if (use('pickStats')) safe('pickStats', pickStats);
    safe('teams', refreshTeams);
    if (use('cardColor') || can('colors') || can('settings')) safe('colors', () => refreshRemote(REMOTE.colors, onColors));
    console.log(`[pq-suite] ${VERSION ? 'v' + VERSION + ' · ' : ''}${ME.name || '?'}${ME.id ? ' #' + ME.id : ''} · team ${teamName()} (teams: ${TEAMS_SRC.from})`);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
