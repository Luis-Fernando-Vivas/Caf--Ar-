/* Café Arú — catálogo de productos (tienda.html) */

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

const CART_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M5 12h14M13 5l7 7-7 7"/></svg>';

function renderProductCard(product) {
  const soldOut = product.stock <= 0;
  const cover = product.images && product.images[0] ? product.images[0].url : 'img/product/cafe-aru.webp';
  const tags = product.flavor_tags || [];

  const card = document.createElement('article');
  card.className = 'product-card' + (soldOut ? ' is-sold-out' : '');
  // Sin [data-reveal]: esas tarjetas se crean después de que main.js ya armó
  // su IntersectionObserver en DOMContentLoaded, así que nunca las vería y
  // quedarían con opacity:0 para siempre (el bug de "el producto no aparece").

  const link = document.createElement('a');
  link.className = 'product-card-link';
  link.href = '/producto?slug=' + encodeURIComponent(product.slug);
  link.setAttribute('data-cursor-hover', '');

  const media = document.createElement('div');
  media.className = 'product-card-media';
  const img = document.createElement('img');
  img.src = cover;
  img.alt = product.name;
  media.appendChild(img);

  if (soldOut) {
    const ribbon = document.createElement('span');
    ribbon.className = 'product-card-ribbon';
    ribbon.textContent = 'Agotado';
    media.appendChild(ribbon);
  } else {
    const eyebrow = document.createElement('span');
    eyebrow.className = 'product-card-eyebrow';
    eyebrow.textContent = 'Lanzamiento';
    media.appendChild(eyebrow);
  }

  const nameOverlay = document.createElement('div');
  nameOverlay.className = 'product-card-name';
  nameOverlay.textContent = product.name;
  media.appendChild(nameOverlay);

  link.appendChild(media);

  const body = document.createElement('div');
  body.className = 'product-card-body';

  if (tags.length) {
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'product-card-tags';
    tags.slice(0, 3).forEach((tag) => {
      const span = document.createElement('span');
      span.textContent = tag;
      tagsWrap.appendChild(span);
    });
    body.appendChild(tagsWrap);
  }

  const hasDiscount = product.compare_at_price_cop && product.compare_at_price_cop > product.price_cop;

  const footer = document.createElement('div');
  footer.className = 'product-card-footer';
  const priceRow = document.createElement('div');
  priceRow.className = 'product-card-price-row';
  const price = document.createElement('span');
  price.className = 'product-card-price-text';
  price.innerHTML = '$' + formatCOP(product.price_cop) + '<small>COP</small>';
  priceRow.appendChild(price);
  if (hasDiscount) {
    const compare = document.createElement('span');
    compare.className = 'price-compare';
    compare.textContent = '$' + formatCOP(product.compare_at_price_cop);
    priceRow.appendChild(compare);
  }
  footer.appendChild(priceRow);
  if (!soldOut && product.stock <= 10) {
    const stock = document.createElement('span');
    stock.className = 'product-card-stock';
    stock.textContent = `¡Quedan ${product.stock}!`;
    footer.appendChild(stock);
  }
  body.appendChild(footer);

  link.appendChild(body);

  // Si el producto tiene presentaciones (grano entero / molido), la compra
  // rápida desde la tarjeta usa la primera por defecto -- para elegir otra,
  // el cliente entra a la ficha del producto.
  const defaultVariant = (product.grind_options && product.grind_options[0]) || null;

  const actions = document.createElement('div');
  actions.className = 'product-card-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-primary btn-sm';
  addBtn.disabled = soldOut;
  addBtn.innerHTML = soldOut ? 'Agotado' : 'Añadir al carrito ' + CART_ICON_SVG;
  addBtn.addEventListener('click', (e) => {
    e.preventDefault();
    Cart.add(product, 1, defaultVariant);
    addBtn.textContent = 'Añadido ✓';
    setTimeout(() => { addBtn.innerHTML = 'Añadir al carrito ' + CART_ICON_SVG; }, 1400);
  });
  actions.appendChild(addBtn);

  if (!soldOut) {
    const buyNowBtn = document.createElement('button');
    buyNowBtn.type = 'button';
    buyNowBtn.className = 'btn btn-ghost btn-sm';
    buyNowBtn.textContent = 'Comprar ahora';
    buyNowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      Cart.add(product, 1, defaultVariant);
      window.location.href = '/carrito';
    });
    actions.appendChild(buyNowBtn);
  }

  card.appendChild(link);
  card.appendChild(actions);
  return card;
}

async function loadCatalog() {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('productGridEmpty');
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('fetch_failed');
    const { products } = await res.json();
    if (!products.length) {
      empty.style.display = 'block';
      return;
    }
    products.forEach((p) => grid.appendChild(renderProductCard(p)));
  } catch {
    empty.textContent = 'No se pudo cargar la tienda. Intenta de nuevo más tarde.';
    empty.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', loadCatalog);
