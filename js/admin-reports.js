/* Café Arú — Backoffice: reporte de ingresos y costos (envíos y pauta) */

// El servidor devuelve los pedidos y los gastos del rango con su día (hora de
// Colombia) ya calculado. Aquí se arma la vista "día a día" -- donde se anota
// el costo real de envío de cada pedido y la pauta de ese día -- y el resumen
// agrupado por día/semana/mes para los informes y exportaciones.

const CATEGORY_LABELS = { ads: 'Pauta / anuncios', other: 'Otro gasto' };
const CHANNEL_LABELS = { wompi: 'Wompi', whatsapp: 'WhatsApp' };
const STATUS_LABELS = {
  approved: 'Aprobado',
  paid_manually: 'Pagado (manual)',
  shipped: 'Enviado',
  whatsapp_pending: 'Pendiente de pago',
};
const PAID_STATUSES = ['approved', 'paid_manually', 'shipped'];
const GROUP_TITLES = { day: 'Resumen por día', week: 'Resumen por semana', month: 'Resumen por mes' };
// En rangos cortos se listan todos los días (para poder anotar la pauta de un
// día sin ventas); en rangos largos solo los que tienen movimiento.
const MAX_LISTED_DAYS = 62;

let report = null; // { from, to, orders, expenses }
let openDays = null; // días desplegados; null = aún no se ha pintado nada

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function money(n) {
  return (n < 0 ? '-$' : '$') + formatCOP(Math.abs(n));
}

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

/* ---------------- fechas ---------------- */

// YYYY-MM-DD en la hora local del navegador (no toISOString, que es UTC y
// después de las 7 p.m. en Colombia ya marca el día siguiente).
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presetRange(preset) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const daysAgo = (n) => new Date(y, m, today.getDate() - n);
  switch (preset) {
    case 'today': return [today, today];
    case 'yesterday': return [daysAgo(1), daysAgo(1)];
    case 'last30': return [daysAgo(29), today];
    case 'thisMonth': return [new Date(y, m, 1), today];
    case 'lastMonth': return [new Date(y, m - 1, 1), new Date(y, m, 0)];
    case 'thisYear': return [new Date(y, 0, 1), today];
    case 'last7':
    default: return [daysAgo(6), today];
  }
}

function parseDay(day) {
  return new Date(`${day}T00:00:00Z`);
}

function dayLabel(day, opts) {
  return parseDay(day).toLocaleDateString('es-CO', { timeZone: 'UTC', ...opts });
}

