const PENDING_COOKIE_KEY = 'radiotracker:pending-missevan-cookie';
const HASH_KEY = 'missevan_connect';

/**
 * 书签脚本从猫耳跳回来时，cookie 只放在 URL fragment 中：fragment 不会发送给
 * Vercel。页面脚本会立即把它移入当前标签页的 sessionStorage，并清掉地址栏。
 */
export function captureMissevanConnect() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const cookie = params.get(HASH_KEY)?.trim();
  if (!cookie) return;
  try { window.sessionStorage.setItem(PENDING_COOKIE_KEY, cookie); } catch { /* 稍后仍可手动粘贴 */ }
  window.history.replaceState(null, '', '/');
}

export function pendingMissevanCookie() {
  try { return window.sessionStorage.getItem(PENDING_COOKIE_KEY) || ''; } catch { return ''; }
}

export function clearPendingMissevanCookie() {
  try { window.sessionStorage.removeItem(PENDING_COOKIE_KEY); } catch { /* 无需处理 */ }
}

export function missevanBookmarklet() {
  const site = (
    import.meta.env.NEXT_PUBLIC_SITE_URL?.trim()
    || window.location.origin
  ).replace(/\/$/, '');
  const target = `${site}/#${HASH_KEY}=`;
  return `javascript:(()=>{const c=document.cookie;if(!c){alert('没有读取到猫耳登录信息，请先登录猫耳网页');return}location.href='${target}'+encodeURIComponent(c)})()`;
}
