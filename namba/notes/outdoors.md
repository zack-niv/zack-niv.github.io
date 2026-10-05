# Outdoors & Namba Parks — running log

Owner files: `js/world/exterior.js`, `js/world/parks.js`, `js/world/outdoor/*`.

## Cross-area edits / requests
* **architecture.js (one line, additive):** WALL edges whose walkable side is an
  `outdoor` space are no longer drawn by Architecture (collision unchanged):
  `if (e.kind === EDGE.WALL && walkSp && walkSp.outdoor) continue;`
  Exterior/Parks dress those boundaries (shop facades, kerbs + guard rails,
  canyon strata, terrace parapets, bridge glass rails). Architecture lead:
  please keep this rule (or an equivalent flag) if you rewrite the wall pass.
