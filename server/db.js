import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const COVER_DIR = path.join(DATA_DIR, 'covers');
export const DB_PATH = path.join(DATA_DIR, 'radiotracker.db');

fs.mkdirSync(COVER_DIR, { recursive: true });

export function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  return db;
}

export function initDb() {
  const db = openDb();
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}
