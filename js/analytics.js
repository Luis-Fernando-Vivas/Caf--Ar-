/* Café Arú — Google Analytics 4 (gtag.js) y eventos de e-commerce.
   Se carga en el <head> de las páginas públicas (no en /admin), antes que
   cart.js y los demás scripts, para que `Analytics` ya exista cuando lo usen. */

const GA_MEASUREMENT_ID = 'G-65DS79JYBB';

// Solo se mide el dominio real: localhost y las previews de Vercel no deben
// ensuciar los reportes con visitas de prueba.
if (!/(^|\.)coffeearu\.com$/.test(location.hostname)) {
  window['ga-disable-' + GA_MEASUREMENT_ID] = true;
}

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_MEASUREMENT_ID);

// Pedido guardado antes de salir a Wompi: gracias.html borra el carrito al
// cargar, así que sin esto no sabríamos qué productos reportar en "purchase".
const PENDING_PURCHASE_KEY = 'aru_pending_purchase';
const TRACKED_PURCHASES_KEY = 'aru_tracked_purchases';

const Analytics = {
  event(name, params = {}) {
    gtag('event', name, params);
  },

  productItem(product, quantity = 1, variant = null) {
    return {
      item_id: product.slug,
      item_name: product.name,
      item_brand: 'Café Arú',
      item_variant: variant || undefined,
      price: product.price_cop,
      quantity,
    };
  },

  cartItems(items) {
    return items.map((it) => ({
      item_id: it.slug,
      item_name: it.name,
      item_brand: 'Café Arú',
      item_variant: it.variant || undefined,
      price: it.price_cop,
      quantity: it.quantity,
    }));
  },

  ecommerce(name, items, value, extra = {}) {
    Analytics.event(name, { currency: 'COP', value, items, ...extra });
  },

  savePendingPurchase(order) {
    try {
      localStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(order));
    } catch {}
  },

  // Se llama desde gracias.html solo con pagos APPROVED. La referencia de Wompi
  // se usa como transaction_id y se recuerda para que recargar la página no
  // cuente la misma venta dos veces.
  trackPurchase(reference, valueCop) {
    let tracked = [];
    try {
      tracked = JSON.parse(localStorage.getItem(TRACKED_PURCHASES_KEY) || '[]');
    } catch {}
    if (tracked.includes(reference)) return;

    let pending = null;
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_PURCHASE_KEY) || 'null');
    } catch {}
    const items = pending && pending.reference === reference ? pending.items : [];

    Analytics.ecommerce('purchase', items, valueCop, {
      transaction_id: reference,
      shipping: pending && pending.reference === reference ? pending.shipping : undefined,
      coupon: pending && pending.reference === reference ? pending.coupon : undefined,
    });

    try {
      localStorage.setItem(TRACKED_PURCHASES_KEY, JSON.stringify(tracked.concat(reference).slice(-20)));
      localStorage.removeItem(PENDING_PURCHASE_KEY);
    } catch {}
  },
};

// Un `const` global no queda como propiedad de window, y los demás scripts
// comprueban `window.Analytics` antes de enviar eventos.
window.Analytics = Analytics;

// Clics a cualquier enlace de WhatsApp (footer, botones de ayuda, etc.).
document.addEventListener('click', (e) => {
  const link = e.target.closest && e.target.closest('a[href*="wa.me/"]');
  if (!link) return;
  Analytics.event('whatsapp_click', { page_path: location.pathname, link_text: (link.textContent || link.getAttribute('aria-label') || '').trim() });
});
