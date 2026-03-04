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
 *     capRate: 5.5,
 *     y1coc: 5.25,
 *     ltv: 0.55
 *   });
 *
 *   // Or auto-detect from AFL offering data:
 *   MarketIntelWidget.renderFromOffering('market-intel-panel', offering);
 *
 * LOCATION HANDLING (v2):
 *   Single city:  "Houston, TX"                  → metro score + full indicators
 *   Multi-city:   "Houston, TX & Kansas City, MO" → averaged metro score, expandable breakdown
 *                 "Houston, TX, Kansas City, MO"
 *   States only:  "TX, OK, MO"  /  "TX & OK"     → national macro panel, no score gauge
 *
 * Version: 2.0
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

  // ═══════════════════════════════════════════════════════════
  //  LOCATION RESOLVER  — handles all 3 scenarios
  // ═══════════════════════════════════════════════════════════

  /**
   * resolveLocationType(locationStr)
   * Returns one of:
   *   { type: 'single',   city: 'Houston, TX' }
   *   { type: 'multi',    cities: ['Houston, TX', 'Kansas City, MO'] }
   *   { type: 'national', states: ['TX','OK','MO'] }
   */
  function resolveLocationType(locationStr) {
    if (!locationStr || !locationStr.trim()) return { type: 'national', states: [] };

    const str = locationStr.trim();

    // ── Step 1: Extract "City, ST" pairs first (must run before state-only check)
    // Handles: "Houston, TX", "Midland, TX & Odessa, TX", "Dallas, TX & Austin, TX"
    // City names always contain a lowercase letter (e.g. "Houston", "El Paso")
    // This prevents 2-letter state codes like "AZ" from being mistaken as city names
    const cityStateRe = /([A-Z][a-z][^,&]*,\s*[A-Z]{2})(?:\s*\(\d+\))?/g;
    const cities = [...str.matchAll(cityStateRe)].map(m => m[1].trim());

    if (cities.length > 1) return { type: 'multi', cities };
    if (cities.length === 1) return { type: 'single', city: cities[0] };

    // ── Step 2: State-only pattern — all & / , delimited parts are 2-letter codes
    // optionally followed by a property count like "(2)" → "AZ (2), TX, MO"
    const rawParts = str.split(/[&,]/).map(s => s.trim()).filter(Boolean);
    const stateOnlyRe = /^[A-Z]{2}(\s*\(\d+\))?$/;
    if (rawParts.length && rawParts.every(p => stateOnlyRe.test(p))) {
      return { type: 'national', states: rawParts.map(p => p.match(/^([A-Z]{2})/)[1]) };
    }

    // ── Fallback
    return { type: 'national', states: [] };
  }

  // ─── CBSA LOOKUP TABLE ───
  const CBSA_MAP = {
    "akron": { code: "10420", name: "Akron", st: "OH", fips: "39", fred_hpi: "ATNHPIUS10420Q", fred_unemp: "AKRO239URN" },
    "albuquerque": { code: "10740", name: "Albuquerque", st: "NM", fips: "35", fred_hpi: "ATNHPIUS10740Q", fred_unemp: "ALBU035URN" },
    "atlanta": { code: "12060", name: "Atlanta", st: "GA", fips: "13", fred_hpi: "ATNHPIUS12060Q", fred_unemp: "ATLA013URN" },
    "sandy springs": { code: "12060", name: "Atlanta", st: "GA", fips: "13", fred_hpi: "ATNHPIUS12060Q", fred_unemp: "ATLA013URN" },
    "alpharetta": { code: "12060", name: "Atlanta", st: "GA", fips: "13", fred_hpi: "ATNHPIUS12060Q", fred_unemp: "ATLA013URN" },
    "augusta ga": { code: "12260", name: "Augusta", st: "GA", fips: "13", fred_hpi: "ATNHPIUS12260Q", fred_unemp: null },
    "richmond county ga": { code: "12260", name: "Augusta", st: "GA", fips: "13", fred_hpi: "ATNHPIUS12260Q", fred_unemp: null },
    "austin": { code: "12420", name: "Austin", st: "TX", fips: "48", fred_hpi: "ATNHPIUS12420Q", fred_unemp: "AUST448URN" },
    "round rock": { code: "12420", name: "Austin", st: "TX", fips: "48", fred_hpi: "ATNHPIUS12420Q", fred_unemp: "AUST448URN" },
    "baltimore": { code: "12580", name: "Baltimore", st: "MD", fips: "24", fred_hpi: "ATNHPIUS12580Q", fred_unemp: "BALT124URN" },
    "columbia md": { code: "12580", name: "Baltimore", st: "MD", fips: "24", fred_hpi: "ATNHPIUS12580Q", fred_unemp: "BALT124URN" },
    "towson": { code: "12580", name: "Baltimore", st: "MD", fips: "24", fred_hpi: "ATNHPIUS12580Q", fred_unemp: "BALT124URN" },
    "baton rouge": { code: "12940", name: "Baton Rouge", st: "LA", fips: "22", fred_hpi: "ATNHPIUS12940Q", fred_unemp: "BATO222URN" },
    "birmingham": { code: "13820", name: "Birmingham", st: "AL", fips: "01", fred_hpi: "ATNHPIUS13820Q", fred_unemp: "BIRM101URN" },
    "hoover al": { code: "13820", name: "Birmingham", st: "AL", fips: "01", fred_hpi: "ATNHPIUS13820Q", fred_unemp: "BIRM101URN" },
    "boise": { code: "14260", name: "Boise City", st: "ID", fips: "16", fred_hpi: "ATNHPIUS14260Q", fred_unemp: "BOIS016URN" },
    "boston": { code: "14460", name: "Boston", st: "MA", fips: "25", fred_hpi: "ATNHPIUS14460Q", fred_unemp: "BOST625URN" },
    "cambridge ma": { code: "14460", name: "Boston", st: "MA", fips: "25", fred_hpi: "ATNHPIUS14460Q", fred_unemp: "BOST625URN" },
    "buffalo ny": { code: "15380", name: "Buffalo", st: "NY", fips: "36", fred_hpi: "ATNHPIUS15380Q", fred_unemp: "BUFF036URN" },
    "cheektowaga": { code: "15380", name: "Buffalo", st: "NY", fips: "36", fred_hpi: "ATNHPIUS15380Q", fred_unemp: "BUFF036URN" },
    "cape coral": { code: "16020", name: "Cape Coral", st: "FL", fips: "12", fred_hpi: "ATNHPIUS16020Q", fred_unemp: null },
    "fort myers": { code: "16020", name: "Cape Coral", st: "FL", fips: "12", fred_hpi: "ATNHPIUS16020Q", fred_unemp: null },
    "naples fl": { code: "16020", name: "Cape Coral", st: "FL", fips: "12", fred_hpi: "ATNHPIUS16020Q", fred_unemp: null },
    "cape girardeau": { code: "15980", name: "Cape Girardeau", st: "MO", fips: "29", fred_hpi: "ATNHPIUS15980Q", fred_unemp: null },
    "charleston sc": { code: "16700", name: "Charleston", st: "SC", fips: "45", fred_hpi: "ATNHPIUS16700Q", fred_unemp: "CHAR245URN" },
    "north charleston": { code: "16700", name: "Charleston", st: "SC", fips: "45", fred_hpi: "ATNHPIUS16700Q", fred_unemp: "CHAR245URN" },
    "charlotte": { code: "16740", name: "Charlotte", st: "NC", fips: "37", fred_hpi: "ATNHPIUS16740Q", fred_unemp: "CHAR737URN" },
    "concord nc": { code: "16740", name: "Charlotte", st: "NC", fips: "37", fred_hpi: "ATNHPIUS16740Q", fred_unemp: "CHAR737URN" },
    "gastonia": { code: "16740", name: "Charlotte", st: "NC", fips: "37", fred_hpi: "ATNHPIUS16740Q", fred_unemp: "CHAR737URN" },
    "chattanooga": { code: "16860", name: "Chattanooga", st: "TN", fips: "47", fred_hpi: "ATNHPIUS16860Q", fred_unemp: "CHAT247URN" },
    "chicago": { code: "16980", name: "Chicago", st: "IL", fips: "17", fred_hpi: "ATNHPIUS16980Q", fred_unemp: "CHIC917URN" },
    "naperville": { code: "16980", name: "Chicago", st: "IL", fips: "17", fred_hpi: "ATNHPIUS16980Q", fred_unemp: "CHIC917URN" },
    "elgin il": { code: "16980", name: "Chicago", st: "IL", fips: "17", fred_hpi: "ATNHPIUS16980Q", fred_unemp: "CHIC917URN" },
    "cincinnati": { code: "17140", name: "Cincinnati", st: "OH", fips: "39", fred_hpi: "ATNHPIUS17140Q", fred_unemp: "CINC139URN" },
    "cleveland": { code: "17460", name: "Cleveland", st: "OH", fips: "39", fred_hpi: "ATNHPIUS17460Q", fred_unemp: "CLEV339URN" },
    "elyria": { code: "17460", name: "Cleveland", st: "OH", fips: "39", fred_hpi: "ATNHPIUS17460Q", fred_unemp: "CLEV339URN" },
    "colorado springs": { code: "17820", name: "Colorado Springs", st: "CO", fips: "08", fred_hpi: "ATNHPIUS17820Q", fred_unemp: "COLO208URN" },
    "columbia sc": { code: "17900", name: "Columbia", st: "SC", fips: "45", fred_hpi: "ATNHPIUS17900Q", fred_unemp: null },
    "columbus oh": { code: "18140", name: "Columbus", st: "OH", fips: "39", fred_hpi: "ATNHPIUS18140Q", fred_unemp: "COLU139URN" },
    "columbus ohio": { code: "18140", name: "Columbus", st: "OH", fips: "39", fred_hpi: "ATNHPIUS18140Q", fred_unemp: "COLU139URN" },
    "corpus christi": { code: "18580", name: "Corpus Christi", st: "TX", fips: "48", fred_hpi: "ATNHPIUS18580Q", fred_unemp: null },
    "dallas": { code: "19100", name: "Dallas", st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "fort worth": { code: "19100", name: "Dallas", st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "dfw": { code: "19100", name: "Dallas", st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "arlington tx": { code: "19100", name: "Dallas", st: "TX", fips: "48", fred_hpi: "ATNHPIUS19100Q", fred_unemp: "DALL148URN" },
    "dayton": { code: "19380", name: "Dayton", st: "OH", fips: "39", fred_hpi: "ATNHPIUS19380Q", fred_unemp: "DAYT239URN" },
    "kettering": { code: "19380", name: "Dayton", st: "OH", fips: "39", fred_hpi: "ATNHPIUS19380Q", fred_unemp: "DAYT239URN" },
    "denver": { code: "19740", name: "Denver", st: "CO", fips: "08", fred_hpi: "ATNHPIUS19740Q", fred_unemp: "DENV208URN" },
    "aurora co": { code: "19740", name: "Denver", st: "CO", fips: "08", fred_hpi: "ATNHPIUS19740Q", fred_unemp: "DENV208URN" },
    "lakewood co": { code: "19740", name: "Denver", st: "CO", fips: "08", fred_hpi: "ATNHPIUS19740Q", fred_unemp: "DENV208URN" },
    "des moines": { code: "19780", name: "Des Moines", st: "IA", fips: "19", fred_hpi: "ATNHPIUS19780Q", fred_unemp: "DESM019URN" },
    "detroit": { code: "19820", name: "Detroit", st: "MI", fips: "26", fred_hpi: "ATNHPIUS19820Q", fred_unemp: "DETR026URN" },
    "warren mi": { code: "19820", name: "Detroit", st: "MI", fips: "26", fred_hpi: "ATNHPIUS19820Q", fred_unemp: "DETR026URN" },
    "dearborn": { code: "19820", name: "Detroit", st: "MI", fips: "26", fred_hpi: "ATNHPIUS19820Q", fred_unemp: "DETR026URN" },
    "durham nc": { code: "20500", name: "Durham", st: "NC", fips: "37", fred_hpi: "ATNHPIUS20500Q", fred_unemp: null },
    "chapel hill": { code: "20500", name: "Durham", st: "NC", fips: "37", fred_hpi: "ATNHPIUS20500Q", fred_unemp: null },
    "el paso": { code: "21340", name: "El Paso", st: "TX", fips: "48", fred_hpi: "ATNHPIUS21340Q", fred_unemp: "ELPA248URN" },
    "fayetteville ar": { code: "22180", name: "Fayetteville", st: "AR", fips: "05", fred_hpi: "ATNHPIUS22180Q", fred_unemp: null },
    "springdale ar": { code: "22180", name: "Fayetteville", st: "AR", fips: "05", fred_hpi: "ATNHPIUS22180Q", fred_unemp: null },
    "rogers ar": { code: "22180", name: "Fayetteville", st: "AR", fips: "05", fred_hpi: "ATNHPIUS22180Q", fred_unemp: null },
    "fort collins": { code: "22660", name: "Fort Collins", st: "CO", fips: "08", fred_hpi: "ATNHPIUS22660Q", fred_unemp: null },
    "fresno": { code: "23420", name: "Fresno", st: "CA", fips: "06", fred_hpi: "ATNHPIUS23420Q", fred_unemp: "FRES006URN" },
    "gainesville fl": { code: "23540", name: "Gainesville", st: "FL", fips: "12", fred_hpi: "ATNHPIUS23540Q", fred_unemp: null },
    "grand rapids": { code: "24340", name: "Grand Rapids", st: "MI", fips: "26", fred_hpi: "ATNHPIUS24340Q", fred_unemp: "GRAN226URN" },
    "kentwood mi": { code: "24340", name: "Grand Rapids", st: "MI", fips: "26", fred_hpi: "ATNHPIUS24340Q", fred_unemp: "GRAN226URN" },
    "greensboro": { code: "24660", name: "Greensboro", st: "NC", fips: "37", fred_hpi: "ATNHPIUS24660Q", fred_unemp: "GREE237URN" },
    "high point nc": { code: "24660", name: "Greensboro", st: "NC", fips: "37", fred_hpi: "ATNHPIUS24660Q", fred_unemp: "GREE237URN" },
    "greenville sc": { code: "24860", name: "Greenville", st: "SC", fips: "45", fred_hpi: "ATNHPIUS24860Q", fred_unemp: "GREE145URN" },
    "anderson sc": { code: "24860", name: "Greenville", st: "SC", fips: "45", fred_hpi: "ATNHPIUS24860Q", fred_unemp: "GREE145URN" },
    "spartanburg": { code: "24860", name: "Greenville", st: "SC", fips: "45", fred_hpi: "ATNHPIUS24860Q", fred_unemp: "GREE145URN" },
    "harrisburg": { code: "25420", name: "Harrisburg", st: "PA", fips: "42", fred_hpi: "ATNHPIUS25420Q", fred_unemp: null },
    "carlisle pa": { code: "25420", name: "Harrisburg", st: "PA", fips: "42", fred_hpi: "ATNHPIUS25420Q", fred_unemp: null },
    "hartford": { code: "25540", name: "Hartford", st: "CT", fips: "09", fred_hpi: "ATNHPIUS25540Q", fred_unemp: "HART609URN" },
    "honolulu": { code: "26380", name: "Honolulu", st: "HI", fips: "15", fred_hpi: "ATNHPIUS26180Q", fred_unemp: "HONO015URN" },
    "oahu": { code: "26380", name: "Honolulu", st: "HI", fips: "15", fred_hpi: "ATNHPIUS26180Q", fred_unemp: "HONO015URN" },
    "hawaii": { code: "26380", name: "Honolulu", st: "HI", fips: "15", fred_hpi: "ATNHPIUS26180Q", fred_unemp: "HONO015URN" },
    "houston": { code: "26420", name: "Houston", st: "TX", fips: "48", fred_hpi: "ATNHPIUS26420Q", fred_unemp: "HOUS448URN" },
    "woodlands": { code: "26420", name: "Houston", st: "TX", fips: "48", fred_hpi: "ATNHPIUS26420Q", fred_unemp: "HOUS448URN" },
    "sugar land": { code: "26420", name: "Houston", st: "TX", fips: "48", fred_hpi: "ATNHPIUS26420Q", fred_unemp: "HOUS448URN" },
    "huntsville al": { code: "26620", name: "Huntsville", st: "AL", fips: "01", fred_hpi: "ATNHPIUS26620Q", fred_unemp: null },
    "indianapolis": { code: "26900", name: "Indianapolis", st: "IN", fips: "18", fred_hpi: "ATNHPIUS26900Q", fred_unemp: "INDI218URN" },
    "carmel in": { code: "26900", name: "Indianapolis", st: "IN", fips: "18", fred_hpi: "ATNHPIUS26900Q", fred_unemp: "INDI218URN" },
    "anderson in": { code: "26900", name: "Indianapolis", st: "IN", fips: "18", fred_hpi: "ATNHPIUS26900Q", fred_unemp: "INDI218URN" },
    "jacksonville": { code: "27260", name: "Jacksonville", st: "FL", fips: "12", fred_hpi: "ATNHPIUS27260Q", fred_unemp: "JACK112URN" },
    "kansas city": { code: "28140", name: "Kansas City", st: "MO", fips: "29", fred_hpi: "ATNHPIUS28140Q", fred_unemp: "KANS229URN" },
    "kc": { code: "28140", name: "Kansas City", st: "MO", fips: "29", fred_hpi: "ATNHPIUS28140Q", fred_unemp: "KANS229URN" },
    "knoxville": { code: "28940", name: "Knoxville", st: "TN", fips: "47", fred_hpi: "ATNHPIUS28940Q", fred_unemp: "KNOX247URN" },
    "lakeland": { code: "29460", name: "Lakeland", st: "FL", fips: "12", fred_hpi: "ATNHPIUS29460Q", fred_unemp: null },
    "winter haven": { code: "29460", name: "Lakeland", st: "FL", fips: "12", fred_hpi: "ATNHPIUS29460Q", fred_unemp: null },
    "las vegas": { code: "29820", name: "Las Vegas", st: "NV", fips: "32", fred_hpi: "ATNHPIUS29820Q", fred_unemp: "LASV032URN" },
    "henderson nv": { code: "29820", name: "Las Vegas", st: "NV", fips: "32", fred_hpi: "ATNHPIUS29820Q", fred_unemp: "LASV032URN" },
    "paradise nv": { code: "29820", name: "Las Vegas", st: "NV", fips: "32", fred_hpi: "ATNHPIUS29820Q", fred_unemp: "LASV032URN" },
    "lexington ky": { code: "30460", name: "Lexington", st: "KY", fips: "21", fred_hpi: "ATNHPIUS30460Q", fred_unemp: null },
    "fayette ky": { code: "30460", name: "Lexington", st: "KY", fips: "21", fred_hpi: "ATNHPIUS30460Q", fred_unemp: null },
    "little rock": { code: "30780", name: "Little Rock", st: "AR", fips: "05", fred_hpi: "ATNHPIUS30780Q", fred_unemp: "LITT005URN" },
    "north little rock": { code: "30780", name: "Little Rock", st: "AR", fips: "05", fred_hpi: "ATNHPIUS30780Q", fred_unemp: "LITT005URN" },
    "conway ar": { code: "30780", name: "Little Rock", st: "AR", fips: "05", fred_hpi: "ATNHPIUS30780Q", fred_unemp: "LITT005URN" },
    "los angeles": { code: "31080", name: "Los Angeles", st: "CA", fips: "06", fred_hpi: "ATNHPIUS31080Q", fred_unemp: "LOSA106URN" },
    "la": { code: "31080", name: "Los Angeles", st: "CA", fips: "06", fred_hpi: "ATNHPIUS31080Q", fred_unemp: "LOSA106URN" },
    "long beach": { code: "31080", name: "Los Angeles", st: "CA", fips: "06", fred_hpi: "ATNHPIUS31080Q", fred_unemp: "LOSA106URN" },
    "anaheim": { code: "31080", name: "Los Angeles", st: "CA", fips: "06", fred_hpi: "ATNHPIUS31080Q", fred_unemp: "LOSA106URN" },
    "louisville": { code: "31140", name: "Louisville/Jefferson County", st: "KY", fips: "21", fred_hpi: "ATNHPIUS31140Q", fred_unemp: "LOUI121URN" },
    "madison wi": { code: "31540", name: "Madison", st: "WI", fips: "55", fred_hpi: "ATNHPIUS31540Q", fred_unemp: null },
    "mcallen": { code: "32580", name: "McAllen", st: "TX", fips: "48", fred_hpi: "ATNHPIUS32580Q", fred_unemp: null },
    "edinburg tx": { code: "32580", name: "McAllen", st: "TX", fips: "48", fred_hpi: "ATNHPIUS32580Q", fred_unemp: null },
    "memphis": { code: "32820", name: "Memphis", st: "TN", fips: "47", fred_hpi: "ATNHPIUS32820Q", fred_unemp: "MEMP247URN" },
    "miami": { code: "33100", name: "Miami", st: "FL", fips: "12", fred_hpi: "ATNHPIUS33100Q", fred_unemp: "MIAM112URN" },
    "fort lauderdale": { code: "33100", name: "Miami", st: "FL", fips: "12", fred_hpi: "ATNHPIUS33100Q", fred_unemp: "MIAM112URN" },
    "pompano beach": { code: "33100", name: "Miami", st: "FL", fips: "12", fred_hpi: "ATNHPIUS33100Q", fred_unemp: "MIAM112URN" },
    "boca raton": { code: "33100", name: "Miami", st: "FL", fips: "12", fred_hpi: "ATNHPIUS33100Q", fred_unemp: "MIAM112URN" },
    "milwaukee": { code: "33340", name: "Milwaukee", st: "WI", fips: "55", fred_hpi: "ATNHPIUS33340Q", fred_unemp: "MILW255URN" },
    "waukesha": { code: "33340", name: "Milwaukee", st: "WI", fips: "55", fred_hpi: "ATNHPIUS33340Q", fred_unemp: "MILW255URN" },
    "minneapolis": { code: "33460", name: "Minneapolis", st: "MN", fips: "27", fred_hpi: "ATNHPIUS33460Q", fred_unemp: "MINN227URN" },
    "st paul": { code: "33460", name: "Minneapolis", st: "MN", fips: "27", fred_hpi: "ATNHPIUS33460Q", fred_unemp: "MINN227URN" },
    "twin cities": { code: "33460", name: "Minneapolis", st: "MN", fips: "27", fred_hpi: "ATNHPIUS33460Q", fred_unemp: "MINN227URN" },
    "montgomery al": { code: "33860", name: "Montgomery", st: "AL", fips: "01", fred_hpi: "ATNHPIUS33860Q", fred_unemp: null },
    "myrtle beach": { code: "34820", name: "Myrtle Beach", st: "SC", fips: "45", fred_hpi: "ATNHPIUS34820Q", fred_unemp: null },
    "conway sc": { code: "34820", name: "Myrtle Beach", st: "SC", fips: "45", fred_hpi: "ATNHPIUS34820Q", fred_unemp: null },
    "nashville": { code: "34980", name: "Nashville", st: "TN", fips: "47", fred_hpi: "ATNHPIUS34980Q", fred_unemp: "NASH247URN" },
    "murfreesboro": { code: "34980", name: "Nashville", st: "TN", fips: "47", fred_hpi: "ATNHPIUS34980Q", fred_unemp: "NASH247URN" },
    "franklin tn": { code: "34980", name: "Nashville", st: "TN", fips: "47", fred_hpi: "ATNHPIUS34980Q", fred_unemp: "NASH247URN" },
    "new haven ct": { code: "35300", name: "New Haven", st: "CT", fips: "09", fred_hpi: "ATNHPIUS35300Q", fred_unemp: null },
    "milford ct": { code: "35300", name: "New Haven", st: "CT", fips: "09", fred_hpi: "ATNHPIUS35300Q", fred_unemp: null },
    "new orleans": { code: "35380", name: "New Orleans", st: "LA", fips: "22", fred_hpi: "ATNHPIUS35380Q", fred_unemp: "NEWO022URN" },
    "metairie": { code: "35380", name: "New Orleans", st: "LA", fips: "22", fred_hpi: "ATNHPIUS35380Q", fred_unemp: "NEWO022URN" },
    "nola": { code: "35380", name: "New Orleans", st: "LA", fips: "22", fred_hpi: "ATNHPIUS35380Q", fred_unemp: "NEWO022URN" },
    "new york": { code: "35620", name: "New York", st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "nyc": { code: "35620", name: "New York", st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "newark": { code: "35620", name: "New York", st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "jersey city": { code: "35620", name: "New York", st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "manhattan": { code: "35620", name: "New York", st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "brooklyn": { code: "35620", name: "New York", st: "NY", fips: "36", fred_hpi: "ATNHPIUS35620Q", fred_unemp: "NEWY636URN" },
    "sarasota": { code: "35840", name: "North Port", st: "FL", fips: "12", fred_hpi: "ATNHPIUS35840Q", fred_unemp: null },
    "bradenton": { code: "35840", name: "North Port", st: "FL", fips: "12", fred_hpi: "ATNHPIUS35840Q", fred_unemp: null },
    "north port fl": { code: "35840", name: "North Port", st: "FL", fips: "12", fred_hpi: "ATNHPIUS35840Q", fred_unemp: null },
    "ogden": { code: "36260", name: "Ogden", st: "UT", fips: "49", fred_hpi: "ATNHPIUS36260Q", fred_unemp: null },
    "clearfield ut": { code: "36260", name: "Ogden", st: "UT", fips: "49", fred_hpi: "ATNHPIUS36260Q", fred_unemp: null },
    "oklahoma city": { code: "36420", name: "Oklahoma City", st: "OK", fips: "40", fred_hpi: "ATNHPIUS36420Q", fred_unemp: "OKLA240URN" },
    "okc": { code: "36420", name: "Oklahoma City", st: "OK", fips: "40", fred_hpi: "ATNHPIUS36420Q", fred_unemp: "OKLA240URN" },
    "omaha": { code: "36540", name: "Omaha", st: "NE", fips: "31", fred_hpi: "ATNHPIUS36540Q", fred_unemp: "OMAH031URN" },
    "council bluffs": { code: "36540", name: "Omaha", st: "NE", fips: "31", fred_hpi: "ATNHPIUS36540Q", fred_unemp: "OMAH031URN" },
    "orlando": { code: "36740", name: "Orlando", st: "FL", fips: "12", fred_hpi: "ATNHPIUS36740Q", fred_unemp: "ORLA012URN" },
    "kissimmee": { code: "36740", name: "Orlando", st: "FL", fips: "12", fred_hpi: "ATNHPIUS36740Q", fred_unemp: "ORLA012URN" },
    "sanford fl": { code: "36740", name: "Orlando", st: "FL", fips: "12", fred_hpi: "ATNHPIUS36740Q", fred_unemp: "ORLA012URN" },
    "oxnard": { code: "37100", name: "Oxnard", st: "CA", fips: "06", fred_hpi: "ATNHPIUS37100Q", fred_unemp: "OXNA106URN" },
    "thousand oaks": { code: "37100", name: "Oxnard", st: "CA", fips: "06", fred_hpi: "ATNHPIUS37100Q", fred_unemp: "OXNA106URN" },
    "ventura ca": { code: "37100", name: "Oxnard", st: "CA", fips: "06", fred_hpi: "ATNHPIUS37100Q", fred_unemp: "OXNA106URN" },
    "palm bay": { code: "37340", name: "Palm Bay", st: "FL", fips: "12", fred_hpi: "ATNHPIUS37340Q", fred_unemp: null },
    "melbourne fl": { code: "37340", name: "Palm Bay", st: "FL", fips: "12", fred_hpi: "ATNHPIUS37340Q", fred_unemp: null },
    "titusville fl": { code: "37340", name: "Palm Bay", st: "FL", fips: "12", fred_hpi: "ATNHPIUS37340Q", fred_unemp: null },
    "philadelphia": { code: "37980", name: "Philadelphia", st: "PA", fips: "42", fred_hpi: "ATNHPIUS37980Q", fred_unemp: "PHIL142URN" },
    "philly": { code: "37980", name: "Philadelphia", st: "PA", fips: "42", fred_hpi: "ATNHPIUS37980Q", fred_unemp: "PHIL142URN" },
    "camden nj": { code: "37980", name: "Philadelphia", st: "PA", fips: "42", fred_hpi: "ATNHPIUS37980Q", fred_unemp: "PHIL142URN" },
    "phoenix": { code: "38060", name: "Phoenix", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "mesa az": { code: "38060", name: "Phoenix", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "chandler": { code: "38060", name: "Phoenix", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "scottsdale": { code: "38060", name: "Phoenix", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "tempe": { code: "38060", name: "Phoenix", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "glendale az": { code: "38060", name: "Phoenix", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS38060Q", fred_unemp: "PHOE904URN" },
    "pittsburgh": { code: "38300", name: "Pittsburgh", st: "PA", fips: "42", fred_hpi: "ATNHPIUS38300Q", fred_unemp: "PITT242URN" },
    "port st lucie": { code: "38940", name: "Port St. Lucie", st: "FL", fips: "12", fred_hpi: "ATNHPIUS38940Q", fred_unemp: null },
    "st lucie": { code: "38940", name: "Port St. Lucie", st: "FL", fips: "12", fred_hpi: "ATNHPIUS38940Q", fred_unemp: null },
    "portland me": { code: "38860", name: "Portland", st: "ME", fips: "23", fred_hpi: "ATNHPIUS38860Q", fred_unemp: null },
    "south portland": { code: "38860", name: "Portland", st: "ME", fips: "23", fred_hpi: "ATNHPIUS38860Q", fred_unemp: null },
    "portland": { code: "38900", name: "Portland", st: "OR", fips: "41", fred_hpi: "ATNHPIUS38900Q", fred_unemp: "PORT041URN" },
    "vancouver wa": { code: "38900", name: "Portland", st: "OR", fips: "41", fred_hpi: "ATNHPIUS38900Q", fred_unemp: "PORT041URN" },
    "hillsboro": { code: "38900", name: "Portland", st: "OR", fips: "41", fred_hpi: "ATNHPIUS38900Q", fred_unemp: "PORT041URN" },
    "providence": { code: "39300", name: "Providence", st: "RI", fips: "44", fred_hpi: "ATNHPIUS39300Q", fred_unemp: "PROV044URN" },
    "warwick ri": { code: "39300", name: "Providence", st: "RI", fips: "44", fred_hpi: "ATNHPIUS39300Q", fred_unemp: "PROV044URN" },
    "provo": { code: "39340", name: "Provo", st: "UT", fips: "49", fred_hpi: "ATNHPIUS39340Q", fred_unemp: null },
    "orem ut": { code: "39340", name: "Provo", st: "UT", fips: "49", fred_hpi: "ATNHPIUS39340Q", fred_unemp: null },
    "raleigh": { code: "39580", name: "Raleigh", st: "NC", fips: "37", fred_hpi: "ATNHPIUS39580Q", fred_unemp: "RALE237URN" },
    "cary nc": { code: "39580", name: "Raleigh", st: "NC", fips: "37", fred_hpi: "ATNHPIUS39580Q", fred_unemp: "RALE237URN" },
    "durham": { code: "39580", name: "Raleigh", st: "NC", fips: "37", fred_hpi: "ATNHPIUS39580Q", fred_unemp: "RALE237URN" },
    "research triangle": { code: "39580", name: "Raleigh", st: "NC", fips: "37", fred_hpi: "ATNHPIUS39580Q", fred_unemp: "RALE237URN" },
    "reno": { code: "39900", name: "Reno", st: "NV", fips: "32", fred_hpi: "ATNHPIUS39900Q", fred_unemp: null },
    "sparks nv": { code: "39900", name: "Reno", st: "NV", fips: "32", fred_hpi: "ATNHPIUS39900Q", fred_unemp: null },
    "richmond": { code: "40060", name: "Richmond", st: "VA", fips: "51", fred_hpi: "ATNHPIUS40060Q", fred_unemp: "RICH151URN" },
    "riverside": { code: "40140", name: "Riverside", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40140Q", fred_unemp: "RIVE106URN" },
    "san bernardino": { code: "40140", name: "Riverside", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40140Q", fred_unemp: "RIVE106URN" },
    "inland empire": { code: "40140", name: "Riverside", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40140Q", fred_unemp: "RIVE106URN" },
    "ontario ca": { code: "40140", name: "Riverside", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40140Q", fred_unemp: "RIVE106URN" },
    "rochester ny": { code: "40380", name: "Rochester", st: "NY", fips: "36", fred_hpi: "ATNHPIUS40380Q", fred_unemp: "ROCH036URN" },
    "sacramento": { code: "40900", name: "Sacramento", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40900Q", fred_unemp: "SACR106URN" },
    "roseville ca": { code: "40900", name: "Sacramento", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40900Q", fred_unemp: "SACR106URN" },
    "folsom": { code: "40900", name: "Sacramento", st: "CA", fips: "06", fred_hpi: "ATNHPIUS40900Q", fred_unemp: "SACR106URN" },
    "salt lake city": { code: "41620", name: "Salt Lake City", st: "UT", fips: "49", fred_hpi: "ATNHPIUS41620Q", fred_unemp: "SALT149URN" },
    "slc": { code: "41620", name: "Salt Lake City", st: "UT", fips: "49", fred_hpi: "ATNHPIUS41620Q", fred_unemp: "SALT149URN" },
    "salt lake": { code: "41620", name: "Salt Lake City", st: "UT", fips: "49", fred_hpi: "ATNHPIUS41620Q", fred_unemp: "SALT149URN" },
    "san antonio": { code: "41700", name: "San Antonio", st: "TX", fips: "48", fred_hpi: "ATNHPIUS41700Q", fred_unemp: "SANA048URN" },
    "new braunfels": { code: "41700", name: "San Antonio", st: "TX", fips: "48", fred_hpi: "ATNHPIUS41700Q", fred_unemp: "SANA048URN" },
    "san diego": { code: "41740", name: "San Diego", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41740Q", fred_unemp: "SAND106URN" },
    "chula vista": { code: "41740", name: "San Diego", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41740Q", fred_unemp: "SAND106URN" },
    "carlsbad": { code: "41740", name: "San Diego", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41740Q", fred_unemp: "SAND106URN" },
    "san francisco": { code: "41860", name: "San Francisco", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41860Q", fred_unemp: "SANF106URN" },
    "sf": { code: "41860", name: "San Francisco", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41860Q", fred_unemp: "SANF106URN" },
    "oakland": { code: "41860", name: "San Francisco", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41860Q", fred_unemp: "SANF106URN" },
    "berkeley": { code: "41860", name: "San Francisco", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41860Q", fred_unemp: "SANF106URN" },
    "san jose": { code: "41940", name: "San Jose", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41940Q", fred_unemp: "SANJ106URN" },
    "sunnyvale": { code: "41940", name: "San Jose", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41940Q", fred_unemp: "SANJ106URN" },
    "santa clara": { code: "41940", name: "San Jose", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41940Q", fred_unemp: "SANJ106URN" },
    "silicon valley": { code: "41940", name: "San Jose", st: "CA", fips: "06", fred_hpi: "ATNHPIUS41940Q", fred_unemp: "SANJ106URN" },
    "santa barbara": { code: "42200", name: "Santa Maria", st: "CA", fips: "06", fred_hpi: "ATNHPIUS42200Q", fred_unemp: null },
    "santa maria ca": { code: "42200", name: "Santa Maria", st: "CA", fips: "06", fred_hpi: "ATNHPIUS42200Q", fred_unemp: null },
    "savannah": { code: "42340", name: "Savannah", st: "GA", fips: "13", fred_hpi: "ATNHPIUS42340Q", fred_unemp: null },
    "seattle": { code: "42660", name: "Seattle", st: "WA", fips: "53", fred_hpi: "ATNHPIUS42660Q", fred_unemp: "SEAT153URN" },
    "tacoma": { code: "42660", name: "Seattle", st: "WA", fips: "53", fred_hpi: "ATNHPIUS42660Q", fred_unemp: "SEAT153URN" },
    "bellevue wa": { code: "42660", name: "Seattle", st: "WA", fips: "53", fred_hpi: "ATNHPIUS42660Q", fred_unemp: "SEAT153URN" },
    "st george ut": { code: "41060", name: "St. George", st: "UT", fips: "49", fred_hpi: "ATNHPIUS41060Q", fred_unemp: null },
    "saint george ut": { code: "41060", name: "St. George", st: "UT", fips: "49", fred_hpi: "ATNHPIUS41060Q", fred_unemp: null },
    "st louis": { code: "41180", name: "St. Louis", st: "MO", fips: "29", fred_hpi: "ATNHPIUS41180Q", fred_unemp: "STLO229URN" },
    "saint louis": { code: "41180", name: "St. Louis", st: "MO", fips: "29", fred_hpi: "ATNHPIUS41180Q", fred_unemp: "STLO229URN" },
    "stl": { code: "41180", name: "St. Louis", st: "MO", fips: "29", fred_hpi: "ATNHPIUS41180Q", fred_unemp: "STLO229URN" },
    "stockton ca": { code: "44700", name: "Stockton", st: "CA", fips: "06", fred_hpi: "ATNHPIUS44700Q", fred_unemp: "STOC006URN" },
    "syracuse": { code: "44060", name: "Syracuse", st: "NY", fips: "36", fred_hpi: "ATNHPIUS44060Q", fred_unemp: null },
    "tampa": { code: "45300", name: "Tampa", st: "FL", fips: "12", fred_hpi: "ATNHPIUS45300Q", fred_unemp: "TAMP112URN" },
    "st petersburg": { code: "45300", name: "Tampa", st: "FL", fips: "12", fred_hpi: "ATNHPIUS45300Q", fred_unemp: "TAMP112URN" },
    "clearwater": { code: "45300", name: "Tampa", st: "FL", fips: "12", fred_hpi: "ATNHPIUS45300Q", fred_unemp: "TAMP112URN" },
    "tucson": { code: "46060", name: "Tucson", st: "AZ", fips: "04", fred_hpi: "ATNHPIUS46060Q", fred_unemp: "TUCS204URN" },
    "tulsa": { code: "46140", name: "Tulsa", st: "OK", fips: "40", fred_hpi: "ATNHPIUS46140Q", fred_unemp: "TULS240URN" },
    "virginia beach": { code: "47260", name: "Virginia Beach", st: "VA", fips: "51", fred_hpi: "ATNHPIUS47260Q", fred_unemp: "VIRG051URN" },
    "norfolk va": { code: "47260", name: "Virginia Beach", st: "VA", fips: "51", fred_hpi: "ATNHPIUS47260Q", fred_unemp: "VIRG051URN" },
    "newport news": { code: "47260", name: "Virginia Beach", st: "VA", fips: "51", fred_hpi: "ATNHPIUS47260Q", fred_unemp: "VIRG051URN" },
    "hampton roads": { code: "47260", name: "Virginia Beach", st: "VA", fips: "51", fred_hpi: "ATNHPIUS47260Q", fred_unemp: "VIRG051URN" },
    "midland": { code: "33260", name: "Midland", st: "TX", fips: "48", fred_hpi: "ATNHPIUS33260Q", fred_unemp: "MIDL448URN" },
    "odessa": { code: "36220", name: "Odessa", st: "TX", fips: "48", fred_hpi: "ATNHPIUS36220Q", fred_unemp: "ODES148URN" },
    "waco": { code: "47380", name: "Waco", st: "TX", fips: "48", fred_hpi: "ATNHPIUS47380Q", fred_unemp: null },
    "washington": { code: "47900", name: "Washington", st: "DC", fips: "11", fred_hpi: "ATNHPIUS47900Q", fred_unemp: "WASH111URN" },
    "dc": { code: "47900", name: "Washington", st: "DC", fips: "11", fred_hpi: "ATNHPIUS47900Q", fred_unemp: "WASH111URN" },
    "arlington va": { code: "47900", name: "Washington", st: "DC", fips: "11", fred_hpi: "ATNHPIUS47900Q", fred_unemp: "WASH111URN" },
    "alexandria va": { code: "47900", name: "Washington", st: "DC", fips: "11", fred_hpi: "ATNHPIUS47900Q", fred_unemp: "WASH111URN" },
    "wichita": { code: "48620", name: "Wichita", st: "KS", fips: "20", fred_hpi: "ATNHPIUS48620Q", fred_unemp: "WICH220URN" }
  };

  // ─── RESOLVE LOCATION ───
  function resolveCBSA(cityState) {
    if (!cityState) return null;
    const norm = cityState.toLowerCase().replace(/[,.\-]/g, ' ').trim();
    for (const [key, val] of Object.entries(CBSA_MAP)) {
      if (norm.includes(key)) return val;
    }
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
    return 'multifamily';
  }

  // ═══════════════════════════════════════════════════════════
  //  FRED / CENSUS FETCH HELPERS  (unchanged from v1)
  // ═══════════════════════════════════════════════════════════

  async function fredProxyFetch(url) {
    const proxyUrls = [
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      url
    ];
    for (const purl of proxyUrls) {
      try {
        const r = await fetch(purl);
        if (!r.ok) continue;
        const j = await r.json();
        if (j.observations) return j;
        continue;
      } catch (e) { continue; }
    }
    return null;
  }

  async function fredLatest(seriesId) {
    const ck = `fw_${seriesId}`;
    const cached = cacheGet(ck);
    if (cached !== null) return cached;
    try {
      const params = new URLSearchParams({
        series_id: seriesId, api_key: FRED_KEY, file_type: 'json',
        sort_order: 'desc', limit: '5'
      });
      const j = await fredProxyFetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
      if (!j) return null;
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
      const j = await fredProxyFetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
      if (!j) return [];
      const obs = (j.observations || []).filter(o => o.value !== '.').map(o => ({ date: o.date, value: parseFloat(o.value) }));
      cacheSet(ck, obs);
      return obs;
    } catch (e) { console.warn(`FRED widget series failed: ${seriesId}`, e); return []; }
  }

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

  // ─── Fetch all data for one metro ───
  async function _fetchMetroData(metro, capRate) {
    const [treasury10, fedFunds, mortgage30, creDelinq, unempNat, unempLocal, hpiSeries] = await Promise.all([
      fredLatest('GS10'),
      fredLatest('FEDFUNDS'),
      fredLatest('MORTGAGE30US'),
      fredLatest('DRCRELEXFACBS'),
      fredLatest('UNRATE'),
      metro.fred_unemp ? fredLatest(metro.fred_unemp) : Promise.resolve(null),
      metro.fred_hpi   ? fredSeriesData(metro.fred_hpi, 8) : Promise.resolve([])
    ]);
    const census = await censusState(metro.fips);
    const hpiCurrent   = hpiSeries.length     ? hpiSeries[0].value : null;
    const hpiPrev      = hpiSeries.length > 4 ? hpiSeries[4].value : null;
    const hpiGrowth    = (hpiCurrent && hpiPrev) ? ((hpiCurrent - hpiPrev) / hpiPrev * 100) : null;
    const medianIncome = census['DP03_0062E'] ? parseInt(census['DP03_0062E']) : null;
    const vacancyRate  = census['DP04_0047PE'] ? parseFloat(census['DP04_0047PE']) : null;
    const capRateSpread = (capRate && treasury10) ? Math.round((capRate - treasury10) * 100) : null;
    return { metroName: metro.name, fips: metro.fips, treasury10, fedFunds, mortgage30, creDelinq, unempNat, unempLocal, hpiGrowth, medianIncome, vacancyRate, capRateSpread };
  }

  // ─── Fetch national-only data (no metro) ───
  async function _fetchNationalData(capRate) {
    const [treasury10, fedFunds, mortgage30, creDelinq, unempNat] = await Promise.all([
      fredLatest('GS10'),
      fredLatest('FEDFUNDS'),
      fredLatest('MORTGAGE30US'),
      fredLatest('DRCRELEXFACBS'),
      fredLatest('UNRATE')
    ]);
    const capRateSpread = (capRate && treasury10) ? Math.round((capRate - treasury10) * 100) : null;
    return { metroName: null, treasury10, fedFunds, mortgage30, creDelinq, unempNat, unempLocal: null, hpiGrowth: null, medianIncome: null, vacancyRate: null, capRateSpread };
  }

  // ═══════════════════════════════════════════════════════════
  //  SCORE + NARRATIVE  (unchanged from v1)
  // ═══════════════════════════════════════════════════════════

  function computeScore(d) {
    let s = 50;
    if (d.unempLocal !== null && d.unempNat !== null) s += Math.max(-10, Math.min(10, (d.unempNat - d.unempLocal) * 5));
    if (d.hpiGrowth  !== null) s += Math.max(-10, Math.min(10, d.hpiGrowth * 2));
    if (d.creDelinq  !== null) s += d.creDelinq < 1.5 ? 8 : d.creDelinq < 3 ? 3 : -5;
    if (d.treasury10 !== null) s += d.treasury10 < 3.5 ? 7 : d.treasury10 < 4.5 ? 2 : -5;
    if (d.medianIncome)        s += d.medianIncome > 75000 ? 5 : d.medianIncome > 60000 ? 2 : -3;
    if (d.vacancyRate !== null) s += d.vacancyRate < 5 ? 5 : d.vacancyRate < 8 ? 2 : -3;
    if (d.capRateSpread !== null) s += d.capRateSpread > 200 ? 5 : d.capRateSpread > 100 ? 2 : -3;
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  function genNarrative(d, offeringName, propType) {
    const parts = [];
    const metro = d.metroName;
    const prop  = propType ? (propType.charAt(0).toUpperCase() + propType.slice(1)) : 'Commercial';
    const name  = offeringName || 'This offering';
    if (d.treasury10 !== null) {
      const env = d.treasury10 < 3.5 ? 'accommodative' : d.treasury10 < 4.5 ? 'moderate' : 'restrictive';
      parts.push(`The rate environment is ${env} with the 10-Year Treasury at ${d.treasury10.toFixed(2)}%.`);
    }
    if (d.capRateSpread !== null) {
      const spreadQuality = d.capRateSpread > 200 ? 'attractive' : d.capRateSpread > 100 ? 'adequate' : 'compressed';
      parts.push(`${name}'s cap rate spread of ${d.capRateSpread}bps over Treasuries is ${spreadQuality} by historical standards.`);
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

  // ═══════════════════════════════════════════════════════════
  //  STYLES
  // ═══════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById('mi-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'mi-widget-styles';
    style.textContent = `
      .miw{font-family:'DM Sans',-apple-system,sans-serif}
      .miw-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(135deg,#1C3A63 0%,#2A6496 100%);color:#fff;border-radius:8px 8px 0 0}
      .miw-header h3{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;margin:0}
      .miw-header .miw-live{font-size:10px;background:rgba(26,122,74,.4);color:#6EE7A0;padding:2px 8px;border-radius:100px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;animation:miw-pulse 2s infinite}
      @keyframes miw-pulse{0%,100%{opacity:1}50%{opacity:.6}}
      .miw-body{background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px}
      .miw-score-row{display:flex;align-items:center;gap:20px;padding:20px;border-bottom:1px solid #F0F5FF}
      .miw-score-ring{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;position:relative;flex-shrink:0}
      .miw-score-ring svg{position:absolute;top:0;left:0;width:100%;height:100%;transform:rotate(-90deg)}
      .miw-score-ring svg circle{fill:none;stroke-width:4}
      .miw-score-ring .trk{stroke:#E2E8F0}
      .miw-score-ring .fl{stroke-linecap:round;transition:stroke-dashoffset 1.5s ease}
      .miw-score-num{font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:#1C3A63;line-height:1}
      .miw-score-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#94A3B8}
      .miw-score-meta{flex:1}
      .miw-score-meta .title{font-size:15px;font-weight:600;color:#1C3A63}
      .miw-score-meta .sub{font-size:12px;color:#94A3B8;margin-top:2px}
      .miw-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .miw-tag{font-size:10px;font-weight:600;padding:3px 8px;border-radius:100px;text-transform:uppercase;letter-spacing:.3px}
      .miw-tag.pos{background:#ECFDF5;color:#1A7A4A}
      .miw-tag.neg{background:#FEF2F2;color:#DC2626}
      .miw-tag.neu{background:#F0F5FF;color:#475569}
      .miw-metrics{padding:0 20px}
      .miw-mr{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #F8FAFC}
      .miw-mr:last-child{border-bottom:none}
      .miw-ml{font-size:12px;color:#475569}
      .miw-mv{font-family:'DM Mono',monospace;font-size:13px;font-weight:600;color:#1C3A63;display:flex;align-items:center;gap:6px}
      .miw-delta{font-size:10px;padding:1px 5px;border-radius:3px;font-weight:500}
      .miw-delta.up{color:#1A7A4A;background:#ECFDF5}
      .miw-delta.dn{color:#DC2626;background:#FEF2F2}
      .miw-narrative{padding:16px 20px;background:#F0F5FF;border-top:1px solid #E2E8F0}
      .miw-narrative h4{font-size:11px;font-weight:700;color:#1C3A63;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px}
      .miw-narrative p{font-size:12px;color:#475569;line-height:1.7}
      .miw-spread{padding:16px 20px;border-top:1px solid #E2E8F0;background:#FFFBEB}
      .miw-spread h4{font-size:11px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
      .miw-spread-bar{height:8px;background:#E2E8F0;border-radius:4px;position:relative;margin-bottom:4px}
      .miw-spread-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#DC2626,#B45309,#1A7A4A);transition:width 1s ease}
      .miw-spread-labels{display:flex;justify-content:space-between;font-size:10px;color:#94A3B8}
      .miw-footer{padding:10px 20px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center}
      .miw-footer span{font-size:10px;color:#94A3B8}
      .miw-footer a{font-size:11px;color:#2A6496;font-weight:600;text-decoration:none;cursor:pointer}
      .miw-footer a:hover{text-decoration:underline}
      .miw-loading{padding:40px 20px;text-align:center}
      .miw-loading .miw-spin{width:32px;height:32px;border:3px solid #E2E8F0;border-top-color:#2A6496;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px}
      @keyframes spin{to{transform:rotate(360deg)}}
      .miw-loading p{font-size:12px;color:#94A3B8}

      /* ── compact card ── */
      .miw-compact{font-family:'DM Sans',-apple-system,sans-serif;background:#fff;border:1.5px solid #E2E8F0;border-radius:14px;overflow:hidden}
      .miw-compact-top{display:flex;align-items:center;gap:20px;padding:20px 24px;background:linear-gradient(135deg,#0B1F3B 0%,#1C3A63 50%,#2A5298 100%);position:relative;overflow:hidden}
      .miw-compact-top::after{content:'';position:absolute;right:-40px;top:-40px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,.03)}
      .miw-compact-ring{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;position:relative;flex-shrink:0}
      .miw-compact-ring svg{position:absolute;top:0;left:0;width:100%;height:100%;transform:rotate(-90deg)}
      .miw-compact-ring svg circle{fill:none;stroke-width:4}
      .miw-compact-ring .trk{stroke:rgba(255,255,255,.15)}
      .miw-compact-ring .fl{stroke-linecap:round;transition:stroke-dashoffset 1.5s ease}
      .miw-compact-ring .sc-num{font-family:'DM Mono',monospace;font-size:26px;font-weight:700;color:#fff;line-height:1}
      .miw-compact-ring .sc-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:rgba(255,255,255,.5);margin-top:1px}
      .miw-compact-meta{flex:1}
      .miw-compact-meta .cm-title{font-size:15px;font-weight:700;color:#fff;margin-bottom:2px}
      .miw-compact-meta .cm-sub{font-size:12px;color:rgba(255,255,255,.45);margin-bottom:8px}
      .miw-compact-tags{display:flex;gap:5px;flex-wrap:wrap}
      .miw-compact-tags .ct{font-size:10px;font-weight:600;padding:2px 8px;border-radius:100px;letter-spacing:.3px}
      .miw-compact-tags .ct.pos{background:rgba(26,122,74,.25);color:#6EE7A0}
      .miw-compact-tags .ct.neg{background:rgba(220,38,38,.25);color:#FCA5A5}
      .miw-compact-tags .ct.neu{background:rgba(255,255,255,.12);color:rgba(255,255,255,.7)}
      .miw-compact-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-bottom:1px solid #F0F5FF}
      .miw-compact-stat{padding:14px 16px;text-align:center;border-right:1px solid #F0F5FF}
      .miw-compact-stat:last-child{border-right:none}
      .miw-compact-stat .cs-val{font-family:'DM Mono',monospace;font-size:16px;font-weight:700;color:#1C3A63}
      .miw-compact-stat .cs-lbl{font-size:10px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
      .miw-compact-stat .cs-delta{font-size:9px;margin-top:2px;font-weight:500}
      .miw-compact-stat .cs-delta.up{color:#1A7A4A}
      .miw-compact-stat .cs-delta.dn{color:#DC2626}
      .miw-compact-brief{padding:16px 24px;background:#F8FAFF;border-bottom:1px solid #F0F5FF}
      .miw-compact-brief h4{font-size:11px;font-weight:700;color:#1C3A63;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px}
      .miw-compact-brief h4 .live-dot{width:6px;height:6px;border-radius:50%;background:#1A7A4A;animation:miw-pulse 2s infinite;display:inline-block}
      .miw-compact-brief p{font-size:13px;color:#475569;line-height:1.75}
      .miw-compact-foot{padding:10px 24px;display:flex;justify-content:space-between;align-items:center}
      .miw-compact-foot span{font-size:10px;color:#94A3B8}
      .miw-compact-foot a{font-size:12px;color:#2A6496;font-weight:600;text-decoration:none;cursor:pointer;display:flex;align-items:center;gap:4px}
      .miw-compact-foot a:hover{text-decoration:underline}

      /* ── multi-market breakdown ── */
      .miw-multi-breakdown{border-bottom:1px solid #F0F5FF}
      .miw-multi-toggle{display:flex;align-items:center;gap:6px;padding:10px 24px;font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;background:#F8FAFF;user-select:none}
      .miw-multi-toggle:hover{color:#1C3A63}
      .miw-multi-toggle .arr{font-size:9px;transition:transform .2s}
      .miw-multi-rows{display:flex;flex-direction:column;gap:6px;padding:0 24px 12px;background:#F8FAFF}
      .miw-multi-row{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#fff;border:1px solid #E2E8F0;border-radius:8px}
      .miw-multi-row-city{font-size:12px;font-weight:600;color:#1C3A63}
      .miw-multi-row-score{font-family:'DM Mono',monospace;font-size:13px;font-weight:700}
      .miw-multi-row-unemp{font-size:11px;color:#94A3B8}

      @media(max-width:700px){.miw-compact-stats{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  //  renderCompact  — main entry point used by offering.html
  // ═══════════════════════════════════════════════════════════

  async function renderCompact(containerId, opts) {
    injectStyles();
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Spinner
    container.innerHTML = `<div class="miw-compact" style="padding:32px;text-align:center">
      <div style="width:28px;height:28px;border:3px solid #E2E8F0;border-top-color:#2A6496;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px"></div>
      <div style="font-size:12px;color:#94A3B8">Loading market intelligence…</div>
    </div>`;

    // Build location string from opts
    const locationStr = opts.location ||
      (opts.city ? (opts.state ? `${opts.city}, ${opts.state}` : opts.city) : '');

    const resolved = resolveLocationType(locationStr);
    const propType = normalizePropertyType(opts.propertyType);
    const capRate  = opts.capRate || null;
    const offeringName = opts.offeringName || '';

    if (resolved.type === 'single') {
      return _renderCompactSingle(container, resolved.city, propType, capRate, offeringName, opts);
    } else if (resolved.type === 'multi') {
      return _renderCompactMulti(container, resolved.cities, propType, capRate, offeringName, opts);
    } else {
      return _renderCompactNational(container, resolved.states, propType, capRate, offeringName, opts);
    }
  }

  // ── SINGLE city ──────────────────────────────────────────────
  async function _renderCompactSingle(container, cityStr, propType, capRate, offeringName, opts) {
    const metro = resolveCBSA(cityStr);
    if (!metro) { container.innerHTML = ''; return null; }

    const d     = await _fetchMetroData(metro, capRate);
    const score = computeScore(d);
    const brief = genNarrative(d, offeringName, propType);

    const scoreColor = score >= 65 ? '#34D399' : score >= 45 ? '#FBBF24' : '#F87171';
    const circ   = 2 * Math.PI * 34;
    const offset = circ * (1 - score / 100);
    const fP = (v, dec = 2) => v != null ? v.toFixed(dec) + '%' : '—';

    const tags = _buildTags(d, score);
    const unempDelta = (d.unempLocal !== null && d.unempNat !== null)
      ? `<span class="cs-delta ${d.unempLocal < d.unempNat ? 'up' : 'dn'}">${d.unempLocal < d.unempNat ? '▼' : '▲'} vs ${d.unempNat.toFixed(1)}% nat'l</span>` : '';
    const hpiDelta = d.hpiGrowth !== null
      ? `<span class="cs-delta ${d.hpiGrowth > 0 ? 'up' : 'dn'}">${d.hpiGrowth > 0 ? '▲' : '▼'} ${Math.abs(d.hpiGrowth).toFixed(1)}% YoY</span>` : '';

    container.innerHTML = `
    <div class="miw-compact">
      <div class="miw-compact-top">
        <div class="miw-compact-ring">
          <svg viewBox="0 0 80 80">
            <circle class="trk" cx="40" cy="40" r="34"/>
            <circle class="fl" cx="40" cy="40" r="34" stroke="${scoreColor}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
          </svg>
          <span class="sc-num">${score}</span>
          <span class="sc-lbl">Score</span>
        </div>
        <div class="miw-compact-meta">
          <div class="cm-title">📊 ${metro.name} — ${_cap(propType)}</div>
          <div class="cm-sub">Market Health Score · ${score >= 65 ? 'Above Average' : score >= 45 ? 'Near Average' : 'Below Average'}</div>
          <div class="miw-compact-tags">${tags}</div>
        </div>
      </div>

      <div class="miw-compact-stats">
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.treasury10)}</div>
          <div class="cs-lbl">10Y Treasury</div>
        </div>
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.unempLocal, 1)}</div>
          <div class="cs-lbl">${metro.name} Unemp.</div>
          ${unempDelta}
        </div>
        <div class="miw-compact-stat">
          <div class="cs-val">${d.hpiGrowth !== null ? (d.hpiGrowth > 0 ? '+' : '') + d.hpiGrowth.toFixed(1) + '%' : '—'}</div>
          <div class="cs-lbl">HPI YoY</div>
          ${hpiDelta}
        </div>
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.creDelinq)}</div>
          <div class="cs-lbl">CRE Delinq.</div>
        </div>
      </div>

      <div class="miw-compact-brief">
        <h4>✦ Market Intelligence Brief <span class="live-dot"></span></h4>
        <p>${brief}</p>
      </div>

      <div class="miw-compact-foot">
        <span>FRED · Census ACS · BLS · FHFA — ${new Date().toLocaleDateString()}</span>
        <a class="miw-compact-link" onclick="if(window.AFL&&window.AFL.navigate)AFL.navigate('market_intel')">View Full Analysis →</a>
      </div>
    </div>`;

    return { score, narrative: brief, data: d };
  }

  // ── MULTI-city ───────────────────────────────────────────────
  async function _renderCompactMulti(container, cities, propType, capRate, offeringName, opts) {
    // Resolve + fetch all metros in parallel
    const results = await Promise.all(cities.map(async (city) => {
      const metro = resolveCBSA(city);
      if (!metro) return null;
      const d     = await _fetchMetroData(metro, capRate);
      const score = computeScore(d);
      return { city, metro, d, score };
    }));
    const valid = results.filter(Boolean);

    if (!valid.length) { container.innerHTML = ''; return null; }

    // Weighted average score (equal weight)
    const avgScore    = Math.round(valid.reduce((s, r) => s + r.score, 0) / valid.length);
    const primaryD    = valid[0].d; // macro indicators are the same for all (FRED national series)
    const scoreColor  = avgScore >= 65 ? '#34D399' : avgScore >= 45 ? '#FBBF24' : '#F87171';
    const circ        = 2 * Math.PI * 34;
    const offset      = circ * (1 - avgScore / 100);
    const fP = (v, dec = 2) => v != null ? v.toFixed(dec) + '%' : '—';

    // Per-city breakdown rows (hidden by default, toggled)
    const breakdownRows = valid.map(r => {
      const c = r.score >= 65 ? '#1A7A4A' : r.score >= 45 ? '#B45309' : '#DC2626';
      return `<div class="miw-multi-row">
        <span class="miw-multi-row-city">📍 ${r.metro.name}, ${r.metro.st}</span>
        <span class="miw-multi-row-unemp">${r.d.unempLocal != null ? r.d.unempLocal.toFixed(1) + '% unemp.' : ''}</span>
        <span class="miw-multi-row-score" style="color:${c}">${r.score}/100</span>
      </div>`;
    }).join('');

    // Brief text for multi
    const metroNames = valid.map(r => r.metro.name).join(' & ');
    const briefParts = [];
    if (primaryD.treasury10 !== null) {
      const env = primaryD.treasury10 < 3.5 ? 'favorable' : primaryD.treasury10 < 4.5 ? 'moderate' : 'challenging';
      briefParts.push(`The current rate environment is ${env} for ${propType} investments, with the 10-Year Treasury at ${primaryD.treasury10.toFixed(2)}%.`);
    }
    if (capRate && primaryD.treasury10) {
      const sp = Math.round((capRate - primaryD.treasury10) * 100);
      briefParts.push(`${offeringName || 'This offering'}'s cap rate spread of ${sp}bps over Treasuries is ${sp > 200 ? 'compelling' : sp > 100 ? 'adequate' : 'compressed'}.`);
    }
    briefParts.push(`This multi-market offering spans ${metroNames}. The blended market health score of ${avgScore}/100 is a simple average across all ${valid.length} markets.`);
    if (primaryD.creDelinq !== null) {
      briefParts.push(`National CRE loan delinquency stands at ${primaryD.creDelinq.toFixed(2)}%, ${primaryD.creDelinq < 2 ? 'indicating healthy credit conditions' : 'elevated relative to norms'}.`);
    }
    const brief = briefParts.join(' ');

    // Blend local data for tags (avg unemployment, avg HPI across metros)
    const blendedD = Object.assign({}, primaryD, {
      unempLocal: valid.reduce((s,r) => s + (r.d.unempLocal ?? primaryD.unempNat ?? 0), 0) / valid.length,
      hpiYoy:     valid.reduce((s,r) => s + (r.d.hpiYoy ?? 0), 0) / valid.length,
    });
    const tags = [
      `<span class="ct neu">🏙 Multi-Market · ${valid.length} metros</span>`,
      ..._buildTags(blendedD, avgScore).match(/<span[^>]*>.*?<\/span>/g) || []
    ].join('');

    // Per-city local stat columns (unemp + HPI per metro)
    const perCityStats = valid.map(r => `
      <div class="miw-compact-stat">
        <div class="cs-val">${r.d.unempLocal != null ? r.d.unempLocal.toFixed(1) + '%' : r.d.unempNat != null ? r.d.unempNat.toFixed(1) + '%' : '—'}</div>
        <div class="cs-lbl">${r.metro.name} Unemp.</div>
        ${r.d.unempLocal != null && r.d.unempNat != null ? `<div class="cs-sub" style="font-size:9px;color:${r.d.unempLocal < r.d.unempNat ? '#34D399' : '#F87171'}">${r.d.unempLocal < r.d.unempNat ? '▼' : '▲'} vs ${r.d.unempNat.toFixed(1)}% nat'l</div>` : ''}
      </div>`).join('');

    container.innerHTML = `
    <div class="miw-compact">
      <div class="miw-compact-top">
        <div class="miw-compact-ring">
          <svg viewBox="0 0 80 80">
            <circle class="trk" cx="40" cy="40" r="34"/>
            <circle class="fl" cx="40" cy="40" r="34" stroke="${scoreColor}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
          </svg>
          <span class="sc-num">${avgScore}</span>
          <span class="sc-lbl">Score</span>
        </div>
        <div class="miw-compact-meta">
          <div class="cm-title">📊 ${valid.map(r => r.metro.name).join(' & ')} — ${_cap(propType)}</div>
          <div class="cm-sub">Blended Market Health Score · ${valid.length} markets averaged</div>
          <div class="miw-compact-tags">${tags}</div>
        </div>
      </div>

      <div class="miw-compact-stats">
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(primaryD.treasury10)}</div>
          <div class="cs-lbl">10Y Treasury</div>
        </div>
        ${perCityStats}
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(primaryD.creDelinq)}</div>
          <div class="cs-lbl">CRE Delinq.</div>
        </div>
      </div>

      <div class="miw-multi-breakdown">
        <div class="miw-multi-toggle" onclick="var rows=this.nextElementSibling;var arr=this.querySelector('.arr');var open=rows.style.display==='flex';rows.style.display=open?'none':'flex';arr.style.transform=open?'':'rotate(180deg)'">
          <span class="arr" style="font-size:9px;transition:transform .2s">▼</span>
          Per-Market Breakdown (${valid.length} markets)
        </div>
        <div class="miw-multi-rows" style="display:none">
          ${breakdownRows}
        </div>
      </div>

      <div class="miw-compact-brief">
        <h4>✦ Market Intelligence Brief <span class="live-dot"></span></h4>
        <p>${brief}</p>
      </div>

      <div class="miw-compact-foot">
        <span>FRED · Census ACS · BLS · FHFA — ${new Date().toLocaleDateString()}</span>
        <a class="miw-compact-link" onclick="if(window.AFL&&window.AFL.navigate)AFL.navigate('market_intel')">View Full Analysis →</a>
      </div>
    </div>`;

    return { score: avgScore, narrative: brief, data: primaryD, markets: valid };
  }

  // ── NATIONAL (states only / unresolvable city) ───────────────
  async function _renderCompactNational(container, states, propType, capRate, offeringName, opts) {
    const d   = await _fetchNationalData(capRate);
    const fP  = (v, dec = 2) => v != null ? v.toFixed(dec) + '%' : '—';
    const stateLabel = states.length ? states.join(', ') : 'Multiple States';

    const briefParts = [];
    if (d.treasury10 !== null) {
      const env = d.treasury10 < 3.5 ? 'favorable' : d.treasury10 < 4.5 ? 'moderate' : 'challenging';
      briefParts.push(`The current rate environment is ${env} for ${propType} investments, with the 10-Year Treasury at ${d.treasury10.toFixed(2)}%.`);
    }
    if (capRate && d.treasury10) {
      const sp = Math.round((capRate - d.treasury10) * 100);
      briefParts.push(`${offeringName || 'This offering'}'s cap rate spread of ${sp}bps over Treasuries is ${sp > 200 ? 'compelling' : sp > 100 ? 'adequate' : 'compressed'}.`);
    }
    if (d.unempNat !== null) briefParts.push(`National unemployment stands at ${d.unempNat.toFixed(1)}%, reflecting current labor market conditions.`);
    if (d.creDelinq !== null) briefParts.push(`CRE loan delinquency is at ${d.creDelinq.toFixed(2)}%, ${d.creDelinq < 2 ? 'indicating healthy credit conditions' : 'which warrants monitoring'}.`);
    if (states.length) briefParts.push(`This offering holds properties across ${stateLabel}. National macro indicators are shown — no single metro is applicable.`);
    const brief = briefParts.join(' ');

    container.innerHTML = `
    <div class="miw-compact">
      <div class="miw-compact-top" style="align-items:flex-start">
        <div style="flex:1">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:100px;font-size:11px;font-weight:600;color:rgba(255,255,255,.9);margin-bottom:8px">
            🌐 Diversified National · ${stateLabel}
          </div>
          <div class="cm-title">National Macro Indicators — ${_cap(propType)}</div>
          <div class="cm-sub">Properties span ${states.length ? states.length + ' state' + (states.length > 1 ? 's' : '') : 'multiple states'} — national indicators shown</div>
        </div>
      </div>

      <div class="miw-compact-stats">
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.treasury10)}</div>
          <div class="cs-lbl">10Y Treasury</div>
        </div>
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.unempNat, 1)}</div>
          <div class="cs-lbl">Nat'l Unemp.</div>
        </div>
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.mortgage30)}</div>
          <div class="cs-lbl">30Y Mortgage</div>
        </div>
        <div class="miw-compact-stat">
          <div class="cs-val">${fP(d.creDelinq)}</div>
          <div class="cs-lbl">CRE Delinq.</div>
        </div>
      </div>

      <div class="miw-compact-brief">
        <h4>✦ Market Intelligence Brief <span class="live-dot"></span></h4>
        <p>${brief}</p>
      </div>

      <div class="miw-compact-foot">
        <span>FRED · BLS · FHFA — ${new Date().toLocaleDateString()}</span>
        <a class="miw-compact-link" onclick="if(window.AFL&&window.AFL.navigate)AFL.navigate('market_intel')">View Full Analysis →</a>
      </div>
    </div>`;

    return { score: null, narrative: brief, data: d, type: 'national' };
  }

  // ═══════════════════════════════════════════════════════════
  //  render  — full widget (market intel module)
  // ═══════════════════════════════════════════════════════════

  async function render(containerId, opts) {
    injectStyles();
    const container = document.getElementById(containerId);
    if (!container) { console.error('MarketIntelWidget: container not found:', containerId); return; }

    container.innerHTML = `<div class="miw"><div class="miw-header"><h3>✦ Market Intelligence</h3><span class="miw-live">● Live</span></div><div class="miw-body"><div class="miw-loading"><div class="miw-spin"></div><p>Pulling live data from FRED, Census Bureau...</p></div></div></div>`;

    const locationStr = opts.location ||
      (opts.city ? (opts.state ? `${opts.city}, ${opts.state}` : opts.city) : '');
    const resolved  = resolveLocationType(locationStr);
    const propType  = normalizePropertyType(opts.propertyType);
    const capRate   = opts.capRate || null;

    // For full widget, use first resolvable metro
    let metro = null;
    if (resolved.type === 'single') {
      metro = resolveCBSA(resolved.city);
    } else if (resolved.type === 'multi') {
      for (const city of resolved.cities) { metro = resolveCBSA(city); if (metro) break; }
    }

    const d = metro ? await _fetchMetroData(metro, capRate) : await _fetchNationalData(capRate);
    const score     = metro ? computeScore(d) : null;
    const narrative = genNarrative(d, opts.offeringName, propType);
    const scoreColor = score !== null ? (score >= 65 ? '#1A7A4A' : score >= 45 ? '#B45309' : '#DC2626') : '#94A3B8';
    const circ   = 2 * Math.PI * 30;
    const offset = score !== null ? circ * (1 - score / 100) : circ;
    const fP = (v, dec = 2) => v != null ? v.toFixed(dec) + '%' : '—';
    const fM = (v) => v ? '$' + v.toLocaleString() : '—';

    const metroLabel = resolved.type === 'national'
      ? `Diversified National (${(resolved.states || []).join(', ') || 'Multi-State'})`
      : resolved.type === 'multi'
      ? `Multi-Market: ${resolved.cities.join(' & ')}`
      : (metro ? metro.name : 'Market');

    const scoreTags = [];
    if (score === null) {
      scoreTags.push('<span class="miw-tag neu">🌐 Diversified National</span>');
    } else {
      if (score >= 65) scoreTags.push('<span class="miw-tag pos">Strong Market</span>');
      else if (score >= 45) scoreTags.push('<span class="miw-tag neu">Moderate</span>');
      else scoreTags.push('<span class="miw-tag neg">Caution</span>');
      if (d.unempLocal !== null && d.unempNat !== null) {
        scoreTags.push(d.unempLocal < d.unempNat ? '<span class="miw-tag pos">Low Unemployment</span>' : '<span class="miw-tag neg">High Unemployment</span>');
      }
      if (d.hpiGrowth !== null) {
        scoreTags.push(d.hpiGrowth > 0 ? '<span class="miw-tag pos">Price Growth</span>' : '<span class="miw-tag neg">Price Decline</span>');
      }
    }

    const spreadHtml = d.capRateSpread !== null ? `
      <div class="miw-spread">
        <h4>📐 Cap Rate Spread Analysis</h4>
        <div class="miw-spread-bar"><div class="miw-spread-fill" style="width:${Math.min(100, Math.max(10, d.capRateSpread / 4))}%"></div></div>
        <div class="miw-spread-labels"><span>Compressed (0bps)</span><span>${d.capRateSpread}bps</span><span>Wide (400bps)</span></div>
      </div>` : '';

    container.innerHTML = `
    <div class="miw">
      <div class="miw-header">
        <h3>✦ Market Intelligence — ${metroLabel} ${_cap(propType)}</h3>
        <span class="miw-live">● Live</span>
      </div>
      <div class="miw-body">
        <div class="miw-score-row">
          <div class="miw-score-ring">
            <svg viewBox="0 0 72 72">
              <circle class="trk" cx="36" cy="36" r="30"/>
              <circle class="fl" cx="36" cy="36" r="30" stroke="${scoreColor}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
            </svg>
            <span class="miw-score-num">${score !== null ? score : '—'}</span>
            <span class="miw-score-lbl">Score</span>
          </div>
          <div class="miw-score-meta">
            <div class="title">${score !== null ? 'Market Health Score' : 'National Macro Indicators'}</div>
            <div class="sub">${resolved.type === 'national' ? 'No specific metro — national indicators shown' : resolved.type === 'multi' ? `Multi-market offering · primary metro (${metro ? metro.name : '—'}) displayed` : 'Composite of economic indicators'}</div>
            <div class="miw-tags">${scoreTags.join('')}</div>
          </div>
        </div>

        <div class="miw-metrics">
          <div class="miw-mr"><span class="miw-ml">10-Year Treasury</span><span class="miw-mv">${fP(d.treasury10)}</span></div>
          <div class="miw-mr"><span class="miw-ml">30-Year Mortgage</span><span class="miw-mv">${fP(d.mortgage30)}</span></div>
          <div class="miw-mr"><span class="miw-ml">Fed Funds Rate</span><span class="miw-mv">${fP(d.fedFunds)}</span></div>
          <div class="miw-mr"><span class="miw-ml">CRE Loan Delinquency</span><span class="miw-mv">${fP(d.creDelinq)}</span></div>
          <div class="miw-mr">
            <span class="miw-ml">${metro ? metro.name + ' Unemployment' : 'National Unemployment'}</span>
            <span class="miw-mv">
              ${fP(d.unempLocal !== null ? d.unempLocal : d.unempNat, 1)}
              ${d.unempLocal !== null && d.unempNat !== null
                ? (d.unempLocal < d.unempNat
                  ? ` <span class="miw-delta up">vs ${d.unempNat.toFixed(1)}% nat'l</span>`
                  : ` <span class="miw-delta dn">vs ${d.unempNat.toFixed(1)}% nat'l</span>`)
                : ''}
            </span>
          </div>
          <div class="miw-mr"><span class="miw-ml">Home Price Growth (YoY)</span><span class="miw-mv">${d.hpiGrowth !== null ? (d.hpiGrowth > 0 ? '+' : '') + d.hpiGrowth.toFixed(1) + '%' : '—'}</span></div>
          <div class="miw-mr"><span class="miw-ml">State Median Income</span><span class="miw-mv">${fM(d.medianIncome)}</span></div>
          <div class="miw-mr"><span class="miw-ml">Housing Vacancy Rate</span><span class="miw-mv">${fP(d.vacancyRate, 1)}</span></div>
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

    return { score, narrative, data: d };
  }

  // ═══════════════════════════════════════════════════════════
  //  renderFromOffering  — auto-detect from AFL offering object
  // ═══════════════════════════════════════════════════════════

  async function renderFromOffering(containerId, offering) {
    const location = offering.location || offering.city || offering.state || '';
    const propType = offering.propertyType || offering.assetType || offering.sector || offering.assetClass || 'multifamily';
    const capRate  = offering.capRate || offering.y1coc || null;
    return renderCompact(containerId, {
      location,
      propertyType: propType,
      offeringName: offering.name || offering.offeringName || '',
      capRate,
      y1coc: offering.y1coc || null,
      ltv: offering.ltv || null
    });
  }

  // ── Helpers ──
  function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function _buildTags(d, score) {
    const tags = [];
    if (score >= 65) tags.push('<span class="ct pos">Strong Market</span>');
    else if (score >= 45) tags.push('<span class="ct neu">Near Average</span>');
    else tags.push('<span class="ct neg">Caution</span>');
    if (d.unempLocal !== null && d.unempNat !== null) {
      tags.push(d.unempLocal < d.unempNat ? '<span class="ct pos">Low Unemployment</span>' : '<span class="ct neg">High Unemployment</span>');
    }
    if (d.hpiGrowth !== null) {
      tags.push(d.hpiGrowth > 0 ? '<span class="ct pos">Price Growth</span>' : '<span class="ct neg">Price Decline</span>');
    }
    if (d.capRateSpread !== null) {
      tags.push(d.capRateSpread > 150 ? '<span class="ct pos">Wide Spread</span>' : d.capRateSpread > 50 ? '<span class="ct neu">Adequate Spread</span>' : '<span class="ct neg">Tight Spread</span>');
    }
    return tags.join('');
  }

  // ─── EXPORT ───
  window.MarketIntelWidget = {
    render,
    renderCompact,
    renderFromOffering,
    resolveCBSA,
    resolveLocationType,
    normalizePropertyType
  };

})();