function longDayLabel(day) {
  const label = dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Clave de agrupación: el propio día, el lunes de su semana o el mes.
function periodKey(day, group) {
  if (group === 'month') return day.slice(0, 7);
  if (group === 'week') {
    const d = parseDay(day);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}

function periodLabel(key, group) {
  if (group === 'month') {
    const label = dayLabel(`${key}-01`, { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (group === 'week') return 'Semana del ' + dayLabel(key, { day: '2-digit', month: 'short', year: 'numeric' });
  return dayLabel(key, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

// Días del rango, del más reciente al más antiguo.
function rangeDays() {
  const days = [];
  const d = parseDay(report.to);
  const start = parseDay(report.from);
  while (d >= start) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days;
}

/* ---------------- cálculo ---------------- */

function filteredOrders() {
  const channel = document.getElementById('fChannel').value;
  return report.orders.filter((o) => channel === 'all' || o.channel === channel);
}

function emptyBucket(key) {
  return {
    key, orders: 0, pending: 0, units: 0, income: 0, shippingCharged: 0, shippingCost: 0,
    wompiFee: 0, ads: 0, other: 0, missingCost: 0,
  };
}

// Comisión que Wompi descuenta de cada pago aprobado: (porcentaje + fijo) más
// IVA sobre esa comisión. Los pedidos de WhatsApp no pasan por Wompi. Se
// calcula con la tarifa actual, así que cambiarla recalcula todo el historial.
// Respaldo por si la API no manda la tarifa (ej. un servidor con código
// viejo): mejor un reporte con la tarifa estándar que una página en blanco.
function currentWompiFee() {
  return report.wompi_fee || { percent: 2.65, fixed_cop: 700, vat_percent: 19 };
}

function wompiFee(o) {
  if (o.channel !== 'wompi' || !PAID_STATUSES.includes(o.status)) return 0;
  const fee = currentWompiFee();
  const base = (Number(o.amount_cop || 0) * fee.percent) / 100 + fee.fixed_cop;
  return Math.round(base * (1 + fee.vat_percent / 100));
}

// Solo los pedidos pagados suman ingresos; el costo de envío anotado cuenta
// siempre, porque ese dinero ya salió aunque el cliente aún no haya pagado.
function addOrder(b, o) {
  if (PAID_STATUSES.includes(o.status)) {
    b.orders += 1;
    b.units += Number(o.quantity || 0);
    b.income += Number(o.amount_cop || 0);
    b.shippingCharged += Number(o.shipping_cop || 0);
    b.wompiFee += wompiFee(o);
  } else {
    b.pending += 1;
  }
  if (o.shipping_cost_cop === null || o.shipping_cost_cop === undefined) b.missingCost += 1;
  else b.shippingCost += Number(o.shipping_cost_cop);
}

function addExpense(b, e) {
  b[e.category === 'ads' ? 'ads' : 'other'] += Number(e.amount_cop || 0);
}

function finish(b) {
  b.profit = b.income - b.shippingCost - b.wompiFee - b.ads - b.other;
  return b;
}

function buildSummary(group) {
  const buckets = new Map();
  const bucket = (day) => {
    const key = periodKey(day, group);
    if (!buckets.has(key)) buckets.set(key, emptyBucket(key));
    return buckets.get(key);
  };
  filteredOrders().forEach((o) => addOrder(bucket(o.day), o));
  report.expenses.forEach((e) => addExpense(bucket(e.day), e));

  const rows = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key)).map(finish);
  const total = emptyBucket('total');
  rows.forEach((r) => {
    Object.keys(total).forEach((k) => { if (k !== 'key') total[k] += r[k]; });
  });
  return { rows, total: finish(total) };
}

function dayData(day) {
  const orders = filteredOrders().filter((o) => o.day === day);
  const expenses = report.expenses.filter((e) => e.day === day);
  const b = emptyBucket(day);
  orders.forEach((o) => addOrder(b, o));
  expenses.forEach((e) => addExpense(b, e));
  return { orders, expenses, stats: finish(b) };
}

/* ---------------- resumen y tarjetas ---------------- */

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function summaryCells(r, label) {
  return [
    cell(label),
    cell(String(r.orders), 'num'),
    cell(String(r.units), 'num'),
    cell(money(r.income), 'num'),
    cell(money(r.shippingCharged), 'num'),
    cell(money(r.shippingCost) + (r.missingCost ? ` (${r.missingCost} sin registrar)` : ''), 'num'),
    cell(money(r.wompiFee), 'num'),
    cell(money(r.ads), 'num'),
    cell(money(r.other), 'num'),
    cell(money(r.profit), 'num' + (r.profit < 0 ? ' is-negative' : '')),
  ];
}

function renderSummary() {
  const group = document.getElementById('fGroup').value;
  const { rows, total } = buildSummary(group);

  document.getElementById('summaryTitle').textContent = GROUP_TITLES[group];
  const tbody = document.getElementById('summaryBody');
  const tfoot = document.getElementById('summaryFoot');
  tbody.innerHTML = '';
  tfoot.innerHTML = '';
  document.getElementById('summaryEmpty').style.display = rows.length ? 'none' : 'block';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.append(...summaryCells(r, periodLabel(r.key, group)));
    tbody.appendChild(tr);
  });
  if (rows.length > 1) {
    const tr = document.createElement('tr');
    tr.append(...summaryCells(total, 'Total'));
    tfoot.appendChild(tr);
  }

  const setStat = (id, value, negative) => {
    const el = document.getElementById(id);
    el.textContent = value;
    el.classList.toggle('is-negative', Boolean(negative));
  };
  setStat('statIncome', money(total.income));
  setStat('statShipping', money(total.shippingCost));
  setStat('statFee', money(total.wompiFee));
  setStat('statAds', money(total.ads));
  setStat('statOther', money(total.other));
  setStat('statProfit', money(total.profit), total.profit < 0);
  document.getElementById('statOrders').textContent =
    `${plural(total.orders, 'pedido pagado', 'pedidos pagados')} · ${plural(total.units, 'unidad', 'unidades')}`;
  document.getElementById('statShippingSub').textContent = `Cobrado al cliente: ${money(total.shippingCharged)}`;
  document.getElementById('statMargin').textContent = total.income
    ? `Margen: ${((total.profit / total.income) * 100).toFixed(1).replace('.', ',')}%`
    : '';

  const banner = document.getElementById('missingCostBanner');
  banner.hidden = !total.missingCost;
  banner.textContent = total.missingCost
    ? `Hay ${plural(total.missingCost, 'pedido', 'pedidos')} sin costo de envío registrado: la utilidad puede estar inflada. Ábrelos en "Día a día" (están marcados en amarillo).`
    : '';

  const from = dayLabel(report.from, { day: '2-digit', month: 'long', year: 'numeric' });
  const to = dayLabel(report.to, { day: '2-digit', month: 'long', year: 'numeric' });
  const channel = document.getElementById('fChannel');
  document.getElementById('reportTitle').textContent =
    (report.from === report.to ? `Reporte del ${from}` : `Reporte del ${from} al ${to}`) +
    (channel.value === 'all' ? '' : ` · ${channel.options[channel.selectedIndex].text}`);
}

/* ---------------- día a día ---------------- */

function fillDayHeader(summaryEl, day) {
  const { stats: s } = dayData(day);
  summaryEl.innerHTML = '';

  const date = document.createElement('span');
  date.className = 'report-day-date';
  date.textContent = longDayLabel(day) + (day === isoDay(new Date()) ? ' · Hoy' : '');

  const metrics = document.createElement('span');
  metrics.className = 'report-day-metrics';
  const parts = [
    plural(s.orders, 'pedido', 'pedidos') + (s.pending ? ` (+${s.pending} pendiente${s.pending === 1 ? '' : 's'})` : ''),
    `Ingresos ${money(s.income)}`,
    `Envíos ${money(s.shippingCost)}`,
  ];
  if (s.wompiFee) parts.push(`Comisión Wompi ${money(s.wompiFee)}`);
  parts.push(`Pauta ${money(s.ads)}`);
  if (s.other) parts.push(`Otros ${money(s.other)}`);
  parts.forEach((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    metrics.appendChild(span);
  });
  const profit = document.createElement('strong');
  profit.textContent = `Utilidad ${money(s.profit)}`;
  if (s.profit < 0) profit.className = 'is-negative';
  metrics.appendChild(profit);

  summaryEl.append(date, metrics);
  if (s.missingCost) {
    const warn = document.createElement('span');
    warn.className = 'report-day-warn';
    warn.textContent = `${s.missingCost} sin costo de envío`;
    summaryEl.appendChild(warn);
  }
}

// En pedidos de Wompi el total cobrado al cliente va tachado y al lado lo
// que de verdad llega a la cuenta, ya sin la comisión.
function totalCell(o) {
  const fee = wompiFee(o);
  if (!fee) return cell(money(o.amount_cop), 'num');
  const td = document.createElement('td');
  td.className = 'num';
  const gross = document.createElement('s');
  gross.className = 'report-gross';
  gross.textContent = money(o.amount_cop);
  const net = document.createElement('strong');
  net.textContent = money(Number(o.amount_cop) - fee);
  td.title = 'Total cobrado al cliente, y lo que queda después de la comisión de Wompi';
  td.append(gross, ' ', net);
  return td;
}

function renderOrdersTable(day, orders, summaryEl) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-table-wrap';
  if (!orders.length) {
    const p = document.createElement('p');
    p.className = 'report-day-empty';
    p.textContent = 'Sin pedidos este día.';
    wrap.appendChild(p);
    return wrap;
  }

  const table = document.createElement('table');
  table.className = 'admin-table report-table';
  table.innerHTML = '<thead><tr><th>Hora</th><th>Referencia</th><th>Cliente</th><th>Canal</th><th>Estado</th>' +
    '<th class="num">Total</th><th class="num">Comisión Wompi</th><th class="num">Envío cobrado</th>' +
    '<th>Costo real del envío</th></tr></thead>';
  const tbody = document.createElement('tbody');

  orders.forEach((o) => {
    const tr = document.createElement('tr');

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge st-' + o.status;
    badge.textContent = STATUS_LABELS[o.status] || o.status;
    tdStatus.appendChild(badge);

    const tdCost = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '100';
    input.className = 'report-cost-input';
    input.placeholder = 'Sin registrar';
    input.value = o.shipping_cost_cop ?? '';
    input.setAttribute('aria-label', `Costo real del envío de ${o.reference}`);
    input.classList.toggle('cost-missing', o.shipping_cost_cop === null);
    const saved = document.createElement('span');
    saved.className = 'cost-saved';
    // En el PDF la casilla se oculta y va el valor como texto.
    const printed = document.createElement('span');
    printed.className = 'print-only';
    const fillPrinted = () => {
      printed.textContent = o.shipping_cost_cop === null ? 'Sin registrar' : money(o.shipping_cost_cop);
    };
    fillPrinted();
    input.addEventListener('change', () => saveShippingCost(o, input, saved, () => {
      fillPrinted();
      fillDayHeader(summaryEl, day);
    }));
    tdCost.append(input, saved, printed);

    tr.append(
      cell(new Date(o.created_at).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })),
      cell(o.reference, 'cell-ref'),
      cell(o.customer_name || '—'),
      cell(CHANNEL_LABELS[o.channel] || o.channel),
      tdStatus,
      totalCell(o),
      cell(wompiFee(o) ? money(wompiFee(o)) : '—', 'num'),
      cell(o.shipping_name ? money(o.shipping_cop) : '—', 'num'),
      tdCost
    );
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderExpensesBlock(day, expenses) {
  const block = document.createElement('div');
  block.className = 'report-day-expenses';
  if (!expenses.length) {
    const none = document.createElement('p');
    none.className = 'report-day-empty print-only';
    none.textContent = 'Sin gastos este día.';
    block.appendChild(none);
  }

  expenses.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'report-expense-row';
    const label = document.createElement('span');
    label.textContent = CATEGORY_LABELS[e.category] || e.category;
    const note = document.createElement('span');
    note.className = 'report-expense-note';
    note.textContent = e.note || '';
    const amount = document.createElement('strong');
    amount.textContent = money(e.amount_cop);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'line-remove no-print';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Eliminar gasto');
    del.addEventListener('click', () => deleteExpense(e));
    row.append(label, note, amount, del);
    block.appendChild(row);
  });

  const form = document.createElement('form');
  form.className = 'report-expense-form no-print';
  form.noValidate = true;
  form.innerHTML = `
    <select aria-label="Tipo de gasto">
      <option value="ads">Pauta / anuncios</option>
      <option value="other">Otro gasto</option>
    </select>
    <input type="number" min="0" step="100" placeholder="Monto (COP)" aria-label="Monto del gasto">
    <input type="text" placeholder="Nota (opcional), ej: Meta Ads" aria-label="Nota del gasto" maxlength="300">
    <button type="submit" class="btn btn-primary btn-sm">Agregar gasto</button>
    <span class="admin-form-error"></span>
  `;
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const [category, amount, note] = form.querySelectorAll('select, input');
    submitExpense(form, { day, category: category.value, amount_cop: Number(amount.value), note: note.value.trim() });
  });
  block.appendChild(form);
  return block;
}

