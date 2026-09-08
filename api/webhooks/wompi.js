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
const { sendAdminOrderNotification, sendCustomerOrderConfirmation } = require('../../lib/notify');

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

      const newStatus = String(tx.status || 'pending').toLowerCase();
      const customerEmail = tx.customer_email || null;
      const customerName = (tx.customer_data && tx.customer_data.full_name) || null;
      const customerPhone = (tx.customer_data && tx.customer_data.phone_number) || null;

      // La dirección de envío solo viene si el checkout se lanzó con
      // 'collect-shipping-address=true' (ver js/carrito.js). El nombre exacto
      // de los campos es según la documentación pública de Wompi -- conviene
      // confirmarlo con una transacción de prueba real antes de confiar en prod.
      const shippingAddress = tx.shipping_address || null;
      const customerAddress = shippingAddress
        ? [
            shippingAddress.address_line_1,
            shippingAddress.address_line_2,
            shippingAddress.city,
            shippingAddress.region,
            shippingAddress.country,
          ]
            .filter(Boolean)
            .join(', ')
        : null;

      const existingRows = await sql`SELECT id, status, notified_at FROM orders WHERE reference = ${tx.reference}`;
      const existing = existingRows[0];

      // El nombre/dirección/teléfono que el cliente escribió en nuestro propio
      // formulario de carrito.html es más confiable que lo que reporte Wompi
      // (algunos métodos de pago se saltan esos campos) -- por eso aquí el dato
      // ya guardado en el pedido tiene prioridad, y el de Wompi solo se usa si
      // faltaba. El email sí solo lo tenemos por Wompi, así que ahí manda él.
      await sql`
        UPDATE orders
        SET status = ${newStatus},
            wompi_transaction_id = ${tx.id || null},
            customer_email = COALESCE(${customerEmail}, customer_email),
            customer_name = COALESCE(customer_name, ${customerName}),
            customer_phone = COALESCE(customer_phone, ${customerPhone}),
            customer_address = COALESCE(customer_address, ${customerAddress}),
            updated_at = now()
        WHERE reference = ${tx.reference}
      `;

      // Solo avisamos la primera vez que el pedido queda aprobado -- Wompi puede
      // reenviar el mismo evento, y notified_at evita duplicar los correos.
      if (existing && newStatus === 'approved' && !existing.notified_at) {
        const orderRows = await sql`SELECT * FROM orders WHERE reference = ${tx.reference}`;
        const order = orderRows[0];
        const items = await sql`SELECT * FROM order_items WHERE order_id = ${order.id}`;

        await sql`UPDATE orders SET notified_at = now() WHERE id = ${order.id}`;
        await Promise.all([
          sendAdminOrderNotification(order, items).catch((err) =>
            console.error('Error enviando notificación de pedido al admin:', err)
          ),
          sendCustomerOrderConfirmation(order, items).catch((err) =>
            console.error('Error enviando confirmación de pedido al cliente:', err)
          ),
        ]);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error procesando webhook de Wompi:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
