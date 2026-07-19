"use strict";

const crypto = require("node:crypto");

const LOCAL_PASSWORD = "1234";
const passwordHash = (password = LOCAL_PASSWORD) => crypto.scryptSync(password, "socrates-local-pilot-password-v1", 64).toString("hex");
function passwordMatches(storedHash, password) {
  if (typeof storedHash !== "string" || !storedHash) return false;
  const expected = Buffer.from(storedHash, "hex"), actual = Buffer.from(passwordHash(password), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { LOCAL_PASSWORD, passwordHash, passwordMatches };
