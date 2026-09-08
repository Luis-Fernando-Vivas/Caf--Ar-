/* Café Arú — página de carrito y checkout */

const WHATSAPP_NUMBER = '573132834162';

let shippingRates = [];
let selectedShippingId = null;
let appliedCoupon = '';
let lastTotals = null;
let freeShippingWouldApply = false;

function ruleAppliesToCart(rule, quantity, subtotalCop) {
  if (!rule || !rule.enabled) return false;
  if (rule.min_quantity !== null && quantity >= rule.min_quantity) return true;
  if (rule.min_subtotal_cop !== null && subtotalCop >= rule.min_subtotal_cop) return true;
  return false;
}

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
    img.src = it.image || 'img/product/cafe-aru.webp';
    img.alt = it.name;
    line.appendChild(img);

    const body = document.createElement('div');
    body.className = 'cart-line-body';
    const h4 = document.createElement('h4');
    h4.textContent = it.name;
    body.appendChild(h4);
    if (it.variant) {
      const variantNote = document.createElement('span');
      variantNote.className = 'cart-line-variant';
      variantNote.textContent = it.variant;
      body.appendChild(variantNote);
    }
    const price = document.createElement('span');
    price.textContent = '$' + formatCOP(it.price_cop) + ' c/u';
    body.appendChild(price);
    line.appendChild(body);

    const qtyBox = document.createElement('div');
    qtyBox.className = 'cart-line-qty';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '–';
    minus.addEventListener('click', () => { Cart.setQty(it.product_id, it.quantity - 1, it.variant); });
    const qtySpan = document.createElement('span');
    qtySpan.textContent = it.quantity;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.addEventListener('click', () => { Cart.setQty(it.product_id, it.quantity + 1, it.variant); });
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
    removeBtn.addEventListener('click', () => { Cart.remove(it.product_id, it.variant); });
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

  renderShippingOptions();
}

function renderShippingOptions() {
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
    if (r.amount_cop > 0 && freeShippingWouldApply) {
      const strike = document.createElement('span');
      strike.className = 'cart-shipping-strike';
      strike.textContent = '$' + formatCOP(r.amount_cop);
      const free = document.createElement('span');
      free.textContent = 'Gratis';
      amount.append(strike, free);
    } else {
      amount.textContent = r.amount_cop > 0 ? '$' + formatCOP(r.amount_cop) : 'Gratis';
    }
    label.append(radio, span, amount);
    wrap.appendChild(label);
  });
}

async function refreshTotals() {
  const items = Cart.getItems();
  if (!items.length) return;

  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, variant: it.variant })),
      shipping_rate_id: selectedShippingId,
      coupon_code: appliedCoupon || undefined,
      preview: true,
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

  freeShippingWouldApply = ruleAppliesToCart(data.free_shipping_rule, data.total_quantity, data.subtotal_cop);
  renderShippingOptions();

  document.getElementById('sumSubtotal').textContent = '$' + formatCOP(data.subtotal_cop);
  document.getElementById('sumTotal').textContent = '$' + formatCOP(data.amount_cop);

  const shippingOriginalEl = document.getElementById('sumShippingOriginal');
  const shippingValueEl = document.getElementById('sumShippingValue');
  if (data.free_shipping_applied && data.shipping_original_cop > 0) {
    shippingOriginalEl.textContent = '$' + formatCOP(data.shipping_original_cop);
    shippingOriginalEl.style.display = '';
    shippingValueEl.textContent = 'Gratis';
  } else {
    shippingOriginalEl.style.display = 'none';
    shippingValueEl.textContent = data.shipping_cop > 0 ? '$' + formatCOP(data.shipping_cop) : 'Gratis';
  }

  const discountRow = document.getElementById('discountRow');
  if (data.discount_cop > 0) {
    discountRow.style.display = '';
    document.getElementById('sumDiscount').textContent = '-$' + formatCOP(data.discount_cop);
  } else {
    discountRow.style.display = 'none';
  }

  renderFreeShippingBar(data, items);
}

function renderFreeShippingBar(data, items) {
  const bar = document.getElementById('freeShippingBar');
  const rule = data.free_shipping_rule;
  if (!rule || !rule.enabled) {
    bar.style.display = 'none';
    return;
  }

  const text = document.getElementById('freeShippingBarText');
  const fill = document.getElementById('freeShippingBarFill');
  bar.style.display = 'block';

  if (data.free_shipping_applied) {
    bar.classList.add('is-complete');
    fill.style.width = '100%';
    document.getElementById('freeShippingBarCart').style.left = '100%';
    text.innerHTML = '<strong>¡Tu pedido califica para envío gratis!</strong>';
    return;
  }
  bar.classList.remove('is-complete');

  const totalQuantity = items.reduce((sum, it) => sum + it.quantity, 0);

  // Si hay dos condiciones activas, se muestra la que está más cerca de
  // cumplirse (mayor progreso), para que la barra siempre avance hacia la
  // meta más alcanzable.
  let bestRatio = 0;
  let bestMessage = '';
  if (rule.min_quantity !== null) {
    const remaining = Math.max(0, rule.min_quantity - totalQuantity);
    const ratio = Math.min(1, totalQuantity / rule.min_quantity);
    if (ratio >= bestRatio) {
      bestRatio = ratio;
      bestMessage = `Te falta${remaining === 1 ? '' : 'n'} <strong>${remaining} producto${remaining === 1 ? '' : 's'}</strong> más para envío gratis`;
    }
  }
  if (rule.min_subtotal_cop !== null) {
    const remaining = Math.max(0, rule.min_subtotal_cop - data.subtotal_cop);
    const ratio = Math.min(1, data.subtotal_cop / rule.min_subtotal_cop);
    if (ratio >= bestRatio) {
      bestRatio = ratio;
      bestMessage = `Te falta${remaining === 1 ? '' : 'n'} <strong>$${formatCOP(remaining)}</strong> más para envío gratis`;
    }
  }

  fill.style.width = (bestRatio * 100) + '%';
  document.getElementById('freeShippingBarCart').style.left = (bestRatio * 100) + '%';
  text.innerHTML = bestMessage;
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

  const customerName = document.getElementById('customerName').value.trim();
  const customerAddress = document.getElementById('customerAddress').value.trim();
  const customerPhone = document.getElementById('customerPhone').value.trim();
  if (!customerName || !customerAddress || !customerPhone) {
    errorEl.textContent = 'Completa nombre, dirección y teléfono para poder enviarte el pedido.';
    return;
  }

  const wompiBtn = document.getElementById('payWompiBtn');
  const waBtn = document.getElementById('payWhatsappBtn');
  wompiBtn.disabled = true;
  waBtn.disabled = true;

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, variant: it.variant })),
        shipping_rate_id: selectedShippingId,
        coupon_code: appliedCoupon || undefined,
        channel,
        customer_name: customerName,
        customer_address: customerAddress,
        customer_phone: customerPhone,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.message || 'No se pudo procesar el pedido.';
      return;
    }

    if (channel === 'wompi') {
      const redirectUrl = `${location.origin}/gracias`;
      const params = new URLSearchParams({
        'public-key': data.publicKey,
        currency: data.currency,
        'amount-in-cents': String(data.amountInCents),
        reference: data.reference,
        'signature:integrity': data.signature,
        'redirect-url': redirectUrl,
        'collect-shipping-address': 'true',
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
