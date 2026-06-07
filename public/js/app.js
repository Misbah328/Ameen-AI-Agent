'use strict';
// ══ Utilities ════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const esc = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const now = () => new Date().toLocaleTimeString(App.lang === 'ar' ? 'ar-SA' : 'en-GB', {hour:'2-digit',minute:'2-digit'});
const fmtDate = d => d ? new Date(d).toLocaleDateString(App.lang === 'ar' ? 'ar-SA' : 'en-GB', {year:'numeric',month:'short',day:'numeric'}) : '—';

// ══ App State ══════════════════════════════════════════════════════════════════
const App = {
  lang: localStorage.getItem('lang') || 'ar',
  theme: localStorage.getItem('theme') || 'dark',
  user: null,
  plan: 'free',
  chatHistory: [],

  async init() {
    this.applyTheme(this.theme);
    try {
      const me = await api('/auth/me');
      this.user = me;
    } catch (e) { this.user = null; }
    await this.loadPlan();
    this.applyLang(this.lang);
    this.renderUser();
    await loadBadges();
    await loadSelectLists();
    Panels.init();
    Panels.load('record');
  },

  isPro() { return this.plan === 'pro'; },

  async loadPlan() {
    try { const r = await api('/api/plan'); this.plan = r.plan || 'free'; } catch (e) { this.plan = 'free'; }
    this.renderPlan();
  },

  renderPlan() {
    const pro = this.isPro();
    const txt = $('plan-txt'); if (txt) txt.textContent = pro ? 'Pro' : 'Free';
    const badge = $('plan-badge'); if (badge) badge.style.color = pro ? 'var(--gold)' : 'var(--text3)';
    const btn = $('plan-btn'); if (btn) btn.style.borderColor = pro ? 'var(--gold-border)' : '';
    document.querySelectorAll('[data-pro]').forEach(el => { el.style.display = pro ? '' : 'none'; });
    document.querySelectorAll('[data-free]').forEach(el => { el.style.display = pro ? 'none' : ''; });
  },

  openPlan() {
    const l = this.lang;
    const cur = $('plan-current');
    if (cur) cur.textContent = (l === 'ar' ? 'باقتك الحالية: ' : 'Current plan: ') + (this.isPro() ? 'Pro ⭐' : 'Free');
    $('plan-upgrade-btn').style.display = this.isPro() ? 'none' : '';
    $('plan-downgrade-btn').style.display = this.isPro() ? '' : 'none';
    $('modal-plan').classList.add('open');
    this.applyLang(l);
  },
  closePlan() { $('modal-plan').classList.remove('open'); },

  async setPlan(plan) {
    try {
      const r = await api('/api/plan', { method: 'PATCH', body: JSON.stringify({ plan }) });
      this.plan = r.plan;
      this.renderPlan();
      this.closePlan();
      const cur = document.querySelector('.nb.active')?.dataset.p;
      if (cur) Panels.load(cur);
    } catch (e) { alert(e.message); }
  },

  requirePro() {
    if (this.isPro()) return true;
    this.openPlan();
    return false;
  },

  setLang(l) {
    this.lang = l;
    localStorage.setItem('lang', l);
    this.applyLang(l);
    const cur = document.querySelector('.nb.active')?.dataset.p;
    if (cur) Panels.load(cur);
  },

  toggleTheme() {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
  },

  applyTheme(t) {
    this.theme = t;
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
    const btn = $('theme-icon');
    if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
    const lbl = $('theme-label');
    if (lbl) {
      lbl.dataset.ar = t === 'dark' ? 'فاتح' : 'داكن';
      lbl.dataset.en = t === 'dark' ? 'Light' : 'Dark';
      lbl.textContent = this.lang === 'ar' ? lbl.dataset.ar : lbl.dataset.en;
    }
  },

  applyLang(l) {
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('.lb').forEach(b => b.classList.toggle('active', b.textContent.trim() === (l === 'ar' ? 'ع' : 'EN')));

    document.querySelectorAll('[data-ar]').forEach(el => {
      const txt = l === 'ar' ? el.dataset.ar : el.dataset.en;
      if (!txt) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.placeholder = txt; }
      else { el.textContent = txt; }
    });

    document.querySelectorAll('[data-ph-ar]').forEach(el => {
      el.placeholder = l === 'ar' ? el.dataset.phAr : el.dataset.phEn;
    });

    // Chat welcome
    const wt = $('welcome-text');
    const wts = $('welcome-ts');
    if (wt) {
      wt.textContent = l === 'ar'
        ? 'أنا أمين، مساعدكم التنفيذي الذكي. يمكنني تحليل الاجتماعات، متابعة المهام والقرارات، والإجابة على أي سؤال تنفيذي.'
        : "I'm Ameen, your executive AI. I can analyse meetings, track tasks and decisions, and answer any executive question.";
    }
    if (wts) wts.textContent = now();

    // Chat input
    const ci = $('ci');
    if (ci) ci.placeholder = l === 'ar' ? 'اسأل أمين...' : 'Ask Ameen...';
  },

  renderUser() {
    if (!this.user) return;
    const l = this.lang;
    const name = l === 'ar' ? this.user.name_ar : (this.user.name_en || this.user.name_ar);
    const role = l === 'ar' ? (this.user.role_ar || 'مستخدم') : (this.user.role_en || 'User');
    const initials = name.split(' ').slice(0,2).map(w => w[0]).join('');
    const uav = $('u-av'); if (uav) uav.textContent = initials;
    const uname = $('u-name'); if (uname) uname.textContent = name;
    const urole = $('u-role'); if (urole) urole.textContent = role;
  },

  promptApiKey() {
    const cur = sessionStorage.getItem('api_key') || '';
    const k = prompt(this.lang === 'ar'
      ? 'أدخل مفتاح Anthropic API (sk-ant-...):\n\nاتركه فارغاً للوضع التجريبي'
      : 'Enter Anthropic API key (sk-ant-...):\n\nLeave blank for demo mode', cur);
    if (k === null) return;
    if (k && k.startsWith('sk-ant')) {
      sessionStorage.setItem('api_key', k);
      api('/api/ai/setkey', { method: 'POST', body: JSON.stringify({ key: k }) })
        .then(() => {
          $('api-key-btn').style.borderColor = 'var(--green)';
          $('api-status-txt').textContent = this.lang === 'ar' ? '✓ مفعّل' : '✓ Active';
        }).catch(() => {});
    } else if (k === '') {
      sessionStorage.removeItem('api_key');
      $('api-status-txt').textContent = 'Anthropic API';
    } else if (k) {
      alert(this.lang === 'ar' ? 'مفتاح غير صالح — يجب أن يبدأ بـ sk-ant' : 'Invalid key — must start with sk-ant');
    }
  },

};

// ══ API ════════════════════════════════════════════════════════════════════════
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const r = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || `HTTP ${r.status}`);
  return data;
}

// ══ Navigation ════════════════════════════════════════════════════════════════
const Panels = {
  init() {
    document.querySelectorAll('.nb[data-p]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Panels.load(btn.dataset.p);
      });
    });
  },
  async load(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $(`panel-${name}`);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.nb').forEach(b => b.classList.toggle('active', b.dataset.p === name));
    App.applyLang(App.lang);

    switch (name) {
      case 'transcripts': await renderTranscripts(); break;
      case 'tasks': await renderTasks(); break;
      case 'schedule': await renderSchedule(); break;
      case 'overview': await renderOverview(); break;
      case 'team': await Team.load(); break;
      case 'documents': await loadDocMeetings(); break;
    }
  }
};

// ══ Badges ════════════════════════════════════════════════════════════════════
async function loadBadges() {
  try {
    const s = await api('/api/stats');
    const bt = $('b-tk'); if (bt) { bt.textContent = s.tasks_open; bt.style.display = s.tasks_open ? 'flex' : 'none'; bt.className = 'nbg' + (s.tasks_overdue > 0 ? ' nbg-red' : ' nbg-gold'); }
    const br = $('b-tr'); if (br) { br.textContent = s.meetings; br.style.display = s.meetings ? 'flex' : 'none'; }
    const bs = $('b-sc'); if (bs) { bs.textContent = s.schedule; bs.style.display = s.schedule ? 'flex' : 'none'; }

    const lt = $('ov-late-tag'); if (lt) lt.textContent = `⚠ ${s.tasks_overdue} ${App.lang === 'ar' ? 'متأخرة' : 'overdue'}`;
    const pt = $('ov-prog-tag'); if (pt) pt.textContent = `▶ ${s.tasks_open - s.tasks_overdue} ${App.lang === 'ar' ? 'جارٍ' : 'in progress'}`;
    const dt = $('ov-done-tag'); if (dt) dt.textContent = `✓ ${s.tasks_done} ${App.lang === 'ar' ? 'مكتملة' : 'done'}`;
  } catch (e) {}
}

