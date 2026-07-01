const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'ameen.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role_ar TEXT DEFAULT 'عضو',
    role_en TEXT DEFAULT 'Member',
    lang_pref TEXT DEFAULT 'ar',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_ar TEXT NOT NULL,
    title_en TEXT,
    transcript TEXT DEFAULT '',
    duration INTEGER DEFAULT 0,
    recorded_by INTEGER,
    ai_summary_ar TEXT,
    ai_summary_en TEXT,
    ai_tasks TEXT DEFAULT '[]',
    ai_decisions TEXT DEFAULT '[]',
    ai_reminders TEXT DEFAULT '[]',
    ai_followups TEXT DEFAULT '[]',
    ai_sentiment TEXT DEFAULT 'neutral',
    speakers TEXT DEFAULT '[]',
    status TEXT DEFAULT 'draft',
    meeting_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(recorded_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text_ar TEXT NOT NULL,
    text_en TEXT,
    owner_id INTEGER,
    owner_name_ar TEXT,
    owner_name_en TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'new',
    source_meeting_id INTEGER,
    source_meeting_title_ar TEXT,
    source_meeting_title_en TEXT,
    notes TEXT DEFAULT '',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_meeting_id) REFERENCES meetings(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text_ar TEXT NOT NULL,
    text_en TEXT,
    meeting_id INTEGER,
    meeting_title_ar TEXT,
    meeting_title_en TEXT,
    status TEXT DEFAULT 'active',
    decided_by TEXT,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id)
  );

  CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_ar TEXT NOT NULL,
    title_en TEXT,
    meeting_date TEXT NOT NULL,
    meeting_time TEXT NOT NULL,
    duration_mins INTEGER DEFAULT 60,
    platform TEXT DEFAULT 'قاعة الاجتماعات',
    attendees TEXT DEFAULT '',
    agenda_ar TEXT DEFAULT '',
    agenda_en TEXT DEFAULT '',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS correspondence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    to_name TEXT,
    subject_ar TEXT,
    subject_en TEXT,
    content TEXT,
    lang TEXT DEFAULT 'ar',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title_ar TEXT,
    title_en TEXT,
    content TEXT,
    source_meeting_id INTEGER,
    lang TEXT DEFAULT 'ar',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_meeting_id) REFERENCES meetings(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
`);

// ── Lightweight migrations: add columns if missing ──────────────────────────
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('meetings', 'ai_minutes_ar', 'TEXT');
ensureColumn('meetings', 'ai_minutes_en', 'TEXT');
ensureColumn('meetings', 'speaker_transcript', "TEXT DEFAULT '[]'");
ensureColumn('meetings', 'shared', 'INTEGER DEFAULT 0');
ensureColumn('meetings', 'shared_at', 'DATETIME');
ensureColumn('schedule', 'reminder_sent', 'INTEGER DEFAULT 0');
ensureColumn('schedule', 'reminder_email', 'TEXT');
ensureColumn('schedule', 'reminder_channel', "TEXT DEFAULT 'email'");
ensureColumn('tasks', 'confirm_token', 'TEXT');
ensureColumn('tasks', 'task_reminder_sent', 'INTEGER DEFAULT 0');
ensureColumn('tasks', 'assignee_email', 'TEXT');
ensureColumn('tasks', 'confirmed', 'INTEGER DEFAULT 0');
ensureColumn('tasks', 'confirmed_at', 'DATETIME');
ensureColumn('tasks', 'assignee_email', 'TEXT');
ensureColumn('tasks', 'assignee_phone', 'TEXT');
// Pending-Review flag for AI-extracted tasks the model was unsure about.
ensureColumn('tasks', 'needs_review', 'INTEGER DEFAULT 0');
// Draft vs confirmed scheduling, and the meeting a draft was auto-created from.
ensureColumn('schedule', 'status', "TEXT DEFAULT 'confirmed'");
ensureColumn('schedule', 'source_meeting_id', 'INTEGER');
ensureColumn('meetings', 'meeting_type', "TEXT DEFAULT ''");
ensureColumn('schedule', 'meeting_type', "TEXT DEFAULT ''");
ensureColumn('meeting_attendees', 'role', "TEXT DEFAULT 'Member'");
ensureColumn('meeting_attendees', 'attendance_status', "TEXT DEFAULT 'pending'");
ensureColumn('meetings', 'board_id', 'INTEGER');
ensureColumn('meetings', 'committee_id', 'INTEGER');
ensureColumn('schedule', 'board_id', 'INTEGER');
ensureColumn('schedule', 'committee_id', 'INTEGER');
ensureColumn('meeting_documents', 'uploaded_by', "TEXT DEFAULT ''");
ensureColumn('meeting_documents', 'upload_date', "TEXT DEFAULT ''");
ensureColumn('meeting_documents', 'description', "TEXT DEFAULT ''");
ensureColumn('meeting_documents', 'status', "TEXT DEFAULT 'draft'");
ensureColumn('meetings', 'ai_risks', "TEXT DEFAULT '[]'");
ensureColumn('schedule', 'prev_meeting_id', 'INTEGER');
ensureColumn('users', 'system_role', "TEXT DEFAULT 'Admin'");
ensureColumn('meeting_documents', 'file_path', "TEXT DEFAULT ''");
ensureColumn('meeting_documents', 'file_size', 'INTEGER DEFAULT 0');
ensureColumn('meeting_documents', 'file_type', "TEXT DEFAULT ''");
ensureColumn('meeting_documents', 'ai_summary', "TEXT DEFAULT ''");
ensureColumn('meeting_documents', 'ai_key_points', "TEXT DEFAULT '[]'");
ensureColumn('meeting_documents', 'doc_classification', "TEXT DEFAULT ''");
ensureColumn('schedule', 'recurrence', "TEXT DEFAULT 'none'");
ensureColumn('schedule', 'recurrence_group_id', 'TEXT');

// Minutes Approval Workflow columns
ensureColumn('meetings', 'minutes_status', "TEXT DEFAULT 'draft'");
ensureColumn('meetings', 'minutes_version', 'INTEGER DEFAULT 1');
ensureColumn('meetings', 'circulated_at', 'DATETIME');
ensureColumn('meetings', 'circulated_by', 'INTEGER');
ensureColumn('meetings', 'approved_by', 'INTEGER');
ensureColumn('meetings', 'approved_at', 'DATETIME');
ensureColumn('meetings', 'final_approved_by', 'INTEGER');
ensureColumn('meetings', 'final_approved_at', 'DATETIME');
ensureColumn('meetings', 'approval_due_date', 'TEXT');
ensureColumn('meetings', 'approval_comments', 'TEXT');

// ── Meeting provider / cloud integration architecture columns ─────────────────
ensureColumn('schedule', 'meeting_provider',    "TEXT DEFAULT 'physical'");
ensureColumn('schedule', 'meeting_join_url',    "TEXT DEFAULT ''");
ensureColumn('schedule', 'meeting_id_external', "TEXT DEFAULT ''");
ensureColumn('schedule', 'recording_status',    "TEXT DEFAULT 'not_started'");
ensureColumn('schedule', 'recording_provider',  "TEXT DEFAULT ''");
ensureColumn('schedule', 'recording_url',       "TEXT DEFAULT ''");
ensureColumn('schedule', 'transcript_provider', "TEXT DEFAULT ''");

// ── Recording storage and approval columns ────────────────────────────────────
ensureColumn('meetings', 'audio_recording_url',       "TEXT DEFAULT ''");
ensureColumn('meetings', 'video_recording_url',       "TEXT DEFAULT ''");
ensureColumn('meetings', 'recording_file_name',       "TEXT DEFAULT ''");
ensureColumn('meetings', 'recording_file_size',       'INTEGER DEFAULT 0');
ensureColumn('meetings', 'recording_uploaded_at',     'DATETIME');
ensureColumn('meetings', 'recording_verified_by',     'INTEGER');
ensureColumn('meetings', 'recording_verified_at',     'DATETIME');
ensureColumn('meetings', 'recording_approval_status', "TEXT DEFAULT 'none'");

// ── Recording governance columns (capture type, scope, lifecycle) ─────────────
ensureColumn('meetings', 'recording_started_by',   'INTEGER');
ensureColumn('meetings', 'recording_started_at',   'DATETIME');
ensureColumn('meetings', 'recording_stopped_at',   'DATETIME');
ensureColumn('meetings', 'recording_capture_type', "TEXT DEFAULT 'browser_microphone'");
ensureColumn('meetings', 'recording_source',       "TEXT DEFAULT ''");
ensureColumn('meetings', 'recording_scope',        "TEXT DEFAULT 'unknown'");
ensureColumn('meetings', 'recording_status',       "TEXT DEFAULT 'not_started'");
ensureColumn('meetings', 'recording_notes',        "TEXT DEFAULT ''");

// Minutes approval audit log
db.exec(`
  CREATE TABLE IF NOT EXISTS minutes_approval_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_id INTEGER,
    actor_name TEXT,
    actor_role TEXT,
    comments TEXT,
    version INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
  )
