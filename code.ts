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

// ─── Preview frame helpers ────────────────────────────────────────────────────

async function loadFontSafe(family: string, weight: number): Promise<FontName> {
  const style = weightToStyle(weight);
  try {
    await figma.loadFontAsync({ family, style });
    return { family, style };
  } catch {
    try {
      await figma.loadFontAsync({ family, style: "Regular" });
      return { family, style: "Regular" };
    } catch {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      return { family: "Inter", style: "Regular" };
    }
  }
}

function makeRect(
  parent: FrameNode,
  x: number, y: number, w: number, h: number,
  color: RGB, radius = 0
): RectangleNode {
  const r = figma.createRectangle();
  r.fills = [{ type: "SOLID", color }];
  r.resize(w, h);
  r.x = x; r.y = y;
  r.cornerRadius = radius;
  parent.appendChild(r);
  return r;
}

function makeEllipse(
  parent: FrameNode,
  x: number, y: number, d: number,
  color: RGB
): EllipseNode {
  const e = figma.createEllipse();
  e.fills = [{ type: "SOLID", color }];
  e.resize(d, d);
  e.x = x; e.y = y;
  parent.appendChild(e);
  return e;
}

async function makeText(
  parent: FrameNode,
  text: string,
  x: number, y: number, w: number,
  font: FontName,
  size: number,
  color: RGB,
  align: "LEFT" | "CENTER" = "LEFT"
): Promise<TextNode> {
  await figma.loadFontAsync(font);
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = size;
  t.fills = [{ type: "SOLID", color }];
  t.textAlignHorizontal = align;
  t.textAutoResize = "HEIGHT";
  t.resize(w, 20);
  t.characters = text;
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
}

async function generatePreviewFrame(payload: VibePayload, vibe: string): Promise<void> {
  const byRole = (role: string): RGB => {
    const entry = payload.palette.find((c) => c.role === role);
    return normaliseRGB(entry ?? payload.palette[0]);
  };

  const W = 380, H = 530, PAD = 28;

  const hFont = await loadFontSafe(payload.fonts.heading.family, payload.fonts.heading.weight);
  const bFont = await loadFontSafe(payload.fonts.body.family, payload.fonts.body.weight);

  // Frame
  const frame = figma.createFrame();
  frame.name = `VibeMatch — ${vibe}`;
  frame.resize(W, H);
  frame.fills = [{ type: "SOLID", color: byRole("background") }];
  const center = figma.viewport.center;
  frame.x = Math.round(center.x - W / 2);
  frame.y = Math.round(center.y - H / 2);

  // Accent bar
  makeRect(frame, PAD, PAD, 44, 3, byRole("accent"), 2);

  // Vibe heading
  const headingSize = Math.min(Math.max(payload.fonts.heading.size, 24), 40);
  const headingNode = await makeText(
    frame,
    vibe.charAt(0).toUpperCase() + vibe.slice(1),
    PAD, PAD + 14, W - PAD * 2,
    hFont, headingSize, byRole("primary")
  );

  // Rationale subtitle
  const ratNode = await makeText(
    frame, payload.rationale,
    PAD, headingNode.y + headingNode.height + 6, W - PAD * 2,
    bFont, Math.min(payload.fonts.body.size, 13), byRole("secondary")
  );

  // Surface card
  const cardY = Math.max(ratNode.y + ratNode.height + 20, 148);
  const cardH = 216;
  makeRect(frame, PAD, cardY, W - PAD * 2, cardH, byRole("surface"), 14);

  // Tone word chips inside card
  let chipX = PAD + 14;
  for (const word of payload.tone_words) {
    const chipW = word.length * 7 + 24;
    makeRect(frame, chipX, cardY + 16, chipW, 24, byRole("accent"), 12);
    await makeText(
      frame, word,
      chipX, cardY + 19, chipW,
      bFont, 10, byRole("background"), "CENTER"
    );
    chipX += chipW + 8;
  }

  // Sample body copy inside card
  await makeText(
    frame,
    "The quick brown fox jumps over the lazy dog. Design is the silent ambassador of your brand.",
    PAD + 14, cardY + 54, W - PAD * 2 - 28,
    bFont, Math.min(payload.fonts.body.size, 13), byRole("primary")
  );

  // CTA button
  const btnW = 152, btnH = 42, btnY = cardY + cardH + 20;
  makeRect(frame, PAD, btnY, btnW, btnH, byRole("primary"), 8);
  const btnLabel = await makeText(
    frame, "Get Started",
    PAD, btnY, btnW,
    hFont, 13, byRole("background"), "CENTER"
  );
  btnLabel.y = btnY + Math.round((btnH - btnLabel.height) / 2);

  // Secondary ghost button outline
  const btn2X = PAD + btnW + 12;
  makeRect(frame, btn2X, btnY, btnW, btnH, byRole("surface"), 8);
  const outlineBtn = figma.createRectangle();
  outlineBtn.fills = [];
  outlineBtn.strokes = [{ type: "SOLID", color: byRole("secondary") }];
  outlineBtn.strokeWeight = 1;
  outlineBtn.resize(btnW, btnH);
  outlineBtn.x = btn2X; outlineBtn.y = btnY;
  outlineBtn.cornerRadius = 8;
  frame.appendChild(outlineBtn);
  const btn2Label = await makeText(
    frame, "Learn More",
    btn2X, btnY, btnW,
    bFont, 13, byRole("secondary"), "CENTER"
  );
  btn2Label.y = btnY + Math.round((btnH - btn2Label.height) / 2);

  // Color swatches row
  const D = 26, gap = 10;
  const totalW = payload.palette.length * D + (payload.palette.length - 1) * gap;
  let sx = Math.round((W - totalW) / 2);
  const swatchY = H - 46;
  for (const entry of payload.palette) {
    makeEllipse(frame, sx, swatchY, D, normaliseRGB(entry));
    sx += D + gap;
  }

  figma.viewport.scrollAndZoomIntoView([frame]);
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

    case "generate-preview": {
      try {
        const payload = msg.payload as VibePayload;
        const vibe = (msg.vibe as string) || "untitled";
        await generatePreviewFrame(payload, vibe);
        figma.ui.postMessage({ type: "preview-success" });
        figma.notify("✨ Preview frame created!", { timeout: 3000 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: "preview-error", message });
        figma.notify(`❌ Preview error: ${message}`, { error: true });
      }
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
