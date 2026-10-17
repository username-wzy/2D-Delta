// Input is active only inside a raid and never intercepts editable fields.
export const keys = { w: false, a: false, s: false, d: false, shift: false };
export const mouse = { x: 0, y: 0, worldX: 0, worldY: 0, isDown: false, justPressed: false };

export function resetInput() {
  for (const key of Object.keys(keys)) keys[key] = false;
  mouse.isDown = false;
  mouse.justPressed = false;
}

function isEditing(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName?.toUpperCase()) ||
    target?.isContentEditable || Boolean(target?.closest?.('[contenteditable="true"]'));
}

export function initInput(canvas, cameraRef, onInteract, onReload, onToggleInventory, onGrenade, onMedkit, onSwitchWeapon, onNearbyLoot, isActive = () => false) {
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
  window.dispatchEvent(new Event('resize'));
  const movement = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ShiftLeft: 'shift', ShiftRight: 'shift' };
  window.addEventListener('keydown', e => {
    if (!isActive() || isEditing(e.target)) return;
    const key = movement[e.code];
    if (key) { keys[key] = true; e.preventDefault(); return; }
    if (e.repeat) return;
    const actions = { KeyF: onInteract, KeyR: onReload, Tab: onToggleInventory,
      KeyG: onGrenade, KeyH: onNearbyLoot, Digit4: onMedkit,
      Digit1: () => onSwitchWeapon?.(0), Digit2: () => onSwitchWeapon?.(1) };
    const action = actions[e.code];
    if (action) { e.preventDefault(); action(); }
  });
  window.addEventListener('keyup', e => {
    const key = movement[e.code];
    if (key) keys[key] = false;
  });
  window.addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
  window.addEventListener('focusin', e => { if (isEditing(e.target)) resetInput(); });
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mousedown', e => {
    if (e.button === 0 && e.target === canvas && isActive()) {
      mouse.justPressed = !mouse.isDown;
      mouse.isDown = true;
    }
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouse.isDown = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
