// Backoffice: CRUD de productos. Protegido por la cookie de sesión de admin.
// GET             -> todos los productos (cualquier status), para la tabla del admin.
// POST            -> crea un producto.
// PATCH {id,...}  -> actualiza parcialmente un producto.
// DELETE ?id=     -> borra el producto, o lo archiva si tiene pedidos asociados
//                    (para no perder el historial de order_items).

const { isAuthenticated } = require('../../lib/auth');
const { sql, ensureSchema, isConfigured } = require('../../lib/db');
const { slugify } = require('../../lib/slugify');

const ALLOWED_STATUSES = ['active', 'draft', 'archived'];
const SLUG_RE = /^[a-z0-9-]+$/;

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function normalizeProductInput(body, { partial } = {}) {
  const out = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) throw new Error('El nombre es obligatorio.');
    out.name = name;
  }

  if (!partial || body.slug !== undefined || body.name !== undefined) {
    const slug = slugify(body.slug || body.name || '');
    if (!slug || !SLUG_RE.test(slug)) throw new Error('Slug inválido.');
    out.slug = slug;
  }

  if (!partial || body.price_cop !== undefined) {
    const price = parseInt(body.price_cop, 10);
    if (!Number.isFinite(price) || price <= 0) throw new Error('El precio debe ser un número positivo.');
    out.price_cop = price;
  }

  if (!partial || body.compare_at_price_cop !== undefined) {
    const raw = body.compare_at_price_cop;
    if (raw === null || raw === '' || raw === undefined) {
      out.compare_at_price_cop = null;
    } else {
      const compareAt = parseInt(raw, 10);
      if (!Number.isFinite(compareAt) || compareAt <= 0) {
        throw new Error('El precio antes de descuento debe ser un número positivo.');
      }
      out.compare_at_price_cop = compareAt;
    }
  }

  if (!partial || body.stock !== undefined) {
    const stock = parseInt(body.stock, 10);
    if (!Number.isFinite(stock) || stock < 0) throw new Error('El stock debe ser un número >= 0.');
    out.stock = stock;
  }

  if (!partial || body.description !== undefined) {
    out.description = String(body.description || '');
  }

  if (!partial || body.images !== undefined) {
    const images = Array.isArray(body.images) ? body.images : [];
    out.images = images
      .filter((img) => img && typeof img.url === 'string' && img.url.trim())
      .map((img) => ({ url: img.url.trim(), public_id: img.public_id || null }));
  }

  if (!partial || body.flavor_tags !== undefined) {
    const tags = Array.isArray(body.flavor_tags) ? body.flavor_tags : [];
    out.flavor_tags = tags.map((t) => String(t).trim()).filter(Boolean);
  }

  if (!partial || body.grind_options !== undefined) {
    const options = Array.isArray(body.grind_options) ? body.grind_options : [];
    out.grind_options = options.map((t) => String(t).trim()).filter(Boolean);
  }

  if (!partial || body.status !== undefined) {
    const status = String(body.status || 'active');
    if (!ALLOWED_STATUSES.includes(status)) throw new Error('Estado inválido.');
    out.status = status;
  }

  if (!partial || body.sort_order !== undefined) {
    out.sort_order = parseInt(body.sort_order, 10) || 0;
  }

  return out;
}

module.exports = async (req, res) => {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!isConfigured) {
    res.status(503).json({
      error: 'db_not_configured',
      message: 'Falta conectar la base de datos (DATABASE_URL / POSTGRES_URL) en Vercel.',
    });
    return;
  }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags,
               grind_options, status, sort_order, created_at, updated_at
        FROM products
        ORDER BY sort_order ASC, id ASC
      `;
      res.status(200).json({ products: rows });
      return;
    }

    if (req.method === 'POST') {
      let data;
      try {
        data = normalizeProductInput(parseBody(req));
      } catch (err) {
        res.status(400).json({ error: 'invalid_input', message: err.message });
        return;
      }

      try {
        const rows = await sql`
          INSERT INTO products (slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags, grind_options, status, sort_order)
          VALUES (${data.slug}, ${data.name}, ${data.description}, ${data.price_cop}, ${data.compare_at_price_cop ?? null}, ${data.stock},
                  ${JSON.stringify(data.images)}::jsonb, ${JSON.stringify(data.flavor_tags)}::jsonb,
                  ${JSON.stringify(data.grind_options)}::jsonb, ${data.status}, ${data.sort_order})
          RETURNING id, slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags,
                    grind_options, status, sort_order, created_at, updated_at
        `;
        res.status(201).json({ product: rows[0] });
      } catch (err) {
        if (String(err.message || '').includes('duplicate key')) {
          res.status(409).json({ error: 'slug_taken', message: 'Ya existe un producto con ese slug.' });
          return;
        }
        throw err;
      }
      return;
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const id = parseInt(body.id, 10);
      if (!id) {
        res.status(400).json({ error: 'invalid_input', message: 'Falta el id del producto.' });
        return;
      }

      let data;
      try {
        data = normalizeProductInput(body, { partial: true });
      } catch (err) {
        res.status(400).json({ error: 'invalid_input', message: err.message });
        return;
      }
      if (!Object.keys(data).length) {
        res.status(400).json({ error: 'invalid_input', message: 'Nada para actualizar.' });
        return;
      }

      try {
        const rows = await sql`
          UPDATE products SET
            name = COALESCE(${data.name ?? null}, name),
            slug = COALESCE(${data.slug ?? null}, slug),
            description = COALESCE(${data.description ?? null}, description),
            price_cop = COALESCE(${data.price_cop ?? null}, price_cop),
            compare_at_price_cop = CASE WHEN ${data.compare_at_price_cop === undefined}
              THEN compare_at_price_cop ELSE ${data.compare_at_price_cop ?? null} END,
            stock = COALESCE(${data.stock ?? null}, stock),
            images = COALESCE(${data.images ? JSON.stringify(data.images) : null}::jsonb, images),
            flavor_tags = COALESCE(${data.flavor_tags ? JSON.stringify(data.flavor_tags) : null}::jsonb, flavor_tags),
            grind_options = COALESCE(${data.grind_options ? JSON.stringify(data.grind_options) : null}::jsonb, grind_options),
            status = COALESCE(${data.status ?? null}, status),
            sort_order = COALESCE(${data.sort_order ?? null}, sort_order),
            updated_at = now()
          WHERE id = ${id}
          RETURNING id, slug, name, description, price_cop, compare_at_price_cop, stock, images, flavor_tags,
                    grind_options, status, sort_order, created_at, updated_at
        `;
        if (!rows.length) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.status(200).json({ product: rows[0] });
      } catch (err) {
        if (String(err.message || '').includes('duplicate key')) {
          res.status(409).json({ error: 'slug_taken', message: 'Ya existe un producto con ese slug.' });
          return;
        }
        throw err;
      }
      return;
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://localhost');
      const id = parseInt(url.searchParams.get('id'), 10);
      if (!id) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }

      const used = await sql`SELECT 1 FROM order_items WHERE product_id = ${id} LIMIT 1`;
      if (used.length) {
        await sql`UPDATE products SET status = 'archived', updated_at = now() WHERE id = ${id}`;
        res.status(200).json({ ok: true, archived: true });
        return;
      }

      await sql`DELETE FROM products WHERE id = ${id}`;
      res.status(200).json({ ok: true, archived: false });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('Error en /api/admin/products:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
