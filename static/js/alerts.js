/* static/js/alerts.js
 * Simple pop‑up notification system.
 * Replaces native browser alerts with styled toast messages.
 * Usage: call window.showAlert(message, type?, timeout?) to display a message.
 * Type can be 'info' (default), 'error' or 'warn'.  Timeout in ms (default 5000).
 */
(function(){
  /**
   * Show a notification message.  Messages are appended to
   * #alert-container and will fade out after a delay.  If the
   * container does not exist (e.g. on pages without base.html),
   * the browser alert() fallback is used.
   *
   * @param {string} message The text to display.
   * @param {string} [type] Optional type: 'info', 'error' or 'warn'.
   * @param {number} [timeout] Optional duration before auto‑dismiss in ms.
   */
  window.showAlert = function(message, type, timeout){
    const container = document.getElementById('alert-container');
    if(!container){
      // Fallback to native alert if container missing
      // eslint-disable-next-line no-alert
      alert(message);
      return;
    }
    const alertEl = document.createElement('div');
    alertEl.classList.add('alert');
    if(type === 'error') alertEl.classList.add('alert--error');
    if(type === 'info') alertEl.classList.add('alert--info');
    if(type === 'warn' || type === 'warning') alertEl.classList.add('alert--warn');
    alertEl.textContent = message;
    container.appendChild(alertEl);
    const ttl = typeof timeout === 'number' ? timeout : 10000;
    // Schedule fade out and removal
    setTimeout(() => {
      alertEl.style.transition = 'opacity 0.5s ease';
      alertEl.style.opacity = '0';
      setTimeout(() => {
        if(alertEl.parentNode) alertEl.parentNode.removeChild(alertEl);
      }, 500);
    }, ttl);
  };

  /**
   * Display a modal confirmation dialog in the centre of the screen.
   * Returns a Promise that resolves to true if the user confirms, false otherwise.
   * The caller can await this to make synchronous decisions.
   *
   * @param {string} message The confirmation question to display.
   * @returns {Promise<boolean>} Resolves with the user’s choice.
   */
  window.showConfirm = function(message){
    return new Promise((resolve) => {
      // Create overlay
      const overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      // Create dialog
      const dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';
      const msgEl = document.createElement('div');
      msgEl.style.marginBottom = '16px';
      msgEl.innerHTML = message;
      const buttons = document.createElement('div');
      buttons.style.display = 'flex';
      buttons.style.justifyContent = 'center';
      buttons.style.gap = '12px';
      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.style.background = 'var(--card)';
      cancelBtn.style.color = 'var(--fg)';
      cancelBtn.textContent = 'Cancel';
      // Confirm button
      const okBtn = document.createElement('button');
      okBtn.className = 'btn btn--primary';
      okBtn.style.background = 'var(--del)';
      okBtn.style.color = 'var(--fg)';
      okBtn.textContent = 'Delete';
      buttons.appendChild(cancelBtn);
      buttons.appendChild(okBtn);
      dialog.appendChild(msgEl);
      dialog.appendChild(buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      // Event handlers
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(false);
      });
      okBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(true);
      });
    });
  };
})();