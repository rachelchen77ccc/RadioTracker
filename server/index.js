import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, COVER_DIR, ROOT as ROOT_DIR } from './db.js';

const db = openDb();
const app = express();
app.use(cors());
// 封面上传走 dataURL（客户端已裁成 640×640），默认 100kb 限额不够
app.use(express.json({ limit: '12mb' }));
app.use('/covers', express.static(COVER_DIR));

// 刻意不读 PORT：dev 工具会把 PORT 设成 vite 的端口，两边会撞。
const PORT = process.env.API_PORT || 5174;

/** 把 DB 行整成前端友好的形状 */
const shape = r => r && ({
  ...r,
  categories: JSON.parse(r.categories || '[]'),
  purchased: !!r.purchased,
  subscribed: !!r.subscribed,
  rewatch_queued: !!r.rewatch_queued,
  // 猫耳 CDN 有防盗链（直连 403），远程封面一律走本地代理并缓存到磁盘
  cover: r.cover_local
    ? `/covers/${encodeURIComponent(r.cover_local)}`
    : r.cover_url ? `/api/cover?u=${encodeURIComponent(r.cover_url)}` : null,
  // 猫耳记录的上次收听位置（集名）。只作提示，永远不是进度真值。
  sawHint: r.sync_saw_episode || null,
});

const withCvs = rows => {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const cvs = db.prepare(`
    SELECT dc.drama_id, c.id, c.name, dc.character, dc.role_type
    FROM drama_cvs dc JOIN cvs c ON c.id = dc.cv_id
    WHERE dc.drama_id IN (${ids.map(() => '?').join(',')})
    ORDER BY dc.role_type = '主役' DESC, c.name
  `).all(...ids);
  const map = new Map(ids.map(i => [i, []]));
  for (const c of cvs) map.get(c.drama_id)?.push(c);
  return rows.map(r => ({ ...shape(r), cvs: map.get(r.id) ?? [] }));
};

const list = (sql, ...args) => withCvs(db.prepare(sql).all(...args));

// ── 封面代理 ───────────────────────────────────────────
// 猫耳 CDN 校验 Referer，浏览器直连拿 403。这里代原样带上 Referer 取回来，
// 落盘缓存一份：既绕过防盗链，也保证以后猫耳换图/删图了本地还在。

const CACHE_DIR = path.join(COVER_DIR, 'remote');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// 白名单：避免这个接口变成任意 URL 的代理（SSRF）
const ALLOWED_HOST = /(^|\.)(maoercdn|missevan)\.com$/;

app.get('/api/cover', async (req, res) => {
  const raw = req.query.u;
  if (!raw) return res.status(400).end();

  let url;
  try { url = new URL(raw); } catch { return res.status(400).end(); }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
    return res.status(403).end();
  }

  const ext = (path.extname(url.pathname) || '.jpg').slice(0, 5);
  const file = path.join(
    CACHE_DIR,
    crypto.createHash('sha1').update(raw).digest('hex') + ext
  );

  if (fs.existsSync(file)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(file);
  }

  try {
    const upstream = await fetch(raw, {
      headers: {
        Referer: 'https://www.missevan.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    const buf = Buffer.from(await upstream.arrayBuffer());
    fs.writeFileSync(file, buf);
    res.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (e) {
    console.warn('封面拉取失败', raw, String(e));
    res.status(502).end();
  }
});

// ── 一键同步 ───────────────────────────────────────────
//
// 三步里只有第一步需要登录态（已购/追剧列表），那步必须在你自己的
// 浏览器里跑。剩下两步是公开接口，全在这里跑：
//   import-missevan  合并已购/追剧标记
//   fetch-details    补新剧的 CV / 分类 / 集数 / 更新日
//   cache-covers     把新封面抓到本地
//
// 任务是异步的：POST 起一个，GET 轮询进度。同一时间只允许一个。

const job = {
  running: false,
  startedAt: null,
  finishedAt: null,
  step: null,
  log: [],
  error: null,
  expired: false,
};

function runScript(file, label) {
  return new Promise((resolve, reject) => {
    job.step = label;
    job.log.push(`\n── ${label} ──`);
    const child = spawn(process.execPath, [path.join(ROOT_DIR, 'scripts', file)], {
      cwd: ROOT_DIR,
    });
    const take = buf => {
      for (const line of String(buf).split('\n')) {
        const t = line.trimEnd();
        if (t) job.log.push(t);
      }
      // 日志别无限长
      if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`${label} 退出码 ${code}`))
    );
  });
}

/*
 * 登录态。存在 data/.missevan-session.json，600 权限、已进 .gitignore。
 *
 * 这是整个项目里唯一落盘的凭据，所以：
 *   · 接口只回「有没有 / 是谁」，绝不回 cookie 本身
 *   · 日志里不出现它
 *   · 存之前先拿它调一次已购接口，验不过就不存
 */
const SESSION_FILE = path.join(ROOT_DIR, 'data', '.missevan-session.json');

const readSession = () => {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); }
  catch { return null; }
};

