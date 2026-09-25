// Regla de envío gratis: "a partir de tantos productos" y/o "a partir de tal
// monto" el envío queda en $0, sin importar la tarifa elegida. Se guarda en
// la tabla genérica `settings` (mismo patrón que lib/wompi-env.js) para no
// gastar una tabla ni una función serverless aparte.

const { sql, ensureSchema, isConfigured } = require('./db');

const SETTING_KEY = 'free_shipping_rule';
const DEFAULT_RULE = { enabled: false, min_quantity: null, min_subtotal_cop: null };

function normalize(raw) {
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  const min_quantity =
    Number.isFinite(parsed.min_quantity) && parsed.min_quantity > 0 ? Math.floor(parsed.min_quantity) : null;
  const min_subtotal_cop =
    Number.isFinite(parsed.min_subtotal_cop) && parsed.min_subtotal_cop > 0
      ? Math.floor(parsed.min_subtotal_cop)
      : null;
  return {
    enabled: Boolean(parsed.enabled) && (min_quantity !== null || min_subtotal_cop !== null),
    min_quantity,
    min_subtotal_cop,
  };
}

async function getFreeShippingRule() {
  if (!isConfigured) return DEFAULT_RULE;
  await ensureSchema();
  const rows = await sql`SELECT value FROM settings WHERE key = ${SETTING_KEY}`;
  return normalize(rows[0]?.value);
}

async function setFreeShippingRule(input) {
  if (!isConfigured) {
    throw new Error('Base de datos no configurada: no se puede guardar la regla de envío gratis.');
  }
  await ensureSchema();

  const toIntOrNull = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  const min_quantity = toIntOrNull(input.min_quantity);
  const min_subtotal_cop = toIntOrNull(input.min_subtotal_cop);
  if (Number.isNaN(min_quantity) || (min_quantity !== null && min_quantity <= 0)) {
    throw new Error('La cantidad mínima debe ser un número mayor a 0.');
  }
  if (Number.isNaN(min_subtotal_cop) || (min_subtotal_cop !== null && min_subtotal_cop <= 0)) {
    throw new Error('El monto mínimo debe ser un número mayor a 0.');
  }

  const enabled = Boolean(input.enabled);
  if (enabled && min_quantity === null && min_subtotal_cop === null) {
    throw new Error('Define al menos una condición (cantidad o monto mínimo) para activar el envío gratis.');
  }

  const value = JSON.stringify({ enabled, min_quantity, min_subtotal_cop });
  await sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${SETTING_KEY}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `;
  return normalize(value);
}

// La regla se cumple si se alcanza CUALQUIERA de las condiciones definidas
// (la que esté activa; una regla puede dejar la otra en null).
function appliesFreeShipping(rule, { quantity, subtotal_cop }) {
  if (!rule || !rule.enabled) return false;
  if (rule.min_quantity !== null && quantity >= rule.min_quantity) return true;
  if (rule.min_subtotal_cop !== null && subtotal_cop >= rule.min_subtotal_cop) return true;
  return false;
}

module.exports = { getFreeShippingRule, setFreeShippingRule, appliesFreeShipping, DEFAULT_RULE };
