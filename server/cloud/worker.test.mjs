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

test('猫耳短信验证码登录后只保存会话并关联当前用户', async () => {
  const env = testEnv();
  const ctx = { waitUntil() {} };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/x/captcha/challenge')) {
      return new Response(JSON.stringify({ code: 0, info: { type: 'geetest', params: {
        gt: 'gt-test', challenge: 'challenge-test', offline: false,
      } } }), { headers: { 'content-type': 'application/json', 'set-cookie': 'MSESSID=prelogin; Path=/; HttpOnly' } });
    }
    if (String(url).includes('/account/sendcode')) {
      return new Response(JSON.stringify({ success: true, code: 0 }), {
        headers: { 'content-type': 'application/json', 'set-cookie': 'MSESSID=after-code; Path=/; HttpOnly' },
      });
    }
    if (String(url).includes('/account/smslogin')) {
      return new Response(JSON.stringify({ success: true, code: 0 }), {
        headers: { 'content-type': 'application/json', 'set-cookie': 'auth_token=secret-session; Path=/; HttpOnly' },
      });
    }
    if (String(url).includes('/account/userinfo')) {
      return new Response(JSON.stringify({ success: true, code: 0, info: { id: 31571121 } }), {
        headers: { 'content-type': 'application/json', 'set-cookie': 'muid=31571121; Path=/' },
      });
    }
    if (String(url).includes('/mperson/getdramabought')) {
      return new Response(JSON.stringify({ info: { data: [], pagination: { count: 0, maxpage: 1 } } }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const challengeResponse = await worker.fetch(apiRequest('/api/sync/missevan-login/challenge', 'new@example.com', {
      method: 'POST', body: '{}',
    }), env, ctx);
    const challenge = await challengeResponse.json();
    assert.equal(challengeResponse.status, 200);
    assert.equal(challenge.gt, 'gt-test');
    assert.ok(challenge.loginState);

    const sendResponse = await worker.fetch(apiRequest('/api/sync/missevan-login/send-code', 'new@example.com', {
      method: 'POST', body: JSON.stringify({
        phone: '13800138000', captchaToken: 'geetest|a|b|c', loginState: challenge.loginState,
      }),
    }), env, ctx);
    const sent = await sendResponse.json();
    assert.equal(sendResponse.status, 200, JSON.stringify(sent));

    const verifyResponse = await worker.fetch(apiRequest('/api/sync/missevan-login/verify-code', 'new@example.com', {
      method: 'POST', body: JSON.stringify({ phone: '13800138000', code: '123456', loginState: sent.loginState }),
    }), env, ctx);
    const verified = await verifyResponse.json();
    assert.equal(verifyResponse.status, 200, JSON.stringify(verified));
    assert.equal(verified.userId, '31571121');

    const sessionResponse = await worker.fetch(apiRequest('/api/sync/session', 'new@example.com'), env, ctx);
    const session = await sessionResponse.json();
    assert.deepEqual({ hasSession: session.hasSession, userId: session.userId }, {
      hasSession: true, userId: '31571121',
    });
    assert.match(String(calls.find(call => call.url.includes('/account/smslogin'))?.init.headers.Cookie), /MSESSID=after-code/);
    assert.equal(JSON.stringify(session).includes('13800138000'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('听完日期会自动生成年度标签，标记听完时会补当天日期', async () => {
  const env = testEnv();
  const ctx = { waitUntil() {} };
  await worker.fetch(apiRequest('/api/admin/import', 'history@example.com', {
    method: 'POST', body: JSON.stringify({ bundle }),
  }), env, ctx);

  const dated = await worker.fetch(apiRequest('/api/dramas/1', 'history@example.com', {
    method: 'PATCH', body: JSON.stringify({ status: '听完', finished_date: '2025-01-02' }),
  }), env, ctx);
  assert.equal(dated.status, 200);

  const yearsResponse = await worker.fetch(apiRequest('/api/years', 'history@example.com'), env, ctx);
  const years = await yearsResponse.json();
  assert.deepEqual(years.map(row => ({ year: row.year, count: row.count })), [{ year: '2025', count: 1 }]);

  const createdResponse = await worker.fetch(apiRequest('/api/dramas', 'history@example.com', {
    method: 'POST', body: JSON.stringify({ title: '今天听完', status: '在听' }),
  }), env, ctx);
  const created = await createdResponse.json();
  const finishedResponse = await worker.fetch(apiRequest(`/api/dramas/${created.id}`, 'history@example.com', {
    method: 'PATCH', body: JSON.stringify({ status: '听完' }),
  }), env, ctx);
  const finished = await finishedResponse.json();
  assert.match(finished.finished_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('档案库按平台、类型、评分、购买状态和剧集标签筛选', async () => {
  const env = testEnv();
  const ctx = { waitUntil() {} };
  await worker.fetch(apiRequest('/api/admin/import', 'filters@example.com', {
    method: 'POST', body: JSON.stringify({ bundle }),
  }), env, ctx);
  await worker.fetch(apiRequest('/api/dramas', 'filters@example.com', {
    method: 'POST',
    body: JSON.stringify({
      title: '未购买的有声剧', platform: '漫播', kind: '听书', purchased: false,
      rating: 4.5, categories: ['悬疑', '现代'],
    }),
  }), env, ctx);

  const facetsResponse = await worker.fetch(apiRequest('/api/facets', 'filters@example.com'), env, ctx);
  const facets = await facetsResponse.json();
  assert.deepEqual(facets.purchased, [
    { value: 'true', n: 1 },
    { value: 'false', n: 1 },
  ]);
  assert.deepEqual(facets.category, [
    { value: '现代', n: 2 },
    { value: '悬疑', n: 1 },
  ]);

  const filteredResponse = await worker.fetch(apiRequest(
    '/api/dramas?platform=漫播&kind=听书&rating_min=4&purchased=false&category=悬疑',
    'filters@example.com',
  ), env, ctx);
  const filtered = await filteredResponse.json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].title, '未购买的有声剧');
});
