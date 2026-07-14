"use strict";
// ══ Utilities ════════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (t) =>
  String(t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ── Chat message formatting: lightweight, sanitized markdown → HTML ─────────
// Text is HTML-escaped first, so only tags this function inserts can ever
// reach innerHTML — safe against AI-generated content containing raw markup.
const detectTextDir = (t) => {
  const s = String(t || "");
  const ar = (s.match(/[؀-ۿ]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return ar >= en ? "rtl" : "ltr";
};
const mdInline = (s) =>
  s
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
const mdToHtml = (raw) => {
  const lines = esc(raw).replace(/\r\n/g, "\n").split("\n");
  let html = "",
    listType = null,
    para = [];
  const flushPara = () => {
    if (para.length) {
      html += `<p>${para.join("<br>")}</p>`;
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!line) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^(#{1,6})\s+(.+)$/))) {
      flushPara();
      closeList();
      const level = Math.min(m[1].length + 2, 6);
      html += `<h${level}>${mdInline(m[2])}</h${level}>`;
    } else if (/^(\*{3,}|-{3,}|_{3,})$/.test(line)) {
      flushPara();
      closeList();
      html += "<hr>";
    } else if ((m = line.match(/^[-*•]\s+(.+)$/))) {
      flushPara();
      if (listType && listType !== "ul") closeList();
      if (!listType) {
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${mdInline(m[1])}</li>`;
    } else if ((m = line.match(/^(\d+)[.)]\s+(.+)$/))) {
      flushPara();
      if (listType && listType !== "ol") closeList();
      if (!listType) {
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${mdInline(m[2])}</li>`;
    } else {
      closeList();
      para.push(mdInline(line));
    }
  }
  flushPara();
  closeList();
  return html;
};
const now = () =>
  new Date().toLocaleTimeString(App.lang === "ar" ? "ar-SA" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(App.lang === "ar" ? "ar-SA" : "en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

// ══ Meeting Minutes document renderer ═══════════════════════════════════════════
// ai_minutes_ar/ai_minutes_en are now a JSON-encoded structured document
// ({format:'structured_v1', executive_summary, meeting_info, attendees,
// apologies, agenda, discussion, decisions, actions, risks, followups,
// next_meeting_note, approvals} — see assembleMinutesDoc() server-side) rather
// than a single markdown blob, so every render site gets guaranteed section
// structure instead of hoping the model formatted its free text consistently.
// Meetings processed before this rewrite still have the old markdown-string
// format in the DB — parseMinutesRaw() falls back to running those through
// mdToHtml() (previously they were dumped through esc() as raw text, showing
// literal "#"/"**" characters to the user).
function parseMinutesRaw(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.format === "structured_v1") return obj;
  } catch (_) {
    /* legacy markdown string — fall through */
  }
  return { format: "legacy_markdown", _raw: raw };
}

function renderMinutesDoc(raw, lang) {
  const doc = parseMinutesRaw(raw);
  if (!doc) return "";
  const l = lang;
  if (doc.format === "legacy_markdown") {
    return `<div class="minutes-doc minutes-doc-legacy">${mdToHtml(doc._raw)}</div>`;
  }

  const t = (ar, en) => (l === "ar" ? ar : en);
  const sec = (icon, titleAr, titleEn, bodyHtml) =>
    bodyHtml
      ? `<div class="minutes-sec">
        <div class="minutes-sec-h">${icon} ${t(titleAr, titleEn)}</div>
        <div class="minutes-sec-body">${bodyHtml}</div>
      </div>`
      : "";

  const errorBanner = doc.generation_error
    ? `<div class="minutes-err">⚠ ${t(
        "تعذّر توليد هذا المحضر باللغة المطلوبة — يرجى إعادة معالجة الاجتماع.",
        "This language's minutes could not be generated — please reprocess the meeting.",
      )}</div>`
    : "";

  const mi = doc.meeting_info || {};
  const miHtml = [
    mi.date ? `<div><span class="minutes-mi-k">${t("التاريخ", "Date")}:</span> ${esc(String(mi.date).substring(0, 16))}</div>` : "",
    mi.type ? `<div><span class="minutes-mi-k">${t("النوع", "Type")}:</span> ${esc(typeof mtLabel === "function" ? mtLabel(mi.type, l) : mi.type)}</div>` : "",
    mi.duration_mins ? `<div><span class="minutes-mi-k">${t("المدة", "Duration")}:</span> ${mi.duration_mins} ${t("دقيقة", "min")}</div>` : "",
  ].filter(Boolean).join("");

  const attendeesHtml = (doc.attendees || []).length
    ? `<div class="minutes-chips">${doc.attendees.map((a) => `<span class="tag tgold" style="font-size:11.5px">${esc(a)}</span>`).join("")}</div>`
    : `<div class="minutes-empty">${t("غير محدد في النص", "Not specified in the transcript")}</div>`;
  const apologiesHtml = (doc.apologies || []).length
    ? `<div class="minutes-chips">${doc.apologies.map((a) => `<span class="tag" style="background:var(--navy4);font-size:11.5px">${esc(a)}</span>`).join("")}</div>`
    : "";

  const agendaHtml = (doc.agenda || []).length
    ? `<ol class="minutes-list">${doc.agenda.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>`
    : "";

  const discussionHtml = (doc.discussion || []).length
    ? doc.discussion.map((d) => `<div class="minutes-topic">
        <div class="minutes-topic-h">${esc(d.topic || "")}</div>
        <div class="minutes-topic-body">${esc(d.narrative || "")}</div>
      </div>`).join("")
    : "";

  const decisionsHtml = (doc.decisions || []).length
    ? `<ul class="minutes-list">${doc.decisions.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`
    : "";

  const actionsHtml = (doc.actions || []).length
    ? `<div class="minutes-actions">${doc.actions.map((a) => `<div class="minutes-action-row">
        <div class="minutes-action-text">${esc(a.text)}</div>
        <div class="minutes-action-meta">${a.owner ? `<span class="tag tgold" style="font-size:11px">👤 ${esc(a.owner)}</span>` : ""}${a.due ? `<span class="tag" style="background:var(--navy4);font-size:11px">📅 ${esc(a.due)}</span>` : ""}</div>
      </div>`).join("")}</div>`
    : "";

  const riskSevColor = { high: "var(--red)", medium: "var(--amber)", low: "var(--text3)" };
  const risksHtml = (doc.risks || []).length
    ? doc.risks.map((r) => `<div class="minutes-risk" style="border-inline-start-color:${riskSevColor[r.severity] || "var(--text3)"}">
        <div class="minutes-risk-text">${esc(r.text)}</div>
        ${r.mitigation ? `<div class="minutes-risk-mit">${t("تخفيف", "Mitigation")}: ${esc(r.mitigation)}</div>` : ""}
      </div>`).join("")
    : "";

  const followupsHtml = (doc.followups || []).length
    ? `<ul class="minutes-list">${doc.followups.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
    : "";

  const approvals = doc.approvals || {};
  const approvalLabel = {
    draft: t("مسودة", "Draft"),
    circulated: t("مُعمَّم", "Circulated"),
    approved: t("مُعتمد", "Approved"),
    revision_needed: t("يتطلب تعديلاً", "Revision Needed"),
    final_approved: t("اعتماد نهائي", "Final Approved"),
  }[approvals.status] || approvals.status || t("مسودة", "Draft");
  const approvalsHtml = `<div class="minutes-approvals">
    <span class="tag" style="background:var(--navy4)">${esc(approvalLabel)}</span>
    ${approvals.circulated_at ? `<span class="minutes-mi-k">${t("عُمِّم في", "Circulated")}: ${esc(String(approvals.circulated_at).substring(0, 16))}</span>` : ""}
    ${approvals.final_approved_at ? `<span class="minutes-mi-k">${t("اعتُمد نهائياً في", "Final approved")}: ${esc(String(approvals.final_approved_at).substring(0, 16))}</span>` : ""}
  </div>`;

  return `<div class="minutes-doc">
    ${errorBanner}
    ${doc.executive_summary ? `<div class="minutes-exec-summary">${esc(doc.executive_summary)}</div>` : ""}
    ${sec("🗓️", "معلومات الاجتماع", "Meeting Information", miHtml)}
    ${sec("👥", "الحضور", "Attendees", attendeesHtml + apologiesHtml)}
    ${sec("📋", "جدول الأعمال", "Agenda", agendaHtml)}
    ${sec("💬", "المناقشات", "Discussion", discussionHtml)}
    ${sec("⚖️", "القرارات الرئيسية", "Key Decisions", decisionsHtml)}
    ${sec("🎯", "الإجراءات التنفيذية", "Executive Actions", actionsHtml)}
    ${sec("⚠️", "المخاطر", "Risks", risksHtml)}
    ${sec("🔁", "المتابعات", "Follow-ups", followupsHtml)}
    ${doc.next_meeting_note ? sec("⏭️", "الاجتماع القادم", "Next Meeting", `<div>${esc(doc.next_meeting_note)}</div>`) : ""}
    ${sec("✅", "الاعتماد", "Approvals", approvalsHtml)}
  </div>`;
}

// ══ RBAC ═══════════════════════════════════════════════════════════════════════
const ROLE_ACCESS = {
  Admin: new Set([
    "create-meeting", "scheduled", "live",
    "transcripts",
    "history",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "team",
    "overview",
    "analytics", "activity",
    "governance", "boards",
    "integrations",
    "admin",
  ]),
  CEO: new Set([
    "create-meeting", "scheduled", "live",
    "transcripts",
    "history",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "team",
    "overview",
    "analytics", "activity",
    "governance", "boards",
  ]),
  "Board Member": new Set([
    "transcripts",
    "history",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "overview",
    "analytics", "activity",
    "governance", "boards",
  ]),
  "Committee Member": new Set([
    "transcripts",
    "history",
    "tasks",
    "ask",
    "schedule",
    "series",
    "overview",
    "governance", "boards",
  ]),
  Executive: new Set([
    "create-meeting", "scheduled", "live",
    "transcripts",
    "history",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "overview",
    "analytics", "activity",
  ]),
  Manager: new Set([
    "create-meeting", "scheduled", "live",
    "transcripts",
    "history",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "team",
    "overview",
    "analytics", "activity",
  ]),
  Employee: new Set(["overview", "create-meeting", "scheduled", "live", "transcripts", "history", "tasks", "ask"]),
  Observer: new Set(["transcripts", "history", "lastmeeting", "overview", "tasks"]),
  // ── Phase 4 enterprise RBAC roles ──────────────────────────────────────────
  "Super Admin": new Set([
    "create-meeting", "scheduled", "live", "transcripts", "history", "lastmeeting", "tasks", "ask",
    "documents", "schedule", "series", "team", "overview", "analytics", "activity",
    "governance", "boards", "integrations", "admin",
  ]),
  "Organization Admin": new Set([
    "create-meeting", "scheduled", "live", "transcripts", "history", "lastmeeting", "tasks", "ask",
    "documents", "schedule", "series", "team", "overview", "analytics", "activity",
    "governance", "boards", "integrations", "admin",
  ]),
  "Board Secretary": new Set([
    "create-meeting", "scheduled", "live", "transcripts", "history", "lastmeeting", "tasks", "ask",
    "documents", "schedule", "series", "overview", "analytics", "activity", "governance", "boards",
  ]),
  "Committee Chair": new Set([
    "transcripts", "history", "tasks", "ask", "documents", "schedule",
    "series", "overview", "governance", "boards",
  ]),
  Auditor: new Set(["transcripts", "history", "lastmeeting", "tasks", "overview", "analytics", "activity"]),
  Guest: new Set(["overview", "transcripts", "history", "lastmeeting", "tasks"]),
};
// Policies & Resolutions live in the Governance sidebar section — mirror the
// "documents" visibility so every role that can browse documents can also
// browse policies/resolutions (backend permissions remain the real gate).
Object.values(ROLE_ACCESS).forEach((set) => {
  if (set.has("documents")) { set.add("policies"); set.add("resolutions"); }
  if (set.has("scheduled") || set.has("tasks")) set.add("calendar");
  // Activity Log sidebar entry mirrors the "activity" permission.
  if (set.has("activity")) set.add("logs");
});

// ══ Executive Action taxonomy ══════════════════════════════════════════════
// Single source of truth for task status/priority labels + badge colors,
// shared by the Task & Decision Tracker, the Executive Action Assignment
// table, and the Executive Actions summaries in Transcripts/Meeting History.
// Legacy DB values ('new', 'normal', 'urgent') are aliased rather than
// migrated, so existing rows keep working with zero data changes.
const TASK_STATUS_META = {
  ai_draft: { ar: "مسودة AI", en: "AI Draft", tagClass: "tpurple" },
  awaiting_assignment: { ar: "بانتظار الإسناد", en: "Awaiting Assignment", tagClass: "tb" },
  open: { ar: "مفتوحة", en: "Open", tagClass: "tb" },
  assigned: { ar: "مُسندة", en: "Assigned", tagClass: "tgold" },
  inprogress: { ar: "قيد التنفيذ", en: "In Progress", tagClass: "ta" },
  waiting: { ar: "بانتظار", en: "Waiting", tagClass: "tgr" },
  blocked: { ar: "معلّقة", en: "Blocked", tagClass: "tr" },
  done: { ar: "مكتملة", en: "Completed", tagClass: "tg" },
  cancelled: { ar: "ملغاة", en: "Cancelled", tagClass: "tgr" },
  overdue: { ar: "متأخرة", en: "Overdue", tagClass: "tr" },
};
const TASK_STATUS_ALIAS = { new: "open" };
const TASK_ASSIGNABLE_STATUSES = ["open", "assigned", "inprogress", "waiting", "blocked", "done", "cancelled"];
function taskStatusKey(status) {
  return TASK_STATUS_ALIAS[status] || status;
}
function taskStatusMeta(status) {
  return TASK_STATUS_META[taskStatusKey(status)] || { ar: status, en: status, tagClass: "tgr" };
}

const TASK_PRIORITY_META = {
  low: { ar: "منخفض", en: "Low", c: "var(--text3)", bg: "var(--navy4)", bd: "var(--border2)" },
  medium: { ar: "متوسط", en: "Medium", c: "var(--blue)", bg: "rgba(91,150,212,.12)", bd: "rgba(91,150,212,.3)" },
  high: { ar: "عالٍ", en: "High", c: "var(--amber)", bg: "rgba(212,160,23,.12)", bd: "rgba(212,160,23,.3)" },
  critical: { ar: "حرج", en: "Critical", c: "var(--red)", bg: "rgba(220,60,60,.12)", bd: "rgba(220,60,60,.3)" },
};
const TASK_PRIORITY_ALIAS = { normal: "medium", urgent: "critical" };
const TASK_ASSIGNABLE_PRIORITIES = ["low", "medium", "high", "critical"];
function taskPriorityKey(priority) {
  return TASK_PRIORITY_ALIAS[priority] || priority;
}
function taskPriorityMeta(priority) {
  return TASK_PRIORITY_META[taskPriorityKey(priority)] || TASK_PRIORITY_META.medium;
}

// AI Task Review confidence badge (set once at extraction time in pipeline.js,
// not recomputed later — it reflects how sure the model was, not the task's
// current assignment state).
const AI_CONFIDENCE_META = {
  high: { ar: "ثقة عالية", en: "High Confidence", c: "var(--green)", bg: "rgba(46,204,138,.12)" },
  medium: { ar: "ثقة متوسطة", en: "Medium Confidence", c: "var(--amber)", bg: "rgba(212,160,23,.12)" },
  low: { ar: "ثقة منخفضة", en: "Low Confidence", c: "var(--red)", bg: "rgba(220,60,60,.12)" },
};
const PROGRESS_STEPS = [0, 25, 50, 75, 100];

const ROLE_COLORS = {
  Admin: "#e05a5a",
  CEO: "#C9A84C",
  "Board Member": "#5B9BD6",
  "Committee Member": "#2ECC8A",
  Executive: "#9370DB",
  Manager: "#EFA827",
  Employee: "#888",
  Observer: "#888",
  "Super Admin": "#e05a5a",
  "Organization Admin": "#e08a4a",
  "Board Secretary": "#5BC0D6",
  "Committee Chair": "#2ECC8A",
  Auditor: "#7a7a9a",
  Guest: "#888",
};

// ══ Charts helper — wraps Chart.js; destroys stale instance before re-render ══
const Charts = {
  _i: {},
  render(id, cfg) {
    if (this._i[id]) {
      try {
        this._i[id].destroy();
      } catch (_) {}
      delete this._i[id];
    }
    const el = $(id);
    if (!el || !window.Chart) return null;
    this._i[id] = new Chart(el, cfg);
    return this._i[id];
  },
  destroyAll() {
    Object.values(this._i).forEach((c) => {
      try {
        c.destroy();
      } catch (_) {}
    });
    this._i = {};
  },
};

function _chartBase(lang) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: "#a0a0b0", font: { size: 10 }, boxWidth: 11 },
      },
    },
    scales: {
      x: {
        ticks: { color: "#808090", font: { size: 10 } },
        grid: { color: "rgba(255,255,255,0.06)" },
      },
      y: {
        ticks: { color: "#808090", font: { size: 10 } },
        grid: { color: "rgba(255,255,255,0.06)" },
        beginAtZero: true,
      },
    },
  };
}
function _chartPie() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: "#a0a0b0",
          font: { size: 10 },
          boxWidth: 11,
          padding: 8,
        },
      },
    },
  };
}
function _monthLabel(m, lang) {
  const [y, mo] = m.split("-");
  return new Date(+y, +mo - 1, 1).toLocaleDateString(
    lang === "ar" ? "ar-SA" : "en-GB",
    { month: "short", year: "2-digit" },
  );
}
function _weekLabel(w, lang) {
  if (!w) return "";
  return new Date(w).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-GB", {
    month: "short",
    day: "numeric",
  });
}

function applySidebarRoles() {
  const role = App.systemRole || "Admin";
  const allowed = ROLE_ACCESS[role] || ROLE_ACCESS["Employee"];

  document.querySelectorAll(".nb[data-p]").forEach((btn) => {
    const p = btn.dataset.p;
    if (p === "admin") return;
    btn.style.display = allowed.has(p) ? "" : "none";
  });

  // Uses the same `allowed` set as every other nav item (not a literal
  // role-name check) so Super Admin/Organization Admin — who also carry the
  // "admin" key in ROLE_ACCESS — see Role Management too, not just "Admin".
  const adminNav = $("nav-admin");
  const adminSec = $("nsec-admin");
  if (adminNav) adminNav.style.display = allowed.has("admin") ? "" : "none";
  if (adminSec) adminSec.style.display = allowed.has("admin") ? "" : "none";

  // Hide developer/admin-only UI elements from end users
  const adminRoles = new Set(["Admin", "Super Admin", "Organization Admin"]);
  const isAdminRole = adminRoles.has(role);
  const planBtn = $("plan-btn");
  const apiKeyBtn = $("api-key-btn");
  if (planBtn) planBtn.style.display = isAdminRole ? "" : "none";
  if (apiKeyBtn) apiKeyBtn.style.display = isAdminRole ? "" : "none";

  // Sync bottom-nav active state whenever sidebar roles are applied
  document.querySelectorAll(".bnav-btn[data-p]").forEach(b => {
    b.style.display = allowed.has(b.dataset.p) ? "" : "none";
  });

  document.querySelectorAll(".nsec").forEach((sec) => {
    if (sec.id === "nsec-admin") return;
    let next = sec.nextElementSibling;
    let hasVisible = false;
    while (
      next &&
      !next.classList.contains("nsec") &&
      !next.classList.contains("sf")
    ) {
      if (next.classList.contains("nb") && next.style.display !== "none") {
        hasVisible = true;
        break;
      }
      next = next.nextElementSibling;
    }
    sec.style.display = hasVisible ? "" : "none";
  });
}

// ══ App State ══════════════════════════════════════════════════════════════════
const App = {
  lang: localStorage.getItem("lang") || "ar",
  theme: localStorage.getItem("theme") || "dark",
  user: null,
  systemRole: "Admin",
  plan: "free",
  chatHistory: [],
  // Populated from GET /api/rbac/my-permissions in loadSelectLists() — lets
  // the UI hide actions the backend would 403 on anyway (defense in depth,
  // the backend requirePermission() check is still the real gate).
  permissions: new Set(),
  can(permKey) {
    return this.permissions.has(permKey);
  },

  async init() {
    this.applyTheme(this.theme);
    // Apply the stored language/direction immediately — before any network
    // round-trip below — so a returning user whose preference is 'en' never
    // sees a flash of Arabic/RTL while /auth/me and /api/plan are in flight.
    this.applyLang(this.lang);
    try {
      const me = await api("/auth/me");
      this.user = me;
      this.systemRole = me.system_role || "Admin";
    } catch (e) {
      if (
        e.status === 401 ||
        (e.message &&
          (e.message.includes("401") || e.message.includes("UNAUTHORIZED")))
      ) {
        window.location.replace("/login.html");
        return;
      }
      this.user = null;
    }
    await this.loadPlan();
    this.applyLang(this.lang);
    this.renderUser();
    applySidebarRoles();
    await loadBadges();
    NotificationCenter.init();
    await loadSelectLists();
    Panels.init();
    Chat.restore();
    const allowed = ROLE_ACCESS[this.systemRole] || ROLE_ACCESS["Employee"];
    // Home (the executive command center) is the natural landing page for
    // every role that can see it — falls back to whatever else the role has
    // access to, same as before, for the handful of roles that can't.
    let firstPanel = allowed.has("overview") ? "overview" : ([...allowed][0] || "scheduled");
    try {
      const bootPanel = sessionStorage.getItem("ameen_boot_panel");
      if (bootPanel) {
        sessionStorage.removeItem("ameen_boot_panel");
        if (allowed.has(bootPanel)) firstPanel = bootPanel;
      }
    } catch (_) {}
    Panels.load(firstPanel);
  },

  isPro() {
    return this.plan === "pro";
  },

  async loadPlan() {
    try {
      const r = await api("/api/plan");
      this.plan = r.plan || "free";
    } catch (e) {
      this.plan = "free";
    }
    this.renderPlan();
  },

  renderPlan() {
    const pro = this.isPro();
    const txt = $("plan-txt");
    if (txt) txt.textContent = pro ? "Pro" : (this.lang === "ar" ? "مجاني" : "Free");
    const badge = $("plan-badge");
    if (badge) badge.style.color = pro ? "var(--gold)" : "var(--text3)";
    const btn = $("plan-btn");
    if (btn) btn.style.borderColor = pro ? "var(--gold-border)" : "";
    document.querySelectorAll("[data-pro]").forEach((el) => {
      el.style.display = pro ? "" : "none";
    });
    document.querySelectorAll("[data-free]").forEach((el) => {
      el.style.display = pro ? "none" : "";
    });
  },

  openPlan() {
    const l = this.lang;
    const cur = $("plan-current");
    if (cur)
      cur.textContent =
        (l === "ar" ? "باقتك الحالية: " : "Current plan: ") +
        (this.isPro() ? "Pro ⭐" : "Free");
    $("plan-upgrade-btn").style.display = this.isPro() ? "none" : "";
    $("plan-downgrade-btn").style.display = this.isPro() ? "" : "none";
    $("modal-plan").classList.add("open");
    this.applyLang(l);
  },
  closePlan() {
    $("modal-plan").classList.remove("open");
  },

  async setPlan(plan) {
    try {
      const r = await api("/api/plan", {
        method: "PATCH",
        body: JSON.stringify({ plan }),
      });
      this.plan = r.plan;
      this.renderPlan();
      this.closePlan();
      const cur = document.querySelector(".nb.active") && document.querySelector(".nb.active").dataset.p;
      if (cur) Panels.load(cur);
    } catch (e) {
      alert(e.message);
    }
  },

  requirePro() {
    if (this.isPro()) return true;
    this.openPlan();
    return false;
  },

  setLang(l) {
    this.lang = l;
    localStorage.setItem("lang", l);
    this.applyLang(l);
    this.renderPlan();
    const cur = document.querySelector(".nb.active") && document.querySelector(".nb.active").dataset.p;
    if (cur) Panels.load(cur);
  },

  toggleTheme() {
    this.applyTheme(this.theme === "dark" ? "light" : "dark");
  },

  applyTheme(t) {
    this.theme = t;
    localStorage.setItem("theme", t);
    document.documentElement.setAttribute("data-theme", t);
    const btn = $("theme-icon");
    if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
    const lbl = $("theme-label");
    if (lbl) {
      lbl.dataset.ar = t === "dark" ? "فاتح" : "داكن";
      lbl.dataset.en = t === "dark" ? "Light" : "Dark";
      lbl.textContent = this.lang === "ar" ? lbl.dataset.ar : lbl.dataset.en;
    }
  },

  applyLang(l) {
    document.documentElement.lang = l;
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
    document
      .querySelectorAll(".lb")
      .forEach((b) =>
        b.classList.toggle(
          "active",
          b.textContent.trim() === (l === "ar" ? "ع" : "EN"),
        ),
      );

    document.querySelectorAll("[data-ar]").forEach((el) => {
      const txt = l === "ar" ? el.dataset.ar : el.dataset.en;
      if (!txt) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.placeholder = txt;
      } else {
        el.textContent = txt;
      }
    });

    document.querySelectorAll("[data-ph-ar]").forEach((el) => {
      el.placeholder = l === "ar" ? el.dataset.phAr : el.dataset.phEn;
    });

    // Chat welcome
    const wt = $("welcome-text");
    const wts = $("welcome-ts");
    if (wt) {
      wt.textContent =
        l === "ar"
          ? "أنا أمين، مساعدكم التنفيذي الذكي. يمكنني تحليل الاجتماعات، متابعة المهام والقرارات، والإجابة على أي سؤال تنفيذي."
          : "I'm Ameen, your executive AI. I can analyse meetings, track tasks and decisions, and answer any executive question.";
    }
    if (wts) wts.textContent = now();

    // Chat input
    const ci = $("ci");
    if (ci) ci.placeholder = l === "ar" ? "اسأل أمين..." : "Ask Ameen...";
  },

  renderUser() {
    if (!this.user) return;
    const l = this.lang;
    const name =
      l === "ar" ? this.user.name_ar : this.user.name_en || this.user.name_ar;
    const role =
      l === "ar" ? this.user.role_ar || "مستخدم" : this.user.role_en || "User";
    const initials = name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
    const uav = $("u-av");
    if (uav) uav.textContent = initials;
    const uname = $("u-name");
    if (uname) uname.textContent = name;
    const urole = $("u-role");
    if (urole) urole.textContent = role;
    const sysRole = this.systemRole || "Admin";
    const badge = $("u-sysrole");
    if (badge) {
      const color = ROLE_COLORS[sysRole] || "var(--text3)";
      badge.textContent = sysRole;
      badge.style.color = color;
      badge.style.borderColor = color + "44";
      badge.style.background = color + "14";
      badge.style.display = "inline-block";
    }
  },

  // This is very likely the first thing a technical evaluator interacts with
  // when setting up a pilot (pasting in their AI API key) — a raw browser
  // prompt() here undermines the "professional first impression" bar more
  // than almost anywhere else in the app. Reuses the same modal system as
  // everywhere else instead.
  promptApiKey() {
    const cur = sessionStorage.getItem("api_key") || "";
    const input = $("api-key-input");
    if (input) input.value = cur;
    $("modal-api-key").classList.add("open");
  },
  closeApiKeyModal() {
    $("modal-api-key").classList.remove("open");
  },
  saveApiKey() {
    const k = (($("api-key-input") || {}).value || "").trim();
    if (k && k.startsWith("sk-ant")) {
      sessionStorage.setItem("api_key", k);
      api("/api/ai/setkey", {
        method: "POST",
        body: JSON.stringify({ key: k }),
      })
        .then(() => {
          $("api-key-btn").style.borderColor = "var(--green)";
          $("api-status-txt").textContent =
            this.lang === "ar" ? "✓ مفعّل" : "✓ Active";
          this.closeApiKeyModal();
        })
        .catch(() => {});
    } else if (k === "") {
      sessionStorage.removeItem("api_key");
      $("api-status-txt").textContent = "Anthropic API";
      this.closeApiKeyModal();
    } else {
      showToast(
        this.lang === "ar"
          ? "مفتاح غير صالح — يجب أن يبدأ بـ sk-ant"
          : "Invalid key — must start with sk-ant",
        "error",
      );
    }
  },
};

// ══ API ════════════════════════════════════════════════════════════════════════
// Auth fallback headers for raw fetch() calls that bypass api() — e.g. file
// uploads with FormData bodies. Same mechanism as api(): cookie is primary,
// Authorization header covers cookie-blocked contexts. Pass extra headers in.
function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  const fbToken = sessionStorage.getItem("ameen_token_fb");
  if (fbToken) h["Authorization"] = "Bearer " + fbToken;
  return h;
}
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  // Cookie is the primary auth mechanism; the Authorization header is a
  // fallback for browsers that refuse to store/send the cookie (strict
  // third-party-cookie settings, embedded preview iframes). Set by login.html.
  const fbToken = sessionStorage.getItem("ameen_token_fb");
  if (fbToken) headers["Authorization"] = "Bearer " + fbToken;
  const r = await fetch(path, {
    ...opts,
    credentials: "include",
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  // message wins over error when both exist: most routes only set `error`
  // with the human-readable text itself, but a few (e.g. the scheduling
  // conflict response) set BOTH — a machine-checkable code in `error`
  // ("CONFLICT") and the actual friendly sentence in `message`. Checking
  // `error` first meant a double-booking attempt surfaced the raw literal
  // string "CONFLICT" to the user instead of "This time overlaps a
  // confirmed meeting."
  if (!r.ok) {
    const err = new Error(data.message || data.error || `HTTP ${r.status}`);
    // Expose the HTTP status so callers can detect auth failures reliably —
    // matching on message text alone misses bodies like "Not logged in".
    err.status = r.status;
    throw err;
  }
  return data;
}

async function logoutUser() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (_) {}
  sessionStorage.removeItem("ameen_token_fb");
  window.location.replace("/login.html");
}

// Global, self-contained toast — works on any panel without needing a pre-existing
// element. type: 'success' | 'error'.
function showToast(message, type = "success") {
  let host = document.getElementById("global-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "global-toast-host";
    host.style.cssText =
      "position:fixed;bottom:20px;inset-inline-end:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none";
    document.body.appendChild(host);
  }
  const ok = type === "success";
  const t = document.createElement("div");
  t.style.cssText =
    `pointer-events:auto;display:flex;align-items:center;gap:7px;padding:11px 15px;border-radius:10px;font-size:13px;font-weight:600;line-height:1.4;box-shadow:var(--shadow-md);animation:fi .25s ease;` +
    (ok
      ? "background:var(--green2);border:1px solid rgba(39,196,126,.45);color:var(--green)"
      : "background:var(--red2);border:1px solid rgba(224,85,85,.45);color:var(--red)");
  t.textContent = `${ok ? "✓" : "⚠"} ${message}`;
  host.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ══ Navigation ════════════════════════════════════════════════════════════════
const Panels = {
  init() {
    document.querySelectorAll(".nb[data-p]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".nb")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        Panels.load(btn.dataset.p);
      });
    });
  },
  current: null,
  _pollTimer: null,
  // Tracker panels that should keep themselves fresh while open (reminders fire,
  // tasks roll to overdue, drafts get confirmed elsewhere, etc.).
  _livePanels: {
    tasks: renderTasks,
    schedule: renderSchedule,
    calendar: () => CalendarPanel.refresh(),
    overview: renderOverview,
  },
  async load(name) {
    // Warn if the Create Meeting form has unsaved changes before navigating away.
    if (this.current === "create-meeting" && name !== "create-meeting"
        && typeof CreateMeetingWizard !== "undefined" && CreateMeetingWizard._dirty) {
      const l = App.lang;
      const msg = l === "ar"
        ? "لديك تغييرات غير محفوظة. هل تريد المغادرة؟"
        : "You have unsaved changes. Are you sure you want to leave?";
      if (!confirm(msg)) return;
      CreateMeetingWizard._dirty = false;
    }
    // Live Meetings runs a 1s elapsed-timer interval while open — stop it the
    // moment we navigate away, same idea as Rec clearing its own timerInt on
    // stop(), so it doesn't keep ticking against detached DOM in the background.
    if (this.current === "live" && name !== "live") LiveMeetingsPanel.stopTimer();
    this.current = name;
    document
      .querySelectorAll(".panel")
      .forEach((p) => p.classList.remove("active"));
    const panel = $(`panel-${name}`);
    if (panel) panel.classList.add("active");
    // Meeting sub-features no longer have their own sidebar entries — keep the
    // "Meetings" nav item highlighted while the user is inside any of them.
    const navAlias = {
      "create-meeting": "scheduled", record: "scheduled", live: "scheduled",
      transcripts: "scheduled", history: "scheduled",
      series: "scheduled", lastmeeting: "scheduled", schedule: "calendar",
      team: "integrations", activity: "overview",
    };
    const navName = document.querySelector(`.nb[data-p="${name}"]`) ? name : navAlias[name] || name;
    document
      .querySelectorAll(".nb")
      .forEach((b) => b.classList.toggle("active", b.dataset.p === navName));
    // Sync mobile bottom-nav active state
    document.querySelectorAll(".bnav-btn[data-p]")
      .forEach(b => b.classList.toggle("active", b.dataset.p === navName));
    App.applyLang(App.lang);

    switch (name) {
      case "transcripts":
        await renderTranscripts();
        break;
      case "history":
        MeetingHistory._target = "hist";
        await MeetingHistory.refresh();
        break;
      case "tasks":
        await renderTasks();
        break;
      case "schedule":
        await CalendarPanel.refresh();
        break;
      case "calendar":
        await CalendarPanel.refresh();
        break;
      case "series":
        await SeriesPanel.refresh();
        break;
      case "overview":
        await renderOverview();
        break;
      case "analytics":
        await renderAnalytics();
        break;
      case "activity":
        await Activity.render();
        break;
      case "team":
        await Team.load();
        break;
      case "documents":
        await loadDocMeetings();
        break;
      case "lastmeeting":
        await renderLastMeeting();
        break;
      case "governance":
        await Gov.init();
        break;
      case "boards":
        await BC.init();
        break;
      case "admin":
        await renderAdminPanel();
        break;
      case "record":
        ImportFlow.init();
        break;
      case "integrations":
        renderIntegrations();
        break;
      case "create-meeting":
        // Legacy entry point — the Create Meeting experience now lives inside
        // the Meetings module (new design). Redirect there.
        if (window.MT) { MT.openCreate(); return; }
        CreateMeetingWizard.init();
        break;
      case "scheduled":
        if (window.MT) MT.onPanelShow();
        await ScheduledPanel.refresh();
        break;
      case "policies":
        if (window.MT) await MT.renderPolicies();
        break;
      case "resolutions":
        if (window.MT) await MT.renderResolutions();
        break;
      case "logs":
        await ActivityLog.refresh();
        break;
      case "live":
        await LiveMeetingsPanel.refresh();
        break;
      case "workspace":
        if (window.MT) { MT.openDetail(null); } else await Panels.load("scheduled");
        return;
    }
    this._startPolling();
  },
  _startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      // Pause when the tab is hidden to avoid pointless background work.
      if (document.hidden) return;
      const fn = this._livePanels[this.current];
      if (fn) {
        Promise.resolve(fn()).catch(() => {});
        loadBadges().catch(() => {});
      }
    }, 20000);
  },
};

// ══ Badges ════════════════════════════════════════════════════════════════════
async function loadBadges() {
  try {
    const s = await api("/api/stats");
    const bt = $("b-tk");
    if (bt) {
      bt.textContent = s.tasks_open;
      bt.style.display = s.tasks_open ? "flex" : "none";
      bt.className = "nbg" + (s.tasks_overdue > 0 ? " nbg-red" : " nbg-gold");
    }
    const br = $("b-tr");
    if (br) {
      br.textContent = s.meetings;
      br.style.display = s.meetings ? "flex" : "none";
    }
    const bs = $("b-sc");
    if (bs) {
      bs.textContent = s.schedule;
      bs.style.display = s.schedule ? "flex" : "none";
    }

    const lt = $("ov-late-tag");
    if (lt)
      lt.textContent = `⚠ ${s.tasks_overdue} ${App.lang === "ar" ? "متأخرة" : "overdue"}`;
    const pt = $("ov-prog-tag");
    if (pt)
      pt.textContent = `▶ ${s.tasks_open - s.tasks_overdue} ${App.lang === "ar" ? "جارٍ" : "in progress"}`;
    const dt = $("ov-done-tag");
    if (dt)
      dt.textContent = `✓ ${s.tasks_done} ${App.lang === "ar" ? "مكتملة" : "done"}`;
  } catch (e) {}
}

// ══ Load select dropdowns ═════════════════════════════════════════════════════
async function loadSelectLists() {
  try {
    const [users, bc, myPerms] = await Promise.all([
      api("/api/members"),
      api("/api/gov/boards-and-committees").catch(() => ({
        boards: [],
        committees: [],
      })),
      api("/api/rbac/my-permissions").catch(() => ({ permissions: [] })),
    ]);
    App._members = users;
    App._boards = bc.boards || [];
    App._committees = bc.committees || [];
    App.permissions = new Set(myPerms.permissions || []);
    const l = App.lang;
    const opts = users
      .map(
        (u) =>
          `<option value="${u.id}">${esc(l === "ar" ? u.name_ar : u.name_en || u.name_ar)}</option>`,
      )
      .join("");
    const ownerSel = $("nt-owner");
    if (ownerSel)
      ownerSel.innerHTML = `<option value="">-- ${l === "ar" ? "اختر" : "Select"} --</option>${opts}`;
    Schedule._populateBoardSelects();
  } catch (e) {}
}

function recurrenceLabel(rec, l) {
  const map = {
    weekly: l === "ar" ? "أسبوعي" : "Weekly",
    biweekly: l === "ar" ? "كل أسبوعين" : "Bi-weekly",
    monthly: l === "ar" ? "شهري" : "Monthly",
    quarterly: l === "ar" ? "ربع سنوي" : "Quarterly",
  };
  return map[rec] || rec;
}

async function loadDocMeetings() {
  try {
    const mtgs = await api("/api/meetings");
    const l = App.lang;
    const sel = $("doc-meeting-sel");
    if (sel)
      sel.innerHTML =
        `<option value="">-- ${l === "ar" ? "اختر اجتماعاً" : "Select meeting"} --</option>` +
        `<option value="all">${l === "ar" ? "📊 جميع الاجتماعات السابقة (تقرير موحّد)" : "📊 All past meetings (combined report)"}</option>` +
        mtgs
          .map(
            (m) =>
              `<option value="${m.id}">${esc(l === "ar" ? m.title_ar : m.title_en || m.title_ar)} (${(m.meeting_date && m.meeting_date.substring(0, 10)) || ""})</option>`,
          )
          .join("");
  } catch (e) {}
  await DocLib.renderQuickAccess();
  await DocLib.renderLibrary("doc-library-section");
}

// ── Document pinning — frontend-only (localStorage), no backend field exists.
const DocPins = {
  key: "ameen_doc_pins",
  _set: null,
  _load() {
    if (this._set) return this._set;
    try {
      this._set = new Set(JSON.parse(localStorage.getItem(this.key) || "[]"));
    } catch (e) {
      this._set = new Set();
    }
    return this._set;
  },
  has(id) {
    return this._load().has(id);
  },
  toggle(id) {
    const s = this._load();
    if (s.has(id)) s.delete(id);
    else s.add(id);
    try {
      localStorage.setItem(this.key, JSON.stringify([...s]));
    } catch (e) {}
    DocLib.renderQuickAccess();
    DocLib.renderLibrary("doc-library-section");
  },
};

// ══ Document Library (File Uploads) ═══════════════════════════════════════════
const DocLib = {
  _searchTimer: null,
  _typeFilter: "",
  _dateFilter: "",
  search(q) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      const el = $("doc-library-section");
      if (el) el._search = q;
      this.renderLibrary("doc-library-section");
    }, 350);
  },
  setTypeFilter(v) {
    this._typeFilter = v;
    this.renderLibrary("doc-library-section");
  },
  setDateFilter(v) {
    this._dateFilter = v;
    this.renderLibrary("doc-library-section");
  },
  async upload(meetingId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.xlsx,.pptx,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const btn = $(`doc-upload-btn-${meetingId}`);
      const l = App.lang;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `⏳ ${l === "ar" ? "جارٍ التحليل..." : "Analysing..."}`;
      }
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch(`/api/meetings/${meetingId}/upload`, {
          method: "POST",
          credentials: "include",
          headers: authHeaders(),
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        await this.loadAndRender(meetingId);
        if (typeof Gov !== "undefined" && Gov.meetingId === meetingId)
          Gov._loadSections();
        showToast(
          l === "ar"
            ? "✓ تم رفع الملف وتحليله بالذكاء الاصطناعي"
            : "✓ File uploaded and AI-analysed",
        );
      } catch (err) {
        alert((App.lang === "ar" ? "خطأ: " : "Error: ") + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `📎 ${App.lang === "ar" ? "إرفاق" : "Attach"}`;
        }
      }
    };
    input.click();
  },
  async loadAndRender(meetingId) {
    const container = $(`mtg-docs-${meetingId}`);
    if (!container) return;
    try {
      const docs = await api(`/api/meetings/${meetingId}/documents`);
      if (!docs.length) {
        container.innerHTML = "";
        return;
      }
      const l = App.lang;
      container.innerHTML = `<div style="margin-top:10px;border-top:.5px solid var(--border2);padding-top:10px">
        <div style="font-size:11px;font-weight:700;color:var(--blue);margin-bottom:7px">📎 ${l === "ar" ? "الوثائق المرفقة" : "Attached Documents"} (${docs.length})</div>
        ${docs
          .map(
            (
              d,
            ) => `<div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:.5px solid var(--border2)">
          <div style="font-size:20px;flex-shrink:0">${this.icon(d.doc_type)}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
              <span style="font-size:12px;font-weight:600;color:var(--text)">${esc(d.title)}</span>
              ${d.doc_classification ? `<span class="tag" style="background:var(--navy4);font-size:11px">${esc(d.doc_classification)}</span>` : ""}
              <span style="font-size:11px;color:var(--text3)">${esc(d.upload_date || "")}</span>
            </div>
            ${d.ai_summary ? `<details><summary style="font-size:11px;color:var(--text3);cursor:pointer">${l === "ar" ? "🤖 ملخص ذكاء اصطناعي" : "🤖 AI Summary"}</summary><div style="font-size:11px;color:var(--text);margin-top:5px;line-height:1.6;padding:6px 0">${esc(d.ai_summary)}</div></details>` : ""}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <a href="/uploads/${esc(d.file_path)}" download="${esc(d.title)}" class="btn-ghost btn-sm" style="font-size:11px;padding:3px 7px;text-decoration:none" title="${l === "ar" ? "تنزيل" : "Download"}">⬇</a>
            <button class="btn-ghost btn-sm" style="font-size:11px;padding:3px 7px;color:var(--red)" onclick="DocLib.deleteDoc(${d.id},${meetingId})" title="${l === "ar" ? "حذف" : "Delete"}">🗑</button>
          </div>
        </div>`,
          )
          .join("")}
      </div>`;
    } catch {}
  },
  icon(type) {
    const t = (type || "").toLowerCase();
    if (t === "pdf") return "📕";
    if (t === "docx" || t === "doc") return "📘";
    if (t === "xlsx" || t === "xls") return "📗";
    if (t === "pptx" || t === "ppt") return "📙";
    return "📄";
  },
  async deleteDoc(id, meetingId) {
    const l = App.lang;
    if (
      !confirm(
        l === "ar"
          ? "حذف هذه الوثيقة نهائياً؟"
          : "Permanently delete this document?",
      )
    )
      return;
    try {
      await api(`/api/meeting-documents/${id}`, { method: "DELETE" });
      await this.loadAndRender(meetingId);
      await this.renderLibrary("doc-library-section");
      showToast(l === "ar" ? "تم حذف الوثيقة" : "Document deleted");
    } catch (err) {
      alert(err.message);
    }
  },
  async renderLibrary(containerId) {
    const container = $(containerId);
    if (!container) return;
    const l = App.lang;
    const q = container._search || "";
    const typeF = this._typeFilter || "";
    const dateF = this._dateFilter || "";
    const docTypes = [
      { v: "", ar: "جميع الأنواع", en: "All Types" },
      { v: "agenda", ar: "جدول الأعمال", en: "Agenda" },
      { v: "minutes", ar: "محضر", en: "Minutes" },
      { v: "report", ar: "تقرير", en: "Report" },
      { v: "presentation", ar: "عرض تقديمي", en: "Presentation" },
      { v: "contract", ar: "عقد", en: "Contract" },
      { v: "policy", ar: "سياسة", en: "Policy" },
      { v: "other", ar: "أخرى", en: "Other" },
    ];
    const filterBar = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:.5px solid var(--border2)">
      <select class="fi" style="height:30px;font-size:12px;padding:0 8px;min-width:130px" onchange="DocLib.setTypeFilter(this.value)">
        ${docTypes.map((t) => `<option value="${t.v}" ${t.v === typeF ? "selected" : ""}>${l === "ar" ? t.ar : t.en}</option>`).join("")}
      </select>
      <input class="fi" type="date" style="height:30px;font-size:12px;padding:0 8px" title="${l === "ar" ? "فلتر بالتاريخ" : "Filter by date"}" value="${dateF}" onchange="DocLib.setDateFilter(this.value)">
      ${(typeF || dateF) ? `<button class="btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;color:var(--text3)" onclick="DocLib._typeFilter='';DocLib._dateFilter='';DocLib.renderLibrary('doc-library-section')">${l === "ar" ? "✕ مسح الفلتر" : "✕ Clear"}</button>` : ""}
    </div>`;
    container.innerHTML = filterBar + `<div class="es" style="padding:20px 0"><div class="loading"></div></div>`;
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (typeF) params.set("type", typeF);
      const qs = params.toString();
      let docs = await api(`/api/documents/library${qs ? "?" + qs : ""}`);
      if (dateF) {
        docs = docs.filter((d) => (d.upload_date || d.meeting_date || "").substring(0, 10) >= dateF);
      }
      const grid = document.createElement("div");
      if (!docs.length) {
        grid.innerHTML = emptyStateCard({
          icon: "📎",
          titleAr: "لا توجد مستندات بعد",
          titleEn: "No documents yet",
          descAr: "استخدم زر «📎 إرفاق» في أي اجتماع لرفع ملفات PDF أو DOCX أو TXT، أو افتح المحاضر لإرفاق مستند.",
          descEn: 'Use the "📎 Attach" button on any meeting to upload PDF, DOCX, or TXT files.',
          primary: { ar: "📝 فتح المحاضر", en: "📝 Open Transcripts", onclick: "Panels.load('transcripts')" },
        });
        container.innerHTML = filterBar;
        container.appendChild(grid);
        return;
      }
      const sorted = [...docs].sort((a, b) => (DocPins.has(b.id) ? 1 : 0) - (DocPins.has(a.id) ? 1 : 0));
      grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px";
      grid.innerHTML = sorted
        .map(
          (d) => `<div class="card" style="padding:12px;position:relative${DocPins.has(d.id) ? ";border-color:var(--gold-border)" : ""}">
          <button onclick="DocPins.toggle(${d.id})" style="position:absolute;top:8px;inset-inline-end:8px;background:none;border:none;cursor:pointer;font-size:13px;color:${DocPins.has(d.id) ? "var(--gold)" : "var(--text3)"}" title="${l === "ar" ? "تثبيت" : "Pin"}" aria-label="${l === "ar" ? "تثبيت المستند" : "Pin document"}">${DocPins.has(d.id) ? "📌" : "📍"}</button>
          <div style="display:flex;align-items:flex-start;gap:9px">
            <div style="font-size:26px;flex-shrink:0">${this.icon(d.doc_type)}</div>
            <div style="flex:1;min-width:0;padding-inline-end:18px">
              <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px">${esc(d.title)}</div>
              <div style="font-size:11px;color:var(--text3);margin-bottom:5px">${esc(d.meeting_title_ar || "")} · ${esc(d.upload_date || "")}${d.doc_classification ? " · " + esc(d.doc_classification) : ""}</div>
              ${d.ai_summary ? `<div style="font-size:11px;color:var(--text2);line-height:1.5;margin-bottom:7px">${esc(d.ai_summary.slice(0, 130))}${d.ai_summary.length > 130 ? "…" : ""}</div>` : ""}
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                <a href="/uploads/${esc(d.file_path)}" download="${esc(d.title)}" class="btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;text-decoration:none" onclick="DocRecent.log(${d.id})">⬇ ${l === "ar" ? "تنزيل" : "Download"}</a>
                <button class="btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;color:var(--red)" onclick="DocLib.deleteDoc(${d.id},${d.meeting_id})">🗑</button>
              </div>
            </div>
          </div>
        </div>`,
        )
        .join("");
      container.innerHTML = filterBar;
      container.appendChild(grid);
    } catch (err) {
      container.innerHTML = filterBar + `<div style="color:var(--red);font-size:12px;padding:10px 0">${err.message}</div>`;
    }
  },
  // ── Quick access — pinned documents + recently downloaded, plus this
  // browser's Board Pack download history (Recent Reports) — all frontend
  // state, populated above the main library.
  async renderQuickAccess() {
    const el = $("doc-quick-access");
    if (!el) return;
    const l = App.lang;
    const pinnedIds = [...DocPins._load()];
    const recentIds = DocRecent.list();
    if (!pinnedIds.length && !recentIds.length && !RecentReports.list().length) {
      el.innerHTML = "";
      return;
    }
    let docs = [];
    try {
      docs = await api("/api/documents/library");
    } catch (e) {
      docs = [];
    }
    const byId = {};
    docs.forEach((d) => { byId[d.id] = d; });
    const pinned = pinnedIds.filter((id) => byId[id]).map((id) => byId[id]);
    const recent = recentIds.filter((id) => byId[id] && !pinnedIds.includes(id)).map((id) => byId[id]).slice(0, 5);
    const reports = RecentReports.list().slice(0, 5);
    const miniCard = (title, sub, onclick) => `<div class="stat-clickable" style="cursor:pointer;padding:8px 10px;background:var(--navy3);border-radius:8px;border:1px solid var(--border2);margin-bottom:6px" onclick="${onclick}">
      <div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</div>
      ${sub ? `<div style="font-size:10.5px;color:var(--text3);margin-top:2px">${esc(sub)}</div>` : ""}
    </div>`;
    const cols = [];
    if (pinned.length) {
      cols.push(`<div><div class="ct" style="margin-bottom:8px;font-size:12px">📌 ${l === "ar" ? "مستندات مثبّتة" : "Pinned Documents"}</div>${pinned.map((d) => miniCard(d.title, d.upload_date, `window.open('/uploads/${esc(d.file_path)}','_blank')`)).join("")}</div>`);
    }
    if (recent.length) {
      cols.push(`<div><div class="ct" style="margin-bottom:8px;font-size:12px">🕐 ${l === "ar" ? "فُتحت مؤخراً" : "Recently Opened"}</div>${recent.map((d) => miniCard(d.title, d.upload_date, `window.open('/uploads/${esc(d.file_path)}','_blank')`)).join("")}</div>`);
    }
    if (reports.length) {
      cols.push(`<div><div class="ct" style="margin-bottom:8px;font-size:12px">📦 ${l === "ar" ? "التقارير الأخيرة" : "Recent Reports"}</div>${reports.map((r) => miniCard(r.title, (r.ts || "").substring(0, 10), `Panels.load('history').then(()=>MeetingHistory.select(${r.meetingId}))`)).join("")}</div>`);
    }
    el.innerHTML = cols.length
      ? `<div class="card" style="margin-bottom:16px">
          <div class="grid-${Math.min(cols.length, 3)}">${cols.join("")}</div>
        </div>`
      : "";
  },
};
// ── Recently opened documents — frontend-only (localStorage).
const DocRecent = {
  key: "ameen_doc_recent",
  log(id) {
    let list = this.list().filter((x) => x !== id);
    list.unshift(id);
    try {
      localStorage.setItem(this.key, JSON.stringify(list.slice(0, 8)));
    } catch (e) {}
  },
  list() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || "[]");
    } catch (e) {
      return [];
    }
  },
};

// Six accent colours cycling through meeting attendees in the speaker bar.
const MEETING_TYPES = {
  "Board Meeting": { ar: "اجتماع مجلس الإدارة", en: "Board Meeting" },
  "Committee Meeting": { ar: "اجتماع اللجنة", en: "Committee Meeting" },
  "Executive Committee Meeting": { ar: "اجتماع اللجنة التنفيذية", en: "Executive Committee Meeting" },
  "General Assembly": { ar: "الجمعية العمومية", en: "General Assembly" },
  "Annual General Meeting": { ar: "الاجتماع العام السنوي", en: "Annual General Meeting" },
  "Extraordinary General Meeting": { ar: "الاجتماع العام غير العادي", en: "Extraordinary General Meeting" },
  "Strategy Meeting": { ar: "اجتماع الاستراتيجية", en: "Strategy Meeting" },
  "Audit Committee Meeting": { ar: "اجتماع لجنة المراجعة", en: "Audit Committee Meeting" },
  "Risk Committee Meeting": { ar: "اجتماع لجنة المخاطر", en: "Risk Committee Meeting" },
  "Nomination & Remuneration Committee Meeting": { ar: "لجنة الترشيح والمكافآت", en: "Nomination & Remuneration Committee" },
  "Management Meeting": { ar: "اجتماع الإدارة", en: "Management Meeting" },
  "Department Meeting": { ar: "اجتماع القسم", en: "Department Meeting" },
  "Project Meeting": { ar: "اجتماع المشروع", en: "Project Meeting" },
  "Follow-up Meeting": { ar: "اجتماع المتابعة", en: "Follow-up Meeting" },
  "Emergency Meeting": { ar: "اجتماع طارئ", en: "Emergency Meeting" },
  "Circular Resolution": { ar: "قرار تداولي", en: "Circular Resolution" },
  "Other": { ar: "أخرى", en: "Other" },
  // Legacy keys kept for backward compat
  "Executive Meeting": { ar: "الاجتماع التنفيذي", en: "Executive Meeting" },
  "General Meeting": { ar: "الاجتماع العام", en: "General Meeting" },
  general_assembly: { ar: "الجمعية العمومية", en: "General Assembly" },
};
const CAL_TYPE_COLORS = {
  "Board Meeting": "#5B9BD6",
  "Committee Meeting": "#2ECC8A",
  "Executive Committee Meeting": "#1A7FBD",
  "General Assembly": "#E05A5A",
  "Annual General Meeting": "#D94F4F",
  "Extraordinary General Meeting": "#C0392B",
  "Strategy Meeting": "#9B72DB",
  "Audit Committee Meeting": "#E67E22",
  "Risk Committee Meeting": "#E74C3C",
  "Nomination & Remuneration Committee Meeting": "#8E44AD",
  "Management Meeting": "#2980B9",
  "Department Meeting": "#27AE60",
  "Project Meeting": "#16A085",
  "Follow-up Meeting": "#EFA827",
  "Emergency Meeting": "#C0392B",
  "Circular Resolution": "#7F8C8D",
  "Other": "#95A5A6",
  // Legacy
  "Executive Meeting": "#D4A017",
  "General Meeting": "#9AA0A6",
  general_assembly: "#E05A5A",
};
function calTypeColor(type) {
  return CAL_TYPE_COLORS[type] || "#9AA0A6";
}
function mtLabel(type, lang) {
  const t = MEETING_TYPES[type];
  if (!t || !type) return type || "";
  return lang === "ar" ? t.ar : t.en;
}

const PLATFORM_LABELS = {
  physical:     { ar: "حضوري",        en: "In-Person"         },
  zoom:         { ar: "زووم",          en: "Zoom"              },
  teams:        { ar: "تيمز",          en: "Microsoft Teams"   },
  google_meet:  { ar: "جوجل ميت",     en: "Google Meet"       },
  hybrid:       { ar: "هجين",          en: "Hybrid"            },
  virtual:      { ar: "افتراضي",      en: "Virtual"           },
  webex:        { ar: "ويبكس",         en: "Webex"             },
  other:        { ar: "أخرى",          en: "Other"             },
};
function platLabel(platform, lang) {
  const t = PLATFORM_LABELS[platform];
  if (t) return lang === "ar" ? t.ar : t.en;
  return platform || "";
}

const SPEAKER_PALETTE = [
  { bg: "rgba(201,168,76,.13)", border: "rgba(201,168,76,.28)", fg: "#C9A84C" },
  { bg: "rgba(46,204,138,.12)", border: "rgba(46,204,138,.30)", fg: "#2ECC8A" },
  { bg: "rgba(91,155,214,.12)", border: "rgba(91,155,214,.30)", fg: "#5B9BD6" },
  { bg: "rgba(224,90,90,.12)", border: "rgba(224,90,90,.30)", fg: "#E05A5A" },
  { bg: "rgba(239,168,39,.12)", border: "rgba(239,168,39,.30)", fg: "#EFA827" },
  {
    bg: "rgba(147,112,219,.13)",
    border: "rgba(147,112,219,.30)",
    fg: "#9370DB",
  },
];

// ══ Recording ═════════════════════════════════════════════════════════════════
const Rec = {
  mediaRec: null,
  audioChunks: [],
  isRecording: false,
  startTime: null,
  timerInt: null,
  speechRec: null,
  fullTranscript: "",
  currentMeetingId: null,
  // Speaker identification state
  currentSpeaker: null,
  speakerColors: {},
  _newSpeakerTurn: false,
  // Dual-side audio capture (display/system audio for virtual meetings)
  _displayStream: null,
  _mixedRec: null,
  _mixedChunks: [],
  _dualAudioUrl: null,
  // Set by enterLiveMeeting() when the user is starting/joining a meeting that
  // already exists as a `meetings` row (created via the Create Meeting wizard
  // or already `recording` server-side) — start() then binds to this meeting
  // instead of creating a brand-new one, and preserves whatever transcript it
  // already has instead of blanking it.
  pendingMeeting: null,

  async toggle() {
    if (this.isRecording) {
      await this.stop();
    } else {
      await this.start();
    }
  },

  async start() {
    const bound = this.pendingMeeting;
    const title =
      (bound && (App.lang === "ar" ? bound.title_ar : bound.title_en || bound.title_ar)) ||
      $("mtg-title").value.trim() ||
      (App.lang === "ar" ? "اجتماع بدون عنوان" : "Untitled Meeting");
    // ── Browser compatibility guard ───────────────────────────────────────────
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert(
        App.lang === 'ar'
          ? 'يتطلب التسجيل استخدام Chrome أو Edge. يرجى تغيير المتصفح.\n\nRecording requires Chrome or Edge. Please switch browsers.'
          : 'Recording requires Chrome or Edge. Please switch browsers.\n\nيتطلب التسجيل استخدام Chrome أو Edge. يرجى تغيير المتصفح.'
      );
      return;
    }
    const meetingType = ($("mtg-type") && $("mtg-type").value) || "";
    if (bound) {
      // Already created (and already transitioned to `recording` server-side)
      // by ScheduledPanel.startMeeting()/LiveMeetingsPanel — just bind to it.
      this.currentMeetingId = bound.id;
    } else {
      try {
        const row = await api("/api/meetings", {
          method: "POST",
          body: JSON.stringify({
            title_ar: title,
            title_en: title,
            transcript: "",
            meeting_type: meetingType,
          }),
        });
        this.currentMeetingId = row.id;
        await api(`/api/meetings/${row.id}/recording/start`, {
          method: "POST",
          body: JSON.stringify({ capture_type: "browser_microphone", scope: "local_microphone_only" }),
        }).catch(() => {});
      } catch (e) {
        alert(e.message);
        return;
      }
    }

    // A bound meeting may already carry a transcript (seeded/imported content,
    // or a previous local session that was stopped and resumed) — append to it
    // rather than discarding it.
    this.fullTranscript = (bound && bound.transcript) || "";
    this._lastSavedLen = 0;
    this.isRecording = true;
    this.isPaused = false;
    $("rec-ring").classList.add("recording");
    $("rec-ic").textContent = "⏹";
    const brOn = $("b-rec");
    if (brOn) brOn.style.display = "flex";
    const pauseBtn0 = $("rec-pause-btn");
    if (pauseBtn0) { pauseBtn0.style.display = ""; pauseBtn0.innerHTML = `⏸ <span data-ar="إيقاف مؤقت" data-en="Pause">${App.lang === "ar" ? "إيقاف مؤقت" : "Pause"}</span>`; }
    $("live-tr-card").style.display = "";
    $("live-ex-card").style.display = "";
    $("ai-res-card").style.display = "none";
    $("live-tr").textContent = this.fullTranscript || "";
    $("ex-tasks").innerHTML =
      `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === "ar" ? "في انتظار الكلام..." : "Listening..."}</div>`;
    $("ex-decs").innerHTML =
      `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === "ar" ? "في انتظار الكلام..." : "Listening..."}</div>`;
    const _exR = $("ex-risks");
    if (_exR)
      _exR.innerHTML = `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === "ar" ? "في انتظار الكلام..." : "Listening..."}</div>`;
    const _exF = $("ex-followups");
    if (_exF)
      _exF.innerHTML = `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === "ar" ? "في انتظار الكلام..." : "Listening..."}</div>`;
    this._dualAudioUrl = null;
    this._mixedChunks = [];
    const stEl = $("rec-st");
    if (stEl)
      stEl.textContent =
        App.lang === "ar" ? "▶ جارٍ التسجيل" : "▶ Recording...";

    // Live editing while recording is a Pro feature.
    this.setupEditableTranscript();

    this.startTime = Date.now();
    this.timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - this.startTime) / 1000);
      const ts = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("rec-tm").textContent = ts;
      $("rec-timer-lbl").textContent = ts;
    }, 1000);

    // Live AI extraction: every ~18s send the latest transcript to the AI and
    // refresh the detected tasks (with owners) + decisions before the meeting ends.
    this._lastExtractLen = 0;
    this.liveExInt = setInterval(() => {
      this.liveExtract();
    }, 18000);

    // Crash/refresh safety: persist the transcript to the DB every ~12s while
    // recording, so the spoken record is never lost if the tab dies mid-meeting.
    // (Previously the transcript was only saved once, at stop().)
    this.saveInt = setInterval(() => {
      this.persistTranscript();
    }, 12000);

    // Reset speaker state and build the attendee bar for this session.
    this.currentSpeaker = null;
    this.speakerColors = {};
    this._newSpeakerTurn = false;
    this.buildSpeakerBar();

    this.startWaveform();
    this.startSpeechRec();
    this._startSystemAudio(); // non-blocking — captures both sides of virtual meetings
  },

  // Save the live transcript to the meeting row without ending the session.
  // Writes are serialized: only one PATCH is ever in flight, and the transcript
  // only grows, so a skipped tick is always covered by the next one. stop() awaits
  // the in-flight save before its final write, so the longest (complete) transcript
  // is guaranteed to be the last thing persisted — no stale overwrite.
  async persistTranscript() {
    if (!this.currentMeetingId) return;
    const t = (this.fullTranscript || "").trim();
    if (!t || t.length === this._lastSavedLen) return;
    if (this._saving) return; // a write is already in flight; growth covered next tick
    this._saving = true;
    const len = t.length;
    this._savePromise = (async () => {
      try {
        const dur = Math.floor((Date.now() - this.startTime) / 1000);
        await api(`/api/meetings/${this.currentMeetingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            transcript: this.fullTranscript,
            duration: dur,
          }),
        });
        this._lastSavedLen = Math.max(this._lastSavedLen, len);
      } catch (e) {
        /* transient — next tick retries */
      } finally {
        this._saving = false;
      }
    })();
    await this._savePromise;
  },

  setupEditableTranscript() {
    const box = $("live-tr");
    if (!box) return;
    if (App.isPro()) {
      box.setAttribute("contenteditable", "true");
      box.style.outline = "none";
      box.title =
        App.lang === "ar"
          ? "يمكنك التعديل أثناء التسجيل (Pro)"
          : "You can edit while recording (Pro)";
      box.oninput = () => {
        this._userEdited = true;
        this.fullTranscript = box.innerText;
      };
      this._editHint = this._editHint || true;
    } else {
      box.removeAttribute("contenteditable");
      box.oninput = null;
    }
  },

  async stop() {
    this.isRecording = false;
    this.isPaused = false;
    clearInterval(this.timerInt);
    $("rec-ring").classList.remove("recording");
    $("rec-ic").textContent = "🎙";
    const brOff = $("b-rec");
    if (brOff) brOff.style.display = "none";
    const pauseBtn1 = $("rec-pause-btn");
    if (pauseBtn1) pauseBtn1.style.display = "none";
    this.stopWaveform();
    clearInterval(this.liveExInt);
    clearInterval(this.saveInt);
    if (this.speechRec) {
      try {
        this.speechRec.stop();
      } catch (e) {}
      this.speechRec = null;
    }
    const stEl = $("rec-st");
    if (stEl)
      stEl.textContent = App.lang === "ar" ? "اضغط للبدء" : "Tap to start";
    clearInterval(this._recWatch);
    const sb = $("speaker-bar");
    if (sb) sb.style.display = "none";
    this.currentSpeaker = null;
    this._stopSystemAudio();

    // If the coordinator edited the transcript live (Pro), keep their version.
    const box = $("live-tr");
    if (App.isPro() && box && box.getAttribute("contenteditable") === "true") {
      this.fullTranscript = box.innerText;
    }

    // Wait for any in-flight periodic save to settle so our final write (which
    // holds the complete transcript) lands last — never overwritten by a stale tick.
    if (this._savePromise) {
      try {
        await this._savePromise;
      } catch (e) {}
    }

    // One final live extraction pass so nothing said near the end is missed.
    await this.liveExtract();

    if (this.currentMeetingId) {
      await api(`/api/meetings/${this.currentMeetingId}/recording/stop`, {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => {});
    }

    const finishedMeetingId = this.currentMeetingId;
    const wasBound = !!this.pendingMeeting;
    this.pendingMeeting = null;
    this._unbindTitleInputs();

    if (this.currentMeetingId && this.fullTranscript) {
      const dur = Math.floor((Date.now() - this.startTime) / 1000);
      await api(`/api/meetings/${this.currentMeetingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          transcript: this.fullTranscript,
          duration: dur,
        }),
      });
      // Finalise dual-side recording blob for download in the results panel.
      if (this._mixedChunks && this._mixedChunks.length) {
        const blob = new Blob(this._mixedChunks, { type: "audio/webm" });
        this._dualAudioUrl = URL.createObjectURL(blob);
      }
      await this.processAI();
    }

    // A meeting entered through the Create Meeting → Scheduled → Start Meeting
    // flow (or Live Meetings' Join) has a real meeting page waiting for it —
    // land there instead of leaving the coordinator on this raw capture screen.
    // Ad-hoc recordings (never bound to a pre-existing meeting) keep the
    // existing in-place results view, since there's no richer meeting-page
    // context (agenda/attendees/series) to show for those.
    // Only redirect if the user is still on the capture screen — this stop
    // chain (final save + AI processing) can take a while, and yanking them
    // away from wherever they navigated to in the meantime is hostile.
    if (wasBound && finishedMeetingId && (Panels.current === "record" || Panels.current === "live")) {
      showToast(App.lang === "ar" ? "✓ تم إيقاف التسجيل — جارٍ فتح صفحة الاجتماع" : "✓ Recording stopped — opening the meeting page");
      if (window.MT) MT.openDetail(finishedMeetingId);
    }
  },

  // Bind the title/type inputs to a pre-existing meeting: show its values and
  // disable editing there (renaming a meeting belongs in its Workspace, not
  // mid-capture — nothing reads these inputs back for a bound meeting).
  _bindTitleInputs(bound) {
    const l = App.lang;
    const titleInp = $("mtg-title");
    if (titleInp) {
      titleInp.value = (l === "ar" ? bound.title_ar : bound.title_en || bound.title_ar) || "";
      titleInp.disabled = true;
    }
    const typeInp = $("mtg-type");
    if (typeInp) {
      if (bound.meeting_type) typeInp.value = bound.meeting_type;
      typeInp.disabled = true;
    }
    const ptitle = document.querySelector("#panel-record .ptitle");
    if (ptitle) ptitle.textContent = (l === "ar" ? bound.title_ar : bound.title_en || bound.title_ar) || (l === "ar" ? "اجتماع مباشر" : "Live Meeting");
    QuickCapture.show(bound.id);
  },

  _unbindTitleInputs() {
    const titleInp = $("mtg-title");
    if (titleInp) { titleInp.disabled = false; titleInp.value = ""; }
    const typeInp = $("mtg-type");
    if (typeInp) { typeInp.disabled = false; typeInp.value = ""; }
    const ptitle = document.querySelector("#panel-record .ptitle");
    if (ptitle) ptitle.setAttribute("data-ar", "تسجيل اجتماع") || ptitle.setAttribute("data-en", "Record Meeting");
    App.applyLang(App.lang);
    QuickCapture.hide();
  },

  // Pause/Resume — a lighter-weight suspend than stop(): keeps the meeting
  // `recording` server-side and keeps fullTranscript intact, just stops the
  // browser's speech recognition + timers until resumed. ("Mute" in the Live
  // Meeting spec is the same action for this browser-speech-to-text engine —
  // there's no separate audio-output channel to mute, so one Pause/Resume
  // control covers both asks rather than adding a redundant second button.)
  isPaused: false,
  pause() {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    clearInterval(this.timerInt);
    clearInterval(this.liveExInt);
    clearInterval(this.saveInt);
    if (this.speechRec) { try { this.speechRec.stop(); } catch (e) {} }
    const stEl = $("rec-st");
    if (stEl) stEl.textContent = App.lang === "ar" ? "⏸ متوقف مؤقتاً" : "⏸ Paused";
    const pauseBtn = $("rec-pause-btn");
    if (pauseBtn) pauseBtn.innerHTML = `▶ <span data-ar="استئناف" data-en="Resume">${App.lang === "ar" ? "استئناف" : "Resume"}</span>`;
  },
  resume() {
    if (!this.isRecording || !this.isPaused) return;
    this.isPaused = false;
    this.startTime = Date.now() - this._elapsedBeforePause();
    this.timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - this.startTime) / 1000);
      const ts = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("rec-tm").textContent = ts;
      $("rec-timer-lbl").textContent = ts;
    }, 1000);
    this.liveExInt = setInterval(() => { this.liveExtract(); }, 18000);
    this.saveInt = setInterval(() => { this.persistTranscript(); }, 12000);
    this.startSpeechRec();
    const stEl = $("rec-st");
    if (stEl) stEl.textContent = App.lang === "ar" ? "▶ جارٍ التسجيل" : "▶ Recording...";
    const pauseBtn = $("rec-pause-btn");
    if (pauseBtn) pauseBtn.innerHTML = `⏸ <span data-ar="إيقاف مؤقت" data-en="Pause">${App.lang === "ar" ? "إيقاف مؤقت" : "Pause"}</span>`;
  },
  togglePause() {
    if (this.isPaused) this.resume(); else this.pause();
  },
  _elapsedBeforePause() {
    const s = $("rec-tm") ? $("rec-tm").textContent : "00:00";
    const [m, sec] = s.split(":").map(Number);
    return ((m || 0) * 60 + (sec || 0)) * 1000;
  },

  startSpeechRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      $("live-tr").textContent =
        App.lang === "ar"
          ? "المتصفح لا يدعم التعرف على الصوت — جرّب Chrome"
          : "Browser does not support speech recognition — try Chrome";
      return;
    }
    this.speechRec = new SR();
    this.speechRec.continuous = true;
    this.speechRec.interimResults = true;
    this.speechRec.lang = App.lang === "ar" ? "ar-SA" : "en-US";

    let interim = "";
    this.speechRec.onresult = (e) => {
      this._recAlive = true; // heartbeat for the watchdog
      let final = "",
        int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript + " ";
        } else {
          int += e.results[i][0].transcript;
        }
      }
      if (final) {
        // Tag the segment with the active speaker when the coordinator set one.
        if (this.currentSpeaker && this._newSpeakerTurn) {
          const sep = this.fullTranscript.length > 0 ? "\n" : "";
          this.fullTranscript +=
            sep + "[" + this.currentSpeaker + "]: " + final;
          this._newSpeakerTurn = false;
        } else {
          this.fullTranscript += final;
        }
        this.scanTranscript(final);
      }
      const box = $("live-tr");
      if (!box) return;
      // In Pro edit mode: keep raw innerText (speaker tags visible/editable).
      if (App.isPro() && box.getAttribute("contenteditable") === "true") {
        if (final && !this._userEdited) {
          box.innerText = this.fullTranscript;
        } else if (final) {
          box.innerText = box.innerText + final;
          this.fullTranscript = box.innerText;
        }
      } else {
        // Render coloured speaker blocks in normal mode.
        box.innerHTML = this.renderTranscriptHTML(int);
      }
    };

    // Recoverable errors (no-speech on a pause, transient network, aborted on
    // restart) must NOT end the session. The browser fires onend right after an
    // error, where the watchdog restart kicks in. Fatal errors (mic permission
    // denied / service blocked) are different — restarting can't fix them, so we
    // gate further restarts and tell the coordinator instead of spinning forever.
    this._recFatal = false;
    this.speechRec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this._recFatal = true;
        const box = $("live-tr");
        if (box && !box.textContent.trim())
          box.textContent =
            App.lang === "ar"
              ? "تم رفض إذن الميكروفون — فعّله من إعدادات المتصفح ثم أعد المحاولة"
              : "Microphone permission denied — enable it in your browser settings and try again";
        // Permission was revoked mid-session — surface it and stop cleanly so the
        // UI never sits in a half-recording state (button stuck on ⏹, no captions).
        showToast(
          App.lang === "ar"
            ? "تم رفض إذن الميكروفون — تم إيقاف التسجيل"
            : "Microphone permission denied — recording stopped",
          "error",
        );
        if (this.isRecording) this.stop();
      } else if (e.error !== "aborted" && e.error !== "no-speech") {
        console.warn("SR error:", e.error);
      }
    };
    // "Infinite" capture: the browser engine self-terminates after silence or
    // after long runs. As long as we're still recording, immediately restart so
    // a natural pause never cuts the meeting off.
    this.speechRec.onend = () => {
      this._restartRec();
    };
    this._recAlive = true; // heartbeat seeded so the watchdog doesn't fire instantly
    try {
      this.speechRec.start();
    } catch (e) {}

    // Watchdog: if the engine silently dies (some Chrome builds stop firing onend
    // after an error), this guarantees we come back to life within a few seconds.
    clearInterval(this._recWatch);
    this._recWatch = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(this._recWatch);
        return;
      }
      if (this._recAlive) {
        this._recAlive = false;
        return;
      } // saw activity recently
      this._restartRec();
    }, 6000);
  },

  // Guarded restart — tolerates the "recognition has already started" race that
  // Chrome throws when onend and the watchdog both fire near each other.
  _restartRec() {
    if (!this.isRecording || !this.speechRec || this._recFatal) return;
    try {
      this.speechRec.start();
    } catch (e) {
      // "already started" is benign (onend + watchdog raced). Any other error
      // gets one delayed retry — but never if we've hit a fatal state.
      if (!/already started/i.test(e.message || "")) {
        setTimeout(() => {
          if (this.isRecording && !this._recFatal) this._restartRec();
        }, 500);
      }
    }
  },

  // ── Dual-side audio capture ───────────────────────────────────────────────
  // Uses getDisplayMedia to record system/tab audio (captures all participants
  // in browser-based video calls). Stored as a local Blob — available for
  // download in the results panel. The Web Speech API continues to read the
  // physical microphone for real-time captions (browser limitation).
  async _startSystemAudio() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;
    try {
      let displayStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: false,
        });
      } catch {
        // Some browsers require video — request minimal video then stop it.
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: { width: 1, height: 1, frameRate: 1 },
        });
        displayStream.getVideoTracks().forEach((t) => t.stop());
      }
      if (!displayStream.getAudioTracks().length) {
        displayStream.getTracks().forEach((t) => t.stop());
        return;
      }
      this._displayStream = displayStream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      this._mixedRec = new MediaRecorder(displayStream, { mimeType });
      this._mixedChunks = [];
      this._mixedRec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this._mixedChunks.push(e.data);
      };
      this._mixedRec.start(5000);
      const badge = $("dual-audio-badge");
      if (badge) {
        badge.textContent =
          App.lang === "ar" ? "🎙+🔊 كلا الجانبين" : "🎙+🔊 Both sides";
        badge.style.display = "";
      }
      displayStream.getAudioTracks()[0].addEventListener("ended", () => {
        // The track ends on programmatic stop() during a normal Rec.stop (no
        // "ended" fires there) OR when the user revokes/stops the share mid-call.
        // If we're still recording, this second case means the capture broke
        // unexpectedly — tell the coordinator and reset the record button state.
        const wasRecording = this.isRecording;
        this._stopSystemAudio();
        if (wasRecording) {
          showToast(
            App.lang === "ar"
              ? "توقف التقاط صوت النظام بشكل غير متوقع — تم إيقاف التسجيل"
              : "System audio capture ended unexpectedly — recording stopped",
            "error",
          );
          this.stop();
        }
      });
    } catch (_e) {
      // User dismissed the screen-share prompt — mic-only recording continues.
    }
  },

  _stopSystemAudio() {
    if (this._mixedRec && this._mixedRec.state !== "inactive") {
      try {
        this._mixedRec.stop();
      } catch {}
    }
    if (this._displayStream) {
      this._displayStream.getTracks().forEach((t) => t.stop());
      this._displayStream = null;
    }
    const badge = $("dual-audio-badge");
    if (badge) badge.style.display = "none";
  },

  // ── Speaker identification ────────────────────────────────────────────────

  // Build the speaker bar from the current team roster (App._members).
  buildSpeakerBar() {
    const bar = $("spk-avatars");
    if (!bar) return;
    bar.innerHTML = "";
    const members = App._members || [];
    const lbl = $("spk-label");
    if (!members.length) {
      if (lbl)
        lbl.textContent =
          App.lang === "ar"
            ? "لا يوجد أعضاء فريق — أضف أعضاء لتفعيل تحديد المتحدثين"
            : "No team members — add members to enable speaker ID";
      const sb = $("speaker-bar");
      if (sb) sb.style.display = "";
      return;
    }
    if (lbl)
      lbl.textContent =
        App.lang === "ar"
          ? "👆 اضغط لتحديد المتحدث الحالي"
          : "👆 Tap to set the active speaker";
    const l = App.lang;
    // "Unknown / no speaker" button (tap to clear active speaker)
    const noneBtn = document.createElement("button");
    noneBtn.className = "spk-btn";
    noneBtn.innerHTML = `<div class="spk-av" style="background:var(--navy4);border-color:var(--border2);color:var(--text3);font-size:16px;border:2px solid var(--border2)">•</div><div class="spk-nm">—</div>`;
    noneBtn.onclick = () => this.setSpeaker(null);
    bar.appendChild(noneBtn);
    members.forEach((m) => {
      const name =
        l === "ar"
          ? m.name_ar || m.name_en || ""
          : m.name_en || m.name_ar || "";
      if (!name) return;
      const color = this.getSpeakerColor(name);
      const initials =
        name
          .split(/[\s\.]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0] || "")
          .join("")
          .toUpperCase() || "?";
      const shortName = name.split(/\s+/)[0] || name;
      const btn = document.createElement("button");
      btn.className = "spk-btn";
      btn.dataset.speaker = name;
      btn.title = name;
      btn.innerHTML = `<div class="spk-av" style="background:${color.bg};border-color:${color.border};color:${color.fg}">${esc(initials)}</div><div class="spk-nm">${esc(shortName)}</div>`;
      btn.onclick = () => this.setSpeaker(name);
      bar.appendChild(btn);
    });
    const sb = $("speaker-bar");
    if (sb) sb.style.display = "";
  },

  // Set the active speaker. Passing null clears the speaker.
  setSpeaker(name) {
    this.currentSpeaker = name || null;
    this._newSpeakerTurn = !!name; // only start a new turn if a real speaker was selected
    const bar = $("spk-avatars");
    if (!bar) return;
    bar.querySelectorAll(".spk-btn").forEach((btn) => {
      const isSel = name ? btn.dataset.speaker === name : !btn.dataset.speaker;
      btn.classList.toggle("spk-active", isSel);
    });
  },

  // Return (and lazily assign) a colour from the palette for a given speaker name.
  getSpeakerColor(name) {
    if (!name) return SPEAKER_PALETTE[0];
    if (!this.speakerColors[name]) {
      const idx =
        Object.keys(this.speakerColors).length % SPEAKER_PALETTE.length;
      this.speakerColors[name] = SPEAKER_PALETTE[idx];
    }
    return this.speakerColors[name];
  },

  // Render this.fullTranscript as coloured speaker blocks (with `interim` text
  // appended as a faint in-progress span). Falls back to plain text when no
  // [Speaker]: tags are present so old meetings display correctly.
  renderTranscriptHTML(interim) {
    const text = this.fullTranscript;
    if (!text && !interim) return "";
    // Split on [Name]: markers; capturing group interleaves name/content pairs.
    const segments = (text || "").split(/\n?\[([^\]]+)\]:\s*/);
    if (segments.length <= 1) {
      return (
        `<span style="color:var(--text);white-space:pre-wrap">${esc(text)}</span>` +
        (interim
          ? `<span style="color:var(--text3);font-style:italic"> ${esc(interim)}</span>`
          : "")
      );
    }
    let html = "";
    const preamble = (segments[0] || "").trim();
    if (preamble)
      html += `<div style="color:var(--text);font-size:12px;padding-bottom:5px;white-space:pre-wrap">${esc(preamble)}</div>`;
    for (let i = 1; i < segments.length; i += 2) {
      const speaker = (segments[i] || "").trim();
      const content = (segments[i + 1] || "").trim();
      const color = this.getSpeakerColor(speaker);
      const initials =
        speaker
          .split(/[\s\.]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0] || "")
          .join("")
          .toUpperCase() || "?";
      html +=
        `<div style="display:flex;gap:7px;align-items:flex-start;padding:5px 0;border-bottom:.5px solid var(--border2)">` +
        `<div style="width:24px;height:24px;border-radius:50%;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:${color.fg};flex-shrink:0;margin-top:2px">${esc(initials)}</div>` +
        `<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;color:${color.fg};margin-bottom:1px">${esc(speaker)}</div>` +
        `<div style="font-size:12px;color:var(--text);line-height:1.6">${esc(content)}</div></div></div>`;
    }
    if (interim)
      html += `<div style="padding:3px 0 3px 31px;color:var(--text3);font-style:italic;font-size:12px">${esc(interim)}</div>`;
    return html;
  },

  scanTranscript(text) {
    const t = text.toLowerCase();
    const taskKw = [
      "يجب",
      "سيتولى",
      "مسؤول",
      "مطلوب",
      "بحلول",
      "موعد",
      "task",
      "action",
      "responsible",
      "deadline",
      "must",
      "will do",
      "follow up",
    ];
    const decKw = [
      "قررنا",
      "اعتمدنا",
      "موافقة",
      "نوافق",
      "decided",
      "approved",
      "agreed",
      "resolution",
    ];
    if (taskKw.some((k) => t.includes(k)))
      this.addExtracted("tasks", text.trim());
    if (decKw.some((k) => t.includes(k)))
      this.addExtracted("decs", text.trim());
  },

  addExtracted(type, text) {
    const el = $(`ex-${type}`);
    if (!el) return;
    const existing = el.querySelectorAll(".ex-item");
    if (existing.length === 0) el.innerHTML = "";
    const d = document.createElement("div");
    d.className = "ex-item";
    d.style.cssText =
      "font-size:11px;padding:4px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start";
    d.innerHTML = `<span style="color:var(--gold);flex-shrink:0">${type === "tasks" ? "✅" : "⚖️"}</span><span>${esc(text.substring(0, 120))}${text.length > 120 ? "…" : ""}</span>`;
    el.appendChild(d);
  },

  // AI-powered live extraction of tasks (with owners) + decisions, refreshed
  // periodically while recording so the coordinator sees them before the meeting ends.
  async liveExtract() {
    const transcript = (this.fullTranscript || "").trim();
    if (transcript.length < 15) return;
    if (this._extracting) return;
    if (transcript.length === this._lastExtractLen) return;
    this._extracting = true;
    this._lastExtractLen = transcript.length;
    try {
      const members = (App._members || []).map((m) =>
        App.lang === "ar" ? m.name_ar : m.name_en || m.name_ar,
      );
      const r = await api("/api/live-extract", {
        method: "POST",
        body: JSON.stringify({ transcript, members }),
      });
      const l = App.lang;
      const tEl = $("ex-tasks"),
        dEl = $("ex-decs");
      if (tEl) {
        const tasks = r.tasks || [];
        tEl.innerHTML = tasks.length
          ? tasks
              .map((t) => {
                const txt = l === "ar" ? t.text_ar : t.text_en || t.text_ar;
                const own =
                  l === "ar"
                    ? t.owner_ar || ""
                    : t.owner_en || t.owner_ar || "";
                return `<div class="ex-item" style="font-size:11px;padding:5px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start">
            <span style="color:var(--gold);flex-shrink:0">✅</span>
            <span style="flex:1">${esc(txt || "")}${own ? ` <span class="tag tgold" style="font-size:10.5px">${esc(own)}</span>` : ""}</span></div>`;
              })
              .join("")
          : `<div style="font-size:11px;color:var(--text3);font-style:italic">${l === "ar" ? "لم تُكتشف مهام بعد..." : "No tasks detected yet..."}</div>`;
      }
      if (dEl) {
        const decs = r.decisions || [];
        dEl.innerHTML = decs.length
          ? decs
              .map((d) => {
                const txt = l === "ar" ? d.text_ar : d.text_en || d.text_ar;
                return `<div class="ex-item" style="font-size:11px;padding:5px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start">
            <span style="color:var(--gold);flex-shrink:0">⚖️</span><span>${esc(txt || "")}</span></div>`;
              })
              .join("")
          : `<div style="font-size:11px;color:var(--text3);font-style:italic">${l === "ar" ? "لم تُكتشف قرارات بعد..." : "No decisions detected yet..."}</div>`;
      }
      const rEl = $("ex-risks");
      if (rEl) {
        const risks = r.risks || [];
        rEl.innerHTML = risks.length
          ? risks
              .map((rk) => {
                const txt = l === "ar" ? rk.text_ar : rk.text_en || rk.text_ar;
                const icon =
                  rk.severity === "high"
                    ? "🔴"
                    : rk.severity === "medium"
                      ? "🟡"
                      : "🟢";
                return `<div class="ex-item" style="font-size:11px;padding:5px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start">
            <span style="flex-shrink:0">${icon}</span><span>${esc(txt || "")}</span></div>`;
              })
              .join("")
          : `<div style="font-size:11px;color:var(--text3);font-style:italic">${l === "ar" ? "لم تُكتشف مخاطر بعد..." : "No risks detected yet..."}</div>`;
      }
      const fuEl = $("ex-followups");
      if (fuEl) {
        const fus = r.followups || [];
        fuEl.innerHTML = fus.length
          ? fus
              .map((f) => {
                const txt = l === "ar" ? f.text_ar : f.text_en || f.text_ar;
                return `<div class="ex-item" style="font-size:11px;padding:5px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start">
            <span style="color:var(--amber,#f4a300);flex-shrink:0">📌</span><span>${esc(txt || "")}</span></div>`;
              })
              .join("")
          : `<div style="font-size:11px;color:var(--text3);font-style:italic">${l === "ar" ? "لم تُكتشف متابعات بعد..." : "No follow-ups detected yet..."}</div>`;
      }
    } catch (e) {
      /* keyword fallback already shown */
    }
    this._extracting = false;
  },

  startWaveform() {
    let t = 0;
    this._wfInt = setInterval(() => {
      t++;
      for (let i = 0; i < 16; i++) {
        const b = $(`w${i}`);
        if (b) {
          const h = this.isRecording
            ? Math.max(
                4,
                Math.abs(Math.sin(t * 0.3 + i * 0.7)) * 28 + Math.random() * 8,
              )
            : 4;
          b.style.height = h + "px";
        }
      }
    }, 80);
  },

  stopWaveform() {
    clearInterval(this._wfInt);
    for (let i = 0; i < 16; i++) {
      const b = $(`w${i}`);
      if (b) b.style.height = "4px";
    }
  },

  async saveOnly() {
    if (!this.currentMeetingId) return;
    if (this.fullTranscript) {
      try {
        await api(`/api/meetings/${this.currentMeetingId}`, {
          method: "PATCH",
          body: JSON.stringify({ transcript: this.fullTranscript }),
        });
      } catch (e) {
        showToast(
          (App.lang === "ar" ? "تعذّر الحفظ: " : "Could not save: ") + e.message,
          "error",
        );
        return;
      }
    }
    showToast(App.lang === "ar" ? "تم الحفظ" : "Saved");
    Panels.load("transcripts");
  },

  async processAI() {
    if (!this.currentMeetingId) return;
    const btn = $("ai-proc-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === "ar" ? "أمين يحلل الاجتماع..." : "Ameen is analysing..."}`;

    try {
      const r = await api(`/api/meetings/${this.currentMeetingId}/process`, {
        method: "POST",
      });
      if (r.result && r.result.title_ar) {
        const ti = $("mtg-title");
        if (ti)
          ti.value =
            App.lang === "ar"
              ? r.result.title_ar
              : r.result.title_en || r.result.title_ar;
      }
      $("ai-res-card").style.display = "";
      $("ai-res-body").innerHTML = this.renderResult(r.result);
      const execContainer = $(`exec-actions-${this.currentMeetingId}`);
      if (execContainer) ExecutiveActions.renderAssignmentSection(execContainer, this.currentMeetingId);
      await loadBadges();
    } catch (e) {
      $("ai-res-card").style.display = "";
      $("ai-res-body").innerHTML = `<span style="color:var(--danger,#e05a5a)">⚠ ${e.message}</span>`;
      // Keep transcript safe — show retry guidance
      showToast(
        App.lang === 'ar'
          ? '⚠ فشل المعالجة بالذكاء الاصطناعي — المحادثة محفوظة. يمكنك إعادة المحاولة من قسم المحاضر.'
          : '⚠ AI processing failed — transcript is saved. Retry from the Transcripts view.',
        'warning'
      );
    }

    btn.disabled = false;
    btn.innerHTML = `✦ <span>${App.lang === "ar" ? "استخراج المهام والمحضر" : "Extract Tasks & Minutes"}</span>`;
  },

  renderResult(r) {
    const l = App.lang;
    const lbl = (ar, en) => (l === "ar" ? ar : en);

    // Summary section
    const summary = `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:6px">📋 ${lbl("ملخص الاجتماع", "Meeting Summary")}</div>
        <div style="font-size:13px;color:var(--text);line-height:1.7">${esc(l === "ar" ? r.summary_ar : r.summary_en)}</div>
        ${(r.key_topics_ar && r.key_topics_ar.length) ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">${(l === "ar" ? r.key_topics_ar : r.key_topics_en || r.key_topics_ar).map((t) => `<span class="tag" style="background:var(--gold-dim);color:var(--gold)">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>`;

    // Speaker-attributed transcript (Gemini-in-Meet style)
    const speakerTr = r.speaker_transcript || [];
    const speakersHtml = speakerTr.length
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:10px">🗣️ ${lbl("النص حسب المتحدث", "Transcript by Speaker")}</div>
        ${speakerTr
          .map(
            (s) => `
          <div style="display:flex;gap:8px;padding:7px 0;border-bottom:.5px solid var(--border2);align-items:flex-start">
            <div style="width:26px;height:26px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(
              String(s.speaker || "?")
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join(""),
            )}</div>
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700;color:var(--gold)">${esc(s.speaker || lbl("متحدث", "Speaker"))}</div>
              <div style="font-size:12px;color:var(--text);line-height:1.6">${esc(l === "ar" ? s.text_ar || s.text_en || "" : s.text_en || s.text_ar || "")}</div>
            </div>
          </div>`,
          )
          .join("")}
      </div>`
      : "";

    // Formal minutes — structured document straight from the just-completed
    // processing call (minutes_ar_doc/minutes_en_doc), rendered with the same
    // section-by-section renderer used everywhere else in the app.
    const minutesDoc = l === "ar" ? r.minutes_ar_doc : r.minutes_en_doc;
    const minutesHtml = minutesDoc
      ? `
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">📄 ${lbl("محضر الاجتماع الرسمي", "Official Meeting Minutes")}</div>
        ${renderMinutesDoc(JSON.stringify(minutesDoc), l)}
      </div>`
      : "";

    // Group tasks by owner
    const tasks = r.tasks || [];
    let tasksByOwner = {};
    tasks.forEach((t) => {
      const owner =
        l === "ar"
          ? t.owner_ar || lbl("غير محدد", "Unassigned")
          : t.owner_en || t.owner_ar || "Unassigned";
      if (!tasksByOwner[owner]) tasksByOwner[owner] = [];
      tasksByOwner[owner].push(t);
    });

    const tasksHtml = tasks.length
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:10px">✅ ${lbl("المهام المستخرجة بحسب المسؤول", "Extracted Tasks by Owner")} (${tasks.length})</div>
        ${Object.entries(tasksByOwner)
          .map(
            ([owner, ownerTasks]) => `
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <div style="width:28px;height:28px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(
                owner
                  .split(" ")
                  .slice(0, 1)
                  .map((w) => w[0])
                  .join(""),
              )}</div>
              <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(owner)}</div>
              <span class="tag" style="background:var(--navy4);font-size:11px">${ownerTasks.length} ${lbl("مهمة", "task")}</span>
            </div>
            ${ownerTasks
              .map(
                (t) => `
              <div style="display:flex;gap:8px;padding:7px 0 7px 12px;border-bottom:.5px solid var(--border2);align-items:flex-start">
                <div style="width:5px;height:5px;border-radius:50%;background:${t.priority === "urgent" ? "var(--red)" : "var(--gold)"};margin-top:5px;flex-shrink:0"></div>
                <div style="flex:1;font-size:12px;color:var(--text);line-height:1.6">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</div>
                ${t.priority === "urgent" ? `<span class="tag tr" style="font-size:11px">${lbl("عاجل", "Urgent")}</span>` : ""}
                ${t.due ? `<span class="tag" style="background:var(--navy4);font-size:11px">${esc(t.due)}</span>` : ""}
              </div>`,
              )
              .join("")}
          </div>`,
          )
          .join("")}
      </div>`
      : "";

    // Executive Action Assignment — editable table populated separately (needs
    // a live API call for the real persisted task rows + team member list;
    // renderResult() itself stays synchronous). See processAI() below, which
    // calls ExecutiveActions.renderAssignmentSection() right after this HTML
    // is inserted into the DOM.
    const execActionsHtml = tasks.length && Rec.currentMeetingId
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--gold-border)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:2px">🎯 ${lbl("إدارة إجراءات التنفيذ", "Executive Action Management")}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px">${lbl("راجع مهام الذكاء الاصطناعي ثم عيّن المسؤول، القسم، الأولوية، الحالة والتقدم لكل إجراء معتمد", "Review the AI's tasks, then assign owner, department, priority, status, and progress for each approved action")}</div>
        <div id="exec-actions-${Rec.currentMeetingId}"><div class="es" style="padding:16px 0"><div class="loading"></div></div></div>
      </div>`
      : "";

    // Decisions
    const decisions = r.decisions || [];
    const decsHtml = decisions.length
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">⚖️ ${lbl("القرارات", "Decisions")} (${decisions.length})</div>
        ${decisions
          .map(
            (d) => `
          <div style="display:flex;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)">
            <span style="color:var(--green)">✓</span>
            ${esc(l === "ar" ? d.text_ar : d.text_en || d.text_ar)}
          </div>`,
          )
          .join("")}
      </div>`
      : "";

    // Follow-ups
    const followups = r.followups || [];
    const fuHtml = followups.length
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">📌 ${lbl("نقاط المتابعة", "Follow-up Points")}</div>
        ${followups
          .map(
            (f) => `
          <div style="display:flex;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)">
            <span style="color:var(--amber)">→</span>
            ${esc(l === "ar" ? f.text_ar : f.text_en || f.text_ar)}
          </div>`,
          )
          .join("")}
      </div>`
      : "";

    // Identified Risks
    const risks = r.risks || [];
    const risksHtml = risks.length
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid rgba(220,50,50,.18)">
        <div style="font-size:12px;font-weight:700;color:#e05252;margin-bottom:8px">⚠️ ${lbl("المخاطر المُكتشفة", "Identified Risks")} (${risks.length})</div>
        ${risks
          .map((rk) => {
            const sevColor =
              rk.severity === "high"
                ? "#e05252"
                : rk.severity === "medium"
                  ? "#f4a300"
                  : "var(--text3)";
            const sevIcon =
              rk.severity === "high"
                ? "🔴"
                : rk.severity === "medium"
                  ? "🟡"
                  : "🟢";
            const sevLbl =
              rk.severity === "high"
                ? lbl("عالية", "High")
                : rk.severity === "medium"
                  ? lbl("متوسطة", "Medium")
                  : lbl("منخفضة", "Low");
            const text = l === "ar" ? rk.text_ar : rk.text_en || rk.text_ar;
            const mit =
              l === "ar"
                ? rk.mitigation_ar || ""
                : rk.mitigation_en || rk.mitigation_ar || "";
            return `<div style="padding:7px 0;border-bottom:.5px solid var(--border2)">
            <div style="display:flex;gap:7px;align-items:flex-start">
              <span style="font-size:13px;flex-shrink:0;margin-top:1px">${sevIcon}</span>
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                  <span style="font-size:12px;color:var(--text)">${esc(text || "")}</span>
                  <span class="tag" style="font-size:11px;background:${sevColor}22;color:${sevColor}">${sevLbl}</span>
                </div>
                ${mit ? `<div style="font-size:11px;color:var(--text3);margin-top:3px;padding-inline-start:2px">→ ${esc(mit)}</div>` : ""}
              </div>
            </div>
          </div>`;
          })
          .join("")}
      </div>`
      : "";

    // Task-tracker connection banner — the natural next step right after
    // processing is to review and approve what the AI extracted (see the
    // Pending Review queue in renderTasks()), not to land on the generic
    // board with no orientation. Every task created here starts life with
    // review_status='pending' (pipeline.js), so as long as any were created,
    // link straight into that filter instead of the plain task list.
    const nextStepLabel = tasks.length
      ? lbl("مراجعة واعتماد الإجراءات", "Review & Approve Actions")
      : lbl("عرض المهام", "View Tasks");
    const nextStepOnclick = tasks.length
      ? "Panels.load('tasks').then(()=>TaskFilters.setQuick('review'))"
      : "Panels.load('tasks')";
    const tracker = `
      <div style="background:rgba(46,204,138,.07);border:1px solid rgba(46,204,138,.18);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <span style="font-size:18px">✅</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#2ecc8a">${lbl("متتبع المهام المدمج", "Built-in Task Tracker")}</div>
          <div style="font-size:11px;color:var(--text3)">${tasks.length} ${lbl("مهمة أُضيفت تلقائياً", "tasks added automatically")} · ${decisions.length} ${lbl("قرار", "decisions")} · ${risks.length} ${lbl("مخاطر مُكتشفة", "risks identified")}</div>
        </div>
        <button class="btn-gold btn-sm" onclick="${nextStepOnclick}" style="font-size:11px">${nextStepLabel} →</button>
      </div>`;

    // Dual-side recording download (only when display audio was captured)
    const _recMid = Rec.currentMeetingId;
    const dualAudio = Rec._dualAudioUrl
      ? `
      <div style="background:rgba(91,155,214,.07);border:1px solid rgba(91,155,214,.18);border-radius:8px;padding:9px 13px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>🎙+🔊</span>
        <div style="flex:1;font-size:12px;color:var(--text2)">${lbl("تم تسجيل كلا الجانبين — الصوت الكامل للاجتماع متاح للتنزيل", "Both sides recorded — complete meeting audio available for download")}</div>
        <a href="${Rec._dualAudioUrl}" download="meeting-recording-${Date.now()}.webm" class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">⬇ ${lbl("تنزيل التسجيل", "Download Recording")}</a>
        ${_recMid ? `<button id="rec-save-btn" class="btn-ghost btn-sm" style="font-size:11px;color:var(--gold);border-color:var(--gold)" onclick="RecStore.upload(${_recMid}, '${Rec._dualAudioUrl}')">☁ ${lbl("حفظ في المنصة", "Save to Platform")}</button>` : ""}
      </div>`
      : "";

    const mid = Rec.currentMeetingId;
    const shareBtn = mid
      ? `<button class="btn-gold btn-sm" onclick="Share.open(${mid})">📤 ${lbl("مشاركة النتائج", "Share Outcomes")}${App.isPro() ? "" : " ⭐"}</button>`
      : "";
    const actions = `
      <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap">
        <button class="btn-ghost btn-sm" onclick="Panels.load('tasks')">📋 ${lbl("عرض المهام", "View Tasks")}</button>
        <button class="btn-ghost btn-sm" onclick="Panels.load('transcripts')">📝 ${lbl("المحاضر", "Transcripts")}</button>
        ${shareBtn}
      </div>`;

    return (
      dualAudio +
      tracker +
      summary +
      speakersHtml +
      minutesHtml +
      tasksHtml +
      execActionsHtml +
      decsHtml +
      risksHtml +
      fuHtml +
      actions
    );
  },
};

// ══ Quick Capture — Live Meeting Quick Actions (Add Note/Decision/Action/Poll) ═
// Manual capture during a live meeting, shown only when the recording is bound
// to a pre-existing meeting (see Rec._bindTitleInputs). Note/Decision/Action
// each persist via a real endpoint; Poll is a lightweight, in-session-only
// straw-poll widget (no realtime multi-user infra exists to back a persisted
// poll, so this is deliberately local to the facilitator's browser).
const QuickCapture = {
  meetingId: null,
  type: "note",
  feed: [],
  polls: [],

  show(meetingId) {
    this.meetingId = meetingId;
    this.feed = [];
    this.polls = [];
    const card = $("quick-capture-card");
    if (card) card.style.display = "";
    this.setType("note");
    this.renderFeed();
  },
  hide() {
    this.meetingId = null;
    const card = $("quick-capture-card");
    if (card) card.style.display = "none";
  },

  setType(t) {
    this.type = t;
    document.querySelectorAll("#qc-type-seg .imp-seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.val === t));
    $("qc-form-note-decision-action").style.display = t === "poll" ? "none" : "";
    $("qc-form-poll").style.display = t === "poll" ? "" : "none";
  },

  async submit() {
    if (!this.meetingId) return;
    const l = App.lang;
    const input = $("qc-input");
    const text = (input && input.value || "").trim();
    if (!text) return;
    const btn = event && event.target && event.target.closest ? event.target.closest("button") : null;
    if (btn) btn.disabled = true;
    try {
      if (this.type === "note") {
        const note = await api(`/api/meetings/${this.meetingId}/notes`, { method: "POST", body: JSON.stringify({ text }) });
        this.feed.unshift({ kind: "note", text: note.text, at: note.at });
      } else if (this.type === "decision") {
        await api("/api/decisions", { method: "POST", body: JSON.stringify({ text_ar: text, text_en: text, meeting_id: this.meetingId }) });
        this.feed.unshift({ kind: "decision", text, at: new Date().toISOString() });
      } else if (this.type === "action") {
        await api("/api/tasks", { method: "POST", body: JSON.stringify({ text_ar: text, text_en: text, source_meeting_id: this.meetingId }) });
        this.feed.unshift({ kind: "action", text, at: new Date().toISOString() });
      }
      if (input) input.value = "";
      this.renderFeed();
    } catch (e) {
      showToast((l === "ar" ? "تعذّر الإضافة: " : "Could not add: ") + e.message, "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  addPollOption() {
    const box = $("qc-poll-options");
    if (!box) return;
    const n = box.querySelectorAll("input").length;
    if (n >= 4) return;
    const l = App.lang;
    const inp = document.createElement("input");
    inp.className = "fi";
    inp.id = `qc-poll-opt-${n}`;
    inp.placeholder = l === "ar" ? `خيار ${n + 1}` : `Option ${n + 1}`;
    inp.style.marginBottom = "6px";
    box.appendChild(inp);
  },

  startPoll() {
    const l = App.lang;
    const question = (($("qc-poll-question") || {}).value || "").trim();
    if (!question) { showToast(l === "ar" ? "الرجاء إدخال سؤال الاستطلاع" : "Please enter a poll question", "error"); return; }
    const options = Array.from(document.querySelectorAll("#qc-poll-options input"))
      .map((i) => i.value.trim())
      .filter(Boolean);
    if (options.length < 2) { showToast(l === "ar" ? "أدخل خيارين على الأقل" : "Enter at least two options", "error"); return; }
    this.polls.unshift({ question, options: options.map((o) => ({ label: o, votes: 0 })) });
    $("qc-poll-question").value = "";
    document.querySelectorAll("#qc-poll-options input").forEach((i) => (i.value = ""));
    this.renderFeed();
  },

  vote(pollIdx, optIdx) {
    const poll = this.polls[pollIdx];
    if (!poll) return;
    poll.options[optIdx].votes++;
    this.renderFeed();
  },

  renderFeed() {
    const l = App.lang;
    const box = $("qc-feed");
    if (!box) return;
    const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString(l === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
    const icon = { note: "📝", decision: "⚖️", action: "🎯" };
    const feedHtml = this.feed.map((f) => `
      <div style="display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:6px 8px;background:var(--navy3);border-radius:8px">
        <span>${icon[f.kind]}</span>
        <span style="flex:1;color:var(--text)">${esc(f.text)}</span>
        <span style="color:var(--text3);font-size:10px">${fmtTime(f.at)}</span>
      </div>`).join("");
    const pollsHtml = this.polls.map((p, pi) => {
      const total = p.options.reduce((s, o) => s + o.votes, 0) || 1;
      return `<div style="padding:10px;background:var(--navy3);border-radius:8px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:6px">📊 ${esc(p.question)}</div>
        ${p.options.map((o, oi) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;cursor:pointer" onclick="QuickCapture.vote(${pi},${oi})">
            <div style="flex:1;position:relative;background:var(--navy4);border-radius:6px;overflow:hidden;height:22px">
              <div style="position:absolute;inset-inline-start:0;top:0;bottom:0;background:var(--gold-dim);width:${Math.round((o.votes / total) * 100)}%"></div>
              <div style="position:relative;font-size:11px;padding:3px 8px;color:var(--text)">${esc(o.label)}</div>
            </div>
            <span style="font-size:11px;color:var(--text3);min-width:24px;text-align:end">${o.votes}</span>
          </div>`).join("")}
      </div>`;
    }).join("");
    box.innerHTML = pollsHtml + feedHtml || (this.meetingId ? "" : "");
  },
};

// ══ Executive Action Management ═══════════════════════════════════════════════
// Shown right after AI processing (live recording and Import Meeting Content
// both call this same renderer — no duplicated markup). Two stages:
//   1. AI Task Review — every freshly-extracted task (review_status='pending')
//      with a confidence badge; Edit/Delete/Merge/Split/Approve/Reject before
//      it becomes an Executive Action. Builds trust in the AI output.
//   2. Action Table — approved tasks, fully editable (owner/department/due
//      date/priority/status/progress/notes), PATCHing the real persisted
//      `tasks` rows via the existing /api/tasks/:id endpoint.
// Manually-created tasks skip stage 1 entirely (review_status defaults to
// 'approved' server-side), so this never gates the existing Task Tracker.
const ExecutiveActions = {
  async renderAssignmentSection(containerEl, meetingId) {
    if (!containerEl) return;
    const l = App.lang;
    try {
      const [tasks, members] = await Promise.all([
        api(`/api/tasks?meeting_id=${meetingId}`),
        api("/api/members"),
      ]);
      App._members = members;
      if (!tasks.length) {
        containerEl.innerHTML = `<div class="hist-empty-row">${l === "ar" ? "لم يتم استخراج أي مهام من هذا الاجتماع" : "No tasks were extracted from this meeting"}</div>`;
        return;
      }
      this._meetingId = meetingId;
      this._containerEl = containerEl;
      this._members = members;
      this._render(tasks, members, l);
    } catch (e) {
      containerEl.innerHTML = `<div class="hist-empty-row" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },

  async _refresh() {
    if (!this._containerEl || !this._meetingId) return;
    try {
      const tasks = await api(`/api/tasks?meeting_id=${this._meetingId}`);
      this._render(tasks, this._members, App.lang);
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  _render(tasks, members, l) {
    const pending = tasks.filter((t) => t.review_status === "pending");
    const approved = tasks.filter((t) => t.review_status !== "pending" && t.review_status !== "rejected");
    const reviewHtml = pending.length ? this._reviewHtml(pending, l) : "";
    const tableHtml = approved.length
      ? this._tableHtml(approved, members, l)
      : `<div class="hist-empty-row">${l === "ar" ? "لا توجد إجراءات معتمدة بعد — اعتمد المهام أعلاه أولاً" : "No approved actions yet — approve the tasks above first"}</div>`;
    this._containerEl.innerHTML =
      (pending.length
        ? `<div class="exec-review-heading">🔍 ${l === "ar" ? "مراجعة مهام الذكاء الاصطناعي" : "AI Task Review"} <span class="tag" style="background:var(--navy4)">${pending.length}</span></div>${reviewHtml}<div class="exec-section-divider"></div>`
        : "") +
      `<div class="exec-review-heading">🎯 ${l === "ar" ? "جدول الإجراءات" : "Action Table"}</div>${tableHtml}`;
  },

  _confidenceBadge(confidence, l) {
    if (!confidence || !AI_CONFIDENCE_META[confidence]) return "";
    const c = AI_CONFIDENCE_META[confidence];
    return `<span class="tag" style="background:${c.bg};color:${c.c};font-size:11px">${l === "ar" ? c.ar : c.en}</span>`;
  },

  _reviewHtml(pending, l) {
    return `<div class="exec-review-list">
      ${pending
        .map(
          (t) => `<div class="exec-review-card" id="exec-review-${t.id}">
        <div class="exec-review-text" id="exec-review-text-${t.id}">${esc(l === "ar" ? t.text_ar || t.text_en : t.text_en || t.text_ar)}</div>
        <div class="exec-review-meta">
          ${this._confidenceBadge(t.ai_confidence, l)}
          ${t.owner_ar || t.owner_name_ar ? `<span class="tag tgold" style="font-size:11px">👤 ${esc(l === "ar" ? t.owner_name_ar || t.owner_ar : t.owner_name_en || t.owner_en)}</span>` : ""}
          ${t.due_date ? `<span class="tag" style="background:var(--navy4);font-size:11px">📅 ${esc(t.due_date)}</span>` : ""}
        </div>
        <div class="exec-review-actions">
          <button class="btn-ghost btn-sm" onclick="ExecutiveActions.editReview(${t.id})">✏️ ${l === "ar" ? "تعديل" : "Edit"}</button>
          <button class="btn-ghost btn-sm" onclick="ExecutiveActions.split(${t.id})">✂ ${l === "ar" ? "تقسيم" : "Split"}</button>
          ${pending.length > 1
            ? `<select class="fi exec-merge-target" id="exec-merge-${t.id}" style="width:auto;min-width:110px">
                <option value="">${l === "ar" ? "دمج مع..." : "Merge with..."}</option>
                ${pending.filter((o) => o.id !== t.id).map((o) => `<option value="${o.id}">${esc((l === "ar" ? o.text_ar || o.text_en : o.text_en || o.text_ar).substring(0, 30))}</option>`).join("")}
              </select>
              <button class="btn-ghost btn-sm" onclick="ExecutiveActions.merge(${t.id})">🔀 ${l === "ar" ? "دمج" : "Merge"}</button>`
            : ""}
          <button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick="ExecutiveActions.reject(${t.id})">✕ ${l === "ar" ? "رفض" : "Reject"}</button>
          <button class="btn-gold btn-sm" onclick="ExecutiveActions.approve(${t.id})">✓ ${l === "ar" ? "اعتماد" : "Approve"}</button>
        </div>
      </div>`,
        )
        .join("")}
    </div>`;
  },

  editReview(taskId) {
    const l = App.lang;
    const el = document.getElementById(`exec-review-text-${taskId}`);
    if (!el || el.querySelector("textarea")) return;
    const current = el.textContent;
    el.innerHTML = `<textarea class="fi exec-review-edit-input" rows="2">${esc(current)}</textarea>
      <button class="btn-gold btn-sm" style="margin-top:6px" onclick="ExecutiveActions.saveReviewEdit(${taskId})">${l === "ar" ? "حفظ" : "Save"}</button>`;
  },

  async saveReviewEdit(taskId) {
    const el = document.getElementById(`exec-review-text-${taskId}`);
    const ta = el && el.querySelector("textarea");
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ text_ar: text, text_en: text }) });
      await this._refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  async approve(taskId) {
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ review_status: "approved" }) });
      await this._refresh();
      await loadBadges();
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  async reject(taskId) {
    const l = App.lang;
    if (!confirm(l === "ar" ? "رفض هذه المهمة المقترحة من الذكاء الاصطناعي؟" : "Reject this AI-suggested task?")) return;
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ review_status: "rejected", status: "cancelled" }) });
      await this._refresh();
      await loadBadges();
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  async merge(taskId) {
    const l = App.lang;
    const sel = document.getElementById(`exec-merge-${taskId}`);
    const targetId = sel && sel.value;
    if (!targetId) {
      showToast(l === "ar" ? "اختر مهمة للدمج معها" : "Choose a task to merge with", "error");
      return;
    }
    try {
      const tasks = await api(`/api/tasks?meeting_id=${this._meetingId}`);
      const a = tasks.find((t) => t.id === taskId);
      const b = tasks.find((t) => String(t.id) === String(targetId));
      if (!a || !b) return;
      await api(`/api/tasks/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ text_ar: `${a.text_ar} — ${b.text_ar}`, text_en: `${a.text_en || a.text_ar} — ${b.text_en || b.text_ar}` }),
      });
      await api(`/api/tasks/${b.id}`, { method: "DELETE" });
      showToast(l === "ar" ? "✓ تم دمج المهمتين" : "✓ Tasks merged", "success");
      await this._refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  async split(taskId) {
    const l = App.lang;
    const text = prompt(l === "ar" ? "أدخل نص المهمة الجديدة الناتجة عن التقسيم:" : "Enter the text for the new split-off task:");
    if (!text || !text.trim()) return;
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          text_ar: text.trim(), text_en: text.trim(),
          source_meeting_id: this._meetingId,
          review_status: "pending",
        }),
      });
      showToast(l === "ar" ? "✓ تم إنشاء مهمة جديدة من التقسيم" : "✓ New task created from split", "success");
      await this._refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  _tableHtml(tasks, members, l) {
    const deptOf = (ownerId) => {
      const m = members.find((mm) => String(mm.id) === String(ownerId));
      return (m && m.department) || "";
    };
    const ownerOptions = (selectedId) =>
      `<option value="">${l === "ar" ? "-- غير مسند --" : "-- Unassigned --"}</option>` +
      members.map((m) => `<option value="${m.id}" ${String(selectedId) === String(m.id) ? "selected" : ""}>${esc(l === "ar" ? m.name_ar : m.name_en || m.name_ar)}</option>`).join("");
    const statusOptions = (current) =>
      TASK_ASSIGNABLE_STATUSES.concat(current === "overdue" ? ["overdue"] : [])
        .map((k) => `<option value="${k}" ${taskStatusKey(current) === k ? "selected" : ""}>${l === "ar" ? TASK_STATUS_META[k].ar : TASK_STATUS_META[k].en}</option>`)
        .join("");
    const priorityOptions = (current) =>
      TASK_ASSIGNABLE_PRIORITIES.map((k) => `<option value="${k}" ${taskPriorityKey(current) === k ? "selected" : ""}>${l === "ar" ? TASK_PRIORITY_META[k].ar : TASK_PRIORITY_META[k].en}</option>`).join("");
    const progressOptions = (current) =>
      PROGRESS_STEPS.map((p) => `<option value="${p}" ${Number(current || 0) === p ? "selected" : ""}>${p}%</option>`).join("");

    return `<div class="exec-actions-table-wrap">
      <table class="exec-actions-table">
        <thead><tr>
          <th>${l === "ar" ? "الإجراء" : "Action"}</th>
          <th>${l === "ar" ? "المسؤول" : "Owner"}</th>
          <th>${l === "ar" ? "القسم" : "Department"}</th>
          <th>${l === "ar" ? "تاريخ الاستحقاق" : "Due Date"}</th>
          <th>${l === "ar" ? "الأولوية" : "Priority"}</th>
          <th>${l === "ar" ? "الحالة" : "Status"}</th>
          <th>${l === "ar" ? "التقدم" : "Progress"}</th>
          <th>${l === "ar" ? "ملاحظات" : "Notes"}</th>
          <th>${l === "ar" ? "آخر تحديث" : "Last Updated"}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${tasks
            .map(
              (t) => `<tr id="exec-act-row-${t.id}">
            <td>${esc(l === "ar" ? t.text_ar || t.text_en : t.text_en || t.text_ar)}</td>
            <td><select class="fi exec-act-owner" onchange="ExecutiveActions.ownerChanged(${t.id})">${ownerOptions(t.owner_id)}</select></td>
            <td><span class="exec-act-dept" id="exec-act-dept-${t.id}">${esc(deptOf(t.owner_id)) || "—"}</span></td>
            <td><input type="date" class="fi exec-act-due" value="${esc(t.due_date || "")}"/></td>
            <td><select class="fi exec-act-priority">${priorityOptions(t.priority)}</select></td>
            <td><select class="fi exec-act-status">${statusOptions(t.status)}</select></td>
            <td><select class="fi exec-act-progress">${progressOptions(t.progress)}</select></td>
            <td><input type="text" class="fi exec-act-notes" value="${esc(t.notes || "")}" placeholder="${l === "ar" ? "ملاحظات..." : "Notes..."}"/></td>
            <td style="font-size:11px;color:var(--text3);white-space:nowrap">${esc((t.updated_at || t.created_at || "").substring(0, 16))}</td>
            <td><button class="btn-gold btn-sm" onclick="ExecutiveActions.saveRow(${t.id})">${l === "ar" ? "حفظ" : "Save"}</button></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  },

  ownerChanged(taskId) {
    const row = document.getElementById(`exec-act-row-${taskId}`);
    const deptEl = document.getElementById(`exec-act-dept-${taskId}`);
    if (!row || !deptEl) return;
    const ownerId = row.querySelector(".exec-act-owner").value;
    const m = (this._members || []).find((mm) => String(mm.id) === String(ownerId));
    deptEl.textContent = (m && m.department) || "—";
  },

  async saveRow(taskId) {
    const l = App.lang;
    const row = document.getElementById(`exec-act-row-${taskId}`);
    if (!row) return;
    const ownerSel = row.querySelector(".exec-act-owner");
    const dueEl = row.querySelector(".exec-act-due");
    const prioritySel = row.querySelector(".exec-act-priority");
    const statusSel = row.querySelector(".exec-act-status");
    const progressSel = row.querySelector(".exec-act-progress");
    const notesEl = row.querySelector(".exec-act-notes");
    const btn = row.querySelector("button");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "...";
    try {
      await api(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          owner_id: ownerSel.value || null,
          due_date: dueEl.value || "",
          priority: prioritySel.value,
          status: statusSel.value,
          progress: Number(progressSel.value),
          notes: notesEl.value,
        }),
      });
      showToast(l === "ar" ? "✓ تم حفظ التعيين" : "✓ Assignment saved", "success");
      btn.textContent = l === "ar" ? "✓ محفوظ" : "✓ Saved";
      await loadBadges();
    } catch (e) {
      showToast(e.message, "error");
      btn.textContent = originalText;
    } finally {
      btn.disabled = false;
    }
  },
};

// ── Shared page intro banner ──────────────────────────────────────────────────
function _pgBanner(titleAr, titleEn, descAr, descEn, btnHtml = '') {
  const l = App.lang;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:15px 18px;background:linear-gradient(135deg,var(--navy3),var(--navy2));border:1px solid var(--border2);border-radius:12px;margin-bottom:18px">
    <div style="min-width:0">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">${l==='ar'?titleAr:titleEn}</div>
      <div style="font-size:11.5px;color:var(--text3);line-height:1.65">${l==='ar'?descAr:descEn}</div>
    </div>
    ${btnHtml ? `<div style="flex-shrink:0">${btnHtml}</div>` : ''}
  </div>`;
}
function _secHdr(icon, labelAr, labelEn, subAr = '', subEn = '') {
  const l = App.lang;
  return `<div style="display:flex;align-items:baseline;gap:8px;margin:20px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--border2)">
    <span style="font-size:15px">${icon}</span>
    <div style="font-size:12.5px;font-weight:700;color:var(--text)">${l==='ar'?labelAr:labelEn}</div>
    ${(l==='ar'?subAr:subEn) ? `<div style="font-size:11px;color:var(--text3)">${l==='ar'?subAr:subEn}</div>` : ''}
  </div>`;
}

// ── Educational empty state — icon + title + explanation + up to two actions,
// reusing the existing .es/.es-icon/.es-title/.es-sub visual pattern. Used
// wherever a screen would otherwise just say "no data" with no way forward.
function emptyStateCard(opts) {
  const l = App.lang;
  const { icon, titleAr, titleEn, descAr, descEn, primary, secondary } = opts;
  return `<div class="es">
    <div class="es-icon">${icon}</div>
    <div class="es-title">${l === "ar" ? titleAr : titleEn}</div>
    ${descAr || descEn ? `<div class="es-sub">${l === "ar" ? descAr : descEn}</div>` : ""}
    ${
      primary || secondary
        ? `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center">
      ${primary ? `<button class="btn-gold btn-sm" onclick="${primary.onclick}">${l === "ar" ? primary.ar : primary.en}</button>` : ""}
      ${secondary ? `<button class="btn-ghost btn-sm" onclick="${secondary.onclick}">${l === "ar" ? secondary.ar : secondary.en}</button>` : ""}
    </div>`
        : ""
    }
  </div>`;
}

// Canonical order — must mirror LIFECYCLE_STAGES in src/routes/api.js.
// Approval cycle: Draft → Review → Approval → Archived
const LIFECYCLE_STAGE_ORDER = [
  'created', 'invited', 'scheduled', 'recording', 'uploaded',
  'transcript_generated', 'ai_minutes_generated', 'review',
  'approval', 'archived',
];
const LIFECYCLE_STAGE_META = {
  created:               { ar: 'مسودة',          en: 'Draft',         icon: '🏗' },
  invited:               { ar: 'الدعوات',         en: 'Invited',       icon: '📧' },
  scheduled:             { ar: 'مجدول',           en: 'Scheduled',     icon: '📅' },
  recording:             { ar: 'التسجيل',         en: 'Recording',     icon: '🎙' },
  uploaded:              { ar: 'تم الرفع',        en: 'Uploaded',      icon: '⬆️' },
  transcript_generated:  { ar: 'النص',            en: 'Transcript',    icon: '📝' },
  ai_minutes_generated:  { ar: 'محضر AI',         en: 'AI Minutes',    icon: '🤖' },
  review:                { ar: 'قيد المراجعة',    en: 'Review',        icon: '🗂️' },
  approval:              { ar: 'الاعتماد',        en: 'Approval',      icon: '✅' },
  archived:              { ar: 'أرشفة',           en: 'Archived',      icon: '🗄' },
};

// Renders the meeting lifecycle strip. For a real `meetings` row (which carries
// a persisted `lifecycle_stage`), the strip reflects the actual database state
// machine — every step here corresponds to a real, logged transition. For
// `schedule` table rows (pre-recording calendar entries with no lifecycle_stage
// column) it falls back to a heuristic estimate from the fields that do exist.
function _meetingLifecycle(m, l) {
  const ar = (a, e) => l === 'ar' ? a : e;
  if (m.lifecycle_stage) return _meetingLifecycleReal(m, l);
  return _meetingLifecycleHeuristic(m, l);
}

function _meetingLifecycleReal(m, l) {
  const ar = (a, e) => l === 'ar' ? a : e;
  const stage = m.lifecycle_stage || 'created';
  const currentIdx = Math.max(0, LIFECYCLE_STAGE_ORDER.indexOf(stage));
  const resolved = LIFECYCLE_STAGE_ORDER.map((key, i) => {
    const meta = LIFECYCLE_STAGE_META[key];
    const state = i < currentIdx ? 'done' : i === currentIdx ? (stage === 'archived' ? 'done' : 'current') : 'pending';
    return { key, ar: meta.ar, en: meta.en, icon: meta.icon, state };
  });
  const doneCount = resolved.filter(s => s.state === 'done').length;
  const pct = Math.round(((doneCount + (stage === 'archived' ? 0 : 0.5)) / resolved.length) * 100);
  const barColor = stage === 'archived' ? 'var(--green)' : pct >= 50 ? '#5B9BD6' : 'var(--gold)';

  const SC = {
    done:    { bg: 'rgba(46,204,138,.12)',  fg: 'var(--green)', bd: 'rgba(46,204,138,.3)'  },
    current: { bg: 'rgba(212,160,23,.13)', fg: 'var(--gold)',  bd: 'rgba(212,160,23,.4)'  },
    pending: { bg: 'transparent',          fg: 'var(--text3)', bd: 'var(--border2)'        },
  };
  const chips = resolved.map((s, i) => {
    const c = SC[s.state] || SC.pending;
    const dot = s.state === 'done' ? '✓' : s.state === 'current' ? '●' : '○';
    const sep = i > 0
      ? `<div style="width:10px;height:1px;flex-shrink:0;background:${s.state==='done'?'rgba(46,204,138,.4)':'var(--border2)'}"></div>`
      : '';
    return `${sep}<div style="display:flex;align-items:center;gap:3px;padding:3px 7px;border-radius:20px;background:${c.bg};border:.5px solid ${c.bd};white-space:nowrap" title="${s.state==='done'?ar('مكتمل','Completed'):s.state==='current'?ar('جارٍ','Current'):ar('معلق','Pending')}">
      <span style="font-size:11px">${s.icon}</span>
      <span style="font-size:11px;font-weight:${s.state==='current'?'700':'500'};color:${c.fg}">${l==='ar'?s.ar:s.en}</span>
      <span style="font-size:10px;color:${c.fg}">${dot}</span>
    </div>`;
  }).join('');

  return `<div style="margin:10px 0 6px;padding:10px 12px;background:var(--navy3);border-radius:10px;border:.5px solid var(--border2)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">⚡ ${ar('مسار الاجتماع','Meeting Lifecycle')}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:700;color:${barColor}">${doneCount}/${resolved.length} ${ar('مكتملة','complete')}</span>
        <button class="btn-ghost btn-sm" style="font-size:10.5px;padding:2px 8px" onclick="showLifecycleLog(${m.id})">📋 ${ar('السجل','Log')}</button>
      </span>
    </div>
    <div style="background:var(--navy4);border-radius:20px;height:4px;overflow:hidden;margin-bottom:8px">
      <div style="height:100%;border-radius:20px;background:${barColor};width:${pct}%;transition:width .5s"></div>
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <div style="display:flex;align-items:center;min-width:max-content">
        ${chips}
      </div>
    </div>
  </div>`;
}

// ── Meeting Lifecycle Strip (heuristic fallback for schedule-table rows) ──────
// Renders a compact 10-step lifecycle bar for schedule items, which don't carry
// a persisted lifecycle_stage (the schedule and meetings tables aren't linked).
function _meetingLifecycleHeuristic(m, l) {
  const ar = (a, e) => l === 'ar' ? a : e;
  const today = new Date().toISOString().substring(0, 10);
  const meetingDate = m.meeting_date || '';
  const isPast = meetingDate && meetingDate < today;

  const isConfirmed  = m.status === 'confirmed' || m.status === 'processed' || !!m.transcript;
  const hasRecording = !!(m.transcript || m.audio_recording_url);
  const hasTr        = !!(m.transcript && m.transcript.length > 10);
  const hasST        = (() => { try { const p = JSON.parse(m.speaker_transcript||'[]'); return Array.isArray(p)&&p.length>0; } catch(e){ return false; } })();
  const hasTranscript= hasTr || hasST;
  const hasAI        = !!(m.ai_summary_ar || m.ai_summary_en);
  const hasTasks     = (() => { try { const t = JSON.parse(m.ai_tasks||'[]'); return Array.isArray(t)&&t.length>0; } catch(e){ return false; } })();
  const hasDecisions = (() => { try { const d = JSON.parse(m.ai_decisions||'[]'); return Array.isArray(d)&&d.length>0; } catch(e){ return false; } })();
  const mStatus      = m.minutes_status || '';
  const recSt        = m.recording_approval_status || '';
  const isCirculated = ['circulated','approved','final_approved'].includes(mStatus);
  const isApproved   = ['approved','final_approved'].includes(mStatus);
  const isFinal      = mStatus === 'final_approved';
  const isArchived   = isFinal && recSt === 'approved';
  const hasAttendees = !!(m.attendees && m.attendees.trim());

  // 10 lifecycle steps — each gets done:true when that milestone is complete
  const steps = [
    { ar:'إنشاء',      en:'Created',      icon:'🏗', done: true                                    },
    { ar:'الدعوات',    en:'Invitations',  icon:'📧', done: isConfirmed || hasAttendees             },
    { ar:'مجدول',      en:'Scheduled',    icon:'📅', done: isConfirmed                             },
    { ar:'التسجيل',    en:'Recording',    icon:'🎙', done: hasRecording                            },
    { ar:'النص',       en:'Transcript',   icon:'📝', done: hasTranscript                           },
    { ar:'محضر AI',    en:'AI Minutes',   icon:'🤖', done: hasAI                                   },
    { ar:'الاعتماد',   en:'Approval',     icon:'✅', done: isApproved                              },
    { ar:'المهام',     en:'Actions',      icon:'📌', done: hasTasks || hasDecisions                },
    { ar:'متابعة',     en:'Follow-up',    icon:'🔄', done: (hasTasks||hasDecisions) && isCirculated },
    { ar:'أرشفة',      en:'Archived',     icon:'🗄', done: isFinal                                 },
  ];

  // Walk forward: first non-done step = 'current', rest = 'pending'
  let foundCurrent = false;
  const resolved = steps.map(s => {
    if (s.done) return { ...s, state: 'done' };
    if (!foundCurrent) { foundCurrent = true; return { ...s, state: 'current' }; }
    return { ...s, state: 'pending' };
  });

  const doneCount  = resolved.filter(s => s.state === 'done').length;
  const pct        = Math.round((doneCount / steps.length) * 100);
  const barColor   = pct === 100 ? 'var(--green)' : pct >= 50 ? '#5B9BD6' : 'var(--gold)';

  const SC = {
    done:    { bg: 'rgba(46,204,138,.12)',  fg: 'var(--green)', bd: 'rgba(46,204,138,.3)'  },
    current: { bg: 'rgba(212,160,23,.13)', fg: 'var(--gold)',  bd: 'rgba(212,160,23,.4)'  },
    pending: { bg: 'transparent',          fg: 'var(--text3)', bd: 'var(--border2)'        },
  };

  const chips = resolved.map((s, i) => {
    const c   = SC[s.state] || SC.pending;
    const dot = s.state === 'done' ? '✓' : s.state === 'current' ? '●' : '○';
    const sep = i > 0
      ? `<div style="width:10px;height:1px;flex-shrink:0;background:${s.state==='done'?'rgba(46,204,138,.4)':'var(--border2)'}"></div>`
      : '';
    return `${sep}<div style="display:flex;align-items:center;gap:3px;padding:3px 7px;border-radius:20px;background:${c.bg};border:.5px solid ${c.bd};white-space:nowrap" title="${s.state==='done'?ar('مكتمل','Completed'):s.state==='current'?ar('جارٍ','Current'):ar('معلق','Pending')}">
      <span style="font-size:11px">${s.icon}</span>
      <span style="font-size:11px;font-weight:${s.state==='current'?'700':'500'};color:${c.fg}">${l==='ar'?s.ar:s.en}</span>
      <span style="font-size:10px;color:${c.fg}">${dot}</span>
    </div>`;
  }).join('');

  return `<div style="margin:10px 0 6px;padding:10px 12px;background:var(--navy3);border-radius:10px;border:.5px solid var(--border2)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">⚡ ${ar('مسار الاجتماع','Meeting Lifecycle')}</span>
      <span style="font-size:11px;font-weight:700;color:${barColor}">${doneCount}/${steps.length} ${ar('مكتملة','complete')} · ${pct}%</span>
    </div>
    <div style="background:var(--navy4);border-radius:20px;height:4px;overflow:hidden;margin-bottom:8px">
      <div style="height:100%;border-radius:20px;background:${barColor};width:${pct}%;transition:width .5s"></div>
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <div style="display:flex;align-items:center;min-width:max-content">
        ${chips}
      </div>
    </div>
  </div>`;
}

// ══ Meeting Series (Phase 2) — "Meeting Relationship" picker ═══════════════════
// Shared by the ImportFlow "Create New Meeting" fields (prefix "imp") and the
// Schedule panel's "Schedule New Meeting" form (prefix "nm") so the Standalone /
// Create New Series / Continue Existing Series segmented control and its
// conditional fields are wired up identically in both places, per element ids
// `${prefix}-series-*` already present in index.html for both prefixes.
const SeriesUI = {
  _lookupCache: null,

  async _lookup() {
    if (this._lookupCache) return this._lookupCache;
    try { this._lookupCache = await api('/api/gov/meeting-series-lookup'); } catch (_) { this._lookupCache = []; }
    return this._lookupCache;
  },

  invalidate() { this._lookupCache = null; },

  async init(prefix) {
    this.setMode(prefix, 'standalone');
    await Promise.all([this._populateOwnerSelect(prefix), this._populateSeriesSelect(prefix)]);
  },

  setMode(prefix, mode) {
    const seg = $(`${prefix}-series-seg`);
    if (seg) seg.querySelectorAll('.imp-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === mode));
    const newEl = $(`${prefix}-series-new`);
    const contEl = $(`${prefix}-series-continue`);
    if (newEl) newEl.style.display = mode === 'new' ? '' : 'none';
    if (contEl) contEl.style.display = mode === 'continue' ? '' : 'none';
  },

  _mode(prefix) {
    const seg = $(`${prefix}-series-seg`);
    const active = seg && seg.querySelector('.imp-seg-btn.active');
    return (active && active.dataset.val) || 'standalone';
  },

  async _populateOwnerSelect(prefix) {
    const sel = $(`${prefix}-series-owner`);
    if (!sel) return;
    const l = App.lang;
    try {
      const members = await api('/api/members');
      sel.innerHTML = `<option value="">${l === 'ar' ? '— مالك السلسلة (اختياري) —' : '— Series Owner (optional) —'}</option>` +
        members.map((m) => `<option value="${m.id}">${esc(l === 'ar' ? m.name_ar : (m.name_en || m.name_ar))}</option>`).join('');
    } catch (_) {}
  },

  async _populateSeriesSelect(prefix) {
    const sel = $(`${prefix}-series-existing`);
    if (!sel) return;
    const l = App.lang;
    const list = await this._lookup();
    if (!list.length) {
      sel.innerHTML = `<option value="">${l === 'ar' ? 'لا توجد سلاسل بعد' : 'No series yet'}</option>`;
      return;
    }
    sel.innerHTML = `<option value="">${l === 'ar' ? '— اختر سلسلة —' : '— Select a series —'}</option>` +
      list.map((s) => `<option value="${s.id}">${esc(l === 'ar' ? s.name_ar : (s.name_en || s.name_ar))}${s.category ? ' · ' + esc(s.category) : ''}</option>`).join('');
  },

  // Returns { series_id } / { new_series: {...} } / {} (standalone) to merge
  // into a meeting or schedule create/update payload.
  resolvePayload(prefix) {
    const mode = this._mode(prefix);
    if (mode === 'continue') {
      const id = (($(`${prefix}-series-existing`) || {}).value) || '';
      return id ? { series_id: Number(id) } : {};
    }
    if (mode === 'new') {
      const nameAr = (($(`${prefix}-series-name-ar`) || {}).value || '').trim();
      if (!nameAr) return {};
      return {
        new_series: {
          name_ar: nameAr,
          name_en: (($(`${prefix}-series-name-en`) || {}).value || '').trim(),
          category: (($(`${prefix}-series-category`) || {}).value || '').trim(),
          owner_id: (($(`${prefix}-series-owner`) || {}).value || '') || null,
          description_ar: (($(`${prefix}-series-desc-ar`) || {}).value || '').trim(),
          description_en: (($(`${prefix}-series-desc-en`) || {}).value || '').trim(),
        },
      };
    }
    return {};
  },
};

// ══ Import Meeting Content — unified Meeting Target + Content Type flow ════════
// Drives the "Import Meeting Content" card in the Record panel: lets the user
// attach imported content (audio/video archive, pasted text, or a text file) to
// either an existing meeting or a brand-new one, then shows results inline.
const ImportFlow = {
  // Defaults to 'new' rather than 'existing': pasting/uploading content for a
  // meeting that doesn't exist yet is the overwhelmingly common first action
  // (especially for a first-time user with no meetings in the system at all).
  // With 'existing' as the default, a naive "paste text, click Process" click
  // — the exact path a new customer takes — failed with a generic "select a
  // meeting first" error, since the (empty, for a new account) existing-
  // meetings dropdown had nothing selected.
  target: 'new',
  contentType: 'live',

  init() {
    this.setTarget(this.target, true);
    this.setContentType(this.contentType, true);
    this.populateMeetingsSel();
    SeriesUI.init('imp');
  },

  setTarget(val) {
    this.target = val;
    document.querySelectorAll('#imp-target-seg .imp-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === val));
    const existingEl = $('imp-target-existing');
    const newEl = $('imp-target-new');
    if (existingEl) existingEl.style.display = val === 'existing' ? '' : 'none';
    if (newEl) newEl.style.display = val === 'new' ? '' : 'none';
  },

  setContentType(val) {
    this.contentType = val;
    document.querySelectorAll('#imp-content-seg .imp-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === val));
    ['live', 'av', 'text', 'file'].forEach((k) => {
      const el = $(`imp-content-${k}`);
      if (el) el.style.display = k === val ? '' : 'none';
    });
    // Live recording always creates its own meeting from the title/type fields
    // in that block (unchanged existing behaviour) — Meeting Target only
    // applies to the other three content types.
    const targetSection = $('imp-target-section');
    if (targetSection) targetSection.style.display = val === 'live' ? 'none' : '';
    const resultCard = $('import-result-card');
    if (resultCard) resultCard.style.display = 'none';
  },

  async populateMeetingsSel() {
    const sel = $('imp-meeting-sel');
    const prevSel = $('imp-new-prev-meeting');
    if (!sel && !prevSel) return;
    const l = App.lang;
    if (sel) sel.innerHTML = `<option value="">${l === 'ar' ? 'جارٍ تحميل الاجتماعات…' : 'Loading meetings…'}</option>`;
    try {
      const meetings = await api('/api/meetings');
      if (!meetings.length) {
        if (sel) sel.innerHTML = `<option value="">${l === 'ar' ? 'لا توجد اجتماعات مسجلة بعد' : 'No meetings recorded yet'}</option>`;
        return;
      }
      const opts = meetings.map((m) => {
        const title = l === 'ar' ? m.title_ar : m.title_en || m.title_ar;
        const date = (m.meeting_date || '').substring(0, 10);
        return `<option value="${m.id}">${esc(title)}${date ? ' · ' + date : ''}</option>`;
      }).join('');
      if (sel) sel.innerHTML = `<option value="">${l === 'ar' ? '— اختر الاجتماع —' : '— Select Meeting —'}</option>` + opts;
      if (prevSel) prevSel.innerHTML = `<option value="">${l === 'ar' ? '— اجتماع سابق مرتبط (اختياري) —' : '— Linked Previous Meeting (optional) —'}</option>` + opts;
    } catch (_) {
      if (sel) sel.innerHTML = `<option value="">${l === 'ar' ? 'تعذّر تحميل الاجتماعات' : 'Could not load meetings'}</option>`;
    }
  },

  // Reads the Meeting Target block and returns the fields needed by the
  // backend, or null (after showing a toast) if the form isn't ready yet.
  _resolveTarget() {
    const l = App.lang;
    if (this.target === 'existing') {
      const sel = $('imp-meeting-sel');
      const meetingId = sel && sel.value;
      if (!meetingId) {
        showToast(l === 'ar' ? 'الرجاء اختيار اجتماع أولاً' : 'Please select a meeting first', 'error');
        return null;
      }
      return { meeting_target: 'existing', meeting_id: meetingId };
    }
    const titleEl = $('imp-new-title');
    const title = ((titleEl && titleEl.value) || '').trim();
    if (!title) {
      showToast(l === 'ar' ? 'الرجاء إدخال عنوان الاجتماع' : 'Please enter a meeting title', 'error');
      return null;
    }
    return Object.assign({
      meeting_target: 'new',
      title,
      type: (($('imp-new-type') || {}).value) || '',
      meeting_date: (($('imp-new-date') || {}).value) || '',
      meeting_provider: (($('imp-new-provider') || {}).value) || '',
      prev_meeting_id: (($('imp-new-prev-meeting') || {}).value) || '',
    }, SeriesUI.resolvePayload('imp'));
  },

  async submitText() {
    const l = App.lang;
    const target = this._resolveTarget();
    if (!target) return;
    const ta = $('imp-text-content');
    const text = ((ta && ta.value) || '').trim();
    if (!text) {
      showToast(l === 'ar' ? 'الرجاء لصق نص المحضر' : 'Please paste the meeting text', 'error');
      return;
    }
    await this._runTextImport(Object.assign({}, target, { content_type: 'paste_text', text }), $('imp-text-btn'), () => { if (ta) ta.value = ''; });
  },

  async submitFile() {
    const l = App.lang;
    const target = this._resolveTarget();
    if (!target) return;
    const fi = $('imp-file-input');
    if (!(fi && fi.files && fi.files[0])) {
      showToast(l === 'ar' ? 'الرجاء اختيار ملف نصي' : 'Please choose a text file', 'error');
      return;
    }
    let text;
    try {
      text = (await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(l === 'ar' ? 'تعذّرت قراءة الملف' : 'Could not read file'));
        reader.readAsText(fi.files[0]);
      })).trim();
    } catch (e) {
      showToast(e.message, 'error');
      return;
    }
    if (!text) {
      showToast(l === 'ar' ? 'الملف فارغ' : 'The file is empty', 'error');
      return;
    }
    await this._runTextImport(Object.assign({}, target, { content_type: 'text_file', text }), $('imp-file-btn'), () => { if (fi) fi.value = ''; });
  },

  async _runTextImport(payload, btn, onSuccess) {
    const l = App.lang;
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = l === 'ar' ? 'جارٍ المعالجة…' : 'Processing…'; }
    this._showLoading();
    try {
      const res = await fetch('/api/meetings/import-content', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (l === 'ar' ? 'فشل الاستيراد' : 'Import failed'));
      this._renderResult(data);
      if (onSuccess) onSuccess();
      await this.populateMeetingsSel();
      SeriesUI.invalidate();
      await SeriesUI.init('imp');
      const panels = document.getElementById('panel-transcripts');
      if (panels && panels.classList.contains('active')) await renderTranscripts();
    } catch (e) {
      this._renderError(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  },

  async submitAudioVideo() {
    const l = App.lang;
    const target = this._resolveTarget();
    if (!target) return;
    const fi = $('imp-av-file');
    if (!(fi && fi.files && fi.files[0])) {
      showToast(l === 'ar' ? 'الرجاء اختيار ملف تسجيل' : 'Please choose a recording file', 'error');
      return;
    }
    const btn = $('imp-av-btn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = l === 'ar' ? 'جارٍ الحفظ…' : 'Saving…'; }
    this._showLoading();
    try {
      let meetingId = target.meeting_id;
      let created = false;
      if (target.meeting_target === 'new') {
        const cRes = await fetch('/api/meetings/import-content', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, target, { content_type: 'audio_video' })),
        });
        const cData = await cRes.json().catch(() => ({}));
        if (!cRes.ok) throw new Error(cData.error || (l === 'ar' ? 'تعذّر إنشاء الاجتماع' : 'Could not create meeting'));
        meetingId = cData.meeting.id;
        created = cData.created;
      }
      const fd = new FormData();
      fd.append('recording', fi.files[0], fi.files[0].name);
      fd.append('capture_type', target.meeting_provider || 'uploaded_recording');
      const res = await fetch(`/api/meetings/${meetingId}/recording`, { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (l === 'ar' ? 'فشل رفع الملف' : 'Upload failed'));
      this._renderArchivedResult(meetingId, created);
      fi.value = '';
      await this.populateMeetingsSel();
      SeriesUI.invalidate();
      await SeriesUI.init('imp');
      const panels = document.getElementById('panel-transcripts');
      if (panels && panels.classList.contains('active')) await renderTranscripts();
    } catch (e) {
      this._renderError(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  },

  async openInHistory(meetingId) {
    await Panels.load('history');
    await MeetingHistory.select(meetingId);
  },

  _showLoading() {
    const card = $('import-result-card');
    const body = $('import-result-body');
    const sub = $('import-result-sub');
    const links = $('import-result-links');
    if (!card || !body) return;
    const l = App.lang;
    card.style.display = '';
    if (sub) sub.textContent = '';
    if (links) links.innerHTML = '';
    body.innerHTML = `<div class="es" style="padding:30px 0"><div class="loading"></div><div style="margin-top:10px;font-size:12.5px;color:var(--text3)">${l === 'ar' ? 'جارٍ معالجة محتوى الاجتماع...' : 'Processing meeting content...'}</div></div>`;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  _linksHtml(meetingId) {
    const l = App.lang;
    return `<button class="btn-ghost btn-sm" onclick="Panels.load('transcripts')">📝 ${l === 'ar' ? 'فتح في المحاضر والنصوص' : 'Open in Transcripts / Minutes'}</button>
      <button class="btn-ghost btn-sm" onclick="ImportFlow.openInHistory(${meetingId})">🗂 ${l === 'ar' ? 'فتح في سجل الاجتماعات' : 'Open in Meeting History'}</button>`;
  },

  _renderResult(data) {
    const l = App.lang;
    const card = $('import-result-card');
    const body = $('import-result-body');
    const sub = $('import-result-sub');
    const links = $('import-result-links');
    if (!card || !body) return;
    card.style.display = '';
    const m = data.meeting || {};
    const title = l === 'ar' ? m.title_ar : m.title_en || m.title_ar;
    if (sub) sub.textContent = `${data.created ? (l === 'ar' ? 'تم إنشاء اجتماع جديد' : 'New meeting created') : (l === 'ar' ? 'تم تحديث الاجتماع' : 'Meeting updated')} — ${title || ''}`;
    if (links) links.innerHTML = this._linksHtml(m.id);

    if (data.ai_status === 'unavailable') {
      body.innerHTML = `<div class="imp-note" style="border-inline-start-color:#f0a000;margin-bottom:0">⚠️ ${l === 'ar' ? 'المعالجة بالذكاء الاصطناعي غير متاحة حالياً. يرجى إعداد مفتاح API للذكاء الاصطناعي.' : 'AI processing is not available. Please configure the AI API key.'}<br><span style="opacity:.8">${l === 'ar' ? 'تم حفظ النص المُدخل في الاجتماع.' : 'The submitted text has been saved to the meeting.'}</span></div>`;
      return;
    }
    if (data.ai_status === 'error') {
      body.innerHTML = `<div class="imp-note" style="border-inline-start-color:#e05252;margin-bottom:0">⚠️ ${l === 'ar' ? 'تعذّرت المعالجة الذكية لهذا المحتوى. تم حفظ النص، ويمكن إعادة المحاولة لاحقاً.' : 'AI processing could not complete for this content. The text has been saved — you can retry later.'}</div>`;
      return;
    }

    const sec = (icon, ar, en, html) => `<div class="hist-sec"><div class="hist-sec-h">${icon} ${l === 'ar' ? ar : en}</div><div class="hist-sec-body">${html}</div></div>`;
    const emptyRow = (ar, en) => `<div class="hist-empty-row">${l === 'ar' ? ar : en}</div>`;
    const list = (arr, mapFn) => (arr && arr.length ? `<div style="display:flex;flex-direction:column;gap:6px">${arr.map(mapFn).join('')}</div>` : null);

    const topics = l === 'ar' ? data.key_topics_ar || [] : data.key_topics_en || data.key_topics_ar || [];
    const summary = l === 'ar' ? data.summary_ar || '' : data.summary_en || data.summary_ar || '';

    const sections = [
      sec('✦', 'الملخص', 'Summary', summary ? esc(summary) : emptyRow('لا يوجد ملخص', 'No summary')),
      sec('🗣️', 'أبرز نقاط النقاش', 'Key Discussion Points', list(topics, (t) => `<div>• ${esc(t)}</div>`) || emptyRow('لا توجد نقاط مسجّلة', 'No discussion points recorded')),
      sec('⚖️', 'القرارات', 'Decisions', list(data.decisions, (d) => `<div>${esc(l === 'ar' ? d.text_ar || d.text_en : d.text_en || d.text_ar)}</div>`) || emptyRow('لا توجد قرارات', 'No decisions')),
      sec('✅', 'المهام / الإجراءات', 'Tasks / Action Items', list(data.tasks, (t) => `<div>${esc(l === 'ar' ? t.text_ar || t.text_en : t.text_en || t.text_ar)} ${t.owner_ar || t.owner_en ? `<span class="tag tgold" style="font-size:11px">${esc(l === 'ar' ? t.owner_ar || t.owner_en : t.owner_en || t.owner_ar)}</span>` : ''}</div>`) || emptyRow('لا توجد مهام', 'No tasks')),
      sec('🎯', 'إدارة إجراءات التنفيذ', 'Executive Action Management', `<div id="exec-actions-import-${m.id}"><div class="es" style="padding:16px 0"><div class="loading"></div></div></div>`),
      sec('📌', 'متابعات', 'Follow-ups', list(data.followups, (f) => `<div>${esc(l === 'ar' ? f.text_ar || f.text_en : f.text_en || f.text_ar)}</div>`) || emptyRow('لا توجد متابعات', 'No follow-ups')),
    ];
    if (data.risks && data.risks.length) {
      sections.push(sec('⚠️', 'المخاطر', 'Risks', list(data.risks, (r) => `<div>${r.severity === 'high' ? '🔴' : r.severity === 'medium' ? '🟡' : '🟢'} ${esc(l === 'ar' ? r.text_ar || r.text_en : r.text_en || r.text_ar)}</div>`)));
    }
    body.innerHTML = sections.join('');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const execContainer = $(`exec-actions-import-${m.id}`);
    if (execContainer) ExecutiveActions.renderAssignmentSection(execContainer, m.id);
  },

  _renderArchivedResult(meetingId, created) {
    const l = App.lang;
    const card = $('import-result-card');
    const body = $('import-result-body');
    const sub = $('import-result-sub');
    const links = $('import-result-links');
    if (!card || !body) return;
    card.style.display = '';
    if (sub) sub.textContent = created ? (l === 'ar' ? 'تم إنشاء اجتماع جديد وأرشفة التسجيل' : 'New meeting created and recording archived') : (l === 'ar' ? 'تم أرشفة التسجيل للاجتماع' : 'Recording archived to the meeting');
    if (links) links.innerHTML = this._linksHtml(meetingId);
    body.innerHTML = `<div class="imp-note" style="margin-bottom:0">🎞 ${l === 'ar'
      ? 'تم حفظ التسجيل في أرشيف التسجيلات. استخراج الذكاء الاصطناعي يتطلب نصاً مكتوباً (محضراً) أو تكامل تفريغ صوتي مدعوماً.'
      : 'The recording has been saved to the Recording Archive. AI extraction requires a transcript or a supported transcription integration.'}</div>`;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  _renderError(msg) {
    const card = $('import-result-card');
    const body = $('import-result-body');
    const sub = $('import-result-sub');
    const links = $('import-result-links');
    if (!card || !body) return;
    card.style.display = '';
    if (sub) sub.textContent = '';
    if (links) links.innerHTML = '';
    body.innerHTML = `<div class="imp-note" style="border-inline-start-color:#e05252;margin-bottom:0;color:#e05252">⚠️ ${esc(msg)}</div>`;
  },
};

// ══ Recording Storage ══════════════════════════════════════════════════════════
const RecStore = {
  async upload(meetingId, blobUrl) {
    const l = App.lang;
    const btn = document.getElementById('rec-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = l === 'ar' ? 'جارٍ الرفع…' : 'Uploading…'; }
    try {
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      const fd   = new FormData();
      fd.append('recording', blob, `meeting-${meetingId}-${Date.now()}.webm`);
      const res  = await fetch(`/api/meetings/${meetingId}/recording`, {
        method: 'POST', credentials: 'include', body: fd
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      showToast(l === 'ar' ? '✓ تم حفظ التسجيل في المنصة' : '✓ Recording saved to platform', 'success');
      if (btn) { btn.textContent = l === 'ar' ? '✓ محفوظ' : '✓ Saved'; }
    } catch (e) {
      showToast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = l === 'ar' ? '☁ حفظ في المنصة' : '☁ Save to Platform'; }
    }
  },
  async approve(meetingId, action) {
    const l = App.lang;
    try {
      const res = await fetch(`/api/meetings/${meetingId}/recording/approve`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast(l === 'ar' ? '✓ تم تحديث حالة الاعتماد' : '✓ Approval status updated', 'success');
      await renderTranscripts();
    } catch (e) { showToast(e.message, 'error'); }
  },
  async remove(meetingId) {
    const l = App.lang;
    if (!confirm(l === 'ar' ? 'حذف التسجيل من المنصة نهائياً؟' : 'Permanently delete recording from platform?')) return;
    try {
      const res = await fetch(`/api/meetings/${meetingId}/recording`, {
        method: 'DELETE', credentials: 'include'
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast(l === 'ar' ? 'تم حذف التسجيل' : 'Recording deleted', 'success');
      await renderTranscripts();
    } catch (e) { showToast(e.message, 'error'); }
  }
};

// ══ Transcripts ═══════════════════════════════════════════════════════════════
// Read-only "Completed / Pending / Overdue / Blocked" chip summary for a
// meeting's real, relational tasks — shared by Transcripts & Minutes and
// Meeting History so status counts are computed the same way in both places.
function execActionsSummaryChips(meetingTasks, l) {
  if (!meetingTasks || !meetingTasks.length) {
    return `<div class="hist-empty-row">${l === "ar" ? "لا توجد إجراءات تنفيذية مرتبطة بهذا الاجتماع بعد" : "No executive actions linked to this meeting yet"}</div>`;
  }
  const counts = { completed: 0, pending: 0, overdue: 0, blocked: 0 };
  meetingTasks.forEach((t) => {
    const key = taskStatusKey(t.status);
    if (t.status === "overdue") counts.overdue++;
    else if (key === "done" || key === "cancelled") counts.completed += key === "done" ? 1 : 0;
    else if (key === "blocked") counts.blocked++;
    else counts.pending++;
  });
  const chip = (icon, val, ar, en, color) => `<div class="exec-summary-chip" style="color:${color}">${icon} ${val} ${l === "ar" ? ar : en}</div>`;
  return `<div class="exec-summary-row">
    ${chip("✅", counts.completed, "مكتملة", "Completed", "var(--green)")}
    ${chip("🔵", counts.pending, "قيد التنفيذ", "Pending", "var(--blue)")}
    ${counts.overdue ? chip("⚠️", counts.overdue, "متأخرة", "Overdue", "var(--red)") : ""}
    ${counts.blocked ? chip("⛔", counts.blocked, "معلّقة", "Blocked", "var(--red)") : ""}
  </div>`;
}

async function renderTranscripts() {
  const body = $("transcripts-body");
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    // A role without actions.view/actions.update (e.g. Observer, Guest) 403s
    // on /api/tasks — that used to reject this whole Promise.all and blank
    // the entire panel (including meetings.view-permitted meeting cards)
    // behind a raw error message. Degrade independently instead.
    const [meetings, allTasks] = await Promise.all([
      api("/api/meetings").catch(() => []),
      api("/api/tasks").catch(() => []),
    ]);
    App.meetingsCache = meetings;
    const tasksByMeeting = {};
    allTasks.forEach((t) => {
      if (!t.source_meeting_id) return;
      (tasksByMeeting[t.source_meeting_id] = tasksByMeeting[t.source_meeting_id] || []).push(t);
    });
    const meetingsById = {};
    meetings.forEach((m) => { meetingsById[m.id] = m; });
    const l = App.lang;
    if (!meetings.length) {
      body.innerHTML = `<div style="text-align:center;padding:40px 24px">
        <div style="font-size:44px;margin-bottom:14px">🎙</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">${l==="ar"?"لا توجد اجتماعات مسجلة بعد":"No recorded meetings yet"}</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.8;max-width:400px;margin:0 auto 20px">${l==="ar"?"انتقل إلى صفحة <strong style='color:var(--gold)'>تسجيل اجتماع</strong>، ابدأ التسجيل الصوتي أو ارفع ملفاً، وسيقوم أمين تلقائياً باستخراج المهام، القرارات، والمخاطر من المحادثة.":"Go to <strong style='color:var(--gold)'>Record Meeting</strong>, start voice recording or upload a file, and Ameen will automatically extract tasks, decisions, and risks from the conversation."}</div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:20px">
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(46,204,138,.1);color:var(--green);border:.5px solid rgba(46,204,138,.25)">✓ ${l==="ar"?"استخراج مهام آلي":"Auto task extraction"}</span>
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(212,160,23,.1);color:var(--gold);border:.5px solid rgba(212,160,23,.25)">⚖️ ${l==="ar"?"تسجيل قرارات":"Decision logging"}</span>
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(91,155,214,.1);color:#5B9BD6;border:.5px solid rgba(91,155,214,.25)">📝 ${l==="ar"?"محاضر رسمية":"Official minutes"}</span>
        </div>
        <button class="btn-gold btn-sm" onclick="Panels.load('record')" style="font-size:12px;padding:8px 20px">🎙 ${l==="ar"?"ابدأ التسجيل الآن":"Start Recording Now"}</button>
      </div>`;
      return;
    }
    const _trBanner = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:13px 16px;background:linear-gradient(135deg,var(--navy3),var(--navy2));border:1px solid var(--border2);border-radius:12px;margin-bottom:16px">
      <div>
        <div style="font-size:13.5px;font-weight:700;color:var(--text);margin-bottom:3px">📝 ${l==='ar'?'سجل الاجتماعات المُعالَجة':'Processed Meeting Archive'}</div>
        <div style="font-size:11.5px;color:var(--text3);line-height:1.65">${l==='ar'?'كل اجتماع يحتوي على ملخص، مهام، قرارات، ومخاطر — انقر على أي بطاقة لعرض التفاصيل الكاملة وإدارة اعتماد المحضر':'Each meeting contains a summary, tasks, decisions, and risks — expand any card to view full details and manage minutes approval'}</div>
      </div>
      <button class="btn-gold btn-sm" onclick="Panels.load('record')" style="white-space:nowrap;font-size:11px">🎙 ${l==='ar'?'تسجيل جديد':'New Recording'}</button>
    </div>`;
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
      ${_trBanner}
      ${meetings
        .map((m) => {
          const title = l === "ar" ? m.title_ar : m.title_en || m.title_ar;
          const tasks = tryParse(m.ai_tasks, []);
          const decisions = tryParse(m.ai_decisions, []);
          const risks = tryParse(m.ai_risks, []);
          const speakerTr = tryParse(m.speaker_transcript, []);
          const summary =
            l === "ar"
              ? m.ai_summary_ar || ""
              : m.ai_summary_en || m.ai_summary_ar || "";
          const isProcessed = m.status === "processed";
          const lcStage = m.lifecycle_stage || 'created';
          const mStatus = m.minutes_status || 'draft';
          const mVersion = m.minutes_version || 1;
          const mStatusBadge = (() => {
            if (mStatus === 'draft') return '';
            const stLabels = { circulated: l==='ar'?'📤 قيد الاعتماد':'📤 Circulated', approved: l==='ar'?'✅ معتمد':'✅ Approved', revision_requested: l==='ar'?'🔄 يحتاج مراجعة':'🔄 Revision Needed', final_approved: l==='ar'?'🏆 معتمد نهائياً':'🏆 Final Approved' };
            const stStyles = { circulated: 'background:rgba(255,160,0,.15);color:#f0a000', approved: 'background:rgba(50,180,100,.15);color:#32b464', revision_requested: 'background:rgba(220,50,50,.15);color:#e05252', final_approved: 'background:rgba(40,120,220,.15);color:#2878dc' };
            const ver = mVersion > 1 ? ` v${mVersion}` : '';
            return `<span class="tag" style="${stStyles[mStatus]||''}">${stLabels[mStatus]||mStatus}${ver}</span>`;
          })();
          const mApprovalBtns = (() => {
            const btns = [];
            if (mStatus === 'draft' || mStatus === 'revision_requested') {
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'circulate')" style="color:var(--gold);border-color:var(--gold)">📤 ${l==='ar'?'تعميم للاعتماد':'Circulate'}</button>`);
            }
            if (mStatus === 'circulated') {
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'approve')" style="color:#32b464;border-color:#32b464">✅ ${l==='ar'?'اعتماد':'Approve'}</button>`);
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'request-revision')" style="color:#e05252;border-color:#e05252">🔄 ${l==='ar'?'طلب مراجعة':'Request Revision'}</button>`);
            }
            if (mStatus === 'approved') {
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'final-approve')" style="color:#2878dc;border-color:#2878dc">🏆 ${l==='ar'?'اعتماد نهائي':'Final Approve'}</button>`);
            }
            if (mStatus !== 'draft') {
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesShowLog(${m.id})" style="font-size:11px">📋 ${l==='ar'?'سجل الاعتماد':'Approval Log'}</button>`);
            }
            if (lcStage === 'approval') {
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'archive')" style="color:var(--text3);border-color:var(--text3)">🗄️ ${l==='ar'?'أرشفة':'Archive'}</button>`);
            }
            btns.push(`<button id="min-dl-btn-${m.id}" class="btn-ghost btn-sm" onclick="MinutesDownload.download(${m.id},'${l}')">📥 ${l==='ar'?'تنزيل المحضر PDF':'Download Minutes PDF'}</button>`);
            return btns.join('');
          })();
          // Speaker count derived from the speaker_transcript segments
          const uniqueSpeakers = [
            ...new Set(speakerTr.map((s) => s.speaker).filter(Boolean)),
          ];
          // Render transcript: prefer speaker blocks over plain text
          const transcriptHtml = speakerTr.length
            ? `
          <details style="margin-bottom:10px">
            <summary style="font-size:11px;color:var(--text3);cursor:pointer;padding:4px 0">🗣️ ${l === "ar" ? "النص حسب المتحدث" : "Transcript by speaker"} (${uniqueSpeakers.length} ${l === "ar" ? "متحدث" : "speakers"})</summary>
            <div class="tr-box" style="margin-top:8px;max-height:220px;overflow-y:auto">
              ${speakerTr
                .map((s) => {
                  const spk = s.speaker || (l === "ar" ? "متحدث" : "Speaker");
                  const initials =
                    spk
                      .split(/[\s.]+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0] || "")
                      .join("")
                      .toUpperCase() || "?";
                  const palette =
                    SPEAKER_PALETTE[
                      Math.abs(
                        (spk.charCodeAt(0) || 0) + (spk.charCodeAt(1) || 0),
                      ) % SPEAKER_PALETTE.length
                    ];
                  const txt =
                    l === "ar"
                      ? s.text_ar || s.text_en || ""
                      : s.text_en || s.text_ar || "";
                  return `<div style="display:flex;gap:7px;padding:5px 0;border-bottom:.5px solid var(--border2);align-items:flex-start">
                  <div style="width:22px;height:22px;border-radius:50%;background:${palette.bg};border:1px solid ${palette.border};display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:${palette.fg};flex-shrink:0;margin-top:1px">${esc(initials)}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:11px;font-weight:700;color:${palette.fg}">${esc(spk)}</div>
                    <div style="font-size:12px;color:var(--text);line-height:1.6">${esc(txt)}</div>
                  </div>
                </div>`;
                })
                .join("")}
            </div>
          </details>`
            : m.transcript
              ? `<details style="margin-bottom:10px"><summary style="font-size:11px;color:var(--text3);cursor:pointer;padding:4px 0">${l === "ar" ? "عرض النص الكامل" : "Show full transcript"}</summary><div class="tr-box" style="margin-top:8px;max-height:200px;overflow-y:auto">${esc(m.transcript)}</div></details>`
              : "";
          return `<div class="card">
          <div class="ch">
            <div>
              <div class="ct" style="display:flex;align-items:center;gap:7px">
                <span id="mtg-title-${m.id}">${esc(title)}</span>
                <button class="btn-ghost btn-sm" style="padding:2px 7px;font-size:11px" title="${l === "ar" ? "تعديل العنوان" : "Edit title"}" onclick='editMeetingTitle(${m.id}, ${JSON.stringify(m.title_ar || "")}, ${JSON.stringify(m.title_en || m.title_ar || "")})'>✏️</button>
              </div>
              <div class="ctsub">${(m.meeting_date && m.meeting_date.substring(0, 10)) || ""} ${m.duration ? `· ${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, "0")} ${l === "ar" ? "دقيقة" : "min"}` : ""} · ${esc(m.recorder_ar || "")}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${m.series_id && m.series_name_ar ? `<span class="tag" style="background:var(--navy4)">🔗 ${esc(l === "ar" ? m.series_name_ar : (m.series_name_en || m.series_name_ar))}</span>` : ""}
              ${isProcessed ? `<span class="tag tg">✓ ${l === "ar" ? "مُعالج" : "Processed"}</span>` : `<span class="tag ta">${l === "ar" ? "جديد" : "New"}</span>`}
              ${m.source_type === "text_minutes" ? `<span class="tag" style="background:rgba(46,204,138,.12);color:#2ecc8a">📝 ${l === "ar" ? "محضر نصي" : "Text Minutes"}</span>` : ""}
              ${tasks.length ? `<span class="tag tgold">${tasks.length} ${l === "ar" ? "مهمة" : "tasks"}</span>` : ""}
              ${decisions.length ? `<span class="tag" style="background:var(--navy4)">${decisions.length} ${l === "ar" ? "قرار" : "decisions"}</span>` : ""}
              ${risks.length ? `<span class="tag" style="background:rgba(220,50,50,.15);color:#e05252">${risks.length} ${l === "ar" ? "مخاطر" : "risks"}</span>` : ""}
              ${uniqueSpeakers.length > 1 ? `<span class="tag" style="background:var(--navy4)">🗣️ ${uniqueSpeakers.length}</span>` : ""}
              ${mStatusBadge}
            </div>
          </div>
          ${_meetingLifecycle(m, l)}
          ${m.effective_prev_meeting_id && meetingsById[m.effective_prev_meeting_id] ? `<div style="margin-bottom:10px">
            <div style="font-size:11px;font-weight:700;color:var(--blue);margin-bottom:6px">🔁 ${l === "ar" ? "مراجعة إجراءات الاجتماع السابق" : "Previous Meeting Action Review"} — ${esc(l === "ar" ? meetingsById[m.effective_prev_meeting_id].title_ar : (meetingsById[m.effective_prev_meeting_id].title_en || meetingsById[m.effective_prev_meeting_id].title_ar))}</div>
            ${execActionsSummaryChips(tasksByMeeting[m.effective_prev_meeting_id], l)}
          </div>` : ""}
          <div style="margin-bottom:10px">
            <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px">🎯 ${l === "ar" ? "الإجراءات التنفيذية" : "Executive Actions"}</div>
            ${execActionsSummaryChips(tasksByMeeting[m.id], l)}
          </div>
          ${summary ? `<div style="font-size:12px;color:var(--text3);line-height:1.6;margin-bottom:10px;padding:0 2px">${esc(summary)}</div>` : ""}
          ${transcriptHtml}
          ${
            tasks.length
              ? `<div style="margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:5px">✅ ${l === "ar" ? "المهام" : "Tasks"}</div>
            ${tasks
              .slice(0, 5)
              .map(
                (
                  t,
                ) => `<div style="display:flex;gap:7px;padding:4px 0;border-bottom:.5px solid var(--border2);font-size:11px;color:var(--text)">
              <span style="color:var(--gold)">→</span>
              <span style="flex:1">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</span>
              ${t.owner_ar ? `<span class="tag tgold" style="font-size:11px">${esc(l === "ar" ? t.owner_ar : t.owner_en || t.owner_ar)}</span>` : ""}
            </div>`,
              )
              .join("")}
          </div>`
              : ""
          }
          ${
            risks.length
              ? `<div style="margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:#e05252;margin-bottom:5px">⚠️ ${l === "ar" ? "المخاطر" : "Risks"}</div>
            ${risks
              .slice(0, 3)
              .map(
                (
                  rk,
                ) => `<div style="display:flex;gap:6px;padding:4px 0;border-bottom:.5px solid var(--border2);font-size:11px;color:var(--text);align-items:flex-start">
              <span style="flex-shrink:0">${rk.severity === "high" ? "🔴" : rk.severity === "medium" ? "🟡" : "🟢"}</span>
              <span style="flex:1">${esc(l === "ar" ? rk.text_ar : rk.text_en || rk.text_ar)}</span>
            </div>`,
              )
              .join("")}
          </div>`
              : ""
          }
          <div id="mtg-docs-${m.id}"></div>
          ${(() => {
            const hasRec = !!m.audio_recording_url;
            const recSt  = m.recording_approval_status || 'none';
            const recStatus = m.recording_status || 'not_started';
            const ST_LABEL = {
              none:     l==='ar' ? 'لم يُرفع'            : 'Not Archived',
              pending:  l==='ar' ? 'بانتظار الاعتماد'    : 'Pending Approval',
              approved: l==='ar' ? 'مؤرشف رسمياً ✓'      : 'Officially Archived ✓',
              rejected: l==='ar' ? 'مرفوض'               : 'Rejected'
            };
            const ST_CLR = { none:'color:var(--text3)', pending:'color:#f0a000', approved:'color:#2ecc8a', rejected:'color:#e05252' };
            const fmtBytes = b => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : b > 1024 ? `${(b/1024).toFixed(0)} KB` : `${b||0} B`;
            const verifier = m.rec_verifier_ar ? (l==='ar' ? m.rec_verifier_ar : m.rec_verifier_en || m.rec_verifier_ar) : '';
            const CAPTURE_LABEL = {
              browser_microphone:  { en:'🖥 Browser Mic',      ar:'🖥 ميكروفون متصفح',   c:'#f0a000', bg:'rgba(255,160,0,.12)',   bd:'rgba(255,160,0,.3)' },
              uploaded_recording:  { en:'📤 Uploaded File',    ar:'📤 ملف مرفوع',         c:'#5B9BD6', bg:'rgba(91,155,214,.12)', bd:'rgba(91,155,214,.3)' },
              zoom_cloud:          { en:'☁ Zoom Cloud',        ar:'☁ Zoom سحابي',         c:'#2D8CFF', bg:'rgba(45,140,255,.12)', bd:'rgba(45,140,255,.3)' },
              teams_cloud:         { en:'☁ Teams Cloud',       ar:'☁ Teams سحابي',        c:'#6264A7', bg:'rgba(98,100,167,.12)', bd:'rgba(98,100,167,.3)' },
              google_meet_cloud:   { en:'☁ Google Meet Cloud', ar:'☁ Meet سحابي',         c:'#00897B', bg:'rgba(0,137,123,.12)',  bd:'rgba(0,137,123,.3)'  },
            };
            const SCOPE_LABEL = {
              local_microphone_only:   { en:'⚠ Local Mic Only',         ar:'⚠ ميكروفون محلي فقط',    c:'#f0a000', bg:'rgba(255,160,0,.12)',  bd:'rgba(255,160,0,.3)' },
              full_meeting_recording:  { en:'✓ Full Meeting Capture',    ar:'✓ تسجيل كامل للاجتماع',  c:'#2ecc8a', bg:'rgba(46,204,138,.12)', bd:'rgba(46,204,138,.3)' },
              unknown:                 { en:'? Scope Unknown',           ar:'? نطاق غير محدد',         c:'var(--text3)', bg:'var(--navy4)', bd:'var(--border2)' },
            };
            const STATUS_LABEL = {
              not_started: { en:'Not Started',     ar:'لم يبدأ',       c:'var(--text3)' },
              recording:   { en:'🔴 Recording',    ar:'🔴 جارٍ التسجيل', c:'#e05252' },
              stopped:     { en:'⏹ Stopped',       ar:'⏹ متوقف',       c:'#f0a000' },
              uploaded:    { en:'📤 Uploaded',      ar:'📤 مُرفوع',      c:'#5B9BD6' },
              processed:   { en:'✓ Processed',     ar:'✓ مُعالَج',      c:'#2ecc8a' },
              archived:    { en:'🏛 Archived',      ar:'🏛 مؤرشف',       c:'#2ecc8a' },
            };
            const capInfo    = CAPTURE_LABEL[m.recording_capture_type] || null;
            const scopeInfo  = SCOPE_LABEL[m.recording_scope]    || null;
            const stInfo     = STATUS_LABEL[recStatus]            || STATUS_LABEL.not_started;
            const isLocalOnly = m.recording_scope === 'local_microphone_only';
            return `<div style="margin:10px 0;background:var(--navy3);border:1px solid ${hasRec?'var(--border2)':'rgba(212,160,23,.18)'};border-radius:10px;padding:12px 14px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:7px">
                  <span style="font-size:15px">📼</span>
                  <div>
                    <div style="font-size:11.5px;font-weight:700;color:var(--text)">${l==='ar'?'أرشيف التسجيل':'Recording Archive'}</div>
                    <div style="font-size:10.5px;color:var(--text3);margin-top:1px">${l==='ar'?'تسجيل · اعتماد · أرشفة رسمية':'Record · Approve · Officially Archive'}</div>
                  </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
                  ${hasRec ? `<span style="font-size:11px;font-weight:700;${ST_CLR[recSt]||''}">${ST_LABEL[recSt]||recSt}</span>` : `<span style="font-size:10.5px;color:#2ecc8a;background:rgba(46,204,138,.10);border:.5px solid rgba(46,204,138,.25);padding:2px 7px;border-radius:5px">✓ ${l==='ar'?'جاهز':'Ready'}</span>`}
                  <span style="font-size:10.5px;font-weight:600;color:${stInfo.c}">${l==='ar'?stInfo.ar:stInfo.en}</span>
                </div>
              </div>
              ${hasRec ? `
                <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
                  ${capInfo ? `<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:${capInfo.bg};color:${capInfo.c};border:.5px solid ${capInfo.bd}">${l==='ar'?capInfo.ar:capInfo.en}</span>` : ''}
                  ${scopeInfo ? `<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:${scopeInfo.bg};color:${scopeInfo.c};border:.5px solid ${scopeInfo.bd}">${l==='ar'?scopeInfo.ar:scopeInfo.en}</span>` : ''}
                </div>
                ${isLocalOnly ? `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(255,160,0,.08);border:1px solid rgba(255,160,0,.22);border-radius:7px;font-size:11.5px;color:#f0a000;line-height:1.5">⚠️ ${l==='ar'?'هذا التسجيل يحتوي على الميكروفون المحلي فقط — لا يشمل أصوات المشاركين الآخرين عبر منصات الاجتماع الافتراضية.':'This recording may only contain local microphone audio — other participants on virtual platforms are not captured.'}</div>` : ''}
                ${m.recording_scope === 'full_meeting_recording' ? `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(46,204,138,.08);border:1px solid rgba(46,204,138,.25);border-radius:7px;font-size:11.5px;color:#2ecc8a;line-height:1.5">✓ ${l==='ar'?'تسجيل كامل للاجتماع متاح — يشمل جميع المشاركين.':'Full meeting recording available — captures all participants.'}</div>` : ''}
                <div style="font-size:11.5px;color:var(--text3);margin-bottom:8px;line-height:1.8">
                  📁 ${esc(m.recording_file_name||'')} &nbsp;·&nbsp; ${fmtBytes(m.recording_file_size||0)}
                  ${m.recording_uploaded_at ? ` &nbsp;·&nbsp; 📅 ${m.recording_uploaded_at.substring(0,16)}` : ''}
                  ${verifier ? `<br>✓ ${l==='ar'?'معتمد بواسطة':'Verified by'}: <strong>${esc(verifier)}</strong>${m.recording_verified_at?' · '+m.recording_verified_at.substring(0,10):''}` : ''}
                </div>
                ${m.recording_notes ? `<div style="margin-bottom:8px;padding:5px 9px;background:var(--navy2);border-radius:7px;border-inline-start:2px solid var(--gold);font-size:11.5px;color:var(--text3);line-height:1.5"><span style="font-size:11px;font-weight:700;color:var(--gold);display:block;margin-bottom:2px">${l==='ar'?'ملاحظات التسجيل:':'Recording Notes:'}</span>${esc(m.recording_notes)}</div>` : ''}
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  <a href="${esc(m.audio_recording_url)}" target="_blank" class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">▶ ${l==='ar'?'تشغيل':'Play'}</a>
                  <a href="${esc(m.audio_recording_url)}" download class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">⬇ ${l==='ar'?'تنزيل':'Download'}</a>
                  ${(recSt==='none'||recSt==='rejected') ? `<button class="btn-ghost btn-sm" onclick="RecStore.approve(${m.id},'submit')" style="font-size:11px;color:var(--gold);border-color:var(--gold)">📋 ${l==='ar'?'رفع للاعتماد':'Submit for Approval'}</button>` : ''}
                  ${recSt==='pending' ? `<button class="btn-ghost btn-sm" onclick="RecStore.approve(${m.id},'approve')" style="font-size:11px;color:#2ecc8a;border-color:#2ecc8a">✅ ${l==='ar'?'اعتماد وأرشفة':'Approve & Archive'}</button>` : ''}
                  ${recSt==='pending' ? `<button class="btn-ghost btn-sm" onclick="RecStore.approve(${m.id},'reject')" style="font-size:11px;color:#e05252;border-color:#e05252">✕ ${l==='ar'?'رفض':'Reject'}</button>` : ''}
                  ${recSt==='approved' ? `<span class="tag tg" style="font-size:11px">🏛 ${l==='ar'?'أرشيف رسمي':'Official Archive'}</span>` : ''}
                  <button class="btn-ghost btn-sm" onclick="RecStore.remove(${m.id})" style="font-size:11px;color:#e05252;margin-${l==='ar'?'right':'left'}:auto">🗑</button>
                </div>
              ` : `<div style="padding:6px 2px">
                  <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${l==='ar'?'لا يوجد تسجيل محفوظ في المنصة بعد.':'No recording stored on platform yet.'}</div>
                  <div style="font-size:11.5px;color:var(--text3);opacity:.8;line-height:1.6">${l==='ar'?'سجّل الاجتماع ← انقر على <strong style="color:var(--gold)">☁ حفظ في المنصة</strong> ← أرسله للاعتماد من رئيس مجلس الإدارة':'Record meeting → click <strong style="color:var(--gold)">☁ Save to Platform</strong> → submit for Chairman approval'}</div>
                </div>`}
            </div>`;
          })()}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap">
            ${m.shared ? `<span class="tag tg" style="font-size:11px">📤 ${l === "ar" ? "تمت المشاركة" : "Shared"}</span>` : ""}
            <button id="doc-upload-btn-${m.id}" class="btn-ghost btn-sm" onclick="DocLib.upload(${m.id})">📎 ${l === "ar" ? "إرفاق" : "Attach"}</button>
            <button class="btn-ghost btn-sm" onclick="TranscriptModal.open(${m.id})" title="${l === "ar" ? "إضافة أو تعديل النص" : "Add or edit transcript"}">✏️ ${l === "ar" ? "إضافة نص" : "Add Notes"}</button>
            ${isProcessed ? `<button id="bp-btn-${m.id}" class="btn-ghost btn-sm" onclick="BoardPack.download(${m.id})">📦 ${l === "ar" ? "حزمة المجلس" : "Board Pack"}</button>` : ""}
            ${isProcessed ? `<button class="btn-gold btn-sm" onclick="Share.open(${m.id})">📤 ${l === "ar" ? "مشاركة النتائج" : "Share Outcomes"}${App.isPro() ? "" : " ⭐"}</button>` : ""}
            ${mApprovalBtns}
            ${App.can("meetings.delete") ? `<button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick='deleteMeeting(${m.id}, ${JSON.stringify(title)})'>🗑 ${l === "ar" ? "حذف" : "Delete"}</button>` : ""}
          </div>
        </div>`;
        })
        .join("")}
    </div>`;
    // Every meeting card fires its own documents.download-gated request —
    // for a role without that permission (e.g. Employee, who has meetings.view
    // but not documents.download) this fired one 403 per meeting on every
    // load of this panel (36 in testing). loadAndRender's own catch keeps the
    // UI from breaking, but there's no reason to make requests guaranteed to
    // be rejected.
    if (App.can("documents.download")) meetings.forEach((m) => DocLib.loadAndRender(m.id));
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
  }
}

function tryParse(s, def) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return def;
  }
}

// ── Meeting History — pinned meetings and recently-opened tracking, both
// frontend-only (localStorage), since no backend field exists for either.
const MeetingPins = {
  key: "ameen_meeting_pins",
  _set: null,
  _load() {
    if (this._set) return this._set;
    try {
      this._set = new Set(JSON.parse(localStorage.getItem(this.key) || "[]"));
    } catch (e) {
      this._set = new Set();
    }
    return this._set;
  },
  has(id) {
    return this._load().has(id);
  },
  toggle(id) {
    const s = this._load();
    if (s.has(id)) s.delete(id);
    else s.add(id);
    try {
      localStorage.setItem(this.key, JSON.stringify([...s]));
    } catch (e) {}
    MeetingHistory.renderList();
  },
};
const MeetingRecent = {
  key: "ameen_meeting_recent",
  log(id) {
    let list = this.list().filter((x) => x !== id);
    list.unshift(id);
    try {
      localStorage.setItem(this.key, JSON.stringify(list.slice(0, 8)));
    } catch (e) {}
  },
  list() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || "[]");
    } catch (e) {
      return [];
    }
  },
};

// ══ Meeting History ═══════════════════════════════════════════════════════════
// Searchable, click-to-view archive. Reads from the same /api/meetings list and
// the /api/meetings/:id/full aggregate — no separate storage of its own.
const MeetingHistory = {
  _all: [],
  _filtered: [],
  _selectedId: null,
  _searchTimer: null,
  _q: "",
  _groupBySeries: false,
  _collapsed: {},

  async refresh() {
    const list = $("hist-list");
    if (list) list.innerHTML = '<div class="es"><div class="loading"></div></div>';
    if (!this._selectedId) this.renderEmptyDetail();
    try {
      this._all = await api("/api/meetings");
      this._populateGovFilters();
      this.applyFilters();
      // Re-render the open workspace too (not just the list) — otherwise a
      // language switch or panel re-entry leaves the detail pane showing
      // stale text in the previous language.
      if (this._selectedId) this.select(this._selectedId);
    } catch (e) {
      if (list) list.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },
  // Populates the Board / Committee / Series filter dropdowns from whatever
  // is actually referenced by the loaded meetings — no separate fetch needed.
  _populateGovFilters() {
    const l = App.lang;
    const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { if (!x || seen.has(x.id)) return false; seen.add(x.id); return true; }); };
    const boards = uniq(this._all.filter((m) => m.board_id).map((m) => ({ id: m.board_id, ar: m.board_name_ar, en: m.board_name_en })));
    const committees = uniq(this._all.filter((m) => m.committee_id).map((m) => ({ id: m.committee_id, ar: m.committee_name_ar, en: m.committee_name_en })));
    const series = uniq(this._all.filter((m) => m.series_id).map((m) => ({ id: m.series_id, ar: m.series_name_ar, en: m.series_name_en })));
    const fill = (id, items, allAr, allEn) => {
      const sel = $(id);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = `<option value="">${l === "ar" ? allAr : allEn}</option>` +
        items.map((x) => `<option value="${x.id}">${esc(l === "ar" ? x.ar : (x.en || x.ar))}</option>`).join("");
      sel.value = current;
    };
    fill("hist-filter-board", boards, "كل المجالس", "All Boards");
    fill("hist-filter-committee", committees, "كل اللجان", "All Committees");
    fill("hist-filter-series", series, "كل السلاسل", "All Series");
  },
  onSearch(q) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._q = (q || "").trim().toLowerCase();
      this.applyFilters();
    }, 300);
  },
  _provider(m) {
    return m.source_type === "text_minutes" ? "text_minutes" : (m.recording_capture_type || "browser_microphone");
  },
  toggleGroupBySeries() {
    this._groupBySeries = !this._groupBySeries;
    const btn = $("hist-group-toggle");
    if (btn) btn.classList.toggle("active", this._groupBySeries);
    this.renderList();
  },
  toggleGroup(key) {
    this._collapsed[key] = !this._collapsed[key];
    this.renderList();
  },
  applyFilters() {
    const type = ($("hist-filter-type") || {}).value || "";
    const provider = ($("hist-filter-provider") || {}).value || "";
    const status = ($("hist-filter-status") || {}).value || "";
    const approval = ($("hist-filter-approval") || {}).value || "";
    const boardId = parseInt(($("hist-filter-board") || {}).value) || 0;
    const committeeId = parseInt(($("hist-filter-committee") || {}).value) || 0;
    const seriesId = parseInt(($("hist-filter-series") || {}).value) || 0;
    const q = this._q;
    this._filtered = this._all.filter((m) => {
      if (type && m.meeting_type !== type) return false;
      if (provider && this._provider(m) !== provider) return false;
      if (status && (m.status || "draft") !== status) return false;
      if (approval && (m.minutes_status || "draft") !== approval) return false;
      if (boardId && m.board_id !== boardId) return false;
      if (committeeId && m.committee_id !== committeeId) return false;
      if (seriesId && m.series_id !== seriesId) return false;
      if (q) {
        const hay = [m.title_ar, m.title_en, m.ai_summary_ar, m.ai_summary_en, m.series_name_ar, m.series_name_en, m.board_name_ar, m.board_name_en, m.committee_name_ar, m.committee_name_en].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    this.renderList();
  },
  resetFilters() {
    this._q = "";
    const search = $("hist-search");
    if (search) search.value = "";
    ["hist-filter-type", "hist-filter-provider", "hist-filter-status", "hist-filter-approval", "hist-filter-board", "hist-filter-committee", "hist-filter-series"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    this.applyFilters();
  },
  _itemHtml(m, l) {
    const title = l === "ar" ? m.title_ar : m.title_en || m.title_ar;
    const date = (m.meeting_date || "").substring(0, 10);
    const isProcessed = m.status === "processed";
    const pinned = MeetingPins.has(m.id);
    return `<div class="hist-item${this._selectedId === m.id ? " active" : ""}" style="position:relative" onclick="MeetingHistory.select(${m.id})">
      <button onclick="event.stopPropagation();MeetingPins.toggle(${m.id})" style="position:absolute;top:8px;inset-inline-end:6px;background:none;border:none;cursor:pointer;font-size:12px;color:${pinned ? "var(--gold)" : "var(--text3)"};padding:2px" title="${l === "ar" ? "تثبيت" : "Pin"}" aria-label="${l === "ar" ? "تثبيت الاجتماع" : "Pin meeting"}">${pinned ? "📌" : "📍"}</button>
      <div class="hist-item-title" style="padding-inline-end:16px">${esc(title)}</div>
      <div class="hist-item-meta">
        <span>📅 ${date}</span>
        <span>${isProcessed ? "✓" : "○"} ${isProcessed ? (l === "ar" ? "مُعالج" : "Processed") : l === "ar" ? "جديد" : "New"}</span>
        ${m.source_type === "text_minutes" ? `<span>📝 ${l === "ar" ? "نصي" : "Text"}</span>` : ""}
      </div>
    </div>`;
  },
  // Pinned + Recently Opened — shown above the main list/groups when not
  // actively searching, so the meetings an executive returns to most are
  // always one glance away.
  _pinnedRecentHtml(l) {
    if (this._q) return "";
    const byId = {};
    this._all.forEach((m) => { byId[m.id] = m; });
    const pinned = this._all.filter((m) => MeetingPins.has(m.id));
    const recentIds = MeetingRecent.list().filter((id) => byId[id] && !MeetingPins.has(id)).slice(0, 5);
    let html = "";
    if (pinned.length) {
      html += `<div class="hist-group-h" style="cursor:default"><span>📌 ${l === "ar" ? "مثبّتة" : "Pinned"}</span><span class="hist-group-count">${pinned.length}</span></div>${pinned.map((m) => this._itemHtml(m, l)).join("")}`;
    }
    if (recentIds.length) {
      html += `<div class="hist-group-h" style="cursor:default"><span>🕐 ${l === "ar" ? "فُتحت مؤخراً" : "Recently Opened"}</span><span class="hist-group-count">${recentIds.length}</span></div>${recentIds.map((id) => this._itemHtml(byId[id], l)).join("")}`;
    }
    return html;
  },
  // Render target: 'hist' for the Meeting History panel's searchable
  // list+detail split view, 'ws' for the standalone Meeting Workspace panel
  // (single-meeting view, no list alongside — see WorkspacePanel below).
  // Both panels carry an identically-shaped set of container ids (just with
  // the matching prefix) so this same rendering code drives both.
  _target: "hist",
  renderList() {
    if (this._target !== "hist") return;
    const list = $("hist-list");
    if (!list) return;
    const l = App.lang;
    if (!this._all.length) {
      list.innerHTML = emptyStateCard({
        icon: "🗂",
        titleAr: "لا توجد اجتماعات بعد",
        titleEn: "No meetings yet",
        descAr: "بمجرد إنشاء اجتماعك الأول، ستظهر هنا مساحة عمل كاملة لكل اجتماع.",
        descEn: "Once you create your first meeting, a full workspace for it will appear here.",
        primary: { ar: "➕ إنشاء اجتماع", en: "➕ Create Meeting", onclick: "Panels.load('create-meeting')" },
      });
      this.renderEmptyDetail();
      return;
    }
    if (!this._filtered.length) {
      list.innerHTML = emptyStateCard({
        icon: "🔍",
        titleAr: "لا توجد نتائج مطابقة",
        titleEn: "No matching meetings",
        descAr: "جرّب تعديل كلمة البحث أو إعادة تعيين المرشحات.",
        descEn: "Try adjusting your search or resetting the filters.",
        secondary: { ar: "✕ إعادة تعيين المرشحات", en: "✕ Reset Filters", onclick: "MeetingHistory.resetFilters()" },
      });
      return;
    }
    if (this._selectedId && !this._filtered.some((m) => m.id === this._selectedId)) {
      this._selectedId = null;
      this.renderEmptyDetail();
    }
    if (!this._groupBySeries) {
      list.innerHTML = this._pinnedRecentHtml(l) + this._filtered.map((m) => this._itemHtml(m, l)).join("");
      return;
    }
    // Grouped view: one collapsible section per series (date-sorted), plus a
    // trailing "Standalone" group for meetings with no series_id.
    const groups = {};
    const order = [];
    this._filtered.forEach((m) => {
      const key = m.series_id ? `s${m.series_id}` : "standalone";
      if (!groups[key]) { groups[key] = { label: m.series_id ? (l === "ar" ? m.series_name_ar : (m.series_name_en || m.series_name_ar)) : (l === "ar" ? "مستقلة" : "Standalone"), items: [] }; order.push(key); }
      groups[key].items.push(m);
    });
    const groupsHtml = order.map((key) => {
      const g = groups[key];
      g.items.sort((a, b) => (a.meeting_date || "").localeCompare(b.meeting_date || ""));
      const collapsed = !!this._collapsed[key];
      return `<div class="hist-group">
        <div class="hist-group-h" onclick="MeetingHistory.toggleGroup('${key}')">
          <span>${collapsed ? "▸" : "▾"} ${key === "standalone" ? "🗂" : "🔗"} ${esc(g.label)}</span>
          <span class="hist-group-count">${g.items.length}</span>
        </div>
        ${collapsed ? "" : g.items.map((m) => this._itemHtml(m, l)).join("")}
      </div>`;
    }).join("");
    list.innerHTML = this._pinnedRecentHtml(l) + groupsHtml;
  },
  renderEmptyDetail() {
    const detail = $(`${this._target}-detail`);
    if (!detail) return;
    const l = App.lang;
    detail.innerHTML = `<div class="es" style="height:100%;justify-content:center">
      <div style="font-size:40px;margin-bottom:12px">🗂</div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">${l === "ar" ? "اختر اجتماعاً لعرض التفاصيل" : "Select a meeting to view details"}</div>
      <div style="font-size:11.5px;color:var(--text3);max-width:320px">${l === "ar" ? "ستظهر هنا نظرة عامة كاملة، جدول الأعمال، الحضور، النص، الملخص، القرارات، المهام، والمرفقات." : "A full overview, agenda, attendees, transcript, summary, decisions, tasks, and attachments will appear here."}</div>
    </div>`;
  },
  async select(id) {
    // Reset to the Overview tab only when switching to a genuinely different
    // meeting — re-selecting the same one (e.g. a language switch triggering
    // a refresh) should leave whichever tab the user was already viewing.
    if (id !== this._selectedId) this._tab = "overview";
    this._selectedId = id;
    MeetingRecent.log(id);
    if (this._target === "hist") this.renderList();
    const detail = $(`${this._target}-detail`);
    const l = App.lang;
    if (detail) detail.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      // /full now assembles series continuity + the Previous Meeting Review
      // server-side (effective_prev_meeting_id, series_timeline, series_stats,
      // previous_review) — no extra round trips needed here.
      const full = await api(`/api/meetings/${id}/full`);
      this.renderDetail(full);
    } catch (e) {
      if (detail) detail.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },
  // ── Meeting Workspace tabs — the single-meeting view is organized into
  // named tabs (Overview / Agenda & Participants / Recording & Transcript /
  // AI Review / Executive Actions / Documents / Timeline / Reports) instead
  // of one long scroll, so this view can act as the app's "Meeting Workspace"
  // without any page switching. Tab bodies are cached on select(); setTab()
  // only swaps the visible body, no re-fetch.
  _tab: "overview",
  _tabs: null,
  TABS: [
    { key: "overview", ar: "نظرة عامة", en: "Overview", icon: "📋" },
    { key: "agenda", ar: "الأعمال والحضور", en: "Agenda & Participants", icon: "🗒️" },
    { key: "recording", ar: "التسجيل والنص", en: "Recording & Transcript", icon: "🗣️" },
    { key: "ai", ar: "مراجعة الذكاء الاصطناعي", en: "AI Review & Minutes", icon: "✦" },
    { key: "actions", ar: "الإجراءات التنفيذية", en: "Executive Actions", icon: "🎯" },
    { key: "documents", ar: "المستندات", en: "Documents", icon: "📎" },
    { key: "timeline", ar: "الجدول الزمني", en: "Timeline", icon: "🕐" },
    { key: "reports", ar: "التقارير", en: "Reports", icon: "📦" },
  ],
  setTab(tab) {
    this._tab = tab;
    document.querySelectorAll(`#${this._target}-detail-tabs .imp-seg-btn`).forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const body = $(`${this._target}-tab-body`);
    if (body && this._tabs) body.innerHTML = this._tabs[tab] || "";
  },
  renderDetail(full) {
    const detail = $(`${this._target}-detail`);
    if (!detail) return;
    const l = App.lang;
    const m = full.meeting;
    const title = l === "ar" ? m.title_ar : m.title_en || m.title_ar;
    const tasks = full.tasks && full.tasks.length ? full.tasks : tryParse(m.ai_tasks, []);
    const decisions = full.decisions && full.decisions.length ? full.decisions : tryParse(m.ai_decisions, []);
    const speakerTr = tryParse(m.speaker_transcript, []);
    const summary = l === "ar" ? m.ai_summary_ar || "" : m.ai_summary_en || m.ai_summary_ar || "";
    // No cross-language fallback here (unlike summary above): minutes_ar/en
    // are independently generated now, so an honest empty/error state beats
    // silently showing the other language's document mislabeled.
    const minutesRaw = l === "ar" ? m.ai_minutes_ar || "" : m.ai_minutes_en || "";
    const isProcessed = m.status === "processed";
    const providerLabels = {
      browser_microphone: l === "ar" ? "🖥 ميكروفون المتصفح" : "🖥 Browser Microphone",
      uploaded_recording: l === "ar" ? "📤 ملف مرفوع" : "📤 Uploaded File",
      zoom_cloud: "☁ Zoom Cloud",
      teams_cloud: "☁ Teams Cloud",
      google_meet_cloud: "☁ Google Meet Cloud",
      text_minutes: l === "ar" ? "📝 محضر نصي" : "📝 Text Minutes",
    };
    const provider = m.source_type === "text_minutes" ? "text_minutes" : m.recording_capture_type || "browser_microphone";

    const sec = (icon, labelAr, labelEn, bodyHtml) => `<div class="hist-sec">
      <div class="hist-sec-h">${icon} ${l === "ar" ? labelAr : labelEn}</div>
      <div class="hist-sec-body">${bodyHtml}</div>
    </div>`;
    const emptyRow = (ar, en) => `<div class="hist-empty-row">${l === "ar" ? ar : en}</div>`;

    const reportsHtml = isProcessed
      ? `<button class="btn-gold btn-sm" onclick="BoardPack.download(${m.id})">📦 ${l === "ar" ? "تنزيل حزمة المجلس (PDF)" : "Download Board Pack (PDF)"}</button>`
      : emptyRow("يجب معالجة الاجتماع أولاً لتوليد التقارير", "The meeting must be AI-processed before reports can be generated");

    // ── Meeting Series (Phase 2): timeline, series info card, previous review ──
    const seriesName = m.series_id ? (l === "ar" ? m.series_name_ar : (m.series_name_en || m.series_name_ar)) : "";
    const prevNavHtml = (full.effective_prev_meeting_id || full.next_meeting_id) ? `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        ${full.effective_prev_meeting_id ? `<button class="btn-ghost btn-sm" onclick="MeetingHistory.select(${full.effective_prev_meeting_id})">${l === "ar" ? "◀ الاجتماع السابق" : "◀ Previous Meeting"}</button>` : ""}
        ${full.next_meeting_id ? `<button class="btn-ghost btn-sm" onclick="MeetingHistory.select(${full.next_meeting_id})">${l === "ar" ? "الاجتماع التالي ▶" : "Next Meeting ▶"}</button>` : ""}
      </div>` : "";

    const timelineHtml = (full.series_timeline && full.series_timeline.length) ? `
      <div class="series-timeline">
        ${full.series_timeline.map((t) => {
          const isCurrent = t.id === m.id && t.kind === "held";
          const tt = l === "ar" ? t.title_ar : (t.title_en || t.title_ar);
          const date = (t.meeting_date || "").substring(0, 10);
          return `<div class="series-tl-item ${isCurrent ? "current" : ""} series-tl-${t.kind}" ${t.kind === "held" ? `onclick="MeetingHistory.select(${t.id})"` : ""}>
            <div class="series-tl-dot"></div>
            <div class="series-tl-body">
              <div class="series-tl-title">${esc(tt)}</div>
              <div class="series-tl-meta">${date}${t.kind === "planned" ? " · " + (l === "ar" ? "قادم" : "Upcoming") : ""}</div>
            </div>
          </div>`;
        }).join("")}
      </div>` : "";

    // ── Timeline-first: for meetings in a series, the chronological chain
    // (with Previous/Current/Next already resolvable via prevNavHtml above)
    // is promoted to the top of the page — persistently visible, not buried
    // inside a tab — since it's the primary way an executive orients around
    // a recurring meeting. Standalone meetings show no series widget at all,
    // keeping their layout exactly as before.
    const seriesTimelineTopHtml = timelineHtml ? `<div class="hist-sec" style="margin-bottom:10px">
      <div class="hist-sec-h">🔗 ${l === "ar" ? `الجدول الزمني للسلسلة — ${esc(seriesName)}` : `Series Timeline — ${esc(seriesName)}`}</div>
      <div class="hist-sec-body">${timelineHtml}</div>
    </div>` : "";

    const seriesInfoHtml = m.series_id ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:8px">
        <div>${l === "ar" ? "السلسلة" : "Series"}: <strong>${esc(seriesName)}</strong></div>
        ${m.series_category ? `<div>${l === "ar" ? "الفئة" : "Category"}: <strong>${esc(m.series_category)}</strong></div>` : ""}
      </div>
      ${(m.series_description_ar || m.series_description_en) ? `<div style="font-size:11.5px;color:var(--text3);margin-bottom:10px">${esc(l === "ar" ? (m.series_description_ar || "") : (m.series_description_en || m.series_description_ar || ""))}</div>` : ""}
      ${full.series_stats ? `
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px">
        <div><div style="color:var(--text3);font-size:11px">${l === "ar" ? "إجمالي" : "Total"}</div><div style="font-weight:700">${full.series_stats.total_meetings}</div></div>
        <div><div style="color:var(--text3);font-size:11px">${l === "ar" ? "مكتملة" : "Completed"}</div><div style="font-weight:700;color:var(--green)">${full.series_stats.completed_meetings}</div></div>
        <div><div style="color:var(--text3);font-size:11px">${l === "ar" ? "قادمة" : "Upcoming"}</div><div style="font-weight:700;color:var(--blue)">${full.series_stats.pending_meetings}</div></div>
      </div>
      <div class="series-progress-bar"><div class="series-progress-fill" style="width:${full.series_stats.completion_pct}%"></div></div>
      <div style="font-size:11px;color:var(--text3);margin:4px 0 10px">${l === "ar" ? "نسبة الإنجاز" : "Completion"}: ${full.series_stats.completion_pct}%</div>
      ` : ""}
      ${timelineHtml ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${l === "ar" ? "↑ الجدول الزمني الكامل معروض أعلى الصفحة" : "↑ Full chronological timeline is shown at the top of this page"}</div>` : ""}
    ` : emptyRow("هذا اجتماع مستقل وليس جزءاً من أي سلسلة اجتماعات", "This is a standalone meeting, not part of any meeting series");

    const pr = full.previous_review;
    const prevSummary = pr && (l === "ar" ? pr.meeting.ai_summary_ar : (pr.meeting.ai_summary_en || pr.meeting.ai_summary_ar));
    const prevMinutesRaw = pr && (l === "ar" ? pr.meeting.ai_minutes_ar : pr.meeting.ai_minutes_en) || "";
    const prevReviewHtml = pr ? `
      <div style="margin-bottom:10px;font-size:11.5px;color:var(--text3)">${esc(l === "ar" ? pr.meeting.title_ar : (pr.meeting.title_en || pr.meeting.title_ar))} — ${(pr.meeting.meeting_date || "").substring(0, 10)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div class="prev-review-stat"><span>${l === "ar" ? "قرارات معلّقة" : "Outstanding Decisions"}</span><strong>${pr.outstanding_decisions.length}</strong></div>
        <div class="prev-review-stat"><span>${l === "ar" ? "قرارات منجزة" : "Completed Decisions"}</span><strong style="color:var(--green)">${pr.completed_decisions.length}</strong></div>
        <div class="prev-review-stat"><span>${l === "ar" ? "إجراءات معلّقة" : "Pending Actions"}</span><strong>${pr.pending_actions.length}</strong></div>
        <div class="prev-review-stat"><span>${l === "ar" ? "إجراءات متأخرة" : "Overdue Actions"}</span><strong style="color:var(--red)">${pr.overdue_actions.length}</strong></div>
        <div class="prev-review-stat"><span>${l === "ar" ? "إجراءات معطّلة" : "Blocked Actions"}</span><strong style="color:var(--amber)">${pr.blocked_actions.length}</strong></div>
        <div class="prev-review-stat"><span>${l === "ar" ? "مخاطر مفتوحة" : "Open Risks"}</span><strong>${pr.open_risks.length}</strong></div>
      </div>
      ${prevSummary ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;color:var(--text3);font-size:11.5px">${l === "ar" ? "الملخص الذكي للاجتماع السابق" : "Previous AI Summary"}</summary><div style="margin-top:6px;white-space:pre-wrap">${esc(prevSummary)}</div></details>` : ""}
      ${prevMinutesRaw ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;color:var(--text3);font-size:11.5px">${l === "ar" ? "محضر الاجتماع السابق" : "Previous Minutes"}</summary><div style="margin-top:6px">${renderMinutesDoc(prevMinutesRaw, l)}</div></details>` : ""}
      ${pr.attachments.length ? `<div style="font-size:11.5px;color:var(--text3);margin-bottom:4px">${l === "ar" ? "مرفقات سابقة" : "Previous Attachments"}:</div><div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">${pr.attachments.map((d) => `<a href="/uploads/${esc(d.file_path)}" download="${esc(d.title || "")}" class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none;width:fit-content">📎 ${esc(d.title || d.title_ar || d.title_en || "")}</a>`).join("")}</div>` : ""}
      <button class="btn-ghost btn-sm" onclick="MeetingHistory.select(${pr.meeting.id})">${l === "ar" ? "عرض الاجتماع السابق بالكامل" : "View full previous meeting"}</button>
    ` : "";

    // ── Minutes approval controls — same state machine/actions already used
    // in Transcripts & Minutes (minutesApprovalAction/minutesShowLog), surfaced
    // here too so approving minutes doesn't require switching panels.
    const lcStage = m.lifecycle_stage || "created";
    const mStatus = m.minutes_status || "draft";
    const mVersion = m.minutes_version || 1;
    const mStatusBadge = (() => {
      if (mStatus === "draft") return "";
      const stLabels = { circulated: l === "ar" ? "📤 قيد الاعتماد" : "📤 Circulated", approved: l === "ar" ? "✅ معتمد" : "✅ Approved", revision_requested: l === "ar" ? "🔄 يحتاج مراجعة" : "🔄 Revision Needed", final_approved: l === "ar" ? "🏆 معتمد نهائياً" : "🏆 Final Approved" };
      const stStyles = { circulated: "background:rgba(255,160,0,.15);color:#f0a000", approved: "background:rgba(50,180,100,.15);color:#32b464", revision_requested: "background:rgba(220,50,50,.15);color:#e05252", final_approved: "background:rgba(40,120,220,.15);color:#2878dc" };
      const ver = mVersion > 1 ? ` v${mVersion}` : "";
      return `<span class="tag" style="${stStyles[mStatus] || ""}">${stLabels[mStatus] || mStatus}${ver}</span>`;
    })();
    const mApprovalBtns = (() => {
      const btns = [];
      if (mStatus === "draft" || mStatus === "revision_requested") {
        btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'circulate')" style="color:var(--gold);border-color:var(--gold)">📤 ${l === "ar" ? "تعميم للاعتماد" : "Circulate"}</button>`);
      }
      if (mStatus === "circulated") {
        btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'approve')" style="color:#32b464;border-color:#32b464">✅ ${l === "ar" ? "اعتماد" : "Approve"}</button>`);
        btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'request-revision')" style="color:#e05252;border-color:#e05252">🔄 ${l === "ar" ? "طلب مراجعة" : "Request Revision"}</button>`);
      }
      if (mStatus === "approved") {
        btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'final-approve')" style="color:#2878dc;border-color:#2878dc">🏆 ${l === "ar" ? "اعتماد نهائي" : "Final Approve"}</button>`);
      }
      if (mStatus !== "draft") {
        btns.push(`<button class="btn-ghost btn-sm" onclick="minutesShowLog(${m.id})" style="font-size:11px">📋 ${l === "ar" ? "سجل الاعتماد" : "Approval Log"}</button>`);
      }
      if (lcStage === "approval") {
        btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'archive')" style="color:var(--text3);border-color:var(--text3)">🗄️ ${l === "ar" ? "أرشفة" : "Archive"}</button>`);
      }
      return btns.join("");
    })();

    // ── Tab bodies — grouped from the same sections as before, just organized
    // as named tabs instead of one long scroll (this view IS the Meeting
    // Workspace: no separate page for agenda/AI review/actions/documents).
    const overviewBody = `
      ${sec(
        "📋",
        "نظرة عامة",
        "Overview",
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px">
          <div>${l === "ar" ? "نوع الاجتماع" : "Meeting Type"}: <strong>${esc(mtLabel(m.meeting_type, l) || (l === "ar" ? "غير محدد" : "Not set"))}</strong></div>
          <div>${l === "ar" ? "المسجّل" : "Recorded By"}: <strong>${esc((l === "ar" ? m.recorder_ar : m.recorder_en) || "—")}</strong></div>
          ${m.board_name_ar ? `<div>${l === "ar" ? "المجلس" : "Board"}: <strong>${esc(l === "ar" ? m.board_name_ar : m.board_name_en)}</strong></div>` : ""}
          ${m.committee_name_ar ? `<div>${l === "ar" ? "اللجنة" : "Committee"}: <strong>${esc(l === "ar" ? m.committee_name_ar : m.committee_name_en)}</strong></div>` : ""}
          ${m.platform ? `<div>📡 ${l === "ar" ? "التنسيق" : "Format"}: <strong>${esc(platLabel(m.platform, l))}</strong></div>` : ""}
          ${m.meeting_location ? `<div>📍 ${l === "ar" ? "الموقع" : "Location"}: <strong>${esc(m.meeting_location)}</strong></div>` : ""}
          <div>${l === "ar" ? "الحالة العاطفية" : "Sentiment"}: <strong>${esc(m.ai_sentiment || "—")}</strong></div>
        </div>`,
      )}
      ${sec("🧭", "الجدول الزمني ومعلومات السلسلة", "Meeting Timeline & Series Info", seriesInfoHtml)}
      ${pr ? sec("🔁", "مراجعة إجراءات الاجتماع السابق", "Previous Meeting Review", prevReviewHtml) : ""}
    `;

    const agendaBody = `
      ${sec(
        "👥",
        "الحضور",
        "Attendees",
        full.attendees.length
          ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${full.attendees
            .map(
              (a) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border2)">
            <span>${esc(a.name)}</span>
            <span style="color:var(--text3);font-size:11px">${esc(a.email || "")} ${a.confirmed ? `· ✓ ${l === "ar" ? "مؤكد" : "Confirmed"}` : ""}</span>
          </div>`,
            )
            .join("")}
        </div>`
          : emptyRow("لا يوجد حضور مسجّل لهذا الاجتماع", "No attendees recorded for this meeting"),
      )}
      ${sec(
        "🗒️",
        "جدول الأعمال",
        "Agenda",
        full.agenda.length
          ? `<div style="display:flex;flex-direction:column;gap:0">
          ${full.agenda
            .map(
              (a, i) => `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:.5px solid var(--border2)">
                ${App.can("meetings.edit") ? `<div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;margin-top:1px">
                  <button class="btn-ghost btn-sm" style="padding:1px 6px;font-size:10px;line-height:1.4;min-width:0" ${i === 0 ? "disabled" : ""} onclick="reorderAgendaItem(${m.id},${a.id},'up')" title="${l === "ar" ? "للأعلى" : "Move up"}">▲</button>
                  <button class="btn-ghost btn-sm" style="padding:1px 6px;font-size:10px;line-height:1.4;min-width:0" ${i === full.agenda.length - 1 ? "disabled" : ""} onclick="reorderAgendaItem(${m.id},${a.id},'down')" title="${l === "ar" ? "للأسفل" : "Move down"}">▼</button>
                </div>` : ""}
                <div style="flex:1;min-width:0">
                  <div style="font-size:12.5px;font-weight:600">${i + 1}. ${esc(l === "ar" ? a.title_ar || a.title_en || a.title : a.title_en || a.title_ar || a.title)}</div>
                  ${a.presenter ? `<div style="font-size:11px;color:var(--text3)">${esc(a.presenter)}</div>` : ""}
                  ${(a.description_ar || a.description_en || a.description) ? `<div style="font-size:11.5px;color:var(--text2);margin-top:2px">${esc(l === "ar" ? a.description_ar || a.description_en || a.description : a.description_en || a.description_ar || a.description)}</div>` : ""}
                </div>
                ${a.duration_mins ? `<span style="font-size:10px;color:var(--text3);flex-shrink:0;white-space:nowrap">${a.duration_mins}${l === "ar" ? " د" : " m"}</span>` : ""}
              </div>`
            )
            .join("")}
        </div>`
          : emptyRow("لا يوجد جدول أعمال مسجّل لهذا الاجتماع", "No agenda recorded for this meeting"),
      )}
    `;

    const recordingBody = `
      ${sec(
        "🗣️",
        "النص الكامل",
        "Transcript",
        speakerTr.length
          ? `<div class="tr-box" style="max-height:260px;overflow-y:auto">
          ${speakerTr
            .map(
              (s) => `<div style="padding:5px 0;border-bottom:.5px solid var(--border2)">
            <div style="font-size:11px;font-weight:700;color:var(--gold)">${esc(s.speaker || (l === "ar" ? "متحدث" : "Speaker"))}</div>
            <div>${esc(l === "ar" ? s.text_ar || s.text_en || "" : s.text_en || s.text_ar || "")}</div>
          </div>`,
            )
            .join("")}
        </div>`
          : m.transcript
            ? `<div class="tr-box" style="max-height:260px;overflow-y:auto;white-space:pre-wrap">${esc(m.transcript)}</div>`
            : emptyRow("لا يوجد نص مسجّل لهذا الاجتماع", "No transcript recorded for this meeting"),
      )}
      ${sec(
        "📼",
        "أرشيف التسجيل",
        "Recording Archive",
        m.audio_recording_url
          ? `<div>
          <div style="margin-bottom:6px">${providerLabels[provider] || provider} ${m.recording_approval_status ? `· <span class="tag" style="background:var(--navy4)">${esc(m.recording_approval_status)}</span>` : ""}</div>
          <div style="display:flex;gap:6px">
            <a href="${esc(m.audio_recording_url)}" target="_blank" class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">▶ ${l === "ar" ? "تشغيل" : "Play"}</a>
            <a href="${esc(m.audio_recording_url)}" download class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">⬇ ${l === "ar" ? "تنزيل" : "Download"}</a>
          </div>
        </div>`
          : emptyRow("لا يوجد تسجيل مؤرشف لهذا الاجتماع", "No recording archived for this meeting"),
      )}
    `;

    const aiBody = `
      ${sec(
        "✦",
        "المحضر الرسمي للاجتماع",
        "Official Meeting Minutes",
        (minutesRaw
          ? renderMinutesDoc(minutesRaw, l)
          : summary
          ? `<div class="minutes-doc"><div class="minutes-exec-summary" style="border:none;padding-bottom:0;margin-bottom:0">${esc(summary)}</div></div>`
          : emptyRow("لم تتم معالجة هذا الاجتماع بعد بواسطة الذكاء الاصطناعي", "This meeting has not been AI-processed yet")) +
          (mApprovalBtns ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${mStatusBadge}${mApprovalBtns}<button class="btn-ghost btn-sm" onclick="printMeetingMinutes(${m.id})" style="font-size:11px">🖨 ${l === "ar" ? "طباعة" : "Print"}</button></div>` : mStatusBadge ? `<div style="margin-top:10px">${mStatusBadge}<button class="btn-ghost btn-sm" onclick="printMeetingMinutes(${m.id})" style="font-size:11px;margin-inline-start:6px">🖨 ${l === "ar" ? "طباعة" : "Print"}</button></div>` : `<div style="margin-top:10px"><button class="btn-ghost btn-sm" onclick="printMeetingMinutes(${m.id})" style="font-size:11px">🖨 ${l === "ar" ? "طباعة المحضر" : "Print Minutes"}</button></div>`),
      )}
      ${sec(
        "⚖️",
        "القرارات",
        "Decisions",
        decisions.length
          ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${decisions
            .map(
              (d) => `<div style="padding:5px 0;border-bottom:.5px solid var(--border2)">${esc(l === "ar" ? d.text_ar || d.text_en : d.text_en || d.text_ar)} ${d.status ? `<span class="tag" style="background:var(--navy4);margin-inline-start:5px">${esc(d.status)}</span>` : ""}</div>`,
            )
            .join("")}
        </div>`
          : emptyRow("لا توجد قرارات مسجّلة لهذا الاجتماع", "No decisions recorded for this meeting"),
      )}
    `;

    const actionsBody = `
      ${sec(
        "🎯",
        "الإجراءات التنفيذية",
        "Executive Actions",
        execActionsSummaryChips(full.tasks, l),
      )}
      ${sec(
        "✅",
        "المهام",
        "Tasks",
        tasks.length
          ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${tasks
            .map(
              (t) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2)">
            <span>${esc(l === "ar" ? t.text_ar || t.text_en : t.text_en || t.text_ar)}</span>
            <span style="color:var(--text3);font-size:11px">${esc((l === "ar" ? t.owner_name_ar || t.owner_ar : t.owner_name_en || t.owner_en) || "")} ${t.due_date || t.due ? `· ${t.due_date || t.due}` : ""}</span>
          </div>`,
            )
            .join("")}
        </div>`
          : emptyRow("لا توجد مهام مسجّلة لهذا الاجتماع", "No tasks recorded for this meeting"),
      )}
    `;

    const documentsBody = sec(
      "📎",
      "المستندات والمرفقات",
      "Documents / Attachments",
      full.documents.length
        ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${full.documents
            .map(
              (d) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2)">
            <span>${DocLib.icon(d.doc_type)} ${esc(d.title)}</span>
            <a href="/uploads/${esc(d.file_path)}" download="${esc(d.title)}" class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">⬇ ${l === "ar" ? "تنزيل" : "Download"}</a>
          </div>`,
            )
            .join("")}
        </div>`
        : emptyRow("لا توجد مرفقات لهذا الاجتماع", "No attachments for this meeting"),
    );

    const timelineBody = sec(
      "🕐",
      "الجدول الزمني",
      "Lifecycle Timeline",
      full.lifecycle.length
        ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${full.lifecycle
            .map(
              (ev) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2);font-size:11.5px">
            <span>${esc(ev.to_stage)}${ev.note ? ` — ${esc(ev.note)}` : ""}</span>
            <span style="color:var(--text3)">${esc(ev.actor_name || "")} · ${(ev.created_at || "").substring(0, 16)}</span>
          </div>`,
            )
            .join("")}
        </div>`
        : emptyRow("لا يوجد سجل زمني لهذا الاجتماع", "No lifecycle history for this meeting"),
    );

    const reportsBody = sec("📦", "التقارير", "Reports", reportsHtml);

    // ── Meeting Health — a glanceable, honestly-derived summary (no
    // fabricated "AI confidence" score; the model exposes no such metric).
    // Processing status and approval status come straight from the meeting
    // record; data completeness counts how many of the four core artifacts
    // (transcript, AI summary, decisions, tasks) actually exist.
    const mStatusLabels = {
      draft: { ar: "مسودة", en: "Draft" },
      circulated: { ar: "قيد الاعتماد", en: "Circulated" },
      approved: { ar: "مُعتمد", en: "Approved" },
      revision_requested: { ar: "يحتاج مراجعة", en: "Revision Needed" },
      final_approved: { ar: "معتمد نهائياً", en: "Final Approved" },
    };
    const mStatusColor = { draft: "var(--text3)", circulated: "var(--amber)", approved: "var(--green)", revision_requested: "var(--red)", final_approved: "var(--blue)" }[mStatus] || "var(--text3)";
    const mStatusLabel = mStatusLabels[mStatus] || { ar: mStatus, en: mStatus };
    const dataPoints = [
      !!(m.transcript || speakerTr.length),
      !!summary,
      decisions.length > 0,
      tasks.length > 0,
    ];
    const dataScore = dataPoints.filter(Boolean).length;
    const dataColor = dataScore === 4 ? "var(--green)" : dataScore >= 2 ? "var(--amber)" : "var(--red)";
    const healthMeter = (icon, value, labelAr, labelEn, color) => `<div style="flex:1;min-width:150px;background:var(--navy3);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px">
      <div style="font-size:19px;flex-shrink:0">${icon}</div>
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:700;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${value}</div>
        <div style="font-size:10.5px;color:var(--text3)">${l === "ar" ? labelAr : labelEn}</div>
      </div>
    </div>`;
    const meetingHealthHtml = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${healthMeter(isProcessed ? "✓" : "○", isProcessed ? (l === "ar" ? "مُعالج بالذكاء الاصطناعي" : "AI Processed") : l === "ar" ? "لم تتم المعالجة بعد" : "Not Processed Yet", "حالة المعالجة", "Processing Status", isProcessed ? "var(--green)" : "var(--amber)")}
      ${healthMeter("📋", l === "ar" ? mStatusLabel.ar : mStatusLabel.en, "حالة الاعتماد", "Approval Status", mStatusColor)}
      ${healthMeter("📊", `${dataScore}/4 ${l === "ar" ? "مكتمل" : "complete"}`, "اكتمال البيانات", "Data Completeness", dataColor)}
    </div>`;

    // ── Sticky action bar — the highest-value actions for this meeting stay
    // reachable while scrolling through any tab, so approving minutes or
    // creating a follow-up action never requires leaving the workspace.
    const stickyActions = [];
    if (mApprovalBtns) stickyActions.push(mApprovalBtns);
    stickyActions.push(`<button class="btn-ghost btn-sm" onclick="Panels.load('tasks').then(()=>Modals.addTask())">➕ ${l === "ar" ? "إجراء تنفيذي" : "Executive Action"}</button>`);
    if (isProcessed) stickyActions.push(`<button class="btn-ghost btn-sm" onclick="BoardPack.download(${m.id})">📦 ${l === "ar" ? "تنزيل التقرير" : "Download Report"}</button>`);
    const stickyActionBarHtml = `<div class="ws-action-bar">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${stickyActions.join("")}</div>
    </div>`;

    this._full = full;
    this._tab = this._tab && this.TABS.some((t) => t.key === this._tab) ? this._tab : "overview";
    this._tabs = {
      overview: overviewBody,
      agenda: agendaBody,
      recording: recordingBody,
      ai: aiBody,
      actions: actionsBody,
      documents: documentsBody,
      timeline: timelineBody,
      reports: reportsBody,
    };

    const tabBarHtml = `<div class="imp-seg" id="${this._target}-detail-tabs">
      ${this.TABS.map((t) => `<button class="imp-seg-btn ${t.key === this._tab ? "active" : ""}" data-tab="${t.key}" onclick="MeetingHistory.setTab('${t.key}')">${t.icon} ${l === "ar" ? t.ar : t.en}</button>`).join("")}
    </div>`;

    detail.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div>
          <div style="font-size:17px;font-weight:700;color:var(--text)">${esc(title)}</div>
          <div style="font-size:11.5px;color:var(--text3);margin-top:3px">${(m.meeting_date || "").substring(0, 10)} ${m.duration ? `· ${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, "0")} ${l === "ar" ? "دقيقة" : "min"}` : ""}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${seriesName ? `<span class="tag" style="background:var(--navy4)">🔗 ${esc(seriesName)}</span>` : ""}
          ${isProcessed ? `<span class="tag tg">✓ ${l === "ar" ? "مُعالج" : "Processed"}</span>` : `<span class="tag ta">${l === "ar" ? "جديد" : "New"}</span>`}
          <span class="tag" style="background:var(--navy4)">${providerLabels[provider] || provider}</span>
        </div>
      </div>
      ${meetingHealthHtml}
      ${prevNavHtml}
      ${seriesTimelineTopHtml}
      ${_meetingLifecycle(m, l)}
      ${tabBarHtml}
      ${stickyActionBarHtml}
      <div id="${this._target}-tab-body">${this._tabs[this._tab]}</div>
    `;
  },
};

// ══ Meeting Series (Phase 2) — Series Dashboard panel ══════════════════════════
// Each series card shows the same total/completed/pending meetings + open/
// completed actions + pending/closed decisions + completion % the backend's
// computeSeriesStats() already computes — no client-side recomputation.
const SeriesPanel = {
  _all: [],
  _q: "",
  _editingId: null,
  _searchTimer: null,

  async refresh() {
    const grid = $("series-grid");
    if (grid) grid.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      this._all = await api("/api/gov/meeting-series");
      this.render();
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },

  onSearch(q) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._q = (q || "").trim().toLowerCase();
      this.render();
    }, 300);
  },

  render() {
    const grid = $("series-grid");
    if (!grid) return;
    const l = App.lang;
    if (!this._all.length) {
      grid.innerHTML = emptyStateCard({
        icon: "🧭",
        titleAr: "لا توجد سلاسل اجتماعات بعد",
        titleEn: "No meeting series yet",
        descAr: "اجمع الاجتماعات المتكررة (كاجتماع المجلس الشهري) في سلسلة واحدة لمتابعة الاستمرارية والإجراءات تلقائياً.",
        descEn: "Group recurring meetings (like a monthly board meeting) into one series to track continuity and follow-ups automatically.",
        primary: { ar: "+ سلسلة جديدة", en: "+ New Series", onclick: "SeriesPanel.openCreate()" },
      });
      return;
    }
    const q = this._q;
    const filtered = this._all.filter((s) => {
      if (!q) return true;
      const hay = [s.name_ar, s.name_en, s.category, s.description_ar, s.description_en].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    if (!filtered.length) {
      grid.innerHTML = emptyStateCard({
        icon: "🔍",
        titleAr: "لا توجد نتائج مطابقة",
        titleEn: "No matching series",
        descAr: "جرّب كلمة بحث مختلفة.",
        descEn: "Try a different search term.",
        secondary: { ar: "✕ مسح البحث", en: "✕ Clear Search", onclick: "SeriesPanel.onSearch('');$('series-search') && ($('series-search').value='')" },
      });
      return;
    }
    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      ${filtered.map((s) => this._cardHtml(s, l)).join("")}
    </div>`;
  },

  _cardHtml(s, l) {
    const name = l === "ar" ? s.name_ar : (s.name_en || s.name_ar);
    const owner = l === "ar" ? s.owner_name_ar : (s.owner_name_en || s.owner_name_ar);
    const st = s.stats || {};
    return `<div class="card series-card">
      <div class="ch">
        <div style="min-width:0">
          <div class="ct" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</div>
          <div class="ctsub">${s.category ? esc(s.category) : (l === "ar" ? "بدون فئة" : "No category")}${owner ? " · " + esc(owner) : ""}</div>
        </div>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px">
        <div><div style="font-size:10.5px;color:var(--text3)">${l === "ar" ? "الاجتماعات" : "Meetings"}</div><div style="font-weight:700">${st.total_meetings || 0}</div></div>
        <div><div style="font-size:10.5px;color:var(--text3)">${l === "ar" ? "مكتملة" : "Completed"}</div><div style="font-weight:700;color:var(--green)">${st.completed_meetings || 0}</div></div>
        <div><div style="font-size:10.5px;color:var(--text3)">${l === "ar" ? "قادمة" : "Pending"}</div><div style="font-weight:700;color:var(--blue)">${st.pending_meetings || 0}</div></div>
        <div><div style="font-size:10.5px;color:var(--text3)">${l === "ar" ? "إجراءات مفتوحة" : "Open Actions"}</div><div style="font-weight:700;color:var(--amber)">${st.open_actions || 0}</div></div>
        <div><div style="font-size:10.5px;color:var(--text3)">${l === "ar" ? "قرارات معلّقة" : "Pending Decisions"}</div><div style="font-weight:700">${st.pending_decisions || 0}</div></div>
      </div>
      <div class="series-progress-bar"><div class="series-progress-fill" style="width:${st.completion_pct || 0}%"></div></div>
      <div style="font-size:11px;color:var(--text3);margin:4px 0 12px">${l === "ar" ? "نسبة الإنجاز" : "Completion"}: ${st.completion_pct || 0}% ${st.next_meeting_date ? `· ${l === "ar" ? "القادم" : "Next"}: ${st.next_meeting_date}` : ""}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-ghost btn-sm" onclick="SeriesPanel.viewTimeline(${s.id})">🗂 ${l === "ar" ? "عرض الاجتماعات" : "View Meetings"}</button>
        <button class="btn-ghost btn-sm" id="series-report-btn-${s.id}" onclick="SeriesPanel.downloadReport(${s.id})">📄 ${l === "ar" ? "تقرير PDF" : "PDF Report"}</button>
        <button class="btn-ghost btn-sm" onclick="SeriesPanel.openEdit(${s.id})">✏️ ${l === "ar" ? "تعديل" : "Edit"}</button>
        <button class="btn-ghost btn-sm" style="color:var(--red)" onclick="SeriesPanel.delete(${s.id})">🗑</button>
      </div>
    </div>`;
  },

  viewTimeline(seriesId) {
    Panels.load("history").then(() => {
      const sel = $("hist-filter-series");
      if (sel) { sel.value = String(seriesId); MeetingHistory.applyFilters(); }
    });
  },

  async downloadReport(seriesId) {
    const l = App.lang;
    const btn = $(`series-report-btn-${seriesId}`);
    if (btn) { btn.disabled = true; btn.textContent = l === "ar" ? "⏳ جارٍ التوليد..." : "⏳ Generating..."; }
    try {
      const resp = await fetch(`/api/meeting-series/${seriesId}/report`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: l }),
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || `HTTP ${resp.status}`); }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `series-report-${seriesId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(l === "ar" ? "✓ تم توليد تقرير السلسلة" : "✓ Series report downloaded");
    } catch (e) {
      alert((l === "ar" ? "خطأ: " : "Error: ") + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = `📄 ${l === "ar" ? "تقرير PDF" : "PDF Report"}`; }
    }
  },

  async _populateOwnerSelect() {
    const sel = $("series-owner");
    if (!sel) return;
    const l = App.lang;
    try {
      const members = await api("/api/members");
      const current = sel.value;
      sel.innerHTML = `<option value="">— ${l === "ar" ? "بدون مالك" : "No owner"} —</option>` +
        members.map((m) => `<option value="${m.id}">${esc(l === "ar" ? m.name_ar : (m.name_en || m.name_ar))}</option>`).join("");
      sel.value = current;
    } catch (_) {}
  },

  async openCreate() {
    this._editingId = null;
    const l = App.lang;
    $("series-modal-title").textContent = l === "ar" ? "سلسلة اجتماعات جديدة" : "New Meeting Series";
    ["series-name-ar", "series-name-en", "series-category", "series-desc-ar", "series-desc-en"].forEach((id) => { if ($(id)) $(id).value = ""; });
    await this._populateOwnerSelect();
    if ($("series-owner")) $("series-owner").value = "";
    $("modal-series").classList.add("open");
  },

  async openEdit(id) {
    const s = this._all.find((x) => x.id === id);
    if (!s) return;
    this._editingId = id;
    const l = App.lang;
    $("series-modal-title").textContent = l === "ar" ? "تعديل السلسلة" : "Edit Series";
    $("series-name-ar").value = s.name_ar || "";
    $("series-name-en").value = s.name_en || "";
    $("series-category").value = s.category || "";
    $("series-desc-ar").value = s.description_ar || "";
    $("series-desc-en").value = s.description_en || "";
    await this._populateOwnerSelect();
    if ($("series-owner")) $("series-owner").value = s.owner_id || "";
    $("modal-series").classList.add("open");
  },

  closeModal() {
    $("modal-series").classList.remove("open");
  },

  async save() {
    const l = App.lang;
    const nameAr = $("series-name-ar").value.trim();
    if (!nameAr) {
      alert(l === "ar" ? "يرجى إدخال اسم السلسلة" : "Please enter a series name");
      return;
    }
    const payload = {
      name_ar: nameAr,
      name_en: $("series-name-en").value.trim() || nameAr,
      category: $("series-category").value.trim(),
      owner_id: parseInt($("series-owner").value) || null,
      description_ar: $("series-desc-ar").value.trim(),
      description_en: $("series-desc-en").value.trim(),
    };
    try {
      if (this._editingId) {
        await api(`/api/gov/meeting-series/${this._editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/gov/meeting-series", { method: "POST", body: JSON.stringify(payload) });
      }
      SeriesUI.invalidate();
      this.closeModal();
      await this.refresh();
      showToast(l === "ar" ? "✓ تم الحفظ" : "✓ Saved");
    } catch (e) {
      alert(e.message);
    }
  },

  async delete(id) {
    const l = App.lang;
    if (!confirm(l === "ar" ? "هل تريد حذف هذه السلسلة؟ لن يتم حذف الاجتماعات المرتبطة بها، ولكن ستصبح مستقلة." : "Delete this series? Linked meetings will not be deleted, but will become standalone.")) return;
    try {
      await api(`/api/gov/meeting-series/${id}`, { method: "DELETE" });
      SeriesUI.invalidate();
      await this.refresh();
    } catch (e) {
      alert(e.message);
    }
  },
};
if ($("modal-series")) {
  $("modal-series").addEventListener("click", (e) => { if (e.target === $("modal-series")) SeriesPanel.closeModal(); });
}

// ── Minutes Approval Workflow helpers ──────────────────────────────────────
// Governance minutes-approval actions (Circulate/Approve/Request Revision/
// Final Approve/Archive) used to collect their optional comment via a native
// prompt() — a jarring, unstyled OS dialog in an otherwise fully custom-
// themed board-governance product. Now opens the same modal system already
// used for tasks/team members instead of inventing a new component.
const ApprovalModal = {
  _meetingId: null,
  _action: null,
  _onConfirm: null,
  _required: false,
  _cfg(action) {
    const l = App.lang;
    const ar = (a, e) => l === 'ar' ? a : e;
    return {
      'circulate':        { ico: '📤', title: ar('تعميم المحضر للاعتماد', 'Circulate Minutes for Review'),      sub: ar('سيتم إشعار جميع المعتمدين بأن المحضر جاهز للمراجعة والاعتماد.', 'All approvers will be notified that the minutes are ready for their review.'),      lbl: ar('ملاحظة للمعتمدين (اختياري)', 'Note to approvers (optional)'),       btn: ar('📤 تعميم للاعتماد', '📤 Circulate'),          required: false },
      'approve':          { ico: '✅', title: ar('اعتماد محضر الاجتماع', 'Approve Meeting Minutes'),             sub: ar('سيُسجَّل اعتمادك لهذا المحضر ويُشعَر الكاتب بذلك.', 'Your approval will be recorded and the secretary will be notified.'),           lbl: ar('تعليق (اختياري)', 'Comment (optional)'),                              btn: ar('✅ اعتماد', '✅ Approve'),                     required: false },
      'request-revision': { ico: '🔄', title: ar('طلب مراجعة المحضر', 'Request Minutes Revision'),              sub: ar('سيُعاد المحضر إلى حالة المسودة مع ملاحظاتك لإجراء التعديلات اللازمة.', 'Minutes will be returned to draft with your notes for the necessary corrections.'), lbl: ar('سبب طلب المراجعة (مطلوب)', 'Reason for revision (required)'),        btn: ar('🔄 طلب مراجعة', '🔄 Request Revision'),        required: true  },
      'final-approve':    { ico: '🏆', title: ar('الاعتماد النهائي للمحضر', 'Final Board Approval'),            sub: ar('سيُوثَّق الاعتماد النهائي وتُقفَل دورة حياة الاجتماع رسمياً.', 'Final approval will be documented and the meeting lifecycle will be officially closed.'), lbl: ar('تعليق (اختياري)', 'Comment (optional)'),                          btn: ar('🏆 اعتماد نهائي', '🏆 Final Approve'),          required: false },
      'archive':          { ico: '🗄️', title: ar('أرشفة الاجتماع', 'Archive Meeting'),                          sub: ar('سيُنقَل الاجتماع إلى الأرشيف ولن يظهر في القوائم الرئيسية.', 'The meeting will be moved to the archive and hidden from main lists.'),          lbl: ar('ملاحظة (اختياري)', 'Note (optional)'),                               btn: ar('🗄️ أرشفة', '🗄️ Archive'),                       required: false },
    }[action] || { ico: '✓', title: action, sub: '', lbl: l === 'ar' ? 'ملاحظات' : 'Comments', btn: l === 'ar' ? 'تأكيد' : 'Confirm', required: false };
  },
  open(meetingId, action, onConfirm) {
    const cfg = this._cfg(action);
    this._meetingId = meetingId;
    this._action = action;
    this._onConfirm = onConfirm || null;
    this._required = cfg.required;
    const set = (id, prop, val) => { const el = $(id); if (el) el[prop] = val; };
    set('approval-modal-ico', 'textContent', cfg.ico);
    set('approval-modal-title-txt', 'textContent', cfg.title);
    const subEl = $('approval-modal-subtitle');
    if (subEl) { subEl.textContent = cfg.sub; subEl.style.display = cfg.sub ? '' : 'none'; }
    set('approval-modal-comment-lbl', 'textContent', cfg.lbl);
    set('approval-modal-comments', 'value', '');
    set('approval-modal-comments', 'placeholder', cfg.lbl);
    set('approval-modal-confirm-btn', 'innerHTML', cfg.btn);
    const btn = $('approval-modal-confirm-btn');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    $('modal-approval-action').classList.add('open');
    setTimeout(() => { const ta = $('approval-modal-comments'); if (ta) ta.focus(); }, 80);
  },
  close() {
    $('modal-approval-action').classList.remove('open');
    this._meetingId = null; this._action = null; this._onConfirm = null; this._required = false;
  },
  async confirm() {
    const l = App.lang;
    const meetingId = this._meetingId, action = this._action;
    if (!meetingId || !action) return;
    const comments = ($('approval-modal-comments') && $('approval-modal-comments').value.trim()) || '';
    if (this._required && !comments) {
      showToast(l === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required', 'error');
      $('approval-modal-comments') && $('approval-modal-comments').focus();
      return;
    }
    const btn = $('approval-modal-confirm-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    const cb = this._onConfirm;
    try {
      await api(`/api/meetings/${meetingId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });
      this.close();
      if (cb) await cb();
      else await renderTranscripts();
    } catch (e) {
      showToast((l === 'ar' ? 'حدث خطأ: ' : 'Error: ') + e.message, 'error');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  },
};
function minutesApprovalAction(meetingId, action) {
  ApprovalModal.open(meetingId, action);
}
$("modal-api-key") && $("modal-api-key").addEventListener("click", (e) => {
  if (e.target === $("modal-api-key")) App.closeApiKeyModal();
});
$("modal-approval-action") && $("modal-approval-action").addEventListener("click", (e) => {
  if (e.target === $("modal-approval-action")) ApprovalModal.close();
});

async function minutesShowLog(meetingId) {
  const l = App.lang;
  try {
    const data = await api(`/api/meetings/${meetingId}/approval-log`);
    const log = data.log || [];
    if (!log.length) {
      alert(l === 'ar' ? 'لا توجد إجراءات اعتماد بعد.' : 'No approval actions yet.');
      return;
    }
    const actionLabels = { circulated: l==='ar'?'تعميم':'Circulated', approved: l==='ar'?'اعتماد':'Approved', revision_requested: l==='ar'?'طلب مراجعة':'Revision Requested', final_approved: l==='ar'?'اعتماد نهائي':'Final Approved' };
    const lines = log.map(row => {
      const date = (row.created_at || '').substring(0, 16).replace('T', ' ');
      const actor = row.actor_name || (l === 'ar' ? 'مجهول' : 'Unknown');
      const act = actionLabels[row.action] || row.action;
      const ver = row.version > 1 ? ` v${row.version}` : '';
      const comment = row.comments ? `\n   💬 ${row.comments}` : '';
      return `• ${date}  ${actor}  →  ${act}${ver}${comment}`;
    }).join('\n\n');
    alert((l === 'ar' ? 'سجل الاعتماد:\n\n' : 'Approval Log:\n\n') + lines);
  } catch (e) {
    alert(l === 'ar' ? 'خطأ في تحميل السجل' : 'Error loading log');
  }
}

async function showLifecycleLog(meetingId) {
  const l = App.lang;
  try {
    const data = await api(`/api/meetings/${meetingId}/lifecycle`);
    const log = data.log || [];
    if (!log.length) {
      alert(l === 'ar' ? 'لا يوجد سجل مراحل بعد.' : 'No lifecycle transitions logged yet.');
      return;
    }
    const lines = log.map(row => {
      const date = (row.created_at || '').substring(0, 16).replace('T', ' ');
      const actor = row.actor_name || (l === 'ar' ? 'النظام' : 'System');
      const from = row.from_stage ? `${row.from_stage} → ` : '';
      const note = row.note ? `\n   💬 ${row.note}` : '';
      return `• ${date}  ${actor}  —  ${from}${row.to_stage}${note}`;
    }).join('\n\n');
    alert((l === 'ar' ? `سجل مراحل الاجتماع (الحالة: ${data.stage}):\n\n` : `Meeting Lifecycle Log (current: ${data.stage}):\n\n`) + lines);
  } catch (e) {
    alert(l === 'ar' ? 'خطأ في تحميل سجل المراحل' : 'Error loading lifecycle log');
  }
}

// ══ Transcript Notes Modal ═════════════════════════════════════════════════
const TranscriptModal = {
  _id: null,
  open(id) {
    this._id = id;
    const m = (App.meetingsCache || []).find((x) => x.id === id);
    $("modal-transcript-text").value = (m && m.transcript) || "";
    const l = App.lang;
    const btn = $("modal-transcript-process-btn");
    if (btn) {
      const isProcessed = m && m.status === "processed";
      btn.innerHTML = `🤖 <span>${l === "ar" ? (isProcessed ? "إعادة المعالجة" : "حفظ ومعالجة") : isProcessed ? "Re-process" : "Save & Process with AI"}</span>`;
    }
    $("modal-transcript").classList.add("open");
  },
  close() {
    $("modal-transcript").classList.remove("open");
    this._id = null;
  },
  async saveOnly() {
    if (!this._id) return;
    const transcript = $("modal-transcript-text").value;
    try {
      await api("/api/meetings/" + this._id, {
        method: "PATCH",
        body: JSON.stringify({ transcript }),
      });
      if (App.meetingsCache) {
        const m = App.meetingsCache.find((x) => x.id === this._id);
        if (m) m.transcript = transcript;
      }
      this.close();
      await renderTranscripts();
    } catch (e) {
      alert((App.lang === "ar" ? "خطأ: " : "Error: ") + e.message);
    }
  },
  async saveAndProcess() {
    if (!this._id) return;
    const transcript = $("modal-transcript-text").value.trim();
    if (!transcript) {
      alert(
        App.lang === "ar" ? "أدخل النص أولاً" : "Please enter some text first",
      );
      return;
    }
    const btn = $("modal-transcript-process-btn");
    const origHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<div class="loading" style="width:14px;height:14px;display:inline-block;margin-left:4px"></div>`;
    }
    try {
      await api("/api/meetings/" + this._id, {
        method: "PATCH",
        body: JSON.stringify({ transcript }),
      });
      await api("/api/meetings/" + this._id + "/process", { method: "POST" });
      this.close();
      await renderTranscripts();
      await loadBadges();
    } catch (e) {
      alert((App.lang === "ar" ? "خطأ: " : "Error: ") + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },
};
$("modal-transcript") && $("modal-transcript").addEventListener("click", (e) => {
  if (e.target === $("modal-transcript")) TranscriptModal.close();
});

async function processTranscriptMeeting(meetingId) {
  try {
    showToast(App.lang === 'ar' ? 'جارٍ معالجة الاجتماع...' : 'Processing meeting...', 'info');
    await api('/api/meetings/' + meetingId + '/process', { method: 'POST' });
    showToast(App.lang === 'ar' ? '✓ تمت المعالجة بنجاح' : '✓ Processing complete', 'success');
    if (typeof renderTranscripts === 'function') await renderTranscripts();
    if (typeof loadBadges === 'function') await loadBadges();
  } catch (e) {
    showToast((App.lang === 'ar' ? '✗ فشلت المعالجة: ' : '✗ Processing failed: ') + e.message, 'error');
  }
}

async function editMeetingTitle(id, curAr, curEn) {
  const l = App.lang;
  const newAr = prompt(
    l === "ar" ? "العنوان بالعربية:" : "Arabic title:",
    curAr || "",
  );
  if (newAr === null) return;
  const newEn = prompt(
    l === "ar" ? "العنوان بالإنجليزية:" : "English title:",
    curEn || newAr,
  );
  if (newEn === null) return;
  const title_ar = newAr.trim();
  const title_en = newEn.trim() || title_ar;
  if (!title_ar) {
    alert(
      l === "ar" ? "العنوان لا يمكن أن يكون فارغاً" : "Title cannot be empty",
    );
    return;
  }
  try {
    await api("/api/meetings/" + id, {
      method: "PATCH",
      body: JSON.stringify({ title_ar, title_en }),
    });
    const span = $("mtg-title-" + id);
    if (span) span.textContent = l === "ar" ? title_ar : title_en;
    await renderTranscripts();
  } catch (e) {
    alert(
      (l === "ar" ? "تعذّر حفظ العنوان: " : "Could not save title: ") +
        e.message,
    );
  }
}

async function deleteMeeting(id, title) {
  const l = App.lang;
  const msg =
    l === "ar"
      ? `حذف الاجتماع "${title}" نهائياً؟\nسيتم حذف مهامه وقراراته المرتبطة أيضاً.`
      : `Permanently delete meeting "${title}"?\nIts linked tasks and decisions will also be removed.`;
  if (!confirm(msg)) return;
  try {
    await api("/api/meetings/" + id, { method: "DELETE" });
    await renderTranscripts();
    await loadBadges();
  } catch (e) {
    alert((l === "ar" ? "تعذّر الحذف: " : "Could not delete: ") + e.message);
  }
}

// ══ Last Meeting (precision view) ═════════════════════════════════════════════
async function renderLastMeeting() {
  const body = $("lastmeeting-body");
  const l = App.lang;
  const lbl = (ar, en) => (l === "ar" ? ar : en);
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const meetings = await api("/api/meetings");
    const processed = meetings.filter((m) => m.status === "processed");
    const m = (processed.length ? processed : meetings)[0];
    if (!m) {
      body.innerHTML = emptyStateCard({
        icon: "🎙",
        titleAr: "لا يوجد اجتماع بعد",
        titleEn: "No meeting yet",
        descAr: "أنشئ أول اجتماع لك ليظهر هنا تحليل الذكاء الاصطناعي الكامل بعد انعقاده.",
        descEn: "Create your first meeting to see the full AI analysis here once it's held.",
        primary: { ar: "➕ إنشاء اجتماع", en: "➕ Create Meeting", onclick: "Panels.load('create-meeting')" },
        secondary: { ar: "📥 استيراد محضر", en: "📥 Import Minutes", onclick: "Panels.load('record').then(()=>ImportFlow.setContentType('text'))" },
      });
      return;
    }
    const docs = await api(`/api/gov/documents?meetingId=${m.id}`).catch(
      () => [],
    );
    const title = esc(l === "ar" ? m.title_ar : m.title_en || m.title_ar);
    const summary = esc(
      (l === "ar" ? m.ai_summary_ar : m.ai_summary_en || m.ai_summary_ar) ||
        lbl("لا يوجد ملخص", "No summary"),
    );
    const meetingTypeLbl = m.meeting_type ? mtLabel(m.meeting_type, l) : "";
    let tasks = [];
    try {
      tasks = JSON.parse(m.ai_tasks || "[]");
    } catch {}
    let decisions = [];
    try {
      decisions = JSON.parse(m.ai_decisions || "[]");
    } catch {}
    const tasksHtml = tasks.length
      ? tasks
          .map(
            (t) => `
      <div style="background:var(--navy3);border-radius:8px;padding:10px;margin-bottom:6px">
        <div style="font-size:12px;color:var(--text)">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
          ${t.owner_ar ? `<span class="tag tgold" style="font-size:11px">${esc(l === "ar" ? t.owner_ar : t.owner_en || t.owner_ar)}</span>` : ""}
          ${t.due_date ? `<span class="tag" style="background:var(--navy4);font-size:11px">${esc(t.due_date)}</span>` : ""}
        </div>
      </div>`,
          )
          .join("")
      : `<div style="font-size:12px;color:var(--text3)">${lbl("لا توجد مهام", "No tasks")}</div>`;
    const decisionsHtml = decisions.length
      ? decisions
          .map(
            (d) => `
      <div style="font-size:12px;color:var(--text);padding:6px 0;border-bottom:.5px solid var(--border2)">✓ ${esc(l === "ar" ? d.text_ar || d : d.text_en || d.text_ar || d)}</div>`,
          )
          .join("")
      : `<div style="font-size:12px;color:var(--text3)">${lbl("لا توجد قرارات", "No decisions")}</div>`;

    body.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-size:18px;font-weight:800;color:var(--text)">⭐ ${title}</div>
            <div style="display:flex;align-items:center;gap:7px;margin-top:3px;flex-wrap:wrap">
              <div style="font-size:12px;color:var(--text3)">📅 ${esc((m.meeting_date || "").substring(0, 10))}</div>
              ${meetingTypeLbl ? `<span class="tag tgold" style="font-size:11px;padding:2px 7px">${esc(meetingTypeLbl)}</span>` : ""}
              ${m.board_name_ar ? `<span class="tag" style="background:rgba(91,155,214,.12);color:#5B9BD6;font-size:11px">🏛 ${esc(l === "ar" ? m.board_name_ar : m.board_name_en || m.board_name_ar)}</span>` : ""}
              ${m.committee_name_ar ? `<span class="tag" style="background:rgba(46,204,138,.10);color:var(--green);font-size:11px">⚙️ ${esc(l === "ar" ? m.committee_name_ar : m.committee_name_en || m.committee_name_ar)}</span>` : ""}
            </div>
          </div>
          <button class="btn-gold btn-sm" onclick="pushLastMeetingWhatsApp(${m.id})">📲 ${lbl("إرسال عبر واتساب", "Push to WhatsApp")}</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card">
          <div class="ct" style="margin-bottom:10px">📝 ${lbl("الملخص التنفيذي", "Executive Summary")}</div>
          <div style="font-size:13px;line-height:1.7;color:var(--text2);white-space:pre-wrap">${summary}</div>
        </div>
        <div>
          <div class="card" style="margin-bottom:14px">
            <div class="ct" style="margin-bottom:10px">📋 ${lbl("المهام", "Action Items")}</div>
            ${tasksHtml}
          </div>
          <div class="card">
            <div class="ct" style="margin-bottom:10px">⚖️ ${lbl("القرارات", "Decisions")}</div>
            ${decisionsHtml}
          </div>
        </div>
      </div>
      ${
        docs.length
          ? `<div class="card" style="margin-top:14px">
        <div class="ch"><div class="ct">📁 ${lbl("وثائق الاجتماع", "Meeting Documents")}</div><div class="ctsub">${docs.length} ${lbl("وثيقة", "document(s)")}</div></div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${docs
            .map((d) => {
              const _ic =
                {
                  board_paper: "🗂️",
                  financial_report: "💰",
                  legal: "⚖️",
                  presentation: "📊",
                  proposal: "💡",
                  policy: "📜",
                  minutes: "📝",
                  report: "📋",
                  other: "📄",
                }[d.doc_type] || "📄";
              const _st = {
                draft: {
                  ar: "مسودة",
                  en: "Draft",
                  c: "var(--text3)",
                  bg: "var(--navy4)",
                },
                shared: {
                  ar: "مشترك",
                  en: "Shared",
                  c: "#5B9BD6",
                  bg: "rgba(91,155,214,.12)",
                },
                reviewed: {
                  ar: "مُراجَع",
                  en: "Reviewed",
                  c: "var(--amber)",
                  bg: "rgba(201,168,76,.12)",
                },
                approved: {
                  ar: "مُعتمَد",
                  en: "Approved",
                  c: "var(--green)",
                  bg: "rgba(46,204,138,.12)",
                },
              }[d.status] || {
                ar: "مسودة",
                en: "Draft",
                c: "var(--text3)",
                bg: "var(--navy4)",
              };
              return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--navy3);border-radius:8px;border-inline-start:2px solid ${_st.c}">
              <span style="font-size:15px">${_ic}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(d.title)}</div>
                ${d.description ? `<div style="font-size:11px;color:var(--text3)">${esc(d.description.substring(0, 65))}${d.description.length > 65 ? "…" : ""}</div>` : ""}
              </div>
              <span class="tag" style="font-size:11px;background:${_st.bg};color:${_st.c};flex-shrink:0">${_st[l === "ar" ? "ar" : "en"]}</span>
              ${d.uploaded_by ? `<span style="font-size:11px;color:var(--text3);flex-shrink:0">👤 ${esc(d.uploaded_by)}</span>` : ""}
            </div>`;
            })
            .join("")}
        </div>
      </div>`
          : ""
      }`;
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
  }
}

function pushLastMeetingWhatsApp(id) {
  const l = App.lang;
  const existing = document.getElementById("wa-summary-modal");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "wa-summary-modal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center";
  overlay.innerHTML = `
    <div class="card" style="width:420px;max-width:92vw;padding:24px;position:relative">
      <button onclick="document.getElementById('wa-summary-modal').remove()" style="position:absolute;top:12px;inset-inline-end:14px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text3)">✕</button>
      <div style="font-size:16px;font-weight:700;margin-bottom:4px">📲 ${l === "ar" ? "إرسال ملخص الاجتماع عبر واتساب" : "Send Meeting Summary via WhatsApp"}</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:16px">${l === "ar" ? "أدخل أرقام الجوال (بصيغة E.164 مثل: +966501234567)، يمكن إدخال أكثر من رقم بفاصلة" : "Enter phone numbers in E.164 format (e.g. +966501234567), comma-separated for multiple"}</div>
      <textarea id="wa-phones-input" class="fi" rows="3" placeholder="${l === "ar" ? "+966501234567, +966509876543" : "+966501234567, +966509876543"}" style="width:100%;resize:vertical;font-family:monospace;font-size:13px"></textarea>
      <div id="wa-modal-err" style="color:var(--red);font-size:12px;margin-top:6px;display:none"></div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button class="btn-ghost btn-sm" onclick="document.getElementById('wa-summary-modal').remove()">${l === "ar" ? "إلغاء" : "Cancel"}</button>
        <button class="btn-gold btn-sm" id="wa-send-btn" onclick="_doSendWhatsApp(${id})">${l === "ar" ? "إرسال" : "Send"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => { const inp = document.getElementById("wa-phones-input"); if (inp) inp.focus(); }, 80);
}

async function _doSendWhatsApp(id) {
  const l = App.lang;
  const inp = document.getElementById("wa-phones-input");
  const errEl = document.getElementById("wa-modal-err");
  const btn = document.getElementById("wa-send-btn");
  if (!inp) return;
  const phones = inp.value.trim();
  if (!phones) {
    if (errEl) { errEl.textContent = l === "ar" ? "يرجى إدخال رقم جوال واحد على الأقل" : "Please enter at least one phone number"; errEl.style.display = "block"; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = l === "ar" ? "جاري الإرسال…" : "Sending…"; }
  if (errEl) errEl.style.display = "none";
  try {
    const r = await api("/api/meetings/" + id + "/whatsapp-summary", {
      method: "POST",
      body: JSON.stringify({ phones }),
    });
    document.getElementById("wa-summary-modal")?.remove();
    showToast(l === "ar" ? `✓ تم الإرسال إلى ${r.sent} رقم` : `✓ Sent to ${r.sent} number(s)`, "success");
  } catch (e) {
    if (errEl) { errEl.textContent = (l === "ar" ? "تعذّر الإرسال: " : "Could not send: ") + e.message; errEl.style.display = "block"; }
    if (btn) { btn.disabled = false; btn.textContent = l === "ar" ? "إرسال" : "Send"; }
  }
}

async function reorderAgendaItem(meetingId, itemId, direction) {
  try {
    await api(`/api/meetings/${meetingId}/agenda/${itemId}/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ direction }),
    });
    MT.openDetail(meetingId, "agenda");
  } catch (e) {
    showToast((App.lang === "ar" ? "تعذّر إعادة الترتيب: " : "Reorder failed: ") + e.message, "error");
  }
}

async function printMeetingMinutes(id) {
  const l = App.lang;
  try {
    const full = await api(`/api/meetings/${id}/full`);
    const m = full.meeting || full;
    const title = l === "ar" ? (m.title_ar || m.title_en || "") : (m.title_en || m.title_ar || "");
    const minutesRaw = m.minutes_text || m.minutes_md || m.minutes_html || m.ai_minutes || null;
    const summary = l === "ar" ? (m.ai_summary_ar || m.ai_summary_en || "") : (m.ai_summary_en || m.ai_summary_ar || "");
    const content = minutesRaw || summary || (l === "ar" ? "لا يوجد محضر" : "No minutes available");
    _openPrintWindow(content, title, l);
  } catch (e) {
    showToast((l === "ar" ? "تعذّر تحميل المحضر: " : "Could not load minutes: ") + e.message, "error");
  }
}

// ══ Tasks ═════════════════════════════════════════════════════════════════════
// ── Task & Decision Tracker filters ─────────────────────────────────────────
// Search + owner/status/priority/meeting/department + "My Tasks" — pure
// client-side filtering over the already-fetched task list (same lightweight
// pattern as DocLib.search / MeetingHistory), so it stays in sync automatically
// on every renderTasks() re-render without a new backend query.
const TaskFilters = {
  q: "", owner: "", status: "", priority: "", meeting: "", department: "", dueBefore: "", mine: false,
  // Single-select quick-filter shortcuts, layered on top of the detailed
  // dropdown filters above — '' | 'my' | 'team' | 'dept' | 'overdue' | 'high'
  // | 'blocked' | 'completed' | 'recent' | 'favorites'.
  quick: "",
  _searchTimer: null,
  onSearch(q) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.q = (q || "").trim().toLowerCase();
      renderTasks();
    }, 300);
  },
  apply() {
    this.owner = (($("tf-owner") || {}).value) || "";
    this.status = (($("tf-status") || {}).value) || "";
    this.priority = (($("tf-priority") || {}).value) || "";
    this.meeting = (($("tf-meeting") || {}).value) || "";
    this.department = (($("tf-department") || {}).value) || "";
    this.dueBefore = (($("tf-due") || {}).value) || "";
    renderTasks();
  },
  toggleMine() {
    this.mine = !this.mine;
    renderTasks();
  },
  setQuick(key) {
    this.quick = this.quick === key ? "" : key;
    // Recency only makes sense as a sort order, so jump straight to List —
    // TaskView.set() already re-renders.
    if (this.quick === "recent") TaskView.set("list");
    else renderTasks();
  },
  reset() {
    this.q = ""; this.owner = ""; this.status = ""; this.priority = ""; this.meeting = ""; this.department = ""; this.dueBefore = ""; this.mine = false; this.quick = "";
    renderTasks();
  },
  isActive() {
    return !!(this.q || this.owner || this.status || this.priority || this.meeting || this.department || this.dueBefore || this.mine || this.quick);
  },
};

// ── Executive Action favorites — starred tasks, persisted per browser (no
// backend field exists for this, so it's frontend-only like TaskView).
const TaskFavorites = {
  key: "ameen_task_favorites",
  _set: null,
  _load() {
    if (this._set) return this._set;
    try {
      this._set = new Set(JSON.parse(localStorage.getItem(this.key) || "[]"));
    } catch (e) {
      this._set = new Set();
    }
    return this._set;
  },
  has(id) {
    return this._load().has(id);
  },
  toggle(id) {
    const s = this._load();
    if (s.has(id)) s.delete(id);
    else s.add(id);
    try {
      localStorage.setItem(this.key, JSON.stringify([...s]));
    } catch (e) {}
    renderTasks();
  },
};

// ── Executive Actions view switcher (List / Board / Calendar) — the
// existing board grouping stays the default and is untouched; List and
// Calendar are additional, user-selectable, persisted-per-user views over
// the same task data.
const TaskView = {
  key: "ameen_task_view",
  get() {
    try { return localStorage.getItem(this.key) || "board"; } catch { return "board"; }
  },
  set(v) {
    try { localStorage.setItem(this.key, v); } catch {}
    renderTasks();
  },
  _calOffset: 0,
  _selectedDay: null,
  calNav(delta) {
    this._calOffset += delta;
    renderTasks();
  },
  selectDay(dateStr) {
    this._selectedDay = this._selectedDay === dateStr ? null : dateStr;
    renderTasks();
  },
};

// ══ Tasks page state (tab / search / filters / page) ══════════════════════════
const TK = {
  tab: "my",      // "my" | "others" | "all"
  q: "",
  status: "",
  priority: "",
  dueBefore: "",
  meeting: "",
  page: 1,
  _searchTimer: null,
  setTab(v) { this.tab = v; this.page = 1; renderTasks(); },
  onSearch(v) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => { this.q = (v || "").toLowerCase().trim(); this.page = 1; renderTasks(); }, 280);
  },
  setFilter(k, v) { this[k] = v; this.page = 1; renderTasks(); },
  setPage(v) { this.page = v; renderTasks(); },
  reset() { this.q = ""; this.status = ""; this.priority = ""; this.dueBefore = ""; this.meeting = ""; this.page = 1; renderTasks(); },
  isActive() { return !!(this.q || this.status || this.priority || this.dueBefore || this.meeting); },
  closeMenus() {
    document.querySelectorAll(".tk-rm-drop.open").forEach(m => m.classList.remove("open"));
  },
  toggleMenu(id, btn) {
    this.closeMenus();
    const m = document.getElementById(`tk-rm-${id}`);
    if (!m) return;
    m.classList.add("open");
    const close = (e) => { if (btn && !btn.contains(e.target) && !m.contains(e.target)) { m.classList.remove("open"); document.removeEventListener("click", close, true); } };
    setTimeout(() => document.addEventListener("click", close, true), 0);
  },
};

async function renderTasks() {
  const body = $("tasks-body");
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const [tasksRaw, decisions, members] = await Promise.all([
      api("/api/tasks"),
      api("/api/decisions"),
      api("/api/members"),
    ]);
    App.tasksCache = tasksRaw;
    App._members = members;
    const l = App.lang;
    const ar = (a, e) => l === "ar" ? a : e;

    const pendingReviewTasks = tasksRaw.filter(t => t.review_status === "pending");
    // Always show a task to its assignee regardless of review_status so they
    // can see work assigned to them even before a secretary approves the AI batch.
    const tasks = tasksRaw.filter(t => {
      if (App.user && t.owner_id === App.user.id) return true;
      return t.review_status !== "pending" && t.review_status !== "rejected";
    });

    const canFullyManage = App.can("actions.assign");
    const ownerDept = {};
    members.forEach(m => { ownerDept[m.id] = m.department || ""; });

    const today = new Date().toISOString().substring(0, 10);
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);

    // ── KPI counts ───────────────────────────────────────────────────────────
    const allCount = tasks.length;
    const overdueCount = tasks.filter(t => t.status === "overdue").length;
    const dueWeekCount = tasks.filter(t =>
      t.due_date && t.due_date >= today && t.due_date <= weekEnd &&
      !["done","cancelled"].includes(t.status)
    ).length;
    const completedCount = tasks.filter(t => t.status === "done").length;
    const inProgressCount = tasks.filter(t =>
      ["inprogress","assigned","open","waiting","blocked"].includes(taskStatusKey(t.status))
    ).length;

    // ── tab filter ───────────────────────────────────────────────────────────
    const tab = TK.tab || "my";
    const tabTasks = tab === "my"
      ? tasks.filter(t => App.user && t.owner_id === App.user.id)
      : tab === "others"
        ? tasks.filter(t => !App.user || t.owner_id !== App.user.id)
        : tasks;

    // ── meeting titles for filter dropdown ───────────────────────────────────
    const meetingTitles = [...new Set(tasks.map(t =>
      (l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar)
    ).filter(Boolean))];

    // ── search & filters ─────────────────────────────────────────────────────
    const filtered = tabTasks.filter(t => {
      if (TK.status && taskStatusKey(t.status) !== TK.status) return false;
      if (TK.priority && taskPriorityKey(t.priority) !== TK.priority) return false;
      if (TK.dueBefore && (!t.due_date || t.due_date > TK.dueBefore)) return false;
      if (TK.meeting) {
        const mtg = l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar;
        if (mtg !== TK.meeting) return false;
      }
      if (TK.q) {
        const hay = [t.text_ar, t.text_en, t.owner_name_ar, t.owner_name_en, t.source_meeting_title_ar, t.source_meeting_title_en].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(TK.q)) return false;
      }
      return true;
    });

    // ── sort: overdue first, then due_date asc, then id desc ─────────────────
    const sorted = [...filtered].sort((a, b) => {
      const ao = a.status === "overdue" ? 0 : 1, bo = b.status === "overdue" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      if (a.due_date) return -1; if (b.due_date) return 1;
      return b.id - a.id;
    });

    // ── pagination ────────────────────────────────────────────────────────────
    const PAGE_SIZE = 10;
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, TK.page || 1), totalPages);
    const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // ── helpers ───────────────────────────────────────────────────────────────
    const tkStatusMeta = (status) => {
      const key = taskStatusKey(status);
      const m = {
        open:       { ar: "لم تبدأ",     en: "Not Started", cls: "tk-st-gray"  },
        assigned:   { ar: "مُسندة",      en: "Assigned",    cls: "tk-st-gray"  },
        inprogress: { ar: "قيد التنفيذ", en: "In Progress", cls: "tk-st-blue"  },
        waiting:    { ar: "بانتظار",     en: "Pending",     cls: "tk-st-amber" },
        blocked:    { ar: "معلّقة",      en: "Pending",     cls: "tk-st-amber" },
        done:       { ar: "مكتملة",      en: "Completed",   cls: "tk-st-green" },
        cancelled:  { ar: "ملغاة",       en: "Cancelled",   cls: "tk-st-gray"  },
        overdue:    { ar: "متأخرة",      en: "Overdue",     cls: "tk-st-red"   },
      };
      return m[key] || m.open;
    };
    const tkPriMeta = (priority) => {
      const key = taskPriorityKey(priority);
      const m = {
        low:      { ar: "منخفض", en: "Low",      cls: "tk-pri-gray"  },
        medium:   { ar: "متوسط", en: "Medium",   cls: "tk-pri-blue"  },
        high:     { ar: "عالٍ",  en: "High",     cls: "tk-pri-amber" },
        critical: { ar: "حرج",   en: "Critical", cls: "tk-pri-red"   },
      };
      return m[key] || m.medium;
    };
    const initials = (name) => (name || "").trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]||"").join("").toUpperCase() || "?";
    const fmtDate = (ds) => {
      if (!ds) return "";
      const d = new Date(ds + "T00:00:00");
      return isNaN(d) ? ds : d.toLocaleDateString(l === "ar" ? "ar-EG" : "en-GB", { day:"numeric", month:"short", year:"numeric" });
    };
    const fmtDateShort = (ds) => {
      if (!ds) return "";
      const d = new Date(ds + "T00:00:00");
      return isNaN(d) ? ds : d.toLocaleDateString(l === "ar" ? "ar-EG" : "en-GB", { day:"numeric", month:"short" });
    };
    const avatarColors = ["#4A6FA5","#6B7C93","#8B6BA8","#5B9BD5","#4CAF7D","#E08A3C","#C0785A"];
    const ownerColor = (id) => avatarColors[(id || 0) % avatarColors.length];

    // ── KPI cards ─────────────────────────────────────────────────────────────
    const kpiCard = (icon, label_ar, label_en, val, sub_ar, sub_en, accent) => `
      <div class="tk-kpi">
        <div class="tk-kpi-icon" style="color:${accent}">${icon}</div>
        <div class="tk-kpi-val" style="color:${accent}">${val}</div>
        <div class="tk-kpi-label">${ar(label_ar, label_en)}</div>
        <a class="tk-kpi-link" href="javascript:void(0)" onclick="void(0)">${ar(sub_ar, sub_en)} →</a>
      </div>`;

    const kpiHtml = `<div class="tk-kpi-row">
      ${kpiCard("📋", "كل المهام",       "All Tasks",       allCount,        "عرض كل المهام",       "View all tasks",    "var(--text)")}
      ${kpiCard("⚠️", "متأخرة",          "Overdue",         overdueCount,    "عرض المتأخرة",        "View overdue",      overdueCount > 0 ? "var(--red)" : "var(--text)")}
      ${kpiCard("📅", "مستحقة هذا الأسبوع","Due This Week",   dueWeekCount,    "عرض هذا الأسبوع",     "View this week",    "var(--blue)")}
      ${kpiCard("✅", "مكتملة",           "Completed",       completedCount,  "عرض المكتملة",        "View completed",    "var(--green)")}
      ${kpiCard("🔄", "قيد التنفيذ",      "In Progress",     inProgressCount, "عرض الجارية",         "View in progress",  "var(--amber)")}
    </div>`;

    // ── table tabs ────────────────────────────────────────────────────────────
    const myCount  = tasks.filter(t => App.user && t.owner_id === App.user.id).length;
    const othCount = tasks.filter(t => !App.user || t.owner_id !== App.user.id).length;
    const tabHtml = `<div class="tk-tabs">
      <button class="tk-tab${tab==="my"?" active":""}"    onclick="TK.setTab('my')">${ar("مهامي","My Tasks")} <span class="tk-tab-n">${myCount}</span></button>
      <button class="tk-tab${tab==="others"?" active":""}" onclick="TK.setTab('others')">${ar("مُسندة للآخرين","Assigned to Others")} <span class="tk-tab-n">${othCount}</span></button>
      <button class="tk-tab${tab==="all"?" active":""}"    onclick="TK.setTab('all')">${ar("كل المهام","All Tasks")} <span class="tk-tab-n">${tasks.length}</span></button>
      ${pendingReviewTasks.length ? `<button class="tk-tab${tab==="review"?" active":""}" onclick="TK.setTab('review')" style="color:var(--amber)">⏳ ${ar("بانتظار المراجعة","Pending Review")} <span class="tk-tab-n" style="background:rgba(212,160,23,.25);color:var(--amber)">${pendingReviewTasks.length}</span></button>` : ""}
    </div>`;

    // ── filter bar ────────────────────────────────────────────────────────────
    const _opt = (val, lbl, sel) => `<option value="${esc(val)}"${sel?" selected":""}>${esc(lbl)}</option>`;
    const filterBar = `<div class="tk-filters">
      <div class="tk-search-wrap">
        <span class="tk-search-ico">🔍</span>
        <input class="tk-search-inp" type="search" placeholder="${ar("بحث في المهام...","Search tasks...")}"
          value="${esc(TK.q)}" oninput="TK.onSearch(this.value)"/>
      </div>
      <select class="tk-fil-sel" onchange="TK.setFilter('status',this.value)">
        ${_opt("", ar("الحالة","Status"), !TK.status)}
        ${TASK_ASSIGNABLE_STATUSES.concat(["overdue"]).map(k =>
          _opt(k, l==="ar" ? TASK_STATUS_META[k].ar : TASK_STATUS_META[k].en, TK.status===k)
        ).join("")}
      </select>
      <select class="tk-fil-sel" onchange="TK.setFilter('priority',this.value)">
        ${_opt("", ar("الأولوية","Priority"), !TK.priority)}
        ${TASK_ASSIGNABLE_PRIORITIES.map(k =>
          _opt(k, l==="ar" ? TASK_PRIORITY_META[k].ar : TASK_PRIORITY_META[k].en, TK.priority===k)
        ).join("")}
      </select>
      <input class="tk-fil-sel" type="date" title="${ar("مستحق قبل أو في","Due on or before")}"
        value="${esc(TK.dueBefore)}" onchange="TK.setFilter('dueBefore',this.value)"
        style="color:${TK.dueBefore ? "var(--text)" : "var(--text3)"}"/>
      <select class="tk-fil-sel" onchange="TK.setFilter('meeting',this.value)">
        ${_opt("", ar("الاجتماع","Meeting"), !TK.meeting)}
        ${meetingTitles.map(mt => _opt(mt, mt.length>32?mt.substring(0,32)+"…":mt, TK.meeting===mt)).join("")}
      </select>
      ${TK.isActive() ? `<button class="tk-fil-reset" onclick="TK.reset()">✕ ${ar("إعادة تعيين","Reset")}</button>` : ""}
    </div>`;

    // ── task row renderer ─────────────────────────────────────────────────────
    const taskRow = (t) => {
      const text  = (l === "ar" ? t.text_ar : t.text_en || t.text_ar) || "";
      const owner = (l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar) || "";
      const mtg   = (l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar) || "";
      const sm = tkStatusMeta(t.status);
      const pm = tkPriMeta(t.priority);
      const isOverdue = t.status === "overdue";
      return `<tr class="tk-tr${isOverdue?" tk-tr-overdue":""}" id="tr-${t.id}">
        <td class="tk-td" style="width:32px;padding:8px">
          <input type="checkbox" class="tk-row-chk" data-id="${t.id}" style="width:14px;height:14px;cursor:pointer;accent-color:var(--gold)" onchange="BulkTasks.onCheck()">
        </td>
        <td class="tk-td tk-td-task">
          <div class="tk-task-t">${esc(text)}</div>
          ${t.due_date && isOverdue ? `<div class="tk-task-s" style="color:var(--red)">⚠ ${ar("تأخرت","Overdue")} · ${fmtDate(t.due_date)}</div>` : ""}
        </td>
        <td class="tk-td tk-td-rel">
          ${mtg ? `<a class="tk-mtg-link" href="javascript:void(0)"
            onclick="${t.source_meeting_id ? `MT.openDetail(${t.source_meeting_id},'actions')` : "void(0)"}"
            title="${esc(mtg)}">${esc(mtg.length>28?mtg.substring(0,28)+"…":mtg)}</a>` : `<span class="tk-empty-cell">—</span>`}
        </td>
        <td class="tk-td tk-td-owner">
          ${owner
            ? `<div class="tk-owner-wrap"><span class="tk-av" style="background:${ownerColor(t.owner_id)}">${esc(initials(owner))}</span><span class="tk-owner-n">${esc(owner)}</span></div>`
            : `<span class="tk-empty-cell">—</span>`}
        </td>
        <td class="tk-td tk-td-date" style="color:${isOverdue?"var(--red)":"var(--text2)"}">
          ${t.due_date ? fmtDate(t.due_date) : `<span class="tk-empty-cell">—</span>`}
        </td>
        <td class="tk-td"><span class="tk-pri ${pm.cls}">${ar(pm.ar, pm.en)}</span></td>
        <td class="tk-td">
          <select class="tk-st-sel ${sm.cls}" onchange="Tasks.updateStatus(${t.id},this.value)" title="${ar("تحديث الحالة","Update status")}">
            ${TASK_ASSIGNABLE_STATUSES.map(k =>
              `<option value="${k}"${taskStatusKey(t.status)===k?" selected":""}>${l==="ar"?TASK_STATUS_META[k].ar:TASK_STATUS_META[k].en}</option>`
            ).join("")}
            ${t.status==="overdue" ? `<option value="overdue" selected>${l==="ar"?TASK_STATUS_META.overdue.ar:TASK_STATUS_META.overdue.en}</option>` : ""}
          </select>
        </td>
        <td class="tk-td tk-td-actions">
          <div class="tk-rm-wrap">
            <button class="tk-rm-btn" onclick="TK.toggleMenu(${t.id},this)" aria-label="${ar("إجراءات","Actions")}">⋮</button>
            <div class="tk-rm-drop" id="tk-rm-${t.id}">
              <button onclick="TK.closeMenus();Tasks.edit(${t.id})">✏️ ${ar("تعديل","Edit")}</button>
              ${canFullyManage ? `<button onclick="TK.closeMenus();Tasks.delete(${t.id})" style="color:var(--red)">🗑 ${ar("حذف","Delete")}</button>` : ""}
            </div>
          </div>
        </td>
      </tr>`;
    };

    // ── main task table ───────────────────────────────────────────────────────
    const tableHtml = sorted.length === 0
      ? `<div class="tk-empty"><div style="font-size:32px;margin-bottom:10px">📋</div>
          <div style="font-size:14px;font-weight:700;color:var(--text2);margin-bottom:4px">${ar("لا توجد مهام مطابقة","No matching tasks")}</div>
          <div style="font-size:12px;color:var(--text3)">${ar("جرّب تعديل الفلاتر أو إنشاء مهمة جديدة","Try adjusting filters or creating a new task")}</div>
          ${TK.isActive() ? `<button class="btn-ghost btn-sm" style="margin-top:12px" onclick="TK.reset()">✕ ${ar("إعادة تعيين","Reset filters")}</button>` : ""}</div>`
      : `<div id="tk-bulk-bar" style="display:none;align-items:center;gap:8px;padding:8px 14px;background:rgba(168,132,44,.08);border-bottom:1px solid rgba(168,132,44,.2)">
          <span id="tk-bulk-count" style="font-size:12px;font-weight:700;color:var(--gold)"></span>
          <button class="btn-ghost btn-sm" onclick="BulkTasks.markAll('done')" style="font-size:11px">✓ ${ar("اعتماد","Mark Done")}</button>
          <button class="btn-ghost btn-sm" onclick="BulkTasks.markAll('inprogress')" style="font-size:11px">🔄 ${ar("قيد التنفيذ","In Progress")}</button>
          <button class="btn-ghost btn-sm" onclick="BulkTasks.markAll('open')" style="font-size:11px">📥 ${ar("مفتوحة","Open")}</button>
          <button class="btn-ghost btn-sm" onclick="BulkTasks.deselect()" style="font-size:11px;margin-inline-start:auto">✕ ${ar("إلغاء","Clear")}</button>
        </div>
        <div class="tk-tbl-wrap">
          <table class="tk-tbl">
            <thead>
              <tr>
                <th class="tk-th" style="width:32px;padding:8px"><input type="checkbox" id="tk-chk-all" style="width:14px;height:14px;cursor:pointer;accent-color:var(--gold)" onchange="BulkTasks.toggleAll(this.checked)"></th>
                <th class="tk-th">${ar("المهمة","Task")}</th>
                <th class="tk-th">${ar("مرتبط بـ","Related To")}</th>
                <th class="tk-th">${ar("المسؤول","Owner")}</th>
                <th class="tk-th">${ar("تاريخ الاستحقاق","Due Date")}</th>
                <th class="tk-th">${ar("الأولوية","Priority")}</th>
                <th class="tk-th">${ar("الحالة","Status")}</th>
                <th class="tk-th"></th>
              </tr>
            </thead>
            <tbody>${paginated.map(taskRow).join("")}</tbody>
          </table>
        </div>
        <div class="tk-tbl-foot">
          <span class="tk-count">${ar(`عرض ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,sorted.length)} من ${sorted.length} مهمة`, `Showing ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,sorted.length)} of ${sorted.length} task${sorted.length!==1?"s":""}`)}</span>
          <div class="tk-pages">
            <button class="tk-pg-btn" ${page<=1?"disabled":""} onclick="TK.setPage(${page-1})">◀</button>
            ${Array.from({length:Math.min(totalPages,7)}, (_,i)=>{
              let p;
              if (totalPages<=7) p=i+1;
              else if (page<=4) p=i+1;
              else if (page>=totalPages-3) p=totalPages-6+i;
              else p=page-3+i;
              return `<button class="tk-pg-btn${p===page?" active":""}" onclick="TK.setPage(${p})">${p}</button>`;
            }).join("")}
            ${totalPages>7 ? `<span style="color:var(--text3);padding:0 4px">…</span><button class="tk-pg-btn${page===totalPages?" active":""}" onclick="TK.setPage(${totalPages})">${totalPages}</button>` : ""}
            <button class="tk-pg-btn" ${page>=totalPages?"disabled":""} onclick="TK.setPage(${page+1})">▶</button>
          </div>
        </div>`;

    // ── right sidebar ─────────────────────────────────────────────────────────
    // Tasks by status donut chart
    const stCounts = {
      inprogress: tasks.filter(t => ["inprogress"].includes(taskStatusKey(t.status))).length,
      pending:    tasks.filter(t => ["waiting","blocked","assigned"].includes(taskStatusKey(t.status))).length,
      notstarted: tasks.filter(t => taskStatusKey(t.status) === "open").length,
      done:       tasks.filter(t => t.status === "done").length,
    };
    const stTotal = tasks.length || 1;
    const stColors = { inprogress: "#4A90D9", pending: "#E08A3C", notstarted: "#9CA3AF", done: "#4CAF7D" };
    const stLabels = {
      inprogress: ar("قيد التنفيذ","In Progress"),
      pending:    ar("بانتظار","Pending"),
      notstarted: ar("لم تبدأ","Not Started"),
      done:       ar("مكتملة","Completed"),
    };
    let cumDeg = 0;
    const donutSegs = Object.entries(stCounts).map(([k, cnt]) => {
      const pct = cnt / stTotal;
      const deg = pct * 360;
      const seg = `<div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(transparent ${cumDeg}deg, ${stColors[k]} ${cumDeg}deg ${cumDeg+deg}deg, transparent ${cumDeg+deg}deg)"></div>`;
      cumDeg += deg;
      return seg;
    }).join("");
    const donutChart = `<div class="tk-donut-wrap">
      <div class="tk-donut" style="position:relative">
        ${donutSegs}
        <div class="tk-donut-hole">
          <div class="tk-donut-n">${tasks.length}</div>
          <div class="tk-donut-l">${ar("الإجمالي","Total")}</div>
        </div>
      </div>
      <div class="tk-donut-legend">
        ${Object.entries(stCounts).map(([k,cnt]) => `
          <div class="tk-legend-row">
            <span class="tk-legend-dot" style="background:${stColors[k]}"></span>
            <span class="tk-legend-lbl">${stLabels[k]}</span>
            <span class="tk-legend-cnt">${cnt} <span class="tk-legend-pct">(${Math.round(cnt/stTotal*100)}%)</span></span>
          </div>`).join("")}
      </div>
    </div>`;

    // Upcoming deadlines (next 5, not done, has due_date)
    const upcoming = tasks
      .filter(t => t.due_date && t.due_date >= today && !["done","cancelled"].includes(t.status))
      .sort((a,b) => a.due_date < b.due_date ? -1 : 1)
      .slice(0, 5);
    const upcomingHtml = upcoming.length === 0
      ? `<div class="tk-side-empty">${ar("لا مواعيد قادمة","No upcoming deadlines")}</div>`
      : upcoming.map(t => {
          const d = new Date(t.due_date + "T00:00:00");
          const pm2 = tkPriMeta(t.priority);
          const dayNum = isNaN(d) ? "" : d.getDate();
          const mon = isNaN(d) ? "" : d.toLocaleDateString(l==="ar"?"ar-EG":"en-US",{month:"short"}).toUpperCase();
          const text = (l==="ar" ? t.text_ar : t.text_en || t.text_ar) || "";
          const mtg  = (l==="ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar) || "";
          return `<div class="tk-dead-row">
            <div class="tk-dead-date">
              <div class="tk-dead-day">${dayNum}</div>
              <div class="tk-dead-mon">${mon}</div>
            </div>
            <div class="tk-dead-info">
              <div class="tk-dead-t">${esc(text.length>42?text.substring(0,42)+"…":text)}</div>
              ${mtg ? `<div class="tk-dead-s">${esc(mtg.length>30?mtg.substring(0,30)+"…":mtg)}</div>` : ""}
            </div>
            <span class="tk-pri ${pm2.cls}" style="flex-shrink:0">${ar(pm2.ar,pm2.en)}</span>
          </div>`;
        }).join("");

    // Recent completed
    const recentDone = tasks
      .filter(t => t.status === "done")
      .sort((a,b) => (b.updated_at||b.created_at||"").localeCompare(a.updated_at||a.created_at||""))
      .slice(0, 4);
    const recentDoneHtml = recentDone.length === 0
      ? `<div class="tk-side-empty">${ar("لا مهام مكتملة بعد","No completed tasks yet")}</div>`
      : recentDone.map(t => {
          const text = (l==="ar" ? t.text_ar : t.text_en || t.text_ar) || "";
          const mtg  = (l==="ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar) || "";
          const doneDate = fmtDate((t.updated_at||t.created_at||"").substring(0,10));
          return `<div class="tk-done-row">
            <span class="tk-done-ico">✓</span>
            <div class="tk-done-info">
              <div class="tk-done-t">${esc(text.length>40?text.substring(0,40)+"…":text)}</div>
              <div class="tk-done-s">${esc(mtg.length>28?mtg.substring(0,28)+"…":mtg)||"—"} · ${doneDate}</div>
            </div>
          </div>`;
        }).join("");

    const sidebarHtml = `<div class="tk-sidebar">
      <div class="tk-side-card">
        <div class="tk-side-title">${ar("المهام حسب الحالة","Tasks by Status")}</div>
        ${donutChart}
      </div>
      <div class="tk-side-card">
        <div class="tk-side-title">${ar("المواعيد القادمة","Upcoming Deadlines")}</div>
        ${upcomingHtml}
        ${upcoming.length >= 3 ? `<a class="tk-side-link" href="javascript:void(0)" onclick="TK.setFilter('status','')">
          ${ar("عرض كل المواعيد","View All Deadlines")} →</a>` : ""}
      </div>
      <div class="tk-side-card">
        <div class="tk-side-title">${ar("المكتملة مؤخراً","Recent Completed Tasks")}</div>
        ${recentDoneHtml}
        ${recentDone.length >= 3 ? `<a class="tk-side-link" href="javascript:void(0)" onclick="TK.setTab('all');TK.setFilter('status','done')">
          ${ar("عرض كل المكتملة","View All Completed")} →</a>` : ""}
      </div>
    </div>`;

    // ── Pending Review section ────────────────────────────────────────────────
    const pendingReviewBodyHtml = pendingReviewTasks.length === 0
      ? `<div class="tk-empty"><div style="font-size:28px;margin-bottom:8px">✅</div><div style="font-size:13px;color:var(--text2)">${ar("لا مهام بانتظار المراجعة","No tasks pending review")}</div></div>`
      : `<div class="tk-rv-grid">
        ${pendingReviewTasks.map(t => {
          const text  = (l==="ar" ? t.text_ar||t.text_en : t.text_en||t.text_ar) || "";
          const owner = (l==="ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar) || "";
          const pm2   = tkPriMeta(t.priority);
          const mtg   = (l==="ar" ? t.source_meeting_title_ar : t.source_meeting_title_en||t.source_meeting_title_ar)||"";
          return `<div class="tk-side-card" style="border-inline-start:3px solid var(--gold)">
            <div class="tk-task-t" style="margin-bottom:8px">${esc(text)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              <span class="tk-pri ${pm2.cls}">${ar(pm2.ar,pm2.en)}</span>
              ${owner ? `<span style="font-size:11px;color:var(--text3)">👤 ${esc(owner)}</span>` : ""}
              ${mtg ? `<span style="font-size:11px;color:var(--text3)">📝 ${esc(mtg.length>30?mtg.substring(0,30)+"…":mtg)}</span>` : ""}
              ${t.due_date ? `<span style="font-size:11px;color:var(--text3)">📅 ${esc(t.due_date)}</span>` : ""}
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn-ghost btn-sm" onclick="Tasks.edit(${t.id})">✏️ ${ar("تعديل","Edit")}</button>
              <button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick="ReviewQueue.reject(${t.id})">✕ ${ar("رفض","Reject")}</button>
              <button class="btn-gold btn-sm" onclick="ReviewQueue.approve(${t.id})">✓ ${ar("اعتماد","Approve")}</button>
            </div>
          </div>`;
        }).join("")}
        </div>`;

    // ── Smart Suggestions ─────────────────────────────────────────────────────
    const suggestions = [];
    if (overdueCount > 0)
      suggestions.push({ ico: "📅", ar: `${overdueCount} مهام تجاوزت الموعد`, en: `${overdueCount} task${overdueCount!==1?"s":""} ${overdueCount===1?"has":"have"} passed their deadline`,
        sub_ar: "راجع مهامك المتأخرة", sub_en: "Review your overdue tasks",
        btn_ar: "عرض المتأخرة", btn_en: "View Tasks", onclick: `TK.setTab('all');TK.setFilter('status','overdue')` });
    if (pendingReviewTasks.length > 0)
      suggestions.push({ ico: "⏳", ar: `${pendingReviewTasks.length} مهام بانتظار مراجعتك`, en: `${pendingReviewTasks.length} task${pendingReviewTasks.length!==1?"s":""} waiting for your review`,
        sub_ar: "قدّم ملاحظاتك للمضي قدماً", sub_en: "Provide feedback to move forward",
        btn_ar: "مراجعة الآن", btn_en: "Review Now", onclick: `TK.setTab('review')` });
    if (dueWeekCount > 0)
      suggestions.push({ ico: "📄", ar: `${dueWeekCount} مهام مستحقة هذا الأسبوع`, en: `${dueWeekCount} task${dueWeekCount!==1?"s":""} due this week`,
        sub_ar: "تابع المهام المستحقة قريباً", sub_en: "Follow up on tasks due soon",
        btn_ar: "عرض المهام", btn_en: "View Tasks", onclick: `TK.setFilter('dueBefore','${weekEnd}')` });

    const suggestionsHtml = suggestions.length === 0 ? "" : `
      <div class="tk-suggestions">
        <div class="tk-sug-header">
          <span>⚡</span>
          <span class="tk-sug-title">${ar("اقتراحات ذكية من أمين","Smart Suggestions from Ameen")}</span>
          <button class="tk-sug-close" onclick="this.closest('.tk-suggestions').style.display='none'">✕</button>
        </div>
        <div class="tk-sug-cards">
          ${suggestions.map(s => `
            <div class="tk-sug-card">
              <div class="tk-sug-ico">${s.ico}</div>
              <div class="tk-sug-body">
                <div class="tk-sug-t">${ar(s.ar,s.en)}</div>
                <div class="tk-sug-s">${ar(s.sub_ar,s.sub_en)}</div>
              </div>
              <a class="tk-sug-btn" href="javascript:void(0)" onclick="${s.onclick}">${ar(s.btn_ar,s.btn_en)} →</a>
            </div>`).join("")}
        </div>
      </div>`;

    // ── view switcher ─────────────────────────────────────────────────────────
    const currentView = TaskView.get();
    const viewSwitcherHtml = `<div class="tk-view-bar">
      <button class="tk-view-btn${currentView==='list'?' active':''}" onclick="TaskView.set('list')">☰ ${ar("قائمة","List")}</button>
      <button class="tk-view-btn${currentView==='board'?' active':''}" onclick="TaskView.set('board')">⬛ ${ar("لوحة","Board")}</button>
    </div>`;

    // ── kanban board ──────────────────────────────────────────────────────────
    const boardCols = [
      { keys: ["open","assigned"], icon: "📥", ar: "لم تبدأ", en: "Not Started", color: "#697386" },
      { keys: ["inprogress"],      icon: "🔄", ar: "قيد التنفيذ", en: "In Progress", color: "#2E6FD8" },
      { keys: ["waiting","blocked","overdue"], icon: "⏳", ar: "معلّقة / متأخرة", en: "Pending / Overdue", color: "#B87018" },
      { keys: ["done"],            icon: "✅", ar: "مكتملة", en: "Done", color: "#12905C" },
    ];
    const boardCard = (t) => {
      const text  = (l==="ar" ? t.text_ar : t.text_en||t.text_ar)||"";
      const owner = (l==="ar" ? t.owner_name_ar : t.owner_name_en||t.owner_name_ar)||"";
      const pm2   = tkPriMeta(t.priority);
      const isOD  = t.status==="overdue";
      return `<div class="tk-board-card${isOD?" tk-board-overdue":""}" onclick="Tasks.edit(${t.id})">
        <div class="tk-board-t">${esc(text)}</div>
        <div style="display:flex;align-items:center;gap:5px;margin-top:7px;flex-wrap:wrap">
          <span class="tk-pri ${pm2.cls}" style="font-size:10px;padding:1px 5px">${ar(pm2.ar,pm2.en)}</span>
          ${owner?`<span style="font-size:10px;color:var(--text3)">👤 ${esc(owner)}</span>`:""}
          ${t.due_date?`<span style="font-size:10px;color:${isOD?"var(--red)":"var(--text3)"}">📅 ${fmtDateShort(t.due_date)}</span>`:""}
        </div>
      </div>`;
    };
    const boardHtml = `<div class="tk-board">
      ${boardCols.map(col=>{
        const colTasks = filtered.filter(t=>col.keys.includes(taskStatusKey(t.status)));
        return `<div class="tk-board-col">
          <div class="tk-board-col-h" style="color:${col.color}">${col.icon} ${ar(col.ar,col.en)} <span class="tk-tab-n">${colTasks.length}</span></div>
          <div class="tk-board-col-body">${colTasks.length
            ? colTasks.map(boardCard).join("")
            : `<div style="font-size:11px;color:var(--text3);text-align:center;padding:16px 0">${ar("لا توجد مهام","No tasks")}</div>`}
          </div>
        </div>`;
      }).join("")}
    </div>`;

    // ── final assembly ────────────────────────────────────────────────────────
    const mainContent = tab === "review"
      ? `<div class="tk-main">${tabHtml}${pendingReviewBodyHtml}</div>`
      : `<div class="tk-main">${tabHtml}${viewSwitcherHtml}${filterBar}${currentView==="board" ? boardHtml : tableHtml}</div>`;

    body.innerHTML = `
      ${kpiHtml}
      <div class="tk-layout">
        ${mainContent}
        ${sidebarHtml}
      </div>
      ${suggestionsHtml}`;

  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

// ══ Tasks Actions ════ ����════════════════════════════════════════════════════════
const Tasks = {
  async updateStatus(id, status) {
    try {
      await api(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadBadges();
      renderTasks();
    } catch (e) {
      alert(e.message);
    }
  },
  async updateProgress(id, progress) {
    try {
      await api(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ progress: Number(progress) }),
      });
      renderTasks();
    } catch (e) {
      alert(e.message);
    }
  },
  async edit(id) {
    const l = App.lang;
    const t = (App.tasksCache || []).find((x) => x.id === id);
    if (!t) return;
    // Pre-fill the modal and open in edit mode (no browser prompt).
    Modals._editingId = id;
    const titleEl = $("modal-title-txt");
    if (titleEl)
      titleEl.textContent = l === "ar" ? "تعديل المهمة" : "Edit Task";
    $("nt-ar").value = t.text_ar || "";
    $("nt-en").value = t.text_en || t.text_ar || "";
    $("nt-due").value = t.due_date || "";
    $("nt-priority").value = taskPriorityKey(t.priority);
    const ownerSel = $("nt-owner");
    if (ownerSel && t.owner_id) ownerSel.value = String(t.owner_id);
    // When the AI extracted a name but couldn't match it to a real system
    // user, owner_id stays null and the dropdown falls back to "-- Select --"
    // with no clue what the AI actually saw — the manager would have to
    // already remember the name from the meeting to fill it in correctly.
    // Surface the AI-suggested name explicitly instead of leaving it silent.
    const ownerHint = $("nt-owner-hint");
    if (ownerHint) {
      const aiName = l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar;
      if (!t.owner_id && aiName) {
        ownerHint.style.display = "";
        ownerHint.textContent = (l === "ar" ? "⚑ اقترحه الذكاء الاصطناعي: " : "⚑ AI suggested: ") + aiName + (l === "ar" ? " — لم يُربط بمستخدم في النظام" : " — not linked to a system user");
      } else {
        ownerHint.style.display = "none";
      }
    }
    const statusRow = $("nt-status-row");
    const statusSel = $("nt-status");
    if (statusRow && statusSel) {
      statusRow.style.display = "";
      const opts = TASK_ASSIGNABLE_STATUSES.slice();
      if (t.status === "overdue") opts.push("overdue");
      statusSel.innerHTML = opts.map((k) => `<option value="${k}">${l === "ar" ? TASK_STATUS_META[k].ar : TASK_STATUS_META[k].en}</option>`).join("");
      statusSel.value = taskStatusKey(t.status);
    }
    // The backend (PATCH /api/tasks/:id) silently drops text/owner/due/
    // priority edits from anyone without actions.assign — only status/notes/
    // progress actually save. Without this, an assignee editing the title or
    // reassigning the owner sees a "Task updated" success toast while those
    // specific changes quietly vanish. Disable exactly what won't persist so
    // the form matches reality instead of lying about what it can do.
    const canManage = App.can("actions.assign");
    ["nt-ar", "nt-en", "nt-due", "nt-priority", "nt-owner"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !canManage;
    });
    const restrictedNote = $("modal-task-restricted-note");
    if (restrictedNote) {
      restrictedNote.style.display = canManage ? "none" : "";
      restrictedNote.textContent = canManage ? "" : (l === "ar" ? "ℹ️ يمكنك تحديث الحالة وإضافة تحديثات التقدم فقط. لتعديل التفاصيل الأخرى تواصل مع مديرك." : "ℹ️ You can update status and add progress updates. Contact your manager to change other details.");
    }
    $("modal-task").classList.add("open");
    TaskTimeline.load(id, t);
    TaskAttachments.load(id);
  },
  async delete(id) {
    if (!confirm(App.lang === "ar" ? "حذف هذه المهمة؟" : "Delete this task?"))
      return;
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
    } catch (e) {

      showToast(
        (App.lang === "ar" ? "تعذّر حذف المهمة: " : "Could not delete task: ") +
          e.message,
        "error",
      );
      return;
    }
    var _tr = document.getElementById("tr-" + id); if (_tr) _tr.remove();
    await loadBadges();
  },
  async updateDecisionStatus(id, status) {
    await api(`/api/decisions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => {});
  },
  async deleteDecision(id) {
    if (
      !confirm(App.lang === "ar" ? "حذف هذا القرار؟" : "Delete this decision?")
    )
      return;
    try {
      await api(`/api/decisions/${id}`, { method: "DELETE" });
    } catch (e) {
      showToast(
        (App.lang === "ar" ? "تعذّر حذف القرار: " : "Could not delete decision: ") +
          e.message,
        "error",
      );
      return;
    }
    renderTasks();
  },
};

// ══ Pending Review Queue — bulk actions for AI-extracted tasks ═══════════════════
const ReviewQueue = {
  toggleAll(checked) {
    document.querySelectorAll(".rv-chk").forEach((c) => { c.checked = checked; });
    this.updateCount();
  },
  getSelected() {
    return [...document.querySelectorAll(".rv-chk:checked")].map((c) => Number(c.dataset.id));
  },
  updateCount() {
    const n = this.getSelected().length;
    const countEl = $("rv-selected-count");
    if (countEl) countEl.textContent = `${n} ${App.lang === "ar" ? "محدد" : "selected"}`;
    ["rv-bulk-approve", "rv-bulk-assign", "rv-bulk-reject", "rv-bulk-delete"].forEach((id) => {
      const btn = $(id);
      if (btn) btn.disabled = n === 0;
    });
    const all = document.querySelectorAll(".rv-chk");
    const allChk = $("rv-select-all");
    if (allChk) allChk.checked = all.length > 0 && n === all.length;
  },
  async approve(id) {
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ review_status: "approved" }) });
      showToast(App.lang === "ar" ? "✓ تم اعتماد الإجراء التنفيذي" : "✓ Executive Action approved", "success");
      await loadBadges();
      renderTasks();
    } catch (e) {
      showToast(e.message, "error");
    }
  },
  async reject(id) {
    const l = App.lang;
    if (!confirm(l === "ar" ? "رفض هذه المهمة المقترحة من الذكاء الاصطناعي؟" : "Reject this AI-suggested task?")) return;
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ review_status: "rejected", status: "cancelled" }) });
      await loadBadges();
      renderTasks();
    } catch (e) {
      showToast(e.message, "error");
    }
  },
  async bulkApprove() {
    const ids = this.getSelected();
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ review_status: "approved" }) })));
      showToast(App.lang === "ar" ? `✓ تم إنشاء ${ids.length} إجراء تنفيذي` : `✓ ${ids.length} Executive Actions Created`, "success");
      await loadBadges();
      renderTasks();
    } catch (e) {
      showToast(e.message, "error");
    }
  },
  async bulkReject() {
    const ids = this.getSelected();
    if (!ids.length) return;
    const l = App.lang;
    if (!confirm(l === "ar" ? `رفض ${ids.length} مهمة مقترحة؟` : `Reject ${ids.length} suggested tasks?`)) return;
    try {
      await Promise.all(ids.map((id) => api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ review_status: "rejected", status: "cancelled" }) })));
      await loadBadges();
      renderTasks();
    } catch (e) {
      showToast(e.message, "error");
    }
  },
  async bulkDelete() {
    const ids = this.getSelected();
    if (!ids.length) return;
    const l = App.lang;
    if (!confirm(l === "ar" ? `حذف ${ids.length} مهمة؟` : `Delete ${ids.length} tasks?`)) return;
    try {
      await Promise.all(ids.map((id) => api(`/api/tasks/${id}`, { method: "DELETE" })));
      await loadBadges();
      renderTasks();
    } catch (e) {
      showToast(e.message, "error");
    }
  },
  bulkAssign() {
    if (!this.getSelected().length) return;
    const bar = $("rv-assign-bar");
    if (bar) bar.style.display = "";
  },
  cancelBulkAssign() {
    const bar = $("rv-assign-bar");
    if (bar) bar.style.display = "none";
  },
  async confirmBulkAssign() {
    const ids = this.getSelected();
    const sel = $("rv-assign-owner");
    const ownerId = sel && sel.value;
    if (!ids.length || !ownerId) {
      showToast(App.lang === "ar" ? "اختر عضواً للإسناد" : "Choose a member to assign", "error");
      return;
    }
    try {
      await Promise.all(ids.map((id) => api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ owner_id: Number(ownerId) }) })));
      showToast(App.lang === "ar" ? "✓ تم إسناد المهام المحددة" : "✓ Selected tasks assigned", "success");
      renderTasks();
    } catch (e) {
      showToast(e.message, "error");
    }
  },
};

// ══ Task Modal ════════════════════════════════════════════════════════════════
const Modals = {
  _editingId: null,
  _resetTitle() {
    const el = $("modal-title-txt");
    if (el) {
      el.dataset.ar = "إضافة مهمة جديدة";
      el.dataset.en = "Add New Task";
      el.textContent = App.lang === "ar" ? "إضافة مهمة جديدة" : "Add New Task";
    }
  },
  addTask() {
    this._editingId = null;
    this._resetTitle();
    ["nt-ar", "nt-en", "nt-due", "nt-priority", "nt-owner"].forEach((id) => {
      const el = $(id);
      if (el) { el.disabled = false; if (id !== "nt-priority") el.value = ""; }
    });
    const p = $("nt-priority");
    if (p) p.value = "medium";
    const o = $("nt-owner");
    if (o) o.value = "";
    const ownerHint = $("nt-owner-hint");
    if (ownerHint) ownerHint.style.display = "none";
    const restrictedNote = $("modal-task-restricted-note");
    if (restrictedNote) restrictedNote.style.display = "none";
    const statusRow = $("nt-status-row");
    if (statusRow) statusRow.style.display = "none";
    const attSec = $("nt-attachments-section");
    if (attSec) attSec.style.display = "none";
    $("modal-task").classList.add("open");
  },
  close() {
    $("modal-task").classList.remove("open");
    this._editingId = null;
    this._resetTitle();
    const tc = document.getElementById("task-timeline-container");
    if (tc) tc.remove();
  },
  async saveTask() {
    const l = App.lang;
    const statusSel = $("nt-status");
    const data = {
      text_ar: $("nt-ar").value.trim(),
      text_en: $("nt-en").value.trim() || $("nt-ar").value.trim(),
      owner_id: $("nt-owner").value || null,
      due_date: $("nt-due").value,
      priority: $("nt-priority").value,
    };
    if (this._editingId && statusSel && statusSel.value) data.status = statusSel.value;
    if (!data.text_ar) {
      alert(l === "ar" ? "أدخل نص المهمة" : "Enter task text");
      return;
    }
    try {
      if (this._editingId) {
        await api(`/api/tasks/${this._editingId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
        showToast(l === "ar" ? "تم تحديث المهمة" : "Task updated", "success");
      } else {
        await api("/api/tasks", { method: "POST", body: JSON.stringify(data) });
      }
      this.close();
      await renderTasks();
      await loadBadges();
    } catch (e) {
      alert(e.message);
    }
  },
};
$("modal-task").addEventListener("click", (e) => {
  if (e.target === $("modal-task")) Modals.close();
});

// ══ Task Progress Timeline ════════════════════════════════════════════════════
const TaskTimeline = {
  async load(taskId, task) {
    const l = App.lang;
    const existing = document.getElementById("task-timeline-container");
    if (existing) existing.remove();
    const modal = document.querySelector("#modal-task .modal");
    if (!modal) return;
    const container = document.createElement("div");
    container.id = "task-timeline-container";
    container.style.cssText = "margin-top:14px;border-top:1px solid var(--border2);padding-top:14px";
    container.innerHTML = `<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0"><div class="loading" style="width:16px;height:16px;margin:0 auto"></div></div>`;
    modal.appendChild(container);
    try {
      const updates = await api(`/api/tasks/${taskId}/updates`);
      this.render(container, taskId, task, updates, l);
    } catch (e) {
      container.innerHTML = `<div style="font-size:11px;color:var(--red);padding:6px">${e.message}</div>`;
    }
  },

  render(container, taskId, task, updates, l) {
    const statusLabel = (s) => ({ new: l==='ar'?'جديدة':'New', inprogress: l==='ar'?'جارٍ':'In Progress', overdue: l==='ar'?'متأخرة':'Overdue', done: l==='ar'?'مكتملة':'Done' }[s] || s || '');
    const statusStyle = (s) => ({ new: 'background:var(--navy4);color:var(--text)', inprogress: 'background:rgba(255,160,0,.15);color:#f0a000', overdue: 'background:rgba(220,50,50,.15);color:#e05252', done: 'background:rgba(50,180,100,.15);color:#32b464' }[s] || '');
    const dotColor = (s) => ({ done:'#32b464', overdue:'#e05252', inprogress:'#f0a000' }[s] || 'var(--text3)');
    const dot = (c) => `<div style="width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0;margin-top:3px;border:2px solid var(--bg2,var(--bg));z-index:1;position:relative"></div>`;
    const fmt = (dt) => (dt||'').substring(0,16).replace('T',' ');

    const items = [];

    // ── Created node ──
    items.push(`<div style="display:flex;gap:10px;align-items:flex-start;padding-bottom:14px">
      ${dot('var(--gold)')}
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:700;color:var(--gold)">${l==='ar'?'تم الإنشاء':'Created'}</div>
        ${task.created_at ? `<div style="font-size:11px;color:var(--text3)">${fmt(task.created_at)}</div>` : ''}
        ${task.owner_name_en||task.owner_name_ar ? `<div style="font-size:11px;color:var(--text3)">${l==='ar'?'المسؤول: ':'Owner: '}${esc(l==='ar'?task.owner_name_ar:task.owner_name_en||task.owner_name_ar)}</div>` : ''}
      </div>
    </div>`);

    // ── Update nodes ──
    updates.forEach(u => {
      items.push(`<div style="display:flex;gap:10px;align-items:flex-start;padding-bottom:14px">
        ${dot(dotColor(u.status_snapshot))}
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:11px;font-weight:700;color:var(--text)">${esc(u.author_name||'')}</span>
            ${u.author_role ? `<span style="font-size:11px;color:var(--text3)">· ${esc(u.author_role)}</span>` : ''}
            ${u.status_snapshot ? `<span class="tag" style="font-size:10.5px;padding:1px 5px;${statusStyle(u.status_snapshot)}">${statusLabel(u.status_snapshot)}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text);line-height:1.55;margin-bottom:2px">${esc(u.update_text)}</div>
          <div style="font-size:11px;color:var(--text3)">${fmt(u.created_at)}</div>
        </div>
      </div>`);
    });

    // ── Completed node ──
    if (task.status === 'done') {
      items.push(`<div style="display:flex;gap:10px;align-items:flex-start">
        ${dot('#32b464')}
        <div><div style="font-size:11px;font-weight:700;color:#32b464">${l==='ar'?'مكتملة ✓':'Completed ✓'}</div></div>
      </div>`);
    }

    container.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px">
        📋 ${l==='ar'?'سجل التحديثات':'Progress History'}
        ${updates.length ? `<span class="tag" style="background:var(--navy4);font-size:11px;margin-${l==='ar'?'right':'left'}:4px">${updates.length}</span>` : ''}
      </div>
      <div style="position:relative">
        <div style="position:absolute;top:5px;bottom:5px;left:4px;width:1px;background:var(--border2)"></div>
        <div style="padding-left:22px">${items.join('')}</div>
      </div>
      <div style="margin-top:10px;border-top:1px solid var(--border2);padding-top:10px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:5px">${l==='ar'?'إضافة تحديث:':'Add Update:'}</div>
        <textarea id="task-update-input" rows="2" class="fi" dir="${l==='ar'?'rtl':'ltr'}"
          style="width:100%;resize:vertical;font-size:12px;line-height:1.5;box-sizing:border-box"
          placeholder="${l==='ar'?'أدخل تحديثاً على المهمة...':'Enter a progress update...'}"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:6px">
          <button class="btn-gold btn-sm" id="task-update-save-btn" onclick="TaskTimeline.addUpdate(${taskId})">
            ✓ ${l==='ar'?'حفظ التحديث':'Save Update'}
          </button>
        </div>
      </div>
      <div style="margin-top:10px;border-top:1px solid var(--border2);padding-top:10px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:5px">${l==='ar'?'تصعيد المهمة إلى:':'Escalate task to:'}</div>
        <select id="task-escalate-target" class="fi" style="width:100%;margin-bottom:6px">
          <option value="">-- ${l==='ar'?'اختر عضواً':'Select a member'} --</option>
          ${(App._members || []).filter(u => u.id !== task.owner_id).map(u =>
            `<option value="${u.id}">${esc(l==='ar'?u.name_ar:(u.name_en||u.name_ar))}</option>`
          ).join('')}
        </select>
        <input id="task-escalate-comment" class="fi" dir="${l==='ar'?'rtl':'ltr'}"
          style="width:100%;font-size:12px;box-sizing:border-box;margin-bottom:6px"
          placeholder="${l==='ar'?'ملاحظة (اختياري)':'Comment (optional)'}"/>
        <div style="display:flex;justify-content:flex-end">
          <button class="btn-ghost btn-sm" id="task-escalate-btn" onclick="TaskTimeline.escalate(${taskId})" style="color:#9B72DB;border-color:rgba(155,114,219,.4)">
            ↑ ${l==='ar'?'تصعيد':'Escalate'}
          </button>
        </div>
      </div>
      <div id="task-attachments-section" style="margin-top:10px;border-top:1px solid var(--border2);padding-top:10px">
        <div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0"><div class="loading" style="width:14px;height:14px;margin:0 auto"></div></div>
      </div>`;
    TaskAttachments.load(taskId);
  },

  async addUpdate(taskId) {
    const l = App.lang;
    const input = document.getElementById("task-update-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text) { showToast(l==='ar'?'أدخل نص التحديث':'Enter update text', 'error'); return; }
    const btn = document.getElementById("task-update-save-btn");
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      await api(`/api/tasks/${taskId}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_text: text }),
      });
      input.value = '';
      const task = (App.tasksCache || []).find(x => x.id === taskId) || {};
      const updates = await api(`/api/tasks/${taskId}/updates`);
      const container = document.getElementById("task-timeline-container");
      if (container) this.render(container, taskId, task, updates, l);
      showToast(l==='ar'?'تم حفظ التحديث':'Update saved', 'success');
    } catch (e) {
      showToast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = `✓ ${l==='ar'?'حفظ التحديث':'Save Update'}`; }
    }
  },

  async escalate(taskId) {
    const l = App.lang;
    const sel = document.getElementById("task-escalate-target");
    const commentEl = document.getElementById("task-escalate-comment");
    if (!sel) return;
    const escalate_to_id = sel.value;
    if (!escalate_to_id) { showToast(l==='ar'?'اختر عضواً للتصعيد إليه':'Select a member to escalate to', 'error'); return; }
    const btn = document.getElementById("task-escalate-btn");
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      await api(`/api/tasks/${taskId}/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escalate_to_id: Number(escalate_to_id), comments: (commentEl && commentEl.value.trim()) || '' }),
      });
      const task = (App.tasksCache || []).find(x => x.id === taskId) || {};
      const updates = await api(`/api/tasks/${taskId}/updates`);
      const container = document.getElementById("task-timeline-container");
      if (container) this.render(container, taskId, task, updates, l);
      showToast(l==='ar'?'تم تصعيد المهمة':'Task escalated', 'success');
      await renderTasks();
      await loadBadges();
    } catch (e) {
      showToast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = `↑ ${l==='ar'?'تصعيد':'Escalate'}`; }
    }
  },
};

// ── Task Attachments — progress evidence / completion proof on an executive
// action, same upload mechanics as meeting documents (DocLib.upload above).
const TaskAttachments = {
  async load(taskId) {
    const l = App.lang;
    const section = document.getElementById("task-attachments-section");
    if (!section) return;
    try {
      const attachments = await api(`/api/tasks/${taskId}/attachments`);
      this.render(section, taskId, attachments, l);
    } catch (e) {
      section.innerHTML = `<div style="font-size:11px;color:var(--red)">${esc(e.message)}</div>`;
    }
  },
  render(section, taskId, attachments, l) {
    const fmtSize = (n) => n > 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const rows = attachments.map((a) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--navy3);border-radius:6px;margin-bottom:5px">
        <span style="font-size:14px;flex-shrink:0">${a.kind === "completion" ? "✅" : "📎"}</span>
        <a href="/api/tasks/${taskId}/attachments/${a.id}/download" rel="noopener" style="flex:1;min-width:0;font-size:11.5px;color:var(--text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.file_name)}" dir="auto">${esc(a.file_name)}</a>
        <span style="font-size:10.5px;color:var(--text3);flex-shrink:0">${fmtSize(a.file_size)}</span>
        <button onclick="TaskAttachments.remove(${taskId}, ${a.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:12px;flex-shrink:0" title="${l === "ar" ? "حذف" : "Remove"}">✕</button>
      </div>`).join("");
    section.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">
        📎 ${l === "ar" ? "المرفقات وأدلة الإنجاز" : "Attachments & Completion Evidence"}
        ${attachments.length ? `<span class="tag" style="background:var(--navy4);font-size:11px;margin-${l === "ar" ? "right" : "left"}:4px">${attachments.length}</span>` : ""}
      </div>
      ${rows || `<div style="font-size:11px;color:var(--text3);font-style:italic;padding:4px 0 8px">${l === "ar" ? "لا توجد مرفقات بعد" : "No attachments yet"}</div>`}
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn-ghost btn-sm" id="task-att-btn" onclick="TaskAttachments.upload(${taskId}, 'attachment')">📎 ${l === "ar" ? "إرفاق ملف" : "Attach File"}</button>
        <button class="btn-ghost btn-sm" onclick="TaskAttachments.upload(${taskId}, 'completion')" style="color:var(--green);border-color:rgba(50,180,100,.4)">✅ ${l === "ar" ? "إرفاق دليل إنجاز" : "Attach Completion Evidence"}</button>
      </div>`;
  },
  upload(taskId, kind) {
    const l = App.lang;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.xlsx,.pptx,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const btn = document.getElementById("task-att-btn");
      if (btn) { btn.disabled = true; btn.textContent = "..."; }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      try {
        const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", credentials: "include", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Upload failed");
        await this.load(taskId);
        showToast(l === "ar" ? "تم إرفاق الملف" : "File attached", "success");
      } catch (err) {
        showToast(err.message, "error");
        await this.load(taskId);
      }
    };
    input.click();
  },
  async remove(taskId, attId) {
    const l = App.lang;
    if (!confirm(l === "ar" ? "حذف هذا المرفق؟" : "Remove this attachment?")) return;
    try {
      await api(`/api/tasks/${taskId}/attachments/${attId}`, { method: "DELETE" });
      await this.load(taskId);
    } catch (e) {
      showToast(e.message, "error");
    }
  },
};

// ── Notification Center — in-app notifications backed by GET /api/notifications.
// Polls the unread count on an interval independent of Panels' own live-refresh
// (the bell lives in the topbar, visible from every panel, not just the ones
// with a registered live-refresh handler).
const NotificationCenter = {
  _open: false,
  _pollTimer: null,
  _outsideHandler: null,

  init() {
    this.refreshBadge();
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (!document.hidden) this.refreshBadge();
    }, 30000);
  },

  async refreshBadge() {
    try {
      const r = await api("/api/notifications/unread-count");
      const badge = $("notif-bell-badge");
      if (!badge) return;
      badge.textContent = r.unread_count > 99 ? "99+" : String(r.unread_count);
      badge.style.display = r.unread_count > 0 ? "" : "none";
    } catch (e) {}
  },

  async toggle() {
    const dd = $("notif-dropdown");
    if (!dd) return;
    if (this._open) return this.close();
    this._open = true;
    dd.style.display = "block";
    dd.innerHTML = `<div class="es" style="padding:24px"><div class="loading"></div></div>`;
    await this.render();
    // Close on outside click — registered once per open so it doesn't pile up.
    this._outsideHandler = (e) => {
      if (!dd.contains(e.target) && e.target.id !== "notif-bell-btn" && !e.target.closest("#notif-bell-btn")) {
        this.close();
      }
    };
    setTimeout(() => document.addEventListener("click", this._outsideHandler), 0);
  },

  close() {
    this._open = false;
    const dd = $("notif-dropdown");
    if (dd) dd.style.display = "none";
    if (this._outsideHandler) {
      document.removeEventListener("click", this._outsideHandler);
      this._outsideHandler = null;
    }
  },

  async render() {
    const l = App.lang;
    const dd = $("notif-dropdown");
    if (!dd) return;
    let data;
    try {
      data = await api("/api/notifications?limit=30");
    } catch (e) {
      dd.innerHTML = `<div class="es" style="padding:20px;color:var(--red)">${esc(e.message)}</div>`;
      return;
    }
    const items = data.notifications || [];
    const timeAgo = (ts) => {
      const diffMin = Math.max(0, Math.round((Date.now() - new Date(ts.replace(" ", "T") + "Z").getTime()) / 60000));
      if (diffMin < 1) return l === "ar" ? "الآن" : "just now";
      if (diffMin < 60) return `${diffMin}${l === "ar" ? " د" : "m"}`;
      const diffHr = Math.round(diffMin / 60);
      if (diffHr < 24) return `${diffHr}${l === "ar" ? " س" : "h"}`;
      return `${Math.round(diffHr / 24)}${l === "ar" ? " ي" : "d"}`;
    };
    const rows = items.map((n) => {
      const unread = !n.read_at;
      const title = l === "ar" ? n.title_ar : n.title_en || n.title_ar;
      const body = l === "ar" ? n.body_ar : n.body_en || n.body_ar;
      return `<div onclick="NotificationCenter.open(${n.id}, '${n.source_type || ""}', ${n.source_id || "null"})"
          style="display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border3);cursor:pointer;${unread ? "background:rgba(201,168,76,.06)" : ""}">
        <span style="flex-shrink:0;margin-top:4px;width:8px;height:8px;border-radius:100%;background:${unread ? "var(--gold)" : "transparent"}"></span>
        <div style="min-width:0;flex:1">
          <div style="font-size:12.5px;font-weight:${unread ? "700" : "600"};color:var(--text);margin-bottom:2px">${esc(title)}</div>
          <div style="font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(body || "")}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:3px">${timeAgo(n.created_at)}</div>
        </div>
      </div>`;
    }).join("");
    dd.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border2)">
        <span style="font-size:13px;font-weight:700;color:var(--text)">🔔 ${l === "ar" ? "الإشعارات" : "Notifications"}</span>
        ${items.some((n) => !n.read_at) ? `<button class="btn-ghost btn-sm" style="font-size:11px;padding:4px 8px" onclick="NotificationCenter.readAll()">${l === "ar" ? "تحديد الكل كمقروء" : "Mark all read"}</button>` : ""}
      </div>
      ${rows || `<div class="es" style="padding:28px 16px"><div style="font-size:26px;margin-bottom:6px">🔕</div><div style="font-size:12px;color:var(--text3)">${l === "ar" ? "لا توجد إشعارات" : "No notifications yet"}</div></div>`}`;
  },

  async open(id, sourceType, sourceId) {
    try { await api(`/api/notifications/${id}/read`, { method: "PATCH" }); } catch (e) {}
    this.close();
    this.refreshBadge();
    const panelMap = { task: "tasks", meeting: "transcripts", schedule: "scheduled", resolution: "governance", document: "documents", policy: "governance", vote: "governance" };
    const goto = panelMap[sourceType];
    if (goto) {
      await Panels.load(goto);
      // Deep-link into specific items when possible
      if (sourceType === "task" && sourceId) {
        setTimeout(() => { try { Tasks.edit(sourceId); } catch(e){} }, 200);
      } else if (sourceType === "meeting" && sourceId) {
        setTimeout(() => { try { if(window.MT) MT.openDetail(sourceId); } catch(e){} }, 200);
      } else if (sourceType === "schedule" && sourceId) {
        setTimeout(() => { try { ScheduledPanel.openWorkspace(sourceId); } catch(e){} }, 300);
      } else if (sourceType === "resolution") {
        setTimeout(() => { try { if(typeof MT !== 'undefined') MT.renderResolutions(); } catch(e){} }, 200);
      }
    }
  },

  async readAll() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      await this.render();
      this.refreshBadge();
    } catch (e) {}
  },
};

// ── Global Smart Search — GET /api/search fanned out server-side across
// meetings, tasks, documents, governance/resolutions, and schedule (which
// covers committee meetings and general assemblies too). Ask Ameen history
// has no server-side copy (see Chat.STORAGE_KEY) so it's matched here,
// client-side, against the same localStorage array the chat panel restores
// from — "if available" per the spec, and it genuinely is, just not on the
// backend.
const SmartSearch = {
  _open: false,
  _outsideHandler: null,

  toggle() {
    if (this._open) return this.close();
    this._open = true;
    const dd = $("smart-search-dropdown");
    if (!dd) return;
    dd.style.display = "block";
    const input = $("smart-search-input");
    if (input) { input.value = ""; setTimeout(() => input.focus(), 0); }
    $("smart-search-results").innerHTML = "";
    this._outsideHandler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest("#smart-search-btn")) this.close();
    };
    setTimeout(() => document.addEventListener("click", this._outsideHandler), 0);
  },

  close() {
    this._open = false;
    const dd = $("smart-search-dropdown");
    if (dd) dd.style.display = "none";
    if (this._outsideHandler) {
      document.removeEventListener("click", this._outsideHandler);
      this._outsideHandler = null;
    }
  },

  onInput(v) {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.run(v.trim()), 300);
  },

  async run(q) {
    const l = App.lang;
    const results = $("smart-search-results");
    if (!results) return;
    if (q.length < 2) {
      results.innerHTML = `<div class="es" style="padding:20px;font-size:12px">${l === "ar" ? "اكتب حرفين على الأقل" : "Type at least 2 characters"}</div>`;
      return;
    }
    results.innerHTML = `<div class="es" style="padding:20px"><div class="loading"></div></div>`;
    let data;
    try {
      data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    } catch (e) {
      results.innerHTML = `<div class="es" style="padding:20px;color:var(--red);font-size:12px">${esc(e.message)}</div>`;
      return;
    }
    const all = [...(data.results || []), ...this._localAskAmeenMatches(q)];
    if (!all.length) {
      results.innerHTML = `<div class="es" style="padding:24px"><div style="font-size:26px;margin-bottom:6px">🔍</div><div style="font-size:12px;color:var(--text3)">${l === "ar" ? "لا نتائج" : "No results"}</div></div>`;
      return;
    }
    const CAT_LABEL = {
      meetings: { ar: "📁 الاجتماعات", en: "📁 Meetings" },
      tasks: { ar: "📋 الإجراءات التنفيذية", en: "📋 Executive Actions" },
      documents: { ar: "📄 الوثائق", en: "📄 Documents" },
      governance: { ar: "⚖️ الحوكمة والقرارات", en: "⚖️ Governance & Resolutions" },
      committee_meetings: { ar: "🧭 اجتماعات اللجان", en: "🧭 Committee Meetings" },
      general_assembly: { ar: "🏛️ الجمعية العمومية", en: "🏛️ General Assembly" },
      ask_ameen: { ar: "🤖 اسأل أمين", en: "🤖 Ask Ameen" },
    };
    const byCategory = {};
    all.forEach((r) => { (byCategory[r.category] = byCategory[r.category] || []).push(r); });
    results.innerHTML = Object.keys(byCategory).map((cat) => {
      const label = CAT_LABEL[cat] || { ar: cat, en: cat };
      const rows = byCategory[cat].slice(0, 8).map((r, i) => {
        const idx = all.indexOf(r);
        const title = l === "ar" ? r.title_ar : r.title_en || r.title_ar;
        const subtitle = l === "ar" ? r.subtitle_ar : r.subtitle_en || r.subtitle_ar;
        return `<div onclick="SmartSearch.open(${idx})" style="padding:9px 16px;cursor:pointer;border-bottom:1px solid var(--border3)">
          <div style="font-size:12.5px;font-weight:600;color:var(--text)">${esc(title || "")}</div>
          ${subtitle ? `<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(subtitle)}</div>` : ""}
        </div>`;
      }).join("");
      return `<div style="padding:8px 16px 4px;font-size:11px;font-weight:700;color:var(--gold);background:var(--navy3)">${l === "ar" ? label.ar : label.en}</div>${rows}`;
    }).join("");
    this._lastResults = all;
  },

  _localAskAmeenMatches(q) {
    const qLower = q.toLowerCase();
    return (App.chatHistory || [])
      .filter((m) => m.role === "user" && (m.content || "").toLowerCase().includes(qLower))
      .slice(-5)
      .map((m) => ({ category: "ask_ameen", title_ar: m.content, title_en: m.content, subtitle_ar: "", subtitle_en: "", source_type: "ask_ameen", source_id: null }));
  },

  async open(idx) {
    const r = this._lastResults[idx];
    if (!r) return;
    this.close();
    const PANEL_FOR = { meeting: "history", task: "tasks", document: "documents", resolution: "governance", schedule: "calendar", ask_ameen: "ask" };
    const panel = PANEL_FOR[r.source_type];
    if (!panel) return;
    await Panels.load(panel);
    if (r.source_type === "task" && r.source_id) Tasks.edit(r.source_id);
    else if (r.source_type === "meeting" && r.source_id && typeof MeetingHistory !== "undefined") MeetingHistory.select(r.source_id);
  },
};

// ── Organization-wide Activity Timeline — GET /api/activity, a live merge of
// meeting lifecycle, minutes approval, task, and governance history the
// backend already logs for its own reasons. See src/routes/api.js for the
// exact sources; there is no separate frontend data model to keep in sync.
const Activity = {
  _search: "",
  _category: "",

  setSearch(v) {
    this._search = v;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.render(), 300);
  },
  setCategory(v) {
    this._category = v;
    this.render();
  },

  async render() {
    const l = App.lang;
    const body = $("activity-body");
    if (!body) return;
    body.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    const params = new URLSearchParams({ limit: "150" });
    if (this._search) params.set("q", this._search);
    let data;
    try {
      data = await api(`/api/activity?${params}`);
    } catch (e) {
      body.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
      return;
    }
    let items = data.activity || [];
    if (this._category) items = items.filter((i) => i.category === this._category);
    if (!items.length) {
      body.innerHTML = `<div class="es"><div style="font-size:32px;margin-bottom:8px">🕘</div><div>${l === "ar" ? "لا يوجد نشاط بعد" : "No activity yet"}</div></div>`;
      return;
    }
    const CAT_ICON = { meetings: "📁", tasks: "📋", governance: "⚖️" };
    const timeStr = (ts) => (ts || "").substring(0, 16).replace(" ", " · ");
    const rows = items.map((e) => {
      const title = l === "ar" ? e.title_ar : e.title_en || e.title_ar;
      const body_ = l === "ar" ? e.body_ar : e.body_en || e.body_ar;
      return `<div class="trow" style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid var(--border3)">
        <span style="font-size:16px;flex-shrink:0;margin-top:2px">${CAT_ICON[e.category] || "•"}</span>
        <div style="min-width:0;flex:1">
          <div style="font-size:12.5px;font-weight:700;color:var(--text)">${esc(title)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(body_ || "")}</div>
          <div style="font-size:10.5px;color:var(--text3);margin-top:4px">${e.actor_name ? esc(e.actor_name) + " · " : ""}${timeStr(e.created_at)}</div>
        </div>
      </div>`;
    }).join("");
    body.innerHTML = `<div class="card" style="padding:0;overflow:hidden">${rows}</div>`;
  },
};

// ── Ask Ameen — recent searches and favorite prompts, both frontend-only
// (localStorage), since there's no backend table for either concept.
const RecentSearches = {
  key: "ameen_chat_recent_searches",
  log(text) {
    let list = this.list().filter((q) => q !== text);
    list.unshift(text);
    try {
      localStorage.setItem(this.key, JSON.stringify(list.slice(0, 6)));
    } catch (e) {}
  },
  list() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || "[]");
    } catch (e) {
      return [];
    }
  },
};
const FavoritePrompts = {
  key: "ameen_chat_favorite_prompts",
  list() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || "[]");
    } catch (e) {
      return [];
    }
  },
  has(text) {
    return this.list().includes(text);
  },
  toggle(text) {
    let list = this.list();
    if (list.includes(text)) list = list.filter((f) => f !== text);
    else list = [text, ...list].slice(0, 10);
    try {
      localStorage.setItem(this.key, JSON.stringify(list));
    } catch (e) {}
  },
};

// ══ Chat ══════════════════════════════════════════════════════════════════════
const Chat = {
  STORAGE_KEY: "ameen_chat_history",
  _chipsHTML: null,
  async send(kind) {
    const inp = $("ci");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    inp.style.height = "";
    this.append(text, true);
    this.showTyping();
    App.chatHistory.push({ role: "user", content: text });
    this.persist();
    try {
      const r = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: App.chatHistory.slice(-10),
          lang: App.lang,
        }),
      });
      removeTyping();
      this.append(r.reply, false);
      App.chatHistory.push({ role: "assistant", content: r.reply });
      this.persist();
      RecentSearches.log(text);
      this.renderRecentSearches();
      if (r.demo) this.showDemoNote();
      if (kind) await this.appendSmartCards(kind);
    } catch (e) {
      removeTyping();
      this.append(
        App.lang === "ar" ? "عذراً، حدث خطأ." : "Sorry, an error occurred.",
        false,
      );
    }
  },
  quick(btn) {
    const q = App.lang === "ar" ? btn.dataset.qAr : btn.dataset.qEn;
    const kind = btn.dataset.kind || "";
    $("ci").value = q;
    this.send(kind);
  },
  key(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  },
  // ── Persistence (frontend-only) — survives page reloads within this
  // browser. True multi-conversation history/pinning/search would need a
  // backend table and is out of scope for this pass.
  persist() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(App.chatHistory.slice(-40)));
    } catch (e) {}
  },
  restore() {
    this.renderFavoritePrompts();
    this.renderRecentSearches();
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "[]");
    } catch (e) {
      saved = [];
    }
    if (!Array.isArray(saved) || !saved.length) return;
    App.chatHistory = saved;
    saved.forEach((m) => this.append(m.content, m.role === "user"));
  },
  clear() {
    App.chatHistory = [];
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (e) {}
    const m = $("chat-msgs");
    if (m) {
      if (this._chipsHTML === null) {
        // Cache the whole static tail (favorites row + recent-searches row +
        // suggested-action chips) once, so clearing the conversation doesn't
        // also wipe these persistent, always-available shortcuts.
        const fav = $("chat-favorite-prompts");
        const recent = $("chat-recent-searches");
        const chips = $("chat-chips");
        this._chipsHTML = (fav ? fav.outerHTML : "") + (recent ? recent.outerHTML : "") + (chips ? chips.outerHTML : "");
      }
      m.innerHTML = "";
      m.appendChild(buildWelcomeMsg());
      if (this._chipsHTML) m.insertAdjacentHTML("beforeend", this._chipsHTML);
      this.renderFavoritePrompts();
      this.renderRecentSearches();
    }
  },
  searchConversation(q) {
    const query = (q || "").trim().toLowerCase();
    document.querySelectorAll("#chat-msgs .msg").forEach((el) => {
      if (el.id === "welcome-msg" || el.id === "chat-chips") return;
      el.style.display = !query || el.textContent.toLowerCase().includes(query) ? "" : "none";
    });
  },
  toggleFavorite(text, btn) {
    FavoritePrompts.toggle(text);
    if (btn) {
      const isFav = FavoritePrompts.has(text);
      btn.textContent = isFav ? "★" : "☆";
      btn.style.color = isFav ? "var(--gold)" : "var(--text3)";
    }
    this.renderFavoritePrompts();
  },
  renderFavoritePrompts() {
    const el = $("chat-favorite-prompts");
    if (!el) return;
    const l = App.lang;
    const favs = FavoritePrompts.list();
    if (!favs.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin:8px 0 4px">⭐ ${l === "ar" ? "المفضّلة" : "Favorites"}</div>
      <div class="qchips">
        ${favs.map((f) => `<button class="qc" onclick="$('ci').value=${esc(JSON.stringify(f))};Chat.send()" title="${esc(f)}">⭐ ${esc(f.length > 36 ? f.substring(0, 36) + "…" : f)}</button>`).join("")}
      </div>`;
  },
  renderRecentSearches() {
    const el = $("chat-recent-searches");
    if (!el) return;
    const l = App.lang;
    const recents = RecentSearches.list();
    if (!recents.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin:8px 0 4px">🕐 ${l === "ar" ? "عمليات بحث حديثة" : "Recent Searches"}</div>
      <div class="qchips">
        ${recents.map((q) => `<button class="qc" onclick="$('ci').value=${esc(JSON.stringify(q))};Chat.send()" title="${esc(q)}">${esc(q.length > 36 ? q.substring(0, 36) + "…" : q)}</button>`).join("")}
      </div>`;
  },
  copyConversation() {
    const l = App.lang;
    if (!App.chatHistory.length) {
      showToast(l === "ar" ? "لا توجد محادثة لنسخها" : "No conversation to copy", "error");
      return;
    }
    const text = App.chatHistory.map((m) => `${m.role === "user" ? (l === "ar" ? "أنت" : "You") : "Ameen"}: ${m.content}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => showToast(l === "ar" ? "✓ تم نسخ المحادثة" : "✓ Conversation copied", "success"));
  },
  exportConversation() {
    const l = App.lang;
    if (!App.chatHistory.length) {
      showToast(l === "ar" ? "لا توجد محادثة للتصدير" : "No conversation to export", "error");
      return;
    }
    const text = App.chatHistory.map((m) => `${m.role === "user" ? (l === "ar" ? "أنت" : "You") : "Ameen"}: ${m.content}`).join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ameen-chat-${new Date().toISOString().substring(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  // ── Rich response cards — suggested-action chips that map to existing REST
  // data (meetings/decisions/governance) get a compact clickable card list
  // appended below the AI's text reply, so the assistant can also SHOW, not
  // just describe. Frontend-only: no AI/backend change.
  async appendSmartCards(kind) {
    const l = App.lang;
    try {
      if (kind === "search_meetings") {
        const meetings = await api("/api/meetings");
        this.appendCards(
          meetings.slice(0, 5).map((m) => ({
            title: l === "ar" ? m.title_ar : m.title_en || m.title_ar,
            sub: (m.meeting_date || "").substring(0, 10),
            onclick: `Panels.load('history').then(()=>MeetingHistory.select(${m.id}))`,
          })),
          l === "ar" ? "أحدث الاجتماعات" : "Most Recent Meetings",
        );
      } else if (kind === "find_decisions") {
        const decisions = await api("/api/decisions");
        const pending = decisions.filter((d) => d.status !== "implemented").slice(0, 5);
        this.appendCards(
          pending.map((d) => ({
            title: l === "ar" ? d.text_ar : d.text_en || d.text_ar,
            sub: l === "ar" ? d.meeting_title_ar || "" : d.meeting_title_en || d.meeting_title_ar || "",
            onclick: `Panels.load('tasks')`,
          })),
          l === "ar" ? "قرارات معلّقة" : "Pending Decisions",
        );
      } else if (kind === "search_governance") {
        const gov = await api("/api/gov/summary").catch(() => null);
        if (gov && gov.recentRes && gov.recentRes.length) {
          this.appendCards(
            gov.recentRes.slice(0, 5).map((r) => ({
              title: r.title,
              sub: l === "ar" ? r.meeting_title_ar || "" : r.meeting_title_en || r.meeting_title_ar || "",
              onclick: `Panels.load('governance')`,
            })),
            l === "ar" ? "آخر مستجدات الحوكمة" : "Latest Governance Updates",
          );
        }
      } else if (kind === "generate_report") {
        this.appendCards(
          [{ title: l === "ar" ? "📈 فتح مولّد الوثائق والتقارير" : "📈 Open Document & Report Generator", sub: "", onclick: `Panels.load('documents')` }],
          l === "ar" ? "إجراء سريع" : "Quick Action",
        );
      } else if (kind === "create_action") {
        this.appendCards(
          [{ title: l === "ar" ? "➕ إنشاء إجراء تنفيذي جديد" : "➕ Create New Executive Action", sub: "", onclick: `Panels.load('tasks').then(()=>Modals.addTask())` }],
          l === "ar" ? "إجراء سريع" : "Quick Action",
        );
      } else if (kind === "find_owner") {
        const tasks = await api("/api/tasks");
        const overdue = tasks.filter((t) => t.status === "overdue").slice(0, 5);
        this.appendCards(
          overdue.map((t) => ({
            title: l === "ar" ? t.text_ar : t.text_en || t.text_ar,
            sub: (l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar) || (l === "ar" ? "غير مُسند" : "Unassigned"),
            onclick: `Panels.load('tasks')`,
          })),
          l === "ar" ? "مسؤولو الإجراءات المتأخرة" : "Owners of Overdue Actions",
        );
      }
    } catch (e) {
      /* reference cards are a bonus on top of the text reply, never block it */
    }
  },
  appendCards(items, headerText) {
    if (!items || !items.length) return;
    const msgs = $("chat-msgs");
    const anchor = this._tailAnchor();
    const wrap = document.createElement("div");
    wrap.className = "msg";
    wrap.innerHTML = `<div class="mav"><img src="/logo.png" alt="Ameen"/></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">${esc(headerText)}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items
            .map(
              (it) => `<div class="card" style="padding:10px 12px;cursor:pointer" onclick="${it.onclick}">
            <div style="font-size:12.5px;font-weight:600;color:var(--text)">${esc(it.title || "")}</div>
            ${it.sub ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(it.sub)}</div>` : ""}
          </div>`,
            )
            .join("")}
        </div>
      </div>`;
    if (anchor && msgs.contains(anchor)) {
      msgs.insertBefore(wrap, anchor);
    } else {
      msgs.appendChild(wrap);
    }
    msgs.scrollTop = msgs.scrollHeight;
  },
  _tailAnchor() {
    // The favorites row / recent-searches row / suggested-chips row form one
    // persistent tail pinned at the bottom of the conversation — new
    // messages are inserted before all three, in DOM order, not just chips.
    return $("chat-favorite-prompts") || $("chat-recent-searches") || $("chat-chips");
  },
  append(text, isUser) {
    const msgs = $("chat-msgs");
    const anchor = this._tailAnchor();
    const d = document.createElement("div");
    d.className = "msg" + (isUser ? " user" : "");
    const name = App.user
      ? App.lang === "ar"
        ? App.user.name_ar
        : App.user.name_en
      : "";
    const initials =
      name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("") || "?";
    const av = isUser
      ? `<div class="mav">${esc(initials)}</div>`
      : `<div class="mav"><img src="/logo.png" alt="Ameen"/></div>`;
    const dir = detectTextDir(text);
    const favBtn = isUser
      ? `<button onclick="Chat.toggleFavorite(${esc(JSON.stringify(text))}, this)" style="background:none;border:none;cursor:pointer;font-size:12px;color:${FavoritePrompts.has(text) ? "var(--gold)" : "var(--text3)"};padding:0 4px;flex-shrink:0" title="${App.lang === "ar" ? "مفضّلة" : "Favorite"}" aria-label="${App.lang === "ar" ? "مفضّلة" : "Favorite prompt"}">${FavoritePrompts.has(text) ? "★" : "☆"}</button>`
      : "";
    d.innerHTML = `${av}<div style="flex:1;min-width:0"><div style="display:flex;align-items:flex-start;gap:4px"><div class="mb" dir="${dir}" style="flex:1">${mdToHtml(text)}</div>${favBtn}</div><div class="mts">${now()}</div></div>`;
    if (anchor && msgs.contains(anchor)) {
      msgs.insertBefore(d, anchor);
    } else {
      msgs.appendChild(d);
    }
    msgs.scrollTop = msgs.scrollHeight;
  },
  showTyping() {
    const msgs = $("chat-msgs");
    const d = document.createElement("div");
    d.className = "msg";
    d.id = "typ";
    d.innerHTML = `<div class="mav"><img src="/logo.png"/></div><div class="mb"><div class="tyd"><span></span><span></span><span></span></div></div>`;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  },
  showDemoNote() {
    // appendChild always lands at the very end of #chat-msgs, which also
    // hosts the persistent Recent Searches / quick-action chips block — so
    // every demo note piled up below that furniture, disconnected from the
    // reply it was actually about, instead of near it. One note, replaced
    // each time (same pattern DocGen.showDemoNote already uses), keeps a
    // single clear notice instead of a growing stack of identical banners.
    const old = document.getElementById("chat-demo-note");
    if (old) old.remove();
    const note = document.createElement("div");
    note.id = "chat-demo-note";
    note.style.cssText =
      "font-size:11px;color:var(--amber);padding:6px 10px;background:rgba(201,168,76,.1);border-radius:6px;margin:4px 0;text-align:center";
    note.textContent =
      App.lang === "ar"
        ? "⚠️ رد تجريبي — أضف مفتاح Anthropic API للردود الحقيقية"
        : "⚠️ Demo reply — Add Anthropic API key for real AI responses";
    $("chat-msgs").appendChild(note);
  },
};
function removeTyping() {
  var _typ = $("typ"); if (_typ) _typ.remove();
}
function buildWelcomeMsg() {
  const d = document.createElement("div");
  d.className = "msg";
  d.id = "welcome-msg";
  const txt =
    App.lang === "ar"
      ? "أنا أمين، مساعدكم التنفيذي الذكي. يمكنني تحليل الاجتماعات، متابعة المهام والقرارات، والإجابة على أي سؤال تنفيذي."
      : "I'm Ameen, your executive AI. I can analyse meetings, track tasks and decisions, and answer any executive question.";
  d.innerHTML = `<div class="mav"><img src="/logo.png" alt="Ameen"/></div><div><div class="mb">${esc(txt)}</div><div class="mts">${now()}</div></div>`;
  return d;
}

// ══ Structured Reports — real data pulled straight from GET /api/reports/:type/*,
// distinct from DocGen below (which drafts free text from an AI prompt). PDF
// and Excel downloads reuse the same fetch-then-blob pattern DocGen.downloadPDF
// already established, for the same reason: credentials:'include' cookies plus
// graceful error handling that a plain window.open() download link wouldn't give.
const StructuredReports = {
  async preview() {
    const l = App.lang;
    const type = $("structured-report-type").value;
    const box = $("structured-report-preview");
    box.innerHTML = `<div class="es" style="padding:16px"><div class="loading"></div></div>`;
    try {
      const data = await api(`/api/reports/${type}/data`);
      const cellText = (v) => (v && typeof v === "object" ? (l === "ar" ? v.ar || v.en : v.en || v.ar) : (v !== null && v !== undefined ? v : ""));
      const head = data.columns.map((c) => `<th style="text-align:${l === "ar" ? "right" : "left"};padding:6px 8px;font-size:11px;color:var(--text3);border-bottom:1px solid var(--border2)">${esc(l === "ar" ? c.ar : c.en)}</th>`).join("");
      const rows = data.rows.slice(0, 100).map((row) => `<tr>${data.columns.map((c) => `<td style="padding:6px 8px;font-size:12px;color:var(--text);border-bottom:1px solid var(--border3)">${esc(String(cellText(row[c.key])))}</td>`).join("")}</tr>`).join("");
      box.innerHTML = data.rows.length
        ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${data.rows.length > 100 ? `<div style="font-size:11px;color:var(--text3);margin-top:6px">${l === "ar" ? `+ ${data.rows.length - 100} صفوف إضافية في التصدير الكامل` : `+ ${data.rows.length - 100} more rows in the full export`}</div>` : ""}`
        : `<div class="es" style="padding:20px;font-size:12px">${l === "ar" ? "لا توجد بيانات لهذا التقرير" : "No data for this report"}</div>`;
    } catch (e) {
      box.innerHTML = `<div class="es" style="padding:16px;color:var(--red);font-size:12px">${esc(e.message)}</div>`;
    }
  },

  async download(format) {
    const l = App.lang;
    const type = $("structured-report-type").value;
    const label = $("structured-report-type").selectedOptions[0].text;
    try {
      const resp = await fetch(`/api/reports/${type}/${format}?lang=${l}`, { credentials: "include" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}.${format === "excel" ? "xlsx" : "pdf"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(l === "ar" ? `✓ تم تنزيل ${label}` : `✓ ${label} downloaded`);
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  print() {
    const box = $("structured-report-preview");
    if (!box || !box.innerHTML.trim()) { this.preview().then(() => this.print()); return; }
    const win = window.open("", "_blank");
    const title = $("structured-report-type").selectedOptions[0].text;
    win.document.write(`<html dir="${App.lang === "ar" ? "rtl" : "ltr"}"><head><title>${esc(title)}</title>
      <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #ccc;font-size:12px}h1{font-size:18px}</style>
      </head><body><h1>${esc(title)}</h1>${box.innerHTML}</body></html>`);
    win.document.close();
    win.onload = () => win.print();
  },
};

// ══ Document Generator ════════════════════════════════════════════════════════
const DocGen = {
  currentContent: "",
  async generate() {
    if (!App.requirePro()) return;
    const data = {
      doc_type: $("doc-type").value,
      meeting_id: $("doc-meeting-sel").value || null,
      details: $("doc-details").value,
      lang: $("doc-lang").value,
      detail_level: $("doc-detail").value,
    };
    const btn = $("doc-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === "ar" ? "أمين يُولّد..." : "Generating..."}`;
    $("doc-result").innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--text3)">${App.lang === "ar" ? "أمين يُنشئ الوثيقة..." : "Generating document..."}</div>`;
    const oldNote = $("doc-demo-note");
    if (oldNote) oldNote.remove();
    try {
      const r = await api("/api/ai/document", {
        method: "POST",
        body: JSON.stringify(data),
      });
      this.currentContent = r.content;
      $("doc-result").style.direction = data.lang === "en" ? "ltr" : "rtl";
      $("doc-result").style.textAlign = data.lang === "en" ? "left" : "right";
      $("doc-result").textContent = r.content;
      if (r.demo) this.showDemoNote();
      $("doc-toast").style.display = "flex";
      setTimeout(() => ($("doc-toast").style.display = "none"), 2500);
    } catch (e) {
      $("doc-result").innerHTML =
        `<div style="color:var(--red)">${e.message}</div>`;
    }
    btn.disabled = false;
    btn.innerHTML = `✦ <span>${App.lang === "ar" ? "توليد الوثيقة" : "Generate Document"}</span>`;
  },
  copy() {
    if (this.currentContent) {
      navigator.clipboard.writeText(this.currentContent);
      alert(App.lang === "ar" ? "✓ تم النسخ" : "✓ Copied");
    }
  },
  print() {
    window.print();
  },
  showDemoNote() {
    const old = document.getElementById("doc-demo-note");
    if (old) old.remove();
    const note = document.createElement("div");
    note.id = "doc-demo-note";
    note.style.cssText =
      "font-size:12px;color:var(--amber);padding:8px 12px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);border-radius:6px;margin:8px 0;text-align:center;font-weight:600";
    note.textContent =
      App.lang === "ar"
        ? "⚠️ وثيقة تجريبية — أضف مفتاح Anthropic API لتوليد وثائق حقيقية"
        : "⚠️ Demo document — Add an Anthropic API key to generate real documents";
    const result = $("doc-result");
    if (result && result.parentNode) result.parentNode.insertBefore(note, result);
  },
  async downloadPDF() {
    const l = App.lang;
    if (!this.currentContent) {
      alert(
        l === "ar"
          ? "لا توجد وثيقة لتنزيلها. ولّد وثيقة أولاً."
          : "No document to download. Generate one first.",
      );
      return;
    }
    const pdfBtn = document.querySelector('[onclick="DocGen.downloadPDF()"]');
    if (pdfBtn) {
      pdfBtn.disabled = true;
      pdfBtn.innerHTML = `⏳ ${l === "ar" ? "جارٍ التوليد..." : "Generating..."}`;
    }
    const typeSel = $("doc-type");
    const title =
      (typeSel && typeSel.options[typeSel.selectedIndex] && typeSel.options[typeSel.selectedIndex].text) ||
      (l === "ar" ? "وثيقة" : "Document");
    const lang = ($("doc-lang") && $("doc-lang").value) || l;
    try {
      const resp = await fetch("/api/reports/pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: this.currentContent, title, lang }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (title.replace(/[^\w\u0600-\u06FF\s]/g, "").trim() || "report") +
        ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(
        l === "ar" ? "✓ تم توليد وتنزيل PDF" : "✓ PDF generated and downloaded",
      );
    } catch (e) {
      alert(
        (l === "ar" ? "خطأ في توليد PDF: " : "PDF generation error: ") +
          e.message,
      );
    } finally {
      if (pdfBtn) {
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = `⬇ <span data-ar="تنزيل PDF" data-en="Download PDF">${l === "ar" ? "تنزيل PDF" : "Download PDF"}</span>`;
      }
    }
  },
  async shareWithTeam() {
    const l = App.lang;
    if (!this.currentContent) {
      alert(l === "ar" ? "لا توجد وثيقة للمشاركة" : "No document to share");
      return;
    }
    if (!App.requirePro()) return;
    const typeSel = $("doc-type");
    const title = typeSel.options[typeSel.selectedIndex].text;
    if (
      !confirm(
        l === "ar"
          ? "مشاركة هذا التقرير مع جميع أعضاء الفريق عبر البريد؟"
          : "Share this report with all team members by email?",
      )
    )
      return;
    try {
      const r = await api("/api/documents/share", {
        method: "POST",
        body: JSON.stringify({ content: this.currentContent, title }),
      });
      // The backend used to report every recipient as "shared" even when the
      // actual email send failed (e.g. no mail provider configured) — a
      // manager would see "Shared with 12 members" while zero emails went
      // out. It now reports real success/failure counts; reflect both here
      // instead of only ever showing the happy path.
      if (r.failed) {
        alert(
          l === "ar"
            ? `⚠ تمت المشاركة مع ${r.shared} عضو، وفشلت المشاركة مع ${r.failed} — تحقق من إعدادات البريد الإلكتروني`
            : `⚠ Shared with ${r.shared} member(s), but ${r.failed} failed — check your email provider settings`,
        );
      } else {
        alert(
          l === "ar"
            ? `✓ تمت المشاركة مع ${r.shared} عضو`
            : `✓ Shared with ${r.shared} member(s)`,
        );
      }
    } catch (e) {
      alert(
        (l === "ar" ? "تعذّرت المشاركة: " : "Could not share: ") + e.message,
      );
    }
  },
};

// ══ Print-window PDF helper ════════════════════════════════════════════════════
function _openPrintWindow(textContent, title, lang) {
  const isAr = lang !== "en";
  const dir = isAr ? "rtl" : "ltr";
  const align = isAr ? "right" : "left";
  const date = new Date().toLocaleDateString(isAr ? "ar-SA" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const safeTitle = String(title || "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeContent = String(textContent || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html lang="${lang || "ar"}" dir="${dir}">
<head><meta charset="UTF-8"><title>${safeTitle}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'IBM Plex Sans Arabic','IBM Plex Sans',Arial,sans-serif;font-size:11pt;line-height:1.85;color:#1a1a2e;direction:${dir};text-align:${align};background:#fff}
.page{padding:50px 60px;max-width:800px;margin:0 auto}
.header{border-bottom:2.5px solid #1a1a2e;padding-bottom:16px;margin-bottom:28px}
.org{font-size:9pt;color:#666;margin-bottom:6px;font-style:italic}
h1{font-size:18pt;font-weight:700;margin-bottom:4px}
.doc-date{font-size:9.5pt;color:#888}
.content{white-space:pre-wrap;font-size:11pt;line-height:1.9;color:#222}
.section-title{font-size:13pt;font-weight:700;color:#1a1a2e;margin:24px 0 8px;padding-bottom:5px;border-bottom:1px solid #ddd}
.task-row,.dec-row{display:flex;gap:8px;padding:5px 0;border-bottom:.5px solid #eee;font-size:10.5pt;color:#333}
.task-num{color:#888;flex-shrink:0;width:20px}
.owner-tag{font-size:9pt;color:#777;margin-inline-start:6px}
.footer{margin-top:36px;padding-top:12px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:8.5pt;color:#aaa}
@media print{body{margin:0}.page{padding:12mm 18mm;max-width:none}@page{size:A4;margin:12mm 18mm}}
</style></head>
<body><div class="page">
<div class="header">
  <div class="org">أمين للاجتماعات التنفيذية · Ameen Executive Secretary</div>
  <h1>${safeTitle}</h1>
  <div class="doc-date">${date}</div>
</div>
<div class="content">${safeContent}</div>
<div class="footer"><span>Ameen · أمين</span><span>${date}</span></div>
</div>
<script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print();},800));</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    alert(
      App.lang === "ar"
        ? "يُرجى السماح بالنوافذ المنبثقة لهذا الموقع لتتمكن من تنزيل PDF"
        : "Please allow pop-ups for this site to download the PDF",
    );
    return;
  }
  w.document.write(html);
  w.document.close();
}

function _openBoardPackWindow(data, lang) {
  const isAr = lang !== "en";
  const dir = isAr ? "rtl" : "ltr";
  const align = isAr ? "right" : "left";
  const title = isAr
    ? data.title_ar || ""
    : data.title_en || data.title_ar || "";
  const date = data.date || "";
  const displayDate = date
    ? new Date(date + "T00:00:00").toLocaleDateString(
        isAr ? "ar-SA" : "en-GB",
        { year: "numeric", month: "long", day: "numeric" },
      )
    : new Date().toLocaleDateString(isAr ? "ar-SA" : "en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  const esc2 = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const summary = isAr
    ? data.summary_ar || ""
    : data.summary_en || data.summary_ar || "";
  const minutes = isAr
    ? data.minutes_ar || ""
    : data.minutes_en || data.minutes_ar || "";
  const tasks = data.tasks || [];
  const decisions = data.decisions || [];
  const risks = data.risks || [];
  const documents = data.documents || [];

  const sectTitle = (ar, en) =>
    `<div class="section-title">${esc2(isAr ? ar : en)}</div>`;

  let sections = "";

  if (summary) {
    sections += sectTitle("ملخص تنفيذي", "Executive Summary");
    sections += `<div class="content" style="margin-bottom:14px">${esc2(summary)}</div>`;
  }

  if (minutes) {
    sections += sectTitle("محضر الاجتماع", "Meeting Minutes");
    sections += `<div class="content" style="margin-bottom:14px">${esc2(minutes)}</div>`;
  }

  if (decisions.length) {
    sections += sectTitle("سجل القرارات", "Decision Log");
    sections += `<div style="margin-bottom:14px">${decisions
      .map(
        (d, i) =>
          `<div class="dec-row"><span class="task-num">${i + 1}.</span><span>${esc2(isAr ? d.text_ar || d.decision_ar || "" : d.text_en || d.decision_en || d.text_ar || d.decision_ar || "")}</span></div>`,
      )
      .join("")}</div>`;
  }

  if (tasks.length) {
    sections += sectTitle("خطة العمل والمهام", "Action Plan & Tasks");
    sections += `<div style="margin-bottom:14px">${tasks
      .map(
        (t, i) =>
          `<div class="task-row"><span class="task-num">${i + 1}.</span><span style="flex:1">${esc2(isAr ? t.text_ar || "" : t.text_en || t.text_ar || "")}</span>${t.owner_ar || t.owner_en ? `<span class="owner-tag">${esc2(isAr ? t.owner_ar || "" : t.owner_en || t.owner_ar || "")}</span>` : ""}</div>`,
      )
      .join("")}</div>`;
  }

  if (risks.length) {
    sections += sectTitle("المخاطر والملاحظات", "Risks & Notes");
    sections += `<div style="margin-bottom:14px">${risks
      .map(
        (r, i) =>
          `<div class="task-row"><span class="task-num">${r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟡" : "🟢"}</span><span>${esc2(isAr ? r.text_ar || "" : r.text_en || r.text_ar || "")}</span></div>`,
      )
      .join("")}</div>`;
  }

  if (documents.length) {
    sections += sectTitle(
      "ملخص الوثائق المرفقة",
      "Attached Document Summaries",
    );
    sections += `<div style="margin-bottom:14px">${documents
      .map(
        (d) =>
          `<div style="padding:8px 0;border-bottom:.5px solid #eee"><div style="font-weight:600;font-size:10.5pt">${esc2(d.title)}${d.doc_classification ? ` <span style="font-size:9pt;color:#888">[${esc2(d.doc_classification)}]</span>` : ""}</div>${d.ai_summary ? `<div style="font-size:10pt;color:#444;margin-top:3px">${esc2(d.ai_summary)}</div>` : ""}</div>`,
      )
      .join("")}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="${lang || "ar"}" dir="${dir}">
<head><meta charset="UTF-8"><title>${esc2(isAr ? "حزمة مجلس الإدارة" : "Board Pack")} — ${esc2(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'IBM Plex Sans Arabic','IBM Plex Sans',Arial,sans-serif;font-size:11pt;line-height:1.85;color:#1a1a2e;direction:${dir};text-align:${align};background:#fff}
.page{padding:50px 60px;max-width:800px;margin:0 auto}
.header{border-bottom:2.5px solid #1a1a2e;padding-bottom:16px;margin-bottom:28px}
.badge{display:inline-block;background:#1a1a2e;color:#fff;font-size:8.5pt;padding:2px 9px;border-radius:4px;margin-bottom:8px}
.org{font-size:9pt;color:#666;margin-bottom:6px;font-style:italic}
h1{font-size:18pt;font-weight:700;margin-bottom:4px}
.doc-date{font-size:9.5pt;color:#888}
.content{white-space:pre-wrap;font-size:11pt;line-height:1.9;color:#222}
.section-title{font-size:13pt;font-weight:700;color:#1a1a2e;margin:24px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #ddd}
.task-row,.dec-row{display:flex;gap:8px;padding:5px 0;border-bottom:.5px solid #eee;font-size:10.5pt;color:#333}
.task-num{color:#888;flex-shrink:0;width:20px}
.owner-tag{font-size:9pt;color:#777;margin-inline-start:6px}
.footer{margin-top:36px;padding-top:12px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:8.5pt;color:#aaa}
@media print{body{margin:0}.page{padding:12mm 18mm;max-width:none}@page{size:A4;margin:12mm 18mm}}
</style></head>
<body><div class="page">
<div class="header">
  <div class="badge">${esc2(isAr ? "حزمة مجلس الإدارة" : "Board Pack")}</div>
  <div class="org">أمين للاجتماعات التنفيذية · Ameen Executive Secretary</div>
  <h1>${esc2(title)}</h1>
  <div class="doc-date">${displayDate}</div>
</div>
${sections}
<div class="footer"><span>Ameen · أمين</span><span>${displayDate}</span></div>
</div>
<script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print();},800));</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    alert(
      App.lang === "ar"
        ? "يُرجى السماح بالنوافذ المنبثقة لهذا الموقع لتتمكن من تنزيل PDF"
        : "Please allow pop-ups for this site to download the PDF",
    );
    return;
  }
  w.document.write(html);
  w.document.close();
}

// ══ Board Pack ═════════════════════════════════════════════════════════════════
// ── Recent Reports — client-side log of Board Pack downloads (no backend
// "reports" table exists to query, so this tracks what this browser has
// actually generated, most-recent first).
const RecentReports = {
  key: "ameen_recent_reports",
  log(meetingId, title) {
    let list = this.list();
    list = list.filter((r) => r.meetingId !== meetingId);
    list.unshift({ meetingId, title, ts: new Date().toISOString() });
    try {
      localStorage.setItem(this.key, JSON.stringify(list.slice(0, 10)));
    } catch (e) {}
  },
  list() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || "[]");
    } catch (e) {
      return [];
    }
  },
};

const MinutesDownload = {
  async download(meetingId, lang) {
    const l = lang || App.lang;
    const btnId = `min-dl-btn-${meetingId}`;
    const btn = document.getElementById(btnId);
    if (btn) { btn.disabled = true; btn.innerHTML = `⏳ ${l === "ar" ? "جارٍ التوليد..." : "Generating PDF..."}`; }
    try {
      const resp = await fetch(`/api/meetings/${meetingId}/minutes/download?lang=${l}`, {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (err.error === "NO_MINUTES") {
          showToast(l === "ar" ? "⚠️ لا يوجد محتوى للمحضر بعد" : "⚠️ No minutes content yet");
          return;
        }
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `minutes-${meetingId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(l === "ar" ? "✓ تم تنزيل المحضر PDF" : "✓ Minutes PDF downloaded");
    } catch (e) {
      showToast((l === "ar" ? "خطأ: " : "Error: ") + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = `📥 ${l === "ar" ? "تنزيل المحضر PDF" : "Download Minutes PDF"}`; }
    }
  },
};

const BoardPack = {
  async download(meetingId) {
    const l = App.lang;
    const btn = $(`bp-btn-${meetingId}`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `⏳ ${l === "ar" ? "جارٍ التوليد..." : "Generating PDF..."}`;
    }
    try {
      const resp = await fetch(`/api/meetings/${meetingId}/board-pack`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const errCode = err.error || "";
        if (errCode === "NOT_PROCESSED" || errCode === "PROCESSING") {
          alert(
            l === "ar"
              ? "يجب معالجة الاجتماع بالذكاء الاصطناعي أولاً قبل توليد حزمة المجلس."
              : "The meeting must be AI-processed before generating a board pack.",
          );
          return;
        }
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `board-pack-${meetingId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(
        l === "ar"
          ? "✓ تم توليد حزمة المجلس PDF"
          : "✓ Board pack PDF downloaded",
      );
      const cachedMeeting =
        (App.meetingsCache || []).find((x) => x.id === meetingId) ||
        (MeetingHistory._full && MeetingHistory._full.meeting.id === meetingId ? MeetingHistory._full.meeting : null);
      const reportTitle = cachedMeeting
        ? l === "ar"
          ? cachedMeeting.title_ar
          : cachedMeeting.title_en || cachedMeeting.title_ar
        : (l === "ar" ? "اجتماع #" : "Meeting #") + meetingId;
      RecentReports.log(meetingId, reportTitle);
    } catch (e) {
      alert((l === "ar" ? "خطأ: " : "Error: ") + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `📦 ${l === "ar" ? "حزمة المجلس" : "Board Pack"}`;
      }
    }
  },
};

// ══ Schedule ══════════════════════════════════════════════════════════════════
const Schedule = {
  _submitting: false,
  _dirty: false,
  _editingId: null,
  _dirtyBound: false,

  _setSubmitting(on, isDraft) {
    this._submitting = on;
    const l = App.lang;
    const scheduleLabel = this._editingId
      ? (l === "ar" ? "حفظ التعديلات" : "Save Changes")
      : (l === "ar" ? "جدولة الاجتماع" : "Schedule Meeting");
    const schedLoading = l === "ar" ? "جارٍ الجدولة..." : "Scheduling...";
    const draftLoading = l === "ar" ? "جارٍ الحفظ..." : "Saving draft...";
    const draftLabel  = l === "ar" ? "حفظ كمسودة" : "Save as Draft";

    ["nm-submit-btn", "nm-bottom-submit"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = on;
      const lbl = btn.querySelector("span[id]") || btn.querySelector("span");
      if (lbl) lbl.textContent = on ? (isDraft ? draftLoading : schedLoading) : scheduleLabel;
    });
    const draftBtn = $("nm-bottom-draft");
    if (draftBtn) {
      draftBtn.disabled = on;
      draftBtn.textContent = on && isDraft ? draftLoading : draftLabel;
    }
  },

  bottomCancel() {
    if (this._dirty) {
      const l = App.lang;
      const msg = l === "ar"
        ? "لديك تغييرات غير محفوظة. هل تريد المغادرة؟"
        : "You have unsaved changes. Are you sure you want to leave?";
      if (!confirm(msg)) return;
    }
    this._dirty = false;
    if (this._editingId) {
      this.cancelEdit();
    } else {
      this._resetForm();
      Panels.load("scheduled");
    }
  },

  _initDirtyTracking() {
    if (this._dirtyBound) return;
    const card = $("nm-form-card");
    if (!card) return;
    const mark = () => { if (!this._submitting) this._dirty = true; };
    card.addEventListener("input", mark);
    card.addEventListener("change", mark);
    this._dirtyBound = true;
  },

  _populateBoardSelects() {
    const l = App.lang;
    const boards = App._boards || [];
    const sel = $("nm-board");
    if (!sel) return;
    sel.innerHTML =
      `<option value="">— ${l === "ar" ? "بدون مجلس" : "No board"} —</option>` +
      boards
        .map(
          (b) =>
            `<option value="${b.id}">${esc(l === "ar" ? b.name_ar : b.name_en || b.name_ar)}</option>`,
        )
        .join("");
    this.onBoardChange();
    this._populatePrevMeetings();
    SeriesUI.init('nm');
    this._initDirtyTracking();
  },
  async _populatePrevMeetings() {
    const sel = $("nm-prev");
    if (!sel) return;
    const l = App.lang;
    try {
      const meetings = await api("/api/meetings");
      sel.innerHTML =
        `<option value="">— ${l === "ar" ? "لا يوجد (اجتماع جديد)" : "None (new meeting)"} —</option>` +
        meetings
          .map((m) => {
            const title = l === "ar" ? m.title_ar : m.title_en || m.title_ar;
            const date = (m.meeting_date || "").substring(0, 10);
            return `<option value="${m.id}">${esc(title)}${date ? " · " + date : ""}</option>`;
          })
          .join("");
    } catch {}
  },
  onBoardChange() {
    const boardId = parseInt($("nm-board") && $("nm-board").value) || 0;
    const l = App.lang;
    const all = App._committees || [];
    const committees = boardId
      ? all.filter((c) => c.board_id === boardId)
      : all;
    const csel = $("nm-committee");
    if (!csel) return;
    csel.innerHTML =
      `<option value="">— ${l === "ar" ? "بدون لجنة" : "No committee"} —</option>` +
      committees
        .map(
          (c) =>
            `<option value="${c.id}">${esc(l === "ar" ? c.name_ar : c.name_en || c.name_ar)}</option>`,
        )
        .join("");
  },
  onProviderChange() {
    const v = ($("nm-plat") && $("nm-plat").value) || "physical";
    const isVirtual = v !== "physical";
    const isHybrid = v === "hybrid";
    const row = $("nm-join-row");
    if (row) row.style.display = isVirtual ? "" : "none";
    const locRow = $("nm-location-row");
    if (locRow) locRow.style.display = (v === "physical" || isHybrid) ? "" : "none";
    const note = $("nm-provider-note");
    if (note) note.style.display = (isVirtual && !isHybrid) ? "" : "none";
    const inp = $("nm-join-url");
    if (inp) {
      inp.placeholder = v === "zoom" ? "https://zoom.us/j/..." : v === "teams" ? "https://teams.microsoft.com/l/meetup-join/..." : v === "google_meet" ? "https://meet.google.com/..." : v === "hybrid" ? "https://zoom.us/j/... (رابط المشاركة عن بُعد)" : "";
    }
  },
  // ── Guided wizard (create-flow only — edit mode uses .wiz-flat to show
  // every step at once, see _setFormMode). Pure presentation: every field
  // keeps its existing id, so add()/edit()/_resetForm() above are untouched.
  _wizStep: 1,
  wizGoTo(step) {
    this._wizStep = step;
    for (let i = 1; i <= 4; i++) {
      const panel = $(`nm-wiz-panel-${i}`);
      if (panel) panel.classList.toggle("active", i === step);
      const dot = $(`nm-wiz-dot-${i}`);
      if (dot) dot.classList.toggle("active", i === step);
      if (dot) dot.classList.toggle("done", i < step);
      const conn = $(`nm-wiz-conn-${i}`);
      if (conn) conn.classList.toggle("done", i < step);
    }
    if (step === 4) this._renderWizReview();
    const card = $("nm-form-card");
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  _renderWizReview() {
    const box = $("nm-wiz-review");
    if (!box) return;
    const l = App.lang;
    const selText = (id) => {
      const el = $(id);
      return el && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text.trim() : "";
    };
    const val = (id) => (($(id) && $(id).value) || "").trim();
    const empty = l === "ar" ? "— لم يُحدَّد —" : "— not set —";
    const row = (labelAr, labelEn, v) => `
      <div class="wiz-review-row">
        <span class="wiz-rl">${l === "ar" ? labelAr : labelEn}</span>
        <span class="wiz-rv">${v ? esc(v) : `<span class="wiz-empty-hint">${empty}</span>`}</span>
      </div>`;
    const group = (titleAr, titleEn, rowsHtml) => `
      <div class="wiz-review-group">
        <div class="wiz-review-group-title">${l === "ar" ? titleAr : titleEn}</div>
        ${rowsHtml}
      </div>`;

    const nmSeriesBtn = $("nm-series-seg") && $("nm-series-seg").querySelector(".imp-seg-btn.active");
    const seriesMode = (nmSeriesBtn && nmSeriesBtn.dataset.val) || "standalone";
    const seriesLabel = seriesMode === "new"
      ? (l === "ar" ? "سلسلة جديدة: " : "New series: ") + (val("nm-series-name-ar") || val("nm-series-name-en") || empty)
      : seriesMode === "continue"
      ? (l === "ar" ? "متابعة: " : "Continuing: ") + (selText("nm-series-existing") || empty)
      : l === "ar" ? "اجتماع مستقل" : "Standalone meeting";

    box.innerHTML =
      group(
        "التفاصيل", "Details",
        row("العنوان", "Title", val("nm-title")) +
        row("النوع", "Type", selText("nm-type")) +
        row("التاريخ والوقت", "Date & time", [val("nm-date"), val("nm-time")].filter(Boolean).join(" · ")) +
        row("المدة", "Duration", val("nm-dur") ? `${val("nm-dur")} ${l === "ar" ? "دقيقة" : "min"}` : "") +
        row("المنصة / النوع", "Format", selText("nm-plat")) +
        row("الموقع الفعلي", "Location", val("nm-location")) +
        row("رابط الانضمام", "Join URL", val("nm-join-url"))
      ) +
      group(
        "المشاركون", "Participants",
        row("المشاركون", "Attendees", val("nm-att")) +
        row("المجلس", "Board", selText("nm-board")) +
        row("اللجنة", "Committee", selText("nm-committee")) +
        row("قناة التذكير", "Reminder", selText("nm-channel"))
      ) +
      group(
        "جدول الأعمال والسلسلة", "Agenda & series",
        row("العلاقة", "Relationship", seriesLabel) +
        row("جدول الأعمال", "Agenda", val("nm-agenda-ar") || val("nm-agenda-en"))
      );
  },
  _resetForm() {
    ["nm-title", "nm-att", "nm-agenda-ar", "nm-agenda-en"].forEach(
      (id) => ($(id).value = ""),
    );
    if ($("nm-type")) $("nm-type").value = "";
    if ($("nm-board")) { $("nm-board").value = ""; Schedule.onBoardChange(); }
    if ($("nm-committee")) $("nm-committee").value = "";
    if ($("nm-prev")) $("nm-prev").value = "";
    if ($("nm-recurrence")) $("nm-recurrence").value = "none";
    if ($("nm-template")) $("nm-template").value = "";
    if ($("nm-join-url")) $("nm-join-url").value = "";
    if ($("nm-location")) $("nm-location").value = "";
    if ($("nm-channel")) $("nm-channel").value = "email";
    if ($("nm-dur")) $("nm-dur").value = "60";
    if ($("nm-plat")) { $("nm-plat").value = "physical"; Schedule.onProviderChange(); }
    SeriesUI.invalidate();
    SeriesUI.setMode("nm", "standalone");
    SeriesUI.init("nm");
    this._dirty = false;
    this.wizGoTo(1);
  },
  // Toggles the "Schedule New Meeting" form between create mode (guided
  // wizard, one step at a time) and edit mode (every field visible at once,
  // via .wiz-flat — see the wizard CSS) — same pattern as Modals._editingId
  // for tasks/series, just extended to also switch the step layout.
  _setFormMode(editing) {
    const l = App.lang;
    const titleEl = $("nm-form-title");
    if (titleEl) titleEl.textContent = editing
      ? (l === "ar" ? "تعديل الاجتماع" : "Edit Meeting")
      : (l === "ar" ? "جدولة اجتماع جديد" : "Schedule New Meeting");
    const schedLabel = editing
      ? (l === "ar" ? "حفظ التعديلات" : "Save Changes")
      : (l === "ar" ? "جدولة" : "Schedule");
    const labelEl = $("nm-submit-label");
    if (labelEl) labelEl.textContent = schedLabel;
    const bottomLabel = $("nm-bottom-label");
    if (bottomLabel) bottomLabel.textContent = editing
      ? (l === "ar" ? "حفظ التعديلات" : "Save Changes")
      : (l === "ar" ? "جدولة الاجتماع" : "Schedule Meeting");
    const cancelBtn = $("nm-cancel-btn");
    if (cancelBtn) cancelBtn.style.display = editing ? "" : "none";
    const tplBtn = $("nm-template-save-btn");
    if (tplBtn) tplBtn.style.display = editing ? "none" : "";
    const card = $("nm-form-card");
    if (card) card.classList.toggle("wiz-flat", editing);
  },
  cancelEdit() {
    this._dirty = false;
    this._editingId = null;
    this._resetForm();
    this._setFormMode(false);
  },
  async edit(id) {
    const l = App.lang;
    try {
      const items = await api("/api/schedule");
      const s = items.find((x) => x.id === id);
      if (!s) return;
      this._editingId = id;
      if ($("nm-title")) $("nm-title").value = s.title_ar || s.title_en || "";
      if ($("nm-type")) $("nm-type").value = s.meeting_type || "";
      if ($("nm-recurrence")) $("nm-recurrence").value = "none";
      if ($("nm-date")) $("nm-date").value = (s.meeting_date || "").substring(0, 10);
      if ($("nm-time")) $("nm-time").value = (s.meeting_time || "").substring(0, 5);
      if ($("nm-dur")) $("nm-dur").value = s.duration_mins || 60;
      if ($("nm-plat")) { $("nm-plat").value = s.meeting_provider || "physical"; Schedule.onProviderChange(); }
      if ($("nm-join-url")) $("nm-join-url").value = s.meeting_join_url || "";
      if ($("nm-location")) $("nm-location").value = s.meeting_location || "";
      if ($("nm-att")) $("nm-att").value = s.attendees || "";
      if ($("nm-board")) { $("nm-board").value = s.board_id || ""; Schedule.onBoardChange(); }
      if ($("nm-committee")) $("nm-committee").value = s.committee_id || "";
      if ($("nm-channel")) $("nm-channel").value = s.reminder_channel || "email";
      if ($("nm-agenda-ar")) $("nm-agenda-ar").value = s.agenda_ar || "";
      if ($("nm-agenda-en")) $("nm-agenda-en").value = s.agenda_en || "";
      SeriesUI.setMode("nm", "standalone");
      this._setFormMode(true);
      const card = $("nm-form-title");
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      alert((l === "ar" ? "تعذّر تحميل الاجتماع: " : "Could not load meeting: ") + e.message);
    }
  },
  async add(isDraft = false) {
    if (this._submitting) return;
    const editingId = this._editingId;
    const l = App.lang;

    const titleEl  = $("nm-title");
    const dateEl   = $("nm-date");
    const timeEl   = $("nm-time");
    const title    = titleEl ? titleEl.value.trim() : "";
    const dateVal  = dateEl  ? dateEl.value  : "";
    const timeVal  = timeEl  ? timeEl.value  : "";
    const isFlat   = ($("nm-form-card") || {}).classList && $("nm-form-card").classList.contains("wiz-flat");

    // ── Validate required fields ────────────────────────────────
    const highlightField = (el, step) => {
      if (!el) return;
      el.classList.add("fi-error");
      setTimeout(() => el.classList.remove("fi-error"), 2500);
      if (!isFlat && step) this.wizGoTo(step);
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), isFlat ? 0 : 350);
      el.focus();
    };
    if (!title) {
      highlightField(titleEl, 1);
      showToast(l === "ar" ? "يرجى إدخال عنوان الاجتماع" : "Please enter a meeting title", "error");
      return;
    }
    if (!isDraft && !dateVal) {
      highlightField(dateEl, 1);
      showToast(l === "ar" ? "يرجى تحديد تاريخ الاجتماع" : "Please select a meeting date", "error");
      return;
    }
    if (!isDraft && !timeVal) {
      highlightField(timeEl, 1);
      showToast(l === "ar" ? "يرجى تحديد وقت الاجتماع" : "Please select a meeting time", "error");
      return;
    }

    const data = {
      title_ar: title,
      title_en: title,
      meeting_date: dateVal,
      meeting_time: timeVal,
      duration_mins: $("nm-dur") ? $("nm-dur").value : 60,
      meeting_provider: $("nm-plat") ? $("nm-plat").value : "physical",
      meeting_join_url: ($("nm-join-url") && $("nm-join-url").value.trim()) || "",
      meeting_location: ($("nm-location") && $("nm-location").value.trim()) || "",
      platform: { zoom: "Zoom", teams: "Microsoft Teams", google_meet: "Google Meet", hybrid: "Hybrid", virtual: "Virtual" }[($("nm-plat") || {}).value] || "قاعة اجتماعات",
      attendees: ($("nm-att") && $("nm-att").value) || "",
      agenda_ar: ($("nm-agenda-ar") && $("nm-agenda-ar").value) || "",
      agenda_en: ($("nm-agenda-en") && $("nm-agenda-en").value) || "",
      reminder_channel: ($("nm-channel") && $("nm-channel").value) || "email",
      meeting_type: ($("nm-type") && $("nm-type").value) || "",
      board_id: parseInt($("nm-board") && $("nm-board").value) || null,
      committee_id: parseInt($("nm-committee") && $("nm-committee").value) || null,
      prev_meeting_id: parseInt($("nm-prev") && $("nm-prev").value) || null,
      recurrence: ($("nm-recurrence") && $("nm-recurrence").value) || "none",
      draft: isDraft,
      ...SeriesUI.resolvePayload("nm"),
    };

    this._setSubmitting(true, isDraft);
    try {
      await this._submit(data, editingId, data.recurrence, false, isDraft);
    } finally {
      this._setSubmitting(false, isDraft);
    }
  },
  // Split out of add() so a 409 double-booking response can re-submit with
  // force:true after the user confirms — Schedule.confirm() already had this
  // "overlap a confirmed meeting, confirm anyway?" flow; create/edit went
  // through the generic api() helper instead, which can't see the 409's
  // conflicts list, so both silently had no double-booking protection from
  // the user's point of view (create showed a bare "CONFLICT" string with no
  // way to proceed; edit had no conflict check at all until now).
  async _submit(data, editingId, rec, force, isDraft = false) {
    const l = App.lang;
    try {
      const url = editingId ? `/api/schedule/${editingId}` : "/api/schedule";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { ...data, force: true } : data),
      });
      const resData = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const list = (resData.conflicts || [])
          .map((c) => `• ${l === "ar" ? c.title_ar : c.title_en || c.title_ar} — ${(c.meeting_date || "").substring(0, 10)} ${c.meeting_time || ""}`)
          .join("\n");
        const msg =
          l === "ar"
            ? "يتعارض هذا الموعد مع اجتماع مؤكَّد:\n\n" + list + "\n\nهل تريد الحفظ رغم التعارض؟"
            : "This time overlaps a confirmed meeting:\n\n" + list + "\n\nSave anyway?";
        if (confirm(msg)) return this._submit(data, editingId, rec, true, isDraft);
        return;
      }
      if (!res.ok) throw new Error(resData.message || resData.error || `HTTP ${res.status}`);
      this._dirty = false;
      if (editingId) {
        this._editingId = null;
        this._setFormMode(false);
        showToast(l === "ar" ? "✓ تم حفظ التعديلات" : "✓ Changes saved");
      } else if (isDraft) {
        showToast(l === "ar" ? "✓ تم الحفظ كمسودة" : "✓ Saved as draft");
      } else {
        $("sched-toast").style.display = "flex";
        setTimeout(() => ($("sched-toast").style.display = "none"), 2500);
      }
      await renderSchedule();
      await loadBadges();
      this._resetForm();
      if (!editingId && !isDraft && rec !== "none")
        showToast(
          l === "ar"
            ? `✓ تم جدولة الاجتماع + 3 تكرارات (${recurrenceLabel(rec, l)})`
            : `✓ Meeting + 3 recurrences scheduled (${recurrenceLabel(rec, l)})`,
        );
    } catch (e) {
      alert(e.message);
    }
  },

  async applyTemplate(id) {
    if (!id) return;
    const l = App.lang;
    try {
      const tpl = await api(`/api/schedule/from-template/${id}`);
      if ($("nm-title"))
        $("nm-title").value =
          l === "ar" ? tpl.title_ar : tpl.title_en || tpl.title_ar;
      if ($("nm-type")) $("nm-type").value = tpl.meeting_type || "";
      if ($("nm-agenda-ar")) $("nm-agenda-ar").value = tpl.agenda_ar || "";
      if ($("nm-agenda-en")) $("nm-agenda-en").value = tpl.agenda_en || "";
      if ($("nm-dur")) $("nm-dur").value = tpl.duration_mins || 60;
      if ($("nm-att")) $("nm-att").value = tpl.attendees || "";
      showToast(l === "ar" ? "✓ تم تطبيق القالب" : "✓ Template applied");
    } catch (e) {
      showToast(
        (l === "ar" ? "تعذّر تحميل القالب: " : "Could not load template: ") +
          e.message,
        "error",
      );
    }
  },

  async saveAsTemplate() {
    const l = App.lang;
    const title = ($("nm-title") && $("nm-title").value.trim()) || "";
    if (!title) {
      alert(
        l === "ar"
          ? "أدخل عنوان الاجتماع أولاً"
          : "Enter a meeting title first",
      );
      return;
    }
    const name = prompt(l === "ar" ? "اسم القالب:" : "Template name:", title);
    if (!name || !name.trim()) return;
    try {
      await api("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          name_ar: name.trim(),
          name_en: name.trim(),
          meeting_type: ($("nm-type") && $("nm-type").value) || "",
          agenda_ar: ($("nm-agenda-ar") && $("nm-agenda-ar").value) || "",
          agenda_en: ($("nm-agenda-en") && $("nm-agenda-en").value) || "",
          default_duration: parseInt($("nm-dur") && $("nm-dur").value) || 60,
          default_attendees: ($("nm-att") && $("nm-att").value) || "",
        }),
      });
      showToast(l === "ar" ? "✓ تم حفظ القالب" : "✓ Template saved");
      await renderTemplates();
    } catch (e) {
      alert(e.message);
    }
  },

  async deleteSeries(id) {
    const l = App.lang;
    if (
      !confirm(
        l === "ar"
          ? "حذف هذا الاجتماع وجميع التكرارات القادمة؟"
          : "Delete this meeting and all future occurrences?",
      )
    )
      return;
    try {
      await api(`/api/schedule/${id}/series`, { method: "DELETE" });
      await renderSchedule();
      await loadBadges();
      showToast(
        l === "ar" ? "تم حذف سلسلة التكرار" : "Recurring series deleted",
      );
    } catch (e) {
      alert(e.message);
    }
  },

  async confirm(id, force) {
    const l = App.lang;
    try {
      const res = await fetch("/api/schedule/" + id + "/confirm", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: !!force }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Conflict: surface the overlapping confirmed meeting(s) and let the
        // coordinator force it through if they really want a double-booking.
        const list = (data.conflicts || [])
          .map(
            (c) =>
              `• ${l === "ar" ? c.title_ar : c.title_en || c.title_ar} — ${(c.meeting_date || "").substring(0, 10)} ${c.meeting_time || ""}`,
          )
          .join("\n");
        const msg =
          l === "ar"
            ? "يتعارض هذا الموعد مع اجتماع مؤكَّد:\n\n" +
              list +
              "\n\nهل تريد التأكيد رغم التعارض؟"
            : "This time overlaps a confirmed meeting:\n\n" +
              list +
              "\n\nConfirm anyway?";
        if (confirm(msg)) return this.confirm(id, true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Error");
      await renderSchedule();
      await loadBadges();
    } catch (e) {
      alert(
        (l === "ar" ? "تعذّر التأكيد: " : "Could not confirm: ") + e.message,
      );
    }
  },

  async delete(id) {
    if (
      !confirm(
        App.lang === "ar"
          ? "حذف هذا الاجتماع من الجدول؟"
          : "Remove from schedule?",
      )
    )
      return;
    try {
      await api(`/api/schedule/${id}`, { method: "DELETE" });
    } catch (e) {
      showToast(
        (App.lang === "ar" ? "تعذّر الحذف: " : "Could not delete: ") +
          e.message,
        "error",
      );
      return;
    }
    await renderSchedule();
    await loadBadges();
  },
  // Look the meeting up from the cached schedule by id, so we never inject
  // Arabic titles (which contain quotes) into an HTML onclick attribute — that
  // was breaking the markup and throwing "Unexpected end of input".
  openReminder(id) {
    const l = App.lang;
    const s = (App.scheduleCache || []).find((x) => x.id === id);
    if (!s) return;
    const channel = s.reminder_channel || "email";
    const titleAr = s.title_ar,
      titleEn = s.title_en;
    const date = (s.meeting_date || "").substring(0, 10);
    const time = (s.meeting_time || "").substring(0, 5);
    const platform = s.platform || "";
    const attendees = s.attendees || "";
    const agendaAr = s.agenda_ar || "",
      agendaEn = s.agenda_en || "";
    const title = l === "ar" ? titleAr : titleEn || titleAr;
    const agenda = l === "ar" ? agendaAr || agendaEn : agendaEn || agendaAr;
    const dt =
      date && time
        ? `${date} ${l === "ar" ? "الساعة" : "at"} ${time}`
        : date || "";
    const subj =
      l === "ar" ? `تذكير: ${title} — ${dt}` : `Reminder: ${title} — ${dt}`;
    const body =
      l === "ar"
        ? `السلام عليكم ورحمة الله وبركاته،\n\nيسعدنا تذكيركم بموعد اجتماع:\n\n📌 ${title}\n📅 ${dt}\n📍 ${platform || ""}\n\n${agenda ? `جدول الأعمال:\n${agenda}\n\n` : ""}نرجو حضوركم في الموعد المحدد.\n\nمع التحية،\nفريق أمين للذكاء الاصطناعي`
        : `Dear Team,\n\nThis is a reminder for the upcoming meeting:\n\n📌 ${title}\n📅 ${dt}\n📍 ${platform || ""}\n\n${agenda ? `Agenda:\n${agenda}\n\n` : ""}Please attend at the scheduled time.\n\nBest regards,\nAmeen AI Team`;
    if (channel === "email") {
      EmailReminder.open(subj, body, attendees || "");
      return;
    }

    const channelLabel =
      channel === "both"
        ? l === "ar"
          ? "البريد الإلكتروني والواتساب"
          : "Email & WhatsApp"
        : "WhatsApp";

    if (
      !confirm(
        l === "ar"
          ? `إرسال التذكير عبر ${channelLabel} إلى المشاركين؟`
          : `Send reminder via ${channelLabel} to attendees?`,
      )
    )
      return;

    api(`/api/schedule/${id}/remind`, { method: "POST" })
      .then((r) => {
        const parts = [];
        if (r.emails_attempted)
          parts.push(
            `${r.emails_attempted} ${l === "ar" ? "بريد" : "email(s)"}`,
          );
        if (r.whatsapp_attempted)
          parts.push(`${r.whatsapp_attempted} WhatsApp`);

        const errPart =
          r.errors && r.errors.length
            ? ` — ${l === "ar" ? "فشل" : "failed"}: ${r.errors.map((e) => e.error).join(", ")}`
            : "";

        showToast(
          (l === "ar" ? "✓ تم الإرسال: " : "✓ Sent via ") +
            parts.join(" + ") +
            errPart,
          r.errors && r.errors.length ? "warning" : "success",
        );
      })
      .catch((e) => {
        showToast(
          (l === "ar" ? "✗ فشل الإرسال: " : "✗ Send failed: ") + e.message,
          "error",
        );
      });
  },

  // ── Meeting Platform Card ────────────────────────────────────────────────────
  _sPlatformCard(s, l) {
    const prov = s.meeting_provider || "physical";
    const PROV = {
      physical:    { icon: "🏛",  label: l === "ar" ? "اجتماع حضوري" : "Physical Meeting", color: "var(--text2)",  badge: "var(--navy4)" },
      zoom:        { icon: "🎥",  label: "Zoom",            color: "#2D8CFF",  badge: "rgba(45,140,255,.13)" },
      teams:       { icon: "💼",  label: "Microsoft Teams", color: "#6264A7",  badge: "rgba(98,100,167,.13)" },
      google_meet: { icon: "🎦",  label: "Google Meet",     color: "#00897B",  badge: "rgba(0,137,123,.13)"  },
    };
    const REC_ST = {
      not_started: { label: l === "ar" ? "لم يبدأ"      : "Not Started", color: "var(--text3)" },
      recording:   { label: l === "ar" ? "جارٍ التسجيل" : "Recording",   color: "var(--green)" },
      processing:  { label: l === "ar" ? "قيد المعالجة" : "Processing",  color: "var(--amber)" },
      ready:       { label: l === "ar" ? "جاهز"          : "Ready",       color: "var(--green)" },
      failed:      { label: l === "ar" ? "فشل التسجيل"  : "Failed",      color: "var(--red)"   },
    };
    const p      = PROV[prov] || PROV.physical;
    const recSt  = REC_ST[s.recording_status || "not_started"] || REC_ST.not_started;
    const isVirt = prov !== "physical";
    const notConn = l === "ar" ? "غير متصل" : "Not Connected";
    const noLink  = l === "ar" ? "لم يُضف رابط بعد" : "No join link added";
    const tLabel  = s.transcript_provider ? esc(s.transcript_provider) : (isVirt ? notConn : "Ameen AI");

    // Demo integration banner — shown for virtual providers
    const demoBanner = isVirt ? `
      <div style="margin-bottom:10px;padding:7px 10px;background:rgba(255,160,0,.07);border:1px solid rgba(255,160,0,.20);border-radius:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        <span style="font-size:14px">🔗</span>
        <div style="flex:1;min-width:0;font-size:11px;color:var(--text3)">
          <span style="color:var(--gold);font-weight:700">${esc(p.label)} ${l==='ar'?'جاهز للربط':'integration ready'}</span>
          &nbsp;·&nbsp;${l==='ar'?'ربط مباشر بانتظار بيانات الاعتماد':'Live API connection pending credentials'}
        </div>
        <span style="font-size:10.5px;padding:2px 7px;border-radius:5px;background:rgba(46,204,138,.12);color:#2ecc8a;border:.5px solid rgba(46,204,138,.28);white-space:nowrap">✓ ${l==='ar'?'البنية جاهزة':'Architecture ready'}</span>
      </div>` : '';

    // Status grid — always shown for every meeting type
    const statusGrid = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:7px;padding-top:10px;border-top:1px solid var(--border2)">
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"حالة التسجيل":"Recording Status"}</div>
          <div style="font-size:11px;font-weight:700;color:${isVirt ? recSt.color : '#2ecc8a'}">${isVirt ? recSt.label : (l==="ar"?"مدمج في المنصة":"On-platform")}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"النسخ":"Transcript"}</div>
          <div style="font-size:11px;font-weight:700;color:var(--text3)">${tLabel}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"التسجيل السحابي":"Cloud Recording"}</div>
          <div style="font-size:11px;font-weight:700;color:${isVirt?'var(--text3)':'#2ecc8a'}">${isVirt ? (s.recording_url ? `<a href="${esc(s.recording_url)}" target="_blank" style="color:var(--gold);text-decoration:none">${l==="ar"?"عرض ↗":"View ↗"}</a>` : (l==="ar"?"غير متصل":"Not Connected")) : (l==="ar"?"غير مطبق":"N/A")}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"التسجيل الكامل":"Full Capture"}</div>
          <div style="font-size:11px;font-weight:700;color:${isVirt?'#f0a000':'#2ecc8a'}">${isVirt ? (l==="ar"?"يتطلب بيانات الاعتماد":"Requires credentials") : (l==="ar"?"رفع يدوي متاح":"Manual upload available")}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"رفع يدوي":"Manual Upload"}</div>
          <div style="font-size:11px;font-weight:700;color:#2ecc8a">${l==="ar"?"متاح ✓":"Available ✓"}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"التخزين":"Storage"}</div>
          <div style="font-size:11px;font-weight:700;color:#2ecc8a">${l==="ar"?"أرشيف جاهز ✓":"Archive Ready ✓"}</div>
        </div>
      </div>`;

    return `<div style="margin-top:10px;padding:11px 13px;background:var(--navy3);border:1px solid var(--border2);border-radius:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:9px">
          <span style="font-size:18px;line-height:1">${p.icon}</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:${p.color}">${p.label}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:1px">${isVirt ? (l==="ar"?"اجتماع افتراضي":"Virtual meeting") : (l==="ar"?"حضور فعلي في المقر":"In-person at venue")}</div>
          </div>
        </div>
        ${s.meeting_join_url
          ? `<a href="${esc(s.meeting_join_url)}" target="_blank" rel="noopener"
               style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;text-decoration:none;background:${p.badge};color:${p.color};border:1px solid ${p.color}33">
               ▶ ${l==="ar"?"انضم للاجتماع":"Join Meeting"}
             </a>`
          : isVirt ? `<span style="font-size:11px;color:var(--text3);font-style:italic">${noLink}</span>` : ""}
      </div>
      ${demoBanner}
      ${statusGrid}
    </div>`;
  },
};

// ══ Create Meeting Wizard (Phase 1 redesign) ═══════════════════════════════
// Drives the new "Create Meeting" panel — a 4-step wizard (Details → Agenda &
// Planning → Attendees → Review) that creates a meetings row up-front (so it
// has a real lifecycle_stage from the moment it's created) and, unless saved
// as a draft, also creates a linked /api/schedule row via source_meeting_id so
// it shows up in the new Scheduled list. Reuses SeriesUI (prefix 'cm') and the
// exact board/committee/prev-meeting population + scheduling-conflict UX
// already proven out by the Schedule object — see _submitSchedule() below.
const CreateMeetingWizard = {
  state: { step: 1, agenda: [], decisions: [], actions: [], roles: [] },
  _submitting: false,
  _dirty: false,
  _dirtyBound: false,
  _ROLES: [
    { val: "chair",           ar: "رئيس الجلسة",       en: "Chair"                },
    { val: "organizer",       ar: "منظِّم",              en: "Organizer"            },
    { val: "coordinator",     ar: "منسّق الاجتماع",     en: "Meeting Coordinator"  },
    { val: "board_member",    ar: "عضو مجلس",           en: "Board Member"         },
    { val: "committee_member",ar: "عضو لجنة",           en: "Committee Member"     },
    { val: "secretary",       ar: "أمين السر",          en: "Secretary"            },
    { val: "presenter",       ar: "مقدِّم",              en: "Presenter"            },
    { val: "observer",        ar: "مراقب",               en: "Observer"             },
    { val: "guest",           ar: "ضيف",                en: "Guest"                },
    { val: "external",        ar: "مشارك خارجي",        en: "External Participant" },
  ],

  init() {
    this.state = { step: 1, agenda: [], decisions: [], actions: [], roles: [] };
    this._resetFields();
    this._dirty = false;
    this._submitting = false;
    this._dirtyBound = false;
    this._populateBoardSelects();
    this._populateOrganizerSelect();
    this._populatePrevMeetings();
    SeriesUI.invalidate();
    SeriesUI.setMode("cm", "standalone");
    SeriesUI.init("cm");
    this.renderAgenda();
    this.renderChips("decisions");
    this.renderChips("actions");
    this.renderAttachmentNames();
    this._applySchedulePermission();
    this.goStep(1);
    this._initDirtyTracking();
    // App._boards/_members are filled by loadSelectLists() after login — if
    // the user opens Create Meeting before that finishes, the selects would
    // stay empty. Fetch the reference data directly in that case.
    this._ensureRefData();
  },

  async _ensureRefData() {
    let changed = false;
    if (!(App._boards || []).length && !(App._committees || []).length) {
      try {
        const bc = await api("/api/gov/boards-and-committees");
        App._boards = bc.boards || [];
        App._committees = bc.committees || [];
        changed = true;
      } catch (_) {}
    }
    if (!(App._members || []).length) {
      try {
        App._members = await api("/api/members");
        changed = true;
      } catch (_) {}
    }
    if (!App.permissions.size) {
      try {
        const myPerms = await api("/api/rbac/my-permissions");
        App.permissions = new Set(myPerms.permissions || []);
        this._applySchedulePermission();
      } catch (_) {}
    }
    if (changed) {
      const prevBoard = ($("cm-board") || {}).value || "";
      const prevOrganizer = ($("cm-organizer") || {}).value || "";
      this._populateBoardSelects();
      this._populateOrganizerSelect();
      if (prevBoard && $("cm-board")) $("cm-board").value = prevBoard;
      if (prevOrganizer && $("cm-organizer")) $("cm-organizer").value = prevOrganizer;
    }
  },

  _setSubmitting(on, isDraft) {
    this._submitting = on;
    const l = App.lang;
    const loadingLabel = l === "ar" ? "جارٍ..." : "Working...";
    const draftLabel   = l === "ar" ? "حفظ كمسودة" : "Save as Draft";
    const createLabel  = l === "ar" ? "إنشاء الاجتماع" : "Create Meeting";
    ["cm-submit-top", "cm-submit-btn", "cm-bottom-submit"].forEach(id => {
      const btn = $(id); if (!btn) return;
      btn.disabled = on;
      const lbl = btn.querySelector("span");
      if (lbl) lbl.textContent = on && !isDraft ? loadingLabel : createLabel;
    });
    ["cm-draft-top", "cm-draft-btn", "cm-bottom-draft"].forEach(id => {
      const btn = $(id); if (!btn) return;
      btn.disabled = on;
      btn.textContent = on && isDraft ? loadingLabel : draftLabel;
    });
    const cancelBtn = $("cm-bottom-cancel");
    if (cancelBtn) cancelBtn.disabled = on;
  },

  bottomCancel() {
    if (this._dirty) {
      const l = App.lang;
      const msg = l === "ar"
        ? "لديك تغييرات غير محفوظة. هل تريد المغادرة؟"
        : "You have unsaved changes. Are you sure you want to leave?";
      if (!confirm(msg)) return;
    }
    this._dirty = false;
    Panels.load("scheduled");
  },

  _initDirtyTracking() {
    if (this._dirtyBound) return;
    const card = $("cm-form-card");
    if (!card) return;
    const mark = () => { if (!this._submitting) this._dirty = true; };
    card.addEventListener("input", mark);
    card.addEventListener("change", mark);
    this._dirtyBound = true;
  },

  // Hide "Create Meeting" (schedule) actions for roles without calendar.manage
  // — they can still save drafts. Applies to both the sticky header buttons
  // and the step-4 submit button.
  _applySchedulePermission() {
    const canSchedule = App.can("calendar.manage");
    ["cm-submit-top", "cm-submit-btn", "cm-bottom-submit"].forEach((id) => {
      const el = $(id);
      if (el) el.style.display = canSchedule ? "" : "none";
    });
    const note = $("cm-no-calendar-note");
    if (note) note.style.display = canSchedule ? "none" : "";
  },

  _resetFields() {
    ["cm-title", "cm-purpose-ar", "cm-purpose-en", "cm-join-url", "cm-attendees", "cm-decision-input", "cm-action-input"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    this.state.roles = [];
    const rolesList = $("cm-roles-list");
    if (rolesList) rolesList.innerHTML = "";
    if ($("cm-type")) $("cm-type").value = "";
    if ($("cm-date")) $("cm-date").value = "";
    if ($("cm-start")) $("cm-start").value = "09:00";
    if ($("cm-end")) $("cm-end").value = "10:00";
    if ($("cm-plat")) { $("cm-plat").value = "physical"; this.onProviderChange(); }
    if ($("cm-prev")) $("cm-prev").value = "";
    if ($("cm-channel")) $("cm-channel").value = "email";
    if ($("cm-recurrence")) $("cm-recurrence").value = "none";
    if ($("cm-attachments")) $("cm-attachments").value = "";
  },

  _populateBoardSelects() {
    const l = App.lang;
    const boards = App._boards || [];
    const sel = $("cm-board");
    if (!sel) return;
    sel.innerHTML =
      `<option value="">— ${l === "ar" ? "بدون مجلس" : "No board"} —</option>` +
      boards.map((b) => `<option value="${b.id}">${esc(l === "ar" ? b.name_ar : b.name_en || b.name_ar)}</option>`).join("");
    this.onBoardChange();
  },
  onBoardChange() {
    const boardId = parseInt($("cm-board") && $("cm-board").value) || 0;
    const l = App.lang;
    const all = App._committees || [];
    const committees = boardId ? all.filter((c) => c.board_id === boardId) : all;
    const csel = $("cm-committee");
    if (!csel) return;
    csel.innerHTML =
      `<option value="">— ${l === "ar" ? "بدون لجنة" : "No committee"} —</option>` +
      committees.map((c) => `<option value="${c.id}">${esc(l === "ar" ? c.name_ar : c.name_en || c.name_ar)}</option>`).join("");
  },
  onProviderChange() {
    const v = ($("cm-plat") && $("cm-plat").value) || "physical";
    const isVirtual = v !== "physical";
    const isHybrid = v === "hybrid";
    const row = $("cm-join-row");
    if (row) row.style.display = isVirtual ? "" : "none";
    const locRow = $("cm-location-row");
    if (locRow) locRow.style.display = (v === "physical" || isHybrid) ? "" : "none";
    const inp = $("cm-join-url");
    if (inp) inp.placeholder = v === "zoom" ? "https://zoom.us/j/..." : v === "teams" ? "https://teams.microsoft.com/l/meetup-join/..." : v === "google_meet" ? "https://meet.google.com/..." : v === "hybrid" ? "https://zoom.us/j/... (رابط المشاركة عن بُعد)" : "";
  },
  _populateOrganizerSelect() {
    const sel = $("cm-organizer");
    if (!sel) return;
    const l = App.lang;
    const members = App._members || [];
    sel.innerHTML =
      `<option value="">— ${l === "ar" ? "اختر" : "Select"} —</option>` +
      members.map((m) => `<option value="${m.id}">${esc(l === "ar" ? m.name_ar : m.name_en || m.name_ar)}</option>`).join("");
  },
  async _populatePrevMeetings() {
    const sel = $("cm-prev");
    if (!sel) return;
    const l = App.lang;
    try {
      const meetings = await api("/api/meetings");
      sel.innerHTML =
        `<option value="">— ${l === "ar" ? "لا يوجد" : "None"} —</option>` +
        meetings.map((m) => {
          const title = l === "ar" ? m.title_ar : m.title_en || m.title_ar;
          const date = (m.meeting_date || "").substring(0, 10);
          return `<option value="${m.id}">${esc(title)}${date ? " · " + date : ""}</option>`;
        }).join("");
    } catch (_) {}
  },

  goStep(step) {
    this.state.step = step;
    for (let i = 1; i <= 4; i++) {
      const panel = $(`cm-wiz-panel-${i}`);
      if (panel) panel.classList.toggle("active", i === step);
      const dot = $(`cm-wiz-dot-${i}`);
      if (dot) { dot.classList.toggle("active", i === step); dot.classList.toggle("done", i < step); }
      const conn = $(`cm-wiz-conn-${i}`);
      if (conn) conn.classList.toggle("done", i < step);
    }
    if (step === 4) this._renderReview();
    const card = $("cm-form-card");
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  addRoleRow() {
    const l = App.lang;
    const box = $("cm-roles-list");
    if (!box) return;
    const idx = this.state.roles.length;
    this.state.roles.push({ name: "", role: "" });
    const roleOpts = this._ROLES.map(r => `<option value="${r.val}">${l === "ar" ? r.ar : r.en}</option>`).join("");
    const row = document.createElement("div");
    row.className = "fa";
    row.style.cssText = "gap:6px;align-items:center";
    row.innerHTML = `
      <input class="fi" style="flex:2" placeholder="${l === "ar" ? "الاسم أو البريد" : "Name or email"}" oninput="CreateMeetingWizard.updateRole(${idx},'name',this.value)" />
      <select class="fi" style="flex:1" onchange="CreateMeetingWizard.updateRole(${idx},'role',this.value)">
        <option value="">${l === "ar" ? "— الدور —" : "— Role —"}</option>
        ${roleOpts}
      </select>
      <button type="button" class="btn-ghost btn-sm" style="flex-shrink:0;color:var(--red)" onclick="this.parentElement.remove();CreateMeetingWizard.state.roles.splice(${idx},1)">✕</button>`;
    box.appendChild(row);
  },
  updateRole(idx, field, val) {
    if (this.state.roles[idx]) this.state.roles[idx][field] = val;
  },

  addAgendaItem() {
    this.state.agenda.push({ title_ar: "", title_en: "", presenter: "", duration_mins: 15 });
    this.renderAgenda();
  },
  removeAgendaItem(i) {
    this.state.agenda.splice(i, 1);
    this.renderAgenda();
  },
  updateAgendaField(i, field, val) {
    if (this.state.agenda[i]) this.state.agenda[i][field] = val;
  },
  renderAgenda() {
    const box = $("cm-agenda-list");
    if (!box) return;
    const l = App.lang;
    if (!this.state.agenda.length) {
      box.innerHTML = `<div class="cw-agenda-empty">${l === "ar" ? "لا توجد بنود بعد — أضف أول بند لجدول الأعمال" : "No agenda items yet — add your first agenda item"}</div>`;
    } else {
      box.innerHTML = this.state.agenda.map((item, i) => `
      <div class="cw-agenda-item">
        <span class="cw-agenda-num">${i + 1}.</span>
        <div class="cw-agenda-fields">
          <input class="fi" placeholder="${l === "ar" ? "عنوان البند (عربي)" : "Item title (Arabic)"}" value="${esc(item.title_ar || "")}" oninput="CreateMeetingWizard.updateAgendaField(${i},'title_ar',this.value)"/>
          <input class="fi" dir="ltr" style="text-align:left" placeholder="Item title (English)" value="${esc(item.title_en || "")}" oninput="CreateMeetingWizard.updateAgendaField(${i},'title_en',this.value)"/>
          <div class="cw-agenda-sub">
            <input class="fi" placeholder="${l === "ar" ? "مقدّم البند" : "Presenter"}" value="${esc(item.presenter || "")}" oninput="CreateMeetingWizard.updateAgendaField(${i},'presenter',this.value)"/>
            <input class="fi cw-agenda-mins" type="number" min="5" step="5" placeholder="${l === "ar" ? "الدقائق" : "min"}" value="${item.duration_mins || 15}" oninput="CreateMeetingWizard.updateAgendaField(${i},'duration_mins',parseInt(this.value)||15);CreateMeetingWizard.renderAgendaTotal()"/>
            <span class="cw-agenda-min-lbl">${l === "ar" ? "دقيقة" : "min"}</span>
          </div>
        </div>
        <button type="button" class="cw-agenda-x" title="${l === "ar" ? "إزالة" : "Remove"}" onclick="CreateMeetingWizard.removeAgendaItem(${i})">✕</button>
      </div>`).join("");
    }
    this.renderAgendaTotal();
  },
  renderAgendaTotal() {
    const el = $("cm-agenda-total");
    if (!el) return;
    const l = App.lang;
    const total = this.state.agenda.reduce((sum, a) => sum + (parseInt(a.duration_mins) || 0), 0);
    if (!total) { el.textContent = ""; return; }
    const h = Math.floor(total / 60), m = total % 60;
    const dur = h ? `${h}${l === "ar" ? " س " : "h "}${m ? m + (l === "ar" ? " د" : "m") : ""}`.trim() : `${m}${l === "ar" ? " دقيقة" : "m"}`;
    el.textContent = (l === "ar" ? "المدة الإجمالية: " : "Total Duration: ") + dur;
  },
  renderAttachmentNames() {
    const box = $("cm-file-names");
    const inp = $("cm-attachments");
    if (!box || !inp) return;
    const files = Array.from(inp.files || []);
    box.innerHTML = files.map((f) => `<span class="cw-file-chip">📄 ${esc(f.name)} <span class="cw-file-size">${(f.size / 1048576).toFixed(1)} MB</span></span>`).join("");
  },

  addExpected(kind) {
    const inp = $(kind === "decisions" ? "cm-decision-input" : "cm-action-input");
    const val = ((inp && inp.value) || "").trim();
    if (!val) return;
    this.state[kind].push(val);
    if (inp) inp.value = "";
    this.renderChips(kind);
  },
  removeExpected(kind, i) {
    this.state[kind].splice(i, 1);
    this.renderChips(kind);
  },
  renderChips(kind) {
    const box = $(kind === "decisions" ? "cm-decisions-chips" : "cm-actions-chips");
    if (!box) return;
    box.innerHTML = this.state[kind].map((txt, i) =>
      `<span class="chip">${esc(txt)}<button type="button" class="chip-remove" onclick="CreateMeetingWizard.removeExpected('${kind}',${i})">✕</button></span>`
    ).join("");
  },

  _renderReview() {
    const box = $("cm-review");
    if (!box) return;
    const l = App.lang;
    const val = (id) => (($(id) && $(id).value) || "").trim();
    const selText = (id) => { const el = $(id); return el && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text.trim() : ""; };
    const empty = l === "ar" ? "— لم يُحدَّد —" : "— not set —";
    const row = (labelAr, labelEn, v) => `
      <div class="wiz-review-row">
        <span class="wiz-rl">${l === "ar" ? labelAr : labelEn}</span>
        <span class="wiz-rv">${v ? esc(v) : `<span class="wiz-empty-hint">${empty}</span>`}</span>
      </div>`;
    const group = (titleAr, titleEn, rowsHtml) => `
      <div class="wiz-review-group">
        <div class="wiz-review-group-title">${l === "ar" ? titleAr : titleEn}</div>
        ${rowsHtml}
      </div>`;
    const cmSeriesBtn = $("cm-series-seg") && $("cm-series-seg").querySelector(".imp-seg-btn.active");
    const seriesMode = (cmSeriesBtn && cmSeriesBtn.dataset.val) || "standalone";
    const seriesLabel = seriesMode === "new"
      ? (l === "ar" ? "سلسلة جديدة: " : "New series: ") + (val("cm-series-name-ar") || val("cm-series-name-en") || empty)
      : seriesMode === "continue"
      ? (l === "ar" ? "متابعة: " : "Continuing: ") + (selText("cm-series-existing") || empty)
      : l === "ar" ? "اجتماع مستقل" : "Standalone meeting";
    const agendaCount = this.state.agenda.filter((a) => a.title_ar || a.title_en).length;
    const fileCount = (($("cm-attachments") || {}).files || []).length;

    box.innerHTML =
      group("التفاصيل", "Details",
        row("العنوان", "Title", val("cm-title")) +
        row("النوع", "Type", selText("cm-type")) +
        row("التاريخ والوقت", "Date & time", [val("cm-date"), (val("cm-start") && val("cm-end")) ? `${val("cm-start")}–${val("cm-end")}` : val("cm-start")].filter(Boolean).join(" · ")) +
        row("المنصة / النوع", "Format", selText("cm-plat")) +
        row("الموقع الفعلي", "Location", val("cm-location")) +
        row("رابط الانضمام", "Join URL", val("cm-join-url")) +
        row("المنظِّم", "Organizer", selText("cm-organizer")) +
        row("المجلس", "Board", selText("cm-board")) +
        row("اللجنة", "Committee", selText("cm-committee"))
      ) +
      group("جدول الأعمال والتخطيط", "Agenda & Planning",
        row("العلاقة", "Relationship", seriesLabel) +
        row("بنود جدول الأعمال", "Agenda Items", agendaCount ? String(agendaCount) : "") +
        row("القرارات المتوقعة", "Expected Decisions", this.state.decisions.join("، ")) +
        row("الإجراءات المتوقعة", "Expected Actions", this.state.actions.join("، ")) +
        row("المرفقات", "Attachments", fileCount ? String(fileCount) : "")
      ) +
      group("المشاركون", "Attendees",
        row("المشاركون", "Attendees", val("cm-attendees")) +
        (this.state.roles.filter(r => r.name || r.role).length
          ? row("الأدوار", "Roles", this.state.roles.filter(r => r.name).map(r => {
              const roleMeta = this._ROLES.find(x => x.val === r.role);
              const roleLabel = roleMeta ? (l === "ar" ? roleMeta.ar : roleMeta.en) : r.role;
              return `${esc(r.name)}${roleLabel ? ` (${esc(roleLabel)})` : ""}`;
            }).join(" · "))
          : "")
      );

    // Creating the shared calendar/reminder entry (POST /schedule) requires
    // calendar.manage — a role that can create meetings but not manage the
    // calendar (e.g. Employee) can still save a draft, just not the full
    // scheduled flow, so don't offer a button that would 403 partway through.
    this._applySchedulePermission();
  },

  _computeDuration(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60; // meeting crosses midnight
    return mins || 60;
  },

  // Mirrors Schedule._submit's exact 409-conflict confirm/retry dance (same
  // bilingual message, same confirm() UX) so double-booking protection behaves
  // identically whether a meeting was scheduled from here or from the Schedule
  // panel.
  async _submitSchedule(data, force) {
    const l = App.lang;
    const res = await fetch("/api/schedule", {
      method: "POST",
      credentials: "include",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(force ? { ...data, force: true } : data),
    });
    const resData = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const list = (resData.conflicts || [])
        .map((c) => `• ${l === "ar" ? c.title_ar : c.title_en || c.title_ar} — ${(c.meeting_date || "").substring(0, 10)} ${c.meeting_time || ""}`)
        .join("\n");
      const msg = l === "ar"
        ? "يتعارض هذا الموعد مع اجتماع مؤكَّد:\n\n" + list + "\n\nهل تريد الحفظ رغم التعارض؟"
        : "This time overlaps a confirmed meeting:\n\n" + list + "\n\nSave anyway?";
      if (confirm(msg)) return this._submitSchedule(data, true);
      throw new Error(l === "ar" ? "تم إلغاء الجدولة بسبب التعارض" : "Scheduling cancelled due to the conflict");
    }
    if (!res.ok) throw new Error(resData.message || resData.error || `HTTP ${res.status}`);
    return resData;
  },

  async submit(isDraft) {
    const l = App.lang;
    const title = (($("cm-title") || {}).value || "").trim();
    const type = ($("cm-type") || {}).value || "";
    const date = ($("cm-date") || {}).value || "";
    const start = ($("cm-start") || {}).value || "";
    const end = ($("cm-end") || {}).value || "";
    const boardId = parseInt(($("cm-board") || {}).value) || null;
    const committeeId = parseInt(($("cm-committee") || {}).value) || null;

    if (!title) { showToast(l === "ar" ? "الرجاء إدخال عنوان الاجتماع" : "Please enter a meeting title", "error"); this.goStep(1); return; }
    if (!boardId && !committeeId) { showToast(l === "ar" ? "الرجاء اختيار مجلس أو لجنة" : "Please select a board or committee", "error"); this.goStep(1); return; }
    if (!type) { showToast(l === "ar" ? "الرجاء اختيار نوع الاجتماع" : "Please select a meeting type", "error"); this.goStep(1); return; }
    if (!date) { showToast(l === "ar" ? "الرجاء تحديد التاريخ" : "Please set the date", "error"); this.goStep(1); return; }
    if (!start) { showToast(l === "ar" ? "الرجاء تحديد وقت البدء" : "Please set the start time", "error"); this.goStep(1); return; }

    const durationMins = end ? this._computeDuration(start, end) : 60;
    const platVal = ($("cm-plat") || {}).value || "physical";
    const platformLabel = { zoom: "Zoom", teams: "Microsoft Teams", google_meet: "Google Meet", hybrid: "Hybrid / هجين", virtual: "Virtual / افتراضي" }[platVal] || "In-Person / حضوري";
    const organizerId = parseInt(($("cm-organizer") || {}).value) || null;
    const prevMeetingId = parseInt(($("cm-prev") || {}).value) || null;
    const decisions = this.state.decisions.slice();
    const actions = this.state.actions.slice();
    const agendaItems = this.state.agenda.filter((a) => (a.title_ar || "").trim() || (a.title_en || "").trim());
    const attendeesRaw = (($("cm-attendees") || {}).value || "").trim();
    const locationVal = (($("cm-location") || {}).value || "").trim();
    const joinUrlVal = (($("cm-join-url") || {}).value || "").trim();
    const rolesPayload = this.state.roles.filter(r => r.name || r.role);

    if (this._submitting) return;
    this._setSubmitting(true, isDraft);

    try {
      const meetingPayload = Object.assign({
        title_ar: title,
        title_en: title,
        meeting_type: type,
        board_id: boardId,
        committee_id: committeeId,
        prev_meeting_id: prevMeetingId,
        meeting_date: `${date} ${start}:00`,
        platform: platVal,
        organizer_id: organizerId,
        purpose_ar: (($("cm-purpose-ar") || {}).value || ""),
        purpose_en: (($("cm-purpose-en") || {}).value || ""),
        expected_decisions: decisions,
        expected_actions: actions,
        meeting_location: locationVal,
        meeting_join_url: joinUrlVal,
      }, SeriesUI.resolvePayload("cm"));

      const meeting = await api("/api/meetings", { method: "POST", body: JSON.stringify(meetingPayload) });

      if (agendaItems.length) {
        await api(`/api/meetings/${meeting.id}/agenda`, { method: "POST", body: JSON.stringify({ agenda: agendaItems }) });
      }

      const fileInput = $("cm-attachments");
      if (fileInput && fileInput.files && fileInput.files.length) {
        for (const file of Array.from(fileInput.files)) {
          try {
            const fd = new FormData();
            fd.append("file", file, file.name);
            await fetch(`/api/meetings/${meeting.id}/upload`, { method: "POST", credentials: "include", headers: authHeaders(), body: fd });
          } catch (_) { /* one failed attachment shouldn't abort meeting creation */ }
        }
      }

      if (!isDraft) {
        // Reuse the series_id the meeting create call already resolved
        // (rather than SeriesUI.resolvePayload('cm') again) so a "new series"
        // choice doesn't create two separate meeting_series rows.
        await this._submitSchedule({
          title_ar: title,
          title_en: title,
          meeting_date: date,
          meeting_time: start,
          duration_mins: durationMins,
          platform: platformLabel,
          attendees: attendeesRaw,
          agenda_ar: agendaItems.map((a) => a.title_ar).filter(Boolean).join("\n"),
          agenda_en: agendaItems.map((a) => a.title_en).filter(Boolean).join("\n"),
          meeting_type: type,
          board_id: boardId,
          committee_id: committeeId,
          prev_meeting_id: prevMeetingId,
          series_id: meeting.series_id || null,
          recurrence: ($("cm-recurrence") || {}).value || "none",
          reminder_channel: ($("cm-channel") || {}).value || "email",
          meeting_provider: platVal,
          meeting_join_url: (($("cm-join-url") || {}).value || "").trim(),
          meeting_location: (($("cm-location") || {}).value || "").trim(),
          source_meeting_id: meeting.id,
        }, false);

        const allAttendees = [];
        if (attendeesRaw) {
          attendeesRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).forEach(name => allAttendees.push({ name }));
        }
        rolesPayload.forEach(r => {
          if (!r.name) return;
          const existing = allAttendees.find(a => a.name.trim().toLowerCase() === r.name.trim().toLowerCase());
          if (existing) { existing.role = r.role; }
          else { allAttendees.push({ name: r.name, role: r.role }); }
        });
        if (allAttendees.length) {
          await api(`/api/meetings/${meeting.id}/attendees`, { method: "POST", body: JSON.stringify({ attendees: allAttendees }) });
        }
      }

      showToast(isDraft
        ? (l === "ar" ? "✓ تم حفظ الاجتماع كمسودة" : "✓ Meeting saved as draft")
        : (l === "ar" ? "✓ تم إنشاء الاجتماع وجدولته" : "✓ Meeting created and scheduled"));
      this._dirty = false;
      await Panels.load("scheduled");
    } catch (e) {
      showToast((l === "ar" ? "تعذّر إنشاء الاجتماع: " : "Could not create meeting: ") + e.message, "error");
    } finally {
      this._setSubmitting(false, isDraft);
    }
  },
};

// ══ Activity Log panel ────────────────────────────────────────────────────────
const ActivityLog = {
  _data: [],
  _filter: "all",
  _search: "",

  async refresh() {
    const body = $("activity-log-body");
    if (!body) return;
    body.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    try {
      this._data = await api("/api/activity-log");
    } catch (e) {
      body.innerHTML = `<div class="es"><div class="ic">⚠️</div><div class="t">${App.lang === "ar" ? "تعذّر تحميل السجلات" : "Could not load logs"}</div></div>`;
      return;
    }
    this._render();
  },

  _render() {
    const body = $("activity-log-body");
    if (!body) return;
    const l = App.lang;
    const t = (ar, en) => l === "ar" ? ar : en;

    const TYPE_LABELS = {
      reschedule:  { ar: "إعادة جدولة",   en: "Reschedule",       ico: "📆", color: "#C9860A" },
      lifecycle:   { ar: "مرحلة الاجتماع", en: "Meeting Stage",    ico: "🔄", color: "#1a7f4b" },
      minutes:     { ar: "محضر الاجتماع",  en: "Meeting Minutes",  ico: "📄", color: "#5b6fe6" },
      permission:  { ar: "صلاحيات",        en: "Permissions",      ico: "🛡️", color: "#8b5cf6" },
      event:       { ar: "حدث مباشر",      en: "Live Event",       ico: "⚡", color: "#e03e3e" },
    };
    const FILTERS = [
      { key: "all",        ar: "الكل",         en: "All"         },
      { key: "reschedule", ar: "إعادة جدولة",   en: "Reschedule"  },
      { key: "lifecycle",  ar: "مراحل الاجتماع",en: "Meeting Stages"},
      { key: "minutes",    ar: "المحاضر",       en: "Minutes"     },
      { key: "permission", ar: "الصلاحيات",     en: "Permissions" },
      { key: "event",      ar: "الأحداث",       en: "Live Events" },
    ];

    const visible = this._data.filter(r => {
      if (this._filter !== "all" && r.source_type !== this._filter) return false;
      if (this._search) {
        const q = this._search.toLowerCase();
        return (r.actor_name || "").toLowerCase().includes(q)
            || (r.entity_ar  || "").toLowerCase().includes(q)
            || (r.entity_en  || "").toLowerCase().includes(q)
            || (r.detail     || "").toLowerCase().includes(q)
            || (r.reason     || "").toLowerCase().includes(q);
      }
      return true;
    });

    const filterBtns = FILTERS.map(f =>
      `<button class="btn-ghost btn-sm${this._filter === f.key ? " btn-active" : ""}"
        style="font-size:11.5px;${this._filter === f.key ? "background:var(--amber,#C9860A);color:#fff;border-color:var(--amber,#C9860A);" : ""}"
        onclick="ActivityLog._setFilter('${f.key}')">${t(f.ar, f.en)}</button>`
    ).join("");

    const rows = visible.length ? visible.map(r => {
      const type = TYPE_LABELS[r.source_type] || { ico: "📋", color: "#888", ar: r.source_type, en: r.source_type };
      const entity = (l === "ar" ? r.entity_ar : r.entity_en) || r.entity_ar || "";
      const when = (r.created_at || "").substring(0, 16).replace("T", " ");
      const initials = (r.actor_name || "?").trim().split(/\s+/).map(w => w[0]).join("").substring(0, 2).toUpperCase();
      return `
        <div class="al-row">
          <div class="al-av" style="background:${type.color}22;color:${type.color}">${initials}</div>
          <div class="al-body">
            <div class="al-top">
              <span class="al-actor">${esc(r.actor_name || t("النظام","System"))}</span>
              <span class="al-badge" style="background:${type.color}22;color:${type.color}">${type.ico} ${t(type.ar, type.en)}</span>
              <span class="al-time">${when}</span>
            </div>
            ${entity ? `<div class="al-entity">📋 ${esc(entity)}</div>` : ""}
            <div class="al-detail">${esc(r.detail || "")}</div>
            ${r.reason ? `<div class="al-reason">💬 ${esc(r.reason)}</div>` : ""}
          </div>
        </div>`;
    }).join("") : `<div class="es" style="min-height:160px"><div class="ic">🗂️</div><div class="t">${t("لا توجد سجلات مطابقة", "No matching log entries")}</div></div>`;

    body.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <input class="fi" style="flex:1;min-width:180px;max-width:300px;font-size:12.5px" placeholder="${t("بحث باسم الشخص أو الحدث…", "Search by person or event…")}"
          value="${esc(this._search)}" oninput="ActivityLog._setSearch(this.value)"/>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${filterBtns}</div>
        <span style="font-size:11px;color:var(--text3);margin-inline-start:auto">${visible.length} ${t("نتيجة", "results")}</span>
      </div>
      <div class="al-list">${rows}</div>`;
  },

  _setFilter(f) { this._filter = f; this._render(); },
  _setSearch(v) { this._search = v; this._render(); },
};

// ══ Generic row action menu (⋮) — minimal popover toggle used by the new
// Scheduled / Live Meetings list rows. There's no pre-existing dropdown-menu
// pattern in the codebase to reuse (NotificationCenter's dropdown is a single
// fixed element, not a per-row popover), so this is deliberately small and
// shared rather than duplicated per panel.
const RowMenu = {
  _open: null,
  _outsideHandler: null,
  toggle(id, ev) {
    if (ev) ev.stopPropagation();
    const el = $(id);
    if (!el) return;
    if (this._open === id) { this.closeAll(); return; }
    this.closeAll();
    el.classList.add("open");
    this._open = id;
    this._outsideHandler = () => this.closeAll();
    setTimeout(() => document.addEventListener("click", this._outsideHandler), 0);
  },
  closeAll() {
    document.querySelectorAll(".row-menu.open").forEach((el) => el.classList.remove("open"));
    this._open = null;
    if (this._outsideHandler) { document.removeEventListener("click", this._outsideHandler); this._outsideHandler = null; }
  },
};

// Live Meeting entry point: the recording engine itself still lives in
// panel-record (Rec / the waveform / live-transcript & extraction cards) —
// this binds it to an already-created meeting (from Create Meeting → Start
// Meeting, or Live Meetings' Join) instead of letting it create a fresh,
// duplicate meeting the way ad-hoc recording does. Shared by
// ScheduledPanel.startMeeting() and LiveMeetingsPanel's Open/Join button.
async function enterLiveMeeting(meetingId) {
  // Navigate to the Live Meetings panel — NEVER the legacy Record screen
  await Panels.load("live");
  try {
    await LiveMeetingsPanel.refresh();
    // Open the meeting workspace in the 'live' tab after a brief render delay
    if (window.MT && meetingId) {
      setTimeout(() => MT.openDetail(meetingId, "live"), 300);
    }
  } catch (e) {
    showToast((App.lang === "ar" ? "تعذّر تحميل الاجتماع: " : "Could not load the meeting: ") + e.message, "error");
  }
}

// ══ Scheduled Meetings list (Phase 1 redesign) ═════════════════════════════
// Replaces "Record Meeting" as a sidebar landing point: shows /api/schedule
// rows that haven't progressed past created/invited/scheduled on their linked
// meeting (if any), with a computed readiness score and a "Start Meeting"
// action that transitions the linked meeting into `recording` and hands off
// to the (rough, phase-2-polished) Live Meeting bridge.
const ScheduledPanel = {
  _all: [],
  _meetingsById: {},
  _tab: "all",
  _selKind: null,
  _selId: null,
  _groups: { upcoming: [], inprog: [], completed: [] },

  async refresh() {
    const list = $("sp-list");
    if (list) list.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [schedule, meetings] = await Promise.all([api("/api/schedule"), api("/api/meetings")]);
      this._meetingsById = {};
      meetings.forEach((m) => { this._meetingsById[m.id] = m; });
      this._all = schedule.filter((s) => s.status !== "cancelled");
      this.applyFilters();
    } catch (e) {
      if (list) list.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },

  _linked(s) {
    return s.source_meeting_id ? this._meetingsById[s.source_meeting_id] : null;
  },
  _isLive(s) {
    const m = this._linked(s);
    return !!m && m.lifecycle_stage === "recording";
  },
  _isPastLive(s) {
    const m = this._linked(s);
    return !!m && !!m.lifecycle_stage && LIFECYCLE_STAGE_ORDER.indexOf(m.lifecycle_stage) > LIFECYCLE_STAGE_ORDER.indexOf("recording");
  },

  setTab(t) {
    this._tab = t;
    this.applyFilters();
  },

  applyFilters() {
    const l = App.lang;
    const q = (($("sp-search") || {}).value || "").trim().toLowerCase();
    const type = ($("sp-type-filter") || {}).value || "";
    const sort = ($("sp-sort-filter") || {}).value || "meeting_date";
    const match = (titleAr, titleEn, mType) => {
      if (type && mType !== type) return false;
      if (q) {
        const t1 = ((l === "ar" ? titleAr : titleEn || titleAr) || "").toLowerCase();
        const t2 = ((l === "ar" ? titleEn : titleAr) || "").toLowerCase();
        if (!t1.includes(q) && !t2.includes(q)) return false;
      }
      return true;
    };
    const sortFn = (a, b) => {
      if (sort === "created_desc") return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      if (sort === "created_asc") return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      if (sort === "updated_desc") return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
      // meeting_date and upcoming: sort by date+time ascending
      return ((a.meeting_date || "") + (a.meeting_time || "")).localeCompare((b.meeting_date || "") + (b.meeting_time || ""));
    };
    const today = new Date().toISOString().substring(0, 10);
    const upcoming = [];
    const inprog = [];
    const drafts = [];
    this._all.forEach((s) => {
      if (this._isPastLive(s)) return;
      if (!match(s.title_ar, s.title_en, s.meeting_type)) return;
      if (s.status === "draft") { drafts.push(s); return; }
      // Hide past-dated scheduled items that were never started — they should
      // not clutter Upcoming / All Meetings; only show today and future.
      if (s.meeting_date && s.meeting_date < today && !this._isLive(s)) return;
      (this._isLive(s) ? inprog : upcoming).push(s);
    });
    upcoming.sort(sortFn);
    drafts.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const doneStages = new Set(["processing", "minutes", "approval", "closed", "completed"]);
    const completed = Object.values(this._meetingsById)
      .filter((m) => {
        const st = m.lifecycle_stage || "";
        const isDone = (st && LIFECYCLE_STAGE_ORDER.indexOf(st) > LIFECYCLE_STAGE_ORDER.indexOf("recording")) || doneStages.has(st) || m.status === "completed";
        return isDone && match(m.title_ar, m.title_en, m.meeting_type);
      })
      .sort((a, b) => {
        if (sort === "created_asc") return String(a.created_at || "").localeCompare(String(b.created_at || ""));
        if (sort === "updated_desc") return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
        return String(b.meeting_date || b.created_at || "").localeCompare(String(a.meeting_date || a.created_at || ""));
      });
    this._groups = { upcoming, inprog, completed, drafts };

    // keep selection if still visible, else select the first visible item
    const visible = this._visibleItems();
    const stillThere = visible.some((it) => it.kind === this._selKind && it.id === this._selId);
    if (!stillThere) {
      this._selKind = visible.length ? visible[0].kind : null;
      this._selId = visible.length ? visible[0].id : null;
    }
    this.renderTabs();
    this.render();
    this.renderDetail();
  },

  _visibleItems() {
    const g = this._groups;
    const items = [];
    if (this._tab === "all" || this._tab === "inprog") g.inprog.forEach((s) => items.push({ kind: "sched", id: s.id }));
    if (this._tab === "all" || this._tab === "draft") (g.drafts || []).forEach((s) => items.push({ kind: "sched", id: s.id }));
    if (this._tab === "all" || this._tab === "upcoming") g.upcoming.forEach((s) => items.push({ kind: "sched", id: s.id }));
    if (this._tab === "all" || this._tab === "completed") g.completed.forEach((m) => items.push({ kind: "meeting", id: m.id }));
    return items;
  },

  renderTabs() {
    const box = $("sp-tabs");
    if (!box) return;
    const l = App.lang;
    const g = this._groups;
    const tab = (key, ar, en, count) => `<button class="mt2-tab ${this._tab === key ? "active" : ""}" onclick="ScheduledPanel.setTab('${key}')">
      ${l === "ar" ? ar : en}${count !== null ? ` <span class="mt2-tab-n">${count}</span>` : ""}</button>`;
    box.innerHTML =
      tab("all", "كل الاجتماعات", "All Meetings", null) +
      tab("draft", "المسودات", "Draft", (g.drafts || []).length) +
      tab("upcoming", "القادمة", "Upcoming", g.upcoming.length) +
      tab("inprog", "الجارية", "In Progress", g.inprog.length) +
      tab("completed", "المكتملة", "Completed", g.completed.length);
  },

  select(kind, id) {
    this._selKind = kind;
    this._selId = id;
    this.render();
    this.renderDetail();
    if (window.matchMedia && window.matchMedia("(max-width: 980px)").matches) {
      const d = $("sp-detail");
      if (d) d.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  },

  _dateTile(ds, l) {
    const M_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const M_AR = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];
    const W_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const W_AR = ["أحد", "اثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];
    const d = new Date(String(ds || "").substring(0, 10) + "T00:00:00");
    if (isNaN(d)) return `<div class="mt2-date"><span class="d">—</span></div>`;
    const mo = (l === "ar" ? M_AR : M_EN)[d.getMonth()];
    const wd = (l === "ar" ? W_AR : W_EN)[d.getDay()];
    return `<div class="mt2-date"><span class="m">${mo}</span><span class="d">${d.getDate()}</span><span class="w">${wd}</span></div>`;
  },

  _fmtTime(hm, l) {
    if (!hm) return "";
    const p = String(hm).split(":");
    let h = parseInt(p[0], 10) || 0;
    const m = (p[1] || "00").substring(0, 2);
    const am = h < 12;
    h = h % 12 || 12;
    return h + ":" + m + " " + (am ? (l === "ar" ? "ص" : "AM") : (l === "ar" ? "م" : "PM"));
  },

  _endTime(hm, dur, l) {
    if (!hm) return "";
    const p = String(hm).split(":");
    const t = ((parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) + (parseInt(dur, 10) || 60)) % 1440;
    const h = Math.floor(t / 60);
    const m2 = t % 60;
    return this._fmtTime((h < 10 ? "0" + h : h) + ":" + (m2 < 10 ? "0" + m2 : m2), l);
  },

  render() {
    const l = App.lang;
    const box = $("sp-list");
    if (!box) return;
    const g = this._groups;
    const sec = (ar, en) => `<div class="mt2-group">${l === "ar" ? ar : en}</div>`;
    const pillLive = `<span class="mt2-pill mt2-p-amber">● ${l === "ar" ? "مباشر" : "Live"}</span>`;
    const pillSched = (s) => s.status === "confirmed"
      ? `<span class="mt2-pill mt2-p-blue">${l === "ar" ? "مجدول" : "Scheduled"}</span>`
      : `<span class="mt2-pill mt2-p-gray">${l === "ar" ? "مسودة" : "Draft"}</span>`;
    const pillDone = `<span class="mt2-pill mt2-p-green">✓ ${l === "ar" ? "مكتمل" : "Completed"}</span>`;
    const lcPill = (m) => {
      const stage = m.lifecycle_stage || "created";
      const ms = m.minutes_status || "draft";
      if (stage === "archived") return `<span class="mt2-pill" style="background:rgba(130,130,130,.15);color:#888">🗄 ${l==="ar"?"مؤرشف":"Archived"}</span>`;
      if (stage === "approval" || stage === "board_approval" || ms === "final_approved" || ms === "approved")
        return `<span class="mt2-pill" style="background:rgba(40,120,220,.15);color:#2878dc">✅ ${l==="ar"?"معتمد":"Approved"}</span>`;
      if (["ai_minutes_generated","review","secretary_review","chairman_approval"].includes(stage) || ms === "circulated")
        return `<span class="mt2-pill mt2-p-amber">📝 ${l==="ar"?"المحضر قيد المراجعة":"Minutes In Review"}</span>`;
      if (["transcript_generated","uploaded"].includes(stage))
        return `<span class="mt2-pill mt2-p-blue">⚙️ ${l==="ar"?"قيد التحضير":"In Preparation"}</span>`;
      return pillDone;
    };
    const chev = l === "ar" ? "‹" : "›";

    const schedRow = (s, pill) => {
      const sel = this._selKind === "sched" && this._selId === s.id;
      const title = (l === "ar" ? s.title_ar : s.title_en || s.title_ar) || "";
      const sub = (l === "ar" ? s.title_en : s.title_ar) || "";
      const meta = [this._fmtTime((s.meeting_time || "").substring(0, 5), l), s.platform ? platLabel(s.platform, l) : ""].filter(Boolean);
      const linked = this._linked(s);
      const chevBtn = linked
        ? `<button class="mt2-chev mt2-chev-open" title="${l === "ar" ? "فتح صفحة الاجتماع" : "Open meeting page"}" onclick="event.stopPropagation();MT.openDetail(${linked.id})">${chev}</button>`
        : `<span class="mt2-chev">${chev}</span>`;
      return `<div class="mt2-row ${sel ? "sel" : ""}" role="button" tabindex="0" onclick="ScheduledPanel.select('sched',${s.id})" ondblclick="${linked ? `MT.openDetail(${linked.id})` : ""}" onkeydown="if(event.key==='Enter')ScheduledPanel.select('sched',${s.id})">
        ${this._dateTile(s.meeting_date, l)}
        <div class="mt2-row-main">
          <div class="mt2-row-t">${esc(title)}</div>
          ${sub && sub !== title ? `<div class="mt2-row-s">${esc(sub)}</div>` : ""}
          <div class="mt2-row-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        </div>
        <div class="mt2-row-side">${pill}${chevBtn}</div>
      </div>`;
    };
    const meetRow = (m) => {
      const sel = this._selKind === "meeting" && this._selId === m.id;
      const title = (l === "ar" ? m.title_ar : m.title_en || m.title_ar) || "";
      const sub = (l === "ar" ? m.title_en : m.title_ar) || "";
      const ds = (m.meeting_date || m.created_at || "").substring(0, 10);
      return `<div class="mt2-row ${sel ? "sel" : ""}" role="button" tabindex="0" onclick="ScheduledPanel.select('meeting',${m.id})" ondblclick="MT.openDetail(${m.id})" onkeydown="if(event.key==='Enter')ScheduledPanel.select('meeting',${m.id})">
        ${this._dateTile(ds, l)}
        <div class="mt2-row-main">
          <div class="mt2-row-t">${esc(title)}</div>
          ${sub && sub !== title ? `<div class="mt2-row-s">${esc(sub)}</div>` : ""}
          <div class="mt2-row-meta"><span>${mtLabel(m.meeting_type, l) || ""}</span></div>
        </div>
        <div class="mt2-row-side">${lcPill(m)}<button class="mt2-chev mt2-chev-open" title="${l === "ar" ? "فتح صفحة الاجتماع" : "Open meeting page"}" onclick="event.stopPropagation();MT.openDetail(${m.id})">${chev}</button></div>
      </div>`;
    };

    const pillDraft = `<span class="mt2-pill mt2-p-gray">${l === "ar" ? "مسودة" : "Draft"}</span>`;
    let html = "";
    if ((this._tab === "all" || this._tab === "inprog") && g.inprog.length)
      html += sec("جارية الآن", "In Progress") + g.inprog.map((s) => schedRow(s, pillLive)).join("");
    if ((this._tab === "all" || this._tab === "draft") && (g.drafts || []).length)
      html += sec("المسودات", "Drafts") + g.drafts.map((s) => schedRow(s, pillDraft)).join("");
    if ((this._tab === "all" || this._tab === "upcoming") && g.upcoming.length)
      html += sec("القادمة", "Upcoming") + g.upcoming.map((s) => schedRow(s, pillSched(s))).join("");
    if ((this._tab === "all" || this._tab === "completed") && g.completed.length)
      html += sec("المكتملة", "Completed") + g.completed.slice(0, 25).map(meetRow).join("");

    if (!html) {
      box.innerHTML = emptyStateCard({
        icon: "🗓",
        titleAr: "لا توجد اجتماعات", titleEn: "No meetings",
        descAr: "ابدأ بإنشاء أول اجتماع", descEn: "Start by creating your first meeting",
        primary: { ar: "+ إنشاء اجتماع", en: "+ Create Meeting", onclick: "Panels.load('create-meeting')" },
      });
      return;
    }
    box.innerHTML = html;
  },

  renderDetail() {
    const box = $("sp-detail");
    if (!box) return;
    const l = App.lang;

    // reset clickable state
    box.classList.remove("sp-detail--active");
    box.onclick = null;
    box.style.cursor = "";

    if (!this._selKind) { box.innerHTML = ""; return; }

    let openFn = null;

    if (this._selKind === "meeting") {
      const m = this._meetingsById[this._selId];
      if (m) {
        openFn = () => MT.openDetail(m.id);
        box.innerHTML = this._meetingDetailHtml(m, l);
      }
    } else {
      const s = this._all.find((x) => x.id === this._selId);
      if (s) {
        const linked = this._linked(s);
        if (linked) openFn = () => MT.openDetail(linked.id);
        box.innerHTML = this._schedDetailHtml(s, l);
        // Async: load reschedule history into the placeholder card
        if (s.status !== 'draft') this._loadRescheduleLog(s.id);
      }
    }

    // Always highlight the panel whenever content is shown — regardless of
    // whether there is a linked meeting record to navigate into.
    if (box.innerHTML) {
      box.classList.add("sp-detail--active");
      if (openFn) {
        box.style.cursor = "pointer";
        box.onclick = (e) => {
          if (e.target.closest("button,a,input,select,textarea,[role='button']")) return;
          openFn();
        };
      }
      // Hint banner — navigable or informational
      const hint = document.createElement("div");
      hint.className = "sp-detail-hint";
      hint.innerHTML = openFn
        ? `<span>☰ ${l === "ar" ? "انقر لفتح الصفحة الكاملة" : "Click to open full meeting page"}</span><span class="mt2-chev">${l === "ar" ? "‹" : "›"}</span>`
        : `<span>☰ ${l === "ar" ? "نظرة عامة على الاجتماع" : "Meeting Overview"}</span>`;
      box.insertBefore(hint, box.firstChild);
    }
  },

  _fmtLongDate(ds, l) {
    const d = new Date(String(ds || "").substring(0, 10) + "T00:00:00");
    if (isNaN(d)) return esc(String(ds || "—"));
    return d.toLocaleDateString(l === "ar" ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
  },

  _schedDetailHtml(s, l) {
    const t = (ar, en) => (l === "ar" ? ar : en);
    const linked = this._linked(s);
    const live = this._isLive(s);
    const eligible = !linked || new Set(["created", "invited", "scheduled"]).has(linked.lifecycle_stage);
    const title = (l === "ar" ? s.title_ar : s.title_en || s.title_ar) || "";
    const sub = (l === "ar" ? s.title_en : s.title_ar) || "";
    const typeLabel = mtLabel(s.meeting_type, l) || t("اجتماع", "Meeting");
    const organizer = (l === "ar" ? s.creator_ar : s.creator_en || s.creator_ar) || "";
    const boardOrCommittee = (l === "ar" ? (s.board_name_ar || s.committee_name_ar) : (s.board_name_en || s.board_name_ar || s.committee_name_en || s.committee_name_ar)) || "";
    const series = (l === "ar" ? s.series_name_ar : s.series_name_en || s.series_name_ar) || "";
    const attendeeCount = (s.attendees || "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean).length;
    const durH = Math.floor((parseInt(s.duration_mins, 10) || 60) / 60);
    const durM = (parseInt(s.duration_mins, 10) || 60) % 60;
    const durTxt = (durH ? durH + t("س", "h") : "") + (durM ? " " + durM + t("د", "m") : "") || t("ساعة", "1h");
    const statusPill = live
      ? `<span class="mt2-pill mt2-p-amber">● ${t("جارٍ الآن", "In Progress")}</span>`
      : s.status === "confirmed"
        ? `<span class="mt2-pill mt2-p-blue">${t("مجدول", "Scheduled")}</span>`
        : `<span class="mt2-pill mt2-p-gray">${t("مسودة", "Draft")}</span>`;
    const menuId = `sp-menu-${s.id}`;

    // tabs → open the full meeting page on the requested tab (only when a
    // meeting record exists to back it)
    const wsTab = (key, ico, ar, en, count) => linked
      ? `<button class="mt2-dtab" onclick="MT.openDetail(${linked.id},'${key}')">${ico} ${t(ar, en)}${count ? ` <span class="mt2-tab-n">${count}</span>` : ""}</button>`
      : "";
    const tabs = `<div class="mt2-dtabs">
      <button class="mt2-dtab active">☰ ${t("نظرة عامة", "Overview")}</button>
      ${wsTab("agenda", "🗒", "جدول الأعمال", "Agenda", 0)}
      ${wsTab("documents", "📄", "المستندات", "Documents", parseInt(s.doc_count, 10) || 0)}
      ${wsTab("actions", "🎯", "الإجراءات", "Actions", 0)}
      ${wsTab("decisions", "⚖️", "القرارات", "Decisions", 0)}
      ${wsTab("minutes", "📝", "المحضر", "Minutes", 0)}
      ${wsTab("timeline", "🕘", "الجدول الزمني", "Timeline", 0)}
    </div>`;

    // progress stepper (real, data-derived states)
    const hasAgenda = !!(s.agenda_ar || s.agenda_en);
    const minutesStarted = !!(linked && linked.minutes_status && linked.minutes_status !== "draft");
    const closed = !!(linked && (linked.minutes_status === "approved" || linked.minutes_status === "final_approved"));
    const steps = [
      { ar: "مجدول", en: "Scheduled", state: "done", sub: (s.created_at || "").substring(0, 10) },
      { ar: "جدول الأعمال", en: "Agenda", state: hasAgenda ? "done" : "pending", sub: hasAgenda ? t("منشور", "Published") : t("معلّق", "Pending") },
      { ar: "الانعقاد", en: "In Progress", state: live ? "active" : "pending", sub: live ? t("مباشر الآن", "Live Now") : t("معلّق", "Pending") },
      { ar: "المحضر", en: "Minutes", state: minutesStarted ? "done" : "pending", sub: minutesStarted ? t("قيد الإعداد", "Drafted") : t("معلّق", "Pending") },
      { ar: "الإغلاق", en: "Closed", state: closed ? "done" : "pending", sub: closed ? t("معتمد", "Approved") : t("معلّق", "Pending") },
    ];
    const stepper = `<div class="mt2-card"><div class="mt2-card-t">${t("تقدم الاجتماع", "Meeting Progress")}</div>
      <div class="mt2-steps">${steps
        .map(
          (st, i) => `<div class="mt2-step ${st.state}">
          <span class="mt2-step-dot">${st.state === "done" ? "✓" : i + 1}</span>
          <span class="mt2-step-l">${t(st.ar, st.en)}</span>
          <span class="mt2-step-s">${st.sub || ""}</span>
        </div>${i < steps.length - 1 ? '<span class="mt2-step-bar"></span>' : ""}`,
        )
        .join("")}</div></div>`;

    const aboutRow = (ar, en, val) => (val ? `<div class="mt2-ab-row"><span class="mt2-ab-k">${t(ar, en)}</span><span class="mt2-ab-v">${esc(val)}</span></div>` : "");
    const agendaTxt = ((l === "ar" ? s.agenda_ar : s.agenda_en || s.agenda_ar) || "").substring(0, 160);
    const about = `<div class="mt2-card"><div class="mt2-card-t">${t("عن هذا الاجتماع", "About This Meeting")}</div>
      ${aboutRow("نوع الاجتماع", "Meeting Type", typeLabel)}
      ${aboutRow("السلسلة", "Meeting Series", series)}
      ${aboutRow("المجلس / اللجنة", "Board / Committee", boardOrCommittee)}
      ${aboutRow("الغرض", "Purpose", agendaTxt)}
      ${aboutRow("المشاركون", "Participants", attendeeCount ? attendeeCount + " " + t("عضو", "members") : "")}
      ${aboutRow("المنظّم", "Organizer", organizer)}
      ${aboutRow("التنسيق", "Format", s.platform ? platLabel(s.platform, l) : "")}
      ${aboutRow("الموقع", "Location", s.meeting_location || "")}
    </div>`;

    const isDraft = s.status === "draft";
    const qa = [];
    if (isDraft) qa.push({ ico: "✏️", ar: "متابعة التحرير", en: "Continue Editing", on: `ScheduledPanel.editDraft(${s.id})` });
    if (linked) qa.push({ ico: "📦", ar: "فتح صفحة الاجتماع", en: "Open Meeting Page", on: `MT.openDetail(${linked.id})` });
    if (s.meeting_join_url) qa.push({ ico: "🎥", ar: "الانضمام للاجتماع", en: "Join Meeting", on: `ScheduledPanel.openJoinUrl(${s.id})` });
    if (eligible && !live && !isDraft) qa.push({ ico: "🔴", ar: "بدء الاجتماع والتسجيل", en: "Start & Record Meeting", on: `ScheduledPanel.startMeeting(${s.id})` });
    if (live && linked) qa.push({ ico: "▶", ar: "متابعة الاجتماع المباشر", en: "Rejoin Live Meeting", on: `MT.openDetail(${linked.id},'live')` });
    if (!isDraft) qa.push({ ico: "📆", ar: "إعادة جدولة", en: "Reschedule", on: `ScheduledPanel.reschedule(${s.id})` });
    if (linked) qa.push({ ico: "📄", ar: "المستندات", en: "Documents", on: `MT.openDetail(${linked.id},'documents')` });
    qa.push({ ico: "📅", ar: "عرض في التقويم", en: "View in Calendar", on: `Panels.load('calendar')` });
    const quick = `<div class="mt2-card"><div class="mt2-card-t">${t("إجراءات سريعة", "Quick Actions")}</div>
      <div class="mt2-qa">${qa
        .map((a) => `<button class="mt2-qa-btn" onclick="${a.on}"><span>${a.ico} ${t(a.ar, a.en)}</span><span class="mt2-chev">${l === "ar" ? "‹" : "›"}</span></button>`)
        .join("")}</div></div>`;

    const rescheduleCard = isDraft ? "" : `
      <div class="mt2-card" style="margin-top:0">
        <div class="mt2-card-t" style="display:flex;align-items:center;gap:8px">
          <span>${t("سجل إعادة الجدولة", "Reschedule History")}</span>
          <span id="sched-rlog-badge-${s.id}" style="display:none;background:var(--amber,#C9860A);color:#fff;border-radius:99px;font-size:10.5px;font-weight:700;padding:1px 7px;line-height:1.6"></span>
        </div>
        <div id="sched-rlog-${s.id}" style="padding:2px 0">
          <div style="color:var(--text3);font-size:12px;text-align:center;padding:10px 0">
            <div class="loading" style="width:16px;height:16px;margin:0 auto 4px"></div>
            ${t("جارٍ التحميل…", "Loading…")}
          </div>
        </div>
      </div>`;

    return `<div class="mt2-dhead">
      <div class="mt2-dhead-top">
        <span class="mt2-chip-type">📋 ${esc(typeLabel)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusPill}
          <div style="position:relative">
            <button class="btn-ghost btn-sm" onclick="RowMenu.toggle('${menuId}', event)">⋮</button>
            <div class="row-menu" id="${menuId}">
              ${isDraft ? `<button onclick="RowMenu.closeAll();ScheduledPanel.editDraft(${s.id})">✏️ ${t("متابعة التحرير", "Continue Editing")}</button>` : ""}
              ${eligible && !live && !isDraft ? `<button onclick="RowMenu.closeAll();ScheduledPanel.startMeeting(${s.id})">▶ ${t("بدء الاجتماع", "Start Meeting")}</button>` : ""}
              ${!isDraft ? `<button onclick="RowMenu.closeAll();ScheduledPanel.reschedule(${s.id})">📆 ${t("إعادة جدولة", "Reschedule")}</button>` : ""}
              ${linked ? `<button onclick="RowMenu.closeAll();ScheduledPanel.openWorkspace(${linked.id})">🗃 ${t("فتح مساحة العمل", "Open Workspace")}</button>` : ""}
              <button onclick="RowMenu.closeAll();ScheduledPanel.delete(${s.id})">✕ ${t("حذف", "Delete")}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="mt2-dtitle">${esc(title)}</div>
      ${sub && sub !== title ? `<div class="mt2-dsub">${esc(sub)}</div>` : ""}
      <div class="mt2-dmeta">
        <span>📅 ${this._fmtLongDate(s.meeting_date, l)}</span>
        <span>🕐 ${this._fmtTime((s.meeting_time || "").substring(0, 5), l)}${s.meeting_time ? " – " + this._endTime(s.meeting_time, s.duration_mins, l) : ""} · ${durTxt}</span>
        ${s.platform ? `<span>📡 ${esc(platLabel(s.platform, l))}</span>` : ""}
        ${s.meeting_location ? `<span>📍 ${esc(s.meeting_location)}</span>` : ""}
        ${organizer ? `<span>👤 ${esc(organizer)}</span>` : ""}
      </div>
      ${tabs}
    </div>
    ${stepper}
    <div class="mt2-2col">${about}${quick}</div>
    ${rescheduleCard}`;
  },

  _meetingDetailHtml(m, l) {
    if (!m) return "";
    const t = (ar, en) => (l === "ar" ? ar : en);
    const title = (l === "ar" ? m.title_ar : m.title_en || m.title_ar) || "";
    const sub = (l === "ar" ? m.title_en : m.title_ar) || "";
    const typeLabel = mtLabel(m.meeting_type, l) || t("اجتماع", "Meeting");
    const ds = (m.meeting_date || m.created_at || "").substring(0, 10);
    const minutesChip =
      m.minutes_status === "approved" || m.minutes_status === "final_approved"
        ? `<span class="mt2-pill mt2-p-gold">${t("المحضر موقّع", "Minutes Signed")}</span>`
        : m.minutes_status === "circulated"
          ? `<span class="mt2-pill mt2-p-amber">${t("المحضر قيد الاعتماد", "Minutes in Approval")}</span>`
          : `<span class="mt2-pill mt2-p-gray">${t("المحضر مسودة", "Minutes Draft")}</span>`;
    const summary = ((l === "ar" ? m.ai_summary_ar : m.ai_summary_en || m.ai_summary_ar) || "").substring(0, 300);
    const pj = (x) => { try { const a = JSON.parse(x || "[]"); return Array.isArray(a) ? a.length : 0; } catch { return 0; } };
    const decN = pj(m.ai_decisions);
    const taskN = pj(m.ai_tasks);
    return `<div class="mt2-dhead">
      <div class="mt2-dhead-top">
        <span class="mt2-chip-type">📋 ${esc(typeLabel)}</span>
        ${(() => {
          const stage = m.lifecycle_stage || "created";
          const ms = m.minutes_status || "draft";
          if (stage === "archived") return `<span class="mt2-pill" style="background:rgba(130,130,130,.15);color:#888">🗄 ${t("مؤرشف","Archived")}</span>`;
          if (stage === "approval" || stage === "board_approval" || ms === "final_approved" || ms === "approved") return `<span class="mt2-pill" style="background:rgba(40,120,220,.15);color:#2878dc">✅ ${t("معتمد","Approved")}</span>`;
          if (["ai_minutes_generated","review","secretary_review","chairman_approval"].includes(stage) || ms === "circulated") return `<span class="mt2-pill mt2-p-amber">📝 ${t("المحضر قيد المراجعة","Minutes In Review")}</span>`;
          if (["transcript_generated","uploaded"].includes(stage)) return `<span class="mt2-pill mt2-p-blue">⚙️ ${t("قيد التحضير","In Preparation")}</span>`;
          if (stage === "recording") return `<span class="mt2-pill mt2-p-amber">● ${t("مباشر","Live")}</span>`;
          return `<span class="mt2-pill mt2-p-green">✓ ${t("مكتمل","Completed")}</span>`;
        })()}
      </div>
      <div class="mt2-dtitle">${esc(title)}</div>
      ${sub && sub !== title ? `<div class="mt2-dsub">${esc(sub)}</div>` : ""}
      <div class="mt2-dmeta"><span>📅 ${this._fmtLongDate(ds, l)}</span>${minutesChip}</div>
    </div>
    ${summary ? `<div class="mt2-card"><div class="mt2-card-t">${t("الملخص", "Summary")}</div><div class="mt2-sum">${esc(summary)}${summary.length >= 300 ? "…" : ""}</div></div>` : ""}
    <div class="mt2-card">
      <div class="dx2-stats">
        <div class="dx2-stat"><div class="dx2-stat-v">${decN}</div><div class="dx2-stat-l">${t("قرارات", "Decisions")}</div></div>
        <div class="dx2-stat"><div class="dx2-stat-v">${taskN}</div><div class="dx2-stat-l">${t("مهام", "Tasks")}</div></div>
        <div class="dx2-stat"><div class="dx2-stat-v">${m.duration ? Math.round((parseInt(m.duration, 10) || 0) / 60) + t(" د", "m") : "—"}</div><div class="dx2-stat-l">${t("المدة", "Duration")}</div></div>
      </div>
    </div>
    <div class="mt2-card"><div class="mt2-card-t">${t("إجراءات سريعة", "Quick Actions")}</div>
      <div class="mt2-qa">
        <button class="mt2-qa-btn" onclick="MT.openDetail(${m.id})"><span>📋 ${t("فتح صفحة الاجتماع", "Open Meeting Page")}</span><span class="mt2-chev">${l === "ar" ? "‹" : "›"}</span></button>
        <button class="mt2-qa-btn" onclick="MT.openDetail(${m.id},'minutes')"><span>📝 ${t("عرض المحضر", "View Minutes")}</span><span class="mt2-chev">${l === "ar" ? "‹" : "›"}</span></button>
        <button class="mt2-qa-btn" onclick="MT.openDetail(${m.id},'decisions')"><span>⚖️ ${t("القرارات", "Decisions")}</span><span class="mt2-chev">${l === "ar" ? "‹" : "›"}</span></button>
      </div></div>`;
  },

  openWorkspace(meetingId) {
    MT.openDetail(meetingId);
  },

  openJoinUrl(scheduleId) {
    const s = this._all.find((x) => x.id === scheduleId);
    const url = s && String(s.meeting_join_url || "").trim();
    if (!url) return;
    // Only allow real web links — never javascript:/data: etc from stored data.
    if (!/^https?:\/\//i.test(url)) {
      showToast(App.lang === "ar" ? "رابط الانضمام غير صالح" : "Invalid join link", "error");
      return;
    }
    window.open(url, "_blank", "noopener");
  },

  // Open the Create Meeting form pre-filled with a draft's data so the user
  // can complete and confirm it (or re-save as draft).
  // Fetches and renders the reschedule history for a schedule item into the
  // placeholder div injected by _schedDetailHtml.
  async _loadRescheduleLog(scheduleId) {
    const l = App.lang;
    const t = (ar, en) => l === "ar" ? ar : en;
    const container = document.getElementById(`sched-rlog-${scheduleId}`);
    if (!container) return;
    try {
      const log = await api(`/api/schedule/${scheduleId}/reschedule-log`);
      const badge = document.getElementById(`sched-rlog-badge-${scheduleId}`);
      if (badge) {
        if (log.length) { badge.textContent = log.length; badge.style.display = ""; }
        else { badge.style.display = "none"; }
      }
      if (!log.length) {
        container.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;padding:10px 0">${t("لا توجد إعادة جدولة سابقة", "No reschedule history yet")}</div>`;
        return;
      }
      container.innerHTML = log.map((r, i) => {
        const oldDT = [r.old_date, r.old_time].filter(Boolean).join(" ").trim();
        const newDT = [r.new_date, r.new_time].filter(Boolean).join(" ").trim();
        const when = (r.created_at || "").substring(0, 16).replace("T", " ");
        return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;${i < log.length - 1 ? "border-bottom:1px solid var(--border,#eee)" : ""}">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--amber-bg,#FFF8E7);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">📆</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:600">${esc(r.actor_name || "—")}</div>
            ${r.actor_role ? `<div style="font-size:11px;color:var(--text3)">${esc(r.actor_role)}</div>` : ""}
            <div style="font-size:12px;margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="color:var(--red,#c0392b);text-decoration:line-through">${esc(oldDT || "—")}</span>
              <span style="color:var(--text3)">→</span>
              <span style="color:var(--green,#1a7f4b);font-weight:600">${esc(newDT || "—")}</span>
            </div>
            ${r.reason ? `<div style="font-size:11.5px;color:var(--text3);margin-top:3px">📝 ${esc(r.reason)}</div>` : ""}
            <div style="font-size:10.5px;color:var(--text4,#aaa);margin-top:3px">${when}</div>
          </div>
        </div>`;
      }).join("");
    } catch (_) {
      const container2 = document.getElementById(`sched-rlog-${scheduleId}`);
      if (container2) container2.innerHTML = "";
    }
  },

  async editDraft(scheduleId) {
    if (window.MT) {
      MT.editDraft(scheduleId);
    } else {
      // Fallback: use the quick schedule form
      Panels.load("scheduled");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Schedule.edit(scheduleId);
      const el = $("nm-form-title");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  },

  async reschedule(scheduleId) {
    const l = App.lang;
    const t = (ar, en) => l === "ar" ? ar : en;
    let s = this._all.find((x) => x.id === scheduleId);
    if (!s) {
      try { s = await api(`/api/schedule/${scheduleId}`); } catch (_) {}
    }
    if (!s) { showToast(t("تعذّر تحميل بيانات الاجتماع", "Could not load meeting data"), "error"); return; }
    const existing = document.getElementById("reschedule-modal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "reschedule-modal";
    modal.className = "modal-overlay open";
    modal.innerHTML = `
      <div class="modal-box" style="max-width:420px">
        <div class="modal-header">
          <span>📆 ${t("إعادة جدولة الاجتماع", "Reschedule Meeting")}</span>
          <button class="modal-close" onclick="document.getElementById('reschedule-modal').remove()">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:13px;color:var(--text3)">${esc((l === "ar" ? s.title_ar : s.title_en || s.title_ar) || "")}</div>
          <div class="frow">
            <label class="fl">${t("التاريخ الجديد", "New Date")}</label>
            <input class="fi" id="rs-date" type="date" value="${s.meeting_date || ""}" />
          </div>
          <div class="frow">
            <label class="fl">${t("الوقت الجديد", "New Time")}</label>
            <input class="fi" id="rs-time" type="time" value="${(s.meeting_time || "").substring(0,5)}" />
          </div>
          <div class="frow">
            <label class="fl">${t("ملاحظة", "Note")}</label>
            <input class="fi" id="rs-note" type="text" placeholder="${t("سبب إعادة الجدولة...", "Reason for rescheduling...")}" />
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn-ghost" onclick="document.getElementById('reschedule-modal').remove()">${t("إلغاء", "Cancel")}</button>
          <button class="btn-gold" id="rs-confirm-btn" onclick="ScheduledPanel._confirmReschedule(${scheduleId})">${t("تأكيد إعادة الجدولة", "Confirm Reschedule")}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  },

  async _confirmReschedule(scheduleId) {
    const l = App.lang;
    let s = this._all.find((x) => x.id === scheduleId);
    if (!s) {
      try { s = await api(`/api/schedule/${scheduleId}`); } catch (_) {}
    }
    if (!s) return;
    const newDate = (document.getElementById("rs-date") || {}).value || "";
    const newTime = (document.getElementById("rs-time") || {}).value || "";
    const note = (document.getElementById("rs-note") || {}).value || "";
    if (!newDate) { showToast(l === "ar" ? "يرجى تحديد التاريخ الجديد" : "Please set the new date", "error"); return; }
    const btn = document.getElementById("rs-confirm-btn");
    if (btn) { btn.disabled = true; btn.textContent = l === "ar" ? "جارٍ الحفظ…" : "Saving…"; }
    try {
      await api(`/api/schedule/${scheduleId}`, {
        method: "PATCH",
        body: JSON.stringify({ meeting_date: newDate, meeting_time: newTime || s.meeting_time, note }),
      });
      if (s.source_meeting_id) {
        await api(`/api/meetings/${s.source_meeting_id}`, {
          method: "PATCH",
          body: JSON.stringify({ meeting_date: newDate }),
        });
      }
      showToast(l === "ar" ? "تمت إعادة الجدولة بنجاح" : "Meeting rescheduled successfully", "success");
      document.getElementById("reschedule-modal")?.remove();
      await this.refresh();
    } catch (e) {
      showToast(e.message || (l === "ar" ? "فشل في إعادة الجدولة" : "Reschedule failed"), "error");
      if (btn) { btn.disabled = false; btn.textContent = l === "ar" ? "تأكيد إعادة الجدولة" : "Confirm Reschedule"; }
    }
  },

  async startMeeting(scheduleId) {
    const l = App.lang;
    const s = this._all.find((x) => x.id === scheduleId);
    if (!s) return;
    try {
      let meetingId = s.source_meeting_id;
      if (!meetingId) {
        const meeting = await api("/api/meetings", {
          method: "POST",
          body: JSON.stringify({
            title_ar: s.title_ar,
            title_en: s.title_en || s.title_ar,
            meeting_type: s.meeting_type || "",
            board_id: s.board_id || null,
            committee_id: s.committee_id || null,
            platform: s.platform || "",
          }),
        });
        meetingId = meeting.id;
        await api(`/api/schedule/${scheduleId}`, { method: "PATCH", body: JSON.stringify({ source_meeting_id: meetingId }) });
        s.source_meeting_id = meetingId;
      }
      // Navigate to the live meeting workspace — the Start Modal inside the Live tab
      // handles recording selection (with/without) before actually starting.
      await enterLiveMeeting(meetingId);
    } catch (e) {
      showToast((l === "ar" ? "تعذّر بدء الاجتماع: " : "Could not start meeting: ") + e.message, "error");
    }
  },

  async delete(id) {
    const l = App.lang;
    if (!confirm(l === "ar" ? "حذف هذا الاجتماع من الجدول؟" : "Remove this meeting from the schedule?")) return;
    try {
      await api(`/api/schedule/${id}`, { method: "DELETE" });
      await this.refresh();
      showToast(l === "ar" ? "✓ تم الحذف" : "✓ Deleted");
    } catch (e) {
      showToast((l === "ar" ? "تعذّر الحذف: " : "Could not delete: ") + e.message, "error");
    }
  },
};

// ══ Live Meetings (Phase 1 redesign) ════════════════════════════════════════
// Shows every meeting currently in lifecycle_stage 'recording' as a prominent
// card with a live elapsed timer, plus a discoverable way to start an ad-hoc
// (unscheduled) meeting now that "Record Meeting" is no longer in the sidebar.
const LiveMeetingsPanel = {
  _timer: null,
  _meetings: [],

  async refresh() {
    const box = $("lm-list");
    if (box) box.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const meetings = await api("/api/meetings");
      this._meetings = meetings.filter((m) => m.lifecycle_stage === "recording");
      this.render();
      this._startTimer();
    } catch (e) {
      if (box) box.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },

  _startTimer() {
    this.stopTimer();
    if (!this._meetings.length) return;
    this._timer = setInterval(() => this._tickElapsed(), 1000);
  },
  // Mirrors how Rec clears its own timerInt on stop() — called by Panels.load
  // whenever the user navigates away from 'live' so the interval doesn't keep
  // ticking (and touching detached DOM) in the background.
  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  _elapsed(startedAt) {
    if (!startedAt) return "00:00";
    const iso = startedAt.includes("T") ? startedAt : startedAt.replace(" ", "T") + "Z";
    const start = new Date(iso).getTime();
    let secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const hh = Math.floor(secs / 3600); secs %= 3600;
    const mm = Math.floor(secs / 60); const ss = secs % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  },
  _tickElapsed() {
    this._meetings.forEach((m) => {
      const el = $(`lm-elapsed-${m.id}`);
      if (el) el.textContent = this._elapsed(m.recording_started_at);
    });
  },

  render() {
    const l = App.lang;
    const box = $("lm-list");
    if (!box) return;
    if (!this._meetings.length) {
      box.innerHTML = emptyStateCard({
        icon: "🔴",
        titleAr: "لا توجد اجتماعات مباشرة حالياً", titleEn: "No meetings are live right now",
        descAr: "ابدأ اجتماعاً فورياً، أو افتح الاجتماعات المجدولة لبدء اجتماع مجدول", descEn: "Start an ad-hoc meeting, or open Scheduled to start a planned one",
        primary: { ar: "🎙 اجتماع فوري", en: "🎙 Start Ad-hoc Meeting", onclick: "Panels.load('record')" },
        secondary: { ar: "الاجتماعات المجدولة", en: "Scheduled", onclick: "Panels.load('scheduled')" },
      });
      return;
    }
    box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">` +
      this._meetings.map((m) => this._cardHtml(m, l)).join("") + `</div>`;
  },

  _cardHtml(m, l) {
    const title = l === "ar" ? m.title_ar : m.title_en || m.title_ar;
    const boardOrCommittee = (l === "ar" ? (m.board_name_ar || m.committee_name_ar) : (m.board_name_en || m.board_name_ar || m.committee_name_en || m.committee_name_ar)) || "";
    const organizer = (l === "ar" ? m.recorder_ar : m.recorder_en || m.recorder_ar) || "";
    const qKey = `lm-quorum-${m.id}`;
    // Fetch quorum data for this meeting (non-blocking)
    api(`/api/gov/quorum?meetingId=${m.id}`).then(q => {
      const el = $(qKey);
      if (!el || !q) return;
      const present = q.present_members || 0;
      const required = q.required_members || 0;
      const achieved = q.quorum_achieved || present >= required;
      const color = achieved ? "#10B981" : present >= Math.ceil(required * 0.7) ? "#F59E0B" : "#EF4444";
      el.innerHTML = `<span style="color:${color};font-weight:700">${present}/${required}</span>
        <span style="font-size:10px;color:${color}">${achieved ? (l==="ar"?"✓ اكتمل النصاب":"✓ Quorum Met") : (l==="ar"?"✗ النصاب غير مكتمل":"✗ No Quorum")}</span>
        <button onclick="LiveMeetingsPanel.updateQuorum(${m.id},${present},${required})" style="font-size:10px;background:none;border:1px solid ${color}44;color:${color};border-radius:4px;padding:1px 6px;cursor:pointer;margin-inline-start:4px">${l==="ar"?"تحديث":"Update"}</button>`;
    }).catch(() => {});
    return `<div class="card card-gold" style="padding:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="live-badge-pulse"></span>
        <span style="font-size:11px;font-weight:800;color:var(--red);letter-spacing:.05em">${l === "ar" ? "مباشر" : "LIVE"}</span>
        <span style="margin-inline-start:auto;font-variant-numeric:tabular-nums;font-weight:700;color:var(--text)" id="lm-elapsed-${m.id}">${this._elapsed(m.recording_started_at)}</span>
      </div>
      <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px">${esc(title)}</div>
      <div style="font-size:11.5px;color:var(--text3);display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        ${boardOrCommittee ? `<span>🏛 ${esc(boardOrCommittee)}</span>` : ""}
        ${organizer ? `<span>👤 ${esc(organizer)}</span>` : ""}
      </div>
      <div id="${qKey}" style="display:flex;align-items:center;gap:6px;font-size:12px;padding:6px 10px;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:10px;min-height:28px">
        <span style="color:var(--text3);font-size:11px">${l === "ar" ? "النصاب القانوني:" : "Quorum:"}</span>
        <span style="color:var(--text3);font-size:11px">${l === "ar" ? "جارٍ التحقق..." : "Checking..."}</span>
      </div>
      <button class="btn-gold" style="width:100%;justify-content:center" onclick="enterLiveMeeting(${m.id})">▶ ${l === "ar" ? "انضمام" : "Open / Join"}</button>
    </div>`;
  },

  async updateQuorum(meetingId, currentPresent, required) {
    const l = App.lang;
    const newPresent = parseInt(prompt(l === "ar" ? `عدد الحاضرين (النصاب المطلوب: ${required}):` : `Number of members present (required: ${required}):`, String(currentPresent)), 10);
    if (isNaN(newPresent) || newPresent < 0) return;
    try {
      await api("/api/gov/quorum", { method: "PUT", body: JSON.stringify({
        meeting_id: meetingId,
        present_members: newPresent,
        required_members: required || newPresent,
        quorum_achieved: newPresent >= (required || newPresent) ? 1 : 0,
      })});
      await this.refresh();
    } catch (e) { showToast(e.message, "error"); }
  },
};

// ══ Meeting Workspace (Phase 2 redesign) ═══════════════════════════════════
// WorkspacePanel removed — all "open meeting" deep-links now use MT.openDetail().

// ══ Master Calendar (Phase T) — month grid over the Schedule panel, color-
// coded by meeting type + Executive Actions due, click any item to jump to
// its correct workspace (Meeting Workspace / Governance / Executive Actions).
const MasterCalendar = {
  _offset: 0,
  _selectedDay: null,

  getView() {
    return localStorage.getItem("sched_view") || "list";
  },
  setView(v) {
    localStorage.setItem("sched_view", v);
    this._selectedDay = null;
    renderSchedule();
  },
  nav(delta) {
    this._offset += delta;
    this._selectedDay = null;
    renderSchedule();
  },
  selectDay(dateStr) {
    this._selectedDay = this._selectedDay === dateStr ? null : dateStr;
    renderSchedule();
  },

  openAction(id) {
    Tasks.edit(id);
  },
  openItem(kind, id) {
    if (kind === "held") {
      Panels.load("scheduled").then(() => setTimeout(() => MT.openDetail(id), 300));
      return;
    }
    const item = (App.scheduleCache || []).find((s) => s.id === id);
    if (!item) return;
    if (item.meeting_type === "general_assembly") {
      Panels.load("governance").then(() => {
        const tryOpen = (attempts) => {
          if (document.getElementById("gov-sel")) { Gov._selectGA(id); return; }
          if (attempts > 0) setTimeout(() => tryOpen(attempts - 1), 200);
        };
        tryOpen(15);
      });
    } else if (item.source_meeting_id) {
      Panels.load("scheduled").then(() => setTimeout(() => MT.openDetail(item.source_meeting_id), 300));
    } else {
      Panels.load("scheduled").then(() => setTimeout(() => ScheduledPanel.select("sched", id), 300));
    }
  },

  render(scheduleItems, heldMeetings, tasks, l) {
    const wrap = $("sched-calendar");
    if (!wrap) return;
    const today = new Date().toISOString().substring(0, 10);
    const calBase = new Date();
    calBase.setDate(1);
    calBase.setMonth(calBase.getMonth() + this._offset);
    const calYear = calBase.getFullYear();
    const calMonthIdx = calBase.getMonth();
    const startWeekday = new Date(calYear, calMonthIdx, 1).getDay();
    const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
    const monthLabel = calBase.toLocaleDateString(l === "ar" ? "ar-SA-u-ca-gregory" : "en-US", { month: "long", year: "numeric" });
    const weekDayNames = l === "ar" ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const byDate = {};
    scheduleItems.forEach((s) => {
      const d = (s.meeting_date || "").substring(0, 10);
      if (!d) return;
      (byDate[d] = byDate[d] || []).push({ ...s, kind: "meeting", _kind: "schedule" });
    });
    // Held meetings (recorded/AI-processed) already linked to a schedule row
    // via source_meeting_id are represented by that row — skip to avoid a
    // duplicate dot for the same real-world meeting.
    const linkedHeldIds = new Set(scheduleItems.filter((s) => s.source_meeting_id).map((s) => s.source_meeting_id));
    heldMeetings.forEach((m) => {
      if (linkedHeldIds.has(m.id)) return;
      const d = (m.meeting_date || "").substring(0, 10);
      if (!d) return;
      (byDate[d] = byDate[d] || []).push({ ...m, kind: "meeting", _kind: "held" });
    });
    tasks.forEach((t) => {
      if (!t.due_date || ["done", "cancelled"].includes(t.status)) return;
      (byDate[t.due_date] = byDate[t.due_date] || []).push({ ...t, kind: "action" });
    });

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayItems = byDate[dateStr] || [];
      const isToday = dateStr === today;
      const isSelected = this._selectedDay === dateStr;
      cells += `<div class="cal-cell ${isToday ? "cal-today" : ""} ${isSelected ? "cal-selected" : ""}" onclick="MasterCalendar.selectDay('${dateStr}')" tabindex="0" role="button" aria-label="${dateStr}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();MasterCalendar.selectDay('${dateStr}')}">
        <div class="cal-daynum">${d}</div>
        ${dayItems.length ? `<div class="cal-dots">
          ${dayItems.slice(0, 4).map((it) => it.kind === "action"
            ? `<div class="cal-dot" style="background:var(--red);border-radius:2px" title="${esc(l === "ar" ? "إجراء مستحق" : "Action due")}: ${esc(l === "ar" ? it.text_ar : it.text_en || it.text_ar)}"></div>`
            : `<div class="cal-dot" style="background:${calTypeColor(it.meeting_type)};${it.series_id ? "box-shadow:0 0 0 1.5px var(--gold)" : ""}" title="${esc(l === "ar" ? it.title_ar : it.title_en || it.title_ar)}"></div>`
          ).join("")}
          ${dayItems.length > 4 ? `<div class="cal-more">+${dayItems.length - 4}</div>` : ""}
        </div>` : ""}
      </div>`;
    }

    const selectedItems = this._selectedDay ? (byDate[this._selectedDay] || []) : [];
    const legend = [
      { c: CAL_TYPE_COLORS["Board Meeting"], ar: "مجلس الإدارة", en: "Board Meeting" },
      { c: CAL_TYPE_COLORS["Committee Meeting"], ar: "اللجان", en: "Committee" },
      { c: CAL_TYPE_COLORS["Executive Meeting"], ar: "تنفيذي", en: "Executive" },
      { c: CAL_TYPE_COLORS["Strategy Meeting"], ar: "استراتيجية", en: "Strategy" },
      { c: CAL_TYPE_COLORS["Follow-up Meeting"], ar: "متابعة", en: "Follow-up" },
      { c: CAL_TYPE_COLORS.general_assembly, ar: "الجمعية العمومية", en: "General Assembly" },
      { c: "var(--red)", ar: "إجراء مستحق", en: "Action Due", square: true },
    ];

    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <button class="btn-ghost btn-sm" onclick="MasterCalendar.nav(-1)">◀</button>
        <div style="font-weight:700;font-size:13.5px">${esc(monthLabel)}</div>
        <button class="btn-ghost btn-sm" onclick="MasterCalendar.nav(1)">▶</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        ${legend.map((g) => `<div style="display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--text3)"><span style="display:inline-block;width:8px;height:8px;${g.square ? "border-radius:2px" : "border-radius:50%"};background:${g.c}"></span>${l === "ar" ? g.ar : g.en}</div>`).join("")}
        <div style="display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--text3)"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--navy4);box-shadow:0 0 0 1.5px var(--gold)"></span>${l === "ar" ? "ضمن سلسلة" : "Part of a series"}</div>
      </div>
      <div class="cal-grid cal-grid-head">${weekDayNames.map((w) => `<div class="cal-headcell">${w}</div>`).join("")}</div>
      <div class="cal-grid">${cells}</div>
      ${this._selectedDay ? `<div class="card" style="margin-top:14px">
        <div class="ch" style="margin-bottom:6px">
          <div class="ct">📌 ${esc(this._selectedDay)}</div>
          <span class="tag" style="background:var(--navy4)">${selectedItems.length}</span>
        </div>
        ${selectedItems.length ? selectedItems.map((it) => {
          if (it.kind === "action") {
            return `<div class="trow" style="border-inline-start:3px solid var(--red);padding-inline-start:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div style="min-width:0">
                <div style="font-size:12.5px;font-weight:600;color:var(--text)">${esc(l === "ar" ? it.text_ar : it.text_en || it.text_ar)}</div>
                <div style="font-size:11px;color:var(--text3)">🎯 ${l === "ar" ? "إجراء تنفيذي مستحق" : "Executive Action due"}</div>
              </div>
              <button class="btn-ghost btn-sm" onclick="MasterCalendar.openAction(${it.id})">${l === "ar" ? "عرض" : "View"}</button>
            </div>`;
          }
          const title = l === "ar" ? it.title_ar : it.title_en || it.title_ar;
          const isGA = it.meeting_type === "general_assembly";
          const isHeld = it._kind === "held" || !!it.source_meeting_id;
          return `<div class="trow" style="border-inline-start:3px solid ${calTypeColor(it.meeting_type)};padding-inline-start:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="min-width:0">
              <div style="font-size:12.5px;font-weight:600;color:var(--text)">${esc(title)}</div>
              <div style="font-size:11px;color:var(--text3);display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <span>${esc(mtLabel(it.meeting_type, l))}</span>
                ${it.meeting_time ? `<span>🕐 ${esc(it.meeting_time)}</span>` : ""}
                ${it.series_name_ar ? `<span class="tag" style="background:var(--navy4);font-size:10.5px">🔗 ${esc(l === "ar" ? it.series_name_ar : it.series_name_en || it.series_name_ar)}</span>` : ""}
              </div>
            </div>
            <button class="btn-ghost btn-sm" onclick="MasterCalendar.openItem('${it._kind}', ${it.id})">${isGA ? (l === "ar" ? "فتح الجمعية" : "Open GA") : isHeld ? (l === "ar" ? "فتح الاجتماع" : "Open Meeting") : (l === "ar" ? "تعديل" : "Edit")}</button>
          </div>`;
        }).join("") : `<div style="text-align:center;padding:16px"><div style="font-size:12px;color:var(--text3)">${l === "ar" ? "لا عناصر هذا اليوم" : "No items this day"}</div></div>`}
      </div>` : ""}
    `;
  },
};

// ══ CalendarPanel — Google Calendar–style view (Day / Week / Month) ══════════
const CalendarPanel = {
  _offset: 0,
  _view: "month",
  _cache: { schedule: [], meetings: [], tasks: [] },
  _HP: 64, // pixels per hour in time-grid views

  async refresh() {
    const el = $("cal-panel-body");
    if (el) el.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [schedule, meetings, tasks] = await Promise.all([
        api("/api/schedule"), api("/api/meetings"), api("/api/tasks"),
      ]);
      this._cache = { schedule, meetings, tasks };
      this.render();
    } catch (e) {
      if (el) el.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
    }
  },

  _buildByDate() {
    const byDate = {};
    const { schedule, meetings, tasks } = this._cache;
    schedule.forEach((s) => {
      const d = (s.meeting_date || "").substring(0, 10);
      if (d) (byDate[d] = byDate[d] || []).push({ ...s, _kind: "schedule", _color: calTypeColor(s.meeting_type) });
    });
    const linkedIds = new Set(schedule.filter((s) => s.source_meeting_id).map((s) => s.source_meeting_id));
    meetings.forEach((m) => {
      if (linkedIds.has(m.id)) return;
      const d = (m.meeting_date || "").substring(0, 10);
      const liveStages = ["recording", "uploaded", "ai_minutes_generated", "review", "approval", "archived"];
      if (d && liveStages.includes(m.lifecycle_stage))
        (byDate[d] = byDate[d] || []).push({ ...m, _kind: "held", _color: calTypeColor(m.meeting_type) });
    });
    tasks.forEach((tk) => {
      if (!tk.due_date || ["done", "cancelled"].includes(tk.status)) return;
      (byDate[tk.due_date] = byDate[tk.due_date] || []).push({ ...tk, _kind: "task", _color: "#E55A5A" });
    });
    return byDate;
  },

  _weekDays(l) {
    return l === "ar"
      ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  },

  _header(label, l, t) {
    const views = [
      { v: "day",   ar: "يوم",    en: "Day" },
      { v: "week",  ar: "أسبوع",  en: "Week" },
      { v: "month", ar: "شهر",    en: "Month" },
    ];
    return `<div class="gcal-hdr">
      <div class="gcal-hdr-left">
        <button class="gcal-today-btn" onclick="CalendarPanel._goToday()">${t("اليوم", "Today")}</button>
        <div class="gcal-nav-group">
          <button class="gcal-nav-btn" onclick="CalendarPanel._nav(-1)">&#8249;</button>
          <button class="gcal-nav-btn" onclick="CalendarPanel._nav(1)">&#8250;</button>
        </div>
        <div class="gcal-date-label">${esc(label)}</div>
      </div>
      <div class="gcal-view-toggle">
        ${views.map((v) => `<button class="gcal-view-btn${this._view === v.v ? " active" : ""}" onclick="CalendarPanel._setView('${v.v}')">${l === "ar" ? v.ar : v.en}</button>`).join("")}
      </div>
    </div>`;
  },

  render() {
    const el = $("cal-panel-body");
    if (!el) return;
    const l = App.lang;
    const t = (ar, en) => l === "ar" ? ar : en;
    const today = new Date();
    const todayStr = today.toISOString().substring(0, 10);
    const byDate = this._buildByDate();
    if (this._view === "week") this._renderWeek(el, byDate, todayStr, today, l, t);
    else if (this._view === "day") this._renderDay(el, byDate, todayStr, today, l, t);
    else this._renderMonth(el, byDate, todayStr, today, l, t);
  },

  _renderMonth(el, byDate, todayStr, today, l, t) {
    const base = new Date(today.getFullYear(), today.getMonth() + this._offset, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const label = base.toLocaleDateString(l === "ar" ? "ar-SA-u-ca-gregory" : "en-US", { month: "long", year: "numeric" });
    const weekDays = this._weekDays(l);

    // Sort helper — all-day first, then by time
    const sortItems = (arr) => {
      const allDay = arr.filter((it) => !it.meeting_time);
      const timed = arr.filter((it) => !!it.meeting_time).sort((a, b) => (a.meeting_time || "").localeCompare(b.meeting_time || ""));
      return [...allDay, ...timed];
    };

    const renderCellEvents = (items, ds) => {
      const sorted = sortItems(items);
      const MAX = 3;
      const visible = sorted.slice(0, MAX);
      const more = sorted.length - MAX;
      const chips = visible.map((it) => {
        const name = it._kind === "task"
          ? (l === "ar" ? it.text_ar : it.text_en || it.text_ar)
          : (l === "ar" ? it.title_ar : it.title_en || it.title_ar);
        const isAllDay = !it.meeting_time;
        if (isAllDay) {
          // Full-width solid bar — exactly like Google Calendar all-day events
          return `<div class="gcal-mbar" style="background:${it._color}" onclick="CalendarPanel._popup(event,'${it._kind}',${it.id})" title="${esc(name)}">${esc(name)}</div>`;
        } else {
          // Dot + time + title — exactly like Google Calendar timed events
          const time = it.meeting_time.substring(0, 5);
          return `<div class="gcal-mrow" onclick="CalendarPanel._popup(event,'${it._kind}',${it.id})" title="${esc(name)}">
            <span class="gcal-mdot" style="background:${it._color}"></span>
            <span class="gcal-mrow-time">${esc(time)}</span>
            <span class="gcal-mrow-name">${esc(name)}</span>
          </div>`;
        }
      }).join("");
      const moreHtml = more > 0
        ? `<div class="gcal-mmore" onclick="CalendarPanel._dayClick('${ds}')">+${more} ${t("أكثر", "more")}</div>`
        : "";
      return chips + moreHtml;
    };

    let cells = "";
    for (let i = 0; i < firstWeekday; i++) {
      const d = daysInPrevMonth - firstWeekday + 1 + i;
      cells += `<div class="gcal-mcell gcal-other"><div class="gcal-mday gcal-mday-other">${d}</div></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const items = byDate[ds] || [];
      const isToday = ds === todayStr;
      cells += `<div class="gcal-mcell${isToday ? " gcal-mtoday" : ""}">
        <div class="gcal-mday-wrap">
          <span class="gcal-mday${isToday ? " gcal-mday-today" : ""}" onclick="CalendarPanel._dayClick('${ds}')">${d}</span>
        </div>
        ${renderCellEvents(items, ds)}
      </div>`;
    }
    const totalCells = firstWeekday + daysInMonth;
    const nextFill = totalCells % 7 ? 7 - (totalCells % 7) : 0;
    for (let d = 1; d <= nextFill; d++) {
      cells += `<div class="gcal-mcell gcal-other"><div class="gcal-mday gcal-mday-other">${d}</div></div>`;
    }

    el.innerHTML = `<div class="gcal-wrap">
      ${this._header(label, l, t)}
      <div class="gcal-month-view">
        <div class="gcal-month-head">${weekDays.map((w) => `<div class="gcal-month-headcell">${w}</div>`).join("")}</div>
        <div class="gcal-month-grid">${cells}</div>
      </div>
    </div>`;
  },

  _renderWeek(el, byDate, todayStr, today, l, t) {
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek + this._offset * 7);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
    const loc = l === "ar" ? "ar-SA-u-ca-gregory" : "en-US";
    const startLabel = days[0].toLocaleDateString(loc, { month: "short", day: "numeric" });
    const endLabel = days[6].toLocaleDateString(loc, { month: "short", day: "numeric", year: "numeric" });
    const label = `${startLabel} – ${endLabel}`;

    el.innerHTML = `<div class="gcal-wrap">
      ${this._header(label, l, t)}
      <div class="gcal-time-view">${this._timeGrid(days, byDate, todayStr, l, t)}</div>
    </div>`;
    this._scrollToNow();
  },

  _renderDay(el, byDate, todayStr, today, l, t) {
    const day = new Date(today);
    day.setDate(today.getDate() + this._offset);
    const loc = l === "ar" ? "ar-SA-u-ca-gregory" : "en-US";
    const label = day.toLocaleDateString(loc, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    el.innerHTML = `<div class="gcal-wrap">
      ${this._header(label, l, t)}
      <div class="gcal-time-view">${this._timeGrid([day], byDate, todayStr, l, t)}</div>
    </div>`;
    this._scrollToNow();
  },

  _timeGrid(days, byDate, todayStr, l, t) {
    const HP = this._HP;
    const nowDate = new Date();
    const nowDs = nowDate.toISOString().substring(0, 10);
    const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();
    const loc = l === "ar" ? "ar-SA-u-ca-gregory" : "en-US";

    // Column headers
    const headCols = days.map((d) => {
      const ds = d.toISOString().substring(0, 10);
      const isToday = ds === todayStr;
      const dn = d.toLocaleDateString(loc, { weekday: "short" });
      const num = d.getDate();
      return `<div class="gcal-tcol-head${isToday ? " gcal-today-head" : ""}">
        <span class="gcal-tcol-dn">${dn}</span>
        <span class="gcal-tcol-num${isToday ? " gcal-num-today" : ""}" onclick="CalendarPanel._dayClick('${ds}')">${num}</span>
      </div>`;
    }).join("");

    // All-day row
    const allDayCols = days.map((d) => {
      const ds = d.toISOString().substring(0, 10);
      const items = (byDate[ds] || []).filter((it) => !it.meeting_time);
      return `<div class="gcal-allday-col">
        ${items.map((it) => {
          const name = it._kind === "task"
            ? (l === "ar" ? it.text_ar : it.text_en || it.text_ar)
            : (l === "ar" ? it.title_ar : it.title_en || it.title_ar);
          return `<div class="gcal-allday-chip" style="background:${it._color}" onclick="CalendarPanel._popup(event,'${it._kind}',${it.id})">${esc(name)}</div>`;
        }).join("")}
      </div>`;
    }).join("");

    // Hour gutter
    let gutter = "";
    for (let h = 0; h < 24; h++) {
      gutter += `<div class="gcal-ghour" style="height:${HP}px"><span>${h === 0 ? "" : (h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`)}</span></div>`;
    }

    // Day event columns
    const eventCols = days.map((d) => {
      const ds = d.toISOString().substring(0, 10);
      const isToday = ds === nowDs;
      const timedItems = (byDate[ds] || []).filter((it) => !!it.meeting_time);
      const laid = this._layout(timedItems, HP);

      const hlines = Array.from({ length: 24 }, (_, h) =>
        `<div class="gcal-hline${h === 0 ? " gcal-hline-top" : ""}" style="top:${h * HP}px"></div>`
      ).join("");
      const halfLines = Array.from({ length: 24 }, (_, h) =>
        `<div class="gcal-half-line" style="top:${h * HP + HP / 2}px"></div>`
      ).join("");
      const nowLine = isToday
        ? `<div class="gcal-now-line" style="top:${(nowMins / 60) * HP}px"><div class="gcal-now-dot"></div></div>`
        : "";

      const evHtml = laid.map((it) => {
        const name = it._kind === "task"
          ? (l === "ar" ? it.text_ar : it.text_en || it.text_ar)
          : (l === "ar" ? it.title_ar : it.title_en || it.title_ar);
        const dur = it.duration_mins || 60;
        const [hh, mm] = (it.meeting_time || "00:00").split(":").map(Number);
        const startMins = hh * 60 + mm;
        const top = (startMins / 60) * HP;
        const height = Math.max(22, (dur / 60) * HP - 3);
        const left = `${it._col * (100 / it._total)}%`;
        const width = `calc(${100 / it._total}% - 3px)`;
        const timeStr = it.meeting_time.substring(0, 5);
        const endStr = new Date(0, 0, 0, hh, mm + dur).toTimeString().substring(0, 5);
        return `<div class="gcal-ev" style="top:${top}px;height:${height}px;left:${left};width:${width};background:${it._color}22;border-inline-start:3px solid ${it._color};color:${it._color}" onclick="CalendarPanel._popup(event,'${it._kind}',${it.id})">
          <div class="gcal-ev-title">${esc(name)}</div>
          ${height > 32 ? `<div class="gcal-ev-time">${timeStr} – ${endStr}</div>` : ""}
        </div>`;
      }).join("");

      return `<div class="gcal-day-col${isToday ? " gcal-today-col" : ""}" style="height:${24 * HP}px">
        ${hlines}${halfLines}${nowLine}${evHtml}
      </div>`;
    }).join("");

    return `<div class="gcal-tgrid">
      <div class="gcal-tgrid-head">
        <div class="gcal-gutter-corner"></div>
        <div class="gcal-tcols-head">${headCols}</div>
      </div>
      <div class="gcal-allday-strip">
        <div class="gcal-allday-label">${t("طوال اليوم", "all-day")}</div>
        <div class="gcal-allday-cols">${allDayCols}</div>
      </div>
      <div class="gcal-scroll" id="gcal-scroll">
        <div class="gcal-gutter">${gutter}</div>
        <div class="gcal-ecols">${eventCols}</div>
      </div>
    </div>`;
  },

  _layout(items, HP) {
    const parsed = items.map((it) => {
      const [h, m] = (it.meeting_time || "00:00").split(":").map(Number);
      const start = h * 60 + m;
      const end = start + (it.duration_mins || 60);
      return { ...it, _s: start, _e: end };
    }).sort((a, b) => a._s - b._s);

    const cols = [];
    parsed.forEach((ev) => {
      let c = cols.findIndex((endTime) => endTime <= ev._s);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = ev._e;
      ev._col = c;
    });
    parsed.forEach((ev) => {
      const overlaps = parsed.filter((o) => o._s < ev._e && o._e > ev._s);
      ev._total = Math.max(...overlaps.map((o) => o._col + 1));
    });
    return parsed;
  },

  _scrollToNow() {
    setTimeout(() => {
      const el = $("gcal-scroll");
      if (!el) return;
      const now = new Date();
      const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * this._HP - 100;
      el.scrollTop = Math.max(0, top);
    }, 40);
  },

  _nav(delta) { this._offset += delta; this.render(); },
  _goToday() { this._offset = 0; this.render(); },
  _setView(v) { this._view = v; this._offset = 0; this.render(); },
  _dayClick(ds) {
    const target = new Date(ds + "T12:00:00");
    const today = new Date();
    this._view = "day";
    this._offset = Math.round((target - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    this.render();
  },

  _popup(event, kind, id) {
    event.stopPropagation();
    const l = App.lang;
    const t = (ar, en) => l === "ar" ? ar : en;
    let item = null;
    if (kind === "schedule") item = this._cache.schedule.find((s) => s.id === id);
    else if (kind === "held") item = this._cache.meetings.find((m) => m.id === id);
    else if (kind === "task") item = this._cache.tasks.find((tk) => tk.id === id);
    if (!item) return;

    document.getElementById("gcal-popup")?.remove();
    const el = document.createElement("div");
    el.id = "gcal-popup";
    el.className = "gcal-popup";

    if (kind === "task") {
      const name = l === "ar" ? item.text_ar : item.text_en || item.text_ar;
      el.innerHTML = `<button class="gcal-popup-close" onclick="document.getElementById('gcal-popup').remove()">✕</button>
        <div class="gcal-popup-title">🎯 ${esc(name)}</div>
        <div class="gcal-popup-row">📅 ${t("استحقاق: ", "Due: ")}${item.due_date || "—"}</div>
        <div class="gcal-popup-row">🏷 ${item.priority || "normal"}</div>
        <div style="margin-top:12px"><button class="btn-gold btn-sm" onclick="Tasks.edit(${id});document.getElementById('gcal-popup').remove()">${t("فتح المهمة", "Open Task")}</button></div>`;
    } else {
      const name = l === "ar" ? item.title_ar : item.title_en || item.title_ar;
      const color = calTypeColor(item.meeting_type);
      const isHeld = kind === "held";
      const boardName = l === "ar" ? item.board_name_ar : item.board_name_en || item.board_name_ar;
      el.innerHTML = `<button class="gcal-popup-close" onclick="document.getElementById('gcal-popup').remove()">✕</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <div class="gcal-popup-title" style="margin:0">${esc(name)}</div>
        </div>
        ${item.meeting_type ? `<div class="gcal-popup-row">🏷 ${esc(mtLabel(item.meeting_type, l))}</div>` : ""}
        <div class="gcal-popup-row">📅 ${item.meeting_date || ""}${item.meeting_time ? " · 🕐 " + item.meeting_time.substring(0, 5) : ""}${item.duration_mins ? " · " + item.duration_mins + " " + t("د", "min") : ""}</div>
        ${item.meeting_location ? `<div class="gcal-popup-row">📍 ${esc(item.meeting_location)}</div>` : ""}
        ${boardName ? `<div class="gcal-popup-row">🏛 ${esc(boardName)}</div>` : ""}
        ${item.meeting_url ? `<div class="gcal-popup-row">🔗 <a href="${esc(item.meeting_url)}" target="_blank" rel="noopener" style="color:var(--gold)">${t("رابط الانضمام", "Join Link")}</a></div>` : ""}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-gold btn-sm" onclick="CalendarPanel._open('${kind}',${id})">${t("فتح الاجتماع", "Open Meeting")}</button>
          ${!isHeld && item.meeting_url ? `<a href="${esc(item.meeting_url)}" target="_blank" rel="noopener" class="btn-ghost btn-sm">${t("انضمام", "Join")}</a>` : ""}
        </div>`;
    }

    document.body.appendChild(el);
    // Position near clicked element
    const tgt = event.currentTarget || event.target;
    const r = tgt && tgt.getBoundingClientRect ? tgt.getBoundingClientRect() : { bottom: 200, left: 400, top: 180 };
    const pw = 310;
    let top = r.bottom + 8;
    let left = r.left;
    if (top + 240 > window.innerHeight - 10) top = Math.max(10, r.top - 240 - 8);
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    if (left < 10) left = 10;
    el.style.top = top + "px";
    el.style.left = left + "px";
    const close = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close), 20);
  },

  _open(kind, id) {
    document.getElementById("gcal-popup")?.remove();
    if (kind === "held") {
      // Open held meeting full detail page in the new Meetings panel
      Panels.load("scheduled").then(() => setTimeout(() => MT.openDetail(id), 300));
    } else {
      // Select the scheduled meeting in the new Meetings panel (not the old schedule editor)
      Panels.load("scheduled").then(() => setTimeout(() => ScheduledPanel.select("sched", id), 300));
    }
  },
};

async function renderSchedule() {
  const el = $("sched-items");
  const calWrap = $("sched-calendar");
  const view = MasterCalendar.getView();
  const listBtn = $("sched-view-list-btn");
  const calBtn = $("sched-view-cal-btn");
  if (listBtn) listBtn.classList.toggle("active", view === "list");
  if (calBtn) calBtn.classList.toggle("active", view === "calendar");
  if (el) el.style.display = view === "list" ? "" : "none";
  if (calWrap) calWrap.style.display = view === "calendar" ? "" : "none";
  el.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const [items, heldMeetings, tasks] = await Promise.all([api("/api/schedule"), api("/api/meetings"), api("/api/tasks")]);
    App.scheduleCache = items;
    App.tasksCache = tasks;
    const l = App.lang;
    if (view === "calendar") {
      MasterCalendar.render(items, heldMeetings, tasks, l);
    }
    if (!items.length) {
      el.innerHTML = `<div style="text-align:center;padding:36px 24px">
        <div style="font-size:44px;margin-bottom:14px">📅</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">${l==="ar"?"لا اجتماعات مجدولة بعد":"No meetings scheduled yet"}</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.8;max-width:380px;margin:0 auto 18px">${l==="ar"?"استخدم نموذج <strong style='color:var(--gold)'>إضافة اجتماع</strong> أعلاه لجدولة اجتماعك الأول. يمكنك تحديد المشاركين، جهة الاجتماع (Zoom/Teams/Meet)، وإرسال تذكيرات بريدية تلقائية.":"Use the <strong style='color:var(--gold)'>Add Meeting</strong> form above to schedule your first meeting. Set the type, attendees, platform (Zoom / Teams / Meet), and send automatic email reminders."}</div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(46,204,138,.1);color:var(--green);border:.5px solid rgba(46,204,138,.25)">✓ ${l==="ar"?"تذكيرات بريدية جاهزة":"Email reminders ready"}</span>
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(212,160,23,.1);color:var(--gold);border:.5px solid rgba(212,160,23,.25)">🎥 ${l==="ar"?"Zoom / Teams / Meet مدعوم":"Zoom / Teams / Meet supported"}</span>
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(91,155,214,.1);color:#5B9BD6;border:.5px solid rgba(91,155,214,.25)">🔁 ${l==="ar"?"تكرار تلقائي متاح":"Recurring meetings available"}</span>
        </div>
      </div>`;
      return;
    }
    const today = new Date().toISOString().substring(0, 10);
    const _sb = `<div style="padding:11px 15px;background:rgba(212,160,23,.06);border:1px solid rgba(212,160,23,.15);border-radius:10px;margin-bottom:14px;font-size:11.5px;color:var(--text3);line-height:1.75">${l==="ar"?'<strong style="color:var(--gold)">💡 نصيحة:</strong> انقر ✏️ لتعديل أي اجتماع · استخدم 📧 <strong>إرسال تذكير</strong> لإبلاغ المشاركين تلقائياً · الاجتماعات الافتراضية تُظهر بطاقة المنصة بزر الانضمام المباشر':'<strong style="color:var(--gold)">💡 Tip:</strong> Click ✏️ Edit to update any meeting · Use 📧 <strong>Send Reminder</strong> to notify attendees automatically · Virtual meetings show a platform card with a direct join button'}</div>`;
    el.innerHTML = _sb + items
      .map((s) => {
        const title = l === "ar" ? s.title_ar : s.title_en || s.title_ar;
        const isUpcoming = s.meeting_date >= today;
        const isDraft = s.status === "draft";
        const isRecurring = s.recurrence && s.recurrence !== "none";
        const agenda =
          l === "ar" ? s.agenda_ar || s.agenda_en : s.agenda_en || s.agenda_ar;
        const reminderCall = `Schedule.openReminder(${s.id})`;
        return `<div style="padding:13px 0;border-bottom:1px solid var(--border2);${isDraft ? "background:linear-gradient(90deg,rgba(124,94,16,.10),transparent);border-inline-start:3px solid #d4a017;padding-inline-start:10px" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(title)}</div>
              ${s.meeting_type ? `<span class="tag tgold" style="font-size:11px;padding:2px 7px">${esc(mtLabel(s.meeting_type, l))}</span>` : ""}
              ${isRecurring ? `<span class="tag" style="background:rgba(147,112,219,.15);color:#9370DB;font-size:11px">🔁 ${esc(recurrenceLabel(s.recurrence, l))}</span>` : ""}
              ${s.board_name_ar ? `<span class="tag" style="background:rgba(91,155,214,.12);color:#5B9BD6;font-size:11px">🏛 ${esc(l === "ar" ? s.board_name_ar : s.board_name_en || s.board_name_ar)}</span>` : ""}
              ${s.committee_name_ar ? `<span class="tag" style="background:rgba(46,204,138,.10);color:var(--green);font-size:11px">⚙️ ${esc(l === "ar" ? s.committee_name_ar : s.committee_name_en || s.committee_name_ar)}</span>` : ""}
              ${s.doc_count ? `<span class="tag" style="background:var(--navy3);color:var(--text3);font-size:11px">📁 ${s.doc_count}</span>` : ""}
              ${(s.meeting_provider && s.meeting_provider !== "physical") ? (() => { const _pc = {zoom:{c:"#2D8CFF",b:"rgba(45,140,255,.13)",i:"🎥",n:"Zoom"},teams:{c:"#6264A7",b:"rgba(98,100,167,.13)",i:"💼",n:"Teams"},google_meet:{c:"#00897B",b:"rgba(0,137,123,.13)",i:"🎦",n:"Meet"}}[s.meeting_provider]||{}; return `<span class="tag" style="background:${_pc.b};color:${_pc.c};font-size:11px;border:.5px solid ${_pc.c}33">${_pc.i} ${_pc.n}</span>`; })() : ""}
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">
              📅 ${esc(s.meeting_date || "")} ${s.meeting_time ? `🕐 ${esc(s.meeting_time)}` : ""} · ${s.duration_mins || 60} ${l === "ar" ? "د" : "min"} · ${s.platform ? esc(platLabel(s.platform, l)) : ""}${s.meeting_location ? ` · 📍 ${esc(s.meeting_location)}` : ""}
            </div>
            ${s.attendees ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">👥 ${esc(s.attendees)}</div>` : ""}
            ${agenda ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">📋 ${esc(agenda.substring(0, 80))}${agenda.length > 80 ? "…" : ""}</div>` : ""}
            ${isDraft && s.source_meeting_id ? `<div style="font-size:11px;color:#d4a017;margin-top:3px">🤖 ${l === "ar" ? "مُقترح تلقائياً من نص اجتماع" : "Auto-suggested from a meeting transcript"}</div>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
            ${isDraft ? `<span class="tag" style="background:#7c5e10;color:#ffd969;font-size:11px">📝 ${l === "ar" ? "مسودة" : "Draft"}</span>` : isUpcoming ? `<span class="tag tg" style="font-size:11px">${l === "ar" ? "قادم" : "Upcoming"}</span>` : `<span class="tag" style="background:var(--navy4);font-size:11px">${l === "ar" ? "مضى" : "Past"}</span>`}
          </div>
        </div>
        ${_meetingLifecycle(s, l)}
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          ${isDraft ? `<button class="btn-sm" onclick="Schedule.confirm(${s.id})" style="font-size:11px;background:#d4a017;color:#1a1a1a;border:none;border-radius:6px;padding:5px 10px;font-weight:600;cursor:pointer">✔ ${l === "ar" ? "تأكيد الموعد" : "Confirm Meeting"}</button>` : ""}
          <button class="btn-ghost btn-sm" onclick="${reminderCall}" style="font-size:11px">📧 ${l === "ar" ? "إرسال تذكير" : "Send Reminder"}</button>
          <a class="btn-ghost btn-sm" href="/api/schedule/${s.id}/ics" download style="font-size:11px;text-decoration:none;display:inline-flex;align-items:center">📅 ${l === "ar" ? "إضافة للتقويم" : "Add to Calendar"}</a>
          <button class="btn-ghost btn-sm" onclick="Schedule.edit(${s.id})" style="font-size:11px">✏️ ${l === "ar" ? "تعديل" : "Edit"}</button>
          ${isRecurring ? `<button class="btn-ghost btn-sm" onclick="Schedule.deleteSeries(${s.id})" style="font-size:11px;color:var(--red)">🔁 ${l === "ar" ? "حذف السلسلة" : "Delete Series"}</button>` : ""}
          <button class="btn-ghost btn-sm" onclick="Schedule.delete(${s.id})" style="font-size:11px;color:var(--red)">✕ ${l === "ar" ? "حذف" : "Delete"}</button>
        </div>
        ${Schedule._sPlatformCard(s, l)}
      </div>`;
      })
      .join("");
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:10px">${e.message}</div>`;
  }
}

async function renderTemplates() {
  const el = $("templates-list");
  if (!el) return;
  const l = App.lang;
  try {
    const templates = await api("/api/templates");
    App._templates = templates;
    const sel = $("nm-template");
    if (sel) {
      sel.innerHTML =
        `<option value="">— ${l === "ar" ? "اختر قالباً" : "Select a template"} —</option>` +
        templates
          .map(
            (t) =>
              `<option value="${t.id}">${esc(l === "ar" ? t.name_ar : t.name_en || t.name_ar)}${t.is_builtin ? " ⭐" : ""}</option>`,
          )
          .join("");
    }
    if (!templates.length) {
      el.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:10px 0">${l === "ar" ? "لا توجد قوالب محفوظة بعد. استخدم «حفظ كقالب» لإنشاء قوالب مخصصة." : "No saved templates yet. Use «Save as Template» to create custom templates."}</div>`;
      return;
    }
    el.innerHTML =
      `<div style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 0">` +
      templates
        .map((t) => {
          const name = l === "ar" ? t.name_ar : t.name_en || t.name_ar;
          const dur = t.default_duration || 60;
          const type = t.meeting_type || "";
          return `<div style="background:var(--navy3);border:1px solid var(--border2);border-radius:10px;padding:11px 14px;min-width:170px;max-width:230px;transition:border-color .2s;cursor:pointer" onclick="Schedule.applyTemplate(${t.id})" title="${l === "ar" ? "انقر للملء التلقائي" : "Click to auto-fill form"}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
            <span style="font-size:17px">${t.is_builtin ? "⭐" : "📋"}</span>
            <span style="font-size:12px;font-weight:700;color:var(--text)">${esc(name)}</span>
          </div>
          ${type ? `<div style="font-size:11px;color:var(--gold);margin-bottom:3px">${esc(mtLabel(type, l))}</div>` : ""}
          <div style="font-size:11px;color:var(--text3)">${dur} ${l === "ar" ? "دقيقة" : "min"}</div>
          <div style="display:flex;gap:5px;margin-top:8px">
            <button class="btn-ghost btn-sm" style="font-size:11px;padding:3px 9px" onclick="event.stopPropagation();Schedule.applyTemplate(${t.id})">▶ ${l === "ar" ? "استخدام" : "Use"}</button>
            ${!t.is_builtin ? `<button class="btn-ghost btn-sm" style="font-size:11px;padding:3px 7px;color:var(--red)" onclick="event.stopPropagation();Templates.deleteTemplate(${t.id})">✕</button>` : ""}
          </div>
        </div>`;
        })
        .join("") +
      `</div>`;
  } catch (e) {
    if (el)
      el.innerHTML = `<div style="color:var(--red);font-size:12px">${e.message}</div>`;
  }
}

const Templates = {
  async deleteTemplate(id) {
    const l = App.lang;
    if (
      !confirm(
        l === "ar"
          ? "حذف هذا القالب نهائياً؟"
          : "Permanently delete this template?",
      )
    )
      return;
    try {
      await api(`/api/templates/${id}`, { method: "DELETE" });
      showToast(l === "ar" ? "تم حذف القالب" : "Template deleted");
      await renderTemplates();
    } catch (e) {
      alert(e.message);
    }
  },
};

// ══ Share Outcomes (PRO) ══════════════════════════════════════════════════════
const Share = {
  meetingId: null,

  async open(meetingId) {
    if (!App.requirePro()) return;
    this.meetingId = meetingId;
    const box = $("share-attendees");
    box.innerHTML = `<div style="font-size:11px;color:var(--text3)">${App.lang === "ar" ? "جارٍ التحميل..." : "Loading..."}</div>`;
    $("share-status").style.display = "none";
    $("modal-share").classList.add("open");
    App.applyLang(App.lang);
    try {
      const rows = await api(`/api/meetings/${meetingId}/attendees`);
      box.innerHTML = "";
      if (rows && rows.length) rows.forEach((r) => this.addRow(r));
      else {
        // Seed from team members so the coordinator can pick from them.
        const members = App._members || [];
        if (members.length)
          members.slice(0, 6).forEach((m) =>
            this.addRow({
              name: App.lang === "ar" ? m.name_ar : m.name_en || m.name_ar,
              email: m.email || "",
              phone: m.phone || "",
              include: false,
            }),
          );
        else this.addRow();
      }
    } catch (e) {
      box.innerHTML = "";
      this.addRow();
    }
  },

  addRow(r = {}) {
    const box = $("share-attendees");
    const l = App.lang;
    const row = document.createElement("div");
    row.className = "share-row";
    row.style.cssText =
      "display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--navy3);border:1px solid var(--border2);border-radius:9px;padding:8px";
    row.innerHTML = `
      <input type="checkbox" class="sa-inc" ${r.include === false ? "" : "checked"} title="${l === "ar" ? "مشاركة معه" : "Share with"}" style="width:17px;height:17px;flex-shrink:0;accent-color:var(--gold)">
      <input class="fi sa-name" placeholder="${l === "ar" ? "الاسم" : "Name"}" value="${esc(r.name || "")}" style="flex:1;min-width:110px">
      <input class="fi sa-email" type="email" placeholder="${l === "ar" ? "البريد" : "Email"}" value="${esc(r.email || "")}" style="flex:1.3;min-width:140px">
      <input class="fi sa-phone" type="tel" placeholder="${l === "ar" ? "الجوال (واتساب)" : "Phone (WhatsApp)"}" value="${esc(r.phone || "")}" style="flex:1;min-width:120px">
      <button class="btn-ghost btn-sm" onclick="this.closest('.share-row').remove()" style="color:var(--red);flex-shrink:0">✕</button>`;
    box.appendChild(row);
  },

  collect() {
    return [...document.querySelectorAll("#share-attendees .share-row")]
      .map((row) => ({
        include: row.querySelector(".sa-inc").checked,
        name: row.querySelector(".sa-name").value.trim(),
        email: row.querySelector(".sa-email").value.trim(),
        phone: row.querySelector(".sa-phone").value.trim(),
      }))
      .filter((a) => a.name || a.email || a.phone);
  },

  status(msg, ok) {
    const el = $("share-status");
    el.style.display = "block";
    el.style.background = ok
      ? "var(--green-dim,rgba(34,197,94,.12))"
      : "rgba(239,68,68,.12)";
    el.style.color = ok ? "var(--green,#22c55e)" : "var(--red)";
    el.textContent = msg;
  },

  async send() {
    const l = App.lang;
    const attendees = this.collect();
    const recipients = attendees.filter((a) => a.include);
    if (!recipients.length) {
      this.status(
        l === "ar"
          ? "اختر حاضراً واحداً على الأقل"
          : "Select at least one attendee",
        false,
      );
      return;
    }
    if (recipients.some((a) => !a.name)) {
      this.status(
        l === "ar"
          ? "كل حاضر مُختار يجب أن يكون له اسم"
          : "Every selected attendee needs a name",
        false,
      );
      return;
    }
    const channel = $("share-channel").value;
    if (
      channel !== "whatsapp" &&
      recipients.some((a) => a.include && !a.email)
    ) {
      this.status(
        l === "ar"
          ? "بعض الحضور بلا بريد إلكتروني"
          : "Some attendees are missing an email",
        false,
      );
      return;
    }
    if (channel !== "email" && recipients.some((a) => a.include && !a.phone)) {
      this.status(
        l === "ar"
          ? "بعض الحضور بلا رقم جوال"
          : "Some attendees are missing a phone number",
        false,
      );
      return;
    }

    const btn = $("share-send-btn");
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<span class="loading"></span> ${l === "ar" ? "جارٍ الإرسال..." : "Sending..."}`;
    try {
      // Persist the full contact list, then share only with the included subset
      // (the coordinator's audience filter — feature #7).
      const saved = await api(`/api/meetings/${this.meetingId}/attendees`, {
        method: "POST",
        body: JSON.stringify({ attendees }),
      });
      // Map included recipients to stable DB ids via a full composite key
      // (name|email|phone) so same-name attendees are never over-shared.
      const key = (a) =>
        `${(a.name || "").trim()}|${(a.email || "").trim()}|${(a.phone || "").trim()}`;
      const includedKeys = new Set(recipients.map(key));
      const attendee_ids = (saved || [])
        .filter((s) => includedKeys.has(key(s)))
        .map((s) => s.id);
      if (!attendee_ids.length) {
        this.status(
          l === "ar" ? "تعذّر تحديد المستلمين" : "Could not resolve recipients",
          false,
        );
        btn.disabled = false;
        btn.innerHTML = orig;
        return;
      }
      const r = await api(`/api/meetings/${this.meetingId}/share`, {
        method: "POST",
        body: JSON.stringify({ channel, attendee_ids }),
      });
      const sent = r.shared != null ? r.shared : recipients.length;
      this.status(
        l === "ar"
          ? `✓ تمت المشاركة وإرسال ${sent} رابط`
          : `✓ Shared & sent ${sent} link(s)`,
        true,
      );
      if (document.querySelector(".nb.active") && document.querySelector(".nb.active").dataset.p === "transcripts")
        await renderTranscripts();
      setTimeout(() => this.close(), 1600);
    } catch (e) {
      this.status(
        (l === "ar" ? "تعذّر الإرسال: " : "Send failed: ") + e.message,
        false,
      );
    }
    btn.disabled = false;
    btn.innerHTML = orig;
  },

  close() {
    $("modal-share").classList.remove("open");
  },
};

// ══ Email Reminder ════════════════════════════════════════════════════════════
const EmailReminder = {
  open(subject, body, to) {
    $("email-to").value = to || "";
    $("email-subject").value = subject || "";
    $("email-body").value = body || "";
    $("email-status").style.display = "none";
    $("smtp-note").style.display = "none";
    $("modal-email").classList.add("open");
  },
  close() {
    $("modal-email").classList.remove("open");
  },
  async send() {
    const btn = $("email-send-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === "ar" ? "جارٍ الإرسال..." : "Sending..."}`;
    const status = $("email-status");
    try {
      const r = await api("/api/email/send", {
        method: "POST",
        body: JSON.stringify({
          to: $("email-to").value,
          subject: $("email-subject").value,
          body: $("email-body").value,
        }),
      });
      status.style.display = "block";
      status.style.cssText =
        "display:block;padding:9px 12px;border-radius:8px;font-size:12px;margin-top:4px;background:rgba(77,200,140,.1);color:var(--green)";
      status.textContent = `✓ ${App.lang === "ar" ? `تم الإرسال إلى ${r.sent_to} مستلم` : `Sent to ${r.sent_to} recipient(s)`}`;
      showToast(
        App.lang === "ar"
          ? `تم إرسال التذكير إلى ${r.sent_to} مستلم`
          : `Reminder sent to ${r.sent_to} recipient(s)`,
        "success",
      );
      setTimeout(() => this.close(), 2000);
    } catch (e) {
      if (e.message === "SMTP_NOT_CONFIGURED" || (e.message && e.message.includes("SMTP"))) {
        status.style.display = "block";
        status.style.cssText =
          "display:block;padding:9px 12px;border-radius:8px;font-size:12px;margin-top:4px;background:rgba(201,168,76,.08);color:var(--amber)";
        status.textContent =
          App.lang === "ar"
            ? "⚙️ لم يتم إعداد البريد الإلكتروني بعد"
            : "⚙️ Email not configured yet";
        $("smtp-note").style.display = "block";
      } else {
        status.style.display = "block";
        status.style.cssText =
          "display:block;padding:9px 12px;border-radius:8px;font-size:12px;margin-top:4px;background:rgba(224,90,90,.1);color:var(--red)";
        status.textContent = e.message;
      }
    }
    btn.disabled = false;
    btn.innerHTML = `📧 <span>${App.lang === "ar" ? "إرسال" : "Send"}</span>`;
  },
};
$("modal-email").addEventListener("click", (e) => {
  if (e.target === $("modal-email")) EmailReminder.close();
});

// ══ Team Management ═══════════════════════════════════════════════════════════
const Team = {
  editingId: null,

  async load() {
    const body = $("team-body");
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    const addBtn = $("btn-add-member");
    if (addBtn) addBtn.style.display = App.systemRole === "Admin" ? "" : "none";
    try {
      const [members, tasks] = await Promise.all([
        api("/api/members"),
        api("/api/tasks"),
      ]);
      body.innerHTML = this.render(members, tasks);
    } catch (e) {
      body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
    }
  },

  render(members, tasks) {
    const l = App.lang;
    const canManage = App.systemRole === "Admin";
    if (!members.length)
      return `<div class="es"><div class="es-icon">👥</div><div>${l === "ar" ? "لا يوجد أعضاء فريق — اضغط إضافة عضو" : "No team members — click Add Member"}</div></div>`;

    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">
      ${members
        .map((m) => {
          const name = l === "ar" ? m.name_ar : m.name_en || m.name_ar;
          const role =
            l === "ar" ? m.role_ar || "" : m.role_en || m.role_ar || "";
          const initials = name
            .split(" ")
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .substring(0, 2);
          const memberTasks = tasks.filter(
            (t) =>
              t.owner_name_ar === m.name_ar || t.owner_name_en === m.name_en,
          );
          const doneTasks = memberTasks.filter(
            (t) => t.status === "done",
          ).length;
          const overdueTasks = memberTasks.filter(
            (t) => t.status === "overdue",
          ).length;
          const inProgTasks = memberTasks.filter(
            (t) => t.status === "inprogress" || t.status === "new",
          ).length;
          const completion =
            memberTasks.length > 0
              ? Math.round((doneTasks / memberTasks.length) * 100)
              : 0;
          return `<div class="card" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:50px;height:50px;border-radius:50%;background:var(--gold-dim);border:2px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(initials)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:600;color:var(--text)">${esc(name)}</div>
              ${m.name_en && l === "ar" ? `<div style="font-size:11px;color:var(--text3)">${esc(m.name_en)}</div>` : ""}
              <div style="font-size:11px;color:var(--gold)">${esc(role || (l === "ar" ? "عضو فريق" : "Team Member"))}</div>
              <div style="font-size:11px;color:var(--text3);direction:ltr;text-align:${l === "ar" ? "right" : "left"}">${esc(m.email)}</div>
            </div>
          </div>
          ${
            memberTasks.length > 0
              ? `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:5px">
              <span>${l === "ar" ? "الإنجاز" : "Completion"}</span><span>${completion}%</span>
            </div>
            <div style="height:4px;background:var(--navy4);border-radius:4px;overflow:hidden">
              <div style="height:100%;background:${completion === 100 ? "var(--green)" : completion > 50 ? "var(--gold)" : "var(--amber)"};width:${completion}%;border-radius:4px;transition:.3s"></div>
            </div>
          </div>`
              : ""
          }
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${overdueTasks ? `<span class="tag tr">${overdueTasks} ${l === "ar" ? "متأخرة" : "overdue"}</span>` : ""}
            ${inProgTasks ? `<span class="tag ta">${inProgTasks} ${l === "ar" ? "جارٍ" : "in progress"}</span>` : ""}
            ${doneTasks ? `<span class="tag tg">${doneTasks} ${l === "ar" ? "مكتملة" : "done"}</span>` : ""}
            ${!memberTasks.length ? `<span class="tag" style="background:var(--navy4);font-size:11px">${l === "ar" ? "لا مهام مسندة" : "No tasks assigned"}</span>` : ""}
          </div>
          ${
            canManage
              ? `<div style="display:flex;gap:7px;border-top:1px solid var(--border2);padding-top:10px">
            <button class="btn-ghost btn-sm" onclick="Team.edit(${m.id})" style="flex:1;font-size:11px">✏️ ${l === "ar" ? "تعديل" : "Edit"}</button>
            <button class="btn-ghost btn-sm" onclick="openResetPassword(${m.id}, '${esc(name).replace(/'/g, "\\'")}')" style="font-size:11px" title="${l === "ar" ? "إعادة تعيين كلمة المرور" : "Reset Password"}">🔒</button>
            <button class="btn-ghost btn-sm" onclick="Team.delete(${m.id})" style="color:var(--red);font-size:11px">✕ ${l === "ar" ? "حذف" : "Delete"}</button>
          </div>`
              : ""
          }
        </div>`;
        })
        .join("")}
    </div>`;
  },

  showAdd() {
    this.editingId = null;
    const title = $("member-modal-title");
    title.textContent = App.lang === "ar" ? "إضافة عضو جديد" : "Add New Member";
    ["m-name-ar", "m-name-en", "m-email", "m-role-ar", "m-role-en", "m-department", "m-phone"].forEach(
      (id) => ($(id).value = ""),
    );
    $("modal-member").classList.add("open");
  },

  async edit(id) {
    try {
      const members = await api("/api/members");
      const m = members.find((x) => x.id === id);
      if (!m) return;
      this.editingId = id;
      $("member-modal-title").textContent =
        App.lang === "ar" ? "تعديل بيانات العضو" : "Edit Member";
      $("m-name-ar").value = m.name_ar || "";
      $("m-name-en").value = m.name_en || "";
      $("m-email").value = m.email || "";
      $("m-role-ar").value = m.role_ar || "";
      $("m-role-en").value = m.role_en || "";
      $("m-department").value = m.department || "";
      $("m-phone").value = m.phone || "";
      $("modal-member").classList.add("open");
    } catch (e) {
      alert(e.message);
    }
  },

  closeModal() {
    $("modal-member").classList.remove("open");
  },

  async save() {
    const data = {
      name_ar: $("m-name-ar").value.trim(),
      name_en: $("m-name-en").value.trim(),
      email: $("m-email").value.trim(),
      role_ar: $("m-role-ar").value.trim(),
      role_en: $("m-role-en").value.trim(),
      department: $("m-department").value.trim(),
      phone: $("m-phone").value.trim(),
    };
    if (!data.name_ar || !data.email) {
      alert(
        App.lang === "ar"
          ? "الاسم بالعربي والبريد الإلكتروني مطلوبان"
          : "Arabic name and email are required",
      );
      return;
    }
    try {
      if (this.editingId) {
        await api(`/api/members/${this.editingId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
      } else {
        await api("/api/members", {
          method: "POST",
          body: JSON.stringify(data),
        });
      }
      this.closeModal();
      await this.load();
      await loadSelectLists();
      await loadBadges();
    } catch (e) {
      alert(e.message);
    }
  },

  async delete(id) {
    if (
      !confirm(
        App.lang === "ar"
          ? "حذف هذا العضو من الفريق؟"
          : "Delete this team member?",
      )
    )
      return;
    try {
      await api(`/api/members/${id}`, { method: "DELETE" });
      await this.load();
      await loadSelectLists();
      await loadBadges();
    } catch (e) {
      alert(e.message);
    }
  },
};
$("modal-member").addEventListener("click", (e) => {
  if (e.target === $("modal-member")) Team.closeModal();
});

// ══ Overview / Dashboard ══════════════════════════════════════════════════════
async function renderOverview() {
  const body = $("overview-body");
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    // Each call degrades independently on failure (e.g. a 403 for a role
    // lacking one permission) instead of blanking the whole dashboard.
    const [tasks, meetings, schedule, decisions, activityResp] = await Promise.all([
      api("/api/tasks").catch(() => []),
      api("/api/meetings").catch(() => []),
      api("/api/schedule").catch(() => []),
      api("/api/decisions").catch(() => []),
      api("/api/activity").catch(() => ({ activity: [] })),
    ]);
    const l = App.lang;
    const rtl = l === "ar";
    const lbl = (ar, en) => (rtl ? ar : en);
    const num = (v) => {
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return isFinite(n) ? n : 0;
    };
    const btxt = (ar, en) => esc((rtl ? ar || en : en || ar) || "");
    const today = new Date().toISOString().substring(0, 10);
    const now = new Date();

    // ── Today's meetings + live/upcoming split ──────────────────────────────
    const todays = schedule
      .filter((s) => s.meeting_date === today && s.status !== "cancelled")
      .sort((a, b) => (a.meeting_time || "").localeCompare(b.meeting_time || ""));
    const toMins = (hm) => {
      const p = String(hm || "").split(":");
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    };
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const stateOf = (s) => {
      if (!s.meeting_time) return "upcoming";
      const st = toMins(s.meeting_time);
      const dur = num(s.duration_mins) || 60;
      if (nowMins >= st && nowMins < st + dur) return "live";
      return nowMins < st ? "upcoming" : "ended";
    };
    const liveCount = todays.filter((s) => stateOf(s) === "live").length;
    const upCount = todays.filter((s) => stateOf(s) === "upcoming").length;
    const fmtT = (hm) => {
      if (!hm) return "—";
      const p = String(hm).split(":");
      let h = parseInt(p[0], 10) || 0;
      const m = (p[1] || "00").substring(0, 2);
      const am = h < 12;
      h = h % 12 || 12;
      return h + ":" + m + " " + (am ? lbl("ص", "AM") : lbl("م", "PM"));
    };

    // ── Derived data (all guarded — never "undefined") ─────────────────────
    const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
    const isOverdue = (t) => t.status === "overdue" || (t.due_date && t.due_date < today);
    const overdueTasks = openTasks.filter(isOverdue);
    const pendingTasks = openTasks.filter((t) => !isOverdue(t));
    const followDecisions = decisions.filter((d) => d.status !== "implemented");
    const pendingApprovals =
      meetings.filter((m) => (m.minutes_status || "") === "circulated").length +
      tasks.filter((t) => (t.review_status || "") === "pending").length;
    const userName = App.user ? (rtl ? App.user.name_ar || App.user.name_en : App.user.name_en || App.user.name_ar) || "" : "";
    const firstName = String(userName || "").split(" ")[0];

    const fmtD = (ds) => {
      if (!ds) return "—";
      const d = new Date(String(ds).substring(0, 10) + "T00:00:00");
      if (isNaN(d)) return esc(String(ds));
      return d.toLocaleDateString(rtl ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    };
    const endT = (hm, dur) => {
      if (!hm) return "";
      const t = toMins(hm) + (num(dur) || 60);
      const h = Math.floor(t / 60) % 24;
      const m2 = t % 60;
      return fmtT((h < 10 ? "0" + h : "" + h) + ":" + (m2 < 10 ? "0" + m2 : "" + m2));
    };

    // ── Next Meeting hero ───────────────────────────────────────────────────
    const upcoming = schedule
      .filter((s) => s.status !== "cancelled" && s.meeting_date && (s.meeting_date > today || (s.meeting_date === today && stateOf(s) !== "ended")))
      .sort((a, b) => ((a.meeting_date || "") + (a.meeting_time || "")).localeCompare((b.meeting_date || "") + (b.meeting_time || "")));
    const nm = upcoming[0] || null;
    let heroCard = "";
    if (nm) {
      const checks = [nm.meeting_time, nm.platform, nm.attendees, nm.agenda_ar || nm.agenda_en, num(nm.doc_count) > 0];
      const ready = Math.round((checks.filter(Boolean).length / checks.length) * 100);
      const C = 2 * Math.PI * 30;
      const dash = (ready / 100) * C;
      const docsNote =
        num(nm.doc_count) > 0
          ? num(nm.doc_count) + " " + lbl("مستند مرفق", (num(nm.doc_count) === 1 ? "document" : "documents") + " attached")
          : lbl("لا مستندات مرفقة بعد", "No documents attached yet");
      const heroSub = rtl ? nm.title_en : nm.title_ar;
      const openPkg = nm.source_meeting_id
        ? `ScheduledPanel.openWorkspace(${num(nm.source_meeting_id)})`
        : `Panels.load('scheduled')`;
      heroCard = `<div class="dx2-hero">
        <div class="dx2-hero-main">
          <span class="dx2-chip-type">📋 ${nm.meeting_type ? esc(mtLabel(nm.meeting_type, l)) : lbl("اجتماع", "Meeting")}</span>
          <div class="dx2-hero-title">${btxt(nm.title_ar, nm.title_en)}</div>
          ${heroSub && heroSub !== (rtl ? nm.title_ar : nm.title_en) ? `<div class="dx2-hero-sub">${esc(heroSub)}</div>` : ""}
          <div class="dx2-hero-meta">
            <div class="dx2-hm-row">📅 <span>${fmtD(nm.meeting_date)}</span></div>
            <div class="dx2-hm-row">🕐 <span>${fmtT(nm.meeting_time)}${nm.meeting_time ? " – " + endT(nm.meeting_time, nm.duration_mins) : ""}</span></div>
            ${nm.platform ? `<div class="dx2-hm-row">📡 <span>${esc(platLabel(nm.platform, l))}</span></div>` : ""}
            ${nm.meeting_location ? `<div class="dx2-hm-row">📍 <span>${esc(nm.meeting_location)}</span></div>` : ""}
          </div>
          <div class="dx2-hero-btns">
            <button class="btn-amber" onclick="${openPkg}">📦 ${lbl("فتح حزمة الاجتماع", "Open Meeting Package")}</button>
            <button class="btn-hero-ghost" onclick="Panels.load('scheduled')">${lbl("عرض التفاصيل", "View Details")}</button>
          </div>
        </div>
        <div class="dx2-hero-side">
          <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
            <circle cx="46" cy="46" r="30" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="7"/>
            <circle cx="46" cy="46" r="30" fill="none" stroke="#E2B33C" stroke-width="7" stroke-linecap="round"
              stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 46 46)"/>
            <text x="46" y="44" text-anchor="middle" fill="#fff" font-size="15" font-weight="800">${ready}%</text>
            <text x="46" y="58" text-anchor="middle" fill="rgba(255,255,255,.72)" font-size="8">${lbl("جاهزية الحزمة", "Package Ready")}</text>
          </svg>
          <div class="dx2-hero-note"><span class="dx2-dot-a"></span>${docsNote}</div>
        </div>
      </div>`;
    } else {
      heroCard = `<div class="dx2-hero dx2-hero-empty">
        <div class="dx2-hero-title">${lbl("لا اجتماعات قادمة", "No upcoming meetings")}</div>
        <div class="dx2-hero-sub">${lbl("قم بجدولة اجتماعك القادم للبدء", "Schedule your next meeting to get started")}</div>
        <div class="dx2-hero-btns"><button class="btn-amber" onclick="Panels.load('create-meeting')">+ ${lbl("إنشاء اجتماع", "Create Meeting")}</button></div>
      </div>`;
    }

    // ── Last Meeting card ───────────────────────────────────────────────────
    const past = meetings
      .filter((m) => (m.meeting_date || m.created_at || "").substring(0, 10) <= today)
      .sort((a, b) => String(b.meeting_date || b.created_at || "").localeCompare(String(a.meeting_date || a.created_at || "")));
    const lm = past.find((m) => m.status === "completed" || m.minutes_status === "approved" || m.minutes_status === "final_approved") || past[0] || null;
    let lastCard;
    if (lm) {
      const pj = (s) => {
        try {
          const a = JSON.parse(s || "[]");
          return Array.isArray(a) ? a.length : 0;
        } catch {
          return 0;
        }
      };
      const decN = decisions.filter((d) => num(d.meeting_id) === num(lm.id)).length || pj(lm.ai_decisions);
      const taskN = tasks.filter((t) => num(t.meeting_id || t.source_meeting_id) === num(lm.id)).length || pj(lm.ai_tasks);
      const done = lm.status === "completed" || lm.minutes_status === "approved" || lm.minutes_status === "final_approved";
      const stChip = done
        ? `<span class="dx2-pill dx2-pill-green">✓ ${lbl("مكتمل", "Completed")}</span>`
        : `<span class="dx2-pill dx2-pill-gray">${lbl("مسودة", "Draft")}</span>`;
      const minutesChip =
        lm.minutes_status === "approved" || lm.minutes_status === "final_approved"
          ? `<span class="dx2-pill dx2-pill-gold">${lbl("المحضر موقّع", "Minutes Signed")}</span>`
          : lm.minutes_status === "circulated"
            ? `<span class="dx2-pill dx2-pill-amber">${lbl("المحضر قيد الاعتماد", "Minutes in Approval")}</span>`
            : `<span class="dx2-pill dx2-pill-gray">${lbl("المحضر مسودة", "Minutes Draft")}</span>`;
      const summary = btxt(lm.ai_summary_ar, lm.ai_summary_en);
      const durMin = num(lm.duration) > 0 ? Math.round(num(lm.duration) / 60) : 0;
      lastCard = `<div class="dx2-card dx2-last">
        <div class="dx2-card-h"><span class="dx2-card-t">${lbl("آخر اجتماع", "Last Meeting")}</span>${stChip}</div>
        <div class="dx2-last-title" role="button" tabindex="0" onclick="MT.openDetail(${num(lm.id)})" onkeydown="if(event.key==='Enter')MT.openDetail(${num(lm.id)})">${btxt(lm.title_ar, lm.title_en)}</div>
        <div class="dx2-last-meta">📅 ${fmtD((lm.meeting_date || lm.created_at || "").substring(0, 10))}</div>
        <div class="dx2-last-meta">${minutesChip}</div>
        ${summary ? `<div class="dx2-last-sum">${summary.length > 200 ? summary.substring(0, 200) + "…" : summary}</div>` : ""}
        <div class="dx2-stats">
          <div class="dx2-stat"><div class="dx2-stat-v">${decN}</div><div class="dx2-stat-l">${lbl("قرارات", "Decisions")}</div></div>
          <div class="dx2-stat"><div class="dx2-stat-v">${taskN}</div><div class="dx2-stat-l">${lbl("مهام أُنشئت", "Tasks Created")}</div></div>
          <div class="dx2-stat"><div class="dx2-stat-v">${durMin ? durMin + lbl(" د", "m") : "—"}</div><div class="dx2-stat-l">${lbl("المدة", "Duration")}</div></div>
        </div>
        <button class="btn-gold" style="width:100%" onclick="MT.openDetail(${num(lm.id)})">${lbl("عرض التفاصيل", "View Details")}</button>
      </div>`;
    } else {
      lastCard = `<div class="dx2-card"><div class="dx2-card-h"><span class="dx2-card-t">${lbl("آخر اجتماع", "Last Meeting")}</span></div>
        <div class="dx-empty"><div class="ic">🗂️</div>${lbl("لا اجتماعات سابقة بعد", "No past meetings yet")}</div></div>`;
    }

    // ── Ask Ameen card ──────────────────────────────────────────────────────
    const chip = (ico, ar, en, qAr, qEn) =>
      `<button class="dx2-qc" data-q="${esc(rtl ? qAr : qEn)}" onclick="DashAsk.quick(this)">${ico} ${lbl(ar, en)}</button>`;
    const askCard = `<div class="dx2-ask">
      <div class="dx2-ask-h"><span class="dx2-ask-logo">✦</span><div><div class="dx2-ask-t">${lbl("اسأل أمين", "Ask Ameen")}</div><div class="dx2-ask-s">${lbl("المساعد الذكي", "AI Assistant")}</div></div></div>
      <div class="dx2-ask-greet">${lbl("مرحباً", "Hello")}${firstName ? " " + esc(firstName) : ""}،<br>${lbl("كيف يمكنني مساعدتك اليوم؟", "How can I help you today?")}</div>
      <div class="dx2-ask-sub">${lbl("أنا هنا للمساعدة في اجتماعاتك وقراراتك ومهامك.", "I'm here to help with your meetings, decisions and tasks.")}</div>
      <div class="dx2-ask-in">
        <input id="dx2-ask-q" type="text" placeholder="${lbl("اسأل أي شيء...", "Ask anything...")}" onkeydown="if(event.key==='Enter')DashAsk.go()"/>
        <button onclick="DashAsk.go()" aria-label="${lbl("إرسال", "Send")}">${rtl ? "◀" : "▶"}</button>
      </div>
      <div class="dx2-ask-chips">
        ${chip("🔔", "صياغة تذكير", "Draft Reminder", "صِغ رسالة تذكير للمهام المتأخرة", "Draft a reminder for the overdue tasks")}
        ${chip("📝", "تلخيص اجتماع", "Summarize Meeting", "لخص آخر اجتماع", "Summarize the last meeting")}
        ${chip("⚖️", "إيجاد قرار", "Find Decision", "أرني القرارات المعلقة", "Show me the pending decisions")}
        ${chip("📈", "توليد تقرير", "Generate Report", "أنشئ ملخصاً تنفيذياً لهذا الأسبوع", "Generate an executive summary for this week")}
      </div>
    </div>`;

    // ── AI Timeline (real activity feed) ────────────────────────────────────
    const acts = (activityResp && Array.isArray(activityResp.activity) ? activityResp.activity : []).slice(0, 8);
    const yday = new Date(now.getTime() - 86400000).toISOString().substring(0, 10);
    const dayLbl = (ds) => {
      const d10 = (ds || "").substring(0, 10);
      if (d10 === today) return lbl("اليوم", "Today");
      if (d10 === yday) return lbl("أمس", "Yesterday");
      return d10 ? fmtD(d10) : "—";
    };
    let lastDay = null;
    const tlRows = acts
      .map((a) => {
        const dl = dayLbl(a.created_at);
        const hdr = dl !== lastDay ? `<div class="dx2-tl-day">${dl}</div>` : "";
        lastDay = dl;
        const tm = fmtT((a.created_at || "").substring(11, 16));
        return (
          hdr +
          `<div class="dx2-tl-row"><span class="dx2-tl-time">${tm}</span><span class="dx2-tl-dot"></span>
          <div class="dx2-tl-body"><div class="dx2-tl-t">${btxt(a.title_ar, a.title_en)}</div>
          ${a.body_ar || a.body_en ? `<div class="dx2-tl-s">${btxt(a.body_ar, a.body_en)}</div>` : ""}</div></div>`
        );
      })
      .join("");
    const tlCard = `<div class="dx2-card">
      <div class="dx2-card-h"><span class="dx2-card-t">${lbl("سجل النشاط", "Activity Timeline")}</span>
        ${(ROLE_ACCESS[App.systemRole] || ROLE_ACCESS["Employee"]).has("activity") ? `<button class="dx-link" onclick="Panels.load('activity')">${lbl("عرض الكل", "View All")}</button>` : ""}</div>
      <div class="dx2-tl">${tlRows || `<div class="dx-empty"><div class="ic">🕐</div>${lbl("لا نشاط حديث", "No recent activity")}</div>`}</div>
    </div>`;

    // ── Tasks & Follow-up columns ───────────────────────────────────────────
    const av = (nAr, nEn) => {
      const nm2 = (rtl ? nAr || nEn : nEn || nAr) || "";
      const ini = String(nm2)
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] || "")
        .join("");
      return ini ? `<span class="dx2-av" title="${esc(nm2)}">${esc(ini)}</span>` : "";
    };
    const relDue = (t) => {
      if (!t.due_date) return "";
      const dd = new Date(t.due_date + "T00:00:00");
      const diff = Math.round((dd - new Date(today + "T00:00:00")) / 86400000);
      if (!isFinite(diff)) return "";
      if (diff < 0) return `<span class="dx-chip dx-red">${rtl ? "منذ " + -diff + " يوم" : -diff + "d late"}</span>`;
      if (diff === 0) return `<span class="dx-chip dx-red">${lbl("اليوم", "Today")}</span>`;
      if (diff === 1) return `<span class="dx-chip dx-amber">${lbl("غداً", "Tomorrow")}</span>`;
      return `<span class="dx-chip dx-gray">${rtl ? "خلال " + diff + " يوم" : "in " + diff + "d"}</span>`;
    };
    const taskRow = (t) => `<div class="dx2-item" role="button" tabindex="0" onclick="Panels.load('tasks')" onkeydown="if(event.key==='Enter')Panels.load('tasks')">
      <div class="dx2-item-main"><div class="dx2-item-t">${btxt(t.text_ar, t.text_en)}</div>
        <div class="dx2-item-s">${btxt(t.owner_name_ar, t.owner_name_en)}</div></div>
      ${relDue(t)}${av(t.owner_name_ar, t.owner_name_en)}
    </div>`;
    const decRow = (d) => `<div class="dx2-item" role="button" tabindex="0" onclick="Panels.load('tasks')" onkeydown="if(event.key==='Enter')Panels.load('tasks')">
      <div class="dx2-item-main"><div class="dx2-item-t">${btxt(d.text_ar, d.text_en)}</div>
        <div class="dx2-item-s">${[btxt(d.meeting_title_ar, d.meeting_title_en), (d.created_at || "").substring(0, 10)].filter(Boolean).join(" · ")}</div></div>
    </div>`;
    const arrow = rtl ? "←" : "→";
    const col = (icoCls, ico, title, count, rows, moreLbl, go) => `<div class="dx2-card dx2-fcol">
      <div class="dx2-fcol-h"><span class="dx2-ico ${icoCls}">${ico}</span><span class="dx2-card-t">${title}</span><span class="dx2-count">${count}</span></div>
      <div class="dx2-fcol-list">${rows || `<div class="dx-empty"><div class="ic">✅</div>${lbl("لا عناصر", "Nothing here")}</div>`}</div>
      <button class="dx2-more" onclick="Panels.load('${go}')">${moreLbl} ${arrow}</button>
    </div>`;

    // ── Smart Alerts (only real, data-backed alerts) ────────────────────────
    const alerts = [];
    if (overdueTasks.length)
      alerts.push({
        ico: "🚩",
        cls: "dx2-al-red",
        t: lbl("تأخير في المهام", "Overdue Tasks"),
        s: rtl ? overdueTasks.length + " مهام متأخرة تتطلب المتابعة" : overdueTasks.length + " overdue tasks need follow-up",
        a: lbl("راجع الآن", "Review Now"),
        go: "tasks",
      });
    if (pendingApprovals)
      alerts.push({
        ico: "🗂️",
        cls: "dx2-al-amber",
        t: lbl("موافقات معلّقة", "Pending Approvals"),
        s: rtl ? pendingApprovals + " عنصر بانتظار المراجعة" : pendingApprovals + " items awaiting review",
        a: lbl("عرض", "View"),
        go: "transcripts",
      });
    if (nm && num(nm.doc_count) === 0)
      alerts.push({
        ico: "📦",
        cls: "dx2-al-blue",
        t: lbl("حزمة الاجتماع غير مكتملة", "Meeting Package Incomplete"),
        s: lbl("لا مستندات مرفقة للاجتماع القادم", "No documents attached to the next meeting"),
        a: lbl("أكمل الآن", "Complete Now"),
        go: "scheduled",
      });
    if (todays.length)
      alerts.push({
        ico: "📅",
        cls: "dx2-al-green",
        t: lbl("اجتماعات اليوم", "Today's Meetings"),
        s: rtl ? todays.length + " اجتماع مجدول اليوم (" + liveCount + " مباشر)" : todays.length + " scheduled today (" + liveCount + " live)",
        a: lbl("عرض الجدول", "View Schedule"),
        go: "schedule",
      });
    const alertsHtml = alerts
      .slice(0, 4)
      .map(
        (a) => `<div class="dx2-alert ${a.cls}">
        <div class="dx2-alert-h"><span class="dx2-alert-ico">${a.ico}</span><span class="dx2-alert-t">${a.t}</span></div>
        <div class="dx2-alert-s">${a.s}</div>
        <button class="dx-link" onclick="Panels.load('${a.go}')">${a.a}</button>
      </div>`,
      )
      .join("");

    // ── Live KPI bar ────────────────────────────────────────────────────────
    const in7d = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);
    const meetingsThisWeek = schedule.filter(s => s.status !== 'cancelled' && s.meeting_date && s.meeting_date >= today && s.meeting_date <= in7d).length;
    const kpiBar = (ico, val, ar, en, accent, onclick) =>
      `<div onclick="${onclick}" style="flex:1;min-width:110px;cursor:pointer;display:flex;flex-direction:column;align-items:center;padding:12px 8px;background:var(--navy3);border-radius:10px;border:1px solid var(--border2);gap:4px;transition:.15s" onmouseover="this.style.borderColor=\'${accent}\'" onmouseout="this.style.borderColor=\'var(--border2)\'">
        <div style="font-size:20px;line-height:1">${ico}</div>
        <div style="font-size:22px;font-weight:800;color:${accent};line-height:1">${val}</div>
        <div style="font-size:11px;color:var(--text3);text-align:center">${lbl(ar, en)}</div>
      </div>`;
    const kpiBarHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
      ${kpiBar("📅", meetingsThisWeek, "اجتماعات هذا الأسبوع", "This Week's Meetings", "var(--gold)", "Panels.load('schedule')")}
      ${kpiBar("⚠️", overdueTasks.length, "مهام متأخرة", "Overdue Tasks", overdueTasks.length > 0 ? "var(--red)" : "var(--text3)", "Panels.load('tasks')")}
      ${kpiBar("🔔", pendingApprovals, "بانتظار الاعتماد", "Pending Approvals", pendingApprovals > 0 ? "var(--amber)" : "var(--text3)", "Panels.load('transcripts')")}
      ${kpiBar("✅", followDecisions.length, "قرارات تنتظر المتابعة", "Decisions Needing Follow-up", followDecisions.length > 0 ? "#a78bfa" : "var(--text3)", "Panels.load('governance')")}
    </div>`;

    body.innerHTML = `<div class="dashx dx2">
      <div class="dx2-cols">
        <div class="dx2-main">
          <div class="dx2-sec-t" style="display:flex;justify-content:space-between;align-items:center">
            <span>${lbl("الاجتماع القادم", "Next Meeting")}</span>
            <button class="btn-gold" style="font-size:12px;padding:6px 16px" onclick="Panels.load('create-meeting')">+ ${lbl("إنشاء اجتماع", "Create Meeting")}</button>
          </div>
          <div class="dx2-toprow">${heroCard}${lastCard}</div>
          <div class="dx2-sec-t">${lbl("المهام والمتابعة", "Tasks & Follow-up")}</div>
          <div class="dx2-3col">
            ${col("dx2-i-red", "⏰", lbl("مهام متأخرة", "Overdue Tasks"), overdueTasks.length, overdueTasks.slice(0, 3).map(taskRow).join(""), lbl("عرض كل المتأخرة", "View All Overdue"), "tasks")}
            ${col("dx2-i-amber", "📋", lbl("مهام معلّقة", "Pending Tasks"), pendingTasks.length, pendingTasks.slice(0, 3).map(taskRow).join(""), lbl("عرض كل المعلّقة", "View All Pending"), "tasks")}
            ${col("dx2-i-purple", "⚖️", lbl("قرارات تنتظر المتابعة", "Decisions Awaiting Follow-up"), followDecisions.length, followDecisions.slice(0, 3).map(decRow).join(""), lbl("عرض كل القرارات", "View All Decisions"), "tasks")}
          </div>
          ${alertsHtml ? `<div class="dx2-sec-t">${lbl("تنبيهات ذكية من أمين", "Smart Alerts from Ameen")}</div><div class="dx2-alerts">${alertsHtml}</div>` : ""}
        </div>
        <div class="dx2-side">${askCard}${tlCard}</div>
      </div>
    </div>`;
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

// ══ Dashboard → Ask Ameen hand-off ══════════════════════════════════════════════
const DashAsk = {
  _send(q) {
    Panels.load("ask");
    if (!q) return;
    setTimeout(() => {
      const ci = document.getElementById("ci");
      if (ci) {
        ci.value = q;
        Chat.send();
      }
    }, 150);
  },
  go() {
    const inp = document.getElementById("dx2-ask-q");
    this._send(((inp && inp.value) || "").trim());
  },
  quick(btn) {
    this._send(btn.getAttribute("data-q") || "");
  },
};

// ══ Dashboard Customizer (persists which widgets are visible) ═══════════════════
const Dash = {
  key: "ameen_dash_cfg",
  defaults: { stats: true, intel: true, team: true, upcoming: true, overdue: true },
  get() {
    try {
      return {
        ...this.defaults,
        ...JSON.parse(localStorage.getItem(this.key) || "{}"),
      };
    } catch {
      return { ...this.defaults };
    }
  },
  set(k, v) {
    const c = this.get();
    c[k] = v;
    localStorage.setItem(this.key, JSON.stringify(c));
    renderOverview();
  },
  bar(l) {
    const c = this.get();
    const item = (
      k,
      ar,
      en,
    ) => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text3);cursor:pointer">
      <input type="checkbox" ${c[k] !== false ? "checked" : ""} onchange="Dash.set('${k}', this.checked)" style="width:15px;height:15px;accent-color:var(--gold)">${l === "ar" ? ar : en}</label>`;
    return `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
        <span style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">⚙️ ${l === "ar" ? "تخصيص" : "Customize"}</span>
        ${item("stats", "الإحصائيات", "Stats")}
        ${item("intel", "ذكاء اللوحة", "Intelligence")}
        ${item("team", "أداء الفريق", "Team")}
        ${item("upcoming", "الاجتماعات القادمة", "Upcoming")}
        ${item("overdue", "المهام المتأخرة", "Overdue")}
      </div>
    </div>`;
  },
};

// ══ Admin Panel (Role Management) ═════════════════════════════════════════════
async function renderAdminPanel() {
  await AdminPanel.render();
}

// ══ Role Management (Phase 4 enterprise RBAC) ═══════════════════════════════
const AdminPanel = {
  _tab: "users",
  _rolesCache: null,
  _catalogCache: null,
  _permQuery: "",
  _roleQuery: "",
  _cloneSourceId: null,

  async render() {
    const body = $("admin-body");
    if (!body) return;
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      if (this._tab === "users") await this.renderUsersTab(body);
      else if (this._tab === "matrix") await this.renderMatrixTab(body);
      else if (this._tab === "audit") await this.renderAuditTab(body);
      else if (this._tab === "org") await this.renderOrgTab(body);
    } catch (e) {
      body.innerHTML = `<div class="es" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  },

  setTab(tab) {
    this._tab = tab;
    document.querySelectorAll("#admin-tabs .imp-seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    this.render();
  },

  async _loadRoles(force) {
    if (!this._rolesCache || force) this._rolesCache = await api("/api/rbac/roles");
    return this._rolesCache;
  },
  async _loadCatalog() {
    if (!this._catalogCache) this._catalogCache = await api("/api/rbac/permissions");
    return this._catalogCache;
  },

  // ── Tab 1: User Role Assignments (existing capability, dynamic role list) ──
  async renderUsersTab(body) {
    const l = App.lang;
    const [members, roles] = await Promise.all([api("/api/members"), this._loadRoles()]);
    const activeRoles = roles.filter((r) => r.is_active);
    body.innerHTML = `
      <div class="card">
        <div class="ct" style="margin-bottom:6px">👑 ${l === "ar" ? "إدارة صلاحيات المستخدمين" : "User Role Management"}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px;line-height:1.6">${l === "ar" ? "حدّد دور كل مستخدم في النظام. يتحكم الدور في اللوحات ومستوى الوصول المتاح." : "Assign each user a system role. Roles control which panels and features are accessible."}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${members
            .map((m) => {
              const name = l === "ar" ? m.name_ar : m.name_en || m.name_ar;
              const jobRole = l === "ar" ? m.role_ar || "" : m.role_en || m.role_ar || "";
              const initials = name.split(" ").slice(0, 2).map((w) => w[0] || "").join("");
              const sysRole = m.system_role || "Admin";
              const color = ROLE_COLORS[sysRole] || "var(--text3)";
              return `<div style="display:flex;align-items:center;gap:10px;background:var(--navy3);border:1px solid var(--border2);border-radius:10px;padding:11px 14px;flex-wrap:wrap">
              <div class="uav" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${esc(initials)}</div>
              <div style="flex:1;min-width:130px">
                <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(name)}</div>
                <div style="font-size:11px;color:var(--text3)">${esc(jobRole)} · ${esc(m.email)}</div>
              </div>
              <select class="fi" style="width:auto;min-width:170px;font-size:12px;padding:6px 10px"
                onchange="AdminPanel.changeRole(${m.id}, this.value)">
                ${activeRoles.map((r) => `<option value="${r.role_key}" ${sysRole === r.role_key ? "selected" : ""}>${esc(l === "ar" ? r.name_ar : r.name_en)}</option>`).join("")}
              </select>
              <span id="role-badge-${m.id}" style="font-size:11px;padding:3px 9px;border-radius:12px;border:1px solid ${color}44;color:${color};background:${color}14;white-space:nowrap">${esc(sysRole)}</span>
            </div>`;
            })
            .join("")}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="ct" style="margin-bottom:10px">ℹ️ ${l === "ar" ? "شرح الأدوار" : "Role Descriptions"}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;font-size:11px">
          ${roles
            .map((r) => {
              const c = ROLE_COLORS[r.role_key] || "#888";
              const d = l === "ar" ? r.description_ar : (r.description_en || r.description_ar);
              return `<div style="background:var(--navy3);border-radius:8px;padding:9px 11px;border-inline-start:3px solid ${c};opacity:${r.is_active ? 1 : 0.5}">
                <div style="color:${c};font-weight:700;margin-bottom:3px">${esc(l === "ar" ? r.name_ar : r.name_en)}${!r.is_active ? ` (${l === "ar" ? "معطّل" : "disabled"})` : ""}</div>
                <div style="color:var(--text3)">${esc(d || "")}</div>
              </div>`;
            })
            .join("")}
        </div>
      </div>`;
  },

  async changeRole(userId, role) {
    try {
      await api(`/api/members/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ system_role: role }),
      });
      const badge = $(`role-badge-${userId}`);
      if (badge) {
        const color = ROLE_COLORS[role] || "var(--text3)";
        badge.textContent = role;
        badge.style.color = color;
        badge.style.borderColor = color + "44";
        badge.style.background = color + "14";
      }
      if (App.user && userId == App.user.id) {
        App.systemRole = role;
        applySidebarRoles();
        App.renderUser();
        try { const mp = await api("/api/rbac/my-permissions"); App.permissions = new Set(mp.permissions || []); } catch (_) {}
      }
      showToast(App.lang === "ar" ? `تم تحديث الدور إلى ${role}` : `Role updated to ${role}`);
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  // ── Tab 2: Permission Matrix ────────────────────────────────────────────
  async renderMatrixTab(body) {
    const l = App.lang;
    const [roles, { catalog, categories }] = await Promise.all([this._loadRoles(true), this._loadCatalog()]);
    const q = this._permQuery.toLowerCase();
    const rq = this._roleQuery.toLowerCase();
    const visibleRoles = roles.filter((r) => {
      if (!rq) return true;
      return (r.name_ar || "").toLowerCase().includes(rq) || (r.name_en || "").toLowerCase().includes(rq) || r.role_key.toLowerCase().includes(rq);
    });
    const visiblePerms = catalog.filter((p) => {
      if (!q) return true;
      return p.label_ar.toLowerCase().includes(q) || p.label_en.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || p.category.includes(q);
    });
    const cats = [...new Set(visiblePerms.map((p) => p.category))];

    const roleHeaderHtml = visibleRoles.map((r) => `
      <th style="min-width:110px;text-align:center;position:relative">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <span style="color:${ROLE_COLORS[r.role_key] || 'var(--text2)'};opacity:${r.is_active ? 1 : 0.5}">${esc(l === "ar" ? r.name_ar : r.name_en)}</span>
          <div style="display:flex;gap:3px">
            <button class="btn-ghost btn-sm" style="padding:1px 5px;font-size:10px" title="${l === "ar" ? "استنساخ" : "Clone"}" onclick="AdminPanel.openCloneRole(${r.id})">📋</button>
            ${!r.is_builtin ? `<button class="btn-ghost btn-sm" style="padding:1px 5px;font-size:10px;color:var(--red)" title="${l === "ar" ? "حذف" : "Delete"}" onclick="AdminPanel.deleteRole(${r.id})">🗑</button>` : ""}
            <button class="btn-ghost btn-sm" style="padding:1px 5px;font-size:10px" title="${r.is_active ? (l === "ar" ? "تعطيل" : "Disable") : (l === "ar" ? "تفعيل" : "Enable")}" onclick="AdminPanel.toggleActive(${r.id}, ${r.is_active})">${r.is_active ? "🔓" : "🔒"}</button>
          </div>
          <button class="btn-gold btn-sm" id="save-role-${r.id}" style="display:none;padding:2px 8px;font-size:10px" onclick="AdminPanel.savePermissions(${r.id})">💾 ${l === "ar" ? "حفظ" : "Save"}</button>
        </div>
      </th>`).join("");

    const rowsHtml = cats.map((cat) => {
      const catMeta = categories[cat] || { ar: cat, en: cat };
      const catRows = visiblePerms.filter((p) => p.category === cat).map((p) => `
        <tr>
          <td style="white-space:nowrap;color:var(--text2)">${esc(l === "ar" ? p.label_ar : p.label_en)}</td>
          ${visibleRoles.map((r) => `
            <td style="text-align:center">
              <input type="checkbox" ${r.permissions.includes(p.key) ? "checked" : ""}
                onchange="AdminPanel.togglePermCell(${r.id}, '${p.key}', this.checked)"/>
            </td>`).join("")}
        </tr>`).join("");
      return `<tr><td colspan="${visibleRoles.length + 1}" style="background:var(--navy2);font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--gold);padding:6px 8px">${esc(l === "ar" ? catMeta.ar : catMeta.en)}</td></tr>${catRows}`;
    }).join("");

    body.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div class="ct">🔐 ${l === "ar" ? "مصفوفة الصلاحيات" : "Permission Matrix"}</div>
          <button class="btn-gold btn-sm" onclick="AdminPanel.openCreateRole()">+ ${l === "ar" ? "دور جديد" : "New Role"}</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <input type="search" class="fi" style="max-width:260px" placeholder="${l === "ar" ? "بحث عن صلاحية..." : "Search permissions..."}" oninput="AdminPanel.onPermSearch(this.value)"/>
          <input type="search" class="fi" style="max-width:220px" placeholder="${l === "ar" ? "تصفية الأدوار..." : "Filter roles..."}" oninput="AdminPanel.onRoleSearch(this.value)"/>
        </div>
        <div class="exec-actions-table-wrap" style="max-height:65vh;overflow:auto">
          <table class="exec-actions-table" style="min-width:${300 + visibleRoles.length * 120}px">
            <thead><tr><th style="position:sticky;inset-inline-start:0;background:var(--navy2);z-index:2"></th>${roleHeaderHtml}</tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="${visibleRoles.length + 1}" style="text-align:center;color:var(--text3);padding:20px">${l === "ar" ? "لا توجد نتائج" : "No results"}</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  },

  onPermSearch(v) {
    this._permQuery = v || "";
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.renderMatrixTab($("admin-body")), 250);
  },
  onRoleSearch(v) {
    this._roleQuery = v || "";
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.renderMatrixTab($("admin-body")), 250);
  },

  togglePermCell(roleId, permKey, checked) {
    const role = (this._rolesCache || []).find((r) => r.id === roleId);
    if (!role) return;
    if (checked && !role.permissions.includes(permKey)) role.permissions.push(permKey);
    if (!checked) role.permissions = role.permissions.filter((p) => p !== permKey);
    const btn = $(`save-role-${roleId}`);
    if (btn) btn.style.display = "";
  },

  async savePermissions(roleId) {
    const role = (this._rolesCache || []).find((r) => r.id === roleId);
    if (!role) return;
    const l = App.lang;
    try {
      await api(`/api/rbac/roles/${roleId}`, { method: "PATCH", body: JSON.stringify({ permissions: role.permissions }) });
      const btn = $(`save-role-${roleId}`);
      if (btn) btn.style.display = "none";
      if (App.user && App.systemRole === role.role_key) {
        try { const mp = await api("/api/rbac/my-permissions"); App.permissions = new Set(mp.permissions || []); } catch (_) {}
      }
      showToast(l === "ar" ? "✓ تم حفظ الصلاحيات" : "✓ Permissions saved");
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  async toggleActive(roleId, currentlyActive) {
    try {
      await api(`/api/rbac/roles/${roleId}`, { method: "PATCH", body: JSON.stringify({ is_active: currentlyActive ? 0 : 1 }) });
      await this.renderMatrixTab($("admin-body"));
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  async deleteRole(roleId) {
    const l = App.lang;
    if (!confirm(l === "ar" ? "هل تريد حذف هذا الدور؟" : "Delete this role?")) return;
    try {
      await api(`/api/rbac/roles/${roleId}`, { method: "DELETE" });
      await this.renderMatrixTab($("admin-body"));
    } catch (e) {
      showToast(e.message, "error");
    }
  },

  openCreateRole() {
    this._cloneSourceId = null;
    const l = App.lang;
    $("role-modal-title").textContent = l === "ar" ? "دور جديد" : "New Role";
    ["role-key", "role-name-ar", "role-name-en", "role-desc-ar", "role-desc-en"].forEach((id) => { if ($(id)) $(id).value = ""; });
    $("role-key").disabled = false;
    $("modal-role").classList.add("open");
  },

  openCloneRole(roleId) {
    const role = (this._rolesCache || []).find((r) => r.id === roleId);
    if (!role) return;
    this._cloneSourceId = roleId;
    const l = App.lang;
    $("role-modal-title").textContent = l === "ar" ? `استنساخ: ${role.name_ar}` : `Clone: ${role.name_en}`;
    $("role-key").value = "";
    $("role-key").disabled = false;
    $("role-name-ar").value = `${role.name_ar} (${l === "ar" ? "نسخة" : "Copy"})`;
    $("role-name-en").value = `${role.name_en} (Copy)`;
    $("role-desc-ar").value = role.description_ar || "";
    $("role-desc-en").value = role.description_en || "";
    $("modal-role").classList.add("open");
  },

  closeRoleModal() {
    $("modal-role").classList.remove("open");
  },

  async saveRoleModal() {
    const l = App.lang;
    const role_key = $("role-key").value.trim();
    const name_ar = $("role-name-ar").value.trim();
    const name_en = $("role-name-en").value.trim();
    if (!role_key || !name_ar || !name_en) {
      alert(l === "ar" ? "يرجى تعبئة المفتاح والاسم بكلا اللغتين" : "Please fill in the key and both name fields");
      return;
    }
    const payload = {
      role_key, name_ar, name_en,
      description_ar: $("role-desc-ar").value.trim(),
      description_en: $("role-desc-en").value.trim(),
    };
    try {
      if (this._cloneSourceId) {
        await api(`/api/rbac/roles/${this._cloneSourceId}/clone`, { method: "POST", body: JSON.stringify(payload) });
      } else {
        await api("/api/rbac/roles", { method: "POST", body: JSON.stringify(Object.assign({ permissions: [] }, payload)) });
      }
      this.closeRoleModal();
      await this.renderMatrixTab($("admin-body"));
      showToast(l === "ar" ? "✓ تم الحفظ" : "✓ Saved");
    } catch (e) {
      alert(e.message);
    }
  },

  // ── Tab 3: Audit Log ────────────────────────────────────────────────────
  async renderOrgTab(body) {
    const l = App.lang;
    let s = {};
    try { s = await api('/api/settings/org'); } catch(e) { /* non-admin fallback */ }
    const fi = (id, lbl, val='', ph='') => `<div class="frow"><div class="fl" style="font-size:11.5px">${lbl}</div><input class="fi" id="orgs-${id}" value="${esc(val)}" placeholder="${ph}" dir="${id.endsWith('en') ? 'ltr' : 'auto'}" style="${id.endsWith('en') ? 'text-align:left' : ''}"/></div>`;
    const fsel = (id, lbl, val, opts) => `<div class="frow"><div class="fl" style="font-size:11.5px">${lbl}</div><select class="fi" id="orgs-${id}">${opts.map(o=>`<option value="${o.v}"${val===o.v?' selected':''}>${o.l}</option>`).join('')}</select></div>`;
    body.innerHTML = `
      <div class="card">
        <div class="ct" style="margin-bottom:12px">🏢 ${l === 'ar' ? 'إعدادات المنظمة' : 'Organisation Settings'}</div>
        <div class="fr2">
          ${fi('org_name_ar', l==='ar'?'اسم المنظمة (عربي)':'Org Name (Arabic)', s.org_name_ar||'', l==='ar'?'شركة أمين':'Ameen Corp')}
          ${fi('org_name_en', l==='ar'?'اسم المنظمة (إنجليزي)':'Org Name (English)', s.org_name_en||'', 'Ameen Corp')}
        </div>
        ${fi('org_logo_url', l==='ar'?'رابط شعار المنظمة':'Logo URL', s.org_logo_url||'', 'https://...')}
        <div class="fr2">
          ${fsel('default_reminder_mins', l==='ar'?'وقت إرسال التذكير (قبل الاجتماع)':'Default Reminder Time', s.default_reminder_mins||'15', [
            {v:'5',l:'5 '+( l==='ar'?'دقائق':'min')},{v:'10',l:'10 '+(l==='ar'?'دقائق':'min')},
            {v:'15',l:'15 '+(l==='ar'?'دقيقة':'min')},{v:'30',l:'30 '+(l==='ar'?'دقيقة':'min')},
            {v:'60',l:l==='ar'?'ساعة واحدة':'1 hour'},{v:'120',l:l==='ar'?'ساعتان':'2 hours'},
          ])}
          ${fsel('default_meeting_duration', l==='ar'?'مدة الاجتماع الافتراضية':'Default Meeting Duration', s.default_meeting_duration||'60', [
            {v:'30',l:'30 '+(l==='ar'?'دقيقة':'min')},{v:'60',l:'60 '+(l==='ar'?'دقيقة':'min')},
            {v:'90',l:'90 '+(l==='ar'?'دقيقة':'min')},{v:'120',l:'120 '+(l==='ar'?'دقيقة':'min')},
          ])}
        </div>
        ${fsel('default_lang', l==='ar'?'اللغة الافتراضية':'Default Language', s.default_lang||'ar', [
          {v:'ar',l:'العربية / Arabic'},{v:'en',l:'English / الإنجليزية'},
        ])}
        <div id="orgs-err" style="display:none;font-size:11px;color:var(--red);margin-top:4px"></div>
        <div id="orgs-ok" style="display:none;font-size:11px;color:var(--green);margin-top:4px">${l==='ar'?'✓ تم الحفظ':'✓ Saved'}</div>
        <div class="fa" style="margin-top:14px">
          <button class="btn-gold" onclick="AdminPanel.saveOrg()">${l==='ar'?'حفظ الإعدادات':'Save Settings'}</button>
        </div>
      </div>`;
  },

  async saveOrg() {
    const l = App.lang;
    const keys = ['org_name_ar','org_name_en','org_logo_url','default_reminder_mins','default_meeting_duration','default_lang'];
    const payload = {};
    keys.forEach(k => { const el = $(`orgs-${k}`); if (el) payload[k] = el.value; });
    const errEl = $('orgs-err'); const okEl = $('orgs-ok');
    if(errEl) errEl.style.display='none'; if(okEl) okEl.style.display='none';
    try {
      await api('/api/settings/org', { method: 'PATCH', body: JSON.stringify(payload) });
      if(okEl) okEl.style.display='block';
    } catch(e) {
      if(errEl) { errEl.textContent=e.message; errEl.style.display='block'; }
    }
  },

  async renderAuditTab(body) {
    const l = App.lang;
    const log = await api("/api/rbac/audit-log?limit=200");
    body.innerHTML = `
      <div class="card">
        <div class="ct" style="margin-bottom:10px">🕐 ${l === "ar" ? "سجل تدقيق الصلاحيات" : "Permission Audit Log"}</div>
        ${log.length
          ? `<div style="display:flex;flex-direction:column;gap:6px">
            ${log.map((entry) => {
              const added = entry.new_value.filter((p) => !entry.old_value.includes(p));
              const removed = entry.old_value.filter((p) => !entry.new_value.includes(p));
              return `<div style="padding:9px 12px;background:var(--navy3);border-radius:8px;font-size:11.5px">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
                  <span><strong>${esc(entry.actor_name || "—")}</strong> ${l === "ar" ? "قام بـ" : "performed"} <span class="tag" style="background:var(--navy4)">${esc(entry.action)}</span> ${l === "ar" ? "على الدور" : "on role"} <strong>${esc(entry.role_key)}</strong></span>
                  <span style="color:var(--text3)">${(entry.created_at || "").substring(0, 16)}</span>
                </div>
                ${added.length ? `<div style="color:var(--green);margin-top:4px">+ ${added.join(", ")}</div>` : ""}
                ${removed.length ? `<div style="color:var(--red);margin-top:2px">- ${removed.join(", ")}</div>` : ""}
              </div>`;
            }).join("")}
          </div>`
          : `<div class="es"><div style="color:var(--text3);font-size:12px">${l === "ar" ? "لا يوجد سجل تدقيق بعد" : "No audit history yet"}</div></div>`}
      </div>`;
  },
};

// ══ Integration Center ═════════════════════════════════════════════════════════
const Integrations = {
  _provider: null,
  _CREDS: {
    zoom: ['client_id', 'client_secret', 'account_id'],
    teams: ['app_id', 'client_secret', 'tenant_id'],
    google_meet: ['oauth_client_id', 'oauth_client_secret', 'service_account_json'],
  },
  _LABELS: {
    zoom: { ar: 'Zoom', en: 'Zoom' },
    teams: { ar: 'Microsoft Teams', en: 'Microsoft Teams' },
    google_meet: { ar: 'Google Meet', en: 'Google Meet' },
  },

  async configure(provider) {
    this._provider = provider;
    const l = App.lang;
    const name = this._LABELS[provider] ? (l === 'ar' ? this._LABELS[provider].ar : this._LABELS[provider].en) : provider;
    const title = $('intcfg-title');
    if (title) title.textContent = `⚙ ${l === 'ar' ? 'إعداد' : 'Configure'} ${name}`;
    const body = $('intcfg-body');
    if (!body) return;
    body.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    const m = $('modal-integration-config');
    if (m) m.style.display = 'flex';
    let existing = {};
    try { existing = await api(`/api/settings/integration/${provider}`); } catch (e) {}
    const keys = this._CREDS[provider] || [];
    const isConfigured = existing.configured === '1';
    body.innerHTML = `
      ${isConfigured ? `<div style="font-size:11.5px;color:var(--green);margin-bottom:12px;padding:6px 10px;background:rgba(46,204,138,.1);border-radius:6px;border:1px solid rgba(46,204,138,.25)">✓ ${l === 'ar' ? 'متصل ومُعدّ' : 'Connected & Configured'}</div>` : ''}
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.6">${l === 'ar' ? 'أدخل بيانات الاعتماد للتكامل. تُحفظ بشكل مشفّر في قاعدة البيانات.' : 'Enter your API credentials. They are stored securely in the database.'}</div>
      ${keys.map(k => `<div class="frow"><div class="fl" style="font-size:11.5px">${k.replace(/_/g,' ')}</div><input class="fi" id="intcfg-${k}" dir="ltr" style="text-align:left;font-size:12px" placeholder="${k}" value="${esc(existing[k] || '')}"/></div>`).join('')}
      <div id="intcfg-err" style="display:none;font-size:11px;color:var(--red);margin-top:4px"></div>
      <div class="fa" style="margin-top:12px">
        <button class="btn-gold" onclick="Integrations.save()">✓ ${l === 'ar' ? 'حفظ' : 'Save'}</button>
        <button class="btn-ghost" onclick="Integrations.closeModal()">${l === 'ar' ? 'إغلاق' : 'Close'}</button>
      </div>`;
  },

  async save() {
    const provider = this._provider;
    if (!provider) return;
    const keys = this._CREDS[provider] || [];
    const payload = {};
    keys.forEach(k => { const el = $(`intcfg-${k}`); if (el) payload[k] = el.value; });
    const errEl = $('intcfg-err');
    try {
      await api(`/api/settings/integration/${provider}`, { method: 'POST', body: JSON.stringify(payload) });
      this.closeModal();
      showToast(App.lang === 'ar' ? '✓ تم حفظ إعدادات التكامل' : '✓ Integration settings saved', 'success');
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    }
  },

  closeModal() {
    const m = $('modal-integration-config');
    if (m) m.style.display = 'none';
  },
};

function renderIntegrations() {
  const body = $('integrations-body');
  if (!body) return;
  const l = App.lang;

  const PROVIDERS = [
    {
      id: 'zoom',
      icon: '🎥',
      name: 'Zoom',
      color: '#2D8CFF',
      badge_bg: 'rgba(45,140,255,.12)',
      border: 'rgba(45,140,255,.35)',
      features_ar: ['إنشاء اجتماع مباشر من المنصة', 'استيراد التسجيل السحابي تلقائياً', 'استيراد النص التلقائي (Auto-transcript)', 'مزامنة التقويم'],
      features_en: ['Create meetings directly from platform', 'Auto-import cloud recordings', 'Import Zoom auto-transcripts', 'Calendar sync'],
      creds_ar: ['Client ID (مفتاح التطبيق)', 'Client Secret (سر التطبيق)', 'Account ID أو OAuth Token'],
      creds_en: ['Client ID', 'Client Secret', 'Account ID or OAuth Token'],
      docs: 'https://marketplace.zoom.us/docs/api-reference/introduction',
    },
    {
      id: 'teams',
      icon: '💼',
      name: 'Microsoft Teams',
      color: '#6264A7',
      badge_bg: 'rgba(98,100,167,.12)',
      border: 'rgba(98,100,167,.35)',
      features_ar: ['مزامنة التقويم مع Microsoft 365', 'توليد رابط اجتماع Teams', 'استيراد التسجيل السحابي', 'استيراد نسخ النصوص (Teams Transcripts)'],
      features_en: ['Microsoft 365 calendar sync', 'Teams meeting link generation', 'Cloud recording import', 'Teams transcript import'],
      creds_ar: ['App ID / Client ID', 'Client Secret', 'Tenant ID (معرّف المستأجر)'],
      creds_en: ['App ID / Client ID', 'Client Secret', 'Tenant ID'],
      docs: 'https://learn.microsoft.com/en-us/graph/teams-concept-overview',
    },
    {
      id: 'google_meet',
      icon: '🎦',
      name: 'Google Meet',
      color: '#00897B',
      badge_bg: 'rgba(0,137,123,.12)',
      border: 'rgba(0,137,123,.35)',
      features_ar: ['مزامنة Google Calendar', 'توليد رابط اجتماع Meet', 'استيراد التسجيل (Google Drive)', 'نسخ النصوص عبر Google Workspace'],
      features_en: ['Google Calendar sync', 'Meet link generation', 'Recording import from Google Drive', 'Transcripts via Google Workspace'],
      creds_ar: ['OAuth 2.0 Client ID', 'OAuth 2.0 Client Secret', 'مفتاح حساب الخدمة (Service Account)'],
      creds_en: ['OAuth 2.0 Client ID', 'OAuth 2.0 Client Secret', 'Service Account key (JSON)'],
      docs: 'https://developers.google.com/workspace/meet/api/reference',
    },
  ];

  const card = (p) => `
    <div style="background:var(--navy3);border:1.5px solid ${p.border};border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:11px">
        <div style="width:46px;height:46px;border-radius:12px;background:${p.badge_bg};border:1px solid ${p.border};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">${p.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:${p.color}">${p.name}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f0a000;flex-shrink:0"></span>
            <span style="font-size:11px;color:#f0a000">${l==='ar'?'التكامل جاهز — تتطلب بيانات اعتماد API':'Integration Ready - API credentials required'}</span>
          </div>
        </div>
        <button onclick="Integrations.configure('${p.id}')"
          style="padding:7px 15px;border-radius:8px;background:${p.badge_bg};color:${p.color};border:1px solid ${p.border};font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">
          ⚙ ${l==='ar'?'إعداد':'Configure'}
        </button>
      </div>

      <div>
        <div style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:7px">${l==='ar'?'الميزات المتاحة عند الربط':'Features upon connection'}</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${(l==='ar'?p.features_ar:p.features_en).map(f=>`
            <div style="display:flex;align-items:center;gap:7px">
              <span style="width:6px;height:6px;border-radius:50%;background:${p.color};opacity:.5;flex-shrink:0"></span>
              <span style="font-size:11.5px;color:var(--text2);flex:1">${f}</span>
              <span style="font-size:10.5px;padding:1px 7px;border-radius:10px;background:rgba(255,160,0,.10);color:#f0a000;border:.5px solid rgba(255,160,0,.25);white-space:nowrap">${l==='ar'?'بانتظار الربط':'Pending'}</span>
            </div>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
        <div style="background:var(--navy2);border-radius:8px;padding:8px 10px;border:.5px solid var(--border2)">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:3px">${l==='ar'?'حالة الاتصال':'Connection'}</div>
          <div style="font-size:11px;font-weight:600;color:#888">${l==='ar'?'غير متصل':'Not Connected'}</div>
        </div>
        <div style="background:var(--navy2);border-radius:8px;padding:8px 10px;border:.5px solid var(--border2)">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:3px">${l==='ar'?'آخر مزامنة':'Last Sync'}</div>
          <div style="font-size:11px;font-weight:600;color:#888">${l==='ar'?'لم تتم بعد':'Never'}</div>
        </div>
        <div style="background:var(--navy2);border-radius:8px;padding:8px 10px;border:.5px solid var(--border2)">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:3px">${l==='ar'?'استيراد التسجيل':'Recording Import'}</div>
          <div style="font-size:11px;font-weight:600;color:#888">${l==='ar'?'غير فعّال':'Inactive'}</div>
        </div>
        <div style="background:var(--navy2);border-radius:8px;padding:8px 10px;border:.5px solid var(--border2)">
          <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:3px">${l==='ar'?'استيراد النص':'Transcript Import'}</div>
          <div style="font-size:11px;font-weight:600;color:#888">${l==='ar'?'غير فعّال':'Inactive'}</div>
        </div>
      </div>

      <details style="background:var(--navy2);border-radius:9px;border:.5px solid var(--border2);overflow:hidden">
        <summary style="padding:9px 12px;font-size:11px;font-weight:700;color:var(--text3);cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px">
          <span>🔑</span>
          <span style="flex:1">${l==='ar'?'بيانات الاعتماد المطلوبة':'Required Credentials'}</span>
          <span style="font-size:11px">▾</span>
        </summary>
        <div style="padding:0 12px 11px">
          ${(l==='ar'?p.creds_ar:p.creds_en).map(c=>`
            <div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-top:.5px solid var(--border2);font-size:11.5px;color:var(--text2)">
              <span style="color:${p.color};font-size:13px">•</span>${c}
            </div>`).join('')}
          <div style="margin-top:9px;padding-top:9px;border-top:.5px solid var(--border2)">
            <a href="${p.docs}" target="_blank" rel="noopener" style="font-size:11.5px;color:${p.color};text-decoration:none;display:inline-flex;align-items:center;gap:4px">
              📖 ${l==='ar'?'توثيق المطورين ↗':'Developer Docs ↗'}
            </a>
          </div>
        </div>
      </details>
    </div>`;

  body.innerHTML = `
    <div style="padding:14px 16px;background:linear-gradient(135deg,rgba(45,140,255,.07),rgba(98,100,167,.05));border:1px solid rgba(45,140,255,.22);border-radius:12px;margin-bottom:20px;display:flex;align-items:flex-start;gap:11px">
      <span style="font-size:24px;flex-shrink:0">🔗</span>
      <div>
        <div style="font-size:13.5px;font-weight:700;color:var(--text);margin-bottom:4px">${l==='ar'?'ربط منصة الاجتماعات':'Connect Your Meeting Platform'}</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.75;max-width:640px">${l==='ar'
          ? 'اربط Zoom أو Microsoft Teams أو Google Meet لاستيراد التسجيلات والنصوص تلقائياً بعد كل اجتماع — دون أي تدخل يدوي. حتى إتمام الربط، يمكنك رفع الملفات يدوياً من صفحة <strong style="color:var(--gold)">تسجيل اجتماع</strong>.'
          : 'Connect Zoom, Microsoft Teams, or Google Meet to automatically import recordings and transcripts after every meeting — no manual steps needed. Until then, upload files manually from the <strong style="color:var(--gold)">Record Meeting</strong> page.'}</div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <span style="font-size:11px;padding:2px 9px;border-radius:5px;background:rgba(46,204,138,.12);color:#2ecc8a;border:.5px solid rgba(46,204,138,.30)">✓ ${l==='ar'?'البنية التحتية جاهزة':'Infrastructure ready'}</span>
          <span style="font-size:11px;padding:2px 9px;border-radius:5px;background:rgba(255,160,0,.10);color:#f0a000;border:.5px solid rgba(255,160,0,.25)">⏳ ${l==='ar'?'بانتظار بيانات اعتماد API':'Awaiting API credentials'}</span>
          <span style="font-size:11px;padding:2px 9px;border-radius:5px;background:rgba(91,155,214,.10);color:#5B9BD6;border:.5px solid rgba(91,155,214,.25)">📤 ${l==='ar'?'الرفع اليدوي متاح الآن':'Manual upload available now'}</span>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:20px">
      ${PROVIDERS.map(p => card(p)).join('')}
    </div>

    <div style="padding:11px 15px;background:var(--navy3);border-radius:10px;border:.5px solid var(--border2);font-size:11.5px;color:var(--text3);line-height:1.75">
      💡 <strong style="color:var(--gold)">${l==='ar'?'نصيحة:':'Tip:'}</strong>
      ${l==='ar'
        ? 'يمكنك الآن رفع التسجيلات من Zoom وTeams وMeet يدوياً من قسم <strong style="color:var(--gold)">رفع تسجيل رسمي</strong> في صفحة التسجيل. يتم تصنيفها تلقائياً كـ "تسجيل كامل للاجتماع" وتظهر في أرشيف المحاضر مع شارة التحقق الخضراء.'
        : 'You can already upload Zoom, Teams, and Meet recordings manually from the <strong style="color:var(--gold)">Upload Official Recording</strong> section on the Record Meeting page. They are automatically classified as "Full Meeting Recording" and appear in the Transcripts archive with a green verification badge.'}
    </div>`;
}

// ══ Analytics Panel ════════════════════════════════════════════════════════════
async function renderAnalytics() {
  const body = $("analytics-body");
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const data = await api("/api/analytics");
    const l = App.lang;
    const lbl = (ar, en) => (l === "ar" ? ar : en);

    if (!window.Chart) {
      body.innerHTML = `<div class="es" style="color:var(--amber)">⚠ ${lbl("لم يتم تحميل مكتبة الرسوم البيانية", "Chart library not loaded")}</div>`;
      return;
    }

    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 18px;background:linear-gradient(135deg,var(--navy3),var(--navy2));border:1px solid var(--border2);border-radius:12px;margin-bottom:18px">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">📊 ${lbl("لوحة التحليلات التنفيذية","Executive Analytics")}</div>
          <div style="font-size:11.5px;color:var(--text3);line-height:1.65">${lbl("اتجاهات الأداء للاجتماعات والمهام والقرارات — بيانات حية مُجمَّعة من جميع الجلسات المسجلة","Performance trends for meetings, tasks and decisions — live data aggregated from all recorded sessions")}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(46,204,138,.1);color:var(--green);border:.5px solid rgba(46,204,138,.25);white-space:nowrap">📈 ${lbl("بيانات حية","Live Data")}</span>
        <button class="btn-ghost btn-sm" style="font-size:11px" onclick="Analytics.exportCSV()">⬇ ${lbl("تصدير CSV","Export CSV")}</button>
      </div>
      </div>
      <div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;padding-inline-start:2px">— ${lbl("الرسوم البيانية التفاعلية","Interactive Charts")} —</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <div class="ct" style="margin-bottom:10px;font-size:13px">📅 ${lbl("معدل حضور الاجتماعات", "Meeting Attendance Rate")}</div>
          <div style="position:relative;height:210px"><canvas id="cht-att-rate"></canvas></div>
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:10px;font-size:13px">⏱ ${lbl("متوسط مدة الاجتماعات", "Avg Meeting Duration")}</div>
          <div style="position:relative;height:210px"><canvas id="cht-duration"></canvas></div>
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:10px;font-size:13px">⚠️ ${lbl("المهام المتأخرة حسب المسؤول", "Overdue Tasks by Owner")}</div>
          <div style="position:relative;height:210px"><canvas id="cht-overdue-owner"></canvas></div>
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:10px;font-size:13px">⚖️ ${lbl("القرارات حسب نوع الاجتماع", "Decisions by Meeting Type")}</div>
          <div style="position:relative;height:210px"><canvas id="cht-dec-type"></canvas></div>
        </div>
      </div>
      <div id="team-performance-section"></div>
      <div id="risk-register-section" style="margin-top:16px"></div>
      <div class="card" style="margin-top:16px">
        <div class="ct" style="margin-bottom:12px;font-size:13px">📊 ${lbl("ملخص التحليلات", "Analytics Summary")}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;font-size:12px">
          ${[
            {
              icon: "📅",
              val: data.attendanceRates.length,
              label: lbl(
                "اجتماعات بمعلومات حضور",
                "Meetings with attendance data",
              ),
              color: "var(--blue)",
            },
            {
              icon: "⏱",
              val: data.durationTrend.length
                ? Math.round(
                    data.durationTrend.reduce((s, r) => s + r.avg_mins, 0) /
                      data.durationTrend.length,
                  ) +
                  " " +
                  lbl("د", "min")
                : "—",
              label: lbl("متوسط مدة الاجتماع", "Avg meeting duration"),
              color: "var(--gold)",
            },
            {
              icon: "⚠️",
              val: data.overdueByOwner.reduce((s, r) => s + r.count, 0),
              label: lbl("مهمة متأخرة إجمالاً", "Total overdue tasks"),
              color: "var(--red)",
            },
            {
              icon: "⚖️",
              val: data.decisionsByType.reduce((s, r) => s + r.count, 0),
              label: lbl("قرار مسجل", "Total decisions"),
              color: "var(--green)",
            },
          ]
            .map(
              (s) => `
            <div class="card" style="text-align:center;padding:14px 10px">
              <div style="font-size:22px;margin-bottom:4px">${s.icon}</div>
              <div style="font-size:22px;font-weight:800;color:${s.color}">${s.val}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:3px">${s.label}</div>
            </div>`,
            )
            .join("")}
        </div>
      </div>`;

    const base = _chartBase(l);

    const att = data.attendanceRates;
    Charts.render("cht-att-rate", {
      type: "bar",
      data: {
        labels: att.map((r) => {
          const t = l === "ar" ? r.title_ar : r.title_en || r.title_ar;
          return t.length > 18 ? t.substring(0, 16) + "…" : t;
        }),
        datasets: [
          {
            label: lbl("معدل الحضور %", "Attendance %"),
            data: att.map((r) => r.rate),
            backgroundColor: "#5B9BD666",
            borderColor: "#5B9BD6",
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        ...base,
        plugins: { ...base.plugins, legend: { display: false } },
        scales: { ...base.scales, y: { ...base.scales.y, max: 100 } },
      },
    });

    const dur = data.durationTrend;
    Charts.render("cht-duration", {
      type: "line",
      data: {
        labels: dur.map((r) => _monthLabel(r.month, l)),
        datasets: [
          {
            label: lbl("المدة (دقيقة)", "Duration (min)"),
            data: dur.map((r) => r.avg_mins),
            borderColor: "#C9A84C",
            backgroundColor: "#C9A84C22",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: "#C9A84C",
            pointRadius: 4,
          },
        ],
      },
      options: {
        ...base,
        plugins: { ...base.plugins, legend: { display: false } },
      },
    });

    const ow = data.overdueByOwner;
    Charts.render("cht-overdue-owner", {
      type: "bar",
      data: {
        labels: ow.map((r) =>
          l === "ar" ? r.owner_name_ar : r.owner_name_en || r.owner_name_ar,
        ),
        datasets: [
          {
            label: lbl("مهام متأخرة", "Overdue"),
            data: ow.map((r) => r.count),
            backgroundColor: "#E05A5A66",
            borderColor: "#E05A5A",
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        ...base,
        indexAxis: "y",
        plugins: { ...base.plugins, legend: { display: false } },
        scales: {
          x: {
            ...base.scales.x,
            ticks: { ...base.scales.x.ticks, stepSize: 1 },
          },
          y: {
            ticks: { color: "#808090", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
        },
      },
    });

    const dt = data.decisionsByType;
    const pieColors = [
      "#C9A84C",
      "#5B9BD6",
      "#2ECC8A",
      "#E05A5A",
      "#9370DB",
      "#EFA827",
      "#888",
    ];
    Charts.render("cht-dec-type", {
      type: "pie",
      data: {
        labels: dt.map((r) => r.meeting_type),
        datasets: [
          {
            data: dt.map((r) => r.count),
            backgroundColor: dt.map(
              (_, i) => pieColors[i % pieColors.length] + "bb",
            ),
            borderColor: dt.map((_, i) => pieColors[i % pieColors.length]),
            borderWidth: 2,
          },
        ],
      },
      options: _chartPie(),
    });

    if (App.can("actions.assign")) await renderTeamPerformance(l, lbl);
    await renderRiskRegister(l, lbl);
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
  }
}

// ── Team Performance — workload, department comparison, completion time,
// overdue trend, risk areas. Reuses GET /api/analytics/team-performance
// (built on the same computeTaskRollups() the Manager View and Dashboard
// Intelligence already use — no separate aggregation to keep in sync).
// actions.assign gated to match the backend; simply absent for anyone who
// doesn't manage a team, same pattern as the Manager View toggle in Tasks.
async function renderTeamPerformance(l, lbl) {
  const section = $("team-performance-section");
  if (!section) return;
  section.innerHTML = `<div class="es" style="padding:16px"><div class="loading"></div></div>`;
  let data;
  try {
    data = await api("/api/analytics/team-performance");
  } catch (e) {
    section.innerHTML = "";
    return;
  }

  const riskChips = (data.risk_areas || []).length
    ? data.risk_areas.map((d) => `<span class="tag" style="background:rgba(220,50,50,.12);color:var(--red);font-size:11px;margin-inline-end:6px;margin-bottom:6px;display:inline-block">⚠️ ${esc(d.department)} — ${d.ratio}% ${lbl("متأخرة", "overdue")}</span>`).join("")
    : `<span style="font-size:12px;color:var(--text3)">${lbl("لا توجد مخاطر عاجلة حالياً", "No urgent risk areas right now")}</span>`;

  section.innerHTML = `
    <div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin:22px 0 12px;padding-inline-start:2px">— ${lbl("أداء الفريق", "Team Performance")} —</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="ct" style="margin-bottom:10px;font-size:13px">👥 ${lbl("عبء العمل حسب الفرد", "Workload by Person")}</div>
        <div style="position:relative;height:220px"><canvas id="cht-tp-workload"></canvas></div>
      </div>
      <div class="card">
        <div class="ct" style="margin-bottom:10px;font-size:13px">🏢 ${lbl("مقارنة الأقسام — نسبة الإنجاز", "Department Comparison — Completion %")}</div>
        <div style="position:relative;height:220px"><canvas id="cht-tp-dept"></canvas></div>
      </div>
      <div class="card">
        <div class="ct" style="margin-bottom:10px;font-size:13px">📉 ${lbl("اتجاه التأخر الأسبوعي", "Weekly Overdue Trend")}</div>
        <div style="position:relative;height:220px"><canvas id="cht-tp-overdue-trend"></canvas></div>
      </div>
      <div class="card">
        <div class="ct" style="margin-bottom:10px;font-size:13px">⏱ ${lbl("متوسط زمن الإنجاز", "Average Completion Time")}</div>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:220px">
          <div style="font-size:36px;font-weight:800;color:var(--gold)">${data.avg_completion_days != null ? data.avg_completion_days : "—"}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px">${lbl("يوم (تقريبي، من آخر تحديث للمهمة المكتملة)", "days (approximate, based on each completed task's last update)")}</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="ct" style="margin-bottom:10px;font-size:13px">🚧 ${lbl("مناطق الخطر", "Risk Areas")}</div>
      <div>${riskChips}</div>
    </div>`;

  const base = _chartBase(l);
  const workload = [...data.workload].sort((a, b) => b.open - a.open).slice(0, 10);
  Charts.render("cht-tp-workload", {
    type: "bar",
    data: {
      labels: workload.map((p) => (l === "ar" ? p.name_ar : p.name_en || p.name_ar)),
      datasets: [{ label: lbl("إجراءات مفتوحة", "Open actions"), data: workload.map((p) => p.open), backgroundColor: "#C9A84Cbb", borderColor: "#C9A84C", borderWidth: 1.5, borderRadius: 4 }],
    },
    options: { ...base, indexAxis: "y", plugins: { ...base.plugins, legend: { display: false } } },
  });

  const dept = data.department_comparison || [];
  Charts.render("cht-tp-dept", {
    type: "bar",
    data: {
      labels: dept.map((d) => d.department),
      datasets: [{ label: lbl("نسبة الإنجاز %", "Completion %"), data: dept.map((d) => d.pct), backgroundColor: dept.map((d) => (d.overdue > 0 ? "#DC3232bb" : "#2ECC8Abb")), borderColor: dept.map((d) => (d.overdue > 0 ? "#DC3232" : "#2ECC8A")), borderWidth: 1.5, borderRadius: 4 }],
    },
    options: { ...base, plugins: { ...base.plugins, legend: { display: false } }, scales: { ...base.scales, y: { ...(base.scales && base.scales.y), min: 0, max: 100 } } },
  });

  const trend = data.overdue_trend || [];
  Charts.render("cht-tp-overdue-trend", {
    type: "line",
    data: {
      labels: trend.map((w) => _weekLabel(w.week_start, l)),
      datasets: [{ label: lbl("مهام متأخرة عند الاستحقاق", "Tasks late at due date"), data: trend.map((w) => w.late_count), borderColor: "#DC3232", backgroundColor: "#DC323222", fill: true, tension: 0.3 }],
    },
    options: base,
  });
}

// ══ Textarea auto-resize ══════════════════════════════════════════════════════
$("ci").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 100) + "px";
});

// ══ Bootstrap ══════════════════════════════════════════════════════════════════
window.__AMEEN_READY = true;
App.init();

// PASSWORD MANAGEMENT - Change Password
function openChangePassword() {
  var m = document.getElementById("modal-change-password");
  if (!m) return;
  ["cp-current", "cp-new", "cp-confirm"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["cp-error", "cp-success"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  m.style.display = "flex";
}
function closeChangePassword() {
  var m = document.getElementById("modal-change-password");
  if (m) m.style.display = "none";
}
async function submitChangePassword() {
  var cpv = (document.getElementById("cp-current") || {}).value || "",
    npv = (document.getElementById("cp-new") || {}).value || "",
    cfv = (document.getElementById("cp-confirm") || {}).value || "",
    errEl = document.getElementById("cp-error"),
    okEl = document.getElementById("cp-success"),
    btn = document.getElementById("cp-submit-btn");
  if (errEl) errEl.style.display = "none";
  if (okEl) okEl.style.display = "none";
  var l = App.lang;
  if (!cpv || !npv || !cfv) {
    if (errEl) {
      errEl.textContent = l === "ar" ? "يرجى تعبئة جميع الحقول" : "Please fill all fields";
      errEl.style.display = "block";
    }
    return;
  }
  if (npv.length < 8) {
    if (errEl) {
      errEl.textContent = l === "ar" ? "يجب أن تتكوّن كلمة المرور الجديدة من ٨ أحرف على الأقل" : "New password must be at least 8 characters";
      errEl.style.display = "block";
    }
    return;
  }
  if (npv !== cfv) {
    if (errEl) {
      errEl.textContent = l === "ar" ? "كلمتا المرور غير متطابقتين" : "Passwords do not match";
      errEl.style.display = "block";
    }
    return;
  }
  if (btn) btn.disabled = true;
  try {
    await api("/auth/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword: cpv, newPassword: npv }),
    });
    if (okEl) {
      okEl.textContent = l === "ar" ? "تم تغيير كلمة المرور بنجاح" : "Password changed successfully";
      okEl.style.display = "block";
    }
    ["cp-current", "cp-new", "cp-confirm"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    setTimeout(closeChangePassword, 2000);
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || (l === "ar" ? "حدث خطأ" : "Error");
      errEl.style.display = "block";
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
// PASSWORD MANAGEMENT - Admin Reset Password
var _resetTargetId = null;
function openResetPassword(userId, userName) {
  _resetTargetId = userId;
  var m = document.getElementById("modal-reset-password");
  if (!m) return;
  var inp = document.getElementById("rp-new");
  if (inp) inp.value = "";
  ["rp-error", "rp-success"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  var b = document.getElementById("rp-submit-btn");
  if (b) {
    b.style.display = "";
    b.disabled = false;
  }
  var nm = document.getElementById("rp-user-name");
  if (nm) nm.textContent = (App.lang === "ar" ? "إعادة تعيين كلمة المرور لـ: " : "Reset password for: ") + userName;
  m.style.display = "flex";
}
function closeResetPassword() {
  var m = document.getElementById("modal-reset-password");
  if (m) m.style.display = "none";
  _resetTargetId = null;
}
function generateResetPassword() {
  var c = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#";
  var p = "";
  for (var i = 0; i < 12; i++) p += c[Math.floor(Math.random() * c.length)];
  var el = document.getElementById("rp-new");
  if (el) el.value = p;
}
async function submitResetPassword() {
  var inp = document.getElementById("rp-new"),
    errEl = document.getElementById("rp-error"),
    okEl = document.getElementById("rp-success"),
    btn = document.getElementById("rp-submit-btn"),
    npv = inp ? inp.value.trim() : "";
  if (errEl) errEl.style.display = "none";
  if (okEl) okEl.style.display = "none";
  var l = App.lang;
  if (!npv || npv.length < 8) {
    if (errEl) {
      errEl.textContent = l === "ar" ? "يجب أن تتكوّن كلمة المرور من ٨ أحرف على الأقل" : "Password must be at least 8 characters";
      errEl.style.display = "block";
    }
    return;
  }
  if (!_resetTargetId) return;
  if (btn) btn.disabled = true;
  try {
    await api("/api/members/" + _resetTargetId + "/reset-password", {
      method: "POST",
      body: JSON.stringify({ newPassword: npv }),
    });
    if (okEl) {
      okEl.innerHTML = l === "ar"
        ? "تمت إعادة التعيين. كلمة المرور الجديدة: <strong>" + npv + "</strong><br><small>شارك هذه الكلمة مع المستخدم واطلب منه تغييرها فوراً.</small>"
        : "Reset done. New password: <strong>" + npv + "</strong><br><small>Share this and ask user to change it immediately.</small>";
      okEl.style.display = "block";
    }
    if (inp) inp.value = "";
    if (btn) btn.style.display = "none";
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || (l === "ar" ? "حدث خطأ" : "Error");
      errEl.style.display = "block";
    }
  } finally {
    if (btn && btn.style.display !== "none") btn.disabled = false;
  }
}

// ── Draft meeting 24h filter helper (used by renderTranscripts) ──────────────
function filterDraftMeetings(meetings) {
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  return meetings.filter(m => {
    if (m.status !== 'draft') return true;
    if (!m.created_at) return false;
    return new Date(m.created_at).getTime() > cutoff24h;
  });
}

// ══ ASK AMEEN FLOATING BUTTON ════════════════════════════════════════════════
const AskFAB = {
  open() {
    const ctx = Panels.current || "overview";
    const ctxLabels = {
      overview: "لوحة التحكم / Dashboard",
      scheduled: "الاجتماعات / Meetings",
      tasks: "المهام / Tasks",
      boards: "المجالس واللجان / Boards & Committees",
      policies: "السياسات / Policies",
      resolutions: "القرارات / Resolutions",
      documents: "الوثائق / Documents",
      analytics: "التقارير / Reports",
      integrations: "الإعدادات / Settings",
      admin: "إدارة الصلاحيات / Role Management",
    };
    AskFAB._pendingCtx = ctxLabels[ctx] || ctx;
    Panels.load("ask").then(() => {
      if (AskFAB._pendingCtx) {
        const hint = document.querySelector("#chat-input, #ask-input, textarea[data-ask]");
        if (hint && !hint.value) {
          hint.placeholder = (App.lang === "ar"
            ? `اسألني عن ${AskFAB._pendingCtx}…`
            : `Ask about ${AskFAB._pendingCtx}…`);
        }
        AskFAB._pendingCtx = null;
      }
    });
  },
  _pendingCtx: null,
};

// ── User Profile (self-service) ───────────────────────────────────────────────
const Profile = {
  async open() {
    const m = $('modal-profile');
    if (!m) return;
    ['prof-name-ar','prof-name-en','prof-email','prof-cur-pw','prof-new-pw','prof-confirm-pw'].forEach(id => { const el=$(id); if(el) el.value=''; });
    ['prof-error','prof-success'].forEach(id => { const el=$(id); if(el) el.style.display='none'; });
    m.style.display = 'flex';
    NotifPrefs.apply();
    try {
      const u = await api('/api/profile');
      if($('prof-name-ar')) $('prof-name-ar').value = u.name_ar || '';
      if($('prof-name-en')) $('prof-name-en').value = u.name_en || '';
      if($('prof-email')) $('prof-email').value = u.email || '';
    } catch(e) {}
  },

  close() {
    const m = $('modal-profile');
    if (m) m.style.display = 'none';
  },

  async save() {
    const l = App.lang;
    const errEl = $('prof-error');
    const okEl = $('prof-success');
    const btn = $('prof-save-btn');
    if(errEl) errEl.style.display = 'none';
    if(okEl) okEl.style.display = 'none';
    const nameAr = ($('prof-name-ar') || {}).value || '';
    const nameEn = ($('prof-name-en') || {}).value || '';
    const email = ($('prof-email') || {}).value || '';
    const curPw = ($('prof-cur-pw') || {}).value || '';
    const newPw = ($('prof-new-pw') || {}).value || '';
    const cfmPw = ($('prof-confirm-pw') || {}).value || '';
    if (newPw && newPw !== cfmPw) {
      if(errEl) { errEl.textContent = l === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match'; errEl.style.display = 'block'; }
      return;
    }
    if (newPw && newPw.length < 8) {
      if(errEl) { errEl.textContent = l === 'ar' ? 'كلمة المرور يجب أن تتكوّن من ٨ أحرف على الأقل' : 'Password must be at least 8 characters'; errEl.style.display = 'block'; }
      return;
    }
    const payload = { name_ar: nameAr, name_en: nameEn, email };
    if (newPw) { payload.current_password = curPw; payload.new_password = newPw; }
    if(btn) btn.disabled = true;
    try {
      await api('/api/profile', { method: 'PATCH', body: JSON.stringify(payload) });
      if(okEl) okEl.style.display = 'block';
      if($('u-name')) $('u-name').textContent = (l === 'ar' ? nameAr : nameEn) || nameAr;
      ['prof-cur-pw','prof-new-pw','prof-confirm-pw'].forEach(id => { const el=$(id); if(el) el.value=''; });
    } catch(e) {
      const msg = e.message || (l === 'ar' ? 'تعذّر الحفظ' : 'Could not save');
      if(errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    } finally {
      if(btn) btn.disabled = false;
    }
  },
};

// ── Bulk Task Actions ─────────────────────────────────────────────────────────
const BulkTasks = {
  selected() {
    return Array.from(document.querySelectorAll('.tk-row-chk:checked')).map(el => Number(el.dataset.id));
  },
  onCheck() {
    const ids = this.selected();
    const bar  = document.getElementById('tk-bulk-bar');
    const cnt  = document.getElementById('tk-bulk-count');
    const all  = document.getElementById('tk-chk-all');
    const total = document.querySelectorAll('.tk-row-chk').length;
    if (bar)  bar.style.display  = ids.length ? 'flex' : 'none';
    if (cnt)  cnt.textContent    = App.lang === 'ar' ? `${ids.length} مهام محددة` : `${ids.length} task${ids.length !== 1 ? 's' : ''} selected`;
    if (all)  all.checked        = ids.length > 0 && ids.length === total;
    if (all)  all.indeterminate  = ids.length > 0 && ids.length < total;
  },
  toggleAll(checked) {
    document.querySelectorAll('.tk-row-chk').forEach(el => { el.checked = checked; });
    this.onCheck();
  },
  deselect() {
    document.querySelectorAll('.tk-row-chk:checked').forEach(el => { el.checked = false; });
    const all = document.getElementById('tk-chk-all');
    if (all) { all.checked = false; all.indeterminate = false; }
    this.onCheck();
  },
  async markAll(status) {
    const ids = this.selected();
    if (!ids.length) return;
    const l = App.lang;
    try {
      await Promise.all(ids.map(id => api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })));
      await loadBadges();
      renderTasks();
      showToast(l === 'ar' ? `✓ تم تحديث ${ids.length} مهمة` : `✓ Updated ${ids.length} task${ids.length !== 1 ? 's' : ''}`, 'success');
    } catch(e) {
      showToast(e.message, 'error');
    }
  },
};

// ── Analytics CSV Export ──────────────────────────────────────────────────────
const Analytics = {
  _data: null,

  async exportCSV() {
    const l = App.lang;
    let data;
    try {
      data = await api('/api/analytics');
    } catch (e) {
      showToast((l === 'ar' ? 'تعذّر تحميل البيانات: ' : 'Could not load data: ') + e.message, 'error');
      return;
    }
    const rows = [
      [l === 'ar' ? 'التحليلات التنفيذية — أمين السكرتير' : 'Executive Analytics — Ameen Secretary', new Date().toLocaleDateString()],
      [],
      [l === 'ar' ? '--- معدل الحضور ---' : '--- Attendance Rates ---'],
      [l === 'ar' ? 'الاجتماع' : 'Meeting', l === 'ar' ? 'معدل الحضور %' : 'Attendance %'],
      ...(data.attendanceRates || []).map(r => [r.title_en || r.title_ar || r.id, r.rate]),
      [],
      [l === 'ar' ? '--- مدة الاجتماعات (دقائق) ---' : '--- Meeting Durations (min) ---'],
      [l === 'ar' ? 'الشهر' : 'Month', l === 'ar' ? 'المتوسط' : 'Average'],
      ...(data.durationTrend || []).map(r => [r.month || r.period || '', Math.round(r.avg_mins)]),
      [],
      [l === 'ar' ? '--- المهام المتأخرة حسب المسؤول ---' : '--- Overdue Tasks by Owner ---'],
      [l === 'ar' ? 'المسؤول' : 'Owner', l === 'ar' ? 'عدد المتأخرة' : 'Overdue Count'],
      ...(data.overdueByOwner || []).map(r => [r.owner || r.name || '', r.count]),
      [],
      [l === 'ar' ? '--- القرارات حسب نوع الاجتماع ---' : '--- Decisions by Meeting Type ---'],
      [l === 'ar' ? 'نوع الاجتماع' : 'Meeting Type', l === 'ar' ? 'عدد القرارات' : 'Decision Count'],
      ...(data.decisionsByType || []).map(r => [r.type || r.meeting_type || '', r.count]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ameen-analytics-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  },
};

// ── Risk Register ─────────────────────────────────────────────────────────────
async function renderRiskRegister(l, lbl) {
  const section = $("risk-register-section");
  if (!section) return;
  section.innerHTML = `<div class="es" style="padding:16px"><div class="loading"></div></div>`;
  try {
    const risks = await api("/api/risks");
    if (!risks.length) { section.innerHTML = ""; return; }
    const sevCls = { high: "rr-sev-high", medium: "rr-sev-medium", low: "rr-sev-low" };
    const sevAr  = { high: "عالية", medium: "متوسطة", low: "منخفضة" };
    const sevEn  = { high: "High",  medium: "Medium",  low: "Low"  };
    const counts = { high: 0, medium: 0, low: 0 };
    risks.forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });
    section.innerHTML = `
      <div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;padding-inline-start:2px">— ${lbl("سجل المخاطر","Risk Register")} —</div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <div class="ct" style="font-size:13px">⚠️ ${lbl("المخاطر المستخرجة من الاجتماعات","Risks Extracted from Meetings")}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="rr-sev-high">${counts.high} ${lbl("عالية","High")}</span>
            <span class="rr-sev-medium">${counts.medium} ${lbl("متوسطة","Medium")}</span>
            <span class="rr-sev-low">${counts.low} ${lbl("منخفضة","Low")}</span>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead>
              <tr>
                <th style="text-align:start;padding:8px 10px;background:#F8F9FB;border-bottom:1px solid #EEF0F4;font-size:11px;font-weight:700;color:#697386;white-space:nowrap">${lbl("المخاطرة","Risk")}</th>
                <th style="text-align:start;padding:8px 10px;background:#F8F9FB;border-bottom:1px solid #EEF0F4;font-size:11px;font-weight:700;color:#697386;white-space:nowrap">${lbl("الخطورة","Severity")}</th>
                <th style="text-align:start;padding:8px 10px;background:#F8F9FB;border-bottom:1px solid #EEF0F4;font-size:11px;font-weight:700;color:#697386;white-space:nowrap">${lbl("الاجتماع","Meeting")}</th>
                <th style="text-align:start;padding:8px 10px;background:#F8F9FB;border-bottom:1px solid #EEF0F4;font-size:11px;font-weight:700;color:#697386;white-space:nowrap">${lbl("التاريخ","Date")}</th>
              </tr>
            </thead>
            <tbody>
              ${risks.slice(0,20).map(r => {
                const text = (l==="ar" ? r.text_ar : r.text_en||r.text_ar)||"";
                const mtg  = (l==="ar" ? r.meeting_title_ar : r.meeting_title_en||r.meeting_title_ar)||"";
                const cls  = sevCls[r.severity] || "rr-sev-medium";
                const sl   = l==="ar" ? (sevAr[r.severity]||r.severity) : (sevEn[r.severity]||r.severity);
                return `<tr style="border-bottom:1px solid #EEF0F4">
                  <td style="padding:10px;max-width:280px;line-height:1.45">${esc(text)}</td>
                  <td style="padding:10px;white-space:nowrap"><span class="${cls}">${sl}</span></td>
                  <td style="padding:10px;font-size:12px;color:#4A90D9;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(mtg)}</td>
                  <td style="padding:10px;font-size:12px;color:#697386;white-space:nowrap">${fmtDate(r.meeting_date)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        ${risks.length > 20 ? `<div style="font-size:11.5px;color:var(--text3);text-align:center;padding:10px 0">${lbl(`وعرض أول ٢٠ خطر من أصل ${risks.length}`,`Showing first 20 of ${risks.length} risks`)}</div>` : ""}
      </div>`;
  } catch(e) {
    section.innerHTML = "";
  }
}

// ── Quick Email Compose ───────────────────────────────────────────────────────
const EmailCompose = {
  open({ to = "", subject = "", body = "" } = {}) {
    const m = $("modal-email-compose");
    if (!m) return;
    if ($("ec-to"))      $("ec-to").value      = to;
    if ($("ec-subject")) $("ec-subject").value  = subject;
    if ($("ec-body"))    $("ec-body").value     = body;
    if ($("ec-error"))   $("ec-error").style.display   = "none";
    if ($("ec-success")) $("ec-success").style.display = "none";
    m.style.display = "flex";
    setTimeout(() => ($("ec-to") || {}).focus && $("ec-to").focus(), 80);
  },
  close() {
    const m = $("modal-email-compose"); if (m) m.style.display = "none";
  },
  async send() {
    const l = App.lang;
    const to      = ($("ec-to")      || {}).value || "";
    const subject = ($("ec-subject") || {}).value || "";
    const html    = ($("ec-body")    || {}).value || "";
    const errEl   = $("ec-error");
    const okEl    = $("ec-success");
    const btn     = $("ec-send-btn");
    if (errEl) errEl.style.display = "none";
    if (okEl)  okEl.style.display  = "none";
    if (!to || !subject || !html) {
      if (errEl) { errEl.textContent = l==="ar" ? "يرجى ملء جميع الحقول" : "Please fill all fields"; errEl.style.display = "block"; }
      return;
    }
    if (btn) btn.disabled = true;
    try {
      await api("/api/email/send", { method: "POST", body: JSON.stringify({ to, subject, html }) });
      if (okEl) okEl.style.display = "block";
      setTimeout(() => EmailCompose.close(), 1800);
    } catch(e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
    } finally {
      if (btn) btn.disabled = false;
    }
  },
};

// ── Notification Preferences ──────────────────────────────────────────────────
const NotifPrefs = {
  _key: "ameen_notif_prefs",
  load() {
    try { return JSON.parse(localStorage.getItem(this._key) || "{}"); } catch { return {}; }
  },
  save() {
    const prefs = {
      email:    !!($("notif-email")    || {}).checked,
      whatsapp: !!($("notif-whatsapp") || {}).checked,
      inapp:    !!($("notif-inapp")    || {}).checked,
      digest:   !!($("notif-digest")   || {}).checked,
    };
    try { localStorage.setItem(this._key, JSON.stringify(prefs)); } catch {}
    showToast(App.lang === "ar" ? "✓ تم حفظ تفضيلات الإشعارات" : "✓ Notification preferences saved", "success");
  },
  apply() {
    const p = this.load();
    const setChk = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
    setChk("notif-email",    p.email    !== false);
    setChk("notif-whatsapp", p.whatsapp !== false);
    setChk("notif-inapp",    p.inapp    !== false);
    setChk("notif-digest",   p.digest   !== false);
  },
};

// ── Ctrl+K / Cmd+K → SmartSearch ────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    SmartSearch.toggle();
  }
});
