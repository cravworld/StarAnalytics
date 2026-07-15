// StarAnalytics is marked Confidential on every screen — plain Google OAuth lets
// anyone with a Google account in, so login is gated by an allowlist.
//
// The mechanism ships now; the actual domain/email values are placeholders
// (see .env.example) that must be filled in before any real deployment.
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;

  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim();
  const explicitList = process.env.ALLOWED_EMAILS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!domain && (!explicitList || explicitList.length === 0)) {
    // No allowlist configured yet — fail closed rather than silently open.
    return false;
  }

  const normalized = email.toLowerCase();
  if (domain && normalized.endsWith(`@${domain.toLowerCase()}`)) return true;
  if (explicitList && explicitList.includes(normalized)) return true;
  return false;
}
