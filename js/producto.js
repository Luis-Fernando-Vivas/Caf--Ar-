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
  mainImg.src = cldImage(images[0].url, 'f_auto,q_auto,w_1000');

  images.forEach((img, i) => {
    const btn = document.createElement('button');
    if (i === 0) btn.className = 'active';
    const thumbImg = document.createElement('img');
    thumbImg.src = cldImage(img.url, 'f_auto,q_auto,w_200');
    thumbImg.alt = '';
    thumbImg.loading = 'lazy';
    btn.appendChild(thumbImg);
    btn.addEventListener('click', () => {
      thumbsWrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mainImg.style.opacity = 0;
      setTimeout(() => { mainImg.src = cldImage(img.url, 'f_auto,q_auto,w_1000'); mainImg.style.opacity = 1; }, 250);
    });
    thumbsWrap.appendChild(btn);
  });
}

const SITE_URL = 'https://www.coffeearu.com';

// Corta en el último espacio antes del límite, para que la meta description
// no termine a mitad de palabra en los resultados de Google.
function truncateWords(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:\s]+$/, '') + '…';
}

function absoluteUrl(url) {
  if (!url) return url;
  return /^https?:\/\//.test(url) ? url : SITE_URL + '/' + url.replace(/^\//, '');
}

// Datos estructurados (schema.org) para que Google muestre precio,
// disponibilidad y migas de pan en los resultados. Googlebot ejecuta JS, así
// que los lee aunque se inyecten al cargar el producto.
function injectStructuredData(product, url) {
  const images = (product.images || []).map((img) => absoluteUrl(cldImage(img.url, 'f_auto,q_auto,w_1200')));
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description || '',
      image: images.length ? images : [SITE_URL + '/img/product/cafe-aru.webp'],
      sku: product.slug,
      brand: { '@type': 'Brand', name: 'Café Arú' },
      countryOfOrigin: 'CO',
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'COP',
        price: product.price_cop,
        availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: 'Café Arú' },
        shippingDetails: {
          '@type': 'OfferShippingDetails',
          shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'CO' },
        },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL + '/' },
        { '@type': 'ListItem', position: 2, name: 'Tienda', item: SITE_URL + '/tienda' },
        { '@type': 'ListItem', position: 3, name: product.name, item: url },
      ],
    },
  ];
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

function renderProduct(product) {
  const title = `${product.name} — Café Honey de Huila | Café Arú`;
  const description = truncateWords(`Compra ${product.name}: ${product.description || ''}`, 155);
  const url = SITE_URL + '/producto?slug=' + encodeURIComponent(product.slug);
  // Versión JPG 1200x630 y liviana: WhatsApp/Facebook no muestran vista
  // previa de imágenes pesadas (el original pesa ~1 MB).
  const image = product.images && product.images[0]
    ? absoluteUrl(cldImage(product.images[0].url, 'c_fill,w_1200,h_630,f_jpg,q_auto'))
    : SITE_URL + '/img/product/cafe-aru.webp';

  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageDescription').content = description;
  document.getElementById('pageCanonical').href = url;
  document.getElementById('ogTitle').content = title;
  document.getElementById('ogDescription').content = description;
  document.getElementById('ogUrl').content = url;
  document.getElementById('ogImage').content = image;
  document.getElementById('twitterTitle').content = title;
  document.getElementById('twitterDescription').content = description;
  document.getElementById('twitterImage').content = image;
  document.getElementById('prodName').textContent = product.name;
  document.getElementById('galleryMain').alt = product.name;
  injectStructuredData(product, url);
  if (window.Analytics) {
    Analytics.ecommerce('view_item', [Analytics.productItem(product)], product.price_cop);
  }
  document.getElementById('prodPrice').textContent = '$' + formatCOP(product.price_cop);

  const compareEl = document.getElementById('prodComparePrice');
  const launchBadge = document.getElementById('launchBadge');
  const hasDiscount = product.compare_at_price_cop && product.compare_at_price_cop > product.price_cop;
  if (hasDiscount) {
    compareEl.textContent = '$' + formatCOP(product.compare_at_price_cop);
    compareEl.style.display = '';
    launchBadge.style.display = '';
  } else {
    compareEl.style.display = 'none';
    launchBadge.style.display = 'none';
  }

  document.getElementById('prodDesc').textContent = product.description || '';
  document.getElementById('tabDescLong').textContent = product.description || '';
  document.getElementById('stickyName').textContent = product.name;
  document.getElementById('stickyPrice').textContent = '$' + formatCOP(product.price_cop);
  document.getElementById('stickyImg').src = product.images && product.images[0] ? cldImage(product.images[0].url, 'f_auto,q_auto,w_160') : 'img/product/cafe-aru.webp';

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
  stockNote.textContent = soldOut ? 'Agotado' : 'COP';

  const grindOptions = product.grind_options || [];
  let selectedVariant = grindOptions[0] || null;
  const variantRow = document.getElementById('variantRow');
  const variantOptionsWrap = document.getElementById('variantOptions');
  variantOptionsWrap.innerHTML = '';
  if (grindOptions.length) {
    variantRow.style.display = '';
    grindOptions.forEach((option, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = option;
      if (i === 0) btn.classList.add('active');
      btn.addEventListener('click', () => {
        selectedVariant = option;
        variantOptionsWrap.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
      variantOptionsWrap.appendChild(btn);
    });
  } else {
    variantRow.style.display = 'none';
  }

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
      Cart.add(product, qty, selectedVariant);
      addBtn.textContent = 'Añadido ✓';
      setTimeout(() => { addBtn.textContent = 'Añadir al carrito'; }, 1400);
    });
    stickyBtn.addEventListener('click', () => {
      Cart.add(product, qty, selectedVariant);
      stickyBtn.textContent = 'Añadido ✓';
      setTimeout(() => { stickyBtn.textContent = 'Añadir'; }, 1400);
    });
    buyBtn.addEventListener('click', () => {
      Cart.add(product, qty, selectedVariant);
      window.location.href = '/carrito';
    });
  }

  document.getElementById('productLoading').style.display = 'none';
  document.getElementById('productMain').style.display = '';

  if (window.Reviews) Reviews.init(product);
}

async function loadProduct() {
  const slug = new URLSearchParams(location.search).get('slug') || LEGACY_SLUG;
  try {
    const res = await fetch('/api/products?slug=' + encodeURIComponent(slug));
    if (!res.ok) throw new Error('not_found');
    const { product } = await res.json();
    renderProduct(product);
  } catch {
    // Que Google no indexe la página "No encontramos ese producto".
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    document.getElementById('productLoading').style.display = 'none';
    document.getElementById('productNotFound').style.display = '';
  }
}

document.addEventListener('DOMContentLoaded', loadProduct);
