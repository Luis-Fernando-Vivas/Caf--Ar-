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
//
// POST { manual:true, items, shipping_rate_id, coupon_code, customer, status, send_email }
// registra un pedido que llegó por fuera de la página (WhatsApp, en persona...)
// con los mismos totales que el carrito, y envía los correos de notificación
// al negocio y al cliente igual que el webhook de Wompi con un pago aprobado.
//
// PATCH { id, status:'shipped', shipping_carrier, tracking_number, tracking_url, send_email }
// marca el pedido como enviado guardando transportadora y guía, y (salvo
// send_email:false) le manda al cliente el correo de "tu pedido va en camino".
//
// Reporte de ingresos y costos (/admin/reports) -- lógica en api/_lib/reports.js:
//   GET ?view=report&from=YYYY-MM-DD&to=YYYY-MM-DD   pedidos pagados + gastos
//   PATCH { id, shipping_cost_cop }                   costo real del envío
//   POST { resource:'expense', day, category, amount_cop, note }   nuevo gasto
//   DELETE ?expense_id=N                              borra un gasto
//   POST { resource:'wompi_fee', percent, fixed_cop, vat_percent }  comisión de Wompi

const crypto = require('crypto');
const { isAuthenticated } = require('../_lib/auth');
const { sql, ensureSchema, isConfigured } = require('../_lib/db');
const { computeTotals, createOrder, CheckoutError } = require('../_lib/checkout');
const { getWompiEnvironment, getWompiKeys } = require('../_lib/wompi-env');
const {
  sendAdminOrderNotification, sendCustomerOrderConfirmation, sendOrderShippedNotification,
} = require('../_lib/notify');
const { getReportData, createExpense, deleteExpense, setShippingCost, setWompiFee, ReportError } = require('../_lib/reports');

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

// Estados con los que se puede registrar un pedido manual.
const MANUAL_STATUSES = ['paid_manually', 'whatsapp_pending'];

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

// Valida los datos del cliente que llegan del formulario del backoffice. Si
// algo falta responde 400 y devuelve null.
function parseCustomer(body, res) {
  const c = body.customer || {};
  const customer = {
    name: String(c.name || '').trim().slice(0, 200),
    phone: String(c.phone || '').trim().slice(0, 40),
    email: String(c.email || '').trim().toLowerCase().slice(0, 200),
    address: String(c.address || '').trim().slice(0, 300),
  };
  if (!customer.name || !customer.phone || !customer.address) {
    res.status(400).json({ error: 'missing_customer_data', message: 'Faltan nombre, teléfono o dirección del cliente.' });
    return null;
  }
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    res.status(400).json({ error: 'invalid_email', message: 'El correo del cliente no es válido.' });
    return null;
  }
  return customer;
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

  const customer = parseCustomer(body, res);
  if (!customer) return;
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

async function createManualOrder(body, res) {
  const customer = parseCustomer(body, res);
  if (!customer) return;
  const status = MANUAL_STATUSES.includes(body.status) ? body.status : 'paid_manually';

  let order;
  try {
    const totals = await computeTotals(body);
    order = await createOrder({
      totals,
      channel: 'whatsapp',
      status,
      environment: 'prod',
      shipping_rate_id: body.shipping_rate_id,
      customer,
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      res.status(400).json({ error: err.code, message: err.message, ...err.extra });
      return;
    }
    throw err;
  }

  // Mismos correos que manda el webhook de Wompi con un pago aprobado. Se
  // esperan antes de responder: la función serverless se congela al responder.
  let emailed = false;
  if (body.send_email !== false) {
    const [saved] = await sql`SELECT * FROM orders WHERE id = ${order.id}`;
    const items = await sql`SELECT * FROM order_items WHERE order_id = ${order.id}`;
    await sql`UPDATE orders SET notified_at = now() WHERE id = ${order.id}`;
    await Promise.all([
      sendAdminOrderNotification(saved, items).catch((err) =>
        console.error('Error enviando notificación de pedido manual al admin:', err)
      ),
      sendCustomerOrderConfirmation(saved, items).catch((err) =>
        console.error('Error enviando confirmación de pedido manual al cliente:', err)
      ),
    ]);
    emailed = true;
  }

  res.status(201).json({ id: order.id, reference: order.reference, status, emailed });
}

async function markShipped(id, body, res) {
  const carrier = String(body.shipping_carrier || '').trim().slice(0, 80);
  const trackingNumber = String(body.tracking_number || '').trim().slice(0, 80);
  const trackingUrl = String(body.tracking_url || '').trim().slice(0, 500);
  if (!carrier || !trackingNumber) {
    res.status(400).json({ error: 'missing_tracking', message: 'Indica la transportadora y el número de guía.' });
    return;
  }
  if (trackingUrl && !/^https?:\/\/\S+$/i.test(trackingUrl)) {
    res.status(400).json({ error: 'invalid_tracking_url', message: 'El link de rastreo debe empezar por http:// o https://.' });
    return;
  }

  const rows = await sql`
    UPDATE orders
    SET status = 'shipped', shipping_carrier = ${carrier}, tracking_number = ${trackingNumber},
        tracking_url = ${trackingUrl || null}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  if (!rows.length) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const order = rows[0];

  // Se espera antes de responder: la función serverless se congela al responder.
  let emailed = false;
  if (body.send_email !== false && order.customer_email) {
    const items = await sql`SELECT * FROM order_items WHERE order_id = ${order.id}`;
    try {
      emailed = await sendOrderShippedNotification(order, items);
      if (emailed) await sql`UPDATE orders SET shipped_notified_at = now() WHERE id = ${order.id}`;
    } catch (err) {
      console.error('Error enviando aviso de despacho al cliente:', err);
    }
  }

  res.status(200).json({ ok: true, emailed });
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

    const query = new URL(req.url, 'http://localhost').searchParams;

    if (req.method === 'GET' && query.get('view') === 'report') {
      const data = await getReportData({ from: query.get('from'), to: query.get('to') });
      res.status(200).json(data);
      return;
    }

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, reference, channel, status, quantity, unit_price_cop, amount_cop,
               wompi_transaction_id, environment, shipping_name, shipping_cop,
               coupon_code, discount_cop, subtotal_cop, customer_name, customer_email,
               customer_phone, customer_address, payment_url, shipping_cost_cop,
               shipping_carrier, tracking_number, tracking_url, shipped_notified_at,
               created_at, updated_at
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
      let body = null;
      try { body = parseBody(req); } catch {}
      if (body && body.resource === 'expense') {
        const expense = await createExpense(body);
        res.status(201).json({ expense });
        return;
      }
      if (body && body.resource === 'wompi_fee') {
        const wompiFee = await setWompiFee(body);
        res.status(200).json({ wompi_fee: wompiFee });
        return;
      }
      if (body && body.manual && !body.preview) {
        await createManualOrder(body, res);
        return;
      }
      await createPaymentLink(req, res);
      return;
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const id = parseInt(body.id, 10);

      if (id && body.shipping_cost_cop !== undefined) {
        await setShippingCost(id, body.shipping_cost_cop);
        res.status(200).json({ ok: true });
        return;
      }

      const status = String(body.status || '');
      if (!id || !ALLOWED_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }

      if (status === 'shipped') {
        await markShipped(id, body, res);
        return;
      }

      await sql`UPDATE orders SET status = ${status}, updated_at = now() WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE' && query.get('expense_id')) {
      await deleteExpense(query.get('expense_id'));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    if (err instanceof ReportError) {
      res.status(400).json({ error: 'invalid_input', message: err.message });
      return;
    }
    console.error('Error en /api/admin/orders:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
