'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

// ── Agenda Items ──────────────────────────────────────────────────────────────

router.get('/agenda', auth, (req, res) => {
  const { meetingId, scheduleId } = req.query;
  if (meetingId) return res.json(db.prepare('SELECT * FROM agenda_items WHERE meeting_id=? ORDER BY sort_order,id').all(meetingId));
  if (scheduleId) return res.json(db.prepare('SELECT * FROM agenda_items WHERE schedule_id=? ORDER BY sort_order,id').all(scheduleId));
  res.status(400).json({ error: 'meetingId or scheduleId required' });
});

router.post('/agenda', auth, (req, res) => {
  const { meeting_id, schedule_id, title, description, presenter, expected_outcome, duration_mins, sort_order } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const row = db.prepare(`
    INSERT INTO agenda_items (meeting_id, schedule_id, title, description, presenter, expected_outcome, duration_mins, sort_order)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(meeting_id||null, schedule_id||null, title, description||'', presenter||'', expected_outcome||'', duration_mins||15, sort_order||0);
  res.json(db.prepare('SELECT * FROM agenda_items WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/agenda/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM agenda_items WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { title, description, presenter, expected_outcome, duration_mins, sort_order } = req.body;
  db.prepare(`UPDATE agenda_items SET
    title=COALESCE(?,title), description=COALESCE(?,description),
    presenter=COALESCE(?,presenter), expected_outcome=COALESCE(?,expected_outcome),
    duration_mins=COALESCE(?,duration_mins), sort_order=COALESCE(?,sort_order)
    WHERE id=?`).run(title, description, presenter, expected_outcome, duration_mins, sort_order, req.params.id);
  res.json(db.prepare('SELECT * FROM agenda_items WHERE id=?').get(req.params.id));
});

router.delete('/agenda/:id', auth, (req, res) => {
  db.prepare('DELETE FROM agenda_items WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Meeting Documents ─────────────────────────────────────────────────────────

router.get('/documents', auth, (req, res) => {
  const { meetingId, scheduleId } = req.query;
  if (meetingId) return res.json(db.prepare('SELECT * FROM meeting_documents WHERE meeting_id=? ORDER BY id').all(meetingId));
  if (scheduleId) return res.json(db.prepare('SELECT * FROM meeting_documents WHERE schedule_id=? ORDER BY id').all(scheduleId));
  res.status(400).json({ error: 'meetingId or scheduleId required' });
});

router.post('/documents', auth, (req, res) => {
  const { meeting_id, schedule_id, agenda_item_id, title, doc_type, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const row = db.prepare(`
    INSERT INTO meeting_documents (meeting_id, schedule_id, agenda_item_id, title, doc_type, notes, is_mock, created_by)
    VALUES (?,?,?,?,?,?,0,?)
  `).run(meeting_id||null, schedule_id||null, agenda_item_id||null, title, doc_type||'document', notes||'', req.user.id);
  res.json(db.prepare('SELECT * FROM meeting_documents WHERE id=?').get(row.lastInsertRowid));
});

router.delete('/documents/:id', auth, (req, res) => {
  db.prepare('DELETE FROM meeting_documents WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Attendance (extends meeting_attendees) ────────────────────────────────────

router.get('/attendance', auth, (req, res) => {
  const { meetingId } = req.query;
  if (!meetingId) return res.status(400).json({ error: 'meetingId required' });
  res.json(db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=? ORDER BY id').all(meetingId));
});

router.post('/attendance', auth, (req, res) => {
  const { meeting_id, name, email, phone, role, attendance_status } = req.body;
  if (!meeting_id || !name) return res.status(400).json({ error: 'meeting_id and name required' });
  const row = db.prepare(`
    INSERT INTO meeting_attendees (meeting_id, name, email, phone, role, attendance_status)
    VALUES (?,?,?,?,?,?)
  `).run(meeting_id, name, email||'', phone||'', role||'Member', attendance_status||'pending');
  res.json(db.prepare('SELECT * FROM meeting_attendees WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/attendance/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM meeting_attendees WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { name, email, role, attendance_status } = req.body;
  db.prepare(`UPDATE meeting_attendees SET
    name=COALESCE(?,name), email=COALESCE(?,email),
    role=COALESCE(?,role), attendance_status=COALESCE(?,attendance_status)
    WHERE id=?`).run(name, email, role, attendance_status, req.params.id);
  res.json(db.prepare('SELECT * FROM meeting_attendees WHERE id=?').get(req.params.id));
});

router.delete('/attendance/:id', auth, (req, res) => {
  db.prepare('DELETE FROM meeting_attendees WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Quorum ────────────────────────────────────────────────────────────────────

router.get('/quorum', auth, (req, res) => {
  const { meetingId, scheduleId } = req.query;
  if (meetingId) return res.json(db.prepare('SELECT * FROM meeting_quorum WHERE meeting_id=?').get(meetingId) || null);
  if (scheduleId) return res.json(db.prepare('SELECT * FROM meeting_quorum WHERE schedule_id=?').get(scheduleId) || null);
  res.status(400).json({ error: 'meetingId or scheduleId required' });
});

router.put('/quorum', auth, (req, res) => {
  const { meeting_id, schedule_id, required_members, present_members, notes } = req.body;
  const req_m = required_members || 0;
  const pres_m = present_members || 0;
  const achieved = req_m > 0 && pres_m >= req_m ? 1 : 0;
  const existing = meeting_id
    ? db.prepare('SELECT * FROM meeting_quorum WHERE meeting_id=?').get(meeting_id)
    : schedule_id ? db.prepare('SELECT * FROM meeting_quorum WHERE schedule_id=?').get(schedule_id) : null;
  if (existing) {
    db.prepare('UPDATE meeting_quorum SET required_members=?,present_members=?,quorum_achieved=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(req_m, pres_m, achieved, notes||'', existing.id);
    return res.json(db.prepare('SELECT * FROM meeting_quorum WHERE id=?').get(existing.id));
  }
  const row = db.prepare('INSERT INTO meeting_quorum (meeting_id,schedule_id,required_members,present_members,quorum_achieved,notes) VALUES (?,?,?,?,?,?)')
    .run(meeting_id||null, schedule_id||null, req_m, pres_m, achieved, notes||'');
  res.json(db.prepare('SELECT * FROM meeting_quorum WHERE id=?').get(row.lastInsertRowid));
});

// ── Resolutions ───────────────────────────────────────────────────────────────

function withFollowups(r) {
  return { ...r, followups: db.prepare('SELECT * FROM resolution_followups WHERE resolution_id=? ORDER BY id').all(r.id) };
}

router.get('/resolutions', auth, (req, res) => {
  const { meetingId, scheduleId } = req.query;
  let rows = [];
  if (meetingId) rows = db.prepare('SELECT * FROM resolutions WHERE meeting_id=? ORDER BY id').all(meetingId);
  else if (scheduleId) rows = db.prepare('SELECT * FROM resolutions WHERE schedule_id=? ORDER BY id').all(scheduleId);
  else return res.status(400).json({ error: 'meetingId or scheduleId required' });
  res.json(rows.map(withFollowups));
});

router.post('/resolutions', auth, (req, res) => {
  const { meeting_id, schedule_id, title, description, status } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const row = db.prepare('INSERT INTO resolutions (meeting_id,schedule_id,title,description,status) VALUES (?,?,?,?,?)')
    .run(meeting_id||null, schedule_id||null, title, description||'', status||'pending');
  res.json(withFollowups(db.prepare('SELECT * FROM resolutions WHERE id=?').get(row.lastInsertRowid)));
});

router.patch('/resolutions/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM resolutions WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { title, description, status } = req.body;
  db.prepare('UPDATE resolutions SET title=COALESCE(?,title),description=COALESCE(?,description),status=COALESCE(?,status) WHERE id=?')
    .run(title, description, status, req.params.id);
  res.json(withFollowups(db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id)));
});

router.delete('/resolutions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM resolution_followups WHERE resolution_id=?').run(req.params.id);
  db.prepare('DELETE FROM resolutions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/resolutions/:id/vote', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { vote } = req.body;
  const col = vote === 'approve' ? 'votes_approve' : vote === 'reject' ? 'votes_reject' : vote === 'abstain' ? 'votes_abstain' : null;
  if (!col) return res.status(400).json({ error: 'vote must be approve, reject, or abstain' });
  db.prepare(`UPDATE resolutions SET ${col}=${col}+1 WHERE id=?`).run(req.params.id);
  const updated = db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id);
  // Auto-derive status from vote majority
  if (updated.votes_approve + updated.votes_reject + updated.votes_abstain > 0) {
    let s = 'pending';
    if (updated.votes_approve > updated.votes_reject) s = 'approved';
    else if (updated.votes_reject > updated.votes_approve) s = 'rejected';
    if (s !== updated.status) db.prepare('UPDATE resolutions SET status=? WHERE id=?').run(s, req.params.id);
  }
  res.json(withFollowups(db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id)));
});

// ── Resolution Follow-ups ─────────────────────────────────────────────────────

router.post('/resolutions/:id/followups', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM resolutions WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { owner, due_date, status, notes } = req.body;
  const row = db.prepare('INSERT INTO resolution_followups (resolution_id,owner,due_date,status,notes) VALUES (?,?,?,?,?)')
    .run(req.params.id, owner||'', due_date||'', status||'pending', notes||'');
  res.json(db.prepare('SELECT * FROM resolution_followups WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/followups/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM resolution_followups WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { owner, due_date, status, notes } = req.body;
  db.prepare('UPDATE resolution_followups SET owner=COALESCE(?,owner),due_date=COALESCE(?,due_date),status=COALESCE(?,status),notes=COALESCE(?,notes) WHERE id=?')
    .run(owner, due_date, status, notes, req.params.id);
  res.json(db.prepare('SELECT * FROM resolution_followups WHERE id=?').get(req.params.id));
});

router.delete('/followups/:id', auth, (req, res) => {
  db.prepare('DELETE FROM resolution_followups WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Boards ────────────────────────────────────────────────────────────────────

router.get('/boards', auth, (req, res) => {
  const boards = db.prepare('SELECT * FROM boards ORDER BY id').all();
  const committees = db.prepare('SELECT * FROM committees ORDER BY board_id, id').all();
  res.json(boards.map(b => ({
    ...b,
    members: (() => { try { return JSON.parse(b.members || '[]'); } catch { return []; } })(),
    committees: committees.filter(c => c.board_id === b.id).map(c => ({
      ...c,
      members: (() => { try { return JSON.parse(c.members || '[]'); } catch { return []; } })(),
    })),
  })));
});

router.post('/boards', auth, (req, res) => {
  const { name_ar, name_en, description, chairperson, members, total_members, default_quorum } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'name_ar required' });
  const row = db.prepare(`INSERT INTO boards (name_ar,name_en,description,chairperson,members,total_members,default_quorum) VALUES (?,?,?,?,?,?,?)`)
    .run(name_ar, name_en||name_ar, description||'', chairperson||'', JSON.stringify(members||[]), total_members||0, default_quorum||0);
  res.json(db.prepare('SELECT * FROM boards WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/boards/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name_ar, name_en, description, chairperson, members, total_members, default_quorum } = req.body;
  db.prepare(`UPDATE boards SET
    name_ar=COALESCE(?,name_ar), name_en=COALESCE(?,name_en),
    description=COALESCE(?,description), chairperson=COALESCE(?,chairperson),
    members=COALESCE(?,members), total_members=COALESCE(?,total_members),
    default_quorum=COALESCE(?,default_quorum) WHERE id=?`)
    .run(name_ar, name_en, description, chairperson,
      members !== undefined ? JSON.stringify(members) : null,
      total_members, default_quorum, req.params.id);
  res.json(db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id));
});

router.delete('/boards/:id', auth, (req, res) => {
  db.prepare('UPDATE committees SET board_id=NULL WHERE board_id=?').run(req.params.id);
  db.prepare('DELETE FROM boards WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Committees ────────────────────────────────────────────────────────────────

router.get('/committees', auth, (req, res) => {
  const { boardId } = req.query;
  const rows = boardId
    ? db.prepare('SELECT c.*, b.name_ar as board_name_ar, b.name_en as board_name_en FROM committees c LEFT JOIN boards b ON c.board_id=b.id WHERE c.board_id=? ORDER BY c.id').all(boardId)
    : db.prepare('SELECT c.*, b.name_ar as board_name_ar, b.name_en as board_name_en FROM committees c LEFT JOIN boards b ON c.board_id=b.id ORDER BY c.board_id, c.id').all();
  res.json(rows.map(c => ({ ...c, members: (() => { try { return JSON.parse(c.members||'[]'); } catch { return []; } })() })));
});

router.post('/committees', auth, (req, res) => {
  const { board_id, name_ar, name_en, description, chairperson, members, total_members, default_quorum } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'name_ar required' });
  const row = db.prepare(`INSERT INTO committees (board_id,name_ar,name_en,description,chairperson,members,total_members,default_quorum) VALUES (?,?,?,?,?,?,?,?)`)
    .run(board_id||null, name_ar, name_en||name_ar, description||'', chairperson||'', JSON.stringify(members||[]), total_members||0, default_quorum||0);
  res.json(db.prepare('SELECT * FROM committees WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/committees/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM committees WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { board_id, name_ar, name_en, description, chairperson, members, total_members, default_quorum } = req.body;
  db.prepare(`UPDATE committees SET
    board_id=COALESCE(?,board_id), name_ar=COALESCE(?,name_ar), name_en=COALESCE(?,name_en),
    description=COALESCE(?,description), chairperson=COALESCE(?,chairperson),
    members=COALESCE(?,members), total_members=COALESCE(?,total_members),
    default_quorum=COALESCE(?,default_quorum) WHERE id=?`)
    .run(board_id, name_ar, name_en, description, chairperson,
      members !== undefined ? JSON.stringify(members) : null,
      total_members, default_quorum, req.params.id);
  res.json(db.prepare('SELECT * FROM committees WHERE id=?').get(req.params.id));
});

router.delete('/committees/:id', auth, (req, res) => {
  db.prepare('DELETE FROM committees WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Combined dropdown feed (boards + all their committees) ────────────────────
router.get('/boards-and-committees', auth, (req, res) => {
  const boards = db.prepare('SELECT id,name_ar,name_en,chairperson,default_quorum FROM boards ORDER BY id').all();
  const committees = db.prepare('SELECT id,board_id,name_ar,name_en,chairperson,default_quorum FROM committees ORDER BY board_id,id').all();
  res.json({ boards, committees });
});

module.exports = router;
