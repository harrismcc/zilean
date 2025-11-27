import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { blacklistedItems, torrents, type BlacklistedItem } from "../db/schema";

/**
 * Add a torrent to the blacklist
 */
export async function addToBlacklist(
  infoHash: string,
  reason?: string
): Promise<BlacklistedItem> {
  const db = getDb();
  const hash = infoHash.toLowerCase();

  // Check if already blacklisted
  const existing = await db
    .select()
    .from(blacklistedItems)
    .where(eq(blacklistedItems.infoHash, hash))
    .limit(1);

  if (existing.length > 0) {
    // Update reason if provided
    if (reason) {
      await db
        .update(blacklistedItems)
        .set({ reason })
        .where(eq(blacklistedItems.infoHash, hash));
    }
    return { ...existing[0], reason: reason || existing[0].reason };
  }

  // Insert new blacklist entry
  const result = await db
    .insert(blacklistedItems)
    .values({
      infoHash: hash,
      reason,
    })
    .returning();

  // Delete from torrents table if exists
  await db.delete(torrents).where(eq(torrents.infoHash, hash));

  return result[0];
}

/**
 * Remove a torrent from the blacklist
 */
export async function removeFromBlacklist(infoHash: string): Promise<boolean> {
  const db = getDb();
  const hash = infoHash.toLowerCase();

  const result = await db
    .delete(blacklistedItems)
    .where(eq(blacklistedItems.infoHash, hash))
    .returning();

  return result.length > 0;
}

/**
 * Check if a torrent is blacklisted
 */
export async function isBlacklisted(infoHash: string): Promise<boolean> {
  const db = getDb();
  const hash = infoHash.toLowerCase();

  const result = await db
    .select()
    .from(blacklistedItems)
    .where(eq(blacklistedItems.infoHash, hash))
    .limit(1);

  return result.length > 0;
}

/**
 * Get all blacklisted items
 */
export async function getBlacklistedItems(): Promise<BlacklistedItem[]> {
  const db = getDb();
  return db.select().from(blacklistedItems);
}

/**
 * Get blacklist count
 */
export async function getBlacklistCount(): Promise<number> {
  const db = getDb();
  const result = await db
    .select()
    .from(blacklistedItems);

  return result.length;
}

/**
 * Bulk add to blacklist
 */
export async function bulkAddToBlacklist(
  entries: Array<{ infoHash: string; reason?: string }>
): Promise<number> {
  const db = getDb();
  let added = 0;

  for (const entry of entries) {
    const hash = entry.infoHash.toLowerCase();

    // Check if already exists
    const existing = await db
      .select()
      .from(blacklistedItems)
      .where(eq(blacklistedItems.infoHash, hash))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(blacklistedItems).values({
        infoHash: hash,
        reason: entry.reason,
      });
      added++;
    }
  }

  // Delete blacklisted torrents from main table
  const hashes = entries.map(e => e.infoHash.toLowerCase());
  for (const hash of hashes) {
    await db.delete(torrents).where(eq(torrents.infoHash, hash));
  }

  return added;
}
