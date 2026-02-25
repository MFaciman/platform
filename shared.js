/**
 * AFL Platform — shared.js
 * Shared library exposing window.AFL to all modules.
 * Version: 1.0 | Built per AFL_PLATFORM_SPEC.md
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────
  const SHEET_ID   = '1xVFw8pFrJzcxD8CH7ainimPKD6GW9tn1bb8ggHYUfRs';
  const SHEET_NAME = 'Sheet1';
  const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;

  const LS_KEYS = {
    basket : 'afl_basket',
    client : 'afl_client',
    nav    : 'afl_nav',
    funds  : 'afl_funds',
  };

  // ─────────────────────────────────────────────
  // localStorage helpers
  // ─────────────────────────────────────────────
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  const state = {
    get funds()   { return lsGet(LS_KEYS.funds,  []); },
    set funds(v)  { lsSet(LS_KEYS.funds, v); },
    get basket()  { return lsGet(LS_KEYS.basket, []); },
    set basket(v) { lsSet(LS_KEYS.basket, v); },
    get client()  { return lsGet(LS_KEYS.client, defaultClient()); },
    set client(v) { lsSet(LS_KEYS.client, v); },
    get nav()     { return lsGet(LS_KEYS.nav, 'browse'); },
    set nav(v)    { lsSet(LS_KEYS.nav, v); },
    viewMode: 'advisor', // 'advisor' | 'client' | 'compliance' — in-memory only
  };

  function defaultClient() {
    return {
      name: '', exchangeAmount: null, riskTolerance: '',
      propTypes: [], horizon: null, age: null,
      accredited: true, notes: ''
    };
  }

  // ─────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

  const fmt = {
    pct(v, d = 2) {
      if (!isNum(v)) return '—';
      return Number(v).toFixed(d) + '%';
    },
    money(v) {
      if (!isNum(v)) return '—';
      const n = Number(v);
      if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
      return '$' + n.toFixed(0);
    },
    date(s) {
      if (!s) return '—';
      const d = new Date(s);
      if (isNaN(d)) return s;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    num(v, d = 0) {
      if (!isNum(v)) return '—';
      return Number(v).toFixed(d);
    }
  };

  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function extractStates(locationStr) {
    if (!locationStr) return [];
    return locationStr.split(/[,/|;]+/).map(s => s.trim()).filter(Boolean);
  }

  // ─────────────────────────────────────────────
  // Google Sheets Parser
  // ─────────────────────────────────────────────

  // Maps column label → fund field. Handles known typo 'ear 3' → income[2]
  const COL_MAP = {
    'Sponsor':                       { field: 'sponsor',            type: 'str' },
    'Offering Name':                 { field: 'name',               type: 'str' },
    'Asset Class':                   { field: 'assetClass',         type: 'str' },
    'Sector':                        { field: 'sector',             type: 'str' },
    'Focus':                         { field: 'focus',              type: 'str' },
    'Filed Raise':                   { field: 'filedRaise',         type: 'num' },
    'Current Raise':                 { field: 'currentRaise',       type: 'num' },
    'Remaining Raise':               { field: 'equityRemaining',    type: 'num' },
    'Offering Open':                 { field: 'offeringOpen',       type: 'str' },
    'Offering Close':                { field: 'offeringClose',      type: 'str' },
    'Offering Structure':            { field: 'offeringStructure',  type: 'str' },
    'Year 1 Cash on Cash Distribution': { field: 'y1coc',          type: 'num' },
    'Frequency':                     { field: 'distFrequency',      type: 'str' },
    'Loan to Value':                 { field: 'ltv',                type: 'num' },
    'Preferred':                     { field: 'preferred',          type: 'num' },
    'Promote':                       { field: 'promote',            type: 'str' },
    '721 UpREIT':                    { field: 'upReit',             type: 'str' },
    'Exemption':                     { field: 'exemption',          type: 'str' },
    'Tax Reporting':                 { field: 'taxReporting',       type: 'str' },
    'Hold Period':                   { field: 'holdPeriod',         type: 'num' },
    'Minimum - DST':                 { field: 'minInvest',          type: 'num' },
    '# Assets':                      { field: 'numAssets',          type: 'num' },
    'Property Location(s)':          { field: 'location',           type: 'str' },
    'Building Age':                  { field: 'buildingAge',        type: 'str' },
    '(Avg)% Leased':                 { field: 'occupancy',          type: 'num' },
    'Debt Terms':                    { field: 'debtTerms',          type: 'str' },
    'DSCR':                          { field: 'dscr',               type: 'num' },
    'Lease Terms':                   { field: 'leaseTerms',         type: 'str' },
    'Total Square Footage':          { field: 'sqft',               type: 'num' },
    'Tenant Credit Quality':         { field: 'tenantCredit',       type: 'str' },
    'Rent Escalations':              { field: 'rentEscalations',    type: 'str' },
    'Average Lease Term Remaining':  { field: 'avgLeaseTerm',       type: 'num' },
    'GP Commit':                     { field: 'gpCommit',           type: 'str' },
    'Purchase Price (Unloaded)':     { field: 'purchasePrice',      type: 'num' },
    'Appraised Valuation':           { field: 'appraisedValue',     type: 'num' },
    'Loaded Price':                  { field: 'loadedPrice',        type: 'num' },
    'Acquisition Cap Rate':          { field: 'capRate',            type: 'num' },
    'Rep Comp':                      { field: 'repComp',            type: 'num' },
    'Sales Load':                    { field: 'salesLoad',          type: 'num' },
    'Reserve':                       { field: 'reserve',            type: 'str' },
    'Year 1':                        { field: 'income.0',           type: 'num' },
    'Year 2':                        { field: 'income.1',           type: 'num' },
    'Year 3':                        { field: 'income.2',           type: 'num' },
    'ear 3':                         { field: 'income.2',           type: 'num' }, // known typo
    'Year 4':                        { field: 'income.3',           type: 'num' },
    'Year 5':                        { field: 'income.4',           type: 'num' },
    'Year 6':                        { field: 'income.5',           type: 'num' },
    'Year 7':                        { field: 'income.6',           type: 'num' },
    'Year 8':                        { field: 'income.7',           type: 'num' },
    'Year 9':                        { field: 'income.8',           type: 'num' },
    'Year 10':                       { field: 'income.9',           type: 'num' },
    'Sponsor AUM':                   { field: 'sponsorAum',         type: 'str' },
    'Number of Sponsor Offerings':   { field: 'sponsorOfferings',   type: 'num' },
    'Sponsor Full Cycle Exits':      { field: 'sponsorExits',       type: 'num' },
    'Sponsor Average IRR':           { field: 'sponsorAvgIrr',      type: 'num' },
    'Sponsor Best IRR':              { field: 'sponsorBestIrr',     type: 'num' },
    'Sponsor Worst IRR':             { field: 'sponsorWorstIrr',    type: 'num' },
    'Sponsor Experience':            { field: 'sponsorExperience',  type: 'str' },
    'Brochure':                      { field: 'brochureUrl',        type: 'str' },
    'PPM':                           { field: 'ppmUrl',             type: 'str' },
    'Track Record':                  { field: 'trackRecordUrl',     type: 'str' },
    'Sales Team Map':                { field: 'salesTeamUrl',       type: 'str' },
    'Video':                         { field: 'videoUrl',           type: 'str' },
    'Sponsor News':                  { field: 'sponsorNewsUrl',     type: 'str' },
    'AI Offering Chat':              { field: 'aiChatUrl',          type: 'str' },
    'Quarterly Update URL':          { field: 'quarterlyUpdateUrl', type: 'str' },
    'Sponsor Logo URL':              { field: 'sponsorLogoUrl',     type: 'str' },
  };

  function parseGvizResponse(raw) {
    // Strip google's callback wrapper
    const json = raw.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '');
    const data = JSON.parse(json);
    const cols = data.table.cols.map(c => c.label || c.id);
    const rows = data.table.rows || [];

    return rows.map((row, rowIdx) => {
      const fund = { id: rowIdx + 1, income: Array(10).fill(null) };
      const cells = row.c || [];

      cols.forEach((label, ci) => {
        const cell = cells[ci];
        const val = cell ? (cell.v !== undefined ? cell.v : null) : null;
        const mapped = COL_MAP[label];
        if (!mapped) return;

        if (mapped.field.startsWith('income.')) {
          const idx = parseInt(mapped.field.split('.')[1]);
          fund.income[idx] = isNum(val) ? Number(val) : null;
        } else if (mapped.type === 'num') {
          fund[mapped.field] = isNum(val) ? Number(val) : null;
        } else {
          fund[mapped.field] = val !== null ? String(val) : '';
        }
      });

      // Computed fields
      fund.propType = fund.sector || '';
      fund.displayLabel = fund.name || `Offering ${fund.id}`;
      fund.status = computeStatus(fund.offeringClose);
      fund.pctRemaining = (isNum(fund.equityRemaining) && isNum(fund.filedRaise) && fund.filedRaise > 0)
        ? (fund.equityRemaining / fund.filedRaise) * 100 : null;

      // Raise velocity: currentRaise / months since open
      if (isNum(fund.currentRaise) && fund.offeringOpen) {
        const open = new Date(fund.offeringOpen);
        const now  = new Date();
        const months = (now - open) / (1000 * 60 * 60 * 24 * 30.44);
        fund.raiseVelocity = months > 0 ? fund.currentRaise / months : null;
      } else {
        fund.raiseVelocity = null;
      }

      return fund;
    }).filter(f => f.name); // drop blank rows
  }

  function computeStatus(closeDateStr) {
    if (!closeDateStr) return 'Open';
    const close = new Date(closeDateStr);
    const now   = new Date();
    if (isNaN(close)) return 'Open';
    const daysLeft = (close - now) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0)  return 'Closed';
    if (daysLeft < 30) return 'Closing Soon';
    return 'Open';
  }

  // ─────────────────────────────────────────────
  // Data Loading
  // ─────────────────────────────────────────────
  let _loadPromise = null;

  async function loadFunds(forceRefresh = false) {
    // Return cached if available and not forcing refresh
    const cached = state.funds;
    if (!forceRefresh && cached && cached.length > 0) return cached;

    // Dedupe concurrent calls
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      try {
        const res  = await fetch(SHEETS_URL);
        const text = await res.text();
        const funds = parseGvizResponse(text);
        state.funds = funds;
        return funds;
      } finally {
        _loadPromise = null;
      }
    })();

    return _loadPromise;
  }

  // ─────────────────────────────────────────────
  // Basket
  // ─────────────────────────────────────────────
  const basket = {
    add(id) {
      let b = state.basket;
      if (b.includes(id)) return false;
      if (b.length >= 3) return false; // max 3
      b = [...b, id];
      state.basket = b;
      basket._notify();
      return true;
    },
    remove(id) {
      state.basket = state.basket.filter(x => x !== id);
      basket._notify();
    },
    has(id)  { return state.basket.includes(id); },
    get()    {
      const funds = state.funds;
      return state.basket.map(id => funds.find(f => f.id === id)).filter(Boolean);
    },
    save()   { /* state.basket setter already persists */ },
    count()  { return state.basket.length; },
    _notify() {
      // Dispatch event for shell header to update
      window.dispatchEvent(new CustomEvent('afl:basketchange', { detail: { count: state.basket.length } }));
    }
  };

  // ─────────────────────────────────────────────
  // Suitability Scoring
  // ─────────────────────────────────────────────
  function suitScore(fund, client) {
    if (!client || !client.name) return null;

    let score = 50;

    // LTV scoring
    if (isNum(fund.ltv)) {
      if (fund.ltv <= 60)      score += 20;
      else if (fund.ltv <= 65) score += 0;
      else if (fund.ltv <= 75) score -= 10;
      else                     score -= 20;
    }

    // Minimum investment vs exchange amount
    if (isNum(fund.minInvest) && isNum(client.exchangeAmount)) {
      if (fund.minInvest <= client.exchangeAmount) score += 15;
      else                                          score -= 15;
    }

    // Y1 CoC
    if (isNum(fund.y1coc) && fund.y1coc >= 4.0) score += 15;

    // Property type match
    if (Array.isArray(client.propTypes) && client.propTypes.length > 0 && fund.sector) {
      if (client.propTypes.includes(fund.sector)) score += 10;
    }

    // Occupancy
    if (isNum(fund.occupancy) && fund.occupancy >= 90) score += 10;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function suitLabel(score) {
    if (score === null) return null;
    if (score >= 75) return { label: 'Strong Match', color: 'green' };
    if (score >= 55) return { label: 'Good Match',   color: 'blue'  };
    if (score >= 40) return { label: 'Fair Match',   color: 'amber' };
    return               { label: 'Poor Match',    color: 'red'   };
  }

  // ─────────────────────────────────────────────
  // Peer Stats
  // ─────────────────────────────────────────────
  function peerStats(funds) {
    if (!funds || funds.length === 0) return {};
    const nums = (field) => funds.map(f => f[field]).filter(v => isNum(v)).map(Number);
    const avg  = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null;
    const max  = arr => arr.length ? Math.max(...arr) : null;
    const min  = arr => arr.length ? Math.min(...arr) : null;

    const fields = ['y1coc', 'ltv', 'occupancy', 'holdPeriod', 'minInvest', 'capRate', 'dscr'];
    const stats = {};
    fields.forEach(f => {
      const arr = nums(f);
      stats[f] = { avg: avg(arr), max: max(arr), min: min(arr), count: arr.length };
    });
    return stats;
  }

  // ─────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────
  function navigate(module, params = {}) {
    state.nav = module;
    window.dispatchEvent(new CustomEvent('afl:navigate', { detail: { module, params } }));
  }

  // ─────────────────────────────────────────────
  // Header update (called by modules)
  // ─────────────────────────────────────────────
  function updateHeader(opts = {}) {
    window.dispatchEvent(new CustomEvent('afl:headerupdate', { detail: opts }));
  }

  // ─────────────────────────────────────────────
  // Suitability chip HTML helper
  // ─────────────────────────────────────────────
  function suitChipHTML(fund, client) {
    const score = suitScore(fund, client);
    if (score === null) return '';
    const { label, color } = suitLabel(score);
    return `<span class="suit-chip suit-chip--${color}">${score} — ${label}</span>`;
  }

  // ─────────────────────────────────────────────
  // Status badge HTML helper
  // ─────────────────────────────────────────────
  function statusBadgeHTML(status) {
    const map = {
      'Open':         'badge--green',
      'Closing Soon': 'badge--amber',
      'Closed':       'badge--red',
    };
    const cls = map[status] || 'badge--fog';
    return `<span class="badge ${cls}">${escapeHTML(status)}</span>`;
  }

  // ─────────────────────────────────────────────
  // Module loader (used by shell)
  // ─────────────────────────────────────────────
  async function loadModule(module, params = {}) {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    appContent.innerHTML = `
      <div class="module-loading">
        <div class="loading-spinner"></div>
        <p>Loading…</p>
      </div>`;

    try {
      const res  = await fetch(`${module}.html?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // Parse the fetched HTML
      const parser = new DOMParser();
      const doc    = parser.parseFromString(html, 'text/html');

      // Inject <style> blocks
      doc.querySelectorAll('style').forEach(s => {
        const existing = document.querySelector(`style[data-module="${module}"]`);
        if (existing) existing.remove();
        const el = document.createElement('style');
        el.setAttribute('data-module', module);
        el.textContent = s.textContent;
        document.head.appendChild(el);
      });

      // Inject body content
      const body = doc.body ? doc.body.innerHTML : html;
      appContent.innerHTML = body;

      // Execute scripts in module
      appContent.querySelectorAll('script').forEach(oldScript => {
        const newScript = document.createElement('script');
        if (oldScript.src) {
          newScript.src = oldScript.src;
        } else {
          newScript.textContent = oldScript.textContent;
        }
        oldScript.replaceWith(newScript);
      });

      // Call module init if defined
      if (window.currentModule && typeof window.currentModule.init === 'function') {
        await window.currentModule.init({ client: state.client, basket: state.basket, params });
      }

      state.nav = module;
      updateSidebarActive(module);

    } catch (err) {
      appContent.innerHTML = `
        <div class="module-error">
          <div class="module-error__icon">⚠️</div>
          <h3>Could not load module</h3>
          <p>${escapeHTML(err.message)}</p>
          <button onclick="AFL.loadModule('${module}')">Retry</button>
        </div>`;
      console.error('[AFL] loadModule error:', err);
    }
  }

  function updateSidebarActive(module) {
    document.querySelectorAll('.sidebar-nav__item').forEach(el => {
      el.classList.toggle('sidebar-nav__item--active', el.dataset.module === module);
    });
  }

  // ─────────────────────────────────────────────
  // Expose window.AFL
  // ─────────────────────────────────────────────
  window.AFL = {
    state,
    loadFunds,
    loadModule,
    navigate,
    updateHeader,
    isNum,
    fmt,
    escapeHTML,
    extractStates,
    basket,
    suitScore,
    suitLabel,
    suitChipHTML,
    statusBadgeHTML,
    peerStats,
    // Constants exposed for modules that need them
    SHEET_ID,
    SHEET_NAME,
  };

})();
