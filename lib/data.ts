import type {
  ActivityItem,
  Artifact,
  ChatSession,
  Doc,
  DocFolder,
  DocVersion,
  SharePointSite,
} from "@/lib/types"

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

export const seedFolders: DocFolder[] = [
  { id: "f-finance", name: "Finance", parentId: null, source: "upload" },
  { id: "f-finance-q3", name: "Q3 Reporting", parentId: "f-finance", source: "upload" },
  { id: "f-legal", name: "Legal", parentId: null, source: "upload" },
  { id: "f-legal-vendor", name: "Vendor Contracts", parentId: "f-legal", source: "upload" },
  { id: "f-product", name: "Product", parentId: null, source: "upload" },
  { id: "f-people", name: "People Ops", parentId: null, source: "upload" },
  {
    id: "f-sp-ops",
    name: "Operations Hub",
    parentId: null,
    source: "sharepoint",
    sharePointPath: "/sites/operations/Shared Documents",
  },
  {
    id: "f-sp-sales",
    name: "Sales Enablement",
    parentId: null,
    source: "sharepoint",
    sharePointPath: "/sites/sales/Enablement Library",
  },
  { id: "f-generated", name: "AI Workspace", parentId: null, source: "generated" },
]

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const seedDocs: Doc[] = [
  {
    id: "d-acme-msa",
    name: "Acme Cloud — Master Services Agreement.pdf",
    type: "pdf",
    folderId: "f-legal-vendor",
    source: "upload",
    status: "ready",
    sizeKB: 2418,
    pages: 42,
    owner: "Priya Raman",
    updatedAt: "2026-06-28T14:12:00Z",
    tags: ["contract", "renewal", "acme"],
    summary:
      "Master services agreement with Acme Cloud covering hosting, support tiers, uptime SLAs, and renewal terms through FY27.",
    version: 4,
  },
  {
    id: "d-acme-sow",
    name: "Acme Cloud — SOW #12 Migration Services.pdf",
    type: "pdf",
    folderId: "f-legal-vendor",
    source: "upload",
    status: "ready",
    sizeKB: 894,
    pages: 18,
    owner: "Priya Raman",
    updatedAt: "2026-06-21T09:40:00Z",
    tags: ["contract", "acme", "sow"],
    summary:
      "Statement of work for the data-center migration project, including milestones, acceptance criteria, and fee schedule.",
    version: 2,
  },
  {
    id: "d-northwind-msa",
    name: "Northwind Analytics — Subscription Agreement.pdf",
    type: "pdf",
    folderId: "f-legal-vendor",
    source: "upload",
    status: "ready",
    sizeKB: 1712,
    pages: 31,
    owner: "Priya Raman",
    updatedAt: "2026-05-30T16:05:00Z",
    tags: ["contract", "renewal", "northwind"],
    summary:
      "Annual subscription agreement for the Northwind analytics platform with usage-based overage pricing and a 60-day renewal notice window.",
    version: 3,
  },
  {
    id: "d-globex-nda",
    name: "Globex Partners — Mutual NDA.pdf",
    type: "pdf",
    folderId: "f-legal",
    source: "upload",
    status: "ready",
    sizeKB: 302,
    pages: 6,
    owner: "Dana Whitfield",
    updatedAt: "2026-06-11T11:22:00Z",
    tags: ["nda", "globex"],
    summary: "Standard mutual non-disclosure agreement executed with Globex Partners for the co-sell evaluation.",
    version: 1,
  },
  {
    id: "d-q3-vendor-spend",
    name: "Q3 Vendor Spend Analysis.pdf",
    type: "pdf",
    folderId: "f-finance-q3",
    source: "upload",
    status: "ready",
    sizeKB: 641,
    pages: 5,
    owner: "Marcus Lee",
    updatedAt: "2026-07-02T08:55:00Z",
    tags: ["spend", "vendors", "q3"],
    summary:
      "Vendor-by-vendor spend rollup for Q3 with YoY deltas, contract end dates, and renewal risk flags.",
    version: 7,
  },
  {
    id: "d-q3-forecast",
    name: "FY26 Q3 Forecast Narrative.docx",
    type: "docx",
    folderId: "f-finance-q3",
    source: "upload",
    status: "ready",
    sizeKB: 220,
    pages: 12,
    owner: "Marcus Lee",
    updatedAt: "2026-07-01T17:30:00Z",
    tags: ["forecast", "q3"],
    summary:
      "Narrative accompanying the Q3 forecast: revenue drivers, cost headwinds, and the infrastructure consolidation plan.",
    version: 5,
  },
  {
    id: "d-budget-policy",
    name: "Procurement & Budget Approval Policy.pdf",
    type: "pdf",
    folderId: "f-finance",
    source: "upload",
    status: "ready",
    sizeKB: 512,
    pages: 14,
    owner: "Finance Ops",
    updatedAt: "2026-04-18T10:00:00Z",
    tags: ["policy", "procurement"],
    summary:
      "Company policy for procurement thresholds, approval chains, and vendor onboarding requirements.",
    version: 9,
  },
  {
    id: "d-q2-board",
    name: "Q2 Board Deck — Final.pdf",
    type: "pdf",
    folderId: "f-finance",
    source: "upload",
    status: "ready",
    sizeKB: 8210,
    pages: 24,
    owner: "Alex Chen",
    updatedAt: "2026-04-29T19:45:00Z",
    tags: ["board", "q2"],
    summary: "Final board presentation for Q2 covering financials, product milestones, and hiring plan.",
    version: 6,
  },
  {
    id: "d-roadmap",
    name: "Product Roadmap H2 2026.docx",
    type: "docx",
    folderId: "f-product",
    source: "upload",
    status: "ready",
    sizeKB: 187,
    pages: 9,
    owner: "Sofia Martinez",
    updatedAt: "2026-06-25T13:10:00Z",
    tags: ["roadmap", "planning"],
    summary: "H2 roadmap themes: platform reliability, enterprise admin controls, and the intelligence layer beta.",
    version: 11,
  },
  {
    id: "d-pricing-study",
    name: "Enterprise Pricing Study.pdf",
    type: "pdf",
    folderId: "f-product",
    source: "upload",
    status: "ready",
    sizeKB: 3105,
    pages: 55,
    owner: "Sofia Martinez",
    updatedAt: "2026-05-14T15:00:00Z",
    tags: ["pricing", "research"],
    summary:
      "Third-party study benchmarking enterprise pricing models, willingness-to-pay bands, and packaging archetypes.",
    version: 1,
  },
  {
    id: "d-usage-metrics",
    name: "Platform Usage Metrics — June.csv",
    type: "csv",
    folderId: "f-product",
    source: "upload",
    status: "ready",
    sizeKB: 96,
    pages: 1,
    owner: "Data Team",
    updatedAt: "2026-07-03T06:20:00Z",
    tags: ["metrics", "usage"],
    summary: "Raw June usage export: seats, weekly active users, and feature adoption by workspace.",
    version: 1,
  },
  {
    id: "d-handbook",
    name: "Employee Handbook 2026.pdf",
    type: "pdf",
    folderId: "f-people",
    source: "upload",
    status: "ready",
    sizeKB: 1890,
    pages: 68,
    owner: "People Ops",
    updatedAt: "2026-01-12T09:00:00Z",
    tags: ["policy", "handbook"],
    summary: "Company handbook covering conduct, benefits, leave policy, and remote-work guidelines.",
    version: 14,
  },
  {
    id: "d-comp-bands",
    name: "Compensation Bands FY26.pdf",
    type: "pdf",
    folderId: "f-people",
    source: "upload",
    status: "ready",
    sizeKB: 240,
    pages: 3,
    owner: "People Ops",
    updatedAt: "2026-03-08T12:35:00Z",
    tags: ["compensation", "confidential"],
    summary: "FY26 compensation bands by level and geography with mid-year adjustment notes.",
    version: 4,
  },
  {
    id: "d-sp-runbook",
    name: "Incident Response Runbook.docx",
    type: "docx",
    folderId: "f-sp-ops",
    source: "sharepoint",
    status: "ready",
    sizeKB: 310,
    pages: 16,
    owner: "Ops Team",
    updatedAt: "2026-06-30T22:14:00Z",
    tags: ["runbook", "sev"],
    summary: "Step-by-step incident response procedures, escalation paths, and postmortem template.",
    version: 8,
  },
  {
    id: "d-sp-vendor-dir",
    name: "Approved Vendor Directory.pdf",
    type: "pdf",
    folderId: "f-sp-ops",
    source: "sharepoint",
    status: "ready",
    sizeKB: 412,
    pages: 2,
    owner: "Ops Team",
    updatedAt: "2026-07-04T07:45:00Z",
    tags: ["vendors", "directory"],
    summary: "Directory of approved vendors with security review status and contract owners.",
    version: 21,
  },
  {
    id: "d-sp-dr-plan",
    name: "Disaster Recovery Plan v3.pdf",
    type: "pdf",
    folderId: "f-sp-ops",
    source: "sharepoint",
    status: "syncing",
    sizeKB: 1204,
    pages: 27,
    owner: "Ops Team",
    updatedAt: "2026-07-06T18:03:00Z",
    tags: ["dr", "compliance"],
    summary: "Disaster recovery plan: RTO/RPO targets, failover procedures, and annual test results.",
    version: 3,
  },
  {
    id: "d-sp-battlecards",
    name: "Competitor Battlecards — July.pdf",
    type: "pdf",
    folderId: "f-sp-sales",
    source: "sharepoint",
    status: "ready",
    sizeKB: 5420,
    pages: 32,
    owner: "Sales Enablement",
    updatedAt: "2026-07-05T10:20:00Z",
    tags: ["competitive", "sales"],
    summary: "Battlecards for the top five competitors with objection handling and win/loss themes.",
    version: 12,
  },
  {
    id: "d-sp-security-faq",
    name: "Security Questionnaire Answer Bank.docx",
    type: "docx",
    folderId: "f-sp-sales",
    source: "sharepoint",
    status: "ready",
    sizeKB: 501,
    pages: 22,
    owner: "Security",
    updatedAt: "2026-06-27T14:50:00Z",
    tags: ["security", "rfp"],
    summary: "Canonical answers for common security questionnaire items: SOC 2, data residency, encryption, subprocessors.",
    version: 17,
  },
  {
    id: "d-soc2",
    name: "SOC 2 Type II Report — 2025.pdf",
    type: "pdf",
    folderId: "f-sp-sales",
    source: "sharepoint",
    status: "ready",
    sizeKB: 4102,
    pages: 88,
    owner: "Security",
    updatedAt: "2026-02-20T09:30:00Z",
    tags: ["security", "audit", "confidential"],
    summary: "Independent SOC 2 Type II audit report covering the 2025 observation period.",
    version: 1,
  },
  {
    id: "d-onboarding-notes",
    name: "Vendor Onboarding Notes.md",
    type: "md",
    folderId: "f-legal-vendor",
    source: "upload",
    status: "processing",
    sizeKB: 18,
    pages: 4,
    owner: "Priya Raman",
    updatedAt: "2026-07-07T08:10:00Z",
    tags: ["notes"],
    summary: "Working notes from vendor onboarding calls — pending indexing.",
    version: 1,
    progress: 62,
  },
  {
    id: "d-old-scan",
    name: "Legacy Lease Scan (searchability failed).pdf",
    type: "pdf",
    folderId: "f-legal",
    source: "upload",
    status: "error",
    sizeKB: 15230,
    pages: 51,
    owner: "Dana Whitfield",
    updatedAt: "2026-07-05T16:40:00Z",
    tags: ["lease"],
    summary: "Scanned lease agreement — OCR failed on low-resolution pages 12-19.",
    version: 1,
  },
]

