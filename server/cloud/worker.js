import { resolveEpisodeTotal } from '../../scripts/episode-total.mjs';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const EDITABLE = new Set([
  'title', 'platform', 'kind', 'status', 'purchased', 'subscribed',
  'heard_episodes', 'total_episodes', 'rating', 'finished_date',
  'rewatch_status', 'rewatch_queued', 'review', 'serialize_status', 'update_info',
  'update_day', 'price', 'organization', 'abstract', 'cover_url', 'missevan_id',
]);
const ALLOWED_COVER_HOST = /(^|\.)(maoercdn|missevan)\.com$/;
const MISSEVAN_PURCHASED = "platform = '猫耳' AND purchased = 1";
const MISSEVAN_COLLECTION = "platform = '猫耳' AND subscribed = 1 AND purchased = 0";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const empty = (status = 204) => new Response(null, { status });
const now = () => new Date().toISOString();
const todayInChina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const placeholders = count => Array.from({ length: count }, () => '?').join(',');

async function currentUser(request, env) {
  if (typeof env.resolveUser === 'function') return env.resolveUser(request);
  if (String(env.PRIVATE_OWNER_MODE) === 'true') return 'owner:primary';
  return request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() || null;
}

async function all(env, sql, params = []) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

async function first(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function run(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).run();
}

function shape(row, env) {
  if (!row) return row;
  let categories = [];
  try { categories = JSON.parse(row.categories || '[]'); } catch { categories = []; }
  const localCover = row.cover_local
    ? row.cover_local.startsWith('r2:')
      ? (env.COVERS.publicUrl?.(row.cover_local.slice(3)) || `/api/dramas/${row.id}/cover-file`)
      : `/covers/${encodeURIComponent(row.cover_local)}`
    : null;
  return {
    ...row,
    // Postgres 的 date 会被驱动转成 Date，JSON 后变成带时间的 ISO 字符串；
    // <input type="date"> 只接受 YYYY-MM-DD，所以在 API 边界统一压回日期格式。
    finished_date: row.finished_date == null ? null
      : row.finished_date instanceof Date
        ? row.finished_date.toISOString().slice(0, 10)
        : String(row.finished_date).slice(0, 10),
    categories,
    purchased: Boolean(row.purchased),
    subscribed: Boolean(row.subscribed),
    rewatch_queued: Boolean(row.rewatch_queued),
    cover: localCover || (row.cover_url ? `/api/cover?u=${encodeURIComponent(row.cover_url)}` : null),
    sawHint: row.sync_saw_episode || null,
  };
}

async function withCvs(env, userId, rows) {
  if (!rows.length) return [];
  const ids = rows.map(row => Number(row.id));
  const cvs = await all(env, `
    SELECT dc.drama_id, c.id, c.name, dc.character, dc.role_type
    FROM drama_cvs dc JOIN cvs c ON c.id = dc.cv_id
    WHERE c.user_id = ? AND dc.drama_id IN (${placeholders(ids.length)})
    ORDER BY dc.role_type = '主役' DESC, c.name
  `, [userId, ...ids]);
  const map = new Map(ids.map(id => [id, []]));
  for (const cv of cvs) map.get(Number(cv.drama_id))?.push(cv);
  return rows.map(row => ({ ...shape(row, env), cvs: map.get(Number(row.id)) || [] }));
}

async function list(env, userId, sql, params = []) {
  return withCvs(env, userId, await all(env, sql, params));
}

function base64Encode(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function base64Decode(value) {
  const text = atob(value);
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

async function credentialKey(env) {
  const bytes = base64Decode(String(env.CREDENTIAL_ENCRYPTION_KEY || ''));
  if (bytes.length !== 32) throw new Error('服务端登录凭据密钥未配置');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptCookie(cookie, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('radiotracker:missevan:v1') },
    await credentialKey(env),
    new TextEncoder().encode(cookie),
  );
  return { ciphertext: base64Encode(new Uint8Array(encrypted)), iv: base64Encode(iv) };
}

async function decryptCookie(record, env) {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64Decode(record.credential_iv),
      additionalData: new TextEncoder().encode('radiotracker:missevan:v1'),
    },
    await credentialKey(env),
    base64Decode(record.credential_ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

const LOGIN_STATE_AAD = 'radiotracker:missevan-login:v1';

function base64UrlEncode(bytes) {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return base64Decode(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}

async function sealLoginState(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(LOGIN_STATE_AAD) },
    await credentialKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

async function openLoginState(token, env, userId) {
  const [ivText, encryptedText] = String(token || '').split('.');
  if (!ivText || !encryptedText) throw new Error('登录流程已失效，请重新获取验证码');
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlDecode(ivText),
        additionalData: new TextEncoder().encode(LOGIN_STATE_AAD),
      },
      await credentialKey(env),
      base64UrlDecode(encryptedText),
    );
    const state = JSON.parse(new TextDecoder().decode(decrypted));
    if (!state?.cookie || state.userId !== userId || Number(state.expiresAt) < Date.now()) {
      throw new Error('登录流程已失效，请重新获取验证码');
    }
    return state;
  } catch (error) {
    if (/登录流程已失效/.test(String(error?.message || error))) throw error;
    throw new Error('登录流程已失效，请重新获取验证码');
  }
}

function splitSetCookieHeader(header) {
  if (!header) return [];
  return String(header).split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function mergeCookieJar(cookie, response) {
  const jar = new Map();
  for (const part of String(cookie || '').split(';')) {
    const trimmed = part.trim();
    const index = trimmed.indexOf('=');
    if (index > 0) jar.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : splitSetCookieHeader(response.headers.get('set-cookie'));
  for (const value of values) {
    const pair = String(value).split(';', 1)[0].trim();
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function missevanMessage(payload, fallback) {
  const info = payload?.info;
  if (Array.isArray(info)) {
    const message = info.map(item => item?.message).filter(Boolean).join('；');
    if (message) return message;
  }
  if (typeof info === 'string') return info;
  return info?.message || payload?.message || fallback;
}

async function missevanAuthJson(url, { cookie = '', body } = {}) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Accept: 'application/json',
      Referer: 'https://www.missevan.com/member/login',
      'User-Agent': 'Mozilla/5.0',
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
  const nextCookie = mergeCookieJar(cookie, response);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`猫耳登录接口 HTTP ${response.status}`); }
  if (!response.ok) throw new Error(missevanMessage(payload, `猫耳登录接口 HTTP ${response.status}`));
  return { payload, cookie: nextCookie };
}

function findMissevanUserId(payload, cookie) {
  const match = /(?:^|;\s*)muid=(\d+)/.exec(cookie || '');
  if (match) return match[1];
  const info = payload?.info || {};
  const candidates = [
    info.id, info.user_id, info.userid, info.muid,
    info.user?.id, info.user?.user_id, info.user?.userid, info.user?.muid,
  ];
  const value = candidates.find(item => /^\d+$/.test(String(item || '')));
  return value == null ? null : String(value);
}

async function setCvNames(env, userId, dramaId, names) {
  await run(env, 'DELETE FROM drama_cvs WHERE drama_id = ?', [dramaId]);
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    await run(env, 'INSERT INTO cvs (user_id, name) VALUES (?, ?) ON CONFLICT(user_id, name) DO NOTHING', [userId, name]);
    const cv = await first(env, 'SELECT id FROM cvs WHERE user_id = ? AND name = ?', [userId, name]);
    if (cv) await run(env, "INSERT INTO drama_cvs (drama_id, cv_id, role_type) VALUES (?, ?, '主役') ON CONFLICT DO NOTHING", [dramaId, cv.id]);
  }
}

