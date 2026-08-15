// Webhook de Wompi ("eventos"): confirma automáticamente el estado real del pago
// y actualiza el pedido correspondiente (buscado por su "reference").
//
// Configúralo en el dashboard de Wompi -> Configuración -> Eventos, apuntando a:
//   https://tu-sitio.vercel.app/api/webhooks/wompi
// y copia el "Secreto de eventos" (distinto de la llave de integridad) en la
// variable de entorno WOMPI_EVENTS_SECRET.
//
// Nota: la forma exacta del payload (nombres de propiedades en signature.properties,
// etc.) está implementada según la documentación pública de Wompi al momento de
// escribir esto. Antes de confiar en producción, conviene disparar una transacción
// de prueba real desde Wompi y revisar en los logs de Vercel que el checksum calcule
// igual al que envía Wompi -- las pasarelas de pago a veces ajustan estos detalles.

const crypto = require('crypto');
const { sql, ensureSchema } = require('../../lib/db');

function resolvePath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const eventsSecret = process.env.WOMPI_EVENTS_SECRET;
  if (!eventsSecret) {
    console.error('Falta WOMPI_EVENTS_SECRET: no se puede verificar el webhook de Wompi.');
    res.status(503).json({ error: 'webhook_not_configured' });
    return;
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }

  try {
    const { properties = [], checksum } = payload.signature || {};
    const concatenated =
      properties.map((p) => resolvePath(payload.data, p)).join('') +
      String(payload.timestamp) +
      eventsSecret;
    const expected = crypto.createHash('sha256').update(concatenated).digest('hex');

    if (!checksum || expected !== checksum) {
      console.warn('Firma de webhook de Wompi inválida.');
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    const tx = payload.data && payload.data.transaction;
    if (tx && tx.reference) {
      await ensureSchema();
      await sql`
        UPDATE orders
        SET status = ${String(tx.status || 'pending').toLowerCase()},
            wompi_transaction_id = ${tx.id || null},
            updated_at = now()
        WHERE reference = ${tx.reference}
      `;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error procesando webhook de Wompi:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
