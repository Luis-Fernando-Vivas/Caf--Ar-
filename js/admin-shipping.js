/* Café Arú — Backoffice: tarifas de envío */

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

async function loadRates() {
  const res = await fetch('/api/admin/shipping-rates');
  if (res.status === 401) {
    window.location.href = '/admin/login';
    return;
  }
  const tbody = document.getElementById('ratesBody');
  const empty = document.getElementById('ratesEmpty');
  if (!res.ok) {
    empty.textContent = 'No se pudieron cargar las tarifas.';
    empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  const { rates, free_shipping_rule } = await res.json();
  fillRuleForm(free_shipping_rule);
  tbody.innerHTML = '';
  if (!rates.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  rates.forEach((r) => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = r.name;

    const tdAmount = document.createElement('td');
    tdAmount.textContent = r.amount_cop > 0 ? '$' + formatCOP(r.amount_cop) : 'Gratis';

    const tdActive = document.createElement('td');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = r.is_active;
    toggle.addEventListener('change', () => patchRate(r.id, { is_active: toggle.checked }));
    tdActive.appendChild(toggle);

    const tdActions = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'admin-inline-actions';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = 'Eliminar';
    delBtn.addEventListener('click', () => deleteRate(r));
    actions.appendChild(delBtn);
    tdActions.appendChild(actions);

    tr.append(tdName, tdAmount, tdActive, tdActions);
    tbody.appendChild(tr);
  });
}

async function patchRate(id, fields) {
  await fetch('/api/admin/shipping-rates', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...fields }),
  });
  await loadRates();
}

async function deleteRate(r) {
  if (!confirm(`¿Eliminar la tarifa "${r.name}"?`)) return;
  await fetch(`/api/admin/shipping-rates?id=${r.id}`, { method: 'DELETE' });
  await loadRates();
}

async function createRate(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';
  const name = document.getElementById('fName').value.trim();
  const amount_cop = parseInt(document.getElementById('fAmount').value, 10);

  const res = await fetch('/api/admin/shipping-rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, amount_cop }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.message || 'No se pudo crear la tarifa.';
    return;
  }
  document.getElementById('rateForm').reset();
  await loadRates();
}

function fillRuleForm(rule) {
  document.getElementById('rEnabled').checked = Boolean(rule && rule.enabled);
  document.getElementById('rMinQuantity').value = rule && rule.min_quantity !== null ? rule.min_quantity : '';
  document.getElementById('rMinSubtotal').value = rule && rule.min_subtotal_cop !== null ? rule.min_subtotal_cop : '';
}

async function saveRule(e) {
  e.preventDefault();
  const errorEl = document.getElementById('ruleError');
  errorEl.textContent = '';

  const enabled = document.getElementById('rEnabled').checked;
  const minQuantityRaw = document.getElementById('rMinQuantity').value.trim();
  const minSubtotalRaw = document.getElementById('rMinSubtotal').value.trim();

  const res = await fetch('/api/admin/shipping-rates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled,
      min_quantity: minQuantityRaw === '' ? null : minQuantityRaw,
      min_subtotal_cop: minSubtotalRaw === '' ? null : minSubtotalRaw,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.message || 'No se pudo guardar la regla.';
    return;
  }
  const { free_shipping_rule } = await res.json();
  fillRuleForm(free_shipping_rule);
}

document.addEventListener('DOMContentLoaded', () => {
  loadRates();
  document.getElementById('rateForm').addEventListener('submit', createRate);
  document.getElementById('ruleForm').addEventListener('submit', saveRule);
  document.getElementById('refreshBtn').addEventListener('click', loadRates);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = '/admin/login';
  });
});
