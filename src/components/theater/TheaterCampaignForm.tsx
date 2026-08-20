"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createTheaterCampaignAction,
  updateTheaterCampaignAction,
} from "@/lib/actions/theaterCampaigns";
import { ALLOWED_SCAN_INTERVALS } from "@/lib/bookmyshow/validation";

export interface CampaignFormDefaults {
  id?: string;
  name?: string;
  movieName?: string;
  bmsUrlOrCode?: string;
  targetCityCodes?: string[];
  screeningStartDate?: string;
  screeningEndDate?: string;
  scanIntervalMinutes?: number;
  wideOpenAlertPct?: number;
  minShowsForAlert?: number;
}

/**
 * Create/edit form.
 *
 * Field errors come back from the same validator the server runs — there is no separate
 * client-side copy of the rules to drift out of sync, and the server remains the only
 * thing that decides.
 */
export function TheaterCampaignForm({
  regions,
  defaults = {},
}: {
  regions: { code: string; name: string }[];
  defaults?: CampaignFormDefaults;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cities, setCities] = useState<string[]>(defaults.targetCityCodes ?? []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setErrors({});

    const input = {
      name: String(fd.get("name") || ""),
      movieName: String(fd.get("movieName") || ""),
      bmsUrlOrCode: String(fd.get("bmsUrlOrCode") || ""),
      targetCityCodes: cities,
      screeningStartDate: String(fd.get("screeningStartDate") || ""),
      screeningEndDate: String(fd.get("screeningEndDate") || ""),
      scanIntervalMinutes: Number(fd.get("scanIntervalMinutes")),
      wideOpenAlertPct: Number(fd.get("wideOpenAlertPct")),
      minShowsForAlert: Number(fd.get("minShowsForAlert")),
    };

    const result = defaults.id
      ? await updateTheaterCampaignAction(defaults.id, input)
      : await createTheaterCampaignAction(input);

    if (!result.ok) {
      setErrors(result.errors);
      setPending(false);
      return;
    }
    router.push(`/theater-campaigns/${result.id}`);
  }

  function toggleCity(code: string) {
    setCities((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-title">{defaults.id ? "Edit campaign" : "New theater campaign"}</div>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Campaign name" error={errors.name}>
          <input name="name" defaultValue={defaults.name} placeholder="e.g. Bethlehem — Kerala push" />
        </Field>

        <Field label="Movie name (as displayed)" error={errors.movieName}>
          <input name="movieName" defaultValue={defaults.movieName} placeholder="e.g. Bethlehem Kudumba Unit" />
        </Field>

        <Field
          label="BookMyShow movie URL or event code"
          error={errors.bmsUrlOrCode}
          hint="Only in.bookmyshow.com links are accepted. Everything scanned is built from this code — nothing else is ever fetched."
        >
          <input
            name="bmsUrlOrCode"
            defaultValue={defaults.bmsUrlOrCode}
            placeholder="et00502829 or https://in.bookmyshow.com/movies/…"
          />
        </Field>

        <Field
          label="Target cities"
          error={errors.targetCityCodes}
          hint="Leave all unticked to scan every Kerala region BookMyShow lists for this film."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {regions.map((r) => (
              <label
                key={r.code}
                style={{
                  display: "inline-flex",
                  gap: 4,
                  alignItems: "center",
                  fontSize: 11,
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  padding: "2px 6px",
                }}
              >
                <input type="checkbox" checked={cities.includes(r.code)} onChange={() => toggleCity(r.code)} />
                {r.name}
              </label>
            ))}
          </div>
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Screening from" error={errors.screeningStartDate}>
            <input type="date" name="screeningStartDate" defaultValue={defaults.screeningStartDate} />
          </Field>
          <Field label="Screening to" error={errors.screeningEndDate}>
            <input type="date" name="screeningEndDate" defaultValue={defaults.screeningEndDate} />
          </Field>
        </div>

        <Field
          label="Scan every"
          error={errors.scanIntervalMinutes}
          hint="A Kerala-wide scan renders around 90 BookMyShow pages. Shorter intervals mean more traffic to their site."
        >
          <select name="scanIntervalMinutes" defaultValue={defaults.scanIntervalMinutes ?? 90}>
            {ALLOWED_SCAN_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <Field
            label="Flag a theater at (% shows wide open)"
            error={errors.wideOpenAlertPct}
          >
            <input
              type="number"
              name="wideOpenAlertPct"
              min={1}
              max={100}
              defaultValue={defaults.wideOpenAlertPct ?? 80}
            />
          </Field>
          <Field
            label="Minimum shows before judging"
            error={errors.minShowsForAlert}
            hint="Small venues run few shows; one quiet slot is not a signal."
          >
            <input
              type="number"
              name="minShowsForAlert"
              min={1}
              max={50}
              defaultValue={defaults.minShowsForAlert ?? 3}
            />
          </Field>
        </div>

        {errors.form ? (
          <div role="alert" style={{ fontSize: 12, color: "var(--pencil-red)" }}>
            {errors.form}
          </div>
        ) : null}

        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            borderTop: "1px solid var(--border)",
            paddingTop: 8,
          }}
        >
          This tool reports how available BookMyShow still shows each screening to be. It does not have access
          to ticket sales or seat counts, and never reports occupancy.
        </div>

        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : defaults.id ? "Save changes" : "Create campaign"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
      <span>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 10, color: "var(--muted)" }}>{hint}</span> : null}
      {error ? (
        <span role="alert" style={{ fontSize: 11, color: "var(--pencil-red)" }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}
