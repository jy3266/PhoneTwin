// Shared theme, layouts and drawing helpers for the Phone Twin v4 decks.
const pptxgen = require("pptxgenjs");

const THEME = {
  name: "Phone Twin",
  headFontFace: "Malgun Gothic",
  bodyFontFace: "Malgun Gothic",
  colors: {
    dk1: "0F1A2B", lt1: "FFFFFF", dk2: "16304D", lt2: "EEF4F8",
    accent1: "0891B2", // scan cyan
    accent2: "F97316", // haptic orange
    accent3: "10B981", // ok green
    accent4: "7C3AED", // relay violet
    accent5: "64748B", // slate
    accent6: "E11D48", // warning rose
    hlink: "0891B2", folHlink: "7C3AED",
  },
};
const HEX = THEME.colors;

function newDeck(title) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = title; pres.author = "Phone Twin"; pres.company = "Phone Twin";
  const C = pres.SchemeColor;

  pres.defineSlideMaster({
    title: "Title", background: { color: C.text1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.2, w: 11.7, h: 1.5, fontSize: 44, bold: true, color: C.background1, align: "left", valign: "bottom", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", align: "left", x: 0.8, y: 3.9, w: 11.7, h: 1.6, fontSize: 20, color: "9FD8E6", valign: "top", margin: 0 }, text: "" } },
    ],
  });
  pres.defineSlideMaster({
    title: "Section", background: { color: C.text2 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.6, w: 11.7, h: 1.2, fontSize: 40, bold: true, color: C.background1, align: "left", valign: "bottom", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", align: "left", x: 0.8, y: 3.95, w: 11.7, h: 1.2, fontSize: 18, color: "BFE3EE", valign: "top", margin: 0 }, text: "" } },
    ],
  });
  pres.defineSlideMaster({
    title: "Content", background: { color: C.background1 },
    margin: [0.5, 0.6, 0.6, 0.6],
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.35, w: 12.1, h: 0.85, fontSize: 30, bold: true, color: C.text1, align: "left", valign: "middle", margin: 0 }, text: "" } },
      { text: { text: "Phone Twin v4", options: { x: 0.6, y: 7.0, w: 4, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
    ],
    slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
  });
  return { pres, C };
}

// ---- drawing helpers (scheme colours only)
function card(slide, C, o) {
  // o: x,y,w,h, head, body (string or array of runs), color (scheme), fill (scheme), headSize, bodySize, num
  slide.addShape("roundRect", { x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.12, fill: { color: o.fill || C.background2 }, line: { color: o.fill || C.background2 }, objectName: (o.name || "card") });
  let tx = o.x + 0.25;
  if (o.num !== undefined) {
    slide.addShape("ellipse", { x: o.x + 0.25, y: o.y + 0.25, w: 0.5, h: 0.5, fill: { color: o.color || C.accent1 }, line: { color: o.color || C.accent1 }, objectName: "badge" });
    slide.addText(String(o.num), { x: o.x + 0.25, y: o.y + 0.25, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true });
    tx = o.x + 0.9;
  }
  slide.addText(o.head, { x: tx, y: o.y + 0.22, w: o.x + o.w - tx - 0.2, h: 0.56, fontSize: o.headSize || 17, bold: true, color: o.color || C.accent1, valign: "middle", margin: 0, isTextBox: true });
  if (o.body) slide.addText(o.body, { x: o.x + 0.25, y: o.y + 0.85, w: o.w - 0.5, h: o.h - 1.0, fontSize: o.bodySize || 14, color: C.text1, valign: "top", margin: 0, paraSpaceAfter: 4, isTextBox: true });
}
function bullets(items, size) {
  return items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1, fontSize: size || 15 } }));
}
function stat(slide, C, x, y, w, value, label, color, size) {
  slide.addText(value, { x, y, w, h: 0.95, fontSize: size || 48, bold: true, color: color || C.accent1, margin: 0, valign: "bottom", isTextBox: true });
  slide.addText(label, { x, y: y + 1.0, w, h: 0.6, fontSize: 13, color: C.accent5, margin: 0, valign: "top", isTextBox: true });
}
function box(slide, C, x, y, w, h, text, fill, size) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: fill }, objectName: "node" });
  slide.addText(text, { x, y, w, h, fontSize: size || 14, bold: true, color: C.background1, align: "center", valign: "middle", margin: 4, isTextBox: true });
}
function arrow(slide, C, x1, y1, x2, y2, color, label, opts) {
  const flipH = x2 < x1, flipV = y2 < y1;
  slide.addShape("line", { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001), flipH, flipV,
    line: { color: color || C.accent5, width: 2, endArrowType: "triangle", beginArrowType: opts && opts.both ? "triangle" : undefined, dashType: opts && opts.dash ? "dash" : "solid" }, objectName: "arrow" });
  if (label) slide.addText(label, { x: (x1 + x2) / 2 - 1.3 + ((opts && opts.dx) || 0), y: (y1 + y2) / 2 - 0.42 + ((opts && opts.dy) || 0), w: 2.6, h: 0.36, fontSize: 11, color: color || C.accent5, align: "center", margin: 0, isTextBox: true });
}
function table(slide, C, rows, o) {
  const head = rows[0].map((t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.text2 }, fontSize: o.size || 13 } }));
  const body = rows.slice(1).map((r, i) => r.map((t, j) => ({ text: t, options: { fontSize: o.size || 13, color: C.text1, bold: j === 0, fill: { color: i % 2 ? C.background1 : C.background2 } } })));
  slide.addTable([head, ...body], { x: o.x, y: o.y, w: o.w, colW: o.colW, border: { type: "solid", pt: 0.5, color: "D5DEE6" }, margin: 0.08, valign: "middle", rowH: o.rowH });
}

module.exports = { pptxgen, THEME, HEX, newDeck, card, bullets, stat, box, arrow, table };
