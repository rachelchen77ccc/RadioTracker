import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildMigrationBundle, deterministicUuid, validateMigrationBundle } from './cloud-migration-lib.mjs';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';

function fixtureDb() {
  const db = new Database(':memory:');
  db.exec(`
    create table dramas (
      id integer primary key, missevan_id integer, title text, platform text, source text,
      kind text, categories text, organization text, abstract text, cover_url text, cover_local text,
      status text, purchased integer, subscribed integer, heard_episodes integer, total_episodes integer,
      rating real, finished_date text, rewatch_queued integer, rewatch_status text, review text,
      serialize_status text, update_info text, update_day text, price real, sync_saw_episode text,
      sync_total_episodes integer, sync_newest text, sync_serialize text, sync_purchased integer,
      sync_subscribed integer, synced_at text, created_at text, updated_at text, bought_order integer,
      sub_order integer, sort_order integer, detail_error text, detail_fetched_at text
    );
    create table cvs (id integer primary key, name text, missevan_id integer, avatar_url text, note text, created_at text);
    create table drama_cvs (drama_id integer, cv_id integer, role_type text, character text);
    create table rewatch_plans (id integer primary key, drama_id integer, planned_at text, done_at text, round integer, note text);
    create table sync_log (id integer primary key, ran_at text, kind text, added integer, updated integer, skipped integer, detail text);
  `);
  db.prepare(`insert into dramas values (
    1, 123, '测试剧', '猫耳', 'missevan', '广播剧', '["现代"]', null, null, 'https://example.test/cover.jpg', null,
    '在听', 1, 1, 4, 21, 4.75, null, 0, null, '很好听', '连载中', '每周更新', '周五', 79,
    '第4集', 4, '第4集', '连载中', 1, 1, '2026-08-03 10:00:00', '2026-08-01 10:00:00',
    '2026-08-03 10:00:00', 1, 1, 0, null, '2026-08-03 10:00:00'
  )`).run();
  db.prepare("insert into cvs values (1, '测试CV', 456, null, null, '2026-08-01 10:00:00')").run();
  db.prepare("insert into drama_cvs values (1, 1, '主役', '角色甲')").run();
  db.prepare("insert into sync_log values (1, '2026-08-03 10:00:00', 'missevan', 1, 2, 0, '{\"ok\":true}')").run();
  return db;
}

test('稳定标识相同输入总是得到相同 UUID', () => {
  assert.equal(deterministicUuid('same'), deterministicUuid('same'));
  assert.notEqual(deterministicUuid('same'), deterministicUuid('different'));
});

test('迁移拆分公共资料和私人收听状态，且不包含登录凭据', () => {
  const db = fixtureDb();
  const bundle = buildMigrationBundle(db, {
    ownerId: OWNER_ID,
    rootDir: process.cwd(),
    generatedAt: '2026-08-03T00:00:00.000Z',
  });
  db.close();

  assert.equal(bundle.tables.drama_catalog.length, 1);
  assert.equal(bundle.tables.user_dramas.length, 1);
  assert.equal(bundle.tables.drama_catalog[0].total_episodes, 21);
  assert.equal(bundle.tables.user_dramas[0].review, '很好听');
  assert.equal(bundle.tables.user_dramas[0].user_id, OWNER_ID);
  assert.equal(bundle.export_meta.credentials_included, false);
  assert.equal(JSON.stringify(bundle).includes('credential_ciphertext'), false);
  assert.deepEqual(validateMigrationBundle(bundle), { ok: true, errors: [] });
});

test('篡改后的迁移包无法通过校验', () => {
  const db = fixtureDb();
  const bundle = buildMigrationBundle(db, { ownerId: OWNER_ID, rootDir: process.cwd() });
  db.close();
  bundle.tables.user_dramas[0].status = '不存在的状态';
  assert.equal(validateMigrationBundle(bundle).ok, false);
});
