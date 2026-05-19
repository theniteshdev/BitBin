let app, auth, db, storage;

/* ─── Initialize Firebase ─────────────────────────────────────────────────── */

function getFirebaseInstance() {
  if (app) return;

  // Prevent duplicate initialization
  if (!firebase.apps.length) {
    app = firebase.initializeApp({
      apiKey: '__FIREBASE_API_KEY__',
      authDomain: '__FIREBASE_AUTH_DOMAIN__',
      projectId: '__FIREBASE_PROJECT_ID__',
      storageBucket: '__FIREBASE_STORAGE_BUCKET__',
      messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
      appId: '__FIREBASE_APP_ID__',
      measurementId: '__FIREBASE_MEASUREMENT_ID__',
    });
  } else {
    app = firebase.app();
  }

  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
}

async function initFirebase() {
  try {
    const res = await fetch('/api/firebase-config');
    if (!res.ok) throw new Error('Failed to load config');
    const cfg = await res.json();

    if (!firebase.apps.length) {
      app = firebase.initializeApp(cfg);
    } else {
      app = firebase.app();
    }

    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();

    auth.onAuthStateChanged((user) => {
      if (user) {
        window.location.href = '/app';
      }
    });
  } catch (err) {
    console.error('Firebase init failed:', err);
    showErrors('signin-error', 'Failed to connect. Please refresh.');
    showErrors('signup-error', 'Failed to connect. Please refresh.');
  }
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function setLoading(formId, loading) {
  const btn = document.getElementById(`${formId}-btn`);
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  text.style.opacity = loading ? '0' : '1';
  loader.classList.toggle('hidden', !loading);
}

function showErrors(id, msg) {
  document.getElementById(id).textContent = msg;
}

function mapFirebaseError(err) {
  const code = err.code;
  const messages = {
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential': 'Invalid email or password.',
    'permission-denied': 'Access denied. Please check your connection.',
  };
  return messages[code] || err.message;
}

/* ─── Tab Switching ────────────────────────────────────────────────────────── */

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const forms = document.querySelectorAll('.auth-form');

  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'signup') {
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));
    document.querySelector('[data-tab="signup"]').classList.add('active');
    document.getElementById('signup-form').classList.add('active');
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
      showErrors('signin-error', '');
      showErrors('signup-error', '');
    });
  });
}

/* ─── Sign In ──────────────────────────────────────────────────────────────── */

function initSignIn() {
  document.getElementById('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErrors('signin-error', '');

    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;

    setLoading('signin', true);

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      showErrors('signin-error', mapFirebaseError(err));
    } finally {
      setLoading('signin', false);
    }
  });
}

/* ─── Sign Up ──────────────────────────────────────────────────────────────── */

function initSignUp() {
  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErrors('signup-error', '');

    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    if (password.length < 6) {
      showErrors('signup-error', 'Password must be at least 6 characters.');
      return;
    }

    if (!username || username.length < 2) {
      showErrors('signup-error', 'Username must be at least 2 characters.');
      return;
    }

    setLoading('signup', true);

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);

      // Create user profile in Firestore
      await db.collection('users').doc(cred.user.uid).set({
        username,
        email: email.toLowerCase(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        storageUsed: 0,
      });

      // onAuthStateChanged will redirect to /app
    } catch (err) {
      // If Firestore fails but auth succeeded, user is still created
      if (err.code && err.code.startsWith('auth/')) {
        showErrors('signup-error', mapFirebaseError(err));
      } else {
        // Auth succeeded but Firestore write failed - still redirect
        console.warn('User created but profile save failed:', err);
      }
    } finally {
      setLoading('signup', false);
    }
  });
}

/* ─── Terminal Animation ───────────────────────────────────────────────────── */

