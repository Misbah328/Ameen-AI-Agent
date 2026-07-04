'use strict';

// ══ Enterprise RBAC (Phase 4) ═══════════════════════════════════════════════
// Granular permission catalog + default role→permission seed. Roles are
// stored in the DB (`roles` table) so Admins can create/clone/disable custom
// roles at runtime; the PERMISSION CATALOG below is fixed by what the app
// actually knows how to gate — every feature that calls requirePermission()
// references one of these keys, so the catalog is inherently code-defined.
//
// The 8 pre-existing `users.system_role` values (Admin, CEO, Board Member,
// Committee Member, Executive, Manager, Employee, Observer) are kept as the
// role KEYS so no existing user row or requireRole() check needs to change —
// only their DISPLAY NAME may differ (e.g. "Manager" displays as "Department
// Manager") to match the enterprise role names requested for this phase.
// Six net-new roles are added: Super Admin, Organization Admin, Board
// Secretary, Committee Chair, Auditor, Guest.

const PERMISSION_CATALOG = [
  // Meetings
  { key: 'meetings.view',    category: 'meetings',   label_ar: 'عرض الاجتماعات',      label_en: 'View Meetings' },
  { key: 'meetings.create',  category: 'meetings',   label_ar: 'إنشاء اجتماعات',      label_en: 'Create Meetings' },
  { key: 'meetings.edit',    category: 'meetings',   label_ar: 'تعديل الاجتماعات',    label_en: 'Edit Meetings' },
  { key: 'meetings.delete',  category: 'meetings',   label_ar: 'حذف الاجتماعات',      label_en: 'Delete Meetings' },
  { key: 'meetings.archive', category: 'meetings',   label_ar: 'أرشفة الاجتماعات',    label_en: 'Archive Meetings' },
  // Minutes
  { key: 'minutes.view',     category: 'minutes',    label_ar: 'عرض المحاضر',         label_en: 'View Minutes' },
  { key: 'minutes.edit',     category: 'minutes',    label_ar: 'تعديل المحاضر',       label_en: 'Edit Minutes' },
  { key: 'minutes.approve',  category: 'minutes',    label_ar: 'اعتماد المحاضر',      label_en: 'Approve Minutes' },
  { key: 'minutes.publish',  category: 'minutes',    label_ar: 'نشر المحاضر',         label_en: 'Publish Minutes' },
  // Executive Actions
  { key: 'actions.view',     category: 'actions',    label_ar: 'عرض الإجراءات',       label_en: 'View Executive Actions' },
  { key: 'actions.assign',   category: 'actions',    label_ar: 'إسناد الإجراءات',     label_en: 'Assign Executive Actions' },
  { key: 'actions.update',   category: 'actions',    label_ar: 'تحديث الإجراءات',     label_en: 'Update Executive Actions' },
  { key: 'actions.close',    category: 'actions',    label_ar: 'إغلاق الإجراءات',     label_en: 'Close Executive Actions' },
  // Meeting Series
  { key: 'series.view',      category: 'series',     label_ar: 'عرض سلاسل الاجتماعات', label_en: 'View Meeting Series' },
  { key: 'series.manage',    category: 'series',     label_ar: 'إدارة سلاسل الاجتماعات', label_en: 'Manage Meeting Series' },
  // Calendar
  { key: 'calendar.view',    category: 'calendar',   label_ar: 'عرض التقويم',         label_en: 'View Calendar' },
  { key: 'calendar.manage',  category: 'calendar',   label_ar: 'إدارة التقويم',       label_en: 'Manage Calendar' },
  // Governance
  { key: 'governance.boards',           category: 'governance', label_ar: 'إدارة المجالس',     label_en: 'Board Management' },
  { key: 'governance.committees',       category: 'governance', label_ar: 'إدارة اللجان',       label_en: 'Committee Management' },
  { key: 'governance.general_assembly', category: 'governance', label_ar: 'الجمعية العمومية',   label_en: 'General Assembly' },
  { key: 'governance.voting',           category: 'governance', label_ar: 'التصويت',            label_en: 'Voting' },
  { key: 'governance.resolutions',      category: 'governance', label_ar: 'القرارات',           label_en: 'Resolutions' },
  // Documents
  { key: 'documents.upload',   category: 'documents', label_ar: 'رفع المستندات',    label_en: 'Upload Documents' },
  { key: 'documents.download', category: 'documents', label_ar: 'تنزيل المستندات',  label_en: 'Download Documents' },
  { key: 'documents.share',    category: 'documents', label_ar: 'مشاركة المستندات', label_en: 'Share Documents' },
  { key: 'documents.delete',   category: 'documents', label_ar: 'حذف المستندات',    label_en: 'Delete Documents' },
  // Reports
  { key: 'reports.view',     category: 'reports',    label_ar: 'عرض التقارير',      label_en: 'View Reports' },
  { key: 'reports.generate', category: 'reports',    label_ar: 'توليد التقارير',    label_en: 'Generate Reports' },
  { key: 'reports.export',   category: 'reports',    label_ar: 'تصدير التقارير',    label_en: 'Export Reports' },
  // AI
  { key: 'ai.ask',              category: 'ai',       label_ar: 'اسأل أمين',           label_en: 'Ask Ameen' },
  { key: 'ai.generate_minutes', category: 'ai',       label_ar: 'توليد المحاضر بالذكاء الاصطناعي', label_en: 'Generate Minutes' },
  { key: 'ai.generate_reports', category: 'ai',       label_ar: 'توليد التقارير بالذكاء الاصطناعي', label_en: 'Generate Reports (AI)' },
  // Administration
  { key: 'admin.users',    category: 'admin',        label_ar: 'إدارة المستخدمين',  label_en: 'Users' },
  { key: 'admin.teams',    category: 'admin',        label_ar: 'إدارة الفرق',       label_en: 'Teams' },
  { key: 'admin.roles',    category: 'admin',        label_ar: 'إدارة الأدوار',     label_en: 'Roles' },
  { key: 'admin.settings', category: 'admin',        label_ar: 'إعدادات النظام',    label_en: 'Settings' },
];

