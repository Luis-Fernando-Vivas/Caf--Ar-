// Backoffice: CRUD de tarifas de envío.
// GET / POST {name,amount_cop,is_active,sort_order} / PATCH {id,...} / DELETE ?id=
// Borrar una tarifa nunca rompe pedidos viejos: el nombre y el monto quedan
// guardados directamente en orders.shipping_name/shipping_cop al momento del checkout.

const { isAuthenticated } = require('../../lib/auth');
const { sql, ensureSchema, isConfigured } = require('../../lib/db');
const { getFreeShippingRule, setFreeShippingRule } = require('../../lib/shipping-rule');

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function normalize(body, { partial } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) throw new Error('El nombre es obligatorio.');
    out.name = name;
  }
  if (!partial || body.amount_cop !== undefined) {
    const amount = parseInt(body.amount_cop, 10);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('El costo debe ser un número >= 0.');
    out.amount_cop = amount;
  }
  if (!partial || body.is_active !== undefined) {
    out.is_active = body.is_active === undefined ? true : Boolean(body.is_active);
  }
  if (!partial || body.sort_order !== undefined) {
    out.sort_order = parseInt(body.sort_order, 10) || 0;
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
      const rows = await sql`SELECT * FROM shipping_rates ORDER BY sort_order ASC, id ASC`;
      const free_shipping_rule = await getFreeShippingRule();
      res.status(200).json({ rates: rows, free_shipping_rule });
      return;
    }

    // La regla de envío gratis vive en la misma función (y no en un endpoint
    // aparte) para no sumar otra función serverless al límite de Vercel Hobby.
    if (req.method === 'PUT') {
      const body = parseBody(req);
      try {
        const rule = await setFreeShippingRule(body);
        res.status(200).json({ free_shipping_rule: rule });
      } catch (err) {
        res.status(400).json({ error: 'invalid_input', message: err.message });
      }
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
      const rows = await sql`
        INSERT INTO shipping_rates (name, amount_cop, is_active, sort_order)
        VALUES (${data.name}, ${data.amount_cop}, ${data.is_active ?? true}, ${data.sort_order ?? 0})
        RETURNING *
      `;
      res.status(201).json({ rate: rows[0] });
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
        UPDATE shipping_rates SET
          name = COALESCE(${data.name ?? null}, name),
          amount_cop = COALESCE(${data.amount_cop ?? null}, amount_cop),
          is_active = COALESCE(${data.is_active ?? null}, is_active),
          sort_order = COALESCE(${data.sort_order ?? null}, sort_order),
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows.length) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ rate: rows[0] });
      return;
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://localhost');
      const id = parseInt(url.searchParams.get('id'), 10);
      if (!id) {
        res.status(400).json({ error: 'invalid_input' });
        return;
      }
      await sql`DELETE FROM shipping_rates WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('Error en /api/admin/shipping-rates:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
