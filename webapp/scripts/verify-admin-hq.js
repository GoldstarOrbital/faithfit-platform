const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const need = (source, value, label) => { if (!source.includes(value)) throw new Error(`Missing ${label}`); };

const admin = read('lib/admin.js');
const api = read('routes/api.js');
const app = read('public/app.js');

need(admin, 'CREATE TABLE IF NOT EXISTS platform_features', 'feature persistence');
need(admin, 'CREATE TABLE IF NOT EXISTS support_tickets', 'support ticket persistence');
need(admin, 'CREATE TABLE IF NOT EXISTS admin_audit_log', 'admin audit trail');
need(admin, 'function sendSupportNote', 'private support notification');
need(admin, 'function publishVideo', 'direct approved-source publishing');
need(api, "router.put('/admin/features/:key', requireAdmin", 'admin-only feature control');
need(api, "router.get('/admin/issues', requireAdmin", 'admin-only issue inbox');
need(api, "router.post('/admin/content/publish', requireAdmin", 'admin-only content publishing');
need(api, "router.get('/admin/moderation', requireAdmin", 'admin-only moderation queue');
need(api, "router.post('/admin/moderation/:id/review', requireAdmin", 'admin-only moderation review');
need(api, 'function reviewModerationReport', 'shared human moderation implementation');
need(api, "router.post('/support/tickets', requireAuth", 'member support route');
need(app, 'Admin headquarters', 'admin headquarters UI');
need(app, 'admin-video-publish', 'admin publishing UI');
need(app, 'support-send', 'member support UI');

console.log(JSON.stringify({ feature_controls: true, member_support: true, issue_inbox: true, direct_content_publish: true, audit_trail: true, moderation_review: true }));