`);

// Resolution per-user vote tracking
db.exec(`CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resolution_id INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,
  voter_name TEXT DEFAULT '',
  voter_role TEXT DEFAULT '',
  vote TEXT NOT NULL,
  comments TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resolution_id, voter_id),
  FOREIGN KEY (resolution_id) REFERENCES resolutions(id) ON DELETE CASCADE
)`);
ensureColumn('resolutions', 'voting_status', "TEXT DEFAULT 'draft'");

// ── General Assembly dedicated tables ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS ga_shareholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ga_schedule_id INTEGER NOT NULL,
    name_ar TEXT,
    name_en TEXT NOT NULL,
    shares INTEGER DEFAULT 0,
    share_pct REAL DEFAULT 0,
    vote_rights INTEGER DEFAULT 0,
    attendance_status TEXT DEFAULT 'pending',
    proxy_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ga_schedule_id) REFERENCES schedule(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS ga_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ga_schedule_id INTEGER NOT NULL,
    motion_ar TEXT,
    motion_en TEXT NOT NULL,
    votes_for INTEGER DEFAULT 0,
    votes_against INTEGER DEFAULT 0,
    votes_abstain INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    passed INTEGER DEFAULT 0,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ga_schedule_id) REFERENCES schedule(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS ga_officers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ga_schedule_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    role_ar TEXT,
    name_ar TEXT,
    name_en TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ga_schedule_id) REFERENCES schedule(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS ga_minutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ga_schedule_id INTEGER NOT NULL UNIQUE,
    status TEXT DEFAULT 'draft',
    draft_date TEXT,
    circulated_date TEXT,
    approved_date TEXT,
    final_date TEXT,
    draft_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ga_schedule_id) REFERENCES schedule(id) ON DELETE CASCADE
  );
`);

// Task progress history
db.exec(`
  CREATE TABLE IF NOT EXISTS task_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    author_id INTEGER,
    author_name TEXT,
    author_role TEXT,
    update_text TEXT NOT NULL,
    status_snapshot TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`);

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Key/value settings (e.g. subscription plan)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS meeting_attendees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    share_token TEXT UNIQUE,
    shared INTEGER DEFAULT 0,
    confirmed INTEGER DEFAULT 0,
    confirmed_at DATETIME,
    comment TEXT DEFAULT '',
    responded_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id)
  );

  CREATE TABLE IF NOT EXISTS agenda_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    schedule_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    presenter TEXT DEFAULT '',
    expected_outcome TEXT DEFAULT '',
    duration_mins INTEGER DEFAULT 15,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meeting_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    schedule_id INTEGER,
    agenda_item_id INTEGER,
    title TEXT NOT NULL,
    doc_type TEXT DEFAULT 'document',
    notes TEXT DEFAULT '',
    is_mock INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meeting_quorum (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    schedule_id INTEGER,
    required_members INTEGER DEFAULT 0,
    present_members INTEGER DEFAULT 0,
    quorum_achieved INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    schedule_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    votes_approve INTEGER DEFAULT 0,
    votes_reject INTEGER DEFAULT 0,
    votes_abstain INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS resolution_followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resolution_id INTEGER NOT NULL,
    owner TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(resolution_id) REFERENCES resolutions(id)
  );

  CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description TEXT DEFAULT '',
    chairperson TEXT DEFAULT '',
    members TEXT DEFAULT '[]',
    total_members INTEGER DEFAULT 0,
    default_quorum INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS committees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description TEXT DEFAULT '',
    chairperson TEXT DEFAULT '',
    members TEXT DEFAULT '[]',
    total_members INTEGER DEFAULT 0,
    default_quorum INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(board_id) REFERENCES boards(id)
  );

  CREATE TABLE IF NOT EXISTS meeting_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    meeting_type TEXT DEFAULT '',
    agenda_ar TEXT DEFAULT '',
    agenda_en TEXT DEFAULT '',
    default_duration INTEGER DEFAULT 60,
    default_attendees TEXT DEFAULT '',
    is_builtin INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Default plan = free
