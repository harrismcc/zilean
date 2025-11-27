import { eq, sql, and, inArray, like, or, desc } from "drizzle-orm";
import { getDb, getSqlite } from "../db/client";
import { torrents, blacklistedItems, type NewTorrent, type Torrent, type TorrentCategory } from "../db/schema";
import { getConfig } from "../config";

export interface SearchFilter {
  query?: string;
  imdbId?: string;
  season?: number;
  episode?: number;
  year?: number;
  language?: string;
  resolution?: string;
  category?: TorrentCategory;
  excludeTrash?: boolean;
  excludeAdult?: boolean;
  limit?: number;
  offset?: number;
}

export interface TorrentSearchResult {
  infoHash: string;
  rawTitle: string;
  parsedTitle: string | null;
  category: TorrentCategory | null;
  imdbId: string | null;
  year: number | null;
  resolution: string | null;
  quality: string | null;
  seasons: number[] | null;
  episodes: number[] | null;
  languages: string[] | null;
  size: string | null;
  sizeBytes: string | null;
  rank?: number;
}

/**
 * Store torrents in the database (upsert)
 */
export async function storeTorrents(
  torrentList: NewTorrent[],
  batchSize = 1000
): Promise<{ inserted: number; updated: number }> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;

  // Get blacklisted hashes to exclude
  const blacklisted = await getBlacklistedHashes();
  const blacklistSet = new Set(blacklisted);

  // Filter out blacklisted torrents
  const filtered = torrentList.filter(t => !blacklistSet.has(t.infoHash));

  // Process in batches
  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);

    // Get existing hashes
    const hashes = batch.map(t => t.infoHash);
    const existing = await db
      .select({ infoHash: torrents.infoHash })
      .from(torrents)
      .where(inArray(torrents.infoHash, hashes));

    const existingSet = new Set(existing.map(e => e.infoHash));

    // Split into inserts and updates
    const toInsert = batch.filter(t => !existingSet.has(t.infoHash));
    const toUpdate = batch.filter(t => existingSet.has(t.infoHash));

    // Insert new torrents
    if (toInsert.length > 0) {
      await db.insert(torrents).values(toInsert);
      inserted += toInsert.length;
    }

    // Update existing torrents
    for (const torrent of toUpdate) {
      await db
        .update(torrents)
        .set({
          rawTitle: torrent.rawTitle,
          parsedTitle: torrent.parsedTitle,
          normalizedTitle: torrent.normalizedTitle,
          cleanedParsedTitle: torrent.cleanedParsedTitle,
          category: torrent.category,
          imdbId: torrent.imdbId,
          isAdult: torrent.isAdult,
          year: torrent.year,
          resolution: torrent.resolution,
          quality: torrent.quality,
          codec: torrent.codec,
          seasons: torrent.seasons,
          episodes: torrent.episodes,
          languages: torrent.languages,
          trash: torrent.trash,
          size: torrent.size,
          sizeBytes: torrent.sizeBytes,
        })
        .where(eq(torrents.infoHash, torrent.infoHash));
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Search for torrents by title using FTS5 full-text search
 */
export async function searchByTitle(
  query: string,
  limit = 100
): Promise<TorrentSearchResult[]> {
  const db = getDb();
  const sqlite = getSqlite();

  // Prepare search query for FTS5 (escape special characters and add wildcards)
  const searchTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t}"*`)
    .join(" ");

  if (!searchTerms) {
    return [];
  }

  try {
    // Use FTS5 for full-text search with ranking
    const stmt = sqlite.prepare(`
      SELECT
        t.info_hash,
        t.raw_title,
        t.parsed_title,
        t.category,
        t.imdb_id,
        t.year,
        t.resolution,
        t.quality,
        t.seasons,
        t.episodes,
        t.languages,
        t.size,
        t.size_bytes,
        bm25(torrents_fts) as rank
      FROM torrents_fts
      JOIN torrents t ON torrents_fts.info_hash = t.info_hash
      WHERE torrents_fts MATCH ?
        AND t.trash = 0
      ORDER BY rank
      LIMIT ?
    `);

    const results = stmt.all(searchTerms, limit) as Array<Record<string, unknown>>;

    return results.map((r) => ({
      infoHash: r.info_hash as string,
      rawTitle: r.raw_title as string,
      parsedTitle: r.parsed_title as string | null,
      category: r.category as TorrentCategory | null,
      imdbId: r.imdb_id as string | null,
      year: r.year as number | null,
      resolution: r.resolution as string | null,
      quality: r.quality as string | null,
      seasons: r.seasons ? JSON.parse(r.seasons as string) : null,
      episodes: r.episodes ? JSON.parse(r.episodes as string) : null,
      languages: r.languages ? JSON.parse(r.languages as string) : null,
      size: r.size as string | null,
      sizeBytes: r.size_bytes as string | null,
      rank: r.rank as number,
    }));
  } catch {
    // Fallback to LIKE search if FTS5 not available
    return searchByTitleFallback(query, limit);
  }
}

/**
 * Fallback search using LIKE (when FTS5 is not available)
 */
