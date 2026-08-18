/* Café Arú — página de carrito y checkout */

const WHATSAPP_NUMBER = '573208022813';

let shippingRates = [];
let selectedShippingId = null;
let appliedCoupon = '';
let lastTotals = null;

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function renderLines() {
  const items = Cart.getItems();
  const wrap = document.getElementById('cartLines');
  const empty = document.getElementById('cartEmpty');
  const summary = document.getElementById('cartSummary');
  wrap.innerHTML = '';

  if (!items.length) {
    empty.style.display = 'block';
    summary.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  summary.style.display = '';

  items.forEach((it) => {
    const line = document.createElement('div');
    line.className = 'cart-line';

    const img = document.createElement('img');
    img.src = it.image || 'img/producto-bolsa-500g.png';
    img.alt = it.name;
    line.appendChild(img);

    const body = document.createElement('div');
    body.className = 'cart-line-body';
    const h4 = document.createElement('h4');
    h4.textContent = it.name;
    const price = document.createElement('span');
    price.textContent = '$' + formatCOP(it.price_cop) + ' c/u';
    body.append(h4, price);
    line.appendChild(body);

    const qtyBox = document.createElement('div');
    qtyBox.className = 'cart-line-qty';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '–';
    minus.addEventListener('click', () => { Cart.setQty(it.product_id, it.quantity - 1); });
    const qtySpan = document.createElement('span');
    qtySpan.textContent = it.quantity;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.addEventListener('click', () => { Cart.setQty(it.product_id, it.quantity + 1); });
    qtyBox.append(minus, qtySpan, plus);
    line.appendChild(qtyBox);

    const total = document.createElement('div');
    total.className = 'cart-line-total';
    total.textContent = '$' + formatCOP(it.price_cop * it.quantity);
    line.appendChild(total);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cart-line-remove';
    removeBtn.textContent = 'Quitar';
    removeBtn.addEventListener('click', () => { Cart.remove(it.product_id); });
    line.appendChild(removeBtn);

    wrap.appendChild(line);
  });
}

async function loadShippingRates() {
  const res = await fetch('/api/shipping-rates');
  if (!res.ok) return;
  const data = await res.json();
  shippingRates = data.rates || [];
  if (!selectedShippingId && shippingRates.length) selectedShippingId = shippingRates[0].id;

  const wrap = document.getElementById('shippingOptions');
  wrap.innerHTML = '';
  shippingRates.forEach((r) => {
    const label = document.createElement('label');
    label.className = 'cart-shipping-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'shipping';
    radio.value = r.id;
    radio.checked = r.id === selectedShippingId;
    radio.addEventListener('change', () => { selectedShippingId = r.id; refreshTotals(); });
    const span = document.createElement('span');
    span.textContent = r.name;
    const amount = document.createElement('strong');
    amount.textContent = r.amount_cop > 0 ? '$' + formatCOP(r.amount_cop) : 'Gratis';
    label.append(radio, span, amount);
    wrap.appendChild(label);
  });
}

async function refreshTotals() {
  const items = Cart.getItems();
  if (!items.length) return;

  const res = await fetch('/api/cart-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
      shipping_rate_id: selectedShippingId,
      coupon_code: appliedCoupon || undefined,
    }),
  });
  const data = await res.json();
  const couponError = document.getElementById('couponError');

  if (!res.ok) {
    couponError.textContent = appliedCoupon ? data.message || 'Cupón inválido.' : '';
    appliedCoupon = '';
    lastTotals = null;
    return;
  }
  couponError.textContent = '';
  lastTotals = data;

  document.getElementById('sumSubtotal').textContent = '$' + formatCOP(data.subtotal_cop);
  document.getElementById('sumShipping').textContent = data.shipping_cop > 0 ? '$' + formatCOP(data.shipping_cop) : 'Gratis';
  document.getElementById('sumTotal').textContent = '$' + formatCOP(data.amount_cop);

  const discountRow = document.getElementById('discountRow');
  if (data.discount_cop > 0) {
    discountRow.style.display = '';
    document.getElementById('sumDiscount').textContent = '-$' + formatCOP(data.discount_cop);
  } else {
    discountRow.style.display = 'none';
  }
}

async function applyCoupon() {
  const input = document.getElementById('couponInput');
  appliedCoupon = input.value.trim();
  await refreshTotals();
}

async function checkout(channel) {
  const items = Cart.getItems();
  const errorEl = document.getElementById('checkoutError');
  errorEl.textContent = '';
  if (!items.length) return;

  const wompiBtn = document.getElementById('payWompiBtn');
  const waBtn = document.getElementById('payWhatsappBtn');
  wompiBtn.disabled = true;
  waBtn.disabled = true;

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
        shipping_rate_id: selectedShippingId,
        coupon_code: appliedCoupon || undefined,
        channel,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.message || 'No se pudo procesar el pedido.';
      return;
    }

    if (channel === 'wompi') {
      const redirectUrl = `${location.origin}/gracias.html`;
      const params = new URLSearchParams({
        'public-key': data.publicKey,
        currency: data.currency,
        'amount-in-cents': String(data.amountInCents),
        reference: data.reference,
        'signature:integrity': data.signature,
        'redirect-url': redirectUrl,
      });
      window.location.href = `https://checkout.wompi.co/p/?${params.toString()}`;
      return;
    }

    Cart.clear();
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(data.whatsappMessage)}`;
    window.open(url, '_blank', 'noopener');
  } catch {
    errorEl.textContent = 'No se pudo conectar con el servidor.';
  } finally {
    wompiBtn.disabled = false;
    waBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  renderLines();
  await loadShippingRates();
  await refreshTotals();

  window.addEventListener('cart:change', () => {
    renderLines();
    refreshTotals();
  });

  document.getElementById('applyCouponBtn').addEventListener('click', applyCoupon);
  document.getElementById('payWompiBtn').addEventListener('click', () => checkout('wompi'));
  document.getElementById('payWhatsappBtn').addEventListener('click', () => checkout('whatsapp'));
});
