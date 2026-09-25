/* Café Arú — carrito de compras (localStorage, compartido entre páginas).
   Los precios guardados aquí son solo para mostrar rápido en el navegador --
   api/checkout.js siempre vuelve a leer los precios reales desde la base de
   datos, así que un precio desactualizado en localStorage nunca afecta el cobro. */

const CART_STORAGE_KEY = 'aru_cart';

function cartRead() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function cartWrite(items) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('cart:change', { detail: { items } }));
  Cart.updateBadge();
}

const Cart = {
  getItems() {
    return cartRead();
  },

  getCount() {
    return cartRead().reduce((sum, it) => sum + it.quantity, 0);
  },

  getSubtotal() {
    return cartRead().reduce((sum, it) => sum + it.price_cop * it.quantity, 0);
  },

  // "variant" es la presentación elegida (ej. "Molido" / "Grano entero"), o
  // null si el producto no tiene presentaciones. Dos líneas del mismo
  // producto con distinta presentación se guardan por separado.
  add(product, quantity = 1, variant = null) {
    const items = cartRead();
    const existing = items.find((it) => it.product_id === product.id && (it.variant || null) === (variant || null));
    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + quantity);
    } else {
      items.push({
        product_id: product.id,
        slug: product.slug,
        name: product.name,
        price_cop: product.price_cop,
        image: product.images && product.images[0] ? product.images[0].url : '',
        variant: variant || null,
        quantity: Math.max(1, Math.min(20, quantity)),
      });
    }
    cartWrite(items);
    if (window.Analytics) {
      Analytics.ecommerce('add_to_cart', [Analytics.productItem(product, quantity, variant)], product.price_cop * quantity);
    }
  },

  setQty(productId, quantity, variant = null) {
    const items = cartRead();
    const item = items.find((it) => it.product_id === productId && (it.variant || null) === (variant || null));
    if (!item) return;
    item.quantity = Math.max(1, Math.min(20, parseInt(quantity, 10) || 1));
    cartWrite(items);
  },

  remove(productId, variant = null) {
    const removed = cartRead().find((it) => it.product_id === productId && (it.variant || null) === (variant || null));
    if (removed && window.Analytics) {
      Analytics.ecommerce('remove_from_cart', Analytics.cartItems([removed]), removed.price_cop * removed.quantity);
    }
    cartWrite(cartRead().filter((it) => !(it.product_id === productId && (it.variant || null) === (variant || null))));
  },

  clear() {
    cartWrite([]);
  },

  updateBadge() {
    const count = Cart.getCount();
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = String(count);
      el.style.display = count > 0 ? '' : 'none';
    });
  },
};

document.addEventListener('DOMContentLoaded', () => Cart.updateBadge());
