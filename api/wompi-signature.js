// Vercel Serverless Function: firma de integridad para Wompi Web Checkout.
// Vercel detecta automáticamente cualquier archivo en /api como un endpoint
// en https://tu-sitio.vercel.app/api/wompi-signature — no requiere configuración extra.
//
// Por qué existe este archivo:
// Wompi exige una "firma de integridad" (SHA256 de referencia + monto + moneda + llave secreta)
// para evitar que alguien manipule el monto a pagar antes de llegar al checkout. Esa llave secreta
// (WOMPI_INTEGRITY_SECRET) NUNCA puede ir en el HTML/JS del sitio porque cualquiera puede leerla
// con "Ver código fuente". Por eso el cálculo se hace aquí, en el servidor, donde la llave vive
// solo como variable de entorno.
//
// Variables de entorno requeridas (Vercel -> Project Settings -> Environment Variables):
//   WOMPI_PUBLIC_KEY        pub_test_... o pub_prod_...  (esta sí es pública, va al checkout)
//   WOMPI_INTEGRITY_SECRET  la "llave de integridad" del dashboard de Wompi (SECRETA)

const crypto = require('crypto');
const { sql, ensureSchema } = require('../lib/db');

const UNIT_PRICE_COP = 50000; // Café Arú Honey 500g

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;

  if (!publicKey || !integritySecret) {
    res.status(503).json({
      error: 'wompi_not_configured',
      message: 'Faltan WOMPI_PUBLIC_KEY y/o WOMPI_INTEGRITY_SECRET en las variables de entorno de Vercel.',
    });
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

  const currency = 'COP';
  const amountInCents = quantity * UNIT_PRICE_COP * 100;
  const reference = `ARU-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const signature = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest('hex');

  // Guardamos el pedido como "pending" ANTES de mandar al cliente a pagar, así queda
  // registrado en el backoffice incluso si nunca vuelve del checkout de Wompi.
  // Si la base de datos falla, no bloqueamos el cobro -- solo lo dejamos sin registrar.
  try {
    await ensureSchema();
    await sql`
      INSERT INTO orders (reference, channel, status, quantity, unit_price_cop, amount_cop)
      VALUES (${reference}, 'wompi', 'pending', ${quantity}, ${UNIT_PRICE_COP}, ${quantity * UNIT_PRICE_COP})
    `;
  } catch (err) {
    console.error('No se pudo registrar el pedido en la base de datos:', err);
  }

  res.status(200).json({ publicKey, currency, amountInCents, reference, signature });
};
