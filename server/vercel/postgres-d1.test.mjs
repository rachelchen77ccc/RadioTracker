import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from './postgres-d1.js';

test('SQLite 占位符和日期函数会转换成 Postgres 写法', () => {
  assert.equal(
    __test.finalSql("SELECT * FROM dramas WHERE user_id = ? AND finished_date >= date('now', ?) AND updated_at < datetime('now')"),
    'SELECT * FROM dramas WHERE user_id = $1 AND finished_date >= (CURRENT_DATE + $2::interval) AND updated_at < CURRENT_TIMESTAMP',
  );
});

test('Postgres 的 bigint 和统计数字会变成前端可用的 number', () => {
  assert.deepEqual(__test.normalizeRow({ id: 2n, c: '317', title: '24格的谎言' }), {
    id: 2,
    c: 317,
    title: '24格的谎言',
  });
});
