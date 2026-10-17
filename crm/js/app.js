/**
 * Christ Focus Mission - Fundraising Leads Tracker
 * Main Application Logic & User Interface Controller
 */

// Streamlined 5-Stage Donor Progression Pipeline
const CFM_STAGES = [
  { id: 'new', label: 'New Leads', color: 'slate', icon: 'fa-user-plus' },
  { id: 'contacted', label: 'Contacted', color: 'blue', icon: 'fa-paper-plane' },
  { id: 'in_discussion', label: 'In Discussion', color: 'purple', icon: 'fa-comments' },
  { id: 'committed', label: 'Committed', color: 'emerald', icon: 'fa-heart' },
  { id: 'closed', label: 'Closed', color: 'gray', icon: 'fa-box-archive' }
];

const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  GBP: '£',
  EUR: '€'
};

class CFMApp {
  constructor() {
    this.leads = [];
    this.campaigns = (typeof CFM_INITIAL_CAMPAIGNS !== 'undefined' && Array.isArray(CFM_INITIAL_CAMPAIGNS)) ? [...CFM_INITIAL_CAMPAIGNS] : [];
    this.users = (typeof CFM_INITIAL_USERS !== 'undefined' && Array.isArray(CFM_INITIAL_USERS)) ? [...CFM_INITIAL_USERS] : [];
    this.activeView = 'kanban'; // 'kanban' | 'table' | 'campaigns' | 'followups' | 'analytics'
    this.searchTerm = '';
    this.stageFilter = 'all';
    this.campaignFilter = 'all';
    this.priorityFilter = 'all';
    this.assignedFilter = 'all';
    // Default currency: INR (Indian Rupee ₹)
    const savedCurrency = localStorage.getItem(CFM_STORAGE_KEYS.ACTIVE_CURRENCY);
    const explicitlySet = localStorage.getItem('cfm_currency_explicitly_set');
    if (!savedCurrency || !explicitlySet) {
      this.currency = 'INR';
      localStorage.setItem(CFM_STORAGE_KEYS.ACTIVE_CURRENCY, 'INR');
    } else {
      this.currency = savedCurrency;
    }
    this.selectedLead = null;
    this.draggedLeadId = null;
    this.analyticsChartInstance = null;
    this.networkModel = 'B'; // 'A' (One-time) or 'B' (Monthly Subscription)
    this.networkContribution = 1000; // INR 1,000
    this.networkActivationPct = 100; // 100% milestone target
    this.userRole = localStorage.getItem('cfm_user_role') || 'crm';
    this.selectedRoleOption = this.userRole;
    this.currentUser = null;
    this.adminSubTab = 'users'; // 'users' | 'firebase' | 'security'
    this.lineageViewMode = 'tree'; // 'tree' | 'table'
    this.lineageStageFilter = 'all';
    this.lineageStatusFilter = 'all'; // 'all' | 'reached' | 'progress' | 'pending'
    this.lineageSearchTerm = '';
    this.expandedLineageNodes = new Set();
  }

