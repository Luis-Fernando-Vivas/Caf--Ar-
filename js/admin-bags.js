/* Café Arú — Backoffice: registro personal de bolsas (llegadas y ventas) */

// El servidor devuelve el catálogo, los movimientos anotados a mano (llegadas
// y otras salidas) y las ventas de los pedidos enviados. Aquí se juntan por
// producto + variación y por día, y se calcula cuántas bolsas quedan. No
// tiene relación con el stock de la tienda.

const ENTRY_LABELS = { in: 'Llegada', out: 'Otra salida', sale: 'Venta enviada' };
const CHANNEL_LABELS = { wompi: 'Página', whatsapp: 'WhatsApp' };
// Registros de la primera versión de esta página, que no tenían producto.
const LEGACY_GRIND_LABELS = { grano: 'En grano', molido: 'Molido' };
const KIND_HINTS = {
  in: 'Anota las bolsas que te llegaron. Las ventas de los pedidos se descuentan solas cuando los marcas como enviados.',
  out: 'Solo para bolsas que salieron sin pedido en el sistema (un regalo, una venta que no se anotó). Las ventas de los pedidos ya se descuentan solas.',
};

let data = { products: [], movements: [], sales: [] };
let openDays = new Set();

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function redirectIfUnauthorized(res) {
  if (res.status === 401) {
    window.location.href = '/admin/login';
    return true;
  }
  return false;
}

// YYYY-MM-DD en la hora local del navegador (no toISOString, que es UTC).
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function longDayLabel(day) {
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString('es-CO', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* ---------------- producto + variación ---------------- */

function productById(id) {
  return data.products.find((p) => p.id === id);
}

// Todo se agrupa por esta clave: mismo producto y misma variación.
function itemKey(productId, variant) {
  return `${productId ?? 'none'}|${variant ?? ''}`;
}

// Movimientos y ventas en un solo formato: { kind, day, key, name, variant,
// quantity, detail, movement? }. "name" usa el nombre actual del producto si
// aún existe (por si se renombró).
function entries() {
  const list = [];
  data.movements.forEach((m) => {
    const legacy = !m.product_id;
    const variant = legacy ? LEGACY_GRIND_LABELS[m.grind] || null : m.variant;
    const product = productById(m.product_id);
    list.push({
      kind: m.kind,
      day: m.day,
      key: legacy ? `legacy|${m.grind}` : itemKey(m.product_id, m.variant),
      name: product ? product.name : (m.product_name || 'Café (registro anterior)'),
      variant,
      quantity: m.quantity,
      detail: m.note,
      movement: m,
    });
  });
  data.sales.forEach((s) => {
    const product = productById(s.product_id);
    const who = s.customer_name ? ` · ${s.customer_name}` : '';
    list.push({
      kind: 'sale',
      day: s.day,
      key: itemKey(s.product_id, s.variant),
      name: product ? product.name : s.product_name,
      variant: s.variant,
      quantity: s.quantity,
      detail: `${CHANNEL_LABELS[s.channel] || s.channel} · ${s.reference}${who}`,
    });
  });
  return list;
}

function signed(e) {
  return e.kind === 'in' ? e.quantity : -e.quantity;
}

// Orden de la tabla: el del catálogo, y dentro de cada producto el de sus
// variaciones; lo que ya no está en el catálogo va al final.
function sortRank(row) {
  const productId = row.key.split('|')[0];
  const pIdx = data.products.findIndex((p) => String(p.id) === productId);
  if (pIdx === -1) return [Infinity, 0];
  const vIdx = (data.products[pIdx].grind_options || []).indexOf(row.variant);
  return [pIdx, vIdx === -1 ? Infinity : vIdx];
}

function stockRows(list) {
  const rows = new Map();
  list.forEach((e) => {
    if (!rows.has(e.key)) rows.set(e.key, { key: e.key, name: e.name, variant: e.variant, in: 0, sale: 0, out: 0 });
    rows.get(e.key)[e.kind] += e.quantity;
  });
  return [...rows.values()]
    .map((r) => ({ ...r, left: r.in - r.sale - r.out }))
    .sort((a, b) => {
      const [ap, av] = sortRank(a);
      const [bp, bv] = sortRank(b);
      return ap - bp || av - bv || a.name.localeCompare(b.name);
    });
}

// Bolsas de ese producto y variación al cierre del día indicado (para avisar
// si se registra una salida de más bolsas de las que hay).
function availableOn(day, key) {
  return entries()
    .filter((e) => e.day <= day && e.key === key)
    .reduce((sum, e) => sum + signed(e), 0);
}

/* ---------------- pintado ---------------- */

function setNumber(id, value) {
  const el = document.getElementById(id);
  el.textContent = value;
  el.classList.toggle('is-negative', value < 0);
}

function numCell(value, negative) {
  const td = document.createElement('td');
  td.className = 'num';
  td.textContent = value;
  if (negative) td.classList.add('is-negative');
  return td;
}

function textCell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderStock(list) {
  const rows = stockRows(list);
  const sum = (field) => rows.reduce((s, r) => s + r[field], 0);
  setNumber('statStock', sum('left'));
  setNumber('statIn', sum('in'));
  setNumber('statSold', sum('sale'));
  setNumber('statOut', sum('out'));

  const tbody = document.getElementById('stockBody');
  tbody.innerHTML = '';
  document.getElementById('stockEmpty').style.display = rows.length ? 'none' : 'block';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.append(
      textCell(r.name),
      textCell(r.variant || '—'),
      numCell(r.in),
      numCell(r.sale),
      numCell(r.out),
      numCell(r.left, r.left < 0)
    );
    tr.lastChild.classList.add('bags-left');
    tbody.appendChild(tr);
  });
}

