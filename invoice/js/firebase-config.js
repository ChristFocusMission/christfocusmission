/**
 * Christ Focus Mission - Invoice & Receipt Generator
 * Firebase Configuration & Firestore Synchronization Service
 */

const CFM_INVOICE_STORAGE_KEYS = {
  FIREBASE_CONFIG: 'cfm_firebase_config',
  LOCAL_USERS: 'cfm_fundraising_users_local',
  AUTH_SESSION: 'cfm_auth_session',
  LOCAL_DONORS: 'cfm_invoice_donors_local',
  LOCAL_RECEIPTS: 'cfm_invoice_receipts_local',
  LAST_RECEIPT_NO: 'cfm_invoice_last_receipt_no'
};

// Global Firebase Project Credentials for Christ Focus Mission (same as CRM)
const CFM_GLOBAL_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAyoxnt1x07052JMsHxlNpQlMWJpvOeNis",
  authDomain: "cfmcrm.firebaseapp.com",
  projectId: "cfmcrm",
  storageBucket: "cfmcrm.firebasestorage.app",
  messagingSenderId: "870114446681",
  appId: "1:870114446681:web:c4b46027cb81c22e5e1048",
  measurementId: "G-ZZK9H2VQ2F"
};

// Default CRM Accounts (Admin & Staff) for seamless instant login
const CFM_DEFAULT_USERS = [
  {
    id: "user-1",
    name: "Pastor David",
    username: "admin",
    email: "admin@christfocusmission.org",
    aliases: [
      "admin",
      "david",
      "david@christfocusmission.org",
      "admin@christfocusmission.org",
      "admin@christocusmission.org",
      "christfocusmission"
    ],
    password: "cfmAdmin2026!",
    role: "admin",
    title: "Ministry Director & Founder",
    department: "Executive Leadership",
    phone: "+91 98401 23456",
    active: true
  },
  {
    id: "user-nelson",
    name: "Nelson Richard",
    username: "nelson",
    email: "nelsonrichard094@gmail.com",
    aliases: ["nelson", "nelsonrichard", "nelsonrichard094", "nelsonrichard094@gmail.com"],
    password: "nels@2026",
    role: "admin",
    title: "Partner Relations & Stewardship Officer",
    department: "Partner Engagement",
    phone: "+91 99626 80639",
    active: true
  }
];

class InvoiceFirebaseService {
  constructor() {
    this.app = null;
    this.db = null;
    this.isLive = false;
    this.statusMessage = 'Connecting...';
    this.donorSubscribers = [];
    this.receiptSubscribers = [];
    this.donorsCollection = 'cfm_invoice_donors';
    this.receiptsCollection = 'cfm_invoice_receipts';
    this.usersCollection = 'cfm_users';
    this.crmLeadsCollection = 'cfm_leads';
  }

  notifyDonorSubscribers(donors) {
    this.donorSubscribers.forEach(cb => {
      try { if (typeof cb === 'function') cb(donors); } catch (e) { console.error(e); }
    });
  }

  notifyReceiptSubscribers(receipts) {
    this.receiptSubscribers.forEach(cb => {
      try { if (typeof cb === 'function') cb(receipts); } catch (e) { console.error(e); }
    });
  }

