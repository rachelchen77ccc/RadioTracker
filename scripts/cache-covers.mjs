/**
 * 把所有远程封面预先抓到本地 data/covers/remote/。
 *
 *   node scripts/cache-covers.mjs
 *
 * 为什么需要：猫耳 CDN 校验 Referer，浏览器直连拿 403，所以封面都走
 * /api/cover 代理。不预热的话第一次打开页面要现抓三百多张图，很慢。
 * 顺带一个好处：猫耳换图或删图之后，本地这份还在。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, COVER_DIR } from '../server/db.js';

const CACHE_DIR = path.join(COVER_DIR, 'remote');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const db = openDb();
const rows = db.prepare(
  `SELECT title, cover_url FROM dramas WHERE cover_url IS NOT NULL AND cover_local IS NULL`
).all();

let cached = 0, skipped = 0, failed = 0;
const failures = [];

for (const [i, r] of rows.entries()) {
  const ext = (path.extname(new URL(r.cover_url).pathname) || '.jpg').slice(0, 5);
  const file = path.join(
    CACHE_DIR,
    crypto.createHash('sha1').update(r.cover_url).digest('hex') + ext
  );
  if (fs.existsSync(file)) { skipped++; continue; }

  try {
    const res = await fetch(r.cover_url, {
      headers: { Referer: 'https://www.missevan.com/', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    cached++;
  } catch (e) {
    failed++;
    failures.push({ title: r.title, err: String(e.message ?? e) });
  }

  if (i % 40 === 39) process.stdout.write(`  ${i + 1}/${rows.length}\r`);
  await new Promise(r => setTimeout(r, 120));
}

console.log(`\n封面缓存：新抓 ${cached} · 已有 ${skipped} · 失败 ${failed}`);
for (const f of failures.slice(0, 10)) console.log(`   ${f.title} — ${f.err}`);
