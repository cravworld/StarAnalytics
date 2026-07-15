import type { Alert, NotifierProvider } from "./types";

export class MockNotifierProvider implements NotifierProvider {
  async send(alert: Alert): Promise<void> {
    // Dev-mode delivery: log only. A real Notifier (email/WhatsApp/push) is
    // selected via DATA_MODE once the alert channel decision (see build plan §6) lands.
    console.log("[MockNotifier]", alert.type, alert.message);
  }
}
