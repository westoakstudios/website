
function required(name) {
  const v = process.env[name];
  if (!v || !v.length) throw new Error(`missing env: ${name}`);
  return v;
}

export const config = {
  httpPort: Number(process.env.PANEL_HTTP_PORT || 80),
  tcpPort: Number(process.env.PANEL_TCP_PORT || 443),

  clientPassword: required('PANEL_CLIENT_PASSWORD'),
  adminUser: required('PANEL_ADMIN_USER'),
  adminPassword: required('PANEL_ADMIN_PASSWORD'),
  sessionSecret: required('PANEL_SESSION_SECRET'),

  heartbeatMs: 120_000,
  offlineAfterMs: 300_000,
  sweepMs: 30_000,

  sessionTtlMs: 12 * 60 * 60 * 1000,
  cookieName: 'panel_sid',

  maxLineBytes: 4096,
  keepOfflineInList: true,
  preserveQueueOnReconnect: true,
};

if (config.sessionSecret.length < 16) {
  throw new Error('PANEL_SESSION_SECRET must be at least 16 chars');
}