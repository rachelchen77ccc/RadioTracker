/**
 * 把 Notion 导出的「听剧统计」搬进 RadioTracker。
 *
 *   node scripts/import-notion.mjs [导出目录]
 *   默认目录：notion-export/unpacked
 *
 * 做三件事：
 *   1. 主库 CSV → dramas 表（243 行）
 *   2. 每部剧的 .md 正文 → review 字段（你写的长篇 repo，原样保留）
 *   3. Notion 本地封面图 → data/covers/（远程 maoercdn 链接保持原样）
 *
 * 幂等：以 (missevan_id) 或 (标题+平台) 为键，重复跑不会产生副本。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { initDb, COVER_DIR, ROOT } from '../server/db.js';

const EXPORT_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'notion-export', 'unpacked');

if (!fs.existsSync(EXPORT_DIR)) {
  console.error(`找不到导出目录：${EXPORT_DIR}`);
  process.exit(1);
}

// ---------- 小工具 ----------

const findFile = (dir, re) => fs.readdirSync(dir).find(f => re.test(f));

/** 「2024年1月1日」→ 2024-01-01 */
function parseCnDate(s) {
  const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec((s || '').trim());
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** '🐱猫耳' → '猫耳' */
const cleanPlatform = s => (s || '').replace(/[^一-龥A-Za-z]/g, '').trim() || '其他';

const splitList = s =>
  (s || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);

const num = s => {
  const v = parseFloat(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(v) ? v : null;
};

/** Notion 关系字段值形如 "李轻扬 (CV%E6%95%B0.../xxx.md)"，只取显示名 */
const stripRelation = s => (s || '').replace(/\s*\([^)]*\)\s*/g, '').trim();

/**
 * 解析剧集 .md：H1 后是连续的 "字段: 值" 块，空行之后才是正文。
 * 返回正文（Markdown），没有正文则返回 null。
 */
function extractReview(mdPath) {
  const lines = fs.readFileSync(mdPath, 'utf8').split('\n');
  let i = 0;
  if (lines[i]?.startsWith('# ')) i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  // 连续吃掉属性行
  const prop = /^[^\s:][^:]{0,24}:\s/;
  while (i < lines.length && (prop.test(lines[i]) || lines[i].trim() === '')) {
    if (lines[i].trim() === '') {
      // 空行：只有当后面还是属性行才继续吃，否则说明正文开始了
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j >= lines.length || !prop.test(lines[j])) { i = j; break; }
      i = j;
      continue;
    }
    i++;
  }
  const body = lines.slice(i).join('\n').trim();
  return body || null;
}

// ---------- 读 CSV ----------

const mainCsv = findFile(EXPORT_DIR, /^广播剧Tracker数据库 .*_all\.csv$/);
if (!mainCsv) { console.error('找不到主库 CSV'); process.exit(1); }

const rows = parse(fs.readFileSync(path.join(EXPORT_DIR, mainCsv)), {
  columns: true,
  skip_empty_lines: true,
  bom: true,
});

// ---------- 索引剧集 md ----------

const mdDir = path.join(EXPORT_DIR, '广播剧Tracker数据库');
const mdByTitle = new Map();
if (fs.existsSync(mdDir)) {
  for (const f of fs.readdirSync(mdDir).filter(f => f.endsWith('.md'))) {
    // 「剧名 <32位notionid>.md」
    const title = f.replace(/\s+[0-9a-f]{32}\.md$/, '').trim();
    mdByTitle.set(title, path.join(mdDir, f));
  }
}

// ---------- 封面 ----------

function copyLocalCover(rawValue, title) {
  const rel = decodeURIComponent(rawValue);
  const src = path.join(EXPORT_DIR, rel);
  if (!fs.existsSync(src)) return null;
  const ext = path.extname(src) || '.jpg';
  const safe = title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  const name = `${safe}${ext}`;
  fs.copyFileSync(src, path.join(COVER_DIR, name));
  return name;
}

// ---------- 导入 ----------

const db = initDb();

const findByMissevan = db.prepare('SELECT id FROM dramas WHERE missevan_id = ?');
const findByTitle = db.prepare('SELECT id FROM dramas WHERE title = ? AND platform = ?');

const insertDrama = db.prepare(`
  INSERT INTO dramas (
    missevan_id, title, platform, source, kind, categories, cover_url, cover_local,
    status, purchased, heard_episodes, total_episodes, rating, finished_date,
    rewatch_status, rewatch_queued, review, serialize_status, update_info, update_day, price
  ) VALUES (
    @missevan_id, @title, @platform, 'notion', @kind, @categories, @cover_url, @cover_local,
    @status, @purchased, @heard_episodes, @total_episodes, @rating, @finished_date,
    @rewatch_status, @rewatch_queued, @review, @serialize_status, @update_info, @update_day, @price
  )
`);

