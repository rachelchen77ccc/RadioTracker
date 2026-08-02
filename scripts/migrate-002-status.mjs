/**
 * 迁移 002：拆开「挑出来的」和「库里的」
 *
 *   node scripts/migrate-002-status.mjs      幂等，可重复跑
 *
 * 两处改动：
 *
 * 1. 收听状态新增「囤着」
 *      囤着 = 买了还没开始听
 *      搁置 = 听了一部分停下了
 *    存量的 42 部「搁置」不自动拆 —— 已听集数在 Notion 里只填了 42 行，
 *    连 175 部「听完」都有 150 部没填，靠它推会错得离谱。留给「待复核」页人工过。
 *
 * 2. 重刷拆成两层
 *      rewatch_queued  = 重刷计划：从库里挑出来、还没开始重刷的短名单
 *      rewatch_status  = 重刷库：已二刷/已四刷/已n刷 的历史记录
 *    原来「待重刷」是塞在 rewatch_status 里的一个值，语义上跟其他值不是一回事。
 */
import { openDb } from '../server/db.js';

const db = openDb();

const cols = db.prepare(`PRAGMA table_info(dramas)`).all().map(c => c.name);

if (!cols.includes('rewatch_queued')) {
  db.exec(`ALTER TABLE dramas ADD COLUMN rewatch_queued INTEGER NOT NULL DEFAULT 0`);
  console.log('+ 加列 rewatch_queued');
} else {
  console.log('· rewatch_queued 已存在');
}

const moved = db.prepare(`
  UPDATE dramas SET rewatch_queued = 1, rewatch_status = NULL
  WHERE rewatch_status = '待重刷'
`).run().changes;
console.log(`· 「待重刷」搬进重刷计划：${moved} 部`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_dramas_rewatch_queued ON dramas(rewatch_queued)`);

console.log('\n当前分布：');
console.table(db.prepare(
  `SELECT status AS 收听状态, COUNT(*) AS 部数 FROM dramas GROUP BY status ORDER BY 部数 DESC`
).all());
console.log('重刷计划', db.prepare('SELECT COUNT(*) c FROM dramas WHERE rewatch_queued = 1').get().c,
            '· 重刷库', db.prepare('SELECT COUNT(*) c FROM dramas WHERE rewatch_status IS NOT NULL').get().c);
