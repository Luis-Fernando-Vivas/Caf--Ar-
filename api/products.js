// Catálogo público: lista de productos activos, o uno solo por slug.
// GET /api/products            -> { products: [...] }
// GET /api/products?slug=xxx   -> { product: {...} }  (404 si no existe o no está activo)

const { sql, ensureSchema, isConfigured } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured', message: 'Falta conectar la base de datos.' });
    return;
  }

  try {
    await ensureSchema();

    const slug = new URL(req.url, 'http://localhost').searchParams.get('slug');

    if (slug) {
      const rows = await sql`
        SELECT id, slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags,
               grind_options, status
        FROM products
        WHERE slug = ${slug} AND status = 'active'
        LIMIT 1
      `;
      if (!rows.length) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ product: rows[0] });
      return;
    }

    const rows = await sql`
      SELECT id, slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags,
             grind_options, status
      FROM products
      WHERE status = 'active'
      ORDER BY sort_order ASC, id ASC
    `;
    res.status(200).json({ products: rows });
  } catch (err) {
    console.error('Error en /api/products:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
