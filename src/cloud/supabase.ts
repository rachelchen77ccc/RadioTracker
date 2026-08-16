import { createClient, type Session } from '@supabase/supabase-js';
import { staticApiFetch } from './staticApi';

const url = (
  import.meta.env.VITE_SUPABASE_URL
  || import.meta.env.NEXT_PUBLIC_SUPABASE_URL
)?.trim();
const anonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)?.trim();

export const githubPagesMode = import.meta.env.VITE_GITHUB_PAGES === 'true';

function shouldProxyAuth(target: URL) {
  if (typeof window === 'undefined' || !url || githubPagesMode) return false;
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  return !localHost
    && target.origin === new URL(url).origin
    && target.pathname.startsWith('/auth/v1/');
}

async function cloudFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const target = new URL(request.url);
  if (!shouldProxyAuth(target)) return fetch(request);

  const proxy = new URL('/api/supabase-auth', window.location.origin);
  const authPath = target.pathname + target.search;
  proxy.searchParams.set('path', authPath);
  const proxyRequest = new Request(proxy, request);
  // Vercel's /api rewrite can discard the query string before the function runs.
  proxyRequest.headers.set('X-Supabase-Auth-Path', authPath);
  return fetch(proxyRequest);
}

export const cloudEnabled = Boolean(url && anonKey);
export const supabase = cloudEnabled ? createClient(url, anonKey, {
  global: { fetch: cloudFetch },
}) : null;

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function appFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
  if (githubPagesMode && path.startsWith('/api/') && supabase) {
    return staticApiFetch(supabase, input, init);
  }
  const headers = new Headers(init.headers);
  const session = await currentSession();
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
