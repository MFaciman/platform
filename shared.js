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
 *   AFL.suitScore()      — per-fund suitability score (0–100) + reason string
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
    basket  : 'afl_basket',
    client  : 'afl_client',
    nav     : 'afl_nav',
    funds   : 'afl_funds',       // session cache (sessionStorage)
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
    funds    : [],
    basket   : lsGet(LS_KEYS.basket, []),
    client   : lsGet(LS_KEYS.client, {
      name             : '',
      exchangeAmount   : null,
      riskTolerance    : '',
      investmentObjective: '',
      accreditedStatus : '',
      taxBracket       : 0,
      holdPeriod       : '',
      propTypes        : [],
      propTypePrefs    : [],
      liquidNetWorth   : 0,
      totalNetWorth    : 0,
      annualIncome     : 0,
      suitabilityScore : 0,
      notes            : '',
      // legacy fields kept for backward compat
      propTypes        : [],
      horizon          : null,
      age              : null,
      accredited       : true,
    }),
    nav      : lsGet(LS_KEYS.nav, 'browse'),
    viewMode : lsGet(LS_KEYS.viewMode, 'advisor'),
  };

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
    'Year 1 Cash on Cash Distribution': 'y1coc',
    'Year 1 Cash on Cash'             : 'y1coc',
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
    '(Avg)% Leased'                   : 'occupancy',
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
    'Year 1'  : 'income_0',
    'Year 2'  : 'income_1',
    'Year 3'  : 'income_2',
    'ear 3'   : 'income_2',   // confirmed typo in sheet
    'Year 4'  : 'income_3',
    'Year 5'  : 'income_4',
    'Year 6'  : 'income_5',
    'Year 7'  : 'income_6',
    'Year 8'  : 'income_7',
    'Year 9'  : 'income_8',
    'Year 10' : 'income_9',
    'Sponsor AUM'                     : 'sponsorAum',
    'Number of Sponsor Offerings'     : 'sponsorOfferings',
    'Sponsor Full Cycle Exits'        : 'sponsorExits',
    'Sponsor Average IRR'             : 'sponsorAvgIrr',
    'Sponsor Best IRR'                : 'sponsorBestIrr',
    'Sponsor Worst IRR'               : 'sponsorWorstIrr',
    'Sponsor Experience'              : 'sponsorExperience',
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

  const NUM_FIELDS = new Set([
    'filedRaise','currentRaise','equityRemaining','y1coc','ltv','preferred',
    'holdPeriod','minInvest','numAssets','occupancy','dscr','sqft','avgLeaseTerm',
    'purchasePrice','appraisedValue','loadedPrice','capRate','repComp','salesLoad',
    'sponsorOfferings','sponsorExits','sponsorAvgIrr','sponsorBestIrr','sponsorWorstIrr',
    'income_0','income_1','income_2','income_3','income_4',
    'income_5','income_6','income_7','income_8','income_9',
  ]);

  // ─────────────────────────────────────────────────────────────
  //  GOOGLE SHEETS PARSER
  // ─────────────────────────────────────────────────────────────
  function parseSheetResponse(rawText) {
    const jsonStr = rawText.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
    const json = JSON.parse(jsonStr);
    const cols = json.table.cols.map(c => (c.label || '').trim());
    const rows = json.table.rows || [];

    return rows
      .map((row, rowIdx) => {
        if (!row.c || row.c.every(cell => !cell || cell.v === null)) return null;
        const fund = { id: rowIdx + 1, income: [] };

        cols.forEach((colLabel, ci) => {
          const cell  = row.c[ci];
          const field = COL_MAP[colLabel];
          if (!field) return;

          let val = null;
          if (cell) {
            val = cell.v !== undefined && cell.v !== null ? cell.v : null;
            if (val === null && cell.f) val = cell.f;
          }

          if (NUM_FIELDS.has(field) && val !== null && val !== '') {
            const n = parseFloat(String(val).replace(/[,$%\s]/g, ''));
            val = isFinite(n) ? n : null;
          }

          if (field.startsWith('income_')) {
            const idx = parseInt(field.split('_')[1]);
            fund.income[idx] = val;
          } else {
            fund[field] = val;
          }
        });

        fund.status        = deriveStatus(fund);
        fund.pctRemaining  = derivePctRemaining(fund);
        fund.raiseVelocity = deriveRaiseVelocity(fund);
        fund.propType      = fund.sector;
        fund.displayLabel  = fund.name
          ? (fund.name.length > 40 ? fund.name.slice(0,38)+'…' : fund.name)
          : 'Offering #' + fund.id;

        return fund;
      })
      .filter(Boolean);
  }

  function deriveStatus(fund) {
    if (!fund.offeringClose) return 'Open';
    const close = parseGvizDate(fund.offeringClose);
    if (!close) return 'Open';
    const now = new Date();
    const msLeft = close - now;
    if (msLeft < 0)                   return 'Closed';
    if (msLeft < 30 * 24*60*60*1000) return 'Closing Soon';
    return 'Open';
  }

  function derivePctRemaining(fund) {
    if (!fund.filedRaise || !fund.equityRemaining) return null;
    return Math.min(100, Math.max(0, (fund.equityRemaining / fund.filedRaise) * 100));
  }

  function deriveRaiseVelocity(fund) {
    if (!fund.currentRaise || !fund.offeringOpen) return null;
    const open = parseGvizDate(fund.offeringOpen);
    if (!open) return null;
    const months = (new Date() - open) / (1000*60*60*24*30.44);
    if (months < 0.1) return null;
    return fund.currentRaise / months;
  }

  function parseGvizDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      const m = val.match(/Date\((\d+),(\d+),(\d+)\)/);
      if (m) return new Date(+m[1], +m[2], +m[3]);
      const d = new Date(val);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  //  loadFunds()
  // ─────────────────────────────────────────────────────────────
  let _loadPromise = null;

  async function loadFunds(forceRefresh = false) {
    if (!forceRefresh && state.funds && state.funds.length > 0) return state.funds;
    if (!forceRefresh) {
      const cached = ssGet(LS_KEYS.funds);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        state.funds = cached;
        return state.funds;
      }
    }
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      try {
        const res = await fetch(SHEETS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const funds = parseSheetResponse(text);
        state.funds = funds;
        ssSet(LS_KEYS.funds, funds);
        return funds;
      } finally {
        _loadPromise = null;
      }
    })();

    return _loadPromise;
  }

  // ─────────────────────────────────────────────────────────────
  //  BASKET API
  // ─────────────────────────────────────────────────────────────
  const basket = {
    _ids() { return Array.isArray(state.basket) ? state.basket : []; },
    has(id) { return this._ids().includes(Number(id)); },
    add(id) {
      id = Number(id);
      const ids = this._ids();
      if (ids.includes(id)) return false;
      if (ids.length >= BASKET_MAX) return false;
      state.basket = [...ids, id];
      return true;
    },
    remove(id) {
      id = Number(id);
      state.basket = this._ids().filter(x => x !== id);
    },
    get() {
      const ids = this._ids();
      return ids.map(id => state.funds.find(f => f.id === id)).filter(Boolean);
    },
    save()  { lsSet(LS_KEYS.basket, this._ids()); },
    clear() { state.basket = []; },
    count() { return this._ids().length; },
  };

  // ─────────────────────────────────────────────────────────────
  //  SUITABILITY SCORING  — per-fund match (0–100) + reason
  //
  //  Returns: { score: Number, reasons: String[], flags: String[] }
  //  or null if no usable client loaded.
  //
  //  COMPONENT WEIGHTS (sum to 100):
  //    Risk alignment       — 25 pts
  //    Objective match      — 25 pts
  //    Financial / size fit — 25 pts
  //    Hold period match    — 15 pts
  //    Property preference  — 10 pts
  //
  //  Each component is scored 0→full weight, not binary.
  //  Reasons array returns 1–3 short positive/negative strings
  //  shown as tooltip in browse cards.
  // ─────────────────────────────────────────────────────────────

  /**
   * Normalize client data — handles both old and new schema from client.html
   */
  function normalizeClient(c) {
    if (!c) return null;
    return {
      name             : c.name || '',
      exchangeAmount   : c.exchangeAmount || null,
      riskTolerance    : c.riskTolerance || c.risk || '',
      objective        : c.investmentObjective || c.objective || '',
      accreditedStatus : c.accreditedStatus || (c.accredited ? 'accredited' : ''),
      taxBracket       : Number(c.taxBracket) || 0,
      holdPeriod       : c.holdPeriod || c.horizon || null,
      propTypePrefs    : c.propTypePrefs || c.propTypes || [],
      liquidNetWorth   : Number(c.liquidNetWorth) || 0,
      totalNetWorth    : Number(c.totalNetWorth) || 0,
      annualIncome     : Number(c.annualIncome) || 0,
      suitabilityScore : Number(c.suitabilityScore) || 0,
    };
  }

  /**
   * Core per-fund suitability scorer.
   *
   * @param {Object} fund    — parsed fund object from loadFunds()
   * @param {Object} rawClient — AFL.state.client (old or new schema)
   * @returns {{ score: number, reasons: string[], flags: string[] } | null}
   */
  function suitScore(fund, rawClient) {
    const c = normalizeClient(rawClient);
    // Need at minimum one meaningful signal
    if (!c || (!c.exchangeAmount && !c.riskTolerance && !c.objective)) return null;

    let score = 0;
    const reasons = [];   // positive match reasons (shown green on tooltip)
    const flags   = [];   // caution notes (shown amber)

    // ── 1. RISK ALIGNMENT (25 pts) ───────────────────────────
    //
    // Conservative client → best fit: low LTV (<50), NNN, net lease
    // Moderate client     → fits most DSTs
    // Aggressive client   → needs value-add / higher CoC
    //
    let riskPts = 0;
    const ltv = fund.ltv;
    const risk = c.riskTolerance.toLowerCase();

    if (risk === 'conservative') {
      if (ltv != null) {
        if (ltv <= 45)       { riskPts = 25; reasons.push('Low LTV · conservative fit'); }
        else if (ltv <= 55)  { riskPts = 20; }
        else if (ltv <= 65)  { riskPts = 12; }
        else                 { riskPts = 4;  flags.push('LTV may be high for conservative profile'); }
      } else { riskPts = 14; } // no LTV data — neutral

      // NNN / net lease is the conservative archetype
      const sector = (fund.sector || '').toLowerCase();
      if (sector.includes('net') || sector.includes('nnn') || sector.includes('triple')) {
        riskPts = Math.min(25, riskPts + 5);
        if (!reasons.some(r => r.includes('LTV'))) reasons.push('NNN structure matches conservative risk');
      }

    } else if (risk === 'moderate') {
      // Moderate fits almost everything — penalize only extreme LTV
      if (ltv != null) {
        if (ltv <= 65)   { riskPts = 25; reasons.push('LTV aligned with moderate risk'); }
        else if (ltv <= 75) { riskPts = 18; }
        else             { riskPts = 10; flags.push('Higher LTV than typical for moderate profile'); }
      } else { riskPts = 20; }

    } else if (risk === 'aggressive') {
      // Aggressive wants higher CoC / returns — penalize low-yield conservative structures
      const coc = fund.y1coc;
      if (coc != null) {
        if (coc >= 6.0)      { riskPts = 25; reasons.push('High CoC matches growth-oriented profile'); }
        else if (coc >= 5.0) { riskPts = 18; }
        else if (coc >= 4.0) { riskPts = 12; }
        else                 { riskPts = 6;  flags.push('Lower yield than aggressive profile typically seeks'); }
      } else { riskPts = 14; }

    } else {
      // No risk tolerance set — give partial neutral credit
      riskPts = 15;
    }

    score += Math.min(25, Math.max(0, riskPts));

    // ── 2. OBJECTIVE MATCH (25 pts) ──────────────────────────
    //
    // income → high CoC, regular distributions
    // preservation → low LTV, low risk, stable occupancy
    // growth → higher CoC, value-add, appreciation potential
    //
    let objPts = 0;
    const obj = c.objective.toLowerCase();
    const coc = fund.y1coc;
    const occ = fund.occupancy;

    if (obj === 'income') {
      if (coc != null) {
        if (coc >= 5.5)      { objPts = 25; reasons.push('Strong Y1 CoC for income objective'); }
        else if (coc >= 4.5) { objPts = 20; }
        else if (coc >= 3.5) { objPts = 12; flags.push('CoC below typical income target'); }
        else                 { objPts = 5;  flags.push('Low CoC — limited income match'); }
      } else { objPts = 14; }

      // High occupancy is a proxy for reliable distributions
      if (occ != null && occ >= 95) { objPts = Math.min(25, objPts + 3); }

    } else if (obj === 'preservation') {
      // Preservation: penalize high LTV, reward stability signals
      if (ltv != null) {
        if (ltv <= 45)       { objPts = 25; }
        else if (ltv <= 55)  { objPts = 20; }
        else if (ltv <= 65)  { objPts = 13; }
        else                 { objPts = 5;  flags.push('LTV too high for capital preservation goal'); }
      } else { objPts = 15; }

      if (occ != null && occ >= 92) {
        objPts = Math.min(25, objPts + 4);
        reasons.push('High occupancy · preservation-focused');
      }

    } else if (obj === 'growth') {
      // Growth: higher CoC is a proxy for returns; value-add sectors score well
      if (coc != null) {
        if (coc >= 5.0)      { objPts = 22; }
        else if (coc >= 4.0) { objPts = 16; }
        else                 { objPts = 8; }
      } else { objPts = 14; }

      // Value-add / growth sectors
      const sector = (fund.sector || '').toLowerCase();
      if (sector.includes('multifamily') || sector.includes('industrial') || sector.includes('storage')) {
        objPts = Math.min(25, objPts + 5);
        reasons.push('Sector aligned with growth objective');
      }

    } else {
      // No objective set
      objPts = 15;
    }

    score += Math.min(25, Math.max(0, objPts));

    // ── 3. FINANCIAL / SIZE FIT (25 pts) ─────────────────────
    //
    // Min investment vs exchange amount is the hardest gate.
    // Also reward when the exchange amount is a healthy multiple
    // of minInvest (allows diversification across 2–3 DSTs).
    //
    let finPts = 0;
    const minInvest    = fund.minInvest;
    const exchangeAmt  = c.exchangeAmount;

    if (minInvest != null && exchangeAmt != null && exchangeAmt > 0) {
      const ratio = exchangeAmt / minInvest;
      if (ratio < 1) {
        // Can't meet minimum — hard flag
        finPts = 0;
        flags.push('Exchange amount below fund minimum');
      } else if (ratio >= 3) {
        // Can diversify across 3 DSTs comfortably
        finPts = 25;
        reasons.push('Exchange amount supports full diversification');
      } else if (ratio >= 2) {
        // Can do 2 DSTs
        finPts = 20;
      } else {
        // Meets minimum but tight
        finPts = 13;
      }
    } else if (exchangeAmt != null && exchangeAmt > 0) {
      // No minInvest data — give neutral credit if exchange amount is substantial
      finPts = exchangeAmt >= 500000 ? 18 : 12;
    } else if (minInvest != null) {
      // No exchange amount — partial credit
      finPts = 14;
    } else {
      finPts = 14;
    }

    // Tax bracket bonus: higher bracket = more depreciation benefit
    const taxBracket = c.taxBracket;
    if (taxBracket >= 37)      finPts = Math.min(25, finPts + 3);
    else if (taxBracket >= 32) finPts = Math.min(25, finPts + 2);
    else if (taxBracket >= 24) finPts = Math.min(25, finPts + 1);

    score += Math.min(25, Math.max(0, finPts));

    // ── 4. HOLD PERIOD MATCH (15 pts) ────────────────────────
    //
    // Fund holdPeriod is in years. Client holdPeriod is '5','7','10','flexible'.
    // Match within 1 year = perfect; 2 years = partial; beyond = penalize.
    //
    let holdPts = 0;
    const fundHold   = fund.holdPeriod;    // number (years)
    const clientHold = String(c.holdPeriod || '').toLowerCase();

    if (clientHold === 'flexible' || clientHold === '') {
      holdPts = 12; // flexible is a good fit for almost everything
    } else if (fundHold != null) {
      const clientHoldYrs = parseInt(clientHold);
      if (!isNaN(clientHoldYrs)) {
        const diff = Math.abs(fundHold - clientHoldYrs);
        if (diff === 0)      { holdPts = 15; reasons.push('Hold period aligned'); }
        else if (diff <= 1)  { holdPts = 12; }
        else if (diff <= 2)  { holdPts = 8;  }
        else if (diff <= 3)  { holdPts = 4;  flags.push('Hold period mismatch'); }
        else                 { holdPts = 0;  flags.push('Hold period mismatch — ' + fundHold + 'yr fund'); }
      } else { holdPts = 10; }
    } else {
      holdPts = 10; // no fund hold data — neutral
    }

    score += Math.min(15, Math.max(0, holdPts));

    // ── 5. PROPERTY TYPE PREFERENCE (10 pts) ─────────────────
    //
    // Client's propTypePrefs is an array of strings like ['multifamily','industrial']
    // Fund's sector/assetClass is a single string.
    //
    let propPts = 0;
    const prefs = c.propTypePrefs;
    const fundSector = (fund.sector || fund.assetClass || '').toLowerCase().replace(/[-\s]+/g, '');

    if (!Array.isArray(prefs) || prefs.length === 0 || prefs.includes('no-preference')) {
      propPts = 8; // no preference → neutral good
    } else {
      const matched = prefs.some(p => {
        const normalized = p.toLowerCase().replace(/[-\s]+/g, '');
        return fundSector.includes(normalized) || normalized.includes(fundSector);
      });
      if (matched) {
        propPts = 10;
        reasons.push('Property type matches preference');
      } else {
        propPts = 2;
        // Not a hard flag — advisor may still want to show it
      }
    }

    score += Math.min(10, Math.max(0, propPts));

    // ── ACCREDITATION GATE ────────────────────────────────────
    // Reg D 506(b) is accredited only; 506(c) as well.
    // Qualified purchaser unlocks certain fund structures.
    // This is pass/fail, not a score component — but we flag it.
    const accStatus = c.accreditedStatus.toLowerCase();
    if (accStatus === '' && c.suitabilityScore === 0) {
      // No profile at all — don't flag
    } else if (accStatus !== 'accredited' && accStatus !== 'qualified-purchaser') {
      flags.push('Verify accreditation status before presenting');
    }

    // ── FINAL SCORE ───────────────────────────────────────────
    const finalScore = Math.min(100, Math.max(0, Math.round(score)));

    // Build a concise reason string for the chip tooltip
    // Priority: surface up to 2 positives + 1 flag
    const topReasons = [...reasons.slice(0,2), ...flags.slice(0,1)];

    return {
      score    : finalScore,
      reasons  : reasons,
      flags    : flags,
      tooltip  : topReasons.join(' · ') || (finalScore >= 70 ? 'Good overall fit' : 'Partial match'),
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  PEER STATS
  // ─────────────────────────────────────────────────────────────
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
  function navigate(module, params = {}) {
    state.nav = module;
    try {
      sessionStorage.setItem('afl_nav_params', JSON.stringify({ module, params }));
    } catch(e) {}
    const evt = new CustomEvent('afl:navigate', { detail: { module, params } });
    window.dispatchEvent(evt);
  }

  // ─────────────────────────────────────────────────────────────
  //  HEADER UPDATE
  // ─────────────────────────────────────────────────────────────
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
    pct(v, d = 2) {
      if (v == null || !isFinite(Number(v))) return '—';
      return Number(v).toFixed(d) + '%';
    },
    money(v) {
      if (v == null || !isFinite(Number(v))) return '—';
      const n = Number(v);
      if (n >= 1e9) return '$' + (n/1e9).toFixed(2).replace(/\.?0+$/,'') + 'B';
      if (n >= 1e6) return '$' + (n/1e6).toFixed(2).replace(/\.?0+$/,'') + 'M';
      if (n >= 1e3) return '$' + (n/1e3).toFixed(1).replace(/\.?0+$/,'') + 'K';
      return '$' + n.toFixed(0);
    },
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
  function isNum(v) {
    return v !== null && v !== undefined && isFinite(Number(v));
  }

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
    return locationStr
      .split(/[\s,]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z]{2}$/.test(s));
  }

  function getNavParams() {
    try {
      const raw = sessionStorage.getItem('afl_nav_params');
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function getFund(id) {
    return state.funds.find(f => f.id === Number(id)) || null;
  }

  function getSponsorFunds(sponsorName) {
    return state.funds.filter(f =>
      (f.sponsor || '').toLowerCase() === (sponsorName || '').toLowerCase()
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  CLIENT HELPERS
  // ─────────────────────────────────────────────────────────────
  const clientHelper = {
    get()     { return state.client; },
    set(data) {
      state.client = { ...state.client, ...data };
      updateHeader();
    },
    clear() {
      state.client = {
        name:'', exchangeAmount:null, riskTolerance:'', investmentObjective:'',
        accreditedStatus:'', taxBracket:0, holdPeriod:'',
        propTypes:[], propTypePrefs:[], liquidNetWorth:0, totalNetWorth:0,
        annualIncome:0, suitabilityScore:0, notes:'',
        // legacy
        horizon:null, age:null, accredited:true,
      };
      updateHeader();
    },
    isSet() {
      const c = state.client;
      return !!(c && (c.name || c.exchangeAmount));
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
    state,
    loadFunds,
    getFund,
    getSponsorFunds,
    getNavParams,
    basket,
    client: clientHelper,
    view,
    suitScore,
    peerStats,
    navigate,
    updateHeader,
    fmt,
    isNum,
    escapeHTML,
    extractStates,
    parseGvizDate,
    normalizeClient,
    version: '1.1.0',
  };

  global.AFL = AFL;

  // Auto-sync when localStorage changes (cross-tab)
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

  console.log(`[AFL] shared.js v${AFL.version} loaded`);

})(window);