app.get('/api/sync/session', (_req, res) => {
  const s = readSession();
  res.json({ hasSession: !!s, userId: s?.userId ?? null, savedAt: s?.savedAt ?? null });
});

app.delete('/api/sync/session', (_req, res) => {
  try { fs.unlinkSync(SESSION_FILE); } catch { /* 本来就没有 */ }
  res.status(204).end();
});

app.post('/api/sync/session', express.json({ limit: '256kb' }), async (req, res) => {
  const cookie = String(req.body?.cookie ?? '').trim();
  if (!cookie) return res.status(400).json({ error: 'cookie 是空的' });

  // 从 cookie 里摸出用户 ID —— 追剧接口需要它
  const m = /(?:^|;\s*)muid=(\d+)/.exec(cookie);
  let userId = m?.[1] ?? String(req.body?.userId ?? '').trim();

  try {
    const r = await fetch(
      'https://www.missevan.com/mperson/getdramabought?page=1&page_size=1',
      { headers: { Cookie: cookie, Referer: 'https://www.missevan.com/', 'User-Agent': 'Mozilla/5.0' } }
    );
    // 凭据不对时猫耳回的是登录页 HTML，不是 JSON —— 直接 r.json() 会抛
    // 「Unexpected token '<'」这种没人看得懂的错，所以先自己判一下
    const text = await r.text();
    let count;
    try { count = JSON.parse(text)?.info?.pagination?.count; } catch { /* 不是 JSON */ }
    if (!r.ok || typeof count !== 'number') {
      return res.status(400).json({
        error: '这段 cookie 用不了 —— 确认是在已登录的猫耳页面里复制的，而且没有漏掉开头结尾',
      });
    }
    if (!userId) {
      return res.status(400).json({ error: 'cookie 里没有 muid，请一并填上你的用户 ID' });
    }
    fs.writeFileSync(
      SESSION_FILE,
      JSON.stringify({ cookie, userId, savedAt: new Date().toISOString() }),
      { mode: 0o600 }
    );
    res.json({ ok: true, userId, bought: count });
  } catch (e) {
    res.status(502).json({ error: '连不上猫耳：' + String(e.message ?? e) });
  }
});

app.get('/api/sync/status', (_req, res) => res.json(job));

// 把导出脚本的正文喂给前端的「复制脚本」按钮 ——
// tools/ 不在静态目录里，前端直接 fetch 拿不到
app.get('/api/sync/script', (_req, res) => {
  res.type('text/plain').send(
    fs.readFileSync(path.join(ROOT_DIR, 'tools', 'export-missevan.js'), 'utf8')
  );
});

app.post('/api/sync', express.json({ limit: '32mb' }), async (req, res) => {
  if (job.running) return res.status(409).json({ error: '已经有一个同步在跑了' });

  const hasSession = !!readSession();

  // 手动上传导出文件的老路子还留着，作为登录态失效时的兜底
  const lists = req.body?.lists;
  if (lists) {
    if (!Array.isArray(lists.bought) && !Array.isArray(lists.boughtIds)) {
      return res.status(400).json({ error: '这个文件不像猫耳导出，缺 bought 字段' });
    }
    fs.writeFileSync(path.join(ROOT_DIR, 'data', 'missevan-lists.json'), JSON.stringify(lists));
  }

  // 「自动更新」的核心就是对比账户里的已购/追剧。没有登录态或完整导出时
  // 不能假装同步成功，否则用户会看到“完成”，两张主清单却完全没更新。
  if (!lists && !hasSession) {
    return res.status(400).json({ error: '请先保存猫耳登录凭据，再运行自动更新' });
  }

  Object.assign(job, {
    running: true, startedAt: new Date().toISOString(), finishedAt: null,
    step: '准备', log: [], error: null, expired: false,
  });
  res.status(202).json({ started: true });

  try {
    // 存了登录态就自己拉，不用你去浏览器折腾
    if (!lists && hasSession) await runScript('fetch-lists.mjs', '拉取已购 / 追剧');
    if (lists || hasSession) await runScript('import-missevan.mjs', '合并已购 / 追剧');
    await runScript('fetch-details.mjs', '补剧集详情');
    await runScript('cache-covers.mjs', '缓存封面');
    job.step = '完成';
  } catch (e) {
    // 退出码 3 = 列表全空，基本就是登录态过期
    job.expired = /退出码 3$/.test(String(e.message ?? ''));
    job.error = job.expired
      ? '猫耳登录态过期了 —— 重新粘一次 cookie'
      : String(e.message ?? e);
    job.step = '失败';
  } finally {
    job.running = false;
    job.finishedAt = new Date().toISOString();
  }
});

