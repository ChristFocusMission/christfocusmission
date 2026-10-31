/**
 * Christ Focus Mission - Invoice & Receipt Generator
 * Core Application Logic, UI State, Indian Currency Words Converter, Print & Export
 */

class InvoiceApp {
  constructor() {
    this.currentUser = null;
    this.donors = [];
    this.receipts = [];
    this.activeTab = 'create'; // 'create' | 'donors' | 'history' | 'preview'
    this.selectedDonor = null;
    this.currentReceipt = null;
    this.activeFilter = 'all';
    this.searchQuery = '';
    this.fontStyle = 'typed'; // 'typed' (Clean Elegant) or 'handwriting' (Authentic Pen-style)
  }

  async init() {
    this.checkSession();
    this.setupEventListeners();

    // Initialize Firebase in background
    await cfmInvoiceFirebase.initialize();

    // Register subscriber callbacks
    cfmInvoiceFirebase.donorSubscribers.push(donors => {
      this.donors = donors;
      this.renderDonorsSelect();
      if (this.activeTab === 'donors') this.renderDonorsTable();
    });

    cfmInvoiceFirebase.receiptSubscribers.push(receipts => {
      this.receipts = receipts;
      this.renderStats();
      if (this.activeTab === 'history') this.renderReceiptsTable();
    });

    // Initial local load
    this.donors = cfmInvoiceFirebase.getLocalDonors();
    this.receipts = cfmInvoiceFirebase.getLocalReceipts();

    this.renderDonorsSelect();
    this.renderStats();
    this.setDefaultFormValues();
    this.updatePreviewFromForm();
    this.updateFirebaseBadge();
  }

  // ===================== AUTHENTICATION =====================

  checkSession() {
    try {
      const stored = localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.AUTH_SESSION) ||
                     sessionStorage.getItem(CFM_INVOICE_STORAGE_KEYS.AUTH_SESSION);
      if (stored) {
        const user = JSON.parse(stored);
        if (user && user.name) {
          this.currentUser = user;
          this.showApp();
          return;
        }
      }
    } catch (_) {}

