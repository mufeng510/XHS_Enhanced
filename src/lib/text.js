export function normalizeSpace(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}
