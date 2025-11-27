import { parseTorrentNames } from "../parsers/torrent-name";
import { storeTorrents, getExistingHashes } from "../services/torrent.service";
import { updateLastSyncTime } from "../services/metadata.service";
import { getConfig, type GenericEndpoint } from "../config";

// Interface for torrent data from external sources
interface ExternalTorrent {
  infoHash?: string;
  hash?: string;
  info_hash?: string;
  rawTitle?: string;
  title?: string;
  name?: string;
  raw_title?: string;
  size?: string;
  sizeBytes?: string;
  size_bytes?: string;
}

/**
 * Normalize torrent data from various formats
 */
function normalizeTorrent(data: ExternalTorrent): { infoHash: string; title: string; size?: string } | null {
  const infoHash = (data.infoHash || data.hash || data.info_hash || "").toLowerCase();
  const title = data.rawTitle || data.title || data.name || data.raw_title || "";
  const size = data.size || data.sizeBytes || data.size_bytes;

  if (!infoHash || !title || !/^[a-f0-9]{40}$/.test(infoHash)) {
    return null;
  }

  return { infoHash, title, size };
}

/**
 * Fetch torrents from a Zurg instance
 */
async function fetchFromZurg(
  endpoint: GenericEndpoint,
  suffix: string
): Promise<Array<{ infoHash: string; title: string; size?: string }>> {
  const url = `${endpoint.url.replace(/\/$/, "")}${suffix}`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (endpoint.apiKey) {
      headers["X-API-KEY"] = endpoint.apiKey;
    }

    const config = getConfig();
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(config.ingestion.requestTimeout),
    });

    if (!response.ok) {
      console.warn(`Zurg ${endpoint.name} returned ${response.status}`);
      return [];
    }

    const data = await response.json() as Record<string, ExternalTorrent> | ExternalTorrent[];

    // Handle both array and object responses
    const torrents: Array<{ infoHash: string; title: string; size?: string }> = [];

    if (Array.isArray(data)) {
      for (const item of data) {
        const normalized = normalizeTorrent(item);
        if (normalized) torrents.push(normalized);
      }
    } else if (typeof data === "object") {
      // Zurg typically returns { hash: { ... }, hash2: { ... } }
      for (const [hash, item] of Object.entries(data)) {
        const normalized = normalizeTorrent({ ...item, infoHash: hash });
        if (normalized) torrents.push(normalized);
      }
    }

    return torrents;
  } catch (error) {
    console.error(`Error fetching from Zurg ${endpoint.name}:`, error);
    return [];
  }
}

/**
 * Fetch torrents from another Zilean instance (streaming JSON)
 */
async function fetchFromZilean(
  endpoint: GenericEndpoint,
  suffix: string
): Promise<Array<{ infoHash: string; title: string; size?: string }>> {
  const url = `${endpoint.url.replace(/\/$/, "")}${suffix}`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (endpoint.apiKey) {
      headers["X-API-KEY"] = endpoint.apiKey;
    }

    const config = getConfig();
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(config.ingestion.requestTimeout),
    });

    if (!response.ok) {
      console.warn(`Zilean ${endpoint.name} returned ${response.status}`);
      return [];
    }

    // Parse streaming JSON (array format)
    const text = await response.text();
    const data = JSON.parse(text) as ExternalTorrent[];

    const torrents: Array<{ infoHash: string; title: string; size?: string }> = [];
    for (const item of data) {
      const normalized = normalizeTorrent(item);
      if (normalized) torrents.push(normalized);
    }

    return torrents;
  } catch (error) {
    console.error(`Error fetching from Zilean ${endpoint.name}:`, error);
    return [];
  }
}

/**
 * Fetch from a generic HTTP endpoint
 */
