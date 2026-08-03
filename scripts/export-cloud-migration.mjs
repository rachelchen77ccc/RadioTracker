#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { openDb, ROOT } from '../server/db.js';
import {
  buildMigrationBundle,
  PLACEHOLDER_OWNER_ID,
  validateMigrationBundle,
} from './cloud-migration-lib.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const ownerId = option('--owner-id') || process.env.MIGRATION_OWNER_ID || PLACEHOLDER_OWNER_ID;
const outputPath = path.resolve(ROOT, option('--out') || 'data/cloud-migration-dry-run.json');
const db = openDb();

try {
  const bundle = buildMigrationBundle(db, { ownerId, rootDir: ROOT });
  const validation = validateMigrationBundle(bundle);
  if (!validation.ok) throw new Error(`迁移校验失败：\n- ${validation.errors.join('\n- ')}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);

  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    output: path.relative(ROOT, outputPath),
    ownerId,
    ownerIdIsPlaceholder: bundle.export_meta.owner_id_is_placeholder,
    credentialsIncluded: false,
    counts: bundle.export_meta.counts,
    coverFiles: bundle.export_meta.cover_files,
    checksum: bundle.export_meta.tables_sha256,
  }, null, 2));
} finally {
  db.close();
}
