/* Café Arú — página de producto dinámica (?slug=...) */

const LEGACY_SLUG = 'cafe-aru-honey-500g';

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function setupGallery(images) {
  const mainImg = document.getElementById('galleryMain');
  const thumbsWrap = document.getElementById('productThumbs');
  thumbsWrap.innerHTML = '';

  if (!images.length) return;
  mainImg.src = images[0].url;

  images.forEach((img, i) => {
    const btn = document.createElement('button');
    if (i === 0) btn.className = 'active';
    const thumbImg = document.createElement('img');
    thumbImg.src = img.url;
    thumbImg.alt = '';
    btn.appendChild(thumbImg);
    btn.addEventListener('click', () => {
      thumbsWrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mainImg.style.opacity = 0;
      setTimeout(() => { mainImg.src = img.url; mainImg.style.opacity = 1; }, 220);
    });
    thumbsWrap.appendChild(btn);
  });
}

function renderProduct(product) {
  document.getElementById('pageTitle').textContent = `${product.name} — Comprar | Café Arú`;
  document.getElementById('pageDescription').content = `Compra ${product.name}: ${product.description || ''}`.slice(0, 155);
  document.getElementById('heroName').textContent = product.name;
  document.getElementById('crumbName').textContent = product.name;
  document.getElementById('prodName').textContent = product.name;
  document.getElementById('prodPrice').textContent = '$' + formatCOP(product.price_cop);
  document.getElementById('prodDesc').textContent = product.description || '';
  document.getElementById('tabDescLong').textContent = product.description || '';
  document.getElementById('stickyName').textContent = product.name;
  document.getElementById('stickyPrice').textContent = '$' + formatCOP(product.price_cop);
  document.getElementById('stickyImg').src = product.images && product.images[0] ? product.images[0].url : 'img/producto-bolsa-500g.png';

  const tagsWrap = document.getElementById('prodTags');
  tagsWrap.innerHTML = '';
  (product.flavor_tags || []).forEach((tag) => {
    const span = document.createElement('span');
    span.textContent = tag;
    tagsWrap.appendChild(span);
  });

  setupGallery(product.images || []);

  const soldOut = product.stock <= 0;
  const stockNote = document.getElementById('prodStockNote');
  stockNote.textContent = soldOut ? 'Agotado' : `COP · ${product.stock} disponibles`;

  const addBtn = document.getElementById('addToCartBtn');
  const buyBtn = document.getElementById('buyNowBtn');
  const stickyBtn = document.getElementById('stickyAddBtn');
  const totalDisplay = document.querySelector('[data-total]');
  const qtyDisplay = document.querySelector('[data-qty]');

  let qty = 1;
  function renderQty() {
    if (qtyDisplay) qtyDisplay.textContent = qty;
    if (totalDisplay) totalDisplay.textContent = '$' + formatCOP(qty * product.price_cop) + ' COP';
  }
  document.querySelectorAll('[data-qty-decrease]').forEach((btn) => btn.addEventListener('click', () => {
    qty = Math.max(1, qty - 1); renderQty();
  }));
  document.querySelectorAll('[data-qty-increase]').forEach((btn) => btn.addEventListener('click', () => {
    qty = Math.min(20, Math.min(product.stock, qty + 1)); renderQty();
  }));
  renderQty();

  if (soldOut) {
    [addBtn, buyBtn, stickyBtn].forEach((btn) => { btn.disabled = true; btn.textContent = 'Agotado'; });
  } else {
    addBtn.addEventListener('click', () => {
      Cart.add(product, qty);
      addBtn.textContent = 'Añadido ✓';
      setTimeout(() => { addBtn.textContent = 'Añadir al carrito'; }, 1400);
    });
    stickyBtn.addEventListener('click', () => {
      Cart.add(product, qty);
      stickyBtn.textContent = 'Añadido ✓';
      setTimeout(() => { stickyBtn.textContent = 'Añadir'; }, 1400);
    });
    buyBtn.addEventListener('click', () => {
      Cart.add(product, qty);
      window.location.href = '/carrito';
    });
  }

  document.getElementById('productLoading').style.display = 'none';
  document.getElementById('productMain').style.display = '';
}

async function loadProduct() {
  const slug = new URLSearchParams(location.search).get('slug') || LEGACY_SLUG;
  try {
    const res = await fetch('/api/products?slug=' + encodeURIComponent(slug));
    if (!res.ok) throw new Error('not_found');
    const { product } = await res.json();
    renderProduct(product);
  } catch {
    document.getElementById('productLoading').style.display = 'none';
    document.getElementById('productNotFound').style.display = '';
  }
}

document.addEventListener('DOMContentLoaded', loadProduct);
