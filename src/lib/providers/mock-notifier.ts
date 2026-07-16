import type { Alert, NotifierProvider } from "./types";

export class MockNotifierProvider implements NotifierProvider {
  async send(alert: Alert): Promise<void> {
    // Dev-mode delivery: log only. The real channel (email, via EmailNotifierProvider)
    // is selected via DATA_MODE_NOTIFIER once RESEND_API_KEY etc. are set — see index.ts.
    console.log("[MockNotifier]", alert.type, alert.message);
  }
}
