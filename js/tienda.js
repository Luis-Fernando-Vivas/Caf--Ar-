/* Café Arú — catálogo de productos (tienda.html) */

function formatCOP(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function renderProductCard(product) {
  const soldOut = product.stock <= 0;
  const cover = product.images && product.images[0] ? product.images[0].url : 'img/producto-bolsa-500g.png';

  const card = document.createElement('article');
  card.className = 'product-card' + (soldOut ? ' is-sold-out' : '');
  // Sin [data-reveal]: esas tarjetas se crean después de que main.js ya armó
  // su IntersectionObserver en DOMContentLoaded, así que nunca las vería y
  // quedarían con opacity:0 para siempre (el bug de "el producto no aparece").

  const link = document.createElement('a');
  link.href = '/producto?slug=' + encodeURIComponent(product.slug);
  link.setAttribute('data-cursor-hover', '');

  const media = document.createElement('div');
  media.className = 'product-card-media';
  const img = document.createElement('img');
  img.src = cover;
  img.alt = product.name;
  media.appendChild(img);
  if (soldOut) {
    const badge = document.createElement('span');
    badge.className = 'product-card-badge';
    badge.textContent = 'Agotado';
    media.appendChild(badge);
  }
  link.appendChild(media);

  const body = document.createElement('div');
  body.className = 'product-card-body';

  const h3 = document.createElement('h3');
  h3.textContent = product.name;
  body.appendChild(h3);

  const price = document.createElement('span');
  price.className = 'product-card-price';
  price.textContent = '$' + formatCOP(product.price_cop) + ' COP';
  body.appendChild(price);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary btn-sm';
  btn.textContent = soldOut ? 'Agotado' : 'Añadir al carrito';
  btn.disabled = soldOut;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    Cart.add(product, 1);
    btn.textContent = 'Añadido ✓';
    setTimeout(() => { btn.textContent = 'Añadir al carrito'; }, 1400);
  });

  card.appendChild(link);
  card.appendChild(btn);
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
