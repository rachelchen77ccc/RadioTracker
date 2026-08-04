/**
 * 用保存下来的登录态，直接在服务端拉「我的已购」和「我的追剧」。
 *
 *   node scripts/fetch-lists.mjs
 *
 * 凭据存在 data/.missevan-session.json（600 权限、已进 .gitignore）。
 * 没有凭据就直接退出，不报错 —— 调用方会跳过这一步，只跑后面的补详情。
 *
 * ⚠️ 猫耳的登录态会过期。过期后这两个接口返回的是空列表或错误码，
 * 而不是 401，所以这里显式校验：拿不到任何已购就当作失效，
 * 让调用方能明确告诉你「该重新贴 cookie 了」，而不是静默同步出一份空数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/db.js';

const SESSION = path.join(ROOT, 'data', '.missevan-session.json');
const OUT = path.join(ROOT, 'data', 'missevan-lists.json');

if (!fs.existsSync(SESSION)) {
  console.log('没有保存的登录态，跳过拉取列表（只会补详情和封面）');
  process.exit(0);
}

const { cookie, userId } = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
if (!cookie || !userId) {
  console.error('登录态文件不完整');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const get = async (url, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: cookie,
          Referer: 'https://www.missevan.com/',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
};

// ── 已购（每页 100）──
const bought = [];
let boughtPages = 0;
{
  let p = 1, maxpage = 1;
  do {
    const payload = await get(
      `https://www.missevan.com/mperson/getdramabought?page=${p}&page_size=100`
    );
    const info = payload?.info;
    if (!info || !Array.isArray(info.data) || !info.pagination) {
      throw new Error(`已购第 ${p} 页结构异常，停止同步以保护本地数据`);
    }
    bought.push(...info.data);
    maxpage = Number(info.pagination.maxpage ?? 1);
    if (!Number.isInteger(maxpage) || maxpage < 1) {
      throw new Error(`已购第 ${p} 页分页信息异常，停止同步以保护本地数据`);
    }
    boughtPages++;
    console.log(`已购 ${p}/${maxpage} · 累计 ${bought.length}`);
    p++;
    await sleep(400);
  } while (p <= maxpage);
}

// ── 追剧（服务端把每页锁死 20；翻页参数是 page 不是 p）──
const subs = [];
let subscriptionPages = 0;
{
  let p = 1, maxpage = 1;
  do {
    const payload = await get(
      `https://www.missevan.com/dramaapi/getusersubscriptions?user_id=${userId}&page_size=20&page=${p}`
    );
    const info = payload?.info;
    if (!info || !Array.isArray(info.Datas) || !info.pagination) {
      throw new Error(`追剧第 ${p} 页结构异常，停止同步以保护本地数据`);
    }
    subs.push(...info.Datas);
    maxpage = Number(info.pagination.maxpage ?? 1);
    if (!Number.isInteger(maxpage) || maxpage < 1) {
      throw new Error(`追剧第 ${p} 页分页信息异常，停止同步以保护本地数据`);
    }
    subscriptionPages++;
    console.log(`追剧 ${p}/${maxpage} · 累计 ${subs.length}`);
    p++;
    await sleep(400);
  } while (p <= maxpage);
}

if (!bought.length && !subs.length) {
  console.error('两个列表都是空的 —— 登录态多半过期了，去设置里重新粘一次 cookie');
  process.exit(3);
}

fs.writeFileSync(OUT, JSON.stringify({
  exportedAt: new Date().toISOString(),
  userId,
  listsComplete: true,
  pageCounts: { bought: boughtPages, subscriptions: subscriptionPages },
  boughtIds: bought.map(d => String(d.id)),
  subscriptionIds: subs.map(d => String(d.id)),
  bought,
  subscriptions: subs,
}));

console.log(`\n拉取完成：已购 ${bought.length} · 追剧 ${subs.length}`);
