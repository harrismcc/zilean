import {
  pgTable,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Torrent categories
export type TorrentCategory = "movie" | "tvSeries" | "xxx" | "other";

// Main torrents table
export const torrents = pgTable(
  "torrents",
  {
    infoHash: varchar("info_hash", { length: 40 }).primaryKey(),
    rawTitle: text("raw_title").notNull(),
    parsedTitle: text("parsed_title"),
    normalizedTitle: text("normalized_title"),
    cleanedParsedTitle: text("cleaned_parsed_title"),

    // Content classification
    category: varchar("category", { length: 20 }).$type<TorrentCategory>(),
    imdbId: varchar("imdb_id", { length: 20 }),
    isAdult: boolean("is_adult").default(false),

    // Video properties
    year: integer("year"),
    resolution: varchar("resolution", { length: 20 }),
    quality: varchar("quality", { length: 50 }),
    codec: varchar("codec", { length: 50 }),
    hdr: jsonb("hdr").$type<string[]>(),
    bitDepth: integer("bit_depth"),

    // Audio
    audio: jsonb("audio").$type<string[]>(),
    channels: varchar("channels", { length: 20 }),
    languages: jsonb("languages").$type<string[]>(),

    // Series info
    seasons: jsonb("seasons").$type<number[]>(),
    episodes: jsonb("episodes").$type<number[]>(),
    volumes: jsonb("volumes").$type<number[]>(),

    // Content flags
    trash: boolean("trash").default(false),
    complete: boolean("complete").default(false),
    dubbed: boolean("dubbed").default(false),
    subbed: boolean("subbed").default(false),
    extended: boolean("extended").default(false),
    converted: boolean("converted").default(false),
    hardcoded: boolean("hardcoded").default(false),
    proper: boolean("proper").default(false),
    repack: boolean("repack").default(false),
    retail: boolean("retail").default(false),
    upscaled: boolean("upscaled").default(false),
    remastered: boolean("remastered").default(false),
    unrated: boolean("unrated").default(false),
    documentary: boolean("documentary").default(false),
    is3d: boolean("is_3d").default(false),
    ppv: boolean("ppv").default(false),

    // Other metadata
    releaseGroup: varchar("release_group", { length: 100 }),
    edition: varchar("edition", { length: 100 }),
    region: varchar("region", { length: 20 }),
    network: varchar("network", { length: 100 }),
    size: text("size"),
    sizeBytes: text("size_bytes"), // Using text for bigint compatibility
    site: varchar("site", { length: 100 }),
    container: varchar("container", { length: 20 }),
    extension: varchar("extension", { length: 20 }),
    country: varchar("country", { length: 50 }),

    // Timestamps
    ingestedAt: timestamp("ingested_at").defaultNow(),
  },
  (table) => [
    // Index for fuzzy text search (requires pg_trgm extension)
    index("idx_torrents_cleaned_title_trgm").using(
      "gin",
      sql`${table.cleanedParsedTitle} gin_trgm_ops`
    ),
    // Index for IMDB lookups
    index("idx_torrents_imdb_id").on(table.imdbId),
    // Index for year filtering
    index("idx_torrents_year").on(table.year),
    // Index for adult content filtering
    index("idx_torrents_is_adult").on(table.isAdult),
    // Index for trash filtering
    index("idx_torrents_trash").on(table.trash),
    // Index for ingestion date
    index("idx_torrents_ingested_at").on(table.ingestedAt),
    // GIN indexes for array columns
    index("idx_torrents_seasons").using("gin", table.seasons),
    index("idx_torrents_episodes").using("gin", table.episodes),
    index("idx_torrents_languages").using("gin", table.languages),
  ]
);

// IMDB metadata cache
export const imdbFiles = pgTable(
  "imdb_files",
  {
    imdbId: varchar("imdb_id", { length: 20 }).primaryKey(),
    category: varchar("category", { length: 20 }),
    title: text("title").notNull(),
    adult: boolean("adult").default(false),
    year: integer("year"),
  },
  (table) => [
    // Trigram index for fuzzy title search
    index("idx_imdb_title_trgm").using(
      "gin",
      sql`${table.title} gin_trgm_ops`
    ),
    index("idx_imdb_year").on(table.year),
    index("idx_imdb_category").on(table.category),
  ]
);

// Blacklisted torrents
export const blacklistedItems = pgTable("blacklisted_items", {
  infoHash: varchar("info_hash", { length: 40 }).primaryKey(),
  reason: text("reason"),
  blacklistedAt: timestamp("blacklisted_at").defaultNow(),
});

// DMM import progress tracking
export const parsedPages = pgTable("parsed_pages", {
  page: integer("page").primaryKey(),
  entryCount: integer("entry_count").default(0),
  parsedAt: timestamp("parsed_at").defaultNow(),
});

// Generic key-value metadata storage
export const importMetadata = pgTable("import_metadata", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
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
