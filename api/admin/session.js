// Sesión del backoffice: POST = login (contraseña -> cookie), DELETE = logout.
// Unificado en un solo archivo para no gastar dos funciones serverless
// separadas (Vercel Hobby limita a 12 por deployment).
//
// Anti fuerza bruta: máx. MAX_FAILED_ATTEMPTS intentos fallidos por IP en
// WINDOW_MINUTES; después responde 429 hasta que pase la ventana.

const { setSessionCookie, clearSessionCookie, safeEqual } = require('../_lib/auth');
const { ensureSchema, isConfigured } = require('../_lib/db');
const { clientIp, isRateLimited, recordHit, clearHits } = require('../_lib/rate-limit');

const MAX_FAILED_ATTEMPTS = 8;
const WINDOW_MINUTES = 15;

module.exports = async (req, res) => {
  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(503).json({
      error: 'admin_not_configured',
      message: 'Falta ADMIN_PASSWORD en las variables de entorno de Vercel.',
    });
    return;
  }

  let password = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    password = String(body.password || '');
  } catch {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }

  const ip = clientIp(req);
  try {
    if (isConfigured) {
      await ensureSchema();
      if (await isRateLimited('login', ip, MAX_FAILED_ATTEMPTS, WINDOW_MINUTES)) {
        res.status(429).json({
          error: 'too_many_attempts',
          message: `Demasiados intentos fallidos. Espera ${WINDOW_MINUTES} minutos e inténtalo de nuevo.`,
        });
        return;
      }
    }

    if (!password || !safeEqual(password, adminPassword)) {
      if (isConfigured) {
        await recordHit('login', ip);
      }
      res.status(401).json({ error: 'invalid_password' });
      return;
    }

    if (isConfigured) {
      await clearHits('login', ip);
    }
  } catch (err) {
    console.error('Error en /api/admin/session:', err);
    res.status(500).json({ error: 'server_error' });
    return;
  }

  setSessionCookie(res);
  res.status(200).json({ ok: true });
};
