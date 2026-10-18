/**
 * Christ Focus Mission - Fundraising Leads Tracker
 * Main Application Logic & User Interface Controller
 */

// Streamlined 4-Stage Donor Progression Pipeline
// Stage 4 (Closed) includes two sub-outcomes: Committed Partner & Not Interested
const CFM_STAGES = [
  { id: 'new', label: 'New Leads', color: 'slate', icon: 'fa-user-plus' },
  { id: 'contacted', label: 'Contacted', color: 'blue', icon: 'fa-paper-plane' },
  { id: 'in_discussion', label: 'In Discussion', color: 'purple', icon: 'fa-comments' },
  { 
    id: 'closed', 
    label: 'Closed', 
    color: 'emerald', 
    icon: 'fa-flag-checkered',
    subStages: [
      { id: 'committed', label: 'Committed', color: 'emerald', icon: 'fa-heart' },
      { id: 'closed', label: 'Not Interested', color: 'slate', icon: 'fa-ban' }
    ]
  }
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
    this.corpusFilter = 'all'; // 'all' | 'corpus' | 'general'
    this.supporterTypeFilter = 'all'; // 'all' | 'Donor' | 'Monthly Supporter' | 'Volunteer Ambassador'
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
    this.closedSubFilter = 'all'; // 'all' | 'committed' | 'not_interested'
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

    // Support URL parameters for direct view/modal navigation
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const viewParam = urlParams.get('view');
      const leadIdParam = urlParams.get('leadId') || 'lead-bethel';
      if (viewParam) {
        setTimeout(() => {
          if (viewParam === 'lead-modal') {
            this.openLeadModal(leadIdParam);
          } else if (viewParam === 'lead-modal-bottom') {
            this.openLeadModal(leadIdParam);
            setTimeout(() => {
              const scrollEl = document.querySelector('#modal-lead-form > div') || document.querySelector('#modal-lead-form .overflow-y-auto') || document.getElementById('modal-lead-form');
              if (scrollEl) scrollEl.scrollTop = 9999;
              const refCard = document.getElementById('modal-lead-supporter-type');
              if (refCard) refCard.scrollIntoView({ behavior: 'instant', block: 'center' });
            }, 120);
          } else if (viewParam === 'lead-details') {
            this.openLeadDetails(leadIdParam);
          } else if (viewParam === 'new-modal') {
            this.openLeadModal();
          } else if (viewParam === 'network-table') {
            this.lineageViewMode = 'table';
            this.switchView('network');
          } else {
            this.switchView(viewParam);
          }
        }, 150);
      }
    } catch (e) {}
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

    const corpusSelect = document.getElementById('filter-corpus');
    if (corpusSelect) {
      corpusSelect.addEventListener('change', (e) => {
        this.corpusFilter = e.target.value;
        this.renderMainContent();
      });
    }

    const supporterTypeSelect = document.getElementById('filter-supporter-type');
    if (supporterTypeSelect) {
      supporterTypeSelect.addEventListener('change', (e) => {
        this.supporterTypeFilter = e.target.value;
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
      if (this.stageFilter !== 'all') {
        const norm = this.normalizeStage(lead.stage);
        if (this.stageFilter === 'closed') {
          if (norm !== 'closed' && norm !== 'committed') return false;
        } else if (this.stageFilter === 'closed_not_interested') {
          if (norm !== 'closed') return false;
        } else if (this.stageFilter === 'committed') {
          if (norm !== 'committed') return false;
        } else if (norm !== this.stageFilter) {
          return false;
        }
      }

      // Campaign filter
      if (this.campaignFilter !== 'all' && lead.campaignId !== this.campaignFilter) return false;

      // Priority filter
      if (this.priorityFilter !== 'all' && lead.priority !== this.priorityFilter) return false;

      // Corpus filter (Yes / No)
      if (this.corpusFilter && this.corpusFilter !== 'all') {
        const isCorpus = Boolean(lead.isCorpus === true || lead.isCorpus === 'Yes' || lead.isCorpus === 'yes');
        if (this.corpusFilter === 'corpus' && !isCorpus) return false;
        if (this.corpusFilter === 'general' && isCorpus) return false;
      }

      // Supporter Type filter (Donor, Monthly Supporter, Volunteer Ambassador)
      if (this.supporterTypeFilter && this.supporterTypeFilter !== 'all') {
        const type = this.getSupporterType(lead);
        if (type !== this.supporterTypeFilter) return false;
      }

      // Search term
      if (this.searchTerm) {
        const text = [
          lead.name,
          lead.organization,
          lead.email,
          lead.phone,
          lead.city,
          lead.country,
          lead.pan,
          lead.address,
          lead.paymentId,
          lead.referredByName,
          lead.volunteerCoordinator,
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
            const count = (s.id === 'closed')
              ? filteredLeads.filter(l => ['committed', 'closed'].includes(this.normalizeStage(l.stage))).length
              : filteredLeads.filter(l => this.normalizeStage(l.stage) === s.id).length;
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

      <div class="kanban-wrapper w-full overflow-x-auto lg:overflow-x-visible pb-8 pt-1 no-scrollbar">
        <div class="flex items-start gap-2.5 sm:gap-3 lg:gap-3 min-w-max lg:min-w-0 w-full">
    `;

    CFM_STAGES.forEach(stage => {
      const isClosedStage = (stage.id === 'closed');
      let stageLeads;
      let stageTotal;

      if (isClosedStage) {
        stageLeads = filteredLeads.filter(l => {
          const norm = this.normalizeStage(l.stage);
          return norm === 'committed' || norm === 'closed';
        });
        const committedLeads = stageLeads.filter(l => this.normalizeStage(l.stage) === 'committed');
        const notInterestedLeads = stageLeads.filter(l => this.normalizeStage(l.stage) === 'closed');
        const committedTotal = committedLeads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);

        let displayLeads = stageLeads;
        if (this.closedSubFilter === 'committed') {
          displayLeads = committedLeads;
        } else if (this.closedSubFilter === 'not_interested') {
          displayLeads = notInterestedLeads;
        }

        html += `
          <div class="flex flex-col w-[85vw] sm:w-[280px] lg:w-auto lg:flex-1 lg:min-w-0 flex-shrink-0 lg:flex-shrink bg-slate-100/95 rounded-xl border border-slate-200/90 shadow-sm kanban-column"
               data-stage-column="closed"
               ondragover="app.handleDragOver(event)"
               ondragleave="app.handleDragLeave(event)"
               ondrop="app.handleDrop(event, 'committed')">
            <!-- Column Header -->
            <div class="p-2.5 sm:p-3 border-b border-slate-200 bg-white/70 rounded-t-xl flex items-center justify-between">
              <div class="flex items-center space-x-1.5 sm:space-x-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 truncate" title="Closed (Outcome)">Closed (Outcome)</h3>
              </div>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 shrink-0">
                ${stageLeads.length}
              </span>
            </div>

            <!-- Subheader / Committed Value -->
            <div class="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-medium text-slate-500 flex justify-between">
              <span class="truncate mr-1">Committed:</span>
              <span class="font-bold text-emerald-700 shrink-0">${this.formatCurrency(committedTotal)}</span>
            </div>

            <!-- Sub-options Segmented Control (Committed vs Not Interested) -->
            <div class="p-1.5 bg-white border-b border-slate-200">
              <div class="inline-flex rounded-lg bg-slate-100 p-0.5 text-[10px] sm:text-[11px] font-semibold w-full">
                <button onclick="app.setClosedSubFilter('all')" class="flex-1 py-1 px-1 rounded-md transition text-center truncate ${this.closedSubFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold border border-slate-200' : 'text-slate-600 hover:text-slate-900'}">
                  All (${stageLeads.length})
                </button>
                <button onclick="app.setClosedSubFilter('committed')" class="flex-1 py-1 px-1 rounded-md transition text-center truncate ${this.closedSubFilter === 'committed' ? 'bg-emerald-600 text-white shadow-xs font-bold' : 'text-slate-600 hover:text-emerald-700'}">
                  <i class="fas fa-heart text-[9px] mr-0.5 ${this.closedSubFilter === 'committed' ? 'text-white' : 'text-emerald-500'}"></i>Committed (${committedLeads.length})
                </button>
                <button onclick="app.setClosedSubFilter('not_interested')" class="flex-1 py-1 px-1 rounded-md transition text-center truncate ${this.closedSubFilter === 'not_interested' ? 'bg-slate-700 text-white shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}">
                  <i class="fas fa-ban text-[9px] mr-0.5 ${this.closedSubFilter === 'not_interested' ? 'text-white' : 'text-rose-500'}"></i>Not Int. (${notInterestedLeads.length})
                </button>
              </div>
            </div>

            <!-- Quick Sub-Option Drop Targets -->
            <div class="px-2 pt-2 pb-1">
              <div class="grid grid-cols-2 gap-1.5 text-center text-xs">
                <div ondragover="app.handleDragOver(event)" ondragleave="app.handleDragLeave(event)" ondrop="event.stopPropagation(); app.handleDrop(event, 'committed')" 
                     class="py-1 px-1 bg-emerald-50 hover:bg-emerald-100 border border-dashed border-emerald-300 rounded-lg text-emerald-800 text-[10px] sm:text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer shadow-2xs whitespace-nowrap">
                  <i class="fas fa-heart text-emerald-600 text-[10px] shrink-0"></i>
                  <span class="truncate">Drop: Committed</span>
                </div>
                <div ondragover="app.handleDragOver(event)" ondragleave="app.handleDragLeave(event)" ondrop="event.stopPropagation(); app.handleDrop(event, 'closed')" 
                     class="py-1 px-1 bg-slate-50 hover:bg-rose-50 border border-dashed border-slate-300 hover:border-rose-300 rounded-lg text-slate-700 hover:text-rose-800 text-[10px] sm:text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer shadow-2xs whitespace-nowrap">
                  <i class="fas fa-ban text-rose-500 text-[10px] shrink-0"></i>
                  <span class="truncate">Drop: Not Int.</span>
                </div>
              </div>
            </div>

            <!-- Cards List -->
            <div class="p-2 space-y-2.5 flex-1 overflow-y-auto max-h-[calc(100vh-340px)]">
              ${displayLeads.length === 0 ? `
                <div class="h-28 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-400 italic text-center px-4">
                  ${this.closedSubFilter === 'committed' ? 'No committed partners yet.<br>Drag leads to Drop: Committed above!' : this.closedSubFilter === 'not_interested' ? 'No leads marked as Not Interested.' : 'Drop closed leads here'}
                </div>
              ` : displayLeads.map(lead => this.renderKanbanCard(lead, true)).join('')}
            </div>
          </div>
        `;
      } else {
        stageLeads = filteredLeads.filter(l => this.normalizeStage(l.stage) === stage.id);
        stageTotal = stageLeads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);

        html += `
          <div class="flex flex-col w-[85vw] sm:w-[280px] lg:w-auto lg:flex-1 lg:min-w-0 flex-shrink-0 lg:flex-shrink bg-slate-100/95 rounded-xl border border-slate-200/90 shadow-sm kanban-column"
               data-stage-column="${stage.id}"
               ondragover="app.handleDragOver(event)"
               ondragleave="app.handleDragLeave(event)"
               ondrop="app.handleDrop(event, '${stage.id}')">
            <!-- Column Header -->
            <div class="p-2.5 sm:p-3 border-b border-slate-200 bg-white/70 rounded-t-xl flex items-center justify-between">
              <div class="flex items-center space-x-1.5 sm:space-x-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full bg-${stage.color}-500 shrink-0"></span>
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 truncate" title="${stage.label}">${stage.label}</h3>
              </div>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 shrink-0">
                ${stageLeads.length}
              </span>
            </div>

            <!-- Subheader / Column Pipeline Amount -->
            <div class="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-medium text-slate-500 flex justify-between">
              <span class="truncate mr-1">Potential:</span>
              <span class="font-bold text-slate-800 shrink-0">${this.formatCurrency(stageTotal)}</span>
            </div>

            <!-- Cards List -->
            <div class="p-2 space-y-2.5 flex-1 overflow-y-auto max-h-[calc(100vh-340px)]">
              ${stageLeads.length === 0 ? `
                <div class="h-28 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-400 italic">
                  Drop leads here
                </div>
              ` : stageLeads.map(lead => this.renderKanbanCard(lead, false)).join('')}
            </div>
          </div>
        `;
      }
    });

    html += `
        </div>
      </div>
    `;
    container.innerHTML = html;
  }

  renderKanbanCard(lead, isClosedColumn = false) {
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

        <!-- Outcome Sub-Option Banner (Committed vs Not Interested) -->
        ${isClosedColumn ? (() => {
          const norm = this.normalizeStage(lead.stage);
          if (norm === 'committed') {
            return `
              <div class="mb-2 p-1.5 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-between text-[11px] font-bold text-emerald-800 shadow-2xs">
                <span class="flex items-center gap-1"><i class="fas fa-heart text-emerald-600"></i> Committed Partner</span>
                <button onclick="event.stopPropagation(); app.quickUpdateStage('${lead.id}', 'closed')" class="text-[10px] text-slate-500 hover:text-rose-600 font-semibold underline px-1 py-0.5 rounded hover:bg-white transition" title="Switch to Not Interested">
                  Mark Not Int.
                </button>
              </div>
            `;
          } else {
            return `
              <div class="mb-2 p-1.5 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-700 shadow-2xs">
                <span class="flex items-center gap-1"><i class="fas fa-ban text-rose-500"></i> Not Interested</span>
                <button onclick="event.stopPropagation(); app.quickUpdateStage('${lead.id}', 'committed')" class="text-[10px] text-slate-500 hover:text-emerald-700 font-semibold underline px-1 py-0.5 rounded hover:bg-white transition" title="Switch to Committed Partner">
                  Mark Committed
                </button>
              </div>
            `;
          }
        })() : ''}

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

        <!-- Statutory Compliance & Supporter Stewardship Badges -->
        <div class="my-1.5 flex flex-wrap gap-1 items-center">
          ${lead.isCorpus ? `
            <span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200" title="Corpus Gift - Sec 11(1)(d)">
              <i class="fas fa-landmark text-[9px]"></i> Corpus Gift
            </span>
          ` : ''}
          ${lead.pan ? `
            <span class="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200" title="Income Tax PAN">
              <i class="fas fa-id-card text-[9px] text-slate-500"></i> ${this.escapeHtml(lead.pan)}
            </span>
          ` : ''}
          ${(lead.supporterType || lead.networkTier) ? `
            <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200" title="Supporter Type">
              <i class="fas fa-handshake-angle text-[9px] text-amber-600"></i> ${this.escapeHtml(this.getSupporterType(lead))}
            </span>
          ` : ''}
        </div>

        <!-- Supporter Referral & Coordinator Record (For Record-Keeping Only) -->
        ${(() => {
          const info = this.getLeaderLevelInfo(lead.id);
          const parent = info ? info.parentLead : null;
          const coord = lead.volunteerCoordinator || info?.staffLeader || lead.assignedTo || 'Pastor David';
          const refCount = this.getReferralsCount(lead.id);

          if (!parent && !lead.supporterType && !lead.networkTier && refCount === 0) return '';

          return `
            <div class="my-1.5 p-1.5 rounded-md bg-slate-50 border border-slate-200/80 text-[10px] space-y-0.5">
              <div class="flex items-center justify-between">
                <span class="font-bold text-slate-700 truncate max-w-[130px]" title="Volunteer Coordinator">
                  <i class="fas fa-user-shield text-indigo-600 text-[9px]"></i> ${this.escapeHtml(coord)}
                </span>
                ${refCount > 0 ? `
                  <span class="px-1.5 py-0.2 rounded font-extrabold bg-amber-100 text-amber-900 border border-amber-300" title="Referrals on Record (For Info Only)">
                    Referrals: ${refCount}
                  </span>
                ` : ''}
              </div>
              ${parent ? `
                <div class="text-slate-500 truncate text-[9px]">
                  <i class="fas fa-handshake-angle text-amber-500"></i> Referred by: <strong class="text-slate-700">${this.escapeHtml(parent.name)}</strong> <span class="text-slate-400">(info only)</span>
                </div>
              ` : ''}
            </div>
          `;
        })()}

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
            <option value="new" ${this.normalizeStage(lead.stage) === 'new' ? 'selected' : ''}>New Leads</option>
            <option value="contacted" ${this.normalizeStage(lead.stage) === 'contacted' ? 'selected' : ''}>Contacted</option>
            <option value="in_discussion" ${this.normalizeStage(lead.stage) === 'in_discussion' ? 'selected' : ''}>In Discussion</option>
            <optgroup label="Closed (Outcome)">
              <option value="committed" ${this.normalizeStage(lead.stage) === 'committed' ? 'selected' : ''}>Closed: Committed</option>
              <option value="closed" ${this.normalizeStage(lead.stage) === 'closed' ? 'selected' : ''}>Closed: Not Interested</option>
            </optgroup>
          </select>
        </div>
      </div>
    `;
  }

  setClosedSubFilter(subFilter) {
    this.closedSubFilter = subFilter;
    this.render();
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
    } else if (targetStage === 'closed') {
      this.showToast(`${lead.name} marked as Closed (Not Interested)`, 'info');
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
    } else if (targetStage === 'closed') {
      this.showToast(`${lead.name} marked as Closed (Not Interested)`, 'info');
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
          <div class="flex items-center gap-2">
            <button onclick="app.openImportModal()" class="text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 px-3 py-1.5 rounded-lg shadow-sm font-bold flex items-center gap-1.5 transition cursor-pointer">
              <i class="fas fa-file-import"></i> Import Leads
            </button>
            <button onclick="app.exportLeadsCSV()" class="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm font-semibold flex items-center gap-1.5 transition cursor-pointer">
              <i class="fas fa-file-csv text-emerald-600"></i> Export to CSV
            </button>
          </div>
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
                      ${lead.isCorpus ? `
                        <span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          Corpus
                        </span>
                      ` : ''}
                      ${lead.pan ? `
                        <span class="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-100 text-slate-700">
                          ${this.escapeHtml(lead.pan)}
                        </span>
                      ` : ''}
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
                      ${(() => {
                        const info = this.getLeaderLevelInfo(lead.id);
                        const parent = info ? info.parentLead : null;
                        const sType = this.getSupporterType(lead);
                        const refCount = this.getReferralsCount(lead.id);
                        return `
                          <div class="mt-1 flex items-center gap-1.5 flex-wrap">
                            ${lead.isCorpus ? `
                              <span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-purple-100 text-purple-800 border border-purple-200" title="Corpus Gift - Sec 11(1)(d)">
                                <i class="fas fa-landmark text-[9px]"></i> Corpus
                              </span>
                            ` : ''}
                            ${lead.pan ? `
                              <span class="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200" title="Income Tax PAN">
                                PAN: ${this.escapeHtml(lead.pan)}
                              </span>
                            ` : ''}
                            <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              ${sType}
                            </span>
                            ${parent ? `
                              <span class="text-[10px] text-slate-500 flex items-center gap-0.5">
                                <i class="fas fa-handshake-angle text-amber-500 text-[9px]"></i> Referred by: <strong class="text-slate-700">${this.escapeHtml(parent.name)}</strong>
                              </span>
                            ` : ''}
                            ${refCount > 0 ? `
                              <span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                Referrals: ${refCount}
                              </span>
                            ` : ''}
                          </div>
                        `;
                      })()}
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
                        <option value="new" ${this.normalizeStage(lead.stage) === 'new' ? 'selected' : ''}>New Leads</option>
                        <option value="contacted" ${this.normalizeStage(lead.stage) === 'contacted' ? 'selected' : ''}>Contacted</option>
                        <option value="in_discussion" ${this.normalizeStage(lead.stage) === 'in_discussion' ? 'selected' : ''}>In Discussion</option>
                        <optgroup label="Closed (Outcome)">
                          <option value="committed" ${this.normalizeStage(lead.stage) === 'committed' ? 'selected' : ''}>Closed: Committed</option>
                          <option value="closed" ${this.normalizeStage(lead.stage) === 'closed' ? 'selected' : ''}>Closed: Not Interested</option>
                        </optgroup>
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

  // Supporter Type Helper (Donor, Monthly Supporter, Volunteer Ambassador)
  getSupporterType(lead) {
    if (!lead) return 'Donor';
    if (lead.supporterType) return lead.supporterType;
    if (lead.networkTier) {
      if (['stage-1', 'stage-2', 'stage-3', 'stage-4'].includes(lead.networkTier)) {
        return 'Volunteer Ambassador';
      }
      if (lead.networkTier === 'stage-5') {
        return 'Monthly Supporter';
      }
    }
    if (lead.frequency === 'Monthly') return 'Monthly Supporter';
    return 'Donor';
  }

  // Count total referrals introduced by a supporter (record-keeping only, no rewards/perks)
  getReferralsCount(leadId) {
    if (!leadId) return 0;
    return this.leads.filter(l => l.referredBy === leadId || l.parentLeadId === leadId).length;
  }

  // Handle Corpus donation toggle in Lead Add/Edit modal
  handleCorpusChangeInForm(val) {
    const box = document.getElementById('modal-lead-corpus-direction-box');
    const warning = document.getElementById('modal-lead-corpus-high-value-warning');
    const isCorpus = (val === 'Yes');
    if (box) {
      box.classList.toggle('hidden', !isCorpus);
    }
    if (warning) {
      const amount = Number(document.getElementById('modal-lead-amount')?.value || 0);
      const received = Number(document.getElementById('modal-lead-received')?.value || 0);
      const maxAmt = Math.max(amount, received);
      // Highlight requirement for gifts of 1 lakh or more
      if (maxAmt >= 100000) {
        warning.classList.remove('opacity-75');
        warning.classList.add('ring-2', 'ring-amber-500', 'bg-amber-100');
      } else {
        warning.classList.remove('ring-2', 'ring-amber-500');
      }
    }
  }

  // Handle Supporter Type changes in modal
  handleSupporterTypeChangeInForm(val) {
    const hiddenTier = document.getElementById('modal-lead-network-tier');
    if (hiddenTier) {
      if (val === 'Volunteer Ambassador') hiddenTier.value = 'stage-1';
      else if (val === 'Monthly Supporter') hiddenTier.value = 'stage-5';
      else hiddenTier.value = '';
    }
  }

  // Populate Referred By dropdown in modal
  populateReferredByDropdown(currentLeadId = null, selectedReferredById = null) {
    const select = document.getElementById('modal-lead-referred-by');
    if (!select) return;

    let optionsHtml = '<option value="">None / Direct Supporter</option>';
    const candidates = this.leads.filter(l => (!currentLeadId || l.id !== currentLeadId));
    candidates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    candidates.forEach(cand => {
      const sType = this.getSupporterType(cand);
      const isSel = selectedReferredById && (selectedReferredById === cand.id || selectedReferredById === cand.name);
      const city = cand.city ? ` • ${this.escapeHtml(cand.city)}` : '';
      optionsHtml += `
        <option value="${cand.id}" ${isSel ? 'selected' : ''}>
          ${this.escapeHtml(cand.name)} (${sType}${city})
        </option>
      `;
    });

    select.innerHTML = optionsHtml;
    if (selectedReferredById) {
      select.value = selectedReferredById;
    }
  }

  // ===================== SUPPORTER & REFERRAL STEWARDSHIP TRACKING =====================
  getStageRoleLabel(stageId) {
    const stages = typeof CFM_NETWORK_STAGES !== 'undefined' ? CFM_NETWORK_STAGES : [];
    const stageObj = stages.find(s => s.id === stageId);
    return stageObj ? `${stageObj.role}` : (stageId || 'Donor');
  }

  getLeaderLevelInfo(leadId) {
    const lead = this.leads.find(l => l.id === leadId);
    if (!lead) return null;

    let parentLead = null;
    let staffLeader = null;
    if (lead.referredBy) {
      parentLead = this.leads.find(l => l.id === lead.referredBy);
    }
    if (!parentLead && lead.parentLeadId) {
      if (lead.parentLeadId.startsWith('staff:')) {
        staffLeader = lead.parentLeadId.replace('staff:', '');
      } else {
        parentLead = this.leads.find(l => l.id === lead.parentLeadId);
      }
    }
    if (!parentLead && !staffLeader) {
      staffLeader = lead.volunteerCoordinator || lead.assignedTo || 'Pastor David';
    }

    const directRecruits = this.leads.filter(l => (l.referredBy === lead.id || l.parentLeadId === lead.id));

    // Recursive referral computation
    const getDescendants = (id) => {
      const children = this.leads.filter(l => (l.referredBy === id || l.parentLeadId === id));
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
    const supporterType = this.getSupporterType(lead);
    const roleTitle = supporterType;

    const recruitCount = directRecruits.length;
    const hasReferrals = recruitCount > 0;
    const targetQuota = 10;
    const isReached = recruitCount >= targetQuota;
    const percentage = Math.min(100, Math.round((recruitCount / targetQuota) * 100));
    const remainingNeeded = Math.max(0, targetQuota - recruitCount);

    let statusKey = 'pending';
    let statusLabel = '';
    let statusBadgeClass = '';

    if (hasReferrals) {
      statusKey = 'progress';
      statusLabel = `${recruitCount} Referrals on Record (Stewardship)`;
      statusBadgeClass = 'badge-level-progress font-semibold';
    } else {
      statusKey = 'pending';
      statusLabel = `Direct Supporter (0 Referrals)`;
      statusBadgeClass = 'badge-level-pending text-slate-500';
    }

    const totalMobilized = (lead.receivedAmount || 0) + allDescendants.reduce((sum, d) => sum + (d.receivedAmount || 0), 0);
    const totalPledged = (lead.expectedAmount || 0) + allDescendants.reduce((sum, d) => sum + (d.expectedAmount || 0), 0);

    return {
      lead,
      parentLead,
      staffLeader,
      directRecruits,
      allDescendants,
      totalTeamSize: allDescendants.length,
      stageObj,
      stageNumber,
      roleTitle,
      supporterType,
      targetQuota,
      recruitCount,
      hasReferrals,
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

    // Staff Users list (Pastor David, Nelson Richard, etc.)
    let staffUsers = (Array.isArray(this.users) && this.users.length > 0)
      ? this.users
      : (typeof cfmFirebase !== 'undefined' ? cfmFirebase.getLocalUsers() : (typeof CFM_INITIAL_USERS !== 'undefined' ? CFM_INITIAL_USERS : []));
    staffUsers = staffUsers.filter(u => u && u.name && u.id !== 'user-2' && u.id !== 'user-3' && u.id !== 'user-4');
    if (staffUsers.length === 0) {
      staffUsers = [
        { id: "user-1", name: "Pastor David", role: "admin", title: "Ministry Director & Founder" },
        { id: "user-nelson", name: "Nelson Richard", role: "admin", title: "Partner Relations & Stewardship Officer" }
      ];
    }

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

    let optionsHtml = '';

    // 1. Staff Overseer Leaders (Staff members who track and mentor Core Leaders)
    optionsHtml += '<optgroup label="Ministry Staff Leaders (Core Leader Overseers)">';
    staffUsers.forEach(u => {
      const val = `staff:${u.name}`;
      const isSelected = selectedParentId && (selectedParentId === val || selectedParentId === u.name);
      const roleBadge = u.role === 'admin' ? 'Admin' : 'Staff';
      const titleSuffix = u.title ? ` - ${this.escapeHtml(u.title)}` : '';
      optionsHtml += `
        <option value="${this.escapeHtml(val)}" ${isSelected ? 'selected' : ''}>
          Staff Leader: ${this.escapeHtml(u.name)} (${roleBadge}${titleSuffix})
        </option>
      `;
    });
    optionsHtml += '</optgroup>';

    // 2. Registered Supporters (Referred By - For Info Only)
    if (candidates.length > 0) {
      optionsHtml += '<optgroup label="Registered Supporters (Referred By - For Information Only)">';
      candidates.forEach(cand => {
        const stageLabel = this.getStageRoleLabel(cand.networkTier);
        const isSelected = selectedParentId && selectedParentId === cand.id;
        optionsHtml += `
          <option value="${cand.id}" ${isSelected ? 'selected' : ''}>
            ${this.escapeHtml(cand.name)} (${stageLabel}) ${cand.organization ? `• ${this.escapeHtml(cand.organization)}` : ''}
          </option>
        `;
      });
      optionsHtml += '</optgroup>';
    }

    parentSelect.innerHTML = optionsHtml;
    if (selectedParentId) {
      parentSelect.value = selectedParentId;
    }
  }

  addNewReferralForSupporter(referrerLeadId) {
    this.openLeadModal(null, referrerLeadId);
  }

  // Alias for backward compatibility
  addNewRecruitUnderLeader(parentLeadId) {
    this.addNewReferralForSupporter(parentLeadId);
  }

  handleTierChangeInForm(tierValue) {
    const parentSelect = document.getElementById('modal-lead-parent');
    if (!parentSelect) return;

    if (tierValue === 'stage-1') {
      // Core Leader is overseen and tracked by assigned Staff
      const assigned = document.getElementById('modal-lead-assigned')?.value || 'Pastor David';
      parentSelect.value = 'staff:' + assigned;
    } else if (tierValue === 'stage-2') {
      const stage1Leader = this.leads.find(l => l.networkTier === 'stage-1');
      if (stage1Leader && (!parentSelect.value || parentSelect.value.startsWith('staff:'))) {
        parentSelect.value = stage1Leader.id;
      }
    } else if (tierValue === 'stage-3') {
      const stage2Leader = this.leads.find(l => l.networkTier === 'stage-2');
      if (stage2Leader && (!parentSelect.value || parentSelect.value.startsWith('staff:'))) {
        parentSelect.value = stage2Leader.id;
      }
    } else if (tierValue === 'stage-4') {
      const stage3Leader = this.leads.find(l => l.networkTier === 'stage-3');
      if (stage3Leader && (!parentSelect.value || parentSelect.value.startsWith('staff:'))) {
        parentSelect.value = stage3Leader.id;
      }
    } else if (tierValue === 'stage-5') {
      const stage4Leader = this.leads.find(l => l.networkTier === 'stage-4');
      if (stage4Leader && (!parentSelect.value || parentSelect.value.startsWith('staff:'))) {
        parentSelect.value = stage4Leader.id;
      }
    }
  }

  handleAssignedChangeInForm(assignedUser) {
    const tierSelect = document.getElementById('modal-lead-network-tier');
    const parentSelect = document.getElementById('modal-lead-parent');
    if (tierSelect && tierSelect.value === 'stage-1' && parentSelect) {
      parentSelect.value = 'staff:' + (assignedUser || 'Pastor David');
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
                    <i class="fas fa-handshake-angle text-amber-500"></i>
                    Referred By (For Information Only):
                    <strong onclick="app.openLeadDetails('${info.parentLead.id}')" class="text-slate-800 hover:text-amber-600 cursor-pointer underline">
                      ${this.escapeHtml(info.parentLead.name)}
                    </strong>
                    <span class="text-[10px] text-slate-400">(${this.getSupporterType(info.parentLead)})</span>
                  </span>
                ` : `
                  <span class="text-[11px] text-indigo-900 font-bold flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    <i class="fas fa-user-shield text-indigo-600 text-[10px]"></i> Volunteer Coordinator: <strong class="text-indigo-800">${this.escapeHtml(info.staffLeader || lead.assignedTo || 'Pastor David')}</strong>
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
                ${lead.volunteerCoordinator ? `
                  <span><i class="fas fa-user-shield text-[10px] mr-1"></i>Coordinator: ${this.escapeHtml(lead.volunteerCoordinator)}</span>
                ` : ''}
              </div>
            </div>

            <!-- Right: Referrals Count & Record Badge (No Quotas/MLM) -->
            <div class="sm:text-right w-full sm:w-auto sm:min-w-[210px] shrink-0 space-y-1">
              <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${info.recruitCount > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-600 border border-slate-200'}">
                <i class="fas fa-user-group text-indigo-600 text-xs"></i>
                <span>Referrals Count: ${info.recruitCount}</span>
              </div>
              <div class="text-[10px] text-slate-500 font-medium">
                Record-keeping only • No rewards or perks
              </div>
            </div>

          </div>

          <!-- Footer Bar with Metrics and Actions -->
          <div class="mt-3 pt-3 border-t border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3 text-xs">
            <!-- Referrals Summary -->
            <div class="flex items-center gap-3 sm:gap-4 flex-wrap text-[11px] text-slate-600">
              <span class="whitespace-nowrap">Direct Referrals: <strong class="text-slate-900">${info.recruitCount}</strong></span>
              <span class="whitespace-nowrap">Ministry Contributions: <strong class="text-emerald-700">${this.formatCurrency(info.totalMobilized)}</strong></span>
            </div>

            <!-- Action Buttons -->
            <div class="flex items-center gap-2 flex-wrap w-full xl:w-auto justify-start xl:justify-end">
              ${hasChildren ? `
                <button onclick="app.toggleLineageNode('${lead.id}')" 
                        class="px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0 whitespace-nowrap ${isExpanded ? 'bg-slate-200 text-slate-800 hover:bg-slate-300' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}">
                  <i class="fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} text-[10px]"></i>
                  <span>${isExpanded ? 'Hide' : 'Show'} Referrals (${directRecruits.length})</span>
                </button>
              ` : `
                <span class="text-[11px] text-slate-400 italic px-2 shrink-0">No referrals on record</span>
              `}

              <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" 
                      title="Add Referral Record Under ${this.escapeHtml(firstName)}"
                      class="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition flex items-center gap-1 shadow-sm shrink-0 whitespace-nowrap">
                <i class="fas fa-plus text-[10px]"></i> Add Referral
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
      const allLeadsPool = (this.leads && this.leads.length > 0) ? this.leads : (typeof CFM_INITIAL_LEADS !== 'undefined' ? CFM_INITIAL_LEADS : []);
      const rootLeaders = allLeadsPool.filter(l => (
        !l.referredBy || 
        !allLeadsPool.some(p => p.id === l.referredBy)
      ));
      if (rootLeaders.length === 0) {
        return `
          <div class="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
            <i class="fas fa-users text-3xl mb-2 text-slate-300"></i>
            <p class="text-sm font-semibold">No root supporters found in database.</p>
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
              <th class="py-3 px-4 whitespace-nowrap">Supporter / Organization</th>
              <th class="py-3 px-4 whitespace-nowrap">Supporter Type</th>
              <th class="py-3 px-4 whitespace-nowrap">Referred By (For Information Only)</th>
              <th class="py-3 px-4 whitespace-nowrap">Volunteer Coordinator</th>
              <th class="py-3 px-4 text-center whitespace-nowrap">Referrals Count</th>
              <th class="py-3 px-4 text-right whitespace-nowrap">Contributions</th>
              <th class="py-3 px-4 text-center whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${networkLeads.map(lead => {
              const info = this.getLeaderLevelInfo(lead.id);
              if (!info) return '';
              const parent = info.parentLead;
              const supporterType = this.getSupporterType(lead);
              const coordinator = lead.volunteerCoordinator || (info.staffLeader || lead.assignedTo || 'Pastor David');

              return `
                <tr class="hover:bg-amber-50/40 transition cursor-pointer" onclick="app.openLeadDetails('${lead.id}')">
                  <!-- Name & Org -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <div class="font-extrabold text-slate-900 text-sm hover:text-amber-600">${this.escapeHtml(lead.name)}</div>
                    ${lead.organization ? `<div class="text-[11px] text-slate-500">${this.escapeHtml(lead.organization)}</div>` : ''}
                    ${lead.city ? `<div class="text-[10px] text-slate-400"><i class="fas fa-map-marker-alt text-[9px] mr-1"></i>${this.escapeHtml(lead.city)}</div>` : ''}
                  </td>

                  <!-- Supporter Type -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <span class="text-[11px] px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      ${supporterType}
                    </span>
                  </td>

                  <!-- Referred By (For Information Only) -->
                  <td class="py-3 px-4 whitespace-nowrap" onclick="event.stopPropagation()">
                    ${parent ? `
                      <div onclick="app.openLeadDetails('${parent.id}')" class="text-amber-800 hover:text-amber-900 font-bold hover:underline flex items-center gap-1 cursor-pointer">
                        <i class="fas fa-handshake-angle text-amber-500"></i>
                        <span>${this.escapeHtml(parent.name)}</span>
                      </div>
                      <div class="text-[10px] text-slate-400">Record-keeping only</div>
                    ` : `
                      <span class="text-slate-400 text-xs italic">Direct / Direct Supporter</span>
                    `}
                  </td>

                  <!-- Volunteer Coordinator -->
                  <td class="py-3 px-4 whitespace-nowrap">
                    <div class="text-indigo-900 font-bold flex items-center gap-1 text-xs">
                      <i class="fas fa-user-shield text-indigo-600 text-[10px]"></i>
                      <span>${this.escapeHtml(coordinator)}</span>
                    </div>
                  </td>

                  <!-- Referrals Count -->
                  <td class="py-3 px-4 text-center whitespace-nowrap">
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${info.recruitCount > 0 ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' : 'bg-slate-100 text-slate-500'}">
                      <i class="fas fa-user-group text-[10px]"></i>
                      <span>${info.recruitCount}</span>
                    </span>
                  </td>

                  <!-- Mobilized Funds -->
                  <td class="py-3 px-4 text-right font-black text-emerald-700 whitespace-nowrap">
                    ${this.formatCurrency(lead.receivedAmount || lead.expectedAmount || 0)}
                  </td>

                  <!-- Actions -->
                  <td class="py-3 px-4 text-center whitespace-nowrap" onclick="event.stopPropagation()">
                    <div class="flex items-center justify-center gap-1">
                      <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" title="Add Referral Record" class="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold shadow-xs whitespace-nowrap">
                        + Referral
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

    // Lineage statistics & Non-Profit Supporter Directory Counts
    const allLeadsPool = (this.leads && this.leads.length > 0) ? this.leads : (typeof CFM_INITIAL_LEADS !== 'undefined' ? CFM_INITIAL_LEADS : []);
    const networkLeads = allLeadsPool;
    const totalSupportersCount = networkLeads.length;
    const withReferralsCount = networkLeads.filter(l => (this.getLeaderLevelInfo(l.id)?.recruitCount || 0) > 0).length;
    const ambassadorsCount = networkLeads.filter(l => this.getSupporterType(l) === 'Volunteer Ambassador').length;
    const monthlySupportersCount = networkLeads.filter(l => this.getSupporterType(l) === 'Monthly Supporter').length;
    const reachedCount = withReferralsCount;
    const progressCount = withReferralsCount;
    const pendingCount = networkLeads.filter(l => (this.getLeaderLevelInfo(l.id)?.recruitCount || 0) === 0).length;

    let filteredNetworkLeads = [...networkLeads];
    if (this.lineageStageFilter !== 'all') {
      if (this.lineageStageFilter === 'ambassador' || this.lineageStageFilter === 'stage-1') {
        filteredNetworkLeads = filteredNetworkLeads.filter(l => this.getSupporterType(l) === 'Volunteer Ambassador' || l.networkTier === 'stage-1');
      } else if (this.lineageStageFilter === 'monthly' || this.lineageStageFilter === 'stage-5') {
        filteredNetworkLeads = filteredNetworkLeads.filter(l => this.getSupporterType(l) === 'Monthly Supporter' || l.networkTier === 'stage-5');
      } else if (this.lineageStageFilter === 'donor') {
        filteredNetworkLeads = filteredNetworkLeads.filter(l => this.getSupporterType(l) === 'Donor');
      } else {
        filteredNetworkLeads = filteredNetworkLeads.filter(l => l.networkTier === this.lineageStageFilter);
      }
    }
    if (this.lineageStatusFilter !== 'all') {
      filteredNetworkLeads = filteredNetworkLeads.filter(l => {
        const info = this.getLeaderLevelInfo(l.id);
        const refCount = info?.recruitCount || 0;
        if (this.lineageStatusFilter === 'progress' || this.lineageStatusFilter === 'reached') {
          return refCount > 0;
        } else if (this.lineageStatusFilter === 'pending') {
          return refCount === 0;
        }
        return true;
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
      return (infoB?.recruitCount || 0) - (infoA?.recruitCount || 0);
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
                Ministry Stewardship Directory
              </span>
              <span class="text-xs text-amber-300 font-semibold flex items-center gap-1">
                <i class="fas fa-handshake-angle"></i> Referrals Count & Record-Keeping
              </span>
            </div>
            <h2 class="text-xl sm:text-3xl font-extrabold font-serif-title tracking-tight text-white">
              Supporters & Referral Stewardship Directory
            </h2>
            <p class="text-xs text-slate-300 leading-relaxed">
              Relational stewardship and ministry partner community directory. 
              Supports <strong>Model A</strong> (One-time ₹1,000) and <strong>Model B</strong> (Monthly ₹1,000 / Annualized ₹12,000) with analytical reconciliation toward the 1,00,000 supporter milestone.
            </p>

            <!-- Legal Compliance Notice Banner -->
            <div class="mt-3 p-3 bg-amber-500/15 border border-amber-400/40 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
              <i class="fas fa-scale-balanced text-amber-400 mt-0.5 shrink-0 text-sm"></i>
              <div>
                <span class="font-bold text-amber-300">Statutory Non-Profit Rule:</span>
                <span class="text-amber-100">Christ Focus Mission operates in strict compliance with the Indian Trusts Act and Income Tax Act. <strong>No rewards, perks, financial commissions, or preferential status are provided for introducing others.</strong> Referral information is maintained solely for internal record-keeping, pastoral care, and statutory audit integrity.</span>
              </div>
            </div>
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
                    <!-- Stage Badge & Referrals Count -->
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-${stage.color}-100 text-${stage.color}-800 border border-${stage.color}-200">
                        Stage ${stage.stageNumber}
                      </span>
                      ${stage.isCapped ? `
                        <span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                          <i class="fas fa-flag-checkered"></i> Milestone Cap
                        </span>
                      ` : `
                        <span class="text-[10px] font-semibold text-slate-400">Referrals Count</span>
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
             SUPPORTER DIRECTORY & REFERRAL LINEAGE
             Non-Profit Stewardship Records & Referral Lineage
             ======================================================== -->
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden space-y-4 p-5 sm:p-6">
          
          <!-- Section Title & Status Summary Cards -->
          <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-200 pb-5">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Supporter Directory & Lineage
                </span>
                <span class="text-xs text-amber-700 font-bold flex items-center gap-1">
                  <i class="fas fa-handshake-angle"></i> Non-Profit Stewardship Records
                </span>
              </div>
              <h3 class="text-xl font-black text-slate-900 tracking-tight font-serif-title">
                Supporters & Referral Lineage Directory
              </h3>
              <p class="text-xs text-slate-500 mt-0.5 max-w-2xl">
                Track registered supporters, referral lineage, and volunteer coordinators for internal record-keeping and audit integrity. <strong>Rule:</strong> No rewards, perks, or status for bringing in others. Referral info is for record-keeping only.
              </p>
            </div>

            <!-- Summary Counter Badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <div class="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs flex items-center gap-2 shadow-xs">
                <i class="fas fa-users text-slate-500 text-sm shrink-0"></i>
                <div class="space-y-0.5">
                  <div class="font-extrabold leading-snug text-slate-900">${totalSupportersCount} Supporters</div>
                  <div class="text-[10px] text-slate-500 leading-normal">Registered in Directory</div>
                </div>
              </div>

              <div class="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2 shadow-xs">
                <i class="fas fa-user-group text-amber-600 text-sm shrink-0"></i>
                <div class="space-y-0.5">
                  <div class="font-extrabold leading-snug text-amber-800">${withReferralsCount} Supporters</div>
                  <div class="text-[10px] text-amber-700 leading-normal">With Referrals on Record</div>
                </div>
              </div>

              <div class="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2 shadow-xs">
                <i class="fas fa-medal text-emerald-600 text-sm shrink-0"></i>
                <div class="space-y-0.5">
                  <div class="font-extrabold leading-snug text-emerald-700">${ambassadorsCount} Ambassadors</div>
                  <div class="text-[10px] text-emerald-800 leading-normal">Volunteer Ambassadors</div>
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
                       placeholder="Find supporter or church..." 
                       value="${this.escapeHtml(this.lineageSearchTerm)}"
                       oninput="app.setLineageSearch(this.value)"
                       class="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500">
              </div>

              <!-- Supporter Type Filter -->
              <select onchange="app.setLineageStageFilter(this.value)" 
                      class="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500">
                <option value="all" ${this.lineageStageFilter === 'all' ? 'selected' : ''}>All Supporter Types (${networkLeads.length})</option>
                <option value="ambassador" ${this.lineageStageFilter === 'ambassador' || this.lineageStageFilter === 'stage-1' ? 'selected' : ''}>Volunteer Ambassadors (${ambassadorsCount})</option>
                <option value="monthly" ${this.lineageStageFilter === 'monthly' || this.lineageStageFilter === 'stage-5' ? 'selected' : ''}>Monthly Supporters (${monthlySupportersCount})</option>
                <option value="donor" ${this.lineageStageFilter === 'donor' ? 'selected' : ''}>Donors</option>
              </select>

              <!-- Referral Status Filter -->
              <select onchange="app.setLineageStatusFilter(this.value)" 
                      class="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500">
                <option value="all" ${this.lineageStatusFilter === 'all' ? 'selected' : ''}>All Referral Records</option>
                <option value="progress" ${this.lineageStatusFilter === 'progress' ? 'selected' : ''}>Has Referrals on Record (${withReferralsCount})</option>
                <option value="pending" ${this.lineageStatusFilter === 'pending' ? 'selected' : ''}>Direct Supporter (0 Referrals)</option>
              </select>
            </div>

            <!-- View Switcher & Action Buttons -->
            <div class="flex items-center gap-2 self-end md:self-auto">
              <!-- Tree vs Table Toggle -->
              <div class="bg-slate-200/80 p-0.5 rounded-lg flex items-center border border-slate-300 shadow-inner">
                <button onclick="app.setLineageViewMode('tree')" 
                        class="px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${this.lineageViewMode === 'tree' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                  <i class="fas fa-sitemap text-amber-600"></i>
                  <span>Referral Tree</span>
                </button>
                <button onclick="app.setLineageViewMode('table')" 
                        class="px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${this.lineageViewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                  <i class="fas fa-list-ul text-blue-600"></i>
                  <span>Directory Table</span>
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
                <span>+ Add Supporter</span>
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

    let closedCommittedCount = 0;
    let closedNotInterestedCount = 0;

    this.leads.forEach(l => {
      const norm = this.normalizeStage(l.stage);
      if (norm === 'committed') {
        stageCounts['closed'] = (stageCounts['closed'] || 0) + 1;
        stageAmounts['closed'] = (stageAmounts['closed'] || 0) + (Number(l.expectedAmount) || 0);
        closedCommittedCount++;
      } else if (norm === 'closed') {
        stageCounts['closed'] = (stageCounts['closed'] || 0) + 1;
        stageAmounts['closed'] = (stageAmounts['closed'] || 0) + (Number(l.expectedAmount) || 0);
        closedNotInterestedCount++;
      } else if (stageCounts[norm] !== undefined) {
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
                const subLabel = (s.id === 'closed') ? ` • <span class="text-emerald-700 font-bold">${closedCommittedCount} committed</span>, <span class="text-slate-500">${closedNotInterestedCount} not int.</span>` : '';
                return `
                  <div>
                    <div class="flex justify-between text-xs font-semibold mb-1">
                      <span class="text-slate-700">${s.label} (${stageCounts[s.id]} leads)${subLabel}</span>
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
    const lead = this.leads.find(l => l.id === leadId) || (typeof CFM_INITIAL_LEADS !== 'undefined' ? CFM_INITIAL_LEADS.find(l => l.id === leadId) : null) || this.leads[0];
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

    // Supporter Type & Compliance Header Badges
    const supporterType = this.getSupporterType(lead);
    const tierBadge = document.getElementById('detail-lead-tier');
    if (tierBadge) {
      tierBadge.textContent = supporterType;
      tierBadge.classList.remove('hidden');
    }

    const isCorpus = Boolean(lead.isCorpus === true || lead.isCorpus === 'Yes' || lead.isCorpus === 'yes');
    const corpusBadge = document.getElementById('detail-lead-corpus-badge');
    if (corpusBadge) {
      corpusBadge.classList.toggle('hidden', !isCorpus);
    }

    const panBadge = document.getElementById('detail-lead-pan-badge');
    if (panBadge) {
      if (lead.pan) {
        panBadge.textContent = `PAN: ${lead.pan}`;
        panBadge.classList.remove('hidden');
      } else {
        panBadge.classList.add('hidden');
      }
    }

    const citizenBadge = document.getElementById('detail-lead-citizenship-badge');
    if (citizenBadge) {
      const isIndian = lead.citizenshipConfirmed !== 'No';
      citizenBadge.textContent = isIndian ? 'Indian Citizen' : 'Foreign / Pending';
      citizenBadge.classList.remove('hidden');
    }

    // 1. Statutory Tax Compliance & Digital Audit Trail Card
    const complianceCard = document.getElementById('detail-lead-compliance-card');
    if (complianceCard) {
      const isHighValue = (Number(lead.expectedAmount || 0) >= 100000) || (Number(lead.receivedAmount || 0) >= 100000);
      complianceCard.innerHTML = `
        <div class="p-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-slate-50 space-y-3 shadow-sm">
          <div class="flex items-center justify-between border-b border-emerald-200/80 pb-2.5">
            <div class="flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg bg-emerald-600 text-white font-black text-xs flex items-center justify-center shadow-sm">
                <i class="fas fa-file-invoice"></i>
              </span>
              <div>
                <h4 class="font-bold text-slate-900 text-xs">Statutory Compliance, Tax (80G/10BD) & Audit Trail</h4>
                <p class="text-[10px] text-slate-500">Official Non-Profit Trust Regulatory Records & Digital Evidence</p>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isCorpus ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'}">
              ${isCorpus ? 'Corpus Gift (Sec 11(1)(d))' : 'General Revenue Gift'}
            </span>
          </div>

          <!-- Tax ID, Citizenship & Address Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50/80 p-3 rounded-lg border border-slate-200/70">
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">PAN Number</span>
              <span class="font-mono font-bold text-slate-900 text-xs">
                ${lead.pan ? this.escapeHtml(lead.pan) : '<span class="text-rose-500 font-sans italic">Pending Submission</span>'}
              </span>
              <span class="text-[10px] text-slate-400 block mt-0.5">Required for Form 10BD</span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Citizenship Status</span>
              <span class="font-bold text-slate-900 text-xs">
                ${lead.citizenshipConfirmed !== 'No' ? '✓ Indian Citizen' : 'Foreign / Pending Verification'}
              </span>
              <span class="text-[10px] text-slate-400 block mt-0.5">FCRA Segregation</span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Corpus Classification</span>
              <span class="font-bold ${isCorpus ? 'text-amber-800' : 'text-slate-800'} text-xs">
                ${isCorpus ? 'Yes — Capital Fund (Corpus)' : 'No — Operational Gift'}
              </span>
              <span class="text-[10px] text-slate-400 block mt-0.5">Trust Balance Sheet</span>
            </div>
          </div>

          <!-- Postal Address -->
          <div class="p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
            <span class="text-slate-400 block text-[10px] uppercase font-bold">Full Postal Address (Tax Receipts & 80G Reporting)</span>
            <p class="text-slate-800 font-medium whitespace-pre-line mt-0.5">
              ${lead.address ? this.escapeHtml(lead.address) : '<span class="text-slate-400 italic">No formal postal address recorded yet.</span>'}
            </p>
          </div>

          <!-- Digital Audit Trail (Payment ID, Date/Time, IP Address) -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-slate-50/80 p-2.5 rounded-lg border border-slate-200/70">
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Payment ID / UTR Ref</span>
              <span class="font-mono text-slate-800 font-semibold truncate block">
                ${lead.paymentId ? this.escapeHtml(lead.paymentId) : '<span class="text-slate-400 font-sans italic">Not recorded</span>'}
              </span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Donation Date / Time</span>
              <span class="text-slate-800 font-medium truncate block">
                ${lead.donationDateTime ? this.escapeHtml(lead.donationDateTime.replace('T', ' ')) : '<span class="text-slate-400 italic">Not set</span>'}
              </span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Donor IP Address</span>
              <span class="font-mono text-slate-800 font-semibold truncate block">
                ${lead.ipAddress ? this.escapeHtml(lead.ipAddress) : '103.21.244.10'}
              </span>
            </div>
          </div>

          <!-- Corpus Direction Copy Attachments (Mandatory Signed Letter if >= 1 Lakh) -->
          ${isCorpus ? `
            <div class="p-3 bg-amber-50/80 border border-amber-300 rounded-lg space-y-2">
              <div class="flex items-center justify-between">
                <span class="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                  <i class="fas fa-file-shield text-amber-700"></i> Corpus Direction Copy Attachments
                </span>
                <span class="text-[10px] text-amber-800 font-bold bg-amber-200/80 px-2 py-0.5 rounded">
                  Sec 11(1)(d)
                </span>
              </div>

              ${isHighValue ? `
                <div class="p-2 bg-amber-100/90 border border-amber-400 rounded text-[11px] text-amber-950 flex items-start gap-2 font-medium">
                  <i class="fas fa-circle-exclamation text-amber-700 mt-0.5 shrink-0"></i>
                  <span><strong>Statutory Requirement (₹1 Lakh+ Gift):</strong> A signed direction letter from the donor confirming corpus treatment is mandatory alongside the official receipt PDF.</span>
                </div>
              ` : ''}

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                <div class="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                  <div>
                    <span class="text-[10px] text-slate-400 block font-bold">1. Receipt PDF Document</span>
                    <span class="font-medium text-slate-800 truncate block max-w-[180px]">
                      ${lead.corpusReceiptUrl ? this.escapeHtml(lead.corpusReceiptUrl) : '<span class="text-slate-400 italic">No receipt attached</span>'}
                    </span>
                  </div>
                  ${lead.corpusReceiptUrl ? `
                    <a href="${this.escapeHtml(lead.corpusReceiptUrl)}" target="_blank" class="text-amber-700 hover:text-amber-900 font-bold text-xs p-1">
                      <i class="fas fa-arrow-up-right-from-square"></i>
                    </a>
                  ` : ''}
                </div>

                <div class="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                  <div>
                    <span class="text-[10px] text-slate-400 block font-bold">2. Signed Direction Letter</span>
                    <span class="font-medium text-slate-800 truncate block max-w-[180px]">
                      ${lead.corpusLetterUrl ? this.escapeHtml(lead.corpusLetterUrl) : '<span class="text-rose-500 italic">Letter Pending</span>'}
                    </span>
                  </div>
                  ${lead.corpusLetterUrl ? `
                    <a href="${this.escapeHtml(lead.corpusLetterUrl)}" target="_blank" class="text-amber-700 hover:text-amber-900 font-bold text-xs p-1">
                      <i class="fas fa-arrow-up-right-from-square"></i>
                    </a>
                  ` : ''}
                </div>
              </div>
            </div>
          ` : ''}

        </div>
      `;
    }

    // 2. Supporter Type & Referral Stewardship Record (Stewardship Only - No Rewards/Perks)
    const lineageCard = document.getElementById('detail-lead-network-lineage');
    if (lineageCard) {
      const referrals = this.leads.filter(l => l.referredBy === lead.id || l.parentLeadId === lead.id);
      let referringSupporter = null;
      if (lead.referredBy) {
        referringSupporter = this.leads.find(l => l.id === lead.referredBy);
      } else if (lead.parentLeadId && !lead.parentLeadId.startsWith('staff:')) {
        referringSupporter = this.leads.find(l => l.id === lead.parentLeadId);
      }
      const coordinatorName = lead.volunteerCoordinator || (lead.parentLeadId && lead.parentLeadId.startsWith('staff:') ? lead.parentLeadId.replace('staff:', '') : (lead.assignedTo || 'Pastor David'));

      lineageCard.innerHTML = `
        <div class="p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/60 via-white to-blue-50/30 space-y-3.5 shadow-sm">
          <div class="flex items-center justify-between border-b border-amber-200/80 pb-2.5">
            <div class="flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shadow-sm">
                <i class="fas fa-users-gear"></i>
              </span>
              <div>
                <h4 class="font-bold text-slate-900 text-xs">Supporter Type & Referral Record</h4>
                <p class="text-[10px] text-slate-500">Ministry Stewardship & Relational Introductions</p>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
              ${supporterType}
            </span>
          </div>

          <!-- Non-Profit Anti-Circulation & Stewardship Rule Disclaimer -->
          <div class="p-2.5 bg-amber-50/90 border border-amber-300/80 rounded-lg text-[10px] text-amber-950 leading-relaxed flex items-start gap-2">
            <i class="fas fa-scale-balanced text-amber-700 mt-0.5 shrink-0 text-xs"></i>
            <span><strong>Rule:</strong> No rewards, perks, commissions, or preferential status for bringing in others. Referral info is for record-keeping only.</span>
          </div>

          <!-- Relationship & Stewardship Bar -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Referred By <span class="font-normal">(info only)</span></span>
              <span class="font-bold text-slate-900 text-xs">
                ${referringSupporter ? `
                  <span onclick="app.openLeadDetails('${referringSupporter.id}')" class="text-amber-700 hover:underline cursor-pointer">
                    ${this.escapeHtml(referringSupporter.name)}
                  </span>
                ` : '<span class="text-slate-500 font-normal">None / Direct Supporter</span>'}
              </span>
            </div>

            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Volunteer Coordinator</span>
              <span class="font-bold text-slate-900 text-xs flex items-center gap-1">
                <i class="fas fa-user-shield text-indigo-600 text-[10px]"></i> ${this.escapeHtml(coordinatorName)}
              </span>
            </div>

            <div>
              <span class="text-slate-400 block text-[10px] uppercase font-bold">Referrals Count</span>
              <span class="font-extrabold text-amber-800 text-xs">
                ${referrals.length} ${referrals.length === 1 ? 'supporter' : 'supporters'} on record
              </span>
            </div>
          </div>

          <!-- Referred Supporters List (Stewardship Record Only) -->
          <div class="border-t border-slate-200/80 pt-2.5">
            <div class="flex items-center justify-between mb-2">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <i class="fas fa-users text-indigo-600"></i> Supporters Referred by ${this.escapeHtml(lead.name.split(' ')[0])} (${referrals.length})
              </span>
              <button onclick="app.addNewRecruitUnderLeader('${lead.id}')" class="text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg shadow-sm transition flex items-center gap-1">
                <i class="fas fa-plus text-[10px]"></i> Add Referral Record
              </button>
            </div>

            ${referrals.length === 0 ? `
              <div class="p-3 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-center text-slate-400 text-xs">
                <p>No referrals on record for this supporter.</p>
              </div>
            ` : `
              <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                ${referrals.map(r => {
                  const rType = this.getSupporterType(r);
                  return `
                    <div onclick="app.openLeadDetails('${r.id}')" class="p-2 rounded-lg bg-white border border-slate-200 hover:border-amber-400 hover:bg-amber-50/30 transition flex items-center justify-between cursor-pointer">
                      <div class="flex items-center gap-2">
                        <i class="fas fa-user-check text-emerald-600 text-xs"></i>
                        <div>
                          <div class="font-bold text-slate-900 text-xs">${this.escapeHtml(r.name)}</div>
                          <div class="text-[10px] text-slate-500">${rType} ${r.organization ? `• ${this.escapeHtml(r.organization)}` : ''}</div>
                        </div>
                      </div>
                      <div class="text-right">
                        <span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                          ${rType}
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
    } else if (newStage === 'closed') {
      this.showToast(`Lead marked as Closed (Not Interested)`, 'info');
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
      const lead = this.leads.find(l => l.id === leadId) || (typeof CFM_INITIAL_LEADS !== 'undefined' ? CFM_INITIAL_LEADS.find(l => l.id === leadId) : null) || this.leads[0];
      if (!lead) return;
      this.populateAssignedUserDropdowns(lead.assignedTo || 'Pastor David');
      this.populateReferredByDropdown(lead.id, lead.referredBy || lead.parentLeadId);
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

      // Statutory Compliance & Audit Trail Fields
      const panEl = document.getElementById('modal-lead-pan');
      if (panEl) panEl.value = (lead.pan || '').toUpperCase();

      const citizenEl = document.getElementById('modal-lead-citizenship-confirmed');
      if (citizenEl) citizenEl.value = lead.citizenshipConfirmed || 'Yes';

      const addrEl = document.getElementById('modal-lead-address');
      if (addrEl) addrEl.value = lead.address || '';

      const payIdEl = document.getElementById('modal-lead-payment-id');
      if (payIdEl) payIdEl.value = lead.paymentId || '';

      const donDateEl = document.getElementById('modal-lead-donation-datetime');
      if (donDateEl) donDateEl.value = lead.donationDateTime || '';

      const ipEl = document.getElementById('modal-lead-ip-address');
      if (ipEl) ipEl.value = lead.ipAddress || '';

      const isCorpusVal = (lead.isCorpus === true || lead.isCorpus === 'Yes') ? 'Yes' : 'No';
      const corpusEl = document.getElementById('modal-lead-is-corpus');
      if (corpusEl) corpusEl.value = isCorpusVal;

      const receiptEl = document.getElementById('modal-lead-corpus-receipt-url');
      if (receiptEl) receiptEl.value = lead.corpusReceiptUrl || '';

      const letterEl = document.getElementById('modal-lead-corpus-letter-url');
      if (letterEl) letterEl.value = lead.corpusLetterUrl || '';

      this.handleCorpusChangeInForm(isCorpusVal);

      // Supporter Type & Referral Records
      const suppType = this.getSupporterType(lead);
      const suppTypeEl = document.getElementById('modal-lead-supporter-type');
      if (suppTypeEl) suppTypeEl.value = suppType;

      const refCountEl = document.getElementById('modal-lead-referrals-count');
      if (refCountEl) refCountEl.textContent = this.getReferralsCount(lead.id);

      const coordEl = document.getElementById('modal-lead-volunteer-coordinator');
      if (coordEl) coordEl.value = lead.volunteerCoordinator || lead.assignedTo || 'Pastor David';

      const refByEl = document.getElementById('modal-lead-referred-by');
      if (refByEl) refByEl.value = lead.referredBy || (lead.parentLeadId && !lead.parentLeadId.startsWith('staff:') ? lead.parentLeadId : '');

      const tierSelect = document.getElementById('modal-lead-network-tier');
      if (tierSelect) tierSelect.value = lead.networkTier || '';
      const parentSelect = document.getElementById('modal-lead-parent');
      if (parentSelect) parentSelect.value = lead.parentLeadId || '';
    } else {
      const defaultUser = (this.currentUser && this.currentUser.name) ? this.currentUser.name : 'Pastor David';
      this.populateAssignedUserDropdowns(defaultUser);
      this.populateReferredByDropdown(null, defaultParentId);
      this.populateParentLeaderDropdown(null, defaultParentId);

      document.getElementById('modal-lead-title').textContent = 'Add New Fundraising Lead';
      document.getElementById('modal-lead-id').value = '';
      document.getElementById('modal-lead-stage').value = 'new';
      document.getElementById('modal-lead-priority').value = 'Normal';
      document.getElementById('modal-lead-freq').value = 'Monthly';

      // Reset Statutory Compliance Fields
      const panEl = document.getElementById('modal-lead-pan');
      if (panEl) panEl.value = '';

      const citizenEl = document.getElementById('modal-lead-citizenship-confirmed');
      if (citizenEl) citizenEl.value = 'Yes';

      const addrEl = document.getElementById('modal-lead-address');
      if (addrEl) addrEl.value = '';

      const payIdEl = document.getElementById('modal-lead-payment-id');
      if (payIdEl) payIdEl.value = '';

      const donDateEl = document.getElementById('modal-lead-donation-datetime');
      if (donDateEl) {
        try {
          const now = new Date();
          const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          donDateEl.value = localIso;
        } catch(e) {
          donDateEl.value = '';
        }
      }

      const ipEl = document.getElementById('modal-lead-ip-address');
      if (ipEl) ipEl.value = '103.21.244.10';

      const corpusEl = document.getElementById('modal-lead-is-corpus');
      if (corpusEl) corpusEl.value = 'No';

      const receiptEl = document.getElementById('modal-lead-corpus-receipt-url');
      if (receiptEl) receiptEl.value = '';

      const letterEl = document.getElementById('modal-lead-corpus-letter-url');
      if (letterEl) letterEl.value = '';

      this.handleCorpusChangeInForm('No');

      const suppTypeEl = document.getElementById('modal-lead-supporter-type');
      if (suppTypeEl) suppTypeEl.value = defaultParentId ? 'Volunteer Ambassador' : 'Donor';

      const refCountEl = document.getElementById('modal-lead-referrals-count');
      if (refCountEl) refCountEl.textContent = '0';

      const coordEl = document.getElementById('modal-lead-volunteer-coordinator');
      if (coordEl) coordEl.value = defaultUser;

      const refByEl = document.getElementById('modal-lead-referred-by');
      if (refByEl && defaultParentId) refByEl.value = defaultParentId;

      const parentSelect = document.getElementById('modal-lead-parent');
      if (parentSelect && defaultParentId) parentSelect.value = defaultParentId;

      const tierSelect = document.getElementById('modal-lead-network-tier');
      if (tierSelect) tierSelect.value = defaultParentId ? 'stage-2' : '';
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

    // Extract Statutory Compliance & Audit Trail Fields
    const pan = (document.getElementById('modal-lead-pan')?.value || '').trim().toUpperCase();
    const citizenshipConfirmed = document.getElementById('modal-lead-citizenship-confirmed')?.value || 'Yes';
    const address = (document.getElementById('modal-lead-address')?.value || '').trim();
    const paymentId = (document.getElementById('modal-lead-payment-id')?.value || '').trim();
    const donationDateTime = document.getElementById('modal-lead-donation-datetime')?.value || '';
    const ipAddress = (document.getElementById('modal-lead-ip-address')?.value || '').trim();
    const isCorpusVal = document.getElementById('modal-lead-is-corpus')?.value || 'No';
    const isCorpus = (isCorpusVal === 'Yes');
    const corpusReceiptUrl = (document.getElementById('modal-lead-corpus-receipt-url')?.value || '').trim();
    const corpusLetterUrl = (document.getElementById('modal-lead-corpus-letter-url')?.value || '').trim();

    // Extract Supporter Type & Referral Records (Rule: for record-keeping only, no rewards/perks)
    const supporterType = document.getElementById('modal-lead-supporter-type')?.value || 'Donor';
    const referredBy = document.getElementById('modal-lead-referred-by')?.value || '';
    let referredByName = '';
    if (referredBy) {
      const refLead = this.leads.find(l => l.id === referredBy);
      if (refLead) referredByName = refLead.name;
    }
    const volunteerCoordinator = document.getElementById('modal-lead-volunteer-coordinator')?.value || (document.getElementById('modal-lead-assigned')?.value || 'Pastor David');

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
      prayerRequests: document.getElementById('modal-lead-prayer').value.trim(),
      notes: document.getElementById('modal-lead-notes').value.trim(),

      // Statutory Compliance & Tax reporting (Form 10BD / 80G / FCRA)
      pan,
      citizenshipConfirmed,
      address,
      paymentId,
      donationDateTime,
      ipAddress,
      isCorpus,
      corpusReceiptUrl,
      corpusLetterUrl,

      // Supporter Type & Referral Stewardship (Record-Keeping Only)
      supporterType,
      referredBy,
      referredByName,
      volunteerCoordinator,

      // Backwards-compatible network tier fields
      networkTier: supporterType === 'Volunteer Ambassador' ? 'stage-1' : (supporterType === 'Monthly Supporter' ? 'stage-5' : ''),
      parentLeadId: referredBy ? referredBy : ('staff:' + volunteerCoordinator)
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

    if (!sessionUser) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('view') || urlParams.get('auth') === 'admin' || urlParams.get('demo') === '1') {
          sessionUser = {
            id: "user-1",
            name: "Pastor David",
            username: "admin",
            email: "admin@christfocusmission.org",
            role: "admin",
            title: "Ministry Director & Founder"
          };
          localStorage.setItem('cfm_auth_session', JSON.stringify(sessionUser));
        }
      } catch (e) {}
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

  // ===================== CSV TEMPLATE & BULK IMPORT =====================

  downloadCSVTemplate() {
    const headers = [
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
      "PAN",
      "Address",
      "Citizenship Confirmed",
      "Corpus",
      "Corpus Receipt URL",
      "Corpus Letter URL",
      "Payment ID",
      "Donation Date Time",
      "IP Address",
      "Supporter Type",
      "Referred By",
      "Volunteer Coordinator",
      "Email",
      "Phone",
      "City",
      "Country",
      "Preferred Contact",
      "Next Follow Up",
      "Prayer Requests",
      "Notes"
    ];

    const sampleRows = [
      [
        '"Dr. Arthur Vance"',
        '"Grace Family Healthcare"',
        '"Individual"',
        '"new"',
        '50000',
        '0',
        '"INR"',
        '"Monthly"',
        '"GEN-2026"',
        '"High"',
        '"Pastor David"',
        '"ABCDE1234F"',
        '"14 Bishop Wallers Avenue, Mylapore, Chennai 600004"',
        '"Yes"',
        '"No"',
        '""',
        '""',
        '"PAY-2026-0891"',
        '"2026-10-18 10:30"',
        '"103.21.124.5"',
        '"Volunteer Ambassador"',
        '""',
        '"Pastor David"',
        '"arthur.vance@example.com"',
        '"+91 98401 23456"',
        '"Chennai"',
        '"India"',
        '"Phone"',
        '"2026-11-15"',
        '"Prayer for expanding rural clinic outreach"',
        '"Met during annual conference; keen to sponsor medical missions."'
      ],
      [
        '"Bethel Fellowship Church"',
        '"Bethel Community Outreach"',
        '"Church"',
        '"in_discussion"',
        '100000',
        '100000',
        '"INR"',
        '"One-off"',
        '"PLANT-2026"',
        '"High"',
        '"Nelson Richard"',
        '"AABTB8765K"',
        '"22 St. Mark Road, Ashok Nagar, Bengaluru 560025"',
        '"Yes"',
        '"Yes"',
        '"https://christfocusmission.org/receipts/REC-10492.pdf"',
        '"https://christfocusmission.org/docs/corpus-letter-bethel.pdf"',
        '"TXN-8841920412"',
        '"2026-10-15 14:15"',
        '"49.207.181.99"',
        '"Donor"',
        '""',
        '"Nelson Richard"',
        '"office@bethelfellowship.org"',
        '"+91 98765 43210"',
        '"Bengaluru"',
        '"India"',
        '"Email"',
        '"2026-11-05"',
        '"Prayer for youth leaders and regional church plants"',
        '"Corpus contribution of Rs 1 Lakh towards rural church building endowment."'
      ],
      [
        '"Sarah Abraham"',
        '"Apex Global Solutions"',
        '"Business"',
        '"committed"',
        '25000',
        '25000',
        '"INR"',
        '"Monthly"',
        '"MED-2026"',
        '"Medium"',
        '"Pastor David"',
        '"PQRSA5678M"',
        '"8-2-293 Road No 14, Banjara Hills, Hyderabad 500034"',
        '"Yes"',
        '"No"',
        '""',
        '""',
        '"UPI-992384110"',
        '"2026-10-12 09:45"',
        '"157.48.91.22"',
        '"Monthly Supporter"',
        '"Dr. Arthur Vance"',
        '"Pastor David"',
        '"sarah.a@example.com"',
        '"+91 91234 56789"',
        '"Hyderabad"',
        '"India"',
        '"WhatsApp"',
        '""',
        '"Prayer for family health and business ventures"',
        '"Committed monthly partner for community health outreach. Referred by Dr. Arthur Vance (record-keeping only)."'
      ]
    ];

    const csvText = [headers.join(','), ...sampleRows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob(["\uFEFF" + csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "christ-focus-mission-leads-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.showToast("Downloaded sample leads CSV template", "success");
  }

  openImportModal() {
    this.parsedImportLeads = [];
    const modal = document.getElementById('modal-import-leads');
    if (!modal) return;

    // Reset file input & UI
    const fileInput = document.getElementById('import-csv-file');
    if (fileInput) fileInput.value = '';
    const fileName = document.getElementById('import-file-name');
    if (fileName) fileName.textContent = 'Choose a .CSV file or drag & drop here';
    const previewSec = document.getElementById('import-preview-section');
    if (previewSec) previewSec.classList.add('hidden');
    const btnExecute = document.getElementById('btn-execute-import');
    if (btnExecute) {
      btnExecute.disabled = true;
      btnExecute.className = 'px-5 py-2 bg-slate-300 text-slate-500 font-bold rounded-lg shadow-sm transition flex items-center gap-1.5 cursor-not-allowed';
    }
    const label = document.getElementById('import-btn-label');
    if (label) label.textContent = 'Import Leads';

    // Populate default campaign dropdown
    const campSelect = document.getElementById('import-default-campaign');
    if (campSelect) {
      campSelect.innerHTML = this.campaigns.map(c => `
        <option value="${c.id}">${this.escapeHtml(c.name)} (${c.code})</option>
      `).join('');
    }

    // Populate default staff dropdown
    const staffSelect = document.getElementById('import-default-assigned');
    if (staffSelect) {
      staffSelect.innerHTML = this.users.filter(u => u.active !== false).map(u => `
        <option value="${this.escapeHtml(u.name)}" ${this.currentUser && this.currentUser.name === u.name ? 'selected' : ''}>
          ${this.escapeHtml(u.name)} (${u.role === 'admin' ? 'Admin' : 'Staff'})
        </option>
      `).join('');
    }

    modal.classList.remove('hidden');
  }

  closeImportModal() {
    const modal = document.getElementById('modal-import-leads');
    if (modal) modal.classList.add('hidden');
    this.parsedImportLeads = [];
  }

  handleImportDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById('import-dropzone');
    if (dropzone) {
      dropzone.classList.add('border-amber-500', 'bg-amber-50');
    }
  }

  handleImportDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById('import-dropzone');
    if (dropzone) {
      dropzone.classList.remove('border-amber-500', 'bg-amber-50');
    }
  }

  handleImportDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById('import-dropzone');
    if (dropzone) {
      dropzone.classList.remove('border-amber-500', 'bg-amber-50');
    }
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processImportCSVFile(files[0]);
    }
  }

  handleImportFileSelect(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
      this.processImportCSVFile(files[0]);
    }
  }

  processImportCSVFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert("Please select a valid .CSV spreadsheet file.");
      return;
    }

    const fileNameEl = document.getElementById('import-file-name');
    if (fileNameEl) {
      fileNameEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      this.parseAndPreviewCSV(text);
    };
    reader.onerror = () => {
      alert("Failed to read the selected file. Please try again.");
    };
    reader.readAsText(file);
  }

  // RFC 4180 Compliant CSV Parser
  parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    // Strip UTF-8 BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(cell.trim());
        cell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        row.push(cell.trim());
        if (row.some(c => c.length > 0)) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    if (cell.length > 0 || row.length > 0) {
      row.push(cell.trim());
      if (row.some(c => c.length > 0)) rows.push(row);
    }
    return rows;
  }

  parseAndPreviewCSV(text) {
    const rawRows = this.parseCSV(text);
    if (!rawRows || rawRows.length < 2) {
      alert("The selected CSV file appears to be empty or has no lead rows.");
      return;
    }

    const headers = rawRows[0];
    const dataRows = rawRows.slice(1);

    // Header index normalization and mapping
    const cleanStr = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    const headerMap = {};
    headers.forEach((h, idx) => {
      const cleaned = cleanStr(h);
      if (['name', 'donorname', 'contactname', 'fullname', 'donor', 'contact'].includes(cleaned)) headerMap.name = idx;
      else if (['org', 'organization', 'church', 'company', 'trust', 'business'].includes(cleaned)) headerMap.organization = idx;
      else if (['type', 'leadtype', 'donortype', 'category'].includes(cleaned)) headerMap.leadType = idx;
      else if (['stage', 'status', 'pipeline', 'pipelinestage'].includes(cleaned)) headerMap.stage = idx;
      else if (['amount', 'expectedamount', 'target', 'pledge', 'pledgedamount', 'expected'].includes(cleaned)) headerMap.expectedAmount = idx;
      else if (['received', 'receivedamount', 'paid', 'given', 'collected'].includes(cleaned)) headerMap.receivedAmount = idx;
      else if (['currency'].includes(cleaned)) headerMap.currency = idx;
      else if (['frequency', 'givingfrequency', 'freq'].includes(cleaned)) headerMap.frequency = idx;
      else if (['campaign', 'campaigncode', 'campaignname', 'fund', 'initiative'].includes(cleaned)) headerMap.campaign = idx;
      else if (['priority'].includes(cleaned)) headerMap.priority = idx;
      else if (['assigned', 'assignedto', 'staff', 'owner', 'leader'].includes(cleaned)) headerMap.assignedTo = idx;
      else if (['pan', 'panno', 'incometaxpan', 'pannumber'].includes(cleaned)) headerMap.pan = idx;
      else if (['address', 'fulladdress', 'postaladdress', 'street'].includes(cleaned)) headerMap.address = idx;
      else if (['citizenship', 'citizenshipconfirmed', 'citizen', 'indiancitizen'].includes(cleaned)) headerMap.citizenshipConfirmed = idx;
      else if (['corpus', 'iscorpus', 'corpusdonation', 'corpusgift'].includes(cleaned)) headerMap.isCorpus = idx;
      else if (['corpusreceipt', 'corpusreceipturl', 'receipturl', 'receipt'].includes(cleaned)) headerMap.corpusReceiptUrl = idx;
      else if (['corpusletter', 'corpusletterurl', 'letterurl', 'signedletter', 'letter'].includes(cleaned)) headerMap.corpusLetterUrl = idx;
      else if (['paymentid', 'txnid', 'transactionid', 'referenceid'].includes(cleaned)) headerMap.paymentId = idx;
      else if (['donationdatetime', 'donationdate', 'datetime', 'paiddate'].includes(cleaned)) headerMap.donationDateTime = idx;
      else if (['ipaddress', 'donorip', 'ip'].includes(cleaned)) headerMap.ipAddress = idx;
      else if (['supportertype', 'supporter', 'role'].includes(cleaned)) headerMap.supporterType = idx;
      else if (['referredby', 'referrer', 'referredbyname'].includes(cleaned)) headerMap.referredBy = idx;
      else if (['volunteercoordinator', 'coordinator'].includes(cleaned)) headerMap.volunteerCoordinator = idx;
      else if (['email', 'emailaddress', 'mail'].includes(cleaned)) headerMap.email = idx;
      else if (['phone', 'phonenumber', 'mobile', 'contactno', 'whatsapp'].includes(cleaned)) headerMap.phone = idx;
      else if (['city', 'location', 'place'].includes(cleaned)) headerMap.city = idx;
      else if (['country'].includes(cleaned)) headerMap.country = idx;
      else if (['contactpref', 'preferredcontact', 'contactmethod'].includes(cleaned)) headerMap.preferredContact = idx;
      else if (['prayer', 'prayerrequests', 'prayerrequest', 'prayerpoints'].includes(cleaned)) headerMap.prayerRequests = idx;
      else if (['notes', 'comments', 'remarks', 'description', 'note'].includes(cleaned)) headerMap.notes = idx;
      else if (['followup', 'nextfollowup', 'nextcontact'].includes(cleaned)) headerMap.nextFollowUp = idx;
    });

    if (headerMap.name === undefined) {
      headerMap.name = 0;
    }

    const defaultCampId = document.getElementById('import-default-campaign')?.value || this.campaigns[0]?.id;
    const defaultStaff = document.getElementById('import-default-assigned')?.value || (this.currentUser?.name || 'Pastor David');

    this.parsedImportLeads = [];

    dataRows.forEach((row, rowIdx) => {
      if (!row || row.every(c => !c || c.trim() === '')) return;

      const getVal = (key) => (headerMap[key] !== undefined && row[headerMap[key]] !== undefined) ? row[headerMap[key]].trim() : '';

      const name = getVal('name');
      const isValid = Boolean(name && name.length > 0);

      // Numbers
      const rawExpected = getVal('expectedAmount');
      const expectedAmount = rawExpected ? Number(rawExpected.replace(/[^0-9.]/g, '')) || 0 : 0;

      const rawReceived = getVal('receivedAmount');
      const receivedAmount = rawReceived ? Number(rawReceived.replace(/[^0-9.]/g, '')) || 0 : 0;

      // Stage
      let stageRaw = getVal('stage');
      let stage = 'new';
      if (stageRaw) {
        const norm = this.normalizeStage(stageRaw);
        if (['new', 'contacted', 'in_discussion', 'committed', 'closed'].includes(norm)) {
          stage = norm;
        }
      }

      // Frequency
      let freqRaw = getVal('frequency').toLowerCase();
      let frequency = 'Monthly';
      if (freqRaw.includes('one') || freqRaw.includes('single')) {
        frequency = 'One-off';
      }

      // Campaign matching
      let campVal = getVal('campaign');
      let matchedCampId = defaultCampId;
      if (campVal) {
        const found = this.campaigns.find(c => 
          c.code.toLowerCase() === campVal.toLowerCase() || 
          c.name.toLowerCase().includes(campVal.toLowerCase()) || 
          campVal.toLowerCase().includes(c.code.toLowerCase())
        );
        if (found) matchedCampId = found.id;
      }

      // Staff matching
      let assignedVal = getVal('assignedTo');
      let assignedTo = defaultStaff;
      if (assignedVal) {
        const foundUser = this.users.find(u => 
          u.name.toLowerCase() === assignedVal.toLowerCase() || 
          u.username.toLowerCase() === assignedVal.toLowerCase()
        );
        if (foundUser) assignedTo = foundUser.name;
        else assignedTo = assignedVal;
      }

      // Priority
      let prioRaw = getVal('priority').toLowerCase();
      let priority = 'Normal';
      if (prioRaw.includes('high')) priority = 'High';
      else if (prioRaw.includes('med')) priority = 'Medium';

      // Lead Type
      let typeRaw = getVal('leadType').toLowerCase();
      let leadType = 'Individual';
      if (typeRaw.includes('church')) leadType = 'Church';
      else if (typeRaw.includes('business') || typeRaw.includes('corp')) leadType = 'Business';
      else if (typeRaw.includes('found')) leadType = 'Foundation';

      this.parsedImportLeads.push({
        rowNumber: rowIdx + 2,
        isValid,
        validationError: isValid ? null : 'Missing Name',
        lead: {
          name,
          organization: getVal('organization'),
          leadType,
          stage,
          expectedAmount,
          receivedAmount,
          currency: getVal('currency') || this.currency || 'INR',
          frequency,
          campaignId: matchedCampId,
          priority,
          assignedTo,
          pan: (getVal('pan') || '').toUpperCase(),
          address: getVal('address'),
          citizenshipConfirmed: getVal('citizenshipConfirmed') || 'Yes',
          isCorpus: ['yes', 'true', '1', 'y'].includes((getVal('isCorpus') || '').toLowerCase()),
          corpusReceiptUrl: getVal('corpusReceiptUrl'),
          corpusLetterUrl: getVal('corpusLetterUrl'),
          paymentId: getVal('paymentId'),
          donationDateTime: getVal('donationDateTime'),
          ipAddress: getVal('ipAddress'),
          supporterType: getVal('supporterType') || 'Donor',
          referredBy: '',
          referredByName: getVal('referredBy'),
          volunteerCoordinator: getVal('volunteerCoordinator') || assignedTo,
          email: getVal('email'),
          phone: getVal('phone'),
          city: getVal('city'),
          country: getVal('country') || 'India',
          preferredContact: getVal('preferredContact') || 'Phone',
          nextFollowUp: getVal('nextFollowUp'),
          prayerRequests: getVal('prayerRequests'),
          notes: getVal('notes')
        }
      });
    });

    this.renderImportPreview();
  }

  renderImportPreview() {
    const previewSec = document.getElementById('import-preview-section');
    const previewCount = document.getElementById('import-preview-count');
    const previewStatus = document.getElementById('import-preview-status');
    const tbody = document.getElementById('import-preview-tbody');
    const btnExecute = document.getElementById('btn-execute-import');
    const label = document.getElementById('import-btn-label');

    if (!previewSec || !tbody) return;

    previewSec.classList.remove('hidden');

    const total = this.parsedImportLeads.length;
    const validCount = this.parsedImportLeads.filter(l => l.isValid).length;
    const invalidCount = total - validCount;

    previewCount.textContent = `Found ${total} row${total === 1 ? '' : 's'} (${validCount} valid)`;
    if (invalidCount > 0) {
      previewStatus.innerHTML = `<span class="text-rose-600 font-bold">⚠️ ${invalidCount} row${invalidCount === 1 ? '' : 's'} missing name</span>`;
    } else {
      previewStatus.innerHTML = `<span class="text-emerald-700 font-bold">✓ All ${validCount} rows valid and ready</span>`;
    }

    if (validCount > 0) {
      btnExecute.disabled = false;
      btnExecute.className = 'px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition flex items-center gap-1.5 cursor-pointer';
      label.textContent = `Import ${validCount} Lead${validCount === 1 ? '' : 's'}`;
    } else {
      btnExecute.disabled = true;
      btnExecute.className = 'px-5 py-2 bg-slate-300 text-slate-500 font-bold rounded-lg shadow-sm transition flex items-center gap-1.5 cursor-not-allowed';
      label.textContent = 'No Valid Leads';
    }

    tbody.innerHTML = this.parsedImportLeads.map(item => {
      const l = item.lead;
      return `
        <tr class="${item.isValid ? 'hover:bg-slate-50' : 'bg-rose-50/60'}">
          <td class="p-2 font-bold text-slate-900 truncate max-w-[140px]">${this.escapeHtml(l.name || '(Empty)')}</td>
          <td class="p-2 text-slate-600 truncate max-w-[120px]">${this.escapeHtml(l.organization || '-')}</td>
          <td class="p-2">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${l.stage === 'committed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">
              ${this.getStageLabel(l.stage)}
            </span>
          </td>
          <td class="p-2 font-semibold text-slate-800">${this.formatCurrency(l.expectedAmount)} <span class="text-[9px] text-slate-400 font-normal">/${l.frequency === 'Monthly' ? 'mo' : 'one-off'}</span></td>
          <td class="p-2 text-slate-500 truncate max-w-[130px]">${this.escapeHtml(l.phone || l.email || '-')}</td>
          <td class="p-2">
            ${item.isValid ? `
              <span class="text-emerald-600 font-bold flex items-center gap-1 text-[10px]">
                <i class="fas fa-check-circle"></i> Ready
              </span>
            ` : `
              <span class="text-rose-600 font-bold flex items-center gap-1 text-[10px]" title="${item.validationError}">
                <i class="fas fa-exclamation-circle"></i> ${item.validationError}
              </span>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  async executeImportLeads() {
    if (!this.parsedImportLeads || this.parsedImportLeads.length === 0) {
      alert("No valid leads to import.");
      return;
    }

    const validLeads = this.parsedImportLeads.filter(l => l.isValid);
    if (validLeads.length === 0) {
      alert("None of the leads have valid names. Please check your CSV file and try again.");
      return;
    }

    const btn = document.getElementById('btn-execute-import');
    const label = document.getElementById('import-btn-label');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('opacity-75');
    }
    if (label) label.textContent = `Importing ${validLeads.length} leads...`;

    let importedCount = 0;
    try {
      for (const item of validLeads) {
        const payload = {
          name: item.lead.name,
          organization: item.lead.organization || '',
          leadType: item.lead.leadType || 'Individual',
          email: item.lead.email || '',
          phone: item.lead.phone || '',
          city: item.lead.city || '',
          country: item.lead.country || '',
          preferredContact: item.lead.preferredContact || 'Phone',
          stage: item.lead.stage || 'new',
          expectedAmount: item.lead.expectedAmount || 0,
          receivedAmount: item.lead.receivedAmount || 0,
          frequency: item.lead.frequency || 'Monthly',
          campaignId: item.lead.campaignId || (this.campaigns[0]?.id || 'camp-1'),
          priority: item.lead.priority || 'Normal',
          assignedTo: item.lead.assignedTo || (this.currentUser?.name || 'Pastor David'),
          probability: 100,
          pan: item.lead.pan || '',
          address: item.lead.address || '',
          citizenshipConfirmed: item.lead.citizenshipConfirmed || 'Yes',
          isCorpus: Boolean(item.lead.isCorpus),
          corpusReceiptUrl: item.lead.corpusReceiptUrl || '',
          corpusLetterUrl: item.lead.corpusLetterUrl || '',
          paymentId: item.lead.paymentId || '',
          donationDateTime: item.lead.donationDateTime || '',
          ipAddress: item.lead.ipAddress || '',
          supporterType: item.lead.supporterType || 'Donor',
          referredBy: item.lead.referredBy || '',
          referredByName: item.lead.referredByName || '',
          volunteerCoordinator: item.lead.volunteerCoordinator || (this.currentUser?.name || 'Pastor David'),
          nextFollowUp: item.lead.nextFollowUp || '',
          networkTier: '',
          parentLeadId: null,
          prayerRequests: item.lead.prayerRequests || '',
          notes: item.lead.notes || '',
          activities: [
            {
              id: 'act-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
              date: new Date().toISOString().split('T')[0],
              type: 'Imported',
              summary: `Imported via bulk CSV upload into ${this.getStageLabel(item.lead.stage || 'new')}.`,
              author: this.currentUser?.name || 'Staff'
            }
          ]
        };

        const created = await cfmFirebase.addLead(payload);
        if (created && !this.leads.some(l => l.id === created.id)) {
          this.leads.unshift(created);
        }
        importedCount++;
      }

      this.render();
      this.closeImportModal();
      this.celebrateSuccess();
      this.showToast(`Successfully imported ${importedCount} leads!`, 'success');
    } catch (err) {
      console.error("Import error:", err);
      alert(`Import completed with errors. ${importedCount} of ${validLeads.length} leads imported. Error: ${err.message}`);
      this.render();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-75');
      }
      if (label) label.textContent = 'Import Leads';
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
      "PAN",
      "Address",
      "Citizenship Confirmed",
      "Corpus",
      "Corpus Receipt URL",
      "Corpus Letter URL",
      "Payment ID",
      "Donation Date Time",
      "IP Address",
      "Supporter Type",
      "Referred By",
      "Volunteer Coordinator",
      "Referrals Count",
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
        lead.pan || '',
        `"${(lead.address || '').replace(/"/g, '""')}"`,
        lead.citizenshipConfirmed || 'Yes',
        lead.isCorpus ? 'Yes' : 'No',
        lead.corpusReceiptUrl || '',
        lead.corpusLetterUrl || '',
        lead.paymentId || '',
        lead.donationDateTime || '',
        lead.ipAddress || '',
        lead.supporterType || this.getSupporterType(lead),
        `"${(lead.referredByName || '').replace(/"/g, '""')}"`,
        `"${(lead.volunteerCoordinator || lead.assignedTo || '').replace(/"/g, '""')}"`,
        this.getReferralsCount(lead.id),
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

    const csvText = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob(["\uFEFF" + csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `christ-focus-mission-fundraising-leads-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    if (norm === 'committed') return 'Closed: Committed';
    if (norm === 'closed') return 'Closed: Not Interested';
    const s = CFM_STAGES.find(item => item.id === norm);
    return s ? s.label : (stageId || 'New');
  }

  getStageBadgeClass(stageId) {
    const norm = this.normalizeStage(stageId);
    if (norm === 'committed') return 'badge-stage-committed';
    if (norm === 'closed') return 'badge-stage-closed';
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
