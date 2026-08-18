/* Café Arú — Backoffice (login + panel de pedidos) */

const STATUS_LABELS = {
  pending: 'Pendiente (Wompi)',
  approved: 'Aprobado',
  declined: 'Rechazado',
  voided: 'Anulado',
  whatsapp_pending: 'Pendiente (WhatsApp)',
  paid_manually: 'Pagado (manual)',
  shipped: 'Enviado',
  cancelled: 'Cancelado',
};
const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
const PAID_STATUSES = ['approved', 'paid_manually', 'shipped'];

// Colores de marca validados (contraste + separación CVD) con scripts/validate_palette.js
// de la skill dataviz -- ver conversación para el detalle de la corrida.
const CHANNEL_COLORS = { wompi: '#b32027', whatsapp: '#c9822e' };
// Los estados son un job de "status" (bueno/alerta/crítico), no identidad categórica,
// así que usan la paleta de status fija, no colores inventados por serie.
const STATUS_BUCKET = {
  approved: 'good', paid_manually: 'good', shipped: 'good',
  pending: 'warning', whatsapp_pending: 'warning',
  declined: 'critical', cancelled: 'critical', voided: 'critical',
};
const BUCKET_COLORS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

const ENV_LABELS = { test: 'Prueba', prod: 'Producción' };

function formatCOP(n){
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits:0 });
}

/* ---------------- svg + tooltip helpers ---------------- */
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}){
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function niceCeiling(v){
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / exp;
  let niceFrac = 10;
  if (frac <= 1) niceFrac = 1;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 5) niceFrac = 5;
  return niceFrac * exp;
}

