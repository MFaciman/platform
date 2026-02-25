# AFL Platform — Master Build Specification
**Alts Fund Link | Alternative Asset Diligence Intelligence**
**Last Updated:** 2026-02-25 | **Version:** 1.0

---

## 🚨 HOW TO USE THIS DOCUMENT (READ FIRST)

This is the master reference for every Claude chat building the AFL platform.
At the start of any new chat, say:
> "I'm building [filename] for the AFL platform. Read this spec first."
Then paste the raw GitHub URL of this file.

This document contains everything needed to build any module without context from prior chats.

---

## 1. Project Overview

**Product:** Alts Fund Link (AFL) — a DST and alternative investment intelligence platform
**Owner:** Big Mike (mike@altsfundlink.com)
**Users:** Broker-dealer representatives and financial advisors
**Business model:** 12 sponsors paying $1,000/month; 21 active offerings; 1 approved BD

**What the platform does:**
- Displays 60+ data points per DST/alternative offering pulled from Google Sheets
- Lets advisors filter, compare, and analyze offerings
- Scores offerings against a client's suitability profile
- Generates tear sheets and portfolio views
- Links to sponsor documents (PPM, brochure, track record, video, AI chat)

**Access flow:**
1. Broker logs into AltsFundLink.com (Wix — brand/marketing site)
2. Wix has a button/link pointing to `https://mfaciman.github.io/platform/`
3. Platform runs entirely on GitHub Pages (no backend, no server)

---

## 2. Architecture

### Pattern: Fetch/Inject SPA on GitHub Pages

```
mfaciman.github.io/platform/
├── index.html        ← Shell: header, sidebar, router (~200 lines)
├── shared.js         ← Shared library: data, state, utilities (~400 lines)
├── browse.html       ← Module: Offering marketplace/grid
├── offering.html     ← Module: Single + portfolio detail view
├── builder.html      ← Module: DST Portfolio Builder
├── model.html        ← Module: 1031 Calculator / Client Modeler
├── client.html       ← Module: Client profile + suitability
├── sponsor.html      ← Module: Sponsor profile pages
└── AFL_PLATFORM_SPEC.md  ← This file
```

### How routing works
The shell (`index.html`) fetches module HTML files on demand, strips their `<head>`, injects `<style>` blocks + `<body>` into `#app-content`. Each module exports an `init(params)` function the shell calls after injection. State is shared via `localStorage` and the global `AFL` object on `window`.

### Shell → Module communication
```javascript
// Shell calls after injecting module:
window.currentModule.init({ client: AFL.state.client, basket: AFL.state.basket })

// Module signals shell to update header:
window.parent.AFL.updateHeader({ basketCount: 3, clientName: 'John Davidson' })
// OR since same-page (not iframe):
AFL.updateHeader({ basketCount: 3, clientName: 'John Davidson' })
```

### Why not iframes
Fetch/inject chosen over iframes to avoid cross-frame postMessage complexity and iframe scroll quirks. All modules run in the same page context, sharing `window.AFL` directly.

---

## 3. Brand & Design System

### Logo
- File: `AFL_Logo.PNG` (in repo)
- Treatment: "The Alternative Asset FundLINK Diligence Intelligence." in blue on dark/black
- In header: Use text treatment `AFL` logomark + "Alts Fund Link" wordmark (white on navy)

