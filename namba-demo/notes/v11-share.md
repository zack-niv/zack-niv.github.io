# v11 Share card (item 1) — DONE

Status: `og.jpg` re-rendered (1200x630, 130 KB), meta copy shipped, title touch copy applied. `node tools/loadprobe.mjs` printed `READY 198.7s []` (slow only because 4 other browsers were running; no load change from my edits).

## Done (no browser needed)

- `index.html` `<head>` only: `description`, `og:description`, `twitter:description` now sell the quest; added
  `og:image:alt` / `twitter:image:alt`. Viewport and `<body>` untouched.
- Spoiler scan of `title.js`, `loader.js`, `index.html` before play: nothing mentions Lodestone / magnetic / fingerprint /
  indoor positioning. The title tag is already the quest ("Somewhere in this labyrinth, a tempura lunch is waiting."), and
  the loader strings and tips are fine. The only spoiler was the old og:description ("indoor-navigation story"), now gone.
- `title.js` touch copy (relayed from the Mobile agent): "Tap to begin / タップしてはじめる", hint
  "Left thumb walks · drag to look · headphones on 🎧". Desktop copy unchanged.
- Tools added: `tools/ogshot.mjs` (clean game frames + the real phone UI), `tools/ogcard.mjs` (composes og.jpg).

## Tagline options (Zack approves)

1. **"Six floors, four stations, one tempura lunch. Can you find it?"** (shipped; this is the direction Zack gave)
2. "You just landed. Your friend is already in the queue. Namba has other plans." (shows Aya, a little funnier)
3. "Find the tempura. Survive the station." (shortest, reads best at thumbnail size)

Descriptions shipped:
- page: "Six floors, four stations, one tempura lunch. You just landed in Osaka, your friend is already in the queue, and Namba is a labyrinth. Can you find her? A first-person game in your browser."
- og / twitter: "Six floors, four stations, one tempura lunch. Your friend is already in the queue. Can you find her in the labyrinth that is Namba? Play in your browser."

## Card concept

Full-bleed first-person Namba CITY / Nankai concourse (real game frame, crowd warmed up, HUD hidden), dark left gradient,
なんば + LOST IN NAMBA + the tagline in large type, and the real in-game phone on the right showing Aya's
"Meet me at Tempura Daikichi. Namba Parks, 6F! I'm already in the queue 🍤" with the place card. No Lodestone, no 3D
stack, no "magnetic".

Before: `notes/v11-shots/player/1_link_preview.webp` (Lodestone stack + "magnetic fingerprint").
After: `namba-demo/og.jpg` (copy: `notes/v11-shots/share/og_after.jpg`), downscaled to LinkedIn thumbnail size:
`notes/v11-shots/share/og_after_550px.png`. The game frame is `raw_city_b1.png` (Namba CITY B1 shop street, crowd warmed up,
HUD hidden) and the phone is the real Messages UI with Aya's text and the Tempura Daikichi place card
(`phone_clean.png`: transparent, drop-shadow halo thresholded away). Contents: なんば, LOST IN NAMBA, "Six floors, four
stations, one tempura lunch." / "Can you find it?", "A first-person game · play in your browser". No Lodestone, stack or
"magnetic".

Rebuild: `node tools/ogshot.mjs --out DIR --poses city_b1 --phone city_b1` then
`node tools/ogcard.mjs --bg DIR/raw_city_b1.png --phone DIR/phone_clean.png --out og.jpg --thumb thumb.png`
(the phone PNG needs its faint shadow halo removed: alpha < 130 -> 0).

## Other poses tried

Nankai 1F concourse (clear people, but bland), Nankai 2F (empty-looking), CITY 1F atrium (grand but nobody near). The CITY B1
shop street won: signs, shops, escalator in the distance, a flow of commuters. Alternate backgrounds are in
`notes/v11-shots/share/` only for city_b1; others lived in `/tmp/claude-0/og/`.

## Note for the lead / Mobile (resolved by the lead)

`main.js` lists a `touch` system but `js/core/loader.js` `STAGES` has no `touch` entry, so in the working tree the loader
throws (`STAGES[k][0]` of undefined in `Loader.stage`) and the game never becomes ready. Either add
`touch: [0.01, 4, 'Wiring the controls…']` to `STAGES` or guard `STAGES[k]` in `stage()`. I did not touch it (to keep
the share deploy copy-only); my captures run from a `git archive` of the v10 release (`b9f29a9`).
