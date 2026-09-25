// Backoffice: firma para subir imágenes directo a Cloudinary desde el navegador
// del admin, sin que el archivo pase por nuestras funciones serverless.
//
// Por qué existe este archivo: igual que con la firma de integridad de Wompi
// (api/wompi-signature.js), el CLOUDINARY_API_SECRET nunca puede llegar al
// navegador. Este endpoint (protegido por sesión de admin) genera una firma de
// un solo uso con la que el navegador puede subir UNA foto directo a Cloudinary.
//
// El Upload Widget de Cloudinary agrega automáticamente parámetros propios
// (ej. "source=uw") a lo que sube, y Cloudinary exige que la firma cubra
// EXACTAMENTE todos los parámetros que se envían -- si falta uno (como pasaba
// antes, firmando solo folder+timestamp a mano) Cloudinary responde
// "Invalid Signature". Por eso el widget usa el modo "uploadSignature callback":
// nos manda el objeto paramsToSign real (con todo lo que va a enviar) y este
// endpoint firma exactamente eso, en vez de adivinar los parámetros de antemano.
//
// POST sin body (o {}) -> solo confirma si Cloudinary está configurado (503 si
//   faltan las env vars), lo usa el admin antes de abrir el widget.
// POST { paramsToSign: {...} } -> firma esos parámetros tal cual llegan.
//
// Variables de entorno requeridas:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// (Dashboard de Cloudinary -> Settings -> API Keys)

const crypto = require('crypto');
const { isAuthenticated } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    res.status(503).json({
      error: 'cloudinary_not_configured',
      message: 'Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y/o CLOUDINARY_API_SECRET en las variables de entorno.',
    });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const paramsToSign = body.paramsToSign && typeof body.paramsToSign === 'object' ? body.paramsToSign : null;

  if (!paramsToSign) {
    // Solo era el chequeo de "¿está configurado?" antes de abrir el widget.
    res.status(200).json({ cloudName, apiKey });
    return;
  }

  // Cloudinary firma la concatenación "clave=valor" de TODOS los parámetros
  // (menos file/cloud_name/resource_type/api_key/signature), ordenados
  // alfabéticamente por clave, con el api_secret pegado al final.
  const toSign = Object.keys(paramsToSign)
    .sort()
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join('&');

  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  res.status(200).json({ signature });
};
