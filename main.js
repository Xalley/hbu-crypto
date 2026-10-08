/* ==== HBU Crypto — cekirdek: oturum, 2FA, ekranlar, sunucu cagrisi ==== */
'use strict';

// Baska bir sitenin icine (iframe) gomulmeyi engelle
if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed'); }

const db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.PUBLIC_KEY, {
  auth: {
    storage: window.sessionStorage,   // sekme kapaninca oturum silinir
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const ACTIONS = {};          // data-act="isim" -> fonksiyon
let mfaFactorId = null;

/* ---------- Yardimcilar ---------- */
function $(id) { return document.getElementById(id); }
function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}
function fmt(n, d = 2) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
}
function money(n, d = 2) { const x = Number(n); return (x < 0 ? '-$' : '$') + fmt(Math.abs(x), d); }
function signed(n) { const x = Number(n); return (x >= 0 ? '+$' : '-$') + fmt(Math.abs(x)); }
function pxDigits(p) { return p >= 1000 ? 2 : p >= 10 ? 2 : 4; }

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 6000 : 3000);
}

/* ---------- Ekranlar ---------- */
const PROTECTED = new Set(['welcome', 'investSelect', 'demo', 'account', 'history', 'live', 'apiPage']);
let authed = false;
function show(id) {
  if (PROTECTED.has(id) && !authed) id = 'login';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}
function closeModals() { document.querySelectorAll('.modal-wrap.open, .overlay.open').forEach(m => m.classList.remove('open')); }

/* ---------- Tiklama yonlendirme (inline JS yok -> CSP siki) ---------- */
// Veri degistiren islemler ayni anda tek calisir (cift tiklama / cift emir engeli)
const LOCKING = new Set(['login', 'mfaVerify', 'mfaEnrollVerify', 'createAccount', 'confirmDeleteYes',
  'toggleBot', 'toggleSafeBot', 'lToggleBot', 'lToggleSafeBot', 'renewApi']);
let busy = false;
document.addEventListener('click', async (ev) => {
  const dis = ev.target.closest('[data-dismiss]');
  if (dis && ev.target === dis) { dis.classList.remove('open'); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const name = el.dataset.act, fn = ACTIONS[name];
  if (!fn) return;
  const locking = LOCKING.has(name);
  if (locking && busy) return;
  if (locking) busy = true;
  el.disabled = true;
  try { await fn(el, ev); }
  catch (e) { toast(e.message || 'Error', true); }
  finally { if (locking) busy = false; el.disabled = false; }
});

/* ---------- Sunucu cagrisi (tek yazma kapisi) ---------- */
async function api(action, payload = {}) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { await forceLogout(); throw new Error('Session expired'); }
  let r;
  try {
    r = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/bot-control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': CONFIG.PUBLIC_KEY,
      },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) { throw new Error('Connection error'); }
  const j = await r.json().catch(() => ({ error: 'Bad response' }));
  if (r.status === 401) { await forceLogout(); throw new Error('Session expired'); }
  if (j.error === 'mfa_required') { await routeAfterLogin(); throw new Error('2-step verification required'); }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

/* ---------- Oturum + 2FA ---------- */
async function routeAfterLogin() {
  const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) { await forceLogout(); return; }
  if (data.currentLevel === 'aal2') {
    authed = true;
    startIdleWatch();
    show('welcome');
    return;
  }
  authed = false;
  const { data: f } = await db.auth.mfa.listFactors();
  const verified = (f?.totp || []).filter(x => x.status === 'verified');
  if (verified.length) {
    mfaFactorId = verified[0].id;
    $('mfaCode').value = ''; $('mfaErr').textContent = '';
    show('mfaChallenge');
    setTimeout(() => $('mfaCode').focus(), 50);
  } else {
    await startEnroll();
  }
}