async function importBundle(env, userId, body) {
  const bundle = body?.bundle;
  if (!bundle?.tables?.drama_catalog || !bundle?.tables?.user_dramas) throw new Error('迁移文件格式不正确');
  if (bundle.export_meta?.credentials_included !== false) throw new Error('迁移文件不能包含登录凭据');
  const existing = await first(env, 'SELECT completed_at FROM migration_state WHERE user_id = ?', [userId]);
  if (existing && !body?.replace) throw new Error('这个账号已经完成过迁移');

  const catalogById = new Map(bundle.tables.drama_catalog.map(row => [row.id, row]));
  const coverByDrama = new Map((bundle.cover_files || []).map(row => [row.drama_id, row.source_path]));
  const legacyToCloud = new Map();
  const cvLegacyToCloud = new Map();

  if (body?.replace) {
    const owned = await all(env, 'SELECT id FROM dramas WHERE user_id = ?', [userId]);
    if (owned.length) await run(env, `DELETE FROM dramas WHERE id IN (${placeholders(owned.length)})`, owned.map(row => row.id));
    await run(env, 'DELETE FROM cvs WHERE user_id = ?', [userId]);
    await run(env, 'DELETE FROM sync_log WHERE user_id = ?', [userId]);
  }

  for (const privateRow of bundle.tables.user_dramas) {
    const catalog = catalogById.get(privateRow.drama_id);
    if (!catalog) continue;
    const result = await run(env, `
      INSERT INTO dramas (
        user_id, missevan_id, title, platform, source, kind, categories, organization, abstract,
        cover_url, cover_local, status, purchased, subscribed, heard_episodes, total_episodes,
        rating, finished_date, rewatch_queued, rewatch_status, review, serialize_status,
        update_info, update_day, price, sync_saw_episode, sync_total_episodes, sync_newest,
        sync_serialize, sync_purchased, sync_subscribed, synced_at, bought_order, sub_order,
        sort_order, detail_error, detail_fetched_at, created_at, updated_at
      ) VALUES (${placeholders(39)})
    `, [
      userId, catalog.missevan_id, catalog.title, catalog.platform, catalog.source, catalog.kind,
      JSON.stringify(catalog.categories || []), catalog.organization, catalog.abstract, catalog.cover_url,
      coverByDrama.get(privateRow.drama_id) || null, privateRow.status, privateRow.purchased ? 1 : 0,
      privateRow.subscribed ? 1 : 0, privateRow.heard_episodes, catalog.total_episodes, privateRow.rating,
      privateRow.finished_date, privateRow.rewatch_queued ? 1 : 0, privateRow.rewatch_status,
      privateRow.review, catalog.serialize_status, catalog.update_info, catalog.update_day, catalog.price,
      privateRow.sync_saw_episode, privateRow.sync_total_episodes, privateRow.sync_newest,
      privateRow.sync_serialize, privateRow.sync_purchased == null ? null : privateRow.sync_purchased ? 1 : 0,
      privateRow.sync_subscribed == null ? null : privateRow.sync_subscribed ? 1 : 0,
      privateRow.synced_at, privateRow.bought_order, privateRow.sub_order, privateRow.sort_order || 0,
      catalog.detail_error, catalog.detail_fetched_at, privateRow.created_at || now(), privateRow.updated_at || now(),
    ]);
    legacyToCloud.set(Number(privateRow.legacy_id), Number(result.meta.last_row_id));
  }

  for (const cv of bundle.tables.catalog_cvs || []) {
    const result = await run(env, `
      INSERT INTO cvs (user_id, name, missevan_id, avatar_url, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET
        missevan_id = COALESCE(cvs.missevan_id, excluded.missevan_id),
        avatar_url = COALESCE(cvs.avatar_url, excluded.avatar_url)
    `, [userId, cv.name, cv.missevan_id, cv.avatar_url, cv.note, cv.created_at || now()]);
    const saved = await first(env, 'SELECT id FROM cvs WHERE user_id = ? AND name = ?', [userId, cv.name]);
    if (saved) cvLegacyToCloud.set(Number(cv.legacy_id), Number(saved.id || result.meta.last_row_id));
  }

  const catalogLegacy = new Map(bundle.tables.drama_catalog.map(row => [row.id, Number(row.legacy_id)]));
  const cvCatalogLegacy = new Map(bundle.tables.catalog_cvs.map(row => [row.id, Number(row.legacy_id)]));
  for (const link of bundle.tables.catalog_drama_cvs || []) {
    const dramaId = legacyToCloud.get(catalogLegacy.get(link.drama_id));
    const cvId = cvLegacyToCloud.get(cvCatalogLegacy.get(link.cv_id));
    if (dramaId && cvId) await run(env, `
      INSERT INTO drama_cvs (drama_id, cv_id, role_type, character)
      VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING
    `, [dramaId, cvId, link.role_type, link.character]);
  }

  for (const log of bundle.tables.sync_logs || []) {
    await run(env, `INSERT INTO sync_log (user_id, ran_at, kind, added, updated, skipped, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      userId, log.ran_at || now(), log.kind, log.added || 0, log.updated || 0,
      log.skipped || 0, JSON.stringify(log.detail || []),
    ]);
  }
  await run(env, `INSERT INTO migration_state (user_id, completed_at, source_checksum)
    VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET completed_at=excluded.completed_at, source_checksum=excluded.source_checksum`,
  [userId, now(), bundle.export_meta?.tables_sha256 || null]);

  return {
    dramas: legacyToCloud.size,
    cvs: cvLegacyToCloud.size,
    links: (bundle.tables.catalog_drama_cvs || []).length,
    covers: (bundle.cover_files || []).length,
  };
}

async function handleDramas(request, env, userId, url) {
  const path = url.pathname;
  const detail = path.match(/^\/api\/dramas\/(\d+)$/);
  const coverUpload = path.match(/^\/api\/dramas\/(\d+)\/cover$/);
  const coverFile = path.match(/^\/api\/dramas\/(\d+)\/cover-file$/);

  if (coverFile && request.method === 'GET') {
    const row = await first(env, 'SELECT cover_local FROM dramas WHERE id = ? AND user_id = ?', [Number(coverFile[1]), userId]);
    if (!row?.cover_local?.startsWith('r2:')) return empty(404);
    const object = await env.COVERS.get(row.cover_local.slice(3));
    if (!object) return empty(404);
    return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
  }

  if (coverUpload && request.method === 'POST') {
    const { dataUrl } = await request.json();
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!match) return json({ error: '需要 png/jpeg/webp 的图片' }, 400);
    const bytes = base64Decode(match[2]);
    if (bytes.length > 8 * 1024 * 1024) return json({ error: '图片太大' }, 413);
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    const key = `${encodeURIComponent(userId)}/${coverUpload[1]}-${Date.now()}.${extension}`;
    await env.COVERS.put(key, bytes, { httpMetadata: { contentType: `image/${match[1]}` } });
    const previous = await first(env, 'SELECT cover_local FROM dramas WHERE id = ? AND user_id = ?', [Number(coverUpload[1]), userId]);
    await run(env, "UPDATE dramas SET cover_local = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?", [`r2:${key}`, Number(coverUpload[1]), userId]);
    if (previous?.cover_local?.startsWith('r2:')) await env.COVERS.delete(previous.cover_local.slice(3));
    const row = await first(env, 'SELECT * FROM dramas WHERE id = ? AND user_id = ?', [Number(coverUpload[1]), userId]);
    return json((await withCvs(env, userId, [row]))[0]);
  }

  if (path === '/api/dramas/reorder' && request.method === 'PATCH') {
    const { ids, offset = 0 } = await request.json();
    if (!Array.isArray(ids) || !ids.length) return json({ error: '没有要排序的剧' }, 400);
    await env.DB.batch(ids.map((id, index) => env.DB.prepare(
      'UPDATE dramas SET sort_order = ? WHERE id = ? AND user_id = ?'
    ).bind(Number(offset) + index, Number(id), userId)));
    return json({ updated: ids.length });
  }

  if (path === '/api/dramas/bulk' && request.method === 'PATCH') {
    const body = await request.json();
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length) return json({ error: '没有选中任何剧' }, 400);
    const sets = [], values = [];
    for (const key of ['status', 'rewatch_queued', 'purchased', 'platform']) {
      if (body[key] === undefined) continue;
      sets.push(`${key} = ?`);
      values.push(typeof body[key] === 'boolean' ? (body[key] ? 1 : 0) : (body[key] || null));
    }
    if (!sets.length) return json({ error: '没有可更新的字段' }, 400);
    sets.push("updated_at = datetime('now')");
    const result = await run(env, `UPDATE dramas SET ${sets.join(', ')} WHERE user_id = ? AND id IN (${placeholders(ids.length)})`, [...values, userId, ...ids.map(Number)]);
    if (body.status === '听完') {
      await run(env, `UPDATE dramas SET heard_episodes = total_episodes, finished_date = COALESCE(finished_date, ?) WHERE user_id = ? AND id IN (${placeholders(ids.length)})`, [todayInChina(), userId, ...ids.map(Number)]);
    }
    return json({ updated: result.meta.changes || ids.length });
  }

  if (detail && request.method === 'GET') {
    const row = await first(env, 'SELECT * FROM dramas WHERE id = ? AND user_id = ?', [Number(detail[1]), userId]);
    if (!row) return json({ error: '没找到这部剧' }, 404);
    return json((await withCvs(env, userId, [row]))[0]);
  }

  if (detail && request.method === 'PATCH') {
    const body = await request.json();
    const sets = [], values = [];
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (Array.isArray(body.categories)) { sets.push('categories = ?'); values.push(JSON.stringify(body.categories)); }
    if (!sets.length && !Array.isArray(body.cvNames)) return json({ error: '没有可更新的字段' }, 400);
    const dramaId = Number(detail[1]);
    if (sets.length) await run(env, `UPDATE dramas SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`, [...values, dramaId, userId]);
    if (Array.isArray(body.cvNames)) await setCvNames(env, userId, dramaId, body.cvNames);
    if (body.status === '听完' && body.finished_date === undefined) {
      await run(env, 'UPDATE dramas SET finished_date = COALESCE(finished_date, ?) WHERE id = ? AND user_id = ?', [todayInChina(), dramaId, userId]);
    }
    await run(env, "UPDATE dramas SET heard_episodes = total_episodes WHERE id = ? AND user_id = ? AND status = '听完' AND total_episodes IS NOT NULL", [dramaId, userId]);
    const row = await first(env, 'SELECT * FROM dramas WHERE id = ? AND user_id = ?', [dramaId, userId]);
    return json((await withCvs(env, userId, [row]))[0]);
  }

  if (detail && request.method === 'DELETE') {
    const row = await first(env, 'SELECT cover_local FROM dramas WHERE id = ? AND user_id = ?', [Number(detail[1]), userId]);
    if (!row) return json({ error: '没找到这部剧' }, 404);
    await run(env, 'DELETE FROM dramas WHERE id = ? AND user_id = ?', [Number(detail[1]), userId]);
    if (row.cover_local?.startsWith('r2:')) await env.COVERS.delete(row.cover_local.slice(3));
    return empty();
  }

  if (path === '/api/dramas' && request.method === 'POST') {
    const body = await request.json();
    if (!body.title?.trim()) return json({ error: '剧名不能为空' }, 400);
    const total = body.total_episodes ?? null;
    const heard = body.status === '听完' && total != null ? total : body.heard_episodes ?? null;
    const result = await run(env, `
      INSERT INTO dramas (user_id, title, platform, source, kind, categories, cover_url, status,
        purchased, heard_episodes, total_episodes, rating, finished_date, rewatch_status, review,
        serialize_status, update_info, update_day, price, organization, missevan_id)
      VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, body.title.trim(), body.platform || '漫播', body.kind || '广播剧', JSON.stringify(body.categories || []),
      body.cover_url || null, body.status || null, body.purchased ? 1 : 0, heard, total, body.rating ?? null,
      body.finished_date || (body.status === '听完' ? todayInChina() : null), body.rewatch_status || null, body.review || null,
      body.serialize_status || null, body.update_info || null, body.update_day || null, body.price ?? null,
      body.organization || null, body.missevan_id ?? null]);
    const dramaId = Number(result.meta.last_row_id);
    await setCvNames(env, userId, dramaId, body.cvNames || []);
    const row = await first(env, 'SELECT * FROM dramas WHERE id = ? AND user_id = ?', [dramaId, userId]);
    return json((await withCvs(env, userId, [row]))[0], 201);
  }

  if (path === '/api/dramas' && request.method === 'GET') {
    const where = ['d.user_id = ?'];
    const params = [userId];
    const add = (condition, value) => { where.push(condition); params.push(value); };
    const q = url.searchParams;
    if (q.get('status')) add('d.status = ?', q.get('status'));
    if (q.get('platform')) add('d.platform = ?', q.get('platform'));
    if (q.get('kind')) add('d.kind = ?', q.get('kind'));
    if (q.get('serialize')) add('d.serialize_status = ?', q.get('serialize'));
    if (q.get('organization')) add('d.organization = ?', q.get('organization'));
    if (q.has('purchased') && q.get('purchased') !== '') add('d.purchased = ?', ['true', '1'].includes(q.get('purchased')) ? 1 : 0);
    if (q.has('subscribed') && q.get('subscribed') !== '') add('d.subscribed = ?', ['true', '1'].includes(q.get('subscribed')) ? 1 : 0);
    if (q.get('q')) add('d.title LIKE ?', `%${q.get('q')}%`);
    if (q.get('year')) add("substr(CAST(d.finished_date AS TEXT), 1, 4) = ?", q.get('year'));
    if (q.get('rating_min')) add('d.rating >= ?', Number(q.get('rating_min')));
    if (q.get('category')) add('EXISTS (SELECT 1 FROM json_each(d.categories) je WHERE je.value = ?)', q.get('category'));
    if (q.get('cv')) add(`d.id IN (SELECT dc.drama_id FROM drama_cvs dc JOIN cvs c ON c.id = dc.cv_id WHERE c.user_id = d.user_id AND c.name = ? AND dc.role_type = '主役')`, q.get('cv'));
    const orders = {
      purchased: 'd.bought_order IS NULL, d.bought_order, d.updated_at DESC, d.title', updated: 'd.updated_at DESC',
      rating: 'd.rating DESC NULLS LAST, d.title', finished: 'd.finished_date DESC NULLS LAST',
      title: 'd.title', custom: 'd.sort_order, d.title',
    };
    const order = orders[q.get('sort') || 'purchased'] || orders.updated;
    const page = Math.max(1, Number(q.get('page')) || 1);
    const pageSize = Math.min(200, Math.max(12, Number(q.get('pageSize')) || 60));
    const clause = `WHERE ${where.join(' AND ')}`;
    const count = await first(env, `SELECT COUNT(*) c FROM dramas d ${clause}`, params);
    const items = await list(env, userId, `SELECT d.* FROM dramas d ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return json({ total: count.c, page, pageSize, pages: Math.max(1, Math.ceil(count.c / pageSize)), items });
  }

  return null;
}

async function bucketResponse(env, userId, url, where, rankColumn) {
  let filter = `user_id = ? AND ${where}`;
  const params = [userId];
  const status = url.searchParams.get('status');
  if (status === '__none__') filter += ' AND status IS NULL';
  else if (status) { filter += ' AND status = ?'; params.push(status); }
  const orders = {
    todo: `status IS NOT NULL, COALESCE(${rankColumn}, 999999), title`,
    newest: `COALESCE(${rankColumn}, 999999), title`,
    oldest: `COALESCE(${rankColumn}, -1) DESC, title`,
    title: 'title', rating: 'rating IS NULL, rating DESC, title',
    episodes: 'total_episodes IS NULL, total_episodes DESC, title',
    custom: `sort_order, COALESCE(${rankColumn}, 999999), title`,
  };
  const order = orders[url.searchParams.get('sort') || 'todo'] || orders.todo;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(12, Number(url.searchParams.get('pageSize')) || 60));
  const count = await first(env, `SELECT COUNT(*) c FROM dramas WHERE ${filter}`, params);
  const items = await list(env, userId, `SELECT * FROM dramas WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return json({ total: count.c, page, pageSize, pages: Math.max(1, Math.ceil(count.c / pageSize)), items });
}

async function handleViews(request, env, userId, url) {
  if (request.method !== 'GET') return null;
  const path = url.pathname;
  if (path === '/api/views/purchased') return bucketResponse(env, userId, url, MISSEVAN_PURCHASED, 'bought_order');
  if (path === '/api/views/collection') return bucketResponse(env, userId, url, MISSEVAN_COLLECTION, 'sub_order');
  if (path === '/api/views/purchased/counts' || path === '/api/views/collection/counts') {
    const where = path.includes('purchased') ? MISSEVAN_PURCHASED : MISSEVAN_COLLECTION;
    return json(await all(env, `SELECT COALESCE(status, '__none__') value, COUNT(*) n FROM dramas WHERE user_id = ? AND ${where} GROUP BY 1`, [userId]));
  }
  if (path === '/api/views/listening') return json(await list(env, userId, "SELECT * FROM dramas WHERE user_id = ? AND status = '在听' ORDER BY update_day, title", [userId]));
  if (path === '/api/views/schedule') {
    const rows = await list(env, userId, `SELECT * FROM dramas WHERE user_id = ? AND status = '在听' AND (update_day IN (${placeholders(WEEKDAYS.length)}) OR update_day = '每日') ORDER BY update_day = '每日' DESC, title`, [userId, ...WEEKDAYS]);
    const byDay = Object.fromEntries(WEEKDAYS.map(day => [day, []]));
    for (const row of rows) {
      if (row.update_day === '每日') WEEKDAYS.forEach(day => byDay[day].push(row));
      else if (byDay[row.update_day]) byDay[row.update_day].push(row);
    }
    return json(byDay);
  }
  const simple = {
    '/api/views/rewatch-queue': "SELECT * FROM dramas WHERE user_id = ? AND rewatch_queued = 1 ORDER BY rating DESC NULLS LAST, title",
    '/api/views/rewatch-library': `SELECT * FROM dramas WHERE user_id = ? AND rewatch_status IS NOT NULL AND rewatch_status <> '' ORDER BY CASE rewatch_status WHEN '已n刷' THEN 0 WHEN '已四刷' THEN 1 WHEN '已三刷' THEN 2 WHEN '已二刷' THEN 3 ELSE 4 END, rating DESC NULLS LAST`,
    '/api/views/stash': "SELECT * FROM dramas WHERE user_id = ? AND status = '囤着' ORDER BY serialize_status = '已完结' DESC, price DESC NULLS LAST, title",
    '/api/views/audiobooks': "SELECT * FROM dramas WHERE user_id = ? AND kind = '听书' AND rating IS NOT NULL ORDER BY rating DESC, title",
  };
  if (simple[path]) return json(await list(env, userId, simple[path], [userId]));
  if (path === '/api/views/recent') {
    const days = Number(url.searchParams.get('days')) || 30;
    return json(await list(env, userId, "SELECT * FROM dramas WHERE user_id = ? AND finished_date IS NOT NULL AND finished_date >= date('now', ?) ORDER BY finished_date DESC", [userId, `-${days} days`]));
  }
  if (path === '/api/views/wishlist') return json({
    已购未听: await list(env, userId, "SELECT * FROM dramas WHERE user_id = ? AND status = '想听' AND purchased = 1 ORDER BY title", [userId]),
    未购观望: await list(env, userId, "SELECT * FROM dramas WHERE user_id = ? AND status = '想听' AND purchased = 0 ORDER BY title", [userId]),
  });
  if (path === '/api/views/recommend') return json({
    五星: await list(env, userId, 'SELECT * FROM dramas WHERE user_id = ? AND rating >= 5 ORDER BY title', [userId]),
    优质: await list(env, userId, 'SELECT * FROM dramas WHERE user_id = ? AND rating >= 4.8 AND rating < 5 ORDER BY rating DESC, title', [userId]),
  });
  if (path === '/api/views/untriaged') {
    const shelved = url.searchParams.get('kind') === 'shelved';
    return json(await list(env, userId, shelved
      ? "SELECT * FROM dramas WHERE user_id = ? AND status = '搁置' ORDER BY purchased DESC, title"
      : "SELECT * FROM dramas WHERE user_id = ? AND status IS NULL AND source = 'missevan' ORDER BY purchased DESC, updated_at DESC", [userId]));
  }
  return null;
}

async function handleReports(request, env, userId, url) {
  if (request.method !== 'GET') return null;
  const path = url.pathname;
  if (path === '/api/facets') {
    return json({
      status: await all(env, 'SELECT status value, COUNT(*) n FROM dramas WHERE user_id = ? AND status IS NOT NULL GROUP BY 1 ORDER BY n DESC', [userId]),
      platform: await all(env, 'SELECT platform value, COUNT(*) n FROM dramas WHERE user_id = ? GROUP BY 1 ORDER BY n DESC', [userId]),
      kind: await all(env, "SELECT kind value, COUNT(*) n FROM dramas WHERE user_id = ? AND kind IS NOT NULL AND kind <> '' GROUP BY 1 ORDER BY n DESC", [userId]),
      purchased: await all(env, "SELECT CASE WHEN purchased = 1 THEN 'true' ELSE 'false' END value, COUNT(*) n FROM dramas WHERE user_id = ? GROUP BY purchased ORDER BY purchased DESC", [userId]),
      serialize: await all(env, 'SELECT serialize_status value, COUNT(*) n FROM dramas WHERE user_id = ? AND serialize_status IS NOT NULL GROUP BY 1 ORDER BY n DESC', [userId]),
      category: await all(env, 'SELECT je.value value, COUNT(*) n FROM dramas d, json_each(d.categories) je WHERE d.user_id = ? GROUP BY 1 ORDER BY n DESC, value', [userId]),
      organization: await all(env, 'SELECT organization value, COUNT(*) n FROM dramas WHERE user_id = ? AND organization IS NOT NULL GROUP BY 1 ORDER BY n DESC', [userId]),
      cv: await all(env, `SELECT c.name value, COUNT(*) n FROM drama_cvs dc JOIN cvs c ON c.id = dc.cv_id JOIN dramas d ON d.id = dc.drama_id WHERE d.user_id = ? AND dc.role_type = '主役' GROUP BY 1 ORDER BY n DESC LIMIT 60`, [userId]),
      year: await all(env, 'SELECT substr(CAST(finished_date AS TEXT), 1, 4) value, COUNT(*) n FROM dramas WHERE user_id = ? AND finished_date IS NOT NULL GROUP BY 1 ORDER BY value DESC', [userId]),
      rating: await all(env, 'SELECT CAST(rating AS TEXT) value, COUNT(*) n FROM dramas WHERE user_id = ? AND rating IS NOT NULL GROUP BY 1 ORDER BY rating DESC', [userId]),
    });
  }
  if (path === '/api/cvs') {
    const min = Number(url.searchParams.get('min')) || 0;
    const role = url.searchParams.get('role') === 'all' ? '' : "AND dc.role_type = '主役'";
    return json(await all(env, `SELECT c.id, c.name, c.avatar_url, c.missevan_id, COUNT(dc.drama_id) drama_count, ROUND(CAST(AVG(d.rating) AS NUMERIC), 2) avg_rating FROM cvs c JOIN drama_cvs dc ON dc.cv_id = c.id JOIN dramas d ON d.id = dc.drama_id WHERE d.user_id = ? AND d.status = '听完' ${role} GROUP BY c.id HAVING COUNT(dc.drama_id) >= ? ORDER BY drama_count DESC, avg_rating DESC`, [userId, min]));
  }
  const cvDramas = path.match(/^\/api\/cvs\/(.+)\/dramas$/);
  if (cvDramas) {
    const role = url.searchParams.get('role') === 'all' ? '' : "AND dc.role_type = '主役'";
    return json(await list(env, userId, `SELECT d.* FROM dramas d JOIN drama_cvs dc ON dc.drama_id = d.id JOIN cvs c ON c.id = dc.cv_id WHERE d.user_id = ? AND c.name = ? AND d.status = '听完' ${role} ORDER BY d.rating DESC NULLS LAST, d.title`, [userId, decodeURIComponent(cvDramas[1])]));
  }
  if (path === '/api/years') return json(await all(env, `SELECT substr(CAST(finished_date AS TEXT), 1, 4) AS "year", COUNT(*) count, ROUND(CAST(AVG(rating) AS NUMERIC), 2) avg_rating FROM dramas WHERE user_id = ? AND finished_date IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`, [userId]));
  const yearStats = path.match(/^\/api\/years\/(\d{4})\/stats$/);
  if (yearStats) {
    const year = yearStats[1];
    const yearFilter = 'substr(CAST(finished_date AS TEXT),1,4) = ?';
    const monthRows = await all(env, `SELECT CAST(substr(CAST(finished_date AS TEXT), 6, 2) AS INTEGER) m, COUNT(*) n FROM dramas WHERE user_id = ? AND ${yearFilter} GROUP BY 1`, [userId, year]);
    const metric = async sql => (await first(env, sql, [userId, year]))?.c ?? 0;
    return json({
      year,
      total: await metric(`SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND ${yearFilter}`),
      avgRating: await metric(`SELECT ROUND(CAST(AVG(rating) AS NUMERIC), 2) c FROM dramas WHERE user_id = ? AND ${yearFilter} AND rating IS NOT NULL`),
      episodes: await metric(`SELECT COALESCE(SUM(total_episodes), 0) c FROM dramas WHERE user_id = ? AND ${yearFilter}`),
      reviews: await metric(`SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND ${yearFilter} AND review IS NOT NULL`),
      byMonth: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, n: monthRows.find(row => Number(row.m) === index + 1)?.n || 0 })),
      byRating: await all(env, `SELECT CAST(rating AS TEXT) label, COUNT(*) n FROM dramas WHERE user_id = ? AND ${yearFilter} AND rating IS NOT NULL GROUP BY rating ORDER BY rating DESC`, [userId, year]),
      byCategory: await all(env, 'SELECT je.value label, COUNT(*) n FROM dramas d, json_each(d.categories) je WHERE d.user_id = ? AND substr(CAST(d.finished_date AS TEXT),1,4) = ? GROUP BY 1 ORDER BY n DESC LIMIT 10', [userId, year]),
      topCvs: await all(env, "SELECT c.name label, COUNT(*) n FROM dramas d JOIN drama_cvs dc ON dc.drama_id = d.id AND dc.role_type = '主役' JOIN cvs c ON c.id = dc.cv_id WHERE d.user_id = ? AND substr(CAST(d.finished_date AS TEXT),1,4) = ? GROUP BY 1 ORDER BY n DESC LIMIT 10", [userId, year]),
      topRated: await all(env, `SELECT title label, rating n FROM dramas WHERE user_id = ? AND ${yearFilter} AND rating IS NOT NULL ORDER BY rating DESC, title LIMIT 8`, [userId, year]),
    });
  }
  const yearList = path.match(/^\/api\/years\/(\d{4})$/);
  if (yearList) return json(await list(env, userId, 'SELECT * FROM dramas WHERE user_id = ? AND substr(CAST(finished_date AS TEXT),1,4) = ? ORDER BY finished_date DESC', [userId, yearList[1]]));
  if (path === '/api/stats') {
    const metric = async sql => (await first(env, sql, [userId]))?.c ?? 0;
    return json({
      total: await metric('SELECT COUNT(*) c FROM dramas WHERE user_id = ?'),
      byStatus: await all(env, 'SELECT status, COUNT(*) c FROM dramas WHERE user_id = ? GROUP BY status', [userId]),
      byPlatform: await all(env, 'SELECT platform, COUNT(*) c FROM dramas WHERE user_id = ? GROUP BY platform', [userId]),
      byKind: await all(env, 'SELECT kind, COUNT(*) c FROM dramas WHERE user_id = ? GROUP BY kind', [userId]),
      purchased: await metric(`SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND ${MISSEVAN_PURCHASED}`),
      subscribed: await metric("SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND platform = '猫耳' AND subscribed = 1"),
      reviews: await metric('SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND review IS NOT NULL'),
      purchasedTodo: await metric(`SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND ${MISSEVAN_PURCHASED} AND status IS NULL`),
      collectionTodo: await metric(`SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND ${MISSEVAN_COLLECTION} AND status IS NULL`),
      listening: await metric("SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND status = '在听'"),
      rewatchQueue: await metric('SELECT COUNT(*) c FROM dramas WHERE user_id = ? AND rewatch_queued = 1'),
      lastSync: await first(env, 'SELECT ran_at, kind FROM sync_log WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]),
    });
  }
  if (path === '/api/sync-log') {
    const rows = await all(env, 'SELECT * FROM sync_log WHERE user_id = ? ORDER BY id DESC LIMIT 20', [userId]);
    return json(rows.map(row => { try { return { ...row, detail: JSON.parse(row.detail || '[]') }; } catch { return { ...row, detail: [] }; } }));
  }
  return null;
}

