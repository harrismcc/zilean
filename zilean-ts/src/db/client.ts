import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getConfig } from "../config";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlite: Database | null = null;

export function getDb() {
  if (!db) {
    const config = getConfig();
    const dbPath = config.database.connectionString;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    sqlite = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA synchronous = NORMAL");
    sqlite.exec("PRAGMA cache_size = -64000"); // 64MB cache
    sqlite.exec("PRAGMA temp_store = MEMORY");

    db = drizzle(sqlite, { schema });
  }
  return db;
}

export function getSqlite() {
  if (!sqlite) {
    getDb(); // Initialize sqlite client
  }
  return sqlite!;
}

export async function initializeDatabase() {
  const database = getDb();
  const client = getSqlite();

  // Create tables if they don't exist (handled by Drizzle migrations, but we can ensure indexes)
  console.log("Database initialized");

  // Create FTS5 virtual table for full-text search if it doesn't exist
  try {
    client.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS torrents_fts USING fts5(
        info_hash,
        cleaned_parsed_title,
        content='torrents',
        content_rowid='rowid'
      );
    `);

    // Create triggers to keep FTS index in sync
    client.exec(`
      CREATE TRIGGER IF NOT EXISTS torrents_ai AFTER INSERT ON torrents BEGIN
        INSERT INTO torrents_fts(info_hash, cleaned_parsed_title)
        VALUES (new.info_hash, new.cleaned_parsed_title);
      END;
    `);

    client.exec(`
      CREATE TRIGGER IF NOT EXISTS torrents_ad AFTER DELETE ON torrents BEGIN
        INSERT INTO torrents_fts(torrents_fts, info_hash, cleaned_parsed_title)
        VALUES ('delete', old.info_hash, old.cleaned_parsed_title);
      END;
    `);

    client.exec(`
      CREATE TRIGGER IF NOT EXISTS torrents_au AFTER UPDATE ON torrents BEGIN
        INSERT INTO torrents_fts(torrents_fts, info_hash, cleaned_parsed_title)
        VALUES ('delete', old.info_hash, old.cleaned_parsed_title);
        INSERT INTO torrents_fts(info_hash, cleaned_parsed_title)
        VALUES (new.info_hash, new.cleaned_parsed_title);
      END;
    `);

    console.log("FTS5 full-text search initialized");
  } catch (error) {
    // FTS might already exist or tables not yet created
    console.log("FTS5 setup skipped (will be created after migrations)");
  }
}

export async function closeDatabase() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

export { schema };