async function startEnroll() {
  // yarim kalmis (dogrulanmamis) kayitlari temizle
  const { data: f } = await db.auth.mfa.listFactors();
  for (const x of (f?.all || []).filter(x => x.status !== 'verified')) {
    await db.auth.mfa.unenroll({ factorId: x.id });
  }
  const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HBU ' + Date.now() });
  if (error) { toast(error.message, true); return; }
  mfaFactorId = data.id;
  $('mfaQr').src = data.totp.qr_code;
  $('mfaSecret').textContent = data.totp.secret;
  $('mfaEnrollCode').value = ''; $('mfaEnrollErr').textContent = '';
  show('mfaEnroll');
}

async function verifyCode(inputId, errId) {
  const code = $(inputId).value.trim();
  if (!/^\d{6}$/.test(code)) { $(errId).textContent = 'Enter the 6-digit code'; return; }
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code });
  if (error) { $(errId).textContent = 'Invalid code'; return; }
  await routeAfterLogin();
}

async function forceLogout() {
  authed = false;
  stopIdleWatch();
  try { await db.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
  try { sessionStorage.clear(); } catch (e) { /* */ }
  if (typeof resetAppState === 'function') resetAppState();
  $('loginPass').value = '';
  show('login');
}

/* ---------- Hareketsizlikte otomatik cikis ---------- */
let lastActive = Date.now(), idleTimer = null;
['click', 'touchstart', 'keydown'].forEach(e =>
  document.addEventListener(e, () => { lastActive = Date.now(); }, { passive: true }));
function startIdleWatch() {
  lastActive = Date.now();
  stopIdleWatch();
  idleTimer = setInterval(() => {
    if (Date.now() - lastActive > CONFIG.IDLE_LOGOUT_MIN * 60_000) { forceLogout(); toast('Logged out (inactive)'); }
  }, 30_000);
}
function stopIdleWatch() { if (idleTimer) clearInterval(idleTimer); idleTimer = null; }

db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && authed) { authed = false; show('login'); }
});

/* ---------- Asagi cekip yenileme (ortak) ---------- */
function bindPullToRefresh(scrollId, ptrId, fn) {
  const sc = $(scrollId), ptr = $(ptrId);
  if (!sc || !ptr) return;
  let startY = 0, pulling = false;
  sc.addEventListener('touchstart', e => {
    if (sc.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  sc.addEventListener('touchmove', e => {
    if (!pulling) return;
    ptr.classList.toggle('show', e.touches[0].clientY - startY > 40);
  }, { passive: true });
  sc.addEventListener('touchend', async () => {
    if (ptr.classList.contains('show')) {
      ptr.classList.add('spin'); ptr.textContent = '↻';
      try { await fn(); } catch (e) { toast(e.message, true); }
      ptr.classList.remove('show', 'spin'); ptr.textContent = '↓';
    }
    pulling = false;
  });
}

/* ---------- Aksiyonlar ---------- */
Object.assign(ACTIONS, {
  async login() {
    const email = $('loginEmail').value.trim(), password = $('loginPass').value;
    $('loginErr').textContent = '';
    if (!email || !password) { $('loginErr').textContent = 'Enter email and password'; return; }
    const { error } = await db.auth.signInWithPassword({ email, password });
    $('loginPass').value = '';
    if (error) { $('loginErr').textContent = 'Sign in failed'; return; }
    await routeAfterLogin();
  },
  mfaVerify: () => verifyCode('mfaCode', 'mfaErr'),
  mfaEnrollVerify: () => verifyCode('mfaEnrollCode', 'mfaEnrollErr'),
  logout: () => forceLogout(),
  goWelcome: () => show('welcome'),
  openInvestment: () => show('investSelect'),
  closeModals,
});

// Enter tusu ile giris
['loginPass', 'mfaCode', 'mfaEnrollCode'].forEach(id => $(id).addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const btn = $(id).closest('.screen').querySelector('[data-act="login"],[data-act="mfaVerify"],[data-act="mfaEnrollVerify"]');
  if (btn) btn.click();
}));

/* ---------- Acilis ---------- */
(async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (session) await routeAfterLogin(); else show('login');
})();
