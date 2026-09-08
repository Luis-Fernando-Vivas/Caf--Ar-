// Envío de correos de notificación de pedido vía Resend (https://resend.com).
//
// Se dispara desde api/webhooks/wompi.js cuando un pedido pasa a estado
// APPROVED por primera vez: un correo al negocio con el detalle completo del
// pedido, y otro al cliente confirmando su compra.
//
// Variables de entorno requeridas (ver .env.example):
//   RESEND_API_KEY      -- API key de Resend (re_...)
//   ORDER_FROM_EMAIL     -- remitente verificado en Resend, ej. pedidos@coffeearu.com
//   ORDER_NOTIFY_EMAILS  -- destinatarios internos separados por coma
//
// Si falta RESEND_API_KEY, las funciones no hacen nada (no rompen el webhook).
//
// El HTML sigue las paletas y tipografías de css/style.css (--c-black,
// --c-red, --c-kraft, --c-cream) para que se sienta parte de la marca, con
// las limitaciones propias del correo: tablas para el layout, estilos inline
// (Gmail/Outlook ignoran <style> en muchos clientes) y fuentes web con
// fallback a serif/sans-serif del sistema.

const RESEND_API_URL = 'https://api.resend.com/emails';
const SITE_URL = 'https://www.coffeearu.com';
const LOGO_URL = `${SITE_URL}/img/logo-cafe-aru-light.png`;

const BRAND = {
  black: '#17110c',
  blackSoft: '#241a12',
  red: '#b32027',
  redDark: '#841319',
  kraft: '#c9a467',
  kraftDark: '#a9824c',
  kraftLight: '#e7d5ac',
  cream: '#f8f2e4',
  cream2: '#f1e6cd',
  white: '#fffdf9',
  text: '#241b12',
  textSoft: '#5a4c3c',
};

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn('Notificaciones de pedido desactivadas: falta RESEND_API_KEY o ORDER_FROM_EMAIL.');
    return;
  }
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `Café Arú <${from}>`, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`Resend respondió ${res.status} al enviar a ${to}: ${body}`);
  }
}

