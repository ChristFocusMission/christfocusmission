/**
 * Christ Focus Mission - Firebase Configuration & Sync Service
 * Supports both Live Firebase Cloud Firestore and Local/Demo Mode
 */

const CFM_STORAGE_KEYS = {
  FIREBASE_CONFIG: 'cfm_firebase_config',
  LOCAL_LEADS: 'cfm_fundraising_leads_local',
  LOCAL_CAMPAIGNS: 'cfm_fundraising_campaigns_local',
  LOCAL_USERS: 'cfm_fundraising_users_local',
  ACTIVE_CURRENCY: 'cfm_active_currency'
};

class FirebaseService {
  constructor() {
    this.app = null;
    this.db = null;
    this.isLive = false;
    this.statusMessage = 'Initializing...';
    this.leadSubscribers = [];
    this.campaignSubscribers = [];
    this.userSubscribers = [];
    this.leadsCollection = 'cfm_leads';
    this.campaignsCollection = 'cfm_campaigns';
    this.usersCollection = 'cfm_users';
  }

  // Notify registered subscribers of updated leads
  notifyLeadSubscribers(leads, source = 'local') {
    if (!Array.isArray(this.leadSubscribers)) return;
    this.leadSubscribers.forEach(cb => {
      try {
        if (typeof cb === 'function') cb(leads, source);
      } catch (err) {
        console.error("Error in lead subscriber callback:", err);
      }
    });
  }

  // Notify registered subscribers of updated campaigns
  notifyCampaignSubscribers(campaigns, source = 'local') {
    if (!Array.isArray(this.campaignSubscribers)) return;
    this.campaignSubscribers.forEach(cb => {
      try {
        if (typeof cb === 'function') cb(campaigns, source);
      } catch (err) {
        console.error("Error in campaign subscriber callback:", err);
      }
    });
  }

  // Notify registered subscribers of updated users
  notifyUserSubscribers(users, source = 'local') {
    if (!Array.isArray(this.userSubscribers)) return;
    this.userSubscribers.forEach(cb => {
      try {
        if (typeof cb === 'function') cb(users, source);
      } catch (err) {
        console.error("Error in user subscriber callback:", err);
      }
    });
  }

  // Get current stored configuration or null
  getSavedConfig() {
    try {
      const saved = localStorage.getItem(CFM_STORAGE_KEYS.FIREBASE_CONFIG);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn("Could not read saved firebase config:", e);
      return null;
    }
  }

  // Save config
  saveConfig(config) {
    if (!config) {
      localStorage.removeItem(CFM_STORAGE_KEYS.FIREBASE_CONFIG);
    } else {
      localStorage.setItem(CFM_STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(config));
    }
  }

  // Initialize service
  async init() {
    const config = this.getSavedConfig();
    if (config && config.projectId && config.apiKey && typeof firebase !== 'undefined') {
      try {
        if (!firebase.apps.length) {
          this.app = firebase.initializeApp(config);
        } else {
          this.app = firebase.app();
        }
        this.db = firebase.firestore();
        if (typeof firebase.auth === 'function') {
          this.auth = firebase.auth();
        }
        this.isLive = true;
        this.statusMessage = `Connected to Firebase Project: ${config.projectId}`;
        console.log("Firebase Live Mode initialized successfully:", config.projectId);
        return { success: true, mode: 'live', projectId: config.projectId };
      } catch (err) {
        console.error("Firebase init failed, reverting to local mode:", err);
        this.isLive = false;
        this.statusMessage = `Connection error: ${err.message}. Falling back to Local Mode.`;
        return { success: false, mode: 'local', error: err.message };
      }
    } else {
      this.isLive = false;
      this.statusMessage = 'Running in Local / Demo Mode (Ready to link Firebase)';
      return { success: true, mode: 'local' };
    }
  }

