const Database = require('better-sqlite3');
const db = new Database('./data/ameen.db');

db.prepare('UPDATE meetings SET approval_due_date=?, circulated_at=CURRENT_TIMESTAMP WHERE id=89')
  .run('2026-07-22 17:00:00');

db.prepare('DELETE FROM meeting_documents WHERE meeting_id=89').run();

const stmt = db.prepare(`INSERT INTO meeting_documents
  (meeting_id, title, title_ar, title_en, doc_type, file_type, file_size,
   description_ar, description_en, file_path, status, is_mock, created_by, uploaded_by)
  VALUES (89,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

stmt.run(
  'H1 2026 Financial Performance Report',
  'تقرير الأداء المالي H1 2026', 'H1 2026 Financial Performance Report',
  'reports', 'pdf', Math.round(1024*1024*2.4),
  'تقرير شامل للنتائج المالية للنصف الأول من عام 2026',
  'Comprehensive financial results report for H1 2026',
  '/uploads/h1-report.pdf', 'active', 1, 1, 1
);
stmt.run(
  'Approved FY2026 Operational Budget',
  'الميزانية التشغيلية المعتمدة 2026', 'Approved FY2026 Operational Budget',
  'financial', 'xlsx', Math.round(1024*856),
  'تفاصيل الميزانية التشغيلية المعدّلة للعام المالي 2026',
  'Detailed revised FY2026 operational budget spreadsheet',
  '/uploads/budget-2026.xlsx', 'active', 1, 1, 1
);
stmt.run(
  'Strategic Initiatives Presentation',
  'تقديم المبادرات الاستراتيجية', 'Strategic Initiatives Presentation',
  'presentation', 'pptx', Math.round(1024*1024*5.1),
  'شرائح تقديمية لأبرز المبادرات الاستراتيجية الثلاث',
  'Presentation slides for the three main strategic initiatives',
  '/uploads/strategic-slides.pptx', 'active', 1, 1, 1
);

console.log('docs:', db.prepare('SELECT count(*) c FROM meeting_documents WHERE meeting_id=89').get().c);
console.log('deadline:', db.prepare('SELECT approval_due_date FROM meetings WHERE id=89').get().approval_due_date);
