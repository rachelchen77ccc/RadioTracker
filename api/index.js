import { waitUntil } from '@vercel/functions';
import worker from '../server/cloud/worker.js';
import { createVercelEnv } from '../server/vercel/runtime.js';
import { handleSupabaseAuthProxy } from '../server/vercel/supabase-auth-proxy.js';

export const config = { maxDuration: 300 };

export default {
  async fetch(request) {
    const authResponse = await handleSupabaseAuthProxy(request);
    if (authResponse) return authResponse;
    return worker.fetch(request, createVercelEnv(), { waitUntil });
  },
};
