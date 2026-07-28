const exportUrl = process.env.SIDEBET_EXPORT_URL;
const exportSecret = process.env.SIDEBET_EXPORT_SECRET;

if (!exportUrl || !exportSecret) {
  throw new Error(
    "SIDEBET_EXPORT_URL and SIDEBET_EXPORT_SECRET must be set in the process environment.",
  );
}

const url = new URL(exportUrl);
if (url.protocol !== "https:") {
  throw new Error("SIDEBET_EXPORT_URL must use HTTPS.");
}

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${exportSecret}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
const body = await response.json();
console.log(JSON.stringify(body, null, 2));
if (!response.ok) {
  process.exitCode = 1;
}
