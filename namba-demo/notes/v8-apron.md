# v8 apron (staff "weird blocks")

**Cause.** Near-LOD staff apron (`BIT.APRON`, `js/npc/humans.js` `_accessories`) was two rigid boxes at fixed offsets (0.38x0.6 hips slab, 0.27x0.3 chest slab). They ignore the body surface, so in profile they float off as cardboard slabs. The far/instanced LOD (`humanGeo.js` `g.panel`) was already a shaped panel and is unchanged.

**Fix (humans.js only).** The apron is rebuilt like the backpack, measuring the surface with `body.front/back/top`:
- bib: tapered slab (0.21 wide at the collarbone, 0.31 at the waist) skinned to `Chest`;
- skirt: flared slab (0.34 to 0.41 wide) from the waist to mid-thigh, skinned to `Hips`;
- each slab is a subdivided box whose grid points are pushed onto the sampled front surface (dent fill, convexity clamp, 1.6-3 cm stand-off, a little more at the hem);
- neck strap over the trapezius (front, over, behind the neck), waist band, side ties round to a back bow with two tails;
- colour logic untouched (`A.acc2` / APRON palettes); about 400-500 tris.

**Screenshots** (`tools/apronshot.mjs <prefix>`, new; `ROWS=f_idle_front,...` limits the views, `BEFORE=1` serves the git HEAD humans.js):
- before: `notes/v8-shots/apron/before_f_idle_front.png`, `before_f_idle_profile.png`, `before_m_idle_profile.png`, `before_f_walk_profile.png`, `before_far_pair.png`
- after (final): `notes/v8-shots/apron/after_*.png`
- earlier iteration (before the dent fix; same design): `notes/v8-shots/apron/r1/`

**Known roughness.** The surface is sampled from vertices, so on the dress variant a patch of dress can poke through the skirt; the convexity clamp is the latest attempt at that (see final after_ front shot). The skirt is rigid on Hips, so in walk its hem swings a little away from the thighs.