function renderDays() {
  const wrap = document.getElementById('daysWrap');
  const onlyActive = document.getElementById('onlyActive').checked;
  const today = isoDay(new Date());
  wrap.innerHTML = '';

  const all = rangeDays();
  const days = all.filter((day) => {
    if (!onlyActive && all.length <= MAX_LISTED_DAYS) return true;
    const { orders, expenses } = dayData(day);
    return orders.length || expenses.length;
  });
  document.getElementById('daysEmpty').style.display = days.length ? 'none' : 'block';

  // La primera vez se abre hoy (o el día más reciente con pedidos).
  if (!openDays) {
    openDays = new Set();
    const first = days.includes(today) ? today : days.find((d) => dayData(d).orders.length);
    if (first) openDays.add(first);
  }

  days.forEach((day) => {
    const { orders, expenses } = dayData(day);
    const details = document.createElement('details');
    // Los días sin pedidos ni gastos no salen en el PDF.
    details.className = 'report-day' + (orders.length || expenses.length ? '' : ' is-empty');
    details.open = openDays.has(day);
    details.addEventListener('toggle', () => {
      if (details.open) openDays.add(day); else openDays.delete(day);
    });

    const summary = document.createElement('summary');
    fillDayHeader(summary, day);

    const body = document.createElement('div');
    body.className = 'report-day-body';
    const h1 = document.createElement('h4');
    h1.textContent = 'Pedidos y costo de envío';
    const h2 = document.createElement('h4');
    h2.textContent = 'Pauta y gastos del día';
    body.append(h1, renderOrdersTable(day, orders, summary), h2, renderExpensesBlock(day, expenses));

    details.append(summary, body);
    wrap.appendChild(details);
  });
}

