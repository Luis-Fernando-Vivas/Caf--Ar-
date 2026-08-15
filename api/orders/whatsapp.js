// Registra en el backoffice un pedido que el cliente hizo por WhatsApp
// (no hay pasarela de pago de por medio, así que queda "pendiente" hasta que
// alguien del equipo lo confirme manualmente desde el panel de administración).
//
// El front-end llama este endpoint justo antes de abrir el chat de WhatsApp.
// Si falla (ej. base de datos aún no configurada), no debe romper el flujo de
// compra -- por eso js/main.js lo dispara sin bloquear la apertura de WhatsApp.

const { sql, ensureSchema } = require('../../lib/db');

const UNIT_PRICE_COP = 50000; // Café Arú Honey 500g

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  let quantity = 1;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    quantity = Math.max(1, Math.min(20, parseInt(body.quantity, 10) || 1));
  } catch {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }

  const amountCop = quantity * UNIT_PRICE_COP;
  const reference = `ARU-WA-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  try {
    await ensureSchema();
    await sql`
      INSERT INTO orders (reference, channel, status, quantity, unit_price_cop, amount_cop)
      VALUES (${reference}, 'whatsapp', 'whatsapp_pending', ${quantity}, ${UNIT_PRICE_COP}, ${amountCop})
    `;
  } catch (err) {
    console.error('No se pudo registrar el pedido de WhatsApp:', err);
  }

  res.status(200).json({ reference });
};
