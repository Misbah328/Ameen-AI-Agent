"use strict";
// ══ Utilities ════════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (t) =>
  String(t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// ══ RBAC ═══════════════════════════════════════════════════════════════════════
const ROLE_ACCESS = {
  Admin: new Set([
    "record",
    "transcripts",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "team",
    "overview",
    "analytics",
    "governance",
    "admin",
  ]),
  CEO: new Set([
    "record",
    "transcripts",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "team",
    "overview",
    "analytics",
    "governance",
  ]),
  "Board Member": new Set([
    "transcripts",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "overview",
    "analytics",
    "governance",
  ]),
  "Committee Member": new Set([
    "transcripts",
    "tasks",
    "ask",
    "schedule",
    "overview",
    "governance",
  ]),
  Executive: new Set([
    "record",
    "transcripts",
    "lastmeeting",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "overview",
    "analytics",
  ]),
  Manager: new Set([
    "record",
    "transcripts",
    "tasks",
    "ask",
    "documents",
    "schedule",
    "team",
    "overview",
    "analytics",
  ]),
  Employee: new Set(["record", "transcripts", "tasks", "ask"]),
  Observer: new Set(["transcripts", "lastmeeting", "overview"]),
};

const ROLE_COLORS = {
  Admin: "#e05a5a",
  CEO: "#C9A84C",
  "Board Member": "#5B9BD6",
  "Committee Member": "#2ECC8A",
  Executive: "#9370DB",
  Manager: "#EFA827",
  Employee: "#888",
  Observer: "#888",
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

  const adminNav = $("nav-admin");
  const adminSec = $("nsec-admin");
  if (adminNav) adminNav.style.display = role === "Admin" ? "" : "none";
  if (adminSec) adminSec.style.display = role === "Admin" ? "" : "none";

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

  async init() {
    this.applyTheme(this.theme);
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
    const allowed = ROLE_ACCESS[this.systemRole] || ROLE_ACCESS["Employee"];
    const firstPanel = [...allowed][0] || "record";
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
    if (txt) txt.textContent = pro ? "Pro" : "Free";
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
      const cur = document.querySelector(".nb.active")?.dataset.p;
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
    const cur = document.querySelector(".nb.active")?.dataset.p;
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
    `pointer-events:auto;display:flex;align-items:center;gap:7px;padding:11px 15px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 6px 22px rgba(0,0,0,.35);animation:fi .25s ease;` +
    (ok
      ? "background:rgba(46,204,138,.14);border:1px solid rgba(46,204,138,.45);color:#2ecc8a"
      : "background:rgba(224,90,90,.14);border:1px solid rgba(224,90,90,.45);color:#e05a5a");
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
        _injectRecordHelper(App.lang);
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
    const [users, bc] = await Promise.all([
      api("/api/members"),
      api("/api/gov/boards-and-committees").catch(() => ({
        boards: [],
        committees: [],
      })),
    ]);
    App._members = users;
    App._boards = bc.boards || [];
    App._committees = bc.committees || [];
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
              `<option value="${m.id}">${esc(l === "ar" ? m.title_ar : m.title_en || m.title_ar)} (${m.meeting_date?.substring(0, 10) || ""})</option>`,
          )
          .join("");
  } catch (e) {}
  await DocLib.renderLibrary("doc-library-section");
}

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
              ${d.doc_classification ? `<span class="tag" style="background:var(--navy4);font-size:10px">${esc(d.doc_classification)}</span>` : ""}
              <span style="font-size:10px;color:var(--text3)">${esc(d.upload_date || "")}</span>
            </div>
            ${d.ai_summary ? `<details><summary style="font-size:11px;color:var(--text3);cursor:pointer">${l === "ar" ? "🤖 ملخص ذكاء اصطناعي" : "🤖 AI Summary"}</summary><div style="font-size:11px;color:var(--text);margin-top:5px;line-height:1.6;padding:6px 0">${esc(d.ai_summary)}</div></details>` : ""}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <a href="/uploads/${esc(d.file_path)}" download="${esc(d.title)}" class="btn-ghost btn-sm" style="font-size:10px;padding:3px 7px;text-decoration:none" title="${l === "ar" ? "تنزيل" : "Download"}">⬇</a>
            <button class="btn-ghost btn-sm" style="font-size:10px;padding:3px 7px;color:var(--red)" onclick="DocLib.deleteDoc(${d.id},${meetingId})" title="${l === "ar" ? "حذف" : "Delete"}">🗑</button>
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
        container.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:12px 0;text-align:center">${
          l === "ar"
            ? "لا توجد ملفات مرفوعة بعد. استخدم زر «📎 إرفاق» في أي اجتماع لرفع ملفات PDF أو DOCX."
            : 'No uploaded files yet. Use the "📎 Attach" button on any meeting to upload PDF, DOCX, or TXT files.'
        }</div>`;
        return;
      }
      container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
        ${docs
          .map(
            (d) => `<div class="card" style="padding:12px">
          <div style="display:flex;align-items:flex-start;gap:9px">
            <div style="font-size:26px;flex-shrink:0">${this.icon(d.doc_type)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px">${esc(d.title)}</div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:5px">${esc(d.meeting_title_ar || "")} · ${esc(d.upload_date || "")}${d.doc_classification ? " · " + esc(d.doc_classification) : ""}</div>
              ${d.ai_summary ? `<div style="font-size:11px;color:var(--text2);line-height:1.5;margin-bottom:7px">${esc(d.ai_summary.slice(0, 130))}${d.ai_summary.length > 130 ? "…" : ""}</div>` : ""}
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                <a href="/uploads/${esc(d.file_path)}" download="${esc(d.title)}" class="btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;text-decoration:none">⬇ ${l === "ar" ? "تنزيل" : "Download"}</a>
                <button class="btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;color:var(--red)" onclick="DocLib.deleteDoc(${d.id},${d.meeting_id})">🗑</button>
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
};

