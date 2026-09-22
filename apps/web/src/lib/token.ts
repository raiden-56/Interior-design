/**
 * Signed, self-contained tokens (HMAC-SHA256 over a JSON payload).
 *
 * Web Crypto rather than `node:crypto` so the exact same code runs in the Edge
 * middleware, in route handlers and in tests. Tokens carry their own expiry;
 * nothing is looked up, so a share link keeps working with the backend down.
 *
 * Trade-off worth knowing: stateless tokens cannot be revoked before they
 * expire. Share links are therefore short-lived by default and the expiry is
 * chosen when the link is created.
 */

const DEV_SECRET = 'interior-studio-dev-secret-change-me';

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production' && !globalThis.__interiorSecretWarned) {
    globalThis.__interiorSecretWarned = true;
    console.warn('[auth] AUTH_SECRET is not set — falling back to the development secret. Set it before deploying.');
  }
  return secret || DEV_SECRET;
}

declare global {
  // eslint-disable-next-line no-var
  var __interiorSecretWarned: boolean | undefined;
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign<T extends object>(payload: T, secret = authSecret()): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(mac))}`;
}

/** Returns the payload, or null when the signature or the expiry fails. */
export async function verify<T extends { exp?: number }>(token: string | undefined | null, secret = authSecret()): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.', 2);
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), base64UrlDecode(mac), encoder.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(base64UrlDecode(body)))) as T;
    if (payload.exp && payload.exp > 0 && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Length-independent comparison, so a wrong password cannot be timed out character by character. */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const SESSION_COOKIE = 'interior_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
