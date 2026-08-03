/**
 * 服务端拉取剧集详情（CV / 分类 / 社团 / 集数 / 连载状态）。
 *
 *   node scripts/fetch-details.mjs [--all] [文件路径]
 *
 * 关键事实：`/dramaapi/getdrama` 是**公开接口，不需要登录**。
 * 所以浏览器脚本只负责抓两个需要登录态的列表（已购 / 追剧），
 * 剩下几百次详情请求全在这里跑 —— 快、可重试、不受浏览器下载拦截影响。
 *
 * 默认要拉的是四类：
 *   · 还没从猫耳详情确认过总集数的（新同步进来的剧）
 *   · 还缺 CV 的
 *   · status='在听' 的
 *   · 连载中且你追了或买了的
 * 后两类**每次都刷**，因为它们的集数会长 —— 这正是「同步剧集更新进度」。
 * 已完结的存量剧不重复拉，几百次请求换不来任何变化。
 *
 * 拉不动的剧（下架旧版返回 403）会记进 detail_error，之后默认跳过；
 * 加 --all 会连它们一起重试。
 *
 * 唯一拿不到的是 saw_episode（猫耳记录的收听位置），那是用户态数据。
 * 缺了不影响任何东西 —— 它本来就只是个灰色提示。
 */
import { openDb } from '../server/db.js';

const ALL = process.argv.includes('--all');
const db = openDb();

const targets = db.prepare(
  ALL
    ? `SELECT id, missevan_id, title, total_episodes, update_info
       FROM dramas WHERE missevan_id IS NOT NULL`
    : `SELECT id, missevan_id, title, total_episodes, update_info
       FROM dramas d
       WHERE missevan_id IS NOT NULL
         AND detail_error IS NULL
         AND (
           NOT EXISTS (SELECT 1 FROM drama_cvs WHERE drama_id = d.id)
           OR d.sync_total_episodes IS NULL
           OR d.status = '在听'
           OR (d.serialize_status = '连载中' AND (d.purchased = 1 OR d.subscribed = 1))
         )`
).all();

if (!targets.length) {
  console.log('没有需要补详情的剧。想强制刷新全部就加 --all');
  process.exit(0);
}
console.log(`要拉 ${targets.length} 部剧的详情…`);

const upsertCv = db.prepare(`INSERT INTO cvs (name) VALUES (?) ON CONFLICT(name) DO NOTHING`);
const setCvMeta = db.prepare(
  `UPDATE cvs SET missevan_id = COALESCE(missevan_id, ?), avatar_url = COALESCE(avatar_url, ?) WHERE name = ?`
);
const getCv = db.prepare('SELECT id FROM cvs WHERE name = ?');
const countMain = db.prepare(
  `SELECT COUNT(*) c FROM drama_cvs WHERE drama_id = ? AND role_type = '主役'`
);
const link = db.prepare(
  `INSERT INTO drama_cvs (drama_id, cv_id, role_type, character) VALUES (?, ?, ?, ?)
   ON CONFLICT DO NOTHING`
);

/**
 * 空缺才回填，人工填过的一律不动。
 * 总集数例外：第一次以猫耳详情为准；之后如果主字段与上次同步快照不同，
 * 就说明用户手动改过，后续同步只更新快照，不覆盖手动值。
 */
const fillIfEmpty = db.prepare(`
  UPDATE dramas SET
    kind             = COALESCE(kind, @kind),
    categories       = CASE WHEN categories IS NULL OR categories = '[]'
                            THEN @categories ELSE categories END,
    organization     = COALESCE(organization, @organization),
    abstract         = COALESCE(abstract, @abstract),
    cover_url        = COALESCE(cover_url, @cover_url),
    -- 这三个是会变的事实，每次都刷新。你标的「听到哪」不在这里，永远不动。
    total_episodes   = CASE
      WHEN sync_total_episodes IS NULL
        OR total_episodes IS NULL
        OR total_episodes = sync_total_episodes
      THEN COALESCE(@total_episodes, total_episodes)
      ELSE total_episodes
    END,
    serialize_status = COALESCE(@serialize_status, serialize_status),
    update_info      = COALESCE(@update_info, update_info),
    price            = COALESCE(price, @price),
    -- 更新日：你填过就不动，空着才从简介里解析回填
    update_day       = COALESCE(update_day, @update_day),
    sync_total_episodes = @total_episodes,
    sync_newest         = @update_info,
    sync_serialize      = @serialize_status,
    synced_at           = datetime('now'),
    detail_error        = NULL,
    detail_fetched_at   = datetime('now')
  WHERE id = @id
`);

