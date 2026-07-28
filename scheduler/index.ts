export type SchedulerEnv = {
  SIDEBET_EXPORT_URL: string;
  SIDEBET_EXPORT_SECRET: string;
};

type ScheduledController = {
  scheduledTime: number;
  cron: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export async function invokeWeeklyExport(
  env: SchedulerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(env.SIDEBET_EXPORT_URL);
  if (url.protocol !== "https:") {
    throw new Error("SIDEBET_EXPORT_URL must use HTTPS.");
  }
  if (!env.SIDEBET_EXPORT_SECRET) {
    throw new Error("SIDEBET_EXPORT_SECRET is required.");
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SIDEBET_EXPORT_SECRET}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Sidebet export failed with status ${response.status}.`);
  }
}

const scheduler = {
  async scheduled(
    _controller: ScheduledController,
    env: SchedulerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(invokeWeeklyExport(env));
  },
};

export default scheduler;
