import type {
  BetRevisionStatus,
  BetStatus,
  ParlayPosition,
  Selection,
} from "@/lib/contracts";

export type ExportLegResult = "pending" | "won" | "lost" | "void";

export type MatchedBetExportLeg = {
  marketRevisionId: string;
  marketRevisionNumber: number;
  question: string;
  makerSelection: Selection;
  makerSelectionLabel: string;
  closesAt: string;
  result: ExportLegResult;
};

export type MatchedBetExportRevision = {
  revisionNumber: number;
  makerPosition: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  proposerName: string;
  recipientName: string;
  status: BetRevisionStatus;
  changeNote: string;
  createdAt: string;
  respondedAt: string | null;
  legs: MatchedBetExportLeg[];
};

export type MatchedBetExport = {
  betId: string;
  makerName: string;
  takerName: string;
  makerPosition: ParlayPosition;
  makerRiskCents: number;
  takerRiskCents: number;
  status: BetStatus;
  acceptedAt: string;
  settledAt: string | null;
  activeRevisionNumber: number;
  legs: MatchedBetExportLeg[];
  revisions: MatchedBetExportRevision[];
};

type NotionRichText = Array<{
  type: "text";
  text: { content: string };
}>;

export type NotionPageProperties = Record<
  string,
  | { type: "title"; title: NotionRichText }
  | { type: "rich_text"; rich_text: NotionRichText }
  | { type: "number"; number: number }
  | { type: "select"; select: { name: string } }
  | { type: "date"; date: { start: string } | null }
  | { type: "url"; url: string | null }
>;

export type NotionExportState = {
  notionPageId: string | null;
  payloadHash: string | null;
};

export type NotionExportOutcome = {
  outcome: "created" | "updated" | "unchanged";
  notionPageId: string;
  payloadHash: string;
};

export interface NotionPageWriter {
  findPageByBetId(betId: string): Promise<string | null>;
  createPage(properties: NotionPageProperties): Promise<string>;
  updatePage(
    pageId: string,
    properties: NotionPageProperties,
  ): Promise<void>;
}

type Fetch = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type NotionClientOptions = {
  token: string;
  dataSourceId: string;
  fetch?: Fetch;
  sleep?: Sleep;
  requestTimeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;
};

type NotionQueryResponse = {
  results?: Array<{ id?: unknown }>;
  has_more?: unknown;
  next_cursor?: unknown;
};

const NOTION_API_VERSION = "2026-03-11";
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const RICH_TEXT_CHUNK_SIZE = 1_900;
const MAX_QUERY_PAGES = 20;

export class NotionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

export class NotionClient implements NotionPageWriter {
  private readonly fetchImpl: Fetch;
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;

  constructor(private readonly options: NotionClientOptions) {
    if (!options.token || !options.dataSourceId) {
      throw new Error("Notion token and data-source ID are required.");
    }
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseUrl = options.baseUrl ?? "https://api.notion.com";
  }