async function searchByTitleFallback(
  query: string,
  limit = 100
): Promise<TorrentSearchResult[]> {
  const db = getDb();

  const searchPattern = `%${query.toLowerCase().replace(/\s+/g, "%")}%`;

  const results = await db
    .select()
    .from(torrents)
    .where(
      and(
        eq(torrents.trash, false),
        like(torrents.cleanedParsedTitle, searchPattern)
      )
    )
    .limit(limit);

  return results.map((r) => ({
    infoHash: r.infoHash,
    rawTitle: r.rawTitle,
    parsedTitle: r.parsedTitle,
    category: r.category,
    imdbId: r.imdbId,
    year: r.year,
    resolution: r.resolution,
    quality: r.quality,
    seasons: r.seasons,
    episodes: r.episodes,
    languages: r.languages,
    size: r.size,
    sizeBytes: r.sizeBytes,
  }));
}

/**
 * Advanced filtered search
 */
export async function searchFiltered(
  filter: SearchFilter
): Promise<TorrentSearchResult[]> {
  const config = getConfig();
  const maxResults = filter.limit || config.dmm.maxFilteredResults;
  const db = getDb();

  // Build conditions array
  const conditions = [];

  if (filter.excludeTrash !== false) {
    conditions.push(eq(torrents.trash, false));
  }

  if (filter.excludeAdult !== false) {
    conditions.push(eq(torrents.isAdult, false));
  }

  if (filter.imdbId) {
    conditions.push(eq(torrents.imdbId, filter.imdbId.toLowerCase()));
  }

  if (filter.year) {
    conditions.push(eq(torrents.year, filter.year));
  }

  if (filter.category) {
    conditions.push(eq(torrents.category, filter.category));
  }

  if (filter.resolution) {
    conditions.push(eq(torrents.resolution, filter.resolution));
  }

  // For query-based search, use FTS5 or LIKE
  if (filter.query) {
    const searchPattern = `%${filter.query.toLowerCase().replace(/\s+/g, "%")}%`;
    conditions.push(like(torrents.cleanedParsedTitle, searchPattern));
  }

  // Season/episode filtering with JSON
  if (filter.season !== undefined) {
    conditions.push(
      like(torrents.seasons, `%${filter.season}%`)
    );
  }

  if (filter.episode !== undefined) {
    conditions.push(
      like(torrents.episodes, `%${filter.episode}%`)
    );
  }

  if (filter.language) {
    conditions.push(
      like(torrents.languages, `%"${filter.language}"%`)
    );
  }

  const results = await db
    .select()
    .from(torrents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(torrents.ingestedAt))
    .limit(maxResults)
    .offset(filter.offset || 0);

  return results.map((r) => ({
    infoHash: r.infoHash,
    rawTitle: r.rawTitle,
    parsedTitle: r.parsedTitle,
    category: r.category,
    imdbId: r.imdbId,
    year: r.year,
    resolution: r.resolution,
    quality: r.quality,
    seasons: r.seasons,
    episodes: r.episodes,
    languages: r.languages,
    size: r.size,
    sizeBytes: r.sizeBytes,
  }));
}

/**
 * Get existing info hashes (for deduplication)
 */
export async function getExistingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const db = getDb();
  const results = await db
    .select({ infoHash: torrents.infoHash })
    .from(torrents)
    .where(inArray(torrents.infoHash, hashes.map(h => h.toLowerCase())));

  return new Set(results.map(r => r.infoHash));
}

/**
 * Get blacklisted hashes
 */
export async function getBlacklistedHashes(): Promise<string[]> {
  const db = getDb();
  const results = await db
    .select({ infoHash: blacklistedItems.infoHash })
    .from(blacklistedItems);

  return results.map(r => r.infoHash);
}

/**
 * Get total torrent count
 */
export async function getTorrentCount(): Promise<number> {
  const sqlite = getSqlite();
  const result = sqlite.prepare("SELECT COUNT(*) as count FROM torrents").get() as { count: number };
  return result.count;
}

/**
 * Stream all torrents (for export)
 */
export async function* streamAllTorrents(
  batchSize = 10000
): AsyncGenerator<Torrent[]> {
  const db = getDb();
  let offset = 0;

  while (true) {
    const batch = await db
      .select()
      .from(torrents)
      .orderBy(torrents.infoHash)
      .limit(batchSize)
      .offset(offset);

    if (batch.length === 0) break;

    yield batch;
    offset += batchSize;

    if (batch.length < batchSize) break;
  }
}

/**
 * Vacuum database
 */
export async function vacuumIndexes(): Promise<void> {
  const sqlite = getSqlite();
  sqlite.exec("VACUUM");
  console.log("Vacuumed database");
}

/**
 * Check if hashes exist in database
 */
export async function checkCachedHashes(
  hashes: string[]
): Promise<{ hash: string; cached: boolean }[]> {
  const existing = await getExistingHashes(hashes);
  return hashes.map(hash => ({
    hash,
    cached: existing.has(hash.toLowerCase()),
  }));
}
