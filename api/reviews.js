// Reseñas de productos. Todo en un solo archivo (público + admin) para no
// sumar otra función serverless aparte (Vercel Hobby limita a 12 por deployment).
//
// GET  ?product_id=X&all=1   (requiere sesión admin) -> todas las reseñas de ese
//                             producto, cualquier status, para moderar.
// GET  ?product_id=X          (público) -> solo reseñas 'approved' + promedio/conteo.
// POST { product_id, author_name, rating, comment }  (público) -> crea una reseña
//      en estado 'pending'. No aparece en el sitio hasta que un admin la apruebe.
// PATCH { id, status } (requiere sesión admin) -> aprobar/rechazar una reseña.
// DELETE ?id=           (requiere sesión admin) -> borrar una reseña.

const { isAuthenticated } = require('../lib/auth');
const { sql, ensureSchema, isConfigured } = require('../lib/db');

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected'];

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

module.exports = async (req, res) => {
  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured' });
    return;
  }

  try {
    await ensureSchema();
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.searchParams.get('all')) {
      // Moderación: todas las reseñas (cualquier status), de todos los productos
      // o filtradas a uno solo si se manda product_id.
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const productId = parseInt(url.searchParams.get('product_id'), 10) || null;
      const rows = productId
        ? await sql`
            SELECT r.*, p.name AS product_name FROM reviews r
            JOIN products p ON p.id = r.product_id
            WHERE r.product_id = ${productId} ORDER BY r.created_at DESC
          `
        : await sql`
            SELECT r.*, p.name AS product_name FROM reviews r
            JOIN products p ON p.id = r.product_id
            ORDER BY r.created_at DESC
          `;
      res.status(200).json({ reviews: rows });
      return;
    }

    if (req.method === 'GET') {
      const productId = parseInt(url.searchParams.get('product_id'), 10);
      if (!productId) {
        res.status(400).json({ error: 'invalid_input', message: 'Falta product_id.' });
        return;
      }

      const rows = await sql`
        SELECT id, author_name, rating, comment, created_at FROM reviews
        WHERE product_id = ${productId} AND status = 'approved'
        ORDER BY created_at DESC
      `;
      const count = rows.length;
      const average = count ? rows.reduce((sum, r) => sum + r.rating, 0) / count : 0;
      res.status(200).json({ reviews: rows, average: Math.round(average * 10) / 10, count });
      return;
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const productId = parseInt(body.product_id, 10);
      const authorName = String(body.author_name || '').trim().slice(0, 80);
      const rating = parseInt(body.rating, 10);
      const comment = String(body.comment || '').trim().slice(0, 1000);

      if (!productId || !authorName || !comment || !Number.isFinite(rating) || rating < 1 || rating > 5) {
        res.status(400).json({ error: 'invalid_input', message: 'Revisa el nombre, la calificación (1-5) y el comentario.' });
        return;
      }

      const product = await sql`SELECT id FROM products WHERE id = ${productId} AND status = 'active'`;
      if (!product.length) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      await sql`
        INSERT INTO reviews (product_id, author_name, rating, comment, status)
        VALUES (${productId}, ${authorName}, ${rating}, ${comment}, 'pending')
      `;
      res.status(201).json({ ok: true, message: 'Gracias, tu reseña quedará publicada luego de una breve revisión.' });
      return;
    }

    if (req.method === 'PATCH') {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const body = parseBody(req);
      const id = parseInt(body.id, 10);
      const status = String(body.status || '');
      if (!id || !ALLOWED_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }
      await sql`UPDATE reviews SET status = ${status} WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      if (!isAuthenticated(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const id = parseInt(url.searchParams.get('id'), 10);
      if (!id) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }
      await sql`DELETE FROM reviews WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('Error en /api/reviews:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