// ══ Load select dropdowns ═════════════════════════════════════════════════════
async function loadSelectLists() {
  try {
    const users = await api('/api/members');
    App._members = users;
    const l = App.lang;
    const opts = users.map(u => `<option value="${u.id}">${esc(l === 'ar' ? u.name_ar : (u.name_en || u.name_ar))}</option>`).join('');
    const ownerSel = $('nt-owner'); if (ownerSel) ownerSel.innerHTML = `<option value="">-- ${l === 'ar' ? 'اختر' : 'Select'} --</option>${opts}`;
  } catch (e) {}
}

async function loadDocMeetings() {
  try {
    const mtgs = await api('/api/meetings');
    const l = App.lang;
    const sel = $('doc-meeting-sel');
    if (sel) sel.innerHTML = `<option value="">-- ${l === 'ar' ? 'اختر اجتماعاً' : 'Select meeting'} --</option>` +
      `<option value="all">${l === 'ar' ? '📊 جميع الاجتماعات السابقة (تقرير موحّد)' : '📊 All past meetings (combined report)'}</option>` +
      mtgs.map(m => `<option value="${m.id}">${esc(l === 'ar' ? m.title_ar : (m.title_en || m.title_ar))} (${m.meeting_date?.substring(0,10) || ''})</option>`).join('');
  } catch (e) {}
}

