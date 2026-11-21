// These execute the actual migration in PostgreSQL, including roles, RLS, triggers and RPC bodies.
// Auth/storage fixtures emulate only their SQL contracts; they do not test GoTrue or Storage HTTP.
export async function runDatabaseTests(database, assert) {
  let assertions = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
  const ok = (value, message) => { assert.ok(value, message); assertions++; };
  const sql = (text, params = []) => database.query(text, params);
  const value = async (text, params = []) => (await sql(text, params)).rows[0]?.result;
  const denied = async (text, params = [], code = '42501') => {
    await assert.rejects(() => sql(text, params), (error) => error.code === code, `${code}: ${text}`);
    assertions++;
  };
  const ids = { owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002', outsider: '00000000-0000-4000-8000-000000000003' };
  const sessions = { owner: '10000000-0000-4000-8000-000000000001', editor: '10000000-0000-4000-8000-000000000002', outsider: '10000000-0000-4000-8000-000000000003' };
  const as = async (who, { aal = 'aal2', age = 0, role = 'authenticated', claims = {} } = {}) => {
    await database.exec('reset role');
    const jwt = who ? { sub: ids[who], session_id: sessions[who], aal, exp: Math.floor(Date.now() / 1000) + 3600,
      amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }, { method: 'totp', timestamp: Math.floor(Date.now() / 1000) - age }], ...claims } : {};
    await sql("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(jwt)]);
    await database.exec(`set role ${role}`);
  };
  const superuser = async () => database.exec('reset role');
  const resetQuotas = async () => { await superuser(); await database.exec('delete from private.quotas'); };
  const snapshot = () => value('select public.cms_public_snapshot() as result');
  const save = (record, expected = null) => value('select public.cms_save($1::uuid,$2,$3,$4,$5::jsonb,$6::uuid[],$7::int) as result',
    [record.id ?? null, record.kind, record.slug, record.title, JSON.stringify(record.payload), record.media_ids ?? [], expected]);
  const transition = (record, action, reason = 'Verified against chapter records') => value('select public.cms_transition($1::uuid,$2::int,$3,$4) as result', [record.id, record.version, action, reason]);
  const financeSave = (payload, version = null) => value('select public.cms_finance_save($1::jsonb,$2::int) as result', [JSON.stringify(payload), version]);
  const financePublish = (id, version) => value('select public.cms_finance_publish($1,$2::int,$3) as result', [id, version, 'Verified cash records and correction history']);
  const eventPayload = { iso: '2026-03-03', time: '9:00 AM', place: 'Chapter hall', state: 'completed', termId: '2026-A', host: 'Chapter', lead: 'Project lead', summary: 'Verified event summary', sections: [{ id: 'report', title: 'Report', paragraphs: ['Verified narrative'] }] };

  for (const who of Object.keys(ids)) {
    await sql("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),'{\"provider\":\"google\"}')", [ids[who], `${who}@example.test`]);
    await sql('insert into auth.sessions(id,user_id) values($1,$2)', [sessions[who], ids[who]]);
    await sql("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')", [ids[who]]);
  }
  await database.exec("insert into private.staff(email,role) values('owner@example.test','owner'),('editor@example.test','editor')");
  // Existing legacy data is preserved by the migration; test grants were revoked explicitly.
  const functions = await sql("select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like 'cms_%' or n.nspname='private')");
  for (const fn of functions.rows) {
    ok(fn.proconfig?.includes('search_path=""'), `${fn.signature} locks search_path`);
    ok(!fn.proacl?.some((entry) => entry.startsWith('=')), `${fn.signature} has no PUBLIC execute`);
    if (fn.signature.startsWith('cms_')) eq(fn.prosecdef, false, 'Public wrapper is SECURITY INVOKER');
  }
  eq(await value("select count(*)::int as result from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosrc like '%40001%'"), 0, 'Business conflicts never use retryable serialization codes');
  eq(await value("select count(*)::int as result from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosrc like '%PT409%'"), 11, 'All current business-conflict functions return PT409');
  eq(await value("select count(*)::int as result from pg_tables where schemaname='private' and not rowsecurity"), 0, 'All private tables enforce RLS');
  eq(await value('select title as result from public.articles where id=1'), 'Existing legacy content', 'Legacy data preserved');

  await as(null, { role: 'anon' });
  eq((await snapshot()).content, [], 'Anonymous initial snapshot is empty');
  eq((await snapshot()).finance, [], 'No demo data seeded');
  await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await denied('select * from private.staff');
  await denied('select * from public.articles');
  eq((await sql("select name from storage.objects where bucket_id='public-assets'")).rows, [{ name: 'existing-chapter-image.webp' }], 'Legacy public image remains readable');
  await denied("insert into storage.objects(bucket_id,name) values('public-assets','anonymous-upload.html')");
  eq((await sql("select * from storage.objects where bucket_id<>'public-assets'")).rows, [], 'Anonymous cannot list private storage');
  await denied('select private.require_staff()');
  await denied("select private.before_user_created('{}')");

  await as('outsider', { claims: { user_metadata: { role: 'owner' } } });
  await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await as('editor', { aal: 'aal1' });
  eq((await value('select public.cms_session() as result')).role, 'editor', 'Invited AAL1 can inspect own onboarding membership');
  await denied("select public.cms_list(null,'',1)");
  await denied('select public.cms_finance_list()');
  await denied('select public.cms_staff_list()');
  await as('editor', { claims: { exp: Math.floor(Date.now() / 1000) - 1 } });
  await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await as('editor', { claims: { exp: null } });
  await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql("update auth.mfa_factors set status='unverified' where user_id=$1", [ids.editor]);
  await as('editor'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql("update auth.mfa_factors set status='verified' where user_id=$1", [ids.editor]);
  await sql("update auth.users set raw_app_meta_data='{\"provider\":\"email\"}' where id=$1", [ids.editor]);
  await as('editor'); await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql("update auth.users set raw_app_meta_data='{\"provider\":\"google\"}' where id=$1", [ids.editor]);
  await as('editor');
  eq((await value("select public.cms_list(null,'',1) as result")).total, 0);
  await denied('select public.cms_staff_list()');
  await denied('select public.cms_backup_status()');
  await denied("select public.cms_record_backup(gen_random_uuid(),'success',now(),'manifest','')");
  await denied("select public.cms_media_upload_ready(gen_random_uuid(),$1,'bad','bad',100,100)", [ids.editor]);
  await denied('select * from private.content');
  await denied('select * from public.articles');
  await denied("insert into storage.objects(bucket_id,name) values('cms-public','forged.webp')");
  await denied("insert into storage.objects(bucket_id,name) values('public-assets','staff-bypass.html')");
  // Even accidentally granting table permissions does not bypass default-deny RLS.
  await superuser(); await database.exec('grant select,update on private.staff to authenticated');
  await as('editor');
  eq((await sql('select * from private.staff')).rows, []);
  eq((await sql("update private.staff set role='owner' returning email")).rows, []);
  await superuser(); await database.exec('revoke select,update on private.staff from authenticated');

  await as(null, { role: 'supabase_auth_admin' });
  const hook = (email, provider = 'google', anonymous = false) => value('select private.before_user_created($1::jsonb) as result', [JSON.stringify({ user: { email, app_metadata: { provider }, is_anonymous: anonymous } })]);
  eq(await hook('editor@example.test'), {});
  eq((await hook('outsider@example.test')).error.http_code, 403);
  eq((await hook('editor@example.test', 'email')).error.http_code, 403);
  eq((await hook('editor@example.test', 'google', true)).error.http_code, 403);
  await denied('select private.public_snapshot()');

  await as('owner', { age: 301 });
  await denied('select public.cms_staff_list()');
  await as('owner', { claims: { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] } });
  await denied('select public.cms_staff_list()');
  await as('owner', { age: -120 });
  await denied('select public.cms_staff_list()');
  await as('owner');
  eq((await value('select public.cms_staff_list() as result')).items.length, 2);
  await denied("select public.cms_staff_save('owner@example.test','editor',true)", [], '23514');
  await denied("select public.cms_staff_save('owner@example.test','owner',false)", [], '23514');
  await value("select public.cms_staff_save('editor@example.test','editor',false) as result");
  await as('editor'); await denied("select public.cms_list(null,'',1)");
  await as('owner'); await value("select public.cms_staff_save('editor@example.test','editor',true) as result");
  await as('editor'); eq((await value('select public.cms_session() as result')).active, true);

  await superuser(); await sql("update auth.sessions set not_after=now()-interval '1 minute' where id=$1", [sessions.editor]);
  await as('editor'); await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql('update auth.sessions set not_after=null where id=$1', [sessions.editor]);
  await sql("update private.session_activity set last_seen=now()-interval '31 minutes' where session_id=$1", [sessions.editor]);
  await as('editor'); await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql('update private.session_activity set last_seen=now() where session_id=$1', [sessions.editor]);
  await sql("update auth.sessions set created_at=now()-interval '9 hours' where id=$1", [sessions.editor]);
  await as('editor'); await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql('update auth.sessions set created_at=now() where id=$1', [sessions.editor]);
  await sql('delete from auth.sessions where id=$1', [sessions.editor]);
  await as('editor'); await denied('select public.cms_session()'); await denied("select public.cms_list(null,'',1)");
  await superuser(); await sql('insert into auth.sessions(id,user_id) values($1,$2)', [sessions.editor, ids.editor]);
  await as('editor');
  await denied("select public.cms_list('made-up','',1)", [], '22023');
  await denied("select public.cms_list(null,'',0)", [], '22023');

  const event = { kind: 'event', slug: 'verified-event', title: 'Approved event', payload: eventPayload };
  for (const payload of [{ ...eventPayload, secret: 'must not publish' }, { ...eventPayload, state: null }, { ...eventPayload, termId: null }, { ...eventPayload, summary: '<script>bad</script>' }, { ...eventPayload, iso: '2026-02-30' }, { ...eventPayload, sections: [{ id: 'x', title: 'X', paragraphs: ['ok'], unknown: true }] }, { ...eventPayload, sections: [eventPayload.sections[0], eventPayload.sections[0]] }]) {
    await assert.rejects(() => save({ ...event, payload }), (error) => error.code === '22023'); assertions++;
  }
  for (const [kind, payload] of [['article', { date: '2026-03-01', kicker: 'Report', excerpt: 'Summary', body: ['Text'] }], ['history', { year: '1919', label: 'Founding', snippet: 'Verified history', body: [] }], ['officer', { name: 'Leader', termId: '2026-A', eventSlug: event.slug, summary: 'Summary', lesson: 'Lesson' }], ['settings', { body: ['Chapter information'] }], ['policy', { body: ['Draft legal text'] }]]) {
    const row = await save({ kind, slug: kind === 'settings' ? 'chapter' : kind === 'policy' ? 'privacy' : `draft-${kind}`, title: 'Draft only', payload });
    eq(row.status, 'draft');
    await assert.rejects(() => save({ kind, slug: row.slug, title: 'Invalid', payload: { ...payload, arbitrary: 'blocked' } }), (error) => error.code === '22023'); assertions++;
  }
  const prose = 'A'.repeat(5000);
  const longArticle = { kind: 'article', slug: 'long-prose', title: 'Long prose', payload: { date: '2026-03-01', kicker: 'Report', excerpt: 'Summary', body: [prose] } };
  eq((await save(longArticle)).payload.body[0], prose, 'Paragraphs accept prose beyond 200 characters up to 5000');
  const longEvent = { ...event, slug: 'long-event-prose', payload: { ...eventPayload, sections: [{ id: 'narrative', title: 'Report', paragraphs: [prose] }] } };
  eq((await save(longEvent)).payload.sections[0].paragraphs[0], prose, 'Event section paragraphs share the 5000-character bound');
  const longHistory = { kind: 'history', slug: 'long-history-prose', title: 'Long history', payload: { year: '1919', label: 'Founding', snippet: 'Summary', body: [prose] } };
  eq((await save(longHistory)).payload.body[0], prose, 'History body accepts long prose');
  for (const payload of [
    { ...longArticle.payload, body: ['A'.repeat(5001)] },
    { ...longArticle.payload, body: Array(60).fill(prose) },
    { ...longArticle.payload, body: Array(80).fill('文'.repeat(1200)) },
    { ...longArticle.payload, kicker: 'A'.repeat(201) },
  ]) {
    await assert.rejects(() => save({ ...longArticle, slug: 'invalid-prose', payload }), (error) => error.code === '22023'); assertions++;
  }
  let liveEvent = await save(event);
  eq(liveEvent.version, 1);
  eq((await snapshot()).content, [], 'Drafts never appear anonymously');
  await assert.rejects(() => transition(liveEvent, 'publish'), (error) => error.code === '42501'); assertions++;
  liveEvent = await transition(liveEvent, 'submit', ''); eq(liveEvent.version, 2);
  await as('owner');
  liveEvent = await transition(liveEvent, 'publish'); eq(liveEvent.version, 3);
  eq((await snapshot()).content[0].title, 'Approved event');
  await as('editor');
  liveEvent = await save({ ...liveEvent, title: 'Unapproved edit' }, liveEvent.version);
  eq(liveEvent.status, 'draft');
  eq((await snapshot()).content[0].title, 'Approved event', 'Editing live content preserves immutable public revision');
  await assert.rejects(() => save(liveEvent, liveEvent.version - 1), (error) => error.code === 'PT409'); assertions++;
  await assert.rejects(() => save({ ...liveEvent, slug: 'changed-live-url' }, liveEvent.version), (error) => error.code === '22023'); assertions++;
  await denied('select public.cms_transition($1,$2,$3,$4)', [liveEvent.id, liveEvent.version - 1, 'submit', ''], 'PT409');
  eq((await value('select public.cms_content_get($1) as result', [liveEvent.id])).version, liveEvent.version);

  // Actual upload receipt/registration/approval/promotion state machine, using fixture storage rows.
  const mediaId = '20000000-0000-4000-8000-000000000001';
  const original = `${ids.editor}/${mediaId}.original`, derivative = `${mediaId}.webp`;
  await denied('select public.cms_media_register($1,$2,$3,1600,1000,$4,$5,true)', [mediaId, original, derivative, 'Chapter gathering', 'Verified permission'], '23514');
  await superuser();
  await sql("insert into storage.objects(bucket_id,name) values('cms-originals',$1),('cms-derivatives',$2)", [original, derivative]);
  await as(null, { role: 'service_role' });
  await denied("select public.cms_list(null,'',1)");
  await value('select public.cms_media_upload_ready($1,$2,$3,$4,1600,1000) as result', [mediaId, ids.editor, original, derivative]);
  await as('owner');
  await denied('select public.cms_media_register($1,$2,$3,1600,1000,$4,$5,true)', [mediaId, original, derivative, 'Chapter gathering', 'Verified permission'], '23514');
  await as('editor');
  const media = await value('select public.cms_media_register($1,$2,$3,1600,1000,$4,$5,true) as result', [mediaId, original, derivative, 'Chapter gathering', 'Verified permission']);
  eq(media.status, 'pending'); eq((await snapshot()).media, []);
  eq((await sql("select bucket_id,name from storage.objects where bucket_id<>'public-assets'")).rows, [{ bucket_id: 'cms-derivatives', name: derivative }], 'AAL2 staff can privately preview registered derivatives but never originals');
  await as('editor', { aal: 'aal1' });
  await denied("select name from storage.objects where bucket_id='cms-derivatives'");
  await as('editor');
  liveEvent = await save({ ...liveEvent, media_ids: [mediaId] }, liveEvent.version);
  liveEvent = await transition(liveEvent, 'submit', '');
  await denied('select public.cms_media_approve($1::uuid[],$2,$3)', [[mediaId], liveEvent.id, liveEvent.version]);
  await as('owner');
  await denied('select public.cms_media_approve($1::uuid[],$2,$3)', [[mediaId], liveEvent.id, liveEvent.version - 1], 'PT409');
  await denied('select public.cms_media_approve($1::uuid[],$2,$3)', [[], liveEvent.id, liveEvent.version], '23514');
  const approval = await value('select public.cms_media_approve($1::uuid[],$2,$3) as result', [[mediaId], liveEvent.id, liveEvent.version]);
  eq(approval.items[0].status, 'approved');
  await assert.rejects(() => transition(liveEvent, 'publish'), (error) => error.code === '23514'); assertions++;
  await as(null, { role: 'service_role' });
  const lease = await value('select public.cms_media_begin_promote($1) as result', [mediaId]);
  eq(lease.status, 'promoting'); ok(lease.operation_id);
  await denied('select public.cms_media_begin_promote($1)', [mediaId], 'PT409');
  await denied('select public.cms_media_promote($1,$2,$3)', [mediaId, derivative, lease.operation_id], '22023');
  await superuser(); await sql("insert into storage.objects(bucket_id,name) values('cms-public',$1)", [derivative]);
  await as(null, { role: 'service_role' });
  await denied('select public.cms_media_cancel_promote($1,$2)', [mediaId, lease.operation_id], '23514');
  await denied('select public.cms_media_promote($1,$2,$3)', [mediaId, '../other.webp', lease.operation_id], '22023');
  await denied('select public.cms_media_promote($1,$2,gen_random_uuid())', [mediaId, derivative], 'PT409');
  eq((await value('select public.cms_media_promote($1,$2,$3) as result', [mediaId, derivative, lease.operation_id])).status, 'ready');
  eq((await value('select public.cms_media_begin_promote($1) as result', [mediaId])).operation_id, null, 'Ready objects require verification, never a new copy lease');
  await as(null, { role: 'anon' }); eq((await snapshot()).media, [], 'Approved bytes need a live publication reference before metadata exposure');
  await as('owner'); liveEvent = await transition(liveEvent, 'publish');
  const withMedia = await snapshot();
  eq(withMedia.content[0].media_ids, [mediaId]);
  eq(Object.keys(withMedia.media[0]).sort(), ['alt', 'caption', 'height', 'id', 'public_path', 'width']);
  eq(withMedia.media[0].public_path, derivative);
  ok(!JSON.stringify(withMedia).includes(original), 'Original path never appears in public snapshot');
  await as(null, { role: 'anon' });
  eq((await sql("select name from storage.objects where bucket_id<>'public-assets'")).rows.map((row) => row.name), [derivative], 'CMS storage listing policy exposes only a live approved public object');
  await denied("update storage.objects set name='tampered.webp'");

  await resetQuotas(); await as('editor');
  const report = { term: { id: '2026-A', year: 2026, half: 'A', opening: 10000, proposedSponsors: 20000, proposedFundraising: 5000 },
    projects: [{ id: 'project-a', termId: '2026-A', title: 'Verified project', eventSlug: event.slug, proposed: 10000, notes: '', responsible: 'Treasurer' }],
    income: [{ id: 'income-a', termId: '2026-A', date: '2026-02-01', kind: 'sponsor', description: 'Contribution', amount: 5000 }],
    expenses: [{ id: 'expense-a', projectId: 'project-a', date: '2026-03-03', category: 'Materials', description: 'Supplies', amount: 3000, responsible: 'Treasurer' }] };
  const invalidReports = [
    { ...report, unknown: 'blocked' },
    { ...report, term: { ...report.term, opening: 1.5 } },
    { ...report, term: { ...report.term, opening: -1 } },
    { ...report, term: { ...report.term, opening: 9000000000001 } },
    { ...report, term: { ...report.term, opening: '10000' } },
    { ...report, term: { ...report.term, half: null } },
    { ...report, projects: [{ ...report.projects[0], termId: '2026-B' }] },
    { ...report, expenses: [{ ...report.expenses[0], projectId: 'missing' }] },
    { ...report, expenses: [{ ...report.expenses[0], extra: 'secret' }] },
    { ...report, income: [{ ...report.income[0], date: '2026-10-01' }] },
    { ...report, income: [report.income[0], report.income[0]] },
    { ...report, projects: Array.from({ length: 100 }, (_, i) => ({ ...report.projects[0], id: `project-${i}`, notes: 'A'.repeat(3000) })) },
  ];
  for (const payload of invalidReports) {
    await assert.rejects(() => financeSave(payload), (error) => ['22023', '23514'].includes(error.code)); assertions++;
  }
  let finance = await financeSave(report); eq(finance.version, 1);
  eq((await snapshot()).finance, [], 'Finance drafts stay private');
  await assert.rejects(() => financePublish('2026-A', 1), (error) => error.code === '42501'); assertions++;
  await as('owner', { age: 301 });
  await assert.rejects(() => financePublish('2026-A', 1), (error) => error.code === '42501'); assertions++;
  await as('owner');
  const publication = await financePublish('2026-A', 1); eq(publication.status, 'published');
  eq((await snapshot()).finance[0].term.opening, 10000);
  await assert.rejects(() => financePublish('2026-A', 1), (error) => error.code === 'PT409'); assertions++;
  await assert.rejects(() => transition(liveEvent, 'archive'), (error) => error.code === '23514'); assertions++;
  await as('editor');
  await assert.rejects(() => financeSave(report, null), (error) => error.code === 'PT409'); assertions++;
  const corrected = { ...report, projects: [{ ...report.projects[0], notes: 'Corrected description with unchanged balance' }] };
  finance = await financeSave(corrected, finance.version);
  eq((await snapshot()).finance[0].projects[0].notes, '', 'Published report stays unchanged while correction is a draft');
  await as('owner');
  const correction = await financePublish('2026-A', finance.version);
  eq(correction.previous_id, publication.id);
  eq((await value('select public.cms_finance_list() as result')).items[0].revisions.length, 2);
  const second = { term: { ...report.term, id: '2026-B', half: 'B', opening: 12001 }, projects: [], income: [], expenses: [] };
  let secondDraft = await financeSave(second);
  await assert.rejects(() => financePublish('2026-B', secondDraft.version), (error) => error.code === '23514'); assertions++;
  second.term.opening = 12000; secondDraft = await financeSave(second, secondDraft.version);
  await financePublish('2026-B', secondDraft.version);
  eq((await snapshot()).finance.length, 2);
  const brokenCorrection = { ...corrected, income: [{ ...corrected.income[0], amount: 6000 }] };
  finance = await financeSave(brokenCorrection, finance.version);
  await assert.rejects(() => financePublish('2026-A', finance.version), (error) => error.code === '23514'); assertions++;
  eq((await snapshot()).finance[0].income[0].amount, 5000, 'Rejected carryover correction leaves live report intact');
  const missingEvent = { ...second, term: { ...second.term, id: '2027-A', year: 2027, half: 'A' }, projects: [{ ...report.projects[0], termId: '2027-A', eventSlug: 'unpublished-event' }] };
  const missing = await financeSave(missingEvent);
  await assert.rejects(() => financePublish('2027-A', missing.version), (error) => error.code === '23514'); assertions++;

  await superuser();
  await denied('update private.content_publications set title=$1', ['Changed historical publication'], '23514');
  await denied('delete from private.finance_income', [], '23514');
  await denied('delete from private.audit', [], '23514');
  await denied("insert into private.finance_expenses(publication_id,id,project_id,date,category,description,amount,responsible) values($1,'invalid','no-project','2026-01-01','Materials','Invalid',1,'Treasurer')", [publication.id], '23503');
  await denied("insert into private.content_media(content_id,media_id,ordinal) values($1,gen_random_uuid(),99)", [liveEvent.id], '23503');
  eq(await value("select count(*)::int as result from private.rebuild_outbox where status='pending'"), 5, 'Publication outbox is durable and excludes rolled back failures');
  await as(null, { role: 'service_role' });
  const pending = await value('select public.cms_rebuild_pending() as result'); ok(pending.items.length > 0);
  await value("select public.cms_record_rebuild($1,'success','Deployment completed') as result", [pending.items[0].id]);
  await denied("select public.cms_record_rebuild($1,'failure','Cannot overwrite success')", [pending.items[0].id], '22023');
  await value("select public.cms_record_backup(gen_random_uuid(),'success',now(),'manifest_safe_id','Encrypted backup verified') as result");
  await denied("select public.cms_record_backup(gen_random_uuid(),'success',now(),null,'')", [], '22023');
  await denied('select public.cms_staff_list()');
  await as('owner');
  eq((await value('select public.cms_backup_status() as result')).items[0].status, 'success');
  await as('editor'); await denied('select public.cms_backup_status()');
  await resetQuotas(); await as('editor');
  for (let i = 0; i < 60; i++) await value("select public.cms_rate_limit('save') as result");
  await denied("select public.cms_rate_limit('save')", [], 'P0001');
  await denied("select public.cms_rate_limit('unbounded-action')", [], '22023');
  await superuser();
  eq(await value("select count as result from private.quotas where user_id=$1 and action='save'", [ids.editor]), 60, 'Persistent quota remains at limit despite rejected requests');
  await sql("update private.quotas set window_start=now()-interval '2 minutes' where user_id=$1", [ids.editor]);
  await as('editor'); await value("select public.cms_rate_limit('save') as result");
  await superuser();
  eq(await value("select count as result from private.quotas where user_id=$1 and action='save'", [ids.editor]), 1);
  await as(null, { role: 'anon' });
  const publicData = JSON.stringify(await snapshot());
  for (const privateText of ['owner@example.test', 'editor@example.test', 'raw_app_meta_data', 'original_path', 'Encrypted backup verified', 'draft-history']) {
    ok(!publicData.includes(privateText), `Public snapshot excludes ${privateText}`);
  }
  // One Edge admission plus one receipt-backed user registration must consume one upload allowance.
  await resetQuotas();
  for (let i = 1; i <= 20; i++) {
    const id = `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const originalPath = `${ids.editor}/${id}.original`, derivativePath = `${id}.webp`;
    await as('editor'); await value("select public.cms_rate_limit('upload') as result");
    await superuser();
    await sql("insert into storage.objects(bucket_id,name) values('cms-originals',$1),('cms-derivatives',$2)", [originalPath, derivativePath]);
    await as(null, { role: 'service_role' });
    await value('select public.cms_media_upload_ready($1,$2,$3,$4,100,100) as result', [id, ids.editor, originalPath, derivativePath]);
    await as('editor');
    const registered = await value("select public.cms_media_register($1,$2,$3,100,100,'Verified alt','Verified rights',true) as result", [id, originalPath, derivativePath]);
    eq(registered.status, 'pending', `Upload/registration pair ${i} succeeds`);
  }
  await denied("select public.cms_rate_limit('upload')", [], 'P0001');
  await superuser();
  eq(await value("select count as result from private.quotas where user_id=$1 and action='upload'", [ids.editor]), 20, 'Twenty upload admissions consume exactly twenty allowances');
  eq(await value("select count as result from private.quotas where user_id=$1 and action='media_register'", [ids.editor]), 20, 'Registrations have their own receipt-protected quota');
  // Retirement serializes against promotion and preserves shared live objects.
  await resetQuotas(); await as('editor');
  const retiredId = '30000000-0000-4000-8000-000000000001';
  let retiring = await save({ kind:'article',slug:'retirement-test',title:'Retirement test',
    payload:{date:'2026-10-16',kicker:'Chapter',excerpt:'Verified content',body:['Verified body']},media_ids:[retiredId,mediaId] });
  retiring = await transition(retiring,'submit','');
  await denied('select public.cms_media_retire($1)',[retiring.id]);
  await denied('select public.cms_media_begin_promote($1)',[retiredId]);
  await as('owner');
  await denied('select public.cms_media_retire($1)',[retiring.id],'23514');
  await value('select public.cms_media_approve($1::uuid[],$2,$3) as result',[[retiredId,mediaId],retiring.id,retiring.version]);
  await as(null,{role:'service_role'});
  const retiredLease = await value('select public.cms_media_begin_promote($1) as result',[retiredId]);
  await denied('select public.cms_media_retire($1)',[retiring.id]);
  await as('owner'); retiring = await transition(retiring,'archive');
  await denied('select public.cms_media_retire($1)',[retiring.id],'PT409');
  await as(null,{role:'service_role'});
  await denied('select public.cms_media_cancel_promote($1,gen_random_uuid())',[retiredId],'PT409');
  eq((await value('select public.cms_media_cancel_promote($1,$2) as result',[retiredId,retiredLease.operation_id])).status,'approved');
  await as('owner',{aal:'aal1'}); await denied('select public.cms_media_retire($1)',[retiring.id]);
  await as('owner');
  const retired = await value('select public.cms_media_retire($1) as result',[retiring.id]);
  eq(retired.items.map(item=>item.id),[retiredId], 'A live publication elsewhere protects shared media');
  eq(retired.items[0].public_path,`${retiredId}.webp`);
  eq((await value('select public.cms_media_retire($1) as result',[retiring.id])).items.length,1,'Retirement can retry after deletion failure');
  await denied('select public.cms_media_begin_retire($1)',[retiredId]);
  eq(await value("select to_regprocedure('public.cms_media_retired(uuid)')::text as result"),null,'Old lease-free finalization is removed');
  await as(null,{role:'service_role'});
  const deletionLease = await value('select public.cms_media_begin_retire($1) as result',[retiredId]);
  eq(deletionLease.status,'revoking'); ok(deletionLease.operation_id);
  await as('owner');
  eq((await value('select public.cms_media_retire($1) as result',[retiring.id])).items[0].operation_id,deletionLease.operation_id,'Owner retries preserve the existing deletion lease');
  await as(null,{role:'service_role'});
  await denied('select public.cms_media_begin_retire($1)',[retiredId],'PT409');
  await denied('select public.cms_media_retired($1,gen_random_uuid())',[retiredId],'PT409');
  await denied('select public.cms_media_begin_promote($1)',[retiredId],'PT409');
  await denied('select public.cms_media_promote($1,$2,$3)',[retiredId,`${retiredId}.webp`,retiredLease.operation_id],'22023');
  eq((await value('select public.cms_media_retired($1,$2) as result',[retiredId,deletionLease.operation_id])).status,'pending');
  await denied('select public.cms_media_retired($1,$2)',[retiredId,deletionLease.operation_id],'PT409');
  await as('owner'); eq((await value('select public.cms_media_retire($1) as result',[retiring.id])).items,[]);
  // A replacement draft can omit an image that survives in its published history.
  await as('editor');
  let historical = await save({kind:'article',slug:'historical-media',title:'Historical media',
    payload:{date:'2026-10-16',kicker:'Chapter',excerpt:'Verified content',body:['Verified body']},media_ids:[retiredId]});
  historical = await transition(historical,'submit','');
  await as('owner');
  await value('select public.cms_media_approve($1::uuid[],$2,$3) as result',[[retiredId],historical.id,historical.version]);
  await as(null,{role:'service_role'});
  const historicalLease = await value('select public.cms_media_begin_promote($1) as result',[retiredId]);
  await denied('select public.cms_media_retired($1,$2)',[retiredId,deletionLease.operation_id],'PT409');
  await denied('select public.cms_media_begin_retire($1)',[retiredId],'PT409');
  await superuser(); await sql("insert into storage.objects(bucket_id,name) values('cms-public',$1)",[`${retiredId}.webp`]);
  await as(null,{role:'service_role'});
  await value('select public.cms_media_promote($1,$2,$3) as result',[retiredId,`${retiredId}.webp`,historicalLease.operation_id]);
  await as('owner'); historical = await transition(historical,'publish');
  historical = await save({...historical,media_ids:[]},historical.version);
  historical = await transition(historical,'archive');
  await as('owner',{age:301}); await denied('select public.cms_media_retire($1)',[historical.id]);
  await as('owner');
  eq((await value('select public.cms_media_retire($1) as result',[historical.id])).items.map(item=>item.id),[retiredId], 'Historical publication references are retired even when the draft removed the image');
  await as(null,{role:'service_role'});
  const historicalDeletionLease = await value('select public.cms_media_begin_retire($1) as result',[retiredId]);
  ok(historicalDeletionLease.operation_id!==deletionLease.operation_id,'Every retirement has a fresh operation identity');
  await denied('select public.cms_media_retired($1,$2)',[retiredId,deletionLease.operation_id],'PT409');
  await denied('select public.cms_media_retired($1,$2)',[retiredId,historicalDeletionLease.operation_id],'23514');
  await superuser(); await sql("delete from storage.objects where bucket_id='cms-public' and name=$1",[`${retiredId}.webp`]);
  await as(null,{role:'service_role'});
  const cleaned = await value('select public.cms_media_retired($1,$2) as result',[retiredId,historicalDeletionLease.operation_id]);
  eq([cleaned.status,cleaned.public_path,cleaned.approved_at,cleaned.operation_id],['pending',null,null,null]);
  await denied('select public.cms_media_promote($1,$2,$3)',[retiredId,`${retiredId}.webp`,historicalLease.operation_id],'22023');
  return assertions;
}
