/**
 * 迁移 003：听完的剧拉满进度 + 三个排序列
 *
 *   node scripts/migrate-003-order.mjs      幂等，可重复跑
 *
 * 1. 标记为「听完」的剧，把「听到哪」补成总集数。
 *    Notion 里这一列基本没填（175 部听完的有 150 部是空的），
 *    但既然标了听完，听到哪就是全部 —— 这个推断是安全的。
 *
 * 2. 三个排序列：
 *    bought_order / sub_order —— 猫耳「已购」「追剧」列表返回的原始顺序，
 *      0 = 最新。这是「从最新到最旧」唯一可靠的依据：
 *      站里没有购买日期，updated_at 只反映最后一次同步。
 *    sort_order —— 你自己拖出来的顺序，默认 0。
 */
import { openDb } from '../server/db.js';

const db = openDb();
const cols = db.prepare('PRAGMA table_info(dramas)').all().map(c => c.name);

for (const [name, ddl] of [
  ['bought_order', 'INTEGER'],
  ['sub_order', 'INTEGER'],
  ['sort_order', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (cols.includes(name)) { console.log(`· ${name} 已存在`); continue; }
  db.exec(`ALTER TABLE dramas ADD COLUMN ${name} ${ddl}`);
  console.log(`+ 加列 ${name}`);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_dramas_sort ON dramas(sort_order)');

const filled = db.prepare(`
  UPDATE dramas SET heard_episodes = total_episodes, updated_at = datetime('now')
  WHERE status = '听完'
    AND total_episodes IS NOT NULL
    AND (heard_episodes IS NULL OR heard_episodes <> total_episodes)
`).run().changes;

console.log(`\n听完的剧拉满进度：${filled} 部`);
const left = db.prepare(
  `SELECT COUNT(*) c FROM dramas WHERE status = '听完' AND total_episodes IS NULL`
).get().c;
if (left) console.log(`⚠️  还有 ${left} 部「听完」没有总集数，拉不了 —— 需要先补总集数`);