// ══ Recording ═════════════════════════════════════════════════════════════════
const Rec = {
  mediaRec: null, audioChunks: [], isRecording: false,
  startTime: null, timerInt: null,
  speechRec: null, fullTranscript: '',
  currentMeetingId: null,

  async toggle() {
    if (this.isRecording) { await this.stop(); }
    else { await this.start(); }
  },

  async start() {
    const title = $('mtg-title').value.trim() || (App.lang === 'ar' ? 'اجتماع بدون عنوان' : 'Untitled Meeting');
    try {
      const row = await api('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({ title_ar: title, title_en: title, transcript: '' })
      });
      this.currentMeetingId = row.id;
    } catch (e) { alert(e.message); return; }

    this.fullTranscript = '';
    this.isRecording = true;
    $('rec-ring').classList.add('recording');
    $('rec-ic').textContent = '⏹';
    $('b-rec').style.display = 'flex';
    $('live-tr-card').style.display = '';
    $('live-ex-card').style.display = '';
    $('ai-res-card').style.display = 'none';
    $('live-tr').textContent = '';
    $('ex-tasks').innerHTML = `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === 'ar' ? 'في انتظار الكلام...' : 'Listening...'}</div>`;
    $('ex-decs').innerHTML = `<div style="font-size:11px;color:var(--text3);font-style:italic">${App.lang === 'ar' ? 'في انتظار الكلام...' : 'Listening...'}</div>`;
    const stEl = $('rec-st'); if (stEl) stEl.textContent = App.lang === 'ar' ? '▶ جارٍ التسجيل' : '▶ Recording...';

    // Live editing while recording is a Pro feature.
    this.setupEditableTranscript();

    this.startTime = Date.now();
    this.timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - this.startTime) / 1000);
      const ts = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
      $('rec-tm').textContent = ts;
      $('rec-timer-lbl').textContent = ts;
    }, 1000);

    // Live AI extraction: every ~18s send the latest transcript to the AI and
    // refresh the detected tasks (with owners) + decisions before the meeting ends.
    this._lastExtractLen = 0;
    this.liveExInt = setInterval(() => { this.liveExtract(); }, 18000);

    this.startWaveform();
    this.startSpeechRec();
  },

  setupEditableTranscript() {
    const box = $('live-tr');
    if (!box) return;
    if (App.isPro()) {
      box.setAttribute('contenteditable', 'true');
      box.style.outline = 'none';
      box.title = App.lang === 'ar' ? 'يمكنك التعديل أثناء التسجيل (Pro)' : 'You can edit while recording (Pro)';
      box.oninput = () => { this._userEdited = true; this.fullTranscript = box.innerText; };
      this._editHint = this._editHint || true;
    } else {
      box.removeAttribute('contenteditable');
      box.oninput = null;
    }
  },

  async stop() {
    this.isRecording = false;
    clearInterval(this.timerInt);
    $('rec-ring').classList.remove('recording');
    $('rec-ic').textContent = '🎙';
    $('b-rec').style.display = 'none';
    this.stopWaveform();
    clearInterval(this.liveExInt);
    if (this.speechRec) { try { this.speechRec.stop(); } catch(e){} this.speechRec = null; }
    const stEl = $('rec-st'); if (stEl) stEl.textContent = App.lang === 'ar' ? 'اضغط للبدء' : 'Tap to start';

    // If the coordinator edited the transcript live (Pro), keep their version.
    const box = $('live-tr');
    if (App.isPro() && box && box.getAttribute('contenteditable') === 'true') {
      this.fullTranscript = box.innerText;
    }

    // One final live extraction pass so nothing said near the end is missed.
    await this.liveExtract();

    if (this.currentMeetingId && this.fullTranscript) {
      const dur = Math.floor((Date.now() - this.startTime) / 1000);
      await api(`/api/meetings/${this.currentMeetingId}`, { method: 'PATCH', body: JSON.stringify({ transcript: this.fullTranscript, duration: dur }) });
    }
  },

  startSpeechRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('live-tr').textContent = App.lang === 'ar' ? 'المتصفح لا يدعم التعرف على الصوت — جرّب Chrome' : 'Browser does not support speech recognition — try Chrome'; return; }
    this.speechRec = new SR();
    this.speechRec.continuous = true;
    this.speechRec.interimResults = true;
    this.speechRec.lang = App.lang === 'ar' ? 'ar-SA' : 'en-US';

    let interim = '';
    this.speechRec.onresult = e => {
      let final = '', int = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { final += e.results[i][0].transcript + ' '; }
        else { int += e.results[i][0].transcript; }
      }
      if (final) { this.fullTranscript += final; this.scanTranscript(final); }
      const box = $('live-tr');
      if (!box) return;
      // In Pro edit mode, don't clobber the coordinator's edits/cursor — only
      // append newly finalized speech; skip interim repainting.
      if (App.isPro() && box.getAttribute('contenteditable') === 'true') {
        if (final && !this._userEdited) { box.innerText = this.fullTranscript; }
        else if (final) { box.innerText = box.innerText + final; this.fullTranscript = box.innerText; }
      } else {
        box.textContent = this.fullTranscript + int;
      }
    };

    this.speechRec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') console.warn('SR error:', e.error); };
    this.speechRec.onend = () => { if (this.isRecording) { try { this.speechRec.start(); } catch(e){} } };
    try { this.speechRec.start(); } catch(e){}
  },

  scanTranscript(text) {
    const t = text.toLowerCase();
    const taskKw = ['يجب', 'سيتولى', 'مسؤول', 'مطلوب', 'بحلول', 'موعد', 'task', 'action', 'responsible', 'deadline', 'must', 'will do', 'follow up'];
    const decKw = ['قررنا', 'اعتمدنا', 'موافقة', 'نوافق', 'decided', 'approved', 'agreed', 'resolution'];
    if (taskKw.some(k => t.includes(k))) this.addExtracted('tasks', text.trim());
    if (decKw.some(k => t.includes(k))) this.addExtracted('decs', text.trim());
  },

  addExtracted(type, text) {
    const el = $(`ex-${type}`);
    if (!el) return;
    const existing = el.querySelectorAll('.ex-item');
    if (existing.length === 0) el.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'ex-item';
    d.style.cssText = 'font-size:11px;padding:4px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start';
    d.innerHTML = `<span style="color:var(--gold);flex-shrink:0">${type==='tasks'?'✅':'⚖️'}</span><span>${esc(text.substring(0,120))}${text.length>120?'…':''}</span>`;
    el.appendChild(d);
  },

  // AI-powered live extraction of tasks (with owners) + decisions, refreshed
  // periodically while recording so the coordinator sees them before the meeting ends.
  async liveExtract() {
    const transcript = (this.fullTranscript || '').trim();
    if (transcript.length < 15) return;
    if (this._extracting) return;
    if (transcript.length === this._lastExtractLen) return;
    this._extracting = true;
    this._lastExtractLen = transcript.length;
    try {
      const members = (App._members || []).map(m => App.lang === 'ar' ? m.name_ar : (m.name_en || m.name_ar));
      const r = await api('/api/live-extract', { method: 'POST', body: JSON.stringify({ transcript, members }) });
      const l = App.lang;
      const tEl = $('ex-tasks'), dEl = $('ex-decs');
      if (tEl) {
        const tasks = r.tasks || [];
        tEl.innerHTML = tasks.length ? tasks.map(t => {
          const txt = l === 'ar' ? t.text_ar : (t.text_en || t.text_ar);
          const own = l === 'ar' ? (t.owner_ar || '') : (t.owner_en || t.owner_ar || '');
          return `<div class="ex-item" style="font-size:11px;padding:5px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start">
            <span style="color:var(--gold);flex-shrink:0">✅</span>
            <span style="flex:1">${esc(txt || '')}${own ? ` <span class="tag tgold" style="font-size:9px">${esc(own)}</span>` : ''}</span></div>`;
        }).join('') : `<div style="font-size:11px;color:var(--text3);font-style:italic">${l === 'ar' ? 'لم تُكتشف مهام بعد...' : 'No tasks detected yet...'}</div>`;
      }
      if (dEl) {
        const decs = r.decisions || [];
        dEl.innerHTML = decs.length ? decs.map(d => {
          const txt = l === 'ar' ? d.text_ar : (d.text_en || d.text_ar);
          return `<div class="ex-item" style="font-size:11px;padding:5px 0;border-bottom:.5px solid var(--border2);color:var(--text);display:flex;gap:6px;align-items:flex-start">
            <span style="color:var(--gold);flex-shrink:0">⚖️</span><span>${esc(txt || '')}</span></div>`;
        }).join('') : `<div style="font-size:11px;color:var(--text3);font-style:italic">${l === 'ar' ? 'لم تُكتشف قرارات بعد...' : 'No decisions detected yet...'}</div>`;
      }
    } catch (e) { /* keyword fallback already shown */ }
    this._extracting = false;
  },

  startWaveform() {
    let t = 0;
    this._wfInt = setInterval(() => {
      t++;
      for (let i = 0; i < 16; i++) {
        const b = $(`w${i}`);
        if (b) {
          const h = this.isRecording ? Math.max(4, Math.abs(Math.sin(t * 0.3 + i * 0.7)) * 28 + Math.random() * 8) : 4;
          b.style.height = h + 'px';
        }
      }
    }, 80);
  },

  stopWaveform() { clearInterval(this._wfInt); for (let i=0;i<16;i++) { const b=$(`w${i}`); if(b) b.style.height='4px'; } },

  saveOnly() {
    if (!this.currentMeetingId) return;
    const t = $('sched-toast') || document.createElement('div');
    t.textContent = App.lang === 'ar' ? '✓ تم الحفظ' : '✓ Saved';
    Panels.load('transcripts');
  },

  async processAI() {
    if (!this.currentMeetingId) return;
    const btn = $('ai-proc-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === 'ar' ? 'أمين يحلل الاجتماع...' : 'Ameen is analysing...'}`;

    try {
      const r = await api(`/api/meetings/${this.currentMeetingId}/process`, { method: 'POST' });
      if (r.result && r.result.title_ar) {
        const ti = $('mtg-title');
        if (ti) ti.value = App.lang === 'ar' ? r.result.title_ar : (r.result.title_en || r.result.title_ar);
      }
      $('ai-res-card').style.display = '';
      $('ai-res-body').innerHTML = this.renderResult(r.result, r.demo);
      await loadBadges();
    } catch (e) {
      $('ai-res-body').innerHTML = `<div style="color:var(--red);padding:10px">${e.message}</div>`;
      $('ai-res-card').style.display = '';
    }

    btn.disabled = false;
    btn.innerHTML = `✦ <span>${App.lang === 'ar' ? 'استخراج المهام والمحضر' : 'Extract Tasks & Minutes'}</span>`;
  },

  renderResult(r, demo) {
    const l = App.lang;
    const lbl = (ar, en) => l === 'ar' ? ar : en;

    // Summary section
    const summary = `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:6px">📋 ${lbl('ملخص الاجتماع','Meeting Summary')}</div>
        <div style="font-size:13px;color:var(--text);line-height:1.7">${esc(l === 'ar' ? r.summary_ar : r.summary_en)}</div>
        ${r.key_topics_ar?.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">${(l==='ar'?r.key_topics_ar:r.key_topics_en||r.key_topics_ar).map(t=>`<span class="tag" style="background:var(--gold-dim);color:var(--gold)">${esc(t)}</span>`).join('')}</div>` : ''}
        ${demo ? `<div class="tag ta" style="margin-top:6px;display:inline-flex">⚠ ${lbl('نتائج تجريبية','Demo results')}</div>` : ''}
      </div>`;

    // Speaker-attributed transcript (Gemini-in-Meet style)
    const speakerTr = r.speaker_transcript || [];
    const speakersHtml = speakerTr.length ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:10px">🗣️ ${lbl('النص حسب المتحدث','Transcript by Speaker')}</div>
        ${speakerTr.map(s => `
          <div style="display:flex;gap:8px;padding:7px 0;border-bottom:.5px solid var(--border2);align-items:flex-start">
            <div style="width:26px;height:26px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(String(s.speaker||'?').split(' ').slice(0,2).map(w=>w[0]).join(''))}</div>
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700;color:var(--gold)">${esc(s.speaker || lbl('متحدث','Speaker'))}</div>
              <div style="font-size:12px;color:var(--text);line-height:1.6">${esc(l==='ar'?(s.text_ar||s.text_en||''):(s.text_en||s.text_ar||''))}</div>
            </div>
          </div>`).join('')}
      </div>` : '';

    // Formal minutes
    const minutes = l === 'ar' ? (r.minutes_ar || '') : (r.minutes_en || r.minutes_ar || '');
    const minutesHtml = minutes ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">📄 ${lbl('محضر الاجتماع الرسمي','Official Meeting Minutes')}</div>
        <div style="font-size:12px;color:var(--text);line-height:1.8;white-space:pre-wrap">${esc(minutes)}</div>
      </div>` : '';

    // Group tasks by owner
    const tasks = r.tasks || [];
    let tasksByOwner = {};
    tasks.forEach(t => {
      const owner = l === 'ar' ? (t.owner_ar || lbl('غير محدد','Unassigned')) : (t.owner_en || t.owner_ar || 'Unassigned');
      if (!tasksByOwner[owner]) tasksByOwner[owner] = [];
      tasksByOwner[owner].push(t);
    });

    const tasksHtml = tasks.length ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:10px">✅ ${lbl('المهام المستخرجة بحسب المسؤول','Extracted Tasks by Owner')} (${tasks.length})</div>
        ${Object.entries(tasksByOwner).map(([owner, ownerTasks]) => `
          <div style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <div style="width:28px;height:28px;border-radius:50%;background:var(--gold-dim);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(owner.split(' ').slice(0,1).map(w=>w[0]).join(''))}</div>
              <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(owner)}</div>
              <span class="tag" style="background:var(--navy4);font-size:10px">${ownerTasks.length} ${lbl('مهمة','task')}</span>
            </div>
            ${ownerTasks.map(t => `
              <div style="display:flex;gap:8px;padding:7px 0 7px 12px;border-bottom:.5px solid var(--border2);align-items:flex-start">
                <div style="width:5px;height:5px;border-radius:50%;background:${t.priority==='urgent'?'var(--red)':'var(--gold)'};margin-top:5px;flex-shrink:0"></div>
                <div style="flex:1;font-size:12px;color:var(--text);line-height:1.6">${esc(l==='ar'?t.text_ar:(t.text_en||t.text_ar))}</div>
                ${t.priority==='urgent'?`<span class="tag tr" style="font-size:10px">${lbl('عاجل','Urgent')}</span>`:''}
                ${t.due?`<span class="tag" style="background:var(--navy4);font-size:10px">${esc(t.due)}</span>`:''}
              </div>`).join('')}
          </div>`).join('')}
      </div>` : '';

    // Decisions
    const decisions = r.decisions || [];
    const decsHtml = decisions.length ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">⚖️ ${lbl('القرارات','Decisions')} (${decisions.length})</div>
        ${decisions.map(d => `
          <div style="display:flex;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)">
            <span style="color:var(--green)">✓</span>
            ${esc(l==='ar'?d.text_ar:(d.text_en||d.text_ar))}
          </div>`).join('')}
      </div>` : '';

    // Follow-ups
    const followups = r.followups || [];
    const fuHtml = followups.length ? `
      <div style="background:var(--navy3);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border2)">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:8px">📌 ${lbl('نقاط المتابعة','Follow-up Points')}</div>
        ${followups.map(f => `
          <div style="display:flex;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border2);font-size:12px;color:var(--text)">
            <span style="color:var(--amber)">→</span>
            ${esc(l==='ar'?f.text_ar:(f.text_en||f.text_ar))}
          </div>`).join('')}
      </div>` : '';

    const mid = Rec.currentMeetingId;
    const shareBtn = mid ? `<button class="btn-gold btn-sm" onclick="Share.open(${mid})">📤 ${lbl('مشاركة النتائج','Share Outcomes')}${App.isPro()?'':' ⭐'}</button>` : '';
    const actions = `
      <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap">
        <button class="btn-ghost btn-sm" onclick="Panels.load('tasks')">📋 ${lbl('عرض المهام','View Tasks')}</button>
        <button class="btn-ghost btn-sm" onclick="Panels.load('transcripts')">📝 ${lbl('المحاضر','Transcripts')}</button>
        ${shareBtn}
      </div>`;

    return summary + speakersHtml + minutesHtml + tasksHtml + decsHtml + fuHtml + actions;
  }
};

// ══ Transcripts ═══════════════════════════════════════════════════════════════
async function renderTranscripts() {
  const body = $('transcripts-body');
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const meetings = await api('/api/meetings');
    const l = App.lang;
    if (!meetings.length) {
      body.innerHTML = `<div class="es"><div class="es-icon">📝</div><div>${l==='ar'?'لا توجد اجتماعات مسجلة بعد':'No recorded meetings yet'}</div></div>`;
      return;
    }
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
      ${meetings.map(m => {
        const title = l==='ar' ? m.title_ar : (m.title_en || m.title_ar);
        const tasks = tryParse(m.ai_tasks, []);
        const decisions = tryParse(m.ai_decisions, []);
        const summary = l==='ar' ? (m.ai_summary_ar||'') : (m.ai_summary_en || m.ai_summary_ar || '');
        const isProcessed = m.status === 'processed';
        return `<div class="card">
          <div class="ch">
            <div>
              <div class="ct" style="display:flex;align-items:center;gap:7px">
                <span id="mtg-title-${m.id}">${esc(title)}</span>
                <button class="btn-ghost btn-sm" style="padding:2px 7px;font-size:11px" title="${l==='ar'?'تعديل العنوان':'Edit title'}" onclick='editMeetingTitle(${m.id}, ${JSON.stringify(m.title_ar||'')}, ${JSON.stringify(m.title_en||m.title_ar||'')})'>✏️</button>
              </div>
              <div class="ctsub">${m.meeting_date?.substring(0,10)||''} ${m.duration ? `· ${Math.floor(m.duration/60)}:${String(m.duration%60).padStart(2,'0')} ${l==='ar'?'دقيقة':'min'}` : ''} · ${esc(m.recorder_ar||'')}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${isProcessed ? `<span class="tag tg">✓ ${l==='ar'?'مُعالج':'Processed'}</span>` : `<span class="tag ta">${l==='ar'?'جديد':'New'}</span>`}
              ${tasks.length ? `<span class="tag tgold">${tasks.length} ${l==='ar'?'مهمة':'tasks'}</span>` : ''}
              ${decisions.length ? `<span class="tag" style="background:var(--navy4)">${decisions.length} ${l==='ar'?'قرار':'decisions'}</span>` : ''}
            </div>
          </div>
          ${summary ? `<div style="font-size:12px;color:var(--text3);line-height:1.6;margin-bottom:10px;padding:0 2px">${esc(summary)}</div>` : ''}
          ${m.transcript ? `<details style="margin-bottom:10px"><summary style="font-size:11px;color:var(--text3);cursor:pointer;padding:4px 0">${l==='ar'?'عرض النص الكامل':'Show full transcript'}</summary><div class="tr-box" style="margin-top:8px;max-height:200px;overflow-y:auto">${esc(m.transcript)}</div></details>` : ''}
          ${tasks.length ? `<div style="margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:5px">✅ ${l==='ar'?'المهام':'Tasks'}</div>
            ${tasks.slice(0,5).map(t=>`<div style="display:flex;gap:7px;padding:4px 0;border-bottom:.5px solid var(--border2);font-size:11px;color:var(--text)">
              <span style="color:var(--gold)">→</span>
              <span style="flex:1">${esc(l==='ar'?t.text_ar:(t.text_en||t.text_ar))}</span>
              ${t.owner_ar ? `<span class="tag tgold" style="font-size:10px">${esc(l==='ar'?t.owner_ar:t.owner_en||t.owner_ar)}</span>` : ''}
            </div>`).join('')}
          </div>` : ''}
          ${isProcessed ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
            ${m.shared ? `<span class="tag tg" style="font-size:10px">📤 ${l==='ar'?'تمت المشاركة':'Shared'}</span>` : ''}
            <button class="btn-gold btn-sm" onclick="Share.open(${m.id})">📤 ${l==='ar'?'مشاركة النتائج':'Share Outcomes'}${App.isPro()?'':' ⭐'}</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  } catch (e) { body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`; }
}

function tryParse(s, def) { try { return JSON.parse(s || '[]'); } catch { return def; } }

async function editMeetingTitle(id, curAr, curEn) {
  const l = App.lang;
  const newAr = prompt(l==='ar' ? 'العنوان بالعربية:' : 'Arabic title:', curAr || '');
  if (newAr === null) return;
  const newEn = prompt(l==='ar' ? 'العنوان بالإنجليزية:' : 'English title:', curEn || newAr);
  if (newEn === null) return;
  const title_ar = newAr.trim();
  const title_en = newEn.trim() || title_ar;
  if (!title_ar) { alert(l==='ar' ? 'العنوان لا يمكن أن يكون فارغاً' : 'Title cannot be empty'); return; }
  try {
    await api('/api/meetings/' + id, { method: 'PATCH', body: JSON.stringify({ title_ar, title_en }) });
    const span = $('mtg-title-' + id);
    if (span) span.textContent = l==='ar' ? title_ar : title_en;
    await renderTranscripts();
  } catch (e) {
    alert((l==='ar' ? 'تعذّر حفظ العنوان: ' : 'Could not save title: ') + e.message);
  }
}

// ══ Tasks ═════════════════════════════════════════════════════════════════════
async function renderTasks() {
  const body = $('tasks-body');
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const [tasks, decisions] = await Promise.all([api('/api/tasks'), api('/api/decisions')]);
    const l = App.lang;

    const overdue = tasks.filter(t => t.status === 'overdue');
    const inprog = tasks.filter(t => t.status === 'inprogress' || t.status === 'new');
    const done = tasks.filter(t => t.status === 'done');

    const renderTask = t => {
      const text = l==='ar' ? t.text_ar : (t.text_en || t.text_ar);
      const owner = l==='ar' ? t.owner_name_ar : (t.owner_name_en || t.owner_name_ar);
      const mtg = l==='ar' ? t.source_meeting_title_ar : (t.source_meeting_title_en || t.source_meeting_title_ar);
      const isOverdue = t.status === 'overdue';
      const isDone = t.status === 'done';
      return `<div class="trow" id="tr-${t.id}">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <input type="checkbox" class="tck" ${isDone?'checked':''} onchange="Tasks.updateStatus(${t.id}, this.checked?'done':'inprogress')" title="${l==='ar'?'تحديث':'Update'}"/>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;color:var(--text);${isDone?'text-decoration:line-through;color:var(--text3)':''}">${esc(text)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
              ${owner ? `<span class="tag tgold">${esc(owner)}</span>` : ''}
              ${isOverdue ? `<span class="tag tr">${l==='ar'?'متأخرة':'Overdue'}</span>` : ''}
              ${t.priority==='urgent' ? `<span class="tag tr">${l==='ar'?'عاجل':'Urgent'}</span>` : ''}
              ${t.due_date ? `<span class="tag" style="background:var(--navy4)">${esc(t.due_date)}</span>` : ''}
              ${mtg ? `<span class="tag" style="background:var(--navy3);color:var(--text3);font-size:10px">📝 ${esc(mtg)}</span>` : ''}
            </div>
          </div>
          <button onclick="Tasks.delete(${t.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0" title="${l==='ar'?'حذف':'Delete'}">✕</button>
        </div>
      </div>`;
    };

    const renderDecision = d => {
      const text = l==='ar' ? d.text_ar : (d.text_en || d.text_ar);
      const mtg = l==='ar' ? d.meeting_title_ar : (d.meeting_title_en || d.meeting_title_ar);
      const isImpl = d.status === 'implemented';
      return `<div class="trow">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <input type="checkbox" class="tck" ${isImpl?'checked':''} onchange="Tasks.updateDecisionStatus(${d.id}, this.checked?'implemented':'active')"/>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;color:var(--text);${isImpl?'text-decoration:line-through;color:var(--text3)':''}">${esc(text)}</div>
            ${mtg ? `<div style="font-size:10px;color:var(--text3);margin-top:3px">📝 ${esc(mtg)}</div>` : ''}
          </div>
          <button onclick="Tasks.deleteDecision(${d.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0">✕</button>
        </div>
      </div>`;
    };

    body.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start">
      <div class="card">
        <div class="ch"><div class="ct">${l==='ar'?'⚠ متأخرة / جديدة':'⚠ Overdue / Open'}</div><span class="tag tr">${overdue.length + inprog.length}</span></div>
        ${overdue.length + inprog.length === 0 ? `<div class="es" style="padding:20px"><div class="es-icon" style="font-size:22px">✓</div><div style="font-size:12px">${l==='ar'?'لا مهام متأخرة':'No overdue tasks'}</div></div>` : [...overdue, ...inprog].map(renderTask).join('')}
      </div>
      <div class="card">
        <div class="ch"><div class="ct">✓ ${l==='ar'?'مكتملة':'Done'}</div><span class="tag tg">${done.length}</span></div>
        ${done.length === 0 ? `<div class="es" style="padding:20px"><div style="font-size:12px;color:var(--text3)">${l==='ar'?'لا مهام مكتملة':'No completed tasks'}</div></div>` : done.map(renderTask).join('')}
      </div>
      <div class="card">
        <div class="ch"><div class="ct">⚖️ ${l==='ar'?'القرارات':'Decisions'}</div><span class="tag" style="background:var(--navy4)">${decisions.length}</span></div>
        ${decisions.length === 0 ? `<div class="es" style="padding:20px"><div style="font-size:12px;color:var(--text3)">${l==='ar'?'لا قرارات':'No decisions'}</div></div>` : decisions.map(renderDecision).join('')}
      </div>
    </div>`;
  } catch (e) { body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`; }
}

// ══ Tasks Actions ═════════════════════════════════════════════════════════════
const Tasks = {
  async updateStatus(id, status) {
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadBadges(); renderTasks(); }
    catch (e) { alert(e.message); }
  },
  async delete(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذه المهمة؟' : 'Delete this task?')) return;
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    document.getElementById('tr-' + id)?.remove();
    await loadBadges();
  },
  async updateDecisionStatus(id, status) {
    await api(`/api/decisions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).catch(() => {});
  },
  async deleteDecision(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذا القرار؟' : 'Delete this decision?')) return;
    await api(`/api/decisions/${id}`, { method: 'DELETE' });
    renderTasks();
  }
};

