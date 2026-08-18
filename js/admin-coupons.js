/* Café Arú — Backoffice: cupones de descuento */

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

async function loadCoupons() {
  const res = await fetch('/api/admin/coupons');
  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }
  const tbody = document.getElementById('couponsBody');
  const empty = document.getElementById('couponsEmpty');
  if (!res.ok) {
    empty.textContent = 'No se pudieron cargar los cupones.';
    empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  const { coupons } = await res.json();
  tbody.innerHTML = '';
  if (!coupons.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  coupons.forEach((c) => {
    const tr = document.createElement('tr');

    const tdCode = document.createElement('td');
    tdCode.textContent = c.code;

    const tdType = document.createElement('td');
    tdType.textContent = c.discount_type === 'percent' ? 'Porcentaje' : 'Monto fijo';

    const tdValue = document.createElement('td');
    tdValue.textContent = c.discount_type === 'percent' ? c.discount_value + '%' : '$' + formatCOP(c.discount_value);

    const tdMin = document.createElement('td');
    tdMin.textContent = c.min_order_cop > 0 ? '$' + formatCOP(c.min_order_cop) : '—';

    const tdUses = document.createElement('td');
    tdUses.textContent = `${c.times_used} / ${c.usage_limit ?? '∞'}`;

    const tdExpires = document.createElement('td');
    tdExpires.textContent = c.expires_at ? new Date(c.expires_at).toLocaleDateString('es-CO') : 'Nunca';

    const tdActive = document.createElement('td');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = c.is_active;
    toggle.addEventListener('change', () => patchCoupon(c.id, { is_active: toggle.checked }));
    tdActive.appendChild(toggle);

    const tdActions = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'admin-inline-actions';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = 'Eliminar';
    delBtn.addEventListener('click', () => deleteCoupon(c));
    actions.appendChild(delBtn);
    tdActions.appendChild(actions);

    tr.append(tdCode, tdType, tdValue, tdMin, tdUses, tdExpires, tdActive, tdActions);
    tbody.appendChild(tr);
  });
}

async function patchCoupon(id, fields) {
  await fetch('/api/admin/coupons', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...fields }),
  });
  await loadCoupons();
}

async function deleteCoupon(c) {
  if (!confirm(`¿Eliminar el cupón "${c.code}"?`)) return;
  await fetch(`/api/admin/coupons?id=${c.id}`, { method: 'DELETE' });
  await loadCoupons();
}

async function createCoupon(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  const payload = {
    code: document.getElementById('fCode').value.trim(),
    discount_type: document.getElementById('fType').value,
    discount_value: parseInt(document.getElementById('fValue').value, 10),
    min_order_cop: parseInt(document.getElementById('fMinOrder').value, 10) || 0,
    usage_limit: document.getElementById('fLimit').value ? parseInt(document.getElementById('fLimit').value, 10) : null,
    expires_at: document.getElementById('fExpires').value || null,
  };

  const res = await fetch('/api/admin/coupons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.message || 'No se pudo crear el cupón.';
    return;
  }
  document.getElementById('couponForm').reset();
  await loadCoupons();
}

document.addEventListener('DOMContentLoaded', () => {
  loadCoupons();
  document.getElementById('couponForm').addEventListener('submit', createCoupon);
  document.getElementById('refreshBtn').addEventListener('click', loadCoupons);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = 'login.html';
  });
});
