import { parse as parseHtml } from "node-html-parser";
import { parseTorrentNames } from "../parsers/torrent-name";
import { storeTorrents, getExistingHashes } from "../services/torrent.service";
import { getParsedPageNumbers, markPageParsed, updateLastSyncTime } from "../services/metadata.service";
import { getConfig } from "../config";

// DMM GitHub repository base URL
const DMM_BASE_URL = "https://raw.githubusercontent.com/debridmediamanager/hashlists/main";

// Interface for torrent entries extracted from DMM
interface DmmEntry {
  infoHash: string;
  title: string;
  size?: string;
}

/**
 * Fetch available pages from DMM repository
 */
async function fetchAvailablePages(): Promise<number[]> {
  const indexUrl = `${DMM_BASE_URL}/index.html`;

  try {
    const response = await fetch(indexUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch index: ${response.status}`);
    }

    const html = await response.text();
    const root = parseHtml(html);

    // Find all links to page files
    const links = root.querySelectorAll("a[href]");
    const pages: number[] = [];

    for (const link of links) {
      const href = link.getAttribute("href");
      if (href) {
        // Match pattern like "page_1.html" or "1.html"
        const match = href.match(/(?:page_)?(\d+)\.html/);
        if (match) {
          pages.push(parseInt(match[1], 10));
        }
      }
    }

    return pages.sort((a, b) => a - b);
  } catch (error) {
    console.error("Failed to fetch available pages:", error);
    return [];
  }
}

/**
 * Fetch and parse a single page from DMM
 */
async function fetchPage(pageNumber: number): Promise<DmmEntry[]> {
  const pageUrl = `${DMM_BASE_URL}/${pageNumber}.html`;

  try {
    const response = await fetch(pageUrl);
    if (!response.ok) {
      if (response.status === 404) {
        // Try alternate naming
        const altUrl = `${DMM_BASE_URL}/page_${pageNumber}.html`;
        const altResponse = await fetch(altUrl);
        if (!altResponse.ok) {
          console.warn(`Page ${pageNumber} not found`);
          return [];
        }
        return parseDmmHtml(await altResponse.text());
      }
      throw new Error(`Failed to fetch page ${pageNumber}: ${response.status}`);
    }

    return parseDmmHtml(await response.text());
  } catch (error) {
    console.error(`Error fetching page ${pageNumber}:`, error);
    return [];
  }
}

/**
 * Parse DMM HTML content to extract torrent entries
 */
function parseDmmHtml(html: string): DmmEntry[] {
  const entries: DmmEntry[] = [];
  const root = parseHtml(html);

  // DMM format: each torrent is usually in a table row or list item
  // Common patterns:
  // 1. <tr><td>hash</td><td>title</td><td>size</td></tr>
  // 2. <li data-hash="...">title</li>
  // 3. JSON embedded in script tags

  // Try parsing as table rows
  const tableRows = root.querySelectorAll("tr");
  for (const row of tableRows) {
    const cells = row.querySelectorAll("td");
    if (cells.length >= 2) {
      const hash = cells[0]?.text?.trim();
      const title = cells[1]?.text?.trim();
      const size = cells[2]?.text?.trim();

      if (hash && title && /^[a-f0-9]{40}$/i.test(hash)) {
        entries.push({ infoHash: hash.toLowerCase(), title, size });
      }
    }
  }

  // Try parsing list items with data-hash attribute
  const listItems = root.querySelectorAll("[data-hash]");
  for (const item of listItems) {
    const hash = item.getAttribute("data-hash");
    const title = item.text?.trim() || item.getAttribute("title");
    const size = item.getAttribute("data-size");

    if (hash && title && /^[a-f0-9]{40}$/i.test(hash)) {
      entries.push({ infoHash: hash.toLowerCase(), title, size: size || undefined });
    }
  }

  // Try parsing magnet links
  const magnetLinks = root.querySelectorAll("a[href^='magnet:']");
  for (const link of magnetLinks) {
    const href = link.getAttribute("href");
    if (href) {
      const hashMatch = href.match(/btih:([a-f0-9]{40})/i);
      const titleMatch = href.match(/dn=([^&]+)/);

      if (hashMatch) {
        const hash = hashMatch[1].toLowerCase();
        const title = titleMatch
          ? decodeURIComponent(titleMatch[1].replace(/\+/g, " "))
          : link.text?.trim();

        if (title) {
          entries.push({ infoHash: hash, title });
        }
      }
    }
  }

  // Try parsing JSON data embedded in the page
  const scripts = root.querySelectorAll("script");
  for (const script of scripts) {
    const content = script.text;
    // Look for JSON arrays of torrents
    const jsonMatch = content.match(/\[[\s\S]*?\{[\s\S]*?"hash"[\s\S]*?\}[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]) as Array<{ hash?: string; title?: string; name?: string; size?: string }>;
        for (const item of data) {
          const hash = item.hash;
          const title = item.title || item.name;
          if (hash && title && /^[a-f0-9]{40}$/i.test(hash)) {
            entries.push({
              infoHash: hash.toLowerCase(),
              title,
              size: item.size,
            });
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  // Deduplicate by hash
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.infoHash)) return false;
    seen.add(e.infoHash);
    return true;
  });
}

/**
 * Run DMM sync job
 */
export async function runDmmSync(): Promise<{
  pagesProcessed: number;
  entriesFound: number;
  entriesStored: number;
}> {
  console.log("Starting DMM sync...");

  const config = getConfig();
  if (!config.dmm.enableScraping) {
    console.log("DMM scraping is disabled");
    return { pagesProcessed: 0, entriesFound: 0, entriesStored: 0 };
  }

  // Get available and already parsed pages
  const [availablePages, parsedPages] = await Promise.all([
    fetchAvailablePages(),
    getParsedPageNumbers(),
  ]);

  // Find new pages to process
  const newPages = availablePages.filter((p) => !parsedPages.has(p));

  if (newPages.length === 0) {
    console.log("No new DMM pages to process");
    return { pagesProcessed: 0, entriesFound: 0, entriesStored: 0 };
  }

  console.log(`Found ${newPages.length} new pages to process`);

  let totalEntriesFound = 0;
  let totalEntriesStored = 0;

  // Process pages in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < newPages.length; i += BATCH_SIZE) {
    const batch = newPages.slice(i, i + BATCH_SIZE);

    // Fetch pages in parallel
    const results = await Promise.all(batch.map((p) => fetchPage(p)));

    for (let j = 0; j < batch.length; j++) {
      const pageNum = batch[j];
      const entries = results[j];

      if (entries.length === 0) {
        // Still mark as parsed to avoid re-fetching
        await markPageParsed(pageNum, 0);
        continue;
      }

      totalEntriesFound += entries.length;

      // Filter out existing hashes
      const hashes = entries.map((e) => e.infoHash);
      const existing = await getExistingHashes(hashes);
      const newEntries = entries.filter((e) => !existing.has(e.infoHash));

      if (newEntries.length > 0) {
        // Parse torrent names and store
        const parsed = parseTorrentNames(
          newEntries.map((e) => ({ infoHash: e.infoHash, title: e.title }))
        );

        // Add size if available
        for (let k = 0; k < parsed.length; k++) {
          if (newEntries[k].size) {
            parsed[k].size = newEntries[k].size ?? null;
          }
        }

        const result = await storeTorrents(parsed);
        totalEntriesStored += result.inserted;
      }

      // Mark page as parsed
      await markPageParsed(pageNum, entries.length);
      console.log(`Processed page ${pageNum}: ${entries.length} entries, ${newEntries.length} new`);
    }
  }

  // Update last sync time
  await updateLastSyncTime("dmm");

  console.log(`DMM sync complete: ${newPages.length} pages, ${totalEntriesFound} found, ${totalEntriesStored} stored`);

  return {
    pagesProcessed: newPages.length,
    entriesFound: totalEntriesFound,
    entriesStored: totalEntriesStored,
  };
}