// ══ Task Modal ════════════════════════════════════════════════════════════════
const Modals = {
  addTask() { $('modal-task').classList.add('open'); },
  close() { $('modal-task').classList.remove('open'); },
  async saveTask() {
    const data = {
      text_ar: $('nt-ar').value.trim(),
      text_en: $('nt-en').value.trim(),
      owner_id: $('nt-owner').value || null,
      due_date: $('nt-due').value,
      priority: $('nt-priority').value,
    };
    if (!data.text_ar) { alert(App.lang === 'ar' ? 'أدخل نص المهمة' : 'Enter task text'); return; }
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(data) });
      this.close();
      await renderTasks();
      await loadBadges();
      ['nt-ar', 'nt-en', 'nt-due'].forEach(id => $(id).value = '');
    } catch (e) { alert(e.message); }
  }
};
$('modal-task').addEventListener('click', e => { if (e.target === $('modal-task')) Modals.close(); });

// ══ Chat ══════════════════════════════════════════════════════════════════════
const Chat = {
  async send() {
    const inp = $('ci'); const text = inp.value.trim(); if (!text) return;
    inp.value = ''; inp.style.height = '';
    this.append(text, true);
    this.showTyping();
    App.chatHistory.push({ role: 'user', content: text });
    try {
      const r = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: App.chatHistory.slice(-10), lang: App.lang }) });
      removeTyping();
      this.append(r.reply, false);
      App.chatHistory.push({ role: 'assistant', content: r.reply });
      if (r.demo) this.showDemoNote();
    } catch (e) {
      removeTyping();
      this.append(App.lang === 'ar' ? 'عذراً، حدث خطأ.' : 'Sorry, an error occurred.', false);
    }
  },
  quick(btn) {
    const q = App.lang === 'ar' ? btn.dataset.qAr : btn.dataset.qEn;
    $('ci').value = q;
    this.send();
  },
  key(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } },
  clear() { App.chatHistory = []; const m = $('chat-msgs'); if (m) { m.innerHTML = ''; m.appendChild(buildWelcomeMsg()); } },
  append(text, isUser) {
    const msgs = $('chat-msgs');
    const chips = $('chat-chips');
    const d = document.createElement('div');
    d.className = 'msg' + (isUser ? ' user' : '');
    const name = App.user ? (App.lang === 'ar' ? App.user.name_ar : App.user.name_en) : '';
    const initials = name.split(' ').slice(0,2).map(w => w[0]).join('') || '?';
    const av = isUser
      ? `<div class="mav">${esc(initials)}</div>`
      : `<div class="mav"><img src="/logo.png" alt="Ameen"/></div>`;
    d.innerHTML = `${av}<div><div class="mb">${esc(text)}</div><div class="mts">${now()}</div></div>`;
    if (chips && msgs.contains(chips)) { msgs.insertBefore(d, chips); }
    else { msgs.appendChild(d); }
    msgs.scrollTop = msgs.scrollHeight;
  },
  showTyping() {
    const msgs = $('chat-msgs');
    const d = document.createElement('div'); d.className = 'msg'; d.id = 'typ';
    d.innerHTML = `<div class="mav"><img src="/logo.png"/></div><div class="mb"><div class="tyd"><span></span><span></span><span></span></div></div>`;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  },
  showDemoNote() {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--amber);padding:6px 10px;background:rgba(201,168,76,.1);border-radius:6px;margin:4px 0;text-align:center';
    note.textContent = App.lang === 'ar' ? '⚠️ رد تجريبي — أضف مفتاح Anthropic API للردود الحقيقية' : '⚠️ Demo reply — Add Anthropic API key for real AI responses';
    $('chat-msgs').appendChild(note);
  }
};
function removeTyping() { $('typ')?.remove(); }
function buildWelcomeMsg() {
  const d = document.createElement('div'); d.className = 'msg'; d.id = 'welcome-msg';
  const txt = App.lang === 'ar'
    ? 'أنا أمين، مساعدكم التنفيذي الذكي. يمكنني تحليل الاجتماعات، متابعة المهام والقرارات، والإجابة على أي سؤال تنفيذي.'
    : "I'm Ameen, your executive AI. I can analyse meetings, track tasks and decisions, and answer any executive question.";
  d.innerHTML = `<div class="mav"><img src="/logo.png" alt="Ameen"/></div><div><div class="mb">${esc(txt)}</div><div class="mts">${now()}</div></div>`;
  return d;
}