if (!db.prepare('SELECT value FROM settings WHERE key=?').get('plan')) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('plan', 'free');
}

// Seed demo system_roles once — must run AFTER settings table is created
if (!db.prepare("SELECT value FROM settings WHERE key='rbac_roles_seeded'").get()) {
  db.prepare("UPDATE users SET system_role='Admin'        WHERE email='ahmed@ameen.ai'").run();
  db.prepare("UPDATE users SET system_role='Executive'    WHERE email='sara@ameen.ai'").run();
  db.prepare("UPDATE users SET system_role='Board Member' WHERE email='khalid@ameen.ai'").run();
  db.prepare("UPDATE users SET system_role='Manager'      WHERE email='noura@ameen.ai'").run();
  db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('rbac_roles_seeded','1')").run();
}

// Seed demo data if empty
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('ameen2026', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name_ar, name_en, email, password, role_ar, role_en)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const u1 = insertUser.run('م. أحمد العمراني', 'Ahmed Al-Omrani', 'ahmed@ameen.ai', hash, 'الرئيس التنفيذي', 'CEO').lastInsertRowid;
  const u2 = insertUser.run('م. سارة الزهراني', 'Sara Al-Zahrani', 'sara@ameen.ai', hash, 'المدير التنفيذي', 'Managing Director').lastInsertRowid;
  const u3 = insertUser.run('م. خالد المنصور', 'Khalid Al-Mansour', 'khalid@ameen.ai', hash, 'المدير المالي', 'CFO').lastInsertRowid;
  const u4 = insertUser.run('م. نورة الراشد', 'Noura Al-Rashid', 'noura@ameen.ai', hash, 'مدير العمليات', 'COO').lastInsertRowid;

  // Demo meetings
  const insertMeeting = db.prepare(`
    INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by, ai_summary_ar, ai_summary_en, ai_tasks, ai_decisions, status, meeting_date, meeting_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const m1 = insertMeeting.run(
    'اجتماع مجلس الإدارة الشهري — مايو 2026',
    'Monthly Board Meeting — May 2026',
    'م. أحمد: نبدأ بمراجعة نتائج الربع الثاني. م. سارة: نمو 18% عن الربع السابق. م. خالد: لدينا فرصة استثمارية تستحق الدراسة. م. أحمد: نحتاج قرار اليوم بشأن توسعة الفريق. م. سارة: الميزانية كافية لـ 5 موظفين جدد.',
    42, u1,
    'اجتماع منتج ناقش نمو الربع الثاني بنسبة 18% والموافقة على توسعة الفريق بـ 5 موظفين جدد. تمت إحالة عقد الشراكة الخليجية للمراجعة القانونية.',
    'Productive meeting discussing Q2 growth of 18% and approving team expansion by 5 new hires. Gulf partnership contract referred for legal review.',
    JSON.stringify([
      {text_ar:'مراجعة عقد الشراكة الخليجية', text_en:'Review Gulf Partnership Contract', owner_ar:'م. سارة', owner_en:'Sara', due:'2026-05-22'},
      {text_ar:'إعداد خطة التوظيف للموظفين الخمسة', text_en:'Prepare 5-hire recruitment plan', owner_ar:'م. خالد', owner_en:'Khalid', due:'2026-05-19'},
      {text_ar:'دراسة الفرصة الاستثمارية وإعداد تقرير', text_en:'Study investment opportunity and prepare report', owner_ar:'م. أحمد', owner_en:'Ahmed', due:'2026-05-26'}
    ]),
    JSON.stringify([
      {text_ar:'الموافقة على توسعة الفريق بـ 5 موظفين', text_en:'Approved team expansion by 5 new hires'},
      {text_ar:'إحالة عقد الشراكة الخليجية للمراجعة القانونية', text_en:'Gulf Partnership Contract referred to legal review'}
    ]),
    'processed',
    '2026-05-15 09:00:00',
    'Board Meeting'
  ).lastInsertRowid;

  const m2 = insertMeeting.run(
    'الاجتماع التشغيلي الأسبوعي',
    'Weekly Operational Meeting',
    'م. نورة: تحديث المشاريع الجارية. م. خالد: ميزانية المشاريع ضمن الخطة. م. أحمد: يجب تسريع تقرير المساهمين.',
    28, u4,
    'تم مراجعة المشاريع الجارية وتأكيد سير الميزانية ضمن الخطة. قرر تسريع إعداد تقرير المساهمين الربعي.',
    'Reviewed ongoing projects, confirmed budget on track. Decided to expedite Q2 shareholders report preparation.',
    JSON.stringify([
      {text_ar:'تسريع إعداد تقرير المساهمين الربعي', text_en:'Expedite Q2 shareholders report', owner_ar:'م. خالد', owner_en:'Khalid', due:'2026-05-23'},
      {text_ar:'تحديث خطة المشاريع وإرسالها للفريق', text_en:'Update project plan and share with team', owner_ar:'م. نورة', owner_en:'Noura', due:'2026-05-21'}
    ]),
    JSON.stringify([
      {text_ar:'استمرار المشاريع وفق الخطة المعتمدة', text_en:'Projects continue as per approved plan'}
    ]),
    'processed',
    '2026-05-12 14:00:00',
    'Executive Meeting'
  ).lastInsertRowid;

  // Seed tasks
  const insertTask = db.prepare(`
    INSERT INTO tasks (text_ar, text_en, owner_id, owner_name_ar, owner_name_en, due_date, priority, status, source_meeting_id, source_meeting_title_ar, source_meeting_title_en, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertTask.run('مراجعة عقد الشراكة الخليجية', 'Review Gulf Partnership Contract', u2, 'م. سارة', 'Sara', '2026-05-22', 'urgent', 'inprogress', m1, 'اجتماع مجلس الإدارة — مايو', 'Board Meeting — May', u1);
  insertTask.run('إعداد خطة التوظيف للموظفين الخمسة', 'Prepare 5-hire recruitment plan', u3, 'م. خالد', 'Khalid', '2026-05-19', 'urgent', 'overdue', m1, 'اجتماع مجلس الإدارة — مايو', 'Board Meeting — May', u1);
  insertTask.run('دراسة الفرصة الاستثمارية', 'Study investment opportunity', u1, 'م. أحمد', 'Ahmed', '2026-05-26', 'normal', 'inprogress', m1, 'اجتماع مجلس الإدارة — مايو', 'Board Meeting — May', u1);
  insertTask.run('تسريع إعداد تقرير المساهمين الربعي', 'Expedite Q2 shareholders report', u3, 'م. خالد', 'Khalid', '2026-05-23', 'urgent', 'overdue', m2, 'الاجتماع التشغيلي', 'Operational Meeting', u4);
  insertTask.run('تحديث خطة المشاريع', 'Update project plan', u4, 'م. نورة', 'Noura', '2026-05-21', 'normal', 'done', m2, 'الاجتماع التشغيلي', 'Operational Meeting', u4);
  insertTask.run('مراجعة السياسة الاستثمارية الجديدة', 'Review new investment policy', u1, 'م. أحمد', 'Ahmed', '2026-05-16', 'normal', 'overdue', m1, 'اجتماع مجلس الإدارة — مايو', 'Board Meeting — May', u1);
  insertTask.run('إعداد تقرير مؤشرات الأداء الشهري', 'Prepare monthly KPI report', u4, 'م. نورة', 'Noura', '2026-05-20', 'normal', 'done', m2, 'الاجتماع التشغيلي', 'Operational Meeting', u4);

  // Seed decisions
  const insertDecision = db.prepare(`
    INSERT INTO decisions (text_ar, text_en, meeting_id, meeting_title_ar, meeting_title_en, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertDecision.run('الموافقة على توسعة الفريق بـ 5 موظفين', 'Approved team expansion by 5 new hires', m1, 'اجتماع مجلس الإدارة — مايو', 'Board Meeting May', 'active');
  insertDecision.run('إحالة عقد الشراكة الخليجية للمراجعة القانونية', 'Gulf Partnership Contract referred for legal review', m1, 'اجتماع مجلس الإدارة — مايو', 'Board Meeting May', 'active');
  insertDecision.run('استمرار المشاريع وفق الخطة المعتمدة', 'Projects continue as per approved plan', m2, 'الاجتماع التشغيلي', 'Operational Meeting', 'implemented');

  // Seed schedule
  const insertSchedule = db.prepare(`
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, created_by, meeting_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSchedule.run('اجتماع مجلس الإدارة الشهري — يونيو', 'Monthly Board Meeting — June', '2026-06-02', '09:00', 90, 'قاعة الاجتماعات الرئيسية', 'م. أحمد، م. سارة، م. خالد، م. نورة', 'مراجعة أداء مايو، خطة التوظيف، قرار عقد الشراكة', 'May performance review, hiring plan, partnership contract decision', u1, 'Board Meeting');
  insertSchedule.run('اجتماع المتابعة التشغيلية', 'Operational Follow-up Meeting', '2026-05-26', '14:00', 60, 'Zoom', 'م. سارة، م. خالد، م. نورة', 'متابعة المهام المتأخرة، تحديث المشاريع', 'Overdue tasks follow-up, project updates', u4, 'Follow-up Meeting');
  insertSchedule.run('جلسة مراجعة الشراكة الخليجية', 'Gulf Partnership Review Session', '2026-05-28', '11:00', 45, 'Teams', 'م. أحمد، م. سارة', 'المراجعة القانونية للعقد، التفاصيل المالية', 'Legal review of contract, financial details', u2, 'Committee Meeting');

  console.log('✓ Database seeded with demo data');
}

// Seed built-in meeting templates (runs once)
if (db.prepare("SELECT COUNT(*) as c FROM meeting_templates WHERE is_builtin=1").get().c === 0) {
  const iTpl = db.prepare(`INSERT INTO meeting_templates (name_ar,name_en,meeting_type,agenda_ar,agenda_en,default_duration,is_builtin) VALUES (?,?,?,?,?,?,1)`);
  iTpl.run('اجتماع مجلس الإدارة','Board Meeting','Board Meeting',
    'مراجعة محضر الاجتماع السابق\nالتقرير المالي\nالقضايا الاستراتيجية\nقرارات المجلس\nمتفرقات',
    'Review previous minutes\nFinancial report\nStrategic items\nBoard resolutions\nAOB',
    90);
  iTpl.run('الاجتماع التنفيذي الأسبوعي','Executive Standup','Executive Meeting',
    'مراجعة مؤشرات الأداء\nتحديثات الفرق\nالعقبات والمخاطر\nأولويات الأسبوع القادم',
    'KPI review\nTeam updates\nBlockers and risks\nNext week priorities',
    30);
  iTpl.run('اجتماع مراجعة اللجنة','Committee Review','Committee Meeting',
    'مراجعة جدول الأعمال\nعرض التقارير\nمناقشة التوصيات\nاتخاذ القرارات',
    'Agenda review\nReports presentation\nDiscuss recommendations\nDecision making',
    60);
  iTpl.run('جلسة التخطيط الاستراتيجي','Strategy Session','Strategy Meeting',
    'مراجعة الأهداف الاستراتيجية\nتحليل البيئة الخارجية\nتقييم الفرص والمخاطر\nخطة العمل',
    'Strategic objectives review\nExternal environment analysis\nOpportunities and risks\nAction plan',
    120);
  console.log('✓ Built-in meeting templates seeded');
}

// Seed boards and committees (runs independently of user seed)
if (db.prepare('SELECT COUNT(*) as c FROM boards').get().c === 0) {
  const iBoard = db.prepare(`INSERT INTO boards (name_ar,name_en,description,chairperson,members,total_members,default_quorum) VALUES (?,?,?,?,?,?,?)`);
  const b1 = iBoard.run(
    'مجلس الإدارة', 'Board of Directors',
    'الهيئة الحاكمة العليا للشركة — مسؤولة عن الاستراتيجية الكبرى والرقابة',
    'م. أحمد العمراني',
    JSON.stringify(['م. أحمد العمراني','م. سارة الزهراني','م. خالد المنصور','م. نورة الراشد']),
    4, 3
  ).lastInsertRowid;

  const iCom = db.prepare(`INSERT INTO committees (board_id,name_ar,name_en,description,chairperson,members,total_members,default_quorum) VALUES (?,?,?,?,?,?,?,?)`);
  iCom.run(b1,'لجنة المراجعة والتدقيق','Audit Committee',
    'مراجعة البيانات المالية والتحقق من سلامة الضوابط الداخلية',
    'م. خالد المنصور',
    JSON.stringify(['م. خالد المنصور','م. نورة الراشد','مستشار خارجي']),3,2);
  iCom.run(b1,'لجنة المخاطر','Risk Committee',
    'تحديد ومراقبة وإدارة المخاطر التشغيلية والمالية والاستراتيجية',
    'م. سارة الزهراني',
    JSON.stringify(['م. سارة الزهراني','م. أحمد العمراني','م. خالد المنصور']),3,2);
  iCom.run(b1,'اللجنة التنفيذية','Executive Committee',
    'تنفيذ القرارات الاستراتيجية ومتابعة الأداء التشغيلي اليومي',
    'م. أحمد العمراني',
    JSON.stringify(['م. أحمد العمراني','م. سارة الزهراني','م. نورة الراشد','م. خالد المنصور']),4,3);
  console.log('✓ Boards and committees seeded');
}

// Seed agenda items + mock documents (runs independently)
if (db.prepare('SELECT COUNT(*) as c FROM meeting_documents').get().c === 0) {
  const _u1 = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id;
  const _u2 = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1 OFFSET 1').get()?.id || _u1;
  const _u3 = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1 OFFSET 2').get()?.id || _u1;
  const _u4 = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1 OFFSET 3').get()?.id || _u1;
  const _m1 = db.prepare('SELECT id FROM meetings ORDER BY id LIMIT 1').get()?.id;
  const _m2 = db.prepare('SELECT id FROM meetings ORDER BY id LIMIT 1 OFFSET 1').get()?.id;
  if (_m1 && _u1) {
    const iAg = db.prepare(`INSERT INTO agenda_items (meeting_id,title,description,presenter,expected_outcome,duration_mins,sort_order) VALUES (?,?,?,?,?,?,?)`);
    const iDoc = db.prepare(`INSERT INTO meeting_documents (meeting_id,schedule_id,agenda_item_id,title,doc_type,description,uploaded_by,upload_date,status,is_mock,created_by) VALUES (?,?,?,?,?,?,?,?,?,1,?)`);

    // Agenda items + docs for m1 (Board Meeting)
    const _a1 = iAg.run(_m1,'مراجعة نتائج الربع الثاني','مراجعة مؤشرات الأداء ونتائج المبيعات للربع الثاني 2026','م. خالد المنصور','الموافقة على تقرير Q2',20,1).lastInsertRowid;
    const _a2 = iAg.run(_m1,'قرار توسعة الفريق','النظر في طلب توظيف 5 موظفين جدد وتوزيع الأدوار','م. أحمد العمراني','اتخاذ قرار بالتوظيف',15,2).lastInsertRowid;
    const _a3 = iAg.run(_m1,'عقد الشراكة الخليجية','مراجعة البنود القانونية وتحديد الموقف التفاوضي','م. سارة الزهراني','إحالة للمراجعة القانونية',25,3).lastInsertRowid;

    // Meeting-level documents for m1
    iDoc.run(_m1,null,null,'تقرير أداء الربع الثاني 2026','financial_report','ملخص مالي شامل لأداء الشركة خلال Q2','م. خالد المنصور','2026-05-14','approved',_u3);
    iDoc.run(_m1,null,null,'جدول أعمال مجلس الإدارة — مايو','minutes','جدول أعمال الاجتماع المعتمد من رئيس المجلس','م. أحمد العمراني','2026-05-13','shared',_u1);
    iDoc.run(_m1,null,null,'سياسة التوظيف المحدّثة','policy','النسخة المراجعة من سياسة التوظيف والتعيين','م. سارة الزهراني','2026-05-12','reviewed',_u2);

    // Agenda-level documents for m1
    iDoc.run(_m1,null,_a1,'تقرير المبيعات والإيرادات Q2','financial_report','تفاصيل مبيعات كل قسم وتحليل مقارن بالفترة السابقة','م. خالد المنصور','2026-05-13','approved',_u3);
    iDoc.run(_m1,null,_a3,'مسودة عقد الشراكة الخليجية','legal','المسودة الثانية للعقد مع الملاحظات القانونية المضافة','مستشار قانوني','2026-05-14','draft',_u1);
    iDoc.run(_m1,null,_a3,'دراسة الجدوى المالية للشراكة','proposal','تحليل العائد المتوقع وخارطة طريق الشراكة خلال 3 سنوات','م. سارة الزهراني','2026-05-14','shared',_u2);

    if (_m2) {
      // Agenda items + docs for m2 (Executive Meeting)
      const _a4 = iAg.run(_m2,'تحديث حالة المشاريع','متابعة سير المشاريع الجارية وتحديد أي تعثرات','م. نورة الراشد','تحديث خطة المشاريع',15,1).lastInsertRowid;
      const _a5 = iAg.run(_m2,'تقرير المساهمين الربعي','مناقشة إعداد وجدولة إرسال تقرير المساهمين','م. خالد المنصور','تحديد الموعد النهائي',10,2).lastInsertRowid;

      // Meeting-level documents for m2
      iDoc.run(_m2,null,null,'تقرير حالة المشاريع الأسبوعي','report','حالة كل مشروع: نسبة الإنجاز، الميزانية، المخاطر','م. نورة الراشد','2026-05-12','shared',_u4);
      iDoc.run(_m2,null,null,'مسودة تقرير المساهمين Q2','proposal','مسودة أولية لتقرير المساهمين للربع الثاني','م. خالد المنصور','2026-05-11','draft',_u3);

      // Agenda-level documents for m2
      iDoc.run(_m2,null,_a4,'لوحة مؤشرات الأداء — مايو','presentation','عرض تقديمي لمؤشرات الأداء الرئيسية لشهر مايو','م. نورة الراشد','2026-05-11','shared',_u4);
    }
    console.log('✓ Agenda items and mock documents seeded');
  }
}

// Seed resolutions demo data if none exist
if (!db.prepare("SELECT id FROM resolutions WHERE title='الموافقة على القوائم المالية للربع الثاني'").get()) {
  const _rm1 = db.prepare('SELECT id FROM meetings ORDER BY id LIMIT 1').get()?.id;
  const _rm2 = db.prepare('SELECT id FROM meetings ORDER BY id LIMIT 1 OFFSET 1').get()?.id;
  if (_rm1) {
    const iRes = db.prepare(`INSERT INTO resolutions (meeting_id,title,description,status,votes_approve,votes_reject,votes_abstain) VALUES (?,?,?,?,?,?,?)`);
    const iFu  = db.prepare(`INSERT INTO resolution_followups (resolution_id,owner,due_date,status,notes) VALUES (?,?,?,?,?)`);
    const r1 = iRes.run(_rm1,'الموافقة على القوائم المالية للربع الثاني','مراجعة واعتماد البيانات المالية للربع الثاني 2026 بعد مراجعة لجنة المراجعة والتدقيق','approved',4,0,1).lastInsertRowid;
    const r2 = iRes.run(_rm1,'تعيين المراجع الخارجي لعام 2026','الموافقة على تعيين شركة ديلويت كمراجع خارجي للسنة المالية 2026 بالإجماع','approved',5,0,0).lastInsertRowid;
    const r3 = iRes.run(_rm1,'اعتماد إطار إدارة المخاطر','مراجعة واعتماد وثيقة إطار إدارة المخاطر المحدثة لعام 2026 — تحتاج تعديلات إضافية','pending',2,1,0).lastInsertRowid;
    iFu.run(r1,'سارة الزهراني','2026-07-15','completed','تم إعداد تقرير الإفصاح المالي وإرساله للهيئة');
    iFu.run(r2,'فاطمة الحربي','2026-07-01','in_progress','إرسال خطاب التعيين الرسمي وتوقيع العقد');
    iFu.run(r3,'سارة الزهراني','2026-08-01','pending','مراجعة إضافية مطلوبة من اللجنة التنفيذية');
    if (_rm2) {
      const r4 = iRes.run(_rm2,'اعتماد جدول أعمال الجمعية العمومية السنوية','الموافقة على جدول أعمال الجمعية العمومية السنوية المقررة في يوليو 2026','approved',3,0,0).lastInsertRowid;
      const r5 = iRes.run(_rm2,'تفويض الرئيس التنفيذي لإبرام عقد الشراكة الاستراتيجية','تفويض الرئيس التنفيذي بالتوقيع على اتفاقية الشراكة مع مجموعة الخليج التجارية','deferred',1,2,1).lastInsertRowid;
      iFu.run(r4,'فاطمة الحربي','2026-07-10','in_progress','إعداد دعوات الجمعية العمومية وإرسالها للمساهمين');
      iFu.run(r5,'عمر حسن','2026-08-15','pending','مراجعة قانونية إضافية للبنود التعاقدية مطلوبة');
    }
    console.log('✓ Resolutions demo data seeded');
  }
}

// Update Board of Directors with proper Ameen Holdings people
{
  const _bod = db.prepare('SELECT id FROM boards LIMIT 1').get();
  if (_bod) {
    db.prepare(`UPDATE boards SET
      name_ar='مجلس إدارة أمين هولدينج',
      name_en='Ameen Holdings Board of Directors',
      chairperson='Mohammed Al-Otaibi',
      description='The supreme governing body of Ameen Holdings Group — responsible for strategic direction, executive oversight, and major governance decisions.',
      total_members=7, default_quorum=5, members=? WHERE id=?`).run(JSON.stringify([
      'Mohammed Al-Otaibi — Chairman',
      'Ahmed Al-Qahtani — CEO',
      'Fatima Al-Harbi — Corporate Secretary',
      'Sara Al-Zahrani — CFO',
      'Noura Al-Shammari — Independent Board Member',
      'Omar Hassan — Legal Advisor',
      'Abdullah Al-Dossari — COO',
    ]), _bod.id);
  }
  // Remove duplicate committees (keep first occurrence of each name)
  const seenCom = new Set();
  for (const c of db.prepare('SELECT id,name_en FROM committees ORDER BY id').all()) {
    if (seenCom.has(c.name_en)) db.prepare('DELETE FROM committees WHERE id=?').run(c.id);
    else seenCom.add(c.name_en);
  }
  // Update committees with proper names, chairs, members
  const _audit = db.prepare("SELECT id FROM committees WHERE name_en='Audit Committee' LIMIT 1").get();
  if (_audit) db.prepare(`UPDATE committees SET chairperson='Sara Al-Zahrani', total_members=3, default_quorum=2, members=?,
    description='Oversees financial reporting, internal controls, external audit, and compliance.' WHERE id=?`)
    .run(JSON.stringify(['Sara Al-Zahrani — Chairperson','Omar Hassan — Member','Noura Al-Shammari — Member']), _audit.id);
  const _risk = db.prepare("SELECT id FROM committees WHERE name_en='Risk Committee' LIMIT 1").get();
  if (_risk) db.prepare(`UPDATE committees SET chairperson='Omar Hassan', total_members=3, default_quorum=2, members=?,
    description='Identifies, assesses, and monitors strategic, operational, and financial risks.' WHERE id=?`)
    .run(JSON.stringify(['Omar Hassan — Chairperson','Abdullah Al-Dossari — Member','Ahmed Al-Qahtani — Member']), _risk.id);
  const _exec = db.prepare("SELECT id FROM committees WHERE name_en='Executive Committee' LIMIT 1").get();
  if (_exec) db.prepare(`UPDATE committees SET name_ar='لجنة الترشيحات والمكافآت',
    name_en='Nomination & Remuneration Committee', chairperson='Noura Al-Shammari',
    total_members=3, default_quorum=2, members=?,
    description='Oversees board nominations, executive remuneration, and succession planning.' WHERE id=?`)
    .run(JSON.stringify(['Noura Al-Shammari — Chairperson','Fatima Al-Harbi — Member','Mohammed Al-Otaibi — Member']), _exec.id);
  console.log('✓ Board and committee data updated');
}

// Seed General Assembly meetings if not present
if (!db.prepare("SELECT id FROM schedule WHERE meeting_type='general_assembly' AND title_en LIKE '%Annual General Assembly 2026%'").get()) {
  const iSch = db.prepare(`INSERT INTO schedule
    (title_ar,title_en,meeting_date,meeting_time,duration_mins,platform,attendees,agenda_ar,agenda_en,created_by,meeting_type,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ga1 = iSch.run(
    'الجمعية العمومية السنوية 2026 — مجموعة أمين هولدينج',
    'Annual General Assembly 2026 — Ameen Holdings Group',
    '2026-09-15','10:00',180,
    'فندق ريتز كارلتون — الرياض / Ritz-Carlton Riyadh',250,
    '1. استعراض التقرير السنوي\n2. اعتماد القوائم المالية 2025\n3. تعيين المراجع الخارجي\n4. توزيع الأرباح\n5. انتخاب أعضاء مجلس الإدارة',
    '1. Review Annual Board Report\n2. Approve FY2025 Financial Statements\n3. Appoint External Auditor\n4. Dividend Distribution (8%)\n5. Elect Board Members',
    1,'general_assembly','confirmed'
  ).lastInsertRowid;
  const ga2 = iSch.run(
    'الجمعية العمومية غير العادية — اعتماد زيادة رأس المال',
    'Extraordinary General Assembly — Capital Increase Approval',
    '2026-10-20','14:00',120,
    'مقر أمين هولدينج — الرياض / Ameen Holdings HQ',180,
    '1. اعتماد زيادة رأس المال إلى 750 مليون ريال\n2. تفويض مجلس الإدارة بالتنفيذ\n3. تعديل النظام الأساسي',
    '1. Approve capital increase from SAR 500M to SAR 750M\n2. Authorize board to execute increase\n3. Amend articles of association',
    1,'general_assembly','confirmed'
  ).lastInsertRowid;
  // Quorum
  const iQ = db.prepare(`INSERT OR IGNORE INTO meeting_quorum (schedule_id,required_members,present_members,quorum_achieved,notes) VALUES (?,?,?,?,?)`);
  iQ.run(ga1,175,245,1,'النصاب محقق — 245 مساهماً يمثلون 70% من رأس المال (فوق الحد الأدنى 50%+1)');
  iQ.run(ga2,175,0,0,'الجمعية لم تنعقد بعد — النصاب المطلوب 50%+1 من المساهمين');
  // Agenda GA1
  const iAg = db.prepare(`INSERT INTO agenda_items (schedule_id,title,description,presenter,duration_mins,expected_outcome,sort_order) VALUES (?,?,?,?,?,?,?)`);
  iAg.run(ga1,'استعراض التقرير السنوي لمجلس الإدارة','عرض إنجازات الشركة والمبادرات الاستراتيجية 2025','Mohammed Al-Otaibi',30,'الموافقة على التقرير',1);
  iAg.run(ga1,'اعتماد القوائم المالية للسنة المالية 2025','مراجعة الميزانية وقائمة الدخل الموقعة من ديلويت','Sara Al-Zahrani',45,'اعتماد القوائم المالية',2);
  iAg.run(ga1,'تعيين المراجع الخارجي لعام 2026','الموافقة على استمرار ديلويت مراجعاً خارجياً مستقلاً','Sara Al-Zahrani',20,'قرار التعيين',3);
  iAg.run(ga1,'توزيع أرباح بنسبة 8%','اقتراح توزيع أرباح بنسبة 8% من رأس المال المدفوع','Ahmed Al-Qahtani',25,'قرار توزيع الأرباح',4);
  iAg.run(ga1,'انتخاب أعضاء مجلس الإدارة 2026-2029','انتخاب 7 أعضاء للدورة الجديدة','Fatima Al-Harbi',40,'انتخاب المجلس الجديد',5);
  // Agenda GA2
  iAg.run(ga2,'مناقشة مقترح زيادة رأس المال','رفع رأس المال من 500 مليون إلى 750 مليون ريال','Ahmed Al-Qahtani',45,'الموافقة على الاقتراح',1);
  iAg.run(ga2,'تفويض مجلس الإدارة بالتنفيذ','تفويض المجلس لإتمام إجراءات الزيادة وفق الأنظمة','Omar Hassan',30,'صدور التفويض',2);
  iAg.run(ga2,'تعديل النظام الأساسي','تعديل المواد المتعلقة برأس المال في عقد التأسيس','Omar Hassan',25,'اعتماد التعديلات',3);
  // GA resolutions
  const iRes = db.prepare(`INSERT INTO resolutions (schedule_id,title,description,status,votes_approve,votes_reject,votes_abstain) VALUES (?,?,?,?,?,?,?)`);
  const iFu  = db.prepare(`INSERT INTO resolution_followups (resolution_id,owner,due_date,status,notes) VALUES (?,?,?,?,?)`);
  const gr1=iRes.run(ga1,'اعتماد التقرير السنوي لمجلس الإدارة','الموافقة على التقرير السنوي المقدم من رئيس مجلس الإدارة','approved',240,5,0).lastInsertRowid;
  const gr2=iRes.run(ga1,'اعتماد القوائم المالية للسنة المالية 2025','اعتماد الميزانية وقائمة الدخل الموقعة من المراجع','approved',238,7,0).lastInsertRowid;
  const gr3=iRes.run(ga1,'تعيين ديلويت مراجعاً خارجياً لعام 2026','الموافقة بالإجماع على تعيين شركة ديلويت','approved',245,0,0).lastInsertRowid;
  const gr4=iRes.run(ga1,'توزيع أرباح نقدية بنسبة 8%','اعتماد توزيع أرباح بنسبة 8% من رأس المال المدفوع','approved',218,22,5).lastInsertRowid;
  const gr5=iRes.run(ga2,'اعتماد زيادة رأس المال إلى 750 مليون ريال','رفع رأس المال من 500 مليون إلى 750 مليون ريال سعودي','pending',0,0,0).lastInsertRowid;
  const gr6=iRes.run(ga2,'تفويض الرئيس التنفيذي بتنفيذ قرار الزيادة','تفويض رسمي للرئيس التنفيذي لإتمام الإجراءات التنظيمية','pending',0,0,0).lastInsertRowid;
  iFu.run(gr1,'Fatima Al-Harbi','2026-09-30','completed','تم إرسال نسخ التقرير المعتمد لجميع المساهمين');
  iFu.run(gr2,'Sara Al-Zahrani','2026-10-15','in_progress','رفع البيانات المعتمدة لهيئة السوق المالية خلال 30 يوماً');
  iFu.run(gr3,'Sara Al-Zahrani','2026-10-01','in_progress','توقيع عقد التعيين الرسمي مع ديلويت وإشعار الهيئة');
  iFu.run(gr4,'Ahmed Al-Qahtani','2026-10-30','pending','تحديد موعد صرف الأرباح وإشعار المساهمين');
  iFu.run(gr5,'Omar Hassan','2026-10-25','pending','إعداد الوثائق القانونية لهيئة السوق المالية');
  console.log('✓ General Assembly meetings, agenda, resolutions seeded');
}

// ── Seed GA dedicated tables (shareholders, votes, officers, minutes, docs) ───
if (!db.prepare('SELECT id FROM ga_shareholders WHERE ga_schedule_id=33').get()) {
  const ga1 = 33, ga2 = 34;
  const iOff = db.prepare(`INSERT INTO ga_officers (ga_schedule_id,role,role_ar,name_en,name_ar) VALUES (?,?,?,?,?)`);
  [ga1, ga2].forEach(gid => {
    iOff.run(gid,'chairman',      'رئيس الجمعية',       'Mohammed Al-Otaibi','محمد العتيبي');
    iOff.run(gid,'secretary',     'أمين السر',           'Fatima Al-Harbi',  'فاطمة الحربي');
    iOff.run(gid,'legal_advisor', 'المستشار القانوني',   'Omar Hassan',       'عمر حسن');
    iOff.run(gid,'scrutineer',    'مدقق الأصوات',        'Ahmed Al-Rashid',   'أحمد الراشد');
  });
  const iSh = db.prepare(`INSERT INTO ga_shareholders (ga_schedule_id,name_ar,name_en,shares,share_pct,vote_rights,attendance_status,proxy_name) VALUES (?,?,?,?,?,?,?,?)`);
  iSh.run(ga1,'محمد العتيبي',        'Mohammed Al-Otaibi',      2500000,35.7,2500000,'present', null);
  iSh.run(ga1,'خالد الراشد',          'Khalid Al-Rashid',         1800000,25.7,1800000,'present', null);
  iSh.run(ga1,'صندوق أمين القابضة', 'Ameen Holdings Fund',       1200000,17.1,1200000,'proxy',   'M. Hassan');
  iSh.run(ga1,'سارة العمري',           'Sarah Al-Amri',              800000,11.4, 800000,'present', null);
  iSh.run(ga1,'شركاء دوليون م.م.',    'International Partners LLC', 700000,10.0, 700000,'absent',  null);
  iSh.run(ga2,'محمد العتيبي',        'Mohammed Al-Otaibi',      2500000,35.7,2500000,'present', null);
  iSh.run(ga2,'خالد الراشد',          'Khalid Al-Rashid',         1800000,25.7,1800000,'present', null);
  iSh.run(ga2,'صندوق أمين القابضة', 'Ameen Holdings Fund',       1200000,17.1,1200000,'proxy',   'M. Hassan');
  iSh.run(ga2,'سارة العمري',           'Sarah Al-Amri',              800000,11.4, 800000,'excused', null);
  iSh.run(ga2,'شركاء دوليون م.م.',    'International Partners LLC', 700000,10.0, 700000,'absent',  null);
  const iVt = db.prepare(`INSERT INTO ga_votes (ga_schedule_id,motion_ar,motion_en,votes_for,votes_against,votes_abstain,total_votes,passed,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`);
  iVt.run(ga1,'اعتماد القوائم المالية للسنة المالية 2025',  'Approve FY2025 Financial Statements',            5800000,200000,300000,6300000,1,1);
  iVt.run(ga1,'إعادة انتخاب أعضاء مجلس الإدارة 2026–2028','Re-elect Board of Directors 2026–2028',           6100000,100000,100000,6300000,1,2);
  iVt.run(ga1,'تعيين ديلويت مراجعاً خارجياً',               'Appoint Deloitte as External Auditors',           5900000,150000,250000,6300000,1,3);
  iVt.run(ga1,'الموافقة على توزيع أرباح بنسبة 8%',          'Approve 8% Dividend Distribution',               5400000,600000,300000,6300000,1,4);
  iVt.run(ga2,'اعتماد زيادة رأس المال إلى 750 مليون ريال', 'Approve Capital Increase SAR 500M→750M',          0,0,0,0,0,1);
  iVt.run(ga2,'تفويض مجلس الإدارة بتنفيذ قرار الزيادة',    'Authorize Board to Execute Capital Increase',     0,0,0,0,0,2);
  iVt.run(ga2,'تعديل النظام الأساسي للشركة',                 'Amend Articles of Association',                  0,0,0,0,0,3);
  db.prepare(`INSERT OR IGNORE INTO ga_minutes (ga_schedule_id,status,draft_date,circulated_date,draft_by) VALUES (?,?,?,?,?)`).run(ga1,'circulated','2026-09-22','2026-09-25','Fatima Al-Harbi');
  db.prepare(`INSERT OR IGNORE INTO ga_minutes (ga_schedule_id,status) VALUES (?,?)`).run(ga2,'draft');
  const iMd = db.prepare(`INSERT INTO meeting_documents (schedule_id,title,doc_type,description,uploaded_by,upload_date,status,is_mock,created_by) VALUES (?,?,?,?,?,?,?,1,1)`);
  iMd.run(ga1,'إشعار انعقاد الجمعية العمومية السنوية 2026',  'notice',    'دعوة رسمية للمساهمين',                  'Fatima Al-Harbi','2026-08-15','shared');
  iMd.run(ga1,'جدول أعمال الجمعية العمومية',                   'agenda',    'جدول الأعمال المفصّل',                    'Fatima Al-Harbi','2026-08-15','approved');
  iMd.run(ga1,'حقيبة المساهمين',                                'board_pack','وثائق الجمعية الشاملة للمساهمين',        'Fatima Al-Harbi','2026-08-20','approved');
  iMd.run(ga1,'القوائم المالية للسنة المالية 2025',            'financial', 'القوائم المالية المدققة من ديلويت',        'Deloitte',        '2026-08-20','approved');
  iMd.run(ga1,'مسودة محضر الجمعية العمومية',                   'minutes',   'المسودة الأولى للمحضر الرسمي',             'Fatima Al-Harbi','2026-09-22','reviewed');
  iMd.run(ga2,'إشعار انعقاد الجمعية العمومية غير العادية',   'notice',    'دعوة رسمية للمساهمين',                  'Fatima Al-Harbi','2026-09-20','shared');
  iMd.run(ga2,'جدول أعمال الجمعية غير العادية',                'agenda',    'جدول أعمال اعتماد زيادة رأس المال',       'Fatima Al-Harbi','2026-09-20','approved');
  iMd.run(ga2,'تقرير مقترح زيادة رأس المال',                  'financial', 'تقرير CFO التفصيلي عن زيادة رأس المال',   'CFO',             '2026-09-25','reviewed');
  console.log('✓ GA shareholders, votes, officers, minutes, documents seeded');
}

// ── Ensure admin user has a valid bcrypt password ────────────────────────────
// Runs once on startup. If the seed user's password is not a bcrypt hash,
// sets a default development password and logs it ONCE to the console.
(function ensureAdminPassword() {
  const bcrypt = require('bcryptjs');
  const admin = db.prepare('SELECT id, email, password FROM users ORDER BY id ASC LIMIT 1').get();
  if (!admin) return;
  const isBcrypt = admin.password && admin.password.startsWith('$2');
  if (!isBcrypt) {
    const defaultPass = 'AmeenAdmin2026!';
    const hash = bcrypt.hashSync(defaultPass, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, admin.id);
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  [AUTH] Development admin credentials set (one-time)     ║');
    console.log('║  Email   : ' + admin.email.padEnd(44) + '║');
    console.log('║  Password: AmeenAdmin2026!                               ║');
    console.log('║  ⚠️  Change this password immediately in production!      ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
  }
})();

module.exports = db;
