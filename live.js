/* ==== HBU Crypto — Gercek (Investment) hesap ==== */
'use strict';

let liveAcc = null;      // veritabanindaki canli hesap satiri
let liveStat = null;     // sunucudan Bybit durumu (bakiye, pozisyon, limitler)
let livePrice = 0;
let liveCoin = 'BNB';
let liveLev = 1;

function apiDaysLeft() {
  if (!liveAcc || !liveAcc.api_renewed_at) return null;
  const days = liveAcc.api_days || 89;
  const passed = Math.floor((Date.now() - new Date(liveAcc.api_renewed_at).getTime()) / 86_400_000);
  return Math.max(0, days - passed);
}

async function reloadLiveAcc() {
  if (!liveAcc) {
    const r = await api('live_init');
    liveAcc = { id: r.id };
  }
  const { data, error } = await db.from('accounts').select('*').eq('id', liveAcc.id).single();
  if (error) throw new Error(error.message);
  liveAcc = data;
}

async function loadLive() {
  await reloadLiveAcc();
  if (liveAcc.bot_running || !liveStat) {
    liveCoin = liveAcc.coin || 'BNB';
    liveLev = liveAcc.leverage || 1;
    const safe = liveAcc.bot_mode === 'safe' && liveAcc.bot_running;
    $('lMaFast').value = safe ? 10 : (liveAcc.ma_fast || 9);
    $('lMaSlow').value = safe ? 200 : (liveAcc.ma_slow || 30);
    $('lAmount').value = liveAcc.amount ?? '';
    $('lSl').value = liveAcc.sl_pct ?? '';
    $('lTp').value = liveAcc.tp_pct ?? '';
  }
  markCoin(); markLev();
  const [st] = await Promise.all([api('live_status', { coin: liveCoin }), fetchLivePrice()]);
  liveStat = st;
  renderLive();
}

async function fetchLivePrice() {
  try { livePrice = parseFloat((await fetchTicker(liveCoin)).lastPrice); } catch (e) { livePrice = 0; }
}