async function fetchFromGeneric(
  endpoint: GenericEndpoint
): Promise<Array<{ infoHash: string; title: string; size?: string }>> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (endpoint.apiKey) {
      headers["X-API-KEY"] = endpoint.apiKey;
      headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
    }

    const config = getConfig();
    const response = await fetch(endpoint.url, {
      headers,
      signal: AbortSignal.timeout(config.ingestion.requestTimeout),
    });

    if (!response.ok) {
      console.warn(`Generic ${endpoint.name} returned ${response.status}`);
      return [];
    }

    const text = await response.text();
    let data: unknown;

    try {
      data = JSON.parse(text);
    } catch {
      // Try to parse as newline-delimited JSON
      const lines = text.split("\n").filter(Boolean);
      data = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    }

    const torrents: Array<{ infoHash: string; title: string; size?: string }> = [];

    if (Array.isArray(data)) {
      for (const item of data) {
        const normalized = normalizeTorrent(item as ExternalTorrent);
        if (normalized) torrents.push(normalized);
      }
    } else if (typeof data === "object" && data !== null) {
      // Handle nested structures
      const values = Object.values(data as Record<string, ExternalTorrent>);
      for (const item of values) {
        if (typeof item === "object") {
          const normalized = normalizeTorrent(item);
          if (normalized) torrents.push(normalized);
        }
      }
    }

    return torrents;
  } catch (error) {
    console.error(`Error fetching from generic ${endpoint.name}:`, error);
    return [];
  }
}

/**
 * Process and store torrents from an endpoint
 */
async function processEndpointTorrents(
  torrents: Array<{ infoHash: string; title: string; size?: string }>,
  endpointName: string
): Promise<{ found: number; stored: number }> {
  if (torrents.length === 0) {
    return { found: 0, stored: 0 };
  }

  // Filter out existing hashes
  const hashes = torrents.map((t) => t.infoHash);
  const existing = await getExistingHashes(hashes);
  const newTorrents = torrents.filter((t) => !existing.has(t.infoHash));

  if (newTorrents.length === 0) {
    console.log(`${endpointName}: ${torrents.length} found, 0 new`);
    return { found: torrents.length, stored: 0 };
  }

  // Parse and store in batches
  const BATCH_SIZE = 5000;
  let stored = 0;

  for (let i = 0; i < newTorrents.length; i += BATCH_SIZE) {
    const batch = newTorrents.slice(i, i + BATCH_SIZE);
    const parsed = parseTorrentNames(
      batch.map((t) => ({ infoHash: t.infoHash, title: t.title }))
    );

    // Add size if available
    for (let j = 0; j < parsed.length; j++) {
      if (batch[j].size) {
        parsed[j].size = batch[j].size ?? null;
      }
    }

    const result = await storeTorrents(parsed);
    stored += result.inserted;
  }

  console.log(`${endpointName}: ${torrents.length} found, ${stored} stored`);
  return { found: torrents.length, stored };
}

/**
 * Run generic ingestion sync
 */
export async function runGenericSync(): Promise<{
  endpointsProcessed: number;
  totalFound: number;
  totalStored: number;
}> {
  console.log("Starting generic ingestion sync...");

  const config = getConfig();
  if (!config.ingestion.enableScraping) {
    console.log("Generic ingestion is disabled");
    return { endpointsProcessed: 0, totalFound: 0, totalStored: 0 };
  }

  let endpointsProcessed = 0;
  let totalFound = 0;
  let totalStored = 0;

  // Process Zurg instances
  for (const endpoint of config.ingestion.zurgInstances) {
    console.log(`Processing Zurg: ${endpoint.name}`);
    const torrents = await fetchFromZurg(
      endpoint,
      config.ingestion.zurgEndpointSuffix
    );
    const result = await processEndpointTorrents(torrents, `Zurg:${endpoint.name}`);
    totalFound += result.found;
    totalStored += result.stored;
    endpointsProcessed++;
  }

  // Process Zilean instances
  for (const endpoint of config.ingestion.zileanInstances) {
    console.log(`Processing Zilean: ${endpoint.name}`);
    const torrents = await fetchFromZilean(
      endpoint,
      config.ingestion.zileanEndpointSuffix
    );
    const result = await processEndpointTorrents(torrents, `Zilean:${endpoint.name}`);
    totalFound += result.found;
    totalStored += result.stored;
    endpointsProcessed++;
  }

  // Process generic endpoints
  for (const endpoint of config.ingestion.genericEndpoints) {
    console.log(`Processing generic: ${endpoint.name}`);
    const torrents = await fetchFromGeneric(endpoint);
    const result = await processEndpointTorrents(torrents, `Generic:${endpoint.name}`);
    totalFound += result.found;
    totalStored += result.stored;
    endpointsProcessed++;
  }

  // Update last sync time
  await updateLastSyncTime("generic");

  console.log(
    `Generic sync complete: ${endpointsProcessed} endpoints, ${totalFound} found, ${totalStored} stored`
  );

  return {
    endpointsProcessed,
    totalFound,
    totalStored,
  };
}
