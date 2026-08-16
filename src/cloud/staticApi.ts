import type { SupabaseClient, User } from '@supabase/supabase-js';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const EDITABLE = new Set([
  'title', 'platform', 'kind', 'status', 'purchased', 'subscribed',
  'heard_episodes', 'total_episodes', 'rating', 'finished_date',
  'rewatch_status', 'rewatch_queued', 'review', 'serialize_status', 'update_info',
  'update_day', 'price', 'organization', 'abstract', 'cover_url', 'missevan_id',
]);

type Row = Record<string, any>;
type Bundle = {
  user: User;
  dramas: Row[];
  cvs: Row[];
  links: Row[];
  syncLog: Row[];
  syncJobs: Row[];
};

let bundlePromise: Promise<Bundle> | null = null;
const coverHashes = new Map<string, Promise<string>>();

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const empty = (status = 204) => new Response(null, { status });
const todayInChina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

function invalidate() {
  bundlePromise = null;
}

export function refreshStaticData() {
  invalidate();
}

async function rows(client: SupabaseClient, table: string) {
  const output: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    output.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return output;
}

async function loadBundle(client: SupabaseClient): Promise<Bundle> {
  if (!bundlePromise) bundlePromise = (async () => {
    const { data: auth, error } = await client.auth.getUser();
    if (error || !auth.user) throw error || new Error('请先登录');
    const [dramas, cvs, links, syncLog, syncJobs] = await Promise.all([
      rows(client, 'dramas'), rows(client, 'cvs'), rows(client, 'drama_cvs'),
      rows(client, 'sync_log'), rows(client, 'sync_jobs'),
    ]);
    return { user: auth.user, dramas, cvs, links, syncLog, syncJobs };
  })().catch(error => { bundlePromise = null; throw error; });
  return bundlePromise;
}

async function sha256(value: string) {
  let pending = coverHashes.get(value);
  if (!pending) {
    pending = crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
      .then(buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''));
    coverHashes.set(value, pending);
  }
  return pending;
}

async function coverUrl(client: SupabaseClient, row: Row) {
  let key: string | null = null;
  if (row.cover_local?.startsWith('r2:')) key = row.cover_local.slice(3);
  else if (row.cover_url) key = `remote/${await sha256(row.cover_url)}`;
  if (!key) return row.cover_url || null;
  return client.storage.from('drama-covers').getPublicUrl(key).data.publicUrl;
}

async function shape(client: SupabaseClient, bundle: Bundle, row: Row): Promise<Row> {
  let categories: string[] = [];
  try { categories = Array.isArray(row.categories) ? row.categories : JSON.parse(row.categories || '[]'); } catch { categories = []; }
  const cvById = new Map(bundle.cvs.map(cv => [Number(cv.id), cv]));
  const cvs: Row[] = [];
  for (const link of bundle.links.filter(item => Number(item.drama_id) === Number(row.id))) {
    const cv = cvById.get(Number(link.cv_id));
    if (cv) cvs.push({ ...cv, character: link.character, role_type: link.role_type });
  }
  cvs.sort((a, b) => Number(b.role_type === '主役') - Number(a.role_type === '主役') || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  return {
    ...row,
    finished_date: row.finished_date == null ? null : String(row.finished_date).slice(0, 10),
    categories,
    purchased: Boolean(row.purchased),
    subscribed: Boolean(row.subscribed),
    rewatch_queued: Boolean(row.rewatch_queued),
    cover: await coverUrl(client, row),
    sawHint: row.sync_saw_episode || null,
    cvs,
  };
}

async function shaped(client: SupabaseClient, bundle: Bundle, source: Row[]) {
  return Promise.all(source.map(row => shape(client, bundle, row)));
}

const valueCmp = (a: any, b: any) => String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN');
const descNum = (a: any, b: any) => (b == null ? -Infinity : Number(b)) - (a == null ? -Infinity : Number(a));
const group = (source: Row[], pick: (row: Row) => any, key = 'value') => {
  const counts = new Map<string, number>();
  source.forEach(row => {
    const value = pick(row);
    if (value == null || value === '') return;
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  });
  return Array.from(counts, ([value, n]) => ({ [key]: value, n }));
};
const avg = (values: any[]) => {
  const nums = values.filter(value => value != null).map(Number);
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 100) / 100 : null;
};

