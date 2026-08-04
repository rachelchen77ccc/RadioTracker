import fs from 'node:fs';
import path from 'node:path';
import { COVER_DIR, ROOT } from '../server/db.js';

const output = path.join(ROOT, 'dist', 'covers');
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(COVER_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(COVER_DIR, entry.name), path.join(output, entry.name));
}
