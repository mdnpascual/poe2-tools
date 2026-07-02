import { uIOhook } from "uiohook-napi";

let started = false;
let pickCallback: ((pos: { x: number; y: number }) => void) | null = null;
let suppressClick = false;

export function startHook() {
  if (started) return;
  started = true;

  uIOhook.on("wheel", (e) => {
    if (suppressClick) {
      // Mouse wheel during pick mode — capture position
      const pos = { x: e.x, y: e.y };
      if (pickCallback) {
        const cb = pickCallback;
        pickCallback = null;
        suppressClick = false;
        cb(pos);
      }
    }
  });

  uIOhook.start();
}

export function stopHook() {
  if (!started) return;
  uIOhook.stop();
  started = false;
}

/**
 * Enter pick mode: next left click will be intercepted,
 * position returned via callback, click suppressed from reaching the game.
 */
export function enterPickMode(cb: (pos: { x: number; y: number }) => void) {
  pickCallback = cb;
  suppressClick = true;
}

export function isInPickMode(): boolean {
  return suppressClick;
}