// Six accent colours cycling through meeting attendees in the speaker bar.
const MEETING_TYPES = {
  "Board Meeting": { ar: "مجلس الإدارة", en: "Board Meeting" },
  "Committee Meeting": { ar: "اجتماع اللجنة", en: "Committee Meeting" },
  "Executive Meeting": { ar: "الاجتماع التنفيذي", en: "Executive Meeting" },
  "General Meeting": { ar: "الاجتماع العام", en: "General Meeting" },
  "Strategy Meeting": { ar: "اجتماع الاستراتيجية", en: "Strategy Meeting" },
  "Follow-up Meeting": { ar: "اجتماع المتابعة", en: "Follow-up Meeting" },
};
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
      if (this._mixedChunks?.length) {
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
    if (!navigator.mediaDevices?.getDisplayMedia) return;
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
        if (e.data?.size > 0) this._mixedChunks.push(e.data);
      };
      this._mixedRec.start(5000);
      const badge = $("dual-audio-badge");
      if (badge) {
        badge.textContent =
          App.lang === "ar" ? "🎙+🔊 كلا الجانبين" : "🎙+🔊 Both sides";
        badge.style.display = "";
      }
      displayStream
        .getAudioTracks()[0]
        .addEventListener("ended", () => this._stopSystemAudio());
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
        `<div style="width:24px;height:24px;border-radius:50%;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${color.fg};flex-shrink:0;margin-top:2px">${esc(initials)}</div>` +
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
            <span style="flex:1">${esc(txt || "")}${own ? ` <span class="tag tgold" style="font-size:9px">${esc(own)}</span>` : ""}</span></div>`;
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

  saveOnly() {
    if (!this.currentMeetingId) return;
    const t = $("sched-toast") || document.createElement("div");
    t.textContent = App.lang === "ar" ? "✓ تم الحفظ" : "✓ Saved";
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
        ${r.key_topics_ar?.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">${(l === "ar" ? r.key_topics_ar : r.key_topics_en || r.key_topics_ar).map((t) => `<span class="tag" style="background:var(--gold-dim);color:var(--gold)">${esc(t)}</span>`).join("")}</div>` : ""}
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
            <div style="width:26px;height:26px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(
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

    // Formal minutes
    const minutes =
      l === "ar" ? r.minutes_ar || "" : r.minutes_en || r.minutes_ar || "";
    const minutesHtml = minutes
      ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">📄 ${lbl("محضر الاجتماع الرسمي", "Official Meeting Minutes")}</div>
        <div style="font-size:12px;color:var(--text);line-height:1.8;white-space:pre-wrap">${esc(minutes)}</div>
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
              <span class="tag" style="background:var(--navy4);font-size:10px">${ownerTasks.length} ${lbl("مهمة", "task")}</span>
            </div>
            ${ownerTasks
              .map(
                (t) => `
              <div style="display:flex;gap:8px;padding:7px 0 7px 12px;border-bottom:.5px solid var(--border2);align-items:flex-start">
                <div style="width:5px;height:5px;border-radius:50%;background:${t.priority === "urgent" ? "var(--red)" : "var(--gold)"};margin-top:5px;flex-shrink:0"></div>
                <div style="flex:1;font-size:12px;color:var(--text);line-height:1.6">${esc(l === "ar" ? t.text_ar : t.text_en || t.text_ar)}</div>
                ${t.priority === "urgent" ? `<span class="tag tr" style="font-size:10px">${lbl("عاجل", "Urgent")}</span>` : ""}
                ${t.due ? `<span class="tag" style="background:var(--navy4);font-size:10px">${esc(t.due)}</span>` : ""}
              </div>`,
              )
              .join("")}
          </div>`,
          )
          .join("")}
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
                  <span class="tag" style="font-size:10px;background:${sevColor}22;color:${sevColor}">${sevLbl}</span>
                </div>
                ${mit ? `<div style="font-size:11px;color:var(--text3);margin-top:3px;padding-inline-start:2px">→ ${esc(mit)}</div>` : ""}
              </div>
            </div>
          </div>`;
          })
          .join("")}
      </div>`
      : "";

    // Task-tracker connection banner
    const tracker = `
      <div style="background:rgba(46,204,138,.07);border:1px solid rgba(46,204,138,.18);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <span style="font-size:18px">✅</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#2ecc8a">${lbl("متصل بمتتبع المهام", "Connected to Task Tracker")}</div>
          <div style="font-size:11px;color:var(--text3)">${tasks.length} ${lbl("مهمة أُضيفت تلقائياً", "tasks added automatically")} · ${decisions.length} ${lbl("قرار", "decisions")} · ${risks.length} ${lbl("مخاطر مُكتشفة", "risks identified")}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="Panels.load('tasks')" style="font-size:11px">${lbl("عرض المهام", "View Tasks")} →</button>
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
      decsHtml +
      risksHtml +
      fuHtml +
      actions
    );
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