// ══ Document Generator ════════════════════════════════════════════════════════
const DocGen = {
  currentContent: '',
  async generate() {
    if (!App.requirePro()) return;
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
      $('doc-toast').style.display = 'flex'; setTimeout(() => $('doc-toast').style.display = 'none', 2500);
    } catch (e) { $('doc-result').innerHTML = `<div style="color:var(--red)">${e.message}</div>`; }
    btn.disabled = false;
    btn.innerHTML = `✦ <span>${App.lang === 'ar' ? 'توليد الوثيقة' : 'Generate Document'}</span>`;
  },
  copy() { if (this.currentContent) { navigator.clipboard.writeText(this.currentContent); alert(App.lang === 'ar' ? '✓ تم النسخ' : '✓ Copied'); } },
  print() { window.print(); }
};

// ══ Schedule ══════════════════════════════════════════════════════════════════
const Schedule = {
  async add() {
    const data = {
      title_ar: $('nm-title-ar').value.trim(),
      title_en: $('nm-title-en').value.trim(),
      meeting_date: $('nm-date').value,
      meeting_time: $('nm-time').value,
      duration_mins: $('nm-dur').value,
      platform: $('nm-plat').value,
      attendees: $('nm-att').value,
      agenda_ar: $('nm-agenda-ar').value,
      agenda_en: $('nm-agenda-en').value,
      reminder_channel: ($('nm-channel') && $('nm-channel').value) || 'email',
    };
    if (!data.title_ar || !data.meeting_date || !data.meeting_time) {
      alert(App.lang === 'ar' ? 'يرجى إدخال العنوان والتاريخ والوقت' : 'Please enter title, date and time');
      return;
    }
    try {
      await api('/api/schedule', { method: 'POST', body: JSON.stringify(data) });
      $('sched-toast').style.display = 'flex'; setTimeout(() => $('sched-toast').style.display = 'none', 2500);
      await renderSchedule();
      await loadBadges();
      ['nm-title-ar', 'nm-title-en', 'nm-att', 'nm-agenda-ar', 'nm-agenda-en'].forEach(id => $(id).value = '');
    } catch (e) { alert(e.message); }
  },
  async delete(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذا الاجتماع من الجدول؟' : 'Remove from schedule?')) return;
    await api(`/api/schedule/${id}`, { method: 'DELETE' });
    await renderSchedule();
    await loadBadges();
  },
  openReminder(id, titleAr, titleEn, date, time, platform, attendees, agendaAr, agendaEn) {
    const l = App.lang;
    const title = l === 'ar' ? titleAr : (titleEn || titleAr);
    const agenda = l === 'ar' ? (agendaAr || agendaEn) : (agendaEn || agendaAr);
    const dt = date && time ? `${date} ${l === 'ar' ? 'الساعة' : 'at'} ${time}` : (date || '');
    const subj = l === 'ar' ? `تذكير: ${title} — ${dt}` : `Reminder: ${title} — ${dt}`;
    const body = l === 'ar'
      ? `السلام عليكم ورحمة الله وبركاته،\n\nيسعدنا تذكيركم بموعد اجتماع:\n\n📌 ${title}\n📅 ${dt}\n📍 ${platform || ''}\n\n${agenda ? `جدول الأعمال:\n${agenda}\n\n` : ''}نرجو حضوركم في الموعد المحدد.\n\nمع التحية،\nفريق أمين للذكاء الاصطناعي`
      : `Dear Team,\n\nThis is a reminder for the upcoming meeting:\n\n📌 ${title}\n📅 ${dt}\n📍 ${platform || ''}\n\n${agenda ? `Agenda:\n${agenda}\n\n` : ''}Please attend at the scheduled time.\n\nBest regards,\nAmeen AI Team`;
    EmailReminder.open(subj, body, attendees || '');
  }
};

