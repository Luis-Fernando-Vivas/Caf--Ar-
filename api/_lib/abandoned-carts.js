// Carritos abandonados.
//
// carrito.html guarda una copia del carrito en la tabla "carts" en cuanto el
// cliente escribe un correo válido (y la actualiza con cada cambio). Al
// finalizar la compra, api/checkout.js enlaza ese carrito con la referencia
// del pedido creado.
//
// Una vez al día (Vercel Cron -> GET /api/checkout?task=abandoned-carts, ver
// vercel.json) se envía UN recordatorio por carrito a quien:
//   - lleve más de ABANDON_AFTER_HOURS sin tocar el carrito (y menos de
//     MAX_AGE_DAYS, para no escribirle a alguien de hace semanas),
//   - no haya creado un pedido desde ese carrito, o lo creó pero el pago de
//     Wompi quedó pendiente/rechazado/anulado,
//   - y no tenga otro pedido pagado (o de WhatsApp) con ese correo desde que
//     armó el carrito.
// El correo trae un link /carrito?recuperar=<token> que vuelve a llenar el
// carrito y los datos de envío tal como los dejó.

const crypto = require('crypto');
const { sql } = require('./db');
const { sendAbandonedCartReminder, SITE_URL } = require('./notify');

const ABANDON_AFTER_HOURS = 2;
const MAX_AGE_DAYS = 7;
const MAX_REMINDERS_PER_RUN = 50;

// Estados de pedido que NO cuentan como compra hecha.
const UNPAID_STATUSES = ['pending', 'declined', 'voided', 'error'];
// Estados que sí cuentan (pagado, o coordinado por WhatsApp).
const CONVERTED_STATUSES = ['approved', 'paid_manually', 'shipped', 'whatsapp_pending'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;

function isValidEmail(email) {
  return EMAIL_RE.test(String(email || ''));
}

function isValidToken(token) {
  return TOKEN_RE.test(String(token || ''));
}

// Solo guarda lo mínimo para reconstruir el carrito: precios y nombres se
// vuelven a leer de la BD al recuperarlo.
function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 20)
    .map((it) => ({
      product_id: parseInt(it && it.product_id, 10),
      quantity: Math.max(1, Math.min(20, parseInt(it && it.quantity, 10) || 1)),
      variant: typeof (it && it.variant) === 'string' ? it.variant.slice(0, 60) : null,
    }))
    .filter((it) => it.product_id > 0);
}

// Crea o actualiza el carrito del token dado. Devuelve el token (uno nuevo si
// no venía o no existía).
async function saveCart({ token, email, items, customer = {}, shipping_rate_id, coupon_code }) {
  const cleanItems = JSON.stringify(sanitizeItems(items));
  const fields = {
    email: String(email).trim().toLowerCase().slice(0, 200),
    name: String(customer.name || '').trim().slice(0, 200) || null,
    phone: String(customer.phone || '').trim().slice(0, 40) || null,
    address: String(customer.address || '').trim().slice(0, 300) || null,
    shippingRateId: parseInt(shipping_rate_id, 10) || null,
    coupon: String(coupon_code || '').trim().toUpperCase().slice(0, 60) || null,
  };

  if (isValidToken(token)) {
    const updated = await sql`
      UPDATE carts
      SET email = ${fields.email}, customer_name = ${fields.name}, customer_phone = ${fields.phone},
          customer_address = ${fields.address}, items = ${cleanItems}::jsonb,
          shipping_rate_id = ${fields.shippingRateId}, coupon_code = ${fields.coupon}, updated_at = now()
      WHERE token = ${token}
      RETURNING token
    `;
    if (updated.length) return token;
  }

  const newToken = crypto.randomBytes(16).toString('hex');
  await sql`
    INSERT INTO carts (token, email, customer_name, customer_phone, customer_address, items, shipping_rate_id, coupon_code)
    VALUES (${newToken}, ${fields.email}, ${fields.name}, ${fields.phone}, ${fields.address},
            ${cleanItems}::jsonb, ${fields.shippingRateId}, ${fields.coupon})
  `;
  return newToken;
}

async function linkCartToOrder(token, reference) {
  if (!isValidToken(token)) return;
  await sql`UPDATE carts SET order_reference = ${reference}, updated_at = now() WHERE token = ${token}`;
}

// Líneas del carrito con los datos actuales de cada producto (solo activos).
async function cartLines(items) {
  const ids = items.map((it) => it.product_id);
  if (!ids.length) return [];
  const products = await sql`
    SELECT id, slug, name, price_cop, images FROM products WHERE id = ANY(${ids}) AND status = 'active'
  `;
  const byId = new Map(products.map((p) => [p.id, p]));
  return items
    .filter((it) => byId.has(it.product_id))
    .map((it) => {
      const p = byId.get(it.product_id);
      return {
        product_id: p.id,
        slug: p.slug,
        name: p.name,
        price_cop: p.price_cop,
        image: p.images && p.images[0] ? p.images[0].url : '',
        variant: it.variant || null,
        quantity: it.quantity,
      };
    });
}

// Datos para volver a llenar carrito.html desde el link del correo.
async function getCartForRecovery(token) {
  if (!isValidToken(token)) return null;
  const rows = await sql`SELECT * FROM carts WHERE token = ${token}`;
  if (!rows.length) return null;
  const cart = rows[0];
  return {
    token: cart.token,
    items: await cartLines(cart.items || []),
    email: cart.email,
    customer_name: cart.customer_name,
    customer_phone: cart.customer_phone,
    customer_address: cart.customer_address,
    shipping_rate_id: cart.shipping_rate_id,
    coupon_code: cart.coupon_code,
  };
}

async function sendAbandonedCartReminders() {
  const carts = await sql`
    SELECT c.*
    FROM carts c
    WHERE c.reminder_sent_at IS NULL
      AND c.updated_at < now() - make_interval(hours => ${ABANDON_AFTER_HOURS})
      AND c.updated_at > now() - make_interval(days => ${MAX_AGE_DAYS})
      AND jsonb_array_length(c.items) > 0
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.reference = c.order_reference AND NOT (o.status = ANY(${UNPAID_STATUSES}))
      )
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE lower(o.customer_email) = c.email
          AND o.created_at >= c.created_at
          AND o.status = ANY(${CONVERTED_STATUSES})
      )
    ORDER BY c.updated_at ASC
    LIMIT ${MAX_REMINDERS_PER_RUN}
  `;

  let sent = 0;
  for (const cart of carts) {
    // Se marca antes de enviar: si el cron se solapa o reintenta, nadie recibe
    // dos recordatorios del mismo carrito.
    const claimed = await sql`
      UPDATE carts SET reminder_sent_at = now() WHERE id = ${cart.id} AND reminder_sent_at IS NULL RETURNING id
    `;
    if (!claimed.length) continue;

    const lines = (await cartLines(cart.items || [])).map((l) => ({
      product_name: l.variant ? `${l.name} — ${l.variant}` : l.name,
      quantity: l.quantity,
      line_total_cop: l.price_cop * l.quantity,
    }));
    if (!lines.length) continue; // los productos ya no están disponibles

    try {
      if (await sendAbandonedCartReminder(cart, lines, `${SITE_URL}/carrito?recuperar=${cart.token}`)) sent += 1;
    } catch (err) {
      console.error(`Error enviando recordatorio de carrito ${cart.id}:`, err);
    }
  }
  return { candidates: carts.length, sent };
}

module.exports = {
  isValidEmail,
  saveCart,
  linkCartToOrder,
  getCartForRecovery,
  sendAbandonedCartReminders,
};
