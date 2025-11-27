import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { parsedPages, importMetadata, type ParsedPage } from "../db/schema";

/**
 * Get parsed page info
 */
export async function getParsedPage(page: number): Promise<ParsedPage | null> {
  const db = getDb();
  const results = await db
    .select()
    .from(parsedPages)
    .where(eq(parsedPages.page, page))
    .limit(1);

  return results[0] || null;
}

/**
 * Mark page as parsed
 */
export async function markPageParsed(
  page: number,
  entryCount: number
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select()
    .from(parsedPages)
    .where(eq(parsedPages.page, page))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(parsedPages)
      .set({ entryCount, parsedAt: new Date() })
      .where(eq(parsedPages.page, page));
  } else {
    await db.insert(parsedPages).values({
      page,
      entryCount,
    });
  }
}

/**
 * Get all parsed pages
 */
export async function getAllParsedPages(): Promise<ParsedPage[]> {
  const db = getDb();
  return db.select().from(parsedPages);
}

/**
 * Get parsed page numbers as Set
 */
export async function getParsedPageNumbers(): Promise<Set<number>> {
  const db = getDb();
  const pages = await db.select({ page: parsedPages.page }).from(parsedPages);
  return new Set(pages.map(p => p.page));
}

/**
 * Clear parsed pages (for full resync)
 */
export async function clearParsedPages(): Promise<void> {
  const db = getDb();
  await db.delete(parsedPages);
}

// Import metadata operations

/**
 * Get metadata value by key
 */
export async function getMetadata<T>(key: string): Promise<T | null> {
  const db = getDb();
  const results = await db
    .select()
    .from(importMetadata)
    .where(eq(importMetadata.key, key))
    .limit(1);

  if (results.length === 0) return null;
  return results[0].value as T;
}

/**
 * Set metadata value
 */
export async function setMetadata<T>(key: string, value: T): Promise<void> {
  const db = getDb();

  const existing = await db
    .select()
    .from(importMetadata)
    .where(eq(importMetadata.key, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(importMetadata)
      .set({ value: value as object, updatedAt: new Date() })
      .where(eq(importMetadata.key, key));
  } else {
    await db.insert(importMetadata).values({
      key,
      value: value as object,
    });
  }
}

/**
 * Delete metadata by key
 */
export async function deleteMetadata(key: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(importMetadata)
    .where(eq(importMetadata.key, key))
    .returning();

  return result.length > 0;
}

/**
 * Common metadata keys
 */
export const MetadataKeys = {
  LAST_DMM_SYNC: "last_dmm_sync",
  LAST_GENERIC_SYNC: "last_generic_sync",
  DMM_SYNC_STATUS: "dmm_sync_status",
  GENERIC_SYNC_STATUS: "generic_sync_status",
} as const;

/**
 * Get last sync timestamp
 */
export async function getLastSyncTime(
  type: "dmm" | "generic"
): Promise<Date | null> {
  const key =
    type === "dmm" ? MetadataKeys.LAST_DMM_SYNC : MetadataKeys.LAST_GENERIC_SYNC;
  const timestamp = await getMetadata<string>(key);
  return timestamp ? new Date(timestamp) : null;
}

/**
 * Update last sync timestamp
 */
export async function updateLastSyncTime(type: "dmm" | "generic"): Promise<void> {
  const key =
    type === "dmm" ? MetadataKeys.LAST_DMM_SYNC : MetadataKeys.LAST_GENERIC_SYNC;
  await setMetadata(key, new Date().toISOString());
}
