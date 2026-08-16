import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const ownerId = process.env.OWNER_USER_ID?.trim();
if (!supabaseUrl || !serviceKey || !ownerId) throw new Error('缺少封面缓存所需的 GitHub Secret');

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const bucket = supabase.storage.from('drama-covers');
const { data: dramas, error } = await supabase.from('dramas')
  .select('id,title,cover_url,cover_local')
  .eq('user_id', ownerId)
  .not('cover_url', 'is', null);
if (error) throw error;

let cached = 0;
let existing = 0;
let failed = 0;
let cursor = 0;

async function cacheNext() {
  while (cursor < (dramas || []).length) {
    const drama = dramas[cursor++];
    if (drama.cover_local?.startsWith('r2:') || !drama.cover_url) continue;
    const key = `remote/${crypto.createHash('sha256').update(drama.cover_url).digest('hex')}`;
    const { data: found } = await bucket.download(key);
    if (found) { existing++; continue; }
    try {
      const response = await fetch(drama.cover_url, {
        headers: { Referer: 'https://www.missevan.com/', 'User-Agent': 'Mozilla/5.0 RadioTracker' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const { error: uploadError } = await bucket.upload(key, bytes, {
        contentType: response.headers.get('content-type') || 'image/jpeg',
        upsert: true,
      });
      if (uploadError) throw uploadError;
      cached++;
    } catch (reason) {
      failed++;
      console.warn(`封面缓存失败：${drama.title} · ${String(reason.message || reason)}`);
    }
  }
}

await Promise.all(Array.from({ length: 6 }, cacheNext));
console.log(`封面缓存完成：新增 ${cached}，已有 ${existing}，失败 ${failed}`);
