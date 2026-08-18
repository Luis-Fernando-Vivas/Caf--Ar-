// Servidor de desarrollo local, sin depender de "vercel dev" (que exige login
// en tu cuenta de Vercel). Sirve los archivos estáticos y ejecuta las mismas
// funciones de /api tal cual están escritas para Vercel, cargando las
// variables de entorno de .env con la flag nativa de Node --env-file.
//
// Uso: node --env-file=.env dev-server.js   (o "npm run dev:local")

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Réplica mínima de los helpers res.status()/res.json() que Vercel agrega
// automáticamente en sus funciones serverless.
function enhanceResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  res.send = (body) => res.end(body);
  return res;
}

async function handleApi(req, res, pathname) {
  const relative = pathname.replace(/^\/api\//, '');
  const filePath = path.join(ROOT, 'api', relative + '.js');
  if (!filePath.startsWith(path.join(ROOT, 'api'))) {
    res.status(400).json({ error: 'bad_path' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const raw = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  req.body = contentType.includes('application/json') ? raw : raw;

  try {
    delete require.cache[require.resolve(filePath)]; // recarga en caliente en cada request
    const handler = require(filePath);
    await handler(req, res);
  } catch (err) {
    console.error(`Error en ${pathname}:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  }
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(ROOT, decodeURIComponent(pathname));
  if (pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // admin/login, admin/index sin extensión -> intenta con .html
      const withHtml = filePath + '.html';
      fs.stat(withHtml, (err2, stats2) => {
        if (err2 || !stats2.isFile()) {
          res.statusCode = 404;
          res.end('404 Not Found: ' + pathname);
          return;
        }
        streamFile(res, withHtml);
      });
      return;
    }
    streamFile(res, filePath);
  });
}

function streamFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  enhanceResponse(res);
  const pathname = req.url.split('?')[0];

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Café Arú corriendo en local: http://localhost:${PORT}`);
  console.log(`Backoffice: http://localhost:${PORT}/admin/login.html`);
  if (!process.env.WOMPI_PUBLIC_KEY_TEST && !process.env.WOMPI_PUBLIC_KEY_PROD) {
    console.warn('Aviso: no se detectaron variables de Wompi -- ¿corriste con --env-file=.env?');
  }
});