async function saveJob(env, userId, values) {
  const current = await first(env, 'SELECT * FROM sync_jobs WHERE user_id = ?', [userId]);
  const next = {
    running: values.running ?? current?.running ?? 0,
    step: values.step ?? current?.step ?? null,
    log: values.log ?? current?.log ?? '[]',
    error: values.error === undefined ? current?.error ?? null : values.error,
    expired: values.expired ?? current?.expired ?? 0,
    started_at: values.started_at ?? current?.started_at ?? null,
    finished_at: values.finished_at === undefined ? current?.finished_at ?? null : values.finished_at,
  };
  await run(env, `INSERT INTO sync_jobs (user_id, running, step, log, error, expired, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
    running=excluded.running, step=excluded.step, log=excluded.log, error=excluded.error,
    expired=excluded.expired, started_at=excluded.started_at, finished_at=excluded.finished_at`,
  [userId, next.running, next.step, next.log, next.error, next.expired, next.started_at, next.finished_at]);
}

async function appendJob(env, userId, step, message) {
  const current = await first(env, 'SELECT log FROM sync_jobs WHERE user_id = ?', [userId]);
  let lines = [];
  try { lines = JSON.parse(current?.log || '[]'); } catch { lines = []; }
  lines.push(message);
  if (lines.length > 400) lines = lines.slice(-400);
  await saveJob(env, userId, { step, log: JSON.stringify(lines) });
}

