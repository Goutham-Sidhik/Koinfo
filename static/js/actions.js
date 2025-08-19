/* static/js/actions.js
 * Handles the Actions dropdown menu present on all pages.  Provides
 * options to reset the data back to defaults and to download an
 * insights report for the selected time period.  This script relies
 * on showConfirm() from alerts.js and a global window.prepareInsights()
 * function that must be defined by individual pages (dashboard.js
 * and manage.js).  If prepareInsights() is not defined, attempting
 * to download insights will produce a warning.
 */

(function(){
  function initActions(){
    const btn = document.getElementById('actionsMenuButton');
    const menu = document.getElementById('actionsMenu');
    if(!btn || !menu) return;
    // Toggle menu visibility on button click
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const isShown = menu.style.display === 'block';
      menu.style.display = isShown ? 'none' : 'block';
    });
    // Hide menu when clicking anywhere else
    document.addEventListener('click', (ev) => {
      if(menu.style.display === 'block'){ menu.style.display = 'none'; }
    });
    // Prevent clicks inside the menu from closing it
    menu.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });
    // Reset Data action
    const resetLink = document.getElementById('resetDataLink');
    if(resetLink){
      resetLink.addEventListener('click', async (ev) => {
        ev.preventDefault();
        // Confirm with user before resetting
        const ok = await (window.showConfirm ? window.showConfirm('Are you sure? This will permanently erase all data and reset to default.') : Promise.resolve(false));
        if(ok){
          try {
            const resp = await fetch('/api/reset_data', { method: 'POST' });
            if(resp.ok){
              if(window.showAlert) window.showAlert('All data has been reset to defaults','info');
              // Reload page to reflect reset
              location.reload();
            } else {
              if(window.showAlert) window.showAlert('Failed to reset data','error');
            }
          } catch(err){
            console.error(err);
            if(window.showAlert) window.showAlert('Error resetting data','error');
          }
        }
        // Hide menu after action
        menu.style.display = 'none';
      });
    }
    // Download Insights action
    const insightsLink = document.getElementById('downloadInsightsLink');
    if(insightsLink){
      insightsLink.addEventListener('click', async (ev) => {
        ev.preventDefault();
        // If page defines prepareInsights() then invoke it
        if(typeof window.prepareInsights === 'function'){
          try {
            await window.prepareInsights();
          } catch(err){
            console.error(err);
            if(window.showAlert) window.showAlert('Failed to generate insights','error');
          }
        } else {
          if(window.showAlert) window.showAlert('Insights download not available on this page','warn');
        }
        menu.style.display = 'none';
      });
    }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initActions);
  } else {
    initActions();
  }
})();