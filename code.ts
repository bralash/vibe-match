/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 320, height: 560, themeColors: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColorEntry {
  name: string;
  role: string;
  hex: string;
  r: number;
  g: number;
  b: number;
}

interface FontEntry {
  family: string;
  weight: number;
  size: number;
}

interface VibePayload {
  palette: ColorEntry[];
  fonts: {
    heading: FontEntry;
    body: FontEntry;
  };
  tone_words: string[];
  rationale: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STYLE_PREFIX = "VibeMatch/";

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function normaliseRGB(entry: ColorEntry): RGB {
  // Accept values either in 0-255 or 0-1 range
  const isUnitRange = entry.r <= 1 && entry.g <= 1 && entry.b <= 1;
  return {
    r: clamp01(isUnitRange ? entry.r : entry.r / 255),
    g: clamp01(isUnitRange ? entry.g : entry.g / 255),
    b: clamp01(isUnitRange ? entry.b : entry.b / 255),
  };
}

function findExistingPaintStyle(name: string): PaintStyle | null {
  return figma.getLocalPaintStyles().find((s) => s.name === name) ?? null;
}

function findExistingTextStyle(name: string): TextStyle | null {
  return figma.getLocalTextStyles().find((s) => s.name === name) ?? null;
}

// ─── Style application ────────────────────────────────────────────────────────

async function applyStyles(payload: VibePayload): Promise<void> {
  // --- Paint styles (colors) ---
  for (const entry of payload.palette) {
    const styleName = `${STYLE_PREFIX}${entry.role}`;
    const rgb = normaliseRGB(entry);

    let style = findExistingPaintStyle(styleName);

    // Only modify styles we own (prefix match) — foreign styles are left alone
    if (style === null) {
      style = figma.createPaintStyle();
      style.name = styleName;
    }

    style.paints = [{ type: "SOLID", color: rgb, opacity: 1 }];
    style.description = `${entry.name} · ${entry.hex}`;
  }

  // --- Text styles (fonts) ---
  const fontEntries: Array<{ label: string; data: FontEntry }> = [
    { label: "Heading", data: payload.fonts.heading },
    { label: "Body", data: payload.fonts.body },
  ];

  for (const { label, data } of fontEntries) {
    const styleName = `${STYLE_PREFIX}${label}`;

    // Resolve font weight to a Figma style string
    const fontStyle = weightToStyle(data.weight);

    // Pre-load the font — fall back to Inter if unavailable
    let family = data.family;
    let resolvedStyle = fontStyle;

    try {
      await figma.loadFontAsync({ family, style: resolvedStyle });
    } catch {
      // Try the weight as "Regular" first, then fall back to Inter Regular
      try {
        resolvedStyle = "Regular";
        await figma.loadFontAsync({ family, style: resolvedStyle });
      } catch {
        family = "Inter";
        resolvedStyle = "Regular";
        await figma.loadFontAsync({ family, style: resolvedStyle });
      }
    }

    let style = findExistingTextStyle(styleName);

    if (style === null) {
      style = figma.createTextStyle();
      style.name = styleName;
    }

    style.fontName = { family, style: resolvedStyle };
    style.fontSize = data.size;
    style.description = `${data.family} ${data.weight} · ${data.size}px`;
  }
}

/** Maps a numeric font weight to a Figma font style string. */
function weightToStyle(weight: number): string {
  const map: Record<number, string> = {
    100: "Thin",
    200: "ExtraLight",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
  };
  return map[weight] ?? "Regular";
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const HISTORY_KEY = "vibeHistory";
const API_KEY_KEY  = "vmApiKey";

async function getHistory(): Promise<string[]> {
  const raw = await figma.clientStorage.getAsync(HISTORY_KEY);
  if (Array.isArray(raw)) return raw as string[];
  return [];
}

async function saveHistory(history: string[]): Promise<void> {
  await figma.clientStorage.setAsync(HISTORY_KEY, history.slice(0, 5));
}

async function getApiKey(): Promise<string> {
  const raw = await figma.clientStorage.getAsync(API_KEY_KEY);
  return typeof raw === "string" ? raw : "";
}

async function saveApiKey(key: string): Promise<void> {
  await figma.clientStorage.setAsync(API_KEY_KEY, key);
}

// ─── Message handler ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg: { type: string; [key: string]: unknown }) => {
  switch (msg.type) {
    case "apply-styles": {
      try {
        const payload = msg.payload as VibePayload;
        await applyStyles(payload);
        figma.ui.postMessage({ type: "apply-success" });
        figma.notify("✅ Vibe Match styles applied!", { timeout: 3000 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: "apply-error", message });
        figma.notify(`❌ Error: ${message}`, { error: true });
      }
      break;
    }

    case "notify": {
      const text = (msg.message as string) ?? "";
      const isError = !!(msg.error as boolean);
      figma.notify(text, { error: isError, timeout: 3000 });
      break;
    }

    case "get-history": {
      const history = await getHistory();
      figma.ui.postMessage({ type: "history-data", history });
      break;
    }

    case "save-history": {
      const history = msg.history as string[];
      await saveHistory(history);
      break;
    }

    case "get-api-key": {
      const key = await getApiKey();
      figma.ui.postMessage({ type: "api-key-data", key });
      break;
    }

    case "save-api-key": {
      await saveApiKey(msg.key as string);
      figma.ui.postMessage({ type: "api-key-saved" });
      break;
    }

    default:
      break;
  }
};