function renderAll() {
  if (!report) return;
  renderSummary();
  renderDays();
  renderWompiFeeForm();
}

/* ---------------- comisión de Wompi ---------------- */

function renderWompiFeeForm() {
  const fee = currentWompiFee();
  document.getElementById('feePercent').value = fee.percent;
  document.getElementById('feeFixed').value = fee.fixed_cop;
  document.getElementById('feeVat').value = fee.vat_percent;
  const example = 100000;
  const exampleFee = Math.round(((example * fee.percent) / 100 + fee.fixed_cop) * (1 + fee.vat_percent / 100));
  document.getElementById('feeExample').textContent =
    `Ejemplo: en una venta de ${money(example)} Wompi se queda con ${money(exampleFee)}.`;
}

async function saveWompiFee(e) {
  e.preventDefault();
  const errorEl = document.getElementById('feeError');
  const btn = document.getElementById('feeSubmitBtn');
  errorEl.textContent = '';
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: 'wompi_fee',
        percent: Number(document.getElementById('feePercent').value),
        fixed_cop: Number(document.getElementById('feeFixed').value),
        vat_percent: Number(document.getElementById('feeVat').value),
      }),
    });
    if (redirectIfUnauthorized(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = data.message || 'No se pudo guardar la comisión.';
      return;
    }
    report.wompi_fee = data.wompi_fee;
    renderAll();
    errorEl.textContent = '';
    btn.textContent = '¡Guardado!';
    setTimeout(() => { btn.textContent = 'Guardar comisión'; }, 1500);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- acciones ---------------- */

async function loadReport() {
  const from = document.getElementById('fFrom').value;
  const to = document.getElementById('fTo').value;
  const errorEl = document.getElementById('filtersError');
  errorEl.textContent = '';
  if (!from || !to) return;
  if (from > to) {
    errorEl.textContent = 'La fecha "Desde" debe ser anterior a "Hasta".';
    return;
  }

  const res = await fetch(`/api/admin/orders?view=report&from=${from}&to=${to}`);
  if (redirectIfUnauthorized(res)) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    errorEl.textContent = data.message || 'No se pudo cargar el reporte. Intenta de nuevo en un momento.';
    return;
  }
  report = data;
  renderAll();
}

