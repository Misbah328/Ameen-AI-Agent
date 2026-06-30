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
        <span class="tag tb" style="font-size:12px">${gas.length} ${lbl('جمعية','assembly')}</span>
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
                <button class="btn-ghost btn-sm" onclick="Gov._selectGA(${ga.id})" style="flex-shrink:0;font-size:12.5px">
                  ${lbl('عرض بنود الحوكمة ←','View Governance Items →')}
                </button>
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
                  ${[
                    ['👑', lbl('رئيس الجمعية','Chairman'), 'Mohammed Al-Otaibi'],
                    ['📝', lbl('أمين السر','Secretary'), 'Fatima Al-Harbi'],
                    ['⚖️', lbl('المستشار القانوني','Legal Advisor'), 'Omar Hassan'],
                  ].map(([ic,role,name]) => `<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
                    <span style="font-size:14px;flex-shrink:0">${ic}</span>
                    <span style="font-size:11.5px;color:var(--text3);flex-shrink:0">${role}:</span>
                    <span style="font-size:12.5px;font-weight:600;color:var(--text)">${name}</span>
                  </div>`).join('')}
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
          </div>`;
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
    const ar = $('b-name-ar')?.value.trim();
    if (!ar) { showToast(this.lbl('يرجى إدخال اسم المجلس','Please enter a board name'), 'error'); return; }
    try {
      await api('/api/gov/boards', { method:'POST', body: JSON.stringify({
        name_ar: ar, name_en: $('b-name-en')?.value.trim()||ar,
        description: $('b-desc')?.value.trim()||'',
        chairperson: $('b-chair')?.value.trim()||'',
        total_members: parseInt($('b-total')?.value)||0,
        default_quorum: parseInt($('b-quorum')?.value)||0,
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
    const ar = $(`c-name-ar-${boardId}`)?.value.trim();
    if (!ar) { showToast(this.lbl('يرجى إدخال اسم اللجنة','Please enter a committee name'), 'error'); return; }
    try {
      await api('/api/gov/committees', { method:'POST', body: JSON.stringify({
        board_id: boardId,
        name_ar: ar, name_en: $(`c-name-en-${boardId}`)?.value.trim()||ar,
        description: $(`c-desc-${boardId}`)?.value.trim()||'',
        chairperson: $(`c-chair-${boardId}`)?.value.trim()||'',
        total_members: parseInt($(`c-total-${boardId}`)?.value)||0,
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
      el.innerHTML = [
        this._sAgenda(agenda, docs),
        this._sAttendance(attendance),
        this._sQuorum(quorum),
        this._sResolutions(resolutions),
        this._sDocs(docs.filter(d => !d.agenda_item_id)),
      ].join('');
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
    const t = $('ai-title')?.value.trim();
    if (!t) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = { title: t, description: $('ai-desc')?.value.trim() || '',
      presenter: $('ai-pres')?.value.trim() || '', duration_mins: parseInt($('ai-dur')?.value)||15,
      expected_outcome: $('ai-out')?.value.trim() || '' };
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
    const name = $('att-name')?.value.trim();
    if (!name) { showToast(this.lbl('يرجى إدخال الاسم','Please enter a name'), 'error'); return; }
    try {
      await api('/api/gov/attendance', { method:'POST', body: JSON.stringify({
        meeting_id: this.meetingId, name,
        email: $('att-email')?.value.trim()||'',
        role: $('att-role')?.value||'Member',
        attendance_status: $('att-status')?.value||'pending',
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
    const body = { required_members: parseInt($('q-req')?.value)||0, present_members: parseInt($('q-pres')?.value)||0, notes: $('q-notes')?.value.trim()||'' };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try {
      await api('/api/gov/quorum', { method:'PUT', body: JSON.stringify(body) });
      const fresh = await api(`/api/gov/quorum?${this._qParam()}`).catch(() => null);
      const el = $('sec-quorum');
      if (el) el.outerHTML = this._sQuorum(fresh);
    } catch (e) { /* silent auto-save */ }
  },

  // ── Resolutions section ────────────────────────────────────────────────────
  _sResolutions(resolutions) {
    const l = App.lang;
    const lbl = this.lbl.bind(this);
    const stBadge = s => {
      const st = RESOLUTION_ST[s]||RESOLUTION_ST.pending;
      return `<span class="tag" style="font-size:10px;background:transparent;border:1px solid ${st.c};color:${st.c}">${st[l]||s}</span>`;
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
        ? resolutions.map(r => `
          <div style="background:var(--navy3);border-radius:10px;padding:13px;margin-bottom:10px;border:1px solid var(--border2)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(r.title)}</div>
                ${r.description ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(r.description)}</div>` : ''}
              </div>
              <div style="display:flex;gap:5px;align-items:center">
                ${stBadge(r.status)}
                <button class="btn-ghost btn-sm" onclick="Gov.delResolution(${r.id})" style="color:var(--red);font-size:10px">✕</button>
              </div>
            </div>
            <div style="display:flex;gap:7px;margin-top:10px;flex-wrap:wrap;align-items:center">
              <span style="font-size:11px;color:var(--text3)">${lbl('التصويت:','Voting:')}</span>
              <button onclick="Gov.vote(${r.id},'approve')" style="background:var(--green2);color:var(--green);border:1px solid rgba(46,204,138,.3);border-radius:20px;padding:4px 11px;font-size:11px;cursor:pointer;font-weight:600">
                ✓ ${lbl('موافق','Approve')} (${r.votes_approve})
              </button>
              <button onclick="Gov.vote(${r.id},'reject')" style="background:var(--red2);color:var(--red);border:1px solid rgba(224,90,90,.3);border-radius:20px;padding:4px 11px;font-size:11px;cursor:pointer;font-weight:600">
                ✕ ${lbl('رفض','Reject')} (${r.votes_reject})
              </button>
              <button onclick="Gov.vote(${r.id},'abstain')" style="background:var(--navy4);color:var(--text3);border:1px solid var(--border2);border-radius:20px;padding:4px 11px;font-size:11px;cursor:pointer">
                ◎ ${lbl('امتناع','Abstain')} (${r.votes_abstain})
              </button>
            </div>
            <div style="margin-top:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                <span style="font-size:11px;font-weight:600;color:var(--text2)">📌 ${lbl('المتابعة','Follow-up')}</span>
                <button class="btn-ghost btn-sm" onclick="Gov._showForm('fu-form-${r.id}')" style="font-size:10px">+ ${lbl('إضافة','Add')}</button>
              </div>
              <div id="fu-form-${r.id}" style="display:none;background:var(--navy4);border-radius:8px;padding:10px;margin-bottom:7px">
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
                  <div style="display:flex;gap:7px;align-items:center;padding:5px 8px;background:var(--navy4);border-radius:7px;margin-bottom:4px;font-size:11px">
                    <div style="flex:1">
                      <span style="color:var(--gold);font-weight:600">${esc(f.owner||'—')}</span>
                      ${f.due_date ? `<span style="color:var(--text3)"> · 📅 ${esc(f.due_date)}</span>` : ''}
                      ${f.notes ? `<span style="color:var(--text2)"> · ${esc(f.notes)}</span>` : ''}
                    </div>
                    <select style="font-size:10px;padding:2px 5px;border-radius:5px;border:1px solid var(--border2);background:var(--navy3);color:var(--text2)"
                      onchange="Gov.updateFollowup(${f.id},this.value)">
                      ${Object.keys(FOLLOWUP_ST).map(k => `<option value="${k}" ${f.status===k?'selected':''}>${esc((FOLLOWUP_ST[k]||{})[l]||k)}</option>`).join('')}
                    </select>
                    <button onclick="Gov.delFollowup(${f.id})" style="color:var(--red);background:none;border:none;cursor:pointer;font-size:11px">✕</button>
                  </div>`).join('')
                : `<div style="font-size:11px;color:var(--text3)">${lbl('لا توجد متابعات','No follow-ups yet')}</div>`}
            </div>
          </div>`).join('')
        : `<div class="es" style="padding:16px"><div class="es-icon">⚖️</div><div style="font-size:12px">${lbl('لا توجد قرارات بعد','No resolutions yet')}</div></div>`}
    </div>`;
  },

  async addResolution() {
    const title = $('res-title')?.value.trim();
    if (!title) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = { title, description: $('res-desc')?.value.trim()||'' };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try { await api('/api/gov/resolutions', { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async vote(resId, vote) {
    try { await api(`/api/gov/resolutions/${resId}/vote`, { method:'POST', body: JSON.stringify({ vote }) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async delResolution(id) {
    if (!confirm(this.lbl('حذف هذا القرار؟','Delete this resolution?'))) return;
    try { await api(`/api/gov/resolutions/${id}`, { method:'DELETE' }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async addFollowup(resId) {
    const body = { owner: $(`fu-owner-${resId}`)?.value.trim()||'', due_date: $(`fu-due-${resId}`)?.value||'', notes: $(`fu-notes-${resId}`)?.value.trim()||'', status:'pending' };
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
    const title = $('doc-title')?.value.trim();
    if (!title) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = {
      title,
      doc_type: $('doc-type')?.value || 'other',
      description: $('doc-desc')?.value.trim() || '',
      uploaded_by: $('doc-by')?.value.trim() || '',
      upload_date: $('doc-date')?.value || '',
      status: $('doc-status')?.value || 'draft',
    };
    if (this.meetingId) body.meeting_id = this.meetingId; else body.schedule_id = this.scheduleId;
    try { await api('/api/gov/documents', { method:'POST', body: JSON.stringify(body) }); await this._loadSections(); }
    catch (e) { showToast(e.message, 'error'); }
  },

  async addAgendaDoc(itemId) {
    const title = $(`ai-doc-title-${itemId}`)?.value.trim();
    if (!title) { showToast(this.lbl('يرجى إدخال العنوان','Please enter a title'), 'error'); return; }
    const body = {
      title,
      doc_type: $(`ai-doc-type-${itemId}`)?.value || 'other',
      uploaded_by: $(`ai-doc-by-${itemId}`)?.value.trim() || '',
      status: $(`ai-doc-status-${itemId}`)?.value || 'draft',
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  _showForm(id) { const el = $(id); if (el) el.style.display = ''; },
  _hideForm(id) { const el = $(id); if (el) el.style.display = 'none'; },
};
