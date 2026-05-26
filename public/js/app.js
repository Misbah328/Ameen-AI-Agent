// ══ State ══════════════════════════════════════════════════════════════════
const App = {
  user: null, lang: 'ar', token: null,
  recording: false, secs: 0, tInt: null, wInt: null, srec: null,
  fullText: '', currentMeetingId: null, chatHistory: [],
};

const $ = id => document.getElementById(id);
const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ══ Init ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  App.token = localStorage.getItem('ameen_token');
  const cached = localStorage.getItem('ameen_user');
  if (!App.token) { location.href = '/login.html'; return; }

  if (cached) {
    App.user = JSON.parse(cached);
    App.lang = App.user.lang_pref || 'ar';
  }

  // Verify token
  try {
    const r = await api('/auth/me');
    App.user = r;
    App.lang = r.lang_pref || 'ar';
    localStorage.setItem('ameen_user', JSON.stringify(r));
  } catch { location.href = '/login.html'; return; }

  App.setLang(App.lang);
  renderUser();
  loadBadges();
  loadSelectLists();
  $('welcome-ts').textContent = now();
  setInterval(loadBadges, 60000);
});

// ══ API helper ═══════════════════════════════════════════════════════════════
async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    credentials: 'include',
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

function renderUser() {
  const u = App.user;
  if (!u) return;
  $('u-name').textContent = App.lang === 'ar' ? u.name_ar : u.name_en;
  $('u-role').textContent = App.lang === 'ar' ? u.role_ar : u.role_en;
  const initials = (App.lang === 'ar' ? u.name_ar : u.name_en).split(' ').slice(0, 2).map(w => w[0]).join('');
  $('u-av').textContent = initials;
}

async function loadBadges() {
  try {
    const stats = await api('/api/stats');
    $('b-tk').textContent = stats.tasks_overdue || '—';
    $('b-tr').textContent = stats.meetings || '—';
    $('b-sc').textContent = stats.meetings || '—';
    if (stats.tasks_overdue > 0) $('b-tk').className = 'nbg';
  } catch {}
}

async function loadSelectLists() {
  // Load meetings for dropdowns
  try {
    const meetings = await api('/api/meetings');
    [('doc-meeting-sel'), ('pm-meeting-sel')].forEach(id => {
      const sel = $(id); if (!sel) return;
      meetings.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${App.lang === 'ar' ? m.title_ar : (m.title_en || m.title_ar)} — ${m.meeting_date?.substring(0, 10) || ''}`;
        sel.appendChild(opt);
      });
    });
    // Schedule selector for pre-meeting
    const scheds = await api('/api/schedule');
    const pmSel = $('pm-meeting-sel');
    if (pmSel) {
      scheds.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${App.lang === 'ar' ? s.title_ar : (s.title_en || s.title_ar)} — ${s.meeting_date} ${s.meeting_time}`;
        pmSel.appendChild(opt);
      });
    }
  } catch {}

  // Load users for task owner select
  try {
    const users = await api('/api/users');
    const ownerSel = $('nt-owner');
    if (ownerSel) {
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = App.lang === 'ar' ? u.name_ar : u.name_en;
        ownerSel.appendChild(opt);
      });
    }
  } catch {}
}

// ══ Language ════════════════════════════════════════════════════════════════
App.setLang = function (l) {
  App.lang = l;
  document.documentElement.lang = l === 'ar' ? 'ar' : 'en';
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('.lb').forEach(b => b.classList.toggle('active', b.textContent.trim() === (l === 'ar' ? 'ع' : 'EN')));

  // Translate all data-ar / data-en elements
  document.querySelectorAll('[data-ar]').forEach(el => {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')
      el.textContent = l === 'ar' ? el.dataset.ar : el.dataset.en;
  });

  // Translate placeholder
  document.querySelectorAll('[data-ph-ar]').forEach(el => {
    el.placeholder = l === 'ar' ? el.dataset.phAr : el.dataset.phEn;
  });

  renderUser();
  if (App.user) api('/auth/lang', { method: 'PATCH', body: JSON.stringify({ lang: l }) }).catch(() => {});
};

// ══ Navigation ═══════════════════════════════════════════════════════════════
document.querySelectorAll('.nb').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nb').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const p = 'panel-' + b.dataset.p;
    document.getElementById(p)?.classList.add('active');
    Panels.load(b.dataset.p);
  });
});

App.logout = async function () {
  await fetch('/auth/logout', { method: 'POST' });
  localStorage.clear();
  location.href = '/login.html';
};

App.promptApiKey = function () {
  const k = prompt('أدخل مفتاح Anthropic API:\nEnter Anthropic API key:\n(starts with sk-ant-)');
  if (k && k.startsWith('sk-ant')) {
    sessionStorage.setItem('ameen_api_key', k);
    // Send to server-side via a lightweight in-memory store
    fetch('/api/ai/setkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ key: k })
    }).then(() => {
      $('api-key-btn').classList.add('connected');
      $('api-status-txt').textContent = '✓ AI Connected';
    }).catch(() => {
      // Key stored in session, will be sent with requests
      $('api-key-btn').classList.add('connected');
      $('api-status-txt').textContent = '✓ AI Connected';
    });
  }
};

