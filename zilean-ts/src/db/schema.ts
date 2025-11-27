import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

// Torrent categories
export type TorrentCategory = "movie" | "tvSeries" | "xxx" | "other";

// Main torrents table
export const torrents = sqliteTable(
  "torrents",
  {
    infoHash: text("info_hash").primaryKey(),
    rawTitle: text("raw_title").notNull(),
    parsedTitle: text("parsed_title"),
    normalizedTitle: text("normalized_title"),
    cleanedParsedTitle: text("cleaned_parsed_title"),

    // Content classification
    category: text("category").$type<TorrentCategory>(),
    imdbId: text("imdb_id"),
    isAdult: integer("is_adult", { mode: "boolean" }).default(false),

    // Video properties
    year: integer("year"),
    resolution: text("resolution"),
    quality: text("quality"),
    codec: text("codec"),
    hdr: text("hdr", { mode: "json" }).$type<string[]>(),
    bitDepth: integer("bit_depth"),

    // Audio
    audio: text("audio", { mode: "json" }).$type<string[]>(),
    channels: text("channels"),
    languages: text("languages", { mode: "json" }).$type<string[]>(),

    // Series info (stored as JSON arrays)
    seasons: text("seasons", { mode: "json" }).$type<number[]>(),
    episodes: text("episodes", { mode: "json" }).$type<number[]>(),
    volumes: text("volumes", { mode: "json" }).$type<number[]>(),

    // Content flags
    trash: integer("trash", { mode: "boolean" }).default(false),
    complete: integer("complete", { mode: "boolean" }).default(false),
    dubbed: integer("dubbed", { mode: "boolean" }).default(false),
    subbed: integer("subbed", { mode: "boolean" }).default(false),
    extended: integer("extended", { mode: "boolean" }).default(false),
    converted: integer("converted", { mode: "boolean" }).default(false),
    hardcoded: integer("hardcoded", { mode: "boolean" }).default(false),
    proper: integer("proper", { mode: "boolean" }).default(false),
    repack: integer("repack", { mode: "boolean" }).default(false),
    retail: integer("retail", { mode: "boolean" }).default(false),
    upscaled: integer("upscaled", { mode: "boolean" }).default(false),
    remastered: integer("remastered", { mode: "boolean" }).default(false),
    unrated: integer("unrated", { mode: "boolean" }).default(false),
    documentary: integer("documentary", { mode: "boolean" }).default(false),
    is3d: integer("is_3d", { mode: "boolean" }).default(false),
    ppv: integer("ppv", { mode: "boolean" }).default(false),

    // Other metadata
    releaseGroup: text("release_group"),
    edition: text("edition"),
    region: text("region"),
    network: text("network"),
    size: text("size"),
    sizeBytes: text("size_bytes"),
    site: text("site"),
    container: text("container"),
    extension: text("extension"),
    country: text("country"),

    // Timestamps (stored as ISO strings)
    ingestedAt: text("ingested_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    // Indexes for common queries
    index("idx_torrents_cleaned_title").on(table.cleanedParsedTitle),
    index("idx_torrents_imdb_id").on(table.imdbId),
    index("idx_torrents_year").on(table.year),
    index("idx_torrents_is_adult").on(table.isAdult),
    index("idx_torrents_trash").on(table.trash),
    index("idx_torrents_category").on(table.category),
    index("idx_torrents_ingested_at").on(table.ingestedAt),
  ]
);

// IMDB metadata cache
export const imdbFiles = sqliteTable(
  "imdb_files",
  {
    imdbId: text("imdb_id").primaryKey(),
    category: text("category"),
    title: text("title").notNull(),
    adult: integer("adult", { mode: "boolean" }).default(false),
    year: integer("year"),
  },
  (table) => [
    index("idx_imdb_title").on(table.title),
    index("idx_imdb_year").on(table.year),
    index("idx_imdb_category").on(table.category),
  ]
);

// Blacklisted torrents
export const blacklistedItems = sqliteTable("blacklisted_items", {
  infoHash: text("info_hash").primaryKey(),
  reason: text("reason"),
  blacklistedAt: text("blacklisted_at").$defaultFn(() => new Date().toISOString()),
});

// DMM import progress tracking
export const parsedPages = sqliteTable("parsed_pages", {
  page: integer("page").primaryKey(),
  entryCount: integer("entry_count").default(0),
  parsedAt: text("parsed_at").$defaultFn(() => new Date().toISOString()),
});

// Generic key-value metadata storage
export const importMetadata = sqliteTable("import_metadata", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// Type exports for use throughout the app
export type Torrent = typeof torrents.$inferSelect;
export type NewTorrent = typeof torrents.$inferInsert;
export type ImdbFile = typeof imdbFiles.$inferSelect;
export type NewImdbFile = typeof imdbFiles.$inferInsert;
export type BlacklistedItem = typeof blacklistedItems.$inferSelect;
export type NewBlacklistedItem = typeof blacklistedItems.$inferInsert;
export type ParsedPage = typeof parsedPages.$inferSelect;
export type ImportMetadataEntry = typeof importMetadata.$inferSelect;
