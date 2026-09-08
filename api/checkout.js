// Checkout del carrito: reemplaza a los antiguos api/wompi-signature.js y
// api/orders/whatsapp.js (que solo sabían cobrar 1 producto hardcodeado).
// POST { items:[{product_id, quantity}], shipping_rate_id, coupon_code, channel, preview }
//
// Nunca confía en precios/descuentos que mande el navegador: recalcula todo
// desde la base de datos con lib/checkout.js#computeTotals, exactamente igual
// para el canal Wompi y el canal WhatsApp.
//
// preview:true (usado por carrito.html para mostrar el total en vivo) calcula
// los mismos totales pero NO crea el pedido ni gasta usos de cupón. Vive en
// este mismo archivo -- y no en uno separado -- para no gastar una función
// serverless aparte (Vercel Hobby limita a 12 por deployment).

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

  const customerName = String(body.customer_name || '').trim().slice(0, 200);
  const customerAddress = String(body.customer_address || '').trim().slice(0, 300);
  const customerPhone = String(body.customer_phone || '').trim().slice(0, 40);
  if (!body.preview && (!customerName || !customerAddress || !customerPhone)) {
    res.status(400).json({ error: 'missing_customer_data', message: 'Faltan nombre, dirección o teléfono del cliente.' });
    return;
  }

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

    if (body.preview) {
      res.status(200).json({
        subtotal_cop: totals.subtotal_cop,
        total_quantity: totals.total_quantity,
        shipping_cop: totals.shipping_cop,
        shipping_original_cop: totals.shipping_original_cop,
        shipping_name: totals.shipping_name,
        discount_cop: totals.discount_cop,
        amount_cop: totals.amount_cop,
        free_shipping_applied: totals.free_shipping_applied,
        free_shipping_rule: totals.free_shipping_rule,
      });
      return;
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
        shipping_rate_id, shipping_name, shipping_cop, coupon_code, discount_cop, subtotal_cop,
        customer_name, customer_address, customer_phone
      )
      VALUES (
        ${reference}, ${channel}, ${status}, ${totalQuantity}, 0, ${totals.amount_cop}, ${environment || 'prod'},
        ${body.shipping_rate_id || null}, ${totals.shipping_name}, ${totals.shipping_cop},
        ${totals.coupon ? totals.coupon.code : null}, ${totals.discount_cop}, ${totals.subtotal_cop},
        ${customerName || null}, ${customerAddress || null}, ${customerPhone || null}
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
    whatsappMessage += `\n\nNombre: ${customerName}`;
    whatsappMessage += `\nDirección: ${customerAddress}`;
    whatsappMessage += `\nTeléfono: ${customerPhone}`;
    whatsappMessage += `\n¿Me ayudan a confirmar el pedido y el envío?`;

    res.status(200).json({ reference, whatsappMessage });
  } catch (err) {
    console.error('Error en /api/checkout:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
