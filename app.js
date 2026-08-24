// ==============================================================
//  VIEW
//  Groups per-game score entries into players, ranks them, and
//  animates every position change (FLIP), so a player who overtakes
//  another visibly slides past them.
// ==============================================================

import { buildSky } from "./sky.js";
import { subscribePlayers, SOLO_GAME } from "./data.js";
import {
  RANKED_COUNT, GAMES, SCORE_MODE, SHOW_COMBINED, SCHEMA,
} from "./firebase-config.js";

const board    = document.getElementById("board");
const emptyEl  = document.getElementById("empty");
const tabsEl   = document.getElementById("tabs");
const liveChip = document.getElementById("liveChip");
const liveText = document.getElementById("liveText");
const countText= document.getElementById("countText");
const clockText= document.getElementById("clockText");
const srcText  = document.getElementById("srcText");
const modeText = document.getElementById("modeText");

const MOVE_MS = 520;
const ALL = "__all__";

/** id -> <li> */
const rows = new Map();
/** id -> rank index at last render */
let prevRank = new Map();
let firstPaint = true;

/** last snapshot from Firebase, kept so tab switches need no re-read */
let latestEntries = [];
const multiGame = SCHEMA !== "flat" && GAMES.length > 0;
// A flat board has exactly one bucket, SOLO_GAME, whatever GAMES says --
// GAMES describes the cabinet, not the shape of the data. The old
// `GAMES[0]?.id ?? SOLO_GAME` only reached SOLO_GAME when GAMES was empty,
// so a flat schema alongside the usual three games selected "platformer"
// and filtered every row out: a full board that renders as empty.
let activeGame = !multiGame
  ? SOLO_GAME
  : (SHOW_COMBINED ? ALL : GAMES[0].id);

/* The "top 10 cutoff" separator lives in the list so it animates too. */
const cutoff = document.createElement("li");
cutoff.className = "cutoff";
cutoff.textContent = `TOP ${RANKED_COUNT} CUTOFF`;

/* ── game tabs ───────────────────────────────────────────────── */
function buildTabs() {
  if (!multiGame) { tabsEl.hidden = true; return; }

  const tabs = [];
  if (SHOW_COMBINED) tabs.push({ id: ALL, label: "ALL GAMES" });
  GAMES.forEach((g) => tabs.push({ id: g.id, label: g.label || g.id }));

  tabsEl.replaceChildren(
    ...tabs.map((t) => {
      const b = document.createElement("button");
      b.className = "tab" + (t.id === activeGame ? " is-on" : "");
      b.type = "button";
      b.textContent = t.label;
      b.dataset.game = t.id;
      b.setAttribute("aria-pressed", String(t.id === activeGame));
      b.addEventListener("click", () => selectGame(t.id));
      return b;
    })
  );
  updateModeLabel();
}

function selectGame(id) {
  if (id === activeGame) return;
  activeGame = id;

  tabsEl.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.game === id;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });

  // different table entirely — repaint fresh rather than animating across
  rows.forEach((el) => el.remove());
  rows.clear();
  prevRank = new Map();
  firstPaint = true;

  updateModeLabel();
  paint(latestEntries);
}

function updateModeLabel() {
  if (!modeText) return;
  if (!multiGame) { modeText.textContent = "SINGLE GAME"; return; }
  modeText.textContent = activeGame === ALL
    ? (SCORE_MODE === "best" ? "BEST GAME SCORE" : "TOTAL OF ALL GAMES")
    : (GAMES.find((g) => g.id === activeGame)?.label || activeGame);
}

