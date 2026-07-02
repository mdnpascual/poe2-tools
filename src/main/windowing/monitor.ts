import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const shcore = koffi.load("shcore.dll");

// Types
const HMONITOR = koffi.pointer("HMONITOR", koffi.opaque());
const RECT = koffi.struct("RECT", {
  left: "int32",
  top: "int32",
  right: "int32",
  bottom: "int32",
});
const MONITORINFO = koffi.struct("MONITORINFO", {
  cbSize: "uint32",
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: "uint32",
});

// Functions
const MonitorFromPoint = user32.func(
  "HMONITOR MonitorFromPoint(int32 x, int32 y, uint32 dwFlags)"
);
const GetMonitorInfoW = user32.func(
  "bool GetMonitorInfoW(HMONITOR hMonitor, _Inout_ MONITORINFO *lpmi)"
);
const GetDpiForSystem = user32.func("uint32 GetDpiForSystem()");

// Shcore for per-monitor DPI
const GetDpiForMonitor = shcore.func(
  "int32 GetDpiForMonitor(HMONITOR hmonitor, int32 dpiType, _Out_ uint32 *dpiX, _Out_ uint32 *dpiY)"
);

export interface MonitorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

const MONITOR_DEFAULTTOPRIMARY = 1;
const MDT_EFFECTIVE_DPI = 0;

export function getPrimaryMonitor(): MonitorBounds {
  // Point (0,0) is always on the primary monitor
  const hMonitor = MonitorFromPoint(0, 0, MONITOR_DEFAULTTOPRIMARY);

  const info = {
    cbSize: koffi.sizeof(MONITORINFO),
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  };
  GetMonitorInfoW(hMonitor, info);

  // Get DPI for this monitor
  const dpiX = [0];
  const dpiY = [0];
  GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, dpiX, dpiY);
  const scaleFactor = (dpiX[0] || 96) / 96;

  const mon = info.rcMonitor;
  return {
    x: mon.left,
    y: mon.top,
    width: mon.right - mon.left,
    height: mon.bottom - mon.top,
    scaleFactor,
  };
}
