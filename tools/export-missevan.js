/*
 * 猫耳 FM —— 导出「我的已购」和「我的追剧」
 *
 * 这个脚本只做一件事：把两个**需要登录态**的列表抓下来。
 * 剧集详情（CV / 分类 / 社团 / 集数）走的是公开接口，交给服务端拉
 * （npm run fetch:details），所以这里跑得很快，导出文件也只有几十 KB。
 *
 * 用法：
 *   1. Chrome 打开 https://www.missevan.com/ 并确认已登录
 *   2. F12 → Console，粘贴本文件全部内容，回车
 *      （若提示 "allow pasting"，先输入 allow pasting 回车再粘贴）
 *   3. 下载到的 missevan-lists.json 放进 RadioTracker/data/
 *   4. 终端里跑：
 *        npm run import:missevan     合并已购/追剧标记
 *        npm run fetch:details       补 CV、分类、社团、集数
 *        npm run cache:covers        预热封面
 *
 * 如果 Chrome 拦了下载（地址栏右侧会出现拦截提示，点开允许即可），
 * 也可以在 Console 里执行 copy(JSON.stringify(window.__missevanLists))，
 * 再粘贴进 data/missevan-lists.json。
 *
 * 登录态全程留在你的浏览器里，本项目不接触任何凭据。
 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (m, c = '#3a7') => console.log('%c' + m, `color:${c};font-weight:bold`);

  const get = async (url, tries = 3) => {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) {
        if (i === tries - 1) throw e;
        await sleep(1200 * (i + 1));
      }
    }
  };

  const uid = (() => {
    const a = [...document.querySelectorAll('a')]
      .map(x => /missevan\.com\/(\d{4,})(\/|$|#)/.exec(x.href))
      .find(Boolean);
    if (a) return a[1];
    const m = /muid=(\d+)/.exec(document.cookie);
    return m ? m[1] : null;
  })();

  if (!uid) {
    console.error('拿不到用户 ID —— 确认已登录，并在 www.missevan.com 上运行本脚本。');
    return;
  }
  log(`用户 ID: ${uid}`);

  // ── 已购 ──
  const bought = [];
  for (let p = 1, maxpage = 1; p <= maxpage; p++) {
    const info = (await get(`/mperson/getdramabought?page=${p}&page_size=100`)).info || {};
    bought.push(...(info.data || []));
    maxpage = info.pagination?.maxpage ?? 1;
    log(`已购 ${p}/${maxpage} · 累计 ${bought.length}`, '#888');
    await sleep(300);
  }
  log(`✓ 已购 ${bought.length} 部`);

  // ── 追剧 ──
  // 翻页参数是 page，不是页面 URL 里那个 p —— 传 p 会静默返回第一页，
  // 结果是「抓了 15 页其实全是同 20 条」。
  const subs = [];
  for (let p = 1, maxpage = 1; p <= maxpage; p++) {
    const info = (await get(
      `/dramaapi/getusersubscriptions?user_id=${uid}&page_size=20&page=${p}`
    )).info || {};
    subs.push(...(info.Datas || []));
    maxpage = info.pagination?.maxpage ?? 1;
    log(`追剧 ${p}/${maxpage} · 累计 ${subs.length}`, '#888');
    await sleep(300);
  }
  log(`✓ 追剧 ${subs.length} 部`);

  // 顺手取一下猫耳记录的收听位置。这是用户态数据，服务端拿不到。
  // 它只作提示用，永远不会覆盖你手动标的进度 —— 点进去 ≠ 听了。
  const ids = [...new Set([...bought, ...subs].map(d => String(d.id)))];
  const sawEpisodes = {};
  log(`顺便取 ${ids.length} 部的收听位置（仅作提示，约 1 分钟）…`);
  for (const [i, id] of ids.entries()) {
    try {
      const info = (await get(`/dramaapi/getdrama?drama_id=${id}`)).info || {};
      if (info.saw_episode) sawEpisodes[id] = info.saw_episode;
    } catch { /* 缺了不影响任何东西 */ }
    if (i % 50 === 49) log(`  ${i + 1}/${ids.length}`, '#888');
    await sleep(250);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    userId: uid,
    boughtIds: bought.map(d => String(d.id)),
    subscriptionIds: subs.map(d => String(d.id)),
    bought,
    subscriptions: subs,
    sawEpisodes,
  };
  window.__missevanLists = payload;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  );
  a.download = 'missevan-lists.json';
  a.click();

  log(`✓ 完成：已购 ${bought.length} · 追剧 ${subs.length} · 收听位置 ${Object.keys(sawEpisodes).length}`);
  log('missevan-lists.json → 放进 RadioTracker/data/，然后 npm run import:missevan');
  log('（下载被拦的话：copy(JSON.stringify(window.__missevanLists)) 再粘进文件）');
})();
