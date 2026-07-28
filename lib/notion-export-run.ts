import {
  exportBetToNotion,
  type MatchedBetExport,
  type NotionExportOutcome,
  type NotionExportState,
  type NotionPageWriter,
} from "@/lib/notion-export";

export type ExportRunStatus = "succeeded" | "partial" | "failed";

export type ExportRunSummary = {
  runId: string;
  status: ExportRunStatus;
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
};

export interface ExportRepository {
  beginRun(startedAt: string): Promise<string>;
  listMatchedBets(): Promise<MatchedBetExport[]>;
  getExportState(betId: string): Promise<NotionExportState | null>;
  recordSuccess(input: {
    runId: string;
    betId: string;
    notionPageId: string;
    payloadHash: string;
    outcome: NotionExportOutcome["outcome"];
    exportedAt: string;
  }): Promise<void>;
  recordFailure(input: {
    runId: string;
    betId: string;
    error: string;
    failedAt: string;
  }): Promise<void>;
  finishRun(input: ExportRunSummary & { finishedAt: string }): Promise<void>;
}

export class ExportAlreadyRunningError extends Error {
  constructor() {
    super("A matched-bet export is already running.");
    this.name = "ExportAlreadyRunningError";
  }
}

export async function runMatchedBetExport({
  repository,
  client,
  appUrl,
  now = () => new Date(),
}: {
  repository: ExportRepository;
  client: NotionPageWriter;
  appUrl: string;
  now?: () => Date;
}): Promise<ExportRunSummary> {
  const startedAt = now().toISOString();
  const runId = await repository.beginRun(startedAt);
  const summary: ExportRunSummary = {
    runId,
    status: "succeeded",
    scanned: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
  };

  try {
    const bets = await repository.listMatchedBets();
    summary.scanned = bets.length;
    for (const bet of bets) {
      const exportedAt = now().toISOString();
      try {
        const existing = await repository.getExportState(bet.betId);
        const result = await exportBetToNotion({
          bet,
          existing,
          client,
          exportedAt,
          appUrl,
        });
        summary[result.outcome] += 1;
        await repository.recordSuccess({
          runId,
          betId: bet.betId,
          notionPageId: result.notionPageId,
          payloadHash: result.payloadHash,
          outcome: result.outcome,
          exportedAt,
        });
      } catch (error) {
        summary.failed += 1;
        await repository.recordFailure({
          runId,
          betId: bet.betId,
          error: redactExportError(error),
          failedAt: now().toISOString(),
        });
      }
    }
    summary.status = summary.failed > 0 ? "partial" : "succeeded";
  } catch {
    summary.status = "failed";
    summary.failed = Math.max(summary.failed, 1);
  }

  await repository.finishRun({
    ...summary,
    finishedAt: now().toISOString(),
  });
  return summary;
}

function redactExportError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "NotionApiError"
      ? error.message.slice(0, 300)
      : "Matched-bet export failed.";
  }
  return "Matched-bet export failed.";
}
