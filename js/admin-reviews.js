/* Café Arú — Backoffice: moderación de reseñas */

const STATUS_LABELS = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };

function reviewStarsHTML(rating) {
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= rating ? '★' : '☆';
  return out;
}

async function loadReviews() {
  const res = await fetch('/api/reviews?all=1');
  if (res.status === 401) {
    window.location.href = '/admin/login';
    return;
  }
  const tbody = document.getElementById('reviewsBody');
  const empty = document.getElementById('reviewsEmpty');
  if (!res.ok) {
    empty.textContent = 'No se pudieron cargar las reseñas.';
    empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  const { reviews } = await res.json();
  tbody.innerHTML = '';
  if (!reviews.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  reviews.forEach((r) => {
    const tr = document.createElement('tr');

    const tdProduct = document.createElement('td');
    tdProduct.textContent = r.product_name;

    const tdAuthor = document.createElement('td');
    tdAuthor.textContent = r.author_name;

    const tdStars = document.createElement('td');
    tdStars.textContent = reviewStarsHTML(r.rating);

    const tdComment = document.createElement('td');
    tdComment.textContent = r.comment;
    tdComment.style.maxWidth = '320px';
    tdComment.style.whiteSpace = 'normal';

    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(r.created_at).toLocaleString('es-CO');

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge st-' + (r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'cancelled' : 'pending');
    badge.textContent = STATUS_LABELS[r.status] || r.status;
    tdStatus.appendChild(badge);

    const tdActions = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'admin-inline-actions';

    if (r.status !== 'approved') {
      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.textContent = 'Aprobar';
      approveBtn.addEventListener('click', () => patchReview(r.id, 'approved'));
      actions.appendChild(approveBtn);
    }
    if (r.status !== 'rejected') {
      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.textContent = 'Rechazar';
      rejectBtn.addEventListener('click', () => patchReview(r.id, 'rejected'));
      actions.appendChild(rejectBtn);
    }
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = 'Eliminar';
    delBtn.addEventListener('click', () => deleteReview(r));
    actions.appendChild(delBtn);

    tdActions.appendChild(actions);

    tr.append(tdProduct, tdAuthor, tdStars, tdComment, tdDate, tdStatus, tdActions);
    tbody.appendChild(tr);
  });
}

async function patchReview(id, status) {
  await fetch('/api/reviews', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  });
  await loadReviews();
}

async function deleteReview(r) {
  if (!confirm(`¿Eliminar la reseña de "${r.author_name}"?`)) return;
  await fetch(`/api/reviews?id=${r.id}`, { method: 'DELETE' });
  await loadReviews();
}

document.addEventListener('DOMContentLoaded', () => {
  loadReviews();
  document.getElementById('refreshBtn').addEventListener('click', loadReviews);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.href = '/admin/login';
  });
});