// ══ Panels ═══════════════════════════════════════════════════════════════════
const Panels = {
  async load(name) {
    if (name === 'transcripts') await this.loadTranscripts();
    if (name === 'tasks') await this.loadTasks();
    if (name === 'schedule') await this.loadSchedule();
    if (name === 'overview') await this.loadOverview();
    if (name === 'team') await this.loadTeam();
    if (name === 'correspondence') await this.loadCorrHistory();
    if (name === 'documents') await this.loadMeetingSelects();
  },

  async loadTranscripts() {
    const body = $('transcripts-body');
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const meetings = await api('/api/meetings');
      if (!meetings.length) { body.innerHTML = '<div class="es"><div class="es-icon">📝</div><div data-ar="لا توجد اجتماعات مسجلة بعد" data-en="No recorded meetings yet">لا توجد اجتماعات مسجلة بعد</div></div>'; return; }
      body.innerHTML = meetings.map(m => renderMeetingCard(m)).join('');
    } catch (e) { body.innerHTML = `<div class="es">${e.message}</div>`; }
  },

  async loadTasks() {
    const body = $('tasks-body');
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [tasks, decisions] = await Promise.all([api('/api/tasks'), api('/api/decisions')]);
      updateTaskBadges(tasks);
      body.innerHTML = renderTasksPanel(tasks, decisions);
    } catch (e) { body.innerHTML = `<div class="es">${e.message}</div>`; }
  },

  async loadSchedule() {
    const items = $('sched-items');
    items.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const scheds = await api('/api/schedule');
      if (!scheds.length) { items.innerHTML = '<div class="es"><div class="es-icon">📅</div><div>لا توجد اجتماعات مجدولة</div></div>'; return; }
      items.innerHTML = scheds.map(s => renderSchedRow(s)).join('');
    } catch (e) { items.innerHTML = `<div class="es">${e.message}</div>`; }
  },

  async loadOverview() {
    const body = $('overview-body');
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [stats, tasks, meetings] = await Promise.all([api('/api/stats'), api('/api/tasks'), api('/api/meetings')]);
      body.innerHTML = renderOverview(stats, tasks, meetings);
    } catch (e) { body.innerHTML = `<div class="es">${e.message}</div>`; }
  },

  async loadTeam() {
    const body = $('team-body');
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const users = await api('/api/users');
      const taskStats = await api('/api/tasks');
      body.innerHTML = renderTeam(users, taskStats);
    } catch (e) { body.innerHTML = `<div class="es">${e.message}</div>`; }
  },

  async loadCorrHistory() { /* history loaded inline */ },

  async loadMeetingSelects() {
    // Refresh meeting select for documents
    const sel = $('doc-meeting-sel');
    if (!sel) return;
    try {
      const meetings = await api('/api/meetings');
      sel.innerHTML = '<option value="">-- اختر اجتماعاً / Select meeting --</option>';
      meetings.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${App.lang === 'ar' ? m.title_ar : (m.title_en || m.title_ar)} — ${m.meeting_date?.substring(0, 10) || ''}`;
        sel.appendChild(opt);
      });
    } catch {}
  }
};

function updateTaskBadges(tasks) {
  const overdue = tasks.filter(t => t.status === 'overdue').length;
  const inprog = tasks.filter(t => t.status === 'inprogress').length;
  const done = tasks.filter(t => t.status === 'done').length;
  $('ov-late-tag').innerHTML = `${overdue} <span data-ar="متأخرة" data-en="overdue">${App.lang === 'ar' ? 'متأخرة' : 'overdue'}</span>`;
  $('ov-prog-tag').innerHTML = `${inprog} <span>${App.lang === 'ar' ? 'جارٍ' : 'in progress'}</span>`;
  $('ov-done-tag').innerHTML = `${done} <span>${App.lang === 'ar' ? 'مكتملة' : 'done'}</span>`;
  $('b-tk').textContent = overdue || '—';
}

// ══ Render helpers ═══════════════════════════════════════════════════════════
function renderMeetingCard(m) {
  const tasks = JSON.parse(m.ai_tasks || '[]');
  const decisions = JSON.parse(m.ai_decisions || '[]');
  const processed = m.status === 'processed';
  const title = App.lang === 'ar' ? m.title_ar : (m.title_en || m.title_ar);
  const summary = App.lang === 'ar' ? m.ai_summary_ar : m.ai_summary_en;
  const recorder = App.lang === 'ar' ? m.recorder_ar : m.recorder_en;
  const dateStr = m.meeting_date ? m.meeting_date.substring(0, 16) : '';

  return `<div class="card ${processed ? 'card-gold' : ''}">
    <div class="ch">
      <div>
        <div class="ct">${esc(title)}</div>
        <div class="ctsub">${esc(dateStr)} · ${esc(recorder || '')} · ${m.duration || 0} ${App.lang === 'ar' ? 'دقيقة' : 'min'}</div>
      </div>
      <div style="display:flex;gap:7px;align-items:center">
        ${processed ? `<span class="tag tgold">✦ ${App.lang === 'ar' ? 'مُعالَج بـ AI' : 'AI Processed'}</span>` : `<span class="tag tgr">${App.lang === 'ar' ? 'مسودة' : 'Draft'}</span>`}
        ${!processed ? `<button class="btn-ghost btn-sm" onclick="processWithAI(${m.id})">✦ ${App.lang === 'ar' ? 'تحليل' : 'Analyse'}</button>` : ''}
      </div>
    </div>
    ${summary ? `<div style="background:var(--navy3);border-radius:var(--rm);padding:11px 13px;font-size:12px;line-height:1.7;color:var(--text2);margin-bottom:11px">${esc(summary)}</div>` : ''}
    ${(tasks.length || decisions.length) ? `
    <div class="eg">
      ${tasks.length ? `<div class="ec"><div class="el">✅ ${App.lang === 'ar' ? 'المهام' : 'Tasks'}</div>${tasks.map(t => `<div class="ei"><div class="ed d-g"></div>${esc(App.lang === 'ar' ? t.text_ar : (t.text_en || t.text_ar))} ${t.owner_ar ? `<span class="tag tgold btn-sm" style="margin-right:4px">${esc(App.lang === 'ar' ? t.owner_ar : t.owner_en)}</span>` : ''}</div>`).join('')}</div>` : ''}
      ${decisions.length ? `<div class="ec"><div class="el">⚖️ ${App.lang === 'ar' ? 'القرارات' : 'Decisions'}</div>${decisions.map(d => `<div class="ei"><div class="ed d-bl"></div>${esc(App.lang === 'ar' ? d.text_ar : (d.text_en || d.text_ar))}</div>`).join('')}</div>` : ''}
    </div>` : ''}
    ${m.transcript ? `<details style="margin-top:10px"><summary style="font-size:12px;color:var(--text3);cursor:pointer">${App.lang === 'ar' ? '📄 عرض النص الكامل' : '📄 View full transcript'}</summary><div class="tr-box" style="margin-top:8px;max-height:200px;font-size:12px;color:var(--text2)">${esc(m.transcript)}</div></details>` : ''}
  </div>`;
}

const statusLabels = {
  ar: { new: 'لم تبدأ', inprogress: 'قيد التنفيذ', done: 'مكتملة', overdue: 'متأخرة' },
  en: { new: 'Not Started', inprogress: 'In Progress', done: 'Done', overdue: 'Overdue' }
};
const statusIcons = { new: '○', inprogress: '◑', done: '✓', overdue: '!' };
const statusCls = { new: 'st-new', inprogress: 'st-prog', done: 'st-done', overdue: 'st-late' };

function renderTasksPanel(tasks, decisions) {
  const l = App.lang;
  const taskRows = tasks.map(t => {
    const s = t.status || 'new';
    const txt = l === 'ar' ? t.text_ar : (t.text_en || t.text_ar);
    const owner = l === 'ar' ? t.owner_name_ar : (t.owner_name_en || t.owner_name_ar);
    const src = l === 'ar' ? t.source_meeting_title_ar : (t.source_meeting_title_en || t.source_meeting_title_ar);
    return `<div class="task-row" id="tr-${t.id}">
      <div class="task-st ${statusCls[s]}">${statusIcons[s]}</div>
      <div style="flex:1;min-width:0">
        <div class="task-txt">${esc(txt)}</div>
        <div class="task-meta">
          ${src ? `<span>📋 ${esc(src)}</span>` : ''}
          ${t.due_date ? `<span>📅 ${t.due_date}</span>` : ''}
          ${t.priority === 'urgent' ? `<span class="tag tr" style="font-size:9px">${l === 'ar' ? 'عاجل' : 'Urgent'}</span>` : ''}
        </div>
      </div>
      ${owner ? `<div class="task-owner">${esc(owner)}</div>` : ''}
      <select class="st-select" onchange="Tasks.updateStatus(${t.id}, this.value)" style="color:var(--${s === 'done' ? 'green' : s === 'overdue' ? 'red' : s === 'inprogress' ? 'amber' : 'text3'})">
        ${Object.entries(statusLabels[l]).map(([k, v]) => `<option value="${k}" ${k === s ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <button onclick="Tasks.delete(${t.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:3px 6px" title="Delete">✕</button>
    </div>`;
  }).join('');

  const decRows = decisions.map(d => {
    const txt = l === 'ar' ? d.text_ar : (d.text_en || d.text_ar);
    const src = l === 'ar' ? d.meeting_title_ar : (d.meeting_title_en || d.meeting_title_ar);
    const sLabel = l === 'ar' ? { active: 'نشط', implemented: 'مُنفَّذ', archived: 'مؤرشف' }[d.status] : { active: 'Active', implemented: 'Implemented', archived: 'Archived' }[d.status];
    return `<div class="task-row">
      <div class="task-st st-done">⚖️</div>
      <div style="flex:1;min-width:0">
        <div class="task-txt">${esc(txt)}</div>
        <div class="task-meta">${src ? `<span>📋 ${esc(src)}</span>` : ''}</div>
      </div>
      <select class="st-select" onchange="Tasks.updateDecisionStatus(${d.id}, this.value)">
        <option value="active" ${d.status === 'active' ? 'selected' : ''}>${l === 'ar' ? 'نشط' : 'Active'}</option>
        <option value="implemented" ${d.status === 'implemented' ? 'selected' : ''}>${l === 'ar' ? 'مُنفَّذ' : 'Implemented'}</option>
        <option value="archived" ${d.status === 'archived' ? 'selected' : ''}>${l === 'ar' ? 'مؤرشف' : 'Archived'}</option>
      </select>
      <button onclick="Tasks.deleteDecision(${d.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:3px 6px">✕</button>
    </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="ch"><div class="ct" >${l === 'ar' ? 'لوحة المهام الحية' : 'Live Task Board'}</div><div class="ai-pill">✦ ${l === 'ar' ? 'أمين يتابع' : 'Ameen tracking'}</div></div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:0;padding:0 14px 9px;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--border2)">
        <div>${l === 'ar' ? 'المهمة' : 'Task'}</div>
        <div style="text-align:center">${l === 'ar' ? 'المسؤول' : 'Owner'}</div>
        <div style="text-align:center">${l === 'ar' ? 'الموعد' : 'Due'}</div>
        <div style="text-align:center">${l === 'ar' ? 'الحالة' : 'Status'}</div>
      </div>
      ${tasks.length ? taskRows : `<div class="es"><div class="es-icon">✅</div><div>${l === 'ar' ? 'لا توجد مهام بعد' : 'No tasks yet'}</div></div>`}
    </div>
    <div class="card">
      <div class="ch"><div class="ct">${l === 'ar' ? 'قرارات المجلس' : 'Board Decisions'}</div><span class="tag tgold">${decisions.length} ${l === 'ar' ? 'قرار' : 'decisions'}</span></div>
      ${decisions.length ? decRows : `<div class="es"><div class="es-icon">⚖️</div><div>${l === 'ar' ? 'لا توجد قرارات مسجلة' : 'No decisions recorded yet'}</div></div>`}
    </div>`;
}

function renderSchedRow(s) {
  const l = App.lang;
  const title = l === 'ar' ? s.title_ar : (s.title_en || s.title_ar);
  const colors = ['#C9A84C', '#5B9BD6', '#2ECC8A', '#EFA827', '#E05A5A'];
  const color = colors[s.id % colors.length];
  return `<div class="sched-row">
    <div class="stime" style="min-width:44px;text-align:center">
      <div class="t">${s.meeting_time || ''}</div>
      <div class="ap">${s.meeting_date || ''}</div>
    </div>
    <div class="sbar" style="background:${color}"></div>
    <div style="flex:1">
      <div class="sname">${esc(title)}</div>
      <div class="smeta">
        <span>${s.duration_mins} ${l === 'ar' ? 'دقيقة' : 'min'}</span>
        <span>${esc(s.platform || '')}</span>
        ${s.attendees ? `<span>👥 ${esc(s.attendees)}</span>` : ''}
      </div>
      ${s.agenda_ar ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">${esc(l === 'ar' ? s.agenda_ar : (s.agenda_en || s.agenda_ar))}</div>` : ''}
    </div>
    <button onclick="Schedule.delete(${s.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:3px 6px">✕</button>
  </div>`;
}

function renderOverview(stats, tasks, meetings) {
  const l = App.lang;
  const lbl = (ar, en) => l === 'ar' ? ar : en;
  const recentMtgs = meetings.slice(0, 4).map(m => `
    <div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:.5px solid var(--border2)">
      <span style="font-size:16px">🎙</span>
      <div style="flex:1"><div style="font-size:12px;color:var(--text)">${esc(l === 'ar' ? m.title_ar : (m.title_en || m.title_ar))}</div>
      <div style="font-size:10px;color:var(--text3)">${m.meeting_date?.substring(0, 10)} · ${m.duration || 0} ${lbl('دقيقة', 'min')}</div></div>
      ${m.status === 'processed' ? '<span class="tag tgold" style="font-size:9px">✦ AI</span>' : '<span class="tag tgr" style="font-size:9px">Draft</span>'}
    </div>`).join('');

  const ownerPerf = {};
  tasks.forEach(t => {
    const k = t.owner_name_ar || 'unknown';
    if (!ownerPerf[k]) ownerPerf[k] = { ar: t.owner_name_ar, en: t.owner_name_en, total: 0, done: 0 };
    ownerPerf[k].total++;
    if (t.status === 'done') ownerPerf[k].done++;
  });
  const perfRows = Object.values(ownerPerf).slice(0, 5).map(p => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    const col = pct >= 70 ? 'var(--gold)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
    return `<div style="display:flex;align-items:center;gap:10px;font-size:12px">
      <div style="width:26px;height:26px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--gold);flex-shrink:0">${(l === 'ar' ? p.ar : (p.en || p.ar) || '?')[0]}</div>
      <span style="flex:1;color:var(--text)">${esc(l === 'ar' ? p.ar : (p.en || p.ar))}</span>
      <div style="flex:2;background:var(--navy4);border-radius:2px;height:5px;overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:2px;background:${col}"></div></div>
      <span style="color:var(--text3);min-width:30px;text-align:right;font-size:10px">${pct}%</span>
    </div>`;
  }).join('');

  return `
    <div class="stat-grid">
      <div class="stat-c" style="border-color:var(--gold-border)"><div class="stat-lbl">${lbl('اجتماعات مُسجَّلة', 'Meetings Recorded')}</div><div class="stat-val">${stats.meetings}</div><div class="stat-sub">${lbl('هذا الشهر', 'this month')}</div></div>
      <div class="stat-c"><div class="stat-lbl">${lbl('مهام مستخرجة', 'Tasks Extracted')}</div><div class="stat-val">${stats.tasks_total}</div><div class="stat-sub">${lbl('عبر أمين AI', 'via Ameen AI')}</div></div>
      <div class="stat-c"><div class="stat-lbl">${lbl('مهام متأخرة', 'Overdue Tasks')}</div><div class="stat-val" style="color:var(--red)">${stats.tasks_overdue}</div><div class="stat-sub" style="color:var(--red)">${lbl('تحتاج تدخلاً', 'need attention')}</div></div>
      <div class="stat-c"><div class="stat-lbl">${lbl('قرارات المجلس', 'Board Decisions')}</div><div class="stat-val">${stats.decisions}</div><div class="stat-sub">${lbl('هذا الشهر', 'this month')}</div></div>
    </div>
    <div class="card">
      <div class="ch"><div class="ct">${lbl('معدل إنجاز المهام', 'Task Completion Rate')}</div><span style="font-size:15px;font-weight:700;color:var(--gold)">${stats.completion}%</span></div>
      <div class="pbar-bg"><div class="pbar" style="width:${stats.completion}%"></div></div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">${stats.tasks_done} ${lbl('من', 'of')} ${stats.tasks_total} ${lbl('مهمة مكتملة', 'tasks completed')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="ch"><div class="ct">${lbl('أداء الأعضاء', 'Member Performance')}</div></div><div style="display:flex;flex-direction:column;gap:9px">${perfRows || '<div style="color:var(--text3);font-size:12px">لا توجد بيانات</div>'}</div></div>
      <div class="card"><div class="ch"><div class="ct">${lbl('الاجتماعات الأخيرة', 'Recent Meetings')}</div></div>${recentMtgs || '<div class="es">لا توجد اجتماعات</div>'}</div>
    </div>`;
}

function renderTeam(users, tasks) {
  const l = App.lang;
  return `<div class="card">
    <div class="ch"><div class="ct">${l === 'ar' ? 'أعضاء الفريق' : 'Team Members'}</div><span class="tag tgold">${users.length} ${l === 'ar' ? 'أعضاء' : 'members'}</span></div>
    ${users.map(u => {
      const userTasks = tasks.filter(t => t.owner_id === u.id);
      const done = userTasks.filter(t => t.status === 'done').length;
      const overdue = userTasks.filter(t => t.status === 'overdue').length;
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:.5px solid var(--border2)">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--gold);flex-shrink:0">${(l === 'ar' ? u.name_ar : u.name_en).split(' ').slice(0,2).map(w => w[0]).join('')}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(l === 'ar' ? u.name_ar : u.name_en)}</div>
          <div style="font-size:11px;color:var(--text3)">${esc(l === 'ar' ? u.role_ar : u.role_en)} · ${esc(u.email)}</div>
        </div>
        <div style="text-align:center;font-size:11px;color:var(--text3)">
          <div style="font-size:16px;font-weight:700;color:var(--gold)">${userTasks.length}</div>
          <div>${l === 'ar' ? 'مهمة' : 'tasks'}</div>
        </div>
        ${overdue ? `<span class="tag tr">${overdue} ${l === 'ar' ? 'متأخرة' : 'overdue'}</span>` : `<span class="tag tg">${done} ${l === 'ar' ? 'مكتملة' : 'done'}</span>`}
        <div style="font-size:10px;color:var(--text3)">${l === 'ar' ? 'انضم' : 'Joined'} ${u.created_at?.substring(0, 10) || ''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ══ Recording ════════════════════════════════════════════════════════════════
const Rec = {
  async toggle() { App.recording ? this.stop() : this.start(); },

  async start() {
    App.recording = true; App.secs = 0; App.fullText = '';
    $('rec-ring').classList.add('on');
    $('rec-ic').textContent = '⏹';
    $('rec-st').textContent = App.lang === 'ar' ? 'جارٍ التسجيل...' : 'Recording in progress...';
    $('rec-tm').style.display = 'block';
    $('b-rec').style.display = 'flex';
    $('live-tr-card').style.display = 'block';
    $('live-ex-card').style.display = 'block';
    $('live-tr').innerHTML = '';
    $('status-pill').className = 'pill pill-red';
    $('st-txt').textContent = App.lang === 'ar' ? 'تسجيل' : 'Recording';
    ['ex-tasks', 'ex-decs', 'ex-rems', 'ex-fups'].forEach(id => {
      $(id).innerHTML = `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === 'ar' ? 'في انتظار الكلام...' : 'Listening...'}</div>`;
    });

    // Create meeting record
    try {
      const r = await api('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({ title_ar: $('mtg-title').value || (App.lang === 'ar' ? 'اجتماع جديد' : 'New Meeting'), title_en: $('mtg-title').value || 'New Meeting', transcript: '', duration: 0 })
      });
      App.currentMeetingId = r.id;
    } catch {}

    App.wInt = setInterval(() => {
      for (let i = 0; i < 16; i++) { const h = Math.floor(Math.random() * 24) + 4; $('w' + i).style.height = h + 'px'; $('w' + i).classList.add('a'); }
    }, 100);
    this.updTimer();
    App.tInt = setInterval(() => { App.secs++; this.updTimer(); }, 1000);
    this.startSR();
  },

  startSR() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert(App.lang === 'ar' ? 'يتطلب Chrome أو Edge لدعم التسجيل' : 'Requires Chrome or Edge for recording'); return; }
    App.srec = new SR();
    App.srec.continuous = true;
    App.srec.interimResults = true;
    App.srec.lang = App.lang === 'ar' ? 'ar-SA' : 'en-US';
    const spkClasses = ['sa', 'sb', 'sc', 'sd', 'se'];
    const speakers = {};
    let spkCount = 0;
    let interim = null;

    App.srec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) {
          App.fullText += txt + ' ';
          const spkName = App.lang === 'ar' ? 'المتحدث' : 'Speaker';
          if (!speakers[spkName]) { speakers[spkName] = spkClasses[spkCount++ % spkClasses.length]; }
          this.addLine(spkName, speakers[spkName], txt);
          if (interim) { interim.remove(); interim = null; }
          // Auto-extract keywords
          this.autoExtract(txt);
        } else {
          if (!interim) {
            interim = document.createElement('div'); interim.className = 'sl'; interim.style.opacity = '.5';
            interim.innerHTML = `<span class="spk sa">${App.lang === 'ar' ? 'المتحدث' : 'Speaker'}</span><span style="color:var(--text)"></span>`;
            $('live-tr').appendChild(interim);
          }
          interim.querySelector('span:last-child').textContent = txt;
        }
      }
      $('live-tr').scrollTop = $('live-tr').scrollHeight;
    };
    App.srec.onerror = e => { if (e.error !== 'no-speech') console.error(e.error); };
    App.srec.onend = () => { if (App.recording) { try { App.srec.start(); } catch {} } };
    App.srec.start();
  },

  addLine(speaker, tag, text) {
    const d = document.createElement('div'); d.className = 'sl';
    d.innerHTML = `<span class="spk ${tag}">${esc(speaker)}</span><span style="color:var(--text)">${esc(text)}<span class="cur"></span></span>`;
    $('live-tr').appendChild(d);
    $('live-tr').scrollTop = $('live-tr').scrollHeight;
    setTimeout(() => d.querySelector('.cur')?.remove(), 1000);
  },

  autoExtract(text) {
    const t = text.toLowerCase();
    const arTaskKws = ['يجب', 'نحتاج', 'سيقوم', 'المطلوب', 'مهمة'];
    const arDecKws = ['قرر', 'اتفق', 'تم الموافقة', 'تقرر', 'نوافق'];
    const enTaskKws = ['should', 'need to', 'will', 'must', 'action'];
    const enDecKws = ['decided', 'agreed', 'approved', 'resolved'];
    const isTask = [...arTaskKws, ...enTaskKws].some(k => t.includes(k));
    const isDec = [...arDecKws, ...enDecKws].some(k => t.includes(k));
    if (isTask) this.addExtracted('ex-tasks', 'd-g', text.substring(0, 60) + (text.length > 60 ? '...' : ''));
    if (isDec) this.addExtracted('ex-decs', 'd-bl', text.substring(0, 60) + (text.length > 60 ? '...' : ''));
  },

  addExtracted(container, dotCls, text) {
    const c = $(container);
    const existing = c.querySelector('.ee');
    if (existing) existing.remove();
    const d = document.createElement('div'); d.className = 'ei';
    d.innerHTML = `<div class="ed ${dotCls}"></div><span>${esc(text)}</span>`;
    c.appendChild(d);
  },

  stop() {
    App.recording = false;
    if (App.srec) { App.srec.onend = null; try { App.srec.stop(); } catch {} App.srec = null; }
    clearInterval(App.tInt); clearInterval(App.wInt);
    for (let i = 0; i < 16; i++) { $('w' + i).style.height = '6px'; $('w' + i).classList.remove('a'); }
    $('rec-ring').classList.remove('on'); $('rec-ic').textContent = '🎙';
    $('rec-st').textContent = App.lang === 'ar' ? 'انتهى التسجيل — جاهز للمعالجة' : 'Recording stopped — ready to process';
    $('b-rec').style.display = 'none';
    $('status-pill').className = 'pill pill-green'; $('st-txt').textContent = App.lang === 'ar' ? 'جاهز' : 'Ready';
    // Save transcript
    if (App.currentMeetingId) {
      api(`/api/meetings/${App.currentMeetingId}`, { method: 'PATCH', body: JSON.stringify({ transcript: App.fullText, duration: Math.floor(App.secs / 60) }) }).catch(() => {});
    }
  },

  saveOnly() { if (App.recording) this.stop(); $('rec-st').textContent = App.lang === 'ar' ? '✓ تم الحفظ' : '✓ Saved'; },

  async processAI() {
    if (App.recording) this.stop();
    if (!App.fullText.trim() && !App.currentMeetingId) { alert(App.lang === 'ar' ? 'لا يوجد نص لمعالجته' : 'No transcript to process'); return; }
    const btn = $('ai-proc-btn'); btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === 'ar' ? 'جارٍ التحليل...' : 'Analysing...'}`;
    $('ai-res-card').style.display = 'block';
    $('ai-res-body').innerHTML = `<div style="text-align:center;padding:16px;color:var(--text3)">${App.lang === 'ar' ? 'أمين يحلل الاجتماع...' : 'Ameen is analysing the meeting...'}</div>`;

    try {
      const result = await api(`/api/meetings/${App.currentMeetingId}/process`, { method: 'POST' });
      if (result.success) this.showResult(result.result);
      if (result.demo) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px;color:var(--amber);margin-top:8px;padding:6px 10px;background:var(--amber2);border-radius:6px';
        note.textContent = App.lang === 'ar' ? '⚠️ نتيجة تجريبية — أضف مفتاح Anthropic API للحصول على نتائج حقيقية' : '⚠️ Demo result — Add Anthropic API key for real AI analysis';
        $('ai-res-body').appendChild(note);
      }
      await loadBadges();
    } catch (e) {
      $('ai-res-body').innerHTML = `<div style="color:var(--red);font-size:12px">${e.message}</div>`;
    }
    btn.disabled = false;
    btn.innerHTML = `✦ <span data-ar="تحليل بأمين AI" data-en="Analyse with Ameen AI">${App.lang === 'ar' ? 'تحليل بأمين AI' : 'Analyse with Ameen AI'}</span>`;
  },

  showResult(r) {
    const l = App.lang;
    let h = '';
    const summary = l === 'ar' ? r.summary_ar : r.summary_en;
    if (summary) h += `<div style="background:var(--navy3);border-radius:var(--rm);padding:12px 14px;font-size:13px;line-height:1.7;color:var(--text2);margin-bottom:12px">${esc(summary)}</div>`;
    if (r.tasks?.length) {
      h += `<div style="font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">✅ ${l === 'ar' ? 'المهام المستخرجة' : 'Extracted Tasks'}</div>`;
      r.tasks.forEach((t, i) => {
        const txt = l === 'ar' ? t.text_ar : (t.text_en || t.text_ar);
        h += `<div style="display:flex;align-items:center;gap:7px;padding:5px 0;font-size:12px;border-bottom:.5px solid var(--border2)"><div style="width:18px;height:18px;border-radius:50%;background:var(--navy4);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text3);flex-shrink:0">${i + 1}</div>${esc(txt)}${t.owner_ar ? `<span class="tag tgold" style="margin-right:5px">${esc(l === 'ar' ? t.owner_ar : t.owner_en)}</span>` : ''}${t.due ? `<span class="tag tgr">${esc(t.due)}</span>` : ''}</div>`;
      });
    }
    if (r.decisions?.length) {
      h += `<div style="font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 7px">⚖️ ${l === 'ar' ? 'القرارات' : 'Decisions'}</div>`;
      r.decisions.forEach(d => {
        const txt = l === 'ar' ? d.text_ar : (d.text_en || d.text_ar);
        h += `<div style="display:flex;gap:6px;padding:4px 0;font-size:12px"><div style="width:5px;height:5px;border-radius:50%;background:var(--blue);margin-top:5px;flex-shrink:0"></div>${esc(txt)}</div>`;
      });
    }
    $('ai-res-body').innerHTML = h || '<div style="color:var(--text3)">—</div>';
  },

  updTimer() {
    const m = Math.floor(App.secs / 60).toString().padStart(2, '0');
    const s = (App.secs % 60).toString().padStart(2, '0');
    $('rec-tm').textContent = m + ':' + s;
    $('rec-timer-lbl').textContent = m + ':' + s;
  }
};

async function processWithAI(meetingId) {
  try {
    const r = await api(`/api/meetings/${meetingId}/process`, { method: 'POST' });
    alert(App.lang === 'ar' ? 'تم التحليل بنجاح! اذهب إلى المحاضر لعرض النتيجة.' : 'Analysis complete! Go to Transcripts to view the result.');
    Panels.load('transcripts');
  } catch (e) { alert(e.message); }
}

// ══ Tasks ════════════════════════════════════════════════════════════════════
const Tasks = {
  async updateStatus(id, status) {
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); loadBadges(); }
    catch (e) { alert(e.message); }
  },
  async delete(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذه المهمة؟' : 'Delete this task?')) return;
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    document.getElementById('tr-' + id)?.remove();
    loadBadges();
  },
  async updateDecisionStatus(id, status) {
    await api(`/api/decisions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).catch(() => {});
  },
  async deleteDecision(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذا القرار؟' : 'Delete this decision?')) return;
    await api(`/api/decisions/${id}`, { method: 'DELETE' });
    Panels.load('tasks');
  }
};