  // Get Firebase Auth instance if initialized
  getAuth() {
    if (this.auth) return this.auth;
    if (typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && firebase.apps.length) {
      try {
        this.auth = firebase.auth();
        return this.auth;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // Test custom configuration before saving
  async testConnection(config) {
    if (!config || !config.apiKey || !config.projectId) {
      throw new Error("API Key and Project ID are required.");
    }

    if (typeof firebase === 'undefined') {
      throw new Error("Firebase SDK is not loaded. Please verify your internet connection.");
    }

    let testApp = null;
    const testAppName = `test-app-${Date.now()}`;
    try {
      testApp = firebase.initializeApp(config, testAppName);
      const testDb = testApp.firestore();
      // Try to read 1 doc from collection to verify rules & credentials
      await testDb.collection(this.leadsCollection).limit(1).get();
      await testApp.delete();
      return { success: true, message: `Successfully connected to Firestore project: ${config.projectId}` };
    } catch (err) {
      if (testApp) {
        try { await testApp.delete(); } catch(e) {}
      }
      // If error is permission-denied, it means the project exists and connected, but rules need to allow read/write
      if (err.code === 'permission-denied') {
        return {
          success: false,
          warning: true,
          message: `Connected to project "${config.projectId}", but Firestore Security Rules blocked access. Ensure your rules allow read/write (e.g., test mode: allow read, write: if true;)`
        };
      }
      throw err;
    }
  }

  // Subscribe to real-time leads updates
  subscribeToLeads(callback) {
    if (typeof callback === 'function' && !this.leadSubscribers.includes(callback)) {
      this.leadSubscribers.push(callback);
    }

    if (this.isLive && this.db) {
      try {
        const unsubscribe = this.db.collection(this.leadsCollection)
          .orderBy('createdAt', 'desc')
          .onSnapshot(
            (snapshot) => {
              const leads = [];
              snapshot.forEach((doc) => {
                leads.push({ id: doc.id, ...doc.data() });
              });
              try {
                localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_LEADS, JSON.stringify(leads));
              } catch (e) {}
              this.notifyLeadSubscribers(leads, 'live');
            },
            (error) => {
              console.error("Firestore onSnapshot error:", error);
              const fallback = this.getLocalLeads();
              this.notifyLeadSubscribers(fallback, 'fallback-error');
            }
          );
        // Also invoke immediately with cached leads for instant load
        const initial = this.getLocalLeads();
        callback(initial, 'live-initial');
        return () => {
          unsubscribe();
          this.leadSubscribers = this.leadSubscribers.filter(cb => cb !== callback);
        };
      } catch (err) {
        console.error("Firestore subscription setup error:", err);
        const leads = this.getLocalLeads();
        callback(leads, 'local');
        return () => {
          this.leadSubscribers = this.leadSubscribers.filter(cb => cb !== callback);
        };
      }
    } else {
      // Local mode
      const leads = this.getLocalLeads();
      callback(leads, 'local');
      return () => {
        this.leadSubscribers = this.leadSubscribers.filter(cb => cb !== callback);
      };
    }
  }

  // Subscribe to campaigns
  subscribeToCampaigns(callback) {
    if (typeof callback === 'function' && !this.campaignSubscribers.includes(callback)) {
      this.campaignSubscribers.push(callback);
    }

    if (this.isLive && this.db) {
      try {
        const unsubscribe = this.db.collection(this.campaignsCollection)
          .onSnapshot(
            (snapshot) => {
              const campaigns = [];
              snapshot.forEach((doc) => {
                campaigns.push({ id: doc.id, ...doc.data() });
              });
              if (campaigns.length === 0) {
                this.seedInitialRemoteCampaigns().then(() => {
                  this.notifyCampaignSubscribers(this.getLocalCampaigns(), 'live-seeded');
                });
              } else {
                try {
                  localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_CAMPAIGNS, JSON.stringify(campaigns));
                } catch (e) {}
                this.notifyCampaignSubscribers(campaigns, 'live');
              }
            },
            (error) => {
              console.error("Campaigns subscription error:", error);
              this.notifyCampaignSubscribers(this.getLocalCampaigns(), 'fallback-error');
            }
          );
        const initial = this.getLocalCampaigns();
        callback(initial, 'live-initial');
        return () => {
          unsubscribe();
          this.campaignSubscribers = this.campaignSubscribers.filter(cb => cb !== callback);
        };
      } catch (err) {
        const campaigns = this.getLocalCampaigns();
        callback(campaigns, 'local');
        return () => {
          this.campaignSubscribers = this.campaignSubscribers.filter(cb => cb !== callback);
        };
      }
    } else {
      const campaigns = this.getLocalCampaigns();
      callback(campaigns, 'local');
      return () => {
        this.campaignSubscribers = this.campaignSubscribers.filter(cb => cb !== callback);
      };
    }
  }

  // Subscribe to users
  subscribeToUsers(callback) {
    if (typeof callback === 'function' && !this.userSubscribers.includes(callback)) {
      this.userSubscribers.push(callback);
    }

    if (this.isLive && this.db) {
      try {
        const unsubscribe = this.db.collection(this.usersCollection)
          .onSnapshot(
            (snapshot) => {
              const users = [];
              snapshot.forEach((doc) => {
                users.push({ id: doc.id, ...doc.data() });
              });
              if (users.length === 0) {
                this.seedInitialRemoteUsers().then(() => {
                  this.notifyUserSubscribers(this.getLocalUsers(), 'live-seeded');
                });
              } else {
                try {
                  localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_USERS, JSON.stringify(users));
                } catch (e) {}
                this.notifyUserSubscribers(users, 'live');
              }
            },
            (error) => {
              console.error("Users subscription error:", error);
              this.notifyUserSubscribers(this.getLocalUsers(), 'fallback-error');
            }
          );
        const initial = this.getLocalUsers();
        callback(initial, 'live-initial');
        return () => {
          unsubscribe();
          this.userSubscribers = this.userSubscribers.filter(cb => cb !== callback);
        };
      } catch (err) {
        const users = this.getLocalUsers();
        callback(users, 'local');
        return () => {
          this.userSubscribers = this.userSubscribers.filter(cb => cb !== callback);
        };
      }
    } else {
      const users = this.getLocalUsers();
      callback(users, 'local');
      return () => {
        this.userSubscribers = this.userSubscribers.filter(cb => cb !== callback);
      };
    }
  }

