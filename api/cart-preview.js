// Público: recalcula el total del carrito (subtotal, envío, descuento) sin
// crear ningún pedido ni gastar usos de cupón. Usado por carrito.html para
// mostrar el total en vivo mientras el cliente elige envío/cupón.

const { ensureSchema, isConfigured } = require('../lib/db');
const { computeTotals, CheckoutError } = require('../lib/checkout');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured' });
    return;
  }

  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const totals = await computeTotals(body);
    res.status(200).json({
      subtotal_cop: totals.subtotal_cop,
      shipping_cop: totals.shipping_cop,
      shipping_name: totals.shipping_name,
      discount_cop: totals.discount_cop,
      amount_cop: totals.amount_cop,
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      res.status(400).json({ error: err.code, message: err.message, ...err.extra });
      return;
    }
    console.error('Error en /api/cart-preview:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
