import Link from "next/link";
import { listScoutBatches } from "@/lib/data/scout";
import { getScoutSettings } from "@/lib/data/scoutSettings";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { ScoutUploadForm } from "@/components/scout/ScoutUploadForm";
import { ScoutQuickAddForm } from "@/components/scout/ScoutQuickAddForm";
import { ScoutSettingsPanel } from "@/components/scout/ScoutSettingsPanel";

export default async function ScoutPage() {
  const [batches, settings] = await Promise.all([listScoutBatches(), getScoutSettings()]);

  return (
    <>
      <ScoutSettingsPanel initial={settings} />
      <ScoutUploadForm />
      <ScoutQuickAddForm />
      <Card title="Scan Batches">
        {batches.length === 0 ? (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
            No batches yet — upload a list above to run the first scan.
          </div>
        ) : (
          batches.map((b) => {
            const done = b.runsTotal > 0 && b.runsDone + b.runsErrored === b.runsTotal;
            return (
              <Link
                key={b.id}
                href={`/scout/${b.id}`}
                className="htag-row"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="htag-name">{b.fileName}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {b.parsedCount} accounts · {new Date(b.createdAt).toLocaleDateString()}
                </div>
                <div className="htag-eng">{b.scoredCount}/{b.parsedCount} scored</div>
                <Pill kind={done ? "good" : "warn"}>{done ? "Done" : "Scanning…"}</Pill>
              </Link>
            );
          })
        )}
      </Card>
    </>
  );
}
