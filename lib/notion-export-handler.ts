import { isAuthorizedExportRequest } from "@/lib/notion-export-auth";
import {
  ExportAlreadyRunningError,
  type ExportRunSummary,
} from "@/lib/notion-export-run";

export type NotionExportConfig = {
  exportSecret: string;
  notionToken: string;
  notionDataSourceId: string;
  appUrl: string;
};

export async function handleNotionExportRequest(
  request: Request,
  config: NotionExportConfig,
  runExport: () => Promise<ExportRunSummary>,
): Promise<Response> {
  if (
    request.method !== "POST" ||
    !(await isAuthorizedExportRequest(request, config.exportSecret))
  ) {
    return Response.json(
      { error: { code: "UNAUTHORIZED" } },
      { status: 401 },
    );
  }
  if (
    !config.notionToken ||
    !config.notionDataSourceId ||
    !config.appUrl
  ) {
    return Response.json(
      { error: { code: "EXPORT_NOT_CONFIGURED" } },
      { status: 503 },
    );
  }

  try {
    const summary = await runExport();
    return Response.json(summary, {
      status: summary.status === "succeeded" ? 200 : 502,
    });
  } catch (error) {
    if (error instanceof ExportAlreadyRunningError) {
      return Response.json(
        { error: { code: "EXPORT_ALREADY_RUNNING" } },
        { status: 409 },
      );
    }
    return Response.json(
      { error: { code: "EXPORT_FAILED" } },
      { status: 500 },
    );
  }
}
