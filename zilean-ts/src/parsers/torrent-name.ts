import ptt from "parse-torrent-title";
import type { NewTorrent, TorrentCategory } from "../db/schema";

// Type definition for parse-torrent-title result
interface PttResult {
  title?: string;
  year?: number;
  resolution?: string;
  quality?: string;
  codec?: string;
  audio?: string;
  group?: string;
  season?: number;
  seasons?: number[];
  episode?: number;
  episodes?: number[];
  languages?: string[];
  dubbed?: boolean;
  subbed?: boolean;
  hardcoded?: boolean;
  proper?: boolean;
  repack?: boolean;
  extended?: boolean;
  unrated?: boolean;
  remastered?: boolean;
  retail?: boolean;
  convert?: boolean;
  container?: string;
  hdr?: string[];
  is3d?: boolean;
  documentary?: boolean;
  complete?: boolean;
  [key: string]: unknown;
}

// Additional patterns not covered by parse-torrent-title
const ADULT_PATTERNS = [
  /\bxxx\b/i,
  /\bporn\b/i,
  /\badult\b/i,
  /\bbrazzers\b/i,
  /\bvixen\b/i,
  /\bblacked\b/i,
  /\btushy\b/i,
  /\belegantangel\b/i,
  /\bwickedpictures\b/i,
  /\breality\s?kings\b/i,
  /\bbangbros\b/i,
];

const IMDB_PATTERN = /\b(tt\d{7,8})\b/i;

const SIZE_PATTERN = /\b(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)\b/i;

const TRASH_PATTERNS = [
  /\bcam\b/i,
  /\bhdcam\b/i,
  /\bts\b/i,
  /\btelesync\b/i,
  /\btc\b/i,
  /\btelecine\b/i,
  /\bscr\b/i,
  /\bscreener\b/i,
  /\bdvdscr\b/i,
  /\bworkprint\b/i,
  /\bhdts\b/i,
];

const TV_PATTERNS = [
  /s\d{1,2}e\d{1,2}/i,
  /season\s*\d+/i,
  /episode\s*\d+/i,
  /\b\d{1,2}x\d{2}\b/,
  /complete\s*series/i,
];

export interface ParsedTorrent {
  rawTitle: string;
  parsedTitle: string | null;
  normalizedTitle: string | null;
  cleanedParsedTitle: string | null;
  category: TorrentCategory | null;
  imdbId: string | null;
  isAdult: boolean;
  year: number | null;
  resolution: string | null;
  quality: string | null;
  codec: string | null;
  hdr: string[] | null;
  audio: string[] | null;
  languages: string[] | null;
  seasons: number[] | null;
  episodes: number[] | null;
  trash: boolean;
  complete: boolean;
  dubbed: boolean;
  subbed: boolean;
  extended: boolean;
  hardcoded: boolean;
  proper: boolean;
  repack: boolean;
  retail: boolean;
  remastered: boolean;
  unrated: boolean;
  documentary: boolean;
  is3d: boolean;
  releaseGroup: string | null;
  size: string | null;
  sizeBytes: string | null;
  container: string | null;
}

/**
 * Normalize title for consistent matching
 * - Lowercase
 * - Replace non-alphanumeric with spaces
 * - Remove extra whitespace
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean parsed title for search indexing
 * - Remove common filler words
 * - Normalize spacing
 */
function cleanParsedTitle(title: string | null): string | null {
  if (!title) return null;

  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "shall", "can"
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 0 && !stopWords.has(word))
    .join(" ")
    .trim() || null;
}

/**
 * Extract IMDB ID from title
 */
