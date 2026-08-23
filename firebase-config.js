// ==============================================================
//  FIREBASE CONFIG  —  fill this in to go live.
//  Firebase console -> Project settings -> Your apps -> Web app.
//  Until `apiKey` is filled, the board runs in DEMO mode with
//  simulated players so you can see the live re-ordering.
//
//  This object is meant to ship in the browser. It identifies the
//  project; it does not authorise anything. Access is controlled by
//  security rules (see FIREBASE_SETUP.md).
// ==============================================================

export const firebaseConfig = {
  apiKey:            "AIzaSyBpdQErT31nzZMAXCWzGS5D_zXn4geRFaE",
  authDomain:        "preinduction-858b9.firebaseapp.com",
  projectId:         "preinduction-858b9",
  storageBucket:     "preinduction-858b9.firebasestorage.app",
  messagingSenderId: "241785720919",
  appId:             "1:241785720919:web:3f1fbb66d5275800b79312",
  measurementId:     "G-W095PECS71",
  // Only needed for the Realtime Database backend. Note the region in the
  // host name -- this project is asia-southeast1, not the default us-central1,
  // and the SDK will not find it without the full URL.
  databaseURL:       "https://preinduction-858b9-default-rtdb.asia-southeast1.firebasedatabase.app",
};

// Which Firebase product holds the scores:
//   "firestore" -> collection of documents  (default)
//   "rtdb"      -> Realtime Database node
export const BACKEND = "rtdb";

// ── Schema ────────────────────────────────────────────────────
//   "multi-game" -> one record per (player, game); the board can show
//                   a combined table or filter to a single game.
//   "flat"       -> one record per player, single score. (Original shape.)
export const SCHEMA = "multi-game";

// Firestore collection name, or RTDB path.
//   multi-game -> "scores"
//   flat       -> "players"
export const PLAYERS_PATH = "scores";

// ── Your games ────────────────────────────────────────────────
// `id` must match the gameId each Unity build writes. `label` is the
// tab caption. Add or remove entries freely; tabs are generated.
export const GAMES = [
  { id: "platformer", label: "PLATFORMER" },
  { id: "topdown",    label: "TOP-DOWN"   },
  { id: "blackjack",  label: "BLACKJACK"  },
];

// How the "ALL GAMES" tab combines a player's scores:
//   "total" -> sum across every game they've played
//   "best"  -> their single highest game score
export const SCORE_MODE = "total";

// Show the combined tab at all. False = per-game boards only.
export const SHOW_COMBINED = true;

// How many players get a numbered placement.
export const RANKED_COUNT = 10;

// ── Record shapes ─────────────────────────────────────────────
//  multi-game, Firestore — doc id `${playerId}__${gameId}`:
//    scores/u_7fa2__neon-runner = {
//      playerId: "u_7fa2", name: "PIXELPETE",
//      gameId: "neon-runner", score: 48200
//    }
//
//  multi-game, Realtime Database:
//    scores/{playerId}/{gameId} = { name, score }
//
//  `playerId` is what links a player across all three games, so every
//  build must agree on it. See FIREBASE_SETUP.md.
