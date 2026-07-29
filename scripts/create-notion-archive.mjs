const token = process.env.NOTION_TOKEN;
const parentPageId = process.env.NOTION_PARENT_PAGE_ID;

if (!token || !parentPageId) {
  throw new Error(
    "NOTION_TOKEN and NOTION_PARENT_PAGE_ID must be set in the process environment.",
  );
}

const response = await fetch("https://api.notion.com/v1/databases", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": "2026-03-11",
  },
  body: JSON.stringify({
    parent: { type: "page_id", page_id: parentPageId },
    title: [
      {
        type: "text",
        text: { content: "Sidebet Matched Bets Archive" },
      },
    ],
    description: [
      {
        type: "text",
        text: {
          content:
            "Weekly, human-readable evidence of matched Sidebet bets. This is not a complete D1 backup.",
        },
      },
    ],
    is_inline: false,
    initial_data_source: {
      properties: {
        Bet: { title: {} },
        "Sidebet Bet ID": { rich_text: {} },
        Maker: { rich_text: {} },
        Taker: { rich_text: {} },
        "Maker Risk": { number: { format: "dollar" } },
        "Taker Risk": { number: { format: "dollar" } },
        "Maker Position": {
          select: {
            options: [
              { name: "back", color: "green" },
              { name: "fade", color: "orange" },
            ],
          },
        },
        Status: {
          select: {
            options: [
              { name: "pending", color: "yellow" },
              { name: "maker_won", color: "green" },
              { name: "taker_won", color: "blue" },
              { name: "void", color: "gray" },
            ],
          },
        },
        "Matched At": { date: {} },
        "Settled At": { date: {} },
        "Active Revision": { number: { format: "number" } },
        "Leg Count": { number: { format: "number" } },
        "Active Terms": { rich_text: {} },
        Legs: { rich_text: {} },
        "Revision History": { rich_text: {} },
        "Void History": { rich_text: {} },
        "Last Exported": { date: {} },
        "Sidebet URL": { url: {} },
      },
    },
  }),
});

const body = await response.json();
if (!response.ok) {
  throw new Error(
    `Notion archive creation failed with status ${response.status}. Check the connection capabilities and parent-page access.`,
  );
}

const dataSourceId = body.data_sources?.[0]?.id;
if (typeof body.id !== "string" || typeof dataSourceId !== "string") {
  throw new Error("Notion returned an invalid database response.");
}

console.log(
  JSON.stringify(
    {
      databaseId: body.id,
      dataSourceId,
      url: body.url,
    },
    null,
    2,
  ),
);
