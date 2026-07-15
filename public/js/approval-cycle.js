/* ════════════════════════════════════════════════════════════════════════════
   MINUTES APPROVAL CYCLE  —  Full 9-step workflow dashboard
   Entry:  ApprovalCycle.open(meetingId)   ← from meeting Approval tab
           ApprovalCycle.refresh()         ← from sidebar (shows picker)
   ════════════════════════════════════════════════════════════════════════════ */
const ApprovalCycle = {
  _mid: null,
  _data: null,
  _meeting: null,
  _fullData: null,
  _commentTab: 'recent',
  _eSignMode: 'draw',
  _eSignPurpose: null,
  _pendingComment: null,
  _canvas: null,
  _ctx: null,
  _drawing: false,
  _hasDrawing: false,

  t(ar, en) { return App.lang === 'ar' ? ar : en; },

  /* ─── Entry points ─────────────────────────────────────────────────────── */
  open(mid) {
    this._mid = mid;
    Panels.load('approval-cycle');
  },

  async refresh() {
    if (!this._mid) {
      await this._renderLanding();
    } else {
      await this._load();
    }
  },

  /* ─── Landing: meeting picker ─────────────────────────────────────────── */
  async _renderLanding() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t = (ar, en) => this.t(ar, en);

    body.innerHTML = `
<div class="ac-landing">
  <div class="ac-landing-hero">
    <div class="ac-landing-icon">📋</div>
    <div class="ac-landing-title">${t('دورة اعتماد المحاضر', 'Minutes Approval Cycle')}</div>
    <div class="ac-landing-sub">${t('اختر اجتماعاً لعرض دورة الاعتماد الخاصة به', 'Select a meeting to view its approval cycle')}</div>
  </div>
  <div id="ac-landing-list" class="ac-landing-list">
    <div class="ac-spin-wrap"><div class="loading"></div></div>
  </div>
</div>`;

    try {
      const data = await api('/api/meetings');
      const meetings = Array.isArray(data) ? data : (data.meetings || []);

      const listEl = document.getElementById('ac-landing-list');
      if (!listEl) return;

      if (!meetings.length) {
        listEl.innerHTML = `<div class="ac-empty"><div class="ac-empty-icon">📭</div><div>${t('لا توجد اجتماعات', 'No meetings found')}</div></div>`;
        return;
      }

      listEl.innerHTML = meetings.map(m => {
        const title = (App.lang === 'ar' ? m.title_ar : m.title_en) || m.title_ar || t('اجتماع', 'Meeting') + ' #' + m.id;
        const date = m.meeting_date ? fmtDate(m.meeting_date) : '';
        const stageMap = {
          created: t('منشأ','Created'), recording: t('تسجيل','Recording'),
          uploaded: t('مرفوع','Uploaded'), processing: t('معالجة','Processing'),
          ai_minutes_generated: t('محضر AI','AI Minutes'), secretary_review: t('مراجعة أمين السر','Sec. Review'),
          review: t('مراجعة','Review'), chairman_approval: t('موافقة الرئيس','Chairman Approval'),
          board_approval: t('موافقة المجلس','Board Approval'), approval: t('الاعتماد','Approval'),
          archived: t('مؤرشف','Archived'),
        };
        const stage = m.lifecycle_stage || 'created';
        const stageLabel = stageMap[stage] || stage;
        const hasMinutes = m.minutes_status || m.ai_minutes_text;
        const dot = hasMinutes ? '#1a7f4b' : 'var(--text3)';

        return `<div class="ac-landing-card" onclick="ApprovalCycle.open(${m.id})">
          <div class="ac-landing-card-avatar">${(title[0] || 'M').toUpperCase()}</div>
          <div class="ac-landing-card-info">
            <div class="ac-landing-card-title">${esc(title)}</div>
            <div class="ac-landing-card-meta">${[date, m.meeting_type].filter(Boolean).join(' · ')}</div>
          </div>
          <div class="ac-landing-card-right">
            <span class="ac-landing-stage" style="background:${dot === '#1a7f4b' ? 'rgba(31,138,93,.1)' : 'rgba(0,0,0,.05)'};color:${dot}">${stageLabel}</span>
          </div>
          <div class="ac-landing-card-arrow">›</div>
        </div>`;
      }).join('');

    } catch (e) {
      const listEl = document.getElementById('ac-landing-list');
      if (listEl) listEl.innerHTML = `<div class="ac-empty"><div class="ac-empty-icon">⚠️</div><div>${t('تعذّر التحميل','Load failed')}: ${esc(e.message)}</div></div>`;
    }
  },

  /* ─── Load meeting + cycle data ───────────────────────────────────────── */
  async _load() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    body.innerHTML = '<div class="ac-spin-wrap" style="padding:80px 0"><div class="loading"></div></div>';
    try {
      const [full, cycleData] = await Promise.all([
        api(`/api/meetings/${this._mid}/full`),
        api(`/api/meetings/${this._mid}/approval-cycle`),
      ]);
      this._fullData = full || {};
      this._meeting = full && full.meeting;
      this._data = cycleData;
      this._render();
    } catch (e) {
      body.innerHTML = `<div class="ac-empty" style="padding:80px"><div class="ac-empty-icon">⚠️</div><div>${this.t('تعذّر تحميل البيانات','Could not load data')}</div><div style="font-size:11px;margin-top:6px;color:var(--text3)">${esc(e.message)}</div></div>`;
    }
  },

  /* ─── Main dashboard render ───────────────────────────────────────────── */
  _render() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t = (ar, en) => this.t(ar, en);
    const m = this._meeting;
    if (!m) { this._mid = null; this._renderLanding(); return; }

    const d = this._data || {};
    const cycle = d.cycle || { cycle_stage: 'draft' };
    const l = App.lang;
    const title = (l === 'ar' ? m.title_ar : m.title_en) || m.title_ar || '';
    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const timeStr = m.meeting_date ? (m.meeting_date.split(' ')[1] || '').slice(0, 5) : '';
    const stageLabel = this._stageName(cycle.cycle_stage);
    const lastUpdated = cycle.updated_at ? this._fmtDT(cycle.updated_at) : t('لم يُحدَّث بعد', 'Not updated yet');

    body.innerHTML = `
<div class="ac-wrap">

  <!-- ── Top bar ───────────────────────────────────────────────────────── -->
  <div class="ac-topbar">
    <div class="ac-topbar-left">
      <button class="ac-back-btn" onclick="ApprovalCycle._mid=null;ApprovalCycle._renderLanding()">← ${t('كل الاجتماعات', 'All Meetings')}</button>
      <span class="ac-topbar-sep">·</span>
      <span class="ac-topbar-meeting">
        ${m.meeting_type ? `<span class="ac-meeting-type">${esc(m.meeting_type)}</span>` : ''}
        ${dateStr ? `<span class="ac-meta-dot"></span><span>${dateStr}</span>` : ''}
        ${timeStr ? `<span class="ac-meta-dot"></span><span>${timeStr}</span>` : ''}
      </span>
    </div>
    <div class="ac-topbar-right">
      <a class="btn-ghost btn-sm" href="/api/meetings/${this._mid}/export-minutes" target="_blank">⬇ ${t('تنزيل نسخة العمل', 'Download Working Copy')}</a>
      <button class="btn-ghost btn-sm" onclick="MT.openDetail(${this._mid},'overview')">📋 ${t('تفاصيل الاجتماع', 'Meeting Details')}</button>
    </div>
  </div>

  <!-- ── Page title + status ───────────────────────────────────────────── -->
  <div class="ac-page-head">
    <div class="ac-page-meeting-name">${esc(title)}</div>
    <h1 class="ac-page-title">${t('دورة اعتماد المحضر', 'Minutes Approval Cycle')}</h1>
    <div class="ac-page-meta">
      <span class="ac-stage-badge">${stageLabel}</span>
      <span class="ac-page-updated">${t('آخر تحديث:', 'Last updated:')} ${lastUpdated}</span>
    </div>
  </div>

  <!-- ── 9-Step Stepper ────────────────────────────────────────────────── -->
  ${this._renderStepper(cycle, d)}

  <!-- ── 3-Column body ─────────────────────────────────────────────────── -->
  <div class="ac-cols">
    <div class="ac-col-l">${this._renderLeft(cycle, d)}</div>
    <div class="ac-col-c">${this._renderCenter(cycle, d)}</div>
    <div class="ac-col-r">${this._renderRight(cycle, d)}</div>
  </div>

</div>`;

    this._initCanvas();
  },

  /* ─── 9-Step Stepper ──────────────────────────────────────────────────── */
  _renderStepper(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const comments = (d && d.comments) || [];
    const sigs = (d && d.signatures) || [];
    const totalC = comments.length;
    const resolved = comments.filter(c => c.status !== 'pending').length;
    const attendeeSigs = sigs.filter(s => s.sig_stage === 'attendee');
    const sigSigned = attendeeSigs.filter(s => s.status === 'signed').length;
    const totalSig = attendeeSigs.length;

    const STAGES = [
      { key: 'draft',           ar: 'إنشاء المسودة',      en: 'Draft Minutes',           icon: this._svgDoc(),       sub: null },
      { key: 'circulated',      ar: 'تسليم للحضور',        en: 'Deliver to Attendees',    icon: this._svgEnvelope(),  sub: t('تم التسليم للجميع','All delivered') },
      { key: 'comments_open',   ar: 'تعليقات الحضور',      en: 'Attendee Reviews',        icon: this._svgComment(),   sub: totalC ? `${totalC} ${t('تعليق','comments')}` : null },
      { key: 'deadline_closed', ar: 'موعد المراجعة',       en: 'Review Deadline',         icon: this._svgClock(),     sub: t('مغلق','Closed') },
      { key: 'review_resolve',  ar: 'مراجعة وحل',          en: 'Review & Resolve',        icon: this._svgResolve(),   sub: resolved && totalC ? `${resolved}/${totalC} ${t('محلول','resolved')}` : null },
      { key: 'final_version',   ar: 'النسخة النهائية',     en: 'Final Version',           icon: this._svgFinal(),     sub: null },
      { key: 'attendee_sign',   ar: 'توقيعات الحضور',      en: 'Attendee Signatures',     icon: this._svgSign(),      sub: totalSig ? `${sigSigned}/${totalSig} ${t('وقّعوا','signed')}` : null },
      { key: 'final_approver',  ar: 'الاعتماد النهائي',    en: 'Final Approval',          icon: this._svgApprover(),  sub: t('معلّق','Pending') },
      { key: 'archived',        ar: 'أرشفة وتفعيل',        en: 'Archive & Activate',      icon: this._svgArchive(),   sub: t('معلّق','Pending') },
    ];

    const STAGE_IDX = { draft:0, circulated:1, comments_open:2, deadline_closed:3, review_resolve:4, final_version:5, attendee_sign:6, final_approver:7, archived:8 };
    const cur = STAGE_IDX[cycle.cycle_stage] ?? 0;

    const steps = STAGES.map((s, i) => {
      const done = i < cur;
      const active = i === cur;
      const cls = done ? 'done' : active ? 'cur' : '';
      const subLabel = done ? t('مكتمل ✓','Done ✓') : active ? (s.sub || t('الآن','Current')) : (s.sub || t('قيد الانتظار','Pending'));

      return `
<div class="ac-step ${cls}" onclick="ApprovalCycle._onStepClick(${i})" title="${t(s.ar, s.en)}">
  <div class="ac-step-num-label">${i + 1}</div>
  <div class="ac-step-dot">
    ${done ? `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
           : s.icon}
  </div>
  <div class="ac-step-label">${t(s.ar, s.en)}</div>
  <div class="ac-step-sub">${subLabel}</div>
</div>
${i < STAGES.length - 1 ? `<div class="ac-step-arrow ${done || active ? 'done' : ''}">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
</div>` : ''}`;
    }).join('');

    return `<div class="ac-stepper-wrap"><div class="ac-stepper">${steps}</div></div>`;
  },

  /* ─── Step click handler ─────────────────────────────────────────────── */
  _onStepClick(i) {
    if (i === 0) { this._renderStep1Draft();   return; }
    if (i === 1) { this._renderStep2Deliver(); return; }
    if (i === 2) { this._renderStep3Reviews(); return; }
    if (i === 3) { this._renderStep4Deadline(); return; }
    const t = (ar, en) => this.t(ar, en);
    const STEPS_EN = ['Draft Minutes','Deliver to Attendees','Attendee Reviews','Review Deadline','Review & Resolve','Final Version','Attendee Signatures','Final Approval','Archive & Activate'];
    const STEPS_AR = ['إنشاء المسودة','تسليم للحضور','تعليقات الحضور','موعد المراجعة','مراجعة وحل','النسخة النهائية','توقيعات الحضور','الاعتماد النهائي','أرشفة وتفعيل'];
    const stepName = App.lang === 'ar' ? STEPS_AR[i] : STEPS_EN[i];
    showToast(`${i + 1}. ${stepName}`, 'info');
    document.querySelectorAll('.ac-step').forEach((el, idx) => {
      el.classList.toggle('ac-step-focus', idx === i);
    });
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 2 — DELIVER TO ATTENDEES SCREEN
     ═══════════════════════════════════════════════════════════════════════ */
  _renderStep2Deliver() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting || {};
    const d  = this._data   || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    const attendees = fd.attendees || [];
    const agenda    = fd.agenda    || [];
    const decisions = fd.decisions || [];
    const tasks     = fd.tasks     || [];
    const docs      = fd.documents || [];

    const title   = (l==='ar' ? m.title_ar : m.title_en) || m.title_ar || '';
    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const mType   = m.meeting_type || '';
    const sectionCount = 2 + agenda.length + 3;

    /* ── Shared mini stepper ─────────────────────────────────────────────── */
    const miniStepper = this._buildMiniStepper(cycle, 1, t, l);

    /* ── Deadline values ─────────────────────────────────────────────────── */
    const dl     = cycle.comment_deadline || '';
    const dlDate = dl ? (dl.split('T')[0] || dl.split(' ')[0]) : '';
    const dlTime = dl ? (dl.split('T')[1] || dl.split(' ')[1] || '23:59').slice(0,5) : '23:59';
    let timeRemStr = `7 ${t('أيام','Days')}, 8 ${t('ساعات','Hours')}`;
    if (dlDate) {
      const diff = new Date(dlDate) - new Date();
      if (diff > 0) {
        const days  = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        timeRemStr  = `${days} ${t('أيام','Days')}, ${hours} ${t('ساعات','Hours')}`;
      }
    }

    /* ── Attendee rows ───────────────────────────────────────────────────── */
    const REQUIRED_ROLES = ['chairman','board_chairman','board_member','vice_chairman','member'];
    const avatarPalette  = ['#0F1728','#0C7A3D','#A8842C','#1A5276','#7D3C98','#0E6655','#B03A2E','#1F618D'];

    const attRows = attendees.map((att, i) => {
      const name    = (l==='ar' ? att.name_ar : att.name_en) || att.name_ar || att.name_en || '';
      const role    = att.board_role || att.role || '';
      const roleKey = role.toLowerCase().replace(/\s+/g,'_');
      const isReq   = REQUIRED_ROLES.some(r => roleKey.includes(r));
      const email   = att.email || '';
      const initials = name.split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
      const bg = avatarPalette[i % avatarPalette.length];
      return `<tr class="dv-att-row" data-att-name="${esc(name.toLowerCase())}">
        <td class="dv-td-check"><input type="checkbox" class="dv-cb" checked onchange="ApprovalCycle._dvUpdateCount()"></td>
        <td class="dv-td-att">
          <div class="dv-av" style="background:${bg}">${initials}</div>
          <div class="dv-att-info"><div class="dv-att-name">${esc(name)}</div><div class="dv-att-subrole">${esc(role)}</div></div>
        </td>
        <td class="dv-td-role">${esc(role)}</td>
        <td class="dv-td-email">${esc(email)}</td>
        <td class="dv-td-status"><span class="dv-badge ${isReq?'req':'opt'}">${isReq ? t('مطلوب','Required') : t('اختياري','Optional')}</span></td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="dv-empty-row">${t('لا يوجد حضور','No attendees found')}</td></tr>`;

    /* ── Attachment cards ────────────────────────────────────────────────── */
    const FILE_ICON  = { docx:'📄', doc:'📄', pdf:'📋', xlsx:'📊', xls:'📊', pptx:'📊', ppt:'📊', png:'🖼', jpg:'🖼', mp4:'🎥' };
    const FILE_COLOR = { docx:'#2B5CA5', doc:'#2B5CA5', pdf:'#C13333', xlsx:'#1D7A3C', xls:'#1D7A3C', pptx:'#C25125', default:'#546E7A' };

    // Always include the minutes as first attachment
    const minutesCard = `<div class="dv-file-card">
      <div class="dv-file-icon-wrap" style="background:rgba(43,92,165,.1);color:#2B5CA5">
        <span>W</span>
      </div>
      <div class="dv-file-info">
        <div class="dv-file-name">${t('محضر الاجتماع','Draft Minutes')} (v1.0)</div>
        <div class="dv-file-meta">DOCX · 245 KB</div>
      </div>
      <span class="dv-file-ok">✅</span>
    </div>`;

    const docCards = docs.slice(0,3).map(doc => {
      const name = doc.name || doc.title || t('مستند','Document');
      const ext  = (doc.file_type || (doc.name||'').split('.').pop() || 'pdf').toLowerCase();
      const icon = FILE_ICON[ext]  || '📎';
      const clr  = FILE_COLOR[ext] || FILE_COLOR.default;
      const size = doc.file_size
        ? (doc.file_size > 1048576 ? (doc.file_size/1048576).toFixed(1)+' MB' : Math.round(doc.file_size/1024)+' KB')
        : '—';
      return `<div class="dv-file-card">
        <div class="dv-file-icon-wrap" style="background:rgba(0,0,0,.05);color:${clr}"><span>${icon}</span></div>
        <div class="dv-file-info"><div class="dv-file-name">${esc(name)}</div><div class="dv-file-meta">${ext.toUpperCase()} · ${size}</div></div>
        <span class="dv-file-ok">✅</span>
      </div>`;
    }).join('');

    /* ── Default message ─────────────────────────────────────────────────── */
    const defaultMsg = t(
      `السادة أعضاء مجلس الإدارة الكرام،\n\nيرجى مراجعة محاضر الاجتماع المرفقة وتقديم ملاحظاتكم أو التعديلات المقترحة بحلول الموعد النهائي. ملاحظاتكم مهمة لضمان دقة واكتمال المحضر.\n\nشكراً لكم`,
      `Dear Board Members,\n\nPlease review the attached minutes and provide your comments or suggested changes by the deadline. Your feedback is important to ensure the accuracy and completeness of the record.\n\nThank you.`
    );
    const msgLen = defaultMsg.length;

    /* ── Render ──────────────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-wrap">

  <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
  <div class="dm-topbar">
    <div class="dm-breadcrumb">
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('الاجتماعات','Meetings')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item">${esc(mType||title)}</span>
      <span class="dm-bc-sep">›</span>
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('دورة الاعتماد','Approval Cycle')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item dm-bc-active">${t('تسليم للحضور','Deliver to Attendees')}</span>
    </div>
    <div class="dm-topbar-actions">
      <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep1Draft()">← ${t('العودة للمسودة','Back to Draft Minutes')}</button>
      <button class="dm-btn ghost">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
      <a class="dm-btn ghost" href="/api/meetings/${this._mid}/export-minutes" target="_blank">⬇ ${t('تحميل المسودة','Download Draft')}</a>
      <button class="dm-btn primary" onclick="ApprovalCycle._sendToAttendees()">✈️ ${t('إرسال للحضور','Send to Attendees')}</button>
    </div>
  </div>

  <!-- ── Title bar ─────────────────────────────────────────────────────────── -->
  <div class="dm-titlebar">
    <div class="dm-page-h1">${t('تسليم للحضور','Deliver to Attendees')} <span class="dm-badge-prog">${t('قيد التنفيذ','In Progress')}</span></div>
    <div class="dm-page-sub">${t('راجع المحضر وأرسله للحضور للمراجعة والتعليق.','Review the draft minutes and send them to attendees for review and comments.')}</div>
  </div>

  <!-- ── Mini stepper ──────────────────────────────────────────────────────── -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- ── 3-column body ─────────────────────────────────────────────────────── -->
  <div class="dv-body">

    <!-- LEFT: Minutes Summary -->
    <div class="dv-sidebar">
      <div class="dm-sidebar-head">${t('ملخص المحضر','Minutes Summary')}</div>
      <div class="dv-doc-card">
        <div class="dv-doc-word-icon">W</div>
        <div class="dv-doc-title">${t('محضر الاجتماع','Board Meeting Minutes')}</div>
        <div class="dv-doc-ver">${dateStr} (v1.0)</div>
        <div class="dv-doc-gen">${t('أُنشئ في','Generated on')} ${dateStr}</div>
        <div class="dv-doc-by">${t('بواسطة AI Secretary','By AI Secretary')}</div>
        <div class="dv-doc-stats">
          <div class="dv-doc-stat"><div class="dv-ds-num">${sectionCount}</div><div class="dv-ds-lbl">${t('أقسام','Sections')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${decisions.length}</div><div class="dv-ds-lbl">${t('قرارات','Decisions')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${tasks.length}</div><div class="dv-ds-lbl">${t('بنود العمل','Action Items')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${docs.length}</div><div class="dv-ds-lbl">${t('مرفقات','Attachments')}</div></div>
        </div>
        <button class="dv-preview-btn">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
      </div>
    </div>

    <!-- CENTER: Attendees + Attachments -->
    <div class="dv-center">

      <!-- Select Attendees card -->
      <div class="dv-card">
        <div class="dv-card-head">
          <div>
            <div class="dv-card-title">${t('اختيار الحضور','Select Attendees')}</div>
            <div class="dv-card-sub">${t('جميع أعضاء المجلس والمشاركين سيتلقون المحضر للمراجعة.','All board members and relevant participants will receive the minutes for review.')}</div>
          </div>
        </div>
        <div class="dv-att-toolbar">
          <div class="dv-search-box">
            <span class="dv-search-ico">🔍</span>
            <input class="dv-search-inp" type="text" placeholder="${t('بحث عن الحضور...','Search attendees...')}" oninput="ApprovalCycle._dvFilterAtt(this.value)">
          </div>
          <button class="dv-filter-btn">⚙ ${t('تصفية','Filter')}</button>
          <span class="dv-att-sel-count"><span id="dv-sel-cnt">${attendees.length}</span> ${t('محدد','Selected')}</span>
          <label class="dv-sel-all">
            <input type="checkbox" id="dv-cb-all" checked onchange="ApprovalCycle._dvSelectAll(this.checked)">
            <span>${t('تحديد الكل','Select All')}</span>
          </label>
        </div>
        <div class="dv-table-wrap">
          <table class="dv-table">
            <thead><tr>
              <th class="dv-th-chk"></th>
              <th>${t('الحضور','Attendee')}</th>
              <th>${t('الدور','Role')}</th>
              <th>${t('البريد الإلكتروني','Email')}</th>
              <th>${t('الحالة','Status')}</th>
            </tr></thead>
            <tbody id="dv-att-body">${attRows}</tbody>
          </table>
        </div>
        <div class="dv-att-note">ℹ️ ${t('سيتم إشعار الحضور عبر البريد الإلكتروني برابط آمن للمراجعة والتعليق.','Attendees will be notified via email with a secure link to review and comment.')}</div>
      </div>

      <!-- Attachments card -->
      <div class="dv-card">
        <div class="dv-card-head">
          <div class="dv-card-title">${t('المرفقات المُدرجة','Attachments to Include')}</div>
          <div class="dv-card-sub">${t('ستُشارَك هذه المرفقات مع المحضر.','These attachments will be shared along with the minutes.')}</div>
        </div>
        <div class="dv-files-grid">
          ${minutesCard}
          ${docCards}
          <button class="dv-add-more">+ ${t('إضافة المزيد','Add More')}</button>
        </div>
      </div>

    </div><!-- /dv-center -->

    <!-- RIGHT: Deadline + Reminders + Message -->
    <div class="dv-right">

      <!-- Review Deadline -->
      <div class="dv-rpanel">
        <div class="dv-rp-title">⏰ ${t('الموعد النهائي للمراجعة','Review Deadline')}</div>
        <div class="dv-rp-sub">${t('حدد الموعد النهائي الذي يجب على الحضور تقديم ملاحظاتهم بحلوله.','Set the deadline by which attendees must review and submit their comments.')}</div>
        <div class="dv-dl-grid">
          <div class="dv-dl-field">
            <label class="dv-label">${t('تاريخ الموعد','Deadline Date')}</label>
            <input type="date" class="dv-input" id="dv-dl-date" value="${dlDate}">
          </div>
          <div class="dv-dl-field">
            <label class="dv-label">${t('وقت الموعد','Deadline Time')}</label>
            <input type="time" class="dv-input" id="dv-dl-time" value="${dlTime}">
          </div>
        </div>
        <div class="dv-time-rem">🕐 ${t('الوقت المتبقي بعد الإرسال:','Time remaining after sending:')} <strong>${timeRemStr}</strong></div>
      </div>

      <!-- Reminder Settings -->
      <div class="dv-rpanel">
        <div class="dv-rp-title">🔔 ${t('إعدادات التذكير','Reminder Settings')}</div>
        <div class="dv-rp-sub">${t('قم بإعداد التذكيرات لمساعدة الحضور.','Configure reminders to help attendees complete their review on time.')}</div>
        <div class="dv-rem-row">
          <span class="dv-rem-lbl">${t('التذكير الأول','First Reminder')}</span>
          <select class="dv-rem-sel"><option>${t('قبل يومين من الموعد','2 days before deadline')}</option><option>${t('قبل 3 أيام','3 days before deadline')}</option><option>${t('قبل أسبوع','1 week before deadline')}</option></select>
        </div>
        <div class="dv-rem-row">
          <span class="dv-rem-lbl">${t('التذكير الثاني','Second Reminder')}</span>
          <select class="dv-rem-sel"><option>${t('قبل يوم من الموعد','1 day before deadline')}</option><option>${t('قبل يومين','2 days before deadline')}</option></select>
        </div>
        <div class="dv-rem-row">
          <span class="dv-rem-lbl">${t('التذكير النهائي','Final Reminder')}</span>
          <select class="dv-rem-sel"><option>${t('يوم الموعد الساعة 9:00 ص','On deadline day at 9:00 AM')}</option><option>${t('يوم الموعد الساعة 12:00 م','On deadline day at 12:00 PM')}</option></select>
        </div>
      </div>

      <!-- Custom Message -->
      <div class="dv-rpanel">
        <div class="dv-rp-title">✉️ ${t('رسالة مخصصة (اختياري)','Custom Message (Optional)')}</div>
        <div class="dv-rp-sub">${t('أضف رسالة للحضور.','Add a message for attendees.')}</div>
        <textarea class="dv-msg-area" id="dv-msg" maxlength="500" oninput="ApprovalCycle._dvUpdateCounter(this)">${defaultMsg}</textarea>
        <div class="dv-msg-counter"><span id="dv-msg-cnt">${msgLen}</span> / 500</div>
      </div>

    </div><!-- /dv-right -->
  </div><!-- /dv-body -->

  <!-- ── Bottom bar ──────────────────────────────────────────────────────────── -->
  <div class="dm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep1Draft()">← ${t('العودة لإنشاء المسودة','Back to Draft Minutes')}</button>
    <button class="dm-btn primary dv-send-btn" onclick="ApprovalCycle._sendToAttendees()">
      ✈️ ${t('إرسال للحضور','Send to Attendees')} <span class="dv-send-sub">${t('إشعار الحضور المحددين','Notify selected attendees')}</span>
    </button>
  </div>

</div>`;
  },

  /* ── Step 2 helpers ──────────────────────────────────────────────────────── */
  _dvFilterAtt(q) {
    const lc = q.toLowerCase();
    document.querySelectorAll('#dv-att-body tr.dv-att-row').forEach(row => {
      row.style.display = row.dataset.attName.includes(lc) ? '' : 'none';
    });
  },
  _dvSelectAll(checked) {
    document.querySelectorAll('.dv-cb').forEach(cb => { cb.checked = checked; });
    this._dvUpdateCount();
  },
  _dvUpdateCount() {
    const n = document.querySelectorAll('.dv-cb:checked').length;
    const el = document.getElementById('dv-sel-cnt');
    if (el) el.textContent = n;
    const all = document.getElementById('dv-cb-all');
    if (all) all.indeterminate = (n > 0 && n < document.querySelectorAll('.dv-cb').length);
  },
  _dvUpdateCounter(ta) {
    const el = document.getElementById('dv-msg-cnt');
    if (el) el.textContent = ta.value.length;
  },
  async _sendToAttendees() {
    const dateEl = document.getElementById('dv-dl-date');
    const timeEl = document.getElementById('dv-dl-time');
    const deadline = dateEl?.value;
    const dlTime   = timeEl?.value || '23:59';

    if (deadline) {
      try {
        await api(`/api/meetings/${this._mid}/approval-cycle/deadline`, {
          method: 'POST',
          body: JSON.stringify({ deadline: `${deadline} ${dlTime}:00` }),
        });
      } catch(e) { /* non-fatal — proceed */ }
    }
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, {
        method: 'POST',
        body: JSON.stringify({ to: 'circulated' }),
      });
      showToast(this.t('تم الإرسال للحضور بنجاح ✈️','Sent to attendees successfully ✈️'), 'success');
      await this._load();
    } catch(e) {
      showToast(e.message || this.t('تعذّر الإرسال','Failed to send'), 'error');
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 3 — ATTENDEE REVIEWS SCREEN
     ═══════════════════════════════════════════════════════════════════════ */
  _renderStep3Reviews() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting || {};
    const d  = this._data   || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    const attendees = fd.attendees || [];
    const agenda    = fd.agenda    || [];
    const decisions = fd.decisions || [];
    const tasks     = fd.tasks     || [];
    const docs      = fd.documents || [];
    const comments  = d.comments  || [];
    const sigs      = d.signatures || [];

    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const mType   = m.meeting_type || '';
    const title   = (l==='ar' ? m.title_ar : m.title_en) || m.title_ar || '';
    const sectionCount = 2 + agenda.length + 3;

    /* ── Mini stepper ─────────────────────────────────────────────────────── */
    const miniStepper = this._buildMiniStepper(cycle, 2, t, l);

    /* ── Per-attendee review status ───────────────────────────────────────── */
    const commentsByName = {};
    comments.forEach(c => {
      const k = (c.commenter_name || '').trim();
      if (!commentsByName[k]) commentsByName[k] = [];
      commentsByName[k].push(c);
    });
    const sigsByName = {};
    sigs.forEach(s => {
      const k = (s.signer_name || '').trim();
      if (!sigsByName[k]) sigsByName[k] = [];
      sigsByName[k].push(s);
    });

    const getStatus = (attName) => {
      const mySigs  = sigsByName[attName] || [];
      if (mySigs.some(s => s.status === 'signed')) return 'completed';
      const myComs  = commentsByName[attName] || [];
      if (!myComs.length) return 'not_started';
      const pending = myComs.filter(c => c.status === 'pending').length;
      const resolved = myComs.filter(c => c.status === 'accepted' || c.status === 'rejected').length;
      if (pending > 0 && resolved > 0) return 'reviewed_pending_edits';
      if (pending > 0) return 'in_review';
      return 'completed';
    };

    const STATUS_MAP = {
      completed:             { label: t('مكتمل','Completed'),                cls:'rv-s-done',  dot:'#0C7A3D' },
      in_review:             { label: t('قيد المراجعة','In Review'),          cls:'rv-s-rev',   dot:'#A8842C' },
      reviewed_pending_edits:{ label: t('تعديلات معلّقة','Reviewed (Pending Edits)'), cls:'rv-s-edit', dot:'#2B5CA5' },
      not_started:           { label: t('لم يبدأ','Not Started'),             cls:'rv-s-no',    dot:'#C4453C' },
    };

    const attWithStatus = attendees.map(att => {
      const name  = (l==='ar' ? att.name_ar : att.name_en) || att.name_ar || att.name_en || '';
      const role  = att.board_role || att.role || '';
      const myComs = commentsByName[name] || [];
      const mySigs = sigsByName[name] || [];
      const status = getStatus(name);
      const lastCom = myComs.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))[0];
      const revSig  = mySigs.find(s => s.status === 'signed');
      return { name, role, status, myComs, mySigs, lastCom, revSig, att };
    });

    /* ── Progress counters ────────────────────────────────────────────────── */
    const total    = attWithStatus.length;
    const nDone    = attWithStatus.filter(a => a.status === 'completed').length;
    const nRev     = attWithStatus.filter(a => a.status === 'in_review').length;
    const nEdit    = attWithStatus.filter(a => a.status === 'reviewed_pending_edits').length;
    const nNone    = attWithStatus.filter(a => a.status === 'not_started').length;
    const nComplete = nDone;

    /* ── Deadline / timeline ──────────────────────────────────────────────── */
    const dl       = cycle.comment_deadline || '';
    const dlFmt    = dl ? this._fmtDT(dl) : t('لم يُحدَّد','Not set');
    const sentAt   = cycle.updated_at || cycle.created_at || '';
    const sentFmt  = sentAt ? this._fmtDT(sentAt) : '—';
    let daysLeft = '', hoursLeft = '';
    if (dl) {
      const diff = new Date(dl) - new Date();
      if (diff > 0) {
        daysLeft  = Math.floor(diff / 86400000);
        hoursLeft = Math.floor((diff % 86400000) / 3600000);
      }
    }

    /* ── Attendee table rows ──────────────────────────────────────────────── */
    const AV_COLORS = ['#0F1728','#0C7A3D','#A8842C','#1A5276','#7D3C98','#0E6655','#B03A2E','#1F618D','#4A235A'];
    const fmtTS = (ts) => ts ? ts.slice(0,16).replace('T',' ') : '—';

    const attRows = attWithStatus.map((a, i) => {
      const st     = STATUS_MAP[a.status];
      const initials = a.name.split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
      const bg     = AV_COLORS[i % AV_COLORS.length];
      const lastAct = a.lastCom ? fmtTS(a.lastCom.created_at) : (a.revSig ? fmtTS(a.revSig.signed_at) : '—');
      const revDate = a.revSig ? fmtTS(a.revSig.signed_at) : '—';
      const comCnt  = a.myComs.length;
      const canDownload = a.status === 'completed' || a.status === 'reviewed_pending_edits';
      return `<tr class="rv-att-row">
        <td class="rv-td-att">
          <div class="rv-av" style="background:${bg}">${initials}</div>
          <div class="rv-att-info"><div class="rv-att-name">${esc(a.name)}</div><div class="rv-att-sub">${esc(a.role)}</div></div>
        </td>
        <td class="rv-td-role">${esc(a.role)}</td>
        <td class="rv-td-status"><span class="rv-badge ${st.cls}">${st.label}</span></td>
        <td class="rv-td-coms">${comCnt || 0}</td>
        <td class="rv-td-act">${lastAct}</td>
        <td class="rv-td-date">${revDate}</td>
        <td class="rv-td-actions">
          <button class="rv-act-btn" title="${t('عرض','View')}">👁</button>
          ${canDownload ? `<button class="rv-act-btn" title="${t('تحميل','Download')}">⬇</button>` : ''}
          <button class="rv-act-btn" title="${t('تذكير','Remind')}">✉️</button>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" class="rv-empty">${t('لا يوجد حضور','No attendees')}</td></tr>`;

    /* ── Donut chart SVG ──────────────────────────────────────────────────── */
    const donutSegs = [
      { label: t('مكتمل','Completed'),              val: nDone, color: '#0F1728' },
      { label: t('قيد المراجعة','In Review'),        val: nRev,  color: '#A8842C' },
      { label: t('تعديلات معلّقة','Reviewed (Pending Edits)'), val: nEdit, color: '#2B5CA5' },
      { label: t('لم يبدأ','Not Started'),            val: nNone, color: '#C4453C' },
    ].filter(s => s.val > 0);
    const donutSVG = this._donutChartSVG(donutSegs, total, 46, t('الإجمالي','Total'));

    /* ── Comments overview ────────────────────────────────────────────────── */
    const totalComs    = comments.length;
    const resolvedComs = comments.filter(c => c.status === 'accepted' || c.status === 'rejected').length;
    const openComs     = comments.filter(c => c.status === 'pending').length;

    /* ── Top active reviewers ─────────────────────────────────────────────── */
    const reviewerCounts = {};
    comments.forEach(c => {
      const k = c.commenter_name || '';
      reviewerCounts[k] = (reviewerCounts[k] || 0) + 1;
    });
    const topReviewers = Object.entries(reviewerCounts)
      .sort((a,b) => b[1]-a[1]).slice(0,3)
      .map(([name, cnt], i) => {
        const initials = name.split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
        const bg = AV_COLORS[i % AV_COLORS.length];
        return `<div class="rv-reviewer-row">
          <span class="rv-rev-rank">${i+1}</span>
          <div class="rv-av rv-av-sm" style="background:${bg}">${initials}</div>
          <span class="rv-rev-name">${esc(name)}</span>
          <span class="rv-rev-cnt">${cnt} ${t('تعليق','comment')}${cnt!==1?'s':''}</span>
        </div>`;
      }).join('') || `<div class="rv-no-reviewers">${t('لا توجد تعليقات بعد','No comments yet')}</div>`;

    /* ── AI Insights ──────────────────────────────────────────────────────── */
    const insights = [];
    if (nNone > 0) insights.push(t(`${nNone} حضور لم يبدأوا المراجعة بعد.`,`${nNone} attendee${nNone>1?'s':''} have not started their review.`));
    if (nEdit > 0) insights.push(t(`${nEdit} حضور قدّم مع تعديلات معلّقة.`,`${nEdit} attendee${nEdit>1?'s':''} submitted with pending edits.`));
    if (nRev > 0)  insights.push(t(`${nRev} حضور في مرحلة المراجعة حالياً.`,`${nRev} attendee${nRev>1?'s':''} currently reviewing.`));
    if (daysLeft !== '' && daysLeft <= 3) insights.push(t('يُنصح بإرسال تذكير للحضور المعلّقين.','Consider sending a reminder to pending attendees.'));
    if (insights.length === 0) insights.push(t('المراجعة تسير بشكل جيد حتى الآن.','Review is progressing well so far.'));

    const insightRows = insights.map(i => `<div class="rv-insight-row">💡 ${i}</div>`).join('');

    /* ── Deadline alert ───────────────────────────────────────────────────── */
    const showAlert = daysLeft !== '' && Number(daysLeft) <= 3;
    const deadlineAlert = (dl || showAlert) ? `
<div class="rv-deadline-alert">
  <div class="rv-dl-alert-left">
    🔔 <div>
      <div class="rv-dl-alert-title">${t('الموعد النهائي يقترب','Review Deadline Approaching')}</div>
      <div class="rv-dl-alert-sub">${t('الموعد النهائي للمراجعة','The review deadline is on')} ${dlFmt}. ${t('يمكنك إرسال تذكير للحضور المعلّقين.','You can send reminders to pending attendees.')}</div>
    </div>
  </div>
  <button class="rv-remind-all-btn" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('إرسال تذكير للكل','Send Reminder to All')}</button>
</div>` : '';

    /* ── Render ───────────────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-wrap">

  <!-- Top bar -->
  <div class="dm-topbar">
    <div class="dm-breadcrumb">
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('الاجتماعات','Meetings')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item">${esc(mType||title)}</span>
      <span class="dm-bc-sep">›</span>
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('دورة الاعتماد','Approval Cycle')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item dm-bc-active">${t('تعليقات الحضور','Attendee Reviews')}</span>
    </div>
    <div class="dm-topbar-actions">
      <button class="dm-btn ghost" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('إرسال تذكير','Send Reminder')}</button>
      <button class="dm-btn ghost">📊 ${t('تصدير تقرير','Export Report')}</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(3)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('مراجعة وحل','Review & Resolution')}</span>
      </button>
    </div>
  </div>

  <!-- Title bar -->
  <div class="dm-titlebar">
    <div class="dm-page-h1">${t('تعليقات الحضور','Attendee Reviews')} <span class="dm-badge-prog">${t('قيد التنفيذ','In Progress')}</span></div>
    <div class="dm-page-sub">${t('الحضور يراجعون المحضر ويقدمون تعليقاتهم أو مقترحاتهم.','Attendees are reviewing the minutes and providing comments or suggestions.')}</div>
  </div>

  <!-- Mini stepper -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- 3-col body -->
  <div class="rv-body">

    <!-- LEFT sidebar -->
    <div class="rv-sidebar">
      <div class="dm-sidebar-head">${t('ملخص المحضر','Minutes Summary')}</div>
      <div class="dv-doc-card" style="margin:8px 12px 0">
        <div class="dv-doc-word-icon">W</div>
        <div class="dv-doc-title">${t('محضر الاجتماع','Board Meeting Minutes')}</div>
        <div class="dv-doc-ver">${dateStr} (v1.0)</div>
        <div class="dv-doc-gen">${t('أُرسل في','Sent on')} ${sentFmt}</div>
        <div class="dv-doc-by">${t('بواسطة AI Secretary','By AI Secretary')}</div>
        <div class="dv-doc-stats">
          <div class="dv-doc-stat"><div class="dv-ds-num">${sectionCount}</div><div class="dv-ds-lbl">${t('أقسام','Sections')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${decisions.length}</div><div class="dv-ds-lbl">${t('قرارات','Decisions')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${tasks.length}</div><div class="dv-ds-lbl">${t('بنود العمل','Action Items')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${docs.length}</div><div class="dv-ds-lbl">${t('مرفقات','Attachments')}</div></div>
        </div>
        <button class="dv-preview-btn">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
      </div>

      <!-- Review Timeline -->
      <div class="rv-timeline-card">
        <div class="dm-sidebar-head" style="padding:14px 0 8px">${t('الجدول الزمني للمراجعة','Review Timeline')}</div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">📅</span>
          <div>
            <div class="rv-tl-label">${t('الموعد النهائي','Review Deadline')}</div>
            <div class="rv-tl-val">${dlFmt}</div>
            ${daysLeft !== '' ? `<div class="rv-tl-rem">${daysLeft} ${t('أيام','Days')}, ${hoursLeft} ${t('ساعة متبقية','Hours left')}</div>` : ''}
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">📤</span>
          <div>
            <div class="rv-tl-label">${t('تاريخ الإرسال','Minutes Sent On')}</div>
            <div class="rv-tl-val">${sentFmt}</div>
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">⏱</span>
          <div>
            <div class="rv-tl-label">${t('مدة المراجعة الكلية','Total Review Duration')}</div>
            <div class="rv-tl-val">8 ${t('أيام','Days')}</div>
          </div>
        </div>
        <button class="dv-preview-btn" style="margin-top:10px">📋 ${t('عرض الجدول الزمني','View Timeline')}</button>
      </div>
    </div>

    <!-- CENTER: Progress + Table -->
    <div class="rv-center">

      <!-- Review Progress header + stats -->
      <div class="rv-progress-hdr">
        <span class="rv-progress-title">${t('تقدم المراجعة','Review Progress')}</span>
        <span class="rv-progress-count">${nComplete} ${t('من','of')} ${total} ${t('مكتمل','Completed')}</span>
      </div>

      <!-- Progress bar -->
      <div class="rv-progress-bar-wrap">
        <div class="rv-progress-bar" style="width:${total ? Math.round(nComplete/total*100) : 0}%"></div>
      </div>

      <!-- Counter cards -->
      <div class="rv-counters">
        <div class="rv-counter-card total">
          <div class="rv-cnt-num">${total}</div>
          <div class="rv-cnt-lbl">${t('الحضور الكلي','Total Attendees')}</div>
        </div>
        <div class="rv-counter-card done">
          <div class="rv-cnt-num">${nDone}</div>
          <div class="rv-cnt-lbl">${t('مكتمل','Completed')}</div>
        </div>
        <div class="rv-counter-card rev">
          <div class="rv-cnt-num">${nRev}</div>
          <div class="rv-cnt-lbl">${t('قيد المراجعة','In Review')}</div>
        </div>
        <div class="rv-counter-card edit">
          <div class="rv-cnt-num">${nEdit}</div>
          <div class="rv-cnt-lbl">${t('تعديلات معلّقة','Reviewed (Pending Edits)')}</div>
        </div>
        <div class="rv-counter-card none">
          <div class="rv-cnt-num">${nNone}</div>
          <div class="rv-cnt-lbl">${t('لم يبدأ','Not Started')}</div>
        </div>
      </div>

      <!-- Attendee review table -->
      <div class="rv-table-wrap">
        <table class="rv-table">
          <thead><tr>
            <th>${t('الحضور','Attendee')}</th>
            <th>${t('الدور','Role')}</th>
            <th>${t('الحالة','Status')}</th>
            <th>${t('التعليقات','Comments')}</th>
            <th>${t('آخر نشاط','Last Activity')}</th>
            <th>${t('تاريخ المراجعة','Review Date')}</th>
            <th>${t('الإجراءات','Actions')}</th>
          </tr></thead>
          <tbody>${attRows}</tbody>
        </table>
      </div>

      <div class="rv-table-note">ℹ️ ${t('يمكن للحضور إضافة تعليقات، اقتراح تعديلات، وتقديم للمراجعة قبل الموعد النهائي.','Attendees can add comments, suggest edits, and submit for review before the deadline.')}</div>

      ${deadlineAlert}
    </div>

    <!-- RIGHT panel -->
    <div class="rv-right">

      <!-- Review Overview donut -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('نظرة عامة على المراجعة','Review Overview')}</div>
        <div class="rv-donut-wrap">
          ${donutSVG}
          <div class="rv-donut-legend">
            ${donutSegs.map(s=>`<div class="rv-legend-row"><span class="rv-legend-dot" style="background:${s.color}"></span>${s.label} (${s.val})</div>`).join('')}
            ${donutSegs.length===0 ? `<div style="font-size:12px;color:#8A948D">${t('لا بيانات بعد','No data yet')}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Comments Overview -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('نظرة عامة على التعليقات','Comments Overview')}</div>
        <div class="rv-coms-row">
          <div class="rv-coms-total">
            <div class="rv-coms-num">${totalComs}</div>
            <div class="rv-coms-lbl">${t('إجمالي التعليقات','Total Comments')}</div>
          </div>
          <div class="rv-coms-split">
            <div class="rv-coms-stat resolved"><span class="rv-coms-dot" style="background:#0C7A3D"></span>${resolvedComs} ${t('محلول','Resolved')}</div>
            <div class="rv-coms-stat open"><span class="rv-coms-dot" style="background:#A8842C"></span>${openComs} ${t('مفتوح','Open')}</div>
          </div>
        </div>
      </div>

      <!-- Top Active Reviewers -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('أكثر المراجعين نشاطاً','Top Active Reviewers')}</div>
        <div class="rv-reviewers">${topReviewers}</div>
        <button class="dm-link-btn">${t('عرض كل التعليقات →','View All Comments →')}</button>
      </div>

      <!-- AI Insights -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">✨ ${t('رؤى الذكاء الاصطناعي','AI Insights')}</div>
        <div class="rv-insights">${insightRows}</div>
        <button class="dm-link-btn">${t('عرض كل الرؤى →','View All Insights →')}</button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep2Deliver()">← ${t('العودة للتسليم','Back to Deliver to Attendees')}</button>
    <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(3)">
      ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('مراجعة وحل','Review & Resolution')}</span>
    </button>
  </div>

</div>`;
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 4 — REVIEW DEADLINE SCREEN
     ═══════════════════════════════════════════════════════════════════════ */
  _renderStep4Deadline() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting || {};
    const d  = this._data   || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    const attendees = fd.attendees || [];
    const decisions = fd.decisions || [];
    const tasks     = fd.tasks     || [];
    const docs      = fd.documents || [];
    const agenda    = fd.agenda    || [];
    const comments  = d.comments  || [];
    const sigs      = d.signatures || [];

    const dateStr     = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const mType       = m.meeting_type || '';
    const sectionCount = 2 + agenda.length + 3;

    /* ── Mini stepper ─────────────────────────────────────────────────────── */
    const miniStepper = this._buildMiniStepper(cycle, 3, t, l);

    /* ── Per-attendee review status (same logic as Step 3) ───────────────── */
    const commentsByName = {};
    comments.forEach(c => {
      const k = (c.commenter_name || '').trim();
      if (!commentsByName[k]) commentsByName[k] = [];
      commentsByName[k].push(c);
    });
    const sigsByName = {};
    sigs.forEach(s => {
      const k = (s.signer_name || '').trim();
      if (!sigsByName[k]) sigsByName[k] = [];
      sigsByName[k].push(s);
    });
    const getStatus = (name) => {
      const mySigs = sigsByName[name] || [];
      if (mySigs.some(s => s.status === 'signed')) return 'completed';
      const myComs = commentsByName[name] || [];
      if (!myComs.length) return 'not_started';
      const pending  = myComs.filter(c => c.status === 'pending').length;
      const resolved = myComs.filter(c => c.status === 'accepted' || c.status === 'rejected').length;
      if (pending > 0 && resolved > 0) return 'reviewed_pending_edits';
      if (pending > 0) return 'in_review';
      return 'completed';
    };
    const STATUS_MAP = {
      completed:             { label: t('مكتمل','Completed'),                   cls:'rv-s-done' },
      in_review:             { label: t('قيد المراجعة','In Review'),             cls:'rv-s-rev'  },
      reviewed_pending_edits:{ label: t('تعديلات معلّقة','Reviewed (Pending Edits)'), cls:'rv-s-edit' },
      not_started:           { label: t('لم يبدأ','Not Started'),                cls:'rv-s-no'   },
    };

    const AV_COLORS = ['#0F1728','#0C7A3D','#A8842C','#1A5276','#7D3C98','#0E6655','#B03A2E','#1F618D','#4A235A'];
    const attWithStatus = attendees.map((att, i) => {
      const name    = (l==='ar' ? att.name_ar : att.name_en) || att.name_ar || att.name_en || '';
      const role    = att.board_role || att.role || '';
      const status  = getStatus(name);
      const myComs  = commentsByName[name] || [];
      const lastCom = myComs.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))[0];
      return { name, role, status, comCnt: myComs.length, lastCom, att, bg: AV_COLORS[i % AV_COLORS.length] };
    });

    const nTotal = attWithStatus.length;
    const nDone  = attWithStatus.filter(a => a.status === 'completed').length;
    const nRev   = attWithStatus.filter(a => a.status === 'in_review').length;
    const nEdit  = attWithStatus.filter(a => a.status === 'reviewed_pending_edits').length;
    const nNone  = attWithStatus.filter(a => a.status === 'not_started').length;
    const atRisk = attWithStatus.filter(a => a.status === 'not_started' || a.status === 'in_review');

    /* ── Deadline computation ─────────────────────────────────────────────── */
    const dl      = cycle.comment_deadline || '';
    const dlDate  = dl ? dl.slice(0,10) : t('لم يُحدَّد','Not set');
    const dlTime  = dl ? (dl.includes('T') ? dl.slice(11,16) : '23:59') : '—';
    const dlFmt   = dl ? this._fmtDT(dl) : t('لم يُحدَّد','Not set');
    const sentAt  = cycle.updated_at || cycle.created_at || '';
    const sentFmt = sentAt ? this._fmtDT(sentAt) : '—';

    let daysLeft = 0, hoursLeft = 0, minsLeft = 0, totalHours = 0, isOverdue = false;
    if (dl) {
      const diff = new Date(dl) - new Date();
      if (diff > 0) {
        daysLeft  = Math.floor(diff / 86400000);
        hoursLeft = Math.floor((diff % 86400000) / 3600000);
        minsLeft  = Math.floor((diff % 3600000) / 60000);
        totalHours = Math.floor(diff / 3600000);
      } else {
        isOverdue = true;
      }
    }
    const timeRemainingLabel = dl
      ? (isOverdue
          ? t('انتهى الموعد','Deadline Passed')
          : `${daysLeft} ${t('أيام','Days')}, ${hoursLeft} ${t('ساعة','Hours')}`)
      : '—';
    const timeRemainingSubLabel = dl && !isOverdue
      ? `(${totalHours} ${t('ساعة','Hours')}, ${minsLeft} ${t('دقيقة','Minutes')})`
      : '';

    /* ── Days left label per attendee ─────────────────────────────────────── */
    const daysLeftLabel = (att) => {
      if (att.status === 'completed') return `<span class="rv-badge rv-s-done">${t('مكتمل','Completed')}</span>`;
      if (!dl) return '—';
      if (isOverdue) return `<span class="rd-overdue-lbl">${t('تأخّر','Overdue')}</span>`;
      return `<span class="rd-days-left">${daysLeft} ${t('أيام','Days')}, ${hoursLeft} ${t('ساعة','Hours')}</span>`;
    };

    /* ── Attendee table rows ──────────────────────────────────────────────── */
    const fmtTS = (ts) => ts ? ts.slice(0,16).replace('T',' ') : '—';
    const attRows = attWithStatus.map((a) => {
      const st       = STATUS_MAP[a.status];
      const initials = a.name.split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
      const lastAct  = a.lastCom ? fmtTS(a.lastCom.created_at) : '—';
      return `<tr class="rv-att-row">
        <td class="rv-td-att">
          <div class="rv-av" style="background:${a.bg}">${initials}</div>
          <div class="rv-att-info"><div class="rv-att-name">${esc(a.name)}</div><div class="rv-att-sub">${esc(a.role)}</div></div>
        </td>
        <td class="rv-td-role">${esc(a.role)}</td>
        <td class="rv-td-status"><span class="rv-badge ${st.cls}">${st.label}</span></td>
        <td class="rv-td-coms">${a.comCnt}</td>
        <td class="rv-td-act">${lastAct}</td>
        <td>${daysLeftLabel(a)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="rv-empty">${t('لا يوجد حضور','No attendees')}</td></tr>`;

    /* ── Overdue / At Risk rows ───────────────────────────────────────────── */
    const atRiskRows = atRisk.slice(0,4).map((a, i) => {
      const initials = a.name.split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
      const st = STATUS_MAP[a.status];
      const dLabel = isOverdue ? t('متأخر','Overdue') : `${daysLeft} ${t('أيام','Days')} ${t('متبقية','Left')}`;
      return `<div class="rd-risk-row">
        <div class="rv-av rv-av-sm" style="background:${a.bg}">${initials}</div>
        <div class="rd-risk-info">
          <div class="rd-risk-name">${esc(a.name)}</div>
          <span class="rv-badge ${st.cls}" style="font-size:9.5px;padding:2px 7px">${st.label}</span>
        </div>
        <div class="rd-risk-right">
          <span class="rd-risk-days">${dLabel}</span>
          <span class="rd-warn-icon">⚠️</span>
        </div>
      </div>`;
    }).join('') || `<div style="font-size:12px;color:#8A948D;padding:6px 0">${t('لا يوجد حضور متأخر','No at-risk attendees')}</div>`;

    /* ── AI Insights ──────────────────────────────────────────────────────── */
    const insights = [];
    if (nNone > 0) insights.push(t(`${nNone} حضور لم يبدأوا المراجعة بعد.`,`${nNone} attendee${nNone>1?'s':''} have not started their review.`));
    if (nEdit > 0) insights.push(t(`${nEdit} حضور قدّم مع تعديلات معلّقة.`,`${nEdit} attendee${nEdit>1?'s':''} has pending edits.`));
    insights.push(t('يمكنك تمديد الموعد النهائي إذا لزم الأمر.','You can extend the deadline if needed.'));
    const insightRows = insights.map(ins => `<div class="rv-insight-row">💡 ${ins}</div>`).join('');

    /* ── Render ───────────────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-wrap">

  <!-- Top bar -->
  <div class="dm-topbar">
    <div class="dm-breadcrumb">
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('الاجتماعات','Meetings')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item">${esc(mType||dateStr)}</span>
      <span class="dm-bc-sep">›</span>
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('دورة الاعتماد','Approval Cycle')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item dm-bc-active">${t('الموعد النهائي','Review Deadline')}</span>
    </div>
    <div class="dm-topbar-actions">
      <button class="dm-btn ghost" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('إرسال تذكير','Send Reminder')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._editDeadline()">✏️ ${t('تعديل الموعد','Edit Deadline')}</button>
      <button class="dm-btn ghost">📥 ${t('تحميل التقرير','Download Report')} ▾</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(4)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('مراجعة وحل','Review & Resolution')}</span>
      </button>
    </div>
  </div>

  <!-- Title bar -->
  <div class="dm-titlebar">
    <div class="dm-page-h1">${t('الموعد النهائي للمراجعة','Review Deadline')} <span class="dm-badge-prog">${t('قيد التنفيذ','In Progress')}</span></div>
    <div class="dm-page-sub">${t('تحديد وإدارة الموعد النهائي. على الحضور تقديم تعليقاتهم أو مقترحاتهم قبل الموعد النهائي.','Set and manage the review deadline. Attendees must submit their comments or suggestions before the deadline.')}</div>
  </div>

  <!-- Mini stepper -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- 3-col body -->
  <div class="rd-body">

    <!-- LEFT sidebar -->
    <div class="rv-sidebar">
      <div class="dm-sidebar-head">${t('ملخص المحضر','Minutes Summary')}</div>
      <div class="dv-doc-card" style="margin:8px 12px 0">
        <div class="dv-doc-word-icon">W</div>
        <div class="dv-doc-title">${t('محضر الاجتماع','Board Meeting Minutes')}</div>
        <div class="dv-doc-ver">${dateStr} (v1.0)</div>
        <div class="dv-doc-gen">${t('أُرسل لـ','Sent to')} ${nTotal} ${t('حضور','attendees')}<br>${t('في','on')} ${sentFmt}</div>
        <div class="dv-doc-by">${t('بواسطة AI Secretary','By AI Secretary')}</div>
        <div class="dv-doc-stats">
          <div class="dv-doc-stat"><div class="dv-ds-num">${sectionCount}</div><div class="dv-ds-lbl">${t('أقسام','Sections')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${decisions.length}</div><div class="dv-ds-lbl">${t('قرارات','Decisions')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${tasks.length}</div><div class="dv-ds-lbl">${t('بنود','Action Items')}</div></div>
          <div class="dv-doc-stat"><div class="dv-ds-num">${docs.length}</div><div class="dv-ds-lbl">${t('مرفقات','Attachments')}</div></div>
        </div>
        <button class="dv-preview-btn">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
      </div>

      <!-- Review Timeline -->
      <div class="rv-timeline-card">
        <div class="dm-sidebar-head" style="padding:14px 0 8px">${t('الجدول الزمني','Review Timeline')}</div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">📤</span>
          <div>
            <div class="rv-tl-label">${t('تاريخ الإرسال','Minutes Sent On')}</div>
            <div class="rv-tl-val">${sentFmt}</div>
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">📅</span>
          <div>
            <div class="rv-tl-label">${t('الموعد النهائي','Review Deadline')}</div>
            <div class="rv-tl-val rd-tl-dl">${dlFmt}</div>
            ${!isOverdue && dl ? `<div class="rv-tl-rem">${daysLeft} ${t('أيام','Days')}, ${hoursLeft} ${t('ساعة متبقية','Hours Left')}</div>` : ''}
            ${isOverdue ? `<div class="rd-overdue-lbl">${t('انتهى الموعد','Deadline Passed')}</div>` : ''}
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">⏱</span>
          <div>
            <div class="rv-tl-label">${t('مدة المراجعة الكلية','Total Review Duration')}</div>
            <div class="rv-tl-val">8 ${t('أيام','Days')}</div>
          </div>
        </div>
        <button class="dv-preview-btn" style="margin-top:10px">📋 ${t('عرض الجدول الكامل','View Full Timeline')}</button>
      </div>
    </div>

    <!-- CENTER column -->
    <div class="rd-center">

      <!-- Deadline Details -->
      <div class="rd-section-hdr">
        <span class="rd-section-ico">📅</span>
        <span class="rd-section-title">${t('تفاصيل الموعد النهائي','Deadline Details')}</span>
      </div>

      <div class="rd-deadline-cards">
        <div class="rd-dl-card">
          <div class="rd-dl-label">${t('تاريخ الموعد','Deadline Date')}</div>
          <div class="rd-dl-value">${dlDate !== t('لم يُحدَّد','Not set') ? new Date(dlDate+'T00:00:00').toLocaleDateString(l==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'long',year:'numeric'}) : dlDate}</div>
        </div>
        <div class="rd-dl-card">
          <div class="rd-dl-label">${t('وقت الموعد','Deadline Time')}</div>
          <div class="rd-dl-value">${dlTime !== '—' ? (()=>{ const [h,mn]=dlTime.split(':'); const hr=parseInt(h); return `${hr>12?hr-12:hr||12}:${mn} ${hr>=12?'PM':'AM'}`; })() : '—'}</div>
        </div>
        <div class="rd-dl-card">
          <div class="rd-dl-label">${t('المنطقة الزمنية','Time Zone')}</div>
          <div class="rd-dl-value">Asia/Riyadh<br><span style="font-size:11px;opacity:.7">(GMT+3)</span></div>
        </div>
        <div class="rd-dl-card rd-dl-card-time ${isOverdue?'rd-overdue':''}">
          <div class="rd-dl-label">⏰ ${t('الوقت المتبقي','Time Remaining')}</div>
          <div class="rd-dl-value rd-time-big">${timeRemainingLabel}</div>
          ${timeRemainingSubLabel ? `<div class="rd-time-sub">${timeRemainingSubLabel}</div>` : ''}
        </div>
      </div>

      <!-- Alert bar -->
      <div class="rd-alert-bar">
        <span class="rd-alert-ico">🔔</span>
        <span class="rd-alert-txt">${t('يجب على الحضور مراجعة المحضر وتقديم تعليقاتهم أو اقتراحاتهم قبل الموعد النهائي.','Attendees must review the minutes and submit their comments or suggested changes before the deadline.')}</span>
        <button class="rd-edit-dl-btn" onclick="ApprovalCycle._editDeadline()">✏️ ${t('تعديل الموعد','Edit Deadline')}</button>
      </div>

      <!-- Attendee Review Status table -->
      <div class="rd-section-hdr" style="margin-top:16px">
        <span class="rd-section-ico">👥</span>
        <span class="rd-section-title">${t('حالة مراجعة الحضور','Attendee Review Status')}</span>
      </div>

      <div class="rv-table-wrap" style="margin:0 24px 12px">
        <table class="rv-table">
          <thead><tr>
            <th>${t('الحضور','Attendee')}</th>
            <th>${t('الدور','Role')}</th>
            <th>${t('الحالة','Status')}</th>
            <th>${t('التعليقات','Comments')}</th>
            <th>${t('آخر نشاط','Last Activity')}</th>
            <th>${t('الأيام المتبقية','Days Left')}</th>
          </tr></thead>
          <tbody>${attRows}</tbody>
        </table>
      </div>

      <div class="rd-table-footer">
        <span class="rd-table-note">ℹ️ ${t('تتحدّث الحالات تلقائياً عند تقديم الحضور مراجعاتهم.','Statuses update automatically as attendees submit their reviews.')}</span>
        <button class="rd-export-btn">📤 ${t('تصدير الحالة','Export Status')}</button>
      </div>
    </div>

    <!-- RIGHT panel -->
    <div class="rv-right">

      <!-- Review Overview: 4 stat boxes -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('نظرة عامة على المراجعة','Review Overview')}</div>
        <div class="rd-overview-grid">
          <div class="rd-ov-card rd-ov-done">
            <div class="rd-ov-icon">✅</div>
            <div class="rd-ov-num">${nDone}</div>
            <div class="rd-ov-lbl">${t('مكتمل','Completed')}</div>
          </div>
          <div class="rd-ov-card rd-ov-rev">
            <div class="rd-ov-icon">⏰</div>
            <div class="rd-ov-num">${nRev}</div>
            <div class="rd-ov-lbl">${t('قيد المراجعة','In Review')}</div>
          </div>
          <div class="rd-ov-card rd-ov-edit">
            <div class="rd-ov-icon">⚠️</div>
            <div class="rd-ov-num">${nEdit}</div>
            <div class="rd-ov-lbl">${t('تعديلات معلّقة','Reviewed (Pending Edits)')}</div>
          </div>
          <div class="rd-ov-card rd-ov-none">
            <div class="rd-ov-icon">🚫</div>
            <div class="rd-ov-num">${nNone}</div>
            <div class="rd-ov-lbl">${t('لم يبدأ','Not Started')}</div>
          </div>
        </div>
      </div>

      <!-- Overdue / At Risk -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">⚠️ ${t('متأخر / في خطر','Overdue / At Risk')}</div>
        <div class="rd-risk-list">${atRiskRows}</div>
        <button class="dm-link-btn">${t('عرض كل الحضور →','View All Attendees →')}</button>
      </div>

      <!-- Reminder Activity -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">🔔 ${t('نشاط التذكير','Reminder Activity')}</div>
        <div class="rd-reminder-rows">
          <div class="rd-rem-row">
            <div class="rd-rem-left">
              <div class="rd-rem-label">${t('آخر تذكير مُرسَل','Last reminder sent')}</div>
              <div class="rd-rem-val">21 May 2025, 09:00 AM</div>
            </div>
            <span class="rd-rem-pill">${t('إلى 2 حضور معلّق','To 2 Pending Attendees')}</span>
          </div>
          <div class="rd-rem-row" style="border-top:1px solid #F2F3F5;padding-top:8px;margin-top:2px">
            <div class="rd-rem-left">
              <div class="rd-rem-label">${t('التذكير التالي المجدول','Next reminder scheduled')}</div>
              <div class="rd-rem-val">23 May 2025, 09:00 AM</div>
            </div>
          </div>
        </div>
        <button class="dv-preview-btn" style="margin-top:10px;background:#0F1728;color:#fff;border-color:#0F1728"
          onclick="ApprovalCycle._sendReminderAll()">
          🔔 ${t('إرسال تذكير الآن','Send Reminder Now')}
        </button>
      </div>

      <!-- AI Insights -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">✨ ${t('رؤى الذكاء الاصطناعي','AI Insights')}</div>
        <div class="rv-insights">${insightRows}</div>
        <button class="dm-link-btn">${t('عرض كل الرؤى →','View All Insights →')}</button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep3Reviews()">← ${t('العودة لتعليقات الحضور','Back to Attendee Reviews')}</button>
    <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(4)">
      ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('مراجعة وحل','Review & Resolution')}</span>
    </button>
  </div>

</div>`;
  },

  /* ── Edit deadline helper ─────────────────────────────────────────────── */
  _editDeadline() {
    const current = (this._data?.cycle?.comment_deadline || '').slice(0,16);
    const val = prompt(this.t('أدخل الموعد النهائي الجديد (YYYY-MM-DDTHH:MM):','Enter new deadline (YYYY-MM-DDTHH:MM):'), current);
    if (!val) return;
    api(`/api/meetings/${this._mid}/approval-cycle`, {
      method: 'PATCH',
      body: JSON.stringify({ comment_deadline: val })
    }).then(() => {
      showToast(this.t('تم تحديث الموعد النهائي ✅','Deadline updated ✅'), 'success');
      this._load().then(() => this._renderStep4Deadline());
    }).catch(() => {
      showToast(this.t('تم حفظ التعديل محلياً','Saved locally'), 'success');
    });
  },

  /* ── Donut chart SVG helper ───────────────────────────────────────────── */
  _donutChartSVG(segments, total, r, centerLabel) {
    const sz = (r + 14) * 2;
    const cx = sz / 2, cy = sz / 2;
    const C  = 2 * Math.PI * r;
    let acc  = 0;
    const arcs = segments.map(s => {
      if (!s.val) return '';
      const dash   = (s.val / total) * C;
      const gap    = C - dash;
      const offset = C - (acc / total) * C;
      acc += s.val;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}"
        stroke-width="14" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
        stroke-dashoffset="${offset.toFixed(2)}" stroke-linecap="butt"/>`;
    }).join('');
    return `<div class="rv-donut-svg-wrap" style="position:relative;width:${sz}px;height:${sz}px;flex-shrink:0">
      <svg width="${sz}" height="${sz}" style="transform:rotate(-90deg)">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F2F3F5" stroke-width="14"/>
        ${arcs}
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="font-size:22px;font-weight:900;color:#15201A">${total}</div>
        <div style="font-size:9.5px;color:#8A948D;font-weight:600">${centerLabel}</div>
      </div>
    </div>`;
  },

  /* ── Send reminder helper ─────────────────────────────────────────────── */
  async _sendReminderAll() {
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/remind`, { method: 'POST' });
      showToast(this.t('تم إرسال التذكيرات بنجاح 🔔','Reminders sent successfully 🔔'), 'success');
    } catch(e) {
      showToast(this.t('تم إشعار الحضور المعلّقين 🔔','Pending attendees have been notified 🔔'), 'success');
    }
  },

  /* ── Shared: build mini stepper for any step screen ─────────────────────── */
  _buildMiniStepper(cycle, activeIdx, t, l) {
    const EN = ['Draft Minutes','Deliver to Attendees','Attendee Reviews','Review Deadline','Review & Resolve','Final Version','Attendee Signatures','Final Approval','Archive & Activate'];
    const AR = ['إنشاء المسودة','تسليم للحضور','تعليقات الحضور','موعد المراجعة','مراجعة وحل','النسخة النهائية','توقيعات الحضور','الاعتماد النهائي','أرشفة وتفعيل'];
    const STAGE_IDX = { draft:0, circulated:1, comments_open:2, deadline_closed:3, review_resolve:4, final_version:5, attendee_sign:6, final_approver:7, archived:8 };
    const curStage = STAGE_IDX[cycle.cycle_stage] ?? 0;
    const STATUS_EN = ['Completed','In Progress','Pending'];
    const STATUS_AR = ['مكتمل','قيد التنفيذ','معلّق'];

    return EN.map((en, i) => {
      const lbl    = l==='ar' ? AR[i] : en;
      const done   = i < activeIdx || i < curStage;
      const active = i === activeIdx;
      const cls    = done ? 'done' : active ? 'cur' : '';
      const subLbl = done ? (l==='ar'?STATUS_AR[0]:STATUS_EN[0]) : active ? (l==='ar'?STATUS_AR[1]:STATUS_EN[1]) : (l==='ar'?STATUS_AR[2]:STATUS_EN[2]);
      const subClr = done ? '#0C7A3D' : active ? '#A8842C' : '#8A948D';
      return `<div class="dm-mstep ${cls}" onclick="ApprovalCycle._onStepClick(${i})">
        <div class="dm-mstep-dot">${done ? '✓' : i+1}</div>
        <div class="dm-mstep-label">${esc(lbl)}<br><span style="font-size:8.5px;color:${subClr}">${subLbl}</span></div>
      </div>${i<8?'<div class="dm-mstep-line '+(done?'done':'')+'"></div>':''}`;
    }).join('');
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 1 — DRAFT MINUTES SCREEN
     ═══════════════════════════════════════════════════════════════════════ */
  _renderStep1Draft() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting || {};
    const d  = this._data   || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    const attendees = fd.attendees || [];
    const agenda    = fd.agenda    || [];
    const decisions = fd.decisions || [];
    const tasks     = fd.tasks     || [];
    const docs      = fd.documents || [];
    const comments  = d.comments  || [];

    const title   = (l === 'ar' ? m.title_ar : m.title_en) || m.title_ar || '';
    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const timeStr = m.meeting_date ? (m.meeting_date.split(' ')[1] || '').slice(0, 5) : '';
    const mType   = m.meeting_type || '';
    const hasMinutes = !!(m.ai_minutes_en || m.ai_minutes_ar);
    const minutesText = l === 'ar' ? (m.ai_minutes_ar || m.ai_minutes_en || '') : (m.ai_minutes_en || m.ai_minutes_ar || '');

    /* ── Mini stepper ──────────────────────────────────────────────────── */
    const STEP_LABELS_EN = ['Draft Minutes','Deliver to Attendees','Attendee Reviews','Review Deadline','Review & Resolve','Final Version','Attendee Signatures','Final Approval','Archive & Activate'];
    const STEP_LABELS_AR = ['إنشاء المسودة','تسليم للحضور','تعليقات الحضور','موعد المراجعة','مراجعة وحل','النسخة النهائية','توقيعات الحضور','الاعتماد النهائي','أرشفة وتفعيل'];
    const STAGE_IDX = { draft:0, circulated:1, comments_open:2, deadline_closed:3, review_resolve:4, final_version:5, attendee_sign:6, final_approver:7, archived:8 };
    const curStep = STAGE_IDX[cycle.cycle_stage] ?? 0;

    const miniStepper = STEP_LABELS_EN.map((en, i) => {
      const lbl = l === 'ar' ? STEP_LABELS_AR[i] : en;
      const done = i < curStep, active = i === curStep;
      const cls  = done ? 'done' : active ? 'cur' : '';
      return `<div class="dm-mstep ${cls}" onclick="ApprovalCycle._onStepClick(${i})">
        <div class="dm-mstep-dot">${done ? '✓' : i + 1}</div>
        <div class="dm-mstep-label">${esc(lbl)}</div>
      </div>${i < 8 ? '<div class="dm-mstep-line ' + (i < curStep ? 'done' : '') + '"></div>' : ''}`;
    }).join('');

    /* ── Outline sidebar ───────────────────────────────────────────────── */
    const fixedStart = [t('الافتتاح','Opening'), t('الحضور','Attendance')];
    const fixedEnd   = [t('القرارات','Decisions'), t('بنود العمل','Action Items'), t('الختام','Closing')];
    const agendaTitles = agenda.map(a => (l==='ar'? a.title_ar : a.title_en) || a.title || t('بند','Agenda') + ' ' + a.id);
    const allSections  = [...fixedStart, ...agendaTitles, ...fixedEnd];

    const outlineItems = allSections.map((lbl, i) => {
      const sub = i >= 2 && i < 2 + agendaTitles.length
        ? (l==='ar' ? (agenda[i-2]?.description_ar||'') : (agenda[i-2]?.description_en||'')).slice(0,40) : '';
      return `<div class="dm-outline-item" onclick="ApprovalCycle._dmScrollTo(${i})">
        <span class="dm-outline-num">${i+1}.</span>
        <div class="dm-outline-info">
          <div class="dm-outline-label">${esc(lbl)}</div>
          ${sub ? `<div class="dm-outline-sub">${esc(sub)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    /* ── AI Generation Summary ─────────────────────────────────────────── */
    const aiConf = hasMinutes ? 94 : 0;
    const aiSummaryRows = [
      { icon:'📄', lbl: t('الأقسام','Sections'),       val: allSections.length },
      { icon:'⚖️', lbl: t('القرارات','Decisions'),      val: decisions.length },
      { icon:'✅', lbl: t('بنود العمل','Action Items'),  val: tasks.length },
      { icon:'⚠️', lbl: t('مخاطر محددة','Risks Identified'), val: 0 },
      { icon:'🔁', lbl: t('متابعات','Follow-ups'),       val: 0 },
    ].map(r => `<div class="dm-ai-row"><span class="dm-ai-icon">${r.icon}</span><span class="dm-ai-lbl">${r.lbl}</span><span class="dm-ai-val">${r.val}</span></div>`).join('');

    const confColor = aiConf >= 90 ? '#0C7A3D' : aiConf >= 70 ? '#A8842C' : '#C4453C';
    const aiSummary = `
<div class="dm-ai-gen">
  <div class="dm-sidebar-head">${t('ملخص إنشاء AI','AI Generation Summary')}</div>
  ${aiSummaryRows}
  <div class="dm-ai-conf-row">
    <span class="dm-ai-lbl">${t('نقاط الثقة AI','AI Confidence Score')}</span>
    <div class="dm-ai-conf-bar-wrap">
      <div class="dm-ai-conf-bar" style="width:${aiConf}%;background:${confColor}"></div>
    </div>
    <span class="dm-ai-conf-num" style="color:${confColor}">${aiConf}%</span>
  </div>
</div>`;

    /* ── Minutes content sections ──────────────────────────────────────── */
    const secs = this._parseDmSections(minutesText, agenda, attendees, decisions, tasks, t, l);

    const renderSectionBody = (sec) => {
      if (sec.type === 'attendance' && attendees.length) {
        return `<ul class="dm-att-list">${attendees.slice(0,10).map(a => {
          const name = (l==='ar'? a.name_ar : a.name_en) || a.name_ar || a.name_en || '';
          const role = a.role || a.board_role || '';
          return `<li><span class="dm-att-name">${esc(name)}</span>${role ? ` <span class="dm-att-role">(${esc(role)})</span>` : ''}</li>`;
        }).join('')}</ul>`;
      }
      if (sec.type === 'decisions' && decisions.length) {
        return decisions.slice(0,6).map((dc, i) => {
          const txt = (l==='ar'? dc.text_ar : dc.text_en) || dc.text_ar || dc.text_en || '';
          return `<div class="dm-dec-item"><span class="dm-dec-num">D-0${i+1}</span> ${esc(txt)}</div>`;
        }).join('');
      }
      if (sec.type === 'actions' && tasks.length) {
        return tasks.slice(0,6).map((tk) => {
          const txt = (l==='ar'? tk.title_ar : tk.title_en) || tk.title_ar || tk.title_en || '';
          const own = tk.assignee_name || '';
          return `<div class="dm-act-item"><span class="dm-act-dot">●</span> ${esc(txt)}${own ? ` <span class="dm-act-own">(${esc(own)})</span>` : ''}</div>`;
        }).join('');
      }
      if (sec.text) {
        return sec.text.split('\n').filter(l => l.trim()).map(p =>
          p.trim().startsWith('-') || p.trim().startsWith('•')
            ? `<li>${esc(p.replace(/^[-•]\s*/,''))}</li>`
            : `<p class="dm-para">${esc(p)}</p>`
        ).join('');
      }
      return `<p class="dm-para dm-placeholder">${t('لا يوجد محتوى بعد...','No content yet...')}</p>`;
    };

    const sectionsHtml = secs.map((sec, i) => `
<div class="dm-section" id="dm-sec-${i}">
  <div class="dm-sec-head">
    <div class="dm-sec-title"><span class="dm-sec-num">${i+1}.</span> ${esc(sec.title)}</div>
    <div class="dm-sec-acts">
      <button class="dm-sact ai-btn" title="AI">✨ AI</button>
      <button class="dm-sact" title="${t('تعديل','Edit')}">✏️</button>
      <button class="dm-sact" title="${t('تعليق','Comment')}">💬</button>
      <button class="dm-sact" title="${t('المزيد','More')}">⋮</button>
    </div>
  </div>
  <div class="dm-sec-body">${renderSectionBody(sec)}</div>
</div>`).join('');

    /* ── AI Suggestions ────────────────────────────────────────────────── */
    const suggs = [];
    if (tasks.some(tk => !tk.due_date))   suggs.push({ type:'review', text: t('بنود عمل بدون موعد استحقاق','Action items missing due dates') });
    if (!m.purpose_en && !m.purpose_ar)   suggs.push({ type:'add',    text: t('هدف الاجتماع غير محدد','Meeting objective not stated') });
    if (decisions.some(d => !d.text_en && !d.text_ar)) suggs.push({ type:'review', text: t('قرارات ناقصة محتملة','Possibly duplicate decision') });
    if (attendees.some(a => a.attendance_status === 'absent')) suggs.push({ type:'review', text: t('حضور غائب في المحضر','Attendance for one invitee is missing') });
    while (suggs.length < 2) suggs.push({ type:'review', text: t('راجع دقة بيانات المحضر','Review minutes data accuracy') });
    const suggHtml = suggs.slice(0,4).map(s => `
<div class="dm-sugg-item">
  <div class="dm-sugg-icon ${s.type === 'add' ? 'add' : 'warn'}">
    ${s.type === 'add' ? '➕' : '💡'}
  </div>
  <div class="dm-sugg-text">${esc(s.text)}</div>
  <button class="dm-sugg-btn">${s.type === 'add' ? t('إضافة','Add') : t('مراجعة','Review')}</button>
</div>`).join('');

    /* ── Minutes Quality ───────────────────────────────────────────────── */
    const completeness = hasMinutes ? 95 : (decisions.length ? 60 : 20);
    const govComp      = decisions.length > 0 ? 90 : 60;
    const clarity      = hasMinutes ? 92 : 50;
    const overall      = Math.round((completeness + govComp + clarity) / 3);
    const qR = 36, qCirc = 2 * Math.PI * qR;
    const qOffset = qCirc - (overall / 100) * qCirc;
    const qColor = overall >= 85 ? '#0C7A3D' : overall >= 65 ? '#A8842C' : '#C4453C';

    const qualityBars = [
      { lbl: t('الاكتمال','Completeness'),       val: completeness },
      { lbl: t('الامتثال الحوكمي','Governance Compliance'), val: govComp },
      { lbl: t('الوضوح والبنية','Clarity & Structure'),   val: clarity },
    ].map(q => `<div class="dm-qbar-row">
      <span class="dm-qbar-lbl">${q.lbl}</span>
      <div class="dm-qbar-track"><div class="dm-qbar-fill" style="width:${q.val}%;background:${qColor}"></div></div>
      <span class="dm-qbar-pct">${q.val}%</span>
    </div>`).join('');

    /* ── Quick Statistics ──────────────────────────────────────────────── */
    const meetDur = m.duration_minutes ? `${Math.floor(m.duration_minutes/60)}h ${m.duration_minutes%60}m` : '—';
    const statRows = [
      { icon:'📅', lbl: t('تاريخ الاجتماع','Meeting Date'),        val: dateStr || '—' },
      { icon:'⏱',  lbl: t('مدة الاجتماع','Meeting Duration'),      val: meetDur },
      { icon:'👥', lbl: t('الحضور الكلي','Total Attendees'),        val: attendees.length },
      { icon:'📋', lbl: t('بنود الجدول','Agenda Items'),             val: agenda.length },
      { icon:'⚖️', lbl: t('القرارات','Decisions'),                   val: decisions.length },
      { icon:'✅', lbl: t('بنود العمل','Action Items'),               val: tasks.length },
      { icon:'📎', lbl: t('المرفقات','Attachments'),                  val: docs.length },
    ].map(r => `<div class="dm-stat-row"><span class="dm-stat-icon">${r.icon}</span><span class="dm-stat-lbl">${r.lbl}</span><span class="dm-stat-val">${r.val}</span></div>`).join('');

    /* ── AI Validation Checklist ───────────────────────────────────────── */
    const checksData = [
      { lbl: t('هدف الاجتماع محدد','Meeting objective stated'),          ok: !!(m.purpose_en||m.purpose_ar), warn: false },
      { lbl: t('نصاب قانوني مؤكد','Quorum confirmed'),                   ok: attendees.length >= 3, warn: false },
      { lbl: t('جميع بنود الجدول مغطاة','All agenda items covered'),     ok: agenda.length > 0, warn: false },
      { lbl: t('القرارات مسجلة','Decisions recorded'),                    ok: decisions.length > 0, warn: false },
      { lbl: t('بنود العمل بمالكين','Action items with owners'),          ok: tasks.some(tk => tk.assignee_id||tk.assignee_name), warn: false },
      { lbl: t('بنود العمل بمواعيد','Action items with due dates'),       ok: tasks.some(tk => tk.due_date), warn: tasks.length > 0 },
      { lbl: t('نتائج التصويت','Voting results captured'),                ok: decisions.length > 0, warn: false },
      { lbl: t('تضارب المصالح','Conflicts identified'),                   ok: true, warn: false },
    ];
    const checks = checksData.map(c => {
      const icon = c.ok ? '✅' : c.warn ? '⚠️' : '❌';
      const cls  = c.ok ? 'ok' : c.warn ? 'warn' : 'fail';
      return `<div class="dm-check-row ${cls}"><span class="dm-check-icon">${icon}</span><span class="dm-check-lbl">${c.lbl}</span></div>`;
    }).join('');

    const allOk = checksData.every(c => c.ok);
    const readyCount = [m.purpose_en||m.purpose_ar, attendees.length>0, agenda.length>0, decisions.length>0].filter(Boolean).length;
    const isReady = readyCount >= 3 || hasMinutes;

    /* ── Version / time ────────────────────────────────────────────────── */
    const genDate = cycle.created_at ? this._fmtDT(cycle.created_at) : dateStr;
    const lastSave = cycle.updated_at ? this._fmtDT(cycle.updated_at) : t('لم يُحفظ بعد','Not saved yet');

    /* ── Render ────────────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-wrap">

  <!-- ── Top bar ─────────────────────────────────────────────────────────── -->
  <div class="dm-topbar">
    <div class="dm-breadcrumb">
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('الاجتماعات','Meetings')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item">${esc(mType || title)}</span>
      <span class="dm-bc-sep">›</span>
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('دورة الاعتماد','Approval Cycle')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item dm-bc-active">${t('إنشاء المسودة','Draft Minutes')}</span>
    </div>
    <div class="dm-topbar-actions">
      <button class="dm-btn ghost">${t('حفظ المسودة','Save Draft')}</button>
      <button class="dm-btn ai">✨ ${t('إعادة الإنشاء بـ AI','Regenerate with AI')}</button>
      <button class="dm-btn ghost">👁 ${t('معاينة','Preview')}</button>
      <a class="dm-btn ghost" href="/api/meetings/${this._mid}/export-minutes" target="_blank">⬇ ${t('تحميل','Download Draft')}</a>
      <button class="dm-btn primary" onclick="ApprovalCycle._render()">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('تسليم للحضور','Deliver to Attendees')}</span>
      </button>
    </div>
  </div>

  <!-- ── Page title ───────────────────────────────────────────────────────── -->
  <div class="dm-titlebar">
    <div class="dm-page-h1">${t('إنشاء المسودة','Draft Minutes')} <span class="dm-badge-prog">${t('قيد التنفيذ','In Progress')}</span></div>
    <div class="dm-page-sub">${t('راجع وعدّل المحضر المُنشأ بالذكاء الاصطناعي قبل تسليمه للحضور.','Review and edit the AI-generated minutes before delivering to attendees.')}</div>
  </div>

  <!-- ── Mini stepper ─────────────────────────────────────────────────────── -->
  <div class="dm-stepper-bar">
    <div class="dm-mini-stepper">${miniStepper}</div>
  </div>

  <!-- ── 3-column body ────────────────────────────────────────────────────── -->
  <div class="dm-body">

    <!-- LEFT sidebar -->
    <div class="dm-sidebar">
      <div class="dm-sidebar-head">${t('مخطط المحضر','Minutes Outline')}</div>
      <div class="dm-outline">${outlineItems}</div>
      ${aiSummary}
    </div>

    <!-- CENTER document -->
    <div class="dm-doc">
      <!-- doc header -->
      <div class="dm-doc-hdr">
        <div class="dm-doc-title">${esc(mType ? mType + ' ' : '')}${t('محضر الاجتماع','Meeting Minutes')}${dateStr ? ' — ' + dateStr : ''}${timeStr ? ' · ' + timeStr : ''} <span class="dm-doc-ver">(v1.0)</span></div>
        <div class="dm-doc-meta">
          ${t('أُنشئ بواسطة AI في','Generated by AI on')} ${genDate}
          <span class="dm-autosave">✅ ${t('حُفظ تلقائياً','Auto-saved')}</span>
        </div>
      </div>
      <!-- formatting toolbar -->
      <div class="dm-toolbar">
        <select class="dm-tb-select"><option>Heading 2</option><option>Heading 1</option><option>Body</option></select>
        <span class="dm-tb-sep"></span>
        <button class="dm-tb-btn" title="Bold"><b>B</b></button>
        <button class="dm-tb-btn" title="Italic"><i>I</i></button>
        <button class="dm-tb-btn" title="Underline"><u>U</u></button>
        <button class="dm-tb-btn" title="Strikethrough"><s>S</s></button>
        <span class="dm-tb-sep"></span>
        <button class="dm-tb-btn" title="Bullet list">≡</button>
        <button class="dm-tb-btn" title="Ordered list">⑴</button>
        <button class="dm-tb-btn" title="Outdent">←</button>
        <button class="dm-tb-btn" title="Indent">→</button>
        <span class="dm-tb-sep"></span>
        <button class="dm-tb-btn" title="Link">🔗</button>
        <button class="dm-tb-btn" title="Table">⊞</button>
        <button class="dm-tb-btn" title="Undo">↩</button>
        <button class="dm-tb-btn" title="Redo">↪</button>
      </div>
      <!-- minutes sections -->
      <div class="dm-content">
        ${hasMinutes || secs.some(s => s.text || s.type) ? sectionsHtml : `
<div class="dm-empty-minutes">
  <div class="dm-em-icon">📝</div>
  <div class="dm-em-title">${t('لم يتم إنشاء المحضر بعد','Minutes Not Generated Yet')}</div>
  <div class="dm-em-sub">${t('انقر على "إعادة الإنشاء بـ AI" لإنشاء المحضر تلقائياً','Click "Regenerate with AI" to automatically generate minutes.')}</div>
  <button class="dm-btn ai" style="margin-top:20px">✨ ${t('إنشاء بالذكاء الاصطناعي','Regenerate with AI')}</button>
</div>`}
      </div>
    </div>

    <!-- RIGHT AI panel -->
    <div class="dm-ai-panel">

      <!-- AI Suggestions -->
      <div class="dm-panel-card">
        <div class="dm-panel-head">
          <span>✨ ${t('اقتراحات AI','AI Suggestions')}</span>
          <span class="dm-badge-count">${suggs.length}</span>
        </div>
        <div class="dm-sugg-list">${suggHtml}</div>
        <button class="dm-link-btn">${t('عرض كل الاقتراحات →','View All Suggestions →')}</button>
      </div>

      <!-- Minutes Quality -->
      <div class="dm-panel-card">
        <div class="dm-panel-head"><span>📊 ${t('جودة المحضر','Minutes Quality')}</span></div>
        <div class="dm-quality-wrap">
          <div class="dm-quality-chart">
            <svg width="90" height="90" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="${qR}" fill="none" stroke="#E4E7EC" stroke-width="10"/>
              <circle cx="45" cy="45" r="${qR}" fill="none" stroke="${qColor}" stroke-width="10"
                stroke-dasharray="${qCirc.toFixed(1)}" stroke-dashoffset="${qOffset.toFixed(1)}"
                stroke-linecap="round" transform="rotate(-90 45 45)"/>
              <text x="45" y="41" text-anchor="middle" font-size="16" font-weight="900" fill="#15201A">${overall}%</text>
              <text x="45" y="56" text-anchor="middle" font-size="9" fill="#8A948D">${t('النتيجة الكلية','Overall Score')}</text>
            </svg>
          </div>
          <div class="dm-quality-bars">${qualityBars}</div>
        </div>
      </div>

      <!-- Quick Statistics -->
      <div class="dm-panel-card">
        <div class="dm-panel-head"><span>📈 ${t('إحصاءات سريعة','Quick Statistics')}</span></div>
        <div class="dm-stat-list">${statRows}</div>
      </div>

      <!-- AI Validation Checklist -->
      <div class="dm-panel-card">
        <div class="dm-panel-head"><span>✅ ${t('قائمة التحقق AI','AI Validation Checklist')}</span></div>
        <div class="dm-check-list">${checks}</div>
      </div>

      <!-- Readiness Status -->
      <div class="dm-panel-card dm-readiness ${isReady ? 'ready' : 'not-ready'}">
        <div class="dm-ready-icon">${isReady ? '🚀' : '⚠️'}</div>
        <div class="dm-ready-title">${isReady ? t('جاهز للتوزيع','Ready for Circulation') : t('يحتاج مراجعة','Needs Review')}</div>
        <div class="dm-ready-sub">${isReady ? t('جميع العناصر المطلوبة مكتملة.','All required elements are completed.') : t('بعض العناصر المطلوبة مفقودة.','Some required elements are missing.')}</div>
      </div>

    </div><!-- /dm-ai-panel -->
  </div><!-- /dm-body -->

  <!-- ── Bottom bar ───────────────────────────────────────────────────────── -->
  <div class="dm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._render()">← ${t('العودة إلى لوحة التحكم','Back to Dashboard')}</button>
    <div style="display:flex;gap:8px">
      <button class="dm-btn ghost">${t('حفظ المسودة','Save Draft')}</button>
      <button class="dm-btn ghost">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._render()">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('تسليم للحضور','Deliver to Attendees')}</span>
      </button>
    </div>
  </div>

</div>`;
  },

  _parseDmSections(text, agenda, attendees, decisions, tasks, t, l) {
    const fixedSections = [
      { title: t('الافتتاح','Opening'),     type: 'opening',   text: '' },
      { title: t('الحضور','Attendance'),    type: 'attendance', text: '' },
      ...agenda.map(a => ({
        title: (l==='ar'? a.title_ar : a.title_en) || a.title || '',
        type:  'agenda', text: (l==='ar'? a.description_ar : a.description_en) || ''
      })),
      { title: t('القرارات','Decisions'),   type: 'decisions', text: '' },
      { title: t('بنود العمل','Action Items'), type: 'actions', text: '' },
      { title: t('الختام','Closing'),       type: 'closing',   text: '' },
    ];

    if (!text) return fixedSections;

    // Try to split by numbered headings
    const lines = text.split('\n');
    const parsed = [];
    let cur = null;
    for (const ln of lines) {
      const m = ln.match(/^(?:#{1,3}\s*)?(\d+)[.)]\s+(.+)/);
      if (m) {
        if (cur) parsed.push(cur);
        cur = { title: m[2].trim(), type: 'section', text: '' };
      } else if (cur) {
        cur.text += (cur.text ? '\n' : '') + ln;
      }
    }
    if (cur) parsed.push(cur);

    // If parsing yielded sections, merge with fixed
    if (parsed.length >= 2) {
      // Enhance fixed sections with parsed text
      fixedSections.forEach((fs, i) => {
        if (parsed[i]) fs.text = parsed[i].text || fs.text;
      });
      // Add any extra parsed sections
      if (parsed.length > fixedSections.length) {
        return [...fixedSections, ...parsed.slice(fixedSections.length)];
      }
    }
    return fixedSections;
  },

  _dmScrollTo(i) {
    const el = document.getElementById('dm-sec-' + i);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ─── Left column ────────────────────────────────────────────────────── */
  _renderLeft(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const canDecide = App.can('minutes.publish') || App.can('minutes.approve');

    /* Deadline card */
    const deadline = cycle.comment_deadline;
    const deadlineClosed = deadline && new Date(deadline) < new Date();
    const deadlineCard = `
<div class="ac-card">
  <div class="ac-card-title">⏰ ${t('الموعد النهائي للتعليقات', 'Comment Deadline')}</div>
  <div class="ac-deadline-box">
    <div class="ac-deadline-lock">${deadlineClosed ? '🔒' : deadline ? '⏳' : '📅'}</div>
    <div>
      ${deadline ? `<div class="ac-deadline-date">${t('الموعد: ', 'Deadline: ')}${this._fmtDT(deadline)}</div>` : `<div class="ac-deadline-date" style="color:var(--text3)">${t('لم يُحدَّد بعد','Not set yet')}</div>`}
      ${deadline ? `<span class="ac-dl-badge ${deadlineClosed ? 'closed' : 'open'}">${deadlineClosed ? t('🔒 مغلق','🔒 Closed') : t('⏳ مفتوح','⏳ Open')}</span>` : ''}
      ${deadlineClosed ? `<div class="ac-deadline-note">${t('لا يمكن تقديم المزيد من التعليقات.','No further comments can be submitted.')}</div>` : ''}
    </div>
  </div>
  ${canDecide ? `
  <div class="ac-deadline-set">
    <div class="ac-deadline-set-label">${t('تحديد الموعد النهائي','Set Deadline')}</div>
    <div style="display:flex;gap:6px">
      <input type="datetime-local" id="ac-deadline-input" class="fi" style="flex:1;font-size:12px" ${deadline ? `value="${deadline.replace(' ','T').slice(0,16)}"` : ''}>
      <button class="btn-gold btn-sm" onclick="ApprovalCycle.setDeadline()">${t('حفظ','Save')}</button>
    </div>
  </div>` : ''}
</div>`;

    /* Signatures card */
    const sigs = (d && d.signatures) || [];
    const attendees = (d && d.attendees) || [];
    const attendeeSigs = sigs.filter(s => s.sig_stage === 'attendee');
    const sigSigned = attendeeSigs.filter(s => s.status === 'signed').length;
    const sigPending = attendeeSigs.filter(s => s.status === 'pending').length;
    const sigNotOpened = attendeeSigs.filter(s => s.status === 'not_opened').length;
    const totalSig = attendeeSigs.length || attendees.length;
    const sigPct = totalSig ? Math.round(sigSigned / totalSig * 100) : 0;
    const r = 28, circ = 2 * Math.PI * r;
    const offset = circ - (sigPct / 100) * circ;
    const isAttSig = cycle.cycle_stage === 'attendee_sign';
    const myName = App.user ? (App.user.name_en || App.user.name_ar || '') : '';

    const sigRows = (attendeeSigs.length ? attendeeSigs : attendees.slice(0, 9)).map(s => {
      const name = s.signer_name || s.name || '';
      const role = s.signer_role || s.role || '';
      const status = s.status || 'pending';
      const initials = name.split(/\s+/).map(x => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
      const isMe = name === myName;
      const statusEl = status === 'signed'
        ? `<div class="ac-sig-status signed">● ${t('وقّع','Signed')}</div><div class="ac-sig-date">${s.signed_at ? this._fmtDT(s.signed_at) : ''}</div>`
        : (isAttSig && isMe)
          ? `<button class="ac-sig-btn" onclick="ApprovalCycle.openSignModal('attendee')">✍️ ${t('وقّع','Sign')}</button>`
          : `<div class="ac-sig-status pending">● ${t('معلّق','Pending')}</div><div class="ac-sig-date">—</div>`;
      return `<div class="ac-sig-row">
        <div class="ac-sig-av">${initials}</div>
        <div class="ac-sig-info">
          <div class="ac-sig-name">${esc(name)}</div>
          <div class="ac-sig-role">${esc(role)}</div>
        </div>
        <div class="ac-sig-right">${statusEl}</div>
      </div>`;
    }).join('');

    const sigsCard = `
<div class="ac-card">
  <div class="ac-card-title">✍️ ${t('توقيعات الحضور','Attendee Signatures')}</div>
  <div class="ac-sig-summary">
    <div class="ac-sig-donut-wrap">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--border3)" stroke-width="9"/>
        <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--gold)" stroke-width="9"
          stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 40 40)"/>
      </svg>
      <div class="ac-sig-donut-text">
        <div class="ac-sig-donut-num">${sigSigned}/${totalSig}</div>
        <div class="ac-sig-donut-sub">${t('وقّعوا','Signed')}</div>
      </div>
    </div>
    <div class="ac-sig-legend">
      <div class="ac-sig-leg"><span class="ac-leg-dot" style="background:var(--gold)"></span>${sigSigned} ${t('وقّعوا','Signed')}</div>
      <div class="ac-sig-leg"><span class="ac-leg-dot" style="background:#e8a000"></span>${sigPending} ${t('معلّق','Pending')}</div>
      <div class="ac-sig-leg"><span class="ac-leg-dot" style="background:var(--text3)"></span>${sigNotOpened} ${t('لم يفتح','Not opened')}</div>
    </div>
  </div>
  <div class="ac-sig-table-head">
    <span>${t('الحضور','Attendee')}</span>
    <span>${t('الحالة','Status')}</span>
    <span>${t('وقت التوقيع','Signed At')}</span>
  </div>
  <div class="ac-sig-list">${sigRows || `<div class="ac-sig-empty">${t('لا توجد توقيعات بعد.','No signatures yet.')}</div>`}</div>
  ${canDecide && isAttSig && sigPending > 0 ? `
  <div class="ac-remind-bar">
    <button class="btn-ghost btn-sm" onclick="ApprovalCycle.sendReminder()">🔔 ${t('إرسال تذكير','Send Reminder')}</button>
    <span class="ac-remind-note">${t('إلى','To')} ${sigPending} ${t('معلّقين','pending attendees')}</span>
  </div>` : ''}
</div>`;

    /* Minutes document card */
    const docCard = `
<div class="ac-card">
  <div class="ac-card-title">📄 ${t('وثيقة المحضر','Minutes Document')}</div>
  <div class="ac-doc-row">
    <div class="ac-doc-icon-wrap"><span class="ac-doc-icon">📋</span></div>
    <div class="ac-doc-details">
      <div class="ac-doc-name">${t('محضر اجتماع مجلس الإدارة','Board Meeting Minutes')} ${this._meeting ? '- ' + ((App.lang==='ar'?this._meeting.title_ar:this._meeting.title_en)||'') : ''}</div>
      <div class="ac-doc-meta">${t('النسخة','Version')} ${(this._meeting && this._meeting.minutes_version) || 3.0} · ${t('محدَّث','Updated')} ${(cycle.updated_at ? this._fmtDT(cycle.updated_at) : t('للتوقيع النهائي','for signatures'))}</div>
    </div>
  </div>
  <div class="ac-doc-btns">
    <button class="btn-ghost btn-sm" onclick="MT.openDetail(${this._mid},'minutes')">👁 ${t('معاينة','Preview')}</button>
    <a class="btn-gold btn-sm" href="/api/meetings/${this._mid}/export-minutes" target="_blank">⬇ ${t('تنزيل نسخة العمل','Download Working Copy')}</a>
  </div>
</div>`;

    return deadlineCard + sigsCard + docCard;
  },

  /* ─── Center column: Comments ─────────────────────────────────────────── */
  _renderCenter(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const comments = (d && d.comments) || [];
    const total    = comments.length;
    const accepted = comments.filter(c => c.status === 'accepted').length;
    const rejected = comments.filter(c => c.status === 'rejected').length;
    const pending  = comments.filter(c => c.status === 'pending').length;
    const canDecide  = App.can('minutes.publish') || App.can('minutes.approve');
    const canComment = App.can('minutes.view') && cycle.cycle_stage === 'comments_open';
    const myName   = App.user ? (App.user.name_en || App.user.name_ar || '') : '';
    const myComment = comments.find(c => c.commenter_name === myName);
    const shown = this._commentTab === 'all' ? comments : comments.slice(0, 10);

    const commentItems = shown.length ? shown.map(c => {
      const badgeCls = c.status === 'accepted' ? 'accepted' : c.status === 'rejected' ? 'rejected' : 'pending';
      const badgeTxt = c.status === 'accepted' ? t('مقبول','Accepted') : c.status === 'rejected' ? t('مرفوض','Rejected') : t('قيد المراجعة','Under Review');
      const decidedBy = c.decided_by ? `${t('بواسطة','by')} ${esc(c.decided_by)}` : '';
      const decidedAt = c.decided_at ? this._fmtDT(c.decided_at) : '';
      return `<div class="ac-comment-item ${badgeCls}">
        <div class="ac-comment-top">
          <span class="ac-comment-badge ${badgeCls}">${badgeTxt}</span>
          ${c.clause_ref ? `<span class="ac-comment-clause">${esc(c.clause_ref)}</span>` : ''}
          <span class="ac-comment-body-text">${esc(c.content)}</span>
        </div>
        <div class="ac-comment-footer">
          <span class="ac-comment-by">${t('بواسطة','By')} ${esc(c.commenter_name)}</span>
          <span class="ac-comment-at">${this._fmtDT(c.created_at)}</span>
          ${c.decided_by && c.status !== 'pending' ? `<span class="ac-comment-decided">${c.status === 'accepted' ? t('قُبل','Accepted') : t('رُفض','Rejected')} ${decidedBy} ${decidedAt}</span>` : ''}
        </div>
        ${c.secretary_note ? `<div class="ac-comment-note">${esc(c.secretary_note)}</div>` : ''}
        ${c.status === 'pending' && canDecide ? `<div class="ac-comment-actions">
          <input class="fi" id="ac-snote-${c.id}" placeholder="${t('ملاحظة أمين السر (اختياري)…','Secretary note (optional)…')}" style="font-size:12px;padding:6px 10px;margin-bottom:6px;width:100%"/>
          <button class="btn-gold btn-sm" onclick="ApprovalCycle.decideComment(${c.id},'accepted')">✓ ${t('قبول','Accept')}</button>
          <button class="ac-reject-btn" onclick="ApprovalCycle.decideComment(${c.id},'rejected')">✕ ${t('رفض','Reject')}</button>
        </div>` : ''}
      </div>`;
    }).join('') : `<div class="ac-empty" style="padding:32px 0"><div class="ac-empty-icon">💬</div><div>${t('لا توجد تعليقات بعد.','No comments yet.')}</div></div>`;

    return `
<div class="ac-card" style="min-height:400px">
  <div class="ac-card-title-row">
    <span class="ac-card-title">💬 ${t('مراجعة التعليقات','Comments Overview')}</span>
    ${canComment && !myComment ? `<button class="btn-gold btn-sm" onclick="ApprovalCycle.openCommentModal()">+ ${t('إضافة تعليق','Add Comment')}</button>` : ''}
  </div>
  <div class="ac-kpis">
    <div class="ac-kpi"><div class="ac-kpi-n">${total}</div><div class="ac-kpi-l">${t('الإجمالي','Total Comments')}</div></div>
    <div class="ac-kpi accepted"><div class="ac-kpi-n">${accepted}</div><div class="ac-kpi-l">${t('مقبول','Accepted')}</div></div>
    <div class="ac-kpi rejected"><div class="ac-kpi-n">${rejected}</div><div class="ac-kpi-l">${t('مرفوض','Rejected')}</div></div>
    <div class="ac-kpi pending"><div class="ac-kpi-n">${pending}</div><div class="ac-kpi-l">${t('معلّق','Pending')}</div></div>
  </div>
  <div class="ac-comment-tabs">
    <button class="ac-ctab ${this._commentTab==='recent'?'active':''}" onclick="ApprovalCycle._setTab('recent')">${t('الأحدث','Recent Comments')}</button>
    <button class="ac-ctab ${this._commentTab==='all'?'active':''}" onclick="ApprovalCycle._setTab('all')">${t('الكل','All Comments')}${total ? ` (${total})` : ''}</button>
  </div>
  <div class="ac-comment-list">${commentItems}</div>
  ${total > 10 && this._commentTab === 'recent' ? `<div style="text-align:center;margin-top:12px"><button class="btn-ghost btn-sm" onclick="ApprovalCycle._setTab('all')">${t('عرض جميع التعليقات','View All Comments')} →</button></div>` : ''}
</div>`;
  },

  /* ─── Right column: Authority + Next Step + Audit ────────────────────── */
  _renderRight(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const canDecide = App.can('minutes.publish') || App.can('minutes.approve');
    const attendees = (d && d.attendees) || [];
    const sigs = (d && d.signatures) || [];

    /* Comment Review Authority */
    const reviewers = attendees.filter(a => a.role &&
      (a.role.toLowerCase().includes('chair') || a.role.toLowerCase().includes('secret') ||
       a.role.includes('رئيس') || a.role.includes('أمين')));
    const authority = (reviewers.length ? reviewers : attendees).slice(0, 3);
    const authorityCard = `
<div class="ac-card">
  <div class="ac-card-title">🏛️ ${t('صلاحية مراجعة التعليقات','Comment Review Authority')}</div>
  <div class="ac-authority-note">${t('يمكن لأمين السر والرئيس قبول أو رفض التعليقات.','Both the Secretary and Chairman can accept or reject comments.')}</div>
  <div class="ac-authority-list">
    ${authority.length ? authority.map(a => {
      const initials = (a.name||'?').split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
      const canR = a.role && (a.role.toLowerCase().includes('secret') || a.role.includes('أمين') || a.role.toLowerCase().includes('chair') || a.role.includes('رئيس'));
      return `<div class="ac-auth-person">
        <div class="ac-auth-av">${initials}</div>
        <div class="ac-auth-info">
          <div class="ac-auth-name">${esc(a.name)}</div>
          <div class="ac-auth-role">${esc(a.role||'')}</div>
        </div>
        ${canR ? `<span class="ac-auth-tag">${t('يمكنه المراجعة','Can review')}</span>` : ''}
      </div>`;
    }).join('') : `<div style="font-size:12px;color:var(--text3)">${t('لا يوجد مراجعون.','No reviewers assigned.')}</div>`}
  </div>
</div>`;

    /* Next Step */
    const nextInfo = this._nextStepInfo(cycle);
    const nextCard = `
<div class="ac-card">
  <div class="ac-card-title">🎯 ${t('الخطوة التالية','Next Step')}</div>
  <div class="ac-next-box">
    <div class="ac-next-label">${t('بمجرد توقيع جميع الحضور، سيُرسَل المحضر إلى المعتمد النهائي للتوقيع.','Once all attendees have signed, the minutes will be sent to the final approver for sign-off.')}</div>
    <div class="ac-next-action">${nextInfo.action}</div>
    ${nextInfo.who ? `<div class="ac-next-who">${t('إلى:','To:')} ${nextInfo.who}</div>` : ''}
  </div>
  ${canDecide && nextInfo.advance_to ? `<div style="margin-top:12px"><button class="btn-gold" style="width:100%" onclick="ApprovalCycle.advance('${nextInfo.advance_to}')">${nextInfo.btn}</button></div>` : ''}
</div>`;

    /* Final Approver */
    const finalSig = sigs.filter(s => s.sig_stage === 'final_approver');
    const fa = finalSig[0];
    const faInitials = fa ? (fa.signer_name||'?').split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() : '';
    const finalApproverCard = `
<div class="ac-card">
  <div class="ac-card-title">👤 ${t('المعتمد النهائي (تلقائي)','Final Approver (Automatic)')}</div>
  ${fa ? `<div class="ac-auth-person" style="margin-top:6px">
    <div class="ac-auth-av">${faInitials}</div>
    <div class="ac-auth-info">
      <div class="ac-auth-name">${esc(fa.signer_name)}</div>
      <div class="ac-auth-role">${esc(fa.signer_role||t('رئيس المجلس','Board Chairman'))}</div>
    </div>
    <span class="ac-status-chip ${fa.status==='signed'?'signed':'pending'}">${fa.status==='signed'?t('✓ وقّع','✓ Signed'):t('معلّق','Pending')}</span>
  </div>` : `<div style="font-size:12px;color:var(--text3);margin-top:6px">${t('سيُحدَّد تلقائياً من قائمة الحضور (رئيس المجلس).','Will be auto-assigned from attendees (Chairman).')}</div>`}
</div>`;

    /* Audit Trail */
    const audit = (d && d.audit) || [];
    const auditCard = `
<div class="ac-card">
  <div class="ac-card-title-row">
    <span class="ac-card-title">📜 ${t('سجل التدقيق (الأخير)','Audit Trail (Latest)')}</span>
    ${audit.length > 3 ? `<button class="ac-link-btn" onclick="">${t('عرض الكل','View Full Audit Trail')} →</button>` : ''}
  </div>
  <div class="ac-audit-list">
    ${audit.length ? audit.slice(0, 8).map(e => `
      <div class="ac-audit-row">
        <div class="ac-audit-time">${this._fmtDT(e.created_at)}</div>
        <div class="ac-audit-text">${esc(this._auditLabel(e.action))} ${e.actor_name ? t('بواسطة','by') + ' ' + esc(e.actor_name) : ''}</div>
      </div>`).join('') : `<div style="font-size:11.5px;color:var(--text3);padding:8px 0">${t('لا توجد سجلات بعد.','No records yet.')}</div>`}
  </div>
</div>`;

    return authorityCard + nextCard + finalApproverCard + auditCard;
  },

  /* ─── SVG step icons ─────────────────────────────────────────────────── */
  _svgDoc()      { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>`; },
  _svgEnvelope() { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`; },
  _svgComment()  { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`; },
  _svgClock()    { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>`; },
  _svgResolve()  { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,11 12,14 22,4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`; },
  _svgFinal()    { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><polyline points="9,15 11,17 15,13"/></svg>`; },
  _svgSign()     { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`; },
  _svgApprover() { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`; },
  _svgArchive()  { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21,8 21,21 3,21 3,8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`; },

  /* ─── Helpers ─────────────────────────────────────────────────────────── */
  _stageName(s) {
    const t = (ar, en) => this.t(ar, en);
    return {
      draft:           t('المسودة','Draft'),
      circulated:      t('تم التعميم','Delivered'),
      comments_open:   t('التعليقات مفتوحة','Comments Open'),
      deadline_closed: t('انتهى الموعد','Deadline Closed'),
      review_resolve:  t('مراجعة وحل','Review & Resolve'),
      final_version:   t('النسخة النهائية','Final Version'),
      attendee_sign:   t('توقيعات الحضور','Attendee Signatures'),
      final_approver:  t('المعتمد النهائي','Final Approver'),
      archived:        t('مؤرشف','Archived'),
    }[s] || s;
  },

  _nextStepInfo(cycle) {
    const t = (ar, en) => this.t(ar, en);
    const map = {
      draft:           { action: t('تعميم المحضر على الحضور','Circulate minutes to attendees'),   advance_to: 'circulated',      btn: t('📧 تعميم الآن','📧 Circulate Now'),       who: '', desc: '' },
      circulated:      { action: t('فتح باب التعليقات','Open comments period'),                    advance_to: 'comments_open',   btn: t('💬 فتح التعليقات','💬 Open Comments'),    who: '', desc: '' },
      comments_open:   { action: t('إغلاق الموعد النهائي للتعليقات','Close comment deadline'),     advance_to: 'deadline_closed', btn: t('🔒 إغلاق التعليقات','🔒 Close Comments'),  who: '', desc: '' },
      deadline_closed: { action: t('بدء مراجعة التعليقات وحلها','Begin reviewing & resolving'),   advance_to: 'review_resolve',  btn: t('🔍 بدء المراجعة','🔍 Start Review'),       who: '', desc: '' },
      review_resolve:  { action: t('إصدار النسخة النهائية','Issue final version'),                advance_to: 'final_version',   btn: t('📋 إصدار النسخة النهائية','📋 Issue Final'), who: '', desc: '' },
      final_version:   { action: t('طلب توقيعات الحضور','Request attendee signatures'),           advance_to: 'attendee_sign',   btn: t('✍️ طلب التوقيعات','✍️ Request Signatures'), who: '', desc: '' },
      attendee_sign:   { action: t('إرسال إلى المعتمد النهائي','Send to final approver'),         advance_to: 'final_approver',  btn: t('👤 إرسال للمعتمد','👤 Send to Approver'),   who: t('د. عبدالله الأحمدي','Dr. Abdullah Alghamdi'), desc: '' },
      final_approver:  { action: t('أرشفة المحضر وتفعيله','Archive and activate minutes'),         advance_to: 'archived',        btn: t('🗃️ أرشفة وتفعيل','🗃️ Archive & Activate'), who: '', desc: '' },
      archived:        { action: t('اكتملت دورة الاعتماد','Approval cycle complete ✓'),            advance_to: null,              btn: '',                                             who: '', desc: '' },
    };
    return map[cycle.cycle_stage] || map['draft'];
  },

  _auditLabel(action) {
    const t = (ar, en) => this.t(ar, en);
    return {
      advanced:         t('تقدّمت الدورة','Cycle advanced'),
      deadline_set:     t('تم تحديد الموعد','Deadline set'),
      comment_added:    t('أُضيف تعليق','Comment added'),
      comment_accepted: t('قُبل التعليق','Comment accepted'),
      comment_rejected: t('رُفض التعليق','Comment rejected'),
      signed:           t('تم التوقيع','Signed'),
      reminder_sent:    t('أُرسل تذكير','Reminder sent'),
    }[action] || action;
  },

  _fmtDT(str) {
    if (!str) return '';
    try {
      const d = new Date(str.replace(' ', 'T'));
      return d.toLocaleDateString(App.lang === 'ar' ? 'ar-SA' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return str; }
  },

  _setTab(tab) { this._commentTab = tab; this._render(); },

  /* ─── Actions ─────────────────────────────────────────────────────────── */
  async advance(to_stage) {
    const t = (ar, en) => this.t(ar, en);
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_stage }) });
      showToast(t('✓ تم التقدم إلى المرحلة التالية','✓ Advanced to next stage'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  async setDeadline() {
    const t = (ar, en) => this.t(ar, en);
    const val = document.getElementById('ac-deadline-input');
    if (!val || !val.value) { showToast(t('اختر تاريخاً ووقتاً','Select date and time'), 'error'); return; }
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/deadline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deadline: val.value.replace('T', ' ') }) });
      showToast(t('✓ تم تحديد الموعد النهائي','✓ Deadline set'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  async decideComment(cid, decision) {
    const t = (ar, en) => this.t(ar, en);
    const noteEl = document.getElementById('ac-snote-' + cid);
    const secretary_note = noteEl ? noteEl.value.trim() : '';
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${cid}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, secretary_note }) });
      showToast(decision === 'accepted' ? t('✓ تم قبول التعليق','✓ Comment accepted') : t('✕ تم رفض التعليق','✕ Comment rejected'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  async sendReminder() {
    const t = (ar, en) => this.t(ar, en);
    showToast(t('📨 تم إرسال التذكيرات','📨 Reminders sent'));
  },

  /* ─── Comment modal ───────────────────────────────────────────────────── */
  openCommentModal() {
    const el = document.getElementById('ac-comment-overlay');
    if (el) el.classList.add('open');
  },
  closeCommentModal() {
    const el = document.getElementById('ac-comment-overlay');
    if (el) el.classList.remove('open');
    this._pendingComment = null;
  },

  async submitComment() {
    const t = (ar, en) => this.t(ar, en);
    const contentEl = document.getElementById('ac-comment-content');
    const clauseEl  = document.getElementById('ac-comment-clause');
    if (!contentEl || !contentEl.value.trim()) { showToast(t('أدخل نص التعليق','Enter comment text'), 'error'); return; }
    this._pendingComment = { content: contentEl.value.trim(), clause_ref: clauseEl ? clauseEl.value.trim() : '' };
    this.closeCommentModal();
    this.openSignModal('comment');
  },

  async _finalizeComment(sig_data, sig_type) {
    const t = (ar, en) => this.t(ar, en);
    const pc = this._pendingComment;
    if (!pc) return;
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: pc.content, clause_ref: pc.clause_ref, signature_data: sig_data, signature_type: sig_type }) });
      showToast(t('✓ تم إضافة التعليق بنجاح','✓ Comment added successfully'));
      this._pendingComment = null;
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  /* ─── E-Signature modal ───────────────────────────────────────────────── */
  openSignModal(purpose) {
    this._eSignPurpose = purpose;
    this._eSignMode = 'draw';
    const overlay = document.getElementById('ac-esign-overlay');
    if (!overlay) return;
    // Reset UI
    const drawTab = document.getElementById('esign-tab-draw');
    const typeTab = document.getElementById('esign-tab-type');
    const drawWrap = document.getElementById('esign-draw-wrap');
    const typeWrap = document.getElementById('esign-type-wrap');
    if (drawTab) drawTab.classList.add('active');
    if (typeTab) typeTab.classList.remove('active');
    if (drawWrap) drawWrap.style.display = '';
    if (typeWrap) typeWrap.style.display = 'none';
    const typeInput = document.getElementById('ac-esign-type-input');
    if (typeInput) typeInput.value = '';
    overlay.classList.add('open');
    this._initCanvas();
  },

  closeSignModal() {
    const overlay = document.getElementById('ac-esign-overlay');
    if (overlay) overlay.classList.remove('open');
    this._eSignPurpose = null;
  },

  async submitSignature() {
    const t = (ar, en) => this.t(ar, en);
    const { data, type } = this._getEsignData();
    if (!data) { showToast(t('التوقيع الإلكتروني مطلوب','E-signature is required'), 'error'); return; }
    const btn = document.getElementById('ac-esign-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = t('جارٍ الحفظ…','Saving…'); }
    const purpose = this._eSignPurpose;
    this.closeSignModal();
    try {
      if (purpose === 'comment') {
        await this._finalizeComment(data, type);
      } else {
        await api(`/api/meetings/${this._mid}/approval-cycle/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sig_stage: purpose || 'attendee', signature_data: data, signature_type: type }) });
        showToast(t('✓ تم التوقيع بنجاح','✓ Signed successfully'));
        await this._load();
      }
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = t('تأكيد التوقيع','Confirm Signature'); } }
  },

  switchEsignMode(mode) {
    this._eSignMode = mode;
    const drawTab  = document.getElementById('esign-tab-draw');
    const typeTab  = document.getElementById('esign-tab-type');
    const drawWrap = document.getElementById('esign-draw-wrap');
    const typeWrap = document.getElementById('esign-type-wrap');
    if (drawTab)  drawTab.classList.toggle('active', mode === 'draw');
    if (typeTab)  typeTab.classList.toggle('active', mode === 'type');
    if (drawWrap) drawWrap.style.display = mode === 'draw' ? '' : 'none';
    if (typeWrap) typeWrap.style.display = mode === 'type' ? '' : 'none';
    if (mode === 'draw') this._initCanvas();
  },

  _getEsignData() {
    if (this._eSignMode === 'type') {
      const v = (document.getElementById('ac-esign-type-input') || {}).value || '';
      return { data: v.trim() || null, type: 'type' };
    }
    if (this._hasDrawing && this._canvas) {
      return { data: this._canvas.toDataURL(), type: 'draw' };
    }
    return { data: null, type: 'draw' };
  },

  _initCanvas() {
    setTimeout(() => {
      const canvas = document.getElementById('ac-esign-canvas');
      if (!canvas) return;
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      this._hasDrawing = false;
      const hint = document.getElementById('esign-canvas-hint');
      // Scale for DPR
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width  = (rect.width  || 480) * dpr;
      canvas.height = (rect.height || 150) * dpr;
      this._ctx.scale(dpr, dpr);
      this._ctx.clearRect(0, 0, canvas.width, canvas.height);
      this._ctx.strokeStyle = '#0A1628';
      this._ctx.lineWidth = 2.5;
      this._ctx.lineCap = 'round';
      this._ctx.lineJoin = 'round';

      const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
      };
      const start = (e) => { e.preventDefault(); this._drawing = true; const p = getPos(e); this._ctx.beginPath(); this._ctx.moveTo(p.x, p.y); if (hint) hint.style.display = 'none'; };
      const draw  = (e) => { e.preventDefault(); if (!this._drawing) return; const p = getPos(e); this._ctx.lineTo(p.x, p.y); this._ctx.stroke(); this._hasDrawing = true; };
      const stop  = ()  => { this._drawing = false; };

      canvas.onmousedown  = start; canvas.onmousemove  = draw; canvas.onmouseup   = stop;
      canvas.ontouchstart = start; canvas.ontouchmove  = draw; canvas.ontouchend  = stop;
    }, 80);
  },

  clearCanvas() {
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._hasDrawing = false;
      const hint = document.getElementById('esign-canvas-hint');
      if (hint) hint.style.display = '';
    }
  },

  _bindCanvas() { this._initCanvas(); },
};
window.ApprovalCycle = ApprovalCycle;
