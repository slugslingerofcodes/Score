// ==============================================================
//  ARCADE PAGE
//  Owns the cabinet: who you are, the gate in front of the
//  download, the Unity frame's lifecycle, and a live top-5 beside
//  it that follows whichever game you are playing.
//
//  The player is an <iframe> on purpose. unityInstance.Quit() does
//  not reliably release the wasm heap; removing the element does,
//  and this page keeps a Firebase listener open alongside it.
// ==============================================================

import { buildSky } from "./sky.js";
import { subscribePlayers, submitScore, subscribePoll, castVote } from "./data.js";
import { GAMES } from "./firebase-config.js";

const FRAME_SRC  = "./game/index.html";
const RAIL_COUNT = 5;
const ID_KEY     = "arcade.playerId";
const NAME_KEY   = "arcade.playerName";

const $ = (id) => document.getElementById(id);

const arcade      = $("arcade");
const desktopOnly = $("desktopOnly");
const screenEl    = $("screen");
const cabinet     = document.querySelector(".cabinet");
const gate        = $("gate");
const gateForm    = $("gateForm");
const nameInput   = $("nameInput");
const nameErr     = $("nameErr");
const loading     = $("loading");
const loadingLabel= $("loadingLabel");
const barFill     = $("barFill");
const screenErr   = $("screenErr");
const cabTitle    = $("cabTitle");
const fsBtn       = $("fsBtn");
const exitBtn     = $("exitBtn");
const railName    = $("railName");
const railTitle   = $("railTitle");
const railHint    = $("railHint");
const railSrc     = $("railSrc");
const miniboard   = $("miniboard");
const railEmpty   = $("railEmpty");
const pollOptions = $("pollOptions");
const pollTotal   = $("pollTotal");
const pollNote    = $("pollNote");

/** The live Unity frame, or null when the cabinet is idle. */
let frame = null;
/** gameId currently being played, or null for "nothing started yet". */
let activeGame = null;
/** last snapshot from Firebase */
let entries = [];

/* ── identity ────────────────────────────────────────────────────
   Name entry lives here rather than in a Unity TMP_InputField:
   text input in WebGL is awkward (IME, focus theft) and the page
   already has a real one. The id is what links a player across all
   three games, so it is minted once and kept.
------------------------------------------------------------------ */
function loadIdentity() {
  try {
    return {
      id: localStorage.getItem(ID_KEY) || "",
      name: localStorage.getItem(NAME_KEY) || "",
    };
  } catch {
    return { id: "", name: "" }; // private mode / storage disabled
  }
}

function saveIdentity(name) {
  const current = loadIdentity();
  const id = current.id || mintId(name);
  try {
    localStorage.setItem(ID_KEY, id);
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* not fatal — the run just won't be recognised next visit */
  }
  return { id, name };
}

