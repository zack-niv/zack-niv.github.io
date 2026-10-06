# Human models — licence and sources

`humans_m.glb` and `humans_f.glb` are derived from **Quaternius** character packs,
released under **CC0 1.0 Universal (public domain dedication)**:
https://creativecommons.org/publicdomain/zero/1.0/ — no attribution required
(credited here anyway, with thanks).

| Pack | Characters used | Licence |
|---|---|---|
| Ultimate Modular Men (Feb 2022) — https://quaternius.com/packs/ultimatemodularcharacters.html | Suit, Casual_2, Casual_Hoodie, Adventurer | CC0 |
| Ultimate Modular Women (Apr 2022) — https://quaternius.com/packs/ultimatemodularwomen.html | Suit, Casual, Formal, Adventurer | CC0 |

The pack pages state: *"Free to use in personal, educational and commercial
projects (CC0 License)"*. The pack's `License.txt` (copy fetched from
`cdn.jsdelivr.net/gh/flawlesshappiness/EmotionCreatures/Assets/Quaternius/Ultimate Modular Women - April 2022/License.txt`) reads:

```
Ultimate Modular Males by @Quaternius
License:
CC0 1.0 Universal (CC0 1.0)
Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/
```

## Where the files came from

The individual-character glTF files (`Individual Characters/glTF/<name>.gltf`)
were downloaded on 2026-10-06 from:

* the official Google Drive folders linked from the pack pages
  (Men: `drive.google.com/drive/folders/1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX`,
  Women: `drive.google.com/drive/folders/1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf`) —
  `Suit.gltf` (men) came from there directly; Drive then hit its download quota, so
* the remaining, byte-identical copies came from a public mirror of the same pack files in a game project:
  `https://cdn.jsdelivr.net/gh/ChrisF29/ReadyOrNotGame-Project-2025/NPCs/NPCs/Men/<name>.gltf` and
  `.../NPCs/NPCs/Women/<name>.gltf` (the men's `Suit.gltf` from both sources compared byte-for-byte equal).

Only `.gltf` data (JSON + embedded buffers, no textures, no scripts) was used.

## What was changed (assets/humans/tools/pack.mjs)

* all primitives of a character merged into one skinned mesh; materials replaced by
  a per-vertex material index + colour table (the crowd re-tints clothes, skin and hair);
* the pistol the "Suit" character holds was removed;
* vertices welded, creased normals recomputed, attributes quantised;
* two simplified LODs added (meshoptimizer);
* animations reduced to Walk, Run, Idle, Idle_Neutral, Wave, Interact.

At runtime (`js/npc/humans.js`) further clips are derived procedurally from those
(sit, eat, phone, photo, bow, nod, browse, cart, suitcase…) and simple accessory
shapes (bags, suitcase, cap, apron, mask, phone, cup) are added.

## Fallback

If these files fail to load, the crowd falls back to the procedural v1 people
(`js/npc/humanGeo.js`, our own code).
