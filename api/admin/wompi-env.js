// Backoffice: consultar (GET) y cambiar (POST) el entorno activo de Wompi
// (sandbox "test" vs. producción "prod"). Protegido por la cookie de sesión
// de admin -- ver lib/auth.js. Las llaves mismas nunca viajan al navegador,
// solo qué entorno está activo y cuáles tienen llaves cargadas.

const { isAuthenticated } = require('../../lib/auth');
const { isConfigured } = require('../../lib/db');
const { getWompiEnvironment, setWompiEnvironment, getConfiguredEnvironments } = require('../../lib/wompi-env');

module.exports = async (req, res) => {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const environment = await getWompiEnvironment();
    res.status(200).json({ environment, configured: getConfiguredEnvironments() });
    return;
  }

  if (req.method === 'POST') {
    if (!isConfigured) {
      res.status(503).json({
        error: 'db_not_configured',
        message: 'Falta conectar la base de datos (DATABASE_URL / POSTGRES_URL) en Vercel.',
      });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const requested = String(body.environment || '');
    if (requested !== 'test' && requested !== 'prod') {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }

    const configured = getConfiguredEnvironments();
    if (!configured[requested]) {
      res.status(409).json({
        error: 'environment_not_configured',
        message: `Faltan las variables de entorno de Wompi para "${requested}" en Vercel.`,
      });
      return;
    }

    const environment = await setWompiEnvironment(requested);
    res.status(200).json({ environment, configured });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