function mintId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slug || "player"}_${rand}`;
}

function cleanName(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

/* ── the gate ──────────────────────────────────────────────────── */
function initGate() {
  const known = loadIdentity();
  if (known.name) {
    nameInput.value = known.name;
    railName.textContent = known.name;
  }

  gateForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = cleanName(nameInput.value);
    if (name.length < 2) {
      nameErr.hidden = false;
      nameErr.textContent = "AT LEAST 2 CHARACTERS";
      nameInput.focus();
      return;
    }

    nameErr.hidden = true;
    nameInput.value = name;
    saveIdentity(name);
    railName.textContent = name;
    startGame();
  });

  nameInput.addEventListener("input", () => { nameErr.hidden = true; });
}

/* ── frame lifecycle ───────────────────────────────────────────── */
function startGame() {
  if (frame) return;

  gate.hidden = true;
  screenErr.hidden = true;
  loading.hidden = false;
  setProgress(0);

  frame = document.createElement("iframe");
  frame.src = FRAME_SRC;
  frame.title = "Game";
  frame.allow = "autoplay; fullscreen; gamepad";
  frame.setAttribute("allowfullscreen", "");
  screenEl.appendChild(frame);

  fsBtn.hidden = false;
  exitBtn.hidden = false;
  cabTitle.textContent = "◈ LOADING";
}

function stopGame() {
  if (typeof exitFullscreen === "function") exitFullscreen();
  if (frame) {
    frame.remove();     // this, not Quit(), is what frees the heap
    frame = null;
  }
  loading.hidden = true;
  screenErr.hidden = true;
  gate.hidden = false;
  fsBtn.hidden = true;
  exitBtn.hidden = true;
  activeGame = null;
  cabTitle.textContent = "◈ SELECT A GAME";
  renderRail();
}

function setProgress(value) {
  const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
  barFill.style.width = `${pct}%`;
  loadingLabel.textContent = `LOADING ${pct}%`;
}

function postToGame(message) {
  if (!frame || !frame.contentWindow) return;
  frame.contentWindow.postMessage(message, location.origin);
}

function showScreenError(message) {
  loading.hidden = true;
  screenErr.hidden = false;
  screenErr.textContent = String(message || "SOMETHING WENT WRONG");
}

/* ── game -> page ──────────────────────────────────────────────── */
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (!frame || event.source !== frame.contentWindow) return;

  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "progress":
      setProgress(msg.value);
      break;

    case "ready": {
      loading.hidden = true;
      cabTitle.textContent = "◈ SELECT A GAME";
      const me = loadIdentity();
      postToGame({ type: "set-name", name: me.name, playerId: me.id });
      break;
    }

    case "run-start":
      activeGame = String(msg.gameId || "") || null;
      cabTitle.textContent = `◈ ${labelFor(activeGame)}`;
      renderRail();
      break;

    case "run-end":
      onRunEnd(msg.gameId, msg.score);
      break;

    case "error":
      showScreenError(msg.message);
      break;

    case "pong":
      // Answer to a "ping" -- proves the .jslib -> ArcadeHostPost -> page half
      // of the bridge is wired, without having to play a whole run.
      console.log("[arcade] bridge round-trip OK");
      break;

    case "unity-banner":
      console.warn("[arcade] unity:", msg.level, msg.message);
      break;
  }
});

/* ── a run finished ────────────────────────────────────────
   The page writes the score, not the game. The Firebase SDK is already loaded
   here for the live board, so this avoids CORS, token handling and a queue in
   C#. Personal-best is a security rule, so a lower score coming back rejected
   is a normal outcome, not an error.
------------------------------------------------------------------ */
async function onRunEnd(gameId, score) {
  const label = `◈ ${labelFor(gameId)} — ${fmt(score)}`;
  cabTitle.textContent = `${label} · SAVING`;

  const me = loadIdentity();
  const result = await submitScore({
    playerId: me.id,
    name: me.name,
    gameId,
    score,
  });

  cabTitle.textContent = `${label} · ${result.ok ? "SAVED" : "NOT SAVED"}`;

  if (!result.ok) {
    console.warn(`[arcade] ${gameId}=${score} not saved: ${result.reason}`);
  }
}

/* ── controls ──────────────────────────────────────────────────── */
/* Fullscreen.
   The native Fullscreen API is best-effort only: it needs a user gesture and
   can be refused outright by policy, and when it is refused the button used to
   do nothing at all. So the source of truth is a CSS class that pins the
   cabinet over the entire page -- that alone makes the game cover the whole
   site -- and native fullscreen is layered on top when the browser allows it.
------------------------------------------------------------------ */
const MAXIMIZED = "is-maximized";

function isMaximized() {
  return cabinet.classList.contains(MAXIMIZED);
}

function syncFullscreenButton() {
  const on = isMaximized();
  fsBtn.textContent = on ? "EXIT FULL" : "FULLSCREEN";
  fsBtn.setAttribute("aria-pressed", String(on));
  // Nothing should scroll behind the game while it covers the page.
  document.body.style.overflow = on ? "hidden" : "";
}

function nudgeFrameResize() {
  // Unity sizes its canvas off a window resize. The iframe fires one when it
  // changes size, but a missed event leaves the game rendering at the old
  // resolution inside a full-page canvas.
  if (frame && frame.contentWindow) {
    frame.contentWindow.dispatchEvent(new Event("resize"));
  }
}

async function enterFullscreen() {
  cabinet.classList.add(MAXIMIZED);   // covers the site immediately
  syncFullscreenButton();
  nudgeFrameResize();

  try {
    const request = cabinet.requestFullscreen ?? cabinet.webkitRequestFullscreen;
    if (request) await request.call(cabinet, { navigationUI: "hide" });
  } catch (err) {
    // Refused: the page-covering state above still stands, so this is a
    // downgrade rather than a failure.
    console.info("[arcade] native fullscreen refused, staying page-maximised:", err?.message || err);
  }
  nudgeFrameResize();
}

async function exitFullscreen() {
  cabinet.classList.remove(MAXIMIZED);
  syncFullscreenButton();

  try {
    if (document.fullscreenElement) {
      await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
    }
  } catch { /* already out */ }
  nudgeFrameResize();
}

fsBtn.addEventListener("click", () => {
  isMaximized() ? exitFullscreen() : enterFullscreen();
});

// Leaving native fullscreen (Escape, F11, the browser chrome) must not leave
// the page stuck in the maximised state.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && isMaximized()) exitFullscreen();
  else nudgeFrameResize();
});

exitBtn.addEventListener("click", stopGame);

// Leaving the page should not leave a wasm heap behind.
window.addEventListener("pagehide", () => {
  if (frame) frame.remove();
});

/* ── the rail ────────────────────────────────────────────────────
   A deliberately small renderer rather than a reuse of app.js,
   whose FLIP logic is bound to #board and #empty.
------------------------------------------------------------------ */
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

function labelFor(gameId) {
  const g = GAMES.find((x) => x.id === gameId);
  return g ? (g.label || g.id) : String(gameId || "GAME").toUpperCase();
}

function initRail() {
  subscribePlayers(
    (next) => { entries = next; renderRail(); },
    (status) => {
      railHint.textContent = status.label;
      railSrc.textContent = `SOURCE: ${status.detail || status.label}`;
    }
  ).catch((err) => {
    console.error("[arcade] rail failed:", err);
    railHint.textContent = "OFFLINE";
    railSrc.textContent = "SOURCE: SEE CONSOLE";
  });
}

function rank() {
  const byPlayer = new Map();

  for (const e of entries) {
    if (activeGame && e.gameId !== activeGame) continue;

    let p = byPlayer.get(e.playerId);
    if (!p) {
      p = { id: e.playerId, name: e.name, perGame: new Map() };
      byPlayer.set(e.playerId, p);
    }
    if (e.name) p.name = e.name;
    const prev = p.perGame.get(e.gameId) ?? -Infinity;
    p.perGame.set(e.gameId, Math.max(prev, e.score));
  }

  const out = [];
  for (const p of byPlayer.values()) {
    const values = [...p.perGame.values()];
    // one game selected -> that score; nothing selected -> the combined total,
    // matching the board's "ALL GAMES" tab.
    p.score = activeGame ? (values[0] ?? 0) : values.reduce((a, b) => a + b, 0);
    out.push(p);
  }

  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function renderRail() {
  railTitle.textContent = activeGame
    ? `◈ ${labelFor(activeGame)}`
    : `◈ TOP ${RAIL_COUNT} — ALL GAMES`;

  const me = loadIdentity();
  const top = rank().slice(0, RAIL_COUNT);

  railEmpty.hidden = top.length > 0;

  miniboard.replaceChildren(
    ...top.map((p, i) => {
      const li = document.createElement("li");
      const place = i < 3 ? ` minirow--${i + 1}` : "";
      const mine = me.id && p.id === me.id ? " minirow--me" : "";
      li.className = `minirow${place}${mine}`;

      const rankCell = document.createElement("span");
      rankCell.className = "minirow__rank";
      rankCell.textContent = String(i + 1);

      const nameCell = document.createElement("span");
      nameCell.className = "minirow__name";
      nameCell.textContent = p.name;

      const scoreCell = document.createElement("span");
      scoreCell.className = "minirow__score";
      scoreCell.textContent = fmt(p.score);

      li.append(rankCell, nameCell, scoreCell);
      return li;
    })
  );
}

/* ── favourite-game poll ──────────────────────────────────
   Sits under the scoreboard. One vote per player, keyed on the same id the
   scores use, so voting twice moves the vote instead of adding one.
------------------------------------------------------------------ */
const VOTE_KEY = "arcade.vote";

let pollTally = { tally: {}, total: 0, live: false };

function myVote() {
  try { return localStorage.getItem(VOTE_KEY) || ""; } catch { return ""; }
}

function rememberVote(gameId) {
  try { localStorage.setItem(VOTE_KEY, gameId); } catch { /* private mode */ }
}

function buildPoll() {
  pollOptions.replaceChildren(
    ...GAMES.map((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pollopt";
      b.dataset.game = g.id;

      const bar = document.createElement("span");
      bar.className = "pollopt__bar";

      const label = document.createElement("span");
      label.className = "pollopt__label";
      label.textContent = g.label || g.id;

      const count = document.createElement("span");
      count.className = "pollopt__count";
      count.textContent = "0";

      b.append(bar, label, count);
      b.addEventListener("click", () => vote(g.id));
      return b;
    })
  );
  renderPoll();
}

function renderPoll() {
  const { tally, total } = pollTally;
  const mine = myVote();

  pollTotal.textContent = `${total} VOTE${total === 1 ? "" : "S"}`;

  for (const b of pollOptions.querySelectorAll(".pollopt")) {
    const id = b.dataset.game;
    const n = tally[id] || 0;
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;

    b.querySelector(".pollopt__bar").style.width = `${pct}%`;
    b.querySelector(".pollopt__count").textContent = total ? `${n} · ${pct}%` : "—";
    b.classList.toggle("pollopt--mine", id === mine);
    b.setAttribute("aria-pressed", String(id === mine));
  }
}

async function vote(gameId) {
  // Voting must not require launching the game. A first-time visitor has no
  // id yet, and making them download 13 MB to answer a poll is absurd -- so
  // mint one here, seeded from the name field if they have typed one.
  let me = loadIdentity();
  if (!me.id) {
    me = saveIdentity(cleanName(nameInput.value) || "ANON");
    railName.textContent = me.name;
  }

  pollNote.textContent = "SAVING…";
  const res = await castVote(me.id, gameId);

  if (res.ok) {
    rememberVote(gameId);
    pollNote.textContent = "THANKS — CHANGE IT ANY TIME";
    renderPoll();
  } else {
    pollNote.textContent = "COULD NOT SAVE YOUR VOTE";
    console.warn("[poll] vote failed:", res.reason);
  }
}

function initPoll() {
  buildPoll();
  subscribePoll((next) => { pollTally = next; renderPoll(); })
    .catch((err) => {
      console.error("[poll] failed:", err);
      pollNote.textContent = "POLL UNAVAILABLE";
    });
}

/* ── boot ──────────────────────────────────────────────────────── */
buildSky();

// Every input in these games is keyboard or mouse -- Input.GetAxisRaw,
// Input.mousePosition, Input.GetMouseButtonDown. There is no touch control
// anywhere, so a phone should never be handed the download.
if (!window.matchMedia("(pointer: fine)").matches) {
  desktopOnly.hidden = false;
} else {
  arcade.hidden = false;
  initGate();
  initRail();
  renderRail();
  initPoll();
}