const CATEGORY_META = {
  meetings:   { ar: 'الاجتماعات',            en: 'Meetings' },
  minutes:    { ar: 'المحاضر',               en: 'Minutes' },
  actions:    { ar: 'الإجراءات التنفيذية',   en: 'Executive Actions' },
  series:     { ar: 'سلاسل الاجتماعات',      en: 'Meeting Series' },
  calendar:   { ar: 'التقويم',               en: 'Calendar' },
  governance: { ar: 'الحوكمة',               en: 'Governance' },
  documents:  { ar: 'المستندات',             en: 'Documents' },
  reports:    { ar: 'التقارير',              en: 'Reports' },
  ai:         { ar: 'الذكاء الاصطناعي',      en: 'AI' },
  admin:      { ar: 'الإدارة',               en: 'Administration' },
};

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);
const byCategory = (cat) => PERMISSION_CATALOG.filter((p) => p.category === cat).map((p) => p.key);

const M = byCategory('meetings'), MI = byCategory('minutes'), AC = byCategory('actions'),
  SE = byCategory('series'), CA = byCategory('calendar'), GO = byCategory('governance'),
  DO = byCategory('documents'), RE = byCategory('reports'), AI = byCategory('ai'), AD = byCategory('admin');

// role key -> { name_ar, name_en, description_ar, description_en, is_builtin }
// (name_* is the DISPLAY name shown in the UI — may differ from the key.)
const ROLE_META = {
  'Super Admin':        { name_ar: 'مدير عام',            name_en: 'Super Admin',            description_ar: 'صلاحية كاملة على النظام بما في ذلك إدارة الأدوار والصلاحيات', description_en: 'Full system access, including managing roles and permissions', is_builtin: 1 },
  'Organization Admin': { name_ar: 'مدير المؤسسة',        name_en: 'Organization Admin',      description_ar: 'صلاحية كاملة على محتوى المؤسسة دون إدارة الأدوار', description_en: 'Full access to organization content, excluding role configuration', is_builtin: 1 },
  'Admin':              { name_ar: 'مدير النظام',          name_en: 'Admin',                   description_ar: 'صلاحية كاملة على النظام', description_en: 'Full system access', is_builtin: 1 },
  'CEO':                { name_ar: 'الرئيس التنفيذي',      name_en: 'CEO / President',          description_ar: 'صلاحية تنفيذية كاملة على المحتوى', description_en: 'Full executive access to content', is_builtin: 1 },
  'Board Secretary':    { name_ar: 'أمين سر المجلس',       name_en: 'Board Secretary',          description_ar: 'إدارة المحاضر والحوكمة وسلاسل الاجتماعات', description_en: 'Manages minutes, governance and meeting series', is_builtin: 1 },
  'Board Member':       { name_ar: 'عضو مجلس الإدارة',     name_en: 'Board Member',             description_ar: 'عرض ومشاركة في التصويت والقرارات', description_en: 'View access plus voting and resolutions', is_builtin: 1 },
  'Committee Chair':    { name_ar: 'رئيس لجنة',            name_en: 'Committee Chair',          description_ar: 'إدارة اللجنة والتصويت والقرارات', description_en: 'Manages committee, voting and resolutions', is_builtin: 1 },
  'Committee Member':   { name_ar: 'عضو لجنة',             name_en: 'Committee Member',         description_ar: 'عرض ومشاركة في تصويت اللجنة', description_en: 'View access plus committee voting', is_builtin: 1 },
  'Executive':          { name_ar: 'تنفيذي',               name_en: 'Executive',                description_ar: 'إدارة الاجتماعات والإجراءات والتقارير', description_en: 'Manages meetings, actions and reports', is_builtin: 1 },
  'Manager':            { name_ar: 'مدير إدارة',           name_en: 'Department Manager',       description_ar: 'إدارة اجتماعات وإجراءات وفريق القسم', description_en: 'Manages department meetings, actions and team', is_builtin: 1 },
  'Employee':           { name_ar: 'عضو الفريق',           name_en: 'Team Member',              description_ar: 'وصول أساسي للاجتماعات والمهام الخاصة', description_en: 'Basic access to meetings and own tasks', is_builtin: 1 },
  'Auditor':            { name_ar: 'مدقق',                 name_en: 'Auditor',                  description_ar: 'عرض للقراءة فقط عبر النظام والتقارير', description_en: 'Read-only access across the system plus reports', is_builtin: 1 },
  'Guest':              { name_ar: 'ضيف / مشارك خارجي',    name_en: 'Guest / External Participant', description_ar: 'وصول محدود جداً للاطلاع فقط', description_en: 'Very limited, view-only access', is_builtin: 1 },
  'Observer':           { name_ar: 'مراقب',                name_en: 'Observer',                 description_ar: 'اطلاع على المحاضر والاجتماعات فقط', description_en: 'View-only access to meetings and minutes', is_builtin: 1 },
};

