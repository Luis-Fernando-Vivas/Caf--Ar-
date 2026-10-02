// Reporte de ingresos y costos para /admin/reports, y registro de gastos
// diarios (pauta/anuncios y otros). Se expone a través de api/admin/orders.js
// -- no en un endpoint propio -- porque el proyecto ya usa las 12 funciones
// serverless que permite Vercel Hobby.
//
// Los días se cuentan en hora de Colombia (America/Bogota), no en UTC: un
// pedido de las 9 p.m. pertenece a ese día, no al siguiente.

const { sql } = require('./db');

const TIME_ZONE = 'America/Bogota';
// Los pagados suman a los ingresos; los de WhatsApp pendientes de pago se
// listan en su día (para poder anotarles el envío) pero no suman ingresos.
const REPORT_STATUSES = ['approved', 'paid_manually', 'shipped', 'whatsapp_pending'];
const EXPENSE_CATEGORIES = ['ads', 'other'];
const MAX_RANGE_DAYS = 400;

// Comisión de Wompi por transacción aprobada: porcentaje + valor fijo, y el
// IVA se cobra sobre esa comisión. Por defecto, la tarifa estándar de Wompi
// Colombia; se edita desde /admin/reports si el contrato es distinto. Se
// guarda en la tabla genérica `settings` (mismo patrón que shipping-rule.js).
const WOMPI_FEE_KEY = 'wompi_fee';
const DEFAULT_WOMPI_FEE = { percent: 2.65, fixed_cop: 700, vat_percent: 19 };

class ReportError extends Error {}

function normalizeWompiFee(raw) {
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  const pick = (key) => (Number.isFinite(parsed[key]) && parsed[key] >= 0 ? parsed[key] : DEFAULT_WOMPI_FEE[key]);
  return { percent: pick('percent'), fixed_cop: pick('fixed_cop'), vat_percent: pick('vat_percent') };
}

async function getWompiFee() {
  const rows = await sql`SELECT value FROM settings WHERE key = ${WOMPI_FEE_KEY}`;
  return normalizeWompiFee(rows[0]?.value);
}

async function setWompiFee(body) {
  const percent = Number(body.percent);
  const fixed = Number(body.fixed_cop);
  const vat = Number(body.vat_percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 20) throw new ReportError('El porcentaje debe estar entre 0 y 20.');
  if (!Number.isFinite(fixed) || fixed < 0 || fixed > 100000) throw new ReportError('El valor fijo no es válido.');
  if (!Number.isFinite(vat) || vat < 0 || vat > 50) throw new ReportError('El IVA debe estar entre 0 y 50.');

  const value = JSON.stringify({ percent, fixed_cop: Math.round(fixed), vat_percent: vat });
  await sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${WOMPI_FEE_KEY}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `;
  return normalizeWompiFee(value);
}

function parseDay(value, label) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new ReportError(`La fecha ${label} no es válida.`);
  }
  return s;
}

function parseAmount(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new ReportError(`${label} debe ser un número mayor o igual a 0.`);
  return Math.round(n);
}

// Pedidos (sin los de Wompi en modo Prueba, que no son dinero real) y gastos
// dentro del rango. El navegador agrupa por día/semana/mes y filtra
// por canal, así un mismo pedido de datos sirve para cualquier informe.
async function getReportData({ from, to }) {
  from = parseDay(from, 'inicial');
  to = parseDay(to, 'final');
  if (from > to) throw new ReportError('La fecha inicial debe ser anterior a la final.');
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  if (days > MAX_RANGE_DAYS) throw new ReportError(`El rango no puede pasar de ${MAX_RANGE_DAYS} días.`);

  const orders = await sql`
    SELECT id, reference, channel, status, quantity, amount_cop, subtotal_cop, shipping_cop,
           shipping_name, discount_cop, shipping_cost_cop, customer_name, customer_address,
           created_at,
           to_char(created_at AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day
    FROM orders
    WHERE status = ANY(${REPORT_STATUSES})
      AND NOT (channel = 'wompi' AND environment = 'test')
      AND created_at >= (${from}::date)::timestamp AT TIME ZONE ${TIME_ZONE}
      AND created_at < (${to}::date + 1)::timestamp AT TIME ZONE ${TIME_ZONE}
    ORDER BY created_at ASC
  `;

  const expenses = await sql`
    SELECT id, to_char(spent_on, 'YYYY-MM-DD') AS day, category, amount_cop, note, created_at
    FROM expenses
    WHERE spent_on BETWEEN ${from}::date AND ${to}::date
    ORDER BY spent_on ASC, id ASC
  `;

  return { from, to, orders, expenses, wompi_fee: await getWompiFee() };
}

async function createExpense(body) {
  const day = parseDay(body.day, 'del gasto');
  const category = EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'ads';
  const amount = parseAmount(body.amount_cop, 'El monto');
  if (!amount) throw new ReportError('El monto debe ser mayor a 0.');
  const note = String(body.note || '').trim().slice(0, 300);

  const rows = await sql`
    INSERT INTO expenses (spent_on, category, amount_cop, note)
    VALUES (${day}::date, ${category}, ${amount}, ${note})
    RETURNING id, to_char(spent_on, 'YYYY-MM-DD') AS day, category, amount_cop, note, created_at
  `;
  return rows[0];
}

async function deleteExpense(id) {
  const expenseId = parseInt(id, 10);
  if (!expenseId) throw new ReportError('Gasto inválido.');
  await sql`DELETE FROM expenses WHERE id = ${expenseId}`;
}

// null borra el costo (vuelve a "sin registrar"); 0 es un envío que no costó.
async function setShippingCost(id, value) {
  const orderId = parseInt(id, 10);
  if (!orderId) throw new ReportError('Pedido inválido.');
  const cost = value === null || value === '' ? null : parseAmount(value, 'El costo de envío');
  await sql`UPDATE orders SET shipping_cost_cop = ${cost}, updated_at = now() WHERE id = ${orderId}`;
}

module.exports = { getReportData, createExpense, deleteExpense, setShippingCost, setWompiFee, ReportError };
