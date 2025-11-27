import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  addToBlacklist,
  removeFromBlacklist,
  getBlacklistedItems,
  isBlacklisted,
} from "../services/blacklist.service";
import { apiKeyAuth } from "../middleware/auth";

const blacklist = new Hono();

// All blacklist routes require API key
blacklist.use("/*", apiKeyAuth);

// Add to blacklist schema
const addSchema = z.object({
  infoHash: z.string().length(40),
  reason: z.string().optional(),
});

// Remove from blacklist schema
const removeSchema = z.object({
  infoHash: z.string().length(40),
});

/**
 * GET /blacklist - Get all blacklisted items
 */
blacklist.get("/", async (c) => {
  try {
    const items = await getBlacklistedItems();
    return c.json({
      items,
      count: items.length,
    });
  } catch (error) {
    console.error("Get blacklist error:", error);
    return c.json({ error: "Failed to get blacklist" }, 500);
  }
});

/**
 * GET /blacklist/:hash - Check if hash is blacklisted
 */
blacklist.get("/:hash", async (c) => {
  const hash = c.req.param("hash");

  try {
    const blacklisted = await isBlacklisted(hash);
    return c.json({
      infoHash: hash,
      blacklisted,
    });
  } catch (error) {
    console.error("Check blacklist error:", error);
    return c.json({ error: "Check failed" }, 500);
  }
});

/**
 * PUT /blacklist/add - Add torrent to blacklist
 */
blacklist.put("/add", zValidator("json", addSchema), async (c) => {
  const { infoHash, reason } = c.req.valid("json");

  try {
    const item = await addToBlacklist(infoHash, reason);
    return c.json({
      status: "added",
      item,
    });
  } catch (error) {
    console.error("Add to blacklist error:", error);
    return c.json({ error: "Failed to add to blacklist" }, 500);
  }
});

/**
 * DELETE /blacklist/remove - Remove torrent from blacklist
 */
blacklist.delete("/remove", zValidator("json", removeSchema), async (c) => {
  const { infoHash } = c.req.valid("json");

  try {
    const removed = await removeFromBlacklist(infoHash);
    return c.json({
      status: removed ? "removed" : "not_found",
      infoHash,
    });
  } catch (error) {
    console.error("Remove from blacklist error:", error);
    return c.json({ error: "Failed to remove from blacklist" }, 500);
  }
});

export default blacklist;