  getSavedConfig() {
    try {
      const stored = localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.FIREBASE_CONFIG);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.projectId) return parsed;
      }
    } catch (_) {}
    return CFM_GLOBAL_FIREBASE_CONFIG;
  }

  saveConfig(cfg) {
    localStorage.setItem(CFM_INVOICE_STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(cfg));
  }

  async initialize() {
    const config = this.getSavedConfig();
    if (!config || !config.projectId) {
      this.isLive = false;
      this.statusMessage = 'Offline / Local Storage Mode';
      return false;
    }

    try {
      if (typeof firebase === 'undefined') {
        throw new Error('Firebase SDK not loaded');
      }

      const existingApps = firebase.apps;
      if (existingApps && existingApps.length > 0) {
        this.app = existingApps[0];
      } else {
        this.app = firebase.initializeApp(config);
      }

      this.db = firebase.firestore(this.app);
      this.isLive = true;
      this.statusMessage = 'Connected to Live Cloud Firestore (cfmcrm)';

      // Set up real-time listener for donors
      this.setupDonorsListener();
      // Set up real-time listener for receipts
      this.setupReceiptsListener();
      // Sync users from crm if possible
      this.syncUsersFromFirestore();

      return true;
    } catch (err) {
      console.warn('Firebase init notice:', err.message);
      this.isLive = false;
      this.statusMessage = 'Using Local Storage Mode';
      return false;
    }
  }

  setupDonorsListener() {
    if (!this.db || !this.isLive) return;
    try {
      this.db.collection(this.donorsCollection).onSnapshot(
        snapshot => {
          const cloudDonors = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            cloudDonors.push({ id: doc.id, ...data });
          });
          if (cloudDonors.length > 0) {
            // Merge with local
            const merged = this.mergeDonorsWithLocal(cloudDonors);
            this.setLocalDonors(merged);
            this.notifyDonorSubscribers(merged);
          }
        },
        error => {
          console.warn('Firestore donors stream error:', error.message);
        }
      );
    } catch (e) {
      console.warn('Donors stream init error:', e);
    }
  }

  setupReceiptsListener() {
    if (!this.db || !this.isLive) return;
    try {
      this.db.collection(this.receiptsCollection).onSnapshot(
        snapshot => {
          const cloudReceipts = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            cloudReceipts.push({ id: doc.id, ...data });
          });
          if (cloudReceipts.length > 0) {
            const merged = this.mergeReceiptsWithLocal(cloudReceipts);
            this.setLocalReceipts(merged);
            this.notifyReceiptSubscribers(merged);
          }
        },
        error => {
          console.warn('Firestore receipts stream error:', error.message);
        }
      );
    } catch (e) {
      console.warn('Receipts stream init error:', e);
    }
  }

  async syncUsersFromFirestore() {
    if (!this.db || !this.isLive) return;
    try {
      const snap = await this.db.collection(this.usersCollection).get();
      if (!snap.empty) {
        const users = [];
        snap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
        if (users.length > 0) {
          localStorage.setItem(CFM_INVOICE_STORAGE_KEYS.LOCAL_USERS, JSON.stringify(users));
        }
      }
    } catch (e) {
      console.warn('Could not sync users from cloud:', e.message);
    }
  }

  // Import donor contacts directly from CRM Leads collection if available
  async importDonorsFromCRMLeads() {
    if (!this.db || !this.isLive) return { count: 0 };
    try {
      const snap = await this.db.collection(this.crmLeadsCollection).get();
      let addedCount = 0;
      if (!snap.empty) {
        const existingDonors = this.getLocalDonors();
        const existingNames = new Set(existingDonors.map(d => (d.name || '').trim().toLowerCase()));

        for (const doc of snap.docs) {
          const l = doc.data();
          const name = (l.name || l.contactPerson || l.organization || '').trim();
          if (name && !existingNames.has(name.toLowerCase())) {
            const newDonor = {
              id: 'donor_crm_' + doc.id,
              name: name,
              pan: l.pan || '',
              address: l.address || (l.city ? `${l.city}, ${l.state || 'India'}` : ''),
              email: l.email || '',
              phone: l.phone || '',
              category: l.category || 'General Donor',
              notes: l.notes || '',
              createdAt: new Date().toISOString()
            };
            await this.saveDonor(newDonor);
            existingNames.add(name.toLowerCase());
            addedCount++;
          }
        }
      }
      return { count: addedCount };
    } catch (e) {
      console.warn('Import from CRM leads error:', e);
      return { count: 0, error: e.message };
    }
  }

  // Local Storage Donors Management
  getLocalDonors() {
    try {
      const data = localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.LOCAL_DONORS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return this.getInitialSampleDonors();
  }

  setLocalDonors(donors) {
    localStorage.setItem(CFM_INVOICE_STORAGE_KEYS.LOCAL_DONORS, JSON.stringify(donors));
  }

  mergeDonorsWithLocal(cloudDonors) {
    const local = this.getLocalDonors();
    const map = new Map();
    local.forEach(d => map.set(d.id, d));
    cloudDonors.forEach(d => map.set(d.id, { ...(map.get(d.id) || {}), ...d }));
    return Array.from(map.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async saveDonor(donor) {
    const donors = this.getLocalDonors();
    const idx = donors.findIndex(d => d.id === donor.id);
    if (idx >= 0) {
      donors[idx] = { ...donors[idx], ...donor, updatedAt: new Date().toISOString() };
    } else {
      donor.id = donor.id || ('donor_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      donor.createdAt = donor.createdAt || new Date().toISOString();
      donors.unshift(donor);
    }
    this.setLocalDonors(donors);
    this.notifyDonorSubscribers(donors);

    // Save to Firestore
    if (this.db && this.isLive) {
      try {
        await this.db.collection(this.donorsCollection).doc(donor.id).set(donor, { merge: true });
      } catch (err) {
        console.warn('Firestore donor save error:', err.message);
      }
    }
    return donor;
  }

  async deleteDonor(donorId) {
    let donors = this.getLocalDonors().filter(d => d.id !== donorId);
    this.setLocalDonors(donors);
    this.notifyDonorSubscribers(donors);

    if (this.db && this.isLive) {
      try {
        await this.db.collection(this.donorsCollection).doc(donorId).delete();
      } catch (err) {
        console.warn('Firestore donor delete error:', err.message);
      }
    }
    return true;
  }

  // Local Storage Receipts Management
  getLocalReceipts() {
    try {
      const data = localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.LOCAL_RECEIPTS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return this.getInitialSampleReceipts();
  }

  setLocalReceipts(receipts) {
    localStorage.setItem(CFM_INVOICE_STORAGE_KEYS.LOCAL_RECEIPTS, JSON.stringify(receipts));
  }

  mergeReceiptsWithLocal(cloudReceipts) {
    const local = this.getLocalReceipts();
    const map = new Map();
    local.forEach(r => map.set(r.id, r));
    cloudReceipts.forEach(r => map.set(r.id, { ...(map.get(r.id) || {}), ...r }));
    return Array.from(map.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  async saveReceipt(receipt) {
    const receipts = this.getLocalReceipts();
    receipt.id = receipt.id || ('rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    receipt.createdAt = receipt.createdAt || new Date().toISOString();

    const idx = receipts.findIndex(r => r.id === receipt.id);
    if (idx >= 0) {
      receipts[idx] = { ...receipts[idx], ...receipt, updatedAt: new Date().toISOString() };
    } else {
      receipts.unshift(receipt);
    }
    this.setLocalReceipts(receipts);
    this.notifyReceiptSubscribers(receipts);

    // Update last receipt number tracking
    if (receipt.receiptNo) {
      const numMatch = String(receipt.receiptNo).match(/(\d+)/g);
      if (numMatch) {
        const lastNum = parseInt(numMatch[numMatch.length - 1], 10);
        if (!isNaN(lastNum)) {
          const curMax = parseInt(localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.LAST_RECEIPT_NO) || '0', 10);
          if (lastNum > curMax) {
            localStorage.setItem(CFM_INVOICE_STORAGE_KEYS.LAST_RECEIPT_NO, String(lastNum));
          }
        }
      }
    }

    // Save to Firestore
    if (this.db && this.isLive) {
      try {
        await this.db.collection(this.receiptsCollection).doc(receipt.id).set(receipt, { merge: true });
      } catch (err) {
        console.warn('Firestore receipt save error:', err.message);
      }
    }
    return receipt;
  }

  async deleteReceipt(receiptId) {
    const receipts = this.getLocalReceipts().filter(r => r.id !== receiptId);
    this.setLocalReceipts(receipts);
    this.notifyReceiptSubscribers(receipts);

    if (this.db && this.isLive) {
      try {
        await this.db.collection(this.receiptsCollection).doc(receiptId).delete();
      } catch (err) {
        console.warn('Firestore receipt delete error:', err.message);
      }
    }
    return true;
  }

  getNextReceiptNumber() {
    const receipts = this.getLocalReceipts();
    let maxNum = 1210; // From actual paper receipt book #1210
    const stored = parseInt(localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.LAST_RECEIPT_NO) || '0', 10);
    if (stored > maxNum) maxNum = stored;

    receipts.forEach(r => {
      if (r.receiptNo) {
        const matches = String(r.receiptNo).match(/(\d+)/g);
        if (matches) {
          const n = parseInt(matches[matches.length - 1], 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      }
    });
    return String(maxNum + 1);
  }

  // Users for Authentication (synced with CRM)
  getUsers() {
    try {
      const stored = localStorage.getItem(CFM_INVOICE_STORAGE_KEYS.LOCAL_USERS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return CFM_DEFAULT_USERS;
  }

  getInitialSampleDonors() {
    return [
      {
        id: "donor-pearline",
        name: "Pearline D",
        pan: "ABCDE1234F",
        address: "Plot 14, Anna Nagar West Extension, Chennai - 600 101",
        email: "pearline.d@example.com",
        phone: "+91 98401 98765",
        category: "Individual Donor",
        notes: "Supporter of King David project",
        createdAt: "2026-07-06T10:30:00Z"
      },
      {
        id: "donor-solomon",
        name: "Dr. Solomon Raj",
        pan: "BQWPR4582K",
        address: "24, Harrington Road, Chetpet, Chennai - 600 031",
        email: "dr.solomonraj@example.com",
        phone: "+91 94440 12345",
        category: "Patron",
        notes: "Regular patron for children music education",
        createdAt: "2026-08-15T11:00:00Z"
      },
      {
        id: "donor-grace",
        name: "Grace Fellowship Trust",
        pan: "AADTG9821L",
        address: "7th Cross, Gandhinagar, Adyar, Chennai - 600 020",
        email: "office@gracefellowship.org",
        phone: "+91 44 2445 6789",
        category: "Institutional Donor",
        notes: "Partner organization",
        createdAt: "2026-09-01T14:20:00Z"
      }
    ];
  }

  getInitialSampleReceipts() {
    return [
      {
        id: "rec-1210",
        receiptNo: "1210",
        date: "2026-07-06",
        donorId: "donor-pearline",
        donorName: "Pearline D",
        donorPan: "ABCDE1234F",
        donorAddress: "Plot 14, Anna Nagar West Extension, Chennai - 600 101",
        donorEmail: "pearline.d@example.com",
        donorPhone: "+91 98401 98765",
        amount: 5000,
        amountWords: "Five Thousand Only",
        paymentMode: "Cheque",
        chequeNo: "CHQ-890214",
        bankName: "Canara Bank",
        purpose: "Donation to Christ Focus Mission for Charitable Activities",
        scheme: "King David Music Programme",
        issuedBy: "Pastor David",
        uniqueRegNo: "AADTC2907RF20241",
        trustPan: "AADTC2907R",
        taxNote: "Contributions made to Christ Focus Mission are eligible for deduction u/s 80G",
        createdAt: "2026-07-06T10:35:00Z"
      }
    ];
  }
}

// Global service instance
const cfmInvoiceFirebase = new InvoiceFirebaseService();