async function missevanJson(url, cookie) {
  const response = await fetch(url, { headers: {
    Cookie: cookie,
    Referer: 'https://www.missevan.com/',
    'User-Agent': 'Mozilla/5.0',
  } });
  if (!response.ok) throw new Error(`猫耳接口 HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error('猫耳登录态已失效'); }
}

async function fetchMissevanLists(cookie, missevanUserId) {
  const bought = [];
  const subscriptions = [];
  let page = 1, maxPage = 1;
  do {
    const payload = await missevanJson(`https://www.missevan.com/mperson/getdramabought?page=${page}&page_size=100`, cookie);
    if (!Array.isArray(payload?.info?.data)) throw new Error('猫耳已购列表结构异常');
    bought.push(...payload.info.data);
    maxPage = Number(payload.info.pagination?.maxpage || 1);
    page++;
  } while (page <= maxPage);
  page = 1; maxPage = 1;
  do {
    const payload = await missevanJson(`https://www.missevan.com/dramaapi/getusersubscriptions?user_id=${encodeURIComponent(missevanUserId)}&page_size=20&page=${page}`, cookie);
    if (!Array.isArray(payload?.info?.Datas)) throw new Error('猫耳追剧列表结构异常');
    subscriptions.push(...payload.info.Datas);
    maxPage = Number(payload.info.pagination?.maxpage || 1);
    page++;
  } while (page <= maxPage);
  if (!bought.length && !subscriptions.length) throw new Error('猫耳登录态已失效');
  return { bought, subscriptions, listsComplete: true };
}

