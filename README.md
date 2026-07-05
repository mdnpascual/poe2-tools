# PoE2-Tools

A collection of automation and utility tools for Path of Exile 2. Built with Electron, React, and TypeScript.

**Hotkeys:**
- `Ctrl+F12` — Toggle settings window
- `Ctrl+F10` — Run waystone macro
- `F8` — Toggle buff tracker
- `F7` — Price check reward panel
- `F6` — Stash shift-insert

---

## Waystone Macro

Automatically applies currency to waystones in your stash based on their affix count. Set up currency rules (e.g., Alchemy on normals, Exalted on rares) and orb positions, then run the macro to upgrade an entire tab of waystones in one go.

- Detects stash tab type (normal, quad, map)
- Reads affix count via search bar filters
- Applies the correct orb to each waystone sequentially
- Supports "Exalt (5 mod)" mode that skips corruption
- Cancellable with Escape

<video src="https://github.com/user-attachments/assets/4a7fda29-a10b-4942-a2d1-c981928edad7"></video>

---

## Sorter

### Waystone Sorter

Sorts waystones in your stash tab by a chosen stat. Scans all waystones using search bar regex filters, then withdraws them in sorted order (column-down traversal).

**Sort modes:**
- Pack Size (45→20%)
- Rarity (64→30%)
- Monster Rarity (65→35%)
- Drop Chance (150→110%)

Works on normal (12×12), quad (24×24), and map (12×8) stash tabs. Pauses between batches so you can deposit into your inventory.

<video src="https://github.com/user-attachments/assets/a57f6cef-dfb5-4a54-bf0c-8a69cf71d799"></video>

### Stash Shift-Insert

Inserts a waystone at a specific sorted position by shifting all items below it down by one slot. Hold a waystone on your cursor, hover over the target slot, and press F6. The tool finds the next empty slot and executes a swap chain to shift everything down.

https://github.com/user-attachments/assets/8eed2570-5e5c-48e4-ab6a-a0a401478508

---

## Scanner

> ⚠ **This feature is not yet implemented.** Planned for a future release.

Will scan items in your stash against a GraphQL endpoint to identify high-value items based on affix combinations and base types.

//TODO: ADD VIDEO EXPLAINING THE FEATURE

---

## Buff Alarm

Monitors active buffs on screen using template matching. When a tracked buff expires (icon disappears), plays an alarm sound. Useful for maintaining uptime on important auras or flasks.

- Capture screen to define buff icon regions
- Supports multiple tracked buffs with individual alarm sounds
- Configurable alarm cadence
- Optional HUD overlay showing buff status
- Timer OCR for buff duration remaining

<video src="https://github.com/user-attachments/assets/32ab551d-00f4-423a-8204-2e7215275a6f"></video>

---

## Verisium (Price Checker)

Two-part price checking system for Verisium reward panels:

### Reward Panel OCR (F7)

Captures the Verisium reward panel, detects individual reward rows, removes rune icons, OCRs the text, and fuzzy-matches against the poe2scout price database. Displays prices in a click-through overlay next to the panel.

### Trade API Gem Prices

Fetches live prices for all Verisium skill and support gems from the official PoE2 trade API using your POESESSID. Prices are cached for 24 hours. When F7 detects a "Skill:" or "Support:" line, it shows the trade API price instead of the poe2scout estimate.

- Paste your POESESSID in the Verisium tab
- Automatic rate limiting (respects API throttle headers)
- Invalid/expired session detection (textbox turns red)

//TODO: ADD VIDEO EXPLAINING THE FEATURE

---

## Building

```bash
npm install
npm run dev          # Run in development mode
npm run build        # Compile TypeScript + bundle renderer
npm run release:local  # Full local build (portable .exe)
```

## Releasing

```bash
npm version patch    # Bump version, commit, tag, push → triggers GitHub build
npm version minor
npm version major
```

GitHub Actions builds the Windows portable and installer executables automatically on version tags.
