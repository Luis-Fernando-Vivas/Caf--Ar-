// Backoffice: listar pedidos (GET) y actualizar su estado manualmente (PATCH).
// Protegido por la cookie de sesión de admin -- ver lib/auth.js.

const { isAuthenticated } = require('../../lib/auth');
const { sql, ensureSchema, isConfigured } = require('../../lib/db');

const ALLOWED_STATUSES = [
  'pending',
  'approved',
  'declined',
  'voided',
  'whatsapp_pending',
  'paid_manually',
  'shipped',
  'cancelled',
];

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
        SELECT id, reference, channel, status, quantity, unit_price_cop, amount_cop,
               wompi_transaction_id, created_at, updated_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 300
      `;
      res.status(200).json({ orders: rows });
      return;
    }

    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const id = parseInt(body.id, 10);
      const status = String(body.status || '');

      if (!id || !ALLOWED_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }

      await sql`UPDATE orders SET status = ${status}, updated_at = now() WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('Error en /api/admin/orders:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
