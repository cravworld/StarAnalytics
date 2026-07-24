import { NewCampaignForm } from "@/components/campaigns/NewCampaignForm";

// createCampaignAction now auto-tracks every hashtag the campaign is created with
// (real Apify scrapes + comment-scrape + sentiment classification) inside after() —
// same reasoning as the hashtag search page's maxDuration: without this, the
// default serverless timeout cuts that background work off partway through.
export const maxDuration = 300;

export default function NewCampaignPage() {
  return <NewCampaignForm />;
}
