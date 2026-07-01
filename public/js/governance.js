'use strict';
// ══ Governance Module ══════════════════════════════════════════════════════════
// Loaded after app.js — uses $(), esc(), api(), App, showToast() from there.

const ATTENDEE_ROLES = {
  'Chairperson':  { ar: 'رئيس الجلسة',  en: 'Chairperson' },
  'Board Member': { ar: 'عضو مجلس',     en: 'Board Member' },
  'Executive':    { ar: 'تنفيذي',        en: 'Executive' },
  'Presenter':    { ar: 'مُقدِّم',        en: 'Presenter' },
  'Consultant':   { ar: 'مستشار',        en: 'Consultant' },
  'Observer':     { ar: 'مراقب',         en: 'Observer' },
  'Secretary':    { ar: 'أمين السر',     en: 'Secretary' },
};

const ATTENDANCE_ST = {
  present: { ar: 'حاضر',   en: 'Present',  c: 'var(--green)' },
  absent:  { ar: 'غائب',   en: 'Absent',   c: 'var(--red)' },
  excused: { ar: 'معتذر',  en: 'Excused',  c: 'var(--amber)' },
  pending: { ar: '—',       en: '—',        c: 'var(--text3)' },
};

const RESOLUTION_ST = {
  pending:  { ar: 'قيد النظر', en: 'Pending',  c: 'var(--text3)' },
  approved: { ar: 'مُقرَّر',   en: 'Approved', c: 'var(--green)' },
  rejected: { ar: 'مرفوض',    en: 'Rejected', c: 'var(--red)' },
  deferred: { ar: 'مُؤجَّل',   en: 'Deferred', c: 'var(--amber)' },
};

const FOLLOWUP_ST = {
  pending:     { ar: 'معلق',    en: 'Pending' },
  in_progress: { ar: 'جارٍ',   en: 'In Progress' },
  completed:   { ar: 'مكتمل',  en: 'Completed' },
};

const DOC_TYPES = {
  board_paper:      { ar: 'ورقة مجلس',         en: 'Board Paper' },
  financial_report: { ar: 'تقرير مالي',         en: 'Financial Report' },
  legal:            { ar: 'وثيقة قانونية',      en: 'Legal Document' },
  presentation:     { ar: 'عرض تقديمي',        en: 'Presentation' },
  proposal:         { ar: 'مقترح',              en: 'Proposal' },
  policy:           { ar: 'وثيقة سياسة',       en: 'Policy Document' },
  minutes:          { ar: 'محضر اجتماع سابق',  en: 'Previous Meeting Minutes' },
  report:           { ar: 'تقرير',              en: 'Report' },
  other:            { ar: 'أخرى',               en: 'Other' },
};

const DOC_STATUS = {
  draft:    { ar: 'مسودة',     en: 'Draft',     c: 'var(--text3)',  bg: 'var(--navy4)' },
  shared:   { ar: 'مشترك',    en: 'Shared',    c: '#5B9BD6',       bg: 'rgba(91,155,214,.12)' },
  reviewed: { ar: 'مُراجَع',  en: 'Reviewed',  c: 'var(--amber)',  bg: 'rgba(201,168,76,.12)' },
  approved: { ar: 'مُعتمَد',  en: 'Approved',  c: 'var(--green)',  bg: 'rgba(46,204,138,.12)' },
};

