const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;

if (!token || !dataSourceId) {
  throw new Error(
    "NOTION_TOKEN and NOTION_DATA_SOURCE_ID must be set in the process environment.",
  );
}

const response = await fetch(
  `https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2026-03-11",
    },
    body: JSON.stringify({
      properties: {
        "Maker Position": {
          select: {
            options: [
              { name: "back", color: "green" },
              { name: "fade", color: "orange" },
            ],
          },
        },
      },
    }),
  },
);

if (!response.ok) {
  throw new Error(
    `Notion archive reconciliation failed with status ${response.status}. Check the connection capabilities and data-source access.`,
  );
}

const body = await response.json();
if (
  body.object !== "data_source" ||
  !body.properties?.["Maker Position"]
) {
  throw new Error("Notion did not confirm the Maker Position property.");
}

console.log(
  JSON.stringify(
    {
      dataSourceId: body.id,
      reconciledProperties: ["Maker Position"],
    },
    null,
    2,
  ),
);
