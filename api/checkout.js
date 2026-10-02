// Checkout del carrito: reemplaza a los antiguos api/wompi-signature.js y
// api/orders/whatsapp.js (que solo sabían cobrar 1 producto hardcodeado).
// POST { items:[{product_id, quantity}], shipping_rate_id, coupon_code, channel, preview }
//
// Nunca confía en precios/descuentos que mande el navegador: recalcula todo
// desde la base de datos con api/_lib/checkout.js#computeTotals, exactamente igual
// para el canal Wompi y el canal WhatsApp.
//
// preview:true (usado por carrito.html para mostrar el total en vivo) calcula
// los mismos totales pero NO crea el pedido ni gasta usos de cupón. Vive en
// este mismo archivo -- y no en uno separado -- para no gastar una función
// serverless aparte (Vercel Hobby limita a 12 por deployment).
//
// Carritos abandonados (lógica en api/_lib/abandoned-carts.js), aquí por el
// mismo motivo:
//   POST { action:'save_cart', cart_token, email, items, customer_*, ... }
//        guarda/actualiza el carrito del cliente -> { cart_token }
//   GET ?recuperar=<token>          carrito guardado, para el link del correo
//   GET ?task=abandoned-carts       envía los recordatorios (Vercel Cron, ver
//                                    vercel.json; exige "Bearer CRON_SECRET")

const crypto = require('crypto');
const { ensureSchema, isConfigured } = require('./_lib/db');
const { computeTotals, createOrder, CheckoutError } = require('./_lib/checkout');
const { getWompiEnvironment, getWompiKeys } = require('./_lib/wompi-env');
const { clientIp, isRateLimited, recordHit } = require('./_lib/rate-limit');
const {
  isValidEmail, saveCart, linkCartToOrder, getCartForRecovery, sendAbandonedCartReminders,
} = require('./_lib/abandoned-carts');

// Límites por IP: pedidos creados (evita llenar el backoffice de pedidos
// basura), intentos con cupón inválido (evita adivinar códigos por fuerza
// bruta) y guardados de carrito (el carrito se guarda en cada cambio).
const ORDER_LIMIT = { max: 10, windowMinutes: 60 };
const COUPON_FAIL_LIMIT = { max: 15, windowMinutes: 60 };
const SAVE_CART_LIMIT = { max: 120, windowMinutes: 60 };

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

async function handleGet(req, res) {
  const query = new URL(req.url, 'http://localhost').searchParams;

  if (query.get('task') === 'abandoned-carts') {
    const secret = process.env.CRON_SECRET;
    const auth = String(req.headers.authorization || '');
    const expected = `Bearer ${secret}`;
    if (!secret || auth.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const result = await sendAbandonedCartReminders();
    console.log('Recordatorios de carrito abandonado:', result);
    res.status(200).json(result);
    return;
  }

  if (query.get('recuperar')) {
    const cart = await getCartForRecovery(query.get('recuperar'));
    if (!cart) {
      res.status(404).json({ error: 'not_found', message: 'Ese carrito ya no existe.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(cart);
    return;
  }

  res.status(405).json({ error: 'Método no permitido' });
}

async function handleSaveCart(body, ip, res) {
  if (!isValidEmail(body.email)) {
    res.status(400).json({ error: 'invalid_email' });
    return;
  }
  if (await isRateLimited('save_cart', ip, SAVE_CART_LIMIT.max, SAVE_CART_LIMIT.windowMinutes)) {
    res.status(429).json({ error: 'too_many_requests' });
    return;
  }
  const token = await saveCart({
    token: body.cart_token,
    email: body.email,
    items: body.items,
    customer: { name: body.customer_name, phone: body.customer_phone, address: body.customer_address },
    shipping_rate_id: body.shipping_rate_id,
    coupon_code: body.coupon_code,
  });
  await recordHit('save_cart', ip);
  res.status(200).json({ cart_token: token });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured', message: 'Falta conectar la base de datos.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      await ensureSchema();
      await handleGet(req, res);
    } catch (err) {
      console.error('Error en GET /api/checkout:', err);
      res.status(500).json({ error: 'server_error' });
    }
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  if (body.action === 'save_cart') {
    try {
      await ensureSchema();
      await handleSaveCart(body, clientIp(req), res);
    } catch (err) {
      console.error('Error guardando carrito:', err);
      res.status(500).json({ error: 'server_error' });
    }
    return;
  }

  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'wompi';

  const customerName = String(body.customer_name || '').trim().slice(0, 200);
  const customerAddress = String(body.customer_address || '').trim().slice(0, 300);
  const customerPhone = String(body.customer_phone || '').trim().slice(0, 40);
  const customerEmail = String(body.customer_email || '').trim().toLowerCase().slice(0, 200);
  if (!body.preview && (!customerName || !customerAddress || !customerPhone || !customerEmail)) {
    res.status(400).json({ error: 'missing_customer_data', message: 'Faltan nombre, correo, dirección o teléfono del cliente.' });
    return;
  }
  if (!body.preview && !isValidEmail(customerEmail)) {
    res.status(400).json({ error: 'invalid_email', message: 'El correo electrónico no es válido.' });
    return;
  }

  try {
    await ensureSchema();
    const ip = clientIp(req);

    if (body.coupon_code && await isRateLimited('coupon_fail', ip, COUPON_FAIL_LIMIT.max, COUPON_FAIL_LIMIT.windowMinutes)) {
      res.status(429).json({
        error: 'too_many_attempts',
        message: 'Demasiados intentos con cupones inválidos. Espera un rato e inténtalo de nuevo.',
      });
      return;
    }

    let totals;
    try {
      totals = await computeTotals(body);
    } catch (err) {
      if (err instanceof CheckoutError) {
        if (err.code === 'invalid_coupon') await recordHit('coupon_fail', ip);
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

    if (await isRateLimited('order', ip, ORDER_LIMIT.max, ORDER_LIMIT.windowMinutes)) {
      res.status(429).json({
        error: 'too_many_orders',
        message: 'Has creado demasiados pedidos en poco tiempo. Espera un rato o escríbenos por WhatsApp.',
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

    let reference;
    try {
      ({ reference } = await createOrder({
        totals,
        channel,
        status: channel === 'wompi' ? 'pending' : 'whatsapp_pending',
        environment,
        shipping_rate_id: body.shipping_rate_id,
        customer: { name: customerName, address: customerAddress, phone: customerPhone, email: customerEmail },
      }));
    } catch (err) {
      if (err instanceof CheckoutError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
    await recordHit('order', ip);
    await linkCartToOrder(body.cart_token, reference);

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
    whatsappMessage += `\nCorreo: ${customerEmail}`;
    whatsappMessage += `\n¿Me ayudan a confirmar el pedido y el envío?`;

    res.status(200).json({ reference, whatsappMessage });
  } catch (err) {
    console.error('Error en /api/checkout:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
