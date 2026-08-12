import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from './postgres-d1.js';

test('SQLite 占位符和日期函数会转换成 Postgres 写法', () => {
  assert.equal(
    __test.finalSql("SELECT * FROM dramas WHERE user_id = ? AND finished_date >= date('now', ?) AND updated_at < datetime('now')"),
    'SELECT * FROM dramas WHERE user_id = $1 AND finished_date >= (CURRENT_DATE + $2::interval) AND updated_at < CURRENT_TIMESTAMP',
  );
});

test('SQLite 的 JSON 数组展开会转换成 Postgres jsonb 写法', () => {
  assert.equal(
    __test.finalSql('SELECT je.value FROM dramas d, json_each(d.categories) je WHERE je.value = ?'),
    'SELECT je.value FROM dramas d, jsonb_array_elements_text(d.categories::jsonb) AS je(value) WHERE je.value = $1',
  );
});

test('Postgres 的 bigint 和统计数字会变成前端可用的 number', () => {
  assert.deepEqual(__test.normalizeRow({ id: 2n, c: '317', title: '24格的谎言' }), {
    id: 2,
    c: 317,
    title: '24格的谎言',
  });
});

test('Postgres 的 date 会变成日期输入框可识别的 YYYY-MM-DD', () => {
  assert.deepEqual(__test.normalizeRow({
    finished_date: new Date('2026-05-29T00:00:00.000Z'),
    updated_at: new Date('2026-05-29T08:30:00.000Z'),
  }), {
    finished_date: '2026-05-29',
    updated_at: '2026-05-29T08:30:00.000Z',
  });
});

test('听剧日记日期也会压成 YYYY-MM-DD', () => {
  assert.deepEqual(__test.normalizeRow({
    id: 12n,
    drama_id: 5n,
    entry_date: new Date('2026-08-10T00:00:00.000Z'),
  }), {
    id: 12,
    drama_id: 5,
    entry_date: '2026-08-10',
  });
});
