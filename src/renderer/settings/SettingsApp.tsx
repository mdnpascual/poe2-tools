import { useState, useEffect } from "react";
import "./settings.css";
import { WipTab } from "./wip-bridge";

declare global {
  interface Window {
    api: {
      closeSettings: () => void;
      getSettings: () => Promise<{ currencyConfig: any; actionDelay: number; sortDelay: number; sortBatchSize: number }>;
      onStashDetected: (cb: (tabType: string) => void) => void;
      pickPosition: (cb: (pos: { x: number; y: number }) => void) => void;
      setOrbPosition: (slot: string, position: { x: number; y: number }) => void;
      setOrbCurrency: (slot: string, currency: string) => void;
      setActionDelay: (delay: number) => void;
      startMacro: () => void;
      startSort: (mode: string) => void;
      resumeSort: () => void;
      setSortDelay: (delay: number) => void;
      setSortBatch: (size: number) => void;
    };
  }
}

type Tab = "waystone" | "sorter" | "scanner" | "buff" | "verisium" | "wip";

export function SettingsApp() {
  const [tab, setTab] = useState<Tab>("waystone");
  const [detectedTab, setDetectedTab] = useState<string>("");
  const [savedConfig, setSavedConfig] = useState<any>(null);
  const [savedDelay, setSavedDelay] = useState(250);
  const [savedSortDelay, setSavedSortDelay] = useState(150);
  const [savedBatchSize, setSavedBatchSize] = useState(24);
  const [showWip, setShowWip] = useState(false);

  useEffect(() => {
    window.api.onStashDetected((tabType) => setDetectedTab(tabType));
    window.api.getSettings().then((s) => {
      setSavedConfig(s.currencyConfig);
      setSavedDelay(s.actionDelay);
      setSavedSortDelay(s.sortDelay);
      setSavedBatchSize(s.sortBatchSize);
    });
    (window.api as any).checkWipKey().then((valid: boolean) => setShowWip(valid && WipTab !== null));
  }, []);

  return (
    <div className="settings">
      <div className="settings__panel">
        <div className="settings__header">
          <h1 className="settings__title">PoE2-Tools</h1>
          <button
            className="settings__close"
            onClick={() => window.api.closeSettings()}
          >
            ✕
          </button>
        </div>

        <div className="settings__tabs">
          {(["waystone", "sorter", "scanner", "buff", "verisium", ...(showWip ? ["wip"] : [])] as Tab[]).map((t) => (
            <button
              key={t}
              className={`settings__tab ${tab === t ? "settings__tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "waystone" && "Waystone"}
              {t === "sorter" && "Sorter"}
              {t === "scanner" && "Scanner"}
              {t === "buff" && "Buff"}
              {t === "verisium" && "Verisium"}
              {t === "wip" && "WIP"}
            </button>
          ))}
        </div>

        <div className="settings__content">
          {tab === "waystone" && <WaystoneTab detectedTab={detectedTab} savedConfig={savedConfig} savedDelay={savedDelay} />}
          {tab === "sorter" && <SorterTab savedDelay={savedSortDelay} savedBatch={savedBatchSize} />}
          {tab === "scanner" && <ScannerTab />}
          {tab === "buff" && <BuffTab />}
          {tab === "verisium" && <VerisiumTab />}
          {tab === "wip" && WipTab && <WipTab />}
        </div>

        <div className="settings__footer">
          <span className="settings__hint">Press Ctrl+F12 or Esc to close</span>
        </div>
      </div>
    </div>
  );
}

function WaystoneTab({ detectedTab, savedConfig, savedDelay }: { detectedTab: string; savedConfig: any; savedDelay: number }) {
  const [positions, setPositions] = useState<Record<string, boolean>>({});
  const [rareCurrency, setRareCurrency] = useState<string>(savedConfig?.rare?.currency ?? "exalted");

  useEffect(() => {
    if (savedConfig) {
      setPositions({
        normal: !!savedConfig.normal?.position,
        magic1: !!savedConfig.magic1?.position,
        magic2: !!savedConfig.magic2?.position,
        rare: !!savedConfig.rare?.position,
        corrupt: !!savedConfig.corrupt?.position,
      });
      setRareCurrency(savedConfig.rare?.currency ?? "exalted");
    }
  }, [savedConfig]);

  const isExalt5 = rareCurrency === "exalted_5";
  const allSet = Object.keys(positions).length === 5 && Object.values(positions).every((v, i) => {
    // corrupt position not required when using exalted_5
    if (isExalt5 && Object.keys(positions)[i] === "corrupt") return true;
    return v;
  });
  // Recalculate: all required positions are set
  const requiredSlots = isExalt5 ? ["normal", "magic1", "magic2", "rare"] : ["normal", "magic1", "magic2", "rare", "corrupt"];
  const canStart = requiredSlots.every((s) => positions[s]);

  const onPositionSet = (slot: string) => {
    setPositions((p) => ({ ...p, [slot]: true }));
  };

  const onRareCurrencyChange = (currency: string) => {
    setRareCurrency(currency);
  };

  return (
    <div className="tab-content">
      <div className="field">
        <label className="field__label">Stash Tab Detection</label>
        <div className="field__row">
          <span className={`detection-status ${detectedTab ? "" : "detection-status--idle"}`}>
            {detectedTab ? `Detected: ${detectedTab.toUpperCase()}` : "Start macro to detect"}
          </span>
        </div>
      </div>

      <div className="field">
        <label className="field__label">Currency Rules</label>
        <div className="currency-table">
          <CurrencyRow slot="normal" label="Normal (0 affix)" options={["Alchemy", "Transmutation"]} saved={savedConfig?.normal} onSet={onPositionSet} />
          <CurrencyRow slot="magic1" label="Magic 1 affix" options={["Alchemy", "Augmentation"]} saved={savedConfig?.magic1} onSet={onPositionSet} />
          <CurrencyRow slot="magic2" label="Magic 2 affix" options={["Alchemy", "Regal"]} saved={savedConfig?.magic2} onSet={onPositionSet} />
          <CurrencyRow slot="rare" label="Rare (3-5 affix)" options={["Exalted", "Exalt (5 mod)"]} saved={savedConfig?.rare} onSet={onPositionSet} onCurrencyChange={onRareCurrencyChange} />
          <CurrencyRow slot="corrupt" label="Corrupt (6 affix)" options={["Vaal", "None"]} saved={savedConfig?.corrupt} onSet={onPositionSet} disabled={isExalt5} />
        </div>
      </div>

      <div className="field">
        <label className="field__label">Action Delay</label>
        <div className="field__row">
          <input
            type="number"
            className="field__input"
            defaultValue={savedDelay}
            min={50}
            max={500}
            onChange={(e) => window.api.setActionDelay(Number(e.target.value))}
          />
          <span className="field__unit">ms</span>
        </div>
      </div>

      <button className="btn btn--primary" disabled={!canStart} onClick={() => window.api.startMacro()}>
        {canStart ? "Start Macro (Ctrl+F10)" : "Set all positions to start"}
      </button>
    </div>
  );
}

function CurrencyRow({ slot, label, options, saved, onSet, disabled, onCurrencyChange }: { slot: string; label: string; options: string[]; saved?: { currency: string; position: { x: number; y: number } | null }; onSet: (slot: string) => void; disabled?: boolean; onCurrencyChange?: (currency: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(saved?.position ?? null);
  const [picking, setPicking] = useState(false);

  // Map display name to internal currency value
  const displayToValue = (display: string): string => {
    if (display === "Exalt (5 mod)") return "exalted_5";
    if (display === "None") return "none";
    return display.toLowerCase();
  };

  // Map internal value to display name
  const valueToDisplay = (value: string): string => {
    if (value === "exalted_5") return "Exalt (5 mod)";
    if (value === "none") return "None";
    return options.find((o) => o.toLowerCase() === value) || options[0];
  };

  const [selectedDisplay, setSelectedDisplay] = useState<string>(
    valueToDisplay(saved?.currency ?? displayToValue(options[0]))
  );

  useEffect(() => {
    if (saved?.position) setPos(saved.position);
  }, [saved]);

  useEffect(() => {
    if (saved?.currency) {
      setSelectedDisplay(valueToDisplay(saved.currency));
    }
  }, [saved?.currency]);

  const handlePick = () => {
    if (disabled) return;
    setPicking(true);
    window.api.pickPosition((position: { x: number; y: number }) => {
      setPos(position);
      setPicking(false);
      window.api.setOrbPosition(slot, position);
      onSet(slot);
    });
  };

  const handleCurrencyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const display = e.target.value;
    setSelectedDisplay(display);
    const value = displayToValue(display);
    window.api.setOrbCurrency(slot, value);
    onCurrencyChange?.(value);
  };

  return (
    <>
      <span className={`field__sublabel ${disabled ? "field__sublabel--disabled" : ""}`}>{label}</span>
      <select className="field__select" value={selectedDisplay} onChange={handleCurrencyChange} disabled={disabled}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <button
        className={`btn btn--icon ${picking ? "btn--icon--active" : pos ? "" : "btn--icon--unset"}`}
        onClick={handlePick}
        disabled={disabled}
      >
        ⊕
      </button>
      <span className={`field__pos ${disabled ? "field__pos--disabled" : ""}`}>
        {disabled ? "skipped" : pos ? `(${pos.x}, ${pos.y})` : "—"}
      </span>
    </>
  );
}

function SorterTab({ savedDelay, savedBatch }: { savedDelay: number; savedBatch: number }) {
  const [mode, setMode] = useState("pack_size");

  return (
    <div className="tab-content">
      <div className="field">
        <span className="field__notice">⚠ Withdraws maps in sorted order (column-down)</span>
      </div>

      <div className="field">
        <label className="field__label">Sort Mode</label>
        <select className="field__select" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="pack_size">Pack Size (45→20%)</option>
          <option value="rarity">Rarity (64→30%)</option>
          <option value="monster_rarity">Monster Rarity (65→35%)</option>
          <option value="drop_chance">Drop Chance (150→110%)</option>
        </select>
      </div>

      <div className="field">
        <label className="field__label">Batch Size (inventory slots)</label>
        <div className="field__row">
          <input
            type="number"
            className="field__input"
            defaultValue={savedBatch}
            min={1}
            max={60}
            onChange={(e) => window.api.setSortBatch(Number(e.target.value))}
          />
          <span className="field__unit">slots</span>
        </div>
      </div>

      <div className="field">
        <label className="field__label">Click Delay</label>
        <div className="field__row">
          <input
            type="number"
            className="field__input"
            defaultValue={savedDelay}
            min={50}
            max={500}
            onChange={(e) => window.api.setSortDelay(Number(e.target.value))}
          />
          <span className="field__unit">ms</span>
        </div>
      </div>

      <div className="field__row">
        <button className="btn btn--primary" onClick={() => window.api.startSort(mode)}>
          Sort Stash
        </button>
        <button className="btn btn--secondary" onClick={() => window.api.resumeSort()}>
          Resume
        </button>
      </div>

      <div className="field">
        <label className="field__label">Stash Shift</label>
        <div className="field__row">
          <button className="btn btn--secondary" onClick={() => (window.api as any).startShiftInsert()}>
            Shift Insert (F6)
          </button>
          <span className="field__tooltip-wrap">
            <span className="field__tooltip-icon">ⓘ</span>
            <span className="field__tooltip-text">
              Hold a waystone on your cursor, position mouse over the slot where it should go, then press F6.
              Items below will shift down to the next empty slot.
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ScannerTab() {
  return (
    <div className="tab-content">
      <div className="field">
        <span className="field__notice">⚠ This feature is not yet implemented</span>
      </div>

      <div className="field">
        <label className="field__label">GraphQL Endpoint</label>
        <input
          type="text"
          className="field__input field__input--wide"
          defaultValue="http://localhost:4000/graphql"
        />
      </div>

      <div className="field">
        <label className="field__label">Match Threshold</label>
        <div className="field__row">
          <input
            type="number"
            className="field__input"
            defaultValue={2}
            min={1}
            max={10}
          />
          <span className="field__unit">affixes</span>
        </div>
      </div>

      <div className="field">
        <label className="field__label">Top N per base type</label>
        <input
          type="number"
          className="field__input"
          defaultValue={10}
          min={5}
          max={30}
        />
      </div>

      <div className="field__row">
        <button className="btn btn--secondary">Fetch Data</button>
        <button className="btn btn--primary">Start Scan (F9)</button>
      </div>
    </div>
  );
}

function BuffTab() {
  const [buffs, setBuffs] = useState<{ label: string; templatePath: string | null; alarmSound: string | null; enabled: boolean }[]>([]);
  const [cadence, setCadence] = useState(1.5);
  const [hideOverlay, setHideOverlay] = useState(false);

  useEffect(() => {
    (window.api as any).getBuffConfig().then((cfg: any) => {
      if (cfg) {
        setBuffs(cfg.buffs || []);
        setCadence(cfg.alarmCadence || 1.5);
        setHideOverlay(cfg.hideOverlay || false);
      }
    });
  }, []);

  const handleAddBuff = () => {
    (window.api as any).addBuff();
    setBuffs((b) => [...b, { label: `Buff ${b.length + 1}`, templatePath: null, alarmSound: null, enabled: true }]);
  };

  const handleRemoveBuff = (index: number) => {
    (window.api as any).removeBuff(index);
    setBuffs((b) => b.filter((_, i) => i !== index));
  };

  const handleSetAlarmSound = async (index: number) => {
    const result = await (window.api as any).setBuffAlarmSound(index);
    if (result) {
      setBuffs((b) => b.map((buff, i) => i === index ? { ...buff, alarmSound: result } : buff));
    }
  };

  const handleCadenceChange = (value: number) => {
    setCadence(value);
    (window.api as any).setBuffAlarmCadence(value);
  };

  const handleHideOverlayChange = (hide: boolean) => {
    setHideOverlay(hide);
    (window.api as any).setBuffHideOverlay(hide);
  };

  return (
    <div className="tab-content">
      <div className="field">
        <button className="btn btn--primary" onClick={() => (window.api as any).startBuffCapture()}>
          Capture Screen
        </button>
      </div>

      <div className="field">
        <label className="field__label">Alarm Cadence</label>
        <div className="field__row">
          <input
            type="number"
            className="field__input"
            value={cadence}
            step={0.1}
            min={0.5}
            max={5}
            onChange={(e) => handleCadenceChange(Number(e.target.value))}
          />
          <span className="field__unit">seconds</span>
          <label className="field__checkbox">
            <input
              type="checkbox"
              checked={hideOverlay}
              onChange={(e) => handleHideOverlayChange(e.target.checked)}
            />
            Hide Overlay
          </label>
        </div>
      </div>

      <div className="field">
        <label className="field__label">Tracked Buffs</label>
        <div className="buff-list">
          {buffs.map((buff, i) => (
            <div key={i} className="buff-row">
              <span className="buff-row__label">{buff.label}</span>
              <span className={`buff-row__status ${buff.templatePath ? "buff-row__status--ok" : ""}`}>
                {buff.templatePath ? "✓" : "—"}
              </span>
              <button className="btn btn--sm" onClick={() => handleSetAlarmSound(i)}>
                {buff.alarmSound ? "🔊" : "Set Alarm"}
              </button>
              {i > 0 && (
                <button className="btn btn--sm btn--danger" onClick={() => handleRemoveBuff(i)}>✕</button>
              )}
            </div>
          ))}
          <button className="btn btn--sm btn--secondary" onClick={handleAddBuff}>+ Add Buff</button>
        </div>
      </div>

      <div className="field__row">
        <button className="btn btn--primary" onClick={() => (window.api as any).enableBuffTracker()}>Enable (F8)</button>
        <button className="btn btn--danger" onClick={() => (window.api as any).disableBuffTracker()}>Disable</button>
      </div>
    </div>
  );
}


function VerisiumTab() {
  const [ocrLines, setOcrLines] = useState<string[]>([]);
  const [sessid, setSessid] = useState("");
  const [status, setStatus] = useState<{ state: string; progress?: string; valid?: boolean }>({ state: "idle" });
  const [cacheTimestamps, setCacheTimestamps] = useState<{ priceCache: number | null; verisiumCache: number | null } | null>(null);

  useEffect(() => {
    (window.api as any).onOcrLines((lines: string[]) => setOcrLines(lines));
    (window.api as any).getPoesessid().then((id: string) => setSessid(id || ""));
    (window.api as any).onVerisiumStatus((s: { state: string; progress?: string; valid?: boolean }) => setStatus(s));
    (window.api as any).getPriceCacheTimestamps().then((ts: { priceCache: number | null; verisiumCache: number | null }) => setCacheTimestamps(ts));
  }, []);

  const handleSessidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    setSessid(value);
    (window.api as any).setPoesessid(value);
  };

  const formatTimestamp = (ms: number | null): string => {
    if (!ms) return "never";
    const date = new Date(ms);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const isError = status.valid === false;
  let statusText: string;
  if (status.state === "idle") {
    if (!sessid) {
      statusText = "Enter POESESSID to fetch prices";
    } else {
      const parts: string[] = ["Waiting..."];
      if (cacheTimestamps) {
        const pLabel = formatTimestamp(cacheTimestamps.priceCache);
        const vLabel = formatTimestamp(cacheTimestamps.verisiumCache);
        parts.push(`Prices: ${pLabel} · Trade API: ${vLabel}`);
      }
      statusText = parts.join(" — ");
    }
  } else if (status.state === "fetching") {
    statusText = `Fetching prices... (${status.progress || ""})`;
  } else if (status.state === "done") {
    statusText = status.progress || "Prices loaded";
  } else if (status.state === "error") {
    statusText = status.progress || "Error";
  } else {
    statusText = "";
  }

  return (
    <div className="tab-content">
      <div className="field">
        <label className="field__label">POESESSID</label>
        <div className="field__row">
          <input
            type="password"
            className={`field__input${isError ? " field__input--error" : ""}`}
            style={{ flex: 1 }}
            value={sessid}
            onChange={handleSessidChange}
            placeholder="Paste your session ID here"
          />
          <span className="field__tooltip-wrap">
            <span className="field__tooltip-icon">ⓘ</span>
            <span className="field__tooltip-text">
              Fetches prices for Verisium Skill and Support gems from the trade API
            </span>
          </span>
          <button
            className="btn btn--danger"
            onClick={() => (window.api as any).clearVerisiumCache()}
          >
            Clear cached data
          </button>
        </div>
        <span className={`field__status${isError ? " field__status--error" : ""}`}>
          {statusText}
        </span>
      </div>

      <div className="field">
        <label className="field__label">Detected OCR Text (last scan)</label>
        <div className="verisium-list">
          {ocrLines.length === 0 && <span className="field__sublabel">Press F7 on reward panel to scan...</span>}
          {ocrLines.map((line, i) => (
            <div key={i} className="verisium-row">
              <span className="verisium-row__name">{line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

