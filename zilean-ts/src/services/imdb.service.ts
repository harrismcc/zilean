import { eq, and, inArray, like } from "drizzle-orm";
import { getDb, getSqlite } from "../db/client";
import { imdbFiles, type NewImdbFile, type ImdbFile } from "../db/schema";

export interface ImdbSearchResult {
  imdbId: string;
  title: string;
  year: number | null;
  category: string | null;
  adult: boolean;
}

export interface ImdbSearchFilter {
  query: string;
  year?: number;
  category?: string;
  limit?: number;
}

/**
 * Search IMDB entries by title using LIKE
 */
export async function searchImdb(
  filter: ImdbSearchFilter
): Promise<ImdbSearchResult[]> {
  const db = getDb();
  const limit = filter.limit || 20;

  // Build search pattern
  const searchPattern = `%${filter.query.toLowerCase().replace(/\s+/g, "%")}%`;

  // Build conditions
  const conditions = [like(imdbFiles.title, searchPattern)];

  if (filter.year) {
    conditions.push(eq(imdbFiles.year, filter.year));
  }

  if (filter.category) {
    conditions.push(eq(imdbFiles.category, filter.category));
  }

  const results = await db
    .select()
    .from(imdbFiles)
    .where(and(...conditions))
    .limit(limit);

  return results.map((r) => ({
    imdbId: r.imdbId,
    title: r.title,
    year: r.year,
    category: r.category,
    adult: r.adult ?? false,
  }));
}

/**
 * Get IMDB entry by ID
 */
export async function getImdbById(imdbId: string): Promise<ImdbFile | null> {
  const db = getDb();
  const results = await db
    .select()
    .from(imdbFiles)
    .where(eq(imdbFiles.imdbId, imdbId.toLowerCase()))
    .limit(1);

  return results[0] || null;
}

/**
 * Store IMDB entries (upsert)
 */
export async function storeImdbEntries(
  entries: NewImdbFile[],
  batchSize = 5000
): Promise<{ inserted: number; updated: number }> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const ids = batch.map(e => e.imdbId);

    // Get existing IDs
    const existing = await db
      .select({ imdbId: imdbFiles.imdbId })
      .from(imdbFiles)
      .where(inArray(imdbFiles.imdbId, ids));

    const existingSet = new Set(existing.map(e => e.imdbId));

    // Split into inserts and updates
    const toInsert = batch.filter(e => !existingSet.has(e.imdbId));
    const toUpdate = batch.filter(e => existingSet.has(e.imdbId));

    // Insert new entries
    if (toInsert.length > 0) {
      await db.insert(imdbFiles).values(toInsert);
      inserted += toInsert.length;
    }

    // Update existing entries
    for (const entry of toUpdate) {
      await db
        .update(imdbFiles)
        .set({
          title: entry.title,
          year: entry.year,
          category: entry.category,
          adult: entry.adult,
        })
        .where(eq(imdbFiles.imdbId, entry.imdbId));
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Get IMDB entry count
 */
export async function getImdbCount(): Promise<number> {
  const sqlite = getSqlite();
  const result = sqlite.prepare("SELECT COUNT(*) as count FROM imdb_files").get() as { count: number } | undefined;
  return result?.count ?? 0;
}

/**
 * Bulk check if IMDB IDs exist
 */
export async function checkImdbIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const db = getDb();
  const results = await db
    .select({ imdbId: imdbFiles.imdbId })
    .from(imdbFiles)
    .where(inArray(imdbFiles.imdbId, ids.map(id => id.toLowerCase())));

  return new Set(results.map(r => r.imdbId));
}
