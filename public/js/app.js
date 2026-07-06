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
    "record",
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
    "analytics",
    "governance",
    "admin",
  ]),
  CEO: new Set([
    "record",
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
    "analytics",
    "governance",
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
    "analytics",
    "governance",
  ]),
  "Committee Member": new Set([
    "transcripts",
    "history",
    "tasks",
    "ask",
    "schedule",
    "series",
    "overview",
    "governance",
  ]),
  Executive: new Set([
    "record",
    "transcripts",
    "history",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "overview",
    "analytics",
  ]),
  Manager: new Set([
    "record",
    "transcripts",
    "history",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "series",
    "team",
    "overview",
    "analytics",
  ]),
  Employee: new Set(["overview", "record", "transcripts", "history", "tasks", "ask"]),
  Observer: new Set(["transcripts", "history", "lastmeeting", "overview"]),
  // ── Phase 4 enterprise RBAC roles ──────────────────────────────────────────
  "Super Admin": new Set([
    "record", "transcripts", "history", "lastmeeting", "tasks", "ask",
    "documents", "schedule", "series", "team", "overview", "analytics",
    "governance", "admin",
  ]),
  "Organization Admin": new Set([
    "record", "transcripts", "history", "lastmeeting", "tasks", "ask",
    "documents", "schedule", "series", "team", "overview", "analytics",
    "governance", "admin",
  ]),
  "Board Secretary": new Set([
    "record", "transcripts", "history", "lastmeeting", "tasks", "ask",
    "documents", "schedule", "series", "overview", "analytics", "governance",
  ]),
  "Committee Chair": new Set([
    "transcripts", "history", "tasks", "ask", "documents", "schedule",
    "series", "overview", "governance",
  ]),
  Auditor: new Set(["transcripts", "history", "lastmeeting", "tasks", "overview", "analytics"]),
  Guest: new Set(["overview", "transcripts", "history", "lastmeeting"]),
};

// ══ Executive Action taxonomy ══════════════════════════════════════════════
// Single source of truth for task status/priority labels + badge colors,
// shared by the Task & Decision Tracker, the Executive Action Assignment
// table, and the Executive Actions summaries in Transcripts/Meeting History.
// Legacy DB values ('new', 'normal', 'urgent') are aliased rather than
// migrated, so existing rows keep working with zero data changes.
const TASK_STATUS_META = {
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
        e.message &&
        (e.message.includes("401") || e.message.includes("UNAUTHORIZED"))
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
    await loadSelectLists();
    Panels.init();
    Chat.restore();
    const allowed = ROLE_ACCESS[this.systemRole] || ROLE_ACCESS["Employee"];
    // Home (the executive command center) is the natural landing page for
    // every role that can see it — falls back to whatever else the role has
    // access to, same as before, for the handful of roles that can't.
    const firstPanel = allowed.has("overview") ? "overview" : ([...allowed][0] || "record");
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

  promptApiKey() {
    const cur = sessionStorage.getItem("api_key") || "";
    const k = prompt(
      this.lang === "ar"
        ? "أدخل مفتاح Anthropic API (sk-ant-...):\n\nاتركه فارغاً للوضع التجريبي"
        : "Enter Anthropic API key (sk-ant-...):\n\nLeave blank for demo mode",
      cur,
    );
    if (k === null) return;
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
        })
        .catch(() => {});
    } else if (k === "") {
      sessionStorage.removeItem("api_key");
      $("api-status-txt").textContent = "Anthropic API";
    } else if (k) {
      alert(
        this.lang === "ar"
          ? "مفتاح غير صالح — يجب أن يبدأ بـ sk-ant"
          : "Invalid key — must start with sk-ant",
      );
    }
  },
};

// ══ API ════════════════════════════════════════════════════════════════════════
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const r = await fetch(path, {
    ...opts,
    credentials: "include",
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || `HTTP ${r.status}`);
  return data;
}

