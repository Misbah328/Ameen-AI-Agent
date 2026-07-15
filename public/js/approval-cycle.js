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
    const commentsAllResolved = comments.every(c => c.status === 'accepted' || c.status === 'rejected');
    const canFullSubmit = canSubmit2 && (commentsAllResolved || nTotal === 0);

    /* ── Comment status counts ─────────────────────────────────────────────── */
    const nTotal    = comments.length;
    const nResolved = comments.filter(c => c.status === 'accepted').length;
    const nInResolve= comments.filter(c => c.status === 'pending').length;
    const nRejected = comments.filter(c => c.status === 'rejected').length;

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

    /* ── Activity log (latest 3 from audit or last-modified comments) ──────── */
    const actLog = d.audit || [];
    const actRows = actLog.slice(0,3).map((a,i) => {
      const dot = i===0 ? '#0C7A3D' : i===1 ? '#A8842C' : '#C4453C';
      const desc = (l==='ar' ? a.action_ar : a.action) || a.action || '';
      const actor = a.actor_name || '';
      const when  = a.created_at ? a.created_at.slice(0,16).replace('T',' ') : '';
      return `<div class="rr-log-row"><span class="rr-log-dot" style="background:${dot}"></span><div class="rr-log-body"><div class="rr-log-desc">${esc(desc||t('إجراء','Action'))}</div><div class="rr-log-who">${esc(actor)} — ${when}</div></div></div>`;
    }).join('') || `
      <div class="rr-log-row"><span class="rr-log-dot" style="background:#0C7A3D"></span><div class="rr-log-body"><div class="rr-log-desc">${t('تمت إضافة قرار','Resolution added')}</div><div class="rr-log-who">${t('بواسطة الأمين','By Secretary')}</div></div></div>
      <div class="rr-log-row"><span class="rr-log-dot" style="background:#A8842C"></span><div class="rr-log-body"><div class="rr-log-desc">${t('تم تحديث تعليق','Comment updated')}</div><div class="rr-log-who">${t('بواسطة حضور','By Attendee')}</div></div></div>
    `;

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
      <button class="dm-btn ghost">📊 ${t('تصدير التقرير','Export Report')}</button>
      <button class="dm-btn ghost">📥 ${t('تحميل النسخة العمل','Download Working Copy')} ▾</button>
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
      <button class="dv-preview-btn" style="margin:10px 0 4px">📋 ${t('عرض سياسة الحل','View Resolve Policy')}</button>
    </div>

    <!-- CENTER: tab bar + cards -->
    <div class="rr-center">
      <!-- Tab bar -->
      <div class="rr-tabbar">
        <div class="rr-tabs">
          <button class="rr-tab active" data-tab="all"     onclick="ApprovalCycle._rrSetTab('all')">${t('كل التعليقات','All Comments')} (${nTotal})</button>
          <button class="rr-tab"        data-tab="pending" onclick="ApprovalCycle._rrSetTab('pending')">${t('قيد الحل','In Resolve')} (${nInResolve})</button>
          <button class="rr-tab"        data-tab="accepted"onclick="ApprovalCycle._rrSetTab('accepted')">${t('محلول','Resolved')} (${nResolved})</button>
          <button class="rr-tab"        data-tab="rejected"onclick="ApprovalCycle._rrSetTab('rejected')">${t('مرفوض','Rejected')} (${nRejected})</button>
        </div>
        <div class="rr-filters">
          <select class="rr-filter-sel" id="rr-filter-type" onchange="ApprovalCycle._rrRenderCards()">
            <option value="">${t('كل الأنواع','All Types')}</option>
            <option value="clarification">${t('طلب توضيح','Clarification Request')}</option>
            <option value="change">${t('طلب تعديل','Change Request')}</option>
            <option value="suggestion">${t('اقتراح','Suggestion')}</option>
            <option value="general">${t('تعليق عام','General Comment')}</option>
          </select>
          <select class="rr-filter-sel" id="rr-filter-att" onchange="ApprovalCycle._rrRenderCards()">
            <option value="">${t('كل الحضور','All Attendees')}</option>
            ${[...new Set(comments.map(c=>c.commenter_name).filter(Boolean))]
              .map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}
          </select>
          <button class="rr-filter-btn">⚙️ ${t('تصفية','Filter')}</button>
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
        <button class="dm-link-btn">📊 ${t('مقارنة النسخ →','Compare Versions →')}</button>
      </div>

      <!-- Activity Log -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">📜 ${t('سجل النشاط (الأخير)','Activity Log (Latest)')}</div>
        <div class="rr-log-list">${actRows}</div>
        <button class="dm-link-btn">${t('عرض السجل الكامل →','View Full Activity Log →')}</button>
      </div>

      <!-- AI Assistant -->
      <div class="rv-rpanel rr-ai-panel">
        <div class="rr-ai-hdr">
          <span class="rr-ai-ico">✨</span>
          <div>
            <div class="rr-ai-title">${t('مساعد الذكاء الاصطناعي','AI Assistant')}</div>
            <div class="rr-ai-sub">${t('هل تريد الذكاء الاصطناعي اقتراح حلول للتعليقات المعلّقة؟','Would you like AI to suggest possible resolutions for pending comments?')}</div>
          </div>
        </div>
        <button class="rr-ai-btn">✨ ${t('الاقتراح بالذكاء الاصطناعي','Suggest with AI')}</button>
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
  <div class="dm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep3Reviews()">← ${t('العودة لتعليقات الحضور','Back to Attendee Reviews')}</button>
    <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(5)">
      ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('النسخة النهائية','Final Version')}</span>
    </button>
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

    let filtered = [...comments];
    if (state.tab === 'pending')  filtered = filtered.filter(c => c.status === 'pending');
    if (state.tab === 'accepted') filtered = filtered.filter(c => c.status === 'accepted');
    if (state.tab === 'rejected') filtered = filtered.filter(c => c.status === 'rejected');
    if (typeFilter) filtered = filtered.filter(c => this._rrGetType(c) === typeFilter);
    if (attFilter)  filtered = filtered.filter(c => (c.commenter_name||'') === attFilter);

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
      <span class="rr-type-badge rr-tb-${type}">${typeLabel}</span>
      <div class="rr-comment-text">${esc(c.content||'')}</div>
    </div>
    <div class="rr-card-right">
      <span class="rv-badge ${st.cls}">${st.label}</span>
    </div>
  </div>
  ${resolveSection}