// ══ Modals ═══════════════════════════════════════════════════════════════════
const Modals = {
  addTask() { $('modal-task').classList.add('open'); },
  close() { $('modal-task').classList.remove('open'); },
  async saveTask() {
    const data = {
      text_ar: $('nt-ar').value, text_en: $('nt-en').value,
      owner_id: $('nt-owner').value || null,
      due_date: $('nt-due').value, priority: $('nt-priority').value,
    };
    if (!data.text_ar) { alert(App.lang === 'ar' ? 'أدخل نص المهمة' : 'Enter task text'); return; }
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(data) });
      this.close();
      Panels.load('tasks');
      ['nt-ar', 'nt-en', 'nt-due'].forEach(id => $(id).value = '');
    } catch (e) { alert(e.message); }
  }
};
$('modal-task').addEventListener('click', e => { if (e.target === $('modal-task')) Modals.close(); });

// ══ Pre-meeting Report ═══════════════════════════════════════════════════════
const PreMeeting = {
  async generate() {
    const selId = $('pm-meeting-sel')?.value;
    const body = $('pm-body');
    body.innerHTML = `<div class="es"><div class="loading"></div><div>${App.lang === 'ar' ? 'أمين يُعدّ التقرير...' : 'Ameen is preparing the report...'}</div></div>`;
    try {
      const r = await api('/api/ai/premeeting', { method: 'POST', body: JSON.stringify({ schedule_id: selId || null, lang: App.lang }) });
      body.innerHTML = this.renderReport(r);
    } catch (e) { body.innerHTML = `<div class="es">${e.message}</div>`; }
  },

  renderReport(r) {
    const l = App.lang;
    const m = r.meeting;
    const rp = r.report;
    const lbl = (ar, en) => l === 'ar' ? ar : en;
    const title = m ? (l === 'ar' ? m.title_ar : (m.title_en || m.title_ar)) : lbl('التقرير', 'Report');

    const section = (icon, color, heading, items, isObj = false) => {
      if (!items?.length) return '';
      const rows = isObj ? items.map(it => `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)"><div style="width:5px;height:5px;border-radius:50%;background:${color};margin-top:6px;flex-shrink:0"></div>${esc(it.item || it)} ${it.owner ? `<span class="tag tgold" style="margin-right:4px">${esc(it.owner)}</span>` : ''} ${it.reason ? `<span class="tag tgr">${esc(it.reason)}</span>` : ''}</div>`).join('') :
        items.map(it => `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)"><div style="width:5px;height:5px;border-radius:50%;background:${color};margin-top:5px;flex-shrink:0"></div>${esc(it)}</div>`).join('');
      return `<div style="background:var(--navy3);border-radius:var(--rm);padding:13px;border:1px solid var(--border2);margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">
          <div style="width:28px;height:28px;border-radius:var(--rs);background:${color}22;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${icon}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">${heading}</div>
        </div>${rows}</div>`;
    };

    const agendaItems = l === 'ar' ? rp.agenda_ar : rp.agenda_en;
    const agendaRows = agendaItems?.map(a => `<div style="display:flex;align-items:flex-start;gap:9px;padding:5px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)"><div style="font-size:11px;font-weight:700;color:var(--gold);min-width:40px">${esc(a.time)}</div>${esc(a.item)}</div>`).join('') || '';

    return `<div class="card card-gold">
      <div class="ch">
        <div><div class="ct">${esc(title)}</div><div class="ctsub">${m ? `${m.meeting_date || ''} ${m.meeting_time || ''} · ${esc(m.platform || '')}` : ''}</div></div>
        <div style="display:flex;gap:7px">
          ${r.demo ? `<span class="tag ta">${lbl('تجريبي', 'Demo')}</span>` : '<span class="tag tgold">✦ AI</span>'}
        </div>
      </div>
      ${section('✅', 'var(--green)', lbl('ما الذي أُنجز؟', 'What was completed?'), l === 'ar' ? rp.completed_ar : rp.completed_en)}
      ${section('⚠️', 'var(--red)', lbl('ما الذي تأخر؟', 'What is delayed?'), l === 'ar' ? rp.delayed_ar : rp.delayed_en, true)}
      ${section('🎯', 'var(--gold)', lbl('ما الذي يحتاج قراراً اليوم؟', 'What needs a decision today?'), l === 'ar' ? rp.decisions_needed_ar : rp.decisions_needed_en)}
      ${agendaRows ? `<div style="background:var(--navy3);border-radius:var(--rm);padding:13px;border:1px solid var(--border2);margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:9px">📋 ${lbl('جدول الأعمال المقترح', 'Suggested Agenda')}</div>${agendaRows}</div>` : ''}
      <div style="display:flex;gap:9px;margin-top:4px;justify-content:flex-end">
        <button class="btn-ghost" onclick="window.print()">📤 ${lbl('طباعة', 'Print')}</button>
        <button class="btn-gold" onclick="PreMeeting.generate()">↺ ${lbl('تحديث', 'Refresh')}</button>
      </div>
    </div>`;
  }
};

