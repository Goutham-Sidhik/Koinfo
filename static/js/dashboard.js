/* static/js/dashboard.js
 * Dashboard KPIs, charts, goals, and recent transactions
 * Requires Chart.js (already included in base.html)
 */

(function () {
  // ---------- Utilities ----------
  async function getData() {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (!r.ok) throw new Error('Failed to load data');
    return await r.json();
  }

  function sum(arr) {
    return (arr || []).reduce((a, b) => a + (+b || 0), 0);
  }

  function fmtINR(v) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR' }).format(v || 0);
    } catch {
      // fallback if locale/currency not supported
      const n = Number(v || 0).toFixed(2);
      return '₹' + n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  function monthKey(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function makeKPI(label, value, sub) {
    return `
      <div class="kpi">
        <div class="kpi__label">${label}</div>
        <div class="kpi__value">${value}</div>
        ${sub ? `<div class="kpi__sub">${sub}</div>` : ''}
      </div>`;
  }

  // ---------- Rendering ----------
  async function render() {
    const data = await getData();
    const cats = data.categories || [];
    const debts = data.debts || [];
    const goals = data.goals || [];
    const txns = (data.transactions || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    // --- Build “last 6 months” axis ---
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    const monthLabels = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // --- Split transactions by category type ---
    const typeOfCat = (id) => (cats.find(c => c.id === id) || {}).type;
    const expenseTxns = txns.filter(t => typeOfCat(t.category_id) === 'expense');
    const savingTxns  = txns.filter(t => typeOfCat(t.category_id) === 'saving');
    const incomeTxns  = txns.filter(t => typeOfCat(t.category_id) === 'income');

    // --- KPI numbers (all-time) ---
    const totalExp = sum(expenseTxns.map(t => Math.abs(+t.amount || 0)));
    const totalSav = sum(savingTxns.map(t => Math.abs(+t.amount || 0)));
    const totalInc = sum(incomeTxns.map(t => Math.abs(+t.amount || 0)));
    const netCashflow = totalInc - totalExp - totalSav;
    const totalDebtOutstanding = sum(debts.map(d => +d.balance || 0));

    const kpisEl = document.getElementById('kpis');
    if (kpisEl) {
      kpisEl.innerHTML = [
        makeKPI('Total Income (All-time)', fmtINR(totalInc)),
        makeKPI('Total Expenses (All-time)', fmtINR(totalExp)),
        makeKPI('Total Savings Allocated', fmtINR(totalSav)),
        makeKPI('Outstanding Debt', fmtINR(totalDebtOutstanding), `Net Cashflow: ${fmtINR(netCashflow)}`),
      ].join('');
    }

    // --- Time series: Expenses vs Savings (last 6 months) ---
    const seriesFor = (list) =>
      monthLabels.map(m => sum(list.filter(t => monthKey(t.date) === m).map(t => Math.abs(+t.amount || 0))));

    const exp6 = seriesFor(expenseTxns);
    const sav6 = seriesFor(savingTxns);

    const lineCanvas = document.getElementById('lineChart');
    if (lineCanvas) {
      // destroy existing chart if hot reloading
      if (lineCanvas._chart) lineCanvas._chart.destroy();
      lineCanvas._chart = new Chart(lineCanvas, {
        type: 'line',
        data: {
          labels: monthLabels,
          datasets: [
            { label: 'Expenses', data: exp6, tension: 0.35 },
            { label: 'Savings',  data: sav6, tension: 0.35 },
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: {
            y: { ticks: { callback: (v) => fmtINR(v) } }
          }
        }
      });
    }

    // --- Donut: Expense breakdown by category (all-time) ---
    const expenseByCat = cats
      .filter(c => c.type === 'expense')
      .map(c => ({
        name: c.name,
        total: sum(expenseTxns.filter(t => t.category_id === c.id).map(t => Math.abs(+t.amount || 0)))
      }))
      .filter(x => x.total > 0);

    const donutCanvas = document.getElementById('donutChart');
    if (donutCanvas) {
      if (donutCanvas._chart) donutCanvas._chart.destroy();
      donutCanvas._chart = new Chart(donutCanvas, {
        type: 'doughnut',
        data: {
          labels: expenseByCat.map(x => x.name),
          datasets: [{ data: expenseByCat.map(x => x.total) }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.label}: ${fmtINR(ctx.parsed)}`
              }
            }
          }
        }
      });
    }

    // --- Bar: Debts balances ---
    const barCanvas = document.getElementById('barChart');
    if (barCanvas) {
      if (barCanvas._chart) barCanvas._chart.destroy();
      barCanvas._chart = new Chart(barCanvas, {
        type: 'bar',
        data: {
          labels: debts.map(d => d.name),
          datasets: [{ label: 'Balance', data: debts.map(d => +d.balance || 0) }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true } },
          scales: {
            y: { ticks: { callback: (v) => fmtINR(v) } }
          }
        }
      });
    }

    // --- Goals list (with progress bar) ---
    const goalsList = document.getElementById('goalsList');
    if (goalsList) {
      goalsList.classList.add('scroll');
      if (!goals.length) {
        goalsList.innerHTML = '<div style="color:#cdd0e0">No goals yet.</div>';
      } else {
        goalsList.innerHTML = goals.map(g => {
          const cur = +g.current || 0;
          const tgt = Math.max(1, +g.target || 0);
          const pct = Math.min(100, Math.round((cur / tgt) * 100));
          return `
            <div class="card">
              <div class="row" style="justify-content:space-between">
                <strong>${g.name}</strong>
                <span>${pct}%</span>
              </div>
              <div style="height:10px;border-radius:8px;background:#223">
                <div style="height:10px;border-radius:8px;width:${pct}%;background:linear-gradient(90deg,#6366f1,#ec4899)"></div>
              </div>
              <div style="font-size:12px;color:#cdd0e0;margin-top:6px">
                ${fmtINR(cur)} / ${fmtINR(tgt)} • by ${g.deadline}
              </div>
            </div>`;
        }).join('');
      }
    }

    // --- Recent transactions (last 12) ---
    const recentTxnsEl = document.getElementById('recentTxns');
    if (recentTxnsEl) {
      recentTxnsEl.innerHTML = txns.slice(0, 12).map(t => {
        const cat = cats.find(c => c.id === t.category_id);
        const sign = (cat && (cat.type === 'saving' || cat.type === 'income')) ? '+' : '-';
        const note = t.note ? ` • ${t.note}` : '';
        return `
          <div class="row" style="justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:6px 0">
            <div>
              <div><strong>${cat ? cat.name : 'Unknown'}</strong></div>
              <div style="color:#cdd0e0;font-size:12px">${t.date}${note}</div>
            </div>
            <div><strong>${sign} ${fmtINR(Math.abs(+t.amount || 0))}</strong></div>
          </div>`;
      }).join('');
    }
  }

  // Kick off when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
