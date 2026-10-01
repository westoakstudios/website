
const buckets = new Map();

function key(scope, ip) {
  return `${scope}:${ip}`;
}

export function hit(scope, ip, limit, windowMs) {
  const k = key(scope, ip);
  const now = Date.now();
  const arr = buckets.get(k) ?? [];
  const cutoff = now - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length >= limit) {
    buckets.set(k, arr);
    return { ok: false, retryAfterMs: windowMs - (now - arr[0]) };
  }
  arr.push(now);
  buckets.set(k, arr);
  return { ok: true };
}

export function reset(scope, ip) {
  buckets.delete(key(scope, ip));
}

export function sweep() {
  const now = Date.now();
  const maxWindow = 10 * 60 * 1000;
  for (const [k, arr] of buckets) {
    while (arr.length && arr[0] < now - maxWindow) arr.shift();
    if (arr.length === 0) buckets.delete(k);
  }
}

setInterval(sweep, 60_000).unref();