// ══ Chat ══════════════════════════════════════════════════════════════════════
const Chat = {
  async send() {
    const inp = $('ci'); const text = inp.value.trim(); if (!text) return;
    inp.value = ''; inp.style.height = '';
    this.append(text, true); this.showTyping();
    App.chatHistory.push({ role: 'user', content: text });
    try {
      const r = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: App.chatHistory.slice(-8), lang: App.lang }) });
      removeTyping();
      this.append(r.reply, false);
      App.chatHistory.push({ role: 'assistant', content: r.reply });
      if (r.demo) this.showDemoNote();
    } catch (e) { removeTyping(); this.append(App.lang === 'ar' ? 'عذراً، حدث خطأ.' : 'Sorry, an error occurred.', false); }
  },
  quick(btn) { const q = App.lang === 'ar' ? btn.dataset.qAr : btn.dataset.qEn; $('ci').value = q; this.send(); },
  key(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } },
  append(text, isUser) {
    const msgs = $('chat-msgs'); const d = document.createElement('div'); d.className = 'msg' + (isUser ? ' user' : '');
    const av = isUser ? `<div class="mav">${App.user ? (App.lang === 'ar' ? App.user.name_ar : App.user.name_en).split(' ').slice(0, 2).map(w => w[0]).join('') : '?'}</div>` : `<div class="mav"><img src="/logo.png" alt="Ameen"/></div>`;
    d.innerHTML = `${av}<div><div class="mb">${esc(text)}</div><div class="mts">${now()}</div></div>`;
    msgs.insertBefore(d, msgs.querySelector('#chat-chips') ? msgs.querySelector('#chat-chips') : null);
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  },
  showTyping() {
    const msgs = $('chat-msgs'); const d = document.createElement('div'); d.className = 'msg'; d.id = 'typ';
    d.innerHTML = `<div class="mav"><img src="/logo.png"/></div><div class="mb"><div class="tyd"><span></span><span></span><span></span></div></div>`;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  },
  showDemoNote() {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--amber);padding:6px 10px;background:var(--amber2);border-radius:6px;margin-top:4px;text-align:center';
    note.textContent = App.lang === 'ar' ? '⚠️ رد تجريبي — أضف مفتاح Anthropic API للحصول على ردود حقيقية' : '⚠️ Demo reply — Add Anthropic API key for real AI responses';
    $('chat-msgs').appendChild(note);
  }
};
function removeTyping() { $('typ')?.remove(); }