const normalizeTitle = value => String(value || '').replace(/[\s·・:：!！?？,，。.\-—_「」『』《》()（）【】\[\]]/g, '').toLowerCase();

async function mergeLists(env, userId, payload) {
  const boughtList = payload.boughtIds || (payload.bought || []).map(row => String(row.id));
  const subList = payload.subscriptionIds || (payload.subscriptions || []).map(row => String(row.id));
  const boughtIds = new Set(boughtList.map(String));
  const subIds = new Set(subList.map(String));
  const boughtOrder = new Map(boughtList.map((id, index) => [String(id), index]));
  const subOrder = new Map(subList.map((id, index) => [String(id), index]));
  const metadata = new Map();
  for (const item of [...(payload.subscriptions || []), ...(payload.bought || [])]) metadata.set(String(item.id), item);
  const existing = await all(env, 'SELECT * FROM dramas WHERE user_id = ?', [userId]);
  const byId = new Map(existing.filter(row => row.missevan_id).map(row => [String(row.missevan_id), row]));
  const byTitle = new Map(existing.filter(row => row.platform === '猫耳').map(row => [normalizeTitle(row.title), row]));
  const notices = [];
  let added = 0, updated = 0, removed = 0;

  for (const id of new Set([...boughtIds, ...subIds])) {
    const meta = metadata.get(id) || {};
    const purchased = boughtIds.has(id) ? 1 : 0;
    const subscribed = subIds.has(id) ? 1 : 0;
    const row = byId.get(id) || byTitle.get(normalizeTitle(meta.name));
    if (!row) {
      if (!meta.name) continue;
      await run(env, `INSERT INTO dramas (user_id, missevan_id, title, platform, source, purchased, subscribed,
        bought_order, sub_order, cover_url, abstract, sync_purchased, sync_subscribed, synced_at)
        VALUES (?, ?, ?, '猫耳', 'missevan', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [userId, Number(id), meta.name, purchased, subscribed, boughtOrder.get(id) ?? null,
        subOrder.get(id) ?? null, meta.cover || null, meta.abstract || null, purchased, subscribed]);
      added++;
      continue;
    }
    if (row.platform !== '猫耳') continue;
    await run(env, `UPDATE dramas SET purchased = CASE WHEN purchased = 1 THEN 1 ELSE ? END,
      subscribed = ?, bought_order = ?, sub_order = ?, missevan_id = COALESCE(missevan_id, ?),
      cover_url = COALESCE(cover_url, ?), abstract = COALESCE(abstract, ?), sync_purchased = ?,
      sync_subscribed = ?, synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
    [purchased, subscribed, boughtOrder.get(id) ?? null, subOrder.get(id) ?? null, Number(id),
      meta.cover || null, meta.abstract || null, purchased, subscribed, row.id, userId]);
    updated++;
  }

  if (payload.listsComplete === true || (Array.isArray(payload.bought) && Array.isArray(payload.subscriptions))) {
    for (const row of existing) {
      if (row.platform !== '猫耳' || !row.missevan_id) continue;
      const id = String(row.missevan_id);
      const nextSubscribed = subIds.has(id) ? 1 : 0;
      if (row.subscribed && !nextSubscribed) {
        removed++;
        notices.push({ title: row.title, change: '猫耳上已取消追剧 → 移出收藏' });
      }
      await run(env, `UPDATE dramas SET subscribed=?, sub_order=?, bought_order=?, sync_purchased=?,
        sync_subscribed=?, synced_at=datetime('now') WHERE id=? AND user_id=?`, [
        nextSubscribed, subOrder.get(id) ?? null, boughtOrder.get(id) ?? null,
        boughtIds.has(id) ? 1 : 0, nextSubscribed, row.id, userId,
      ]);
    }
  }
  notices.unshift({ title: '猫耳列表变化', change: `已购 ${boughtIds.size} · 追剧 ${subIds.size}` });
  await run(env, `INSERT INTO sync_log (user_id, kind, added, updated, skipped, detail)
    VALUES (?, 'missevan', ?, ?, 0, ?)`, [userId, added, updated, JSON.stringify(notices)]);
  return { added, updated, removed, bought: boughtIds.size, subscriptions: subIds.size };
}

function parseUpdateDay(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/更新|播出/.test(text)) return null;
  const week = /每\s*[周週]\s*([一二三四五六日天])/.exec(text);
  if (week) return ({ 一: '周一', 二: '周二', 三: '周三', 四: '周四', 五: '周五', 六: '周六', 日: '周日', 天: '周日' })[week[1]];
  return /每\s*[日天]/.test(text) ? '每日' : null;
}

