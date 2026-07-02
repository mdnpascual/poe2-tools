import koffi from "koffi";

const user32 = koffi.load("user32.dll");

const SetCursorPos = user32.func("bool SetCursorPos(int32 x, int32 y)");

/**
 * Move mouse to absolute position (physical pixels).
 */
export function mouseMove(x: number, y: number) {
  SetCursorPos(x, y);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
