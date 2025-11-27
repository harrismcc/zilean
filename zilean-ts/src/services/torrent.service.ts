import { eq, sql, and, inArray, gt, gte, lte, or, isNull } from "drizzle-orm";
import { getDb, getSql } from "../db/client";
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
  similarity?: number;
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
 * Search for torrents by title using trigram similarity
 */
export async function searchByTitle(
  query: string,
  limit = 100
): Promise<TorrentSearchResult[]> {
  const config = getConfig();
  const minScore = config.dmm.minimumScoreMatch;
  const client = getSql();

  // Use raw SQL for trigram similarity search
  const results = await client`
    SELECT
      info_hash,
      raw_title,
      parsed_title,
      category,
      imdb_id,
      year,
      resolution,
      quality,
      seasons,
      episodes,
      languages,
      size,
      size_bytes,
      similarity(cleaned_parsed_title, ${query.toLowerCase()}) as similarity
    FROM torrents
    WHERE
      trash = false
      AND similarity(cleaned_parsed_title, ${query.toLowerCase()}) > ${minScore}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  return results.map((r) => ({
    infoHash: r.info_hash as string,
    rawTitle: r.raw_title as string,
    parsedTitle: r.parsed_title as string | null,
    category: r.category as TorrentCategory | null,
    imdbId: r.imdb_id as string | null,
    year: r.year as number | null,
    resolution: r.resolution as string | null,
    quality: r.quality as string | null,
    seasons: r.seasons as number[] | null,
    episodes: r.episodes as number[] | null,
    languages: r.languages as string[] | null,
    size: r.size as string | null,
    sizeBytes: r.size_bytes as string | null,
    similarity: r.similarity as number,
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
  const minScore = config.dmm.minimumScoreMatch;
  const client = getSql();

  // Build WHERE conditions
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.excludeTrash !== false) {
    conditions.push("trash = false");
  }

  if (filter.excludeAdult !== false) {
    conditions.push("is_adult = false");
  }

  if (filter.imdbId) {
    conditions.push("imdb_id = ${imdbId}");
    params.imdbId = filter.imdbId.toLowerCase();
  }

  if (filter.year) {
    conditions.push("year = ${year}");
    params.year = filter.year;
  }

  if (filter.category) {
    conditions.push("category = ${category}");
    params.category = filter.category;
  }

  if (filter.resolution) {
    conditions.push("resolution = ${resolution}");
    params.resolution = filter.resolution;
  }

  if (filter.season !== undefined) {
    conditions.push("seasons @> ${season}::jsonb");
    params.season = JSON.stringify([filter.season]);
  }

  if (filter.episode !== undefined) {
    conditions.push("episodes @> ${episode}::jsonb");
    params.episode = JSON.stringify([filter.episode]);
  }

  if (filter.language) {
    conditions.push("languages @> ${language}::jsonb");
    params.language = JSON.stringify([filter.language]);
  }

  // Text search with similarity
  let orderBy = "ingested_at DESC";
  let selectSimilarity = "0 as similarity";

  if (filter.query) {
    conditions.push(`similarity(cleaned_parsed_title, ${client.escapeLiteral(filter.query.toLowerCase())}) > ${minScore}`);
    selectSimilarity = `similarity(cleaned_parsed_title, ${client.escapeLiteral(filter.query.toLowerCase())}) as similarity`;
    orderBy = "similarity DESC";
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Build and execute query
  const queryStr = `
    SELECT
      info_hash,
      raw_title,
      parsed_title,
      category,
      imdb_id,
      year,
      resolution,
      quality,
      seasons,
      episodes,
      languages,
      size,
      size_bytes,
      ${selectSimilarity}
    FROM torrents
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${maxResults}
    OFFSET ${filter.offset || 0}
  `;

  // For parameterized queries, we need to use a simpler approach
  // Build dynamic query with postgres.js
  let results;

  if (filter.query && filter.imdbId) {
    results = await client`
      SELECT
        info_hash, raw_title, parsed_title, category, imdb_id, year,
        resolution, quality, seasons, episodes, languages, size, size_bytes,
        similarity(cleaned_parsed_title, ${filter.query.toLowerCase()}) as similarity
      FROM torrents
      WHERE trash = false
        AND is_adult = ${filter.excludeAdult !== false ? false : sql`is_adult`}
        AND imdb_id = ${filter.imdbId.toLowerCase()}
        AND similarity(cleaned_parsed_title, ${filter.query.toLowerCase()}) > ${minScore}
      ORDER BY similarity DESC
      LIMIT ${maxResults}
      OFFSET ${filter.offset || 0}
    `;
  } else if (filter.query) {
    results = await client`
      SELECT
        info_hash, raw_title, parsed_title, category, imdb_id, year,
        resolution, quality, seasons, episodes, languages, size, size_bytes,
        similarity(cleaned_parsed_title, ${filter.query.toLowerCase()}) as similarity
      FROM torrents
      WHERE trash = false
        AND is_adult = ${filter.excludeAdult !== false ? false : sql`is_adult`}
        AND similarity(cleaned_parsed_title, ${filter.query.toLowerCase()}) > ${minScore}
      ORDER BY similarity DESC
      LIMIT ${maxResults}
      OFFSET ${filter.offset || 0}
    `;
  } else if (filter.imdbId) {
    results = await client`
      SELECT
        info_hash, raw_title, parsed_title, category, imdb_id, year,
        resolution, quality, seasons, episodes, languages, size, size_bytes,
        0 as similarity
      FROM torrents
      WHERE trash = false
        AND is_adult = ${filter.excludeAdult !== false ? false : sql`is_adult`}
        AND imdb_id = ${filter.imdbId.toLowerCase()}
      ORDER BY ingested_at DESC
      LIMIT ${maxResults}
      OFFSET ${filter.offset || 0}
    `;
  } else {
    results = await client`
      SELECT
        info_hash, raw_title, parsed_title, category, imdb_id, year,
        resolution, quality, seasons, episodes, languages, size, size_bytes,
        0 as similarity
      FROM torrents
      WHERE trash = false
        AND is_adult = ${filter.excludeAdult !== false ? false : sql`is_adult`}
      ORDER BY ingested_at DESC
      LIMIT ${maxResults}
      OFFSET ${filter.offset || 0}
    `;
  }

  return results.map((r) => ({
    infoHash: r.info_hash as string,
    rawTitle: r.raw_title as string,
    parsedTitle: r.parsed_title as string | null,
    category: r.category as TorrentCategory | null,
    imdbId: r.imdb_id as string | null,
    year: r.year as number | null,
    resolution: r.resolution as string | null,
    quality: r.quality as string | null,
    seasons: r.seasons as number[] | null,
    episodes: r.episodes as number[] | null,
    languages: r.languages as string[] | null,
    size: r.size as string | null,
    sizeBytes: r.size_bytes as string | null,
    similarity: r.similarity as number,
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
  const client = getSql();
  const result = await client`SELECT COUNT(*) as count FROM torrents`;
  return parseInt(result[0].count as string, 10);
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
 * Vacuum and analyze indexes
 */
export async function vacuumIndexes(): Promise<void> {
  const client = getSql();
  await client`VACUUM ANALYZE torrents`;
  console.log("Vacuumed and analyzed torrents table");
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
