/**
 * AFL Market Intelligence Widget
 * ─────────────────────────────────────────────
 * Drop-in integration for offering detail views.
 * 
 * USAGE (in any module like browse.html, detail view, etc.):
 * 
 *   // 1. Include this script:
 *   <script src="market-intel-widget.js"><\/script>
 *
 *   // 2. Add a container div where you want the widget:
 *   <div id="market-intel-panel"></div>
 *
 *   // 3. Call render with offering data:
 *   MarketIntelWidget.render('market-intel-panel', {
 *     city: 'Kansas City',
 *     state: 'MO',
 *     propertyType: 'multifamily',
 *     offeringName: 'ABC Multifamily DST',
 *     capRate: 5.5,       // optional - enables spread analysis
 *     y1coc: 5.25,        // optional
 *     ltv: 0.55           // optional
 *   });
 *
 *   // Or auto-detect from AFL offering data:
 *   MarketIntelWidget.renderFromOffering('market-intel-panel', offering);
 *
 * Version: 1.0
 * ─────────────────────────────────────────────
 */
(function() {
  'use strict';

  // ─── API CONFIG ───
  const FRED_KEY = 'a459ffc6c22102b32e427d783d9147ed';
  const CENSUS_KEY = '67b3786efc3a71bfe55ff3d9fba0c4db0c40aef7';
  const CACHE = {};
  const CACHE_TTL = 6 * 60 * 60 * 1000;

  function cacheGet(k) { const c = CACHE[k]; if (!c || Date.now()-c.ts > CACHE_TTL) return null; return c.data; }
  function cacheSet(k, d) { CACHE[k] = { data: d, ts: Date.now() }; }

  // ─── CBSA LOOKUP TABLE ───
  const CBSA_MAP = {
    "atlanta":       { code: "12060", name: "Atlanta",       st: "GA", fips: "13", fred_hpi: "ATNHPIUS12060Q", fred_unemp: "ATLA013URN" },
    "austin":        { code: "12420", name: "Austin",        st: "TX", fips: "48", fred_hpi: "ATNHPIUS12420Q", fred_unemp: "AUST448URN" },
    "baltimore":     { code: "12580", name: "Baltimore",     st: "MD", fips: "24", fred_hpi: "ATNHPIUS12580Q", fred_unemp: "BALT124URN" },
    "birmingham":    { code: "13820", name: "Birmingham",    st: "AL", fips: "01", fred_hpi: "ATNHPIUS13820Q", fred_unemp: "BIRM101URN" },
    "boston":         { code: "14460", name: "Boston",        st: "MA", fips: "25", fred_hpi: "ATNHPIUS14460Q", fred_unemp: "BOST625URN" },
    "charlotte":     { code: "16740", name: "Charlotte",     st: "NC", fips: "37", fred_hpi: "ATNHPIUS16740Q", fred_unemp: "CHAR737URN" },
    "chicago":       { code: "16980", name: "Chicago",       st: "IL", fips: "17", fred_hpi: "ATNHPIUS16980Q", fred_unemp: "CHIC917URN" },
    "cleveland":     { code: "17460", name: "Cleveland",     st: "OH", fips: "39", fred_hpi: "ATNHPIUS17460Q", fred_unemp: "CLEV339URN" },
    "columbus":      { code: "18140", name: "Columbus",      st: "OH", fips: "39", fred_hpi: "ATNHPIUS18140Q", fred_unemp: "COLU139URN" },
    "dallas":        { code: "19100", name: "Dallas",        st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "fort worth":    { code: "19100", name: "Dallas",        st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "dfw":           { code: "19100", name: "Dallas",        st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "denver":        { code: "19740", name: "Denver",        st: "CO", fips: "08", fred_hpi: "ATNHPIUS19740Q", fred_unemp: "DENV208URN" },
    "detroit":       { code: "19820", name: "Detroit",       st: "MI", fips: "26", fred_hpi: "ATNHPIUS19820Q", fred_unemp: "DETR026URN" },
    "houston":       { code: "26420", name: "Houston",       st: "TX", fips: "48", fred_hpi: "ATNHPIUS26420Q", fred_unemp: "HOUS448URN" },
    "indianapolis":  { code: "26900", name: "Indianapolis",  st: "IN", fips: "18", fred_hpi: "ATNHPIUS26900Q", fred_unemp: "INDI218URN" },
    "jacksonville":  { code: "27260", name: "Jacksonville",  st: "FL", fips: "12", fred_hpi: "ATNHPIUS27260Q", fred_unemp: "JACK112URN" },
    "kansas city":   { code: "28140", name: "Kansas City",   st: "MO", fips: "29", fred_hpi: "ATNHPIUS28140Q", fred_unemp: "KANS229URN" },
    "las vegas":     { code: "29820", name: "Las Vegas",     st: "NV", fips: "32", fred_hpi: "ATNHPIUS29820Q", fred_unemp: "LASV032URN" },
    "los angeles":   { code: "31080", name: "Los Angeles",   st: "CA", fips: "06", fred_hpi: "ATNHPIUS31080Q", fred_unemp: "LOSA106URN" },
    "memphis":       { code: "32820", name: "Memphis",       st: "TN", fips: "47", fred_hpi: "ATNHPIUS32820Q", fred_unemp: "MEMP247URN" },
    "miami":         { code: "33100", name: "Miami",         st: "FL", fips: "12", fred_hpi: "ATNHPIUS33100Q", fred_unemp: "MIAM112URN" },
    "fort lauderdale":{ code: "33100", name: "Miami",        st: "FL", fips: "12", fred_hpi: "ATNHPIUS33100Q", fred_unemp: "MIAM112URN" },
    "milwaukee":     { code: "33340", name: "Milwaukee",     st: "WI", fips: "55", fred_hpi: "ATNHPIUS33340Q", fred_unemp: null },
    "minneapolis":   { code: "33460", name: "Minneapolis",   st: "MN", fips: "27", fred_hpi: "ATNHPIUS33460Q", fred_unemp: "MINN227URN" },
    "nashville":     { code: "34980", name: "Nashville",     st: "TN", fips: "47", fred_hpi: "ATNHPIUS34980Q", fred_unemp: "NASH247URN" },
    "new york":      { code: "35620", name: "New York",      st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "nyc":           { code: "35620", name: "New York",      st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "oklahoma city": { code: "36420", name: "Oklahoma City", st: "OK", fips: "40", fred_hpi: "ATNHPIUS36420Q", fred_unemp: "OKLA240URN" },
    "orlando":       { code: "36740", name: "Orlando",       st: "FL", fips: "12", fred_hpi: "ATNHPIUS36740Q", fred_unemp: "ORLA012URN" },
    "philadelphia":  { code: "37980", name: "Philadelphia",  st: "PA", fips: "42", fred_hpi: "ATNHPIUS37980Q", fred_unemp: "PHIL142URN" },
    "philly":        { code: "37980", name: "Philadelphia",  st: "PA", fips: "42", fred_hpi: "ATNHPIUS37980Q", fred_unemp: "PHIL142URN" },
    "phoenix":       { code: "38060", name: "Phoenix",       st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "scottsdale":    { code: "38060", name: "Phoenix",       st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "pittsburgh":    { code: "38300", name: "Pittsburgh",    st: "PA", fips: "42", fred_hpi: "ATNHPIUS38300Q", fred_unemp: "PITT242URN" },
    "portland":      { code: "38900", name: "Portland",      st: "OR", fips: "41", fred_hpi: "ATNHPIUS38900Q", fred_unemp: "PORT041URN" },
    "raleigh":       { code: "39580", name: "Raleigh",       st: "NC", fips: "37", fred_hpi: "ATNHPIUS39580Q", fred_unemp: null },
    "richmond":      { code: "40060", name: "Richmond",      st: "VA", fips: "51", fred_hpi: "ATNHPIUS40060Q", fred_unemp: null },
    "riverside":     { code: "40140", name: "Riverside",     st: "CA", fips: "06", fred_hpi: "ATNHPIUS40140Q", fred_unemp: null },
    "sacramento":    { code: "40900", name: "Sacramento",    st: "CA", fips: "06", fred_hpi: "ATNHPIUS40900Q", fred_unemp: null },
    "st louis":      { code: "41180", name: "St. Louis",     st: "MO", fips: "29", fred_hpi: "ATNHPIUS41180Q", fred_unemp: "STLO229URN" },
    "saint louis":   { code: "41180", name: "St. Louis",     st: "MO", fips: "29", fred_hpi: "ATNHPIUS41180Q", fred_unemp: "STLO229URN" },
    "salt lake city": { code: "41620", name: "Salt Lake City", st: "UT", fips: "49", fred_hpi: "ATNHPIUS41620Q", fred_unemp: null },
    "san antonio":   { code: "41700", name: "San Antonio",   st: "TX", fips: "48", fred_hpi: "ATNHPIUS41700Q", fred_unemp: "SANA048URN" },
    "san diego":     { code: "41740", name: "San Diego",     st: "CA", fips: "06", fred_hpi: "ATNHPIUS41740Q", fred_unemp: "SAND106URN" },
    "san francisco":  { code: "41860", name: "San Francisco", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41860Q", fred_unemp: "SANF106URN" },
    "seattle":       { code: "42660", name: "Seattle",       st: "WA", fips: "53", fred_hpi: "ATNHPIUS42660Q", fred_unemp: "SEAT153URN" },
    "tampa":         { code: "45300", name: "Tampa",         st: "FL", fips: "12", fred_hpi: "ATNHPIUS45300Q", fred_unemp: "TAMP112URN" },
    "washington":    { code: "47900", name: "Washington DC",  st: "DC", fips: "11", fred_hpi: "ATNHPIUS47900Q", fred_unemp: "WASH111URN" },
    "dc":            { code: "47900", name: "Washington DC",  st: "DC", fips: "11", fred_hpi: "ATNHPIUS47900Q", fred_unemp: "WASH111URN" }
  };

  // ─── RESOLVE LOCATION ───
  function resolveCBSA(cityState) {
    if (!cityState) return null;
    const norm = cityState.toLowerCase().replace(/[,.\-]/g, ' ').trim();
    // Try direct match first
    for (const [key, val] of Object.entries(CBSA_MAP)) {
      if (norm.includes(key)) return val;
    }
    // Try each word
    const words = norm.split(/\s+/);
    for (const word of words) {
      if (CBSA_MAP[word]) return CBSA_MAP[word];
    }
    return null;
  }

  // ─── PROPERTY TYPE NORMALIZER ───
  function normalizePropertyType(raw) {
    if (!raw) return 'multifamily';
    const n = raw.toLowerCase();
    if (n.includes('multi') || n.includes('apartment') || n.includes('residential')) return 'multifamily';
    if (n.includes('industrial') || n.includes('warehouse') || n.includes('logistics') || n.includes('distribution')) return 'industrial';
    if (n.includes('office') && !n.includes('medical')) return 'office';
    if (n.includes('medical') || n.includes('healthcare')) return 'medical office';
    if (n.includes('retail') || n.includes('shopping')) return 'retail';
    if (n.includes('net lease') || n.includes('nnn') || n.includes('net-lease')) return 'net lease';
    if (n.includes('hotel') || n.includes('hospitality')) return 'hospitality';
    if (n.includes('storage') || n.includes('self-storage')) return 'self storage';
    if (n.includes('senior') || n.includes('assisted')) return 'senior living';
    if (n.includes('student')) return 'student housing';
    return 'multifamily'; // default
  }

  // ─── FRED FETCH ───
  async function fredLatest(seriesId) {
    const ck = `fw_${seriesId}`;
    const cached = cacheGet(ck);
    if (cached !== null) return cached;
    try {
      const params = new URLSearchParams({
        series_id: seriesId, api_key: FRED_KEY, file_type: 'json',
        sort_order: 'desc', limit: '5'
      });
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
      const j = await r.json();
      const obs = (j.observations || []).filter(o => o.value !== '.');
      const val = obs.length ? parseFloat(obs[0].value) : null;
      cacheSet(ck, val);
      return val;
    } catch (e) { console.warn(`FRED widget fetch failed: ${seriesId}`, e); return null; }
  }

  async function fredSeriesData(seriesId, count) {
    const ck = `fs_${seriesId}_${count}`;
    const cached = cacheGet(ck);
    if (cached !== null) return cached;
    try {
      const params = new URLSearchParams({
        series_id: seriesId, api_key: FRED_KEY, file_type: 'json',
        sort_order: 'desc', limit: String(count)
      });
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
      const j = await r.json();
      const obs = (j.observations || []).filter(o => o.value !== '.').map(o => ({ date: o.date, value: parseFloat(o.value) }));
      cacheSet(ck, obs);
      return obs;
    } catch (e) { console.warn(`FRED widget series failed: ${seriesId}`, e); return []; }
  }

  // ─── CENSUS FETCH ───
  async function censusState(fipsState) {
    const ck = `cw_${fipsState}`;
    const cached = cacheGet(ck);
    if (cached !== null) return cached;
    const vars = 'DP03_0062E,DP05_0001E,DP03_0004PE,DP04_0089E,DP04_0047PE,DP05_0018E';
    try {
      const r = await fetch(`https://api.census.gov/data/2023/acs/acs5/profile?get=${vars}&for=state:${fipsState}&key=${CENSUS_KEY}`);
      const j = await r.json();
      const h = j[0], v = j[1];
      const result = {};
      h.forEach((k, i) => { result[k] = v[i]; });
      cacheSet(ck, result);
      return result;
    } catch (e) { console.warn('Census widget fetch failed:', e); return {}; }
  }

  // ─── COMPUTE SCORE ───
  function computeScore(d) {
    let s = 50;
    if (d.unempLocal !== null && d.unempNat !== null) {
      s += Math.max(-10, Math.min(10, (d.unempNat - d.unempLocal) * 5));
    }
    if (d.hpiGrowth !== null) {
      s += Math.max(-10, Math.min(10, d.hpiGrowth * 2));
    }
    if (d.creDelinq !== null) {
      s += d.creDelinq < 1.5 ? 8 : d.creDelinq < 3 ? 3 : -5;
    }
    if (d.treasury10 !== null) {
      s += d.treasury10 < 3.5 ? 7 : d.treasury10 < 4.5 ? 2 : -5;
    }
    if (d.medianIncome) {
      s += d.medianIncome > 75000 ? 5 : d.medianIncome > 60000 ? 2 : -3;
    }
    if (d.vacancyRate !== null) {
      s += d.vacancyRate < 5 ? 5 : d.vacancyRate < 8 ? 2 : -3;
    }
    if (d.capRateSpread !== null) {
      s += d.capRateSpread > 200 ? 5 : d.capRateSpread > 100 ? 2 : -3;
    }
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  // ─── GENERATE NARRATIVE ───
  function genNarrative(d) {
    const parts = [];
    const metro = d.metroName;
    const prop = d.propertyType.charAt(0).toUpperCase() + d.propertyType.slice(1);

    if (d.treasury10 !== null) {
      const env = d.treasury10 < 3.5 ? 'accommodative' : d.treasury10 < 4.5 ? 'moderate' : 'restrictive';
      parts.push(`The rate environment is ${env} with the 10-Year Treasury at ${d.treasury10.toFixed(2)}%.`);
    }
    if (d.capRateSpread !== null) {
      const spreadQuality = d.capRateSpread > 200 ? 'attractive' : d.capRateSpread > 100 ? 'adequate' : 'compressed';
      parts.push(`This offering's cap rate spread of ${d.capRateSpread}bps over Treasuries is ${spreadQuality} by historical standards.`);
    }
    if (d.unempLocal !== null && d.unempNat !== null) {
      const vs = d.unempLocal < d.unempNat ? 'outperforming' : 'underperforming';
      parts.push(`${metro} is ${vs} nationally on employment with a ${d.unempLocal.toFixed(1)}% unemployment rate vs ${d.unempNat.toFixed(1)}% nationally.`);
    }
    if (d.hpiGrowth !== null) {
      const dir = d.hpiGrowth > 0 ? 'appreciated' : 'declined';
      parts.push(`Local home prices have ${dir} ${Math.abs(d.hpiGrowth).toFixed(1)}% YoY, ${d.hpiGrowth > 0 ? 'supporting asset valuations' : 'which may pressure property values'}.`);
    }
    if (d.medianIncome) {
      parts.push(`State median household income of $${d.medianIncome.toLocaleString()} provides a ${d.medianIncome > 70000 ? 'strong' : 'moderate'} income base for ${prop.toLowerCase()} tenants.`);
    }
    if (d.creDelinq !== null) {
      parts.push(`CRE loan delinquency at ${d.creDelinq.toFixed(2)}% is ${d.creDelinq < 2 ? 'within healthy range' : 'elevated, indicating sector stress'}.`);
    }
    return parts.join(' ');
  }

  // ─── WIDGET STYLES ───
  function injectStyles() {
    if (document.getElementById('mi-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'mi-widget-styles';
    style.textContent = `
      .miw { font-family: 'DM Sans', -apple-system, sans-serif; }
      .miw-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: linear-gradient(135deg, #1C3A63 0%, #2A6496 100%); color: white; border-radius: 8px 8px 0 0; }
      .miw-header h3 { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; margin: 0; }
      .miw-header .miw-live { font-size: 10px; background: rgba(26,122,74,0.4); color: #6EE7A0; padding: 2px 8px; border-radius: 100px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; animation: miw-pulse 2s infinite; }
      @keyframes miw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
      .miw-body { background: #fff; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px; }
      .miw-score-row { display: flex; align-items: center; gap: 20px; padding: 20px; border-bottom: 1px solid #F0F5FF; }
      .miw-score-ring { width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-direction: column; position: relative; flex-shrink: 0; }
      .miw-score-ring svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
      .miw-score-ring svg circle { fill: none; stroke-width: 4; }
      .miw-score-ring .trk { stroke: #E2E8F0; }
      .miw-score-ring .fl { stroke-linecap: round; transition: stroke-dashoffset 1.5s ease; }
      .miw-score-num { font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700; color: #1C3A63; line-height: 1; }
      .miw-score-lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #94A3B8; }
      .miw-score-meta { flex: 1; }
      .miw-score-meta .title { font-size: 15px; font-weight: 600; color: #1C3A63; }
      .miw-score-meta .sub { font-size: 12px; color: #94A3B8; margin-top: 2px; }
      .miw-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
      .miw-tag { font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.3px; }
      .miw-tag.pos { background: #ECFDF5; color: #1A7A4A; }
      .miw-tag.neg { background: #FEF2F2; color: #DC2626; }
      .miw-tag.neu { background: #F0F5FF; color: #475569; }
      .miw-metrics { padding: 0 20px; }
      .miw-mr { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #F8FAFC; }
      .miw-mr:last-child { border-bottom: none; }
      .miw-ml { font-size: 12px; color: #475569; }
      .miw-mv { font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 600; color: #1C3A63; display: flex; align-items: center; gap: 6px; }
      .miw-delta { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 500; }
      .miw-delta.up { color: #1A7A4A; background: #ECFDF5; }
      .miw-delta.dn { color: #DC2626; background: #FEF2F2; }
      .miw-narrative { padding: 16px 20px; background: #F0F5FF; border-top: 1px solid #E2E8F0; }
      .miw-narrative h4 { font-size: 11px; font-weight: 700; color: #1C3A63; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
      .miw-narrative p { font-size: 12px; color: #475569; line-height: 1.7; }
      .miw-spread { padding: 16px 20px; border-top: 1px solid #E2E8F0; background: #FFFBEB; }
      .miw-spread h4 { font-size: 11px; font-weight: 700; color: #B45309; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
      .miw-spread-bar { height: 8px; background: #E2E8F0; border-radius: 4px; position: relative; margin-bottom: 4px; }
      .miw-spread-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #DC2626, #B45309, #1A7A4A); transition: width 1s ease; }
      .miw-spread-labels { display: flex; justify-content: space-between; font-size: 10px; color: #94A3B8; }
      .miw-footer { padding: 10px 20px; border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center; }
      .miw-footer span { font-size: 10px; color: #94A3B8; }
      .miw-footer a { font-size: 11px; color: #2A6496; font-weight: 600; text-decoration: none; cursor: pointer; }
      .miw-footer a:hover { text-decoration: underline; }
      .miw-loading { padding: 40px 20px; text-align: center; }
      .miw-loading .miw-spin { width: 32px; height: 32px; border: 3px solid #E2E8F0; border-top-color: #2A6496; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .miw-loading p { font-size: 12px; color: #94A3B8; }
      .miw-chart-mini { height: 60px; padding: 8px 20px 16px; }
      .miw-chart-mini canvas { width: 100% !important; height: 100% !important; }
    `;
    document.head.appendChild(style);
  }

  // ─── RENDER WIDGET ───
  async function render(containerId, opts) {
    injectStyles();
    const container = document.getElementById(containerId);
    if (!container) { console.error('MarketIntelWidget: container not found:', containerId); return; }

    container.innerHTML = `<div class="miw"><div class="miw-header"><h3>✦ Market Intelligence</h3><span class="miw-live">● Live</span></div><div class="miw-body"><div class="miw-loading"><div class="miw-spin"></div><p>Pulling live data from FRED, Census Bureau...</p></div></div></div>`;

    const metro = resolveCBSA(opts.city || opts.location || '');
    if (!metro) {
      container.querySelector('.miw-body').innerHTML = `<div style="padding:24px;text-align:center;color:#94A3B8;font-size:13px;">Market data unavailable for this location.</div>`;
      return null;
    }

    const propType = normalizePropertyType(opts.propertyType);

    // Fire parallel API calls
    const [treasury10, fedFunds, mortgage30, creDelinq, unempNat, unempLocal, hpiSeries] = await Promise.all([
      fredLatest('GS10'),
      fredLatest('FEDFUNDS'),
      fredLatest('MORTGAGE30US'),
      fredLatest('DRCRELEXFACBS'),
      fredLatest('UNRATE'),
      metro.fred_unemp ? fredLatest(metro.fred_unemp) : Promise.resolve(null),
      metro.fred_hpi ? fredSeriesData(metro.fred_hpi, 8) : Promise.resolve([])
    ]);

    const census = await censusState(metro.fips);

    // Compute derived
    const hpiCurrent = hpiSeries.length ? hpiSeries[0].value : null;
    const hpiPrev = hpiSeries.length > 4 ? hpiSeries[4].value : null;
    const hpiGrowth = (hpiCurrent && hpiPrev) ? ((hpiCurrent - hpiPrev) / hpiPrev * 100) : null;
    const medianIncome = census['DP03_0062E'] ? parseInt(census['DP03_0062E']) : null;
    const vacancyRate = census['DP04_0047PE'] ? parseFloat(census['DP04_0047PE']) : null;
    const population = census['DP05_0001E'] ? parseInt(census['DP05_0001E']) : null;
    const medianAge = census['DP05_0018E'] ? parseFloat(census['DP05_0018E']) : null;

    // Cap rate spread
    const capRateSpread = (opts.capRate && treasury10) ? Math.round((opts.capRate - treasury10) * 100) : null;

    const d = {
      metroName: metro.name, propertyType: propType,
      treasury10, fedFunds, mortgage30, creDelinq,
      unempNat, unempLocal, hpiGrowth,
      medianIncome, vacancyRate, population, medianAge,
      capRateSpread
    };

    const score = computeScore(d);
    const narrative = genNarrative(d);
    const scoreColor = score >= 65 ? '#1A7A4A' : score >= 45 ? '#B45309' : '#DC2626';
    const circ = 2 * Math.PI * 30;
    const offset = circ * (1 - score / 100);

    const fP = (v, dec=2) => v !== null && v !== undefined ? v.toFixed(dec) + '%' : '—';
    const fM = (v) => v ? '$' + v.toLocaleString() : '—';

    const scoreTags = [];
    if (score >= 65) scoreTags.push('<span class="miw-tag pos">Strong Market</span>');
    else if (score >= 45) scoreTags.push('<span class="miw-tag neu">Moderate</span>');
    else scoreTags.push('<span class="miw-tag neg">Caution</span>');

    if (unempLocal !== null && unempNat !== null) {
      scoreTags.push(unempLocal < unempNat ? '<span class="miw-tag pos">Low Unemployment</span>' : '<span class="miw-tag neg">High Unemployment</span>');
    }
    if (hpiGrowth !== null) {
      scoreTags.push(hpiGrowth > 0 ? '<span class="miw-tag pos">Price Growth</span>' : '<span class="miw-tag neg">Price Decline</span>');
    }

    const spreadHtml = capRateSpread !== null ? `
      <div class="miw-spread">
        <h4>📐 Cap Rate Spread Analysis</h4>
        <div class="miw-spread-bar"><div class="miw-spread-fill" style="width:${Math.min(100, Math.max(10, capRateSpread / 4))}%"></div></div>
        <div class="miw-spread-labels"><span>Compressed (0bps)</span><span>${capRateSpread}bps</span><span>Wide (400bps)</span></div>
      </div>` : '';

    container.innerHTML = `
    <div class="miw">
      <div class="miw-header">
        <h3>✦ Market Intelligence — ${metro.name} ${propType.charAt(0).toUpperCase() + propType.slice(1)}</h3>
        <span class="miw-live">● Live</span>
      </div>
      <div class="miw-body">
        <div class="miw-score-row">
          <div class="miw-score-ring">
            <svg viewBox="0 0 72 72">
              <circle class="trk" cx="36" cy="36" r="30"/>
              <circle class="fl" cx="36" cy="36" r="30" stroke="${scoreColor}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
            </svg>
            <span class="miw-score-num">${score}</span>
            <span class="miw-score-lbl">Score</span>
          </div>
          <div class="miw-score-meta">
            <div class="title">Market Health Score</div>
            <div class="sub">Composite of ${7 + (capRateSpread !== null ? 1 : 0)} economic indicators</div>
            <div class="miw-tags">${scoreTags.join('')}</div>
          </div>
        </div>

        <div class="miw-metrics">
          <div class="miw-mr"><span class="miw-ml">10-Year Treasury</span><span class="miw-mv">${fP(treasury10)}</span></div>
          <div class="miw-mr"><span class="miw-ml">30-Year Mortgage</span><span class="miw-mv">${fP(mortgage30)}</span></div>
          <div class="miw-mr"><span class="miw-ml">Fed Funds Rate</span><span class="miw-mv">${fP(fedFunds)}</span></div>
          <div class="miw-mr"><span class="miw-ml">CRE Loan Delinquency</span><span class="miw-mv">${fP(creDelinq)}</span></div>
          <div class="miw-mr"><span class="miw-ml">${metro.name} Unemployment</span><span class="miw-mv">${fP(unempLocal, 1)}${unempLocal !== null && unempNat !== null ? (unempLocal < unempNat ? ' <span class="miw-delta up">vs ' + unempNat.toFixed(1) + '% nat\'l</span>' : ' <span class="miw-delta dn">vs ' + unempNat.toFixed(1) + '% nat\'l</span>') : ''}</span></div>
          <div class="miw-mr"><span class="miw-ml">Home Price Growth (YoY)</span><span class="miw-mv">${hpiGrowth !== null ? (hpiGrowth > 0 ? '+' : '') + hpiGrowth.toFixed(1) + '%' : '—'}</span></div>
          <div class="miw-mr"><span class="miw-ml">State Median Income</span><span class="miw-mv">${fM(medianIncome)}</span></div>
          <div class="miw-mr"><span class="miw-ml">Housing Vacancy Rate</span><span class="miw-mv">${fP(vacancyRate, 1)}</span></div>
        </div>

        ${spreadHtml}

        <div class="miw-narrative">
          <h4>✦ AI Market Brief</h4>
          <p>${narrative}</p>
        </div>

        <div class="miw-footer">
          <span>Sources: FRED, Census ACS, BLS, FHFA • ${new Date().toLocaleDateString()}</span>
          <a onclick="if(window.navigateTo)navigateTo('market_intel')">Full Analysis →</a>
        </div>
      </div>
    </div>`;

    // Return data for other modules to use
    return { score, narrative, data: d };
  }

  // ─── RENDER FROM AFL OFFERING OBJECT ───
  async function renderFromOffering(containerId, offering) {
    // Auto-extract city/state and property type from AFL offering data
    const city = offering.city || offering.location || offering.state || '';
    const propType = offering.propertyType || offering.assetType || offering.type || 'multifamily';
    const capRate = offering.capRate || offering.y1coc || null;

    return render(containerId, {
      city: city,
      state: offering.state || '',
      propertyType: propType,
      offeringName: offering.name || offering.offeringName || '',
      capRate: capRate,
      y1coc: offering.y1coc || null,
      ltv: offering.ltv || null
    });
  }

  // ─── EXPORT ───
  window.MarketIntelWidget = { render, renderFromOffering, resolveCBSA, normalizePropertyType };

})();
