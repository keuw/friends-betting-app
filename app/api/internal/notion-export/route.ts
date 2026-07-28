import { env } from "cloudflare:workers";
import { NotionClient } from "@/lib/notion-export";
import { handleNotionExportRequest } from "@/lib/notion-export-handler";
import { D1ExportRepository } from "@/lib/notion-export-repository";
import { runMatchedBetExport } from "@/lib/notion-export-run";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleNotionExportRequest(
    request,
    {
      exportSecret: env.NOTION_EXPORT_SECRET ?? "",
      notionToken: env.NOTION_TOKEN ?? "",
      notionDataSourceId: env.NOTION_DATA_SOURCE_ID ?? "",
      appUrl: env.SIDEBET_APP_URL ?? "",
    },
    () =>
      runMatchedBetExport({
      repository: new D1ExportRepository(),
      client: new NotionClient({
        token: env.NOTION_TOKEN,
        dataSourceId: env.NOTION_DATA_SOURCE_ID,
      }),
      appUrl: env.SIDEBET_APP_URL,
      }),
  );
}
