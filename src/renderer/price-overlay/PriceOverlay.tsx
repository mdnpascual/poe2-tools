import { useState, useEffect } from "react";

declare global {
  interface Window {
    api: {
      onPriceResults: (cb: (data: PriceRow[]) => void) => void;
      dismissPriceOverlay: () => void;
    };
  }
}

interface PriceRow {
  y: number;
  name: string;
  matchedName: string | null;
  exaltValue: number;
  divineValue: number;
  confidence: number;
}

export function PriceOverlay() {
  const [rows, setRows] = useState<PriceRow[]>([]);

  useEffect(() => {
    window.api.onPriceResults((data) => setRows(data));
  }, []);

  if (rows.length === 0) return null;

  const maxValue = Math.max(...rows.filter(r => r.matchedName).map(r => r.exaltValue), 0);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: row.y,
            left: 0,
            transform: "translateY(-50%)",
            background: "rgba(0,0,0,0.85)",
            color: row.matchedName
              ? row.exaltValue === maxValue ? "#fbbf24" : "#e5e7eb"
              : "#6b7280",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 20,
            fontWeight: 700,
            whiteSpace: "nowrap",
            fontFamily: "Consolas, monospace",
          }}
        >
          {row.matchedName
            ? <span>{row.exaltValue.toFixed(1)} ex</span>
            : <span>?</span>
          }
        </div>
      ))}
    </div>
  );
}
