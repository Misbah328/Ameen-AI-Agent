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
  const { meetingId, scheduleId, agendaItemId } = req.query;
  if (agendaItemId) return res.json(db.prepare('SELECT * FROM meeting_documents WHERE agenda_item_id=? ORDER BY id').all(agendaItemId));
  if (meetingId) return res.json(db.prepare('SELECT * FROM meeting_documents WHERE meeting_id=? ORDER BY id').all(meetingId));
  if (scheduleId) return res.json(db.prepare('SELECT * FROM meeting_documents WHERE schedule_id=? ORDER BY id').all(scheduleId));
  res.status(400).json({ error: 'meetingId, scheduleId, or agendaItemId required' });
});

router.post('/documents', auth, (req, res) => {
  const { meeting_id, schedule_id, agenda_item_id, title, doc_type, description, uploaded_by, upload_date, status } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const row = db.prepare(`
    INSERT INTO meeting_documents (meeting_id, schedule_id, agenda_item_id, title, doc_type, description, uploaded_by, upload_date, status, is_mock, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,0,?)
  `).run(meeting_id||null, schedule_id||null, agenda_item_id||null, title, doc_type||'other', description||'', uploaded_by||'', upload_date||'', status||'draft', req.user.id);
  res.json(db.prepare('SELECT * FROM meeting_documents WHERE id=?').get(row.lastInsertRowid));
});

router.patch('/documents/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM meeting_documents WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { title, doc_type, description, uploaded_by, upload_date, status } = req.body;
  db.prepare(`UPDATE meeting_documents SET
    title=COALESCE(?,title), doc_type=COALESCE(?,doc_type),
    description=COALESCE(?,description), uploaded_by=COALESCE(?,uploaded_by),
    upload_date=COALESCE(?,upload_date), status=COALESCE(?,status)
    WHERE id=?`)
    .run(title||null, doc_type||null, description||null, uploaded_by||null, upload_date||null, status||null, req.params.id);
  res.json(db.prepare('SELECT * FROM meeting_documents WHERE id=?').get(req.params.id));
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
  db.transaction(() => {
    db.prepare('DELETE FROM resolution_followups WHERE resolution_id=?').run(req.params.id);
    db.prepare('DELETE FROM resolutions WHERE id=?').run(req.params.id);
  })();
  res.json({ success: true });
});

router.post('/resolutions/:id/vote', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const vs = item.voting_status || 'draft';
  if (vs !== 'open') return res.status(400).json({ error: vs === 'closed' ? 'Voting has been closed' : 'Voting is not open yet — an authorised user must open voting first' });
  const { vote, comments } = req.body;
  if (!['approve', 'reject', 'abstain'].includes(vote))
    return res.status(400).json({ error: 'vote must be approve, reject, or abstain' });
  const userRow = db.prepare('SELECT name_ar, name_en, system_role FROM users WHERE id=?').get(req.user.id);
  const voterName = (userRow?.name_en || userRow?.name_ar || req.user.email || '').trim();
  const voterRole = req.user.system_role || userRow?.system_role || '';
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM votes WHERE resolution_id=? AND voter_id=?').get(req.params.id, req.user.id);
    if (existing) {
      db.prepare('UPDATE votes SET vote=?, comments=?, voter_name=?, voter_role=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(vote, comments||'', voterName, voterRole, existing.id);
    } else {
      db.prepare('INSERT INTO votes (resolution_id, voter_id, voter_name, voter_role, vote, comments) VALUES (?,?,?,?,?,?)')
        .run(req.params.id, req.user.id, voterName, voterRole, vote, comments||'');
    }
    const agg = db.prepare('SELECT vote, COUNT(*) as c FROM votes WHERE resolution_id=? GROUP BY vote').all(req.params.id);
    const counts = { approve:0, reject:0, abstain:0 };
    agg.forEach(a => { if (a.vote in counts) counts[a.vote] = a.c; });
    const totalV = counts.approve + counts.reject + counts.abstain;
    let status = 'pending';
    if (totalV > 0) {
      if (counts.approve > counts.reject) status = 'approved';
      else if (counts.reject > counts.approve) status = 'rejected';
    }
    db.prepare('UPDATE resolutions SET votes_approve=?, votes_reject=?, votes_abstain=?, status=? WHERE id=?')
      .run(counts.approve, counts.reject, counts.abstain, status, req.params.id);
  })();
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

