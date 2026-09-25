// Límite de peticiones por IP, guardado en Postgres (las funciones serverless
// no comparten memoria entre invocaciones). Cada "bucket" es una acción
// distinta: login fallido, pedido creado, reseña enviada, cupón inválido...
//
// Uso:
//   if (await isRateLimited('review', ip, 3, 60)) -> responder 429
//   await recordHit('review', ip)                 -> contar esta acción

const { sql } = require('./db');

function clientIp(req) {
  // En Vercel, x-forwarded-for lo fija el propio edge (el primer valor es el cliente).
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function isRateLimited(bucket, ip, max, windowMinutes) {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM rate_limits
    WHERE bucket = ${bucket} AND ip = ${ip}
      AND created_at > now() - make_interval(mins => ${windowMinutes})
  `;
  return rows[0].n >= max;
}

async function recordHit(bucket, ip) {
  await sql`INSERT INTO rate_limits (bucket, ip) VALUES (${bucket}, ${ip})`;
  // Limpieza oportunista para que la tabla no crezca sin límite.
  await sql`DELETE FROM rate_limits WHERE created_at < now() - interval '1 day'`;
}

async function clearHits(bucket, ip) {
  await sql`DELETE FROM rate_limits WHERE bucket = ${bucket} AND ip = ${ip}`;
}

module.exports = { clientIp, isRateLimited, recordHit, clearHits };
