import { useState, useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    api: {
      getCaptureData: () => Promise<{ buffer: string; width: number; height: number; buffCount: number }>;
      applyCaptureOverlay: (data: any) => void;
      cancelCaptureOverlay: () => void;
    };
  }
}

type Mode = "region" | `buff_${number}` | `timer_${number}`;

interface Rect {
  x: number; y: number; width: number; height: number;
}

export function CaptureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [imgWidth, setImgWidth] = useState(0);
  const [imgHeight, setImgHeight] = useState(0);
  const [buffCount, setBuffCount] = useState(2);
  const [mode, setMode] = useState<Mode>("region");
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [drawing, setDrawing] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [currentPt, setCurrentPt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    (window.api as any).getCaptureData().then((data: any) => {
      const { buffer, width, height, buffCount: bc } = data;
      setImgWidth(width);
      setImgHeight(height);
      setBuffCount(bc);

      const raw = Uint8Array.from(atob(buffer), c => c.charCodeAt(0));
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const off = i * 4;
        rgba[off] = raw[off + 2];
        rgba[off + 1] = raw[off + 1];
        rgba[off + 2] = raw[off];
        rgba[off + 3] = 255;
      }
      setImageData(new ImageData(rgba, width, height));
    });
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(imageData, 0, 0);

    for (const [key, rect] of Object.entries(rects)) {
      const isTimer = key.startsWith("timer_");
      const color = key === "region" ? "#00ff00" : isTimer ? "#00ccff" : "#ff6600";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      let label: string;
      if (key === "region") label = "Region";
      else if (isTimer) label = `Timer ${parseInt(key.split("_")[1]) + 1}`;
      else label = `Buff ${parseInt(key.split("_")[1]) + 1}`;

      ctx.font = "bold 28px monospace";
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.fillRect(rect.x, rect.y - 36, textW + 8, 34);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, rect.x + 4, rect.y - 10);
    }

    if (drawing && startPt && currentPt) {
      const r = normalizeRect(startPt, currentPt);
      const isTimer = (mode as string).startsWith("timer_");
      ctx.strokeStyle = mode === "region" ? "#00ff00" : isTimer ? "#00ccff" : "#ff6600";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.setLineDash([]);
    }
  }, [imageData, rects, drawing, startPt, currentPt, mode]);

  useEffect(() => { redraw(); }, [redraw]);

  const getCanvasPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = imgWidth / rect.width;
    const scaleY = imgHeight / rect.height;
    return { x: Math.round((e.clientX - rect.left) * scaleX), y: Math.round((e.clientY - rect.top) * scaleY) };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    setDrawing(true);
    setStartPt(getCanvasPos(e));
  };

  const [mouseScreen, setMouseScreen] = useState<{ x: number; y: number } | null>(null);
  const [mouseImg, setMouseImg] = useState<{ x: number; y: number } | null>(null);
  const zoomRef = useRef<HTMLCanvasElement>(null);
  const isTimerMode = (mode as string).startsWith("timer_");

  const onMouseMove = (e: React.MouseEvent) => {
    if (drawing) setCurrentPt(getCanvasPos(e));
    setMouseScreen({ x: e.clientX, y: e.clientY });
    setMouseImg(getCanvasPos(e));
  };

  // Draw zoom magnifier
  useEffect(() => {
    if (!isTimerMode || !mouseImg || !imageData || !zoomRef.current) return;
    const zCanvas = zoomRef.current;
    const zCtx = zCanvas.getContext("2d")!;
    const zoom = 4;
    const srcSize = 60; // pixels around cursor in image space
    const sx = mouseImg.x - srcSize / 2;
    const sy = mouseImg.y - srcSize / 2;

    // Create temp canvas to draw imageData, then drawImage scaled
    const tmp = document.createElement("canvas");
    tmp.width = imgWidth;
    tmp.height = imgHeight;
    tmp.getContext("2d")!.putImageData(imageData, 0, 0);

    zCtx.imageSmoothingEnabled = false;
    zCtx.clearRect(0, 0, zCanvas.width, zCanvas.height);
    zCtx.drawImage(tmp, sx, sy, srcSize, srcSize, 0, 0, zCanvas.width, zCanvas.height);

    // Crosshair
    zCtx.strokeStyle = "#ff0";
    zCtx.lineWidth = 1;
    const mid = zCanvas.width / 2;
    zCtx.beginPath();
    zCtx.moveTo(mid, 0); zCtx.lineTo(mid, zCanvas.height);
    zCtx.moveTo(0, mid); zCtx.lineTo(zCanvas.width, mid);
    zCtx.stroke();
  }, [mouseImg, isTimerMode, imageData, imgWidth, imgHeight]);

  const onMouseUp = (e: React.MouseEvent) => {
    if (!drawing || !startPt) return;
    setDrawing(false);
    const end = getCanvasPos(e);
    const r = normalizeRect(startPt, end);
    if (r.width > 5 && r.height > 5) {
      setRects((prev) => ({ ...prev, [mode]: r }));
    }
    setStartPt(null);
    setCurrentPt(null);
  };

  const handleApply = () => {
    const captureRegion = rects["region"] || null;
    const templates: { index: number; rect: Rect | null; timerRect: Rect | null }[] = [];
    for (let i = 0; i < buffCount; i++) {
      templates.push({
        index: i,
        rect: rects[`buff_${i}`] || null,
        timerRect: rects[`timer_${i}`] || null,
      });
    }
    (window.api as any).applyCaptureOverlay({ captureRegion, templates });
  };

  const handleCancel = () => {
    (window.api as any).cancelCaptureOverlay();
  };

  if (!imageData) return <div style={{ color: "#fff", padding: 20 }}>Capturing screen...</div>;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Floating controls */}
      <div style={{
        position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", zIndex: 10,
        display: "flex", gap: 6, background: "rgba(0,0,0,0.85)", padding: "8px 12px", borderRadius: 6, flexWrap: "wrap", justifyContent: "center"
      }}>
        <button onClick={() => setMode("region")} style={btnStyle(mode === "region", "#00ff00")}>
          Region
        </button>
        {Array.from({ length: buffCount }, (_, i) => (
          <span key={i} style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setMode(`buff_${i}`)} style={btnStyle(mode === `buff_${i}`, "#ff6600")}>
              Buff {i + 1}
            </button>
            <button onClick={() => setMode(`timer_${i}`)} style={btnStyle(mode === `timer_${i}`, "#00ccff")}>
              Timer {i + 1}
            </button>
          </span>
        ))}
        <button onClick={handleApply} style={{ ...baseBtnStyle, background: "#2563eb", color: "#fff" }}>Apply</button>
        <button onClick={handleCancel} style={{ ...baseBtnStyle, background: "#555", color: "#fff" }}>Cancel</button>
      </div>

      <canvas
        ref={canvasRef}
        width={imgWidth}
        height={imgHeight}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />

      {/* Zoom magnifier for timer modes */}
      {isTimerMode && mouseScreen && (
        <canvas
          ref={zoomRef}
          width={240}
          height={240}
          style={{
            position: "absolute",
            left: Math.min(mouseScreen.x + 20, window.innerWidth - 260),
            top: Math.max(mouseScreen.y + 20, 0),
            width: 240,
            height: 240,
            border: "2px solid #00ccff",
            borderRadius: 4,
            pointerEvents: "none",
            background: "#000",
          }}
        />
      )}
    </div>
  );
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

const baseBtnStyle: React.CSSProperties = {
  padding: "5px 10px", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600,
};

function btnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    ...baseBtnStyle,
    background: active ? color : "#333",
    color: active ? "#000" : "#ccc",
    border: active ? `2px solid ${color}` : "2px solid transparent",
  };
}
