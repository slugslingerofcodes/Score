// ==============================================================
//  DATA LAYER
//  Streams players from Firebase (Firestore or Realtime Database)
//  and falls back to a local simulator when Firebase isn't set up.
//  Emits: [{ id, name, score }]  — unsorted; the view ranks them.
// ==============================================================

import { firebaseConfig, BACKEND, PLAYERS_PATH } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.5";

const isConfigured = () =>
  Boolean(firebaseConfig.apiKey) &&
  (BACKEND === "rtdb" ? Boolean(firebaseConfig.databaseURL)
                      : Boolean(firebaseConfig.projectId));

/**
 * @param {(players:Array)=>void} onData
 * @param {(status:{mode:string,label:string,detail?:string})=>void} onStatus
 * @returns {Promise<()=>void>} unsubscribe
 */
export async function subscribePlayers(onData, onStatus) {
  if (!isConfigured()) {
    onStatus({ mode: "demo", label: "DEMO MODE", detail: "SIMULATED PLAYERS" });
    return startDemo(onData);
  }

  try {
    const { initializeApp } = await import(`${SDK}/firebase-app.js`);
    const app = initializeApp(firebaseConfig);

    return BACKEND === "rtdb"
      ? await listenRealtimeDb(app, onData, onStatus)
      : await listenFirestore(app, onData, onStatus);
  } catch (err) {
    console.error("[leaderboard] Firebase failed, using demo data:", err);
    onStatus({ mode: "error", label: "OFFLINE", detail: String(err.message || err) });
    return startDemo(onData);
  }
}

/* ── Firestore ───────────────────────────────────────────────── */
async function listenFirestore(app, onData, onStatus) {
  const { getFirestore, collection, onSnapshot } =
    await import(`${SDK}/firebase-firestore.js`);

  const db = getFirestore(app);

  return onSnapshot(
    collection(db, PLAYERS_PATH),
    (snap) => {
      onStatus({ mode: "live", label: "LIVE", detail: "FIRESTORE" });
      onData(snap.docs.map((d) => normalise(d.id, d.data())));
    },
    (err) => {
      console.error("[leaderboard] Firestore listener error:", err);
      onStatus({ mode: "error", label: "ERROR", detail: err.code || "READ FAILED" });
    }
  );
}

/* ── Realtime Database ───────────────────────────────────────── */
async function listenRealtimeDb(app, onData, onStatus) {
  const { getDatabase, ref, onValue, off } =
    await import(`${SDK}/firebase-database.js`);

  const db = getDatabase(app);
  const node = ref(db, PLAYERS_PATH);

  onValue(
    node,
    (snap) => {
      onStatus({ mode: "live", label: "LIVE", detail: "REALTIME DB" });
      const val = snap.val() || {};
      onData(Object.entries(val).map(([id, rec]) => normalise(id, rec)));
    },
    (err) => {
      console.error("[leaderboard] RTDB listener error:", err);
      onStatus({ mode: "error", label: "ERROR", detail: err.code || "READ FAILED" });
    }
  );

  return () => off(node);
}

/* Accepts a few common field spellings so existing data just works. */
function normalise(id, rec = {}) {
  const name = rec.name ?? rec.player ?? rec.username ?? rec.displayName ?? id;
  const raw = rec.score ?? rec.points ?? rec.value ?? 0;
  const score = Number(raw);
  return { id: String(id), name: String(name), score: Number.isFinite(score) ? score : 0 };
}

/* ── Demo simulator ──────────────────────────────────────────── */
const DEMO_NAMES = [
  "PIXELPETE", "NOVA_X", "BYTEWITCH", "GLITCHKID", "TURBO_RAE",
  "CRT_KING", "ZAPDOT", "MEGAMARU", "VOIDCAT", "SYNTH_LO",
  "8BITBANDIT", "ARCADEANA", "NEONVOLT", "QUASARQ", "DITHERDAN",
  "SPRITELY", "HEXHOUND", "COINOP_JO", "LOOPLARA", "RETRORYU",
  "STATICSAM", "VECTORVI", "BLIPBLOP", "MAXCOMBO",
];

function startDemo(onData) {
  const players = DEMO_NAMES.map((name, i) => ({
    id: `demo-${i}`,
    name,
    score: Math.floor(3000 + Math.random() * 45000),
  }));

  onData(players.map((p) => ({ ...p })));

  // Nudge a few random players every tick so rows overtake each other.
  const timer = setInterval(() => {
    const bumps = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bumps; i++) {
      const p = players[Math.floor(Math.random() * players.length)];
      p.score += Math.floor(Math.random() * 2600) + 150;
    }
    onData(players.map((p) => ({ ...p })));
  }, 1600);

  return () => clearInterval(timer);
}