function markCoin() {
  document.querySelectorAll('#lCoinSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.c === liveCoin));
  $('lPair').textContent = liveCoin + '/USDT';
}
function markLev() {
  document.querySelectorAll('#lLevSeg .seg-btn').forEach(b => b.classList.toggle('active', +b.dataset.v === liveLev));
}

function renderEnvTags() {
  const testnet = !liveStat || liveStat.env !== 'mainnet';
  document.querySelectorAll('[data-env-tag]').forEach(t => {
    t.textContent = testnet ? 'TESTNET' : 'LIVE';
    t.classList.toggle('testnet', testnet);
  });
}

function renderLive() {
  const a = liveAcc, s = liveStat || {};
  if (!a) return;
  renderEnvTags();

  // Uyarilar
  const warns = [];
  if (s.error) warns.push('Bybit: ' + s.error);
  if (s.env !== 'mainnet') warns.push('TESTNET mode — orders go to Bybit testnet, not real money.');
  if (s.live_enabled === false) warns.push('Live trading is disabled on the server (LIVE_TRADING_ENABLED). No new positions will be opened.');
  if (s.margin_mode && s.margin_mode !== 'ISOLATED_MARGIN') warns.push('Bybit account is not in Isolated Margin mode. Switch it before starting.');
  const w = $('lWarn');
  w.hidden = !warns.length;
  w.innerHTML = warns.map(esc).join('<br>');

  $('lBalance').textContent = s.wallet ? '$' + fmt(s.wallet.usdtEquity) : '—';
  const days = apiDaysLeft();
  const ad = $('lApiDays');
  ad.textContent = days != null ? 'API: ' + days + ' days left' : 'API: —';
  ad.style.color = days == null ? '' : days <= 5 ? 'var(--red)' : days <= 15 ? 'var(--gold)' : '';

  $('lPrice').textContent = livePrice ? '$' + fmt(livePrice, pxDigits(livePrice)) : '—';
  const sig = $('lSignal');
  const trend = a.bot_running && a.indicators ? a.indicators.trend : null;
  sig.textContent = trend || '—';
  sig.className = 'signal' + (trend ? ' ' + trend.toLowerCase() : '');
  renderSafeRow('l', a);

  const hint = $('lMinHint');
  hint.textContent = s.min_order_usd ? '· min ~$' + fmt(s.min_order_usd / liveLev) + ' at ' + liveLev + 'x' + (s.max_amount ? ' · max $' + fmt(s.max_amount, 0) : '') : '';

  const running = a.bot_running;
  $('lDot').className = 'dot' + (running ? ' on' : '');
  $('lBotText').textContent = botStatusText(a);
  renderBotMsg($('lBotMsg'), a);
  const btn = $('lBotBtn');
  btn.textContent = running ? 'Stop Bot' : 'Start Bot';
  btn.className = 'bot-btn' + (running ? ' stop' : '');
  $('lSafeBtn').hidden = running;
  $('lSafeNote').hidden = running;

  ['lMaFast', 'lMaSlow', 'lAmount', 'lSl', 'lTp'].forEach(id => { $(id).disabled = running; });
  document.querySelectorAll('#lCoinSeg .seg-btn, #lLevSeg .seg-btn').forEach(b => { b.disabled = running; });

  // Pozisyon: borsadaki gercek durum
  const p = s.position;
  const pc = $('lPosCard');
  pc.hidden = !(p && p.size > 0);
  if (p && p.size > 0) {
    const d = pxDigits(p.avgPrice);
    $('lPosDir').textContent = p.dir;
    $('lPosDir').className = p.dir === 'LONG' ? 'long' : 'short';
    $('lPosEntry').textContent = '$' + fmt(p.avgPrice, d);
    $('lPosSize').textContent = '$' + fmt(p.size * p.avgPrice / (a.leverage || 1));
    $('lPosLev').textContent = (a.pos_lev != null ? Number(a.pos_lev).toFixed(2) : (a.leverage || 1)) + 'x';
    $('lPosSl').textContent = p.stopLoss > 0 ? '$' + fmt(p.stopLoss, d) : '⚠️ NONE';
    $('lPosSl').className = p.stopLoss > 0 ? '' : 'down';
    $('lPosPnl').textContent = signed(p.upnl || 0);
    $('lPosPnl').className = (p.upnl || 0) >= 0 ? 'up' : 'down';
  }

  // API sayfasi
  const info = $('apiInfo'), card = $('apiCard');
  info.textContent = days != null ? days : '—';
  const col = days == null ? null : days <= 5 ? 'var(--red)' : days <= 15 ? 'var(--gold)' : null;
  info.style.color = col || 'var(--text)';
  card.style.borderColor = col || 'var(--border)';
  $('apiDaysInput').value = a.api_days || 89;
  $('apiDaysInput').disabled = true;
}

async function lStart(mode) {
  let f = parseInt($('lMaFast').value, 10) || 9, s = parseInt($('lMaSlow').value, 10) || 30;
  if (mode === 'safe') { f = 10; s = 200; }
  if (mode === 'normal' && f >= s) throw new Error('MA Fast must be smaller than MA Slow');
  const amount = Math.floor(parseFloat($('lAmount').value));
  if (!(amount > 0)) throw new Error('Enter an amount');
  const sl = mode === 'safe' ? null : (parseFloat($('lSl').value) || null);
  const tp = mode === 'safe' ? null : (parseFloat($('lTp').value) || null);
  if (mode === 'normal' && !sl) throw new Error('Stop Loss is required for live normal mode');
  const real = liveStat && liveStat.env === 'mainnet';
  const msg = (real ? '⚠️ REAL MONEY (Bybit mainnet)\n\n' : 'TESTNET\n\n') +
    (mode === 'safe' ? 'EMA Trend (8h EMA10/200, Chandelier 5×ATR)' : 'MA ' + f + '/' + s) + '\n' +
    (mode === 'safe'
      ? liveCoin + 'USDT · $' + amount + ' · leverage up to ' + liveLev + 'x (set by volatility)\n'
      : liveCoin + 'USDT · $' + amount + ' × ' + liveLev + 'x = $' + (amount * liveLev) + ' position\n') +
    'Stop Loss: ' + (mode === 'safe' ? 'Chandelier trailing (on Bybit)' : sl + '%') + ' · Take Profit: ' + (tp ? tp + '%' : 'Off') + '\n\nStart?';
  if (!confirm(msg)) return;
  await api('start_bot', { id: liveAcc.id, mode, coin: liveCoin, amount, leverage: liveLev, sl, tp, ma_fast: f, ma_slow: s });
  toast('Bot started');
  await loadLive();
}

async function lStop() {
  const hasPos = liveAcc.pos_dir || (liveStat && liveStat.position && liveStat.position.size > 0);
  if (hasPos && !confirm('There is an open position. Close it at market and stop the bot?')) return;
  if (!hasPos && !confirm('Stop the bot?')) return;
  await api('stop_bot', { id: liveAcc.id });
  toast('Bot stopped');
  await loadLive();
}

/* ---------- API yenileme rehberi ---------- */
const API_TEXT = {
  en: `Bybit API keys without IP restriction expire after 90 days. To renew:<br><br>
    1. Bybit → Profile → API Management<br>
    2. Delete the old "hbu-bot" key<br>
    3. Create New Key → System-generated (HMAC)<br>
    4. Permissions: <b>Read-Write</b>, <b>Contract → Orders + Positions only</b><br>
    5. <b>Never</b> enable Withdraw or Transfer<br>
    6. No IP restriction (Supabase has no fixed IP)<br>
    7. Copy API Key &amp; Secret (secret is shown once)<br>
    8. Open the Supabase Secrets page (button below)<br>
    9. Update BYBIT_API_KEY and BYBIT_API_SECRET → Save<br>
    10. Don't paste the secret anywhere else (chats, notes, screenshots)<br>
    11. Come back and tap "I Renewed the API"`,
  tr: `IP kısıtlaması olmayan Bybit API anahtarları 90 günde sona erer. Yenilemek için:<br><br>
    1. Bybit → Profil → API Yönetimi<br>
    2. Eski "hbu-bot" anahtarını sil<br>
    3. Yeni Anahtar Oluştur → Sistem tarafından (HMAC)<br>
    4. Yetkiler: <b>Read-Write</b>, <b>Contract → sadece Orders + Positions</b><br>
    5. Withdraw (çekim) ve Transfer'i <b>asla</b> açma<br>
    6. IP kısıtlaması yok (Supabase'in sabit IP'si yok)<br>
    7. API Key ve Secret'ı kopyala (secret bir kez gösterilir)<br>
    8. Alttaki butonla Supabase Secrets sayfasını aç<br>
    9. BYBIT_API_KEY ve BYBIT_API_SECRET'i güncelle → Kaydet<br>
    10. Secret'ı başka hiçbir yere yapıştırma (sohbet, not, ekran görüntüsü)<br>
    11. Buraya dön ve "I Renewed the API"ye bas`,
};
let apiLang = 'en';

Object.assign(ACTIONS, {
  async openLive() { show('live'); await loadLive(); },
  async openApiPage() { show('apiPage'); $('apiText').innerHTML = API_TEXT[apiLang]; await reloadLiveAcc(); renderLive(); },
  async lSetCoin(el) {
    if (liveAcc && liveAcc.bot_running) return;
    liveCoin = el.dataset.c; markCoin();
    const [st] = await Promise.all([api('live_status', { coin: liveCoin }), fetchLivePrice()]);
    liveStat = st; renderLive();
  },
  lSetLev(el) { if (liveAcc && liveAcc.bot_running) return; liveLev = +el.dataset.v; markLev(); renderLive(); },
  async lToggleBot() { if (!liveAcc) return; liveAcc.bot_running ? await lStop() : await lStart('normal'); },
  async lToggleSafeBot() { if (!liveAcc) return; liveAcc.bot_running ? await lStop() : await lStart('safe'); },
  unlockApiDays() { const i = $('apiDaysInput'); i.disabled = false; i.focus(); },
  async renewApi() {
    const days = parseInt($('apiDaysInput').value, 10) || 89;
    if (days < 1 || days > 90) throw new Error('Days must be 1–90');
    await api('renew_api', { days });
    toast('Counter reset: ' + days + ' days');
    await reloadLiveAcc(); renderLive();
  },
  toggleApiLang() {
    apiLang = apiLang === 'en' ? 'tr' : 'en';
    $('apiText').innerHTML = API_TEXT[apiLang];
    $('apiLangBtn').textContent = apiLang === 'en' ? 'Türkçe' : 'English';
  },
  openSupabaseKeys() { window.open(CONFIG.SUPABASE_SECRETS_PAGE, '_blank', 'noopener,noreferrer'); },
  openReminder() {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(0, (apiDaysLeft() ?? 89) - 1));
    $('reminderDate').value = d.toISOString().slice(0, 10);
    $('reminderModal').classList.add('open');
  },
  addReminder() {
    const ds = $('reminderDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) throw new Error('Pick a date');
    const day = ds.replace(/-/g, '');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HBU Crypto//Reminder//EN',
      'BEGIN:VEVENT', 'UID:hbu-api-' + day + '@hbucrypto', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART:' + day + 'T100000', 'DTEND:' + day + 'T103000',
      'SUMMARY:HBU Crypto — Bybit API yenile', 'DESCRIPTION:Uygulamadaki API sayfasindaki adimlari izle.',
      'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:HBU Crypto API', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'hbu-api-reminder.ics';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('reminderModal').classList.remove('open');
    toast('Calendar file created — open it to add to your calendar');
  },
});

bindPullToRefresh('liveScroll', 'livePtr', loadLive);

/* Cikista bellekteki tum veriyi temizle */
function resetAppState() {
  accounts = []; curAcc = null; liveAcc = null; liveStat = null;
  prices = {}; chg = {}; closesData = {}; listPrices = {};
  $('accList').innerHTML = ''; $('histList').innerHTML = '';
  closeModals();
}
