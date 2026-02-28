/**
 * shared.js — AFL Platform Shared Library
 * Alts Fund Link | Alternative Asset Diligence Intelligence
 *
 * Exposes window.AFL — used by every module.
 * Load this in index.html (shell) before any module is injected.
 *
 * API surface:
 *   AFL.state            — live state (reads/writes localStorage)
 *   AFL.loadFunds()      — fetch + parse Google Sheets → AFL.state.funds
 *   AFL.basket.*         — basket CRUD (max 3)
 *   AFL.suitScore()      — suitability algorithm (0–100) ← SINGLE SOURCE OF TRUTH
 *   AFL.peerStats()      — averages across all funds
 *   AFL.navigate()       — SPA router (triggers shell)
 *   AFL.updateHeader()   — signals shell to re-render header
 *   AFL.fmt.*            — formatting helpers
 *   AFL.isNum()          — type guard
 *   AFL.escapeHTML()     — XSS safety
 *   AFL.extractStates()  — parse location strings → state array
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  //  CONSTANTS
  // ─────────────────────────────────────────────────────────────
  const SHEET_ID   = '1xVFw8pFrJzcxD8CH7ainimPKD6GW9tn1bb8ggHYUfRs';
  const SHEET_NAME = 'Sheet1';
  const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;

  const LS_KEYS = {
    basket : 'afl_basket',
    client : 'afl_client',
    nav    : 'afl_nav',
    funds  : 'afl_funds',          // session cache (sessionStorage)
    viewMode: 'afl_view_mode',
  };

  const BASKET_MAX = 3;

  // ─────────────────────────────────────────────────────────────
  //  LOCAL STORAGE HELPERS
  // ─────────────────────────────────────────────────────────────
  function lsGet(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function ssGet(key, fallback = null) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function ssSet(key, val) {
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  //  STATE  (live object — writes through to localStorage)
  // ─────────────────────────────────────────────────────────────
  const _state = {
    funds    : [],          // array of parsed fund objects (in-memory)
    basket   : lsGet(LS_KEYS.basket, []),
    client   : lsGet(LS_KEYS.client, {
      name           : '',
      exchangeAmount : null,
      riskTolerance  : '',
      propTypes      : [],
      horizon        : null,
      age            : null,
      accredited     : true,
      notes          : ''
    }),
    nav      : lsGet(LS_KEYS.nav, 'browse'),
    viewMode : lsGet(LS_KEYS.viewMode, 'advisor'), // 'advisor' | 'client' | 'compliance'
  };

  // Proxy so assignments auto-persist
  const state = new Proxy(_state, {
    set(target, key, value) {
      target[key] = value;
      if (key === 'basket')   lsSet(LS_KEYS.basket, value);
      if (key === 'client')   lsSet(LS_KEYS.client, value);
      if (key === 'nav')      lsSet(LS_KEYS.nav, value);
      if (key === 'viewMode') lsSet(LS_KEYS.viewMode, value);
      return true;
    }
  });

  // ─────────────────────────────────────────────────────────────
  //  COLUMN → FIELD MAP
  //  Handles the confirmed Sheet column names (including "ear 3" typo)
  // ─────────────────────────────────────────────────────────────
  const COL_MAP = {
    'Sponsor'                         : 'sponsor',
    'Offering Name'                   : 'name',
    'Asset Class'                     : 'assetClass',
    'Sector'                          : 'sector',
    'Focus'                           : 'focus',
    'Filed Raise'                     : 'filedRaise',
    'Current Raise'                   : 'currentRaise',
    'Remaining Raise'                 : 'equityRemaining',
    'Offering Open'                   : 'offeringOpen',
    'Offering Close'                  : 'offeringClose',
    'Offering Structure'              : 'offeringStructure',
    'Year 1 Cash on Cash Distribution': 'y1coc',  // fallback
    'Year 1 Cash on Cash': 'y1coc',
    'Frequency'                       : 'distFrequency',
    'Loan to Value'                   : 'ltv',
    'Preferred'                       : 'preferred',
    'Promote'                         : 'promote',
    '721 UpREIT'                      : 'upReit',
    'Exemption'                       : 'exemption',
    'Tax Reporting'                   : 'taxReporting',
    'Hold Period'                     : 'holdPeriod',
    'Minimum - DST'                   : 'minInvest',
    '# Assets'                        : 'numAssets',
    'Property Location(s)'            : 'location',
    'Building Age'                    : 'buildingAge',
    '(Avg)% Leased'                   : 'occupancy',  // fallback
    '% Leased'                        : 'occupancy',
    'Debt Terms'                      : 'debtTerms',
    'DSCR'                            : 'dscr',
    'Lease Terms'                     : 'leaseTerms',
    'Total Square Footage'            : 'sqft',
    'Tenant Credit Quality'           : 'tenantCredit',
    'Rent Escalations'                : 'rentEscalations',
    'Average Lease Term Remaining'    : 'avgLeaseTerm',
    'GP Commit'                       : 'gpCommit',
    'Purchase Price (Unloaded)'       : 'purchasePrice',
    'Appraised Valuation'             : 'appraisedValue',
    'Loaded Price'                    : 'loadedPrice',
    'Acquisition Cap Rate'            : 'capRate',
    'Rep Comp'                        : 'repComp',
    'Sales Load'                      : 'salesLoad',
    'Reserve'                         : 'reserve',
    // Income projections (Year 1–10; note "ear 3" typo variant)
    'Year 1'  : 'income_0',
    'Year 2'  : 'income_1',
    'Year 3'  : 'income_2',
    'ear 3'   : 'income_2',   // ← confirmed typo in sheet
    'Year 4'  : 'income_3',
    'Year 5'  : 'income_4',
    'Year 6'  : 'income_5',
    'Year 7'  : 'income_6',
    'Year 8'  : 'income_7',
    'Year 9'  : 'income_8',
    'Year 10' : 'income_9',
    // Sponsor stats
    'Sponsor AUM'                     : 'sponsorAum',
    'Number of Sponsor Offerings'     : 'sponsorOfferings',
    'Sponsor Full Cycle Exits'        : 'sponsorExits',
    'Sponsor Average IRR'             : 'sponsorAvgIrr',
    'Sponsor Best IRR'                : 'sponsorBestIrr',
    'Sponsor Worst IRR'               : 'sponsorWorstIrr',
    'Sponsor Experience'              : 'sponsorExperience',
    // Document / media URLs
    'Brochure'                        : 'brochureUrl',
    'PPM'                             : 'ppmUrl',
    'Track Record'                    : 'trackRecordUrl',
    'Sales Team Map'                  : 'salesTeamUrl',
    'Video'                           : 'videoUrl',
    'Sponsor News'                    : 'sponsorNewsUrl',
    'AI Offering Chat'                : 'aiChatUrl',
    'Quarterly Update URL'            : 'quarterlyUpdateUrl',
    'Sponsor Logo URL'                : 'sponsorLogoUrl',
  };

  // Numeric fields (will be coerced to Number)
  const NUM_FIELDS = new Set([
    'filedRaise','currentRaise','equityRemaining','y1coc','ltv','preferred',
    'holdPeriod','minInvest','numAssets','occupancy','dscr','sqft','avgLeaseTerm',
    'purchasePrice','appraisedValue','loadedPrice','capRate','repComp','salesLoad',
    'sponsorOfferings','sponsorExits','sponsorAvgIrr','sponsorBestIrr','sponsorWorstIrr',
    'income_0','income_1','income_2','income_3','income_4',
    'income_5','income_6','income_7','income_8','income_9',
  ]);

  // Percentage fields: GViz may return decimals (0.0525) or whole numbers (5.25).
  // Normalize to whole-number percentages (5.25) to match shell convention.
  const PCT_FIELDS = new Set([
    'y1coc','ltv','occupancy','preferred','repComp','capRate','salesLoad',
    'sponsorAvgIrr','sponsorBestIrr','sponsorWorstIrr',
    'income_0','income_1','income_2','income_3','income_4',
    'income_5','income_6','income_7','income_8','income_9',
  ]);

  // Money fields — GViz cell.f may give "$136.25 M"; prefer that over raw cell.v
  const MONEY_FIELDS = new Set([
    'filedRaise','currentRaise','equityRemaining','minInvest','sponsorAum',
    'purchasePrice','appraisedValue','loadedPrice',
  ]);

  function normalizePct(val) {
    if (val == null || !isFinite(val)) return val;
    // If |val| <= 1 and not zero, it's a decimal → multiply by 100
    return (Math.abs(val) <= 1 && val !== 0) ? val * 100 : val;
  }

  function parseMoneyStr(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.replace(/[$,\s]/g, '').toUpperCase();
    const num = parseFloat(s);
    if (isNaN(num)) return null;
    if (s.endsWith('B')) return num * 1e9;
    if (s.endsWith('M')) return num * 1e6;
    if (s.endsWith('K')) return num * 1e3;
    return num;
  }

  // ─────────────────────────────────────────────────────────────
  //  GOOGLE SHEETS PARSER
  // ─────────────────────────────────────────────────────────────

  /**
   * Parse the gviz JSON response into clean fund objects.
   * Handles both numeric and string cell types.
   */
  function parseSheetResponse(rawText) {
    // Strip the JSONP wrapper: google.visualization.Query.setResponse({...});
    const jsonStr = rawText.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
    const json = JSON.parse(jsonStr);

    const cols = json.table.cols.map(c => (c.label || '').trim());
    const rows = json.table.rows || [];

    return rows
      .map((row, rowIdx) => {
        // Skip completely empty rows
        if (!row.c || row.c.every(cell => !cell || cell.v === null)) return null;

        const fund = { id: rowIdx + 1, income: [] };

        cols.forEach((colLabel, ci) => {
          const cell  = row.c[ci];
          const field = COL_MAP[colLabel];
          if (!field) return; // unmapped column — skip

          let val = null;
          if (cell) {
            // Prefer formatted string for dates, raw value for numbers/strings
            val = cell.v !== undefined && cell.v !== null ? cell.v : null;
            if (val === null && cell.f) val = cell.f;
          }

          // Coerce numerics
          if (NUM_FIELDS.has(field) && val !== null && val !== '') {
            // For money fields, prefer formatted string (e.g. "$136.25 M") to preserve scale
            if (MONEY_FIELDS.has(field) && cell && cell.f && typeof cell.f === 'string') {
              const m = parseMoneyStr(cell.f);
              if (m !== null) { val = m; }
              else {
                const n = parseFloat(String(val).replace(/[,$%\s]/g, ''));
                val = isFinite(n) ? n : null;
              }
            } else {
              const n = parseFloat(String(val).replace(/[,$%\s]/g, ''));
              val = isFinite(n) ? n : null;
            }
          }

          // Normalize percentage fields: 0.0525 → 5.25
          if (PCT_FIELDS.has(field) && val !== null) {
            val = normalizePct(val);
          }

          // Income array fields
          if (field.startsWith('income_')) {
            const idx = parseInt(field.split('_')[1]);
            fund.income[idx] = val;
          } else {
            fund[field] = val;
          }
        });

        // Derived fields
        fund.status       = deriveStatus(fund);
        fund.pctRemaining = derivePctRemaining(fund);
        fund.raiseVelocity= deriveRaiseVelocity(fund);
        fund.propType     = fund.sector;  // alias
        fund.displayLabel = fund.name
          ? (fund.name.length > 40 ? fund.name.slice(0,38)+'…' : fund.name)
          : 'Offering #' + fund.id;

        return fund;
      })
      .filter(Boolean); // remove null (empty) rows
  }

  // ── Derived field calculators ──────────────────────────────

  function deriveStatus(fund) {
    if (!fund.offeringClose) return 'Open';
    // gviz date comes as a Date object or "Date(year,month,day)" string
    const close = parseGvizDate(fund.offeringClose);
    if (!close) return 'Open';
    const now = new Date();
    const msLeft = close - now;
    if (msLeft < 0)                    return 'Closed';
    if (msLeft < 30 * 24*60*60*1000)  return 'Closing Soon';
    return 'Open';
  }

  function derivePctRemaining(fund) {
    if (!fund.filedRaise || !fund.equityRemaining) return null;
    const pct = (fund.equityRemaining / fund.filedRaise) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  function deriveRaiseVelocity(fund) {
    if (!fund.currentRaise || !fund.offeringOpen) return null;
    const open = parseGvizDate(fund.offeringOpen);
    if (!open) return null;
    const months = (new Date() - open) / (1000*60*60*24*30.44);
    if (months < 0.1) return null;
    return fund.currentRaise / months; // $/month
  }

  /**
   * gviz returns dates as JS Date objects in the v field,
   * or sometimes as "Date(2025,0,15)" strings.
   */
  function parseGvizDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      // "Date(2025,0,15)" → month is 0-indexed
      const m = val.match(/Date\((\d+),(\d+),(\d+)\)/);
      if (m) return new Date(+m[1], +m[2], +m[3]);
      const d = new Date(val);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  //  loadFunds()  — public API
  // ─────────────────────────────────────────────────────────────

  let _loadPromise = null; // deduplicate concurrent calls

  async function loadFunds(forceRefresh = false) {
    // Return cached in-memory funds if available
    if (!forceRefresh && state.funds && state.funds.length > 0) {
      return state.funds;
    }
    // Check session storage cache (survives module re-injections)
    if (!forceRefresh) {
      const cached = ssGet(LS_KEYS.funds);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        state.funds = cached;
        return state.funds;
      }
    }
    // Deduplicate in-flight requests
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      try {
        const res = await fetch(SHEETS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const funds = parseSheetResponse(text);
        state.funds = funds;
        ssSet(LS_KEYS.funds, funds); // cache for session
        return funds;
      } finally {
        _loadPromise = null;
      }
    })();

    return _loadPromise;
  }

  // ─────────────────────────────────────────────────────────────
  //  BASKET  API
  // ─────────────────────────────────────────────────────────────
  const basket = {
    /** Current basket as array of IDs */
    _ids() { return Array.isArray(state.basket) ? state.basket : []; },

    has(id) { return this._ids().includes(Number(id)); },

    add(id) {
      id = Number(id);
      const ids = this._ids();
      if (ids.includes(id)) return false;
      if (ids.length >= BASKET_MAX) return false; // full
      state.basket = [...ids, id];
      return true;
    },

    remove(id) {
      id = Number(id);
      state.basket = this._ids().filter(x => x !== id);
    },

    /** Return full fund objects for ids in basket */
    get() {
      const ids = this._ids();
      return ids.map(id => state.funds.find(f => f.id === id)).filter(Boolean);
    },

    /** Persist to localStorage (already auto-persisted via state proxy, but exposed for explicitness) */
    save() { lsSet(LS_KEYS.basket, this._ids()); },

    clear() { state.basket = []; },

    count() { return this._ids().length; },
  };

  // ─────────────────────────────────────────────────────────────
  //  SUITABILITY SCORING  — SINGLE SOURCE OF TRUTH
  //
  //  Weighted earned/possible scoring (0–100):
  //    Structure match    30 pts
  //    Min investment     25 pts
  //    Y1 CoC vs peer    20 pts
  //    Occupancy          15 pts
  //    Hold period / age  10 pts
  //
  //  Gate: client.name must be set (not exchangeAmount).
  //  Missing data → neutral partial credit, never a penalty.
  //
  //  Handles BOTH field-name conventions:
  //    shared.js funds: y1coc, minInvest, occupancy, offeringStructure, upReit
  //    shell funds:     y1CoC, minimum,   pctLeased, structure,         hasUPREIT
  //
  //  Shell passes structure prefs via client._shell.structurePreference
  // ─────────────────────────────────────────────────────────────

  /**
   * @param {Object} fund   — fund object (shared.js OR shell field names)
   * @param {Object} client — { name, exchangeAmount, age, _shell?: { structurePreference } }
   * @param {Object} [peer] — { avgY1CoC } peer averages (optional)
   * @returns {number|null}  0–100 integer, or null if no client name
   */
  function suitScore(fund, client, peer) {
    // Gate: must have a client name
    if (!client || !client.name) return null;

    let score = 0;

    // ── Resolve field names (shared.js vs shell) ──
    const y1coc     = fund.y1coc     ?? fund.y1CoC     ?? null;
    const ltv       = fund.ltv       ?? null;
    const minInv    = fund.minInvest ?? fund.minimum    ?? null;
    const occ       = fund.occupancy ?? fund.pctLeased  ?? null;
    const hold      = fund.holdPeriod ?? null;
    const structure = fund.offeringStructure ?? fund.structure ?? '';
    const hasUpreit = !!(fund.upReit ?? fund.hasUPREIT);

    // Structure prefs come from _shell passthrough or direct fields
    const sp      = (client._shell && client._shell.structurePreference) || {};
    const dstOnly = sp.dstOnly || false;
    const noDebt  = sp.noDebt  || false;
    const upreit  = sp.upreit  || false;

    // ── 1. Structure match (30 pts) ──
    let structScore = 1;
    if (dstOnly && structure && !structure.toLowerCase().includes('dst')) {
      structScore = 0;
    }
    if (noDebt && ltv != null && ltv > 0) {
      structScore = Math.min(structScore, 0.3);
    }
    if (upreit && !hasUpreit) {
      structScore = Math.min(structScore, 0.5);
    }
    score += structScore * 30;

    // ── 2. Min investment vs exchange equity (25 pts) ──
    if (client.exchangeAmount != null && minInv != null) {
      if (minInv <= client.exchangeAmount) score += 25;
      else if (minInv <= client.exchangeAmount * 1.1) score += 12;
      // else 0
    } else {
      score += 15; // neutral when data missing
    }

    // ── 3. Y1 CoC vs peer average (20 pts) ──
    const peerCoC = (peer && peer.avgY1CoC != null) ? peer.avgY1CoC : null;
    if (y1coc != null && peerCoC != null) {
      if (y1coc >= peerCoC * 1.1) score += 20;
      else if (y1coc >= peerCoC)  score += 14;
      else if (y1coc >= peerCoC * 0.9) score += 8;
      // else 0
    } else {
      score += 10; // neutral
    }

    // ── 4. Occupancy (15 pts) ──
    if (occ != null) {
      if (occ >= 95) score += 15;
      else if (occ >= 90) score += 10;
      else if (occ >= 80) score += 5;
      // else 0
    } else {
      score += 8; // neutral
    }

    // ── 5. Hold period vs age (10 pts) ──
    if (client.age != null && hold != null) {
      const hp  = parseFloat(hold);
      const age = parseFloat(client.age);
      if (!isNaN(hp) && !isNaN(age)) {
        if (age + hp <= 80) score += 10;
        else if (age + hp <= 85) score += 6;
        else score += 2;
      } else {
        score += 6; // neutral
      }
    } else {
      score += 6; // neutral
    }

    return Math.round(Math.min(100, Math.max(0, score)));
  }

  // ─────────────────────────────────────────────────────────────
  //  PEER STATS
  // ─────────────────────────────────────────────────────────────

  /**
   * Returns averages / min / max across all (or provided) funds.
   * Useful for rendering peer comparison bars.
   */
  function peerStats(funds) {
    const arr = funds || state.funds || [];
    if (!arr.length) return {};

    function avg(field) {
      const vals = arr.map(f => f[field]).filter(v => v != null && isFinite(v));
      if (!vals.length) return null;
      return vals.reduce((a,b)=>a+b,0) / vals.length;
    }
    function mn(field) {
      const vals = arr.map(f => f[field]).filter(v => v != null && isFinite(v));
      return vals.length ? Math.min(...vals) : null;
    }
    function mx(field) {
      const vals = arr.map(f => f[field]).filter(v => v != null && isFinite(v));
      return vals.length ? Math.max(...vals) : null;
    }

    return {
      y1coc    : { avg: avg('y1coc'),     min: mn('y1coc'),     max: mx('y1coc')     },
      ltv      : { avg: avg('ltv'),       min: mn('ltv'),       max: mx('ltv')       },
      occupancy: { avg: avg('occupancy'), min: mn('occupancy'), max: mx('occupancy') },
      minInvest: { avg: avg('minInvest'), min: mn('minInvest'), max: mx('minInvest') },
      holdPeriod:{ avg: avg('holdPeriod'),min: mn('holdPeriod'),max: mx('holdPeriod')},
      capRate  : { avg: avg('capRate'),   min: mn('capRate'),   max: mx('capRate')   },
      count    : arr.length,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  NAVIGATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Navigate to a module. The shell listens for the 'afl:navigate' event.
   * Params are passed as event detail and also stored in sessionStorage
   * so the module can read them on init.
   *
   * Usage: AFL.navigate('offering', { ids: [1,2,3] })
   */
  function navigate(module, params = {}) {
    state.nav = module;
    // Store params for the module to read on init
    try {
      sessionStorage.setItem('afl_nav_params', JSON.stringify({ module, params }));
    } catch(e) {}

    // Dispatch event for the shell router
    const evt = new CustomEvent('afl:navigate', { detail: { module, params } });
    window.dispatchEvent(evt);
  }

  // ─────────────────────────────────────────────────────────────
  //  HEADER UPDATE
  // ─────────────────────────────────────────────────────────────

  /**
   * Tell the shell to refresh its header UI (basket count, client name, etc).
   * Shell listens for 'afl:header-update'.
   */
  function updateHeader(data = {}) {
    const payload = {
      basketCount : basket.count(),
      clientName  : state.client ? state.client.name || '' : '',
      viewMode    : state.viewMode,
      fundCount   : state.funds.length,
      ...data,
    };
    const evt = new CustomEvent('afl:header-update', { detail: payload });
    window.dispatchEvent(evt);
  }

  // ─────────────────────────────────────────────────────────────
  //  FORMATTING UTILITIES
  // ─────────────────────────────────────────────────────────────

  const fmt = {
    /**
     * Format a percentage. Returns "—" for null/NaN.
     * @param {number} v  — e.g. 5.25 → "5.25%"
     * @param {number} d  — decimal places (default 2)
     */
    pct(v, d = 2) {
      if (v == null || !isFinite(Number(v))) return '—';
      return Number(v).toFixed(d) + '%';
    },

    /**
     * Format money. Abbreviates large numbers.
     * 2400000 → "$2.4M"  |  380000 → "$380K"  |  500 → "$500"
     */
    money(v) {
      if (v == null || !isFinite(Number(v))) return '—';
      const n = Number(v);
      if (n >= 1e9) return '$' + (n/1e9).toFixed(2).replace(/\.?0+$/,'') + 'B';
      if (n >= 1e6) return '$' + (n/1e6).toFixed(2).replace(/\.?0+$/,'') + 'M';
      if (n >= 1e3) return '$' + (n/1e3).toFixed(1).replace(/\.?0+$/,'') + 'K';
      return '$' + n.toFixed(0);
    },

    /**
     * Format a date value (Date object, gviz Date string, or ISO string).
     */
    date(s) {
      if (!s) return '—';
      let d;
      if (s instanceof Date) { d = s; }
      else {
        const m = String(s).match(/Date\((\d+),(\d+),(\d+)\)/);
        d = m ? new Date(+m[1], +m[2], +m[3]) : new Date(s);
      }
      if (isNaN(d)) return String(s);
      return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    },

    /**
     * Format a number with commas.
     */
    num(v, decimals = 0) {
      if (v == null || !isFinite(Number(v))) return '—';
      return Number(v).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    },
  };

  // ─────────────────────────────────────────────────────────────
  //  UTILITY FUNCTIONS
  // ─────────────────────────────────────────────────────────────

  /** True if v is a finite number (not null, not NaN, not ±Infinity) */
  function isNum(v) {
    return v !== null && v !== undefined && isFinite(Number(v));
  }

  /** XSS-safe HTML escaping */
  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Parse a location string like "TX, OH, IN, GA" into ['TX','OH','IN','GA'].
   * Also handles multi-word state names if they appear.
   */
  function extractStates(locationStr) {
    if (!locationStr) return [];
    // Split on commas and/or spaces, filter for 2-letter state codes
    return locationStr
      .split(/[\s,]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z]{2}$/.test(s));
  }

  /**
   * Get current nav params (set by navigate()).
   */
  function getNavParams() {
    try {
      const raw = sessionStorage.getItem('afl_nav_params');
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  /**
   * Get a fund by ID from state.funds.
   */
  function getFund(id) {
    return state.funds.find(f => f.id === Number(id)) || null;
  }

  /**
   * Get all funds for a given sponsor name.
   */
  function getSponsorFunds(sponsorName) {
    return state.funds.filter(f =>
      (f.sponsor || '').toLowerCase() === (sponsorName || '').toLowerCase()
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  CLIENT HELPERS
  // ─────────────────────────────────────────────────────────────

  const client = {
    get()     { return state.client; },
    set(data) {
      state.client = { ...state.client, ...data };
      updateHeader();
    },
    clear() {
      state.client = {
        name:'', exchangeAmount:null, riskTolerance:'',
        propTypes:[], horizon:null, age:null, accredited:true, notes:''
      };
      updateHeader();
    },
    isSet() {
      const c = state.client;
      return !!(c && c.name);
    },
  };

  // ─────────────────────────────────────────────────────────────
  //  VIEW MODE HELPER
  // ─────────────────────────────────────────────────────────────

  const view = {
    get()  { return state.viewMode; },
    set(m) { state.viewMode = m; updateHeader(); },
    is(m)  { return state.viewMode === m; },
  };

  // ─────────────────────────────────────────────────────────────
  //  AFL NAMESPACE — PUBLIC API
  // ─────────────────────────────────────────────────────────────

  const AFL = {
    // Core state
    state,

    // Data
    loadFunds,
    getFund,
    getSponsorFunds,
    getNavParams,

    // Basket
    basket,

    // Client
    client,

    // View mode
    view,

    // Scoring
    suitScore,
    peerStats,

    // Navigation
    navigate,
    updateHeader,

    // Formatting
    fmt,

    // Utils
    isNum,
    escapeHTML,
    extractStates,

    // Expose parseGvizDate for modules that handle raw dates
    parseGvizDate,

    // Version
    version: '1.1.1',
  };

  // Expose globally
  global.AFL = AFL;

  // Auto-signal header update when basket changes
  // (useful after direct localStorage manipulation)
  window.addEventListener('storage', e => {
    if (e.key === LS_KEYS.basket) {
      try { state.basket = JSON.parse(e.newValue || '[]'); } catch(err) {}
      updateHeader();
    }
    if (e.key === LS_KEYS.client) {
      try { state.client = JSON.parse(e.newValue || 'null') || state.client; } catch(err) {}
      updateHeader();
    }
  });

  console.log(`[AFL] shared.js v${AFL.version} loaded — unified suitScore() — pct normalization`);

})(window);
