import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PLACEHOLDER_OWNER_ID = '00000000-0000-4000-8000-000000000001';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = new Set(['在听', '听完', '想听', '囤着', '搁置', '弃了']);

export function deterministicUuid(namespace) {
  const bytes = crypto.createHash('sha256').update(namespace).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nullable(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function bool(value) {
  return Boolean(Number(value));
}

function parseCategories(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

function isoDateTime(value) {
  if (!value) return null;
  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
}

function dramaKey(row) {
  return row.missevan_id
    ? `missevan:${row.missevan_id}`
    : `legacy:${row.id}:${row.platform}:${row.title}`;
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function buildMigrationBundle(db, { ownerId, rootDir, generatedAt = new Date().toISOString() }) {
  if (!UUID_PATTERN.test(ownerId)) throw new Error('ownerId 必须是有效的 UUID');

  const dramas = db.prepare('select * from dramas order by id').all();
  const cvs = db.prepare('select * from cvs order by id').all();
  const dramaCvs = db.prepare('select * from drama_cvs order by drama_id, cv_id, role_type').all();
  const rewatchPlans = db.prepare('select * from rewatch_plans order by id').all();
  const syncLogs = db.prepare('select * from sync_log order by id').all();

  const dramaIds = new Map(dramas.map((row) => [row.id, deterministicUuid(`radiotracker:drama:${dramaKey(row)}`)]));
  const cvIds = new Map(cvs.map((row) => [row.id, deterministicUuid(`radiotracker:cv:${row.missevan_id || row.name}`)]));
  const coverFiles = [];

  const catalog = dramas.map((row) => ({
    id: dramaIds.get(row.id),
    legacy_id: row.id,
    missevan_id: nullable(row.missevan_id),
    title: row.title,
    platform: row.platform,
    source: row.source,
    kind: nullable(row.kind),
    categories: parseCategories(row.categories),
    organization: nullable(row.organization),
    abstract: nullable(row.abstract),
    cover_url: nullable(row.cover_url),
    total_episodes: nullable(row.total_episodes),
    serialize_status: nullable(row.serialize_status),
    update_info: nullable(row.update_info),
    update_day: nullable(row.update_day),
    price: nullable(row.price),
    detail_error: nullable(row.detail_error),
    detail_fetched_at: isoDateTime(row.detail_fetched_at),
    created_at: isoDateTime(row.created_at),
    updated_at: isoDateTime(row.updated_at),
  }));

  const userDramas = dramas.map((row) => {
    const dramaId = dramaIds.get(row.id);
    let customCoverObject = null;
    if (row.cover_local) {
      const localPath = path.resolve(rootDir, 'data', 'covers', row.cover_local);
      const extension = path.extname(row.cover_local).toLowerCase() || '.jpg';
      customCoverObject = `${ownerId}/${dramaId}${extension}`;
      coverFiles.push({
        drama_id: dramaId,
        source_path: row.cover_local,
        object_key: customCoverObject,
        exists: fs.existsSync(localPath),
        sha256: fs.existsSync(localPath) ? fileSha256(localPath) : null,
      });
    }

    return {
      id: deterministicUuid(`radiotracker:user-drama:${ownerId}:${dramaId}`),
      user_id: ownerId,
      drama_id: dramaId,
      legacy_id: row.id,
      status: nullable(row.status),
      purchased: bool(row.purchased),
      subscribed: bool(row.subscribed),
      heard_episodes: nullable(row.heard_episodes),
      rating: nullable(row.rating),
      finished_date: nullable(row.finished_date),
      rewatch_queued: bool(row.rewatch_queued),
      rewatch_status: nullable(row.rewatch_status),
      review: nullable(row.review),
      bought_order: nullable(row.bought_order),
      sub_order: nullable(row.sub_order),
      sort_order: row.sort_order || 0,
      sync_saw_episode: nullable(row.sync_saw_episode),
      sync_total_episodes: nullable(row.sync_total_episodes),
      sync_newest: nullable(row.sync_newest),
      sync_serialize: nullable(row.sync_serialize),
      sync_purchased: row.sync_purchased === null ? null : bool(row.sync_purchased),
      sync_subscribed: row.sync_subscribed === null ? null : bool(row.sync_subscribed),
      synced_at: isoDateTime(row.synced_at),
      custom_total_episodes: null,
      custom_cover_object: customCoverObject,
      created_at: isoDateTime(row.created_at),
      updated_at: isoDateTime(row.updated_at),
    };
  });

  const catalogCvs = cvs.map((row) => ({
    id: cvIds.get(row.id),
    legacy_id: row.id,
    name: row.name,
    missevan_id: nullable(row.missevan_id),
    avatar_url: nullable(row.avatar_url),
    note: nullable(row.note),
    created_at: isoDateTime(row.created_at),
  }));

  const catalogDramaCvs = dramaCvs.map((row) => ({
    drama_id: dramaIds.get(row.drama_id),
    cv_id: cvIds.get(row.cv_id),
    role_type: row.role_type,
    character: nullable(row.character),
  }));

  const migratedRewatchPlans = rewatchPlans.map((row) => ({
    id: deterministicUuid(`radiotracker:rewatch-plan:${ownerId}:${row.id}`),
    user_id: ownerId,
    drama_id: dramaIds.get(row.drama_id),
    legacy_id: row.id,
    planned_at: nullable(row.planned_at),
    done_at: nullable(row.done_at),
    round: nullable(row.round),
    note: nullable(row.note),
  }));

  const migratedSyncLogs = syncLogs.map((row) => ({
    id: deterministicUuid(`radiotracker:sync-log:${ownerId}:${row.id}`),
    user_id: ownerId,
    job_id: null,
    legacy_id: row.id,
    kind: row.kind,
    added: row.added,
    updated: row.updated,
    skipped: row.skipped,
    detail: parseJson(row.detail),
    ran_at: isoDateTime(row.ran_at),
  }));

  const tables = {
    drama_catalog: catalog,
    catalog_cvs: catalogCvs,
    catalog_drama_cvs: catalogDramaCvs,
    user_dramas: userDramas,
    rewatch_plans: migratedRewatchPlans,
    sync_logs: migratedSyncLogs,
  };
  const checksum = crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');

  return {
    export_meta: {
      format: 'radiotracker-cloud-migration',
      version: 1,
      private_data: true,
      generated_at: generatedAt,
      source_database: 'radiotracker.db',
      owner_id: ownerId,
      owner_id_is_placeholder: ownerId === PLACEHOLDER_OWNER_ID,
      credentials_included: false,
      tables_sha256: checksum,
      counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
      cover_files: coverFiles.length,
    },
    tables,
    cover_files: coverFiles,
  };
}

export function validateMigrationBundle(bundle) {
  const errors = [];
  const { export_meta: meta, tables, cover_files: coverFiles } = bundle;
  if (!meta || meta.format !== 'radiotracker-cloud-migration') errors.push('迁移包格式不正确');
  if (meta?.credentials_included !== false) errors.push('迁移包不能包含登录凭据');
  if (!tables) errors.push('缺少 tables');
  if (errors.length) return { ok: false, errors };

  const expectedChecksum = crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
  if (expectedChecksum !== meta.tables_sha256) errors.push('数据校验和不匹配');

  const catalogIds = new Set(tables.drama_catalog.map((row) => row.id));
  const cvIds = new Set(tables.catalog_cvs.map((row) => row.id));
  const userDramaPairs = new Set();
  for (const row of tables.user_dramas) {
    if (row.user_id !== meta.owner_id) errors.push(`剧目 ${row.legacy_id} 的用户归属不正确`);
    if (!catalogIds.has(row.drama_id)) errors.push(`剧目 ${row.legacy_id} 缺少公共资料`);
    if (row.status && !ALLOWED_STATUSES.has(row.status)) errors.push(`剧目 ${row.legacy_id} 的状态不合法：${row.status}`);
    const pair = `${row.user_id}:${row.drama_id}`;
    if (userDramaPairs.has(pair)) errors.push(`重复的用户剧目：${row.legacy_id}`);
    userDramaPairs.add(pair);
  }
  for (const row of tables.catalog_drama_cvs) {
    if (!catalogIds.has(row.drama_id)) errors.push(`CV 关联缺少剧目：${row.drama_id}`);
    if (!cvIds.has(row.cv_id)) errors.push(`CV 关联缺少 CV：${row.cv_id}`);
  }
  for (const row of tables.rewatch_plans) {
    if (row.user_id !== meta.owner_id || !catalogIds.has(row.drama_id)) errors.push(`重刷计划 ${row.legacy_id} 关联不正确`);
  }
  for (const row of tables.sync_logs) {
    if (row.user_id !== meta.owner_id) errors.push(`同步记录 ${row.legacy_id} 的用户归属不正确`);
  }
  for (const file of coverFiles || []) {
    if (!catalogIds.has(file.drama_id)) errors.push(`封面关联缺少剧目：${file.source_path}`);
    if (!file.exists) errors.push(`找不到本地封面：${file.source_path}`);
  }
  for (const [table, expected] of Object.entries(meta.counts || {})) {
    if (!tables[table] || tables[table].length !== expected) errors.push(`${table} 数量与摘要不一致`);
  }

  return { ok: errors.length === 0, errors };
}