// Barra horizontal cuadrada en la base (el eje) y redondeada solo en la punta
// (el "dato"), en vez de redondear las cuatro esquinas parejo.
function roundedBarPath(x0, y0, w, h, r){
  const x1 = x0 + w;
  r = Math.min(r, w, h / 2);
  if (w <= r || r <= 0) {
    return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y0 + h} L ${x0} ${y0 + h} Z`;
  }
  return `M ${x0} ${y0} L ${x1 - r} ${y0} Q ${x1} ${y0} ${x1} ${y0 + r} ` +
    `L ${x1} ${y0 + h - r} Q ${x1} ${y0 + h} ${x1 - r} ${y0 + h} L ${x0} ${y0 + h} Z`;
}

function showTooltip(clientX, clientY, titleText, rows){
  const tt = document.getElementById('vizTooltip');
  if (!tt) return;
  tt.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = titleText;
  tt.appendChild(title);
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'tt-row';
    if (r.color) {
      const key = document.createElement('span');
      key.className = 'tt-key';
      key.style.background = r.color;
      row.appendChild(key);
    }
    row.appendChild(document.createTextNode(r.label));
    const strong = document.createElement('strong');
    strong.textContent = r.value;
    row.appendChild(strong);
    tt.appendChild(row);
  });
  tt.classList.add('is-visible');

  const pad = 14;
  let left = clientX + pad;
  let top = clientY + pad;
  const rect = tt.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - pad;
  tt.style.transform = `translate(${left}px, ${top}px)`;
}

function hideTooltip(){
  document.getElementById('vizTooltip')?.classList.remove('is-visible');
}

/* ---------------- login page ---------------- */
function initLoginPage(){
  const form = document.getElementById('loginForm');
  if (!form) return;
  const errorEl = document.getElementById('loginError');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 503) {
        errorEl.textContent = 'El backoffice todavía no está configurado (falta ADMIN_PASSWORD en Vercel).';
      } else if (res.status === 401) {
        errorEl.textContent = 'Contraseña incorrecta.';
      } else if (res.ok) {
        window.location.href = 'index.html';
        return;
      } else {
        errorEl.textContent = 'Algo salió mal. Intenta de nuevo.';
      }
    } catch {
      errorEl.textContent = 'No se pudo conectar con el servidor.';
    }
    submitBtn.disabled = false;
  });
}

/* ---------------- dashboard page ---------------- */
// Los pedidos de Wompi en modo "Prueba" no son dinero real -- se excluyen de
// ingresos y promedio para no inflar las cifras del negocio.
function isRealMoney(o){
  return !(o.channel === 'wompi' && o.environment === 'test');
}

function renderSummary(orders){
  const real = orders.filter(isRealMoney);
  const paid = real.filter(o => PAID_STATUSES.includes(o.status));
  const revenue = paid.reduce((sum, o) => sum + Number(o.amount_cop || 0), 0);
  const pending = orders.filter(o => o.status === 'pending' || o.status === 'whatsapp_pending');
  const avg = paid.length ? revenue / paid.length : 0;

  document.getElementById('statTotal').textContent = orders.length;
  document.getElementById('statPaid').textContent = paid.length;
  document.getElementById('statPending').textContent = pending.length;
  document.getElementById('statRevenue').textContent = '$' + formatCOP(revenue) + ' COP';
  document.getElementById('statAvg').textContent = '$' + formatCOP(avg) + ' COP';
}

/* ---------------- charts ---------------- */
function renderRevenueChart(orders){
  const container = document.getElementById('chartRevenue');
  if (!container) return;
  container.innerHTML = '';

  const DAYS = 14;
  const now = new Date();
  const buckets = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    buckets.push({ key: d.toISOString().slice(0, 10), date: d, value: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  orders.forEach((o) => {
    if (!PAID_STATUSES.includes(o.status) || !isRealMoney(o)) return;
    const bucket = byKey.get(String(o.created_at).slice(0, 10));
    if (bucket) bucket.value += Number(o.amount_cop || 0);
  });

  const hasData = buckets.some((b) => b.value > 0);
  if (!hasData) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = 'Todavía no hay ingresos confirmados en este período.';
    container.appendChild(empty);
    return;
  }

  const W = 640, H = 220, ML = 46, MR = 12, MT = 14, MB = 28;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;
  const maxVal = niceCeiling(Math.max(1, ...buckets.map((b) => b.value)));
  const xPos = (i) => ML + (i / (buckets.length - 1)) * plotW;
  const yPos = (v) => MT + plotH - (v / maxVal) * plotH;
  const RED = CHANNEL_COLORS.wompi;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Ingresos por día, últimos 14 días' });

  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = (maxVal / steps) * s;
    const gy = yPos(v);
    svg.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: gy, y2: gy, stroke: 'var(--grid-line)', 'stroke-width': 1 }));
    const t = svgEl('text', { x: ML - 8, y: gy + 3, 'text-anchor': 'end', class: 'chart-axis-text' });
    t.textContent = v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v));
    svg.appendChild(t);
  }
  svg.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yPos(0), y2: yPos(0), stroke: 'var(--axis-line)', 'stroke-width': 1 }));

  let areaD = `M ${xPos(0)} ${yPos(0)}`;
  buckets.forEach((b, i) => { areaD += ` L ${xPos(i)} ${yPos(b.value)}`; });
  areaD += ` L ${xPos(buckets.length - 1)} ${yPos(0)} Z`;
  svg.appendChild(svgEl('path', { d: areaD, fill: RED, 'fill-opacity': 0.1, stroke: 'none' }));

  let lineD = '';
  buckets.forEach((b, i) => { lineD += (i === 0 ? 'M' : 'L') + ` ${xPos(i)} ${yPos(b.value)}`; });
  svg.appendChild(svgEl('path', {
    d: lineD, fill: 'none', stroke: RED, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

  [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].forEach((i) => {
    const anchor = i === 0 ? 'start' : (i === buckets.length - 1 ? 'end' : 'middle');
    const t = svgEl('text', { x: xPos(i), y: H - 6, 'text-anchor': anchor, class: 'chart-axis-text' });
    t.textContent = buckets[i].date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    svg.appendChild(t);
  });

  const last = buckets[buckets.length - 1];
  svg.appendChild(svgEl('circle', {
    cx: xPos(buckets.length - 1), cy: yPos(last.value), r: 4, fill: RED, stroke: 'var(--surface-1)', 'stroke-width': 2,
  }));

  const crosshair = svgEl('line', { x1: 0, x2: 0, y1: MT, y2: H - MB, stroke: 'var(--axis-line)', 'stroke-width': 1, opacity: 0 });
  svg.appendChild(crosshair);
  const hoverDot = svgEl('circle', { r: 5, fill: RED, stroke: 'var(--surface-1)', 'stroke-width': 2, opacity: 0 });
  svg.appendChild(hoverDot);

  const hit = svgEl('rect', {
    x: ML, y: MT, width: plotW, height: plotH, fill: 'transparent',
    tabindex: '0', role: 'img', 'aria-label': 'Usa las flechas del mouse sobre el gráfico para ver el detalle por día',
  });
  hit.style.cursor = 'crosshair';
  svg.appendChild(hit);
  container.appendChild(svg);

  function reveal(idx, clientX, clientY){
    idx = Math.max(0, Math.min(buckets.length - 1, idx));
    const b = buckets[idx];
    const cx = xPos(idx), cy = yPos(b.value);
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx); crosshair.setAttribute('opacity', 1);
    hoverDot.setAttribute('cx', cx); hoverDot.setAttribute('cy', cy); hoverDot.setAttribute('opacity', 1);
    showTooltip(clientX, clientY, b.date.toLocaleDateString('es-CO', { day: '2-digit', month: 'long' }), [
      { color: RED, label: 'Ingresos', value: '$' + formatCOP(b.value) + ' COP' },
    ]);
  }
  function conceal(){
    crosshair.setAttribute('opacity', 0);
    hoverDot.setAttribute('opacity', 0);
    hideTooltip();
  }

  hit.addEventListener('pointermove', (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (W / rect.width);
    const idx = Math.round(((px - ML) / plotW) * (buckets.length - 1));
    reveal(idx, evt.clientX, evt.clientY);
  });
  hit.addEventListener('pointerleave', conceal);
  hit.addEventListener('focus', () => {
    const rect = hit.getBoundingClientRect();
    reveal(buckets.length - 1, rect.right, rect.top);
  });
  hit.addEventListener('blur', conceal);
}

function renderBarChart(containerId, data, opts = {}){
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (opts.legend) {
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    opts.legend.forEach((item) => {
      const span = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = item.color;
      span.appendChild(dot);
      span.appendChild(document.createTextNode(item.label));
      legend.appendChild(span);
    });
    container.appendChild(legend);
  }

  if (!data.length || data.every((d) => d.value === 0)) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = 'Sin datos todavía.';
    container.appendChild(empty);
    return;
  }

  const W = 520, rowH = 46, barH = 14, padX = 4;
  const H = data.length * rowH + 6;
  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const barMaxW = W - padX * 2 - 46;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || 'Gráfico de barras' });

  data.forEach((d, i) => {
    const rowY = 6 + i * rowH;
    const barY = rowY + 16;
    const barW = Math.max(3, (d.value / maxVal) * barMaxW);

    const label = svgEl('text', { x: padX, y: rowY + 9, class: 'chart-cat-text' });
    label.textContent = d.label;
    svg.appendChild(label);

    svg.appendChild(svgEl('rect', { x: padX, y: barY, width: barMaxW, height: barH, rx: 4, fill: 'var(--grid-line)' }));

    const bar = svgEl('path', { d: roundedBarPath(padX, barY, barW, barH, 4), fill: d.color });
    svg.appendChild(bar);

    const valueText = svgEl('text', { x: padX + barW + 8, y: barY + barH - 3, class: 'chart-value-text' });
    valueText.textContent = String(d.value);
    svg.appendChild(valueText);

    const hit = svgEl('rect', {
      x: 0, y: rowY, width: W, height: rowH - 4, fill: 'transparent',
      tabindex: '0', role: 'img', 'aria-label': `${d.label}: ${d.value}`,
    });
    hit.style.cursor = 'pointer';

    function trigger(clientX, clientY){
      bar.setAttribute('opacity', 0.82);
      showTooltip(clientX, clientY, d.label, [
        { color: d.color, label: opts.unitLabel || 'Pedidos', value: String(d.value) },
      ]);
    }
    function release(){
      bar.setAttribute('opacity', 1);
      hideTooltip();
    }
    hit.addEventListener('pointermove', (evt) => trigger(evt.clientX, evt.clientY));
    hit.addEventListener('pointerleave', release);
    hit.addEventListener('focus', () => {
      const r = hit.getBoundingClientRect();
      trigger(r.left + 12, r.top);
    });
    hit.addEventListener('blur', release);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

function renderChannelChart(orders){
  const counts = { wompi: 0, whatsapp: 0 };
  orders.forEach((o) => { if (counts[o.channel] !== undefined) counts[o.channel]++; });
  const data = [
    { label: 'Wompi', value: counts.wompi, color: CHANNEL_COLORS.wompi },
    { label: 'WhatsApp', value: counts.whatsapp, color: CHANNEL_COLORS.whatsapp },
  ];
  renderBarChart('chartChannel', data, {
    ariaLabel: 'Pedidos por canal',
    unitLabel: 'Pedidos',
    legend: data.map((d) => ({ label: d.label, color: d.color })),
  });
}

function renderStatusChart(orders){
  const counts = {};
  orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const data = Object.keys(counts)
    .map((status) => ({
      label: STATUS_LABELS[status] || status,
      value: counts[status],
      color: BUCKET_COLORS[STATUS_BUCKET[status]] || '#a39a8c',
    }))
    .sort((a, b) => b.value - a.value);
  renderBarChart('chartStatus', data, { ariaLabel: 'Pedidos por estado', unitLabel: 'Pedidos' });
}

function renderCharts(orders){
  renderRevenueChart(orders);
  renderChannelChart(orders);
  renderStatusChart(orders);
}

function renderOrders(orders){
  const tbody = document.getElementById('ordersBody');
  const empty = document.getElementById('ordersEmpty');
  tbody.innerHTML = '';

  if (!orders.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  orders.forEach((o) => {
    const tr = document.createElement('tr');

    const tdRef = document.createElement('td');
    tdRef.textContent = o.reference;

    const tdChannel = document.createElement('td');
    tdChannel.textContent = o.channel === 'wompi' ? 'Wompi' : 'WhatsApp';

    const tdEnv = document.createElement('td');
    if (o.channel === 'wompi') {
      const envBadge = document.createElement('span');
      const env = o.environment === 'test' ? 'test' : 'prod';
      envBadge.className = 'env-badge env-' + env;
      envBadge.textContent = ENV_LABELS[env];
      tdEnv.appendChild(envBadge);
    } else {
      tdEnv.textContent = '—';
    }

    const tdItems = document.createElement('td');
    if (o.items && o.items.length) {
      tdItems.textContent = o.items.map((it) => `${it.quantity}x ${it.product_name}`).join(', ');
      const parts = [];
      if (o.subtotal_cop) parts.push(`Subtotal: $${formatCOP(o.subtotal_cop)}`);
      if (o.shipping_name) parts.push(`Envío (${o.shipping_name}): $${formatCOP(o.shipping_cop)}`);
      if (o.coupon_code) parts.push(`Cupón ${o.coupon_code}: -$${formatCOP(o.discount_cop)}`);
      tdItems.title = parts.join(' · ');
    } else {
      tdItems.textContent = '—';
      tdItems.title = 'Pedido registrado antes de tener catálogo de productos.';
    }

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge st-' + o.status;
    badge.textContent = STATUS_LABELS[o.status] || o.status;
    tdStatus.appendChild(badge);

    const tdQty = document.createElement('td');
    tdQty.textContent = o.quantity;

    const tdAmount = document.createElement('td');
    tdAmount.textContent = '$' + formatCOP(o.amount_cop) + ' COP';

    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(o.created_at).toLocaleString('es-CO');

    const tdAction = document.createElement('td');
    const select = document.createElement('select');
    select.dataset.id = o.id;
    STATUS_OPTIONS.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = STATUS_LABELS[s];
      if (s === o.status) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => updateStatus(o.id, select.value, select));
    tdAction.appendChild(select);

    tr.append(tdRef, tdChannel, tdEnv, tdItems, tdStatus, tdQty, tdAmount, tdDate, tdAction);
    tbody.appendChild(tr);
  });
}

async function updateStatus(id, status, selectEl){
  selectEl.disabled = true;
  try {
    const res = await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) await loadOrders();
  } finally {
    selectEl.disabled = false;
  }
}

async function loadOrders(){
  const res = await fetch('/api/admin/orders');
  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }
  if (!res.ok) {
    const empty = document.getElementById('ordersEmpty');
    let message = 'No se pudieron cargar los pedidos.';
    try {
      const data = await res.json();
      if (data.error === 'db_not_configured') {
        message = 'Falta conectar la base de datos en Vercel (DATABASE_URL / POSTGRES_URL).';
      }
    } catch {}
    empty.textContent = message;
    empty.style.display = 'block';
    document.getElementById('ordersBody').innerHTML = '';
    return;
  }
  const { orders } = await res.json();
  renderSummary(orders);
  renderOrders(orders);
  renderCharts(orders);
}

/* ---------------- entorno de Wompi (prueba / producción) ---------------- */
function renderWompiEnv(environment, configured){
  const switchEl = document.getElementById('wompiEnvSwitch');
  const banner = document.getElementById('wompiEnvBanner');
  if (!switchEl || !banner) return;

  switchEl.querySelectorAll('.wompi-env-opt').forEach((btn) => {
    const env = btn.dataset.env;
    btn.classList.toggle('is-active', env === environment);
    btn.disabled = !configured[env];
    btn.title = configured[env] ? '' : `Faltan las llaves de Wompi para "${ENV_LABELS[env]}" en las variables de entorno.`;
  });

  banner.style.display = 'flex';
  banner.className = 'wompi-env-banner env-' + environment;
  banner.textContent = environment === 'prod'
    ? '● Modo Producción: los checkouts de Wompi cobran dinero real.'
    : '● Modo Prueba: los checkouts de Wompi usan el sandbox, no se cobra dinero real.';
}

async function loadWompiEnv(){
  const res = await fetch('/api/admin/wompi-env');
  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }
  if (!res.ok) return;
  const { environment, configured } = await res.json();
  renderWompiEnv(environment, configured);
}

function initWompiEnvSwitch(){
  const switchEl = document.getElementById('wompiEnvSwitch');
  if (!switchEl) return;

  switchEl.querySelectorAll('.wompi-env-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const env = btn.dataset.env;
      if (btn.classList.contains('is-active') || btn.disabled) return;
      if (env === 'prod' && !confirm('¿Cambiar Wompi a modo Producción? A partir de ahora los checkouts van a cobrar dinero real.')) {
        return;
      }

      switchEl.querySelectorAll('.wompi-env-opt').forEach((b) => { b.disabled = true; });
      try {
        const res = await fetch('/api/admin/wompi-env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ environment: env }),
        });
        if (res.ok) {
          const data = await res.json();
          renderWompiEnv(data.environment, data.configured);
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.message || 'No se pudo cambiar el entorno de Wompi.');
          await loadWompiEnv();
        }
      } catch {
        alert('No se pudo conectar con el servidor.');
        await loadWompiEnv();
      }
    });
  });
}

function initDashboardPage(){
  const tbody = document.getElementById('ordersBody');
  if (!tbody) return;

  loadOrders();
  loadWompiEnv();
  initWompiEnvSwitch();

  document.getElementById('refreshBtn')?.addEventListener('click', () => { loadOrders(); loadWompiEnv(); });
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
  initDashboardPage();
});
