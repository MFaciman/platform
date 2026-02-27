/**
 * client-bridge.js — Bridges shell STATE.client ↔ shared.js AFL.state.client
 * 
 * INSTALL: Add this to index.html AFTER the shared.js script tag:
 *   <script src="shared.js"></script>
 *   <script src="client-bridge.js"></script>
 *
 * This script monkey-patches the shell's saveProfile() and clearProfile()
 * to also sync to shared.js / localStorage, so offering.html and browse.html
 * can read the client profile.
 */
(function() {
  'use strict';

  // Wait for DOM + shell to be ready
  window.addEventListener('DOMContentLoaded', function() {
    
    // --- 1. RESTORE: Load client from localStorage on startup ---
    if (window.AFL && window.AFL.client && window.AFL.client.isSet()) {
      const sc = window.AFL.state.client;
      if (sc && sc.name && window.STATE && !window.STATE.client.clientName) {
        window.STATE.client = Object.assign({}, window.STATE.client, {
          clientName:           sc.name || '',
          exchangeEquity:       sc.exchangeAmount || null,
          riskTolerance:        sc.riskTolerance || null,
          age:                  sc.age || null,
          assetClassPreference: Array.isArray(sc.propTypes) && sc.propTypes.length ? sc.propTypes[0] : '',
        });
        if (typeof window.updateClientBadge === 'function') {
          window.updateClientBadge();
        }
        console.log('[AFL Bridge] Restored client from localStorage:', sc.name);
      }
    }

    // --- 2. INTERCEPT: Patch saveProfile to also sync to shared.js ---
    const origSave = window.saveProfile;
    if (typeof origSave === 'function') {
      window.saveProfile = function() {
        origSave.apply(this, arguments);
        syncToShared();
      };
    }

    // --- 3. INTERCEPT: Patch clearProfile to also sync to shared.js ---
    const origClear = window.clearProfile;
    if (typeof origClear === 'function') {
      window.clearProfile = function() {
        origClear.apply(this, arguments);
        syncToShared();
      };
    }

    function syncToShared() {
      if (!window.AFL || !window.AFL.client || !window.STATE) return;
      const c = window.STATE.client;
      window.AFL.client.set({
        name:           c.clientName || '',
        exchangeAmount: c.exchangeEquity || null,
        riskTolerance:  c.riskTolerance || '',
        propTypes:      c.assetClassPreference ? [c.assetClassPreference] : [],
        horizon:        null,
        age:            c.age || null,
        accredited:     true,
        notes:          ''
      });
      console.log('[AFL Bridge] Synced client to shared.js:', c.clientName);
    }

    console.log('[AFL Bridge] Client bridge loaded');
  });
})();