// ── 剧集 ───────────────────────────────────────────────

app.get('/api/dramas', (req, res) => {
  const {
    status, platform, kind, cv, q, purchased, subscribed,
    category, organization, year, rating_min, serialize, sort = 'updated',
  } = req.query;
  const where = [];
  const args = [];
  const bool = v => (v === 'true' || v === '1' ? 1 : 0);

  if (status)       { where.push('d.status = ?');           args.push(status); }
  if (platform)     { where.push('d.platform = ?');         args.push(platform); }
  if (kind)         { where.push('d.kind = ?');             args.push(kind); }
  if (serialize)    { where.push('d.serialize_status = ?'); args.push(serialize); }
  if (organization) { where.push('d.organization = ?');     args.push(organization); }
  if (purchased  != null && purchased  !== '') { where.push('d.purchased = ?');  args.push(bool(purchased)); }
  if (subscribed != null && subscribed !== '') { where.push('d.subscribed = ?'); args.push(bool(subscribed)); }
  if (q)          { where.push('d.title LIKE ?'); args.push(`%${q}%`); }
  if (year)       { where.push("substr(d.finished_date, 1, 4) = ?"); args.push(String(year)); }
  if (rating_min) { where.push('d.rating >= ?'); args.push(Number(rating_min)); }
  // categories 是 JSON 数组，用 json_each 展开来匹配
  if (category) {
    where.push(`EXISTS (SELECT 1 FROM json_each(d.categories) je WHERE je.value = ?)`);
    args.push(category);
  }
  if (cv) {
    where.push(`d.id IN (
      SELECT dc.drama_id FROM drama_cvs dc JOIN cvs c ON c.id = dc.cv_id
      WHERE c.name = ? AND dc.role_type = '主役')`);
    args.push(cv);
  }
  const order = {
    updated: 'd.updated_at DESC',
    rating: 'd.rating DESC NULLS LAST, d.title',
    finished: 'd.finished_date DESC NULLS LAST',
    title: 'd.title',
    custom: 'd.sort_order, d.title',
  }[sort] ?? 'd.updated_at DESC';

  // 档案库有三百多部，一页铺不完 —— 跟已购/收藏一样分页返回
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(12, Number(req.query.pageSize) || 60));
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM dramas d ${clause}`).get(...args).c;

  res.json({
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    items: list(
      `SELECT d.* FROM dramas d ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...args, pageSize, (page - 1) * pageSize
    ),
  });
});

app.get('/api/dramas/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '没找到这部剧' });
  res.json(withCvs([row])[0]);
});

// 手动录入 —— 漫播和其他平台的剧走这条路
app.post('/api/dramas', (req, res) => {
  const b = req.body ?? {};
  if (!b.title?.trim()) return res.status(400).json({ error: '剧名不能为空' });
  const info = db.prepare(`
    INSERT INTO dramas (title, platform, source, kind, categories, cover_url,
                        status, purchased, heard_episodes, total_episodes, rating,
                        finished_date, rewatch_status, review, serialize_status,
                        update_info, update_day, price, organization, missevan_id)
    VALUES (@title, @platform, 'manual', @kind, @categories, @cover_url,
            @status, @purchased, @heard_episodes, @total_episodes, @rating,
            @finished_date, @rewatch_status, @review, @serialize_status,
            @update_info, @update_day, @price, @organization, @missevan_id)
  `).run({
    title: b.title.trim(),
    platform: b.platform ?? '漫播',
    kind: b.kind ?? '广播剧',
    categories: JSON.stringify(b.categories ?? []),
    cover_url: b.cover_url ?? null,
    status: b.status ?? null,
    purchased: b.purchased ? 1 : 0,
    heard_episodes: b.heard_episodes ?? null,
    total_episodes: b.total_episodes ?? null,
    rating: b.rating ?? null,
    finished_date: b.finished_date ?? null,
    rewatch_status: b.rewatch_status ?? null,
    review: b.review ?? null,
    serialize_status: b.serialize_status ?? null,
    update_info: b.update_info ?? null,
    update_day: b.update_day ?? null,
    price: b.price ?? null,
    organization: b.organization ?? null,
    missevan_id: b.missevan_id ?? null,
  });
  setCvNames(info.lastInsertRowid, b.cvNames ?? []);
  res.status(201).json(withCvs([db.prepare('SELECT * FROM dramas WHERE id = ?').get(info.lastInsertRowid)])[0]);
});

