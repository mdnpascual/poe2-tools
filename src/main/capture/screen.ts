import koffi from "koffi";

const gdi32 = koffi.load("gdi32.dll");
const user32 = koffi.load("user32.dll");

const BITMAPINFOHEADER = koffi.struct("BITMAPINFOHEADER", {
  biSize: "uint32",
  biWidth: "int32",
  biHeight: "int32",
  biPlanes: "uint16",
  biBitCount: "uint16",
  biCompression: "uint32",
  biSizeImage: "uint32",
  biXPelsPerMeter: "int32",
  biYPelsPerMeter: "int32",
  biClrUsed: "uint32",
  biClrImportant: "uint32",
});

// All handles as intptr to avoid type mismatch issues
const GetDC = user32.func("intptr GetDC(intptr hWnd)");
const ReleaseDC = user32.func("int32 ReleaseDC(intptr hWnd, intptr hDC)");
const CreateCompatibleDC = gdi32.func("intptr CreateCompatibleDC(intptr hdc)");
const CreateCompatibleBitmap = gdi32.func("intptr CreateCompatibleBitmap(intptr hdc, int32 cx, int32 cy)");
const SelectObject = gdi32.func("intptr SelectObject(intptr hdc, intptr h)");
const BitBlt = gdi32.func("bool BitBlt(intptr hdc, int32 x, int32 y, int32 cx, int32 cy, intptr hdcSrc, int32 x1, int32 y1, uint32 rop)");
const GetDIBits = gdi32.func("int32 GetDIBits(intptr hdc, intptr hbm, uint32 start, uint32 cLines, _Out_ uint8 *lpvBits, _Inout_ BITMAPINFOHEADER *lpbmi, uint32 usage)");
const DeleteObject = gdi32.func("bool DeleteObject(intptr ho)");
const DeleteDC = gdi32.func("bool DeleteDC(intptr hdc)");

const SRCCOPY = 0x00CC0020;
const BI_RGB = 0;
const DIB_RGB_COLORS = 0;

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureResult {
  buffer: Buffer;
  width: number;
  height: number;
  channels: 4;
}

/**
 * Capture a region of the screen using Win32 BitBlt.
 * Coordinates are in physical pixels (not DPI-scaled).
 */
export function captureScreen(region: CaptureRegion): CaptureResult {
  const { x, y, width, height } = region;

  const hScreenDC = GetDC(0);
  const hMemDC = CreateCompatibleDC(hScreenDC);
  const hBitmap = CreateCompatibleBitmap(hScreenDC, width, height);
  const hOld = SelectObject(hMemDC, hBitmap);

  BitBlt(hMemDC, 0, 0, width, height, hScreenDC, x, y, SRCCOPY);

  const bmi = {
    biSize: 40,
    biWidth: width,
    biHeight: -height, // negative = top-down
    biPlanes: 1,
    biBitCount: 32,
    biCompression: BI_RGB,
    biSizeImage: width * height * 4,
    biXPelsPerMeter: 0,
    biYPelsPerMeter: 0,
    biClrUsed: 0,
    biClrImportant: 0,
  };

  const buffer = Buffer.alloc(width * height * 4);
  GetDIBits(hMemDC, hBitmap, 0, height, buffer, bmi, DIB_RGB_COLORS);

  // Cleanup
  SelectObject(hMemDC, hOld);
  DeleteObject(hBitmap);
  DeleteDC(hMemDC);
  ReleaseDC(0, hScreenDC);

  return { buffer, width, height, channels: 4 };
}
