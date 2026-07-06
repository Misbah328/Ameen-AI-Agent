'use strict';

// Central helper for the in-app Notification Center (the `notifications`
// table in src/db/database.js). Every call site already knows its own
// bilingual title/body — this only handles the insert and stays silent on
// failure so a notification can never block the write it's documenting.
function createNotification(db, { userId, type, titleAr, titleEn, bodyAr = '', bodyEn = '', priority = 'normal', sourceType = null, sourceId = null, deepLink = null }) {
  if (!userId) return;
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en, priority, source_type, source_id, deep_link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, type, titleAr, titleEn, bodyAr, bodyEn, priority, sourceType, sourceId, deepLink);
  } catch (_) {
    // best-effort only — never block the caller's write
  }
}

// Same payload fanned out to several recipients, deduped and excluding
// `excludeUserId` (typically the actor who triggered the event — nobody
// needs to be told they did their own action).
function notifyUsers(db, userIds, payload, excludeUserId = null) {
  const seen = new Set();
  for (const id of userIds) {
    if (!id || id === excludeUserId || seen.has(id)) continue;
    seen.add(id);
    createNotification(db, { ...payload, userId: id });
  }
}

module.exports = { createNotification, notifyUsers };
