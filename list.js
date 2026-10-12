/* ==== HBU Crypto — Demo hesap listesi ==== */
'use strict';

let accounts = [];
let pendingDelete = null;
const MAX_ACCOUNTS = 5;
let listPrices = {};

/* Acik pozisyonun anlik net P&L'i (sunucuyla ayni formul) */
function unrealized(a, price) {
  if (!a.pos_dir || !a.pos_entry || !price) return 0;
  const sign = a.pos_dir === 'LONG' ? 1 : -1;
  const gross = (price - Number(a.pos_entry)) * Number(a.pos_qty) * sign;
  const exitFee = price * Number(a.pos_qty) * 0.00055;
  return gross - Number(a.pos_fees || 0) - exitFee + Number(a.pos_funding || 0);
}

async function fetchTicker(coin) {
  const t = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + coin + 'USDT').then(r => r.json());
  return t.result.list[0];
}

async function fetchListPrices() {
  const coins = [...new Set(accounts.filter(a => a.pos_dir).map(a => a.coin))];
  await Promise.all(coins.map(async c => {
    try { listPrices[c] = parseFloat((await fetchTicker(c)).lastPrice); } catch (e) { /* atla */ }
  }));
}

async function loadAccounts() {
  const { data, error } = await db.from('accounts').select('*').eq('kind', 'demo').order('created_at', { ascending: true });
  if (error) { toast(error.message, true); return; }
  accounts = data || [];
  await fetchListPrices();
  renderList();
}

function renderList() {
  const list = $('accList');
  if (!accounts.length) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-dim)">No demo accounts yet. Tap + to create one.</div>';
    return;
  }
  list.innerHTML = accounts.map((a, i) => {
    const shown = Number(a.balance) + unrealized(a, listPrices[a.coin]);
    const total = shown - Number(a.start_balance || a.balance);
    const up = total >= 0;
    const posTag = a.pos_dir
      ? `<span class="pos-tag ${a.pos_dir === 'LONG' ? 'long' : 'short'}">${esc(a.pos_dir)}</span>` : '';
    const runTag = a.bot_running ? `<span class="run-dot"></span>` : '';
    return `
    <div class="swipe-wrap">
      <button class="del-btn" data-del="${i}">🗑️</button>
      <div class="acc-card" data-i="${i}">
        <div>
          <div class="acc-name">${runTag}${esc(a.name)}${posTag}</div>
          <div class="acc-balance">$${fmt(shown)}</div>
          <div style="font-size:12px;font-weight:700;margin-top:2px;color:${up ? 'var(--green)' : 'var(--red)'}">${signed(total)}</div>
        </div>
        <div class="acc-tag">${a.bot_mode === 'safe' && a.bot_running ? 'EMA' : 'DEMO'}</div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.acc-card').forEach(bindSwipe);
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    pendingDelete = accounts[+b.dataset.del];
    $('confirmModal').classList.add('open');
  }));
}

/* Sola kaydirma = sil, dokunma = ac */
function bindSwipe(card) {
  let startX = 0, dx = 0, isOpen = false, moved = false, touched = false;
  card.addEventListener('touchstart', e => { touched = true; startX = e.touches[0].clientX; moved = false; }, { passive: true });
  card.addEventListener('touchmove', e => {
    moved = true;
    dx = e.touches[0].clientX - startX + (isOpen ? -72 : 0);
    dx = Math.min(0, Math.max(dx, -90));
    card.style.transform = 'translateX(' + dx + 'px)';
    card.classList.toggle('danger', dx < -36);
  }, { passive: true });
  card.addEventListener('touchend', () => {
    if (!moved && !isOpen) { openAccount(+card.dataset.i); return; }
    isOpen = dx < -36;
    card.style.transform = isOpen ? 'translateX(-72px)' : '';
    card.classList.toggle('danger', isOpen);
    dx = isOpen ? -72 : 0;
  });
  // dokunmatik olmayan ekranlar icin
  card.addEventListener('click', () => { if (!touched) openAccount(+card.dataset.i); });
}

Object.assign(ACTIONS, {
  async openDemo() { show('demo'); await loadAccounts(); },
  openSheet() {
    if (accounts.length >= MAX_ACCOUNTS) { $('limitModal').classList.add('open'); return; }
    $('inpName').value = ''; $('inpBalance').value = '';
    $('inpName').placeholder = 'Demo ' + (accounts.length + 1);
    $('sheetOverlay').classList.add('open');
  },
  async createAccount() {
    const name = $('inpName').value.trim() || ('Demo ' + (accounts.length + 1));
    const balance = parseFloat($('inpBalance').value) || 1000;
    await api('create_demo', { name, balance });
    $('sheetOverlay').classList.remove('open');
    await loadAccounts();
  },
  confirmDeleteNo() { pendingDelete = null; $('confirmModal').classList.remove('open'); renderList(); },
  async confirmDeleteYes() {
    $('confirmModal').classList.remove('open');
    const a = pendingDelete; pendingDelete = null;
    if (a) { await api('delete_demo', { id: a.id }); toast('Account deleted'); }
    await loadAccounts();
  },
});
