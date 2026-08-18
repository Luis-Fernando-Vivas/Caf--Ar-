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

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------- page loader ---------------- */
  const loader = document.querySelector('.page-loader');
  if (loader) {
    window.addEventListener('load', () => {
      setTimeout(() => loader.classList.add('is-done'), 250);
    });
  }

  /* ---------------- header scroll state ---------------- */
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 30);
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

  /* ---------------- sticky buy bar (product page) ---------------- */
  const stickyBuy = document.querySelector('.sticky-buy');
  const buyBoxRef = document.querySelector('.buy-box');
  if (stickyBuy && buyBoxRef) {
    const io2 = new IntersectionObserver(([entry]) => {
      stickyBuy.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold:0 });
    io2.observe(buyBoxRef);
  }

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
