import { useState, useEffect } from "react";
import "./hud.css";

declare global {
  interface Window {
    api: {
      onBuffUpdate: (cb: (data: any) => void) => void;
      onMacroProgress: (
        cb: (data: { current: number; total: number } | null) => void
      ) => void;
      onPickMode: (cb: (active: boolean, cursorPos?: { x: number; y: number }) => void) => void;
    };
  }
}

export function HudApp() {
  const [buffState, setBuffState] = useState<string>("idle");
  const [macro, setMacro] = useState<{ current: number; total: number; message?: string } | null>(
    null
  );
  const [pickMode, setPickMode] = useState(false);
  const [hintPos, setHintPos] = useState<{ x: number; y: number } | null>(null);
  const [buffOverlayTop, setBuffOverlayTop] = useState<number>(16);
  const [hideOverlay, setHideOverlay] = useState(false);

  useEffect(() => {
    window.api.onBuffUpdate((data) => {
      if (!data) {
        setBuffState("idle");
      } else if (Array.isArray(data)) {
        // Derive overall state from array of buff states
        if (data.some((b: any) => b.state === "alarming")) {
          setBuffState("alarming");
        } else if (data.some((b: any) => b.state === "active")) {
          setBuffState("monitoring");
        } else {
          setBuffState("monitoring"); // tracker is running but buffs are idle
        }
      } else if (data.state) {
        setBuffState(data.state);
      }
    });
    window.api.onMacroProgress((data) => setMacro(data));
    window.api.onPickMode((active, cursorPos) => {
      setPickMode(active);
      setHintPos(active && cursorPos ? cursorPos : null);
    });
    (window.api as any).onBuffConfigSync((data: { captureRegion: any; hideOverlay: boolean; scaleFactor: number }) => {
      setHideOverlay(data.hideOverlay);
      if (data.captureRegion && data.scaleFactor) {
        const top = Math.round((data.captureRegion.y + data.captureRegion.height) / data.scaleFactor) + 8;
        setBuffOverlayTop(top);
      }
    });
  }, []);

  return (
    <div className="hud">
      {/* Pick mode hint */}
      {pickMode && (
        <div
          className="hud__pick-hint"
          style={hintPos ? { top: hintPos.y + 20, left: hintPos.x, transform: "translateX(-50%)" } : undefined}
        >
          Scroll wheel to set position · Right-click to cancel
        </div>
      )}

      {/* Buff alarm indicator - positioned below capture region */}
      {!hideOverlay && (
        <div className="hud__top-left" style={{ top: buffOverlayTop }}>
          <div className={`buff-indicator buff-indicator--${buffState}`}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </div>
        </div>
      )}

      {/* Macro progress - bottom right */}
      {macro && (
        <div className="hud__bottom-right">
          <div className="macro-progress">
            <span className="macro-progress__text">
              {macro.message || `${macro.current}/${macro.total}`}
            </span>
            <div className="macro-progress__bar">
              <div
                className="macro-progress__fill"
                style={{
                  width: `${(macro.current / macro.total) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
