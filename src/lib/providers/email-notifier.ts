// Real alert delivery — Resend's plain HTTP API, deliberately not the Resend SDK
// (same "plain fetch, no SDK" convention as claude-sentiment.ts's Claude call — one
// simple POST doesn't justify a new dependency). Confirmed via Resend's own API docs.
import type { Alert, NotifierProvider } from "./types";

const API_URL = "https://api.resend.com/emails";

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set — required for the live NotifierProvider");
  return key;
}

function fromAddress(): string {
  const from = process.env.ALERT_EMAIL_FROM;
  if (!from) throw new Error("ALERT_EMAIL_FROM is not set — required for the live NotifierProvider");
  return from;
}

function toAddress(): string {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) throw new Error("ALERT_EMAIL_TO is not set — required for the live NotifierProvider");
  return to;
}

export class EmailNotifierProvider implements NotifierProvider {
  async send(alert: Alert): Promise<void> {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [toAddress()],
        subject: `StarAnalytics alert: ${alert.type}`,
        text: alert.message,
        // Resend accepts text and html together — html renders in HTML-capable clients,
        // text is the fallback everywhere else. Omitted entirely (not sent as undefined)
        // for the single-line alert types that never set it.
        ...(alert.html ? { html: alert.html } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend email send failed: ${res.status} ${await res.text()}`);
    }
  }
}