/* ------------------------------------------------------------------ */
/* SharePoint sites                                                    */
/* ------------------------------------------------------------------ */

export const seedSites: SharePointSite[] = [
  {
    id: "sp-ops",
    name: "Operations Hub",
    url: "https://jacobs.sharepoint.com/sites/operations",
    mappedFolderId: "f-sp-ops",
    lastSyncedAt: "2026-07-07T06:00:00Z",
    docCount: 3,
    state: "idle",
    attentionCount: 0,
  },
  {
    id: "sp-sales",
    name: "Sales Enablement",
    url: "https://jacobs.sharepoint.com/sites/sales",
    mappedFolderId: "f-sp-sales",
    lastSyncedAt: "2026-07-06T22:30:00Z",
    docCount: 3,
    state: "attention",
    attentionCount: 2,
  },
]

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

export const seedArtifacts: Artifact[] = [
  {
    id: "a-negotiation-brief",
    kind: "doc",
    title: "Acme Renewal — Negotiation Brief",
    status: "ready",
    createdAt: "2026-07-06T15:20:00Z",
    updatedAt: "2026-07-06T15:26:00Z",
    sourceDocIds: ["d-acme-msa", "d-q3-vendor-spend", "d-budget-policy"],
    lastEditSummary: "Tightened the BATNA section and added the uptime-credit ask.",
  },
  {
    id: "a-vendor-model",
    kind: "doc",
    title: "Vendor Renewal Model FY27",
    status: "ready",
    createdAt: "2026-07-05T11:00:00Z",
    updatedAt: "2026-07-06T09:12:00Z",
    sourceDocIds: ["d-q3-vendor-spend", "d-sp-vendor-dir"],
    lastEditSummary: "Added a 3-scenario sensitivity table for Acme pricing.",
  },
  {
    id: "a-qbr-deck",
    kind: "doc",
    title: "Q3 Business Review — Draft",
    status: "ready",
    createdAt: "2026-07-03T13:45:00Z",
    updatedAt: "2026-07-04T10:05:00Z",
    sourceDocIds: ["d-q3-forecast", "d-q2-board", "d-usage-metrics"],
    lastEditSummary: "Rebuilt the spend-trend section from the June usage export.",
  },
]