async function fetchDetails(env, userId) {
  const targets = await all(env, `SELECT id, missevan_id, title, total_episodes, sync_total_episodes
    FROM dramas d WHERE user_id = ? AND missevan_id IS NOT NULL AND detail_error IS NULL AND (
      NOT EXISTS (SELECT 1 FROM drama_cvs WHERE drama_id = d.id) OR sync_total_episodes IS NULL
      OR status = '在听' OR (serialize_status = '连载中' AND (purchased = 1 OR subscribed = 1))
    ) LIMIT 40`, [userId]);
  let refreshed = 0;
  for (const target of targets) {
    try {
      const response = await fetch(`https://www.missevan.com/dramaapi/getdrama?drama_id=${target.missevan_id}`, {
        headers: { Referer: 'https://www.missevan.com/', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const info = (await response.json()).info;
      const drama = info?.drama || {};
      const episodeNames = (info?.episodes?.episode || []).map(item => item.name).filter(Boolean);
      const episodeTotal = resolveEpisodeTotal({ abstract: drama.abstract, newest: drama.newest, episodeNames });
      const serialize = String(drama.integrity) === '1' ? '已完结' : String(drama.integrity) === '2' ? '连载中' : null;
      await run(env, `UPDATE dramas SET
        kind=COALESCE(kind, ?), categories=CASE WHEN categories IS NULL OR categories='[]' THEN ? ELSE categories END,
        organization=COALESCE(organization, ?), abstract=COALESCE(abstract, ?), cover_url=COALESCE(cover_url, ?),
        total_episodes=CASE WHEN sync_total_episodes IS NULL OR total_episodes IS NULL OR total_episodes=sync_total_episodes THEN COALESCE(?, total_episodes) ELSE total_episodes END,
        serialize_status=COALESCE(?, serialize_status), update_info=COALESCE(?, update_info),
        price=COALESCE(price, ?), update_day=COALESCE(update_day, ?), sync_total_episodes=?,
        sync_newest=?, sync_serialize=?, synced_at=datetime('now'), detail_error=NULL,
        detail_fetched_at=datetime('now') WHERE id=? AND user_id=?`, [
        drama.type === 2 ? '听书' : '广播剧', JSON.stringify([drama.catalog_name, ...(Array.isArray(drama.tags) ? drama.tags.map(item => item.name || item) : [])].filter(Boolean)),
        drama.organization?.name || null, drama.abstract || null, drama.cover || null, episodeTotal.total,
        serialize, drama.newest || null, drama.price ?? null, parseUpdateDay(drama.abstract), episodeTotal.total,
        drama.newest || null, serialize, target.id, userId,
      ]);
      await run(env, "UPDATE dramas SET heard_episodes=total_episodes WHERE id=? AND user_id=? AND status='听完' AND total_episodes IS NOT NULL", [target.id, userId]);
      const main = await first(env, "SELECT COUNT(*) c FROM drama_cvs WHERE drama_id=? AND role_type='主役'", [target.id]);
      for (const [index, item] of (info?.cvs || []).entries()) {
        const name = item.cv_info?.name;
        if (!name) continue;
        await run(env, `INSERT INTO cvs (user_id, name, missevan_id, avatar_url) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, name) DO UPDATE SET missevan_id=COALESCE(cvs.missevan_id, excluded.missevan_id), avatar_url=COALESCE(cvs.avatar_url, excluded.avatar_url)`,
        [userId, name, item.cv_info?.id || null, item.cv_info?.icon || null]);
        const cv = await first(env, 'SELECT id FROM cvs WHERE user_id=? AND name=?', [userId, name]);
        const role = Number(main?.c || 0) > 0 ? '配役' : index < 2 ? '主役' : '配役';
        await run(env, 'INSERT INTO drama_cvs (drama_id, cv_id, role_type, character) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [target.id, cv.id, role, item.character || null]);
      }
      refreshed++;
    } catch (error) {
      await run(env, 'UPDATE dramas SET detail_error=? WHERE id=? AND user_id=?', [String(error.message || error), target.id, userId]);
    }
  }
  return { refreshed, remainingMayExist: targets.length === 40 };
}

async function syncUser(env, userId, suppliedLists = null) {
  try {
    await appendJob(env, userId, '拉取已购 / 追剧', '── 拉取已购 / 追剧 ──');
    let lists = suppliedLists;
    if (!lists) {
      const credential = await first(env, 'SELECT * FROM user_missevan_credentials WHERE user_id = ?', [userId]);
      if (!credential) throw new Error('请先保存猫耳登录凭据');
      lists = await fetchMissevanLists(await decryptCookie(credential, env), credential.missevan_user_id);
    }
    await appendJob(env, userId, '合并已购 / 追剧', `已购 ${lists.bought?.length || lists.boughtIds?.length || 0} · 追剧 ${lists.subscriptions?.length || lists.subscriptionIds?.length || 0}`);
    const merged = await mergeLists(env, userId, lists);
    await appendJob(env, userId, '补剧集详情', `新增 ${merged.added} · 更新 ${merged.updated} · 移出收藏 ${merged.removed}`);
    const details = await fetchDetails(env, userId);
    await appendJob(env, userId, '完成', `详情刷新 ${details.refreshed} 部${details.remainingMayExist ? '，下次同步继续补齐' : ''}`);
    await saveJob(env, userId, { running: 0, step: '完成', error: null, expired: 0, finished_at: now() });
  } catch (error) {
    const message = String(error.message || error);
    await appendJob(env, userId, '失败', message);
    await saveJob(env, userId, { running: 0, step: '失败', error: message, expired: /失效|登录态/.test(message) ? 1 : 0, finished_at: now() });
  }
}

async function handleMissevanLogin(request, env, userId, path) {
  const prefix = '/api/sync/missevan-login/';
  if (!path.startsWith(prefix) || request.method !== 'POST') return null;

  if (path === `${prefix}challenge`) {
    try {
      const result = await missevanAuthJson('https://www.missevan.com/x/captcha/challenge?scene=login');
      const params = result.payload?.info?.params;
      if (result.payload?.code !== 0 || result.payload?.info?.type !== 'geetest' || !params?.gt || !params?.challenge) {
        throw new Error(missevanMessage(result.payload, '暂时无法打开猫耳滑块验证'));
      }
      return json({
        gt: params.gt,
        challenge: params.challenge,
        offline: Boolean(params.offline),
        loginState: await sealLoginState({ userId, cookie: result.cookie, expiresAt: Date.now() + 10 * 60 * 1000 }, env),
      });
    } catch (error) {
      return json({ error: String(error.message || error) }, 400);
    }
  }

  const body = await request.json().catch(() => ({}));
  const phone = String(body.phone || '').replace(/\s+/g, '');
  if (!/^\d{6,20}$/.test(phone)) return json({ error: '请输入正确的手机号' }, 400);

  let state;
  try { state = await openLoginState(body.loginState, env, userId); }
  catch (error) { return json({ error: String(error.message || error) }, 400); }

  if (path === `${prefix}send-code`) {
    const captchaToken = String(body.captchaToken || '').trim();
    if (!captchaToken) return json({ error: '请先完成滑块验证' }, 400);
    try {
      const result = await missevanAuthJson('https://www.missevan.com/account/sendcode', {
        cookie: state.cookie,
        body: { login_name: phone, post_type: '16', region: 'CN', captcha_token: captchaToken },
      });
      if (result.payload?.success !== true && result.payload?.code !== 0) {
        throw new Error(missevanMessage(result.payload, '验证码发送失败'));
      }
      return json({
        ok: true,
        loginState: await sealLoginState({ userId, cookie: result.cookie, expiresAt: Date.now() + 10 * 60 * 1000 }, env),
      });
    } catch (error) {
      return json({ error: String(error.message || error) }, 400);
    }
  }

  if (path === `${prefix}verify-code`) {
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return json({ error: '请输入 6 位短信验证码' }, 400);
    try {
      const signedIn = await missevanAuthJson('https://www.missevan.com/account/smslogin', {
        cookie: state.cookie,
        body: { mobile: phone, identify_code: code, remember_me: '1', region: 'CN' },
      });
      if (signedIn.payload?.success !== true && signedIn.payload?.code !== 0) {
        throw new Error(missevanMessage(signedIn.payload, '验证码不正确或已过期'));
      }

      const account = await missevanAuthJson('https://www.missevan.com/account/userinfo', {
        cookie: signedIn.cookie,
      });
      if (account.payload?.success !== true || Number(account.payload?.code || 0) === 100010006) {
        throw new Error(missevanMessage(account.payload, '猫耳登录没有成功，请重试'));
      }
      const missevanUserId = findMissevanUserId(account.payload, account.cookie);
      if (!missevanUserId) throw new Error('已登录，但没有读取到猫耳用户 ID');

      const probe = await missevanJson('https://www.missevan.com/mperson/getdramabought?page=1&page_size=1', account.cookie);
      if (typeof probe?.info?.pagination?.count !== 'number') throw new Error('猫耳登录没有成功，请重试');
      const encrypted = await encryptCookie(account.cookie, env);
      await run(env, `INSERT INTO user_missevan_credentials (user_id, missevan_user_id, credential_ciphertext, credential_iv, saved_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET missevan_user_id=excluded.missevan_user_id,
        credential_ciphertext=excluded.credential_ciphertext, credential_iv=excluded.credential_iv, saved_at=excluded.saved_at`,
      [userId, missevanUserId, encrypted.ciphertext, encrypted.iv, now()]);
      return json({ ok: true, userId: missevanUserId, bought: probe.info.pagination.count });
    } catch (error) {
      return json({ error: String(error.message || error) }, 400);
    }
  }

  return json({ error: '接口不存在' }, 404);
}

async function handleSync(request, env, ctx, userId, url) {
  const path = url.pathname;
  const loginResponse = await handleMissevanLogin(request, env, userId, path);
  if (loginResponse) return loginResponse;
  if (path === '/api/sync/session' && request.method === 'GET') {
    const record = await first(env, 'SELECT missevan_user_id, saved_at FROM user_missevan_credentials WHERE user_id = ?', [userId]);
    return json({ hasSession: Boolean(record), userId: record?.missevan_user_id || null, savedAt: record?.saved_at || null });
  }
  if (path === '/api/sync/session' && request.method === 'DELETE') {
    await run(env, 'DELETE FROM user_missevan_credentials WHERE user_id = ?', [userId]);
    return empty();
  }
  if (path === '/api/sync/session' && request.method === 'POST') {
    const body = await request.json();
    const cookie = String(body.cookie || '').trim();
    if (!cookie) return json({ error: 'cookie 是空的' }, 400);
    const match = /(?:^|;\s*)muid=(\d+)/.exec(cookie);
    const missevanUserId = match?.[1] || String(body.userId || '').trim();
    if (!missevanUserId) return json({ error: 'cookie 里没有 muid，请填写猫耳用户 ID' }, 400);
    try {
      const probe = await missevanJson('https://www.missevan.com/mperson/getdramabought?page=1&page_size=1', cookie);
      if (typeof probe?.info?.pagination?.count !== 'number') throw new Error('登录态无效');
      const encrypted = await encryptCookie(cookie, env);
      await run(env, `INSERT INTO user_missevan_credentials (user_id, missevan_user_id, credential_ciphertext, credential_iv, saved_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET missevan_user_id=excluded.missevan_user_id,
        credential_ciphertext=excluded.credential_ciphertext, credential_iv=excluded.credential_iv, saved_at=excluded.saved_at`,
      [userId, missevanUserId, encrypted.ciphertext, encrypted.iv, now()]);
      return json({ ok: true, userId: missevanUserId, bought: probe.info.pagination.count });
    } catch (error) {
      return json({ error: `这段 cookie 用不了：${String(error.message || error)}` }, 400);
    }
  }
  if (path === '/api/sync/status' && request.method === 'GET') {
    const job = await first(env, 'SELECT * FROM sync_jobs WHERE user_id = ?', [userId]);
    if (!job) return json({ running: false, step: null, log: [], error: null, expired: false, finishedAt: null });
    let log = [];
    try { log = JSON.parse(job.log || '[]'); } catch { log = []; }
    return json({ running: Boolean(job.running), step: job.step, log, error: job.error, expired: Boolean(job.expired), startedAt: job.started_at, finishedAt: job.finished_at });
  }
  if (path === '/api/sync' && request.method === 'POST') {
    const current = await first(env, 'SELECT running FROM sync_jobs WHERE user_id = ?', [userId]);
    if (current?.running) return json({ error: '已经有一个同步在跑了' }, 409);
    const body = await request.json().catch(() => ({}));
    if (!body.lists) {
      const credential = await first(env, 'SELECT user_id FROM user_missevan_credentials WHERE user_id = ?', [userId]);
      if (!credential) return json({ error: '请先保存猫耳登录凭据，再运行自动更新' }, 400);
    }
    await saveJob(env, userId, { running: 1, step: '准备', log: '[]', error: null, expired: 0, started_at: now(), finished_at: null });
    ctx.waitUntil(syncUser(env, userId, body.lists || null));
    return json({ started: true }, 202);
  }
  return null;
}

async function handleCoverProxy(env, url) {
  const raw = url.searchParams.get('u');
  if (!raw) return empty(400);
  let target;
  try { target = new URL(raw); } catch { return empty(400); }
  if (target.protocol !== 'https:' || !ALLOWED_COVER_HOST.test(target.hostname)) return empty(403);
  const cachedKey = `remote/${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)).then(buffer => Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join(''))}`;
  const cached = await env.COVERS.get(cachedKey);
  if (cached) return new Response(cached.body, { headers: { 'content-type': cached.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  const response = await fetch(target.toString(), { headers: { Referer: 'https://www.missevan.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) return empty(response.status);
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  await env.COVERS.put(cachedKey, bytes, { httpMetadata: { contentType } });
  return new Response(bytes, { headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' } });
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, storage: 'd1', mode: String(env.PRIVATE_OWNER_MODE) === 'true' ? 'private-owner' : 'multi-user' });
      if (url.pathname === '/api/cover' && request.method === 'GET') return handleCoverProxy(env, url);
      if (url.pathname.startsWith('/api/')) {
        const userId = await currentUser(request, env);
        if (!userId) return json({ error: '请先登录' }, 401);
        if (url.pathname === '/api/admin/import' && request.method === 'POST') {
          try { return json(await importBundle(env, userId, await request.json()), 201); }
          catch (error) { return json({ error: String(error.message || error) }, 400); }
        }
        const handlers = [handleDramas, handleViews, handleReports];
        for (const handler of handlers) {
          const response = await handler(request, env, userId, url);
          if (response) return response;
        }
        const syncResponse = await handleSync(request, env, ctx, userId, url);
        if (syncResponse) return syncResponse;
        return json({ error: '接口不存在' }, 404);
      }
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404 || url.pathname.includes('.')) return asset;
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    } catch (error) {
      console.error('RadioTracker worker error', error);
      return json({ error: '服务暂时不可用', detail: String(error.message || error) }, 500);
    }
  },
};

export default worker;