### Color Tokens (use these exact CSS variables everywhere)
```css
:root {
  --navy:    #0B1F3B;   /* primary dark — headers, hero */
  --navy2:   #1C3A63;   /* secondary dark — KPI strip, accents */
  --navy3:   #2A4D7A;   /* tertiary */
  --slate:   #3A5270;   /* body text dark */
  --slate2:  #5C7A99;   /* secondary text */
  --fog:     #8FA3BA;   /* muted text, labels */
  --mist:    #C8D8E8;   /* borders, dividers */
  --ice:     #E8F0F8;   /* light backgrounds */
  --white:   #FFFFFF;
  --surface: #F4F7FB;   /* page background */
  --surface2:#EEF3FA;   /* action bar bg */
  --green:   #1A7A4A;
  --green-lt:#E8F7EF;
  --amber:   #B45309;
  --amber-lt:#FEF3C7;
  --red:     #991B1B;
  --red-lt:  #FEE2E2;
  --blue:    #1D4ED8;
  --blue-lt: #EFF6FF;
  --radius:  8px;
  --radius-lg: 14px;
  --shadow-sm: 0 1px 3px rgba(11,31,59,0.08), 0 1px 2px rgba(11,31,59,0.05);
  --shadow:    0 4px 12px rgba(11,31,59,0.10);
  --shadow-lg: 0 12px 32px rgba(11,31,59,0.14);
  --font: 'DM Sans', sans-serif;
  --transition: 0.18s cubic-bezier(0.4,0,0.2,1);
}
```

### Typography
- Font: `DM Sans` (Google Fonts) — weights 300, 400, 500, 600, 700, 800
- Mono: `DM Mono` for data values where needed
- Load: `https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Mono:wght@400;500&display=swap`

### Layout
- Header height: 60px, `background: var(--navy)`
- Sidebar width: 218px, `background: #fff`, `border-right: 1px solid var(--mist)`
- Main content: `flex:1`, `overflow-y:auto`, `background: var(--surface)`
- Full viewport: `height: 100vh`, no page scroll — inner panels scroll

---

## 4. Google Sheets Data Source

### Sheet URL pattern
```javascript
const SHEET_ID = '1xVFw8pFrJzcxD8CH7ainimPKD6GW9tn1bb8ggHYUfRs';;
const SHEET_NAME = 'Sheet1'; // CONFIRMED
const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;
```

### Column Headers → JS Field Mapping

| Google Sheet Column | JS Field Name | Type | Notes |
|---------------------|---------------|------|-------|
| Sponsor | `sponsor` | string | |
| Offering Name | `name` | string | |
| Asset Class | `assetClass` | string | DST, QOZ, etc. |
| Sector | `sector` | string | Industrial, Multifamily, etc. |
| Focus | `focus` | string | Sub-sector detail |
| Filed Raise | `filedRaise` | number | dollars |
| Current Raise | `currentRaise` | number | dollars raised to date |
| Remaining Raise | `equityRemaining` | number | dollars |
| Offering Open | `offeringOpen` | string | date string |
| Offering Close | `offeringClose` | string | date string |
| Offering Structure | `offeringStructure` | string | |
| Year 1 Cash on Cash Distribution | `y1coc` | number | percent e.g. 5.25 |
| Frequency | `distFrequency` | string | Monthly, Quarterly |
| Loan to Value | `ltv` | number | percent |
| Preferred | `preferred` | number | percent |
| Promote | `promote` | string | |
| 721 UpREIT | `upReit` | boolean/string | |
| Exemption | `exemption` | string | Reg D 506b/c etc. |
| Tax Reporting | `taxReporting` | string | K-1 etc. |
| Hold Period | `holdPeriod` | number | years |
| Minimum - DST | `minInvest` | number | dollars |
| # Assets | `numAssets` | number | |
| Property Location(s) | `location` | string | "TX, OH, IN, GA" |
| Building Age | `buildingAge` | string | |
| (Avg)% Leased | `occupancy` | number | percent |
| Debt Terms | `debtTerms` | string | |
| DSCR | `dscr` | number | |
| Lease Terms | `leaseTerms` | string | |
| Total Square Footage | `sqft` | number | |
| Tenant Credit Quality | `tenantCredit` | string | |
| Rent Escalations | `rentEscalations` | string | |
| Average Lease Term Remaining | `avgLeaseTerm` | number | years |
| GP Commit | `gpCommit` | string | |
| Purchase Price (Unloaded) | `purchasePrice` | number | dollars |
| Appraised Valuation | `appraisedValue` | number | dollars |
| Loaded Price | `loadedPrice` | number | dollars |
| Acquisition Cap Rate | `capRate` | number | percent |
| Rep Comp | `repComp` | number | percent |
| Sales Load | `salesLoad` | number | percent |
| Reserve | `reserve` | string | |
| Year 1 | `income[0]` | number | percent CoC |
| Year 2 | `income[1]` | number | percent CoC |
| Year 3 | `income[2]` | number | percent CoC |
| Year 4 | `income[3]` | number | percent CoC |
| Year 5 | `income[4]` | number | percent CoC |
| Year 6 | `income[5]` | number | percent CoC |
| Year 7 | `income[6]` | number | percent CoC |
| Year 8 | `income[7]` | number | percent CoC |
| Year 9 | `income[8]` | number | percent CoC |
| Year 10 | `income[9]` | number | percent CoC |
| Sponsor AUM | `sponsorAum` | string | e.g. "$2.4B" |
| Number of Sponsor Offerings | `sponsorOfferings` | number | |
| Sponsor Full Cycle Exits | `sponsorExits` | number | |
| Sponsor Average IRR | `sponsorAvgIrr` | number | percent |
| Sponsor Best IRR | `sponsorBestIrr` | number | percent |
| Sponsor Worst IRR | `sponsorWorstIrr` | number | percent |
| Sponsor Experience | `sponsorExperience` | string | e.g. "Est. 1987" |
| Brochure | `brochureUrl` | string | URL |
| PPM | `ppmUrl` | string | URL |
| Track Record | `trackRecordUrl` | string | URL |
| Sales Team Map | `salesTeamUrl` | string | URL |
| Video | `videoUrl` | string | URL |
| Sponsor News | `sponsorNewsUrl` | string | URL |
| AI Offering Chat | `aiChatUrl` | string | URL |
| Quarterly Update URL | `quarterlyUpdateUrl` | string | URL |
| Sponsor Logo URL | `sponsorLogoUrl` | string | URL |