// role key -> permission keys granted by default. Derived from each role's
// CURRENT effective access (ROLE_ACCESS/TASK_FULL_MANAGE_ROLES/requireRole)
// wherever a prior behavior exists, so switching on enforcement does not
// regress any existing role's capabilities.
const DEFAULT_ROLE_PERMISSIONS = {
  'Super Admin':        [...ALL_KEYS],
  'Admin':              [...ALL_KEYS],
  'Organization Admin': ALL_KEYS.filter((k) => k !== 'admin.roles'),
  'CEO':                [...M, ...MI, ...AC, ...SE, ...CA, ...GO, ...DO, ...RE, ...AI, 'admin.settings'],
  'Board Secretary':    ['meetings.view', 'meetings.create', 'meetings.edit', 'meetings.archive', 'meetings.delete', ...MI, 'actions.view', 'actions.assign', 'actions.update', 'actions.close', ...SE, ...CA, ...GO, 'documents.upload', 'documents.download', 'documents.share', 'reports.view', 'reports.generate', 'ai.ask', 'ai.generate_minutes'],
  // Board Member and Committee Member were both in the pre-existing
  // TASK_FULL_MANAGE_ROLES list (full task reassign/edit/delete rights) —
  // preserved here via the full actions.* set so this retrofit does not
  // regress their current capability.
  'Board Member':       ['meetings.view', 'minutes.view', 'actions.view', 'actions.assign', 'actions.update', 'actions.close', 'series.view', 'calendar.view', 'governance.general_assembly', 'governance.voting', 'governance.resolutions', 'documents.download', 'reports.view', 'ai.ask'],
  'Committee Chair':    ['meetings.view', 'meetings.create', 'meetings.edit', 'minutes.view', 'actions.view', 'actions.assign', 'actions.update', 'actions.close', 'series.view', 'calendar.view', 'governance.committees', 'governance.voting', 'governance.resolutions', 'documents.upload', 'documents.download', 'reports.view', 'ai.ask'],
  'Committee Member':   ['meetings.view', 'minutes.view', 'actions.view', 'actions.assign', 'actions.update', 'actions.close', 'series.view', 'calendar.view', 'governance.voting', 'documents.download', 'reports.view', 'ai.ask'],
  'Executive':          ['meetings.view', 'meetings.create', 'meetings.edit', 'minutes.view', 'actions.view', 'actions.assign', 'actions.update', 'actions.close', 'series.view', 'series.manage', 'calendar.view', 'calendar.manage', 'meetings.archive', 'documents.upload', 'documents.download', 'documents.share', 'reports.view', 'reports.generate', 'ai.ask', 'ai.generate_minutes', 'ai.generate_reports'],
  'Manager':            ['meetings.view', 'meetings.create', 'meetings.edit', 'minutes.view', 'actions.view', 'actions.assign', 'actions.update', 'actions.close', 'series.view', 'series.manage', 'calendar.view', 'calendar.manage', 'meetings.archive', 'documents.upload', 'documents.download', 'reports.view', 'reports.generate', 'ai.ask', 'ai.generate_minutes', 'admin.teams'],
  // Employee deliberately has actions.update but NOT actions.view — the
  // absence of actions.view is what scopes their task list to their own
  // tasks only in GET /tasks, matching current behavior exactly.
  'Employee':           ['meetings.view', 'meetings.create', 'minutes.view', 'actions.update', 'ai.ask'],
  'Auditor':            ['meetings.view', 'minutes.view', 'actions.view', 'series.view', 'calendar.view', 'documents.download', 'reports.view', 'reports.export'],
  'Guest':              ['meetings.view', 'minutes.view', 'calendar.view'],
  'Observer':           ['meetings.view', 'minutes.view'],
};

