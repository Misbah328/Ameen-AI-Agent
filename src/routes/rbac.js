'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const { requirePermission } = auth;
const rbac = require('../services/rbac');

function resolveActor(userId) {
  const u = db.prepare('SELECT name_ar, name_en FROM users WHERE id=?').get(userId);
  return u ? (u.name_en || u.name_ar) : null;
}

function roleWithPermissions(role) {
  const perms = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id=?').all(role.id).map((r) => r.permission_key);
  const userCount = db.prepare('SELECT COUNT(*) c FROM users WHERE system_role=?').get(role.role_key).c;
  return { ...role, permissions: perms, user_count: userCount };
}

// ── Permission catalog (static, code-defined) ─────────────────────────────────
router.get('/permissions', auth, (req, res) => {
  res.json({ catalog: rbac.PERMISSION_CATALOG, categories: rbac.CATEGORY_META });
});

// Lightweight feed for the user role-assignment dropdown — id/key/name only.
router.get('/roles-lookup', auth, (req, res) => {
  const roles = db.prepare('SELECT id, role_key, name_ar, name_en, is_active FROM roles ORDER BY id').all();
  res.json(roles);
});

// The logged-in user's own effective permission set — lets the frontend hide
// (not just the backend reject) actions the current user cannot perform.
router.get('/my-permissions', auth, (req, res) => {
  const u = db.prepare('SELECT system_role FROM users WHERE id=?').get(req.user.id);
  const roleKey = (u && u.system_role) || 'Employee';
  res.json({ role: roleKey, permissions: [...rbac.getEffectivePermissions(db, req.user.id)] });
});

router.get('/roles', auth, requirePermission('admin.roles'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY is_builtin DESC, id ASC').all();
  res.json(roles.map(roleWithPermissions));
});

router.get('/roles/:id', auth, requirePermission('admin.roles'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  res.json(roleWithPermissions(role));
});

router.post('/roles', auth, requirePermission('admin.roles'), (req, res) => {
  const { role_key, name_ar, name_en, description_ar, description_en, permissions } = req.body;
  if (!role_key || !name_ar || !name_en) return res.status(400).json({ error: 'role_key, name_ar and name_en are required' });
  if (db.prepare('SELECT id FROM roles WHERE role_key=?').get(role_key)) {
    return res.status(409).json({ error: 'A role with this key already exists' });
  }
  const catalogKeys = rbac.PERMISSION_CATALOG.map((c) => c.key);
  const validPerms = (Array.isArray(permissions) ? permissions : []).filter((p) => catalogKeys.includes(p));
  let roleId;
  db.transaction(() => {
    roleId = db.prepare(`
      INSERT INTO roles (role_key, name_ar, name_en, description_ar, description_en, is_builtin, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, 0, 1, ?)
    `).run(role_key, name_ar, name_en, description_ar || '', description_en || '', req.user.id).lastInsertRowid;
    const insertPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of validPerms) insertPerm.run(roleId, p);
    db.prepare(`
      INSERT INTO permission_audit_log (role_id, role_key, action, actor_id, actor_name, old_value, new_value)
      VALUES (?, ?, 'create', ?, ?, '[]', ?)
    `).run(roleId, role_key, req.user.id, resolveActor(req.user.id), JSON.stringify(validPerms));
  })();
  res.json(roleWithPermissions(db.prepare('SELECT * FROM roles WHERE id=?').get(roleId)));
});

router.post('/roles/:id/clone', auth, requirePermission('admin.roles'), (req, res) => {
  const src = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Not found' });
  const { role_key, name_ar, name_en } = req.body;
  if (!role_key || !name_ar || !name_en) return res.status(400).json({ error: 'role_key, name_ar and name_en are required' });
  if (db.prepare('SELECT id FROM roles WHERE role_key=?').get(role_key)) {
    return res.status(409).json({ error: 'A role with this key already exists' });
  }
  const srcPerms = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id=?').all(src.id).map((r) => r.permission_key);
  let roleId;
  db.transaction(() => {
    roleId = db.prepare(`
      INSERT INTO roles (role_key, name_ar, name_en, description_ar, description_en, is_builtin, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, 0, 1, ?)
    `).run(role_key, name_ar, name_en, src.description_ar, src.description_en, req.user.id).lastInsertRowid;
    const insertPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of srcPerms) insertPerm.run(roleId, p);
    db.prepare(`
      INSERT INTO permission_audit_log (role_id, role_key, action, actor_id, actor_name, old_value, new_value)
      VALUES (?, ?, 'clone', ?, ?, ?, ?)
    `).run(roleId, role_key, req.user.id, resolveActor(req.user.id), JSON.stringify([]), JSON.stringify(srcPerms));
  })();
  res.json(roleWithPermissions(db.prepare('SELECT * FROM roles WHERE id=?').get(roleId)));
});

