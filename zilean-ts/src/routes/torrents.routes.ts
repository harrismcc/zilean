import { Hono } from "hono";
import { streamAllTorrents, checkCachedHashes, getTorrentCount } from "../services/torrent.service";
import { apiKeyAuth } from "../middleware/auth";
import { getConfig } from "../config";

const torrentsRouter = new Hono();

/**
 * GET /torrents/all - Stream all torrents as JSON
 * Requires API key authentication
 */
torrentsRouter.get("/all", apiKeyAuth, async (c) => {
  const config = getConfig();
  if (!config.torrents.enableEndpoint) {
    return c.json({ error: "Torrents endpoint is disabled" }, 503);
  }

  // Return streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let first = true;

      // Start JSON array
      controller.enqueue(encoder.encode("["));

      try {
        for await (const batch of streamAllTorrents(5000)) {
          for (const torrent of batch) {
            if (!first) {
              controller.enqueue(encoder.encode(","));
            }
            first = false;

            // Serialize torrent to JSON
            const json = JSON.stringify({
              infoHash: torrent.infoHash,
              rawTitle: torrent.rawTitle,
              parsedTitle: torrent.parsedTitle,
              category: torrent.category,
              imdbId: torrent.imdbId,
              year: torrent.year,
              resolution: torrent.resolution,
              quality: torrent.quality,
              seasons: torrent.seasons,
              episodes: torrent.episodes,
              languages: torrent.languages,
              size: torrent.size,
              sizeBytes: torrent.sizeBytes,
            });

            controller.enqueue(encoder.encode(json));
          }
        }
      } catch (error) {
        console.error("Error streaming torrents:", error);
      }

      // End JSON array
      controller.enqueue(encoder.encode("]"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
    },
  });
});

/**
 * GET /torrents/checkcached - Check if hashes exist in database
 * Requires API key authentication
 */
torrentsRouter.get("/checkcached", apiKeyAuth, async (c) => {
  const config = getConfig();
  if (!config.torrents.enableEndpoint) {
    return c.json({ error: "Torrents endpoint is disabled" }, 503);
  }

  const hashesParam = c.req.query("hashes");

  if (!hashesParam) {
    return c.json({ error: "Missing hashes parameter" }, 400);
  }

  const hashes = hashesParam.split(",").map((h) => h.trim()).filter(Boolean);

  if (hashes.length === 0) {
    return c.json({ error: "No valid hashes provided" }, 400);
  }

  if (hashes.length > config.torrents.maxHashesToCheck) {
    return c.json(
      {
        error: `Too many hashes. Maximum is ${config.torrents.maxHashesToCheck}`,
      },
      400
    );
  }

  try {
    const results = await checkCachedHashes(hashes);
    return c.json({
      results,
      cached: results.filter((r) => r.cached).length,
      total: results.length,
    });
  } catch (error) {
    console.error("Check cached error:", error);
    return c.json({ error: "Check failed" }, 500);
  }
});

/**
 * GET /torrents/count - Get total torrent count
 */
torrentsRouter.get("/count", async (c) => {
  const config = getConfig();
  if (!config.torrents.enableEndpoint) {
    return c.json({ error: "Torrents endpoint is disabled" }, 503);
  }

  try {
    const count = await getTorrentCount();
    return c.json({ count });
  } catch (error) {
    console.error("Count error:", error);
    return c.json({ error: "Count failed" }, 500);
  }
});

export default torrentsRouter;