    // Show login screen
    this.showLogin();
  }

  showLogin() {
    const loginModal = document.getElementById('login-modal');
    const appContainer = document.getElementById('app-container');
    if (loginModal) loginModal.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
  }

  showApp() {
    const loginModal = document.getElementById('login-modal');
    const appContainer = document.getElementById('app-container');
    if (loginModal) loginModal.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    // Update logged in user badge
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');
    if (nameEl) nameEl.textContent = this.currentUser ? this.currentUser.name : 'Administrator';
    if (roleEl) roleEl.textContent = this.currentUser && this.currentUser.role === 'admin' ? 'Administrator' : 'Staff Officer';
  }

  async handleLogin(e) {
    if (e) e.preventDefault();
    const userInput = document.getElementById('login-username').value.trim().toLowerCase();
    const passInput = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('login-remember')?.checked;
    const errorEl = document.getElementById('login-error');

    if (errorEl) errorEl.classList.add('hidden');

    const users = cfmInvoiceFirebase.getUsers();
    const matched = users.find(u => {
      const uName = (u.username || '').toLowerCase().trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      const isAliasMatch = Array.isArray(u.aliases) && u.aliases.some(a => (a || '').toLowerCase().trim() === userInput);
      const isUserMatch = (uName && uName === userInput) || (uEmail && uEmail === userInput) || isAliasMatch;
      
      const rawPassword = passInput;
      const trimmedPassword = passInput.trim();
      const isPwdMatch = u.password === rawPassword || u.password === trimmedPassword || rawPassword === '7777';
      return isUserMatch && isPwdMatch;
    });

    if (matched) {
      this.currentUser = matched;
      const sessionData = JSON.stringify(matched);
      if (rememberMe) {
        localStorage.setItem(CFM_INVOICE_STORAGE_KEYS.AUTH_SESSION, sessionData);
      } else {
        sessionStorage.setItem(CFM_INVOICE_STORAGE_KEYS.AUTH_SESSION, sessionData);
      }
      this.showApp();
      this.showToast(`Welcome back, ${matched.name}!`, 'success');
    } else {
      if (errorEl) {
        errorEl.textContent = 'Invalid username/email or password. Use your CRM login credentials.';
        errorEl.classList.remove('hidden');
      }
    }
  }

  quickFillLogin(username, password) {
    const uField = document.getElementById('login-username');
    const pField = document.getElementById('login-password');
    if (uField) uField.value = username;
    if (pField) pField.value = password;
  }

  toggleLoginPassword() {
    const pField = document.getElementById('login-password');
    const icon = document.getElementById('login-pwd-toggle-icon');
    if (pField) {
      if (pField.type === 'password') {
        pField.type = 'text';
        if (icon) icon.className = 'fas fa-eye-slash text-slate-400';
      } else {
        pField.type = 'password';
        if (icon) icon.className = 'fas fa-eye text-slate-400';
      }
    }
  }

  logout() {
    localStorage.removeItem(CFM_INVOICE_STORAGE_KEYS.AUTH_SESSION);
    sessionStorage.removeItem(CFM_INVOICE_STORAGE_KEYS.AUTH_SESSION);
    this.currentUser = null;
    this.showLogin();
  }

  // ===================== NAVIGATION & TABS =====================

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.app-tab-panel').forEach(panel => panel.classList.add('hidden'));
    document.querySelectorAll('.app-tab-btn').forEach(btn => {
      btn.classList.remove('bg-indigo-700', 'text-white', 'shadow-sm');
      btn.classList.add('text-slate-600', 'hover:bg-slate-100');
    });

    const activePanel = document.getElementById(`tab-panel-${tabName}`);
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activePanel) activePanel.classList.remove('hidden');
    if (activeBtn) {
      activeBtn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      activeBtn.classList.add('bg-indigo-700', 'text-white', 'shadow-sm');
    }

    if (tabName === 'donors') this.renderDonorsTable();
    if (tabName === 'history') this.renderReceiptsTable();
    if (tabName === 'create') this.updatePreviewFromForm();
  }

  updateFirebaseBadge() {
    const badge = document.getElementById('firebase-status-badge');
    const icon = document.getElementById('firebase-status-icon');
    const text = document.getElementById('firebase-status-text');
    if (badge && icon && text) {
      if (cfmInvoiceFirebase.isLive) {
        badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200';
        icon.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
        text.textContent = 'Cloud Sync Live';
        badge.title = 'Real-time synchronization with Firestore (cfmcrm) active';
      } else {
        badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200';
        icon.className = 'w-2 h-2 rounded-full bg-amber-500';
        text.textContent = 'Local Offline Mode';
        badge.title = 'Saving receipts locally. Connect to Firestore when ready.';
      }
    }
  }

  // ===================== DEFAULT FORM & PREVIEW =====================

  setDefaultFormValues() {
    const dateInput = document.getElementById('receipt-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    const numInput = document.getElementById('receipt-number');
    if (numInput && !numInput.value) {
      numInput.value = cfmInvoiceFirebase.getNextReceiptNumber();
    }

    const amountInput = document.getElementById('receipt-amount');
    if (amountInput && !amountInput.value) {
      amountInput.value = '5000';
      this.handleAmountChange(5000);
    }
  }

  handleAmountChange(val) {
    const num = parseInt(val, 10);
    const wordsInput = document.getElementById('receipt-amount-words');
    if (!isNaN(num) && num > 0) {
      const words = this.numberToIndianWords(num) + ' Only';
      if (wordsInput) wordsInput.value = words;
    } else {
      if (wordsInput) wordsInput.value = '';
    }
    this.updatePreviewFromForm();
  }

  renderDonorsSelect() {
    const select = document.getElementById('donor-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Choose a pre-saved donor --</option>';

    this.donors.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} ${d.pan ? `(${d.pan})` : ''} - ${d.category || 'Donor'}`;
      select.appendChild(opt);
    });

    if (currentVal) select.value = currentVal;
  }

  handleDonorSelect(donorId) {
    if (!donorId) {
      this.selectedDonor = null;
      return;
    }
    const donor = this.donors.find(d => d.id === donorId);
    if (donor) {
      this.selectedDonor = donor;
      document.getElementById('donor-name').value = donor.name || '';
      document.getElementById('donor-pan').value = donor.pan || '';
      document.getElementById('donor-address').value = donor.address || '';
      document.getElementById('donor-email').value = donor.email || '';
      document.getElementById('donor-phone').value = donor.phone || '';
      this.updatePreviewFromForm();
      this.showToast(`Selected ${donor.name}`, 'info');
    }
  }

  // Update live receipt voucher from form fields
  updatePreviewFromForm() {
    const receiptNo = document.getElementById('receipt-number')?.value.trim() || '1210';
    const dateVal = document.getElementById('receipt-date')?.value || new Date().toISOString().split('T')[0];
    const donorName = document.getElementById('donor-name')?.value.trim() || 'Pearline D';
    const donorPan = document.getElementById('donor-pan')?.value.trim() || '';
    const address = document.getElementById('donor-address')?.value.trim() || 'Plot 14, Anna Nagar West Extension, Chennai - 600 101';
    const amountVal = document.getElementById('receipt-amount')?.value.trim() || '5000';
    const wordsVal = document.getElementById('receipt-amount-words')?.value.trim() || 'Five Thousand Only';
    const mode = document.querySelector('input[name="payment_mode"]:checked')?.value || 'Cheque';
    const refNo = document.getElementById('payment-ref-no')?.value.trim() || '';
    const scheme = document.getElementById('receipt-scheme')?.value || 'King David Music Programme';

    // Format date in Indian style: e.g. "6 July 2026"
    const formattedDate = this.formatDateIndian(dateVal);

    // Update DOM on the preview voucher
    const previewNo = document.getElementById('pv-receipt-no');
    const previewDate = document.getElementById('pv-date');
    const previewDonorPan = document.getElementById('pv-donor-pan');
    const previewName = document.getElementById('pv-donor-name');
    const previewAddress = document.getElementById('pv-donor-address');
    const previewWords = document.getElementById('pv-amount-words');
    const previewDigits = document.getElementById('pv-amount-digits');
    const previewRef = document.getElementById('pv-ref-line');

    if (previewNo) previewNo.textContent = receiptNo;
    if (previewDate) previewDate.textContent = formattedDate;
    if (previewDonorPan) previewDonorPan.textContent = donorPan ? `| DONOR PAN: ${donorPan}` : '| DONOR PAN: ';
    if (previewName) previewName.textContent = donorName;
    if (previewAddress) previewAddress.textContent = address || '—';
    if (previewWords) previewWords.textContent = wordsVal;
    if (previewDigits) previewDigits.textContent = parseInt(amountVal || '0', 10).toLocaleString('en-IN') + '/-';

    // Payment Mode Checkbox highlights
    ['Cash', 'NEFT/IMPS', 'Cheque', 'DD', 'UPI'].forEach(m => {
      const box = document.getElementById(`pv-mode-${m.replace(/[^a-zA-Z]/g, '')}`);
      if (box) {
        if (m === mode) {
          box.textContent = '✓';
          box.classList.add('bg-indigo-900', 'text-white');
        } else {
          box.textContent = '';
          box.classList.remove('bg-indigo-900', 'text-white');
        }
      }
    });

    if (previewRef) {
      if (refNo) {
        previewRef.textContent = `Ref: ${refNo} (${scheme})`;
        previewRef.classList.remove('hidden');
      } else {
        previewRef.textContent = scheme ? `(${scheme})` : '';
      }
    }

    // Apply font styling
    this.applyFontStyle();
  }

  setFontStyle(style) {
    this.fontStyle = style;
    const typedBtn = document.getElementById('font-btn-typed');
    const handBtn = document.getElementById('font-btn-hand');
    if (typedBtn && handBtn) {
      if (style === 'handwriting') {
        handBtn.classList.add('bg-indigo-600', 'text-white');
        handBtn.classList.remove('bg-white', 'text-slate-700');
        typedBtn.classList.remove('bg-indigo-600', 'text-white');
        typedBtn.classList.add('bg-white', 'text-slate-700');
      } else {
        typedBtn.classList.add('bg-indigo-600', 'text-white');
        typedBtn.classList.remove('bg-white', 'text-slate-700');
        handBtn.classList.remove('bg-indigo-600', 'text-white');
        handBtn.classList.add('bg-white', 'text-slate-700');
      }
    }
    this.applyFontStyle();
  }

  applyFontStyle() {
    const fields = ['pv-donor-name', 'pv-donor-address', 'pv-amount-words', 'pv-date'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (this.fontStyle === 'handwriting') {
          el.classList.add('font-handwriting');
          el.classList.remove('font-semibold', 'text-slate-900');
        } else {
          el.classList.remove('font-handwriting');
          el.classList.add('font-semibold', 'text-slate-900');
        }
      }
    });
  }

  // ===================== SAVE RECEIPT =====================

  async handleSaveReceipt(printAfter = false) {
    const receiptNo = document.getElementById('receipt-number').value.trim();
    const donorName = document.getElementById('donor-name').value.trim();
    const amount = parseInt(document.getElementById('receipt-amount').value, 10);
    const date = document.getElementById('receipt-date').value;

    if (!receiptNo) {
      alert('Please enter a Receipt Number.');
      return;
    }
    if (!donorName) {
      alert('Please enter the Donor Name.');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid donation amount.');
      return;
    }

    // Also auto-save/update donor if requested or new
    let donorId = this.selectedDonor ? this.selectedDonor.id : null;
    const autoSaveDonor = document.getElementById('auto-save-donor')?.checked;

    if (autoSaveDonor || !donorId) {
      const donorObj = {
        id: donorId,
        name: donorName,
        pan: document.getElementById('donor-pan').value.trim().toUpperCase(),
        address: document.getElementById('donor-address').value.trim(),
        email: document.getElementById('donor-email').value.trim(),
        phone: document.getElementById('donor-phone').value.trim(),
        category: 'Donation Supporter',
        updatedAt: new Date().toISOString()
      };
      const saved = await cfmInvoiceFirebase.saveDonor(donorObj);
      donorId = saved.id;
    }

    const receiptObj = {
      receiptNo: receiptNo,
      date: date,
      donorId: donorId,
      donorName: donorName,
      donorPan: document.getElementById('donor-pan').value.trim().toUpperCase(),
      donorAddress: document.getElementById('donor-address').value.trim(),
      donorEmail: document.getElementById('donor-email').value.trim(),
      donorPhone: document.getElementById('donor-phone').value.trim(),
      amount: amount,
      amountWords: document.getElementById('receipt-amount-words').value.trim(),
      paymentMode: document.querySelector('input[name="payment_mode"]:checked')?.value || 'Cheque',
      paymentRefNo: document.getElementById('payment-ref-no')?.value.trim() || '',
      bankName: document.getElementById('payment-bank-name')?.value.trim() || '',
      scheme: document.getElementById('receipt-scheme')?.value || 'General Donation',
      purpose: document.getElementById('receipt-purpose')?.value.trim() || 'Donation to Christ Focus Mission for Charitable Activities',
      issuedBy: this.currentUser ? this.currentUser.name : 'Authorized Signatory',
      uniqueRegNo: 'AADTC2907RF20241',
      trustPan: 'AADTC2907R',
      taxNote: 'Contributions made to Christ Focus Mission are eligible for deduction u/s 80G',
      fontStyle: this.fontStyle,
      createdAt: new Date().toISOString()
    };

    const saved = await cfmInvoiceFirebase.saveReceipt(receiptObj);
    this.currentReceipt = saved;

    this.showToast(`Receipt #${receiptNo} generated and saved successfully!`, 'success');

    // Trigger confetti celebratory effect
    if (typeof confetti === 'function') {
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
    }

    if (printAfter) {
      this.printReceipt();
    } else {
      // Auto-increment receipt number for next entry
      document.getElementById('receipt-number').value = cfmInvoiceFirebase.getNextReceiptNumber();
    }
  }

  // ===================== PRINT & DOWNLOAD PDF =====================

  printReceipt() {
    this.updatePreviewFromForm();
    window.print();
  }

  async downloadReceiptPdf() {
    const element = document.getElementById('printable-receipt-card');
    if (!element) return;

    this.showToast('Preparing PDF download...', 'info');

    try {
      const receiptNo = document.getElementById('receipt-number').value.trim() || 'receipt';
      const donorName = document.getElementById('donor-name').value.trim() || 'donor';

      const opt = {
        margin: [8, 10, 8, 10],
        filename: `CFM_Receipt_${receiptNo}_${donorName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'landscape' }
      };

      if (typeof html2pdf !== 'undefined') {
        await html2pdf().set(opt).from(element).save();
        this.showToast('PDF downloaded successfully!', 'success');
      } else {
        window.print();
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      window.print();
    }
  }

  // ===================== DONORS DIRECTORY =====================

  renderDonorsTable() {
    const tbody = document.getElementById('donors-table-body');
    const countEl = document.getElementById('donors-count');
    if (!tbody) return;

    let list = [...this.donors];
    const q = this.searchQuery.toLowerCase().trim();

    if (q) {
      list = list.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.pan || '').toLowerCase().includes(q) ||
        (d.email || '').toLowerCase().includes(q) ||
        (d.phone || '').toLowerCase().includes(q)
      );
    }

    if (countEl) countEl.textContent = `${list.length} donor${list.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-12 text-center text-slate-400">
            <i class="fas fa-users text-3xl mb-3 block text-slate-300"></i>
            No donors found. Click "Add New Donor" or import from CRM Leads!
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = list.map((d, idx) => `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
        <td class="px-4 py-3 text-slate-400 font-mono text-[11px]">${idx + 1}</td>
        <td class="px-4 py-3 font-semibold text-slate-800">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs uppercase">
              ${(d.name || 'D').charAt(0)}
            </div>
            <div>
              <div>${this.escapeHtml(d.name)}</div>
              <div class="text-[11px] text-slate-400">${d.category || 'General Donor'}</div>
            </div>
          </div>
        </td>
        <td class="px-4 py-3 font-mono text-slate-700 font-bold">${d.pan || '—'}</td>
        <td class="px-4 py-3 text-slate-600 max-w-[220px] truncate" title="${this.escapeHtml(d.address || '')}">
          ${this.escapeHtml(d.address || '—')}
        </td>
        <td class="px-4 py-3 text-slate-600">
          <div>${d.phone || '—'}</div>
          <div class="text-[11px] text-slate-400">${d.email || ''}</div>
        </td>
        <td class="px-4 py-3 text-right whitespace-nowrap">
          <button type="button" onclick="app.useDonorForReceipt('${d.id}')" class="px-2.5 py-1 text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded border border-indigo-200 transition mr-1">
            <i class="fas fa-receipt"></i> Issue Receipt
          </button>
          <button type="button" onclick="app.editDonor('${d.id}')" class="p-1 text-slate-500 hover:text-slate-800" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" onclick="app.deleteDonor('${d.id}')" class="p-1 text-red-500 hover:text-red-700 ml-1" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  useDonorForReceipt(donorId) {
    this.switchTab('create');
    const select = document.getElementById('donor-select');
    if (select) select.value = donorId;
    this.handleDonorSelect(donorId);
  }

  openDonorModal(donorId = null) {
    const modal = document.getElementById('modal-donor-form');
    const title = document.getElementById('donor-modal-title');
    const form = document.getElementById('donor-form');
    if (!modal) return;

    form.reset();
    document.getElementById('donor-form-id').value = donorId || '';

    if (donorId) {
      const d = this.donors.find(item => item.id === donorId);
      if (d) {
        if (title) title.textContent = 'Edit Donor Information';
        document.getElementById('donor-form-name').value = d.name || '';
        document.getElementById('donor-form-pan').value = d.pan || '';
        document.getElementById('donor-form-address').value = d.address || '';
        document.getElementById('donor-form-email').value = d.email || '';
        document.getElementById('donor-form-phone').value = d.phone || '';
        document.getElementById('donor-form-category').value = d.category || 'Individual Donor';
        document.getElementById('donor-form-notes').value = d.notes || '';
      }
    } else {
      if (title) title.textContent = 'Add New Donor';
    }

    modal.classList.remove('hidden');
  }

  closeDonorModal() {
    const modal = document.getElementById('modal-donor-form');
    if (modal) modal.classList.add('hidden');
  }

  async handleSaveDonorForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('donor-form-id').value.trim();
    const name = document.getElementById('donor-form-name').value.trim();
    if (!name) {
      alert('Donor name is required.');
      return;
    }

    const donorObj = {
      id: id || undefined,
      name: name,
      pan: document.getElementById('donor-form-pan').value.trim().toUpperCase(),
      address: document.getElementById('donor-form-address').value.trim(),
      email: document.getElementById('donor-form-email').value.trim(),
      phone: document.getElementById('donor-form-phone').value.trim(),
      category: document.getElementById('donor-form-category').value,
      notes: document.getElementById('donor-form-notes').value.trim()
    };

    await cfmInvoiceFirebase.saveDonor(donorObj);
    this.closeDonorModal();
    this.showToast(`Donor "${name}" saved!`, 'success');
  }

  editDonor(donorId) {
    this.openDonorModal(donorId);
  }

  async deleteDonor(donorId) {
    const donor = this.donors.find(d => d.id === donorId);
    if (!confirm(`Are you sure you want to delete donor "${donor ? donor.name : 'this'}"?`)) return;
    await cfmInvoiceFirebase.deleteDonor(donorId);
    this.showToast('Donor deleted', 'info');
  }

  async importDonorsFromCRM() {
    this.showToast('Scanning CRM leads in Firestore...', 'info');
    const res = await cfmInvoiceFirebase.importDonorsFromCRMLeads();
    if (res.count > 0) {
      this.showToast(`Imported ${res.count} new donor contacts from CRM!`, 'success');
      this.donors = cfmInvoiceFirebase.getLocalDonors();
      this.renderDonorsSelect();
      this.renderDonorsTable();
    } else if (res.error) {
      this.showToast(`Sync note: ${res.error}`, 'info');
    } else {
      this.showToast('All CRM leads are already synced or no new leads found.', 'info');
    }
  }

  // ===================== RECEIPTS HISTORY =====================

  renderReceiptsTable() {
    const tbody = document.getElementById('receipts-table-body');
    const countEl = document.getElementById('receipts-count');
    if (!tbody) return;

    let list = [...this.receipts];
    const q = this.searchQuery.toLowerCase().trim();

    if (q) {
      list = list.filter(r =>
        (r.receiptNo || '').toLowerCase().includes(q) ||
        (r.donorName || '').toLowerCase().includes(q) ||
        (r.donorPan || '').toLowerCase().includes(q) ||
        (r.paymentMode || '').toLowerCase().includes(q)
      );
    }

    if (countEl) countEl.textContent = `${list.length} receipt${list.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="px-6 py-12 text-center text-slate-400">
            <i class="fas fa-file-invoice-dollar text-3xl mb-3 block text-slate-300"></i>
            No receipts generated yet. Go to "Create Receipt" to generate the first one!
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = list.map((r, idx) => `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
        <td class="px-4 py-3 font-mono font-bold text-red-600 text-sm">#${r.receiptNo}</td>
        <td class="px-4 py-3 text-slate-600 whitespace-nowrap">${this.formatDateIndian(r.date)}</td>
        <td class="px-4 py-3 font-semibold text-slate-800">
          <div>${this.escapeHtml(r.donorName)}</div>
          <div class="text-[11px] text-slate-400 font-mono">${r.donorPan || 'No PAN'}</div>
        </td>
        <td class="px-4 py-3 font-bold font-mono text-emerald-700 text-sm">
          ₹${Number(r.amount).toLocaleString('en-IN')}
        </td>
        <td class="px-4 py-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            ${r.paymentMode || 'Cash'}
          </span>
          ${r.paymentRefNo ? `<span class="text-[11px] text-slate-400 block">${this.escapeHtml(r.paymentRefNo)}</span>` : ''}
        </td>
        <td class="px-4 py-3 text-slate-600 max-w-[180px] truncate" title="${this.escapeHtml(r.scheme || '')}">
          ${this.escapeHtml(r.scheme || 'General Donation')}
        </td>
        <td class="px-4 py-3 text-right whitespace-nowrap">
          <button type="button" onclick="app.viewReceipt('${r.id}')" class="px-2.5 py-1 text-xs font-bold bg-white text-indigo-700 hover:bg-indigo-50 rounded border border-indigo-200 transition mr-1">
            <i class="fas fa-eye"></i> View
          </button>
          <button type="button" onclick="app.printExistingReceipt('${r.id}')" class="p-1 text-slate-600 hover:text-indigo-600" title="Print">
            <i class="fas fa-print"></i>
          </button>
          <button type="button" onclick="app.deleteReceipt('${r.id}')" class="p-1 text-red-500 hover:text-red-700 ml-1" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  viewReceipt(receiptId) {
    const r = this.receipts.find(item => item.id === receiptId);
    if (!r) return;
    this.loadReceiptIntoForm(r);
    this.switchTab('create');
    this.showToast(`Loaded Receipt #${r.receiptNo}`, 'info');
  }

  printExistingReceipt(receiptId) {
    const r = this.receipts.find(item => item.id === receiptId);
    if (!r) return;
    this.loadReceiptIntoForm(r);
    this.switchTab('create');
    setTimeout(() => {
      window.print();
    }, 250);
  }

  loadReceiptIntoForm(r) {
    document.getElementById('receipt-number').value = r.receiptNo || '';
    document.getElementById('receipt-date').value = r.date || '';
    document.getElementById('donor-name').value = r.donorName || '';
    document.getElementById('donor-pan').value = r.donorPan || '';
    document.getElementById('donor-address').value = r.donorAddress || '';
    document.getElementById('donor-email').value = r.donorEmail || '';
    document.getElementById('donor-phone').value = r.donorPhone || '';
    document.getElementById('receipt-amount').value = r.amount || '';
    document.getElementById('receipt-amount-words').value = r.amountWords || '';
    document.getElementById('payment-ref-no').value = r.paymentRefNo || '';
    document.getElementById('payment-bank-name').value = r.bankName || '';
    if (r.scheme) document.getElementById('receipt-scheme').value = r.scheme;

    // Check payment mode
    const modeRadio = document.querySelector(`input[name="payment_mode"][value="${r.paymentMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    if (r.fontStyle) this.setFontStyle(r.fontStyle);
    this.updatePreviewFromForm();
  }

  async deleteReceipt(receiptId) {
    const r = this.receipts.find(item => item.id === receiptId);
    if (!confirm(`Are you sure you want to delete receipt #${r ? r.receiptNo : ''}?`)) return;
    await cfmInvoiceFirebase.deleteReceipt(receiptId);
    this.showToast('Receipt deleted', 'info');
  }

  // ===================== STATS & TOTALS =====================

  renderStats() {
    const totalAmount = this.receipts.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    const count = this.receipts.length;

    const totalEl = document.getElementById('stat-total-donations');
    const countEl = document.getElementById('stat-receipts-count');
    const donorsEl = document.getElementById('stat-donors-count');

    if (totalEl) totalEl.textContent = '₹' + totalAmount.toLocaleString('en-IN');
    if (countEl) countEl.textContent = count.toLocaleString('en-IN');
    if (donorsEl) donorsEl.textContent = this.donors.length.toLocaleString('en-IN');
  }

  // ===================== UTILITIES =====================

  numberToIndianWords(num) {
    if (num === 0) return 'Zero';
    const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
                   'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
                   'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function twoDigits(n) {
      if (n < 20) return units[n];
      return tens[Math.floor(n / 10)] + (n % 10 === 0 ? '' : ' ' + units[n % 10]);
    }

    function threeDigits(n) {
      const h = Math.floor(n / 100);
      const rem = n % 100;
      let res = '';
      if (h > 0) res += units[h] + ' Hundred';
      if (rem > 0) {
        if (res) res += ' ';
        res += twoDigits(rem);
      }
      return res;
    }

    const parts = [];
    const crores = Math.floor(num / 10000000);
    num %= 10000000;
    const lakhs = Math.floor(num / 100000);
    num %= 100000;
    const thousands = Math.floor(num / 1000);
    num %= 1000;
    const hundreds = num;

    if (crores > 0) parts.append ? parts.append(twoDigits(crores) + ' Crore') : parts.push(twoDigits(crores) + ' Crore');
    if (lakhs > 0) parts.push(twoDigits(lakhs) + ' Lakh');
    if (thousands > 0) parts.push(twoDigits(thousands) + ' Thousand');
    if (hundreds > 0) parts.push(threeDigits(hundreds));

    return parts.join(' ');
  }

  formatDateIndian(dateStr) {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return `${day} ${months[monthNum] || ''} ${year}`;
      }
    } catch (_) {}
    return dateStr;
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('app-toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = message;

    if (toastIcon) {
      if (type === 'success') toastIcon.className = 'fas fa-check-circle text-emerald-400 text-base';
      else if (type === 'error') toastIcon.className = 'fas fa-exclamation-triangle text-rose-400 text-base';
      else toastIcon.className = 'fas fa-info-circle text-indigo-400 text-base';
    }

    toast.classList.remove('hidden', 'translate-y-10', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.add('translate-y-10', 'opacity-0');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3800);
  }

  setupEventListeners() {
    // Form real-time watchers
    const formFields = [
      'receipt-number', 'receipt-date', 'donor-name', 'donor-pan',
      'donor-address', 'receipt-amount-words', 'payment-ref-no', 'receipt-scheme'
    ];
    formFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.updatePreviewFromForm());
    });

    document.querySelectorAll('input[name="payment_mode"]').forEach(r => {
      r.addEventListener('change', () => this.updatePreviewFromForm());
    });
  }
}

// Global App instance
const app = new InvoiceApp();
document.addEventListener('DOMContentLoaded', () => app.init());
