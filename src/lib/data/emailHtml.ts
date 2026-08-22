/**
 * Shared bits for the HTML alert emails.
 *
 * Extracted from weeklyDigest.ts when the BookMyShow demand summary became a second
 * sender. weeklyDigest's own comments set the rule this codebase follows — a small copy
 * is fine until it has a second consumer, at which point "that's a signal to extract a
 * shared file, not evidence this copy was a mistake". This is that point.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Mail clients have no web fonts and no stylesheet — every rule is inline, and the stack
// has to resolve on Gmail, Outlook and Apple Mail alike.
export const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
