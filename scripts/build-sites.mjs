import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { ROOT, COVER_DIR } from '../server/db.js';

const dist = path.join(ROOT, 'dist');
const serverOut = path.join(dist, 'server', 'index.js');
const metadataOut = path.join(dist, '.openai');
const coversOut = path.join(dist, 'covers');

fs.mkdirSync(path.dirname(serverOut), { recursive: true });
fs.mkdirSync(metadataOut, { recursive: true });
fs.mkdirSync(coversOut, { recursive: true });

await build({
  entryPoints: [path.join(ROOT, 'server', 'cloud', 'worker.js')],
  outfile: serverOut,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});

fs.copyFileSync(
  path.join(ROOT, '.openai', 'hosting.json'),
  path.join(metadataOut, 'hosting.json'),
);

for (const entry of fs.readdirSync(COVER_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(COVER_DIR, entry.name), path.join(coversOut, entry.name));
}
