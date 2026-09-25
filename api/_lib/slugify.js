// Genera un slug URL-safe a partir de un nombre de producto (quita tildes,
// pasa a minúsculas, reemplaza todo lo que no sea [a-z0-9] por guiones).

function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas diacríticas (tildes, diéresis, etc.)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
