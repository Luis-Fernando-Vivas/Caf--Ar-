// Backoffice: listar pedidos (GET), actualizar su estado manualmente (PATCH) y
// generar links de pago de Wompi para un cliente puntual (POST).
// Protegido por la cookie de sesión de admin -- ver api/_lib/auth.js.
//
// POST { items:[{product_id, quantity, variant}], shipping_rate_id, coupon_code,
//        customer:{name, phone, email, address}, expires_at, preview }
// crea el pedido igual que el carrito (mismos precios, envío y cupones vía
// computeTotals) y devuelve un link al Web Checkout de Wompi firmado con el
// secreto de integridad: el monto y la referencia no se pueden alterar, y el
// webhook de Wompi confirma el pago por la referencia como cualquier otro
// pedido. Vive aquí -- y no en un endpoint aparte -- para no sumar otra función
// serverless al límite de 12 de Vercel Hobby.

const crypto = require('crypto');
const { isAuthenticated } = require('../_lib/auth');
const { sql, ensureSchema, isConfigured } = require('../_lib/db');
const { computeTotals, createOrder, CheckoutError } = require('../_lib/checkout');
const { getWompiEnvironment, getWompiKeys } = require('../_lib/wompi-env');

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

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Wompi pide el celular solo con dígitos y el indicativo aparte.
function phoneDigits(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  return digits;
}

function buildWompiCheckoutUrl({ publicKey, integritySecret, reference, amountCop, expiresAt, redirectUrl, customer }) {
  const currency = 'COP';
  const amountInCents = amountCop * 100;
  // Con fecha de expiración, Wompi la exige dentro de la firma de integridad.
  const signature = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${expiresAt || ''}${integritySecret}`)
    .digest('hex');

  const params = new URLSearchParams({
    'public-key': publicKey,
    currency,
    'amount-in-cents': String(amountInCents),
    reference,
    'signature:integrity': signature,
    'redirect-url': redirectUrl,
  });
  if (expiresAt) params.set('expiration-time', expiresAt);
  if (customer.email) params.set('customer-data:email', customer.email);
  if (customer.name) params.set('customer-data:full-name', customer.name);
  const phone = phoneDigits(customer.phone);
  if (phone) {
    params.set('customer-data:phone-number', phone);
    params.set('customer-data:phone-number-prefix', '+57');
  }
  return `https://checkout.wompi.co/p/?${params.toString()}`;
}

async function createPaymentLink(req, res) {
  let body;
  try {
    body = parseBody(req);
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

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
      lines: totals.lines,
      subtotal_cop: totals.subtotal_cop,
      shipping_cop: totals.shipping_cop,
      shipping_original_cop: totals.shipping_original_cop,
      shipping_name: totals.shipping_name,
      discount_cop: totals.discount_cop,
      amount_cop: totals.amount_cop,
      free_shipping_applied: totals.free_shipping_applied,
    });
    return;
  }

  const c = body.customer || {};
  const customer = {
    name: String(c.name || '').trim().slice(0, 200),
    phone: String(c.phone || '').trim().slice(0, 40),
    email: String(c.email || '').trim().toLowerCase().slice(0, 200),
    address: String(c.address || '').trim().slice(0, 300),
  };
  if (!customer.name || !customer.phone || !customer.address) {
    res.status(400).json({ error: 'missing_customer_data', message: 'Faltan nombre, teléfono o dirección del cliente.' });
    return;
  }
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    res.status(400).json({ error: 'invalid_email', message: 'El correo del cliente no es válido.' });
    return;
  }
  if (totals.amount_cop < 1500) {
    res.status(400).json({ error: 'amount_too_low', message: 'Wompi no acepta cobros menores a $1.500 COP.' });
    return;
  }

  let expiresAt = null;
  if (body.expires_at) {
    const d = new Date(body.expires_at);
    if (Number.isNaN(d.getTime()) || d <= new Date()) {
      res.status(400).json({ error: 'invalid_expiration', message: 'La fecha de vencimiento debe ser futura.' });
      return;
    }
    expiresAt = d.toISOString();
  }

  const environment = await getWompiEnvironment();
  const { publicKey, integritySecret } = getWompiKeys(environment);
  if (!publicKey || !integritySecret) {
    res.status(503).json({
      error: 'wompi_not_configured',
      message: `Faltan las llaves de Wompi para el entorno "${environment}" en las variables de entorno.`,
    });
    return;
  }

  let order;
  try {
    order = await createOrder({
      totals,
      channel: 'wompi',
      status: 'pending',
      environment,
      shipping_rate_id: body.shipping_rate_id,
      customer,
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      res.status(400).json({ error: err.code, message: err.message });
      return;
    }
    throw err;
  }

  // La referencia la genera createOrder, así que la URL firmada se guarda en
  // un segundo paso para poder volver a copiarla desde el backoffice.
  const paymentUrl = buildWompiCheckoutUrl({
    publicKey,
    integritySecret,
    reference: order.reference,
    amountCop: totals.amount_cop,
    expiresAt,
    redirectUrl: `${siteOrigin(req)}/gracias`,
    customer,
  });
  await sql`UPDATE orders SET payment_url = ${paymentUrl} WHERE id = ${order.id}`;

  res.status(201).json({
    id: order.id,
    reference: order.reference,
    amount_cop: totals.amount_cop,
    environment,
    expires_at: expiresAt,
    payment_url: paymentUrl,
  });
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
        SELECT id, reference, channel, status, quantity, unit_price_cop, amount_cop,
               wompi_transaction_id, environment, shipping_name, shipping_cop,
               coupon_code, discount_cop, subtotal_cop, customer_name, customer_email,
               customer_phone, customer_address, payment_url, created_at, updated_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 300
      `;

      const ids = rows.map((r) => r.id);
      const items = ids.length
        ? await sql`SELECT order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop
                     FROM order_items WHERE order_id = ANY(${ids})`
        : [];
      const itemsByOrder = new Map();
      for (const it of items) {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
        itemsByOrder.get(it.order_id).push(it);
      }
      rows.forEach((r) => { r.items = itemsByOrder.get(r.id) || []; });

      res.status(200).json({ orders: rows });
      return;
    }

    if (req.method === 'POST') {
      await createPaymentLink(req, res);
      return;
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
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