async function saveShippingCost(order, input, savedEl, onSaved) {
  const value = input.value === '' ? null : Number(input.value);
  input.disabled = true;
  savedEl.textContent = '';
  try {
    const res = await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, shipping_cost_cop: value }),
    });
    if (redirectIfUnauthorized(res)) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.message || 'No se pudo guardar el costo de envío.');
      input.value = order.shipping_cost_cop ?? '';
      return;
    }
    order.shipping_cost_cop = value === null ? null : Math.round(value);
    input.classList.toggle('cost-missing', value === null);
    savedEl.textContent = '✓ Guardado';
    // Solo se recalculan totales y el encabezado del día: re-pintar la tabla
    // le quitaría el foco al siguiente campo mientras se llenan en serie.
    renderSummary();
    onSaved();
  } finally {
    input.disabled = false;
  }
}

async function submitExpense(form, payload) {
  const errorEl = form.querySelector('.admin-form-error');
  const btn = form.querySelector('button');
  errorEl.textContent = '';
  if (!(payload.amount_cop > 0)) {
    errorEl.textContent = 'Escribe un monto mayor a 0.';
    return;
  }

  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'expense', ...payload }),
    });
    if (redirectIfUnauthorized(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = data.message || 'No se pudo guardar el gasto.';
      return;
    }
    report.expenses.push(data.expense);
    renderAll();
  } finally {
    btn.disabled = false;
  }
}

async function deleteExpense(expense) {
  const label = `${CATEGORY_LABELS[expense.category] || expense.category} de ${money(expense.amount_cop)}`;
  if (!confirm(`¿Eliminar el gasto "${label}"?`)) return;
  const res = await fetch(`/api/admin/orders?expense_id=${expense.id}`, { method: 'DELETE' });
  if (redirectIfUnauthorized(res)) return;
  if (!res.ok) {
    alert('No se pudo eliminar el gasto.');
    return;
  }
  report.expenses = report.expenses.filter((e) => e.id !== expense.id);
  renderAll();
}

/* ---------------- exportar ---------------- */

