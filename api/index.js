import { waitUntil } from '@vercel/functions';
import worker from '../server/cloud/worker.js';
import { createVercelEnv } from '../server/vercel/runtime.js';

export const config = { maxDuration: 300 };

export default {
  async fetch(request) {
    return worker.fetch(request, createVercelEnv(), { waitUntil });
  },
};