// ── Meeting Lifecycle Strip ────────────────────────────────────────────────────
// Renders a compact 10-step lifecycle bar for any meeting or schedule item.
// Works with both schedule items (s) and recorded meetings (m).
function _meetingLifecycle(m, l) {
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
      <span style="font-size:10px">${s.icon}</span>
      <span style="font-size:10px;font-weight:${s.state==='current'?'700':'500'};color:${c.fg}">${l==='ar'?s.ar:s.en}</span>
      <span style="font-size:8px;color:${c.fg}">${dot}</span>
    </div>`;
  }).join('');

  return `<div style="margin:10px 0 6px;padding:10px 12px;background:var(--navy3);border-radius:10px;border:.5px solid var(--border2)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">⚡ ${ar('مسار الاجتماع','Meeting Lifecycle')}</span>
      <span style="font-size:10px;font-weight:700;color:${barColor}">${doneCount}/${steps.length} ${ar('مكتملة','complete')} · ${pct}%</span>
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

// ── Record Meeting helper card (injected into static panel on every visit) ────
function _injectRecordHelper(l) {
  const pbody = document.querySelector('#panel-record .pbody');
  if (!pbody) return;
  let h = document.getElementById('rec-arch-hint');
  if (!h) {
    h = document.createElement('div');
    h.id = 'rec-arch-hint';
    pbody.insertBefore(h, pbody.firstChild);
  }
  h.innerHTML = `
    <div style="margin-bottom:14px;padding:13px 15px;background:linear-gradient(135deg,rgba(212,160,23,.09),rgba(45,140,255,.06));border:1px solid rgba(212,160,23,.28);border-radius:12px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:22px;flex-shrink:0">📼</span>
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:700;color:var(--gold);margin-bottom:5px">${l==='ar'?'أرشيف التسجيل — جاهز للاستخدام':'Recording Archive — Ready'}</div>
          <div style="font-size:11.5px;color:var(--text3);line-height:1.7">${l==='ar'
            ? 'بعد انتهاء الاجتماع، انقر على <strong style="color:var(--gold)">☁ حفظ في المنصة</strong> لرفع التسجيل وإرساله للاعتماد الرسمي من رئيس مجلس الإدارة أو عضو مجلس الإدارة.'
            : 'After the meeting ends, click <strong style="color:var(--gold)">☁ Save to Platform</strong> to upload the recording for official archiving and Chairman / Board Member approval.'}</div>
          <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
            <span style="font-size:10px;padding:3px 9px;border-radius:6px;background:rgba(46,204,138,.12);color:#2ecc8a;border:.5px solid rgba(46,204,138,.28)">✓ ${l==='ar'?'أرشيف التسجيل جاهز':'Recording archive ready'}</span>
            <span style="font-size:10px;padding:3px 9px;border-radius:6px;background:rgba(45,140,255,.10);color:#2D8CFF;border:.5px solid rgba(45,140,255,.22)">🔗 ${l==='ar'?'تكامل Zoom / Teams / Google Meet جاهز':'Zoom / Teams / Google Meet integration ready'}</span>
            <span style="font-size:10px;padding:3px 9px;border-radius:6px;background:rgba(255,160,0,.10);color:#f0a000;border:.5px solid rgba(255,160,0,.22)">⏳ ${l==='ar'?'ربط مباشر — بانتظار بيانات الاعتماد':'Live API connection pending credentials'}</span>
          </div>
        </div>
      </div>
    </div>`;
}

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
async function renderTranscripts() {
  const body = $("transcripts-body");
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const meetings = await api("/api/meetings");
    App.meetingsCache = meetings;
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
              btns.push(`<button class="btn-ghost btn-sm" onclick="minutesShowLog(${m.id})" style="font-size:10px">📋 ${l==='ar'?'سجل الاعتماد':'Approval Log'}</button>`);
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
                  <div style="width:22px;height:22px;border-radius:50%;background:${palette.bg};border:1px solid ${palette.border};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${palette.fg};flex-shrink:0;margin-top:1px">${esc(initials)}</div>
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
              <div class="ctsub">${m.meeting_date?.substring(0, 10) || ""} ${m.duration ? `· ${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, "0")} ${l === "ar" ? "دقيقة" : "min"}` : ""} · ${esc(m.recorder_ar || "")}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${isProcessed ? `<span class="tag tg">✓ ${l === "ar" ? "مُعالج" : "Processed"}</span>` : `<span class="tag ta">${l === "ar" ? "جديد" : "New"}</span>`}
              ${tasks.length ? `<span class="tag tgold">${tasks.length} ${l === "ar" ? "مهمة" : "tasks"}</span>` : ""}
              ${decisions.length ? `<span class="tag" style="background:var(--navy4)">${decisions.length} ${l === "ar" ? "قرار" : "decisions"}</span>` : ""}
              ${risks.length ? `<span class="tag" style="background:rgba(220,50,50,.15);color:#e05252">${risks.length} ${l === "ar" ? "مخاطر" : "risks"}</span>` : ""}
              ${uniqueSpeakers.length > 1 ? `<span class="tag" style="background:var(--navy4)">🗣️ ${uniqueSpeakers.length}</span>` : ""}
              ${mStatusBadge}
            </div>
          </div>
          ${_meetingLifecycle(m, l)}
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
              ${t.owner_ar ? `<span class="tag tgold" style="font-size:10px">${esc(l === "ar" ? t.owner_ar : t.owner_en || t.owner_ar)}</span>` : ""}
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
            const ST_LABEL = {
              none:     l==='ar' ? 'لم يُرفع'            : 'Not Archived',
              pending:  l==='ar' ? 'بانتظار الاعتماد'    : 'Pending Approval',
              approved: l==='ar' ? 'مؤرشف رسمياً ✓'      : 'Officially Archived ✓',
              rejected: l==='ar' ? 'مرفوض'               : 'Rejected'
            };
            const ST_CLR  = { none:'color:var(--text3)', pending:'color:#f0a000', approved:'color:#2ecc8a', rejected:'color:#e05252' };
            const fmtBytes = b => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : b > 1024 ? `${(b/1024).toFixed(0)} KB` : `${b||0} B`;
            const verifier = m.rec_verifier_ar ? (l==='ar' ? m.rec_verifier_ar : m.rec_verifier_en || m.rec_verifier_ar) : '';
            return `<div style="margin:10px 0;background:var(--navy3);border:1px solid ${hasRec ? 'var(--border2)' : 'rgba(212,160,23,.18)'};border-radius:10px;padding:12px 14px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:${hasRec?'10px':'8px'}">
                <div style="display:flex;align-items:center;gap:7px">
                  <span style="font-size:15px">📼</span>
                  <div>
                    <div style="font-size:11.5px;font-weight:700;color:var(--text)">${l==='ar'?'أرشيف التسجيل':'Recording Archive'}</div>
                    <div style="font-size:9.5px;color:var(--text3);margin-top:1px">${l==='ar'?'تسجيل · اعتماد · أرشفة رسمية':'Record · Approve · Officially Archive'}</div>
                  </div>
                </div>
                ${hasRec ? `<span style="font-size:10px;font-weight:700;${ST_CLR[recSt]||''}">${ST_LABEL[recSt]||recSt}</span>` : `<span style="font-size:9.5px;color:#2ecc8a;background:rgba(46,204,138,.10);border:.5px solid rgba(46,204,138,.25);padding:2px 7px;border-radius:5px">✓ ${l==='ar'?'جاهز':'Ready'}</span>`}
              </div>
              ${hasRec ? `
                <div style="font-size:10.5px;color:var(--text3);margin-bottom:8px;line-height:1.8">
                  📁 ${esc(m.recording_file_name||'')} &nbsp;·&nbsp; ${fmtBytes(m.recording_file_size||0)}
                  ${m.recording_uploaded_at ? ` &nbsp;·&nbsp; 📅 ${m.recording_uploaded_at.substring(0,16)}` : ''}
                  ${verifier ? `<br>✓ ${l==='ar'?'معتمد بواسطة':'Verified by'}: <strong>${esc(verifier)}</strong>${m.recording_verified_at?' · '+m.recording_verified_at.substring(0,10):''}` : ''}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  <a href="${esc(m.audio_recording_url)}" target="_blank" class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">▶ ${l==='ar'?'تشغيل':'Play'}</a>
                  <a href="${esc(m.audio_recording_url)}" download class="btn-ghost btn-sm" style="font-size:11px;text-decoration:none">⬇ ${l==='ar'?'تنزيل':'Download'}</a>
                  ${(recSt==='none'||recSt==='rejected') ? `<button class="btn-ghost btn-sm" onclick="RecStore.approve(${m.id},'submit')" style="font-size:11px;color:var(--gold);border-color:var(--gold)">📋 ${l==='ar'?'رفع للاعتماد':'Submit for Approval'}</button>` : ''}
                  ${recSt==='pending' ? `<button class="btn-ghost btn-sm" onclick="RecStore.approve(${m.id},'approve')" style="font-size:11px;color:#2ecc8a;border-color:#2ecc8a">✅ ${l==='ar'?'اعتماد وأرشفة':'Approve & Archive'}</button>` : ''}
                  ${recSt==='pending' ? `<button class="btn-ghost btn-sm" onclick="RecStore.approve(${m.id},'reject')" style="font-size:11px;color:#e05252;border-color:#e05252">✕ ${l==='ar'?'رفض':'Reject'}</button>` : ''}
                  ${recSt==='approved' ? `<span class="tag tg" style="font-size:10px">🏛 ${l==='ar'?'أرشيف رسمي':'Official Archive'}</span>` : ''}
                  <button class="btn-ghost btn-sm" onclick="RecStore.remove(${m.id})" style="font-size:10px;color:#e05252;margin-${l==='ar'?'right':'left'}:auto">🗑</button>
                </div>
              ` : `<div style="padding:6px 2px">
                  <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${l==='ar'?'لا يوجد تسجيل محفوظ في المنصة بعد.':'No recording stored on platform yet.'}</div>
                  <div style="font-size:10.5px;color:var(--text3);opacity:.8;line-height:1.6">${l==='ar'?'سجّل الاجتماع ← انقر على <strong style="color:var(--gold)">☁ حفظ في المنصة</strong> ← أرسله للاعتماد من رئيس مجلس الإدارة':'Record meeting → click <strong style="color:var(--gold)">☁ Save to Platform</strong> → submit for Chairman approval'}</div>
                </div>`}
            </div>`;
          })()}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap">
            ${m.shared ? `<span class="tag tg" style="font-size:10px">📤 ${l === "ar" ? "تمت المشاركة" : "Shared"}</span>` : ""}
            <button id="doc-upload-btn-${m.id}" class="btn-ghost btn-sm" onclick="DocLib.upload(${m.id})">📎 ${l === "ar" ? "إرفاق" : "Attach"}</button>
            <button class="btn-ghost btn-sm" onclick="TranscriptModal.open(${m.id})" title="${l === "ar" ? "إضافة أو تعديل النص" : "Add or edit transcript"}">✏️ ${l === "ar" ? "إضافة نص" : "Add Notes"}</button>
            ${isProcessed ? `<button id="bp-btn-${m.id}" class="btn-ghost btn-sm" onclick="BoardPack.download(${m.id})">📦 ${l === "ar" ? "حزمة المجلس" : "Board Pack"}</button>` : ""}
            ${isProcessed ? `<button class="btn-gold btn-sm" onclick="Share.open(${m.id})">📤 ${l === "ar" ? "مشاركة النتائج" : "Share Outcomes"}${App.isPro() ? "" : " ⭐"}</button>` : ""}
            ${mApprovalBtns}
            <button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick='deleteMeeting(${m.id}, ${JSON.stringify(title)})'>🗑 ${l === "ar" ? "حذف" : "Delete"}</button>
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

