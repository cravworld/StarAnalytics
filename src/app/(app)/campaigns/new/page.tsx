import { NewCampaignForm } from "@/components/campaigns/NewCampaignForm";

// createCampaignAction now auto-tracks every hashtag the campaign is created with
// (real Apify scrapes + comment-scrape + sentiment classification) inside after() —
// same reasoning as the hashtag search page's maxDuration: without this, the
// default serverless timeout cuts that background work off partway through. Raised to
// Pro's 800s ceiling for the same reason as the agency page: a killed after() leaves
// started Apify runs billing unread. See that page's note.
export const maxDuration = 800;

export default function NewCampaignPage() {
  return <NewCampaignForm />;
}
