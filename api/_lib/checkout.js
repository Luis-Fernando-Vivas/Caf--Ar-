// Lógica de precios del carrito, usada por api/checkout.js tanto para crear
// el pedido de verdad como para el modo preview:true (solo muestra el total
// en vivo, sin tocar la base de datos). Nunca confía en precios/cantidades
// que mande el cliente: siempre relee productos, tarifa de envío y cupón
// desde la BD.

const { sql } = require('./db');
const { getFreeShippingRule, appliesFreeShipping } = require('./shipping-rule');

class CheckoutError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

async function computeTotals({ items, shipping_rate_id, coupon_code }) {
  if (!Array.isArray(items) || !items.length) {
    throw new CheckoutError('empty_cart', 'El carrito está vacío.');
  }

  const productIds = items.map((it) => parseInt(it.product_id, 10)).filter(Boolean);
  if (productIds.length !== items.length) {
    throw new CheckoutError('invalid_input', 'Hay artículos inválidos en el carrito.');
  }

  const products = await sql`
    SELECT id, name, price_cop, stock, status, grind_options FROM products WHERE id = ANY(${productIds})
  `;
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = [];
  for (const it of items) {
    const productId = parseInt(it.product_id, 10);
    const product = byId.get(productId);
    if (!product || product.status !== 'active') {
      throw new CheckoutError('invalid_product', `Uno de los productos ya no está disponible.`);
    }
    const quantity = Math.max(1, Math.min(20, parseInt(it.quantity, 10) || 1));
    if (quantity > product.stock) {
      throw new CheckoutError('out_of_stock', `No hay suficiente stock de "${product.name}".`, { product_id: product.id });
    }

    // La presentación (grano entero / molido) no cambia el precio -- solo se
    // valida contra las opciones reales del producto y se anexa al nombre
    // guardado en order_items, para que quede visible en el pedido.
    const options = product.grind_options || [];
    let variant = null;
    if (options.length) {
      variant = typeof it.variant === 'string' && options.includes(it.variant) ? it.variant : options[0];
    }
    const productName = variant ? `${product.name} — ${variant}` : product.name;

    lines.push({
      product_id: product.id,
      product_name: productName,
      unit_price_cop: product.price_cop,
      quantity,
      line_total_cop: product.price_cop * quantity,
    });
  }

  const subtotal_cop = lines.reduce((sum, l) => sum + l.line_total_cop, 0);
  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);

  let shipping_cop = 0;
  let shipping_name = null;
  if (shipping_rate_id) {
    const rateId = parseInt(shipping_rate_id, 10);
    const rates = await sql`SELECT id, name, amount_cop FROM shipping_rates WHERE id = ${rateId} AND is_active = true`;
    if (!rates.length) throw new CheckoutError('invalid_shipping', 'La tarifa de envío seleccionada no es válida.');
    shipping_cop = rates[0].amount_cop;
    shipping_name = rates[0].name;
  }

  // Envío gratis por promoción: a partir de cierta cantidad de productos y/o
  // cierto subtotal, la tarifa elegida queda en $0 (el nombre se conserva
  // para que quede claro en el pedido cuál transportadora se iba a usar).
  const freeShippingRule = await getFreeShippingRule();
  const free_shipping_applied = shipping_cop > 0 && appliesFreeShipping(freeShippingRule, {
    quantity: totalQuantity,
    subtotal_cop,
  });
  const shipping_original_cop = shipping_cop;
  if (free_shipping_applied) {
    shipping_cop = 0;
  }

  let discount_cop = 0;
  let coupon = null;
  if (coupon_code) {
    const code = String(coupon_code).trim().toUpperCase();
    const rows = await sql`SELECT * FROM coupons WHERE code = ${code}`;
    if (!rows.length || !rows[0].is_active) {
      throw new CheckoutError('invalid_coupon', 'Ese cupón no existe o ya no está activo.');
    }
    coupon = rows[0];
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      throw new CheckoutError('invalid_coupon', 'Ese cupón ya venció.');
    }
    if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) {
      throw new CheckoutError('invalid_coupon', 'Ese cupón ya alcanzó su límite de usos.');
    }
    if (subtotal_cop < coupon.min_order_cop) {
      throw new CheckoutError(
        'invalid_coupon',
        `Ese cupón requiere un pedido mínimo de $${coupon.min_order_cop.toLocaleString('es-CO')} COP.`
      );
    }
    discount_cop = coupon.discount_type === 'percent'
      ? Math.floor((subtotal_cop * coupon.discount_value) / 100)
      : Math.min(coupon.discount_value, subtotal_cop);
  }

  const amount_cop = Math.max(0, subtotal_cop + shipping_cop - discount_cop);

  return {
    lines,
    subtotal_cop,
    total_quantity: totalQuantity,
    shipping_cop,
    shipping_original_cop,
    shipping_name,
    discount_cop,
    coupon,
    amount_cop,
    free_shipping_applied,
    free_shipping_rule: freeShippingRule,
  };
}

// Guarda el pedido y sus líneas a partir de los totales ya calculados por
// computeTotals. Compartido entre el checkout público (api/checkout.js) y el
// generador de links de pago del backoffice (api/admin/orders.js).
async function createOrder({ totals, channel, status, environment, shipping_rate_id, customer = {}, payment_url = null }) {
  // Reserva el uso del cupón de forma atómica: si dos pedidos llegan a la vez
  // con el último uso disponible, solo uno lo consigue.
  if (totals.coupon) {
    const reserved = await sql`
      UPDATE coupons SET times_used = times_used + 1
      WHERE id = ${totals.coupon.id} AND (usage_limit IS NULL OR times_used < usage_limit)
      RETURNING id
    `;
    if (!reserved.length) {
      throw new CheckoutError('invalid_coupon', 'Ese cupón ya alcanzó su límite de usos.');
    }
  }

  const reference = `ARU-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const totalQuantity = totals.lines.reduce((sum, l) => sum + l.quantity, 0);

  const orderRows = await sql`
    INSERT INTO orders (
      reference, channel, status, quantity, unit_price_cop, amount_cop, environment,
      shipping_rate_id, shipping_name, shipping_cop, coupon_code, discount_cop, subtotal_cop,
      customer_name, customer_address, customer_phone, customer_email, payment_url
    )
    VALUES (
      ${reference}, ${channel}, ${status}, ${totalQuantity}, 0, ${totals.amount_cop}, ${environment || 'prod'},
      ${shipping_rate_id || null}, ${totals.shipping_name}, ${totals.shipping_cop},
      ${totals.coupon ? totals.coupon.code : null}, ${totals.discount_cop}, ${totals.subtotal_cop},
      ${customer.name || null}, ${customer.address || null}, ${customer.phone || null}, ${customer.email || null},
      ${payment_url}
    )
    RETURNING id
  `;
  const orderId = orderRows[0].id;

  for (const line of totals.lines) {
    await sql`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price_cop, quantity, line_total_cop)
      VALUES (${orderId}, ${line.product_id}, ${line.product_name}, ${line.unit_price_cop}, ${line.quantity}, ${line.line_total_cop})
    `;
  }

  return { id: orderId, reference };
}

module.exports = { computeTotals, createOrder, CheckoutError };
