export function isAdminEmail(
  email: string,
  configuredEmails: string | undefined,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !configuredEmails?.trim()) return false;

  return configuredEmails
    .split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedEmail);
}
