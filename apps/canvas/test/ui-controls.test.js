"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

test("New canvas controls are available in the toolbar and History panel", () => {
  const html = read("public/index.html"), app = read("public/app.js");
  assert.ok(html.indexOf('id="newCanvasBtn"') < html.indexOf('id="historyBtn"'));
  for (const id of ["historyNew", "newCanvasDialog", "newDiscard", "newSaveCopy", "newOverwrite"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /currentSnapshotId:\s*null/);
  assert.match(app, /saveSnapshot\(\{\s*overwriteId\s*=\s*null,\s*name\s*=\s*null\s*\}/);
  assert.match(app, /completeNewCanvas\("overwrite"\)/);
  assert.match(app, /function startBlankCanvas\(\)/);
});

test("New, Clear, and Debug are accessible theme-aware icon buttons", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  for (const id of ["newCanvasBtn", "clearCanvasBtn", "debugBtn"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*utility-icon[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.match(button, /<svg /);
    assert.doesNotMatch(button, />\s*(New|Clear|Debug)\s*</);
  }
  for (const theme of ["arcane", "scifi", "research"]) assert.match(html, new RegExp(`value="${theme}"`));
  assert.match(css, /button\.utility-icon:not\(\.active\).*var\(--ink\)/);
  assert.match(css, /button\.utility-icon\.danger:not\(\.active\).*var\(--danger\)/);
});

test("Auto AI exposes a persisted zero-to-ten-second delay control", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.match(html, /id="autoDelayRange"[^>]*min="0"[^>]*max="10"[^>]*step="0\.1"/);
  assert.match(app, /socrates-auto-delay-ms/);
  assert.match(app, /socrates-auto-ai/);
  assert.match(app, /setTimeout\(hideAutoDelayControl,\s*5000\)/);
  assert.match(app, /if\s*\(state\.auto\)\s*setAutoEnabled\(false\)/);
  assert.match(app, /else\s*setAutoEnabled\(true,\s*true\)/);
  assert.match(css, /\.auto-delay-popover\[hidden\]\s*\{\s*display:\s*none/);
});

test("New canvas and Auto AI controls have English and Chinese copy", () => {
  const app = read("public/app.js"), zh = read("public/locales/zh.js");
  for (const key of ["autoDelay", "newCanvas", "newCanvasTitle", "saveAsNewAndCreate", "overwriteAndCreate", "newCanvasReady"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("the size control switches between separate pen and eraser settings", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  assert.match(html, /id="toolSizeLabel"[^>]*data-i18n="penSize"/);
  assert.match(html, /id="toolSize"[^>]*min="2"[^>]*max="16"[^>]*data-i18n-aria="penSize"/);
  assert.match(html, /id="toolSizeValue">4 px/);
  for (const key of ["penSize", "eraserSize"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  const update = functionSource(app, "updateToolSizeControl"), input = app.slice(app.indexOf('document.querySelector("#toolSize").oninput'), app.indexOf('document.querySelector("#aiFont").onchange'));
  assert.match(update, /state\.mode === "eraser" \? TOOL_SIZE\.eraser : TOOL_SIZE\.pen/);
  assert.match(app, /pen: \{ labelKey: "penSize", stateKey: "pen", minimum: 2, maximum: 16 \}/);
  assert.match(app, /eraser: \{ labelKey: "eraserSize", stateKey: "eraser", minimum: 8, maximum: 120 \}/);
  assert.match(update, /input\.min = String\(settings\.minimum\)/);
  assert.match(update, /input\.max = String\(settings\.maximum\)/);
  assert.match(update, /input\.setAttribute\("aria-label", t\(settings\.labelKey\)\)/);
  assert.match(input, /state\[settings\.stateKey\] = \+e\.target\.value/);
  assert.match(app, /state\.mode = b\.dataset\.mode;[\s\S]*?updateToolSizeControl\(\)/);
});

test("Text mode provides accessible plain-text and LaTeX editors", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js"), css = read("public/style.css");
  assert.match(html, /data-mode="text"/);
  assert.match(html, /id="textEditor"/);
  assert.match(html, /id="textEditorInput"/);
  assert.match(html, /data-text-kind="text"/);
  assert.match(html, /data-text-kind="latex"/);
  assert.match(html, /id="textEditorCommit"/);
  assert.match(html, /id="textEditorCancel"/);
  for (const key of ["text", "textEditor", "textMode", "plainText", "latex", "textHint", "latexHint", "placeText", "cancelText", "textPlaced"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(css, /\.text-editor\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /#screen\.cursor-text\s*\{\s*cursor:\s*text/);
  assert.match(app, /function positionTextEditor\(point\)/);
  assert.match(app, /textEditor\.dataset\.anchor/);
  assert.match(css, /\.text-editor\[data-anchor="bottom-right"\]/);
});

test("typed Canvas content uses existing text and formula rendering, history, and Auto AI paths", () => {
  const app = read("public/app.js");
  const commit = functionSource(app, "commitTextEditor");
  assert.match(commit, /textImage\(content, fontSize, state\.inkColor, maxWidth, 1\.35\)/);
  assert.match(commit, /formulaImage\(content, fontSize, state\.inkColor\)/);
  assert.match(commit, /blitSized\(image, x, y, width, height\)/);
  assert.match(commit, /mergeDirty\(x, y, 0\)/);
  assert.match(commit, /state\.autoEligible = true/);
  assert.match(commit, /if \(!isAssessmentMode\(\)\) schedule\(\)/);
  assert.match(commit, /save\(\)/);
  assert.match(app, /event\.key === "Enter" && \(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /compositionstart/);
  assert.match(app, /compositionend/);
});

test("assessment mode suppresses automatic and manual Canvas AI while retaining text mode", () => {
  const app = read("public/app.js"), assessment = read("public/assessment.js"), html = read("public/index.html");
  assert.match(html, /data-mode="text"/);
  assert.match(functionSource(app, "launchAutomaticAI"), /isAssessmentMode\(\)/);
  assert.match(functionSource(app, "schedule"), /isAssessmentMode\(\)/);
  assert.match(functionSource(app, "invokeAIAction"), /if \(isAssessmentMode\(\)\) return/);
  assert.match(app, /window\.addEventListener\("socrates-assessment-mode", suppressAssessmentAI\)/);
  assert.match(assessment, /window\.dispatchEvent\(new Event\("socrates-assessment-mode"\)\)/);
});

test("eraser strokes never enter the AI recognition batch", () => {
  const app = read("public/app.js");
  assert.match(app, /const shouldRequest = !d\.erase/);
  assert.match(app, /if \(shouldRequest\) \{\s*for \(const point of d\.trail\) state\.hotspotTrail\.push\(point\)/);
  assert.match(app, /if \(shouldRequest && state\.autoEligible\) schedule\(\)/);
  assert.match(app, /const erasing = state\.mode === "eraser";\s*if \(erasing\) invalidateRecognition\(\)/);
  assert.match(app, /erase: erasing/);
  assert.match(app, /dot\(p, erasing, size, !erasing\)/);
  assert.match(app, /stroke\(a, p, d\.erase, size, !d\.erase\)/);
});

test("an uncapturable batch is discarded before later pen strokes", () => {
  const app = read("public/app.js");
  assert.match(app, /function discardUncapturableInput\(hotspotCount, usedDirty\)/);
  assert.match(app, /if \(hotspotCount\) state\.hotspotTrail\.splice\(0, hotspotCount\);\s*state\.dirty = null;\s*state\.autoEligible = false/);
  assert.match(app, /if \(!packed\) \{\s*discardUncapturableInput\(hotspotCount, Boolean\(dirtySnapshot\)\)/);
});

test("the retained focus inset implementation is inactive", () => {
  const app = read("public/app.js");
  assert.match(app, /FOCUS_INSET_ENABLED = false/);
  assert.match(app, /FOCUS_INSET_ENABLED \? drawFocusInset\(out, latestBox, sourceRect, imageScale\) : null/);
  assert.match(app, /function drawFocusInset\(out, latestBox, sourceRect, mainScale\)/);
});

test("lasso tool exposes local transform controls in both languages", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  assert.match(html, /data-mode="select"/);
  assert.ok(html.indexOf('src="selection.js"') < html.indexOf('src="app.js"'));
  for (const key of ["select", "selectionTooSmall", "selectionReady", "selectionCommitted", "selectionCancelled", "selectionRecolored"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(app, /drawDraftActions\(ctx, selection\.box, size\)/);
  assert.match(app, /drawMoveHandle\(ctx, selection\.box, size, true\)/);
  assert.match(app, /drawResizeHandle\(ctx, selection\.box, size\)/);
  assert.match(app, /clippedContext\.clip\("evenodd"\)/);
  assert.match(app, /tileContext\.fill\("evenodd"\)/);
  assert.match(app, /MAX_LASSO_POINTS = 4096/);
});

test("selection edits never schedule or send AI requests", () => {
  const app = read("public/app.js");
  for (const name of ["captureSelection", "commitSelection", "cancelSelection", "applySelectionColor", "updateSelectionGesture"]) {
    const source = functionSource(app, name);
    assert.doesNotMatch(source, /\b(?:schedule|requestAI)\s*\(/, `${name} must stay local`);
  }
  assert.match(functionSource(app, "finishDrawing"), /schedule\(\)/);
  assert.match(functionSource(app, "invokeAIAction"), /requestAI\(action\)/);
});
