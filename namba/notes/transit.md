# Transit (trains, platforms, gates, boards, timetable) — running log

Owner files: `js/world/transit.js`, `js/world/transit/*`.

## Claimed scope (so other areas don't duplicate)
* Everything *inside the track pits* of B2 (Midosuji, Sennichimae) and 3F (Nankai):
  sleepers/rails/third rail/catenary, the **ceiling over the track pits** (station
  section), the **tunnel extensions** beyond the platform ends (subway) and the
  **viaduct + shed roof over the tracks** for Nankai (3F, z -62..230).
* Platform screen doors (可動式ホーム柵), door-position floor markings, queue lines,
  car numbers, Nankai car-stop markers and buffer stops.
* Ticket gate machines + flaps (on `LAYOUT.gates` / `gt.machines`), gate fences
  (on `gt.fence`), staff booths, ticket vending / fare adjustment machines and the
  fare charts above them, operational departure boards (pois kind
  `departureBoard` + small platform boards).

(work in progress — APIs below)
