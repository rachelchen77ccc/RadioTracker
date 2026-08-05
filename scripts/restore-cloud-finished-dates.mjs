import Database from 'better-sqlite3';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const connection = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connection) throw new Error('缺少 POSTGRES_URL');

const local = new Database(path.join(ROOT, 'data', 'radiotracker.db'), { readonly: true });
const sql = postgres(connection, { max: 1, prepare: false });

const normalizeTitle = value => String(value || '')
  .replace(/[\s·・:：!！?？,，。.\-—_「」『』《》()（）【】\[\]]/g, '')
  .toLowerCase();

try {
  const [owner] = await sql`
    select user_id, count(*)::int as total,
      count(finished_date)::int as dated,
      count(*) filter (where status = '听完')::int as finished
    from dramas group by user_id order by count(*) desc limit 1
  `;
  if (!owner) throw new Error('线上数据库还没有剧目');

  const localRows = local.prepare(`
    select missevan_id, title, finished_date
    from dramas where finished_date is not null and finished_date <> ''
  `).all();
  const cloudRows = await sql`
    select id, missevan_id, title, status, finished_date
    from dramas where user_id = ${owner.user_id}
  `;

  const byMissevan = new Map(
    cloudRows.filter(row => row.missevan_id != null).map(row => [String(row.missevan_id), row])
  );
  const titleGroups = new Map();
  for (const row of cloudRows) {
    const key = normalizeTitle(row.title);
    titleGroups.set(key, [...(titleGroups.get(key) || []), row]);
  }

  const missing = [];
  const alreadyDated = [];
  const unmatched = [];
  for (const row of localRows) {
    let target = row.missevan_id == null ? null : byMissevan.get(String(row.missevan_id));
    if (!target) {
      const candidates = titleGroups.get(normalizeTitle(row.title)) || [];
      if (candidates.length === 1) target = candidates[0];
    }
    if (!target) {
      unmatched.push(row.title);
    } else if (target.finished_date) {
      alreadyDated.push(target);
    } else {
      missing.push({ id: target.id, title: target.title, date: row.finished_date });
    }
  }

  console.log(`本地有日期 ${localRows.length} 部`);
  console.log(`线上主账号 ${owner.total} 部 · 听完 ${owner.finished} 部 · 已有日期 ${owner.dated} 部`);
  console.log(`可安全补回 ${missing.length} 部 · 线上已有 ${alreadyDated.length} 部 · 未唯一匹配 ${unmatched.length} 部`);
  if (unmatched.length) console.log(`跳过：${unmatched.slice(0, 12).join('、')}${unmatched.length > 12 ? '…' : ''}`);

  if (!apply) {
    console.log('当前为预览；加 --apply 才会写入线上。');
  } else {
    await sql.begin(async transaction => {
      for (const row of missing) {
        await transaction`
          update dramas set finished_date = ${row.date}, updated_at = now()
          where id = ${row.id} and user_id = ${owner.user_id} and finished_date is null
        `;
      }
    });
    console.log(`已补回 ${missing.length} 部的听完日期。`);
  }
} finally {
  local.close();
  await sql.end();
}
