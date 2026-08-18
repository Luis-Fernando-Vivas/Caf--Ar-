// Webhook de Wompi ("eventos"): confirma automáticamente el estado real del pago
// y actualiza el pedido correspondiente (buscado por su "reference").
//
// Configúralo en el dashboard de Wompi -> Configuración -> Eventos, apuntando a:
//   https://tu-sitio.vercel.app/api/webhooks/wompi
// y copia el "Secreto de eventos" (distinto de la llave de integridad) en la
// variable de entorno WOMPI_EVENTS_SECRET_TEST (sandbox) o WOMPI_EVENTS_SECRET_PROD
// (producción) -- cada entorno de Wompi tiene su propio secreto de eventos.
//
// Nota: la forma exacta del payload (nombres de propiedades en signature.properties,
// etc.) está implementada según la documentación pública de Wompi al momento de
// escribir esto. Antes de confiar en producción, conviene disparar una transacción
// de prueba real desde Wompi y revisar en los logs de Vercel que el checksum calcule
// igual al que envía Wompi -- las pasarelas de pago a veces ajustan estos detalles.

const crypto = require('crypto');
const { sql, ensureSchema } = require('../../lib/db');
const { getWompiEnvironment, getWompiKeys } = require('../../lib/wompi-env');

function resolvePath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  // El webhook se verifica contra el secreto del entorno activo en el backoffice:
  // los eventos de Wompi solo pueden venir del mismo entorno (sandbox o real) que
  // se está usando para generar los checkouts.
  const environment = await getWompiEnvironment();
  const { eventsSecret } = getWompiKeys(environment);
  if (!eventsSecret) {
    console.error(`Falta el secreto de eventos de Wompi para el entorno "${environment}".`);
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
