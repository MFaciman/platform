// ============================================================
// AFL Platform — Auth Gate
// ============================================================
// Add this script to any page that requires authentication.
// It checks if the user is logged in and approved.
// If not, redirects to login.html.
//
// USAGE: Add this to the <head> of index.html (or any protected page):
//   <script type="module" src="js/auth-gate.js"></script>
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp, increment } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyC8RQmPNlOlZpDhIKqHL5UkpBtTSMEGQs8",
    authDomain: "alts-fund-link.firebaseapp.com",
    projectId: "alts-fund-link",
    storageBucket: "alts-fund-link.firebasestorage.app",
    messagingSenderId: "1025925507856",
    appId: "1:1025925507856:web:0f596a9c94704146379395"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Show nothing until auth check completes
document.documentElement.style.visibility = 'hidden';

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // Not logged in — redirect to login
        window.location.href = 'login.html';
        return;
    }

    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        if (!userDoc.exists()) {
            window.location.href = 'login.html';
            return;
        }

        const data = userDoc.data();

        if (data.status === 'pending') {
            window.location.href = 'login.html';
            return;
        }

        if (data.status === 'suspended' || data.status === 'rejected') {
            window.location.href = 'login.html';
            return;
        }

        // User is authenticated and approved — show the page
        document.documentElement.style.visibility = 'visible';

        // Update last login timestamp
        await updateDoc(doc(db, 'users', user.uid), {
            'meta.lastLogin': serverTimestamp(),
            'meta.loginCount': increment(1)
        }).catch(() => {});

        // Make user info available globally for other modules
        window.aflUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || data.displayName,
            role: data.role,
            firmName: data.firmName,
            bdAffiliation: data.bdAffiliation || '',
            status: data.status
        };

        // Dispatch event so other modules know auth is ready
        window.dispatchEvent(new CustomEvent('afl-auth-ready', {
            detail: window.aflUser
        }));

    } catch (error) {
        console.error('Auth gate error:', error);
        window.location.href = 'login.html';
    }
});
