// Registro personal de bolsas de café (/admin/bags): las que llegan cada día
// (por producto y variación) y las que se van vendiendo. Es independiente del
// stock de la tienda (columna products.stock). Se expone a través de
// api/admin/orders.js -- no en un endpoint propio -- porque el proyecto ya usa
// las 12 funciones serverless que permite Vercel Hobby.
//
// Las ventas salen solas de los pedidos ENVIADOS (página, links de pago y
// pedidos manuales), el día en que se enviaron: un pedido pagado que aún no
// sale sigue teniendo sus bolsas en casa. A mano solo se registran las
// llegadas y alguna salida por fuera de la página (un regalo, una venta que no
// se anotó como pedido).
//
// Los días se cuentan en hora de Colombia, igual que en los reportes.

const { sql } = require('./db');

const TIME_ZONE = 'America/Bogota';
const BAG_KINDS = ['in', 'out']; // in = llegaron, out = salida manual
// checkout.js guarda la variación anexada al nombre: "Café Arú Honey 500g — Molido".
const VARIANT_SEPARATOR = ' — ';

class BagError extends Error {}

function parseDay(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new BagError('La fecha no es válida.');
  }
  return s;
}

// Separa "Nombre — Variación" del nombre guardado en order_items. Si el
// producto aún existe, solo se acepta una variación que sea de sus opciones
// (por si el nombre del producto contiene el separador).
function splitVariant(storedName, product) {
  const idx = storedName.lastIndexOf(VARIANT_SEPARATOR);
  if (idx === -1) return { name: storedName, variant: null };
  const variant = storedName.slice(idx + VARIANT_SEPARATOR.length);
  if (product && !(product.grind_options || []).includes(variant)) return { name: storedName, variant: null };
  return { name: storedName.slice(0, idx), variant };
}

async function getBagData() {
  const products = await sql`
    SELECT id, name, grind_options, status FROM products ORDER BY sort_order ASC, id ASC
  `;
  const byId = new Map(products.map((p) => [p.id, p]));

  const movements = await sql`
    SELECT id, to_char(moved_on, 'YYYY-MM-DD') AS day, kind, product_id, product_name, variant, grind,
           quantity, note, created_at
    FROM bag_movements
    ORDER BY moved_on ASC, id ASC
  `;

  // Una fila por artículo enviado; los pedidos antiguos sin order_items
  // salen con su cantidad total y sin producto.
  const rows = await sql`
    SELECT o.id AS order_id, o.reference, o.channel, o.customer_name,
           to_char(COALESCE(o.shipped_at, o.updated_at) AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day,
           oi.product_id, oi.product_name, COALESCE(oi.quantity, o.quantity) AS quantity
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'shipped'
      AND NOT (o.channel = 'wompi' AND o.environment = 'test')
    ORDER BY COALESCE(o.shipped_at, o.updated_at) ASC, oi.id ASC
  `;
  const sales = rows.map((r) => {
    const { name, variant } = r.product_name
      ? splitVariant(r.product_name, byId.get(r.product_id))
      : { name: 'Pedido sin detalle de producto', variant: null };
    return {
      order_id: r.order_id,
      reference: r.reference,
      channel: r.channel,
      customer_name: r.customer_name,
      day: r.day,
      product_id: r.product_id,
      product_name: name,
      variant,
      quantity: r.quantity,
    };
  });

  return { products, movements, sales };
}

async function createBagMovement(body) {
  const day = parseDay(body.day);
  if (!BAG_KINDS.includes(body.kind)) throw new BagError('Indica si las bolsas llegaron o salieron.');

  const productId = parseInt(body.product_id, 10);
  const rows = productId ? await sql`SELECT id, name, grind_options FROM products WHERE id = ${productId}` : [];
  const product = rows[0];
  if (!product) throw new BagError('Elige el producto.');

  const options = product.grind_options || [];
  let variant = null;
  if (options.length) {
    if (!options.includes(body.variant)) throw new BagError('Elige la variación del producto.');
    variant = body.variant;
  }

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100000) {
    throw new BagError('La cantidad debe ser un número entero mayor a 0.');
  }
  const note = String(body.note || '').trim().slice(0, 300);

  const inserted = await sql`
    INSERT INTO bag_movements (moved_on, kind, product_id, product_name, variant, quantity, note)
    VALUES (${day}::date, ${body.kind}, ${product.id}, ${product.name}, ${variant}, ${quantity}, ${note})
    RETURNING id, to_char(moved_on, 'YYYY-MM-DD') AS day, kind, product_id, product_name, variant, grind,
              quantity, note, created_at
  `;
  return inserted[0];
}

async function deleteBagMovement(id) {
  const movementId = parseInt(id, 10);
  if (!movementId) throw new BagError('Movimiento inválido.');
  await sql`DELETE FROM bag_movements WHERE id = ${movementId}`;
}

module.exports = { getBagData, createBagMovement, deleteBagMovement, BagError };
