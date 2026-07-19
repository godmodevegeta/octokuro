"use strict";

function posterior(prior = { alpha: 1, beta: 1 }, semanticScore, processScore) {
  if (![semanticScore, processScore].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) throw new TypeError("Evidence scores must be between 0 and 1.");
  const evidence = semanticScore * .75 + processScore * .25;
  const result = { alpha: prior.alpha + evidence, beta: prior.beta + 1 - evidence };
  return { ...result, mean: result.alpha / (result.alpha + result.beta), certainty: Math.abs(result.alpha / (result.alpha + result.beta) - .5) * 2 };
}

function posteriorFromCriteria(prior = { alpha: 1, beta: 1 }, criterionResults, criteria) {
  const byId = new Map((criterionResults || []).map((result) => [result.criterionId, result]));
  if (!Array.isArray(criteria) || !criteria.length) throw new TypeError("Evidence criteria are required.");
  let weight = 0, support = 0, confidence = 0;
  for (const criterion of criteria) {
    const result = byId.get(criterion.id);
    if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > 1 || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new TypeError(`Missing or invalid evidence result for ${criterion.id}.`);
    weight += criterion.likelihood_weight;
    support += criterion.likelihood_weight * result.score;
    confidence += criterion.likelihood_weight * result.confidence;
  }
  const normalizedSupport = support / weight, strength = confidence / weight;
  const result = { alpha: Number(prior.alpha) + normalizedSupport * strength, beta: Number(prior.beta) + (1 - normalizedSupport) * strength };
  return { ...result, mean: result.alpha / (result.alpha + result.beta), certainty: Math.abs(result.alpha / (result.alpha + result.beta) - .5) * 2, support: normalizedSupport, strength, variance: betaVariance(result) };
}

function betaVariance({ alpha, beta }) {
  const total = Number(alpha) + Number(beta);
  return Number(alpha) * Number(beta) / (total * total * (total + 1));
}

function uncertaintyFlags({ semanticConfidence, processConfidence, previousMean, nextMean }) {
  const flags = [];
  if (semanticConfidence < .6) flags.push("semantic_low");
  if (processConfidence < .55) flags.push("process_anomaly");
  if (Number.isFinite(previousMean) && Math.abs(previousMean - nextMean) > .35) flags.push("temporal_unstable");
  return flags;
}

function decisionForPosterior({ mean, variance }, decisionMap) {
  if (variance > .06) return { outcome: "uncertainty", action: decisionMap.uncertainty, flags: ["human_review_required"] };
  if (mean >= .7) return { outcome: "high_confidence", action: decisionMap.high_confidence, flags: [] };
  if (mean <= .4) return { outcome: "low_confidence", action: decisionMap.low_confidence, flags: [] };
  return { outcome: "uncertainty", action: decisionMap.uncertainty, flags: ["human_review_required"] };
}

module.exports = { posterior, posteriorFromCriteria, betaVariance, decisionForPosterior, uncertaintyFlags };
