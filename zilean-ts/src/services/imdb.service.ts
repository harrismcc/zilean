import { eq, sql, inArray } from "drizzle-orm";
import { getDb, getSql } from "../db/client";
import { imdbFiles, type NewImdbFile, type ImdbFile } from "../db/schema";
import { getConfig } from "../config";

export interface ImdbSearchResult {
  imdbId: string;
  title: string;
  year: number | null;
  category: string | null;
  adult: boolean;
  similarity?: number;
}

export interface ImdbSearchFilter {
  query: string;
  year?: number;
  category?: string;
  limit?: number;
}

/**
 * Search IMDB entries by title using trigram similarity
 */
export async function searchImdb(
  filter: ImdbSearchFilter
): Promise<ImdbSearchResult[]> {
  const config = getConfig();
  const minScore = config.imdb.minimumScoreMatch;
  const limit = filter.limit || 20;
  const client = getSql();

  let results;

  if (filter.year && filter.category) {
    results = await client`
      SELECT
        imdb_id,
        title,
        year,
        category,
        adult,
        similarity(title, ${filter.query.toLowerCase()}) as similarity
      FROM imdb_files
      WHERE
        similarity(title, ${filter.query.toLowerCase()}) > ${minScore}
        AND year = ${filter.year}
        AND category = ${filter.category}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  } else if (filter.year) {
    results = await client`
      SELECT
        imdb_id,
        title,
        year,
        category,
        adult,
        similarity(title, ${filter.query.toLowerCase()}) as similarity
      FROM imdb_files
      WHERE
        similarity(title, ${filter.query.toLowerCase()}) > ${minScore}
        AND year = ${filter.year}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  } else if (filter.category) {
    results = await client`
      SELECT
        imdb_id,
        title,
        year,
        category,
        adult,
        similarity(title, ${filter.query.toLowerCase()}) as similarity
      FROM imdb_files
      WHERE
        similarity(title, ${filter.query.toLowerCase()}) > ${minScore}
        AND category = ${filter.category}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  } else {
    results = await client`
      SELECT
        imdb_id,
        title,
        year,
        category,
        adult,
        similarity(title, ${filter.query.toLowerCase()}) as similarity
      FROM imdb_files
      WHERE similarity(title, ${filter.query.toLowerCase()}) > ${minScore}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  }

  return results.map((r) => ({
    imdbId: r.imdb_id as string,
    title: r.title as string,
    year: r.year as number | null,
    category: r.category as string | null,
    adult: r.adult as boolean,
    similarity: r.similarity as number,
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
  const client = getSql();
  const result = await client`SELECT COUNT(*) as count FROM imdb_files`;
  return parseInt(result[0].count as string, 10);
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
