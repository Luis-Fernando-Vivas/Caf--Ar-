/* Café Arú — Backoffice: generador de links de pago de Wompi */

const STATUS_LABELS = {
  pending: 'Pendiente de pago',
  approved: 'Pagado',
  declined: 'Rechazado',
  voided: 'Anulado',
  paid_manually: 'Pagado (manual)',
  shipped: 'Enviado',
  cancelled: 'Cancelado',
  amount_mismatch: 'Revisar monto',
};

let products = [];
let previewTimer = null;
let previewSeq = 0;

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function redirectIfUnauthorized(res) {
  if (res.status === 401) {
    window.location.href = '/admin/login';
    return true;
  }
  return false;
}

function waLink(phone, name, amountCop, url) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '57' + digits;
  const firstName = String(name || '').split(' ')[0];
  const text = `Hola ${firstName}! Este es tu link de pago de Café Arú por $${formatCOP(amountCop)} COP:\n${url}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = '¡Copiado!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    window.prompt('Copia el link:', text);
  }
}

/* ---------------- líneas de productos ---------------- */

function addLine(initial = {}) {
  const wrap = document.getElementById('linesWrap');
  const row = document.createElement('div');
  row.className = 'paylink-line';

  const productSel = document.createElement('select');
  productSel.className = 'line-product';
  productSel.setAttribute('aria-label', 'Producto');
  products.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} — $${formatCOP(p.price_cop)}`;
    productSel.appendChild(opt);
  });
  if (initial.product_id) productSel.value = initial.product_id;

  const variantSel = document.createElement('select');
  variantSel.className = 'line-variant';
  variantSel.setAttribute('aria-label', 'Presentación');

  const qty = document.createElement('input');
  qty.type = 'number';
  qty.min = '1';
  qty.max = '20';
  qty.value = initial.quantity || 1;
  qty.className = 'line-qty';
  qty.setAttribute('aria-label', 'Cantidad');

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'line-remove';
  removeBtn.setAttribute('aria-label', 'Quitar producto');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    row.remove();
    schedulePreview();
  });

  const fillVariants = () => {
    const product = products.find((p) => String(p.id) === productSel.value);
    const options = (product && product.grind_options) || [];
    variantSel.innerHTML = '';
    options.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      variantSel.appendChild(opt);
    });
    variantSel.hidden = !options.length;
  };
  fillVariants();

  productSel.addEventListener('change', () => { fillVariants(); schedulePreview(); });
  variantSel.addEventListener('change', schedulePreview);
  qty.addEventListener('input', schedulePreview);

  row.append(productSel, variantSel, qty, removeBtn);
  wrap.appendChild(row);
  schedulePreview();
}

function collectItems() {
  return Array.from(document.querySelectorAll('.paylink-line')).map((row) => ({
    product_id: parseInt(row.querySelector('.line-product').value, 10),
    variant: row.querySelector('.line-variant').value || undefined,
    quantity: parseInt(row.querySelector('.line-qty').value, 10) || 1,
  }));
}

function collectPayload() {
  const expires = document.getElementById('fExpires').value;
  return {
    items: collectItems(),
    shipping_rate_id: document.getElementById('fShipping').value || null,
    coupon_code: document.getElementById('fCoupon').value.trim() || null,
    expires_at: expires ? new Date(expires).toISOString() : null,
    customer: {
      name: document.getElementById('fName').value.trim(),
      phone: document.getElementById('fPhone').value.trim(),
      email: document.getElementById('fEmail').value.trim(),
      address: document.getElementById('fAddress').value.trim(),
    },
  };
}

/* ---------------- resumen en vivo ---------------- */

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 300);
}

async function runPreview() {
  const summary = document.getElementById('summary');
  const errorEl = document.getElementById('formError');
  const payload = collectPayload();
  if (!payload.items.length) {
    summary.innerHTML = '';
    return;
  }

  const seq = ++previewSeq;
  const res = await fetch('/api/admin/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, preview: true }),
  });
  if (seq !== previewSeq || redirectIfUnauthorized(res)) return;
  const data = await res.json().catch(() => ({}));

  summary.innerHTML = '';
  if (!res.ok) {
    errorEl.textContent = data.message || 'No se pudo calcular el total.';
    return;
  }
  errorEl.textContent = '';

  const addRow = (label, value, isTotal) => {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    if (isTotal) { dt.classList.add('modal-total-row'); dd.classList.add('modal-total-row'); }
    summary.append(dt, dd);
  };
  data.lines.forEach((l) => addRow(`${l.quantity}x ${l.product_name}`, '$' + formatCOP(l.line_total_cop)));
  addRow('Subtotal', '$' + formatCOP(data.subtotal_cop));
  if (data.shipping_name) {
    addRow(
      `Envío (${data.shipping_name})`,
      data.free_shipping_applied ? `Gratis (antes $${formatCOP(data.shipping_original_cop)})` : '$' + formatCOP(data.shipping_cop)
    );
  }
  if (data.discount_cop > 0) addRow('Descuento', '-$' + formatCOP(data.discount_cop));
  addRow('Total a cobrar', '$' + formatCOP(data.amount_cop) + ' COP', true);
}

/* ---------------- crear link ---------------- */