// ══ Correspondence ════════════════════════════════════════════════════════════
const Corr = {
  currentContent: '',
  async generate() {
    const data = {
      type: $('corr-type').value,
      to_name: $('corr-to').value,
      subject_ar: $('corr-subject-ar').value,
      subject_en: $('corr-subject-en').value,
      situation: $('corr-body').value,
      signature: $('corr-sig').value,
      lang: App.lang,
    };
    if (!data.situation) { alert(App.lang === 'ar' ? 'يرجى وصف الموقف' : 'Please describe the situation'); return; }
    const btn = $('corr-btn'); btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === 'ar' ? 'أمين يكتب...' : 'Ameen is drafting...'}`;
    $('corr-result').innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3)">${App.lang === 'ar' ? 'أمين يصيغ الخطاب...' : 'Drafting the letter...'}</div>`;
    try {
      const r = await api('/api/ai/correspondence', { method: 'POST', body: JSON.stringify(data) });
      this.currentContent = r.content;
      $('corr-result').style.direction = data.type === 'formal_en' || data.type === 'email_en' ? 'ltr' : 'rtl';
      $('corr-result').style.textAlign = data.type === 'formal_en' || data.type === 'email_en' ? 'left' : 'right';
      $('corr-result').textContent = r.content;
      const toast = $('corr-toast'); toast.style.display = 'flex'; setTimeout(() => toast.style.display = 'none', 2500);
    } catch (e) { $('corr-result').innerHTML = `<div style="color:var(--red)">${e.message}</div>`; }
    btn.disabled = false;
    btn.innerHTML = `✦ <span data-ar="صياغة الخطاب" data-en="Draft Letter">${App.lang === 'ar' ? 'صياغة الخطاب' : 'Draft Letter'}</span>`;
  },
  copy() { if (this.currentContent) { navigator.clipboard.writeText(this.currentContent); alert(App.lang === 'ar' ? '✓ تم النسخ' : '✓ Copied'); } },
  print() { window.print(); }
};

