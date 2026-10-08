/* ==== HBU Crypto — Demo hesap detay ==== */
'use strict';

const COINS = ['BTC', 'ETH', 'BNB'];
let prices = {}, chg = {}, closesData = {};
let selCoin = 'BTC';
let curAcc = null;
let leverage = 1;

function smaLast(closes, n) {
  if (!closes || closes.length < n) return null;
  const arr = closes.slice(-n);
  return arr.reduce((a, b) => a + b, 0) / n;
}

function readMa() {
  const f = parseInt($('inpMaFast').value, 10), s = parseInt($('inpMaSlow').value, 10);
  return { f: f > 0 ? f : 9, s: s > 0 ? s : 30 };
}

async function fetchMarket() {
  const { s } = readMa();
  const need = Math.min(999, Math.max(s, 30, curAcc && curAcc.bot_running && curAcc.bot_mode === 'safe' ? 100 : 0));
  await Promise.all(COINS.map(async c => {
    try {
      const t = await fetchTicker(c);
      prices[c] = parseFloat(t.lastPrice);
      chg[c] = parseFloat(t.price24hPcnt) * 100;
    } catch (e) { /* eski deger kalir */ }
  }));
  try {
    const k = await fetch('https://api.bybit.com/v5/market/kline?category=linear&symbol=' + selCoin +
      'USDT&interval=60&limit=' + (need + 1)).then(r => r.json());
    closesData[selCoin] = k.result.list.slice(1).reverse().map(r => parseFloat(r[4])); // kapanmamis mum haric
  } catch (e) { /* */ }
}

async function reloadAccount() {
  if (!curAcc) return;
  const { data, error } = await db.from('accounts').select('*').eq('id', curAcc.id).single();
  if (error) throw new Error(error.message);
  curAcc = data;
}

async function openAccount(i) {
  curAcc = accounts[i];
  if (!curAcc) return;
  $('accTitle').textContent = curAcc.name;
  show('account');
  await reloadAccount();
  selCoin = curAcc.coin || 'BTC';
  setLev(curAcc.leverage || 1);
  const safe = curAcc.bot_mode === 'safe' && curAcc.bot_running;
  $('inpMaFast').value = safe ? 20 : (curAcc.ma_fast || 9);
  $('inpMaSlow').value = safe ? 100 : (curAcc.ma_slow || 30);
  $('inpAmount').value = curAcc.amount ?? '';
  $('inpSl').value = curAcc.sl_pct ?? '';
  $('inpTp').value = curAcc.tp_pct ?? '';
  await fetchMarket();
  updateUI();
}

function setLev(v) {
  leverage = v;
  document.querySelectorAll('#segLev .seg-btn').forEach(b => b.classList.toggle('active', +b.dataset.v === v));
}

function lockDemoSettings(locked) {
  ['inpMaFast', 'inpMaSlow', 'inpAmount', 'inpSl', 'inpTp'].forEach(id => { $(id).disabled = locked; });
  document.querySelectorAll('#segLev .seg-btn').forEach(b => { b.disabled = locked; });
  $('coinRow').style.opacity = locked ? '.45' : '1';
  $('coinRow').style.pointerEvents = locked ? 'none' : 'auto';
}

function stopTpPrices(a) {
  const e = Number(a.pos_entry), long = a.pos_dir === 'LONG';
  const sl = a.sl_pct ? e * (1 + (long ? -1 : 1) * a.sl_pct / 100) : null;
  const tp = a.tp_pct ? e * (1 + (long ? 1 : -1) * a.tp_pct / 100) : null;
  const tr = a.bot_mode === 'safe' && a.trail_stop != null ? Number(a.trail_stop) : null;
  let stop = sl;
  if (tr != null && (stop == null || (long ? tr > stop : tr < stop))) stop = tr;
  return { stop, tp };
}

function renderSafeRow(prefix, a) {
  const row = $(prefix + 'SafeRow');
  const ind = a.indicators;
  const on = a.bot_running && a.bot_mode === 'safe' && ind;
  row.hidden = !on;
  if (!on) return;
  $(prefix + 'Adx').textContent = Number.isFinite(ind.adx) ? ind.adx.toFixed(1) : '—';
  $(prefix + 'Chop').textContent = Number.isFinite(ind.chop) ? ind.chop.toFixed(1) : '—';
  const d = pxDigits(ind.close || 1);
  $(prefix + 'Trail').textContent = a.trail_stop != null ? '$' + fmt(a.trail_stop, d) : '—';
  const f = $(prefix + 'Filter');
  if (a.pos_dir) { f.textContent = 'IN POS'; f.className = 'signal ok'; }
  else if (a.armed) { f.textContent = ind.filters_ok ? 'READY' : 'ARMED'; f.className = 'signal ' + (ind.filters_ok ? 'ok' : 'no'); }
  else { f.textContent = 'WAIT'; f.className = 'signal no'; }
}

function botStatusText(a) {
  const safe = a.bot_mode === 'safe';
  if (!a.bot_running) return 'Bot Stopped';
  if (a.pos_dir) return safe ? 'Safe Bot Running' : 'Bot Running';
  if (safe) return a.armed ? 'Safe Bot — Armed' : 'Safe Bot — Waiting';
  return 'Waiting for Signal';
}

function renderBotMsg(el, a) {
  const m = a.status_msg || '';
  const bad = /^(HALTED|ERROR)/.test(m);
  el.textContent = (a.bot_running || bad) ? m : '';
  el.className = 'bot-msg' + (bad ? ' err' : '');
}