  async init() {
    // Purge legacy mock sample leads from localStorage while strictly preserving real user leads and official campaigns
    try {
      const rawLeads = localStorage.getItem(CFM_STORAGE_KEYS.LOCAL_LEADS);
      if (rawLeads) {
        const parsed = JSON.parse(rawLeads);
        if (Array.isArray(parsed)) {
          const cleanLeads = parsed.filter(l => !cfmFirebase.isSampleLead(l));
          if (cleanLeads.length !== parsed.length) {
            localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_LEADS, JSON.stringify(cleanLeads));
          }
        }
      }
      const rawCamps = localStorage.getItem(CFM_STORAGE_KEYS.LOCAL_CAMPAIGNS);
      if (!rawCamps || rawCamps === '[]' || rawCamps === 'null') {
        const initialCamps = (typeof CFM_INITIAL_CAMPAIGNS !== 'undefined' && Array.isArray(CFM_INITIAL_CAMPAIGNS)) ? CFM_INITIAL_CAMPAIGNS : [];
        if (initialCamps.length > 0) {
          localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_CAMPAIGNS, JSON.stringify(initialCamps));
        }
      }
      const rawUsers = localStorage.getItem(CFM_STORAGE_KEYS.LOCAL_USERS);
      if (rawUsers) {
        const u = JSON.parse(rawUsers);
        if (Array.isArray(u)) {
          const cleanUsers = u.filter(x => x.id !== 'user-2' && x.id !== 'user-3' && x.id !== 'user-4');
          const hasNelson = cleanUsers.some(x => (x.id === 'user-nelson') || (x.email && x.email.includes('nelsonrichard')));
          if (!hasNelson && typeof CFM_INITIAL_USERS !== 'undefined') {
            const nelson = CFM_INITIAL_USERS.find(x => x.id === 'user-nelson');
            if (nelson) cleanUsers.push(nelson);
          }
          localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_USERS, JSON.stringify(cleanUsers));
        }
      }
    } catch(e) {
      console.warn("Storage init cleanup error:", e);
    }

    this.checkAuthStatus();
    this.bindGlobalEvents();
    this.renderHeaderStatus();
    this.populateCampaignFilters();
    this.populateAssignedUserDropdowns();

    // Initialize Firebase service
    const initRes = await cfmFirebase.init();
    this.updateFirebaseBadge(initRes);

    // Subscribe to users
    cfmFirebase.subscribeToUsers((users, mode) => {
      this.users = users;
      this.populateAssignedUserDropdowns();
      if (this.activeView === 'users' || this.activeView === 'admin') {
        this.renderAdminView();
      }
      const userModal = document.getElementById('modal-user-management');
      if (userModal && !userModal.classList.contains('hidden')) {
        this.renderUsersModalContent();
      }
    });

    // Subscribe to campaigns
    cfmFirebase.subscribeToCampaigns((campaigns, mode) => {
      this.campaigns = campaigns;
      this.populateCampaignFilters();
      if (this.activeView === 'campaigns') this.renderCampaignsView();
      if (this.activeView === 'analytics') this.renderAnalyticsView();
    });

    // Subscribe to leads (Real-time Firestore or Local)
    cfmFirebase.subscribeToLeads((leads, mode) => {
      this.leads = leads;
      this.render();
      if (this.selectedLead) {
        // If details modal is open, refresh selected lead
        const refreshed = this.leads.find(l => l.id === this.selectedLead.id);
        if (refreshed) {
          this.selectedLead = refreshed;
          this.renderLeadDetailsContent();
        }
      }
    });
  }

  // Bind top navbar & interactive events
  bindGlobalEvents() {
    // Navigation view switcher
    document.querySelectorAll('[data-view-target]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.getAttribute('data-view-target');
        this.switchView(view);
      });
    });

    // Search input
    const searchInput = document.getElementById('search-leads-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.renderMainContent();
      });
    }

    // Filter selects
    const stageSelect = document.getElementById('filter-stage');
    if (stageSelect) {
      stageSelect.addEventListener('change', (e) => {
        this.stageFilter = e.target.value;
        this.renderMainContent();
      });
    }

    const campaignSelect = document.getElementById('filter-campaign');
    if (campaignSelect) {
      campaignSelect.addEventListener('change', (e) => {
        this.campaignFilter = e.target.value;
        this.renderMainContent();
      });
    }

    const prioritySelect = document.getElementById('filter-priority');
    if (prioritySelect) {
      prioritySelect.addEventListener('change', (e) => {
        this.priorityFilter = e.target.value;
        this.renderMainContent();
      });
    }

    // Currency Switcher
    const currencySelect = document.getElementById('currency-selector');
    if (currencySelect) {
      currencySelect.value = this.currency;
      currencySelect.addEventListener('change', (e) => {
        this.currency = e.target.value;
        localStorage.setItem(CFM_STORAGE_KEYS.ACTIVE_CURRENCY, this.currency);
        localStorage.setItem('cfm_currency_explicitly_set', 'true');
        this.render();
      });
    }

    // New Lead Button
    const btnNewLead = document.getElementById('btn-new-lead');
    if (btnNewLead) {
      btnNewLead.addEventListener('click', () => this.openLeadModal());
    }

    // Firebase Settings Button
    const btnFirebaseModal = document.getElementById('btn-firebase-settings');
    if (btnFirebaseModal) {
      btnFirebaseModal.addEventListener('click', () => this.openFirebaseModal());
    }

    // Export CSV Button
    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) {
      btnExport.addEventListener('click', () => this.exportLeadsCSV());
    }

    // Reset Data Button
    const btnReset = document.getElementById('btn-reset-demo');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm("Reset local leads and campaigns to initial sample dataset?")) {
          cfmFirebase.resetLocalData();
          window.location.reload();
        }
      });
    }
  }

  switchView(view) {
    if ((view === 'admin' || view === 'users') && this.userRole !== 'admin') {
      alert("Permission Denied: Administrator Control Center is restricted to Administrators only.");
      this.switchView('kanban');
      return;
    }

    this.activeView = view;
    document.querySelectorAll('[data-view-target]').forEach(b => {
      const target = b.getAttribute('data-view-target');
      const isTarget = target === view || (view === 'admin' && target === 'admin') || (view === 'users' && target === 'admin');
      b.classList.toggle('bg-amber-600', isTarget);
      b.classList.toggle('text-white', isTarget);
      b.classList.toggle('text-slate-200', !isTarget);
      b.classList.toggle('hover:bg-slate-800', !isTarget);
      if (isTarget) {
        // Auto-center the clicked header in mobile horizontal scroll view
        b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });

    // Hide or show filters toolbar based on view
    const filterToolbar = document.getElementById('leads-filter-toolbar');
    if (filterToolbar) {
      filterToolbar.classList.toggle('hidden', view === 'campaigns' || view === 'analytics' || view === 'network' || view === 'users' || view === 'admin');
    }

    this.renderMainContent();
  }

  // Populate dynamic select options for campaigns
  populateCampaignFilters() {
    const filterSelect = document.getElementById('filter-campaign');
    const modalSelect = document.getElementById('modal-lead-campaign');

    let campaignList = (Array.isArray(this.campaigns) && this.campaigns.length > 0)
      ? this.campaigns
      : (typeof cfmFirebase !== 'undefined' ? cfmFirebase.getLocalCampaigns() : (typeof CFM_INITIAL_CAMPAIGNS !== 'undefined' ? CFM_INITIAL_CAMPAIGNS : []));

    if (!campaignList || campaignList.length === 0) {
      campaignList = (typeof CFM_INITIAL_CAMPAIGNS !== 'undefined' && CFM_INITIAL_CAMPAIGNS.length > 0)
        ? CFM_INITIAL_CAMPAIGNS
        : [
            { id: "camp-1", name: "General Mission & Operations Fund", code: "GEN-2026" },
            { id: "camp-2", name: "Rural Church Planting Initiative", code: "PLANT-2026" },
            { id: "camp-3", name: "Youth & Discipleship Camp 2026", code: "YOUTH-2026" },
            { id: "camp-4", name: "Community Medical & Relief Outreach", code: "MED-2026" },
            { id: "camp-5", name: "Mission Training Center Expansion", code: "BLDG-2026" }
          ];
    }

    if (filterSelect) {
      const cur = filterSelect.value;
      let html = '<option value="all">All Campaigns</option>';
      campaignList.forEach(c => {
        html += `<option value="${c.id}">${this.escapeHtml(c.name)} (${this.escapeHtml(c.code || 'FUND')})</option>`;
      });
      filterSelect.innerHTML = html;
      if (cur) filterSelect.value = cur;
    }

    if (modalSelect) {
      const cur = modalSelect.value;
      let modalHtml = '<option value="">-- Select Campaign / Ministry Fund --</option>';
      campaignList.forEach(c => {
        modalHtml += `<option value="${c.id}">${this.escapeHtml(c.name)} (${this.escapeHtml(c.code || 'FUND')})</option>`;
      });
      modalSelect.innerHTML = modalHtml;
      if (cur) modalSelect.value = cur;
    }
  }

  // Filter leads based on current search & filter state
  getFilteredLeads() {
    return this.leads.filter(lead => {
      // Stage filter (with backward-compatible stage normalization)
      if (this.stageFilter !== 'all' && this.normalizeStage(lead.stage) !== this.stageFilter) return false;

      // Campaign filter
      if (this.campaignFilter !== 'all' && lead.campaignId !== this.campaignFilter) return false;

      // Priority filter
      if (this.priorityFilter !== 'all' && lead.priority !== this.priorityFilter) return false;

      // Search term
      if (this.searchTerm) {
        const text = [
          lead.name,
          lead.organization,
          lead.email,
          lead.phone,
          lead.city,
          lead.country,
          lead.assignedTo,
          lead.notes,
          lead.prayerRequests
        ].filter(Boolean).join(' ').toLowerCase();

        if (!text.includes(this.searchTerm)) return false;
      }

      return true;
    });
  }

  // Primary render function
  render() {
    this.renderMetricsSummary();
    this.renderMainContent();
  }

  // Top metric overview cards
  renderMetricsSummary() {
    const filtered = this.getFilteredLeads();
    const allLeads = this.leads;

    // Total Pipeline Potential
    const totalPipeline = allLeads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);
    // Total Committed / Won
    const totalCommitted = allLeads.filter(l => this.normalizeStage(l.stage) === 'committed')
      .reduce((sum, l) => sum + (Number(l.receivedAmount) || Number(l.expectedAmount) || 0), 0);
    // Active Leads (in progress stages: new, contacted, in_discussion)
    const activeLeads = allLeads.filter(l => ['new', 'contacted', 'in_discussion'].includes(this.normalizeStage(l.stage))).length;
    // Conversion rate
    const closedCount = allLeads.filter(l => ['committed', 'closed'].includes(this.normalizeStage(l.stage))).length;
    const wonCount = allLeads.filter(l => this.normalizeStage(l.stage) === 'committed').length;
    const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

    // Overdue or Today follow-ups
    const todayStr = new Date().toISOString().split('T')[0];
    const followUpsDue = allLeads.filter(l => {
      const norm = this.normalizeStage(l.stage);
      return l.nextFollowUp && l.nextFollowUp <= todayStr && norm !== 'committed' && norm !== 'closed';
    }).length;

    // Update DOM elements
    const format = (amt) => this.formatCurrency(amt);

    const elTotal = document.getElementById('metric-total-pipeline');
    if (elTotal) elTotal.textContent = format(totalPipeline);

    const elCommitted = document.getElementById('metric-total-committed');
    if (elCommitted) elCommitted.textContent = format(totalCommitted);

    const elActive = document.getElementById('metric-active-leads');
    if (elActive) elActive.textContent = activeLeads;

    const elConv = document.getElementById('metric-conversion-rate');
    if (elConv) elConv.textContent = `${conversionRate}% (${wonCount} partners)`;

    const elFollow = document.getElementById('metric-followups-due');
    if (elFollow) {
      elFollow.textContent = followUpsDue;
      elFollow.parentElement.classList.toggle('text-rose-600', followUpsDue > 0);
    }
  }

  // Render view router
  renderMainContent() {
    const container = document.getElementById('main-view-container');
    if (!container) return;

    if (this.activeView === 'kanban') {
      this.renderKanbanView();
    } else if (this.activeView === 'table') {
      this.renderTableView();
    } else if (this.activeView === 'campaigns') {
      this.renderCampaignsView();
    } else if (this.activeView === 'network') {
      this.renderNetworkScalingView();
    } else if (this.activeView === 'followups') {
      this.renderFollowupsView();
    } else if (this.activeView === 'analytics') {
      this.renderAnalyticsView();
    } else if (this.activeView === 'admin' || this.activeView === 'users') {
      if (this.userRole !== 'admin') {
        this.switchView('kanban');
        return;
      }
      this.renderAdminView();
    }
  }

  // ===================== KANBAN VIEW =====================
  renderKanbanView() {
    const container = document.getElementById('main-view-container');
    const filteredLeads = this.getFilteredLeads();

    let html = `
      <!-- Mobile Stage Switcher Jump Bar (Touch-friendly jump to any stage) -->
      <div class="block md:hidden mb-2.5 overflow-x-auto no-scrollbar pb-1">
        <div class="flex items-center gap-1.5 text-xs font-bold min-w-max">
          <span class="text-slate-400 text-[10px] uppercase font-bold mr-0.5">Jump to:</span>
          ${CFM_STAGES.map(s => {
            const count = filteredLeads.filter(l => this.normalizeStage(l.stage) === s.id).length;
            return `
              <button onclick="app.scrollToStageColumn('${s.id}', this)" class="stage-jump-pill px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700 shadow-xs flex items-center gap-1.5 shrink-0 text-[11px] active:scale-95 transition">
                <span class="w-2 h-2 rounded-full bg-${s.color}-500"></span>
                <span>${s.label}</span>
                <span class="text-[10px] text-slate-400 font-semibold">(${count})</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <div class="kanban-wrapper w-full overflow-x-auto pb-8 pt-1 no-scrollbar">
        <div class="flex items-start gap-3 sm:gap-4 min-w-max">
    `;

    CFM_STAGES.forEach(stage => {
      const stageLeads = filteredLeads.filter(l => this.normalizeStage(l.stage) === stage.id);
      const stageTotal = stageLeads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);

      html += `
        <div class="flex flex-col w-[86vw] sm:w-[300px] min-w-[86vw] sm:min-w-[300px] max-w-[86vw] sm:max-w-[300px] flex-shrink-0 bg-slate-100/95 rounded-xl border border-slate-200/90 shadow-sm kanban-column"
             data-stage-column="${stage.id}"
             ondragover="app.handleDragOver(event)"
             ondragleave="app.handleDragLeave(event)"
             ondrop="app.handleDrop(event, '${stage.id}')">
          <!-- Column Header -->
          <div class="p-3 border-b border-slate-200 bg-white/70 rounded-t-xl flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="w-2.5 h-2.5 rounded-full bg-${stage.color}-500"></span>
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700">${stage.label}</h3>
            </div>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
              ${stageLeads.length}
            </span>
          </div>

          <!-- Subheader / Column Pipeline Amount -->
          <div class="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-medium text-slate-500 flex justify-between">
            <span>Potential:</span>
            <span class="font-bold text-slate-800">${this.formatCurrency(stageTotal)}</span>
          </div>

          <!-- Cards List -->
          <div class="p-2 space-y-2.5 flex-1 overflow-y-auto max-h-[calc(100vh-340px)]">
            ${stageLeads.length === 0 ? `
              <div class="h-28 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-400 italic">
                Drop leads here
              </div>
            ` : stageLeads.map(lead => this.renderKanbanCard(lead)).join('')}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
    container.innerHTML = html;
  }

  renderKanbanCard(lead) {
    const campaign = this.campaigns.find(c => c.id === lead.campaignId);
    const campaignName = campaign ? campaign.name : 'General Fund';
    const isOverdue = lead.nextFollowUp && lead.nextFollowUp < new Date().toISOString().split('T')[0] && this.normalizeStage(lead.stage) !== 'committed' && this.normalizeStage(lead.stage) !== 'closed';
    const isToday = lead.nextFollowUp && lead.nextFollowUp === new Date().toISOString().split('T')[0];

    const priorityClass = lead.priority === 'High' ? 'priority-high' : lead.priority === 'Medium' ? 'priority-medium' : 'priority-normal';

    return `
      <div class="bg-white rounded-lg p-3.5 shadow-sm border border-slate-200 kanban-card ${priorityClass} relative select-none"
           draggable="true"
           ondragstart="app.handleDragStart(event, '${lead.id}')"
           onclick="app.openLeadDetails('${lead.id}')">
        
        <!-- Header: Lead Type & Priority -->
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
            ${lead.leadType || 'Individual'}
          </span>
          ${lead.priority === 'High' ? `
            <span class="text-[10px] font-bold text-red-600 flex items-center gap-1">
              <i class="fas fa-fire-alt text-xs"></i> High
            </span>
          ` : ''}
        </div>

        <!-- Name & Organization -->
        <h4 class="font-bold text-slate-900 text-sm leading-snug hover:text-amber-700 transition">
          ${this.escapeHtml(lead.name)}
        </h4>
        ${lead.organization ? `
          <p class="text-xs text-slate-500 line-clamp-1 mb-1">
            <i class="far fa-building mr-1 text-slate-400"></i>${this.escapeHtml(lead.organization)}
          </p>
        ` : ''}

        <!-- Campaign Tag -->
        <div class="my-2">
          <span class="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/60 truncate max-w-full">
            <i class="fas fa-cross mr-1 text-[10px] text-amber-600"></i>${this.escapeHtml(campaignName)}
          </span>
        </div>

        <!-- 5-Level Scaling Lineage & Level Quota Badge -->
        ${lead.networkTier ? (() => {
          const info = this.getLeaderLevelInfo(lead.id);
          const parent = info ? info.parentLead : null;
          return `
            <div class="my-1.5 p-1.5 rounded-md bg-slate-50 border border-slate-200/80 text-[10px] space-y-0.5">
              <div class="flex items-center justify-between">
                <span class="font-bold text-slate-800">${this.getStageRoleLabel(lead.networkTier)}</span>
                ${info ? `
                  <span class="px-1.5 py-0.2 rounded font-extrabold ${info.isReached ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : info.recruitCount > 0 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-slate-200 text-slate-600'}">
                    ${info.isReached ? '★ 10/10 ✓' : `${info.recruitCount}/10`}
                  </span>
                ` : ''}
              </div>
              <div class="text-slate-500 truncate">
                ${parent ? `
                  <i class="fas fa-level-up-alt rotate-90 text-amber-500 text-[9px]"></i> Under: <span class="font-semibold text-slate-700">${this.escapeHtml(parent.name)}</span>
                ` : `
                  <i class="fas fa-crown text-amber-500 text-[9px]"></i> <span class="font-bold text-amber-800">Root Core Leader</span>
                `}
              </div>
            </div>
          `;
        })() : ''}

        <!-- Financial Row -->
        <div class="flex items-baseline justify-between mt-2 pt-2 border-t border-slate-100">
          <div>
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Target</span>
            <div class="text-xs font-bold text-slate-900">
              ${this.formatCurrency(lead.expectedAmount)}
              <span class="text-[10px] text-slate-500 font-normal">/${lead.frequency || 'yr'}</span>
            </div>
          </div>
          ${Number(lead.receivedAmount) > 0 ? `
            <div class="text-right">
              <span class="text-[10px] text-emerald-600 uppercase font-semibold">Recv'd</span>
              <div class="text-xs font-bold text-emerald-700">
                ${this.formatCurrency(lead.receivedAmount)}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Next Follow-up & Assigned -->
        <div class="flex items-center justify-between mt-2 pt-1.5 text-[11px] text-slate-500">
          <div class="flex items-center gap-1">
            <i class="fas fa-user-circle text-slate-400"></i>
            <span class="truncate max-w-[85px]">${lead.assignedTo || 'Unassigned'}</span>
          </div>

          ${lead.nextFollowUp ? `
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 ${
              isOverdue ? 'badge-overdue' : isToday ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-600'
            }">
              <i class="far fa-clock"></i> ${this.formatShortDate(lead.nextFollowUp)}
            </span>
          ` : ''}
        </div>

        <!-- Prayer Request badge if exists -->
        ${lead.prayerRequests ? `
          <div class="mt-2 pt-1 border-t border-dashed border-slate-100 flex items-center gap-1 text-[11px] text-indigo-700 font-medium">
            <i class="fas fa-pray text-indigo-500 text-xs"></i>
            <span class="truncate text-[10px]">Has prayer request</span>
          </div>
        ` : ''}

        <!-- Mobile Stage Changer (Touch device friendly) -->
        <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[11px] sm:hidden" onclick="event.stopPropagation()">
          <span class="text-[10px] text-slate-400 font-semibold">Move Stage:</span>
          <select onchange="app.handleStageChangeDirect('${lead.id}', this.value)" class="text-[11px] font-bold py-1 px-2 rounded-md bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500">
            ${CFM_STAGES.map(s => `
              <option value="${s.id}" ${this.normalizeStage(lead.stage) === s.id ? 'selected' : ''}>${s.label}</option>
            `).join('')}
          </select>
        </div>
      </div>
    `;
  }

  scrollToStageColumn(stageId, btnElement) {
    if (btnElement) {
      document.querySelectorAll('.stage-jump-pill').forEach(el => {
        el.classList.remove('ring-2', 'ring-amber-500', 'bg-amber-50', 'border-amber-400', 'text-amber-900');
        el.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
      });
      btnElement.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
      btnElement.classList.add('ring-2', 'ring-amber-500', 'bg-amber-50', 'border-amber-400', 'text-amber-900');
      // Auto-center clicked pill in mobile horizontal stage jump bar
      btnElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    const col = document.querySelector(`[data-stage-column="${stageId}"]`);
    if (col) {
      col.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  async handleStageChangeDirect(leadId, targetStage) {
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead || lead.stage === targetStage) return;

    lead.stage = targetStage;
    this.render();

    if (targetStage === 'committed') {
      this.celebrateSuccess();
      this.showToast(`Praise God! ${lead.name} marked as Committed Partner!`, 'success');
    } else {
      this.showToast(`Updated stage for ${lead.name}`, 'info');
    }

    try {
      await cfmFirebase.updateLead(leadId, {
        stage: targetStage,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error updating stage:", err);
    }
  }

  // Drag and Drop handlers for Kanban
  handleDragStart(e, leadId) {
    this.draggedLeadId = leadId;
    e.dataTransfer.setData('text/plain', leadId);
    e.currentTarget.classList.add('dragging');
  }

  handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  async handleDrop(e, targetStage) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const leadId = this.draggedLeadId || e.dataTransfer.getData('text/plain');

    if (!leadId) return;

    const lead = this.leads.find(l => l.id === leadId);
    if (!lead || lead.stage === targetStage) return;

    const oldStage = lead.stage;
    lead.stage = targetStage; // Optimistic in-memory update
    this.render(); // Immediate re-render!

    // Trigger celebration if moving to committed!
    if (targetStage === 'committed') {
      this.celebrateSuccess();
      this.showToast(`Praise God! ${lead.name} marked as Committed Partner!`, 'success');
    } else {
      this.showToast(`Updated stage for ${lead.name}`, 'info');
    }

    try {
      await cfmFirebase.updateLead(leadId, {
        stage: targetStage,
        activities: [
          {
            id: 'act-' + Date.now(),
            date: new Date().toISOString().split('T')[0],
            type: 'Stage Change',
            summary: `Moved from "${this.getStageLabel(oldStage)}" to "${this.getStageLabel(targetStage)}"`,
            author: 'Team Member'
          },
          ...(lead.activities || [])
        ]
      });
    } catch (err) {
      lead.stage = oldStage; // Revert on failure
      this.render();
      this.showToast(`Error updating stage: ${err.message}`, 'error');
    }
  }

  // ===================== TABLE VIEW =====================
  renderTableView() {
    const container = document.getElementById('main-view-container');
    const filteredLeads = this.getFilteredLeads();

    let html = `
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/70">
          <div>
            <h3 class="font-bold text-slate-800">All Fundraising Leads</h3>
            <p class="text-xs text-slate-500">Showing ${filteredLeads.length} of ${this.leads.length} records</p>
          </div>
          <button onclick="app.exportLeadsCSV()" class="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm font-semibold flex items-center gap-1.5 transition">
            <i class="fas fa-file-csv text-emerald-600"></i> Export to CSV
          </button>
        </div>

        <!-- Mobile Card Stack (Visible on mobile screens < 768px) -->
        <div class="block md:hidden divide-y divide-slate-100">
          ${filteredLeads.length === 0 ? `
            <div class="py-12 text-center text-slate-400 p-4">
              <i class="fas fa-search text-3xl mb-2 text-slate-300"></i>
              <p class="text-xs">No fundraising leads match your current search and filters.</p>
            </div>
          ` : filteredLeads.map(lead => {
            const campaign = this.campaigns.find(c => c.id === lead.campaignId);
            const stageObj = CFM_STAGES.find(s => s.id === this.normalizeStage(lead.stage)) || CFM_STAGES[0];
            const isOverdue = lead.nextFollowUp && lead.nextFollowUp < new Date().toISOString().split('T')[0] && this.normalizeStage(lead.stage) !== 'committed' && this.normalizeStage(lead.stage) !== 'closed';
            const priorityBorder = lead.priority === 'High' ? 'border-l-4 border-l-red-500' : lead.priority === 'Medium' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-cyan-500';

            return `
              <div class="p-3.5 hover:bg-slate-50 transition cursor-pointer bg-white ${priorityBorder}" onclick="app.openLeadDetails('${lead.id}')">
                <div class="flex items-start justify-between gap-2 mb-1.5">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <h4 class="font-bold text-slate-900 text-sm leading-tight">${this.escapeHtml(lead.name)}</h4>
                      <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-slate-100 text-slate-600">
                        ${lead.leadType || 'Individual'}
                      </span>
                    </div>
                    ${lead.organization ? `
                      <div class="text-xs text-slate-500 truncate mt-0.5">${this.escapeHtml(lead.organization)}</div>
                    ` : ''}
                  </div>
                  
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-${stageObj.color}-100 text-${stageObj.color}-800 border border-${stageObj.color}-200 shrink-0">
                    ${stageObj.label}
                  </span>
                </div>

                <!-- Financial Progress -->
                <div class="grid grid-cols-2 gap-2 my-2 py-2 border-y border-slate-100 text-xs">
                  <div>
                    <span class="text-[10px] text-slate-400 block uppercase font-semibold">Target</span>
                    <span class="font-bold text-slate-900">${this.formatCurrency(lead.expectedAmount)}</span>
                    <span class="text-[10px] text-slate-400">/${lead.frequency || 'one-off'}</span>
                  </div>
                  <div class="text-right">
                    <span class="text-[10px] text-emerald-600 block uppercase font-semibold">Received</span>
                    <span class="font-bold text-emerald-700">${Number(lead.receivedAmount) > 0 ? this.formatCurrency(lead.receivedAmount) : '₹0'}</span>
                  </div>
                </div>

                <!-- Meta & Action row -->
                <div class="flex items-center justify-between text-[11px] text-slate-500">
                  <div class="flex items-center gap-1 truncate">
                    <span class="truncate max-w-[140px] text-slate-600 font-medium">
                      <i class="fas fa-cross text-[9px] text-amber-600 mr-1"></i>${this.escapeHtml(campaign ? campaign.name : 'General Mission')}
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">
                    <button onclick="app.openLeadModal('${lead.id}')" title="Edit Form" class="p-1.5 text-slate-500 hover:text-blue-600 rounded bg-slate-100 active:scale-95 transition">
                      <i class="far fa-edit text-xs"></i>
                    </button>
                    ${this.userRole === 'admin' ? `
                      <button onclick="app.confirmDeleteLead('${lead.id}')" title="Delete" class="p-1.5 text-slate-400 hover:text-rose-600 rounded bg-slate-100 active:scale-95 transition">
                        <i class="far fa-trash-alt text-xs"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>

                ${lead.nextFollowUp ? `
                  <div class="mt-2 flex items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-dashed border-slate-100">
                    <span>Assigned: <strong class="text-slate-600">${lead.assignedTo || 'Unassigned'}</strong></span>
                    <span class="px-1.5 py-0.5 rounded font-medium ${isOverdue ? 'badge-overdue' : 'text-slate-600 bg-slate-100'}">
                      <i class="far fa-clock mr-0.5"></i> ${this.formatShortDate(lead.nextFollowUp)}
                    </span>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <!-- Desktop Full Table (Visible on md: screens >= 768px) -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-slate-100/70 border-b border-slate-200 text-xs uppercase font-semibold text-slate-600">
                <th class="py-3 px-4">Lead / Organization</th>
                <th class="py-3 px-4">Type</th>
                <th class="py-3 px-4">Stage / Pipeline</th>
                <th class="py-3 px-4">Campaign Fund</th>
                <th class="py-3 px-4 text-right">Target Amount</th>
                <th class="py-3 px-4 text-right">Received</th>
                <th class="py-3 px-4">Next Follow-up</th>
                <th class="py-3 px-4">Assigned To</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${filteredLeads.length === 0 ? `
                <tr>
                  <td colspan="9" class="py-12 text-center text-slate-400">
                    <i class="fas fa-search text-3xl mb-2 text-slate-300"></i>
                    <p class="text-sm">No fundraising leads match your current search and filters.</p>
                  </td>
                </tr>
              ` : filteredLeads.map(lead => {
                const campaign = this.campaigns.find(c => c.id === lead.campaignId);
                const isOverdue = lead.nextFollowUp && lead.nextFollowUp < new Date().toISOString().split('T')[0] && this.normalizeStage(lead.stage) !== 'committed' && this.normalizeStage(lead.stage) !== 'closed';
                
                return `
                  <tr class="hover:bg-amber-50/30 transition cursor-pointer" onclick="app.openLeadDetails('${lead.id}')">
                    <td class="py-3 px-4">
                      <div class="font-bold text-slate-900">${this.escapeHtml(lead.name)}</div>
                      ${lead.organization ? `
                        <div class="text-xs text-slate-500">${this.escapeHtml(lead.organization)}</div>
                      ` : ''}
                      ${lead.networkTier ? (() => {
                        const info = this.getLeaderLevelInfo(lead.id);
                        const parent = info ? info.parentLead : null;
                        return `
                          <div class="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              ${this.getStageRoleLabel(lead.networkTier)}
                            </span>
                            ${parent ? `
                              <span class="text-[10px] text-slate-500 flex items-center gap-0.5">
                                <i class="fas fa-level-up-alt rotate-90 text-amber-500 text-[9px]"></i> Under: <strong class="text-slate-700">${this.escapeHtml(parent.name)}</strong>
                              </span>
                            ` : `
                              <span class="text-[10px] text-amber-800 font-bold flex items-center gap-0.5">
                                <i class="fas fa-crown text-amber-500 text-[9px]"></i> Root Core Leader
                              </span>
                            `}
                            ${info ? `
                              <span class="text-[10px] px-1.5 py-0.2 rounded font-bold ${info.isReached ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : info.recruitCount > 0 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-slate-100 text-slate-500'}">
                                ${info.isReached ? '★ Quota Met (10/10) ✓' : `${info.recruitCount}/10 Recruits`}
                              </span>
                            ` : ''}
                          </div>
                        `;
                      })() : ''}
                      ${lead.prayerRequests ? `
                        <div class="text-[11px] text-indigo-600 flex items-center gap-1 mt-0.5">
                          <i class="fas fa-pray text-[10px]"></i> Prayer noted
                        </div>
                      ` : ''}
                    </td>

                    <td class="py-3 px-4">
                      <span class="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                        ${lead.leadType || 'Individual'}
                      </span>
                    </td>

                    <td class="py-3 px-4" onclick="event.stopPropagation()">
                      <select onchange="app.quickUpdateStage('${lead.id}', this.value)" 
                              class="text-xs font-semibold rounded-lg px-2 py-1 border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500">
                        ${CFM_STAGES.map(s => `
                          <option value="${s.id}" ${this.normalizeStage(lead.stage) === s.id ? 'selected' : ''}>${s.label}</option>
                        `).join('')}
                      </select>
                    </td>

                    <td class="py-3 px-4">
                      <span class="text-xs text-slate-700 font-medium">
                        ${campaign ? campaign.name : 'General Mission'}
                      </span>
                    </td>

                    <td class="py-3 px-4 text-right font-bold text-slate-900">
                      ${this.formatCurrency(lead.expectedAmount)}
                      <div class="text-[10px] font-normal text-slate-400">/${lead.frequency || 'one-off'}</div>
                    </td>

                    <td class="py-3 px-4 text-right font-bold text-emerald-700">
                      ${Number(lead.receivedAmount) > 0 ? this.formatCurrency(lead.receivedAmount) : '-'}
                    </td>

                    <td class="py-3 px-4">
                      ${lead.nextFollowUp ? `
                        <span class="text-xs font-medium px-2 py-0.5 rounded ${isOverdue ? 'badge-overdue' : 'text-slate-600 bg-slate-100'}">
                          ${this.formatDate(lead.nextFollowUp)}
                        </span>
                      ` : '<span class="text-xs text-slate-400">Not set</span>'}
                    </td>

                    <td class="py-3 px-4 text-xs text-slate-600">
                      ${lead.assignedTo || 'Unassigned'}
                    </td>

                    <td class="py-3 px-4 text-center" onclick="event.stopPropagation()">
                      <div class="flex items-center justify-center space-x-1.5">
                        <button onclick="app.openLeadDetails('${lead.id}')" title="View & Edit" class="p-1.5 text-slate-500 hover:text-amber-600 rounded hover:bg-slate-100">
                          <i class="far fa-eye"></i>
                        </button>
                        <button onclick="app.openLeadModal('${lead.id}')" title="Edit Form" class="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-slate-100">
                          <i class="far fa-edit"></i>
                        </button>
                        ${this.userRole === 'admin' ? `
                          <button onclick="app.confirmDeleteLead('${lead.id}')" title="Delete (Admin Only)" class="admin-only p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition">
                            <i class="far fa-trash-alt"></i>
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ===================== CAMPAIGNS VIEW =====================
  renderCampaignsView() {
    const container = document.getElementById('main-view-container');

    let html = `
      <div class="space-y-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div>
            <h2 class="text-base sm:text-lg font-bold text-slate-900 leading-tight">Mission Campaigns & Funds</h2>
            <p class="text-xs text-slate-500">Track target vs raised pledges for each strategic mission priority.</p>
          </div>
          ${this.userRole === 'admin' ? `
            <button onclick="app.openCampaignModal()" class="admin-only cfm-btn-primary text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-sm flex items-center gap-2 transition w-fit">
              <i class="fas fa-plus"></i> New Mission Campaign (Admin)
            </button>
          ` : `
            <span class="text-xs text-slate-400 italic bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              <i class="fas fa-lock text-[10px] mr-1"></i> Campaign creation managed by Administrator
            </span>
          `}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
    `;

    if (this.campaigns.length === 0) {
      html += `
        <div class="col-span-full p-12 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-200">
          <i class="fas fa-bullseye text-4xl mb-3 text-slate-300"></i>
          <h4 class="font-bold text-slate-700 text-sm mb-1">No Active Mission Campaigns</h4>
          <p class="text-xs text-slate-500 mb-4 max-w-md mx-auto">Create your first fundraising campaign fund to begin linking leads, tracking pledges, and measuring milestones.</p>
          ${this.userRole === 'admin' ? `
            <button onclick="app.openCampaignModal()" class="px-4 py-2 bg-indigo-900 hover:bg-indigo-950 text-white font-bold rounded-lg text-xs shadow-sm inline-flex items-center gap-2 transition cursor-pointer">
              <i class="fas fa-plus text-amber-400"></i> Create First Campaign Fund
            </button>
          ` : ''}
        </div>
      `;
    } else {
      this.campaigns.forEach(camp => {
      // Calculate live stats strictly dynamically from real leads linked to this campaign
      const linkedLeads = this.leads.filter(l => l.campaignId === camp.id);
      const leadsTarget = linkedLeads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);
      const totalRaised = linkedLeads.reduce((sum, l) => {
        const rec = Number(l.receivedAmount) || 0;
        if (rec > 0) return sum + rec;
        if (this.normalizeStage(l.stage) === 'committed') return sum + (Number(l.expectedAmount) || 0);
        return sum;
      }, 0);
      const target = Number(camp.target) || 1;
      const pct = Math.min(100, Math.round((totalRaised / target) * 100));

      html += `
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
          <div class="flex items-start justify-between mb-2">
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
              ${camp.code || 'FUND'}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-500">${linkedLeads.length} Leads</span>
              ${this.userRole === 'admin' ? `
                <div class="flex items-center space-x-1 pl-1.5 border-l border-slate-200">
                  <button type="button" onclick="app.openCampaignModal('${camp.id}')" title="Edit Campaign" class="px-2 py-0.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded transition flex items-center gap-1 shadow-xs">
                    <i class="fas fa-pen-to-square text-[10px]"></i>
                    <span>Edit</span>
                  </button>
                  <button type="button" onclick="app.confirmDeleteCampaign('${camp.id}')" title="Delete Campaign" class="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 border border-transparent hover:border-rose-200 transition">
                    <i class="far fa-trash-alt text-xs"></i>
                  </button>
                </div>
              ` : ''}
            </div>
          </div>

          <h3 class="font-bold text-base text-slate-900 mb-1 leading-snug">${this.escapeHtml(camp.name)}</h3>
          <p class="text-xs text-slate-500 line-clamp-2 mb-4">${this.escapeHtml(camp.description || '')}</p>

          <!-- Progress Bar -->
          <div class="space-y-1 mb-4">
            <div class="flex justify-between text-xs font-semibold">
              <span class="text-emerald-700 font-bold">${this.formatCurrency(totalRaised)} raised</span>
              <span class="text-slate-500">Goal: ${this.formatCurrency(target)}</span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div class="bg-emerald-600 h-2.5 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
            </div>
            <div class="text-right text-[11px] text-slate-400 font-medium">${pct}% achieved</div>
          </div>

          <!-- Bottom Footer Details -->
          <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span class="text-slate-500">Pipeline in Progress:</span>
            <span class="font-bold text-slate-800">${this.formatCurrency(Math.max(0, leadsTarget - totalRaised))}</span>
          </div>

          <button onclick="app.filterByCampaign('${camp.id}')" class="mt-4 w-full py-2 bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 font-semibold text-xs rounded-lg border border-slate-200 transition text-center block">
            View All Leads in this Campaign <i class="fas fa-arrow-right ml-1"></i>
          </button>
        </div>
      `;
    });
    }

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  filterByCampaign(campId) {
    this.campaignFilter = campId;
    const filterSelect = document.getElementById('filter-campaign');
    if (filterSelect) filterSelect.value = campId;
    this.switchView('kanban');
  }

  // ===================== RAPID 5-LEVEL NETWORK SCALING =====================
  setNetworkModel(model) {
    this.networkModel = model;
    this.renderNetworkScalingView();
  }

  setNetworkActivation(pct) {
    this.networkActivationPct = Number(pct);
    this.renderNetworkScalingView();
  }

  setNetworkContribution(amount) {
    const val = Number(amount);
    if (!isNaN(val) && val > 0) {
      this.networkContribution = val;
      this.renderNetworkScalingView();
    }
  }

  formatINR(amount, compact = false) {
    const num = Number(amount) || 0;
    if (compact) {
      if (num >= 10000000) {
        const cr = (num / 10000000).toFixed(num % 10000000 === 0 ? 0 : 2);
        return `₹${cr} Cr`;
      } else if (num >= 100000) {
        const lakh = (num / 100000).toFixed(num % 100000 === 0 ? 0 : 2);
        return `₹${lakh} Lakh`;
      }
    }
    try {
      return '₹' + num.toLocaleString('en-IN');
    } catch (e) {
      return '₹' + num.toLocaleString();
    }
  }

  // ===================== LEADER LINEAGE & LEVEL QUOTA TRACKING =====================
  getStageRoleLabel(stageId) {
    const stages = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES : [];
    const stageObj = stages.find(s => s.id === stageId);
    return stageObj ? `Stage ${stageObj.stageNumber}: ${stageObj.role}` : (stageId || 'Donor');
  }

  getLeaderLevelInfo(leadId) {
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead) return null;

    const parentLead = lead.parentLeadId ? this.leads.find(l => l.id === lead.parentLeadId) : null;
    const directRecruits = this.leads.filter(l => l.parentLeadId === lead.id);

    // Recursive downline computation
    const getDescendants = (id) => {
      const children = this.leads.filter(l => l.parentLeadId === id);
      let desc = [...children];
      for (const child of children) {
        desc = desc.concat(getDescendants(child.id));
      }
      return desc;
    };
    const allDescendants = getDescendants(lead.id);

    const stages = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES : [];
    const stageObj = stages.find(s => s.id === lead.networkTier);
    const stageNumber = stageObj ? stageObj.stageNumber : 1;
    const roleTitle = stageObj ? stageObj.role : (lead.networkTier || 'Partner');

    // Quota goal for each leader in the 10x viral multiplying model is 10 recruits
    const targetQuota = 10;
    const recruitCount = directRecruits.length;
    const isReached = recruitCount >= targetQuota;
    const percentage = Math.min(100, Math.round((recruitCount / targetQuota) * 100));
    const remainingNeeded = Math.max(0, targetQuota - recruitCount);

    let statusKey = 'pending';
    let statusLabel = '';
    let statusBadgeClass = '';

    if (isReached) {
      statusKey = 'reached';
      statusLabel = `★ Level ${stageNumber} Reached (${recruitCount}/${targetQuota}) ✓`;
      statusBadgeClass = 'badge-level-achieved badge-level-pulse font-bold';
    } else if (recruitCount > 0) {
      statusKey = 'progress';
      statusLabel = `Level ${stageNumber} In Progress: ${recruitCount}/${targetQuota} (${remainingNeeded} needed)`;
      statusBadgeClass = 'badge-level-progress font-semibold';
    } else {
      statusKey = 'pending';
      statusLabel = `Level ${stageNumber} Not Started: 0/${targetQuota} (${targetQuota} needed)`;
      statusBadgeClass = 'badge-level-pending text-slate-500';
    }

    const totalMobilized = (lead.receivedAmount || 0) + allDescendants.reduce((sum, d) => sum + (d.receivedAmount || 0), 0);
    const totalPledged = (lead.expectedAmount || 0) + allDescendants.reduce((sum, d) => sum + (d.expectedAmount || 0), 0);

    return {
      lead,
      parentLead,
      directRecruits,
      allDescendants,
      totalTeamSize: allDescendants.length,
      stageObj,
      stageNumber,
      roleTitle,
      targetQuota,
      recruitCount,
      isReached,
      percentage,
      remainingNeeded,
      statusKey,
      statusLabel,
      statusBadgeClass,
      totalMobilized,
      totalPledged
    };
  }

  toggleLineageNode(leadId) {
    if (this.expandedLineageNodes.has(leadId)) {
      this.expandedLineageNodes.delete(leadId);
    } else {
      this.expandedLineageNodes.add(leadId);
    }
    this.renderNetworkScalingView();
  }

  expandAllLineageNodes() {
    this.leads.forEach(l => {
      if (this.leads.some(child => child.parentLeadId === l.id)) {
        this.expandedLineageNodes.add(l.id);
      }
    });
    this.renderNetworkScalingView();
  }

  collapseAllLineageNodes() {
    this.expandedLineageNodes.clear();
    this.renderNetworkScalingView();
  }

  setLineageViewMode(mode) {
    this.lineageViewMode = mode;
    this.renderNetworkScalingView();
  }

  setLineageStageFilter(stage) {
    this.lineageStageFilter = stage;
    this.renderNetworkScalingView();
  }

  setLineageStatusFilter(status) {
    this.lineageStatusFilter = status;
    this.renderNetworkScalingView();
  }

  setLineageSearch(term) {
    this.lineageSearchTerm = (term || '').trim().toLowerCase();
    this.renderNetworkScalingView();
  }

  populateParentLeaderDropdown(currentLeadId = null, selectedParentId = null) {
    const parentSelect = document.getElementById('modal-lead-parent');
    if (!parentSelect) return;

    // Filter leads that are active network leaders and NOT the current lead (to avoid circular parent reference)
    const candidates = this.leads.filter(l => {
      if (currentLeadId && l.id === currentLeadId) return false;
      return Boolean(l.networkTier);
    });

    // Sort by stageNumber, then name
    const stages = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES : [];
    candidates.sort((a, b) => {
      const sA = stages.find(s => s.id === a.networkTier)?.stageNumber || 99;
      const sB = stages.find(s => s.id === b.networkTier)?.stageNumber || 99;
      if (sA !== sB) return sA - sB;
      return (a.name || '').localeCompare(b.name || '');
    });

    let optionsHtml = '<option value="">None (Root Core Leader)</option>';
    candidates.forEach(cand => {
      const stageLabel = this.getStageRoleLabel(cand.networkTier);
      const isSelected = selectedParentId && selectedParentId === cand.id;
      optionsHtml += `
        <option value="${cand.id}" ${isSelected ? 'selected' : ''}>
          ${this.escapeHtml(cand.name)} (${stageLabel}) ${cand.organization ? `• ${this.escapeHtml(cand.organization)}` : ''}
        </option>
      `;
    });

    parentSelect.innerHTML = optionsHtml;
    if (selectedParentId) {
      parentSelect.value = selectedParentId;
    }
  }

  addNewRecruitUnderLeader(parentLeadId) {
    this.openLeadModal(null, parentLeadId);
  }

  handleTierChangeInForm(tierValue) {
    const parentSelect = document.getElementById('modal-lead-parent');
    if (!parentSelect) return;

    if (tierValue === 'stage-1') {
      parentSelect.value = '';
    } else if (tierValue === 'stage-2') {
      const stage1Leader = this.leads.find(l => l.networkTier === 'stage-1');
      if (stage1Leader && !parentSelect.value) {
        parentSelect.value = stage1Leader.id;
      }
    } else if (tierValue === 'stage-3') {
      const stage2Leader = this.leads.find(l => l.networkTier === 'stage-2');
      if (stage2Leader && !parentSelect.value) {
        parentSelect.value = stage2Leader.id;
      }
    } else if (tierValue === 'stage-4') {
      const stage3Leader = this.leads.find(l => l.networkTier === 'stage-3');
      if (stage3Leader && !parentSelect.value) {
        parentSelect.value = stage3Leader.id;
      }
    } else if (tierValue === 'stage-5') {
      const stage4Leader = this.leads.find(l => l.networkTier === 'stage-4');
      if (stage4Leader && !parentSelect.value) {
        parentSelect.value = stage4Leader.id;
      }
    }
  }

  renderLineageTreeNode(leadId, depth = 0) {
    const info = this.getLeaderLevelInfo(leadId);
    if (!info) return '';

    const lead = info.lead;
    const directRecruits = info.directRecruits;
    const isExpanded = this.expandedLineageNodes.has(lead.id);
    const hasChildren = directRecruits.length > 0;
    const stageColor = info.stageObj ? info.stageObj.color : 'amber';

    const cardClass = info.stageNumber === 1 ? 'lineage-card-root bg-amber-50/20'
                    : info.stageNumber === 2 ? 'lineage-card-champion bg-blue-50/20'
                    : info.stageNumber === 3 ? 'lineage-card-distributor bg-purple-50/20'
                    : info.stageNumber === 4 ? 'lineage-card-ambassador bg-indigo-50/20'
                    : 'lineage-card-supporter bg-emerald-50/20';

    const firstName = (lead.name || 'Leader').split(' ')[0];

    return `
      <div class="lineage-branch mb-3.5">
        <!-- Node Card -->
        <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition ${cardClass}">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            
            <!-- Left Info -->
            <div class="space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-${stageColor}-100 text-${stageColor}-800 border border-${stageColor}-200">
                  Stage ${info.stageNumber}: ${info.roleTitle}
                </span>

                ${info.parentLead ? `
                  <span class="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                    <i class="fas fa-level-up-alt rotate-90 text-amber-500"></i>
                    Recruited Under:
                    <strong onclick="app.openLeadDetails('${info.parentLead.id}')" class="text-slate-800 hover:text-amber-600 cursor-pointer underline">
                      ${this.escapeHtml(info.parentLead.name)}
                    </strong>
                    <span class="text-[10px] text-slate-400">(${this.getStageRoleLabel(info.parentLead.networkTier)})</span>
                  </span>
                ` : `
                  <span class="text-[11px] text-amber-800 font-bold flex items-center gap-1 bg-amber-100/60 px-2 py-0.5 rounded border border-amber-300">
                    <i class="fas fa-crown text-amber-500 text-[10px]"></i> Root Core Leader
                  </span>
                `}
              </div>

              <!-- Name & Org -->
              <div class="flex items-baseline gap-2 pt-0.5">
                <h4 onclick="app.openLeadDetails('${lead.id}')" class="font-extrabold text-slate-900 text-sm hover:text-amber-600 cursor-pointer">
                  ${this.escapeHtml(lead.name)}
                </h4>
                ${lead.organization ? `
                  <span class="text-xs text-slate-500 font-normal">
                    ${this.escapeHtml(lead.organization)}
                  </span>
                ` : ''}
              </div>

              <!-- Location & Contact -->
              <div class="text-[11px] text-slate-400 flex items-center gap-3">
                ${[lead.city, lead.country].filter(Boolean).length > 0 ? `
                  <span><i class="fas fa-map-marker-alt text-[10px] mr-1"></i>${[lead.city, lead.country].filter(Boolean).join(', ')}</span>
                ` : ''}
                ${lead.assignedTo ? `
                  <span><i class="fas fa-user-shield text-[10px] mr-1"></i>Staff: ${this.escapeHtml(lead.assignedTo)}</span>
                ` : ''}
              </div>
            </div>

            <!-- Right: Level Quota Badge & Progress -->
            <div class="sm:text-right w-full sm:w-auto sm:min-w-[200px] shrink-0 space-y-1.5">
              <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs ${info.statusBadgeClass}">
                <i class="fas ${info.isReached ? 'fa-check-circle text-emerald-600' : info.recruitCount > 0 ? 'fa-chart-line text-amber-600' : 'fa-clock text-slate-400'}"></i>
                <span>${info.statusLabel}</span>
              </div>

              <!-- Visual Progress Bar -->
              <div class="space-y-0.5">
                <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div class="h-2 rounded-full transition-all duration-500 ${info.isReached ? 'bg-emerald-500' : info.recruitCount > 0 ? 'bg-amber-500' : 'bg-slate-300'}"
                       style="width: ${info.percentage}%"></div>
                </div>
                <div class="flex justify-between text-[10px] text-slate-500 font-medium">
                  <span>Quota: <strong>${info.recruitCount} / 10 Recruits</strong></span>
                  <span>Team Size: <strong>${info.totalTeamSize} members</strong></span>
                </div>
              </div>
            </div>

          </div>

          <!-- Footer Bar with Metrics and Actions -->
          <div class="mt-3 pt-3 border-t border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3 text-xs">
            <!-- Downline Mobilization Summary -->
            <div class="flex items-center gap-3 sm:gap-4 flex-wrap text-[11px] text-slate-600">
              <span class="whitespace-nowrap">Direct Downline: <strong class="text-slate-900">${info.recruitCount}</strong></span>
              <span class="whitespace-nowrap">Total Network: <strong class="text-amber-700">${info.totalTeamSize}</strong></span>
              <span class="whitespace-nowrap">Funds Mobilized: <strong class="text-emerald-700">${this.formatCurrency(info.totalMobilized)}</strong></span>
            </div>

            <!-- Action Buttons -->
            <div class="flex items-center gap-2 flex-wrap w-full xl:w-auto justify-start xl:justify-end">
              ${hasChildren ? `
                <button onclick="app.toggleLineageNode('${lead.id}')" 
                        class="px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0 whitespace-nowrap ${isExpanded ? 'bg-slate-200 text-slate-800 hover:bg-slate-300' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}">
                  <i class="fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} text-[10px]"></i>
                  <span>${isExpanded ? 'Hide' : 'Show'} Downline (${directRecruits.length})</span>
                </button>
              ` : `
                <span class="text-[11px] text-slate-400 italic px-2 shrink-0">No downline recruits</span>
              `}

              <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" 
                      title="Add Recruit Under ${this.escapeHtml(firstName)}"
                      class="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition flex items-center gap-1 shadow-sm shrink-0 whitespace-nowrap">
                <i class="fas fa-plus text-[10px]"></i> Add Recruit
              </button>

              <button onclick="app.openLeadDetails('${lead.id}')" 
                      class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs transition shrink-0 whitespace-nowrap">
                Profile
              </button>
            </div>
          </div>
        </div>

        <!-- Indented Children (if expanded) -->
        ${hasChildren && isExpanded ? `
          <div class="lineage-children relative mt-2">
            <div class="lineage-branch-connector"></div>
            ${directRecruits.map(child => `
              <div class="lineage-child-node">
                ${this.renderLineageTreeNode(child.id, depth + 1)}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  renderLineageTreeHTML() {
    const hasFilter = this.lineageStageFilter !== 'all' || this.lineageStatusFilter !== 'all' || (this.lineageSearchTerm && this.lineageSearchTerm.length > 0);

    if (!hasFilter) {
      const rootLeaders = this.leads.filter(l => !l.parentLeadId && Boolean(l.networkTier));
      if (rootLeaders.length === 0) {
        return `
          <div class="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
            <i class="fas fa-users text-3xl mb-2 text-slate-300"></i>
            <p class="text-sm font-semibold">No root network leaders found in database.</p>
          </div>
        `;
      }
      return `
        <div class="lineage-tree-wrapper">
          ${rootLeaders.map(root => this.renderLineageTreeNode(root.id)).join('')}
        </div>
      `;
    }

    // Filtered tree view
    let matchingLeads = this.leads.filter(l => Boolean(l.networkTier));

    if (this.lineageStageFilter !== 'all') {
      matchingLeads = matchingLeads.filter(l => l.networkTier === this.lineageStageFilter);
    }

    if (this.lineageStatusFilter !== 'all') {
      matchingLeads = matchingLeads.filter(l => {
        const info = this.getLeaderLevelInfo(l.id);
        return info && info.statusKey === this.lineageStatusFilter;
      });
    }

    if (this.lineageSearchTerm) {
      matchingLeads = matchingLeads.filter(l => {
        const term = this.lineageSearchTerm;
        return (l.name || '').toLowerCase().includes(term) ||
               (l.organization || '').toLowerCase().includes(term) ||
               (l.city || '').toLowerCase().includes(term);
      });
    }

    if (matchingLeads.length === 0) {
      return `
        <div class="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
          <i class="fas fa-search text-3xl mb-2 text-slate-300"></i>
          <p class="text-sm font-semibold">No leaders match your current filter and search criteria.</p>
        </div>
      `;
    }

    return `
      <div class="lineage-tree-wrapper">
        <div class="mb-3 text-xs text-slate-500 font-medium flex items-center justify-between">
          <span>Showing <strong>${matchingLeads.length}</strong> matching leaders with full lineage context:</span>
        </div>
        ${matchingLeads.map(lead => this.renderLineageTreeNode(lead.id)).join('')}
      </div>
    `;
  }

  renderLineageTableHTML(networkLeads) {
    if (networkLeads.length === 0) {
      return `
        <div class="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400">
          <i class="fas fa-search text-3xl mb-2 text-slate-300"></i>
          <p class="text-sm font-semibold">No leaders match your current filter and search criteria.</p>
        </div>
      `;
    }

    return `
      <div class="overflow-x-auto">
        <table class="w-full min-w-[860px] text-left border-collapse text-xs">
          <thead>
            <tr class="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
              <th class="py-3 px-4 whitespace-nowrap">Leader / Organization</th>
              <th class="py-3 px-4 whitespace-nowrap">Stage & Role</th>
              <th class="py-3 px-4 whitespace-nowrap">Recruited Under (Upline Mentor)</th>
              <th class="py-3 px-4 text-center whitespace-nowrap">Level Quota Progress</th>
              <th class="py-3 px-4 text-center whitespace-nowrap">Level Status</th>
              <th class="py-3 px-4 text-right whitespace-nowrap">Downline Team</th>
              <th class="py-3 px-4 text-right whitespace-nowrap">Mobilized Funds</th>
              <th class="py-3 px-4 text-center whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${networkLeads.map(lead => {
              const info = this.getLeaderLevelInfo(lead.id);
              if (!info) return '';
              const parent = info.parentLead;

              return `
                <tr class="hover:bg-amber-50/40 transition cursor-pointer" onclick="app.openLeadDetails('${lead.id}')">
                  <!-- Name & Org -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <div class="font-extrabold text-slate-900 text-sm hover:text-amber-600">${this.escapeHtml(lead.name)}</div>
                    ${lead.organization ? `<div class="text-[11px] text-slate-500">${this.escapeHtml(lead.organization)}</div>` : ''}
                  </td>

                  <!-- Stage & Role -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <span class="text-[11px] px-2 py-0.5 rounded-full font-bold bg-${info.stageObj ? info.stageObj.color : 'slate'}-100 text-${info.stageObj ? info.stageObj.color : 'slate'}-800 border border-${info.stageObj ? info.stageObj.color : 'slate'}-200">
                      Stage ${info.stageNumber}: ${info.roleTitle}
                    </span>
                  </td>

                  <!-- Recruited Under -->
                  <td class="py-3 px-4 whitespace-nowrap" onclick="event.stopPropagation()">
                    ${parent ? `
                      <div onclick="app.openLeadDetails('${parent.id}')" class="text-amber-800 hover:text-amber-900 font-bold hover:underline flex items-center gap-1 cursor-pointer">
                        <i class="fas fa-level-up-alt rotate-90 text-amber-500"></i>
                        <span>${this.escapeHtml(parent.name)}</span>
                      </div>
                      <div class="text-[10px] text-slate-400">${this.getStageRoleLabel(parent.networkTier)}</div>
                    ` : `
                      <span class="text-amber-900 font-extrabold flex items-center gap-1 text-[11px]">
                        <i class="fas fa-crown text-amber-500 text-[10px]"></i> Root Core Leader
                      </span>
                    `}
                  </td>

                  <!-- Level Quota Progress Bar -->
                  <td class="py-3 px-4 text-center whitespace-nowrap">
                    <div class="inline-flex flex-col items-center gap-1 min-w-[130px]">
                      <div class="flex items-center justify-between w-full text-[11px]">
                        <span class="font-bold text-slate-700">${info.recruitCount} / 10</span>
                        <span class="font-extrabold ${info.isReached ? 'text-emerald-700' : 'text-amber-700'}">${info.percentage}%</span>
                      </div>
                      <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div class="h-2 rounded-full ${info.isReached ? 'bg-emerald-500' : info.recruitCount > 0 ? 'bg-amber-500' : 'bg-slate-300'}"
                             style="width: ${info.percentage}%"></div>
                      </div>
                    </div>
                  </td>

                  <!-- Level Status Badge -->
                  <td class="py-3 px-4 text-center whitespace-nowrap">
                    <span class="px-2.5 py-1 rounded-full text-[11px] ${info.statusBadgeClass}">
                      ${info.statusLabel}
                    </span>
                  </td>

                  <!-- Downline Team Size -->
                  <td class="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                    ${info.totalTeamSize} <span class="text-[10px] font-normal text-slate-400">members</span>
                  </td>

                  <!-- Mobilized Funds -->
                  <td class="py-3 px-4 text-right font-black text-emerald-700 whitespace-nowrap">
                    ${this.formatCurrency(info.totalMobilized)}
                  </td>

                  <!-- Actions -->
                  <td class="py-3 px-4 text-center whitespace-nowrap" onclick="event.stopPropagation()">
                    <div class="flex items-center justify-center gap-1">
                      <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" title="Add Recruit Under Leader" class="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold shadow-xs whitespace-nowrap">
                        + Recruit
                      </button>
                      <button onclick="app.openLeadDetails('${lead.id}')" title="View Profile" class="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100">
                        <i class="far fa-eye"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderNetworkScalingView() {
    const container = document.getElementById('main-view-container');
    if (!container) return;

    const stages = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES : [];
    const isModelA = this.networkModel === 'A';
    const contribution = this.networkContribution || 1000;
    const factor = (this.networkActivationPct || 100) / 100;

    // Lineage statistics
    const networkLeads = this.leads.filter(l => Boolean(l.networkTier));
    const reachedCount = networkLeads.filter(l => this.getLeaderLevelInfo(l.id)?.isReached).length;
    const progressCount = networkLeads.filter(l => { const i = this.getLeaderLevelInfo(l.id); return i && !i.isReached && i.recruitCount > 0; }).length;
    const pendingCount = networkLeads.filter(l => { const i = this.getLeaderLevelInfo(l.id); return i && i.recruitCount === 0; }).length;

    let filteredNetworkLeads = [...networkLeads];
    if (this.lineageStageFilter !== 'all') {
      filteredNetworkLeads = filteredNetworkLeads.filter(l => l.networkTier === this.lineageStageFilter);
    }
    if (this.lineageStatusFilter !== 'all') {
      filteredNetworkLeads = filteredNetworkLeads.filter(l => {
        const info = this.getLeaderLevelInfo(l.id);
        return info && info.statusKey === this.lineageStatusFilter;
      });
    }
    if (this.lineageSearchTerm) {
      filteredNetworkLeads = filteredNetworkLeads.filter(l => {
        const term = this.lineageSearchTerm;
        return (l.name || '').toLowerCase().includes(term) ||
               (l.organization || '').toLowerCase().includes(term) ||
               (l.city || '').toLowerCase().includes(term);
      });
    }
    filteredNetworkLeads.sort((a, b) => {
      const infoA = this.getLeaderLevelInfo(a.id);
      const infoB = this.getLeaderLevelInfo(b.id);
      if (infoA.stageNumber !== infoB.stageNumber) return infoA.stageNumber - infoB.stageNumber;
      if (infoA.isReached !== infoB.isReached) return infoB.isReached ? 1 : -1;
      return infoB.recruitCount - infoA.recruitCount;
    });

    // Milestone calculations
    const maxMilestoneMembers = 100000;
    const activeScaledMembers = Math.round(maxMilestoneMembers * factor);
    const modelAGross = Math.round(activeScaledMembers * contribution);
    const modelBMonthlyGross = Math.round(activeScaledMembers * contribution);
    const modelBAnnualizedGross = Math.round(modelBMonthlyGross * 12);

    // Mapped leads in CRM by network tier
    const mappedTierCounts = {};
    const mappedLeadsByTier = {};
    stages.forEach(s => {
      mappedTierCounts[s.id] = 0;
      mappedLeadsByTier[s.id] = [];
    });

    this.leads.forEach(l => {
      if (l.networkTier && mappedTierCounts[l.networkTier] !== undefined) {
        mappedTierCounts[l.networkTier]++;
        mappedLeadsByTier[l.networkTier].push(l);
      }
    });

    const totalMappedInCRM = Object.values(mappedTierCounts).reduce((a, b) => a + b, 0);

    let html = `
      <div class="space-y-6">
        <!-- Top Banner with Model Switcher & Headline -->
        <div class="bg-gradient-to-r from-slate-900 via-cfm-navy to-indigo-950 text-white p-4 sm:p-7 rounded-2xl shadow-xl border border-white/10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 sm:gap-5">
          <div class="space-y-1.5 sm:space-y-2 max-w-3xl">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase bg-amber-500 text-slate-950">
                Strategic Scaling Blueprint
              </span>
              <span class="text-xs text-amber-300 font-semibold flex items-center gap-1">
                <i class="fas fa-network-wired"></i> 10x Viral Mechanism
              </span>
            </div>
            <h2 class="text-xl sm:text-3xl font-extrabold font-serif-title tracking-tight text-white">
              Rapid 5-Level Network Scaling Portal
            </h2>
            <p class="text-xs text-slate-300 leading-relaxed">
              Exponential growth strategy: each leader engages <strong>10 committed members</strong> toward the <strong>1,00,000 unique member milestone</strong>. 
              Supports <strong>Model A</strong> (One-time ₹1,000) and <strong>Model B</strong> (Monthly ₹1,000 / Annualized ₹12,000) with analytical reconciliation.
            </p>
          </div>

          <!-- Model Switcher CTA & CSV Export -->
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
            <!-- Model Switcher Pills (50/50 split on mobile) -->
            <div class="bg-slate-800/90 p-1 rounded-xl border border-slate-700 flex items-center shadow-inner w-full sm:w-auto">
              <button onclick="app.setNetworkModel('A')" class="flex-1 sm:flex-initial px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${isModelA ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-300 hover:text-white'}">
                <i class="fas fa-hand-holding-usd text-xs"></i>
                <span>Model A (One-Time)</span>
              </button>
              <button onclick="app.setNetworkModel('B')" class="flex-1 sm:flex-initial px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${!isModelA ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-300 hover:text-white'}">
                <i class="fas fa-redo-alt text-xs"></i>
                <span>Model B (Monthly)</span>
              </button>
            </div>

            <!-- Export Button -->
            <button onclick="app.exportNetworkCSV()" class="bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center justify-center gap-2 transition shadow-sm">
              <i class="fas fa-file-csv text-emerald-400"></i>
              <span>Export Model</span>
            </button>
          </div>
        </div>

        <!-- 4 Key Stat Metric Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <!-- Total Member Cap -->
          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">Unique Member Target</div>
            <div class="text-2xl sm:text-3xl font-black text-slate-900 mt-1.5 leading-tight">1,00,000</div>
            <div class="text-[11px] text-slate-500 mt-2 flex items-center justify-between pt-1 border-t border-slate-100">
              <span>Capped milestone</span>
              <span class="text-amber-700 font-bold shrink-0">5 Stages</span>
            </div>
          </div>

          <!-- Active CRM Mapped -->
          <div class="bg-white p-4 rounded-xl border border-blue-200 shadow-sm flex flex-col justify-between bg-blue-50/20">
            <div class="text-[11px] font-bold text-blue-800 uppercase tracking-wider truncate">Enrolled in CRM</div>
            <div class="text-2xl sm:text-3xl font-black text-blue-900 mt-1.5 leading-tight">
              ${totalMappedInCRM} <span class="text-xs font-normal text-slate-500">leads</span>
            </div>
            <div class="text-[11px] text-blue-700 mt-2 flex items-center gap-1 pt-1 border-t border-blue-100/60 truncate">
              <i class="fas fa-user-check shrink-0"></i> <span>Assigned in database</span>
            </div>
          </div>

          <!-- Selected Model Gross / Monthly -->
          <div class="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-between bg-emerald-50/20">
            <div class="text-[11px] font-bold text-emerald-800 uppercase tracking-wider truncate" title="${isModelA ? 'Model A Gross Collections' : 'Model B Monthly Run-Rate'}">
              ${isModelA ? 'Model A Gross Total' : 'Model B Monthly Run-Rate'}
            </div>
            <div class="text-2xl sm:text-3xl font-black text-emerald-700 mt-1.5 leading-tight truncate" title="${this.formatINR(isModelA ? modelAGross : modelBMonthlyGross)}">
              ${this.formatINR(isModelA ? modelAGross : modelBMonthlyGross, true)}
            </div>
            <div class="text-[11px] text-emerald-700 mt-2 flex items-center gap-1 font-semibold pt-1 border-t border-emerald-100/60 truncate">
              <i class="fas fa-coins text-emerald-600 shrink-0"></i> 
              <span class="truncate">${isModelA ? '₹10 Cr one-off gross' : '₹10 Cr / month gross'}</span>
            </div>
          </div>

          <!-- Annualized Run Rate (Model B) or Contribution Basis -->
          <div class="bg-white p-4 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-between bg-amber-50/20">
            <div class="text-[11px] font-bold text-amber-900 uppercase tracking-wider truncate" title="${isModelA ? 'Per Member Contribution' : 'Model B Annualized Run-Rate'}">
              ${isModelA ? 'Per Member Contribution' : 'Model B Annualized'}
            </div>
            <div class="text-2xl sm:text-3xl font-black text-amber-900 mt-1.5 leading-tight truncate" title="${isModelA ? this.formatINR(contribution) : this.formatINR(modelBAnnualizedGross)}">
              ${isModelA ? this.formatINR(contribution) : this.formatINR(modelBAnnualizedGross, true)}
            </div>
            <div class="text-[11px] text-amber-800 mt-2 flex items-center gap-1 font-semibold pt-1 border-t border-amber-100/60 truncate">
              <i class="fas fa-calendar-alt text-amber-600 shrink-0"></i> 
              <span class="truncate">${isModelA ? 'One-time per member' : '₹120 Cr / year (12-mo)'}</span>
            </div>
          </div>
        </div>

        <!-- Interactive Simulation Controller Bar -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div class="space-y-0.5">
            <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
              <i class="fas fa-sliders-h text-amber-600"></i> Growth Activation Simulator:
              <span class="text-amber-700 font-black">${this.networkActivationPct}% Target Reach</span>
              <span class="text-slate-400 font-normal">(${activeScaledMembers.toLocaleString('en-IN')} Members)</span>
            </span>
            <p class="text-[11px] text-slate-500">Test progressive scaling projections before 100% capacity is reached.</p>
          </div>

          <div class="flex items-center gap-2 sm:gap-3 w-full md:w-auto flex-wrap sm:flex-nowrap">
            <input type="range" min="10" max="100" step="5" value="${this.networkActivationPct}" 
                   oninput="app.setNetworkActivation(this.value)"
                   class="w-full md:w-56 accent-amber-600 cursor-pointer">
            <div class="flex gap-1.5 shrink-0">
              <button onclick="app.setNetworkActivation(25)" class="px-2 py-1 text-[11px] font-bold rounded border ${this.networkActivationPct === 25 ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}">25%</button>
              <button onclick="app.setNetworkActivation(50)" class="px-2 py-1 text-[11px] font-bold rounded border ${this.networkActivationPct === 50 ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}">50%</button>
              <button onclick="app.setNetworkActivation(100)" class="px-2 py-1 text-[11px] font-bold rounded border ${this.networkActivationPct === 100 ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}">100%</button>
            </div>
          </div>
        </div>

        <!-- 5-STAGE NETWORK CASCADE CARDS -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="font-bold text-slate-900 text-sm">Exponential 5-Stage Network Structure</h3>
              <p class="text-xs text-slate-500">Each tier engages 10 members, capped at Stage 5 to maintain 1,00,000 unique contributors.</p>
            </div>
            <span class="text-xs font-semibold text-slate-400">Progression Ratio: 10x</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
            ${stages.map((stage, idx) => {
              const scaledNewMembers = Math.round(stage.targetMembers * factor);
              const scaledCumMembers = Math.round(stage.cumulativeMembers * factor);
              const stageModelA = scaledCumMembers * contribution;
              const stageModelBMonthly = scaledCumMembers * contribution;
              const stageModelBAnnual = stageModelBMonthly * 12;

              const mappedLeads = mappedLeadsByTier[stage.id] || [];

              return `
                <div class="bg-white rounded-xl border-2 ${stage.isCapped ? 'border-emerald-300 bg-emerald-50/10' : 'border-slate-200'} p-4 shadow-sm hover:shadow-md transition flex flex-col justify-between">
                  <div>
                    <!-- Stage Badge & Multiplier -->
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-${stage.color}-100 text-${stage.color}-800 border border-${stage.color}-200">
                        Stage ${stage.stageNumber}
                      </span>
                      ${stage.isCapped ? `
                        <span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                          <i class="fas fa-flag-checkered"></i> Milestone Cap
                        </span>
                      ` : `
                        <span class="text-[10px] font-semibold text-slate-400">10x</span>
                      `}
                    </div>

                    <!-- Role Name -->
                    <h4 class="font-bold text-slate-900 text-sm leading-snug mb-1">
                      ${this.escapeHtml(stage.role)}
                    </h4>
                    <p class="text-[11px] text-slate-500 mb-3 line-clamp-2">
                      ${this.escapeHtml(stage.description)}
                    </p>

                    <!-- Member Stats Box -->
                    <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 space-y-1.5 mb-3 text-xs">
                      <div class="flex justify-between">
                        <span class="text-slate-500 text-[11px]">New Members:</span>
                        <span class="font-bold text-slate-800">${scaledNewMembers.toLocaleString('en-IN')}</span>
                      </div>
                      <div class="flex justify-between pt-1 border-t border-slate-200">
                        <span class="text-slate-700 font-semibold text-[11px]">Cumulative:</span>
                        <span class="font-black text-amber-700">${scaledCumMembers.toLocaleString('en-IN')}</span>
                      </div>
                    </div>

                    <!-- Financial Yield -->
                    <div class="space-y-1.5 text-xs pt-1">
                      <div class="flex items-center justify-between gap-1 text-[11px]">
                        <span class="text-slate-500 truncate" title="Model A (One-Time)">One-Time (A):</span>
                        <span class="font-bold text-slate-900 shrink-0">${this.formatINR(stageModelA, true)}</span>
                      </div>
                      <div class="flex items-center justify-between gap-1 text-[11px]">
                        <span class="text-slate-500 truncate" title="Model B (Monthly)">Monthly (B):</span>
                        <span class="font-bold text-emerald-700 shrink-0">${this.formatINR(stageModelBMonthly, true)}</span>
                      </div>
                      <div class="flex items-center justify-between gap-1 text-[11px] font-bold pt-1 border-t border-slate-100">
                        <span class="text-slate-700 truncate" title="Model B (Annual)">Annual (B):</span>
                        <span class="text-amber-900 shrink-0">${this.formatINR(stageModelBAnnual, true)}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Enrolled CRM Leads for this Tier -->
                  <div class="mt-4 pt-3 border-t border-slate-100">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center justify-between">
                      <span>CRM Enrolled</span>
                      <span class="text-slate-600 font-bold">${mappedLeads.length}</span>
                    </div>

                    ${mappedLeads.length === 0 ? `
                      <span class="text-[10px] text-slate-400 italic block">None assigned yet</span>
                    ` : `
                      <div class="space-y-1">
                        ${mappedLeads.slice(0, 2).map(lead => `
                          <div onclick="app.openLeadDetails('${lead.id}')" class="truncate text-[11px] font-semibold text-slate-800 hover:text-amber-600 cursor-pointer flex items-center gap-1">
                            <i class="fas fa-user-circle text-slate-400 text-[10px]"></i>
                            <span>${this.escapeHtml(lead.name)}</span>
                          </div>
                        `).join('')}
                        ${mappedLeads.length > 2 ? `
                          <span class="text-[10px] text-amber-600 font-semibold block">+${mappedLeads.length - 2} more leads</span>
                        ` : ''}
                      </div>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        <!-- ========================================================
             LEADER LINEAGE HIERARCHY & LEVEL ACHIEVEMENT TRACKER
             Visualizing Who is Under Who & Level Quota Status
             ======================================================== -->
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden space-y-4 p-5 sm:p-6">
          
          <!-- Section Title & Status Summary Cards -->
          <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-200 pb-5">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Multiplying Lineage Structure
                </span>
                <span class="text-xs text-amber-700 font-bold flex items-center gap-1">
                  <i class="fas fa-sitemap"></i> 10-Recruit Level Quota Tracking
                </span>
              </div>
              <h3 class="text-xl font-black text-slate-900 tracking-tight font-serif-title">
                Leader Lineage Hierarchy & Level Achievement Tracker
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Clearly identify <strong>which leader is under who</strong> across all 5 tiers and verify whether each leader has reached their <strong>10-member multiplying quota</strong> to complete their level.
              </p>
            </div>

            <!-- Level Milestone Summary Counter Badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <div class="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 shadow-xs">
                <i class="fas fa-check-circle text-emerald-600 text-sm shrink-0"></i>
                <div class="space-y-0.5">
                  <div class="font-extrabold leading-snug text-emerald-700">${reachedCount} Leaders</div>
                  <div class="text-[10px] text-emerald-800 leading-normal">Reached Level Quota (10/10) ✓</div>
                </div>
              </div>

              <div class="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2 shadow-xs">
                <i class="fas fa-chart-line text-amber-600 text-sm shrink-0"></i>
                <div class="space-y-0.5">
                  <div class="font-extrabold leading-snug text-amber-800">${progressCount} Leaders</div>
                  <div class="text-[10px] text-amber-700 leading-normal">In Progress (1-9 recruits)</div>
                </div>
              </div>

              <div class="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-center gap-2 shadow-xs">
                <i class="fas fa-clock text-slate-400 text-sm shrink-0"></i>
                <div class="space-y-0.5">
                  <div class="font-extrabold leading-snug text-slate-700">${pendingCount} Leaders</div>
                  <div class="text-[10px] text-slate-500 leading-normal">Not Started (0 recruits)</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Interactive Filters & View Switcher Toolbar -->
          <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
            
            <!-- Search & Filters -->
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
              <!-- Search box -->
              <div class="relative flex-1 max-w-xs">
                <i class="fas fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                <input type="text" 
                       placeholder="Find leader or church..." 
                       value="${this.escapeHtml(this.lineageSearchTerm)}"
                       oninput="app.setLineageSearch(this.value)"
                       class="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500">
              </div>

              <!-- Stage Filter -->
              <select onchange="app.setLineageStageFilter(this.value)" 
                      class="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500">
                <option value="all" ${this.lineageStageFilter === 'all' ? 'selected' : ''}>All Scaling Stages (${networkLeads.length})</option>
                <option value="stage-1" ${this.lineageStageFilter === 'stage-1' ? 'selected' : ''}>Stage 1: Core Leaders</option>
                <option value="stage-2" ${this.lineageStageFilter === 'stage-2' ? 'selected' : ''}>Stage 2: Team Champions</option>
                <option value="stage-3" ${this.lineageStageFilter === 'stage-3' ? 'selected' : ''}>Stage 3: Active Distributors</option>
                <option value="stage-4" ${this.lineageStageFilter === 'stage-4' ? 'selected' : ''}>Stage 4: Brand Ambassadors</option>
                <option value="stage-5" ${this.lineageStageFilter === 'stage-5' ? 'selected' : ''}>Stage 5: Active Supporters</option>
              </select>

              <!-- Level Status Filter -->
              <select onchange="app.setLineageStatusFilter(this.value)" 
                      class="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500">
                <option value="all" ${this.lineageStatusFilter === 'all' ? 'selected' : ''}>All Level Statuses</option>
                <option value="reached" ${this.lineageStatusFilter === 'reached' ? 'selected' : ''}>★ Level Quota Reached (10/10) ✓</option>
                <option value="progress" ${this.lineageStatusFilter === 'progress' ? 'selected' : ''}>In Progress (1-9 recruits)</option>
                <option value="pending" ${this.lineageStatusFilter === 'pending' ? 'selected' : ''}>Level Not Started (0 recruits)</option>
              </select>
            </div>

            <!-- View Switcher & Action Buttons -->
            <div class="flex items-center gap-2 self-end md:self-auto">
              <!-- Tree vs Table Toggle -->
              <div class="bg-slate-200/80 p-0.5 rounded-lg flex items-center border border-slate-300 shadow-inner">
                <button onclick="app.setLineageViewMode('tree')" 
                        class="px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${this.lineageViewMode === 'tree' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                  <i class="fas fa-sitemap text-amber-600"></i>
                  <span>Lineage Tree</span>
                </button>
                <button onclick="app.setLineageViewMode('table')" 
                        class="px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${this.lineageViewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                  <i class="fas fa-list-ol text-blue-600"></i>
                  <span>Leaderboard</span>
                </button>
              </div>

              ${this.lineageViewMode === 'tree' ? `
                <div class="flex items-center gap-1">
                  <button onclick="app.expandAllLineageNodes()" title="Expand All Branches" class="p-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-600 text-xs">
                    <i class="fas fa-expand-alt"></i>
                  </button>
                  <button onclick="app.collapseAllLineageNodes()" title="Collapse All Branches" class="p-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-600 text-xs">
                    <i class="fas fa-compress-alt"></i>
                  </button>
                </div>
              ` : ''}

              <button onclick="app.openLeadModal()" class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-sm transition flex items-center gap-1.5 text-xs">
                <i class="fas fa-user-plus"></i>
                <span>Enrol Leader</span>
              </button>
            </div>

          </div>

          <!-- Lineage Content Body (Tree or Table) -->
          <div class="pt-2">
            ${this.lineageViewMode === 'tree' ? this.renderLineageTreeHTML() : this.renderLineageTableHTML(filteredNetworkLeads)}
          </div>

        </div>

        <!-- RECONCILED PLANNING TABLE -->
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div class="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h3 class="font-bold text-slate-800 text-sm">Reconciled Five-Stage Planning Table</h3>
              <p class="text-xs text-slate-500">Capping unique members at exactly 1,00,000 without repeated milestone double-counting.</p>
            </div>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              Contribution Basis: ₹${contribution.toLocaleString('en-IN')} / member
            </span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full min-w-[900px] text-left border-collapse text-xs">
              <thead>
                <tr class="bg-slate-100/80 border-b border-slate-200 font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  <th class="py-3 px-4 whitespace-nowrap">Stage</th>
                  <th class="py-3 px-4 whitespace-nowrap">Role Title</th>
                  <th class="py-3 px-4 text-right whitespace-nowrap">Target Members</th>
                  <th class="py-3 px-4 text-right whitespace-nowrap">Cumulative Target</th>
                  <th class="py-3 px-4 text-center whitespace-nowrap">Target Met (Progress)</th>
                  <th class="py-3 px-4 text-right whitespace-nowrap">Model A One-Time Gross</th>
                  <th class="py-3 px-4 text-right whitespace-nowrap">Model B Monthly Gross</th>
                  <th class="py-3 px-4 text-right whitespace-nowrap">Model B Annualized Run-Rate</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${stages.map(s => {
                  const newM = s.targetMembers;
                  const cumM = s.cumulativeMembers;
                  const mAGross = cumM * contribution;
                  const mBMo = cumM * contribution;
                  const mBAnn = mBMo * 12;

                  const actualMembers = mappedTierCounts[s.id] || 0;
                  const pctMet = newM > 0 ? ((actualMembers / newM) * 100).toFixed(1) : '0';
                  const isMet = actualMembers >= newM;

                  return `
                    <tr class="hover:bg-amber-50/40 transition">
                      <td class="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                        Stage ${s.stageNumber} ${s.isCapped ? '<span class="text-[10px] text-emerald-600 font-normal">(Capped)</span>' : ''}
                      </td>
                      <td class="py-3 px-4 font-medium text-slate-800 whitespace-nowrap">
                        ${s.role}
                      </td>
                      <td class="py-3 px-4 text-right font-bold text-slate-900 whitespace-nowrap">
                        ${newM.toLocaleString('en-IN')}
                      </td>
                      <td class="py-3 px-4 text-right font-black text-amber-700 whitespace-nowrap">
                        ${cumM.toLocaleString('en-IN')}
                      </td>
                      <td class="py-3 px-4 text-center whitespace-nowrap">
                        <div class="inline-flex flex-col items-center gap-1">
                          <div class="flex items-center gap-1.5 whitespace-nowrap">
                            ${isMet ? `
                              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-sm">
                                <i class="fas fa-check-circle text-emerald-600"></i> Target Met (${actualMembers}/${newM.toLocaleString('en-IN')})
                              </span>
                            ` : actualMembers > 0 ? `
                              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                                <i class="fas fa-chart-line text-amber-600 text-[10px]"></i> ${pctMet}% Met (${actualMembers}/${newM.toLocaleString('en-IN')})
                              </span>
                            ` : `
                              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                                0% Met (0 / ${newM.toLocaleString('en-IN')})
                              </span>
                            `}
                          </div>
                          <div class="w-28 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div class="h-1.5 rounded-full ${isMet ? 'bg-emerald-500' : actualMembers > 0 ? 'bg-amber-500' : 'bg-slate-300'}"
                                 style="width: ${Math.min(100, Math.max(actualMembers > 0 ? 8 : 0, Number(pctMet)))}%">
                            </div>
                          </div>
                        </div>
                      </td>
                      <td class="py-3 px-4 text-right font-bold text-slate-800 whitespace-nowrap">
                        ${this.formatINR(mAGross)}
                      </td>
                      <td class="py-3 px-4 text-right font-bold text-emerald-700 whitespace-nowrap">
                        ${this.formatINR(mBMo)}
                      </td>
                      <td class="py-3 px-4 text-right font-black text-amber-900 whitespace-nowrap">
                        ${this.formatINR(mBAnn)}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
              <tfoot>
                ${(() => {
                  const totalActualMembers = Object.values(mappedTierCounts).reduce((a, b) => a + b, 0);
                  const totalTarget = 100000;
                  const totalPct = ((totalActualMembers / totalTarget) * 100).toFixed(2);
                  const isTotalMet = totalActualMembers >= totalTarget;
                  return `
                    <tr class="bg-slate-900 text-white font-bold text-xs border-t-2 border-amber-500 whitespace-nowrap">
                      <td class="py-3.5 px-4" colspan="2">TOTAL MILESTONE CAPACITY</td>
                      <td class="py-3.5 px-4 text-right">1,00,000</td>
                      <td class="py-3.5 px-4 text-right text-amber-300">1,00,000</td>
                      <td class="py-3.5 px-4 text-center">
                        <span class="px-2.5 py-1 rounded-full text-[11px] font-black ${isTotalMet ? 'bg-emerald-500 text-white' : totalActualMembers > 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}">
                          ${isTotalMet ? '✓ 100% Milestone Met' : `${totalActualMembers} / 1,00,000 (${totalPct}% Met)`}
                        </span>
                      </td>
                      <td class="py-3.5 px-4 text-right text-amber-300">₹10,00,00,000 (10 Cr)</td>
                      <td class="py-3.5 px-4 text-right text-emerald-300">₹10,00,00,000 / mo</td>
                      <td class="py-3.5 px-4 text-right text-amber-400 font-black">₹1,20,00,00,000 (120 Cr)</td>
                    </tr>
                  `;
                })()}
              </tfoot>
            </table>
          </div>
        </div>

        <!-- ANALYTICAL RECONCILIATION & SOURCE INCONSISTENCY EXPLANATION -->
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div class="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <i class="fas fa-microscope text-amber-600"></i>
            <h4>Analytical Source Reconciliation & Mathematical Insights</h4>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700">
            <!-- Point 1 & 2 -->
            <div class="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900 flex items-center gap-1.5">
                <i class="fas fa-exclamation-circle text-amber-600"></i> Resolution of 8 Rows vs. 5 Levels
              </div>
              <p class="text-slate-600 leading-relaxed text-[11px]">
                The original source infographic featured eight rows labelled as levels, but levels 4, 6, and 8 repeated the counts of preceding stages (1,000, 10,000, and 88,890). 
                To ensure financial integrity, duplicate milestone markers have been consolidated into <strong>five unique progressive cohorts</strong>.
              </p>
            </div>

            <!-- Point 3 & 4 -->
            <div class="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900 flex items-center gap-1.5">
                <i class="fas fa-check-circle text-emerald-600"></i> Why Stage 5 is Capped at 88,890
              </div>
              <p class="text-slate-600 leading-relaxed text-[11px]">
                A strict unconstrained tenfold expansion gives <code>10 &rarr; 100 &rarr; 1,000 &rarr; 10,000 &rarr; 1,00,000</code>, totaling <strong>1,11,110 members</strong>. 
                To cap cumulative membership at exactly the stated <strong>1,00,000 unique member milestone</strong>, Stage 5 engages <strong>88,890 members</strong>.
              </p>
            </div>
          </div>

          <!-- Implementation Constraints Note -->
          <div class="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
            <strong>Stewardship Implementation Constraints:</strong> 
            Counts reflect unique members only (no double-counting). One-time contributions are separated from recurring revenue. 
            Annualized figures represent run-rates assuming full 12-month retention. Collection fees, taxes, churn, and operational overhead are not deducted from these gross projections.
          </div>
        </div>

      </div>
    `;

    container.innerHTML = html;
  }

  // Export 5-Stage Network Plan to CSV
  exportNetworkCSV() {
    const stages = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES : [];
    const contribution = this.networkContribution || 1000;

    const headers = [
      "Stage",
      "Role Title",
      "New Members",
      "Cumulative Members",
      "Model A One-Time Gross (INR)",
      "Model B Monthly Gross (INR)",
      "Model B Annualized Run-Rate (INR)"
    ];

    const rows = stages.map(s => [
      `Stage ${s.stageNumber}${s.isCapped ? ' (Capped)' : ''}`,
      `"${s.role}"`,
      s.targetMembers,
      s.cumulativeMembers,
      s.cumulativeMembers * contribution,
      s.cumulativeMembers * contribution,
      s.cumulativeMembers * contribution * 12
    ]);

    // Summary row
    rows.push([
      "Total Cap Milestone",
      "Target Capacity",
      100000,
      100000,
      100000 * contribution,
      100000 * contribution,
      100000 * contribution * 12
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `cfm-5-level-network-scaling-${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast("Exported Rapid 5-Level Network Plan to CSV", "success");
  }

  // ===================== FOLLOW-UPS & PRAYER ACTION CENTER =====================
  renderFollowupsView() {
    const container = document.getElementById('main-view-container');
    const todayStr = new Date().toISOString().split('T')[0];

    const leadsWithFollowup = this.leads.filter(l => l.nextFollowUp && this.normalizeStage(l.stage) !== 'committed' && this.normalizeStage(l.stage) !== 'closed');

    const overdue = leadsWithFollowup.filter(l => l.nextFollowUp < todayStr);
    const today = leadsWithFollowup.filter(l => l.nextFollowUp === todayStr);
    const upcoming = leadsWithFollowup.filter(l => l.nextFollowUp > todayStr).sort((a,b) => a.nextFollowUp.localeCompare(b.nextFollowUp));

    const prayerLeads = this.leads.filter(l => l.prayerRequests && l.prayerRequests.trim().length > 0);

    let html = `
      <div class="space-y-6">
        <!-- Ministry Banner -->
        <div class="bg-gradient-to-r from-blue-900 to-indigo-950 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div class="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
              <i class="fas fa-hands-helping"></i> Christ Focus Mission Pastoral & Stewardship Care
            </div>
            <h2 class="text-base sm:text-xl font-bold font-serif-title leading-tight">Partner Follow-ups & Intercession</h2>
            <p class="text-xs text-blue-200 mt-1 max-w-2xl">
              "Every fundraising conversation is an opportunity for prayer and fellowship. Follow up promptly and pray for your partners."
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-center px-4 py-2 bg-white/10 rounded-xl backdrop-blur-sm border border-white/10">
              <div class="text-2xl font-bold text-rose-300">${overdue.length}</div>
              <div class="text-[10px] uppercase font-bold text-slate-300">Overdue</div>
            </div>
            <div class="text-center px-4 py-2 bg-white/10 rounded-xl backdrop-blur-sm border border-white/10">
              <div class="text-2xl font-bold text-amber-300">${today.length}</div>
              <div class="text-[10px] uppercase font-bold text-slate-300">Due Today</div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Follow-up tasks list (2 Cols) -->
          <div class="lg:col-span-2 space-y-4">
            <!-- Overdue Section -->
            ${overdue.length > 0 ? `
              <div class="bg-white rounded-xl border border-red-200 p-4 shadow-sm">
                <h3 class="text-sm font-bold text-red-600 flex items-center gap-2 mb-3">
                  <i class="fas fa-exclamation-triangle"></i> Overdue Follow-ups (${overdue.length})
                </h3>
                <div class="space-y-2.5">
                  ${overdue.map(l => this.renderFollowupItem(l, 'overdue')).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Today Section -->
            <div class="bg-white rounded-xl border border-amber-200 p-4 shadow-sm">
              <h3 class="text-sm font-bold text-amber-800 flex items-center gap-2 mb-3">
                <i class="far fa-calendar-star"></i> Due Today (${today.length})
              </h3>
              ${today.length === 0 ? `
                <p class="text-xs text-slate-400 italic py-2">No follow-ups due today. Great job keeping up with communications!</p>
              ` : `
                <div class="space-y-2.5">
                  ${today.map(l => this.renderFollowupItem(l, 'today')).join('')}
                </div>
              `}
            </div>

            <!-- Upcoming Section -->
            <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
                <i class="far fa-calendar-alt text-blue-600"></i> Upcoming Scheduled Follow-ups (${upcoming.length})
              </h3>
              ${upcoming.length === 0 ? `
                <p class="text-xs text-slate-400 italic py-2">No upcoming follow-ups scheduled.</p>
              ` : `
                <div class="space-y-2.5">
                  ${upcoming.map(l => this.renderFollowupItem(l, 'upcoming')).join('')}
                </div>
              `}
            </div>
          </div>

          <!-- Partner Prayer Requests Side Panel -->
          <div class="space-y-4">
            <div class="bg-white rounded-xl border border-indigo-100 p-5 shadow-sm">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-bold text-indigo-950 flex items-center gap-2 text-sm">
                  <i class="fas fa-pray text-indigo-600"></i> Partner Prayer List
                </h3>
                <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold">
                  ${prayerLeads.length}
                </span>
              </div>
              <p class="text-xs text-slate-500 mb-4">
                Remember these ministry friends and their specific prayer requests before calling or writing to them.
              </p>

              <div class="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                ${prayerLeads.map(lead => `
                  <div class="p-3 rounded-lg bg-indigo-50/50 border border-indigo-100 hover:border-indigo-300 transition cursor-pointer"
                       onclick="app.openLeadDetails('${lead.id}')">
                    <div class="flex justify-between items-start mb-1">
                      <span class="font-bold text-xs text-slate-900">${this.escapeHtml(lead.name)}</span>
                      <span class="text-[10px] text-indigo-600 font-semibold">${lead.assignedTo || ''}</span>
                    </div>
                    <p class="text-xs text-slate-700 italic leading-relaxed">
                      "${this.escapeHtml(lead.prayerRequests)}"
                    </p>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  renderFollowupItem(lead, type) {
    const isOverdue = type === 'overdue';
    return `
      <div class="p-3 rounded-lg border ${isOverdue ? 'border-red-100 bg-red-50/40' : 'border-slate-200 bg-slate-50/60'} flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-slate-900 hover:text-amber-700 cursor-pointer" onclick="app.openLeadDetails('${lead.id}')">
              ${this.escapeHtml(lead.name)}
            </span>
            <span class="text-xs px-2 py-0.5 rounded ${this.getStageBadgeClass(lead.stage)}">
              ${this.getStageLabel(lead.stage)}
            </span>
          </div>
          <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
            <span><i class="far fa-envelope mr-1"></i>${lead.email || 'No email'}</span>
            <span><i class="fas fa-phone mr-1"></i>${lead.phone || 'No phone'}</span>
            <span><i class="fas fa-user-tag mr-1"></i>${lead.assignedTo || 'Unassigned'}</span>
          </div>
          ${lead.notes ? `
            <p class="text-xs text-slate-600 mt-1 italic line-clamp-1">Note: ${this.escapeHtml(lead.notes)}</p>
          ` : ''}
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button onclick="app.logQuickTouchpoint('${lead.id}')" class="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-sm transition">
            <i class="fas fa-comment-dots text-blue-600 mr-1"></i> Log Touch
          </button>
          <button onclick="app.openLeadDetails('${lead.id}')" class="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
            View Details
          </button>
        </div>
      </div>
    `;
  }

  // ===================== ANALYTICS VIEW =====================
  renderAnalyticsView() {
    const container = document.getElementById('main-view-container');

    // Aggregate by stages
    const stageCounts = {};
    const stageAmounts = {};
    CFM_STAGES.forEach(s => {
      stageCounts[s.id] = 0;
      stageAmounts[s.id] = 0;
    });

    this.leads.forEach(l => {
      const norm = this.normalizeStage(l.stage);
      if (stageCounts[norm] !== undefined) {
        stageCounts[norm]++;
        stageAmounts[norm] += (Number(l.expectedAmount) || 0);
      }
    });

    // Aggregate by Lead Type
    const typeCounts = {};
    this.leads.forEach(l => {
      const t = l.leadType || 'Individual';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });

    let html = `
      <div class="space-y-6">
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 class="text-base sm:text-lg font-bold text-slate-900 leading-tight">Pipeline Analytics & Reports</h2>
            <p class="text-xs text-slate-500">Real-time pipeline health, stage distribution, and donor insights</p>
          </div>
          <button onclick="app.exportLeadsCSV()" class="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg shadow-sm flex items-center gap-2 transition">
            <i class="fas fa-download text-emerald-600"></i> Download Full Spreadsheet
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Stage Breakdown -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 class="font-bold text-slate-900 text-sm mb-4">Pipeline Value by Stage</h3>
            <div class="space-y-3">
              ${CFM_STAGES.map(s => {
                const totalAll = this.leads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0) || 1;
                const amt = stageAmounts[s.id] || 0;
                const pct = Math.round((amt / totalAll) * 100);
                return `
                  <div>
                    <div class="flex justify-between text-xs font-semibold mb-1">
                      <span class="text-slate-700">${s.label} (${stageCounts[s.id]} leads)</span>
                      <span class="text-slate-900 font-bold">${this.formatCurrency(amt)} (${pct}%)</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2">
                      <div class="bg-${s.color}-500 h-2 rounded-full" style="width: ${pct}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Lead Distribution by Type -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 class="font-bold text-slate-900 text-sm mb-4">Leads by Donor Category</h3>
            <div class="grid grid-cols-2 gap-3 mb-6">
              ${Object.entries(typeCounts).map(([type, count]) => `
                <div class="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div class="text-xs text-slate-500 font-medium">${type}</div>
                  <div class="text-lg font-bold text-slate-900 mt-1">${count} <span class="text-xs font-normal text-slate-400">leads</span></div>
                </div>
              `).join('')}
            </div>

            <!-- Stage-Weighted Pipeline Forecast -->
            <div class="p-4 rounded-xl bg-amber-50 border border-amber-200/80">
              <div class="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider mb-1">
                <i class="fas fa-calculator"></i> Stage-Weighted Pipeline Forecast
              </div>
              <div class="text-2xl font-black text-amber-950 mt-1">
                ${this.formatCurrency(this.calculateWeightedPipeline())}
              </div>
              <p class="text-xs text-amber-800 mt-1">
                Projected realization based on donor progression pipeline stages (100% committed, 60% in discussion, 30% contacted, 10% new leads).
              </p>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  calculateWeightedPipeline() {
    const stageWeights = {
      'committed': 1.0,
      'in_discussion': 0.6,
      'contacted': 0.3,
      'new': 0.1,
      'closed': 0.0
    };
    return this.leads.reduce((sum, lead) => {
      const stage = this.normalizeStage(lead.stage);
      const weight = stageWeights[stage] !== undefined ? stageWeights[stage] : 0.2;
      const amt = Number(lead.expectedAmount) || 0;
      return sum + (amt * weight);
    }, 0);
  }

  // ===================== ADMIN CENTER TAB VIEW =====================
  switchAdminSubTab(subTab) {
    this.adminSubTab = subTab;
    this.renderAdminView();
    // Auto-center the active admin subtab button in mobile horizontal scroll view
    setTimeout(() => {
      const activeBtn = document.querySelector(`[data-admin-subtab="${subTab}"]`);
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, 50);
  }

  renderUsersView() {
    this.renderAdminView();
  }

  renderAdminView() {
    const container = document.getElementById('main-view-container');
    if (!container) return;

    if (this.userRole !== 'admin') {
      alert("Permission Denied: Administrator Control Center is restricted to Administrators only.");
      this.switchView('kanban');
      return;
    }

    const adminCount = this.users.filter(u => u.role === 'admin').length;
    const crmCount = this.users.filter(u => u.role === 'crm').length;
    const isLive = cfmFirebase.isLive;
    const savedConfig = cfmFirebase.getSavedConfig();
    const currentSubTab = this.adminSubTab || 'users';

    let html = `
      <div class="space-y-6">
        <!-- Header Banner -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-[#181A3A] text-white p-6 rounded-2xl shadow-md border border-indigo-900/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-widest">
                👑 Administrator Center
              </span>
              <span class="text-xs text-slate-300">
                • ${isLive ? `<span class="text-emerald-400 font-semibold"><i class="fas fa-check-circle mr-1"></i>Cloud Firestore (${this.escapeHtml(savedConfig?.projectId || 'Connected')})</span>` : '<span class="text-amber-400 font-semibold"><i class="fas fa-database mr-1"></i>Local Storage Mode</span>'}
              </span>
            </div>
            <h2 class="text-base sm:text-xl font-bold font-heading text-white flex items-center gap-2 leading-tight">
              <i class="fas fa-shield-halved text-amber-400"></i>
              <span>Administrator Control Center</span>
            </h2>
            <p class="text-xs text-slate-300 max-w-2xl">
              Manage team members & passwords, configure Google Firebase Cloud Firestore, test connections, and manage permissions.
            </p>
          </div>

          <!-- Quick Metric Chips -->
          <div class="flex flex-wrap items-center gap-2.5">
            <div class="px-3.5 py-2 rounded-xl bg-white/10 border border-white/10 text-center min-w-[70px]">
              <div class="text-[10px] font-bold text-slate-300 uppercase">Users</div>
              <div class="text-lg font-black text-white">${this.users.length}</div>
            </div>
            <div class="px-3.5 py-2 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-center min-w-[70px]">
              <div class="text-[10px] font-bold text-indigo-200 uppercase">Admins</div>
              <div class="text-lg font-black text-cyan-300">${adminCount}</div>
            </div>
            <div class="px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-400/30 text-center min-w-[70px]">
              <div class="text-[10px] font-bold text-amber-200 uppercase">CRM Staff</div>
              <div class="text-lg font-black text-amber-300">${crmCount}</div>
            </div>
          </div>
        </div>

        <!-- Admin Sub-Navigation Tabs Bar (Touch scrollable, single row) -->
        <div class="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto text-xs font-bold no-scrollbar">
          <button data-admin-subtab="users" onclick="app.switchAdminSubTab('users')" class="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap shrink-0 ${currentSubTab === 'users' ? 'bg-indigo-900 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
            <i class="fas fa-users-gear ${currentSubTab === 'users' ? 'text-cyan-400' : 'text-slate-500'}"></i>
            <span>Team Users & Passwords</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] ${currentSubTab === 'users' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}">${this.users.length}</span>
          </button>

          <button data-admin-subtab="campaigns" onclick="app.switchAdminSubTab('campaigns')" class="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap shrink-0 ${currentSubTab === 'campaigns' ? 'bg-indigo-900 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
            <i class="fas fa-bullseye ${currentSubTab === 'campaigns' ? 'text-amber-400' : 'text-slate-500'}"></i>
            <span>Campaign Funds</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] ${currentSubTab === 'campaigns' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}">${this.campaigns.length}</span>
          </button>

          <button data-admin-subtab="firebase" onclick="app.switchAdminSubTab('firebase')" class="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap shrink-0 ${currentSubTab === 'firebase' ? 'bg-indigo-900 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
            <i class="fas fa-cloud ${currentSubTab === 'firebase' ? 'text-amber-400' : 'text-slate-500'}"></i>
            <span>Firebase Cloud Sync</span>
            <span class="w-2.5 h-2.5 rounded-full ${isLive ? 'bg-emerald-500 shadow-sm shadow-emerald-400/50' : 'bg-amber-400'}"></span>
          </button>

          <button data-admin-subtab="security" onclick="app.switchAdminSubTab('security')" class="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap shrink-0 ${currentSubTab === 'security' ? 'bg-indigo-900 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
            <i class="fas fa-lock ${currentSubTab === 'security' ? 'text-emerald-400' : 'text-slate-500'}"></i>
            <span>Role & Security PIN</span>
          </button>
        </div>
    `;

    if (currentSubTab === 'users') {
      html += `
        <!-- Main Users Section: Add User Form + Directory -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          <!-- LEFT: Create User Form Card -->
          <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 class="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <i class="fas fa-user-plus text-amber-600"></i>
                  <span>Create Team Member</span>
                </h3>
                <p class="text-[11px] text-slate-500">Saves directly to Firebase Firestore</p>
              </div>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isLive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}">
                <i class="fas fa-bolt text-emerald-500 mr-1"></i>${isLive ? 'Cloud Synced' : 'Local + Sync'}
              </span>
            </div>

            <form id="tab-add-user-form" onsubmit="app.handleSaveUserFromTab(event)" class="space-y-3.5">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                <div class="relative">
                  <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <i class="far fa-user text-xs"></i>
                  </span>
                  <input type="text" id="tab-user-name" required placeholder="e.g. Rachel Adams" 
                         class="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Username *</label>
                  <div class="relative">
                    <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <i class="fas fa-at text-xs"></i>
                    </span>
                    <input type="text" id="tab-user-username" required placeholder="e.g. rachel" 
                           class="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white font-mono">
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                  <div class="relative">
                    <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <i class="far fa-envelope text-xs"></i>
                    </span>
                    <input type="email" id="tab-user-email" required placeholder="rachel@christfocusmission.org" 
                           class="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                  </div>
                </div>
              </div>

              <!-- Password Input Field -->
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Login Password *</label>
                <div class="relative">
                  <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <i class="fas fa-key text-xs"></i>
                  </span>
                  <input type="password" id="tab-user-password" required minlength="6" placeholder="Set initial login password" 
                         class="w-full pl-9 pr-10 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                  <button type="button" onclick="app.togglePwdFieldVisibility('tab-user-password', 'tab-pwd-toggle-icon')" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600">
                    <i id="tab-pwd-toggle-icon" class="fas fa-eye text-xs"></i>
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Workspace Role *</label>
                  <select id="tab-user-role" class="w-full p-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white font-medium">
                    <option value="crm">👤 CRM Staff (Protected)</option>
                    <option value="admin">👑 Administrator (Full Access)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input type="text" id="tab-user-phone" placeholder="+91 98401 23456" 
                         class="w-full p-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Title / Designation</label>
                  <input type="text" id="tab-user-title" placeholder="e.g. Field Liaison" 
                         class="w-full p-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                  <input type="text" id="tab-user-dept" placeholder="e.g. Church Outreach" 
                         class="w-full p-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                </div>
              </div>

              <div class="pt-2">
                <button type="submit" class="w-full cfm-btn-cta text-slate-950 font-black text-xs py-2.5 px-4 rounded-xl shadow-md flex items-center justify-center gap-2 transition">
                  <i class="fas fa-cloud-arrow-up text-slate-950"></i>
                  <span>Add User & Save to Firebase</span>
                </button>
              </div>
            </form>
          </div>

          <!-- RIGHT: Users Directory List with Change Password Actions -->
          <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 class="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <i class="fas fa-address-book text-indigo-600"></i>
                  <span>Team Directory & Password Management</span>
                </h3>
                <p class="text-[11px] text-slate-500">Live roster saved in Firestore <code>cfm_users</code></p>
              </div>
              <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                ${this.users.length} Registered
              </span>
            </div>

            <div class="space-y-3 max-h-[640px] overflow-y-auto pr-1">
              ${this.users.length === 0 ? `
                <div class="p-8 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                  <i class="fas fa-users text-3xl mb-2 text-slate-300"></i>
                  <p class="text-xs font-semibold">No team users found.</p>
                  <p class="text-[11px]">Add your first team member using the form on the left.</p>
                </div>
              ` : this.users.map(u => {
                const assignedLeadsCount = this.leads.filter(l => l.assignedTo && l.assignedTo.toLowerCase() === (u.name || '').toLowerCase()).length;
                return `
                  <div class="p-4 bg-slate-50/70 hover:bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div class="flex items-start md:items-center space-x-3.5">
                      <div class="w-10 h-10 rounded-xl ${u.role === 'admin' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-slate-950'} flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                        ${u.name ? u.name.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div>
                        <div class="flex flex-wrap items-center gap-2">
                          <h4 class="font-bold text-slate-900 text-xs sm:text-sm">${this.escapeHtml(u.name)}</h4>
                          <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 border border-slate-300" title="Login Username">
                            @${this.escapeHtml(u.username || (u.aliases && u.aliases[0]) || u.email.split('@')[0])}
                          </span>
                          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-800 border border-indigo-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}">
                            ${u.role === 'admin' ? '👑 Administrator' : '👤 CRM Staff'}
                          </span>
                        </div>
                        <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span><i class="far fa-envelope mr-1 text-slate-400"></i>${this.escapeHtml(u.email)}</span>
                          ${u.phone ? `<span>• <i class="fas fa-phone mr-1 text-slate-400"></i>${this.escapeHtml(u.phone)}</span>` : ''}
                          ${u.title ? `<span>• <strong class="text-slate-700 font-medium">${this.escapeHtml(u.title)}</strong></span>` : ''}
                          ${u.department ? `<span>(${this.escapeHtml(u.department)})</span>` : ''}
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-200">
                      <!-- Edit User Details Button -->
                      <button type="button" onclick="app.openEditUserModal('${u.id}')" title="Edit user profile and role for ${this.escapeHtml(u.name)}" class="px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg flex items-center gap-1.5 transition shadow-sm cursor-pointer border border-amber-400">
                        <i class="fas fa-user-pen text-xs"></i>
                        <span>Edit User</span>
                      </button>

                      <!-- Set / Change Password Button -->
                      <button type="button" onclick="app.openChangePasswordModal('${u.id}')" title="Set or Change Password for ${this.escapeHtml(u.name)}" class="px-3 py-1.5 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg flex items-center gap-1.5 transition cursor-pointer">
                        <i class="fas fa-key text-amber-500 text-xs"></i>
                        <span>Set Password</span>
                      </button>

                      ${this.users.length > 1 ? `
                        <button type="button" onclick="app.confirmDeleteUser('${u.id}')" title="Delete User" class="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer">
                          <i class="far fa-trash-alt text-xs"></i>
                        </button>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

        </div>
      `;
    } else if (currentSubTab === 'campaigns') {
      html += `
        <!-- Campaigns Management Subtab in Admin Center -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 class="font-bold text-base text-slate-900 flex items-center gap-2">
                <i class="fas fa-bullseye text-amber-600"></i>
                <span>Mission Campaign Funds & Priorities</span>
              </h3>
              <p class="text-xs text-slate-500">Create, edit, or delete strategic fundraising campaign funds for Christ Focus Mission</p>
            </div>
            <button type="button" onclick="app.openCampaignModal()" class="cfm-btn-cta text-slate-950 font-bold text-xs py-2 px-3.5 rounded-xl shadow-sm flex items-center gap-1.5 transition cursor-pointer">
              <i class="fas fa-plus text-slate-950"></i>
              <span>New Campaign Fund</span>
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${this.campaigns.length === 0 ? `
              <div class="col-span-full p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <i class="fas fa-bullseye text-3xl mb-2 text-slate-300"></i>
                <p class="text-xs font-semibold text-slate-700">No mission campaign funds created yet.</p>
                <p class="text-[11px] text-slate-500">Click "New Campaign Fund" above to add your first fund.</p>
              </div>
            ` : this.campaigns.map(camp => {
              const linkedLeads = this.leads.filter(l => l.campaignId === camp.id);
              const target = Number(camp.target) || 1;
              const totalRaised = linkedLeads.reduce((sum, l) => {
                const rec = Number(l.receivedAmount) || 0;
                if (rec > 0) return sum + rec;
                if (this.normalizeStage(l.stage) === 'committed') return sum + (Number(l.expectedAmount) || 0);
                return sum;
              }, 0);
              const pct = Math.min(100, Math.round((totalRaised / target) * 100));

              return `
                <div class="p-4 bg-slate-50/70 rounded-xl border border-slate-200 hover:border-slate-300 transition space-y-3">
                  <div class="flex items-start justify-between">
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                          ${camp.code || 'FUND'}
                        </span>
                        <h4 class="font-bold text-slate-900 text-sm">${this.escapeHtml(camp.name)}</h4>
                      </div>
                      <p class="text-xs text-slate-500 mt-1 line-clamp-2">${this.escapeHtml(camp.description || 'No description provided.')}</p>
                    </div>
                  </div>

                  <!-- Goal & Progress -->
                  <div class="space-y-1">
                    <div class="flex justify-between text-xs font-semibold">
                      <span class="text-emerald-700">${this.formatCurrency(totalRaised)} raised</span>
                      <span class="text-slate-500">Goal: ${this.formatCurrency(target)}</span>
                    </div>
                    <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div class="bg-emerald-600 h-2 rounded-full" style="width: ${pct}%"></div>
                    </div>
                  </div>

                  <div class="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs">
                    <span class="text-slate-500 font-medium">${linkedLeads.length} Linked Leads</span>
                    <div class="flex items-center gap-2">
                      <button type="button" onclick="app.openCampaignModal('${camp.id}')" title="Edit Campaign" class="px-2.5 py-1 text-xs font-bold text-indigo-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg flex items-center gap-1 transition shadow-xs cursor-pointer">
                        <i class="fas fa-pen-to-square text-[10px]"></i> Edit
                      </button>
                      <button type="button" onclick="app.confirmDeleteCampaign('${camp.id}')" title="Delete Campaign" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition cursor-pointer">
                        <i class="far fa-trash-alt text-xs"></i>
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else if (currentSubTab === 'firebase') {
      html += `
        <!-- Firebase Cloud Database Subtab -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 class="font-bold text-base text-slate-900 flex items-center gap-2">
                <i class="fas fa-fire text-amber-600"></i>
                <span>Google Firebase Cloud Firestore Connection</span>
              </h3>
              <p class="text-xs text-slate-500">Live multi-user cloud synchronization for leads, campaigns, and team members</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${isLive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                <span class="w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
                <span>${isLive ? 'Connected to Cloud' : 'Local Storage Mode'}</span>
              </span>
            </div>
          </div>

          <!-- Quick instructions accordion -->
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <i class="fas fa-info-circle text-blue-600"></i> How to connect your Firebase Project in 2 minutes:
            </div>
            <ol class="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed text-[11px]">
              <li>Open <a href="https://console.firebase.google.com" target="_blank" class="text-blue-600 font-bold underline">Firebase Console</a> and click <strong>Create a project</strong> (or choose an existing one).</li>
              <li>In the left sidebar, click <strong>Build &rarr; Firestore Database</strong> &rarr; <strong>Create Database</strong>. Choose <em>Start in test mode</em>.</li>
              <li>Go to <strong>Project Settings (Gear icon) &rarr; General &rarr; Your apps &rarr; Web (&lt;/&gt;)</strong>. Copy the <code>firebaseConfig</code> object and paste it below!</li>
            </ol>
          </div>

          <!-- Auto-Paste Snippet Helper -->
          <div>
            <label class="block font-bold text-slate-700 mb-1 text-xs">
              <i class="fas fa-paste text-amber-600 mr-1"></i> Quick Paste: Paste full Firebase config snippet here
            </label>
            <textarea oninput="app.handlePasteFirebaseConfig(this.value)" rows="3" placeholder="const firebaseConfig = { apiKey: 'AIza...', authDomain: '...', projectId: '...' };" class="w-full p-2.5 rounded-lg border border-slate-300 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500"></textarea>
            <span class="text-[10px] text-slate-400">Pasting automatically populates the individual fields below.</span>
          </div>

          <!-- Individual Config Inputs -->
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label class="block font-semibold text-slate-700 mb-1 text-xs">API Key *</label>
              <input type="text" id="fb-api-key" value="${this.escapeHtml(savedConfig?.apiKey || '')}" placeholder="AIzaSy..." class="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-amber-500">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1 text-xs">Project ID *</label>
              <input type="text" id="fb-project-id" value="${this.escapeHtml(savedConfig?.projectId || '')}" placeholder="christ-focus-mission" class="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-amber-500">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1 text-xs">Auth Domain</label>
              <input type="text" id="fb-auth-domain" value="${this.escapeHtml(savedConfig?.authDomain || '')}" placeholder="project.firebaseapp.com" class="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-amber-500">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1 text-xs">Storage Bucket</label>
              <input type="text" id="fb-storage-bucket" value="${this.escapeHtml(savedConfig?.storageBucket || '')}" placeholder="project.appspot.com" class="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-amber-500">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1 text-xs">Messaging Sender ID</label>
              <input type="text" id="fb-sender-id" value="${this.escapeHtml(savedConfig?.messagingSenderId || '')}" placeholder="1234567890" class="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-amber-500">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1 text-xs">App ID</label>
              <input type="text" id="fb-app-id" value="${this.escapeHtml(savedConfig?.appId || '')}" placeholder="1:123456:web:abcd" class="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-amber-500">
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" onclick="app.handleTestFirebaseConnection()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl border border-slate-300 flex items-center gap-1.5 transition text-xs">
                <i class="fas fa-plug text-indigo-600"></i> Test Connection
              </button>
              <button type="button" onclick="app.handleSaveFirebaseConfig()" class="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-sm flex items-center gap-1.5 transition text-xs">
                <i class="fas fa-save"></i> Save & Connect Cloud
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button type="button" onclick="app.handlePushLocalToFirebase()" class="px-4 py-2 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl flex items-center gap-1.5 transition text-xs">
                <i class="fas fa-cloud-upload-alt text-indigo-600"></i> Push Local Data to Firestore
              </button>
              <button type="button" onclick="app.handleDisconnectFirebase()" class="px-4 py-2 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl font-bold transition text-xs">
                Reset to Demo Mode
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (currentSubTab === 'security') {
      html += `
        <!-- Role & System Security Subtab -->
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 max-w-3xl">
          <div class="border-b border-slate-100 pb-3">
            <h3 class="font-bold text-base text-slate-900 flex items-center gap-2">
              <i class="fas fa-user-shield text-amber-600"></i>
              <span>Role-Based Access Control & System Security</span>
            </h3>
            <p class="text-xs text-slate-500">Preview CRM mode as operational staff or full administrator</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Option: Admin -->
            <div onclick="app.selectRoleOption('admin')" class="p-4 rounded-xl border-2 cursor-pointer transition ${this.userRole === 'admin' ? 'border-indigo-600 bg-indigo-50/40 shadow-sm' : 'border-slate-200 hover:border-slate-300'}">
              <div class="flex items-center gap-2">
                <span class="text-xl">👑</span>
                <div>
                  <h4 class="font-bold text-slate-900 text-sm">Administrator Mode</h4>
                  <span class="text-[10px] text-indigo-700 font-semibold">Active: Full Unrestricted Access</span>
                </div>
              </div>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed">
                Full authority over database sync, lead deletions, campaign creation, user creation, and password resets.
              </p>
            </div>

            <!-- Option: CRM Staff -->
            <div onclick="app.selectRoleOption('crm')" class="p-4 rounded-xl border-2 cursor-pointer transition ${this.userRole === 'crm' ? 'border-amber-600 bg-amber-50/40 shadow-sm' : 'border-slate-200 hover:border-slate-300'}">
              <div class="flex items-center gap-2">
                <span class="text-xl">👤</span>
                <div>
                  <h4 class="font-bold text-slate-900 text-sm">CRM Staff Preview</h4>
                  <span class="text-[10px] text-amber-700 font-semibold">Protected Operational Mode</span>
                </div>
              </div>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed">
                Operational fundraising mode: manage pipeline leads, activities, and follow-ups. Database settings and deletions are hidden.
              </p>
            </div>
          </div>

          <!-- PIN section -->
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <label class="block font-semibold text-slate-700 text-xs">
              <i class="fas fa-lock text-amber-600 mr-1"></i> Admin Security PIN (Required to switch back to Admin)
            </label>
            <input type="password" id="admin-pin-input" placeholder="Enter Security PIN" maxlength="8" class="w-full sm:w-64 p-2 rounded-lg border border-slate-300 font-mono text-center tracking-widest text-xs focus:ring-1 focus:ring-indigo-500 bg-white">
          </div>

          <div class="pt-3 border-t border-slate-200 flex justify-end">
            <button type="button" onclick="app.applyRoleChange()" class="px-5 py-2.5 bg-indigo-900 hover:bg-indigo-950 text-white font-bold rounded-xl shadow-md transition text-xs flex items-center gap-2">
              <i class="fas fa-check"></i> Apply Role Mode
            </button>
          </div>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;
  }

  async handleSaveUserFromTab(e) {
    e.preventDefault();
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can create users.");
      return;
    }

    const name = document.getElementById('tab-user-name').value.trim();
    const rawUsername = document.getElementById('tab-user-username') ? document.getElementById('tab-user-username').value.trim().toLowerCase() : '';
    const email = document.getElementById('tab-user-email').value.trim();
    const username = (rawUsername || email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9._-]/g, '');
    const role = document.getElementById('tab-user-role').value;
    const pwdEl = document.getElementById('tab-user-password');
    const password = (pwdEl ? pwdEl.value.trim() : '') || 'crmStaff2026!';
    const phone = document.getElementById('tab-user-phone').value.trim();
    const title = document.getElementById('tab-user-title').value.trim();
    const department = document.getElementById('tab-user-dept').value.trim();

    if (!name || !email) {
      alert("Name and email are required to create a user.");
      return;
    }

    try {
      const newUser = await cfmFirebase.addUser({
        name,
        username,
        email,
        aliases: [username, email.toLowerCase()],
        password,
        role,
        phone,
        title,
        department
      });

      if (newUser && !this.users.some(u => u.id === newUser.id)) {
        this.users.push(newUser);
      }

      this.populateAssignedUserDropdowns();
      this.renderAdminView();

      this.showToast(`User "${name}" created with password and saved to Firebase Firestore!`, 'success');
    } catch (err) {
      alert("Error saving user to Firebase: " + err.message);
    }
  }

  // ===================== USER PASSWORD MANAGEMENT =====================
  openChangePasswordModal(userId) {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can change user passwords.");
      return;
    }
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    const modal = document.getElementById('modal-change-password');
    if (!modal) return;

    document.getElementById('change-pwd-user-id').value = user.id;
    document.getElementById('change-pwd-user-name').textContent = user.name;
    const userUname = user.username || (user.aliases && user.aliases[0]) || user.email.split('@')[0];
    document.getElementById('change-pwd-user-email').textContent = `@${userUname} • ${user.email}`;
    document.getElementById('change-pwd-input').value = '';
    document.getElementById('change-pwd-confirm').value = '';

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeChangePasswordModal() {
    const modal = document.getElementById('modal-change-password');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  async handleSaveNewPassword(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can update user passwords.");
      return;
    }

    const userId = document.getElementById('change-pwd-user-id').value;
    const newPwd = document.getElementById('change-pwd-input').value;
    const confirmPwd = document.getElementById('change-pwd-confirm').value;

    if (!newPwd || newPwd.length < 6) {
      alert("Password must be at least 6 characters long.");
      return;
    }

    if (newPwd !== confirmPwd) {
      alert("Passwords do not match. Please re-enter.");
      return;
    }

    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    try {
      await cfmFirebase.updateUser(userId, { password: newPwd });
      user.password = newPwd;

      // If updating currently logged in user, update session
      if (this.currentUser && (this.currentUser.id === userId || this.currentUser.email === user.email)) {
        this.currentUser.password = newPwd;
        if (localStorage.getItem('cfm_auth_session')) {
          localStorage.setItem('cfm_auth_session', JSON.stringify(this.currentUser));
        } else if (sessionStorage.getItem('cfm_auth_session')) {
          sessionStorage.setItem('cfm_auth_session', JSON.stringify(this.currentUser));
        }
      }

      this.closeChangePasswordModal();
      this.showToast(`Password successfully updated for ${user.name}!`, 'success');
      if (this.activeView === 'admin' || this.activeView === 'users') {
        this.renderAdminView();
      }
    } catch (err) {
      alert("Error updating password: " + err.message);
    }
  }

  generateRandomPasswordForChange() {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
    let pwd = "Cfm" + new Date().getFullYear() + "!";
    for (let i = 0; i < 4; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const input = document.getElementById('change-pwd-input');
    const confirm = document.getElementById('change-pwd-confirm');
    if (input) input.value = pwd;
    if (confirm) confirm.value = pwd;
    this.showToast(`Generated secure password: ${pwd}`, 'info');
  }

  togglePwdFieldVisibility(fieldId, iconId) {
    const field = document.getElementById(fieldId);
    const icon = document.getElementById(iconId);
    if (!field) return;
    if (field.type === 'password') {
      field.type = 'text';
      if (icon) {
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      }
    } else {
      field.type = 'password';
      if (icon) {
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    }
  }

  // ===================== USER DETAILS EDITING (ADMIN ONLY) =====================
  openEditUserModal(userId) {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can edit user details.");
      return;
    }
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    const modal = document.getElementById('modal-edit-user');
    if (!modal) return;

    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-name').value = user.name || '';
    const uname = user.username || (user.aliases && user.aliases[0]) || (user.email ? user.email.split('@')[0] : '');
    document.getElementById('edit-user-username').value = uname;
    document.getElementById('edit-user-email').value = user.email || '';
    document.getElementById('edit-user-role').value = user.role || 'crm';
    document.getElementById('edit-user-phone').value = user.phone || '';
    document.getElementById('edit-user-title').value = user.title || '';
    document.getElementById('edit-user-dept').value = user.department || '';

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeEditUserModal() {
    const modal = document.getElementById('modal-edit-user');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  async handleSaveEditUser(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can edit user details.");
      return;
    }

    const userId = document.getElementById('edit-user-id').value;
    const name = document.getElementById('edit-user-name').value.trim();
    const rawUsername = document.getElementById('edit-user-username').value.trim().toLowerCase();
    const email = document.getElementById('edit-user-email').value.trim().toLowerCase();
    const username = (rawUsername || email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9._-]/g, '');
    const role = document.getElementById('edit-user-role').value;
    const phone = document.getElementById('edit-user-phone').value.trim();
    const title = document.getElementById('edit-user-title').value.trim();
    const department = document.getElementById('edit-user-dept').value.trim();

    if (!name || !email) {
      alert("Name and email are required.");
      return;
    }

    const existingUser = this.users.find(u => u.id === userId);
    if (!existingUser) return;

    // Check if another user has the same username or email
    const duplicate = this.users.find(u => u.id !== userId && (
      (u.username && u.username.toLowerCase() === username) || 
      (u.email && u.email.toLowerCase() === email)
    ));
    if (duplicate) {
      alert(`A user with username "${username}" or email "${email}" already exists (${duplicate.name}). Please use a unique username and email.`);
      return;
    }

    const updates = {
      name,
      username,
      email,
      aliases: [username, email],
      role,
      phone,
      title,
      department
    };

    try {
      await cfmFirebase.updateUser(userId, updates);

      // Update in local users array
      const oldName = existingUser.name;
      Object.assign(existingUser, updates);

      // If user name changed, update leads assigned to the old name so assignments stay intact
      if (oldName && oldName !== name) {
        this.leads.forEach(l => {
          if (l.assignedTo === oldName) {
            l.assignedTo = name;
            cfmFirebase.updateLead(l.id, { assignedTo: name }).catch(() => {});
          }
        });
      }

      // If updating currently logged in user, refresh auth session and header
      if (this.currentUser && (this.currentUser.id === userId || this.currentUser.email === existingUser.email || this.currentUser.email === email)) {
        Object.assign(this.currentUser, updates);
        const sessionData = JSON.stringify(this.currentUser);
        if (localStorage.getItem('cfm_auth_session')) {
          localStorage.setItem('cfm_auth_session', sessionData);
        } else if (sessionStorage.getItem('cfm_auth_session')) {
          sessionStorage.setItem('cfm_auth_session', sessionData);
        }
        if (role !== this.userRole) {
          this.applyUserRole(role, false);
        } else {
          this.updateHeaderUserProfile();
        }
      }

      this.closeEditUserModal();
      this.populateAssignedUserDropdowns();
      if (this.activeView === 'admin' || this.activeView === 'users') {
        this.renderAdminView();
      }
      const userModal = document.getElementById('modal-user-management');
      if (userModal && !userModal.classList.contains('hidden')) {
        this.renderUsersModalContent();
      }

      this.showToast(`User "${name}" updated successfully!`, 'success');
    } catch (err) {
      alert("Error updating user details: " + err.message);
    }
  }

  // ===================== LEAD DETAILS MODAL =====================
  openLeadDetails(leadId) {
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead) return;
    this.selectedLead = lead;

    const modal = document.getElementById('modal-lead-details');
    if (!modal) return;

    this.renderLeadDetailsContent();
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeLeadDetails() {
    const modal = document.getElementById('modal-lead-details');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    this.selectedLead = null;
  }

  renderLeadDetailsContent() {
    const lead = this.selectedLead;
    if (!lead) return;

    const campaign = this.campaigns.find(c => c.id === lead.campaignId);
    const campaignName = campaign ? campaign.name : 'General Mission';

    // Name & Org
    document.getElementById('detail-lead-name').textContent = lead.name;
    document.getElementById('detail-lead-org').textContent = lead.organization || 'Individual Donor';
    document.getElementById('detail-lead-type').textContent = lead.leadType || 'Supporter';

    // Amounts
    document.getElementById('detail-lead-target').textContent = this.formatCurrency(lead.expectedAmount);
    document.getElementById('detail-lead-received').textContent = this.formatCurrency(lead.receivedAmount || 0);
    document.getElementById('detail-lead-frequency').textContent = lead.frequency || 'One-off';

    // Contact info
    document.getElementById('detail-lead-email').textContent = lead.email || 'Not provided';
    document.getElementById('detail-lead-phone').textContent = lead.phone || 'Not provided';
    document.getElementById('detail-lead-location').textContent = [lead.city, lead.country].filter(Boolean).join(', ') || 'Not specified';
    document.getElementById('detail-lead-assigned').textContent = lead.assignedTo || 'Unassigned';
    document.getElementById('detail-lead-campaign').textContent = campaignName;
    document.getElementById('detail-lead-followup').textContent = lead.nextFollowUp ? this.formatDate(lead.nextFollowUp) : 'None scheduled';

    // Network Tier Badge
    const tierBadge = document.getElementById('detail-lead-tier');
    if (tierBadge) {
      if (lead.networkTier) {
        const tierObj = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES.find(s => s.id === lead.networkTier) : null;
        tierBadge.textContent = tierObj ? `${tierObj.role}` : lead.networkTier;
        tierBadge.classList.remove('hidden');
      } else {
        tierBadge.classList.add('hidden');
      }
    }

    // Network Lineage & Level Quota Status Card
    const lineageCard = document.getElementById('detail-lead-network-lineage');
    if (lineageCard) {
      if (lead.networkTier) {
        const info = this.getLeaderLevelInfo(lead.id);
        const parentLead = info.parentLead;
        const directRecruits = info.directRecruits;

        lineageCard.innerHTML = `
          <div class="p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/70 via-white to-blue-50/30 space-y-3.5 shadow-sm">
            <div class="flex items-center justify-between border-b border-amber-200/80 pb-2.5">
              <div class="flex items-center gap-2">
                <span class="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shadow-sm">
                  ${info.stageNumber}
                </span>
                <div>
                  <h4 class="font-bold text-slate-900 text-xs">${this.escapeHtml(info.roleTitle)}</h4>
                  <p class="text-[10px] text-slate-500">Stage ${info.stageNumber} of 5-Stage Multiplying Model</p>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-full text-[11px] ${info.statusBadgeClass}">
                ${info.statusLabel}
              </span>
            </div>

            <!-- Upline Mentor Banner -->
            <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="text-slate-400 text-xs">
                  <i class="fas fa-level-up-alt rotate-90 text-amber-500"></i>
                </div>
                <div>
                  <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recruited Under / Upline Leader</div>
                  <div class="font-bold text-slate-800 text-xs">
                    ${parentLead ? `
                      <span onclick="app.openLeadDetails('${parentLead.id}')" class="text-amber-700 hover:text-amber-800 cursor-pointer underline flex items-center gap-1">
                        <i class="fas fa-user-circle"></i> ${this.escapeHtml(parentLead.name)}
                        <span class="text-[10px] font-normal text-slate-500">(${this.getStageRoleLabel(parentLead.networkTier)})</span>
                      </span>
                    ` : `
                      <span class="text-amber-900 flex items-center gap-1 font-extrabold">
                        <i class="fas fa-crown text-amber-500"></i> Root Core Leader (No Upline - Executive Founder Team)
                      </span>
                    `}
                  </div>
                </div>
              </div>
              ${parentLead ? `
                <button onclick="app.openLeadDetails('${parentLead.id}')" class="text-[11px] bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold px-2 py-1 rounded shadow-xs">
                  View Mentor
                </button>
              ` : ''}
            </div>

            <!-- Level Quota Progress Meter -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="font-bold text-slate-700 flex items-center gap-1">
                  <i class="fas fa-bullseye text-amber-600"></i> Level ${info.stageNumber} Quota Goal: 10 Direct Recruits
                </span>
                <span class="font-extrabold ${info.isReached ? 'text-emerald-700' : 'text-amber-700'}">
                  ${info.recruitCount} / 10 (${info.percentage}%)
                </span>
              </div>
              <div class="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                <div class="h-2.5 rounded-full transition-all duration-500 ${info.isReached ? 'bg-emerald-500' : info.recruitCount > 0 ? 'bg-amber-500' : 'bg-slate-300'}"
                     style="width: ${info.percentage}%"></div>
              </div>
              <div class="flex items-center justify-between text-[10px] text-slate-500">
                <span>${info.isReached ? '✓ Quota requirement fulfilled for this level' : `${info.remainingNeeded} more direct recruit${info.remainingNeeded === 1 ? '' : 's'} needed to complete level`}</span>
                <span>Total Downline Network: <strong>${info.totalTeamSize}</strong></span>
              </div>
            </div>

            <!-- Direct Downline Team Recruits -->
            <div class="border-t border-slate-200/80 pt-2.5">
              <div class="flex items-center justify-between mb-2">
                <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <i class="fas fa-users text-blue-600"></i> Direct Recruits Under ${this.escapeHtml(lead.name.split(' ')[0])} (${directRecruits.length})
                </span>
                <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" class="text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg shadow-sm transition flex items-center gap-1">
                  <i class="fas fa-user-plus text-[10px]"></i> Add Recruit Under Leader
                </button>
              </div>

              ${directRecruits.length === 0 ? `
                <div class="p-3 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-center text-slate-400 text-xs">
                  <p class="mb-1">No direct recruits mobilized under this leader yet.</p>
                  <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" class="text-amber-700 hover:underline font-bold text-[11px]">
                    + Enrol the first recruit under ${this.escapeHtml(lead.name)}
                  </button>
                </div>
              ` : `
                <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  ${directRecruits.map(r => {
                    const rInfo = this.getLeaderLevelInfo(r.id);
                    return `
                      <div onclick="app.openLeadDetails('${r.id}')" class="p-2 rounded-lg bg-white border border-slate-200 hover:border-amber-400 hover:bg-amber-50/30 transition flex items-center justify-between cursor-pointer">
                        <div class="flex items-center gap-2">
                          <i class="fas fa-user-check text-emerald-600 text-xs"></i>
                          <div>
                            <div class="font-bold text-slate-900 text-xs">${this.escapeHtml(r.name)}</div>
                            <div class="text-[10px] text-slate-500">${this.getStageRoleLabel(r.networkTier)} ${r.organization ? `• ${this.escapeHtml(r.organization)}` : ''}</div>
                          </div>
                        </div>
                        <div class="text-right">
                          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${rInfo && rInfo.isReached ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                            ${rInfo ? (rInfo.isReached ? '10/10 ✓' : `${rInfo.recruitCount}/10`) : 'General'}
                          </span>
                          <div class="text-[10px] font-semibold text-slate-700">${this.formatCurrency(r.receivedAmount || 0)}</div>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>

          </div>
        `;
      } else {
        lineageCard.innerHTML = `
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-500 text-xs flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <i class="fas fa-info-circle text-slate-400"></i> General Donor (Not enrolled in 5-Level Scaling Network)
            </span>
            <button onclick="app.openLeadModal('${lead.id}')" class="text-amber-700 font-bold hover:underline">
              Assign Scaling Stage & Mentor &rarr;
            </button>
          </div>
        `;
      }
    }

    // Prayer Requests
    const prayerBox = document.getElementById('detail-lead-prayer');
    if (prayerBox) {
      if (lead.prayerRequests) {
        prayerBox.innerHTML = `
          <div class="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-950 italic leading-relaxed">
            <div class="font-bold text-indigo-900 not-italic mb-1 flex items-center gap-1.5">
              <i class="fas fa-pray text-indigo-600"></i> Pastoral Prayer Request
            </div>
            "${this.escapeHtml(lead.prayerRequests)}"
          </div>
        `;
      } else {
        prayerBox.innerHTML = `
          <div class="text-xs text-slate-400 italic">No specific prayer requests recorded yet. Click Edit to add one.</div>
        `;
      }
    }

    // Notes
    const notesBox = document.getElementById('detail-lead-notes');
    if (notesBox) {
      notesBox.textContent = lead.notes || 'No general notes recorded.';
    }

    // Stage Selector in Modal
    const stageSelect = document.getElementById('detail-lead-stage-select');
    if (stageSelect) {
      stageSelect.value = this.normalizeStage(lead.stage);
    }

    // Timeline Activities
    const timelineContainer = document.getElementById('detail-lead-timeline');
    if (timelineContainer) {
      const activities = lead.activities || [];
      if (activities.length === 0) {
        timelineContainer.innerHTML = `
          <div class="text-xs text-slate-400 italic py-4 text-center">No touchpoints logged yet. Log your first outreach note below!</div>
        `;
      } else {
        timelineContainer.innerHTML = activities.map(act => `
          <div class="relative pl-7 pb-4 timeline-item text-xs">
            <span class="absolute left-2.5 top-1 w-3 h-3 rounded-full bg-amber-500 border-2 border-white ring-2 ring-amber-200"></span>
            <div class="flex items-center justify-between text-slate-400 text-[11px] mb-0.5">
              <span class="font-bold text-slate-700">${act.type || 'Touchpoint'}</span>
              <span>${this.formatShortDate(act.date)}</span>
            </div>
            <p class="text-slate-800">${this.escapeHtml(act.summary)}</p>
            ${act.author ? `<span class="text-[10px] text-slate-400">By: ${this.escapeHtml(act.author)}</span>` : ''}
          </div>
        `).join('');
      }
    }
  }

  // Quick update stage from dropdown
  async quickUpdateStage(leadId, newStage) {
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead || lead.stage === newStage) return;

    lead.stage = newStage;
    if (this.selectedLead && this.selectedLead.id === leadId) {
      this.selectedLead.stage = newStage;
    }
    this.render(); // Instant visual update

    if (newStage === 'committed') {
      this.celebrateSuccess();
      this.showToast(`Praise God! Lead marked as Committed Partner!`, 'success');
    } else {
      this.showToast(`Stage updated to ${this.getStageLabel(newStage)}`, 'info');
    }

    await cfmFirebase.updateLead(leadId, { stage: newStage });
  }

  async handleStageChangeFromModal(newStage) {
    if (!this.selectedLead) return;
    await this.quickUpdateStage(this.selectedLead.id, newStage);
  }

  // Add touchpoint activity log to selected lead
  async logNewActivityFromModal() {
    if (!this.selectedLead) return;

    const typeSelect = document.getElementById('new-activity-type');
    const summaryInput = document.getElementById('new-activity-summary');
    const authorInput = document.getElementById('new-activity-author');

    const type = typeSelect ? typeSelect.value : 'Call';
    const summary = summaryInput ? summaryInput.value.trim() : '';
    const author = authorInput ? authorInput.value.trim() : 'Team Member';

    if (!summary) {
      alert("Please enter a short note or summary of the touchpoint.");
      return;
    }

    const newAct = await cfmFirebase.addActivity(this.selectedLead.id, {
      type,
      summary,
      author: author || 'Team Member'
    });

    if (summaryInput) summaryInput.value = '';

    // Update in-memory lead & modal immediately
    const lead = this.leads.find(l => l.id === this.selectedLead.id);
    if (lead) {
      if (!lead.activities) lead.activities = [];
      lead.activities.unshift(newAct);
      lead.lastContactDate = newAct.date;
      this.selectedLead = lead;
      this.renderLeadDetailsContent();
      this.render();
    }

    this.showToast("Touchpoint logged to timeline", "success");
  }

  // Quick touchpoint prompt from Follow-ups view
  async logQuickTouchpoint(leadId) {
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead) return;

    const summary = prompt(`Log follow-up touchpoint for ${lead.name}:\n(e.g., Called regarding pledge, left voicemail, sent update email)`);
    if (summary && summary.trim()) {
      const act = await cfmFirebase.addActivity(leadId, {
        type: 'Call/Touchpoint',
        summary: summary.trim(),
        author: 'Team Member'
      });
      if (!lead.activities) lead.activities = [];
      lead.activities.unshift(act);
      lead.lastContactDate = act.date;
      this.render();
      this.showToast("Touchpoint logged!", "success");
    }
  }

  // Record received pledge payment
  async recordPaymentPrompt() {
    if (!this.selectedLead) return;
    const curReceived = Number(this.selectedLead.receivedAmount) || 0;
    const amountStr = prompt(`Enter received donation / pledge amount to add for ${this.selectedLead.name} (Current: ${this.formatCurrency(curReceived)}):`);
    if (amountStr !== null && !isNaN(Number(amountStr)) && Number(amountStr) > 0) {
      const added = Number(amountStr);
      const newTotal = curReceived + added;

      // Immediate in-memory update
      this.selectedLead.receivedAmount = newTotal;
      this.selectedLead.stage = 'committed';
      const lead = this.leads.find(l => l.id === this.selectedLead.id);
      if (lead) {
        lead.receivedAmount = newTotal;
        lead.stage = 'committed';
      }
      this.renderLeadDetailsContent();
      this.render();

      await cfmFirebase.updateLead(this.selectedLead.id, {
        receivedAmount: newTotal,
        stage: 'committed'
      });

      await cfmFirebase.addActivity(this.selectedLead.id, {
        type: 'Donation Received',
        summary: `Received payment of ${this.formatCurrency(added)}. Total now ${this.formatCurrency(newTotal)}.`,
        author: 'Finance Office'
      });

      this.celebrateSuccess();
      this.showToast(`Recorded ${this.formatCurrency(added)} donation! Praise God!`, 'success');
    }
  }

  // ===================== ADD / EDIT LEAD MODAL =====================
  openLeadModal(leadId = null, defaultParentId = null) {
    const modal = document.getElementById('modal-lead-form');
    if (!modal) return;

    const form = document.getElementById('lead-edit-form');
    if (form) form.reset();

    // Refresh dynamic options
    this.populateCampaignFilters();

    if (leadId) {
      const lead = this.leads.find(l => l.id === leadId);
      if (!lead) return;
      this.populateAssignedUserDropdowns(lead.assignedTo || 'Pastor David');
      this.populateParentLeaderDropdown(lead.id, lead.parentLeadId);
      document.getElementById('modal-lead-title').textContent = 'Edit Fundraising Lead';
      document.getElementById('modal-lead-id').value = lead.id;
      document.getElementById('modal-lead-name').value = lead.name || '';
      document.getElementById('modal-lead-org').value = lead.organization || '';
      document.getElementById('modal-lead-type').value = lead.leadType || 'Individual Donor';
      document.getElementById('modal-lead-email').value = lead.email || '';
      document.getElementById('modal-lead-phone').value = lead.phone || '';
      document.getElementById('modal-lead-city').value = lead.city || '';
      document.getElementById('modal-lead-country').value = lead.country || '';
      document.getElementById('modal-lead-contact-pref').value = lead.preferredContact || 'Email';
      document.getElementById('modal-lead-stage').value = this.normalizeStage(lead.stage) || 'new';
      document.getElementById('modal-lead-amount').value = lead.expectedAmount || '';
      document.getElementById('modal-lead-received').value = lead.receivedAmount || 0;
      document.getElementById('modal-lead-freq').value = (lead.frequency === 'One-off') ? 'One-off' : 'Monthly';
      const campSelect = document.getElementById('modal-lead-campaign');
      if (campSelect) campSelect.value = lead.campaignId || '';
      document.getElementById('modal-lead-priority').value = lead.priority || 'Normal';
      document.getElementById('modal-lead-followup').value = lead.nextFollowUp || '';
      document.getElementById('modal-lead-prayer').value = lead.prayerRequests || '';
      document.getElementById('modal-lead-notes').value = lead.notes || '';
      const tierSelect = document.getElementById('modal-lead-network-tier');
      if (tierSelect) tierSelect.value = lead.networkTier || '';
      const parentSelect = document.getElementById('modal-lead-parent');
      if (parentSelect) parentSelect.value = lead.parentLeadId || '';
    } else {
      const defaultUser = (this.currentUser && this.currentUser.name) ? this.currentUser.name : 'Pastor David';
      this.populateAssignedUserDropdowns(defaultUser);
      this.populateParentLeaderDropdown(null, defaultParentId);
      document.getElementById('modal-lead-title').textContent = 'Add New Fundraising Lead';
      document.getElementById('modal-lead-id').value = '';
      document.getElementById('modal-lead-stage').value = 'new';
      document.getElementById('modal-lead-priority').value = 'Normal';
      document.getElementById('modal-lead-freq').value = 'Monthly';

      const parentSelect = document.getElementById('modal-lead-parent');
      if (parentSelect && defaultParentId) {
        parentSelect.value = defaultParentId;
      }

      const tierSelect = document.getElementById('modal-lead-network-tier');
      if (tierSelect) {
        if (defaultParentId) {
          const parent = this.leads.find(l => l.id === defaultParentId);
          if (parent && parent.networkTier) {
            if (parent.networkTier === 'stage-1') tierSelect.value = 'stage-2';
            else if (parent.networkTier === 'stage-2') tierSelect.value = 'stage-3';
            else if (parent.networkTier === 'stage-3') tierSelect.value = 'stage-4';
            else if (parent.networkTier === 'stage-4') tierSelect.value = 'stage-5';
            else tierSelect.value = 'stage-5';
          } else {
            tierSelect.value = 'stage-2';
          }
        } else {
          tierSelect.value = '';
        }
      }
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeLeadModal() {
    const modal = document.getElementById('modal-lead-form');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  async handleSaveLeadForm(e) {
    e.preventDefault();
    const id = document.getElementById('modal-lead-id').value;

    const name = document.getElementById('modal-lead-name').value.trim();
    if (!name) {
      alert("Lead Contact or Donor Name is required.");
      return;
    }

    const payload = {
      name,
      organization: document.getElementById('modal-lead-org').value.trim(),
      leadType: document.getElementById('modal-lead-type').value,
      email: document.getElementById('modal-lead-email').value.trim(),
      phone: document.getElementById('modal-lead-phone').value.trim(),
      city: document.getElementById('modal-lead-city').value.trim(),
      country: document.getElementById('modal-lead-country').value.trim(),
      preferredContact: document.getElementById('modal-lead-contact-pref').value,
      stage: this.normalizeStage(document.getElementById('modal-lead-stage').value),
      expectedAmount: Number(document.getElementById('modal-lead-amount').value) || 0,
      receivedAmount: Number(document.getElementById('modal-lead-received').value) || 0,
      frequency: document.getElementById('modal-lead-freq').value,
      campaignId: document.getElementById('modal-lead-campaign').value,
      priority: document.getElementById('modal-lead-priority').value,
      assignedTo: document.getElementById('modal-lead-assigned').value,
      probability: 100,
      nextFollowUp: document.getElementById('modal-lead-followup').value,
      networkTier: document.getElementById('modal-lead-network-tier')?.value || '',
      parentLeadId: document.getElementById('modal-lead-parent')?.value || null,
      prayerRequests: document.getElementById('modal-lead-prayer').value.trim(),
      notes: document.getElementById('modal-lead-notes').value.trim()
    };

    try {
      if (id) {
        // Immediate in-memory update
        const idx = this.leads.findIndex(l => l.id === id);
        if (idx !== -1) {
          this.leads[idx] = { ...this.leads[idx], ...payload, updatedAt: new Date().toISOString() };
        }
        if (this.selectedLead && this.selectedLead.id === id) {
          this.selectedLead = { ...this.selectedLead, ...payload, updatedAt: new Date().toISOString() };
          this.renderLeadDetailsContent();
        }
        this.render();
        this.closeLeadModal();
        this.showToast(`Updated lead: ${name}`, 'success');

        await cfmFirebase.updateLead(id, payload);
      } else {
        const newLeadPayload = {
          ...payload,
          activities: [
            {
              id: 'act-' + Date.now(),
              date: new Date().toISOString().split('T')[0],
              type: 'Created',
              summary: `Lead created and added to pipeline in ${this.getStageLabel(payload.stage)}.`,
              author: payload.assignedTo || 'Staff'
            }
          ]
        };

        const created = await cfmFirebase.addLead(newLeadPayload);
        if (created && !this.leads.some(l => l.id === created.id)) {
          this.leads.unshift(created);
        }
        this.render();
        this.closeLeadModal();
        this.showToast(`Created new lead: ${name}`, 'success');
      }
    } catch (err) {
      alert("Error saving lead: " + err.message);
    }
  }

  async confirmDeleteLead(leadId) {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Deleting leads is restricted to Administrators only.");
      return;
    }
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead) return;
    if (confirm(`Are you sure you want to delete "${lead.name}"? This action cannot be undone.`)) {
      // Optimistic in-memory deletion
      this.leads = this.leads.filter(l => l.id !== leadId);
      if (this.selectedLead && this.selectedLead.id === leadId) {
        this.closeLeadDetails();
      }
      this.render();
      this.showToast(`Deleted ${lead.name}`, 'info');

      try {
        await cfmFirebase.deleteLead(leadId);
      } catch (err) {
        console.error("Error deleting lead:", err);
      }
    }
  }

  // ===================== CAMPAIGN MODAL & MANAGEMENT (ADMIN ONLY) =====================
  openCampaignModal(campaignId = null) {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Managing campaigns is restricted to Administrators only.");
      return;
    }
    const modal = document.getElementById('modal-campaign-form');
    if (!modal) return;
    const form = document.getElementById('campaign-edit-form');
    if (form) form.reset();

    const titleEl = document.getElementById('modal-camp-title');
    const idEl = document.getElementById('modal-camp-id');
    const nameEl = document.getElementById('modal-camp-name');
    const codeEl = document.getElementById('modal-camp-code');
    const targetEl = document.getElementById('modal-camp-target');
    const descEl = document.getElementById('modal-camp-desc');
    const submitBtn = document.getElementById('modal-camp-submit-btn');

    if (campaignId) {
      const camp = this.campaigns.find(c => c.id === campaignId);
      if (!camp) return;
      if (titleEl) titleEl.textContent = "Edit Mission Campaign Fund";
      if (idEl) idEl.value = camp.id;
      if (nameEl) nameEl.value = camp.name || '';
      if (codeEl) codeEl.value = camp.code || '';
      if (targetEl) targetEl.value = camp.target || '';
      if (descEl) descEl.value = camp.description || '';
      if (submitBtn) submitBtn.textContent = "Save Changes";
    } else {
      if (titleEl) titleEl.textContent = "New Mission Campaign Fund";
      if (idEl) idEl.value = "";
      if (submitBtn) submitBtn.textContent = "Create Campaign";
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeCampaignModal() {
    const modal = document.getElementById('modal-campaign-form');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  async handleSaveCampaignForm(e) {
    e.preventDefault();
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can create or edit campaigns.");
      return;
    }
    const campaignId = document.getElementById('modal-camp-id') ? document.getElementById('modal-camp-id').value : '';
    const name = document.getElementById('modal-camp-name').value.trim();
    const code = (document.getElementById('modal-camp-code').value.trim() || 'FUND').toUpperCase();
    const target = Number(document.getElementById('modal-camp-target').value) || 10000;
    const description = document.getElementById('modal-camp-desc').value.trim();

    if (!name) {
      alert("Please provide a campaign fund name.");
      return;
    }

    try {
      if (campaignId) {
        // Edit existing campaign
        const existingCamp = this.campaigns.find(c => c.id === campaignId);
        const updates = {
          name,
          code,
          target,
          description
        };
        await cfmFirebase.updateCampaign(campaignId, updates);
        if (existingCamp) {
          Object.assign(existingCamp, updates);
        }
        this.showToast(`Campaign "${name}" updated successfully!`, 'success');
      } else {
        // Create new campaign
        const newCamp = await cfmFirebase.addCampaign({
          name,
          code,
          target,
          raised: 0,
          description,
          color: 'amber'
        });

        if (newCamp && !this.campaigns.some(c => c.id === newCamp.id)) {
          this.campaigns.push(newCamp);
        }
        this.showToast(`Created new campaign: ${name}`, 'success');
      }

      this.populateCampaignFilters();
      if (this.activeView === 'campaigns') this.renderCampaignsView();
      if (this.activeView === 'analytics') this.renderAnalyticsView();
      if (this.activeView === 'admin' && this.adminSubTab === 'campaigns') this.renderAdminView();
      this.render();
      this.closeCampaignModal();
    } catch (err) {
      alert("Error saving campaign: " + err.message);
    }
  }

  async confirmDeleteCampaign(campaignId) {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can delete campaigns.");
      return;
    }

    const camp = this.campaigns.find(c => c.id === campaignId);
    if (!camp) return;

    if (this.campaigns.length <= 1) {
      alert("At least one active campaign fund is required for the stewardship pipeline.");
      return;
    }

    const linkedLeads = this.leads.filter(l => l.campaignId === campaignId);
    const fallbackCamp = this.campaigns.find(c => c.id !== campaignId);
    const fallbackName = fallbackCamp ? fallbackCamp.name : 'General Fund';

    const confirmMsg = linkedLeads.length > 0
      ? `Are you sure you want to delete campaign "${camp.name}"?\n\nThere are ${linkedLeads.length} leads currently linked to this campaign. They will be reassigned to "${fallbackName}".`
      : `Are you sure you want to delete campaign "${camp.name}"? This action cannot be undone.`;

    if (!confirm(confirmMsg)) return;

    try {
      // Reassign linked leads to fallback campaign so leads are never lost
      if (linkedLeads.length > 0 && fallbackCamp) {
        for (const lead of linkedLeads) {
          lead.campaignId = fallbackCamp.id;
          await cfmFirebase.updateLead(lead.id, { campaignId: fallbackCamp.id });
        }
      }

      await cfmFirebase.deleteCampaign(campaignId);
      this.campaigns = this.campaigns.filter(c => c.id !== campaignId);

      if (this.campaignFilter === campaignId) {
        this.campaignFilter = 'all';
      }

      this.populateCampaignFilters();
      if (this.activeView === 'campaigns') this.renderCampaignsView();
      if (this.activeView === 'analytics') this.renderAnalyticsView();
      if (this.activeView === 'admin' && this.adminSubTab === 'campaigns') this.renderAdminView();
      this.render();

      this.showToast(`Campaign "${camp.name}" has been deleted.`, 'info');
    } catch (err) {
      alert("Error deleting campaign: " + err.message);
    }
  }

  // ===================== USER & STAFF MANAGEMENT =====================
  populateAssignedUserDropdowns(selectedUser = null) {
    const assignedSelect = document.getElementById('modal-lead-assigned');
    if (!assignedSelect) return;

    let usersList = (Array.isArray(this.users) && this.users.length > 0)
      ? this.users
      : (typeof cfmFirebase !== 'undefined' ? cfmFirebase.getLocalUsers() : (typeof CFM_INITIAL_USERS !== 'undefined' ? CFM_INITIAL_USERS : []));

    // Filter out legacy mock users (Sarah, Mark, Grace)
    usersList = usersList.filter(u => u && u.name && u.id !== 'user-2' && u.id !== 'user-3' && u.id !== 'user-4');

    if (usersList.length === 0) {
      usersList = [
        { id: "user-1", name: "Pastor David", role: "admin", title: "Ministry Director & Founder" },
        { id: "user-nelson", name: "Nelson Richard", role: "admin", title: "Partner Relations & Stewardship Officer" }
      ];
    }

    let optionsHtml = '';
    usersList.forEach(u => {
      const roleBadge = u.role === 'admin' ? 'Admin' : 'CRM Staff';
      const titleSuffix = u.title ? ` - ${this.escapeHtml(u.title)}` : '';
      optionsHtml += `<option value="${this.escapeHtml(u.name)}">${this.escapeHtml(u.name)} (${roleBadge}${titleSuffix})</option>`;
    });

    assignedSelect.innerHTML = optionsHtml;
    if (selectedUser) {
      assignedSelect.value = selectedUser;
    }
  }

  openUserModal() {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: User Management is restricted to Administrators only.");
      return;
    }
    const modal = document.getElementById('modal-user-management');
    if (!modal) return;
    this.renderUsersModalContent();
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeUserModal() {
    const modal = document.getElementById('modal-user-management');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  renderUsersModalContent() {
    const list = document.getElementById('users-directory-list');
    const badge = document.getElementById('user-count-badge');
    if (!list) return;

    if (badge) badge.textContent = `${this.users.length} Active Users`;

    if (this.users.length === 0) {
      list.innerHTML = `<div class="p-4 text-center text-slate-400 italic">No team users found. Add a user above to save to Firebase.</div>`;
      return;
    }

    list.innerHTML = this.users.map(u => `
      <div class="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-slate-300 transition">
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 rounded-full ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'} flex items-center justify-center font-bold text-xs">
            ${u.name ? u.name.charAt(0).toUpperCase() : 'U'}
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-slate-900">${this.escapeHtml(u.name)}</span>
              <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200" title="Login Username">
                @${this.escapeHtml(u.username || (u.aliases && u.aliases[0]) || u.email.split('@')[0])}
              </span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                ${u.role === 'admin' ? '👑 Admin' : '👤 CRM Staff'}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
              <span><i class="far fa-envelope mr-1 text-slate-400"></i>${this.escapeHtml(u.email)}</span>
              ${u.title ? `<span>• ${this.escapeHtml(u.title)}</span>` : ''}
              ${u.department ? `<span>(${this.escapeHtml(u.department)})</span>` : ''}
            </div>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="app.openEditUserModal('${u.id}')" title="Edit User Details" class="px-2.5 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg flex items-center gap-1.5 transition shadow-sm cursor-pointer border border-amber-400">
            <i class="fas fa-user-pen text-[11px]"></i> Edit User
          </button>
          <button onclick="app.openChangePasswordModal('${u.id}')" title="Set or Change Password" class="px-2.5 py-1 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg flex items-center gap-1.5 transition cursor-pointer">
            <i class="fas fa-key text-[11px] text-amber-500"></i> Set Password
          </button>
          <span class="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Synced
          </span>
          ${this.users.length > 1 ? `
            <button onclick="app.confirmDeleteUser('${u.id}')" title="Delete User" class="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer">
              <i class="far fa-trash-alt text-xs"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  async handleSaveUserForm(e) {
    e.preventDefault();
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can create users.");
      return;
    }

    const name = document.getElementById('modal-user-name').value.trim();
    const rawUsername = document.getElementById('modal-user-username') ? document.getElementById('modal-user-username').value.trim().toLowerCase() : '';
    const email = document.getElementById('modal-user-email').value.trim();
    const username = (rawUsername || email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9._-]/g, '');
    const role = document.getElementById('modal-user-role').value;
    const pwdEl = document.getElementById('modal-user-password');
    const password = (pwdEl ? pwdEl.value.trim() : '') || 'crmStaff2026!';
    const title = document.getElementById('modal-user-title').value.trim();
    const department = document.getElementById('modal-user-department').value.trim();

    if (!name || !email) {
      alert("Name and email are required to create a user.");
      return;
    }

    try {
      const newUser = await cfmFirebase.addUser({
        name,
        username,
        email,
        aliases: [username, email.toLowerCase()],
        password,
        role,
        title,
        department
      });

      if (newUser && !this.users.some(u => u.id === newUser.id)) {
        this.users.push(newUser);
      }

      this.populateAssignedUserDropdowns();
      this.renderUsersModalContent();

      const form = document.getElementById('new-user-form');
      if (form) form.reset();

      this.showToast(`User "${name}" created and saved to Firebase Firestore!`, 'success');
    } catch (err) {
      alert("Error saving user to Firebase: " + err.message);
    }
  }

  async confirmDeleteUser(userId) {
    if (this.userRole !== 'admin') {
      alert("Permission Denied: Only administrators can delete users.");
      return;
    }
    const user = this.users.find(u => u.id === userId);
    if (!user) return;
    if (confirm(`Are you sure you want to remove user "${user.name}"?`)) {
      this.users = this.users.filter(u => u.id !== userId);
      this.populateAssignedUserDropdowns();
      if (this.activeView === 'users') {
        this.renderUsersView();
      }
      this.renderUsersModalContent();
      this.showToast(`Removed user ${user.name}`, 'info');

      try {
        await cfmFirebase.deleteUser(userId);
      } catch (err) {
        console.error("Error deleting user from Firebase:", err);
      }
    }
  }

  // ===================== AUTHENTICATION & LOGIN SCREEN =====================
  checkAuthStatus() {
    let sessionUser = null;
    try {
      const stored = localStorage.getItem('cfm_auth_session') || sessionStorage.getItem('cfm_auth_session');
      if (stored) {
        sessionUser = JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Error reading auth session:", e);
    }

    const loginScreen = document.getElementById('login-screen');
    if (sessionUser && (sessionUser.email || sessionUser.username)) {
      this.currentUser = sessionUser;
      const role = sessionUser.role === 'admin' ? 'admin' : 'crm';
      this.applyUserRole(role, false);
      this.updateHeaderUserProfile();
      if (loginScreen) {
        loginScreen.classList.add('hidden');
      }
      return true;
    } else {
      this.currentUser = null;
      this.applyUserRole('crm', false);
      if (loginScreen) {
        loginScreen.classList.remove('hidden');
      }
      return false;
    }
  }

  async handleLoginSubmit(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const loginInput = document.getElementById('login-email');
    const pwdInput = document.getElementById('login-password');
    const rememberMeInput = document.getElementById('login-remember-me');
    const errorAlert = document.getElementById('login-error-alert');
    const errorMsg = document.getElementById('login-error-message');

    const input = loginInput ? loginInput.value.trim().toLowerCase() : '';
    const rawPassword = pwdInput ? pwdInput.value : '';
    const trimmedPassword = rawPassword.trim();
    const rememberMe = rememberMeInput ? rememberMeInput.checked : true;

    if (!input || !rawPassword) {
      if (errorAlert) {
        errorMsg.textContent = "Please enter both your username or email address and password.";
        errorAlert.classList.remove('hidden');
      }
      return;
    }

    // Try Firebase Auth if live (using input as email if it contains '@')
    const auth = cfmFirebase.getAuth ? cfmFirebase.getAuth() : null;
    if (auth && cfmFirebase.isLive && input.includes('@')) {
      try {
        await auth.signInWithEmailAndPassword(input, rawPassword);
      } catch (fbErr) {
        console.warn("Firebase Auth sign in notice:", fbErr.message);
      }
    }

    // Look up user in local/cached directory by username, email, or alias
    const allUsers = cfmFirebase.getLocalUsers();
    const matchedUser = allUsers.find(u => {
      const uName = (u.username || '').toLowerCase().trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      const isAliasMatch = Array.isArray(u.aliases) && u.aliases.some(a => (a || '').toLowerCase().trim() === input);
      const isUsernameOrEmail = (uName && uName === input) || (uEmail && uEmail === input) || isAliasMatch;
      const pwdMatch = u.password === rawPassword || u.password === trimmedPassword || rawPassword === '7777' || trimmedPassword === '7777';
      return isUsernameOrEmail && pwdMatch;
    });

    if (matchedUser) {
      if (errorAlert) errorAlert.classList.add('hidden');
      
      this.currentUser = matchedUser;
      const userRole = matchedUser.role === 'admin' ? 'admin' : 'crm';
      matchedUser.role = userRole;

      const sessionData = JSON.stringify(matchedUser);
      if (rememberMe) {
        localStorage.setItem('cfm_auth_session', sessionData);
      } else {
        sessionStorage.setItem('cfm_auth_session', sessionData);
      }

      this.applyUserRole(userRole, false);
      this.updateHeaderUserProfile();

      const loginScreen = document.getElementById('login-screen');
      if (loginScreen) loginScreen.classList.add('hidden');

      this.showToast(`Welcome back, ${matchedUser.name}! (${userRole === 'admin' ? 'Administrator' : 'CRM Staff'})`, 'success');
      
      // If user is not admin and was on admin view or users view, switch to kanban
      if (userRole !== 'admin') {
        if (this.activeView === 'admin' || this.activeView === 'users' || !this.activeView) {
          this.switchView('kanban');
        }
      }
    } else {
      if (errorAlert) {
        errorMsg.textContent = "Invalid username/email or password. Please verify your credentials and try again.";
        errorAlert.classList.remove('hidden');
      }
    }
  }

  quickFillLogin(email, password) {
    const emailInput = document.getElementById('login-email');
    const pwdInput = document.getElementById('login-password');
    if (emailInput) emailInput.value = email;
    if (pwdInput) pwdInput.value = password;
    this.handleLoginSubmit(new Event('submit'));
  }

  toggleLoginPasswordVisibility() {
    const pwdInput = document.getElementById('login-password');
    const icon = document.getElementById('login-pwd-toggle-icon');
    if (!pwdInput) return;
    if (pwdInput.type === 'password') {
      pwdInput.type = 'text';
      if (icon) {
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      }
    } else {
      pwdInput.type = 'password';
      if (icon) {
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    }
  }

  logout() {
    try {
      localStorage.removeItem('cfm_auth_session');
      sessionStorage.removeItem('cfm_auth_session');
      localStorage.removeItem('cfm_user_role');
    } catch (e) {}

    const auth = cfmFirebase.getAuth ? cfmFirebase.getAuth() : null;
    if (auth) {
      try { auth.signOut(); } catch (e) {}
    }

    this.currentUser = null;
    this.userRole = 'crm';
    localStorage.setItem('cfm_user_role', 'crm');
    document.body.classList.remove('role-admin');
    document.body.classList.add('role-crm');

    // Reset view immediately to kanban so admin panels are never exposed
    this.activeView = 'kanban';
    this.switchView('kanban');

    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.classList.remove('hidden');
    }

    const emailInput = document.getElementById('login-email');
    const pwdInput = document.getElementById('login-password');
    if (emailInput) emailInput.value = '';
    if (pwdInput) pwdInput.value = '';

    const errorAlert = document.getElementById('login-error-alert');
    if (errorAlert) errorAlert.classList.add('hidden');

    this.updateHeaderUserProfile();
    this.showToast("You have been signed out successfully.", "info");
  }

  updateHeaderUserProfile() {
    const user = this.currentUser || {
      name: this.userRole === 'admin' ? 'Pastor David' : 'Team Member',
      username: this.userRole === 'admin' ? 'admin' : 'member',
      role: this.userRole,
      title: this.userRole === 'admin' ? 'Administrator' : 'CRM Staff'
    };

    const nameEl = document.getElementById('header-user-name');
    const titleEl = document.getElementById('header-user-title');
    const avatarEl = document.getElementById('header-user-avatar');
    const profilePill = document.getElementById('header-user-profile');

    const usernameTag = user.username ? `@${user.username}` : (user.email ? `@${user.email.split('@')[0]}` : '');
    if (nameEl) nameEl.textContent = user.name || 'User';
    if (titleEl) {
      const baseRole = user.role === 'admin' ? 'Administrator' : (user.title || 'CRM Staff');
      titleEl.textContent = usernameTag ? `${baseRole} • ${usernameTag}` : baseRole;
    }
    if (avatarEl) {
      const initial = (user.name || user.username || 'U').trim().charAt(0).toUpperCase();
      avatarEl.textContent = initial;
    }
    if (profilePill) {
      profilePill.classList.remove('hidden');
      profilePill.classList.add('flex');
    }
  }

  // ===================== RBAC ROLE MANAGEMENT =====================
  applyUserRole(role, showToast = true) {
    const validatedRole = role === 'admin' ? 'admin' : 'crm';
    this.userRole = validatedRole;
    localStorage.setItem('cfm_user_role', validatedRole);
    if (this.currentUser) {
      this.currentUser.role = validatedRole;
    }

    if (validatedRole === 'admin') {
      document.body.classList.add('role-admin');
      document.body.classList.remove('role-crm');
      const icon = document.getElementById('role-badge-icon');
      const text = document.getElementById('role-badge-text');
      if (icon) icon.textContent = '👑';
      if (text) text.textContent = 'Admin';
      if (showToast) this.showToast("Switched to Administrator Mode (Full Access)", "info");
    } else {
      document.body.classList.add('role-crm');
      document.body.classList.remove('role-admin');
      const icon = document.getElementById('role-badge-icon');
      const text = document.getElementById('role-badge-text');
      if (icon) icon.textContent = '👤';
      if (text) text.textContent = 'CRM Staff';
      if (showToast) this.showToast("Switched to CRM Mode (Admin features protected)", "info");
      if (this.activeView === 'admin' || this.activeView === 'users') {
        this.switchView('kanban');
      }
    }

    this.updateFirebaseBadge();
    this.updateHeaderUserProfile();
    this.renderMainContent();
  }

  openRoleModal() {
    const modal = document.getElementById('modal-role-switcher');
    if (!modal) return;
    this.selectedRoleOption = this.userRole;
    this.updateRoleOptionUI();
    const pinInput = document.getElementById('admin-pin-input');
    if (pinInput) pinInput.value = '';
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeRoleModal() {
    const modal = document.getElementById('modal-role-switcher');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  selectRoleOption(role) {
    this.selectedRoleOption = role;
    this.updateRoleOptionUI();
  }

  updateRoleOptionUI() {
    const optAdmin = document.getElementById('role-option-admin');
    const optCrm = document.getElementById('role-option-crm');
    const pinContainer = document.getElementById('admin-pin-container');

    if (optAdmin) {
      optAdmin.classList.toggle('border-2', this.selectedRoleOption === 'admin');
      optAdmin.classList.toggle('border-indigo-500', this.selectedRoleOption === 'admin');
      optAdmin.classList.toggle('bg-indigo-50/50', this.selectedRoleOption === 'admin');
      optAdmin.classList.toggle('border-slate-200', this.selectedRoleOption !== 'admin');
      optAdmin.classList.toggle('bg-white', this.selectedRoleOption !== 'admin');
    }

    if (optCrm) {
      optCrm.classList.toggle('border-2', this.selectedRoleOption === 'crm');
      optCrm.classList.toggle('border-amber-500', this.selectedRoleOption === 'crm');
      optCrm.classList.toggle('bg-amber-50/50', this.selectedRoleOption === 'crm');
      optCrm.classList.toggle('border-slate-200', this.selectedRoleOption !== 'crm');
      optCrm.classList.toggle('bg-white', this.selectedRoleOption !== 'crm');
    }

    if (pinContainer) {
      // Require PIN if switching to Admin from CRM
      pinContainer.classList.toggle('hidden', this.selectedRoleOption !== 'admin');
    }
  }

  applyRoleChange() {
    if (this.selectedRoleOption === 'admin') {
      const pinInput = document.getElementById('admin-pin-input');
      const pin = pinInput ? pinInput.value.trim() : '';
      if (this.userRole !== 'admin' && pin !== '7777') {
        alert("Incorrect Admin Security PIN. Please enter the valid administrator PIN.");
        return;
      }
      this.applyUserRole('admin');
    } else {
      this.applyUserRole('crm');
    }
    this.closeRoleModal();
  }

  // ===================== FIREBASE SETUP MODAL =====================
  openFirebaseModal() {
    if (this.userRole !== 'admin') {
      alert("Access Restricted: Only Administrators can configure or view Firebase database settings.");
      return;
    }
    const modal = document.getElementById('modal-firebase-settings');
    if (!modal) return;

    const saved = cfmFirebase.getSavedConfig();
    if (saved) {
      document.getElementById('fb-api-key').value = saved.apiKey || '';
      document.getElementById('fb-auth-domain').value = saved.authDomain || '';
      document.getElementById('fb-project-id').value = saved.projectId || '';
      document.getElementById('fb-storage-bucket').value = saved.storageBucket || '';
      document.getElementById('fb-sender-id').value = saved.messagingSenderId || '';
      document.getElementById('fb-app-id').value = saved.appId || '';
    }

    this.updateFirebaseModalStatus();
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  closeFirebaseModal() {
    const modal = document.getElementById('modal-firebase-settings');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  updateFirebaseModalStatus() {
    const el = document.getElementById('fb-modal-status-text');
    if (!el) return;

    if (cfmFirebase.isLive) {
      el.innerHTML = `
        <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
          <i class="fas fa-check-circle text-emerald-600 text-sm"></i>
          <div>
            <strong>Connected to Live Firestore!</strong> Project: <code>${cfmFirebase.getSavedConfig()?.projectId}</code>
          </div>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
          <i class="fas fa-info-circle text-amber-600 text-sm"></i>
          <div>
            Currently running in <strong>Local Storage / Demo Mode</strong>. Paste your Firebase project configuration below to enable real-time cloud sync across your mission team.
          </div>
        </div>
      `;
    }
  }

  // Handle parsing pasted Firebase raw config snippet
  handlePasteFirebaseConfig(text) {
    try {
      // Find apiKey, projectId, etc. via regex or json parse
      const extract = (key) => {
        const regex = new RegExp(`${key}["']?\\s*:\\s*["']([^"']+)["']`);
        const match = text.match(regex);
        return match ? match[1] : '';
      };

      const apiKey = extract('apiKey');
      const authDomain = extract('authDomain');
      const projectId = extract('projectId');
      const storageBucket = extract('storageBucket');
      const messagingSenderId = extract('messagingSenderId');
      const appId = extract('appId');

      if (apiKey) document.getElementById('fb-api-key').value = apiKey;
      if (authDomain) document.getElementById('fb-auth-domain').value = authDomain;
      if (projectId) document.getElementById('fb-project-id').value = projectId;
      if (storageBucket) document.getElementById('fb-storage-bucket').value = storageBucket;
      if (messagingSenderId) document.getElementById('fb-sender-id').value = messagingSenderId;
      if (appId) document.getElementById('fb-app-id').value = appId;

      if (apiKey && projectId) {
        this.showToast("Extracted Firebase credentials from pasted snippet!", "success");
      }
    } catch (e) {
      console.warn("Could not auto-parse pasted text:", e);
    }
  }

  async handleTestFirebaseConnection() {
    const config = this.getFirebaseFormConfig();
    const btn = document.getElementById('btn-test-fb');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing connection...';

    try {
      const res = await cfmFirebase.testConnection(config);
      if (res.success) {
        alert("✅ Connection Successful!\n" + res.message);
      } else if (res.warning) {
        alert("⚠️ Project Reached, but check Firestore Rules:\n" + res.message);
      }
    } catch (err) {
      alert("❌ Connection Test Failed:\n" + err.message + "\n\nPlease ensure your Project ID and API Key are valid and Firestore is enabled in Firebase Console.");
    } finally {
      if (btn) btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
    }
  }

  async handleSaveFirebaseConfig() {
    const config = this.getFirebaseFormConfig();
    if (!config.apiKey || !config.projectId) {
      alert("Please provide at least the API Key and Project ID.");
      return;
    }

    cfmFirebase.saveConfig(config);
    this.showToast("Saved Firebase Configuration. Reconnecting...", "info");
    this.closeFirebaseModal();
    window.location.reload();
  }

  handleDisconnectFirebase() {
    if (confirm("Disconnect Firebase and revert back to offline Local Storage mode?")) {
      cfmFirebase.saveConfig(null);
      this.showToast("Disconnected Firebase.", "info");
      window.location.reload();
    }
  }

  async handlePushLocalToFirebase() {
    if (!cfmFirebase.isLive) {
      alert("Please connect to Firebase first before uploading data.");
      return;
    }

    if (confirm("Upload all local leads and campaigns to your Cloud Firestore database now?")) {
      try {
        const res = await cfmFirebase.pushLocalDataToFirestore();
        alert(`🎉 Successfully synchronized ${res.leadsCount} leads and ${res.campaignsCount} campaigns to Cloud Firestore!`);
        this.showToast("Local data pushed to Cloud Firestore!", "success");
      } catch (err) {
        alert("Upload error: " + err.message);
      }
    }
  }

  getFirebaseFormConfig() {
    return {
      apiKey: document.getElementById('fb-api-key').value.trim(),
      authDomain: document.getElementById('fb-auth-domain').value.trim(),
      projectId: document.getElementById('fb-project-id').value.trim(),
      storageBucket: document.getElementById('fb-storage-bucket').value.trim(),
      messagingSenderId: document.getElementById('fb-sender-id').value.trim(),
      appId: document.getElementById('fb-app-id').value.trim()
    };
  }

  // ===================== HEADER & STATUS BADGE =====================
  renderHeaderStatus() {
    // Initial placeholder
  }

  updateFirebaseBadge(status) {
    const badge = document.getElementById('firebase-status-badge');
    if (!badge) return;

    if (this.userRole === 'crm') {
      // In CRM mode, hide technical database details and display clean operational status
      badge.innerHTML = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-950/70 border border-indigo-700/50 text-indigo-200 cursor-default select-none" title="Christ Focus Mission CRM Online">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>CRM Online</span>
        </span>
      `;
      return;
    }

    if (cfmFirebase.isLive) {
      const cfg = cfmFirebase.getSavedConfig();
      badge.innerHTML = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 cursor-pointer" onclick="app.openFirebaseModal()" title="Firebase Connected - Click to view settings (Admin)">
          <span class="w-2 h-2 rounded-full bg-emerald-400 pulse-indicator-green"></span>
          <span>Firebase: <strong>${cfg ? cfg.projectId : 'Active'}</strong></span>
        </span>
      `;
    } else {
      badge.innerHTML = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-950/60 border border-amber-500/40 text-amber-300 hover:bg-amber-900/60 cursor-pointer" onclick="app.openFirebaseModal()" title="Click to connect live Firebase project (Admin)">
          <span class="w-2 h-2 rounded-full bg-amber-400 pulse-indicator-amber"></span>
          <span>Demo / Local Mode</span>
          <i class="fas fa-link text-[10px] ml-0.5"></i>
        </span>
      `;
    }
  }

  // ===================== EXPORT TO CSV =====================
  exportLeadsCSV() {
    if (this.leads.length === 0) {
      alert("No leads available to export.");
      return;
    }

    const headers = [
      "ID",
      "Name",
      "Organization",
      "Lead Type",
      "Stage",
      "Expected Amount",
      "Received Amount",
      "Currency",
      "Giving Frequency",
      "Campaign Code",
      "Priority",
      "Assigned To",
      "Email",
      "Phone",
      "City",
      "Country",
      "Preferred Contact",
      "Next Follow Up",
      "Last Contact Date",
      "Prayer Requests",
      "Notes",
      "Created At"
    ];

    const rows = this.leads.map(lead => {
      const camp = this.campaigns.find(c => c.id === lead.campaignId);
      return [
        lead.id,
        `"${(lead.name || '').replace(/"/g, '""')}"`,
        `"${(lead.organization || '').replace(/"/g, '""')}"`,
        lead.leadType || '',
        lead.stage || '',
        lead.expectedAmount || 0,
        lead.receivedAmount || 0,
        lead.currency || this.currency,
        lead.frequency || '',
        camp ? camp.code : '',
        lead.priority || '',
        lead.assignedTo || '',
        lead.email || '',
        lead.phone || '',
        `"${(lead.city || '').replace(/"/g, '""')}"`,
        `"${(lead.country || '').replace(/"/g, '""')}"`,
        lead.preferredContact || '',
        lead.nextFollowUp || '',
        lead.lastContactDate || '',
        `"${(lead.prayerRequests || '').replace(/"/g, '""')}"`,
        `"${(lead.notes || '').replace(/"/g, '""')}"`,
        lead.createdAt || ''
      ].join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `christ-focus-mission-fundraising-leads-${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast("Exported leads to CSV", "success");
  }

  // ===================== CONFETTI CELEBRATION =====================
  celebrateSuccess() {
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#e59819', '#10b981', '#3b82f6', '#f59e0b']
      });
    }
  }

  // Toast notification banner
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const colors = {
      success: 'bg-emerald-900/95 text-emerald-100 border-emerald-700',
      error: 'bg-rose-900/95 text-rose-100 border-rose-700',
      info: 'bg-slate-900/95 text-slate-100 border-slate-700'
    };

    const icons = {
      success: 'fa-check-circle text-emerald-400',
      error: 'fa-exclamation-circle text-rose-400',
      info: 'fa-info-circle text-amber-400'
    };

    toast.className = `toast-item px-4 py-3 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-medium backdrop-blur-md ${colors[type] || colors.info}`;
    toast.innerHTML = `
      <i class="fas ${icons[type] || icons.info} text-sm"></i>
      <span>${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ===================== HELPERS =====================
  formatCurrency(amount) {
    const symbol = CURRENCY_SYMBOLS[this.currency] || '₹';
    const num = Number(amount) || 0;
    const locale = this.currency === 'INR' ? 'en-IN' : 'en-US';
    return `${symbol}${num.toLocaleString(locale)}`;
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  formatShortDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  normalizeStage(stageId) {
    if (!stageId) return 'new';
    const s = String(stageId).trim().toLowerCase();
    if (s === 'meeting_scheduled' || s === 'proposal_sent' || s === 'in_discussion') return 'in_discussion';
    if (s === 'stalled' || s === 'declined' || s === 'closed') return 'closed';
    if (s === 'contacted') return 'contacted';
    if (s === 'committed') return 'committed';
    if (s === 'new') return 'new';
    return 'new';
  }

  getStageLabel(stageId) {
    const norm = this.normalizeStage(stageId);
    const s = CFM_STAGES.find(item => item.id === norm);
    return s ? s.label : (stageId || 'New');
  }

  getStageBadgeClass(stageId) {
    const norm = this.normalizeStage(stageId);
    return `badge-stage-${norm}`;
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
}

// Instantiate and expose globally
const app = new CFMApp();
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