const ROLE_KEYS = Object.keys(ROLE_META);

function seedRbac(db) {
  const already = db.prepare("SELECT value FROM settings WHERE key='rbac_permissions_seeded_v1'").get();
  if (already) return;

  const insertRole = db.prepare(`
    INSERT INTO roles (role_key, name_ar, name_en, description_ar, description_en, is_builtin, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, 1, 1, NULL)
  `);
  const insertPerm = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');

  const tx = db.transaction(() => {
    for (const key of ROLE_KEYS) {
      const meta = ROLE_META[key];
      const existing = db.prepare('SELECT id FROM roles WHERE role_key=?').get(key);
      const roleId = existing
        ? existing.id
        : insertRole.run(key, meta.name_ar, meta.name_en, meta.description_ar, meta.description_en).lastInsertRowid;
      const perms = DEFAULT_ROLE_PERMISSIONS[key] || [];
      for (const p of perms) insertPerm.run(roleId, p);
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('rbac_permissions_seeded_v1', '1')").run();
  });
  tx();
}

// Fresh per-request lookup (no caching) — role_permissions edits made in the
// Role Management UI take effect on every subsequent request immediately,
// without requiring affected users to log out/in (unlike a system_role
// reassignment, which is baked into the JWT at login time).
function getRolePermissions(db, roleKey) {
  const role = db.prepare('SELECT id, is_active FROM roles WHERE role_key=?').get(roleKey);
  if (!role || !role.is_active) return new Set();
  const rows = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id=?').all(role.id);
  return new Set(rows.map((r) => r.permission_key));
}

function hasPermission(db, userId, permissionKey) {
  const u = db.prepare('SELECT system_role FROM users WHERE id=?').get(userId);
  const roleKey = (u && u.system_role) || 'Employee';
  return getRolePermissions(db, roleKey).has(permissionKey);
}

module.exports = {
  PERMISSION_CATALOG,
  CATEGORY_META,
  ROLE_META,
  ROLE_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  seedRbac,
  getRolePermissions,
  hasPermission,
};
