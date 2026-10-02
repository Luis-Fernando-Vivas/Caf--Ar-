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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- carrito abandonado ----------
   En cuanto el cliente escribe un correo válido, el carrito se guarda en el
   servidor (y se actualiza con cada cambio). Si no termina la compra, le llega
   un correo con un link /carrito?recuperar=<token> -- ver api/_lib/abandoned-carts.js. */

let saveCartTimer = null;

function scheduleSaveCart() {
  clearTimeout(saveCartTimer);
  saveCartTimer = setTimeout(saveCartRemote, 800);
}

async function saveCartRemote() {
  const email = document.getElementById('customerEmail').value.trim();
  const items = Cart.getItems();
  if (!EMAIL_RE.test(email) || !items.length) return;
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_cart',
        cart_token: Cart.getToken() || undefined,
        email,
        items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, variant: it.variant })),
        customer_name: document.getElementById('customerName').value.trim(),
        customer_phone: document.getElementById('customerPhone').value.trim(),
        customer_address: document.getElementById('customerAddress').value.trim(),
        shipping_rate_id: selectedShippingId,
        coupon_code: appliedCoupon || undefined,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.cart_token) Cart.setToken(data.cart_token);
  } catch {
    // Silencioso: guardar el carrito es un extra, nunca debe estorbar la compra.
  }
}

// Si el cliente llega desde el link del correo, vuelve a llenar el carrito y
// el formulario tal como los dejó.
async function recoverCartFromLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get('recuperar');
  if (!token) return;
  params.delete('recuperar');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));

  try {
    const res = await fetch(`/api/checkout?recuperar=${encodeURIComponent(token)}`);
    if (!res.ok) return;
    const cart = await res.json();
    Cart.setToken(cart.token);
    if (cart.items && cart.items.length) Cart.replace(cart.items);
    const fill = (id, value) => { if (value) document.getElementById(id).value = value; };
    fill('customerEmail', cart.email);
    fill('customerName', cart.customer_name);
    fill('customerPhone', cart.customer_phone);
    fill('customerAddress', cart.customer_address);
    if (cart.shipping_rate_id) selectedShippingId = cart.shipping_rate_id;
    if (cart.coupon_code) {
      appliedCoupon = cart.coupon_code;
      document.getElementById('couponInput').value = cart.coupon_code;
    }
  } catch {
    // Si falla, el cliente igual puede armar el carrito de nuevo.
  }
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
    img.src = it.image ? cldImage(it.image, 'f_auto,q_auto,w_200') : 'img/product/cafe-aru.webp';
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
  // (la tarifa de un carrito recuperado pudo haberse desactivado desde entonces)
  if (!shippingRates.some((r) => r.id === selectedShippingId)) {
    selectedShippingId = shippingRates.length ? shippingRates[0].id : null;
  }

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
    radio.addEventListener('change', () => { selectedShippingId = r.id; refreshTotals(); scheduleSaveCart(); });
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
  scheduleSaveCart();
}

async function checkout(channel) {
  const items = Cart.getItems();
  const errorEl = document.getElementById('checkoutError');
  errorEl.textContent = '';
  if (!items.length) return;

  const customerName = document.getElementById('customerName').value.trim();
  const customerAddress = document.getElementById('customerAddress').value.trim();
  const customerPhone = document.getElementById('customerPhone').value.trim();
  const customerEmail = document.getElementById('customerEmail').value.trim();
  if (!customerName || !customerEmail || !customerAddress || !customerPhone) {
    errorEl.textContent = 'Completa nombre, correo, dirección y teléfono para poder enviarte el pedido.';
    return;
  }
  if (!EMAIL_RE.test(customerEmail)) {
    errorEl.textContent = 'Revisa tu correo electrónico, parece que no está bien escrito.';
    return;
  }

  const cartValue = lastTotals ? lastTotals.amount_cop : Cart.getSubtotal();
  if (window.Analytics) {
    Analytics.ecommerce('begin_checkout', Analytics.cartItems(items), cartValue, {
      coupon: appliedCoupon || undefined,
      payment_type: channel,
    });
  }

  const wompiBtn = document.getElementById('payWompiBtn');
  const waBtn = document.getElementById('payWhatsappBtn');
  wompiBtn.disabled = true;
  waBtn.disabled = true;

  try {
    // Asegura que el carrito quede guardado (y con token) antes de crear el
    // pedido: si el pago de Wompi no se completa, así sí le llega el recordatorio.
    clearTimeout(saveCartTimer);
    await saveCartRemote();

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
        customer_email: customerEmail,
        cart_token: Cart.getToken() || undefined,
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
        'customer-data:email': customerEmail,
      });
      if (window.Analytics) {
        Analytics.savePendingPurchase({
          reference: data.reference,
          items: Analytics.cartItems(items),
          shipping: lastTotals ? lastTotals.shipping_cop : undefined,
          coupon: appliedCoupon || undefined,
        });
      }
      window.location.href = `https://checkout.wompi.co/p/?${params.toString()}`;
      return;
    }

    // Por WhatsApp el pago se coordina después, así que no es una venta
    // confirmada: se registra como lead (y se marca como evento clave en GA4).
    if (window.Analytics) {
      Analytics.ecommerce('generate_lead', Analytics.cartItems(items), cartValue, { lead_source: 'whatsapp_checkout' });
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
  await recoverCartFromLink();
  renderLines();
  if (window.Analytics && Cart.getCount() > 0) {
    Analytics.ecommerce('view_cart', Analytics.cartItems(Cart.getItems()), Cart.getSubtotal());
  }
  await loadShippingRates();
  await refreshTotals();

  window.addEventListener('cart:change', () => {
    renderLines();
    refreshTotals();
    scheduleSaveCart();
  });
  // "?" del correo: en celular no hay hover, así que también abre/cierra al tocar.
  document.querySelectorAll('.cart-input-help').forEach((wrap) => {
    const btn = wrap.querySelector('.cart-help-btn');
    const setOpen = (open) => {
      wrap.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => setOpen(!wrap.classList.contains('is-open')));
    document.addEventListener('click', (evt) => { if (!wrap.contains(evt.target)) setOpen(false); });
    btn.addEventListener('keydown', (evt) => { if (evt.key === 'Escape') setOpen(false); });
  });

  ['customerEmail', 'customerName', 'customerPhone', 'customerAddress'].forEach((id) => {
    document.getElementById(id).addEventListener('change', scheduleSaveCart);
  });

  document.getElementById('applyCouponBtn').addEventListener('click', applyCoupon);
  document.getElementById('payWompiBtn').addEventListener('click', () => checkout('wompi'));
  document.getElementById('payWhatsappBtn').addEventListener('click', () => checkout('whatsapp'));
});
