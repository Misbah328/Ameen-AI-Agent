/* ════════════════════════════════════════════════════════════════════════════
   APPROVAL CYCLE  —  Full Minutes Approval Cycle page (9-step workflow)
   Entry: ApprovalCycle.open(meetingId)
   ════════════════════════════════════════════════════════════════════════════ */
const ApprovalCycle = {
  _mid: null,
  _data: null,
  _meetingFull: null,
  _commentTab: 'recent',   // 'recent' | 'all'
  _eSignMode: 'draw',      // 'draw' | 'type'
  _eSignPurpose: null,     // 'comment' | 'attendee_sign' | 'final_sign'
  _eSignResolve: null,
  _canvas: null,
  _ctx: null,
  _drawing: false,
  _hasDrawing: false,

  t(ar, en) { return App.lang === 'ar' ? ar : en; },

  // ── Entry point ────────────────────────────────────────────────────────────
  open(mid) {
    this._mid = mid;
    Panels.load('approval-cycle');
  },

  // ── Called by Panels.load after panel is shown ────────────────────────────
  async refresh() {
    if (!this._mid) { this._renderEmpty(); return; }
    await this._load();
  },

  async _load() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [full, cycleData] = await Promise.all([
        api(`/api/meetings/${this._mid}/full`),
        api(`/api/meetings/${this._mid}/approval-cycle`),
      ]);
      this._meetingFull = full;
      this._data = cycleData;
      this._render();
    } catch (e) {
      body.innerHTML = `<div class="es"><div class="ic">⚠️</div><div class="t">${this.t('تعذّر تحميل البيانات', 'Could not load data')}</div><div class="s">${esc(e.message)}</div></div>`;
    }
  },

  _renderEmpty() {
    const body = document.getElementById('ac-page-body');
    if (body) body.innerHTML = `<div class="ac-wrap"><div class="ac-empty"><div class="ac-empty-icon">📋</div><div>${this.t('اختر اجتماعاً لعرض دورة الاعتماد', 'Select a meeting to view the approval cycle')}</div><button class="btn-gold btn-sm" style="margin-top:14px" onclick="Panels.load('scheduled')">${this.t('الاجتماعات', 'Meetings')}</button></div></div>`;
  },

  // ── Main render ────────────────────────────────────────────────────────────
  _render() {
    const body = document.getElementById('ac-page-body');
    if (!body) return;
    const m = this._meetingFull && this._meetingFull.meeting;
    if (!m) { this._renderEmpty(); return; }
    const t = (ar, en) => this.t(ar, en);
    const l = App.lang;
    const d = this._data;
    const cycle = d.cycle || { cycle_stage: 'draft', comment_deadline: null };
    const title = (l === 'ar' ? m.title_ar : m.title_en) || m.title_ar || '';
    const dateStr = m.scheduled_date ? fmtDate(m.scheduled_date) : '';
    const timeStr = m.scheduled_time ? m.scheduled_time.slice(0, 5) : '';

    const stageLabel = this._stageName(cycle.cycle_stage);
    const isDone = cycle.cycle_stage === 'archived';

    body.innerHTML = `
<div class="ac-wrap">
  <div class="ac-breadcrumb">
    <button onclick="MT.openDetail(${this._mid},'overview')">← ${t('الاجتماع', 'Meeting')}</button>
    <span class="sep">·</span>
    <span>${esc(title)}</span>
    ${dateStr ? `<span class="sep">·</span><span>${dateStr}</span>` : ''}
    ${timeStr ? `<span class="sep">·</span><span>${timeStr}</span>` : ''}
  </div>
  <div class="ac-head">
    <div class="ac-head-left">
      <div class="ac-title">${t('دورة اعتماد المحضر', 'Minutes Approval Cycle')}</div>
    </div>
    <div class="ac-head-right">
      <a class="btn-ghost btn-sm" href="/api/meetings/${this._mid}/export-minutes" target="_blank">⬇ ${t('تنزيل المحضر', 'Download Minutes')}</a>
      <button class="btn-ghost btn-sm" onclick="MT.openDetail(${this._mid},'overview')">📋 ${t('تفاصيل الاجتماع', 'Meeting Details')}</button>
    </div>
  </div>
  <div class="ac-status-bar">
    <span class="ac-stage-badge ${isDone ? 'done' : ''}">${stageLabel}</span>
    ${m.scheduled_date ? `<span class="ac-status-time">📅 ${dateStr}</span>` : ''}
    ${cycle.comment_deadline ? `<span class="ac-status-time">⏰ ${t('الموعد النهائي', 'Deadline')}: ${this._fmtDT(cycle.comment_deadline)}</span>` : ''}
  </div>
  ${this._renderStepper(cycle)}
  <div class="ac-cols">
    <div class="ac-col-l">${this._renderLeft(cycle, d)}</div>
    <div class="ac-col-c">${this._renderCenter(cycle, d)}</div>
    <div class="ac-col-r">${this._renderRight(cycle, d)}</div>
  </div>
</div>`;

    this._bindCanvas();
  },

  // ── 9-step Stepper ─────────────────────────────────────────────────────────
  _renderStepper(cycle) {
    const t = (ar, en) => this.t(ar, en);
    const d = this._data;
    const comments = d.comments || [];
    const sigs = d.signatures || [];
    const totalC = comments.length;
    const resolved = comments.filter(c => c.status !== 'pending').length;
    const sigAttendee = sigs.filter(s => s.sig_stage === 'attendee');
    const sigSigned = sigAttendee.filter(s => s.status === 'signed').length;

    const STAGES = [
      { key: 'draft',          ar: 'إنشاء المسودة',        en: 'Draft Creation',         icon: '📄', sub: null },
      { key: 'circulated',     ar: 'تعميم على الحضور',      en: 'Delivered to Attendees', icon: '📧', sub: null },
      { key: 'comments_open',  ar: 'التعليقات',             en: 'Comments',               icon: '💬', sub: totalC ? `${totalC}` : null },
      { key: 'deadline_closed',ar: 'موعد التعليقات',        en: 'Comment Deadline',       icon: '⏰', sub: null },
      { key: 'review_resolve', ar: 'مراجعة وحل',            en: 'Review & Resolve',       icon: '🔍', sub: resolved ? `${resolved}/${totalC} ${t('محلول','resolved')}` : null },
      { key: 'final_version',  ar: 'النسخة النهائية',       en: 'Final Version',          icon: '📋', sub: null },
      { key: 'attendee_sign',  ar: 'توقيعات الحضور',        en: 'Attendee Signatures',    icon: '✍️', sub: sigAttendee.length ? `${sigSigned}/${sigAttendee.length} ${t('وقّعوا','signed')}` : null },
      { key: 'final_approver', ar: 'المعتمد النهائي',       en: 'Final Approver',         icon: '👤', sub: null },
      { key: 'archived',       ar: 'أرشفة وتفعيل',          en: 'Archive & Activate',     icon: '🗃️', sub: null },
    ];
    const STAGE_IDX = { draft:0,circulated:1,comments_open:2,deadline_closed:3,review_resolve:4,final_version:5,attendee_sign:6,final_approver:7,archived:8 };
    const cur = STAGE_IDX[cycle.cycle_stage] ?? 0;

    return `<div class="ac-stepper">${STAGES.map((s, i) => {
      const cls = i < cur ? 'done' : i === cur ? 'cur' : '';
      const dotContent = i < cur ? '✓' : s.icon;
      const subLabel = i < cur ? t('مكتمل','Done') : i === cur ? t('الآن','Current') : (s.sub || t('قيد الانتظار','Pending'));
      return `<div class="ac-step ${cls}">
        <div class="ac-step-dot"><span class="ac-step-num">${dotContent}</span></div>
        <div class="ac-step-label">${t(s.ar, s.en)}</div>
        <div class="ac-step-sub">${s.sub && i === cur ? s.sub : subLabel}</div>
      </div>`;
    }).join('')}</div>`;
  },

  // ── Left column: Deadline + Signatures + Document ─────────────────────────
  _renderLeft(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const canPublish = App.can('minutes.publish');
    const canApprove = App.can('minutes.approve');
    const canDecide = canPublish || canApprove;

    // Deadline card
    const deadline = cycle.comment_deadline;
    const deadlineExpired = deadline && new Date(deadline) < new Date();
    const deadlineCard = `<div class="ac-card">
      <div class="ac-card-t">⏰ ${t('الموعد النهائي للتعليقات', 'Comment Deadline')}</div>
      <div class="ac-deadline-box">
        <div class="ac-deadline-icon">${deadlineExpired ? '🔒' : deadline ? '⏳' : '📅'}</div>
        <div class="ac-deadline-info">
          <div class="ac-deadline-label">${deadline ? t('موعد الإغلاق', 'Closes') : t('لم يُحدَّد بعد', 'Not set yet')}</div>
          ${deadline ? `<div class="ac-deadline-val">${this._fmtDT(deadline)}</div>` : ''}
          ${deadline ? `<span class="ac-deadline-status ${deadlineExpired ? 'closed' : 'open'}">${deadlineExpired ? t('🔒 مغلق','🔒 Closed') : t('⏳ مفتوح','⏳ Open')}</span>` : ''}
        </div>
      </div>
      ${canDecide && !deadlineExpired ? `<div style="margin-top:10px">
        <div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">${t('تحديد الموعد النهائي', 'Set Deadline')}</div>
        <div style="display:flex;gap:6px">
          <input type="datetime-local" id="ac-deadline-input" class="fi" style="flex:1;font-size:12px" ${deadline ? `value="${deadline.replace(' ','T').slice(0,16)}"` : ''}>
          <button class="btn-gold btn-sm" onclick="ApprovalCycle.setDeadline()">${t('حفظ', 'Save')}</button>
        </div>
      </div>` : ''}
    </div>`;

    // Attendee signatures card
    const sigs = d.signatures || [];
    const attendees = d.attendees || [];
    const attendeeSigs = sigs.filter(s => s.sig_stage === 'attendee');
    const signedCount = attendeeSigs.filter(s => s.status === 'signed').length;
    const totalSig = attendeeSigs.length || attendees.length;
    const sigPct = totalSig ? Math.round(signedCount / totalSig * 100) : 0;
    const r = 28, circ = 2 * Math.PI * r;
    const offset = circ - (sigPct / 100) * circ;
    const finalSig = sigs.filter(s => s.sig_stage === 'final_approver');
    const isAttendeeSignStage = cycle.cycle_stage === 'attendee_sign';
    const isFinalSignStage = cycle.cycle_stage === 'final_approver';

    const myName = App.user ? (App.user.name_en || App.user.name_ar || '') : '';
    const mySig = attendeeSigs.find(s => s.signer_name === myName);
    const myFinalSig = finalSig.find(s => s.signer_name === myName);

    const sigListItems = (attendeeSigs.length ? attendeeSigs : attendees.slice(0,8)).map(s => {
      const name = s.signer_name || s.name || '';
      const role = s.signer_role || s.role || '';
      const status = s.status;
      const initials = name.split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase();
      const isMe = name === myName;
      return `<div class="ac-sig-row">
        <div class="ac-sig-avatar">${initials || '?'}</div>
        <div style="flex:1;min-width:0">
          <div class="ac-sig-name">${esc(name)}</div>
          <div class="ac-sig-role">${esc(role)}</div>
        </div>
        ${status === 'signed' ? `<span class="ac-sig-status signed">✓ ${this.t('وقّع','Signed')}</span>` :
          (isAttendeeSignStage && isMe && !mySig)
            ? `<button class="ac-sig-btn" onclick="ApprovalCycle.openSignModal('attendee')">✍️ ${this.t('وقّع','Sign')}</button>`
            : `<span class="ac-sig-status pending">${this.t('معلّق','Pending')}</span>`}
      </div>`;
    }).join('');

    const signaturesCard = `<div class="ac-card">
      <div class="ac-card-t">✍️ ${t('توقيعات الحضور', 'Attendee Signatures')}
        <span class="ac-card-sub">${signedCount}/${totalSig}</span>
      </div>
      <div class="ac-sig-progress">
        <div class="ac-sig-donut">
          <svg class="ac-sig-donut-svg" width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--border3)" stroke-width="8"/>
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--gold)" stroke-width="8"
              stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
          </svg>
          <div class="ac-sig-donut-label">${sigPct}%<span>${t('وقّعوا','Signed')}</span></div>
        </div>
        <div class="ac-sig-legend">
          <div class="ac-sig-leg-item"><div class="ac-sig-leg-dot" style="background:var(--gold)"></div> ${signedCount} ${t('وقّعوا','Signed')}</div>
          <div class="ac-sig-leg-item"><div class="ac-sig-leg-dot" style="background:var(--border3)"></div> ${totalSig - signedCount} ${t('معلّق','Pending')}</div>
        </div>
      </div>
      <div class="ac-sig-list">${sigListItems || `<div style="font-size:12px;color:var(--text3);text-align:center;padding:10px">${t('لم يبدأ التوقيع بعد.','No signatures yet.')}</div>`}</div>
      ${canDecide && isAttendeeSignStage && signedCount < totalSig ? `<div class="ac-advance-bar"><button class="btn-ghost btn-sm" onclick="ApprovalCycle.sendReminder()">🔔 ${t('تذكير المعلّقين','Remind Pending')}</button></div>` : ''}
    </div>`;

    // Final approver card (shown from final_approver stage onwards)
    let finalCard = '';
    if (['final_approver','archived'].includes(cycle.cycle_stage) || finalSig.length > 0) {
      const fa = finalSig[0];
      finalCard = `<div class="ac-card">
        <div class="ac-card-t">👤 ${t('المعتمد النهائي', 'Final Approver')}</div>
        ${fa ? `<div class="ac-sig-row">
          <div class="ac-sig-avatar">${(fa.signer_name||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div class="ac-sig-name">${esc(fa.signer_name)}</div>
            <div class="ac-sig-role">${esc(fa.signer_role||'')}</div>
          </div>
          ${fa.status === 'signed'
            ? `<span class="ac-sig-status signed">✓ ${t('وقّع','Signed')}</span>`
            : (isFinalSignStage && fa.signer_name === myName)
              ? `<button class="ac-sig-btn" onclick="ApprovalCycle.openSignModal('final_approver')">✍️ ${t('وقّع','Sign')}</button>`
              : `<span class="ac-sig-status pending">${t('معلّق','Pending')}</span>`}
        </div>` : `<div style="font-size:12px;color:var(--text3)">${t('لم يُعيَّن بعد.','Not assigned yet.')}</div>`}
      </div>`;
    }

    // Minutes document card
    const docCard = `<div class="ac-card">
      <div class="ac-card-t">📄 ${t('وثيقة المحضر', 'Minutes Document')}</div>
      <div class="ac-doc-box">
        <div class="ac-doc-icon">📋</div>
        <div class="ac-doc-info">
          <div class="ac-doc-name">${t('محضر الاجتماع', 'Meeting Minutes')}</div>
          <div class="ac-doc-meta">${t('النسخة', 'Version')} ${(this._meetingFull && this._meetingFull.meeting.minutes_version) || 1}</div>
        </div>
      </div>
      <div class="ac-doc-actions">
        <button class="btn-ghost btn-sm" onclick="MT.openDetail(${this._mid},'minutes')">📝 ${t('عرض المحضر','View Minutes')}</button>
      </div>
    </div>`;

    return deadlineCard + signaturesCard + finalCard + docCard;
  },

  // ── Center column: Comments Overview ─────────────────────────────────────
  _renderCenter(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const comments = d.comments || [];
    const total = comments.length;
    const accepted = comments.filter(c => c.status === 'accepted').length;
    const rejected = comments.filter(c => c.status === 'rejected').length;
    const pending  = comments.filter(c => c.status === 'pending').length;
    const canDecide = App.can('minutes.publish') || App.can('minutes.approve');
    const canComment = App.can('minutes.view') && ['comments_open','deadline_closed','review_resolve'].includes(cycle.cycle_stage) && cycle.cycle_stage !== 'deadline_closed';
    const myName = App.user ? (App.user.name_en || App.user.name_ar || '') : '';
    const myComment = comments.find(c => c.commenter_name === myName);
    const showComments = this._commentTab === 'all' ? comments : comments.slice(0, 10);

    const commentItems = showComments.length ? showComments.map(c => {
      const isMe = c.commenter_name === myName;
      return `<div class="ac-comment-item ${c.status}">
        <div class="ac-comment-top">
          <span class="ac-comment-badge ${c.status}">${c.status === 'accepted' ? `✓ ${t('مقبول','Accepted')}` : c.status === 'rejected' ? `✕ ${t('مرفوض','Rejected')}` : t('قيد المراجعة','Under Review')}</span>
          ${c.clause_ref ? `<span class="ac-comment-clause">${esc(c.clause_ref)}</span>` : ''}
          <span class="ac-comment-actor">👤 ${esc(c.commenter_name)}</span>
          <span class="ac-comment-time">${this._fmtDT(c.created_at)}</span>
        </div>
        <div class="ac-comment-body">${esc(c.content)}</div>
        ${c.secretary_note ? `<div class="ac-comment-decided">${t('ملاحظة أمين السر','Secretary note')}: "${esc(c.secretary_note)}"</div>` : ''}
        ${c.status === 'pending' && canDecide ? `<div class="ac-comment-actions">
          <input class="fi" id="ac-snote-${c.id}" placeholder="${t('ملاحظة (اختياري)…','Note (optional)…')}" style="flex:1;font-size:12px;padding:6px 10px"/>
          <button class="btn-gold btn-sm" onclick="ApprovalCycle.decideComment(${c.id},'accepted')">✓ ${t('قبول','Accept')}</button>
          <button class="btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" onclick="ApprovalCycle.decideComment(${c.id},'rejected')">✕ ${t('رفض','Reject')}</button>
        </div>` : ''}
      </div>`;
    }).join('') : `<div class="ac-empty"><div class="ac-empty-icon">💬</div><div>${t('لا توجد تعليقات بعد.','No comments yet.')}</div></div>`;

    return `<div class="ac-card" style="min-height:400px">
      <div class="ac-card-t" style="margin-bottom:8px">💬 ${t('التعليقات والملاحظات', 'Comments & Notes')}
        ${canComment && !myComment ? `<button class="btn-gold btn-sm" style="margin-inline-start:auto" onclick="ApprovalCycle.openCommentModal()">+ ${t('إضافة تعليق','Add Comment')}</button>` : ''}
      </div>
      <div class="ac-kpis">
        <div class="ac-kpi"><div class="ac-kpi-n">${total}</div><div class="ac-kpi-l">${t('الإجمالي','Total')}</div></div>
        <div class="ac-kpi accepted"><div class="ac-kpi-n">${accepted}</div><div class="ac-kpi-l">${t('مقبول','Accepted')}</div></div>
        <div class="ac-kpi rejected"><div class="ac-kpi-n">${rejected}</div><div class="ac-kpi-l">${t('مرفوض','Rejected')}</div></div>
        <div class="ac-kpi pending"><div class="ac-kpi-n">${pending}</div><div class="ac-kpi-l">${t('معلّق','Pending')}</div></div>
      </div>
      <div class="ac-tabs">
        <button class="ac-tab ${this._commentTab === 'recent' ? 'active' : ''}" onclick="ApprovalCycle._setTab('recent')">${t('الأحدث','Recent')}</button>
        <button class="ac-tab ${this._commentTab === 'all' ? 'active' : ''}" onclick="ApprovalCycle._setTab('all')">${t('الكل','All')} ${total > 0 ? `(${total})` : ''}</button>
      </div>
      <div class="ac-comment-list">${commentItems}</div>
    </div>`;
  },

  // ── Right column: Authority + Next Step + Audit ───────────────────────────
  _renderRight(cycle, d) {
    const t = (ar, en) => this.t(ar, en);
    const canDecide = App.can('minutes.publish') || App.can('minutes.approve');

    // Comment review authority
    const attendees = d.attendees || [];
    const reviewers = attendees.filter(a => a.role && (a.role.includes('Chair') || a.role.includes('Secretary') || a.role.includes('رئيس') || a.role.includes('أمين')));
    const authorityPeople = (reviewers.length ? reviewers : attendees).slice(0, 3);
    const authorityCard = `<div class="ac-card">
      <div class="ac-card-t">🏛️ ${t('سلطة مراجعة التعليقات', 'Comment Review Authority')}</div>
      <div class="ac-authority-box">
        ${authorityPeople.length ? authorityPeople.map(a => {
          const initials = (a.name || '?').split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase();
          return `<div class="ac-authority-person">
            <div class="ac-authority-av">${initials}</div>
            <div class="ac-authority-info">
              <div class="ac-authority-name">${esc(a.name)}</div>
              <div class="ac-authority-role">${esc(a.role || t('عضو','Member'))}</div>
            </div>
            <span class="ac-authority-action">${t('مراجع','Reviewer')}</span>
          </div>`;
        }).join('') : `<div style="font-size:12px;color:var(--text3)">${t('لا يوجد مراجعون محددون.','No reviewers assigned.')}</div>`}
      </div>
    </div>`;

    // Next step card
    const nextInfo = this._nextStepInfo(cycle);
    const nextCard = `<div class="ac-card">
      <div class="ac-card-t">🎯 ${t('الخطوة التالية', 'Next Step')}</div>
      <div class="ac-next-step-box">
        <div class="ac-next-step-title">${t('الإجراء المطلوب','Required Action')}</div>
        <div class="ac-next-step-action">${nextInfo.action}</div>
        <div class="ac-next-step-desc">${nextInfo.desc}</div>
        ${nextInfo.who ? `<div class="ac-next-step-who"><div class="ac-next-step-av">👤</div><span style="font-size:11.5px;color:rgba(255,255,255,.8)">${nextInfo.who}</span></div>` : ''}
      </div>
      ${canDecide && nextInfo.advance_to ? `<div class="ac-advance-bar"><button class="btn-gold" onclick="ApprovalCycle.advance('${nextInfo.advance_to}')">${nextInfo.btn}</button></div>` : ''}
    </div>`;

    // Audit trail
    const audit = d.audit || [];
    const auditCard = `<div class="ac-card">
      <div class="ac-card-t">📜 ${t('سجل التدقيق', 'Audit Trail')}</div>
      <div class="ac-audit-list">
        ${audit.length ? audit.map(e => `<div class="ac-audit-row">
          <span class="ac-audit-time">${this._fmtDT(e.created_at)}</span>
          <span class="ac-audit-text">— ${esc(e.actor_name || '')} · ${esc(this._auditLabel(e.action))}</span>
        </div>`).join('') : `<div style="font-size:12px;color:var(--text3);padding:8px 0">${t('لا توجد سجلات بعد.','No records yet.')}</div>`}
      </div>
    </div>`;

    return authorityCard + nextCard + auditCard;
  },

  // ── Next step info ─────────────────────────────────────────────────────────
  _nextStepInfo(cycle) {
    const t = (ar, en) => this.t(ar, en);
    const m = { action: '—', desc: '', who: '', advance_to: null, btn: '' };
    switch (cycle.cycle_stage) {
      case 'draft':
        return { action: t('تعميم المحضر','Circulate Minutes'), desc: t('عمّم المحضر على الحضور لبدء مرحلة التعليقات','Distribute the minutes to attendees to start the comment phase'), who: t('أمين السر','Secretary'), advance_to: 'circulated', btn: `📧 ${t('تعميم الآن','Circulate Now')}` };
      case 'circulated':
        return { action: t('فتح باب التعليقات','Open Comments'), desc: t('افتح باب التعليقات وحدد الموعد النهائي','Open the comment window and set a deadline'), who: t('أمين السر','Secretary'), advance_to: 'comments_open', btn: `💬 ${t('فتح باب التعليقات','Open for Comments')}` };
      case 'comments_open':
        return { action: t('إغلاق باب التعليقات','Close Comments'), desc: t('أغلق باب التعليقات وانتقل لمرحلة المراجعة','Close the comment window and proceed to review'), who: t('أمين السر','Secretary'), advance_to: 'deadline_closed', btn: `🔒 ${t('إغلاق التعليقات','Close Comments')}` };
      case 'deadline_closed':
        return { action: t('بدء مراجعة التعليقات','Start Review'), desc: t('ابدأ قبول أو رفض التعليقات المقدَّمة','Begin accepting or rejecting the submitted comments'), who: t('أمين السر','Secretary'), advance_to: 'review_resolve', btn: `🔍 ${t('بدء المراجعة','Start Review')}` };
      case 'review_resolve': {
        const pending = (this._data && this._data.comments || []).filter(c => c.status === 'pending').length;
        return { action: t('إعداد النسخة النهائية','Prepare Final Version'), desc: pending ? t(`لا تزال هناك ${pending} تعليقات معلّقة.`,`${pending} comment(s) still pending.`) : t('أكمِل مراجعة جميع التعليقات ثم أصدر النسخة النهائية.','Review all comments then issue the final version.'), who: t('أمين السر','Secretary'), advance_to: 'final_version', btn: `📋 ${t('إصدار النسخة النهائية','Issue Final Version')}` };
      }
      case 'final_version':
        return { action: t('جمع توقيعات الحضور','Collect Attendee Signatures'), desc: t('اطلب من جميع الحضور توقيع النسخة النهائية','Request all attendees to sign the final version'), who: t('أمين السر','Secretary'), advance_to: 'attendee_sign', btn: `✍️ ${t('بدء التوقيع','Open for Signing')}` };
      case 'attendee_sign': {
        const sigs = (this._data && this._data.signatures || []).filter(s => s.sig_stage === 'attendee');
        const remaining = sigs.filter(s => s.status !== 'signed').length;
        return { action: t('الاعتماد النهائي','Final Approval'), desc: remaining ? t(`${remaining} حاضر لم يوقّع بعد.`,`${remaining} attendee(s) have not signed yet.`) : t('جميع الحضور وقّعوا. أرسل للمعتمد النهائي.','All attendees signed. Send to final approver.'), who: t('رئيس الجلسة','Chairman'), advance_to: remaining ? null : 'final_approver', btn: `👤 ${t('إرسال للاعتماد النهائي','Send to Final Approver')}` };
      }
      case 'final_approver':
        return { action: t('أرشفة وتفعيل','Archive & Activate'), desc: t('بعد توقيع المعتمد النهائي، أرشِف المحضر وفعِّله رسمياً','After final approver signs, archive and officially activate the minutes'), who: t('أمين السر','Secretary'), advance_to: 'archived', btn: `🗃️ ${t('أرشفة وتفعيل','Archive & Activate')}` };
      case 'archived':
        return { action: t('اكتملت دورة الاعتماد','Approval Cycle Complete'), desc: t('تم اعتماد المحضر وأرشفته بنجاح.','The minutes have been approved and archived successfully.'), who: '', advance_to: null, btn: '' };
      default: return m;
    }
  },

  // ── Stage name ─────────────────────────────────────────────────────────────
  _stageName(s) {
    const map = {
      draft:          this.t('مسودة','Draft'),
      circulated:     this.t('تم التعميم','Circulated'),
      comments_open:  this.t('التعليقات مفتوحة','Comments Open'),
      deadline_closed:this.t('الموعد النهائي','Deadline Closed'),
      review_resolve: this.t('مراجعة وحل','Review & Resolve'),
      final_version:  this.t('النسخة النهائية','Final Version'),
      attendee_sign:  this.t('توقيعات الحضور','Attendee Signatures'),
      final_approver: this.t('المعتمد النهائي','Final Approver'),
      archived:       this.t('مؤرشَف','Archived'),
    };
    return map[s] || s;
  },

  // ── Audit label ────────────────────────────────────────────────────────────
  _auditLabel(action) {
    if (!action) return '';
    if (action.startsWith('cycle_advance:')) {
      const stage = action.replace('cycle_advance:', '');
      return `${this.t('انتقال إلى','Advanced to')}: ${this._stageName(stage)}`;
    }
    const map = { circulated: this.t('تعميم المحضر','Minutes circulated'), approved: this.t('اعتماد المحضر','Minutes approved'), final_approved: this.t('الاعتماد النهائي','Final approval'), signed: this.t('توقيع إلكتروني','E-signed') };
    return map[action] || action;
  },

  // ── Date/time formatter ────────────────────────────────────────────────────
  _fmtDT(v) {
    if (!v) return '';
    try {
      const d = new Date(v);
      return d.toLocaleDateString(App.lang === 'ar' ? 'ar-SA' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return v; }
  },

  // ── Comment tab switch ─────────────────────────────────────────────────────
  _setTab(tab) {
    this._commentTab = tab;
    this._render();
  },

  // ── Set deadline ───────────────────────────────────────────────────────────
  async setDeadline() {
    const t = (ar, en) => this.t(ar, en);
    const el = document.getElementById('ac-deadline-input');
    if (!el || !el.value) { showToast(t('الرجاء تحديد موعد','Please select a deadline'), 'error'); return; }
    const val = el.value.replace('T', ' ') + ':00';
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/deadline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deadline: val }) });
      showToast(t('✓ تم حفظ الموعد النهائي','✓ Deadline saved'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  // ── Advance stage ──────────────────────────────────────────────────────────
  async advance(to_stage) {
    const t = (ar, en) => this.t(ar, en);
    if (!to_stage) return;
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_stage }) });
      showToast(t('✓ تم الانتقال للمرحلة التالية','✓ Advanced to next stage'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  // ── Decide on comment ─────────────────────────────────────────────────────
  async decideComment(cid, decision) {
    const t = (ar, en) => this.t(ar, en);
    const noteEl = document.getElementById(`ac-snote-${cid}`);
    const secretary_note = noteEl ? noteEl.value.trim() : '';
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments/${cid}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, secretary_note }) });
      showToast(decision === 'accepted' ? t('✓ تم قبول التعليق','✓ Comment accepted') : t('✓ تم رفض التعليق','✓ Comment rejected'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  // ── Send reminder ─────────────────────────────────────────────────────────
  async sendReminder() {
    const t = (ar, en) => this.t(ar, en);
    showToast(t('✓ تم إرسال تذكير للمعلّقين','✓ Reminder sent to pending signatories'));
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  COMMENT MODAL
  // ══════════════════════════════════════════════════════════════════════════
  openCommentModal() {
    const overlay = document.getElementById('ac-comment-overlay');
    if (!overlay) return;
    const notesEl = document.getElementById('ac-cmt-notes');
    const clauseEl = document.getElementById('ac-cmt-clause');
    if (notesEl) notesEl.value = '';
    if (clauseEl) clauseEl.value = '';
    this._resetEsign();
    overlay.classList.add('open');
    setTimeout(() => { try { notesEl && notesEl.focus(); } catch (_) {} }, 80);
  },

  closeCommentModal() {
    const overlay = document.getElementById('ac-comment-overlay');
    if (overlay) overlay.classList.remove('open');
  },

  async submitComment() {
    const t = (ar, en) => this.t(ar, en);
    const content = (document.getElementById('ac-cmt-notes') || {}).value || '';
    const clause_ref = (document.getElementById('ac-cmt-clause') || {}).value || '';
    if (!content.trim()) { showToast(t('الرجاء كتابة تعليقك','Please enter your comment'), 'error'); return; }
    // Store comment data then open e-signature modal (two-step: write → sign → submit)
    this._pendingComment = { content: content.trim(), clause_ref: clause_ref.trim() };
    this.closeCommentModal();
    this.openSignModal('comment');
  },

  async _finalizeComment(signature_data, signature_type) {
    const t = (ar, en) => this.t(ar, en);
    if (!this._pendingComment) return;
    const { content, clause_ref } = this._pendingComment;
    this._pendingComment = null;
    try {
      await api(`/api/meetings/${this._mid}/approval-cycle/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, clause_ref, signature_data, signature_type }) });
      showToast(t('✓ تم إرسال تعليقك بنجاح','✓ Comment submitted successfully'));
      await this._load();
    } catch (e) { showToast(t('خطأ: ','Error: ') + e.message, 'error'); }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SIGNATURE MODAL
  // ══════════════════════════════════════════════════════════════════════════
  openSignModal(purpose) {
    this._eSignPurpose = purpose;
    const overlay = document.getElementById('ac-esign-overlay');
    if (!overlay) return;
    this._resetEsign();
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
    const purpose = this._eSignPurpose; // save before closeSignModal() nulls it
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

  // ══════════════════════════════════════════════════════════════════════════
  //  E-SIGNATURE CANVAS
  // ══════════════════════════════════════════════════════════════════════════
  switchEsignMode(mode) {
    this._eSignMode = mode;
    const drawTab = document.getElementById('esign-tab-draw');
    const typeTab = document.getElementById('esign-tab-type');
    const drawWrap = document.getElementById('esign-draw-wrap');
    const typeWrap = document.getElementById('esign-type-wrap');
    if (drawTab) drawTab.classList.toggle('active', mode === 'draw');
    if (typeTab) typeTab.classList.toggle('active', mode === 'type');
    if (drawWrap) drawWrap.style.display = mode === 'draw' ? '' : 'none';
    if (typeWrap) typeWrap.style.display = mode === 'type' ? '' : 'none';
  },

  _resetEsign() {
    this._eSignMode = 'draw';
    this._hasDrawing = false;
    this._drawing = false;
    const canvas = document.getElementById('ac-esign-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const typeInput = document.getElementById('ac-esign-type-input');
    if (typeInput) typeInput.value = '';
    const hint = document.getElementById('esign-canvas-hint');
    if (hint) hint.style.display = '';
  },

  _initCanvas() {
    setTimeout(() => {
      const canvas = document.getElementById('ac-esign-canvas');
      if (!canvas || canvas._acBound) return;
      canvas._acBound = true;
      this._canvas = canvas;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1a2340';

      const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
      };

      canvas.addEventListener('mousedown', (e) => { e.preventDefault(); this._drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
      canvas.addEventListener('mousemove', (e) => { if (!this._drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); this._hasDrawing = true; const h = document.getElementById('esign-canvas-hint'); if (h) h.style.display = 'none'; });
      canvas.addEventListener('mouseup', () => { this._drawing = false; ctx.beginPath(); });
      canvas.addEventListener('mouseleave', () => { this._drawing = false; ctx.beginPath(); });
      canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
      canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!this._drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); this._hasDrawing = true; const h = document.getElementById('esign-canvas-hint'); if (h) h.style.display = 'none'; }, { passive: false });
      canvas.addEventListener('touchend', () => { this._drawing = false; ctx.beginPath(); });
    }, 100);
  },

  clearCanvas() {
    const canvas = document.getElementById('ac-esign-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this._hasDrawing = false;
    const hint = document.getElementById('esign-canvas-hint');
    if (hint) hint.style.display = '';
  },

  _getEsignData() {
    if (this._eSignMode === 'type') {
      const val = (document.getElementById('ac-esign-type-input') || {}).value || '';
      return { data: val.trim(), type: 'type' };
    }
    const canvas = document.getElementById('ac-esign-canvas');
    if (!canvas || !this._hasDrawing) return { data: '', type: 'draw' };
    return { data: canvas.toDataURL('image/png'), type: 'draw' };
  },

  // ── Bind canvas after render (for any canvas that needs re-binding) ────────
  _bindCanvas() {
    this._canvas = null;
  },
};