/* ── entries -> ranked players ───────────────────────────────── */
function aggregate(entries) {
  const byPlayer = new Map();

  for (const e of entries) {
    if (activeGame !== ALL && e.gameId !== activeGame) continue;

    let p = byPlayer.get(e.playerId);
    if (!p) {
      p = { id: e.playerId, name: e.name, score: 0, perGame: new Map() };
      byPlayer.set(e.playerId, p);
    }
    if (e.name) p.name = e.name;
    // keep the highest if a game somehow reports twice
    const prev = p.perGame.get(e.gameId) ?? -Infinity;
    p.perGame.set(e.gameId, Math.max(prev, e.score));
  }

  for (const p of byPlayer.values()) {
    const vals = [...p.perGame.values()];
    p.gameCount = vals.length;
    p.score =
      activeGame !== ALL   ? (vals[0] ?? 0)
      : SCORE_MODE === "best" ? Math.max(0, ...vals)
      :                          vals.reduce((a, b) => a + b, 0);
  }

  return [...byPlayer.values()];
}

/* ── pixel avatar: deterministic 8x8 symmetric sprite ────────── */
const AVATAR_COLORS = [
  ["#7ee8fa", "#2b5f8a"], ["#ffd45e", "#8a5a12"], ["#ff8fd0", "#8a2f66"],
  ["#6ef2a8", "#1f6b45"], ["#b28dff", "#4a2b8a"], ["#ff9b6b", "#8a3f1f"],
  ["#f6eeff", "#5b4590"], ["#7dd3ff", "#25508a"],
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function avatarFor(seed) {
  let h = hash(seed);
  const next = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0);
  const [fg, shade] = AVATAR_COLORS[hash(seed) % AVATAR_COLORS.length];

  let cells = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const on = (next() % 100) < (x === 3 ? 72 : 42);
      if (!on) continue;
      const c = (next() % 100) < 30 ? shade : fg;
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
      cells += `<rect x="${7 - x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
    `<rect width="8" height="8" fill="#241a42"/>${cells}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ── row factory ─────────────────────────────────────────────── */
const fmt = (n) => n.toLocaleString("en-US");

function createRow(player) {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.id = player.id;
  li.innerHTML =
    `<span class="rank"></span>` +
    `<span class="who">` +
      `<img class="avatar" alt="" src="${avatarFor(player.id + player.name)}">` +
      `<span class="who__text">` +
        `<span class="who__name"></span>` +
        `<span class="who__tag"></span>` +
      `</span>` +
    `</span>` +
    `<span class="score">` +
      `<span class="arrow"></span>` +
      `<span class="score__val">0</span>` +
    `</span>`;
  return li;
}

function updateRow(li, player, index) {
  const rank = index + 1;
  const ranked = rank <= RANKED_COUNT;

  // rebuild the placement classes without dropping in-flight state classes
  const keep = ["is-new", "is-promoted", "is-demoted"].filter((c) =>
    li.classList.contains(c)
  );
  const place = ranked ? (rank <= 3 ? `row--${rank}` : "row--top") : "row--unranked";
  li.className = ["row", place, ...keep].join(" ");

  const rankCell = li.querySelector(".rank");
  const wantRank = ranked ? String(rank) : "-";
  if (rankCell.dataset.shown !== wantRank) {
    rankCell.dataset.shown = wantRank;
    rankCell.innerHTML = ranked
      ? `<span class="rank__num">${rank}</span>`
      : `<span class="rank__dash">--</span>`;
  }

  const nameEl = li.querySelector(".who__name");
  if (nameEl.textContent !== player.name) nameEl.textContent = player.name;

  let tag = rank === 1 ? "CHAMPION" : ranked ? `PLACED #${rank}` : "UNRANKED";
  if (activeGame === ALL && multiGame) {
    tag += ` / ${player.gameCount} GAME${player.gameCount === 1 ? "" : "S"}`;
  }
  const tagEl = li.querySelector(".who__tag");
  if (tagEl.textContent !== tag) tagEl.textContent = tag;

  // animated score counter
  const valEl = li.querySelector(".score__val");
  const from = Number(valEl.dataset.score || 0);
  if (from !== player.score) {
    valEl.dataset.score = String(player.score);
    tweenScore(valEl, from, player.score);
    if (!firstPaint) {
      valEl.classList.remove("is-ticking");
      void valEl.offsetWidth;
      valEl.classList.add("is-ticking");
    }
  }
}

function tweenScore(el, from, to) {
  const token = (Number(el.dataset.token || 0) + 1) % 1e6;
  el.dataset.token = String(token);

  if (firstPaint) { el.textContent = fmt(to); return; }

  const t0 = performance.now();
  const dur = 420;
  const step = (now) => {
    if (el.dataset.token !== String(token)) return; // superseded
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── render + FLIP ───────────────────────────────────────────── */
function onEntries(entries) {
  latestEntries = entries;
  paint(entries);
}

function paint(entries) {
  const sorted = aggregate(entries).sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  );

  emptyEl.hidden = sorted.length > 0;
  countText.textContent = String(sorted.length);
  clockText.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });

  // FIRST — where is everything right now?
  const first = new Map();
  rows.forEach((el, id) => first.set(id, el.getBoundingClientRect().top));
  const cutoffFirst = cutoff.isConnected ? cutoff.getBoundingClientRect().top : null;

  // build / update / drop
  const seen = new Set();
  sorted.forEach((p, i) => {
    let el = rows.get(p.id);
    const isNew = !el;
    if (isNew) {
      el = createRow(p);
      rows.set(p.id, el);
    }
    updateRow(el, p, i);
    if (isNew && !firstPaint) el.classList.add("is-new");
    seen.add(p.id);
  });
  rows.forEach((el, id) => {
    if (!seen.has(id)) { el.remove(); rows.delete(id); }
  });

  // re-order the DOM (moves nodes; keeps element identity for FLIP)
  const frag = document.createDocumentFragment();
  sorted.forEach((p, i) => {
    if (i === RANKED_COUNT) frag.appendChild(cutoff);
    frag.appendChild(rows.get(p.id));
  });
  board.replaceChildren(frag);

  // LAST + INVERT + PLAY
  if (!firstPaint) {
    rows.forEach((el, id) => {
      const before = first.get(id);
      if (before == null) return;
      const dy = before - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        { duration: MOVE_MS, easing: "cubic-bezier(.2,.85,.25,1)" }
      );
    });

    if (cutoffFirst != null && cutoff.isConnected) {
      const dy = cutoffFirst - cutoff.getBoundingClientRect().top;
      if (Math.abs(dy) >= 1) {
        cutoff.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
          { duration: MOVE_MS, easing: "cubic-bezier(.2,.85,.25,1)" }
        );
      }
    }
  }

  // who overtook whom?
  const nextRank = new Map(sorted.map((p, i) => [p.id, i]));
  if (!firstPaint) {
    nextRank.forEach((rank, id) => {
      const was = prevRank.get(id);
      if (was == null || was === rank) return;
      markMove(rows.get(id), was > rank ? "up" : "down");
    });
  }
  prevRank = nextRank;
  firstPaint = false;
}

