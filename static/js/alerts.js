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
    const ttl = typeof timeout === 'number' ? timeout : 5000;
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

  /**
   * Display an informational dialog with a single button to acknowledge
   * the message.  The returned promise resolves when the user clicks
   * the button.  This is useful for notifying the user without
   * offering a Cancel choice.
   *
   * @param {string} message HTML content for the message body
   * @param {string} [buttonLabel] Label for the acknowledge button (default 'OK')
   * @returns {Promise<void>} resolves once the user closes the dialog
   */
  window.showDialog = function(message, buttonLabel){
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      const dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';
      const msgEl = document.createElement('div');
      msgEl.style.marginBottom = '16px';
      msgEl.innerHTML = message;
      const btns = document.createElement('div');
      btns.style.display = 'flex';
      btns.style.justifyContent = 'center';
      const ok = document.createElement('button');
      ok.className = 'btn btn--primary';
      ok.style.background = 'var(--edit)';
      ok.style.color = 'var(--fg)';
      ok.textContent = buttonLabel || 'OK';
      btns.appendChild(ok);
      dialog.appendChild(msgEl);
      dialog.appendChild(btns);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      ok.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve();
      });
    });
  };

  /**
   * Display a prompt dialog with an input box.  The user can either
   * cancel or save their entry.  The returned promise resolves with
   * the entered string on save, or null on cancel.
   *
   * @param {string} message HTML message to display above the input
   * @param {string} [placeholder] Placeholder text for the input
   * @param {string} [initial] Initial value for the input
   * @returns {Promise<string|null>} resolves with the user input or null if cancelled
   */
  window.showPromptInput = function(message, placeholder, initial){
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      const dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';
      const msgEl = document.createElement('div');
      msgEl.style.marginBottom = '12px';
      msgEl.innerHTML = message;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.placeholder = placeholder || '';
      input.value = initial || '';
      input.style.width = '100%';
      input.style.padding = '8px';
      input.style.marginBottom = '12px';
      input.style.borderRadius = '8px';
      input.style.border = '1px solid var(--ring)';
      input.style.background = 'var(--card)';
      input.style.color = 'var(--fg)';
      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.justifyContent = 'space-between';
      btnRow.style.gap = '12px';
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.style.background = 'var(--card)';
      cancel.style.color = 'var(--fg)';
      cancel.textContent = 'Cancel';
      const save = document.createElement('button');
      save.className = 'btn btn--primary';
      save.style.background = 'var(--edit)';
      save.style.color = 'var(--fg)';
      save.textContent = 'Save';
      btnRow.appendChild(cancel);
      btnRow.appendChild(save);
      dialog.appendChild(msgEl);
      dialog.appendChild(input);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      cancel.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(null);
      });
      save.addEventListener('click', () => {
        const value = input.value;
        document.body.removeChild(overlay);
        resolve(value);
      });
    });
  };
})();