/**
 * 自定义顺序：前端把当前可见的 id 按拖好的次序整个发过来，
 * 按下标写 sort_order。只影响 sort=custom 这一种排法。
 */
app.patch('/api/dramas/reorder', (req, res) => {
  const { ids, offset = 0 } = req.body ?? {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: '没有要排序的剧' });
  }
  const stmt = db.prepare('UPDATE dramas SET sort_order = ? WHERE id = ?');
  db.transaction(() => {
    ids.forEach((id, i) => stmt.run(Number(offset) + i, Number(id)));
  })();
  res.json({ updated: ids.length });
});

// 批量改状态 —— 整理页一次处理一堆剧用的。
// 必须注册在 '/:id' 之前，否则 'bulk' 会被当成 id 吃掉。
app.patch('/api/dramas/bulk', (req, res) => {
  const { ids, status, rewatch_queued, purchased, platform } = req.body ?? {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: '没有选中任何剧' });
  }
  const sets = [];
  const vals = [];
  if (status !== undefined)         { sets.push('status = ?');         vals.push(status || null); }
  if (rewatch_queued !== undefined) { sets.push('rewatch_queued = ?'); vals.push(rewatch_queued ? 1 : 0); }
  if (purchased !== undefined)      { sets.push('purchased = ?');      vals.push(purchased ? 1 : 0); }
  if (platform !== undefined)       { sets.push('platform = ?');       vals.push(platform); }
  if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });

  sets.push("updated_at = datetime('now')");
  const stmt = db.prepare(
    `UPDATE dramas SET ${sets.join(', ')} WHERE id IN (${ids.map(() => '?').join(',')})`
  );
  const info = stmt.run(...vals, ...ids.map(Number));
  res.json({ updated: info.changes });
});

const EDITABLE = new Set([
  'title', 'platform', 'kind', 'status', 'purchased', 'subscribed',
  'heard_episodes', 'total_episodes', 'rating', 'finished_date',
  'rewatch_status', 'rewatch_queued', 'review', 'serialize_status', 'update_info',
  'update_day', 'price', 'organization', 'abstract', 'cover_url', 'missevan_id',
]);

