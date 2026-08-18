// Resuelve qué llaves de Wompi usar (sandbox/"test" vs. producción/"prod") y
// permite cambiar el entorno activo desde el backoffice sin tocar variables
// de entorno ni redesplegar.
//
// El entorno activo se guarda en la tabla `settings` (ver ensureSchema en
// lib/db.js). Si la base de datos no está configurada, o todavía no hay un
// valor guardado, se usa 'test' por defecto -- así un despliegue nuevo nunca
// cobra en modo real por accidente.
//
// Las llaves mismas siempre viven en variables de entorno, nunca en la base
// de datos, con sufijo _TEST o _PROD:
//   WOMPI_PUBLIC_KEY_TEST / WOMPI_INTEGRITY_SECRET_TEST / WOMPI_EVENTS_SECRET_TEST
//   WOMPI_PUBLIC_KEY_PROD / WOMPI_INTEGRITY_SECRET_PROD / WOMPI_EVENTS_SECRET_PROD

const { sql, ensureSchema, isConfigured } = require('./db');

const SETTING_KEY = 'wompi_environment';
const DEFAULT_ENVIRONMENT = 'test';

function normalize(env) {
  return env === 'prod' ? 'prod' : DEFAULT_ENVIRONMENT;
}

async function getWompiEnvironment() {
  if (!isConfigured) return DEFAULT_ENVIRONMENT;
  try {
    await ensureSchema();
    const rows = await sql`SELECT value FROM settings WHERE key = ${SETTING_KEY}`;
    return normalize(rows[0]?.value);
  } catch (err) {
    console.error('No se pudo leer el entorno de Wompi guardado, usando el valor por defecto:', err);
    return DEFAULT_ENVIRONMENT;
  }
}

async function setWompiEnvironment(env) {
  const value = normalize(env);
  if (!isConfigured) {
    throw new Error('Base de datos no configurada: no se puede guardar el entorno de Wompi.');
  }
  await ensureSchema();
  await sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${SETTING_KEY}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `;
  return value;
}

function getWompiKeys(environment) {
  const suffix = normalize(environment) === 'prod' ? 'PROD' : 'TEST';
  return {
    publicKey: process.env[`WOMPI_PUBLIC_KEY_${suffix}`] || null,
    integritySecret: process.env[`WOMPI_INTEGRITY_SECRET_${suffix}`] || null,
    eventsSecret: process.env[`WOMPI_EVENTS_SECRET_${suffix}`] || null,
  };
}

// Útil para el panel de admin: qué entornos tienen llaves cargadas, sin
// exponer los secretos.
function getConfiguredEnvironments() {
  const test = getWompiKeys('test');
  const prod = getWompiKeys('prod');
  return {
    test: Boolean(test.publicKey && test.integritySecret),
    prod: Boolean(prod.publicKey && prod.integritySecret),
  };
}

module.exports = {
  getWompiEnvironment,
  setWompiEnvironment,
  getWompiKeys,
  getConfiguredEnvironments,
  DEFAULT_ENVIRONMENT,
};
