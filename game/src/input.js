// Input: keyboard state, mouse-look deltas and firing, behind pointer lock.
// The overlay owns the lock: clicking it locks the pointer and starts play;
// losing the lock pauses. Shot modes never request a lock.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let locked = false;
  const pressed = new Set(); // keys pressed since the last takePresses()

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
  }
  function onKeyUp(event) {
    keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  }
  function onMouseDown(event) {
    if (event.button === 0) firing = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) firing = false;
  }
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(locked);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);

  function requestLock() {
    try {
      canvas.requestPointerLock();
    } catch {
      // Pointer lock can be refused right after an exit; the overlay stays.
    }
  }

  function takeLook() {
    const out = { x: lookX, y: lookY };
    lookX = 0;
    lookY = 0;
    return out;
  }

  function takePresses() {
    const out = new Set(pressed);
    pressed.clear();
    return out;
  }

  return {
    state: { keys, get firing() { return firing; } },
    takeLook,
    takePresses,
    requestLock,
    isLocked: () => locked,
  };
}
