// Initial data configuration for Christ Focus Mission Fundraising CRM
// Clean production template: Sample leads & campaigns cleared for live usage.

const CFM_NETWORK_STAGES = [
  {
    id: "stage-1",
    stageNumber: 1,
    role: "Core Leaders",
    targetMembers: 10,
    cumulativeMembers: 10,
    multiplier: "Founder Team",
    color: "amber",
    description: "The core pioneering leadership team tracked and mentored directly by Ministry Staff, initiating the movement and mentoring the next level."
  },
  {
    id: "stage-2",
    stageNumber: 2,
    role: "Team Champions",
    targetMembers: 100,
    cumulativeMembers: 110,
    multiplier: "10x Growth (10 each)",
    color: "blue",
    description: "Key mobilization champions coordinating regional and church clusters."
  },
  {
    id: "stage-3",
    stageNumber: 3,
    role: "Active Distributors",
    targetMembers: 1000,
    cumulativeMembers: 1110,
    multiplier: "10x Growth (10 each)",
    color: "purple",
    description: "Active local mission mobilizers distributing campaign vision, materials, and updates."
  },
  {
    id: "stage-4",
    stageNumber: 4,
    role: "Brand Ambassadors & Builders",
    targetMembers: 10000,
    cumulativeMembers: 11110,
    multiplier: "10x Growth (10 each)",
    color: "indigo",
    description: "Grassroots advocates building prayer, community, and partner circles in local fellowship groups."
  },
  {
    id: "stage-5",
    stageNumber: 5,
    role: "Active Supporters",
    targetMembers: 88890,
    cumulativeMembers: 100000,
    multiplier: "Milestone Cap Cohort",
    isCapped: true,
    color: "emerald",
    description: "The broad community of recurring contributors bringing total active membership to exactly 1,00,000."
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

// Clean state: Live donor leads added dynamically by team
const CFM_INITIAL_LEADS = [];

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
