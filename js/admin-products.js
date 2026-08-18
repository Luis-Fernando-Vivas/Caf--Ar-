/* Café Arú — Backoffice: gestión de productos */

const STATUS_LABELS = { active: 'Activo', draft: 'Borrador', archived: 'Archivado' };

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

let editingId = null;
let images = []; // [{url, public_id}]

function renderThumbs() {
  const strip = document.getElementById('thumbStrip');
  const addBtn = document.getElementById('addImageBtn');
  strip.querySelectorAll('.admin-thumb').forEach((el) => el.remove());

  images.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'admin-thumb' + (idx === 0 ? ' is-cover' : '');
    const image = document.createElement('img');
    image.src = img.url;
    image.alt = '';
    div.appendChild(image);

    const actions = document.createElement('div');
    actions.className = 'admin-thumb-actions';

    if (idx !== 0) {
      const coverBtn = document.createElement('button');
      coverBtn.type = 'button';
      coverBtn.textContent = 'Portada';
      coverBtn.addEventListener('click', () => {
        images.splice(idx, 1);
        images.unshift(img);
        renderThumbs();
      });
      actions.appendChild(coverBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Quitar';
    removeBtn.addEventListener('click', () => {
      images.splice(idx, 1);
      renderThumbs();
    });
    actions.appendChild(removeBtn);

    div.appendChild(actions);
    strip.insertBefore(div, addBtn);
  });
}

function resetForm() {
  editingId = null;
  images = [];
  document.getElementById('productId').value = '';
  document.getElementById('fName').value = '';
  document.getElementById('fSlug').value = '';
  document.getElementById('fStatus').value = 'active';
  document.getElementById('fPrice').value = '';
  document.getElementById('fStock').value = '';
  document.getElementById('fTags').value = '';
  document.getElementById('fDescription').value = '';
  document.getElementById('formTitle').textContent = 'Nuevo producto';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('formError').textContent = '';
  renderThumbs();
}

function loadIntoForm(product) {
  editingId = product.id;
  images = Array.isArray(product.images) ? product.images.slice() : [];
  document.getElementById('productId').value = product.id;
  document.getElementById('fName').value = product.name;
  document.getElementById('fSlug').value = product.slug;
  document.getElementById('fStatus').value = product.status;
  document.getElementById('fPrice').value = product.price_cop;
  document.getElementById('fStock').value = product.stock;
  document.getElementById('fTags').value = (product.flavor_tags || []).join(', ');
  document.getElementById('fDescription').value = product.description || '';
  document.getElementById('formTitle').textContent = 'Editar producto';
  document.getElementById('cancelEditBtn').style.display = '';
  document.getElementById('formError').textContent = '';
  renderThumbs();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadProducts() {
  const res = await fetch('/api/admin/products');
  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }
  const tbody = document.getElementById('productsBody');
  const empty = document.getElementById('productsEmpty');
  if (!res.ok) {
    empty.textContent = 'No se pudieron cargar los productos.';
    empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  const { products } = await res.json();
  tbody.innerHTML = '';
  if (!products.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  products.forEach((p) => {
    const tr = document.createElement('tr');

    const tdThumb = document.createElement('td');
    if (p.images && p.images[0]) {
      const img = document.createElement('img');
      img.className = 'admin-row-thumb';
      img.src = p.images[0].url;
      img.alt = '';
      tdThumb.appendChild(img);
    }

    const tdName = document.createElement('td');
    tdName.textContent = p.name;

    const tdSlug = document.createElement('td');
    tdSlug.textContent = p.slug;

    const tdPrice = document.createElement('td');
    tdPrice.textContent = '$' + formatCOP(p.price_cop);

    const tdStock = document.createElement('td');
    tdStock.textContent = p.stock;

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge st-' + (p.status === 'active' ? 'approved' : p.status === 'draft' ? 'pending' : 'cancelled');
    badge.textContent = STATUS_LABELS[p.status] || p.status;
    tdStatus.appendChild(badge);

    const tdActions = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'admin-inline-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => loadIntoForm(p));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = 'Eliminar';
    delBtn.addEventListener('click', () => deleteProduct(p));
    actions.append(editBtn, delBtn);
    tdActions.appendChild(actions);

    tr.append(tdThumb, tdName, tdSlug, tdPrice, tdStock, tdStatus, tdActions);
    tbody.appendChild(tr);
  });
}

async function deleteProduct(p) {
  if (!confirm(`¿Eliminar "${p.name}"? Si tiene pedidos asociados, se archivará en vez de borrarse.`)) return;
  const res = await fetch(`/api/admin/products?id=${p.id}`, { method: 'DELETE' });
  if (res.ok) {
    if (editingId === p.id) resetForm();
    await loadProducts();
  } else {
    alert('No se pudo eliminar el producto.');
  }
}

async function openUploadWidget() {
  const addBtn = document.getElementById('addImageBtn');
  const hint = document.getElementById('cloudinaryHint');
  addBtn.disabled = true;
  hint.textContent = '';

  try {
    const res = await fetch('/api/admin/cloudinary-signature', { method: 'POST' });
    if (res.status === 503) {
      hint.textContent = 'Falta configurar Cloudinary (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET) en las variables de entorno.';
      addBtn.disabled = false;
      return;
    }
    if (!res.ok) throw new Error('signature_failed');
    const { cloudName, apiKey, timestamp, folder, signature } = await res.json();

    if (typeof cloudinary === 'undefined') {
      hint.textContent = 'No se pudo cargar el widget de Cloudinary (revisa tu conexión).';
      addBtn.disabled = false;
      return;
    }

    const widget = cloudinary.createUploadWidget(
      { cloudName, apiKey, uploadSignature: signature, uploadSignatureTimestamp: timestamp, folder, sources: ['local', 'url', 'camera'], multiple: true },
      (error, result) => {
        if (!error && result.event === 'success') {
          images.push({ url: result.info.secure_url, public_id: result.info.public_id });
          renderThumbs();
        }
        if (result && (result.event === 'close' || result.event === 'success')) {
          addBtn.disabled = false;
        }
      }
    );
    widget.open();
  } catch {
    hint.textContent = 'No se pudo iniciar la subida.';
    addBtn.disabled = false;
  }
}

async function saveProduct(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  const saveBtn = document.getElementById('saveBtn');
  errorEl.textContent = '';

  const payload = {
    name: document.getElementById('fName').value.trim(),
    slug: document.getElementById('fSlug').value.trim(),
    status: document.getElementById('fStatus').value,
    price_cop: parseInt(document.getElementById('fPrice').value, 10),
    stock: parseInt(document.getElementById('fStock').value, 10),
    flavor_tags: document.getElementById('fTags').value.split(',').map((t) => t.trim()).filter(Boolean),
    description: document.getElementById('fDescription').value,
    images,
  };

  saveBtn.disabled = true;
  try {
    const isEdit = Boolean(editingId);
    const res = await fetch('/api/admin/products', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { id: editingId, ...payload } : payload),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.message || 'No se pudo guardar el producto.';
      return;
    }
    resetForm();
    await loadProducts();
  } catch {
    errorEl.textContent = 'No se pudo conectar con el servidor.';
  } finally {
    saveBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderThumbs();
  loadProducts();

  document.getElementById('productForm').addEventListener('submit', saveProduct);
  document.getElementById('cancelEditBtn').addEventListener('click', resetForm);
  document.getElementById('addImageBtn').addEventListener('click', openUploadWidget);
  document.getElementById('refreshBtn').addEventListener('click', loadProducts);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
});