### Computed/derived fields (not in sheet, calculated in shared.js)
```javascript
fund.id              // row index (1-based)
fund.status          // "Open" | "Closing Soon" | "Closed" — derived from offeringClose date
fund.pctRemaining    // (equityRemaining / filedRaise) * 100
fund.raiseVelocity   // currentRaise / months since offeringOpen (if calculable)
fund.propType        // alias for sector (used in UI)
fund.displayLabel    // short display name for breadcrumbs
```

---

## 5. Shared State (localStorage keys)

```javascript
// Key: 'afl_basket'  — Value: JSON array of offering IDs (max 3)
// Example: [1, 4, 7]
AFL.state.basket = []

// Key: 'afl_client'  — Value: JSON object
AFL.state.client = {
  name: '',              // string
  exchangeAmount: null,  // number, dollars
  riskTolerance: '',     // 'Conservative' | 'Moderate' | 'Aggressive'
  propTypes: [],         // array of strings matching sector values
  horizon: null,         // number, years
  age: null,             // number
  accredited: true,      // boolean
  notes: ''              // string
}

// Key: 'afl_nav'     — Value: string, current active module
AFL.state.nav = 'browse'  // 'browse' | 'offering' | 'builder' | 'model' | 'client' | 'sponsor'

// Key: 'afl_funds'   — Value: JSON array — cached sheet data (session only)
AFL.state.funds = []
```

---

## 6. shared.js API Reference

Every module loads `shared.js` which exposes `window.AFL`:

