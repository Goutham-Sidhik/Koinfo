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

// ---------------- Cycle helpers ----------------
/**
 * Given a date and a cycle anchor day (1–31), return the start date of
 * the budget cycle containing that date.  If the date falls on or after
 * the anchor day, the cycle started this month; otherwise it started
 * last month.  Hours are zeroed out on the returned date.
 *
 * @param {Date|String} date A date or ISO string
 * @param {number} startDay The day of month when each cycle starts
 * @returns {Date} Start of the cycle (00:00:00 time)
 */
function getCycleStartForDate(date, startDay){
  const d = new Date(date);
  if(Number.isNaN(d.getTime())) return new Date();
  d.setHours(0,0,0,0);
  const day = Math.max(1, Math.min(31, parseInt(startDay||1)));
  let y = d.getFullYear();
  let m = d.getMonth();
  if(d.getDate() >= day){
    // cycle begins this month
    return new Date(y, m, day);
  }
  // cycle begins last month
  m -= 1;
  if(m < 0){ m = 11; y -= 1; }
  return new Date(y, m, day);
}

/**
 * Compute remaining budget for a specified cycle.  This uses the
 * same logic as computeRemainingThisMonth but accepts an arbitrary
 * cycle start date and the cycle anchor day.  It excludes
 * transactions flagged with use_open_balance when aggregating
 * income/expense/saving flows.
 *
 * @param {Object} data The full data model
 * @param {Array} cats Category list
 * @param {Date} cycleStart Start date of the cycle (inclusive)
 * @param {number} startDay Day of month when cycles begin
 * @returns {Object} {inc: number, exp: number, sav: number, remaining: number}
 */
function computeRemainingForCycle(data, cats, cycleStart, startDay){
  const txns = data.transactions || [];
  // Next period start (one month after cycleStart)
  const nextStart = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, cycleStart.getDate());
  // Helper to test if date in [start, end)
  const inPeriod = (d, start, end) => d >= start && d < end;
  // Determine category type
  const typeOf = (id)=> (cats.find(c=>c.id===id)||{}).type;
  // Split transactions into carryover (before cycleStart) and current period
  const carryTxns = txns.filter(t => {
    const d = new Date(t.date);
    return d < cycleStart;
  });
  const curTxns = txns.filter(t => {
    const d = new Date(t.date);
    return inPeriod(d, cycleStart, nextStart);
  });
  // Aggregators (excluding use_open_balance)
  // Classification helpers: treat goal withdrawals as income and debt claims as expense
  const sumIncome  = list => list.filter(t => {
    if (t.use_open_balance) return false;
    // goal withdrawals are income regardless of category type
    if (t.goal_withdrawal) return true;
    const type = typeOf(t.category_id);
    return type === 'income' && !t.debt_claim;
  }).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const sumExpflow = list => list.filter(t => {
    if (t.use_open_balance) return false;
    // debt claims count as expense regardless of category type
    if (t.debt_claim) return true;
    const type = typeOf(t.category_id);
    return type === 'expense';
  }).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const sumSavflow = list => list.filter(t => {
    if (t.use_open_balance) return false;
    // Skip withdrawals as saving (withdrawals shouldn't be counted as saving outflow)
    if (t.goal_withdrawal) return false;
    const type = typeOf(t.category_id);
    return type === 'saving';
  }).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const incCarry = sumIncome(carryTxns);
  const expCarry = sumExpflow(carryTxns);
  const savCarry = sumSavflow(carryTxns);
  const prevRemaining = incCarry - (expCarry + savCarry);
  const incCur = sumIncome(curTxns);
  const expCur = sumExpflow(curTxns);
  const savCur = sumSavflow(curTxns);
  const remaining = prevRemaining + (incCur - (expCur + savCur));
  return { inc: incCur, exp: expCur, sav: savCur, remaining };
}

function toggleHistoryLabel() {
  const card = document.querySelector(".card--transactions"); // scope to this card
  const toggle = card.querySelector("#txnShowAll");
  const cycleSpan = card.querySelector(".card__title span");

  cycleSpan.textContent = toggle.checked ? "(Full History)" : "(Cycle History)";
}

const txnToggle = document.querySelector(".card--transactions #txnShowAll");
txnToggle.addEventListener("change", toggleHistoryLabel);

// run once on load so it matches initial state
toggleHistoryLabel();

/**
 * Format a cycle start date into a human‑friendly range string like
 * "01 Jan to 31 Jan".  Computes the end of the cycle as the day
 * before the same anchor day in the next month.  Handles months with
 * varying lengths.
 *
 * @param {Date} cycleStart Start of the cycle
 * @returns {string} Formatted range (e.g. "01 Jan to 28 Feb")
 */