router.patch('/roles/:id', auth, requirePermission('admin.roles'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  const { name_ar, name_en, description_ar, description_en, is_active, permissions } = req.body;

  const oldPerms = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id=?').all(role.id).map((r) => r.permission_key).sort();
  const catalogKeys = rbac.PERMISSION_CATALOG.map((c) => c.key);
  const newPerms = Array.isArray(permissions) ? permissions.filter((p) => catalogKeys.includes(p)).sort() : oldPerms;
  const permsChanged = Array.isArray(permissions) && JSON.stringify(newPerms) !== JSON.stringify(oldPerms);

  db.transaction(() => {
    db.prepare(`UPDATE roles SET
        name_ar=COALESCE(?,name_ar), name_en=COALESCE(?,name_en),
        description_ar=COALESCE(?,description_ar), description_en=COALESCE(?,description_en),
        is_active=COALESCE(?,is_active), updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .run(name_ar, name_en, description_ar, description_en, (is_active === undefined ? null : (is_active ? 1 : 0)), role.id);

    if (Array.isArray(permissions)) {
      db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(role.id);
      const insertPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
      for (const p of newPerms) insertPerm.run(role.id, p);
    }

    if (permsChanged || is_active !== undefined) {
      const action = is_active !== undefined && !permsChanged ? (is_active ? 'enable' : 'disable') : 'update';
      db.prepare(`
        INSERT INTO permission_audit_log (role_id, role_key, action, actor_id, actor_name, old_value, new_value)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(role.id, role.role_key, action, req.user.id, resolveActor(req.user.id), JSON.stringify(oldPerms), JSON.stringify(newPerms));
    }
  })();

  res.json(roleWithPermissions(db.prepare('SELECT * FROM roles WHERE id=?').get(role.id)));
});

router.delete('/roles/:id', auth, requirePermission('admin.roles'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  if (role.is_builtin) return res.status(403).json({ error: 'Cannot delete a built-in role' });
  const inUse = db.prepare('SELECT COUNT(*) c FROM users WHERE system_role=?').get(role.role_key).c;
  if (inUse > 0) return res.status(409).json({ error: `${inUse} user(s) currently have this role — reassign them first` });
  db.transaction(() => {
    db.prepare(`
      INSERT INTO permission_audit_log (role_id, role_key, action, actor_id, actor_name, old_value, new_value)
      VALUES (?, ?, 'delete', ?, ?, '[]', '[]')
    `).run(role.id, role.role_key, req.user.id, resolveActor(req.user.id));
    db.prepare('DELETE FROM roles WHERE id=?').run(role.id);
  })();
  res.json({ success: true });
});

router.get('/audit-log', auth, requirePermission('admin.roles'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare('SELECT * FROM permission_audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
  const safeArr = (v) => { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch (_) { return []; } };
  res.json(rows.map((r) => ({ ...r, old_value: safeArr(r.old_value), new_value: safeArr(r.new_value) })));
});

// ── Users with their roles (for the Roles panel Members tab) ──────────────────
router.get('/users-with-roles', auth, requirePermission('admin.roles'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name_ar, u.name_en, u.email, u.system_role, u.created_at,
           r.name_ar AS role_name_ar, r.name_en AS role_name_en, r.is_builtin
    FROM users u
    LEFT JOIN roles r ON r.role_key = u.system_role
    ORDER BY u.name_ar
  `).all();
  res.json(users);
});

// ── Per-user permission overrides ─────────────────────────────────────────────
router.get('/user-permissions/:userId', auth, requirePermission('admin.roles'), (req, res) => {
  const rows = db.prepare('SELECT permission_key, granted FROM user_permissions WHERE user_id=?').all(req.params.userId);
  res.json(rows);
});

router.put('/user-permissions/:userId', auth, requirePermission('admin.roles'), (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  const catalogKeys = new Set(rbac.PERMISSION_CATALOG.map(p => p.key));
  const overrides = (Array.isArray(req.body.overrides) ? req.body.overrides : [])
    .filter(o => catalogKeys.has(o.permission_key) && (o.granted === 0 || o.granted === 1));
  db.transaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id=?').run(userId);
    const ins = db.prepare('INSERT INTO user_permissions (user_id, permission_key, granted, created_by) VALUES (?,?,?,?)');
    for (const o of overrides) ins.run(userId, o.permission_key, o.granted, req.user.id);
  })();
  res.json({ success: true, count: overrides.length });
});

module.exports = router;