  async findPageByBetId(betId: string): Promise<string | null> {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
      const body: Record<string, unknown> = {
        page_size: 100,
        filter: {
          property: "Sidebet Bet ID",
          rich_text: { equals: redactEmails(betId) },
        },
      };
      if (cursor) {
        body.start_cursor = cursor;
      }
      const result = await this.request<NotionQueryResponse>(
        `/v1/data_sources/${encodeURIComponent(this.options.dataSourceId)}/query`,
        { method: "POST", body: JSON.stringify(body) },
      );
      const match = result.results?.find(
        (item): item is { id: string } => typeof item.id === "string",
      );
      if (match) {
        return match.id;
      }
      if (result.has_more !== true || typeof result.next_cursor !== "string") {
        return null;
      }
      cursor = result.next_cursor;
    }
    throw new Error("Notion lookup exceeded the pagination safety limit.");
  }

  async createPage(properties: NotionPageProperties): Promise<string> {
    const page = await this.request<{ id?: unknown }>("/v1/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: {
          type: "data_source_id",
          data_source_id: this.options.dataSourceId,
        },
        properties,
      }),
    });
    if (typeof page.id !== "string") {
      throw new Error("Notion returned an invalid page response.");
    }
    return page.id;
  }

  async updatePage(
    pageId: string,
    properties: NotionPageProperties,
  ): Promise<void> {
    await this.request(`/v1/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
  }

  private async request<T>(
    path: string,
    init: Pick<RequestInit, "method" | "body">,
  ): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            "Content-Type": "application/json",
            "Notion-Version": NOTION_API_VERSION,
          },
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMilliseconds(attempt));
          continue;
        }
        throw new Error("Notion request failed before receiving a response.", {
          cause: error,
        });
      }
      clearTimeout(timeout);

      if (response.ok) {
        return (await response.json()) as T;
      }
      if (isRetryable(response.status) && attempt < this.maxRetries) {
        await this.sleep(retryDelayMilliseconds(response, attempt));
        continue;
      }
      throw new NotionApiError(
        response.status,
        `Notion request failed with status ${response.status}.`,
      );
    }
    throw new Error("Notion request exhausted its retry budget.");
  }
}

export function canonicalizeMatchedBet(bet: MatchedBetExport): string {
  return stableJson(sanitizeMatchedBet(bet));
}

export async function hashExportPayload(
  canonicalPayload: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPayload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function notionPropertiesForBet(
  bet: MatchedBetExport,
  exportedAt: string,
  appUrl: string,
): NotionPageProperties {
  const sanitized = sanitizeMatchedBet(bet);
  return {
    Bet: title(`${sanitized.makerName} vs ${sanitized.takerName}`),
    "Sidebet Bet ID": richText(sanitized.betId),
    Maker: richText(sanitized.makerName),
    Taker: richText(sanitized.takerName),
    "Maker Risk": {
      type: "number",
      number: sanitized.makerRiskCents / 100,
    },
    "Taker Risk": {
      type: "number",
      number: sanitized.takerRiskCents / 100,
    },
    "Maker Position": {
      type: "select",
      select: { name: sanitized.makerPosition },
    },
    Status: { type: "select", select: { name: sanitized.status } },
    "Matched At": {
      type: "date",
      date: { start: sanitized.acceptedAt },
    },
    "Settled At": sanitized.settledAt
      ? { type: "date", date: { start: sanitized.settledAt } }
      : { type: "date", date: null },
    "Active Revision": {
      type: "number",
      number: sanitized.activeRevisionNumber,
    },
    "Leg Count": { type: "number", number: sanitized.legs.length },
    "Active Terms": richText(renderActiveTerms(sanitized)),
    Legs: richText(renderLegs(sanitized.legs)),
    "Revision History": richText(renderRevisionHistory(sanitized)),
    "Last Exported": {
      type: "date",
      date: { start: exportedAt },
    },
    "Sidebet URL": { type: "url", url: normalizeAppUrl(appUrl) },
  };
}

export async function exportBetToNotion({
  bet,
  existing,
  client,
  exportedAt,
  appUrl,
}: {
  bet: MatchedBetExport;
  existing: NotionExportState | null;
  client: NotionPageWriter;
  exportedAt: string;
  appUrl: string;
}): Promise<NotionExportOutcome> {
  const payloadHash = await hashExportPayload(canonicalizeMatchedBet(bet));
  if (
    existing?.notionPageId &&
    existing.payloadHash === payloadHash
  ) {
    return {
      outcome: "unchanged",
      notionPageId: existing.notionPageId,
      payloadHash,
    };
  }

  const properties = notionPropertiesForBet(bet, exportedAt, appUrl);
  const notionPageId =
    existing?.notionPageId ?? (await client.findPageByBetId(bet.betId));
  if (notionPageId) {
    await client.updatePage(notionPageId, properties);
    return { outcome: "updated", notionPageId, payloadHash };
  }

  const createdPageId = await client.createPage(properties);
  return {
    outcome: "created",
    notionPageId: createdPageId,
    payloadHash,
  };
}

function sanitizeMatchedBet(bet: MatchedBetExport): MatchedBetExport {
  const sanitizeLeg = (leg: MatchedBetExportLeg): MatchedBetExportLeg => ({
    ...leg,
    marketRevisionId: redactEmails(leg.marketRevisionId),
    question: redactEmails(leg.question),
    makerSelectionLabel: redactEmails(leg.makerSelectionLabel),
  });
  return {
    ...bet,
    betId: redactEmails(bet.betId),
    makerName: redactEmails(bet.makerName),
    takerName: redactEmails(bet.takerName),
    legs: [...bet.legs]
      .map(sanitizeLeg)
      .sort(compareLegs),
    revisions: [...bet.revisions]
      .map((revision) => ({
        ...revision,
        proposerName: redactEmails(revision.proposerName),
        recipientName: redactEmails(revision.recipientName),
        changeNote: redactEmails(revision.changeNote),
        legs: [...revision.legs].map(sanitizeLeg).sort(compareLegs),
      }))
      .sort(
        (left, right) => left.revisionNumber - right.revisionNumber,
      ),
  };
}

function compareLegs(
  left: MatchedBetExportLeg,
  right: MatchedBetExportLeg,
): number {
  return (
    left.closesAt.localeCompare(right.closesAt) ||
    left.marketRevisionId.localeCompare(right.marketRevisionId)
  );
}

function renderActiveTerms(bet: MatchedBetExport): string {
  const makerName = narrativeName(bet.makerName, "Maker");
  const takerName = narrativeName(bet.takerName, "Taker");
  return [
    `Revision ${bet.activeRevisionNumber}`,
    `${bet.makerName} risks ${formatDollars(bet.makerRiskCents)}`,
    `${bet.takerName} risks ${formatDollars(bet.takerRiskCents)}`,
    positionSummary(makerName, takerName, bet.makerPosition),
    winningRule(makerName, takerName, bet.makerPosition),
  ].join("\n");
}

function renderLegs(legs: MatchedBetExportLeg[]): string {
  if (legs.length === 0) {
    return "No legs recorded.";
  }
  return legs
    .map(
      (leg, index) =>
        [
          `${index + 1}. ${leg.question}`,
          `Parlay pick: ${leg.makerSelectionLabel} (${leg.makerSelection.toUpperCase()})`,
          `Market revision ${leg.marketRevisionNumber}`,
          `Closes ${leg.closesAt}`,
          `Result: ${leg.result}`,
        ].join(" | "),
    )
    .join("\n");
}

function renderRevisionHistory(
  bet: MatchedBetExport,
): string {
  const revisions = bet.revisions;
  if (revisions.length === 0) {
    return "No revision history recorded.";
  }
  return revisions
    .map((revision, index) => {
      const previous = revisions[index - 1];
      const makerName = narrativeName(bet.makerName, "Maker");
      const takerName = narrativeName(bet.takerName, "Taker");
      return [
        `Revision ${revision.revisionNumber} — ${revision.status}`,
        `${revision.proposerName} proposed to ${revision.recipientName}`,
        `${formatDollars(revision.makerRiskCents)} maker risk / ${formatDollars(revision.takerRiskCents)} taker risk`,
        previous
          ? `${makerName}: ${positionLabel(previous.makerPosition)} → ${positionLabel(revision.makerPosition)}; ${takerName}: ${positionLabel(oppositePosition(previous.makerPosition))} → ${positionLabel(oppositePosition(revision.makerPosition))}`
          : `${makerName}: ${positionLabel(revision.makerPosition)}; ${takerName}: ${positionLabel(oppositePosition(revision.makerPosition))}`,
        `Created ${revision.createdAt}`,
        `Responded ${revision.respondedAt ?? "not yet"}`,
        `Note: ${revision.changeNote}`,
        renderLegs(revision.legs),
      ].join("\n");
    })
    .join("\n\n");
}

function positionSummary(
  makerName: string,
  takerName: string,
  makerPosition: ParlayPosition,
): string {
  return makerPosition === "back"
    ? `${makerName} backs this parlay; ${takerName} fades this parlay.`
    : `${makerName} fades this parlay; ${takerName} backs this parlay.`;
}

function winningRule(
  makerName: string,
  takerName: string,
  makerPosition: ParlayPosition,
): string {
  return makerPosition === "back"
    ? `${makerName} wins if every non-void pick hits; ${takerName} wins if any pick misses.`
    : `${makerName} wins if any pick misses; ${takerName} wins if every non-void pick hits.`;
}

function positionLabel(position: ParlayPosition): string {
  return position === "back" ? "Back" : "Fade";
}

function oppositePosition(position: ParlayPosition): ParlayPosition {
  return position === "back" ? "fade" : "back";
}

function narrativeName(value: string, fallback: string): string {
  return value.replace(/\s*\[redacted\]\s*/gu, " ").trim() || fallback;
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function title(
  value: string,
): { type: "title"; title: NotionRichText } {
  return { type: "title", title: toRichText(value) };
}

function richText(
  value: string,
): { type: "rich_text"; rich_text: NotionRichText } {
  return { type: "rich_text", rich_text: toRichText(value) };
}

function toRichText(value: string): NotionRichText {
  const safeValue = redactEmails(value);
  const chunks =
    safeValue.match(new RegExp(`[\\s\\S]{1,${RICH_TEXT_CHUNK_SIZE}}`, "g")) ??
    [""];
  return chunks.map((content) => ({
    type: "text",
    text: { content },
  }));
}

function redactEmails(value: string): string {
  return value.replace(EMAIL_PATTERN, "[redacted]");
}

function normalizeAppUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const pairs = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1_000, 30_000);
  }
  return backoffMilliseconds(attempt);
}

function backoffMilliseconds(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000);
}
