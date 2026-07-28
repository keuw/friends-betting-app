export async function isAuthorizedExportRequest(
  request: Request,
  expectedSecret: string,
): Promise<boolean> {
  if (!expectedSecret) {
    return false;
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const receivedSecret = authorization.slice("Bearer ".length);
  if (!receivedSecret) {
    return false;
  }
  const [receivedDigest, expectedDigest] = await Promise.all([
    sha256(receivedSecret),
    sha256(expectedSecret),
  ]);
  let difference = 0;
  for (let index = 0; index < receivedDigest.length; index += 1) {
    difference |= receivedDigest[index]! ^ expectedDigest[index]!;
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}
