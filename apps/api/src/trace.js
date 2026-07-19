"use strict";

function summarizeTrace(events) {
  const safe = Array.isArray(events) ? events : [];
  const edits = safe.filter((e) => e.type === "stroke" || e.type === "erase");
  const erased = safe.filter((e) => e.type === "erase").reduce((n, e) => n + (e.distance || 0), 0);
  const drawn = safe.filter((e) => e.type === "stroke").reduce((n, e) => n + (e.distance || 0), 0);
  const pauses = safe.filter((e) => e.type === "pause").map((e) => e.duration || 0);
  const cells = new Set(edits.map((e) => `${Math.floor((e.x || 0) / 200)}:${Math.floor((e.y || 0) / 200)}`));
  const counts = Object.values(edits.reduce((acc, e) => { const k = `${Math.floor((e.x || 0) / 200)}:${Math.floor((e.y || 0) / 200)}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {}));
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const entropy = -counts.reduce((n, c) => { const p = c / total; return n + p * Math.log2(p); }, 0) / Math.log2(Math.max(2, counts.length));
  return { edit_entropy: Number(entropy.toFixed(3)), erase_ratio: Number((erased / Math.max(1, erased + drawn)).toFixed(3)), pause_pattern: { count: pauses.length, mean_ms: Math.round(pauses.reduce((a, b) => a + b, 0) / Math.max(1, pauses.length)) }, spatial_progression: { cells: cells.size, events: edits.length } };
}
module.exports = { summarizeTrace };
