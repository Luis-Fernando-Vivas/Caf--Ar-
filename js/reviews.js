/* Café Arú — reseñas de producto (producto.html): resumen, carrusel y popup */

function reviewStarsHTML(rating) {
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= Math.round(rating) ? '★' : '☆';
  return out;
}

function formatReviewDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

const Reviews = {
  productId: null,
  selectedRating: 0,

  async init(product) {
    this.productId = product.id;
    await this.load();
    this.wireStarPicker();
    this.wireForm();
    this.wireModal();
    this.wireCarousel();
    this.wireMiniScroll();
  },

  async load() {
    const res = await fetch('/api/reviews?product_id=' + this.productId);
    if (!res.ok) return;
    const { reviews, average, count } = await res.json();
    this.renderSummary(average, count);
    this.renderMini(average, count);
    this.renderList(reviews);
  },

  renderSummary(average, count) {
    document.getElementById('reviewsAvg').textContent = count ? average.toFixed(1) : '–';
    document.getElementById('reviewsAvgStars').textContent = reviewStarsHTML(count ? average : 0);
    document.getElementById('reviewsCount').textContent = count
      ? `${count} ${count === 1 ? 'reseña' : 'reseñas'}`
      : 'Sin reseñas todavía';
  },

  // Estrellas + conteo arriba del título del producto, que enlazan a la sección de reseñas.
  renderMini(average, count) {
    const mini = document.getElementById('reviewsMini');
    if (!count) {
      mini.style.display = 'none';
      return;
    }
    document.getElementById('reviewsMiniStars').textContent = reviewStarsHTML(average);
    document.getElementById('reviewsMiniCount').textContent = `${average.toFixed(1)} · ${count} ${count === 1 ? 'reseña' : 'reseñas'}`;
    mini.style.display = '';
  },

  renderList(reviews) {
    const list = document.getElementById('reviewsList');
    const empty = document.getElementById('reviewsEmpty');
    const carousel = document.querySelector('.reviews-carousel');
    list.innerHTML = '';
    if (!reviews.length) {
      empty.style.display = 'block';
      carousel.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    carousel.style.display = '';

    reviews.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'review-card';

      const head = document.createElement('div');
      head.className = 'review-card-head';
      const name = document.createElement('strong');
      name.textContent = r.author_name;
      const stars = document.createElement('span');
      stars.className = 'review-stars';
      stars.textContent = reviewStarsHTML(r.rating);
      head.append(name, stars);

      const comment = document.createElement('p');
      comment.textContent = r.comment;

      const date = document.createElement('span');
      date.className = 'review-date';
      date.textContent = formatReviewDate(r.created_at);

      card.append(head, comment, date);
      list.appendChild(card);
    });
  },

  wireStarPicker() {
    const picker = document.getElementById('starPicker');
    picker.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedRating = parseInt(btn.dataset.star, 10);
        picker.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('active', parseInt(b.dataset.star, 10) <= this.selectedRating);
        });
      });
    });
  },

  wireForm() {
    const form = document.getElementById('reviewForm');
    const errorEl = document.getElementById('reviewError');
    const submitBtn = document.getElementById('reviewSubmitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';

      if (!this.selectedRating) {
        errorEl.textContent = 'Elige una calificación de 1 a 5 estrellas.';
        return;
      }

      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: this.productId,
            author_name: document.getElementById('reviewName').value.trim(),
            rating: this.selectedRating,
            comment: document.getElementById('reviewComment').value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorEl.textContent = data.message || 'No se pudo enviar tu reseña.';
          submitBtn.disabled = false;
          return;
        }
        form.style.display = 'none';
        document.getElementById('reviewSuccess').style.display = 'block';
      } catch {
        errorEl.textContent = 'No se pudo conectar con el servidor.';
        submitBtn.disabled = false;
      }
    });
  },

  wireModal() {
    const modal = document.getElementById('reviewModal');
    const open = () => { modal.classList.add('is-open'); document.body.style.overflow = 'hidden'; };
    const close = () => { modal.classList.remove('is-open'); document.body.style.overflow = ''; };

    document.getElementById('openReviewModalBtn').addEventListener('click', open);
    document.getElementById('reviewModalClose').addEventListener('click', close);
    document.getElementById('reviewModalBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    });
  },

  wireCarousel() {
    const list = document.getElementById('reviewsList');
    const prevBtn = document.getElementById('reviewsPrevBtn');
    const nextBtn = document.getElementById('reviewsNextBtn');
    function step(dir) {
      const card = list.querySelector('.review-card');
      const amount = card ? card.getBoundingClientRect().width + 20 : 300;
      list.scrollBy({ left: dir * amount, behavior: 'smooth' });
    }
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
  },

  wireMiniScroll() {
    document.getElementById('reviewsMini').addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById('reviewsSection');
      const headerOffset = 90;
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  },
};

window.Reviews = Reviews;