const updateDrama = db.prepare(`
  UPDATE dramas SET
    missevan_id = COALESCE(@missevan_id, missevan_id),
    kind = @kind, categories = @categories,
    cover_url = @cover_url, cover_local = COALESCE(@cover_local, cover_local),
    status = @status, purchased = @purchased,
    heard_episodes = @heard_episodes, total_episodes = @total_episodes,
    rating = @rating, finished_date = @finished_date,
    rewatch_status = @rewatch_status, rewatch_queued = @rewatch_queued,
    review = COALESCE(@review, review),
    serialize_status = @serialize_status, update_info = @update_info,
    update_day = @update_day, price = @price,
    updated_at = datetime('now')
  WHERE id = @id
`);

const upsertCv = db.prepare(
  `INSERT INTO cvs (name) VALUES (?) ON CONFLICT(name) DO NOTHING`
);
const cvId = db.prepare('SELECT id FROM cvs WHERE name = ?');
const linkCv = db.prepare(
  `INSERT INTO drama_cvs (drama_id, cv_id, role_type) VALUES (?, ?, '主役')
   ON CONFLICT DO NOTHING`
);
const clearCvs = db.prepare('DELETE FROM drama_cvs WHERE drama_id = ?');

let added = 0, updated = 0, skipped = 0, reviews = 0, coversCopied = 0;
const anomalies = [];

const run = db.transaction(() => {
  for (const r of rows) {
    const title = (r['剧名'] || '').trim();
    if (!title) { skipped++; continue; }

    const platform = cleanPlatform(r['平台']);
    const missevan_id = num(r['剧ID']);
    const coverRaw = (r['封面URL'] || '').trim();
    const isRemote = /^https?:\/\//.test(coverRaw);

    let cover_local = null;
    if (coverRaw && !isRemote) {
      cover_local = copyLocalCover(coverRaw, title);
      if (cover_local) coversCopied++;
      else anomalies.push({ title, issue: '本地封面缺失', value: coverRaw });
    }

    const mdPath = mdByTitle.get(title);
    const review = mdPath ? extractReview(mdPath) : null;
    if (review) reviews++;

    const data = {
      missevan_id,
      title,
      platform,
      kind: (r['类别'] || '').trim() || null,
      categories: JSON.stringify(splitList(r['剧集类别'])),
      cover_url: isRemote ? coverRaw : null,
      cover_local,
      status: (r['收听状态'] || '').trim() || null,
      purchased: (r['是否购买'] || '').includes('已购买') ? 1 : 0,
      heard_episodes: num(r['已听集数']),
      total_episodes: num(r['总集数']),
      rating: num(r['评分']),
      finished_date: parseCnDate(r['听完日期']),
      // Notion 把「待重刷」和「已n刷」混在一列里，这里拆成两层：
      // 待重刷 = 挑出来还没开始的计划，已n刷 = 刷过几遍的历史
      rewatch_status: (r['重刷状态'] || '').trim() === '待重刷'
        ? null : ((r['重刷状态'] || '').trim() || null),
      rewatch_queued: (r['重刷状态'] || '').trim() === '待重刷' ? 1 : 0,
      review,
      serialize_status: (r['连载状态'] || '').trim() || null,
      update_info: (r['更新情况'] || '').trim() || null,
      update_day: (r['更新日'] || '').trim() || null,
      price: num(r['价格']),
    };

    const existing =
      (missevan_id && findByMissevan.get(missevan_id)) ||
      findByTitle.get(title, platform);

    let id;
    if (existing) {
      updateDrama.run({ ...data, id: existing.id });
      id = existing.id;
      updated++;
    } else {
      id = insertDrama.run(data).lastInsertRowid;
      added++;
    }

    // CV 关系：主役CV 是权威列，CV数据库列只是 Notion relation 的冗余
    const names = new Set([
      ...splitList(r['主役CV']),
      ...splitList(r['CV数据库']).map(stripRelation),
    ].filter(Boolean));
    clearCvs.run(id);
    for (const n of names) {
      upsertCv.run(n);
      const cv = cvId.get(n);
      if (cv) linkCv.run(id, cv.id);
    }

  }

  db.prepare(
    `INSERT INTO sync_log (kind, added, updated, skipped, detail) VALUES ('notion', ?, ?, ?, ?)`
  ).run(added, updated, skipped, JSON.stringify(anomalies));
});

run();

const stat = q => db.prepare(q).get();
console.log(`
Notion 导入完成
  新增 ${added} · 更新 ${updated} · 跳过空行 ${skipped}
  剧评正文 ${reviews} 篇 · 本地封面 ${coversCopied} 张
  CV ${stat('SELECT COUNT(*) c FROM cvs').c} 位 · 关联 ${stat('SELECT COUNT(*) c FROM drama_cvs').c} 条
`);
if (anomalies.length) {
  console.log(`⚠️  ${anomalies.length} 条异常：`);
  for (const a of anomalies.slice(0, 10)) console.log('   ', a.title, '—', a.issue);
}
