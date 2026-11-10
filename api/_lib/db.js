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

// Súbelo cada vez que cambies las migraciones de abajo. Mientras coincida con
// el guardado en `settings`, ensureSchema se resuelve con UNA sola consulta en
// vez de ~30 viajes secuenciales a Neon (lo que hacía lenta la primera carga
// de la tienda en cada arranque en frío de la función).
const SCHEMA_VERSION = '10';

async function schemaIsCurrent() {
  try {
    const rows = await sql`SELECT value FROM settings WHERE key = 'schema_version' LIMIT 1`;
    return rows.length > 0 && rows[0].value === SCHEMA_VERSION;
  } catch {
    return false; // la tabla settings aún no existe -> hay que migrar
  }
}

function ensureSchema() {
  if (!isConfigured) {
    throw new Error(
      'Base de datos no configurada: falta DATABASE_URL (o POSTGRES_URL) en las variables de entorno.'
    );
  }
  if (!schemaReady) {
    // Secuencial (no Promise.all): el ALTER TABLE depende de que orders ya exista.
    schemaReady = (async () => {
      if (await schemaIsCurrent()) return;

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
      await sql`
        CREATE TABLE IF NOT EXISTS reviews (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          author_name TEXT NOT NULL,
          rating INTEGER NOT NULL,
          comment TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price_cop INTEGER;`;
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS grind_options JSONB NOT NULL DEFAULT '[]';`;
      // Badges editables desde el backoffice: el de la tarjeta en /tienda y el
      // que va sobre el precio en la ficha. '' = no se muestra. Las filas viejas
      // (NULL) heredan el texto que antes estaba fijo en el código; la ficha solo
      // lo mostraba con descuento, así que sin descuento arranca vacío.
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS store_badge TEXT;`;
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS product_badge TEXT;`;
      await sql`UPDATE products SET store_badge = 'Lanzamiento' WHERE store_badge IS NULL;`;
      await sql`
        UPDATE products SET product_badge = CASE
          WHEN compare_at_price_cop > price_cop THEN 'Precio de lanzamiento' ELSE '' END
        WHERE product_badge IS NULL;
      `;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_rate_id INTEGER;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_name TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cop INTEGER NOT NULL DEFAULT 0;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cop INTEGER NOT NULL DEFAULT 0;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_cop INTEGER;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_address TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;`;
      // Link de pago de Wompi generado desde el backoffice (/admin/payment-links).
      // Solo lo tienen esos pedidos; los del carrito lo dejan en NULL.
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_url TEXT;`;
      // Reporte de ingresos y costos (/admin/reports): lo que de verdad costó
      // el envío de cada pedido (NULL = aún sin registrar) y los gastos del día.
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost_cop INTEGER;`;
      await sql`
        CREATE TABLE IF NOT EXISTS expenses (
          id SERIAL PRIMARY KEY,
          spent_on DATE NOT NULL,
          category TEXT NOT NULL DEFAULT 'ads',
          amount_cop INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS expenses_spent_on ON expenses (spent_on);`;
      // Despacho (/admin): transportadora y guía con las que salió el pedido,
      // y cuándo se le avisó al cliente por correo.
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url TEXT;`;
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_notified_at TIMESTAMPTZ;`;
      // Carritos con correo (carrito.html) para el recordatorio de carrito
      // abandonado -- ver api/_lib/abandoned-carts.js. "token" va en el link
      // de recuperación que recibe el cliente.
      await sql`
        CREATE TABLE IF NOT EXISTS carts (
          id SERIAL PRIMARY KEY,
          token TEXT UNIQUE NOT NULL,
          email TEXT NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          customer_address TEXT,
          items JSONB NOT NULL DEFAULT '[]',
          shipping_rate_id INTEGER,
          coupon_code TEXT,
          order_reference TEXT,
          reminder_sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS carts_pending_reminder ON carts (updated_at) WHERE reminder_sent_at IS NULL;`;
      // Límite de peticiones por IP (login, pedidos, reseñas, cupones) -- ver
      // api/_lib/rate-limit.js. Reemplaza a la tabla login_attempts de la v2.
      await sql`
        CREATE TABLE IF NOT EXISTS rate_limits (
          id SERIAL PRIMARY KEY,
          bucket TEXT NOT NULL,
          ip TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS rate_limits_lookup ON rate_limits (bucket, ip, created_at);`;
      await sql`DROP TABLE IF EXISTS login_attempts;`;
      // Registro personal de bolsas (/admin/bags): las que llegan y las que se
      // venden cada día, en grano o molido. No toca el stock de la tienda.
      await sql`
        CREATE TABLE IF NOT EXISTS bag_movements (
          id SERIAL PRIMARY KEY,
          moved_on DATE NOT NULL,
          kind TEXT NOT NULL,
          grind TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS bag_movements_moved_on ON bag_movements (moved_on);`;
      // Cada movimiento va por producto + variación (opción de molienda del
      // producto). "grind" queda solo para los registros de la primera versión.
      await sql`ALTER TABLE bag_movements ADD COLUMN IF NOT EXISTS product_id INTEGER;`;
      await sql`ALTER TABLE bag_movements ADD COLUMN IF NOT EXISTS product_name TEXT;`;
      await sql`ALTER TABLE bag_movements ADD COLUMN IF NOT EXISTS variant TEXT;`;
      await sql`ALTER TABLE bag_movements ALTER COLUMN grind DROP NOT NULL;`;
      // Cuándo salió el pedido: las bolsas vendidas se descuentan ese día.
      // Los ya enviados antes de existir la columna toman la fecha del correo
      // de despacho o, si no se mandó, la de su última actualización.
      await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;`;
      await sql`
        UPDATE orders SET shipped_at = COALESCE(shipped_notified_at, updated_at)
        WHERE status = 'shipped' AND shipped_at IS NULL;
      `;

      // Semillas: si el catálogo está vacío, migra el único producto que existía
      // hardcodeado en el sitio, así el catálogo nunca queda vacío durante el rollout.
      await sql`
        INSERT INTO products (slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags, grind_options, status, sort_order, store_badge, product_badge)
        SELECT
          'cafe-aru-honey-500g',
          'Café Arú Honey 500g',
          'Café de proceso Honey: el grano se seca con su propio mucílago, concentrando dulzura y complejidad. Cultivado y beneficiado por nuestra familia en las montañas de Palermo, Huila, con prácticas de reconversión productiva y mínimo uso de agua.',
          49900,
          74900,
          999,
          '[{"url":"img/product/cafe-aru.webp"},{"url":"img/product/cafe-aru-taza.webp"},{"url":"img/product/cafe-aru-mano.webp"},{"url":"img/product/cafe-aru-granos.webp"},{"url":"img/product/cafe-aru-textura.webp"}]'::jsonb,
          '["Dulzura natural","Notas cítricas","Chocolate","Frutos secos"]'::jsonb,
          '["Grano entero","Molido"]'::jsonb,
          'active',
          0,
          'Lanzamiento',
          'Precio de lanzamiento'
        WHERE NOT EXISTS (SELECT 1 FROM products);
      `;
      await sql`
        INSERT INTO shipping_rates (name, amount_cop, is_active, sort_order)
        SELECT 'Envío nacional', 12000, true, 0
        WHERE NOT EXISTS (SELECT 1 FROM shipping_rates);
      `;
      await sql`
        INSERT INTO reviews (product_id, author_name, rating, comment, status, created_at)
        SELECT p.id, r.author_name, r.rating, r.comment, 'approved', r.created_at
        FROM products p, (VALUES
          ('María Fernanda R.', 5, 'el cafe llego recien tostado se siente en el aroma apenas lo abres tiene un sabor dulce que me encanto ya es mi marca de cabecera', '2026-07-02T14:20:00-05:00'::timestamptz),
          ('Camilo Andrade', 5, 'muy buena atencion por whatsapp y llego rapido a bogota el cafe en grano quedo perfecto en mi cafetera se sienten harto las notas de chocolate', '2026-07-15T09:05:00-05:00'::timestamptz),
          ('Laura Gómez', 4, 'buen cafe cumple con lo que promete el envio si se demoro un par de dias mas de lo esperado pero valio la pena', '2026-07-28T18:40:00-05:00'::timestamptz),
          ('Juan Pablo Ortiz', 5, 'se nota que es un producto echo con cuidado el empaque llego perfecto y el sabor es suave con un toque citrico bien rico recomendado', '2026-08-05T11:15:00-05:00'::timestamptz),
          ('Daniela Castro', 5, 'compre para regalar y termine pidiendo otra bolsa pa mi mismo se siente que es autentico cafe huilense', '2026-08-14T20:30:00-05:00'::timestamptz)
        ) AS r(author_name, rating, comment, created_at)
        WHERE p.slug = 'cafe-aru-honey-500g' AND NOT EXISTS (SELECT 1 FROM reviews);
      `;
      await sql`
        INSERT INTO settings (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      `;
    })().catch((err) => {
      schemaReady = null; // permite reintentar en la próxima invocación si falló
      throw err;
    });
  }
  return schemaReady;
}

module.exports = { sql, ensureSchema, isConfigured };
