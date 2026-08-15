// Conexión compartida a Postgres (Neon, vía Vercel Marketplace) + creación del
// esquema si no existe.
//
// Requiere una variable de entorno con la cadena de conexión. Vercel la agrega
// automáticamente en cuanto conectas una base de datos desde el dashboard
// (Storage -> Create Database -> Postgres/Neon -> Connect Project). Según cómo
// la hayas conectado puede llamarse DATABASE_URL o POSTGRES_URL -- aceptamos
// cualquiera de las dos para no depender de un nombre exacto.

const { neon } = require('@neondatabase/serverless');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

const isConfigured = Boolean(connectionString);
const sql = isConfigured ? neon(connectionString) : null;

let schemaReady = null;

function ensureSchema() {
  if (!isConfigured) {
    throw new Error(
      'Base de datos no configurada: falta DATABASE_URL (o POSTGRES_URL) en las variables de entorno.'
    );
  }
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        reference TEXT UNIQUE NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        quantity INTEGER NOT NULL,
        unit_price_cop INTEGER NOT NULL,
        amount_cop INTEGER NOT NULL,
        wompi_transaction_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `.catch((err) => {
      schemaReady = null; // permite reintentar en la próxima invocación si falló
      throw err;
    });
  }
  return schemaReady;
}

module.exports = { sql, ensureSchema, isConfigured };
