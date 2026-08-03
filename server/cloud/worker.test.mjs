import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import worker from './worker.js';

class D1Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }
}

function testEnv() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(`
    ALTER TABLE dramas ADD COLUMN user_id TEXT;
    ALTER TABLE dramas ADD COLUMN bought_order INTEGER;
    ALTER TABLE dramas ADD COLUMN sub_order INTEGER;
    ALTER TABLE dramas ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE dramas ADD COLUMN detail_error TEXT;
    ALTER TABLE dramas ADD COLUMN detail_fetched_at TEXT;
    ALTER TABLE cvs ADD COLUMN user_id TEXT;
    ALTER TABLE sync_log ADD COLUMN user_id TEXT;
    CREATE UNIQUE INDEX cvs_user_name_test_idx ON cvs(user_id, name);
    CREATE UNIQUE INDEX dramas_user_missevan_test_idx ON dramas(user_id, missevan_id);
    CREATE TABLE user_missevan_credentials (
      user_id TEXT PRIMARY KEY, missevan_user_id TEXT, credential_ciphertext TEXT,
      credential_iv TEXT, saved_at TEXT
    );
    CREATE TABLE sync_jobs (
      user_id TEXT PRIMARY KEY, running INTEGER DEFAULT 0, step TEXT, log TEXT DEFAULT '[]',
      error TEXT, expired INTEGER DEFAULT 0, started_at TEXT, finished_at TEXT
    );
    CREATE TABLE migration_state (user_id TEXT PRIMARY KEY, completed_at TEXT, source_checksum TEXT);
  `);
  const objects = new Map();
  return {
    DB: {
      prepare: sql => new D1Statement(sqlite, sql),
      batch: statements => Promise.all(statements.map(statement => statement.run())),
    },
    COVERS: {
      get: async key => objects.get(key) || null,
      put: async (key, body, options) => objects.set(key, { body, httpMetadata: options?.httpMetadata }),
      delete: async key => objects.delete(key),
    },
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    PRIVATE_OWNER_MODE: 'false',
  };
}

const bundle = {
  export_meta: { credentials_included: false, tables_sha256: 'test' },
  cover_files: [],
  tables: {
    drama_catalog: [{
      id: 'catalog-1', legacy_id: 1, missevan_id: 1001, title: '测试剧', platform: '猫耳',
      source: 'missevan', kind: '广播剧', categories: ['现代'], organization: null,
      abstract: null, cover_url: null, total_episodes: 21, serialize_status: '连载中',
      update_info: '第11集', update_day: '周五', price: 79, detail_error: null,
      detail_fetched_at: null,
    }],
    user_dramas: [{
      drama_id: 'catalog-1', legacy_id: 1, status: '在听', purchased: true, subscribed: true,
      heard_episodes: 4, rating: 4.75, finished_date: null, rewatch_queued: false,
      rewatch_status: null, review: '测试剧评', sync_saw_episode: '第4集', sync_total_episodes: 11,
      sync_newest: '第11集', sync_serialize: '连载中', sync_purchased: true,
      sync_subscribed: true, synced_at: null, bought_order: 0, sub_order: 0, sort_order: 0,
    }],
    catalog_cvs: [{ id: 'cv-1', legacy_id: 1, name: '测试CV', missevan_id: 2001, avatar_url: null, note: null }],
    catalog_drama_cvs: [{ drama_id: 'catalog-1', cv_id: 'cv-1', role_type: '主役', character: '甲' }],
    sync_logs: [],
  },
};

function apiRequest(path, email, init = {}) {
  return new Request(`https://example.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'oai-authenticated-user-email': email, ...(init.headers || {}) },
  });
}

test('云端迁移后能读取完整剧目，并按登录用户隔离', async () => {
  const env = testEnv();
  const ctx = { waitUntil() {} };
  const imported = await worker.fetch(apiRequest('/api/admin/import', 'owner@example.com', {
    method: 'POST', body: JSON.stringify({ bundle }),
  }), env, ctx);
  const importedPayload = await imported.json();
  assert.equal(imported.status, 201, JSON.stringify(importedPayload));
  assert.equal(importedPayload.dramas, 1);

  const ownerStats = await worker.fetch(apiRequest('/api/stats', 'owner@example.com'), env, ctx);
  assert.equal((await ownerStats.json()).total, 1);
  const otherStats = await worker.fetch(apiRequest('/api/stats', 'other@example.com'), env, ctx);
  assert.equal((await otherStats.json()).total, 0);

  const detail = await worker.fetch(apiRequest('/api/dramas/1', 'owner@example.com'), env, ctx);
  const drama = await detail.json();
  assert.equal(drama.total_episodes, 21);
  assert.equal(drama.cvs[0].name, '测试CV');
});

test('多用户模式下未登录不能访问 API', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/stats'), testEnv(), { waitUntil() {} });
  assert.equal(response.status, 401);
});