function page(source: Row[], url: URL) {
  const current = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(12, Number(url.searchParams.get('pageSize')) || 60));
  return {
    total: source.length, page: current, pageSize,
    pages: Math.max(1, Math.ceil(source.length / pageSize)),
    items: source.slice((current - 1) * pageSize, current * pageSize),
  };
}

function sortBucket(source: Row[], sort: string, rank: 'bought_order' | 'sub_order') {
  return [...source].sort((a, b) => {
    if (sort === 'todo') return Number(a.status != null) - Number(b.status != null) || (Number(a[rank] ?? 999999) - Number(b[rank] ?? 999999)) || valueCmp(a.title, b.title);
    if (sort === 'oldest') return Number(b[rank] ?? -1) - Number(a[rank] ?? -1) || valueCmp(a.title, b.title);
    if (sort === 'title') return valueCmp(a.title, b.title);
    if (sort === 'rating') return Number(a.rating == null) - Number(b.rating == null) || descNum(a.rating, b.rating) || valueCmp(a.title, b.title);
    if (sort === 'episodes') return Number(a.total_episodes == null) - Number(b.total_episodes == null) || descNum(a.total_episodes, b.total_episodes) || valueCmp(a.title, b.title);
    if (sort === 'custom') return Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a[rank] ?? 999999) - Number(b[rank] ?? 999999);
    return Number(a[rank] ?? 999999) - Number(b[rank] ?? 999999) || valueCmp(a.title, b.title);
  });
}

async function setCvNames(client: SupabaseClient, bundle: Bundle, dramaId: number, names: string[]) {
  const clean = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
  const { error: deleteError } = await client.from('drama_cvs').delete().eq('drama_id', dramaId);
  if (deleteError) throw deleteError;
  for (const name of clean) {
    let cv = bundle.cvs.find(row => row.name === name);
    if (!cv) {
      const { data, error } = await client.from('cvs').insert({ user_id: bundle.user.id, name }).select().single();
      if (error) throw error;
      cv = data;
    }
    const { error } = await client.from('drama_cvs').insert({ drama_id: dramaId, cv_id: cv!.id, role_type: '主役' });
    if (error) throw error;
  }
}

