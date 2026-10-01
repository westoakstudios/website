
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64) {
  return createHmac('sha256', config.sessionSecret).update(payloadB64).digest('base64url');
}

export function issue(user) {
  const payload = { u: user, exp: Date.now() + config.sessionTtlMs };
  const b = b64url(JSON.stringify(payload));
  return `${b}.${sign(b)}`;
}

export function verify(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function cookieHeader(token) {
  const maxAge = Math.floor(config.sessionTtlMs / 1000);
  return `${config.cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearCookieHeader() {
  return `${config.cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}