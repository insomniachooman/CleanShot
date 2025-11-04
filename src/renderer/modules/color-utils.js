
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const hexToRgb = (hex) => {
  if (typeof hex !== "string") return null;
  let v = hex.trim().toLowerCase();
  if (v.startsWith("#")) v = v.slice(1);
  if (v.length === 3) {
    const r = v[0], g = v[1], b = v[2];
    v = `${r}${r}${g}${g}${b}${b}`;
  }
  if (!/^[0-9a-f]{6}$/i.test(v)) return null;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return { r, g, b };
};

export const rgbToHex = ({ r, g, b }) => {
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const parseRgbString = (input) => {
  if (typeof input !== "string") return null;
  const m = input.trim().toLowerCase().match(/^rgba?\(\s*([+-]?\d{1,3})\s*,\s*([+-]?\d{1,3})\s*,\s*([+-]?\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/i);
  if (!m) return null;
  const r = clamp(parseInt(m[1], 10), 0, 255);
  const g = clamp(parseInt(m[2], 10), 0, 255);
  const b = clamp(parseInt(m[3], 10), 0, 255);
  return { r, g, b };
};

export const hslToRgb = (h, s, l) => {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 60) [r1, g1, b1] = [c, x, 0];
  else if (hh < 120) [r1, g1, b1] = [x, c, 0];
  else if (hh < 180) [r1, g1, b1] = [0, c, x];
  else if (hh < 240) [r1, g1, b1] = [0, x, c];
  else if (hh < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
};

export const rgbToHsl = (r, g, b) => {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rr:
        h = 60 * (((gg - bb) / d) % 6);
        break;
      case gg:
        h = 60 * ((bb - rr) / d + 2);
        break;
      case bb:
        h = 60 * ((rr - gg) / d + 4);
        break;
      default:
        h = 0;
    }
  }
  if (h < 0) h += 360;
  return { h, s, l };
};

export const parseHslString = (input) => {
  if (typeof input !== "string") return null;
  const m = input.trim().toLowerCase().match(/^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*(?:,\s*([0-9.]+)\s*)?\)$/i);
  if (!m) return null;
  const h = parseFloat(m[1]);
  const s = clamp(parseFloat(m[2]), 0, 100) / 100;
  const l = clamp(parseFloat(m[3]), 0, 100) / 100;
  return hslToRgb(h, s, l);
};

export const parseColorString = (input) => {
  if (typeof input !== "string" || !input.trim()) return null;
  const v = input.trim();
  return hexToRgb(v) || parseRgbString(v) || parseHslString(v);
};

export const formatColorForMode = (mode, rgb) => {
  const { r, g, b } = rgb;
  if (mode === "rgb") {
    return `rgb(${clamp(r, 0, 255)}, ${clamp(g, 0, 255)}, ${clamp(b, 0, 255)})`;
  }
  if (mode === "hsl") {
    const hsl = rgbToHsl(r, g, b);
    const h = Math.round(hsl.h);
    const s = Math.round(hsl.s * 100);
    const l = Math.round(hsl.l * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return rgbToHex({ r, g, b });
};
    