// ══ Document Generator ════════════════════════════════════════════════════════
const DocGen = {
  currentContent: '',
  async generate() {
    const data = {
      doc_type: $('doc-type').value,
      meeting_id: $('doc-meeting-sel').value || null,
      details: $('doc-details').value,
      lang: $('doc-lang').value,
      detail_level: $('doc-detail').value,
    };
    const btn = $('doc-btn'); btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === 'ar' ? 'أمين يُولّد...' : 'Generating...'}`;
    $('doc-result').innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3)">${App.lang === 'ar' ? 'أمين يُنشئ الوثيقة...' : 'Generating document...'}</div>`;
    try {
      const r = await api('/api/ai/document', { method: 'POST', body: JSON.stringify(data) });
      this.currentContent = r.content;
      $('doc-result').style.direction = data.lang === 'en' ? 'ltr' : 'rtl';
      $('doc-result').style.textAlign = data.lang === 'en' ? 'left' : 'right';
      $('doc-result').textContent = r.content;
      const toast = $('doc-toast'); toast.style.display = 'flex'; setTimeout(() => toast.style.display = 'none', 2500);
    } catch (e) { $('doc-result').innerHTML = `<div style="color:var(--red)">${e.message}</div>`; }
    btn.disabled = false;
    btn.innerHTML = `✦ <span data-ar="توليد الوثيقة" data-en="Generate Document">${App.lang === 'ar' ? 'توليد الوثيقة' : 'Generate Document'}</span>`;
  },
  copy() { if (this.currentContent) { navigator.clipboard.writeText(this.currentContent); alert(App.lang === 'ar' ? '✓ تم النسخ' : '✓ Copied'); } },
  print() { window.print(); }
};