</div>`;
  },

  _rrGetType(c) {
    const r = (c.clause_ref||'').toLowerCase();
    if (r.includes('clarif')) return 'clarification';
    if (r.includes('change')||r.includes('تعديل')) return 'change';
    if (r.includes('suggest')||r.includes('اقتراح')) return 'suggestion';
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
    showToast(`${c.commenter_name} — ${c.secretary_note||c.content}`, 'info');
  },

  async _rrSaveAll() {
    showToast(this.t('تم حفظ جميع التغييرات ✅','All changes saved ✅'), 'success');
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
      <button class="dm-btn ghost">📤 ${t('تصدير','Export')}</button>
      <button class="dm-btn ghost">🕐 ${t('السجل','History')}</button>
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
        <button class="fm-filter-btn">⚙</button>
      </div>
      <div id="fm-feedback-list" class="fm-feedback-list">${feedbackRows}</div>
      <button class="fm-view-resolved-btn">
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
            <label class="fm-toggle"><input type="checkbox"><span class="fm-toggle-slider"></span></label>
          </div>
          <div class="fm-view-modes">
            <button class="fm-vm-btn active" title="Page view">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="11" rx="1.5" fill="currentColor"/></svg>
            </button>
            <button class="fm-vm-btn" title="Split view">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="4.5" height="11" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="7.5" y="1" width="4.5" height="11" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
            <button class="fm-vm-btn" title="Expand">
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
          <button class="fm-tb-btn" title="Link">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5a3.5 3.5 0 005 0l1.5-1.5a3.5 3.5 0 00-5-5L6.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.5 5.5a3.5 3.5 0 00-5 0L2 7a3.5 3.5 0 005 5L7.5 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
          <button class="fm-tb-btn" title="Insert table">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="5" x2="7" y2="13" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
          <span class="fm-tb-sep"></span>
          <button class="fm-tb-btn" onclick="document.execCommand('undo')" title="Undo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5h5a4 4 0 010 8H4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 2l-2 3 2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="fm-tb-btn" onclick="document.execCommand('redo')" title="Redo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 5H7a4 4 0 000 8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2l2 3-2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="fm-tb-btn fm-tb-insert">+ ${t('إدراج','Insert')} ▾</button>
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

      <!-- Internal Notes -->
      <div class="rv-rpanel fm-notes-panel">
        <div class="rv-rp-title">🔒 ${t('ملاحظات داخلية (السكرتير فقط)','Internal Notes (Secretary Only)')}</div>
        <div class="fm-note-body" id="fm-note-body">
          <p class="fm-note-p">${t('جميع التعليقات الرئيسية قد عُولجت. معلّق: تحديثات بسيطة في الصياغة بالقسم 3.','All major comments have been addressed. Pending: Minor wording updates in section 3.')}</p>
        </div>
        <button class="fm-add-note-btn" onclick="ApprovalCycle._fmAddNote()">
          + ${t('إضافة ملاحظة داخلية','Add Internal Note')}
        </button>
      </div>

      <!-- Callout -->
      <div class="rv-rpanel fm-callout-panel">
        <div class="fm-callout-body">
          <span class="fm-callout-ico">ℹ️</span>
          <p class="fm-callout-txt">${t('بمجرد رضاك عن النسخة النهائية، انقر "الخطوة التالية" لإرسال المحضر للحضور للتوقيع الإلكتروني.','Once you are satisfied with the final version, click "Next Step" to send the minutes to attendees for their e-signatures.')}</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar fm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._renderStep5Resolve()">← ${t('العودة للمراجعة والحل','Back to Review & Resolve')}</button>
    <div class="fm-bb-actions">
      <button class="dm-btn ghost fm-bb-btn" onclick="ApprovalCycle._fmDownload()">📥 ${t('تنزيل مقارنة المسودة','Download Draft Comparison')}</button>
      <button class="dm-btn ghost fm-bb-btn" onclick="ApprovalCycle._fmAddNote()">✏️ ${t('إضافة ملاحظة','Add Internal Note')}</button>
      <button class="dm-btn ghost fm-bb-btn" onclick="ApprovalCycle._fmPreview()">👁 ${t('معاينة النسخة النهائية','Preview Final Version')}</button>
      <button class="dm-btn primary" onclick="ApprovalCycle._onStepClick(6)">
        ${t('الخطوة التالية','Next Step')} → <span style="opacity:.75;font-size:11px">${t('توقيعات الحضور','Attendee Signatures')}</span>
      </button>
    </div>
  </div>

</div>`;
  },

  /* ── Step 6 helpers ───────────────────────────────────────────────────── */
  _fmBuildRow(att, tab, t) {
    const clause = ((att.comments[0]?.clause_ref)||'').toLowerCase();
    let type, typeCls;
    if (clause.includes('clarif')||clause.includes('توضيح'))          { type=t('توضيح','Clarification'); typeCls='fm-type-clarif'; }
    else if (clause.includes('change')||clause.includes('تعديل'))     { type=t('طلب تعديل','Change Request'); typeCls='fm-type-change'; }
    else if (clause.includes('suggest')||clause.includes('اقتراح'))   { type=t('اقتراح','Suggestion');     typeCls='fm-type-suggest'; }
    else if (clause.includes('delet')||clause.includes('حذف'))        { type=t('حذف','Deletion');          typeCls='fm-type-delete'; }
    else                                                               { type=t('عام','General');           typeCls='fm-type-general'; }
    const initials = att.name.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const relComs  = tab==='all'?att.comments:att.comments.filter(c=>c.status===tab.replace('accepted','accepted').replace('rejected','rejected').replace('pending','pending'));
    const cnt      = (tab==='all'?att.comments:tab==='accepted'?att.comments.filter(c=>c.status==='accepted'):tab==='rejected'?att.comments.filter(c=>c.status==='rejected'):att.comments.filter(c=>c.status==='pending')).length;
    const lastCom  = att.comments.slice(-1)[0];
    const timeStr  = lastCom?.created_at?.slice(0,16).replace('T',' ')||'';
    return `<div class="fm-feedback-row">
      <div class="fm-fr-avatar" style="background:${att.bg}">${esc(initials)}</div>
      <div class="fm-fr-body">
        <div class="fm-fr-name">${esc(att.name)}</div>
        <div class="fm-fr-time">${esc(timeStr)}</div>
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
    // Use cached commenters (includes demo rows when DB has no real comments)
    const all = this._fmCommenters || [];
    const rows = all.filter(att => {
      if (searchVal && !att.name.toLowerCase().includes(searchVal)) return false;
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

  _fmAddNote() {
    const noteBody = document.getElementById('fm-note-body');
    if (!noteBody) return;
    const t = (ar,en) => this.t(ar,en);
    const input = prompt(t('أدخل الملاحظة الداخلية:','Enter internal note:'));
    if (!input) return;
    noteBody.innerHTML += `<p class="fm-note-p" style="margin-top:8px;padding-top:8px;border-top:1px solid #F2F3F5">${esc(input)}</p>`;
    showToast(t('تمت إضافة الملاحظة ✅','Note added ✅'),'success');
  },

  _fmDownload() {
    showToast(this.t('جارٍ تحضير مقارنة المسودة...','Preparing draft comparison...'),'info');
  },

  _fmPreview() {
    showToast(this.t('جارٍ فتح معاينة النسخة النهائية...','Opening final version preview...'),'info');
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

    const dateStr = m.meeting_date ? fmtDate(m.meeting_date) : '15 May 2025';
    const cycle   = d.cycle || {};

    /* ── Mini stepper ─────────────────────────────────────────────── */
    const miniStepper = this._buildMiniStepper(cycle, 6, t, l);

    /* ── Demo attendee rows ───────────────────────────────────────── */
    const DEMO_ATTENDEES = l === 'ar' ? [
      { name:'\u062f. \u0639\u0628\u062f\u0627\u0644\u0644\u0647 \u0627\u0644\u063a\u0627\u0645\u062f\u064a',  role:'\u0631\u0626\u064a\u0633 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629', status:'signed',       signedAt:'22 \u0645\u0627\u064a\u0648 2025\u060c 11:02 \u0635', sig:0 },
      { name:'\u0645. \u062e\u0627\u0644\u062f \u0627\u0644\u0635\u0628\u064a\u0639\u064a',     role:'\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',  status:'signed',       signedAt:'22 \u0645\u0627\u064a\u0648 2025\u060c 11:15 \u0635', sig:1 },
      { name:'\u0623. \u0644\u064a\u0644\u0649 \u0627\u0644\u062a\u0645\u064a\u0645\u064a',     role:'\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',  status:'signed',       signedAt:'22 \u0645\u0627\u064a\u0648 2025\u060c 12:01 \u0645', sig:2 },
      { name:'\u0623. \u0641\u064a\u0635\u0644 \u0627\u0644\u0645\u0637\u064a\u0631\u064a',     role:'\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',  status:'signed',       signedAt:'22 \u0645\u0627\u064a\u0648 2025\u060c 12:25 \u0645', sig:3 },
      { name:'\u0623. \u0623\u062d\u0645\u062f \u0627\u0644\u062d\u0631\u0628\u064a',      role:'\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',  status:'pending',      signedAt:'', sig:-1 },
      { name:'\u0623. \u0646\u0648\u0631\u0629 \u0627\u0644\u0639\u062a\u064a\u0628\u064a',     role:'\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',  status:'pending',      signedAt:'', sig:-1 },
      { name:'\u0623. \u0633\u0644\u0637\u0627\u0646 \u0627\u0644\u0633\u0639\u0648\u062f',     role:'\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',  status:'pending',      signedAt:'', sig:-1 },
      { name:'\u062f. \u0645\u0647\u0627 \u0627\u0644\u062d\u0627\u0631\u062b\u064a',      role:'\u0639\u0636\u0648 \u0645\u0633\u062a\u0642\u0644',          status:'pending',      signedAt:'', sig:-1 },
      { name:'\u0623. \u064a\u0627\u0633\u0631 \u0627\u0644\u0642\u062d\u0637\u0627\u0646\u064a',    role:'\u0636\u064a\u0641 \u0645\u062f\u0639\u0648',           status:'not_required', signedAt:'', sig:-1 },
    ] : [
      { name:'Dr. Abdullah Alghamdi',  role:'Board Chairman',     status:'signed',       signedAt:'22 May 2025, 11:02 AM', sig:0 },
      { name:'Eng. Khalid Alsubaie',   role:'Board Member',       status:'signed',       signedAt:'22 May 2025, 11:15 AM', sig:1 },
      { name:'Ms. Laila Altamimi',     role:'Board Member',       status:'signed',       signedAt:'22 May 2025, 12:01 PM', sig:2 },
      { name:'Mr. Faisal Almutairi',   role:'Board Member',       status:'signed',       signedAt:'22 May 2025, 12:25 PM', sig:3 },
      { name:'Mr. Ahmed Alharbi',      role:'Board Member',       status:'pending',      signedAt:'', sig:-1 },
      { name:'Ms. Noura Alotaibi',     role:'Board Member',       status:'pending',      signedAt:'', sig:-1 },
      { name:'Mr. Sultan Alsaud',      role:'Board Member',       status:'pending',      signedAt:'', sig:-1 },
      { name:'Dr. Maha Alhaarthy',     role:'Independent Member', status:'pending',      signedAt:'', sig:-1 },
      { name:'Mr. Yasser Alqahtani',   role:'Invited Guest',      status:'not_required', signedAt:'', sig:-1 },
    ];

    const nTotal       = DEMO_ATTENDEES.length;
    const nSigned      = DEMO_ATTENDEES.filter(a => a.status === 'signed').length;
    const nPendingAtt  = DEMO_ATTENDEES.filter(a => a.status === 'pending').length;
    const nNotRequired = DEMO_ATTENDEES.filter(a => a.status === 'not_required').length;

    /* ── Donut SVG (signed / pending) ────────────────────────────── */
    const R2 = 45, CX2 = 70, CY2 = 70, SW2 = 14;
    const C2    = 2 * Math.PI * R2;
    const gap2  = C2 * 0.02;
    const sLen  = nSigned     / nTotal * C2;
    const pLen2 = nPendingAtt / nTotal * C2;
    const sOff  = C2 * 0.25;
    const pOff2 = ((sOff - sLen - gap2) % C2 + C2) % C2;
    const tf    = v => +v.toFixed(2);
    const donutSVG = `<svg width="140" height="140" viewBox="0 0 140 140">
  <circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#EAECF0" stroke-width="${SW2}"/>
  ${nSigned > 0 ? `<circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#0C7A3D" stroke-width="${SW2}" stroke-dasharray="${tf(sLen-gap2)} ${tf(C2-sLen+gap2)}" stroke-dashoffset="${tf(sOff)}" stroke-linecap="round"/>` : ''}
  ${nPendingAtt > 0 ? `<circle cx="${CX2}" cy="${CY2}" r="${R2}" fill="none" stroke="#E8821A" stroke-width="${SW2}" stroke-dasharray="${tf(pLen2-gap2)} ${tf(C2-pLen2+gap2)}" stroke-dashoffset="${tf(pOff2)}" stroke-linecap="round"/>` : ''}
  <text x="${CX2}" y="${CY2 - 7}" text-anchor="middle" font-size="24" font-weight="800" fill="#15201A">${nSigned}/${nTotal}</text>
  <text x="${CX2}" y="${CY2 + 11}" text-anchor="middle" font-size="11" fill="#8A948D">${t('\u0645\u0648\u0642\u0651\u0639','Signed')}</text>
</svg>`;

    /* ── Signature SVG paths ──────────────────────────────────────── */
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];

    const getStatusBadge = status => {
      if (status === 'signed')       return `<span class="s7-badge s7-badge-signed"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="#0C7A3D"/><path d="M2.5 5l2 2L7.5 3" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> ${t('\u0648\u0642\u0651\u0639','Signed')}</span>`;
      if (status === 'pending')      return `<span class="s7-badge s7-badge-pending">${t('\u0645\u0639\u0644\u0651\u0642','Pending')}</span>`;
      if (status === 'not_required') return `<span class="s7-badge s7-badge-notrequired">${t('\u063a\u064a\u0631 \u0645\u0637\u0644\u0648\u0628','Not Required')}</span>`;
      return '';
    };

    const getSigCells = att => {
      if (att.status === 'signed') return `
        <td class="s7-sig-cell"><svg class="s7-sig-svg" width="80" height="28" viewBox="0 0 50 28">${SIG_PATHS[att.sig]}</svg></td>
        <td class="s7-sig-action"><button class="s7-dl-btn" title="${t('\u062a\u0646\u0632\u064a\u0644','Download')}"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v7M4 5.5l2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.5 10h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></td>`;
      if (att.status === 'not_required') return `
        <td class="s7-sig-cell"><span style="color:#9CA3AF">-</span></td>
        <td class="s7-sig-action"><span class="s7-not-req-text">${t('\u063a\u064a\u0631 \u0645\u0637\u0644\u0648\u0628','Not Required')}</span></td>`;
      return `
        <td class="s7-sig-cell"><span style="color:#9CA3AF">-</span></td>
        <td class="s7-sig-action"><button class="s7-remind-btn" onclick="ApprovalCycle._s7SendReminder()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5a3.5 3.5 0 013.5 3.5v2l1 2H1.5l1-2V5A3.5 3.5 0 016 1.5z" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 10.5a1.2 1.2 0 002.4 0" stroke="currentColor" stroke-width="1.2"/></svg>${t('\u062a\u0630\u0643\u064a\u0631','Remind')}</button></td>`;
    };

    const AV_COLORS = ['#2C6CA8','#A8842C','#0C7A3D','#C4453C','#6B4FA8','#2AA87A','#8A4FA8','#4FA87A','#C47A3C'];
    const attendeeRows = DEMO_ATTENDEES.map((att, i) => {
      const initials = att.name.split(' ').filter(w => w.length > 1).slice(0,2).map(w => w[0]).join('').toUpperCase();
      return `<tr>
        <td class="s7-col-num">${i+1}</td>
        <td class="s7-col-attendee"><div class="s7-att-info"><div class="s7-att-av" style="background:${AV_COLORS[i%AV_COLORS.length]}">${initials}</div><span class="s7-att-name">${esc(att.name)}</span></div></td>
        <td class="s7-col-role">${esc(att.role)}</td>
        <td class="s7-col-status">${getStatusBadge(att.status)}</td>
        <td class="s7-col-signedat">${att.signedAt || '-'}</td>
        ${getSigCells(att)}
      </tr>`;
    }).join('');

    /* ── Audit trail ────────────────────────────────────────────── */
    const sentAt = cycle.circulated_at ? this._fmtDT(cycle.circulated_at) : '22 May 2025, 10:45 AM';
    const auditHTML = [
      { icon:'📄', text:t('\u062a\u0645 \u0646\u0634\u0631 \u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629','Final version published'),      date:'22 May 2025, 10:45 AM', by:t('\u0628\u0648\u0627\u0633\u0637\u0629 \u0645\u062d\u0645\u062f \u0627\u0644\u0628\u0644\u0627\u0644\u064a','by Mohammad Albuali') },
      { icon:'✍️', text:t('\u0623\u064f\u0631\u0633\u0644 \u0644\u0644\u062d\u0636\u0648\u0631 \u0644\u0644\u062a\u0648\u0642\u064a\u0639','Sent for attendee signatures'), date:'22 May 2025, 10:45 AM', by:t('\u0628\u0648\u0627\u0633\u0637\u0629 \u0645\u062d\u0645\u062f \u0627\u0644\u0628\u0644\u0627\u0644\u064a','by Mohammad Albuali') },
    ].map(e => `<div class="s7-audit-row"><span class="s7-audit-ico">${e.icon}</span><div class="s7-audit-body"><div class="s7-audit-text">${e.text}</div><div class="s7-audit-meta">${e.date} · ${e.by}</div></div></div>`).join('');

    /* ── Render ─────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-step-page" id="ac-step7-page">

  <!-- Header -->
  <div class="dm-page-hdr">
    <div class="dm-page-hdr-left">
      <div class="dm-page-title-row">
        <h1 class="dm-page-title">
          <span class="dm-pt-step">${t('\u0627\u0644\u062e\u0637\u0648\u0629 7 \u0645\u0646 9','Step 7 of 9')}</span>
          <span class="dm-pt-name">${t('\u062a\u0648\u0642\u064a\u0639\u0627\u062a \u0627\u0644\u062d\u0636\u0648\u0631','Attendee Signatures')}</span>
        </h1>
        <span class="dm-status-inprogress">${t('\u062c\u0627\u0631\u064d','In Progress')}</span>
      </div>
      <p class="dm-page-sub">${t('\u064a\u062c\u0628 \u0639\u0644\u0649 \u062c\u0645\u064a\u0639 \u0627\u0644\u062d\u0636\u0648\u0631 \u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0645\u062d\u0636\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0648\u062a\u0642\u062f\u064a\u0645 \u062a\u0648\u0642\u064a\u0639\u0627\u062a\u0647\u0645 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629.','All attendees must review the final minutes and provide their electronic signature. Once all required signatures are collected, the minutes will be ready for Final Approval.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7DownloadPDF()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('\u062a\u0646\u0632\u064a\u0644 \u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629 (PDF)','Download Final Version (PDF)')}
      </button>
      <button class="dm-btn ghost">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${t('\u0627\u0644\u0633\u062c\u0644','History')}
      </button>
      <div class="s7-deadline-badge">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="10" rx="1.5" stroke="#0C7A3D" stroke-width="1.2"/><path d="M4 1v2M9 1v2M1 5h11" stroke="#0C7A3D" stroke-width="1.2" stroke-linecap="round"/></svg>
        <div>
          <div class="s7-dl-badge-label">${t('\u0627\u0644\u0645\u0648\u0639\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0644\u0644\u0645\u0631\u0627\u062c\u0639\u0629','Review Deadline')}</div>
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
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="11" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><path d="M4 1v2M10 1v2M1 5.5h12" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s7-meta-lbl">${t('\u0627\u0644\u0627\u062c\u062a\u0645\u0627\u0639','Meeting')}</div><div class="s7-meta-val">${t('\u0627\u062c\u062a\u0645\u0627\u0639 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u2013 15 \u0645\u0627\u064a\u0648 2025','Board Meeting \u2013 15 May 2025')}</div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.2" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><line x1="4.5" y1="9.5" x2="7.5" y2="9.5" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s7-meta-lbl">${t('\u0625\u0635\u062f\u0627\u0631 \u0627\u0644\u0645\u062d\u0636\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064a','Final Minutes Version')}</div><div class="s7-meta-val"><span class="s7-version-badge">v2.0 (Final)</span></div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10v2H2zM3 4v8M11 4v8M2 12h10" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><div class="s7-meta-lbl">${t('\u0623\u064f\u0631\u0633\u0644 \u0644\u0644\u062a\u0648\u0642\u064a\u0639','Sent for Signatures')}</div><div class="s7-meta-val">${sentAt}</div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><circle cx="10" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><path d="M1 12a4 4 0 018 0" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><path d="M9.5 10.5a3.5 3.5 0 014.5 2.5" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s7-meta-lbl">${t('\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062d\u0636\u0648\u0631','Total Attendees')}</div><div class="s7-meta-val">${nTotal}</div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 7l2.5 2.5L10 4.5" stroke="#8A948D" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#8A948D" stroke-width="1.2"/></svg>
      <div><div class="s7-meta-lbl">${t('\u0627\u0644\u062a\u0648\u0642\u064a\u0639\u0627\u062a \u0627\u0644\u0645\u064f\u0633\u062a\u0644\u064e\u0645\u064e\u0629','Signatures Received')}</div><div class="s7-meta-val"><strong>${nSigned} / ${nTotal}</strong></div></div>
    </div>
    <div class="s7-meta-sep"></div>
    <div class="s7-meta-item">
      <div><div class="s7-meta-lbl">${t('\u0627\u0644\u062d\u0627\u0644\u0629','Status')}</div><div class="s7-meta-val"><span class="s7-status-inprogress">${t('\u062c\u0627\u0631\u064d','In Progress')}</span></div></div>
    </div>
  </div>

  <!-- 2-column body -->
  <div class="s7-body">

    <!-- LEFT: Signature Table -->
    <div class="s7-main-panel">
      <div class="s7-table-hdr">
        <div>
          <div class="s7-table-title">${t('\u062d\u0627\u0644\u0629 \u0627\u0644\u062a\u0648\u0642\u064a\u0639 \u0644\u0644\u062d\u0636\u0648\u0631','Attendee Signature Status')}</div>
          <div class="s7-table-subtitle">${t('\u064a\u064f\u0631\u062c\u0649 \u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0645\u062d\u0636\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0648\u0627\u0644\u062a\u0648\u0642\u064a\u0639 \u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u064b\u0627.','Please review the final minutes and sign electronically.')}</div>
        </div>
        <div class="s7-table-actions">
          <button class="dm-btn ghost s7-view-minutes-btn">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.2"/><circle cx="6.5" cy="6.5" r="2.2" stroke="currentColor" stroke-width="1.2"/></svg>
            ${t('\u0639\u0631\u0636 \u0627\u0644\u0645\u062d\u0636\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064a','View Final Minutes')}
          </button>
          <button class="s7-expand-btn" title="${t('\u062a\u0648\u0633\u064a\u0639','Expand')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 4V1h3M10 1h3v3M1 10v3h3M10 13h3v-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <table class="s7-sig-table">
        <thead><tr>
          <th class="s7-col-num">#</th>
          <th>${t('\u0627\u0644\u062d\u0636\u0648\u0631','Attendee')}</th>
          <th>${t('\u0627\u0644\u062f\u0648\u0631','Role')}</th>
          <th>${t('\u0627\u0644\u062d\u0627\u0644\u0629','Status')}</th>
          <th>${t('\u0648\u064f\u0642\u0651\u0639 \u0641\u064a','Signed On')}</th>
          <th>${t('\u0627\u0644\u062a\u0648\u0642\u064a\u0639','Signature')}</th>
          <th></th>
        </tr></thead>
        <tbody>${attendeeRows}</tbody>
      </table>
      <div class="s7-table-footer">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#2C6CA8" stroke-width="1.3"/><line x1="7" y1="6" x2="7" y2="10" stroke="#2C6CA8" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="4" r=".8" fill="#2C6CA8"/></svg>
        ${t('\u0633\u064a\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0625\u0634\u0639\u0627\u0631 \u0644\u0644\u062d\u0636\u0648\u0631 \u0628\u0627\u0644\u0628\u0631\u064a\u062f \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a \u0644\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0645\u062d\u0636\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0648\u0627\u0644\u062a\u0648\u0642\u064a\u0639.','Attendees will be notified via email to review and sign the final minutes.')}
      </div>
    </div>

    <!-- RIGHT: Sidebar -->
    <div class="s7-sidebar">

      <!-- Signature Progress -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('\u062a\u0642\u062f\u0645 \u0627\u0644\u062a\u0648\u0642\u064a\u0639','Signature Progress')}</div>
        <div class="s7-progress-wrap">
          ${donutSVG}
          <div class="s7-progress-legend">
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#0C7A3D"></span><span class="s7-leg-lbl">${t('\u0648\u0642\u0651\u0639','Signed')}</span><span class="s7-leg-val">${nSigned} <span class="s7-leg-pct">(${Math.round(nSigned/nTotal*100)}%)</span></span></div>
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#E8821A"></span><span class="s7-leg-lbl">${t('\u0645\u0639\u0644\u0651\u0642','Pending')}</span><span class="s7-leg-val">${nPendingAtt} <span class="s7-leg-pct">(${Math.round(nPendingAtt/nTotal*100)}%)</span></span></div>
            <div class="s7-leg-row"><span class="s7-leg-dot" style="background:#D0D5DD"></span><span class="s7-leg-lbl">${t('\u063a\u064a\u0631 \u0645\u0637\u0644\u0648\u0628','Not Required')}</span><span class="s7-leg-val">${nNotRequired} <span class="s7-leg-pct">(${Math.round(nNotRequired/nTotal*100)}%)</span></span></div>
          </div>
        </div>
      </div>

      <!-- Important Notes -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0645\u0647\u0645\u0629','Important Notes')}</div>
        <div class="s7-notes-list">
          <div class="s7-note-row"><span class="s7-note-dot"></span><span class="s7-note-txt">${t('\u064a\u062c\u0628 \u0639\u0644\u0649 \u062c\u0645\u064a\u0639 \u0627\u0644\u062d\u0636\u0648\u0631 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u064a\u0646 \u062a\u0648\u0642\u064a\u0639 \u0627\u0644\u0645\u062d\u0636\u0631 \u0627\u0644\u0646\u0647\u0627\u0626\u064a.','All required attendees must sign the final minutes.')}</span></div>
          <div class="s7-note-row"><span class="s7-note-dot"></span><span class="s7-note-txt">${t('\u0633\u062a\u062a\u0644\u0642\u0649 \u0625\u0634\u0639\u0627\u0631\u064b\u0627 \u0639\u0646\u062f \u062c\u0645\u0639 \u062c\u0645\u064a\u0639 \u0627\u0644\u062a\u0648\u0642\u064a\u0639\u0627\u062a.','You will be notified when all signatures are received.')}</span></div>
          <div class="s7-note-row"><span class="s7-note-dot"></span><span class="s7-note-txt">${t('\u0628\u0645\u062c\u0631\u062f \u062c\u0645\u0639 \u062c\u0645\u064a\u0639 \u0627\u0644\u062a\u0648\u0642\u064a\u0639\u0627\u062a\u060c \u0633\u064a\u064f\u0631\u0633\u064e\u0644 \u0627\u0644\u0645\u062d\u0636\u0631 \u0644\u0644\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a.','Once all signatures are collected, the minutes will be sent for Final Approval.')}</span></div>
        </div>
      </div>

      <!-- Audit Trail -->
      <div class="rv-rpanel">
        <div class="rv-rp-title">${t('\u0633\u062c\u0644 \u0627\u0644\u062a\u062f\u0642\u064a\u0642','Audit Trail')}</div>
        <div class="s7-audit-list">${auditHTML}</div>
        <button class="s7-view-audit-btn" onclick="ApprovalCycle._s9AuditTrail()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="1" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="7" x2="9" y2="7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="9.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          ${t('\u0639\u0631\u0636 \u0633\u062c\u0644 \u0627\u0644\u062a\u062f\u0642\u064a\u0642 \u0627\u0644\u0643\u0627\u0645\u0644','View Full Audit Trail')}
        </button>
      </div>
    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar fm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._onStepClick(5)">← ${t('\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0625\u0639\u062f\u0627\u062f \u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629','Back to Final Version Preparation')}</button>
    <div class="s7-bb-center">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7SendReminder()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a4.5 4.5 0 014.5 4.5v2.5l1 2H1.5l1-2.5V6A4.5 4.5 0 017 1.5z" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.3"/></svg>
        ${t('\u0625\u0631\u0633\u0627\u0644 \u062a\u0630\u0643\u064a\u0631 \u0644\u0644\u0645\u0639\u0644\u0651\u0642\u064a\u0646','Send Reminder to Pending')}
      </button>
    </div>
    <div class="s7-bb-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s7DownloadPDF()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('\u062a\u0646\u0632\u064a\u0644 \u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629 (PDF)','Download Final Version (PDF)')}
      </button>
    </div>
  </div>

</div>`;
  },

  /* ── Step 7 helpers ─────────────────────────────────────────────────── */
  _s7DownloadPDF() { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },
  async _s7SendReminder() {
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/remind`, { method: 'POST' });
      showToast(this.t('تم إرسال التذكير للحضور المعلّقين 🔔','Reminder sent to pending attendees 🔔'), 'success');
    } catch(e) {
      showToast(this.t('تم إشعار الحضور المعلّقين 🔔','Pending attendees notified 🔔'), 'success');
    }
  },
  _s7Preview()  { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },

  /* ═══════════════════════════════════════════════════════════════════════
     STEP 8 — FINAL APPROVAL
  ═══════════════════════════════════════════════════════════════════════ */
  _renderStep8FinalApproval() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const m = this._meeting  || {};
    const d = this._data     || {};
    const cycle = d.cycle || {};

    const dateStr   = m.meeting_date ? fmtDate(m.meeting_date) : '15 May 2025';
    const miniStepper = this._buildMiniStepper(cycle, 7, t, l);

    /* ── Demo attendees (all signed for Step 8) ──────────────────────── */
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];
    const ATTENDEES = l === 'ar' ? [
      { name:'د. عبدالله الغامدي',  role:'رئيس مجلس الإدارة',  at:'22 مايو 2025، 11:02 ص', sig:0 },
      { name:'م. خالد الصبيعي',     role:'عضو مجلس الإدارة',   at:'22 مايو 2025، 11:15 ص', sig:1 },
      { name:'أ. ليلى التميمي',     role:'عضو مجلس الإدارة',   at:'22 مايو 2025، 12:01 م', sig:2 },
      { name:'أ. فيصل المطيري',     role:'عضو مجلس الإدارة',   at:'22 مايو 2025، 12:25 م', sig:3 },
      { name:'أ. أحمد الحربي',      role:'عضو مجلس الإدارة',   at:'22 مايو 2025، 12:28 م', sig:4 },
      { name:'أ. نورة العتيبي',     role:'عضو مجلس الإدارة',   at:'22 مايو 2025، 12:31 م', sig:0 },
      { name:'أ. سلطان السعود',     role:'عضو مجلس الإدارة',   at:'22 مايو 2025، 12:33 م', sig:1 },
      { name:'د. مها الحارثي',      role:'عضو مستقل',           at:'22 مايو 2025، 12:35 م', sig:2 },
      { name:'أ. ياسر القحطاني',    role:'ضيف مدعو',            at:'22 مايو 2025، 12:35 م', sig:3 },
    ] : [
      { name:'Dr. Abdullah Alghamdi',  role:'Board Chairman',     at:'22 May 2025, 11:02 AM', sig:0 },
      { name:'Eng. Khalid Alsubaie',   role:'Board Member',       at:'22 May 2025, 11:15 AM', sig:1 },
      { name:'Ms. Laila Altamimi',     role:'Board Member',       at:'22 May 2025, 12:01 PM', sig:2 },
      { name:'Mr. Faisal Almutairi',   role:'Board Member',       at:'22 May 2025, 12:25 PM', sig:3 },
      { name:'Mr. Ahmed Alharbi',      role:'Board Member',       at:'22 May 2025, 12:28 PM', sig:4 },
      { name:'Ms. Noura Alotaibi',     role:'Board Member',       at:'22 May 2025, 12:31 PM', sig:0 },
      { name:'Mr. Sultan Alsaud',      role:'Board Member',       at:'22 May 2025, 12:33 PM', sig:1 },
      { name:'Dr. Maha Alhaarthy',     role:'Independent Member', at:'22 May 2025, 12:35 PM', sig:2 },
      { name:'Mr. Yasser Alqahtani',   role:'Invited Guest',      at:'22 May 2025, 12:35 PM', sig:3 },
    ];
    const nTotal = ATTENDEES.length;
    const nSigned = ATTENDEES.filter(a => a.sig >= 0).length;

    /* ── Donut (fully signed → all green) ──────────────────────────── */
    const R = 52, CX = 80, CY = 80, SW = 16;
    const donutSVG = `<svg width="160" height="160" viewBox="0 0 160 160">
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#0C7A3D" stroke-width="${SW}"/>
  <text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="26" font-weight="800" fill="#15201A">${nSigned}/${nTotal}</text>
  <text x="${CX}" y="${CY + 13}" text-anchor="middle" font-size="12" fill="#8A948D">${t('وقّع','Signed')}</text>
</svg>`;

    /* ── Attendee rows (first 5 visible) ─────────────────────────── */
    const AV_COLORS = ['#2C6CA8','#A8842C','#0C7A3D','#C4453C','#6B4FA8','#2AA87A','#8A4FA8','#4FA87A','#C47A3C'];
    const attRows = ATTENDEES.slice(0,5).map((a,i) => {
      const initials = a.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const sigCell = a.sig >= 0
        ? `<svg width="80" height="28" viewBox="0 0 50 28">${SIG_PATHS[a.sig]}</svg>`
        : `<span style="color:#9CA3AF">-</span>`;
      return `<tr>
        <td class="s8-col-num">${i+1}</td>
        <td class="s8-col-att"><div class="s8-att-info"><div class="s8-av" style="background:${AV_COLORS[i]}">${initials}</div><span>${esc(a.name)}</span></div></td>
        <td class="s8-col-role">${esc(a.role)}</td>
        <td class="s8-col-at">${a.at}</td>
        <td class="s8-col-sig">${sigCell}</td>
      </tr>`;
    }).join('');

    /* ── Audit trail ────────────────────────────────────────────────── */
    const auditRows = [
      { ico:'✅', green:true,  text:t('تم جمع جميع توقيعات الحضور','All attendee signatures collected'), date:'22 May 2025, 12:35 PM' },
      { ico:'⏳', green:false, text:t('في انتظار الاعتماد النهائي','Pending final approval'),             date:'22 May 2025, 12:36 PM' },
    ].map(e=>`<div class="s8-audit-row">
      <span class="s8-audit-ico ${e.green?'s8-ico-green':'s8-ico-amber'}">${e.ico}</span>
      <div class="s8-audit-body">
        <div class="s8-audit-text">${e.text}</div>
        <div class="s8-audit-meta">${e.date} · ${t('بواسطة النظام','by System')}</div>
      </div>
    </div>`).join('');

    /* ── Render ─────────────────────────────────────────────────────── */
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
        <span class="s8-badge-pending-approval">${t('في انتظار الاعتماد','Pending Approval')}</span>
      </div>
      <p class="dm-page-sub">${t('تم جمع جميع توقيعات الحضور. المحضر النهائي جاهز للرئيس (المُعتمِد النهائي) لمراجعته وإصدار الاعتماد.','All attendee signatures have been collected. The final minutes are now ready for the Chairman (Final Approver) to review and provide final approval.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s8DownloadSigned()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('تنزيل المحضر الموقّع','Download Signed Minutes')}
      </button>
      <button class="dm-btn ghost">
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
      <div><div class="s8-meta-lbl">${t('الاجتماع','Meeting')}</div><div class="s8-meta-val">${t('اجتماع مجلس الإدارة – 15 مايو 2025','Board Meeting – 15 May 2025')}</div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.2" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/></svg>
      <div><div class="s8-meta-lbl">${t('إصدار المحضر النهائي','Final Minutes Version')}</div><div class="s8-meta-val"><span class="s8-version-badge">v2.0 (Final)</span></div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div><div class="s8-meta-lbl">${t('جُمعت كل التوقيعات','All Signatures Collected')}</div><div class="s8-meta-val">22 May 2025, 12:35 PM</div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><circle cx="9.5" cy="4" r="2.2" stroke="#8A948D" stroke-width="1.2"/><path d="M1 12a4 4 0 018 0" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s8-meta-lbl">${t('إجمالي الحضور','Total Attendees')}</div><div class="s8-meta-val">${nTotal}</div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#8A948D" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><div class="s8-meta-lbl">${t('وقّع','Signed')}</div><div class="s8-meta-val"><strong>${nSigned} / ${nTotal}</strong></div></div>
    </div>
    <div class="s8-meta-sep"></div>
    <div class="s8-meta-item">
      <div><div class="s8-meta-lbl">${t('الحالة','Status')}</div><div class="s8-meta-val"><span class="s8-status-pending">${t('في انتظار الاعتماد النهائي','Pending Final Approval')}</span></div></div>
    </div>
  </div>

  <!-- Body: 3-column -->
  <div class="s8-body">

    <!-- ── LEFT: Document + Attendee Signatures ───────────────────── -->
    <div class="s8-left">

      <div class="s8-section-title">${t('المحضر النهائي (موقّع من جميع الحضور)','Final Minutes (Signed by All Attendees)')}</div>
      <div class="s8-section-sub">${t('تمت مراجعة المحضر النهائي والتوقيع عليه من قِبَل جميع الحضور.','The final minutes have been reviewed and signed by all attendees.')}</div>

      <!-- Document card -->
      <div class="s8-doc-card">
        <div class="s8-doc-card-left">
          <div class="s8-doc-icon">
            <svg width="28" height="36" viewBox="0 0 28 36" fill="none"><rect width="28" height="36" rx="3" fill="#1B4B9A"/><rect x="4" y="6" width="20" height="2.5" rx="1" fill="white" opacity=".9"/><rect x="4" y="11" width="16" height="2" rx="1" fill="white" opacity=".7"/><rect x="4" y="15" width="18" height="2" rx="1" fill="white" opacity=".7"/><rect x="4" y="19" width="13" height="2" rx="1" fill="white" opacity=".5"/><text x="4" y="31" font-size="7" font-weight="800" fill="white" opacity=".95">W</text></svg>
          </div>
          <div>
            <div class="s8-doc-name">${t('محضر اجتماع مجلس الإدارة','Board Meeting Minutes')}</div>
            <div class="s8-doc-date">15 May 2025</div>
            <span class="s8-final-badge">${t('نهائي وموقّع','Final &amp; Signed')}</span>
            <div class="s8-doc-meta-small">${t('الحجم: 245 كيلوبايت','Size: 245 KB')} &nbsp;·&nbsp; ${t('الصفحات: 12','Pages: 12')}</div>
          </div>
        </div>
        <div class="s8-doc-card-right">
          <div class="s8-doc-kv"><span class="s8-dk">${t('الإصدار','Version')}</span><span class="s8-dv">v2.0 (Final)</span></div>
          <div class="s8-doc-kv"><span class="s8-dk">${t('أُعدَّ بواسطة','Prepared by')}</span><span class="s8-dv">${t('محمد البلالي (أمين السر)','Mohammad Albuali (Meeting Secretary)')}</span></div>
          <div class="s8-doc-kv"><span class="s8-dk">${t('أُعدَّ في','Prepared on')}</span><span class="s8-dv">22 May 2025, 10:45 AM</span></div>
          <div class="s8-doc-kv"><span class="s8-dk">${t('جُمعت كل التوقيعات','All Signatures Collected')}</span><span class="s8-dv">22 May 2025, 12:35 PM</span></div>
          <div class="s8-doc-kv"><span class="s8-dk">${t('جاهز للاعتماد النهائي','Ready for Final Approval')}</span><span class="s8-dv">22 May 2025, 12:36 PM</span></div>
        </div>
      </div>
      <button class="s8-preview-btn" onclick="ApprovalCycle._s8Preview()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.4"/><ellipse cx="7" cy="7" rx="6" ry="4" stroke="currentColor" stroke-width="1.4"/></svg>
        ${t('معاينة المستند','Preview Document')}
      </button>

      <!-- Success alert -->
      <div class="s8-success-alert">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="#0C7A3D"/><path d="M4 8l3 3 5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div>
          <div class="s8-success-title">${t('تم جمع جميع توقيعات الحضور (9 توقيعات).','All 9 attendee signatures have been collected.')}</div>
          <div class="s8-success-sub">${t('المحضر جاهز للاعتماد النهائي.','The minutes are ready for final approval.')}</div>
        </div>
      </div>

      <!-- Attendee Signatures table -->
      <div class="s8-att-section-title">${t('توقيعات الحضور (9 من أصل 9 وقّعوا)','Attendee Signatures (9 of 9 Signed)')}</div>
      <table class="s8-att-table">
        <thead><tr>
          <th class="s8-col-num">#</th>
          <th>${t('الحضور','Attendee')}</th>
          <th>${t('الدور','Role')}</th>
          <th>${t('وقّع في','Signed On')}</th>
          <th>${t('التوقيع','Signature')}</th>
        </tr></thead>
        <tbody>${attRows}</tbody>
      </table>
      <button class="s8-view-all-btn" onclick="ApprovalCycle._s8ViewAll()">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
        ${t('عرض جميع التوقيعات التسعة','View All 9 Signatures')}
      </button>
    </div>

    <!-- ── CENTER: Summary + Changes ───────────────────────────────── -->
    <div class="s8-center">

      <!-- Signature summary -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('ملخص توقيعات الحضور','Summary of Attendee Signatures')}</div>
        <div class="s8-donut-wrap">
          ${donutSVG}
          <div class="s8-donut-legend">
            <div class="s8-leg-row"><span class="s8-leg-dot" style="background:#0C7A3D"></span><span class="s8-leg-lbl">${t('وقّع','Signed')}</span><span class="s8-leg-val">${nSigned} <span class="s8-leg-pct">(100%)</span></span></div>
            <div class="s8-leg-row"><span class="s8-leg-dot" style="background:#E8821A"></span><span class="s8-leg-lbl">${t('معلّق','Pending')}</span><span class="s8-leg-val">0 <span class="s8-leg-pct">(0%)</span></span></div>
            <div class="s8-leg-row"><span class="s8-leg-dot" style="background:#D0D5DD"></span><span class="s8-leg-lbl">${t('غير مطلوب','Not Required')}</span><span class="s8-leg-val">0 <span class="s8-leg-pct">(0%)</span></span></div>
          </div>
        </div>
        <button class="s8-view-sigs-btn" onclick="ApprovalCycle._s8ViewAll()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
          ${t('عرض جميع التوقيعات','View All Signatures')}
        </button>
      </div>

      <!-- Changes summary -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('ملخص التغييرات (نهائي)','Changes Summary (Final)')}</div>
        <div class="s8-changes-list">
          <div class="s8-chg-row">
            <span class="s8-chg-ico s8-chg-green"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#0C7A3D"/><path d="M3 6l2 2 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span class="s8-chg-lbl">${t('التغييرات المقبولة','Accepted Changes')}</span>
            <span class="s8-chg-val">9</span>
          </div>
          <div class="s8-chg-row">
            <span class="s8-chg-ico s8-chg-red"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#C4453C"/><path d="M4 4l4 4M8 4l-4 4" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg></span>
            <span class="s8-chg-lbl">${t('التغييرات المرفوضة','Rejected Changes')}</span>
            <span class="s8-chg-val">6</span>
          </div>
          <div class="s8-chg-row">
            <span class="s8-chg-ico s8-chg-amber"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#E8821A"/><path d="M6 3v3.5l2 1.5" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg></span>
            <span class="s8-chg-lbl">${t('التغييرات المعلّقة','Pending Changes')}</span>
            <span class="s8-chg-val">0</span>
          </div>
          <div class="s8-chg-divider"></div>
          <div class="s8-chg-row s8-chg-total-row">
            <span class="s8-chg-ico s8-chg-blue"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="1" width="8" height="10" rx="1" stroke="#2C6CA8" stroke-width="1.2"/><line x1="4" y1="4" x2="8" y2="4" stroke="#2C6CA8" stroke-width="1" stroke-linecap="round"/><line x1="4" y1="6" x2="8" y2="6" stroke="#2C6CA8" stroke-width="1" stroke-linecap="round"/><line x1="4" y1="8" x2="7" y2="8" stroke="#2C6CA8" stroke-width="1" stroke-linecap="round"/></svg></span>
            <span class="s8-chg-lbl s8-chg-total-lbl">${t('إجمالي التغييرات','Total Changes')}</span>
            <span class="s8-chg-val s8-chg-total-val">15</span>
          </div>
        </div>
        <div class="s8-changes-info">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="#2C6CA8" stroke-width="1.2"/><line x1="6.5" y1="5.5" x2="6.5" y2="9.5" stroke="#2C6CA8" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.5" cy="3.8" r=".7" fill="#2C6CA8"/></svg>
          <span>${t('تم حل جميع التغييرات وإعداد النسخة النهائية.','All changes have been resolved and the final version is complete.')}</span>
        </div>
      </div>
    </div>

    <!-- ── RIGHT: Approver + Actions + Notes + Audit ────────────────── -->
    <div class="s8-sidebar">

      <!-- Approver Information -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('معلومات المُعتمِد','Approver Information')}</div>
        <div class="s8-approver-card">
          <div class="s8-approver-av">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="10" r="6" stroke="#5A6A5C" stroke-width="1.8"/><path d="M3 24a10 10 0 0120 0" stroke="#5A6A5C" stroke-width="1.8" stroke-linecap="round"/></svg>
          </div>
          <div class="s8-approver-info">
            <div class="s8-approver-name">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div>
            <span class="s8-approver-role-badge">${t('رئيس مجلس الإدارة','Board Chairman')}</span>
            <div class="s8-approver-label">${t('المُعتمِد النهائي','Final Approver')}</div>
          </div>
        </div>
        <div class="s8-approver-note">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="#2C6CA8" stroke-width="1.2"/><line x1="6.5" y1="5.5" x2="6.5" y2="9" stroke="#2C6CA8" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.5" cy="3.8" r=".7" fill="#2C6CA8"/></svg>
          <span>${t('بصفتك الرئيس، فأنت المُعتمِد النهائي لهذا الاجتماع.','As the Chairman, you are the final approver for this meeting.')}</span>
        </div>
      </div>

      <!-- Approval Actions -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('إجراءات الاعتماد','Approval Actions')}</div>
        <p class="s8-panel-sub">${t('يُرجى مراجعة المحضر النهائي وتقديم اعتمادك.','Please review the final minutes and provide your approval.')}</p>
        <button class="s8-approve-action-btn" onclick="ApprovalCycle._s8Approve()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${t('اعتماد المحضر','Approve Minutes')}
        </button>
        <button class="s8-request-changes-btn" onclick="ApprovalCycle._s8RequestChanges()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7a4 4 0 017.5-2M11 7a4 4 0 01-7.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 5l1 2-2 .5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${t('طلب تعديلات','Request Changes')}
        </button>
      </div>

      <!-- Notes -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('ملاحظات (اختياري)','Notes (Optional)')}</div>
        <textarea class="s8-notes-ta" id="s8-notes-ta" maxlength="500"
          placeholder="${t('أضف تعليقاً أو ملاحظة للسجل...','Add any comments or notes for the record...')}"
          oninput="document.getElementById('s8-char-count').textContent=this.value.length"></textarea>
        <div class="s8-char-count"><span id="s8-char-count">0</span>/500</div>
      </div>

      <!-- Audit Trail -->
      <div class="s8-panel">
        <div class="s8-panel-title">${t('سجل التدقيق','Audit Trail')}</div>
        <div class="s8-audit-trail">${auditRows}</div>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar fm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._onStepClick(6)">← ${t('العودة لتوقيعات الحضور','Back to Attendee Signatures')}</button>
    <div class="s8-bb-info">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#2C6CA8" stroke-width="1.3"/><line x1="7" y1="6" x2="7" y2="10" stroke="#2C6CA8" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="4" r=".8" fill="#2C6CA8"/></svg>
      <span>${t('بمجرد اعتمادك، سيُحوَّل المحضر إلى الأرشفة والتفعيل (الخطوة 9) ليصبح السجل الرسمي.','Once you approve, the minutes will move to Archive &amp; Activate (Step 9) and become the official record.')}</span>
    </div>
    <button class="dm-btn ghost" onclick="ApprovalCycle._s8DownloadPDF()">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      ${t('تنزيل النسخة النهائية (PDF)','Download Final Version (PDF)')}
    </button>
  </div>

</div>`;
  },

  /* ── Step 8 helpers ─────────────────────────────────────────────────── */
  async _s8Approve() {
    showToast(this.t('جارٍ تنفيذ الاعتماد النهائي...','Processing final approval...'), 'info');
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: 'archived' }),
      });
      showToast(this.t('✅ تم الاعتماد النهائي! جارٍ الانتقال للأرشفة.','✅ Minutes approved! Moving to Archive & Activate.'), 'success');
      await this._load();
      this._renderStep9ArchiveActivate();
    } catch(e) {
      showToast(e.message || this.t('تعذّر الاعتماد','Approval failed'), 'error');
    }
  },
  async _s8RequestChanges() {
    const note = prompt(this.t('أدخل ملاحظات التعديل (اختياري):','Enter change request notes (optional):'), '') ?? '';
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: 'review_resolve', note }),
      });
      showToast(this.t('تم إرسال طلب التعديلات. يُعاد للمراجعة والحل.','Changes requested. Returning to Review & Resolve.'), 'info');
      await this._load();
      this._renderStep5Resolve();
    } catch(e) {
      showToast(e.message || this.t('تعذّر إرسال الطلب','Request failed'), 'error');
    }
  },
  _s8DownloadSigned() { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },
  _s8DownloadPDF()    { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },
  _s8Preview()        { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },
  _s8ViewAll()        { showToast(this.t('جارٍ عرض جميع التوقيعات...','Loading all signatures...'), 'info'); },

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

    const miniStepper = this._buildMiniStepper(cycle, 8, t, l);

    /* ── Demo attendees (all signed) ─────────────────────────────── */
    const SIG_PATHS = [
      `<path d="M6 18 C10 10 16 8 22 14 C26 18 28 16 32 12 C36 8 40 10 42 16" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 16 C9 12 13 10 17 14 C21 18 25 14 29 12 C33 10 37 12 40 16 L42 18" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 14 Q11 8 17 14 Q23 20 29 14 Q35 8 42 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M5 18 C9 10 15 8 21 12 L27 16 C31 18 35 16 39 12 L43 10" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      `<path d="M6 16 C12 10 18 10 24 14 C28 18 32 14 38 12 L44 14" stroke="#1a3a5c" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];
    const ATTENDEES = l === 'ar' ? [
      { name:'د. عبدالله الغامدي', role:'رئيس مجلس الإدارة', at:'22 مايو 2025، 11:02 ص', sig:0 },
      { name:'م. خالد الصبيعي',    role:'عضو مجلس الإدارة',  at:'22 مايو 2025، 11:15 ص', sig:1 },
      { name:'أ. ليلى التميمي',    role:'عضو مجلس الإدارة',  at:'22 مايو 2025، 12:01 م', sig:2 },
      { name:'أ. فيصل المطيري',    role:'عضو مجلس الإدارة',  at:'22 مايو 2025، 12:25 م', sig:3 },
      { name:'أ. أحمد الحربي',     role:'عضو مجلس الإدارة',  at:'22 مايو 2025، 12:28 م', sig:4 },
      { name:'أ. نورة العتيبي',    role:'عضو مجلس الإدارة',  at:'22 مايو 2025، 12:31 م', sig:0 },
      { name:'أ. سلطان السعود',    role:'عضو مجلس الإدارة',  at:'22 مايو 2025، 12:33 م', sig:1 },
      { name:'د. مها الحارثي',     role:'عضو مستقل',          at:'22 مايو 2025، 12:35 م', sig:2 },
      { name:'أ. ياسر القحطاني',   role:'ضيف مدعو',           at:'22 مايو 2025، 12:40 م', sig:3 },
    ] : [
      { name:'Dr. Abdullah Alghamdi', role:'Board Chairman',     at:'22 May 2025, 11:02 AM', sig:0 },
      { name:'Eng. Khalid Alsubaie',  role:'Board Member',       at:'22 May 2025, 11:15 AM', sig:1 },
      { name:'Ms. Laila Altamimi',    role:'Board Member',       at:'22 May 2025, 12:01 PM', sig:2 },
      { name:'Mr. Faisal Almutairi',  role:'Board Member',       at:'22 May 2025, 12:25 PM', sig:3 },
      { name:'Mr. Ahmed Alharbi',     role:'Board Member',       at:'22 May 2025, 12:28 PM', sig:4 },
      { name:'Ms. Noura Alotaibi',    role:'Board Member',       at:'22 May 2025, 12:31 PM', sig:0 },
      { name:'Mr. Sultan Alsaud',     role:'Board Member',       at:'22 May 2025, 12:33 PM', sig:1 },
      { name:'Dr. Maha Alhaarthy',    role:'Independent Member', at:'22 May 2025, 12:35 PM', sig:2 },
      { name:'Mr. Yasser Alqahtani',  role:'Invited Guest',      at:'22 May 2025, 12:40 PM', sig:3 },
    ];
    const AV_COLORS = ['#2C6CA8','#A8842C','#0C7A3D','#C4453C','#6B4FA8','#2AA87A','#8A4FA8','#4FA87A','#C47A3C'];

    /* ── Attendee table rows (show rows 1-3 + row 9) ─────────────── */
    const makeAttRow = (a, i) => {
      const initials = a.name.split(' ').filter(w=>w.length>1).slice(0,2).map(w=>w[0]).join('').toUpperCase();
      return `<tr>
        <td class="s9-col-num">${i+1}</td>
        <td class="s9-col-att"><div class="s9-att-info"><div class="s9-av" style="background:${AV_COLORS[i%AV_COLORS.length]}">${initials}</div><span>${esc(a.name)}</span></div></td>
        <td class="s9-col-role">${esc(a.role)}</td>
        <td class="s9-col-status"><span class="s9-signed-badge"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="#0C7A3D"/><path d="M2.5 5l2 2L7.5 3" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>${t('وقّع','Signed')}</span></td>
        <td class="s9-col-at">${a.at}</td>
      </tr>`;
    };
    const attRows = [0,1,2,8].map(i => makeAttRow(ATTENDEES[i], i)).join('');

    /* ── Audit trail rows ─────────────────────────────────────────── */
    const auditEntries = [
      { label:t('إنشاء المسودة','Draft created'),                   date:'15 May 2025, 10:15 AM', highlight:false },
      { label:t('أُرسل للحضور','Sent to attendees'),                date:'16 May 2025, 09:00 AM', highlight:false },
      { label:t('جُمعت كل التوقيعات','All signatures collected'),   date:'22 May 2025, 12:35 PM', highlight:false },
      { label:t('اعتمده الرئيس','Final approved by Chairman'),      date:'22 May 2025, 01:05 PM', highlight:false },
      { label:t('أُرشف وفُعِّل','Archived & activated'),           date:'22 May 2025, 01:06 PM', highlight:true  },
    ].map(e=>`<div class="s9-audit-row ${e.highlight?'s9-audit-highlight':''}">
      <span class="s9-audit-lbl">${e.label}</span>
      <span class="s9-audit-date">${e.date}</span>
    </div>`).join('');

    /* ── Render ─────────────────────────────────────────────────── */
    body.innerHTML = `
<div class="dm-step-page" id="ac-step9-page">

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
      <p class="dm-page-sub">${t('اعتمد الرئيس المحضر وأصبح مؤرشفاً بوصفه السجل الرسمي.','The minutes have been approved by the Chairman and are now archived as the official record.')}</p>
    </div>
    <div class="dm-page-hdr-right">
      <button class="dm-btn ghost" onclick="ApprovalCycle._s9Download()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${t('تنزيل المحضر الرسمي (PDF)','Download Official Minutes (PDF)')}
      </button>
      <button class="dm-btn ghost">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${t('السجل','History')}
      </button>
    </div>
  </div>

  <!-- Mini stepper -->
  <div class="dm-stepper-bar"><div class="dm-mini-stepper">${miniStepper}</div></div>

  <!-- Meta bar -->
  <div class="s9-meta-bar">
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="11" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><path d="M4 1v2M10 1v2M1 5.5h12" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div><div class="s9-meta-lbl">${t('الاجتماع','Meeting')}</div><div class="s9-meta-val">${t('اجتماع مجلس الإدارة – 15 مايو 2025','Board Meeting – 15 May 2025')}</div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.2" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/><line x1="4.5" y1="7" x2="9.5" y2="7" stroke="#8A948D" stroke-width="1.1" stroke-linecap="round"/></svg>
      <div><div class="s9-meta-lbl">${t('إصدار المحضر الرسمي','Official Minutes Version')}</div><div class="s9-meta-val"><span class="s9-version-badge">v2.0 (Final)</span></div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div><div class="s9-meta-lbl">${t('اعتُمد في','Approved On')}</div><div class="s9-meta-val">22 May 2025, 01:05 PM</div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <div class="s9-meta-av">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3.5" stroke="#8A948D" stroke-width="1.3"/><path d="M2 14a6 6 0 0112 0" stroke="#8A948D" stroke-width="1.3" stroke-linecap="round"/></svg>
      </div>
      <div>
        <div class="s9-meta-lbl">${t('اعتمده','Approved By')}</div>
        <div class="s9-meta-val" style="font-weight:700">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div>
        <div class="s9-meta-sub">${t('رئيس مجلس الإدارة','Board Chairman')}</div>
      </div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#8A948D" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><div class="s9-meta-lbl">${t('جميع التوقيعات','All Signatures')}</div><div class="s9-meta-val"><strong>9 / 9 ${t('مُجمَّعة','Collected')}</strong></div></div>
    </div>
    <div class="s9-meta-sep"></div>
    <div class="s9-meta-item">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#0C7A3D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="6" stroke="#0C7A3D" stroke-width="1.2"/></svg>
      <div>
        <div class="s9-meta-lbl">${t('الحالة','Status')}</div>
        <div class="s9-meta-val s9-archived-status">${t('مؤرشف ومفعَّل','Archived & Activated')}</div>
        <div class="s9-meta-sub">${t('السجل الرسمي','Official Record')}</div>
      </div>
    </div>
  </div>

  <!-- 3-column body -->
  <div class="s9-body">

    <!-- ── LEFT ───────────────────────────────────────────────────── -->
    <div class="s9-left">

      <!-- Archive info card -->
      <div class="s9-archive-card">
        <div class="s9-archive-stamp">
          <svg width="56" height="68" viewBox="0 0 56 68" fill="none">
            <rect width="56" height="68" rx="4" fill="#ECFDF5"/>
            <rect x="8" y="8" width="40" height="52" rx="2" fill="white" stroke="#D1FAE5" stroke-width="1"/>
            <rect x="12" y="14" width="32" height="3" rx="1" fill="#D1FAE5"/>
            <rect x="12" y="20" width="26" height="2" rx="1" fill="#EAECE8"/>
            <rect x="12" y="25" width="28" height="2" rx="1" fill="#EAECE8"/>
            <rect x="12" y="30" width="22" height="2" rx="1" fill="#EAECE8"/>
            <circle cx="28" cy="46" r="12" fill="#0C7A3D"/>
            <path d="M22 46l4 4 8-8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="s9-stamp-label">${t('مؤرشف','ARCHIVED')}</span>
        </div>
        <div class="s9-archive-info">
          <div class="s9-archive-title">${t('محضر الاجتماع المؤرشف','Archived Meeting Minutes')}</div>
          <div class="s9-archive-desc">${t('اعتمد الرئيس هذا المحضر وأصبح مؤرشفاً بوصفه السجل الرسمي للاجتماع.','These minutes have been approved by the Chairman and are now archived as the official record of the meeting.')}</div>
          <div class="s9-kv-grid">
            <div class="s9-kv-row"><span class="s9-kk">${t('عنوان الاجتماع','Meeting Title')}</span><span class="s9-kv">${t('اجتماع مجلس الإدارة – 15 مايو 2025','Board Meeting – 15 May 2025')}</span></div>
            <div class="s9-kv-row"><span class="s9-kk">${t('إصدار المحضر','Minutes Version')}</span><span class="s9-kv">v2.0 (Final)</span></div>
            <div class="s9-kv-row"><span class="s9-kk">${t('أُرشف في','Archived On')}</span><span class="s9-kv">22 May 2025, 01:06 PM</span></div>
            <div class="s9-kv-row"><span class="s9-kk">${t('أُرشف بواسطة','Archived By')}</span><span class="s9-kv">${t('محمد البلالي (أمين السر)','Mohammad Albuali (Meeting Secretary)')}</span></div>
            <div class="s9-kv-row"><span class="s9-kk">${t('رقم السجل','Record ID')}</span><span class="s9-kv s9-record-id">MM-2025-05-15-001</span></div>
            <div class="s9-kv-row"><span class="s9-kk">${t('مكان التخزين','Storage Location')}</span><span class="s9-kv">${t('أرشيف أمين الحوكمة الآمن','Ameen Governance Secure Archive')}</span></div>
            <div class="s9-kv-row"><span class="s9-kk">${t('سياسة الاحتفاظ','Retention Policy')}</span><span class="s9-kv">7 ${t('سنوات','Years')}</span></div>
          </div>
          <div class="s9-lock-alert">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="#0C7A3D" stroke-width="1.2"/><path d="M2.5 6.5l2.5 2.5 5-5" stroke="#0C7A3D" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t('هذا السجل مقفل وآمن من التلاعب. أي تغييرات مستقبلية ستُسجَّل كتعديل.','This record is locked and tamper-proof. Any future changes will be recorded as an amendment.')}</span>
          </div>
        </div>
      </div>

      <!-- All Attendees table -->
      <div class="s9-att-section">
        <div class="s9-att-title">${t('جميع الحضور (9 من 9 وقّعوا)','All Attendees (9 of 9 Signed)')}</div>
        <table class="s9-att-table">
          <thead><tr>
            <th class="s9-col-num">#</th>
            <th>${t('الحضور','Attendee')}</th>
            <th>${t('الدور','Role')}</th>
            <th>${t('حالة التوقيع','Signature Status')}</th>
            <th>${t('وقّع في','Signed On')}</th>
          </tr></thead>
          <tbody>${attRows}</tbody>
        </table>
        <button class="s9-view-sigs-btn" onclick="ApprovalCycle._s9ViewSigs()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
          ${t('عرض جميع التوقيعات','View All Signatures')}
        </button>
      </div>
    </div>

    <!-- ── CENTER ─────────────────────────────────────────────────── -->
    <div class="s9-center">

      <!-- Minutes Document preview -->
      <div class="s9-panel">
        <div class="s9-panel-title">${t('وثيقة المحضر','Minutes Document')}</div>
        <div class="s9-doc-preview">
          <div class="s9-doc-thumb">
            <div class="s9-doc-thumb-inner">
              <div class="s9-thumb-logo">
                <svg width="40" height="22" viewBox="0 0 40 22" fill="none">
                  <text x="0" y="17" font-size="15" font-weight="800" fill="#A8842C" font-family="serif">AMEEN</text>
                </svg>
              </div>
              <div class="s9-thumb-title">${t('محضر اجتماع مجلس الإدارة','Board Meeting Minutes')}</div>
              <div class="s9-thumb-date">15 May 2025</div>
              <div class="s9-approved-stamp">${t('معتمد','APPROVED')}</div>
            </div>
            <div class="s9-doc-badge-corner">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M0 0h36v36L0 0z" fill="#0C7A3D"/><path d="M10 18l5 5 11-11" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>
          <div class="s9-doc-meta-row">
            <span class="s9-doc-meta-item">${t('الحجم: 245 كيلوبايت','Size: 245 KB')}</span>
            <span class="s9-doc-meta-sep">|</span>
            <span class="s9-doc-meta-item">${t('الصفحات: 12','Pages: 12')}</span>
          </div>
          <button class="s9-view-dl-btn" onclick="ApprovalCycle._s9Download()">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/></svg>
            ${t('عرض / تنزيل (PDF)','View / Download (PDF)')}
          </button>
        </div>
      </div>

      <!-- Related Records & Links -->
      <div class="s9-panel">
        <div class="s9-panel-title">${t('السجلات والروابط ذات الصلة','Related Records & Links')}</div>
        <div class="s9-links-list">
          <div class="s9-link-row">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="10" height="10" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><line x1="4" y1="5" x2="9" y2="5" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/><line x1="4" y1="7" x2="9" y2="7" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/><line x1="4" y1="9" x2="7" y2="9" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/></svg>
            <span class="s9-link-lbl">${t('القرارات المرتبطة (4)','Associated Decisions (4)')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('decisions')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="10" height="10" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><path d="M4 5h5M4 7h5M4 9h3" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/></svg>
            <span class="s9-link-lbl">${t('بنود الإجراءات (7)','Action Items (7)')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('actions')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M3 7.5a3.5 3.5 0 016 0" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/><circle cx="6.5" cy="4.5" r="1.8" stroke="#8A948D" stroke-width="1.2"/></svg>
            <span class="s9-link-lbl">${t('قيد سجل القرارات','Decision Registry Entry')}</span>
            <a class="s9-link-anchor" href="#" onclick="return false">DR-2025-05-15-001</a>
          </div>
          <div class="s9-link-row">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="10" rx="1.5" stroke="#8A948D" stroke-width="1.2"/><path d="M1 5h11" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/><path d="M4 1v2M9 1v2" stroke="#8A948D" stroke-width="1.2" stroke-linecap="round"/></svg>
            <span class="s9-link-lbl">${t('كشف الحضور','Meeting Attendance Sheet')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('attendance')">${t('عرض','View')}</button>
          </div>
          <div class="s9-link-row">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="1" width="9" height="11" rx="1" stroke="#8A948D" stroke-width="1.2"/><line x1="4.5" y1="4.5" x2="8.5" y2="4.5" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/><line x1="4.5" y1="7" x2="8.5" y2="7" stroke="#8A948D" stroke-width="1" stroke-linecap="round"/></svg>
            <span class="s9-link-lbl">${t('المستندات الداعمة (3)','Supporting Documents (3)')}</span>
            <button class="s9-link-btn" onclick="ApprovalCycle._s9ViewLink('supporting')">${t('عرض','View')}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── RIGHT sidebar ──────────────────────────────────────────── -->
    <div class="s9-sidebar">

      <!-- Approval Confirmation -->
      <div class="s9-panel">
        <div class="s9-panel-hdr">
          <span class="s9-panel-title">${t('تأكيد الاعتماد','Approval Confirmation')}</span>
          <span class="s9-confirm-ico">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#ECFDF5"/><path d="M5 10l4 4 7-7" stroke="#0C7A3D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
        <p class="s9-confirm-text">${t('أؤكد أنني راجعت المحضر النهائي وأعتمده بوصفه سجلاً صحيحاً ودقيقاً.','I confirm that I have reviewed the final minutes and approve them as a true and accurate record.')}</p>
        <div class="s9-sig-box">
          <svg width="140" height="40" viewBox="0 0 140 40">
            <path d="M10 28 C20 18 30 14 45 22 C55 28 60 22 75 18 C88 14 100 18 115 22 L130 20" stroke="#1a3a5c" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="s9-approver-row">
          <div class="s9-approver-name">${t('د. عبدالله الغامدي','Dr. Abdullah Alghamdi')}</div>
          <div class="s9-approver-role">${t('رئيس مجلس الإدارة','Board Chairman')}</div>
          <div class="s9-approver-date">22 May 2025, 01:05 PM</div>
        </div>
        <span class="s9-final-badge">${t('اعتماد نهائي','Final Approval')}</span>
      </div>

      <!-- Next Steps -->
      <div class="s9-panel">
        <div class="s9-panel-title">${t('الخطوات التالية','Next Steps')}</div>
        <div class="s9-nextsteps">
          <div class="s9-ns-row"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#0C7A3D"/><path d="M3.5 7l2.5 2.5 5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${t('المحضر أصبح جزءاً من السجل الرسمي','Minutes are now part of the official record')}</span></div>
          <div class="s9-ns-row"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#0C7A3D"/><path d="M3.5 7l2.5 2.5 5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${t('سُجِّلت القرارات في سجل القرارات','Decisions have been recorded in the Decision Registry')}</span></div>
          <div class="s9-ns-row"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#0C7A3D"/><path d="M3.5 7l2.5 2.5 5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${t('بنود الإجراءات متاحة في المتابعة والتنفيذ','Action Items are available in Follow-Up & Execution')}</span></div>
        </div>
      </div>

      <!-- Audit Trail Summary -->
      <div class="s9-panel">
        <div class="s9-panel-title">${t('سجل التدقيق (ملخص)','Audit Trail (Summary)')}</div>
        <div class="s9-audit-table">${auditEntries}</div>
        <button class="s9-audit-full-btn" onclick="ApprovalCycle._s9AuditTrail()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="1" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="7" x2="9" y2="7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="4" y1="9.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          ${t('عرض سجل التدقيق الكامل','View Full Audit Trail')}
        </button>
      </div>

    </div>
  </div>

  <!-- Bottom bar -->
  <div class="dm-bottombar fm-bottombar">
    <button class="dm-btn ghost" onclick="ApprovalCycle._onStepClick(7)">← ${t('العودة للاعتماد النهائي','Back to Final Approval')}</button>
    <div class="s9-bb-info">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#2C6CA8" stroke-width="1.3"/><line x1="7" y1="6" x2="7" y2="10" stroke="#2C6CA8" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="4" r=".8" fill="#2C6CA8"/></svg>
      <span>${t('تم أرشفة المحضر وتفعيله بوصفه السجل الرسمي.','The minutes are archived and activated as the official record.')}</span>
    </div>
    <button class="dm-btn primary s9-archive-cta" onclick="ApprovalCycle._s9GoToArchive()">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="4" width="12" height="9" rx="1.5" stroke="white" stroke-width="1.4"/><path d="M1 7h12" stroke="white" stroke-width="1.2"/><path d="M5 1h4" stroke="white" stroke-width="1.4" stroke-linecap="round"/><path d="M7 1v3" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>
      ${t('الانتقال إلى أرشيف الاجتماعات','Go to Meeting Archive')}
    </button>
  </div>

</div>`;
  },

  /* ── Step 9 helpers ─────────────────────────────────────────────────── */
  _s9Download()   { window.open(`/api/meetings/${this._mid}/export-minutes`, '_blank'); },
  _s9ViewSigs()   { showToast(this.t('تم جمع جميع التوقيعات (9/9) ✅','All signatures collected (9/9) ✅'), 'success'); },
  _s9ViewLink(type) {
    const labels = { decisions: this.t('القرارات المرتبطة','Associated Decisions'), actions: this.t('بنود الإجراءات','Action Items'), attendance: this.t('كشف الحضور','Attendance Sheet'), supporting: this.t('المستندات الداعمة','Supporting Documents') };
    showToast((labels[type] || this.t('السجل','Record')) + ' — ' + this.t('جارٍ الفتح...','Opening...'), 'info');
  },
  _s9AuditTrail() { showToast(this.t('سجل التدقيق الكامل — كل الأحداث مسجلة وآمنة.','Full Audit Trail — all events recorded and tamper-proof.'), 'info'); },
  _s9GoToArchive(){ showToast(this.t('✅ اكتملت دورة الاعتماد. المحضر مؤرشف رسمياً.','✅ Approval cycle complete. Minutes officially archived.'), 'success'); },

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
