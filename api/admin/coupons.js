// Backoffice: CRUD de cupones de descuento.
// GET / POST {code,discount_type,discount_value,min_order_cop,usage_limit,expires_at,is_active}
// PATCH {id,...} / DELETE ?id=

const { isAuthenticated } = require('../_lib/auth');
const { sql, ensureSchema, isConfigured } = require('../_lib/db');

const DISCOUNT_TYPES = ['percent', 'fixed'];

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function normalize(body, { partial } = {}) {
  const out = {};

  if (!partial || body.code !== undefined) {
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) throw new Error('El código es obligatorio.');
    out.code = code;
  }

  if (!partial || body.discount_type !== undefined) {
    const type = String(body.discount_type || '');
    if (!DISCOUNT_TYPES.includes(type)) throw new Error('El tipo de descuento debe ser "percent" o "fixed".');
    out.discount_type = type;
  }

  if (!partial || body.discount_value !== undefined) {
    const value = parseInt(body.discount_value, 10);
    const type = out.discount_type || body.discount_type;
    if (!Number.isFinite(value) || value <= 0) throw new Error('El valor del descuento debe ser positivo.');
    if (type === 'percent' && value > 100) throw new Error('Un descuento porcentual no puede ser mayor a 100.');
    out.discount_value = value;
  }

  if (!partial || body.min_order_cop !== undefined) {
    out.min_order_cop = parseInt(body.min_order_cop, 10) || 0;
  }

  if (!partial || body.usage_limit !== undefined) {
    const raw = body.usage_limit;
    out.usage_limit = raw === null || raw === '' || raw === undefined ? null : parseInt(raw, 10);
  }

  if (!partial || body.expires_at !== undefined) {
    const raw = body.expires_at;
    out.expires_at = raw ? new Date(raw).toISOString() : null;
  }

  if (!partial || body.is_active !== undefined) {
    out.is_active = body.is_active === undefined ? true : Boolean(body.is_active);
  }

  return out;
}

module.exports = async (req, res) => {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!isConfigured) {
    res.status(503).json({ error: 'db_not_configured' });
    return;
  }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM coupons ORDER BY created_at DESC`;
      res.status(200).json({ coupons: rows });
      return;
    }

    if (req.method === 'POST') {
      let data;
      try {
        data = normalize(parseBody(req));
      } catch (err) {
        res.status(400).json({ error: 'invalid_input', message: err.message });
        return;
      }
      try {
        const rows = await sql`
          INSERT INTO coupons (code, discount_type, discount_value, min_order_cop, usage_limit, expires_at, is_active)
          VALUES (${data.code}, ${data.discount_type}, ${data.discount_value}, ${data.min_order_cop ?? 0},
                  ${data.usage_limit ?? null}, ${data.expires_at ?? null}, ${data.is_active ?? true})
          RETURNING *
        `;
        res.status(201).json({ coupon: rows[0] });
      } catch (err) {
        if (String(err.message || '').includes('duplicate key')) {
          res.status(409).json({ error: 'code_taken', message: 'Ya existe un cupón con ese código.' });
          return;
        }
        throw err;
      }
      return;
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const id = parseInt(body.id, 10);
      if (!id) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }
      let data;
      try {
        data = normalize(body, { partial: true });
      } catch (err) {
        res.status(400).json({ error: 'invalid_input', message: err.message });
        return;
      }
      const rows = await sql`
        UPDATE coupons SET
          code = COALESCE(${data.code ?? null}, code),
          discount_type = COALESCE(${data.discount_type ?? null}, discount_type),
          discount_value = COALESCE(${data.discount_value ?? null}, discount_value),
          min_order_cop = COALESCE(${data.min_order_cop ?? null}, min_order_cop),
          usage_limit = CASE WHEN ${data.usage_limit === undefined} THEN usage_limit ELSE ${data.usage_limit ?? null} END,
          expires_at = CASE WHEN ${data.expires_at === undefined} THEN expires_at ELSE ${data.expires_at ?? null} END,
          is_active = COALESCE(${data.is_active ?? null}, is_active),
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows.length) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ coupon: rows[0] });
      return;
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://localhost');
      const id = parseInt(url.searchParams.get('id'), 10);
      if (!id) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }
      await sql`DELETE FROM coupons WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('Error en /api/admin/coupons:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
