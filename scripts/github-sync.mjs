import worker from '../server/cloud/worker.js';
import { createVercelEnv } from '../server/vercel/runtime.js';

const ownerId = process.env.OWNER_USER_ID?.trim();
if (!ownerId) throw new Error('缺少 OWNER_USER_ID');

const env = createVercelEnv();
env.resolveUser = async () => ownerId;

let background = null;
const ctx = {
  waitUntil(promise) { background = Promise.resolve(promise); },
};

const response = await worker.fetch(new Request('https://github-actions.invalid/api/sync', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
}), env, ctx);
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result.error || `同步启动失败（${response.status}）`);
if (background) await background;

const statusResponse = await worker.fetch(
  new Request('https://github-actions.invalid/api/sync/status'), env, { waitUntil() {} },
);
const status = await statusResponse.json();
if (status.error) throw new Error(status.error);
console.log(`猫耳同步完成：${status.finishedAt || '完成'}`);
