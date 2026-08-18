// Checkout del carrito: reemplaza a los antiguos api/wompi-signature.js y
// api/orders/whatsapp.js (que solo sabían cobrar 1 producto hardcodeado).
// POST { items:[{product_id, quantity}], shipping_rate_id, coupon_code, channel }
//
// Nunca confía en precios/descuentos que mande el navegador: recalcula todo
// desde la base de datos con lib/checkout.js#computeTotals, exactamente igual
// para el canal Wompi y el canal WhatsApp.

const crypto = require('crypto');
const { sql, ensureSchema, isConfigured } = require('../lib/db');
const { computeTotals, CheckoutError } = require('../lib/checkout');
const { getWompiEnvironment, getWompiKeys } = require('../lib/wompi-env');

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured', message: 'Falta conectar la base de datos.' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'wompi';

  try {
    await ensureSchema();

    let totals;
    try {
      totals = await computeTotals(body);
    } catch (err) {
      if (err instanceof CheckoutError) {
        res.status(400).json({ error: err.code, message: err.message, ...err.extra });
        return;
      }
      throw err;
    }

    let publicKey = null;
    let integritySecret = null;
    let environment = null;
    if (channel === 'wompi') {
      environment = await getWompiEnvironment();
      ({ publicKey, integritySecret } = getWompiKeys(environment));
      if (!publicKey || !integritySecret) {
        res.status(503).json({
          error: 'wompi_not_configured',
          message: `Faltan las llaves de Wompi para el entorno "${environment}" en las variables de entorno.`,
        });
        return;
      }
    }

    const reference = `ARU-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const totalQuantity = totals.lines.reduce((sum, l) => sum + l.quantity, 0);
    const status = channel === 'wompi' ? 'pending' : 'whatsapp_pending';

    const orderRows = await sql`
      INSERT INTO orders (
        reference, channel, status, quantity, unit_price_cop, amount_cop, environment,
        shipping_rate_id, shipping_name, shipping_cop, coupon_code, discount_cop, subtotal_cop
      )
      VALUES (
        ${reference}, ${channel}, ${status}, ${totalQuantity}, 0, ${totals.amount_cop}, ${environment || 'prod'},
        ${body.shipping_rate_id || null}, ${totals.shipping_name}, ${totals.shipping_cop},
        ${totals.coupon ? totals.coupon.code : null}, ${totals.discount_cop}, ${totals.subtotal_cop}
      )
      RETURNING id
    `;
    const orderId = orderRows[0].id;

    for (const line of totals.lines) {
      await sql`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop)
        VALUES (${orderId}, ${line.product_id}, ${line.product_name}, ${line.unit_price_cop}, ${line.quantity}, ${line.line_total_cop})
      `;
    }

    if (totals.coupon) {
      await sql`UPDATE coupons SET times_used = times_used + 1 WHERE id = ${totals.coupon.id}`;
    }

    if (channel === 'wompi') {
      const currency = 'COP';
      const amountInCents = totals.amount_cop * 100;
      const signature = crypto
        .createHash('sha256')
        .update(`${reference}${amountInCents}${currency}${integritySecret}`)
        .digest('hex');
      res.status(200).json({ publicKey, currency, amountInCents, reference, signature });
      return;
    }

    const itemLines = totals.lines.map((l) => `${l.quantity}x ${l.product_name} — $${formatCOP(l.line_total_cop)}`);
    let whatsappMessage = `Hola Café Arú! Quiero hacer este pedido:\n${itemLines.join('\n')}`;
    whatsappMessage += `\nSubtotal: $${formatCOP(totals.subtotal_cop)}`;
    if (totals.shipping_name) whatsappMessage += `\nEnvío (${totals.shipping_name}): $${formatCOP(totals.shipping_cop)}`;
    if (totals.discount_cop > 0) whatsappMessage += `\nDescuento (${totals.coupon.code}): -$${formatCOP(totals.discount_cop)}`;
    whatsappMessage += `\nTotal: $${formatCOP(totals.amount_cop)} COP`;
    whatsappMessage += `\n¿Me ayudan a confirmar el pedido y el envío?`;

    res.status(200).json({ reference, whatsappMessage });
  } catch (err) {
    console.error('Error en /api/checkout:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
