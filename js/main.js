/* =====================================================================
   Café Arú — comportamiento del sitio
   ===================================================================== */

/* ---------------------------------------------------------------------
   El checkout ahora es un carrito real (ver js/cart.js + carrito.html +
   api/checkout.js). Este archivo se quedó solo con el comportamiento
   genérico del sitio (nav, animaciones, galería, tabs, lightbox); la lógica
   de compra específica de cada página vive en js/tienda.js / js/producto.js.
--------------------------------------------------------------------- */

function formatCOP(n){
  return n.toLocaleString('es-CO', { maximumFractionDigits:0 });
}

/* Fotos subidas a Cloudinary: pide una versión liviana (formato y calidad
   automáticos, ancho acotado) en vez del original de ~1-2 MB. Cualquier otra
   URL se devuelve tal cual. */
function cldImage(url, transform) {
  if (typeof url !== 'string') return url;
  return url.replace(
    /(res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/)/,
    '$1' + (transform || 'f_auto,q_auto,w_900') + '/$2'
  );
}

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------- page loader ---------------- */
  // Se oculta al terminar de cargar, pero nunca más de ~1.2 s: esperar a
  // todas las imágenes retrasaba el primer pintado (LCP) que mide Google.
  const loader = document.querySelector('.page-loader');
  if (loader) {
    const hideLoader = () => loader.classList.add('is-done');
    window.addEventListener('load', () => setTimeout(hideLoader, 250));
    setTimeout(hideLoader, 1200);
  }

  /* ---------------- botón flotante "¿Dudas?" (WhatsApp) ---------------- */
  // Se inyecta desde aquí para no repetir el HTML en cada página. Se esconde
  // cuando el footer está en pantalla (ya tiene su propio enlace a WhatsApp)
  // para no tapar enlaces ni el copyright.
  const helpFab = document.createElement('a');
  helpFab.className = 'help-fab';
  helpFab.href = 'https://wa.me/573132834162?text=' +
    encodeURIComponent('¡Hola Café Arú! Tengo una duda:');
  helpFab.target = '_blank';
  helpFab.rel = 'noopener';
  helpFab.setAttribute('aria-label', '¿Dudas? Escríbenos por WhatsApp');
  helpFab.innerHTML =
    '<span class="help-fab-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.41 9.41 0 0 1-1.44-5.01c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.42-9.44 9.42zm8.03-17.45A11.3 11.3 0 0 0 12.05.72C5.8.72.7 5.8.7 12.07c0 2 .52 3.95 1.52 5.67L.6 23.28l5.68-1.49a11.33 11.33 0 0 0 5.77 1.47h.01c6.25 0 11.34-5.09 11.35-11.35 0-3.03-1.18-5.88-3.33-8.02z"/></svg>' +
    '</span>' +
    '<span class="help-fab-text"><small>¿Dudas?</small><strong>Escríbenos</strong></span>';
  document.body.appendChild(helpFab);
  setTimeout(() => helpFab.classList.add('is-in'), 1400);

  const siteFooter = document.querySelector('footer');
  if (siteFooter && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      helpFab.classList.toggle('is-away', entry.isIntersecting);
    }, { rootMargin: '0px 0px -40px 0px' }).observe(siteFooter);
  }

  /* ---------------- header scroll state ---------------- */
  const header = document.querySelector('.site-header');
  if (header) {
    // El header claro/transparente está pensado para ir encima de un hero oscuro
    // (.page-hero). En páginas que no tienen uno (ej. producto.html), forzamos
    // el estado "scrolled" siempre, para que el texto no quede invisible sobre
    // el fondo claro del resto de la página.
    const hasHero = Boolean(document.querySelector('.page-hero, .hero'));
    const onScroll = () => header.classList.toggle('is-scrolled', !hasHero || window.scrollY > 30);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive:true });
  }

  /* ---------------- mobile nav ---------------- */
  const burger = document.querySelector('.burger');
  const mobileNav = document.querySelector('.mobile-nav');
  if (burger && mobileNav) {
    burger.addEventListener('click', () => {
      burger.classList.toggle('is-open');
      mobileNav.classList.toggle('is-open');
      document.body.style.overflow = mobileNav.classList.contains('is-open') ? 'hidden' : '';
    });
    mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      burger.classList.remove('is-open');
      mobileNav.classList.remove('is-open');
      document.body.style.overflow = '';
    }));
  }

  /* ---------------- active nav link ---------------- */
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) a.classList.add('active');
  });

  /* ---------------- scroll reveal ---------------- */
  const revealEls = document.querySelectorAll('[data-reveal], .split-lines');
  if ('IntersectionObserver' in window && revealEls.length) {
    // stagger delay is applied once, via setTimeout, right before the entrance
    // transition fires -- never as a lingering transition-delay, so it can't
    // also delay this same element's hover transitions afterwards.
    const groupCounters = new WeakMap();
    revealEls.forEach((el) => {
      const group = el.closest('[data-reveal-group]');
      if (group) {
        const n = groupCounters.get(group) || 0;
        groupCounters.set(group, n + 1);
        el.dataset.staggerDelay = Math.min(n, 7) * 90;
      }
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const delay = Number(el.dataset.staggerDelay || 0);
          setTimeout(() => el.classList.add('is-visible'), delay);
          io.unobserve(el);
        }
      });
    }, { threshold:0.15, rootMargin:'0px 0px -8% 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  /* ---------------- animated counters ---------------- */
  const counters = document.querySelectorAll('[data-counter]');
  if (counters.length && 'IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseFloat(el.dataset.counter);
        const suffix = el.dataset.suffix || '';
        const duration = 1400;
        const start = performance.now();
        function tick(now){
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          const val = target < 10 ? (target * eased).toFixed(0) : Math.round(target * eased);
          el.textContent = val + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold:0.6 });
    counters.forEach(el => cio.observe(el));
  }

  /* sticky buy bar (product page): ver setupStickyBuy() en producto.js,
     se activa solo cuando el producto ya cargó. */

  /* ---------------- product image gallery ---------------- */
  const mainImg = document.querySelector('[data-gallery-main]');
  const thumbs = document.querySelectorAll('[data-gallery-thumb]');
  if (mainImg && thumbs.length) {
    thumbs.forEach(btn => btn.addEventListener('click', () => {
      thumbs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const src = btn.dataset.galleryThumb;
      mainImg.style.opacity = 0;
      setTimeout(() => { mainImg.src = src; mainImg.style.opacity = 1; }, 220);
    }));
  }

  /* ---------------- product tabs ---------------- */
  const tabBtns = document.querySelectorAll('[data-tab]');
  const tabPanels = document.querySelectorAll('[data-tab-panel]');
  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`[data-tab-panel="${btn.dataset.tab}"]`)?.classList.add('active');
  }));

  /* ---------------- gallery filter ---------------- */
  const filterBtns = document.querySelectorAll('[data-filter]');
  const galleryItems = document.querySelectorAll('[data-category]');
  filterBtns.forEach(btn => btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;
    galleryItems.forEach(item => {
      const show = filter === 'all' || item.dataset.category === filter;
      item.style.display = show ? '' : 'none';
    });
  }));

  /* ---------------- lightbox ---------------- */
  const lightbox = document.querySelector('.lightbox');
  if (lightbox) {
    const lbImg = lightbox.querySelector('img');
    const lbCaption = lightbox.querySelector('.lightbox-caption');
    const items = Array.from(document.querySelectorAll('[data-lightbox]'));
    let current = 0;

    function openLightbox(i){
      current = i;
      const el = items[current];
      lbImg.src = el.dataset.lightbox;
      lbCaption.textContent = el.dataset.caption || '';
      lightbox.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox(){
      lightbox.classList.remove('is-open');
      document.body.style.overflow = '';
    }
    function step(dir){
      current = (current + dir + items.length) % items.length;
      openLightbox(current);
    }

    items.forEach((el, i) => el.addEventListener('click', () => openLightbox(i)));
    lightbox.querySelector('.lightbox-close')?.addEventListener('click', closeLightbox);
    lightbox.querySelector('.lightbox-prev')?.addEventListener('click', () => step(-1));
    lightbox.querySelector('.lightbox-next')?.addEventListener('click', () => step(1));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  }

  /* ---------------- magnetic buttons (desktop only) ---------------- */
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    document.querySelectorAll('[data-magnetic]').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });

    /* custom cursor */
    const cursor = document.querySelector('.reveal-cursor');
    if (cursor) {
      let cx = 0, cy = 0, tx = 0, ty = 0;
      window.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; });
      (function raf(){
        cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18;
        cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%,-50%)`;
        requestAnimationFrame(raf);
      })();
      document.querySelectorAll('a, button, [data-cursor-hover]').forEach(el => {
        el.addEventListener('mouseenter', () => cursor.classList.add('is-hover'));
        el.addEventListener('mouseleave', () => cursor.classList.remove('is-hover'));
      });
    }
  }

});
