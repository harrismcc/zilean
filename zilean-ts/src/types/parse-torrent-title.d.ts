declare module "parse-torrent-title" {
  interface ParseResult {
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

  function parse(title: string): ParseResult;

  export = { parse };
}