const Gov = {
  meetingId: null,
  scheduleId: null,
  source: 'meeting',
  _meetings: [],
  _schedule: [],
  _boards: [],
  _summary: null,
  _gas: [],
  _qTimer: null,

  lbl(ar, en) { return App.lang === 'ar' ? ar : en; },

  // ── Init: load meeting lists + boards + summary + GAs, render all ────────
  async init() {
    const body = $('gov-body');
    if (!body) return;
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [meetings, schedule, boards, summary, gas] = await Promise.all([
        api('/api/meetings').catch(() => []),
        api('/api/schedule').catch(() => []),
        api('/api/gov/boards').catch(() => []),
        api('/api/gov/summary').catch(() => null),
        api('/api/gov/general-assemblies').catch(() => []),
      ]);
      this._meetings = meetings || [];
      this._schedule = schedule || [];
      this._boards = boards || [];
      this._summary = summary;
      this._gas = gas || [];
      this._renderAll();
    } catch (e) {
      body.innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px">${esc(e.message)}</div>`;
    }
  },

  _renderAll() {
    const body = $('gov-body');
    if (!body) return;
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const _govBanner = `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 18px;background:linear-gradient(135deg,var(--navy3),var(--navy2));border:1px solid var(--border2);border-radius:12px">
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">🏛 ${lbl('لوحة الحوكمة التنفيذية','Executive Governance Board')}</div>
        <div style="font-size:11.5px;color:var(--text3);line-height:1.65">${lbl('مجالس الإدارة، اللجان، الجمعيات العمومية، والقرارات — نظرة شاملة على هيكل حوكمة أمين القابضة','Boards, committees, general assemblies, and resolutions — complete governance structure of Ameen Holdings')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-ghost btn-sm" onclick="Panels.load('transcripts')" style="font-size:11px;white-space:nowrap">📋 ${lbl('المحاضر','Minutes')}</button>
        <button class="btn-gold btn-sm" onclick="Panels.load('tasks')" style="font-size:11px;white-space:nowrap">⚖️ ${lbl('القرارات','Decisions')}</button>
      </div>
    </div>`;
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        ${_govBanner}
        ${this._summary ? this._sDashboard(this._summary) : `<div style="text-align:center;padding:32px 20px"><div style="font-size:40px;margin-bottom:12px">🏛</div><div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">${lbl('لا توجد بيانات حوكمة بعد','No governance data yet')}</div><div style="font-size:11.5px;color:var(--text3);line-height:1.7;max-width:360px;margin:0 auto">${lbl('أضف مجلس إدارة أو لجنة لتفعيل لوحة الحوكمة وتتبع القرارات والقرارات والجمعيات العمومية','Add a board or committee to activate the governance dashboard and track resolutions, decisions, and general assemblies')}</div></div>`}
        ${this._gas && this._gas.length ? this._sGASection(this._gas) : ''}
        ${this._sBoardsSection(this._boards)}
        <div id="gov-meeting-selector"></div>
        <div id="gov-sections" style="display:flex;flex-direction:column;gap:14px"></div>
      </div>`;
    this._renderSelector();
  },

  // ── Executive Governance Dashboard ────────────────────────────────────────
  _sDashboard(s) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const { boards=0, committees=0, resTotal=0, resPending=0, resApproved=0, resRejected=0,
            resDeferred=0, quorumAchieved=0, quorumTotal=0, recentRes=[], upcoming=[],
            generalAssemblies=0, openActions=0, pendingMinutes=0 } = s || {};

    const kpis = [
      { icon:'🏛', val:boards,            label:lbl('مجالس الإدارة النشطة','Active Boards'),          color:'var(--gold)',  sub:lbl('الهيئات الحاكمة','Governing bodies') },
      { icon:'⚙️', val:committees,        label:lbl('اللجان المتخصصة','Committees'),                  color:'#5B9BD6',      sub:lbl('لجان تنفيذية','Specialized bodies') },
      { icon:'🏢', val:generalAssemblies, label:lbl('الجمعيات العمومية','General Assemblies'),        color:'#8B5CF6',      sub:lbl('عادية وغير عادية','Ordinary & Extraordinary') },
      { icon:'⏳', val:resPending,        label:lbl('قرارات معلقة','Pending Resolutions'),           color:'var(--amber)', sub:lbl('تحتاج تصويتاً','Awaiting vote') },
      { icon:'✅', val:resApproved,       label:lbl('قرارات مُعتمدة','Approved Resolutions'),         color:'var(--green)', sub:lbl('قرارات مُجازة','Passed') },
      { icon:'📋', val:pendingMinutes,    label:lbl('محاضر معلقة','Pending Minutes Approval'),       color:'var(--amber)', sub:lbl('تنتظر الاعتماد','Awaiting approval') },
      { icon:'⚖️', val:quorumAchieved,   label:lbl('نصاب محقق','Quorum Completed'),                 color:'var(--green)', sub:lbl('اجتماعات مكتملة','Meetings achieved') },
      { icon:'📌', val:openActions,       label:lbl('إجراءات حوكمة مفتوحة','Open Governance Actions'), color:'var(--red)', sub:lbl('متابعات نشطة','Active follow-ups') },
    ];

    const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:14px">
      ${kpis.map(k => `<div class="card stat-clickable" style="padding:20px 16px 16px;text-align:center;position:relative;overflow:hidden;min-height:130px;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${k.color};border-radius:14px 14px 0 0"></div>
        <div style="font-size:28px;margin-bottom:8px;line-height:1">${k.icon}</div>
        <div style="font-size:32px;font-weight:800;color:${k.color};letter-spacing:-.04em;line-height:1">${k.val}</div>
        <div style="font-size:13px;font-weight:600;color:var(--text2);margin-top:7px;line-height:1.3">${k.label}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">${k.sub}</div>
      </div>`).join('')}
    </div>`;

    // Status summary bar
    const totalVotes = resApproved + resRejected + resDeferred + resPending;
    const summaryBar = totalVotes > 0 ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-size:12.5px;font-weight:600;color:var(--text2)">${lbl('ملخص القرارات:','Resolutions summary:')}</span>
        ${resApproved ? `<span class="tag tg">${resApproved} ${lbl('مُعتمد','Approved')}</span>` : ''}
        ${resPending  ? `<span class="tag ta">${resPending}  ${lbl('معلق','Pending')}</span>` : ''}
        ${resRejected ? `<span class="tag tr">${resRejected} ${lbl('مرفوض','Rejected')}</span>` : ''}
        ${resDeferred ? `<span class="tag" style="background:var(--navy4)">${resDeferred} ${lbl('مؤجل','Deferred')}</span>` : ''}
        ${quorumTotal > 0 ? `<span class="tag tb">${lbl('نصاب محقق:','Quorum met:')} ${quorumAchieved}/${quorumTotal}</span>` : ''}
      </div>` : '';

    // Recent resolutions
    const stColor = { approved:'var(--green)', rejected:'var(--red)', deferred:'var(--amber)', pending:'var(--text3)' };
    const stLabel = { approved:{ar:'مُعتمد',en:'Approved'}, rejected:{ar:'مرفوض',en:'Rejected'}, deferred:{ar:'مؤجل',en:'Deferred'}, pending:{ar:'معلق',en:'Pending'} };
    const resHtml = recentRes.length ? `
      <div class="card">
        <div class="ch">
          <div>
            <div class="ct">⚖️ ${lbl('القرارات الأخيرة','Recent Resolutions')}</div>
            <div class="ctsub">${lbl('آخر القرارات المسجلة عبر الاجتماعات','Latest decisions across all meetings')}</div>
          </div>
          ${summaryBar}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${recentRes.map((r, i) => {
            const sc = stColor[r.status] || 'var(--text3)';
            const sl = (stLabel[r.status]||{ar:r.status,en:r.status})[l];
            const total = (r.votes_approve||0)+(r.votes_reject||0)+(r.votes_abstain||0);
            const pct = total>0 ? Math.round(((r.votes_approve||0)/total)*100) : 0;
            const mtgTitle = l==='ar'?(r.meeting_title_ar||''):(r.meeting_title_en||r.meeting_title_ar||'');
            return `<div style="display:flex;gap:12px;align-items:flex-start;padding:13px 15px;background:var(--navy3);border-radius:10px;border:1px solid var(--border2);border-inline-start:3px solid ${sc}">
              <div style="min-width:26px;height:26px;border-radius:50%;background:${sc}22;color:${sc};font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14.5px;font-weight:600;color:var(--text);line-height:1.4;margin-bottom:6px">${esc(r.title)}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  <span class="tag" style="font-size:11.5px;background:transparent;border:1px solid ${sc};color:${sc}">${sl}</span>
                  ${mtgTitle ? `<span class="tag" style="font-size:11px;background:var(--navy4);color:var(--text3)">📋 ${esc(mtgTitle.substring(0,32))}${mtgTitle.length>32?'…':''}</span>` : ''}
                  ${total>0 ? `<span class="tag" style="font-size:11px;background:var(--navy4);color:var(--text3)">🗳 ${r.votes_approve}✓ ${r.votes_reject}✕ ${r.votes_abstain}◎</span>` : ''}
                  ${total>0&&r.status==='approved' ? `<span class="tag tg" style="font-size:11px">${pct}% ${lbl('موافقة','approval')}</span>` : ''}
                  ${(r.followup_count||0)>0 ? `<span class="tag" style="font-size:11px;background:var(--gold-dim);color:var(--gold)">📌 ${r.followup_count} ${lbl('متابعة','follow-up(s)')}</span>` : ''}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // Upcoming governance meetings
    const typeAr = { board:'مجلس الإدارة', committee:'لجنة', general_assembly:'جمعية عمومية', executive:'تنفيذي', other:'أخرى' };
    const typeEn = { board:'Board', committee:'Committee', general_assembly:'General Assembly', executive:'Executive', other:'Other' };
    const upcomingHtml = upcoming.length ? `
      <div class="card">
        <div class="ch">
          <div>
            <div class="ct">📅 ${lbl('الاجتماعات الحوكمية القادمة','Upcoming Governance Meetings')}</div>
            <div class="ctsub">${lbl('المجدولة خلال الفترة القادمة','Scheduled for upcoming period')}</div>
          </div>
          <button class="btn-ghost btn-sm" onclick="Panels.load('schedule')">${lbl('عرض الكل ←','View All →')}</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${upcoming.map(s => {
            const title = l==='ar'?s.title_ar:(s.title_en||s.title_ar);
            return `<div style="display:flex;align-items:center;gap:14px;padding:11px 15px;background:var(--navy3);border-radius:10px;border:1px solid var(--border2)">
              <div style="min-width:44px;text-align:center;flex-shrink:0">
                <div style="font-size:20px;font-weight:800;color:var(--gold);line-height:1">${(s.meeting_date||'').substring(8,10)||'–'}</div>
                <div style="font-size:10px;color:var(--text3);letter-spacing:.06em">${(s.meeting_date||'').substring(5,7)||''}</div>
              </div>
              <div style="width:1px;background:var(--border2);align-self:stretch"></div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:600;color:var(--text)">${esc(title)}</div>
                <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
                  ${s.meeting_type ? `<span class="tag tb" style="font-size:11px">${l==='ar'?(typeAr[s.meeting_type]||s.meeting_type):(typeEn[s.meeting_type]||s.meeting_type)}</span>` : ''}
                  ${s.meeting_time ? `<span class="tag" style="font-size:11px;background:var(--navy4);color:var(--text3)">🕐 ${esc(s.meeting_time)}</span>` : ''}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    return `<div style="display:flex;flex-direction:column;gap:16px">
      <div class="hint-bar">
        <span class="hint-icon">🏛</span>
        <div><strong>${lbl('لوحة الحوكمة التنفيذية — مجموعة أمين هولدينج','Executive Governance Dashboard — Ameen Holdings Group')}</strong><br>
        <span style="font-size:13px">${lbl('إدارة المجالس، اللجان، الجمعيات العمومية، النصاب، التصويت، القرارات، والاعتمادات في مكان واحد.','Manage boards, committees, general assemblies, quorum, voting, resolutions, and approvals in one place.')}</span></div>
      </div>
      ${kpiHtml}
      ${resHtml}
      ${upcomingHtml}
    </div>`;
  },

  // ── General Assembly Section ───────────────────────────────────────────────
  _sGASection(gas) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const today = new Date().toISOString().substring(0,10);
    const stColor = { confirmed:'var(--green)', draft:'var(--amber)', cancelled:'var(--red)' };
    const stLabelAr = { confirmed:'مؤكد', draft:'مسودة', cancelled:'ملغي' };
    const stLabelEn = { confirmed:'Confirmed', draft:'Draft', cancelled:'Cancelled' };

    return `<div class="card" id="sec-ga">
      <div class="ch">
        <div>
          <div class="ct">🏢 ${lbl('الجمعيات العمومية','General Assemblies')}</div>
          <div class="ctsub">${lbl('الجمعية العمومية العادية وغير العادية — مجموعة أمين هولدينج','Ordinary & Extraordinary General Assemblies — Ameen Holdings Group')}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="tag tb" style="font-size:12px">${gas.length} ${lbl('جمعية','assembly')}</span>
          ${App.user && ['Admin','CEO','Chairman','Secretary'].includes(App.user.role_en) ? `<button class="btn-gold btn-sm" onclick="Gov._showCreateGA()" style="font-size:12px">+ ${lbl('جمعية عمومية جديدة','New GA')}</button>` : ''}
        </div>
      </div>
      <div id="create-ga-form" style="display:none;background:var(--navy3);border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid rgba(212,160,23,.3)">
        <div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:12px">🏢 ${lbl('إنشاء جمعية عمومية جديدة','Create New General Assembly')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <input class="fi" id="cga-title-ar" placeholder="${lbl('اسم الجمعية (بالعربية)','Meeting Title (Arabic)')}*" style="grid-column:1/-1"/>
          <input class="fi" id="cga-title-en" placeholder="${lbl('اسم الجمعية (بالإنجليزية)','Meeting Title (English)')}" style="grid-column:1/-1"/>
          <input class="fi" type="date" id="cga-date" placeholder="${lbl('تاريخ الاجتماع','Meeting Date')}*"/>
          <input class="fi" type="time" id="cga-time" value="10:00"/>
          <input class="fi" id="cga-venue" placeholder="${lbl('مقر الاجتماع','Venue')}"/>
          <input class="fi" type="number" id="cga-duration" placeholder="${lbl('المدة (دقيقة)','Duration (mins)')}" value="120"/>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-gold btn-sm" onclick="Gov.createGA()">${lbl('إنشاء','Create')}</button>
          <button class="btn-ghost btn-sm" onclick="Gov._hideForm('create-ga-form')">${lbl('إلغاء','Cancel')}</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${gas.map((ga, idx) => {
          const title = l==='ar' ? ga.title_ar : (ga.title_en||ga.title_ar);
          const isUpcoming = ga.meeting_date >= today;
          const sc = stColor[ga.status] || 'var(--text3)';
          const sl = l==='ar' ? (stLabelAr[ga.status]||ga.status||'') : (stLabelEn[ga.status]||ga.status||'');
          const qPct = (ga.quorum_required||0) > 0 ? Math.min(100, Math.round(((ga.quorum_present||0)/(ga.quorum_required))*100)) : 0;
          const qOk = ga.quorum_achieved === 1;
          const gaLabel = l==='ar' ? 'جمعية عمومية' : (idx===0 ? 'Ordinary General Assembly' : 'Extraordinary General Assembly');

          return `<div style="background:var(--navy3);border-radius:13px;padding:20px 20px 18px;border:1px solid var(--border2);position:relative;overflow:hidden">
            <div style="position:absolute;top:0;inset-inline-start:0;bottom:0;width:4px;background:var(--gold)"></div>

            <!-- Title row -->
            <div style="padding-inline-start:8px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:6px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                    <span class="tag" style="background:rgba(139,92,246,.15);color:#8B5CF6;font-size:12px;font-weight:700">🏢 ${gaLabel}</span>
                    <span class="tag" style="font-size:12px;background:transparent;border:1px solid ${sc};color:${sc}">${sl}</span>
                    ${isUpcoming ? `<span class="tag tb" style="font-size:11.5px">📅 ${lbl('اجتماع قادم','Upcoming')}</span>` : `<span class="tag tg" style="font-size:11.5px">✓ ${lbl('انعقدت','Held')}</span>`}
                  </div>
                  <div style="font-size:18px;font-weight:800;color:var(--text);line-height:1.35">${esc(title)}</div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">
                  <button class="btn-ghost btn-sm" onclick="Gov._selectGA(${ga.id})" style="font-size:12px">
                    ${lbl('بنود الحوكمة','Governance Items →')}
                  </button>
                  <button class="btn-gold btn-sm" onclick="Gov._toggleGADetail(${ga.id})" style="font-size:12px;white-space:nowrap" id="ga-toggle-${ga.id}">
                    📊 ${lbl('التقرير الكامل','Full GA Report')}
                  </button>
                </div>
              </div>

              <!-- Info strip -->
              <div style="display:flex;gap:0;flex-wrap:wrap;padding:11px 14px;background:var(--navy4);border-radius:10px;margin-bottom:14px;row-gap:10px">
                ${[
                  ['📅', lbl('التاريخ','Date'), ga.meeting_date||'—'],
                  ga.meeting_time ? ['🕐', lbl('الوقت','Time'), ga.meeting_time] : null,
                  ga.platform ? ['📍', lbl('المقر','Venue'), (ga.platform||'').substring(0,30)+((ga.platform||'').length>30?'…':'')] : null,
                  ['👥', lbl('المساهمون','Shareholders'), ga.attendees ? esc(String(ga.attendees))+' '+lbl('مساهم','attendees') : '—'],
                  ['📋', lbl('بنود الأعمال','Agenda Items'), String(ga.agenda_count||0)],
                  ['⚖️', lbl('القرارات','Resolutions'), String(ga.resolution_count||0)],
                ].filter(Boolean).map(([ic,lbl2,val]) => `
                  <div style="display:flex;align-items:center;gap:6px;min-width:120px;padding-inline-end:18px">
                    <span style="font-size:15px">${ic}</span>
                    <div>
                      <div style="font-size:10px;color:var(--text3)">${lbl2}</div>
                      <div style="font-size:13px;font-weight:600;color:var(--text)">${val}</div>
                    </div>
                  </div>`).join('')}
              </div>

              <!-- People + Quorum grid -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
                <!-- Key people -->
                <div style="background:var(--navy4);border-radius:10px;padding:13px">
                  <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${lbl('الهيئة الرئاسية','Key Roles')}</div>
                  ${(() => {
                    const roleIcon = { chairman:'👑', secretary:'📝', legal_advisor:'⚖️', scrutineer:'🔍', other:'👤' };
                    const roleEnLabel = { chairman:'Chairman', secretary:'Secretary', legal_advisor:'Legal Advisor', scrutineer:'Scrutineer' };
                    const roleArLabel = { chairman:'رئيس الجمعية', secretary:'أمين السر', legal_advisor:'مستشار قانوني', scrutineer:'مدقق أصوات' };
                    let officers = [];
                    try { officers = ga.officers_json ? JSON.parse(ga.officers_json) : []; } catch(e) {}
                    officers = officers.filter(Boolean).slice(0,3);
                    if (!officers.length) return `<div style="font-size:12px;color:var(--text3);font-style:italic">${lbl('لم يُعيَّن مسؤولون بعد','No officers assigned yet')}</div>`;
                    return officers.map(o => `<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
                      <span style="font-size:14px;flex-shrink:0">${roleIcon[o.role]||'👤'}</span>
                      <span style="font-size:11.5px;color:var(--text3);flex-shrink:0">${l==='ar'?(o.role_ar||(roleArLabel[o.role]||o.role)):(roleEnLabel[o.role]||o.role)}:</span>
                      <span style="font-size:12.5px;font-weight:600;color:var(--text)">${l==='ar'?(o.name_ar||o.name_en):o.name_en}</span>
                    </div>`).join('');
                  })()}
                </div>
                <!-- Quorum -->
                <div style="background:var(--navy4);border-radius:10px;padding:13px">
                  <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${lbl('النصاب القانوني','Quorum Status')}</div>
                  ${(ga.quorum_required||0) > 0 ? `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
                      <span style="font-size:13px;font-weight:600;color:var(--text)">${ga.quorum_present||0} / ${ga.quorum_required||0}</span>
                      <span class="tag ${qOk?'tg':'tr'}" style="font-size:11px">${qOk?lbl('✓ محقق','✓ Achieved'):lbl('✗ غير محقق','✗ Not Met')}</span>
                    </div>
                    <div style="background:var(--navy3);border-radius:20px;height:9px;overflow:hidden;margin-bottom:5px">
                      <div style="height:100%;border-radius:20px;background:${qOk?'var(--green)':'var(--amber)'};width:${qPct}%;transition:width .6s"></div>
                    </div>
                    <div style="font-size:11.5px;color:var(--text3)">${qPct}% ${lbl('من النصاب المطلوب (50%+1)','of required quorum (50%+1)')}</div>
                  ` : `<div style="font-size:12.5px;color:var(--text3)">${isUpcoming ? lbl('الاجتماع لم ينعقد بعد','Meeting not held yet') : lbl('لم يُسجَّل النصاب','Quorum not recorded')}</div>`}
                  ${ga.quorum_notes ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;line-height:1.4;font-style:italic">${esc((ga.quorum_notes||'').substring(0,90))}${(ga.quorum_notes||'').length>90?'…':''}</div>` : ''}
                </div>
              </div>

              <!-- Approval workflow -->
              <div style="display:flex;gap:0;flex-wrap:wrap;align-items:center;padding:10px 14px;background:var(--navy4);border-radius:10px;row-gap:6px">
                <span style="font-size:12.5px;font-weight:600;color:var(--text2);padding-inline-end:12px">${lbl('حالة المحاضر:','Minutes Status:')}</span>
                ${[
                  ['📄', lbl('مسودة','Draft'), !isUpcoming],
                  ['📤', lbl('تُعمَّم','Circulated'), !isUpcoming],
                  ['✓', lbl('مُعتمَد','Approved'), !isUpcoming && (ga.quorum_achieved===1)],
                  ['✅', lbl('اعتماد نهائي','Final Approved'), !isUpcoming && (ga.quorum_achieved===1)],
                ].map(([ic, step, done]) => `
                  <div style="display:flex;align-items:center;gap:5px;padding-inline-end:14px">
                    <div style="width:22px;height:22px;border-radius:50%;background:${done?'var(--green)':'var(--navy3)'};border:2px solid ${done?'var(--green)':'var(--border2)'};display:flex;align-items:center;justify-content:center;font-size:11px;color:${done?'#fff':'var(--text3)'};flex-shrink:0">${ic}</div>
                    <span style="font-size:12px;color:${done?'var(--text)':'var(--text3)'};font-weight:${done?'600':'400'}">${step}</span>
                  </div>`).join(`<div style="color:var(--border2);padding-inline-end:14px">›</div>`)}
              </div>
            </div>
          </div>
          <div id="ga-detail-${ga.id}" style="display:none;margin-top:2px"></div>`;
        }).join('')}
      </div>
    </div>`;
  },

  _selectGA(scheduleId) {
    const sel = $('gov-sel');
    if (sel) { sel.value = `schedule:${scheduleId}`; Gov.onSelect(`schedule:${scheduleId}`); }
    const el = $('gov-sections');
    if (el) setTimeout(() => el.scrollIntoView({ behavior:'smooth', block:'start' }), 400);
  },

  _renderSelector() {
    const l = App.lang;
    const wrap = $('gov-meeting-selector');
    if (!wrap) return;

    const mOpts = this._meetings.map(m =>
      `<option value="meeting:${m.id}">${esc(l==='ar'?m.title_ar:(m.title_en||m.title_ar))}${m.meeting_date?' — '+(m.meeting_date||'').substring(0,10):''}</option>`
    ).join('');
    const sOpts = this._schedule.map(s =>
      `<option value="schedule:${s.id}">${esc(l==='ar'?s.title_ar:(s.title_en||s.title_ar))}${s.meeting_date?' — '+s.meeting_date:''}</option>`
    ).join('');

    const curVal = this.meetingId ? `meeting:${this.meetingId}` : this.scheduleId ? `schedule:${this.scheduleId}` : '';

    wrap.innerHTML = `
      <div class="card">
        <div class="ch"><div class="ct">📋 ${this.lbl('ربط الاجتماع','Link a Meeting')}</div></div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px">${this.lbl('اختر اجتماعاً لعرض وإدارة بنوده الحوكمية','Select a meeting to view and manage its governance items')}</div>
        <select class="fi" id="gov-sel" onchange="Gov.onSelect(this.value)" style="font-size:13px">
          <option value="">— ${this.lbl('اختر اجتماعاً...','Choose a meeting...')} —</option>
          ${mOpts ? `<optgroup label="${this.lbl('الاجتماعات المسجلة','Recorded Meetings')}">${mOpts}</optgroup>` : ''}
          ${sOpts ? `<optgroup label="${this.lbl('الاجتماعات المجدولة','Scheduled Meetings')}">${sOpts}</optgroup>` : ''}
        </select>
      </div>`;

    if (curVal) {
      const sel = $('gov-sel');
      if (sel) { sel.value = curVal; this._loadSections(); }
    }
  },

  // ── Boards & Committees section ────────────────────────────────────────────
  _sBoardsSection(boards) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    return `<div class="card" id="sec-boards">
      <div class="ch">
        <div>
          <div class="ct">🏛 ${lbl('المجالس واللجان','Boards & Committees')}</div>
          <div class="ctsub">${lbl('الهيئات الحاكمة المرتبطة بالاجتماعات','Governing bodies linked to meetings')}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="Gov._showForm('board-add-form')">+ ${lbl('إضافة مجلس','Add Board')}</button>
      </div>

      <div id="board-add-form" style="display:none;background:var(--navy3);border-radius:10px;padding:13px;margin-bottom:12px">
        <div class="fs" style="gap:8px">
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('الاسم (عربي)','Name (Arabic)')} *</div><input class="fi" id="b-name-ar" placeholder="${lbl('مجلس الإدارة','Board of Directors')}"/></div>
            <div class="frow"><div class="fl">Name (English)</div><input class="fi" id="b-name-en" placeholder="Board of Directors" dir="ltr" style="text-align:left"/></div>
          </div>
          <div class="frow"><div class="fl">${lbl('الوصف','Description')}</div><input class="fi" id="b-desc" placeholder="${lbl('وصف المجلس...','Board description...')}"/></div>
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('الرئيس','Chairperson')}</div><input class="fi" id="b-chair" placeholder="${lbl('اسم الرئيس','Chair name')}"/></div>
            <div class="frow"><div class="fl">${lbl('إجمالي الأعضاء','Total Members')}</div><input class="fi" type="number" id="b-total" value="0" min="0"/></div>
          </div>
          <div class="frow"><div class="fl">${lbl('النصاب الافتراضي','Default Quorum')}</div><input class="fi" type="number" id="b-quorum" value="0" min="0"/></div>
          <div class="fa">
            <button class="btn-gold btn-sm" onclick="Gov.addBoard()">✓ ${lbl('إضافة','Add')}</button>
            <button class="btn-ghost btn-sm" onclick="Gov._hideForm('board-add-form')">✕</button>
          </div>
        </div>
      </div>

      ${boards.length ? boards.map(b => this._renderBoardRow(b)).join('') : `
        <div class="es" style="padding:16px">
          <div class="es-icon">🏛</div>
          <div style="font-size:12px">${lbl('لا توجد مجالس بعد — أضف مجلساً للبدء','No boards yet — add one to get started')}</div>
        </div>`}
    </div>`;
  },

  _renderBoardRow(b) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const name = l==='ar' ? b.name_ar : (b.name_en||b.name_ar);
    const coms = b.committees || [];
    return `<div style="background:var(--navy3);border-radius:12px;padding:16px 18px;margin-bottom:12px;border:1px solid var(--border2);position:relative;overflow:hidden">
      <div style="position:absolute;top:0;inset-inline-start:0;bottom:0;width:3px;background:var(--gold);border-radius:12px 0 0 12px"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding-inline-start:6px">
        <div style="flex:1">
          <div style="font-size:16px;font-weight:700;color:var(--text)">🏛 ${esc(name)}</div>
          ${b.description ? `<div style="font-size:13px;color:var(--text3);margin-top:4px;line-height:1.5">${esc(b.description)}</div>` : ''}
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
            ${b.chairperson ? `<span class="tag tgold">👤 ${lbl('الرئيس:','Chair:')} ${esc(b.chairperson)}</span>` : ''}
            ${b.total_members ? `<span class="tag tb">👥 ${b.total_members} ${lbl('عضو','members')}</span>` : ''}
            ${b.default_quorum ? `<span class="tag" style="background:var(--navy4)">⚖️ ${lbl('نصاب:','Quorum:')} ${b.default_quorum}</span>` : ''}
            <span class="tag" style="background:var(--navy4);color:var(--text3)">⚙️ ${coms.length} ${lbl('لجنة','committee(s)')}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <button class="btn-ghost btn-sm" onclick="Gov._showForm('com-add-form-${b.id}')">+ ${lbl('لجنة','Committee')}</button>
          <button class="btn-ghost btn-sm" onclick="Gov.delBoard(${b.id})" style="color:var(--red)">✕</button>
        </div>
      </div>

      <div id="com-add-form-${b.id}" style="display:none;background:var(--navy4);border-radius:10px;padding:12px;margin-top:12px">
        <div class="fs" style="gap:8px">
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('الاسم (عربي)','Name (Arabic)')} *</div><input class="fi" id="c-name-ar-${b.id}" placeholder="${lbl('اللجنة التنفيذية','Executive Committee')}"/></div>
            <div class="frow"><div class="fl">Name (English)</div><input class="fi" id="c-name-en-${b.id}" placeholder="Executive Committee" dir="ltr" style="text-align:left"/></div>
          </div>
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('الرئيس','Chairperson')}</div><input class="fi" id="c-chair-${b.id}" placeholder="${lbl('الاسم','Name')}"/></div>
            <div class="frow"><div class="fl">${lbl('الأعضاء','Total Members')}</div><input class="fi" type="number" id="c-total-${b.id}" value="0" min="0"/></div>
          </div>
          <div class="frow"><div class="fl">${lbl('الوصف','Description')}</div><input class="fi" id="c-desc-${b.id}" placeholder="${lbl('وصف اللجنة...','Committee description...')}"/></div>
          <div class="fa">
            <button class="btn-gold btn-sm" onclick="Gov.addCommittee(${b.id})">✓ ${lbl('إضافة','Add')}</button>
            <button class="btn-ghost btn-sm" onclick="Gov._hideForm('com-add-form-${b.id}')">✕</button>
          </div>
        </div>
      </div>

      ${coms.length ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;padding-inline-start:6px">
        ${coms.map(c => {
          const cname = l==='ar'?c.name_ar:(c.name_en||c.name_ar);
          return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--navy4);border-radius:10px;border:1px solid var(--border2)">
            <div style="font-size:15px;flex-shrink:0">⚙️</div>
            <div style="flex:1">
              <div style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(cname)}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
                ${c.chairperson ? `<span class="tag tgold" style="font-size:11px">👤 ${esc(c.chairperson)}</span>` : ''}
                ${c.total_members ? `<span class="tag" style="background:var(--navy3);font-size:11px">👥 ${c.total_members}</span>` : ''}
                ${c.description ? `<span style="font-size:12px;color:var(--text3)">${esc(c.description.substring(0,55))}${c.description.length>55?'…':''}</span>` : ''}
              </div>
            </div>
            <button class="btn-ghost btn-sm" onclick="Gov.delCommittee(${c.id})" style="color:var(--red);flex-shrink:0">✕</button>
          </div>`;
        }).join('')}
      </div>` : `<div style="font-size:12.5px;color:var(--text3);margin-top:10px;padding-inline-start:8px">↳ ${lbl('لا توجد لجان — اضغط + لجنة لإضافة','No committees — press + Committee to add')}</div>`}
    </div>`;
  },

  async addBoard() {
    const ar = (($('b-name-ar') || {}).value || '').trim();
    if (!ar) { showToast(this.lbl('يرجى إدخال اسم المجلس','Please enter a board name'), 'error'); return; }
    try {
      await api('/api/gov/boards', { method:'POST', body: JSON.stringify({
        name_ar: ar, name_en: (($('b-name-en') || {}).value || '').trim() || ar,
        description: (($('b-desc') || {}).value || '').trim() || '',
        chairperson: (($('b-chair') || {}).value || '').trim() || '',
        total_members: parseInt(($('b-total') || {}).value) || 0,
        default_quorum: parseInt(($('b-quorum') || {}).value) || 0,
      })});
      // Reload boards + refresh App cache
      await this._reloadBoards();
      showToast(this.lbl('تم إضافة المجلس','Board added'), 'success');
    } catch (e) { showToast(e.message, 'error'); }
  },

  async delBoard(id) {
    if (!confirm(this.lbl('حذف هذا المجلس؟ سيتم فصل اللجان عنه.','Delete this board? Committees will be unlinked.'))) return;
    try { await api(`/api/gov/boards/${id}`, { method:'DELETE' }); await this._reloadBoards(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async addCommittee(boardId) {
    const ar = (($('c-name-ar-' + boardId) || {}).value || '').trim();
    if (!ar) { showToast(this.lbl('يرجى إدخال اسم اللجنة','Please enter a committee name'), 'error'); return; }
    try {
      await api('/api/gov/committees', { method:'POST', body: JSON.stringify({
        board_id: boardId,
        name_ar: ar, name_en: (($('c-name-en-' + boardId) || {}).value || '').trim() || ar,
        description: (($('c-desc-' + boardId) || {}).value || '').trim() || '',
        chairperson: (($('c-chair-' + boardId) || {}).value || '').trim() || '',
        total_members: parseInt(($('c-total-' + boardId) || {}).value) || 0,
      })});
      await this._reloadBoards();
      showToast(this.lbl('تم إضافة اللجنة','Committee added'), 'success');
    } catch (e) { showToast(e.message, 'error'); }
  },

  async delCommittee(id) {
    if (!confirm(this.lbl('حذف هذه اللجنة؟','Delete this committee?'))) return;
    try { await api(`/api/gov/committees/${id}`, { method:'DELETE' }); await this._reloadBoards(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async _reloadBoards() {
    const boards = await api('/api/gov/boards').catch(() => []);
    this._boards = boards || [];
    // Also refresh App-level cache so board/committee dropdowns update
    const bc = await api('/api/gov/boards-and-committees').catch(() => ({ boards: [], committees: [] }));
    App._boards = bc.boards || [];
    App._committees = bc.committees || [];
    Schedule._populateBoardSelects();
    // Re-render just the boards card in-place
    const el = $('sec-boards');
    if (el) el.outerHTML = this._sBoardsSection(this._boards);
  },

  onSelect(val) {
    const sec = $('gov-sections');
    if (!val) { if (sec) sec.innerHTML = ''; this.meetingId = null; this.scheduleId = null; return; }
    const [src, id] = val.split(':');
    this.source = src;
    if (src === 'meeting') { this.meetingId = parseInt(id); this.scheduleId = null; }
    else { this.scheduleId = parseInt(id); this.meetingId = null; }
    this._loadSections();
  },

  _qParam() { return this.meetingId ? `meetingId=${this.meetingId}` : `scheduleId=${this.scheduleId}`; },

  async _loadSections() {
    const el = $('gov-sections');
    if (!el) return;
    el.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const q = this._qParam();
      const [agenda, docs, quorum, resolutions, attendance] = await Promise.all([
        api(`/api/gov/agenda?${q}`),
        api(`/api/gov/documents?${q}`),
        api(`/api/gov/quorum?${q}`).catch(() => null),
        api(`/api/gov/resolutions?${q}`),
        this.meetingId ? api(`/api/gov/attendance?meetingId=${this.meetingId}`) : Promise.resolve([]),
      ]);
      // Auto-seed sample resolutions if none exist for this meeting/schedule
      let finalRes = resolutions;
      if (resolutions.length === 0 && (this.meetingId || this.scheduleId)) {
        await this._seedSampleResolution();
        finalRes = await api(`/api/gov/resolutions?${q}`).catch(() => []);
      }
      el.innerHTML = [
        this._sAgenda(agenda, docs),
        this._sAttendance(attendance),
        this._sQuorum(quorum),
        this._sResolutions(finalRes),
        this._sDocs(docs.filter(d => !d.agenda_item_id)),
      ].join('');
      // Draw doughnut charts for all resolutions with votes
      setTimeout(() => {
        (finalRes||[]).forEach(r => {
          const tv = (r.votes_approve||0)+(r.votes_reject||0)+(r.votes_abstain||0);
          if (tv > 0) this._drawVoteChart(r.id, r.votes_approve||0, r.votes_reject||0, r.votes_abstain||0);
        });
      }, 80);
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);padding:10px;font-size:12px">${esc(e.message)}</div>`;
    }
  },

  // ── Agenda section ─────────────────────────────────────────────────────────
  _sAgenda(items, allDocs = []) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const total = items.reduce((s, i) => s + (i.duration_mins || 0), 0);
    const typeOpts = Object.keys(DOC_TYPES).map(k => `<option value="${k}">${esc((DOC_TYPES[k]||{})[l]||k)}</option>`).join('');
    const statusOpts = Object.keys(DOC_STATUS).map(k => `<option value="${k}">${esc((DOC_STATUS[k]||{})[l==='ar'?'ar':'en']||k)}</option>`).join('');
    const dicon = t => ({board_paper:'🗂️',financial_report:'💰',legal:'⚖️',presentation:'📊',proposal:'💡',policy:'📜',minutes:'📝',report:'📋',other:'📄'}[t]||'📄');
    return `<div class="card" id="sec-agenda">
      <div class="ch">
        <div>
          <div class="ct">📋 ${lbl('جدول الأعمال','Agenda')}</div>
          ${total ? `<div class="ctsub">${total} ${lbl('دقيقة إجمالاً','min total')}</div>` : ''}
        </div>
        <button class="btn-ghost btn-sm" onclick="Gov._showForm('agenda-form')">+ ${lbl('إضافة بند','Add Item')}</button>
      </div>
      <div id="agenda-form" style="display:none;background:var(--navy3);border-radius:10px;padding:13px;margin-bottom:12px">
        <div class="fs" style="gap:8px">
          <div class="frow"><div class="fl">${lbl('العنوان','Title')} *</div><input class="fi" id="ai-title" placeholder="${lbl('عنوان البند','Agenda item title')}"/></div>
          <div class="frow"><div class="fl">${lbl('الوصف','Description')}</div><textarea class="fi" id="ai-desc" rows="2" placeholder="${lbl('تفاصيل البند...','Details...')}"></textarea></div>
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('المُقدِّم','Presenter')}</div><input class="fi" id="ai-pres" placeholder="${lbl('اسم المُقدِّم','Presenter name')}"/></div>
            <div class="frow"><div class="fl">${lbl('المدة (دقيقة)','Duration (min)')}</div><input class="fi" type="number" id="ai-dur" value="15" min="1"/></div>
          </div>
          <div class="frow"><div class="fl">${lbl('النتيجة المتوقعة','Expected Outcome')}</div><input class="fi" id="ai-out" placeholder="${lbl('ما الذي نريد تحقيقه؟','What outcome is expected?')}"/></div>
          <div class="fa">
            <button class="btn-gold btn-sm" onclick="Gov.addAgendaItem()">✓ ${lbl('إضافة','Add')}</button>
            <button class="btn-ghost btn-sm" onclick="Gov._hideForm('agenda-form')">✕</button>
          </div>
        </div>
      </div>
      ${items.length
        ? items.map((item, idx) => {
            const itemDocs = allDocs.filter(d => d.agenda_item_id === item.id);
            return `
            <div style="padding:10px 0;border-bottom:.5px solid var(--border2)">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600;color:var(--text)">${idx+1}. ${esc(item.title)}</div>
                  ${item.description ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(item.description)}</div>` : ''}
                  <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
                    ${item.presenter ? `<span class="tag" style="background:var(--gold-dim);color:var(--gold);font-size:10px">👤 ${esc(item.presenter)}</span>` : ''}
                    ${item.duration_mins ? `<span class="tag" style="background:var(--navy4);font-size:10px">⏱ ${item.duration_mins} ${lbl('د','min')}</span>` : ''}
                    ${item.expected_outcome ? `<span class="tag tb" style="font-size:10px">🎯 ${esc(item.expected_outcome.substring(0,40))}${item.expected_outcome.length>40?'…':''}</span>` : ''}
                  </div>
                  <div style="margin-top:7px;padding-inline-start:10px;border-inline-start:2px solid var(--border2)">
                    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:${itemDocs.length?'5px':'0'}">
                      ${itemDocs.length ? `<span style="font-size:10px;color:var(--text3)">📎 ${lbl('مرفقات','Attachments')}:</span>` : ''}
                      ${itemDocs.map(d => { const st = DOC_STATUS[d.status]||DOC_STATUS.draft; return `<span class="tag" title="${esc(d.description||'')}" style="font-size:10px;background:${st.bg};color:${st.c}">${dicon(d.doc_type)} ${esc(d.title.substring(0,28))}${d.title.length>28?'…':''}</span>`; }).join('')}
                      <button class="btn-ghost btn-sm" onclick="Gov._showForm('ai-doc-${item.id}')" style="font-size:10px">📎 ${lbl('إرفاق','Attach')}</button>
                    </div>
                    <div id="ai-doc-${item.id}" style="display:none;background:var(--navy4);border-radius:8px;padding:10px;margin-top:4px">
                      <div class="fs" style="gap:6px">
                        <div class="fr2">
                          <div class="frow"><div class="fl" style="font-size:11px">${lbl('العنوان','Title')} *</div><input class="fi" id="ai-doc-title-${item.id}" style="font-size:12px" placeholder="${lbl('اسم المستند','Document name')}"/></div>
                          <div class="frow"><div class="fl" style="font-size:11px">${lbl('النوع','Type')}</div><select class="fi" id="ai-doc-type-${item.id}" style="font-size:12px">${typeOpts}</select></div>
                        </div>
                        <div class="fr2">
                          <div class="frow"><div class="fl" style="font-size:11px">${lbl('رُفع بواسطة','Uploaded by')}</div><input class="fi" id="ai-doc-by-${item.id}" style="font-size:12px" placeholder="${lbl('الاسم','Name')}"/></div>
                          <div class="frow"><div class="fl" style="font-size:11px">${lbl('الحالة','Status')}</div><select class="fi" id="ai-doc-status-${item.id}" style="font-size:12px">${statusOpts}</select></div>
                        </div>
                        <div class="fa">
                          <button class="btn-gold btn-sm" onclick="Gov.addAgendaDoc(${item.id})">✓ ${lbl('إرفاق','Attach')}</button>
                          <button class="btn-ghost btn-sm" onclick="Gov._hideForm('ai-doc-${item.id}')">✕</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <button class="btn-ghost btn-sm" onclick="Gov.delAgendaItem(${item.id})" style="color:var(--red);font-size:11px">✕</button>
              </div>
            </div>`;
          }).join('')
        : `<div class="es" style="padding:16px"><div class="es-icon">📋</div><div style="font-size:12px">${lbl('لا توجد بنود بعد','No agenda items yet')}</div></div>`}
    </div>`;
  },

  async addAgendaItem() {
    const t = (($('ai-title') || {}).value || '').trim();
    if (!t) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = { title: t, description: (($('ai-desc') || {}).value || '').trim() || '',
      presenter: (($('ai-pres') || {}).value || '').trim() || '', duration_mins: parseInt(($('ai-dur') || {}).value) || 15,
      expected_outcome: (($('ai-out') || {}).value || '').trim() || '' };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try { await api('/api/gov/agenda', { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async delAgendaItem(id) {
    if (!confirm(this.lbl('حذف هذا البند؟','Delete this agenda item?'))) return;
    try { await api(`/api/gov/agenda/${id}`, { method:'DELETE' }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  // ── Attendance section ─────────────────────────────────────────────────────
  _sAttendance(attendees) {
    if (!this.meetingId) return '';
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const roleOpts = Object.keys(ATTENDEE_ROLES).map(k =>
      `<option value="${k}">${esc((ATTENDEE_ROLES[k]||{})[l]||k)}</option>`).join('');
    return `<div class="card" id="sec-attendance">
      <div class="ch">
        <div>
          <div class="ct">👥 ${lbl('الحضور والأدوار','Attendance & Roles')}</div>
          <div class="ctsub">${attendees.length} ${lbl('مشارك','participant(s)')}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="Gov._showForm('att-form')">+ ${lbl('إضافة','Add')}</button>
      </div>
      <div id="att-form" style="display:none;background:var(--navy3);border-radius:10px;padding:13px;margin-bottom:12px">
        <div class="fs" style="gap:8px">
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('الاسم','Name')} *</div><input class="fi" id="att-name" placeholder="${lbl('اسم المشارك','Attendee name')}"/></div>
            <div class="frow"><div class="fl">${lbl('الدور','Role')}</div>
              <select class="fi" id="att-role"><option value="Member">${lbl('عضو','Member')}</option>${roleOpts}</select>
            </div>
          </div>
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('الحضور','Status')}</div>
              <select class="fi" id="att-status">
                <option value="present">${lbl('حاضر','Present')}</option>
                <option value="absent">${lbl('غائب','Absent')}</option>
                <option value="excused">${lbl('معتذر','Excused')}</option>
                <option value="pending">${lbl('غير محدد','—')}</option>
              </select>
            </div>
            <div class="frow"><div class="fl">${lbl('البريد','Email')}</div><input class="fi" type="email" id="att-email" placeholder="email@example.com" dir="ltr" style="text-align:left"/></div>
          </div>
          <div class="fa">
            <button class="btn-gold btn-sm" onclick="Gov.addAttendee()">✓ ${lbl('إضافة','Add')}</button>
            <button class="btn-ghost btn-sm" onclick="Gov._hideForm('att-form')">✕</button>
          </div>
        </div>
      </div>
      ${attendees.length
        ? `<div style="display:flex;flex-direction:column;gap:5px">
          ${attendees.map(a => {
            const st = ATTENDANCE_ST[a.attendance_status||'pending']||ATTENDANCE_ST.pending;
            const role = (ATTENDEE_ROLES[a.role]||{})[l] || a.role || '';
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--navy3);border-radius:8px">
              <div style="flex:1">
                <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(a.name)}</div>
                ${role ? `<div style="font-size:10px;color:var(--text3)">${esc(role)}</div>` : ''}
              </div>
              <select style="font-size:11px;padding:3px 6px;border-radius:5px;border:1px solid var(--border2);background:var(--navy4);color:var(--text2);cursor:pointer"
                onchange="Gov.updateAttStatus(${a.id},this.value)">
                <option value="present" ${a.attendance_status==='present'?'selected':''}>${lbl('حاضر','Present')}</option>
                <option value="absent" ${a.attendance_status==='absent'?'selected':''}>${lbl('غائب','Absent')}</option>
                <option value="excused" ${a.attendance_status==='excused'?'selected':''}>${lbl('معتذر','Excused')}</option>
                <option value="pending" ${!a.attendance_status||a.attendance_status==='pending'?'selected':''}>${lbl('—','—')}</option>
              </select>
              <span style="font-size:10px;font-weight:600;color:${st.c};min-width:36px;text-align:center">${st[l]}</span>
              <button class="btn-ghost btn-sm" onclick="Gov.delAttendee(${a.id})" style="color:var(--red);font-size:10px">✕</button>
            </div>`;
          }).join('')}
        </div>`
        : `<div class="es" style="padding:12px"><div class="es-icon">👥</div><div style="font-size:12px">${lbl('لا يوجد حضور مسجل','No attendance records yet')}</div></div>`}
    </div>`;
  },

  async addAttendee() {
    const name = (($('att-name') || {}).value || '').trim();
    if (!name) { showToast(this.lbl('يرجى إدخال الاسم','Please enter a name'), 'error'); return; }
    try {
      await api('/api/gov/attendance', { method:'POST', body: JSON.stringify({
        meeting_id: this.meetingId, name,
        email: (($('att-email') || {}).value || '').trim() || '',
        role: ($('att-role') || {}).value || 'Member',
        attendance_status: ($('att-status') || {}).value || 'pending',
      })});
      await this._loadSections();
    } catch (e) { showToast(e.message, 'error'); }
  },

  async updateAttStatus(id, status) {
    try { await api(`/api/gov/attendance/${id}`, { method:'PATCH', body: JSON.stringify({ attendance_status: status }) }); }
    catch (e) { /* silent — dropdown already changed visually */ }
  },

  async delAttendee(id) {
    if (!confirm(this.lbl('حذف هذا الحاضر؟','Remove this attendee?'))) return;
    try { await api(`/api/gov/attendance/${id}`, { method:'DELETE' }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  // ── Quorum section ─────────────────────────────────────────────────────────
  _sQuorum(quorum) {
    const lbl = this.lbl.bind(this);
    const q = quorum || { required_members:0, present_members:0, quorum_achieved:0, notes:'' };
    const achieved = q.quorum_achieved;
    return `<div class="card" id="sec-quorum">
      <div class="ch">
        <div><div class="ct">🏛 ${lbl('النصاب القانوني','Quorum')}</div></div>
        ${q.required_members > 0
          ? `<span class="tag ${achieved?'tg':'tr'}" style="font-size:11px">${achieved ? lbl('✓ مكتمل','✓ Achieved') : lbl('✗ غير مكتمل','✗ Not Met')}</span>`
          : ''}
      </div>
      <div class="fs" style="gap:10px">
        <div class="fr2">
          <div class="frow"><div class="fl">${lbl('الأعضاء المطلوبون','Required Members')}</div>
            <input class="fi" type="number" id="q-req" value="${q.required_members||0}" min="0" onchange="Gov._autoSaveQuorum()"/></div>
          <div class="frow"><div class="fl">${lbl('الحاضرون فعلياً','Present Members')}</div>
            <input class="fi" type="number" id="q-pres" value="${q.present_members||0}" min="0" onchange="Gov._autoSaveQuorum()"/></div>
        </div>
        <div class="frow"><div class="fl">${lbl('ملاحظات','Notes')}</div>
          <input class="fi" id="q-notes" value="${esc(q.notes||'')}" placeholder="${lbl('ملاحظات...','Notes...')}" onblur="Gov._autoSaveQuorum()"/></div>
        <button class="btn-gold btn-sm" onclick="Gov.saveQuorum()">✓ ${lbl('حفظ النصاب','Save Quorum')}</button>
      </div>
    </div>`;
  },

  _autoSaveQuorum() { clearTimeout(this._qTimer); this._qTimer = setTimeout(() => this.saveQuorum(), 900); },

  async saveQuorum() {
    const body = { required_members: parseInt(($('q-req') || {}).value) || 0, present_members: parseInt(($('q-pres') || {}).value) || 0, notes: (($('q-notes') || {}).value || '').trim() || '' };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try {
      await api('/api/gov/quorum', { method:'PUT', body: JSON.stringify(body) });
      const fresh = await api(`/api/gov/quorum?${this._qParam()}`).catch(() => null);
      const el = $('sec-quorum');
      if (el) el.outerHTML = this._sQuorum(fresh);
    } catch (e) { /* silent auto-save */ }
  },

  // ── Resolutions & Voting section ──────────────────────────────────────────
  _sResolutions(resolutions) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const role = (App.user||{}).system_role || '';
    const canManage = ['Admin','CEO','Chairman','Secretary'].includes(role);
    const canVote   = !['Observer'].includes(role);

    const VS = {
      draft:    { ar:'مسودة',          en:'Draft',         c:'var(--text3)',  bg:'var(--navy4)' },
      open:     { ar:'تصويت مفتوح',    en:'Voting Open',   c:'#2D8CFF',      bg:'rgba(45,140,255,.12)' },
      closed:   { ar:'تصويت مغلق',     en:'Voting Closed', c:'var(--amber)',  bg:'rgba(201,168,76,.12)' },
      archived: { ar:'مؤرشف',          en:'Archived',      c:'var(--green)',  bg:'rgba(46,204,138,.12)' },
    };
    const WFLOW = [
      { s:'draft',    ar:'مسودة',       en:'Draft' },
      { s:'open',     ar:'مفتوح',       en:'Open' },
      { s:'closed',   ar:'مغلق',        en:'Closed' },
      { s:'archived', ar:'مؤرشف',       en:'Archived' },
    ];

    const stBadge = s => {
      const st = RESOLUTION_ST[s]||RESOLUTION_ST.pending;
      return `<span class="tag" style="font-size:10.5px;background:transparent;border:1px solid ${st.c};color:${st.c}">${st[l]||s}</span>`;
    };

    const votingBar = (label, count, total, color) => {
      const pct = total > 0 ? Math.round((count/total)*100) : 0;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <span style="font-size:11.5px;color:var(--text2);min-width:70px;flex-shrink:0">${label}</span>
        <div style="flex:1;height:9px;background:var(--navy2);border-radius:20px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:20px;transition:width .5s ease"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${color};min-width:24px;text-align:end">${count}</span>
        <span style="font-size:10.5px;color:var(--text3);min-width:32px">${pct}%</span>
      </div>`;
    };

    const resCard = r => {
      const vs  = r.voting_status || 'draft';
      const vsi = VS[vs] || VS.draft;
      const totalVotes = (r.votes_approve||0)+(r.votes_reject||0)+(r.votes_abstain||0);
      const rSt = RESOLUTION_ST[r.status]||RESOLUTION_ST.pending;
      const wIdx = WFLOW.findIndex(w=>w.s===vs);
      const isOpen = vs==='open', isClosed = vs==='closed', isArchived = vs==='archived';

      return `<div style="background:var(--navy3);border-radius:13px;padding:18px 20px;border:1px solid var(--border2);border-inline-start:3px solid ${rSt.c};margin-bottom:14px" id="res-card-${r.id}">

        <!-- ── Header ─────────────────────────────────────────────── -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:7px">
              ${stBadge(r.status)}
              <span style="font-size:10.5px;padding:2px 9px;border-radius:10px;background:${vsi.bg};color:${vsi.c};font-weight:700;border:.5px solid ${vsi.c}55">${vsi[l==='ar'?'ar':'en']}</span>
              ${totalVotes>0&&(isClosed||isArchived) ? `<span class="tag ${r.status==='approved'?'tg':'tr'}" style="font-size:10px">${r.status==='approved'?'✓ '+lbl('نجح القرار','Passed'):'✗ '+lbl('لم ينجح','Failed')}</span>` : ''}
            </div>
            <div style="font-size:14.5px;font-weight:700;color:var(--text);line-height:1.4">${esc(r.title)}</div>
            ${r.description ? `<div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.6">${esc(r.description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;align-items:flex-start">
            ${canManage&&!isArchived ? `
              ${vs==='draft'   ? `<button onclick="Gov.setVotingStatus(${r.id},'open')" class="btn-gold btn-sm" style="font-size:11px;white-space:nowrap">🗳️ ${lbl('فتح التصويت','Open Voting')}</button>` : ''}
              ${vs==='open'    ? `<button onclick="Gov.setVotingStatus(${r.id},'closed')" class="btn-ghost btn-sm" style="font-size:11px;white-space:nowrap;border-color:var(--amber);color:var(--amber)">🔒 ${lbl('إغلاق التصويت','Close Voting')}</button>` : ''}
              ${vs==='closed'  ? `<button onclick="Gov.setVotingStatus(${r.id},'archived')" class="btn-ghost btn-sm" style="font-size:11px;white-space:nowrap;border-color:var(--green);color:var(--green)">🗄️ ${lbl('أرشفة','Archive')}</button>` : ''}
            ` : ''}
            <button onclick="Gov.delResolution(${r.id})" class="btn-ghost btn-sm" style="color:var(--red);font-size:11px">✕</button>
          </div>
        </div>

        <!-- ── Workflow track ────────────────────────────────────── -->
        <div style="display:flex;align-items:center;margin-bottom:14px">
          ${WFLOW.map((w,i)=>{
            const done   = i < wIdx;
            const active = i === wIdx;
            const c = done?'var(--green)':active?vsi.c:'var(--text3)';
            return `${i>0?`<div style="flex:1;height:1.5px;background:${done?'var(--green)':'var(--border2)'}"></div>`:''}
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0">
                <div style="width:22px;height:22px;border-radius:50%;background:${done?'rgba(46,204,138,.15)':active?vsi.bg:'var(--navy4)'};border:2px solid ${c};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:${c}">${done?'✓':i+1}</div>
                <div style="font-size:9px;color:${c};white-space:nowrap">${l==='ar'?w.ar:w.en}</div>
              </div>`;
          }).join('')}
        </div>

        <!-- ── Vote totals + doughnut chart ─────────────────────── -->
        ${totalVotes>0||vs!=='draft' ? `
          <div style="background:var(--navy2);border-radius:10px;padding:13px 14px;margin-bottom:12px;border:.5px solid var(--border2)">
            <div style="display:flex;gap:14px;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                  <span style="font-size:12px;font-weight:700;color:var(--text2)">🗳️ ${lbl('نتائج التصويت','Voting Results')}</span>
                  <div style="display:flex;gap:6px;align-items:center">
                    ${totalVotes>0 ? `<span style="font-size:11px;color:var(--text3)">${totalVotes} ${lbl('صوت','votes')}</span>` : `<span style="font-size:11px;color:var(--text3)">${lbl('لا أصوات بعد','No votes yet')}</span>`}
                    ${totalVotes>0&&(isOpen||isClosed) ? `<span style="font-size:10.5px;padding:2px 8px;border-radius:5px;background:${(r.votes_approve||0)>(r.votes_reject||0)?'rgba(46,204,138,.12)':'rgba(201,168,76,.12)'};color:${(r.votes_approve||0)>(r.votes_reject||0)?'var(--green)':'var(--amber)'}">
                      ${(r.votes_approve||0)>(r.votes_reject||0)?'✓ '+lbl('الأغلبية مؤيدة','Majority for'):'⚠ '+lbl('بدون أغلبية','No majority')}
                    </span>` : ''}
                  </div>
                </div>
                ${votingBar(lbl('✅ موافق','✅ For'),       r.votes_approve||0, totalVotes, '#2ECC8A')}
                ${votingBar(lbl('❌ رفض','❌ Against'),     r.votes_reject||0,  totalVotes, '#E05A5A')}
                ${votingBar(lbl('◎ امتناع','◎ Abstain'), r.votes_abstain||0, totalVotes, '#8B9DB8')}
              </div>
              <div style="width:88px;height:88px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;margin-top:4px">
                ${totalVotes>0 ? `<canvas id="vote-chart-${r.id}" width="88" height="88" style="display:block"></canvas>` : `<div style="width:88px;height:88px;border-radius:50%;border:3px dashed var(--border2);display:flex;align-items:center;justify-content:center"><span style="font-size:9px;color:var(--text3);text-align:center">${lbl('لا\nأصوات','No\nvotes')}</span></div>`}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- ── Vote buttons (only when voting is open) ─────────── -->
        ${isOpen&&canVote ? `
          <div style="background:rgba(45,140,255,.05);border:1px solid rgba(45,140,255,.22);border-radius:11px;padding:14px;margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;color:#2D8CFF;margin-bottom:10px">🗳️ ${lbl('صوّت الآن','Cast Your Vote')}</div>
            <input class="fi" id="vote-comment-${r.id}" placeholder="${lbl('تعليق اختياري على صوتك...','Optional comment on your vote...')}" style="font-size:12px;margin-bottom:10px"/>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button onclick="Gov.vote(${r.id},'approve')"
                style="flex:1;min-width:90px;padding:11px 12px;background:var(--green2);color:var(--green);border:1.5px solid rgba(46,204,138,.4);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">
                ✅ ${lbl('موافق','For')}
              </button>
              <button onclick="Gov.vote(${r.id},'reject')"
                style="flex:1;min-width:90px;padding:11px 12px;background:var(--red2);color:var(--red);border:1.5px solid rgba(224,90,90,.4);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">
                ❌ ${lbl('رفض','Against')}
              </button>
              <button onclick="Gov.vote(${r.id},'abstain')"
                style="flex:1;min-width:90px;padding:11px 12px;background:var(--navy4);color:var(--text3);border:1.5px solid var(--border2);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">
                ◎ ${lbl('امتناع','Abstain')}
              </button>
            </div>
          </div>
        ` : isOpen&&!canVote ? `<div style="font-size:11.5px;color:var(--text3);padding:10px 14px;background:var(--navy4);border-radius:8px;margin-bottom:12px">🔒 ${lbl('دورك لا يتيح التصويت في هذا القرار','Your role does not permit voting on this resolution')}</div>` : ''}

        <!-- ── Voting history toggle ──────────────────────────── -->
        <div style="margin-bottom:12px">
          <button onclick="Gov.toggleVoteHistory(${r.id})"
            style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:9px 13px;background:var(--navy4);border:none;border-radius:8px;cursor:pointer;color:var(--text2);font-size:11.5px;font-weight:600" id="hist-toggle-${r.id}">
            <span>📜 ${lbl('سجل التصويت','Voting History')}${totalVotes>0?` (${totalVotes})`:''}</span>
            <span id="hist-arrow-${r.id}" style="color:var(--text3)">▾</span>
          </button>
          <div id="vote-history-${r.id}" style="display:none;margin-top:6px"></div>
        </div>

        <!-- ── Follow-up actions ──────────────────────────────── -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:12px;font-weight:700;color:var(--text2)">📌 ${lbl('إجراءات المتابعة','Follow-up Actions')}</span>
            <button class="btn-ghost btn-sm" onclick="Gov._showForm('fu-form-${r.id}')" style="font-size:10.5px">+ ${lbl('إضافة','Add')}</button>
          </div>
          <div id="fu-form-${r.id}" style="display:none;background:var(--navy4);border-radius:8px;padding:11px;margin-bottom:8px">
            <div class="fs" style="gap:6px">
              <div class="fr2">
                <div class="frow"><div class="fl" style="font-size:11px">${lbl('المسؤول','Owner')}</div><input class="fi" id="fu-owner-${r.id}" placeholder="${lbl('الاسم','Name')}"/></div>
                <div class="frow"><div class="fl" style="font-size:11px">${lbl('الموعد','Due Date')}</div><input class="fi" type="date" id="fu-due-${r.id}"/></div>
              </div>
              <div class="frow"><div class="fl" style="font-size:11px">${lbl('ملاحظات','Notes')}</div><input class="fi" id="fu-notes-${r.id}" placeholder="${lbl('ملاحظات...','Notes...')}"/></div>
              <div class="fa">
                <button class="btn-gold btn-sm" onclick="Gov.addFollowup(${r.id})">✓ ${lbl('حفظ','Save')}</button>
                <button class="btn-ghost btn-sm" onclick="Gov._hideForm('fu-form-${r.id}')">✕</button>
              </div>
            </div>
          </div>
          ${(r.followups||[]).length
            ? r.followups.map(f => `
              <div style="display:flex;gap:7px;align-items:center;padding:6px 10px;background:var(--navy4);border-radius:7px;margin-bottom:4px;font-size:11.5px">
                <div style="flex:1">
                  <span style="color:var(--gold);font-weight:600">${esc(f.owner||'—')}</span>
                  ${f.due_date ? `<span style="color:var(--text3)"> · 📅 ${esc(f.due_date)}</span>` : ''}
                  ${f.notes ? `<span style="color:var(--text2)"> · ${esc(f.notes)}</span>` : ''}
                </div>
                <select style="font-size:10px;padding:2px 5px;border-radius:5px;border:1px solid var(--border2);background:var(--navy3);color:var(--text2)"
                  onchange="Gov.updateFollowup(${f.id},this.value)">
                  ${Object.keys(FOLLOWUP_ST).map(k=>`<option value="${k}" ${f.status===k?'selected':''}>${esc((FOLLOWUP_ST[k]||{})[l]||k)}</option>`).join('')}
                </select>
                <button onclick="Gov.delFollowup(${f.id})" style="color:var(--red);background:none;border:none;cursor:pointer;font-size:11px;padding:0">✕</button>
              </div>`).join('')
            : `<div style="font-size:12px;color:var(--text3)">${lbl('لا توجد متابعات','No follow-up actions yet')}</div>`}
        </div>
      </div>`;
    };

    return `<div class="card" id="sec-resolutions">
      <div class="ch">
        <div>
          <div class="ct">⚖️ ${lbl('القرارات والتصويت','Resolutions & Voting')}</div>
          <div class="ctsub">${resolutions.length} ${lbl('قرار','resolution(s)')}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="Gov._showForm('res-form')">+ ${lbl('إضافة قرار','Add Resolution')}</button>
      </div>
      <div id="res-form" style="display:none;background:var(--navy3);border-radius:10px;padding:13px;margin-bottom:12px">
        <div class="fs" style="gap:8px">
          <div class="frow"><div class="fl">${lbl('عنوان القرار','Resolution Title')} *</div><input class="fi" id="res-title" placeholder="${lbl('عنوان القرار...','Resolution title...')}"/></div>
          <div class="frow"><div class="fl">${lbl('الوصف','Description')}</div><textarea class="fi" id="res-desc" rows="2" placeholder="${lbl('وصف القرار...','Describe the resolution...')}"></textarea></div>
          <div class="fa">
            <button class="btn-gold btn-sm" onclick="Gov.addResolution()">✓ ${lbl('إضافة','Add')}</button>
            <button class="btn-ghost btn-sm" onclick="Gov._hideForm('res-form')">✕</button>
          </div>
        </div>
      </div>
      ${resolutions.length
        ? resolutions.map(resCard).join('')
        : `<div class="es" style="padding:24px">
            <div class="es-icon">⚖️</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:5px">${lbl('لا توجد قرارات','No resolutions yet')}</div>
            <div style="font-size:12px;color:var(--text3)">${lbl('أضف قراراً للبدء في التصويت','Add a resolution to start the voting workflow')}</div>
           </div>`}
    </div>`;
  },

  async addResolution() {
    const title = (($('res-title') || {}).value || '').trim();
    if (!title) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = { title, description: (($('res-desc') || {}).value || '').trim() || '' };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try { await api('/api/gov/resolutions', { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async vote(resId, vote) {
    const comment = (($('vote-comment-' + resId) || {}).value || '').trim();
    try {
      await api(`/api/gov/resolutions/${resId}/vote`, { method:'POST', body: JSON.stringify({ vote, comments: comment }) });
      showToast(this.lbl('تم تسجيل صوتك','Vote recorded successfully'), 'success');
      await this._loadSections();
    }
    catch (e) { showToast(e.message, 'error'); }
  },

  async setVotingStatus(resId, status) {
    const msgs = {
      open:     this.lbl('فتح التصويت على هذا القرار؟','Open voting on this resolution?'),
      closed:   this.lbl('إغلاق التصويت نهائياً وإقرار النتيجة؟','Close voting? This will finalize the result.'),
      archived: this.lbl('أرشفة هذا القرار؟','Archive this resolution?'),
    };
    if (msgs[status] && !confirm(msgs[status])) return;
    try {
      await api(`/api/gov/resolutions/${resId}/voting-status`, { method:'POST', body: JSON.stringify({ status }) });
      showToast(this.lbl('تم تحديث حالة التصويت','Voting status updated'), 'success');
      await this._loadSections();
    } catch (e) { showToast(e.message, 'error'); }
  },

  async toggleVoteHistory(resId) {
    const el    = document.getElementById('vote-history-' + resId);
    const arrow = document.getElementById('hist-arrow-' + resId);
    if (!el) return;
    if (el.style.display !== 'none') {
      el.style.display = 'none';
      if (arrow) arrow.textContent = '▾';
      return;
    }
    el.style.display = '';
    if (arrow) arrow.textContent = '▴';
    el.innerHTML = '<div class="es" style="padding:10px"><div class="loading"></div></div>';
    try {
      const data = await api('/api/gov/resolutions/' + resId + '/votes');
      const l = App.lang;
      const lbl = this.lbl.bind(this);
      const vIcon  = { approve:'✅', reject:'❌', abstain:'◎' };
      const vLabel = { approve:{ar:'موافق',en:'For'}, reject:{ar:'رفض',en:'Against'}, abstain:{ar:'امتناع',en:'Abstain'} };
      const vColor = { approve:'#2ECC8A', reject:'#E05A5A', abstain:'#8B9DB8' };
      const noVotes = !data.votes || data.votes.length === 0;

      // ── Quorum section ─────────────────────────────────────────────
      const qSection = data.quorum_total > 0 ? `
        <div style="padding:11px 14px;border-bottom:.5px solid var(--border2);background:${data.quorum_met?'rgba(46,204,138,.06)':'rgba(240,100,100,.05)'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
            <span style="font-size:11.5px;font-weight:700;color:var(--text2)">⚖️ ${lbl('النصاب القانوني','Quorum')}</span>
            <span style="font-size:11px;padding:2px 9px;border-radius:10px;background:${data.quorum_met?'rgba(46,204,138,.15)':'rgba(240,100,100,.15)'};color:${data.quorum_met?'#2ECC8A':'#E05A5A'};font-weight:700">
              ${data.quorum_met ? '✓ '+lbl('محقق','Achieved') : '✗ '+lbl('لم يتحقق','Not Met')}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <div style="flex:1;height:8px;background:var(--navy2);border-radius:20px;overflow:hidden;position:relative">
              <div style="height:100%;width:${data.quorum_pct||0}%;background:${data.quorum_met?'#2ECC8A':'#E05A5A'};border-radius:20px;transition:width .5s"></div>
              <div style="position:absolute;top:0;bottom:0;left:50%;width:1.5px;background:var(--amber);opacity:.7"></div>
            </div>
            <span style="font-size:11px;font-weight:700;color:${data.quorum_met?'#2ECC8A':'#E05A5A'};min-width:32px">${data.quorum_pct||0}%</span>
          </div>
          <div style="font-size:10.5px;color:var(--text3)">${data.total} ${lbl('من أصل','of')} ${data.quorum_total} ${lbl('مشارك صوّتوا','participants voted')} · ${lbl('مطلوب','Required')}: ${data.quorum_needed} (50%+)</div>
        </div>` : '';

      // ── Voted list ─────────────────────────────────────────────────
      const votedSection = noVotes ? `
        <div style="padding:14px 16px;text-align:center">
          <div style="font-size:28px;margin-bottom:6px">🗳️</div>
          <div style="font-size:12.5px;font-weight:600;color:var(--text2)">${lbl('لا توجد أصوات مسجلة بعد','No votes have been cast yet')}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">${lbl('سيظهر هنا كل صوت فور تسجيله','Every vote will appear here as soon as it is cast')}</div>
        </div>` : `
        <div>
          <div style="padding:8px 14px 6px;font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">
            ✅ ${lbl('صوّتوا','Voted')} (${data.total})
          </div>
          <div style="max-height:220px;overflow-y:auto">
            ${data.votes.map((v, i) => {
              const vc = vColor[v.vote] || '#8B9DB8';
              const vi = vIcon[v.vote]  || '—';
              const vl = (vLabel[v.vote]||{})[l==='ar'?'ar':'en'] || v.vote;
              const dt = (v.updated_at||v.created_at||'').substring(0,16).replace('T',' ');
              return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-top:.5px solid var(--border2);${i%2===1?'background:rgba(255,255,255,.015)':''}">
                <div style="width:30px;height:30px;border-radius:50%;background:${vc}18;border:1.5px solid ${vc}55;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${vi}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12.5px;font-weight:600;color:var(--text)">${esc(v.voter_name||lbl('مستخدم','User'))}</div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;align-items:center">
                    ${v.voter_role ? `<span style="font-size:10px;padding:1px 6px;border-radius:5px;background:var(--navy2);color:var(--text3)">${esc(v.voter_role)}</span>` : ''}
                    <span style="font-size:10.5px;padding:1px 7px;border-radius:5px;background:${vc}18;color:${vc};font-weight:700;border:.5px solid ${vc}44">${vi} ${vl}</span>
                    ${dt ? `<span style="font-size:10px;color:var(--text3)">🕐 ${esc(dt)}</span>` : ''}
                  </div>
                  ${v.comments ? `<div style="font-size:11.5px;color:var(--text2);margin-top:4px;font-style:italic">"${esc(v.comments)}"</div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;

      // ── Not voted yet (CEO/Chairman view) ──────────────────────────
      const notVotedSection = (data.not_voted && data.not_voted.length > 0) ? `
        <div style="border-top:.5px solid var(--border2)">
          <div style="padding:8px 14px 6px;font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">
            ⏳ ${lbl('لم يصوّتوا بعد','Not Voted Yet')} (${data.not_voted.length})
          </div>
          ${data.not_voted.map(a => `
            <div style="display:flex;align-items:center;gap:9px;padding:7px 14px;border-top:.5px solid var(--border2)">
              <div style="width:28px;height:28px;border-radius:50%;background:rgba(201,168,76,.12);border:1px dashed var(--amber);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">⏳</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--text2)">${esc(a.name||'—')}</div>
                ${a.role ? `<div style="font-size:10px;color:var(--text3)">${esc(a.role)}</div>` : ''}
              </div>
              ${a.attendance_status ? `<span style="font-size:10px;color:var(--text3)">${esc(a.attendance_status)}</span>` : ''}
            </div>`).join('')}
        </div>` : '';

      el.innerHTML = `
        <div style="background:var(--navy4);border-radius:10px;overflow:hidden;border:.5px solid var(--border2)">
          <div style="display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:.5px solid var(--border2);flex-wrap:wrap;background:var(--navy3)">
            <span style="font-size:12px;font-weight:700;color:var(--text2)">📜 ${lbl('سجل التصويت','Voting History')}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(46,204,138,.15);color:#2ECC8A;font-weight:700">✅ ${data.approve} ${l==='ar'?'موافق':'For'}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(224,90,90,.15);color:#E05A5A;font-weight:700">❌ ${data.reject} ${l==='ar'?'رفض':'Against'}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(139,157,184,.15);color:#8B9DB8;font-weight:700">◎ ${data.abstain} ${l==='ar'?'امتناع':'Abstain'}</span>
            ${data.total>0 ? `<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:${data.passed?'rgba(46,204,138,.15)':'rgba(240,100,100,.12)'};color:${data.passed?'#2ECC8A':'#E05A5A'};font-weight:700">${data.passed?'✓ '+lbl('نجح','Passed'):'✗ '+lbl('لم ينجح','Failed')}</span>` : ''}
          </div>
          ${qSection}
          ${votedSection}
          ${notVotedSection}
        </div>`;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:10px">${esc(e.message)}</div>`;
    }
  },

  // ── Doughnut chart for vote results ────────────────────────────────────────
  _drawVoteChart(resId, approve, reject, abstain) {
    const canvas = document.getElementById('vote-chart-' + resId);
    if (!canvas || typeof Chart === 'undefined') return;
    if (!this._charts) this._charts = {};
    if (this._charts[resId]) { try { this._charts[resId].destroy(); } catch(e) {} }
    const total = approve + reject + abstain;
    if (total === 0) return;
    this._charts[resId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [approve, reject, abstain],
          backgroundColor: ['#2ECC8A', '#E05A5A', '#8B9DB8'],
          borderWidth: 0,
          hoverOffset: 3,
        }],
      },
      options: {
        cutout: '68%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 700, easing: 'easeInOutQuart' },
      },
    });
  },

  // ── Auto-seed sample resolutions for empty meetings ─────────────────────────
  async _seedSampleResolution() {
    const l = App.lang;
    const samples = [
      {
        title: l === 'ar' ? 'اعتماد القوائم المالية للربع الثاني 2026' : 'Approval of Q2 2026 Financial Statements',
        description: l === 'ar'
          ? 'مراجعة واعتماد القوائم المالية المدققة للربع الثاني لعام 2026، بما فيها الميزانية العمومية وقائمة الدخل وقائمة التدفقات النقدية.'
          : 'Review and approve the audited financial statements for Q2 2026, including the balance sheet, income statement, and cash flow statement.',
      },
      {
        title: l === 'ar' ? 'تعيين المراجع الخارجي لعام 2026' : 'Appointment of External Auditor for 2026',
        description: l === 'ar'
          ? 'اعتماد تعيين مكتب PricewaterhouseCoopers مراجعاً خارجياً للشركة للسنة المالية 2026.'
          : 'Approve the appointment of PricewaterhouseCoopers as the company\'s external auditor for fiscal year 2026.',
      },
    ];
    for (const s of samples) {
      const body = { title: s.title, description: s.description };
      if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
      await api('/api/gov/resolutions', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
    }
  },

  async delResolution(id) {
    if (!confirm(this.lbl('حذف هذا القرار؟','Delete this resolution?'))) return;
    try { await api(`/api/gov/resolutions/${id}`, { method:'DELETE' }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async addFollowup(resId) {
    const body = { owner: (($('fu-owner-' + resId) || {}).value || '').trim() || '', due_date: ($('fu-due-' + resId) || {}).value || '', notes: (($('fu-notes-' + resId) || {}).value || '').trim() || '', status:'pending' };
    try { await api(`/api/gov/resolutions/${resId}/followups`, { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async updateFollowup(id, status) {
    try { await api(`/api/gov/followups/${id}`, { method:'PATCH', body: JSON.stringify({ status }) }); }
    catch (e) { /* silent */ }
  },

  async delFollowup(id) {
    try { await api(`/api/gov/followups/${id}`, { method:'DELETE' }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  // ── Documents section ──────────────────────────────────────────────────────
  _sDocs(docs) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const typeOpts = Object.keys(DOC_TYPES).map(k => `<option value="${k}">${esc((DOC_TYPES[k]||{})[l]||k)}</option>`).join('');
    const statusOpts = Object.keys(DOC_STATUS).map(k => `<option value="${k}">${esc((DOC_STATUS[k]||{})[l==='ar'?'ar':'en']||k)}</option>`).join('');
    const dicon = t => ({board_paper:'🗂️',financial_report:'💰',legal:'⚖️',presentation:'📊',proposal:'💡',policy:'📜',minutes:'📝',report:'📋',other:'📄'}[t]||'📄');
    return `<div class="card" id="sec-docs">
      <div class="ch">
        <div>
          <div class="ct">📁 ${lbl('وثائق الاجتماع','Meeting Documents')}</div>
          <div class="ctsub">${docs.length} ${lbl('وثيقة على مستوى الاجتماع','meeting-level document(s)')}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-ghost btn-sm" onclick="Gov._showForm('doc-form')">+ ${lbl('إضافة وثيقة','Add Document')}</button>
          ${this.meetingId ? `<button class="btn-ghost btn-sm" onclick="DocLib.upload(${this.meetingId})">📎 ${lbl('رفع ملف','Upload File')}</button>` : ''}
        </div>
      </div>
      <div id="doc-form" style="display:none;background:var(--navy3);border-radius:10px;padding:13px;margin-bottom:12px">
        <div class="fs" style="gap:8px">
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('العنوان','Title')} *</div><input class="fi" id="doc-title" placeholder="${lbl('اسم الوثيقة','Document name')}"/></div>
            <div class="frow"><div class="fl">${lbl('النوع','Type')}</div><select class="fi" id="doc-type">${typeOpts}</select></div>
          </div>
          <div class="frow"><div class="fl">${lbl('الوصف','Description')}</div><input class="fi" id="doc-desc" placeholder="${lbl('وصف مختصر للوثيقة','Brief document description')}"/></div>
          <div class="fr2">
            <div class="frow"><div class="fl">${lbl('رُفع بواسطة','Uploaded by')}</div><input class="fi" id="doc-by" placeholder="${lbl('الاسم','Name')}"/></div>
            <div class="frow"><div class="fl">${lbl('تاريخ الرفع','Upload Date')}</div><input class="fi" type="date" id="doc-date"/></div>
          </div>
          <div class="frow"><div class="fl">${lbl('الحالة','Status')}</div><select class="fi" id="doc-status">${statusOpts}</select></div>
          <div class="fa">
            <button class="btn-gold btn-sm" onclick="Gov.addDocument()">✓ ${lbl('إضافة','Add')}</button>
            <button class="btn-ghost btn-sm" onclick="Gov._hideForm('doc-form')">✕</button>
          </div>
        </div>
      </div>
      ${docs.length
        ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${docs.map(d => {
            const st = DOC_STATUS[d.status] || DOC_STATUS.draft;
            return `
            <div style="padding:9px 11px;background:var(--navy3);border-radius:8px;border-inline-start:3px solid ${st.c}">
              <div style="display:flex;align-items:flex-start;gap:9px">
                <div style="font-size:18px;flex-shrink:0;margin-top:1px">${dicon(d.doc_type)}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                    <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(d.title)}</div>
                    <span class="tag" style="font-size:10px;background:${st.bg};color:${st.c}">${esc(st[l==='ar'?'ar':'en'])}</span>
                    <span class="tag" style="font-size:10px;background:var(--navy4);color:var(--text3)">${esc((DOC_TYPES[d.doc_type]||{ar:'',en:''})[l]||d.doc_type||'')}</span>
                    ${d.is_mock ? `<span class="tag ta" style="font-size:10px">${lbl('نموذج','Sample')}</span>` : ''}
                  </div>
                  ${d.description ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(d.description)}</div>` : ''}
                  <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:4px">
                    ${d.uploaded_by ? `<span style="font-size:10px;color:var(--text3)">👤 ${esc(d.uploaded_by)}</span>` : ''}
                    ${d.upload_date ? `<span style="font-size:10px;color:var(--text3)">📅 ${esc(d.upload_date)}</span>` : ''}
                  </div>
                </div>
                <div style="display:flex;gap:4px;align-items:flex-start;flex-shrink:0">
                  <select style="font-size:10px;background:var(--navy4);border:1px solid var(--border2);border-radius:6px;color:var(--text2);padding:2px 4px;cursor:pointer" onchange="Gov.updateDocStatus(${d.id},this.value)">
                    ${Object.keys(DOC_STATUS).map(k => `<option value="${k}"${d.status===k?' selected':''}>${esc((DOC_STATUS[k]||{})[l==='ar'?'ar':'en']||k)}</option>`).join('')}
                  </select>
                  <button class="btn-ghost btn-sm" onclick="Gov.delDocument(${d.id})" style="color:var(--red);font-size:10px">✕</button>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>`
        : `<div class="es" style="padding:12px"><div class="es-icon">📁</div><div style="font-size:12px">${lbl('لا توجد وثائق على مستوى الاجتماع','No meeting-level documents yet')}</div></div>`}
    </div>`;
  },

  async addDocument() {
    const title = (($('doc-title') || {}).value || '').trim();
    if (!title) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = {
      title,
      doc_type: ($('doc-type') || {}).value || 'other',
      description: (($('doc-desc') || {}).value || '').trim() || '',
      uploaded_by: (($('doc-by') || {}).value || '').trim() || '',
      upload_date: ($('doc-date') || {}).value || '',
      status: ($('doc-status') || {}).value || 'draft',
    };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try { await api('/api/gov/documents', { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async addAgendaDoc(itemId) {
    const title = (($('ai-doc-title-' + itemId) || {}).value || '').trim();
    if (!title) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = {
      title,
      doc_type: ($('ai-doc-type-' + itemId) || {}).value || 'other',
      uploaded_by: (($('ai-doc-by-' + itemId) || {}).value || '').trim() || '',
      status: ($('ai-doc-status-' + itemId) || {}).value || 'draft',
      agenda_item_id: itemId,
    };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try { await api('/api/gov/documents', { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async updateDocStatus(id, status) {
    try { await api(`/api/gov/documents/${id}`, { method:'PATCH', body: JSON.stringify({ status }) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async delDocument(id) {
    if (!confirm(this.lbl('حذف هذه الوثيقة؟','Delete this document?'))) return;
    try { await api(`/api/gov/documents/${id}`, { method:'DELETE' }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  // ── General Assembly: toggle detail panel ──────────────────────────────────
  async _toggleGADetail(gaId) {
    const el = document.getElementById('ga-detail-' + gaId);
    const btn = document.getElementById('ga-toggle-' + gaId);
    if (!el) return;
    const l = App.lang;
    if (el.style.display === 'none' || !el.style.display) {
      el.style.display = '';
      el.innerHTML = `<div style="padding:20px;text-align:center;border-top:2px solid rgba(139,92,246,.25);margin-top:4px">
        <div class="loading"></div>
        <div style="font-size:12px;color:var(--text3);margin-top:10px">${l==='ar'?'جارٍ تحميل التقرير الكامل...':'Loading full GA report...'}</div>
      </div>`;
      if (btn) btn.textContent = (l === 'ar' ? '▲ طي التقرير' : '▲ Collapse');
      const ga = (this._gas || []).find(g => g.id === gaId) || { id: gaId };
      try {
        const detail = await api('/api/gov/general-assemblies/' + gaId + '/detail');
        const gaData = detail.ga || ga;
        el.innerHTML = this._sGADetail(gaData, detail);
      } catch(e) {
        el.innerHTML = this._sGADetail(ga, null);
      }
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else {
      el.style.display = 'none';
      if (btn) btn.innerHTML = '📊 ' + (l === 'ar' ? 'التقرير الكامل' : 'Full GA Report');
    }
  },

  async _reloadGADetail(gaId) {
    const el = document.getElementById('ga-detail-' + gaId);
    if (!el || el.style.display === 'none') return;
    el.innerHTML = '<div style="padding:14px;text-align:center"><div class="loading"></div></div>';
    const ga = (this._gas || []).find(g => g.id === gaId) || { id: gaId };
    try {
      const detail = await api('/api/gov/general-assemblies/' + gaId + '/detail');
      el.innerHTML = this._sGADetail(detail.ga || ga, detail);
    } catch(e) {
      el.innerHTML = this._sGADetail(ga, null);
    }
  },

  // ── Enterprise demo data (used when backend GA detail fields are absent) ───
  _gaDemo(ga) {
    const y = (ga.meeting_date || '2025').substring(0, 4);
    return {
      shareholders: [
        { nameAr: 'محمد العتيبي',       nameEn: 'Mohammed Al-Otaibi',      shares: 2500000, pct: 35.7, voteRights: 2500000, attendance: 'present', proxy: '—' },
        { nameAr: 'خالد الراشد',         nameEn: 'Khalid Al-Rashid',         shares: 1800000, pct: 25.7, voteRights: 1800000, attendance: 'present', proxy: '—' },
        { nameAr: 'صندوق أمين القابضة', nameEn: 'Ameen Holdings Fund',      shares: 1200000, pct: 17.1, voteRights: 1200000, attendance: 'proxy',   proxy: 'M. Hassan' },
        { nameAr: 'سارة العمري',         nameEn: 'Sarah Al-Amri',            shares:  800000, pct: 11.4, voteRights:  800000, attendance: 'present', proxy: '—' },
        { nameAr: 'شركاء دوليون م.م.',  nameEn: 'International Partners LLC', shares: 700000, pct: 10.0, voteRights: 700000, attendance: 'absent',  proxy: '—' },
      ],
      quorum: { totalShares: 7000000, sharesPresent: 6300000, required: 50, pct: 90, achieved: true },
      agenda: [
        { no:1, titleAr:'اعتماد محضر الاجتماع السابق',                               titleEn:'Approval of previous meeting minutes',                      presenter:'Company Secretary', status:'approved' },
        { no:2, titleAr:'استعراض واعتماد القوائم المالية للسنة المالية '+y,           titleEn:'Review and approval of financial statements FY'+y,           presenter:'CFO – Ahmed Salem',   status:'approved' },
        { no:3, titleAr:'انتخاب أعضاء مجلس الإدارة للدورة القادمة',                  titleEn:'Election of Board of Directors for next term',               presenter:'Chairman',            status:'approved' },
        { no:4, titleAr:'تعيين مراجع الحسابات الخارجي لعام '+(parseInt(y)+1),        titleEn:'Appointment of external auditors for '+(parseInt(y)+1),      presenter:'Audit Committee',     status:'approved' },
        { no:5, titleAr:'توزيع الأرباح على المساهمين',                               titleEn:'Dividend distribution to shareholders',                      presenter:'CFO – Ahmed Salem',   status:'approved' },
        { no:6, titleAr:'أي موضوعات أخرى',                                           titleEn:'Any other business',                                         presenter:'Chairman',            status:'closed'   },
      ],
      votes: [
        { motionAr:'اعتماد القوائم المالية FY'+y,            motionEn:'Approve FY'+y+' Financial Statements',           for:5800000, against:200000, abstain:300000, total:6300000, passed:true },
        { motionAr:'إعادة انتخاب أعضاء مجلس الإدارة',        motionEn:'Re-elect Board of Directors 2026–2028',          for:6100000, against:100000, abstain:100000, total:6300000, passed:true },
        { motionAr:'تعيين PricewaterhouseCoopers مراجعاً',    motionEn:'Appoint PricewaterhouseCoopers as Auditors',      for:5900000, against:150000, abstain:250000, total:6300000, passed:true },
        { motionAr:'الموافقة على توزيع أرباح بنسبة 8%',       motionEn:'Approve 8% Dividend Distribution',              for:5400000, against:600000, abstain:300000, total:6300000, passed:true },
      ],
      resolutions: [
        { no:'GA-'+y+'-001', descAr:'اعتماد القوائم المالية للسنة المالية '+y,          descEn:'Approved annual financial statements FY'+y,           ownerAr:'المدير المالي — أحمد سالم',        ownerEn:'CFO – Ahmed Salem',        due:y+'-03-31', status:'implemented' },
        { no:'GA-'+y+'-002', descAr:'إعادة تشكيل مجلس الإدارة للفترة 2026–2028',       descEn:'Reconstitution of Board of Directors 2026–2028',      ownerAr:'أمين السر',                        ownerEn:'Company Secretary',        due:y+'-04-15', status:'in_progress' },
        { no:'GA-'+y+'-003', descAr:'تعيين PricewaterhouseCoopers مراجعاً خارجياً',     descEn:'Appointed PwC as External Auditors',                  ownerAr:'الرئيس التنفيذي — محمد العتيبي',   ownerEn:'CEO – Mohammed Al-Otaibi', due:y+'-03-15', status:'implemented' },
        { no:'GA-'+y+'-004', descAr:'توزيع أرباح بنسبة 8% على المساهمين',              descEn:'Approved 8% dividend distribution to shareholders',   ownerAr:'المدير المالي — أحمد سالم',        ownerEn:'CFO – Ahmed Salem',        due:y+'-05-01', status:'pending'     },
      ],
      minutesWorkflow: [
        { stepAr:'مسودة',              stepEn:'Draft',                icon:'📄', done:true,  doneBy:'Fatima Al-Harbi',      date:y+'-02-16' },
        { stepAr:'مراجعة أمين السر',   stepEn:'Secretary Review',    icon:'🔍', done:true,  doneBy:'Fatima Al-Harbi',      date:y+'-02-18' },
        { stepAr:'مراجعة الرئيس',      stepEn:'Chairman Review',     icon:'👑', done:true,  doneBy:'Mohammed Al-Otaibi',   date:y+'-02-22' },
        { stepAr:'موافقة المساهمين',   stepEn:'Shareholder Approval',icon:'🗳', done:false, doneBy:null, date:null },
        { stepAr:'اعتماد نهائي',       stepEn:'Final Approved',      icon:'✅', done:false, doneBy:null, date:null },
      ],
      documents: [
        { icon:'📨', nameAr:'إشعار الاجتماع',          nameEn:'Notice of Meeting',             date:y+'-01-10', status:'shared',   by:'Company Secretary' },
        { icon:'📋', nameAr:'جدول الأعمال',             nameEn:'Agenda',                        date:y+'-01-15', status:'approved', by:'Chairman'          },
        { icon:'📦', nameAr:'حقيبة المجلس',             nameEn:'Board Pack',                    date:y+'-01-20', status:'approved', by:'CFO'               },
        { icon:'💰', nameAr:'القوائم المالية '+y,       nameEn:'Financial Statements FY'+y,     date:y+'-01-20', status:'approved', by:'External Auditors'  },
        { icon:'📝', nameAr:'مسودة المحضر',             nameEn:'Draft Minutes',                 date:y+'-02-16', status:'reviewed', by:'Fatima Al-Harbi'    },
      ],
      actionItems: [
        { descAr:'رفع القوائم المالية لوزارة التجارة',                    descEn:'File financial statements with Ministry of Commerce', ownerAr:'أحمد سالم',    ownerEn:'Ahmed Salem',      priority:'high',   due:y+'-03-31', progress:100 },
        { descAr:'تسجيل تشكيلة المجلس الجديدة لدى هيئة السوق المالية',   descEn:'Register new Board composition with CMA',            ownerAr:'أمين السر',    ownerEn:'Company Secretary',priority:'urgent', due:y+'-04-15', progress:60  },
        { descAr:'معالجة توزيع الأرباح للمساهمين',                        descEn:'Process dividend payments to shareholders',          ownerAr:'فريق المالية', ownerEn:'Finance Team',     priority:'high',   due:y+'-05-01', progress:30  },
        { descAr:'توقيع عقد تعيين PwC والبدء بالتخطيط للمراجعة',          descEn:'Sign PwC engagement letter and begin audit planning',ownerAr:'أحمد سالم',    ownerEn:'Ahmed Salem',      priority:'normal', due:y+'-03-20', progress:100 },
        { descAr:'تعميم المحضر المعتمد على المساهمين',                     descEn:'Circulate approved minutes to all shareholders',     ownerAr:'أمين السر',    ownerEn:'Company Secretary',priority:'normal', due:y+'-03-01', progress:80  },
      ],
      timeline: [
        { eventAr:'إنشاء الاجتماع',       eventEn:'Meeting Created',    icon:'🏗', done:true,  date:y+'-01-05' },
        { eventAr:'إصدار الإشعار',        eventEn:'Notice Issued',       icon:'📨', done:true,  date:y+'-01-10' },
        { eventAr:'مشاركة حقيبة المجلس', eventEn:'Board Pack Shared',   icon:'📦', done:true,  date:y+'-01-20' },
        { eventAr:'انعقاد الاجتماع',      eventEn:'Meeting Held',        icon:'🏢', done:true,  date:ga.meeting_date||y+'-02-15' },
        { eventAr:'إغلاق التصويت',        eventEn:'Voting Closed',       icon:'🗳', done:true,  date:ga.meeting_date||y+'-02-15' },
        { eventAr:'اعتماد المحضر',        eventEn:'Minutes Approved',    icon:'✅', done:false, date:null },
        { eventAr:'أرشفة الوثائق',        eventEn:'Archived',            icon:'🗄', done:false, date:null },
      ],
    };
  },

  // ── Full 10-section GA Detail Panel ────────────────────────────────────────
  _sGADetail(ga, apiDetail) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const demo = this._gaDemo(ga);
    const data = apiDetail || demo;
    const fmt = n => n ? Number(n).toLocaleString() : '0';

    // ── 1. Overview Card ──────────────────────────────────────────────────
    const title = l === 'ar' ? (ga.title_ar || '') : (ga.title_en || ga.title_ar || '');
    const gaTypeLabel = (ga.meeting_type === 'extraordinary' || (title||'').toLowerCase().includes('extraordinary'))
      ? lbl('جمعية عمومية غير عادية', 'Extraordinary General Assembly')
      : lbl('جمعية عمومية عادية', 'Ordinary General Assembly');
    const stColors = { confirmed:'var(--green)', draft:'var(--amber)', cancelled:'var(--red)' };
    const stLabels = { confirmed:lbl('مؤكد','Confirmed'), draft:lbl('مسودة','Draft'), cancelled:lbl('ملغي','Cancelled') };
    const stC = stColors[ga.status] || 'var(--text3)';
    const stL = stLabels[ga.status] || (ga.status || '');
    const s1 = `<div class="card" style="border:1px solid rgba(139,92,246,.3)">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct" style="color:#8B5CF6">🏢 ${lbl('ملخص الجمعية العمومية','General Assembly Overview')}</div>
        <div class="ctsub">${lbl('البيانات الأساسية للاجتماع','Core meeting details')}</div></div>
        <span class="tag" style="font-size:12px;background:transparent;border:1px solid ${stC};color:${stC}">${stL}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
        ${[
          ['🏢', lbl('اسم الاجتماع','Meeting Name'), esc(title || lbl('جمعية عمومية','General Assembly'))],
          ['📌', lbl('النوع','Type'), gaTypeLabel],
          ['📅', lbl('التاريخ','Date'), ga.meeting_date || '—'],
          ['🕐', lbl('الوقت','Time'), ga.meeting_time || '10:00 AM'],
          ['📍', lbl('المقر','Venue'), esc((ga.platform||'').substring(0,40) || lbl('مقر الشركة الرئيسي','Company Head Office'))],
          ['📊', lbl('الحالة','Status'), stL],
        ].map(([ic,lb,val]) => `<div style="padding:11px 14px;background:var(--navy3);border-radius:10px;display:flex;align-items:flex-start;gap:9px">
            <span style="font-size:18px;flex-shrink:0;margin-top:1px">${ic}</span>
            <div><div style="font-size:10.5px;color:var(--text3);margin-bottom:2px">${lb}</div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">${val}</div></div>
          </div>`).join('')}
      </div>
    </div>`;

    // ── 2. Shareholders ───────────────────────────────────────────────────
    const sh = data.shareholders;
    const atC = { present:'var(--green)', absent:'var(--red)', proxy:'var(--amber)', excused:'var(--text3)' };
    const atL = { present:lbl('حاضر','Present'), absent:lbl('غائب','Absent'), proxy:lbl('وكيل','Proxy'), excused:lbl('معتذر','Excused') };
    const canManage = App.user && ['Admin','CEO','Chairman','Secretary'].includes(App.user.role_en);
    const s2 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">👥 ${lbl('المساهمون','Shareholders')}</div>
        <div class="ctsub">${lbl('سجل الحضور وحقوق التصويت','Attendance and voting rights register')}</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="tag tb">${sh.length} ${lbl('مساهم','shareholders')}</span>
          ${canManage && apiDetail ? `<button class="btn-ghost btn-sm" onclick="Gov._toggleForm('sh-add-form-${ga.id}')" style="font-size:11px">+ ${lbl('إضافة','Add')}</button>` : ''}
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:1px solid var(--border2)">
            ${['المساهم/Shareholder','الأسهم/Shares','النسبة/%','حقوق التصويت/Vote Rights','الحضور/Attendance','الوكيل/Proxy'].map(h=>{ const [a,e]=h.split('/'); return `<th style="text-align:start;padding:7px 10px;color:var(--text3);font-size:11px;font-weight:700">${lbl(a,e)}</th>`; }).join('')}${canManage && apiDetail ? '<th style="padding:7px 10px"></th>' : ''}
          </tr></thead>
          <tbody>
            ${sh.map((s,i)=>`<tr style="border-bottom:.5px solid var(--border2);${i%2===1?'background:rgba(255,255,255,.02)':''}">
              <td style="padding:9px 10px;font-weight:600;color:var(--text)">${l==='ar'?esc(s.nameAr):esc(s.nameEn)}</td>
              <td style="padding:9px 10px;color:var(--gold);font-weight:700">${fmt(s.shares)}</td>
              <td style="padding:9px 10px;color:var(--text2)">${s.pct}%</td>
              <td style="padding:9px 10px;color:var(--text2)">${fmt(s.voteRights)}</td>
              <td style="padding:9px 10px"><span class="tag" style="font-size:11px;color:${atC[s.attendance]||'var(--text3)'};background:transparent;border:1px solid ${atC[s.attendance]||'var(--border2)'}">${atL[s.attendance]||s.attendance}</span></td>
              <td style="padding:9px 10px;color:var(--text3)">${s.proxy}</td>
              ${canManage && apiDetail && s.id ? `<td style="padding:9px 10px"><button class="btn-ghost btn-sm" onclick="Gov.deleteShareholder(${s.id},${ga.id})" style="font-size:10px;color:var(--red);border-color:var(--red)">✕</button></td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${canManage && apiDetail ? `
      <div id="sh-add-form-${ga.id}" style="display:none;margin-top:12px;background:var(--navy3);border-radius:10px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px">+ ${lbl('إضافة مساهم','Add Shareholder')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <input class="fi" id="sh-en-${ga.id}" placeholder="${lbl('الاسم (بالإنجليزية)','Name (English)')}*"/>
          <input class="fi" id="sh-ar-${ga.id}" placeholder="${lbl('الاسم (بالعربية)','Name (Arabic)')}"/>
          <input class="fi" type="number" id="sh-shares-${ga.id}" placeholder="${lbl('عدد الأسهم','Shares')}"/>
          <input class="fi" type="number" id="sh-pct-${ga.id}" placeholder="${lbl('نسبة الملكية %','% Ownership')}" step="0.1"/>
          <select class="fi" id="sh-att-${ga.id}">
            <option value="pending">${lbl('مجهول','Unknown')}</option>
            <option value="present">${lbl('حاضر','Present')}</option>
            <option value="absent">${lbl('غائب','Absent')}</option>
            <option value="proxy">${lbl('وكيل','Proxy')}</option>
            <option value="excused">${lbl('معتذر','Excused')}</option>
          </select>
          <input class="fi" id="sh-proxy-${ga.id}" placeholder="${lbl('اسم الوكيل (إذا وكيل)','Proxy Name (if proxy)')}"/>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-gold btn-sm" onclick="Gov.saveShareholder(${ga.id})">${lbl('حفظ','Save')}</button>
          <button class="btn-ghost btn-sm" onclick="Gov._toggleForm('sh-add-form-${ga.id}')">${lbl('إلغاء','Cancel')}</button>
        </div>
      </div>` : ''}
    </div>`;

    // ── 3. Quorum ─────────────────────────────────────────────────────────
    const q = data.quorum;
    const qPct = Math.round((q.sharesPresent / q.totalShares) * 100);
    const s3 = `<div class="card" style="border:1px solid ${q.achieved?'rgba(46,204,138,.3)':'rgba(240,100,100,.3)'}">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">⚖️ ${lbl('النصاب القانوني','Quorum Status')}</div>
        <div class="ctsub">${lbl('التحقق من اكتمال النصاب القانوني','Legal quorum verification')}</div></div>
        <span class="tag ${q.achieved?'tg':'tr'}" style="font-size:12.5px">${q.achieved?'✓ '+lbl('محقق','Achieved'):'✗ '+lbl('غير محقق','Not Met')}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
        ${[
          { label:lbl('إجمالي الأسهم','Total Shares'),    val:fmt(q.totalShares),   color:'var(--text)'  },
          { label:lbl('الأسهم الحاضرة','Shares Present'), val:fmt(q.sharesPresent), color:'var(--gold)'  },
          { label:lbl('نسبة الحضور','Attendance %'),      val:qPct+'%',             color:q.achieved?'var(--green)':'var(--red)' },
          { label:lbl('النصاب المطلوب','Required Quorum'), val:q.required+'% + 1',  color:'var(--text2)' },
        ].map(s=>`<div style="padding:14px;background:var(--navy3);border-radius:10px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:${s.color};margin-bottom:4px">${s.val}</div>
            <div style="font-size:11px;color:var(--text3)">${s.label}</div>
          </div>`).join('')}
      </div>
      <div style="background:var(--navy3);border-radius:10px;padding:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text2)">${lbl('نسبة النصاب','Quorum Percentage')}</span>
          <span style="font-size:12px;font-weight:700;color:${q.achieved?'var(--green)':'var(--red)'}">${qPct}%</span>
        </div>
        <div style="background:var(--navy4);border-radius:20px;height:12px;overflow:hidden;position:relative">
          <div style="height:100%;border-radius:20px;background:${q.achieved?'var(--green)':'var(--red)'};width:${qPct}%;transition:width .6s"></div>
          <div style="position:absolute;top:0;bottom:0;left:${q.required}%;width:2px;background:var(--amber);opacity:.8"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:5px">
          <span style="font-size:10px;color:var(--text3)">0%</span>
          <span style="font-size:10px;color:var(--amber)">${lbl('الحد الأدنى','Minimum')} ${q.required}%</span>
          <span style="font-size:10px;color:var(--text3)">100%</span>
        </div>
      </div>
    </div>`;

    // ── 4. Agenda ─────────────────────────────────────────────────────────
    const agItems = data.agenda;
    const agStC = { approved:'var(--green)', closed:'var(--text3)', deferred:'var(--amber)', pending:'var(--amber)' };
    const agStL = { approved:lbl('مُقرَّر','Approved'), closed:lbl('مُغلق','Closed'), deferred:lbl('مُؤجَّل','Deferred'), pending:lbl('معلق','Pending') };
    const s4 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">📋 ${lbl('جدول الأعمال','Agenda')}</div>
        <div class="ctsub">${lbl('بنود الاجتماع والنتائج','Meeting items and outcomes')}</div></div>
        <span class="tag tb">${agItems.length} ${lbl('بند','items')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0">
        ${agItems.map((ag,i)=>`<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;${i<agItems.length-1?'border-bottom:.5px solid var(--border2)':''}">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(212,160,23,.15);border:1.5px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--gold);flex-shrink:0;margin-top:2px">${ag.no}</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">${l==='ar'?esc(ag.titleAr):esc(ag.titleEn)}</div>
              <div style="font-size:11.5px;color:var(--text3)">👤 ${ag.presenter}</div>
            </div>
            <span class="tag" style="font-size:11px;color:${agStC[ag.status]||'var(--text3)'};border:.5px solid ${agStC[ag.status]||'var(--border2)'};background:transparent;flex-shrink:0">${agStL[ag.status]||ag.status}</span>
          </div>`).join('')}
      </div>
    </div>`;

    // ── 5. Voting ─────────────────────────────────────────────────────────
    const votes = data.votes;
    const s5 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">🗳 ${lbl('نتائج التصويت','Voting Results')}</div>
        <div class="ctsub">${lbl('نتائج التصويت على القرارات الرسمية','Formal voting results')}</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="tag tg">${votes.filter(v=>v.passed).length}/${votes.length} ${lbl('نجح','passed')}</span>
          ${canManage && apiDetail ? `<button class="btn-ghost btn-sm" onclick="Gov._toggleForm('vt-add-form-${ga.id}')" style="font-size:11px">+ ${lbl('اقتراح','Motion')}</button>` : ''}
        </div>
      </div>
      ${canManage && apiDetail ? `
      <div id="vt-add-form-${ga.id}" style="display:none;background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px">+ ${lbl('إضافة اقتراح تصويت','Add Vote Motion')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <input class="fi" id="vt-en-${ga.id}" placeholder="${lbl('الاقتراح (بالإنجليزية)','Motion (English)')}*" style="grid-column:1/-1"/>
          <input class="fi" id="vt-ar-${ga.id}" placeholder="${lbl('الاقتراح (بالعربية)','Motion (Arabic)')}"/>
          <input class="fi" type="number" id="vt-for-${ga.id}" placeholder="${lbl('أصوات مع','Votes For')}" min="0"/>
          <input class="fi" type="number" id="vt-against-${ga.id}" placeholder="${lbl('أصوات ضد','Votes Against')}" min="0"/>
          <input class="fi" type="number" id="vt-abstain-${ga.id}" placeholder="${lbl('امتناع','Abstain')}" min="0"/>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-gold btn-sm" onclick="Gov.saveGAVote(${ga.id})">${lbl('حفظ','Save')}</button>
          <button class="btn-ghost btn-sm" onclick="Gov._toggleForm('vt-add-form-${ga.id}')">${lbl('إلغاء','Cancel')}</button>
        </div>
      </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:12px">
        ${votes.map((v,i)=>{
          const tot = v.total || 1;
          const forPct = Math.round((v.for/tot)*100);
          const agPct  = Math.round((v.against/tot)*100);
          const absPct = Math.round((v.abstain/tot)*100);
          const hasVotes = v.total > 0;
          return `<div style="background:var(--navy3);border-radius:10px;padding:14px;border-inline-start:3px solid ${hasVotes?(v.passed?'var(--green)':'var(--red)'):'var(--border2)'}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:${hasVotes?'10px':'4px'};flex-wrap:wrap">
              <div style="flex:1;min-width:0">
                <div style="font-size:10.5px;color:var(--text3);margin-bottom:2px">${lbl('اقتراح','Motion')} ${i+1}</div>
                <div style="font-size:13px;font-weight:600;color:var(--text)">${l==='ar'?esc(v.motionAr):esc(v.motionEn)}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                ${hasVotes ? `<span class="tag" style="font-size:12px;color:${v.passed?'var(--green)':'var(--red)'};border:1px solid ${v.passed?'var(--green)':'var(--red)'};background:transparent">${v.passed?'✓ '+lbl('نجح','Passed'):'✗ '+lbl('رُفض','Failed')}</span>` : `<span class="tag ta" style="font-size:11px">${lbl('لم يُصوَّت بعد','No votes yet')}</span>`}
                ${canManage && apiDetail && v.id ? `<button class="btn-ghost btn-sm" onclick="Gov.deleteGAVote(${v.id},${ga.id})" style="font-size:10px;color:var(--red);border-color:var(--red)">✕</button>` : ''}
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
              <div style="background:rgba(46,204,138,.1);border-radius:8px;padding:8px;text-align:center;border:.5px solid rgba(46,204,138,.3)">
                <div style="font-size:14px;font-weight:800;color:var(--green)">${fmt(v.for)}</div>
                <div style="font-size:10px;color:var(--text3)">${lbl('مع','For')} · ${forPct}%</div>
              </div>
              <div style="background:rgba(240,90,90,.08);border-radius:8px;padding:8px;text-align:center;border:.5px solid rgba(240,90,90,.25)">
                <div style="font-size:14px;font-weight:800;color:var(--red)">${fmt(v.against)}</div>
                <div style="font-size:10px;color:var(--text3)">${lbl('ضد','Against')} · ${agPct}%</div>
              </div>
              <div style="background:rgba(255,193,7,.08);border-radius:8px;padding:8px;text-align:center;border:.5px solid rgba(255,193,7,.25)">
                <div style="font-size:14px;font-weight:800;color:var(--amber)">${fmt(v.abstain)}</div>
                <div style="font-size:10px;color:var(--text3)">${lbl('امتناع','Abstain')} · ${absPct}%</div>
              </div>
            </div>
            <div style="background:var(--navy4);border-radius:20px;height:8px;overflow:hidden;display:flex">
              <div style="height:100%;background:var(--green);width:${forPct}%"></div>
              <div style="height:100%;background:var(--red);width:${agPct}%"></div>
              <div style="height:100%;background:var(--amber);width:${absPct}%"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

    // ── 6. Resolutions ────────────────────────────────────────────────────
    const ress = data.resolutions;
    const resC = { implemented:'var(--green)', in_progress:'#5B9BD6', pending:'var(--amber)', rejected:'var(--red)' };
    const resL = { implemented:lbl('مُنفَّذ','Implemented'), in_progress:lbl('جارٍ','In Progress'), pending:lbl('معلق','Pending'), rejected:lbl('مرفوض','Rejected') };
    const s6 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">📜 ${lbl('القرارات الرسمية','Formal Resolutions')}</div>
        <div class="ctsub">${lbl('قرارات الجمعية مع حالة التنفيذ','Assembly resolutions with implementation status')}</div></div>
        <span class="tag tb">${ress.length} ${lbl('قرار','resolutions')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${ress.map(r=>`<div style="display:flex;gap:12px;align-items:flex-start;padding:13px;background:var(--navy3);border-radius:10px;border-inline-start:3px solid ${resC[r.status]||'var(--border2)'}">
            <span style="font-size:10px;font-weight:700;color:var(--gold);background:rgba(212,160,23,.12);border:1px solid rgba(212,160,23,.3);border-radius:6px;padding:3px 7px;white-space:nowrap;flex-shrink:0;margin-top:1px">${r.no}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:5px">${l==='ar'?esc(r.descAr):esc(r.descEn)}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <span style="font-size:11px;color:var(--text3)">👤 ${l==='ar'?esc(r.ownerAr):esc(r.ownerEn)}</span>
                ${r.due?`<span style="font-size:11px;color:var(--text3)">📅 ${r.due}</span>`:''}
                <span class="tag" style="font-size:11px;color:${resC[r.status]||'var(--text3)'};background:transparent;border:.5px solid ${resC[r.status]||'var(--border2)'}">${resL[r.status]||r.status}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

    // ── 7. Minutes Approval Workflow ──────────────────────────────────────
    const mw = data.minutesWorkflow;
    const doneCount = mw.filter(s => s.done).length;
    const mPct = Math.round((doneCount / mw.length) * 100);
    const s7 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">✍ ${lbl('سير اعتماد المحضر','Minutes Approval Workflow')}</div>
        <div class="ctsub">${lbl('مسار الاعتماد الرسمي خطوة بخطوة','Step-by-step formal approval workflow')}</div></div>
        <span class="tag ${doneCount===mw.length?'tg':'ta'}">${doneCount}/${mw.length} ${lbl('خطوة','steps')}</span>
      </div>
      <div style="background:var(--navy3);border-radius:10px;padding:12px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--text2)">${lbl('تقدم الاعتماد','Approval Progress')}</span>
          <span style="font-size:12px;font-weight:700;color:${doneCount===mw.length?'var(--green)':'var(--gold)'}">${mPct}%</span>
        </div>
        <div style="background:var(--navy4);border-radius:20px;height:10px;overflow:hidden">
          <div style="height:100%;border-radius:20px;background:${doneCount===mw.length?'var(--green)':'var(--gold)'};width:${mPct}%;transition:width .6s"></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column">
        ${mw.map((step,i)=>`<div style="display:flex;gap:14px;align-items:flex-start">
            <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
              <div style="width:36px;height:36px;border-radius:50%;background:${step.done?'var(--green)':'var(--navy3)'};border:2px solid ${step.done?'var(--green)':'var(--border2)'};display:flex;align-items:center;justify-content:center;font-size:${step.done?'14':'17'}px">${step.done?'✓':step.icon}</div>
              ${i<mw.length-1?`<div style="width:2px;flex:1;min-height:24px;background:${step.done?'var(--green)':'var(--border2)'};margin:3px 0"></div>`:''}
            </div>
            <div style="flex:1;padding-top:7px;padding-bottom:${i<mw.length-1?'16px':'0'}">
              <div style="font-size:13px;font-weight:${step.done?'700':'400'};color:${step.done?'var(--text)':'var(--text3)'}">${l==='ar'?step.stepAr:step.stepEn}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${step.done&&step.doneBy?'✓ '+step.doneBy+(step.date?' · '+step.date:''):lbl('في الانتظار','Pending')}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

    // ── 8. Documents ──────────────────────────────────────────────────────
    const docs = data.documents;
    const docStC = { shared:'#5B9BD6', approved:'var(--green)', reviewed:'var(--amber)', draft:'var(--text3)' };
    const docStL = { shared:lbl('مُوزَّع','Shared'), approved:lbl('مُعتمَد','Approved'), reviewed:lbl('مُراجَع','Reviewed'), draft:lbl('مسودة','Draft') };
    const s8 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">📁 ${lbl('وثائق الجمعية العمومية','GA Documents')}</div>
        <div class="ctsub">${lbl('جميع الوثائق الرسمية المرتبطة بالاجتماع','All official documents linked to this assembly')}</div></div>
        <span class="tag tb">${docs.length} ${lbl('وثيقة','documents')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${docs.map(d=>`<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--navy3);border-radius:10px;border-inline-start:3px solid ${docStC[d.status]||'var(--border2)'}">
            <span style="font-size:22px;flex-shrink:0">${d.icon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${l==='ar'?esc(d.nameAr):esc(d.nameEn)}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">📅 ${d.date} · 👤 ${d.by}</div>
            </div>
            <span class="tag" style="font-size:11px;color:${docStC[d.status]||'var(--text3)'};background:transparent;border:.5px solid ${docStC[d.status]||'var(--border2)'};flex-shrink:0">${docStL[d.status]||d.status}</span>
            <button class="btn-ghost btn-sm" style="font-size:11px;flex-shrink:0">⬇ ${lbl('تنزيل','Download')}</button>
          </div>`).join('')}
      </div>
    </div>`;

    // ── 9. Action Items ───────────────────────────────────────────────────
    const acts = data.actionItems;
    const priC = { urgent:'var(--red)', high:'var(--amber)', normal:'#5B9BD6', low:'var(--text3)' };
    const priL = { urgent:lbl('عاجل','Urgent'), high:lbl('عالي','High'), normal:lbl('عادي','Normal'), low:lbl('منخفض','Low') };
    const s9 = `<div class="card">
      <div class="ch" style="margin-bottom:14px">
        <div><div class="ct">📌 ${lbl('بنود العمل','Action Items')}</div>
        <div class="ctsub">${lbl('المهام والإجراءات اللازمة بعد الاجتماع','Post-meeting required actions')}</div></div>
        <span class="tag tb">${acts.length} ${lbl('بند','items')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${acts.map(a=>{
          const pgC = a.progress===100?'var(--green)':a.progress>=60?'#5B9BD6':a.progress>=30?'var(--amber)':'var(--red)';
          return `<div style="padding:13px;background:var(--navy3);border-radius:10px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;flex-wrap:wrap">
              <div style="flex:1">
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-wrap:wrap">
                  <span class="tag" style="font-size:10px;color:${priC[a.priority]||'var(--text3)'};background:transparent;border:.5px solid ${priC[a.priority]||'var(--border2)'}">${priL[a.priority]||a.priority}</span>
                  ${a.progress===100?`<span class="tag tg" style="font-size:10px">✓ ${lbl('مكتمل','Done')}</span>`:''}
                </div>
                <div style="font-size:13px;font-weight:600;color:var(--text)">${l==='ar'?esc(a.descAr):esc(a.descEn)}</div>
              </div>
              <span style="font-size:14px;font-weight:800;color:${pgC};flex-shrink:0">${a.progress}%</span>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:8px">👤 ${l==='ar'?esc(a.ownerAr):esc(a.ownerEn)} &nbsp;·&nbsp; 📅 ${a.due}</div>
            <div style="background:var(--navy4);border-radius:20px;height:7px;overflow:hidden">
              <div style="height:100%;border-radius:20px;background:${pgC};width:${a.progress}%;transition:width .6s"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

    // ── 10. Timeline ──────────────────────────────────────────────────────
    const tl = data.timeline;
    const s10 = `<div class="card">
      <div class="ch" style="margin-bottom:16px">
        <div><div class="ct">🕐 ${lbl('مسار الجمعية العمومية','General Assembly Timeline')}</div>
        <div class="ctsub">${lbl('المراحل الزمنية الكاملة من الإنشاء حتى الأرشفة','Full lifecycle from creation to archiving')}</div></div>
      </div>
      <div style="display:flex;flex-direction:column">
        ${tl.map((ev,i)=>`<div style="display:flex;gap:14px;align-items:flex-start">
            <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
              <div style="width:40px;height:40px;border-radius:50%;background:${ev.done?'rgba(212,160,23,.2)':'var(--navy3)'};border:2px solid ${ev.done?'var(--gold)':'var(--border2)'};display:flex;align-items:center;justify-content:center;font-size:18px;z-index:1">${ev.icon}</div>
              ${i<tl.length-1?`<div style="width:2px;flex:1;min-height:28px;background:${ev.done?'var(--gold)':'var(--border2)'};opacity:${ev.done?'1':'.35'};margin:3px 0"></div>`:''}
            </div>
            <div style="flex:1;padding-top:8px;padding-bottom:${i<tl.length-1?'20px':'0'}">
              <div style="font-size:13px;font-weight:${ev.done?'700':'400'};color:${ev.done?'var(--text)':'var(--text3)'}">${l==='ar'?ev.eventAr:ev.eventEn}</div>
              <div style="font-size:11px;color:${ev.done?'var(--gold)':'var(--text3)'};margin-top:2px">${ev.done&&ev.date?'📅 '+ev.date:lbl('قادم','Upcoming')}</div>
            </div>
            <div style="flex-shrink:0;padding-top:10px">
              <span class="tag" style="font-size:10.5px;${ev.done?'background:rgba(212,160,23,.12);color:var(--gold);border:.5px solid rgba(212,160,23,.3)':'background:var(--navy3);color:var(--text3)'}">${ev.done?'✓ '+lbl('مكتمل','Done'):lbl('قادم','Upcoming')}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

    return `<div style="display:flex;flex-direction:column;gap:14px;border-top:2px solid rgba(139,92,246,.25);padding-top:16px">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(139,92,246,.08);border-radius:10px;border:.5px solid rgba(139,92,246,.25)">
        <span style="font-size:16px">📊</span>
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:700;color:#8B5CF6">${lbl('التقرير التفصيلي للجمعية العمومية','Detailed General Assembly Report')}</div>
          <div style="font-size:11px;color:var(--text3)">${apiDetail ? lbl('10 أقسام · بيانات حقيقية من قاعدة البيانات','10 sections · Live data from database') : lbl('10 أقسام · بيانات توضيحية','10 sections · Demo data')}</div>
        </div>
        <span class="tag ${apiDetail?'tg':'ta'}" style="font-size:10px;flex-shrink:0">${apiDetail ? lbl('بيانات حقيقية','Live Data') : lbl('بيانات توضيحية','Demo Data')}</span>
      </div>
      ${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}${s9}${s10}
      <div style="text-align:center;padding:10px">
        <button class="btn-ghost btn-sm" onclick="Gov._toggleGADetail(${ga.id})" style="color:var(--text3);font-size:12px">▲ ${lbl('طي التقرير الكامل','Collapse Full Report')}</button>
      </div>
    </div>`;
  },

  // ── GA CRUD helpers ────────────────────────────────────────────────────────
  _showCreateGA() { this._toggleForm('create-ga-form'); },
  _toggleForm(id) {
    const el = $(id);
    if (!el) return;
    el.style.display = el.style.display === 'none' || !el.style.display ? '' : 'none';
  },

  async createGA() {
    const title_ar = (($('cga-title-ar') || {}).value || '').trim();
    const meeting_date = ($('cga-date')||{}).value;
    if (!title_ar || !meeting_date) return showToast(this.lbl('حقل الاسم والتاريخ مطلوبان','Title and date are required'), 'error');
    try {
      await api('/api/gov/general-assemblies', { method:'POST', body:JSON.stringify({
        title_ar, title_en: ($('cga-title-en')||{}).value || title_ar,
        meeting_date, meeting_time: ($('cga-time')||{}).value || '10:00',
        duration_mins: parseInt(($('cga-duration')||{}).value||'120'),
        platform: ($('cga-venue')||{}).value || '',
      })});
      showToast(this.lbl('تم إنشاء الجمعية العمومية بنجاح','General Assembly created'), 'success');
      this._hideForm('create-ga-form');
      await this.loadGAs();
    } catch(e) { showToast(e.message, 'error'); }
  },

  async loadGAs() {
    try {
      const gas = await api('/api/gov/general-assemblies');
      this._gas = gas;
      const sec = $('sec-ga');
      if (sec) sec.outerHTML = this._sGASection(gas);
    } catch(e) { showToast(e.message, 'error'); }
  },

  async saveShareholder(gaId) {
    const name_en = (($('sh-en-' + gaId) || {}).value || '').trim();
    if (!name_en) return showToast(this.lbl('الاسم مطلوب','Name is required'), 'error');
    const body = {
      name_en, name_ar: ($('sh-ar-' + gaId)||{}).value || name_en,
      shares: parseInt(($('sh-shares-' + gaId)||{}).value || '0'),
      share_pct: parseFloat(($('sh-pct-' + gaId)||{}).value || '0'),
      attendance_status: ($('sh-att-' + gaId)||{}).value || 'pending',
      proxy_name: ($('sh-proxy-' + gaId)||{}).value || null,
    };
    try {
      await api('/api/gov/general-assemblies/' + gaId + '/shareholders', { method:'POST', body:JSON.stringify(body) });
      showToast(this.lbl('تم إضافة المساهم','Shareholder added'), 'success');
      await this._reloadGADetail(gaId);
    } catch(e) { showToast(e.message, 'error'); }
  },

  async deleteShareholder(id, gaId) {
    if (!confirm(this.lbl('حذف هذا المساهم من السجل؟','Remove this shareholder from the register?'))) return;
    try {
      await api('/api/gov/ga-shareholders/' + id, { method:'DELETE' });
      showToast(this.lbl('تم الحذف','Deleted'), 'success');
      await this._reloadGADetail(gaId);
    } catch(e) { showToast(e.message, 'error'); }
  },

  async saveGAVote(gaId) {
    const motion_en = (($('vt-en-' + gaId) || {}).value || '').trim();
    if (!motion_en) return showToast(this.lbl('نص الاقتراح مطلوب','Motion text is required'), 'error');
    const body = {
      motion_en, motion_ar: ($('vt-ar-' + gaId)||{}).value || motion_en,
      votes_for:     parseInt(($('vt-for-' + gaId)||{}).value     || '0'),
      votes_against: parseInt(($('vt-against-' + gaId)||{}).value || '0'),
      votes_abstain: parseInt(($('vt-abstain-' + gaId)||{}).value || '0'),
    };
    try {
      await api('/api/gov/general-assemblies/' + gaId + '/ga-votes', { method:'POST', body:JSON.stringify(body) });
      showToast(this.lbl('تم إضافة الاقتراح','Motion added'), 'success');
      await this._reloadGADetail(gaId);
    } catch(e) { showToast(e.message, 'error'); }
  },

  async deleteGAVote(id, gaId) {
    if (!confirm(this.lbl('حذف هذا الاقتراح؟','Delete this motion?'))) return;
    try {
      await api('/api/gov/ga-votes/' + id, { method:'DELETE' });
      showToast(this.lbl('تم الحذف','Deleted'), 'success');
      await this._reloadGADetail(gaId);
    } catch(e) { showToast(e.message, 'error'); }
  },

  // ── Helpers ────────────────────────────────────────────────────────────────
  _showForm(id) { const el = $(id); if (el) el.style.display = ''; },
  _hideForm(id) { const el = $(id); if (el) el.style.display = 'none'; },
};
