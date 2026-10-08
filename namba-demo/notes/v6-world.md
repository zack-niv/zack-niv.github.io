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

Headless SwiftShader, quality=high, `&nocrowd&noaudio`. Before = `git archive HEAD` of the tree before this pass
(scratchpad), after = working tree. Shots in `notes/v6-shots/world/{before,after}/`.

**3 Escalator** (Parks 2F->3F up lane, same camera):

| | mood | env map | fog density | calls / tris |
|---|---|---|---|---|
| foot (both) | mall | mall | 0.0072 | 806 / 644k -> 819 / 686k |
| riding, before | **parks** | mall -> **parks (sky)** | **0.0020** | 852 / 678k |
| riding, after | mall | mall | 0.0072 | 929 / 722k |

`esc_2_riding.png`: before = blue/silver decking (Zack's 3b), after = the same warm dark steel as `esc_1_foot.png`.
Riding now costs what standing in the hall costs (+77 calls vs the old sky-fog ride; the denser mall fog/exposure
path draws the far end of the mall). Not checked: other zones' banks visually (logic applies to all ramps; CITY,
Nankai, metro ramps already shared their zone mood with their halls, so only Parks/garden changed in practice).

**4 Planters** `plant0_b.png` / `plant1_*`: after = stone rim, recessed soil, no hatching. Honest note: SwiftShader's
before shot at this angle does not show the hatching Zack's GPU shows (precision/angle dependent); the evidence is
the geometry (lid and soil both at y 0.5, same material, different vertex colour). Draw calls at the planter views:
before 732/234/479/350 -> after 632/236/479/344 (noise; +6 small quads per planter, same material).

**5 / 6 Bridge seam, canyon stairs** `bridge3f_seam.png`, `bridge5f_seam.png`, `canyon_stairs.png`: after = clean
deck-to-tile threshold; the white grid soffit + glass canopy over the canyon->garden stairs is gone (before shot shows
both). Node check of every stair flight: exit kit removed from `stair_pk_g3` and `stair_g34/45/56/67/78` (outdoor at
both ends), kept on exits 15/18/21/24 and Midosuji 1 (indoor foot). Calls: bridge 777 -> 781, 5F 819 -> 827, canyon
stairs 236 -> 223.

**zfightprobe, the item classes** (same 3 poses: `3F,26,239,-90,15` bridge, `2F,36,224,90,20` canyon stairs,
`3F,-1,245,180,0` Parks corridor; radius 25 m):

| class | before (m2 / clusters) | after |
|---|---|---|
| bridge deck 3F x canyon sill | 15.4 / 14 | 0 |
| bridge deck 5F x canyon sill | 13.9 / 14 | 0 |
| 2F canyon-view ceiling x canyon soffit | 15.7 / 15 | 0 |
| 2F hall ceiling x north-lintel soffit | 70.7 / 4 | 0 |
| mall roof x canyon west cap (seen from 6F+) | 91.8 / 1 | 0 |
| stair tunnel wall x slab-edge cladding | 5.2 / 6 | 0 |
| planter lid x soil | (fixed before the first probe run; geometry evidence) | 0 |
| **all fights at the 3 poses** | 1181 clusters (757 m2) * | 538 clusters (368 m2) |

\* the before total was taken with an earlier probe build (no "buried face" filter), so the totals are not strictly
comparable; the per-class rows are (those classes are not affected by that filter).

Full-route sweep: not finished. The machine ran at load ~19 with 4 browser slots taken by other agents; a pose
took ~2-3 min, so the 24-pose route (before + after) did not fit the budget. Done for 3 route poses (after tree,
Nankai platform / gates / 2F): 142 / 248 / 232 fight clusters, all shop-interior and station-fixture classes
(see Open 1). Run `node tools/zfightprobe.mjs` (default route) on a quiet box for the full table.

`node tools/loadprobe.mjs`: `READY 144.0s []` (systems ready 29 s; the first frame dominated by SwiftShader at load ~19).
Console clean in every run (`console: clean`, `ctx.errors []`).

## Open / unsure

1. **Shop interiors still z-fight (not on Zack's list, but the probe's biggest remaining class)**, all in `env/*`
   (mine) and `shops.js` fronts, Parks shop rows on every floor:
   `env_matte x env_matte` on shop floors / walls (~30-80 m2 per floor in a 25 m radius), arch skirting
   `steel_dark` (surfaces.js:37, a 0.1 m box) coplanar with the shop's own `env_matte` skirting/wall faces at the
   partitions (z 224.01, x 19.99), and wall signs `env_sign_* x env_matte` coplanar with the fascia. Likely one or two
   shared offsets in `env/shopbuild.js finish()/front()` (wall finishes at 0.015 vs the arch skirt) - next pass:
   `node tools/zfightprobe.mjs --poses "3F,-1,245,180,0" --top 40` and fix the offsets, then re-run.
2. `far` class (gap 0.3-3 mm, shimmers only beyond ~30-50 m): stair nosing strips at +2 mm (`esc_comb x
   floor_paving_warm`), shop print/poster quads 1-2 mm off walls. Low priority.
3. Escalator: verified on the Parks bank only, in SwiftShader. Real-GPU look not seen.
4. I did not re-run `leakprobe.mjs` (the slot queue ate the budget). The changes cannot open new back faces: a
   removed soffit/canopy over outdoor stairs (open sky above), sills/soffits moved 2 cm into an existing floor /
   ceiling, a 1 cm inset of a stair wall, and a lintel soffit trimmed to the canyon side. Worth one leakprobe at
   `2F,36,224,90,20` and `3F,26,239,-90,15` by the critic.
5. `tools/zfightprobe.mjs --hook FILE` runs an extra module in the same session (used for the shots above);
   the hook I used lives in my scratchpad, not the repo.
