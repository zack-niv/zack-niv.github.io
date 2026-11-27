# Score service (v22)

The scoreboard on the finish screen talks to a tiny service deployed on Vercel as the project `namba-scores`
(`https://namba-scores-zacks.vercel.app`). This folder is its source; the game does not load anything from here.

- `GET /api/scores` returns the top 10 and the total.
- `POST /api/score` stores one run and returns its rank.
- Each score is one small blob in a Vercel Blob store connected to the project; the blob's name holds all the fields.
- The service needs the Blob store's `BLOB_READ_WRITE_TOKEN` (added by connecting the store) and, optionally,
  `ADMIN_KEY` to allow `DELETE /api/score?key=…&name=ABC&score=1234` for removing an entry.

The browser sends the two leg times and whether the coffee was bought; the service works out the score itself
(the same rule as `js/game/mission.js`: keep the two in step). Times can still be faked, so the service only
refuses impossible ones.
