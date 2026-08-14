'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');

const TERMS_VERSION = '2026-08-11';
const APPLICATION_STATES = new Set(['pending_email', 'pending_church', 'pending_review', 'verified', 'rejected', 'suspended', 'revoked']);

function init() {
  const identityCols = db.prepare('PRAGMA table_info(user_identities)').all().map(c => c.name);
  if (!identityCols.includes('email_verified')) db.exec('ALTER TABLE user_identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');

  const churchCols = db.prepare('PRAGMA table_info(churches)').all().map(c => c.name);
  const addChurch = (name, ddl) => { if (!churchCols.includes(name)) db.exec(`ALTER TABLE churches ADD COLUMN ${ddl}`); };
  addChurch('source', "source TEXT NOT NULL DEFAULT 'osm'");
  addChurch('verification_status', "verification_status TEXT NOT NULL DEFAULT 'unverified'");
  addChurch('submitted_by', 'submitted_by TEXT');
  addChurch('address', 'address TEXT');
  addChurch('contact_email', 'contact_email TEXT');
  addChurch('contact_verified_at', 'contact_verified_at TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS developer_applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      edu_email TEXT NOT NULL,
      edu_email_verified_at TEXT,
      church_id TEXT NOT NULL,
      church_contact_email TEXT NOT NULL,
      church_verified_at TEXT,
      project_name TEXT NOT NULL,
      project_purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_email',
      terms_version TEXT NOT NULL,
      terms_accepted_at TEXT NOT NULL,
      accountability_accepted_at TEXT NOT NULL,
      content_standard_accepted_at TEXT NOT NULL,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_developer_app_status ON developer_applications(status, created_at);

    CREATE TABLE IF NOT EXISTS developer_content_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      video_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      community_purpose TEXT NOT NULL,
      rights_attested_at TEXT NOT NULL,
      no_vanity_attested_at TEXT NOT NULL,
      moderation_status TEXT NOT NULL DEFAULT 'pending',
      moderation_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      UNIQUE(provider, video_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_developer_content_status ON developer_content_submissions(moderation_status, created_at);

    CREATE TABLE IF NOT EXISTS developer_enforcement_cases (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      finding TEXT NOT NULL,
      legal_reference TEXT,
      evidence_summary TEXT NOT NULL,
      action TEXT NOT NULL,
      member_notified_at TEXT NOT NULL,
      church_notification_status TEXT NOT NULL DEFAULT 'not_requested',
      church_notified_at TEXT,
      reviewer TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS church_notification_outbox (
      id TEXT PRIMARY KEY,
      enforcement_case_id TEXT NOT NULL,
      church_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );
  `);
}

function normaliseEmail(value) { return String(value || '').trim().toLowerCase(); }
function isEduEmail(value) {
  const email = normaliseEmail(value);
  const at = email.lastIndexOf('@');
  return at > 0 && /^[a-z0-9.-]+\.edu$/i.test(email.slice(at + 1));
}

function verifiedIdentity(userId, email) {
  return db.prepare(`SELECT provider, email FROM user_identities
    WHERE user_id = ? AND lower(email) = ? AND email_verified = 1
    ORDER BY linked_at DESC LIMIT 1`).get(userId, normaliseEmail(email));
}

function deriveStatus(application) {
  if (!application) return 'not_applied';
  if (['verified', 'rejected', 'suspended', 'revoked'].includes(application.status)) return application.status;
  if (!application.edu_email_verified_at) return 'pending_email';
  if (!application.church_verified_at) return 'pending_church';
  return 'pending_review';
}

function get(userId) {
  const application = db.prepare(`SELECT da.*, c.name church_name, c.verification_status church_status,
      c.source church_source, c.address church_address
    FROM developer_applications da JOIN churches c ON c.id = da.church_id
    WHERE da.user_id = ?`).get(userId) || null;
  if (!application) return { status: 'not_applied', eligible: false, terms_version: TERMS_VERSION };
  const status = deriveStatus(application);
  return {
    ...application,
    status,
    eligible: status === 'verified',
    edu_email_verified: !!application.edu_email_verified_at,
    church_verified: !!application.church_verified_at,
    terms_current: application.terms_version === TERMS_VERSION,
  };
}

function apply(userId, input) {
  const user = db.prepare('SELECT email, church_osm_id, church_name FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('user_not_found'), { code: 'user_not_found' });
  const eduEmail = normaliseEmail(input.edu_email || user.email);
  if (!isEduEmail(eduEmail)) throw Object.assign(new Error('A verified .edu address is required.'), { code: 'edu_email_required' });
  if (![normaliseEmail(user.email), ...db.prepare('SELECT lower(email) email FROM user_identities WHERE user_id = ?').all(userId).map(r => r.email)].includes(eduEmail)) {
    throw Object.assign(new Error('Link or register with that .edu address before applying.'), { code: 'edu_email_not_linked' });
  }
  if (!input.terms_accepted || !input.accountability_accepted || !input.content_standard_accepted) {
    throw Object.assign(new Error('All developer attestations are required.'), { code: 'attestation_required' });
  }
  const churchId = String(input.church_id || '').trim();
  const church = churchId
    ? db.prepare('SELECT * FROM churches WHERE id = ?').get(churchId)
    : user.church_osm_id ? db.prepare('SELECT * FROM churches WHERE osm_id = ?').get(user.church_osm_id) : null;
  if (!church) throw Object.assign(new Error('Select or submit a church before applying.'), { code: 'church_required' });
  const churchContact = normaliseEmail(input.church_contact_email || church.contact_email);
  if (!/^\S+@\S+\.\S+$/.test(churchContact)) throw Object.assign(new Error('A church contact email is required.'), { code: 'church_contact_required' });
  const projectName = String(input.project_name || '').trim().slice(0, 100);
  const projectPurpose = String(input.project_purpose || '').trim().slice(0, 1000);
  if (!projectName || projectPurpose.length < 30) throw Object.assign(new Error('Describe the project and its community purpose.'), { code: 'project_details_required' });

  const identity = verifiedIdentity(userId, eduEmail);
  const eduVerifiedAt = identity ? new Date().toISOString() : null;
  const churchVerifiedAt = church.verification_status === 'verified' && church.contact_verified_at ? church.contact_verified_at : null;
  const status = !eduVerifiedAt ? 'pending_email' : !churchVerifiedAt ? 'pending_church' : 'pending_review';
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM developer_applications WHERE user_id = ?').get(userId);
  const id = existing?.id || randomUUID();
  db.prepare(`INSERT INTO developer_applications
      (id,user_id,edu_email,edu_email_verified_at,church_id,church_contact_email,church_verified_at,
       project_name,project_purpose,status,terms_version,terms_accepted_at,accountability_accepted_at,content_standard_accepted_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      edu_email=excluded.edu_email, edu_email_verified_at=excluded.edu_email_verified_at,
      church_id=excluded.church_id, church_contact_email=excluded.church_contact_email,
      church_verified_at=excluded.church_verified_at, project_name=excluded.project_name,
      project_purpose=excluded.project_purpose, status=excluded.status,
      terms_version=excluded.terms_version, terms_accepted_at=excluded.terms_accepted_at,
      accountability_accepted_at=excluded.accountability_accepted_at,
      content_standard_accepted_at=excluded.content_standard_accepted_at,
      updated_at=excluded.updated_at, reviewed_at=NULL, review_note=NULL`)
    .run(id,userId,eduEmail,eduVerifiedAt,church.id,churchContact,churchVerifiedAt,projectName,projectPurpose,status,
      TERMS_VERSION,now,now,now,now);
  return get(userId);
}

function requireVerified(userId) {
  const record = get(userId);
  if (!record.eligible || !record.terms_current) {
    const err = new Error('Developer verification is required before using developer keys or publishing developer content.');
    err.code = 'developer_verification_required';
    err.verification = record;
    throw err;
  }
  return record;
}

function createChurch(userId, input) {
  const name = String(input.name || '').trim().slice(0, 140);
  const address = String(input.address || '').trim().slice(0, 240);
  const contactEmail = normaliseEmail(input.contact_email);
  if (name.length < 3 || !address) throw Object.assign(new Error('Church name and address are required.'), { code: 'church_details_required' });
  if (!/^\S+@\S+\.\S+$/.test(contactEmail)) throw Object.assign(new Error('A public church contact email is required.'), { code: 'church_contact_required' });
  let website = null;
  if (input.website_url) {
    try { const u = new URL(String(input.website_url)); if (u.protocol !== 'https:') throw new Error(); website = u.toString().slice(0, 300); }
    catch { throw Object.assign(new Error('Use the church\'s public HTTPS website.'), { code: 'invalid_church_website' }); }
  }
  const id = randomUUID();
  const osmId = `submitted:${id}`;
  db.prepare(`INSERT INTO churches
    (id,osm_id,name,website_url,source,verification_status,submitted_by,address,contact_email)
    VALUES (?,?,?,?, 'user_submitted','pending',?,?,?)`)
    .run(id,osmId,name,website,userId,address,contactEmail);
  db.prepare(`UPDATE users SET church_osm_id=?, church_name=?, church_address=? WHERE id=?`)
    .run(osmId,name,address,userId);
  return db.prepare('SELECT * FROM churches WHERE id = ?').get(id);
}

function review(applicationId, input) {
  const decision = String(input.decision || '').trim();
  if (!APPLICATION_STATES.has(decision) || !['verified','rejected','suspended','revoked'].includes(decision)) {
    throw Object.assign(new Error('Invalid review decision.'), { code: 'invalid_decision' });
  }
  const app = db.prepare('SELECT * FROM developer_applications WHERE id = ?').get(applicationId);
  if (!app) throw Object.assign(new Error('Application not found.'), { code: 'not_found' });
  if (decision === 'verified' && (!input.edu_email_verified || !input.church_verified)) {
    throw Object.assign(new Error('Both identity checks must be explicitly confirmed.'), { code: 'verification_evidence_required' });
  }
  const now = new Date().toISOString();
  if (input.church_verified) {
    db.prepare(`UPDATE churches SET verification_status='verified', contact_verified_at=?, contact_email=? WHERE id=?`)
      .run(now, app.church_contact_email, app.church_id);
  }
  db.prepare(`UPDATE developer_applications SET status=?, edu_email_verified_at=CASE WHEN ? THEN ? ELSE edu_email_verified_at END,
    church_verified_at=CASE WHEN ? THEN ? ELSE church_verified_at END, reviewed_at=?, review_note=?, updated_at=? WHERE id=?`)
    .run(decision,input.edu_email_verified?1:0,now,input.church_verified?1:0,now,now,String(input.note||'').slice(0,1000),now,applicationId);
  return get(app.user_id);
}

const CONTENT_CATEGORIES = new Set(['motivation','inklings','prairie','edits','shortfilm','highway','fitness','food','kids']);
function parseVideo(raw) {
  let u; try { u = new URL(String(raw || '')); } catch { return null; }
  let provider, videoId;
  if (u.hostname === 'youtu.be') { provider='youtube'; videoId=u.pathname.slice(1); }
  else if (/(^|\.)youtube\.com$/.test(u.hostname)) { provider='youtube'; videoId=u.searchParams.get('v') || (/^\/shorts\/([^/]+)/.exec(u.pathname)||[])[1]; }
  else if (/(^|\.)vimeo\.com$/.test(u.hostname)) { provider='vimeo'; videoId=(/^\/(\d+)/.exec(u.pathname)||[])[1]; }
  if (provider === 'youtube' && !/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return null;
  if (provider === 'vimeo' && !/^\d{6,12}$/.test(videoId || '')) return null;
  return provider ? { provider, videoId, sourceUrl:u.toString() } : null;
}

function submitContent(userId, input) {
  requireVerified(userId);
  const parsed=parseVideo(input.source_url);
  if(!parsed) throw Object.assign(new Error('Use a valid YouTube or Vimeo video URL.'),{code:'invalid_video_url'});
  const title=String(input.title||'').trim().slice(0,160);
  const category=String(input.category||'').trim();
  const purpose=String(input.community_purpose||'').trim().slice(0,1000);
  if(!title||!CONTENT_CATEGORIES.has(category)||purpose.length<30) throw Object.assign(new Error('Title, approved category, and a clear community purpose are required.'),{code:'content_details_required'});
  if(!input.rights_attested||!input.no_vanity_attested) throw Object.assign(new Error('Rights and community-purpose attestations are required.'),{code:'content_attestation_required'});
  const id=randomUUID(),now=new Date().toISOString();
  db.prepare(`INSERT INTO developer_content_submissions
    (id,user_id,provider,video_id,source_url,title,category,community_purpose,rights_attested_at,no_vanity_attested_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,userId,parsed.provider,parsed.videoId,parsed.sourceUrl,title,category,purpose,now,now);
  return db.prepare('SELECT * FROM developer_content_submissions WHERE id=?').get(id);
}

function listContent(userId) {
  return db.prepare('SELECT * FROM developer_content_submissions WHERE user_id=? ORDER BY created_at DESC').all(userId);
}

function reviewContent(id, input) {
  const row=db.prepare('SELECT * FROM developer_content_submissions WHERE id=?').get(id);
  if(!row) throw Object.assign(new Error('Submission not found.'),{code:'not_found'});
  const status=String(input.decision||'');
  if(!['approved','rejected'].includes(status)) throw Object.assign(new Error('Invalid decision.'),{code:'invalid_decision'});
  const now=new Date().toISOString();
  db.prepare('UPDATE developer_content_submissions SET moderation_status=?,moderation_note=?,reviewed_at=? WHERE id=?')
    .run(status,String(input.note||'').slice(0,1000),now,id);
  if(status==='approved') {
    const thumbnail=row.provider==='youtube'?`https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`:null;
    db.prepare(`INSERT INTO videos(id,category,video_id,title,description,thumbnail_url,channel_title,published_at,is_short,language_flag,source_kind,source_note,provider,source_url,last_checked_at)
      VALUES(?,?,?,?,?,?,?,?,1,0,'functioning_faith',?,?,?,?)
      ON CONFLICT(category,video_id) DO UPDATE SET title=excluded.title,description=excluded.description,
      source_kind='functioning_faith',source_note=excluded.source_note,provider=excluded.provider,source_url=excluded.source_url,dead_at=NULL,last_checked_at=excluded.last_checked_at`)
      .run(randomUUID(),row.category,row.video_id,row.title,row.community_purpose,thumbnail,'Functioning Faith Developers',now,`developer:${row.user_id}`,row.provider,row.source_url,now);
  }
  return db.prepare('SELECT * FROM developer_content_submissions WHERE id=?').get(id);
}

function enforce(applicationId,input) {
  const app=db.prepare(`SELECT da.*,c.id church_id,c.contact_email,c.name church_name FROM developer_applications da
    JOIN churches c ON c.id=da.church_id WHERE da.id=?`).get(applicationId);
  if(!app) throw Object.assign(new Error('Application not found.'),{code:'not_found'});
  if(!input.confirmed_serious_violation||!input.member_notified_at||!input.evidence_summary) {
    throw Object.assign(new Error('Confirmed finding, evidence summary, and prior member notice are required.'),{code:'due_process_required'});
  }
  const action=String(input.action||'suspended');
  if(!['suspended','revoked'].includes(action)) throw Object.assign(new Error('Invalid action.'),{code:'invalid_action'});
  const id=randomUUID(),now=new Date().toISOString();
  db.prepare(`INSERT INTO developer_enforcement_cases
    (id,application_id,user_id,finding,legal_reference,evidence_summary,action,member_notified_at,church_notification_status,reviewer)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,app.id,app.user_id,String(input.finding||'').slice(0,1000),String(input.legal_reference||'').slice(0,300),
      String(input.evidence_summary).slice(0,3000),action,String(input.member_notified_at),app.contact_email?'pending':'not_available',String(input.reviewer||'authorized reviewer').slice(0,120));
  db.prepare('UPDATE developer_applications SET status=?,reviewed_at=?,review_note=?,updated_at=? WHERE id=?')
    .run(action,now,`Enforcement case ${id}`,now,app.id);
  db.prepare("UPDATE api_keys SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL").run(app.user_id);
  db.prepare('UPDATE webhooks SET active=0 WHERE user_id=?').run(app.user_id);
  if(app.contact_email) db.prepare(`INSERT INTO church_notification_outbox
    (id,enforcement_case_id,church_id,recipient_email,subject,body) VALUES(?,?,?,?,?,?)`).run(randomUUID(),id,app.church_id,app.contact_email,
      'Functioning Faith verified developer accountability notice',
      `A developer verified in association with ${app.church_name} received a confirmed enforcement action after review and member notice. Case: ${id}. No allegation is sent before a reviewer confirms the finding.`);
  return { id,status:action,church_notification_status:app.contact_email?'pending':'not_available' };
}

async function dispatchChurchNotifications() {
  if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM) return {sent:0,configured:false};
  const rows=db.prepare("SELECT * FROM church_notification_outbox WHERE status='pending' ORDER BY created_at LIMIT 10").all();
  let sent=0;
  for(const row of rows){
    try{
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json'},
        body:JSON.stringify({from:process.env.EMAIL_FROM||'Functioning Faith <accountability@functioningfaith.com>',to:[row.recipient_email],subject:row.subject,text:row.body}),signal:AbortSignal.timeout(8000)});
      if(!response.ok) throw new Error(`email_${response.status}`);
      const now=new Date().toISOString();
      db.prepare("UPDATE church_notification_outbox SET status='sent',sent_at=?,last_error=NULL WHERE id=?").run(now,row.id);
      db.prepare("UPDATE developer_enforcement_cases SET church_notification_status='sent',church_notified_at=? WHERE id=?").run(now,row.enforcement_case_id);
      sent++;
    }catch(err){db.prepare("UPDATE church_notification_outbox SET status='failed',last_error=? WHERE id=?").run(String(err.message||err).slice(0,300),row.id);}
  }
  return {sent,configured:true};
}

function startNotifications(){if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return;dispatchChurchNotifications().catch(()=>{});const timer=setInterval(()=>dispatchChurchNotifications().catch(()=>{}),5*60*1000);timer.unref?.();}

module.exports = { init,get,apply,requireVerified,createChurch,review,submitContent,listContent,reviewContent,enforce,dispatchChurchNotifications,startNotifications,isEduEmail,TERMS_VERSION,CONTENT_CATEGORIES };
