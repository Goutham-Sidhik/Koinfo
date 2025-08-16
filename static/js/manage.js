/* static/js/manage.js
 * Manage page logic: CRUD for categories, debts, goals, transactions,
 * goal overreach guards, debt overpay guard, duplicate protections,
 * visible date icon/placeholder handled in CSS, and a Remaining (This Month) card.
 */

// ---------- Helpers ----------
async function getData(){ 
  const r = await fetch('/api/data', { cache: 'no-store' }); 
  if(!r.ok) throw new Error('Failed to fetch data'); 
  return await r.json(); 
}

function option(o){ return `<option value="${o.id}">${o.name} (${o.type})</option>`; }

function pill(text){ 
  return `<span style="padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.15);background:#0f1530;font-size:12px">${text}</span>`; 
}

function pillBorder(text, borderColor){ 
  return `<span style="padding:4px 8px;border-radius:999px;border: 1px solid ${borderColor};background:#0f1530;font-size:12px">${text}</span>`; 
}

function row(text, right){ 
  return `<div class="row" style="justify-content:space-between;background:#0f1530;border:1px solid rgba(255,255,255,.15);padding:10px;border-radius:12px"><div>${text}</div><div class="row" style="gap:8px">${right||''}</div></div>`; 
}

// Button helper that accepts an id, label (can be text or HTML markup), and a background color.
function btn(id, label, color){ 
  return `<button id="${id}" class="btn" style="background:${color};color:white">${label}</button>`; 
}

// Icons for edit and delete actions.  These use simple emoji as they
// work across browsers without external icon fonts.  Each span has
// aria‑labels for accessibility and a title tooltip for clarity.
const ICON_EDIT = `<span aria-label="Edit" title="Edit" style="font-size:14px">✏️</span>`;
const ICON_DELETE = `<span aria-label="Delete" title="Delete" style="font-size:14px">🗑️</span>`;

function formatINR(v){
  try { return new Intl.NumberFormat(undefined,{style:'currency',currency:'INR'}).format(v||0); }
  catch { return '₹' + Number(v||0).toFixed(2); }
}

