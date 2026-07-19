"use strict";
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { createClient } = require("redis");

function durableStores() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error("DATABASE_URL and REDIS_URL are required. The API has no development-memory mode.");
  const sql = postgres(process.env.DATABASE_URL, { max: 5 });
  const redis = createClient({ url: process.env.REDIS_URL });
  return { db: drizzle(sql), sql, redis, statusSubscriber: redis.duplicate() };
}
module.exports = { durableStores };
