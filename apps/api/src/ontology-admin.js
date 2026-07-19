"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const { DECISION_GRADE_MECHANICS_ONTOLOGY, validateOntology } = require("./ontology");

function loadLocalEnv() {
  for (const file of [path.resolve(__dirname, "../../../.env"), path.resolve(__dirname, "../.env")]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

async function publish(revisionId) {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to publish an ontology.");
  const ontology = revisionId === DECISION_GRADE_MECHANICS_ONTOLOGY.id ? DECISION_GRADE_MECHANICS_ONTOLOGY : null;
  if (!ontology) throw new Error(`No local reviewed ontology matches ${revisionId}.`);
  validateOntology(ontology);
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      const revision = (await tx`SELECT id, status FROM ontology_revisions WHERE id = ${revisionId} FOR UPDATE`)[0];
      if (!revision) throw new Error(`Ontology revision ${revisionId} has not been seeded.`);
      await tx`UPDATE ontology_revisions SET status = 'retired' WHERE domain = ${ontology.domain} AND status = 'published'`;
      await tx`UPDATE ontology_revisions SET status = 'published', published_at = now() WHERE id = ${revisionId}`;
    });
    console.log(`Published ${revisionId}.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const [command, revisionId] = process.argv.slice(2);
  if (command === "validate") {
    validateOntology(DECISION_GRADE_MECHANICS_ONTOLOGY);
    console.log(`${DECISION_GRADE_MECHANICS_ONTOLOGY.id} is structurally valid with ${DECISION_GRADE_MECHANICS_ONTOLOGY.concepts.length} nodes.`);
    return;
  }
  if (command === "publish" && revisionId) return publish(revisionId);
  throw new Error("Usage: node src/ontology-admin.js validate | publish <revisionId>");
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });

module.exports = { publish };
