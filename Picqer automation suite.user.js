// ==UserScript==
// @name         Picqer Automation Suite
// @namespace    http://tampermonkey.net/
// @version      3.7
// @description  Auto-Print + Auto-Next as soon as a shipment is made, also when Picqer refreshes the page to "Gesloten". Double letters first, then the next letter of the batch. 'a' = Pick All, N or ▶ = next by hand.
// @author       Azanone
// @match        https://*.picqer.com/picklists/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/Azanone/SABRBUNS/main/picqer-automation-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Azanone/SABRBUNS/main/picqer-automation-suite.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    printerId: "",
    pickAllKey: "a",
    nextKey: "n",                 // next by hand
    autoNextDelayMs: 800,
    pickAllSelector: ".pick-all-button",
    statusMessage: "Zending succesvol aangemaakt",
    processedWithinMin: 3         // "Verwerkt op ... door <you>" this recent counts as just made
  };

  let isProcessing = false;
  let autoNextEnabled = GM_getValue("autoNextEnabled", true);
  let rowsPromise = null;
  let flashAtLoad = new Set();
  let arrival = null;             // set when we landed here through our own next
  let pendingWarn = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const P_RE = /P\d{4}-\d+/;
  const log = (...a) => console.log('[auto-next]', ...a);
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch (_) {} }
  };
  const idOf = (u) => {
    try { return (new URL(u, location.href).pathname.match(/^\/picklists\/(\d+)\/?$/) || [])[1] || null; }
    catch (_) { return null; }
  };
  const PID = idOf(location.href); // only on a picklist page (/picklists/123)

  const addStyles = () => {
    const style = document.createElement('style');
    style.innerHTML = `
      #picqer-auto-toolbar {
        position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
        z-index: 10000; display: flex; align-items: center; gap: 12px;
        padding: 6px 15px; background: #222; color: #fff;
        border-radius: 8px; font-family: sans-serif; font-size: 11px;
        box-shadow: 0 0 10px rgba(0,0,0,0.5), 0 0 2px #007bff;
        border: 1px solid #444; font-weight: bold;
      }
      .p-status-dot { width: 7px; height: 7px; background: #00ff41; border-radius: 50%; margin-right: 5px; box-shadow: 0 0 5px #00ff41; }
      .p-divider { width: 1px; height: 14px; background: #555; }
      .p-switch { position: relative; display: inline-block; width: 30px; height: 16px; margin-right: 6px; }
      .p-switch input { opacity: 0; width: 0; height: 0; }
      .p-slider { position: absolute; cursor: pointer; inset: 0; background-color: #ff4d4d; transition: .3s; border-radius: 20px; }
      .p-slider:before { position: absolute; content: ""; height: 10px; width: 10px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; }
      input:checked + .p-slider { background-color: #007bff; }
      input:checked + .p-slider:before { transform: translateX(14px); }
      .p-label { cursor: pointer; display: flex; align-items: center; color: #eee; }
      .p-label:hover { color: #fff; }
      #p-next-btn { background: #007bff; color: #fff; border: 0; border-radius: 5px; padding: 3px 8px; font-weight: bold; font-size: 11px; cursor: pointer; }
      #p-next-info { color: #9ecbff; font-weight: normal; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #p-next-info.p-warn { color: #ffb020; font-weight: bold; }
    `;
    document.head.appendChild(style);
  };

  const setInfo = (txt, warn) => {
    const el = document.getElementById('p-next-info');
    if (el) { el.textContent = txt; el.title = txt; el.classList.toggle('p-warn', !!warn); }
    log(txt);
  };

  // ---------- this page ----------
  const currentRef = () => {
    const m = norm(document.querySelector('h1')?.textContent).match(P_RE) || document.title.match(P_RE);
    return m ? m[0] : null;
  };
  const myName = () => norm(document.querySelector('.layout-header-account .d-mobile-none')?.childNodes[0]?.textContent).toLowerCase();
  const isClosed = () => !!document.querySelector('.label-picklist-closed') ||
    /\b(Gesloten|Closed)\b/.test(norm(document.querySelector('h1.page-title, h1')?.textContent));
  const batchNav = () => document.querySelector('.part-of-batch__batch-navigation');
  const currentLetter = () => (norm(batchNav()?.textContent).match(/Alias\s+([A-Z]+)/i) || [])[1] || null;
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

  // batch + letter + next arrow are saved while the picklist is open, so we still know them after the refresh
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
    return {
      batchId: liveBatchId() || s.batchId || null,
      letter: currentLetter() || s.letter || null,
      arrow: batchArrow() || s.arrow || null,
      header: headerArrow()
    };
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
  const flashEls = () => [...document.querySelectorAll(FLASH_SEL)].filter((el) => (el.textContent || '').includes(CONFIG.statusMessage));

  // after the refresh: "Gesloten" + "Verwerkt op 26-10-2026 18:37 door Ahmad Saber vanuit ..."
  let procCache = null;
  function processed() {
    if (procCache) return procCache;
    const txt = norm(document.querySelector('.header-subtitle')?.textContent);
    const m = txt.match(/(?:Verwerkt op|Processed on)\s+(\d{1,2})-(\d{1,2})-(\d{4}),?\s+(?:om\s+|at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?(?:\s+(?:door|by)\s+(.+))?/i);
    if (!m) return null;
    const by = norm(m[6]).toLowerCase().split(/\s+(?:vanuit|from|toegewezen|assigned)\b/)[0].trim();
    procCache = { at: new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime(), by };
    return procCache;
  }
  function processedInfo() {
    const p = processed();
    if (!p) return { recent: false, byMe: false, byOther: false };
    const age = Date.now() - p.at;
    const me = myName();
    const known = !!p.by && !!me;
    const byMe = known && (p.by === me || p.by.includes(me) || me.includes(p.by));
    return { recent: age > -2 * 60000 && age < CONFIG.processedWithinMin * 60000, byMe, byOther: known && !byMe };
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
    const scriptTag = document.getElementById('bundle-script-tag-picqer-picklists-show');
    if (scriptTag) {
      try {
        const params = JSON.parse(scriptTag.getAttribute('data-params'));
        const urlMatch = params?.createShipmentBackgroundActionStartUrl?.match(/shipment=(\d+)/);
        if (urlMatch && +urlMatch[1] > 0) return urlMatch[1];
      } catch (e) {}
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
    while (Date.now() - t0 < ms) {
      const id = getShipmentId();
      if (id) return id;
      await sleep(250);
    }
    return null;
  }
  const printHeaders = () => ({
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-CSRF-TOKEN": document.querySelector('meta[name="csrf-token"]')?.content || ''
  });
  function gmPost(url, body) {
    return new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: "POST", url, headers: printHeaders(), data: JSON.stringify(body), timeout: 15000,
          onload: (r) => resolve(r.status || 200),
          onerror: () => resolve(0),
          ontimeout: () => resolve(0)
        });
      } catch (e) { resolve(0); }
    });
  }
  async function printLabel(shipmentId) {
    const url = `https://${location.hostname}/picklists/shipments/${shipmentId}/printlabel`;
    const body = { amount: 1, printer_id: CONFIG.printerId, idpicklist_shipment: shipmentId };
    const st = await gmPost(url, body);
    if (st >= 200 && st < 400) return true;
    try { // plan B: same call from the page itself
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: printHeaders(), body: JSON.stringify(body) });
      return r.ok;
    } catch (e) { return false; }
  }

  // ---------- batch page ----------
  const actionOf = (row) => [...row.querySelectorAll('a,button')].find((b) => /^(verwerk|process)$/i.test(norm(b.textContent)));
  function rowHref(row) {
    const links = [...row.querySelectorAll('a[href]')];
    const a = links.find((l) => P_RE.test(l.textContent) && idOf(l.getAttribute('href'))) ||
      links.find((l) => idOf(l.getAttribute('href')));
    return a ? a.getAttribute('href') : null;
  }
  function aliasOf(row) {
    const tag = norm(row.querySelector('.picklist-alias')?.textContent);
    if (tag) return tag.split(' ')[0];
    const cell = [...row.querySelectorAll('td')].map((td) => norm(td.textContent)).find((t) => /^[A-Z]{1,3}$/.test(t));
    if (cell) return cell;
    const first = norm(row.querySelector('td')?.textContent).split(' ')[0];
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
        id: idOf(href),
        ref: (r.textContent.match(P_RE) || [])[0],
        alias: aliasOf(r),
        url: new URL(href, location.href).href,
        open: !(green || (anyAction ? !actionOf(r) : /Verwerkt|Compleet|Geannuleerd/.test(r.textContent)))
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
    } catch (e) { return null; }
  }

  // ---------- next ----------
  function go(url, info, seen) {
    setInfo(info);
    ss.set('an_chain', JSON.stringify({ t: Date.now(), to: idOf(url), seen: [...seen, PID].slice(-80) }));
    if (pendingWarn) ss.set('an_warn', pendingWarn);
    location.assign(url);
  }
  function stop(info) {
    if (pendingWarn) setInfo(`${info} · ⚠ ${pendingWarn}`, true);
    else setInfo(info);
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
    const rows = rowsPromise ? await Promise.race([rowsPromise, sleep(2500).then(() => null)]) : null;
    const myRef = currentRef();
    const isMe = (p) => p.id === PID || (!!myRef && p.ref === myRef);
    const ok = (p) => p.open && !isMe(p) && !seen.includes(p.id);
    const i = rows ? rows.findIndex(isMe) : -1;
    const pick = (f) => !rows ? null : i < 0 ? (rows.find(f) || null) : (rows.slice(i + 1).find(f) || rows.slice(0, i).find(f) || null);

    // 1) same letter still open (the doubles: G, G, G)
    if (c.letter) {
      const L = c.letter.toUpperCase();
      const dup = pick((p) => ok(p) && p.alias.toUpperCase() === L);
      if (dup) return go(dup.url, `→ ${dup.alias} ${dup.ref} (same letter)`, seen);
    }
    // 2) next letter = Picqer's > in the batch bar (unless the batch page says that one is done already)
    if (c.arrow && !seen.includes(idOf(c.arrow))) {
      const row = rows && rows.find((p) => p.id === idOf(c.arrow));
      if (!row || row.open) return go(c.arrow, `→ next letter${row && row.alias ? ' ' + row.alias : ''}`, seen);
    }
    // 3) next one in the batch that is still open
    if (rows) {
      const nx = pick(ok);
      return nx ? go(nx.url, `→ ${nx.alias} ${nx.ref}`, seen) : stop('batch done ✓');
    }
    // 4) not in a batch: Picqer's normal > at the top
    if (!c.batchId && !c.letter && c.header && !seen.includes(idOf(c.header))) return go(c.header, '→ next', seen);
    return stop(c.batchId || c.letter ? 'end of batch' : 'no next found');
  }

  async function printAndNext(why) {
    if (isProcessing) return;
    isProcessing = true;
    markHandled(); // never twice for the same picklist in this tab
    setInfo('✓ ' + why);
    const c = ctx();
    if (autoNextEnabled && c.batchId && !rowsPromise) rowsPromise = loadRows(c.batchId); // load the batch while the label prints
    const shipmentId = await waitShipmentId(2500);
    if (shipmentId) {
      setInfo('printing label…');
      if (!(await printLabel(shipmentId))) pendingWarn = `${currentRef() || PID}: label print failed`;
    } else pendingWarn = `${currentRef() || PID}: no shipment found, label not printed`;
    if (!autoNextEnabled) return stop(pendingWarn ? 'auto next off' : 'label printed');
    if (pendingWarn) setInfo('⚠ ' + pendingWarn, true);
    await sleep(CONFIG.autoNextDelayMs);
    await goNext([]);
  }

  function check() {
    if (isProcessing) return;
    const why = shipmentJustMade();
    if (why) printAndNext(why);
  }

  // ---------- UI ----------
  const initUI = () => {
    addStyles();
    const container = document.createElement('div');
    container.id = 'picqer-auto-toolbar';
    container.innerHTML = `
      <div style="display: flex; align-items: center; letter-spacing: 0.5px;">
        <span class="p-status-dot"></span> PRINT
      </div>
      <div class="p-divider"></div>
      <label class="p-label">
        <div class="p-switch">
          <input type="checkbox" id="autoNextToggle" ${autoNextEnabled ? 'checked' : ''}>
          <span class="p-slider"></span>
        </div>
        NEXT
      </label>
      <button id="p-next-btn" title="next picklist (N)">▶</button>
      <span id="p-next-info"></span>
    `;
    document.body.appendChild(container);
    document.getElementById('autoNextToggle').addEventListener('change', (e) => {
      autoNextEnabled = e.target.checked;
      GM_setValue("autoNextEnabled", autoNextEnabled);
    });
    document.getElementById('p-next-btn').addEventListener('click', () => {
      if (isProcessing) return;
      isProcessing = true;
      goNext([]);
    });
    if (!PID) return;
    const c = ctx();
    setInfo(isClosed() ? (wasHandled() ? 'done · ▶ = next' : 'closed') : c.letter ? `letter ${c.letter}` : c.batchId ? 'in batch' : 'no batch');
  };

  const handleKeydown = (e) => {
    const activeElem = document.activeElement;
    const isTyping = activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'TEXTAREA' || activeElem.tagName === 'SELECT' || activeElem.isContentEditable);
    if (isTyping || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const k = (e.key || '').toLowerCase();
    if (k === CONFIG.pickAllKey) {
      const pickAllBtn = document.querySelector(CONFIG.pickAllSelector);
      if (!pickAllBtn) return;
      if (pickAllBtn.disabled || pickAllBtn.dataset.pqLock) { setInfo('Pick alles is locked (suite teams)'); return; }
      pickAllBtn.click();
    } else if (k === CONFIG.nextKey && !isProcessing) {
      isProcessing = true;
      goNext([]);
    }
  };

  // ---------- start ----------
  initUI();
  window.addEventListener('keydown', handleKeydown);
  if (!PID) return; // batch page, singles etc: only the A key

  prune();
  arrival = takeChain();
  const warn = ss.get('an_warn');
  if (warn) { ss.del('an_warn'); setInfo('⚠ ' + warn, true); }

  if (isClosed() && arrival) {
    // we jumped here ourselves but this one is done already: keep going
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
  check();
  setTimeout(check, 700);
  setTimeout(check, 2000);
})();
