// Initial data configuration for Christ Focus Mission Fundraising CRM
// Clean production template: Sample leads & campaigns cleared for live usage.

// Supporter Types for Non-Profit Statutory Record-Keeping
// Rule: No rewards, perks, or status for bringing in others. Referral info is for record-keeping only.
const CFM_SUPPORTER_TYPES = [
  { id: "Donor", label: "Donor", description: "General mission partner contributing one-off or occasional gifts." },
  { id: "Monthly Supporter", label: "Monthly Supporter", description: "Committed regular monthly covenant supporter." },
  { id: "Volunteer Ambassador", label: "Volunteer Ambassador", description: "Active volunteer partner introducing and referring others for record-keeping." }
];

const CFM_NETWORK_STAGES = [
  {
    id: "stage-1",
    stageNumber: 1,
    role: "Core Leaders",
    targetMembers: 10,
    cumulativeMembers: 10,
    multiplier: "Referrals Count",
    color: "amber",
    description: "The pioneering leadership team tracked directly by Volunteer Coordinators (Ministry Staff)."
  },
  {
    id: "stage-2",
    stageNumber: 2,
    role: "Team Champions",
    targetMembers: 100,
    cumulativeMembers: 110,
    multiplier: "Referrals Count",
    color: "blue",
    description: "Mobilization champions coordinating regional and church fellowships."
  },
  {
    id: "stage-3",
    stageNumber: 3,
    role: "Active Mobilizers",
    targetMembers: 1000,
    cumulativeMembers: 1110,
    multiplier: "Referrals Count",
    color: "purple",
    description: "Local mission mobilizers sharing campaign vision, materials, and prayer updates."
  },
  {
    id: "stage-4",
    stageNumber: 4,
    role: "Volunteer Ambassadors",
    targetMembers: 10000,
    cumulativeMembers: 11110,
    multiplier: "Referrals Count",
    color: "indigo",
    description: "Grassroots advocates building prayer and stewardship circles in local fellowship groups."
  },
  {
    id: "stage-5",
    stageNumber: 5,
    role: "Monthly Supporters",
    targetMembers: 88890,
    cumulativeMembers: 100000,
    multiplier: "Referrals Count",
    isCapped: true,
    color: "emerald",
    description: "The broad community of regular recurring contributors supporting ongoing mission needs."
  }
];

// Official Christ Focus Mission Ministry Funds & Strategic Initiatives
const CFM_INITIAL_CAMPAIGNS = [
  {
    id: "camp-1",
    name: "General Mission & Operations Fund",
    code: "GEN-2026",
    target: 500000,
    raised: 0,
    description: "Supports day-to-day missionary operations, travel, local outreach, and staff logistics.",
    color: "emerald"
  },
  {
    id: "camp-2",
    name: "Rural Church Planting Initiative",
    code: "PLANT-2026",
    target: 750000,
    raised: 0,
    description: "Equipping local pastors and funding new church plants in unreached rural districts.",
    color: "blue"
  },
  {
    id: "camp-3",
    name: "Youth & Discipleship Camp 2026",
    code: "YOUTH-2026",
    target: 250000,
    raised: 0,
    description: "Subsidizing registrations and study materials for youth leaders in discipleship training.",
    color: "purple"
  },
  {
    id: "camp-4",
    name: "Community Medical & Relief Outreach",
    code: "MED-2026",
    target: 400000,
    raised: 0,
    description: "Free medical clinics, hygiene kits, and emergency food supplies distributed in underprivileged zones.",
    color: "amber"
  },
  {
    id: "camp-5",
    name: "Mission Training Center Expansion",
    code: "BLDG-2026",
    target: 1200000,
    raised: 0,
    description: "Building new classrooms, dorm rooms, and library for ministry trainees.",
    color: "rose"
  }
];

