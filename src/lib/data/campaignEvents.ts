import { prisma } from "@/lib/prisma";

// Milestones a campaign owner logs by hand (trailer drop, premiere, theatrical release,
// press event, ...) so the campaign timeline can be read next to sentimentTrend
// (getCampaignDetail, campaigns.ts) to answer "did this event move the numbers." See
// CampaignEvent in schema.prisma for why `label` is free-text rather than an enum.
export interface CampaignEventRow {
  id: string;
  label: string;
  /** YYYY-MM-DD — matches sentimentTrend's SentimentTrendPoint.date format exactly, so
   *  SentimentTrendLine can cross-reference the two without reparsing either. */
  eventDate: string;
  eventDateLabel: string;
}

export async function getCampaignEvents(campaignId: string): Promise<CampaignEventRow[]> {
  const events = await prisma.campaignEvent.findMany({
    where: { campaignId },
    orderBy: { eventDate: "asc" },
  });
  return events.map((e) => ({
    id: e.id,
    label: e.label,
    eventDate: e.eventDate.toISOString().slice(0, 10),
    eventDateLabel: e.eventDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
  }));
}

export async function addCampaignEvent(campaignId: string, label: string, eventDateInput: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("An event label is required");
  if (trimmed.length > 80) throw new Error("Event label must be 80 characters or fewer");
  // new Date("YYYY-MM-DD") parses as UTC midnight, which is what the <input type="date">
  // this feeds sends — kept naive (no timezone conversion) since events are day-granularity,
  // matching sentimentTrend's own day-bucketing (see getCampaignDetail).
  const eventDate = new Date(eventDateInput);
  if (Number.isNaN(eventDate.getTime())) throw new Error("A valid event date is required");
  await prisma.campaignEvent.create({ data: { campaignId, label: trimmed, eventDate } });
}

export async function deleteCampaignEvent(id: string): Promise<void> {
  await prisma.campaignEvent.delete({ where: { id } });
}
