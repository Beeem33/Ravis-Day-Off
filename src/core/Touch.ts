/**
 * Is this a phone or tablet? Decided once, at load.
 *
 * A touch screen with no mouse (no hover, a coarse pointer) gets the on-screen
 * controls; a PC — even a touch-screen laptop, whose main pointer is still the
 * mouse — plays exactly as before. `?touch=1` / `?touch=0` force it either
 * way, for trying it out.
 */
function detect(): boolean {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1' || q === 'true') return true;
  if (q === '0' || q === 'false') return false;
  try {
    return matchMedia('(hover: none) and (pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export const TOUCH = detect();
