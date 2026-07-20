'use strict';
/* ══ Circular Resolutions Module ═══════════════════════════════════════════════
   Implements the full 9-step governance workflow for resolutions passed outside
   live board meetings:
   Draft → Circulate → Comments → Vote → Outcome → Signatures → Registry → Record
   ═══════════════════════════════════════════════════════════════════════════════ */

const CR = {
  _list: [],
  _filter: 'all',
  _unrecordedOnly: false,
  _search: '',
  _detail: null,
  _chart: null,

  lbl(ar, en) { return App.lang === 'ar' ? ar : en; },
  isAr() { return App.lang === 'ar'; },
  dir() { return App.lang === 'ar' ? 'rtl' : 'ltr'; },

  STATUS: {
    draft:      { ar: 'مسودة',        en: 'Draft',         color: '#5B9BD6', bg: 'rgba(91,155,214,.12)' },
    circulated: { ar: 'قيد المراجعة', en: 'Under Review',  color: '#a78bfa', bg: 'rgba(167,139,250,.12)' },
    voting:     { ar: 'قيد التصويت',  en: 'Pending Vote',  color: '#C9A84C', bg: 'rgba(201,168,76,.12)' },
    approved:   { ar: 'مُعتمَد',      en: 'Approved',      color: '#2ECC8A', bg: 'rgba(46,204,138,.12)' },
    rejected:   { ar: 'مرفوض',       en: 'Rejected',      color: '#e55',   bg: 'rgba(238,85,85,.12)' },
    lapsed:     { ar: 'منتهٍ',        en: 'Lapsed',        color: '#888',   bg: 'rgba(136,136,136,.12)' },
  },

  REC: {
    not_recorded: { ar: 'غير مُدوَّن',     en: 'Not Yet Recorded', color: '#C9A84C' },
    recorded:     { ar: 'مُدوَّن في محضر', en: 'Recorded',         color: '#2ECC8A' },
  },

  // ── Init ──────────────────────────────────────────────────────────────────
  async init() {
    const root = document.getElementById('cr-root');
    if (!root) return;
    root.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    await this.load();
    this.render();
  },

  async load() {
    try { this._list = await api('/api/gov/circular-resolutions'); }
    catch { this._list = []; }
  },

  // ── Main render ───────────────────────────────────────────────────────────
  render() {
    const root = document.getElementById('cr-root');
    if (!root) return;
    const filtered = this.filtered();
    const stats = this.computeStats();
    root.innerHTML = `
      <div class="cr-wrap" dir="${this.dir()}">
        <div class="cr-main">
          ${this._renderTopBar()}
          ${this._renderFilters()}
          ${this._renderTable(filtered)}
        </div>
        <div class="cr-sidebar">
          ${this._renderSidebar(stats)}
        </div>
      </div>`;
    this._drawDonut(stats);
  },

  // ── Filtering ─────────────────────────────────────────────────────────────
  filtered() {
    let list = [...this._list];
    const statusMap = { pending_vote: 'voting' };
    if (this._filter !== 'all') {
      const target = statusMap[this._filter] || this._filter;
      list = list.filter(r => r.status === target);
    }
    if (this._unrecordedOnly) {
      list = list.filter(r => ['approved','rejected','lapsed'].includes(r.status) && r.minutes_recording_status !== 'recorded');
    }
    if (this._search) {
      const q = this._search.toLowerCase();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        (r.reference_code || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    }
    return list;
  },

  computeStats() {
    const l = this._list;
    const approved = l.filter(r => r.status === 'approved').length;
    const recorded = l.filter(r => r.minutes_recording_status === 'recorded').length;
    const not_recorded = l.filter(r => ['approved','rejected','lapsed'].includes(r.status) && r.minutes_recording_status !== 'recorded').length;
    return {
      total: l.length, draft: l.filter(r => r.status==='draft').length,
      circulated: l.filter(r => r.status==='circulated').length,
      voting: l.filter(r => r.status==='voting').length,
      approved, rejected: l.filter(r => r.status==='rejected').length,
      lapsed: l.filter(r => r.status==='lapsed').length,
      recorded, not_recorded,
    };
  },

  // ── HTML builders ─────────────────────────────────────────────────────────
  _renderTopBar() {
    const ar = this.isAr();
    return `
      <div class="cr-topbar">
        <div>
          <h1 class="cr-title">${ar ? 'القرارات التداولية' : 'Circular Resolutions'}</h1>
          <p class="cr-sub">${ar ? 'قرارات مُتخذة خارج جلسات المجلس الرسمية وفق أحكام نظام الشركات' : 'Resolutions passed outside formal board meetings under the Companies Law'}</p>
        </div>
        <button class="btn-primary" onclick="CR.openNew()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${ar ? 'قرار جديد' : 'New Resolution'}
        </button>
      </div>`;
  },

  _renderFilters() {
    const ar = this.isAr();
    const chips = [
      { k: 'all',          ar: 'الكل',           en: 'All' },
      { k: 'draft',        ar: 'مسودة',           en: 'Draft' },
      { k: 'circulated',   ar: 'قيد المراجعة',    en: 'Under Review' },
      { k: 'pending_vote', ar: 'قيد التصويت',     en: 'Pending Vote' },
      { k: 'approved',     ar: 'مُعتمَد',         en: 'Approved' },
      { k: 'rejected',     ar: 'مرفوض',          en: 'Rejected' },
      { k: 'lapsed',       ar: 'منتهٍ',           en: 'Lapsed' },
    ];
    return `
      <div class="cr-filters">
        <div class="cr-chips">
          ${chips.map(c => `<button class="cr-chip${this._filter===c.k?' active':''}" onclick="CR.setFilter('${c.k}')">${ar?c.ar:c.en}</button>`).join('')}
        </div>
        <div class="cr-filter-row">
          <div class="cr-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="cr-search" id="cr-search-input"
              placeholder="${ar?'بحث بالعنوان أو رمز القرار...':'Search by title or reference...'}"
              value="${this._search}" oninput="CR.setSearch(this.value)">
          </div>
          <button class="cr-unrecorded-btn${this._unrecordedOnly?' active':''}" onclick="CR.toggleUnrecorded()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${ar?'غير مُدوَّنة فقط':'Unrecorded Only'}
          </button>
        </div>
      </div>`;
  },

  _renderTable(list) {
    const ar = this.isAr();
    if (!list.length) return `
      <div class="es" style="margin-top:3rem">
        <div style="font-size:2.5rem;margin-bottom:.8rem">📋</div>
        <div>${ar?'لا توجد قرارات تداولية':'No circular resolutions found'}</div>
      </div>`;
    return `
      <div class="cr-table-wrap">
        <table class="cr-table">
          <thead><tr>
            <th>${ar?'الرمز':'Ref.'}</th>
            <th>${ar?'عنوان القرار':'Resolution Title'}</th>
            <th>${ar?'الحالة':'Status'}</th>
            <th>${ar?'تقدم التصويت':'Voting Progress'}</th>
            <th>${ar?'الموعد النهائي':'Deadline'}</th>
            <th>${ar?'حالة التدوين':'Recording Status'}</th>
            <th></th>
          </tr></thead>
          <tbody>${list.map(r => this._renderRow(r)).join('')}</tbody>
        </table>
      </div>`;
  },

  _renderRow(r) {
    const ar = this.isAr();
    const st = this.STATUS[r.status] || this.STATUS.draft;
    const rec = this.REC[r.minutes_recording_status] || this.REC.not_recorded;
    const total = r.total_members || 7;
    const voted = (r.votes_approve||0)+(r.votes_reject||0)+(r.votes_abstain||0);
    const aW = total ? Math.round((r.votes_approve||0)/total*100) : 0;
    const rW = total ? Math.round((r.votes_reject||0)/total*100) : 0;
    const dl = this._fmtDeadline(r.deadline);
    const showVote = ['voting','approved','rejected'].includes(r.status);
    const showRec  = ['approved','rejected','lapsed'].includes(r.status);
    return `
      <tr class="cr-row" data-id="${r.id}" onclick="CR.openDetail(${r.id})">
        <td><span class="cr-ref">${r.reference_code||'—'}</span></td>
        <td class="cr-title-cell">
          <div class="cr-row-title">${esc(r.title)}</div>
          ${r.description?`<div class="cr-row-sub">${esc(r.description.slice(0,80))}${r.description.length>80?'…':''}</div>`:''}
        </td>
        <td><span class="cr-badge" style="color:${st.color};background:${st.bg}">${ar?st.ar:st.en}</span></td>
        <td>${showVote?`
          <div class="cr-vote-progress">
            <div class="cr-vote-bar-wrap">
              <div class="cr-vote-bar approve" style="width:${aW}%"></div>
              <div class="cr-vote-bar reject" style="width:${rW}%;margin-left:2px"></div>
            </div>
            <span class="cr-vote-label">${voted} ${ar?'من':'of'} ${total}</span>
          </div>`:`<span style="color:var(--text3);font-size:.8rem">—</span>`}</td>
        <td class="${dl.urgent?'cr-urgent':''}">${dl.text}</td>
        <td>${showRec?`
          <span class="cr-rec-badge" style="color:${rec.color}">
            <span class="cr-rec-dot" style="background:${rec.color}"></span>
            ${ar?rec.ar:rec.en}
            ${r.minutes_ref?`<em>(${esc(r.minutes_ref)})</em>`:''}
          </span>`:`<span style="color:var(--text3);font-size:.8rem">—</span>`}</td>
        <td>
          <button class="btn-ghost btn-sm" onclick="event.stopPropagation();CR.openDetail(${r.id})">
            ${ar?'عرض':'View'}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </td>
      </tr>`;
  },

  _fmtDeadline(dl) {
    if (!dl) return { text: '—', urgent: false };
    const d = new Date(dl), now = new Date();
    const diff = d - now, days = Math.ceil(diff/86400000);
    const fmt = d.toLocaleDateString(this.isAr()?'ar-SA':'en-GB',{day:'numeric',month:'short',year:'numeric'});
    if (diff < 0) return { text: fmt, urgent: false };
    if (days <= 3) return { text: `${fmt} · ${days}d`, urgent: true };
    return { text: `${fmt} · ${days}d`, urgent: false };
  },

  // ── Sidebar ───────────────────────────────────────────────────────────────
  _renderSidebar(stats) {
    const ar = this.isAr();
    const nr = stats.not_recorded;
    return `
      <div class="cr-stats-panel">
        ${nr>0?`
          <div class="cr-alert-card" onclick="CR._unrecordedOnly=true;CR.render()">
            <div class="cr-alert-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
            <div>
              <div class="cr-alert-num">${nr}</div>
              <div class="cr-alert-txt">${ar?'قرار غير مُدوَّن في محضر رسمي بعد':'resolution'+(nr!==1?'s':'')+' not yet recorded in minutes'}</div>
              <div class="cr-alert-link">${ar?'عرض غير المُدوَّنة →':'View unrecorded →'}</div>
            </div>
          </div>`:''}
        <div class="cr-stat-card">
          <div class="cr-stat-title">${ar?'ملخص القرارات':'Resolution Summary'}</div>
          ${[{k:'voting',ar:'قيد التصويت',en:'Pending Vote',c:'#C9A84C'},{k:'approved',ar:'مُعتمَد',en:'Approved',c:'#2ECC8A'},{k:'rejected',ar:'مرفوض',en:'Rejected',c:'#e55'},{k:'lapsed',ar:'منتهٍ',en:'Lapsed',c:'#888'},{k:'draft',ar:'مسودة',en:'Draft',c:'#5B9BD6'},{k:'circulated',ar:'قيد المراجعة',en:'Under Review',c:'#a78bfa'}].map(s=>`
            <div class="cr-stat-row">
              <span class="cr-stat-dot" style="background:${s.c}"></span>
              <span class="cr-stat-lbl">${ar?s.ar:s.en}</span>
              <span class="cr-stat-val">${stats[s.k]||0}</span>
            </div>`).join('')}
          <div class="cr-stat-total"><span>${ar?'الإجمالي':'Total'}</span><span>${stats.total}</span></div>
        </div>
        <div class="cr-stat-card">
          <div class="cr-stat-title">${ar?'حالة التدوين في المحضر':'Minutes Recording Status'}</div>
          <canvas id="cr-donut" width="160" height="160" style="display:block;margin:.8rem auto"></canvas>
          <div class="cr-donut-legend">
            <div class="cr-stat-row"><span class="cr-stat-dot" style="background:#2ECC8A"></span><span class="cr-stat-lbl">${ar?'مُدوَّن':'Recorded'}</span><span class="cr-stat-val">${stats.recorded}</span></div>
            <div class="cr-stat-row"><span class="cr-stat-dot" style="background:#C9A84C"></span><span class="cr-stat-lbl">${ar?'غير مُدوَّن':'Not Recorded'}</span><span class="cr-stat-val">${stats.not_recorded}</span></div>
          </div>
        </div>
      </div>`;
  },

  _drawDonut(stats) {
    if (this._chart) { try { this._chart.destroy(); } catch{} this._chart = null; }
    const canvas = document.getElementById('cr-donut');
    if (!canvas || typeof Chart === 'undefined') return;
    const inProgress = Math.max(0, stats.approved - stats.recorded - stats.not_recorded);
    this._chart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['Recorded','Not Recorded','In Progress'], datasets: [{ data: [stats.recorded, stats.not_recorded, inProgress], backgroundColor: ['#2ECC8A','#C9A84C','#5B9BD6'], borderWidth: 0, hoverOffset: 3 }] },
      options: { responsive: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } } } }
    });
  },

  setFilter(f)     { this._filter = f; this.render(); },
  setSearch(v)     { this._search = v; this.render(); },
  toggleUnrecorded() { this._unrecordedOnly = !this._unrecordedOnly; this.render(); },

  // ── New Resolution Modal ──────────────────────────────────────────────────
  openNew() {
    const ar = this.isAr();
    this._modal(`
      <div class="modal-hdr">
        <h3>${ar?'قرار تداولي جديد':'New Circular Resolution'}</h3>
        <button class="modal-close" onclick="CR._closeModal()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
        <div><label class="form-lbl">${ar?'عنوان القرار *':'Resolution Title *'}</label>
          <input class="form-input" id="crn-title" placeholder="${ar?'عنوان القرار...':'Resolution title...'}"></div>
        <div><label class="form-lbl">${ar?'نص القرار الكامل *':'Full Resolution Text *'}</label>
          <textarea class="form-input" id="crn-body" rows="5" placeholder="${ar?'النص الرسمي للقرار المُقترح للتصويت عليه...':'The formal text of the resolution to be voted on...'}"></textarea></div>
        <div><label class="form-lbl">${ar?'وصف موجز':'Short Description'}</label>
          <input class="form-input" id="crn-desc" placeholder="${ar?'ملخص قصير...':'Brief summary...'}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div><label class="form-lbl">${ar?'الموعد النهائي للتصويت':'Voting Deadline'}</label>
            <input type="date" class="form-input" id="crn-deadline"></div>
          <div><label class="form-lbl">${ar?'إجمالي الأعضاء':'Total Members'}</label>
            <input type="number" class="form-input" id="crn-members" value="7" min="1"></div>
        </div>
        <div><label class="form-lbl">${ar?'النصاب المطلوب (عدد الأصوات)':'Required Quorum (votes)'}</label>
          <input type="number" class="form-input" id="crn-quorum" value="4" min="1"></div>
      </div>
      <div class="modal-ftr">
        <button class="btn-ghost" onclick="CR._closeModal()">${ar?'إلغاء':'Cancel'}</button>
        <button class="btn-primary" onclick="CR.saveNew()">${ar?'حفظ كمسودة':'Save as Draft'}</button>
      </div>`, '640px');
  },

  async saveNew() {
    const ar = this.isAr();
    const title   = document.getElementById('crn-title')?.value.trim();
    const body    = document.getElementById('crn-body')?.value.trim();
    const desc    = document.getElementById('crn-desc')?.value.trim();
    const deadline= document.getElementById('crn-deadline')?.value;
    const total   = parseInt(document.getElementById('crn-members')?.value)||7;
    const quorum  = parseInt(document.getElementById('crn-quorum')?.value)||4;
    if (!title) return showToast(ar?'العنوان مطلوب':'Title is required','error');
    if (!body)  return showToast(ar?'نص القرار مطلوب':'Resolution text is required','error');
    try {
      await api('/api/gov/circular-resolutions',{method:'POST',body:JSON.stringify({title,body,description:desc,deadline,total_members:total,quorum_required:quorum})});
      this._closeModal();
      showToast(ar?'تم إنشاء القرار التداولي':'Circular resolution created','success');
      await this.load(); this.render();
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  // ── Detail View ───────────────────────────────────────────────────────────
  async openDetail(id) {
    const root = document.getElementById('cr-root');
    if (!root) return;
    root.innerHTML = `<div class="es"><div class="loading"></div></div>`;
    try {
      const cr = await api(`/api/gov/circular-resolutions/${id}`);
      this._detail = cr; this._renderDetailView(cr);
    } catch(e) { showToast(e.message||'Error loading resolution','error'); this.render(); }
  },

  _renderDetailView(cr) {
    const root = document.getElementById('cr-root');
    if (!root) return;
    const ar = this.isAr();
    const st = this.STATUS[cr.status]||this.STATUS.draft;
    const total = cr.total_members||7;
    const voted = (cr.votes_approve||0)+(cr.votes_reject||0)+(cr.votes_abstain||0);

    const STEPS = [
      {s:'draft',ar:'الإنشاء',en:'Created'},{s:'circulated',ar:'التعميم',en:'Circulated'},
      {s:'voting',ar:'التصويت',en:'Voting'},{s:'approved',ar:'القرار',en:'Outcome'},{s:'signed',ar:'التوقيع',en:'Signed'},
    ];
    const orderedStatuses = ['draft','circulated','voting','approved','rejected','lapsed'];
    const curIdx = Math.max(0, orderedStatuses.indexOf(cr.status));

    root.innerHTML = `
      <div class="cr-detail-wrap" dir="${this.dir()}">
        <div class="cr-detail-hdr">
          <button class="btn-ghost btn-sm" onclick="CR._backToList()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            ${ar?'العودة':'Back'}
          </button>
          <div class="cr-detail-meta">
            <span class="cr-ref" style="font-size:.88rem">${cr.reference_code||'—'}</span>
            <span class="cr-badge" style="color:${st.color};background:${st.bg}">${ar?st.ar:st.en}</span>
          </div>
          <div class="cr-detail-actions">${this._detailActions(cr)}</div>
        </div>

        <div class="cr-detail-title">${esc(cr.title)}</div>
        ${cr.description?`<div class="cr-detail-desc">${esc(cr.description)}</div>`:''}

        <div class="cr-workflow">
          ${STEPS.map((step,i) => {
            const done = i < curIdx;
            const current = i === curIdx && !['rejected','lapsed'].includes(cr.status);
            const done2 = ['approved','signed','registered'].includes(cr.status) && i < 4;
            return `<div class="cr-wf-step ${(done||done2)?'done':''} ${current?'current':''}">
              <div class="cr-wf-dot"></div>
              <div class="cr-wf-lbl">${ar?step.ar:step.en}</div>
            </div>${i<STEPS.length-1?'<div class="cr-wf-line"></div>':''}`;
          }).join('')}
        </div>

        <div class="cr-tabs">
          <button class="cr-tab active" data-tab="overview">${ar?'نظرة عامة':'Overview'}</button>
          <button class="cr-tab" data-tab="comments">${ar?'التعليقات':'Comments'} ${cr.comments?.length?`<span class="cr-tab-badge">${cr.comments.length}</span>`:''}</button>
          <button class="cr-tab" data-tab="votes">${ar?'التصويت':'Votes'} ${voted?`<span class="cr-tab-badge">${voted}</span>`:''}</button>
          <button class="cr-tab" data-tab="signatures">${ar?'التواقيع':'Signatures'} ${cr.signatures?.length?`<span class="cr-tab-badge">${cr.signatures.length}</span>`:''}</button>
        </div>
        <div id="cr-tab-content"></div>
      </div>`;

    this._switchTab('overview', cr);
    root.querySelectorAll('.cr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        root.querySelectorAll('.cr-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._switchTab(tab.dataset.tab, cr);
      });
    });
  },

  _switchTab(tab, cr) {
    const el = document.getElementById('cr-tab-content');
    if (!el) return;
    if (tab === 'overview')   el.innerHTML = this._tabOverview(cr);
    if (tab === 'comments')   el.innerHTML = this._tabComments(cr);
    if (tab === 'votes')      el.innerHTML = this._tabVotes(cr);
    if (tab === 'signatures') el.innerHTML = this._tabSignatures(cr);
  },

  _detailActions(cr) {
    const ar = this.isAr();
    const b = [];
    if (cr.status==='draft') {
      b.push(`<button class="btn-primary" onclick="CR._circulate(${cr.id})">${ar?'تعميم على الأعضاء':'Circulate to Members'}</button>`);
      b.push(`<button class="btn-ghost btn-sm" onclick="CR._delete(${cr.id})">${ar?'حذف':'Delete'}</button>`);
    }
    if (cr.status==='circulated')
      b.push(`<button class="btn-primary" onclick="CR._openVoting(${cr.id})">${ar?'فتح التصويت الرسمي':'Open Formal Vote'}</button>`);
    if (cr.status==='voting') {
      b.push(`<button class="btn-primary" onclick="CR.openCastVote(${cr.id})">${ar?'تسجيل صوتي':'Cast My Vote'}</button>`);
      b.push(`<button class="btn-secondary btn-sm" onclick="CR._closeVoting(${cr.id})">${ar?'إغلاق التصويت':'Close Voting'}</button>`);
    }
    if (cr.status==='approved') {
      b.push(`<button class="btn-primary" onclick="CR._sign(${cr.id})">${ar?'توقيع رسمي':'Sign Officially'}</button>`);
      b.push(`<button class="btn-secondary btn-sm" onclick="CR.openRecStatus(${cr.id})">${ar?'تحديث التدوين':'Update Recording'}</button>`);
    }
    if (['rejected','lapsed'].includes(cr.status))
      b.push(`<button class="btn-secondary btn-sm" onclick="CR.openRecStatus(${cr.id})">${ar?'تحديث حالة التدوين':'Update Recording Status'}</button>`);
    return b.join(' ');
  },

  _tabOverview(cr) {
    const ar = this.isAr();
    const rec = this.REC[cr.minutes_recording_status]||this.REC.not_recorded;
    const rows = [
      { l:ar?'رمز الإشارة':'Reference',       v: cr.reference_code||'—' },
      { l:ar?'أُنشئ بواسطة':'Created by',     v: cr.created_by_name||'—' },
      { l:ar?'تاريخ الإنشاء':'Created',       v: new Date(cr.created_at).toLocaleDateString(ar?'ar-SA':'en-GB') },
      cr.deadline ? { l:ar?'الموعد النهائي':'Deadline', v: new Date(cr.deadline).toLocaleDateString(ar?'ar-SA':'en-GB') } : null,
      { l:ar?'الأعضاء / النصاب':'Members / Quorum', v: `${cr.total_members||'—'} / ${cr.quorum_required||'—'}` },
      ['approved','rejected','lapsed'].includes(cr.status) ? { l:ar?'حالة التدوين':'Recording', v: `<span style="color:${rec.color}">${ar?rec.ar:rec.en}${cr.minutes_ref?` — ${esc(cr.minutes_ref)}`:''}</span>` } : null,
    ].filter(Boolean);
    return `
      <div class="cr-ov-grid">
        <div class="cr-ov-body">
          <div class="cr-ov-section-title">${ar?'نص القرار':'Resolution Text'}</div>
          <div class="cr-ov-body-text">${esc(cr.body||'')||`<em style="color:var(--text3)">${ar?'لا يوجد نص':'No body text'}</em>`}</div>
        </div>
        <div class="cr-ov-meta">
          ${rows.map(r=>`<div class="cr-ov-meta-row"><div class="cr-ov-meta-lbl">${r.l}</div><div class="cr-ov-meta-val">${r.v}</div></div>`).join('')}
        </div>
      </div>`;
  },

  _tabComments(cr) {
    const ar = this.isAr();
    const cms = cr.comments||[];
    return `
      <div class="cr-comments-wrap">
        <div class="cr-comments-list">
          ${!cms.length?`<div class="es-sm">${ar?'لا توجد تعليقات بعد':'No comments yet'}</div>`:''}
          ${cms.map(c => {
            const sSt = c.status==='accepted'?{ar:'مقبول',en:'Accepted',c:'#2ECC8A'}
              :c.status==='rejected'?{ar:'مرفوض',en:'Rejected',c:'#e55'}
              :{ar:'مفتوح',en:'Open',c:'#C9A84C'};
            return `
              <div class="cr-comment-card${c.status!=='open'?' resolved':''}">
                <div class="cr-comment-hdr">
                  <div class="cr-comment-who">
                    <div class="mini-av">${(c.commenter_name||'؟')[0]}</div>
                    <div>
                      <div class="cr-comment-name">${esc(c.commenter_name||'—')}</div>
                      <div class="cr-comment-time">${new Date(c.created_at).toLocaleString(ar?'ar-SA':'en-GB')}</div>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:.5rem">
                    ${c.clause_ref?`<span class="cr-clause-ref">${esc(c.clause_ref)}</span>`:''}
                    <span class="cr-badge" style="color:${sSt.c};background:${sSt.c}22;font-size:.7rem">${ar?sSt.ar:sSt.en}</span>
                  </div>
                </div>
                <div class="cr-comment-text">${esc(c.comment_text)}</div>
                ${c.status!=='open'&&c.resolved_by_name?`<div class="cr-comment-resolved">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  ${ar?'عُولج بواسطة':'Resolved by'} ${esc(c.resolved_by_name)}${c.resolved_reason?` — ${esc(c.resolved_reason)}`:''}
                </div>`:''}
                ${c.status==='open'?`<div class="cr-comment-actions">
                  <button class="btn-xs btn-accept" onclick="CR._acceptComment(${cr.id},${c.id})">${ar?'قبول':'Accept'}</button>
                  <button class="btn-xs btn-reject" onclick="CR._rejectComment(${cr.id},${c.id})">${ar?'رفض':'Reject'}</button>
                </div>`:''}
              </div>`;
          }).join('')}
        </div>
        ${['draft','circulated','voting'].includes(cr.status)?`
          <div class="cr-add-comment">
            <div class="cr-ov-section-title">${ar?'إضافة تعليق':'Add Comment'}</div>
            <input class="form-input" id="cmt-clause" placeholder="${ar?'رقم البند (اختياري)':'Clause ref (optional)'}">
            <textarea class="form-input" id="cmt-text" rows="3" placeholder="${ar?'نص تعليقك أو اقتراحك...':'Your comment or proposed correction...'}"></textarea>
            <button class="btn-primary" onclick="CR._addComment(${cr.id})">${ar?'إرسال التعليق':'Submit Comment'}</button>
          </div>`:''}
      </div>`;
  },

  _tabVotes(cr) {
    const ar = this.isAr();
    const votes = cr.votes||[];
    const total = cr.total_members||7;
    const ap = votes.filter(v=>v.vote==='approve').length;
    const rj = votes.filter(v=>v.vote==='reject').length;
    const ab = votes.filter(v=>v.vote==='abstain').length;
    const voted = votes.length;
    const quorum = cr.quorum_required||4;
    return `
      <div class="cr-votes-wrap">
        <div class="cr-votes-summary">
          <div class="cr-vs-item approve"><div class="cr-vs-num">${ap}</div><div class="cr-vs-lbl">${ar?'موافق':'Approve'}</div></div>
          <div class="cr-vs-item reject"><div class="cr-vs-num">${rj}</div><div class="cr-vs-lbl">${ar?'رافض':'Reject'}</div></div>
          <div class="cr-vs-item abstain"><div class="cr-vs-num">${ab}</div><div class="cr-vs-lbl">${ar?'ممتنع':'Abstain'}</div></div>
          <div class="cr-vs-item total"><div class="cr-vs-num">${voted}/${total}</div><div class="cr-vs-lbl">${ar?'صوّتوا':'Voted'}</div></div>
        </div>
        <div class="cr-vote-bar-full">
          <div class="cr-vbf-approve" style="width:${total?Math.round(ap/total*100):0}%"></div>
          <div class="cr-vbf-reject"  style="width:${total?Math.round(rj/total*100):0}%"></div>
          <div class="cr-vbf-abstain" style="width:${total?Math.round(ab/total*100):0}%"></div>
        </div>
        <div class="cr-quorum-row">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${voted>=quorum?'#2ECC8A':'#C9A84C'}" stroke-width="2"><circle cx="12" cy="12" r="10"/>${voted>=quorum?'<polyline points="9 12 11 14 15 10"/>':'<line x1="12" y1="8" x2="12" y2="16"/>'}</svg>
          ${ar?'النصاب القانوني:':'Quorum:'} <strong>${quorum}</strong> ${ar?'من أصل':'of'} ${total}
          — ${voted>=quorum?(ar?'✓ اكتمل النصاب':'✓ Quorum reached'):(ar?`يحتاج ${quorum-voted} صوت إضافي`:`${quorum-voted} more needed`)}
        </div>
        <div class="cr-vote-list">
          ${votes.map(v=>{
            const vSt=v.vote==='approve'?{ar:'موافق',en:'Approve',c:'#2ECC8A',bg:'rgba(46,204,138,.1)'}
              :v.vote==='reject'?{ar:'رافض',en:'Reject',c:'#e55',bg:'rgba(238,85,85,.1)'}
              :{ar:'ممتنع',en:'Abstain',c:'#888',bg:'rgba(136,136,136,.1)'};
            return `<div class="cr-vote-item">
              <div class="mini-av">${(v.voter_name||'؟')[0]}</div>
              <div style="flex:1">
                <div class="cr-vote-name">${esc(v.voter_name)}</div>
                ${v.reason?`<div class="cr-vote-reason">${esc(v.reason)}</div>`:''}
              </div>
              <span class="cr-badge" style="color:${vSt.c};background:${vSt.bg}">${ar?vSt.ar:vSt.en}</span>
              <span class="cr-vote-time">${new Date(v.voted_at).toLocaleDateString(ar?'ar-SA':'en-GB')}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  },

  _tabSignatures(cr) {
    const ar = this.isAr();
    const sigs = cr.signatures||[];
    return `
      <div class="cr-sigs-wrap">
        <div class="cr-sigs-summary">
          <span style="font-size:1.3rem;font-weight:700">${sigs.length}</span>
          <span style="color:var(--text3);margin-${ar?'right':'left'}:.4rem"> / ${cr.total_members||'—'} ${ar?'وقّعوا':'signed'}</span>
        </div>
        <div class="cr-sigs-grid">
          ${!sigs.length?`<div class="es-sm">${ar?'لا توجد تواقيع بعد':'No signatures yet'}</div>`:''}
          ${sigs.map(s=>`
            <div class="cr-sig-card">
              <div class="cr-sig-av">${(s.signer_name||'؟')[0]}</div>
              <div class="cr-sig-name">${esc(s.signer_name)}</div>
              <div class="cr-sig-type">${s.signature_type==='digital'?(ar?'توقيع رقمي':'Digital'):(ar?'توقيع يدوي':'Manual')}</div>
              <div class="cr-sig-date">${new Date(s.signed_at).toLocaleDateString(ar?'ar-SA':'en-GB')}</div>
            </div>`).join('')}
        </div>
      </div>`;
  },

  // ── Workflow actions ──────────────────────────────────────────────────────
  async _circulate(id) {
    const ar = this.isAr();
    try {
      const cr = await api(`/api/gov/circular-resolutions/${id}/circulate`,{method:'POST'});
      showToast(ar?'تم التعميم على الأعضاء':'Resolution circulated to members','success');
      this._detail=cr; this._renderDetailView(cr); this._patchList(cr);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  async _openVoting(id) {
    const ar = this.isAr();
    try {
      const cr = await api(`/api/gov/circular-resolutions/${id}/open-voting`,{method:'POST'});
      showToast(ar?'تم فتح التصويت الرسمي':'Formal vote opened','success');
      this._detail=cr; this._renderDetailView(cr); this._patchList(cr);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  async _closeVoting(id) {
    const ar = this.isAr();
    if (!confirm(ar?'إغلاق التصويت وتحديد النتيجة؟':'Close voting and determine outcome?')) return;
    try {
      await api(`/api/gov/circular-resolutions/${id}/close-voting`,{method:'POST'});
      showToast(ar?'تم إغلاق التصويت':'Voting closed','success');
      await this.load(); await this.openDetail(id);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  openCastVote(id) {
    const ar = this.isAr();
    this._modal(`
      <div class="modal-hdr">
        <h3>${ar?'تسجيل صوتي الرسمي':'Cast My Official Vote'}</h3>
        <button class="modal-close" onclick="CR._closeModal()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
        <div class="cr-vote-options">
          <label class="cr-vote-opt approve"><input type="radio" name="crv" value="approve"><span class="cr-vote-opt-label">${ar?'✓ موافق':'✓ Approve'}</span></label>
          <label class="cr-vote-opt reject"><input type="radio" name="crv" value="reject"><span class="cr-vote-opt-label">${ar?'✗ رافض':'✗ Reject'}</span></label>
          <label class="cr-vote-opt abstain"><input type="radio" name="crv" value="abstain"><span class="cr-vote-opt-label">${ar?'— ممتنع':'— Abstain'}</span></label>
        </div>
        <div><label class="form-lbl">${ar?'السبب (إلزامي عند الرفض)':'Reason (required if rejecting)'}</label>
          <textarea class="form-input" id="crv-reason" rows="2" placeholder="${ar?'اكتب سببك...':'State your reason...'}"></textarea></div>
      </div>
      <div class="modal-ftr">
        <button class="btn-ghost" onclick="CR._closeModal()">${ar?'إلغاء':'Cancel'}</button>
        <button class="btn-primary" onclick="CR._submitVote(${id})">${ar?'تسجيل الصوت':'Submit Vote'}</button>
      </div>`, '440px');
  },

  async _submitVote(id) {
    const ar = this.isAr();
    const voteEl = document.querySelector('input[name="crv"]:checked');
    if (!voteEl) return showToast(ar?'يرجى اختيار صوتك':'Please select your vote','error');
    const vote = voteEl.value;
    const reason = document.getElementById('crv-reason')?.value.trim();
    if (vote==='reject'&&!reason) return showToast(ar?'السبب إلزامي عند الرفض':'Reason required when rejecting','error');
    try {
      await api(`/api/gov/circular-resolutions/${id}/vote`,{method:'POST',body:JSON.stringify({vote,reason})});
      this._closeModal();
      showToast(ar?'تم تسجيل صوتك':'Vote recorded','success');
      await this.openDetail(id);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  async _sign(id) {
    const ar = this.isAr();
    if (!confirm(ar?'هل تريد التوقيع رسمياً على هذا القرار؟':'Sign this resolution officially?')) return;
    try {
      await api(`/api/gov/circular-resolutions/${id}/sign`,{method:'POST',body:JSON.stringify({signature_type:'digital'})});
      showToast(ar?'تم توقيعك بنجاح':'Signature recorded','success');
      await this.openDetail(id);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  openRecStatus(id) {
    const ar = this.isAr();
    const cr = this._detail;
    this._modal(`
      <div class="modal-hdr">
        <h3>${ar?'تحديث حالة التدوين في المحضر':'Update Recording Status'}</h3>
        <button class="modal-close" onclick="CR._closeModal()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
        <div><label class="form-lbl">${ar?'الحالة':'Status'}</label>
          <select class="form-input" id="rec-status">
            <option value="not_recorded"${cr?.minutes_recording_status==='not_recorded'?' selected':''}>${ar?'غير مُدوَّن بعد':'Not Yet Recorded'}</option>
            <option value="recorded"${cr?.minutes_recording_status==='recorded'?' selected':''}>${ar?'مُدوَّن في المحضر':'Recorded in Minutes'}</option>
          </select></div>
        <div><label class="form-lbl">${ar?'رقم المحضر المرجعي':'Minutes Reference'}</label>
          <input class="form-input" id="rec-ref" value="${cr?.minutes_ref||''}" placeholder="${ar?'مثال: محضر رقم 12':'e.g. Minutes No. 12'}"></div>
      </div>
      <div class="modal-ftr">
        <button class="btn-ghost" onclick="CR._closeModal()">${ar?'إلغاء':'Cancel'}</button>
        <button class="btn-primary" onclick="CR._saveRecStatus(${id})">${ar?'حفظ':'Save'}</button>
      </div>`, '400px');
  },

  async _saveRecStatus(id) {
    const ar = this.isAr();
    const status = document.getElementById('rec-status')?.value;
    const ref    = document.getElementById('rec-ref')?.value.trim();
    try {
      const cr = await api(`/api/gov/circular-resolutions/${id}/recording-status`,{method:'PATCH',body:JSON.stringify({minutes_recording_status:status,minutes_ref:ref})});
      this._closeModal();
      showToast(ar?'تم تحديث حالة التدوين':'Recording status updated','success');
      this._detail=cr; this._renderDetailView(cr); this._patchList(cr);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  async _acceptComment(crId, cid) {
    const ar = this.isAr();
    try {
      await api(`/api/gov/circular-resolutions/${crId}/comments/${cid}`,{method:'PATCH',body:JSON.stringify({action:'accept'})});
      showToast(ar?'تم قبول التعليق':'Comment accepted','success');
      await this.openDetail(crId);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  _rejectComment(crId, cid) {
    const ar = this.isAr();
    const reason = prompt(ar?'سبب الرفض:':'Reason for rejecting:');
    if (reason===null) return;
    api(`/api/gov/circular-resolutions/${crId}/comments/${cid}`,{method:'PATCH',body:JSON.stringify({action:'reject',reason})})
      .then(()=>{ showToast(ar?'تم رفض التعليق':'Comment rejected','success'); this.openDetail(crId); })
      .catch(e=>showToast(e.message||'Error','error'));
  },

  async _addComment(crId) {
    const ar = this.isAr();
    const clause = document.getElementById('cmt-clause')?.value.trim();
    const text   = document.getElementById('cmt-text')?.value.trim();
    if (!text) return showToast(ar?'نص التعليق مطلوب':'Comment text required','error');
    try {
      await api(`/api/gov/circular-resolutions/${crId}/comments`,{method:'POST',body:JSON.stringify({clause_ref:clause,comment_text:text})});
      showToast(ar?'تم إرسال التعليق':'Comment submitted','success');
      await this.openDetail(crId);
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  async _delete(id) {
    const ar = this.isAr();
    if (!confirm(ar?'هل تريد حذف هذا القرار التداولي؟':'Delete this circular resolution?')) return;
    try {
      await api(`/api/gov/circular-resolutions/${id}`,{method:'DELETE'});
      showToast(ar?'تم حذف القرار':'Resolution deleted','success');
      await this.load(); this._backToList();
    } catch(e) { showToast(e.message||'Error','error'); }
  },

  // ── Helpers ───────────────────────────────────────────────────────────────
  _backToList() { this._detail = null; this.render(); },

  _patchList(cr) { this._list = this._list.map(r => r.id === cr.id ? cr : r); },

  _modal(html, maxWidth='560px') {
    document.getElementById('cr-modal-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'modal-overlay'; wrap.id = 'cr-modal-wrap';
    wrap.innerHTML = `<div class="modal-box" style="max-width:${maxWidth}">${html}</div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target===wrap) this._closeModal(); });
  },

  _closeModal() { document.getElementById('cr-modal-wrap')?.remove(); },
};
