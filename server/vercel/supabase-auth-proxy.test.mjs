import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSupabaseAuthProxy } from './supabase-auth-proxy.js';

const env = { SUPABASE_URL: 'https://project.supabase.co' };

test('只把 Supabase auth 请求转发到配置的项目', async () => {
  let received;
  const response = await handleSupabaseAuthProxy(new Request(
    'https://radio.example/api/supabase-auth?path=%2Fauth%2Fv1%2Ftoken%3Fgrant_type%3Dpassword',
    {
      method: 'POST',
      headers: { apikey: 'public-key', cookie: 'private-cookie', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'listener@example.com', password: 'secret' }),
    },
  ), {
    env,
    fetchImpl: async (url, init) => {
      received = { url: String(url), init, body: Buffer.from(init.body).toString('utf8') };
      return Response.json({ access_token: 'token' });
    },
  });

  assert.equal(received.url, 'https://project.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(received.init.headers.get('apikey'), 'public-key');
  assert.equal(received.init.headers.has('cookie'), false);
  assert.match(received.body, /listener@example.com/);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access_token, 'token');
});

test('Vercel 重写丢失查询参数时从请求头读取认证路径', async () => {
  let received;
  const response = await handleSupabaseAuthProxy(new Request(
    'https://radio.example/api/supabase-auth',
    {
      method: 'POST',
      headers: {
        'x-supabase-auth-path': '/auth/v1/token?grant_type=refresh_token',
        apikey: 'public-key',
      },
      body: '{}',
    },
  ), {
    env,
    fetchImpl: async (url, init) => {
      received = { url: String(url), headers: init.headers };
      return Response.json({ access_token: 'token' });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(received.url, 'https://project.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.equal(received.headers.has('x-supabase-auth-path'), false);
});

test('拒绝把认证代理用作任意网址代理', async () => {
  const response = await handleSupabaseAuthProxy(new Request(
    'https://radio.example/api/supabase-auth?path=https%3A%2F%2Fevil.example%2Fauth%2Fv1%2Ftoken',
  ), { env });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /不允许/);
});

test('上游连接失败时快速返回可读错误', async () => {
  const response = await handleSupabaseAuthProxy(new Request(
    'https://radio.example/api/supabase-auth?path=%2Fauth%2Fv1%2Ftoken',
    { method: 'POST', body: '{}' },
  ), {
    env,
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /暂时无法连接/);
});