app.patch('/api/dramas/:id', (req, res) => {
  const b = req.body ?? {};
  const sets = [];
  const args = {};
  for (const [k, v] of Object.entries(b)) {
    if (!EDITABLE.has(k)) continue;
    sets.push(`${k} = @${k}`);
    args[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  if (Array.isArray(b.categories)) {
    sets.push('categories = @categories');
    args.categories = JSON.stringify(b.categories);
  }
  if (!sets.length && !b.cvNames) return res.status(400).json({ error: '没有可更新的字段' });
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE dramas SET ${sets.join(', ')} WHERE id = @id`)
      .run({ ...args, id: Number(req.params.id) });
  }
  if (Array.isArray(b.cvNames)) setCvNames(Number(req.params.id), b.cvNames);
  const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(req.params.id);
  res.json(withCvs([row])[0]);
});


function setCvNames(dramaId, names) {
  const up = db.prepare(`INSERT INTO cvs (name) VALUES (?) ON CONFLICT(name) DO NOTHING`);
  const get = db.prepare('SELECT id FROM cvs WHERE name = ?');
  const link = db.prepare(
    `INSERT INTO drama_cvs (drama_id, cv_id, role_type) VALUES (?, ?, '主役') ON CONFLICT DO NOTHING`
  );
  db.transaction(() => {
    db.prepare('DELETE FROM drama_cvs WHERE drama_id = ?').run(dramaId);
    for (const n of names.map(s => String(s).trim()).filter(Boolean)) {
      up.run(n);
      const cv = get.get(n);
      if (cv) link.run(dramaId, cv.id);
    }
  })();
}

// 自定义封面。前端已经把图裁成 640×640 再传过来，所以这里存下来就行 ——
// 尺寸统一由客户端的 canvas 保证，服务端不需要图像库。
app.post('/api/dramas/:id/cover', (req, res) => {
  const { dataUrl } = req.body ?? {};
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) return res.status(400).json({ error: '需要 png/jpeg/webp 的 dataURL' });

  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: '图片太大' });

  const name = `custom-${req.params.id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(COVER_DIR, name), buf);

  const prev = db.prepare('SELECT cover_local FROM dramas WHERE id = ?').get(req.params.id);
  db.prepare("UPDATE dramas SET cover_local = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name, req.params.id);

  // 换封面时把上一张自定义图删掉，避免 data/covers 越堆越多。
  // 只删自己生成的 custom-*，Notion 搬过来的原图一律保留。
  if (prev?.cover_local?.startsWith('custom-') && prev.cover_local !== name) {
    try { fs.unlinkSync(path.join(COVER_DIR, prev.cover_local)); } catch {}
  }

  res.json(withCvs([db.prepare('SELECT * FROM dramas WHERE id = ?').get(req.params.id)])[0]);
});

app.delete('/api/dramas/:id', (req, res) => {
  db.prepare('DELETE FROM dramas WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ── 视图 ───────────────────────────────────────────────
//
// 贯穿的分层：「挑出来的」和「库里的」是两回事。
//   想听   = 从库里挑出来准备听的短名单     囤着 = 买了堆在库里
//   重刷计划 = 挑出来准备重刷的             重刷库 = 刷过几遍的历史

// 我正在听的剧 —— 只看 status='在听'。每日更新的有声书也在这里，不单开一栏。
app.get('/api/views/listening', (_req, res) => {
  res.json(list(`
    SELECT * FROM dramas
    WHERE status = '在听'
    ORDER BY update_day, title
  `));
});

// 听剧日程表 —— 只放在听的剧，只排周一到周日。
// 「每日」和「复杂」不占格子：它们没有固定的追剧日，看在听列表就够了。
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

app.get('/api/views/schedule', (_req, res) => {
  const rows = list(`
    SELECT d.* FROM dramas d
    WHERE d.status = '在听'
      AND (d.update_day IN (${WEEKDAYS.map(() => '?').join(',')}) OR d.update_day = '每日')
    ORDER BY d.update_day = '每日' DESC, d.title
  `, ...WEEKDAYS);

  const byDay = Object.fromEntries(WEEKDAYS.map(d => [d, []]));
  for (const r of rows) {
    // 每日更新的（多半是有声书）每一格都占 —— 它确实每天都更，
    // 只在某一天出现反而是错的。前端会给它一个「每日」标记。
    if (r.update_day === '每日') WEEKDAYS.forEach(d => byDay[d].push(r));
    else byDay[r.update_day].push(r);
  }
  res.json(byDay);
});

// 重刷计划 —— 挑出来准备重刷、还没开始的短名单
app.get('/api/views/rewatch-queue', (_req, res) => {
  res.json(list(`
    SELECT * FROM dramas WHERE rewatch_queued = 1
    ORDER BY rating DESC NULLS LAST, title
  `));
});

// 重刷库 —— 已经刷过几遍的历史
app.get('/api/views/rewatch-library', (_req, res) => {
  res.json(list(`
    SELECT * FROM dramas
    WHERE rewatch_status IS NOT NULL AND rewatch_status <> ''
    ORDER BY
      CASE rewatch_status
        WHEN '已n刷' THEN 0 WHEN '已四刷' THEN 1
        WHEN '已三刷' THEN 2 WHEN '已二刷' THEN 3 ELSE 4 END,
      rating DESC NULLS LAST
  `));
});

// 囤着 —— 买了还没开始听的
app.get('/api/views/stash', (_req, res) => {
  res.json(list(`
    SELECT * FROM dramas WHERE status = '囤着'
    ORDER BY serialize_status = '已完结' DESC, price DESC NULLS LAST, title
  `));
});

// 最近听完的剧（近一个月，天数可调）
app.get('/api/views/recent', (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json(list(`
    SELECT * FROM dramas
    WHERE finished_date IS NOT NULL AND finished_date >= date('now', ?)
    ORDER BY finished_date DESC
  `, `-${days} days`));
});

// 我想听的剧：已购未听 / 未购观望
app.get('/api/views/wishlist', (_req, res) => {
  res.json({
    已购未听: list(`SELECT * FROM dramas WHERE status = '想听' AND purchased = 1 ORDER BY title`),
    未购观望: list(`SELECT * FROM dramas WHERE status = '想听' AND purchased = 0 ORDER BY title`),
  });
});

// 推荐剧单：4.8+ 与五星
app.get('/api/views/recommend', (_req, res) => {
  res.json({
    五星: list(`SELECT * FROM dramas WHERE rating >= 5 ORDER BY title`),
    优质: list(`SELECT * FROM dramas WHERE rating >= 4.8 AND rating < 5 ORDER BY rating DESC, title`),
  });
});

// 有声书排行榜
app.get('/api/views/audiobooks', (_req, res) => {
  res.json(list(`
    SELECT * FROM dramas WHERE kind = '听书' AND rating IS NOT NULL
    ORDER BY rating DESC, title
  `));
});

// 待整理：需要你人工给个状态的剧，两类
//   new     猫耳同步进来还没标过状态的（追剧 ≠ 在听，不给默认值是有意的）
//   shelved 从 Notion 带过来的「搁置」—— 分不清是「买了没开始」还是
//           「听了一半停下」，因为已听集数在 Notion 里基本没填
app.get('/api/views/untriaged', (req, res) => {
  const kind = req.query.kind === 'shelved' ? 'shelved' : 'new';
  res.json(kind === 'shelved'
    ? list(`SELECT * FROM dramas WHERE status = '搁置' ORDER BY purchased DESC, title`)
    : list(`
        SELECT * FROM dramas
        WHERE status IS NULL AND source = 'missevan'
        ORDER BY purchased DESC, updated_at DESC
      `));
});

// ── 两个主入口 ─────────────────────────────────────────
//
// 猫耳同步来的数据就分这两类，站里的一切都从这儿开始：
//   已购 = 花过钱的
//   收藏 = 追了但没买的（观望中）
// 收听状态就在这两页里标，所以默认把「还没标过的」排在最前面。

/**
 * 排序口径。
 * `newest` 用的是猫耳列表的原始顺序（bought_order / sub_order，0 = 最新），
 * 不是 updated_at —— 后者只反映最后一次同步，跟你什么时候买的没关系。
 */
const ORDERS = {
  todo:    'status IS NOT NULL, COALESCE(@rank, 999999), title',   // 未标记优先
  newest:  'COALESCE(@rank, 999999), title',
  oldest:  'COALESCE(@rank, -1) DESC, title',
  title:   'title',
  rating:  'rating IS NULL, rating DESC, title',
  episodes:'total_episodes IS NULL, total_episodes DESC, title',
  custom:  'sort_order, COALESCE(@rank, 999999), title',           // 你自己拖的
};

const bucket = (where, rankCol) => (req, res) => {
  const { status, sort = 'todo' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(12, Number(req.query.pageSize) || 60));

  const args = [];
  let filter = where;
  if (status === '__none__') {
    filter += ' AND status IS NULL';
  } else if (status) {
    filter += ' AND status = ?';
    args.push(status);
  }

  const order = (ORDERS[sort] ?? ORDERS.todo).replaceAll('@rank', rankCol);
  const total = db.prepare(`SELECT COUNT(*) c FROM dramas WHERE ${filter}`).get(...args).c;

  res.json({
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    items: list(
      `SELECT * FROM dramas WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...args, pageSize, (page - 1) * pageSize
    ),
  });
};

// 这两个入口只代表猫耳账户里的两张清单。漫播/其他平台的购买记录
// 仍保留在档案库中，但不能混进「我的已购」。
const MISSEVAN_PURCHASED = "platform = '猫耳' AND purchased = 1";
const MISSEVAN_COLLECTION = "platform = '猫耳' AND subscribed = 1 AND purchased = 0";

app.get('/api/views/purchased',  bucket(MISSEVAN_PURCHASED, 'bought_order'));
app.get('/api/views/collection', bucket(MISSEVAN_COLLECTION, 'sub_order'));


/** 两个入口各自的状态计数，用来画筛选条 */
const bucketCounts = where => (_req, res) => {
  res.json(db.prepare(`
    SELECT COALESCE(status, '__none__') AS value, COUNT(*) AS n
    FROM dramas WHERE ${where} GROUP BY 1
  `).all());
};
app.get('/api/views/purchased/counts',  bucketCounts(MISSEVAN_PURCHASED));
app.get('/api/views/collection/counts', bucketCounts(MISSEVAN_COLLECTION));

// 筛选项 —— 全部从现有数据里数出来，不维护任何硬编码枚举。
// 加了新分类、新社团、新 CV 会自动出现在筛选面板里。
app.get('/api/facets', (_req, res) => {
  const rows = q => db.prepare(q).all();
  res.json({
    status: rows(`SELECT status AS value, COUNT(*) AS n FROM dramas
                  WHERE status IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
    platform: rows(`SELECT platform AS value, COUNT(*) AS n FROM dramas
                    GROUP BY 1 ORDER BY n DESC`),
    kind: rows(`SELECT kind AS value, COUNT(*) AS n FROM dramas
                WHERE kind IS NOT NULL AND kind <> '' GROUP BY 1 ORDER BY n DESC`),
    serialize: rows(`SELECT serialize_status AS value, COUNT(*) AS n FROM dramas
                     WHERE serialize_status IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
    // 分类存成 JSON 数组，展开来数
    category: rows(`SELECT je.value AS value, COUNT(*) AS n
                    FROM dramas d, json_each(d.categories) je
                    GROUP BY 1 ORDER BY n DESC, value`),
    organization: rows(`SELECT organization AS value, COUNT(*) AS n FROM dramas
                        WHERE organization IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
    cv: rows(`SELECT c.name AS value, COUNT(*) AS n
              FROM drama_cvs dc JOIN cvs c ON c.id = dc.cv_id
              WHERE dc.role_type = '主役'
              GROUP BY 1 ORDER BY n DESC LIMIT 60`),
    year: rows(`SELECT substr(finished_date, 1, 4) AS value, COUNT(*) AS n
                FROM dramas WHERE finished_date IS NOT NULL GROUP BY 1 ORDER BY value DESC`),
    rating: rows(`SELECT CAST(rating AS TEXT) AS value, COUNT(*) AS n FROM dramas
                  WHERE rating IS NOT NULL GROUP BY 1 ORDER BY rating DESC`),
  });
});

// CV 自查 + CV 排行榜（阈值默认 10 部）
// 默认只算主役。猫耳给的是全体参演（一部剧十几二十位），
// 全算进去排行就成了「谁跑龙套最多」，不是你想看的东西。
// CV 统计**只算你标记为「听完」的剧**。
// 追了没听、囤着、搁置、弃了的都不算 —— 「听过这位 CV 多少部」问的是
// 实际听完的数量，把没听的算进来这个排行就没意义了。
const HEARD = "d.status = '听完'";

app.get('/api/cvs', (req, res) => {
  const min = Number(req.query.min) || 0;
  const includeSupporting = req.query.role === 'all';
  res.json(db.prepare(`
    SELECT c.id, c.name, c.avatar_url, c.missevan_id,
           COUNT(dc.drama_id) AS drama_count,
           ROUND(AVG(d.rating), 2) AS avg_rating
    FROM cvs c
    JOIN drama_cvs dc ON dc.cv_id = c.id
    JOIN dramas d ON d.id = dc.drama_id
    WHERE ${HEARD} ${includeSupporting ? '' : "AND dc.role_type = '主役'"}
    GROUP BY c.id
    HAVING drama_count >= ?
    ORDER BY drama_count DESC, avg_rating DESC
  `).all(min));
});

app.get('/api/cvs/:name/dramas', (req, res) => {
  const mainOnly = req.query.role !== 'all';
  res.json(list(`
    SELECT d.* FROM dramas d
    JOIN drama_cvs dc ON dc.drama_id = d.id
    JOIN cvs c ON c.id = dc.cv_id
    WHERE c.name = ? AND ${HEARD} ${mainOnly ? "AND dc.role_type = '主役'" : ''}
    ORDER BY d.rating DESC NULLS LAST, d.title
  `, req.params.name));
});

// 年度汇总
app.get('/api/years', (_req, res) => {
  res.json(db.prepare(`
    SELECT substr(finished_date, 1, 4) AS year,
           COUNT(*) AS count,
           ROUND(AVG(rating), 2) AS avg_rating
    FROM dramas WHERE finished_date IS NOT NULL
    GROUP BY year ORDER BY year DESC
  `).all());
});

// 年度可视化用的数据。四张图都是单系列 —— 一个颜色、不需要图例，
// 也就不需要分类色板（archival 那套低饱和色做分类色是过不了 CVD 检查的）。
app.get('/api/years/:year/stats', (req, res) => {
  const y = String(req.params.year);
  const all = q => db.prepare(q).all(y);
  const one = q => db.prepare(q).get(y);

  const monthRows = all(`
    SELECT CAST(substr(finished_date, 6, 2) AS INTEGER) AS m, COUNT(*) AS n
    FROM dramas WHERE substr(finished_date, 1, 4) = ? GROUP BY m
  `);
  const byMonth = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    n: monthRows.find(r => r.m === i + 1)?.n ?? 0,
  }));

  res.json({
    year: y,
    total: one(`SELECT COUNT(*) c FROM dramas WHERE substr(finished_date,1,4) = ?`).c,
    avgRating: one(`SELECT ROUND(AVG(rating), 2) c FROM dramas
                    WHERE substr(finished_date,1,4) = ? AND rating IS NOT NULL`).c,
    episodes: one(`SELECT COALESCE(SUM(total_episodes), 0) c FROM dramas
                   WHERE substr(finished_date,1,4) = ?`).c,
    reviews: one(`SELECT COUNT(*) c FROM dramas
                  WHERE substr(finished_date,1,4) = ? AND review IS NOT NULL`).c,
    byMonth,
    byRating: all(`SELECT CAST(rating AS TEXT) AS label, COUNT(*) AS n FROM dramas
                   WHERE substr(finished_date,1,4) = ? AND rating IS NOT NULL
                   GROUP BY rating ORDER BY rating DESC`),
    byCategory: all(`SELECT je.value AS label, COUNT(*) AS n
                     FROM dramas d, json_each(d.categories) je
                     WHERE substr(d.finished_date,1,4) = ?
                     GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    topCvs: all(`SELECT c.name AS label, COUNT(*) AS n
                 FROM dramas d
                 JOIN drama_cvs dc ON dc.drama_id = d.id AND dc.role_type = '主役'
                 JOIN cvs c ON c.id = dc.cv_id
                 WHERE substr(d.finished_date,1,4) = ?
                 GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    topRated: all(`SELECT title AS label, rating AS n FROM dramas
                   WHERE substr(finished_date,1,4) = ? AND rating IS NOT NULL
                   ORDER BY rating DESC, title LIMIT 8`),
  });
});

app.get('/api/years/:year', (req, res) => {
  res.json(list(`
    SELECT * FROM dramas
    WHERE substr(finished_date, 1, 4) = ?
    ORDER BY finished_date DESC
  `, req.params.year));
});

// 概览统计
app.get('/api/stats', (_req, res) => {
  const one = q => db.prepare(q).get();
  res.json({
    total: one('SELECT COUNT(*) c FROM dramas').c,
    byStatus: db.prepare('SELECT status, COUNT(*) c FROM dramas GROUP BY status').all(),
    byPlatform: db.prepare('SELECT platform, COUNT(*) c FROM dramas GROUP BY platform').all(),
    byKind: db.prepare('SELECT kind, COUNT(*) c FROM dramas GROUP BY kind').all(),
    purchased: one(`SELECT COUNT(*) c FROM dramas WHERE ${MISSEVAN_PURCHASED}`).c,
    subscribed: one(`SELECT COUNT(*) c FROM dramas WHERE platform = '猫耳' AND subscribed = 1`).c,
    reviews: one('SELECT COUNT(*) c FROM dramas WHERE review IS NOT NULL').c,
    // 侧栏角标：两个主入口显示「还没标状态的有几部」，那才是待办
    purchasedTodo:  one(`SELECT COUNT(*) c FROM dramas WHERE ${MISSEVAN_PURCHASED} AND status IS NULL`).c,
    collectionTodo: one(`SELECT COUNT(*) c FROM dramas WHERE ${MISSEVAN_COLLECTION} AND status IS NULL`).c,
    listening: one("SELECT COUNT(*) c FROM dramas WHERE status = '在听'").c,
    rewatchQueue: one('SELECT COUNT(*) c FROM dramas WHERE rewatch_queued = 1').c,
    lastSync: one("SELECT ran_at, kind FROM sync_log ORDER BY id DESC LIMIT 1"),
  });
});

// 同步日志（用来回看「这次改了什么」）
app.get('/api/sync-log', (_req, res) => {
  res.json(db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 20').all()
    .map(r => ({ ...r, detail: JSON.parse(r.detail || '[]') })));
});

app.listen(PORT, () => console.log(`RadioTracker API → http://localhost:${PORT}`));