async function handleMutations(client: SupabaseClient, bundle: Bundle, request: Request, url: URL) {
  const path = url.pathname;
  const detail = path.match(/^\/api\/dramas\/(\d+)$/);
  const diaryCollection = path.match(/^\/api\/dramas\/(\d+)\/diary$/);
  const diaryItem = path.match(/^\/api\/dramas\/(\d+)\/diary\/(\d+)$/);
  const coverUpload = path.match(/^\/api\/dramas\/(\d+)\/cover$/);

  if (diaryCollection) {
    const dramaId = Number(diaryCollection[1]);
    if (!bundle.dramas.some(row => Number(row.id) === dramaId)) return json({ error: '没找到这部剧' }, 404);
    if (request.method === 'GET') {
      const { data, error } = await client.from('drama_diary_entries').select('*').eq('drama_id', dramaId).order('entry_date', { ascending: false }).order('id', { ascending: false });
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (request.method === 'POST') {
      const body = await request.json();
      const content = String(body.content || '').trim();
      if (!content) return json({ error: '写点内容再保存' }, 400);
      const { data, error } = await client.from('drama_diary_entries').insert({
        user_id: bundle.user.id, drama_id: dramaId,
        entry_date: String(body.entry_date || todayInChina()).slice(0, 10),
        episode_label: String(body.episode_label || '').trim().slice(0, 80) || null, content,
      }).select().single();
      return error ? json({ error: error.message }, 400) : json(data, 201);
    }
  }
  if (diaryItem) {
    const dramaId = Number(diaryItem[1]);
    const entryId = Number(diaryItem[2]);
    if (request.method === 'PATCH') {
      const body = await request.json();
      const content = String(body.content || '').trim();
      if (!content) return json({ error: '日记内容不能为空' }, 400);
      const { data, error } = await client.from('drama_diary_entries').update({
        entry_date: String(body.entry_date || todayInChina()).slice(0, 10),
        episode_label: String(body.episode_label || '').trim().slice(0, 80) || null,
        content, updated_at: new Date().toISOString(),
      }).eq('id', entryId).eq('drama_id', dramaId).select().single();
      return error ? json({ error: error.message }, 400) : json(data);
    }
    if (request.method === 'DELETE') {
      const { error } = await client.from('drama_diary_entries').delete().eq('id', entryId).eq('drama_id', dramaId);
      return error ? json({ error: error.message }, 400) : empty();
    }
  }
  if (coverUpload && request.method === 'POST') {
    const dramaId = Number(coverUpload[1]);
    const { dataUrl } = await request.json();
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!match) return json({ error: '需要 png/jpeg/webp 的图片' }, 400);
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    if (bytes.length > 8 * 1024 * 1024) return json({ error: '图片太大' }, 413);
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    const key = `${bundle.user.id}/custom/${dramaId}-${Date.now()}.${extension}`;
    const { error: uploadError } = await client.storage.from('drama-covers').upload(key, bytes, { contentType: `image/${match[1]}` });
    if (uploadError) return json({ error: uploadError.message }, 400);
    const { error } = await client.from('dramas').update({ cover_local: `r2:${key}`, updated_at: new Date().toISOString() }).eq('id', dramaId);
    if (error) return json({ error: error.message }, 400);
    invalidate();
    const next = await loadBundle(client);
    return json(await shape(client, next, next.dramas.find(row => Number(row.id) === dramaId)!));
  }
  if (path === '/api/dramas/reorder' && request.method === 'PATCH') {
    const { ids, offset = 0 } = await request.json();
    if (!Array.isArray(ids) || !ids.length) return json({ error: '没有要排序的剧' }, 400);
    for (let index = 0; index < ids.length; index++) {
      const { error } = await client.from('dramas').update({ sort_order: Number(offset) + index }).eq('id', Number(ids[index]));
      if (error) return json({ error: error.message }, 400);
    }
    invalidate();
    return json({ updated: ids.length });
  }
  if (path === '/api/dramas/bulk' && request.method === 'PATCH') {
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    if (!ids.length) return json({ error: '没有选中任何剧' }, 400);
    const patch: Row = { updated_at: new Date().toISOString() };
    for (const key of ['status', 'rewatch_queued', 'purchased', 'platform']) if (body[key] !== undefined) patch[key] = body[key];
    if (body.status === '听完') {
      patch.finished_date = todayInChina();
      for (const row of bundle.dramas.filter(item => ids.includes(Number(item.id)))) {
        const one = { ...patch, finished_date: row.finished_date || patch.finished_date, heard_episodes: row.total_episodes };
        const { error } = await client.from('dramas').update(one).eq('id', row.id);
        if (error) return json({ error: error.message }, 400);
      }
    } else {
      const { error } = await client.from('dramas').update(patch).in('id', ids);
      if (error) return json({ error: error.message }, 400);
    }
    invalidate();
    return json({ updated: ids.length });
  }
  if (detail && request.method === 'GET') {
    const row = bundle.dramas.find(item => Number(item.id) === Number(detail[1]));
    return row ? json(await shape(client, bundle, row)) : json({ error: '没找到这部剧' }, 404);
  }
  if (detail && request.method === 'PATCH') {
    const dramaId = Number(detail[1]);
    const body = await request.json();
    const patch: Row = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) if (EDITABLE.has(key)) patch[key] = value;
    if (Array.isArray(body.categories)) patch.categories = JSON.stringify(body.categories);
    const current = bundle.dramas.find(row => Number(row.id) === dramaId);
    if (!current) return json({ error: '没找到这部剧' }, 404);
    if (body.status === '听完') {
      patch.finished_date = body.finished_date === undefined ? (current.finished_date || todayInChina()) : body.finished_date;
      if ((body.total_episodes ?? current.total_episodes) != null) patch.heard_episodes = body.total_episodes ?? current.total_episodes;
    }
    if (Object.keys(patch).length > 1) {
      const { error } = await client.from('dramas').update(patch).eq('id', dramaId);
      if (error) return json({ error: error.message }, 400);
    }
    if (Array.isArray(body.cvNames)) await setCvNames(client, bundle, dramaId, body.cvNames);
    invalidate();
    const next = await loadBundle(client);
    return json(await shape(client, next, next.dramas.find(row => Number(row.id) === dramaId)!));
  }
  if (detail && request.method === 'DELETE') {
    const { error } = await client.from('dramas').delete().eq('id', Number(detail[1]));
    if (error) return json({ error: error.message }, 400);
    invalidate();
    return empty();
  }
  if (path === '/api/dramas' && request.method === 'POST') {
    const body = await request.json();
    if (!body.title?.trim()) return json({ error: '剧名不能为空' }, 400);
    const total = body.total_episodes ?? null;
    const insert: Row = {
      user_id: bundle.user.id, title: body.title.trim(), platform: body.platform || '漫播', source: 'manual',
      kind: body.kind || '广播剧', categories: JSON.stringify(body.categories || []), cover_url: body.cover_url || null,
      status: body.status || null, purchased: body.purchased ? 1 : 0,
      heard_episodes: body.status === '听完' && total != null ? total : body.heard_episodes ?? null,
      total_episodes: total, rating: body.rating ?? null,
      finished_date: body.finished_date || (body.status === '听完' ? todayInChina() : null),
      rewatch_status: body.rewatch_status || null, review: body.review || null,
      serialize_status: body.serialize_status || null, update_info: body.update_info || null,
      update_day: body.update_day || null, price: body.price ?? null, organization: body.organization || null,
      missevan_id: body.missevan_id ?? null,
    };
    const { data, error } = await client.from('dramas').insert(insert).select().single();
    if (error) return json({ error: error.message }, 400);
    if (Array.isArray(body.cvNames)) await setCvNames(client, bundle, Number(data.id), body.cvNames);
    invalidate();
    const next = await loadBundle(client);
    return json(await shape(client, next, next.dramas.find(row => Number(row.id) === Number(data.id))!), 201);
  }
  return null;
}

