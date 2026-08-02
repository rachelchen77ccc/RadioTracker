/**
 * 迁移 004：让同步能记住「哪些剧拉不动」
 *
 *   node scripts/migrate-004-sync-focus.mjs      幂等
 *
 * 下架的旧版剧（标题带「（旧）」那几部）详情接口固定返回 403。
 * 以前每次同步都要把它们重试三遍再失败，白等十几秒还刷一屏红字。
 * 记下来，之后默认跳过；加 --all 仍然会重试。
 */
import { openDb } from '../server/db.js';

const db = openDb();
const cols = db.prepare('PRAGMA table_info(dramas)').all().map(c => c.name);

for (const [name, ddl] of [
  ['detail_error', 'TEXT'],          // 最近一次详情拉取的失败原因
  ['detail_fetched_at', 'TEXT'],     // 最近一次成功拉到详情的时间
]) {
  if (cols.includes(name)) { console.log(`· ${name} 已存在`); continue; }
  db.exec(`ALTER TABLE dramas ADD COLUMN ${name} ${ddl}`);
  console.log(`+ 加列 ${name}`);
}

console.log('\n完结状态分布（决定每次同步要刷新多少部）：');
console.table(db.prepare(`
  SELECT serialize_status AS 连载状态, COUNT(*) AS 部数
  FROM dramas WHERE purchased = 1 OR subscribed = 1
  GROUP BY 1
`).all());

console.log('每次同步会刷新的剧（在听 + 连载中）：',
  db.prepare(`
    SELECT COUNT(*) c FROM dramas
    WHERE missevan_id IS NOT NULL
      AND (status = '在听' OR (serialize_status = '连载中' AND (purchased = 1 OR subscribed = 1)))
  `).get().c, '部');