```javascript
// Data
AFL.state                    // live state object (reads/writes localStorage)
AFL.state.funds              // array of parsed fund objects
AFL.state.basket             // array of offering IDs
AFL.state.client             // client profile object

// Data loading
await AFL.loadFunds()        // fetches Google Sheets, parses, stores in AFL.state.funds

// Utilities
AFL.isNum(v)                 // true if v is a finite number
AFL.fmt.pct(v, d=2)         // "5.25%" or "—"
AFL.fmt.money(v)             // "$2.4M" | "$380K" | "$100"
AFL.fmt.date(s)              // formatted date string
AFL.escapeHTML(s)            // XSS-safe string

// State helpers  
AFL.basket.add(id)           // add offering id to basket (max 3)
AFL.basket.remove(id)        // remove from basket
AFL.basket.has(id)           // boolean
AFL.basket.get()             // array of fund objects (not just IDs)
AFL.basket.save()            // persist to localStorage

// Suitability scoring
AFL.suitScore(fund, client)  // returns 0-100 integer score

// Peer stats
AFL.peerStats(funds)         // returns averages object for all loaded funds

// Navigation
AFL.navigate(module, params) // e.g. AFL.navigate('offering', {ids: [1,2,3]})

// Header update (called by modules to sync header UI)
AFL.updateHeader()           // re-renders basket count, client name in shell header

// State extraction helpers
AFL.extractStates(locationStr) // "TX, OH, IN, GA" → ['TX','OH','IN','GA']
```

---

## 7. Suitability Scoring Algorithm

Score is 0–100. Used in `AFL.suitScore(fund, client)`:

```
Base score: 50

+20  if fund.ltv <= 60 (or no LTV data: +0)
+15  if fund.minInvest <= client.exchangeAmount
+15  if fund.y1coc >= 4.0
+10  if client.propTypes includes fund.sector
+10  if fund.occupancy >= 90
-10  if fund.ltv > 65
-15  if fund.minInvest > client.exchangeAmount
-20  if fund.ltv > 75

Cap at 0 min, 100 max.
If client is null/empty: return null (don't show score)
```

---

## 8. Shell Layout Spec (index.html)

```
┌──────────────────────────────────────────────────────┐
│ HEADER (60px, navy)                                   │
│ [AFL logo] [nav: Advisor|Client Report|Compliance]    │
│ [21 offerings live ●] [client badge]                  │
└──────────────────────────────────────────────────────┘
┌──────────┬───────────────────────────────────────────┐
│ SIDEBAR  │  #app-content                             │
│ (218px)  │  ← module HTML injected here              │
│          │                                           │
│ Platform │                                           │
│ Dashboard│                                           │
│ Browse ●21                                           │
│ Basket  [n]                                          │
│ Portfolio│                                           │
│ Builder  │                                           │
│ Model    │                                           │
│          │                                           │
│ ──────── │                                           │
│ Settings │                                           │
└──────────┴───────────────────────────────────────────┘
```

### Header nav tabs (Advisor View / Client Report / Compliance)
These are view modes, not page routes. They affect how modules render:
- `Advisor View` — full data, all metrics
- `Client Report` — simplified, client-friendly language
- `Compliance View` — adds disclosure flags, suitability warnings

Store as `AFL.state.viewMode = 'advisor' | 'client' | 'compliance'`

---

## 9. Module Specs

### browse.html
**Purpose:** Marketplace grid of all 21 offerings
**Key features:**
- Card grid (default) and list/table toggle
- Filter panel: asset class, sector, status (Open/Closing/Closed), state, LTV range, CoC range
- Sort: Y1 CoC, LTV, % remaining, newest
- Search bar (name, sponsor, location)
- Each card: sponsor logo, offering name, status badge, key KPIs (LTV, CoC, occupancy), suitability chip if client set, Add to Basket button
- Basket indicator on cards already in basket
- Click card → `AFL.navigate('offering', {ids: [fund.id]})`

### offering.html
**Purpose:** Full tear sheet — single offering OR 2-3 offering portfolio comparison
**Key features:**
- Mode bar: Single Offering ↔ Portfolio View toggle
- Dark navy hero: sponsor logo(s), offering name, state map SVG, video panel, KPI strip
- DD icon row: Brochure, PPM, AI Chat, Raise, Sponsor News, Track Record, Sales Team, Video, Quarterly Update
- Action bar: Add to Basket, Build Portfolio, Share Tear Sheet, Model for Client + suitability chip
- Analyst zone: suitability panel, raise status, valuation, debt/lease, key drivers, distribution chart, projection table, AI narrative, sponsor section
- Portfolio mode: comparison table, blended KPIs, color-coded per offering (blue/purple/amber)