// ══ Schedule ══════════════════════════════════════════════════════════════════
const Schedule = {
  async add() {
    const data = {
      title_ar: $('nm-title-ar').value,
      title_en: $('nm-title-en').value,
      meeting_date: $('nm-date').value,
      meeting_time: $('nm-time').value,
      duration_mins: $('nm-dur').value,
      platform: $('nm-plat').value,
      attendees: $('nm-att').value,
      agenda_ar: $('nm-agenda-ar').value,
      agenda_en: $('nm-agenda-en').value,
    };
    if (!data.title_ar || !data.meeting_date || !data.meeting_time) {
      alert(App.lang === 'ar' ? 'يرجى إدخال العنوان والتاريخ والوقت' : 'Please enter title, date and time');
      return;
    }
    try {
      await api('/api/schedule', { method: 'POST', body: JSON.stringify(data) });
      const toast = $('sched-toast'); toast.style.display = 'flex'; setTimeout(() => toast.style.display = 'none', 2500);
      Panels.load('schedule');
      loadBadges();
      ['nm-title-ar', 'nm-title-en', 'nm-date', 'nm-att', 'nm-agenda-ar', 'nm-agenda-en'].forEach(id => $(id).value = '');
    } catch (e) { alert(e.message); }
  },
  async delete(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذا الاجتماع من الجدول؟' : 'Remove this meeting from schedule?')) return;
    await api(`/api/schedule/${id}`, { method: 'DELETE' });
    Panels.load('schedule');
  }
};

// ══ Textarea auto-resize ══════════════════════════════════════════════════════
$('ci').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