function itemsRowsHtml(items) {
  return items
    .map(
      (it, i) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid ${BRAND.cream2};font-family:'Inter',Arial,sans-serif;font-size:14px;color:${BRAND.text};${i === 0 ? 'padding-top:0;' : ''}">
            <strong>${it.product_name}</strong><br/>
            <span style="color:${BRAND.textSoft};font-size:13px;">Cantidad: ${it.quantity}</span>
          </td>
          <td style="padding:14px 0;border-bottom:1px solid ${BRAND.cream2};font-family:'Inter',Arial,sans-serif;font-size:14px;color:${BRAND.text};text-align:right;white-space:nowrap;${i === 0 ? 'padding-top:0;' : ''}">
            $${formatCOP(it.line_total_cop)}
          </td>
        </tr>`
    )
    .join('');
}

function summaryRowsHtml(order) {
  const rowStyle = `padding:5px 0;font-family:'Inter',Arial,sans-serif;font-size:13px;color:${BRAND.textSoft};`;
  const rows = [
    `<tr><td style="${rowStyle}">Subtotal</td><td style="${rowStyle}text-align:right;">$${formatCOP(order.subtotal_cop)}</td></tr>`,
  ];
  if (order.shipping_name) {
    rows.push(
      `<tr><td style="${rowStyle}">Envío (${order.shipping_name})</td><td style="${rowStyle}text-align:right;">$${formatCOP(order.shipping_cop)}</td></tr>`
    );
  }
  if (order.discount_cop > 0) {
    rows.push(
      `<tr><td style="${rowStyle}">Descuento${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td style="${rowStyle}text-align:right;color:${BRAND.red};">-$${formatCOP(order.discount_cop)}</td></tr>`
    );
  }
  rows.push(`
    <tr>
      <td colspan="2" style="padding-top:10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${BRAND.black};margin-top:4px;">
          <tr>
            <td style="padding-top:12px;font-family:'Fraunces',Georgia,serif;font-size:17px;font-weight:600;color:${BRAND.black};">Total</td>
            <td style="padding-top:12px;font-family:'Fraunces',Georgia,serif;font-size:19px;font-weight:700;color:${BRAND.red};text-align:right;">$${formatCOP(order.amount_cop)} COP</td>
          </tr>
        </table>
      </td>
    </tr>
  `);
  return rows.join('');
}

// Envuelve el contenido de cada correo en el mismo cascarón de marca:
// header negro con logo + cinta kraft, tarjeta crema, footer negro.
function shellHtml({ preheader, badge, heading, intro, bodyHtml, footerNote }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Café Arú</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cream};font-family:'Inter',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader || ''}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cream};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${BRAND.white};border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(23,17,12,0.12);">

          <tr>
            <td style="background-color:${BRAND.black};padding:28px 32px 22px;text-align:center;">
              <img src="${LOGO_URL}" alt="Café Arú" width="150" style="display:inline-block;border:0;outline:none;max-width:150px;height:auto;" />
            </td>
          </tr>
          <tr>
            <td style="height:5px;line-height:5px;font-size:0;background-color:${BRAND.red};">&nbsp;</td>
          </tr>

          <tr>
            <td style="padding:34px 32px 8px;">
              ${badge ? `<span style="display:inline-block;background-color:${BRAND.kraftLight};color:${BRAND.redDark};font-family:'Inter',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin-bottom:16px;">${badge}</span>` : ''}
              <h1 style="margin:0 0 12px;font-family:'Fraunces',Georgia,serif;font-size:26px;line-height:1.25;color:${BRAND.black};font-weight:600;">${heading}</h1>
              ${intro ? `<p style="margin:0 0 24px;font-family:'Inter',Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.textSoft};">${intro}</p>` : ''}
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 28px;">
              ${bodyHtml}
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cream};border-radius:10px;border:1px solid ${BRAND.cream2};">
                <tr>
                  <td style="padding:18px 20px;font-family:'Inter',Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.textSoft};">
                    ${footerNote || '¿Tienes alguna pregunta sobre tu pedido? Responde directamente a este correo, con gusto te ayudamos.'}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:${BRAND.black};padding:26px 32px;text-align:center;">
              <p style="margin:0 0 6px;font-family:'Fraunces',Georgia,serif;font-size:15px;color:${BRAND.kraftLight};letter-spacing:0.02em;">Café Arú</p>
              <p style="margin:0;font-family:'Inter',Arial,sans-serif;font-size:12px;color:${BRAND.kraft};">Palermo, Huila · Colombia</p>
              <p style="margin:10px 0 0;font-family:'Inter',Arial,sans-serif;font-size:12px;">
                <a href="${SITE_URL}" style="color:${BRAND.kraftLight};text-decoration:underline;">coffeearu.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendAdminOrderNotification(order, items) {
  const notifyEmails = (process.env.ORDER_NOTIFY_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (!notifyEmails.length) {
    console.warn('Notificaciones de pedido desactivadas: falta ORDER_NOTIFY_EMAILS.');
    return;
  }

  const isTest = order.environment === 'test';
  const contactRowStyle = `padding:4px 0;font-family:'Inter',Arial,sans-serif;font-size:14px;color:${BRAND.text};`;

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cream};border-radius:10px;margin-bottom:22px;">
      <tr>
        <td style="padding:18px 20px;">
          <p style="margin:0 0 8px;font-family:'Inter',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.textSoft};">Datos del cliente</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="${contactRowStyle}"><strong>Nombre:</strong> ${order.customer_name || '(sin nombre)'}</td></tr>
            <tr><td style="${contactRowStyle}"><strong>Email:</strong> ${order.customer_email || '(sin email)'}</td></tr>
            <tr><td style="${contactRowStyle}"><strong>Teléfono:</strong> ${order.customer_phone || '(sin teléfono)'}</td></tr>
            <tr><td style="${contactRowStyle}"><strong>Dirección:</strong> ${order.customer_address || '(sin dirección)'}</td></tr>
            <tr><td style="${contactRowStyle}"><strong>Referencia:</strong> ${order.reference}</td></tr>
          </table>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${itemsRowsHtml(items)}
      ${summaryRowsHtml(order)}
    </table>
  `;

  const html = shellHtml({
    preheader: `Nuevo pedido pagado — ${order.reference}`,
    badge: isTest ? 'Modo prueba · Sandbox' : 'Pago confirmado',
    heading: 'Tienes un pedido nuevo ☕',
    intro: 'Este pedido acaba de ser aprobado por Wompi. Aquí el detalle completo para prepararlo y coordinar el envío.',
    bodyHtml,
    footerNote: 'Actualiza el estado de este pedido desde el backoffice en cuanto lo despaches.',
  });

  await sendEmail({
    to: notifyEmails,
    subject: `${isTest ? '[PRUEBA] ' : ''}Nuevo pedido — ${order.reference}`,
    html,
  });
}

async function sendCustomerOrderConfirmation(order, items) {
  if (!order.customer_email) return;

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${itemsRowsHtml(items)}
      ${summaryRowsHtml(order)}
    </table>
  `;

  const html = shellHtml({
    preheader: `Confirmamos tu pedido ${order.reference}`,
    badge: 'Pedido confirmado',
    heading: '¡Gracias por tu compra!',
    intro: `Ya recibimos tu pago y estamos preparando tu pedido con mucho cariño. Este es el resumen de <strong>${order.reference}</strong>:`,
    bodyHtml,
    footerNote: 'Te avisaremos por aquí en cuanto tu pedido salga hacia el envío. Si tienes alguna pregunta, solo responde a este correo.',
  });

  await sendEmail({
    to: [order.customer_email],
    subject: `Confirmación de tu pedido — Café Arú (${order.reference})`,
    html,
  });
}

module.exports = { sendAdminOrderNotification, sendCustomerOrderConfirmation };
