'use strict';
// ══ Boards & Committees Module (mock data, no backend) ═════════════════════
// Uses esc(), $(), App from app.js.

const BC_COLORS = ["#4A6FA5","#6B7C93","#8B6BA8","#5B9BD5","#4CAF7D","#E08A3C","#C0785A","#2E9E7A"];
function bcColor(seed) {
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  return BC_COLORS[h % BC_COLORS.length];
}
function bcInit(name) {
  return (name || "").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function bcT(ar, en) { return App.lang === "ar" ? ar : en; }
function bcDate(iso, withTime) {
  const d = new Date(iso);
  const opts = { day: "2-digit", month: "short", year: "numeric" };
  if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
  return d.toLocaleDateString(App.lang === "ar" ? "ar-SA" : "en-GB", opts);
}

const BC_MEMBERS = [
  { id: "m1", nameAr: "محمد عبدالله", nameEn: "Mohammed Abdullah", roleAr: "رئيس", roleEn: "Chairman", typeAr: "تنفيذي", typeEn: "Executive", since: "2020-01-01", attendance: 96 },
  { id: "m2", nameAr: "خالد المنصور", nameEn: "Khalid Al-Mansour", roleAr: "عضو مجلس", roleEn: "Board Member", typeAr: "تنفيذي", typeEn: "Executive", since: "2020-03-15", attendance: 90 },
  { id: "m3", nameAr: "نورة القحطاني", nameEn: "Noura Al-Qahtani", roleAr: "مدير مستقل", roleEn: "Independent Director", typeAr: "مستقل", typeEn: "Independent", since: "2020-05-10", attendance: 93 },
  { id: "m4", nameAr: "فهد المطيري", nameEn: "Fahad Al-Mutairi", roleAr: "عضو مجلس", roleEn: "Board Member", typeAr: "غير تنفيذي", typeEn: "Non-Executive", since: "2020-08-20", attendance: 88 },
  { id: "m5", nameAr: "سارة القحطاني", nameEn: "Sara Al-Qahtani", roleAr: "مدير مستقل", roleEn: "Independent Director", typeAr: "مستقل", typeEn: "Independent", since: "2021-01-05", attendance: 95 },
  { id: "m6", nameAr: "عبدالله السبيعي", nameEn: "Abdullah Al-Subai", roleAr: "عضو مستقل", roleEn: "Independent Member", typeAr: "مستقل", typeEn: "Independent", since: "2021-01-05", attendance: 90 },
];

const BC_DATA = [
  {
    id: "board-of-directors", type: "board", icon: "🏛️",
    nameAr: "مجلس الإدارة", nameEn: "Board of Directors",
    subtitleAr: "مجلس الإدارة", subtitleEn: "Board of Directors",
    descAr: "يشرف على التوجه الاستراتيجي للمنظمة والأداء والحوكمة.",
    descEn: "Oversees the organization's strategic direction, performance, and governance.",
    status: "active", committeeType: "Board",
    chairperson: BC_MEMBERS[0], secretariat: "Ameen Secretary Team",
    established: "2020-01-01", frequency: { ar: "ربع سنوي", en: "Quarterly" },
    nextMeeting: "2026-04-24T10:00:00", location: { ar: "القاعة الرئيسية", en: "Main Boardroom" },
    membersCount: 14, meetingsCount: 32, documentsCount: 28, tasksCount: 32, resolutionsCount: 16,
    members: BC_MEMBERS,
    memberSummary: [
      { label: { ar: "الرئيس", en: "Chairman" }, n: 1, color: "#5B9BD5" },
      { label: { ar: "أعضاء المجلس", en: "Board Members" }, n: 10, color: "#4CAF7D" },
      { label: { ar: "مستقل", en: "Independent" }, n: 2, color: "#E08A3C" },
      { label: { ar: "بحكم المنصب", en: "Ex-Officio" }, n: 1, color: "#8B6BA8" },
    ],
    attendanceAvg: 92,
    responsibilities: [
      { ar: "الموافقة على الخطط الاستراتيجية والمبادرات الرئيسية", en: "Approve strategic plans and major initiatives" },
      { ar: "مراجعة الأداء المالي والتقارير", en: "Review financial performance and reports" },
      { ar: "ضمان إدارة فعالة للمخاطر والامتثال", en: "Ensure effective risk management and compliance" },
      { ar: "الإشراف على الإدارة التنفيذية والتعاقب الوظيفي", en: "Oversee executive management and succession" },
      { ar: "دعم معايير الحوكمة والأخلاقيات", en: "Uphold governance and ethical standards" },
    ],
    upcomingMeetings: [
      { title: { ar: "اجتماع مجلس الإدارة (الربع الثاني 2026)", en: "Q2 Board Meeting 2026" }, date: "2026-04-24T10:00:00", location: { ar: "القاعة الرئيسية", en: "Main Boardroom" } },
    ],
    recentDocuments: [
      { name: "Board Charter.pdf", size: "245 KB" },
      { name: "2026 Annual Work Plan.docx", size: "1.2 MB" },
      { name: "Governance Framework.pdf", size: "3.4 MB" },
    ],
    recentResolutions: [
      { code: "RES-2026-012", title: { ar: "اعتماد الخطة الاستراتيجية 2026", en: "Approve 2026 Strategic Plan" }, status: "approved" },
      { code: "RES-2026-011", title: { ar: "اعتماد البيانات المالية للربع الأول", en: "Approve Q1 Financial Statements" }, status: "approved" },
      { code: "RES-2026-010", title: { ar: "تعيين عضو جديد في اللجنة التنفيذية", en: "Appoint new Executive Committee member" }, status: "approved" },
    ],
    activity: [
      { icon: "👤", title: { ar: "إضافة عضو جديد", en: "New member added" }, sub: "خالد المنصور", time: { ar: "قبل يومين", en: "2 days ago" } },
      { icon: "📄", title: { ar: "رفع وثيقة", en: "Document uploaded" }, sub: "2026 Annual Work Plan.docx", time: { ar: "قبل 3 أيام", en: "3 days ago" } },
      { icon: "✅", title: { ar: "اعتماد قرار", en: "Resolution approved" }, sub: "RES-2026-012", time: { ar: "قبل 5 أيام", en: "5 days ago" } },
    ],
  },
  {
    id: "audit-committee", type: "committee", icon: "🛡️",
    nameAr: "لجنة المراجعة", nameEn: "Audit Committee",
    subtitleAr: "لجنة المراجعة", subtitleEn: "Audit Committee",
    descAr: "تشرف على التقارير المالية والضوابط الداخلية وإدارة المخاطر.",
    descEn: "Oversees financial reporting, internal controls, and risk management.",
    status: "active", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[1], secretariat: "Ameen Secretary Team",
    established: "2020-03-15", frequency: { ar: "ربع سنوي", en: "Quarterly" },
    nextMeeting: "2026-04-30T14:00:00", location: { ar: "قاعة اللجنة ب", en: "Committee Room B" },
    membersCount: 5, meetingsCount: 8, documentsCount: 18, tasksCount: 12, resolutionsCount: 6,
    members: BC_MEMBERS.slice(0, 5).map((m, i) => ({ ...m, roleAr: i === 0 ? "الرئيس" : "عضو", roleEn: i === 0 ? "Chairman" : "Member", typeAr: i < 3 ? "عضو مجلس" : "مستقل", typeEn: i < 3 ? "Board Member" : "Independent" })),
    memberSummary: [
      { label: { ar: "مكتمل", en: "Completed" }, n: 5, color: "#4CAF7D" },
      { label: { ar: "قادم", en: "Upcoming" }, n: 2, color: "#5B9BD5" },
      { label: { ar: "ملغى", en: "Cancelled" }, n: 1, color: "#C0785A" },
    ],
    attendanceAvg: 91,
    purposeAr: "مساعدة المجلس في القيام بمسؤولياته الرقابية المتعلقة بالتقارير المالية والمراجعة الداخلية والخارجية وإدارة المخاطر والامتثال.",
    purposeEn: "Assist the Board in fulfilling its oversight responsibilities related to financial reporting, internal audit, external audit, risk management, and compliance.",
    responsibilities: [
      { ar: "مراجعة البيانات المالية والإفصاحات", en: "Review financial statements and disclosures" },
      { ar: "الإشراف على أنشطة المراجعة الداخلية والخارجية", en: "Oversee internal and external audit activities" },
      { ar: "الإشراف على إدارة المخاطر والضوابط الداخلية", en: "Monitor risk management and internal controls" },
      { ar: "ضمان الامتثال للقوانين واللوائح", en: "Ensure compliance with laws and regulations" },
      { ar: "التوصية بتعيين مراجعي الحسابات الخارجيين", en: "Recommend appointment of external auditors" },
    ],
    upcomingMeetings: [
      { title: { ar: "اجتماع لجنة المراجعة", en: "Audit Committee Meeting" }, date: "2026-04-30T14:00:00", location: { ar: "قاعة اللجنة ب", en: "Committee Room B" } },
      { title: { ar: "اجتماع لجنة المراجعة", en: "Audit Committee Meeting" }, date: "2026-08-07T14:00:00", location: { ar: "قاعة اللجنة ب", en: "Committee Room B" } },
    ],
    recentDocuments: [
      { name: "Q1 2026 Financial Review.pdf", size: "245 KB" },
      { name: "Internal Audit Report 2025.docx", size: "1.2 MB" },
      { name: "Risk Assessment Summary.pptx", size: "3.4 MB" },
    ],
    recentResolutions: [
      { code: "RES-AUD-2026-03", title: { ar: "اعتماد تعيين مراجع خارجي", en: "Approval of External Auditor Appointment" }, status: "approved" },
      { code: "RES-AUD-2026-02", title: { ar: "مراجعة البيانات المالية للربع الأول 2026", en: "Q1 2026 Financial Statements Review" }, status: "approved" },
      { code: "RES-AUD-2026-01", title: { ar: "خطة المراجعة الداخلية 2026", en: "Internal Audit Plan 2026" }, status: "approved" },
    ],
    activity: [
      { icon: "✅", title: { ar: "اعتماد محضر الاجتماع", en: "Meeting minutes approved" }, sub: "Audit Committee", time: { ar: "قبل ساعتين", en: "2 hours ago" } },
      { icon: "📄", title: { ar: "رفع وثيقة", en: "Document uploaded" }, sub: "Risk Assessment Summary.pptx", time: { ar: "قبل يوم", en: "1 day ago" } },
    ],
  },
  {
    id: "executive-committee", type: "committee", icon: "📈",
    nameAr: "اللجنة التنفيذية", nameEn: "Executive Committee",
    descAr: "تدير القرارات التشغيلية اليومية بالنيابة عن المجلس.",
    descEn: "Manages day-to-day operational decisions on behalf of the Board.",
    status: "active", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[3], secretariat: "Ameen Secretary Team",
    established: "2020-04-01", frequency: { ar: "شهري", en: "Monthly" },
    nextMeeting: "2026-04-26T11:00:00", location: { ar: "قاعة اللجنة أ", en: "Committee Room A" },
    membersCount: 6, meetingsCount: 20, documentsCount: 15, tasksCount: 22, resolutionsCount: 9,
    members: BC_MEMBERS.slice(0, 6),
    memberSummary: [{ label: { ar: "مكتمل", en: "Completed" }, n: 12, color: "#4CAF7D" }, { label: { ar: "قادم", en: "Upcoming" }, n: 3, color: "#5B9BD5" }],
    attendanceAvg: 89,
    purposeAr: "الإشراف على تنفيذ القرارات الاستراتيجية والعمليات اليومية.",
    purposeEn: "Oversee execution of strategic decisions and day-to-day operations.",
    responsibilities: [{ ar: "متابعة الأداء التشغيلي", en: "Monitor operational performance" }, { ar: "اعتماد الميزانيات التشغيلية", en: "Approve operating budgets" }],
    upcomingMeetings: [{ title: { ar: "اجتماع اللجنة التنفيذية", en: "Executive Committee Meeting" }, date: "2026-04-26T11:00:00", location: { ar: "قاعة اللجنة أ", en: "Committee Room A" } }],
    recentDocuments: [{ name: "Ops Review Q1.pdf", size: "410 KB" }],
    recentResolutions: [{ code: "RES-EXE-2026-04", title: { ar: "اعتماد ميزانية التشغيل", en: "Approve operating budget" }, status: "approved" }],
    activity: [{ icon: "👤", title: { ar: "إضافة عضو جديد", en: "New member added" }, sub: "فهد المطيري", time: { ar: "قبل 3 أيام", en: "3 days ago" } }],
  },
  {
    id: "risk-committee", type: "committee", icon: "⚠️",
    nameAr: "لجنة إدارة المخاطر", nameEn: "Risk Committee",
    descAr: "تشرف على إطار إدارة المخاطر المؤسسية.",
    descEn: "Oversees the enterprise risk management framework.",
    status: "active", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[5], secretariat: "Ameen Secretary Team",
    established: "2020-06-01", frequency: { ar: "ربع سنوي", en: "Quarterly" },
    nextMeeting: "2026-05-07T11:00:00", location: { ar: "قاعة اللجنة أ", en: "Committee Room A" },
    membersCount: 4, meetingsCount: 10, documentsCount: 9, tasksCount: 7, resolutionsCount: 4,
    members: BC_MEMBERS.slice(1, 5),
    memberSummary: [{ label: { ar: "مكتمل", en: "Completed" }, n: 7, color: "#4CAF7D" }, { label: { ar: "قادم", en: "Upcoming" }, n: 1, color: "#5B9BD5" }],
    attendanceAvg: 90,
    purposeAr: "متابعة وتقييم المخاطر الرئيسية التي تواجه المنظمة.",
    purposeEn: "Monitor and evaluate key risks facing the organization.",
    responsibilities: [{ ar: "مراجعة سجل المخاطر ربع السنوي", en: "Review quarterly risk register" }],
    upcomingMeetings: [{ title: { ar: "اجتماع لجنة المخاطر", en: "Risk Committee Meeting" }, date: "2026-05-07T11:00:00", location: { ar: "قاعة اللجنة أ", en: "Committee Room A" } }],
    recentDocuments: [{ name: "Risk Register Q1.xlsx", size: "180 KB" }],
    recentResolutions: [{ code: "RES-RSK-2026-02", title: { ar: "اعتماد سجل المخاطر المحدث", en: "Approve updated risk register" }, status: "approved" }],
    activity: [{ icon: "📄", title: { ar: "رفع وثيقة", en: "Document uploaded" }, sub: "Risk Register Q1.xlsx", time: { ar: "قبل يوم", en: "1 day ago" } }],
  },
  {
    id: "technology-committee", type: "committee", icon: "💻",
    nameAr: "لجنة التقنية والتحول الرقمي", nameEn: "Technology Committee",
    descAr: "تشرف على استراتيجية التقنية والتحول الرقمي.",
    descEn: "Oversees technology strategy and digital transformation.",
    status: "active", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[2], secretariat: "Ameen Secretary Team",
    established: "2021-01-10", frequency: { ar: "شهري", en: "Monthly" },
    nextMeeting: "2026-05-08T10:00:00", location: { ar: "قاعة اللجنة ج", en: "Committee Room C" },
    membersCount: 4, meetingsCount: 14, documentsCount: 11, tasksCount: 10, resolutionsCount: 3,
    members: BC_MEMBERS.slice(0, 4),
    memberSummary: [{ label: { ar: "مكتمل", en: "Completed" }, n: 9, color: "#4CAF7D" }, { label: { ar: "قادم", en: "Upcoming" }, n: 2, color: "#5B9BD5" }],
    attendanceAvg: 87,
    purposeAr: "توجيه استثمارات التقنية ومبادرات التحول الرقمي.",
    purposeEn: "Guide technology investments and digital transformation initiatives.",
    responsibilities: [{ ar: "اعتماد خارطة طريق التقنية", en: "Approve technology roadmap" }],
    upcomingMeetings: [{ title: { ar: "اجتماع لجنة التقنية", en: "Technology Committee Meeting" }, date: "2026-05-08T10:00:00", location: { ar: "قاعة اللجنة ج", en: "Committee Room C" } }],
    recentDocuments: [{ name: "Digital Roadmap 2026.pdf", size: "2.1 MB" }],
    recentResolutions: [{ code: "RES-TEC-2026-01", title: { ar: "اعتماد خارطة الطريق الرقمية", en: "Approve digital roadmap" }, status: "approved" }],
    activity: [{ icon: "✅", title: { ar: "اعتماد قرار", en: "Resolution approved" }, sub: "RES-TEC-2026-01", time: { ar: "قبل 4 أيام", en: "4 days ago" } }],
  },
  {
    id: "nomination-committee", type: "committee", icon: "🏆",
    nameAr: "لجنة الترشيحات والمكافآت", nameEn: "Nomination & Remuneration Committee",
    descAr: "تشرف على ترشيحات المجلس وسياسات المكافآت.",
    descEn: "Oversees board nominations and remuneration policies.",
    status: "inactive", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[3], secretariat: "Ameen Secretary Team",
    established: "2020-09-01", frequency: { ar: "نصف سنوي", en: "Semi-Annual" },
    nextMeeting: "2026-05-05T16:00:00", location: { ar: "قاعة اللجنة أ", en: "Committee Room A" },
    membersCount: 4, meetingsCount: 6, documentsCount: 7, tasksCount: 4, resolutionsCount: 2,
    members: BC_MEMBERS.slice(2, 6),
    memberSummary: [{ label: { ar: "مكتمل", en: "Completed" }, n: 4, color: "#4CAF7D" }, { label: { ar: "قادم", en: "Upcoming" }, n: 1, color: "#5B9BD5" }],
    attendanceAvg: 85,
    purposeAr: "مراجعة ترشيحات أعضاء المجلس وسياسات المكافآت التنفيذية.",
    purposeEn: "Review board member nominations and executive remuneration policies.",
    responsibilities: [{ ar: "تقييم مرشحي المجلس الجدد", en: "Evaluate new board candidates" }],
    upcomingMeetings: [{ title: { ar: "اجتماع لجنة الترشيحات", en: "Nomination Committee Meeting" }, date: "2026-05-05T16:00:00", location: { ar: "قاعة اللجنة أ", en: "Committee Room A" } }],
    recentDocuments: [{ name: "Remuneration Policy.pdf", size: "300 KB" }],
    recentResolutions: [{ code: "RES-NOM-2026-01", title: { ar: "اعتماد سياسة المكافآت", en: "Approve remuneration policy" }, status: "pending" }],
    activity: [{ icon: "👤", title: { ar: "إضافة عضو جديد", en: "New member added" }, sub: "سارة القحطاني", time: { ar: "قبل أسبوع", en: "1 week ago" } }],
  },
  {
    id: "sustainability-committee", type: "committee", icon: "🌱",
    nameAr: "لجنة الاستدامة", nameEn: "Sustainability Committee",
    descAr: "تشرف على مبادرات الاستدامة والمسؤولية المجتمعية.",
    descEn: "Oversees sustainability and corporate responsibility initiatives.",
    status: "active", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[4], secretariat: "Ameen Secretary Team",
    established: "2021-06-01", frequency: { ar: "ربع سنوي", en: "Quarterly" },
    nextMeeting: "2026-05-12T13:00:00", location: { ar: "قاعة اللجنة ب", en: "Committee Room B" },
    membersCount: 3, meetingsCount: 6, documentsCount: 5, tasksCount: 3, resolutionsCount: 2,
    members: BC_MEMBERS.slice(3, 6),
    memberSummary: [{ label: { ar: "مكتمل", en: "Completed" }, n: 4, color: "#4CAF7D" }, { label: { ar: "قادم", en: "Upcoming" }, n: 1, color: "#5B9BD5" }],
    attendanceAvg: 91,
    purposeAr: "دفع أجندة الاستدامة البيئية والاجتماعية.",
    purposeEn: "Drive the environmental and social sustainability agenda.",
    responsibilities: [{ ar: "مراجعة تقرير الاستدامة السنوي", en: "Review annual sustainability report" }],
    upcomingMeetings: [{ title: { ar: "اجتماع لجنة الاستدامة", en: "Sustainability Committee Meeting" }, date: "2026-05-12T13:00:00", location: { ar: "قاعة اللجنة ب", en: "Committee Room B" } }],
    recentDocuments: [{ name: "Sustainability Report 2025.pdf", size: "5 MB" }],
    recentResolutions: [{ code: "RES-SUS-2026-01", title: { ar: "اعتماد تقرير الاستدامة", en: "Approve sustainability report" }, status: "approved" }],
    activity: [{ icon: "📄", title: { ar: "رفع وثيقة", en: "Document uploaded" }, sub: "Sustainability Report 2025.pdf", time: { ar: "قبل يومين", en: "2 days ago" } }],
  },
  {
    id: "investment-committee", type: "committee", icon: "💰",
    nameAr: "لجنة الاستثمار", nameEn: "Investment Committee",
    descAr: "تشرف على قرارات الاستثمار وإدارة المحفظة.",
    descEn: "Oversees investment decisions and portfolio management.",
    status: "active", committeeType: { ar: "لجنة دائمة", en: "Standing Committee" },
    chairperson: BC_MEMBERS[1], secretariat: "Ameen Secretary Team",
    established: "2020-11-01", frequency: { ar: "شهري", en: "Monthly" },
    nextMeeting: "2026-05-14T10:00:00", location: { ar: "القاعة الرئيسية", en: "Main Boardroom" },
    membersCount: 5, meetingsCount: 16, documentsCount: 12, tasksCount: 8, resolutionsCount: 5,
    members: BC_MEMBERS.slice(0, 5),
    memberSummary: [{ label: { ar: "مكتمل", en: "Completed" }, n: 10, color: "#4CAF7D" }, { label: { ar: "قادم", en: "Upcoming" }, n: 2, color: "#5B9BD5" }],
    attendanceAvg: 93,
    purposeAr: "الإشراف على استراتيجية الاستثمار وأداء المحفظة.",
    purposeEn: "Oversee investment strategy and portfolio performance.",
    responsibilities: [{ ar: "اعتماد المقترحات الاستثمارية الكبرى", en: "Approve major investment proposals" }],
    upcomingMeetings: [{ title: { ar: "اجتماع لجنة الاستثمار", en: "Investment Committee Meeting" }, date: "2026-05-14T10:00:00", location: { ar: "القاعة الرئيسية", en: "Main Boardroom" } }],
    recentDocuments: [{ name: "Portfolio Review Q1.pdf", size: "1.8 MB" }],
    recentResolutions: [{ code: "RES-INV-2026-03", title: { ar: "اعتماد مقترح استثماري جديد", en: "Approve new investment proposal" }, status: "approved" }],
    activity: [{ icon: "✅", title: { ar: "اعتماد قرار", en: "Resolution approved" }, sub: "RES-INV-2026-03", time: { ar: "قبل 6 أيام", en: "6 days ago" } }],
  },
];

function bcById(id) { return BC.data.find(b => b.id === id); }
let bcSeq = 1000;
function bcNextId(prefix) { return `${prefix}-${Date.now()}-${bcSeq++}`; }

function bcEnsureModalRoot() {
  let root = document.getElementById("bc-modal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "bc-modal-root";
    document.body.appendChild(root);
  }
  return root;
}

// ── Standard group name presets ────────────────────────────────────────────
const BC_TEMPLATES = [
  { val: "",       labelAr: "— اختر قالباً أو ابدأ من الصفر —",      labelEn: "— Select a template, or start from scratch —", type: "",             nameAr: "",                              nameEn: "" },
  // ── Boards
  { val: "bod",    labelAr: "🏛️ مجلس الإدارة",                       labelEn: "🏛️ Board of Directors",                        type: "board",        nameAr: "مجلس الإدارة",                  nameEn: "Board of Directors" },
  { val: "abrd",   labelAr: "💡 مجلس استشاري",                        labelEn: "💡 Advisory Board",                            type: "advisory",     nameAr: "المجلس الاستشاري",              nameEn: "Advisory Board" },
  // ── Standing Committees
  { val: "audit",  labelAr: "🛡️ لجنة المراجعة والتدقيق",              labelEn: "🛡️ Audit Committee",                           type: "committee",    nameAr: "لجنة المراجعة والتدقيق",        nameEn: "Audit Committee" },
  { val: "exec",   labelAr: "⚡ اللجنة التنفيذية",                    labelEn: "⚡ Executive Committee",                        type: "executive",    nameAr: "اللجنة التنفيذية",              nameEn: "Executive Committee" },
  { val: "risk",   labelAr: "⚠️ لجنة المخاطر",                       labelEn: "⚠️ Risk Committee",                            type: "committee",    nameAr: "لجنة المخاطر",                  nameEn: "Risk Committee" },
  { val: "fin",    labelAr: "💰 لجنة المالية",                        labelEn: "💰 Finance Committee",                          type: "committee",    nameAr: "لجنة المالية",                  nameEn: "Finance Committee" },
  { val: "nom",    labelAr: "🏆 لجنة الترشيحات والمكافآت",             labelEn: "🏆 Nomination & Remuneration Committee",         type: "committee",    nameAr: "لجنة الترشيحات والمكافآت",      nameEn: "Nomination & Remuneration Committee" },
  { val: "inv",    labelAr: "💹 لجنة الاستثمار",                      labelEn: "💹 Investment Committee",                       type: "committee",    nameAr: "لجنة الاستثمار",                nameEn: "Investment Committee" },
  { val: "gov",    labelAr: "🏦 لجنة الحوكمة",                        labelEn: "🏦 Governance Committee",                       type: "committee",    nameAr: "لجنة الحوكمة",                  nameEn: "Governance Committee" },
  { val: "sust",   labelAr: "🌱 لجنة الاستدامة",                      labelEn: "🌱 Sustainability Committee",                    type: "committee",    nameAr: "لجنة الاستدامة",                nameEn: "Sustainability Committee" },
  { val: "tech",   labelAr: "💻 لجنة التقنية والابتكار",               labelEn: "💻 Technology & Innovation Committee",           type: "technical",    nameAr: "لجنة التقنية والابتكار",        nameEn: "Technology & Innovation Committee" },
  { val: "legal",  labelAr: "⚖️ اللجنة القانونية",                    labelEn: "⚖️ Legal Committee",                           type: "committee",    nameAr: "اللجنة القانونية",              nameEn: "Legal Committee" },
  { val: "comp_c", labelAr: "✅ لجنة الامتثال",                       labelEn: "✅ Compliance Committee",                       type: "committee",    nameAr: "لجنة الامتثال والرقابة",        nameEn: "Compliance & Control Committee" },
  { val: "steer",  labelAr: "🧭 لجنة التوجيه الاستراتيجي",            labelEn: "🧭 Strategic Steering Committee",               type: "steering",     nameAr: "لجنة التوجيه الاستراتيجي",     nameEn: "Strategic Steering Committee" },
  // ── Department Teams
  { val: "hr",     labelAr: "👤 فريق الموارد البشرية",                 labelEn: "👤 Human Resources (HR) Team",                  type: "team",         nameAr: "فريق الموارد البشرية",          nameEn: "Human Resources Team" },
  { val: "fteam",  labelAr: "💰 فريق المالية",                        labelEn: "💰 Finance Team",                               type: "team",         nameAr: "فريق المالية",                  nameEn: "Finance Team" },
  { val: "lteam",  labelAr: "⚖️ الفريق القانوني",                     labelEn: "⚖️ Legal Team",                                type: "team",         nameAr: "الفريق القانوني",               nameEn: "Legal Team" },
  { val: "iteam",  labelAr: "💻 فريق تقنية المعلومات (IT)",            labelEn: "💻 IT Team",                                   type: "technical",    nameAr: "فريق تقنية المعلومات",          nameEn: "Information Technology Team" },
  { val: "ops",    labelAr: "⚙️ فريق العمليات",                       labelEn: "⚙️ Operations Team",                           type: "team",         nameAr: "فريق العمليات",                 nameEn: "Operations Team" },
  { val: "mktg",   labelAr: "📣 فريق التسويق والاتصالات",              labelEn: "📣 Marketing & Communications Team",             type: "team",         nameAr: "فريق التسويق والاتصالات",       nameEn: "Marketing & Communications Team" },
  { val: "comp",   labelAr: "✅ فريق الامتثال",                       labelEn: "✅ Compliance Team",                            type: "team",         nameAr: "فريق الامتثال",                 nameEn: "Compliance Team" },
  { val: "strat",  labelAr: "🎯 فريق الاستراتيجية والتخطيط",           labelEn: "🎯 Strategy & Planning Team",                   type: "working_group",nameAr: "فريق الاستراتيجية والتخطيط",   nameEn: "Strategy & Planning Team" },
  { val: "proc",   labelAr: "📋 فريق المشتريات",                      labelEn: "📋 Procurement Team",                           type: "team",         nameAr: "فريق المشتريات",                nameEn: "Procurement Team" },
  // ── Task Forces & Working Groups
  { val: "dt",     labelAr: "🚀 فرقة التحول الرقمي",                   labelEn: "🚀 Digital Transformation Task Force",           type: "task_force",   nameAr: "فرقة التحول الرقمي",            nameEn: "Digital Transformation Task Force" },
  { val: "proj",   labelAr: "📐 مجموعة عمل المشروع",                  labelEn: "📐 Project Working Group",                      type: "working_group",nameAr: "مجموعة عمل المشروع",            nameEn: "Project Working Group" },
  // ── Other
  { val: "other",  labelAr: "✏️ أخرى — أكتب الاسم بنفسك",             labelEn: "✏️ Other — type your own name",                 type: "",             nameAr: "",                              nameEn: "" },
];

const BC = {
  view: "list",
  activeId: null,
  activeTab: "overview",
  q: "", type: "", status: "",
  _searchTimer: null,
  onSearch(v) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => { this.q = (v || "").trim(); this.render(); }, 280);
  },

  async init() {
    this.view = "list"; this.activeId = null;
    await BC.loadFromAPI();
    this.render();
  },

  async loadFromAPI() {
    try {
      const res = await fetch("/api/gov/boards", { credentials: "include" });
      if (!res.ok) throw new Error("API error");
      const apiBoards = await res.json();

      // Map API boards to BC format, merging with BC_DATA enrichment where available
      const mapped = apiBoards.map(b => {
        const match = BC_DATA.find(d =>
          d.nameEn.toLowerCase().includes(b.name_en.toLowerCase()) ||
          b.name_en.toLowerCase().includes(d.nameEn.toLowerCase()) ||
          d.nameAr.includes(b.name_ar)
        );
        // Parse chairperson from API string (e.g. "Mohammed Al-Otaibi")
        const chairName = b.chairperson || "";
        const chairMember = BC_MEMBERS.find(m =>
          m.nameEn.toLowerCase().includes(chairName.split(" ")[0].toLowerCase())
        ) || (chairName ? { nameEn: chairName, nameAr: chairName, roleEn: "Chairman", roleAr: "رئيس", attendance: 90 } : BC_MEMBERS[0]);

        // Parse members from API string array (e.g. "Mohammed Al-Otaibi — Chairman")
        const apiMembers = (b.members || []).map((mStr, i) => {
          const parts = mStr.split(" — ");
          const name = parts[0]?.trim() || mStr;
          const role = parts[1]?.trim() || "Member";
          const existing = BC_MEMBERS.find(m => m.nameEn.toLowerCase().includes(name.split(" ")[0].toLowerCase()));
          return existing || {
            id: `api-${b.id}-m${i}`,
            nameEn: name, nameAr: name,
            roleEn: role, roleAr: role,
            typeEn: "Executive", typeAr: "تنفيذي",
            since: b.created_at?.split(" ")[0] || "2024-01-01",
            attendance: Math.floor(85 + Math.random() * 12)
          };
        });

        return {
          // Use numeric id as string for routing
          id: String(b.id),
          _apiId: b.id,
          type: "board",
          icon: match?.icon || "🏛️",
          nameAr: b.name_ar || match?.nameAr || b.name_en,
          nameEn: b.name_en || match?.nameEn || b.name_ar,
          subtitleAr: match?.subtitleAr || b.name_ar,
          subtitleEn: match?.subtitleEn || b.name_en,
          descAr: b.description || match?.descAr || "",
          descEn: b.description || match?.descEn || "",
          status: "active",
          committeeType: match?.committeeType || "Board",
          chairperson: chairMember,
          secretariat: match?.secretariat || "Ameen Secretary Team",
          established: b.created_at?.split(" ")[0] || match?.established || "2024-01-01",
          frequency: match?.frequency || { ar: "ربع سنوي", en: "Quarterly" },
          quorum: { required: b.default_quorum || 3, total: b.total_members || 5 },
          membersCount: b.total_members || apiMembers.length,
          members: apiMembers.length ? apiMembers : (match?.members || BC_MEMBERS.slice(0, 3)),
          committees: b.committees || match?.committees || [],
          responsibilities: match?.responsibilities || [],
          upcomingMeetings: match?.upcomingMeetings || [],
          recentDocuments: match?.recentDocuments || [],
          recentResolutions: match?.recentResolutions || [],
          activity: match?.activity || [],
          _fromAPI: true,
        };
      });

      // Replace BC_DATA with API results (keep any BC_DATA entries not in API as supplemental)
      BC._apiData = mapped;
    } catch (e) {
      console.warn("[BC] API load failed, using mock data:", e.message);
      BC._apiData = null;
    }
  },

  get data() {
    return BC._apiData || BC_DATA;
  },
  _apiData: null,

  openDetail(id, tab) {
    this.view = "detail"; this.activeId = id; this.activeTab = tab || "overview";
    this.render();
  },

  backToList() { this.view = "list"; this.activeId = null; this.render(); },

  setTab(tab) { this.activeTab = tab; this.render(); },

  setFilter(k, v) { this[k] = v; this.render(); },
  resetFilters() { this.q = ""; this.type = ""; this.status = ""; this.render(); },

  closeModal() {
    const root = document.getElementById("bc-modal-root");
    if (root) root.innerHTML = "";
  },

  applyTemplate() {
    const val = $("bcf-template") && $("bcf-template").value;
    if (!val) return;
    if (val === "other") {
      $("bcf-name-ar").value = "";
      $("bcf-name-en").value = "";
      setTimeout(() => $("bcf-name-ar").focus(), 50);
      return;
    }
    const tpl = BC_TEMPLATES.find(t => t.val === val);
    if (!tpl) return;
    $("bcf-name-ar").value = tpl.nameAr;
    $("bcf-name-en").value = tpl.nameEn;
    const typeEl = $("bcf-type");
    if (tpl.type && typeEl && !typeEl.disabled) typeEl.value = tpl.type;
  },

  openFormModal(mode, id) {
    const editing = mode === "edit" && id;
    const b = editing ? bcById(id) : null;
    const root = bcEnsureModalRoot();
    const memberOpts = BC_MEMBERS.map(m => `<option value="${m.id}" ${b && b.chairperson && b.chairperson.id === m.id ? "selected" : ""}>${esc(bcT(m.nameAr, m.nameEn))}</option>`).join("");
    root.innerHTML = `
      <div class="modal-overlay open" id="bc-form-modal" onclick="if(event.target===this) BC.closeModal()">
        <div class="modal" style="max-width:560px">
          <div class="modal-title">${editing ? bcT("تعديل المجموعة", "Edit Group") + ": " + esc(bcT(b.nameAr, b.nameEn)) : bcT("إنشاء مجموعة جديدة", "Create New Group")}</div>
          <div class="fs">
            ${!editing ? `<div class="frow">
              <div class="fl">${bcT("قالب سريع", "Quick Template")}</div>
              <select class="fi" id="bcf-template" onchange="BC.applyTemplate()" style="color:var(--text)">
                ${BC_TEMPLATES.map(t => `<option value="${t.val}">${bcT(t.labelAr, t.labelEn)}</option>`).join("")}
              </select>
              <div style="font-size:11px;color:var(--text3);margin-top:4px">${bcT("اختر قالباً ليملأ الاسم والنوع تلقائياً — أو اختر «أخرى» لكتابة اسم مخصص", "Pick a template to auto-fill the name & type — or choose «Other» to enter a custom name")}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0 8px"><div style="flex:1;height:1px;background:var(--border2)"></div><span style="font-size:11px;color:var(--text3);white-space:nowrap">${bcT("أو أدخل الاسم يدوياً", "or enter name manually")}</span><div style="flex:1;height:1px;background:var(--border2)"></div></div>` : ""}
            <div class="fr2">
              <div class="frow">
                <div class="fl">${bcT("الاسم (عربي)", "Name (Arabic)")}</div>
                <input class="fi" id="bcf-name-ar" value="${b ? esc(b.nameAr) : ""}" placeholder="${bcT("لجنة المخاطر", "e.g. Risk Committee")}">
              </div>
              <div class="frow">
                <div class="fl">${bcT("الاسم (إنجليزي)", "Name (English)")}</div>
                <input class="fi" id="bcf-name-en" dir="ltr" style="text-align:left" value="${b ? esc(b.nameEn) : ""}" placeholder="e.g. Risk Committee">
              </div>
            </div>
            <div class="fr2">
              <div class="frow">
                <div class="fl">${bcT("النوع", "Type")}</div>
                <select class="fi" id="bcf-type" ${editing ? "disabled" : ""}>
                  <option value="board" ${b && b.type === "board" ? "selected" : ""}>${bcT("🏛️ مجلس", "🏛️ Board")}</option>
                  <option value="committee" ${b && b.type === "committee" ? "selected" : ""}>${bcT("🧩 لجنة", "🧩 Committee")}</option>
                  <option value="sub_committee" ${b && b.type === "sub_committee" ? "selected" : ""}>${bcT("📋 لجنة فرعية", "📋 Sub-Committee")}</option>
                  <option value="steering" ${b && b.type === "steering" ? "selected" : ""}>${bcT("🧭 لجنة توجيهية", "🧭 Steering Committee")}</option>
                  <option value="executive" ${b && b.type === "executive" ? "selected" : ""}>${bcT("⚡ لجنة تنفيذية", "⚡ Executive Committee")}</option>
                  <option value="advisory" ${b && b.type === "advisory" ? "selected" : ""}>${bcT("💡 لجنة استشارية", "💡 Advisory Panel")}</option>
                  <option value="technical" ${b && b.type === "technical" ? "selected" : ""}>${bcT("🔧 لجنة فنية", "🔧 Technical Committee")}</option>
                  <option value="team" ${b && b.type === "team" ? "selected" : ""}>${bcT("👥 فريق", "👥 Team")}</option>
                  <option value="working_group" ${b && b.type === "working_group" ? "selected" : ""}>${bcT("🛠️ مجموعة عمل", "🛠️ Working Group")}</option>
                  <option value="task_force" ${(!b || !b.type) ? "selected" : b.type === "task_force" ? "selected" : ""}>${bcT("🎯 فرقة مهام", "🎯 Task Force")}</option>
                </select>
              </div>
              <div class="frow">
                <div class="fl">${bcT("الحالة", "Status")}</div>
                <select class="fi" id="bcf-status">
                  <option value="active" ${!b || b.status === "active" ? "selected" : ""}>${bcT("نشط", "Active")}</option>
                  <option value="inactive" ${b && b.status === "inactive" ? "selected" : ""}>${bcT("غير نشط", "Inactive")}</option>
                  <option value="draft" ${b && b.status === "draft" ? "selected" : ""}>${bcT("مسودة", "Draft")}</option>
                </select>
              </div>
            </div>
            <div class="frow">
              <div class="fl">${bcT("الرئيس", "Chairperson")}</div>
              <select class="fi" id="bcf-chair">${memberOpts}</select>
            </div>
            <div class="fr2">
              <div class="frow">
                <div class="fl">${bcT("وتيرة الاجتماعات", "Meeting Frequency")}</div>
                <select class="fi" id="bcf-freq">
                  <option value="Monthly" ${b && b.frequency.en === "Monthly" ? "selected" : ""}>${bcT("شهري", "Monthly")}</option>
                  <option value="Quarterly" ${!b || b.frequency.en === "Quarterly" ? "selected" : ""}>${bcT("ربع سنوي", "Quarterly")}</option>
                  <option value="Semi-Annual" ${b && b.frequency.en === "Semi-Annual" ? "selected" : ""}>${bcT("نصف سنوي", "Semi-Annual")}</option>
                </select>
              </div>
              <div class="frow">
                <div class="fl">${bcT("الاجتماع القادم", "Next Meeting")}</div>
                <input class="fi" type="date" id="bcf-next" value="${b ? new Date(b.nextMeeting).toISOString().slice(0, 10) : ""}">
              </div>
            </div>
            <div class="frow">
              <div class="fl">${bcT("الوصف (عربي)", "Description (Arabic)")}</div>
              <textarea class="fi" id="bcf-desc-ar" rows="2">${b ? esc(b.descAr) : ""}</textarea>
            </div>
            <div class="frow">
              <div class="fl">${bcT("الوصف (إنجليزي)", "Description (English)")}</div>
              <textarea class="fi" id="bcf-desc-en" dir="ltr" style="text-align:left" rows="2">${b ? esc(b.descEn) : ""}</textarea>
            </div>
            <div class="fa">
              <button class="btn-gold" onclick="BC.saveForm(${editing ? `'${id}'` : "null"})">✓ ${bcT("حفظ", "Save")}</button>
              <button class="btn-ghost" onclick="BC.closeModal()">${bcT("إلغاء", "Cancel")}</button>
            </div>
          </div>
        </div>
      </div>`;
  },

  saveForm(id) {
    const nameAr = $("bcf-name-ar").value.trim();
    const nameEn = $("bcf-name-en").value.trim();
    if (!nameAr || !nameEn) {
      showToast(bcT("يرجى إدخال الاسم بالعربية والإنجليزية", "Please enter the name in Arabic and English"), "error");
      return;
    }
    const type = $("bcf-type").value;
    const status = $("bcf-status").value;
    const chair = BC_MEMBERS.find(m => m.id === $("bcf-chair").value) || BC_MEMBERS[0];
    const freq = $("bcf-freq").value;
    const nextRaw = $("bcf-next").value;
    const nextMeeting = nextRaw ? new Date(nextRaw + "T10:00:00").toISOString() : new Date().toISOString();
    const descAr = $("bcf-desc-ar").value.trim();
    const descEn = $("bcf-desc-en").value.trim();

    const existing = id ? bcById(id) : null;
    if (existing) {
      Object.assign(existing, {
        nameAr, nameEn, status, chairperson: chair,
        frequency: { ar: freq === "Monthly" ? "شهري" : freq === "Semi-Annual" ? "نصف سنوي" : "ربع سنوي", en: freq },
        nextMeeting,
        descAr: descAr || existing.descAr, descEn: descEn || existing.descEn,
      });
      showToast(bcT("تم حفظ التعديلات بنجاح", "Changes saved successfully"), "success");
      this.closeModal();
      this.openDetail(existing.id, this.activeTab);
      return;
    }

    const _grpMeta = {
      board:        { icon: "🏛️", ar: "مجلس",          en: "Board" },
      committee:    { icon: "🧩", ar: "لجنة دائمة",     en: "Standing Committee" },
      sub_committee:{ icon: "📋", ar: "لجنة فرعية",     en: "Sub-Committee" },
      steering:     { icon: "🧭", ar: "لجنة توجيهية",   en: "Steering Committee" },
      executive:    { icon: "⚡", ar: "لجنة تنفيذية",   en: "Executive Committee" },
      advisory:     { icon: "💡", ar: "لجنة استشارية",  en: "Advisory Panel" },
      technical:    { icon: "🔧", ar: "لجنة فنية",      en: "Technical Committee" },
      team:         { icon: "👥", ar: "فريق",            en: "Team" },
      working_group:{ icon: "🛠️", ar: "مجموعة عمل",    en: "Working Group" },
      task_force:   { icon: "🎯", ar: "فرقة مهام",      en: "Task Force" },
    };
    const _gm = _grpMeta[type] || _grpMeta.committee;
    const newItem = {
      id: bcNextId(type), type, icon: _gm.icon,
      nameAr, nameEn, subtitleAr: nameAr, subtitleEn: nameEn,
      descAr: descAr || "", descEn: descEn || "",
      status, committeeType: { ar: _gm.ar, en: _gm.en },
      chairperson: chair, secretariat: "Ameen Secretary Team",
      established: new Date().toISOString().slice(0, 10),
      frequency: { ar: freq === "Monthly" ? "شهري" : freq === "Semi-Annual" ? "نصف سنوي" : "ربع سنوي", en: freq },
      nextMeeting, location: { ar: "القاعة الرئيسية", en: "Main Boardroom" },
      membersCount: 1, meetingsCount: 0, documentsCount: 0, tasksCount: 0, resolutionsCount: 0,
      members: [chair],
      memberSummary: [{ label: { ar: "الرئيس", en: "Chairman" }, n: 1, color: "#5B9BD5" }],
      attendanceAvg: 0,
      purposeAr: descAr, purposeEn: descEn,
      responsibilities: [],
      upcomingMeetings: [{ title: { ar: nameAr, en: nameEn }, date: nextMeeting, location: { ar: "القاعة الرئيسية", en: "Main Boardroom" } }],
      recentDocuments: [], recentResolutions: [],
      activity: [{ icon: "🆕", title: { ar: "تم الإنشاء", en: "Created" }, sub: nameEn, time: { ar: "الآن", en: "Just now" } }],
    };
    if (BC._apiData) BC._apiData.unshift(newItem); else BC_DATA.unshift(newItem);
    showToast(bcT("تم إنشاء العنصر بنجاح", "Created successfully"), "success");
    this.closeModal();
    this.openDetail(newItem.id, "overview");
  },

  openQuickModal(kind, boardId) {
    const b = bcById(boardId);
    const root = bcEnsureModalRoot();
    const titles = {
      meeting: bcT("جدولة اجتماع", "Schedule Meeting"),
      task: bcT("إضافة مهمة", "Add Task"),
      document: bcT("رفع وثيقة", "Upload Document"),
      resolution: bcT("إنشاء قرار", "Create Resolution"),
      member: bcT("دعوة عضو", "Invite Member"),
    };
    let fields = "";
    if (kind === "meeting") {
      fields = `
        <div class="frow"><div class="fl">${bcT("عنوان الاجتماع", "Meeting Title")}</div><input class="fi" id="bcq-title" value="${b ? esc(bcT(b.nameAr, b.nameEn)) + " " + bcT("اجتماع", "Meeting") : ""}"></div>
        <div class="fr2">
          <div class="frow"><div class="fl">${bcT("التاريخ", "Date")}</div><input class="fi" type="date" id="bcq-date"></div>
          <div class="frow"><div class="fl">${bcT("الوقت", "Time")}</div><input class="fi" type="time" id="bcq-time" value="10:00"></div>
        </div>
        <div class="frow"><div class="fl">${bcT("الموقع", "Location")}</div><input class="fi" id="bcq-loc" value="${b ? bcT(b.location.ar, b.location.en) : ""}"></div>`;
    } else if (kind === "task") {
      fields = `<div class="frow"><div class="fl">${bcT("نص المهمة", "Task")}</div><input class="fi" id="bcq-title" placeholder="${bcT("مهمة متابعة جديدة...", "New follow-up task...")}"></div>
        <div class="frow"><div class="fl">${bcT("المسؤول", "Owner")}</div><select class="fi" id="bcq-owner">${(b ? b.members : BC_MEMBERS).map(m => `<option value="${m.id}">${esc(bcT(m.nameAr, m.nameEn))}</option>`).join("")}</select></div>`;
    } else if (kind === "document") {
      fields = `<div class="frow"><div class="fl">${bcT("اسم الملف", "File Name")}</div><input class="fi" id="bcq-title" placeholder="Board Charter.pdf"></div>
        <div class="frow"><div class="fl">${bcT("الحجم", "Size")}</div><input class="fi" id="bcq-size" placeholder="1.2 MB"></div>`;
    } else if (kind === "resolution") {
      fields = `<div class="frow"><div class="fl">${bcT("عنوان القرار (عربي)", "Resolution Title (Arabic)")}</div><input class="fi" id="bcq-title-ar"></div>
        <div class="frow"><div class="fl">${bcT("عنوان القرار (إنجليزي)", "Resolution Title (English)")}</div><input class="fi" id="bcq-title-en" dir="ltr" style="text-align:left"></div>`;
    } else if (kind === "member") {
      fields = `<div class="frow"><div class="fl">${bcT("الاسم", "Name")}</div><input class="fi" id="bcq-mname" placeholder="${bcT("اسم العضو", "Member name")}"></div>
        <div class="frow"><div class="fl">${bcT("البريد الإلكتروني", "Email")}</div><input class="fi" id="bcq-email" type="email" dir="ltr" style="text-align:left" placeholder="name@company.com"></div>
        <div class="frow"><div class="fl">${bcT("الدور", "Role")}</div><input class="fi" id="bcq-role" placeholder="${bcT("عضو مجلس", "Board Member")}"></div>
        <div class="frow"><div class="fl">${bcT("رسالة شخصية (اختياري)", "Personal message (optional)")}</div><textarea class="fi" id="bcq-msg" style="min-height:52px" placeholder="${bcT("أضف رسالة ترحيب...", "Add a welcome message...")}"></textarea></div>`;
    }
    root.innerHTML = `
      <div class="modal-overlay open" id="bc-quick-modal" onclick="if(event.target===this) BC.closeModal()">
        <div class="modal" style="max-width:480px">
          <div class="modal-title">${titles[kind]}${b ? " — " + esc(bcT(b.nameAr, b.nameEn)) : ""}</div>
          <div class="fs">
            ${fields}
            <div class="fa">
              <button class="btn-gold" onclick="BC.saveQuick('${kind}','${boardId || ""}')">✓ ${bcT("حفظ", "Save")}</button>
              <button class="btn-ghost" onclick="BC.closeModal()">${bcT("إلغاء", "Cancel")}</button>
            </div>
          </div>
        </div>
      </div>`;
  },

  saveQuick(kind, boardId) {
    const b = bcById(boardId) || BC_DATA[0];
    if (kind === "meeting") {
      const title = $("bcq-title").value.trim();
      const date = $("bcq-date").value;
      const time = $("bcq-time").value || "10:00";
      const loc = $("bcq-loc").value.trim();
      if (!title || !date) { showToast(bcT("يرجى تعبئة العنوان والتاريخ", "Please fill in the title and date"), "error"); return; }
      const iso = new Date(date + "T" + time + ":00").toISOString();
      b.upcomingMeetings.unshift({ title: { ar: title, en: title }, date: iso, location: { ar: loc, en: loc } });
      b.meetingsCount++;
      if (new Date(iso) < new Date(b.nextMeeting) || !b.nextMeeting) b.nextMeeting = iso;
      b.activity.unshift({ icon: "📅", title: { ar: "تمت جدولة اجتماع", en: "Meeting scheduled" }, sub: title, time: { ar: "الآن", en: "Just now" } });
    } else if (kind === "task") {
      const title = $("bcq-title").value.trim();
      if (!title) { showToast(bcT("يرجى إدخال نص المهمة", "Please enter a task"), "error"); return; }
      b.tasksCount++;
      b.activity.unshift({ icon: "✅", title: { ar: "تمت إضافة مهمة", en: "Task added" }, sub: title, time: { ar: "الآن", en: "Just now" } });
    } else if (kind === "document") {
      const name = $("bcq-title").value.trim();
      const size = $("bcq-size").value.trim() || "—";
      if (!name) { showToast(bcT("يرجى إدخال اسم الملف", "Please enter a file name"), "error"); return; }
      b.recentDocuments.unshift({ name, size });
      b.documentsCount++;
      b.activity.unshift({ icon: "📄", title: { ar: "رفع وثيقة", en: "Document uploaded" }, sub: name, time: { ar: "الآن", en: "Just now" } });
    } else if (kind === "resolution") {
      const titleAr = $("bcq-title-ar").value.trim();
      const titleEn = $("bcq-title-en").value.trim();
      if (!titleAr && !titleEn) { showToast(bcT("يرجى إدخال عنوان القرار", "Please enter a resolution title"), "error"); return; }
      const code = `RES-${new Date().getFullYear()}-${String(b.resolutionsCount + 1).padStart(3, "0")}`;
      b.recentResolutions.unshift({ code, title: { ar: titleAr || titleEn, en: titleEn || titleAr }, status: "pending" });
      b.resolutionsCount++;
      b.activity.unshift({ icon: "📝", title: { ar: "تم إنشاء قرار", en: "Resolution created" }, sub: code, time: { ar: "الآن", en: "Just now" } });
    } else if (kind === "member") {
      const name = ($("bcq-mname") && $("bcq-mname").value.trim()) || "";
      const email = ($("bcq-email") && $("bcq-email").value.trim()) || "";
      const role = ($("bcq-role") && $("bcq-role").value.trim()) || "Board Member";
      const msg = ($("bcq-msg") && $("bcq-msg").value.trim()) || "";
      if (!email) { showToast(bcT("يرجى إدخال البريد الإلكتروني", "Please enter an email address"), "error"); return; }
      this.closeModal();
      // Send invitation email via API
      const apiId = b._apiId || boardId;
      fetch(`/api/gov/boards/${apiId}/invite`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, message: msg }),
      }).then(r => r.json()).then(res => {
        if (res.success) showToast(bcT(`تم إرسال دعوة إلى ${email}`, `Invitation sent to ${email}`), "success");
        else showToast(res.error || bcT("تعذّر إرسال الدعوة", "Could not send invitation"), "error");
      }).catch(e => showToast(e.message, "error"));
      b.activity.unshift({ icon: "✉️", title: { ar: "تم إرسال دعوة", en: "Invitation sent" }, sub: email, time: { ar: "الآن", en: "Just now" } });
      if (this.view === "detail" && this.activeId === b.id) this.render();
      return;
    }
    showToast(bcT("تم الحفظ بنجاح", "Saved successfully"), "success");
    this.closeModal();
    if (this.view === "detail" && this.activeId === b.id) this.render();
    else this.openDetail(b.id, "overview");
  },

  render() {
    if (this.view === "detail" && this.activeId) this.renderDetail();
    else this.renderList();
  },

  filteredData() {
    return BC.data.filter(b => {
      if (this.type && b.type !== this.type) return false;
      if (this.status && b.status !== this.status) return false;
      if (this.q) {
        const q = this.q.toLowerCase();
        if (!(b.nameAr.includes(this.q) || b.nameEn.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  },

  statusBadge(status) {
    const map = {
      active: { ar: "نشط", en: "Active", cls: "bc-badge-green" },
      inactive: { ar: "غير نشط", en: "Inactive", cls: "bc-badge-gray" },
      draft: { ar: "مسودة", en: "Draft", cls: "bc-badge-amber" },
    };
    const s = map[status] || map.active;
    return `<span class="bc-badge ${s.cls}">${bcT(s.ar, s.en)}</span>`;
  },

  avatarsStack(members) {
    const shown = members.slice(0, 3);
    const rest = members.length - shown.length;
    return `<div class="bc-av-stack">
      ${shown.map(m => `<span class="bc-av-sm" style="background:${bcColor(m.id)}" title="${esc(bcT(m.nameAr, m.nameEn))}">${bcInit(bcT(m.nameAr, m.nameEn))}</span>`).join("")}
      ${rest > 0 ? `<span class="bc-av-sm bc-av-more">+${rest}</span>` : ""}
    </div>`;
  },

  renderList() {
    const body = $("boards-body");
    const data = this.filteredData();
    const allData = BC.data;
    const totalBoards = allData.filter(b => b.type === "board").length;
    const totalCommittees = allData.filter(b => b.type === "committee").length;
    const upcomingCount = allData.length + 4;
    const activeResolutions = allData.reduce((s, b) => s + (b.resolutionsCount || 0), 0);

    const rows = data.map(b => `
      <tr class="bc-tr" onclick="BC.openDetail('${b.id}')">
        <td class="bc-td">
          <div class="bc-name-cell">
            <span class="bc-row-icon">${b.icon}</span>
            <div>
              <div class="bc-row-name">${esc(bcT(b.nameAr, b.nameEn))}</div>
              <div class="bc-row-sub">${esc(bcT(b.nameAr === b.nameAr ? (b.type === "board" ? "مجلس الإدارة" : b.nameAr) : "", ""))}</div>
            </div>
          </div>
        </td>
        <td class="bc-td"><span class="bc-badge ${b.type === "board" ? "bc-badge-green" : "bc-badge-blue"}">${bcT(b.type === "board" ? "مجلس" : "لجنة", b.type === "board" ? "Board" : "Committee")}</span></td>
        <td class="bc-td">
          <div class="bc-owner-wrap">
            <span class="bc-av-sm" style="background:${bcColor(b.chairperson.id)}">${bcInit(bcT(b.chairperson.nameAr, b.chairperson.nameEn))}</span>
            <div><div class="bc-owner-n">${esc(bcT(b.chairperson.nameAr, b.chairperson.nameEn))}</div><div class="bc-owner-r">${bcT("الرئيس", "Chairman")}</div></div>
          </div>
        </td>
        <td class="bc-td bc-td-date">${bcDate(b.nextMeeting, true)}</td>
        <td class="bc-td">${this.avatarsStack(b.members)}</td>
        <td class="bc-td">${this.statusBadge(b.status)}</td>
        <td class="bc-td bc-td-actions" onclick="event.stopPropagation()">
          <div class="bc-rm-wrap">
            <button class="bc-rm-btn" onclick="BC.toggleMenu('${b.id}', this)">⋮</button>
            <div class="bc-rm-drop" id="bc-rm-${b.id}">
              <button onclick="BC.openDetail('${b.id}')">${bcT("عرض التفاصيل", "View Details")}</button>
              <button onclick="BC.openFormModal('edit','${b.id}')">${bcT("تعديل", "Edit")}</button>
            </div>
          </div>
        </td>
      </tr>`).join("");

    body.innerHTML = `
      <div class="ph">
        <div class="ph-row">
          <div>
            <div class="ptitle">${bcT("المجالس واللجان", "Boards & Committees")}</div>
            <div class="ptitle-sub">${bcT("إدارة المجالس واللجان والأعضاء والاجتماعات وهيكل الحوكمة", "Manage boards, committees, members, meetings, and governance structure.")}</div>
          </div>
          <button class="btn-gold" onclick="BC.openFormModal('create')">+ ${bcT("إنشاء مجموعة", "Create Group")}</button>
        </div>
      </div>
      <div class="pbody">
        <div class="bc-layout">
          <div class="bc-main">
            <div class="bc-kpi-row">
              <div class="bc-kpi"><div class="bc-kpi-top"><span class="bc-kpi-ico">👥</span></div><div class="bc-kpi-val">${totalBoards}</div><div class="bc-kpi-label">${bcT("إجمالي المجالس", "Total Boards")}</div><a class="bc-kpi-link" onclick="BC.setFilter('type','board')">${bcT("عرض كل المجالس", "View all boards")} →</a></div>
              <div class="bc-kpi"><div class="bc-kpi-top"><span class="bc-kpi-ico">🧑‍🤝‍🧑</span></div><div class="bc-kpi-val">${totalCommittees}</div><div class="bc-kpi-label">${bcT("إجمالي اللجان", "Total Committees")}</div><a class="bc-kpi-link" onclick="BC.setFilter('type','committee')">${bcT("عرض كل اللجان", "View all committees")} →</a></div>
              <div class="bc-kpi"><div class="bc-kpi-top"><span class="bc-kpi-ico">📅</span></div><div class="bc-kpi-val">${upcomingCount}</div><div class="bc-kpi-label">${bcT("اجتماعات قادمة", "Upcoming Meetings")}</div><a class="bc-kpi-link" onclick="Panels.load('scheduled')">${bcT("عرض التقويم", "View calendar")} →</a></div>
              <div class="bc-kpi"><div class="bc-kpi-top"><span class="bc-kpi-ico">📋</span></div><div class="bc-kpi-val">${activeResolutions}</div><div class="bc-kpi-label">${bcT("قرارات نشطة", "Active Resolutions")}</div><a class="bc-kpi-link" onclick="Panels.load('resolutions')">${bcT("عرض القرارات", "View resolutions")} →</a></div>
            </div>

            <div class="bc-card">
              <div class="bc-tabs">
                <button class="bc-tab ${!this.type ? "active" : ""}" onclick="BC.setFilter('type','')">${bcT("الكل", "All")}</button>
                <button class="bc-tab ${this.type === "board" ? "active" : ""}" onclick="BC.setFilter('type','board')">${bcT("مجالس", "Boards")}</button>
                <button class="bc-tab ${this.type === "committee" ? "active" : ""}" onclick="BC.setFilter('type','committee')">${bcT("لجان", "Committees")}</button>
              </div>
              <div class="bc-filters">
                <div class="bc-search-wrap">
                  <span class="bc-search-ico">🔍</span>
                  <input class="bc-search-inp" placeholder="${bcT("ابحث في المجالس أو اللجان...", "Search boards or committees...")}" value="${esc(this.q)}" oninput="BC.onSearch(this.value)">
                </div>
                <select class="bc-fil-sel" onchange="BC.setFilter('type', this.value)">
                  <option value="">${bcT("النوع: الكل", "Type: All")}</option>
                  <option value="board" ${this.type === "board" ? "selected" : ""}>${bcT("مجلس", "Board")}</option>
                  <option value="committee" ${this.type === "committee" ? "selected" : ""}>${bcT("لجنة", "Committee")}</option>
                </select>
                <select class="bc-fil-sel" onchange="BC.setFilter('status', this.value)">
                  <option value="">${bcT("الحالة: الكل", "Status: All")}</option>
                  <option value="active" ${this.status === "active" ? "selected" : ""}>${bcT("نشط", "Active")}</option>
                  <option value="inactive" ${this.status === "inactive" ? "selected" : ""}>${bcT("غير نشط", "Inactive")}</option>
                </select>
              </div>
              <div class="bc-tbl-wrap">
                <table class="bc-tbl">
                  <thead><tr>
                    <th class="bc-th">${bcT("الاسم", "Name")}</th>
                    <th class="bc-th">${bcT("النوع", "Type")}</th>
                    <th class="bc-th">${bcT("الرئيس", "Chairperson")}</th>
                    <th class="bc-th">${bcT("الاجتماع القادم", "Next Meeting")}</th>
                    <th class="bc-th">${bcT("الأعضاء", "Members")}</th>
                    <th class="bc-th">${bcT("الحالة", "Status")}</th>
                    <th class="bc-th"></th>
                  </tr></thead>
                  <tbody>${rows || `<tr><td colspan="7" class="bc-empty">${bcT("لا توجد نتائج", "No results found")}</td></tr>`}</tbody>
                </table>
              </div>
              <div class="bc-tbl-foot">
                <span class="bc-count">${bcT(`عرض 1 إلى ${data.length} من ${BC.data.length} عنصر`, `Showing 1 to ${data.length} of ${BC.data.length} items`)}</span>
              </div>
            </div>
          </div>

          <div class="bc-sidebar">
            <div class="bc-side-card">
              <div class="bc-side-title">${bcT("إجراءات سريعة", "Quick Actions")}</div>
              <button class="bc-qa-btn" onclick="BC.openFormModal('create')">➕ ${bcT("إنشاء مجموعة", "Create Group")}</button>
              <button class="bc-qa-btn" onclick="BC.data[0]&&BC.openQuickModal('member', BC.data[0].id)">✉️ ${bcT("دعوة عضو", "Invite Member")}</button>
              <button class="bc-qa-btn" onclick="BC.setFilter('type','')">🗂️ ${bcT("عرض هيكل الحوكمة", "View Governance Structure")}</button>
              <button class="bc-qa-btn" onclick="BC.data[0]&&BC.openDetail(BC.data[0].id, 'members')">👥 ${bcT("إدارة الأعضاء", "Manage Members")}</button>
            </div>
            <div class="bc-side-card">
              <div class="bc-side-title-row"><span class="bc-side-title">${bcT("الاجتماعات القادمة", "Upcoming Meetings")}</span><a class="bc-side-link" onclick="Panels.load('scheduled')">${bcT("عرض التقويم", "View Calendar")} →</a></div>
              ${BC.data.slice(0, 3).map(b => {
                const nm = b.nextMeeting || new Date(Date.now() + 7*24*3600*1000).toISOString().split("T")[0];
                const d = new Date(nm);
                const loc = b.location ? bcT(b.location.ar, b.location.en) : (App.lang === "ar" ? "القاعة الرئيسية" : "Main Boardroom");
                return `<div class="bc-dead-row">
                  <div class="bc-dead-date"><div class="bc-dead-day">${d.getDate()}</div><div class="bc-dead-mon">${d.toLocaleDateString(App.lang === "ar" ? "ar-SA" : "en-GB", { month: "short" })}</div></div>
                  <div class="bc-dead-info"><div class="bc-dead-t">${esc(bcT(b.nameAr, b.nameEn))} ${bcT("اجتماع", "Meeting")}</div><div class="bc-dead-s">${bcDate(nm, true)} · ${esc(loc)}</div></div>
                </div>`;
              }).join("")}
            </div>
            <div class="bc-side-card">
              <div class="bc-side-title-row"><span class="bc-side-title">${bcT("نظرة عامة على الحوكمة", "Governance Overview")}</span><a class="bc-side-link" onclick="Panels.load('resolutions')">${bcT("عرض التقرير", "View Report")} →</a></div>
              <div class="bc-donut-wrap">
                <div class="bc-donut" style="background:conic-gradient(#4CAF7D 0% 75%, #E08A3C 75% 92%, #C0785A 92% 100%)"><div class="bc-donut-hole"><div class="bc-donut-n">24</div><div class="bc-donut-l">${bcT("الإجمالي", "Total")}</div></div></div>
                <div class="bc-donut-legend">
                  <div class="bc-legend-row"><span class="bc-legend-dot" style="background:#4CAF7D"></span><span class="bc-legend-lbl">${bcT("نشط", "Active")}</span><span class="bc-legend-cnt">18 (75%)</span></div>
                  <div class="bc-legend-row"><span class="bc-legend-dot" style="background:#E08A3C"></span><span class="bc-legend-lbl">${bcT("غير نشط", "Inactive")}</span><span class="bc-legend-cnt">4 (17%)</span></div>
                  <div class="bc-legend-row"><span class="bc-legend-dot" style="background:#C0785A"></span><span class="bc-legend-lbl">${bcT("مسودة", "Draft")}</span><span class="bc-legend-cnt">2 (8%)</span></div>
                </div>
              </div>
            </div>
            <div class="bc-side-card">
              <div class="bc-side-title-row"><span class="bc-side-title">${bcT("آخر التحديثات", "Recent Updates")}</span><a class="bc-side-link" onclick="BC.data[0]&&BC.openDetail(BC.data[0].id,'activity')">${bcT("عرض الكل", "View All")} →</a></div>
              ${[...(BC.data[1]?.activity||[]),...(BC.data[0]?.activity||[])].slice(0, 3).map(a => `
                <div class="bc-done-row"><div class="bc-done-ico">${a.icon}</div><div class="bc-done-info"><div class="bc-done-t">${esc(bcT(a.title.ar, a.title.en))}</div><div class="bc-done-s">${esc(a.sub)} · ${bcT(a.time.ar, a.time.en)}</div></div></div>
              `).join("")}
            </div>
          </div>
        </div>
      </div>`;
  },

  closeMenus() { document.querySelectorAll(".bc-rm-drop.open").forEach(m => m.classList.remove("open")); },
  toggleMenu(id, btn) {
    this.closeMenus();
    const m = document.getElementById(`bc-rm-${id}`);
    if (!m) return;
    m.classList.add("open");
    const close = (e) => { if (!btn.contains(e.target) && !m.contains(e.target)) { m.classList.remove("open"); document.removeEventListener("click", close, true); } };
    setTimeout(() => document.addEventListener("click", close, true), 0);
  },

  renderDetail() {
    const b = bcById(this.activeId);
    const body = $("boards-body");
    if (!b) { this.backToList(); return; }
    const isBoard = b.type === "board";
    const crumbLabel = isBoard ? bcT("مجلس الإدارة", "Board of Directors") : esc(bcT(b.nameAr, b.nameEn));

    const tabs = [
      { k: "overview", ar: "نظرة عامة", en: "Overview" },
      { k: "members", ar: "الأعضاء", en: "Members", n: b.membersCount },
      { k: "meetings", ar: "الاجتماعات", en: "Meetings", n: b.meetingsCount },
      { k: "tasks", ar: "المهام", en: "Tasks", n: b.tasksCount },
      { k: "documents", ar: "الوثائق", en: "Documents", n: b.documentsCount },
      { k: "resolutions", ar: "القرارات", en: "Resolutions", n: b.resolutionsCount },
      ...(b.type === "board" ? [{ k: "committees", ar: "اللجان", en: "Committees" }] : []),
      { k: "activity", ar: "النشاط", en: "Activity" },
    ];

    body.innerHTML = `
      <div class="bc-detail">
        <div class="bc-breadcrumb">
          <a onclick="BC.backToList()">${bcT("المجالس واللجان", "Boards & Committees")}</a>
          <span>›</span>
          ${!isBoard ? `<a onclick="BC.backToList()">${bcT("مجلس الإدارة", "Board of Directors")}</a><span>›</span><span class="bc-crumb-cur">${bcT("تفاصيل اللجنة", "Committee Details")}</span>` : `<span class="bc-crumb-cur">${crumbLabel}</span>`}
        </div>
        <div class="bc-detail-head">
          <div class="bc-detail-head-l">
            <div class="bc-detail-icon">${b.icon}</div>
            <div>
              <div class="bc-detail-title">${esc(bcT(b.nameAr, b.nameEn))} ${this.statusBadge(b.status)}</div>
              <div class="bc-detail-sub">${esc(bcT(b.subtitleAr || b.nameAr, b.subtitleEn || b.nameEn))}</div>
              <div class="bc-detail-desc">${esc(bcT(b.descAr, b.descEn))}</div>
            </div>
          </div>
          <div class="bc-detail-head-r">
            <button class="btn-ghost btn-sm" onclick="showToast(bcT('تم نسخ رابط المشاركة','Share link copied'),'success')">🔗 ${bcT("مشاركة", "Share")}</button>
            <button class="btn-ghost btn-sm" onclick="showToast(bcT('جارِ التصدير...','Exporting...'),'info')">⬇️ ${bcT("تصدير", "Export")}</button>
            <button class="btn-gold btn-sm" onclick="BC.openFormModal('edit', '${b.id}')">✎ ${bcT(isBoard ? "تعديل المجلس" : "تعديل اللجنة", isBoard ? "Edit Board" : "Edit Committee")}</button>
          </div>
        </div>

        <div class="bc-tabs bc-tabs-detail">
          ${tabs.map(t => `<button class="bc-tab ${this.activeTab === t.k ? "active" : ""}" onclick="BC.setTab('${t.k}')">${bcT(t.ar, t.en)}${t.n !== undefined ? ` <span class="bc-tab-n">${t.n}</span>` : ""}</button>`).join("")}
        </div>

        <div class="bc-detail-body">
          ${this.tabContent(b)}
        </div>
      </div>`;
  },

  tabContent(b) {
    switch (this.activeTab) {
      case "members": return this.membersTab(b, true);
      case "meetings": return this.meetingsTab(b);
      case "tasks": return this.tasksTab(b);
      case "documents": return this.documentsTab(b);
      case "resolutions": return this.resolutionsTab(b);
      case "committees": return this.committeesTab(b);
      case "activity": return this.activityTab(b);
      default: return this.overviewTab(b);
    }
  },

  overviewTab(b) {
    const total = b.memberSummary.reduce((s, m) => s + m.n, 0);
    let acc = 0;
    const gradient = b.memberSummary.map(m => {
      const start = acc; acc += (m.n / total) * 100;
      return `${m.color} ${start.toFixed(1)}% ${acc.toFixed(1)}%`;
    }).join(", ");

    return `
      <div class="bc-ov-grid">
        <div class="bc-ov-main">
          <div class="bc-card bc-pad">
            <div class="bc-side-title">${bcT(b.type === "board" ? "معلومات المجلس" : "معلومات اللجنة", b.type === "board" ? "Board Information" : "Committee Information")}</div>
            <div class="bc-info-grid">
              <div class="bc-info-row"><span class="bc-info-l">${bcT("النوع", b.type === "board" ? "Board Type" : "Committee Type")}</span><span class="bc-info-v">${typeof b.committeeType === "string" ? bcT(b.type === "board" ? "مجلس" : "لجنة", b.committeeType) : bcT(b.committeeType.ar, b.committeeType.en)}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("الرئيس", "Chairperson")}</span><span class="bc-info-v bc-info-person"><span class="bc-av-sm" style="background:${bcColor(b.chairperson.id)}">${bcInit(bcT(b.chairperson.nameAr, b.chairperson.nameEn))}</span> ${esc(bcT(b.chairperson.nameAr, b.chairperson.nameEn))}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("الأمانة", "Secretariat")}</span><span class="bc-info-v">${esc(b.secretariat)}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("تأسست", "Established")}</span><span class="bc-info-v">${bcDate(b.established)}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("وتيرة الاجتماعات", "Meeting Frequency")}</span><span class="bc-info-v">${bcT(b.frequency.ar, b.frequency.en)}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("الاجتماع القادم", "Next Meeting")}</span><span class="bc-info-v">📅 ${bcDate(b.nextMeeting, true)}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("الموقع", "Location")}</span><span class="bc-info-v">${bcT(b.location.ar, b.location.en)}</span></div>
              <div class="bc-info-row"><span class="bc-info-l">${bcT("الحالة", "Status")}</span><span class="bc-info-v">${this.statusBadge(b.status)}</span></div>
            </div>
          </div>

          <div class="bc-card bc-pad">
            <div class="bc-side-title-row"><span class="bc-side-title">${bcT("الأعضاء", "Members")} (${b.membersCount})</span><button class="btn-ghost btn-sm" onclick="BC.openQuickModal('member', '${b.id}')">👥 ${bcT("إدارة الأعضاء", "Manage Members")}</button></div>
            ${this.membersTable(b.members.slice(0, 5))}
            <a class="bc-side-link" style="display:inline-block;margin-top:10px" onclick="BC.setTab('members')">${bcT("عرض كل الأعضاء", "View All Members")} →</a>
          </div>
        </div>

        <div class="bc-ov-mid">
          <div class="bc-card bc-pad">
            <div class="bc-side-title">${bcT("الغرض", "Purpose")}</div>
            <div class="bc-purpose">✅ ${esc(bcT(b.purposeAr || b.descAr, b.purposeEn || b.descEn))}</div>
            <div class="bc-side-title" style="margin-top:16px">${bcT("المسؤوليات الرئيسية", "Key Responsibilities")}</div>
            <ul class="bc-resp-list">${b.responsibilities.map(r => `<li>✅ ${esc(bcT(r.ar, r.en))}</li>`).join("")}</ul>
          </div>
        </div>

        <div class="bc-ov-side">
          <div class="bc-card bc-pad">
            <div class="bc-side-title-row"><span class="bc-side-title">${bcT("ملخص الاجتماعات", "Meetings Summary")}</span><a class="bc-side-link" onclick="BC.setTab('meetings')">${bcT("عرض الكل", "View All")}</a></div>
            <div class="bc-donut-wrap">
              <div class="bc-donut" style="background:conic-gradient(${gradient})"><div class="bc-donut-hole"><div class="bc-donut-n">${total}</div><div class="bc-donut-l">${bcT("الإجمالي", "Total")}</div></div></div>
              <div class="bc-donut-legend">
                ${b.memberSummary.map(m => `<div class="bc-legend-row"><span class="bc-legend-dot" style="background:${m.color}"></span><span class="bc-legend-lbl">${bcT(m.label.ar, m.label.en)}</span><span class="bc-legend-cnt">${m.n}</span></div>`).join("")}
              </div>
            </div>
            <div class="bc-side-title" style="margin-top:14px">${bcT("الاجتماع القادم", "Next Meeting")}</div>
            <div class="bc-dead-row" style="border:none;padding-top:4px">
              <div class="bc-dead-date"><div class="bc-dead-day">${new Date(b.nextMeeting).getDate()}</div><div class="bc-dead-mon">${new Date(b.nextMeeting).toLocaleDateString(App.lang === "ar" ? "ar-SA" : "en-GB", { month: "short" })}</div></div>
              <div class="bc-dead-info"><div class="bc-dead-t">${bcDate(b.nextMeeting, true)}</div><div class="bc-dead-s">${bcT(b.location.ar, b.location.en)}</div></div>
              <button class="btn-ghost btn-sm" onclick="Panels.load('scheduled')">${bcT("عرض الأجندة", "View Agenda")}</button>
            </div>
          </div>

          <div class="bc-side-card">
            <div class="bc-side-title">${bcT("إجراءات سريعة", "Quick Actions")}</div>
            <button class="bc-qa-btn" onclick="BC.openQuickModal('meeting', '${b.id}')">📅 ${bcT("جدولة اجتماع", "Schedule Meeting")}</button>
            <button class="bc-qa-btn" onclick="BC.openQuickModal('task', '${b.id}')">✅ ${bcT("إضافة مهمة", "Add Task")}</button>
            <button class="bc-qa-btn" onclick="BC.openQuickModal('document', '${b.id}')">📤 ${bcT("رفع وثيقة", "Upload Document")}</button>
            <button class="bc-qa-btn" onclick="BC.openQuickModal('resolution', '${b.id}')">📝 ${bcT("إنشاء قرار", "Create Resolution")}</button>
            <button class="bc-qa-btn" onclick="BC.openQuickModal('member', '${b.id}')">✉️ ${bcT("دعوة عضو", "Invite Member")}</button>
          </div>

          <div class="bc-side-card">
            <div class="bc-side-title-row"><span class="bc-side-title">${bcT("الاجتماعات القادمة", "Upcoming Meetings")}</span><a class="bc-side-link" onclick="Panels.load('scheduled')">${bcT("عرض التقويم", "View Calendar")}</a></div>
            ${b.upcomingMeetings.map(m => `
              <div class="bc-dead-row"><div class="bc-dead-date"><div class="bc-dead-day">${new Date(m.date).getDate()}</div><div class="bc-dead-mon">${new Date(m.date).toLocaleDateString(App.lang === "ar" ? "ar-SA" : "en-GB", { month: "short" })}</div></div>
              <div class="bc-dead-info"><div class="bc-dead-t">${esc(bcT(m.title.ar, m.title.en))}</div><div class="bc-dead-s">${bcDate(m.date, true)} · ${bcT(m.location.ar, m.location.en)}</div></div></div>`).join("")}
          </div>

          <div class="bc-side-card">
            <div class="bc-side-title-row"><span class="bc-side-title">${bcT("الوثائق الأخيرة", "Recent Documents")}</span><a class="bc-side-link" onclick="BC.setTab('documents')">${bcT("عرض الكل", "View All")}</a></div>
            ${b.recentDocuments.map(d => `<div class="bc-doc-row"><span class="bc-doc-ico">📄</span><span class="bc-doc-n">${esc(d.name)}</span><span class="bc-doc-sz">${d.size}</span></div>`).join("")}
          </div>

          <div class="bc-side-card">
            <div class="bc-side-title-row"><span class="bc-side-title">${bcT("القرارات الأخيرة", "Recent Resolutions")}</span><a class="bc-side-link" onclick="BC.setTab('resolutions')">${bcT("عرض الكل", "View All")}</a></div>
            ${b.recentResolutions.map(r => `<div class="bc-res-row"><div class="bc-res-code">${r.code}</div><div class="bc-res-t">${esc(bcT(r.title.ar, r.title.en))}</div><span class="bc-badge bc-badge-green" style="margin-top:3px">${bcT("معتمد", "Approved")}</span></div>`).join("")}
          </div>
        </div>
      </div>`;
  },

  membersTable(members) {
    return `<div class="bc-tbl-wrap"><table class="bc-tbl">
      <thead><tr>
        <th class="bc-th">${bcT("العضو", "Member")}</th>
        <th class="bc-th">${bcT("الدور", "Role")}</th>
        <th class="bc-th">${bcT("النوع", "Type")}</th>
        <th class="bc-th">${bcT("منذ", "Since")}</th>
        <th class="bc-th">${bcT("الحضور (هذا العام)", "Attendance (This Year)")}</th>
        <th class="bc-th"></th>
      </tr></thead>
      <tbody>${members.map(m => `
        <tr class="bc-tr">
          <td class="bc-td"><div class="bc-owner-wrap"><span class="bc-av-sm" style="background:${bcColor(m.id)}">${bcInit(bcT(m.nameAr, m.nameEn))}</span><div><div class="bc-owner-n">${esc(bcT(m.nameAr, m.nameEn))}</div><div class="bc-owner-r">${bcT(m.roleAr, m.roleEn)}</div></div></div></td>
          <td class="bc-td"><span class="bc-badge ${m.roleEn === "Chairman" ? "bc-badge-blue" : "bc-badge-gray"}">${bcT(m.roleAr, m.roleEn)}</span></td>
          <td class="bc-td"><span class="bc-pri ${m.typeEn === "Independent" ? "bc-pri-amber" : "bc-pri-blue"}">${bcT(m.typeAr, m.typeEn)}</span></td>
          <td class="bc-td bc-td-date">${bcDate(m.since)}</td>
          <td class="bc-td"><div class="bc-attend-wrap"><span>${m.attendance}%</span><div class="bc-attend-bar"><div class="bc-attend-fill" style="width:${m.attendance}%"></div></div></div></td>
          <td class="bc-td bc-td-actions"><button class="bc-rm-btn" onclick="showToast(bcT('خيارات العضو قريباً','Member options coming soon'),'info')">⋮</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
  },

  membersTab(b) {
    return `<div class="bc-card bc-pad">
      <div class="bc-side-title-row"><span class="bc-side-title">${bcT("الأعضاء", "Members")} (${b.membersCount})</span><button class="btn-gold btn-sm" onclick="BC.openQuickModal('member', '${b.id}')">👥 ${bcT("إدارة الأعضاء", "Manage Members")}</button></div>
      ${this.membersTable(b.members)}
    </div>`;
  },

  meetingsTab(b) {
    const all = b.upcomingMeetings.concat(b.upcomingMeetings.map(m => ({ ...m, date: new Date(new Date(m.date).getTime() - 60 * 86400000).toISOString(), past: true })));
    return `<div class="bc-card bc-pad">
      <div class="bc-side-title">${bcT("الاجتماعات", "Meetings")} (${b.meetingsCount})</div>
      <div class="bc-dead-list">
        ${all.map(m => `<div class="bc-dead-row"><div class="bc-dead-date"><div class="bc-dead-day">${new Date(m.date).getDate()}</div><div class="bc-dead-mon">${new Date(m.date).toLocaleDateString(App.lang === "ar" ? "ar-SA" : "en-GB", { month: "short" })}</div></div>
          <div class="bc-dead-info"><div class="bc-dead-t">${esc(bcT(m.title.ar, m.title.en))}</div><div class="bc-dead-s">${bcDate(m.date, true)} · ${bcT(m.location.ar, m.location.en)}</div></div>
          <span class="bc-badge ${m.past ? "bc-badge-gray" : "bc-badge-blue"}">${bcT(m.past ? "منعقد" : "قادم", m.past ? "Completed" : "Upcoming")}</span></div>`).join("")}
      </div>
    </div>`;
  },

  tasksTab(b) {
    const items = Array.from({ length: Math.min(b.tasksCount, 6) }).map((_, i) => ({
      title: `${bcT("مهمة متابعة", "Follow-up task")} #${i + 1} — ${esc(bcT(b.nameAr, b.nameEn))}`,
      status: i % 3 === 0 ? "done" : i % 3 === 1 ? "progress" : "pending",
    }));
    const stMap = { done: ["مكتملة", "Completed", "bc-badge-green"], progress: ["قيد التنفيذ", "In Progress", "bc-badge-blue"], pending: ["لم تبدأ", "Not Started", "bc-badge-gray"] };
    return `<div class="bc-card bc-pad">
      <div class="bc-side-title-row"><span class="bc-side-title">${bcT("المهام", "Tasks")} (${b.tasksCount})</span><a class="bc-side-link" onclick="Panels.load('tasks')">${bcT("عرض في المهام", "Open in Tasks")}</a></div>
      ${items.map(t => `<div class="bc-done-row"><div class="bc-done-ico">📋</div><div class="bc-done-info"><div class="bc-done-t">${t.title}</div></div><span class="bc-badge ${stMap[t.status][2]}">${bcT(stMap[t.status][0], stMap[t.status][1])}</span></div>`).join("")}
    </div>`;
  },

  documentsTab(b) {
    return `<div class="bc-card bc-pad">
      <div class="bc-side-title">${bcT("الوثائق", "Documents")} (${b.documentsCount})</div>
      ${b.recentDocuments.map(d => `<div class="bc-doc-row"><span class="bc-doc-ico">📄</span><span class="bc-doc-n">${esc(d.name)}</span><span class="bc-doc-sz">${d.size}</span></div>`).join("")}
      <a class="bc-side-link" style="display:inline-block;margin-top:10px" onclick="Panels.load('documents')">${bcT("عرض جميع الوثائق", "View all documents")} →</a>
    </div>`;
  },

  resolutionsTab(b) {
    return `<div class="bc-card bc-pad">
      <div class="bc-side-title">${bcT("القرارات", "Resolutions")} (${b.resolutionsCount})</div>
      ${b.recentResolutions.map(r => `<div class="bc-res-row"><div class="bc-res-code">${r.code}</div><div class="bc-res-t">${esc(bcT(r.title.ar, r.title.en))}</div><span class="bc-badge bc-badge-green" style="margin-top:3px">${bcT("معتمد", "Approved")}</span></div>`).join("")}
      <a class="bc-side-link" style="display:inline-block;margin-top:10px" onclick="Panels.load('resolutions')">${bcT("عرض جميع القرارات", "View all resolutions")} →</a>
    </div>`;
  },

  activityTab(b) {
    return `<div class="bc-card bc-pad">
      <div class="bc-side-title">${bcT("النشاط", "Activity")}</div>
      ${b.activity.map(a => `<div class="bc-done-row"><div class="bc-done-ico">${a.icon}</div><div class="bc-done-info"><div class="bc-done-t">${esc(bcT(a.title.ar, a.title.en))}</div><div class="bc-done-s">${esc(a.sub)} · ${bcT(a.time.ar, a.time.en)}</div></div></div>`).join("")}
    </div>`;
  },

  committeesTab(b) {
    const apiId = b._apiId || b.id;
    const containerId = `bc-committees-${b.id}`;
    // Async load
    setTimeout(async () => {
      const box = document.getElementById(containerId);
      if (!box) return;
      try {
        const list = await fetch(`/api/gov/committees?boardId=${apiId}`, { credentials: "include" }).then(r => r.json());
        if (!Array.isArray(list) || !list.length) {
          box.innerHTML = `<div class="mx-empty" style="padding:24px 0">
            <div class="ic">🏛</div>
            <div class="t">${bcT("لا توجد لجان بعد","No committees yet")}</div>
            <div class="s">${bcT("يمكنك إنشاء لجان فرعية مرتبطة بهذا المجلس.","Create sub-committees linked to this board.")}</div>
            <button class="btn-gold btn-sm" style="margin-top:12px" onclick="BC.openCommitteeModal('${apiId}')">${bcT("+ إنشاء لجنة","+ New Committee")}</button>
          </div>`;
          return;
        }
        box.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <span style="font-weight:700;color:var(--text)">${bcT("اللجان","Committees")} <span class="bc-tab-n">${list.length}</span></span>
            <button class="btn-gold btn-sm" onclick="BC.openCommitteeModal('${apiId}')">${bcT("+ لجنة جديدة","+ New Committee")}</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
            ${list.map(c => `
              <div class="bc-card" style="padding:14px;cursor:default">
                <div style="font-weight:700;font-size:13.5px;color:var(--text);margin-bottom:4px">🏛 ${esc(bcT(c.name_ar,c.name_en))}</div>
                ${c.description ? `<div style="font-size:12px;color:var(--text3);margin-bottom:6px">${esc(c.description)}</div>` : ""}
                <div style="font-size:11.5px;color:var(--text3);display:flex;gap:10px;flex-wrap:wrap">
                  ${c.chairperson ? `<span>👤 ${esc(c.chairperson)}</span>` : ""}
                  <span>👥 ${bcT(`${c.total_members||0} عضو`,`${c.total_members||0} members`)}</span>
                  ${c.default_quorum ? `<span>⚖️ ${bcT(`نصاب: ${c.default_quorum}`,`Quorum: ${c.default_quorum}`)}</span>` : ""}
                </div>
                <div style="margin-top:10px;display:flex;gap:6px">
                  <button class="btn-ghost btn-sm" style="flex:1;font-size:11px" onclick="BC.openCommitteeModal('${apiId}',${c.id})">${bcT("✎ تعديل","✎ Edit")}</button>
                  <button class="btn-ghost btn-sm" style="font-size:11px;color:var(--red)" onclick="BC.deleteCommittee(${c.id},'${apiId}')">🗑</button>
                </div>
              </div>`).join("")}
          </div>`;
      } catch (e) {
        if (box) box.innerHTML = `<div style="color:var(--red);font-size:12px">⚠ ${esc(e.message)}</div>`;
      }
    }, 0);
    return `<div class="bc-card bc-pad" id="${containerId}"><div class="es"><div class="loading"></div></div></div>`;
  },

  openCommitteeModal(boardApiId, editId) {
    const modal = document.createElement("div");
    modal.className = "modal-overlay open";
    modal.id = "bc-committee-modal";
    modal.onclick = e => { if (e.target === modal) BC.closeCommitteeModal(); };
    let existingCommittee = null;
    const loadAndShow = async () => {
      if (editId) {
        try {
          const list = await fetch(`/api/gov/committees?boardId=${boardApiId}`, { credentials: "include" }).then(r => r.json());
          existingCommittee = list.find(c => c.id === editId);
        } catch (_) {}
      }
      const c = existingCommittee;
      modal.innerHTML = `
        <div class="modal" style="max-width:480px">
          <div class="modal-title">${c ? bcT("تعديل اللجنة","Edit Committee") : bcT("لجنة جديدة","New Committee")}</div>
          <div class="fs">
            <div class="fr2">
              <div class="frow"><div class="fl">${bcT("الاسم (عربي)","Name (Arabic)")}</div><input class="fi" id="bcc-ar" value="${esc(c?.name_ar||"")}" placeholder="${bcT("اسم اللجنة","Committee name")}"></div>
              <div class="frow"><div class="fl">${bcT("الاسم (إنجليزي)","Name (English)")}</div><input class="fi" id="bcc-en" dir="ltr" style="text-align:left" value="${esc(c?.name_en||"")}" placeholder="Committee name"></div>
            </div>
            <div class="frow"><div class="fl">${bcT("الوصف","Description")}</div><input class="fi" id="bcc-desc" value="${esc(c?.description||"")}" placeholder="${bcT("وصف مختصر","Brief description")}"></div>
            <div class="fr2">
              <div class="frow"><div class="fl">${bcT("الرئيس","Chairperson")}</div><input class="fi" id="bcc-chair" value="${esc(c?.chairperson||"")}" placeholder="${bcT("اسم الرئيس","Chair name")}"></div>
              <div class="frow"><div class="fl">${bcT("النصاب القانوني","Quorum")}</div><input class="fi" type="number" id="bcc-quorum" value="${c?.default_quorum||""}" min="1" placeholder="e.g. 3"></div>
            </div>
            <div class="frow"><div class="fl">${bcT("عدد الأعضاء","Total Members")}</div><input class="fi" type="number" id="bcc-members" value="${c?.total_members||""}" min="1" placeholder="e.g. 5"></div>
            <div class="fa">
              <button class="btn-gold" onclick="BC.saveCommittee('${boardApiId}',${editId||0})">✓ ${bcT("حفظ","Save")}</button>
              <button class="btn-ghost" onclick="BC.closeCommitteeModal()">${bcT("إلغاء","Cancel")}</button>
            </div>
          </div>
        </div>`;
    };
    document.body.appendChild(modal);
    loadAndShow();
  },

  closeCommitteeModal() { const m = document.getElementById("bc-committee-modal"); if (m) m.remove(); },

  async saveCommittee(boardApiId, editId) {
    const name_ar = document.getElementById("bcc-ar").value.trim();
    const name_en = document.getElementById("bcc-en").value.trim();
    const description = document.getElementById("bcc-desc").value.trim();
    const chairperson = document.getElementById("bcc-chair").value.trim();
    const default_quorum = parseInt(document.getElementById("bcc-quorum").value) || 0;
    const total_members = parseInt(document.getElementById("bcc-members").value) || 0;
    if (!name_ar || !name_en) { showToast(bcT("يرجى إدخال الاسم بالعربية والإنجليزية","Please enter both Arabic and English names"), "error"); return; }
    const payload = { board_id: boardApiId, name_ar, name_en, description, chairperson, default_quorum, total_members };
    try {
      if (editId) {
        await fetch(`/api/gov/committees/${editId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json());
      } else {
        await fetch(`/api/gov/committees`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json());
      }
      showToast(bcT("تم الحفظ بنجاح","Saved successfully"), "success");
      this.closeCommitteeModal();
      this.setTab("committees");
    } catch (e) { showToast(e.message, "error"); }
  },

  async deleteCommittee(id, boardApiId) {
    if (!confirm(bcT("هل أنت متأكد من حذف هذه اللجنة؟","Delete this committee?"))) return;
    try {
      await fetch(`/api/gov/committees/${id}`, { method: "DELETE", credentials: "include" }).then(r => r.json());
      showToast(bcT("تم الحذف","Deleted"), "success");
      this.setTab("committees");
    } catch (e) { showToast(e.message, "error"); }
  },
};