async function createLink(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  errorEl.textContent = '';

  const payload = collectPayload();
  if (!payload.customer.name || !payload.customer.phone || !payload.customer.address) {
    errorEl.textContent = 'Completa nombre, celular y dirección del cliente.';
    return;
  }
  if (!payload.items.length) {
    errorEl.textContent = 'Agrega al menos un producto.';
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (redirectIfUnauthorized(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = data.message || 'No se pudo generar el link.';
      return;
    }

    document.getElementById('resultRef').textContent =
      `${data.reference} · $${formatCOP(data.amount_cop)} COP` + (data.environment === 'test' ? ' · modo Prueba' : '');
    document.getElementById('resultUrl').value = data.payment_url;
    document.getElementById('waBtn').href = waLink(payload.customer.phone, payload.customer.name, data.amount_cop, data.payment_url);
    document.getElementById('resultBox').hidden = false;
    document.getElementById('resultUrl').select();

    resetForm();
    await loadLinks();
  } finally {
    submitBtn.disabled = false;
  }
}

function resetForm() {
  ['fName', 'fPhone', 'fEmail', 'fAddress', 'fCoupon', 'fExpires'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('linesWrap').innerHTML = '';
  addLine();
}

/* ---------------- listado de links ---------------- */

async function loadLinks() {
  const res = await fetch('/api/admin/orders');
  if (redirectIfUnauthorized(res)) return;
  const tbody = document.getElementById('linksBody');
  const empty = document.getElementById('linksEmpty');
  if (!res.ok) {
    empty.textContent = 'No se pudieron cargar los links.';
    empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  const { orders } = await res.json();
  const links = orders.filter((o) => o.payment_url);
  tbody.innerHTML = '';
  empty.style.display = links.length ? 'none' : 'block';

  links.forEach((o) => {
    const tr = document.createElement('tr');

    const tdRef = document.createElement('td');
    tdRef.className = 'cell-ref';
    tdRef.textContent = o.reference;
    if (o.environment === 'test') {
      const badge = document.createElement('span');
      badge.className = 'env-badge env-test';
      badge.style.marginLeft = '.5em';
      badge.textContent = 'Prueba';
      tdRef.appendChild(badge);
    }

    const tdCustomer = document.createElement('td');
    tdCustomer.textContent = o.customer_name || '—';

    const tdAmount = document.createElement('td');
    tdAmount.textContent = '$' + formatCOP(o.amount_cop) + ' COP';

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge st-' + o.status;
    badge.textContent = STATUS_LABELS[o.status] || o.status;
    tdStatus.appendChild(badge);

    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(o.created_at).toLocaleString('es-CO');

    const tdActions = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'admin-inline-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copiar';
    copyBtn.addEventListener('click', () => copyText(o.payment_url, copyBtn));
    const waBtn = document.createElement('button');
    waBtn.type = 'button';
    waBtn.textContent = 'WhatsApp';
    waBtn.addEventListener('click', () => {
      window.open(waLink(o.customer_phone, o.customer_name, o.amount_cop, o.payment_url), '_blank', 'noopener');
    });
    actions.append(copyBtn, waBtn);
    tdActions.appendChild(actions);

    tr.append(tdRef, tdCustomer, tdAmount, tdStatus, tdDate, tdActions);
    tbody.appendChild(tr);
  });
}

/* ---------------- carga inicial ---------------- */

async function loadCatalog() {
  const [productsRes, ratesRes, envRes] = await Promise.all([
    fetch('/api/admin/products'),
    fetch('/api/admin/shipping-rates'),
    fetch('/api/admin/wompi-env'),
  ]);
  if (redirectIfUnauthorized(productsRes)) return;

  if (productsRes.ok) {
    const data = await productsRes.json();
    products = (data.products || []).filter((p) => p.status === 'active');
  }

  if (ratesRes.ok) {
    const { rates } = await ratesRes.json();
    const sel = document.getElementById('fShipping');
    rates.filter((r) => r.is_active).forEach((r, i) => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.name} — $${formatCOP(r.amount_cop)}`;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  if (envRes.ok) {
    const { environment } = await envRes.json();
    const banner = document.getElementById('envBanner');
    banner.className = 'wompi-env-banner env-' + environment;
    banner.textContent = environment === 'test'
      ? 'Wompi está en modo Prueba: los links que generes no cobran dinero real. Cámbialo en Pedidos.'
      : 'Wompi está en modo Producción: los links cobran dinero real.';
    banner.hidden = false;
  }

  if (!products.length) {
    document.getElementById('formError').textContent = 'No hay productos activos en el catálogo.';
    return;
  }
  addLine();
}

document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();
  loadLinks();
  document.getElementById('linkForm').addEventListener('submit', createLink);
  document.getElementById('addLineBtn').addEventListener('click', () => addLine());
  document.getElementById('fShipping').addEventListener('change', schedulePreview);
  document.getElementById('fCoupon').addEventListener('input', schedulePreview);
  document.getElementById('refreshBtn').addEventListener('click', loadLinks);
  document.getElementById('copyBtn').addEventListener('click', (e) => {
    copyText(document.getElementById('resultUrl').value, e.currentTarget);
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = '/admin/login';
  });
});
