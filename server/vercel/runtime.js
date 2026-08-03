import { createClient } from '@supabase/supabase-js';
import { createPostgresD1 } from './postgres-d1.js';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function createCoverStore(supabase) {
  const bucket = supabase.storage.from('drama-covers');
  const publicBase = `${requireEnv('SUPABASE_URL')}/storage/v1/object/public/drama-covers/`;
  return {
    async get(key) {
      const { data, error } = await bucket.download(key);
      if (error || !data) return null;
      return { body: data, httpMetadata: { contentType: data.type || 'image/jpeg' } };
    },
    async put(key, body, options = {}) {
      const { error } = await bucket.upload(key, body, {
        contentType: options.httpMetadata?.contentType || 'application/octet-stream',
        upsert: true,
      });
      if (error) throw error;
    },
    async delete(key) {
      const { error } = await bucket.remove([key]);
      if (error) throw error;
    },
    publicUrl(key) { return publicBase + key.split('/').map(encodeURIComponent).join('/'); },
  };
}

let cached;

export function createVercelEnv() {
  if (cached) return cached;
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cached = {
    DB: createPostgresD1(requireEnv('DATABASE_URL')),
    COVERS: createCoverStore(supabase),
    CREDENTIAL_ENCRYPTION_KEY: requireEnv('CREDENTIAL_ENCRYPTION_KEY'),
    PRIVATE_OWNER_MODE: 'false',
    async resolveUser(request) {
      const authorization = request.headers.get('authorization') || '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!token) return null;
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
  };
  return cached;
}
