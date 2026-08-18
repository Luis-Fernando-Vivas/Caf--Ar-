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
    // Secuencial (no Promise.all): el ALTER TABLE depende de que orders ya exista.
    schemaReady = (async () => {
      await sql`
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
      `;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'prod';`;
      await sql`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;

      // --- Catálogo de productos, envíos y cupones (backoffice tipo ecommerce) ---
      await sql`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          price_cop INTEGER NOT NULL,
          stock INTEGER NOT NULL DEFAULT 0,
          images JSONB NOT NULL DEFAULT '[]',
          flavor_tags JSONB NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shipping_rates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          amount_cop INTEGER NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS coupons (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          discount_type TEXT NOT NULL,
          discount_value INTEGER NOT NULL,
          min_order_cop INTEGER NOT NULL DEFAULT 0,
          usage_limit INTEGER,
          times_used INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          product_name TEXT NOT NULL,
          unit_price_cop INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          line_total_cop INTEGER NOT NULL
        );
      `;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_rate_id INTEGER;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_name TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cop INTEGER NOT NULL DEFAULT 0;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cop INTEGER NOT NULL DEFAULT 0;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_cop INTEGER;`;

      // Semillas: si el catálogo está vacío, migra el único producto que existía
      // hardcodeado en el sitio, así el catálogo nunca queda vacío durante el rollout.
      await sql`
        INSERT INTO products (slug, name, description, price_cop, stock, images, flavor_tags, status, sort_order)
        SELECT
          'cafe-aru-honey-500g',
          'Café Arú Honey 500g',
          'Café de proceso Honey: el grano se seca con su propio mucílago, concentrando dulzura y complejidad. Cultivado y beneficiado por nuestra familia en las montañas de Palermo, Huila, con prácticas de reconversión productiva y mínimo uso de agua.',
          50000,
          999,
          '[{"url":"img/producto-bolsa-500g.png"},{"url":"img/cerezas-cosecha.jpg"},{"url":"img/proceso-secado.jpg"},{"url":"img/finca-paisaje.jpg"}]'::jsonb,
          '["Dulzura natural","Notas cítricas","Chocolate","Frutos secos"]'::jsonb,
          'active',
          0
        WHERE NOT EXISTS (SELECT 1 FROM products);
      `;
      await sql`
        INSERT INTO shipping_rates (name, amount_cop, is_active, sort_order)
        SELECT 'Envío nacional', 12000, true, 0
        WHERE NOT EXISTS (SELECT 1 FROM shipping_rates);
      `;
    })().catch((err) => {
      schemaReady = null; // permite reintentar en la próxima invocación si falló
      throw err;
    });
  }
  return schemaReady;
}

module.exports = { sql, ensureSchema, isConfigured };
