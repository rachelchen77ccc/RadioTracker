function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readCloudConfig(env = process.env) {
  const config = {
    supabaseUrl: (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)?.trim() || null,
    supabaseAnonKey: (env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY)?.trim() || null,
    supabaseServiceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)?.trim() || null,
    databaseUrl: (env.DATABASE_URL || env.POSTGRES_URL)?.trim() || null,
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY?.trim() || null,
    appOrigin: env.APP_ORIGIN?.trim() || null,
  };

  const required = [
    config.supabaseUrl,
    config.supabaseAnonKey,
    config.supabaseServiceRoleKey,
    config.databaseUrl,
    config.credentialEncryptionKey,
  ];
  return { ...config, enabled: required.every(present) };
}

export function assertCloudConfig(env = process.env) {
  const config = readCloudConfig(env);
  if (!config.enabled) {
    throw new Error('云端模式配置不完整；本地 SQLite 模式仍可继续使用。');
  }
  return config;
}
