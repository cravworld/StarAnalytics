import { listScoutBatches } from "@/lib/data/scout";
import { getScoutSettings } from "@/lib/data/scoutSettings";
import { Card } from "@/components/ui/Card";
import { ScoutUploadForm } from "@/components/scout/ScoutUploadForm";
import { ScoutQuickAddForm } from "@/components/scout/ScoutQuickAddForm";
import { ScoutSettingsPanel } from "@/components/scout/ScoutSettingsPanel";
import { ScoutBatchList } from "@/components/scout/ScoutBatchList";

export default async function ScoutPage() {
  const [batches, settings] = await Promise.all([listScoutBatches(true), getScoutSettings()]);

  return (
    <>
      <ScoutSettingsPanel initial={settings} />
      <ScoutUploadForm />
      <ScoutQuickAddForm />
      <Card title="Scan Batches">
        <ScoutBatchList batches={batches} />
      </Card>
    </>
  );
}