// 「听完」是一个强约束：最终采用哪一个总集数，进度都同步拉满。
const fillCompletedProgress = db.prepare(`
  UPDATE dramas SET heard_episodes = total_episodes
  WHERE id = ? AND status = '听完' AND total_episodes IS NOT NULL
`);

const markError = db.prepare(
  `UPDATE dramas SET detail_error = ? WHERE id = ?`
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 从简介里解析更新日。
 *
 * 猫耳的 `update_period` 字段一直是 null（大概只给 App 用），
 * 但简介里几乎都写着「⋯⋯每周五更新」「⋯⋯每日18点更新」。
 * 命中率大约七成；剩下的（简介压根没提更新时间）保持空着，由你手填。
 */
const WEEK = { 一: '周一', 二: '周二', 三: '周三', 四: '周四', 五: '周五', 六: '周六', 日: '周日', 天: '周日' };

function parseUpdateDay(abstractHtml) {
  const text = String(abstractHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/更新|播出/.test(text)) return null;

  // 「每周五更新」「每週日更新」
  const wk = /每\s*[周週]\s*([一二三四五六日天])/.exec(text);
  if (wk) return WEEK[wk[1]] ?? null;

  // 「每日18点更新」—— 每日和更新之间常隔着时间，不能要求紧挨着
  if (/每\s*[日天]/.test(text)) return '每日';

  return null;
}

let ok = 0, cvLinks = 0, days = 0;
const failed = [];
const grew = [];   // 集数变多了的剧 —— 这是你每次同步最想看到的

for (const [i, t] of targets.entries()) {
  let info;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://www.missevan.com/dramaapi/getdrama?drama_id=${t.missevan_id}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.missevan.com/' } }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      info = (await res.json()).info;
      break;
    } catch (e) {
      if (attempt === 2) {
        const msg = String(e.message ?? e);
        failed.push({ title: t.title, err: msg });
        // 记下来，下次默认跳过 —— 下架的旧版剧每次都 403，重试纯属浪费
        markError.run(msg, t.id);
      } else {
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  if (!info) continue;

  const d = info.drama ?? {};
  const serialize_status =
    String(d.integrity) === '1' ? '已完结' : String(d.integrity) === '2' ? '连载中' : null;

  fillIfEmpty.run({
    id: t.id,
    update_day: parseUpdateDay(d.abstract),
    kind: d.type === 2 ? '听书' : '广播剧',
    categories: JSON.stringify(
      [d.catalog_name, ...(Array.isArray(d.tags) ? d.tags.map(x => x.name ?? x) : [])].filter(Boolean)
    ),
    organization: d.organization?.name ?? null,
    abstract: d.abstract || null,
    cover_url: d.cover || null,
    total_episodes: (info.episodes?.episode ?? []).length || null,
    price: d.price ?? null,
    serialize_status,
    update_info: d.newest || null,
  });
  fillCompletedProgress.run(t.id);

  // Notion 带来的主役是你自己挑的，不动；猫耳的一律只补配役。
  // 完全没有主役记录的（猫耳新同步进来的剧）才用「前两位是主役」的约定。
  const keepMain = countMain.get(t.id).c > 0;
  for (const [idx, c] of (info.cvs ?? []).entries()) {
    const name = c.cv_info?.name;
    if (!name) continue;
    upsertCv.run(name);
    setCvMeta.run(c.cv_info?.id ?? null, c.cv_info?.icon ?? null, name);
    const cv = getCv.get(name);
    if (!cv) continue;
    const role = keepMain ? '配役' : (idx < 2 ? '主役' : '配役');
    cvLinks += link.run(t.id, cv.id, role, c.character ?? null).changes;
  }

  ok++;
  const now = (info.episodes?.episode ?? []).length || null;
  if (now && t.total_episodes && now > t.total_episodes) {
    grew.push({ title: t.title, from: t.total_episodes, to: now, newest: d.newest });
  }
  if (parseUpdateDay(d.abstract)) days++;
  if (i % 25 === 24) process.stdout.write(`  ${i + 1}/${targets.length}\r`);
  await sleep(250);
}

console.log(`\n详情补齐：刷新 ${ok} 部 · 新建 CV 关联 ${cvLinks} 条 · 回填更新日 ${days} 部 · 失败 ${failed.length}`);

if (grew.length) {
  console.log(`\n📻 有新集（${grew.length} 部）：`);
  for (const g of grew) {
    console.log(`   ${g.title}  ${g.from} → ${g.to} 集${g.newest ? `，更新至「${g.newest}」` : ''}`);
  }
} else {
  console.log('\n没有剧更新新集。');
}

if (failed.length) {
  console.log(`\n拉不动的（已记下，之后跳过；--all 可重试）：`);
  for (const f of failed.slice(0, 10)) console.log(`   ${f.title} — ${f.err}`);
}