// ── Minutes Approval Workflow helpers ──────────────────────────────────────
async function minutesApprovalAction(meetingId, action) {
  const l = App.lang;
  const actionLabels = {
    'circulate': l === 'ar' ? 'تعميم للاعتماد' : 'Circulate for Approval',
    'approve': l === 'ar' ? 'اعتماد' : 'Approve',
    'request-revision': l === 'ar' ? 'طلب مراجعة' : 'Request Revision',
    'final-approve': l === 'ar' ? 'اعتماد نهائي' : 'Final Approve',
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
$("modal-transcript")?.addEventListener("click", (e) => {
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
      body.innerHTML = `<div class="es" style="color:var(--text3)">${lbl("لا توجد اجتماعات بعد", "No meetings yet")}</div>`;
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
          ${t.owner_ar ? `<span class="tag tgold" style="font-size:10px">${esc(l === "ar" ? t.owner_ar : t.owner_en || t.owner_ar)}</span>` : ""}
          ${t.due_date ? `<span class="tag" style="background:var(--navy4);font-size:10px">${esc(t.due_date)}</span>` : ""}
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
              ${meetingTypeLbl ? `<span class="tag tgold" style="font-size:10px;padding:2px 7px">${esc(meetingTypeLbl)}</span>` : ""}
              ${m.board_name_ar ? `<span class="tag" style="background:rgba(91,155,214,.12);color:#5B9BD6;font-size:10px">🏛 ${esc(l === "ar" ? m.board_name_ar : m.board_name_en || m.board_name_ar)}</span>` : ""}
              ${m.committee_name_ar ? `<span class="tag" style="background:rgba(46,204,138,.10);color:var(--green);font-size:10px">⚙️ ${esc(l === "ar" ? m.committee_name_ar : m.committee_name_en || m.committee_name_ar)}</span>` : ""}
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
                ${d.description ? `<div style="font-size:10px;color:var(--text3)">${esc(d.description.substring(0, 65))}${d.description.length > 65 ? "…" : ""}</div>` : ""}
              </div>
              <span class="tag" style="font-size:10px;background:${_st.bg};color:${_st.c};flex-shrink:0">${_st[l === "ar" ? "ar" : "en"]}</span>
              ${d.uploaded_by ? `<span style="font-size:10px;color:var(--text3);flex-shrink:0">👤 ${esc(d.uploaded_by)}</span>` : ""}
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
async function renderTasks() {
  const body = $("tasks-body");
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const [tasks, decisions] = await Promise.all([
      api("/api/tasks"),
      api("/api/decisions"),
    ]);
    App.tasksCache = tasks;
    const l = App.lang;

    const today = new Date().toISOString().substring(0, 10);
    const overdue    = tasks.filter(t => t.status === "overdue");
    const inprog     = tasks.filter(t => t.status === "inprogress" || t.status === "new");
    const done       = tasks.filter(t => t.status === "done");
    const escalated  = tasks.filter(t => t.escalated_at);
    const decPending = decisions.filter(d => d.status !== "implemented");
    const decImpl    = decisions.filter(d => d.status === "implemented");

    // ── KPI cards ─────────────────────────────────────────────────────────────
    const _kpi = (icon, val, labelAr, labelEn, valColor) => `
      <div style="padding:14px 16px;background:var(--navy3);border-radius:12px;border:.5px solid var(--border2);text-align:center">
        <div style="font-size:15px;margin-bottom:5px">${icon}</div>
        <div style="font-size:26px;font-weight:800;color:${valColor};margin-bottom:4px;line-height:1">${val}</div>
        <div style="font-size:10.5px;color:var(--text3);line-height:1.35">${l==="ar"?labelAr:labelEn}</div>
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
      const isUrgent  = t.priority === "urgent";
      const isHigh    = t.priority === "high";

      const daysLeft = t.due_date ? Math.round((new Date(t.due_date) - new Date(today)) / 86400000) : null;
      const daysTag  = daysLeft !== null && !isDone ? (() => {
        if (daysLeft < 0)   return `<span class="days-badge days-late">⚠ ${Math.abs(daysLeft)}${l==="ar"?"ي تأخر":"d overdue"}</span>`;
        if (daysLeft === 0) return `<span class="days-badge days-warn">⏰ ${l==="ar"?"اليوم":"Today"}</span>`;
        if (daysLeft <= 3)  return `<span class="days-badge days-warn">⏳ ${daysLeft}${l==="ar"?"ي":"d"} ${l==="ar"?"متبقية":"left"}</span>`;
        return `<span class="days-badge days-ok">📅 ${daysLeft}${l==="ar"?"ي":"d"}</span>`;
      })() : "";

      const statusMap = {
        overdue:    ["tr",  "⚠ "+(l==="ar"?"متأخرة":"Overdue")],
        inprogress: ["ta",  "▶ "+(l==="ar"?"جارية":"In Progress")],
        new:        ["tb",  "◎ "+(l==="ar"?"جديدة":"New")],
        done:       ["tg",  "✓ "+(l==="ar"?"مكتملة":"Done")],
        cancelled:  ["tgr", "✕ "+(l==="ar"?"ملغاة":"Cancelled")],
      };
      const [stClass, stLabel] = statusMap[t.status] || ["tgr", t.status];

      const priStyles = {
        urgent: {c:"var(--red)",   bg:"rgba(220,60,60,.12)",  bd:"rgba(220,60,60,.3)",  lbl:l==="ar"?"🔥 عاجل":"🔥 Urgent"},
        high:   {c:"var(--amber)", bg:"rgba(212,160,23,.12)", bd:"rgba(212,160,23,.3)", lbl:l==="ar"?"⚡ عالٍ":"⚡ High"},
        low:    {c:"var(--text3)", bg:"var(--navy4)",         bd:"var(--border2)",      lbl:l==="ar"?"↓ منخفض":"↓ Low"},
      };
      const pri = priStyles[t.priority];

      const accentColor = isOverdue ? "var(--red)" : isUrgent ? "var(--red)" : isHigh ? "var(--amber)" : "var(--border2)";

      return `<div class="trow" id="tr-${t.id}" style="border-inline-start:3px solid ${accentColor};padding-inline-start:10px;margin-bottom:10px;border-radius:0 8px 8px 0;${isOverdue?"background:rgba(220,60,60,.04)":""}">
        <div style="display:flex;gap:11px;align-items:flex-start">
          <input type="checkbox" class="tck" ${isDone?"checked":""} onchange="Tasks.updateStatus(${t.id}, this.checked?'done':'inprogress')" title="${l==="ar"?"تحديث الحالة":"Toggle status"}" style="margin-top:5px;flex-shrink:0"/>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;color:${isDone?"var(--text3)":"var(--text)"};font-weight:${isDone?"400":"600"};${isDone?"text-decoration:line-through;opacity:.55":""};line-height:1.45;margin-bottom:8px">${esc(text)}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:7px">
              ${owner ? `<span class="tag tgold" style="font-size:11px">👤 ${esc(owner)}</span>` : ""}
              <span class="tag ${stClass}" style="font-size:11px">${stLabel}</span>
              ${pri ? `<span class="tag" style="font-size:10.5px;background:${pri.bg};color:${pri.c};border:.5px solid ${pri.bd}">${pri.lbl}</span>` : ""}
              ${daysTag}
              ${t.needs_review ? `<span class="tag" style="background:rgba(124,94,16,.18);color:#ffd969;border:.5px solid rgba(255,217,105,.25);font-size:10.5px">⚑ ${l==="ar"?"مراجعة":"Review"}</span>` : ""}
              ${t.escalated_at ? `<span class="tag" style="background:rgba(155,114,219,.15);color:#9B72DB;border:.5px solid rgba(155,114,219,.3);font-size:10.5px">↑ ${l==="ar"?"مُصعَّدة":"Escalated"}</span>` : ""}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
              ${t.due_date ? `<span style="font-size:11px;color:${isOverdue?"var(--red)":"var(--text3)"}">📅 ${l==="ar"?"الاستحقاق:":"Due:"} <strong style="color:${isOverdue?"var(--red)":"var(--text2)"}">${esc(t.due_date)}</strong></span>` : ""}
              ${mtg ? `<span style="font-size:11px;color:var(--text3)">📝 ${esc(mtg.length>42?mtg.substring(0,42)+"…":mtg)}</span>` : ""}
            </div>
            <div style="padding:6px 10px;background:var(--navy3);border-radius:8px;border:.5px solid var(--border2);font-size:11px;color:var(--text3);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <span style="line-height:1.4">${l==="ar"?"لا توجد تحديثات تقدم بعد — أضف تحديثاً لإبقاء الإدارة على اطلاع.":"No progress updates yet. Add an update to keep management informed."}</span>
              <button onclick="Tasks.edit(${t.id})" style="font-size:10px;background:rgba(212,160,23,.12);color:var(--gold);border:.5px solid rgba(212,160,23,.3);padding:3px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;flex-shrink:0">+ ${l==="ar"?"إضافة تحديث":"Add Update"}</button>
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">
            <button onclick="Tasks.edit(${t.id})" style="background:var(--navy3);border:1px solid var(--border2);color:var(--text2);cursor:pointer;font-size:12px;padding:5px 10px;border-radius:8px;transition:.15s;line-height:1;font-weight:500" onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'" title="${l==="ar"?"تعديل":"Edit"}">✏️</button>
            <button onclick="Tasks.delete(${t.id})" style="background:var(--navy3);border:1px solid var(--border2);color:var(--text3);cursor:pointer;font-size:12px;padding:5px 10px;border-radius:8px;transition:.15s;line-height:1" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text3)'" title="${l==="ar"?"حذف":"Delete"}">✕</button>
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
              ${decDate   ? `<span class="tag" style="background:var(--navy4);font-size:10.5px">📅 ${esc(decDate)}</span>` : ""}
              ${decidedBy ? `<span class="tag tgold" style="font-size:10.5px">👤 ${esc(decidedBy)}</span>` : ""}
              ${mtg       ? `<span class="tag" style="background:var(--navy3);color:var(--text3);font-size:10px;border:.5px solid var(--border2)">📝 ${esc(mtg.length>38?mtg.substring(0,38)+"…":mtg)}</span>` : ""}
            </div>
            ${notes
              ? `<div style="padding:6px 10px;background:var(--navy3);border-radius:8px;border-inline-start:2px solid var(--gold);font-size:11px;color:var(--text3);line-height:1.5">
                  <span style="font-size:10px;font-weight:700;color:var(--gold);display:block;margin-bottom:2px">${l==="ar"?"الإجراء التالي / ملاحظات:":"Next Action / Notes:"}</span>${esc(notes)}</div>`
              : `<div style="font-size:10.5px;color:var(--text3);font-style:italic;padding:3px 0;line-height:1.45">${l==="ar"?"لا توجد ملاحظات أو إجراءات محددة لهذا القرار بعد.":"No notes or next actions defined for this decision yet."}</div>`}
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

    const _tasksBanner = `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:13px 16px;background:linear-gradient(135deg,var(--navy3),var(--navy2));border:1px solid var(--border2);border-radius:12px;margin-bottom:14px">
      <div>
        <div style="font-size:13.5px;font-weight:700;color:var(--text);margin-bottom:3px">📋 ${l==="ar"?"حوكمة الإجراءات التنفيذية":"Executive Action Governance"}</div>
        <div style="font-size:11.5px;color:var(--text3);line-height:1.65">${l==="ar"?"تتبع المهام، الملاك، المواعيد، التحديثات، التصعيدات، والقرارات من كل اجتماع — حتى الإنجاز الكامل.":"Track actions, owners, deadlines, progress updates, escalations, and decisions from every meeting — to full completion."}</div>
      </div>
      <button class="btn-gold btn-sm" onclick="Modals.addTask()" style="white-space:nowrap;font-size:12px">+ ${l==="ar"?"مهمة يدوية":"Add Task"}</button>
    </div>`;

    body.innerHTML = _tasksBanner +
      kpiHtml +
      _secHdrT("⚡", "الجدول الزمني لحوكمة الإجراءات", "Action Governance Timeline") +
      `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start">
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
    $("nt-priority").value = t.priority || "normal";
    const ownerSel = $("nt-owner");
    if (ownerSel && t.owner_id) ownerSel.value = String(t.owner_id);
    $("modal-task").classList.add("open");
    TaskTimeline.load(id, t);
  },
  async delete(id) {
    if (!confirm(App.lang === "ar" ? "حذف هذه المهمة؟" : "Delete this task?"))
      return;
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    document.getElementById("tr-" + id)?.remove();
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
    await api(`/api/decisions/${id}`, { method: "DELETE" });
    renderTasks();
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
    if (p) p.value = "normal";
    const o = $("nt-owner");
    if (o) o.value = "";
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
    const data = {
      text_ar: $("nt-ar").value.trim(),
      text_en: $("nt-en").value.trim() || $("nt-ar").value.trim(),
      owner_id: $("nt-owner").value || null,
      due_date: $("nt-due").value,
      priority: $("nt-priority").value,
    };
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
        ${task.created_at ? `<div style="font-size:10px;color:var(--text3)">${fmt(task.created_at)}</div>` : ''}
        ${task.owner_name_en||task.owner_name_ar ? `<div style="font-size:10px;color:var(--text3)">${l==='ar'?'المسؤول: ':'Owner: '}${esc(l==='ar'?task.owner_name_ar:task.owner_name_en||task.owner_name_ar)}</div>` : ''}
      </div>
    </div>`);

    // ── Update nodes ──
    updates.forEach(u => {
      items.push(`<div style="display:flex;gap:10px;align-items:flex-start;padding-bottom:14px">
        ${dot(dotColor(u.status_snapshot))}
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:11px;font-weight:700;color:var(--text)">${esc(u.author_name||'')}</span>
            ${u.author_role ? `<span style="font-size:10px;color:var(--text3)">· ${esc(u.author_role)}</span>` : ''}
            ${u.status_snapshot ? `<span class="tag" style="font-size:9px;padding:1px 5px;${statusStyle(u.status_snapshot)}">${statusLabel(u.status_snapshot)}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text);line-height:1.55;margin-bottom:2px">${esc(u.update_text)}</div>
          <div style="font-size:10px;color:var(--text3)">${fmt(u.created_at)}</div>
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
        ${updates.length ? `<span class="tag" style="background:var(--navy4);font-size:10px;margin-${l==='ar'?'right':'left'}:4px">${updates.length}</span>` : ''}
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
};

// ══ Chat ══════════════════════════════════════════════════════════════════════
const Chat = {
  async send() {
    const inp = $("ci");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    inp.style.height = "";
    this.append(text, true);
    this.showTyping();
    App.chatHistory.push({ role: "user", content: text });
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
      if (r.demo) this.showDemoNote();
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
    $("ci").value = q;
    this.send();
  },
  key(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  },
  clear() {
    App.chatHistory = [];
    const m = $("chat-msgs");
    if (m) {
      m.innerHTML = "";
      m.appendChild(buildWelcomeMsg());
    }
  },
  append(text, isUser) {
    const msgs = $("chat-msgs");
    const chips = $("chat-chips");
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
    d.innerHTML = `${av}<div><div class="mb">${esc(text)}</div><div class="mts">${now()}</div></div>`;
    if (chips && msgs.contains(chips)) {
      msgs.insertBefore(d, chips);
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
  $("typ")?.remove();
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
    try {
      const r = await api("/api/ai/document", {
        method: "POST",
        body: JSON.stringify(data),
      });
      this.currentContent = r.content;
      $("doc-result").style.direction = data.lang === "en" ? "ltr" : "rtl";
      $("doc-result").style.textAlign = data.lang === "en" ? "left" : "right";
      $("doc-result").textContent = r.content;
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
      typeSel?.options[typeSel.selectedIndex]?.text ||
      (l === "ar" ? "وثيقة" : "Document");
    const lang = $("doc-lang")?.value || l;
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
    const boardId = parseInt($("nm-board")?.value) || 0;
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
    const v = $("nm-plat")?.value || "physical";
    const row = $("nm-join-row");
    if (row) row.style.display = v === "physical" ? "none" : "";
    const inp = $("nm-join-url");
    if (inp) {
      inp.placeholder = v === "zoom" ? "https://zoom.us/j/..." : v === "teams" ? "https://teams.microsoft.com/l/meetup-join/..." : v === "google_meet" ? "https://meet.google.com/..." : "";
    }
  },
  async add() {
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
      board_id: parseInt($("nm-board")?.value) || null,
      committee_id: parseInt($("nm-committee")?.value) || null,
      prev_meeting_id: parseInt($("nm-prev")?.value) || null,
      recurrence: ($("nm-recurrence") && $("nm-recurrence").value) || "none",
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
      await api("/api/schedule", {
        method: "POST",
        body: JSON.stringify(data),
      });
      $("sched-toast").style.display = "flex";
      setTimeout(() => ($("sched-toast").style.display = "none"), 2500);
      await renderSchedule();
      await loadBadges();
      ["nm-title", "nm-att", "nm-agenda-ar", "nm-agenda-en"].forEach(
        (id) => ($(id).value = ""),
      );
      if ($("nm-type")) $("nm-type").value = "";
      if ($("nm-board")) $("nm-board").value = "";
      if ($("nm-committee")) $("nm-committee").value = "";
      if ($("nm-prev")) $("nm-prev").value = "";
      if ($("nm-recurrence")) $("nm-recurrence").value = "none";
      if ($("nm-template")) $("nm-template").value = "";
      if ($("nm-join-url")) $("nm-join-url").value = "";
      if ($("nm-plat")) { $("nm-plat").value = "physical"; Schedule.onProviderChange(); }
      if (rec !== "none")
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
          meeting_type: $("nm-type")?.value || "",
          agenda_ar: $("nm-agenda-ar")?.value || "",
          agenda_en: $("nm-agenda-en")?.value || "",
          default_duration: parseInt($("nm-dur")?.value) || 60,
          default_attendees: $("nm-att")?.value || "",
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

  async edit(id) {
    const l = App.lang;
    try {
      const items = await api("/api/schedule");
      const s = items.find((x) => x.id === id);
      if (!s) return;
      const title = prompt(
        l === "ar" ? "عنوان الاجتماع:" : "Meeting title:",
        s.title_ar || "",
      );
      if (title === null) return;
      const date = prompt(
        l === "ar" ? "التاريخ (YYYY-MM-DD):" : "Date (YYYY-MM-DD):",
        (s.meeting_date || "").substring(0, 10),
      );
      if (date === null) return;
      const time = prompt(
        l === "ar" ? "الوقت (HH:MM):" : "Time (HH:MM):",
        (s.meeting_time || "").substring(0, 5),
      );
      if (time === null) return;
      const attendees = prompt(
        l === "ar"
          ? "المشاركون (أسماء، إيميلات، أرق_�م جوال):"
          : "Attendees (names, emails, phones):",
        s.attendees || "",
      );
      if (attendees === null) return;
      const TYPES_LIST = Object.keys(MEETING_TYPES).join(", ");
      const typePrompt =
        l === "ar"
          ? `نوع الاجتماع (${TYPES_LIST}):`
          : `Meeting type (${TYPES_LIST}):`;
      const meetingType = prompt(typePrompt, s.meeting_type || "");
      if (meetingType === null) return;
      const t = title.trim();
      await api("/api/schedule/" + id, {
        method: "PATCH",
        body: JSON.stringify({
          title_ar: t,
          title_en: t,
          meeting_date: date.trim(),
          meeting_time: time.trim(),
          attendees: attendees.trim(),
          meeting_type: meetingType.trim(),
        }),
      });
      await renderSchedule();
      await loadBadges();
    } catch (e) {
      alert((l === "ar" ? "تعذّر التعديل: " : "Could not edit: ") + e.message);
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
    await api(`/api/schedule/${id}`, { method: "DELETE" });
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
        <div style="flex:1;min-width:0;font-size:10px;color:var(--text3)">
          <span style="color:var(--gold);font-weight:700">${esc(p.label)} ${l==='ar'?'جاهز للربط':'integration ready'}</span>
          &nbsp;·&nbsp;${l==='ar'?'ربط مباشر بانتظار بيانات الاعتماد':'Live API connection pending credentials'}
        </div>
        <span style="font-size:9px;padding:2px 7px;border-radius:5px;background:rgba(46,204,138,.12);color:#2ecc8a;border:.5px solid rgba(46,204,138,.28);white-space:nowrap">✓ ${l==='ar'?'البنية جاهزة':'Architecture ready'}</span>
      </div>` : '';

    // Status grid — always shown for every meeting type
    const statusGrid = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:7px;padding-top:10px;border-top:1px solid var(--border2)">
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"حالة التسجيل":"Recording"}</div>
          <div style="font-size:11px;font-weight:700;color:${isVirt ? recSt.color : '#2ecc8a'}">${isVirt ? recSt.label : (l==="ar"?"مدمج في المنصة":"On-platform")}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"النسخ":"Transcript"}</div>
          <div style="font-size:11px;font-weight:700;color:var(--text3)">${tLabel}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"التسجيل السحابي":"Cloud Recording"}</div>
          <div style="font-size:11px;font-weight:700;color:var(--text3)">${isVirt ? (s.recording_url ? `<a href="${esc(s.recording_url)}" target="_blank" style="color:var(--gold);text-decoration:none">${l==="ar"?"عرض ↗":"View ↗"}</a>` : notConn) : (l==="ar"?"غير مطبق":"N/A")}</div>
        </div>
        <div style="background:var(--navy2);border:1px solid var(--border2);border-radius:7px;padding:8px 10px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:3px">${l==="ar"?"التخزين":"Storage"}</div>
          <div style="font-size:11px;font-weight:700;color:#2ecc8a">${l==="ar"?"أرشيف جاهز ✓":"Archive Ready ✓"}</div>
        </div>
      </div>`;

    return `<div style="margin-top:10px;padding:11px 13px;background:var(--navy3);border:1px solid var(--border2);border-radius:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:9px">
          <span style="font-size:18px;line-height:1">${p.icon}</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:${p.color}">${p.label}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:1px">${isVirt ? (l==="ar"?"اجتماع افتراضي":"Virtual meeting") : (l==="ar"?"حضور فعلي في المقر":"In-person at venue")}</div>
          </div>
        </div>
        ${s.meeting_join_url
          ? `<a href="${esc(s.meeting_join_url)}" target="_blank" rel="noopener"
               style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;text-decoration:none;background:${p.badge};color:${p.color};border:1px solid ${p.color}33">
               ▶ ${l==="ar"?"انضم للاجتماع":"Join Meeting"}
             </a>`
          : isVirt ? `<span style="font-size:10px;color:var(--text3);font-style:italic">${noLink}</span>` : ""}
      </div>
      ${demoBanner}
      ${statusGrid}
    </div>`;
  },
};

async function renderSchedule() {
  const el = $("sched-items");
  el.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const items = await api("/api/schedule");
    App.scheduleCache = items;
    const l = App.lang;
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
              ${s.meeting_type ? `<span class="tag tgold" style="font-size:10px;padding:2px 7px">${esc(mtLabel(s.meeting_type, l))}</span>` : ""}
              ${isRecurring ? `<span class="tag" style="background:rgba(147,112,219,.15);color:#9370DB;font-size:10px">🔁 ${esc(recurrenceLabel(s.recurrence, l))}</span>` : ""}
              ${s.board_name_ar ? `<span class="tag" style="background:rgba(91,155,214,.12);color:#5B9BD6;font-size:10px">🏛 ${esc(l === "ar" ? s.board_name_ar : s.board_name_en || s.board_name_ar)}</span>` : ""}
              ${s.committee_name_ar ? `<span class="tag" style="background:rgba(46,204,138,.10);color:var(--green);font-size:10px">⚙️ ${esc(l === "ar" ? s.committee_name_ar : s.committee_name_en || s.committee_name_ar)}</span>` : ""}
              ${s.doc_count ? `<span class="tag" style="background:var(--navy3);color:var(--text3);font-size:10px">📁 ${s.doc_count}</span>` : ""}
              ${(s.meeting_provider && s.meeting_provider !== "physical") ? (() => { const _pc = {zoom:{c:"#2D8CFF",b:"rgba(45,140,255,.13)",i:"🎥",n:"Zoom"},teams:{c:"#6264A7",b:"rgba(98,100,167,.13)",i:"💼",n:"Teams"},google_meet:{c:"#00897B",b:"rgba(0,137,123,.13)",i:"🎦",n:"Meet"}}[s.meeting_provider]||{}; return `<span class="tag" style="background:${_pc.b};color:${_pc.c};font-size:10px;border:.5px solid ${_pc.c}33">${_pc.i} ${_pc.n}</span>`; })() : ""}
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">
              📅 ${esc(s.meeting_date || "")} ${s.meeting_time ? `🕐 ${esc(s.meeting_time)}` : ""} · ${s.duration_mins || 60} ${l === "ar" ? "د" : "min"} · ${esc(s.platform || "")}
            </div>
            ${s.attendees ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">👥 ${esc(s.attendees)}</div>` : ""}
            ${agenda ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">📋 ${esc(agenda.substring(0, 80))}${agenda.length > 80 ? "…" : ""}</div>` : ""}
            ${isDraft && s.source_meeting_id ? `<div style="font-size:10px;color:#d4a017;margin-top:3px">🤖 ${l === "ar" ? "مُقترح تلقائياً من نص اجتماع" : "Auto-suggested from a meeting transcript"}</div>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
            ${isDraft ? `<span class="tag" style="background:#7c5e10;color:#ffd969;font-size:10px">📝 ${l === "ar" ? "مسودة" : "Draft"}</span>` : isUpcoming ? `<span class="tag tg" style="font-size:10px">${l === "ar" ? "قادم" : "Upcoming"}</span>` : `<span class="tag" style="background:var(--navy4);font-size:10px">${l === "ar" ? "مضى" : "Past"}</span>`}
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
          ${type ? `<div style="font-size:10px;color:var(--gold);margin-bottom:3px">${esc(mtLabel(type, l))}</div>` : ""}
          <div style="font-size:10px;color:var(--text3)">${dur} ${l === "ar" ? "دقيقة" : "min"}</div>
          <div style="display:flex;gap:5px;margin-top:8px">
            <button class="btn-ghost btn-sm" style="font-size:10px;padding:3px 9px" onclick="event.stopPropagation();Schedule.applyTemplate(${t.id})">▶ ${l === "ar" ? "استخدام" : "Use"}</button>
            ${!t.is_builtin ? `<button class="btn-ghost btn-sm" style="font-size:10px;padding:3px 7px;color:var(--red)" onclick="event.stopPropagation();Templates.deleteTemplate(${t.id})">✕</button>` : ""}
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
      if (document.querySelector(".nb.active")?.dataset.p === "transcripts")
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
      if (e.message === "SMTP_NOT_CONFIGURED" || e.message?.includes("SMTP")) {
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
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:5px">
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
            ${!memberTasks.length ? `<span class="tag" style="background:var(--navy4);font-size:10px">${l === "ar" ? "لا مهام مسندة" : "No tasks assigned"}</span>` : ""}
          </div>
          ${
            canManage
              ? `<div style="display:flex;gap:7px;border-top:1px solid var(--border2);padding-top:10px">
            <button class="btn-ghost btn-sm" onclick="Team.edit(${m.id})" style="flex:1;font-size:11px">✏️ ${l === "ar" ? "تعديل" : "Edit"}</button>
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
    ["m-name-ar", "m-name-en", "m-email", "m-role-ar", "m-role-en"].forEach(
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
    const [stats, tasks, meetings, schedule, members, decisions, analytics] =
      await Promise.all([
        api("/api/stats"),
        api("/api/tasks"),
        api("/api/meetings"),
        api("/api/schedule"),
        api("/api/members"),
        api("/api/decisions"),
        api("/api/analytics"),
      ]);
    const l = App.lang;
    const lbl = (ar, en) => (l === "ar" ? ar : en);
    const today = new Date().toISOString().substring(0, 10);
    const upcoming = schedule.filter((s) => s.meeting_date >= today);

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
    };
    const allowedKeys = new Set(
      ROLE_STAT_KEYS[role] || ROLE_STAT_KEYS["Admin"],
    );
    const statCards = allStatCards.filter((c) => allowedKeys.has(c.key));
    const gridCols =
      statCards.length <= 3
        ? statCards.length
        : statCards.length <= 4
          ? 4
          : statCards.length <= 7
            ? 4
            : 4;

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

    const statsHtml = `<div style="display:grid;grid-template-columns:repeat(${gridCols},1fr);gap:12px;margin-bottom:16px">
        ${statCards
          .map(
            (
              s,
            ) => {
          // Trend & sub-description per metric
          const td = {
            meetings:      { trend:'neu', tl: lbl('كل الاجتماعات','All sessions'), sub: lbl('انقر لعرض المحاضر','Click to view transcripts') },
            tasks_open:    { trend: s.val > 0 ? 'warn' : 'neu', tl: s.val > 0 ? lbl(`${stats.tasks_overdue} متأخرة`,''+stats.tasks_overdue+' overdue') : lbl('لا مهام مفتوحة','No open tasks'), sub: lbl('المهام الجارية والجديدة','In-progress & new tasks') },
            tasks_overdue: { trend: s.val > 0 ? 'down' : 'neu', tl: s.val > 0 ? lbl('تحتاج انتباهاً فورياً','Requires immediate action') : lbl('لا متأخرة ✓','None overdue ✓'), sub: lbl('المهام المتجاوزة للموعد','Past due date') },
            tasks_done:    { trend:'up',  tl: stats.completion + '% ' + lbl('نسبة إنجاز','completion'), sub: lbl('مكتملة هذا الأسبوع','Completed tasks') },
            decisions:     { trend:'neu', tl: lbl('قيد التنفيذ','Tracked decisions'), sub: lbl('من كل الاجتماعات','Across all meetings') },
            schedule:      { trend:'neu', tl: lbl('الـ 30 يوم القادمة','Next 30 days'), sub: lbl('اجتماعات مجدولة','Scheduled meetings') },
            users:         { trend:'neu', tl: lbl('أعضاء الفريق','Team members'), sub: lbl('لديهم صلاحية الوصول','With system access') },
            completion:    { trend: s.val >= 70 ? 'up' : s.val >= 40 ? 'warn' : 'down', tl: s.val >= 70 ? lbl('أداء ممتاز','Excellent performance') : s.val >= 40 ? lbl('أداء متوسط','Moderate performance') : lbl('يحتاج متابعة','Needs attention'), sub: lbl('نسبة إنجاز المهام','Overall task completion') },
          }[s.key] || { trend:'neu', tl: '', sub: '' };
          const trendClass = { up:'trend-up', down:'trend-down', neu:'trend-neu', warn:'trend-warn' }[td.trend];
          const trendIcon  = { up:'↑', down:'↓', neu:'●', warn:'⚠' }[td.trend];
          return `<div class="card stat-clickable" style="text-align:center;padding:24px 16px 20px;cursor:pointer;position:relative;overflow:hidden;min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center" onclick="Panels.load('${s.go}')" title="${esc(s.label)}">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${s.color};opacity:.9;border-radius:14px 14px 0 0"></div>
          <div style="font-size:32px;margin-bottom:10px;line-height:1">${s.icon}</div>
          <div style="font-size:34px;font-weight:800;color:${s.color};letter-spacing:-.04em;line-height:1">${s.val}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text2);margin-top:7px;line-height:1.3">${s.label}</div>
          <div class="stat-trend ${trendClass}">${trendIcon} ${td.tl}</div>
          <div style="font-size:11.5px;color:var(--text3);margin-top:6px;line-height:1.4">${td.sub}</div>
          <div class="stat-click-hint">${l === 'ar' ? '← اضغط للعرض' : 'click to view →'}</div>
        </div>`;},
          )
          .join("")}
      </div>`;

    const hasCharts = !!window.Chart;
    const chartsGridHtml = hasCharts
      ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">📊 ${lbl("مسار المهام — 8 أسابيع", "Task Trend — 8 Weeks")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-tasks"></canvas></div></div>
        <div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">🎙 ${lbl("نشاط الاجتماعات — 6 أشهر", "Meeting Activity — 6 Months")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-meetings"></canvas></div></div>
        <div class="card"><div class="ct" style="margin-bottom:8px;font-size:12px">👥 ${lbl("أداء الفريق", "Team Performance")}</div><div style="position:relative;height:155px"><canvas id="cht-ov-team"></canvas></div></div>
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
                ${s.meeting_type ? `<span class="tag tgold" style="font-size:10px;padding:2px 6px">${esc(mtLabel(s.meeting_type, l))}</span>` : ""}
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">📅 ${esc(s.meeting_date || "")} ${s.meeting_time ? "🕐 " + esc(s.meeting_time) : ""} · ${esc(s.platform || "")}</div>
            </div>`,
                  )
                  .join("")
              : `<div style="font-size:12px;color:var(--text3)">${lbl("لا اجتماعات قادمة", "No upcoming meetings")}</div>`
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
                ${t.owner_name_ar ? `<span class="tag tgold" style="font-size:10px">${esc(l === "ar" ? t.owner_name_ar : t.owner_name_en || t.owner_name_ar)}</span>` : ""}
                ${t.due_date ? `<span class="tag tr" style="font-size:10px">${esc(t.due_date)}</span>` : ""}
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
            <span style="font-size:10px;padding:2px 7px;border-radius:6px;margin-top:2px;white-space:nowrap;background:${d.status === "implemented" ? "rgba(46,204,113,.15)" : "rgba(255,193,7,.15)"};color:${d.status === "implemented" ? "var(--green)" : "var(--amber)"}">
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
                ${t.due_date ? `<span class="tag ${t.status === "overdue" ? "tr" : "ta"}" style="font-size:10px">${esc(t.due_date)}</span>` : ""}
                <span class="tag" style="font-size:10px;background:var(--navy4)">${esc(t.status)}</span>
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
    const showCharts = hasCharts && ROLE_ACCESS[role]?.has("analytics");
    const _ovBanner = `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:15px 18px;background:linear-gradient(135deg,var(--navy3),var(--navy2));border:1px solid var(--border2);border-radius:12px;margin-bottom:18px">
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">📊 ${lbl('نظرة تنفيذية سريعة','Executive Snapshot')}</div>
        <div style="font-size:11.5px;color:var(--text3);line-height:1.65">${lbl('جميع مقاييس المنظومة في مكان واحد — انقر على أي بطاقة للانتقال مباشرةً إلى الصفحة المعنية','All organisation metrics in one view — click any card to navigate directly to that section')}</div>
      </div>
      <button class="btn-gold btn-sm" onclick="Panels.load('record')" style="white-space:nowrap;font-size:12px">🎙 ${lbl('تسجيل اجتماع','Record Meeting')}</button>
    </div>`;
    body.innerHTML = `
      ${roleHeader}
      ${_ovBanner}
      ${Dash.bar(l)}
      ${sec("stats", `<div style="margin-bottom:4px"><div style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px;padding-inline-start:2px">— ${lbl('مؤشرات الأداء الرئيسية','Key Performance Indicators')} —</div>${statsHtml}</div>`)}
      ${showCharts ? sec("charts", `<div>${_secHdr('📈',lbl('الاتجاهات والرسوم البيانية','Trends & Charts'),'','',lbl('بيانات حية من الاجتماعات المسجلة','Live data from recorded sessions'))}${chartsGridHtml}</div>`) : ""}
      ${sec("upcoming", `<div style="margin-bottom:14px">${_secHdr('📅',lbl('الاجتماعات القادمة','Upcoming Meetings'),'','',lbl('انقر للذهاب إلى الجدول','Click to open full schedule'))}${upcomingHtml}</div>`)}
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
    return `<div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px 14px">
      <span style="font-size:11px;font-weight:700;color:var(--text)">⚙️ ${l === "ar" ? "تخصيص اللوحة" : "Customize Dashboard"}</span>
      ${item("stats", "الإحصائيات", "Stats")}
      ${item("team", "أداء الفريق", "Team Performance")}
      ${item("upcoming", "الاجتماعات القادمة", "Upcoming")}
      ${item("overdue", "المهام المتأخرة", "Overdue")}
    </div>`;
  },
};

// ══ Admin Panel (Role Management) ═════════════════════════════════════════════
const SYSTEM_ROLES = [
  "Admin",
  "CEO",
  "Board Member",
  "Committee Member",
  "Executive",
  "Manager",
  "Employee",
  "Observer",
];

async function renderAdminPanel() {
  const body = $("admin-body");
  if (!body) return;
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const members = await api("/api/members");
    const l = App.lang;
    body.innerHTML = `
      <div class="card">
        <div class="ct" style="margin-bottom:6px">👑 ${l === "ar" ? "إدارة صلاحيات المستخدمين" : "User Role Management"}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px;line-height:1.6">${l === "ar" ? "حدّد دور كل مستخدم في النظام. يتحكم الدور في اللوحات ومستوى الوصول المتاح." : "Assign each user a system role. Roles control which panels and features are accessible."}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${members
            .map((m) => {
              const name = l === "ar" ? m.name_ar : m.name_en || m.name_ar;
              const jobRole =
                l === "ar" ? m.role_ar || "" : m.role_en || m.role_ar || "";
              const initials = name
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0] || "")
                .join("");
              const sysRole = m.system_role || "Admin";
              const color = ROLE_COLORS[sysRole] || "var(--text3)";
              return `<div style="display:flex;align-items:center;gap:10px;background:var(--navy3);border:1px solid var(--border2);border-radius:10px;padding:11px 14px;flex-wrap:wrap">
              <div class="uav" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${esc(initials)}</div>
              <div style="flex:1;min-width:130px">
                <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(name)}</div>
                <div style="font-size:10px;color:var(--text3)">${esc(jobRole)} · ${esc(m.email)}</div>
              </div>
              <select class="fi" style="width:auto;min-width:155px;font-size:12px;padding:6px 10px"
                onchange="AdminPanel.changeRole(${m.id}, this.value)">
                ${SYSTEM_ROLES.map((r) => `<option value="${r}" ${sysRole === r ? "selected" : ""}>${r}</option>`).join("")}
              </select>
              <span id="role-badge-${m.id}" style="font-size:10px;padding:3px 9px;border-radius:12px;border:1px solid ${color}44;color:${color};background:${color}14;white-space:nowrap">${sysRole}</span>
            </div>`;
            })
            .join("")}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="ct" style="margin-bottom:10px">ℹ️ ${l === "ar" ? "شرح الأدوار" : "Role Descriptions"}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;font-size:11px">
          ${[
            [
              "Admin",
              "#e05a5a",
              l === "ar"
                ? "مدير النظام — وصول كامل + لوحة الإدارة"
                : "System Admin — full access + admin panel",
            ],
            [
              "CEO",
              "#C9A84C",
              l === "ar" ? "الرئيس التنفيذي — وصول كامل" : "CEO — full access",
            ],
            [
              "Board Member",
              "#5B9BD6",
              l === "ar"
                ? "عضو مجلس — محاضر وقرارات وحوكمة"
                : "Board Member — transcripts, decisions & governance",
            ],
            [
              "Committee Member",
              "#2ECC8A",
              l === "ar"
                ? "عضو لجنة — مهام وقرارات واجتماعات اللجنة"
                : "Committee Member — tasks & committee meetings",
            ],
            [
              "Executive",
              "#9370DB",
              l === "ar"
                ? "تنفيذي — تسجيل ومتابعة وتقارير"
                : "Executive — record, tracking & reports",
            ],
            [
              "Manager",
              "#EFA827",
              l === "ar"
                ? "مدير — تسجيل وإدارة الفريق"
                : "Manager — record & team management",
            ],
            [
              "Employee",
              "#888",
              l === "ar"
                ? "موظف — تسجيل ومهامه الخاصة"
                : "Employee — record & own tasks",
            ],
            [
              "Observer",
              "#888",
              l === "ar" ? "مراقب — قراءة فقط" : "Observer — read-only",
            ],
          ]
            .map(
              ([r, c, d]) => `
            <div style="background:var(--navy3);border-radius:8px;padding:9px 11px;border-inline-start:3px solid ${c}">
              <div style="color:${c};font-weight:700;margin-bottom:3px">${r}</div>
              <div style="color:var(--text3)">${d}</div>
            </div>`,
            )
            .join("")}
        </div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`;
  }
}

const AdminPanel = {
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
      }
      showToast(
        App.lang === "ar"
          ? `تم تحديث الدور إلى ${role}`
          : `Role updated to ${role}`,
      );
    } catch (e) {
      showToast(e.message, "error");
    }
  },
};

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
      <div style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;padding-inline-start:2px">— ${lbl("الرسوم البيانية التفاعلية","Interactive Charts")} —</div>
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
              <div style="font-size:10px;color:var(--text3);margin-top:3px">${s.label}</div>
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
  if (!cpv || !npv || !cfv) {
    if (errEl) {
      errEl.textContent = "Please fill all fields";
      errEl.style.display = "block";
    }
    return;
  }
  if (npv.length < 8) {
    if (errEl) {
      errEl.textContent = "New password must be at least 8 characters";
      errEl.style.display = "block";
    }
    return;
  }
  if (npv !== cfv) {
    if (errEl) {
      errEl.textContent = "Passwords do not match";
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
      okEl.textContent = "Password changed successfully";
      okEl.style.display = "block";
    }
    ["cp-current", "cp-new", "cp-confirm"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    setTimeout(closeChangePassword, 2000);
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || "Error";
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
  if (nm) nm.textContent = "Reset password for: " + userName;
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
  if (!npv || npv.length < 8) {
    if (errEl) {
      errEl.textContent = "Password must be at least 8 characters";
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
      okEl.innerHTML =
        "Reset done. New password: <strong>" +
        npv +
        "</strong><br><small>Share this and ask user to change it immediately.</small>";
      okEl.style.display = "block";
    }
    if (inp) inp.value = "";
    if (btn) btn.style.display = "none";
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || "Error";
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
