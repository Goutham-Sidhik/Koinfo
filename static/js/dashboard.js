/* static/js/dashboard.js
 * Redesigned dashboard logic for Koinfo.
 * This script renders summary KPIs, a time‑range trends chart,
 * an expense/saving/income breakdown with interactive sub‑pie,
 * a debts bar chart showing dues vs claims,
 * a goals panel with progress and alerts, and a top transactions
 * panel showing the largest items per type.  It also supports
 * downloading the dashboard as a PNG via html2canvas.
 */

(function(){
  // ----- Utility functions -----
  async function getData(){
    const r = await fetch('/api/data',{cache:'no-store'});
    if(!r.ok) throw new Error('Failed to fetch data');
    return await r.json();
  }

  // Parse localStorage cycle start day or default to 1
  function getCycleStartDay(){
    const saved = localStorage.getItem('cycleStartDay');
    const n = parseInt(saved);
    if(!isNaN(n) && n >= 1 && n <= 31) return n;
    return 1;
  }

  // Compute the start date of the cycle that contains the given date.
  // The cycle starts on `startDay` of each month.  If the date's day
  // is less than the start day, the cycle began in the previous month.
  function getCycleStart(date, startDay){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let y = d.getFullYear();
    let m = d.getMonth();
    if(d.getDate() < startDay){
      m -= 1;
      if(m < 0){ m = 11; y -= 1; }
    }
    // Clamp day to the last day of month
    const lastDay = new Date(y, m + 1, 0).getDate();
    const day = Math.min(startDay, lastDay);
    return new Date(y, m, day);
  }

  // Compute the start date of the next cycle after the given cycle start.
  function getNextCycleStart(cycleStart, startDay){
    const y = cycleStart.getFullYear();
    const m = cycleStart.getMonth();
    let ny = y;
    let nm = m + 1;
    if(nm > 11){ nm = 0; ny += 1; }
    const lastDay = new Date(ny, nm + 1, 0).getDate();
    const day = Math.min(startDay, lastDay);
    return new Date(ny, nm, day);
  }

  // Format INR currency; fallback if locale unsupported
  function fmtINR(v){
    try {
      return new Intl.NumberFormat(undefined,{style:'currency',currency:'INR'}).format(v || 0);
    } catch {
      const n = Number(v || 0).toFixed(2);
      return '₹' + n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  // Helper to clone a Date object
  function cloneDate(d){ return new Date(d.getTime()); }

  // Determine transaction type given a transaction and category mapping.
  // Applies debt_claim and goal_withdrawal flags to override category type.
  function classifyTransaction(t, catsById){
    if(t.goal_withdrawal) return 'income';
    if(t.debt_claim) return 'expense';
    const cat = catsById[t.category_id];
    return cat ? cat.type : null;
  }

  // Filter transactions within [startDate, endDate] inclusive
  function filterTxnsByDate(txns, startDate, endDate){
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    // Force end date to midnight of the NEXT day
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    return txns.filter(t => {
      const d = new Date(t.date);
      return d >= start && d <= end;
    });
  }


  // Build summary totals across all transactions and debts
  function computeSummary(data, catsById){
    const txns = data.transactions || [];
    let totalInc = 0, totalExp = 0, totalSav = 0;
    const expenseByCat = new Map();
    txns.forEach(t => {
      const type = classifyTransaction(t, catsById);
      const amt = Math.abs(+t.amount || 0);
      if (type === 'income') {
      totalInc += amt;
      } else if (type === 'expense') {
        totalExp += amt;
        // Resolve category name (fallbacks included)
        let catName = 'Uncategorized';
        if (t.category_id && catsById && catsById[t.category_id]) {
          catName = catsById[t.category_id].name || catName;
        } else if (t.category_name) {
          catName = t.category_name;
        }
        expenseByCat.set(catName, (expenseByCat.get(catName) || 0) + amt);
      } else if (type === 'saving') {
        totalSav += amt;
      }
    });
    // Debts: accumulate dues and claims separately
    let dues = 0, claims = 0;
    (data.debts || []).forEach(d => {
      const bal = +d.balance || 0;
      if((d.kind || 'payable') === 'payable') dues += bal;
      else claims += bal;
    });
    // Determine top expense category
    let topExpCat = null, topExpVal = 0;
    for (const [cat, val] of expenseByCat.entries()) {
      if (val > topExpVal) {
        topExpVal = val;
        topExpCat = cat;
      }
    }
    // % of income that the top expense category consumed
    const topExpPctOfIncome = totalInc ? +((topExpVal / totalInc) * 100).toFixed(1) : 0;
    // Net position = income - expenses - savings
    const net = totalInc - totalExp - totalSav;
    return { totalInc, totalExp, totalSav, net, dues, claims, topExpCat, topExpPctOfIncome };
  }

  // Compute trends data for a given time range.  Returns an object with
  // labels and arrays for incomes, expenses, savings and optionally
  // previous cycle series.  The range parameter can be 'cycle','3m','6m','12m'.
  function computeTrends(data, catsById, range, cycleStartDay){
    const allTxns = (data.transactions || []).slice().sort((a,b) => new Date(a.date) - new Date(b.date));
    const now = new Date();
    let startDate, endDate;
    let interval = 'day'; // 'day', 'halfmonth', 'month'
    if(range === 'cycle'){
      const cycleStart = getCycleStart(now, cycleStartDay);
      const cycleEndDate = cloneDate(getNextCycleStart(cycleStart, cycleStartDay));
      cycleEndDate.setDate(cycleEndDate.getDate() - 1);
      // Only display up to today within cycle; normalize to midnight
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = today < cycleEndDate ? cloneDate(today) : cloneDate(cycleEndDate);
      startDate = cloneDate(cycleStart);
      interval = 'day';
    } else {
      // Determine months range
      let monthsBack;
      if(range === '3m') monthsBack = 2; // current month + 2 prior months
      else if(range === '6m') monthsBack = 5;
      else if(range === '12m') monthsBack = 11;
      // Start from first day of (now.getMonth() - monthsBack)
      startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
      // End at last day of current month
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      if(range === '3m') interval = 'halfmonth';
      else interval = 'month';
    }
    // Build segments
    const labels = [];
    const incData = [];
    const expData = [];
    const savData = [];
    if(interval === 'day'){
      let d = cloneDate(startDate);
      const diffDays = Math.floor((endDate - d) / (1000 * 60 * 60 * 24));
      while(d <= endDate){
        const segStart = cloneDate(d);
        const segEnd = cloneDate(d);
        // For day segments, segEnd = segStart
        const segTxns = filterTxnsByDate(allTxns, segStart, segEnd);
        // Classify
        let incSum = 0, expSum = 0, savSum = 0;
        segTxns.forEach(t => {
          const type = classifyTransaction(t, catsById);
          const amt = Math.abs(+t.amount || 0);
          if(type === 'income') incSum += amt;
          else if(type === 'expense') expSum += amt;
          else if(type === 'saving') savSum += amt;
        });
        labels.push(d.toLocaleDateString('en-GB',{ day:'2-digit' }));
        incData.push(incSum);
        expData.push(expSum);
        savData.push(savSum);
        // Next day
        if (diffDays > 10) {
          const nextDay = cloneDate(d);
          nextDay.setDate(nextDay.getDate() + 1);
          if (nextDay <= endDate) {
            const segTxns2 = filterTxnsByDate(allTxns, nextDay, nextDay);
            let inc2 = 0, exp2 = 0, sav2 = 0;
            segTxns2.forEach(t => {
              const type = classifyTransaction(t, catsById);
              const amt = Math.abs(+t.amount || 0);
              if (type === 'income') inc2 += amt;
              else if (type === 'expense') exp2 += amt;
              else if (type === 'saving') sav2 += amt;
            });
            // labels.push(nextDay.toLocaleDateString('en-GB', { day: '2-digit' }));
            labels.push(''); // Empty label for next day
            incData.push(inc2);
            expData.push(exp2);
            savData.push(sav2);
          }
          d.setDate(d.getDate() + 2); // Skip 2 days for larger ranges
        } else {
          d.setDate(d.getDate() + 1);
        }
      }
    } else if(interval === 'halfmonth'){
      let segStart = cloneDate(startDate);
      while(segStart <= endDate){
        // Determine segment end: 14 days ahead
        let segEnd = cloneDate(segStart);
        segEnd.setDate(segEnd.getDate() + 14);
        if(segEnd > endDate) segEnd = cloneDate(endDate);
        const segTxns = filterTxnsByDate(allTxns, segStart, segEnd);
        let incSum = 0, expSum = 0, savSum = 0;
        segTxns.forEach(t => {
          const type = classifyTransaction(t, catsById);
          const amt = Math.abs(+t.amount || 0);
          if(type === 'income') incSum += amt;
          else if(type === 'expense') expSum += amt;
          else if(type === 'saving') savSum += amt;
        });
        // Label: dd MMM - dd MMM
        const label = `${segStart.toLocaleDateString('en-GB',{ day:'2-digit', month:'short' })} – ${segEnd.toLocaleDateString('en-GB',{ day:'2-digit', month:'short' })}`;
        labels.push(label);
        incData.push(incSum);
        expData.push(expSum);
        savData.push(savSum);
        // Move to next segment (day after segEnd)
        segStart = cloneDate(segEnd);
        segStart.setDate(segStart.getDate() + 1);
      }
    } else if(interval === 'month'){
      // Build monthly segments
      let y = startDate.getFullYear();
      let m = startDate.getMonth();
      const endY = endDate.getFullYear();
      const endM = endDate.getMonth();
      while(y < endY || (y === endY && m <= endM)){
        const monthStart = new Date(y, m, 1);
        const monthEnd = new Date(y, m + 1, 0);
        const segTxns = filterTxnsByDate(allTxns, monthStart, monthEnd);
        let incSum = 0, expSum = 0, savSum = 0;
        segTxns.forEach(t => {
          const type = classifyTransaction(t, catsById);
          const amt = Math.abs(+t.amount || 0);
          if(type === 'income') incSum += amt;
          else if(type === 'expense') expSum += amt;
          else if(type === 'saving') savSum += amt;
        });
        labels.push(monthStart.toLocaleDateString('en-GB',{ month:'short', year:'2-digit' }));
        incData.push(incSum);
        expData.push(expSum);
        savData.push(savSum);
        m += 1;
        if(m > 11){ m = 0; y += 1; }
      }
    }
    // For cycle range, compute previous cycle series for comparison up to current day
    let prevInc = null, prevExp = null, prevSav = null, prevLabels = null;
    let cycleInfo = '';
    if(range === 'cycle'){
      const cycleStart = getCycleStart(now, cycleStartDay);
      const prevCycleStart = getCycleStart(new Date(cycleStart.getFullYear(), cycleStart.getMonth(), cycleStart.getDate()-1), cycleStartDay);
      // Number of days so far in current cycle (including today)
      const daysElapsed = Math.floor((endDate - cycleStart)/(24*3600*1000));
      // Build arrays for current and prev cycles up to daysElapsed
      prevInc = [];
      prevExp = [];
      prevSav = [];
      prevLabels = [];
      // Generate labels for current cycle again but compute previous values
      let pStart = cloneDate(prevCycleStart);
      // console.log('Previous cycle start:', pStart);
      for(let i=0; i<=daysElapsed; i++){
        const segStart = cloneDate(pStart);
        const segEnd = cloneDate(pStart);
        // console.log('Segment:', segStart.toLocaleDateString(), 'to', segEnd.toLocaleDateString());
        // Filter transactions for this day
        const segTxns = filterTxnsByDate(allTxns, segStart, segEnd);
        let incSum = 0, expSum = 0, savSum = 0;
        segTxns.forEach(t => {
          const type = classifyTransaction(t, catsById);
          const amt = Math.abs(+t.amount || 0);
          if(type === 'income') incSum += amt;
          else if(type === 'expense') expSum += amt;
          else if(type === 'saving') savSum += amt;
        });
        prevInc.push(incSum);
        prevExp.push(expSum);
        prevSav.push(savSum);
        prevLabels.push(pStart.toLocaleDateString('en-GB',{ day:'2-digit'}));
        pStart.setDate(pStart.getDate() + 1);
      }
      // Cycle info string
      const nextStart = getNextCycleStart(cycleStart, cycleStartDay);
      const cycleEndDate = cloneDate(nextStart);
      cycleEndDate.setDate(cycleEndDate.getDate() - 1);
      const fmt = d => d.toLocaleDateString('en-GB',{ day:'2-digit', month:'short' });
      cycleInfo = `(${fmt(cycleStart)} to ${fmt(cycleEndDate)})`;
    }
    return { labels, incData, expData, savData, prevInc, prevExp, prevSav, prevLabels, cycleInfo, rangeStart: startDate, rangeEnd: endDate };
  }

  // Compute expense/income/saving breakdown for selected range.
  // Returns object: { typeLabels:[], typeData:[], sub: { type: [ {label, value}, ... ], ... } }
  function computeBreakdown(txns, catsById){
    const sums = { income:0, expense:0, saving:0 };
    const sub = { income: {}, expense: {}, saving: {} };
    txns.forEach(t => {
      const type = classifyTransaction(t, catsById);
      const amt = Math.abs(+t.amount || 0);
      if(!type) return;
      sums[type] += amt;
      const cat = catsById[t.category_id];
      const name = cat ? cat.name : 'Unknown';
      sub[type][name] = (sub[type][name] || 0) + amt;
    });
    const typeLabels = [];
    const typeData = [];
    ['expense','saving','income'].forEach(t => {
      typeLabels.push(t.charAt(0).toUpperCase() + t.slice(1));
      typeData.push(sums[t]);
    });
    // Convert sub to arrays sorted descending by amount
    const subArr = {};
    Object.keys(sub).forEach(t => {
      const arr = Object.entries(sub[t]).map(([label, value]) => ({ label, value }));
      arr.sort((a,b) => b.value - a.value);
      subArr[t] = arr;
    });
    return { typeLabels, typeData, sub: subArr };
  }

  // Compute top transactions for range: returns up to one transaction per type (expense, saving, income)
  function computeTopTxns(txns, catsById){
    const top = { expense: null, saving: null, income: null };
    txns.forEach(t => {
      const type = classifyTransaction(t, catsById);
      const amt = Math.abs(+t.amount || 0);
      if(!type) return;
      if(!top[type] || amt > Math.abs(+top[type].amount || 0)){
        top[type] = t;
      }
    });
    return top;
  }

  // Compute goals status and progress for rendering.  Returns array of objects with fields:
  // name, pct, current, target, deadline, alerts[] (strings)
  function computeGoals(goals, catsById){
    const now = new Date(); now.setHours(0,0,0,0);
    return goals.map(g => {
      const cur = +g.current || 0;
      const tgt = Math.max(+g.target || 0, 0.01);
      const pct = Math.min(100, Math.round((cur / tgt) * 100));
      const dl = new Date(g.deadline); dl.setHours(0,0,0,0);
      const daysLeft = Math.floor((dl - now) / (1000*60*60*24));
      const alerts = [];
      if(cur >= tgt) alerts.push(cur > tgt ? 'Target Exceeded' : 'Reached');
      return {
        name: g.name,
        pct,
        current: cur,
        target: tgt,
        deadline: dl.toISOString().split('T')[0],
        alerts,
        daysLeft
      };
    });
  }

  // Compute debt bar data and summary
  function computeDebtsInfo(debts){
    const names = [];
    const values = [];
    const colors = [];
    let dues = 0, claims = 0;
    debts.forEach(d => {
      const bal = +d.balance || 0;
      names.push(d.name);
      if((d.kind || 'payable') === 'payable'){
        values.push(-bal);
        colors.push(getComputedStyle(document.documentElement).getPropertyValue('--bad') || '#ef4444');
        dues += bal;
      } else {
        values.push(bal);
        colors.push(getComputedStyle(document.documentElement).getPropertyValue('--ok') || '#10b981');
        claims += bal;
      }
    });
    return { names, values, colors, dues, claims };
  }

  // Render KPI cards
  function renderKpis(container, summary){
    if(!container) return;
    const { totalInc, totalExp, totalSav, net, dues, claims, topExpCat, topExpPctOfIncome } = summary;
    const debtText = `<span>Dues: </span><span class="text-dues">${fmtINR(dues)}</span> • <span>Claims: </span><span class="text-claims">${fmtINR(claims)}</span>`;
    const expPct = totalInc ? ((totalExp / totalInc) * 100).toFixed(2) : 0;
    const savPct = totalInc ? ((totalSav / totalInc) * 100).toFixed(2) : 0;
    const expLabel = topExpCat && topExpCat.trim() ? topExpCat : "Spent";
    container.innerHTML = [
      `<div class="kpi"><div class="kpi__label">Total Income</div><div class="kpi__value text-income">${fmtINR(totalInc)}</div><div class="detail-line">Cash Balance: <span class="${net >= 0 ? 'text-income' : 'text-expense'}">${fmtINR(net)}</span></div></div>`,
      `<div class="kpi"><div class="kpi__label">Total Expense</div><div class="kpi__value text-expense">${fmtINR(totalExp)}</div><div><span class="detail-line">${expLabel}: </span><span class="text-expense">${topExpPctOfIncome}% </span><span class="detail-line">of income</span></div></div>`,
      `<div class="kpi"><div class="kpi__label">Total Saving</div><div class="kpi__value text-saving">${fmtINR(totalSav)}</div><div><span class="detail-line">Saved: </span><span class="text-saving">${savPct}% </span><span class="detail-line">of income</span></div></div>`,
      `<div class="kpi"><div class="kpi__label">Total Debt</div><div class="kpi__value">${fmtINR(dues + claims)}</div><div class="detail-line">${debtText}</div></div>`
    ].join('');
  }

  // Render trends chart
  let lineChart = null;
  function renderTrendsChart(canvasEl, trends){
    if(!canvasEl) return;
    if(lineChart) lineChart.destroy();
    const { labels, incData, expData, savData, prevInc, prevExp, prevSav, prevLabels } = trends;
    const datasets = [];
    // Colors: using CSS variables at runtime
    const root = getComputedStyle(document.documentElement);
    const colInc = root.getPropertyValue('--inc') || '#09ff00';
    const colExp = root.getPropertyValue('--bad') || '#ef4444';
    const colSav = root.getPropertyValue('--sav') || '#00e1ff';
    datasets.push({ label:'Income', data: incData, tension:0.35, borderColor: colInc, backgroundColor: colInc + '33', fill:false });
    datasets.push({ label:'Expenses', data: expData, tension:0.35, borderColor: colExp, backgroundColor: colExp + '33', fill:false });
    datasets.push({ label:'Savings', data: savData, tension:0.35, borderColor: colSav, backgroundColor: colSav + '33', fill:false });
    // Add previous cycle comparison if available
    if(prevInc && prevInc.length){
      datasets.push({ label:'Prev Income', data: prevInc, tension:0.35, borderColor: colInc, borderDash:[12,12], backgroundColor: colInc + '55', fill:false});
      datasets.push({ label:'Prev Expenses', data: prevExp, tension:0.35, borderColor: colExp, borderDash:[12,12], backgroundColor: colExp + '55', fill:false});
      datasets.push({ label:'Prev Savings', data: prevSav, tension:0.35, borderColor: colSav, borderDash:[12,12], backgroundColor: colSav + '55', fill:false});
    }
    const chartLabels = labels;
    lineChart = new Chart(canvasEl, {
      type:'line',
      data:{ labels: chartLabels, datasets },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{
          legend:{ labels:{ boxWidth:12, color: root.getPropertyValue('--fg') || '#eef2ff' } },
          tooltip:{ callbacks:{ label:function(ctx){ return `${ctx.dataset.label}: ${fmtINR(ctx.parsed.y)}`; } } }
        },
        scales:{
          y:{ beginAtZero:true, ticks:{ callback:v => fmtINR(v) , color: root.getPropertyValue('--fg') || '#eef2ff' }, grid:{ color:'rgba(255,255,255,0.1)' } },
          x:{ ticks:{ color: root.getPropertyValue('--fg') || '#eef2ff' }, grid:{ display:false } }
        }
      }
    });
  }

  // ----- Expense breakdown rendering -----
  let donutChart = null;
  let overlayPieChart = null;
  // Show overlay with category breakdown
  function showExpenseOverlay(typeKey, subList){
    const overlay = document.getElementById('expenseOverlay');
    const titleEl = document.getElementById('overlayTitle');
    const legendEl = document.getElementById('overlayLegend');
    const pieCanvas = document.getElementById('overlayPie');
    if(!overlay || !titleEl || !legendEl || !pieCanvas) return;
    // Set title
    const cap = typeKey.charAt(0).toUpperCase() + typeKey.slice(1);
    titleEl.textContent = `${cap} Breakdown`;
    // Prepare data
    const labels = subList.map(x => x.label);
    const data = subList.map(x => x.value);
    // Generate colors using HSL palette
    const baseHue = (typeKey === 'expense') ? 0 : (typeKey === 'saving' ? 200 : 130);
    const colors = labels.map((_,i) => {
      const hue = (baseHue + i*30) % 360;
      return `hsl(${hue},70%,60%)`;
    });
    // Destroy existing pie if any
    if(overlayPieChart) overlayPieChart.destroy();
    overlayPieChart = new Chart(pieCanvas, {
      type:'doughnut',
      data:{ labels, datasets:[{ data, backgroundColor: colors }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: function(ctx){ return `${ctx.label}: ${fmtINR(ctx.parsed)}`; } } } }
      }
    });
    // Build legend for overlay
    legendEl.classList.add('scroll');
    legendEl.innerHTML = '';
    subList.forEach((item, idx) => {
      legendEl.innerHTML += `<div style="display:flex;align-items:center;margin-bottom:6px;font-size:14px;gap:8px;">
        <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${colors[idx]}"></span>
        <span>${item.label}</span>
        <span style="margin-left:auto;font-weight:600">${fmtINR(item.value)}</span>
      </div>`;
    });
    // Show overlay
    overlay.style.display = 'flex';
  }

  // Hide overlay when close button clicked or overlay background clicked
  function setupOverlayEvents(){
    const overlay = document.getElementById('expenseOverlay');
    const closeBtn = document.getElementById('overlayCloseBtn');
    if(overlay){
      overlay.addEventListener('click', (e) => {
        if(e.target === overlay){ overlay.style.display = 'none'; }
      });
    }
    if(closeBtn){ closeBtn.addEventListener('click', () => { const overlay = document.getElementById('expenseOverlay'); if(overlay) overlay.style.display='none'; }); }
  }

  function renderBreakdown(canvasEl, legendEl, breakdown){
    if(!canvasEl || !legendEl) return;
    if(donutChart) donutChart.destroy();
    const root = getComputedStyle(document.documentElement);
    const colors = [ root.getPropertyValue('--bad') || '#ef4444', root.getPropertyValue('--sav') || '#00e1ff', root.getPropertyValue('--ok') || '#10b981' ];
    donutChart = new Chart(canvasEl, {
      type:'doughnut',
      data:{ labels: breakdown.typeLabels, datasets:[{ data: breakdown.typeData, backgroundColor: colors }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        cutout:'50%',
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label: function(ctx){ return `${ctx.label}: ${fmtINR(ctx.parsed)}`; } } }
        },
        onClick: function(event, elements){
          if(elements && elements.length){
            const index = elements[0].index;
            const typeKey = ['expense','saving','income'][index];
            const subList = breakdown.sub[typeKey] || [];
            if(subList.length){ showExpenseOverlay(typeKey, subList); }
          }
        }
      }
    });
    // Build legend for main chart
    legendEl.classList.add('legend-list');
    legendEl.innerHTML = '';
    breakdown.typeLabels.forEach((lbl, idx) => {
      const val = breakdown.typeData[idx];
      const color = colors[idx];
      legendEl.innerHTML += `<div style="display:flex;align-items:center;margin-bottom:6px;font-size:14px;gap:8px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${color}"></span>
        <span>${lbl}</span>
        <span style="margin-left:auto;font-weight:600">${fmtINR(val)}</span>
      </div>`;
    });
    // Tip under the pie
    const hasData = breakdown.typeData.some(v => v > 0);
    const tipText = `Click on a slice to view details.`;
    let tipEl = canvasEl.parentElement.querySelector('.chart-tip');
    
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      tipEl.setAttribute('role','note');
      tipEl.style.cssText = `margin-top:8px;font-size:12px;text-align:center;color:${root.getPropertyValue('--muted') || '#9aa3b2'};`;
      canvasEl.insertAdjacentElement('afterend', tipEl);
    }
    tipEl.textContent = tipText;
    tipEl.style.display = hasData ? 'block' : 'none';
  }

  // Render debts bar chart
  let barChart = null;
  function renderDebtsChart(canvasEl, info){
    if(!canvasEl) return;
    if(barChart) barChart.destroy();
    const root = getComputedStyle(document.documentElement);
    const axesColor = root.getPropertyValue('--fg') || '#eef2ff';
    // Custom plugin to draw labels on each bar.  Names appear above positive bars and below negative bars.
    const debtLabelPlugin = {
      id: 'debtLabel',
      afterDatasetsDraw(chart, args, opts){
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#eef2ff';
        meta.data.forEach((bar, index) => {
          const val = chart.data.datasets[0].data[index];
          const label = chart.data.labels[index];
          const pos = bar.getCenterPoint();
          const offset = (val < 0 ? 16 : -8);
          ctx.textAlign = 'center';
          ctx.fillText(label, pos.x, pos.y + offset);
        });
        ctx.restore();
      }
    };
    // Determine a sensible step size for the y‑axis based on maximum absolute value
    const absVals = info.values.map(v => Math.abs(v));
    const maxAbs = absVals.length ? Math.max(...absVals) : 0;
    // Choose step size by dividing maxAbs into ~5 intervals and rounding to nearest 1000
    let step = 1;
    if(maxAbs > 0){
      step = Math.pow(10, Math.floor(Math.log10(maxAbs)));
      // refine step to aim for about 4–6 ticks
      const factor = maxAbs / step;
      if(factor < 2) step /= 5;
      else if(factor < 5) step /= 2;
    }
    const suggestedMax = Math.ceil(maxAbs / step) * step;
    const suggestedMin = -suggestedMax;
    // console.log(`step: ${step}, suggestedMin: ${suggestedMin}, suggestedMax: ${suggestedMax}, factor: ${maxAbs / step}`);
    barChart = new Chart(canvasEl, {
      type:'bar',
      data:{ labels: info.names, datasets:[{ label:'Balance', data: info.values, backgroundColor: info.colors }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        layout: { padding: { bottom: 25 } },
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label: function(ctx){ const v = ctx.parsed.y; return `${ctx.dataset.label}: ${v < 0 ? '-' : ''}${fmtINR(Math.abs(v))}`; } } },
          // debtLabel: debtLabelPlugin
        },
        scales:{
          x:{
            ticks:{ display:true, color: axesColor },
            grid:{ display:false }
          },
          y:{
            ticks:{
              color: axesColor,
              stepSize: step,
              callback: function(v){ return fmtINR(Math.abs(v)); }
            },
            grid:{ color:'rgba(255,255,255,0.1)' },
            suggestedMin: suggestedMin,
            suggestedMax: suggestedMax
          }
        }
      },
    });
  }

  // Render goals list
  function renderGoals(container, goalsData){
    if(!container) return;
    if(!goalsData.length){ container.innerHTML = '<div style="color:#cdd0e0">No goals yet.</div>'; return; }
    container.innerHTML = goalsData.map(g => {
      // Determine bar color and alerts pills
      const barColor = (g.pct >= 100) ? 'linear-gradient(90deg,#10b981,#22c55e)' : (g.pct >= 75 ? 'linear-gradient(90deg,#d97706,#facc15)' : 'linear-gradient(90deg,#6366f1,#ec4899)');
      const alertPills = g.alerts.map(a => {
        let col;
        if(a === 'Reached') col = 'var(--ok)';
        else if(a === 'Target Exceeded') col = 'var(--ok)';
        else col = 'var(--warn)';
        return `<span style="padding:3px 6px;border-radius:999px;background:${col};color:#fff;font-size:10px;margin-left:6px">${a}</span>`;
      }).join('');
      // Days left pill
      let daysLabel;
      let daysColor;
      if(g.daysLeft < 0){
        daysLabel = 'Overdue';
        daysColor = 'var(--bad)';
      } else if(g.daysLeft === 0){
        daysLabel = 'Due Today';
        daysColor = 'var(--warn)';
      } else if(g.daysLeft === 1){
        daysLabel = 'Due Tomorrow';
        daysColor = 'var(--warn)';
      }else if(g.daysLeft > 1 && g.daysLeft <= 15){
        daysLabel = `${g.daysLeft}d left`;
        daysColor = 'var(--warn)';
      } else {
        daysLabel = `${g.daysLeft}d left`;
        daysColor = 'var(--ok)';
      }
      const daysPill = `<span style="padding:3px 6px;border-radius:999px;background:${daysColor};color:#ffffff;font-size:10px;margin-left:6px">${daysLabel}</span>`;
      let clr;
      if (g.pct >= 100) clr = 'var(--ok)';
      else if (g.pct >= 75) clr = 'var(--warn)';
      else clr = 'var(--sav)';
      // Move days pill next to name.  Display progress percent separately on the right.
      return `<div class="card" style="margin-bottom:8px;padding:12px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
            <strong>${g.name}</strong>
            ${daysPill}
            ${alertPills}
          </div>
          <div style="color:${clr}">${g.pct}%</div>
        </div>
        <div style="height:10px;border-radius:8px;background:#223;overflow:hidden;">
          <div style="height:10px;border-radius:8px;width:${g.pct}%;background:${barColor}"></div>
        </div>
        <div style="font-size:12px;color:#cdd0e0;margin-top:6px;display:flex;justify-content:space-between;">
          <span><span style="color:var(--sav)">${fmtINR(g.current)}</span> / ${fmtINR(g.target)}</span>
          <span>by ${g.deadline}</span>
        </div>
      </div>`;
    }).join('');
  }

  // Render transaction list for the selected range.  Highlights the highest transaction of each type
  function renderTransactions(container, txns, topMapping, catsById){
    if(!container) return;
    container.innerHTML = '';
    // Sort transactions by date descending
    const sorted = txns.slice().sort((a,b) => new Date(b.date) - new Date(a.date));
    // Determine IDs of top transactions for each type (if any)
    const topIds = {};
    Object.keys(topMapping).forEach(type => {
      const t = topMapping[type];
      if(t) topIds[t.id] = true;
    });
    sorted.forEach(t => {
      const type = classifyTransaction(t, catsById);
      const cat = catsById[t.category_id] || { name:'Unknown', type:type };
      let sign = '';
      let colorClass = '';
      if(type === 'income'){ sign = '+'; colorClass = 'text-income'; }
      else if(type === 'expense'){ sign = '–'; colorClass = 'text-expense'; }
      else { sign = ''; colorClass = 'text-saving'; }
      // Build pills for flags and highest indicator
      const pills = [];
      if(t.use_open_balance){ pills.push('openBal'); }
      if(t.debt_claim){ pills.push('claims'); }
      if(t.goal_withdrawal){ pills.push('withdrawal'); }
      if(topIds[t.id]){ pills.push('⭐'); }
      // Build each pill.  For the "highest" indicator we color based on the
      // transaction type (expense=red, saving=blue, income=green) instead of
      // a generic color.  Claim and withdraw pills also get color highlights.
      const pillHtml = pills.map(p => {
        let bg = '#0f1530';
        let brd = 'rgba(255,255,255,.2)';
        if(p === '⭐'){
          // Determine color based on the transaction type
          if(type === 'expense') brd = 'var(--bad)';
          else if(type === 'saving') brd = 'var(--sav)';
          else if(type === 'income') brd = 'var(--ok)';
          bg = 'transparent';
        }
        return `<span style="padding:3px 6px;border-radius:999px;background:${bg};border:1px solid ${brd};font-size:10px;text-transform:capitalize;margin-left:4px;white-space:nowrap">${p}</span>`;
      }).join('');
      const note = t.note ? ` • ${t.note}` : '';
      const dateStr = new Date(t.date).toISOString().split('T')[0];
      container.innerHTML += `<div class="txn-item">
        <div>
          <div><strong>${cat.name}</strong>${pillHtml}</div>
          <div style="color:#cdd0e0;font-size:12px">${dateStr}${note}</div>
        </div>
        <div><strong class="${colorClass}">${sign} ${fmtINR(Math.abs(+t.amount || 0))}</strong></div>
      </div>`;
    });
  }

  // Main render function
  async function renderDashboard(){
    const data = await getData();
    // Build category mapping
    const catsById = {};
    (data.categories || []).forEach(c => { catsById[c.id] = c; });
    // Acquire DOM elements
    const kpiEl = document.getElementById('kpis');
    const lineCanvas = document.getElementById('lineChart');
    const cycleInfoEl = document.getElementById('cycleInfo');
    const donutCanvas = document.getElementById('donutChart');
    const expenseLegend = document.getElementById('expenseLegend');
    const subPieEl = document.getElementById('expenseSubPie');
    const barCanvas = document.getElementById('barChart');
    const goalsList = document.getElementById('goalsList');
    const topTxnsEl = document.getElementById('topTxns');
    const timeSelect = document.getElementById('timeRangeSelect');
    const cycleStartDay = getCycleStartDay();
    // Compute summary totals (all-time)
    const summary = computeSummary(data, catsById);
    renderKpis(kpiEl, summary);
    // Determine selected time range
    const selectedRange = timeSelect ? timeSelect.value : 'cycle';
    // Compute trends
    const trends = computeTrends(data, catsById, selectedRange, cycleStartDay);
    // Render cycle info if cycle
    if(cycleInfoEl){ cycleInfoEl.textContent = selectedRange === 'cycle' ? `Cycle: ${trends.cycleInfo}` : '';
    }
    renderTrendsChart(lineCanvas, trends);
    // Prepare filtered transactions for selected range
    const filteredTxns = filterTxnsByDate(data.transactions || [], trends.rangeStart, trends.rangeEnd);
    // Compute breakdown for filtered
    const breakdown = computeBreakdown(filteredTxns, catsById);
    renderBreakdown(donutCanvas, expenseLegend, breakdown);
    // Compute debts info
    const debtsInfo = computeDebtsInfo(data.debts || []);
    renderDebtsChart(barCanvas, debtsInfo);
    // Compute goals
    const goalsData = computeGoals(data.goals || [], catsById);
    renderGoals(goalsList, goalsData);
    // Compute top mapping and render full transaction list with highlights
    const topMap = computeTopTxns(filteredTxns, catsById);
    renderTransactions(topTxnsEl, filteredTxns, topMap, catsById);
  }

  // Setup event listeners on DOM ready
  function init(){
    // Time range selector
    const timeSelect = document.getElementById('timeRangeSelect');
    if(timeSelect){
      timeSelect.addEventListener('change', () => {
        renderDashboard();
      });
    }
    // Set up overlay close and background click events
    setupOverlayEvents();
    // Initial render
    renderDashboard();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /**
   * Generate and download an insights report for the currently selected
   * time range.  This implementation fetches the full data model,
   * filters transactions to the range defined by the timeRangeSelect
   * element (cycle, 3m, 6m, 12m) and then assembles a rich PDF report
   * summarising income, expenses, savings, debts, goals and top
   * transactions.  Additional bar and pie charts are rendered via
   * Chart.js to visualise totals and expense breakdowns.  The report
   * is generated using html2pdf.js and defaults to A3 portrait.  A
   * fallback to the browser print dialog is provided if the PDF
   * library fails to load.  The function relies on helper
   * functions defined in this module such as computeTrends,
   * computeBreakdown, computeTopTxns, computeGoals and
   * computeDebtsInfo.  It is exposed on window.prepareInsights for
   * access by the global actions menu.
   */
  async function prepareInsights(){
    /*
     * Generate and download a rich PDF insights report for the selected
     * time range.  This implementation replaces the prior plain
     * text export with a more insightful PDF using html2pdf.js and
     * Chart.js.  It summarises totals, category breakdowns, top
     * transactions, debts and goals, and includes additional
     * visual charts (bar and pie) to aid interpretation.  The PDF
     * defaults to A3 portrait.  A fallback to the print dialog is
     * provided if html2pdf fails to load.
     */
    // Dynamically load html2pdf if not already present
    async function ensureHtml2Pdf(){
      if(window.html2pdf) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.0/dist/html2pdf.bundle.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // NOTE: Chart.js is no longer used in the PDF report.  The report
    // design now mirrors the provided sample and focuses on simple
    // tables and lists rather than charts.  If charts are ever needed
    // again in the future, the ensureChartJs helper can be reintroduced.
    // Percentage helper
    function pct(val, base, d=1){
      if(!base) return 0;
      return +(((val / base) * 100).toFixed(d));
    }
    // Build HTML for the PDF
    function buildInsightsHTML(ctx){
      const {
        rangeLabel,
        totals, breakdown, topTxns,
        debtsInfo, goalsInfo,
        topExpCat, topExpValPctIncome,
        topSavCat, topSavValPctIncome,
        summaryLine, netDebtLabel,
        // Charts have been removed from the design, leaving a cleaner report
      } = ctx;
      const css = `
        <style>
          * { box-sizing: border-box; }
          body { font-family: "Comic Sans MS", monospace; color:#222; margin:0; }
          .report { padding: 24px; max-width: 1100px; }
          h1 { margin: 0 0 6px; font-size: 26px; }
          .period { color:#666; margin-bottom: 12px; }
          .summary-chip { background:#f5f7fb; border:1px solid #e6e9f2; padding:12px 14px; border-radius:10px; margin: 12px 0 18px; font-weight:600; }
          .grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
          .card { border:1px solid #c2c3c7ff; border-radius:12px; padding:14px; background:transparent; }
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
          .small { font-size:12px; }
        </style>
      `;
      const makeTopList = (items) => {
        if(!items || !items.length) return '<div class="muted small">None</div>';
        return `<ul class="list">${items.slice(0,3).map(s => `<li><span class="k">${s.label}</span> — <span class="v">${s.formatted}</span>${s.share ? ` <span class="muted small">(${s.share})</span>` : ''}</li>`).join('')}</ul>`;
      };
      // <img src="data:image/png;base64,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" alt="Logo" style="height:50px;"></img>
      return `
        ${css}
        <div class="report">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h1>Koinfo Insights Report</h1>
            <img src="static/icon.png" alt="Logo" style="height:50px;"></img>
            </div>
          <div class="period">${rangeLabel}</div>
          <div class="summary-chip">${summaryLine}</div>
          <div class="grid">
            <div class="card">
              <h2>Totals</h2>
              <div class="row"><span class="k">Income</span><span class="v">${totals.incFmt}</span></div>
              <div class="row"><span class="k">Expenses</span><span class="v">${totals.expFmt} <span class="muted small">(${totals.expPctInc}% of income)</span></span></div>
              <div class="row"><span class="k">Savings</span><span class="v">${totals.savFmt} <span class="muted small">(${totals.savPctInc}% of income)</span></span></div>
              <div class="row"><span class="v">Net Position</span><span class="${totals.net >= 0 ? 'good' : 'bad'}">${totals.netFmt} ${totals.net >= 0 ? '(Surplus)' : '(Deficit)'}</span></div>
            </div>
            <div class="card">
              <h2>Highlights</h2>
              <div class="row"><span class="k">Top Expense</span><span class="v"><span class="pill exp">${topExpCat || '—'}</span> <span class="muted small">${topExpValPctIncome ? topExpValPctIncome + '% of income' : ''}</span></span></div>
              <div class="row"><span class="k">Top Saving</span><span class="v"><span class="pill sav">${topSavCat || '—'}</span> <span class="muted small">${topSavValPctIncome ? topSavValPctIncome + '% of income' : ''}</span></span></div>
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
                <li><span class="k">Highest expense:</span>${topTxns.exp}</li>
                <li><span class="k">Highest saving:</span> ${topTxns.sav}</li>
                <li><span class="k">Highest income:</span> ${topTxns.inc}</li>
              </ul>
            </div>
            <div class="card">
              <h2>Debts</h2>
              <div class="row"><span>Total Dues</span><span class="v">${debtsInfo.duesFmt}</span></div>
              <div class="small muted">${debtsInfo.dueline.join('<br>')}</div>
              <div class="row"><span>Total Claims</span><span class="v">${debtsInfo.claimsFmt}</span></div>
              <div class="small muted">${debtsInfo.claim.join('<br>')}</div>
            </div>
          </div>
          <div class="section card">
            <h2>Goals</h2>
            ${goalsInfo.length ? goalsInfo.map(g => `
              <div class="row">
                <span class="k">${g.name}</span>
                <span class="v">${g.currFmt} / ${g.tgtFmt} (${g.pct}%)
                  ${g.alerts && g.alerts.length 
                    ? `<span class="good small">• ${g.alerts.join(', ')}</span>`
                    : `<span class="muted small">• ${g.status ?? ''}</span>`}
                </span>
              </div>
            `).join('') : '<div class="muted small">None</div>'}
          </div>
          <!-- Additional Insights section removed -->
        </div>
      `;
    }
    try {
      const data = await getData();
      // Build a lookup for categories by id
      const catsById = {};
      (data.categories || []).forEach(c => { catsById[c.id] = c; });
      // Determine selected time range from UI; default to cycle
      const sel = document.getElementById('timeRangeSelect');
      const range = sel ? (sel.value || 'cycle') : 'cycle';
      const cycleStartDay = getCycleStartDay();
      const trends = computeTrends(data, catsById, range, cycleStartDay);
      // Filter transactions within range
      const periodTxns = filterTxnsByDate(data.transactions || [], trends.rangeStart, trends.rangeEnd);
      // Compute totals
      const totalInc = (trends.incData || []).reduce((a,b) => a + b, 0);
      const totalExp = (trends.expData || []).reduce((a,b) => a + b, 0);
      const totalSav = (trends.savData || []).reduce((a,b) => a + b, 0);
      const net = totalInc - totalExp - totalSav;
      // Compute breakdown raw using existing helper
      const breakdownRaw = computeBreakdown(periodTxns, catsById);
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
      // Compute top expense and saving category as % of income
      const expByCat = {};
      const savByCat = {};
      periodTxns.forEach(t => {
        const type = classifyTransaction(t, catsById);
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
      const topTxnsRaw = computeTopTxns(periodTxns, catsById);
      const fmtDate = d => new Date(d).toISOString().split('T')[0];
      const topTxns = {
        exp: topTxnsRaw.expense ? `${(catsById[topTxnsRaw.expense.category_id]?.name || 'Unknown')} on ${fmtDate(topTxnsRaw.expense.date)} — <span style="color:#b11226;">${fmtINR(Math.abs(+topTxnsRaw.expense.amount || 0))}</span>` : 'None',
        sav: topTxnsRaw.saving ? `${(catsById[topTxnsRaw.saving.category_id]?.name || 'Unknown')} on ${fmtDate(topTxnsRaw.saving.date)} — <span style="color:#0a5ab1;">${fmtINR(Math.abs(+topTxnsRaw.saving.amount || 0))}</span>` : 'None', 
        inc: topTxnsRaw.income ? `${(catsById[topTxnsRaw.income.category_id]?.name || 'Unknown')} on ${fmtDate(topTxnsRaw.income.date)} — <span style="color:#0a7a3b;">${fmtINR(Math.abs(+topTxnsRaw.income.amount || 0))}</span>` : 'None' 
      };
      // Debts info
      const debtsInfoRaw = computeDebtsInfo(data.debts || []);
      const debtsInfo = (() => {
        const dueline = [];
        const claim = [];
        (data.debts || []).forEach(d => {
          const isDue = (d.kind || 'payable') === 'payable';
          const line = `• ${d.name}: ${fmtINR(+d.balance || 0)} (${isDue ? 'Due' : 'Claim'})`;
          (isDue ? dueline : claim).push(line);
        });
        return {
          duesFmt: fmtINR(debtsInfoRaw.dues),
          claimsFmt: fmtINR(debtsInfoRaw.claims),
          dueline,  
          claim      
        };
      })();
      const netDebt = (debtsInfoRaw.dues || 0) - (debtsInfoRaw.claims || 0);
      const netDebtLabel = netDebt >= 0 ? `<span class="bad">Net Debt: ${fmtINR(netDebt)}</span>` : `<span class="good">Net Lender: ${fmtINR(Math.abs(netDebt))}</span>`;
      // Goals info using computeGoals
      const goalsInfoRaw = computeGoals(data.goals || [], catsById);
      const goalsInfo = (goalsInfoRaw || []).map(g => ({
        name: g.name,
        currFmt: fmtINR(g.current),
        tgtFmt: fmtINR(g.target),
        pct: g.pct,
        status: g.daysLeft < 0 ? 'OverDue' : (g.daysLeft === 0 ? 'Due Today' : `${g.daysLeft} day(s) left`),
        alerts: g.alerts || []
      }));
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
      const summaryLine = `You saved ${totalsBlock.savPctInc}% of Income. Top outflow was ${topExpCat || '—'} (${topExpValPctIncome ? topExpValPctIncome + '%' : '—'}). Net position: ${net >= 0 ? 'Surplus' : 'Deficit'} (${fmtINR(Math.abs(net))}).`;
      const rangeLabel = `Period: ${fmtDate(trends.rangeStart)} to ${fmtDate(trends.rangeEnd)}`;
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
        goalsInfo,
        topExpCat,
        topExpValPctIncome,
        topSavCat,
        topSavValPctIncome,
        summaryLine,
        netDebtLabel
      });
      // Generate PDF
      // Declare a timestamp to construct the filename.  If `timeStamp`
      // were assigned without declaration it would leak into the global
      // scope, which is undesirable and could cause conflicts.  Use a
      // local constant instead.
      const timeStamp = Date.now();
      try {
        await ensureHtml2Pdf();
        const opt = {
          margin: [10, 10, 10, 10],
          filename: `koinfo_insights_${range}_${timeStamp}.pdf`,
          html2canvas: { scale: 2, useCORS: true, allowTaint: false },
          jsPDF: { unit: 'mm', format: 'a3', orientation: 'portrait' }
        };
        await window.html2pdf().set(opt).from(html).save();
      } catch(e){
        console.error('html2pdf failed:', e);
        // Fallback: open print dialog; user can save as PDF
        const w = window.open(`koinfo_insights_${range}_${timeStamp}.html`);
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
        w.close();
        // Refresh the current page after printing/canceling to
        // recover from any UI glitches caused by the print dialog.
        window.location.reload();
      }
    } catch(err){
      console.error(err);
      if(window.showAlert) window.showAlert('Error generating PDF insights','error');
    }
  }
  // Expose prepareInsights on the window so actions.js can call it
  window.prepareInsights = prepareInsights;
})();