function extractImdbId(title: string): string | null {
  const match = title.match(IMDB_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Check if content is adult
 */
function isAdultContent(title: string): boolean {
  return ADULT_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Check if torrent is low quality (trash)
 */
function isTrashQuality(title: string, quality?: string): boolean {
  if (quality) {
    const lowerQuality = quality.toLowerCase();
    if (
      lowerQuality.includes("cam") ||
      lowerQuality.includes("telesync") ||
      lowerQuality.includes("telecine") ||
      lowerQuality.includes("screener")
    ) {
      return true;
    }
  }
  return TRASH_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Determine content category
 */
function determineCategory(
  title: string,
  isAdult: boolean,
  seasons?: number[],
  episodes?: number[]
): TorrentCategory | null {
  if (isAdult) return "xxx";

  // Check for TV patterns
  const hasSeasons = seasons && seasons.length > 0;
  const hasEpisodes = episodes && episodes.length > 0;
  const hasTvPattern = TV_PATTERNS.some(pattern => pattern.test(title));

  if (hasSeasons || hasEpisodes || hasTvPattern) {
    return "tvSeries";
  }

  // Default to movie for non-TV content
  return "movie";
}

/**
 * Parse size string to bytes
 */
function parseSizeToBytes(sizeStr: string | null): string | null {
  if (!sizeStr) return null;

  const match = sizeStr.match(SIZE_PATTERN);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
  };

  const bytes = Math.floor(value * (multipliers[unit] || 1));
  return bytes.toString();
}

/**
 * Extract size from title if present
 */
function extractSize(title: string): string | null {
  const match = title.match(SIZE_PATTERN);
  return match ? match[0] : null;
}

/**
 * Parse a torrent name into structured metadata
 */
export function parseTorrentName(rawTitle: string): ParsedTorrent {
  // Use parse-torrent-title
  const parsed = ptt.parse(rawTitle) as PttResult;

  // Extract additional info
  const imdbId = extractImdbId(rawTitle);
  const isAdult = isAdultContent(rawTitle);
  const size = extractSize(rawTitle);

  // Build seasons array
  let seasons: number[] | null = null;
  if (parsed.seasons && parsed.seasons.length > 0) {
    seasons = parsed.seasons;
  } else if (parsed.season !== undefined) {
    seasons = [parsed.season];
  }

  // Build episodes array
  let episodes: number[] | null = null;
  if (parsed.episodes && parsed.episodes.length > 0) {
    episodes = parsed.episodes;
  } else if (parsed.episode !== undefined) {
    episodes = [parsed.episode];
  }

  // Determine category
  const category = determineCategory(rawTitle, isAdult, seasons ?? undefined, episodes ?? undefined);

  // Parse audio into array
  let audio: string[] | null = null;
  if (parsed.audio) {
    audio = Array.isArray(parsed.audio) ? parsed.audio : [parsed.audio];
  }

  // Parse HDR
  let hdr: string[] | null = null;
  if (parsed.hdr) {
    hdr = Array.isArray(parsed.hdr) ? parsed.hdr : [parsed.hdr];
  }

  const parsedTitle = parsed.title || null;
  const normalizedTitle = parsedTitle ? normalizeTitle(parsedTitle) : normalizeTitle(rawTitle);
  const cleanedTitle = cleanParsedTitle(parsedTitle || rawTitle);

  return {
    rawTitle,
    parsedTitle,
    normalizedTitle,
    cleanedParsedTitle: cleanedTitle,
    category,
    imdbId,
    isAdult,
    year: parsed.year || null,
    resolution: parsed.resolution || null,
    quality: parsed.quality || null,
    codec: parsed.codec || null,
    hdr,
    audio,
    languages: parsed.languages || null,
    seasons,
    episodes,
    trash: isTrashQuality(rawTitle, parsed.quality),
    complete: parsed.complete || false,
    dubbed: parsed.dubbed || false,
    subbed: parsed.subbed || false,
    extended: parsed.extended || false,
    hardcoded: parsed.hardcoded || false,
    proper: parsed.proper || false,
    repack: parsed.repack || false,
    retail: parsed.retail || false,
    remastered: parsed.remastered || false,
    unrated: parsed.unrated || false,
    documentary: parsed.documentary || false,
    is3d: parsed.is3d || false,
    releaseGroup: parsed.group || null,
    size,
    sizeBytes: parseSizeToBytes(size),
    container: parsed.container || null,
  };
}

/**
 * Convert parsed torrent to database format
 */
export function toDbTorrent(
  infoHash: string,
  parsed: ParsedTorrent
): NewTorrent {
  return {
    infoHash: infoHash.toLowerCase(),
    rawTitle: parsed.rawTitle,
    parsedTitle: parsed.parsedTitle,
    normalizedTitle: parsed.normalizedTitle,
    cleanedParsedTitle: parsed.cleanedParsedTitle,
    category: parsed.category,
    imdbId: parsed.imdbId,
    isAdult: parsed.isAdult,
    year: parsed.year,
    resolution: parsed.resolution,
    quality: parsed.quality,
    codec: parsed.codec,
    hdr: parsed.hdr,
    audio: parsed.audio,
    languages: parsed.languages,
    seasons: parsed.seasons,
    episodes: parsed.episodes,
    trash: parsed.trash,
    complete: parsed.complete,
    dubbed: parsed.dubbed,
    subbed: parsed.subbed,
    extended: parsed.extended,
    hardcoded: parsed.hardcoded,
    proper: parsed.proper,
    repack: parsed.repack,
    retail: parsed.retail,
    remastered: parsed.remastered,
    unrated: parsed.unrated,
    documentary: parsed.documentary,
    is3d: parsed.is3d,
    releaseGroup: parsed.releaseGroup,
    size: parsed.size,
    sizeBytes: parsed.sizeBytes,
    container: parsed.container,
  };
}

/**
 * Parse multiple torrents in batch
 */
export function parseTorrentNames(
  entries: Array<{ infoHash: string; title: string }>
): NewTorrent[] {
  return entries.map(({ infoHash, title }) => {
    const parsed = parseTorrentName(title);
    return toDbTorrent(infoHash, parsed);
  });
}
