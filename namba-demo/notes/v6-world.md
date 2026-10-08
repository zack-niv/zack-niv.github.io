# v6 — World (items 3, 4, 5, 6-slab)

Owner files touched: `js/render/lighting.js`, `js/world/arch/escalators.js`, `js/world/props.js`,
`js/world/outdoor/canyon.js`, `js/world/outdoor/structures.js`, new `tools/zfightprobe.mjs`.
No requests to `layout.js` / `world.js` / `nav.js`. No new materials, meshes or shader programs.
Shots: `notes/v6-shots/world/before/*` (HEAD tree before this pass) vs `notes/v6-shots/world/after/*`.

## Root causes

| # | Zack | Root cause (evidence) | Fix (the class, not the instance) |
|---|---|---|---|
| 3 | Escalator dark, turns blue/silver when you ride it | Not geometry: one bank, one material (`esc_deck` = brushed metal, metalness 1, reflects `scene.environment`). `world.locate(body)` returns `space: null` while `body.ramp >= 0`, so `lighting.update` fell back to the **zone** mood. For the Parks banks that is `parks` = the **outdoor sky env map** (blue sky + sun disc) and sky fog, instead of the `mall` env of the halls at both ends. Boarding cross-faded the env to sky in 1.6 s, arriving faded it back. See the `esc foot / esc riding` lines below (mood + env before/after). | A ramp now takes the mood of the space just beyond its **nearer end** (`Lighting._rampLoc`). Applies to every ramp (escalators and stairs, all zones); fog and colour grade (`post.js` reads `lighting.mood`) follow. |
| 4 | Plant pots / soil render issue | Coplanar: `props.js` planters (`plant`, `planterbench`) drew a full box (lid at y 0.5) **and** the soil quad at y 0.5, same material (`env_matte`), different vertex colour. Probe: `env_matte x env_matte` fight at the planter tops. | Planters have no lid now: stone rim ring at 0.5, short inner walls, soil 4 cm below the rim (`planterTop`), plants start at the soil. |
| 5 | Bridge / floor seam | Coplanar: the canyon wall opening (`outdoor/canyon.js`) closes each opening with a horizontal **sill** at the opening's bottom band line and a **soffit** at its top. For the 3F/5F bridges the sill lies exactly in the plane of the bridge deck (`floor_deck` at y 12 / 24) and runs ~2 m into the building (to `x0 - 0.3`): deck vs cream strata fight across the threshold = the screenshot. Same for the 2F canyon-view soffits vs the indoor ceiling at 10.2. Probe: `floor_deck x parks:canyon` (3F, 5F), `ceiling_wood x parks:canyon` (2F). | Sills 2 cm down, soffits 2 cm up (`ZF`); the band faces still reach the line, so the lip stays closed. Same class fixed nearby: canyon west cap vs the Parks mall roof (y 30, seen from the 6F+ terraces/skywalks); the north-entrance lintel soffit (`structures.js`) started at z 211 inside the Parks 2F hall whose ceiling is at the same y 11 (now z 214..214.4); stair tunnel walls vs the upper slab-edge cladding (`escalators.js`, walls 1 cm proud). |
| 6 | White ceiling slab floating over the canyon garden stairs | `escalators.js _stairs`: every flight whose **top** is outdoors got the street-exit kit (`_exitWell`): a sloped soffit in the foot space's ceiling material (canyon has none, so `ceiling_grid` white tiles) with a line light, a paving "street cover" slab at the top, an end wall and a glass canopy. Meant for NAMBAWALK / Midosuji exits that climb out of the ground; the canyon -> garden stairs and all five terrace stairs (outdoor at both ends) got it too. | The exit kit is built only when the flight climbs out of a non-outdoor space. Sweep: removes it from `stair_pk_g3` and `stair_g34 .. stair_g78`; street exits keep theirs. |

## tools/zfightprobe.mjs

`node tools/zfightprobe.mjs [--poses "L,x,z,yaw,pitch;..."] [--radius 30] [--shot] [--hook FILE] [--root DIR]`
(default poses: the route Nankai -> CITY -> Parks bridge -> escalators / canyon loop -> 6F + gardens, 24 poses).
Per pose: renders 4 yaws, gathers every opaque mesh that was visible within the radius, buckets triangles by
plane and reports pairs that face the same way (or one is double-sided), lie within 0.3 mm (`fight`) or 3 mm
(`far`: shimmers beyond ~30–50 m) of the same plane and overlap by > 4 cm², unless polygonOffset differs,
shading is identical (invisible duplicate) or the face is buried against an opposite-facing surface (box
bottoms on floors). Prints clusters per pose and unique totals.

## Results

(filled in below)
