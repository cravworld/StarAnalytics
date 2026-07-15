"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCampaignAction } from "@/lib/actions/campaigns";

export default function NewCampaignPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const name = String(formData.get("name") || "").trim();
      if (!name) throw new Error("Name is required");
      const hashtags = String(formData.get("hashtags") || "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      const campaign = await createCampaignAction({
        name,
        status: formData.get("status") === "live" ? "live" : "planned",
        hashtags,
        startDate: String(formData.get("startDate") || "") || undefined,
        endDate: String(formData.get("endDate") || "") || undefined,
        type: String(formData.get("type") || "") || undefined,
      });
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <div className="card-title">New Campaign</div>
      <form action={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label>
          Name
          <input name="name" required placeholder="e.g. #vijayam — Movie Announcement" />
        </label>
        <label>
          Status
          <select name="status" defaultValue="planned">
            <option value="live">Live</option>
            <option value="planned">Planned</option>
          </select>
        </label>
        <label>
          Hashtags (comma-separated)
          <input name="hashtags" placeholder="vijayam, NivinPauly" />
        </label>
        <label>
          Type
          <input name="type" placeholder="e.g. Announcement campaign" />
        </label>
        <label>
          Start date
          <input name="startDate" type="date" />
        </label>
        <label>
          End date
          <input name="endDate" type="date" />
        </label>
        {error ? <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div> : null}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create Campaign"}
        </button>
      </form>
    </div>
  );
}
