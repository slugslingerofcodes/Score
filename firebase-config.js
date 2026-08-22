// ==============================================================
//  FIREBASE CONFIG  —  fill this in to go live.
//  Firebase console -> Project settings -> Your apps -> Web app.
//  Until `apiKey` is filled, the board runs in DEMO mode with
//  simulated players so you can see the live re-ordering.
// ==============================================================

export const firebaseConfig = {
  apiKey:            "",
  authDomain:        "",
  projectId:         "",
  storageBucket:     "",
  messagingSenderId: "",
  appId:             "",
  // Only needed for the Realtime Database backend:
  databaseURL:       "",
};

// Which Firebase product holds the scores:
//   "firestore" -> collection of documents  (default)
//   "rtdb"      -> Realtime Database node
export const BACKEND = "firestore";

// Firestore collection name, or RTDB path.
export const PLAYERS_PATH = "players";

// How many players get a numbered placement.
export const RANKED_COUNT = 10;

// Expected shape of each player record:
//   { name: "PIXELPETE", score: 48200 }
// The document id / RTDB key is used as the stable player id, so a
// player keeps their row (and animates) across score updates.
