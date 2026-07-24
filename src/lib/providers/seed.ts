// Seed data ported verbatim from staranalytics_prototype.html (AGENCIES, POSTS,
// heatData, chart series) so Phase 0 renders identically to the prototype.

export const AGENCIES = [
  { name: "Pixelwave Media", color: "#E1306C", score: 91, perf: 94, auth: 90, eff: 89, reach: "9.4M", flags: 0 },
  { name: "Reelcraft Agency", color: "#833AB4", score: 86, perf: 88, auth: 87, eff: 83, reach: "8.8M", flags: 1 },
  { name: "Kochi Digital Co.", color: "#F77737", score: 82, perf: 84, auth: 83, eff: 79, reach: "7.9M", flags: 0 },
  { name: "SocialSpark IN", color: "#1a7a4a", score: 79, perf: 80, auth: 82, eff: 76, reach: "7.4M", flags: 1 },
  { name: "TrendTide Media", color: "#558b2f", score: 76, perf: 77, auth: 78, eff: 74, reach: "7.1M", flags: 0 },
  { name: "CreatorHub", color: "#00838f", score: 74, perf: 75, auth: 76, eff: 71, reach: "6.8M", flags: 0 },
  { name: "Viralthread MKT", color: "#ad1457", score: 71, perf: 73, auth: 70, eff: 69, reach: "6.4M", flags: 2 },
  { name: "BuzzBridge", color: "#1565c0", score: 58, perf: 72, auth: 38, eff: 64, reach: "8.1M", flags: 23 },
  { name: "Influx Kerala", color: "#6a1b9a", score: 52, perf: 65, auth: 32, eff: 60, reach: "9.0M", flags: 18 },
  { name: "NovaSocial", color: "#4527a0", score: 48, perf: 60, auth: 28, eff: 55, reach: "8.9M", flags: 13 },
] as const;

export const POSTS = [
  { url: "instagram.com/p/Cx1a…", ag: "Pixelwave Media", color: "#E1306C", reach: "284K", likes: "18.4K", comments: "920", saves: "3.2K", eng: "6.5%", auth: 92, score: 94, flags: [] as string[] },
  { url: "instagram.com/p/Bw2b…", ag: "Reelcraft Agency", color: "#833AB4", reach: "241K", likes: "15.1K", comments: "741", saves: "2.8K", eng: "6.3%", auth: 88, score: 90, flags: [] as string[] },
  { url: "instagram.com/p/Dq3c…", ag: "Pixelwave Media", color: "#E1306C", reach: "220K", likes: "13.2K", comments: "680", saves: "2.4K", eng: "6.0%", auth: 91, score: 89, flags: [] as string[] },
  { url: "instagram.com/p/Ar4d…", ag: "Kochi Digital Co.", color: "#F77737", reach: "198K", likes: "11.8K", comments: "590", saves: "1.9K", eng: "5.7%", auth: 84, score: 85, flags: [] as string[] },
  { url: "instagram.com/p/Zp5e…", ag: "SocialSpark IN", color: "#1a7a4a", reach: "187K", likes: "10.4K", comments: "512", saves: "1.7K", eng: "5.6%", auth: 82, score: 83, flags: [] as string[] },
  { url: "instagram.com/p/Yq6f…", ag: "BuzzBridge", color: "#1565c0", reach: "310K", likes: "22.1K", comments: "88", saves: "142", eng: "7.2%", auth: 34, score: 58, flags: ["Velocity", "Low saves"] },
  { url: "instagram.com/p/Xr7g…", ag: "Influx Kerala", color: "#6a1b9a", reach: "298K", likes: "20.8K", comments: "64", saves: "98", eng: "7.0%", auth: 29, score: 51, flags: ["Bot comments", "Velocity"] },
  { url: "instagram.com/p/Ws8h…", ag: "NovaSocial", color: "#4527a0", reach: "290K", likes: "19.4K", comments: "72", saves: "110", eng: "6.8%", auth: 26, score: 48, flags: ["Off-hours", "Bot comments"] },
  { url: "instagram.com/p/Vt9i…", ag: "TrendTide Media", color: "#558b2f", reach: "172K", likes: "9.8K", comments: "440", saves: "1.5K", eng: "5.4%", auth: 79, score: 77, flags: [] as string[] },
  { url: "instagram.com/p/Uj0j…", ag: "CreatorHub", color: "#00838f", reach: "165K", likes: "9.1K", comments: "398", saves: "1.3K", eng: "5.2%", auth: 77, score: 74, flags: [] as string[] },
];

export const HEAT_DATA: Record<string, number[]> = {
  Mon: [1, 0, 2, 1, 3, 4],
  Tue: [0, 1, 2, 2, 3, 3],
  Wed: [1, 1, 1, 3, 4, 3],
  Fri: [2, 2, 3, 3, 4, 4],
  Sat: [3, 3, 3, 2, 4, 3],
};