function formatCycleRange(cycleStart){
  const start = new Date(cycleStart);
  start.setHours(0,0,0,0);
  const nextStart = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
  const endDate = new Date(nextStart);
  endDate.setDate(endDate.getDate() - 1);
  const fmt = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short'});
  return `${fmt(start)} to ${fmt(endDate)}`;
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
  // Classification helpers: treat goal withdrawals as income and debt claims as expense
  const sumIncome  = list => list.filter(t => {
    if (t.use_open_balance) return false;
    if (t.goal_withdrawal) return true;
    const type = typeOf(t.category_id);
    return type === 'income' && !t.debt_claim;
  }).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  // const sumOutflow = list => list.filter(t=> typeOf(t.category_id)!=='income' && !t.use_open_balance).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const sumExpflow = list => list.filter(t => {
    if (t.use_open_balance) return false;
    if (t.debt_claim) return true;
    const type = typeOf(t.category_id);
    return type === 'expense';
  }).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
  const sumSavflow = list => list.filter(t => {
    if (t.use_open_balance) return false;
    if (t.goal_withdrawal) return false;
    const type = typeOf(t.category_id);
    return type === 'saving';
  }).reduce((a,t)=>a+Math.abs(+t.amount||0),0);
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
  if((sessionStorage.getItem('openBalSet') !== '1') && openBalCheck === 0){
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
      sessionStorage.setItem('openBalSet','1');
    }, 0);
  }
  // Derive a list of active (non-deleted) categories for form selections.
  const activeCats = cats.filter(c => !c.deleted);

  // Expose link maps for UI logic (goal/debt categories)
  window._goalCatIds = new Set((data.goals||[]).map(g=>g.linked_category_id).filter(Boolean));
  window._debtCatIds = new Set((data.debts||[]).map(d=>d.linked_category_id).filter(Boolean));
  // Map linked debt category id to its kind (payable/receivable) to determine claim behavior
  window._debtInfoMap = {};
  (data.debts || []).forEach(d => {
    if(d.linked_category_id){
      window._debtInfoMap[d.linked_category_id] = d.kind || 'payable';
    }
  });

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

  // ----- Populate transaction filter dropdowns -----
  // Category filter: include active categories and deleted categories that have at least one transaction. Deleted categories with no transactions are omitted.
  const filterCatSelect = document.getElementById('txnFilterCat');
  if(filterCatSelect){
    const prevVal = window._filterCat || '';
    // Build a set of category IDs that appear in transactions
    const usedCatIds = new Set();
    (data.transactions || []).forEach(t => {
      if(t.category_id){
        usedCatIds.add(t.category_id);
      }
    });
    const allCats = (data.categories || []).slice().sort((a,b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    const opts = [`<option value="">All Categories</option>`];
    allCats.forEach(c => {
      // Skip deleted categories that have no transactions referencing them
      if(c.deleted && !usedCatIds.has(c.id)) return;
      let label = c.name;
      if(c.deleted) label += ' (deleted)';
      opts.push(`<option value="${c.id}">${label}</option>`);
    });
    filterCatSelect.innerHTML = opts.join('');
    filterCatSelect.value = prevVal;
  }

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
  // Build transaction list with cycle and filter logic
  let txns = (data.transactions || []).slice();
  // Filter by cycle if show-all is not checked
  if(!window._showAllTxns){
    txns = txns.filter(t => {
      const d = new Date(t.date);
      return d >= cycleStart && d < cycleEnd;
    });
  }
  // Filter by category type.  For debt claims treat as expense, goal withdrawals as income.
  if(window._filterType){
    const desired = window._filterType;
    txns = txns.filter(t => {
      const cat = cats.find(c => c.id === t.category_id);
      let actualType = cat ? cat.type : '';
      if(t.goal_withdrawal) actualType = 'income';
      else if(t.debt_claim) actualType = 'expense';
      return actualType === desired;
    });
  }
  // Filter by category id
  if(window._filterCat){
    txns = txns.filter(t => t.category_id === window._filterCat);
  }
  // Sort transactions: date desc, then name/description, then id
  txns = txns.sort((a, b) => {
    const dd = new Date(b.date) - new Date(a.date);
    if(dd !== 0) return dd;
    const aKey = (a.name ?? a.description ?? '').toString();
    const bKey = (b.name ?? b.description ?? '').toString();
    const cmp = aKey.localeCompare(bKey, undefined, { numeric: true, sensitivity: 'base' });
    if(cmp !== 0) return cmp;
    return (a.id ?? 0) - (b.id ?? 0);
  });

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
            // Set claim and withdraw checkboxes based on existing flags and disable them during edit
            const claimChk = document.getElementById('txnDebtClaim');
            if(claimChk){
              claimChk.checked = !!t.debt_claim;
              claimChk.disabled = true;
            }
            const withChk = document.getElementById('txnGoalWithdraw');
            if(withChk){
              withChk.checked = !!t.goal_withdrawal;
              withChk.disabled = true;
            }
            document.getElementById('txnSubmit').textContent = 'Save';
            document.getElementById('txnCancelEdit').style.display = '';
            document.getElementById('txnCategory').dispatchEvent(new Event('change'));
            // Store original transaction details for validation during update
            window._editingTxn = { 
              id: t.id, 
              amount: Number(t.amount), 
              category_id: t.category_id, 
              use_open_balance: !!t.use_open_balance,
              debt_claim: !!t.debt_claim,
              goal_withdrawal: !!t.goal_withdrawal
            };
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
      // Determine base color by category type (income = green, expense = red, saving = cyan).  If the transaction is marked
      // as a debt claim or a goal withdrawal, override the color to the expense color to visually indicate an outflow.
      let txnColor;
      if(t.debt_claim || t.goal_withdrawal){
        txnColor = 'var(--exp)';
      } else {
        txnColor = cat && {income:'var(--inc)', expense:'var(--exp)', saving:'var(--sav)'}[cat.type] || 'var(--muted)';
      }
      const amountText = `<span style="color:${txnColor}">${formatINR(Math.abs(+t.amount || 0))}</span>`;
      const nameText = cat ? cat.name : 'Unknown';
      // Build pill list for flags
      const pills = [];
      if(t.use_open_balance) pills.push('openBal');
      if(t.debt_claim) pills.push('claim');
      if(t.goal_withdrawal) pills.push('withdraw');
      let pillHtml = '';
      if(pills.length > 0){
        pillHtml = pills.map(pl => `<span style="margin-left:12px;">${pill(pl)}</span>`).join('');
      }
      const firstLine = `<strong>${nameText}</strong>${pillHtml}`;
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
  const flagClaim = document.getElementById('txnDebtClaim')?.checked;
  const flagWithdraw = document.getElementById('txnGoalWithdraw')?.checked;

  // Determine if editing an existing transaction and capture its original amount and category
  const editing = id && window._editingTxn && window._editingTxn.id === id;
  const oldAmt  = editing ? Math.abs(Number(window._editingTxn.amount) || 0) : 0;
  const oldCat  = editing ? window._editingTxn.category_id : null;

  // Load current data and categories for remaining budget and goal/debt checks
  const data = await getData();
  const cats = data.categories || [];

  // ----- Cycle awareness and remaining checks -----
  // Determine the category type
  const catObj = cats.find(c => c.id === selCat) || {};
  const catType = catObj.type || 'expense';
  // Parse the selected date and compute the cycle start for that date
  const txnDateObj = new Date(payload.date);
  txnDateObj.setHours(0,0,0,0);
  const startDay = Math.max(1, Math.min(31, parseInt(window._cycleStartDay || 1)));
  const currentCycleStart = getCycleStartForDate(new Date(), startDay);
  const selectedCycleStart = getCycleStartForDate(txnDateObj, startDay);

  // Block entries into future cycles
  if(selectedCycleStart > currentCycleStart){
    const range = formatCycleRange(selectedCycleStart);
    showAlert(`Entry Date is in the next cycle ${range}. Change the date or save later.`, 'error');
    return;
  }

  // Compute remaining for the appropriate cycle.  For past cycles, we
  // evaluate the cycle containing the selected date.  For the
  // current cycle, we use computeRemainingThisMonth which already
  // incorporates carry‑over.  All calculations exclude use_open_balance
  // transactions by design.
  let cycleRemaining;
  if(selectedCycleStart < currentCycleStart){
    const { remaining: prevRem } = computeRemainingForCycle(data, cats, selectedCycleStart, startDay);
    cycleRemaining = prevRem;
  } else {
    const { remaining: currRem } = computeRemainingThisMonth(data, cats);
    cycleRemaining = currRem;
  }

  // Helper to determine if a transaction should reduce remaining (outflow)
  const isOutflow = (ctype, claim, withdraw) => {
    if(withdraw) return false;
    if(claim) return true;
    return ctype !== 'income';
  };

  // Compute the difference (delta) that will impact the outflow for this entry.
  let deltaOut = 0;
  const newOutflow = isOutflow(catType, flagClaim, flagWithdraw) ? amt : 0;
  if(editing){
    // Determine flags of original transaction
    const oldClaim = !!window._editingTxn.debt_claim;
    const oldWithdraw = !!window._editingTxn.goal_withdrawal;
    const oldCatType = (cats.find(c => c.id === oldCat) || {}).type || 'expense';
    const oldOutflow = isOutflow(oldCatType, oldClaim, oldWithdraw) ? oldAmt : 0;
    // Determine the cycle of the original transaction
    let oldCycleStart = null;
    if(window._editingTxn){
      const orig = (data.transactions || []).find(tx => tx.id === window._editingTxn.id);
      if(orig){
        const od = new Date(orig.date);
        od.setHours(0,0,0,0);
        oldCycleStart = getCycleStartForDate(od, startDay);
      }
    }
    if(oldCycleStart && oldCycleStart.getTime() === selectedCycleStart.getTime() && oldCat === selCat && oldClaim === flagClaim && oldWithdraw === flagWithdraw){
      // Same cycle, category and flags: only additional outflow counts
      deltaOut = newOutflow - oldOutflow;
      if(deltaOut < 0) deltaOut = 0;
    } else {
      // Otherwise treat full new outflow
      deltaOut = newOutflow;
    }
  } else {
    // New transaction
    deltaOut = newOutflow;
  }

  // Determine available funds.  For current cycle, include opening balance when applicable.
  // Skip this check for income-type entries and for goal withdrawals (which act like income).
  if(isOutflow(catType, flagClaim, flagWithdraw)){
    let available = cycleRemaining;
    if(selectedCycleStart.getTime() === currentCycleStart.getTime() && useOpenBal){
      // Opening balance augments only current cycle
      available += parseFloat(data.open_balance || 0);
    }
    if(deltaOut > available){
      const range = formatCycleRange(selectedCycleStart);
      showAlert(`<p>Exceeds Available Amount<br>(Entry Cycle: ${range})</p>`, 'error');
      return;
    }
  }

  // For past cycles, we ignore the opening balance checkbox.  The
  // body.use_open_balance flag is determined separately above and
  // applies only to current cycle transactions.  No need to modify
  // the payload form entries here.

  // ----- Goal logic: soft‑cap warning when deposit exceeds the goal target -----
  if(window._goalCatIds && window._goalCatIds.has(selCat)){
    const goal = (data.goals||[]).find(g=>g.linked_category_id===selCat);
    if(goal){
      const cur = parseFloat(goal.current || 0);
      const tgt = parseFloat(goal.target || 0);
      // For withdrawals, ensure not to withdraw more than current
      if(flagWithdraw){
        // Determine how much is being withdrawn relative to old transaction if editing
        let withdrawAmt;
        if(editing && oldCat === selCat && !!window._editingTxn.goal_withdrawal === flagWithdraw){
          // editing same category and same flag: only difference matters
          const delta = amt - oldAmt;
          withdrawAmt = delta > 0 ? delta : 0;
        } else {
          withdrawAmt = amt;
        }
        if(withdrawAmt > cur){
          showAlert('Withdrawal exceeds saved amount', 'error');
          return;
        }
      } else {
        // Deposit logic: warn if exceeding target
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
  }

  // ----- Debt logic: prevent paying more than the remaining balance -----
  if(window._debtCatIds && window._debtCatIds.has(selCat)){
    const debt = (data.debts||[]).find(d=>d.linked_category_id===selCat);
    if(debt){
      const balance = parseFloat(debt.balance || 0);
      if(flagClaim){
        // Claim: we lend money; no maximum (we can always lend more), but treat delta difference for editing doesn't matter
      } else {
        // Regular payment: ensure we don't pay more than remaining
        let exceeds;
        if(editing && oldCat === selCat && !!window._editingTxn.debt_claim === flagClaim){
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
  }

  // Determine whether this transaction should actually draw from the
  // opening balance.  It is permitted only in the current cycle.
  const finalUseOB = (selectedCycleStart.getTime() === currentCycleStart.getTime()) && !!useOpenBal;
  const body = {date: payload.date, amount: amt, category_id: selCat, note: payload.note, use_open_balance: finalUseOB, debt_claim: !!flagClaim, goal_withdrawal: !!flagWithdraw};

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
  // Reset and enable claim/withdraw checkboxes when cancelling edit
  const claimChk = document.getElementById('txnDebtClaim');
  if(claimChk){
    claimChk.disabled = false;
    claimChk.checked = false;
  }
  const withChk = document.getElementById('txnGoalWithdraw');
  if(withChk){
    withChk.disabled = false;
    withChk.checked = false;
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

// ----- Transaction history controls: show-all toggle and filters -----
// Maintain state across refreshes
window._showAllTxns = window._showAllTxns || false;
window._filterType  = window._filterType  || '';
window._filterCat   = window._filterCat   || '';

// Event listeners for toggles
(function(){
  const showAll = document.getElementById('txnShowAll');
  if(showAll){
    // Initialize based on state
    showAll.checked = !!window._showAllTxns;
    showAll.addEventListener('change', () => {
      window._showAllTxns = showAll.checked;
      refresh();
    });
  }
  const filterType = document.getElementById('txnFilterType');
  if(filterType){
    // Initialize
    filterType.value = window._filterType || '';
    filterType.addEventListener('change', () => {
      window._filterType = filterType.value || '';
      refresh();
    });
  }
  const filterCat = document.getElementById('txnFilterCat');
  if(filterCat){
    // Initialize
    filterCat.value = window._filterCat || '';
    filterCat.addEventListener('change', () => {
      window._filterCat = filterCat.value || '';
      refresh();
    });
  }
})();

// ----- Date change handler for transaction form -----
// Disable the opening balance checkbox for transactions dated before
// the current cycle.  Opening balance can only be applied in the
// present cycle.  When editing an existing transaction, the
// checkbox remains disabled (handled in edit handler).
(function(){
  const dateInput = document.getElementById('txnDate');
  const openChk   = document.getElementById('txnUseOpenBal');
  if(dateInput && openChk){
    dateInput.addEventListener('change', () => {
      const startDay = Math.max(1, Math.min(31, parseInt(window._cycleStartDay || 1)));
      const d = new Date(dateInput.value);
      d.setHours(0,0,0,0);
      const currentStart = getCycleStartForDate(new Date(), startDay);
      const selectedStart = getCycleStartForDate(d, startDay);
      if(selectedStart < currentStart){
        // Past cycle: force off and disable
        openChk.checked = false;
        openChk.disabled = true;
      } else {
        // Current or future cycle: enable if not editing
        if(!window._editingTxn){
          openChk.disabled = false;
        }
      }
      // Whenever date changes, update visibility of claim/withdraw flags
      updateTxnFlagsVisibility();
    });
  }
})();

// ----- Update claim/withdraw flag visibility based on selected category and date -----
function updateTxnFlagsVisibility(){
  const catSel = document.getElementById('txnCategory');
  const dateInput = document.getElementById('txnDate');
  const claimLabel = document.querySelector('label.flag-claim');
  const withdrawLabel = document.querySelector('label.flag-withdraw');
  const claimChk = document.getElementById('txnDebtClaim');
  const withdrawChk = document.getElementById('txnGoalWithdraw');
  if(!catSel || !dateInput || !claimLabel || !withdrawLabel || !claimChk || !withdrawChk) return;
  const selCat = catSel.value;
  const d = new Date(dateInput.value || new Date());
  d.setHours(0,0,0,0);
  const startDay = Math.max(1, Math.min(31, parseInt(window._cycleStartDay || 1)));
  const currentStart = getCycleStartForDate(new Date(), startDay);
  const selectedStart = getCycleStartForDate(d, startDay);
  // Determine flags from editing txn
  const editing = !!window._editingTxn;
  // Determine if claim should be shown: show for current or past cycle (not future) when category is linked to a receivable debt
  let showClaim = false;
  const debtKind = window._debtInfoMap ? window._debtInfoMap[selCat] : undefined;
  // Show claim for receivable debts if the selected cycle is current or past (<= current)
  if(debtKind === 'receivable' && selectedStart.getTime() <= currentStart.getTime()){
    showClaim = true;
  }
  // Determine if withdraw should be shown: show for current or past cycle when category is linked to a goal
  let showWithdraw = false;
  if(window._goalCatIds && window._goalCatIds.has(selCat) && selectedStart.getTime() <= currentStart.getTime()){
    showWithdraw = true;
  }
  // If editing an existing transaction, we don't allow toggling flags
  if(editing){
    // Show both labels only if original flags were true; hide otherwise
    showClaim = window._editingTxn.debt_claim;
    showWithdraw = window._editingTxn.goal_withdrawal;
    // Disable checkboxes in edit mode
    claimChk.disabled = true;
    withdrawChk.disabled = true;
  } else {
    // Enable checkboxes when not editing
    claimChk.disabled = false;
    withdrawChk.disabled = false;
    // Reset checkboxes when toggling visibility off
    if(!showClaim){
      claimChk.checked = false;
    }
    if(!showWithdraw){
      withdrawChk.checked = false;
    }
  }
  claimLabel.style.display = showClaim ? 'flex' : 'none';
  withdrawLabel.style.display = showWithdraw ? 'flex' : 'none';
}

// Hook category change to update flags visibility
(function(){
  const catSel = document.getElementById('txnCategory');
  if(catSel){
    catSel.addEventListener('change', updateTxnFlagsVisibility);
  }
  // Also update flags when the date changes so claim/withdraw options remain consistent
  const dateInput = document.getElementById('txnDate');
  if(dateInput){
    dateInput.addEventListener('change', updateTxnFlagsVisibility);
  }
  // initial call
  updateTxnFlagsVisibility();
})();

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
/**
   * Generate and download an insights report for the current budget cycle.
   * This function computes totals, category breakdowns, top transactions,
   * debts summary and goal progress from the existing data set.  It does
   * not use a time range selector (unlike the dashboard) and always
   * operates on the cycle beginning on the user’s selected cycle start
   * day up to today.  The resulting report is downloaded as a plain
   * text file.  Exposed on window.prepareInsights for use by the
   * Actions dropdown.
   */
  /**
   * Generate and download a rich PDF insights report for the current
   * budget cycle.  This implementation replaces the prior plain text
   * export with a more insightful PDF using html2pdf.js.  It summarises
   * totals, category breakdowns, top transactions, debts and goals,
   * and includes additional visual charts (bar/pie) to aid
   * interpretation.  The PDF uses A3 paper by default.  A
   * print‑fallback ensures users can still save the report if the
   * html2pdf script fails to load.
   */
  async function prepareInsights(){
    // Dynamically load html2pdf if not already present
    async function ensureHtml2Pdf(){
      if(window.html2pdf) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // Format INR currency helper (standalone to avoid relying on outer scope)
    function fmtINR(v){
      try {
        return new Intl.NumberFormat(undefined,{style:'currency',currency:'INR'}).format(v || 0);
      } catch {
        const n = Number(v || 0).toFixed(2);
        return '₹' + n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
    }
    // Percentage helper
    function pct(val, base, d=1){
      if(!base) return 0;
      return +(((val / base) * 100).toFixed(d));
    }
    // Build HTML for the PDF.  Accepts context including computed
    // values and chart images.  CSS is inlined for html2pdf.
    function buildInsightsHTML(ctx){
      const {
        rangeLabel,
        totals, breakdown, topTxns,
        debtsInfo, goalsInfo,
        topExpCat, topExpValPctIncome,
        topSavCat, topSavValPctIncome,
        summaryLine, netDebtLabel,
        // charts removed
      } = ctx;
      const css = `
        <style>
          * { box-sizing: border-box; }
          body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#222; margin:0; }
          .report { padding: 24px; max-width: 1100px; }
          h1 { margin: 0 0 6px; font-size: 26px; }
          .period { color:#666; margin-bottom: 12px; }
          .summary-chip { background:#f5f7fb; border:1px solid #e6e9f2; padding:12px 14px; border-radius:10px; margin: 12px 0 18px; font-weight:600; }
          .grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
          .card { border:1px solid #e6e9f2; border-radius:12px; padding:14px; }
          .card h2 { margin:0 0 8px; font-size:18px; }
          .row { display:flex; justify-content:space-between; margin:6px 0; }
          .muted { color:#666; }
          .good { color:#0a7a3b; font-weight:600; }
          .bad { color:#b11226; font-weight:600; }
          .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-weight:600; border:1px solid #e6e9f2; background:#fafbff; }
          .pill.exp { color:#b11226; background: #fff5f6; border-color:#ffd9de; }
          .pill.sav { color:#0a7a3b; background: #f2fbf5; border-color:#cdeed7; }
          .pill.inc { color:#0a5ab1; background: #f1f7ff; border-color:#d6e8ff; }
          .list { margin: 6px 0 0 0; padding-left: 16px; }
          .list li { margin: 4px 0; }
          .section { margin-top: 16px; }
          .hr { height:1px; background:#eee; margin:16px 0; }
          .k { color:#444; }
          .v { font-weight:600; }
          .small { font-size: 12px; }
          /* Charts styles removed */
        </style>
      `;
      const makeTopList = (items) => {
        if(!items || !items.length) return '<div class="muted small">None</div>';
        return `<ul class="list">${items.slice(0,3).map(s => `<li><span class="k">${s.label}</span> — <span class="v">${s.formatted}</span>${s.share ? ` <span class="muted small">(${s.share})</span>` : ''}</li>`).join('')}</ul>`;
      };
      return `
        ${css}
        <div class="report">
          <h1>Koinfo Insights Report</h1>
          <div class="period">${rangeLabel}</div>
          <div class="summary-chip">${summaryLine}</div>
          <div class="grid">
            <div class="card">
              <h2>Totals</h2>
              <div class="row"><span class="k">Income</span><span class="v">${totals.incFmt}</span></div>
              <div class="row"><span class="k">Expenses</span><span class="v">${totals.expFmt} <span class="muted small">(${totals.expPctInc}% of income)</span></span></div>
              <div class="row"><span class="k">Savings</span><span class="v">${totals.savFmt} <span class="muted small">(${totals.savPctInc}% of income)</span></span></div>
              <div class="row"><span class="k">Net Position</span><span class="${totals.net >= 0 ? 'good' : 'bad'}">${totals.netFmt} ${totals.net >= 0 ? '(Surplus)' : '(Deficit)'}</span></div>
            </div>
            <div class="card">
              <h2>Highlights</h2>
              <div class="row"><span class="k">Top Expense</span><span class="v"><span class="pill exp">${topExpCat || '—'}</span> <span class="muted small">${topExpValPctIncome ? topExpValPctIncome+'% of income' : ''}</span></span></div>
              <div class="row"><span class="k">Top Saving</span><span class="v"><span class="pill sav">${topSavCat || '—'}</span> <span class="muted small">${topSavValPctIncome ? topSavValPctIncome+'% of income' : ''}</span></span></div>
              <div class="row"><span class="k">Debt Position</span><span class="v">${netDebtLabel}</span></div>
            </div>
          </div>
          <div class="section card">
            <h2>Category Breakdown</h2>
            <div class="row"><span class="pill exp">Expenses</span><span class="v">${breakdown.exp.totalFmt}</span></div>
            ${makeTopList(breakdown.exp.top)}
            <div class="hr"></div>
            <div class="row"><span class="pill sav">Savings</span><span class="v">${breakdown.sav.totalFmt}</span></div>
            ${makeTopList(breakdown.sav.top)}
            <div class="hr"></div>
            <div class="row"><span class="pill inc">Income</span><span class="v">${breakdown.inc.totalFmt}</span></div>
            ${makeTopList(breakdown.inc.top)}
          </div>
          <div class="grid section">
            <div class="card">
              <h2>Top Transactions</h2>
              <ul class="list">
                <li><span class="k">Highest expense:</span> ${topTxns.exp}</li>
                <li><span class="k">Highest saving:</span> ${topTxns.sav}</li>
                <li><span class="k">Highest income:</span> ${topTxns.inc}</li>
              </ul>
            </div>
            <div class="card">
              <h2>Debts</h2>
              <div class="row"><span class="k">Total Dues</span><span class="v">${debtsInfo.duesFmt}</span></div>
              <div class="row"><span class="k">Total Claims</span><span class="v">${debtsInfo.claimsFmt}</span></div>
              <div class="small muted">${debtsInfo.lines.join('<br>')}</div>
            </div>
          </div>
          <div class="section card">
            <h2>Goals</h2>
            ${goalsInfo.length ? goalsInfo.map(g => `
              <div class="row">
                <span class="k">${g.name}</span>
                <span class="v">${g.currFmt} / ${g.tgtFmt} (${g.pct}%)
                  <span class="muted small">• ${g.status}</span>
                  ${g.alerts?.length ? ` <span class="bad small">• ${g.alerts.join(', ')}</span>` : ''}
                </span>
              </div>
            `).join('') : '<div class="muted small">None</div>'}
          </div>
          <!-- Additional Insights section removed -->
        </div>
      `;
    }
    try {
      // Fetch data and build category lookup
      const data = await getData();
      const catsById = {};
      (data.categories || []).forEach(c => { catsById[c.id] = c; });
      // Determine cycle start day from stored value or default
      const startDay = window._cycleStartDay || parseInt(localStorage.getItem('cycleStartDay')) || 1;
      // Compute cycle range: from cycleStart to today
      const nowDate = new Date();
      nowDate.setHours(0,0,0,0);
      const cycleStart = getCycleStartForDate(nowDate, startDay);
      // Filter transactions within the cycle
      const txns = (data.transactions || []).filter(t => {
        const d = new Date(t.date);
        return d >= cycleStart && d <= nowDate;
      });
      // Classification helper similar to dashboard
      function classify(t){
        if(t.goal_withdrawal) return 'income';
        if(t.debt_claim) return 'expense';
        const cat = catsById[t.category_id];
        return cat ? cat.type : null;
      }
      // Totals
      let totalInc = 0, totalExp = 0, totalSav = 0;
      txns.forEach(t => {
        const type = classify(t);
        const amt = Math.abs(+t.amount || 0);
        if(type === 'income') totalInc += amt;
        else if(type === 'expense') totalExp += amt;
        else if(type === 'saving') totalSav += amt;
      });
      const net = totalInc - totalExp - totalSav;
      // Build breakdown similar to computeBreakdown
      const sums = { expense:0, saving:0, income:0 };
      const subMap = { expense:{}, saving:{}, income:{} };
      txns.forEach(t => {
        const type = classify(t);
        if(!type) return;
        const amt = Math.abs(+t.amount || 0);
        sums[type] += amt;
        const cat = catsById[t.category_id];
        const name = cat ? cat.name : 'Unknown';
        subMap[type][name] = (subMap[type][name] || 0) + amt;
      });
      // Convert sub maps to sorted arrays
      function toSortedArr(obj){
        const arr = Object.entries(obj).map(([label,value]) => ({ label, value }));
        arr.sort((a,b) => b.value - a.value);
        return arr;
      }
      const breakdownRaw = {
        typeData: [sums.expense, sums.saving, sums.income],
        sub: {
          expense: toSortedArr(subMap.expense),
          saving: toSortedArr(subMap.saving),
          income: toSortedArr(subMap.income)
        }
      };
      // Build formatted breakdown with percentage shares
      const fmtShare = (val, base) => base ? `${pct(val, base, 1)}%` : '';
      const breakdown = {
        exp: {
          totalFmt: fmtINR(breakdownRaw.typeData[0] || 0),
          top: (breakdownRaw.sub.expense || []).slice(0,3).map(s => ({ label: s.label, formatted: fmtINR(s.value), share: fmtShare(s.value, totalExp) }))
        },
        sav: {
          totalFmt: fmtINR(breakdownRaw.typeData[1] || 0),
          top: (breakdownRaw.sub.saving || []).slice(0,3).map(s => ({ label: s.label, formatted: fmtINR(s.value), share: fmtShare(s.value, totalSav) }))
        },
        inc: {
          totalFmt: fmtINR(breakdownRaw.typeData[2] || 0),
          top: (breakdownRaw.sub.income || []).slice(0,3).map(s => ({ label: s.label, formatted: fmtINR(s.value), share: fmtShare(s.value, totalInc) }))
        }
      };
      // Compute top expense & saving category as % of income
      const expByCat = {};
      const savByCat = {};
      txns.forEach(t => {
        const type = classify(t);
        const amt = Math.abs(+t.amount || 0);
        if(type === 'expense'){
          const cat = catsById[t.category_id]?.name || t.category_name || 'Uncategorized';
          expByCat[cat] = (expByCat[cat] || 0) + amt;
        } else if(type === 'saving'){
          const cat = catsById[t.category_id]?.name || t.category_name || 'Uncategorized';
          savByCat[cat] = (savByCat[cat] || 0) + amt;
        }
      });
      const topExpCat = Object.keys(expByCat).sort((a,b) => expByCat[b] - expByCat[a])[0] || null;
      const topSavCat = Object.keys(savByCat).sort((a,b) => savByCat[b] - savByCat[a])[0] || null;
      const topExpValPctIncome = topExpCat ? pct(expByCat[topExpCat], totalInc, 1) : 0;
      const topSavValPctIncome = topSavCat ? pct(savByCat[topSavCat], totalInc, 1) : 0;
      // Top transactions pretty strings
      const topTxns = { exp:'None', sav:'None', inc:'None' };
      const topRaw = { expense:null, saving:null, income:null };
      txns.forEach(t => {
        const type = classify(t);
        if(!type) return;
        const amt = Math.abs(+t.amount || 0);
        if(!topRaw[type] || amt > Math.abs(+topRaw[type].amount || 0)){
          topRaw[type] = t;
        }
      });
      const fmtDate = d => new Date(d).toISOString().split('T')[0];
      if(topRaw.expense){ topTxns.exp = `${(catsById[topRaw.expense.category_id]?.name || 'Unknown')} on ${fmtDate(topRaw.expense.date)} — ${fmtINR(Math.abs(+topRaw.expense.amount || 0))}`; }
      if(topRaw.saving){ topTxns.sav = `${(catsById[topRaw.saving.category_id]?.name || 'Unknown')} on ${fmtDate(topRaw.saving.date)} — ${fmtINR(Math.abs(+topRaw.saving.amount || 0))}`; }
      if(topRaw.income){ topTxns.inc = `${(catsById[topRaw.income.category_id]?.name || 'Unknown')} on ${fmtDate(topRaw.income.date)} — ${fmtINR(Math.abs(+topRaw.income.amount || 0))}`; }
      // Debts info
      let dues = 0, claims = 0;
      (data.debts || []).forEach(d => {
        const bal = +d.balance || 0;
        if((d.kind || 'payable') === 'payable') dues += bal;
        else claims += bal;
      });
      const debtsInfo = {
        duesFmt: fmtINR(dues),
        claimsFmt: fmtINR(claims),
        lines: (data.debts || []).map(d => `• ${d.name}: ${fmtINR(+d.balance || 0)} (${(d.kind || 'payable') === 'payable' ? 'Due' : 'Claim'})`)
      };
      const netDebt = dues - claims;
      const netDebtLabel = netDebt >= 0 ? `<span class="bad">Net Debt: ${fmtINR(netDebt)}</span>` : `<span class="good">Net Lender: ${fmtINR(Math.abs(netDebt))}</span>`;
      // Goals info with status and alerts
      const goalsInfoArr = (data.goals || []).map(g => {
        const cur = +g.current || 0;
        const tgt = Math.max(+g.target || 0, 0.01);
        const pctVal = Math.min(100, Math.round((cur / tgt) * 100));
        const dl = new Date(g.deadline);
        dl.setHours(0,0,0,0);
        const daysLeft = Math.floor((dl - nowDate) / (24*3600*1000));
        const alerts = [];
        if(daysLeft <= 10 && daysLeft >= 0) alerts.push('Approaching');
        if(cur >= tgt) alerts.push(cur > tgt ? 'Target Exceeded' : 'Reached');
        return {
          name: g.name,
          currFmt: fmtINR(cur),
          tgtFmt: fmtINR(tgt),
          pct: pctVal,
          status: daysLeft < 0 ? 'Past Due' : (daysLeft === 0 ? 'Due Today' : `${daysLeft} day(s) left`),
          alerts
        };
      });
      // Totals formatting block
      const totalsBlock = {
        incFmt: fmtINR(totalInc),
        expFmt: fmtINR(totalExp),
        savFmt: fmtINR(totalSav),
        netFmt: fmtINR(net),
        net,
        expPctInc: pct(totalExp, totalInc, 1),
        savPctInc: pct(totalSav, totalInc, 1)
      };
      // Summary line
      const summaryLine = `You saved ${totalsBlock.savPctInc}% of income. Top outflow was ${topExpCat || '—'} (${topExpValPctIncome ? topExpValPctIncome+'%' : '—'}). Net position: ${net >= 0 ? 'Surplus' : 'Deficit'} ${fmtINR(Math.abs(net))}.`;
      const rangeLabel = `Period: ${fmtDate(cycleStart)} to ${fmtDate(nowDate)}`;
      // Chart generation has been removed in favour of a simpler report layout.
      const totalsChartImg = '';
      const expensePieImg = '';
      // Compose HTML
      const html = buildInsightsHTML({
        rangeLabel,
        totals: totalsBlock,
        breakdown,
        topTxns,
        debtsInfo,
        goalsInfo: goalsInfoArr,
        topExpCat,
        topExpValPctIncome,
        topSavCat,
        topSavValPctIncome,
        summaryLine,
        netDebtLabel
      });
      // Generate PDF
      try {
        await ensureHtml2Pdf();
        const opt = {
          margin: [10,10,10,10],
          filename: `koinfo_insights_cycle_${Date.now()}.pdf`,
          image: { type:'jpeg', quality:0.98 },
          html2canvas: { scale:2, useCORS:true },
          jsPDF: { unit:'mm', format:'a3', orientation:'portrait' }
        };
        await window.html2pdf().set(opt).from(html).save();
      } catch(e){
        // Fallback to print dialog
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
        w.close();
        // Refresh the current page after printing/canceling to clear any UI glitches
        window.location.reload();
      }
    } catch(err){
      console.error(err);
      if(window.showAlert) window.showAlert('Error generating PDF insights','error');
    }
  }
  // Expose on window
  window.prepareInsights = prepareInsights;
})();