function metric(label, value, negative) {
  const span = document.createElement('span');
  span.append(label + ' ');
  const strong = document.createElement('strong');
  strong.textContent = value;
  if (negative) strong.classList.add('is-negative');
  span.appendChild(strong);
  return span;
}

function renderDay(d) {
  const details = document.createElement('details');
  details.className = 'report-day';
  details.open = openDays.has(d.day);
  details.addEventListener('toggle', () => {
    if (details.open) openDays.add(d.day);
    else openDays.delete(d.day);
  });

  const summary = document.createElement('summary');
  const date = document.createElement('span');
  date.className = 'report-day-date';
  date.textContent = longDayLabel(d.day);
  const metrics = document.createElement('span');
  metrics.className = 'report-day-metrics';
  const total = (kind) => d.entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.quantity, 0);
  if (total('in')) metrics.appendChild(metric('Llegaron', total('in')));
  if (total('sale')) metrics.appendChild(metric('Enviadas', total('sale')));
  if (total('out')) metrics.appendChild(metric('Otras salidas', total('out')));
  metrics.appendChild(metric('Quedaban al cierre', d.balance, d.balance < 0));
  summary.append(date, metrics);

  const body = document.createElement('div');
  body.className = 'report-day-body';
  const wrap = document.createElement('div');
  wrap.className = 'admin-table-wrap';
  const table = document.createElement('table');
  table.className = 'admin-table bags-table';
  table.innerHTML = '<thead><tr><th>Movimiento</th><th>Producto</th><th>Variación</th><th class="num">Bolsas</th><th>Detalle</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  d.entries.forEach((e) => {
    const tr = document.createElement('tr');
    const tdKind = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status-badge bag-kind-${e.kind}`;
    badge.textContent = ENTRY_LABELS[e.kind];
    tdKind.appendChild(badge);

    const tdActions = document.createElement('td');
    if (e.movement) {
      const actions = document.createElement('div');
      actions.className = 'admin-inline-actions';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Eliminar';
      del.addEventListener('click', () => deleteMovement(e));
      actions.appendChild(del);
      tdActions.appendChild(actions);
    }

    tr.append(
      tdKind,
      textCell(e.name),
      textCell(e.variant || '—'),
      numCell((e.kind === 'in' ? '+' : '−') + e.quantity),
      textCell(e.detail || '—', 'bags-note'),
      tdActions
    );
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);

  details.append(summary, body);
  return details;
}

function renderDays(list) {
  const byDay = new Map();
  list.forEach((e) => {
    if (!byDay.has(e.day)) byDay.set(e.day, { day: e.day, entries: [] });
    byDay.get(e.day).entries.push(e);
  });
  let balance = 0;
  const days = [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => {
      balance += d.entries.reduce((s, e) => s + signed(e), 0);
      return { ...d, balance };
    })
    .reverse(); // el más reciente primero

  const wrap = document.getElementById('daysWrap');
  wrap.innerHTML = '';
  document.getElementById('daysEmpty').style.display = days.length ? 'none' : 'block';
  days.forEach((d) => wrap.appendChild(renderDay(d)));
}

function render() {
  const list = entries();
  renderStock(list);
  renderDays(list);
}

/* ---------------- formulario ---------------- */

// El catálogo se lee en cada carga, así un producto nuevo aparece solo. Los
// archivados no se ofrecen (sus ventas siguen contando en la tabla).
function renderProductOptions() {
  const select = document.getElementById('fProduct');
  const current = Number(select.value);
  const available = data.products.filter((p) => p.status !== 'archived');
  select.innerHTML = '';
  available.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.status === 'draft' ? `${p.name} (borrador)` : p.name;
    select.appendChild(opt);
  });
  if (available.some((p) => p.id === current)) select.value = current;
  renderVariantOptions();
}

function renderVariantOptions() {
  const product = productById(Number(document.getElementById('fProduct').value));
  const options = (product && product.grind_options) || [];
  const select = document.getElementById('fVariant');
  const current = select.value;
  select.innerHTML = '';
  options.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
  if (options.includes(current)) select.value = current;
  document.getElementById('variantField').hidden = !options.length;
}

function selectedKind() {
  return document.querySelector('input[name="kind"]:checked').value;
}

function syncKind() {
  const kind = selectedKind();
  document.getElementById('submitBtn').textContent = kind === 'in' ? 'Registrar llegada' : 'Registrar salida';
  document.getElementById('kindHint').textContent = KIND_HINTS[kind];
}

async function createMovement(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const productId = Number(document.getElementById('fProduct').value);
  const product = productById(productId);
  const variant = (product && (product.grind_options || []).length) ? document.getElementById('fVariant').value : null;
  const payload = {
    resource: 'bag',
    kind: selectedKind(),
    day: document.getElementById('fDay').value,
    product_id: productId,
    variant,
    quantity: Number(document.getElementById('fQty').value),
    note: document.getElementById('fNote').value.trim(),
  };
  if (!payload.day) {
    errorEl.textContent = 'Elige la fecha.';
    return;
  }
  if (!product) {
    errorEl.textContent = 'Elige el producto.';
    return;
  }
  if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
    errorEl.textContent = 'La cantidad debe ser un número entero mayor a 0.';
    return;
  }
  if (payload.kind === 'out') {
    const available = availableOn(payload.day, itemKey(productId, variant));
    if (payload.quantity > available) {
      const what = variant ? `${product.name} — ${variant}` : product.name;
      const ok = confirm(
        `Al cierre de ese día quedaban ${plural(available, 'bolsa', 'bolsas')} de ${what}. ` +
        '¿Registrar la salida de todas formas?'
      );
      if (!ok) return;
    }
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (redirectIfUnauthorized(res)) return;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = body.message || 'No se pudo registrar.';
      return;
    }
    document.getElementById('fQty').value = '';
    document.getElementById('fNote').value = '';
    openDays.add(payload.day);
    await loadData();
  } finally {
    btn.disabled = false;
  }
}

async function deleteMovement(e) {
  const what = `${ENTRY_LABELS[e.kind].toLowerCase()} de ${plural(e.quantity, 'bolsa', 'bolsas')} de ${e.name}${e.variant ? ' — ' + e.variant : ''}`;
  if (!confirm(`¿Eliminar este movimiento (${what})?`)) return;
  const res = await fetch(`/api/admin/orders?bag_id=${e.movement.id}`, { method: 'DELETE' });
  if (redirectIfUnauthorized(res)) return;
  if (!res.ok) {
    alert('No se pudo eliminar el movimiento.');
    return;
  }
  await loadData();
}

/* ---------------- datos ---------------- */

async function loadData() {
  const res = await fetch('/api/admin/orders?view=bags');
  if (redirectIfUnauthorized(res)) return;
  if (!res.ok) {
    const empty = document.getElementById('daysEmpty');
    empty.textContent = 'No se pudo cargar el registro de bolsas.';
    empty.style.display = 'block';
    return;
  }
  data = await res.json();
  renderProductOptions();
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fDay').value = todayIso();
  openDays.add(todayIso());
  syncKind();
  loadData();
  document.getElementById('bagForm').addEventListener('submit', createMovement);
  document.getElementById('fProduct').addEventListener('change', renderVariantOptions);
  document.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener('change', syncKind));
  document.getElementById('refreshBtn').addEventListener('click', loadData);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = '/admin/login';
  });
});
