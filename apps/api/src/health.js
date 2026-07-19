"use strict";
const net = require("node:net");
const { spawnSync } = require("node:child_process");

function portReachable(url) {
  try { const parsed = new URL(url); return new Promise((resolve) => { const socket = net.connect({ host: parsed.hostname, port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)) }); socket.setTimeout(500); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); socket.once("timeout", () => { socket.destroy(); resolve(false); }); }); } catch { return Promise.resolve(false); }
}
async function localHealth() {
  const codex = spawnSync(process.env.CODEX_CLI_PATH || "codex", ["--version"], { encoding: "utf8", timeout: 1000 }).status === 0;
  return { postgres: await portReachable(process.env.DATABASE_URL || ""), redis: await portReachable(process.env.REDIS_URL || ""), sympy: await portReachable(process.env.SYMPY_VERIFIER_URL || ""), codex };
}
module.exports = { localHealth };