function monthKey(iso){
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function daysBetween(a, b) {
  const d1 = new Date(a); d1.setHours(0,0,0,0);
  const d2 = new Date(b); d2.setHours(0,0,0,0);
  return Math.floor((d2 - d1) / (1000*60*60*24));
}


// Returns { label: "15d left" | "Due today" | "Overdue 3d", color: cssColor, done: true || false}.
// If goal reached/exceeded, returns "Completed in Xd" (green) and sets done=true.
function goalUrgency(created, deadline, current, target, completed_at=null) {
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(deadline); end.setHours(0,0,0,0);
  const hasDeadline = !isNaN(end);

  // Normalize created
  const start = created ? new Date(created) : new Date(today);
  start.setHours(0,0,0,0);

  // If completed, short‑circuit and show completion tag
  const t = Number(target) || 0;
  const c = Number(current) || 0;
  if (t > 0 && c >= t) {
    // Prefer explicit completed_at, else estimate using today
    const finish = completed_at ? new Date(completed_at) : new Date(today);
    finish.setHours(0,0,0,0);
    const days = Math.max(0, daysBetween(start, finish));
    return {
      label: days ? `Completed in ${days}d` : 'Completed',
      color: 'var(--ok)',
      done: true
    };
  }

  // Otherwise, compute time remaining vs deadline (if any)
  if (!hasDeadline) return { label: '', color: '#cdd0e0', done: false };

  const left = daysBetween(today, end);
  if (left < 0)  return { label: `Overdue ${Math.abs(left)}d`, color: 'var(--bad)',  done: false };
  if (left === 0) return { label: 'Due today',                color: 'var(--warn)', done: false };
  if (left === 1) return { label: 'Due tomorrow',             color: 'var(--warn)', done: false };
  if (left <= 15) return { label: `Due in ${left}d`,          color: 'var(--warn)', done: false };
  return             { label: `${left}d left`,                 color: 'var(--ok)',   done: false };
}

// Color for CURRENT amount based on progress %
function goalProgressColor(current, target) {
  const t = Math.max(0, Number(target) || 0);
  const c = Math.max(0, Number(current) || 0);
  if (t <= 0) return '#cdd0e0';
  const p = c / t;
  if (p >= 1)   return 'var(--ok)';     // reached target
  if (p > 0.0) return 'var(--sav)';   // mid progress (violet)
  if (p === 0.0) return 'var(--bad)';
  return 'var(--fg)';                     
}

// ----- Remaining (This Month) helpers -----
/**
 * Compute remaining budget for the current period.
 * The period begins on the day of month defined by window._cycleStartDay.
 * The previous period’s leftover is carried forward into the current remaining.
 *
 * @param {Object} data The full data model from the backend
 * @param {Array} cats The categories list
 * @returns {Object} {inc: number, exp: number, sav: number, remaining: number}
 */
function computeRemainingThisMonth(data, cats){
  const startDay = Math.max(1, Math.min(31, parseInt(window._cycleStartDay || 1)));
  const today = new Date();
  today.setHours(0,0,0,0);
  // Determine the start of the current budget period
  let curStart;
  if (today.getDate() >= startDay) {
    curStart = new Date(today.getFullYear(), today.getMonth(), startDay);
  } else {
    // Start day is in previous month
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, startDay);
    curStart = prevMonth;
  }
  // Next period start (one month after curStart)
  const nextStart = new Date(curStart.getFullYear(), curStart.getMonth() + 1, curStart.getDate());
  // Previous period start (one month before curStart)
  const prevStart = new Date(curStart.getFullYear(), curStart.getMonth() - 1, curStart.getDate());

  const txns = data.transactions || [];
  const typeOf = (id)=> (cats.find(c=>c.id===id)||{}).type;
  // Helper to determine if a date is within [start, end)
  const inPeriod = (d, start, end) => d >= start && d < end;

  const curTxns = txns.filter(t => {
    const d = new Date(t.date);
    return inPeriod(d, curStart, nextStart);
  });
  // All transactions strictly before the current cycle start = full carryover
  const carryTxns = txns.filter(t => {
    const d = new Date(t.date);
    return d < curStart;
  });
  // Sums for a list
  const sumIncome  = list => list.filter(t=> typeOf(t.category_id)==='income' && !t.use_open_balance).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  // const sumOutflow = list => list.filter(t=> typeOf(t.category_id)!=='income' && !t.use_open_balance).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const sumExpflow = list => list.filter(t=> typeOf(t.category_id)==='expense' && !t.use_open_balance).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const sumSavflow = list => list.filter(t=> typeOf(t.category_id)==='saving' && !t.use_open_balance).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const incCarry = sumIncome(carryTxns);
  const expCarry = sumExpflow(carryTxns);
  const savCarry = sumSavflow(carryTxns);
  const prevRemaining = incCarry - (expCarry + savCarry);
  // const outPrev = sumOutflow(prevTxns);
  // const prevRemaining = incPrev - (expPrev + savPrev);
  const incCur = sumIncome(curTxns);
  // const outCur = sumOutflow(curTxns);
  const expCur = sumExpflow(curTxns);
  const savCur = sumSavflow(curTxns);
  const remaining = prevRemaining + (incCur - (expCur + savCur));
  return { inc: incCur, exp: expCur, sav:savCur, remaining };
}

function renderRemainingCard(data, cats, cycleStart, cycleEnd){
  const amtEl  = document.getElementById('remainingAmt');
  const noteEl = document.getElementById('remainingNote');
  const paceEl = document.getElementById('remainingPace'); // add this element in HTML
  if(!amtEl || !noteEl) return;

  // Current month figures
  const {inc, exp, sav, remaining} = computeRemainingThisMonth(data, cats);
  // Add the opening balance to the computed remaining amount.  The
  // opening balance represents money carried over from before using the
  // app and should be treated as part of the available budget.
  // const openBal = parseFloat(data.open_balance || 0);
  // Subtract the sum of all transactions flagged as drawing from the
  // opening balance so that the final remaining correctly reflects
  // available funds.  Transactions that use the opening balance reduce
  // both the balance and the monthly budget.

  const finalRemaining = remaining;
  amtEl.textContent = formatINR(finalRemaining);
  amtEl.style.color = finalRemaining >= 0 ? 'var(--ok)' : 'var(--bad)';

  // Two-line note with bullets
  if (finalRemaining > 0) {
    noteEl.innerHTML = `
      • <span style="color:var(--ok)">Income (${formatINR(inc)})</span><br>
      • Expenses (${formatINR(exp)}) • Savings (${formatINR(sav)})
    `;
  } else if (finalRemaining == 0) {
    noteEl.innerHTML = `
      • <span style="color:var(--muted)">Income (${formatINR(inc)})</span><br>
      • <span style="color:var(--muted)">Expenses (${formatINR(exp)}) • Savings (${formatINR(sav)})</span>
    `;
  } else {
    noteEl.innerHTML = `
      • Income (${formatINR(inc)})<br>
      • <span style="color:var(--bad)">Expenses (${formatINR(exp)}) • Savings (${formatINR(sav)})</span>
    `;
  }

  // ----- MTD pace vs last month -----
  if (paceEl) {

      const today = new Date();

      const typeOf = (id)=> (cats.find(c=>c.id===id)||{}).type;
      const txns = data.transactions || [];

      // Helpers
      const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
      const clamp    = (d, min, max) => d < min ? min : d > max ? max : d;

      // Derive last cycle window from current cycle window
      const cycleLenDays = Math.round((cycleEnd - cycleStart) / 86400000) + 1;
      const lastCycleEnd   = addDays(cycleStart, -1);
      const lastCycleStart = addDays(lastCycleEnd, -(cycleLenDays - 1));

      // "Till date" endpoints
      const curCTDEnd   = clamp(today, cycleStart, cycleEnd);
      const daysElapsed = Math.floor((curCTDEnd - cycleStart) / 86400000) + 1; // inclusive
      const lastCTDEnd  = addDays(lastCycleStart, daysElapsed - 1);

      const sumRange = (from, to) => txns
        .filter(t => {
          const d = new Date(t.date);
          if (d < from || d > to) return false;
          if (typeOf(t.category_id) === 'income') return false;
          // If you use this flag in your app, keep this extra guard:
          if (t.use_open_balance === true) return false;
          return true;
        })
        .reduce((a, t) => a + Math.abs(+t.amount || 0), 0);

      const curCTD  = sumRange(cycleStart, curCTDEnd);
      const lastCTD = sumRange(lastCycleStart, lastCTDEnd);
      const diff    = curCTD - lastCTD;

    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '＝';
    const text  = diff === 0
      ? 'same as last CTD'
      : `${formatINR(Math.abs(diff))} vs last CTD`;

    // Optional coloring: up (more outflow) = red, down = green
    paceEl.textContent = `${arrow} ${text}`;
    paceEl.style.color = diff > 0 ? 'var(--bad)' : diff < 0 ? 'var(--ok)' : 'var(--muted)';
  }
}