async function logoutUser() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch (_) {}
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
    overview: renderOverview,
  },
  async load(name) {
    this.current = name;
    document
      .querySelectorAll(".panel")
      .forEach((p) => p.classList.remove("active"));
    const panel = $(`panel-${name}`);
    if (panel) panel.classList.add("active");
    document
      .querySelectorAll(".nb")
      .forEach((b) => b.classList.toggle("active", b.dataset.p === name));
    App.applyLang(App.lang);

    switch (name) {
      case "transcripts":
        await renderTranscripts();
        break;
      case "history":
        await MeetingHistory.refresh();
        break;
      case "tasks":
        await renderTasks();
        break;
      case "schedule":
        await renderSchedule();
        renderTemplates().catch((e) =>
          showToast(
            (App.lang === "ar"
              ? "تعذّر تحميل القوالب: "
              : "Could not load templates: ") + e.message,
            "error",
          ),
        );
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
      case "admin":
        await renderAdminPanel();
        break;
      case "record":
        ImportFlow.init();
        break;
      case "integrations":
        renderIntegrations();
        break;
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
  search(q) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      const el = $("doc-library-section");
      if (el) {
        el._search = q;
      }
      this.renderLibrary("doc-library-section");
    }, 350);
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
    container.innerHTML = `<div class="es" style="padding:20px 0"><div class="loading"></div></div>`;
    try {
      const docs = await api(
        `/api/documents/library${q ? "?q=" + encodeURIComponent(q) : ""}`,
      );
      if (!docs.length) {
        container.innerHTML = emptyStateCard({
          icon: "📎",
          titleAr: "لا توجد مستندات بعد",
          titleEn: "No documents yet",
          descAr: "استخدم زر «📎 إرفاق» في أي اجتماع لرفع ملفات PDF أو DOCX أو TXT، أو افتح المحاضر لإرفاق مستند.",
          descEn: 'Use the "📎 Attach" button on any meeting to upload PDF, DOCX, or TXT files.',
          primary: { ar: "📝 فتح المحاضر", en: "📝 Open Transcripts", onclick: "Panels.load('transcripts')" },
        });
        return;
      }
      const sorted = [...docs].sort((a, b) => (DocPins.has(b.id) ? 1 : 0) - (DocPins.has(a.id) ? 1 : 0));
      container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
        ${sorted
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
          .join("")}
      </div>`;
    } catch (err) {
      container.innerHTML = `<div style="color:var(--red);font-size:12px;padding:10px 0">${err.message}</div>`;
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
  "Board Meeting": { ar: "مجلس الإدارة", en: "Board Meeting" },
  "Committee Meeting": { ar: "اجتماع اللجنة", en: "Committee Meeting" },
  "Executive Meeting": { ar: "الاجتماع التنفيذي", en: "Executive Meeting" },
  "General Meeting": { ar: "الاجتماع العام", en: "General Meeting" },
  "Strategy Meeting": { ar: "اجتماع الاستراتيجية", en: "Strategy Meeting" },
  "Follow-up Meeting": { ar: "اجتماع المتابعة", en: "Follow-up Meeting" },
  general_assembly: { ar: "الجمعية العمومية", en: "General Assembly" },
};
const CAL_TYPE_COLORS = {
  "Board Meeting": "#5B9BD6",
  "Committee Meeting": "#2ECC8A",
  "Executive Meeting": "#D4A017",
  "General Meeting": "#9AA0A6",
  "Strategy Meeting": "#9B72DB",
  "Follow-up Meeting": "#EFA827",
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

  async toggle() {
    if (this.isRecording) {
      await this.stop();
    } else {
      await this.start();
    }
  },

  async start() {
    const title =
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

    this.fullTranscript = "";
    this._lastSavedLen = 0;
    this.isRecording = true;
    $("rec-ring").classList.add("recording");
    $("rec-ic").textContent = "⏹";
    $("b-rec").style.display = "flex";
    $("live-tr-card").style.display = "";
    $("live-ex-card").style.display = "";
    $("ai-res-card").style.display = "none";
    $("live-tr").textContent = "";
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
    clearInterval(this.timerInt);
    $("rec-ring").classList.remove("recording");
    $("rec-ic").textContent = "🎙";
    $("b-rec").style.display = "none";
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
      this.processAI();
    }
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
const LIFECYCLE_STAGE_ORDER = [
  'created', 'invited', 'scheduled', 'recording', 'uploaded',
  'transcript_generated', 'ai_minutes_generated', 'secretary_review',
  'chairman_approval', 'board_approval', 'archived',
];
const LIFECYCLE_STAGE_META = {
  created:               { ar: 'إنشاء',       en: 'Created',       icon: '🏗' },
  invited:               { ar: 'الدعوات',     en: 'Invited',       icon: '📧' },
  scheduled:             { ar: 'مجدول',       en: 'Scheduled',     icon: '📅' },
  recording:             { ar: 'التسجيل',     en: 'Recording',     icon: '🎙' },
  uploaded:              { ar: 'تم الرفع',    en: 'Uploaded',      icon: '⬆️' },
  transcript_generated:  { ar: 'النص',        en: 'Transcript',    icon: '📝' },
  ai_minutes_generated:  { ar: 'محضر AI',     en: 'AI Minutes',    icon: '🤖' },
  secretary_review:      { ar: 'مراجعة السكرتير', en: 'Secretary Review', icon: '🗂️' },
  chairman_approval:     { ar: 'اعتماد الرئيس',   en: 'Chairman Approval', icon: '✅' },
  board_approval:        { ar: 'اعتماد المجلس',   en: 'Board Approval',    icon: '🏛️' },
  archived:              { ar: 'أرشفة',       en: 'Archived',      icon: '🗄' },
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
  target: 'existing',
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
    const [meetings, allTasks] = await Promise.all([
      api("/api/meetings"),
      api("/api/tasks"),
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
            if (lcStage === 'board_approval') {
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesApprovalAction(${m.id},'archive')" style="color:var(--text3);border-color:var(--text3)">🗄️ ${l==='ar'?'أرشفة':'Archive'}</button>`);
            }
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
    meetings.forEach((m) => DocLib.loadAndRender(m.id));
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
  renderList() {
    const list = $("hist-list");
    if (!list) return;
    const l = App.lang;
    if (!this._all.length) {
      list.innerHTML = emptyStateCard({
        icon: "🗂",
        titleAr: "لا توجد اجتماعات بعد",
        titleEn: "No meetings yet",
        descAr: "بمجرد تسجيل أو استيراد اجتماعك الأول، ستظهر هنا مساحة عمل كاملة لكل اجتماع.",
        descEn: "Once you record or import your first meeting, a full workspace for it will appear here.",
        primary: { ar: "🎙 تسجيل اجتماع", en: "🎙 Record Meeting", onclick: "Panels.load('record')" },
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
    const detail = $("hist-detail");
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
    this.renderList();
    const detail = $("hist-detail");
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
    document.querySelectorAll("#hist-detail-tabs .imp-seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const body = $("hist-tab-body");
    if (body && this._tabs) body.innerHTML = this._tabs[tab] || "";
  },
  renderDetail(full) {
    const detail = $("hist-detail");
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
      if (lcStage === "board_approval") {
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
          <div>${l === "ar" ? "نوع الاجتماع" : "Meeting Type"}: <strong>${esc(m.meeting_type || (l === "ar" ? "غير محدد" : "Not set"))}</strong></div>
          <div>${l === "ar" ? "المسجّل" : "Recorded By"}: <strong>${esc((l === "ar" ? m.recorder_ar : m.recorder_en) || "—")}</strong></div>
          ${m.board_name_ar ? `<div>${l === "ar" ? "المجلس" : "Board"}: <strong>${esc(l === "ar" ? m.board_name_ar : m.board_name_en)}</strong></div>` : ""}
          ${m.committee_name_ar ? `<div>${l === "ar" ? "اللجنة" : "Committee"}: <strong>${esc(l === "ar" ? m.committee_name_ar : m.committee_name_en)}</strong></div>` : ""}
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
          ? `<ol style="margin:0;padding-inline-start:18px;display:flex;flex-direction:column;gap:6px">
          ${full.agenda
            .map(
              (a) => `<li>${esc(a.title)}${a.presenter ? ` — <span style="color:var(--text3)">${esc(a.presenter)}</span>` : ""}${a.description ? `<div style="font-size:11.5px;color:var(--text3);margin-top:2px">${esc(a.description)}</div>` : ""}</li>`,
            )
            .join("")}
        </ol>`
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
          (mApprovalBtns ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${mStatusBadge}${mApprovalBtns}</div>` : mStatusBadge ? `<div style="margin-top:10px">${mStatusBadge}</div>` : ""),
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

    const tabBarHtml = `<div class="imp-seg" id="hist-detail-tabs">
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
      <div id="hist-tab-body">${this._tabs[this._tab]}</div>
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
async function minutesApprovalAction(meetingId, action) {
  const l = App.lang;
  const actionLabels = {
    'circulate': l === 'ar' ? 'تعميم للاعتماد' : 'Circulate for Approval',
    'approve': l === 'ar' ? 'اعتماد' : 'Approve',
    'request-revision': l === 'ar' ? 'طلب مراجعة' : 'Request Revision',
    'final-approve': l === 'ar' ? 'اعتماد نهائي' : 'Final Approve',
    'archive': l === 'ar' ? 'أرشفة الاجتماع' : 'Archive Meeting',
  };
  const label = actionLabels[action] || action;
  const comments = prompt(
    l === 'ar' ? `${label} — ملاحظات اختيارية:` : `${label} — Optional comments:`,
    ''
  );
  if (comments === null) return;
  try {
    await api(`/api/meetings/${meetingId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });
    await renderTranscripts();
  } catch (e) {
    alert(l === 'ar' ? 'حدث خطأ: ' + e.message : 'Error: ' + e.message);
  }
}

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
        descAr: "سجّل أول اجتماع أو استورد محضراً موجوداً ليظهر هنا تحليل الذكاء الاصطناعي الكامل.",
        descEn: "Record your first meeting or import an existing one to see the full AI analysis here.",
        primary: { ar: "🎙 تسجيل اجتماع", en: "🎙 Record Meeting", onclick: "Panels.load('record')" },
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

async function pushLastMeetingWhatsApp(id) {
  const l = App.lang;
  const phones = prompt(
    l === "ar"
      ? "أرقام الجوال للإرسال عبر واتساب (افصل بينها بفاصلة):"
      : "WhatsApp phone number(s), comma-separated:",
    "",
  );
  if (phones === null) return;
  if (!phones.trim()) {
    alert(l === "ar" ? "يرجى إدخال رقم جوال" : "Please enter a phone number");
    return;
  }
  try {
    const r = await api("/api/meetings/" + id + "/whatsapp-summary", {
      method: "POST",
      body: JSON.stringify({ phones: phones.trim() }),
    });
    alert(
      l === "ar"
        ? `✓ تم الإرسال إلى ${r.sent} رقم`
        : `✓ Sent to ${r.sent} number(s)`,
    );
  } catch (e) {
    alert((l === "ar" ? "تعذّر الإرسال: " : "Could not send: ") + e.message);
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
    const f = TaskFilters;

    // ── AI-extracted tasks awaiting human review never mix into the regular
    // board/list/calendar — they haven't been vetted yet (owner/due/priority
    // may just be the AI's best guess). They only appear in the dedicated
    // "Pending Review" quick filter below, until approved or rejected.
    const pendingReviewTasks = tasksRaw.filter((t) => t.review_status === "pending");
    const tasks = tasksRaw.filter((t) => t.review_status !== "pending" && t.review_status !== "rejected");

    const canFullyManage = App.can("actions.assign");
    const ownerDept = {};
    members.forEach((m) => { ownerDept[m.id] = m.department || ""; });
    const meetingTitles = [...new Set(tasks.map((t) => (l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar)).filter(Boolean))];
    const departments = [...new Set(members.map((m) => m.department).filter(Boolean))];

    const matchesFilters = (t) => {
      if (f.mine && App.user && t.owner_id !== App.user.id) return false;
      if (f.owner && String(t.owner_id) !== f.owner) return false;
      if (f.status && taskStatusKey(t.status) !== f.status) return false;
      if (f.priority && taskPriorityKey(t.priority) !== f.priority) return false;
      if (f.meeting) {
        const mtg = l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar;
        if (mtg !== f.meeting) return false;
      }
      if (f.department && ownerDept[t.owner_id] !== f.department) return false;
      if (f.dueBefore && (!t.due_date || t.due_date > f.dueBefore)) return false;
      if (f.q) {
        const hay = [t.text_ar, t.text_en, t.owner_name_ar, t.owner_name_en].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    };
    const myDept = App.user ? ownerDept[App.user.id] || "" : "";
    const matchesQuick = (t) => {
      switch (f.quick) {
        case "my": return !!(App.user && t.owner_id === App.user.id);
        case "team": return !!(App.user && t.owner_id && t.owner_id !== App.user.id);
        case "dept": return !!(myDept && ownerDept[t.owner_id] === myDept);
        case "overdue": return t.status === "overdue";
        case "high": return ["high", "critical"].includes(taskPriorityKey(t.priority));
        case "blocked": return taskStatusKey(t.status) === "blocked";
        case "completed": return t.status === "done";
        case "favorites": return TaskFavorites.has(t.id);
        default: return true;
      }
    };
    const filtered = tasks.filter((t) => matchesFilters(t) && matchesQuick(t));
    const filtersActive = f.isActive();

    const today = new Date().toISOString().substring(0, 10);
    const overdue    = tasks.filter(t => t.status === "overdue");
    const inprog     = tasks.filter(t => ["inprogress", "new", "open", "waiting", "blocked"].includes(t.status));
    const done       = tasks.filter(t => t.status === "done");
    const escalated  = tasks.filter(t => t.escalated_at);
    const decPending = decisions.filter(d => d.status !== "implemented");
    const decImpl    = decisions.filter(d => d.status === "implemented");

    // ── KPI cards ─────────────────────────────────────────────────────────────
    const _kpi = (icon, val, labelAr, labelEn, valColor) => `
      <div style="padding:14px 16px;background:var(--navy3);border-radius:12px;border:.5px solid var(--border2);text-align:center">
        <div style="font-size:15px;margin-bottom:5px">${icon}</div>
        <div style="font-size:26px;font-weight:800;color:${valColor};margin-bottom:4px;line-height:1">${val}</div>
        <div style="font-size:11.5px;color:var(--text3);line-height:1.35">${l==="ar"?labelAr:labelEn}</div>
      </div>`;

    const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px;margin-bottom:20px">
      ${_kpi("📂", inprog.length + overdue.length, "مهام مفتوحة",       "Open Actions",            "var(--text)")}
      ${_kpi("⚠️", overdue.length,                  "متأخرة",            "Overdue",                 overdue.length   > 0 ? "var(--red)"   : "var(--green)")}
      ${_kpi("✅", done.length,                      "مكتملة",            "Completed",               "var(--green)")}
      ${_kpi("↑",  escalated.length,                "مُصعَّدة",          "Escalated",               escalated.length > 0 ? "#9B72DB"      : "var(--text3)")}
      ${_kpi("⚖️", decPending.length,               "قرارات معلقة",      "Decisions Pending",       decPending.length> 0 ? "var(--amber)" : "var(--text3)")}
      ${_kpi("🏆", decImpl.length,                  "قرارات منفذة",      "Decisions Implemented",   "var(--green)")}
    </div>`;

    // ── Improved task card ─────────────────────────────────────────────────────
    const renderTask = (t) => {
      const text  = l === "ar" ? t.text_ar : t.text_en || t.text_ar;
      const owner = l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar;
      const mtg   = l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar;
      const isOverdue = t.status === "overdue";
      const isDone    = t.status === "done";
      const priKey    = taskPriorityKey(t.priority);
      const isCritical = priKey === "critical";
      const isHigh    = priKey === "high";

      const daysLeft = t.due_date ? Math.round((new Date(t.due_date) - new Date(today)) / 86400000) : null;
      const daysTag  = daysLeft !== null && !isDone ? (() => {
        if (daysLeft < 0)   return `<span class="days-badge days-late">⚠ ${Math.abs(daysLeft)}${l==="ar"?"ي تأخر":"d overdue"}</span>`;
        if (daysLeft === 0) return `<span class="days-badge days-warn">⏰ ${l==="ar"?"اليوم":"Today"}</span>`;
        if (daysLeft <= 3)  return `<span class="days-badge days-warn">⏳ ${daysLeft}${l==="ar"?"ي":"d"} ${l==="ar"?"متبقية":"left"}</span>`;
        return `<span class="days-badge days-ok">📅 ${daysLeft}${l==="ar"?"ي":"d"}</span>`;
      })() : "";

      const stMeta = taskStatusMeta(t.status);
      const statusSelect = `<select class="st-select" onchange="Tasks.updateStatus(${t.id}, this.value)" title="${l==="ar"?"تحديث الحالة":"Update status"}">
        ${TASK_ASSIGNABLE_STATUSES.map(k => `<option value="${k}" ${taskStatusKey(t.status)===k?"selected":""}>${l==="ar"?TASK_STATUS_META[k].ar:TASK_STATUS_META[k].en}</option>`).join("")}
        ${t.status === "overdue" ? `<option value="overdue" selected>${l==="ar"?TASK_STATUS_META.overdue.ar:TASK_STATUS_META.overdue.en}</option>` : ""}
      </select>`;

      const pri = taskPriorityMeta(t.priority);
      const dept = ownerDept[t.owner_id];
      const progress = Number(t.progress || 0);

      const accentColor = isOverdue ? "var(--red)" : isCritical ? "var(--red)" : isHigh ? "var(--amber)" : "var(--border2)";
      const canManageThis = canFullyManage;

      // Controls (status dropdown + favorite/edit/delete) live in their own
      // header row, ABOVE the title — not inline beside it. Board view packs
      // three cards per row into much narrower columns than the List view; an
      // inline flex row with fixed-width controls and no wrapping used to
      // squeeze the title's flex:1 column down to a sliver, forcing it onto
      // one word per line. Stacking guarantees the title always gets the
      // card's full width, in both views.
      return `<div class="trow" id="tr-${t.id}" style="border-inline-start:3px solid ${accentColor};padding-inline-start:10px;margin-bottom:10px;border-radius:0 8px 8px 0;${isOverdue?"background:rgba(220,60,60,.04)":""}">
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px">
          ${statusSelect}
          <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">
            <button onclick="TaskFavorites.toggle(${t.id})" style="background:${TaskFavorites.has(t.id) ? "rgba(212,160,23,.14)" : "var(--navy3)"};border:1px solid ${TaskFavorites.has(t.id) ? "var(--gold)" : "var(--border2)"};color:${TaskFavorites.has(t.id) ? "var(--gold)" : "var(--text3)"};cursor:pointer;font-size:12px;padding:5px 10px;border-radius:8px;transition:.15s;line-height:1" title="${l==="ar"?"مفضّلة":"Favorite"}" aria-label="${l==="ar"?"إجراء مفضّل":"Favorite action"}">${TaskFavorites.has(t.id) ? "★" : "☆"}</button>
            <button onclick="Tasks.edit(${t.id})" style="background:var(--navy3);border:1px solid var(--border2);color:var(--text2);cursor:pointer;font-size:12px;padding:5px 10px;border-radius:8px;transition:.15s;line-height:1;font-weight:500" onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'" title="${l==="ar"?"تعديل":"Edit"}">✏️</button>
            ${canManageThis ? `<button onclick="Tasks.delete(${t.id})" style="background:var(--navy3);border:1px solid var(--border2);color:var(--text3);cursor:pointer;font-size:12px;padding:5px 10px;border-radius:8px;transition:.15s;line-height:1" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text3)'" title="${l==="ar"?"حذف":"Delete"}">✕</button>` : ""}
          </div>
        </div>
        <div style="width:100%">
          <div style="font-size:14px;color:${isDone?"var(--text3)":"var(--text)"};font-weight:${isDone?"400":"600"};${isDone?"text-decoration:line-through;opacity:.55":""};line-height:1.45;margin-bottom:8px">${esc(text)}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:7px">
            ${owner ? `<span class="tag tgold" style="font-size:11px">👤 ${esc(owner)}</span>` : ""}
            ${dept ? `<span class="tag" style="background:var(--navy4);font-size:11px">🏢 ${esc(dept)}</span>` : ""}
            <span class="tag" style="font-size:11.5px;background:${pri.bg};color:${pri.c};border:.5px solid ${pri.bd}">${l==="ar"?pri.ar:pri.en}</span>
            ${daysTag}
            ${t.needs_review ? `<span class="tag" style="background:rgba(124,94,16,.18);color:#ffd969;border:.5px solid rgba(255,217,105,.25);font-size:11.5px">⚑ ${l==="ar"?"مراجعة":"Review"}</span>` : ""}
            ${t.escalated_at ? `<span class="tag" style="background:rgba(155,114,219,.15);color:#9B72DB;border:.5px solid rgba(155,114,219,.3);font-size:11.5px">↑ ${l==="ar"?"مُصعَّدة":"Escalated"}</span>` : ""}
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            ${t.due_date ? `<span style="font-size:11px;color:${isOverdue?"var(--red)":"var(--text3)"}">📅 ${l==="ar"?"الاستحقاق:":"Due:"} <strong style="color:${isOverdue?"var(--red)":"var(--text2)"}">${esc(t.due_date)}</strong></span>` : ""}
            ${mtg ? `<span style="font-size:11px;color:var(--text3)">📝 ${esc(mtg.length>42?mtg.substring(0,42)+"…":mtg)}</span>` : ""}
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="flex:1;height:5px;background:var(--navy4);border-radius:4px;overflow:hidden;max-width:160px">
              <div style="height:100%;border-radius:4px;background:${progress===100?"var(--green)":"var(--gold)"};width:${progress}%;transition:width .3s"></div>
            </div>
            <select class="st-select" style="font-size:10.5px;padding:2px 6px" onchange="Tasks.updateProgress(${t.id}, this.value)" title="${l==="ar"?"نسبة التقدم":"Progress"}">
              ${PROGRESS_STEPS.map(p => `<option value="${p}" ${progress===p?"selected":""}>${p}%</option>`).join("")}
            </select>
          </div>
          <div style="padding:6px 10px;background:var(--navy3);border-radius:8px;border:.5px solid var(--border2);font-size:11px;color:var(--text3);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span style="line-height:1.4">${
              t.update_count
                ? `💬 ${esc((t.latest_update_text || "").length > 90 ? t.latest_update_text.substring(0,90)+"…" : (t.latest_update_text||""))}${t.latest_update_author ? ` — ${esc(t.latest_update_author)}` : ""}${t.update_count > 1 ? ` (${t.update_count} ${l==="ar"?"تحديثات":"updates"})` : ""}`
                : (l==="ar"?"لا توجد تحديثات تقدم بعد — أضف تحديثاً لإبقاء الإدارة على اطلاع.":"No progress updates yet. Add an update to keep management informed.")
            }</span>
            <button onclick="Tasks.edit(${t.id})" style="font-size:11px;background:rgba(212,160,23,.12);color:var(--gold);border:.5px solid rgba(212,160,23,.3);padding:3px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;flex-shrink:0">+ ${l==="ar"?"إضافة تحديث":"Add Update"}</button>
          </div>
        </div>
      </div>`;
    };

    // ── Improved decision card ─────────────────────────────────────────────────
    const renderDecision = (d) => {
      const text      = l === "ar" ? d.text_ar : d.text_en || d.text_ar;
      const mtg       = l === "ar" ? d.meeting_title_ar : d.meeting_title_en || d.meeting_title_ar;
      const isImpl    = d.status === "implemented";
      const decDate   = d.created_at ? d.created_at.substring(0,10) : "";
      const decidedBy = d.decided_by || "";
      const notes     = d.notes || "";
      return `<div class="trow" style="border-inline-start:3px solid ${isImpl?"var(--green)":"var(--amber)"};padding-inline-start:10px;margin-bottom:10px;border-radius:0 8px 8px 0">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <input type="checkbox" class="tck" ${isImpl?"checked":""} onchange="Tasks.updateDecisionStatus(${d.id}, this.checked?'implemented':'active')" style="margin-top:4px;flex-shrink:0"/>
          <div style="flex:1;min-width:0">
            <div style="font-size:13.5px;color:var(--text);font-weight:600;${isImpl?"text-decoration:line-through;color:var(--text3)":""};margin-bottom:8px;line-height:1.45">${esc(text)}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:7px">
              ${isImpl
                ? `<span class="tag tg" style="font-size:11px">✓ ${l==="ar"?"مُنفَّذ":"Implemented"}</span>`
                : `<span class="tag" style="font-size:11px;background:rgba(255,160,0,.15);color:#f0a000;border:.5px solid rgba(255,160,0,.3)">⏳ ${l==="ar"?"معلق — قيد التنفيذ":"Pending Implementation"}</span>`}
              ${decDate   ? `<span class="tag" style="background:var(--navy4);font-size:11.5px">📅 ${esc(decDate)}</span>` : ""}
              ${decidedBy ? `<span class="tag tgold" style="font-size:11.5px">👤 ${esc(decidedBy)}</span>` : ""}
              ${mtg       ? `<span class="tag" style="background:var(--navy3);color:var(--text3);font-size:11px;border:.5px solid var(--border2)">📝 ${esc(mtg.length>38?mtg.substring(0,38)+"…":mtg)}</span>` : ""}
            </div>
            ${notes
              ? `<div style="padding:6px 10px;background:var(--navy3);border-radius:8px;border-inline-start:2px solid var(--gold);font-size:11px;color:var(--text3);line-height:1.5">
                  <span style="font-size:11px;font-weight:700;color:var(--gold);display:block;margin-bottom:2px">${l==="ar"?"الإجراء التالي / ملاحظات:":"Next Action / Notes:"}</span>${esc(notes)}</div>`
              : `<div style="font-size:11.5px;color:var(--text3);font-style:italic;padding:3px 0;line-height:1.45">${l==="ar"?"لا توجد ملاحظات أو إجراءات محددة لهذا القرار بعد.":"No notes or next actions defined for this decision yet."}</div>`}
          </div>
          <button onclick="Tasks.deleteDecision(${d.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0">✕</button>
        </div>
      </div>`;
    };

    // ── Section header helper ──────────────────────────────────────────────────
    const _secHdrT = (icon, ar, en) => `<div style="display:flex;align-items:center;gap:8px;margin:0 0 14px;padding-bottom:8px;border-bottom:1.5px solid var(--border2)">
      <span style="font-size:16px">${icon}</span>
      <div style="font-size:13px;font-weight:800;color:var(--text);letter-spacing:.02em">${l==="ar"?ar:en}</div>
    </div>`;

    // ── Filter bar: owner / status / priority / meeting / department / My Tasks ──
    const _opt = (val, label, selected) => `<option value="${esc(val)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
    const _filterBar = `<div class="tf-bar">
      <input type="search" class="fi" id="tf-search" value="${esc(f.q)}" oninput="TaskFilters.onSearch(this.value)"
        data-ph-ar="ابحث في المهام أو المسؤول..." data-ph-en="Search tasks or owner..." placeholder="${l==="ar"?"ابحث في المهام أو المسؤول...":"Search tasks or owner..."}"/>
      <select class="fi" id="tf-owner" onchange="TaskFilters.apply()">
        ${_opt("", l==="ar"?"كل المسؤولين":"All Owners", !f.owner)}
        ${members.map(m => _opt(m.id, l==="ar"?m.name_ar:(m.name_en||m.name_ar), String(f.owner)===String(m.id))).join("")}
      </select>
      <select class="fi" id="tf-status" onchange="TaskFilters.apply()">
        ${_opt("", l==="ar"?"كل الحالات":"All Statuses", !f.status)}
        ${TASK_ASSIGNABLE_STATUSES.concat(["overdue"]).map(k => _opt(k, l==="ar"?TASK_STATUS_META[k].ar:TASK_STATUS_META[k].en, f.status===k)).join("")}
      </select>
      <select class="fi" id="tf-priority" onchange="TaskFilters.apply()">
        ${_opt("", l==="ar"?"كل الأولويات":"All Priorities", !f.priority)}
        ${TASK_ASSIGNABLE_PRIORITIES.map(k => _opt(k, l==="ar"?TASK_PRIORITY_META[k].ar:TASK_PRIORITY_META[k].en, f.priority===k)).join("")}
      </select>
      <select class="fi" id="tf-meeting" onchange="TaskFilters.apply()">
        ${_opt("", l==="ar"?"كل الاجتماعات":"All Meetings", !f.meeting)}
        ${meetingTitles.map(mt => _opt(mt, mt.length>30?mt.substring(0,30)+"…":mt, f.meeting===mt)).join("")}
      </select>
      ${departments.length ? `<select class="fi" id="tf-department" onchange="TaskFilters.apply()">
        ${_opt("", l==="ar"?"كل الأقسام":"All Departments", !f.department)}
        ${departments.map(d => _opt(d, d, f.department===d)).join("")}
      </select>` : ""}
      <input type="date" class="fi" id="tf-due" value="${esc(f.dueBefore)}" onchange="TaskFilters.apply()" title="${l==="ar"?"مستحقة قبل أو في":"Due on or before"}"/>
      <label class="tf-mine${f.mine?" active":""}" onclick="TaskFilters.toggleMine()">
        <input type="checkbox" ${f.mine?"checked":""} onclick="event.stopPropagation();TaskFilters.toggleMine()"/> ${l==="ar"?"مهامي فقط":"My Tasks"}
      </label>
      ${filtersActive ? `<button class="btn-ghost btn-sm" onclick="TaskFilters.reset()">✕ ${l==="ar"?"إعادة تعيين":"Reset"}</button>` : ""}
    </div>`;

    const filteredOpen = filtered.filter(t => t.status !== "done" && t.status !== "cancelled");
    const filteredDone = filtered.filter(t => t.status === "done" || t.status === "cancelled");

    // ── View switcher — Board (default, unchanged) / List / Calendar ──────────
    const view = TaskView.get();
    const viewSwitcherHtml = `<div class="imp-seg" style="margin-bottom:16px;max-width:420px">
      <button class="imp-seg-btn ${view === "list" ? "active" : ""}" onclick="TaskView.set('list')">📋 ${l === "ar" ? "قائمة" : "List"}</button>
      <button class="imp-seg-btn ${view === "board" ? "active" : ""}" onclick="TaskView.set('board')">🗂 ${l === "ar" ? "لوحة" : "Board"}</button>
      <button class="imp-seg-btn ${view === "calendar" ? "active" : ""}" onclick="TaskView.set('calendar')">📅 ${l === "ar" ? "تقويم" : "Calendar"}</button>
    </div>`;

    // ── Quick filters — one-click executive shortcuts layered on top of the
    // detailed dropdown filters above; counts are computed over ALL tasks so
    // they stay meaningful regardless of what's currently selected.
    const quickCounts = {
      my: tasks.filter((t) => App.user && t.owner_id === App.user.id).length,
      team: tasks.filter((t) => App.user && t.owner_id && t.owner_id !== App.user.id).length,
      dept: myDept ? tasks.filter((t) => ownerDept[t.owner_id] === myDept).length : 0,
      overdue: tasks.filter((t) => t.status === "overdue").length,
      high: tasks.filter((t) => ["high", "critical"].includes(taskPriorityKey(t.priority))).length,
      blocked: tasks.filter((t) => taskStatusKey(t.status) === "blocked").length,
      completed: tasks.filter((t) => t.status === "done").length,
      favorites: tasks.filter((t) => TaskFavorites.has(t.id)).length,
    };
    const quickChips = [
      ...(pendingReviewTasks.length ? [{ key: "review", icon: "⏳", ar: "بانتظار المراجعة", en: "Pending Review", alert: true }] : []),
      { key: "my", icon: "👤", ar: "مهامي", en: "My Actions" },
      { key: "team", icon: "👥", ar: "إجراءات الفريق", en: "Team Actions" },
      ...(myDept ? [{ key: "dept", icon: "🏢", ar: "إجراءات القسم", en: "Department Actions" }] : []),
      { key: "overdue", icon: "⚠️", ar: "متأخرة", en: "Overdue" },
      { key: "high", icon: "⚡", ar: "أولوية عالية", en: "High Priority" },
      { key: "blocked", icon: "⛔", ar: "معطّلة", en: "Blocked" },
      { key: "completed", icon: "✅", ar: "مكتملة", en: "Completed" },
      { key: "recent", icon: "🕐", ar: "الأحدث", en: "Recent" },
      { key: "favorites", icon: "★", ar: "المفضلة", en: "Favorites" },
    ];
    const quickFilterBarHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${quickChips
        .map((c) => {
          const count = c.key === "recent" ? "" : c.key === "review" ? pendingReviewTasks.length : quickCounts[c.key] || 0;
          const active = f.quick === c.key;
          return `<button class="qf-chip ${active ? "active" : ""}${c.alert ? " qf-chip-alert" : ""}" onclick="TaskFilters.setQuick('${c.key}')">${c.icon} ${l === "ar" ? c.ar : c.en}${count !== "" ? ` <span class="qf-count">${count}</span>` : ""}</button>`;
        })
        .join("")}
    </div>`;

    const boardBodyHtml = filtersActive
      ? `<div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="ch" style="margin-bottom:6px">
            <div><div class="ct">${l==="ar"?"نتائج البحث — مفتوحة":"Filtered — Open"}</div><div style="font-size:11px;color:var(--text3);margin-top:2px">${l==="ar"?`${filtered.length} نتيجة مطابقة`:`${filtered.length} matching result(s)`}</div></div>
            <span class="tag tr">${filteredOpen.length}</span>
          </div>
          ${filteredOpen.length === 0
            ? `<div style="text-align:center;padding:28px 16px"><div style="font-size:30px;margin-bottom:8px">🔍</div><div style="font-size:12.5px;color:var(--text3)">${l==="ar"?"لا نتائج مطابقة":"No matching results"}</div></div>`
            : filteredOpen.map(renderTask).join("")}
        </div>
        <div class="card">
          <div class="ch" style="margin-bottom:6px">
            <div><div class="ct">✓ ${l==="ar"?"نتائج البحث — مكتملة":"Filtered — Completed"}</div></div>
            <span class="tag tg">${filteredDone.length}</span>
          </div>
          ${filteredDone.length === 0
            ? `<div style="text-align:center;padding:28px 16px"><div style="font-size:30px;margin-bottom:8px">📋</div><div style="font-size:12px;color:var(--text3)">${l==="ar"?"لا نتائج مطابقة":"No matching results"}</div></div>`
            : filteredDone.map(renderTask).join("")}
        </div>
      </div>`
      : `<div class="grid-3" style="align-items:start">
        <div class="card">
          <div class="ch" style="margin-bottom:6px">
            <div><div class="ct">${l==="ar"?"⚠ متأخرة / مفتوحة":"⚠ Overdue / Open"}</div><div style="font-size:11px;color:var(--text3);margin-top:2px">${l==="ar"?"تحتاج انتباهاً فورياً":"Require immediate attention"}</div></div>
            <span class="tag tr">${overdue.length + inprog.length}</span>
          </div>
          ${overdue.length + inprog.length === 0
            ? `<div style="text-align:center;padding:28px 16px"><div style="font-size:30px;margin-bottom:8px">✅</div><div style="font-size:12.5px;font-weight:600;color:var(--green)">${l==="ar"?"لا مهام متأخرة":"No overdue tasks"}</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${l==="ar"?"أداء ممتاز — كل المهام في الوقت المحدد":"Excellent — all tasks on schedule"}</div></div>`
            : [...overdue, ...inprog].map(renderTask).join("")}
        </div>
        <div class="card">
          <div class="ch" style="margin-bottom:6px">
            <div><div class="ct">✓ ${l==="ar"?"مكتملة":"Done"}</div><div style="font-size:11px;color:var(--text3);margin-top:2px">${l==="ar"?"مغلقة وموثقة بالسجل":"Closed and logged in the record"}</div></div>
            <span class="tag tg">${done.length}</span>
          </div>
          ${done.length === 0
            ? `<div style="text-align:center;padding:28px 16px"><div style="font-size:30px;margin-bottom:8px">📋</div><div style="font-size:12px;color:var(--text3)">${l==="ar"?"لا مهام مكتملة بعد":"No completed tasks yet"}</div><div style="font-size:11px;color:var(--text3);margin-top:4px;opacity:.7">${l==="ar"?"حدّث حالة المهام عند إنجازها":"Mark tasks done as you complete them"}</div></div>`
            : done.map(renderTask).join("")}
        </div>
        <div class="card">
          <div class="ch" style="margin-bottom:6px">
            <div><div class="ct">⚖️ ${l==="ar"?"القرارات":"Decisions"}</div><div style="font-size:11px;color:var(--text3);margin-top:2px">${l==="ar"?"مستخرجة آلياً من محاضر الاجتماعات":"Auto-extracted from meeting minutes"}</div></div>
            <span class="tag" style="background:var(--navy4)">${decisions.length}</span>
          </div>
          ${decisions.length === 0
            ? `<div style="text-align:center;padding:28px 16px"><div style="font-size:30px;margin-bottom:8px">⚖️</div><div style="font-size:12px;color:var(--text3)">${l==="ar"?"لا قرارات مسجلة بعد":"No decisions recorded yet"}</div><div style="font-size:11px;color:var(--text3);margin-top:4px;opacity:.7">${l==="ar"?"القرارات تُستخرج تلقائياً عند تسجيل الاجتماعات":"Decisions auto-appear after meetings are recorded"}</div></div>`
            : decisions.map(renderDecision).join("")}
        </div>
      </div>`;

    // ── List view — every matching task in one sorted list (overdue first,
    // then soonest due date), reusing the same task-card renderer as Board.
    const listSource = filtersActive ? filtered : tasks;
    const isRecentView = f.quick === "recent";
    const listSorted = [...listSource].sort((a, b) => {
      if (isRecentView) {
        return (b.created_at || "").localeCompare(a.created_at || "");
      }
      const aOv = a.status === "overdue" ? 0 : 1;
      const bOv = b.status === "overdue" ? 0 : 1;
      if (aOv !== bOv) return aOv - bOv;
      if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
    const listBodyHtml = `<div class="card">
      <div class="ch" style="margin-bottom:6px">
        <div><div class="ct">${isRecentView ? (l==="ar"?"أحدث الإجراءات":"Most Recent Actions") : (l==="ar"?"كل الإجراءات التنفيذية":"All Executive Actions")}</div><div style="font-size:11px;color:var(--text3);margin-top:2px">${isRecentView ? (l==="ar"?`${listSorted.length} إجراء — الأحدث أولاً`:`${listSorted.length} action(s) — newest first`) : (l==="ar"?`${listSorted.length} إجراء — مرتبة حسب الأولوية والاستحقاق`:`${listSorted.length} action(s) — sorted by urgency and due date`)}</div></div>
      </div>
      ${listSorted.length === 0
        ? emptyStateCard({
            icon: "📋",
            titleAr: "لا توجد إجراءات مطابقة",
            titleEn: "No matching actions",
            descAr: "جرّب تغيير المرشح السريع أو إعادة تعيين البحث.",
            descEn: "Try changing the quick filter or resetting the search.",
            secondary: { ar: "✕ إعادة تعيين", en: "✕ Reset", onclick: "TaskFilters.reset()" },
          })
        : listSorted.map(renderTask).join("")}
    </div>`;

    // ── Calendar view — month grid bucketed by due_date; click a day to see
    // its actions below using the same task-card renderer.
    const calBase = new Date();
    calBase.setDate(1);
    calBase.setMonth(calBase.getMonth() + TaskView._calOffset);
    const calYear = calBase.getFullYear();
    const calMonthIdx = calBase.getMonth();
    const startWeekday = new Date(calYear, calMonthIdx, 1).getDay();
    const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
    const monthLabel = calBase.toLocaleDateString(l === "ar" ? "ar-SA-u-ca-gregory" : "en-US", { month: "long", year: "numeric" });
    const weekDayNames = l === "ar" ? ["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"] : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const calSource = filtersActive ? filtered : tasks;
    const tasksByDate = {};
    calSource.forEach((t) => { if (t.due_date) (tasksByDate[t.due_date] = tasksByDate[t.due_date] || []).push(t); });
    const priColor = (t) => t.status === "overdue" ? "var(--red)" : taskPriorityKey(t.priority) === "critical" ? "var(--red)" : taskPriorityKey(t.priority) === "high" ? "var(--amber)" : "var(--gold)";

    let calCells = "";
    for (let i = 0; i < startWeekday; i++) calCells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayTasks = tasksByDate[dateStr] || [];
      const isToday = dateStr === today;
      const isSelected = TaskView._selectedDay === dateStr;
      calCells += `<div class="cal-cell ${isToday ? "cal-today" : ""} ${isSelected ? "cal-selected" : ""}" onclick="TaskView.selectDay('${dateStr}')" tabindex="0" role="button" aria-label="${dateStr}${dayTasks.length ? ", " + dayTasks.length + " " + (l === "ar" ? "إجراء" : "action(s)") : ""}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();TaskView.selectDay('${dateStr}')}">
        <div class="cal-daynum">${d}</div>
        ${dayTasks.length ? `<div class="cal-dots">
          ${dayTasks.slice(0, 4).map((t) => `<div class="cal-dot" style="background:${priColor(t)}" title="${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}"></div>`).join("")}
          ${dayTasks.length > 4 ? `<div class="cal-more">+${dayTasks.length - 4}</div>` : ""}
        </div>` : ""}
      </div>`;
    }
    const selectedDayTasks = TaskView._selectedDay ? (tasksByDate[TaskView._selectedDay] || []) : [];
    const calendarBodyHtml = `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <button class="btn-ghost btn-sm" onclick="TaskView.calNav(-1)">◀ ${l === "ar" ? "الشهر السابق" : "Previous"}</button>
          <div style="font-weight:700;font-size:14px">${esc(monthLabel)}</div>
          <button class="btn-ghost btn-sm" onclick="TaskView.calNav(1)">${l === "ar" ? "الشهر التالي" : "Next"} ▶</button>
        </div>
        <div class="cal-grid cal-grid-head">${weekDayNames.map((w) => `<div class="cal-headcell">${w}</div>`).join("")}</div>
        <div class="cal-grid">${calCells}</div>
      </div>
      ${TaskView._selectedDay ? `<div class="card">
        <div class="ch" style="margin-bottom:6px">
          <div class="ct">📌 ${esc(TaskView._selectedDay)}</div>
          <span class="tag" style="background:var(--navy4)">${selectedDayTasks.length}</span>
        </div>
        ${selectedDayTasks.length ? selectedDayTasks.map(renderTask).join("") : `<div style="text-align:center;padding:20px"><div style="font-size:12.5px;color:var(--text3)">${l === "ar" ? "لا إجراءات مستحقة هذا اليوم" : "No actions due this day"}</div></div>`}
      </div>` : ""}
    `;

    // ── Pending Review queue — dedicated card list for AI-extracted tasks that
    // haven't been approved/rejected yet. Shown instead of the normal board/
    // list/calendar view whenever the "Pending Review" quick chip is active.
    const pendingReviewBodyHtml = `
      <div class="card" style="margin-bottom:14px;background:rgba(212,160,23,.06);border:.5px solid rgba(212,160,23,.25)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="rv-select-all" onchange="ReviewQueue.toggleAll(this.checked)" style="width:16px;height:16px;cursor:pointer"/>
            <label for="rv-select-all" style="font-size:12.5px;color:var(--text2);cursor:pointer">${l === "ar" ? "تحديد الكل" : "Select all"}</label>
            <span id="rv-selected-count" class="tag" style="background:var(--navy4);font-size:11px">0 ${l === "ar" ? "محدد" : "selected"}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="rv-bulk-approve" class="btn-gold btn-sm" disabled onclick="ReviewQueue.bulkApprove()">✓ ${l === "ar" ? "اعتماد المحدد" : "Approve Selected"}</button>
            <button id="rv-bulk-assign" class="btn-ghost btn-sm" disabled onclick="ReviewQueue.bulkAssign()">👤 ${l === "ar" ? "إسناد المحدد" : "Assign Selected"}</button>
            <button id="rv-bulk-reject" class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" disabled onclick="ReviewQueue.bulkReject()">✕ ${l === "ar" ? "رفض المحدد" : "Reject Selected"}</button>
            <button id="rv-bulk-delete" class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" disabled onclick="ReviewQueue.bulkDelete()">🗑 ${l === "ar" ? "حذف المحدد" : "Delete Selected"}</button>
          </div>
        </div>
        <div id="rv-assign-bar" style="display:none;margin-top:10px;padding-top:10px;border-top:.5px solid var(--border2)">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12.5px;color:var(--text2)">${l === "ar" ? "إسناد إلى:" : "Assign to:"}</span>
            <select id="rv-assign-owner" class="fi" style="width:auto;min-width:180px">
              <option value="">${l === "ar" ? "-- اختر عضواً --" : "-- Choose member --"}</option>
              ${members.map((m) => `<option value="${m.id}">${esc(l === "ar" ? m.name_ar : m.name_en || m.name_ar)}</option>`).join("")}
            </select>
            <button class="btn-gold btn-sm" onclick="ReviewQueue.confirmBulkAssign()">${l === "ar" ? "تأكيد الإسناد" : "Confirm Assign"}</button>
            <button class="btn-ghost btn-sm" onclick="ReviewQueue.cancelBulkAssign()">${l === "ar" ? "إلغاء" : "Cancel"}</button>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">
        ${pendingReviewTasks
          .map((t) => {
            const text = l === "ar" ? t.text_ar || t.text_en : t.text_en || t.text_ar;
            const owner = l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar;
            const dept = ownerDept[t.owner_id];
            const mtg = l === "ar" ? t.source_meeting_title_ar : t.source_meeting_title_en || t.source_meeting_title_ar;
            const pri = taskPriorityMeta(t.priority);
            return `<div class="card" id="rv-card-${t.id}" style="border-inline-start:3px solid var(--gold)">
              <div style="display:flex;gap:10px;align-items:flex-start">
                <input type="checkbox" class="rv-chk" data-id="${t.id}" onchange="ReviewQueue.updateCount()" style="margin-top:3px;width:16px;height:16px;cursor:pointer;flex-shrink:0"/>
                <div style="flex:1;min-width:0">
                  <div id="rv-text-${t.id}" style="font-size:13.5px;font-weight:600;color:var(--text);line-height:1.45;margin-bottom:8px">${esc(text)}</div>
                  <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                    ${ExecutiveActions._confidenceBadge(t.ai_confidence, l)}
                    <span class="tag" style="font-size:11px;background:${pri.bg};color:${pri.c};border:.5px solid ${pri.bd}">${l === "ar" ? pri.ar : pri.en}</span>
                    ${owner ? `<span class="tag tgold" style="font-size:11px">👤 ${esc(owner)}</span>` : `<span class="tag" style="background:var(--navy4);font-size:11px;color:var(--text3)">👤 ${l === "ar" ? "غير مسند" : "Unassigned"}</span>`}
                    ${dept ? `<span class="tag" style="background:var(--navy4);font-size:11px">🏢 ${esc(dept)}</span>` : ""}
                    ${t.due_date ? `<span class="tag" style="background:var(--navy4);font-size:11px">📅 ${esc(t.due_date)}</span>` : ""}
                  </div>
                  ${mtg ? `<div style="font-size:11px;color:var(--text3);margin-bottom:8px">📝 ${esc(mtg)}</div>` : ""}
                  <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn-ghost btn-sm" onclick="Tasks.edit(${t.id})">✏️ ${l === "ar" ? "تعديل" : "Edit"}</button>
                    <button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick="ReviewQueue.reject(${t.id})">✕ ${l === "ar" ? "رفض" : "Reject"}</button>
                    <button class="btn-gold btn-sm" onclick="ReviewQueue.approve(${t.id})">✓ ${l === "ar" ? "اعتماد" : "Approve"}</button>
                  </div>
                </div>
              </div>
            </div>`;
          })
          .join("")}
      </div>
    `;

    const showReviewQueue = f.quick === "review" && pendingReviewTasks.length > 0;
    const viewBodyHtml = view === "list" ? listBodyHtml : view === "calendar" ? calendarBodyHtml : boardBodyHtml;

    body.innerHTML = showReviewQueue
      ? quickFilterBarHtml +
        _secHdrT("⏳", "مراجعة إجراءات الذكاء الاصطناعي التنفيذية", "AI Executive Action Review") +
        pendingReviewBodyHtml
      : quickFilterBarHtml +
        _filterBar +
        kpiHtml +
        viewSwitcherHtml +
        _secHdrT("⚡", "الجدول الزمني لحوكمة الإجراءات", "Action Governance Timeline") +
        viewBodyHtml;
    if (showReviewQueue) ReviewQueue.updateCount();
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
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
    $("modal-task").classList.add("open");
    TaskTimeline.load(id, t);
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
    ["nt-ar", "nt-en", "nt-due"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const p = $("nt-priority");
    if (p) p.value = "medium";
    const o = $("nt-owner");
    if (o) o.value = "";
    const statusRow = $("nt-status-row");
    if (statusRow) statusRow.style.display = "none";
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
      </div>`;
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
    const note = document.createElement("div");
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
      alert(
        l === "ar"
          ? `✓ تمت المشاركة مع ${r.shared} عضو`
          : `✓ Shared with ${r.shared} member(s)`,
      );
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
    const row = $("nm-join-row");
    if (row) row.style.display = v === "physical" ? "none" : "";
    const note = $("nm-provider-note");
    if (note) note.style.display = v === "physical" ? "none" : "";
    const inp = $("nm-join-url");
    if (inp) {
      inp.placeholder = v === "zoom" ? "https://zoom.us/j/..." : v === "teams" ? "https://teams.microsoft.com/l/meetup-join/..." : v === "google_meet" ? "https://meet.google.com/..." : "";
    }
  },
  _editingId: null,
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
    if ($("nm-channel")) $("nm-channel").value = "email";
    if ($("nm-dur")) $("nm-dur").value = "60";
    if ($("nm-plat")) { $("nm-plat").value = "physical"; Schedule.onProviderChange(); }
    SeriesUI.invalidate();
    SeriesUI.setMode("nm", "standalone");
    SeriesUI.init("nm");
  },
  // Toggles the "Schedule New Meeting" form between create mode and edit mode
  // (title/button text + Cancel button visibility) without introducing a
  // second form — same pattern as Modals._editingId for tasks/series.
  _setFormMode(editing) {
    const l = App.lang;
    const titleEl = $("nm-form-title");
    if (titleEl) titleEl.textContent = editing
      ? (l === "ar" ? "تعديل الاجتماع" : "Edit Meeting")
      : (l === "ar" ? "جدولة اجتماع جديد" : "Schedule New Meeting");
    const labelEl = $("nm-submit-label");
    if (labelEl) labelEl.textContent = editing
      ? (l === "ar" ? "حفظ التعديلات" : "Save Changes")
      : (l === "ar" ? "جدولة" : "Schedule");
    const cancelBtn = $("nm-cancel-btn");
    if (cancelBtn) cancelBtn.style.display = editing ? "" : "none";
    const tplBtn = $("nm-template-save-btn");
    if (tplBtn) tplBtn.style.display = editing ? "none" : "";
  },
  cancelEdit() {
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
  async add() {
    const editingId = this._editingId;
    const title = $("nm-title").value.trim();
    const data = {
      title_ar: title,
      title_en: title,
      meeting_date: $("nm-date").value,
      meeting_time: $("nm-time").value,
      duration_mins: $("nm-dur").value,
      meeting_provider: $("nm-plat").value,
      meeting_join_url: ($("nm-join-url") && $("nm-join-url").value.trim()) || "",
      platform: { zoom: "Zoom", teams: "Microsoft Teams", google_meet: "Google Meet" }[$("nm-plat").value] || "قاعة الاجتماعات",
      attendees: $("nm-att").value,
      agenda_ar: $("nm-agenda-ar").value,
      agenda_en: $("nm-agenda-en").value,
      reminder_channel: ($("nm-channel") && $("nm-channel").value) || "email",
      meeting_type: ($("nm-type") && $("nm-type").value) || "",
      board_id: parseInt($("nm-board") && $("nm-board").value) || null,
      committee_id: parseInt($("nm-committee") && $("nm-committee").value) || null,
      prev_meeting_id: parseInt($("nm-prev") && $("nm-prev").value) || null,
      recurrence: ($("nm-recurrence") && $("nm-recurrence").value) || "none",
      ...SeriesUI.resolvePayload("nm"),
    };
    if (!data.title_ar || !data.meeting_date || !data.meeting_time) {
      alert(
        App.lang === "ar"
          ? "يرجى إدخال العنوان والتاريخ والوقت"
          : "Please enter title, date and time",
      );
      return;
    }
    const rec = data.recurrence;
    try {
      if (editingId) {
        await api(`/api/schedule/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
        this._editingId = null;
        this._setFormMode(false);
        showToast(App.lang === "ar" ? "✓ تم حفظ التعديلات" : "✓ Changes saved");
      } else {
        await api("/api/schedule", {
          method: "POST",
          body: JSON.stringify(data),
        });
        $("sched-toast").style.display = "flex";
        setTimeout(() => ($("sched-toast").style.display = "none"), 2500);
      }
      await renderSchedule();
      await loadBadges();
      this._resetForm();
      if (!editingId && rec !== "none")
        showToast(
          App.lang === "ar"
            ? `✓ تم جدولة الاجتماع + 3 تكرارات (${recurrenceLabel(rec, App.lang)})`
            : `✓ Meeting + 3 recurrences scheduled (${recurrenceLabel(rec, App.lang)})`,
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
      Panels.load("history").then(() => setTimeout(() => MeetingHistory.select(id), 300));
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
      Panels.load("history").then(() => setTimeout(() => MeetingHistory.select(item.source_meeting_id), 300));
    } else {
      Panels.load("schedule").then(() => Schedule.edit(id));
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
              📅 ${esc(s.meeting_date || "")} ${s.meeting_time ? `🕐 ${esc(s.meeting_time)}` : ""} · ${s.duration_mins || 60} ${l === "ar" ? "د" : "min"} · ${esc(s.platform || "")}
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
    const [stats, tasks, meetings, schedule, members, decisions, analytics, govSummary] =
      await Promise.all([
        api("/api/stats"),
        api("/api/tasks"),
        api("/api/meetings"),
        api("/api/schedule"),
        api("/api/members"),
        api("/api/decisions"),
        api("/api/analytics"),
        api("/api/gov/summary").catch(() => null),
      ]);
    const l = App.lang;
    const lbl = (ar, en) => (l === "ar" ? ar : en);
    const today = new Date().toISOString().substring(0, 10);
    const upcoming = schedule.filter((s) => s.meeting_date >= today);
    const todaysMeetings = schedule.filter((s) => s.meeting_date === today);

    // ── Executive greeting — the command center opens with the person, not
    // a metrics wall.
    const hour = new Date().getHours();
    const greetText =
      hour < 12
        ? lbl("صباح الخير", "Good Morning")
        : hour < 18
          ? lbl("مساء الخير", "Good Afternoon")
          : lbl("مساء الخير", "Good Evening");
    const userName = App.user
      ? l === "ar"
        ? App.user.name_ar
        : App.user.name_en || App.user.name_ar
      : "";
    const todayLabel = new Date().toLocaleDateString(
      l === "ar" ? "ar-SA" : "en-US",
      { weekday: "long", year: "numeric", month: "long", day: "numeric" },
    );
    const greetingHtml = `<div style="margin-bottom:22px">
      <div style="font-size:26px;font-weight:800;color:var(--text);letter-spacing:-.02em;line-height:1.2">${greetText}${userName ? ", " + esc(userName) : ""}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:6px">${esc(todayLabel)} · ${
        todaysMeetings.length
          ? todaysMeetings.length +
            " " +
            lbl(
              "اجتماع اليوم",
              todaysMeetings.length === 1 ? "meeting today" : "meetings today",
            )
          : lbl("لا اجتماعات اليوم", "no meetings today")
      }</div>
    </div>`;

    const role = App.systemRole || "Admin";
    const allStatCards = [
      {
        key: "meetings",
        icon: "🎙",
        val: stats.meetings,
        label: lbl("اجتماع مسجل", "Recorded Meetings"),
        color: "var(--gold)",
        go: "transcripts",
      },
      {
        key: "tasks_open",
        icon: "📋",
        val: stats.tasks_open,
        label: lbl("مهمة مفتوحة", "Open Tasks"),
        color: stats.tasks_overdue > 0 ? "var(--red)" : "var(--amber)",
        go: "tasks",
      },
      {
        key: "tasks_overdue",
        icon: "⚠️",
        val: stats.tasks_overdue,
        label: lbl("مهمة متأخرة", "Overdue Tasks"),
        color: "var(--red)",
        go: "tasks",
      },
      {
        key: "tasks_done",
        icon: "✓",
        val: stats.tasks_done,
        label: lbl("مهمة مكتملة", "Completed Tasks"),
        color: "var(--green)",
        go: "tasks",
      },
      {
        key: "decisions",
        icon: "⚖️",
        val: stats.decisions,
        label: lbl("قرار مسجل", "Decisions"),
        color: "var(--blue)",
        go: "transcripts",
      },
      {
        key: "schedule",
        icon: "📅",
        val: stats.schedule,
        label: lbl("اجتماع مجدول", "Scheduled"),
        color: "var(--gold)",
        go: "schedule",
      },
      {
        key: "users",
        icon: "👥",
        val: stats.users,
        label: lbl("عضو فريق", "Team Members"),
        color: "var(--text)",
        go: "team",
      },
      {
        key: "completion",
        icon: "🎯",
        val: stats.completion + "%",
        label: lbl("نسبة الإنجاز", "Completion Rate"),
        color:
          stats.completion > 70
            ? "var(--green)"
            : stats.completion > 40
              ? "var(--amber)"
              : "var(--red)",
        go: "tasks",
      },
      {
        key: "tasks_blocked",
        icon: "⛔",
        val: stats.tasks_blocked || 0,
        label: lbl("إجراء معلّق", "Blocked Actions"),
        color: (stats.tasks_blocked || 0) > 0 ? "var(--red)" : "var(--text3)",
        go: "tasks",
      },
      {
        key: "tasks_high",
        icon: "⚡",
        val: stats.tasks_high || 0,
        label: lbl("أولوية عالية", "High Priority"),
        color: "var(--amber)",
        go: "tasks",
      },
      {
        key: "tasks_critical",
        icon: "🔥",
        val: stats.tasks_critical || 0,
        label: lbl("أولوية حرجة", "Critical Priority"),
        color: (stats.tasks_critical || 0) > 0 ? "var(--red)" : "var(--text3)",
        go: "tasks",
      },
    ];

    const ROLE_STAT_KEYS = {
      Admin: [
        "meetings",
        "tasks_open",
        "tasks_overdue",
        "tasks_done",
        "decisions",
        "schedule",
        "users",
        "completion",
        "tasks_blocked",
        "tasks_high",
        "tasks_critical",
      ],
      CEO: [
        "meetings",
        "tasks_open",
        "tasks_overdue",
        "tasks_done",
        "decisions",
        "schedule",
        "users",
        "completion",
        "tasks_blocked",
        "tasks_high",
        "tasks_critical",
      ],
      "Board Member": ["meetings", "decisions", "schedule", "completion"],
      "Committee Member": [
        "tasks_open",
        "tasks_overdue",
        "tasks_done",
        "decisions",
      ],
      Executive: [
        "meetings",
        "tasks_open",
        "tasks_overdue",
        "tasks_done",
        "decisions",
        "schedule",
        "completion",
      ],
      Manager: [
        "meetings",
        "tasks_open",
        "tasks_overdue",
        "tasks_done",
        "users",
        "completion",
      ],
      Employee: ["tasks_open", "tasks_overdue", "tasks_done"],
      Observer: ["meetings", "decisions", "schedule"],
      "Super Admin": [
        "meetings", "tasks_open", "tasks_overdue", "tasks_done", "decisions",
        "schedule", "users", "completion", "tasks_blocked", "tasks_high", "tasks_critical",
      ],
      "Organization Admin": [
        "meetings", "tasks_open", "tasks_overdue", "tasks_done", "decisions",
        "schedule", "users", "completion", "tasks_blocked", "tasks_high", "tasks_critical",
      ],
      "Board Secretary": ["meetings", "decisions", "schedule", "completion", "tasks_open", "tasks_overdue"],
      "Committee Chair": ["tasks_open", "tasks_overdue", "tasks_done", "decisions"],
      Auditor: ["meetings", "decisions", "schedule", "tasks_open", "tasks_overdue", "tasks_done", "completion"],
      Guest: ["meetings", "schedule"],
    };
    const allowedKeys = new Set(
      ROLE_STAT_KEYS[role] || ROLE_STAT_KEYS["Admin"],
    );
    const statCards = allStatCards.filter((c) => allowedKeys.has(c.key));

    const roleColor = ROLE_COLORS[role] || "var(--gold)";
    const roleHeader =
      role !== "Admin" && role !== "CEO"
        ? `
      <div style="background:${roleColor}0d;border:1px solid ${roleColor}33;border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">👤</span>
        <div>
          <span style="color:${roleColor};font-weight:700;font-size:13px">${esc(role)}</span>
          <span style="color:var(--text3);font-size:12px"> · ${l === "ar" ? "لوحة التحكم مخصصة لدورك" : "Dashboard customised for your role"}</span>
        </div>
      </div>`
        : "";

    // Trend & sub-description per metric
    const statTrendData = (s) => ({
      meetings:      { trend:'neu', tl: lbl('كل الاجتماعات','All sessions'), sub: lbl('انقر لعرض المحاضر','Click to view transcripts') },
      tasks_open:    { trend: s.val > 0 ? 'warn' : 'neu', tl: s.val > 0 ? lbl(`${stats.tasks_overdue} متأخرة`,''+stats.tasks_overdue+' overdue') : lbl('لا مهام مفتوحة','No open tasks'), sub: lbl('المهام الجارية والجديدة','In-progress & new tasks') },
      tasks_overdue: { trend: s.val > 0 ? 'down' : 'neu', tl: s.val > 0 ? lbl('تحتاج انتباهاً فورياً','Requires immediate action') : lbl('لا متأخرة ✓','None overdue ✓'), sub: lbl('المهام المتجاوزة للموعد','Past due date') },
      tasks_done:    { trend:'up',  tl: stats.completion + '% ' + lbl('نسبة إنجاز','completion'), sub: lbl('مكتملة هذا الأسبوع','Completed tasks') },
      decisions:     { trend:'neu', tl: lbl('قيد التنفيذ','Tracked decisions'), sub: lbl('من كل الاجتماعات','Across all meetings') },
      schedule:      { trend:'neu', tl: lbl('الـ 30 يوم القادمة','Next 30 days'), sub: lbl('اجتماعات مجدولة','Scheduled meetings') },
      users:         { trend:'neu', tl: lbl('أعضاء الفريق','Team members'), sub: lbl('لديهم صلاحية الوصول','With system access') },
      completion:    { trend: s.val >= 70 ? 'up' : s.val >= 40 ? 'warn' : 'down', tl: s.val >= 70 ? lbl('أداء ممتاز','Excellent performance') : s.val >= 40 ? lbl('أداء متوسط','Moderate performance') : lbl('يحتاج متابعة','Needs attention'), sub: lbl('نسبة إنجاز المهام','Overall task completion') },
    }[s.key] || { trend:'neu', tl: '', sub: '' });

    // Executive hierarchy: the first few metrics (meetings + task pipeline)
    // read as large "hero" KPIs; the rest are compact pills below them — per
    // "large KPIs... not dozens of equal-sized boxes" rather than one flat
    // grid of identical cards.
    const heroCards = statCards.slice(0, 4);
    const secondaryCards = statCards.slice(4);

    const statsHtml = `<div class="stat-hero-grid" style="margin-bottom:${secondaryCards.length ? '12px' : '16px'}">
        ${heroCards.map((s) => {
          const td = statTrendData(s);
          const trendClass = { up:'trend-up', down:'trend-down', neu:'trend-neu', warn:'trend-warn' }[td.trend];
          const trendIcon  = { up:'↑', down:'↓', neu:'●', warn:'⚠' }[td.trend];
          return `<div class="card stat-clickable" style="text-align:center;padding:24px 16px 20px;cursor:pointer;position:relative;overflow:hidden;min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center" onclick="Panels.load('${s.go}')" title="${esc(s.label)}">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${s.color};opacity:.9;border-radius:14px 14px 0 0"></div>
          <div style="font-size:32px;margin-bottom:10px;line-height:1">${s.icon}</div>
          <div class="stat-hero-val" style="font-weight:800;color:${s.color};letter-spacing:-.04em;line-height:1">${s.val}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text2);margin-top:7px;line-height:1.3">${s.label}</div>
          <div class="stat-trend ${trendClass}">${trendIcon} ${td.tl}</div>
          <div style="font-size:11.5px;color:var(--text3);margin-top:6px;line-height:1.4">${td.sub}</div>
          <div class="stat-click-hint">${l === 'ar' ? '← اضغط للعرض' : 'click to view →'}</div>
        </div>`;
        }).join("")}
      </div>
      ${secondaryCards.length ? `<div class="stat-mini-row" style="margin-bottom:16px">
        ${secondaryCards.map((s) => `<div class="stat-mini" onclick="Panels.load('${s.go}')" title="${esc(s.label)}">
          <span class="stat-mini-icon">${s.icon}</span>
          <div>
            <div class="stat-mini-val" style="color:${s.color}">${s.val}</div>
            <div class="stat-mini-lbl">${s.label}</div>
          </div>
        </div>`).join("")}
      </div>` : ""}`;

    const hasCharts = !!window.Chart;
    const dashCfg = Dash.get();
    const chartsGridHtml = hasCharts
      ? `
      <div class="grid-2" style="margin-bottom:14px">
        <div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">📊 ${lbl("مسار المهام — 8 أسابيع", "Task Trend — 8 Weeks")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-tasks"></canvas></div></div>
        <div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">🎙 ${lbl("نشاط الاجتماعات — 6 أشهر", "Meeting Activity — 6 Months")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-meetings"></canvas></div></div>
        ${dashCfg.team !== false ? `<div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">👥 ${lbl("أداء الفريق", "Team Performance")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-team"></canvas></div></div>` : ""}
        <div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">⚖️ ${lbl("حالة القرارات", "Decision Status")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-decisions"></canvas></div></div>
      </div>`
      : "";

    const upcomingHtml = `<div class="card stat-clickable" style="cursor:pointer" onclick="Panels.load('schedule')" title="${lbl("فتح الجدول", "Open schedule")}">
          <div class="ct" style="margin-bottom:12px">📅 ${lbl("الاجتماعات القادمة", "Upcoming Meetings")}</div>
          ${
            upcoming.length
              ? upcoming
                  .slice(0, 5)
                  .map(
                    (s) => `
            <div style="padding:8px 0;border-bottom:.5px solid var(--border2)">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(l === "ar" ? s.title_ar : s.title_en || s.title_ar)}</div>
                ${s.meeting_type ? `<span class="tag tgold" style="font-size:11px;padding:2px 6px">${esc(mtLabel(s.meeting_type, l))}</span>` : ""}
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">📅 ${esc(s.meeting_date || "")} ${s.meeting_time ? "🕐 " + esc(s.meeting_time) : ""} · ${esc(s.platform || "")}</div>
            </div>`,
                  )
                  .join("")
              : `<div style="font-size:12px;color:var(--text3)">${lbl("لا اجتماعات قادمة", "No upcoming meetings")}</div>`
          }
        </div>`;

    // ── Today's Meetings — meetings dated today, distinct from the 30-day
    // "Upcoming Meetings" preview.
    const todaysMeetingsHtml = todaysMeetings.length
      ? `<div class="card stat-clickable" style="cursor:pointer" onclick="Panels.load('schedule')" title="${lbl("فتح الجدول", "Open schedule")}">
          <div class="ct" style="margin-bottom:12px">🎯 ${lbl("اجتماعات اليوم", "Today's Meetings")}</div>
          ${todaysMeetings
            .map(
              (s) => `
            <div style="padding:9px 0;border-bottom:.5px solid var(--border2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(l === "ar" ? s.title_ar : s.title_en || s.title_ar)}</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px">🕐 ${esc(s.meeting_time || "")}${s.platform ? " · " + esc(s.platform) : ""}</div>
              </div>
              ${s.meeting_type ? `<span class="tag tgold" style="font-size:11px">${esc(mtLabel(s.meeting_type, l))}</span>` : ""}
            </div>`,
            )
            .join("")}
        </div>`
      : `<div class="card" style="text-align:center;padding:22px 16px">
          <div style="font-size:13px;color:var(--text3)">✓ ${lbl("لا اجتماعات مجدولة اليوم", "No meetings scheduled today")}</div>
        </div>`;

    // ── Pending Governance Approvals — reuses the existing /api/gov/summary
    // endpoint (already auth-gated); shown only to roles with governance
    // access, no backend change.
    const canGov = ROLE_ACCESS[role] && ROLE_ACCESS[role].has("governance");
    const govPendingRes = ((govSummary && govSummary.recentRes) || []).filter(
      (r) => r.status === "pending",
    );
    const govWidgetHtml =
      canGov && govSummary
        ? `<div class="card stat-clickable" style="cursor:pointer" onclick="Panels.load('governance')" title="${lbl("فتح الحوكمة", "Open governance")}">
          <div class="ct" style="margin-bottom:12px">🏛️ ${lbl("موافقات الحوكمة المعلقة", "Pending Governance Approvals")}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:${govPendingRes.length ? "10px" : "0"}">
            <span style="background:rgba(255,193,7,.1);border:1px solid rgba(255,193,7,.3);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--amber)">${govSummary.resPending || 0} ${lbl("قرار قيد الانتظار", "resolutions pending")}</span>
            <span style="background:rgba(91,155,214,.1);border:1px solid rgba(91,155,214,.3);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--blue)">${govSummary.pendingMinutes || 0} ${lbl("محضر قيد المراجعة", "minutes in review")}</span>
            ${govSummary.openActions ? `<span style="background:rgba(224,90,90,.1);border:1px solid rgba(224,90,90,.3);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--red)">${govSummary.openActions} ${lbl("إجراء متابعة مفتوح", "open follow-ups")}</span>` : ""}
          </div>
          ${
            govPendingRes.length
              ? govPendingRes
                  .slice(0, 4)
                  .map(
                    (r) => `
            <div style="padding:7px 0;border-bottom:.5px solid var(--border2)">
              <div style="font-size:12px;color:var(--text)">${esc(r.title)}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(l === "ar" ? r.meeting_title_ar : r.meeting_title_en || r.meeting_title_ar || "")}</div>
            </div>`,
                  )
                  .join("")
              : `<div style="font-size:12px;color:var(--green)">✓ ${lbl("لا قرارات معلقة", "No pending resolutions")}</div>`
          }
        </div>`
        : "";

    // ── Recent AI Activity — derived from already-processed meetings; a
    // truthful stand-in for a real activity log (out of scope: no backend
    // change / new endpoint this round).
    const recentAi = meetings
      .filter((m) => m.ai_summary_ar || m.ai_summary_en)
      .slice(0, 5);
    const aiActivityHtml = recentAi.length
      ? `<div class="card stat-clickable" style="cursor:pointer" onclick="Panels.load('transcripts')" title="${lbl("فتح المحاضر", "Open transcripts")}">
          <div class="ct" style="margin-bottom:12px">🤖 ${lbl("نشاط الذكاء الاصطناعي الأخير", "Recent AI Activity")}</div>
          ${recentAi
            .map(
              (m) => `
            <div style="padding:7px 0;border-bottom:.5px solid var(--border2)">
              <div style="font-size:12px;color:var(--text)">${esc(l === "ar" ? m.title_ar : m.title_en || m.title_ar)}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">✓ ${lbl("محضر بالذكاء الاصطناعي جاهز", "AI minutes generated")}${m.meeting_date ? " · " + esc(String(m.meeting_date).substring(0, 10)) : ""}</div>
            </div>`,
            )
            .join("")}
        </div>`
      : `<div class="card" style="text-align:center;padding:22px 16px">
          <div style="font-size:13px;color:var(--text3)">${lbl("لا نشاط ذكاء اصطناعي بعد", "No AI activity yet")}</div>
        </div>`;

    // ── Today's Executive Briefing — a scannable bullet list, not another
    // grid of equal-sized cards, so the most time-sensitive facts read first.
    const dueTodayTasks = tasks.filter((t) => t.due_date === today && t.status !== "done" && t.status !== "cancelled");
    const criticalTasks = tasks.filter((t) => taskPriorityKey(t.priority) === "critical" && t.status !== "done" && t.status !== "cancelled");
    const decisionsAwaiting = decisions.filter((d) => d.status !== "implemented");
    // "Meetings Today" used to just dump the user onto the Schedule panel's
    // default List view, which sorts oldest-first — with any meeting history
    // at all, that meant landing on a months-old past meeting instead of the
    // one the stat card was actually about. Route into the Calendar view
    // with today pre-selected instead, so the promised meeting is what's
    // actually shown, not buried under history.
    const meetingsTodayClick = todaysMeetings.length
      ? `Panels.load('schedule').then(()=>{MasterCalendar.setView('calendar');MasterCalendar.selectDay('${today}');})`
      : `Panels.load('schedule')`;
    const briefingItems = [
      { icon: "📅", val: todaysMeetings.length, ar: "اجتماعات اليوم", en: "Meetings Today", onclick: meetingsTodayClick, color: "var(--gold)" },
      { icon: "🎯", val: dueTodayTasks.length, ar: "إجراءات مستحقة اليوم", en: "Executive Actions Due Today", onclick: `Panels.load('tasks')`, color: dueTodayTasks.length ? "var(--amber)" : "var(--text3)" },
      { icon: "🔥", val: criticalTasks.length, ar: "إجراءات حرجة", en: "Critical Actions", onclick: `Panels.load('tasks')`, color: criticalTasks.length ? "var(--red)" : "var(--text3)" },
      ...(canGov && govSummary ? [{ icon: "🏛️", val: govSummary.pendingMinutes || 0, ar: "موافقات معلقة", en: "Pending Approvals", onclick: `Panels.load('governance')`, color: (govSummary.pendingMinutes || 0) ? "var(--blue)" : "var(--text3)" }] : []),
      { icon: "⚖️", val: decisionsAwaiting.length, ar: "قرارات بانتظار المراجعة", en: "Decisions Awaiting Review", onclick: `Panels.load('tasks')`, color: decisionsAwaiting.length ? "var(--amber)" : "var(--text3)" },
    ];
    const briefingHtml = `<div class="card" style="margin-bottom:16px">
      <div class="ct" style="margin-bottom:10px">📰 ${lbl("موجز اليوم التنفيذي", "Today's Executive Briefing")}</div>
      <div style="display:flex;flex-direction:column">
        ${briefingItems
          .map(
            (b, i) => `<div class="stat-clickable" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:10px 4px;${i > 0 ? "border-top:.5px solid var(--border2)" : ""}" onclick="${b.onclick}">
          <span style="font-size:18px;flex-shrink:0">${b.icon}</span>
          <span style="font-size:20px;font-weight:800;color:${b.color};min-width:28px">${b.val}</span>
          <span style="font-size:13px;color:var(--text2);flex:1">${l === "ar" ? b.ar : b.en}</span>
          <span style="font-size:11px;color:var(--text3)">${l === "ar" ? "←" : "→"}</span>
        </div>`,
          )
          .join("")}
      </div>
    </div>`;

    // ── Today's Timeline — meetings (timed) and today-due actions (untimed)
    // merged into one chronological read of the day.
    const timelineEvents = [
      ...todaysMeetings.map((s) => ({ time: s.meeting_time || "", icon: "🎙", title: l === "ar" ? s.title_ar : s.title_en || s.title_ar, meta: s.platform || "", go: "schedule" })),
      ...dueTodayTasks.map((t) => ({ time: "", icon: "🎯", title: l === "ar" ? t.text_ar : t.text_en || t.text_ar, meta: l === "ar" ? t.owner_name_ar || "" : t.owner_name_en || t.owner_name_ar || "", go: "tasks" })),
    ].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    const todaysTimelineHtml = timelineEvents.length
      ? `<div class="card" style="margin-bottom:16px">
          <div class="ct" style="margin-bottom:10px">🕐 ${lbl("الجدول الزمني لليوم", "Today's Timeline")}</div>
          <div style="display:flex;flex-direction:column;gap:2px">
            ${timelineEvents
              .map(
                (e) => `<div class="stat-clickable" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 4px" onclick="Panels.load('${e.go}')">
              <span style="font-size:11px;font-weight:700;color:var(--gold);min-width:48px">${e.time ? esc(e.time) : lbl("اليوم", "Due today")}</span>
              <span style="font-size:14px;flex-shrink:0">${e.icon}</span>
              <span style="font-size:12.5px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</span>
              ${e.meta ? `<span style="font-size:11px;color:var(--text3);flex-shrink:0">${esc(e.meta)}</span>` : ""}
            </div>`,
              )
              .join("")}
          </div>
        </div>`
      : `<div class="card" style="margin-bottom:16px;text-align:center;padding:20px">
          <div style="font-size:13px;color:var(--text3)">✓ ${lbl("لا أحداث مجدولة اليوم", "Nothing scheduled for today")}</div>
        </div>`;

    // ── Quick Actions — the fastest path into the four most common
    // executive workflows, one click from the command center.
    const quickActionsHtml = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn-gold btn-sm" onclick="Panels.load('record')">🎙 ${lbl("تسجيل اجتماع", "Record Meeting")}</button>
      <button class="btn-ghost btn-sm" onclick="Panels.load('tasks').then(()=>Modals.addTask())">➕ ${lbl("إجراء تنفيذي جديد", "New Executive Action")}</button>
      <button class="btn-ghost btn-sm" onclick="Panels.load('ask')">✦ ${lbl("اسأل أمين", "Ask Ameen")}</button>
      <button class="btn-ghost btn-sm" onclick="Panels.load('documents')">📄 ${lbl("توليد تقرير", "Generate Report")}</button>
    </div>`;

    // ── Meeting Calendar Preview — read-only month glance; click any day (or
    // "Open Calendar") to jump to the full Schedule panel.
    const calBase = new Date();
    const calYear = calBase.getFullYear();
    const calMonthIdx = calBase.getMonth();
    const calStartWeekday = new Date(calYear, calMonthIdx, 1).getDay();
    const calDaysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
    const calMonthLabel = calBase.toLocaleDateString(l === "ar" ? "ar-SA-u-ca-gregory" : "en-US", { month: "long", year: "numeric" });
    const calWeekDayNames = l === "ar" ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const meetingDatesThisMonth = new Set(schedule.map((s) => (s.meeting_date || "").substring(0, 10)));
    let calPreviewCells = "";
    for (let i = 0; i < calStartWeekday; i++) calPreviewCells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= calDaysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hasMeeting = meetingDatesThisMonth.has(dateStr);
      const isToday = dateStr === today;
      calPreviewCells += `<div class="cal-cell ${isToday ? "cal-today" : ""}" style="min-height:36px;cursor:pointer" onclick="Panels.load('schedule')" tabindex="0" role="button" aria-label="${dateStr}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Panels.load('schedule')}">
        <div class="cal-daynum" style="font-size:11px">${d}</div>
        ${hasMeeting ? `<div class="cal-dots"><div class="cal-dot" style="background:var(--gold)"></div></div>` : ""}
      </div>`;
    }
    const calendarPreviewHtml = `<div class="card" style="margin-bottom:16px">
      <div class="ch" style="margin-bottom:10px">
        <div class="ct">📅 ${lbl("معاينة تقويم الاجتماعات", "Meeting Calendar Preview")}</div>
        <button class="btn-ghost btn-sm" onclick="Panels.load('schedule')">${lbl("فتح التقويم ←", "Open Calendar →")}</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">${esc(calMonthLabel)}</div>
      <div class="cal-grid cal-grid-head">${calWeekDayNames.map((w) => `<div class="cal-headcell" style="font-size:9.5px">${w}</div>`).join("")}</div>
      <div class="cal-grid">${calPreviewCells}</div>
    </div>`;

    // ── Recent Reports — this browser's own Board Pack download history (no
    // backend "reports" log exists to query against).
    const recentReportsList = RecentReports.list();
    const recentReportsHtml = `<div class="card" style="margin-bottom:16px">
      <div class="ct" style="margin-bottom:10px">📦 ${lbl("التقارير الأخيرة", "Recent Reports")}</div>
      ${
        recentReportsList.length
          ? recentReportsList
              .slice(0, 5)
              .map(
                (r) => `<div class="stat-clickable" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:.5px solid var(--border2)" onclick="Panels.load('history').then(()=>MeetingHistory.select(${r.meetingId}))">
            <span style="font-size:12px;color:var(--text)">${esc(r.title)}</span>
            <span style="font-size:11px;color:var(--text3)">${esc((r.ts || "").substring(0, 10))}</span>
          </div>`,
              )
              .join("")
          : `<div style="font-size:12px;color:var(--text3)">${lbl("لم يتم توليد تقارير بعد — نزّل حزمة مجلس من مساحة عمل أي اجتماع", "No reports generated yet — download a Board Pack from any meeting's workspace")}</div>`
      }
    </div>`;

    // ── Notifications — personal call-outs (mine, overdue or flagged for
    // review), distinct from the org-wide "Urgent Overdue Tasks" list below.
    const myNotifications = App.user
      ? tasks
          .filter((t) => t.owner_id === App.user.id && (t.status === "overdue" || t.needs_review))
          .slice(0, 5)
      : [];
    const notificationsHtml = `<div class="card" style="margin-bottom:16px">
      <div class="ct" style="margin-bottom:10px">🔔 ${lbl("الإشعارات", "Notifications")}</div>
      ${
        myNotifications.length
          ? myNotifications
              .map(
                (t) => `<div class="stat-clickable" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:.5px solid var(--border2)" onclick="Panels.load('tasks')">
            <span style="font-size:13px">${t.status === "overdue" ? "⚠️" : "⚑"}</span>
            <span style="font-size:12px;color:var(--text);flex:1">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</span>
            <span style="font-size:11px;color:${t.status === "overdue" ? "var(--red)" : "var(--amber)"}">${t.status === "overdue" ? lbl("متأخرة", "Overdue") : lbl("مراجعة", "Review")}</span>
          </div>`,
              )
              .join("")
          : `<div style="font-size:12px;color:var(--green)">✓ ${lbl("لا إشعارات جديدة", "No new notifications")}</div>`
      }
    </div>`;

    const overdueList = tasks.filter((t) => t.status === "overdue");
    const overdueHtml = overdueList.length
      ? `
      <div class="card stat-clickable" style="margin-top:14px;cursor:pointer" onclick="Panels.load('tasks')" title="${lbl("فتح المهام", "Open tasks")}">
        <div class="ct" style="color:var(--red);margin-bottom:10px">⚠ ${lbl("المهام المتأخرة الفورية", "Urgent Overdue Tasks")}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">
          ${overdueList
            .slice(0, 6)
            .map(
              (t) => `
            <div style="background:var(--navy3);border-radius:8px;padding:10px;border:1px solid rgba(224,90,90,.2)">
              <div style="font-size:12px;color:var(--text);margin-bottom:4px">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                ${t.owner_name_ar ? `<span class="tag tgold" style="font-size:11px">${esc(l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar)}</span>` : ""}
                ${t.due_date ? `<span class="tag tr" style="font-size:11px">${esc(t.due_date)}</span>` : ""}
              </div>
            </div>`,
            )
            .join("")}
        </div>
      </div>`
      : "";

    // ── Board Member: governance/resolutions-focused section ──────────────────
    const boardGovHtml =
      role === "Board Member"
        ? (() => {
            const recentDec = decisions.slice(0, 8);
            const openDec = decisions.filter(
              (d) => d.status !== "implemented",
            ).length;
            return `<div class="card" style="margin-top:14px">
        <div class="ct" style="margin-bottom:12px;color:var(--blue)">⚖️ ${lbl("قرارات مجلس الإدارة", "Board Resolutions")}</div>
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <span style="background:rgba(91,155,214,.1);border:1px solid rgba(91,155,214,.3);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--blue)">
            ${decisions.length} ${lbl("قرار إجمالي", "total decisions")}
          </span>
          <span style="background:rgba(255,193,7,.1);border:1px solid rgba(255,193,7,.3);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--amber)">
            ${openDec} ${lbl("قيد التنفيذ", "pending implementation")}
          </span>
        </div>
        ${
          recentDec.length
            ? recentDec
                .map(
                  (d) => `
          <div style="padding:9px 0;border-bottom:.5px solid var(--border2);display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:11px;padding:2px 7px;border-radius:6px;margin-top:2px;white-space:nowrap;background:${d.status === "implemented" ? "rgba(46,204,113,.15)" : "rgba(255,193,7,.15)"};color:${d.status === "implemented" ? "var(--green)" : "var(--amber)"}">
              ${esc(lbl(d.status === "implemented" ? "منفَّذ" : "قيد التنفيذ", d.status === "implemented" ? "Implemented" : "Pending"))}
            </span>
            <div style="font-size:12px;color:var(--text)">${esc(l === "ar" ? d.text_ar : d.text_en || d.text_ar)}</div>
          </div>`,
                )
                .join("")
            : `<div style="font-size:12px;color:var(--text3)">${lbl("لا قرارات مسجلة", "No decisions recorded yet")}</div>`
        }
        ${decisions.length > 8 ? `<div style="text-align:center;margin-top:10px"><button class="btn-ghost btn-sm" onclick="Panels.load('governance')" style="font-size:11px">${lbl("عرض كل القرارات", "View all decisions")}</button></div>` : ""}
      </div>`;
          })()
        : "";

    // ── Committee Member: scoped task + schedule section ──────────────────────
    const committeeHtml =
      role === "Committee Member"
        ? (() => {
            const myTasks = tasks.filter(
              (t) => t.owner_id === (App.user && App.user.id),
            );
            const myOpen = myTasks.filter((t) => t.status !== "done");
            const myOverdue = myTasks.filter((t) => t.status === "overdue");
            const upcomingCom = upcoming.slice(0, 4);
            return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card stat-clickable" style="cursor:pointer" onclick="Panels.load('tasks')">
          <div class="ct" style="margin-bottom:12px;color:var(--green)">✅ ${lbl("مهامي", "My Tasks")}</div>
          ${
            myOpen.length
              ? myOpen
                  .slice(0, 5)
                  .map(
                    (t) => `
            <div style="padding:7px 0;border-bottom:.5px solid var(--border2)">
              <div style="font-size:12px;color:var(--text)">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</div>
              <div style="display:flex;gap:5px;margin-top:3px;flex-wrap:wrap">
                ${t.due_date ? `<span class="tag ${t.status === "overdue" ? "tr" : "ta"}" style="font-size:11px">${esc(t.due_date)}</span>` : ""}
                <span class="tag" style="font-size:11px;background:var(--navy4)">${esc(t.status)}</span>
              </div>
            </div>`,
                  )
                  .join("")
              : `<div style="font-size:12px;color:var(--green)">✓ ${lbl("كل المهام مكتملة", "All tasks complete")}</div>`
          }
          ${myOverdue.length ? `<div style="margin-top:8px;font-size:11px;color:var(--red)">⚠ ${myOverdue.length} ${lbl("مهمة متأخرة", "overdue")}</div>` : ""}
        </div>
        <div class="card stat-clickable" style="cursor:pointer" onclick="Panels.load('schedule')">
          <div class="ct" style="margin-bottom:12px;color:var(--gold)">📅 ${lbl("الاجتماعات القادمة", "Upcoming Meetings")}</div>
          ${
            upcomingCom.length
              ? upcomingCom
                  .map(
                    (s) => `
            <div style="padding:7px 0;border-bottom:.5px solid var(--border2)">
              <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(l === "ar" ? s.title_ar : s.title_en || s.title_ar)}</div>
              <div style="font-size:11px;color:var(--text3)">📅 ${esc(s.meeting_date || "")} ${s.meeting_time ? "🕐 " + esc(s.meeting_time) : ""}</div>
            </div>`,
                  )
                  .join("")
              : `<div style="font-size:12px;color:var(--text3)">${lbl("لا اجتماعات قادمة", "No upcoming meetings")}</div>`
          }
        </div>
      </div>`;
          })()
        : "";

    const dash = Dash.get();
    const sec = (k, html) => (dash[k] === false ? "" : html);
    const showCharts = hasCharts && ROLE_ACCESS[role] && ROLE_ACCESS[role].has("analytics");
    body.innerHTML = `
      ${greetingHtml}
      ${roleHeader}
      ${briefingHtml}
      ${todaysTimelineHtml}
      ${quickActionsHtml}
      ${Dash.bar(l)}
      ${sec("stats", `<div style="margin-bottom:14px"><div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px;padding-inline-start:2px">— ${lbl('مؤشرات الأداء الرئيسية','Key Performance Indicators')} —</div>${statsHtml}</div>`)}
      <div class="grid-2" style="margin-bottom:16px">
        ${calendarPreviewHtml}
        ${todaysMeetingsHtml}
      </div>
      <div style="margin-bottom:16px">${canGov && govSummary ? `<div class="grid-2">${aiActivityHtml}${govWidgetHtml}</div>` : aiActivityHtml}</div>
      <div class="grid-2" style="margin-bottom:16px">
        ${recentReportsHtml}
        ${notificationsHtml}
      </div>
      ${showCharts ? sec("charts", `<div>${_secHdr('📈','الاتجاهات والرسوم البيانية','Trends & Charts','',lbl('بيانات حية من الاجتماعات المسجلة','Live data from recorded sessions'))}${chartsGridHtml}</div>`) : ""}
      ${sec("upcoming", `<div style="margin-bottom:14px">${_secHdr('📅','الاجتماعات القادمة','Upcoming Meetings','',lbl('انقر للذهاب إلى الجدول','Click to open full schedule'))}${upcomingHtml}</div>`)}
      ${overdueHtml ? `<div>${_secHdr('⚠','المهام تحتاج انتباهاً','Needs Immediate Attention','','')}</div>` : ''}
      ${sec("overdue", overdueHtml)}
      ${boardGovHtml}
      ${committeeHtml}`;

    if (showCharts) {
      const base = _chartBase(l);
      const tw = analytics.tasksByWeek || [];
      Charts.render("cht-ov-tasks", {
        type: "bar",
        data: {
          labels: tw.map((r) => _weekLabel(r.week_start, l)),
          datasets: [
            {
              label: lbl("مكتملة", "Done"),
              data: tw.map((r) => r.done),
              backgroundColor: "#2ECC8A66",
              borderColor: "#2ECC8A",
              borderWidth: 1.5,
            },
            {
              label: lbl("مفتوحة", "Open"),
              data: tw.map((r) => r.open),
              backgroundColor: "#EFA82766",
              borderColor: "#EFA827",
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { ...base.plugins.legend, display: true },
          },
          scales: { ...base.scales, y: { ...base.scales.y, stacked: false } },
        },
      });

      const mm = analytics.meetingsByMonth || [];
      Charts.render("cht-ov-meetings", {
        type: "bar",
        data: {
          labels: mm.map((r) => _monthLabel(r.month, l)),
          datasets: [
            {
              label: lbl("اجتماعات", "Meetings"),
              data: mm.map((r) => r.count),
              backgroundColor: "#C9A84C66",
              borderColor: "#C9A84C",
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          ...base,
          plugins: { ...base.plugins, legend: { display: false } },
          scales: {
            ...base.scales,
            y: {
              ...base.scales.y,
              ticks: { ...base.scales.y.ticks, stepSize: 1 },
            },
          },
        },
      });

      const mc = analytics.memberCompletion || [];
      Charts.render("cht-ov-team", {
        type: "bar",
        data: {
          labels: mc.map((r) =>
            l === "ar" ? r.owner_name_ar : r.owner_name_en || r.owner_name_ar,
          ),
          datasets: [
            {
              label: lbl("الإنجاز %", "Completion %"),
              data: mc.map((r) => r.pct),
              backgroundColor: mc.map((r) =>
                r.pct === 100
                  ? "#2ECC8A66"
                  : r.pct > 50
                    ? "#C9A84C66"
                    : "#E05A5A66",
              ),
              borderColor: mc.map((r) =>
                r.pct === 100 ? "#2ECC8A" : r.pct > 50 ? "#C9A84C" : "#E05A5A",
              ),
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          ...base,
          indexAxis: "y",
          plugins: { ...base.plugins, legend: { display: false } },
          scales: {
            x: { ...base.scales.x, max: 100 },
            y: {
              ticks: { color: "#808090", font: { size: 9 } },
              grid: { color: "rgba(255,255,255,0.06)" },
            },
          },
        },
      });

      const ds = analytics.decisionStatus || [];
      const dsColorMap = {
        active: "#EFA827",
        implemented: "#2ECC8A",
        pending: "#5B9BD6",
      };
      const dsLabelMap = {
        active: lbl("نشط", "Active"),
        implemented: lbl("منفَّذ", "Implemented"),
        pending: lbl("معلق", "Pending"),
      };
      Charts.render("cht-ov-decisions", {
        type: "doughnut",
        data: {
          labels: ds.map((r) => dsLabelMap[r.status] || esc(r.status)),
          datasets: [
            {
              data: ds.map((r) => r.count),
              backgroundColor: ds.map(
                (r) => (dsColorMap[r.status] || "#888") + "bb",
              ),
              borderColor: ds.map((r) => dsColorMap[r.status] || "#888"),
              borderWidth: 2,
            },
          ],
        },
        options: _chartPie(),
      });
    }
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
  }
}

// ══ Dashboard Customizer (persists which widgets are visible) ═══════════════════
const Dash = {
  key: "ameen_dash_cfg",
  defaults: { stats: true, team: true, upcoming: true, overdue: true },
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
  configure(provider) {
    const l = App.lang;
    const names = { zoom: 'Zoom', teams: 'Microsoft Teams', google_meet: 'Google Meet' };
    showToast(
      l === 'ar'
        ? `تكامل ${names[provider]||provider} جاهز — يتطلب بيانات اعتماد API. أضف البيانات في متغيرات البيئة لتفعيله (يتطلب إعداداً من المطوّر).`
        : `${names[provider]||provider} integration is ready — API credentials required. Add credentials to environment variables to enable it (requires developer setup).`,
      'info'
    );
  }
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
        <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:rgba(46,204,138,.1);color:var(--green);border:.5px solid rgba(46,204,138,.25);white-space:nowrap">📈 ${lbl("بيانات حية","Live Data")}</span>
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
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
  }
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
