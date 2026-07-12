"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   MT — Meetings module (list routing, full meeting detail page, create page,
   Policies & Resolutions panels). Renders into #panel-scheduled views.
   Depends on app.js globals: $, esc, api, App, fmtDate, showToast, Panels,
   authHeaders, TASK_STATUS_META, taskStatusMeta.
   ═══════════════════════════════════════════════════════════════════════════ */

const MT = {
  _view: "list",          // list | detail | create
  _pending: null,         // {view, id, tab} applied on next onPanelShow
  _d: null,               // cached /full payload for the open meeting
  _mid: null,
  _tab: "overview",
  _approvalLog: null,
  _decSel: null,          // selected decision id in Decisions tab
  _minSec: -1,            // minutes section index (-1 = AI minutes)
  _createRendered: false,

  // ── tiny helpers ──────────────────────────────────────────────
  t(ar, en) { return App.lang === "ar" ? ar : en; },
  _title(o) { return App.lang === "ar" ? (o.title_ar || o.title_en || "") : (o.title_en || o.title_ar || ""); },
  _text(o) { return App.lang === "ar" ? (o.text_ar || o.text_en || "") : (o.text_en || o.text_ar || ""); },
  _num(prefix, i) { return `${prefix}-${String(i + 1).padStart(2, "0")}`; },
  _agTitle(a) { return App.lang === "ar" ? (a.title_ar || a.title || a.title_en || "") : (a.title_en || a.title || a.title_ar || ""); },
  _agDesc(a) { return App.lang === "ar" ? (a.description_ar || a.description || "") : (a.description_en || a.description_ar || a.description || ""); },
  _agOutcome(a) { return App.lang === "ar" ? (a.expected_outcome_ar || a.expected_outcome || "") : (a.expected_outcome_en || a.expected_outcome_ar || a.expected_outcome || ""); },
  _initials(name) {
    return (name || "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("");
  },
  _fmtSize(b) {
    b = parseInt(b, 10) || 0;
    if (!b) return "";
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  },
  _time(dt) { return dt && dt.length >= 16 ? dt.substring(11, 16) : ""; },
  _fmtDT(dt) { return dt ? `${fmtDate(dt)}${this._time(dt) ? " · " + this._time(dt) : ""}` : "—"; },
  _docIco(d) {
    const ft = ((d.file_type || "") + (d.file_path || "")).toLowerCase();
    if (ft.includes("pdf")) return "📕";
    if (ft.includes("xls")) return "📗";
    if (ft.includes("ppt")) return "📙";
    if (ft.includes("doc")) return "📘";
    return "📄";
  },

  // ── view switching inside panel-scheduled ─────────────────────
  _showView(v) {
    this._view = v;
    const map = { list: "mtx-list-view", detail: "mtx-detail-view", create: "mtx-create-view" };
    Object.entries(map).forEach(([k, id]) => {
      const el = $(id);
      if (el) el.style.display = k === v ? "" : "none";
    });
  },

  // Called by Panels.load("scheduled") every time the Meetings panel shows
  // (initial nav, sidebar click, language switch).
  onPanelShow() {
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      if (p.view === "create") { this._renderCreate(true); return; }
      if (p.view === "detail") { this._loadDetail(p.id, p.tab); return; }
    }
    if (this._view === "detail" && this._d) { this._renderDetail(); return; }
    // Re-paint (not just re-show) so a language toggle re-translates the form
    // — _renderCreate(false) keeps the user's in-progress state in _cs.
    if (this._view === "create" && this._createRendered) { this._renderCreate(false); return; }
    this._showView("list");
  },

  showList() {
    this._d = null; this._mid = null; this._approvalLog = null;
    this._showView("list");
    if (window.ScheduledPanel) ScheduledPanel.refresh().catch(() => {});
  },

  // ── public entry points ───────────────────────────────────────
  openCreate() {
    if (Panels.current === "scheduled") { this._renderCreate(true); return; }
    this._pending = { view: "create" };
    Panels.load("scheduled");
  },

  openDetail(meetingId, tab) {
    if (Panels.current === "scheduled") { this._loadDetail(meetingId, tab); return; }
    this._pending = { view: "detail", id: meetingId, tab: tab };
    Panels.load("scheduled");
  },

  // ═════════════════════════════════════════════════════════════
  //  DETAIL PAGE (mockup 3333 + tab mockups 5555/6666/7777)
  // ═════════════════════════════════════════════════════════════
  async _loadDetail(meetingId, tab) {
    const box = $("mtx-detail-view");
    if (!box) return;
    this._showView("detail");
    if (this._mid !== meetingId) {
      this._decSel = null; this._minSec = -1; this._approvalLog = null;
      box.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    }
    this._mid = meetingId;
    this._tab = tab || (this._mid === meetingId && this._tab) || "overview";
    if (tab) this._tab = tab;
    try {
      this._d = await api(`/api/meetings/${meetingId}/full`);
    } catch (e) {
      box.innerHTML = `<div class="mx-empty"><div class="ic">⚠️</div><div class="t">${this.t("تعذّر تحميل الاجتماع", "Could not load the meeting")}</div><div class="s">${esc(e.message)}</div><button class="btn-ghost btn-sm" onclick="MT.showList()">${this.t("عودة إلى الاجتماعات", "Back to Meetings")}</button></div>`;
      return;
    }
    if (App.can("minutes.view")) {
      try { this._approvalLog = (await api(`/api/meetings/${meetingId}/approval-log`)).log || []; }
      catch (_) { this._approvalLog = []; }
    } else this._approvalLog = [];
    this._renderDetail();
  },

  async _refreshDetail() {
    if (!this._mid) return;
    await this._loadDetail(this._mid, this._tab);
  },

  _statusPill(m) {
    const t = (ar, en) => this.t(ar, en);
    if (m.recording_status === "recording")
      return `<span class="mx-live-pill"><span class="rdot"></span>${t("مباشر", "Live")}</span>`;
    if (m.minutes_status === "final_approved" || m.lifecycle_stage === "archived")
      return `<span class="mt2-pill mt2-p-green">✓ ${t("مكتمل", "Completed")}</span>`;
    if (["secretary_review", "chairman_approval", "ai_minutes_generated"].includes(m.lifecycle_stage))
      return `<span class="mt2-pill mt2-p-amber">${t("قيد المراجعة", "In Review")}</span>`;
    if (m.lifecycle_stage === "recording")
      return `<span class="mt2-pill mt2-p-red">${t("جارٍ الآن", "In Progress")}</span>`;
    return `<span class="mt2-pill mt2-p-blue">${t("مجدول", "Scheduled")}</span>`;
  },

  _tabsDef() {
    const d = this._d;
    return [
      { k: "overview", ico: "☰", ar: "نظرة عامة", en: "Overview" },
      { k: "agenda", ico: "🗒", ar: "جدول الأعمال", en: "Agenda", n: d.agenda.length },
      { k: "live", ico: "🔴", ar: "الاجتماع المباشر", en: "Live Meeting" },
      { k: "minutes", ico: "📝", ar: "المحضر", en: "Minutes" },
      { k: "decisions", ico: "⚖️", ar: "القرارات", en: "Decisions", n: d.decisions.length },
      { k: "actions", ico: "🎯", ar: "الإجراءات", en: "Actions", n: d.tasks.length },
      { k: "documents", ico: "📄", ar: "المستندات", en: "Documents", n: d.documents.length },
      { k: "timeline", ico: "🕘", ar: "الجدول الزمني", en: "Timeline" },
      { k: "approval", ico: "✅", ar: "الاعتماد", en: "Approval" },
    ];
  },

  setTab(k) {
    this._tab = k;
    this._renderDetail();
  },

  _renderDetail() {
    const box = $("mtx-detail-view");
    if (!box || !this._d) return;
    this._showView("detail");
    const d = this._d, m = d.meeting;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;

    const curTab = this._tabsDef().find((x) => x.k === this._tab) || this._tabsDef()[0];
    const crumbs = `<div class="mx-crumbs">
      <button class="mx-crumb" onclick="MT.showList()">${t("الاجتماعات", "Meetings")}</button>
      <span>›</span><span class="${this._tab === "overview" ? "mx-crumb-cur" : ""}">${esc(this._title(m))}</span>
      ${this._tab !== "overview" ? `<span>›</span><span class="mx-crumb-cur">${t(curTab.ar, curTab.en)}</span>` : ""}
    </div>`;

    // header actions — only real capabilities
    const canRec = App.can("meetings.create") || App.can("meetings.edit");
    const acts = [];
    if (canRec && m.recording_status === "recording")
      acts.push(`<button class="btn-ghost" style="color:var(--red);border-color:var(--red)" onclick="MT.stopRecording()">■ ${t("إنهاء الاجتماع", "End Meeting")}</button>`);
    else if (canRec && m.recording_status !== "recording" && m.minutes_status === "draft" && !["archived"].includes(m.lifecycle_stage))
      acts.push(`<button class="btn-gold" onclick="MT.startRecording()">🎙 ${t("بدء الاجتماع", "Start Meeting")}</button>`);
    acts.push(`<button class="btn-ghost btn-sm" onclick="MT._refreshDetail()">↺</button>`);

    const orgName = (l === "ar" ? m.recorder_ar : m.recorder_en) || m.recorder_ar || "";
    const boardName = (l === "ar" ? m.board_name_ar : m.board_name_en) || m.board_name_ar || (l === "ar" ? m.committee_name_ar : m.committee_name_en) || m.committee_name_ar || "";

    const meta = `<div class="mx-metarow">
      <div class="mx-meta"><span class="mx-meta-ico">📅</span><div><div class="mx-meta-v">${fmtDate(m.meeting_date)}</div><div class="mx-meta-l">${this._time(m.meeting_date) || t("التاريخ", "Date")}</div></div></div>
      ${m.duration ? `<div class="mx-meta"><span class="mx-meta-ico">🕐</span><div><div class="mx-meta-v">${Math.round((parseInt(m.duration, 10) || 0) / 60)} ${t("دقيقة", "min")}</div><div class="mx-meta-l">${t("المدة", "Duration")}</div></div></div>` : ""}
      ${m.platform ? `<div class="mx-meta"><span class="mx-meta-ico">📍</span><div><div class="mx-meta-v">${esc(m.platform)}</div><div class="mx-meta-l">${t("المكان / المنصة", "Location / Platform")}</div></div></div>` : ""}
      ${orgName ? `<div class="mx-meta"><span class="mx-av">${esc(this._initials(orgName))}</span><div><div class="mx-meta-v">${esc(orgName)}</div><div class="mx-meta-l">${t("المنظِّم", "Organizer")}</div></div></div>` : ""}
    </div>`;

    const tabs = `<div class="mx-tabs">${this._tabsDef().map((x) =>
      `<button class="mx-tab ${this._tab === x.k ? "active" : ""}" onclick="MT.setTab('${x.k}')">${x.ico} ${t(x.ar, x.en)}${x.n ? ` <span class="mt2-tab-n">${x.n}</span>` : ""}</button>`).join("")}</div>`;

    let body = "";
    switch (this._tab) {
      case "agenda": body = this._tabAgenda(); break;
      case "live": body = this._tabLive(); break;
      case "minutes": body = this._tabMinutes(); break;
      case "decisions": body = this._tabDecisions(); break;
      case "actions": body = this._tabActions(); break;
      case "documents": body = this._tabDocuments(); break;
      case "timeline": body = this._tabTimeline(); break;
      case "approval": body = this._tabApproval(); break;
      default: body = this._tabOverview();
    }

    box.innerHTML = `${crumbs}
      <div class="mx-head">
        <div style="min-width:0">
          <div class="mx-head-title">${esc(this._title(m))} ${this._statusPill(m)}</div>
          ${(l === "ar" ? m.title_en : m.title_ar) && m.title_ar !== m.title_en ? `<div class="mx-head-sub">${esc(l === "ar" ? m.title_en : m.title_ar)}</div>` : ""}
          ${boardName ? `<div class="mx-head-sub">${esc(boardName)}</div>` : ""}
        </div>
        <div class="mx-head-actions">${acts.join("")}</div>
      </div>
      ${meta}${tabs}
      <div id="mtx-tabbody">${body}</div>`;
  },

  // ── Overview tab (mockup 3333) ────────────────────────────────
  _tabOverview() {
    const d = this._d, m = d.meeting;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const summary = (l === "ar" ? m.ai_summary_ar : m.ai_summary_en) || m.ai_summary_ar || (l === "ar" ? m.purpose_ar : m.purpose_en) || m.purpose_ar || "";
    const orgName = (l === "ar" ? m.recorder_ar : m.recorder_en) || m.recorder_ar || "";
    const seriesName = (l === "ar" ? m.series_name_ar : m.series_name_en) || m.series_name_ar || "";

    const fact = (kAr, kEn, v) => v ? `<div><div style="font-size:10.5px;color:#98A2B3;font-weight:700;margin-bottom:2px">${t(kAr, kEn)}</div><div style="font-size:12.5px;font-weight:700;color:#0F1728">${esc(String(v))}</div></div>` : "";
    const summaryCard = `<div class="mx-card">
      <div class="mx-card-t">📋 ${t("ملخص الاجتماع", "Meeting Summary")}</div>
      ${summary ? `<div style="font-size:12.5px;color:#374151;line-height:1.7;margin-bottom:14px">${esc(summary)}</div>` : `<div style="font-size:12px;color:#98A2B3;margin-bottom:14px">${t("سيظهر الملخص بعد معالجة الاجتماع بالذكاء الاصطناعي.", "The summary will appear once the meeting is processed by AI.")}</div>`}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">
        ${fact("نوع الاجتماع", "Meeting Type", m.meeting_type)}
        ${fact("سلسلة الاجتماعات", "Meeting Series", seriesName)}
        ${fact("المشاركون", "Participants", d.attendees.length ? d.attendees.length + " " + t("عضو", "members") : "")}
        ${fact("أمانة السر", "Secretariat", orgName)}
        ${fact("التسجيل", "Recording", { not_started: t("لم يبدأ", "Not Started"), recording: t("جارٍ التسجيل", "Recording"), stopped: t("متوقف", "Stopped"), uploaded: t("مرفوع", "Uploaded") }[m.recording_status] || m.recording_status)}
        ${fact("آخر تحديث", "Last Updated", this._fmtDT(m.lifecycle_updated_at || m.created_at))}
      </div></div>`;

    // progress stepper from lifecycle_stage
    const steps = [
      { k: "created", ar: "تم الإنشاء", en: "Created" },
      { k: "recording", ar: "جارٍ الاجتماع", en: "In Progress" },
      { k: "ai_minutes_generated", ar: "محضر الذكاء الاصطناعي", en: "AI Minutes" },
      { k: "secretary_review", ar: "مراجعة أمين السر", en: "Secretary Review" },
      { k: "chairman_approval", ar: "اعتماد الرئيس", en: "Chairman Approval" },
      { k: "archived", ar: "مغلق", en: "Closed" },
    ];
    const stageIdx = { created: 0, recording: 1, uploaded: 1, processing: 1, ai_minutes_generated: 2, secretary_review: 3, chairman_approval: 4, archived: 5 };
    const cur = stageIdx[m.lifecycle_stage] != null ? stageIdx[m.lifecycle_stage] : 0;
    const lcByStage = {};
    d.lifecycle.forEach((e) => { lcByStage[e.to_stage] = e; });
    const progressCard = `<div class="mx-card">
      <div class="mx-card-t">${t("تقدّم الاجتماع", "Meeting Progress")}</div>
      <div class="mx-steps">${steps.map((s, i) => {
        const st = i < cur ? "done" : i === cur ? "cur" : "";
        const log = lcByStage[s.k];
        return `<div class="mx-step ${st}"><div class="mx-step-dot">${i < cur ? "✓" : i + 1}</div>
          <div class="mx-step-l">${t(s.ar, s.en)}</div>
          <div class="mx-step-s">${log ? fmtDate(log.created_at) : (i === cur ? t("الحالي", "Current") : t("قيد الانتظار", "Pending"))}</div></div>`;
      }).join("")}</div></div>`;

    // key decisions / actions / documents cards
    const decCard = `<div class="mx-card"><div class="mx-card-t">⚖️ ${t("أبرز القرارات", "Key Decisions")}<button class="mx-link" onclick="MT.setTab('decisions')">${t("عرض الكل", "View All")}</button></div>
      ${d.decisions.length ? d.decisions.slice(0, 5).map((x) => `<div class="mx-checkrow"><span class="mx-check">✔</span><span>${esc(this._text(x))}</span></div>`).join("")
        : `<div style="font-size:12px;color:#98A2B3">${t("لا توجد قرارات مسجّلة بعد.", "No decisions recorded yet.")}</div>`}</div>`;

    const actCard = `<div class="mx-card"><div class="mx-card-t">🎯 ${t("الإجراءات التنفيذية", "Executive Actions")}<button class="mx-link" onclick="MT.setTab('actions')">${t("عرض الكل", "View All")}</button></div>
      ${d.tasks.length ? d.tasks.slice(0, 4).map((x) => {
        const meta = (typeof taskStatusMeta === "function") ? taskStatusMeta(x.status) : null;
        const owner = (App.lang === "ar" ? x.owner_name_ar : x.owner_name_en) || x.owner_name_ar || "";
        return `<div class="mx-docrow"><span class="mx-av">${esc(this._initials(owner || "؟"))}</span>
          <div style="flex:1;min-width:0"><div class="mx-doc-name">${esc(this._text(x))}</div>
          <div class="mx-doc-meta">${owner ? esc(owner) + " · " : ""}${x.due_date ? t("الاستحقاق: ", "Due: ") + fmtDate(x.due_date) : ""}</div></div>
          ${meta ? `<span class="tag ${meta.tagClass}">${App.lang === "ar" ? meta.ar : meta.en}</span>` : ""}</div>`;
      }).join("") : `<div style="font-size:12px;color:#98A2B3">${t("لا توجد إجراءات بعد.", "No actions yet.")}</div>`}</div>`;

    const docCard = `<div class="mx-card"><div class="mx-card-t">📁 ${t("المستندات وحزمة المجلس", "Documents & Board Pack")}<button class="mx-link" onclick="MT.setTab('documents')">${t("عرض الكل", "View All")}</button></div>
      ${d.documents.length ? d.documents.slice(0, 5).map((x) => `<div class="mx-docrow"><div class="mx-doc-ico">${this._docIco(x)}</div>
        <div style="flex:1;min-width:0"><div class="mx-doc-name">${esc(x.title)}</div><div class="mx-doc-meta">${this._fmtSize(x.file_size)}</div></div>
        <a class="mx-doc-dl" href="/uploads/${encodeURIComponent(x.file_path)}" target="_blank" rel="noopener">⬇</a></div>`).join("")
        : `<div style="font-size:12px;color:#98A2B3">${t("لا توجد مستندات مرفوعة.", "No uploaded documents.")}</div>`}</div>`;

    // timeline strip from real lifecycle log
    const tlCard = `<div class="mx-card"><div class="mx-card-t">${t("الجدول الزمني للاجتماع", "Meeting Timeline")}<button class="mx-link" onclick="MT.setTab('timeline')">${t("عرض الجدول الكامل", "View Full Timeline")} →</button></div>
      ${d.lifecycle.length ? `<div class="mx-htl">${d.lifecycle.map((e) => `<div class="mx-htl-item done"><div class="mx-htl-dot"></div>
        <div class="mx-htl-d">${this._fmtDT(e.created_at)}</div><div class="mx-htl-t">${esc(e.note || e.to_stage)}</div>
        ${e.actor_name ? `<div class="mx-htl-s">${esc(e.actor_name)}</div>` : ""}</div>`).join("")}</div>`
        : `<div style="font-size:12px;color:#98A2B3">${t("لا توجد أحداث بعد.", "No events yet.")}</div>`}</div>`;

    return `<div class="mx-grid2">${summaryCard}${progressCard}</div>
      <div class="mx-grid3">${decCard}${actCard}${docCard}</div>${tlCard}`;
  },

  // ── Agenda tab ────────────────────────────────────────────────
  _tabAgenda() {
    const d = this._d;
    const t = (ar, en) => this.t(ar, en);
    if (!d.agenda.length)
      return `<div class="mx-card"><div class="mx-empty"><div class="ic">🗒</div><div class="t">${t("لا يوجد جدول أعمال", "No agenda yet")}</div><div class="s">${t("لم تتم إضافة بنود جدول أعمال لهذا الاجتماع.", "No agenda items have been added to this meeting.")}</div></div></div>`;
    return `<div class="mx-card"><div class="mx-card-t">🗒 ${t("جدول الأعمال", "Agenda")} <span class="mt2-tab-n">${d.agenda.length}</span></div>
      ${d.agenda.map((a, i) => `<div class="mx-docrow" style="align-items:flex-start">
        <div class="mx-agrow-n" style="width:26px;height:26px;border-radius:50%;background:#F2F4F7;color:#475467;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">${i + 1}</div>
        <div style="flex:1;min-width:0">
          <div class="mx-doc-name" style="white-space:normal">${esc(this._agTitle(a))}</div>
          ${this._agDesc(a) ? `<div style="font-size:12px;color:#697386;line-height:1.55;margin-top:2px">${esc(this._agDesc(a))}</div>` : ""}
          <div class="mx-doc-meta" style="margin-top:3px">${[a.presenter ? t("مقدّم البند: ", "Presenter: ") + esc(a.presenter) : "", this._agOutcome(a) ? t("النتيجة المتوقعة: ", "Expected outcome: ") + esc(this._agOutcome(a)) : ""].filter(Boolean).join(" · ")}</div>
        </div>
        <span class="tag tgr" style="flex-shrink:0">${a.duration_mins || 15} ${t("د", "min")}</span></div>`).join("")}</div>`;
  },

  // ── Live Meeting tab (mockup 5555) ────────────────────────────
  _parseSpeakerTranscript() {
    const m = this._d.meeting;
    try {
      const rows = JSON.parse(m.speaker_transcript || "[]");
      if (Array.isArray(rows) && rows.length) return rows.map((r) => ({ speaker: r.speaker || "", text: App.lang === "ar" ? (r.text_ar || r.text_en || "") : (r.text_en || r.text_ar || "") }));
    } catch (_) {}
    if ((m.transcript || "").trim()) return [{ speaker: "", text: m.transcript.trim() }];
    return [];
  },

  _tabLive() {
    const d = this._d, m = d.meeting;
    const t = (ar, en) => this.t(ar, en);
    const live = m.recording_status === "recording";
    const canRec = App.can("meetings.create") || App.can("meetings.edit");
    const tr = this._parseSpeakerTranscript();

    const stage = `<div>
      <div class="mx-stage">
        <span class="mx-stage-badge">${m.platform ? esc(m.platform) : t("اجتماع حضوري", "In-Person Meeting")}</span>
        <div class="mx-stage-logo">🏛</div>
        <div class="mx-stage-t">${esc(this._title(m))}</div>
        <div class="mx-stage-s">${live ? t("الاجتماع جارٍ الآن — التسجيل نشط", "Meeting in progress — recording active") : t("لا يوجد بث مباشر لهذا الاجتماع", "No live feed for this meeting")}</div>
        ${live ? `<span class="mx-live-pill"><span class="rdot"></span>${t("مباشر", "Live")}</span>` : ""}
      </div>
      <div class="mx-card" style="margin-top:14px"><div class="mx-card-t">${t("المشاركون", "Participants")} <span class="mt2-tab-n">${d.attendees.length}</span></div>
        ${d.attendees.length ? d.attendees.map((a) => `<div class="mx-partrow"><span class="mx-av">${esc(this._initials(a.name))}</span>
          <div style="flex:1;min-width:0"><div class="mx-person-n">${esc(a.name)}</div><div class="mx-person-r">${esc(a.role || "")}</div></div>
          ${a.confirmed ? `<span class="tag tg">✓ ${t("مؤكد", "Confirmed")}</span>` : `<span class="tag tgr">${t("بانتظار الرد", "Pending")}</span>`}</div>`).join("")
        : `<div style="font-size:12px;color:#98A2B3">${t("لم تتم إضافة مشاركين.", "No participants added.")}</div>`}</div></div>`;

    const transcript = `<div class="mx-card"><div class="mx-card-t">${t("النص المباشر", "Live Transcript")} ${live ? `<span class="mx-live-pill"><span class="rdot"></span>${t("مباشر", "Live")}</span>` : ""}</div>
      ${tr.length ? `<div class="mx-transcript">${tr.map((r) => `<div class="mx-tr-row">
          <div class="mx-tr-body">${r.speaker ? `<div class="mx-tr-sp">${esc(r.speaker)}</div>` : ""}<div class="mx-tr-tx">${esc(r.text)}</div></div></div>`).join("")}</div>`
        : `<div class="mx-empty" style="padding:36px 12px"><div class="ic">🎙</div><div class="t">${t("لا يوجد نص بعد", "No transcript yet")}</div>
           <div class="s">${live ? t("سيظهر النص هنا بعد رفع التسجيل ومعالجته.", "The transcript will appear here once the recording is uploaded and processed.") : t("ابدأ الاجتماع وسجّل المحادثة لتوليد النص والمحضر تلقائياً.", "Start the meeting and record the conversation to generate the transcript and minutes automatically.")}</div></div>`}</div>`;

    const topics = d.agenda.map((a) => `<div class="mx-topic">${esc(this._agTitle(a))}</div>`).join("");
    const summary = (App.lang === "ar" ? m.ai_summary_ar : m.ai_summary_en) || m.ai_summary_ar || "";
    const sentMap = { positive: { ar: "إيجابي", en: "Positive", cls: "tg" }, neutral: { ar: "محايد", en: "Neutral", cls: "tgr" }, negative: { ar: "سلبي", en: "Negative", cls: "tr" } };
    const sent = sentMap[m.ai_sentiment];
    const notes = `<div class="mx-live-notes"><div class="mx-card"><div class="mx-card-t">✨ ${t("ملاحظات الذكاء الاصطناعي", "AI Notes")}</div>
      ${summary ? `<div style="font-size:11px;font-weight:800;color:#697386;margin-bottom:5px">${t("ملخص الاجتماع", "Meeting Summary")}</div><div class="mx-ainote-box">${esc(summary)}</div>` : `<div class="mx-ainote-box">${t("تُولَّد الملاحظات تلقائياً بعد معالجة تسجيل الاجتماع.", "Notes are generated automatically after the meeting recording is processed.")}</div>`}
      ${topics ? `<div style="font-size:11px;font-weight:800;color:#697386;margin:10px 0 4px">${t("المحاور الرئيسية", "Key Topics")}</div>${topics}` : ""}
      ${sent && summary ? `<div style="font-size:11px;font-weight:800;color:#697386;margin:12px 0 6px">${t("الانطباع العام", "Sentiment")}</div><span class="tag ${sent.cls}">${this.t(sent.ar, sent.en)}</span>` : ""}
    </div></div>`;

    const banner = `<div class="mx-live-banner">
      <span>${live ? "🎙 " + t("التسجيل نشط — سيتم توليد المحضر والإجراءات تلقائياً بعد انتهاء الاجتماع.", "Recording active — minutes and actions will be generated automatically after the meeting ends.") : "💡 " + t("سيتم توليد المحضر والإجراءات تلقائياً بعد انتهاء الاجتماع ومعالجة التسجيل.", "Minutes and actions will be generated automatically after the meeting ends and the recording is processed.")}</span>
      ${canRec ? (live
        ? `<button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick="MT.stopRecording()">■ ${t("إيقاف التسجيل", "Stop Recording")}</button>`
        : (m.minutes_status === "draft" && m.lifecycle_stage !== "archived" ? `<button class="btn-gold btn-sm" onclick="MT.startRecording()">🎙 ${t("بدء الاجتماع والتسجيل", "Start Meeting & Record")}</button>` : "")) : ""}
    </div>`;

    return `<div class="mx-live-grid">${stage}${transcript}${notes}</div>${banner}`;
  },

  async startRecording() {
    try {
      await api(`/api/meetings/${this._mid}/recording/start`, { method: "POST", body: JSON.stringify({ capture_type: "external", scope: "full_meeting" }) });
      showToast(this.t("✓ بدأ الاجتماع — التسجيل نشط", "✓ Meeting started — recording active"));
      await this._refreshDetail();
    } catch (e) { showToast(this.t("تعذّر بدء التسجيل: ", "Could not start recording: ") + e.message, "error"); }
  },

  async stopRecording() {
    try {
      await api(`/api/meetings/${this._mid}/recording/stop`, { method: "POST", body: JSON.stringify({}) });
      showToast(this.t("✓ تم إيقاف التسجيل", "✓ Recording stopped"));
      await this._refreshDetail();
    } catch (e) { showToast(this.t("تعذّر إيقاف التسجيل: ", "Could not stop recording: ") + e.message, "error"); }
  },

  // ── Minutes tab (mockup 6666) ─────────────────────────────────
  setMinSec(i) { this._minSec = i; this._renderDetail(); },

  _tabMinutes() {
    const d = this._d, m = d.meeting;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const minutes = (l === "ar" ? m.ai_minutes_ar : m.ai_minutes_en) || m.ai_minutes_ar || "";
    const summary = (l === "ar" ? m.ai_summary_ar : m.ai_summary_en) || m.ai_summary_ar || "";

    const nav = `<div class="mx-card" style="padding:10px"><div class="mx-card-t" style="margin-bottom:6px;padding:0 8px">${t("المحضر", "Minutes")}</div>
      <div class="mx-min-nav">
        <button class="${this._minSec === -1 ? "active" : ""}" onclick="MT.setMinSec(-1)">📝 ${t("المحضر الكامل", "Full Minutes")}</button>
        ${d.agenda.map((a, i) => `<button class="${this._minSec === i ? "active" : ""}" onclick="MT.setMinSec(${i})">${i + 1}. ${esc(this._agTitle(a))}</button>`).join("")}
      </div></div>`;

    let center = "";
    if (this._minSec >= 0 && d.agenda[this._minSec]) {
      const a = d.agenda[this._minSec];
      center = `<div class="mx-card">
        <div class="mx-card-t">${this._minSec + 1}. ${esc(this._agTitle(a))} ${a.duration_mins ? `<span class="tag tgr">🕐 ${a.duration_mins} ${t("د", "min")}</span>` : ""}</div>
        ${this._agDesc(a) ? `<div class="mx-keypoints"><div class="mx-keypoints-t">${t("وصف البند", "Item Description")}</div><div style="font-size:12.5px;color:#1D2939;line-height:1.65">${esc(this._agDesc(a))}</div></div>` : ""}
        ${this._agOutcome(a) ? `<div style="font-size:12px;color:#374151;margin-bottom:10px"><b>${t("النتيجة المتوقعة:", "Expected outcome:")}</b> ${esc(this._agOutcome(a))}</div>` : ""}
        ${a.presenter ? `<div style="font-size:12px;color:#697386">${t("مقدّم البند:", "Presenter:")} <b style="color:#0F1728">${esc(a.presenter)}</b></div>` : ""}
        ${minutes ? `<div style="border-top:1px solid #F2F4F7;margin-top:14px;padding-top:12px"><div style="font-size:11.5px;font-weight:800;color:#697386;margin-bottom:6px">${t("من المحضر", "From the Minutes")}</div><div class="mx-minutes-body">${esc(minutes)}</div></div>` : ""}
      </div>`;
    } else {
      center = `<div class="mx-card">
        ${summary ? `<div class="mx-keypoints"><div class="mx-keypoints-t">${t("ملخص النقاش", "Discussion Summary")}</div><div style="font-size:12.5px;color:#1D2939;line-height:1.7">${esc(summary)}</div></div>` : ""}
        ${minutes ? `<div class="mx-minutes-body">${esc(minutes)}</div>`
          : `<div class="mx-empty" style="padding:40px 12px"><div class="ic">📝</div><div class="t">${t("لم يُولَّد المحضر بعد", "Minutes not generated yet")}</div><div class="s">${t("يُولَّد المحضر تلقائياً بعد معالجة تسجيل الاجتماع بالذكاء الاصطناعي.", "Minutes are generated automatically once the meeting recording is processed by AI.")}</div></div>`}
      </div>`;
    }

    // decisions & actions mini tables under the minutes body
    const decMini = d.decisions.length ? `<div class="mx-card" style="margin-top:14px"><div class="mx-card-t">${t("القرارات", "Decisions")} <span class="mt2-tab-n">${d.decisions.length}</span><button class="mx-link" onclick="MT.setTab('decisions')">${t("عرض الكل", "View All")} →</button></div>
      <table class="mx-table"><thead><tr><th>#</th><th>${t("القرار", "Decision")}</th><th>${t("الحالة", "Status")}</th></tr></thead><tbody>
      ${d.decisions.slice(0, 4).map((x, i) => `<tr><td class="mx-num">${this._num("D", i)}</td><td>${esc(this._text(x))}</td><td>${this._decBadge(x.status)}</td></tr>`).join("")}
      </tbody></table></div>` : "";
    const actMini = d.tasks.length ? `<div class="mx-card" style="margin-top:14px"><div class="mx-card-t">${t("الإجراءات", "Actions")} <span class="mt2-tab-n">${d.tasks.length}</span><button class="mx-link" onclick="MT.setTab('actions')">${t("عرض الكل", "View All")} →</button></div>
      <table class="mx-table"><thead><tr><th>#</th><th>${t("الإجراء", "Action")}</th><th>${t("الاستحقاق", "Due")}</th><th>${t("الحالة", "Status")}</th></tr></thead><tbody>
      ${d.tasks.slice(0, 4).map((x, i) => {
        const meta = (typeof taskStatusMeta === "function") ? taskStatusMeta(x.status) : null;
        return `<tr><td class="mx-num">${this._num("A", i)}</td><td>${esc(this._text(x))}</td><td style="white-space:nowrap">${x.due_date ? fmtDate(x.due_date) : "—"}</td><td>${meta ? `<span class="tag ${meta.tagClass}">${l === "ar" ? meta.ar : meta.en}</span>` : esc(x.status || "")}</td></tr>`;
      }).join("")}</tbody></table></div>` : "";

    // right column: approval status + stats + real downloads
    const ms = m.minutes_status || "draft";
    const msMeta = {
      draft: { ar: "مسودة — لم يُعتمد بعد", en: "Draft — not approved yet", cls: "wait", ico: "🕐" },
      circulated: { ar: "قيد المراجعة والتعميم", en: "Circulated for review", cls: "wait", ico: "🕐" },
      approved: { ar: "المحضر معتمد", en: "Minutes Approved", cls: "ok", ico: "✓" },
      final_approved: { ar: "معتمد نهائياً", en: "Final Approved", cls: "ok", ico: "✓" },
    }[ms] || { ar: ms, en: ms, cls: "wait", ico: "•" };
    const approver = this._approvalLog && this._approvalLog.length
      ? this._approvalLog.filter((x) => x.action === "approved" || x.action === "final_approved").slice(-1)[0] : null;
    const side = `<div class="mx-min-side">
      <div class="mx-card"><div class="mx-card-t">${t("حالة الاعتماد", "Approval Status")}</div>
        <div class="mx-approve-banner ${msMeta.cls}"><span>${msMeta.ico}</span><div>${this.t(msMeta.ar, msMeta.en)}${m.approved_at && ms !== "draft" && ms !== "circulated" ? `<div style="font-size:10.5px;font-weight:500;margin-top:1px">${this._fmtDT(m.final_approved_at || m.approved_at)}</div>` : ""}</div></div>
        ${approver ? `<div style="font-size:11px;font-weight:800;color:#697386;margin-bottom:6px">${t("اعتمده", "Approved By")}</div>
          <div class="mx-person"><span class="mx-av">${esc(this._initials(approver.actor_name))}</span><div><div class="mx-person-n">${esc(approver.actor_name || "")}</div><div class="mx-person-r">${esc(approver.actor_role || "")}</div></div></div>` : ""}
        <button class="mt2-qa-btn" style="margin-top:10px" onclick="MT.setTab('approval')"><span>${t("عرض سجل الاعتماد", "View Approval History")}</span><span class="mt2-chev">${l === "ar" ? "‹" : "›"}</span></button>
      </div>
      <div class="mx-card" style="margin-top:14px"><div class="mx-card-t">${t("ملخص الاجتماع", "Meeting Summary")}</div>
        ${m.duration ? `<div class="mx-statrow"><span class="k">🕐 ${t("المدة", "Duration")}</span><span class="v">${Math.round((parseInt(m.duration, 10) || 0) / 60)} ${t("د", "min")}</span></div>` : ""}
        <div class="mx-statrow"><span class="k">👥 ${t("المشاركون", "Participants")}</span><span class="v">${d.attendees.length}</span></div>
        <div class="mx-statrow"><span class="k">⚖️ ${t("القرارات", "Key Decisions")}</span><span class="v">${d.decisions.length}</span></div>
        <div class="mx-statrow"><span class="k">🎯 ${t("الإجراءات", "Actions Created")}</span><span class="v">${d.tasks.length}</span></div>
        <div class="mx-statrow"><span class="k">📄 ${t("المستندات", "Documents")}</span><span class="v">${d.documents.length}</span></div>
      </div>
      ${d.documents.length ? `<div class="mx-card" style="margin-top:14px"><div class="mx-card-t">${t("التنزيلات", "Downloads")}</div>
        ${d.documents.map((x) => `<div class="mx-docrow"><div class="mx-doc-ico">${this._docIco(x)}</div>
          <div style="flex:1;min-width:0"><div class="mx-doc-name">${esc(x.title)}</div><div class="mx-doc-meta">${this._fmtSize(x.file_size)}</div></div>
          <a class="mx-doc-dl" href="/uploads/${encodeURIComponent(x.file_path)}" target="_blank" rel="noopener">⬇</a></div>`).join("")}</div>` : ""}
    </div>`;

    return `<div class="mx-min-grid">${nav}<div>${center}${decMini}${actMini}</div>${side}</div>`;
  },

  // ── Decisions tab (mockup 7777) ───────────────────────────────
  _decBadge(status) {
    const map = {
      active: { ar: "نشط", en: "Active", cls: "tb" },
      implemented: { ar: "منفَّذ", en: "Implemented", cls: "tg" },
      approved: { ar: "معتمد", en: "Approved", cls: "tg" },
      pending: { ar: "قيد الانتظار", en: "Pending", cls: "tgold" },
      deferred: { ar: "مؤجل", en: "Deferred", cls: "tgr" },
      cancelled: { ar: "ملغى", en: "Cancelled", cls: "tr" },
    }[String(status || "").toLowerCase()] || { ar: status || "—", en: status || "—", cls: "tgr" };
    return `<span class="tag ${map.cls}">${this.t(map.ar, map.en)}</span>`;
  },

  selDecision(id) { this._decSel = id; this._renderDetail(); },
  _decFilter: { q: "", status: "" },
  setDecFilter(k, v) { this._decFilter[k] = v; this._renderDetail(); },

  _tabDecisions() {
    const d = this._d;
    const t = (ar, en) => this.t(ar, en);
    const f = this._decFilter;
    const all = d.decisions;
    const list = all.filter((x) =>
      (!f.q || (x.text_ar || "").includes(f.q) || (x.text_en || "").toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.status || String(x.status || "").toLowerCase() === f.status));
    const sel = all.find((x) => x.id === this._decSel) || list[0] || null;
    if (sel && this._decSel !== sel.id) this._decSel = sel.id;
    const statuses = [...new Set(all.map((x) => String(x.status || "").toLowerCase()).filter(Boolean))];
    const canAdd = App.can("actions.update") || App.can("actions.assign");

    const filterBar = `<div class="mx-filterbar">
      <input class="fi" style="flex:1;min-width:160px" placeholder="${t("بحث في القرارات...", "Search decisions...")}" value="${esc(f.q)}"
        oninput="MT._decFilter.q=this.value" onchange="MT._renderDetail()" onkeydown="if(event.key==='Enter')MT._renderDetail()"/>
      <select class="fi" style="max-width:170px" onchange="MT.setDecFilter('status',this.value)">
        <option value="">${t("كل الحالات", "All Statuses")}</option>
        ${statuses.map((s) => `<option value="${esc(s)}" ${f.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
      ${canAdd ? `<button class="btn-gold btn-sm" onclick="MT.addDecision()">+ ${t("إضافة قرار", "Add Decision")}</button>` : ""}
    </div>`;

    if (!all.length)
      return `<div class="mx-card">${canAdd ? filterBar : ""}<div class="mx-empty"><div class="ic">⚖️</div><div class="t">${t("لا توجد قرارات", "No decisions")}</div><div class="s">${t("لم تُسجَّل قرارات لهذا الاجتماع بعد. تُستخرج القرارات تلقائياً من التسجيل أو يمكن إضافتها يدوياً.", "No decisions recorded for this meeting yet. Decisions are extracted automatically from the recording, or can be added manually.")}</div></div></div>`;

    const table = `<div class="mx-card">
      <div class="mx-card-t">${t("القرارات", "Decisions")} <span class="mt2-tab-n">${all.length}</span></div>
      ${filterBar}
      <div style="overflow-x:auto"><table class="mx-table"><thead><tr>
        <th>#</th><th>${t("القرار", "Decision")}</th><th>${t("اتخذه", "Decided By")}</th><th>${t("التاريخ", "Date")}</th><th>${t("الحالة", "Status")}</th>
      </tr></thead><tbody>
      ${list.map((x) => {
        const idx = all.indexOf(x);
        return `<tr class="mx-row-click ${sel && sel.id === x.id ? "sel" : ""}" onclick="MT.selDecision(${x.id})">
          <td class="mx-num">${this._num("D", idx)}</td>
          <td style="font-weight:600">${esc(this._text(x))}</td>
          <td style="white-space:nowrap">${x.decided_by ? `<div class="mx-person"><span class="mx-av">${esc(this._initials(x.decided_by))}</span><span class="mx-person-n">${esc(x.decided_by)}</span></div>` : "—"}</td>
          <td style="white-space:nowrap">${fmtDate(x.created_at)}</td>
          <td>${this._decBadge(x.status)}</td></tr>`;
      }).join("") || `<tr><td colspan="5" style="color:#98A2B3">${t("لا توجد نتائج مطابقة.", "No matching results.")}</td></tr>`}
      </tbody></table></div>
      <div style="font-size:11px;color:#98A2B3;margin-top:8px">${t(`عرض ${list.length} من ${all.length} قرارات`, `Showing ${list.length} of ${all.length} decisions`)}</div></div>`;

    let details = "";
    if (sel) {
      const idx = all.indexOf(sel);
      const row = (ico, kAr, kEn, v) => v ? `<div class="mx-dd-row"><span class="k">${ico} ${t(kAr, kEn)}</span><span class="v">${v}</span></div>` : "";
      details = `<div class="mx-card"><div class="mx-card-t">${t("تفاصيل القرار", "Decision Details")} ${this._decBadge(sel.status)}</div>
        <div class="mx-num" style="margin-bottom:4px">${this._num("D", idx)}</div>
        <div class="mx-dd-t">${esc(this._text(sel))}</div>
        ${(App.lang === "ar" ? sel.text_en : sel.text_ar) && sel.text_ar !== sel.text_en ? `<div style="font-size:12px;color:#697386;line-height:1.55;margin-bottom:8px">${esc(App.lang === "ar" ? sel.text_en : sel.text_ar)}</div>` : ""}
        <div style="border-top:1px solid #F2F4F7;margin-top:10px;padding-top:8px">
          ${row("🗓", "التاريخ", "Date", this._fmtDT(sel.created_at))}
          ${row("👤", "اتخذه", "Decided By", sel.decided_by ? esc(sel.decided_by) : "")}
          ${row("📌", "الحالة", "Status", this._decBadge(sel.status))}
        </div>
        ${sel.notes ? `<div style="border-top:1px solid #F2F4F7;margin-top:8px;padding-top:10px"><div style="font-size:11px;font-weight:800;color:#697386;margin-bottom:4px">${t("ملاحظات", "Notes")}</div><div style="font-size:12.5px;color:#374151;line-height:1.6">${esc(sel.notes)}</div></div>` : ""}
        ${this._d.documents.length ? `<div style="border-top:1px solid #F2F4F7;margin-top:10px;padding-top:10px"><div style="font-size:11px;font-weight:800;color:#697386;margin-bottom:4px">${t("مستندات الاجتماع", "Meeting Documents")} <span class="mt2-tab-n">${this._d.documents.length}</span></div>
          ${this._d.documents.slice(0, 3).map((x) => `<div class="mx-docrow"><div class="mx-doc-ico">${this._docIco(x)}</div><div style="flex:1;min-width:0"><div class="mx-doc-name">${esc(x.title)}</div><div class="mx-doc-meta">${this._fmtSize(x.file_size)}</div></div><a class="mx-doc-dl" href="/uploads/${encodeURIComponent(x.file_path)}" target="_blank" rel="noopener">⬇</a></div>`).join("")}</div>` : ""}
      </div>`;
    }

    return `<div class="mx-split">${table}${details}</div>`;
  },

  async addDecision() {
    const text = prompt(this.t("نص القرار:", "Decision text:"));
    if (!text || !text.trim()) return;
    try {
      await api("/api/decisions", { method: "POST", body: JSON.stringify({ text_ar: text.trim(), meeting_id: this._mid, meeting_title_ar: this._d.meeting.title_ar, meeting_title_en: this._d.meeting.title_en }) });
      showToast(this.t("✓ تم تسجيل القرار", "✓ Decision recorded"));
      await this._refreshDetail();
    } catch (e) { showToast(this.t("تعذّر إضافة القرار: ", "Could not add decision: ") + e.message, "error"); }
  },

  // ── Actions tab ───────────────────────────────────────────────
  _tabActions() {
    const d = this._d;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    if (!d.tasks.length)
      return `<div class="mx-card"><div class="mx-empty"><div class="ic">🎯</div><div class="t">${t("لا توجد إجراءات", "No actions")}</div><div class="s">${t("تُستخرج الإجراءات التنفيذية تلقائياً من تسجيل الاجتماع بعد معالجته.", "Executive actions are extracted automatically from the meeting recording once processed.")}</div></div></div>`;
    return `<div class="mx-card"><div class="mx-card-t">🎯 ${t("الإجراءات التنفيذية", "Executive Actions")} <span class="mt2-tab-n">${d.tasks.length}</span>
        <button class="mx-link" onclick="Panels.load('tasks')">${t("فتح لوحة المهام", "Open Tasks Board")} →</button></div>
      <div style="overflow-x:auto"><table class="mx-table"><thead><tr>
        <th>#</th><th>${t("الإجراء", "Action")}</th><th>${t("المسؤول", "Owner")}</th><th>${t("الاستحقاق", "Due Date")}</th><th>${t("الأولوية", "Priority")}</th><th>${t("الحالة", "Status")}</th>
      </tr></thead><tbody>
      ${d.tasks.map((x, i) => {
        const meta = (typeof taskStatusMeta === "function") ? taskStatusMeta(x.status) : null;
        const owner = (l === "ar" ? x.owner_name_ar : x.owner_name_en) || x.owner_name_ar || "";
        const prio = { high: { ar: "عالية", en: "High", cls: "tr" }, urgent: { ar: "عاجلة", en: "Urgent", cls: "tr" }, normal: { ar: "عادية", en: "Normal", cls: "tgr" }, medium: { ar: "متوسطة", en: "Medium", cls: "tgold" }, low: { ar: "منخفضة", en: "Low", cls: "tgr" } }[String(x.priority || "").toLowerCase()];
        return `<tr><td class="mx-num">${this._num("A", i)}</td>
          <td style="font-weight:600">${esc(this._text(x))}</td>
          <td style="white-space:nowrap">${owner ? `<div class="mx-person"><span class="mx-av">${esc(this._initials(owner))}</span><span class="mx-person-n">${esc(owner)}</span></div>` : "—"}</td>
          <td style="white-space:nowrap">${x.due_date ? fmtDate(x.due_date) : "—"}</td>
          <td>${prio ? `<span class="tag ${prio.cls}">${this.t(prio.ar, prio.en)}</span>` : "—"}</td>
          <td>${meta ? `<span class="tag ${meta.tagClass}">${l === "ar" ? meta.ar : meta.en}</span>` : esc(x.status || "")}</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
  },

  // ── Documents tab ─────────────────────────────────────────────
  _tabDocuments() {
    const d = this._d;
    const t = (ar, en) => this.t(ar, en);
    const canUpload = App.can("documents.upload");
    const uploadBtn = canUpload ? `<button class="btn-gold btn-sm" onclick="$('mtx-doc-file').click()">+ ${t("رفع مستند", "Upload Document")}</button>
      <input type="file" id="mtx-doc-file" style="display:none" accept=".pdf,.docx,.xlsx,.pptx,.txt" onchange="MT.uploadDoc(this)"/>` : "";
    if (!d.documents.length)
      return `<div class="mx-card"><div class="mx-card-t">📄 ${t("المستندات وحزمة المجلس", "Documents & Board Pack")}${uploadBtn}</div>
        <div class="mx-empty"><div class="ic">📄</div><div class="t">${t("لا توجد مستندات", "No documents")}</div><div class="s">${t("لم تُرفع مستندات لهذا الاجتماع بعد.", "No documents have been uploaded to this meeting yet.")}</div></div></div>`;
    return `<div class="mx-card"><div class="mx-card-t">📄 ${t("المستندات وحزمة المجلس", "Documents & Board Pack")} <span class="mt2-tab-n">${d.documents.length}</span>${uploadBtn}</div>
      ${d.documents.map((x) => `<div class="mx-docrow"><div class="mx-doc-ico">${this._docIco(x)}</div>
        <div style="flex:1;min-width:0"><div class="mx-doc-name">${esc(x.title)}</div>
          <div class="mx-doc-meta">${[this._fmtSize(x.file_size), x.doc_classification ? esc(x.doc_classification) : "", x.upload_date || x.created_at ? fmtDate(x.upload_date || x.created_at) : ""].filter(Boolean).join(" · ")}</div>
          ${x.ai_summary ? `<div style="font-size:11.5px;color:#697386;line-height:1.5;margin-top:3px">${esc(x.ai_summary)}</div>` : ""}</div>
        <a class="mx-doc-dl" href="/uploads/${encodeURIComponent(x.file_path)}" target="_blank" rel="noopener" title="${t("تنزيل", "Download")}">⬇</a></div>`).join("")}</div>`;
  },

  async uploadDoc(input) {
    if (!input.files || !input.files.length) return;
    const fd = new FormData();
    fd.append("file", input.files[0], input.files[0].name);
    try {
      const res = await fetch(`/api/meetings/${this._mid}/upload`, { method: "POST", credentials: "include", headers: authHeaders(), body: fd });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
      showToast(this.t("✓ تم رفع المستند", "✓ Document uploaded"));
      await this._refreshDetail();
    } catch (e) { showToast(this.t("تعذّر رفع المستند: ", "Could not upload document: ") + e.message, "error"); }
    input.value = "";
  },

  // ── Timeline tab ──────────────────────────────────────────────
  _tabTimeline() {
    const d = this._d;
    const t = (ar, en) => this.t(ar, en);
    if (!d.lifecycle.length && !(d.series_timeline || []).length)
      return `<div class="mx-card"><div class="mx-empty"><div class="ic">🕘</div><div class="t">${t("لا توجد أحداث", "No events")}</div><div class="s">${t("سيظهر هنا سجل أحداث الاجتماع.", "The meeting event log will appear here.")}</div></div></div>`;
    const lifecycle = `<div class="mx-card"><div class="mx-card-t">🕘 ${t("الجدول الزمني للاجتماع", "Meeting Timeline")}</div>
      <div class="mx-vtl">${d.lifecycle.map((e) => `<div class="mx-vtl-item"><div class="mx-vtl-dot"></div>
        <div class="mx-vtl-t">${esc(e.note || e.to_stage)}</div>
        ${e.actor_name ? `<div class="mx-vtl-s">${esc(e.actor_name)}</div>` : ""}
        <div class="mx-vtl-d">${this._fmtDT(e.created_at)}</div></div>`).join("")}</div></div>`;
    let series = "";
    if ((d.series_timeline || []).length) {
      const l = App.lang;
      series = `<div class="mx-card"><div class="mx-card-t">🧭 ${t("سلسلة الاجتماعات", "Meeting Series")}${d.series_stats ? ` <span class="mt2-tab-n">${d.series_stats.completed_meetings}/${d.series_stats.total_meetings}</span>` : ""}</div>
        <div class="mx-vtl">${d.series_timeline.map((s) => `<div class="mx-vtl-item ${s.kind === "planned" ? "pend" : ""}"><div class="mx-vtl-dot"></div>
          <div class="mx-vtl-t">${s.kind === "held" && s.id !== d.meeting.id ? `<button class="mx-link" onclick="MT.openDetail(${s.id})">${esc(this._title(s))}</button>` : esc(this._title(s))}${s.id === d.meeting.id ? ` <span class="tag tgold">${t("الحالي", "Current")}</span>` : ""}</div>
          <div class="mx-vtl-d">${fmtDate(s.meeting_date)} · ${s.kind === "held" ? t("منعقد", "Held") : t("مخطط", "Planned")}</div></div>`).join("")}</div></div>`;
    }
    return `<div class="mx-grid2">${lifecycle}${series || ""}</div>`;
  },

  // ── Approval tab ──────────────────────────────────────────────
  _tabApproval() {
    const d = this._d, m = d.meeting;
    const t = (ar, en) => this.t(ar, en);
    const ms = m.minutes_status || "draft";
    const chain = [
      { k: "draft", ar: "مسودة", en: "Draft" },
      { k: "circulated", ar: "التعميم والمراجعة", en: "Circulated" },
      { k: "approved", ar: "اعتماد الرئيس", en: "Chairman Approval" },
      { k: "final_approved", ar: "الاعتماد النهائي", en: "Final Approval" },
    ];
    const idx = Math.max(0, chain.findIndex((c) => c.k === ms));
    const steps = `<div class="mx-steps">${chain.map((c, i) => `<div class="mx-step ${i < idx ? "done" : i === idx ? "cur" : ""}">
      <div class="mx-step-dot">${i < idx ? "✓" : i + 1}</div><div class="mx-step-l">${t(c.ar, c.en)}</div>
      <div class="mx-step-s">${i === idx ? t("الحالة الحالية", "Current") : i < idx ? t("مكتمل", "Done") : t("قيد الانتظار", "Pending")}</div></div>`).join("")}</div>`;

    const canApprove = App.can("minutes.approve");
    const btns = [];
    if (canApprove && (ms === "draft" || ms === "circulated"))
      btns.push(`<button class="btn-gold" onclick="MT.approveMinutes(false)">✓ ${t("اعتماد المحضر", "Approve Minutes")}</button>`);
    if (canApprove && ms === "approved")
      btns.push(`<button class="btn-gold" onclick="MT.approveMinutes(true)">✓✓ ${t("الاعتماد النهائي", "Final Approve")}</button>`);

    const log = this._approvalLog || [];
    const actionLbl = (a) => ({
      circulated: t("تعميم المحضر", "Minutes circulated"),
      approved: t("اعتماد المحضر", "Minutes approved"),
      final_approved: t("الاعتماد النهائي", "Final approval"),
      rejected: t("إعادة للمراجعة", "Returned for review"),
    }[a] || a);
    const logCard = `<div class="mx-card"><div class="mx-card-t">${t("سجل الاعتماد", "Approval History")}</div>
      ${log.length ? `<div class="mx-vtl">${log.slice().reverse().map((e) => `<div class="mx-vtl-item"><div class="mx-vtl-dot"></div>
        <div class="mx-vtl-t">${esc(actionLbl(e.action))}</div>
        <div class="mx-vtl-s">${esc(e.actor_name || "")}${e.actor_role ? " · " + esc(e.actor_role) : ""}${e.comments ? `<div style="margin-top:2px">"${esc(e.comments)}"</div>` : ""}</div>
        <div class="mx-vtl-d">${this._fmtDT(e.created_at)}</div></div>`).join("")}</div>`
      : `<div style="font-size:12px;color:#98A2B3">${t("لا توجد إجراءات اعتماد مسجّلة بعد.", "No approval actions recorded yet.")}</div>`}</div>`;

    return `<div class="mx-card" style="margin-bottom:14px"><div class="mx-card-t">✅ ${t("مسار اعتماد المحضر", "Minutes Approval Workflow")}
        <div style="display:flex;gap:8px">${btns.join("")}</div></div>${steps}</div>${logCard}`;
  },

  async approveMinutes(isFinal) {
    const comments = prompt(this.t("تعليق (اختياري):", "Comment (optional):")) || "";
    try {
      await api(`/api/meetings/${this._mid}/${isFinal ? "final-approve" : "approve"}`, { method: "POST", body: JSON.stringify({ comments }) });
      showToast(this.t("✓ تم الاعتماد بنجاح", "✓ Approved successfully"));
      await this._refreshDetail();
    } catch (e) { showToast(this.t("تعذّر الاعتماد: ", "Could not approve: ") + e.message, "error"); }
  },

  // ═════════════════════════════════════════════════════════════
  //  CREATE MEETING PAGE (mockup 44444)
  // ═════════════════════════════════════════════════════════════
  _cs: null, // create state

  async _renderCreate(reset) {
    const box = $("mtx-create-view");
    if (!box) return;
    this._showView("create");
    if (reset || !this._cs) {
      this._cs = {
        agenda: [{ title: "", mins: 15 }],
        members: [],           // {name, role}
        files: [],             // File objects
        users: [], boards: [], committees: [], series: [],
        format: "inperson",
      };
      box.innerHTML = `<div class="es"><div class="loading"></div></div>`;
      // lookups — each optional, failures leave the select hidden
      const [users, boards, committees, series] = await Promise.all([
        api("/api/users").catch(() => []),
        api("/api/gov/boards").catch(() => []),
        api("/api/gov/committees").catch(() => []),
        api("/api/gov/meeting-series").catch(() => []),
      ]);
      this._cs.users = Array.isArray(users) ? users : [];
      this._cs.boards = Array.isArray(boards) ? boards : (boards.boards || []);
      this._cs.committees = Array.isArray(committees) ? committees : (committees.committees || []);
      this._cs.series = Array.isArray(series) ? series : (series.series || []);
    }
    this._paintCreate();
    this._createRendered = true;
  },

  _paintCreate() {
    const box = $("mtx-create-view");
    if (!box || !this._cs) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const cs = this._cs;
    const keep = (id) => { const el = $(id); return el ? el.value : ""; };
    const kept = {
      title: keep("mxc-title"), type: keep("mxc-type"), series: keep("mxc-series"),
      purpose: keep("mxc-purpose"), date: keep("mxc-date"), start: keep("mxc-start"),
      end: keep("mxc-end"), venue: keep("mxc-venue"), board: keep("mxc-board"),
      committee: keep("mxc-committee"), joinurl: keep("mxc-joinurl"), extra: keep("mxc-extra"),
    };

    const typeOpts = ["Board Meeting", "Committee Meeting", "Executive Meeting", "General Meeting", "Strategy Meeting", "Follow-up Meeting"];
    const typeLbl = { "Board Meeting": "اجتماع مجلس الإدارة", "Committee Meeting": "اجتماع اللجنة", "Executive Meeting": "الاجتماع التنفيذي", "General Meeting": "الاجتماع العام", "Strategy Meeting": "اجتماع الاستراتيجية", "Follow-up Meeting": "اجتماع المتابعة" };

    const canSchedule = App.can("calendar.manage");

    box.innerHTML = `
      <div class="mx-crumbs"><button class="mx-crumb" onclick="MT.showList()">${t("الاجتماعات", "Meetings")}</button><span>›</span><span class="mx-crumb-cur">${t("إنشاء اجتماع", "Create Meeting")}</span></div>
      <div class="mx-head">
        <div><div class="mx-head-title">${t("إنشاء اجتماع", "Create Meeting")}</div>
          <div class="mx-head-sub">${t("أدخل التفاصيل لجدولة اجتماع جديد.", "Fill in the details to schedule a new meeting.")}</div></div>
        <div class="mx-head-actions">
          <button class="btn-ghost" id="mxc-draft-btn" onclick="MT.submitCreate(true)">${t("حفظ كمسودة", "Save as Draft")}</button>
          ${canSchedule ? `<button class="btn-gold" id="mxc-submit-btn" onclick="MT.submitCreate(false)">📅 ${t("جدولة الاجتماع", "Schedule Meeting")}</button>` : ""}
        </div></div>

      <div class="mx-create-grid"><div>
        <div class="mx-card" style="margin-bottom:14px">
          <div class="mx-card-t"><span><span class="mx-fnum">1</span>${t("تفاصيل الاجتماع", "Meeting Details")}</span></div>
          <div class="mx-f2">
            <div class="mx-f"><label>${t("عنوان الاجتماع", "Meeting Title")} <span class="req">*</span></label>
              <input class="fi" id="mxc-title" style="width:100%" value="${esc(kept.title)}" placeholder="${t("مثال: اجتماع مجلس الإدارة الربع الثاني 2026", "e.g. Q2 2026 Board of Directors Meeting")}"/></div>
            <div class="mx-f"><label>${t("نوع الاجتماع", "Meeting Type")} <span class="req">*</span></label>
              <select class="fi" id="mxc-type" style="width:100%">${typeOpts.map((o) => `<option value="${o}" ${kept.type === o ? "selected" : ""}>${l === "ar" ? typeLbl[o] : o}</option>`).join("")}</select></div>
          </div>
          <div class="mx-f2">
            <div class="mx-f"><label>${t("المجلس", "Board")}</label>
              <select class="fi" id="mxc-board" style="width:100%"><option value="">—</option>${cs.boards.map((b) => `<option value="${b.id}" ${kept.board == b.id ? "selected" : ""}>${esc(l === "ar" ? b.name_ar : b.name_en || b.name_ar)}</option>`).join("")}</select></div>
            <div class="mx-f"><label>${t("اللجنة", "Committee")}</label>
              <select class="fi" id="mxc-committee" style="width:100%"><option value="">—</option>${cs.committees.map((c) => `<option value="${c.id}" ${kept.committee == c.id ? "selected" : ""}>${esc(l === "ar" ? c.name_ar : c.name_en || c.name_ar)}</option>`).join("")}</select></div>
          </div>
          <div class="mx-f2">
            <div class="mx-f"><label>${t("سلسلة الاجتماعات (اختياري)", "Meeting Series (Optional)")}</label>
              <select class="fi" id="mxc-series" style="width:100%"><option value="">${t("اجتماع مستقل", "Standalone meeting")}</option>${cs.series.map((s) => `<option value="${s.id}" ${kept.series == s.id ? "selected" : ""}>${esc(l === "ar" ? s.name_ar : s.name_en || s.name_ar)}</option>`).join("")}</select></div>
            <div class="mx-f"><label>${t("الغرض / الوصف", "Purpose / Description")}</label>
              <input class="fi" id="mxc-purpose" style="width:100%" value="${esc(kept.purpose)}" placeholder="${t("وصف موجز لأهداف الاجتماع...", "Brief description of the meeting goals...")}"/></div>
          </div>
          <div class="mx-f2">
            <div class="mx-f"><label>${t("التاريخ", "Date")} <span class="req">*</span></label><input class="fi" type="date" id="mxc-date" style="width:100%" value="${esc(kept.date)}"/></div>
            <div class="mx-f"><div class="mx-f2" style="gap:10px"><div><label>${t("وقت البدء", "Start Time")} <span class="req">*</span></label><input class="fi" type="time" id="mxc-start" style="width:100%" value="${esc(kept.start)}"/></div>
              <div><label>${t("وقت الانتهاء", "End Time")}</label><input class="fi" type="time" id="mxc-end" style="width:100%" value="${esc(kept.end)}"/></div></div></div>
          </div>
          <div class="mx-f2">
            <div class="mx-f"><label>${t("صيغة الاجتماع", "Meeting Format")}</label>
              <div style="display:flex;gap:8px">
                <button class="${cs.format === "inperson" ? "btn-gold" : "btn-ghost"} btn-sm" style="flex:1" onclick="MT._cs.format='inperson';MT._paintCreate()">👥 ${t("حضوري", "In-Person")}</button>
                <button class="${cs.format === "virtual" ? "btn-gold" : "btn-ghost"} btn-sm" style="flex:1" onclick="MT._cs.format='virtual';MT._paintCreate()">🎥 ${t("افتراضي", "Virtual")}</button>
              </div></div>
            ${cs.format === "inperson"
              ? `<div class="mx-f"><label>${t("الموقع / القاعة", "Location / Venue")} <span class="req">*</span></label><input class="fi" id="mxc-venue" style="width:100%" value="${esc(kept.venue)}" placeholder="${t("قاعة الاجتماعات الرئيسية", "Main Boardroom")}"/></div>`
              : `<div class="mx-f"><label>${t("رابط الانضمام", "Join URL")}</label><input class="fi" id="mxc-joinurl" style="width:100%" value="${esc(kept.joinurl)}" placeholder="https://..."/></div>`}
          </div>
        </div>

        <div class="mx-card" style="margin-bottom:14px">
          <div class="mx-card-t"><span><span class="mx-fnum">2</span>${t("المشاركون", "Participants")}</span>
            ${cs.members.length ? `<span style="font-size:11.5px;font-weight:700;color:#A8842C">${cs.members.length} ${t("عضو", "Members")}</span>` : ""}</div>
          <div class="mx-f"><label>${t("إضافة أعضاء", "Add Members")}</label>
            <div>${cs.members.map((mm, i) => `<span class="mx-chip"><span class="mx-av">${esc(this._initials(mm.name))}</span>${esc(mm.name)}<button class="x" onclick="MT._cs.members.splice(${i},1);MT._paintCreate()">✕</button></span>`).join("")}</div>
            <div style="display:flex;gap:8px;margin-top:6px">
              <select class="fi" id="mxc-member-sel" style="flex:1">
                <option value="">${t("اختر عضواً...", "Select a member...")}</option>
                ${cs.users.filter((u) => !cs.members.some((mm) => mm.name === ((l === "ar" ? u.name_ar : u.name_en) || u.name_ar))).map((u) => `<option value="${esc((l === "ar" ? u.name_ar : u.name_en) || u.name_ar || "")}">${esc((l === "ar" ? u.name_ar : u.name_en) || u.name_ar || "")}</option>`).join("")}
              </select>
              <button class="btn-ghost btn-sm" onclick="MT.addMember()">+ ${t("إضافة", "Add")}</button></div></div>
          <div class="mx-f" style="margin-bottom:0"><label>${t("مشاركون إضافيون (اختياري)", "Additional Attendees (Optional)")}</label>
            <input class="fi" id="mxc-extra" style="width:100%" value="${esc(kept.extra)}" placeholder="${t("أسماء مفصولة بفواصل...", "Comma-separated names...")}"/></div>
        </div>

        <div class="mx-card">
          <div class="mx-card-t"><span><span class="mx-fnum">3</span>${t("جدول الأعمال", "Agenda")}</span>
            <button class="btn-ghost btn-sm" onclick="MT.addAgendaRow()">+ ${t("إضافة بند", "Add Agenda Item")}</button></div>
          ${cs.agenda.map((a, i) => `<div class="mx-agrow">
            <span class="grip">⋮⋮</span><span class="n">${i + 1}</span>
            <input class="fi" value="${esc(a.title)}" placeholder="${t("عنوان البند...", "Agenda item title...")}" oninput="MT._cs.agenda[${i}].title=this.value"/>
            <input class="fi mins" type="number" min="5" step="5" value="${a.mins}" oninput="MT._cs.agenda[${i}].mins=parseInt(this.value)||15" title="${t("الدقائق", "Minutes")}"/>
            <button class="del" onclick="MT._cs.agenda.splice(${i},1);MT._paintCreate()" ${cs.agenda.length === 1 ? "disabled" : ""}>🗑</button></div>`).join("")}
        </div>
      </div>

      <div>
        <div class="mx-card" style="margin-bottom:14px">
          <div class="mx-card-t"><span><span class="mx-fnum">4</span>${t("المستندات وحزمة المجلس", "Documents & Board Pack")}</span></div>
          <div style="font-size:11.5px;color:#697386;margin-bottom:10px">${t("أضف المستندات التي ستُدرج في حزمة الاجتماع.", "Add documents to include in the meeting package.")}</div>
          <div class="mx-drop" onclick="$('mxc-files').click()">⬆<br/>${t("انقر لاختيار الملفات", "Click to browse files")}<br/><span style="font-size:10.5px;font-weight:500">PDF · DOCX · XLSX · PPTX · TXT</span></div>
          <input type="file" id="mxc-files" multiple style="display:none" accept=".pdf,.docx,.xlsx,.pptx,.txt" onchange="MT.addFiles(this)"/>
          ${cs.files.map((f, i) => `<div class="mx-docrow"><div class="mx-doc-ico">${this._docIco({ file_path: f.name })}</div>
            <div style="flex:1;min-width:0"><div class="mx-doc-name">${esc(f.name)}</div><div class="mx-doc-meta">${this._fmtSize(f.size)}</div></div>
            <button class="del" style="background:none;border:none;color:#98A2B3;cursor:pointer" onclick="MT._cs.files.splice(${i},1);MT._paintCreate()">✕</button></div>`).join("")}
        </div>

        <div class="mx-card"><div class="mx-card-t">${t("معاينة الاجتماع", "Meeting Preview")}</div>
          <div id="mxc-preview">${this._createPreviewHtml()}</div>
        </div>
      </div></div>`;

    // live preview updates
    ["mxc-title", "mxc-date", "mxc-start", "mxc-end", "mxc-venue", "mxc-joinurl", "mxc-extra"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", () => { const p = $("mxc-preview"); if (p) p.innerHTML = this._createPreviewHtml(); });
    });
  },

  _createPreviewHtml() {
    const t = (ar, en) => this.t(ar, en);
    const v = (id) => { const el = $(id); return el ? el.value : ""; };
    const cs = this._cs;
    const extraN = (v("mxc-extra") || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean).length;
    const rows = [
      ["🗓", v("mxc-date") ? fmtDate(v("mxc-date")) : t("لم يُحدَّد التاريخ", "Date not set")],
      ["🕐", v("mxc-start") ? `${v("mxc-start")}${v("mxc-end") ? " – " + v("mxc-end") : ""}` : t("لم يُحدَّد الوقت", "Time not set")],
      ["📍", cs.format === "virtual" ? (v("mxc-joinurl") || t("اجتماع افتراضي", "Virtual meeting")) : (v("mxc-venue") || t("لم يُحدَّد المكان", "Venue not set"))],
      ["👥", `${cs.members.length} ${t("عضو", "Members")}${extraN ? t(`، ${extraN} مشارك إضافي`, `, ${extraN} Additional Attendees`) : ""}`],
      ["🗒", `${cs.agenda.filter((a) => a.title.trim()).length} ${t("بند في جدول الأعمال", "Agenda items")}`],
    ];
    return rows.map((r) => `<div class="mx-statrow"><span class="k">${r[0]}</span><span class="v" style="font-weight:600;text-align:end">${esc(String(r[1]))}</span></div>`).join("");
  },

  addMember() {
    const sel = $("mxc-member-sel");
    if (!sel || !sel.value) return;
    this._cs.members.push({ name: sel.value });
    this._paintCreate();
  },
  addAgendaRow() {
    this._cs.agenda.push({ title: "", mins: 15 });
    this._paintCreate();
  },
  addFiles(input) {
    Array.from(input.files || []).forEach((f) => this._cs.files.push(f));
    input.value = "";
    this._paintCreate();
  },

  async submitCreate(isDraft) {
    const t = (ar, en) => this.t(ar, en);
    const v = (id) => { const el = $(id); return el ? el.value.trim() : ""; };
    const cs = this._cs;
    const title = v("mxc-title");
    if (!title) return showToast(t("الرجاء إدخال عنوان الاجتماع", "Please enter a meeting title"), "error");
    const date = v("mxc-date");
    if (!date) return showToast(t("الرجاء تحديد التاريخ", "Please set the date"), "error");
    const start = v("mxc-start");
    if (!start) return showToast(t("الرجاء تحديد وقت البدء", "Please set the start time"), "error");
    if (!isDraft && cs.format === "inperson" && !v("mxc-venue")) return showToast(t("الرجاء تحديد الموقع / القاعة", "Please set the location / venue"), "error");

    const end = v("mxc-end");
    let durationMins = 60;
    if (end) {
      const [sh, sm] = start.split(":").map(Number), [eh, em] = end.split(":").map(Number);
      durationMins = (eh * 60 + em) - (sh * 60 + sm);
      if (durationMins <= 0) durationMins += 24 * 60;
    }
    const platform = cs.format === "virtual" ? (v("mxc-joinurl") ? t("اجتماع افتراضي", "Virtual") : t("اجتماع افتراضي", "Virtual")) : (v("mxc-venue") || "قاعة الاجتماعات");
    const agendaItems = cs.agenda.filter((a) => a.title.trim()).map((a, i) => ({ title_ar: a.title.trim(), title_en: a.title.trim(), duration_mins: a.mins || 15, sort_order: i }));
    const extraNames = (v("mxc-extra") || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const allAttendees = [...cs.members.map((m) => m.name), ...extraNames];

    const draftBtn = $("mxc-draft-btn"), subBtn = $("mxc-submit-btn");
    [draftBtn, subBtn].forEach((b) => { if (b) b.disabled = true; });
    try {
      const meeting = await api("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          title_ar: title, title_en: title,
          meeting_type: v("mxc-type"),
          board_id: parseInt(v("mxc-board")) || null,
          committee_id: parseInt(v("mxc-committee")) || null,
          series_id: parseInt(v("mxc-series")) || null,
          meeting_date: `${date} ${start}:00`,
          platform,
          purpose_ar: v("mxc-purpose"), purpose_en: v("mxc-purpose"),
        }),
      });

      if (agendaItems.length)
        await api(`/api/meetings/${meeting.id}/agenda`, { method: "POST", body: JSON.stringify({ agenda: agendaItems }) });

      for (const f of cs.files) {
        try {
          const fd = new FormData();
          fd.append("file", f, f.name);
          await fetch(`/api/meetings/${meeting.id}/upload`, { method: "POST", credentials: "include", headers: authHeaders(), body: fd });
        } catch (_) { /* one failed attachment shouldn't abort creation */ }
      }

      if (allAttendees.length)
        await api(`/api/meetings/${meeting.id}/attendees`, { method: "POST", body: JSON.stringify({ attendees: allAttendees.map((name) => ({ name })) }) });

      if (!isDraft && App.can("calendar.manage")) {
        const schedRes = await fetch("/api/schedule", {
          method: "POST", credentials: "include",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            title_ar: title, title_en: title, meeting_date: date, meeting_time: start,
            duration_mins: durationMins, platform, attendees: allAttendees.join(", "),
            agenda_ar: agendaItems.map((a) => a.title_ar).join("\n"),
            agenda_en: agendaItems.map((a) => a.title_en).join("\n"),
            meeting_type: v("mxc-type"),
            board_id: parseInt(v("mxc-board")) || null,
            committee_id: parseInt(v("mxc-committee")) || null,
            series_id: meeting.series_id || null,
            meeting_provider: cs.format === "virtual" ? "virtual" : "physical",
            meeting_join_url: cs.format === "virtual" ? v("mxc-joinurl") : "",
            source_meeting_id: meeting.id,
          }),
        });
        if (schedRes.status === 409) {
          const j = await schedRes.json().catch(() => ({}));
          const list = (j.conflicts || []).map((c) => `• ${App.lang === "ar" ? c.title_ar : c.title_en || c.title_ar} — ${(c.meeting_date || "").substring(0, 10)} ${c.meeting_time || ""}`).join("\n");
          if (confirm(t("يتعارض هذا الموعد مع اجتماع مؤكَّد:\n\n", "This time overlaps a confirmed meeting:\n\n") + list + t("\n\nهل تريد الحفظ رغم التعارض؟", "\n\nSave anyway?"))) {
            const retry = await fetch("/api/schedule", {
              method: "POST", credentials: "include",
              headers: authHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({
                title_ar: title, title_en: title, meeting_date: date, meeting_time: start,
                duration_mins: durationMins, platform, attendees: allAttendees.join(", "),
                meeting_type: v("mxc-type"), source_meeting_id: meeting.id, force: true,
              }),
            });
            if (!retry.ok) { const jj = await retry.json().catch(() => ({})); throw new Error(jj.error || `HTTP ${retry.status}`); }
          }
        } else if (!schedRes.ok) {
          const j = await schedRes.json().catch(() => ({}));
          throw new Error(j.message || j.error || `HTTP ${schedRes.status}`);
        }
      }

      showToast(isDraft ? t("✓ تم حفظ الاجتماع كمسودة", "✓ Meeting saved as draft") : t("✓ تم إنشاء الاجتماع وجدولته", "✓ Meeting created and scheduled"));
      this._cs = null;
      this._createRendered = false;
      this.showList();
    } catch (e) {
      showToast(t("تعذّر إنشاء الاجتماع: ", "Could not create meeting: ") + e.message, "error");
    } finally {
      [draftBtn, subBtn].forEach((b) => { if (b) b.disabled = false; });
    }
  },

  // ═════════════════════════════════════════════════════════════
  //  POLICIES & RESOLUTIONS PANELS
  // ═════════════════════════════════════════════════════════════
  // ── Policies ─────────────────────────────────────────────────────────────────

  _polFilter: { q: "", status: "", category: "" },
  _polAll: [],

  async renderPolicies() {
    const box = $("policies-body");
    if (!box) return;
    const t = (ar, en) => this.t(ar, en);
    box.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    try {
      this._polAll = await api("/api/gov/policies");
    } catch (e) {
      box.innerHTML = `<div class="mx-card"><div class="mx-empty"><div class="ic">⚠️</div><div class="t">${t("تعذّر تحميل السياسات","Could not load policies")}</div><div class="s">${esc(e.message)}</div></div></div>`;
      return;
    }
    this._paintPolicies();
  },

  setPolFilter(k, v) { this._polFilter[k] = v; this._paintPolicies(); },

  _paintPolicies() {
    const box = $("policies-body");
    if (!box) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const all = this._polAll || [];
    const f = this._polFilter;
    const list = all.filter(p =>
      (!f.q || p.title_ar.includes(f.q) || p.title_en.toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.status || p.status === f.status) &&
      (!f.category || p.category === f.category)
    );
    const categories = [...new Set(all.map(p => p.category).filter(Boolean))];
    const statusMeta = {
      draft:      { ar: "مسودة",       en: "Draft",       color: "#9CA3AF" },
      review:     { ar: "تحت المراجعة",en: "Under Review", color: "#F59E0B" },
      published:  { ar: "معتمد",       en: "Published",   color: "#10B981" },
      archived:   { ar: "مؤرشف",       en: "Archived",    color: "#6B7280" },
    };
    const badge = s => { const m = statusMeta[s] || statusMeta.draft; return `<span style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}44;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">${l==="ar"?m.ar:m.en}</span>`; };

    box.innerHTML = `
      <div class="mx-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div class="mx-card-t" style="margin:0">📑 ${t("سجل السياسات","Policy Register")} <span class="mt2-tab-n">${all.length}</span></div>
          <button class="btn-gold btn-sm" onclick="MT.openPolicyModal()">+ ${t("سياسة جديدة","New Policy")}</button>
        </div>
        <div class="mx-filterbar">
          <input class="fi" style="flex:1;min-width:160px" placeholder="${t("بحث في السياسات...","Search policies...")}" value="${esc(f.q)}"
            oninput="MT._polFilter.q=this.value" onkeydown="if(event.key==='Enter')MT._paintPolicies()" onchange="MT._paintPolicies()"/>
          <select class="fi" style="max-width:150px" onchange="MT.setPolFilter('status',this.value)">
            <option value="">${t("كل الحالات","All Statuses")}</option>
            ${Object.entries(statusMeta).map(([k,v])=>`<option value="${k}" ${f.status===k?"selected":""}>${l==="ar"?v.ar:v.en}</option>`).join("")}
          </select>
          <select class="fi" style="max-width:150px" onchange="MT.setPolFilter('category',this.value)">
            <option value="">${t("كل الفئات","All Categories")}</option>
            ${categories.map(c=>`<option value="${esc(c)}" ${f.category===c?"selected":""}>${esc(c)}</option>`).join("")}
          </select>
          <button class="btn-ghost btn-sm" onclick="MT.renderPolicies()">↺</button>
        </div>
        ${!list.length ? `<div class="mx-empty" style="padding:32px 0"><div class="ic">📑</div>
          <div class="t">${all.length ? t("لا توجد نتائج مطابقة","No matching results") : t("لا توجد سياسات بعد","No policies yet")}</div>
          <div class="s">${t("أضف سياسات الحوكمة والإجراءات المؤسسية هنا.","Add governance policies and institutional procedures here.")}</div>
          <button class="btn-gold btn-sm" onclick="MT.openPolicyModal()">+ ${t("إضافة أول سياسة","Add First Policy")}</button>
        </div>` : `
        <div style="overflow-x:auto"><table class="mx-table"><thead><tr>
          <th>#</th><th>${t("العنوان","Title")}</th><th>${t("الفئة","Category")}</th>
          <th>${t("الإصدار","Version")}</th><th>${t("المالك","Owner")}</th>
          <th>${t("تاريخ السريان","Effective Date")}</th><th>${t("الحالة","Status")}</th><th></th>
        </tr></thead><tbody>
        ${list.map((p,i)=>`<tr>
          <td class="mx-num">${i+1}</td>
          <td><div style="font-weight:700;color:var(--text)">${esc(l==="ar"?p.title_ar:p.title_en)}</div>${p.description_en||p.description_ar?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(l==="ar"?(p.description_ar||p.description_en).slice(0,60):(p.description_en||p.description_ar).slice(0,60))}${((l==="ar"?p.description_ar:p.description_en)||"").length>60?"…":""}</div>`:""}</td>
          <td style="font-size:12px">${esc(p.category||"—")}</td>
          <td style="font-size:12px;font-variant-numeric:tabular-nums">${esc(p.version||"1.0")}</td>
          <td style="font-size:12px">${esc(p.owner||"—")}</td>
          <td style="font-size:12px;white-space:nowrap">${p.effective_date?fmtDate(p.effective_date):"—"}</td>
          <td>${badge(p.status)}</td>
          <td style="white-space:nowrap">
            <button class="btn-ghost btn-sm" style="padding:3px 8px" onclick="MT.openPolicyModal(${p.id})">✎</button>
            <button class="btn-ghost btn-sm" style="padding:3px 8px;color:var(--red)" onclick="MT.deletePolicy(${p.id})">🗑</button>
          </td>
        </tr>`).join("")}
        </tbody></table></div>
        <div style="font-size:11px;color:#98A2B3;margin-top:8px">${t(`عرض ${list.length} من ${all.length} سياسة`,`Showing ${list.length} of ${all.length} policies`)}</div>`}
      </div>`;
  },

  openPolicyModal(id) {
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const p = id ? (this._polAll||[]).find(x=>x.id===id) : null;
    const modal = document.createElement("div");
    modal.className = "modal-overlay open";
    modal.id = "pol-modal";
    modal.onclick = e => { if (e.target === modal) MT.closePolicyModal(); };
    modal.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-title">${p ? t("تعديل السياسة","Edit Policy") : t("سياسة جديدة","New Policy")}</div>
        <div class="fs">
          <div class="fr2">
            <div class="frow"><div class="fl">${t("العنوان (عربي)","Title (Arabic)")}</div><input class="fi" id="pol-tar" value="${esc(p?.title_ar||"")}" placeholder="${t("عنوان السياسة بالعربية","Arabic title")}"></div>
            <div class="frow"><div class="fl">${t("العنوان (إنجليزي)","Title (English)")}</div><input class="fi" id="pol-ten" dir="ltr" style="text-align:left" value="${esc(p?.title_en||"")}" placeholder="Policy title in English"></div>
          </div>
          <div class="frow"><div class="fl">${t("الوصف (إنجليزي)","Description (English)")}</div><textarea class="fi" id="pol-den" dir="ltr" style="text-align:left;min-height:60px" placeholder="Brief description...">${esc(p?.description_en||"")}</textarea></div>
          <div class="frow"><div class="fl">${t("الوصف (عربي)","Description (Arabic)")}</div><textarea class="fi" id="pol-dar" style="min-height:60px" placeholder="وصف مختصر...">${esc(p?.description_ar||"")}</textarea></div>
          <div class="fr2">
            <div class="frow"><div class="fl">${t("الفئة","Category")}</div>
              <select class="fi" id="pol-cat">
                ${["governance","hr","finance","operations","compliance","it","other"].map(c=>`<option value="${c}" ${(p?.category||"governance")===c?"selected":""}>${c}</option>`).join("")}
              </select>
            </div>
            <div class="frow"><div class="fl">${t("الحالة","Status")}</div>
              <select class="fi" id="pol-st">
                ${[["draft","مسودة / Draft"],["review","تحت المراجعة / Under Review"],["published","معتمد / Published"],["archived","مؤرشف / Archived"]].map(([v,lbl])=>`<option value="${v}" ${(p?.status||"draft")===v?"selected":""}>${lbl}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="fr2">
            <div class="frow"><div class="fl">${t("رقم الإصدار","Version")}</div><input class="fi" id="pol-ver" value="${esc(p?.version||"1.0")}" placeholder="1.0"></div>
            <div class="frow"><div class="fl">${t("تاريخ السريان","Effective Date")}</div><input class="fi" type="date" id="pol-eff" value="${esc(p?.effective_date||"")}"></div>
          </div>
          <div class="fr2">
            <div class="frow"><div class="fl">${t("المالك","Owner")}</div><input class="fi" id="pol-own" value="${esc(p?.owner||"")}" placeholder="${t("مسؤول السياسة","Policy owner")}"></div>
            <div class="frow"><div class="fl">${t("معتمد من","Approved By")}</div><input class="fi" id="pol-appr" value="${esc(p?.approved_by||"")}" placeholder="${t("اسم المعتمد","Approver name")}"></div>
          </div>
          <div class="fa">
            <button class="btn-gold" onclick="MT.savePolicy(${id||0})">✓ ${t("حفظ","Save")}</button>
            <button class="btn-ghost" onclick="MT.closePolicyModal()">${t("إلغاء","Cancel")}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  },

  closePolicyModal() { const m = $("pol-modal"); if (m) m.remove(); },

  async savePolicy(id) {
    const t = (ar, en) => this.t(ar, en);
    const payload = {
      title_ar: $("pol-tar").value.trim(),
      title_en: $("pol-ten").value.trim(),
      description_ar: $("pol-dar").value.trim(),
      description_en: $("pol-den").value.trim(),
      category: $("pol-cat").value,
      status: $("pol-st").value,
      version: $("pol-ver").value.trim() || "1.0",
      effective_date: $("pol-eff").value || null,
      owner: $("pol-own").value.trim(),
      approved_by: $("pol-appr").value.trim(),
    };
    if (!payload.title_ar || !payload.title_en) { showToast(t("يرجى إدخال العنوان بالعربية والإنجليزية","Please enter both Arabic and English titles"), "error"); return; }
    try {
      if (id) await api(`/api/gov/policies/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/api/gov/policies", { method: "POST", body: JSON.stringify(payload) });
      showToast(t("تم الحفظ بنجاح","Saved successfully"), "success");
      this.closePolicyModal();
      await this.renderPolicies();
    } catch (e) { showToast(e.message, "error"); }
  },

  async deletePolicy(id) {
    const t = (ar, en) => this.t(ar, en);
    if (!confirm(t("هل أنت متأكد من حذف هذه السياسة؟","Delete this policy?"))) return;
    try {
      await api(`/api/gov/policies/${id}`, { method: "DELETE" });
      showToast(t("تم الحذف","Deleted"), "success");
      await this.renderPolicies();
    } catch (e) { showToast(e.message, "error"); }
  },

  // ── Resolutions ───────────────────────────────────────────────────────────────

  _resFilter: { q: "", status: "" },

  async renderResolutions() {
    const box = $("resolutions-body");
    if (!box) return;
    const t = (ar, en) => this.t(ar, en);
    box.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    let govRes = [], meetingDec = [];
    try {
      [govRes, meetingDec] = await Promise.all([
        api("/api/gov/resolutions").catch(() => []),
        api("/api/decisions").catch(() => []),
      ]);
    } catch (e) {
      box.innerHTML = `<div class="mx-card"><div class="mx-empty"><div class="ic">⚠️</div><div class="t">${t("تعذّر تحميل القرارات","Could not load resolutions")}</div></div></div>`;
      return;
    }
    const govIds = new Set(govRes.map(r => r.id));
    const decFiltered = meetingDec.filter(d => !govIds.has(d.id));
    this._resAll = [...govRes, ...decFiltered];
    this._paintResolutions();
  },

  openResolutionModal(id) {
    const t = (ar, en) => this.t(ar, en);
    const r = id ? (this._resAll||[]).find(x=>x.id===id) : null;
    const year = new Date().getFullYear();
    const nextNum = String((this._resAll||[]).filter(x=>!x.meeting_id).length + 1).padStart(3,"0");
    const autoRef = `RES-${year}-${nextNum}`;
    const modal = document.createElement("div");
    modal.className = "modal-overlay open";
    modal.id = "res-modal";
    modal.onclick = e => { if (e.target === modal) MT.closeResolutionModal(); };
    modal.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-title">${r ? t("تعديل القرار","Edit Resolution") : t("قرار جديد","New Resolution")}</div>
        <div class="fs">
          <div class="frow">
            <div class="fl">${t("رقم المرجع","Reference Number")}</div>
            <input class="fi" id="res-ref" value="${esc(r?.title?.match(/RES-\d+/)?.[0] || autoRef)}" placeholder="${autoRef}" style="font-variant-numeric:tabular-nums;font-weight:700">
          </div>
          <div class="frow"><div class="fl">${t("عنوان القرار (عربي)","Resolution Title (Arabic)")}</div><input class="fi" id="res-tar" value="${esc(r?.title_ar||"")}"></div>
          <div class="frow"><div class="fl">${t("عنوان القرار (إنجليزي)","Resolution Title (English)")}</div><input class="fi" id="res-ten" dir="ltr" style="text-align:left" value="${esc(r?.title_en||r?.title||"")}"></div>
          <div class="frow"><div class="fl">${t("الوصف","Description")}</div><textarea class="fi" id="res-desc" style="min-height:64px" dir="ltr" style="text-align:left">${esc(r?.description||r?.description_en||"")}</textarea></div>
          <div class="frow"><div class="fl">${t("الحالة","Status")}</div>
            <select class="fi" id="res-st">
              ${[["pending","قيد الانتظار / Pending"],["approved","معتمد / Approved"],["rejected","مرفوض / Rejected"],["implemented","منفّذ / Implemented"]].map(([v,lbl])=>`<option value="${v}" ${(r?.status||"pending")===v?"selected":""}>${lbl}</option>`).join("")}
            </select>
          </div>
          <div class="fa">
            <button class="btn-gold" onclick="MT.saveResolution(${id||0})">✓ ${t("حفظ","Save")}</button>
            <button class="btn-ghost" onclick="MT.closeResolutionModal()">${t("إلغاء","Cancel")}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  },

  closeResolutionModal() { const m = $("res-modal"); if (m) m.remove(); },

  async saveResolution(id) {
    const t = (ar, en) => this.t(ar, en);
    const ref = $("res-ref").value.trim();
    const title_ar = $("res-tar").value.trim();
    const title_en = $("res-ten").value.trim();
    const description = $("res-desc").value.trim();
    const status = $("res-st").value;
    if (!title_ar && !title_en) { showToast(t("يرجى إدخال عنوان القرار","Please enter a resolution title"), "error"); return; }
    const title = ref ? `${ref}: ${title_en || title_ar}` : (title_en || title_ar);
    const payload = { title, title_ar, title_en, description, status };
    try {
      if (id) await api(`/api/gov/resolutions/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/api/gov/resolutions", { method: "POST", body: JSON.stringify(payload) });
      showToast(t("تم حفظ القرار","Resolution saved"), "success");
      this.closeResolutionModal();
      await this.renderResolutions();
    } catch (e) { showToast(e.message, "error"); }
  },

  setResFilter(k, v) { this._resFilter[k] = v; this._paintResolutions(); },

  _paintResolutions() {
    const box = $("resolutions-body");
    if (!box) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const all = this._resAll || [];
    const f = this._resFilter;
    const list = all.filter((x) =>
      (!f.q || (x.title_ar||x.text_ar||"").includes(f.q) || (x.title_en||x.text_en||x.title||"").toLowerCase().includes(f.q.toLowerCase()) || (x.meeting_title_ar||"").includes(f.q)) &&
      (!f.status || String(x.status||"").toLowerCase() === f.status));
    const statuses = [...new Set(all.map((x) => String(x.status||"").toLowerCase()).filter(Boolean))];

    const bar = `<div class="mx-filterbar">
      <input class="fi" style="flex:1;min-width:170px" placeholder="${t("بحث في القرارات...","Search resolutions...")}" value="${esc(f.q)}"
        oninput="MT._resFilter.q=this.value" onkeydown="if(event.key==='Enter')MT._paintResolutions()" onchange="MT._paintResolutions()"/>
      <select class="fi" style="max-width:160px" onchange="MT.setResFilter('status',this.value)">
        <option value="">${t("كل الحالات","All Statuses")}</option>
        ${statuses.map((s) => `<option value="${esc(s)}" ${f.status===s?"selected":""}>${esc(s)}</option>`).join("")}
      </select>
      <button class="btn-ghost btn-sm" onclick="MT.renderResolutions()">↺</button>
      <button class="btn-gold btn-sm" onclick="MT.openResolutionModal()">+ ${t("قرار جديد","New Resolution")}</button></div>`;

    if (!all.length) {
      box.innerHTML = `<div class="mx-card"><div class="mx-empty"><div class="ic">✅</div>
        <div class="t">${t("لا توجد قرارات بعد","No resolutions yet")}</div>
        <div class="s">${t("تُستخرج القرارات تلقائياً من اجتماعاتك، أو يمكنك إضافة قرار يدوياً.","Resolutions are extracted automatically from meetings, or you can add one manually.")}</div>
        <button class="btn-gold btn-sm" onclick="MT.openResolutionModal()">+ ${t("إضافة قرار","Add Resolution")}</button>
      </div></div>`;
      return;
    }

    box.innerHTML = `<div class="mx-card">
      <div class="mx-card-t">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-inline-end:6px"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
        ${t("سجل القرارات","Resolutions Register")} <span class="mt2-tab-n">${all.length}</span>
      </div>
      ${bar}
      <div style="overflow-x:auto"><table class="mx-table"><thead><tr>
        <th>#</th><th>${t("المرجع","Ref")}</th><th>${t("القرار","Resolution")}</th>
        <th>${t("الاجتماع","Meeting")}</th><th>${t("التاريخ","Date")}</th>
        <th>${t("الحالة","Status")}</th><th></th>
      </tr></thead><tbody>
      ${list.map((x, idx) => {
        const titleText = l === "ar"
          ? (x.title_ar || x.text_ar || x.title || "")
          : (x.title_en || x.text_en || x.title || "");
        const mtTitle = l === "ar"
          ? (x.meeting_title_ar || x.sched_title_ar || x.meeting_title_en || "")
          : (x.meeting_title_en || x.sched_title_en || x.meeting_title_ar || "");
        const refMatch = (x.title || "").match(/^(RES-[^:]+):/);
        const refStr = refMatch ? refMatch[1] : (x.meeting_id ? "—" : `RES-${new Date(x.created_at).getFullYear()}-${String(idx+1).padStart(3,"0")}`);
        const voteStatus = x.voting_status || 'draft';
        const vApprove = x.votes_approve || 0;
        const vReject  = x.votes_reject  || 0;
        const vAbstain = x.votes_abstain || 0;
        const vTotal   = vApprove + vReject + vAbstain;
        const voteBadge = voteStatus === 'open'
          ? `<span class="tag" style="background:rgba(46,204,138,.15);color:#2ecc8a;font-size:10px;border:1px solid rgba(46,204,138,.3)">🔵 ${t("تصويت مفتوح","Open")}</span>`
          : voteStatus === 'closed'
            ? `<span class="tag" style="background:rgba(180,180,180,.1);color:var(--text3);font-size:10px">🔒 ${t("مغلق","Closed")}</span>`
            : '';
        const tallyHtml = vTotal > 0
          ? `<div style="display:flex;gap:3px;align-items:center;font-size:10px;margin-top:2px">
              <span style="color:#2ecc8a">✅${vApprove}</span>
              <span style="color:#e05252">✗${vReject}</span>
              <span style="color:var(--text3)">◌${vAbstain}</span>
             </div>` : '';
        return `<tr class="${x.meeting_id ? "mx-row-click" : ""}" ${x.meeting_id ? `onclick="MT.openDetail(${x.meeting_id},'decisions')"` : ""}>
          <td class="mx-num">${idx+1}</td>
          <td style="font-size:11px;font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums;white-space:nowrap">${esc(refStr)}</td>
          <td style="font-weight:600">${esc(titleText)}</td>
          <td>${mtTitle ? `<span class="mx-link">${esc(mtTitle)}</span>` : "—"}</td>
          <td style="white-space:nowrap">${fmtDate(x.created_at)}</td>
          <td>${this._decBadge(x.status)}${voteBadge}${tallyHtml}</td>
          <td style="white-space:nowrap;display:flex;gap:4px;align-items:center">
            ${!x.meeting_id ? `<button class="btn-ghost btn-sm" style="padding:3px 8px" onclick="event.stopPropagation();MT.openResolutionModal(${x.id})">✎</button>` : ""}
            <button class="btn-ghost btn-sm" style="padding:3px 8px;font-size:11px" onclick="event.stopPropagation();MT.openVotingPanel(${x.id})">🗳 ${t("تصويت","Vote")}</button>
          </td>
        </tr>`;
      }).join("") || `<tr><td colspan="7" style="color:#98A2B3">${t("لا توجد نتائج مطابقة.","No matching results.")}</td></tr>`}
      </tbody></table></div>
      <div style="font-size:11px;color:#98A2B3;margin-top:8px">${t(`عرض ${list.length} من ${all.length} قراراً`,`Showing ${list.length} of ${all.length} resolutions`)}</div>
    </div>`;
  },
  // ── Resolution Voting Panel ───────────────────────────────────────────────
  async openVotingPanel(resId) {
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const res = (this._resAll || []).find(x => x.id === resId);

    // Build or reuse overlay modal
    let modal = document.getElementById('vote-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'vote-modal';
      modal.className = 'modal-overlay';
      modal.style.cssText = 'display:flex;z-index:9000';
      modal.innerHTML = '<div class="modal" style="max-width:520px"><div id="vote-modal-body"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) MT.closeVotingPanel(); });
    } else {
      modal.style.display = 'flex';
    }
    const body = document.getElementById('vote-modal-body');
    body.innerHTML = `<div class="es"><div class="loading"></div></div>`;

    let data = {};
    try { data = await api(`/api/gov/resolutions/${resId}/votes`); } catch(e) { data = {}; }
    const votes = data.votes || [];
    const vStatus = res ? (res.voting_status || 'draft') : 'draft';
    const approve = data.approve || 0, reject = data.reject || 0, abstain = data.abstain || 0;
    const total = data.total || 0;
    const qMet = data.quorum_met;
    const qTotal = data.quorum_total || 0;
    const qNeeded = data.quorum_needed || 0;
    const passed = data.passed;
    const hasPerms = window.App && App.permissions && (App.permissions.has('governance.voting') || App.permissions.has('admin.settings'));
    const pct = n => total > 0 ? Math.round((n / total) * 100) : 0;
    const bar = (n, color) => `<div style="height:7px;border-radius:4px;background:${color};width:${pct(n)}%;min-width:${n>0?'4px':'0'};transition:.3s"></div>`;
    const myVote = votes.find(v => v.voter_id === (App.user && App.user.id));

    const statusColors = { draft: 'var(--text3)', open: '#2ecc8a', closed: 'var(--text3)', archived: 'var(--text3)' };
    const statusLabels = { draft: t('مسودة','Draft'), open: t('تصويت مفتوح','Open'), closed: t('مغلق','Closed'), archived: t('مؤرشف','Archived') };
    const resTitle = res ? (l === 'ar' ? (res.title_ar || res.title_en || res.title) : (res.title_en || res.title_ar || res.title)) : '';

    body.innerHTML = `
      <div class="modal-title">🗳 ${t('التصويت على القرار','Resolution Voting')}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;padding:8px 10px;background:var(--navy3);border-radius:8px">${esc(resTitle)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <span style="font-size:11.5px;font-weight:700;color:${statusColors[vStatus]||'var(--text3)'};padding:3px 10px;border-radius:12px;border:1px solid currentColor">${statusLabels[vStatus]||vStatus}</span>
        ${qTotal > 0 ? `<span style="font-size:11px;color:${qMet?'#2ecc8a':'var(--amber)'}">النصاب: ${total}/${qNeeded} ${qMet?'✓':''}</span>` : ''}
        ${vStatus==='closed'&&passed!==undefined ? `<span style="font-size:11.5px;font-weight:700;color:${passed?'#2ecc8a':'#e05252'};padding:3px 10px;border-radius:12px;border:1px solid currentColor">${passed?'✅ '+t('مُقرَّر','Passed'):'✗ '+t('مرفوض','Failed')}</span>` : ''}
      </div>
      ${total > 0 ? `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px">
            <span style="color:#2ecc8a">✅ ${t('موافق','Approve')} ${approve} (${pct(approve)}%)</span>
            <span style="color:#e05252">✗ ${t('معارض','Reject')} ${reject} (${pct(reject)}%)</span>
            <span style="color:var(--text3)">◌ ${t('ممتنع','Abstain')} ${abstain} (${pct(abstain)}%)</span>
          </div>
          <div style="display:flex;gap:2px;height:7px;border-radius:4px;overflow:hidden;background:var(--navy3)">
            ${bar(approve,'#2ecc8a')}${bar(reject,'#e05252')}${bar(abstain,'#666')}
          </div>
          <div style="font-size:10.5px;color:var(--text3);margin-top:4px">${total} ${t('أصوات','votes')}</div>
        </div>` : `<div style="font-size:12px;color:var(--text3);margin-bottom:14px">${t('لا أصوات بعد','No votes yet')}</div>`}

      ${vStatus === 'open' ? `
        <div style="margin-bottom:14px;padding:12px;background:var(--navy3);border-radius:10px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px">${myVote ? t('تعديل صوتك','Change Your Vote') : t('أدلِ بصوتك','Cast Your Vote')}</div>
          ${myVote ? `<div style="font-size:11px;color:var(--text3);margin-bottom:8px">${t('صوتك الحالي','Your current vote')}: <strong style="color:${myVote.vote==='approve'?'#2ecc8a':myVote.vote==='reject'?'#e05252':'var(--text3)'}">${myVote.vote==='approve'?t('موافق','Approve'):myVote.vote==='reject'?t('معارض','Reject'):t('ممتنع','Abstain')}</strong></div>` : ''}
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${t('ملاحظات (اختياري)','Comment (optional)')}</div>
          <input class="fi" id="vote-comment" placeholder="${t('أضف ملاحظة...','Add a comment...')}" style="margin-bottom:10px;font-size:12px"/>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-ghost btn-sm" onclick="MT._castVote(${resId},'approve')" style="color:#2ecc8a;border-color:#2ecc8a;padding:6px 14px;font-size:12px">✅ ${t('موافق','Approve')}</button>
            <button class="btn-ghost btn-sm" onclick="MT._castVote(${resId},'reject')" style="color:#e05252;border-color:#e05252;padding:6px 14px;font-size:12px">✗ ${t('معارض','Reject')}</button>
            <button class="btn-ghost btn-sm" onclick="MT._castVote(${resId},'abstain')" style="color:var(--text3);border-color:var(--text3);padding:6px 14px;font-size:12px">◌ ${t('ممتنع','Abstain')}</button>
          </div>
        </div>` : ''}

      ${hasPerms ? `
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
          ${vStatus === 'draft' || vStatus === 'closed' ? `<button class="btn-ghost btn-sm" onclick="MT._setVotingStatus(${resId},'open')" style="color:#2ecc8a;border-color:#2ecc8a;font-size:11px">🔵 ${t('فتح التصويت','Open Voting')}</button>` : ''}
          ${vStatus === 'open' ? `<button class="btn-ghost btn-sm" onclick="MT._setVotingStatus(${resId},'closed')" style="color:#e05252;border-color:#e05252;font-size:11px">🔒 ${t('إغلاق التصويت','Close Voting')}</button>` : ''}
          ${vStatus === 'closed' ? `<button class="btn-ghost btn-sm" onclick="MT._setVotingStatus(${resId},'archived')" style="color:var(--text3);border-color:var(--text3);font-size:11px">🗄 ${t('أرشفة','Archive')}</button>` : ''}
        </div>` : ''}

      ${votes.length > 0 ? `
        <div style="font-size:11.5px;font-weight:700;color:var(--text3);margin-bottom:6px">${t('تفاصيل الأصوات','Vote Details')}</div>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">
          ${votes.map(v => `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--navy3);border-radius:6px;font-size:11.5px">
            <span style="font-weight:600">${esc(v.voter_name || '—')}</span>
            <span style="color:${v.vote==='approve'?'#2ecc8a':v.vote==='reject'?'#e05252':'var(--text3)'}">
              ${v.vote==='approve'?'✅ '+t('موافق','Approve'):v.vote==='reject'?'✗ '+t('معارض','Reject'):'◌ '+t('ممتنع','Abstain')}
            </span>
          </div>`).join('')}
        </div>` : ''}

      <div id="vote-err" style="display:none;font-size:11px;color:var(--red);margin-top:6px"></div>
      <div class="fa" style="margin-top:14px">
        <button class="btn-ghost" onclick="MT.closeVotingPanel()">${t('إغلاق','Close')}</button>
      </div>`;
  },

  async _castVote(resId, vote) {
    const comments = (document.getElementById('vote-comment') || {}).value || '';
    const errEl = document.getElementById('vote-err');
    if (errEl) errEl.style.display = 'none';
    try {
      const r = await api(`/api/gov/resolutions/${resId}/vote`, { method: 'POST', body: JSON.stringify({ vote, comments }) });
      // Update local cache
      if (this._resAll) {
        const idx = this._resAll.findIndex(x => x.id === resId);
        if (idx !== -1) this._resAll[idx] = { ...this._resAll[idx], ...r };
      }
      await this.openVotingPanel(resId);
      showToast(this.t('تم تسجيل صوتك', 'Vote recorded'), 'success');
    } catch(e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    }
  },

  async _setVotingStatus(resId, status) {
    const errEl = document.getElementById('vote-err');
    if (errEl) errEl.style.display = 'none';
    try {
      await api(`/api/gov/resolutions/${resId}/voting-status`, { method: 'POST', body: JSON.stringify({ status }) });
      // Update local cache
      if (this._resAll) {
        const idx = this._resAll.findIndex(x => x.id === resId);
        if (idx !== -1) this._resAll[idx] = { ...this._resAll[idx], voting_status: status };
      }
      await this.openVotingPanel(resId);
      showToast(this.t('تم تحديث حالة التصويت', 'Voting status updated'), 'success');
      this._paintResolutions();
    } catch(e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    }
  },

  closeVotingPanel() {
    const modal = document.getElementById('vote-modal');
    if (modal) modal.style.display = 'none';
  },
};

window.MT = MT;