async function handleReads(client: SupabaseClient, bundle: Bundle, url: URL) {
  const path = url.pathname;
  if (path === '/api/dramas') {
    let source = [...bundle.dramas];
    const q = url.searchParams;
    const eq = (param: string, field = param) => { if (q.get(param)) source = source.filter(row => String(row[field] ?? '') === q.get(param)); };
    eq('status'); eq('platform'); eq('kind'); eq('serialize', 'serialize_status'); eq('organization');
    if (q.has('purchased') && q.get('purchased') !== '') source = source.filter(row => Boolean(row.purchased) === ['true', '1'].includes(q.get('purchased')!));
    if (q.has('subscribed') && q.get('subscribed') !== '') source = source.filter(row => Boolean(row.subscribed) === ['true', '1'].includes(q.get('subscribed')!));
    if (q.get('q')) source = source.filter(row => String(row.title).toLocaleLowerCase().includes(q.get('q')!.toLocaleLowerCase()));
    if (q.get('year')) source = source.filter(row => String(row.finished_date || '').slice(0, 4) === q.get('year'));
    if (q.get('rating_min')) source = source.filter(row => row.rating != null && Number(row.rating) >= Number(q.get('rating_min')));
    if (q.get('category')) source = source.filter(row => { try { return JSON.parse(row.categories || '[]').includes(q.get('category')); } catch { return false; } });
    if (q.get('cv')) {
      const ids = new Set(bundle.cvs.filter(cv => cv.name === q.get('cv')).map(cv => Number(cv.id)));
      const dramaIds = new Set(bundle.links.filter(link => ids.has(Number(link.cv_id)) && link.role_type === '主役').map(link => Number(link.drama_id)));
      source = source.filter(row => dramaIds.has(Number(row.id)));
    }
    const sort = q.get('sort') || 'purchased';
    source.sort((a, b) => {
      if (sort === 'updated') return valueCmp(b.updated_at, a.updated_at);
      if (sort === 'rating') return descNum(a.rating, b.rating) || valueCmp(a.title, b.title);
      if (sort === 'finished') return valueCmp(b.finished_date, a.finished_date);
      if (sort === 'title') return valueCmp(a.title, b.title);
      if (sort === 'custom') return Number(a.sort_order || 0) - Number(b.sort_order || 0) || valueCmp(a.title, b.title);
      return Number(a.bought_order == null) - Number(b.bought_order == null) || Number(a.bought_order ?? 999999) - Number(b.bought_order ?? 999999) || valueCmp(b.updated_at, a.updated_at);
    });
    const result = page(source, url);
    return json({ ...result, items: await shaped(client, bundle, result.items) });
  }
  if (path === '/api/views/purchased' || path === '/api/views/collection') {
    const purchased = path.endsWith('purchased');
    let source = bundle.dramas.filter(row => row.platform === '猫耳' && (purchased ? Boolean(row.purchased) : Boolean(row.subscribed) && !Boolean(row.purchased)));
    const status = url.searchParams.get('status');
    if (status === '__none__') source = source.filter(row => row.status == null);
    else if (status) source = source.filter(row => row.status === status);
    source = sortBucket(source, url.searchParams.get('sort') || 'todo', purchased ? 'bought_order' : 'sub_order');
    const result = page(source, url);
    return json({ ...result, items: await shaped(client, bundle, result.items) });
  }
  if (path === '/api/views/purchased/counts' || path === '/api/views/collection/counts') {
    const purchased = path.includes('purchased');
    const source = bundle.dramas.filter(row => row.platform === '猫耳' && (purchased ? Boolean(row.purchased) : Boolean(row.subscribed) && !Boolean(row.purchased)));
    return json(group(source, row => row.status ?? '__none__').sort((a, b) => b.n - a.n));
  }
  if (path === '/api/views/listening') return json(await shaped(client, bundle, bundle.dramas.filter(row => row.status === '在听').sort((a, b) => valueCmp(a.update_day, b.update_day) || valueCmp(a.title, b.title))));
  if (path === '/api/views/schedule') {
    const source = await shaped(client, bundle, bundle.dramas.filter(row => row.status === '在听' && (WEEKDAYS.includes(row.update_day) || row.update_day === '每日')));
    const byDay: Record<string, Row[]> = Object.fromEntries(WEEKDAYS.map(day => [day, []]));
    source.forEach(row => row.update_day === '每日' ? WEEKDAYS.forEach(day => byDay[day].push(row)) : byDay[row.update_day].push(row));
    return json(byDay);
  }
  const simple: Record<string, (row: Row) => boolean> = {
    '/api/views/rewatch-queue': row => Boolean(row.rewatch_queued),
    '/api/views/rewatch-library': row => Boolean(row.rewatch_status),
    '/api/views/stash': row => row.status === '囤着',
    '/api/views/audiobooks': row => row.kind === '听书' && row.rating != null,
  };
  if (simple[path]) {
    const source = bundle.dramas.filter(simple[path]).sort((a, b) => descNum(a.rating, b.rating) || valueCmp(a.title, b.title));
    return json(await shaped(client, bundle, source));
  }
  if (path === '/api/views/recent') {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - (Number(url.searchParams.get('days')) || 30));
    const date = cutoff.toISOString().slice(0, 10);
    return json(await shaped(client, bundle, bundle.dramas.filter(row => row.finished_date && String(row.finished_date).slice(0, 10) >= date).sort((a, b) => valueCmp(b.finished_date, a.finished_date))));
  }
  if (path === '/api/views/wishlist') return json({
    已购未听: await shaped(client, bundle, bundle.dramas.filter(row => row.status === '想听' && Boolean(row.purchased)).sort((a, b) => valueCmp(a.title, b.title))),
    未购观望: await shaped(client, bundle, bundle.dramas.filter(row => row.status === '想听' && !Boolean(row.purchased)).sort((a, b) => valueCmp(a.title, b.title))),
  });
  if (path === '/api/views/recommend') return json({
    五星: await shaped(client, bundle, bundle.dramas.filter(row => Number(row.rating) >= 5).sort((a, b) => valueCmp(a.title, b.title))),
    优质: await shaped(client, bundle, bundle.dramas.filter(row => Number(row.rating) >= 4.8 && Number(row.rating) < 5).sort((a, b) => descNum(a.rating, b.rating))),
  });
  if (path === '/api/views/untriaged') {
    const shelved = url.searchParams.get('kind') === 'shelved';
    const source = bundle.dramas.filter(row => shelved ? row.status === '搁置' : row.status == null && row.source === 'missevan')
      .sort((a, b) => Number(b.purchased) - Number(a.purchased) || valueCmp(a.title, b.title));
    return json(await shaped(client, bundle, source));
  }
  if (path === '/api/facets') {
    const result: Record<string, Row[]> = {
      status: group(bundle.dramas, row => row.status), platform: group(bundle.dramas, row => row.platform),
      kind: group(bundle.dramas, row => row.kind), purchased: group(bundle.dramas, row => Boolean(row.purchased) ? '1' : '0'),
      serialize: group(bundle.dramas, row => row.serialize_status), category: [], organization: group(bundle.dramas, row => row.organization),
      cv: [], year: group(bundle.dramas, row => row.finished_date ? String(row.finished_date).slice(0, 4) : null), rating: group(bundle.dramas, row => row.rating),
    };
    const categories = bundle.dramas.flatMap(row => { try { return JSON.parse(row.categories || '[]').map((value: string) => ({ value })); } catch { return []; } });
    result.category = group(categories, row => row.value);
    const mainCvIds = bundle.links.filter(link => link.role_type === '主役');
    result.cv = group(mainCvIds, link => bundle.cvs.find(cv => Number(cv.id) === Number(link.cv_id))?.name).slice(0, 60);
    Object.values(result).forEach(items => items.sort((a, b) => b.n - a.n || valueCmp(a.value, b.value)));
    result.year.sort((a, b) => valueCmp(b.value, a.value));
    result.rating.sort((a, b) => Number(b.value) - Number(a.value));
    return json(result);
  }
  if (path === '/api/cvs') {
    const min = Number(url.searchParams.get('min')) || 0;
    const includeAll = url.searchParams.get('role') === 'all';
    const finished = new Set(bundle.dramas.filter(row => row.status === '听完').map(row => Number(row.id)));
    const result = bundle.cvs.map(cv => {
      const dramaIds = bundle.links.filter(link => Number(link.cv_id) === Number(cv.id) && finished.has(Number(link.drama_id)) && (includeAll || link.role_type === '主役')).map(link => Number(link.drama_id));
      return { id: cv.id, name: cv.name, avatar_url: cv.avatar_url, missevan_id: cv.missevan_id, drama_count: dramaIds.length, avg_rating: avg(bundle.dramas.filter(row => dramaIds.includes(Number(row.id))).map(row => row.rating)) };
    }).filter(cv => cv.drama_count >= min).sort((a, b) => b.drama_count - a.drama_count || Number(b.avg_rating || 0) - Number(a.avg_rating || 0));
    return json(result);
  }
  const cvDramas = path.match(/^\/api\/cvs\/(.+)\/dramas$/);
  if (cvDramas) {
    const cv = bundle.cvs.find(row => row.name === decodeURIComponent(cvDramas[1]));
    const includeAll = url.searchParams.get('role') === 'all';
    const ids = new Set(bundle.links.filter(link => Number(link.cv_id) === Number(cv?.id) && (includeAll || link.role_type === '主役')).map(link => Number(link.drama_id)));
    const source = bundle.dramas.filter(row => ids.has(Number(row.id)) && row.status === '听完').sort((a, b) => descNum(a.rating, b.rating) || valueCmp(a.title, b.title));
    return json(await shaped(client, bundle, source));
  }
  if (path === '/api/years') {
    const years = group(bundle.dramas, row => row.finished_date ? String(row.finished_date).slice(0, 4) : null, 'year')
      .map(item => ({ year: item.year, count: item.n, avg_rating: avg(bundle.dramas.filter(row => String(row.finished_date || '').slice(0, 4) === item.year).map(row => row.rating)) }))
      .sort((a, b) => valueCmp(b.year, a.year));
    return json(years);
  }
  const yearStats = path.match(/^\/api\/years\/(\d{4})\/stats$/);
  if (yearStats) {
    const year = yearStats[1];
    const source = bundle.dramas.filter(row => String(row.finished_date || '').slice(0, 4) === year);
    const top = (items: Row[]) => items.sort((a, b) => b.n - a.n || valueCmp(a.label, b.label)).slice(0, 10);
    const mainLinks = bundle.links.filter(link => link.role_type === '主役' && source.some(row => Number(row.id) === Number(link.drama_id)));
    return json({
      year, total: source.length, avgRating: avg(source.map(row => row.rating)),
      episodes: source.reduce((sum, row) => sum + Number(row.total_episodes || 0), 0), reviews: source.filter(row => row.review != null).length,
      byMonth: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, n: source.filter(row => Number(String(row.finished_date).slice(5, 7)) === index + 1).length })),
      byRating: group(source.filter(row => row.rating != null), row => row.rating).map(row => ({ label: row.value, n: row.n })).sort((a, b) => Number(b.label) - Number(a.label)),
      byCategory: top(group(source.flatMap(row => { try { return JSON.parse(row.categories || '[]').map((label: string) => ({ label })); } catch { return []; } }), row => row.label).map(row => ({ label: row.value, n: row.n }))),
      topCvs: top(group(mainLinks, link => bundle.cvs.find(cv => Number(cv.id) === Number(link.cv_id))?.name).map(row => ({ label: row.value, n: row.n }))),
      topRated: source.filter(row => row.rating != null).sort((a, b) => descNum(a.rating, b.rating) || valueCmp(a.title, b.title)).slice(0, 8).map(row => ({ label: row.title, n: Number(row.rating) })),
    });
  }
  const yearList = path.match(/^\/api\/years\/(\d{4})$/);
  if (yearList) return json(await shaped(client, bundle, bundle.dramas.filter(row => String(row.finished_date || '').slice(0, 4) === yearList[1]).sort((a, b) => valueCmp(b.finished_date, a.finished_date))));
  if (path === '/api/stats') {
    const status = group(bundle.dramas, row => row.status ?? '__null__').map(row => ({ status: row.value === '__null__' ? null : row.value, c: row.n }));
    const lastSync = [...bundle.syncLog].sort((a, b) => valueCmp(b.ran_at, a.ran_at))[0] || null;
    return json({
      total: bundle.dramas.length, byStatus: status,
      byPlatform: group(bundle.dramas, row => row.platform).map(row => ({ platform: row.value, c: row.n })),
      byKind: group(bundle.dramas, row => row.kind ?? '__null__').map(row => ({ kind: row.value === '__null__' ? null : row.value, c: row.n })),
      purchased: bundle.dramas.filter(row => row.platform === '猫耳' && Boolean(row.purchased)).length,
      subscribed: bundle.dramas.filter(row => row.platform === '猫耳' && Boolean(row.subscribed)).length,
      reviews: bundle.dramas.filter(row => row.review != null).length,
      purchasedTodo: bundle.dramas.filter(row => row.platform === '猫耳' && Boolean(row.purchased) && row.status == null).length,
      collectionTodo: bundle.dramas.filter(row => row.platform === '猫耳' && Boolean(row.subscribed) && !Boolean(row.purchased) && row.status == null).length,
      listening: bundle.dramas.filter(row => row.status === '在听').length,
      rewatchQueue: bundle.dramas.filter(row => Boolean(row.rewatch_queued)).length,
      lastSync: lastSync ? { ran_at: lastSync.ran_at, kind: lastSync.kind } : null,
    });
  }
  if (path === '/api/sync-log') return json([...bundle.syncLog].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 20).map(row => { try { return { ...row, detail: JSON.parse(row.detail || '[]') }; } catch { return { ...row, detail: [] }; } }));
  if (path === '/api/sync/status') {
    const job = bundle.syncJobs[0];
    let log: string[] = [];
    try { log = JSON.parse(job?.log || '[]'); } catch { log = []; }
    return json(job ? { running: Boolean(job.running), step: job.step, log, error: job.error, expired: Boolean(job.expired), startedAt: job.started_at, finishedAt: job.finished_at } : { running: false, step: null, log: [], error: null, expired: false, finishedAt: null });
  }
  if (path === '/api/sync/session') return json({ hasSession: bundle.dramas.some(row => row.source === 'missevan'), userId: null, savedAt: null });
  return null;
}

export async function staticApiFetch(client: SupabaseClient, input: RequestInfo | URL, init: RequestInit = {}) {
  try {
    const request = new Request(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin), init);
    const url = new URL(request.url);
    const bundle = await loadBundle(client);
    const mutation = await handleMutations(client, bundle, request, url);
    if (mutation) return mutation;
    if (request.method === 'GET') {
      const response = await handleReads(client, bundle, url);
      if (response) return response;
    }
    if (url.pathname.startsWith('/api/sync')) return json({ error: 'GitHub Pages 个人版由 GitHub Actions 定时同步' }, 409);
    return json({ error: '接口不存在' }, 404);
  } catch (error) {
    return json({ error: String((error as Error).message || error) }, 500);
  }
}
