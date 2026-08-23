# Pixel Leaderboard

A live scoreboard in a pixel-art sunset theme. Scores stream from Firebase and
rows physically slide past each other the moment a player overtakes another.

- **Top 10** get a numbered placement (1-3 wear gold / silver / bronze).
- **Everyone below** is listed as `--` / `UNRANKED`, separated by a cutoff line.
- **Multiple games** feed one board: tab between a combined table and each game.
- No build step, no dependencies — plain HTML/CSS/ES modules.

Hooking up Unity games? See **[FIREBASE_SETUP.md](FIREBASE_SETUP.md)** — it
covers generating both configs, cross-game player identity, and rules.

## Run it

```bash
python -m http.server 5180
```

Then open <http://localhost:5180>. (It must be served over http, not opened as a
`file://` path, because it uses ES modules.)

With no Firebase keys filled in, it boots in **DEMO MODE** with 24 simulated
players whose scores tick every 1.6s — that's the fastest way to see the
overtake animation.

## Connect Firebase

Fill in [firebase-config.js](firebase-config.js) from
**Firebase console → Project settings → Your apps → Web app**:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  appId: "1:...:web:...",
};

export const BACKEND = "firestore";  // or "rtdb"
export const SCHEMA  = "multi-game"; // or "flat" for a single game
export const PLAYERS_PATH = "scores";
export const SCORE_MODE = "total";   // combined tab: "total" or "best"
export const RANKED_COUNT = 10;      // how many get a number
```

The chip under the title turns green and reads **LIVE** once a snapshot lands.

### Data shape

**multi-game** — one record per (player, game). The doc id is
`` `${playerId}__${gameId}` ``, so each game only ever writes its own row and
three games can submit at once without clobbering each other:

```
scores/u_7fa2__neon-runner = {
  playerId: "u_7fa2", name: "PIXELPETE", gameId: "neon-runner", score: 48200
}
```

Realtime Database nests instead — `scores/{playerId}/{gameId} = { name, score }`.

**flat** — one record per player, for a single game:

```
players/{playerId}  ->  { name: "PIXELPETE", score: 48200 }
```

`playerId` is what links a player across games, so every build must produce the
same one for the same human — the common trip-up, covered in
[FIREBASE_SETUP.md](FIREBASE_SETUP.md#4-make-the-player-the-same-player-in-all-three-games).

`name` also accepts `player`, `username`, or `displayName`; `score` also accepts
`points` or `value`. Grouping and sorting happen in the browser, so no Firestore
composite index is needed and switching tabs costs no extra reads.

### Writing scores

From Unity, use [unity/LeaderboardClient.cs](unity/LeaderboardClient.cs) — one
call on game over:

```csharp
LeaderboardClient.Instance.SubmitScore(finalScore);
```

From JS, write to the same path — the board updates itself:

```js
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "scores", `${playerId}__${gameId}`),
             { playerId, name, gameId, score }, { merge: true });
```

### Read rules

The board only reads. For a public scoreboard where only your backend writes:

```
// Firestore
match /players/{id} {
  allow read: if true;
  allow write: if false;   // writes go through the Admin SDK
}
```

## Files

| File | Role |
| --- | --- |
| [index.html](index.html) | Markup, game tabs, the pixel sky scene |
| [styles.css](styles.css) | Theme, pixel borders, medals, animations |
| [firebase-config.js](firebase-config.js) | Your keys, backend, game list |
| [data.js](data.js) | Firebase subscription, demo fallback |
| [app.js](app.js) | Aggregation, rendering, FLIP reordering, avatars |
| [unity/LeaderboardClient.cs](unity/LeaderboardClient.cs) | Drop-in Unity writer (same file in all games) |
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | Config generation, identity, rules |

## How the live movement works

Each render measures every row's position, re-sorts the DOM, measures again,
then plays the difference back as a transform (the FLIP technique). Elements are
reused by player id, so a row that jumps from #7 to #4 animates the whole way.
Rows that gained places flash bright with an up chevron; rows that lost places
dim with a down chevron. Score numbers count up rather than snapping.

Tuning knobs: `MOVE_MS` in [app.js](app.js) (slide duration), `RANKED_COUNT` in
[firebase-config.js](firebase-config.js), and the `--sky-*` / `--ink-*` colour
tokens at the top of [styles.css](styles.css).
