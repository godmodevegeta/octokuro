"use strict";

const { spawn } = require("node:child_process");
const FALLBACK_ITEM = { prompt: "A 2 kg cart starts from rest and experiences a constant 6 N horizontal force for 4 s on a frictionless track. Find its acceleration and final speed. Show a free-body diagram.", intendedSolution: "a = F/m = 3 m/s²; v = at = 12 m/s", rubric: ["uses Newton's second law", "keeps units", "finds 3 m/s² and 12 m/s"] };
const schemas = {
  generator: ["prompt", "intendedSolution", "rubric"], critic: ["valid", "reason"], inference: ["semanticScore", "processScore", "confidence", "followUpNeeded"], followup: ["prompt", "expectedEvidence"],
};
function validate(role, value) {
  if (!value || typeof value !== "object") return false;
  if (role === "evaluator") return Array.isArray(value.criterionResults) && value.criterionResults.every((result) => typeof result.criterionId === "string" && Number.isFinite(result.score) && result.score >= 0 && result.score <= 1 && Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1 && typeof result.rationale === "string");
  return schemas[role].every((key) => key in value);
}
function prompt(role, context) {
  const shape = role === "evaluator" ? { criterionResults: [{ criterionId: "declared criterion id", score: "0..1", confidence: "0..1", rationale: "brief evidence-grounded rationale" }] } : schemas[role];
  return `You are Socrates assessment ${role}. Return JSON only, matching exactly this required shape: ${JSON.stringify(shape)}. Evaluate only the declared criterion IDs. Context: ${JSON.stringify(context)}`;
}
async function callCodex(role, context) {
  const executable = process.env.CODEX_CLI_PATH || "codex";
  const args = ["exec", "--json", prompt(role, context)];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] }); let output = "", error = "";
    child.stdout.on("data", (d) => output += d); child.stderr.on("data", (d) => error += d);
    child.on("error", reject); child.on("close", (code) => { if (code) return reject(new Error(error || `Codex exited ${code}`)); try { const parsed = JSON.parse(output); if (!validate(role, parsed)) throw new Error("schema mismatch"); resolve({ output: parsed, model: process.env.CODEX_CLI_MODEL || "codex-cli" }); } catch (e) { reject(e); } });
  });
}
async function generateValidatedItem(target) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await callCodex("generator", { target });
      if (!validate("generator", result.output)) continue;
      const critic = await callCodex("critic", { target: { id: target.id, definition: target.definition, evidenceCriteria: target.diagnosticMetadata?.evidenceCriteria }, item: result.output });
      if (validate("critic", critic.output) && critic.output.valid) return { item: result.output, source: "codex", attempts: attempt, metadata: { generator: result, critic }, verifierResult: { valid: true, reason: critic.output.reason, source: "criterion-targeted-critic" } };
    } catch {}
  }
  return { item: FALLBACK_ITEM, source: "curated-fallback", attempts: 3, metadata: { model: "fallback" }, verifierResult: { valid: true, source: "curated-fallback" } };
}
function defaultInference(features, submitted) {
  const processScore = features.erase_ratio > .8 ? .35 : .7;
  return { semanticScore: submitted ? .6 : .4, processScore, confidence: submitted ? .65 : .35, followUpNeeded: submitted && processScore < .65 };
}
function processCriterionScore(criterion, traceFeatures = {}) {
  if (criterion.rubrics.includes("diagram_before_equations")) return { score: traceFeatures.process_order?.diagramBeforeEquations ? 1 : 0, confidence: traceFeatures.process_order ? .9 : .1, rationale: "Local aggregate ordering marker." };
  if (criterion.rubrics.includes("sustained_attempt")) return { score: traceFeatures.spatial_progression?.events > 3 ? .8 : .3, confidence: .7, rationale: "Sanitized work-activity summary." };
  if (criterion.rubrics.includes("representation_before_substitution")) return { score: traceFeatures.process_order?.representationBeforeEquations ? 1 : .2, confidence: traceFeatures.process_order ? .85 : .1, rationale: "Local aggregate ordering marker." };
  return { score: .5, confidence: .1, rationale: "No supported local process evaluator for this rubric." };
}
async function evaluateEvidence({ target, atlasSnapshot, explanation, traceFeatures, submitted }) {
  const criteria = target.diagnosticMetadata?.evidenceCriteria || [];
  const process = criteria.filter((criterion) => criterion.type === "process").map((criterion) => ({ criterionId: criterion.id, ...processCriterionScore(criterion, traceFeatures) }));
  const visualCriteria = criteria.filter((criterion) => criterion.type !== "process");
  try {
    const result = await callCodex("evaluator", { target: { id: target.id, definition: target.definition, criteria: visualCriteria.map(({ id, type, rubrics }) => ({ id, type, rubrics })) }, evidence: { atlasSnapshot, explanation: explanation || "", submitted: Boolean(submitted), traceFeatures } });
    const allowed = new Set(visualCriteria.map((criterion) => criterion.id));
    const scored = result.output.criterionResults.filter((entry) => allowed.has(entry.criterionId));
    if (scored.length === visualCriteria.length && new Set(scored.map((entry) => entry.criterionId)).size === scored.length) return { criterionResults: [...scored, ...process], promptVersion: "criterion-vision-v1", modelMetadata: { source: "codex-vision", model: result.model } };
  } catch {}
  const fallbackScore = submitted ? .5 : .25;
  return { criterionResults: [...visualCriteria.map((criterion) => ({ criterionId: criterion.id, score: fallbackScore, confidence: .1, rationale: "Vision evaluator unavailable." })), ...process], promptVersion: "criterion-vision-v1", modelMetadata: { source: "vision-evaluator-unavailable" } };
}
module.exports = { callCodex, generateValidatedItem, defaultInference, evaluateEvidence, validate, FALLBACK_ITEM };