// ── Governance dashboard summary ──────────────────────────────────────────────
router.get('/summary', auth, (req, res) => {
  try {
    const boards       = db.prepare('SELECT COUNT(*) as c FROM boards').get().c;
    const committees   = db.prepare('SELECT COUNT(*) as c FROM committees').get().c;
    const resTotal     = db.prepare('SELECT COUNT(*) as c FROM resolutions').get().c;
    const resPending   = db.prepare("SELECT COUNT(*) as c FROM resolutions WHERE status='pending'").get().c;
    const resApproved  = db.prepare("SELECT COUNT(*) as c FROM resolutions WHERE status='approved'").get().c;
    const resRejected  = db.prepare("SELECT COUNT(*) as c FROM resolutions WHERE status='rejected'").get().c;
    const resDeferred  = db.prepare("SELECT COUNT(*) as c FROM resolutions WHERE status='deferred'").get().c;
    const quorumAchieved    = db.prepare('SELECT COUNT(*) as c FROM meeting_quorum WHERE quorum_achieved=1').get().c;
    const quorumTotal       = db.prepare('SELECT COUNT(*) as c FROM meeting_quorum WHERE required_members>0').get().c;
    const generalAssemblies = db.prepare("SELECT COUNT(*) as c FROM schedule WHERE meeting_type='general_assembly'").get().c;
    const openActions       = db.prepare("SELECT COUNT(*) as c FROM resolution_followups WHERE status IN ('pending','in_progress')").get().c;
    const pendingMinutes    = db.prepare("SELECT COUNT(*) as c FROM meetings WHERE status IN ('draft','circulated')").get().c;
    const recentRes = db.prepare(`
      SELECT r.*, m.title_ar as meeting_title_ar, m.title_en as meeting_title_en,
        (SELECT COUNT(*) FROM resolution_followups WHERE resolution_id=r.id) as followup_count
      FROM resolutions r
      LEFT JOIN meetings m ON r.meeting_id = m.id
      ORDER BY r.created_at DESC LIMIT 8
    `).all();
    const upcoming = db.prepare(`
      SELECT title_ar,title_en,meeting_date,meeting_time,meeting_type
      FROM schedule WHERE meeting_date >= date('now')
      ORDER BY meeting_date ASC LIMIT 5
    `).all();
    res.json({ boards, committees, resTotal, resPending, resApproved, resRejected, resDeferred,
               quorumAchieved, quorumTotal, generalAssemblies, openActions, pendingMinutes,
               recentRes, upcoming });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── General Assemblies ────────────────────────────────────────────────────────
router.get('/general-assemblies', auth, (req, res) => {
  try {
    const gas = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM resolutions     WHERE schedule_id=s.id) as resolution_count,
        (SELECT COUNT(*) FROM agenda_items    WHERE schedule_id=s.id) as agenda_count,
        (SELECT COUNT(*) FROM ga_shareholders WHERE ga_schedule_id=s.id) as shareholder_count,
        (SELECT SUM(shares) FROM ga_shareholders WHERE ga_schedule_id=s.id) as total_shares,
        (SELECT json_group_array(json_object('role',role,'role_ar',role_ar,'name_en',name_en,'name_ar',name_ar))
         FROM ga_officers WHERE ga_schedule_id=s.id) as officers_json,
        mq.quorum_achieved, mq.required_members as quorum_required,
        mq.present_members as quorum_present, mq.notes as quorum_notes,
        gm.status as minutes_status, gm.draft_date as minutes_draft_date,
        gm.circulated_date as minutes_circulated_date, gm.approved_date as minutes_approved_date,
        gm.final_date as minutes_final_date
      FROM schedule s
      LEFT JOIN meeting_quorum mq ON mq.schedule_id=s.id
      LEFT JOIN ga_minutes gm ON gm.ga_schedule_id=s.id
      WHERE s.meeting_type='general_assembly'
      ORDER BY s.meeting_date ASC
    `).all();
    res.json(gas);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/gov/resolutions/:id/votes — full voting history + quorum + CEO "who hasn't voted" view
router.get('/resolutions/:id/votes', auth, (req, res) => {
  try {
    const resolution = db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id);
    if (!resolution) return res.status(404).json({ error: 'Not found' });
    const votes = db.prepare('SELECT * FROM votes WHERE resolution_id=? ORDER BY updated_at DESC').all(req.params.id);
    const approve = votes.filter(v => v.vote === 'approve').length;
    const reject  = votes.filter(v => v.vote === 'reject').length;
    const abstain = votes.filter(v => v.vote === 'abstain').length;
    const total   = votes.length;
    const pct = n => total > 0 ? Math.round((n / total) * 100) : 0;
    // Attendees for quorum + who-hasn't-voted (cross-reference by email)
    let attendees = [];
    if (resolution.meeting_id) {
      attendees = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id=?').all(resolution.meeting_id);
    }
    const voterEmailSet = new Set();
    votes.forEach(v => {
      const u = db.prepare('SELECT email FROM users WHERE id=?').get(v.voter_id);
      if (u && u.email) voterEmailSet.add(u.email.toLowerCase());
    });
    const not_voted     = attendees.filter(a => !voterEmailSet.has((a.email||'').toLowerCase()));
    const quorum_total  = attendees.length;
    const quorum_needed = quorum_total > 0 ? Math.ceil(quorum_total / 2) : 0;
    const quorum_met    = quorum_total > 0 && total >= quorum_needed;
    const quorum_pct    = quorum_total > 0 ? Math.round((total / quorum_total) * 100) : 0;
    res.json({
      votes, total, approve, reject, abstain,
      approve_pct: pct(approve), reject_pct: pct(reject), abstain_pct: pct(abstain),
      passed: approve > reject && total > 0,
      quorum_total, quorum_needed, quorum_met, quorum_pct,
      not_voted, attendees,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/gov/resolutions/:id/voting-status — open / close / archive voting
router.post('/resolutions/:id/voting-status', auth, (req, res) => {
  const { status } = req.body;
  if (!['draft','open','closed','archived'].includes(status))
    return res.status(400).json({ error: 'Invalid voting status' });
  db.prepare('UPDATE resolutions SET voting_status=? WHERE id=?').run(status, req.params.id);
  if (status === 'closed') {
    const r = db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id);
    if (!r.status || r.status === 'pending') {
      const derived = (r.votes_approve||0) > (r.votes_reject||0) ? 'approved'
        : (r.votes_reject||0) > (r.votes_approve||0) ? 'rejected' : 'pending';
      db.prepare('UPDATE resolutions SET status=? WHERE id=?').run(derived, req.params.id);
    }
  }
  res.json(withFollowups(db.prepare('SELECT * FROM resolutions WHERE id=?').get(req.params.id)));
});

// ════════════════════════════════════════════════════════════════════════════
//  GENERAL ASSEMBLY — Full CRUD (shareholders, votes, officers, minutes, docs)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/gov/general-assemblies/:id/detail — comprehensive GA report
router.get('/general-assemblies/:id/detail', auth, (req, res) => {
  try {
    const gaId = parseInt(req.params.id);
    const ga = db.prepare("SELECT * FROM schedule WHERE id=? AND meeting_type='general_assembly'").get(gaId);
    if (!ga) return res.status(404).json({ error: 'GA not found' });

    const shareholders = db.prepare('SELECT * FROM ga_shareholders WHERE ga_schedule_id=? ORDER BY shares DESC').all(gaId);
    const gaVotes      = db.prepare('SELECT * FROM ga_votes WHERE ga_schedule_id=? ORDER BY sort_order,id').all(gaId);
    const officers     = db.prepare('SELECT * FROM ga_officers WHERE ga_schedule_id=? ORDER BY id').all(gaId);
    const agenda       = db.prepare('SELECT * FROM agenda_items WHERE schedule_id=? ORDER BY sort_order,id').all(gaId);
    const resolutions  = db.prepare(`
      SELECT r.*,
        (SELECT json_group_array(json_object('id',rf.id,'owner',rf.owner,'due_date',rf.due_date,'status',rf.status,'notes',rf.notes))
         FROM resolution_followups rf WHERE rf.resolution_id=r.id) as followups_json
      FROM resolutions r WHERE r.schedule_id=? ORDER BY r.id
    `).all(gaId);
    const documents    = db.prepare('SELECT * FROM meeting_documents WHERE schedule_id=? ORDER BY upload_date DESC,id DESC').all(gaId);
    const minutes      = db.prepare('SELECT * FROM ga_minutes WHERE ga_schedule_id=?').get(gaId);

    // Share-based quorum
    const totalShares   = shareholders.reduce((s, sh) => s + (sh.shares || 0), 0);
    const presentShares = shareholders.filter(sh => ['present','proxy'].includes(sh.attendance_status))
                                       .reduce((s, sh) => s + (sh.shares || 0), 0);
    const quorumPct = totalShares > 0 ? Math.round((presentShares / totalShares) * 100) : 0;
    const year = (ga.meeting_date || '2026').substring(0, 4);

    // Shape shareholders → frontend _gaDemo format
    const shareholdersOut = shareholders.map(sh => ({
      id: sh.id, ga_schedule_id: gaId,
      nameAr: sh.name_ar || sh.name_en, nameEn: sh.name_en,
      shares: sh.shares, pct: sh.share_pct,
      voteRights: sh.vote_rights || sh.shares,
      attendance: sh.attendance_status,
      proxy: sh.proxy_name || '—', notes: sh.notes || '',
    }));

    // Shape GA votes
    const votesOut = gaVotes.map(v => {
      const tot = v.total_votes || (v.votes_for + v.votes_against + v.votes_abstain);
      return { id: v.id, ga_schedule_id: gaId,
        motionAr: v.motion_ar || v.motion_en, motionEn: v.motion_en,
        for: v.votes_for, against: v.votes_against, abstain: v.votes_abstain,
        total: tot, passed: v.passed === 1, notes: v.notes || '' };
    });

    // Shape agenda
    const agendaOut = agenda.map((ag, i) => ({
      id: ag.id, no: ag.sort_order || (i + 1),
      titleAr: ag.title, titleEn: ag.title,
      presenter: ag.presenter || '—', status: 'approved',
    }));

    // Shape resolutions
    const resolutionsOut = resolutions.map((r, i) => {
      const fus = r.followups_json ? JSON.parse(r.followups_json).filter(Boolean) : [];
      const fu  = fus[0] || {};
      return { id: r.id,
        no: 'GA-' + year + '-' + String(i + 1).padStart(3, '0'),
        descAr: r.title, descEn: r.title,
        ownerAr: fu.owner || '—', ownerEn: fu.owner || '—',
        due: fu.due_date || '',
        status: r.status || 'pending',
        votes_approve: r.votes_approve || 0, votes_reject: r.votes_reject || 0 };
    });

    // Minutes workflow steps
    const m = minutes || {};
    const minutesWorkflow = [
      { stepAr:'مسودة',            stepEn:'Draft',                icon:'📄', done:!!m.draft_date,       doneBy:m.draft_by||null, date:m.draft_date||null },
      { stepAr:'مراجعة أمين السر', stepEn:'Secretary Review',    icon:'🔍', done:!!m.circulated_date,  doneBy:null,             date:m.circulated_date||null },
      { stepAr:'مراجعة الرئيس',    stepEn:'Chairman Review',     icon:'👑', done:!!m.approved_date,    doneBy:null,             date:m.approved_date||null },
      { stepAr:'موافقة المساهمين', stepEn:'Shareholder Approval',icon:'🗳', done:!!m.final_date,       doneBy:null,             date:m.final_date||null },
      { stepAr:'اعتماد نهائي',     stepEn:'Final Approved',      icon:'✅', done:m.status==='final',   doneBy:null,             date:m.final_date||null },
    ];

    // Shape documents
    const iconMap = { notice:'📨', agenda:'📋', board_pack:'📦', financial:'💰', minutes:'📝' };
    const documentsOut = documents.map(d => ({
      id: d.id, icon: iconMap[d.doc_type] || '📄',
      nameAr: d.title, nameEn: d.title,
      date: (d.upload_date || d.created_at || '').substring(0, 10),
      status: d.status || 'draft', by: d.uploaded_by || '—', doc_type: d.doc_type,
    }));

    // Action items from resolution followups
    const followups = db.prepare(`
      SELECT rf.*, r.title as res_title FROM resolution_followups rf
      JOIN resolutions r ON rf.resolution_id=r.id
      WHERE r.schedule_id=? ORDER BY rf.due_date ASC
    `).all(gaId);
    const actionItemsOut = followups.map(f => ({
      id: f.id,
      descAr: f.notes || f.res_title || '', descEn: f.notes || f.res_title || '',
      ownerAr: f.owner || '—', ownerEn: f.owner || '—',
      priority: 'normal', due: f.due_date || '',
      progress: f.status === 'completed' ? 100 : f.status === 'in_progress' ? 60 : 20,
    }));

    // Timeline derived from GA data
    const today = new Date().toISOString().substring(0, 10);
    const isHeld = !!(ga.meeting_date && ga.meeting_date <= today);
    const noticeDoc = documents.find(d => d.doc_type === 'notice');
    const timeline = [
      { eventAr:'إنشاء الجمعية',        eventEn:'GA Created',       icon:'🏗', done:true,     date:(ga.created_at||'').substring(0,10) },
      { eventAr:'إصدار الإشعار الرسمي', eventEn:'Notice Issued',    icon:'📨', done:!!noticeDoc, date:noticeDoc?(noticeDoc.upload_date||'').substring(0,10):null },
      { eventAr:'توزيع وثائق الجمعية',  eventEn:'Documents Shared', icon:'📦', done:documents.some(d=>d.status==='approved'), date:null },
      { eventAr:'انعقاد الجمعية',        eventEn:'GA Held',          icon:'🏢', done:isHeld,   date:ga.meeting_date||null },
      { eventAr:'إغلاق التصويت',         eventEn:'Voting Closed',    icon:'🗳', done:isHeld&&gaVotes.some(v=>v.total_votes>0), date:isHeld?ga.meeting_date:null },
      { eventAr:'اعتماد المحضر',         eventEn:'Minutes Approved', icon:'✅', done:!!(m.approved_date), date:m.approved_date||null },
      { eventAr:'أرشفة الوثائق',         eventEn:'Archived',         icon:'🗄', done:ga.status==='archived', date:null },
    ];

    const officersOut = officers.map(o => ({
      id: o.id, role: o.role, roleAr: o.role_ar || o.role,
      nameAr: o.name_ar || o.name_en, nameEn: o.name_en,
    }));

    res.json({
      ga, quorum: { totalShares, sharesPresent: presentShares, required: 50, pct: quorumPct, achieved: quorumPct >= 50 },
      shareholders: shareholdersOut, votes: votesOut, agenda: agendaOut,
      resolutions: resolutionsOut, minutesWorkflow, documents: documentsOut,
      actionItems: actionItemsOut, timeline, officers: officersOut, minutes,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/gov/general-assemblies — create new GA
router.post('/general-assemblies', auth, (req, res) => {
  try {
    const { title_ar, title_en, ga_type, meeting_date, meeting_time, duration_mins, platform, attendees } = req.body;
    if (!title_ar || !meeting_date) return res.status(400).json({ error: 'title_ar and meeting_date required' });
    const row = db.prepare(`
      INSERT INTO schedule (title_ar,title_en,meeting_date,meeting_time,duration_mins,platform,attendees,created_by,meeting_type,status)
      VALUES (?,?,?,?,?,?,?,?,'general_assembly','draft')
    `).run(title_ar, title_en||title_ar, meeting_date, meeting_time||'10:00', duration_mins||120, platform||'', attendees||0, req.user.id);
    const gaId = row.lastInsertRowid;
    db.prepare(`INSERT OR IGNORE INTO ga_minutes (ga_schedule_id,status) VALUES (?,?)`).run(gaId,'draft');
    res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(gaId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/gov/general-assemblies/:id — update GA header
router.patch('/general-assemblies/:id', auth, (req, res) => {
  try {
    const { title_ar, title_en, meeting_date, meeting_time, duration_mins, platform, attendees, status } = req.body;
    db.prepare(`UPDATE schedule SET title_ar=COALESCE(?,title_ar),title_en=COALESCE(?,title_en),
      meeting_date=COALESCE(?,meeting_date),meeting_time=COALESCE(?,meeting_time),
      duration_mins=COALESCE(?,duration_mins),platform=COALESCE(?,platform),
      attendees=COALESCE(?,attendees),status=COALESCE(?,status) WHERE id=?`)
      .run(title_ar||null,title_en||null,meeting_date||null,meeting_time||null,
           duration_mins||null,platform||null,attendees||null,status||null,req.params.id);
    res.json(db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shareholders CRUD ─────────────────────────────────────────────────────────
router.get('/general-assemblies/:id/shareholders', auth, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM ga_shareholders WHERE ga_schedule_id=? ORDER BY shares DESC').all(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/general-assemblies/:id/shareholders', auth, (req, res) => {
  try {
    const { name_ar, name_en, shares, share_pct, vote_rights, attendance_status, proxy_name, notes } = req.body;
    if (!name_en) return res.status(400).json({ error: 'name_en required' });
    const sharesN = Number(shares);
    if (!Number.isFinite(sharesN) || sharesN < 1) return res.status(400).json({ error: 'shares must be a number of at least 1' });
    const pctN = Number(share_pct);
    if (!Number.isFinite(pctN) || pctN <= 0 || pctN > 100) return res.status(400).json({ error: 'share_pct must be a number between 0.01 and 100' });
    const row = db.prepare(`INSERT INTO ga_shareholders (ga_schedule_id,name_ar,name_en,shares,share_pct,vote_rights,attendance_status,proxy_name,notes)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, name_ar||name_en, name_en, sharesN, pctN, vote_rights||sharesN, attendance_status||'pending', proxy_name||null, notes||null);
    res.json(db.prepare('SELECT * FROM ga_shareholders WHERE id=?').get(row.lastInsertRowid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.patch('/ga-shareholders/:id', auth, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM ga_shareholders WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name_ar, name_en, shares, share_pct, vote_rights, attendance_status, proxy_name, notes } = req.body;
    let sharesN = null;
    if (shares !== undefined && shares !== null && shares !== '') {
      sharesN = Number(shares);
      if (!Number.isFinite(sharesN) || sharesN < 1) return res.status(400).json({ error: 'shares must be a number of at least 1' });
    }
    let pctN = null;
    if (share_pct !== undefined && share_pct !== null && share_pct !== '') {
      pctN = Number(share_pct);
      if (!Number.isFinite(pctN) || pctN <= 0 || pctN > 100) return res.status(400).json({ error: 'share_pct must be a number between 0.01 and 100' });
    }
    db.prepare(`UPDATE ga_shareholders SET name_ar=COALESCE(?,name_ar),name_en=COALESCE(?,name_en),
      shares=COALESCE(?,shares),share_pct=COALESCE(?,share_pct),vote_rights=COALESCE(?,vote_rights),
      attendance_status=COALESCE(?,attendance_status),proxy_name=COALESCE(?,proxy_name),notes=COALESCE(?,notes) WHERE id=?`)
      .run(name_ar||null,name_en||null,sharesN,pctN,vote_rights??null,attendance_status||null,proxy_name||null,notes||null,req.params.id);
    res.json(db.prepare('SELECT * FROM ga_shareholders WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/ga-shareholders/:id', auth, (req, res) => {
  try { db.prepare('DELETE FROM ga_shareholders WHERE id=?').run(req.params.id); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GA Votes CRUD ─────────────────────────────────────────────────────────────
router.get('/general-assemblies/:id/ga-votes', auth, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM ga_votes WHERE ga_schedule_id=? ORDER BY sort_order,id').all(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/general-assemblies/:id/ga-votes', auth, (req, res) => {
  try {
    const { motion_ar, motion_en, votes_for=0, votes_against=0, votes_abstain=0, notes, sort_order } = req.body;
    if (!motion_en && !motion_ar) return res.status(400).json({ error: 'motion required' });
    const tot = (votes_for||0)+(votes_against||0)+(votes_abstain||0);
    const row = db.prepare(`INSERT INTO ga_votes (ga_schedule_id,motion_ar,motion_en,votes_for,votes_against,votes_abstain,total_votes,passed,notes,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, motion_ar||motion_en, motion_en||motion_ar, votes_for, votes_against, votes_abstain,
           tot, votes_for > votes_against ? 1:0, notes||null, sort_order||0);
    res.json(db.prepare('SELECT * FROM ga_votes WHERE id=?').get(row.lastInsertRowid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.patch('/ga-votes/:id', auth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM ga_votes WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { motion_ar, motion_en, votes_for, votes_against, votes_abstain, notes, sort_order } = req.body;
    const vf = votes_for    !== undefined ? Number(votes_for)    : existing.votes_for;
    const va = votes_against!== undefined ? Number(votes_against): existing.votes_against;
    const vb = votes_abstain!== undefined ? Number(votes_abstain): existing.votes_abstain;
    db.prepare(`UPDATE ga_votes SET motion_ar=COALESCE(?,motion_ar),motion_en=COALESCE(?,motion_en),
      votes_for=?,votes_against=?,votes_abstain=?,total_votes=?,passed=?,
      notes=COALESCE(?,notes),sort_order=COALESCE(?,sort_order) WHERE id=?`)
      .run(motion_ar||null,motion_en||null,vf,va,vb,vf+va+vb,vf>va?1:0,notes||null,sort_order??null,req.params.id);
    res.json(db.prepare('SELECT * FROM ga_votes WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/ga-votes/:id', auth, (req, res) => {
  try { db.prepare('DELETE FROM ga_votes WHERE id=?').run(req.params.id); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Officers CRUD ─────────────────────────────────────────────────────────────
router.get('/general-assemblies/:id/officers', auth, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM ga_officers WHERE ga_schedule_id=? ORDER BY id').all(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/general-assemblies/:id/officers', auth, (req, res) => {
  try {
    const { role, role_ar, name_en, name_ar } = req.body;
    if (!name_en || !role) return res.status(400).json({ error: 'name_en and role required' });
    const row = db.prepare(`INSERT INTO ga_officers (ga_schedule_id,role,role_ar,name_en,name_ar) VALUES (?,?,?,?,?)`)
      .run(req.params.id, role, role_ar||role, name_en, name_ar||name_en);
    res.json(db.prepare('SELECT * FROM ga_officers WHERE id=?').get(row.lastInsertRowid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.patch('/ga-officers/:id', auth, (req, res) => {
  try {
    if (!db.prepare('SELECT id FROM ga_officers WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { role, role_ar, name_en, name_ar } = req.body;
    db.prepare(`UPDATE ga_officers SET role=COALESCE(?,role),role_ar=COALESCE(?,role_ar),name_en=COALESCE(?,name_en),name_ar=COALESCE(?,name_ar) WHERE id=?`)
      .run(role||null,role_ar||null,name_en||null,name_ar||null,req.params.id);
    res.json(db.prepare('SELECT * FROM ga_officers WHERE id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/ga-officers/:id', auth, (req, res) => {
  try { db.prepare('DELETE FROM ga_officers WHERE id=?').run(req.params.id); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Minutes workflow PATCH ────────────────────────────────────────────────────
router.patch('/general-assemblies/:id/minutes', auth, (req, res) => {
  try {
    const { status, draft_date, circulated_date, approved_date, final_date, draft_by, notes } = req.body;
    const validStatuses = ['draft', 'circulated', 'approved', 'final'];
    if (status !== undefined && status !== null && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'status must be one of: ' + validStatuses.join(', ') });
    }
    if (!db.prepare("SELECT id FROM schedule WHERE id=? AND meeting_type='general_assembly'").get(req.params.id)) {
      return res.status(404).json({ error: 'GA not found' });
    }
    db.prepare(`INSERT INTO ga_minutes (ga_schedule_id,status,draft_date,circulated_date,approved_date,final_date,draft_by,notes)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(ga_schedule_id) DO UPDATE SET
        status=COALESCE(excluded.status,status),draft_date=COALESCE(excluded.draft_date,draft_date),
        circulated_date=COALESCE(excluded.circulated_date,circulated_date),
        approved_date=COALESCE(excluded.approved_date,approved_date),
        final_date=COALESCE(excluded.final_date,final_date),
        draft_by=COALESCE(excluded.draft_by,draft_by),notes=COALESCE(excluded.notes,notes)`)
      .run(req.params.id,status||null,draft_date||null,circulated_date||null,approved_date||null,final_date||null,draft_by||null,notes||null);
    res.json(db.prepare('SELECT * FROM ga_minutes WHERE ga_schedule_id=?').get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