  // Local storage helpers
  getLocalUsers() {
    try {
      const stored = localStorage.getItem(CFM_STORAGE_KEYS.LOCAL_USERS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.some(u => u.password)) {
          let updated = false;
          const normalized = parsed.map(u => {
            if (!u.username) {
              const fallbackUname = (Array.isArray(u.aliases) && u.aliases[0]) || (u.email ? u.email.split('@')[0] : 'user');
              updated = true;
              return { 
                ...u, 
                username: fallbackUname.toLowerCase(),
                aliases: Array.isArray(u.aliases) ? u.aliases : [fallbackUname.toLowerCase()]
              };
            }
            return u;
          });
          if (updated) {
            this.saveLocalUsers(normalized, false);
          }
          return normalized;
        }
      }
    } catch (e) {
      console.warn("Error reading local users:", e);
    }
    const initial = typeof CFM_INITIAL_USERS !== 'undefined' ? [...CFM_INITIAL_USERS] : [];
    this.saveLocalUsers(initial, false);
    return initial;
  }

  saveLocalUsers(users, notify = true) {
    try {
      localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_USERS, JSON.stringify(users));
      if (notify) {
        this.notifyUserSubscribers(users, 'local');
      }
    } catch (e) {
      console.error("Error saving local users:", e);
    }
  }
  getLocalLeads() {
    try {
      const stored = localStorage.getItem(CFM_STORAGE_KEYS.LOCAL_LEADS);
      if (stored) {
        const parsed = JSON.parse(stored);
        const hasLineage = Array.isArray(parsed) && parsed.some(l => l.parentLeadId !== undefined);
        const hasEnrichedCount = Array.isArray(parsed) && parsed.length >= (typeof CFM_INITIAL_LEADS !== 'undefined' ? CFM_INITIAL_LEADS.length : 10);
        if (hasLineage && hasEnrichedCount) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Error reading local leads:", e);
    }
    const initial = typeof CFM_INITIAL_LEADS !== 'undefined' ? [...CFM_INITIAL_LEADS] : [];
    this.saveLocalLeads(initial, false);
    return initial;
  }

  saveLocalLeads(leads, notify = true) {
    try {
      localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_LEADS, JSON.stringify(leads));
      if (notify) {
        this.notifyLeadSubscribers(leads, 'local');
      }
    } catch (e) {
      console.error("Error saving local leads:", e);
    }
  }

  getLocalCampaigns() {
    try {
      const stored = localStorage.getItem(CFM_STORAGE_KEYS.LOCAL_CAMPAIGNS);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn("Error reading local campaigns:", e);
    }
    const initial = typeof CFM_INITIAL_CAMPAIGNS !== 'undefined' ? [...CFM_INITIAL_CAMPAIGNS] : [];
    this.saveLocalCampaigns(initial, false);
    return initial;
  }

  saveLocalCampaigns(campaigns, notify = true) {
    try {
      localStorage.setItem(CFM_STORAGE_KEYS.LOCAL_CAMPAIGNS, JSON.stringify(campaigns));
      if (notify) {
        this.notifyCampaignSubscribers(campaigns, 'local');
      }
    } catch (e) {
      console.error("Error saving local campaigns:", e);
    }
  }

  // CRUD for Leads
  async addLead(leadData) {
    const payload = {
      ...leadData,
      createdAt: leadData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (this.isLive && this.db) {
      const docRef = await this.db.collection(this.leadsCollection).add(payload);
      const newLead = { id: docRef.id, ...payload };
      const local = this.getLocalLeads();
      local.unshift(newLead);
      this.saveLocalLeads(local);
      return newLead;
    } else {
      const leads = this.getLocalLeads();
      const newLead = {
        id: 'lead-' + Date.now(),
        ...payload
      };
      leads.unshift(newLead);
      this.saveLocalLeads(leads);
      return newLead;
    }
  }

  async updateLead(leadId, updates) {
    const payload = {
      ...updates,
      updatedAt: new Date().toISOString()
    };

    if (this.isLive && this.db) {
      await this.db.collection(this.leadsCollection).doc(leadId).update(payload);
      const local = this.getLocalLeads();
      const idx = local.findIndex(l => l.id === leadId);
      if (idx !== -1) {
        local[idx] = { ...local[idx], ...payload };
        this.saveLocalLeads(local);
      }
      return { id: leadId, ...payload };
    } else {
      const leads = this.getLocalLeads();
      const index = leads.findIndex(l => l.id === leadId);
      if (index !== -1) {
        leads[index] = { ...leads[index], ...payload };
        this.saveLocalLeads(leads);
        return leads[index];
      }
      throw new Error(`Lead with id ${leadId} not found locally.`);
    }
  }

  async deleteLead(leadId) {
    if (this.isLive && this.db) {
      await this.db.collection(this.leadsCollection).doc(leadId).delete();
      let local = this.getLocalLeads();
      local = local.filter(l => l.id !== leadId);
      this.saveLocalLeads(local);
      return true;
    } else {
      let leads = this.getLocalLeads();
      leads = leads.filter(l => l.id !== leadId);
      this.saveLocalLeads(leads);
      return true;
    }
  }

  // Add activity log to a lead
  async addActivity(leadId, activity) {
    const newActivity = {
      id: 'act-' + Date.now(),
      date: new Date().toISOString().split('T')[0],
      ...activity
    };

    if (this.isLive && this.db) {
      const docRef = this.db.collection(this.leadsCollection).doc(leadId);
      const doc = await docRef.get();
      if (doc.exists) {
        const data = doc.data();
        const activities = data.activities || [];
        activities.unshift(newActivity);
        await docRef.update({
          activities,
          lastContactDate: newActivity.date,
          updatedAt: new Date().toISOString()
        });
      }
    }

    const leads = this.getLocalLeads();
    const lead = leads.find(l => l.id === leadId);
    if (lead) {
      if (!lead.activities) lead.activities = [];
      lead.activities.unshift(newActivity);
      lead.lastContactDate = newActivity.date;
      lead.updatedAt = new Date().toISOString();
      this.saveLocalLeads(leads);
    }
    return newActivity;
  }

  // Add new campaign
  async addCampaign(campaignData) {
    const payload = {
      ...campaignData,
      createdAt: new Date().toISOString()
    };

    if (this.isLive && this.db) {
      const docRef = await this.db.collection(this.campaignsCollection).add(payload);
      const newCamp = { id: docRef.id, ...payload };
      const campaigns = this.getLocalCampaigns();
      campaigns.push(newCamp);
      this.saveLocalCampaigns(campaigns);
      return newCamp;
    } else {
      const campaigns = this.getLocalCampaigns();
      const newCamp = {
        id: 'camp-' + Date.now(),
        ...payload
      };
      campaigns.push(newCamp);
      this.saveLocalCampaigns(campaigns);
      return newCamp;
    }
  }

  // Seed remote Firestore with default campaigns if empty
  async seedInitialRemoteCampaigns() {
    if (!this.isLive || !this.db) return;
    try {
      const batch = this.db.batch();
      for (const camp of CFM_INITIAL_CAMPAIGNS) {
        const ref = this.db.collection(this.campaignsCollection).doc(camp.id);
        batch.set(ref, camp);
      }
      await batch.commit();
      console.log("Seeded initial campaigns to Cloud Firestore.");
    } catch (e) {
      console.warn("Could not seed campaigns to Firestore:", e);
    }
  }

  // ===================== CRUD FOR USERS =====================
  async addUser(userData) {
    const rawUsername = (userData.username || (userData.email ? userData.email.split('@')[0] : 'user')).toLowerCase().trim();
    const cleanUsername = rawUsername.replace(/[^a-zA-Z0-9._-]/g, '') || 'user';
    const aliases = Array.isArray(userData.aliases) && userData.aliases.length > 0 
      ? userData.aliases 
      : [cleanUsername, userData.email ? userData.email.toLowerCase() : cleanUsername];

    const payload = {
      ...userData,
      username: cleanUsername,
      aliases,
      createdAt: userData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      active: true
    };

    if (this.isLive && this.db) {
      const docRef = await this.db.collection(this.usersCollection).add(payload);
      const newUser = { id: docRef.id, ...payload };
      const local = this.getLocalUsers();
      local.push(newUser);
      this.saveLocalUsers(local);
      return newUser;
    } else {
      const users = this.getLocalUsers();
      const newUser = {
        id: 'user-' + Date.now(),
        ...payload
      };
      users.push(newUser);
      this.saveLocalUsers(users);
      return newUser;
    }
  }

  async updateUser(userId, updates) {
    const payload = {
      ...updates,
      updatedAt: new Date().toISOString()
    };

    if (this.isLive && this.db) {
      await this.db.collection(this.usersCollection).doc(userId).update(payload);
      const local = this.getLocalUsers();
      const idx = local.findIndex(u => u.id === userId);
      if (idx !== -1) {
        local[idx] = { ...local[idx], ...payload };
        this.saveLocalUsers(local);
      }
      return { id: userId, ...payload };
    } else {
      const users = this.getLocalUsers();
      const index = users.findIndex(u => u.id === userId);
      if (index !== -1) {
        users[index] = { ...users[index], ...payload };
        this.saveLocalUsers(users);
        return users[index];
      }
      throw new Error(`User with id ${userId} not found locally.`);
    }
  }

  async deleteUser(userId) {
    if (this.isLive && this.db) {
      await this.db.collection(this.usersCollection).doc(userId).delete();
      let local = this.getLocalUsers();
      local = local.filter(u => u.id !== userId);
      this.saveLocalUsers(local);
      return true;
    } else {
      let users = this.getLocalUsers();
      users = users.filter(u => u.id !== userId);
      this.saveLocalUsers(users);
      return true;
    }
  }

  // Seed remote Firestore with default users if empty
  async seedInitialRemoteUsers() {
    if (!this.isLive || !this.db) return;
    try {
      const batch = this.db.batch();
      const initial = typeof CFM_INITIAL_USERS !== 'undefined' ? CFM_INITIAL_USERS : [];
      for (const user of initial) {
        const ref = this.db.collection(this.usersCollection).doc(user.id);
        batch.set(ref, user);
      }
      await batch.commit();
      console.log("Seeded initial users to Cloud Firestore.");
    } catch (e) {
      console.warn("Could not seed users to Firestore:", e);
    }
  }

  // One-click migration: Upload local leads, campaigns & users to live Firebase Firestore
  async pushLocalDataToFirestore() {
    if (!this.isLive || !this.db) {
      throw new Error("Firebase is not connected. Please connect your Firebase project first.");
    }

    const localLeads = this.getLocalLeads();
    const localCampaigns = this.getLocalCampaigns();
    const localUsers = this.getLocalUsers();

    let uploadedLeads = 0;
    let uploadedCampaigns = 0;
    let uploadedUsers = 0;

    // Use batches (max 500 ops per batch)
    const batch = this.db.batch();

    // Push campaigns
    for (const camp of localCampaigns) {
      const ref = this.db.collection(this.campaignsCollection).doc(camp.id);
      batch.set(ref, camp, { merge: true });
      uploadedCampaigns++;
    }

    // Push users
    for (const user of localUsers) {
      const ref = this.db.collection(this.usersCollection).doc(user.id);
      batch.set(ref, user, { merge: true });
      uploadedUsers++;
    }

    // Push leads
    for (const lead of localLeads) {
      const ref = this.db.collection(this.leadsCollection).doc(lead.id);
      batch.set(ref, lead, { merge: true });
      uploadedLeads++;
    }

    await batch.commit();
    return { leadsCount: uploadedLeads, campaignsCount: uploadedCampaigns, usersCount: uploadedUsers };
  }

  // Reset to original demo sample data
  resetLocalData() {
    localStorage.removeItem(CFM_STORAGE_KEYS.LOCAL_LEADS);
    localStorage.removeItem(CFM_STORAGE_KEYS.LOCAL_CAMPAIGNS);
    localStorage.removeItem(CFM_STORAGE_KEYS.LOCAL_USERS);
    return {
      leads: this.getLocalLeads(),
      campaigns: this.getLocalCampaigns(),
      users: this.getLocalUsers()
    };
  }
}

// Global instance
const cfmFirebase = new FirebaseService();
