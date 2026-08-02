/**
 * 把浏览器导出的「已购 / 追剧」列表合并进数据库。
 *
 *   node scripts/import-missevan.mjs [文件路径]
 *   默认找 data/missevan-lists.json，找不到再试 data/missevan-export.json
 *
 * 合并规则见 server/merge-missevan.js。
 * 跑完记得 npm run fetch:details 补 CV / 分类 / 集数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb, ROOT } from '../server/db.js';
import { mergeMissevan } from '../server/merge-missevan.js';

const CANDIDATES = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : ['missevan-lists.json', 'missevan-export.json'].map(f => path.join(ROOT, 'data', f));

const FILE = CANDIDATES.find(f => fs.existsSync(f));

if (!FILE) {
  console.error(`找不到导出文件，找过：
${CANDIDATES.map(f => '  ' + f).join('\n')}

先在浏览器里跑 tools/export-missevan.js，把下载到的 JSON 放进 data/。`);
  process.exit(1);
}

const db = initDb();
const r = mergeMissevan(db, JSON.parse(fs.readFileSync(FILE, 'utf8')));

console.log(`
猫耳同步完成
  新增 ${r.added} 部 · 更新 ${r.updated} 部 · 跳过非猫耳 ${r.untouched} 部
  回填空缺字段 ${r.filled} 处${r.unsubscribed ? `\n  猫耳上已取关，移出收藏 ${r.unsubscribed} 部` : ''}
`);

if (r.notices.length) {
  console.log(`需要你确认的变化（${r.notices.length} 条）：`);
  for (const n of r.notices.slice(0, 20)) console.log(`   ${n.title} — ${n.change}`);
  if (r.notices.length > 20) console.log(`   …还有 ${r.notices.length - 20} 条，见 sync_log 表`);
}

console.log('接下来跑 npm run fetch:details 补 CV / 分类 / 社团 / 集数。\n');

if (r.drift.length) {
  console.log(`
猫耳收听位置（${r.drift.length} 部，仅供参考）—— 以你的标记为准：`);
  for (const d of r.drift.slice(0, 8)) {
    console.log(`   ${d.title}：你标 ${d.heard_episodes ?? '—'}/${d.total_episodes ?? '—'}，猫耳上次停在「${d.sync_saw_episode}」`);
  }
}
