declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    NOTION_TOKEN: string;
    NOTION_DATA_SOURCE_ID: string;
    NOTION_EXPORT_SECRET: string;
    SIDEBET_APP_URL: string;
  }
}