function updateUI() {
  if (!curAcc) return;
  const a = curAcc, running = a.bot_running, safe = a.bot_mode === 'safe';
  const price = prices[a.coin];
  const pnl = unrealized(a, price);

  COINS.forEach(c => { $('p' + c).textContent = prices[c] ? '$' + fmt(prices[c], 0) : '—'; });
  document.querySelectorAll('.coin').forEach(b => b.classList.toggle('active', b.dataset.c === selCoin));

  $('pairLabel').textContent = selCoin + '/USDT';
  $('dPrice').textContent = prices[selCoin] ? '$' + fmt(prices[selCoin], pxDigits(prices[selCoin])) : '—';
  const c = $('dChg');
  if (Number.isFinite(chg[selCoin])) {
    c.textContent = (chg[selCoin] >= 0 ? '+' : '') + chg[selCoin].toFixed(2) + '%';
    c.className = 'chg ' + (chg[selCoin] >= 0 ? 'up' : 'down');
  }

  // MA satiri: bot calisiyorsa SUNUCUNUN hesapladigi degerler, degilse yerel onizleme
  let fN, sN, fV, sV, sig;
  if (running && a.indicators) {
    const ind = a.indicators;
    fN = ind.fast; sN = ind.slow; fV = ind.sma_fast; sV = ind.sma_slow; sig = ind.trend;
  } else {
    const m = readMa();
    fN = m.f; sN = m.s; fV = smaLast(closesData[selCoin], fN); sV = smaLast(closesData[selCoin], sN);
    sig = fV && sV ? (fV >= sV ? 'LONG' : 'SHORT') : null;
  }
  $('dMaFastName').textContent = 'MA(' + fN + ')';
  $('dMaSlowName').textContent = 'MA(' + sN + ')';
  $('dMaFast').textContent = fV ? fmt(fV) : '—';
  $('dMaSlow').textContent = sV ? fmt(sV) : '—';
  const sg = $('dSignal');
  sg.textContent = sig || '—';
  sg.className = 'signal' + (sig ? ' ' + sig.toLowerCase() : '');
  renderSafeRow('d', a);

  const shownBal = Number(a.balance) + pnl;
  $('dBalance').textContent = '$' + fmt(shownBal);
  const start = Number(a.start_balance) || Number(a.balance);
  const tot = shownBal - start;
  const tp = $('dTotalPnl');
  tp.textContent = signed(tot) + ' (' + (start ? (tot / start * 100).toFixed(2) : '0.00') + '%)';
  tp.className = 'pnl ' + (tot >= 0 ? 'up' : 'down');

  $('botDot').className = 'dot' + (running ? ' on' : '');
  $('botText').textContent = botStatusText(a);
  renderBotMsg($('botMsg'), a);

  const btn = $('botBtn'), sBtn = $('safeBtn');
  btn.textContent = running ? 'Stop Bot' : 'Start Bot';
  btn.className = 'bot-btn' + (running ? ' stop' : '');
  sBtn.hidden = running;

  lockDemoSettings(running);
  if (running && safe) { $('inpMaFast').value = 20; $('inpMaSlow').value = 100; }

  const pc = $('posCard');
  pc.hidden = !a.pos_dir;
  if (a.pos_dir) {
    const d = pxDigits(Number(a.pos_entry));
    $('posDir').textContent = a.pos_dir;
    $('posDir').className = a.pos_dir === 'LONG' ? 'long' : 'short';
    $('posEntry').textContent = '$' + fmt(a.pos_entry, d);
    $('posSize').textContent = '$' + fmt(a.amount);
    $('posLev').textContent = a.leverage + 'x';
    const L = stopTpPrices(a);
    $('posSlTp').textContent = (L.stop != null ? '$' + fmt(L.stop, d) : 'Off') + ' / ' + (L.tp != null ? '$' + fmt(L.tp, d) : 'Off');
    $('posPnl').textContent = signed(pnl);
    $('posPnl').className = pnl >= 0 ? 'up' : 'down';
  }
}

async function refreshAccount() {
  await reloadAccount();
  await fetchMarket();
  updateUI();
}

async function startDemo(mode) {
  if (!curAcc || curAcc.bot_running) return;
  const m = readMa();
  if (mode === 'normal' && m.f >= m.s) throw new Error('MA Fast must be smaller than MA Slow');
  const amount = parseFloat($('inpAmount').value) || Math.min(100, Number(curAcc.balance));
  await api('start_bot', {
    id: curAcc.id, mode, coin: selCoin, amount, leverage,
    sl: parseFloat($('inpSl').value) || null, tp: parseFloat($('inpTp').value) || null,
    ma_fast: m.f, ma_slow: m.s,
  });
  await refreshAccount();
}

async function stopDemo() {
  if (curAcc.pos_dir && !confirm('Close the open position at market price and stop the bot?')) return;
  await api('stop_bot', { id: curAcc.id });
  await refreshAccount();
}

Object.assign(ACTIONS, {
  async selectCoin(el) {
    if (curAcc && curAcc.bot_running) return;
    selCoin = el.dataset.c;
    await fetchMarket();
    updateUI();
  },
  setLev(el) { if (!(curAcc && curAcc.bot_running)) setLev(+el.dataset.v); },
  async toggleBot() { if (!curAcc) return; curAcc.bot_running ? await stopDemo() : await startDemo('normal'); },
  async toggleSafeBot() { if (!curAcc) return; curAcc.bot_running ? await stopDemo() : await startDemo('safe'); },
});

['inpMaFast', 'inpMaSlow'].forEach(id => $(id).addEventListener('input', async () => {
  if (!curAcc || curAcc.bot_running) return;
  const { s } = readMa();
  if ((closesData[selCoin] || []).length < s) await fetchMarket();
  updateUI();
}));

bindPullToRefresh('detailScroll', 'ptr', refreshAccount);
