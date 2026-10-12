/* ==== HBU Crypto — Islem gecmisi (demo + canli ortak) ==== */
'use strict';

let historyFrom = 'account';

async function renderHistory(accountId, title) {
  $('histTitle').textContent = title;
  show('history');
  const el = $('histList');
  el.innerHTML = '<div class="card">Loading...</div>';

  const { data, error } = await db.from('trades').select('*')
    .eq('account_id', accountId).order('created_at', { ascending: false }).limit(200);
  if (error) { el.innerHTML = '<div class="card">Error: ' + esc(error.message) + '</div>'; return; }
  if (!data || !data.length) {
    el.innerHTML = '<div class="card" style="text-align:center;color:var(--text-dim)">No trades yet</div>';
    return;
  }

  const net = data.reduce((s, t) => s + Number(t.pnl), 0);
  const fees = data.reduce((s, t) => s + Number(t.commission), 0);
  const fund = data.reduce((s, t) => s + Number(t.funding), 0);
  const wins = data.filter(t => Number(t.pnl) > 0).length;

  const summary = `
    <div class="card">
      <div class="card-label">Summary · last ${data.length} trades</div>
      <div class="pos-grid">
        <div class="pos-item"><span>Net P&amp;L</span><b class="${net >= 0 ? 'up' : 'down'}">${signed(net)}</b></div>
        <div class="pos-item"><span>Win Rate</span><b>${(wins / data.length * 100).toFixed(0)}%</b></div>
        <div class="pos-item"><span>Fees Paid</span><b>${money(fees)}</b></div>
        <div class="pos-item"><span>Funding</span><b class="${fund >= 0 ? 'up' : 'down'}">${signed(fund)}</b></div>
      </div>
    </div>`;

  el.innerHTML = summary + data.map(t => {
    const up = Number(t.pnl) >= 0;
    const date = new Date(t.created_at);
    const ds = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const d = pxDigits(Number(t.entry_price));
    const reason = esc(t.close_reason);
    return `
    <div class="card">
      <div class="price-head">
        <div>
          <div class="card-label">${esc(t.coin)}/USDT · ${esc(t.leverage)}x · ${t.mode === 'safe' ? 'EMA · ' : ''}${esc(ds)}</div>
          <div style="font-weight:800;font-size:15px" class="pnl ${t.direction === 'LONG' ? 'up' : 'down'}">${esc(t.direction)}</div>
        </div>
        <div class="pnl ${up ? 'up' : 'down'}" style="font-size:16px">${signed(t.pnl)}</div>
      </div>
      <div class="ma-row hist-row">
        <div class="ma"><span class="ma-name">ENTRY</span><span>$${fmt(t.entry_price, d)}</span></div>
        <div class="ma"><span class="ma-name">EXIT</span><span>$${fmt(t.exit_price, d)}</span></div>
        <div class="ma"><span class="ma-name">FEE</span><span>$${fmt(t.commission)}</span></div>
        <div class="ma"><span class="ma-name">FUND</span><span>${signed(t.funding)}</span></div>
        <div class="reason r-${reason}">${reason}</div>
      </div>
    </div>`;
  }).join('');
}

Object.assign(ACTIONS, {
  async openHistory() {
    if (!curAcc) return;
    historyFrom = 'account';
    await renderHistory(curAcc.id, 'Trade History');
  },
  async openLiveHistory() {
    if (!liveAcc) return;
    historyFrom = 'live';
    await renderHistory(liveAcc.id, 'Live Trade History');
  },
  historyBack() { show(historyFrom); },
});
