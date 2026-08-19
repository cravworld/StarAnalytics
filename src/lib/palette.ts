/**
 * Identity colours — the box of coloured pencils.
 *
 * These are the colours used to tell one *entity* apart from another: an agency
 * in a leaderboard, a fan page's avatar, a campaign's icon tile. They are NOT
 * data colours (charts own those, see components/charts/theme.ts) and they are
 * NOT semantic (up/down/alert own those, see globals.css).
 *
 * Why this file exists: these values previously lived as raw hexes scattered
 * across four data-layer modules and one component, four of which were copies of
 * the same list. A re-skin that only touched components would have left the old
 * Instagram palette live underneath Campaigns and Fan Pages, and the duplicate in
 * AgencyReportClient was already free to drift from lib/data/agency.ts.
 *
 * ── How the set is built ──
 * Ten pencils, each with two pressures:
 *   ink   — the mark itself: dots, bars, avatar initials, identity text.
 *   wash  — the same hue laid down lightly: avatar and icon-tile backgrounds.
 *
 * Lightness ALTERNATES across the set (L* 34 / 44). That is deliberate and load
 * bearing: hues that sit close together on the wheel — teal, steel, indigo —
 * collapse into each other when every pencil shares one lightness, which matters
 * most exactly where these are used, in a leaderboard of ten agencies compared
 * side by side. Alternating lightness gives a second separation channel.
 *
 * ── Measured, not eyeballed ──
 * Every pencil satisfies all three, with the worst case quoted:
 *   ink on its own wash   >= 4.71:1   (avatar initials sit on the wash)
 *   ink on a card (--leaf) >= 5.39:1
 *   ink on the page (--paper) >= 4.82:1
 *
 * ── A note on meaning ──
 * Identity colour is decorative: the entity's name is always rendered next to it,
 * so no one has to decode a colour to know what they are looking at. That is why
 * a ten-colour set is acceptable here when the charts deliberately refuse one.
 * It also means a pencil that happens to look reddish carries no "bad" meaning —
 * the semantic colours are a separate, reserved pair.
 */

export type Pencil = { readonly name: string; readonly ink: string; readonly wash: string };

export const PENCILS = [
  { name: "crimson", ink: "#89323E", wash: "#FDE7E8" },
  { name: "rust", ink: "#9B5636", wash: "#FFE8DE" },
  { name: "ochre", ink: "#644D08", wash: "#F8EBD5" },
  { name: "olive", ink: "#59702B", wash: "#E9EFD8" },
  { name: "fern", ink: "#015D31", wash: "#DBF2E1" },
  { name: "teal", ink: "#01756C", wash: "#D1F3EE" },
  { name: "steel", ink: "#045963", wash: "#D0F3F9" },
  { name: "indigo", ink: "#067097", wash: "#DBEFFE" },
  { name: "violet", ink: "#2C4E8E", wash: "#E8ECFF" },
  { name: "magenta", ink: "#865693", wash: "#F8E7FB" },
] as const satisfies readonly Pencil[];

const pick = (indices: readonly number[]) => indices.map((i) => PENCILS[i]);

/**
 * Ten identity marks, for sets that can be that large — the agency leaderboard
 * and the per-post agency dot.
 */
export const IDENTITY_INKS: string[] = PENCILS.map((p) => p.ink);

/**
 * Subsets below keep the exact lengths the previous palettes had. That is not
 * cosmetic: every consumer assigns a colour with `hash % palette.length`, so
 * changing a length would reshuffle which entity gets which colour. Same length,
 * new colours — assignments stay stable, only the ink changes.
 *
 * Indices are hand-picked to spread around the wheel rather than taking the first
 * N, which would hand out five near-neighbours.
 */
const AVATAR_INDICES = [0, 4, 8, 2, 6] as const; // crimson, fern, violet, ochre, steel
const STREAM_INDICES = [0, 4, 6, 9] as const; //    crimson, fern, steel, magenta

/** Fan-page avatars: initials in `c` on a `bg` wash. 5 entries. */
export const AVATAR_PALETTE = pick(AVATAR_INDICES).map((p) => ({ bg: p.wash, c: p.ink }));

/** Campaign live-stream avatars. 4 entries. */
export const STREAM_AVATAR_PALETTE = pick(STREAM_INDICES).map((p) => ({ bg: p.wash, c: p.ink }));

/** Campaign icon tiles — an emoji on a wash, so only the background is needed. 5 entries. */
export const TILE_WASHES: string[] = pick(AVATAR_INDICES).map((p) => p.wash);

/**
 * Platform marks (fan pages, competitor columns).
 *
 * These were the platforms' own brand hexes — Instagram pink, YouTube red. They
 * are pencils now rather than brand colours, for two reasons: the brand hexes were
 * the single most visible survivor of the old palette, and the platform's *name* is
 * always rendered right next to the mark, so colour is never the only thing telling
 * you which platform a row belongs to.
 *
 * Keyed loosely so an unknown platform degrades to plain ink rather than throwing.
 */
const PLATFORM_PENCIL: Record<string, Pencil> = {
  instagram: PENCILS[9], // magenta
  youtube: PENCILS[0], // crimson
};

export function platformInk(platform: string | null | undefined): string {
  return PLATFORM_PENCIL[(platform ?? "").toLowerCase()]?.ink ?? "var(--ink-soft)";
}
