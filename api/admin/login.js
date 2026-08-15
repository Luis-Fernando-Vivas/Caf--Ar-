// Login del backoffice: una sola contraseña compartida (ADMIN_PASSWORD),
// sin gestión de usuarios. Al validar, deja una cookie de sesión firmada.

const { setSessionCookie, safeEqual } = require('../../lib/auth');

module.exports = async (req, res) => {
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

  if (!password || !safeEqual(password, adminPassword)) {
    res.status(401).json({ error: 'invalid_password' });
    return;
  }

  setSessionCookie(res);
  res.status(200).json({ ok: true });
};
