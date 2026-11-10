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
let repaired = 0;
let failed = 0;
let cursor = 0;

function isImage(bytes) {
  const head = new Uint8Array(bytes.slice(0, 12));
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const webp = String.fromCharCode(...head.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  return bytes.byteLength > 512 && (png || jpeg || webp);
}

async function cacheNext() {
  while (cursor < (dramas || []).length) {
    const drama = dramas[cursor++];
    if (!drama.cover_url) continue;
    const imported = drama.cover_local?.startsWith('r2:') && drama.cover_local.includes('/imported/');
    if (drama.cover_local?.startsWith('r2:') && !imported) continue;
    const key = imported
      ? drama.cover_local.slice(3)
      : `remote/${crypto.createHash('sha256').update(drama.cover_url).digest('hex')}`;
    if (!imported) {
      const { data: found } = await bucket.download(key);
      if (found && isImage(await found.arrayBuffer())) { existing++; continue; }
    }
    try {
      const response = await fetch(drama.cover_url, {
        headers: { Referer: 'https://www.missevan.com/', 'User-Agent': 'Mozilla/5.0 RadioTracker' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (!isImage(bytes)) throw new Error('下载内容不是有效图片');
      const { error: uploadError } = await bucket.upload(key, bytes, {
        contentType: response.headers.get('content-type') || 'image/jpeg',
        upsert: true,
      });
      if (uploadError) throw uploadError;
      if (imported) repaired++; else cached++;
    } catch (reason) {
      failed++;
      console.warn(`封面缓存失败：${drama.title} · ${String(reason.message || reason)}`);
    }
  }
}

await Promise.all(Array.from({ length: 6 }, cacheNext));
console.log(`封面缓存完成：新增 ${cached}，修复导入 ${repaired}，已有 ${existing}，失败 ${failed}`);