// ---------- Main renderer ----------
async function refresh(){
  const data = await getData();
  const cats = data.categories || [];

  // ----- Opening Balance first‑time notification -----
  // If no opening balance has been set (value is zero) and we haven't
  // previously notified the user (tracked via localStorage), show a
  // one‑button dialog explaining the purpose of the Opening Balance
  // category.  Once acknowledged, we mark it as notified so it will
  // not show again in this browser.
  const openBalCheck = parseFloat(data.open_balance || 0);
  // localStorage.clear();
  if((localStorage.getItem('openBalSet') !== '1') && openBalCheck === 0){
    // Set a flag immediately to avoid re‑prompting during the async call
    // localStorage.setItem('openBalSet','');
    setTimeout(async () => {
      const msg = `
        <p style="color: var(--fg);">
          Note: Record unaccounted existing amount in: "Opening Balance"
        </p>
        <p style="color: var(--muted); font-size: 0.9em; margin-top: 4px;">
          It is an already existing amount you may have saved until now.
        </p>
      `;
      await showDialog(msg, 'Got it');
      localStorage.setItem('openBalSet','1');
    }, 0);
  }
  // Derive a list of active (non-deleted) categories for form selections.
  const activeCats = cats.filter(c => !c.deleted);

  // Expose link maps for UI logic (goal/ debt categories)
  window._goalCatIds = new Set((data.goals||[]).map(g=>g.linked_category_id).filter(Boolean));
  window._debtCatIds = new Set((data.debts||[]).map(d=>d.linked_category_id).filter(Boolean));

  // Populate category select (transactions form) using only active categories
  const txnCat = document.getElementById('txnCategory');
  // if (txnCat) txnCat.innerHTML = activeCats.map(option).join('');
  if (txnCat) {
    // Sort categories in alphanumeric order by name
    const sortedCats = [...activeCats].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    txnCat.innerHTML = sortedCats.map(option).join('');
  }
  
  document.getElementById('txnCategory').dispatchEvent(new Event('change'));

  // ----- Categories list (block delete for linked ones) -----
  const catList = document.getElementById('catList');
  const linked = new Set([...(window._goalCatIds||[]), ...(window._debtCatIds||[])]);
  if (catList) {
    // Only display active categories in the category management list
    const catsForList = cats.filter(c => !c.deleted);
    // Sort in alphanumeric order by name
    catsForList.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    // Build the HTML for each active category row
    const catsHtml = catsForList.map(c=>{
      const isLinked = linked.has(c.id);
      const delId = 'delc_' + c.id;
      const right = isLinked ? pill('linked') : btn(delId, ICON_DELETE, 'var(--del)');
      setTimeout(()=>{ 
        if(!isLinked){ 
          const el = document.getElementById(delId);
          if(el) el.addEventListener('click', async()=>{
            // Count how many transactions reference this category. These transactions
            // will become locked once the category is deleted.
            const txnCount = (data.transactions || []).filter(tx => tx.category_id === c.id).length;
            const plural = txnCount === 1 ? '' : 's';
            const note = txnCount > 0 ? `\n\nNote: ${txnCount} transaction${plural} will be locked.` : '';
            // Custom confirmation modal with transaction count message
            if(await showConfirm(`Delete "${c.name}" permanently? <br> <span style="font-size: 0.85em; color: var(--muted);">${note}</span>`)){
              const r = await fetch(`/api/category/${c.id}`, {method:'DELETE'});
              if(!r.ok){ 
                try{
                  const j = await r.json();
                  showAlert(j.error || 'Delete failed', 'error');
                }catch{
                  showAlert('Delete failed', 'error');
                }
              }
              refresh(); 
            }
          }); 
        } 
      },0);
      const borderColor = c.type === 'income' ? 'var(--inc)' : c.type === 'expense' ? 'var(--exp)' : 
                          c.type === 'saving' ? 'var(--sav)' : 'rgba(255,255,255,.15)'; 
      return row(`${c.name} ${pillBorder(c.type, borderColor)}`, right);
    }).join('');

    // ----- Opening Balance row -----
    const openBal = parseFloat(data.open_balance || 0);
    // Compute how much of the opening balance remains based on
    // transactions explicitly marked as drawing from it.  We sum the
    // absolute values of all transactions with the use_open_balance flag.
    let openBalRemaining = openBal;
    {
      const allTxns = data.transactions || [];
      const totalUsed = allTxns
        .filter(t => t.use_open_balance)
        .reduce((a, t) => a + Math.abs(+t.amount || 0), 0);
      openBalRemaining = openBal - totalUsed;
      if(openBalRemaining < 0) openBalRemaining = 0;
    }
    // Build the opening balance row HTML.  If no opening balance set, we
    // display an invitation to add one.  Otherwise we show remaining vs
    // added values.  The edit button allows updating the value.
    const allTxns = data.transactions || [];
    const totalUsed = allTxns
        .filter(t => t.use_open_balance)
        .reduce((a, t) => a + Math.abs(+t.amount || 0), 0);
    let openLabel;
    if(openBal > 0){
      openLabel = `\
        <div>
          <strong>Opening Balance</strong><br>
          • <span style="font-size:12px;color:var(--sav)"> ${formatINR(totalUsed)} / ${formatINR(openBal)}</span>
        </div>
      `;
    } else {
      openLabel = `\
        <div>
          <strong>Opening Balance</strong><br>
          <span style="font-size:12px;color:var(--muted)">Not set</span>
        </div>
      `;
    }
    const openRow = row(openLabel, btn('edit_openBal', ICON_EDIT, 'var(--edit)'));
    catList.innerHTML = openRow + catsHtml;
    // Attach event for editing the opening balance
    setTimeout(() => {
      const b = document.getElementById('edit_openBal');
      if(b){
        b.addEventListener('click', async () => {
          // Use a custom prompt dialog for entering the opening balance
          const ans = await showPromptInput('Enter opening balance amount:', 'Amount', openBal > 0 ? String(openBal) : '');
          if(ans === null) return;
          const trimmed = String(ans).replace(/,/g,'').trim();
          const val = parseFloat(trimmed);
          if (isNaN(val) || val < 0) return showAlert('Enter valid amount', 'error');
          const allTxns = data.transactions || [];
          const totalUsed = allTxns
              .filter(t => t.use_open_balance)
              .reduce((a, t) => a + Math.abs(+t.amount || 0), 0);
          if (val < totalUsed) return showAlert(`Opening Balance ≥ Used (${formatINR(totalUsed)})`, 'error');
          // Persist the new value via API
          const res = await fetch('/api/open_balance', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({open_balance: val})});
          if(!res.ok){
            let msg = res.status;
            try{ const j = await res.json(); if(j?.error) msg = j.error; }catch{}
            showAlert('Save opening balance failed: '+msg, 'error');
            return;
          }
          // Mark that we've set the opening balance so we don't prompt again
          localStorage.setItem('openBalSet','1');
          refresh();
        });
      }
    }, 0);
  }

  // ----- Debts list -----
  const debtList = document.getElementById('debtList');
  if (debtList) {
    const sortedDebts = (data.debts || []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    debtList.innerHTML = sortedDebts.map(d=>{
      const editId = 'editd_' + d.id;
      const delId = 'deld_' + d.id;
      const kindLabel = d.kind === 'receivable' ? 'Receivable (Claims)' : 'Payable (Debt)';
      setTimeout(()=>{
        const eBtn = document.getElementById(editId);
        if(eBtn) eBtn.addEventListener('click', ()=>{
          document.getElementById('debtId').value = d.id;
          document.getElementById('debtName').value = d.name;
          document.getElementById('debtBalance').value = d.balance;
          document.getElementById('debtKind').value = d.kind || 'payable';
          document.getElementById('debtSubmit').textContent = 'Save Debt';
          document.getElementById('debtCancelEdit').style.display = '';
        });
        const xBtn = document.getElementById(delId);
        if(xBtn) xBtn.addEventListener('click', async()=>{
          // Count transactions referencing this debt's linked category
          const txnCount = (data.transactions || []).filter(tx => tx.category_id === d.linked_category_id).length;
          const plural = txnCount === 1 ? '' : 's';
          const note = txnCount > 0 ? `\n\nNote: ${txnCount} transaction${plural} will be locked.` : '';
          if(await showConfirm(`Delete "${d.name}" Permanently? <br> <span style="font-size: 0.85em; color: var(--muted);">${note}</span>`)){
            await fetch(`/api/debt/${d.id}`, {method:'DELETE'});
            refresh();
          }
        });
      },0);
      const borderColor = d.kind === 'receivable' ? 'var(--inc)' : 'var(--exp)';
      return row(
        `${d.name} — ${formatINR(d.balance)} ${pillBorder(kindLabel, borderColor)}`,
        // Use icons instead of text for edit/delete
        btn(editId, ICON_EDIT, 'var(--edit)') + btn(delId, ICON_DELETE, 'var(--del)')
      );
    }).join('');
  }

  // ----- Goals list -----
  const goalList = document.getElementById('goalList');
  if (goalList) {
    const sortedGoals = (data.goals || []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    goalList.innerHTML = sortedGoals.map(g=>{
      const editId = 'editg_' + g.id;
      const delId = 'delg_' + g.id;
      setTimeout(()=>{
        const eBtn = document.getElementById(editId);
        if(eBtn) eBtn.addEventListener('click', ()=>{
          document.getElementById('goalId').value = g.id;
          document.getElementById('goalName').value = g.name;
          document.getElementById('goalTarget').value = g.target;
          document.getElementById('goalDeadline').value = g.deadline;
          document.getElementById('goalSubmit').textContent = 'Save Goal';
          document.getElementById('goalCancelEdit').style.display = '';
        });
        const xBtn = document.getElementById(delId);
        if(xBtn) xBtn.addEventListener('click', async()=>{
          // Count transactions referencing this goal's linked category
          const txnCount = (data.transactions || []).filter(tx => tx.category_id === g.linked_category_id).length;
          const plural = txnCount === 1 ? '' : 's';
          const note = txnCount > 0 ? `\n\nNote: ${txnCount} transaction${plural} will be locked.` : '';
          if(await showConfirm(`Delete "${g.name}" permanently? <br> <span style="font-size: 0.85em; color: var(--muted);">${note}</span>`)){
            await fetch(`/api/goal/${g.id}`, {method:'DELETE'});
            refresh();
          }
        });
      },0);
      
      const urg = goalUrgency(g.created, g.deadline, g.current, g.target, g.completed_at);
      const curColor = goalProgressColor(g.current, g.target);

      const left = `
        <div>
          <strong>${g.name}</strong> —
          <span style="color:${curColor}"> ${formatINR(g.current)}</span> / ${formatINR(g.target)}<br>
          ${g.deadline ? `<span style="color:#cdd0e0;font-size:12px">${g.deadline}</span>` : ''}
          <span style="color:${urg.color};font-size:12px">${urg.done ? '• ' : '• '}${urg.label}</span>
        </div>
      `;
      return row(left, btn(editId, ICON_EDIT, 'var(--edit)') + btn(delId, ICON_DELETE, 'var(--del)'));
    }).join('');
  }

  // ----- Remaining card (top-left, separate section) -----
  // the selected cycle start day (window._cycleStartDay).  If today's date
  // is before the start day, the cycle began last month; otherwise, it
  // started this month.  The cycle ends just before the same day in the
  // next month.
  const cycleDay = Math.max(1, Math.min(31, parseInt(window._cycleStartDay || 1)));
  const today = new Date(); today.setHours(0,0,0,0);
  let cycleStart;
  if (today.getDate() >= cycleDay) {
    cycleStart = new Date(today.getFullYear(), today.getMonth(), cycleDay);
  } else {
    // If the current day falls before the cycle start day, start from
    // the previous month (handles wrap‑around for January)
    cycleStart = new Date(today.getFullYear(), today.getMonth() - 1, cycleDay);
  }
  // The end of the cycle is the same anchor day in the next month
  const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, cycleStart.getDate());

  renderRemainingCard(data, cats, cycleStart, cycleEnd);

  // ----- Transactions list (current cycle) -----
  // Compute the start and end of the current budget cycle based on
  // Filter transactions within [cycleStart, cycleEnd)
  const txns = [...(data.transactions || [])]
    .filter(t => {
      const d = new Date(t.date);
      return d >= cycleStart && d < cycleEnd;
    })
    .sort((a, b) => {
      // 1) date desc (by day, ignoring time)
      const dd = new Date(b.date) - new Date(a.date);
      if (dd !== 0) return dd;

      // 2) alphanumeric by name/description (A2 before A10)
      const aKey = (a.name ?? a.description ?? '').toString();
      const bKey = (b.name ?? b.description ?? '').toString();
      const cmp = aKey.localeCompare(bKey, undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return cmp;

      // 3) stable fallback
      return (a.id ?? 0) - (b.id ?? 0);
    });
    // .sort((a,b) => new Date(b.date) - new Date(a.date));

  const txnList = document.getElementById('txnList');
  if (txnList) {
    txnList.innerHTML = txns.map(t=>{
      const cat = cats.find(c=>c.id===t.category_id);
      const isDeleted = cat && cat.deleted;
      const editId = 'editt_' + t.id;
      const delId = 'delt_' + t.id;
      // Attach handlers only if category exists and is not deleted
      setTimeout(()=>{
        if(cat && !isDeleted){
          const eBtn = document.getElementById(editId);
          if(eBtn) eBtn.addEventListener('click', ()=>{
          document.getElementById('txnId').value = t.id;
            document.getElementById('txnDate').value = t.date;
            document.getElementById('txnAmount').value = Math.abs(t.amount);
            document.getElementById('txnCategory').value = t.category_id;
            document.getElementById('txnNote').value = t.note || '';
            // Set the opening balance checkbox state and disable it when editing
            const openChk = document.getElementById('txnUseOpenBal');
            if(openChk){
              openChk.checked = !!t.use_open_balance;
              openChk.disabled = true;
            }
            document.getElementById('txnSubmit').textContent = 'Save';
            document.getElementById('txnCancelEdit').style.display = '';
            document.getElementById('txnCategory').dispatchEvent(new Event('change'));
            // Store original transaction details for validation during update
            window._editingTxn = { id: t.id, amount: Number(t.amount), category_id: t.category_id, use_open_balance: !!t.use_open_balance };
          });
          const xBtn = document.getElementById(delId);
          if(xBtn) xBtn.addEventListener('click', async()=>{
            const cName = cat ? cat.name : 'this';
            const note = 'Note: Permanently remove transaction.';
            if(await showConfirm(`Delete "${cName}" ? <br> <span style="font-size: 0.85em; color: var(--muted);">${note}</span>`)){
              await fetch(`/api/transaction/${t.id}`, {method:'DELETE'});
              refresh();
            }
          });
        }
      },0);

      // Determine display values
      const txnColor = cat && {income:'var(--inc)', expense:'var(--exp)', saving:'var(--sav)'}[cat.type] || 'var(--muted)';
      const amountText = `<span style="color:${txnColor}">${formatINR(Math.abs(+t.amount || 0))}</span>`;
      const pillOB = t.use_open_balance ? 'openBal' : '';
      const nameText = cat ? cat.name : 'Unknown';
      const firstLine = pillOB === 'openBal' ? `<strong>${nameText}</strong> <span style="margin-left:20px;">${pill(pillOB)}</span? <br>` : `<strong>${nameText}</strong>`;
      const left = `
        ${firstLine}
        <div style="color:#cdd0e0;font-size:12px;margin-top:12px">${t.date} • ${amountText}</div>
        ${t.note ? `<div style="color:#cdd0e0;font-size:12px;margin-top:12px;word-break:break-word">${t.note}</div>` : ''}
      `;
      // If category missing or deleted, disable edit/delete and show indicator
      const right = (cat && !isDeleted)
        // Replace textual buttons with icons
        ? btn(editId, ICON_EDIT, 'var(--edit)') + btn(delId, ICON_DELETE, 'var(--del)')
        : pill('Category Deleted');
      return row(left, right);
    }).join('');
  }
}

// ---------- Forms ----------

// Create Category
document.getElementById('catForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    const res = await fetch('/api/category', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if(!res.ok){ 
      let errText = String(res.status); 
      try{ const j = await res.json(); if(j?.error) errText = j.error; }catch{}; 
      // Use custom pop‑up instead of blocking alert
      showAlert('Create category failed: ' + errText, 'error'); 
      return; 
    }
    e.target.reset();
    refresh();
  } catch(err){ 
    showAlert('Network error while creating category', 'error');
  }
});

