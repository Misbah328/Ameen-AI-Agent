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
    INSERT INTO meetings (title_ar, title_en, transcript, duration, recorded_by, ai_summary_ar, ai_summary_en, ai_tasks, ai_decisions, status, meeting_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    '2026-05-15 09:00:00'
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
    '2026-05-12 14:00:00'
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
    INSERT INTO schedule (title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, agenda_ar, agenda_en, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSchedule.run('اجتماع مجلس الإدارة الشهري — يونيو', 'Monthly Board Meeting — June', '2026-06-02', '09:00', 90, 'قاعة الاجتماعات الرئيسية', 'م. أحمد، م. سارة، م. خالد، م. نورة', 'مراجعة أداء مايو، خطة التوظيف، قرار عقد الشراكة', 'May performance review, hiring plan, partnership contract decision', u1);
  insertSchedule.run('اجتماع المتابعة التشغيلية', 'Operational Follow-up Meeting', '2026-05-26', '14:00', 60, 'Zoom', 'م. سارة، م. خالد، م. نورة', 'متابعة المهام المتأخرة، تحديث المشاريع', 'Overdue tasks follow-up, project updates', u4);
  insertSchedule.run('جلسة مراجعة الشراكة الخليجية', 'Gulf Partnership Review Session', '2026-05-28', '11:00', 45, 'Teams', 'م. أحمد، م. سارة', 'المراجعة القانونية للعقد، التفاصيل المالية', 'Legal review of contract, financial details', u2);

  console.log('✓ Database seeded with demo data');
}

module.exports = db;