function initTerminal() {
  const body = document.getElementById('auth-terminal-body');
  const statusText = document.getElementById('terminal-status-text');
  if (!body) return;

  const sequences = {
    idle: [
      { text: 'bitbin status', type: 'command' },
      { text: 'Vault: Active | Encryption: AES-256', type: 'warn', delay: 400 },
      { text: 'Files stored: 1,247 | Total: 84.3 GB', type: 'info', delay: 300 },
      { text: 'Uptime: 99.97% | Last backup: 2m ago', type: 'dim', delay: 400 },
      { text: '', type: 'break', delay: 200 },
      { text: 'All systems operational.', type: 'success', delay: 300 },
    ],
    upload: [
      { text: 'bitbin upload --encrypt quarterly-report.pdf', type: 'command' },
      { text: 'Reading file: quarterly-report.pdf (4.2 MB)', type: 'info', delay: 400 },
      { text: 'Generating unique encryption key...', type: 'info', delay: 500 },
      { text: 'Encrypting with AES-256-CBC...', type: 'info', delay: 600 },
      { text: 'Hashing: SHA-256 checksum verified', type: 'info', delay: 400 },
      { text: 'Uploading encrypted blob [████████████████] 100%', type: 'success', delay: 800 },
      { text: '✓ File stored securely (ID: a7f3...e9d2)', type: 'success', delay: 400 },
      { text: '', type: 'break', delay: 200 },
      { text: 'Upload complete. Vault updated.', type: 'success', delay: 300 },
    ],
    sync: [
      { text: 'bitbin sync --devices', type: 'command' },
      { text: 'Scanning registered devices...', type: 'info', delay: 500 },
      { text: 'Found 3 devices: MacBook Pro, iPhone, iPad', type: 'info', delay: 600 },
      { text: 'Comparing vault states...', type: 'dim', delay: 400 },
      { text: 'Syncing 2 new files to MacBook Pro', type: 'info', delay: 500 },
      { text: '✓ Sync complete. All devices up to date.', type: 'success', delay: 600 },
    ],
    share: [
      { text: 'bitbin share design-spec.fig --expiry 7d', type: 'command' },
      { text: 'Generating secure share token...', type: 'info', delay: 400 },
      { text: 'Access level: view-only', type: 'dim', delay: 300 },
      { text: 'Expiry: 7 days from now', type: 'dim', delay: 300 },
      { text: '✓ Share link created: bb.sh/x7k9m', type: 'success', delay: 500 },
      { text: 'Link will expire automatically.', type: 'info', delay: 300 },
    ],
  };

  async function runSequence(seqName) {
    const lines = sequences[seqName];
    if (!lines) return;

    for (const line of lines) {
      if (line.type === 'break') {
        await delay(line.delay || 200);
        continue;
      }

      await delay(line.delay || 300);

      const lineEl = document.createElement('span');
      lineEl.className = `terminal-line terminal-${line.type}`;

      if (line.type === 'command') {
        lineEl.innerHTML = `<span class="prompt">$</span> `;
        body.appendChild(lineEl);

        for (const char of line.text) {
          lineEl.innerHTML += char;
          await delay(25 + Math.random() * 35);
          body.scrollTop = body.scrollHeight;
        }
      } else {
        lineEl.textContent = line.text;
        body.appendChild(lineEl);
        body.scrollTop = body.scrollHeight;
      }
    }

    const statuses = {
      idle: 'Monitoring',
      upload: 'Encrypting & storing',
      sync: 'Syncing devices',
      share: 'Managing shares',
    };
    if (statusText) statusText.textContent = statuses[seqName] || 'Active';
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function runLoop() {
    const seqs = ['idle', 'upload', 'idle', 'sync', 'idle', 'share'];

    for (const seq of seqs) {
      await runSequence(seq);
      await delay(2000);

      body.innerHTML = '<span class="prompt">$</span> <span class="cursor"></span>';
      await delay(600);
    }

    setTimeout(runLoop, 1000);
  }

  setTimeout(runLoop, 1500);
}

/* ─── Initialize ───────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initTabs();
  initSignIn();
  initSignUp();
  initTerminal();
});
