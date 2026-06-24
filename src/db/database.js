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

module.exports = db;
