import postgres from 'postgres';

const NUMERIC_COLUMNS = new Set([
  'id', 'missevan_id', 'purchased', 'subscribed', 'heard_episodes', 'total_episodes',
  'rating', 'rewatch_queued', 'sync_total_episodes', 'sync_purchased', 'sync_subscribed',
  'bought_order', 'sub_order', 'sort_order', 'added', 'updated', 'skipped', 'running',
  'expired', 'c', 'n', 'count', 'drama_count', 'avg_rating', 'm', 'round',
]);

function normalizeRow(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value instanceof Date) {
      const iso = value.toISOString();
      return [key, key.endsWith('_date') ? iso.slice(0, 10) : iso];
    }
    if (typeof value === 'bigint') return [key, Number(value)];
    if (NUMERIC_COLUMNS.has(key) && typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) {
      return [key, Number(value)];
    }
    return [key, value];
  }));
}

function finalSql(source) {
  let index = 0;
  let sql = source.replace(/\?/g, () => `$${++index}`);
  sql = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  sql = sql.replace(/date\('now',\s*(\$\d+)\)/gi, (_match, placeholder) => `(CURRENT_DATE + ${placeholder}::interval)`);
  // SQLite 用 json_each 展开 JSON 数组；线上 categories 是 Postgres jsonb。
  return sql.replace(
    /json_each\(([^)]+)\)\s+([a-z][a-z0-9_]*)/gi,
    (_match, expression, alias) => `jsonb_array_elements_text(${expression}::jsonb) AS ${alias}(value)`,
  );
}

class PostgresStatement {
  constructor(client, source) {
    this.client = client;
    this.source = source;
    this.params = [];
  }

  bind(...params) {
    this.params = params.map(value => value === undefined ? null : value);
    return this;
  }

  async all() {
    const rows = await this.client.unsafe(finalSql(this.source), this.params);
    return { results: rows.map(normalizeRow) };
  }

  async first() {
    const rows = await this.client.unsafe(finalSql(this.source), this.params);
    return normalizeRow(rows[0] || null);
  }

  async run() {
    let sql = finalSql(this.source).trim().replace(/;$/, '');
    const insertTable = /^insert\s+into\s+(?:public\.)?([a-z_]+)/i.exec(sql)?.[1];
    if (['dramas', 'cvs', 'sync_log'].includes(insertTable) && !/\breturning\b/i.test(sql)) {
      sql += ' RETURNING id';
    }
    const rows = await this.client.unsafe(sql, this.params);
    return {
      meta: {
        changes: Number(rows.count ?? rows.length ?? 0),
        last_row_id: Number(rows[0]?.id ?? 0),
      },
    };
  }
}

export function createPostgresD1(databaseUrl) {
  if (!databaseUrl) throw new Error('缺少 DATABASE_URL');
  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    ssl: 'require',
  });
  return {
    prepare(source) { return new PostgresStatement(client, source); },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
}

export const __test = { finalSql, normalizeRow };
