import { getInstagramInsightsProvider } from "@/lib/providers";

export async function getAudienceData() {
  return getInstagramInsightsProvider().getAudienceDemographics();
}
