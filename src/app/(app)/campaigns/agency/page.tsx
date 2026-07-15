import { getAgencyUploadData } from "@/lib/data/agency";
import { AgencyReportClient } from "@/components/agency/AgencyReportClient";

export default async function AgencyReportPage() {
  const { agencies } = await getAgencyUploadData();
  return <AgencyReportClient agencies={agencies} />;
}
