const Database = require('better-sqlite3');
const db = new Database('./data/ameen.db');

// Attendees for meeting 89:
// 48: م. محمد العتيبي - رئيس مجلس الإدارة
// 49: م. فيصل السبيعي - نائب رئيس مجلس الإدارة
// 50: د. نورة الشمري - عضو مجلس الإدارة
// 51: م. عبدالله القحطاني - عضو مجلس الإدارة
// 52: هند المطيري - أمينة السر
// 53: أ. أحمد الزهراني - الرئيس التنفيذي (ضيف)

db.prepare('DELETE FROM minutes_comments WHERE meeting_id=89').run();
db.prepare('DELETE FROM minutes_signatures WHERE meeting_id=89').run();

// Update cycle with deadline
db.prepare(`UPDATE minutes_cycle SET comment_deadline='2026-07-22 17:00:00' WHERE meeting_id=89`).run();

const insCom = db.prepare(`INSERT INTO minutes_comments
  (meeting_id, commenter_id, commenter_name, commenter_role, clause_ref, content, status, decided_by, decided_at, secretary_note, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

const insSig = db.prepare(`INSERT INTO minutes_signatures
  (meeting_id, signer_id, signer_name, signer_role, sig_stage, status, signature_type, signed_at)
  VALUES (?,?,?,?,?,?,?,?)`);

// ── م. محمد العتيبي (chairman) — COMPLETED: 2 accepted comments + signed
insCom.run(89, 48, 'م. محمد العتيبي', 'رئيس مجلس الإدارة',
  'القسم 3: مراجعة الأداء',
  'يُقترح إضافة جدول مقارنة يوضح الأداء مقابل الميزانية المعتمدة بشكل تفصيلي.',
  'accepted', 'هند المطيري', '2026-07-16 11:30:00',
  'تمت الإضافة في الصفحة 4 من المحضر النهائي.',
  '2026-07-16 09:15:00'
);
insCom.run(89, 48, 'م. محمد العتيبي', 'رئيس مجلس الإدارة',
  'القسم 5: الميزانية',
  'يُطلب توضيح آلية مراقبة مصروفات التقنية المشار إليها في قرار مجلس الإدارة.',
  'accepted', 'هند المطيري', '2026-07-16 11:35:00',
  'تمت إضافة فقرة توضيحية في قسم قرارات المجلس.',
  '2026-07-16 09:20:00'
);
insSig.run(89, 48, 'م. محمد العتيبي', 'رئيس مجلس الإدارة',
  'review', 'signed', 'digital', '2026-07-16 11:45:00');

// ── م. فيصل السبيعي (vice chairman) — IN_REVIEW: 1 pending comment
insCom.run(89, 49, 'م. فيصل السبيعي', 'نائب رئيس مجلس الإدارة',
  'القسم 6: المبادرات الاستراتيجية',
  'أقترح تضمين مؤشرات قياس الأداء (KPIs) لكل مبادرة استراتيجية في ملحق منفصل.',
  'pending', null, null, null,
  '2026-07-16 13:00:00'
);

// ── د. نورة الشمري (board member) — REVIEWED_PENDING_EDITS: 1 accepted + 1 pending
insCom.run(89, 50, 'د. نورة الشمري', 'عضو مجلس الإدارة',
  'القسم 2: الحضور',
  'ملاحظة: لقب أ. أحمد الزهراني يجب أن يكون "الرئيس التنفيذي" وليس "ضيف" فقط.',
  'accepted', 'هند المطيري', '2026-07-16 14:00:00',
  'تم تصحيح اللقب وفق الصلاحيات الرسمية.',
  '2026-07-16 10:30:00'
);
insCom.run(89, 50, 'د. نورة الشمري', 'عضو مجلس الإدارة',
  'القسم 4: مراجعة الأداء',
  'يُطلب توضيح نسبة الـ 23% المتعلقة بالعملاء الجدد — هل هي مقارنة بالهدف السنوي أم نصف السنوي؟',
  'pending', null, null, null,
  '2026-07-16 10:45:00'
);

// ── م. عبدالله القحطاني (board member) — NOT_STARTED: no activity
// No inserts needed

// ── هند المطيري (secretary) — COMPLETED: 1 accepted comment + signed
insCom.run(89, 52, 'هند المطيري', 'أمينة السر',
  'القسم 9: بنود العمل',
  'تم تحديث أسماء المسؤولين في بنود العمل لتتوافق مع قائمة الحضور الرسمية.',
  'accepted', 'هند المطيري', '2026-07-16 08:00:00',
  'تم التحديث.',
  '2026-07-16 07:50:00'
);
insSig.run(89, 52, 'هند المطيري', 'أمينة السر',
  'review', 'signed', 'digital', '2026-07-16 08:30:00');

// ── أ. أحمد الزهراني (CEO guest) — NOT_STARTED: no activity

const totalCom = db.prepare('SELECT count(*) c FROM minutes_comments WHERE meeting_id=89').get();
const totalSig = db.prepare('SELECT count(*) c FROM minutes_signatures WHERE meeting_id=89').get();
const cyc = db.prepare('SELECT * FROM minutes_cycle WHERE meeting_id=89').get();
console.log('comments:', totalCom.c, '| sigs:', totalSig.c);
console.log('cycle deadline:', cyc.comment_deadline, '| stage:', cyc.cycle_stage);