// Official Initial Leads with Non-Profit Statutory Compliance & Referral Stewardship
const CFM_INITIAL_LEADS = [
  {
    id: "lead-vance",
    name: "Dr. Arthur Vance",
    organization: "Grace Family Healthcare",
    leadType: "Individual",
    stage: "committed",
    expectedAmount: 50000,
    receivedAmount: 50000,
    currency: "INR",
    frequency: "Monthly",
    campaignId: "camp-1",
    priority: "High",
    assignedTo: "Pastor David",
    probability: 100,
    nextFollowUp: "2026-11-15",
    prayerRequests: "Prayer for expanding medical outreach to tribal communities and clinic staff health.",
    notes: "Committed monthly sponsor for health ministries. Volunteer Ambassador introduction on record.",
    
    // Statutory Compliance & Tax reporting (Form 10BD / 80G / FCRA)
    pan: "ABCDE1234F",
    citizenshipConfirmed: "Yes",
    address: "14 Bishop Wallers Avenue, Mylapore, Chennai, Tamil Nadu 600004",
    paymentId: "PAY-2026-0891",
    donationDateTime: "2026-10-18T10:30:00",
    ipAddress: "103.21.124.5",
    isCorpus: false,
    corpusReceiptUrl: "",
    corpusLetterUrl: "",

    // Supporter Type & Referral Stewardship (Record-Keeping Only)
    supporterType: "Volunteer Ambassador",
    referredBy: "",
    referredByName: "",
    volunteerCoordinator: "Pastor David",
    networkTier: "stage-1",
    parentLeadId: "staff:Pastor David",
    createdAt: "2026-09-01T10:00:00Z"
  },
  {
    id: "lead-bethel",
    name: "Bethel Fellowship Church",
    organization: "Bethel Community Outreach",
    leadType: "Church",
    stage: "committed",
    expectedAmount: 100000,
    receivedAmount: 100000,
    currency: "INR",
    frequency: "One-off",
    campaignId: "camp-2",
    priority: "High",
    assignedTo: "Nelson Richard",
    probability: 100,
    nextFollowUp: "2026-11-05",
    prayerRequests: "Prayer for pastoral team and regional church plants across rural Karnataka.",
    notes: "Corpus specific direction contribution of ₹1 Lakh towards rural church building endowment.",

    // Statutory Compliance & Tax reporting (Form 10BD / 80G / FCRA)
    pan: "AABTB8765K",
    citizenshipConfirmed: "Yes",
    address: "22 St. Mark Road, Ashok Nagar, Bengaluru, Karnataka 560025",
    paymentId: "TXN-8841920412",
    donationDateTime: "2026-10-15T14:15:00",
    ipAddress: "49.207.181.99",
    isCorpus: true,
    corpusReceiptUrl: "https://christfocusmission.org/receipts/REC-10492.pdf",
    corpusLetterUrl: "https://christfocusmission.org/docs/corpus-letter-bethel.pdf",

    // Supporter Type & Referral Stewardship (Record-Keeping Only)
    supporterType: "Donor",
    referredBy: "",
    referredByName: "",
    volunteerCoordinator: "Nelson Richard",
    networkTier: "",
    parentLeadId: "staff:Nelson Richard",
    createdAt: "2026-09-10T11:00:00Z"
  },
  {
    id: "lead-sarah",
    name: "Sarah Abraham",
    organization: "Apex Global Solutions",
    leadType: "Business",
    stage: "committed",
    expectedAmount: 25000,
    receivedAmount: 25000,
    currency: "INR",
    frequency: "Monthly",
    campaignId: "camp-4",
    priority: "Medium",
    assignedTo: "Pastor David",
    probability: 100,
    nextFollowUp: "",
    prayerRequests: "Prayer for family health and international software consultancy ventures.",
    notes: "Committed monthly partner for community health outreach. Referred by Dr. Arthur Vance (record-keeping only).",

    // Statutory Compliance & Tax reporting (Form 10BD / 80G / FCRA)
    pan: "PQRSA5678M",
    citizenshipConfirmed: "Yes",
    address: "8-2-293 Road No 14, Banjara Hills, Hyderabad, Telangana 500034",
    paymentId: "UPI-992384110",
    donationDateTime: "2026-10-12T09:45:00",
    ipAddress: "157.48.91.22",
    isCorpus: false,
    corpusReceiptUrl: "",
    corpusLetterUrl: "",

    // Supporter Type & Referral Stewardship (Record-Keeping Only)
    supporterType: "Monthly Supporter",
    referredBy: "lead-vance",
    referredByName: "Dr. Arthur Vance",
    volunteerCoordinator: "Pastor David",
    networkTier: "stage-5",
    parentLeadId: "lead-vance",
    createdAt: "2026-09-15T14:30:00Z"
  },
  {
    id: "lead-calvary",
    name: "Calvary Life Assembly",
    organization: "Calvary Missions Board",
    leadType: "Church",
    stage: "in_discussion",
    expectedAmount: 75000,
    receivedAmount: 0,
    currency: "INR",
    frequency: "One-off",
    campaignId: "camp-3",
    priority: "High",
    assignedTo: "Nelson Richard",
    probability: 70,
    nextFollowUp: "2026-10-25",
    prayerRequests: "Youth leadership discipleship summit and training scholarships.",
    notes: "Council reviewing proposal for youth discipleship sponsorship.",

    // Statutory Compliance & Tax reporting (Form 10BD / 80G / FCRA)
    pan: "AAATC9912D",
    citizenshipConfirmed: "Yes",
    address: "45 New Marine Lines, Churchgate, Mumbai, Maharashtra 400020",
    paymentId: "OFFLINE-PLEDGE",
    donationDateTime: "2026-10-16T11:00:00",
    ipAddress: "115.111.23.44",
    isCorpus: false,
    corpusReceiptUrl: "",
    corpusLetterUrl: "",

    // Supporter Type & Referral Stewardship (Record-Keeping Only)
    supporterType: "Donor",
    referredBy: "",
    referredByName: "",
    volunteerCoordinator: "Nelson Richard",
    networkTier: "",
    parentLeadId: "staff:Nelson Richard",
    createdAt: "2026-10-01T08:00:00Z"
  },
  {
    id: "lead-emmanuel",
    name: "Emmanuel Educational Trust",
    organization: "Emmanuel Group of Institutions",
    leadType: "Trust",
    stage: "committed",
    expectedAmount: 250000,
    receivedAmount: 250000,
    currency: "INR",
    frequency: "One-off",
    campaignId: "camp-5",
    priority: "High",
    assignedTo: "Pastor David",
    probability: 100,
    nextFollowUp: "2026-11-20",
    prayerRequests: "Expansion of vocational training centers in North East states.",
    notes: "Corpus donation of ₹2.5 Lakhs for Mission Training Center Library & Classroom Block. Form 10BD copy verified.",

    // Statutory Compliance & Tax reporting (Form 10BD / 80G / FCRA)
    pan: "AAATE4455G",
    citizenshipConfirmed: "Yes",
    address: "10 Park Street, Mullick Bazar, Kolkata, West Bengal 700016",
    paymentId: "NEFT-N291048821",
    donationDateTime: "2026-10-14T16:20:00",
    ipAddress: "182.72.68.10",
    isCorpus: true,
    corpusReceiptUrl: "https://christfocusmission.org/receipts/REC-10508.pdf",
    corpusLetterUrl: "https://christfocusmission.org/docs/corpus-letter-emmanuel.pdf",

    // Supporter Type & Referral Stewardship (Record-Keeping Only)
    supporterType: "Donor",
    referredBy: "lead-vance",
    referredByName: "Dr. Arthur Vance",
    volunteerCoordinator: "Pastor David",
    networkTier: "",
    parentLeadId: "lead-vance",
    createdAt: "2026-09-20T16:00:00Z"
  }
];

// Default Initial System Accounts
const CFM_INITIAL_USERS = [
  {
    id: "user-1",
    name: "Pastor David",
    username: "admin",
    email: "admin@christfocusmission.org",
    aliases: ["admin", "david", "david@christfocusmission.org"],
    password: "cfmAdmin2026!",
    role: "admin",
    title: "Ministry Director & Founder",
    department: "Executive Leadership",
    phone: "+91 98401 23456",
    active: true,
    createdAt: "2026-01-10T09:00:00Z"
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
    phone: "",
    active: true,
    createdAt: "2026-01-10T09:00:00Z"
  }
];