function markMove(el, dir) {
  if (!el) return;
  const arrow = el.querySelector(".arrow");
  const rowCls = dir === "up" ? "is-promoted" : "is-demoted";
  const arrCls = dir === "up" ? "arrow--up" : "arrow--down";

  el.classList.remove("is-promoted", "is-demoted");
  arrow.classList.remove("arrow--up", "arrow--down");
  void el.offsetWidth; // restart the animation

  el.classList.add(rowCls);
  arrow.classList.add(arrCls);

  clearTimeout(el._moveTimer);
  el._moveTimer = setTimeout(() => {
    el.classList.remove(rowCls);
    arrow.classList.remove(arrCls);
  }, 1600);
}

/* ── status chip ─────────────────────────────────────────────── */
function setStatus({ mode, label, detail }) {
  liveChip.classList.remove("is-live", "is-demo", "is-error");
  liveChip.classList.add(`is-${mode}`);
  liveText.textContent = label;
  srcText.textContent = `SOURCE: ${detail || label}`;
}

/* ── boot ────────────────────────────────────────────────────── */
buildSky();
buildTabs();
updateModeLabel();
subscribePlayers(onEntries, setStatus).catch((err) => {
  console.error("[leaderboard] fatal:", err);
  setStatus({ mode: "error", label: "FAILED", detail: "SEE CONSOLE" });
});
