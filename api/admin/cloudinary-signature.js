// Backoffice: firma para subir imágenes directo a Cloudinary desde el navegador
// del admin, sin que el archivo pase por nuestras funciones serverless.
//
// Por qué existe este archivo: igual que con la firma de integridad de Wompi
// (api/wompi-signature.js), el CLOUDINARY_API_SECRET nunca puede llegar al
// navegador. Este endpoint (protegido por sesión de admin) genera una firma de
// un solo uso con la que el navegador puede subir UNA foto directo a Cloudinary.
//
// Variables de entorno requeridas:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// (Dashboard de Cloudinary -> Settings -> API Keys)

const crypto = require('crypto');
const { isAuthenticated } = require('../../lib/auth');

const FOLDER = 'cafe-aru/products';

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

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${FOLDER}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');

  res.status(200).json({ cloudName, apiKey, timestamp, folder: FOLDER, signature });
};
