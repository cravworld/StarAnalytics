import Link from "next/link";
import { TheaterCampaignForm } from "@/components/theater/TheaterCampaignForm";
import { selectableRegions } from "@/lib/bookmyshow/validation";

export const metadata = { title: "New Theater Campaign" };

export default function NewTheaterCampaignPage() {
  return (
    <>
      <Link className="back-link" href="/theater-campaigns">
        ← Theater Campaigns
      </Link>
      <TheaterCampaignForm regions={selectableRegions()} />
    </>
  );
}