/* ------------------------------------------------------------------ */
/* Chat sessions (message trees with a branch already present)          */
/* ------------------------------------------------------------------ */

export const seedSessions: ChatSession[] = [
  {
    id: "s-renewals",
    title: "Q3 vendor renewals review",
    createdAt: "2026-07-06T14:58:00Z",
    updatedAt: "2026-07-06T15:26:00Z",
    pinned: true,
    scopeDocIds: [
      "d-acme-msa",
      "d-acme-sow",
      "d-northwind-msa",
      "d-q3-vendor-spend",
      "d-budget-policy",
      "d-sp-vendor-dir",
    ],
    leafId: "m4",
    messages: {
      m1: {
        id: "m1",
        parentId: null,
        role: "user",
        content:
          "Which vendors are up for renewal this quarter, and what are we currently paying them?",
        createdAt: "2026-07-06T14:58:10Z",
        phase: "done",
        scopeLabel: "6 documents in scope",
      },
      m2: {
        id: "m2",
        parentId: "m1",
        role: "assistant",
        createdAt: "2026-07-06T14:58:41Z",
        phase: "done",
        content:
          "Two vendors have renewal windows opening this quarter:\n\n**Acme Cloud** — the MSA auto-renews on **September 30** unless notice is given 90 days prior, which puts the notice deadline at **July 2** ⟦1⟧. Current run-rate is **$412k/yr**, up 18% YoY driven by the migration SOW ⟦2⟧.\n\n**Northwind Analytics** — the subscription term ends **October 15** with a 60-day renewal notice window ⟦3⟧. Spend is **$168k/yr** with overages averaging $4.2k/month this quarter ⟦2⟧.\n\nBoth exceed the $100k threshold that requires CFO sign-off under the procurement policy ⟦4⟧.\n\n> ⚠ The Acme notice deadline has already passed — if you intend to renegotiate rather than auto-renew, legal should send a reservation-of-rights letter this week.",
        thinking: [
          {
            id: "t1",
            kind: "plan",
            label: "Planning approach",
            detail: "Identify renewal clauses in contracts, then join with spend data.",
          },
          {
            id: "t2",
            kind: "search",
            label: "Searching scope for renewal terms",
            detail: "Query: “renewal notice term expiration” across 6 documents",
            docIds: ["d-acme-msa", "d-northwind-msa"],
          },
          {
            id: "t3",
            kind: "read",
            label: "Reading Acme Cloud MSA §11 (Term & Renewal)",
            docIds: ["d-acme-msa"],
          },
          {
            id: "t4",
            kind: "analyze",
            label: "Cross-referencing spend analysis",
            detail: "Matching contract entities to Q3 spend rows",
            docIds: ["d-q3-vendor-spend"],
          },
          {
            id: "t5",
            kind: "synthesize",
            label: "Checking procurement thresholds",
            docIds: ["d-budget-policy"],
          },
        ],
        citations: [
          {
            n: 1,
            docId: "d-acme-msa",
            page: 12,
            quote:
              "This Agreement shall automatically renew for successive one (1) year terms unless either party provides written notice of non-renewal at least ninety (90) days prior to the end of the then-current term.",
          },
          {
            n: 2,
            docId: "d-q3-vendor-spend",
            page: 2,
            quote:
              "Acme Cloud: $412,300 annualized (+18% YoY). Northwind Analytics: $168,000 base + $12,600 Q3 overages.",
          },
          {
            n: 3,
            docId: "d-northwind-msa",
            page: 9,
            quote:
              "Customer may elect not to renew by providing notice no later than sixty (60) days before the expiration of the Subscription Term ending October 15, 2026.",
          },
          {
            n: 4,
            docId: "d-budget-policy",
            page: 5,
            quote:
              "Vendor commitments exceeding $100,000 in annual contract value require approval by the Chief Financial Officer prior to execution or renewal.",
          },
        ],
      },
      m3: {
        id: "m3",
        parentId: "m2",
        role: "user",
        content:
          "Draft a negotiation brief for the Acme renewal. Emphasize the SLA credits we're owed and target a 10% reduction.",
        createdAt: "2026-07-06T15:14:02Z",
        phase: "done",
        scopeLabel: "6 documents in scope",
      },
      m4: {
        id: "m4",
        parentId: "m3",
        role: "assistant",
        createdAt: "2026-07-06T15:20:30Z",
        phase: "done",
        content:
          "I've drafted the negotiation brief as a working document. It leads with leverage points — the Q2 uptime misses entitle you to **$18.4k in unclaimed service credits** ⟦1⟧ — then lays out the 10% reduction ask against benchmark pricing ⟦2⟧, a concession ladder, and a BATNA section covering the Northwind consolidation option.\n\nYou can open it in the Studio to review; the sections marked with green highlights are AI-drafted and awaiting your review.",
        thinking: [
          {
            id: "t1",
            kind: "plan",
            label: "Outlining brief structure",
            detail: "Leverage → asks → concessions → BATNA → timeline",
          },
          {
            id: "t2",
            kind: "read",
            label: "Extracting SLA credit terms from MSA §7",
            docIds: ["d-acme-msa"],
          },
          {
            id: "t3",
            kind: "analyze",
            label: "Benchmarking against pricing study",
            docIds: ["d-pricing-study"],
          },
          {
            id: "t4",
            kind: "tool",
            label: "Creating document “Acme Renewal — Negotiation Brief”",
            detail: "6 sections drafted, grounded in 3 source documents",
          },
        ],
        citations: [
          {
            n: 1,
            docId: "d-acme-msa",
            page: 19,
            quote:
              "Service Credits shall accrue at 5% of monthly fees for each 0.1% below the 99.9% Availability Commitment, claimable within twelve (12) months.",
          },
          {
            n: 2,
            docId: "d-pricing-study",
            page: 31,
            quote:
              "Median negotiated discount for enterprise IaaS renewals in the $250k–$500k band was 9.4%, with top-quartile buyers achieving 14% or greater.",
          },
        ],
        artifactIds: ["a-negotiation-brief"],
      },
      m3b: {
        id: "m3b",
        parentId: "m2",
        role: "user",
        content: "What termination-for-convenience rights do we have in the Acme MSA?",
        createdAt: "2026-07-06T15:16:45Z",
        phase: "done",
        scopeLabel: "6 documents in scope",
        editedFrom: "m3",
      },
      m4b: {
        id: "m4b",
        parentId: "m3b",
        role: "assistant",
        createdAt: "2026-07-06T15:17:20Z",
        phase: "done",
        content:
          "Termination rights under the Acme MSA are asymmetric and worth flagging before renewal:\n\n- **For convenience:** you may terminate with **180 days written notice**, but an early-termination fee of 50% of remaining-term fees applies ⟦1⟧.\n- **For cause:** either party may terminate on a material breach uncured for 30 days ⟦2⟧.\n- **SLA exit ramp:** three consecutive months below 99.5% availability gives you a fee-free termination right — Q2 came close with two months at 99.6% ⟦3⟧.\n\nThe practical lever is the SLA exit ramp: one more sub-99.5% month opens a no-penalty exit, which materially strengthens the renewal negotiation.",
        thinking: [
          {
            id: "t1",
            kind: "search",
            label: "Searching MSA for termination clauses",
            docIds: ["d-acme-msa"],
          },
          {
            id: "t2",
            kind: "read",
            label: "Reading §13 Termination and §7 Service Levels",
            docIds: ["d-acme-msa"],
          },
          {
            id: "t3",
            kind: "synthesize",
            label: "Relating SLA history to exit rights",
          },
        ],
        citations: [
          {
            n: 1,
            docId: "d-acme-msa",
            page: 27,
            quote:
              "Customer may terminate this Agreement for convenience upon one hundred eighty (180) days prior written notice, subject to an early termination charge equal to fifty percent (50%) of the fees for the remainder of the term.",
          },
          {
            n: 2,
            docId: "d-acme-msa",
            page: 28,
            quote:
              "Either party may terminate for material breach where such breach remains uncured thirty (30) days after written notice.",
          },
          {
            n: 3,
            docId: "d-acme-msa",
            page: 20,
            quote:
              "Should Availability fall below 99.5% for three (3) consecutive calendar months, Customer may terminate the affected Services without charge.",
          },
        ],
      },
    },
  },
  {
    id: "s-security",
    title: "RFP security questionnaire",
    createdAt: "2026-07-05T09:12:00Z",
    updatedAt: "2026-07-05T09:40:00Z",
    scopeDocIds: ["d-sp-security-faq", "d-soc2"],
    leafId: "n2",
    messages: {
      n1: {
        id: "n1",
        parentId: null,
        role: "user",
        content:
          "Using the answer bank and the SOC 2 report, draft answers for the Meridian RFP's data-residency section.",
        createdAt: "2026-07-05T09:12:20Z",
        phase: "done",
        scopeLabel: "2 documents in scope",
      },
      n2: {
        id: "n2",
        parentId: "n1",
        role: "assistant",
        createdAt: "2026-07-05T09:13:05Z",
        phase: "done",
        content:
          "Here are draft answers for the data-residency section:\n\n**Where is customer data stored?** Production data is stored in AWS us-east-1 and eu-central-1; enterprise plans may pin residency to a single region ⟦1⟧.\n\n**Is data encrypted at rest and in transit?** Yes — AES-256 at rest and TLS 1.2+ in transit, validated in the SOC 2 Type II audit with no exceptions noted ⟦2⟧.\n\n**Which subprocessors can access customer data?** Four subprocessors, listed with roles and regions in the answer bank; the SOC 2 report confirms annual subprocessor reviews ⟦3⟧.",
        thinking: [
          {
            id: "t1",
            kind: "search",
            label: "Locating residency answers in the answer bank",
            docIds: ["d-sp-security-faq"],
          },
          {
            id: "t2",
            kind: "read",
            label: "Verifying against SOC 2 control descriptions",
            docIds: ["d-soc2"],
          },
        ],
        citations: [
          {
            n: 1,
            docId: "d-sp-security-faq",
            page: 8,
            quote:
              "Customer content is stored in AWS us-east-1 (N. Virginia) and eu-central-1 (Frankfurt). Enterprise customers may elect single-region residency.",
          },
          {
            n: 2,
            docId: "d-soc2",
            page: 41,
            quote:
              "Data at rest is encrypted using AES-256; data in transit is protected via TLS 1.2 or higher. No exceptions noted.",
          },
          {
            n: 3,
            docId: "d-soc2",
            page: 63,
            quote:
              "Management performs an annual review of subprocessors, including security posture and data processing agreements.",
          },
        ],
      },
    },
  },
  {
    id: "s-qbr",
    title: "Q3 business review draft",
    createdAt: "2026-07-03T13:30:00Z",
    updatedAt: "2026-07-04T10:05:00Z",
    scopeDocIds: ["d-q3-forecast", "d-q2-board", "d-usage-metrics"],
    leafId: "p2",
    messages: {
      p1: {
        id: "p1",
        parentId: null,
        role: "user",
        content:
          "Draft a first-cut Q3 business review from the Q3 forecast narrative, reusing the Q2 board document structure.",
        createdAt: "2026-07-03T13:30:15Z",
        phase: "done",
        scopeLabel: "3 documents in scope",
      },
      p2: {
        id: "p2",
        parentId: "p1",
        role: "assistant",
        createdAt: "2026-07-03T13:45:50Z",
        phase: "done",
        content:
          "Draft document is ready — following the Q2 structure: summary, financials, product, GTM, risks, asks. The spend-trend section is generated from the June usage export, and every figure carries a source citation. Open it in the Studio to review section-by-section.",
        thinking: [
          {
            id: "t1",
            kind: "read",
            label: "Extracting Q2 document structure",
            docIds: ["d-q2-board"],
          },
          {
            id: "t2",
            kind: "analyze",
            label: "Summarizing forecast narrative into section points",
            docIds: ["d-q3-forecast"],
          },
          {
            id: "t3",
            kind: "tool",
            label: "Creating document “Q3 Business Review — Draft”",
            detail: "6 sections, 4 tables, citations on every figure",
          },
        ],
        artifactIds: ["a-qbr-deck"],
      },
    },
  },
]

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export const seedActivity: ActivityItem[] = [
  {
    id: "act-1",
    kind: "sync",
    text: "SharePoint sync completed for Operations Hub",
    detail: "3 documents up to date · 1 updated",
    time: "2026-07-07T06:00:00Z",
  },
  {
    id: "act-2",
    kind: "artifact",
    text: "AI edited “Acme Renewal — Negotiation Brief”",
    detail: "Tightened the BATNA section and added the uptime-credit ask",
    time: "2026-07-06T15:26:00Z",
  },
  {
    id: "act-3",
    kind: "chat",
    text: "New session “Q3 vendor renewals review”",
    detail: "6 documents in scope",
    time: "2026-07-06T14:58:00Z",
  },
  {
    id: "act-4",
    kind: "upload",
    text: "Vendor Onboarding Notes.md uploaded",
    detail: "Indexing in progress",
    time: "2026-07-07T08:10:00Z",
  },
  {
    id: "act-5",
    kind: "export",
    text: "Session exported to PDF",
    detail: "RFP security questionnaire · 2 turns",
    time: "2026-07-05T09:40:00Z",
  },
  {
    id: "act-6",
    kind: "share",
    text: "Response sent as email to legal@jacobs.com",
    detail: "Acme termination rights summary",
    time: "2026-07-06T15:35:00Z",
  },
]

/* ------------------------------------------------------------------ */
/* Version history placeholder                                         */
/* ------------------------------------------------------------------ */

export function versionsFor(doc: Doc): DocVersion[] {
  const base = new Date(doc.updatedAt).getTime()
  return Array.from({ length: Math.min(doc.version, 4) }, (_, i) => {
    const v = doc.version - i
    return {
      version: v,
      date: new Date(base - i * 86400000 * 9).toISOString(),
      author: doc.owner,
      note:
        i === 0
          ? "Current version"
          : i === 1
            ? "Updated after stakeholder review"
            : i === 2
              ? "Formatting and section reorder"
              : "Initial upload",
    }
  })
}
