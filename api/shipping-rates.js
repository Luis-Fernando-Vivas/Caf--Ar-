// Público: tarifas de envío activas, para el selector del carrito.

const { sql, ensureSchema, isConfigured } = require('./_lib/db');
const { getFreeShippingRule } = require('./_lib/shipping-rule');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured' });
    return;
  }

  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, name, amount_cop
      FROM shipping_rates
      WHERE is_active = true
      ORDER BY sort_order ASC, id ASC
    `;
    const free_shipping_rule = await getFreeShippingRule();
    res.status(200).json({ rates: rows, free_shipping_rule });
  } catch (err) {
    console.error('Error en /api/shipping-rates:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
