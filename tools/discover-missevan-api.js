/*
 * 猫耳 FM 接口探测脚本（只读，不发送任何数据到外部）
 *
 * 用法：
 *   1. Chrome 打开 https://www.missevan.com/ 并确认已登录
 *   2. F12 打开开发者工具 → Console 面板
 *   3. 把本文件全部内容粘贴进去，回车（若提示 "allow pasting"，先输入 allow pasting 回车）
 *   4. 然后在页面上依次点开：
 *        - 个人中心 → 我的收藏（广播剧收藏）
 *        - 个人中心 → 我的已购 / 已购买
 *      每个列表都往下翻两页，让它把翻页请求也抓到
 *   5. 回到 Console，输入   __me.dump()   回车
 *   6. 会自动下载一个 missevan-endpoints.json，把它发给我
 *
 * 脚本做了什么：劫持 fetch / XMLHttpRequest，只记录请求的 URL、方法、
 * 以及响应 JSON 的**结构骨架**（字段名 + 类型，不含字段值）。
 * 不记录 cookie、token、密码，不上传任何东西。
 */
(() => {
  if (window.__me) {
    console.log('%c已经在记录了，继续点页面就行。', 'color:#3a7');
    return;
  }

  const hits = new Map();

  // 只保留结构，不保留值 —— 避免把个人数据带出去
  const skeleton = (v, depth = 0) => {
    if (depth > 4) return '…';
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.length ? [skeleton(v[0], depth + 1)] : [];
    if (typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).slice(0, 40)) o[k] = skeleton(v[k], depth + 1);
      return o;
    }
    return typeof v;
  };

  const record = (url, method, text) => {
    try {
      const u = new URL(url, location.origin);
      if (!/missevan/.test(u.hostname)) return;
      // 静态资源和埋点不要
      if (/\.(js|css|png|jpe?g|gif|webp|svg|woff2?|mp3|m4a)(\?|$)/i.test(u.pathname)) return;
      if (/log|track|report|stat/i.test(u.pathname)) return;

      let body = null;
      try { body = JSON.parse(text); } catch { return; } // 只要 JSON 接口

      const key = method + ' ' + u.origin + u.pathname;
      const prev = hits.get(key);
      hits.set(key, {
        method,
        url: u.origin + u.pathname,
        // 参数只留键名和示例值里的数字/分页信息，避免带出敏感串
        params: [...u.searchParams.keys()],
        sampleQuery: u.search,
        shape: prev?.shape ?? skeleton(body),
        seen: (prev?.seen ?? 0) + 1,
      });
      console.log('%c[捕获] ' + key, 'color:#888');
    } catch { /* ignore */ }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const method = (args[1]?.method || args[0]?.method || 'GET').toUpperCase();
    res.clone().text().then(t => record(url, method, t)).catch(() => {});
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__me_m = (method || 'GET').toUpperCase();
    this.__me_u = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try { record(this.__me_u, this.__me_m, this.responseText); } catch {}
    });
    return origSend.apply(this, args);
  };

  window.__me = {
    list: () => console.table([...hits.values()].map(h => ({ 接口: h.method + ' ' + h.url, 次数: h.seen }))),
    dump: () => {
      const out = { capturedAt: new Date().toISOString(), endpoints: [...hits.values()] };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'missevan-endpoints.json';
      a.click();
      console.log('%c已导出 ' + hits.size + ' 个接口。', 'color:#3a7;font-weight:bold');
    },
  };

  console.log('%c✓ 开始记录。现在去点「我的收藏」和「我的已购」，翻两页，然后回来输入 __me.dump()',
    'color:#3a7;font-weight:bold;font-size:13px');
})();
