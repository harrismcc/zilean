import type { TorrentSearchResult } from "../services/torrent.service";

/**
 * Escape special XML characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate magnet link from info hash
 */
function generateMagnetLink(infoHash: string, title: string): string {
  const encodedTitle = encodeURIComponent(title);
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodedTitle}`;
}

/**
 * Map category to Torznab category ID
 */
function getCategoryId(category: string | null): number {
  switch (category) {
    case "movie":
      return 2000; // Movies
    case "tvSeries":
      return 5000; // TV
    case "xxx":
      return 6000; // XXX
    default:
      return 7000; // Other
  }
}

/**
 * Generate Torznab capabilities XML
 */
export function generateCapsXml(baseUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="Zilean" strapline="Torrent Metadata Aggregator" />
  <limits max="200" default="100" />
  <retention days="3650" />
  <registration available="no" open="no" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep,imdbid" />
    <movie-search available="yes" supportedParams="q,imdbid" />
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2010" name="Movies/Foreign" />
      <subcat id="2020" name="Movies/Other" />
      <subcat id="2030" name="Movies/SD" />
      <subcat id="2040" name="Movies/HD" />
      <subcat id="2045" name="Movies/UHD" />
      <subcat id="2050" name="Movies/BluRay" />
      <subcat id="2060" name="Movies/3D" />
    </category>
    <category id="5000" name="TV">
      <subcat id="5010" name="TV/WEB-DL" />
      <subcat id="5020" name="TV/Foreign" />
      <subcat id="5030" name="TV/SD" />
      <subcat id="5040" name="TV/HD" />
      <subcat id="5045" name="TV/UHD" />
      <subcat id="5050" name="TV/Other" />
      <subcat id="5060" name="TV/Sport" />
      <subcat id="5070" name="TV/Anime" />
      <subcat id="5080" name="TV/Documentary" />
    </category>
    <category id="6000" name="XXX">
      <subcat id="6010" name="XXX/DVD" />
      <subcat id="6020" name="XXX/WMV" />
      <subcat id="6030" name="XXX/XviD" />
      <subcat id="6040" name="XXX/x264" />
      <subcat id="6050" name="XXX/Pack" />
      <subcat id="6060" name="XXX/Other" />
    </category>
    <category id="7000" name="Other">
      <subcat id="7010" name="Other/Misc" />
    </category>
  </categories>
</caps>`;
}

/**
 * Generate Torznab search results XML
 */
export function generateSearchResultsXml(
  results: TorrentSearchResult[],
  baseUrl: string
): string {
  const items = results
    .map((result) => {
      const magnetLink = generateMagnetLink(result.infoHash, result.rawTitle);
      const categoryId = getCategoryId(result.category);
      const title = escapeXml(result.rawTitle);
      const sizeBytes = result.sizeBytes || "0";

      // Build season/episode attributes
      let seasonAttr = "";
      let episodeAttr = "";
      if (result.seasons && result.seasons.length > 0) {
        seasonAttr = `<attr name="season" value="${result.seasons[0]}" />`;
      }
      if (result.episodes && result.episodes.length > 0) {
        episodeAttr = `<attr name="episode" value="${result.episodes[0]}" />`;
      }

      // Build IMDB attribute
      let imdbAttr = "";
      if (result.imdbId) {
        imdbAttr = `<attr name="imdbid" value="${result.imdbId}" />`;
      }

      return `
    <item>
      <title>${title}</title>
      <guid>${result.infoHash}</guid>
      <link>${escapeXml(magnetLink)}</link>
      <comments></comments>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <size>${sizeBytes}</size>
      <category>${categoryId}</category>
      <enclosure url="${escapeXml(magnetLink)}" length="${sizeBytes}" type="application/x-bittorrent" />
      <attr name="category" value="${categoryId}" />
      <attr name="size" value="${sizeBytes}" />
      <attr name="infohash" value="${result.infoHash}" />
      ${result.year ? `<attr name="year" value="${result.year}" />` : ""}
      ${result.resolution ? `<attr name="resolution" value="${result.resolution}" />` : ""}
      ${seasonAttr}
      ${episodeAttr}
      ${imdbAttr}
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel>
    <title>Zilean</title>
    <description>Torrent Metadata Aggregator</description>
    <link>${baseUrl}</link>
    <atom:link href="${baseUrl}/torznab/api" rel="self" type="application/rss+xml" />
    <newznab:response offset="0" total="${results.length}" />
    ${items}
  </channel>
</rss>`;
}

/**
 * Generate error XML for Torznab
 */
export function generateErrorXml(code: number, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<error code="${code}" description="${escapeXml(description)}" />`;
}