async function renderSchedule() {
  const el = $('sched-items');
  el.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const items = await api('/api/schedule');
    const l = App.lang;
    if (!items.length) {
      el.innerHTML = `<div class="es" style="padding:20px"><div class="es-icon">📅</div><div>${l==='ar'?'لا اجتماعات مجدولة':'No scheduled meetings'}</div></div>`;
      return;
    }
    const today = new Date().toISOString().substring(0,10);
    el.innerHTML = items.map(s => {
      const title = l==='ar' ? s.title_ar : (s.title_en || s.title_ar);
      const isUpcoming = s.meeting_date >= today;
      const agenda = l==='ar' ? (s.agenda_ar || s.agenda_en) : (s.agenda_en || s.agenda_ar);
      const reminderCall = `Schedule.openReminder(${s.id},${JSON.stringify(s.title_ar)},${JSON.stringify(s.title_en||'')},${JSON.stringify(s.meeting_date||'')},${JSON.stringify(s.meeting_time||'')},${JSON.stringify(s.platform||'')},${JSON.stringify(s.attendees||'')},${JSON.stringify(s.agenda_ar||'')},${JSON.stringify(s.agenda_en||'')})`;
      return `<div style="padding:13px 0;border-bottom:1px solid var(--border2)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(title)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">
              📅 ${esc(s.meeting_date||'')} ${s.meeting_time ? `🕐 ${esc(s.meeting_time)}` : ''} · ${s.duration_mins||60} ${l==='ar'?'د':'min'} · ${esc(s.platform||'')}
            </div>
            ${s.attendees ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">👥 ${esc(s.attendees)}</div>` : ''}
            ${agenda ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">📋 ${esc(agenda.substring(0,80))}${agenda.length>80?'…':''}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
            ${isUpcoming ? `<span class="tag tg" style="font-size:10px">${l==='ar'?'قادم':'Upcoming'}</span>` : `<span class="tag" style="background:var(--navy4);font-size:10px">${l==='ar'?'مضى':'Past'}</span>`}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn-ghost btn-sm" onclick="${reminderCall}" style="font-size:11px">📧 ${l==='ar'?'إرسال تذكير':'Send Reminder'}</button>
          <button class="btn-ghost btn-sm" onclick="Schedule.delete(${s.id})" style="font-size:11px;color:var(--red)">✕ ${l==='ar'?'حذف':'Delete'}</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:10px">${e.message}</div>`; }
}

// ══ Share Outcomes (PRO) ══════════════════════════════════════════════════════
const Share = {
  meetingId: null,

  async open(meetingId) {
    if (!App.requirePro()) return;
    this.meetingId = meetingId;
    const box = $('share-attendees');
    box.innerHTML = `<div style="font-size:11px;color:var(--text3)">${App.lang==='ar'?'جارٍ التحميل...':'Loading...'}</div>`;
    $('share-status').style.display = 'none';
    $('modal-share').classList.add('open');
    App.applyLang(App.lang);
    try {
      const rows = await api(`/api/meetings/${meetingId}/attendees`);
      box.innerHTML = '';
      if (rows && rows.length) rows.forEach(r => this.addRow(r));
      else {
        // Seed from team members so the coordinator can pick from them.
        const members = App._members || [];
        if (members.length) members.slice(0, 6).forEach(m => this.addRow({ name: App.lang==='ar'?m.name_ar:(m.name_en||m.name_ar), email: m.email || '', phone: m.phone || '', include: false }));
        else this.addRow();
      }
    } catch (e) { box.innerHTML = ''; this.addRow(); }
  },

  addRow(r = {}) {
    const box = $('share-attendees');
    const l = App.lang;
    const row = document.createElement('div');
    row.className = 'share-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--navy3);border:1px solid var(--border2);border-radius:9px;padding:8px';
    row.innerHTML = `
      <input type="checkbox" class="sa-inc" ${r.include===false?'':'checked'} title="${l==='ar'?'مشاركة معه':'Share with'}" style="width:17px;height:17px;flex-shrink:0;accent-color:var(--gold)">
      <input class="fi sa-name" placeholder="${l==='ar'?'الاسم':'Name'}" value="${esc(r.name||'')}" style="flex:1;min-width:110px">
      <input class="fi sa-email" type="email" placeholder="${l==='ar'?'البريد':'Email'}" value="${esc(r.email||'')}" style="flex:1.3;min-width:140px">
      <input class="fi sa-phone" type="tel" placeholder="${l==='ar'?'الجوال (واتساب)':'Phone (WhatsApp)'}" value="${esc(r.phone||'')}" style="flex:1;min-width:120px">
      <button class="btn-ghost btn-sm" onclick="this.closest('.share-row').remove()" style="color:var(--red);flex-shrink:0">✕</button>`;
    box.appendChild(row);
  },

  collect() {
    return [...document.querySelectorAll('#share-attendees .share-row')].map(row => ({
      include: row.querySelector('.sa-inc').checked,
      name: row.querySelector('.sa-name').value.trim(),
      email: row.querySelector('.sa-email').value.trim(),
      phone: row.querySelector('.sa-phone').value.trim(),
    })).filter(a => a.name || a.email || a.phone);
  },

  status(msg, ok) {
    const el = $('share-status');
    el.style.display = 'block';
    el.style.background = ok ? 'var(--green-dim,rgba(34,197,94,.12))' : 'rgba(239,68,68,.12)';
    el.style.color = ok ? 'var(--green,#22c55e)' : 'var(--red)';
    el.textContent = msg;
  },

  async send() {
    const l = App.lang;
    const attendees = this.collect();
    const recipients = attendees.filter(a => a.include);
    if (!recipients.length) { this.status(l==='ar'?'اختر حاضراً واحداً على الأقل':'Select at least one attendee', false); return; }
    if (recipients.some(a => !a.name))
      { this.status(l==='ar'?'كل حاضر مُختار يجب أن يكون له اسم':'Every selected attendee needs a name', false); return; }
    const channel = $('share-channel').value;
    if (channel !== 'whatsapp' && recipients.some(a => a.include && !a.email))
      { this.status(l==='ar'?'بعض الحضور بلا بريد إلكتروني':'Some attendees are missing an email', false); return; }
    if (channel !== 'email' && recipients.some(a => a.include && !a.phone))
      { this.status(l==='ar'?'بعض الحضور بلا رقم جوال':'Some attendees are missing a phone number', false); return; }

    const btn = $('share-send-btn'); btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<span class="loading"></span> ${l==='ar'?'جارٍ الإرسال...':'Sending...'}`;
    try {
      // Persist the full contact list, then share only with the included subset
      // (the coordinator's audience filter — feature #7).
      const saved = await api(`/api/meetings/${this.meetingId}/attendees`, { method: 'POST', body: JSON.stringify({ attendees }) });
      // Map included recipients to stable DB ids via a full composite key
      // (name|email|phone) so same-name attendees are never over-shared.
      const key = a => `${(a.name||'').trim()}|${(a.email||'').trim()}|${(a.phone||'').trim()}`;
      const includedKeys = new Set(recipients.map(key));
      const attendee_ids = (saved || []).filter(s => includedKeys.has(key(s))).map(s => s.id);
      if (!attendee_ids.length) { this.status(l==='ar'?'تعذّر تحديد المستلمين':'Could not resolve recipients', false); btn.disabled=false; btn.innerHTML=orig; return; }
      const r = await api(`/api/meetings/${this.meetingId}/share`, { method: 'POST', body: JSON.stringify({ channel, attendee_ids }) });
      const sent = r.shared != null ? r.shared : recipients.length;
      this.status(l==='ar'?`✓ تمت المشاركة وإرسال ${sent} رابط`:`✓ Shared & sent ${sent} link(s)`, true);
      if (document.querySelector('.nb.active')?.dataset.p === 'transcripts') await renderTranscripts();
      setTimeout(() => this.close(), 1600);
    } catch (e) { this.status((l==='ar'?'تعذّر الإرسال: ':'Send failed: ') + e.message, false); }
    btn.disabled = false; btn.innerHTML = orig;
  },

  close() { $('modal-share').classList.remove('open'); },
};

// ══ Email Reminder ════════════════════════════════════════════════════════════
const EmailReminder = {
  open(subject, body, to) {
    $('email-to').value = to || '';
    $('email-subject').value = subject || '';
    $('email-body').value = body || '';
    $('email-status').style.display = 'none';
    $('smtp-note').style.display = 'none';
    $('modal-email').classList.add('open');
  },
  close() { $('modal-email').classList.remove('open'); },
  async send() {
    const btn = $('email-send-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="loading"></span> ${App.lang === 'ar' ? 'جارٍ الإرسال...' : 'Sending...'}`;
    const status = $('email-status');
    try {
      const r = await api('/api/email/send', { method: 'POST', body: JSON.stringify({
        to: $('email-to').value,
        subject: $('email-subject').value,
        body: $('email-body').value,
      })});
      status.style.display = 'block';
      status.style.cssText = 'display:block;padding:9px 12px;border-radius:8px;font-size:12px;margin-top:4px;background:rgba(77,200,140,.1);color:var(--green)';
      status.textContent = `✓ ${App.lang === 'ar' ? `تم الإرسال إلى ${r.sent_to} مستلم` : `Sent to ${r.sent_to} recipient(s)`}`;
      setTimeout(() => this.close(), 2000);
    } catch (e) {
      if (e.message === 'SMTP_NOT_CONFIGURED' || e.message?.includes('SMTP')) {
        status.style.display = 'block';
        status.style.cssText = 'display:block;padding:9px 12px;border-radius:8px;font-size:12px;margin-top:4px;background:rgba(201,168,76,.08);color:var(--amber)';
        status.textContent = App.lang === 'ar' ? '⚙️ لم يتم إعداد البريد الإلكتروني بعد' : '⚙️ Email not configured yet';
        $('smtp-note').style.display = 'block';
      } else {
        status.style.display = 'block';
        status.style.cssText = 'display:block;padding:9px 12px;border-radius:8px;font-size:12px;margin-top:4px;background:rgba(224,90,90,.1);color:var(--red)';
        status.textContent = e.message;
      }
    }
    btn.disabled = false;
    btn.innerHTML = `📧 <span>${App.lang === 'ar' ? 'إرسال' : 'Send'}</span>`;
  }
};
$('modal-email').addEventListener('click', e => { if (e.target === $('modal-email')) EmailReminder.close(); });

// ══ Team Management ═══════════════════════════════════════════════════════════
const Team = {
  editingId: null,

  async load() {
    const body = $('team-body');
    body.innerHTML = '<div class="es"><div class="loading"></div></div>';
    try {
      const [members, tasks] = await Promise.all([api('/api/members'), api('/api/tasks')]);
      body.innerHTML = this.render(members, tasks);
    } catch (e) { body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`; }
  },

  render(members, tasks) {
    const l = App.lang;
    if (!members.length) return `<div class="es"><div class="es-icon">👥</div><div>${l==='ar'?'لا يوجد أعضاء فريق — اضغط إضافة عضو':'No team members — click Add Member'}</div></div>`;

    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">
      ${members.map(m => {
        const name = l==='ar' ? m.name_ar : (m.name_en || m.name_ar);
        const role = l==='ar' ? (m.role_ar || '') : (m.role_en || m.role_ar || '');
        const initials = name.split(' ').slice(0,2).map(w => w[0]).join('').substring(0,2);
        const memberTasks = tasks.filter(t => t.owner_name_ar === m.name_ar || t.owner_name_en === m.name_en);
        const doneTasks = memberTasks.filter(t => t.status === 'done').length;
        const overdueTasks = memberTasks.filter(t => t.status === 'overdue').length;
        const inProgTasks = memberTasks.filter(t => t.status === 'inprogress' || t.status === 'new').length;
        const completion = memberTasks.length > 0 ? Math.round((doneTasks / memberTasks.length) * 100) : 0;
        return `<div class="card" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:50px;height:50px;border-radius:50%;background:var(--gold-dim);border:2px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:var(--gold);flex-shrink:0">${esc(initials)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:600;color:var(--text)">${esc(name)}</div>
              ${m.name_en && l === 'ar' ? `<div style="font-size:11px;color:var(--text3)">${esc(m.name_en)}</div>` : ''}
              <div style="font-size:11px;color:var(--gold)">${esc(role || (l==='ar'?'عضو فريق':'Team Member'))}</div>
              <div style="font-size:11px;color:var(--text3);direction:ltr;text-align:${l==='ar'?'right':'left'}">${esc(m.email)}</div>
            </div>
          </div>
          ${memberTasks.length > 0 ? `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:5px">
              <span>${l==='ar'?'الإنجاز':'Completion'}</span><span>${completion}%</span>
            </div>
            <div style="height:4px;background:var(--navy4);border-radius:4px;overflow:hidden">
              <div style="height:100%;background:${completion===100?'var(--green)':completion>50?'var(--gold)':'var(--amber)'};width:${completion}%;border-radius:4px;transition:.3s"></div>
            </div>
          </div>` : ''}
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${overdueTasks ? `<span class="tag tr">${overdueTasks} ${l==='ar'?'متأخرة':'overdue'}</span>` : ''}
            ${inProgTasks ? `<span class="tag ta">${inProgTasks} ${l==='ar'?'جارٍ':'in progress'}</span>` : ''}
            ${doneTasks ? `<span class="tag tg">${doneTasks} ${l==='ar'?'مكتملة':'done'}</span>` : ''}
            ${!memberTasks.length ? `<span class="tag" style="background:var(--navy4);font-size:10px">${l==='ar'?'لا مهام مسندة':'No tasks assigned'}</span>` : ''}
          </div>
          <div style="display:flex;gap:7px;border-top:1px solid var(--border2);padding-top:10px">
            <button class="btn-ghost btn-sm" onclick="Team.edit(${m.id})" style="flex:1;font-size:11px">✏️ ${l==='ar'?'تعديل':'Edit'}</button>
            <button class="btn-ghost btn-sm" onclick="Team.delete(${m.id})" style="color:var(--red);font-size:11px">✕ ${l==='ar'?'حذف':'Delete'}</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  },

  showAdd() {
    this.editingId = null;
    const title = $('member-modal-title');
    title.textContent = App.lang === 'ar' ? 'إضافة عضو جديد' : 'Add New Member';
    ['m-name-ar', 'm-name-en', 'm-email', 'm-role-ar', 'm-role-en'].forEach(id => $(id).value = '');
    $('modal-member').classList.add('open');
  },

  async edit(id) {
    try {
      const members = await api('/api/members');
      const m = members.find(x => x.id === id);
      if (!m) return;
      this.editingId = id;
      $('member-modal-title').textContent = App.lang === 'ar' ? 'تعديل بيانات العضو' : 'Edit Member';
      $('m-name-ar').value = m.name_ar || '';
      $('m-name-en').value = m.name_en || '';
      $('m-email').value = m.email || '';
      $('m-role-ar').value = m.role_ar || '';
      $('m-role-en').value = m.role_en || '';
      $('modal-member').classList.add('open');
    } catch (e) { alert(e.message); }
  },

  closeModal() { $('modal-member').classList.remove('open'); },

  async save() {
    const data = {
      name_ar: $('m-name-ar').value.trim(),
      name_en: $('m-name-en').value.trim(),
      email: $('m-email').value.trim(),
      role_ar: $('m-role-ar').value.trim(),
      role_en: $('m-role-en').value.trim(),
    };
    if (!data.name_ar || !data.email) {
      alert(App.lang === 'ar' ? 'الاسم بالعربي والبريد الإلكتروني مطلوبان' : 'Arabic name and email are required');
      return;
    }
    try {
      if (this.editingId) {
        await api(`/api/members/${this.editingId}`, { method: 'PATCH', body: JSON.stringify(data) });
      } else {
        await api('/api/members', { method: 'POST', body: JSON.stringify(data) });
      }
      this.closeModal();
      await this.load();
      await loadSelectLists();
      await loadBadges();
    } catch (e) { alert(e.message); }
  },

  async delete(id) {
    if (!confirm(App.lang === 'ar' ? 'حذف هذا العضو من الفريق؟' : 'Delete this team member?')) return;
    try {
      await api(`/api/members/${id}`, { method: 'DELETE' });
      await this.load();
      await loadSelectLists();
      await loadBadges();
    } catch (e) { alert(e.message); }
  }
};
$('modal-member').addEventListener('click', e => { if (e.target === $('modal-member')) Team.closeModal(); });

// ══ Overview / Dashboard ══════════════════════════════════════════════════════
async function renderOverview() {
  const body = $('overview-body');
  body.innerHTML = '<div class="es"><div class="loading"></div></div>';
  try {
    const [stats, tasks, meetings, schedule, members] = await Promise.all([
      api('/api/stats'), api('/api/tasks'), api('/api/meetings'),
      api('/api/schedule'), api('/api/members')
    ]);
    const l = App.lang;
    const lbl = (ar, en) => l === 'ar' ? ar : en;
    const today = new Date().toISOString().substring(0,10);
    const upcoming = schedule.filter(s => s.meeting_date >= today);

    const statCards = [
      { icon:'🎙', val: stats.meetings, label: lbl('اجتماع مسجل','Recorded Meetings'), color:'var(--gold)', go:'transcripts' },
      { icon:'📋', val: stats.tasks_open, label: lbl('مهمة مفتوحة','Open Tasks'), color: stats.tasks_overdue>0?'var(--red)':'var(--amber)', go:'tasks' },
      { icon:'⚠️', val: stats.tasks_overdue, label: lbl('مهمة متأخرة','Overdue Tasks'), color:'var(--red)', go:'tasks' },
      { icon:'✓', val: stats.tasks_done, label: lbl('مهمة مكتملة','Completed Tasks'), color:'var(--green)', go:'tasks' },
      { icon:'⚖️', val: stats.decisions, label: lbl('قرار مسجل','Decisions'), color:'var(--blue)', go:'transcripts' },
      { icon:'📅', val: stats.schedule, label: lbl('اجتماع مجدول','Scheduled'), color:'var(--gold)', go:'schedule' },
      { icon:'👥', val: stats.users, label: lbl('عضو فريق','Team Members'), color:'var(--text)', go:'team' },
      { icon:'🎯', val: stats.completion+'%', label: lbl('نسبة الإنجاز','Completion Rate'), color: stats.completion>70?'var(--green)':stats.completion>40?'var(--amber)':'var(--red)', go:'tasks' },
    ];

    // Task breakdown by member
    const memberBreakdown = members.map(m => {
      const mt = tasks.filter(t => t.owner_name_ar === m.name_ar);
      const done = mt.filter(t => t.status === 'done').length;
      return { name: l==='ar' ? m.name_ar : (m.name_en || m.name_ar), total: mt.length, done, pct: mt.length ? Math.round(done/mt.length*100) : 0 };
    }).filter(x => x.total > 0).sort((a,b) => b.total - a.total);

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        ${statCards.map(s => `<div class="card stat-clickable" style="text-align:center;padding:18px 10px;cursor:pointer" onclick="Panels.load('${s.go}')" title="${esc(s.label)}">
          <div style="font-size:26px;margin-bottom:4px">${s.icon}</div>
          <div style="font-size:28px;font-weight:800;color:${s.color}">${s.val}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${s.label}</div>
        </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card">
          <div class="ct" style="margin-bottom:12px">👥 ${lbl('أداء الفريق','Team Performance')}</div>
          ${memberBreakdown.length ? memberBreakdown.map(m => `
            <div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text);margin-bottom:4px">
                <span>${esc(m.name)}</span>
                <span style="color:${m.pct===100?'var(--green)':m.pct>50?'var(--gold)':'var(--amber)'}">${m.done}/${m.total} (${m.pct}%)</span>
              </div>
              <div style="height:6px;background:var(--navy4);border-radius:6px;overflow:hidden">
                <div style="height:100%;background:${m.pct===100?'var(--green)':m.pct>50?'var(--gold)':'var(--amber)'};width:${m.pct}%;border-radius:6px;transition:.4s"></div>
              </div>
            </div>`).join('') : `<div style="font-size:12px;color:var(--text3)">${lbl('لا توجد مهام مسندة','No tasks assigned')}</div>`}
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:12px">📅 ${lbl('الاجتماعات القادمة','Upcoming Meetings')}</div>
          ${upcoming.length ? upcoming.slice(0,5).map(s => `
            <div style="padding:8px 0;border-bottom:.5px solid var(--border2)">
              <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(l==='ar'?s.title_ar:(s.title_en||s.title_ar))}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">📅 ${esc(s.meeting_date||'')} ${s.meeting_time?'🕐 '+esc(s.meeting_time):''} · ${esc(s.platform||'')}</div>
            </div>`).join('')
          : `<div style="font-size:12px;color:var(--text3)">${lbl('لا اجتماعات قادمة','No upcoming meetings')}</div>`}
        </div>
      </div>
      ${tasks.filter(t=>t.status==='overdue').length ? `
      <div class="card" style="margin-top:14px">
        <div class="ct" style="color:var(--red);margin-bottom:10px">⚠ ${lbl('المهام المتأخرة الفورية','Urgent Overdue Tasks')}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">
          ${tasks.filter(t=>t.status==='overdue').slice(0,6).map(t => `
            <div style="background:var(--navy3);border-radius:8px;padding:10px;border:1px solid rgba(224,90,90,.2)">
              <div style="font-size:12px;color:var(--text);margin-bottom:4px">${esc(l==='ar'?t.text_ar:(t.text_en||t.text_ar))}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                ${t.owner_name_ar?`<span class="tag tgold" style="font-size:10px">${esc(l==='ar'?t.owner_name_ar:t.owner_name_en||t.owner_name_ar)}</span>`:''}
                ${t.due_date?`<span class="tag tr" style="font-size:10px">${esc(t.due_date)}</span>`:''}
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
  } catch (e) { body.innerHTML = `<div class="es" style="color:var(--red)">${e.message}</div>`; }
}

// ══ Textarea auto-resize ══════════════════════════════════════════════════════
$('ci').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});

// ══ Bootstrap ══════════════════════════════════════════════════════════════════
window.__AMEEN_READY = true;
App.init();
