(function () {
‘use strict’

// Remove any existing instance
document.getElementById('sudo-ui')?.remove();

// ─────────────────────────────────────────────
//  CONFIG — SOL only, fixed rate
// ─────────────────────────────────────────────
const SOL_RATE = 88.71;
const SOL_DEC  = 6;

const toC = (usd) => (usd / SOL_RATE).toFixed(SOL_DEC);

// ─────────────────────────────────────────────
//  STORAGE — localStorage only
// ─────────────────────────────────────────────
function lsGet(k, fb) {
    try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch {}
    return fb;
}
function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let balance       = Number(lsGet('sudo_balance', 0)) || 0;
let betInProgress = false;
let currentBet    = 0;
let lastBet       = 0;
let pendingHist   = 0;

let roundId    = null;
let settled    = false;
let profitMult = null;
let roundAt    = 0;
let lossGuard  = false;
let lossTimer  = null;

let cloned   = null;
let original = null;
let typed    = '';

let walletSpan = null;
let bjTick     = null;
let bjNode     = null;
let lTick      = null;
let lLastId    = null;

let hist = [];
try { const r = lsGet('sudo_bets', null); if (Array.isArray(r)) hist = r; } catch {}
const seen    = new Set(hist.map(b => b.id));
const saveHist = () => lsSet('sudo_bets', hist);

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
const safeN  = (n, d = 0) => { const v = Number(n); return isFinite(v) ? v : d; };
const fmtUSD = n => `$${safeN(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const USD_RX = /^\$[\d,]+\.\d{2}$/;

const onMyBets  = () => /\/my-bets/i.test(location.pathname);
const onBJ      = () => /\/blackjack/i.test(location.pathname);
const onLimbo   = () => /\/limbo/i.test(location.pathname);
const isInstant = () => /\/blackjack|\/keno|\/limbo/i.test(location.pathname);
const newRound  = () => `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const debounce  = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ─────────────────────────────────────────────
//  UI
// ─────────────────────────────────────────────
function buildUI() {
    if (!document.body) return;

    const ui = document.createElement('div');
    ui.id = 'sudo-ui';
    ui.style.cssText = [
        'position:fixed;top:16px;left:16px;z-index:2147483647',
        'background:rgba(12,12,18,0.97)',
        'border:1px solid rgba(255,255,255,.1)',
        'border-radius:12px;padding:14px 16px',
        'color:#fff;width:270px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'font-size:13px;box-shadow:0 6px 28px rgba(0,0,0,.7)',
        'display:block',
    ].join(';');

    ui.innerHTML = `
    <div id="sh" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;">
        <b style="font-size:13px;letter-spacing:.3px;">SUDO</b>
        <span id="s-close" style="cursor:pointer;font-size:22px;line-height:1;opacity:.5;padding:0 2px;">×</span>
    </div>
    <div id="s-body">
        <div style="text-align:center;font-size:10px;color:rgba(255,255,255,.3);margin-bottom:9px;">
            1 SOL = $${SOL_RATE.toFixed(2)} (fixed)
        </div>

        <!-- balance -->
        <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:9px 11px;margin-bottom:9px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <div style="font-size:10px;color:rgba(255,255,255,.38);margin-bottom:2px;">Balance</div>
                <div id="s-bal" style="font-size:18px;font-weight:700;color:#22d3a0;"></div>
            </div>
            <div id="s-bal-c" style="font-size:11px;color:rgba(255,255,255,.4);text-align:right;"></div>
        </div>

        <!-- set + quick -->
        <div style="display:flex;gap:5px;margin-bottom:7px;">
            <input id="s-inp" type="number" placeholder="$ amount" style="flex:1;padding:6px 9px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.09);border-radius:7px;color:#fff;font-size:13px;outline:none;font-family:inherit;">
            <button id="s-set" style="padding:6px 11px;background:#2563eb;border:none;border-radius:7px;color:#fff;font-weight:600;cursor:pointer;font-size:12px;font-family:inherit;">Set</button>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:12px;">
            <button class="qa" data-a="100"  style="flex:1;padding:5px 0;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(34,211,160,.35);background:rgba(34,211,160,.08);color:#22d3a0;font-family:inherit;">+100</button>
            <button class="qa" data-a="500"  style="flex:1;padding:5px 0;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(250,204,21,.35);background:rgba(250,204,21,.08);color:#facc15;font-family:inherit;">+500</button>
            <button class="qa" data-a="1000" style="flex:1;padding:5px 0;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(251,113,133,.35);background:rgba(251,113,133,.08);color:#fb7185;font-family:inherit;">+1k</button>
        </div>

        <!-- history -->
        <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:9px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,.4);letter-spacing:.5px;">BETS</span>
                <button id="s-clr" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,60,60,.3);background:rgba(255,60,60,.08);color:#f87171;cursor:pointer;font-family:inherit;">Clear</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 50px 50px 62px;gap:1px 6px;margin-bottom:4px;padding:0 2px;">
                <span style="font-size:9px;color:rgba(255,255,255,.22);text-transform:uppercase;">Game</span>
                <span style="font-size:9px;color:rgba(255,255,255,.22);text-transform:uppercase;text-align:right;">Bet</span>
                <span style="font-size:9px;color:rgba(255,255,255,.22);text-transform:uppercase;text-align:right;">Mult</span>
                <span style="font-size:9px;color:rgba(255,255,255,.22);text-transform:uppercase;text-align:right;">Pay</span>
            </div>
            <div id="s-hist" style="max-height:195px;overflow-y:auto;"></div>
        </div>
    </div>`;

    document.body.appendChild(ui);

    // close — full destroy
    document.getElementById('s-close').addEventListener('click', () => {
        lsSet('sudo_balance', balance);
        ui.remove();
        // stop all intervals
        clearInterval(walletInt);
        clearInterval(winInt);
        clearInterval(multInt);
        clearInterval(tableInt);
        clearInterval(tooltipInt);
        clearInterval(cloneInt);
        clearInterval(myBetsInt);
        clearInterval(tickInt);
        if (lossTimer) clearInterval(lossTimer);
        if (bjTick)    clearInterval(bjTick);
        if (lTick)     clearInterval(lTick);
        stopMyBetsObserver();
    });

    // quick add
    ui.querySelectorAll('.qa').forEach(btn => btn.addEventListener('click', () => {
        balance += Number(btn.dataset.a);
        lsSet('sudo_balance', balance);
        updateBal();
    }));

    // set balance
    document.getElementById('s-set').addEventListener('click', () => {
        const v = parseFloat(document.getElementById('s-inp').value || '0');
        balance = isFinite(v) ? Math.max(0, v) : 0;
        lsSet('sudo_balance', balance);
        updateBal();
        document.getElementById('s-inp').value = '';
    });

    // clear history
    document.getElementById('s-clr').addEventListener('click', () => {
        hist = []; seen.clear(); saveHist(); renderHist();
    });

    // drag (header)
    let drag = false, ox = 0, oy = 0;
    document.getElementById('sh').addEventListener('mousedown', e => {
        drag = true; ox = e.clientX - ui.offsetLeft; oy = e.clientY - ui.offsetTop;
    });
    document.addEventListener('mousemove', e => { if (drag) { ui.style.left=(e.clientX-ox)+'px'; ui.style.top=(e.clientY-oy)+'px'; }});
    document.addEventListener('mouseup',   () => { drag = false; });

    updateBal();
    renderHist();
}

function updateBal() {
    const b = document.getElementById('s-bal');
    if (b) b.textContent = fmtUSD(balance);
    const c = document.getElementById('s-bal-c');
    if (c) c.textContent = `${toC(balance)} SOL`;
}

// ─────────────────────────────────────────────
//  HISTORY RENDER
// ─────────────────────────────────────────────
function renderHist() {
    const el = document.getElementById('s-hist');
    if (!el) return;
    if (!hist.length) {
        el.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,.22);font-size:11px;padding:10px 0;">No bets yet</div>`;
        return;
    }
    el.innerHTML = hist.map(b => {
        const betC  = toC(b.betUSD);
        const payC  = toC(b.payoutUSD);
        const mult  = b.multiplier > 0 ? `${b.multiplier.toFixed(2)}×` : '—';
        const col   = b.isWin ? '#22d3a0' : '#f87171';
        const arrow = b.isWin ? '▲' : '▼';
        return `<div style="display:grid;grid-template-columns:1fr 50px 50px 62px;gap:1px 6px;padding:4px 2px;border-bottom:1px solid rgba(255,255,255,.04);align-items:center;">
            <span style="font-size:11px;color:rgba(255,255,255,.65);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${b.game}">${b.game}</span>
            <span style="font-size:10px;color:rgba(255,255,255,.4);text-align:right;white-space:nowrap;">${betC}</span>
            <span style="font-size:10px;color:rgba(255,255,255,.5);text-align:right;font-weight:600;">${mult}</span>
            <span style="font-size:10px;color:${col};text-align:right;font-weight:700;white-space:nowrap;">${arrow}${payC}</span>
        </div>`;
    }).join('');
}

// ─────────────────────────────────────────────
//  STATS PANEL PATCH
// ─────────────────────────────────────────────
let lastClickedEntry = null;

function patchStatsDl(entry) {
    if (!entry) return;
    document.querySelectorAll('dl.stats-row').forEach(dl => {
        const betSpan = dl.querySelector('.col:nth-child(1) span[style*="max-width: 12ch"]');
        if (betSpan) betSpan.textContent = fmtUSD(entry.betUSD);
        const multSpan = dl.querySelector('.col:nth-child(2) dd span[data-ds-text="true"]');
        if (multSpan) multSpan.textContent = entry.multiplier > 0 ? `${entry.multiplier.toFixed(2)}×` : '0.00×';
        const paySpan = dl.querySelector('.col:nth-child(3) span[style*="max-width: 12ch"]');
        if (paySpan) paySpan.textContent = fmtUSD(entry.payoutUSD);
    });
}

new MutationObserver(() => {
    if (lastClickedEntry && document.querySelector('dl.stats-row')) {
        setTimeout(() => patchStatsDl(lastClickedEntry), 0);
    }
}).observe(document.body, { childList: true, subtree: true });

// ─────────────────────────────────────────────
//  ROW PATCHING
// ─────────────────────────────────────────────
function patchTableRow(row, entry) {
    const isGamePage = !onMyBets();
    if (isGamePage) {
        const betSpan = row.querySelector('td:nth-child(3) span[style*="max-width: 12ch"]');
        if (betSpan) betSpan.textContent = entry ? fmtUSD(entry.betUSD) : '$0.00';
        const paySpan = row.querySelector('td:nth-child(5) span[style*="max-width: 12ch"]');
        if (paySpan) paySpan.textContent = entry ? fmtUSD(entry.payoutUSD) : '$0.00';
    } else {
        const betSpan = row.querySelector('td:nth-child(1) span[style*="max-width: 12ch"]');
        if (betSpan) betSpan.textContent = entry ? fmtUSD(entry.betUSD) : '$0.00';
        const multSpan = row.querySelector('td:nth-child(2) span[data-ds-text="true"]');
        if (multSpan) {
            const m = entry?.multiplier || 0;
            multSpan.textContent = m > 0 ? `${m.toFixed(2)}×` : '0.00×';
        }
        const paySpan = row.querySelector('td:nth-child(3) span[style*="max-width: 12ch"]');
        if (paySpan) paySpan.textContent = entry ? fmtUSD(entry.payoutUSD) : '$0.00';
    }
}

// ─────────────────────────────────────────────
//  LIVE TABLE SCAN
// ─────────────────────────────────────────────
function scanLiveTable() {
    if (onMyBets()) return;
    const rows = document.querySelectorAll('tr[data-bet-index][data-test-id]');
    if (!rows.length) return;

    const domIds = new Set([...rows].map(r => r.getAttribute('data-test-id')));
    const before = hist.length;
    hist = hist.filter(b => domIds.has(b.id));
    if (hist.length !== before) { saveHist(); renderHist(); }

    let changed = false;
    rows.forEach((row, i) => {
        const id = row.getAttribute('data-test-id');
        if (!id) return;

        patchTableRow(row, hist[i]);

        const gameBtn = row.querySelector('button[aria-label="Open Bet Preview"]');
        if (gameBtn && !gameBtn.dataset.sudoClick) {
            gameBtn.dataset.sudoClick = '1';
            gameBtn.addEventListener('click', () => {
                lastClickedEntry = hist[i] || null;
                setTimeout(() => patchStatsDl(lastClickedEntry), 80);
                setTimeout(() => patchStatsDl(lastClickedEntry), 300);
            });
        }

        if (seen.has(id)) return;
        seen.add(id);

        const gameSpan   = row.querySelector('button[aria-label="Open Bet Preview"] span[data-ds-text="true"]');
        const game       = gameSpan?.textContent.trim() || 'Unknown';
        const time       = row.querySelector('[data-table="time"]')?.textContent.trim() || '';
        const multEl     = row.querySelector('td:nth-child(4) span[data-ds-text="true"]');
        const multText   = multEl?.textContent.trim() || '0×';
        const multiplier = parseFloat(multText.replace(/[^0-9.]/g, '')) || 0;
        const betUSD     = pendingHist > 0 ? pendingHist : lastBet;
        pendingHist      = 0;
        const payoutUSD  = betUSD * multiplier;
        const isWin      = multiplier > 0;

        hist.unshift({ id, game, time, betUSD, multiplier, payoutUSD, isWin });
        if (hist.length > 10) hist.length = 10;
        changed = true;
    });

    if (changed) { saveHist(); renderHist(); }
}

// ─────────────────────────────────────────────
//  MY-BETS TABLE
// ─────────────────────────────────────────────
function patchMyBetsTable() {
    if (!onMyBets()) return;
    const rows = document.querySelectorAll('tr[data-bet-index][data-test-id]');
    if (!rows.length) return;
    rows.forEach((row, i) => {
        const entry = hist[i];
        patchTableRow(row, entry);
        const betIdBtn = row.querySelector('td:nth-child(5) button, td button[data-testid]');
        if (betIdBtn && !betIdBtn.dataset.sudoClick) {
            betIdBtn.dataset.sudoClick = '1';
            betIdBtn.addEventListener('click', () => {
                lastClickedEntry = entry || null;
                setTimeout(() => patchStatsDl(lastClickedEntry), 80);
                setTimeout(() => patchStatsDl(lastClickedEntry), 300);
            });
        }
    });
}

let myBetsObserver = null;
function startMyBetsObserver() {
    if (myBetsObserver) return;
    const tbody = document.querySelector('tbody[data-bets-loading]');
    if (!tbody) return;
    myBetsObserver = new MutationObserver(() => patchMyBetsTable());
    myBetsObserver.observe(tbody, { childList: true, subtree: true, characterData: true });
    patchMyBetsTable();
}
function stopMyBetsObserver() {
    myBetsObserver?.disconnect();
    myBetsObserver = null;
}

// ─────────────────────────────────────────────
//  TOOLTIP PATCH
// ─────────────────────────────────────────────
function patchTooltips() {
    document.querySelectorAll('div.tooltip-content .fiat-wrapper').forEach(fw => {
        if (fw.dataset.sudoOwned) return;
        const span = fw.querySelector('span[data-ds-text="true"]');
        if (!span) return;
        fw.dataset.sudoOwned = '1';

        function resolveUSD() {
            const ttRect = fw.closest('.tooltip')?.getBoundingClientRect();
            if (!ttRect) return balance;
            let best = null, bestDist = Infinity;
            document.querySelectorAll('span[data-ds-text="true"]').forEach(el => {
                if (el.closest('#sudo-ui')) return;
                if (el.closest('.tooltip')) return;
                const txt = el.textContent.trim();
                if (!USD_RX.test(txt)) return;
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return;
                const dist = Math.hypot(
                    (r.left + r.width/2)  - (ttRect.left + ttRect.width/2),
                    (r.top  + r.height/2) - (ttRect.top  + ttRect.height/2)
                );
                if (dist < bestDist) { bestDist = dist; best = txt; }
            });
            if (best) { const v = parseFloat(best.replace(/[^0-9.]/g, '')); return isFinite(v) ? v : balance; }
            return balance;
        }

        span.textContent = toC(resolveUSD());
        new MutationObserver(() => {
            if (/^\d+\.\d{4,}$/.test(span.textContent.trim())) span.textContent = toC(resolveUSD());
        }).observe(span, { childList: true, characterData: true, subtree: true });
    });
}

// ─────────────────────────────────────────────
//  WALLET DISPLAY
// ─────────────────────────────────────────────
function locateWallet() {
    const t = document.querySelector('button[data-testid="coin-toggle"] span[style*="max-width: 16ch"] span[data-ds-text="true"]')
           || document.querySelector('span[data-ds-text="true"][style*="max-width: 16ch"]');
    walletSpan = (t && !t.closest('#sudo-ui') && USD_RX.test(t.textContent.trim())) ? t : null;
}

function syncWallet() {
    if (!walletSpan || !document.body.contains(walletSpan)) locateWallet();
    if (!walletSpan || walletSpan.closest('#sudo-ui')) return;
    const v = fmtUSD(balance);
    if (walletSpan.textContent !== v) walletSpan.textContent = v;
    patchCoinDropdown();
}

function patchCoinDropdown() {
    const btn = document.querySelector('button[data-testid="coin-toggle-currency-sol"]');
    if (!btn) return;
    const span = btn.querySelector('span[style*="max-width: 16ch"] span[data-ds-text="true"]')
              || btn.querySelector('.content span[data-ds-text="true"]');
    if (span && span.textContent !== fmtUSD(balance)) span.textContent = fmtUSD(balance);
}

// ─────────────────────────────────────────────
//  CONVERSION LABELS
// ─────────────────────────────────────────────
function getBetInput() {
    return cloned?.querySelector('input[data-testid="input-game-amount"],input[type="number"]') || null;
}

function updateConv() {
    const inp    = getBetInput();
    const profI  = document.querySelector('input[data-testid="profit-input"]');
    const labels = document.querySelectorAll('div[data-testid="conversion-amount"],div[class*="crypto"][data-testid="conversion-amount"]');
    if (!labels.length) { setTimeout(updateConv, 200); return; }
    const bv = inp   && !isNaN(parseFloat(inp.value))   ? parseFloat(inp.value)   : 0;
    const pv = profI && !isNaN(parseFloat(profI.value)) ? parseFloat(profI.value) : 0;
    if (labels[0]) labels[0].textContent = `${toC(bv)} SOL`;
    if (labels[1]) labels[1].textContent = `${toC(pv)} SOL`;
}

// ─────────────────────────────────────────────
//  PROFIT HELPERS
// ─────────────────────────────────────────────
function getMultFromLabel() {
    const root = document.querySelector('.profit .labels,.profit');
    if (!root) return null;
    const m = (root.textContent||'').match(/\(([\d.]+)\s*[x×]\)/i);
    if (m) { const v = parseFloat(m[1]); return isFinite(v) ? v : null; }
    return null;
}

function setProfitUSD(usd) {
    const el = document.querySelector('input[data-testid="profit-input"]');
    if (!el) return;
    el.value = usd.toFixed(2);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    updateConv();
}

function clearProfit() {
    const el = document.querySelector('input[data-testid="profit-input"]');
    if (!el) return;
    el.value = '';
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    updateConv();
}

function writeWinModal(total, attempt = 0) {
    const modal = document.querySelector('.game-result-wrap.win');
    if (!modal) { if (attempt < 40) setTimeout(() => writeWinModal(total, attempt+1), 50); return; }
    const t = modal.querySelector('span[data-ds-text="true"][variant="neutral-subtle"]')
           || modal.querySelector('.payout-result .currency .content span span');
    if (t) t.textContent = fmtUSD(total);
    else if (attempt < 40) setTimeout(() => writeWinModal(total, attempt+1), 50);
}

// ─────────────────────────────────────────────
//  BET BUTTON STATE
// ─────────────────────────────────────────────
function updateBetBtn() {
    const btn = document.querySelector('button[data-testid="bet-button"],button[class*="bet"]');
    const inp = getBetInput();
    if (!btn || !inp) return;
    const n   = parseFloat(inp.value);
    const bad = !(isFinite(n) && n > 0 && n <= balance);
    btn.disabled      = bad;
    btn.style.filter  = bad ? 'grayscale(.2)' : '';
    btn.style.opacity = bad ? '.7' : '';
    btn.style.cursor  = bad ? 'not-allowed' : '';
}

// ─────────────────────────────────────────────
//  SETTLEMENT
// ─────────────────────────────────────────────
function settleWin(multiplier, tag) {
    if (!roundId || settled || !isFinite(multiplier)) return;
    const bet = currentBet > 0 ? currentBet : lastBet;
    if (!(bet > 0)) return;
    settled = true;
    const profit = bet * (multiplier - 1);
    const total  = bet + profit;
    balance += total;
    if (balance < 0) balance = 0;
    lsSet('sudo_balance', balance);
    updateBal();
    setProfitUSD(Math.max(0, profit));
    writeWinModal(total);
    lastBet = bet; currentBet = 0;
    betInProgress = false; profitMult = null;
    roundAt = 0; lossGuard = false; roundId = null;
    updateBetBtn();
}

function settleLoss() {
    if (settled) return;
    settled = true;
    clearProfit();
    lastBet = currentBet || lastBet;
    currentBet = 0; betInProgress = false;
    profitMult = null; roundAt = 0;
    lossGuard = true; roundId = null; bjNode = null;
    updateBetBtn();
}

function checkWinModal() {
    if (onBJ() || onLimbo() || settled) return;
    const modal = document.querySelector('.game-result-wrap.win');
    if (!modal) return;
    const span = modal.querySelector('.number-multiplier span');
    if (!span) return;
    const m = parseFloat(span.textContent.replace(/[^\d.]/g,''));
    if (isFinite(m)) settleWin(m, 'modal');
}

function monitorMult() {
    if (isInstant() || !betInProgress) return;
    const m = getMultFromLabel();
    if (!isFinite(m) || m === profitMult) return;
    profitMult = m;
    setProfitUSD(Math.max(0, currentBet * (m - 1)));
}

function startLossMonitor() {
    if (lossTimer) clearInterval(lossTimer);
    lossTimer = setInterval(() => {
        if (isInstant()) return;
        const cashout = document.querySelector('button[data-testid="cashout-button"]');
        const betBtn  = document.querySelector('button[data-testid="bet-button"]');
        const elapsed = roundAt ? Date.now() - roundAt : 0;
        if (betInProgress && !settled && betBtn && !cashout) {
            if (elapsed > 12000 || (elapsed > 2000 && !lossGuard)) settleLoss();
        }
    }, 350);
}

// ─────────────────────────────────────────────
//  BLACKJACK
// ─────────────────────────────────────────────
function bjScan() {
    if (!onBJ()) { bjNode = null; return; }
    if (!bjNode || !document.contains(bjNode))
        bjNode = document.querySelector('[data-testid="player"] div.value,[data-testid="player"] [class*="value"],.player .value');
    if (!bjNode || !betInProgress || !roundId || settled) return;
    const s = ` ${(bjNode.className||'').toLowerCase()} `;
    if (/\swin\s/.test(s))             { settleWin(2, 'bj');   return; }
    if (/\s(draw|tie|push)\s/.test(s)) { settleWin(1, 'push'); return; }
    if (/\s(lose|loss)\s/.test(s))     { settleLoss(); }
}

// ─────────────────────────────────────────────
//  LIMBO
// ─────────────────────────────────────────────
function limboScan() {
    if (!onLimbo() || !betInProgress || settled) return;
    const frame  = document.querySelector('[data-testid="game-frame"]');
    const result = document.querySelector('.game-content .result');
    if (!frame || !result) return;
    const bid = frame.dataset.lastBet;
    if (!bid || bid === lLastId) return;
    const tgt = parseFloat(document.querySelector('input[data-testid="target-multiplier"]')?.value || '0');
    if (!isFinite(tgt)) return;
    lLastId = bid;
    if ((result.style.color||'').includes('green')) settleWin(tgt, 'limbo');
    else settleLoss();
}

// ─────────────────────────────────────────────
//  INPUT CLONE
// ─────────────────────────────────────────────
function cloneInput() {
    const wrap = document.querySelector('div.input-wrap[class*="svelte-"],div[class*="input-wrap"]');
    if (!wrap || wrap === original) return;
    const prevInp = cloned?.querySelector('input[data-testid="input-game-amount"],input[type="number"]');
    if (prevInp) typed = prevInp.value;
    original = wrap;
    cloned?.remove();
    const cl = wrap.cloneNode(true);
    cl.setAttribute('data-clone', 'true');
    cl.querySelectorAll('*').forEach(e => { e.style.transition='none'; e.style.animation='none'; });
    cl.querySelectorAll('input,button,select,textarea').forEach(e => e.disabled = false);
    wrap.style.cssText += ';opacity:0;pointer-events:none;position:absolute';
    wrap.parentNode.insertBefore(cl, wrap.nextSibling);
    cloned = cl;
    const inp  = cl.querySelector('input[data-testid="input-game-amount"],input[type="number"]');
    const orig = wrap.querySelector('input[data-testid="input-game-amount"],input[type="number"]');
    if (inp) {
        if (typed)             { inp.value = typed; if (orig) orig.value = typed; }
        else if (!inp.value && orig?.value) inp.value = orig.value;
        const mirror = debounce(() => { typed = inp.value; if (orig) orig.value = inp.value; updateConv(); updateBetBtn(); }, 50);
        inp.addEventListener('input', mirror);
        inp.addEventListener('keyup', mirror);
        inp.addEventListener('blur', () => {
            const n = parseFloat(inp.value);
            if (isFinite(n)) inp.value = n.toFixed(2);
            if (orig) orig.value = inp.value;
            updateConv(); updateBetBtn();
        });
    }
    const dbl = cl.querySelector('button[data-testid="amount-double"]');
    const hlf = cl.querySelector('button[data-testid="amount-halve"]');
    const syncBtn = () => { if (orig) orig.value = inp?.value; typed = inp?.value || ''; updateConv(); updateBetBtn(); };
    if (dbl && inp) dbl.addEventListener('click', () => { inp.value = Math.min(balance, safeN(inp.value)*2).toFixed(2); syncBtn(); });
    if (hlf && inp) hlf.addEventListener('click', () => { inp.value = Math.max(0, safeN(inp.value)/2).toFixed(2);       syncBtn(); });
    updateBetBtn();
}

// ─────────────────────────────────────────────
//  GLOBAL CLICK
// ─────────────────────────────────────────────
document.addEventListener('click', e => {
    const betBtn     = e.target.closest?.('button[data-testid="bet-button"],button[class*="bet"]');
    const cashoutBtn = e.target.closest?.('button[data-testid="cashout-button"],button[class*="cashout"]');

    if (betBtn) {
        const inp = getBetInput();
        if (!inp) return;
        if (!inp.value || isNaN(parseFloat(inp.value))) {
            if (lastBet > 0) { inp.value = lastBet.toFixed(2); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
        } else { const n = parseFloat(inp.value); if (isFinite(n)) inp.value = n.toFixed(2); }
        const amt = parseFloat(inp.value || '0');
        if (!(isFinite(amt) && amt > 0 && amt <= balance)) {
            updateBetBtn();
            betBtn.animate([{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:150});
            return;
        }
        currentBet  = amt; lastBet = amt; pendingHist = amt;
        balance -= amt;
        if (balance < 0) balance = 0;
        lsSet('sudo_balance', balance);
        updateBal();
        roundId = newRound(); settled = false; betInProgress = true;
        profitMult = null; clearProfit(); roundAt = Date.now(); lossGuard = false; bjNode = null; lLastId = null;
        updateBetBtn();
        setTimeout(startLossMonitor, 250);
    }

    if (cashoutBtn) betInProgress = false;
});

// ─────────────────────────────────────────────
//  INTERVALS — stored so close button can kill them
// ─────────────────────────────────────────────
const walletInt   = setInterval(syncWallet,              10);
const winInt      = setInterval(checkWinModal,          150);
const multInt     = setInterval(monitorMult,            250);
const tableInt    = setInterval(scanLiveTable,          400);
const tooltipInt  = setInterval(patchTooltips,          200);
const cloneInt    = setInterval(() => { if (!cloned) cloneInput(); }, 1500);
const myBetsInt   = setInterval(() => {
    if (onMyBets()) { startMyBetsObserver(); patchMyBetsTable(); }
    else            { stopMyBetsObserver(); }
}, 300);
const tickInt     = setInterval(() => {
    if (!bjTick) bjTick = setInterval(bjScan,    100);
    if (!lTick)  lTick  = setInterval(limboScan, 150);
}, 500);

// ─────────────────────────────────────────────
//  MUTATION OBSERVER
// ─────────────────────────────────────────────
function startObserver() {
    if (!document.body) return;
    new MutationObserver(muts => {
        if (!walletSpan || !document.contains(walletSpan)) locateWallet();
        cloneInput();
        patchCoinDropdown();
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.classList?.contains('tooltip') || n.querySelector?.('.tooltip-content,.fiat-wrapper')) setTimeout(patchTooltips, 0);
                if (n.querySelector?.('dl.stats-row') || n.classList?.contains('stats-row')) {
                    setTimeout(() => patchStatsDl(lastClickedEntry), 0);
                    setTimeout(() => patchStatsDl(lastClickedEntry), 150);
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
function init() {
    if (!document.body) { setTimeout(init, 300); return; }
    buildUI();
    startObserver();
    locateWallet();
    cloneInput();
    updateBetBtn();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
} else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
}

window.addEventListener('beforeunload', () => lsSet('sudo_balance', balance));
window.__sudoSet = v => { balance = safeN(v, 0); lsSet('sudo_balance', balance); updateBal(); updateBetBtn(); };
})();