// Transactions: Add / Save (includes goal/debt logic)
document.getElementById('txnForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = (document.getElementById('txnId').value || '').trim();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  let amt = Math.abs(parseFloat(payload.amount||0));
  const selCat = payload.category_id;
  // Capture whether this transaction should draw from the opening balance.
  const useOpenBal = document.getElementById('txnUseOpenBal')?.checked;

  // Determine if editing an existing transaction and capture its original amount and category
  const editing = id && window._editingTxn && window._editingTxn.id === id;
  const oldAmt  = editing ? Math.abs(Number(window._editingTxn.amount) || 0) : 0;
  const oldCat  = editing ? window._editingTxn.category_id : null;

  // Load current data and categories for remaining budget and goal/debt checks
  const data = await getData();
  const cats = data.categories || [];

  // ----- Check against remaining budget for this period -----
  // Determine the category type
  const catObj = cats.find(c => c.id === selCat) || {};
  const catType = catObj.type || 'expense';
  // Compute the current remaining amount (includes carry‑forward)
  const { remaining: budgetRemaining } = computeRemainingThisMonth(data, cats);
  // Include the opening balance when determining available funds for
  // outflow.  Opening balance should augment the budget.
  const budgetRemainingIncludingOpen = useOpenBal
  ? budgetRemaining + parseFloat(data.open_balance || 0)
  : budgetRemaining;
  let deltaOut = 0;
  if (catType !== 'income') {
    if (editing && oldCat === selCat) {
      // Additional spend beyond original amount
      deltaOut = amt - oldAmt;
      if (deltaOut < 0) deltaOut = 0;
    } else {
      // New transaction or changed category to non‑income
      deltaOut = amt;
    }
  }
  if(deltaOut > budgetRemainingIncludingOpen){
    showAlert('Exceeds Available Amount', 'error');
    return;
  }

  // ----- Goal logic: soft‑cap warning when deposit exceeds the goal target -----
  if(window._goalCatIds && window._goalCatIds.has(selCat)){
    const goal = (data.goals||[]).find(g=>g.linked_category_id===selCat);
    if(goal){
      const cur = parseFloat(goal.current || 0);
      const tgt = parseFloat(goal.target || 0);
      let projected;
      if(editing && oldCat === selCat){
        const delta = amt - oldAmt;
        projected = cur + delta;
      } else {
        projected = cur + amt;
      }
      if(tgt > 0 && projected > tgt){
        const over = projected - tgt;
        showAlert(`Goal Exceeded by ${formatINR(over)}.`, 'warn');
      }
      if(tgt > 0 && projected == tgt){
        showAlert(`Hurray: Goal Reached.`, 'info');
      }
    }
  }

  // ----- Debt logic: prevent paying more than the remaining balance -----
  if(window._debtCatIds && window._debtCatIds.has(selCat)){
    const debt = (data.debts||[]).find(d=>d.linked_category_id===selCat);
    if(debt){
      const balance = parseFloat(debt.balance || 0);
      let exceeds;
      if(editing && oldCat === selCat){
        const delta = amt - oldAmt;
        exceeds = delta > balance;
      } else {
        exceeds = amt > balance;
      }
      if(exceeds){
        showAlert('Payment Exceeds Balance', 'error');
        return;
      }
    }
  }

  const body = {date: payload.date, amount: amt, category_id: selCat, note: payload.note, use_open_balance: !!useOpenBal};

  if(id){
    await fetch(`/api/transaction/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  } else {
    await fetch('/api/transaction', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  }

  e.target.reset();
  document.getElementById('txnId').value = '';
  document.getElementById('txnSubmit').textContent = 'Add';
  document.getElementById('txnCancelEdit').style.display = 'none';
  refresh();
});

document.getElementById('txnCancelEdit')?.addEventListener('click', ()=>{
  document.getElementById('txnForm').reset();
  document.getElementById('txnId').value = '';
  document.getElementById('txnSubmit').textContent = 'Add';
  document.getElementById('txnCancelEdit').style.display = 'none';
  // Reset and enable the opening balance checkbox when cancelling edit
  const openChk = document.getElementById('txnUseOpenBal');
  if(openChk){
    openChk.disabled = false;
    openChk.checked = false;
  }
});

// Debts
document.getElementById('debtForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = (document.getElementById('debtId').value || '').trim();
  const fd = new FormData(e.target);
  const p = Object.fromEntries(fd.entries());
  const body = { name: p.name, balance: parseFloat(p.balance||0), kind: p.kind || 'payable' };
  let res;
  if(id){
    res = await fetch(`/api/debt/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  } else {
    res = await fetch('/api/debt', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  }
  if(!res.ok){ 
    let msg = res.status; 
    try{ const j = await res.json(); if(j?.error) msg = j.error; }catch{} 
    showAlert('Save debt failed: '+msg, 'error'); 
    return; 
  }
  e.target.reset();
  document.getElementById('debtId').value = '';
  document.getElementById('debtSubmit').textContent = 'Add Debt';
  document.getElementById('debtCancelEdit').style.display = 'none';
  refresh();
});

document.getElementById('debtCancelEdit')?.addEventListener('click', ()=>{
  document.getElementById('debtForm').reset();
  document.getElementById('debtId').value = '';
  document.getElementById('debtSubmit').textContent = 'Add Debt';
  document.getElementById('debtCancelEdit').style.display = 'none';
});

// Goals
document.getElementById('goalForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = (document.getElementById('goalId').value || '').trim();
  const fd = new FormData(e.target);
  const p = Object.fromEntries(fd.entries());
  // require future date
  const today = new Date(); today.setHours(0,0,0,0);
  const dl = p.deadline ? new Date(p.deadline) : null;
  if(!dl || dl <= today){ 
    showAlert('Please choose a deadline after today', 'error'); 
    return; 
  }
  // Build the request body for goals.  We deliberately do not send a
  // 'current' property because progress is tracked automatically via
  // transactions.  Users cannot set the current amount manually.
  const body = { name: p.name, target: parseFloat(p.target||0), deadline: p.deadline };
  let res;
  if(id){
    res = await fetch(`/api/goal/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  } else {
    res = await fetch('/api/goal', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  }
  if(!res.ok){ 
    let msg = res.status; 
    try{ const j = await res.json(); if(j?.error) msg = j.error; }catch{} 
    showAlert('Save goal failed: '+msg, 'error'); 
    return; 
  }
  e.target.reset();
  document.getElementById('goalId').value = '';
  document.getElementById('goalSubmit').textContent = 'Add Goal';
  document.getElementById('goalCancelEdit').style.display = 'none';
  refresh();
});

// set min attribute for goal deadline to today
(function(){
  const el = document.getElementById('goalDeadline');
  if(el){ el.min = new Date().toISOString().split('T')[0]; }
})();

document.getElementById('goalCancelEdit')?.addEventListener('click', ()=>{
  document.getElementById('goalForm').reset();
  document.getElementById('goalId').value = '';
  document.getElementById('goalSubmit').textContent = 'Add Goal';
  document.getElementById('goalCancelEdit').style.display = 'none';
});

// Initial render
refresh();

// ---------- Budget start day setup ----------

function updateCycleRange() {
  const el = document.getElementById('cycleStartDay');
  const out = document.getElementById('cycleDateRange');
  if (!el || !out) return;

  const startDay = parseInt(el.value, 10);
  if (!startDay || startDay < 1 || startDay > 31) { out.textContent = ''; return; }

  const today = new Date();
  let y = today.getFullYear();
  let m = today.getMonth();

  // If today's date is before the start day, the current cycle started last month
  if (today.getDate() < startDay) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }

  // Clamp start day to month's last day (handles 31st, Feb, etc.)
  const lastDayThisMonth = new Date(y, m + 1, 0).getDate();
  const startD = Math.min(startDay, lastDayThisMonth);
  const startDate = new Date(y, m, startD);

  // End date = same anchor next month - 1 day, clamped
  let ey = y, em = m + 1;
  if (em > 11) { em = 0; ey += 1; }
  const lastDayNextMonth = new Date(ey, em + 1, 0).getDate();
  const endAnchor = Math.min(startDay, lastDayNextMonth);
  const endDate = new Date(ey, em, endAnchor);
  endDate.setDate(endDate.getDate() - 1);

  const format = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short'});
  out.textContent = `Current Cycle: ${format(startDate)} to ${format(endDate)}`;
}

document.getElementById('cycleStartDay')?.addEventListener('input', updateCycleRange);
document.addEventListener('DOMContentLoaded', updateCycleRange); // <-- run on load


// Apply saved budget start day or default to 1.  When the user changes
// the value, persist it to localStorage and re‑render the dashboard.
(function(){
  const input = document.getElementById('cycleStartDay');
  if(!input) return;
  // Load saved start day
  const saved = localStorage.getItem('cycleStartDay');
  let day = 1;
  if(saved){
    const n = parseInt(saved);
    if(!isNaN(n) && 1 <= n <= 31) day = n;
  }
  window._cycleStartDay = day;
  input.value = day;
  input.addEventListener('change', () => {
    let val = parseInt(input.value);
    if(isNaN(val) || val < 1) val = 1;
    if(val > 31) val = 31;
    window._cycleStartDay = val;
    localStorage.setItem('cycleStartDay', val.toString());
    refresh();
  });
})();
