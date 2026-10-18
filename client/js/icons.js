// Small interface symbols drawn as a consistent vector set.
const paths = {
  settings: '<path d="m9 3 1-2h4l1 2 3 1 2-1 2 3-2 2v4l2 2-2 3-2-1-3 1-1 2h-4l-1-2-3-1-2 1-2-3 2-2V8L2 6l2-3 2 1z"/><circle cx="12" cy="10" r="3"/>',
  extract: '<path d="M3 17h18M8 17v4m8-4v4M7 13V8l5-5 5 5v5M12 3v11m-4-4 4 4 4-4"/>',
  backpack: '<path d="M7 7V5a5 5 0 0 1 10 0v2M5 7h14v15H5zM8 12h8v6H8zM5 10H2v8h3m14-8h3v8h-3"/>',
  container: '<path d="M3 5h18v16H3zM3 10h18M8 5V2h8v3M10 14h4"/>',
  secure: '<path d="M4 9h16v13H4zM8 9V6a4 4 0 0 1 8 0v3M12 14v3"/>',
  armor: '<path d="m5 2 4 2h6l4-2 3 7-4 2v11H6V11L2 9zM9 10h6v7H9z"/>',
  weapon: '<path d="M2 8h15v6H9l-2 7H3l2-7H2zM17 9h5v3h-5M10 14v3h4v-3M5 5v3m7-3v3"/>',
  repair: '<path d="m15 3 3 3-4 4-2-2 4-5a6 6 0 0 0-7 7L2 17l5 5 8-8a6 6 0 0 0 7-7l-5 4-2-2 3-3z"/>',
  medical: '<path d="M3 5h18v16H3zM8 5V2h8v3M9 10h6v3h3v4h-3v3H9v-3H6v-4h3z"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  warning: '<path d="m12 2 11 20H1zM12 8v6m0 3v1"/>',
  check: '<path d="m4 12 5 5L21 5"/>',
  coin: '<path d="M16 4a9 9 0 1 0 0 16M2 10h11m-11 4h11"/>',
  failure: '<path d="m3 3 18 18M21 3 3 21M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>',
};
export function iconMarkup(name, label = '') {
  const safe = String(label).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" ${label ? `role="img" aria-label="${safe}"` : 'aria-hidden="true"'}>${paths[name] || paths.container}</svg>`;
}
export function setUIIcon(element, name, label) { if (element) element.innerHTML = iconMarkup(name, label); }
