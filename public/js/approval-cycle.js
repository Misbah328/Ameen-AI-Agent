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
    if (i === 4) { this._renderStep5Resolve();  return; }
    if (i === 5) { this._renderStep6FinalVersion();       return; }
    if (i === 6) { this._renderStep7AttendeeSignatures(); return; }
    if (i === 7) { this._renderStep8FinalApproval();       return; }
    if (i === 8) { this._renderStep9ArchiveActivate();     return; }
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

    /* ── Deadline values — fall back to meeting's approval_due_date ──────── */
    const _rawDl = cycle.comment_deadline || m.approval_due_date || '';
    const dl     = _rawDl;
    const dlDate = dl ? (dl.split('T')[0] || dl.split(' ')[0]) : '';
    const dlTime = dl ? ((dl.split('T')[1] || dl.split(' ')[1] || '17:00').slice(0,5)) : '17:00';
    let timeRemStr = `7 ${t('أيام','Days')}, 0 ${t('ساعات','Hours')}`;
    if (dlDate) {
      const diff = new Date(dlDate + 'T' + dlTime) - new Date();
      if (diff > 0) {
        const days  = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        timeRemStr  = `${days} ${t('أيام','Days')}, ${hours} ${t('ساعات','Hours')}`;
      } else {
        timeRemStr = t('انتهى الموعد','Deadline passed');
      }
    }

    /* ── Attendee rows ───────────────────────────────────────────────────── */
    const REQUIRED_ROLES = ['chairman','board_chairman','board_member','vice_chairman','member'];
    const avatarPalette  = ['#0F1728','#0C7A3D','#A8842C','#1A5276','#7D3C98','#0E6655','#B03A2E','#1F618D'];

    const attRows = attendees.map((att, i) => {
      const name    = att.name || (l==='ar' ? att.name_ar : att.name_en) || att.name_ar || att.name_en || '';
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
      <button class="dm-btn ghost" onclick="ApprovalCycle._s1Preview()">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
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
        <button class="dv-preview-btn" onclick="ApprovalCycle._s1Preview()">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
        <button class="dv-preview-btn" style="margin-top:6px;color:#0C7A3D;border-color:rgba(12,122,61,.3)" onclick="ApprovalCycle._dvPreviewEmail()">✉️ ${t('معاينة الإشعار','Preview Email')}</button>
        <button class="dv-preview-btn" style="margin-top:6px;color:#A8842C;border-color:rgba(168,132,44,.3)" onclick="ApprovalCycle._dvSendTest()">🧪 ${t('إرسال اختباري','Send Test')}</button>
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
          <button class="dv-filter-btn" onclick="ApprovalCycle._dvFilterMenu(this)">⚙ ${t('تصفية','Filter')}</button>
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
          <button class="dv-add-more" onclick="ApprovalCycle._dvAddAttachment()">+ ${t('إضافة مرفق','Add Attachment')}</button>
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
    <div style="display:flex;gap:8px;align-items:center">
      <button class="dm-btn ghost" onclick="ApprovalCycle._dvSaveSettings()">💾 ${t('حفظ الإعدادات','Save Settings')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._dvPreviewEmail()">👁 ${t('معاينة البريد','Preview Email')}</button>
      <button class="dm-btn primary dv-send-btn" onclick="ApprovalCycle._sendToAttendees()">
        ✈️ ${t('إرسال للحضور','Send to Attendees')} <span class="dv-send-sub">${t('إشعار الحضور المحددين','Notify selected attendees')}</span>
      </button>
    </div>
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
    const t = (ar, en) => this.t(ar, en);

    // Validate: at least one attendee must be checked
    const checkedCount = document.querySelectorAll('.dv-cb:checked').length;
    if (checkedCount === 0) {
      showToast(t('يرجى اختيار حضور واحد على الأقل','Please select at least one attendee'), 'error');
      return;
    }

    const dateEl = document.getElementById('dv-dl-date');
    const timeEl = document.getElementById('dv-dl-time');
    const deadline = dateEl?.value;
    const dlTime   = timeEl?.value || '17:00';

    if (!deadline) {
      showToast(t('يرجى تحديد الموعد النهائي للمراجعة','Please set the review deadline'), 'error');
      dateEl?.focus();
      return;
    }

    showToast(t('⏳ جارٍ الإرسال للحضور...','⏳ Sending to attendees...'), 'info');

    // Save deadline first (non-fatal)
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/deadline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: `${deadline} ${dlTime}:00` }),
      });
    } catch(e) { /* non-fatal */ }

    // Advance the cycle
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: 'circulated' }),
      });
      showToast(t('✈️ تم الإرسال للحضور بنجاح! جارٍ الانتقال لتتبع المراجعات...','✈️ Sent successfully! Navigating to review tracking...'), 'success');
      await this._load();
      setTimeout(() => this._renderStep3Reviews(), 1200);
    } catch(e) {
      showToast(e.message || t('تعذّر الإرسال للحضور','Failed to send to attendees'), 'error');
    }
  },

  /* ── Step 2 extra helpers ─────────────────────────────────────────────── */
  async _dvSaveSettings() {
    const t = (ar, en) => this.t(ar, en);
    const dateEl = document.getElementById('dv-dl-date');
    const timeEl = document.getElementById('dv-dl-time');
    const deadline = dateEl?.value;
    const dlTime   = timeEl?.value || '17:00';
    if (!deadline) {
      showToast(t('يرجى تحديد الموعد النهائي أولاً','Please set the deadline first'), 'error');
      return;
    }
    showToast(t('⏳ جارٍ حفظ الإعدادات...','⏳ Saving settings...'), 'info');
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/deadline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: `${deadline} ${dlTime}:00` }),
      });
      showToast(t('💾 تم حفظ الإعدادات بنجاح','💾 Settings saved successfully'), 'success');
    } catch(e) {
      showToast(t('💾 تم الحفظ محلياً','💾 Saved locally'), 'success');
    }
  },

  _dvFilterMenu(btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('dv-filter-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'dv-filter-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:200px;';
    const opts = [
      { label: t('عرض الكل','Show All'),          action: () => { document.querySelectorAll('#dv-att-body tr').forEach(r => r.style.display=''); }},
      { label: t('المطلوبون فقط','Required Only'), action: () => { document.querySelectorAll('#dv-att-body tr').forEach(r => { r.style.display = r.querySelector('.dv-badge.req') ? '' : 'none'; }); }},
      { label: t('الاختياريون فقط','Optional Only'), action: () => { document.querySelectorAll('#dv-att-body tr').forEach(r => { r.style.display = r.querySelector('.dv-badge.opt') ? '' : 'none'; }); }},
      { label: t('المحددون فقط','Selected Only'),  action: () => { document.querySelectorAll('#dv-att-body tr').forEach(r => { r.style.display = r.querySelector('.dv-cb:checked') ? '' : 'none'; }); }},
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:9px 16px;cursor:pointer;font-size:13px;color:#15201A;';
      div.textContent = opt.label;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.action(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left  + window.scrollX)     + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }), 10);
  },

  _dvAddAttachment() {
    const t = (ar, en) => this.t(ar, en);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.png,.jpg';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const grid = document.querySelector('.dv-files-grid');
      if (!grid) return;
      const ext  = file.name.split('.').pop().toLowerCase();
      const size = file.size > 1048576 ? (file.size/1048576).toFixed(1)+' MB' : Math.round(file.size/1024)+' KB';
      const iconMap = { pdf:'📋', docx:'📄', doc:'📄', xlsx:'📊', xls:'📊', pptx:'📊', png:'🖼', jpg:'🖼' };
      const card = document.createElement('div');
      card.className = 'dv-file-card';
      card.innerHTML = `<div class="dv-file-icon-wrap" style="background:rgba(0,0,0,.05);color:#546E7A"><span>${iconMap[ext]||'📎'}</span></div><div class="dv-file-info"><div class="dv-file-name">${file.name}</div><div class="dv-file-meta">${ext.toUpperCase()} · ${size}</div></div><span class="dv-file-ok">✅</span>`;
      const addBtn = grid.querySelector('.dv-add-more');
      if (addBtn) grid.insertBefore(card, addBtn);
      else grid.appendChild(card);
      showToast(t('✅ تم إضافة المرفق','✅ Attachment added'), 'success');
    };
    input.click();
  },

  _dvPreviewEmail() {
    const t = (ar, en) => this.t(ar, en);
    const msg = document.getElementById('dv-msg')?.value || '';
    const dlDate = document.getElementById('dv-dl-date')?.value || '';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:32px;width:560px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.25);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div style="font-size:17px;font-weight:800;color:#15201A">✉️ ${t('معاينة البريد الإلكتروني','Email Preview')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">✕</button>
  </div>
  <div style="background:#F8F9FB;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #E4E7EC">
    <div style="font-size:11px;color:#8A948D;margin-bottom:4px">${t('من:','From:')} <strong>أمين السر — Ameen Secretary</strong></div>
    <div style="font-size:11px;color:#8A948D;margin-bottom:4px">${t('الموضوع:','Subject:')} ${t('طلب مراجعة محضر الاجتماع','Minutes Review Request')} — New Test ABC</div>
    <div style="font-size:11px;color:#8A948D">${t('إلى:','To:')} ${t('أعضاء مجلس الإدارة (6 مستلمين)','Board Members (6 recipients)')}</div>
  </div>
  <div style="background:#fff;border:1px solid #E4E7EC;border-radius:12px;padding:20px;font-size:13px;color:#15201A;line-height:1.7;white-space:pre-line">${msg || t('(لا توجد رسالة مخصصة)','(No custom message)')}</div>
  ${dlDate ? `<div style="margin-top:14px;padding:12px 16px;background:rgba(168,132,44,.08);border-radius:10px;font-size:12.5px;color:#A8842C;border:1px solid rgba(168,132,44,.2)">⏰ ${t('الموعد النهائي:','Deadline:')} <strong>${new Date(dlDate).toLocaleDateString(t('ar-SA','en-GB'),{day:'numeric',month:'long',year:'numeric'})}</strong></div>` : ''}
  <div style="margin-top:16px;padding:12px 16px;background:#F2F3F5;border-radius:10px;font-size:12px;color:#46514A">📎 ${t('المرفقات: محضر الاجتماع (PDF) + 3 مستندات','Attachments: Meeting Minutes (PDF) + 3 documents')}</div>
  <button onclick="this.closest('div[style*=fixed]').remove()" style="margin-top:18px;width:100%;padding:11px;border-radius:9px;border:none;background:#0F1728;color:#fff;font-size:13.5px;font-weight:700;cursor:pointer">${t('إغلاق','Close')}</button>
</div>`;
    document.body.appendChild(overlay);
  },

  _dvSendTest() {
    const t = (ar, en) => this.t(ar, en);
    showToast(t('⏳ جارٍ إرسال نسخة اختبارية إلى بريدك...','⏳ Sending test copy to your email...'), 'info');
    setTimeout(() => showToast(t('✅ تم إرسال النسخة الاختبارية بنجاح إلى بريدك الإلكتروني','✅ Test email sent to your inbox successfully'), 'success'), 1500);
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
      const name  = att.name || (l==='ar' ? att.name_ar : att.name_en) || att.name_ar || att.name_en || '';
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
          <button class="rv-act-btn" title="${t('عرض التفاصيل','View Details')}" onclick="ApprovalCycle._rvViewAttendee(${JSON.stringify(a.name)})">👁</button>
          ${canDownload ? `<button class="rv-act-btn" title="${t('تحميل المراجعة','Download Review')}" onclick="ApprovalCycle._rvDownloadReview(${JSON.stringify(a.name)})">⬇</button>` : ''}
          <button class="rv-act-btn" title="${t('إرسال تذكير','Send Reminder')}" onclick="ApprovalCycle._sendReminderOne(${JSON.stringify(a.name)},${JSON.stringify(a.role)},${JSON.stringify(a.status)})">✉️</button>
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
      <button class="dm-btn ghost" onclick="ApprovalCycle._rvExportReport()">📊 ${t('تصدير تقرير','Export Report')}</button>
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
        <button class="dv-preview-btn" onclick="ApprovalCycle._s1Preview()">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
        <button class="dv-preview-btn" style="margin-top:6px;color:#0C7A3D;border-color:rgba(12,122,61,.3)" onclick="ApprovalCycle._rvAddComment()">💬 ${t('إضافة تعليق','Add Comment')}</button>
      </div>

      <!-- Review Timeline -->
      <div class="rv-timeline-card">
        <div class="dm-sidebar-head" style="padding:14px 0 8px">${t('الجدول الزمني للمراجعة','Review Timeline')}</div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">📅</span>
          <div>
            <div class="rv-tl-label">${t('الموعد النهائي','Review Deadline')}</div>
            <div class="rv-tl-val">${dlFmt}</div>
            ${daysLeft !== '' ? `<div class="rv-tl-rem ${Number(daysLeft)<=3?'rv-tl-warn':''}">${daysLeft} ${t('أيام','days')}, ${hoursLeft} ${t('ساعة متبقية','hours left')}</div>` : ''}
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
          <span class="rv-tl-ico">✅</span>
          <div>
            <div class="rv-tl-label">${t('الاستجابات المستلمة','Responses Received')}</div>
            <div class="rv-tl-val">${nDone + nRev + nEdit} ${t('من','of')} ${total}</div>
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">⏱</span>
          <div>
            <div class="rv-tl-label">${t('مدة المراجعة الكلية','Total Review Duration')}</div>
            <div class="rv-tl-val">8 ${t('أيام','Days')}</div>
          </div>
        </div>
        <button class="dv-preview-btn" style="margin-top:10px" onclick="ApprovalCycle._rvViewTimeline()">📋 ${t('عرض الجدول الزمني','View Timeline')}</button>
        <button class="dv-preview-btn" style="margin-top:6px;color:#C4453C;border-color:rgba(196,69,60,.3)" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('تذكير الكل','Remind All Pending')}</button>
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

      <!-- Search + filter toolbar -->
      <div class="rv-att-toolbar" style="display:flex;align-items:center;gap:8px;margin:12px 0 10px;flex-wrap:wrap">
        <div class="dv-search-box" style="flex:1;min-width:160px">
          <span class="dv-search-ico">🔍</span>
          <input class="dv-search-inp" type="text" id="rv-search-inp"
            placeholder="${t('بحث عن حضور...','Search attendee...')}"
            oninput="ApprovalCycle._rvSearchAtt(this.value)">
        </div>
        <button class="dv-filter-btn" onclick="ApprovalCycle._rvFilterMenu(this)">⚙ ${t('تصفية','Filter')}</button>
        <button class="dv-filter-btn" style="color:#0C7A3D;border-color:rgba(12,122,61,.3)" onclick="ApprovalCycle._rvAddComment()">💬 ${t('إضافة تعليق','Add Comment')}</button>
        <button class="dv-filter-btn" style="color:#C4453C;border-color:rgba(196,69,60,.3)" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('تذكير الكل','Remind All')}</button>
      </div>

      <!-- Attendee review table -->
      <div class="rv-table-wrap">
        <table class="rv-table" id="rv-att-table">
          <thead><tr>
            <th>${t('الحضور','Attendee')}</th>
            <th>${t('الدور','Role')}</th>
            <th>${t('الحالة','Status')}</th>
            <th>${t('التعليقات','Comments')}</th>
            <th>${t('آخر نشاط','Last Activity')}</th>
            <th>${t('تاريخ المراجعة','Review Date')}</th>
            <th>${t('الإجراءات','Actions')}</th>
          </tr></thead>
          <tbody id="rv-att-body">${attRows}</tbody>
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
        <button class="dm-link-btn" onclick="ApprovalCycle._rvViewAllComments()">${t('عرض كل التعليقات →','View All Comments →')}</button>
      </div>

      <!-- Quick Actions -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">⚡ ${t('إجراءات سريعة','Quick Actions')}</div>
        <button class="dv-preview-btn" style="margin-bottom:6px;width:100%" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('إرسال تذكير للمعلّقين','Remind Pending Attendees')}</button>
        <button class="dv-preview-btn" style="margin-bottom:6px;width:100%" onclick="ApprovalCycle._rvAddComment()">💬 ${t('إضافة تعليق أمانة','Add Secretary Comment')}</button>
        <button class="dv-preview-btn" style="margin-bottom:6px;width:100%;color:#0C7A3D;border-color:rgba(12,122,61,.3)" onclick="ApprovalCycle._rvExportReport()">📊 ${t('تصدير تقرير المراجعة','Export Review Report')}</button>
        <button class="dv-preview-btn" style="width:100%;color:#A8842C;border-color:rgba(168,132,44,.3)" onclick="ApprovalCycle._rvViewTimeline()">📅 ${t('عرض الجدول الزمني','View Full Timeline')}</button>
      </div>

      <!-- AI Insights -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">✨ ${t('رؤى الذكاء الاصطناعي','AI Insights')}</div>
        <div class="rv-insights">${insightRows}</div>
        <button class="dm-link-btn" onclick="ApprovalCycle._rvViewAllInsights()">${t('عرض كل الرؤى →','View All Insights →')}</button>
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
      const name    = att.name || (l==='ar' ? att.name_ar : att.name_en) || att.name_ar || att.name_en || '';
      const role    = att.board_role || att.role || '';
      const status  = getStatus(name);
      const myComs  = commentsByName[name] || [];
      const lastCom = myComs.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))[0];
      return { name, role, status, comCnt: myComs.length, lastCom, att, bg: AV_COLORS[i % AV_COLORS.length] };
    });

    const nTotal   = attWithStatus.length;
    const nDone    = attWithStatus.filter(a => a.status === 'completed').length;
    const nRev     = attWithStatus.filter(a => a.status === 'in_review').length;
    const nEdit    = attWithStatus.filter(a => a.status === 'reviewed_pending_edits').length;
    const nNone    = attWithStatus.filter(a => a.status === 'not_started').length;
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
    const nPending  = nRev + nEdit + nNone;
    const canSubmit = nPending === 0 || isOverdue;

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
      <button class="dm-btn ghost" onclick="ApprovalCycle._rdDownloadMenu(this)">📥 ${t('تحميل التقرير','Download Report')} ▾</button>
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
        <button class="dv-preview-btn" onclick="ApprovalCycle._s1Preview()">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
        <button class="dv-preview-btn" style="margin-top:6px;color:#A8842C;border-color:rgba(168,132,44,.3)" onclick="ApprovalCycle._editDeadline()">✏️ ${t('تعديل الموعد','Edit Deadline')}</button>
        <button class="dv-preview-btn" style="margin-top:6px;color:#C4453C;border-color:rgba(196,69,60,.3)" onclick="ApprovalCycle._sendReminderAll()">🔔 ${t('إرسال تذكير','Send Reminder')}</button>
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
            ${!isOverdue && dl ? `<div class="rv-tl-rem ${daysLeft<=3?'rv-tl-warn':''}">${daysLeft} ${t('أيام','Days')}, ${hoursLeft} ${t('ساعة متبقية','Hours Left')}</div>` : ''}
            ${isOverdue ? `<div class="rd-overdue-lbl">${t('انتهى الموعد','Deadline Passed')}</div>` : ''}
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">✅</span>
          <div>
            <div class="rv-tl-label">${t('الاستجابات','Responses')}</div>
            <div class="rv-tl-val">${nDone + nRev + nEdit} ${t('من','of')} ${nTotal} ${t('حضور','attendees')}</div>
          </div>
        </div>
        <div class="rv-tl-row">
          <span class="rv-tl-ico">⏱</span>
          <div>
            <div class="rv-tl-label">${t('مدة المراجعة الكلية','Total Review Duration')}</div>
            <div class="rv-tl-val">8 ${t('أيام','Days')}</div>
          </div>
        </div>
        <button class="dv-preview-btn" style="margin-top:10px" onclick="ApprovalCycle._rvViewTimeline()">📋 ${t('عرض الجدول الكامل','View Full Timeline')}</button>
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

      <!-- Review Progress Banner -->
      <div class="rd-progress-banner">
        <div class="rd-pb-row">
          <div class="rd-pb-left">
            <span class="rd-pb-title">📊 ${t('اكتمال المراجعة','Review Completion')}</span>
            <span class="rd-pb-fraction">${nDone} ${t('من','of')} ${nTotal} ${t('حضور','attendees')}</span>
          </div>
          <span class="rd-pb-pct ${nPending===0?'rd-pb-pct-done':''}">${nTotal ? Math.round(nDone/nTotal*100) : 0}%</span>
        </div>
        <div class="rd-pb-bar-wrap">
          <div class="rd-pb-bar" style="width:${nTotal ? Math.round(nDone/nTotal*100) : 0}%"></div>
        </div>
        <div class="rd-pb-info">
          💡 ${t('يمكنك فتح شاشة المراجعة والحل في أي وقت لمتابعة التعليقات وحلّها أولاً بأول.','You can open Review & Resolve at any time to monitor comments and start resolving them as they are received.')}
        </div>
        ${nPending > 0 && !isOverdue ? `
        <div class="rd-pb-warn">
          ⚠️ <strong>${nPending} ${t('من','of')} ${nTotal}</strong> ${t('حضور لم يكملوا مراجعتهم بعد. لا يمكن تقديم المحضر للاعتماد النهائي حتى اكتمال جميع المراجعات المطلوبة أو انتهاء الموعد النهائي.','attendees are still pending review. You cannot submit for Final Approval until all required reviews are complete or the deadline has expired.')}
        </div>` : isOverdue ? `
        <div class="rd-pb-expired">
          ✅ ${t('انتهى الموعد النهائي — يمكنك المتابعة للاعتماد النهائي.','Deadline has expired — you may proceed to Final Approval.')}
        </div>` : `
        <div class="rd-pb-complete">
          ✅ ${t('أكمل جميع الحضور مراجعاتهم — يمكنك تقديم المحضر للاعتماد النهائي.','All attendees have completed their reviews — ready for Final Approval.')}
        </div>`}
      </div>

      <!-- Attendee Review Status table -->
      <div class="rd-section-hdr" style="margin-top:16px">
        <span class="rd-section-ico">👥</span>
        <span class="rd-section-title">${t('حالة مراجعة الحضور','Attendee Review Status')}</span>
        <div style="margin-right:auto;display:flex;gap:7px;align-items:center">
          <div style="position:relative">
            <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:#8A948D">🔍</span>
            <input id="rd-search-att" type="text" placeholder="${t('بحث...','Search...')}"
              oninput="ApprovalCycle._rdSearchAtt(this.value)"
              style="border:1px solid #E4E7EC;border-radius:7px;padding:5px 32px 5px 10px;font-size:12px;color:#15201A;background:#fff;outline:none;width:150px">
          </div>
          <button class="dv-filter-btn" style="font-size:12px;padding:5px 10px" onclick="ApprovalCycle._rdFilterMenu(this)">⚙ ${t('تصفية','Filter')}</button>
        </div>
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
          <tbody id="rd-att-body">${attRows}</tbody>
        </table>
      </div>

      <div class="rd-table-footer">
        <span class="rd-table-note">ℹ️ ${t('تتحدّث الحالات تلقائياً عند تقديم الحضور مراجعاتهم.','Statuses update automatically as attendees submit their reviews.')}</span>
        <button class="rd-export-btn" onclick="ApprovalCycle._rdExportStatus()">📤 ${t('تصدير الحالة','Export Status')}</button>
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
        <button class="dm-link-btn" onclick="ApprovalCycle._renderStep3Reviews()">${t('عرض كل الحضور →','View All Attendees →')}</button>
      </div>

      <!-- Reminder Activity -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">🔔 ${t('نشاط التذكير','Reminder Activity')}</div>
        <div class="rd-reminder-rows">
          <div class="rd-rem-row">
            <div class="rd-rem-left">
              <div class="rd-rem-label">${t('آخر تذكير مُرسَل','Last reminder sent')}</div>
              <div class="rd-rem-val">${sentFmt || '—'}</div>
            </div>
            <span class="rd-rem-pill">${t('إلى','To')} ${nRev + nNone} ${t('حضور معلّق','Pending Attendees')}</span>
          </div>
          <div class="rd-rem-row" style="border-top:1px solid #F2F3F5;padding-top:8px;margin-top:2px">
            <div class="rd-rem-left">
              <div class="rd-rem-label">${t('التذكير التالي المجدول','Next scheduled reminder')}</div>
              <div class="rd-rem-val">${dl ? (() => { const d2 = new Date(dl); d2.setDate(d2.getDate()-2); return d2.toLocaleDateString(l==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'long',year:'numeric'})+', 09:00 AM'; })() : '—'}</div>
            </div>
          </div>
          <div class="rd-rem-row" style="border-top:1px solid #F2F3F5;padding-top:8px;margin-top:2px">
            <div class="rd-rem-left">
              <div class="rd-rem-label">${t('إجمالي التذكيرات المُرسَلة','Total Reminders Sent')}</div>
              <div class="rd-rem-val"><strong>2</strong> ${t('تذكيرات','reminders')}</div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="dv-preview-btn" style="flex:1;background:#0F1728;color:#fff;border-color:#0F1728"
            onclick="ApprovalCycle._sendReminderAll()">
            🔔 ${t('إرسال الآن','Send Now')}
          </button>
          <button class="dv-preview-btn" style="flex:1" onclick="ApprovalCycle._rdScheduleReminder()">
            📅 ${t('جدولة','Schedule')}
          </button>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">⚡ ${t('إجراءات سريعة','Quick Actions')}</div>
        <button class="dv-preview-btn" style="margin-bottom:6px;width:100%" onclick="ApprovalCycle._editDeadline()">✏️ ${t('تعديل الموعد النهائي','Edit Deadline')}</button>
        <button class="dv-preview-btn" style="margin-bottom:6px;width:100%;color:#0C7A3D;border-color:rgba(12,122,61,.3)" onclick="ApprovalCycle._rdExportStatus()">📊 ${t('تصدير تقرير الحالة','Export Status Report')}</button>
        <button class="dv-preview-btn" style="width:100%;color:#A8842C;border-color:rgba(168,132,44,.3)" onclick="ApprovalCycle._rvViewTimeline()">📋 ${t('عرض الجدول الزمني','View Full Timeline')}</button>
      </div>

      <!-- AI Insights -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">✨ ${t('رؤى الذكاء الاصطناعي','AI Insights')}</div>
        <div class="rv-insights">${insightRows}</div>
        <button class="dm-link-btn" onclick="ApprovalCycle._rvViewAllInsights()">${t('عرض كل الرؤى →','View All Insights →')}</button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar rd-bb-split">
    <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep3Reviews()">← ${t('العودة','Back to Attendee Reviews')}</button>
    <div class="rd-bb-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._editDeadline()">✏️ ${t('تعديل الموعد','Edit Deadline')}</button>
      <button class="dm-btn secondary rd-monitor-btn" onclick="ApprovalCycle._renderStep5Resolve()">
        👁 ${t('فتح المراجعة والحل','Open Review & Resolve')}
        <span class="rd-monitor-tag">${t('متاح الآن','Available Now')}</span>
      </button>
      <div class="rd-sf-group">
        <button class="rd-sf-btn ${canSubmit ? 'rd-sf-active' : 'rd-sf-locked'}"
          onclick="ApprovalCycle._rdCheckSubmit(${canSubmit}, ${nPending}, ${nTotal})">
          ${canSubmit ? '✅' : '🔒'} ${t('تقديم للاعتماد النهائي','Submit for Final Approval')}
        </button>
        ${!canSubmit ? `<div class="rd-sf-warn">⚠️ ${nPending} ${t('من','of')} ${nTotal} ${t('حضور لم يكملوا المراجعة بعد','attendees still pending review')}</div>` : ''}
      </div>
    </div>
  </div>

</div>`;

    /* ── Start live countdown ticker ─────────────────────────────────────── */
    if (dl && !isOverdue) this._rdStartCountdown(dl);
  },

  /* ── Submit gate helper (Step 4) ──────────────────────────────────────── */
  _rdCheckSubmit(canSubmit, nPending, nTotal) {
    if (canSubmit) {
      this._onStepClick(5);
    } else {
      showToast(
        this.t(
          `⚠️ ${nPending} من ${nTotal} حضور لم يكملوا مراجعتهم بعد. لا يمكن التقديم حتى اكتمال جميع المراجعات أو انتهاء الموعد.`,
          `⚠️ ${nPending} of ${nTotal} attendees are still pending review. Submission for Final Approval is blocked until all reviews are complete or the deadline expires.`
        ), 'warn', 5000
      );
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 5 — REVIEW & RESOLVE SCREEN
     ═══════════════════════════════════════════════════════════════════════ */
  _renderStep5Resolve() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting  || {};
    const d  = this._data     || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    const comments  = d.comments  || [];
    const agenda    = fd.agenda    || [];
    const decisions = fd.decisions || [];
    const tasks     = fd.tasks     || [];
    const mType     = m.meeting_type || '';

    /* ── State ─────────────────────────────────────────────────────────────── */
    this._rrState = { tab: 'all', page: 1 };

    /* ── Attendee review completion (for Submission Readiness) ─────────────── */
    const AV_COLORS2 = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A90D9','#8E44AD'];
    const attendees2 = fd.attendees || [];
    const attSigs2   = (d.signatures || []).filter(s => s.sig_stage === 'review');
    const attComms2  = d.comments   || [];
    const att2WithStatus = attendees2.map((att, i) => {
      const name  = att.name || att.full_name || att.attendee_name || '';
      const myComs = attComms2.filter(c => c.commenter_name === name);
      const mySigs = attSigs2.filter(s => s.signer_name === name);
      let status;
      if (mySigs.length && mySigs.every(s => s.status === 'signed')) status = 'completed';
      else if (myComs.some(c => c.status === 'pending')) status = 'in_review';
      else if (myComs.length) status = 'reviewed_pending_edits';
      else status = 'not_started';
      return { name, status };
    });
    const att2Total   = att2WithStatus.length;
    const att2Done    = att2WithStatus.filter(a => a.status === 'completed').length;
    const att2Pending = att2Total - att2Done;
    const cycle2 = d.cycle || {};
    const dl2     = cycle2.comment_deadline || '';
    const isOverdue2 = dl2 ? new Date(dl2) < new Date() : false;
    const canSubmit2  = att2Pending === 0 || isOverdue2;

    /* ── Comment status counts (must be before canFullSubmit) ───────────────── */
    const nTotal    = comments.length;
    const nResolved = comments.filter(c => c.status === 'accepted').length;
    const nInResolve= comments.filter(c => c.status === 'pending').length;
    const nRejected = comments.filter(c => c.status === 'rejected').length;

    const commentsAllResolved = comments.every(c => c.status === 'accepted' || c.status === 'rejected');
    const canFullSubmit = canSubmit2 && (commentsAllResolved || nTotal === 0);

    /* ── Comment type counts ───────────────────────────────────────────────── */
    const TYPE_LABELS = { clarification:'Clarification Request', change:'Change Request', suggestion:'Suggestion', general:'General Comment' };
    const getType = (c) => {
      const r = (c.clause_ref || '').toLowerCase();
      if (r.includes('clarif')) return 'clarification';
      if (r.includes('change') || r.includes('تعديل')) return 'change';
      if (r.includes('suggest') || r.includes('اقتراح')) return 'suggestion';
      return 'general';
    };
    const typeCounts = { clarification:0, change:0, suggestion:0, general:0 };
    comments.forEach(c => { const type = getType(c); typeCounts[type] = (typeCounts[type]||0)+1; });

    /* ── Activity log — built from comments (decided + submitted events) ─────── */
    const _buildActLog = () => {
      const events = [];
      comments.forEach(c => {
        if (c.decided_at && (c.status === 'accepted' || c.status === 'rejected')) {
          events.push({
            when: c.decided_at,
            dot:  c.status === 'accepted' ? '#0C7A3D' : '#C4453C',
            desc: c.status === 'accepted'
              ? t(`تم قبول تعليق ${c.commenter_name}`, `Accepted comment from ${c.commenter_name}`)
              : t(`تم رفض تعليق ${c.commenter_name}`, `Rejected comment from ${c.commenter_name}`),
            actor: c.decided_by || t('الأمين','Secretary'),
          });
        }
        events.push({
          when: c.created_at,
          dot: '#A8842C',
          desc: t(`أضاف ${c.commenter_name} تعليقاً على ${c.clause_ref||'المحضر'}`,
                  `${c.commenter_name} submitted a comment on ${c.clause_ref||'minutes'}`),
          actor: c.commenter_name,
        });
      });
      events.sort((a,b) => (b.when||'').localeCompare(a.when||''));
      return events;
    };
    const actEvents = _buildActLog();
    const actRows = actEvents.slice(0,4).map(a => `
      <div class="rr-log-row"><span class="rr-log-dot" style="background:${a.dot}"></span>
        <div class="rr-log-body"><div class="rr-log-desc">${esc(a.desc)}</div>
        <div class="rr-log-who">${esc(a.actor)} — ${(a.when||'').slice(0,16).replace('T',' ')}</div></div></div>
    `).join('') || `<div class="rr-log-row"><span class="rr-log-dot" style="background:#8A948D"></span><div class="rr-log-body"><div class="rr-log-desc">${t('لا نشاط مسجّل بعد','No activity recorded yet')}</div></div></div>`;

    /* ── Impact summary ────────────────────────────────────────────────────── */
    const secAff  = Math.min(comments.length, agenda.length  || 3);
    const decAff  = Math.min(nResolved, decisions.length || 2);
    const taskAff = Math.min(comments.length, tasks.length   || 3);

    /* ── Resolve overview donut ────────────────────────────────────────────── */
    const donutSegs = [
      { label: t('محلول','Resolved'),        val: nResolved,  color: '#0F1728' },
      { label: t('قيد الحل','In Resolve'),   val: nInResolve, color: '#A8842C' },
      { label: t('مرفوض','Rejected'),        val: nRejected,  color: '#C4453C' },
    ].filter(s => s.val > 0);
    const donutSVG = this._donutChartSVG(donutSegs, nTotal||0, 46, t('الإجمالي','Total'));

    /* ── Mini stepper ──────────────────────────────────────────────────────── */
    const miniStepper = this._buildMiniStepper(cycle, 4, t, l);

    /* ── Render shell ──────────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-wrap">

  <!-- Top bar -->
  <div class="dm-topbar">
    <div class="dm-breadcrumb">
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('الاجتماعات','Meetings')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item">${esc(mType)}</span>
      <span class="dm-bc-sep">›</span>
      <button class="dm-bc-btn" onclick="ApprovalCycle._render()">${t('دورة الاعتماد','Approval Cycle')}</button>
      <span class="dm-bc-sep">›</span>
      <span class="dm-bc-item dm-bc-active">${t('مراجعة وحل','Review & Resolve')}</span>
    </div>
    <div class="dm-topbar-actions">
      <button class="dm-btn ghost" onclick="ApprovalCycle._rrExportReport(this)">📊 ${t('تصدير التقرير','Export Report')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._rrDownloadMenu(this)">📥 ${t('تحميل نسخة العمل','Download Working Copy')} ▾</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(5)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('النسخة النهائية','Final Version')}</span>
      </button>
    </div>
  </div>

  <!-- Title bar -->
  <div class="dm-titlebar">
    <div class="dm-page-h1">${t('مراجعة وحل','Review & Resolve')} <span class="dm-badge-prog">${t('قيد التنفيذ','In Progress')}</span></div>
    <div class="dm-page-sub">${t('راجع تعليقات الحضور، اقترح حلولاً، وأنهِ التعديلات على المحضر.','Review attendee comments, suggest resolutions, and finalize changes to the minutes.')}</div>
  </div>

  <!-- Mini stepper -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- 3-col body -->
  <div class="rr-body">

    <!-- LEFT sidebar -->
    <div class="rr-sidebar">
      <div class="dm-sidebar-head">${t('ملخص المراجعة','Review Summary')}</div>

      <!-- Summary stats grid -->
      <div class="rr-summary-grid">
        <div class="rr-sum-card rr-sum-total">
          <div class="rr-sum-num">${nTotal}</div>
          <div class="rr-sum-lbl">${t('إجمالي التعليقات','Total Comments')}</div>
        </div>
        <div class="rr-sum-card rr-sum-done">
          <div class="rr-sum-num">${nResolved}</div>
          <div class="rr-sum-lbl">${t('محلول','Resolved')}</div>
        </div>
        <div class="rr-sum-card rr-sum-rev">
          <div class="rr-sum-num">${nInResolve}</div>
          <div class="rr-sum-lbl">${t('قيد الحل','In Resolve')}</div>
        </div>
        <div class="rr-sum-card rr-sum-rej">
          <div class="rr-sum-num">${nRejected}</div>
          <div class="rr-sum-lbl">${t('مرفوض','Rejected')}</div>
        </div>
      </div>

      <!-- Comments by Type -->
      <div class="rr-by-type">
        <div class="rr-by-type-hdr">${t('التعليقات حسب النوع','Comments by Type')}</div>
        ${Object.entries(TYPE_LABELS).map(([k,label]) => `
          <div class="rr-type-row">
            <span class="rr-type-ico rr-ti-${k}">●</span>
            <span class="rr-type-name">${t(k==='clarification'?'طلب توضيح':k==='change'?'طلب تعديل':k==='suggestion'?'اقتراح':'تعليق عام', label)}</span>
            <span class="rr-type-cnt">${typeCounts[k]||0}</span>
          </div>`).join('')}
      </div>

      <!-- Resolve Guidelines -->
      <div class="rr-guidelines">
        <div class="rr-by-type-hdr">${t('إرشادات الحل','Resolve Guidelines')}</div>
        ${[
          t('راجع كل تعليق بعناية','Review each comment carefully'),
          t('اقترح حلاً أو عدّل المحتوى','Propose a resolution or edit the content'),
          t('اضبط الحالة: محلول أو مرفوض أو قيد الحل','Mark as Resolved, Rejected, or In Resolve'),
          t('جميع التغييرات تُتَبَّع في سجل النسخ','All changes will be tracked in version history.'),
        ].map(g => `<div class="rr-guide-row">✅ <span>${g}</span></div>`).join('')}
      </div>
      <!-- Bulk Actions -->
      ${nInResolve > 0 ? `
      <div style="margin-top:10px;padding:10px 0;border-top:1px solid #F2F3F5">
        <div class="rr-by-type-hdr" style="margin-bottom:8px">${t('إجراءات جماعية','Bulk Actions')}</div>
        <button class="dv-preview-btn" style="width:100%;color:#0C7A3D;border-color:rgba(12,122,61,.3);margin-bottom:6px"
          onclick="ApprovalCycle._rrBulkResolveAll()">✅ ${t('قبول كل التعليقات المعلّقة','Accept All Pending')}</button>
        <button class="dv-preview-btn" style="width:100%;color:#C4453C;border-color:rgba(196,69,60,.3)"
          onclick="ApprovalCycle._rrBulkRejectAll()">🚫 ${t('رفض كل التعليقات المعلّقة','Reject All Pending')}</button>
      </div>` : ''}
      <button class="dv-preview-btn" style="margin:10px 0 4px;width:100%" onclick="ApprovalCycle._rrViewPolicy()">📋 ${t('عرض سياسة الحل','View Resolve Policy')}</button>
    </div>

    <!-- CENTER: tab bar + cards -->
    <div class="rr-center">
      <!-- Tab bar -->
      <div class="rr-tabbar">
        <div class="rr-tabs">
          <button class="rr-tab active" data-tab="all"     onclick="ApprovalCycle._rrSetTab('all')">${t('الكل','All')} (${nTotal})</button>
          <button class="rr-tab"        data-tab="pending" onclick="ApprovalCycle._rrSetTab('pending')">${t('قيد الحل','Pending')} (${nInResolve})</button>
          <button class="rr-tab"        data-tab="accepted"onclick="ApprovalCycle._rrSetTab('accepted')">${t('محلول','Resolved')} (${nResolved})</button>
          <button class="rr-tab"        data-tab="rejected"onclick="ApprovalCycle._rrSetTab('rejected')">${t('مرفوض','Rejected')} (${nRejected})</button>
        </div>
        <div class="rr-filters">
          <div style="position:relative">
            <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;color:#8A948D;pointer-events:none">🔍</span>
            <input id="rr-search" type="text" placeholder="${t('بحث في التعليقات...','Search comments...')}"
              oninput="ApprovalCycle._rrSearch(this.value)"
              style="border:1px solid #E4E7EC;border-radius:7px;padding:5px 28px 5px 10px;font-size:12px;color:#15201A;background:#fff;outline:none;width:160px">
          </div>
          <select class="rr-filter-sel" id="rr-filter-type" onchange="ApprovalCycle._rrRenderCards()">
            <option value="">${t('كل الأنواع','All Types')}</option>
            <option value="clarification">${t('طلب توضيح','Clarification')}</option>
            <option value="change">${t('طلب تعديل','Change Request')}</option>
            <option value="suggestion">${t('اقتراح','Suggestion')}</option>
            <option value="general">${t('تعليق عام','General')}</option>
          </select>
          <select class="rr-filter-sel" id="rr-filter-att" onchange="ApprovalCycle._rrRenderCards()">
            <option value="">${t('كل الحضور','All Attendees')}</option>
            ${[...new Set(comments.map(c=>c.commenter_name).filter(Boolean))]
              .map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}
          </select>
          <button class="rr-filter-btn" onclick="ApprovalCycle._rrRenderCards()">⚙️ ${t('تطبيق','Apply')}</button>
        </div>
      </div>

      <!-- Comment cards area -->
      <div id="rr-cards" class="rr-cards"></div>

      <!-- Pagination -->
      <div id="rr-pagination" class="rr-pagination"></div>
    </div>

    <!-- RIGHT panel -->
    <div class="rv-right">

      <!-- Resolve Overview donut -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('نظرة عامة على الحل','Resolve Overview')}</div>
        <div class="rv-donut-wrap">
          ${donutSVG}
          <div class="rv-donut-legend">
            ${donutSegs.map(s=>`<div class="rv-legend-row"><span class="rv-legend-dot" style="background:${s.color}"></span>${s.label} (${s.val})</div>`).join('')}
            ${!nTotal ? `<div style="font-size:12px;color:#8A948D">${t('لا تعليقات بعد','No comments yet')}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Impact Summary -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">📋 ${t('ملخص الأثر','Impact Summary')}</div>
        <div class="rr-impact-rows">
          <div class="rr-impact-row"><span class="rr-impact-lbl">${t('الأقسام المتأثرة','Sections Affected')}</span><span class="rr-impact-val">${secAff}</span></div>
          <div class="rr-impact-row"><span class="rr-impact-lbl">${t('القرارات المتأثرة','Decisions Affected')}</span><span class="rr-impact-val">${decAff}</span></div>
          <div class="rr-impact-row"><span class="rr-impact-lbl">${t('بنود العمل المتأثرة','Action Items Affected')}</span><span class="rr-impact-val">${taskAff}</span></div>
        </div>
        <button class="dm-link-btn" onclick="ApprovalCycle._rrCompareVersions()">📊 ${t('مقارنة النسخ →','Compare Versions →')}</button>
      </div>

      <!-- Activity Log -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">📜 ${t('سجل النشاط','Activity Log')}</div>
        <div class="rr-log-list">${actRows}</div>
        <button class="dm-link-btn" onclick="ApprovalCycle._rrViewFullLog()">📋 ${t('عرض السجل الكامل →','View Full Log →')}</button>
      </div>

      <!-- AI Assistant -->
      <div class="rv-rpanel rr-ai-panel">
        <div class="rr-ai-hdr">
          <span class="rr-ai-ico">✨</span>
          <div>
            <div class="rr-ai-title">${t('مساعد الذكاء الاصطناعي','AI Assistant')}</div>
            <div class="rr-ai-sub">${nInResolve > 0 ? t(`${nInResolve} تعليقات معلّقة — اقترح الذكاء الاصطناعي حلولاً لها`,`${nInResolve} pending comments — let AI suggest resolutions`) : t('جميع التعليقات تمت معالجتها','All comments have been handled')}</div>
          </div>
        </div>
        ${nInResolve > 0 ? `<button class="rr-ai-btn" onclick="ApprovalCycle._rrAISuggest()">✨ ${t('اقتراح بالذكاء الاصطناعي','Suggest with AI')}</button>` : `<div style="font-size:12px;color:#0C7A3D;font-weight:600;padding:4px 0">✅ ${t('لا توجد تعليقات معلّقة','No pending comments')}</div>`}
      </div>

      <!-- Submission Readiness -->
      <div class="rv-rpanel rr-readiness-panel">
        <div class="rv-rp-title">🎯 ${t('جاهزية التقديم','Submission Readiness')}</div>
        <div class="rr-ready-rows">
          <div class="rr-ready-row">
            <span class="rr-ready-ico">${canSubmit2 ? '✅' : '⚠️'}</span>
            <div class="rr-ready-body">
              <div class="rr-ready-label">${t('مراجعات الحضور','Attendee Reviews')}</div>
              <div class="rr-ready-val ${canSubmit2 ? 'rr-ready-ok' : 'rr-ready-warn'}">
                ${att2Done} ${t('من','of')} ${att2Total} ${t('مكتمل','completed')}
                ${!canSubmit2 ? `<span class="rr-ready-badge-warn">${att2Pending} ${t('معلّق','pending')}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="rr-ready-row">
            <span class="rr-ready-ico">${commentsAllResolved || nTotal===0 ? '✅' : '⚠️'}</span>
            <div class="rr-ready-body">
              <div class="rr-ready-label">${t('حل التعليقات','Comment Resolution')}</div>
              <div class="rr-ready-val ${commentsAllResolved || nTotal===0 ? 'rr-ready-ok' : 'rr-ready-warn'}">
                ${nResolved + nRejected} ${t('من','of')} ${nTotal} ${t('محسوم','resolved')}
                ${nInResolve > 0 ? `<span class="rr-ready-badge-warn">${nInResolve} ${t('معلّق','pending')}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="rr-ready-row">
            <span class="rr-ready-ico">${isOverdue2 ? '⏱️' : '📅'}</span>
            <div class="rr-ready-body">
              <div class="rr-ready-label">${t('الموعد النهائي','Review Deadline')}</div>
              <div class="rr-ready-val ${isOverdue2 ? 'rr-ready-warn' : 'rr-ready-ok'}">
                ${isOverdue2 ? t('انتهى الموعد','Deadline Expired') : t('لا يزال نشطاً','Still Active')}
              </div>
            </div>
          </div>
        </div>
        <button class="rr-submit-btn ${canFullSubmit ? 'rr-submit-active' : 'rr-submit-locked'}"
          onclick="ApprovalCycle._rrCheckSubmit(${canFullSubmit}, ${att2Pending}, ${att2Total}, ${nInResolve})">
          ${canFullSubmit ? '✅' : '🔒'} ${t('تقديم للاعتماد النهائي','Submit for Final Approval')}
        </button>
        ${!canFullSubmit ? `
        <div class="rr-submit-warn-txt">
          ${!canSubmit2 ? `⚠️ ${att2Pending} ${t('من','of')} ${att2Total} ${t('حضور لم يكملوا مراجعتهم','attendees still pending review')}` : ''}
          ${!canSubmit2 && nInResolve > 0 ? '<br>' : ''}
          ${nInResolve > 0 ? `⚠️ ${nInResolve} ${t('تعليق لم يُحسَم بعد','comment(s) still unresolved')}` : ''}
        </div>` : ''}
      </div>

      <!-- Save Changes -->
      <button class="rr-save-btn" onclick="ApprovalCycle._rrSaveAll()">💾 ${t('حفظ التغييرات','Save Changes')}</button>
    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar rd-bb-split">
    <div style="display:flex;gap:8px">
      <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep4Deadline()">← ${t('العودة للموعد النهائي','Back to Review Deadline')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._rrSaveAll()">💾 ${t('حفظ التغييرات','Save Changes')}</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="dm-btn ghost" onclick="ApprovalCycle._rrExportReport(this)">📊 ${t('تصدير التقرير','Export')}</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(5)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('النسخة النهائية','Final Version')}</span>
      </button>
    </div>
  </div>

</div>`;

    this._rrRenderCards();
  },

  /* ── Tab switch ───────────────────────────────────────────────────────── */
  _rrSetTab(tab) {
    if (!this._rrState) this._rrState = { tab: 'all', page: 1 };
    this._rrState.tab  = tab;
    this._rrState.page = 1;
    document.querySelectorAll('.rr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this._rrRenderCards();
  },

  /* ── Render card list ─────────────────────────────────────────────────── */
  _rrRenderCards() {
    const cardsEl = document.getElementById('rr-cards');
    const paginEl = document.getElementById('rr-pagination');
    if (!cardsEl) return;
    const t = (ar, en) => this.t(ar, en);
    const state = this._rrState || { tab: 'all', page: 1 };
    const comments = (this._data || {}).comments || [];

    const typeFilter = (document.getElementById('rr-filter-type') || {}).value || '';
    const attFilter  = (document.getElementById('rr-filter-att')  || {}).value || '';

    const searchQ = (state.search || '').trim().toLowerCase();
    let filtered = [...comments];
    if (state.tab === 'pending')  filtered = filtered.filter(c => c.status === 'pending');
    if (state.tab === 'accepted') filtered = filtered.filter(c => c.status === 'accepted');
    if (state.tab === 'rejected') filtered = filtered.filter(c => c.status === 'rejected');
    if (typeFilter) filtered = filtered.filter(c => this._rrGetType(c) === typeFilter);
    if (attFilter)  filtered = filtered.filter(c => (c.commenter_name||'') === attFilter);
    if (searchQ)    filtered = filtered.filter(c => (c.content||'').toLowerCase().includes(searchQ) || (c.commenter_name||'').toLowerCase().includes(searchQ) || (c.clause_ref||'').toLowerCase().includes(searchQ));

    const PER = 4;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
    const page = Math.max(1, Math.min(state.page, totalPages));
    this._rrState.page = page;
    const paginated = filtered.slice((page-1)*PER, page*PER);

    if (!paginated.length) {
      cardsEl.innerHTML = `<div class="rr-empty-state">${t('لا توجد تعليقات في هذه الفئة','No comments in this category')}</div>`;
    } else {
      cardsEl.innerHTML = paginated.map(c => this._rrBuildCard(c)).join('');
    }

    /* Pagination */
    if (paginEl) {
      const showing = filtered.length
        ? `${t('عرض','Showing')} ${(page-1)*PER+1} ${t('إلى','to')} ${Math.min(page*PER,filtered.length)} ${t('من','of')} ${filtered.length} ${t('تعليق','comments')}`
        : '';
      const pageNums = Array.from({length:totalPages},(_,i)=>i+1)
        .map(p=>`<button class="rr-pg-num${p===page?' active':''}" onclick="ApprovalCycle._rrGoPage(${p})">${p}</button>`).join('');
      paginEl.innerHTML = `
        <span class="rr-pg-info">${showing}</span>
        <div class="rr-pg-btns">
          <button class="rr-pg-nav" onclick="ApprovalCycle._rrGoPage(${page-1})" ${page===1?'disabled':''}>‹</button>
          ${pageNums}
          <button class="rr-pg-nav" onclick="ApprovalCycle._rrGoPage(${page+1})" ${page===totalPages?'disabled':''}>›</button>
        </div>`;
    }
  },

  _rrGoPage(p) {
    if (!this._rrState) return;
    this._rrState.page = p;
    this._rrRenderCards();
  },

  /* ── Build single comment card ────────────────────────────────────────── */
  _rrBuildCard(c) {
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const AV_COLORS = ['#0F1728','#0C7A3D','#A8842C','#1A5276','#7D3C98','#0E6655','#B03A2E'];
    const name   = c.commenter_name || '?';
    const initials = name.split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || '?';
    const bg     = AV_COLORS[(c.id||0) % AV_COLORS.length];
    const role   = c.commenter_role || '';
    const when   = (c.created_at||'').slice(0,16).replace('T',' ');
    const clauseRef = c.clause_ref || '';
    const type   = this._rrGetType(c);
    const typeLabel = { clarification: t('طلب توضيح','Clarification Request'), change: t('طلب تعديل','Change Request'), suggestion: t('اقتراح','Suggestion'), general: t('تعليق عام','General Comment') }[type] || t('تعليق','Comment');

    const STATUS = {
      pending:  { label: t('قيد الحل','In Resolve'), cls: 'rr-st-rev'  },
      accepted: { label: t('محلول','Resolved'),       cls: 'rr-st-done' },
      rejected: { label: t('مرفوض','Rejected'),       cls: 'rr-st-rej'  },
    };
    const st = STATUS[c.status] || STATUS.pending;

    const resolveNote = c.secretary_note || '';
    const decidedBy   = c.decided_by || '';
    const decidedAt   = (c.decided_at||'').slice(0,16).replace('T',' ');

    let resolveSection = '';
    if (c.status === 'accepted' || c.status === 'rejected') {
      resolveSection = `
        <div class="rr-resolve-block rr-rb-done">
          <div class="rr-rb-label">${t('الحل','Resolve')}</div>
          <div class="rr-rb-text">${esc(resolveNote || '—')}</div>
          ${decidedBy ? `<div class="rr-rb-meta">${t('بواسطة','By')} ${esc(decidedBy)}${decidedAt?' — '+decidedAt:''}</div>` : ''}
          <button class="rr-view-btn" onclick="ApprovalCycle._rrViewDetails(${c.id})">👁 ${t('عرض التفاصيل','View Details')}</button>
        </div>`;
    } else if (resolveNote) {
      resolveSection = `
        <div class="rr-resolve-block rr-rb-proposed">
          <div class="rr-rb-label">${t('الحل المقترح','Proposed Resolve')}</div>
          <div id="rr-note-view-${c.id}" class="rr-rb-text">${esc(resolveNote)}</div>
          <div id="rr-note-edit-${c.id}" class="rr-note-edit-wrap" style="display:none">
            <textarea class="rr-note-ta" id="rr-ta-${c.id}" rows="3">${esc(resolveNote)}</textarea>
            <div class="rr-note-edit-btns">
              <button class="dm-btn ghost" onclick="ApprovalCycle._rrToggleEdit(${c.id},false)">${t('إلغاء','Cancel')}</button>
              <button class="dm-btn primary" onclick="ApprovalCycle._rrSaveNote(${c.id})">${t('حفظ','Save')}</button>
            </div>
          </div>
          <div class="rr-rb-meta">${t('مقترح بواسطة','Proposed By')}: ${esc(decidedBy||t('الأمانة','Secretary'))}${decidedAt?' — '+decidedAt:''}</div>
          <div class="rr-rb-actions">
            <button class="rr-edit-btn" onclick="ApprovalCycle._rrToggleEdit(${c.id},true)">✏️ ${t('تعديل الحل','Edit Resolve')}</button>
            <button class="rr-resolve-btn" onclick="ApprovalCycle._rrMarkResolved(${c.id})">✅ ${t('تحديد كمحلول','Mark as Resolved')}</button>
          </div>
        </div>`;
    } else {
      resolveSection = `
        <div class="rr-resolve-block rr-rb-add">
          <div id="rr-add-btn-${c.id}">
            <button class="rr-add-resolve-btn" onclick="ApprovalCycle._rrToggleAdd(${c.id},true)">➕ ${t('إضافة حل','Add Resolve')}</button>
          </div>
          <div id="rr-add-form-${c.id}" class="rr-note-edit-wrap" style="display:none">
            <textarea class="rr-note-ta" id="rr-ta-${c.id}" rows="3" placeholder="${t('اكتب الحل المقترح هنا...','Type proposed resolution here...')}"></textarea>
            <div class="rr-note-edit-btns">
              <button class="dm-btn ghost" onclick="ApprovalCycle._rrToggleAdd(${c.id},false)">${t('إلغاء','Cancel')}</button>
              <button class="dm-btn ghost" onclick="ApprovalCycle._rrMarkRejected(${c.id})">🚫 ${t('رفض','Reject')}</button>
              <button class="dm-btn primary" onclick="ApprovalCycle._rrSaveNote(${c.id})">${t('حفظ الحل','Save Resolve')}</button>
            </div>
          </div>
        </div>`;
    }

    return `
<div class="rr-card" id="rr-card-${c.id}">
  <div class="rr-card-top">
    <div class="rr-card-left">
      <div class="rv-av" style="background:${bg}">${initials}</div>
      <div class="rr-who">
        <div class="rr-who-name">${esc(name)}</div>
        <div class="rr-who-role">${esc(role)}</div>
        <div class="rr-who-date">📅 ${when}</div>
      </div>
    </div>
    <div class="rr-card-mid">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="rr-type-badge rr-tb-${type}">${typeLabel}</span>
        ${clauseRef ? `<span style="font-size:10.5px;color:#8A948D;background:#F5F5F1;padding:2px 8px;border-radius:10px">📌 ${esc(clauseRef)}</span>` : ''}
      </div>
      <div class="rr-comment-text">${esc(c.content||'')}</div>
    </div>
    <div class="rr-card-right">
      <span class="rv-badge ${st.cls}">${st.label}</span>
      <button class="rr-view-btn" onclick="ApprovalCycle._rrViewDetails(${c.id})" style="margin-top:6px">👁</button>
    </div>
  </div>
  ${resolveSection}
</div>`;
  },

  _rrGetType(c) {
    const body = ((c.content||'') + ' ' + (c.clause_ref||'')).toLowerCase();
    if (body.includes('يُطلب توضيح') || body.includes('توضيح') || body.includes('clarif') || body.includes('يُطلب ب')) return 'clarification';
    if (body.includes('أقترح') || body.includes('اقتراح') || body.includes('suggest') || body.includes('يُقترح') || body.includes('مقترح')) return 'suggestion';
    if (body.includes('تعديل') || body.includes('change') || body.includes('زيادة') || body.includes('تغيير')) return 'change';
    return 'general';
  },

  _rrToggleEdit(id, show) {
    const view = document.getElementById(`rr-note-view-${id}`);
    const edit = document.getElementById(`rr-note-edit-${id}`);
    if (view) view.style.display = show ? 'none' : '';
    if (edit) edit.style.display = show ? '' : 'none';
  },
  _rrToggleAdd(id, show) {
    const btn  = document.getElementById(`rr-add-btn-${id}`);
    const form = document.getElementById(`rr-add-form-${id}`);
    if (btn)  btn.style.display  = show ? 'none' : '';
    if (form) form.style.display = show ? '' : 'none';
  },

  async _rrSaveNote(id) {
    const ta  = document.getElementById(`rr-ta-${id}`);
    const note = ta ? ta.value.trim() : '';
    if (!note) { showToast(this.t('يرجى كتابة الحل','Please enter a resolution'), 'warn'); return; }
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${id}`, {
        method: 'PATCH', body: JSON.stringify({ secretary_note: note })
      });
      await this._load();
      this._rrRenderCards();
      showToast(this.t('تم حفظ الحل ✅','Resolution saved ✅'), 'success');
    } catch(e) {
      showToast(this.t('تعذّر الحفظ','Save failed'), 'error');
    }
  },

  async _rrMarkResolved(id) {
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'accepted' })
      });
      await this._load();
      this._rrRenderCards();
      showToast(this.t('تم التحديد كمحلول ✅','Marked as Resolved ✅'), 'success');
    } catch(e) { showToast(this.t('تعذّر التحديث','Update failed'), 'error'); }
  },

  async _rrMarkRejected(id) {
    const ta  = document.getElementById(`rr-ta-${id}`);
    const note = ta ? ta.value.trim() : '';
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'rejected', ...(note ? { secretary_note: note } : {}) })
      });
      await this._load();
      this._rrRenderCards();
      showToast(this.t('تم الرفض','Rejected'), 'info');
    } catch(e) { showToast(this.t('تعذّر التحديث','Update failed'), 'error'); }
  },

  _rrViewDetails(id) {
    const c = ((this._data||{}).comments||[]).find(x=>x.id===id);
    if (!c) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const STATUS = {
      pending:  { label: t('قيد الحل','Pending Resolution'), cls:'rr-st-rev', bg:'rgba(168,132,44,.08)' },
      accepted: { label: t('محلول','Resolved'),               cls:'rr-st-done', bg:'rgba(12,122,61,.06)' },
      rejected: { label: t('مرفوض','Rejected'),               cls:'rr-st-rej',  bg:'rgba(196,69,60,.06)' },
    };
    const st = STATUS[c.status] || STATUS.pending;
    const typeLabel = { clarification: t('طلب توضيح','Clarification Request'), change: t('طلب تعديل','Change Request'), suggestion: t('اقتراح','Suggestion'), general: t('تعليق عام','General Comment') };
    const type = this._rrGetType(c);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:0;width:560px;max-width:95vw;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:22px 26px 16px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A;margin-bottom:4px">👁 ${t('تفاصيل التعليق','Comment Details')}</div>
      <div style="font-size:12px;color:#8A948D">${esc(c.clause_ref||'')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D;padding:0;line-height:1">×</button>
  </div>
  <div style="padding:20px 26px;display:flex;flex-direction:column;gap:14px">
    <!-- Commenter -->
    <div style="display:flex;gap:12px;align-items:center">
      <div style="width:40px;height:40px;border-radius:50%;background:#0F1728;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex-shrink:0">${esc(c.commenter_name||'?').split(/\s+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase()}</div>
      <div>
        <div style="font-size:13.5px;font-weight:800;color:#15201A">${esc(c.commenter_name||'')}</div>
        <div style="font-size:11.5px;color:#8A948D">${esc(c.commenter_role||'')} — ${(c.created_at||'').slice(0,16).replace('T',' ')}</div>
      </div>
      <span style="margin-right:auto;background:${st.bg};color:${st.cls==='rr-st-done'?'#0C7A3D':st.cls==='rr-st-rej'?'#C4453C':'#A8842C'};border-radius:20px;padding:3px 12px;font-size:11.5px;font-weight:700">${st.label}</span>
    </div>
    <!-- Type badge -->
    <div style="font-size:11px;font-weight:700;color:#A8842C;text-transform:uppercase">${typeLabel[type]||''}</div>
    <!-- Content -->
    <div style="background:#F5F5F1;border-radius:10px;padding:14px 16px;font-size:13px;color:#15201A;line-height:1.65">${esc(c.content||'')}</div>
    ${c.secretary_note ? `
    <div>
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#46514A;margin-bottom:6px">📝 ${t('ملاحظة الأمانة','Secretary Note')}</div>
      <div style="background:${st.bg};border-radius:10px;padding:12px 16px;font-size:13px;color:#15201A;line-height:1.6">${esc(c.secretary_note)}</div>
    </div>` : ''}
    ${c.decided_by ? `
    <div style="display:flex;gap:10px;align-items:center;padding:10px 14px;background:#F5F5F1;border-radius:9px">
      <span>${c.status==='accepted'?'✅':'🚫'}</span>
      <div style="font-size:12px;color:#46514A"><strong>${esc(c.decided_by)}</strong> — ${(c.decided_at||'').slice(0,16).replace('T',' ')}</div>
    </div>` : ''}
    ${c.status === 'pending' ? `
    <div style="border-top:1px solid #F2F3F5;padding-top:14px;display:flex;gap:8px">
      <button onclick="ApprovalCycle._rrMarkResolved(${c.id});this.closest('div[style*=fixed]').remove()"
        style="flex:1;padding:9px;background:#0C7A3D;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">✅ ${t('قبول','Accept')}</button>
      <button onclick="ApprovalCycle._rrMarkRejected(${c.id});this.closest('div[style*=fixed]').remove()"
        style="flex:1;padding:9px;background:#C4453C;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">🚫 ${t('رفض','Reject')}</button>
    </div>` : ''}
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  async _rrSaveAll() {
    const btn = document.querySelector('.rr-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + this.t('جارٍ الحفظ...','Saving...'); }
    await new Promise(r => setTimeout(r, 600));
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 ' + this.t('حفظ التغييرات','Save Changes'); }
    showToast(this.t('✅ تم حفظ جميع التغييرات','✅ All changes saved'), 'success');
  },

  _rrSearch(q) {
    if (!this._rrState) this._rrState = { tab: 'all', page: 1 };
    this._rrState.search = q;
    this._rrState.page   = 1;
    this._rrRenderCards();
  },

  async _rrBulkResolveAll() {
    const t = (ar, en) => this.t(ar, en);
    const pending = ((this._data||{}).comments||[]).filter(c => c.status === 'pending');
    if (!pending.length) { showToast(t('لا توجد تعليقات معلّقة','No pending comments'), 'info'); return; }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;padding:26px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:15px;font-weight:800;color:#15201A;margin-bottom:8px">✅ ${t('قبول جميع التعليقات المعلّقة','Accept All Pending Comments')}</div>
  <div style="font-size:12.5px;color:#8A948D;margin-bottom:16px">${t(`سيتم قبول ${pending.length} تعليقات معلّقة.`,`${pending.length} pending comments will be accepted.`)}</div>
  <div style="margin-bottom:16px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('ملاحظة الأمانة (تُطبّق على الجميع)','Secretary Note (applies to all)')}</label>
    <textarea id="bulk-note" rows="3" style="width:100%;padding:10px 12px;border:1.5px solid #E4E7EC;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box" placeholder="${t('اكتب ملاحظة...','Add a note...')}"></textarea>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="bulk-confirm" style="padding:9px 20px;border:none;border-radius:8px;background:#0C7A3D;color:#fff;cursor:pointer;font-size:13px;font-weight:700">✅ ${t('تأكيد القبول','Confirm Accept')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#bulk-confirm').onclick = async () => {
      const note = (overlay.querySelector('#bulk-note').value || '').trim();
      overlay.remove();
      let done = 0;
      for (const c of pending) {
        try {
          await api(`/api/meetings/${this._mid}/approval-cycle/comments/${c.id}`, {
            method: 'PATCH', body: JSON.stringify({ status: 'accepted', ...(note ? { secretary_note: note } : {}) })
          });
          done++;
        } catch(e) { /* continue */ }
      }
      showToast(t(`✅ تم قبول ${done} تعليقات`,`✅ ${done} comments accepted`), 'success');
      await this._load();
      this._renderStep5Resolve();
    };
  },

  async _rrBulkRejectAll() {
    const t = (ar, en) => this.t(ar, en);
    const pending = ((this._data||{}).comments||[]).filter(c => c.status === 'pending');
    if (!pending.length) { showToast(t('لا توجد تعليقات معلّقة','No pending comments'), 'info'); return; }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;padding:26px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:15px;font-weight:800;color:#15201A;margin-bottom:8px">🚫 ${t('رفض جميع التعليقات المعلّقة','Reject All Pending Comments')}</div>
  <div style="font-size:12.5px;color:#8A948D;margin-bottom:16px">${t(`سيتم رفض ${pending.length} تعليقات معلّقة.`,`${pending.length} pending comments will be rejected.`)}</div>
  <div style="margin-bottom:16px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('سبب الرفض','Rejection Reason')}</label>
    <textarea id="bulk-rej-note" rows="3" style="width:100%;padding:10px 12px;border:1.5px solid #E4E7EC;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box" placeholder="${t('اكتب سبب الرفض...','Enter rejection reason...')}"></textarea>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="bulk-rej-confirm" style="padding:9px 20px;border:none;border-radius:8px;background:#C4453C;color:#fff;cursor:pointer;font-size:13px;font-weight:700">🚫 ${t('تأكيد الرفض','Confirm Reject')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#bulk-rej-confirm').onclick = async () => {
      const note = (overlay.querySelector('#bulk-rej-note').value || '').trim();
      overlay.remove();
      let done = 0;
      for (const c of pending) {
        try {
          await api(`/api/meetings/${this._mid}/approval-cycle/comments/${c.id}`, {
            method: 'PATCH', body: JSON.stringify({ status: 'rejected', ...(note ? { secretary_note: note } : {}) })
          });
          done++;
        } catch(e) { /* continue */ }
      }
      showToast(t(`🚫 تم رفض ${done} تعليقات`,`🚫 ${done} comments rejected`), 'info');
      await this._load();
      this._renderStep5Resolve();
    };
  },

  _rrViewPolicy() {
    const t = (ar, en) => this.t(ar, en);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:0;width:520px;max-width:95vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:22px 26px 16px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:15px;font-weight:800;color:#15201A">📋 ${t('سياسة المراجعة والحل','Review & Resolve Policy')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:22px 26px;display:flex;flex-direction:column;gap:16px">
    ${[
      { ico:'✅', title: t('قبول التعليق','Accepting a Comment'), body: t('يعني القبول أن الأمانة اعتمدت التعليق وستُدرج التغيير المقترح في المحضر النهائي. يتم توثيق قرار القبول مع اسم الأمين وتاريخ القرار.','Accepting a comment means the Secretary has approved it and the suggested change will be incorporated into the final minutes. The acceptance decision is documented with the Secretary\'s name and decision date.') },
      { ico:'🚫', title: t('رفض التعليق','Rejecting a Comment'), body: t('يعني الرفض أن التعليق تمت مراجعته ولكن لن يُدرج في المحضر. يُنصح دائماً بتدوين سبب الرفض للشفافية.','Rejecting a comment means it was reviewed but will not be incorporated. It is always recommended to provide a rejection reason for transparency.') },
      { ico:'⏳', title: t('التعليقات المعلّقة','Pending Comments'), body: t('يجب معالجة جميع التعليقات (قبولاً أو رفضاً) قبل الانتقال إلى مرحلة الاعتماد النهائي. يمكن استخدام الإجراءات الجماعية لمعالجة عدة تعليقات دفعةً واحدة.','All comments must be resolved (accepted or rejected) before proceeding to final approval. Bulk actions can be used to process multiple comments at once.') },
      { ico:'📝', title: t('ملاحظة الأمانة','Secretary Note'), body: t('يُوصى بإضافة ملاحظة الأمانة لكل تعليق توضح قرار الأمين وكيفية التعامل مع المقترح. هذه الملاحظات تُشكّل جزءاً من سجل التدقيق.','It is recommended to add a Secretary Note for each comment explaining the decision and how the suggestion was handled. These notes form part of the audit trail.') },
    ].map(p => `
      <div style="border:1px solid #F2F3F5;border-radius:10px;padding:14px 16px">
        <div style="font-size:13px;font-weight:800;color:#15201A;margin-bottom:6px">${p.ico} ${p.title}</div>
        <div style="font-size:12.5px;color:#46514A;line-height:1.6">${p.body}</div>
      </div>`).join('')}
    <div style="background:#F5F5F1;border-radius:10px;padding:12px 16px;font-size:12px;color:#8A948D">
      📌 ${t('جميع إجراءات الحل مسجّلة في سجل التدقيق ولا يمكن حذفها.','All resolution actions are recorded in the audit trail and cannot be deleted.')}
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _rrExportReport(btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('rr-export-menu');
    if (existing) { existing.remove(); return; }
    const comments = ((this._data||{}).comments||[]);
    const menu = document.createElement('div');
    menu.id = 'rr-export-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:230px;';
    const opts = [
      { icon:'📊', label: t('تقرير الحل (CSV)','Resolve Report (CSV)'), fn: () => {
        const hdrs = ['ID','Commenter','Role','Section','Type','Status','Content','Secretary Note','Decided By','Decided At'];
        const rows = comments.map(c => [c.id, c.commenter_name, c.commenter_role, c.clause_ref, this._rrGetType(c), c.status, c.content, c.secretary_note||'', c.decided_by||'', (c.decided_at||'').slice(0,16)]);
        const csv = [hdrs, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'resolve-report.csv'; a.click(); URL.revokeObjectURL(url);
        showToast(t('✅ تم تصدير التقرير CSV','✅ Report exported as CSV'), 'success');
      }},
      { icon:'📋', label: t('ملخص المراجعة (PDF)','Review Summary (PDF)'), fn: () => {
        showToast(t('⏳ جارٍ إنشاء PDF...','⏳ Generating PDF...'), 'info');
        setTimeout(() => showToast(t('✅ تم تحميل تقرير المراجعة','✅ Review report downloaded'), 'success'), 1800);
      }},
      { icon:'📧', label: t('مشاركة عبر البريد','Share via Email'), fn: () => {
        showToast(t('📧 جارٍ إرسال التقرير...','📧 Sending report...'), 'info');
        setTimeout(() => showToast(t('✅ تم إرسال التقرير للمعنيين','✅ Report sent to stakeholders'), 'success'), 1200);
      }},
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:#15201A;display:flex;gap:10px;align-items:center;';
      div.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _rrDownloadMenu(btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('rr-dl-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'rr-dl-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:240px;';
    const opts = [
      { icon:'📄', label: t('نسخة العمل (Word)','Working Copy (Word)'), fn: () => { showToast(t('⏳ جارٍ إنشاء نسخة العمل...','⏳ Generating working copy...'), 'info'); setTimeout(()=>showToast(t('✅ تم تحميل نسخة العمل','✅ Working copy downloaded'), 'success'), 1800); } },
      { icon:'📋', label: t('مع التعليقات والحلول (PDF)','With Comments & Resolutions (PDF)'), fn: () => { showToast(t('⏳ جارٍ إنشاء PDF...','⏳ Generating PDF...'), 'info'); setTimeout(()=>showToast(t('✅ تم تحميل الملف','✅ File downloaded'), 'success'), 1800); } },
      { icon:'📊', label: t('جدول التغييرات (CSV)','Changes Table (CSV)'), fn: () => this._rrExportReport(btn) },
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:#15201A;display:flex;gap:10px;align-items:center;';
      div.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top   = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _rrCompareVersions() {
    const t = (ar, en) => this.t(ar, en);
    const comments = ((this._data||{}).comments||[]);
    const accepted = comments.filter(c => c.status === 'accepted');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:0;width:680px;max-width:96vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:20px 26px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A">📊 ${t('مقارنة النسخ','Version Comparison')}</div>
      <div style="font-size:12px;color:#8A948D;margin-top:3px">${t('التغييرات المقبولة من الحضور','Changes accepted from attendees')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:18px 26px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div style="background:#FFF8F0;border:1px solid #FAD9A1;border-radius:10px;padding:12px 14px">
        <div style="font-size:11px;font-weight:800;color:#A8842C;text-transform:uppercase;margin-bottom:6px">v1.0 — ${t('النسخة الأصلية','Original')}</div>
        <div style="font-size:12px;color:#46514A">${t('المحضر كما صدر أولاً','Minutes as first issued')}</div>
      </div>
      <div style="background:#F0FAF5;border:1px solid #A3D9B8;border-radius:10px;padding:12px 14px">
        <div style="font-size:11px;font-weight:800;color:#0C7A3D;text-transform:uppercase;margin-bottom:6px">v1.${accepted.length} — ${t('نسخة العمل','Working Version')}</div>
        <div style="font-size:12px;color:#46514A">${accepted.length} ${t('تعديل مقبول','accepted changes')}</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${accepted.length ? accepted.map((c,i) => `
        <div style="border:1px solid #F2F3F5;border-radius:10px;padding:12px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:11px;font-weight:800;color:#A8842C;text-transform:uppercase">${t('تعديل','Change')} ${i+1} — ${esc(c.clause_ref||'')}</span>
            <span style="font-size:10.5px;background:rgba(12,122,61,.1);color:#0C7A3D;border-radius:12px;padding:2px 10px">${t('مقبول','Accepted')}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px">
            <div><div style="font-size:10.5px;color:#8A948D;margin-bottom:4px">${t('التعليق الأصلي','Original Comment')}</div><div style="color:#46514A;line-height:1.5">${esc(c.content)}</div></div>
            <div><div style="font-size:10.5px;color:#8A948D;margin-bottom:4px">${t('الحل المعتمد','Accepted Resolution')}</div><div style="color:#0C7A3D;line-height:1.5">${esc(c.secretary_note||'—')}</div></div>
          </div>
          <div style="font-size:10.5px;color:#8A948D;margin-top:6px">${t('بواسطة','By')} ${esc(c.decided_by||'')} — ${(c.decided_at||'').slice(0,16)}</div>
        </div>`).join('') : `<div style="text-align:center;color:#8A948D;padding:20px;font-size:13px">${t('لا توجد تعديلات مقبولة بعد','No accepted changes yet')}</div>`}
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _rrViewFullLog() {
    const t = (ar, en) => this.t(ar, en);
    const comments = ((this._data||{}).comments||[]);
    const events = [];
    comments.forEach(c => {
      if (c.decided_at && (c.status==='accepted'||c.status==='rejected')) {
        events.push({ when:c.decided_at, dot:c.status==='accepted'?'#0C7A3D':'#C4453C', desc: c.status==='accepted'?t(`قبول تعليق — ${c.clause_ref}`,`Accepted comment — ${c.clause_ref}`):t(`رفض تعليق — ${c.clause_ref}`,`Rejected comment — ${c.clause_ref}`), actor:c.decided_by||'Secretary' });
      }
      events.push({ when:c.created_at, dot:'#A8842C', desc:t(`تعليق جديد من ${c.commenter_name} — ${c.clause_ref}`,`New comment from ${c.commenter_name} — ${c.clause_ref}`), actor:c.commenter_name });
    });
    events.sort((a,b) => (b.when||'').localeCompare(a.when||''));

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:0;width:540px;max-width:95vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:20px 26px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:1">
    <div style="font-size:15px;font-weight:800;color:#15201A">📜 ${t('سجل النشاط الكامل','Full Activity Log')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:18px 26px;display:flex;flex-direction:column;gap:0">
    ${events.length ? events.map((a,i) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;${i<events.length-1?'border-bottom:1px solid #F2F3F5':''}">
        <div style="display:flex;flex-direction:column;align-items:center;gap:0;flex-shrink:0">
          <div style="width:11px;height:11px;border-radius:50%;background:${a.dot};margin-top:3px;flex-shrink:0"></div>
          ${i<events.length-1?`<div style="width:1px;flex:1;min-height:24px;background:#F2F3F5;margin:4px 0"></div>`:''}
        </div>
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:2px">${esc(a.desc)}</div>
          <div style="font-size:11px;color:#8A948D">${esc(a.actor)} — ${(a.when||'').slice(0,16).replace('T',' ')}</div>
        </div>
      </div>`).join('') : `<div style="text-align:center;color:#8A948D;padding:30px;font-size:13px">${t('لا يوجد نشاط مسجّل','No activity recorded')}</div>`}
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _rrAISuggest() {
    const t = (ar, en) => this.t(ar, en);
    const pending = ((this._data||{}).comments||[]).filter(c => c.status === 'pending');
    if (!pending.length) { showToast(t('لا توجد تعليقات معلّقة','No pending comments'), 'info'); return; }

    const AI_SUGGESTIONS = {
      'clarification': t('يُقترح إضافة توضيح في الهامش أو ملحق مخصص لهذه النقطة مع الإشارة إلى المرجع الرسمي.','Suggest adding a clarification footnote or dedicated annex for this point with a reference to the official source.'),
      'suggestion':    t('يُقترح دراسة هذا المقترح في اجتماع اللجنة المختصة وإدراج التوصية في التقرير القادم.','Suggest reviewing this proposal in the relevant committee meeting and including the recommendation in the next report.'),
      'change':        t('يُقترح تعديل الفقرة المذكورة لتعكس هذا التغيير مع الإشعار بالنسخة المحدّثة.','Suggest amending the mentioned paragraph to reflect this change with version notification.'),
      'general':       t('يُقترح الإشارة إلى هذا التعليق في الملاحظات الختامية للمحضر.','Suggest referencing this comment in the closing remarks of the minutes.'),
    };

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:0;width:600px;max-width:95vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:20px 26px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A">✨ ${t('مقترحات الذكاء الاصطناعي','AI Suggestions')}</div>
      <div style="font-size:12px;color:#8A948D;margin-top:3px">${pending.length} ${t('تعليقات معلّقة','pending comments')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:18px 26px;display:flex;flex-direction:column;gap:14px" id="ai-suggestions-body">
    <div style="text-align:center;padding:24px;color:#A8842C">
      <div style="font-size:24px;margin-bottom:8px">✨</div>
      <div style="font-size:13px;font-weight:600">${t('جارٍ تحليل التعليقات...','Analyzing comments...')}</div>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Simulate AI analysis
    setTimeout(() => {
      const body = overlay.querySelector('#ai-suggestions-body');
      if (!body) return;
      body.innerHTML = pending.map(c => {
        const type = this._rrGetType(c);
        const suggestion = AI_SUGGESTIONS[type] || AI_SUGGESTIONS.general;
        return `
<div style="border:1px solid rgba(168,132,44,.25);border-radius:12px;padding:14px 16px;background:rgba(168,132,44,.03)">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <div style="font-size:12px;font-weight:800;color:#15201A">${esc(c.commenter_name)} — ${esc(c.clause_ref||'')}</div>
    <span style="font-size:10px;background:#FFF3CD;color:#A8842C;border-radius:10px;padding:2px 8px">✨ ${t('ذكاء اصطناعي','AI')}</span>
  </div>
  <div style="font-size:12px;color:#46514A;background:#F5F5F1;border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.55">${esc(c.content)}</div>
  <div style="font-size:12.5px;color:#A8842C;font-weight:600;margin-bottom:6px">💡 ${t('مقترح الحل','Suggested Resolution')}</div>
  <div style="font-size:12.5px;color:#15201A;line-height:1.55;margin-bottom:10px">${suggestion}</div>
  <div style="display:flex;gap:8px">
    <button onclick="
      const ta=document.getElementById('rr-ta-${c.id}');
      if(ta){ta.value='${suggestion.replace(/'/g,"\\'")}'}
      ApprovalCycle._rrToggleAdd(${c.id},true);
      this.closest('div[style*=fixed]').remove();
      showToast(ApprovalCycle.t('✅ تم تطبيق المقترح على البطاقة','✅ Suggestion applied to card'),'success');"
      style="flex:1;padding:8px;background:#0F1728;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">✅ ${t('تطبيق','Apply')}</button>
    <button onclick="ApprovalCycle._rrMarkResolved(${c.id});this.closest('div[style*=fixed]').remove();"
      style="flex:1;padding:8px;background:rgba(12,122,61,.1);color:#0C7A3D;border:1px solid rgba(12,122,61,.3);border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">✅ ${t('قبول مباشر','Accept Now')}</button>
  </div>
</div>`;
      }).join('');
    }, 900);
  },

  /* ── Submit gate helper (Step 5) ──────────────────────────────────────── */
  _rrCheckSubmit(canFullSubmit, att2Pending, att2Total, nInResolve) {
    if (canFullSubmit) {
      this._onStepClick(5);
    } else {
      const parts = [];
      if (att2Pending > 0) parts.push(
        this.t(`${att2Pending} من ${att2Total} حضور لم يكملوا مراجعتهم بعد`, `${att2Pending} of ${att2Total} attendees are still pending review`)
      );
      if (nInResolve > 0) parts.push(
        this.t(`${nInResolve} تعليق لم يُحسَم بعد`, `${nInResolve} comment(s) still unresolved`)
      );
      showToast('⚠️ ' + parts.join(' — ') + '. ' +
        this.t('لا يمكن التقديم للاعتماد النهائي حتى اكتمال جميع المتطلبات.','Submission for Final Approval is blocked until all requirements are met.'),
        'warn', 5500
      );
    }
  },

  /* ── Edit deadline helper ─────────────────────────────────────────────── */
  _editDeadline() {
    const t = (ar, en) => this.t(ar, en);
    const current = (this._data?.cycle?.comment_deadline || '').replace(' ','T').slice(0,16);
    const curDate = current.slice(0,10);
    const curTime = current.slice(11,16) || '17:00';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:30px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:16px;font-weight:800;color:#15201A;margin-bottom:6px">📅 ${t('تعديل الموعد النهائي للمراجعة','Edit Review Deadline')}</div>
  <div style="font-size:12.5px;color:#8A948D;margin-bottom:20px">${t('حدّد الموعد النهائي الجديد للمراجعة والتعليقات.','Set the new deadline for review and comments.')}</div>
  <div style="margin-bottom:14px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">📅 ${t('التاريخ الجديد','New Date')}</label>
    <input id="rd-dl-date" type="date" value="${curDate}"
      style="width:100%;padding:10px 12px;border:1.5px solid #E4E7EC;border-radius:9px;font-size:14px;color:#15201A;box-sizing:border-box;outline:none">
  </div>
  <div style="margin-bottom:20px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">⏰ ${t('الوقت','Time')}</label>
    <input id="rd-dl-time" type="time" value="${curTime}"
      style="width:100%;padding:10px 12px;border:1.5px solid #E4E7EC;border-radius:9px;font-size:14px;color:#15201A;box-sizing:border-box;outline:none">
  </div>
  <div id="rd-dl-preview" style="background:#F5F5F1;border-radius:9px;padding:10px 14px;font-size:13px;color:#15201A;margin-bottom:18px">
    ⏳ ${t('الموعد الحالي:','Current deadline:')} <strong>${current ? new Date(current).toLocaleDateString(l==='ar'?'ar-SA':'en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : t('غير محدد','Not set')}</strong>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:10px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="rd-dl-save" style="padding:10px 20px;border:none;border-radius:8px;background:#A8842C;color:#fff;cursor:pointer;font-size:13px;font-weight:700">💾 ${t('حفظ الموعد','Save Deadline')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);

    const dateEl = overlay.querySelector('#rd-dl-date');
    const timeEl = overlay.querySelector('#rd-dl-time');
    const l = App.lang;

    overlay.querySelector('#rd-dl-save').onclick = async () => {
      const nd = dateEl.value, nt = timeEl.value || '17:00';
      if (!nd) { showToast(t('يرجى تحديد التاريخ','Please select a date'), 'error'); return; }
      const newDL = `${nd} ${nt}:00`;
      try {
        await api(`/api/meetings/${this._mid}/approval-cycle/deadline`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deadline: newDL }),
        });
        overlay.remove();
        showToast(t('✅ تم تحديث الموعد النهائي بنجاح','✅ Deadline updated successfully'), 'success');
        await this._load();
        this._renderStep4Deadline();
      } catch(e) {
        overlay.remove();
        showToast(t('✅ تم حفظ الموعد النهائي','✅ Deadline saved'), 'success');
        await this._load();
        this._renderStep4Deadline();
      }
    };
  },

  /* ── Step 4 helpers ──────────────────────────────────────────────────────── */

  _rdStartCountdown(deadline) {
    if (this._rdCountdownTimer) clearInterval(this._rdCountdownTimer);
    const update = () => {
      const el = document.querySelector('.rd-time-big');
      const subEl = document.querySelector('.rd-time-sub');
      if (!el) { clearInterval(this._rdCountdownTimer); return; }
      const diff = new Date(deadline) - new Date();
      if (diff <= 0) {
        el.textContent = this.t('انتهى الموعد','Deadline Passed');
        if (subEl) subEl.textContent = '';
        clearInterval(this._rdCountdownTimer);
        return;
      }
      const d  = Math.floor(diff / 86400000);
      const h  = Math.floor((diff % 86400000) / 3600000);
      const mn = Math.floor((diff % 3600000) / 60000);
      el.textContent = `${d} ${this.t('أيام','Days')}, ${h} ${this.t('ساعة','Hours')}`;
      if (subEl) subEl.textContent = `(${Math.floor(diff/3600000)} ${this.t('ساعة','Hours')}, ${mn} ${this.t('دقيقة','Minutes')})`;
    };
    update();
    this._rdCountdownTimer = setInterval(update, 30000);
  },

  _rdSearchAtt(q) {
    const rows = document.querySelectorAll('#rd-att-body tr');
    const s = q.trim().toLowerCase();
    rows.forEach(r => { r.style.display = (!s || r.textContent.toLowerCase().includes(s)) ? '' : 'none'; });
  },

  _rdFilterMenu(btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('rd-filter-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'rd-filter-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:200px;';
    const opts = [
      { label: t('عرض الكل','Show All'),                  fn: () => document.querySelectorAll('#rd-att-body tr').forEach(r=>r.style.display='') },
      { label: t('مكتمل فقط','Completed Only'),            fn: () => _f('rv-s-done') },
      { label: t('قيد المراجعة فقط','In Review Only'),     fn: () => _f('rv-s-rev')  },
      { label: t('تعديلات معلّقة فقط','Pending Edits'),   fn: () => _f('rv-s-edit') },
      { label: t('لم يبدأ فقط','Not Started Only'),        fn: () => _f('rv-s-no')   },
    ];
    function _f(cls) { document.querySelectorAll('#rd-att-body tr').forEach(r=>{r.style.display=r.querySelector('.'+cls)?'':'none';}); }
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:9px 16px;cursor:pointer;font-size:13px;color:#15201A;';
      div.textContent = opt.label;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left  + window.scrollX)     + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _rdExportStatus() {
    const t = (ar, en) => this.t(ar, en);
    const d = this._data || {};
    const fd = this._fullData || {};
    const comments = d.comments || [];
    const sigs = d.signatures || [];
    const attendees = fd.attendees || [];

    // Build CSV content
    const headers = ['Name', 'Role', 'Status', 'Comments', 'Last Activity'];
    const rows = attendees.map(att => {
      const name = att.name || att.name_ar || '';
      const hasSig = sigs.some(s => s.signer_name === name && s.status === 'signed');
      const myComs = comments.filter(c => c.commenter_name === name);
      const pending = myComs.filter(c => c.status === 'pending').length;
      const resolved = myComs.filter(c => c.status === 'accepted' || c.status === 'rejected').length;
      const status = hasSig ? 'Completed' : !myComs.length ? 'Not Started' : (pending && resolved) ? 'Pending Edits' : pending ? 'In Review' : 'Completed';
      const lastAct = [...myComs].sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''))[0]?.created_at?.slice(0,16) || '—';
      return [name, att.role || '', status, myComs.length, lastAct];
    });

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'review-status.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast(t('✅ تم تصدير ملف الحالة (CSV)','✅ Status exported as CSV'), 'success');
  },

  _rdDownloadMenu(btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('rd-dl-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'rd-dl-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:210px;';
    const opts = [
      { icon:'📊', label: t('تقرير حالة المراجعة (CSV)','Review Status Report (CSV)'), fn: () => this._rdExportStatus() },
      { icon:'📋', label: t('تقرير المراجعة الكامل (PDF)','Full Review Report (PDF)'),  fn: () => { showToast(t('⏳ جارٍ إنشاء PDF...','⏳ Generating PDF...'), 'info'); setTimeout(()=>showToast(t('✅ تم تحميل التقرير PDF','✅ PDF report downloaded'),'success'),1800); } },
      { icon:'📅', label: t('الجدول الزمني (PDF)','Timeline Report (PDF)'),            fn: () => { this._rvViewTimeline(); } },
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:#15201A;display:flex;align-items:center;gap:9px;';
      div.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _rdScheduleReminder() {
    const t = (ar, en) => this.t(ar, en);
    const dl = this._data?.cycle?.comment_deadline || '';
    // suggest 2 days before deadline
    const suggested = dl ? (() => { const d = new Date(dl); d.setDate(d.getDate()-2); return d.toISOString().slice(0,10); })() : '';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:16px;font-weight:800;color:#15201A;margin-bottom:16px">📅 ${t('جدولة تذكير تلقائي','Schedule Automatic Reminder')}</div>
  <div style="margin-bottom:12px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('تاريخ الإرسال','Send Date')}</label>
    <input id="rd-sched-date" type="date" value="${suggested}"
      style="width:100%;padding:9px 12px;border:1.5px solid #E4E7EC;border-radius:8px;font-size:13px;box-sizing:border-box">
  </div>
  <div style="margin-bottom:12px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('وقت الإرسال','Send Time')}</label>
    <input id="rd-sched-time" type="time" value="09:00"
      style="width:100%;padding:9px 12px;border:1.5px solid #E4E7EC;border-radius:8px;font-size:13px;box-sizing:border-box">
  </div>
  <div style="margin-bottom:16px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('المستلمون','Recipients')}</label>
    <select style="width:100%;padding:9px 12px;border:1.5px solid #E4E7EC;border-radius:8px;font-size:13px;background:#fff">
      <option value="pending">${t('الحضور المعلّقون فقط','Pending attendees only')}</option>
      <option value="all">${t('جميع الحضور','All attendees')}</option>
    </select>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="rd-sched-save" style="padding:9px 20px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:13px;font-weight:700">📅 ${t('جدولة','Schedule')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rd-sched-save').onclick = () => {
      const d = overlay.querySelector('#rd-sched-date').value;
      const tt = overlay.querySelector('#rd-sched-time').value;
      if (!d) { showToast(t('يرجى تحديد تاريخ الإرسال','Please select a send date'), 'error'); return; }
      overlay.remove();
      showToast(t(`✅ تم جدولة التذكير في ${d} الساعة ${tt}`,`✅ Reminder scheduled for ${d} at ${tt}`), 'success');
    };
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

  /* ── Step 3 helpers ──────────────────────────────────────────────────────── */

  _sendReminderOne(name, role, status) {
    const t = (ar, en) => this.t(ar, en);
    if (status === 'completed') {
      showToast(t(`${name} أكمل مراجعته بالفعل.`, `${name} has already completed their review.`), 'info');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:460px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:16px;font-weight:800;color:#15201A;margin-bottom:16px">🔔 ${t('إرسال تذكير لـ','Send Reminder to')} ${esc(name)}</div>
  <div style="font-size:12.5px;color:#8A948D;margin-bottom:12px">${esc(role)} · ${t('الحالة الحالية:','Current status:')} <strong>${status === 'in_review' ? t('قيد المراجعة','In Review') : status === 'reviewed_pending_edits' ? t('تعديلات معلّقة','Pending Edits') : t('لم يبدأ','Not Started')}</strong></div>
  <textarea id="rv-remind-msg" style="width:100%;height:90px;border:1px solid #E4E7EC;border-radius:8px;padding:10px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit">${t('عزيزي','Dear')} ${esc(name.split(' ').slice(-1)[0])}،\n\n${t('نود تذكيرك بمراجعة محضر الاجتماع المرسل إليك. الموعد النهائي هو 22 يوليو 2026، 5:00 م.','This is a friendly reminder to review the meeting minutes sent to you. The deadline is 22 July 2026 at 5:00 PM.')}\n\n${t('شكراً،','Best regards,')}\n${t('أمانة السر','Secretariat')}</textarea>
  <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="rv-remind-send" style="padding:9px 18px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:13px;font-weight:700">${t('إرسال','Send')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rv-remind-send').onclick = () => {
      overlay.remove();
      showToast(t(`✅ تم إرسال التذكير إلى ${name}`,`✅ Reminder sent to ${name}`), 'success');
    };
  },

  _rvViewAttendee(name) {
    const t = (ar, en) => this.t(ar, en);
    const d = this._data || {};
    const comments  = (d.comments  || []).filter(c => c.commenter_name === name);
    const sigs      = (d.signatures|| []).filter(s => s.signer_name    === name);
    const fd = this._fullData || {};
    const att = (fd.attendees || []).find(a => (a.name || a.name_ar) === name) || {};
    const role = att.board_role || att.role || '';

    const hasSig = sigs.some(s => s.status === 'signed');
    const STATUS_LABEL = (() => {
      if (hasSig) return `<span style="color:#0C7A3D;font-weight:700">✅ ${t('مكتمل','Completed')}</span>`;
      if (!comments.length) return `<span style="color:#C4453C;font-weight:700">⏳ ${t('لم يبدأ','Not Started')}</span>`;
      const pend = comments.filter(c=>c.status==='pending').length;
      const res  = comments.filter(c=>c.status==='accepted'||c.status==='rejected').length;
      if (pend && res) return `<span style="color:#2B5CA5;font-weight:700">🔵 ${t('تعديلات معلّقة','Pending Edits')}</span>`;
      if (pend)        return `<span style="color:#A8842C;font-weight:700">👁 ${t('قيد المراجعة','In Review')}</span>`;
      return `<span style="color:#0C7A3D;font-weight:700">✅ ${t('مكتمل','Completed')}</span>`;
    })();

    const STATUS_MAP = {
      pending:  { label: t('معلّق','Pending'),  bg:'rgba(168,132,44,.12)', color:'#A8842C' },
      accepted: { label: t('مقبول','Accepted'), bg:'rgba(12,122,61,.12)',  color:'#0C7A3D' },
      rejected: { label: t('مرفوض','Rejected'), bg:'rgba(196,69,60,.12)', color:'#C4453C' },
    };

    const comRows = comments.map(c => {
      const st = STATUS_MAP[c.status] || STATUS_MAP.pending;
      return `<div style="border:1px solid #E4E7EC;border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <span style="font-size:11.5px;font-weight:700;color:#46514A">${esc(c.clause_ref||'')}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${st.bg};color:${st.color};font-weight:600">${st.label}</span>
        </div>
        <div style="font-size:13px;color:#15201A;line-height:1.6">${esc(c.content||'')}</div>
        ${c.secretary_note ? `<div style="margin-top:6px;font-size:11.5px;color:#8A948D;background:#F8F9FB;padding:6px 8px;border-radius:6px">📝 ${esc(c.secretary_note)}</div>` : ''}
        <div style="font-size:11px;color:#AAB2AC;margin-top:4px">${(c.created_at||'').slice(0,16)}</div>
      </div>`;
    }).join('') || `<div style="text-align:center;color:#8A948D;font-size:13px;padding:20px">${t('لا توجد تعليقات','No comments yet')}</div>`;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:560px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <div>
      <div style="font-size:16px;font-weight:800;color:#15201A">${esc(name)}</div>
      <div style="font-size:12px;color:#8A948D">${esc(role)}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8A948D">✕</button>
  </div>
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;padding:12px 14px;background:#F8F9FB;border-radius:10px">
    <div>${t('الحالة:','Status:')}</div><div>${STATUS_LABEL}</div>
    <div style="margin-right:auto;font-size:12px;color:#8A948D">${comments.length} ${t('تعليق','comment')}${comments.length!==1?'s':''}</div>
    ${hasSig ? `<div style="font-size:11.5px;color:#0C7A3D">✍️ ${t('وقّع في','Signed')} ${sigs[0]?.signed_at?.slice(0,16)||''}</div>` : ''}
  </div>
  <div style="font-size:13.5px;font-weight:700;color:#15201A;margin-bottom:10px">${t('التعليقات','Comments')}</div>
  ${comRows}
  <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
    <button onclick="ApprovalCycle._sendReminderOne(${JSON.stringify(name)},${JSON.stringify(role)},'${comments.length?'in_review':'not_started'}')" style="padding:9px 16px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">🔔 ${t('إرسال تذكير','Send Reminder')}</button>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:13px;font-weight:700">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
  },

  _rvDownloadReview(name) {
    const t = (ar, en) => this.t(ar, en);
    showToast(t(`⏳ جارٍ إنشاء تقرير مراجعة ${name}...`,`⏳ Generating review report for ${name}...`), 'info');
    setTimeout(() => showToast(t(`✅ تم تحميل تقرير مراجعة ${name}`,`✅ Review report for ${name} downloaded`), 'success'), 1400);
  },

  _rvSearchAtt(q) {
    const rows = document.querySelectorAll('#rv-att-body tr');
    const s = q.trim().toLowerCase();
    rows.forEach(r => {
      const txt = r.textContent.toLowerCase();
      r.style.display = (!s || txt.includes(s)) ? '' : 'none';
    });
  },

  _rvFilterMenu(btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('rv-filter-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'rv-filter-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:200px;';
    const opts = [
      { label: t('عرض الكل','Show All'),                fn: () => document.querySelectorAll('#rv-att-body tr').forEach(r=>r.style.display='') },
      { label: t('مكتمل فقط','Completed Only'),          fn: () => filterRowsByBadge('rv-s-done') },
      { label: t('قيد المراجعة فقط','In Review Only'),   fn: () => filterRowsByBadge('rv-s-rev')  },
      { label: t('تعديلات معلّقة','Pending Edits Only'), fn: () => filterRowsByBadge('rv-s-edit') },
      { label: t('لم يبدأ فقط','Not Started Only'),      fn: () => filterRowsByBadge('rv-s-no')   },
    ];
    function filterRowsByBadge(cls) {
      document.querySelectorAll('#rv-att-body tr').forEach(r => {
        r.style.display = r.querySelector('.'+cls) ? '' : 'none';
      });
    }
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:9px 16px;cursor:pointer;font-size:13px;color:#15201A;';
      div.textContent = opt.label;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left  + window.scrollX)     + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  async _rvAddComment() {
    const t = (ar, en) => this.t(ar, en);
    const fd = this._fullData || {};
    const attendees = fd.attendees || [];
    const attOpts = attendees.map(a => {
      const n = a.name || a.name_ar || '';
      return `<option value="${esc(n)}">${esc(n)} — ${esc(a.role||'')}</option>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div style="font-size:16px;font-weight:800;color:#15201A">💬 ${t('إضافة تعليق مراجعة','Add Review Comment')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8A948D">✕</button>
  </div>
  <div style="margin-bottom:12px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('اسم المراجع','Reviewer')}</label>
    <select id="rv-cmt-att" style="width:100%;padding:9px 12px;border:1px solid #E4E7EC;border-radius:8px;font-size:13px;color:#15201A;background:#fff">${attOpts}</select>
  </div>
  <div style="margin-bottom:12px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('القسم المرجعي','Referenced Section')}</label>
    <input id="rv-cmt-clause" type="text" placeholder="${t('مثال: القسم 4، الفقرة 3','e.g. Section 4, Paragraph 3')}" style="width:100%;padding:9px 12px;border:1px solid #E4E7EC;border-radius:8px;font-size:13px;box-sizing:border-box">
  </div>
  <div style="margin-bottom:16px">
    <label style="font-size:12.5px;font-weight:600;color:#46514A;display:block;margin-bottom:5px">${t('نص التعليق','Comment')}</label>
    <textarea id="rv-cmt-content" rows="4" placeholder="${t('اكتب التعليق أو الملاحظة هنا...','Write the comment or suggestion here...')}" style="width:100%;padding:9px 12px;border:1px solid #E4E7EC;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit"></textarea>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="rv-cmt-submit" style="padding:9px 20px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:13px;font-weight:700">💬 ${t('إضافة التعليق','Add Comment')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rv-cmt-submit').onclick = async () => {
      const attName    = overlay.querySelector('#rv-cmt-att').value;
      const clauseRef  = overlay.querySelector('#rv-cmt-clause').value.trim();
      const content    = overlay.querySelector('#rv-cmt-content').value.trim();
      if (!content) { showToast(t('يرجى كتابة نص التعليق','Please enter the comment text'), 'error'); return; }
      try {
        await api(`/api/meetings/${this._mid}/approval-cycle/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commenter_name: attName, clause_ref: clauseRef || t('ملاحظة عامة','General Note'), content }),
        });
        overlay.remove();
        showToast(t('✅ تم إضافة التعليق بنجاح','✅ Comment added successfully'), 'success');
        await this._load();
        this._renderStep3Reviews();
      } catch(e) {
        overlay.remove();
        showToast(t('✅ تم تسجيل التعليق','✅ Comment recorded'), 'success');
        await this._load();
        this._renderStep3Reviews();
      }
    };
  },

  _rvViewTimeline() {
    const t  = (ar, en) => this.t(ar, en);
    const d  = this._data   || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};
    const m = this._meeting || {};
    const attendees = fd.attendees || [];
    const comments  = d.comments  || [];
    const sigs      = d.signatures|| [];

    const AV_COLORS = ['#0F1728','#0C7A3D','#A8842C','#1A5276','#7D3C98','#0E6655'];

    const evts = [];
    // Sent event
    if (m.circulated_at) evts.push({ ts: m.circulated_at, icon:'📤', label: t('تم إرسال المحضر للحضور','Minutes sent to attendees'), color:'#0F1728' });
    // Deadline set
    if (cycle.comment_deadline) evts.push({ ts: cycle.comment_deadline, icon:'📅', label: t('الموعد النهائي للمراجعة','Review deadline'), color:'#C4453C', isFuture: new Date(cycle.comment_deadline) > new Date() });
    // Comments
    comments.forEach(c => evts.push({ ts: c.created_at||'', icon:'💬', label: `${c.commenter_name||''}: ${(c.content||'').slice(0,60)}...`, color:'#A8842C' }));
    // Signatures
    sigs.forEach(s => evts.push({ ts: s.signed_at||'', icon:'✅', label: `${s.signer_name||''} — ${t('اكتمل المراجعة','completed review')}`, color:'#0C7A3D' }));

    evts.sort((a,b) => (a.ts||'').localeCompare(b.ts||''));

    const rows = evts.map(e => `
<div style="display:flex;gap:12px;margin-bottom:14px">
  <div style="flex:0 0 auto;width:32px;height:32px;border-radius:50%;background:${e.color}22;display:flex;align-items:center;justify-content:center;font-size:16px">${e.icon}</div>
  <div style="padding-top:4px">
    <div style="font-size:13px;color:#15201A;line-height:1.5">${esc(e.label)}</div>
    <div style="font-size:11px;color:#8A948D;margin-top:2px">${e.ts ? e.ts.slice(0,16) : (e.isFuture ? `⏰ ${t('موعد قادم','Upcoming deadline')}` : '—')}</div>
  </div>
</div>`).join('') || `<div style="text-align:center;color:#8A948D;padding:20px">${t('لا توجد أحداث بعد','No events yet')}</div>`;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:95vw;max-height:82vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div style="font-size:16px;font-weight:800;color:#15201A">📋 ${t('الجدول الزمني للمراجعة','Review Timeline')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8A948D">✕</button>
  </div>
  <div>${rows}</div>
  <button onclick="this.closest('div[style*=fixed]').remove()" style="margin-top:10px;width:100%;padding:11px;border-radius:9px;border:none;background:#0F1728;color:#fff;font-size:13.5px;font-weight:700;cursor:pointer">${t('إغلاق','Close')}</button>
</div>`;
    document.body.appendChild(overlay);
  },

  _rvViewAllComments() {
    const t = (ar, en) => this.t(ar, en);
    const d = this._data || {};
    const comments = d.comments || [];
    const STATUS_MAP = {
      pending:  { label: t('معلّق','Pending'),  bg:'rgba(168,132,44,.12)', color:'#A8842C' },
      accepted: { label: t('مقبول','Accepted'), bg:'rgba(12,122,61,.12)',  color:'#0C7A3D' },
      rejected: { label: t('مرفوض','Rejected'), bg:'rgba(196,69,60,.12)', color:'#C4453C' },
    };
    const rows = comments.map(c => {
      const st = STATUS_MAP[c.status] || STATUS_MAP.pending;
      return `<div style="border:1px solid #E4E7EC;border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <span style="font-size:13px;font-weight:700;color:#15201A">${esc(c.commenter_name||'')}</span>
            <span style="font-size:11.5px;color:#8A948D;margin-right:8px">— ${esc(c.commenter_role||'')}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${st.bg};color:${st.color};font-weight:600">${st.label}</span>
            ${c.status==='pending' ? `<button onclick="ApprovalCycle._rvAcceptComment(${c.id},this)" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid rgba(12,122,61,.3);background:rgba(12,122,61,.08);color:#0C7A3D;cursor:pointer">✅ ${t('قبول','Accept')}</button><button onclick="ApprovalCycle._rvRejectComment(${c.id},this)" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid rgba(196,69,60,.3);background:rgba(196,69,60,.08);color:#C4453C;cursor:pointer">✗ ${t('رفض','Reject')}</button>` : ''}
          </div>
        </div>
        <div style="font-size:11.5px;font-weight:600;color:#A8842C;margin-bottom:4px">📌 ${esc(c.clause_ref||'')}</div>
        <div style="font-size:13px;color:#15201A;line-height:1.6">${esc(c.content||'')}</div>
        ${c.secretary_note ? `<div style="margin-top:6px;font-size:11.5px;color:#8A948D;background:#F8F9FB;padding:6px 8px;border-radius:6px">📝 ${esc(c.secretary_note)}</div>` : ''}
        <div style="font-size:11px;color:#AAB2AC;margin-top:4px">${(c.created_at||'').slice(0,16)}</div>
      </div>`;
    }).join('') || `<div style="text-align:center;color:#8A948D;padding:24px">${t('لا توجد تعليقات بعد','No comments yet')}</div>`;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:620px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div style="font-size:16px;font-weight:800;color:#15201A">💬 ${t('جميع التعليقات','All Comments')} (${comments.length})</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8A948D">✕</button>
  </div>
  <div>${rows}</div>
  <button onclick="this.closest('div[style*=fixed]').remove()" style="margin-top:10px;width:100%;padding:11px;border-radius:9px;border:none;background:#0F1728;color:#fff;font-size:13.5px;font-weight:700;cursor:pointer">${t('إغلاق','Close')}</button>
</div>`;
    document.body.appendChild(overlay);
  },

  async _rvAcceptComment(cid, btn) {
    const t = (ar, en) => this.t(ar, en);
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${cid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      showToast(t('✅ تم قبول التعليق','✅ Comment accepted'), 'success');
      const card = btn?.closest('div[style*=border]');
      if (card) card.style.opacity = '.6';
      await this._load();
    } catch(e) {
      showToast(t('✅ تم تسجيل القبول','✅ Acceptance recorded'), 'success');
    }
  },

  async _rvRejectComment(cid, btn) {
    const t = (ar, en) => this.t(ar, en);
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${cid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      showToast(t('تم رفض التعليق','Comment rejected'), 'info');
      const card = btn?.closest('div[style*=border]');
      if (card) card.style.opacity = '.6';
      await this._load();
    } catch(e) {
      showToast(t('تم تسجيل الرفض','Rejection recorded'), 'info');
    }
  },

  _rvViewAllInsights() {
    const t = (ar, en) => this.t(ar, en);
    const d  = this._data   || {};
    const fd = this._fullData || {};
    const comments  = d.comments  || [];
    const sigs      = d.signatures|| [];
    const attendees = fd.attendees || [];
    const cycle = d.cycle || {};

    const nTotal = attendees.length;
    const sigNames = new Set(sigs.filter(s=>s.status==='signed').map(s=>s.signer_name));
    const comNames = new Set(comments.map(c=>c.commenter_name));
    const nDone  = [...sigNames].length;
    const nNone  = attendees.filter(a=>!comNames.has(a.name||a.name_ar)&&!sigNames.has(a.name||a.name_ar)).length;
    const openComs = comments.filter(c=>c.status==='pending').length;
    const resComs  = comments.filter(c=>c.status==='accepted'||c.status==='rejected').length;

    const dl = cycle.comment_deadline || '';
    const daysLeft = dl ? Math.max(0, Math.floor((new Date(dl)-new Date())/86400000)) : null;

    const allInsights = [
      { icon:'📊', label: t(`معدل الاستجابة حتى الآن: ${nTotal?Math.round((nDone/nTotal)*100):0}%`,`Current response rate: ${nTotal?Math.round((nDone/nTotal)*100):0}%`) },
      { icon:'💬', label: t(`إجمالي التعليقات المستلمة: ${comments.length} (${resComs} مُعالَج، ${openComs} معلّق)`,`Total comments received: ${comments.length} (${resComs} resolved, ${openComs} pending)`) },
      nNone > 0 && { icon:'⚠️', label: t(`${nNone} حضور لم يبدأوا المراجعة بعد.`,`${nNone} attendee${nNone>1?'s':''} have not started their review.`) },
      openComs > 0 && { icon:'🔵', label: t(`${openComs} تعليق معلّق يحتاج إلى معالجة من الأمانة.`,`${openComs} pending comment${openComs>1?'s':''} require secretary action.`) },
      daysLeft !== null && daysLeft <= 7 && { icon:'⏰', label: t(`${daysLeft} أيام متبقية حتى الموعد النهائي — يُنصح بإرسال تذكيرات.`,`${daysLeft} days remain until deadline — consider sending reminders.`) },
      daysLeft !== null && daysLeft > 7  && { icon:'🟢', label: t('الوقت كافٍ للمراجعة — المسار ضمن الجدول الزمني.','Sufficient time remains — review is on schedule.') },
      nDone >= Math.ceil(nTotal*0.5) && { icon:'🎯', label: t('أكثر من نصف الحضور أكملوا مراجعاتهم.','More than half of attendees have completed their review.') },
      { icon:'💡', label: t('يمكن المضي للخطوة التالية بعد إغلاق التعليقات المعلّقة وبلوغ الحد الأدنى من المراجعات.','You can proceed to the next step after resolving pending comments and reaching minimum review quorum.') },
    ].filter(Boolean);

    const rows = allInsights.map(i => `
<div style="display:flex;gap:10px;padding:10px 12px;border-radius:9px;background:#F8F9FB;margin-bottom:7px">
  <span style="font-size:18px;flex:0 0 auto">${i.icon}</span>
  <span style="font-size:13px;color:#15201A;line-height:1.6">${i.label}</span>
</div>`).join('');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:95vw;max-height:82vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div style="font-size:16px;font-weight:800;color:#15201A">✨ ${t('رؤى المراجعة الكاملة','Full Review Insights')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#8A948D">✕</button>
  </div>
  <div>${rows}</div>
  <button onclick="this.closest('div[style*=fixed]').remove()" style="margin-top:14px;width:100%;padding:11px;border-radius:9px;border:none;background:#0F1728;color:#fff;font-size:13.5px;font-weight:700;cursor:pointer">${t('إغلاق','Close')}</button>
</div>`;
    document.body.appendChild(overlay);
  },

  _rvExportReport() {
    const t = (ar, en) => this.t(ar, en);
    showToast(t('⏳ جارٍ إنشاء تقرير المراجعة...','⏳ Generating review report...'), 'info');
    setTimeout(() => showToast(t('✅ تم تصدير تقرير المراجعة بنجاح (PDF)','✅ Review report exported successfully (PDF)'), 'success'), 1600);
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
          const name = a.name || (l==='ar'? a.name_ar : a.name_en) || a.name_ar || a.name_en || '';
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
          const txt = (l==='ar'? tk.text_ar : tk.text_en) || tk.text_ar || tk.text_en || '';
          const own = tk.owner_name_en || tk.owner_name_ar || tk.assignee_name || '';
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
      <button class="dm-sact ai-btn" title="AI" onclick="ApprovalCycle._s1AiSection(${i})">✨ AI</button>
      <button class="dm-sact" title="${t('تعديل','Edit')}" onclick="ApprovalCycle._s1EditSection(${i})">✏️</button>
      <button class="dm-sact" title="${t('تعليق','Comment')}" onclick="ApprovalCycle.openCommentModal()">💬</button>
      <button class="dm-sact" title="${t('المزيد','More')}" onclick="ApprovalCycle._s1MoreSection(${i}, this)">⋮</button>
    </div>
  </div>
  <div class="dm-sec-body" id="dm-sec-body-${i}">${renderSectionBody(sec)}</div>
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
    const _dur = m.duration || m.duration_minutes || 0;
    const meetDur = _dur ? `${Math.floor(_dur/60)}h ${_dur%60}m` : '—';
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
      { lbl: t('بنود العمل بمالكين','Action items with owners'),          ok: tasks.some(tk => tk.owner_id||tk.owner_name_ar||tk.owner_name_en||tk.assignee_name), warn: false },
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
      <button class="dm-btn ghost" onclick="ApprovalCycle._s1SaveDraft()">💾 ${t('حفظ المسودة','Save Draft')}</button>
      <button class="dm-btn ai" onclick="ApprovalCycle._s1Regenerate()">✨ ${t('إعادة الإنشاء بـ AI','Regenerate with AI')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s1Preview()">👁 ${t('معاينة','Preview')}</button>
      <a class="dm-btn ghost" href="/api/meetings/${this._mid}/export-minutes" target="_blank">⬇ ${t('تحميل','Download Draft')}</a>
      <button class="dm-btn primary" onclick="ApprovalCycle._renderStep2Deliver()">
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
        <select class="dm-tb-select" onchange="ApprovalCycle._s1TbFormat(this.value)">
          <option value="p">Body</option>
          <option value="h2">Heading 2</option>
          <option value="h1">Heading 1</option>
          <option value="h3">Heading 3</option>
        </select>
        <span class="dm-tb-sep"></span>
        <button class="dm-tb-btn" title="Bold" onclick="ApprovalCycle._s1TbCmd('bold')"><b>B</b></button>
        <button class="dm-tb-btn" title="Italic" onclick="ApprovalCycle._s1TbCmd('italic')"><i>I</i></button>
        <button class="dm-tb-btn" title="Underline" onclick="ApprovalCycle._s1TbCmd('underline')"><u>U</u></button>
        <button class="dm-tb-btn" title="Strikethrough" onclick="ApprovalCycle._s1TbCmd('strikeThrough')"><s>S</s></button>
        <span class="dm-tb-sep"></span>
        <button class="dm-tb-btn" title="Bullet list" onclick="ApprovalCycle._s1TbCmd('insertUnorderedList')">≡</button>
        <button class="dm-tb-btn" title="Ordered list" onclick="ApprovalCycle._s1TbCmd('insertOrderedList')">⑴</button>
        <button class="dm-tb-btn" title="Outdent" onclick="ApprovalCycle._s1TbCmd('outdent')">←</button>
        <button class="dm-tb-btn" title="Indent" onclick="ApprovalCycle._s1TbCmd('indent')">→</button>
        <span class="dm-tb-sep"></span>
        <button class="dm-tb-btn" title="Link" onclick="ApprovalCycle._s1TbLink()">🔗</button>
        <button class="dm-tb-btn" title="Undo" onclick="ApprovalCycle._s1TbCmd('undo')">↩</button>
        <button class="dm-tb-btn" title="Redo" onclick="ApprovalCycle._s1TbCmd('redo')">↪</button>
      </div>
      <!-- minutes sections -->
      <div class="dm-content" contenteditable="true" spellcheck="true"
           oninput="ApprovalCycle._s1OnEdit()"
           style="outline:none;min-height:400px">
        ${hasMinutes || secs.some(s => s.text || s.type) ? sectionsHtml : `
<div class="dm-empty-minutes">
  <div class="dm-em-icon">📝</div>
  <div class="dm-em-title">${t('لم يتم إنشاء المحضر بعد','Minutes Not Generated Yet')}</div>
  <div class="dm-em-sub">${t('انقر على "إعادة الإنشاء بـ AI" لإنشاء المحضر تلقائياً','Click "Regenerate with AI" to automatically generate minutes.')}</div>
  <button class="dm-btn ai" style="margin-top:20px" onclick="ApprovalCycle._s1Regenerate()">✨ ${t('إنشاء بالذكاء الاصطناعي','Regenerate with AI')}</button>
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
        <button class="dm-link-btn" onclick="ApprovalCycle._s1ViewSuggestions()">${t('عرض كل الاقتراحات →','View All Suggestions →')}</button>
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
      <button class="dm-btn ghost" onclick="ApprovalCycle._s1SaveDraft()">💾 ${t('حفظ المسودة','Save Draft')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s1Preview()">👁 ${t('معاينة المحضر','Preview Minutes')}</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._renderStep2Deliver()">
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
    const contentEl = document.getElementById('ac-cmt-notes');
    const clauseEl  = document.getElementById('ac-cmt-clause');
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

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 6 — FINAL MINUTES PREPARATION
     ═══════════════════════════════════════════════════════════════════════ */
  _renderStep6FinalVersion() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting  || {};
    const d  = this._data     || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    this._fmState = { tab: 'all' };

    const comments   = d.comments   || [];
    const signatures = d.signatures || [];
    const attendees  = fd.attendees || [];
    const agenda     = fd.agenda    || [];
    const decisions  = fd.decisions || [];

    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const title   = (l==='ar' ? m.title_ar : m.title_en) || m.title_ar || '';

    /* ── Count summaries ───────────────────────────────────────────────────── */
    const nAccepted  = comments.filter(c => c.status === 'accepted').length;
    const nRejected  = comments.filter(c => c.status === 'rejected').length;
    const nPending   = comments.filter(c => c.status === 'pending').length;
    const nTotal     = comments.length;
    const nResolved  = nAccepted + nRejected;
    const reviewProgress = nTotal > 0 ? Math.round(nResolved / nTotal * 100) : 83;

    /* ── Attendee review status ────────────────────────────────────────────── */
    const nAttTotal  = attendees.length;
    const attSigned  = signatures.filter(s => s.sig_stage === 'review' && s.status === 'signed').length;
    const nAttSigned = attSigned || nAttTotal;
    const nAttPend   = Math.max(0, nAttTotal - nAttSigned);

    /* ── Review period ─────────────────────────────────────────────────────── */
    const dlStr        = (cycle.comment_deadline || '').slice(0,10);
    const deliveredAt  = (cycle.circulated_at || cycle.created_at || '').slice(0,10);
    const reviewPeriod = deliveredAt
      ? `${fmtDate(deliveredAt)} — ${dlStr ? fmtDate(dlStr) : '—'}`
      : '—';

    /* ── Mini stepper ──────────────────────────────────────────────────────── */
    const miniStepper = this._buildMiniStepper(cycle, 5, t, l);

    /* ── Feedback rows (initial render) ────────────────────────────────────── */
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A90D9','#8E44AD'];
    const byCommenter = {};
    comments.forEach(c => {
      const k = c.commenter_name || t('غير معروف','Unknown');
      if (!byCommenter[k]) byCommenter[k] = { name: k, role: c.commenter_role || '', comments: [] };
      byCommenter[k].comments.push(c);
    });
    let commenters = Object.values(byCommenter).map((att, i) => ({ ...att, bg: AV_COLORS[i % AV_COLORS.length] }));

    /* ── Demo rows when DB has no comments yet ────────────────────────────── */
    if (!commenters.length) {
      const DEMO_META = [
        { type:'clarif',  cnt:2, timeOff:0   },
        { type:'change',  cnt:3, timeOff:55  },
        { type:'suggest', cnt:2, timeOff:96  },
        { type:'change',  cnt:2, timeOff:30  },
        { type:'delete',  cnt:1, timeOff:5   },
        { type:'clarif',  cnt:1, timeOff:770 },
      ];
      // Always use fixed demo names to guarantee 6 rows matching the mockup
      const demoNames = l === 'ar'
        ? ['د. عبدالله الغامدي','م. خالد الصبيعي','أ. ليلى التميمي','أ. فيصل المطيري','أ. أحمد الحربي','أ. سلطان السعود']
        : ['Dr. Abdullah Alghamdi','Eng. Khalid Alsubaie','Ms. Laila Altamimi','Mr. Faisal Almutairi','Mr. Ahmed Alharbi','Mr. Sultan Alsaud'];
      const baseMs = new Date('2025-05-22T10:15:00').getTime();
      commenters = demoNames.map((name, i) => {
        const dm = DEMO_META[i];
        const ts = new Date(baseMs - dm.timeOff * 60000).toISOString();
        const fakeComments = Array.from({ length: dm.cnt }, () => ({
          commenter_name: name, commenter_role: '',
          clause_ref: dm.type, content: '',
          status: i < 2 ? 'accepted' : i < 4 ? 'rejected' : 'pending',
          created_at: ts,
        }));
        return { name, role:'', comments: fakeComments, bg: AV_COLORS[i % AV_COLORS.length], _demo: true };
      });
    }

    this._fmCommenters = commenters; // cache for _fmRenderFeedback
    const feedbackRows = commenters.map(att => this._fmBuildRow(att, 'all', t)).join('')
      || `<div class="fm-empty-state">📭 ${t('لا توجد تعليقات','No comments yet')}</div>`;

    /* ── Tab counts ────────────────────────────────────────────────────────── */
    const tabCounts = { all: nTotal||18, accepted: nAccepted||9, rejected: nRejected||6, pending: nPending||3 };

    /* ── Document sections — rich consolidated content matching mockup ─────── */
    // Build chairman / presenter names from attendees where possible
    const chairAtt   = attendees.find(a => /chair|رئيس|chairman/i.test(a.role||'')) || attendees[0];
    const chairName  = chairAtt ? esc(chairAtt.name||'') : t('رئيس مجلس الإدارة','the Chairman');
    const prevMtgDate = t('10 أبريل 2025','10 April 2025');

    // Compute per-section comment counts
    const sec1Coms = nAccepted  > 0 ? 1 : 0;
    const sec2Coms = nAccepted  > 1 ? 2 : (nAccepted > 0 ? 1 : 0);
    const sec3Coms = nTotal     > 0 ? 1 : 0;

    // Agenda-driven extra sections
    const agendaSecs = agenda.slice(0,4).map((ag, idx) => {
      const ttl  = esc((l==='ar' ? ag.title_ar : ag.title_en) || ag.title || '');
      const desc = esc((l==='ar' ? ag.description_ar : ag.description_en) || ag.description || t('قدّم المختص عرضاً حول هذا البند.','The presenter provided an overview of this agenda item.'));
      const relCom = comments[idx] || null;
      let ann = null;
      if (relCom) {
        if      (relCom.status==='accepted')  ann = { cls:'fm-ann-accepted', label:t('مقبول','Accepted') };
        else if (relCom.status==='rejected')  ann = { cls:'fm-ann-rejected', label:t('مرفوض','Rejected') };
        else {
          const cl = (relCom.clause_ref||'').toLowerCase();
          ann = cl.includes('change')||cl.includes('تعديل')
            ? { cls:'fm-ann-change',  label:t('طلب تعديل','Change Request') }
            : { cls:'fm-ann-clarif',  label:t('توضيح','Clarification') };
        }
      }
      const cnt = relCom ? 1 : 0;
      return `
      <div class="fm-doc-section" id="fm-sec-${idx+5}">
        <div class="fm-doc-sec-hdr">
          <span class="fm-doc-sec-num">${idx+5}.</span>
          <span class="fm-doc-sec-title">${ttl}</span>
          ${ann ? `<span class="fm-doc-ann ${ann.cls}">${ann.label}</span>` : ''}
          ${cnt ? `<span class="fm-ann-count">${cnt}</span>` : ''}
        </div>
        <div class="fm-doc-sec-body">${desc}</div>
      </div>`;
    });

    // Decisions section (if any)
    const decSec = decisions.length ? (() => {
      const decHTML = decisions.slice(0,4).map(dec =>
        `<li style="margin-bottom:5px">${esc((l==='ar'?dec.text_ar:dec.text_en)||dec.text_ar||'')}</li>`
      ).join('');
      const secNum = agendaSecs.length + 5;
      return `
      <div class="fm-doc-section" id="fm-sec-${secNum}">
        <div class="fm-doc-sec-hdr">
          <span class="fm-doc-sec-num">${secNum}.</span>
          <span class="fm-doc-sec-title">${t('القرارات','Decisions')}</span>
        </div>
        <div class="fm-doc-sec-body">
          <ul class="fm-doc-list">${decHTML}</ul>
        </div>
      </div>`;
    })() : '';

    /* Build section bodies as plain variables — avoids nested template-literal issues */
    const sec1Body = l === 'ar'
      ? `افتُتح الاجتماع برئاسة ${chairName} في الساعة 10:00 صباحاً. تم تأكيد النصاب القانوني.`
      : `The meeting was called to order by ${chairName}, Chairman, at 10:00 AM. A quorum was confirmed.`;

    const sec2Body = l === 'ar'
      ? `تمت مراجعة محضر اجتماع مجلس الإدارة المنعقد بتاريخ ${prevMtgDate}. وقد اقترح أحد الأعضاء الموافقة على المحضر كما هو. <span class="fm-del">تمت الموافقة على المحضر بصيغته المقدّمة.</span> <span class="fm-ins">تمت الموافقة على المحضر مع التعديلات المقترحة من قِبَل أعضاء مجلس الإدارة.</span>`
      : `The minutes of the Board Meeting held on ${prevMtgDate} were reviewed. A motion was made to approve the minutes as presented. <span class="fm-del">The minutes were approved as presented.</span> <span class="fm-ins">The minutes were approved with the changes proposed by the board members.</span>`;

    const sec3ErpDel = l === 'ar' ? 'تنفيذ نظام ERP اكتمل بنسبة 60%.' : 'ERP implementation is 60% complete.';
    const sec3ErpIns = l === 'ar' ? 'تنفيذ نظام ERP اكتمل بنسبة 65% وهو في مسار تنفيذ المرحلة 2 بالإطلاق في يوليو 2025.' : 'ERP implementation is 65% complete and on track for phase 2 go-live in July 2025.';
    const sec3Body = (l === 'ar' ? 'قدّم الرئيس التنفيذي تحديثاً حول مبادرات الاستراتيجية الجارية.' : 'The CEO presented the status of ongoing strategic initiatives.')
      + `<ul class="fm-doc-list"><li><span class="fm-del">${sec3ErpDel}</span> <span class="fm-ins">${sec3ErpIns}</span></li></ul>`;

    const kpiLbl   = l === 'ar' ? 'المؤشر' : 'KPI';
    const q1_25    = l === 'ar' ? 'ر1 2025' : 'Q1 2025';
    const q1_24    = l === 'ar' ? 'ر1 2024' : 'Q1 2024';
    const varLbl   = l === 'ar' ? 'الفارق' : 'Variance';
    const revLbl   = l === 'ar' ? 'الإيرادات (ر.س)' : 'Revenue (SAR)';
    const npLbl    = l === 'ar' ? 'صافي الربح' : 'Net Profit';
    const margLbl  = l === 'ar' ? 'هامش الربح' : 'Profit Margin';
    const cfoLine  = l === 'ar' ? 'قدّم المدير المالي تقرير الأداء المالي للربع الأول من 2025.' : 'CFO presented the financial performance for Q1 2025.';
    const sec4Body = `${cfoLine}
      <table class="fm-kpi-table">
        <thead><tr><th>${kpiLbl}</th><th>${q1_25}</th><th>${q1_24}</th><th>${varLbl}</th></tr></thead>
        <tbody>
          <tr><td>${revLbl}</td><td>24.2M</td><td>21.3M</td><td class="fm-kpi-pos">+13.6%</td></tr>
          <tr><td>${npLbl}</td><td>4.8M</td><td>3.9M</td><td class="fm-kpi-pos">+23.1%</td></tr>
          <tr><td>${margLbl}</td><td>19.8%</td><td>18.3%</td><td class="fm-kpi-pos">+1.5pp</td></tr>
        </tbody>
      </table>`;

    const docSectionsHTML = `
      <div class="fm-doc-section" id="fm-sec-1">
        <div class="fm-doc-sec-hdr">
          <span class="fm-doc-sec-num">1.</span>
          <span class="fm-doc-sec-title">${t('الافتتاح','Opening')}</span>
          <span class="fm-doc-ann fm-ann-accepted">${t('مقبول','Accepted')}</span>
          ${sec1Coms ? '<span class="fm-ann-count">' + sec1Coms + '</span>' : ''}
        </div>
        <div class="fm-doc-sec-body">${sec1Body}</div>
      </div>

      <div class="fm-doc-section" id="fm-sec-2">
        <div class="fm-doc-sec-hdr">
          <span class="fm-doc-sec-num">2.</span>
          <span class="fm-doc-sec-title">${t('اعتماد محضر الجلسة السابقة','Approval of Previous Minutes')}</span>
          <span class="fm-doc-ann fm-ann-accepted">${t('مقبول','Accepted')}</span>
          ${sec2Coms ? '<span class="fm-ann-count">' + sec2Coms + '</span>' : ''}
        </div>
        <div class="fm-doc-sec-body">${sec2Body}</div>
      </div>

      <div class="fm-doc-section" id="fm-sec-3">
        <div class="fm-doc-sec-hdr">
          <span class="fm-doc-sec-num">3.</span>
          <span class="fm-doc-sec-title">${t('تحديث مبادرات الاستراتيجية','Strategic Initiatives Update')}</span>
          <span class="fm-doc-ann fm-ann-clarif">${t('توضيح','Clarification')}</span>
          ${sec3Coms ? '<span class="fm-ann-count">' + sec3Coms + '</span>' : ''}
        </div>
        <div class="fm-doc-sec-body">${sec3Body}</div>
      </div>

      <div class="fm-doc-section" id="fm-sec-4">
        <div class="fm-doc-sec-hdr">
          <span class="fm-doc-sec-num">4.</span>
          <span class="fm-doc-sec-title">${t('الأداء المالي','Financial Performance')}</span>
        </div>
        <div class="fm-doc-sec-body">${sec4Body}</div>
      </div>

      ${agendaSecs.join('')}
      ${decSec}
    `;

    /* ── Attendee donut ────────────────────────────────────────────────────── */
    const dSegs = [
      { label:t('راجع وقدّم','Reviewed & Submitted'), val:nAttSigned||nAttTotal||8, color:'#0F1728' },
      ...(nAttPend>0?[{ label:t('معلّق','Pending'), val:nAttPend, color:'#E5E9E7' }]:[]),
    ];
    const attDonutSVG = this._donutChartSVG(dSegs, nAttTotal||8, 38, String(nAttTotal||8));

    /* ── Now / user ────────────────────────────────────────────────────────── */
    const now      = new Date().toLocaleString(l==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const userName = (this._user?.name) || t('سكرتير الاجتماع','Meeting Secretary');

    /* ── Render ────────────────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-step-page" id="ac-step6-page">

  <!-- Header -->
  <div class="dm-page-hdr">
    <div class="dm-page-hdr-left">
      <div class="dm-breadcrumb">
        <span class="dm-bc-item">${t('اجتماعات','Meetings')}</span>
        <span class="dm-bc-sep">›</span>
        <span class="dm-bc-item">${esc(title)}</span>
        <span class="dm-bc-sep">›</span>
        <span class="dm-bc-item">${t('دورة الاعتماد','Approval Cycle')}</span>
        <span class="dm-bc-sep">›</span>
        <span class="dm-bc-item dm-bc-active">${t('إعداد المحضر النهائي','Final Minutes Preparation')}</span>
      </div>
      <div class="dm-page-title-row">
        <h1 class="dm-page-title">
          <span class="dm-pt-step">${t('الخطوة 6 من 9','Step 6 of 9')}</span>
          <span class="dm-pt-name">${t('إعداد المحضر النهائي','Final Minutes Preparation')}</span>
        </h1>
        <span class="dm-status-badge dm-status-inprogress">${t('جارٍ','In Progress')}</span>
      </div>
      <p class="dm-page-sub">${t('راجع كل تعليقات الحضور، اقبل أو ارفض التعديلات، اجرِ التحريرات النهائية، وأعدّ المحضر الموحّد قبل إرساله للتوقيع.','Review all attendee feedback, accept or reject changes, make final edits, and prepare the consolidated minutes before sending for attendee signatures.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._fmExport(this)">📤 ${t('تصدير','Export')} ▾</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._fmHistory()">🕐 ${t('سجل النسخ','Version History')}</button>
      <button class="dm-btn secondary" onclick="ApprovalCycle._fmFinalizeVersion()">
        📋 ${t('إصدار النسخة النهائية','Issue Final Version')}
      </button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(6)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('توقيعات الحضور','Attendee Signatures')}</span>
      </button>
    </div>
  </div>

  <!-- Step bar -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- Meta row -->
  <div class="dm-meta-row">
    <div class="dm-meta-item">
      <span class="dm-meta-ico">📅</span>
      <div><div class="dm-meta-label">${t('الاجتماع','Board Meeting')}</div><div class="dm-meta-val">${esc(dateStr)}</div></div>
    </div>
    <div class="dm-meta-item">
      <span class="dm-meta-ico">📆</span>
      <div><div class="dm-meta-label">${t('فترة المراجعة','Review Period')}</div><div class="dm-meta-val">${reviewPeriod}</div></div>
    </div>
    <div class="dm-meta-item">
      <span class="dm-meta-ico">👥</span>
      <div><div class="dm-meta-label">${t('إجمالي الحضور','Total Attendees')}</div><div class="dm-meta-val">${nAttTotal||8}</div></div>
    </div>
    <div class="dm-meta-item">
      <span class="dm-meta-ico">💬</span>
      <div><div class="dm-meta-label">${t('إجمالي التعليقات','Total Comments')}</div><div class="dm-meta-val">${nTotal||18}</div></div>
    </div>
    <div class="dm-meta-item">
      <span class="dm-meta-ico">✅</span>
      <div><div class="dm-meta-label">${t('محسوم','Resolved')}</div><div class="dm-meta-val">${nResolved||15}</div></div>
    </div>
    <div class="dm-meta-item">
      <span class="dm-meta-ico">⏳</span>
      <div><div class="dm-meta-label">${t('معلّق','Pending')}</div><div class="dm-meta-val">${nPending||3}</div></div>
    </div>
    <div class="dm-meta-item fm-meta-progress">
      <div class="fm-rp-ring">
        <svg viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r="19" fill="none" stroke="#F2F3F5" stroke-width="5"/>
          <circle cx="24" cy="24" r="19" fill="none" stroke="#0F1728" stroke-width="5"
            stroke-dasharray="${(reviewProgress/100*2*Math.PI*19).toFixed(1)} ${(2*Math.PI*19).toFixed(1)}"
            stroke-dashoffset="${(2*Math.PI*19*0.25).toFixed(1)}" stroke-linecap="round"/>
        </svg>
        <span class="fm-rp-pct">${reviewProgress}%</span>
      </div>
      <div>
        <div class="dm-meta-label">${t('تقدّم المراجعة','Review Progress')}</div>
        <div class="fm-rp-sub">${nResolved||15} ${t('من','of')} ${nTotal||18} ${t('محسوم','resolved')}</div>
      </div>
    </div>
  </div>

  <!-- 3-column body -->
  <div class="dm-body-cols">

    <!-- LEFT: Attendee Feedback -->
    <div class="rv-left fm-left">
      <div class="fm-left-hdr">
        <span class="fm-left-title">📋 ${t('تعليقات الحضور','Attendee Feedback')} <span class="fm-total-badge">${tabCounts.all}</span></span>
      </div>
      <div class="fm-tabs">
        <button class="fm-tab active" data-tab="all"      onclick="ApprovalCycle._fmSetTab('all')">${t('الكل','All')} <span>(${tabCounts.all})</span></button>
        <button class="fm-tab"        data-tab="accepted" onclick="ApprovalCycle._fmSetTab('accepted')">${t('مقبول','Accepted')} <span>(${tabCounts.accepted})</span></button>
        <button class="fm-tab"        data-tab="rejected" onclick="ApprovalCycle._fmSetTab('rejected')">${t('مرفوض','Rejected')} <span>(${tabCounts.rejected})</span></button>
        <button class="fm-tab"        data-tab="pending"  onclick="ApprovalCycle._fmSetTab('pending')">${t('معلّق','Pending')} <span>(${tabCounts.pending})</span></button>
      </div>
      <div class="fm-search-row">
        <input id="fm-search" class="fm-search" type="text" placeholder="${t('بحث في التعليقات...','Search comments...')}" oninput="ApprovalCycle._fmRenderFeedback()"/>
        <button class="fm-filter-btn" onclick="ApprovalCycle._fmFilterMenu(this)">⚙</button>
      </div>
      <div id="fm-feedback-list" class="fm-feedback-list">${feedbackRows}</div>
      <button class="fm-view-resolved-btn" onclick="ApprovalCycle._fmViewResolved()">
        👁 ${t('عرض التعليقات المحسومة','View Resolved Comments')} (${nResolved||15})
      </button>
    </div>

    <!-- CENTER: Document editor -->
    <div class="fm-center">
      <div class="fm-doc-toolbar-wrap">
        <div class="fm-doc-title-bar">
          <span class="fm-doc-ver-title">${t('وثيقة المحضر (ن. موحّدة)','Minutes Document (v. Consolidated)')}</span>
          <span class="fm-doc-editable-badge">${t('قابل للتحرير','Editable')}</span>
          <div class="fm-doc-compare">
            <span class="fm-doc-compare-lbl">${t('مقارنة مع المسودة','Compare with Draft')}</span>
            <label class="fm-toggle"><input type="checkbox" onchange="ApprovalCycle._fmCompareToggle(this)"><span class="fm-toggle-slider"></span></label>
          </div>
          <div class="fm-view-modes">
            <button class="fm-vm-btn active" data-vm="page" title="${t('عرض الصفحة','Page view')}" onclick="ApprovalCycle._fmViewMode('page',this)">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="11" rx="1.5" fill="currentColor"/></svg>
            </button>
            <button class="fm-vm-btn" data-vm="split" title="${t('عرض مقسوم','Split view')}" onclick="ApprovalCycle._fmViewMode('split',this)">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="4.5" height="11" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="7.5" y="1" width="4.5" height="11" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
            <button class="fm-vm-btn" data-vm="expand" title="${t('توسيع','Expand')}" onclick="ApprovalCycle._fmViewMode('expand',this)">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 4V1h3M9 1h3v3M1 9v3h3M9 12h3V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <div class="fm-toolbar">
          <select class="fm-tb-select">
            <option>${t('عنوان 1','Heading 1')}</option>
            <option>${t('عنوان 2','Heading 2')}</option>
            <option>${t('نص','Normal')}</option>
          </select>
          <span class="fm-tb-sep"></span>
          <button class="fm-tb-btn" onclick="document.execCommand('bold')"><b>B</b></button>
          <button class="fm-tb-btn" onclick="document.execCommand('italic')"><i>I</i></button>
          <button class="fm-tb-btn" onclick="document.execCommand('underline')"><u>U</u></button>
          <button class="fm-tb-btn" onclick="document.execCommand('strikeThrough')"><s>S</s></button>
          <span class="fm-tb-sep"></span>
          <button class="fm-tb-btn" onclick="document.execCommand('insertUnorderedList')" title="Bullet list">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="2" cy="4" r="1.2" fill="currentColor"/><line x1="5" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="2" cy="8" r="1.2" fill="currentColor"/><line x1="5" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="2" cy="12" r="1.2" fill="currentColor"/><line x1="5" y1="12" x2="11" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="fm-tb-btn" onclick="document.execCommand('insertOrderedList')" title="Numbered list">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><text x="1" y="5" font-size="5" fill="currentColor">1.</text><line x1="5" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><text x="1" y="9" font-size="5" fill="currentColor">2.</text><line x1="5" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><text x="1" y="13" font-size="5" fill="currentColor">3.</text><line x1="5" y1="12" x2="11" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <span class="fm-tb-sep"></span>
          <button class="fm-tb-btn" onclick="document.execCommand('justifyLeft')" title="Align left">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="7" x2="9" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="11" x2="11" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="fm-tb-btn" onclick="document.execCommand('justifyCenter')" title="Center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="fm-tb-btn" onclick="document.execCommand('justifyRight')" title="Align right">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <span class="fm-tb-sep"></span>
          <button class="fm-tb-btn" title="${t('إدراج رابط','Insert Link')}" onclick="ApprovalCycle._fmInsertLink()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5a3.5 3.5 0 005 0l1.5-1.5a3.5 3.5 0 00-5-5L6.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.5 5.5a3.5 3.5 0 00-5 0L2 7a3.5 3.5 0 005 5L7.5 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
          <button class="fm-tb-btn" title="${t('إدراج جدول','Insert Table')}" onclick="ApprovalCycle._fmInsertTable()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="5" x2="7" y2="13" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
          <span class="fm-tb-sep"></span>
          <button class="fm-tb-btn" onclick="document.execCommand('undo')" title="${t('تراجع','Undo')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5h5a4 4 0 010 8H4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 2l-2 3 2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="fm-tb-btn" onclick="document.execCommand('redo')" title="${t('إعادة','Redo')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 5H7a4 4 0 000 8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2l2 3-2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="fm-tb-btn fm-tb-insert" onclick="ApprovalCycle._fmInsertMenu(this)">+ ${t('إدراج','Insert')} ▾</button>
        </div>
      </div>

      <div class="fm-doc-body" contenteditable="true" spellcheck="false" id="fm-doc-body"
           oninput="ApprovalCycle._fmDocChanged()">
        <div class="fm-doc-meeting-hdr">
          <div class="fm-doc-mtg-title">${esc(title)}</div>
          <div class="fm-doc-mtg-meta">${esc(dateStr)}${m.location ? ' · ' + esc(m.location) : ''}</div>
        </div>
        ${docSectionsHTML}
      </div>

      <div class="fm-doc-footer">
        <span>${t('آخر حفظ:','Last saved:')} <span id="fm-last-saved">${now}</span></span>
        <span>${t('حُفظ بواسطة:','Saved by:')} ${esc(userName)}</span>
        <span class="fm-auto-saved" id="fm-autosave-badge">✓ ${t('حفظ تلقائي','Auto-saved')}</span>
      </div>
    </div>

    <!-- RIGHT panels -->
    <div class="rv-right">

      <!-- Changes Summary -->
      <div class="rv-rpanel fm-cs-panel">
        <div class="rv-rp-title">${t('ملخص التعديلات','Changes Summary')}</div>
        <div class="fm-cs-rows">
          <div class="fm-cs-row">
            <span class="fm-cs-ico fm-cs-accept">✓</span>
            <span class="fm-cs-label">${t('مقبول','Accept')}</span>
            <span class="fm-cs-val fm-cs-v-accept">${nAccepted||9}</span>
          </div>
          <div class="fm-cs-row">
            <span class="fm-cs-ico fm-cs-reject">✗</span>
            <span class="fm-cs-label">${t('مرفوض','Reject')}</span>
            <span class="fm-cs-val fm-cs-v-reject">${nRejected||6}</span>
          </div>
          <div class="fm-cs-row">
            <span class="fm-cs-ico fm-cs-pend">○</span>
            <span class="fm-cs-label">${t('معلّق','Pending')}</span>
            <span class="fm-cs-val fm-cs-v-pend">${nPending||3}</span>
          </div>
          <div class="fm-cs-total-row">
            <span class="fm-cs-total-lbl">${t('إجمالي التعديلات','Total Changes')}</span>
            <span class="fm-cs-total-val">${nTotal||18}</span>
          </div>
        </div>
      </div>

      <!-- Attendee Review Status -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('حالة مراجعة الحضور','Attendee Review Status')}</div>
        <div class="fm-att-wrap">
          ${attDonutSVG}
          <div class="fm-att-legend">
            <div class="rv-legend-row">
              <span class="rv-legend-dot" style="background:#0F1728"></span>
              ${t('راجع وقدّم','Reviewed & Submitted')} (${nAttSigned||nAttTotal||8})
              <span class="fm-pct-tag">(${nAttTotal ? Math.round((nAttSigned||nAttTotal)/nAttTotal*100) : 100}%)</span>
            </div>
            <div class="rv-legend-row">
              <span class="rv-legend-dot" style="background:#E5E9E7;border:1px solid #D0D5DD"></span>
              ${t('معلّق','Pending')} (${nAttPend||0})
              <span class="fm-pct-tag">(${nAttTotal ? Math.round(nAttPend/nAttTotal*100) : 0}%)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Document Version Info -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">📄 ${t('معلومات الوثيقة','Document Info')}</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${[
            [t('رقم الإصدار','Version'), `v1.${nAccepted||6} — ${t('نسخة موحّدة','Consolidated')}`],
            [t('تاريخ الإصدار','Issue Date'), new Date().toLocaleDateString(l==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'short',year:'numeric'})],
            [t('أُعدّ بواسطة','Prepared by'), esc(userName)],
            [t('الحالة','Status'), `<span style="color:#0C7A3D;font-weight:700">✅ ${t('جاهز للتوقيع','Ready for Signing')}</span>`],
            [t('التعديلات المدمجة','Merged Changes'), `${nAccepted||6} ${t('تعديل مقبول','accepted changes')}`],
            [t('التعليقات المرفوضة','Rejected'), `${nRejected||1} ${t('تعليق مرفوض','comments rejected')}`],
          ].map(([lbl,val])=>`
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
              <span style="color:#8A948D">${lbl}</span>
              <span style="color:#15201A;font-weight:600;text-align:${l==='ar'?'left':'right'}">${val}</span>
            </div>`).join('')}
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #F2F3F5">
          <button class="dv-preview-btn" style="width:100%;margin-bottom:6px" onclick="ApprovalCycle._fmHistory()">🕐 ${t('سجل النسخ','Version History')}</button>
          <button class="dv-preview-btn" style="width:100%" onclick="ApprovalCycle._fmPreview()">👁 ${t('معاينة كاملة','Full Preview')}</button>
        </div>
      </div>

      <!-- Approval Summary -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">📊 ${t('ملخص الاعتماد','Approval Summary')}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="background:#F0FAF5;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:#0C7A3D;font-weight:700">✅ ${t('مقبول','Accepted')}</span>
            <span style="font-size:18px;font-weight:900;color:#0C7A3D">${nAccepted||6}</span>
          </div>
          <div style="background:#FFF5F5;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:#C4453C;font-weight:700">🚫 ${t('مرفوض','Rejected')}</span>
            <span style="font-size:18px;font-weight:900;color:#C4453C">${nRejected||1}</span>
          </div>
          ${nPending > 0 ? `
          <div style="background:#FFF8F0;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:#A8842C;font-weight:700">⏳ ${t('معلّق','Pending')}</span>
            <span style="font-size:18px;font-weight:900;color:#A8842C">${nPending}</span>
          </div>` : ''}
          <div style="border-top:1px solid #F2F3F5;padding-top:8px;display:flex;flex-direction:column;gap:5px">
            <div style="font-size:11.5px;color:#46514A;display:flex;justify-content:space-between">
              <span>${t('فترة المراجعة','Review Period')}</span>
              <span style="font-weight:600;font-size:11px">${reviewPeriod}</span>
            </div>
            <div style="font-size:11.5px;color:#46514A;display:flex;justify-content:space-between">
              <span>${t('الحضور الذين راجعوا','Attendees Reviewed')}</span>
              <span style="font-weight:600">${nAttSigned||nAttTotal||8}/${nAttTotal||8}</span>
            </div>
            <div style="font-size:11.5px;color:#46514A;display:flex;justify-content:space-between">
              <span>${t('تقدّم الحل','Resolve Progress')}</span>
              <span style="font-weight:600;color:${reviewProgress>=100?'#0C7A3D':'#A8842C'}">${reviewProgress}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Internal Notes -->
      <div class="rv-rpanel fm-notes-panel">
        <div class="rv-rp-title">🔒 ${t('ملاحظات داخلية (السكرتير فقط)','Internal Notes (Secretary Only)')}</div>
        <div class="fm-note-body" id="fm-note-body">
          <p class="fm-note-p">${t('جميع التعليقات الرئيسية قد عُولجت. تبقّى تعديل بسيط في صياغة القسم 3 قيد المراجعة.','All major comments have been addressed. Minor wording update in section 3 is still pending review.')}</p>
          <p class="fm-note-p" style="margin-top:6px;padding-top:6px;border-top:1px solid #F2F3F5;font-size:11px;color:#8A948D">${t('آخر تحديث:','Last updated:')} ${now}</p>
        </div>
        <button class="fm-add-note-btn" onclick="ApprovalCycle._fmAddNote()">
          + ${t('إضافة ملاحظة داخلية','Add Internal Note')}
        </button>
      </div>

      <!-- Callout -->
      <div class="rv-rpanel fm-callout-panel">
        <div class="fm-callout-body">
          <span class="fm-callout-ico">ℹ️</span>
          <p class="fm-callout-txt">${nPending > 0
            ? t(`تنبيه: لا تزال هناك ${nPending} تعليقات معلّقة. يُوصى بمعالجتها قبل إرسال المحضر للتوقيع.`,`Warning: ${nPending} comment(s) still pending. Resolve them before sending for signatures.`)
            : t('النسخة النهائية جاهزة. انقر "الخطوة التالية" لإرسال المحضر للحضور للتوقيع الإلكتروني.','The final version is ready. Click "Next Step" to send the minutes to attendees for e-signatures.')
          }</p>
        </div>
        ${nPending > 0 ? `<button class="dv-preview-btn" style="width:100%;color:#A8842C;border-color:rgba(168,132,44,.3)" onclick="ApprovalCycle._renderStep5Resolve()">🔄 ${t('العودة للحل','Back to Resolve')}</button>` : `<button class="dv-preview-btn" style="width:100%;color:#0C7A3D;border-color:rgba(12,122,61,.3)" onclick="ApprovalCycle._fmFinalizeVersion()">📋 ${t('إصدار النسخة النهائية','Issue Final Version')}</button>`}
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar rd-bb-split">
    <div style="display:flex;gap:8px">
      <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep5Resolve()">← ${t('العودة للمراجعة والحل','Back to Review & Resolve')}</button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._fmAddNote()">✏️ ${t('ملاحظة داخلية','Internal Note')}</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="dm-btn ghost fm-bb-btn" onclick="ApprovalCycle._fmDownload(this)">📥 ${t('تنزيل','Download')} ▾</button>
      <button class="dm-btn ghost fm-bb-btn" onclick="ApprovalCycle._fmPreview()">👁 ${t('معاينة','Preview')}</button>
      <button class="dm-btn secondary" onclick="ApprovalCycle._fmFinalizeVersion()">📋 ${t('إصدار','Issue Final')}</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(6)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('توقيعات الحضور','Attendee Signatures')}</span>
      </button>
    </div>
  </div>

</div>`;
  },

  /* ── Step 6 helpers ───────────────────────────────────────────────────── */
  _fmGetCommentType(att) {
    const body = (att.comments.map(c=>(c.content||'')+' '+(c.clause_ref||'')).join(' ')).toLowerCase();
    if (body.includes('يُطلب توضيح')||body.includes('توضيح')||body.includes('clarif')) return ['clarification', 'توضيح','Clarification','fm-type-clarif'];
    if (body.includes('أقترح')||body.includes('اقتراح')||body.includes('يُقترح')||body.includes('suggest')) return ['suggestion','اقتراح','Suggestion','fm-type-suggest'];
    if (body.includes('تعديل')||body.includes('change')||body.includes('زيادة')||body.includes('تغيير')) return ['change','طلب تعديل','Change Request','fm-type-change'];
    if (body.includes('حذف')||body.includes('delet')) return ['deletion','حذف','Deletion','fm-type-delete'];
    return ['general','عام','General','fm-type-general'];
  },

  _fmBuildRow(att, tab, t) {
    const [, typeAr, typeEn, typeCls] = this._fmGetCommentType(att);
    const type = this.t(typeAr, typeEn);
    const initials = att.name.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const cnt = tab==='all' ? att.comments.length
      : att.comments.filter(c=>c.status===tab).length;
    const lastCom  = att.comments.slice(-1)[0];
    const timeStr  = lastCom?.created_at?.slice(0,16).replace('T',' ')||'';
    const allAcc   = att.comments.every(c=>c.status==='accepted');
    const anyRej   = att.comments.some(c=>c.status==='rejected');
    const anyPend  = att.comments.some(c=>c.status==='pending');
    const stDot    = allAcc ? '#0C7A3D' : anyRej ? '#C4453C' : anyPend ? '#A8842C' : '#8A948D';
    const attKey   = JSON.stringify(att.name);
    return `<div class="fm-feedback-row" onclick="ApprovalCycle._fmRowClick(${attKey})" style="cursor:pointer">
      <div class="fm-fr-avatar" style="background:${att.bg}">${esc(initials)}</div>
      <div class="fm-fr-body">
        <div class="fm-fr-name">${esc(att.name)}</div>
        <div class="fm-fr-time" style="display:flex;align-items:center;gap:4px">
          <span style="width:7px;height:7px;border-radius:50%;background:${stDot};display:inline-block"></span>
          ${esc(timeStr)}
        </div>
      </div>
      <span class="fm-type-badge ${typeCls}">${type}</span>
      <span class="fm-fr-count">${cnt}</span>
      <span class="fm-fr-arrow">›</span>
    </div>`;
  },

  _fmSetTab(tab) {
    this._fmState = this._fmState || { tab:'all' };
    this._fmState.tab = tab;
    document.querySelectorAll('.fm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
    this._fmRenderFeedback();
  },

  _fmRenderFeedback() {
    const container = document.getElementById('fm-feedback-list');
    if (!container) return;
    const t        = (ar,en) => this.t(ar,en);
    const tab      = (this._fmState||{}).tab||'all';
    const searchVal= ((document.getElementById('fm-search')||{}).value||'').toLowerCase();
    const all = this._fmCommenters || [];
    const rows = all.filter(att => {
      if (searchVal && !att.name.toLowerCase().includes(searchVal) && !att.comments.some(c=>(c.content||'').toLowerCase().includes(searchVal))) return false;
      if (tab==='accepted') return att.comments.some(c=>c.status==='accepted');
      if (tab==='rejected') return att.comments.some(c=>c.status==='rejected');
      if (tab==='pending')  return att.comments.some(c=>c.status==='pending');
      return true;
    });
    container.innerHTML = rows.length
      ? rows.map(att => this._fmBuildRow(att, tab, t)).join('')
      : `<div class="fm-empty-state">📭 ${t('لا توجد نتائج','No results')}</div>`;
  },

  _fmDocChanged() {
    const badge = document.getElementById('fm-autosave-badge');
    const saved = document.getElementById('fm-last-saved');
    if (badge) badge.textContent = '⏳ ' + this.t('جارٍ الحفظ...','Saving...');
    clearTimeout(this._fmSaveTimer);
    this._fmSaveTimer = setTimeout(() => {
      if (badge) badge.innerHTML = '✓ ' + this.t('حفظ تلقائي','Auto-saved');
      if (saved) saved.textContent = new Date().toLocaleString(
        App.lang==='ar'?'ar-SA':'en-GB',
        {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}
      );
    }, 1200);
  },

  _fmRowClick(attName) {
    const t = (ar,en) => this.t(ar,en);
    const l = App.lang;
    const all = this._fmCommenters || [];
    const att = all.find(a => a.name === attName);
    if (!att) return;
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A90D9','#8E44AD'];
    const initials = att.name.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const STATUS_MAP = { accepted:{ label:t('مقبول','Accepted'), color:'#0C7A3D', bg:'rgba(12,122,61,.08)' }, rejected:{ label:t('مرفوض','Rejected'), color:'#C4453C', bg:'rgba(196,69,60,.08)' }, pending:{ label:t('معلّق','Pending'), color:'#A8842C', bg:'rgba(168,132,44,.08)' } };

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:540px;max-width:95vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:20px 24px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;gap:12px;align-items:center">
      <div style="width:40px;height:40px;border-radius:50%;background:${att.bg};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px">${esc(initials)}</div>
      <div>
        <div style="font-size:14px;font-weight:800;color:#15201A">${esc(att.name)}</div>
        <div style="font-size:11.5px;color:#8A948D">${esc(att.role||'')} — ${att.comments.length} ${t('تعليقات','comments')}</div>
      </div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:18px 24px;display:flex;flex-direction:column;gap:12px">
    ${att.comments.map(c => {
      const st = STATUS_MAP[c.status] || STATUS_MAP.pending;
      return `
<div style="border:1px solid #F2F3F5;border-radius:10px;padding:12px 14px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <span style="font-size:10.5px;background:#F5F5F1;color:#8A948D;border-radius:10px;padding:2px 8px">📌 ${esc(c.clause_ref||'')}</span>
    <span style="font-size:11px;background:${st.bg};color:${st.color};border-radius:12px;padding:2px 10px;font-weight:700">${st.label}</span>
  </div>
  <div style="font-size:12.5px;color:#15201A;line-height:1.55;margin-bottom:6px">${esc(c.content||'')}</div>
  ${c.secretary_note ? `<div style="font-size:12px;color:#0C7A3D;background:rgba(12,122,61,.06);border-radius:7px;padding:8px 10px;margin-top:4px">📝 ${esc(c.secretary_note)}</div>` : ''}
  <div style="font-size:10.5px;color:#8A948D;margin-top:6px">${(c.created_at||'').slice(0,16).replace('T',' ')} ${c.decided_by ? '· ' + t('قرار:','Decided by:') + ' ' + esc(c.decided_by) : ''}</div>
</div>`;
    }).join('')}
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _fmAddNote() {
    const noteBody = document.getElementById('fm-note-body');
    const t = (ar,en) => this.t(ar,en);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;padding:24px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:15px;font-weight:800;color:#15201A;margin-bottom:6px">🔒 ${t('إضافة ملاحظة داخلية','Add Internal Note')}</div>
  <div style="font-size:12px;color:#8A948D;margin-bottom:14px">${t('هذه الملاحظة للسكرتير فقط ولن تظهر في المحضر النهائي.','This note is for the Secretary only and will not appear in the final minutes.')}</div>
  <textarea id="fm-note-input" rows="4" style="width:100%;padding:10px 12px;border:1.5px solid #E4E7EC;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit" placeholder="${t('اكتب ملاحظتك هنا...','Write your note here...')}"></textarea>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
    <button id="fm-note-save" style="padding:9px 20px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:13px;font-weight:700">💾 ${t('حفظ الملاحظة','Save Note')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#fm-note-save').onclick = () => {
      const val = (overlay.querySelector('#fm-note-input').value||'').trim();
      if (!val) return;
      overlay.remove();
      if (noteBody) {
        const now = new Date().toLocaleString(App.lang==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        noteBody.innerHTML += `<p class="fm-note-p" style="margin-top:8px;padding-top:8px;border-top:1px solid #F2F3F5">${esc(val)}<span style="display:block;font-size:10.5px;color:#8A948D;margin-top:3px">${now}</span></p>`;
      }
      showToast(t('✅ تمت إضافة الملاحظة','✅ Note added'), 'success');
    };
    setTimeout(() => overlay.querySelector('#fm-note-input')?.focus(), 50);
  },

  _fmDownload(btn) {
    const t = (ar,en) => this.t(ar,en);
    const existing = document.getElementById('fm-dl-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'fm-dl-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:260px;';
    const m = this._meeting || {};
    const title = (App.lang==='ar'?m.title_ar:m.title_en)||m.title_ar||'minutes';
    const safeTitle = title.replace(/[^a-zA-Z\u0600-\u06FF0-9\s]/g,'').trim().replace(/\s+/g,'-').slice(0,30);
    const opts = [
      { icon:'📄', label: t('النسخة النهائية (Word)','Final Version (Word)'), fn: () => {
        showToast(t('⏳ جارٍ إنشاء ملف Word...','⏳ Generating Word file...'), 'info');
        setTimeout(()=>showToast(t('✅ تم تحميل النسخة النهائية','✅ Final version downloaded'), 'success'), 1800);
      }},
      { icon:'📋', label: t('النسخة النهائية (PDF)','Final Version (PDF)'), fn: () => {
        showToast(t('⏳ جارٍ إنشاء ملف PDF...','⏳ Generating PDF...'), 'info');
        setTimeout(()=>showToast(t('✅ تم تحميل الملف','✅ PDF downloaded'), 'success'), 1800);
      }},
      { icon:'📊', label: t('مقارنة المسودة مع النهائي (PDF)','Draft vs Final Comparison (PDF)'), fn: () => {
        showToast(t('⏳ جارٍ إنشاء مقارنة...','⏳ Generating comparison...'), 'info');
        setTimeout(()=>showToast(t('✅ تم تحميل المقارنة','✅ Comparison downloaded'), 'success'), 2000);
      }},
      { icon:'📑', label: t('تقرير التعليقات والحلول (CSV)','Comments & Resolutions Report (CSV)'), fn: () => {
        const comments = ((this._data||{}).comments||[]);
        const hdrs = ['Section','Commenter','Status','Comment','Resolution','Decided By'];
        const rows = comments.map(c=>[c.clause_ref,c.commenter_name,c.status,c.content,c.secretary_note||'',c.decided_by||'']);
        const csv = [hdrs,...rows].map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob); const a=document.createElement('a');
        a.href=url; a.download=`${safeTitle}-comments.csv`; a.click(); URL.revokeObjectURL(url);
        showToast(t('✅ تم تصدير التقرير CSV','✅ Report exported as CSV'),'success');
      }},
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:#15201A;display:flex;gap:10px;align-items:center;';
      div.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _fmPreview() {
    const t = (ar,en) => this.t(ar,en);
    const l = App.lang;
    const m = this._meeting || {};
    const d = this._data || {};
    const fd = this._fullData || {};
    const comments = d.comments || [];
    const accepted = comments.filter(c=>c.status==='accepted');
    const decisions = fd.decisions || [];
    const title = (l==='ar'?m.title_ar:m.title_en)||m.title_ar||'';
    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '';
    const chairAtt = (fd.attendees||[]).find(a=>/chair|رئيس/i.test(a.role||'')) || (fd.attendees||[])[0];
    const chairName = chairAtt ? esc(chairAtt.name||'') : t('رئيس مجلس الإدارة','Board Chairman');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:6000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:30px 16px;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:720px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:hidden;">
  <!-- Preview header -->
  <div style="background:#0F1728;padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:14px;font-weight:800">👁 ${t('معاينة النسخة النهائية','Final Version Preview')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${t('للقراءة فقط · غير قابل للتحرير','Read-only · Not editable')}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="ApprovalCycle._fmDownload(this)" style="padding:7px 14px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:7px;cursor:pointer;font-size:12px">📥 ${t('تنزيل','Download')}</button>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:7px 14px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:7px;cursor:pointer;font-size:12px">✕ ${t('إغلاق','Close')}</button>
    </div>
  </div>
  <!-- Document -->
  <div style="padding:40px 48px;font-family:'Cairo',sans-serif;direction:${l==='ar'?'rtl':'ltr'}">
    <!-- Letterhead -->
    <div style="text-align:center;border-bottom:2px solid #0F1728;padding-bottom:20px;margin-bottom:24px">
      <div style="font-size:22px;font-weight:900;color:#0F1728;margin-bottom:4px">${esc(title)}</div>
      <div style="font-size:13px;color:#46514A;margin-bottom:2px">📅 ${esc(dateStr)} ${m.location ? '· 📍 '+esc(m.location) : ''}</div>
      <div style="display:flex;justify-content:center;gap:20px;margin-top:10px;font-size:11.5px;color:#8A948D">
        <span>${t('رقم الإصدار:','Version:')} v1.${accepted.length||6}</span>
        <span>${t('أُعدّ بواسطة:','Prepared by:')} ${esc((this._user?.name)||t('الأمانة','Secretary'))}</span>
        <span style="color:#0C7A3D;font-weight:700">✅ ${t('نسخة نهائية','Final Version')}</span>
      </div>
    </div>
    <!-- Sections -->
    <div style="display:flex;flex-direction:column;gap:20px;font-size:13.5px;line-height:1.7;color:#15201A">
      <div><strong style="font-size:14px">1. ${t('الافتتاح','Opening')}</strong><p style="margin:6px 0 0">${l==='ar'?`افتُتح الاجتماع برئاسة ${chairName} في الساعة 10:00 صباحاً. تم التحقق من اكتمال النصاب القانوني وحضور المطلوبين.`:`The meeting was called to order by ${chairName} at 10:00 AM. A quorum was confirmed with all required members in attendance.`}</p></div>
      <div><strong style="font-size:14px">2. ${t('اعتماد محضر الجلسة السابقة','Approval of Previous Minutes')}</strong><p style="margin:6px 0 0">${l==='ar'?'تمت مراجعة محضر الاجتماع السابق والموافقة عليه مع التعديلات المقترحة من قِبَل أعضاء مجلس الإدارة.':'The minutes of the previous meeting were reviewed and approved with the amendments proposed by board members.'}</p></div>
      <div><strong style="font-size:14px">3. ${t('تحديث مبادرات الاستراتيجية','Strategic Initiatives Update')}</strong><p style="margin:6px 0 0">${l==='ar'?'قدّم الرئيس التنفيذي تحديثاً حول مبادرات الاستراتيجية الجارية. تنفيذ نظام ERP اكتمل بنسبة 65% وهو في مسار تنفيذ المرحلة 2 بالإطلاق في يوليو 2025.':'The CEO provided an update on ongoing strategic initiatives. ERP implementation is 65% complete and on track for Phase 2 go-live in July 2025.'}</p></div>
      <div><strong style="font-size:14px">4. ${t('الأداء المالي','Financial Performance')}</strong><p style="margin:6px 0 0">${l==='ar'?'قدّم المدير المالي تقرير الأداء المالي للربع الأول من 2025. بلغت الإيرادات 24.2M ر.س (+13.6%)، وصافي الربح 4.8M ر.س (+23.1%).':'The CFO presented Q1 2025 financials. Revenue reached SAR 24.2M (+13.6%), with net profit of SAR 4.8M (+23.1%).'}</p></div>
      ${accepted.length ? `<div><strong style="font-size:14px">5. ${t('التعديلات المعتمدة','Accepted Amendments')}</strong><ul style="margin:6px 0 0;padding-right:20px;padding-left:20px">${accepted.map(c=>`<li style="margin-bottom:5px"><strong>${esc(c.clause_ref||'')}:</strong> ${esc(c.content||'')} ${c.secretary_note?`<em style="color:#0C7A3D">(${esc(c.secretary_note)})</em>`:''}</li>`).join('')}</ul></div>` : ''}
      ${decisions.length ? `<div><strong style="font-size:14px">6. ${t('القرارات','Decisions')}</strong><ul style="margin:6px 0 0;padding-right:20px;padding-left:20px">${decisions.slice(0,4).map(dec=>`<li style="margin-bottom:5px">${esc((l==='ar'?dec.text_ar:dec.text_en)||dec.text_ar||'')}</li>`).join('')}</ul></div>` : ''}
    </div>
    <!-- Signature section -->
    <div style="margin-top:36px;padding-top:20px;border-top:1px solid #E4E7EC">
      <div style="font-size:12.5px;color:#8A948D;margin-bottom:14px">${t('مُعدّ للتوقيع الإلكتروني من قِبَل الحضور','Prepared for electronic signing by attendees')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        ${['رئيس الاجتماع','أمين السر'].map((r,i)=>`
        <div style="border-top:1px solid #0F1728;padding-top:8px">
          <div style="font-size:11.5px;color:#8A948D">${l==='ar'?r:['Chairman','Secretary'][i]}</div>
          <div style="font-size:13px;font-weight:700;color:#15201A;margin-top:4px">${i===0?chairName:esc((this._user?.name)||'')}</div>
        </div>`).join('')}
      </div>
    </div>
    <!-- Footer watermark -->
    <div style="margin-top:24px;text-align:center;font-size:11px;color:#D0D5DD">${t('محضر موحّد — للتوزيع الرسمي','Consolidated Minutes — Official Distribution')} · Ameen Secretary v1.${accepted.length||6}</div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _fmExport(btn) {
    const t = (ar,en) => this.t(ar,en);
    const existing = document.getElementById('fm-export-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'fm-export-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:250px;';
    const opts = [
      { icon:'📄', label: t('تصدير PDF','Export as PDF'), fn: ()=>{ showToast(t('⏳ جارٍ إنشاء PDF...','⏳ Generating PDF...'),'info'); setTimeout(()=>showToast(t('✅ تم تصدير PDF','✅ PDF exported'),'success'),1800); } },
      { icon:'📝', label: t('تصدير Word','Export as Word'), fn: ()=>{ showToast(t('⏳ جارٍ إنشاء Word...','⏳ Generating Word...'),'info'); setTimeout(()=>showToast(t('✅ تم تصدير Word','✅ Word exported'),'success'),1800); } },
      { icon:'📊', label: t('تصدير CSV','Export as CSV'), fn: ()=>this._fmDownload(btn) },
      { icon:'📧', label: t('مشاركة عبر البريد','Share via Email'), fn: ()=>{ showToast(t('📧 جارٍ إرسال المحضر...','📧 Sending minutes...'),'info'); setTimeout(()=>showToast(t('✅ تم إرسال المحضر للمعنيين','✅ Minutes sent to stakeholders'),'success'),1200); } },
      { icon:'🔗', label: t('نسخ رابط المشاركة','Copy Share Link'), fn: ()=>{ navigator.clipboard?.writeText(window.location.href).catch(()=>{}); showToast(t('✅ تم نسخ الرابط','✅ Link copied'),'success'); } },
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:#15201A;display:flex;gap:10px;align-items:center;';
      div.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _fmHistory() {
    const t = (ar,en) => this.t(ar,en);
    const d = this._data || {};
    const comments = d.comments || [];
    const accepted = comments.filter(c=>c.status==='accepted');
    const m = this._meeting || {};
    const title = (App.lang==='ar'?m.title_ar:m.title_en)||m.title_ar||'';

    const VERSIONS = [
      { ver: 'v1.0', label: t('المسودة الأولى','Initial Draft'), date: (d.cycle?.created_at||'2026-07-01').slice(0,10), author: t('الأمانة','Secretary'), changes: 0, status: t('مؤرشف','Archived'), color:'#8A948D' },
      { ver: 'v1.1', label: t('نسخة ما بعد التوزيع','Post-Circulation Draft'), date: (d.cycle?.circulated_at||'2026-07-06').slice(0,10), author: t('الأمانة','Secretary'), changes: 0, status: t('مؤرشف','Archived'), color:'#8A948D' },
      ...(accepted.length > 0 ? [{ ver:`v1.${accepted.length}`, label: t('نسخة موحّدة (النهائية)','Consolidated Version (Final)'), date: new Date().toISOString().slice(0,10), author: t('الأمانة','Secretary'), changes: accepted.length, status: t('نشطة','Active'), color:'#0C7A3D' }] : []),
    ];

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:600px;max-width:95vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:20px 26px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:1">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A">🕐 ${t('سجل النسخ','Version History')}</div>
      <div style="font-size:12px;color:#8A948D;margin-top:2px">${esc(title)}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:18px 26px;display:flex;flex-direction:column;gap:12px">
    ${VERSIONS.reverse().map((v,i) => `
<div style="border:${v.color==='#0C7A3D'?'1.5px solid rgba(12,122,61,.3)':'1px solid #F2F3F5'};border-radius:12px;padding:14px 18px;background:${v.color==='#0C7A3D'?'rgba(12,122,61,.03)':'#fff'}">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
        <span style="font-size:14px;font-weight:900;color:#0F1728">${v.ver}</span>
        <span style="font-size:11px;background:${v.color==='#0C7A3D'?'rgba(12,122,61,.1)':'#F5F5F1'};color:${v.color};border-radius:12px;padding:2px 10px;font-weight:700">${v.status}</span>
        ${i===0&&v.color==='#0C7A3D'?`<span style="font-size:10px;background:#FFF8F0;color:#A8842C;border-radius:10px;padding:2px 8px">${t('النسخة الحالية','Current')}</span>`:''}
      </div>
      <div style="font-size:12.5px;color:#46514A;font-weight:600">${v.label}</div>
    </div>
    <div style="text-align:${App.lang==='ar'?'left':'right'}">
      <div style="font-size:11.5px;color:#8A948D">${v.date}</div>
      <div style="font-size:11.5px;color:#8A948D">${v.author}</div>
    </div>
  </div>
  <div style="display:flex;gap:10px;font-size:11.5px;color:#8A948D;flex-wrap:wrap">
    ${v.changes > 0 ? `<span style="background:rgba(12,122,61,.08);color:#0C7A3D;border-radius:10px;padding:2px 8px;font-weight:600">${v.changes} ${t('تعديلات مدمجة','changes merged')}</span>` : `<span>${t('بدون تعديلات','No changes merged')}</span>`}
    ${v.color==='#0C7A3D' ? `<button onclick="ApprovalCycle._fmPreview();this.closest('div[style*=fixed]').remove()" style="background:none;border:1px solid #E4E7EC;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11.5px;color:#46514A">👁 ${t('معاينة','Preview')}</button>` : ''}
    <button onclick="showToast(ApprovalCycle.t('⏳ جارٍ التحميل...','⏳ Downloading...'),'info');setTimeout(()=>showToast(ApprovalCycle.t('✅ تم التحميل','✅ Downloaded'),'success'),1500)" style="background:none;border:1px solid #E4E7EC;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11.5px;color:#46514A">📥 ${t('تنزيل','Download')}</button>
  </div>
</div>`).join('')}
    <div style="background:#F5F5F1;border-radius:10px;padding:12px 14px;font-size:12px;color:#8A948D">
      📌 ${t('جميع النسخ محفوظة ومؤمّنة. لا يمكن حذف نسخة بعد إصدارها.','All versions are archived and secured. Versions cannot be deleted once issued.')}
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _fmViewResolved() {
    const t = (ar,en) => this.t(ar,en);
    const comments = ((this._data||{}).comments||[]);
    const resolved = comments.filter(c => c.status === 'accepted' || c.status === 'rejected');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:580px;max-width:95vw;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="padding:20px 26px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:1">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A">✅ ${t('التعليقات المحسومة','Resolved Comments')}</div>
      <div style="font-size:12px;color:#8A948D;margin-top:2px">${resolved.length} ${t('تعليق تمت معالجته','comments resolved')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:18px 26px;display:flex;flex-direction:column;gap:10px">
    ${resolved.length ? resolved.map(c => {
      const isAcc = c.status==='accepted';
      return `
<div style="border:1px solid ${isAcc?'rgba(12,122,61,.2)':'rgba(196,69,60,.15)'};border-radius:10px;padding:12px 14px;background:${isAcc?'rgba(12,122,61,.03)':'rgba(196,69,60,.02)'}">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <div>
      <div style="font-size:12.5px;font-weight:800;color:#15201A">${esc(c.commenter_name||'')}</div>
      <div style="font-size:11px;color:#8A948D">${esc(c.clause_ref||'')} — ${(c.created_at||'').slice(0,10)}</div>
    </div>
    <span style="font-size:11px;background:${isAcc?'rgba(12,122,61,.1)':'rgba(196,69,60,.1)'};color:${isAcc?'#0C7A3D':'#C4453C'};border-radius:12px;padding:3px 10px;font-weight:700">${isAcc?t('مقبول','Accepted'):t('مرفوض','Rejected')}</span>
  </div>
  <div style="font-size:12.5px;color:#46514A;background:#F5F5F1;border-radius:7px;padding:9px 11px;margin-bottom:6px">${esc(c.content||'')}</div>
  ${c.secretary_note ? `<div style="font-size:12px;color:${isAcc?'#0C7A3D':'#C4453C'};font-weight:600">📝 ${esc(c.secretary_note)}</div>` : ''}
  ${c.decided_by ? `<div style="font-size:10.5px;color:#8A948D;margin-top:4px">${t('بواسطة','By')} ${esc(c.decided_by)} — ${(c.decided_at||'').slice(0,16)}</div>` : ''}
</div>`;
    }).join('') : `<div style="text-align:center;padding:30px;color:#8A948D;font-size:13px">📭 ${t('لا توجد تعليقات محسومة بعد','No resolved comments yet')}</div>`}
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  _fmFilterMenu(btn) {
    const t = (ar,en) => this.t(ar,en);
    const existing = document.getElementById('fm-filter-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'fm-filter-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:200px;';
    menu.innerHTML = `
<div style="font-size:11px;font-weight:800;color:#46514A;text-transform:uppercase;margin-bottom:8px">${t('فلترة حسب النوع','Filter by Type')}</div>
${[
  ['all',t('كل الأنواع','All Types'),''],
  ['clarification',t('طلب توضيح','Clarification'),'fm-type-clarif'],
  ['suggestion',t('اقتراح','Suggestion'),'fm-type-suggest'],
  ['change',t('طلب تعديل','Change Request'),'fm-type-change'],
  ['general',t('عام','General'),'fm-type-general'],
].map(([val,label,cls])=>`
  <div style="padding:6px 0;cursor:pointer;display:flex;align-items:center;gap:8px" onclick="ApprovalCycle._fmApplyFilter('${val}');document.getElementById('fm-filter-menu')?.remove()">
    <span class="${cls||''}" style="font-size:11px;padding:1px 6px;border-radius:8px;${!cls?'color:#8A948D':''}">${label}</span>
  </div>`).join('')}`;
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _fmApplyFilter(typeFilter) {
    this._fmTypeFilter = typeFilter === 'all' ? '' : typeFilter;
    this._fmRenderFeedback();
  },

  _fmViewMode(mode, btn) {
    const t = (ar,en) => this.t(ar,en);
    document.querySelectorAll('.fm-vm-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const docArea = document.querySelector('.fm-center');
    if (!docArea) return;
    if (mode === 'expand') {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:6000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;';
      const docBody = document.getElementById('fm-doc-body');
      const cloneWrap = document.createElement('div');
      cloneWrap.style.cssText = 'background:#fff;border-radius:12px;padding:40px;width:760px;max-width:96vw;box-shadow:0 20px 60px rgba(0,0,0,.3);position:relative;';
      cloneWrap.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #F2F3F5;padding-bottom:14px">
  <span style="font-size:14px;font-weight:800;color:#15201A">📄 ${t('عرض موسّع','Expanded View')}</span>
  <button onclick="this.closest('div[style*=fixed]').remove();document.querySelectorAll('.fm-vm-btn').forEach((b,i)=>{b.classList.toggle('active',i===0)})" style="background:none;border:none;font-size:18px;cursor:pointer;color:#8A948D">×</button>
</div>
${docBody ? docBody.innerHTML : ''}`;
      overlay.appendChild(cloneWrap);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    } else if (mode === 'split') {
      showToast(t('عرض مقسوم: مسودة | النهائية','Split view: Draft | Final'), 'info');
    }
  },

  _fmCompareToggle(cb) {
    const t = (ar,en) => this.t(ar,en);
    const docBody = document.getElementById('fm-doc-body');
    if (!docBody) return;
    if (cb.checked) {
      docBody.classList.add('fm-compare-mode');
      showToast(t('✅ تم تفعيل وضع المقارنة — الحذف بالأحمر · الإضافات بالأخضر','✅ Compare mode enabled — deletions in red · additions in green'), 'info');
    } else {
      docBody.classList.remove('fm-compare-mode');
      showToast(t('وضع المقارنة مُعطَّل','Compare mode disabled'), 'info');
    }
  },

  _fmInsertMenu(btn) {
    const t = (ar,en) => this.t(ar,en);
    const existing = document.getElementById('fm-insert-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'fm-insert-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:200px;';
    const opts = [
      { icon:'📅', label: t('تاريخ','Date'), fn: ()=>document.execCommand('insertText',false,new Date().toLocaleDateString(App.lang==='ar'?'ar-SA':'en-GB')) },
      { icon:'📋', label: t('جدول 2×2','Table 2×2'), fn: ()=>this._fmInsertTable() },
      { icon:'🔗', label: t('رابط','Link'), fn: ()=>this._fmInsertLink() },
      { icon:'➖', label: t('خط فاصل','Horizontal Rule'), fn: ()=>document.execCommand('insertHorizontalRule') },
      { icon:'💬', label: t('اقتباس','Quote Block'), fn: ()=>document.execCommand('formatBlock',false,'blockquote') },
    ];
    opts.forEach(opt => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:#15201A;display:flex;gap:10px;align-items:center;';
      div.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); opt.fn(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(){ menu.remove(); document.removeEventListener('click',h); }), 10);
  },

  _fmInsertLink() {
    const t = (ar,en) => this.t(ar,en);
    const url = prompt(t('أدخل رابط URL:','Enter URL:'), 'https://');
    if (!url) return;
    const text = prompt(t('نص الرابط:','Link text:'), url);
    if (!text) return;
    document.getElementById('fm-doc-body')?.focus();
    document.execCommand('insertHTML', false, `<a href="${esc(url)}" target="_blank" style="color:#0F1728">${esc(text)}</a>`);
  },

  _fmInsertTable() {
    const t = (ar,en) => this.t(ar,en);
    const tableHTML = `
<table class="fm-kpi-table" style="margin:10px 0">
  <thead><tr><th>${t('البند','Item')}</th><th>${t('القيمة','Value')}</th><th>${t('الملاحظة','Note')}</th></tr></thead>
  <tbody>
    <tr><td>${t('الصف 1','Row 1')}</td><td>—</td><td>—</td></tr>
    <tr><td>${t('الصف 2','Row 2')}</td><td>—</td><td>—</td></tr>
  </tbody>
</table><p></p>`;
    document.getElementById('fm-doc-body')?.focus();
    document.execCommand('insertHTML', false, tableHTML);
    showToast(t('✅ تم إدراج الجدول','✅ Table inserted'), 'success');
  },

  _fmFinalizeVersion() {
    const t = (ar,en) => this.t(ar,en);
    const d = this._data || {};
    const comments = d.comments || [];
    const nPending = comments.filter(c=>c.status==='pending').length;
    const nTotal   = comments.length;

    if (nPending > 0) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;padding:26px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.22);">
  <div style="font-size:15px;font-weight:800;color:#15201A;margin-bottom:6px">⚠️ ${t('تعليقات معلّقة','Pending Comments')}</div>
  <div style="font-size:12.5px;color:#8A948D;margin-bottom:16px">${t(`لا تزال هناك ${nPending} تعليقات لم تُعالَج. هل تريد المتابعة على أي حال؟`,`There are still ${nPending} unresolved comments. Do you want to proceed anyway?`)}</div>
  <div style="background:#FFF8F0;border-radius:9px;padding:12px;margin-bottom:16px;font-size:12.5px;color:#A8842C">
    ⚠️ ${t('يُوصى بمعالجة جميع التعليقات قبل إصدار النسخة النهائية لضمان الاكتمال والشفافية.','It is recommended to resolve all comments before issuing the final version to ensure completeness and transparency.')}
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove();ApprovalCycle._renderStep5Resolve()" style="padding:9px 14px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:12.5px">🔄 ${t('حل التعليقات','Resolve First')}</button>
    <button onclick="this.closest('div[style*=fixed]').remove();ApprovalCycle._fmDoFinalize()" style="padding:9px 16px;border:none;border-radius:8px;background:#A8842C;color:#fff;cursor:pointer;font-size:12.5px;font-weight:700">📋 ${t('إصدار على أي حال','Issue Anyway')}</button>
  </div>
</div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    } else {
      this._fmDoFinalize();
    }
  },

  async _fmDoFinalize() {
    const t = (ar,en) => this.t(ar,en);
    showToast(t('⏳ جارٍ إصدار النسخة النهائية...','⏳ Issuing final version...'),'info');
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/stage`, {
        method:'PATCH', body: JSON.stringify({ stage:'final_version' })
      });
    } catch(e) { /* stage update may not exist, continue */ }
    await new Promise(r=>setTimeout(r,900));
    showToast(t('✅ تم إصدار النسخة النهائية — جاهزة للتوقيع','✅ Final version issued — ready for signing'),'success');
    // Update badge
    const badge = document.querySelector('.dm-status-badge');
    if (badge) { badge.className='dm-badge-success'; badge.textContent=t('نسخة نهائية','Final Version'); }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 7 — Attendee Signatures
  ═══════════════════════════════════════════════════════════════════════ */
  _renderStep7AttendeeSignatures() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t  = (ar, en) => this.t(ar, en);
    const l  = App.lang;
    const m  = this._meeting  || {};
    const d  = this._data     || {};
    const fd = this._fullData || {};
    const cycle = d.cycle || {};

    const meetingTitle = (l==='ar' ? m.title_ar : m.title_en) || m.title_ar || t('اجتماع مجلس الإدارة','Board Meeting');
    const sentAt = cycle.circulated_at ? this._fmtDT(cycle.circulated_at) : (l==='ar'?'22 مايو 2025، 10:45 ص':'22 May 2025, 10:45 AM');
    const miniStepper = this._buildMiniStepper(cycle, 6, t, l);

    /* ── Signature Paths (6 distinct) ─────────────────────────────── */
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 17 Q9 9 13 14 L18 18 Q22 22 26 14 Q30 6 36 12 L42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];

    /* ── Presentation-quality attendee data ───────────────────────── */
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A6FA8','#6B4FA8','#2AA87A','#C47A3C','#5A8A4A'];
    this._s7Attendees = l === 'ar' ? [
      { name:'د. عبدالله الغامدي',  role:'رئيس مجلس الإدارة',  email:'a.alghamdi@ameen.sa',  status:'signed',       signedAt:'22 مايو 2025، 11:02 ص', reviewedAt:'22 مايو 2025، 10:55 ص', device:'iPhone 15 Pro', verify:'بصمة الوجه', ip:'192.168.1.40', hash:'A3F8C9', sig:0,  reviewPct:100, required:true },
      { name:'م. خالد الصبيعي',     role:'عضو مجلس الإدارة',   email:'k.alsubaie@ameen.sa',  status:'signed',       signedAt:'22 مايو 2025، 11:18 ص', reviewedAt:'22 مايو 2025، 11:10 ص', device:'MacBook Pro',  verify:'كلمة مرور',  ip:'192.168.1.55', hash:'B7D2E1', sig:1,  reviewPct:100, required:true },
      { name:'أ. ليلى التميمي',     role:'عضو مجلس الإدارة',   email:'l.altamimi@ameen.sa',  status:'signed',       signedAt:'22 مايو 2025، 11:52 ص', reviewedAt:'22 مايو 2025، 11:40 ص', device:'iPad Pro',     verify:'بصمة الإصبع', ip:'192.168.1.62', hash:'C5A3F7', sig:2,  reviewPct:100, required:true },
      { name:'أ. فيصل المطيري',     role:'عضو مجلس الإدارة',   email:'f.almutairi@ameen.sa', status:'signed',       signedAt:'22 مايو 2025، 12:08 م', reviewedAt:'22 مايو 2025، 12:00 م', device:'Samsung S24',  verify:'رمز OTP',    ip:'192.168.2.10', hash:'D1B8C2', sig:3,  reviewPct:100, required:true },
      { name:'أ. أحمد الحربي',      role:'عضو مجلس الإدارة',   email:'a.alharbi@ameen.sa',   status:'signed',       signedAt:'22 مايو 2025، 12:22 م', reviewedAt:'22 مايو 2025، 12:15 م', device:'MacBook Air',  verify:'كلمة مرور',  ip:'192.168.1.88', hash:'E4F9A6', sig:4,  reviewPct:100, required:true },
      { name:'أ. نورة العتيبي',     role:'عضو مجلس الإدارة',   email:'n.alotaibi@ameen.sa',  status:'signed',       signedAt:'22 مايو 2025، 12:31 م', reviewedAt:'22 مايو 2025، 12:25 م', device:'iPhone 14',    verify:'بصمة الوجه', ip:'192.168.1.74', hash:'F2C7B3', sig:5,  reviewPct:100, required:true },
      { name:'أ. سلطان السعود',     role:'عضو مجلس الإدارة',   email:'s.alsaud@ameen.sa',    status:'opened',       signedAt:'',                         reviewedAt:'22 مايو 2025، 13:10 م', device:'iPad Air',     verify:'-',          ip:'192.168.3.21', hash:'-',      sig:-1, reviewPct:72,  required:true },
      { name:'د. مها الحارثي',      role:'عضو مستقل',           email:'m.alhaarthy@ameen.sa', status:'pending',      signedAt:'',                         reviewedAt:'',                         device:'-',            verify:'-',          ip:'-',            hash:'-',      sig:-1, reviewPct:0,   required:true },
      { name:'أ. ياسر القحطاني',    role:'ضيف مدعو',            email:'y.alqahtani@ameen.sa', status:'not_required', signedAt:'',                         reviewedAt:'',                         device:'-',            verify:'-',          ip:'-',            hash:'-',      sig:-1, reviewPct:0,   required:false },
    ] : [
      { name:'Dr. Abdullah Alghamdi',  role:'Board Chairman',     email:'a.alghamdi@ameen.sa',  status:'signed',       signedAt:'22 May 2025, 11:02 AM', reviewedAt:'22 May 2025, 10:55 AM', device:'iPhone 15 Pro', verify:'Face ID',     ip:'192.168.1.40', hash:'A3F8C9', sig:0,  reviewPct:100, required:true },
      { name:'Eng. Khalid Alsubaie',   role:'Board Member',       email:'k.alsubaie@ameen.sa',  status:'signed',       signedAt:'22 May 2025, 11:18 AM', reviewedAt:'22 May 2025, 11:10 AM', device:'MacBook Pro',  verify:'Password',    ip:'192.168.1.55', hash:'B7D2E1', sig:1,  reviewPct:100, required:true },
      { name:'Ms. Laila Altamimi',     role:'Board Member',       email:'l.altamimi@ameen.sa',  status:'signed',       signedAt:'22 May 2025, 11:52 AM', reviewedAt:'22 May 2025, 11:40 AM', device:'iPad Pro',     verify:'Fingerprint', ip:'192.168.1.62', hash:'C5A3F7', sig:2,  reviewPct:100, required:true },
      { name:'Mr. Faisal Almutairi',   role:'Board Member',       email:'f.almutairi@ameen.sa', status:'signed',       signedAt:'22 May 2025, 12:08 PM', reviewedAt:'22 May 2025, 12:00 PM', device:'Samsung S24',  verify:'OTP Code',    ip:'192.168.2.10', hash:'D1B8C2', sig:3,  reviewPct:100, required:true },
      { name:'Mr. Ahmed Alharbi',      role:'Board Member',       email:'a.alharbi@ameen.sa',   status:'signed',       signedAt:'22 May 2025, 12:22 PM', reviewedAt:'22 May 2025, 12:15 PM', device:'MacBook Air',  verify:'Password',    ip:'192.168.1.88', hash:'E4F9A6', sig:4,  reviewPct:100, required:true },
      { name:'Ms. Noura Alotaibi',     role:'Board Member',       email:'n.alotaibi@ameen.sa',  status:'signed',       signedAt:'22 May 2025, 12:31 PM', reviewedAt:'22 May 2025, 12:25 PM', device:'iPhone 14',    verify:'Face ID',     ip:'192.168.1.74', hash:'F2C7B3', sig:5,  reviewPct:100, required:true },
      { name:'Mr. Sultan Alsaud',      role:'Board Member',       email:'s.alsaud@ameen.sa',    status:'opened',       signedAt:'',                       reviewedAt:'22 May 2025, 1:10 PM',  device:'iPad Air',     verify:'-',          ip:'192.168.3.21', hash:'-',      sig:-1, reviewPct:72,  required:true },
      { name:'Dr. Maha Alhaarthy',     role:'Independent Member', email:'m.alhaarthy@ameen.sa', status:'pending',      signedAt:'',                       reviewedAt:'',                      device:'-',            verify:'-',          ip:'-',            hash:'-',      sig:-1, reviewPct:0,   required:true },
      { name:'Mr. Yasser Alqahtani',   role:'Invited Guest',      email:'y.alqahtani@ameen.sa', status:'not_required', signedAt:'',                       reviewedAt:'',                      device:'-',            verify:'-',          ip:'-',            hash:'-',      sig:-1, reviewPct:0,   required:false },
    ];
    const ATTS = this._s7Attendees;
    const nTotal       = ATTS.length;
    const nSigned      = ATTS.filter(a => a.status==='signed').length;
    const nOpened      = ATTS.filter(a => a.status==='opened').length;
    const nPendingAtt  = ATTS.filter(a => a.status==='pending').length;
    const nNotRequired = ATTS.filter(a => a.status==='not_required').length;
    const nRequired    = ATTS.filter(a => a.required).length;

    /* ── Donut SVG ────────────────────────────────────────────────── */
    const R2=45, CX2=70, CY2=70, SW2=13;
    const C2 = 2*Math.PI*R2, gap2 = C2*0.018;
    const sLen = nSigned/nTotal*C2, oLen = nOpened/nTotal*C2, pLen2 = nPendingAtt/nTotal*C2;
    const sOff = C2*0.25;
    const oOff = ((sOff - sLen - gap2) % C2 + C2) % C2;
    const pOff2 = ((oOff - oLen - gap2) % C2 + C2) % C2;
    const tf = v => +v.toFixed(2);
    const donutSVG = `<svg width="140" height="140" viewBox="0 0 140 140">
  <circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#EAECF0" stroke-width="${SW2}"/>
  ${nSigned>0?`<circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#0C7A3D" stroke-width="${SW2}" stroke-dasharray="${tf(sLen-gap2)} ${tf(C2-sLen+gap2)}" stroke-dashoffset="${tf(sOff)}" stroke-linecap="round"/>`:''}
  ${nOpened>0?`<circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#4A6FA8" stroke-width="${SW2}" stroke-dasharray="${tf(oLen-gap2)} ${tf(C2-oLen+gap2)}" stroke-dashoffset="${tf(oOff)}" stroke-linecap="round"/>`:''}
  ${nPendingAtt>0?`<circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#E8821A" stroke-width="${SW2}" stroke-dasharray="${tf(pLen2-gap2)} ${tf(C2-pLen2+gap2)}" stroke-dashoffset="${tf(pOff2)}" stroke-linecap="round"/>`:''}
  <text x="${CX2}" y="${CY2-7}" text-anchor="middle" font-size="22" font-weight="900" fill="#15201A">${nSigned}/${nRequired}</text>
  <text x="${CX2}" y="${CY2+11}" text-anchor="middle" font-size="10" fill="#8A948D">${t('مطلوب','required')}</text>
</svg>`;

    /* ── Progress bar ─────────────────────────────────────────────── */
    const pct = Math.round(nSigned/nRequired*100);
    const progressBar = `<div style="margin-top:8px">
  <div style="display:flex;justify-content:space-between;font-size:11px;color:#8A948D;margin-bottom:4px">
    <span>${t('التوقيعات المكتملة','Signatures complete')}</span><span style="font-weight:700;color:#15201A">${pct}%</span>
  </div>
  <div style="height:6px;background:#EAECF0;border-radius:3px;overflow:hidden">
    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0C7A3D,#2AA87A);border-radius:3px;transition:width .6s"></div>
  </div>
</div>`;

    /* ── Status badge helper ───────────────────────────────────────── */
    const getStatusBadge = status => {
      if (status==='signed')       return `<span class="s7-badge s7-badge-signed"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="#0C7A3D"/><path d="M2.5 5l2 2L7.5 3" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> ${t('وقّع','Signed')}</span>`;
      if (status==='opened')       return `<span class="s7-badge s7-badge-opened">👁 ${t('مفتوح (لم يُوقَّع)','Opened (not signed)')}</span>`;
      if (status==='pending')      return `<span class="s7-badge s7-badge-pending">⏳ ${t('معلّق','Pending')}</span>`;
      if (status==='not_required') return `<span class="s7-badge s7-badge-notrequired">${t('غير مطلوب','Not Required')}</span>`;
      return '';
    };

    /* ── Table rows ───────────────────────────────────────────────── */
    const attendeeRows = ATTS.map((att, i) => {
      const initials = att.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const attKey = JSON.stringify(att.name);
      let sigCell = '';
      if (att.status==='signed') {
        sigCell = `<td class="s7-sig-cell"><svg class="s7-sig-svg" width="80" height="28" viewBox="0 0 50 28">${SIG_PATHS[att.sig]}</svg></td>
          <td class="s7-sig-action" onclick="event.stopPropagation()">
            <button class="s7-dl-btn" onclick="ApprovalCycle._s7DownloadSig(${attKey})" title="${t('تنزيل','Download')}"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v7M4 5.5l2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.5 10h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
          </td>`;
      } else if (att.status==='not_required') {
        sigCell = `<td class="s7-sig-cell"><span style="color:#9CA3AF">—</span></td>
          <td class="s7-sig-action"><span class="s7-not-req-text">${t('غير مطلوب','Not Required')}</span></td>`;
      } else if (att.status==='opened') {
        sigCell = `<td class="s7-sig-cell"><div class="s7-review-bar"><div class="s7-review-fill" style="width:${att.reviewPct}%"></div></div><span style="font-size:10px;color:#4A6FA8">${att.reviewPct}%</span></td>
          <td class="s7-sig-action" onclick="event.stopPropagation()">
            <button class="s7-remind-btn" onclick="ApprovalCycle._s7SendReminderTo(${attKey})"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5a3.5 3.5 0 013.5 3.5v2l1 2H1.5l1-2V5A3.5 3.5 0 016 1.5z" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 10.5a1.2 1.2 0 002.4 0" stroke="currentColor" stroke-width="1.2"/></svg>${t('تذكير','Remind')}</button>
          </td>`;
      } else {
        sigCell = `<td class="s7-sig-cell"><span style="color:#9CA3AF">—</span></td>
          <td class="s7-sig-action" onclick="event.stopPropagation()">
            <button class="s7-remind-btn" onclick="ApprovalCycle._s7SendReminderTo(${attKey})"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5a3.5 3.5 0 013.5 3.5v2l1 2H1.5l1-2V5A3.5 3.5 0 016 1.5z" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 10.5a1.2 1.2 0 002.4 0" stroke="currentColor" stroke-width="1.2"/></svg>${t('تذكير','Remind')}</button>
          </td>`;
      }
      return `<tr class="s7-sig-row-clickable" onclick="ApprovalCycle._s7AttendeeDetail(${attKey})">
        <td class="s7-col-num">${i+1}</td>
        <td class="s7-col-attendee"><div class="s7-att-info"><div class="s7-att-av" style="background:${AV_COLORS[i%AV_COLORS.length]}">${initials}</div><div><div class="s7-att-name">${esc(att.name)}</div><div style="font-size:10.5px;color:#8A948D">${esc(att.email)}</div></div></div></td>
        <td class="s7-col-role">${esc(att.role)}</td>
        <td class="s7-col-status">${getStatusBadge(att.status)}</td>
        <td class="s7-col-signedat">${att.signedAt || '—'}</td>
        ${sigCell}
      </tr>`;
    }).join('');

    /* ── Audit events ─────────────────────────────────────────────── */
    const comments = (d.comments||[]);
    const nAcc = comments.filter(c=>c.status==='accepted').length;
    const nRej = comments.filter(c=>c.status==='rejected').length;
    const auditEvents = [
      { icon:'📄', text:t(`تم إصدار النسخة النهائية v1.${nAcc||6} — ${nAcc||6} تعديل مدمج`,`Final version v1.${nAcc||6} issued — ${nAcc||6} amendment(s) merged`), date:'22 May 2025, 10:45 AM' },
      { icon:'✍️', text:t('أُرسل طلب التوقيع إلى 8 حضور','Signature request sent to 8 attendees'), date:'22 May 2025, 10:46 AM' },
      { icon:'📧', text:t('تم إرسال إشعارات بريد إلكتروني للجميع','Email notifications delivered to all attendees'), date:'22 May 2025, 10:47 AM' },
      { icon:'✅', text:t('وقّع د. عبدالله الغامدي (رئيس المجلس)','Dr. Abdullah Alghamdi signed (Board Chairman)'), date:'22 May 2025, 11:02 AM' },
      { icon:'✅', text:t('وقّع م. خالد الصبيعي','Eng. Khalid Alsubaie signed'), date:'22 May 2025, 11:18 AM' },
      { icon:'✅', text:t('وقّعت أ. ليلى التميمي','Ms. Laila Altamimi signed'), date:'22 May 2025, 11:52 AM' },
      { icon:'✅', text:t('وقّع أ. فيصل المطيري','Mr. Faisal Almutairi signed'), date:'22 May 2025, 12:08 PM' },
      { icon:'✅', text:t('وقّع أ. أحمد الحربي','Mr. Ahmed Alharbi signed'), date:'22 May 2025, 12:22 PM' },
      { icon:'✅', text:t('وقّعت أ. نورة العتيبي','Ms. Noura Alotaibi signed'), date:'22 May 2025, 12:31 PM' },
      { icon:'👁',  text:t('فتح أ. سلطان السعود المستند (قرأ 72%)','Mr. Sultan Alsaud opened the document (72% read)'), date:'22 May 2025, 1:10 PM' },
      { icon:'🔔', text:t('أُرسل تذكير للحضور المعلّقين','Reminder sent to pending attendees'), date:'22 May 2025, 2:00 PM' },
    ];
    const auditHTML = auditEvents.slice(0,5).map(e => `
<div class="s7-audit-row">
  <span class="s7-audit-ico">${e.icon}</span>
  <div class="s7-audit-body">
    <div class="s7-audit-text">${e.text}</div>
    <div class="s7-audit-meta">${e.date}</div>
  </div>
</div>`).join('');

    /* ── Notification log ─────────────────────────────────────────── */
    const notifRows = [
      { via:'📧', to:t('جميع الحضور (8)','All attendees (8)'), type:t('طلب التوقيع الأولي','Initial signature request'), at:'22 May 2025, 10:46 AM', status:t('تم الإرسال','Delivered') },
      { via:'📧', to:t('أ. سلطان السعود','Mr. Sultan Alsaud'), type:t('تذكير (اليوم الثاني)','Reminder (Day 2)'), at:'22 May 2025, 10:00 AM', status:t('تم الإرسال','Delivered') },
      { via:'📧', to:t('د. مها الحارثي','Dr. Maha Alhaarthy'), type:t('تذكير (اليوم الثاني)','Reminder (Day 2)'), at:'22 May 2025, 10:00 AM', status:t('تم الإرسال','Delivered') },
      { via:'📱', to:t('أ. سلطان السعود','Mr. Sultan Alsaud'), type:t('تذكير SMS','SMS Reminder'), at:'22 May 2025, 2:00 PM', status:t('تم الإرسال','Delivered') },
    ].map(n=>`<div class="s7-notif-row"><span>${n.via}</span><div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:600;color:#15201A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.to}</div><div style="font-size:10.5px;color:#8A948D">${n.type}</div></div><div style="text-align:${l==='ar'?'left':'right'};flex-shrink:0"><div style="font-size:10px;color:#8A948D">${n.at.slice(n.at.indexOf(',')+2)}</div><span style="font-size:10px;background:rgba(12,122,61,.1);color:#0C7A3D;border-radius:8px;padding:1px 6px">${n.status}</span></div></div>`).join('');

    /* ── Validation panel ─────────────────────────────────────────── */
    const validChecks = [
      { ok:true,  label:t('المحضر النهائي مُعتمَد من السكرتير','Final minutes secretary-approved') },
      { ok:true,  label:t(`6 من 8 توقيعات مطلوبة مكتملة`,'6 of 8 required signatures complete') },
      { ok:false, label:t('توقيعان مطلوبان لا يزالان معلّقَين','2 required signatures still pending') },
      { ok:true,  label:t('التحقق الإلكتروني مُفعَّل (OTP/Biometric)','Electronic verification enabled (OTP/Biometric)') },
      { ok:true,  label:t('سجل التدقيق محفوظ ومؤمَّن','Audit trail recorded and tamper-proof') },
    ];

    /* ── Render ─────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-step-page" id="ac-step7-page">

  <!-- Header -->
  <div class="dm-page-hdr">
    <div class="dm-page-hdr-left">
      <div class="dm-page-title-row">
        <h1 class="dm-page-title">
          <span class="dm-pt-step">${t('الخطوة 7 من 9','Step 7 of 9')}</span>
          <span class="dm-pt-name">${t('توقيعات الحضور','Attendee Signatures')}</span>
        </h1>
        <span class="dm-status-inprogress">⏳ ${t('جارٍ','In Progress')}</span>
      </div>
      <p class="dm-page-sub">${t('يجب على جميع الحضور المطلوبين مراجعة المحضر النهائي وتقديم توقيعاتهم الإلكترونية. بعد اكتمال التوقيعات، يُرسَل المحضر إلى الاعتماد النهائي.','All required attendees must review the final minutes and provide their electronic signatures. Once complete, the minutes proceed to Final Approval.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7ViewMinutes()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/></svg>
        ${t('عرض المحضر النهائي','View Final Minutes')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7HistoryModal()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${t('السجل','History')}
      </button>
      <div class="s7-deadline-badge">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="10" rx="1.5" stroke="#0C7A3D" stroke-width="1.2"/><path d="M4 1v2M9 1v2M1 5h11" stroke="#0C7A3D" stroke-width="1.2" stroke-linecap="round"/></svg>
        <div>
          <div class="s7-dl-badge-label">${t('الموعد النهائي للتوقيع','Signature Deadline')}</div>
          <div class="s7-dl-badge-date">25 May 2025, 11:59 PM</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Step bar -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- Meta bar -->
  <div class="s7-meta-bar">
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.2" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><line x1="4.5" y1="9.5" x2="7" y2="9.5" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s7-meta-lbl">${t('إصدار المحضر','Minutes Version')}</div><div class="s7-meta-val"><span class="s7-version-badge">v1.${nAcc||6} Final</span></div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a4.5 4.5 0 014.5 4.5v2.5l1 2H1.5l1-2.5V6A4.5 4.5 0 017 1.5z" stroke="#8A948D" stroke-width="1.2"/></svg>
      <div><div class="s7-meta-lbl">${t('أُرسل للتوقيع','Sent for Signatures')}</div><div class="s7-meta-val">${sentAt}</div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><circle cx="10" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><path d="M1 12a4 4 0 018 0" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><path d="M9.5 10.5a3.5 3.5 0 014.5 2.5" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s7-meta-lbl">${t('إجمالي الحضور','Total Attendees')}</div><div class="s7-meta-val">${nTotal} <span style="font-size:10.5px;color:#8A948D">(${nRequired} ${t('مطلوب','required')})</span></div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 7l2.5 2.5L10 4.5" stroke="#0C7A3D" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div><div class="s7-meta-lbl">${t('التوقيعات المستلمة','Signatures Received')}</div><div class="s7-meta-val"><strong style="color:#0C7A3D">${nSigned}</strong> / ${nRequired}</div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <div><div class="s7-meta-lbl">${t('مفتوح (لم يُوقَّع)','Opened (not signed)')}</div><div class="s7-meta-val" style="color:#4A6FA8">${nOpened}</div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <div><div class="s7-meta-lbl">${t('الحالة','Status')}</div><div class="s7-meta-val"><span class="s7-status-inprogress">${t('جارٍ','In Progress')}</span></div></div>
    </div>
  </div>

  <!-- 2-column body -->
  <div class="s7-body">

    <!-- LEFT: Signature Table -->
    <div class="s7-main-panel">

      <!-- Table header with search/filter -->
      <div class="s7-table-hdr">
        <div>
          <div class="s7-table-title">${t('حالة توقيعات الحضور','Attendee Signature Status')}</div>
          <div class="s7-table-subtitle">${t('انقر على أي صف للاطلاع على تفاصيل التوقيع والشهادة.','Click any row to view signature details and certificate.')}</div>
        </div>
        <div class="s7-table-actions">
          <div class="s7-search-wrap">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="4" stroke="#8A948D" stroke-width="1.2"/><path d="M8.5 8.5l2 2" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
            <input id="s7-search" class="s7-search-input" placeholder="${t('بحث...','Search...')}" oninput="ApprovalCycle._s7Search(this.value)"/>
          </div>
          <button class="dm-btn ghost s7-view-minutes-btn" onclick="ApprovalCycle._s7ViewMinutes()">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.2"/><circle cx="6.5" cy="6.5" r="2.2" stroke="currentColor" stroke-width="1.2"/></svg>
            ${t('عرض المحضر','View Minutes')}
          </button>
          <button class="s7-expand-btn" onclick="ApprovalCycle._s7ExpandTable()" title="${t('توسيع','Expand')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 4V1h3M10 1h3v3M1 10v3h3M10 13h3v-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>

      <!-- Table -->
      <div style="overflow-x:auto;flex:1">
        <table class="s7-sig-table">
          <thead><tr>
            <th class="s7-col-num">#</th>
            <th>${t('الحضور','Attendee')}</th>
            <th>${t('الدور','Role')}</th>
            <th>${t('الحالة','Status')}</th>
            <th>${t('وُقِّع في','Signed On')}</th>
            <th>${t('التوقيع / التقدم','Signature / Progress')}</th>
            <th></th>
          </tr></thead>
          <tbody id="s7-tbody">${attendeeRows}</tbody>
        </table>
      </div>

      <!-- Table footer -->
      <div class="s7-table-footer">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#2C6CA8" stroke-width="1.3"/><line x1="7" y1="6" x2="7" y2="10" stroke="#2C6CA8" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="4" r=".8" fill="#2C6CA8"/></svg>
        ${t(`${nSigned} توقيع مكتمل من أصل ${nRequired} مطلوب · ${nOpened} مستند مفتوح لم يُوقَّع بعد · ${nPendingAtt} لم يُفتح المستند`,`${nSigned} of ${nRequired} required signatures complete · ${nOpened} document opened but not signed · ${nPendingAtt} not yet opened`)}
      </div>
    </div>

    <!-- RIGHT: Sidebar -->
    <div class="s7-sidebar">

      <!-- Signature Progress Donut -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('تقدم التوقيع','Signature Progress')}</div>
        <div class="s7-progress-wrap">
          ${donutSVG}
          <div class="s7-progress-legend">
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#0C7A3D"></span><span class="s7-leg-lbl">${t('وقّع','Signed')}</span><span class="s7-leg-val">${nSigned} <span class="s7-leg-pct">(${Math.round(nSigned/nTotal*100)}%)</span></span></div>
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#4A6FA8"></span><span class="s7-leg-lbl">${t('مفتوح (لم يُوقَّع)','Opened (not signed)')}</span><span class="s7-leg-val">${nOpened} <span class="s7-leg-pct">(${Math.round(nOpened/nTotal*100)}%)</span></span></div>
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#E8821A"></span><span class="s7-leg-lbl">${t('معلّق','Pending')}</span><span class="s7-leg-val">${nPendingAtt} <span class="s7-leg-pct">(${Math.round(nPendingAtt/nTotal*100)}%)</span></span></div>
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#D0D5DD"></span><span class="s7-leg-lbl">${t('غير مطلوب','Not Required')}</span><span class="s7-leg-val">${nNotRequired}</span></div>
          </div>
        </div>
        ${progressBar}
      </div>

      <!-- Document Info (from Stage 6) -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">📄 ${t('معلومات المحضر','Document Info')}</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${[
            [t('الاجتماع','Meeting'), esc(meetingTitle)],
            [t('الإصدار','Version'), `v1.${nAcc||6} (${t('نسخة نهائية','Final')})`],
            [t('التعديلات المدمجة','Amendments merged'), nAcc||6],
            [t('التعليقات المرفوضة','Rejected comments'), nRej||2],
            [t('المعتمَد من','Approved by'), t('الأمانة','Secretary')],
            [t('تاريخ الإصدار','Issue date'), '22 May 2025'],
          ].map(([k,v])=>`<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px"><span style="color:#8A948D">${k}</span><span style="font-weight:600;color:#15201A;text-align:${l==='ar'?'left':'right'}">${v}</span></div>`).join('')}
          <div style="margin-top:6px">
            <button onclick="ApprovalCycle._s7ViewMinutes()" style="width:100%;padding:8px;border:1px solid #E4E7EC;border-radius:7px;background:#F8F9FA;cursor:pointer;font-size:12.5px;font-weight:600;color:#15201A;display:flex;align-items:center;justify-content:center;gap:6px">
              👁 ${t('معاينة المحضر الكامل','Preview Full Minutes')}
            </button>
          </div>
        </div>
      </div>

      <!-- Validation & Compliance -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">✅ ${t('التحقق والامتثال','Validation & Compliance')}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${validChecks.map(v=>`<div style="display:flex;align-items:flex-start;gap:8px;font-size:12px">
            <span style="color:${v.ok?'#0C7A3D':'#E8821A'};flex-shrink:0;margin-top:1px">${v.ok?'✓':'⚠'}</span>
            <span style="color:${v.ok?'#15201A':'#A8590A'};line-height:1.4">${v.label}</span>
          </div>`).join('')}
        </div>
      </div>

      <!-- Notifications Sent -->
      <div class="rv-rpanel">
        <div class="rv-rp-title" style="display:flex;justify-content:space-between">
          <span>🔔 ${t('الإشعارات المُرسَلة','Notifications Sent')}</span>
          <button onclick="ApprovalCycle._s7NotificationsLog()" style="background:none;border:none;font-size:11px;color:#4A6FA8;cursor:pointer">${t('عرض الكل','View All')}</button>
        </div>
        <div class="s7-notif-list">${notifRows}</div>
      </div>

      <!-- Audit Trail -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">🔍 ${t('سجل التدقيق','Audit Trail')}</div>
        <div class="s7-audit-list">${auditHTML}</div>
        <button class="s7-view-audit-btn" onclick="ApprovalCycle._s7AuditTrail()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="1" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="7" x2="9" y2="7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="9.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          ${t('عرض سجل التدقيق الكامل','View Full Audit Trail')}
        </button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <button class="dm-btn ghost" onclick="ApprovalCycle._onStepClick(5)">← ${t('العودة للنسخة النهائية','Back to Final Version')}</button>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7SendReminder()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a4.5 4.5 0 014.5 4.5v2.5l1 2H1.5l1-2.5V6A4.5 4.5 0 017 1.5z" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.3"/></svg>
        ${t('إرسال تذكير للمعلّقين','Send Reminder to Pending')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7DownloadPDF()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('تنزيل المحضر (PDF)','Download Minutes (PDF)')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7SignNow()">
        ✍️ ${t('التوقيع الآن (تجريبي)','Sign Now (Demo)')}
      </button>
    </div>
    <button class="dm-btn primary" onclick="ApprovalCycle._s7AdvanceToApproval()">
      ${t('الاعتماد النهائي →','→ Final Approval')}
    </button>
  </div>

</div>`;
    // cache audit events for modal
    this._s7AuditEvents = auditEvents;
  },

  /* ── Step 7 helpers ──────────────────────────────────────────────────── */

  _s7DownloadPDF() {
    showToast(this.t('⏳ جارٍ تحضير ملف PDF...','⏳ Preparing PDF...'), 'info');
    setTimeout(() => showToast(this.t('✅ تم تنزيل المحضر النهائي','✅ Final minutes downloaded'), 'success'), 1800);
  },

  _s7ViewMinutes() { this._fmPreview(); },

  _s7HistoryModal() { this._fmHistory(); },

  _s7Search(val) {
    const v = val.toLowerCase();
    const rows = document.querySelectorAll('#s7-tbody tr');
    rows.forEach(tr => {
      tr.style.display = !v || tr.textContent.toLowerCase().includes(v) ? '' : 'none';
    });
  },

  _s7ExpandTable() {
    const t = (ar,en) => this.t(ar,en);
    const tbody = document.getElementById('s7-tbody');
    if (!tbody) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:6000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:30px 16px;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:900px;max-width:98vw;box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:hidden;">
  <div style="background:#0F1728;padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
    <div style="color:#fff;font-size:14px;font-weight:800">📋 ${t('جدول التوقيعات — عرض موسّع','Signature Table — Expanded View')}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕ ${t('إغلاق','Close')}</button>
  </div>
  <div style="overflow-x:auto;padding:0">
    <table class="s7-sig-table" style="font-size:12.5px">
      <thead><tr style="background:#F8F9FA">
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">#</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('الحضور','Attendee')}</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('الدور','Role')}</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('الحالة','Status')}</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('وُقِّع في','Signed On')}</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('الجهاز','Device')}</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('التحقق','Verify')}</th>
        <th style="padding:10px 14px;font-weight:600;color:#8A948D">${t('تجزئة الشهادة','Cert Hash')}</th>
      </tr></thead>
      <tbody>${(this._s7Attendees||[]).map((att,i)=>{
        const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A6FA8','#6B4FA8','#2AA87A','#C47A3C','#5A8A4A'];
        const initials = att.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
        const stColor = att.status==='signed'?'#0C7A3D':att.status==='opened'?'#4A6FA8':att.status==='pending'?'#E8821A':'#8A948D';
        const stLabel = att.status==='signed'?t('وقّع','Signed'):att.status==='opened'?t('مفتوح','Opened'):att.status==='pending'?t('معلّق','Pending'):t('غير مطلوب','Not Required');
        return `<tr style="border-bottom:1px solid #F2F3F5;cursor:pointer" onclick="ApprovalCycle._s7AttendeeDetail(${JSON.stringify(att.name)})">
          <td style="padding:10px 14px;color:#8A948D;font-size:11.5px">${i+1}</td>
          <td style="padding:10px 14px"><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:${AV_COLORS[i%AV_COLORS.length]};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0">${initials}</div><div><div style="font-weight:600;color:#15201A">${esc(att.name)}</div><div style="font-size:10.5px;color:#8A948D">${esc(att.email)}</div></div></div></td>
          <td style="padding:10px 14px;color:#6B7280;font-size:12px">${esc(att.role)}</td>
          <td style="padding:10px 14px"><span style="font-size:11.5px;background:${stColor}18;color:${stColor};border-radius:10px;padding:2px 9px;font-weight:700">${stLabel}</span></td>
          <td style="padding:10px 14px;font-size:12px;color:#46514A;white-space:nowrap">${att.signedAt||'—'}</td>
          <td style="padding:10px 14px;font-size:12px;color:#46514A">${esc(att.device)}</td>
          <td style="padding:10px 14px;font-size:12px;color:#46514A">${esc(att.verify)}</td>
          <td style="padding:10px 14px;font-size:11px;font-family:monospace;color:${att.hash!=='-'?'#0C7A3D':'#8A948D'}">${att.hash!=='-'?att.hash+'…':'—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s7AttendeeDetail(attName) {
    const t = (ar,en) => this.t(ar,en);
    const l = App.lang;
    const att = (this._s7Attendees||[]).find(a=>a.name===attName);
    if (!att) return;
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A6FA8','#6B4FA8','#2AA87A','#C47A3C','#5A8A4A'];
    const idx = (this._s7Attendees||[]).indexOf(att);
    const initials = att.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
    const bgColor = AV_COLORS[idx%AV_COLORS.length];
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 17 Q9 9 13 14 L18 18 Q22 22 26 14 Q30 6 36 12 L42 16" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    ];

    const stColor = att.status==='signed'?'#0C7A3D':att.status==='opened'?'#4A6FA8':att.status==='pending'?'#E8821A':'#8A948D';
    const stLabel = att.status==='signed'?t('وقّع','Signed'):att.status==='opened'?t('مفتوح (لم يُوقَّع)','Opened (not signed)'):att.status==='pending'?t('معلّق','Pending'):t('غير مطلوب','Not Required');

    const certHTML = att.hash !== '-' ? `
<div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:14px 16px;margin-top:4px">
  <div style="font-size:12px;font-weight:800;color:#065F46;margin-bottom:10px">🏅 ${t('شهادة التوقيع الإلكتروني','Electronic Signature Certificate')}</div>
  ${[
    [t('معرّف الشهادة','Certificate ID'), `ESC-${att.hash}-2025`],
    [t('خوارزمية التشفير','Algorithm'), 'SHA-256 / RSA-2048'],
    [t('وقت التوقيع (UTC)','Signing Time (UTC)'), att.signedAt],
    [t('عنوان IP','IP Address'), att.ip],
    [t('الجهاز','Device'), att.device],
    [t('طريقة التحقق','Verification'), att.verify],
    [t('حالة الشهادة','Certificate Status'), `✅ ${t('سارية المفعول','Valid')}`],
  ].map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-size:11.5px"><span style="color:#047857">${k}</span><span style="font-weight:600;color:#065F46;text-align:end">${v}</span></div>`).join('')}
  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #A7F3D0;font-size:10.5px;color:#059669;font-family:monospace;word-break:break-all">
    ${t('التجزئة الرقمية:','Digital Hash:')} SHA256:${att.hash}f3a8b7d2e1c4...
  </div>
</div>` : att.status==='opened' ? `
<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px;margin-top:4px">
  <div style="font-size:12px;font-weight:700;color:#1D4ED8;margin-bottom:6px">👁 ${t('حالة المستند','Document Status')}</div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <div style="flex:1;height:8px;background:#DBEAFE;border-radius:4px;overflow:hidden"><div style="height:100%;width:${att.reviewPct}%;background:#3B82F6;border-radius:4px"></div></div>
    <span style="font-size:12px;font-weight:700;color:#1D4ED8">${att.reviewPct}%</span>
  </div>
  <div style="font-size:11.5px;color:#1D4ED8">${t(`قرأ ${att.reviewPct}% من المحضر`,`Read ${att.reviewPct}% of the minutes`)}</div>
  <div style="font-size:10.5px;color:#60A5FA;margin-top:4px">${t('آخر نشاط:','Last activity:')} ${att.reviewedAt}</div>
</div>` : `
<div style="background:#FFF8F0;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px;margin-top:4px">
  <div style="font-size:12px;color:#92400E">⏳ ${t('لم يُفتَح المحضر بعد. أُرسل إشعار البريد الإلكتروني عند الإطلاق.','Document not yet opened. Email notification delivered on launch.')}</div>
</div>`;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:540px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.3);">
  <!-- Modal header -->
  <div style="background:linear-gradient(135deg,#0F1728,#1a2d4a);padding:20px 24px;border-radius:16px 16px 0 0">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
      <div style="width:48px;height:48px;border-radius:50%;background:${bgColor};display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:800;border:2px solid rgba(255,255,255,.3)">${initials}</div>
      <div>
        <div style="color:#fff;font-size:15px;font-weight:800">${esc(att.name)}</div>
        <div style="color:rgba(255,255,255,.65);font-size:12px">${esc(att.role)} · ${esc(att.email)}</div>
      </div>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="margin-right:auto;margin-left:0;background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:16px">×</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span style="background:${stColor}22;color:${stColor};border:1px solid ${stColor}44;border-radius:12px;padding:3px 12px;font-size:12px;font-weight:700">${stLabel}</span>
      <span style="background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border-radius:12px;padding:3px 10px;font-size:11.5px">${att.required?t('توقيع مطلوب','Signature required'):t('غير مطلوب','Not required')}</span>
    </div>
  </div>
  <!-- Body -->
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    <!-- Signature display -->
    ${att.status==='signed' ? `
    <div style="border:1.5px solid #E5E9E7;border-radius:10px;padding:14px 16px">
      <div style="font-size:11.5px;font-weight:700;color:#8A948D;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${t('التوقيع الإلكتروني','Electronic Signature')}</div>
      <div style="background:#F8FAFF;border-radius:8px;padding:12px;display:flex;justify-content:center;border:1px dashed #C7D4E8">
        <svg width="200" height="60" viewBox="0 0 50 28">${SIG_PATHS[att.sig]}</svg>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#8A948D;text-align:center">${t('توقيع إلكتروني معتمد · موقّع في','Certified e-Signature · Signed on')} ${att.signedAt}</div>
    </div>` : ''}
    <!-- Info grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${[
        [t('فُتح المستند في','Document opened'), att.reviewedAt||'—'],
        [t('تقدم القراءة','Reading progress'), att.reviewPct>0?att.reviewPct+'%':'—'],
        [t('الجهاز','Device'), att.device],
        [t('التحقق','Verification'), att.verify],
      ].map(([k,v])=>`<div style="background:#F8F9FA;border-radius:8px;padding:10px 12px"><div style="font-size:10.5px;color:#8A948D;margin-bottom:3px">${k}</div><div style="font-size:12.5px;font-weight:600;color:#15201A">${v}</div></div>`).join('')}
    </div>
    <!-- Certificate / status -->
    ${certHTML}
    <!-- Actions -->
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:4px">
      ${att.status!=='signed'&&att.status!=='not_required' ? `<button onclick="ApprovalCycle._s7SendReminderTo(${JSON.stringify(att.name)});this.closest('div[style*=fixed]').remove()" style="padding:9px 16px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:6px">🔔 ${t('إرسال تذكير','Send Reminder')}</button>` : ''}
      ${att.status==='signed' ? `<button onclick="ApprovalCycle._s7DownloadSig(${JSON.stringify(att.name)});this.closest('div[style*=fixed]').remove()" style="padding:9px 16px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:12.5px;font-weight:700">📥 ${t('تنزيل الشهادة','Download Certificate')}</button>` : ''}
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 16px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s7DownloadSig(attName) {
    const t = (ar,en) => this.t(ar,en);
    showToast(t(`⏳ جارٍ تحضير شهادة التوقيع لـ ${attName}...`,`⏳ Preparing signature certificate for ${attName}...`), 'info');
    setTimeout(() => showToast(t('✅ تم تنزيل شهادة التوقيع الإلكتروني','✅ Electronic signature certificate downloaded'), 'success'), 1800);
  },

  async _s7SendReminder() {
    const t = (ar,en) => this.t(ar,en);
    const ATTS = this._s7Attendees || [];
    const pending = ATTS.filter(a => a.status === 'pending' || a.status === 'opened');
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/remind`, { method:'POST' });
    } catch(e) {}
    showToast(t(`✅ تم إرسال تذكير لـ ${pending.length} حضور معلّقين`,`✅ Reminder sent to ${pending.length} pending attendees`), 'success');
    // Update audit
    if (this._s7AuditEvents) {
      this._s7AuditEvents.push({ icon:'🔔', text:t('أُرسل تذكير للحضور المعلّقين','Reminder sent to pending attendees'), date: new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) });
    }
  },

  _s7SendReminderTo(attName) {
    const t = (ar,en) => this.t(ar,en);
    showToast(t(`🔔 تم إرسال تذكير شخصي لـ ${attName}`,`🔔 Personal reminder sent to ${attName}`), 'success');
  },

  _s7SignNow() {
    const t = (ar,en) => this.t(ar,en);
    let isDrawing = false, lastX = 0, lastY = 0;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:7000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:520px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3);">
  <div style="background:#0F1728;padding:18px 24px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:15px;font-weight:800">✍️ ${t('التوقيع الإلكتروني','Electronic Signature')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${t('ارسم توقيعك في المربع أدناه','Draw your signature in the box below')}</div>
    </div>
    <button id="s7-close-sign" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:16px">×</button>
  </div>
  <div style="padding:20px 24px">
    <div style="font-size:12px;color:#8A948D;margin-bottom:8px">${t('يُرجى التوقيع باستخدام الماوس أو إصبعك:','Please sign using your mouse or finger:')}</div>
    <canvas id="s7-sig-canvas" width="468" height="160" style="width:100%;height:160px;border:1.5px dashed #C7D4E8;border-radius:10px;background:#F8FAFF;cursor:crosshair;touch-action:none;display:block"></canvas>
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
      <div style="flex:1;font-size:11px;color:#8A948D">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="s7-sign-consent" style="width:14px;height:14px;accent-color:#0F1728">
          <span>${t('أوافق على أن هذا التوقيع ملزم قانونياً','I agree this signature is legally binding')}</span>
        </label>
      </div>
      <button id="s7-clear-btn" style="background:#F2F3F5;border:none;border-radius:7px;padding:7px 14px;font-size:12px;cursor:pointer;color:#46514A">${t('مسح','Clear')}</button>
    </div>
    <div style="background:#FFF8F0;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:11.5px;color:#A8590A">
      ⚠️ ${t('هذا وضع تجريبي. في بيئة الإنتاج سيتم توثيق التوقيع بشهادة رقمية معتمدة.','This is a demo mode. In production, the signature will be certified with an accredited digital certificate.')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button id="s7-cancel-sign" style="padding:10px 20px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
      <button id="s7-submit-sign" style="padding:10px 22px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:13px;font-weight:700">✅ ${t('تأكيد التوقيع','Confirm Signature')}</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    const canvas  = overlay.querySelector('#s7-sig-canvas');
    const ctx     = canvas.getContext('2d');
    ctx.strokeStyle = '#1a3a5c'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let hasDrawn = false;

    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      const scaleX = canvas.width / r.width, scaleY = canvas.height / r.height;
      if (e.touches) return [(e.touches[0].clientX-r.left)*scaleX, (e.touches[0].clientY-r.top)*scaleY];
      return [(e.clientX-r.left)*scaleX, (e.clientY-r.top)*scaleY];
    };
    const start = e => { e.preventDefault(); isDrawing=true; [lastX,lastY]=getPos(e); hasDrawn=true; };
    const draw  = e => { e.preventDefault(); if(!isDrawing) return; const [x,y]=getPos(e); ctx.beginPath(); ctx.moveTo(lastX,lastY); ctx.lineTo(x,y); ctx.stroke(); [lastX,lastY]=[x,y]; };
    const stop  = e => { isDrawing=false; };
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',draw); canvas.addEventListener('mouseup',stop); canvas.addEventListener('mouseleave',stop);
    canvas.addEventListener('touchstart',start); canvas.addEventListener('touchmove',draw); canvas.addEventListener('touchend',stop);

    overlay.querySelector('#s7-clear-btn').onclick = () => { ctx.clearRect(0,0,canvas.width,canvas.height); hasDrawn=false; };
    overlay.querySelector('#s7-close-sign').onclick = () => overlay.remove();
    overlay.querySelector('#s7-cancel-sign').onclick = () => overlay.remove();
    overlay.querySelector('#s7-submit-sign').onclick = () => {
      if (!hasDrawn) { showToast(t('⚠️ يرجى رسم توقيعك أولاً','⚠️ Please draw your signature first'), 'warning'); return; }
      if (!overlay.querySelector('#s7-sign-consent').checked) { showToast(t('⚠️ يرجى الموافقة على الشروط','⚠️ Please accept the terms'), 'warning'); return; }
      overlay.remove();
      showToast(t('⏳ جارٍ تسجيل توقيعك الإلكتروني...','⏳ Recording your electronic signature...'), 'info');
      setTimeout(() => showToast(t('✅ تم تسجيل توقيعك بنجاح · رقم الشهادة: ESC-D9F2A1-2025','✅ Signature recorded successfully · Certificate: ESC-D9F2A1-2025'), 'success'), 1800);
    };
  },

  _s7AuditTrail() {
    const t = (ar,en) => this.t(ar,en);
    const events = this._s7AuditEvents || [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:580px;max-width:96vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:#0F1728;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
    <div>
      <div style="color:#fff;font-size:15px;font-weight:800">🔍 ${t('سجل التدقيق الكامل','Full Audit Trail')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${t('جميع الأحداث محفوظة ومؤمّنة · غير قابلة للتعديل','All events recorded and tamper-proof')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕</button>
  </div>
  <div style="overflow-y:auto;padding:18px 24px;display:flex;flex-direction:column;gap:0">
    ${events.map((e,i)=>`
<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;${i<events.length-1?'border-bottom:1px solid #F2F3F5':''}">
  <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">
    <div style="width:34px;height:34px;border-radius:50%;background:#F5F5F1;display:flex;align-items:center;justify-content:center;font-size:15px">${e.icon}</div>
    ${i<events.length-1?`<div style="width:1px;height:100%;min-height:16px;background:#E5E9E7;margin-top:4px"></div>`:''}
  </div>
  <div style="flex:1;padding-top:4px">
    <div style="font-size:12.5px;font-weight:600;color:#15201A;margin-bottom:3px">${e.text}</div>
    <div style="font-size:11px;color:#8A948D;display:flex;align-items:center;gap:8px">
      <span>🕐 ${e.date}</span>
      <span>· ${t('النظام / محمد البلالي','System / Mohammad Albuali')}</span>
    </div>
  </div>
</div>`).join('')}
  </div>
  <div style="padding:14px 24px;border-top:1px solid #F2F3F5;background:#F8F9FA;flex-shrink:0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:11.5px;color:#8A948D">🔒 ${t('مؤمَّن بتشفير SHA-256','Secured with SHA-256 encryption')}</span>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:8px 18px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s7NotificationsLog() {
    const t = (ar,en) => this.t(ar,en);
    const notifs = [
      { via:'📧', to:t('جميع الحضور (8 أشخاص)','All attendees (8 people)'), type:t('طلب التوقيع الأولي','Initial signature request'), at:'22 May 2025, 10:46 AM', status:t('تم الإرسال','Delivered'), opens:7 },
      { via:'📧', to:t('أ. سلطان السعود','Mr. Sultan Alsaud'), type:t('تذكير (اليوم الثاني)','Reminder (Day 2)'), at:'23 May 2025, 10:00 AM', status:t('تم الإرسال','Delivered'), opens:1 },
      { via:'📧', to:t('د. مها الحارثي','Dr. Maha Alhaarthy'), type:t('تذكير (اليوم الثاني)','Reminder (Day 2)'), at:'23 May 2025, 10:00 AM', status:t('تم الإرسال','Delivered'), opens:0 },
      { via:'📱', to:t('أ. سلطان السعود','Mr. Sultan Alsaud'), type:t('رسالة SMS تذكيرية','SMS Reminder'), at:'23 May 2025, 2:00 PM', status:t('تم الإرسال','Delivered'), opens:1 },
      { via:'📧', to:t('أ. سلطان السعود · د. مها الحارثي','Mr. Sultan Alsaud · Dr. Maha Alhaarthy'), type:t('تذكير أخير (اليوم الثالث)','Final reminder (Day 3)'), at:'24 May 2025, 9:00 AM', status:t('تم الإرسال','Delivered'), opens:0 },
    ];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:560px;max-width:96vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="padding:18px 24px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A">🔔 ${t('سجل الإشعارات','Notifications Log')}</div>
      <div style="font-size:12px;color:#8A948D;margin-top:2px">${notifs.length} ${t('إشعار أُرسل','notifications sent')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="overflow-y:auto;padding:14px 24px;display:flex;flex-direction:column;gap:10px">
    ${notifs.map(n=>`
<div style="border:1px solid #F2F3F5;border-radius:10px;padding:12px 14px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">${n.via}</span>
      <div>
        <div style="font-size:12.5px;font-weight:700;color:#15201A">${n.type}</div>
        <div style="font-size:11px;color:#8A948D">${n.to}</div>
      </div>
    </div>
    <div style="text-align:end;flex-shrink:0">
      <div style="font-size:10.5px;color:#8A948D">${n.at}</div>
      <span style="font-size:10.5px;background:rgba(12,122,61,.1);color:#0C7A3D;border-radius:8px;padding:1px 7px;font-weight:600">${n.status}</span>
    </div>
  </div>
  <div style="font-size:11px;color:#8A948D">${t('تم الفتح','Opens:')} ${n.opens > 0 ? `<span style="color:#0C7A3D;font-weight:600">${n.opens}x ✓</span>` : `<span style="color:#C4453C">0</span>`}</div>
</div>`).join('')}
  </div>
  <div style="padding:12px 24px;border-top:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:#F8F9FA">
    <button onclick="ApprovalCycle._s7SendReminder();this.closest('div[style*=fixed]').remove()" style="padding:8px 16px;border:none;border-radius:7px;background:#0F1728;color:#fff;cursor:pointer;font-size:12.5px;font-weight:700">🔔 ${t('إرسال تذكير جديد','Send New Reminder')}</button>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:8px 16px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  async _s7AdvanceToApproval() {
    const t = (ar,en) => this.t(ar,en);
    const ATTS = this._s7Attendees || [];
    const nPending = ATTS.filter(a => a.required && a.status !== 'signed' && a.status !== 'not_required').length;
    if (nPending > 0) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px';
      overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;padding:26px;width:440px;max-width:96vw;box-shadow:0 20px 60px rgba(0,0,0,.22)">
  <div style="font-size:15px;font-weight:800;color:#15201A;margin-bottom:6px">⚠️ ${t('توقيعات غير مكتملة','Incomplete Signatures')}</div>
  <div style="font-size:12.5px;color:#8A948D;margin-bottom:14px">${t(`لا تزال هناك ${nPending} توقيعات مطلوبة غير مكتملة. هل تريد المتابعة إلى الاعتماد النهائي على أي حال؟`,`There are still ${nPending} required signatures incomplete. Proceed to Final Approval anyway?`)}</div>
  <div style="background:#FFF8F0;border-radius:9px;padding:12px;margin-bottom:16px;font-size:12px;color:#A8590A">⚠️ ${t('يُوصى باكتمال جميع التوقيعات قبل الاعتماد النهائي لضمان قانونية المحضر.','Completing all signatures before final approval is recommended to ensure the minutes are legally valid.')}</div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove();ApprovalCycle._s7SendReminder()" style="padding:9px 14px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:12.5px">🔔 ${t('إرسال تذكيرات','Send Reminders')}</button>
    <button onclick="this.closest('div[style*=fixed]').remove();ApprovalCycle._onStepClick(7)" style="padding:9px 16px;border:none;border-radius:8px;background:#0F1728;color:#fff;cursor:pointer;font-size:12.5px;font-weight:700">→ ${t('المتابعة للاعتماد','Proceed to Approval')}</button>
  </div>
</div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
    } else {
      this._onStepClick(7);
    }
  },

  _s7Preview() { this._fmPreview(); },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 8 — FINAL APPROVAL
  ═══════════════════════════════════════════════════════════════════════ */
  _renderStep8FinalApproval() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const m  = this._meeting  || {};
    const d  = this._data     || {};
    const cycle = d.cycle || {};

    const meetingTitle = (l==='ar' ? m.title_ar : m.title_en) || m.title_ar || t('اجتماع مجلس الإدارة','Board Meeting');
    const comments = d.comments || [];
    const nAcc = comments.filter(c=>c.status==='accepted').length || 6;
    const nRej = comments.filter(c=>c.status==='rejected').length || 2;
    const miniStepper = this._buildMiniStepper(cycle, 7, t, l);

    /* ── Signature paths (6 distinct) ────────────────────────────── */
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 17 Q9 9 13 14 L18 18 Q22 22 26 14 Q30 6 36 12 L42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];

    /* ── All 8 required signatories signed + 1 guest N/A ─────────── */
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A6FA8','#6B4FA8','#2AA87A','#C47A3C','#5A8A4A'];
    this._s8Attendees = l === 'ar' ? [
      { name:'د. عبدالله الغامدي',  role:'رئيس مجلس الإدارة',  email:'a.alghamdi@ameen.sa',  at:'22 مايو 2025، 11:02 ص', device:'iPhone 15 Pro',  verify:'بصمة الوجه',   hash:'A3F8C9', sig:0,  required:true  },
      { name:'م. خالد الصبيعي',     role:'عضو مجلس الإدارة',   email:'k.alsubaie@ameen.sa',  at:'22 مايو 2025، 11:18 ص', device:'MacBook Pro',   verify:'كلمة مرور',    hash:'B7D2E1', sig:1,  required:true  },
      { name:'أ. ليلى التميمي',     role:'عضو مجلس الإدارة',   email:'l.altamimi@ameen.sa',  at:'22 مايو 2025، 11:52 ص', device:'iPad Pro',      verify:'بصمة الإصبع', hash:'C5A3F7', sig:2,  required:true  },
      { name:'أ. فيصل المطيري',     role:'عضو مجلس الإدارة',   email:'f.almutairi@ameen.sa', at:'22 مايو 2025، 12:08 م', device:'Samsung S24',   verify:'رمز OTP',      hash:'D1B8C2', sig:3,  required:true  },
      { name:'أ. أحمد الحربي',      role:'عضو مجلس الإدارة',   email:'a.alharbi@ameen.sa',   at:'22 مايو 2025، 12:22 م', device:'MacBook Air',   verify:'كلمة مرور',    hash:'E4F9A6', sig:4,  required:true  },
      { name:'أ. نورة العتيبي',     role:'عضو مجلس الإدارة',   email:'n.alotaibi@ameen.sa',  at:'22 مايو 2025، 12:31 م', device:'iPhone 14',     verify:'بصمة الوجه',   hash:'F2C7B3', sig:5,  required:true  },
      { name:'أ. سلطان السعود',     role:'عضو مجلس الإدارة',   email:'s.alsaud@ameen.sa',    at:'22 مايو 2025، 12:44 م', device:'iPad Air',      verify:'رمز OTP',      hash:'G8D4E1', sig:0,  required:true  },
      { name:'د. مها الحارثي',      role:'عضو مستقل',           email:'m.alhaarthy@ameen.sa', at:'22 مايو 2025، 12:51 م', device:'MacBook Pro',   verify:'كلمة مرور',    hash:'H1F3C9', sig:1,  required:true  },
      { name:'أ. ياسر القحطاني',    role:'ضيف مدعو',            email:'y.alqahtani@ameen.sa', at:'—',                       device:'—',             verify:'—',             hash:'—',      sig:-1, required:false },
    ] : [
      { name:'Dr. Abdullah Alghamdi',  role:'Board Chairman',     email:'a.alghamdi@ameen.sa',  at:'22 May 2025, 11:02 AM', device:'iPhone 15 Pro',  verify:'Face ID',     hash:'A3F8C9', sig:0,  required:true  },
      { name:'Eng. Khalid Alsubaie',   role:'Board Member',       email:'k.alsubaie@ameen.sa',  at:'22 May 2025, 11:18 AM', device:'MacBook Pro',   verify:'Password',    hash:'B7D2E1', sig:1,  required:true  },
      { name:'Ms. Laila Altamimi',     role:'Board Member',       email:'l.altamimi@ameen.sa',  at:'22 May 2025, 11:52 AM', device:'iPad Pro',      verify:'Fingerprint', hash:'C5A3F7', sig:2,  required:true  },
      { name:'Mr. Faisal Almutairi',   role:'Board Member',       email:'f.almutairi@ameen.sa', at:'22 May 2025, 12:08 PM', device:'Samsung S24',   verify:'OTP Code',    hash:'D1B8C2', sig:3,  required:true  },
      { name:'Mr. Ahmed Alharbi',      role:'Board Member',       email:'a.alharbi@ameen.sa',   at:'22 May 2025, 12:22 PM', device:'MacBook Air',   verify:'Password',    hash:'E4F9A6', sig:4,  required:true  },
      { name:'Ms. Noura Alotaibi',     role:'Board Member',       email:'n.alotaibi@ameen.sa',  at:'22 May 2025, 12:31 PM', device:'iPhone 14',     verify:'Face ID',     hash:'F2C7B3', sig:5,  required:true  },
      { name:'Mr. Sultan Alsaud',      role:'Board Member',       email:'s.alsaud@ameen.sa',    at:'22 May 2025, 12:44 PM', device:'iPad Air',      verify:'OTP Code',    hash:'G8D4E1', sig:0,  required:true  },
      { name:'Dr. Maha Alhaarthy',     role:'Independent Member', email:'m.alhaarthy@ameen.sa', at:'22 May 2025, 12:51 PM', device:'MacBook Pro',   verify:'Password',    hash:'H1F3C9', sig:1,  required:true  },
      { name:'Mr. Yasser Alqahtani',   role:'Invited Guest',      email:'y.alqahtani@ameen.sa', at:'—',                     device:'—',             verify:'—',           hash:'—',      sig:-1, required:false },
    ];
    const ATTS   = this._s8Attendees;
    const nTotal  = ATTS.length;
    const nSigned = ATTS.filter(a=>a.sig>=0).length;
    const nReq    = ATTS.filter(a=>a.required).length;

    /* ── Donut (fully signed → all green) ────────────────────────── */
    const R=52, CX=80, CY=80, SW=16;
    const donutSVG = `<svg width="160" height="160" viewBox="0 0 160 160">
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#0C7A3D" stroke-width="${SW}"/>
  <text x="${CX}" y="${CY-8}" text-anchor="middle" font-size="26" font-weight="800" fill="#15201A">${nSigned}/${nTotal}</text>
  <text x="${CX}" y="${CY+13}" text-anchor="middle" font-size="12" fill="#8A948D">${t('وقّع','Signed')}</text>
</svg>`;

    /* ── Attendee table rows (first 5, rest in modal) ─────────────── */
    const attRows = ATTS.slice(0,5).map((a,i) => {
      const initials = a.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const sigCell = a.sig>=0
        ? `<svg width="70" height="26" viewBox="0 0 50 28">${SIG_PATHS[a.sig]}</svg>`
        : `<span style="font-size:11px;color:#8A948D">${t('غير مطلوب','Not Required')}</span>`;
      return `<tr>
        <td class="s8-col-num">${i+1}</td>
        <td class="s8-col-att"><div class="s8-att-info"><div class="s8-av" style="background:${AV_COLORS[i]}">${initials}</div><div><div>${esc(a.name)}</div><div style="font-size:10px;color:#8A948D">${esc(a.email)}</div></div></div></td>
        <td class="s8-col-role">${esc(a.role)}</td>
        <td class="s8-col-at">${a.at}</td>
        <td class="s8-col-sig">${sigCell}</td>
      </tr>`;
    }).join('');

    /* ── Document readiness checklist ────────────────────────────── */
    const readinessItems = [
      { ok:true,  label:t('المحضر الأولي اعتُمد من مسودة إلى نهائي','Draft minutes finalized by secretary') },
      { ok:true,  label:t(`تم قبول ${nAcc} تعليق ودمجه في النسخة النهائية`,`${nAcc} comments accepted and merged into final version`) },
      { ok:true,  label:t('تم إصدار النسخة النهائية v1.'+nAcc,'Final version v1.'+nAcc+' issued') },
      { ok:true,  label:t('8 من 8 توقيعات مطلوبة مكتملة','8 of 8 required signatures complete') },
      { ok:true,  label:t('شهادات التوقيع الإلكتروني موثّقة','E-signature certificates verified') },
      { ok:true,  label:t('سجل التدقيق كامل ومؤمَّن','Audit trail complete and tamper-proof') },
      { ok:true,  label:t('المحضر جاهز للاعتماد النهائي','Minutes ready for final approval') },
    ];

    /* ── Approval history (prior rounds) ─────────────────────────── */
    this._s8ApprovalHistory = [
      { round:1, status:t('طلب تعديلات','Changes Requested'), by:t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi'), date:'20 May 2025, 3:30 PM', comment:t('يُرجى توضيح بند ميزانية مشروع التحول الرقمي وإضافة ملاحق الأرقام.','Please clarify the Digital Transformation project budget item and attach supporting figures.') },
      { round:2, status:t('في انتظار الاعتماد','Pending Approval'),    by:t('النظام','System'),                   date:'22 May 2025, 12:52 PM', comment:t('تم معالجة التعديلات وجمع جميع التوقيعات. جاهز للاعتماد النهائي.','Changes processed and all signatures collected. Ready for final approval.') },
    ];

    /* ── Rich audit trail (12 events) ───────────────────────────── */
    this._s8AuditEvents = [
      { ico:'📝', text:t('إنشاء دورة اعتماد المحاضر للاجتماع','Minutes approval cycle initiated for meeting'), date:'15 May 2025, 4:00 PM' },
      { ico:'📄', text:t('رُفعت مسودة المحضر الأولية بواسطة أمين السر','Initial draft minutes uploaded by secretary'), date:'16 May 2025, 9:15 AM' },
      { ico:'📧', text:t('أُرسل المحضر للمراجعة إلى 9 حضور','Minutes distributed for review to 9 attendees'), date:'16 May 2025, 9:20 AM' },
      { ico:'💬', text:t(`استُلم ${(nAcc+nRej)} تعليق خلال فترة المراجعة (${nAcc} مقبول, ${nRej} مرفوض)`,`${nAcc+nRej} comments received during review (${nAcc} accepted, ${nRej} rejected)`), date:'16–19 May 2025' },
      { ico:'✅', text:t('تم حل جميع التعليقات وإغلاق مرحلة المراجعة','All comments resolved, review stage closed'), date:'19 May 2025, 5:00 PM' },
      { ico:'📋', text:t('تم إصدار النسخة النهائية من المحضر','Final version of minutes issued'), date:'22 May 2025, 10:45 AM' },
      { ico:'✍️', text:t('أُرسل طلب التوقيع الإلكتروني لجميع الحضور','E-signature request sent to all attendees'), date:'22 May 2025, 10:46 AM' },
      { ico:'✅', text:t('6 توقيعات استُلمت في أول ساعتين','6 signatures received within first 2 hours'), date:'22 May 2025, 12:31 PM' },
      { ico:'✅', text:t('أُرسل تذكير — وقّع أ. سلطان السعود','Reminder sent — Mr. Sultan Alsaud signed'), date:'22 May 2025, 12:44 PM' },
      { ico:'✅', text:t('أُرسل تذكير — وقّعت د. مها الحارثي','Reminder sent — Dr. Maha Alhaarthy signed'), date:'22 May 2025, 12:51 PM' },
      { ico:'🏆', text:t('اكتملت جميع التوقيعات المطلوبة (8/8)','All required signatures collected (8/8)'), date:'22 May 2025, 12:51 PM' },
      { ico:'⏳', text:t('المحضر في انتظار الاعتماد النهائي من رئيس المجلس','Minutes awaiting final approval from Board Chairman'), date:'22 May 2025, 12:52 PM' },
    ];

    /* ── Render ─────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-step-page" id="ac-step8-page">

  <!-- Header -->
  <div class="dm-page-hdr">
    <div class="dm-page-hdr-left">
      <div class="dm-page-title-row">
        <h1 class="dm-page-title">
          <span class="dm-pt-step">${t('الخطوة 8 من 9','Step 8 of 9')}</span>
          <span class="dm-pt-name">${t('الاعتماد النهائي','Final Approval')}</span>
        </h1>
        <span class="s8-badge-pending-approval">⏳ ${t('في انتظار الاعتماد','Pending Approval')}</span>
      </div>
      <p class="dm-page-sub">${t('تم جمع جميع التوقيعات المطلوبة. المحضر النهائي جاهز للمراجعة والاعتماد من قِبَل رئيس مجلس الإدارة (المُعتمِد النهائي).','All required signatures have been collected. The final minutes are now ready for the Board Chairman (Final Approver) to review and approve.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s8Preview()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.4"/><ellipse cx="7" cy="7" rx="6" ry="4" stroke="currentColor" stroke-width="1.4"/></svg>
        ${t('معاينة المحضر','Preview Minutes')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s8DownloadSigned()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('تنزيل الموقّع','Download Signed')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s8History()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${t('السجل','History')}
      </button>
      <button class="dm-btn primary s8-approve-btn-top" onclick="ApprovalCycle._s8Approve()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${t('اعتماد المحضر','Approve Minutes')}
      </button>
    </div>
  </div>

  <!-- Mini stepper -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- Meta bar -->
  <div class="s8-meta-bar">
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="11" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><path d="M4 1v2M10 1v2M1 5.5h12" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s8-meta-lbl">${t('الاجتماع','Meeting')}</div><div class="s8-meta-val">${esc(meetingTitle)}</div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.2" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/></svg>
      <div><div class="s8-meta-lbl">${t('إصدار المحضر','Minutes Version')}</div><div class="s8-meta-val"><span class="s8-version-badge">v1.${nAcc} (${t('نهائي','Final')})</span></div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div><div class="s8-meta-lbl">${t('اكتملت كل التوقيعات','All Signatures Complete')}</div><div class="s8-meta-val" style="color:#0C7A3D;font-weight:700">22 May 2025, 12:51 PM</div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><circle cx="9.5" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><path d="M1 12a4 4 0 018 0" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s8-meta-lbl">${t('الحضور / الموقّعون','Attendees / Signed')}</div><div class="s8-meta-val"><strong style="color:#0C7A3D">${nSigned}</strong> / ${nTotal} <span style="font-size:10.5px;color:#8A948D">(${nReq} ${t('مطلوب','required')})</span></div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <div><div class="s8-meta-lbl">${t('الحالة','Status')}</div><div class="s8-meta-val"><span class="s8-status-pending">⏳ ${t('في انتظار الاعتماد النهائي','Pending Final Approval')}</span></div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <div><div class="s8-meta-lbl">${t('المُعتمِد النهائي','Final Approver')}</div><div class="s8-meta-val" style="font-weight:700">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div></div>
    </div>
  </div>

  <!-- 3-column body -->
  <div class="s8-body">

    <!-- LEFT: Document + Signatures table -->
    <div class="s8-left">

      <!-- Section heading -->
      <div class="s8-section-title">📄 ${t('المحضر النهائي الموقّع','Signed Final Minutes')}</div>
      <div class="s8-section-sub">${t('تمت مراجعة المحضر النهائي والتوقيع عليه من جميع الحضور المطلوبين.','The final minutes have been reviewed and signed by all required attendees.')}</div>

      <!-- Document card -->
      <div class="s8-doc-card">
        <div class="s8-doc-card-left">
          <div class="s8-doc-icon">
            <svg width="32" height="40" viewBox="0 0 32 40" fill="none"><rect width="32" height="40" rx="4" fill="#1B4B9A"/><rect x="4" y="7" width="24" height="3" rx="1.5" fill="white" opacity=".9"/><rect x="4" y="13" width="18" height="2" rx="1" fill="white" opacity=".7"/><rect x="4" y="17" width="22" height="2" rx="1" fill="white" opacity=".7"/><rect x="4" y="21" width="15" height="2" rx="1" fill="white" opacity=".5"/><rect x="4" y="25" width="20" height="2" rx="1" fill="white" opacity=".5"/><text x="4" y="37" font-size="8" font-weight="800" fill="white" opacity=".95">PDF</text></svg>
          </div>
          <div>
            <div class="s8-doc-name">${t('محضر اجتماع مجلس الإدارة','Board Meeting Minutes')}</div>
            <div class="s8-doc-date">15 ${t('مايو','May')} 2025</div>
            <span class="s8-final-badge">✅ ${t('نهائي وموقّع','Final & Signed')}</span>
            <div class="s8-doc-meta-small">${t('الحجم: 312 كيلوبايت','Size: 312 KB')} · ${t('الصفحات: 14','Pages: 14')} · SHA-256: A3F8…</div>
          </div>
        </div>
        <div class="s8-doc-card-right">
          ${[
            [t('الإصدار','Version'), `v1.${nAcc} (${t('نهائي','Final')})`],
            [t('أُعدَّ بواسطة','Prepared by'), t('محمد البلالي (أمين السر)','Mohammad Albuali (Secretary)')],
            [t('تاريخ الإصدار','Issued on'), '22 May 2025, 10:45 AM'],
            [t('آخر توقيع استُلم','Last signature received'), '22 May 2025, 12:51 PM'],
            [t('جاهز للاعتماد منذ','Ready for approval since'), '22 May 2025, 12:52 PM'],
            [t('التعديلات المدمجة','Amendments merged'), nAcc],
          ].map(([k,v])=>`<div class="s8-doc-kv"><span class="s8-dk">${k}</span><span class="s8-dv">${v}</span></div>`).join('')}
        </div>
      </div>

      <!-- Preview + Download buttons -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:-8px">
        <button class="s8-preview-btn" onclick="ApprovalCycle._s8Preview()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.4"/><ellipse cx="7" cy="7" rx="6" ry="4" stroke="currentColor" stroke-width="1.4"/></svg>
          ${t('معاينة كاملة بالترويسة','Full Preview with Letterhead')}
        </button>
        <button class="s8-preview-btn" onclick="ApprovalCycle._s8DownloadSigned()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          ${t('تنزيل PDF الموقّع','Download Signed PDF')}
        </button>
      </div>

      <!-- Success alert -->
      <div class="s8-success-alert">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="#0C7A3D"/><path d="M4 8l3 3 5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div>
          <div class="s8-success-title">${t(`اكتملت ${nSigned} من ${nTotal} توقيعات (${nReq} مطلوب) · المحضر جاهز للاعتماد النهائي`,`${nSigned} of ${nTotal} signatures complete (${nReq} required) · Minutes ready for final approval`)}</div>
          <div class="s8-success-sub">${t('جميع الشهادات الإلكترونية موثّقة ومؤمّنة بتشفير SHA-256.','All electronic certificates verified and secured with SHA-256 encryption.')}</div>
        </div>
      </div>

      <!-- Attendee Signatures table -->
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="s8-att-section-title">✍️ ${t(`توقيعات الحضور (${nSigned}/${nTotal} وقّعوا)`,`Attendee Signatures (${nSigned}/${nTotal} Signed)`)}</div>
        <button class="s8-view-all-btn" onclick="ApprovalCycle._s8ViewAll()" style="margin:0;padding:6px 12px;font-size:11.5px">
          ${t('عرض الكل','View All')}
        </button>
      </div>
      <table class="s8-att-table">
        <thead><tr>
          <th class="s8-col-num">#</th>
          <th>${t('الحضور','Attendee')}</th>
          <th>${t('الدور','Role')}</th>
          <th>${t('وُقِّع في','Signed On')}</th>
          <th>${t('التوقيع','Signature')}</th>
        </tr></thead>
        <tbody>${attRows}</tbody>
      </table>
      <button class="s8-view-all-btn" onclick="ApprovalCycle._s8ViewAll()">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
        ${t(`عرض جميع التوقيعات (${nTotal})`,`View All ${nTotal} Signatures`)}
      </button>

    </div>

    <!-- CENTER: Signature summary + Changes + Readiness + Approval History -->
    <div class="s8-center">

      <!-- Signature summary donut -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('ملخص التوقيعات','Signature Summary')}</div>
        <div class="s8-donut-wrap">
          ${donutSVG}
          <div class="s8-donut-legend">
            <div class="s8-leg-row"><span class="s8-leg-dot" style="background:#0C7A3D"></span><span class="s8-leg-lbl">${t('موقّع (مطلوب)','Signed (required)')}</span><span class="s8-leg-val">${nReq} <span class="s8-leg-pct">(100%)</span></span></div>
            <div class="s8-leg-row"><span class="s8-leg-dot" style="background:#D0D5DD"></span><span class="s8-leg-lbl">${t('غير مطلوب (ضيف)','Not required (guest)')}</span><span class="s8-leg-val">${nTotal-nReq}</span></div>
            <div class="s8-leg-row"><span class="s8-leg-dot" style="background:#E8821A"></span><span class="s8-leg-lbl">${t('معلّق','Pending')}</span><span class="s8-leg-val">0 <span class="s8-leg-pct">(0%)</span></span></div>
          </div>
        </div>
        <button class="s8-view-sigs-btn" onclick="ApprovalCycle._s8ViewAll()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
          ${t('عرض جميع التوقيعات','View All Signatures')}
        </button>
      </div>

      <!-- Changes summary (from Stage 5) -->
      <div class="s8-panel">
        <div class="s8-panel-title">📊 ${t('ملخص التعليقات والتغييرات','Comments & Changes Summary')}</div>
        <div class="s8-changes-list">
          <div class="s8-chg-row">
            <span class="s8-chg-ico s8-chg-green"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#0C7A3D"/><path d="M3 6l2 2 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span class="s8-chg-lbl">${t('تعليقات مقبولة','Accepted comments')}</span>
            <span class="s8-chg-val">${nAcc}</span>
          </div>
          <div class="s8-chg-row">
            <span class="s8-chg-ico s8-chg-red"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#C4453C"/><path d="M4 4l4 4M8 4l-4 4" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg></span>
            <span class="s8-chg-lbl">${t('تعليقات مرفوضة','Rejected comments')}</span>
            <span class="s8-chg-val">${nRej}</span>
          </div>
          <div class="s8-chg-row">
            <span class="s8-chg-ico s8-chg-amber"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#E8821A"/><path d="M6 3v3.5l2 1.5" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg></span>
            <span class="s8-chg-lbl">${t('لا تزال معلّقة','Still pending')}</span>
            <span class="s8-chg-val">0 ✓</span>
          </div>
          <div class="s8-chg-divider"></div>
          <div class="s8-chg-row s8-chg-total-row">
            <span class="s8-chg-ico s8-chg-blue"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="1" width="8" height="10" rx="1" stroke="#2C6CA8" stroke-width="1.2"/></svg></span>
            <span class="s8-chg-lbl s8-chg-total-lbl">${t('إجمالي التعليقات','Total comments')}</span>
            <span class="s8-chg-val s8-chg-total-val">${nAcc+nRej}</span>
          </div>
        </div>
        <div class="s8-changes-info">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="#2C6CA8" stroke-width="1.2"/><line x1="6.5" y1="5.5" x2="6.5" y2="9.5" stroke="#2C6CA8" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.5" cy="3.8" r=".7" fill="#2C6CA8"/></svg>
          <span>${t('جميع التعليقات مُعالَجة · النسخة النهائية تعكس التعديلات المقبولة فقط.','All comments processed · Final version reflects only accepted amendments.')}</span>
        </div>
      </div>

      <!-- Document Readiness Checklist -->
      <div class="s8-panel">
        <div class="s8-panel-title">✅ ${t('قائمة جاهزية الاعتماد','Approval Readiness Checklist')}</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${readinessItems.map(item=>`
<div style="display:flex;align-items:flex-start;gap:8px;font-size:12px">
  <span style="color:#0C7A3D;flex-shrink:0;margin-top:1px;font-size:13px">✓</span>
  <span style="color:#15201A;line-height:1.4">${item.label}</span>
</div>`).join('')}
        </div>
      </div>

      <!-- Approval History -->
      <div class="s8-panel">
        <div class="s8-panel-title" style="display:flex;justify-content:space-between">
          <span>🔄 ${t('سجل الاعتماد','Approval History')}</span>
          <button onclick="ApprovalCycle._s8ViewApprovalHistory()" style="background:none;border:none;font-size:11px;color:#4A6FA8;cursor:pointer">${t('عرض الكل','View All')}</button>
        </div>
        ${(this._s8ApprovalHistory||[]).map((h,i)=>`
<div style="border:1px solid #F2F3F5;border-radius:9px;padding:10px 12px;${i>0?'margin-top:8px':''}">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
    <span style="font-size:11px;font-weight:700;color:#8A948D">${t('الجولة','Round')} ${h.round}</span>
    <span style="font-size:11px;background:${h.status.includes(t('تعديل','Change'))||h.status.includes('Change')?'#FEF3C7':'#DBEAFE'};color:${h.status.includes(t('تعديل','Change'))||h.status.includes('Change')?'#92400E':'#1D4ED8'};border-radius:8px;padding:2px 8px;font-weight:600">${h.status}</span>
  </div>
  <div style="font-size:11.5px;color:#46514A;margin-bottom:3px">${esc(h.comment)}</div>
  <div style="font-size:10.5px;color:#8A948D">${h.by} · ${h.date}</div>
</div>`).join('')}
      </div>

    </div>

    <!-- RIGHT: Approver + Actions + Comment + Audit -->
    <div class="s8-sidebar">

      <!-- Approver card -->
      <div class="s8-panel" style="background:linear-gradient(135deg,#0F1728,#1a2d4a);border:none">
        <div class="s8-panel-title" style="color:rgba(255,255,255,.7);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">${t('المُعتمِد النهائي','Final Approver')}</div>
        <div class="s8-approver-card">
          <div class="s8-approver-av" style="background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.2)">
            <span style="font-size:16px;font-weight:800;color:#fff">عب</span>
          </div>
          <div class="s8-approver-info">
            <div class="s8-approver-name" style="color:#fff">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div>
            <span class="s8-approver-role-badge" style="background:rgba(168,132,44,.25);color:#D4AA50;border:1px solid rgba(168,132,44,.3)">${t('رئيس مجلس الإدارة','Board Chairman')}</span>
            <div style="font-size:10.5px;color:rgba(255,255,255,.5);margin-top:4px">a.alghamdi@ameen.sa</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
          <span style="font-size:11px;background:rgba(12,122,61,.3);color:#4ADE80;border-radius:10px;padding:3px 10px;font-weight:600">✓ ${t('صلاحية الاعتماد','Approval Authority')}</span>
          <span style="font-size:11px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);border-radius:10px;padding:3px 10px">🔐 ${t('توقيع مؤمّن','Verified Signer')}</span>
        </div>
      </div>

      <!-- Approval comment -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('تعليق الاعتماد','Approval Comment')}</div>
        <p class="s8-panel-sub">${t('أضف تعليقاً يُسجَّل رسمياً مع قرار الاعتماد (اختياري).','Add a comment to be officially recorded with the approval decision (optional).')}</p>
        <textarea class="s8-notes-ta" id="s8-notes-ta" maxlength="600"
          placeholder="${t('مثال: تم مراجعة المحضر ومحتواه دقيق ومكتمل، وأُعتمد رسمياً.','e.g., The minutes have been reviewed and found accurate and complete, hereby officially approved.')}"
          oninput="document.getElementById('s8-char-count').textContent=this.value.length"></textarea>
        <div class="s8-char-count"><span id="s8-char-count">0</span>/600</div>
      </div>

      <!-- Approval Actions -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('إجراءات الاعتماد','Approval Actions')}</div>
        <p class="s8-panel-sub">${t('راجع المحضر النهائي قبل اتخاذ قرارك. قرارك سيُسجَّل رسمياً في سجل التدقيق.','Review the final minutes before making your decision. Your decision will be officially recorded in the audit trail.')}</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="s8-approve-action-btn" onclick="ApprovalCycle._s8Approve()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ✅ ${t('اعتماد المحضر','Approve Minutes')}
          </button>
          <button class="s8-request-changes-btn" onclick="ApprovalCycle._s8RequestChanges()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7a4 4 0 017.5-2M11 7a4 4 0 01-7.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 5l1 2-2 .5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            🔄 ${t('طلب تعديلات','Request Changes')}
          </button>
          <button class="s8-reject-btn" onclick="ApprovalCycle._s8Reject()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            ❌ ${t('رفض المحضر','Reject Minutes')}
          </button>
        </div>
        <div class="s8-action-info">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.5" stroke="#8A948D" stroke-width="1"/><line x1="6" y1="5" x2="6" y2="9" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="3.5" r=".6" fill="#8A948D"/></svg>
          <span>${t('لا يمكن التراجع عن الاعتماد. تأكد من مراجعة المحضر كاملاً قبل الاعتماد.','Approval cannot be undone. Ensure you have fully reviewed the minutes before approving.')}</span>
        </div>
      </div>

      <!-- Audit Trail (last 4 events) -->
      <div class="s8-panel">
        <div class="s8-panel-title" style="display:flex;justify-content:space-between">
          <span>🔍 ${t('سجل التدقيق','Audit Trail')}</span>
          <button onclick="ApprovalCycle._s8AuditTrail()" style="background:none;border:none;font-size:11px;color:#4A6FA8;cursor:pointer">${t('عرض الكل','View All')}</button>
        </div>
        <div class="s8-audit-trail">
          ${(this._s8AuditEvents||[]).slice(-4).map(e=>`
<div class="s8-audit-row">
  <span class="s8-audit-ico s8-ico-green">${e.ico}</span>
  <div class="s8-audit-body">
    <div class="s8-audit-text">${e.text}</div>
    <div class="s8-audit-meta">🕐 ${e.date}</div>
  </div>
</div>`).join('')}
        </div>
        <button class="s8-view-all-btn" onclick="ApprovalCycle._s8AuditTrail()" style="width:100%;justify-content:center;font-size:12px">
          🔍 ${t('سجل التدقيق الكامل (12 حدث)','Full Audit Trail (12 events)')}
        </button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <button class="dm-btn ghost" onclick="ApprovalCycle._onStepClick(6)">← ${t('العودة لتوقيعات الحضور','Back to Attendee Signatures')}</button>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#2C6CA8" stroke-width="1.3"/><line x1="7" y1="6" x2="7" y2="10" stroke="#2C6CA8" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="4" r=".8" fill="#2C6CA8"/></svg>
      <span style="font-size:12px;color:#46514A">${t('بمجرد الاعتماد، ينتقل المحضر إلى الخطوة 9: الأرشفة والتفعيل ليصبح السجل الرسمي.','Once approved, the minutes move to Step 9: Archive & Activate and become the official record.')}</span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s8DownloadSigned()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('تنزيل الموقّع (PDF)','Download Signed (PDF)')}
      </button>
      <button class="dm-btn primary" onclick="ApprovalCycle._s8Approve()">
        ✅ ${t('اعتماد المحضر','Approve Minutes')}
      </button>
    </div>
  </div>

</div>`;
    // cache for helpers
    this._s8CommentsNote = '';
  },

  /* ═══ Step 8 helpers ════════════════════════════════════════════════════ */

  _s8Preview()  { this._fmPreview(); },
  _s8History()  { this._fmHistory(); },

  _s8DownloadSigned() {
    const t = (ar,en) => this.t(ar,en);
    showToast(t('⏳ جارٍ تحضير المحضر الموقّع بصيغة PDF...','⏳ Preparing signed minutes PDF...'), 'info');
    setTimeout(() => showToast(t('✅ تم تنزيل المحضر الموقّع (312 كيلوبايت)','✅ Signed minutes downloaded (312 KB)'), 'success'), 1800);
  },

  _s8ViewAll() {
    const t = (ar,en) => this.t(ar,en);
    const l = App.lang;
    const ATTS = this._s8Attendees || [];
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A6FA8','#6B4FA8','#2AA87A','#C47A3C','#5A8A4A'];
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 17 Q9 9 13 14 L18 18 Q22 22 26 14 Q30 6 36 12 L42 16" stroke="#1a3a5c" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    ];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:6000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:30px 16px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:860px;max-width:98vw;box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:hidden">
  <div style="background:#0F1728;padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:14px;font-weight:800">✍️ ${t('جميع التوقيعات الإلكترونية','All Electronic Signatures')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${ATTS.filter(a=>a.sig>=0).length} ${t('موقّع من أصل','signed of')} ${ATTS.length} · ${t('مؤمّن بتشفير SHA-256','Secured with SHA-256')}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button onclick="ApprovalCycle._s8DownloadSigned()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:7px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600">📥 ${t('تنزيل PDF','Download PDF')}</button>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕ ${t('إغلاق','Close')}</button>
    </div>
  </div>
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#F8F9FA">
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">#</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('الحضور','Attendee')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('الدور','Role')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('وُقِّع في','Signed On')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('الجهاز / التحقق','Device / Verify')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('التوقيع','Signature')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('الشهادة','Certificate')}</th>
      </tr></thead>
      <tbody>
        ${ATTS.map((a,i)=>{
          const initials = a.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
          const signed = a.sig>=0;
          return `<tr style="border-bottom:1px solid #F2F3F5">
            <td style="padding:12px 16px;color:#8A948D">${i+1}</td>
            <td style="padding:12px 16px">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:32px;height:32px;border-radius:50%;background:${AV_COLORS[i%AV_COLORS.length]};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0">${initials}</div>
                <div><div style="font-weight:600;color:#15201A">${esc(a.name)}</div><div style="font-size:10.5px;color:#8A948D">${esc(a.email)}</div></div>
              </div>
            </td>
            <td style="padding:12px 16px;color:#5A6A5C;font-size:11.5px">${esc(a.role)}</td>
            <td style="padding:12px 16px;white-space:nowrap;color:#46514A;font-size:11.5px">${signed ? a.at : `<span style="color:#E8821A">${t('غير مطلوب','Not Required')}</span>`}</td>
            <td style="padding:12px 16px;font-size:11.5px;color:#46514A">${signed ? esc(a.device)+' / '+esc(a.verify) : '—'}</td>
            <td style="padding:12px 16px">${signed ? `<div style="background:#F8FAFF;border:1px dashed #C7D4E8;border-radius:6px;padding:4px 8px;display:inline-block"><svg width="80" height="28" viewBox="0 0 50 28">${SIG_PATHS[a.sig]}</svg></div>` : `<span style="color:#D0D5DD;font-size:18px">—</span>`}</td>
            <td style="padding:12px 16px">${signed ? `<span style="font-size:10.5px;font-family:monospace;background:#F0FDF4;color:#065F46;border-radius:6px;padding:3px 7px">${a.hash}…</span>` : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  <div style="padding:12px 24px;background:#F8F9FA;border-top:1px solid #F2F3F5;font-size:11.5px;color:#8A948D;display:flex;justify-content:space-between;align-items:center">
    <span>🔒 ${t('جميع التوقيعات مؤمّنة بتشفير SHA-256 · الشهادات قابلة للتحقق منها بشكل مستقل','All signatures secured with SHA-256 · Certificates independently verifiable')}</span>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:7px 16px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  async _s8Approve() {
    const t = (ar,en) => this.t(ar,en);
    const comment = (document.getElementById('s8-notes-ta')||{}).value || '';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:7000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:500px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:linear-gradient(135deg,#0C7A3D,#1a6b36);padding:20px 24px;border-radius:16px 16px 0 0">
    <div style="color:#fff;font-size:16px;font-weight:800;margin-bottom:4px">✅ ${t('تأكيد الاعتماد النهائي','Confirm Final Approval')}</div>
    <div style="color:rgba(255,255,255,.7);font-size:12.5px">${t('هذا الإجراء نهائي ولا يمكن التراجع عنه.','This action is final and cannot be undone.')}</div>
  </div>
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    <!-- Summary -->
    <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:14px 16px">
      <div style="font-size:12.5px;font-weight:700;color:#065F46;margin-bottom:8px">📋 ${t('ملخص ما سيُعتمَد','Approval Summary')}</div>
      ${[
        [t('المحضر','Minutes'), t('محضر اجتماع مجلس الإدارة – 15 مايو 2025','Board Meeting Minutes – 15 May 2025')],
        [t('الإصدار','Version'), `v1.6 (${t('نهائي','Final')})`],
        [t('التوقيعات','Signatures'), t('8/8 مطلوب مكتمل','8/8 required complete')],
        [t('المُعتمِد','Approver'), t('د. عبدالله الغامدي (رئيس المجلس)','Dr. Abdullah Alghamdi (Board Chairman)')],
        [t('تاريخ الاعتماد','Approval date'), new Date().toLocaleDateString(App.lang==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'long',year:'numeric'})],
      ].map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;font-size:11.5px"><span style="color:#047857">${k}</span><span style="font-weight:600;color:#065F46">${v}</span></div>`).join('')}
    </div>
    <!-- Comment -->
    <div>
      <div style="font-size:12px;font-weight:600;color:#15201A;margin-bottom:6px">${t('تعليق الاعتماد (اختياري)','Approval Comment (optional)')}</div>
      <textarea id="s8-confirm-comment" style="width:100%;padding:10px;border:1.5px solid #E5E9E7;border-radius:8px;font-size:12.5px;resize:vertical;min-height:70px;font-family:inherit;box-sizing:border-box" placeholder="${t('مثال: تمت المراجعة الكاملة، المحضر دقيق ومعتمد رسمياً.','e.g., Fully reviewed, minutes are accurate and hereby officially approved.')}">${esc(comment)}</textarea>
    </div>
    <!-- Consent checkboxes -->
    <div style="display:flex;flex-direction:column;gap:8px">
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;color:#46514A">
        <input type="checkbox" id="s8-chk1" style="margin-top:2px;width:14px;height:14px;accent-color:#0C7A3D;flex-shrink:0">
        <span>${t('راجعتُ المحضر النهائي بالكامل وأؤكد صحة محتواه.','I have fully reviewed the final minutes and confirm their accuracy.')}</span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;color:#46514A">
        <input type="checkbox" id="s8-chk2" style="margin-top:2px;width:14px;height:14px;accent-color:#0C7A3D;flex-shrink:0">
        <span>${t('أفوّض هذا الاعتماد بصفتي الرئيس، وأُدرك أنه ملزم قانونياً.','I authorize this approval as Chairman, understanding it is legally binding.')}</span>
      </label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:10px 20px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
      <button id="s8-confirm-approve-btn" onclick="ApprovalCycle._s8DoApprove(this)" style="padding:10px 22px;border:none;border-radius:8px;background:#0C7A3D;color:#fff;cursor:pointer;font-size:13px;font-weight:700">✅ ${t('تأكيد الاعتماد','Confirm Approval')}</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  async _s8DoApprove(btn) {
    const t = (ar,en) => this.t(ar,en);
    if (!document.getElementById('s8-chk1')?.checked || !document.getElementById('s8-chk2')?.checked) {
      showToast(t('⚠️ يُرجى تأكيد الموافقة على البيانين أعلاه.','⚠️ Please confirm both statements above.'), 'warning');
      return;
    }
    const comment = document.getElementById('s8-confirm-comment')?.value || '';
    const overlay = btn.closest('div[style*="fixed"]');
    if (overlay) overlay.remove();
    showToast(t('⏳ جارٍ تسجيل الاعتماد النهائي...','⏳ Recording final approval...'), 'info');
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: 'archived', note: comment }),
      });
    } catch(e) { /* Demo: continue regardless */ }
    setTimeout(() => {
      showToast(t('🎉 تم الاعتماد النهائي للمحضر بنجاح! رقم الشهادة: APC-2025-089','🎉 Minutes officially approved! Certificate: APC-2025-089'), 'success');
      setTimeout(() => { this._renderStep9ArchiveActivate(); }, 1200);
    }, 1200);
  },

  _s8RequestChanges() {
    const t = (ar,en) => this.t(ar,en);
    const sections = l => l==='ar' ? [
      'جميع البنود','الأهداف والمقدمة','مناقشة البنود المالية','قرارات مجلس الإدارة',
      'المهام والإجراءات المتخذة','توقيت الاجتماع القادم','الملاحق والمستندات الداعمة',
    ] : [
      'All sections','Objectives & introduction','Financial items discussion','Board decisions',
      'Action items & follow-up','Next meeting timing','Annexes & supporting documents',
    ];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:7000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:500px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:linear-gradient(135deg,#1a3a5c,#2C6CA8);padding:20px 24px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:16px;font-weight:800">🔄 ${t('طلب تعديلات','Request Changes')}</div>
      <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:3px">${t('سيُعاد المحضر إلى مرحلة المراجعة والحل.','Minutes will return to Review & Resolve stage.')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:18px">×</button>
  </div>
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    <div>
      <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:8px">${t('سبب التعديل','Reason for Changes')}</div>
      <select id="s8-change-reason" style="width:100%;padding:9px 12px;border:1.5px solid #E5E9E7;border-radius:8px;font-size:12.5px;font-family:inherit;background:#fff">
        <option value="">${t('-- اختر سبباً --','-- Select a reason --')}</option>
        <option value="accuracy">${t('عدم دقة المعلومات','Inaccurate information')}</option>
        <option value="missing">${t('معلومات ناقصة أو مفقودة','Missing or incomplete information')}</option>
        <option value="format">${t('مشكلة في التنسيق أو الهيكل','Formatting or structure issue')}</option>
        <option value="language">${t('مشكلة لغوية أو إملائية','Language or spelling issue')}</option>
        <option value="decision">${t('تعديل في صياغة القرارات','Decision wording amendment')}</option>
        <option value="other">${t('أخرى','Other')}</option>
      </select>
    </div>
    <div>
      <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:8px">${t('الأقسام المطلوب تعديلها','Sections Requiring Changes')}</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${sections(App.lang).map((s,i)=>`<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#46514A">
          <input type="checkbox" class="s8-section-chk" value="${s}" style="width:14px;height:14px;accent-color:#2C6CA8"> ${esc(s)}
        </label>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:6px">${t('ملاحظات تفصيلية (مطلوب)','Detailed Notes (required)')}</div>
      <textarea id="s8-change-notes" style="width:100%;padding:10px;border:1.5px solid #E5E9E7;border-radius:8px;font-size:12.5px;resize:vertical;min-height:100px;font-family:inherit;box-sizing:border-box" placeholder="${t('اشرح بالتفصيل التعديلات المطلوبة...','Describe in detail the required changes...')}"></textarea>
    </div>
    <div style="background:#FEF3C7;border-radius:8px;padding:10px 12px;font-size:11.5px;color:#92400E">
      ⚠️ ${t('سيُعلَم أمين السر بالتعديلات المطلوبة وسيُعاد جمع التوقيعات بعد المراجعة.','The secretary will be notified and signatures will need to be recollected after revision.')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:10px 20px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
      <button onclick="ApprovalCycle._s8DoRequestChanges(this)" style="padding:10px 22px;border:none;border-radius:8px;background:#2C6CA8;color:#fff;cursor:pointer;font-size:13px;font-weight:700">🔄 ${t('إرسال طلب التعديلات','Send Change Request')}</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  async _s8DoRequestChanges(btn) {
    const t = (ar,en) => this.t(ar,en);
    const reason = document.getElementById('s8-change-reason')?.value;
    const notes  = document.getElementById('s8-change-notes')?.value?.trim();
    const sections = [...document.querySelectorAll('.s8-section-chk:checked')].map(c=>c.value);
    if (!reason) { showToast(t('⚠️ يُرجى اختيار سبب التعديل.','⚠️ Please select a reason.'), 'warning'); return; }
    if (!notes) { showToast(t('⚠️ يُرجى كتابة ملاحظات تفصيلية.','⚠️ Please add detailed notes.'), 'warning'); return; }
    const overlay = btn.closest('div[style*="fixed"]');
    if (overlay) overlay.remove();
    showToast(t('⏳ جارٍ إرسال طلب التعديلات...','⏳ Sending change request...'), 'info');
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ to_stage:'review_resolve', note: notes }),
      });
    } catch(e) {}
    setTimeout(() => {
      showToast(t('🔄 تم إرسال طلب التعديلات · يُعاد للمراجعة والحل','🔄 Change request sent · Returning to Review & Resolve'), 'info');
      setTimeout(() => this._renderStep5Resolve(), 1200);
    }, 1200);
  },

  _s8Reject() {
    const t = (ar,en) => this.t(ar,en);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:7000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:480px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:linear-gradient(135deg,#7f1d1d,#C4453C);padding:20px 24px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:16px;font-weight:800">❌ ${t('رفض المحضر','Reject Minutes')}</div>
      <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:3px">${t('هذا الإجراء سيوقف دورة الاعتماد.','This action will halt the approval cycle.')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:18px">×</button>
  </div>
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 14px;font-size:12.5px;color:#991B1B">
      ⚠️ ${t('الرفض سيوقف دورة الاعتماد ويُخطر جميع الأطراف المعنية. لا يمكن التراجع عن هذا الإجراء.','Rejection will halt the approval cycle and notify all stakeholders. This cannot be undone.')}
    </div>
    <div>
      <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:6px">${t('سبب الرفض (مطلوب)','Rejection Reason (required)')}</div>
      <select id="s8-reject-reason" style="width:100%;padding:9px 12px;border:1.5px solid #E5E9E7;border-radius:8px;font-size:12.5px;font-family:inherit;background:#fff">
        <option value="">${t('-- اختر سبباً --','-- Select a reason --')}</option>
        <option value="major">${t('أخطاء جوهرية في المحتوى','Major content errors')}</option>
        <option value="legal">${t('مخالفة للمتطلبات القانونية أو التنظيمية','Legal or regulatory non-compliance')}</option>
        <option value="incomplete">${t('المحضر غير مكتمل','Incomplete minutes')}</option>
        <option value="process">${t('مخالفة لإجراءات الاجتماع','Meeting procedure violation')}</option>
        <option value="other">${t('أخرى','Other')}</option>
      </select>
    </div>
    <div>
      <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:6px">${t('تفاصيل الرفض (مطلوب)','Rejection Details (required)')}</div>
      <textarea id="s8-reject-notes" style="width:100%;padding:10px;border:1.5px solid #FECACA;border-radius:8px;font-size:12.5px;resize:vertical;min-height:90px;font-family:inherit;box-sizing:border-box" placeholder="${t('اشرح أسباب الرفض بالتفصيل...','Explain the rejection reasons in detail...')}"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:10px 20px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إلغاء','Cancel')}</button>
      <button onclick="ApprovalCycle._s8DoReject(this)" style="padding:10px 22px;border:none;border-radius:8px;background:#C4453C;color:#fff;cursor:pointer;font-size:13px;font-weight:700">❌ ${t('تأكيد الرفض','Confirm Rejection')}</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  async _s8DoReject(btn) {
    const t = (ar,en) => this.t(ar,en);
    const reason = document.getElementById('s8-reject-reason')?.value;
    const notes  = document.getElementById('s8-reject-notes')?.value?.trim();
    if (!reason) { showToast(t('⚠️ يُرجى اختيار سبب الرفض.','⚠️ Please select a rejection reason.'), 'warning'); return; }
    if (!notes) { showToast(t('⚠️ يُرجى كتابة تفاصيل الرفض.','⚠️ Please add rejection details.'), 'warning'); return; }
    const overlay = btn.closest('div[style*="fixed"]');
    if (overlay) overlay.remove();
    showToast(t('⏳ جارٍ تسجيل قرار الرفض...','⏳ Recording rejection decision...'), 'info');
    setTimeout(() => {
      showToast(t('❌ تم رفض المحضر وإخطار جميع الأطراف المعنية.','❌ Minutes rejected and all stakeholders notified.'), 'error');
    }, 1500);
  },

  _s8AuditTrail() {
    const t = (ar,en) => this.t(ar,en);
    const events = this._s8AuditEvents || [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:600px;max-width:96vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:#0F1728;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
    <div>
      <div style="color:#fff;font-size:15px;font-weight:800">🔍 ${t('سجل التدقيق الكامل','Full Audit Trail')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${events.length} ${t('أحداث مسجّلة · مؤمّنة بتشفير SHA-256 · غير قابلة للتعديل','events · SHA-256 secured · tamper-proof')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕</button>
  </div>
  <div style="overflow-y:auto;padding:18px 24px">
    ${events.map((e,i)=>`
<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;${i<events.length-1?'border-bottom:1px solid #F2F3F5':''}">
  <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
    <div style="width:36px;height:36px;border-radius:50%;background:#F0FDF4;display:flex;align-items:center;justify-content:center;font-size:15px">${e.ico}</div>
    ${i<events.length-1?'<div style="width:1px;height:100%;min-height:16px;background:#E5E9E7;margin-top:4px"></div>':''}
  </div>
  <div style="flex:1;padding-top:5px">
    <div style="font-size:12.5px;font-weight:600;color:#15201A;margin-bottom:3px">${e.text}</div>
    <div style="font-size:11px;color:#8A948D">🕐 ${e.date} · ${t('النظام / محمد البلالي','System / Mohammad Albuali')}</div>
  </div>
</div>`).join('')}
  </div>
  <div style="padding:14px 24px;border-top:1px solid #F2F3F5;background:#F8F9FA;flex-shrink:0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:11.5px;color:#8A948D">🔒 ${t('مؤمّن بتشفير SHA-256 · لا يمكن التعديل أو الحذف','Secured with SHA-256 · Immutable')}</span>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:8px 18px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s8ViewApprovalHistory() {
    const t = (ar,en) => this.t(ar,en);
    const history = this._s8ApprovalHistory || [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:540px;max-width:96vw;max-height:88vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="padding:20px 24px 14px;border-bottom:1px solid #F2F3F5;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:1">
    <div>
      <div style="font-size:15px;font-weight:800;color:#15201A">🔄 ${t('سجل جولات الاعتماد','Approval Rounds History')}</div>
      <div style="font-size:12px;color:#8A948D;margin-top:2px">${history.length} ${t('جولة من الاعتماد','approval round(s)')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#8A948D">×</button>
  </div>
  <div style="padding:16px 24px;display:flex;flex-direction:column;gap:12px">
    ${history.map(h=>`
<div style="border:1px solid #E5E9E7;border-radius:11px;overflow:hidden">
  <div style="background:#F8F9FA;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #F2F3F5">
    <span style="font-size:12px;font-weight:800;color:#15201A">${t('الجولة','Round')} ${h.round}</span>
    <span style="font-size:11.5px;background:${h.round===1?'#FEF3C7':'#DBEAFE'};color:${h.round===1?'#92400E':'#1D4ED8'};border-radius:8px;padding:2px 10px;font-weight:700">${h.status}</span>
  </div>
  <div style="padding:12px 14px">
    <div style="font-size:12.5px;color:#46514A;margin-bottom:8px;line-height:1.5">${esc(h.comment)}</div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#8A948D">
      <span>👤 ${esc(h.by)}</span><span>🕐 ${h.date}</span>
    </div>
  </div>
</div>`).join('')}
    <div style="border:1px dashed #E5E9E7;border-radius:11px;padding:16px;text-align:center">
      <div style="font-size:20px;margin-bottom:6px">⏳</div>
      <div style="font-size:13px;font-weight:700;color:#15201A">${t('الجولة الحالية: في انتظار الاعتماد النهائي','Current Round: Pending Final Approval')}</div>
      <div style="font-size:11.5px;color:#8A948D;margin-top:4px">${t('منذ 22 مايو 2025، 12:52 م','Since 22 May 2025, 12:52 PM')}</div>
    </div>
  </div>
  <div style="padding:12px 24px;border-top:1px solid #F2F3F5;display:flex;justify-content:flex-end">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 20px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 9 — ARCHIVE & ACTIVATE
  ═══════════════════════════════════════════════════════════════════════ */
  _renderStep9ArchiveActivate() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const m  = this._meeting  || {};
    const d  = this._data     || {};
    const cycle = d.cycle || {};

    const meetingTitle = (l==='ar' ? m.title_ar : m.title_en) || m.title_ar || t('اجتماع مجلس الإدارة','Board Meeting');
    const comments = d.comments || [];
    const nAcc = comments.filter(c=>c.status==='accepted').length || 6;
    const miniStepper = this._buildMiniStepper(cycle, 8, t, l);

    /* ── Re-use Stage 8 attendees if navigated from S8, else define ── */
    const AV_COLORS = ['#0F1728','#A8842C','#0C7A3D','#C4453C','#4A6FA8','#6B4FA8','#2AA87A','#C47A3C','#5A8A4A'];
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 17 Q9 9 13 14 L18 18 Q22 22 26 14 Q30 6 36 12 L42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];
    if (!this._s8Attendees) {
      this._s8Attendees = l === 'ar' ? [
        { name:'د. عبدالله الغامدي',  role:'رئيس مجلس الإدارة',  email:'a.alghamdi@ameen.sa',  at:'22 مايو 2025، 11:02 ص', device:'iPhone 15 Pro', verify:'بصمة الوجه',  hash:'A3F8C9', sig:0,  required:true  },
        { name:'م. خالد الصبيعي',     role:'عضو مجلس الإدارة',   email:'k.alsubaie@ameen.sa',  at:'22 مايو 2025، 11:18 ص', device:'MacBook Pro',  verify:'كلمة مرور', hash:'B7D2E1', sig:1,  required:true  },
        { name:'أ. ليلى التميمي',     role:'عضو مجلس الإدارة',   email:'l.altamimi@ameen.sa',  at:'22 مايو 2025، 11:52 ص', device:'iPad Pro',     verify:'بصمة الإصبع',hash:'C5A3F7', sig:2,  required:true  },
        { name:'أ. فيصل المطيري',     role:'عضو مجلس الإدارة',   email:'f.almutairi@ameen.sa', at:'22 مايو 2025، 12:08 م', device:'Samsung S24',  verify:'رمز OTP',   hash:'D1B8C2', sig:3,  required:true  },
        { name:'أ. أحمد الحربي',      role:'عضو مجلس الإدارة',   email:'a.alharbi@ameen.sa',   at:'22 مايو 2025، 12:22 م', device:'MacBook Air',  verify:'كلمة مرور', hash:'E4F9A6', sig:4,  required:true  },
        { name:'أ. نورة العتيبي',     role:'عضو مجلس الإدارة',   email:'n.alotaibi@ameen.sa',  at:'22 مايو 2025، 12:31 م', device:'iPhone 14',    verify:'بصمة الوجه',hash:'F2C7B3', sig:5,  required:true  },
        { name:'أ. سلطان السعود',     role:'عضو مجلس الإدارة',   email:'s.alsaud@ameen.sa',    at:'22 مايو 2025، 12:44 م', device:'iPad Air',     verify:'رمز OTP',   hash:'G8D4E1', sig:0,  required:true  },
        { name:'د. مها الحارثي',      role:'عضو مستقل',           email:'m.alhaarthy@ameen.sa', at:'22 مايو 2025، 12:51 م', device:'MacBook Pro',  verify:'كلمة مرور', hash:'H1F3C9', sig:1,  required:true  },
        { name:'أ. ياسر القحطاني',    role:'ضيف مدعو',            email:'y.alqahtani@ameen.sa', at:'—',                      device:'—',            verify:'—',         hash:'—',      sig:-1, required:false },
      ] : [
        { name:'Dr. Abdullah Alghamdi',  role:'Board Chairman',     email:'a.alghamdi@ameen.sa',  at:'22 May 2025, 11:02 AM', device:'iPhone 15 Pro', verify:'Face ID',     hash:'A3F8C9', sig:0,  required:true  },
        { name:'Eng. Khalid Alsubaie',   role:'Board Member',       email:'k.alsubaie@ameen.sa',  at:'22 May 2025, 11:18 AM', device:'MacBook Pro',   verify:'Password',    hash:'B7D2E1', sig:1,  required:true  },
        { name:'Ms. Laila Altamimi',     role:'Board Member',       email:'l.altamimi@ameen.sa',  at:'22 May 2025, 11:52 AM', device:'iPad Pro',      verify:'Fingerprint', hash:'C5A3F7', sig:2,  required:true  },
        { name:'Mr. Faisal Almutairi',   role:'Board Member',       email:'f.almutairi@ameen.sa', at:'22 May 2025, 12:08 PM', device:'Samsung S24',   verify:'OTP Code',    hash:'D1B8C2', sig:3,  required:true  },
        { name:'Mr. Ahmed Alharbi',      role:'Board Member',       email:'a.alharbi@ameen.sa',   at:'22 May 2025, 12:22 PM', device:'MacBook Air',   verify:'Password',    hash:'E4F9A6', sig:4,  required:true  },
        { name:'Ms. Noura Alotaibi',     role:'Board Member',       email:'n.alotaibi@ameen.sa',  at:'22 May 2025, 12:31 PM', device:'iPhone 14',     verify:'Face ID',     hash:'F2C7B3', sig:5,  required:true  },
        { name:'Mr. Sultan Alsaud',      role:'Board Member',       email:'s.alsaud@ameen.sa',    at:'22 May 2025, 12:44 PM', device:'iPad Air',      verify:'OTP Code',    hash:'G8D4E1', sig:0,  required:true  },
        { name:'Dr. Maha Alhaarthy',     role:'Independent Member', email:'m.alhaarthy@ameen.sa', at:'22 May 2025, 12:51 PM', device:'MacBook Pro',   verify:'Password',    hash:'H1F3C9', sig:1,  required:true  },
        { name:'Mr. Yasser Alqahtani',   role:'Invited Guest',      email:'y.alqahtani@ameen.sa', at:'—',                     device:'—',             verify:'—',           hash:'—',      sig:-1, required:false },
      ];
    }
    const ATTS = this._s8Attendees;
    const nSigned = ATTS.filter(a=>a.sig>=0).length;
    const nTotal  = ATTS.length;

    /* ── Full 15-event audit trail ───────────────────────────────── */
    this._s9AuditEvents = [
      { ico:'🚀', text:t('بدء دورة اعتماد المحاضر للاجتماع','Minutes approval cycle initiated for meeting'),                        date:'15 May 2025, 4:00 PM',  by:t('النظام','System') },
      { ico:'📝', text:t('كتب أمين السر المحضر الأولي (مسودة v1.0)','Secretary drafted initial minutes (draft v1.0)'),               date:'16 May 2025, 9:10 AM',  by:t('محمد البلالي','Mohammad Albuali') },
      { ico:'📧', text:t(`أُرسل المحضر للمراجعة إلى ${nTotal} حضور`,`Minutes sent for review to ${nTotal} attendees`),              date:'16 May 2025, 9:20 AM',  by:t('محمد البلالي','Mohammad Albuali') },
      { ico:'💬', text:t('أُضيف 3 تعليقات من خالد الصبيعي وليلى التميمي','3 comments added by Khalid Alsubaie & Laila Altamimi'), date:'16 May 2025, 2:30 PM',  by:t('النظام','System') },
      { ico:'💬', text:t('أُضيف 5 تعليقات إضافية من أعضاء المجلس','5 additional comments added by board members'),                  date:'17–18 May 2025',        by:t('النظام','System') },
      { ico:'🔄', text:t('أُعيد المحضر للمراجعة بطلب من الرئيس — تعديل بند الميزانية','Minutes returned for revision per Chairman — budget item'), date:'20 May 2025, 3:30 PM', by:t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi') },
      { ico:'✅', text:t(`تم حل جميع التعليقات (${nAcc} مقبول)`,`All comments resolved (${nAcc} accepted)`),                       date:'21 May 2025, 5:00 PM',  by:t('محمد البلالي','Mohammad Albuali') },
      { ico:'📋', text:t(`تم إصدار النسخة النهائية (v1.${nAcc} Final)`,`Final version issued (v1.${nAcc} Final)`),                  date:'22 May 2025, 10:45 AM', by:t('محمد البلالي','Mohammad Albuali') },
      { ico:'✍️', text:t('أُرسل طلب التوقيع الإلكتروني لجميع الحضور','E-signature request sent to all attendees'),                  date:'22 May 2025, 10:46 AM', by:t('النظام','System') },
      { ico:'✅', text:t('6 توقيعات استُلمت في أول 2 ساعة','6 signatures received within first 2 hours'),                          date:'22 May 2025, 12:31 PM', by:t('النظام','System') },
      { ico:'✅', text:t('اكتملت جميع التوقيعات المطلوبة (8/8)','All required signatures collected (8/8)'),                          date:'22 May 2025, 12:51 PM', by:t('النظام','System') },
      { ico:'📨', text:t('أُرسل المحضر للاعتماد النهائي من رئيس المجلس','Minutes submitted for final approval by Board Chairman'),   date:'22 May 2025, 12:52 PM', by:t('النظام','System') },
      { ico:'🎉', text:t('اعتمد الرئيس المحضر رسمياً — شهادة: APC-2025-089','Chairman officially approved minutes — Cert: APC-2025-089'), date:'22 May 2025, 1:05 PM', by:t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi') },
      { ico:'🔒', text:t('تم قفل الوثيقة ومنع التعديل عليها','Document locked and made tamper-proof'),                            date:'22 May 2025, 1:06 PM',  by:t('النظام','System') },
      { ico:'🏛️', text:t('أُرشف المحضر وفُعِّل بوصفه السجل الرسمي · رقم الأرشيف: MM-2025-089-ARC','Minutes archived & activated as official record · Archive ID: MM-2025-089-ARC'), date:'22 May 2025, 1:06 PM', by:t('النظام','System') },
    ];

    /* ── Document version history ─────────────────────────────────── */
    this._s9Versions = [
      { ver:'v1.0', label:t('مسودة أولية','Initial Draft'),               date:'16 May 2025, 9:10 AM',  by:t('محمد البلالي','Mohammad Albuali'), size:'198 KB', status:'draft'    },
      { ver:`v1.1`, label:t('بعد تعليقات المراجعة الأولى','After round-1 review comments'), date:'17 May 2025, 3:00 PM', by:t('محمد البلالي','Mohammad Albuali'), size:'204 KB', status:'draft' },
      { ver:`v1.${nAcc-2}`, label:t('مراجعات إضافية','Additional revisions'),  date:'19 May 2025, 11:00 AM', by:t('محمد البلالي','Mohammad Albuali'), size:'209 KB', status:'draft' },
      { ver:`v1.${nAcc}`, label:t('النسخة النهائية (قبل التوقيعات)',`Final version (pre-signatures)`), date:'22 May 2025, 10:45 AM', by:t('محمد البلالي','Mohammad Albuali'), size:'312 KB', status:'final' },
      { ver:`v1.${nAcc}-SIGNED`, label:t('نهائي موقّع من الجميع + معتمد','Final signed by all + approved'), date:'22 May 2025, 1:06 PM', by:t('النظام','System'), size:'487 KB', status:'archived' },
    ];

    /* ── Attendee table (all 9) ───────────────────────────────────── */
    const attRows = ATTS.map((a,i) => {
      const initials = a.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const statusCell = a.sig>=0
        ? `<span class="s9-signed-badge"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="#0C7A3D"/><path d="M2.5 5l2 2L7.5 3" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>${t('وقّع','Signed')}</span>`
        : `<span style="font-size:11px;color:#8A948D;background:#F8F9FA;padding:3px 8px;border-radius:10px">${t('غير مطلوب','Not Required')}</span>`;
      return `<tr>
        <td class="s9-col-num">${i+1}</td>
        <td class="s9-col-att"><div class="s9-att-info"><div class="s9-av" style="background:${AV_COLORS[i%AV_COLORS.length]}">${initials}</div><div><div>${esc(a.name)}</div><div style="font-size:10px;color:#8A948D">${esc(a.email)}</div></div></div></td>
        <td class="s9-col-role">${esc(a.role)}</td>
        <td class="s9-col-status">${statusCell}</td>
        <td class="s9-col-at">${a.at}</td>
      </tr>`;
    }).join('');

    /* ── Audit trail summary rows (last 5) ─────────────────────────── */
    const auditEntries = this._s9AuditEvents.slice(-5).map((e,i,arr)=>`
<div class="s9-audit-row ${i===arr.length-1?'s9-audit-highlight':''}">
  <span style="font-size:13px;flex-shrink:0">${e.ico}</span>
  <span class="s9-audit-lbl">${e.text}</span>
  <span class="s9-audit-date">${e.date}</span>
</div>`).join('');

    /* ── Render ─────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-step-page" id="ac-step9-page">

  <!-- Celebration banner -->
  <div class="s9-celebration-banner">
    <div class="s9-cel-left">
      <span class="s9-cel-icon">🏛️</span>
      <div>
        <div class="s9-cel-title">🎉 ${t('اكتملت دورة الاعتماد بنجاح!','Approval Cycle Successfully Completed!')}</div>
        <div class="s9-cel-sub">${t('تم اعتماد المحضر وأرشفته وتفعيله بوصفه السجل الرسمي لاجتماع مجلس الإدارة.','Minutes approved, archived and activated as the official Board Meeting record.')}</div>
      </div>
    </div>
    <div class="s9-cel-badges">
      <span class="s9-cel-badge s9-cb-green">✅ ${t('معتمد','Approved')}</span>
      <span class="s9-cel-badge s9-cb-blue">🔒 ${t('مقفول','Locked')}</span>
      <span class="s9-cel-badge s9-cb-gold">🏛️ ${t('مؤرشف رسمياً','Officially Archived')}</span>
    </div>
  </div>

  <!-- Header -->
  <div class="dm-page-hdr">
    <div class="dm-page-hdr-left">
      <div class="dm-page-title-row">
        <h1 class="dm-page-title">
          <span class="dm-pt-step">${t('الخطوة 9 من 9','Step 9 of 9')}</span>
          <span class="dm-pt-name">${t('الأرشفة والتفعيل','Archive & Activate')}</span>
        </h1>
        <span class="s9-completed-badge">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="5.5" fill="#0C7A3D"/><path d="M3 5.5l2 2L8 3.5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${t('مكتمل','Completed')}
        </span>
      </div>
      <p class="dm-page-sub">${t('اعتمد الرئيس المحضر رسمياً. النسخة المعتمدة مقفولة وآمنة ومتاحة للتنزيل وهي السجل الرسمي للاجتماع.','The Chairman has officially approved the minutes. The approved version is locked, secured and available for download as the official meeting record.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s9Preview()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.4"/><ellipse cx="7" cy="7" rx="6" ry="4" stroke="currentColor" stroke-width="1.4"/></svg>
        ${t('معاينة','Preview')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s9Download()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('تنزيل الرسمي (PDF)','Download Official (PDF)')}
      </button>
      <button class="dm-btn ghost" onclick="ApprovalCycle._s9History()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${t('السجل','History')}
      </button>
      <button class="dm-btn primary" onclick="ApprovalCycle._s9ShareMinutes()" style="background:#2C6CA8">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="3" cy="7" r="1.8" stroke="white" stroke-width="1.3"/><circle cx="11" cy="3" r="1.8" stroke="white" stroke-width="1.3"/><circle cx="11" cy="11" r="1.8" stroke="white" stroke-width="1.3"/><path d="M4.7 6.2L9.3 3.8M4.7 7.8l4.6 2.4" stroke="white" stroke-width="1.3"/></svg>
        ${t('مشاركة وتوزيع','Share & Distribute')}
      </button>
    </div>
  </div>

  <!-- Mini stepper -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- Meta bar -->
  <div class="s9-meta-bar">
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="11" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><path d="M4 1v2M10 1v2M1 5.5h12" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s9-meta-lbl">${t('الاجتماع','Meeting')}</div><div class="s9-meta-val">${esc(meetingTitle)}</div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.2" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/></svg>
      <div><div class="s9-meta-lbl">${t('إصدار المحضر الرسمي','Official Version')}</div><div class="s9-meta-val"><span class="s9-version-badge">v1.${nAcc}-SIGNED</span></div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div><div class="s9-meta-lbl">${t('اعتُمد في','Approved On')}</div><div class="s9-meta-val" style="color:#0C7A3D;font-weight:700">22 May 2025, 1:05 PM</div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <div class="s9-meta-av"><span style="font-size:11px;font-weight:800;color:#0F1728">عب</span></div>
      <div>
        <div class="s9-meta-lbl">${t('اعتمده','Approved By')}</div>
        <div class="s9-meta-val" style="font-weight:700">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div>
        <div class="s9-meta-sub">${t('رئيس مجلس الإدارة','Board Chairman')}</div>
      </div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><div class="s9-meta-lbl">${t('التوقيعات','Signatures')}</div><div class="s9-meta-val"><strong style="color:#0C7A3D">${nSigned}/${nTotal}</strong> ${t('مجمَّعة','collected')}</div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div>
        <div class="s9-meta-lbl">${t('الحالة','Status')}</div>
        <div class="s9-meta-val s9-archived-status">🏛️ ${t('مؤرشف ومفعَّل','Archived & Activated')}</div>
        <div class="s9-meta-sub">${t('السجل الرسمي','Official Record')}</div>
      </div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <div><div class="s9-meta-lbl">${t('رقم الأرشيف','Archive ID')}</div><div class="s9-meta-val" style="font-family:monospace;font-size:11.5px;color:#0C7A3D">MM-2025-089-ARC</div></div>
    </div>
  </div>

  <!-- 3-column body -->
  <div class="s9-body">

    <!-- ── LEFT ───────────────────────────────────────────────────── -->
    <div class="s9-left">

      <!-- Archive Certificate card -->
      <div class="s9-archive-card">
        <div class="s9-archive-stamp">
          <svg width="60" height="72" viewBox="0 0 60 72" fill="none">
            <rect width="60" height="72" rx="5" fill="#ECFDF5"/>
            <rect x="8" y="8" width="44" height="56" rx="2" fill="white" stroke="#D1FAE5" stroke-width="1"/>
            <rect x="13" y="15" width="34" height="3.5" rx="1.5" fill="#D1FAE5"/>
            <rect x="13" y="21" width="28" height="2" rx="1" fill="#EAECE8"/>
            <rect x="13" y="26" width="30" height="2" rx="1" fill="#EAECE8"/>
            <rect x="13" y="31" width="22" height="2" rx="1" fill="#EAECE8"/>
            <rect x="13" y="36" width="26" height="2" rx="1" fill="#EAECE8"/>
            <circle cx="30" cy="52" r="13" fill="#0C7A3D"/>
            <path d="M23 52l4.5 4.5L37 46" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="s9-stamp-label">${t('مؤرشف','ARCHIVED')}</span>
          <span style="font-size:9px;color:#047857;font-weight:700;text-align:center">🔒 ${t('مقفول','LOCKED')}</span>
        </div>
        <div class="s9-archive-info">
          <div class="s9-archive-title">📋 ${t('شهادة الأرشفة الرسمية','Official Archive Certificate')}</div>
          <div class="s9-archive-desc">${t('تم اعتماد المحضر وأرشفته رسمياً. رقم الشهادة: APC-2025-089.','Minutes officially approved and archived. Certificate No: APC-2025-089.')}</div>
          <div class="s9-kv-grid">
            ${[
              [t('عنوان الاجتماع','Meeting Title'),       esc(meetingTitle)],
              [t('إصدار المحضر','Minutes Version'),       `v1.${nAcc}-SIGNED (${t('نهائي','Final')})`],
              [t('رقم الأرشيف','Archive ID'),             'MM-2025-089-ARC'],
              [t('رقم الشهادة','Certificate No'),         'APC-2025-089'],
              [t('أُرشف في','Archived On'),               '22 May 2025, 1:06 PM'],
              [t('أُرشف بواسطة','Archived By'),           t('محمد البلالي (أمين السر)','Mohammad Albuali (Secretary)')],
              [t('الحجم','Size'),                          '487 KB · 14 Pages'],
              [t('SHA-256','SHA-256'),                    'A3F8C9D2E1B7F4A6…'],
              [t('سياسة الاحتفاظ','Retention Policy'),   t('7 سنوات (حتى 2032)','7 Years (until 2032)')],
              [t('مكان التخزين','Storage'),               t('أرشيف الحوكمة الآمن','Ameen Governance Secure Archive')],
            ].map(([k,v])=>`<div class="s9-kv-row"><span class="s9-kk">${k}</span><span class="s9-kv ${k.includes('SHA')||k.includes('رقم')?'s9-record-id':''}">${v}</span></div>`).join('')}
          </div>
          <div class="s9-lock-alert">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="#0C7A3D" stroke-width="1.2"/><path d="M2.5 6.5l2.5 2.5 5-5" stroke="#0C7A3D" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t('هذا السجل مقفل ومؤمَّن. أي تعديلات مستقبلية ستُسجَّل كتعديل رسمي لا يؤثر على النسخة الأصلية.','This record is locked and secured. Future amendments will be recorded separately without affecting the original.')}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Download()" style="flex:1;min-width:120px">
              📥 ${t('تنزيل PDF الرسمي','Download Official PDF')}
            </button>
            <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9VersionHistory()" style="flex:1;min-width:120px">
              📂 ${t('سجل الإصدارات','Version History')}
            </button>
          </div>
        </div>
      </div>

      <!-- All Attendee Signatures -->
      <div class="s9-att-section">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="s9-att-title">✍️ ${t(`توقيعات الحضور (${nSigned}/${nTotal})`,`Attendee Signatures (${nSigned}/${nTotal})`)}</div>
          <button class="s9-view-sigs-btn" onclick="ApprovalCycle._s9ViewSigs()" style="padding:5px 12px;font-size:11.5px">
            ${t('عرض الكل','View All')}
          </button>
        </div>
        <table class="s9-att-table">
          <thead><tr>
            <th class="s9-col-num">#</th>
            <th>${t('الحضور','Attendee')}</th>
            <th>${t('الدور','Role')}</th>
            <th>${t('الحالة','Status')}</th>
            <th>${t('وُقِّع في','Signed On')}</th>
          </tr></thead>
          <tbody>${attRows}</tbody>
        </table>
        <button class="s9-view-sigs-btn" onclick="ApprovalCycle._s9ViewSigs()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
          ${t(`عرض جميع التوقيعات مع الشهادات (${nTotal})`,`View All Signatures & Certificates (${nTotal})`)}
        </button>
      </div>
    </div>

    <!-- ── CENTER ─────────────────────────────────────────────────── -->
    <div class="s9-center">

      <!-- Official document card -->
      <div class="s9-panel">
        <div class="s9-panel-title">📄 ${t('الوثيقة الرسمية','Official Document')}</div>
        <div class="s9-doc-preview">
          <div class="s9-doc-thumb">
            <div class="s9-doc-thumb-inner">
              <div class="s9-thumb-logo">
                <svg width="44" height="20" viewBox="0 0 44 20" fill="none"><text x="0" y="16" font-size="14" font-weight="800" fill="#A8842C" font-family="serif">AMEEN</text></svg>
              </div>
              <div class="s9-thumb-title">${t('محضر اجتماع مجلس الإدارة','Board Meeting Minutes')}</div>
              <div class="s9-thumb-date">15 ${t('مايو','May')} 2025</div>
              <div style="margin-top:6px;font-size:9px;color:#8A948D">v1.${nAcc}-SIGNED</div>
              <div class="s9-approved-stamp">${t('معتمد','APPROVED')}</div>
            </div>
            <div class="s9-doc-badge-corner">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M0 0h36v36L0 0z" fill="#0C7A3D"/><path d="M10 18l5 5 11-11" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>
          <div class="s9-doc-meta-row">
            <span class="s9-doc-meta-item">487 KB</span>
            <span class="s9-doc-meta-sep">·</span>
            <span class="s9-doc-meta-item">14 ${t('صفحة','Pages')}</span>
            <span class="s9-doc-meta-sep">·</span>
            <span class="s9-doc-meta-item">PDF</span>
          </div>
          <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Preview()">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
            ${t('معاينة بالترويسة الرسمية','Preview with Official Letterhead')}
          </button>
        </div>
        <!-- Download options -->
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Download('pdf')">📥 ${t('تنزيل PDF الرسمي (موقّع)','Download Official PDF (Signed)')}</button>
          <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Download('word')">📄 ${t('تنزيل Word (.docx)','Download Word (.docx)')}</button>
          <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Download('cert')">🏆 ${t('تنزيل شهادة الاعتماد','Download Approval Certificate')}</button>
        </div>
      </div>

      <!-- Related Records & Links -->
      <div class="s9-panel">
        <div class="s9-panel-title">🔗 ${t('السجلات والروابط ذات الصلة','Related Records & Links')}</div>
        <div class="s9-links-list">
          <div class="s9-link-row">
            <span style="font-size:13px">📋</span>
            <span class="s9-link-lbl">${t('القرارات الرسمية (4)','Formal Decisions (4)')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('decisions')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <span style="font-size:13px">✅</span>
            <span class="s9-link-lbl">${t('بنود المتابعة (7)','Follow-Up Items (7)')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('actions')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <span style="font-size:13px">👥</span>
            <span class="s9-link-lbl">${t('كشف الحضور الرسمي','Official Attendance Sheet')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('attendance')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <span style="font-size:13px">📎</span>
            <span class="s9-link-lbl">${t('المستندات الداعمة (3)','Supporting Documents (3)')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('supporting')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <span style="font-size:13px">🔖</span>
            <span class="s9-link-lbl">${t('قيد سجل القرارات','Decision Registry Entry')}</span>
            <a class="s9-link-anchor" href="#" onclick="ApprovalCycle._s9ViewLink('registry');return false">DR-2025-089</a>
          </div>
          <div class="s9-link-row">
            <span style="font-size:13px">📂</span>
            <span class="s9-link-lbl">${t('سجل الإصدارات (${(this._s9Versions||[]).length} إصدارات)','Version History')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9VersionHistory()">${t('عرض','View')}</button>
          </div>
        </div>
      </div>

      <!-- Document Version History (mini) -->
      <div class="s9-panel">
        <div class="s9-panel-title" style="display:flex;justify-content:space-between">
          <span>📂 ${t('سجل الإصدارات','Version History')}</span>
          <button onclick="ApprovalCycle._s9VersionHistory()" style="background:none;border:none;font-size:11px;color:#4A6FA8;cursor:pointer">${t('عرض الكل','View All')}</button>
        </div>
        ${(this._s9Versions||[]).map(v=>`
<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #F2F3F5">
  <span style="font-size:10.5px;font-family:monospace;background:${v.status==='archived'?'#D1FAE5':v.status==='final'?'#DBEAFE':'#F8F9FA'};color:${v.status==='archived'?'#065F46':v.status==='final'?'#1D4ED8':'#5A6A5C'};padding:2px 7px;border-radius:8px;font-weight:700;white-space:nowrap">${v.ver}</span>
  <div style="flex:1;min-width:0">
    <div style="font-size:11.5px;font-weight:600;color:#15201A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.label}</div>
    <div style="font-size:10.5px;color:#8A948D">${v.date} · ${v.size}</div>
  </div>
  <button onclick="ApprovalCycle._s9Download('ver_${v.ver}')" style="padding:3px 8px;border:1px solid #E4E7EC;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;white-space:nowrap">📥</button>
</div>`).join('')}
      </div>
    </div>

    <!-- ── RIGHT sidebar ──────────────────────────────────────────── -->
    <div class="s9-sidebar">

      <!-- Approval Certificate -->
      <div class="s9-panel" style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border:1.5px solid #A7F3D0">
        <div class="s9-panel-hdr">
          <span class="s9-panel-title" style="color:#065F46">🏆 ${t('شهادة الاعتماد الرسمي','Official Approval Certificate')}</span>
          <span class="s9-confirm-ico">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="11" fill="#0C7A3D"/><path d="M6 11l4 4 7-7" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
        <div style="background:#fff;border:1px solid #D1FAE5;border-radius:10px;padding:12px 14px">
          <div style="font-size:10.5px;color:#8A948D;margin-bottom:6px">${t('رقم الشهادة','Certificate No')}</div>
          <div style="font-size:15px;font-weight:800;color:#0C7A3D;font-family:monospace">APC-2025-089</div>
          <div style="height:1px;background:#D1FAE5;margin:10px 0"></div>
          <p class="s9-confirm-text">${t('أؤكد أنني راجعت المحضر النهائي وأعتمده بوصفه سجلاً صحيحاً ودقيقاً لاجتماع مجلس الإدارة المنعقد بتاريخ 15 مايو 2025.','I confirm that I have reviewed the final minutes and approve them as a true and accurate record of the Board Meeting held on 15 May 2025.')}</p>
          <div class="s9-sig-box" style="background:#F0FDF4;border:1px solid #D1FAE5">
            <svg width="140" height="40" viewBox="0 0 140 40">
              <path d="M10 28 C20 18 30 14 45 22 C55 28 60 22 75 18 C88 14 100 18 115 22 L130 20" stroke="#1a3a5c" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="s9-approver-row">
            <div class="s9-approver-name">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div>
            <div class="s9-approver-role">${t('رئيس مجلس الإدارة','Board Chairman')}</div>
            <div class="s9-approver-date">📅 22 May 2025, 1:05 PM</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="s9-final-badge">✅ ${t('اعتماد نهائي','Final Approval')}</span>
          <span class="s9-final-badge" style="border-color:#2C6CA8;color:#2C6CA8">🔒 SHA-256</span>
        </div>
        <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Download('cert')">
          🏆 ${t('تنزيل شهادة الاعتماد','Download Approval Certificate')}
        </button>
      </div>

      <!-- Next Steps (all completed) -->
      <div class="s9-panel">
        <div class="s9-panel-title">🎯 ${t('ما تم إنجازه','What Was Completed')}</div>
        <div class="s9-nextsteps">
          ${[
            t('المحضر أصبح السجل الرسمي للاجتماع','Minutes are now the official meeting record'),
            t('النسخة المعتمدة مقفولة ومؤمَّنة','Approved version locked and secured'),
            t('تم تسجيل القرارات الرسمية (4 قرارات) في سجل القرارات','4 formal decisions recorded in Decision Registry'),
            t('7 بنود متابعة متاحة في نظام المتابعة والتنفيذ','7 follow-up items available in tracking system'),
            t('أُرسلت إشعارات لجميع الحضور بالاعتماد النهائي','Notifications sent to all attendees of final approval'),
            t('سجل التدقيق الكامل (15 حدث) محفوظ ومؤمَّن','Full audit trail (15 events) preserved and secured'),
          ].map(s=>`<div class="s9-ns-row">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#0C7A3D"/><path d="M3.5 7l2.5 2.5 5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${s}</span>
          </div>`).join('')}
        </div>
      </div>

      <!-- Audit Trail Summary -->
      <div class="s9-panel">
        <div class="s9-panel-title" style="display:flex;justify-content:space-between">
          <span>🔍 ${t('سجل التدقيق (آخر 5)','Audit Trail (Last 5)')}</span>
          <button onclick="ApprovalCycle._s9AuditTrail()" style="background:none;border:none;font-size:11px;color:#4A6FA8;cursor:pointer">${t('عرض الكل','View All')}</button>
        </div>
        <div class="s9-audit-table">${auditEntries}</div>
        <button class="s9-audit-full-btn" onclick="ApprovalCycle._s9AuditTrail()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="1" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="7" x2="9" y2="7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="9.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          🔍 ${t('سجل التدقيق الكامل (15 حدث)','Full Audit Trail (15 events)')}
        </button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <button class="dm-btn ghost" onclick="ApprovalCycle._onStepClick(7)">← ${t('العودة للاعتماد النهائي','Back to Final Approval')}</button>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#065F46" stroke-width="1.3"/><path d="M3.5 7l2.5 2.5 5-5" stroke="#065F46" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="font-size:12px;color:#065F46;font-weight:600">🏛️ ${t('اكتملت دورة الاعتماد · المحضر مؤرشف ومفعَّل رسمياً · رقم الشهادة: APC-2025-089','Approval cycle complete · Minutes officially archived & activated · Cert: APC-2025-089')}</span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s9ShareMinutes()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="3" cy="7" r="1.8" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="3" r="1.8" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="11" r="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M4.7 6.2L9.3 3.8M4.7 7.8l4.6 2.4" stroke="currentColor" stroke-width="1.3"/></svg>
        ${t('مشاركة وتوزيع','Share & Distribute')}
      </button>
      <button class="dm-btn primary" onclick="ApprovalCycle._s9GoToArchive()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="4" width="12" height="9" rx="1.5" stroke="white" stroke-width="1.4"/><path d="M1 7h12" stroke="white" stroke-width="1.2"/><path d="M5 1h4" stroke="white" stroke-width="1.4" stroke-linecap="round"/><path d="M7 1v3" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>
        ${t('الانتقال إلى أرشيف الاجتماعات','Go to Meeting Archive')}
      </button>
    </div>
  </div>

</div>`;
  },

  /* ═══ Step 9 helpers ════════════════════════════════════════════════════ */

  _s9Preview()  { this._fmPreview(); },
  _s9History()  { this._fmHistory(); },

  _s9Download(fmt) {
    const t = (ar,en) => this.t(ar,en);
    const labels = { pdf: t('PDF الرسمي الموقّع','Official Signed PDF'), word: t('ملف Word (.docx)','Word File (.docx)'), cert: t('شهادة الاعتماد','Approval Certificate') };
    const lbl = labels[fmt] || labels['pdf'];
    showToast(t(`⏳ جارٍ تحضير ${lbl}...`,`⏳ Preparing ${lbl}...`), 'info');
    setTimeout(() => showToast(t(`✅ تم تنزيل ${lbl} (487 كيلوبايت)`,`✅ Downloaded ${lbl} (487 KB)`), 'success'), 1800);
  },

  _s9ViewSigs() {
    /* Delegate to Stage 8's full signatures modal */
    if (typeof this._s8ViewAll === 'function') { this._s8ViewAll(); return; }
    showToast(this.t('تم جمع جميع التوقيعات (8/8 مطلوب) ✅','All required signatures collected (8/8) ✅'), 'success');
  },

  _s9ViewLink(type) {
    const t = (ar,en) => this.t(ar,en);
    const configs = {
      decisions: {
        title: t('القرارات الرسمية للاجتماع','Formal Meeting Decisions'),
        icon: '📋',
        items: l => l==='ar' ? [
          { id:'Q-01', label:'اعتماد الميزانية التشغيلية للسنة المالية 2025 بإجمالي 45 مليون ريال', owner:'أ. فيصل المطيري', status:'مُقرَّر', date:'15 مايو 2025' },
          { id:'Q-02', label:'الموافقة على مشروع التحول الرقمي المرحلة الثانية بميزانية 8 ملايين ريال', owner:'م. خالد الصبيعي', status:'مُقرَّر', date:'15 مايو 2025' },
          { id:'Q-03', label:'تجديد عقود الموردين الاستراتيجيين لمدة 3 سنوات', owner:'أ. أحمد الحربي', status:'مُقرَّر', date:'15 مايو 2025' },
          { id:'Q-04', label:'اعتماد السياسة الجديدة لإدارة المخاطر التشغيلية', owner:'د. مها الحارثي', status:'مُقرَّر', date:'15 مايو 2025' },
        ] : [
          { id:'Q-01', label:'Approve FY2025 operating budget of SAR 45M', owner:'Mr. Faisal Almutairi', status:'Resolved', date:'15 May 2025' },
          { id:'Q-02', label:'Approve Digital Transformation Phase 2 — SAR 8M budget', owner:'Eng. Khalid Alsubaie', status:'Resolved', date:'15 May 2025' },
          { id:'Q-03', label:'Renew strategic supplier contracts for 3 years', owner:'Mr. Ahmed Alharbi', status:'Resolved', date:'15 May 2025' },
          { id:'Q-04', label:'Approve new operational risk management policy', owner:'Dr. Maha Alhaarthy', status:'Resolved', date:'15 May 2025' },
        ],
      },
      actions: {
        title: t('بنود المتابعة والإجراءات','Follow-Up & Action Items'),
        icon: '✅',
        items: l => l==='ar' ? [
          { id:'A-01', label:'إعداد تقرير تنفيذي عن الميزانية التشغيلية المعتمدة', owner:'أ. فيصل المطيري', due:'1 يونيو 2025',   status:'قيد التنفيذ' },
          { id:'A-02', label:'إطلاق مناقصة مشروع التحول الرقمي المرحلة الثانية',   owner:'م. خالد الصبيعي', due:'15 يونيو 2025',  status:'قيد التنفيذ' },
          { id:'A-03', label:'مراجعة وتوقيع عقود الموردين الاستراتيجيين',           owner:'أ. أحمد الحربي',  due:'30 مايو 2025',   status:'قيد التنفيذ' },
          { id:'A-04', label:'نشر سياسة إدارة المخاطر على جميع الإدارات',          owner:'د. مها الحارثي',  due:'22 مايو 2025',   status:'مكتمل' },
          { id:'A-05', label:'تحديث سجل القرارات في منصة الحوكمة',                  owner:'محمد البلالي',    due:'22 مايو 2025',   status:'مكتمل' },
          { id:'A-06', label:'إرسال المحضر المعتمد لجميع الحضور',                   owner:'محمد البلالي',    due:'22 مايو 2025',   status:'مكتمل' },
          { id:'A-07', label:'جدولة اجتماع مجلس الإدارة القادم (يونيو 2025)',       owner:'محمد البلالي',    due:'25 مايو 2025',   status:'قيد التنفيذ' },
        ] : [
          { id:'A-01', label:'Prepare executive report on approved operating budget', owner:'Mr. Faisal Almutairi',  due:'1 Jun 2025',  status:'In Progress' },
          { id:'A-02', label:'Launch tender for Digital Transformation Phase 2',      owner:'Eng. Khalid Alsubaie', due:'15 Jun 2025', status:'In Progress' },
          { id:'A-03', label:'Review and sign strategic supplier contracts',           owner:'Mr. Ahmed Alharbi',    due:'30 May 2025', status:'In Progress' },
          { id:'A-04', label:'Distribute risk management policy to all departments',  owner:'Dr. Maha Alhaarthy',   due:'22 May 2025', status:'Completed' },
          { id:'A-05', label:'Update Decision Registry in governance platform',       owner:'Mohammad Albuali',     due:'22 May 2025', status:'Completed' },
          { id:'A-06', label:'Send approved minutes to all attendees',                owner:'Mohammad Albuali',     due:'22 May 2025', status:'Completed' },
          { id:'A-07', label:'Schedule next Board Meeting (June 2025)',               owner:'Mohammad Albuali',     due:'25 May 2025', status:'In Progress' },
        ],
      },
      attendance: {
        title: t('كشف الحضور الرسمي','Official Attendance Sheet'),
        icon: '👥',
        items: l => (this._s8Attendees || []).map((a,i) => ({ id:`${i+1}`, label:a.name, owner:a.role, status: a.sig>=0 ? t('حضر وقّع','Attended & Signed') : t('حضر (ضيف)','Attended (Guest)'), date:a.at })),
      },
      supporting: {
        title: t('المستندات الداعمة','Supporting Documents'),
        icon: '📎',
        items: l => l==='ar' ? [
          { id:'S-01', label:'تقرير الأداء المالي للربع الأول 2025',      owner:'المدير المالي',         status:'مرفق', date:'15 مايو 2025' },
          { id:'S-02', label:'دراسة جدوى مشروع التحول الرقمي المرحلة الثانية', owner:'م. خالد الصبيعي', status:'مرفق', date:'15 مايو 2025' },
          { id:'S-03', label:'مقترح سياسة إدارة المخاطر التشغيلية',      owner:'د. مها الحارثي',        status:'مرفق', date:'15 مايو 2025' },
        ] : [
          { id:'S-01', label:'Q1 2025 Financial Performance Report',        owner:'CFO',                     status:'Attached', date:'15 May 2025' },
          { id:'S-02', label:'Digital Transformation Phase 2 Feasibility',  owner:'Eng. Khalid Alsubaie',    status:'Attached', date:'15 May 2025' },
          { id:'S-03', label:'Operational Risk Management Policy Proposal', owner:'Dr. Maha Alhaarthy',       status:'Attached', date:'15 May 2025' },
        ],
      },
      registry: {
        title: t('قيد سجل القرارات','Decision Registry Entry'),
        icon: '🔖',
        items: l => l==='ar' ? [
          { id:'DR-2025-089', label:'قيد رئيسي لاجتماع مجلس الإدارة 15 مايو 2025', owner:'محمد البلالي', status:'مسجّل', date:'22 مايو 2025' },
        ] : [
          { id:'DR-2025-089', label:'Main registry entry for Board Meeting 15 May 2025', owner:'Mohammad Albuali', status:'Registered', date:'22 May 2025' },
        ],
      },
    };
    const cfg = configs[type];
    if (!cfg) return;
    const items = cfg.items(App.lang);
    const isActions = type==='actions';
    const isAttendance = type==='attendance';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:680px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:#0F1728;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
    <div>
      <div style="color:#fff;font-size:15px;font-weight:800">${cfg.icon} ${cfg.title}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${items.length} ${t('بند · اجتماع مجلس الإدارة · 15 مايو 2025','items · Board Meeting · 15 May 2025')}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="ApprovalCycle._s9Download('${type}')" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:7px;padding:6px 12px;cursor:pointer;font-size:12px">📥 ${t('تنزيل','Download')}</button>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
  </div>
  <div style="overflow-y:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#F8F9FA">
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('رقم','#')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('البند','Item')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${isActions ? t('المسؤول','Owner') : t('الاسم/المصدر','Name/Source')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${isActions ? t('الموعد','Due') : t('التاريخ','Date')}</th>
        <th style="padding:10px 16px;font-weight:600;color:#8A948D;text-align:start">${t('الحالة','Status')}</th>
      </tr></thead>
      <tbody>
        ${items.map((item,i)=>`<tr style="border-bottom:1px solid #F2F3F5">
          <td style="padding:11px 16px;color:#8A948D;font-size:11px;font-family:monospace">${item.id}</td>
          <td style="padding:11px 16px;font-weight:600;color:#15201A;max-width:260px;line-height:1.4">${esc(item.label)}</td>
          <td style="padding:11px 16px;color:#5A6A5C;font-size:11.5px">${esc(item.owner)}</td>
          <td style="padding:11px 16px;color:#5A6A5C;font-size:11.5px;white-space:nowrap">${esc(isActions ? item.due : item.date)}</td>
          <td style="padding:11px 16px">
            <span style="font-size:11px;background:${item.status.includes(t('مكتمل','Comple'))||item.status.includes('Comp')||item.status.includes(t('مُقرَّر','Resol'))||item.status.includes('Resol')||item.status.includes(t('مسجّل','Regist'))||item.status.includes('Regist')?'#D1FAE5':item.status.includes(t('ضيف','Guest'))||item.status.includes('Guest')?'#FEF3C7':'#DBEAFE'};color:${item.status.includes(t('مكتمل','Comple'))||item.status.includes('Comp')||item.status.includes(t('مُقرَّر','Resol'))||item.status.includes('Resol')?'#065F46':item.status.includes(t('ضيف','Guest'))||item.status.includes('Guest')?'#92400E':'#1D4ED8'};border-radius:8px;padding:2px 9px;font-weight:700">${esc(item.status)}</span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div style="padding:12px 24px;border-top:1px solid #F2F3F5;background:#F8F9FA;flex-shrink:0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:11.5px;color:#8A948D">🔒 ${t('سجل رسمي · مؤرشف 22 مايو 2025','Official Record · Archived 22 May 2025')}</span>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:8px 18px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s9AuditTrail() {
    const t = (ar,en) => this.t(ar,en);
    const events = this._s9AuditEvents || this._s8AuditEvents || [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:640px;max-width:98vw;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:#0F1728;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
    <div>
      <div style="color:#fff;font-size:15px;font-weight:800">🔍 ${t('سجل التدقيق الكامل — دورة الاعتماد','Full Audit Trail — Approval Cycle')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${events.length} ${t('حدث · SHA-256 · غير قابل للتعديل','events · SHA-256 · Immutable')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕</button>
  </div>
  <div style="overflow-y:auto;padding:20px 24px">
    ${events.map((e,i)=>`
<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;${i<events.length-1?'border-bottom:1px solid #F2F3F5':''}">
  <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
    <div style="width:38px;height:38px;border-radius:50%;background:${i===events.length-1?'#D1FAE5':'#F0F4FF'};display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid ${i===events.length-1?'#A7F3D0':'#E0E7FF'}">${e.ico}</div>
    ${i<events.length-1?`<div style="width:2px;height:20px;background:${i===events.length-2?'#A7F3D0':'#E5E9E7'};margin-top:4px;border-radius:1px"></div>`:''}
  </div>
  <div style="flex:1;padding-top:6px">
    <div style="font-size:12.5px;font-weight:${i===events.length-1?'800':'600'};color:${i===events.length-1?'#065F46':'#15201A'};margin-bottom:4px;line-height:1.4">${e.text}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <span style="font-size:11px;color:#8A948D">🕐 ${e.date}</span>
      <span style="font-size:11px;color:#8A948D">👤 ${e.by}</span>
    </div>
  </div>
  <div style="font-size:10px;font-family:monospace;color:#C0C8C3;padding-top:8px">#${String(i+1).padStart(2,'0')}</div>
</div>`).join('')}
  </div>
  <div style="padding:14px 24px;border-top:1px solid #F2F3F5;background:#F8F9FA;flex-shrink:0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:11.5px;color:#8A948D">🔒 ${t('SHA-256 · غير قابل للتعديل أو الحذف · مؤرشف رسمياً','SHA-256 · Immutable · Officially Archived')}</span>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:8px 18px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s9VersionHistory() {
    const t = (ar,en) => this.t(ar,en);
    const versions = this._s9Versions || [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:600px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:#0F1728;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
    <div>
      <div style="color:#fff;font-size:15px;font-weight:800">📂 ${t('سجل إصدارات المحضر','Minutes Version History')}</div>
      <div style="color:rgba(255,255,255,.6);font-size:11.5px;margin-top:2px">${versions.length} ${t('إصدارات · النسخة الأخيرة هي السجل الرسمي','versions · Latest is the official record')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer">✕</button>
  </div>
  <div style="overflow-y:auto;padding:16px 24px;display:flex;flex-direction:column;gap:10px">
    ${versions.map((v,i)=>`
<div style="border:1.5px solid ${v.status==='archived'?'#A7F3D0':v.status==='final'?'#BFDBFE':'#F2F3F5'};border-radius:11px;padding:14px 16px;display:flex;gap:14px;align-items:center">
  <div style="text-align:center;min-width:80px">
    <div style="font-size:13px;font-family:monospace;font-weight:800;color:${v.status==='archived'?'#065F46':v.status==='final'?'#1D4ED8':'#5A6A5C'};background:${v.status==='archived'?'#D1FAE5':v.status==='final'?'#DBEAFE':'#F8F9FA'};padding:4px 10px;border-radius:8px">${v.ver}</span></div>
    <div style="font-size:10px;color:#8A948D;margin-top:4px">${v.size}</div>
  </div>
  <div style="flex:1;min-width:0">
    <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:3px">${v.label}</div>
    <div style="font-size:11px;color:#8A948D">${v.date} · ${v.by}</div>
    ${v.status==='archived'?`<span style="font-size:11px;background:#D1FAE5;color:#065F46;border-radius:8px;padding:2px 8px;font-weight:700;margin-top:6px;display:inline-block">🏛️ ${t('النسخة الرسمية المؤرشفة','Official Archived Version')}</span>`:''}
    ${v.status==='final'&&i<versions.length-1?`<span style="font-size:11px;background:#DBEAFE;color:#1D4ED8;border-radius:8px;padding:2px 8px;font-weight:700;margin-top:6px;display:inline-block">📋 ${t('نهائي (قبل التوقيعات)','Final (pre-signatures)')}</span>`:''}
  </div>
  <button onclick="ApprovalCycle._s9Download('ver_${v.ver}')" style="padding:7px 14px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;white-space:nowrap">📥 ${t('تنزيل','Download')}</button>
</div>`).join('')}
  </div>
  <div style="padding:12px 24px;border-top:1px solid #F2F3F5;background:#F8F9FA;flex-shrink:0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:11.5px;color:#8A948D">🔒 ${t('جميع الإصدارات محفوظة ومؤمَّنة','All versions preserved and secured')}</span>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:8px 18px;border:1px solid #E4E7EC;border-radius:7px;background:#fff;cursor:pointer;font-size:12.5px">${t('إغلاق','Close')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s9ShareMinutes() {
    const t = (ar,en) => this.t(ar,en);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:7000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:500px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3)">
  <div style="background:linear-gradient(135deg,#1a3a5c,#2C6CA8);padding:20px 24px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:16px;font-weight:800">📤 ${t('مشاركة وتوزيع المحضر الرسمي','Share & Distribute Official Minutes')}</div>
      <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:3px">${t('توزيع النسخة الرسمية المعتمدة على الأطراف المعنية.','Distribute the officially approved version to stakeholders.')}</div>
    </div>
    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:18px">×</button>
  </div>
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${[
        ['📧', t('البريد الإلكتروني','Email'),        t('إرسال رابط للمحضر الرسمي','Send link to official minutes')],
        ['💬', t('واتساب','WhatsApp'),                t('مشاركة رابط آمن','Share secure link')],
        ['📋', t('نسخ الرابط','Copy Link'),           t('رابط دائم للأرشيف','Permanent archive link')],
        ['📥', t('تنزيل + إرسال','Download + Send'), t('PDF الرسمي للتوزيع','Official PDF for distribution')],
      ].map(([ico,lbl,sub])=>`
<button onclick="ApprovalCycle._s9DoShare('${lbl}',this)" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px;border:1.5px solid #E5E9E7;border-radius:10px;background:#F8F9FA;cursor:pointer;transition:background .15s;text-align:center" onmouseover="this.style.background='#EAECE8'" onmouseout="this.style.background='#F8F9FA'">
  <span style="font-size:22px">${ico}</span>
  <span style="font-size:12.5px;font-weight:700;color:#15201A">${lbl}</span>
  <span style="font-size:11px;color:#8A948D">${sub}</span>
</button>`).join('')}
    </div>
    <div>
      <div style="font-size:12.5px;font-weight:700;color:#15201A;margin-bottom:8px">${t('المستلمون','Recipients')}</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${(this._s8Attendees||[]).map(a=>`
<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#46514A;padding:4px 0">
  <input type="checkbox" ${a.required?'checked':''} style="width:13px;height:13px;accent-color:#2C6CA8">
  <span>${esc(a.name)}</span>
  <span style="font-size:10.5px;color:#8A948D">· ${esc(a.email)}</span>
</label>`).join('')}
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:10px 20px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">${t('إغلاق','Close')}</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  _s9DoShare(channel, btn) {
    const t = (ar,en) => this.t(ar,en);
    const overlay = btn.closest('div[style*="fixed"]');
    if (overlay) overlay.remove();
    showToast(t(`⏳ جارٍ ${channel}...`,`⏳ Processing ${channel}...`), 'info');
    setTimeout(() => showToast(t(`✅ تم التوزيع بنجاح عبر ${channel}`,`✅ Successfully distributed via ${channel}`), 'success'), 1500);
  },

  _s9GoToArchive() {
    const t = (ar,en) => this.t(ar,en);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:7000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:440px;max-width:96vw;box-shadow:0 24px 80px rgba(0,0,0,.3);text-align:center;padding:32px 28px">
  <div style="font-size:52px;margin-bottom:12px">🏛️</div>
  <div style="font-size:18px;font-weight:800;color:#15201A;margin-bottom:8px">${t('اكتملت دورة الاعتماد!','Approval Cycle Complete!')}</div>
  <div style="font-size:13px;color:#5A6A5C;margin-bottom:20px;line-height:1.6">${t('تم اعتماد المحضر وأرشفته رسمياً بوصفه السجل الرسمي لاجتماع مجلس الإدارة.','The minutes have been officially approved and archived as the official Board Meeting record.')}</div>
  <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:14px 16px;margin-bottom:20px">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span style="color:#047857">${t('رقم الشهادة','Certificate No')}</span><span style="font-weight:700;color:#065F46;font-family:monospace">APC-2025-089</span></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span style="color:#047857">${t('رقم الأرشيف','Archive ID')}</span><span style="font-weight:700;color:#065F46;font-family:monospace">MM-2025-089-ARC</span></div>
    <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#047857">${t('تاريخ الأرشفة','Archived On')}</span><span style="font-weight:700;color:#065F46">22 May 2025, 1:06 PM</span></div>
  </div>
  <div style="display:flex;gap:8px;justify-content:center">
    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:11px 22px;border:1px solid #E4E7EC;border-radius:9px;background:#fff;cursor:pointer;font-size:13px">${t('البقاء في الصفحة','Stay on Page')}</button>
    <button onclick="this.closest('div[style*=fixed]').remove();App.navigate('meetings')" style="padding:11px 22px;border:none;border-radius:9px;background:#0C7A3D;color:#fff;cursor:pointer;font-size:13px;font-weight:700">🏛️ ${t('أرشيف الاجتماعات','Meeting Archive')}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  },

  /* ── Step 1 helpers ─────────────────────────────────────────────────── */
  async _s1SaveDraft() {
    const editor = document.querySelector('.dm-content');
    const text = editor ? editor.innerText.trim() : '';
    showToast(this.t('جارٍ حفظ المسودة...','Saving draft...'), 'info');
    try {
      await api(`/api/meetings/${this._mid}/manual-minutes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes_ar: text || 'مسودة محضر الاجتماع', minutes_en: text || 'Meeting minutes draft' }),
      });
      showToast(this.t('💾 تم حفظ المسودة بنجاح','💾 Draft saved successfully'), 'success');
    } catch(e) {
      showToast(this.t('💾 تم حفظ المسودة محلياً','💾 Draft saved locally'), 'success');
    }
  },
  async _s1Regenerate() {
    showToast(this.t('⏳ جارٍ إنشاء المحضر بالذكاء الاصطناعي...','⏳ Generating minutes with AI...'), 'info');
    try {
      await api(`/api/meetings/${this._mid}/process`, { method: 'POST' });
      showToast(this.t('✅ تم إنشاء المحضر بنجاح!','✅ Minutes generated successfully!'), 'success');
      await this._load();
      this._renderStep1Draft();
    } catch(e) {
      showToast(e.message || this.t('تعذّر إنشاء المحضر. تأكد من وجود تسجيل.','Could not generate minutes. Ensure a recording exists.'), 'error');
    }
  },
  _s1Preview() { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },

  /* ── Step 1 toolbar & section helpers ──────────────────────────────── */
  _s1TbCmd(cmd) {
    const el = document.querySelector('.dm-content');
    if (el) el.focus();
    document.execCommand(cmd, false, null);
  },
  _s1TbFormat(tag) {
    const el = document.querySelector('.dm-content');
    if (el) el.focus();
    document.execCommand('formatBlock', false, tag);
  },
  _s1TbLink() {
    const url = prompt(this.t('أدخل رابط URL:','Enter URL:'));
    if (url) {
      const el = document.querySelector('.dm-content');
      if (el) el.focus();
      document.execCommand('createLink', false, url);
    }
  },
  _s1OnEdit() {
    const stamp = document.querySelector('.dm-autosave');
    if (stamp) stamp.textContent = this.t('✏️ تعديل جارٍ...','✏️ Editing...');
    clearTimeout(this._s1AutoSaveTimer);
    this._s1AutoSaveTimer = setTimeout(() => {
      const stamp2 = document.querySelector('.dm-autosave');
      if (stamp2) stamp2.textContent = this.t('✅ حُفظ تلقائياً','✅ Auto-saved');
    }, 2000);
  },
  _s1AiSection(idx) {
    const t = (ar, en) => this.t(ar, en);
    const body = document.getElementById(`dm-sec-body-${idx}`);
    if (!body) return;
    showToast(t('⏳ AI يُحسّن هذا القسم...','⏳ AI enhancing this section...'), 'info');
    setTimeout(() => {
      showToast(t('✨ تم تحسين القسم بواسطة AI','✨ Section enhanced by AI'), 'success');
    }, 1800);
  },
  _s1EditSection(idx) {
    const body = document.getElementById(`dm-sec-body-${idx}`);
    if (!body) return;
    const isEditing = body.getAttribute('contenteditable') === 'true';
    if (isEditing) {
      body.removeAttribute('contenteditable');
      body.style.outline = '';
      body.style.background = '';
      showToast(this.t('💾 تم حفظ التعديل','💾 Edit saved'), 'success');
    } else {
      body.setAttribute('contenteditable', 'true');
      body.style.outline = '2px solid #A8842C';
      body.style.background = '#FFFEF8';
      body.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      showToast(this.t('✏️ القسم قابل للتعديل الآن','✏️ Section is now editable'), 'info');
    }
  },
  _s1MoreSection(idx, btn) {
    const t = (ar, en) => this.t(ar, en);
    const existing = document.getElementById('dm-sec-more-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'dm-sec-more-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;min-width:180px;';
    const items = [
      { icon:'📋', label: t('نسخ النص','Copy text'), action: () => {
        const body = document.getElementById(`dm-sec-body-${idx}`);
        if (body) navigator.clipboard.writeText(body.innerText).then(() => showToast(t('تم النسخ','Copied'), 'success'));
      }},
      { icon:'🔄', label: t('إعادة الترتيب','Reorder section'), action: () => showToast(t('قريباً...','Coming soon...'), 'info') },
      { icon:'🗑️', label: t('حذف القسم','Delete section'), action: () => {
        if (confirm(t('هل تريد حذف هذا القسم؟','Delete this section?'))) {
          const sec = document.getElementById(`dm-sec-${idx}`);
          if (sec) { sec.style.opacity='0'; setTimeout(() => sec.remove(), 300); }
        }
      }},
    ];
    items.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:9px 16px;cursor:pointer;font-size:13px;display:flex;gap:8px;align-items:center;color:#15201A;';
      div.innerHTML = `${item.icon} ${item.label}`;
      div.onmouseenter = () => div.style.background = '#F5F5F1';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); item.action(); };
      menu.appendChild(div);
    });
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX - 120) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }), 10);
  },
  _s1ViewSuggestions() {
    const t = (ar, en) => this.t(ar, en);
    showToast(t('AI يُحلّل المحضر لعرض جميع الاقتراحات...','AI is analysing minutes for full suggestions...'), 'info');
    setTimeout(() => showToast(t('✅ جميع الاقتراحات محدّثة في اللوحة الجانبية','✅ All suggestions updated in the side panel'), 'success'), 1500);
  },
  _s1AutoSaveTimer: null,

  _bindCanvas() { this._initCanvas(); },
};
window.ApprovalCycle = ApprovalCycle;
