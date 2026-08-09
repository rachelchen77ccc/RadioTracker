const AUTH_PATH_PREFIX = '/auth/v1/';
const PROXY_PATH = '/api/supabase-auth';
const AUTH_PATH_HEADER = 'x-supabase-auth-path';
const REQUEST_HEADERS_TO_FORWARD = [
  'accept',
  'apikey',
  'authorization',
  'content-type',
  'x-client-info',
  'x-supabase-api-version',
];
const RESPONSE_HEADERS_TO_DROP = ['connection', 'content-encoding', 'content-length', 'set-cookie', 'transfer-encoding'];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function getSupabaseUrl(env) {
  return (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)?.trim() || null;
}

export async function handleSupabaseAuthProxy(request, {
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  const incoming = new URL(request.url);
  if (incoming.pathname !== PROXY_PATH) return null;

  const base = getSupabaseUrl(env);
  if (!base) return json({ error: '认证代理缺少 Supabase 配置' }, 503);

  const path = request.headers.get(AUTH_PATH_HEADER) || incoming.searchParams.get('path');
  if (!path?.startsWith(AUTH_PATH_PREFIX)) return json({ error: '不允许的认证请求' }, 400);

  const baseUrl = new URL(base);
  const target = new URL(path, baseUrl);
  if (target.origin !== baseUrl.origin || !target.pathname.startsWith(AUTH_PATH_PREFIX)) {
    return json({ error: '不允许的认证目标' }, 400);
  }

  const headers = new Headers();
  REQUEST_HEADERS_TO_FORWARD.forEach(name => {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
      signal: controller.signal,
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();

    const upstream = await fetchImpl(target, init);
    const responseHeaders = new Headers(upstream.headers);
    RESPONSE_HEADERS_TO_DROP.forEach(name => responseHeaders.delete(name));
    responseHeaders.set('Cache-Control', 'no-store');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return json({ error: timedOut ? '认证服务连接超时，请稍后重试' : '认证服务暂时无法连接' }, 502);
  } finally {
    clearTimeout(timer);
  }
}