### builder.html
**Purpose:** DST Portfolio Builder — construct weighted DST allocation
**Key features:** (migrate existing builder from current index.html)

### model.html
**Purpose:** 1031 exchange calculator and client income modeler
**Key features:** (migrate existing model from current index.html)

### client.html
**Purpose:** Client profile setup and management
**Key features:**
- Form: name, exchange amount, risk tolerance, property type preferences, hold period, age
- Suitability scoring preview against current basket
- Save to localStorage

### sponsor.html
**Purpose:** Sponsor profile pages
**Key features:**
- Sponsor overview: AUM, # offerings, exits, IRR track record
- List of active offerings from that sponsor
- News feed (from sponsorNewsUrl)
- Contact / sales team

---

## 10. Build Status

| File | Status | Notes |
|------|--------|-------|
| `index.html` (shell) | ❌ Not started | Build first |
| `shared.js` | ❌ Not started | Build second |
| `browse.html` | ❌ Not started | Migrate from current platform |
| `offering.html` | ❌ Not started | Mockup exists — offering-detail-v2.html |
| `builder.html` | ❌ Not started | Migrate from current platform |
| `model.html` | ❌ Not started | Migrate from current platform |
| `client.html` | ❌ Not started | New build |
| `sponsor.html` | ❌ Not started | New build |
| `AFL_PLATFORM_SPEC.md` | ✅ Created | This file |

### Current working platform
- URL: `https://mfaciman.github.io/platform/`
- File: single `index.html` (~3,580 lines, ~293KB)
- Status: functional but monolithic — being migrated to module architecture
- Keep live during migration. New shell will deploy alongside, not replace, until stable.

---

## 11. Chat Handoff Protocol

At the end of every productive build chat, update this section:

### Last session: 2026-02-25
**What was done:**
- Designed module architecture (fetch/inject SPA)
- Created this spec document
- Built and integrated offering detail view CSS into existing index.html (offering-detail-v2.html mockup)
- Restored from backup after bad integration session

**What's next:**
- Build `index.html` shell + `shared.js` (Phase 0)
- Big Mike needs to provide Google Sheets ID before data loading works
- Confirm Sheet tab name

**Known issues / decisions:**
- Current monolithic index.html stays live during migration
- New shell goes to new URL or replaces once stable — TBD
- Logo PNG uploaded — use text treatment in header, not image (for performance)
- `Year 3` column in sheet has typo `ear 3` — handle both in parser

**Files in current repo:**
- `index.html` — monolithic current platform (working)
- `offering-detail-v2.html` — single/portfolio mockup (reference)
- `portfolio-view-mockup.html` — older portfolio mockup (reference)

---

## 12. Key Decisions Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-02-25 | Fetch/inject SPA over iframes | Simpler state sharing, no postMessage needed |
| 2026-02-25 | GitHub Pages only, no backend | Zero cost, fits existing setup |
| 2026-02-25 | DM Sans font | Matches existing mockup design |
| 2026-02-25 | localStorage for state | No auth backend; session persistence |
| 2026-02-25 | Max 3 offerings in basket | UX decision — comparison table gets unwieldy at 4+ |
| 2026-02-25 | Wix = marketing only | Platform runs on GitHub, Wix links to it |

---

## 13. Starting a New Chat — Copy/Paste Prompt

```
I'm building the AFL (Alts Fund Link) alternative investment platform.
Please read the master spec document at this URL first, then I'll tell 
you what to build:

https://raw.githubusercontent.com/mfaciman/platform/main/AFL_PLATFORM_SPEC.md

Today's task: build [FILENAME] as described in the spec.
The current working platform for reference is at:
https://mfaciman.github.io/platform/
```

**Replace [FILENAME] with the module you're building.**
If spec URL doesn't work, paste the raw markdown of this file directly into the chat.

---

*AFL Platform Spec v1.0 — maintained by Big Mike / mike@altsfundlink.com*
