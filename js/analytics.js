/* Café Arú — Google Analytics 4 (gtag.js), Meta Pixel y eventos de e-commerce.
   Se carga en el <head> de las páginas públicas (no en /admin), antes que
   cart.js y los demás scripts, para que `Analytics` ya exista cuando lo usen. */

const GA_MEASUREMENT_ID = 'G-65DS79JYBB';
const META_PIXEL_ID = '1129815669549236';

// Solo se mide el dominio real: localhost y las previews de Vercel no deben
// ensuciar los reportes con visitas de prueba.
const IS_PRODUCTION = /(^|\.)coffeearu\.com$/.test(location.hostname);
if (!IS_PRODUCTION) {
  window['ga-disable-' + GA_MEASUREMENT_ID] = true;
}

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_MEASUREMENT_ID);

// Meta Pixel (código base oficial). Fuera de producción no se carga fbevents.js,
// así que la cola de `fbq` nunca se envía.
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];if(!IS_PRODUCTION)return;
t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', META_PIXEL_ID);
fbq('track', 'PageView');

// Equivalencias GA4 → eventos de Meta. Los que no están aquí (view_cart,
// remove_from_cart) solo se envían a GA4.
const META_EVENTS = {
  view_item: 'ViewContent',
  view_item_list: 'ViewCategory',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  purchase: 'Purchase',
  generate_lead: 'Lead',
  whatsapp_click: 'Contact',
};
// No son eventos estándar de Meta, se envían con trackCustom.
const META_CUSTOM_EVENTS = new Set(['ViewCategory']);

function metaParams(params) {
  const items = params.items || [];
  const out = {
    content_type: 'product',
    content_ids: items.map((it) => it.item_id),
    contents: items.map((it) => ({ id: it.item_id, quantity: it.quantity || 1, item_price: it.price })),
    num_items: items.reduce((n, it) => n + (it.quantity || 1), 0),
  };
  if (params.value !== undefined) {
    out.value = params.value;
    out.currency = params.currency || 'COP';
  }
  if (items.length === 1) out.content_name = items[0].item_name;
  if (params.item_list_name) out.content_category = params.item_list_name;
  return out;
}

function trackMeta(gaName, params) {
  const metaName = META_EVENTS[gaName];
  if (!metaName) return;
  const data = params.items ? metaParams(params) : {};
  // La referencia de Wompi va como eventID para que Meta pueda deduplicar la
  // compra si más adelante también se envía por la Conversions API.
  const options = params.transaction_id ? { eventID: params.transaction_id } : undefined;
  fbq(META_CUSTOM_EVENTS.has(metaName) ? 'trackCustom' : 'track', metaName, data, options);
}

// Pedido guardado antes de salir a Wompi: gracias.html borra el carrito al
// cargar, así que sin esto no sabríamos qué productos reportar en "purchase".
const PENDING_PURCHASE_KEY = 'aru_pending_purchase';
const TRACKED_PURCHASES_KEY = 'aru_tracked_purchases';

const Analytics = {
  event(name, params = {}) {
    gtag('event', name, params);
    trackMeta(name, params);
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