export const FOLLOWER_GROWTH_12W = [7050, 7080, 7100, 7150, 7180, 7230, 7270, 7310, 7330, 7360, 7385, 7410];
export const ENGAGEMENT_BREAKDOWN = { likes: 82, comments: 11, saves: 5, shares: 2 };
export const POST_TYPE_PERFORMANCE = [
  { label: "Reels", engagementPct: 4.8 },
  { label: "Photos", engagementPct: 3.9 },
  { label: "Carousels", engagementPct: 3.4 },
  { label: "Stories", engagementPct: 2.1 },
];
export const REACH_BY_WEEK = [6.2, 7.1, 5.8, 8.4, 7.9, 9.2, 8.1, 10.4];
export const AGE_DISTRIBUTION = [
  { bracket: "13-17", pct: 8 },
  { bracket: "18-24", pct: 28 },
  { bracket: "25-34", pct: 44 },
  { bracket: "35-44", pct: 14 },
  { bracket: "45+", pct: 6 },
];
export const TOP_LOCATIONS = [
  { city: "Kochi", pct: 31 },
  { city: "Trivandrum", pct: 18 },
  { city: "Calicut", pct: 13 },
  { city: "Dubai", pct: 11 },
  { city: "Chennai", pct: 8 },
  { city: "Others", pct: 19 },
];

export const TOP_POSTS_MONTH = [
  { icon: "🎬", likes: "1.2M", comments: "8.4K" },
  { icon: "📸", likes: "980K", comments: "6.1K" },
  { icon: "🎬", likes: "760K", comments: "4.2K" },
  { icon: "📸", likes: "640K", comments: "3.8K" },
];

export const RECENT_POSTS = [
  { icon: "🎬", stat: "1.2M views" },
  { icon: "📸", stat: "980K reach" },
  { icon: "🖼️", stat: "740K reach" },
  { icon: "🎬", stat: "620K views" },
  { icon: "📸", stat: "580K reach" },
  { icon: "📸", stat: "450K reach" },
  { icon: "🖼️", stat: "390K reach" },
  { icon: "🎬", stat: "310K views" },
];

export const VIJAYAM_DETAIL = {
  tag: "#vijayam",
  startedLabel: "Announcement campaign · Started Jul 8, 2026",
  hero: { postsToday: "3,847", lastHour: "+1,204", totalReach: "14.2M", uniqueAccounts: "2,341" },
  kpis: [
    { label: "Avg Eng/Post", value: "8.4%", delta: "Above avg" },
    { label: "Reels With Tag", value: "1,092", delta: "28% of posts" },
    { label: "Stories With Tag", value: "612", delta: "Fast spreading" },
    { label: "Sentiment", value: "78%", delta: "Positive" },
  ],
  hourlyVolume: [12, 28, 45, 62, 100, 88, 72, 60, 54, 50, 55, 92],
  peakLabel: "Peak: 1,204/hr",
  sentiment: { positive: 78, neutral: 14, negative: 8 },
  geoSpread: [
    { name: "Kerala", pct: 44 },
    { name: "Tamil Nadu", pct: 26 },
    { name: "UAE/Gulf", pct: 16 },
    { name: "Karnataka", pct: 8 },
    { name: "Others", pct: 6 },
  ],
  keywords: [
    { text: "excited", hot: true },
    { text: "fire", hot: true },
    { text: "blockbuster", hot: false },
    { text: "can't wait", hot: false },
    { text: "goosebumps", hot: true },
    { text: "masterpiece", hot: false },
    { text: "waiting", hot: false },
    { text: "incredible", hot: true },
  ],
  stream: [
    { av: "NF", bg: "#fde8ef", c: "#E1306C", handle: "@nivin_fanz_official", time: "2 min ago", text: "VIJAYAM IS HERE!! Drop everything and share this. #vijayam #NivinPauly", likes: "6.1K", comments: "441", tag: "Fan page" },
    { av: "FF", bg: "#e8f5e9", c: "#1a7a4a", handle: "@fanfire_nivin", time: "8 min ago", text: "Finally the announcement! #vijayam #NivinPauly 🔥", likes: "4.2K", comments: "312", tag: "Fan page" },
    { av: "MK", bg: "#e3f2fd", c: "#1565c0", handle: "@mollywood_king", time: "15 min ago", text: "#vijayam title reveal giving major vibes. Nivin is back in full form!", likes: "2.8K", comments: "189", tag: "Public" },
    { av: "MC", bg: "#f3e5f5", c: "#6a1b9a", handle: "@malayali_cinema_hub", time: "22 min ago", text: "Title: #vijayam · Nivin Pauly. Hype is already through the roof.", likes: "1.9K", comments: "97", tag: "Media" },
  ],
};

export const TRACKED_HASHTAGS = [
  { name: "#vijayam", fillPct: 100, posts: "3.8K posts", eng: "8.4%", tag: "New" },
  { name: "#BethlehemKudumbaUnit", fillPct: 82, posts: "48.2K posts", eng: "6.1%", tag: "Trending" },
  { name: "#BKULaunch", fillPct: 60, posts: "12.7K posts", eng: "5.4%", tag: "Campaign" },
  { name: "#NivinPauly", fillPct: 55, posts: "142K posts", eng: "4.8%", tag: "Active" },
  { name: "#vijayammovie", fillPct: 28, posts: "1.1K posts", eng: "9.1%", tag: "New" },
  { name: "#MalayalamCinema", fillPct: 44, posts: "980K posts", eng: "3.2%", tag: "Active" },
  { name: "#Mollywood", fillPct: 40, posts: "2.1M posts", eng: "2.9%", tag: "Active" },
  { name: "#NivinFans", fillPct: 22, posts: "28K posts", eng: "5.1%", tag: "Active" },
];

