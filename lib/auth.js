// Sesión de administrador por cookie firmada (HMAC), sin base de datos de usuarios.
// Pensado para un solo admin/equipo pequeño con una sola contraseña compartida
// (variable de entorno ADMIN_PASSWORD).

const crypto = require('crypto');

const COOKIE_NAME = 'aru_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('Falta ADMIN_SESSION_SECRET en las variables de entorno.');
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

function createSessionToken() {
  const expires = String(Date.now() + SESSION_TTL_MS);
  return `${expires}.${sign(expires)}`;
}

function isValidSessionToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expires, signature] = parts;
  const expected = sign(expires);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  return Number(expires) > Date.now();
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function isAuthenticated(req) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    return isValidSessionToken(cookies[COOKIE_NAME]);
  } catch {
    return false;
  }
}

function setSessionCookie(res) {
  const token = createSessionToken();
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { isAuthenticated, setSessionCookie, clearSessionCookie, safeEqual, COOKIE_NAME };
