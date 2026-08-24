// ==============================================================
//  DATA LAYER
//  Streams score records from Firebase (Firestore or Realtime
//  Database) and falls back to a local simulator when Firebase
//  isn't set up.
//
//  Emits a flat list of entries — one per (player, game):
//     [{ playerId, name, gameId, score }]
//  The view groups and ranks them, so switching game tabs costs
//  no extra reads.
// ==============================================================

import {
  firebaseConfig, BACKEND, SCHEMA, PLAYERS_PATH, GAMES,
} from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.5";

/** gameId used when SCHEMA === "flat" (single-game boards). */
export const SOLO_GAME = "__solo__";

const isConfigured = () =>
  Boolean(firebaseConfig.apiKey) &&
  (BACKEND === "rtdb" ? Boolean(firebaseConfig.databaseURL)
                      : Boolean(firebaseConfig.projectId));

/** One Firebase app shared by the live listener and the score writer. */
let appPromise = null;
async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp } = await import(`${SDK}/firebase-app.js`);
      return initializeApp(firebaseConfig);
    })();
  }
  return appPromise;
}

/** RTDB keys cannot contain . # $ [ ] or / */
const isSafeKey = (k) => typeof k === "string" && k.length > 0 && !/[.#$/[\]]/.test(k);

/**
 * Write one finished run.
 *
 * Personal-best is enforced by the security rules, not here -- a rule that
 * rejects a lower score comes back as PERMISSION_DENIED, which this reports as
 * "not a personal best" rather than as a failure. See database.rules.json.
 *
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function submitScore({ playerId, name, gameId, score }) {
  if (!isSafeKey(playerId)) return { ok: false, reason: "bad playerId" };
  if (!isSafeKey(gameId))   return { ok: false, reason: "bad gameId" };

  const value = Math.round(Number(score));
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, reason: `score is not a usable number: ${score}` };
  }

  if (!isConfigured()) {
    return { ok: false, reason: "demo mode - firebase-config.js has no credentials" };
  }

  const record = {
    name: String(name || "").slice(0, 16),
    score: value,
    updatedAt: Date.now(),
  };

  try {
    const app = await getApp();

    if (BACKEND === "rtdb") {
      const { getDatabase, ref, set } = await import(`${SDK}/firebase-database.js`);
      await set(ref(getDatabase(app), `${PLAYERS_PATH}/${playerId}/${gameId}`), record);
    } else {
      const { getFirestore, doc, setDoc } = await import(`${SDK}/firebase-firestore.js`);
      await setDoc(
        doc(getFirestore(app), PLAYERS_PATH, `${playerId}__${gameId}`),
        { playerId, gameId, ...record }
      );
    }
    return { ok: true };
  } catch (err) {
    const code = String(err?.code || err).toUpperCase();
    if (code.includes("PERMISSION")) {
      return { ok: false, reason: "rejected by rules - most likely not a personal best" };
    }
    return { ok: false, reason: String(err?.message || err) };
  }
}

/**
 * @param {(entries:Array)=>void} onData
 * @param {(status:{mode:string,label:string,detail?:string})=>void} onStatus
 * @returns {Promise<()=>void>} unsubscribe
 */
export async function subscribePlayers(onData, onStatus) {
  if (!isConfigured()) {
    onStatus({ mode: "demo", label: "DEMO MODE", detail: "SIMULATED PLAYERS" });
    return startDemo(onData);
  }

  try {
    const app = await getApp();

    return BACKEND === "rtdb"
      ? await listenRealtimeDb(app, onData, onStatus)
      : await listenFirestore(app, onData, onStatus);
  } catch (err) {
    console.error("[leaderboard] Firebase failed, using demo data:", err);
    onStatus({ mode: "error", label: "OFFLINE", detail: String(err.message || err) });
    return startDemo(onData);
  }
}

/* ── Favourite-game poll ──────────────────────────────────
   One vote per player, stored as poll/{playerId} = gameId, so a second vote
   replaces the first rather than stuffing the ballot. Tallying happens on the
   client -- the vote count is tiny and this avoids needing a counter that
   several writers would race on.
------------------------------------------------------------------ */
export const POLL_PATH = "poll";

/** @returns {Promise<()=>void>} unsubscribe */
export async function subscribePoll(onTally) {
  if (!isConfigured()) {
    onTally({ tally: {}, total: 0, live: false });
    return () => {};
  }

  const app = await getApp();
  const { getDatabase, ref, onValue, off } = await import(`${SDK}/firebase-database.js`);
  const node = ref(getDatabase(app), POLL_PATH);

  onValue(
    node,
    (snap) => {
      const votes = snap.val() || {};
      const tally = {};
      let total = 0;
      for (const gameId of Object.values(votes)) {
        if (typeof gameId !== "string") continue;
        tally[gameId] = (tally[gameId] || 0) + 1;
        total++;
      }
      onTally({ tally, total, live: true });
    },
    (err) => {
      console.error("[poll] listener error:", err);
      onTally({ tally: {}, total: 0, live: false });
    }
  );

  return () => off(node);
}

/** @returns {Promise<{ok:boolean, reason?:string}>} */
export async function castVote(playerId, gameId) {
  if (!isSafeKey(playerId)) return { ok: false, reason: "bad playerId" };
  if (!GAMES.some((g) => g.id === gameId)) {
    return { ok: false, reason: `unknown game: ${gameId}` };
  }
  if (!isConfigured()) {
    return { ok: false, reason: "demo mode - firebase-config.js has no credentials" };
  }

  try {
    const app = await getApp();
    const { getDatabase, ref, set } = await import(`${SDK}/firebase-database.js`);
    await set(ref(getDatabase(app), `${POLL_PATH}/${playerId}`), gameId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
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
      onData(snap.docs.flatMap((d) => toEntries(d.id, d.data())));
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
      onData(Object.entries(val).flatMap(([key, rec]) => toEntries(key, rec)));
    },
    (err) => {
      console.error("[leaderboard] RTDB listener error:", err);
      onStatus({ mode: "error", label: "ERROR", detail: err.code || "READ FAILED" });
    }
  );

  return () => off(node);
}

/* ── Record -> entries ───────────────────────────────────
   Handles the storage layouts so existing data just works:
     flat            : { name, score }                    -> 1 entry
     multi, doc      : { playerId, name, gameId, score }  -> 1 entry
     multi, wrapped  : { name, scores: { gameId: ... } }  -> N entries
     multi, RTDB     : { gameId: { name, score } }        -> N entries
                       i.e. scores/{playerId}/{gameId}, which is what the
                       games actually write. This last shape used to fall
                       through to the single-record branch and render the
                       playerId as the name with a score of 0.
------------------------------------------------------------------ */
const SCORE_KEYS = ["score", "points", "value"];

/** Keys that describe the player, not a game. */
const META_KEYS = new Set([
  "name", "player", "username", "displayName",
  "playerId", "uid", "updatedAt", "scores", "games",
]);

const hasScore = (v) =>
  v && typeof v === "object" && SCORE_KEYS.some((k) => k in v);

/** Are this record's own children per-game scores rather than fields? */
function perGameChildren(rec) {
  if (hasScore(rec)) return null;               // it is a single score record
  const entries = Object.entries(rec).filter(([k]) => !META_KEYS.has(k));
  if (entries.length === 0) return null;
  const looksRight = entries.every(
    ([, v]) => hasScore(v) || typeof v === "number"
  );
  return looksRight ? Object.fromEntries(entries) : null;
}

function toEntries(key, rec = {}) {
  if (SCHEMA === "flat") {
    return [{
      playerId: String(key),
      name: pickName(rec, key),
      gameId: SOLO_GAME,
      score: pickScore(rec),
    }];
  }

  // playerId comes from the record when present, else from the doc id.
  // Doc ids are written as `${playerId}__${gameId}`.
  const [idPart] = String(key).split("__");
  const playerId = String(rec.playerId ?? rec.uid ?? idPart);
  const name = pickName(rec, playerId);

  const wrapped = rec.scores ?? rec.games ?? null;
  const nested =
    (wrapped && typeof wrapped === "object") ? wrapped : perGameChildren(rec);

  if (nested) {
    return Object.entries(nested).map(([gameId, v]) => ({
      playerId,
      // With the RTDB layout the name lives inside each game record, because
      // that is the only thing the writer knows at the time.
      name: typeof v === "object" ? pickName(v, name) : name,
      gameId: String(gameId),
      score: typeof v === "object" ? pickScore(v) : Number(v) || 0,
    }));
  }

  const gameId = String(rec.gameId ?? rec.game ?? GAMES[0]?.id ?? SOLO_GAME);
  return [{ playerId, name, gameId, score: pickScore(rec) }];
}

const pickName = (rec, fallback) =>
  String(rec.name ?? rec.player ?? rec.username ?? rec.displayName ?? fallback);

function pickScore(rec) {
  // totalScore is what the deployed Unity build writes; the rest are the
  // shapes earlier/other builds have used. pickName already covers its
  // matching "username" field.
  const raw = rec?.score ?? rec?.totalScore ?? rec?.points ?? rec?.value ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
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
  const games = SCHEMA === "flat"
    ? [SOLO_GAME]
    : (GAMES.length ? GAMES.map((g) => g.id) : [SOLO_GAME]);

  // Not everyone has played everything — mirrors real data.
  const entries = [];
  DEMO_NAMES.forEach((name, i) => {
    games.forEach((gameId, gi) => {
      if (games.length > 1 && (i + gi) % 5 === 0) return; // skip some
      entries.push({
        playerId: `demo-${i}`,
        name,
        gameId,
        score: Math.floor(1500 + Math.random() * 22000),
      });
    });
  });

  onData(entries.map((e) => ({ ...e })));

  const timer = setInterval(() => {
    const bumps = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bumps; i++) {
      const e = entries[Math.floor(Math.random() * entries.length)];
      e.score += Math.floor(Math.random() * 2200) + 150;
    }
    onData(entries.map((e) => ({ ...e })));
  }, 1600);

  return () => clearInterval(timer);
}
