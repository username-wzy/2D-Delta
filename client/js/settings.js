const KEY = '2d-delta-settings';
const defaults = { sound: true, screenShake: true, compactHUD: false, reducedMotion: false };
let settings = { ...defaults };
function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement?.classList.toggle('compact-hud', settings.compactHUD);
  document.documentElement?.classList.toggle('reduced-motion', settings.reducedMotion);
}
export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const key of Object.keys(defaults)) settings[key] = typeof raw?.[key] === 'boolean' ? raw[key] : defaults[key];
  } catch { settings = { ...defaults }; }
  apply(); return getSettings();
}
export function getSettings() { return { ...settings }; }
export function setSettings(patch) {
  const next = { ...settings };
  for (const key of Object.keys(defaults)) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { throw new Error('设置保存失败，请允许站点存储后重试。'); }
  settings = next; apply(); return getSettings();
}
