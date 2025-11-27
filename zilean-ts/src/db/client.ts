import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../config";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!db) {
    const config = getConfig();
    sql = postgres(config.database.connectionString, {
      max: config.database.maxConnections,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    db = drizzle(sql, { schema });
  }
  return db;
}

export function getSql() {
  if (!sql) {
    getDb(); // Initialize sql client
  }
  return sql!;
}

export async function initializeDatabase() {
  const client = getSql();

  // Enable pg_trgm extension for fuzzy text search
  await client`CREATE EXTENSION IF NOT EXISTS pg_trgm`;

  console.log("Database extensions initialized");
}

export async function closeDatabase() {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
}

export { schema };