// Punto y coma como separador y BOM UTF-8: así Excel en español lo abre en
// columnas y con tildes correctas sin pasar por "Importar datos".
function downloadCsv(filename, rows) {
  const escapeCell = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(escapeCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileSuffix() {
  const channel = document.getElementById('fChannel').value;
  return `${report.from}_a_${report.to}${channel === 'all' ? '' : '-' + channel}`;
}

function exportSummary() {
  if (!report) return;
  const group = document.getElementById('fGroup').value;
  const { rows, total } = buildSummary(group);
  const header = ['Período', 'Pedidos pagados', 'Unidades', 'Ingresos', 'Envío cobrado', 'Costo envío',
    'Pedidos sin costo de envío', 'Comisión Wompi', 'Pauta', 'Otros gastos', 'Utilidad'];
  const line = (r, label) => [label, r.orders, r.units, r.income, r.shippingCharged, r.shippingCost,
    r.missingCost, r.wompiFee, r.ads, r.other, r.profit];
  downloadCsv(`reporte-cafe-aru-${fileSuffix()}.csv`, [
    header,
    ...rows.map((r) => line(r, group === 'day' ? r.key : periodLabel(r.key, group))),
    line(total, 'Total'),
  ]);
}

// Libro de movimientos: una fila por pedido (ingreso y su costo de envío) y
// una por gasto, ordenadas por fecha. Útil para contabilidad.
function exportDetail() {
  if (!report) return;
  const movements = [
    ...filteredOrders().map((o) => {
      const paid = PAID_STATUSES.includes(o.status);
      return {
        day: o.day,
        sort: o.created_at,
        cols: [paid ? 'Venta' : 'Venta pendiente de pago', o.reference, o.customer_name || '',
          CHANNEL_LABELS[o.channel] || o.channel, paid ? o.amount_cop : 0, o.shipping_cop,
          o.shipping_cost_cop ?? '', wompiFee(o), ''],
      };
    }),
    ...report.expenses.map((e) => ({
      day: e.day,
      sort: e.created_at,
      cols: [CATEGORY_LABELS[e.category] || e.category, '', e.note || '', '', '', '', '', '', e.amount_cop],
    })),
  ].sort((a, b) => (a.day + a.sort).localeCompare(b.day + b.sort));

  downloadCsv(`movimientos-cafe-aru-${fileSuffix()}.csv`, [
    ['Fecha', 'Tipo', 'Referencia', 'Cliente / nota', 'Canal', 'Ingreso', 'Envío cobrado', 'Costo envío',
      'Comisión Wompi', 'Gasto'],
    ...movements.map((m) => [m.day, ...m.cols]),
  ]);
}

/* ---------------- carga inicial ---------------- */

function applyPreset() {
  const preset = document.getElementById('fPreset').value;
  if (preset === 'custom') return;
  const [from, to] = presetRange(preset);
  document.getElementById('fFrom').value = isoDay(from);
  document.getElementById('fTo').value = isoDay(to);
  loadReport();
}

document.addEventListener('DOMContentLoaded', () => {
  applyPreset();

  document.getElementById('fPreset').addEventListener('change', applyPreset);
  ['fFrom', 'fTo'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      document.getElementById('fPreset').value = 'custom';
      loadReport();
    });
  });
  document.getElementById('fGroup').addEventListener('change', () => { if (report) renderSummary(); });
  document.getElementById('fChannel').addEventListener('change', renderAll);
  document.getElementById('onlyActive').addEventListener('change', () => { if (report) renderDays(); });
  document.getElementById('filtersForm').addEventListener('submit', (e) => { e.preventDefault(); loadReport(); });
  document.getElementById('feeForm').addEventListener('submit', saveWompiFee);
  document.getElementById('exportSummaryBtn').addEventListener('click', exportSummary);
  document.getElementById('exportDetailBtn').addEventListener('click', exportDetail);
  document.getElementById('printBtn').addEventListener('click', () => window.print());

  // Al imprimir (botón o Ctrl+P) se abren todos los días para que el PDF
  // lleve el detalle completo; después se dejan como estaban.
  let openBeforePrint = null;
  window.addEventListener('beforeprint', () => {
    const days = document.querySelectorAll('.report-day');
    openBeforePrint = Array.from(days).map((d) => d.open);
    days.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!openBeforePrint) return;
    document.querySelectorAll('.report-day').forEach((d, i) => { d.open = Boolean(openBeforePrint[i]); });
    openBeforePrint = null;
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = '/admin/login';
  });
});
