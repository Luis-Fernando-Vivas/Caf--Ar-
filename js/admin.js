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

function formatCOP(n){
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits:0 });
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
function renderSummary(orders){
  const paid = orders.filter(o => PAID_STATUSES.includes(o.status));
  const revenue = paid.reduce((sum, o) => sum + Number(o.amount_cop || 0), 0);
  const pending = orders.filter(o => o.status === 'pending' || o.status === 'whatsapp_pending');

  document.getElementById('statTotal').textContent = orders.length;
  document.getElementById('statPaid').textContent = paid.length;
  document.getElementById('statPending').textContent = pending.length;
  document.getElementById('statRevenue').textContent = '$' + formatCOP(revenue) + ' COP';
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

    tr.append(tdRef, tdChannel, tdStatus, tdQty, tdAmount, tdDate, tdAction);
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
}

function initDashboardPage(){
  const tbody = document.getElementById('ordersBody');
  if (!tbody) return;

  loadOrders();

  document.getElementById('refreshBtn')?.addEventListener('click', loadOrders);
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
  initDashboardPage();
});
