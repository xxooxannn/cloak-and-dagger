/**
 * Cloak & Dagger — screen router and game flow.
 *
 * The flow is deliberately linear and always visible on screen: you can never
 * be unsure which beat you are on, because the host tells you and the progress
 * strip confirms it.
 */

import { MODELS, fetchBalance, generateImage, speak as speakLine, PollinationsError } from "./api.js";
import {
  craftCards,
  craftPressure,
  craftScenario,
  craftVerdict,
  judgeAccusations,
} from "./host.js";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  avatarTint,
  dealRoles,
  initials,
  resolveVote,
  scoreGame,
} from "./engine.js";
import {
  $,
  busy,
  createSpeaker,
  countdown,
  curtain,
  el,
  formatClock,
  toast,
} from "./ui.js";

const KEY_STORAGE = "cloak-dagger-key";
const NAMES_STORAGE = "cloak-dagger-names";
const THEME_STORAGE = "cloak-dagger-theme";

const HOST_VOICE = "af_wonder";
const DISCUSSION_SECONDS = 180;

/** Everything mutable for one session. Not persisted — a game is ephemeral. */
const state = {
  view: "title",
  key: sessionStorage.getItem(KEY_STORAGE) || "",
  balance: null,
  players: [],
  roles: new Map(),
  cards: [],
  scenario: null,
  accusations: [],
  votes: {},
  tally: null,
  score: null,
  speaker: null,
  muted: false,
  images: true,
  timer: null,
  abort: null,
};

/* =========================================================================
   Boot
   ========================================================================= */

function boot() {
  const saved = localStorage.getItem(NAMES_STORAGE);
  const names = saved ? safeParse(saved, []) : [];
  state.players = normaliseNames(names);

  state.speaker = createSpeaker({
    speak: (text) => speakLine(state.key, text, { voice: HOST_VOICE }),
    onStateChange: (speaking) => {
      document.querySelectorAll("[data-narration]").forEach((node) => {
        node.dataset.speaking = String(speaking);
      });
    },
  });

  if (state.key) verifyKey({ quiet: true });
  route();
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function normaliseNames(names) {
  const clean = (Array.isArray(names) ? names : []).map((n) => String(n || "").trim());
  const out = [];
  for (let i = 0; i < Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, clean.length || MIN_PLAYERS)); i += 1) {
    out.push(clean[i] || `Player ${i + 1}`);
  }
  return out.map((name, i) => ({ id: `p${i + 1}`, name }));
}

/** One place decides which screen is on show. */
function route(view) {
  if (view) state.view = view;
  paintWalletChip();
  const screen = $("#screen");
  screen.replaceChildren();

  if (state.view === "title") screen.append(titleScreen());
  else if (state.view === "setup") screen.append(setupScreen());
  else screen.append(lobbyScreen());
}

/* =========================================================================
   Screens
   ========================================================================= */

function titleScreen() {
  return el(
    "section",
    { class: "title" },
    crest(),
    el(
      "h2",
      { class: "title__name" },
      "Cloak & Dagger",
      el("span", {}, "A party deduction game"),
    ),
    el("div", { class: "title__rule" }),
    el("p", {
      class: "title__lede",
      text:
        "Four to twelve of you, one phone, one table. An AI host writes a fresh conspiracy every night, deals each of you a secret card, talks you through the panic, and reads the verdict out loud. Exactly one of you did it.",
    }),
    el(
      "div",
      { class: "title__cta" },
      el(
        "button",
        { class: "btn btn--primary btn--lg", onClick: () => route("setup") },
        "Take a seat",
      ),
      el("span", {
        class: "title__credits",
        html: "Bring your own Pollen. No account, no server, no cost to play until you start.",
      }),
    ),
  );
}

function crest() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "title__crest");
  svg.innerHTML = `
    <path d="M32 6c7 5 11 12 11 20a11 11 0 0 1-22 0c0-8 4-15 11-20z" stroke="currentColor" stroke-width="2.5"/>
    <path d="M32 20v26" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M24 56h16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M18 32c-4-2-6-5-6-9M46 32c4-2 6-5 6-9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
  `;
  return svg;
}

/* -------------------------------------------------------------- setup ---- */

function setupScreen() {
  const nameInputs = state.players.map((player, index) =>
    el(
      "div",
      { class: "seat" },
      el("span", { class: "seat__num", text: String(index + 1).padStart(2, "0") }),
      el("input", {
        class: "input",
        value: player.name.startsWith("Player ") ? "" : player.name,
        placeholder: `Player ${index + 1}`,
        maxlength: "18",
        "aria-label": `Name for player ${index + 1}`,
        onInput: (event) => {
          player.name = event.target.value.trim() || `Player ${index + 1}`;
        },
      }),
    ),
  );

  const countValue = el("span", { class: "counter__value", text: String(state.players.length) });

  const resize = (delta) => {
    const next = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, state.players.length + delta));
    if (next === state.players.length) return;
    state.players = normaliseNames([
      ...state.players.map((p) => p.name),
      ...Array.from({ length: next - state.players.length }, (_, i) => `Player ${state.players.length + i + 1}`),
    ]);
    route("setup");
  };

  return el(
    "section",
    { class: "setup" },
    el("p", { class: "eyebrow", text: "Step one" }),
    el("h2", { class: "title__name", style: "font-size:clamp(34px,6vw,54px)" }, "Who's at the table?"),
    el("p", {
      class: "muted",
      text: `${MIN_PLAYERS} to ${MAX_PLAYERS} players on one device. The host passes the phone around to deal the secret cards.`,
    }),

    el("div", { class: "setup__grid" }, el("div", { class: "field__label", text: "Seats" }), el("div", { class: "seat-grid" }, nameInputs)),

    el(
      "div",
      { class: "field" },
      el("span", { class: "field__label", text: "Table size" }),
      el(
        "div",
        { class: "counter" },
        el("button", { type: "button", "aria-label": "Remove a player", onClick: () => resize(-1) }, "−"),
        countValue,
        el("button", { type: "button", "aria-label": "Add a player", onClick: () => resize(1) }, "+"),
      ),
    ),

    walletPanel(),

    el(
      "div",
      { class: "stack", style: "gap:var(--gap-3)" },
      el(
        "button",
        {
          class: "btn btn--primary btn--lg btn--block",
          onClick: () => {
            // Two players with the same name make the secret cards ambiguous,
            // so drop the duplicate — but never shrink below a playable table.
            const seen = new Set();
            const unique = state.players.filter((player) => {
              const name = player.name.trim().toLowerCase();
              if (seen.has(name)) return false;
              seen.add(name);
              return true;
            });

            if (unique.length >= MIN_PLAYERS) {
              state.players = unique.map((player, index) => ({ id: `p${index + 1}`, name: player.name }));
              localStorage.setItem(NAMES_STORAGE, JSON.stringify(state.players.map((p) => p.name)));
              // A saved key skips straight to the lobby; otherwise stay put so
              // the wallet panel below is reachable.
              route(state.key ? "lobby" : "setup");
            } else {
              toast(
                `Duplicate names — a table needs ${MIN_PLAYERS} different players.`,
                "error",
              );
            }
          },
        },
        "Confirm the table",
      ),
      el("button", { class: "btn btn--ghost btn--block", onClick: () => route("title") }, "Back"),
    ),
  );
}

function walletPanel() {
  const panel = el("div", { class: "wallet", dataset: { state: state.key ? "ready" : "empty" } });
  const status = el("span", { class: "wallet__status", text: state.key ? "Key saved" : "No key yet" });

  const keyInput = el("input", {
    class: "input",
    type: "password",
    value: state.key,
    placeholder: "sk_…",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Pollinations API key",
    onInput: (event) => {
      state.key = event.target.value.trim();
      sessionStorage.setItem(KEY_STORAGE, state.key);
    },
  });

  const balanceRow = el(
    "div",
    { class: "balance" },
    el("span", { class: "balance__value", text: state.balance ? state.balance.total.toFixed(2) : "—" }),
    el("span", { class: "balance__unit", text: "Pollen" }),
  );

  panel.append(
    el(
      "div",
      { class: "wallet__head" },
      el("span", { class: "eyebrow", text: "Bring your own Pollen" }),
      status,
    ),
    el(
      "div",
      { class: "wallet__body" },
      keyInput,
      el("p", {
        class: "field__hint",
        html: `Get a free key at <a href="https://enter.pollinations.ai/keys" target="_blank" rel="noopener">enter.pollinations.ai/keys</a>. It stays in this tab only — never uploaded, and cleared when you close the browser. A full game costs a fraction of a Pollen.`,
      }),
      el(
        "div",
        { class: "stack", style: "gap:var(--gap-2)" },
        el(
          "button",
          {
            class: "btn",
            onClick: () => verifyKey(),
          },
          "Check my balance",
        ),
        balanceRow,
      ),
    ),
  );

  if (state.balance?.tier !== undefined && state.balance?.tier !== null) {
    panel.querySelector(".balance").after(
      el("p", {
        class: "field__hint",
        text: `${Number(state.balance.tier).toFixed(2)} Quest Pollen · ${Number(state.balance.paid || 0).toFixed(2)} paid Pollen`,
      }),
    );
  }

  return panel;
}

function lobbyScreen() {
  const theme = el("input", {
    class: "input",
    placeholder: "Optional: a theme, e.g. a 1920s ocean liner",
    value: localStorage.getItem(THEME_STORAGE) || "",
    maxlength: "90",
    onInput: (event) => localStorage.setItem(THEME_STORAGE, event.target.value),
  });

  return el(
    "section",
    { class: "setup" },
    el("p", { class: "eyebrow", text: "Ready" }),
    el("h2", { class: "title__name", style: "font-size:clamp(34px,6vw,54px)" }, "The cards are ready to be cut"),
    el(
      "div",
      { class: "seats" },
      state.players.map((player) =>
        el(
          "div",
          { class: "chip" },
          el("span", { class: "chip__avatar", style: `background:${avatarTint(player.name)}`, text: initials(player.name) }),
          el(
            "div",
            { style: "min-width:0" },
            el("div", { class: "chip__name", text: player.name }),
            el("div", { class: "chip__sub", text: "seated" }),
          ),
        ),
      ),
    ),
    el(
      "div",
      { class: "field" },
      el("span", { class: "field__label", text: "Tonight's setting" }),
      theme,
      el("span", { class: "field__hint", text: "Leave it blank and the host will invent somewhere for you." }),
    ),
    el(
      "div",
      { class: "stack", style: "gap:var(--gap-3)" },
      el("button", { class: "btn btn--primary btn--lg btn--block", onClick: () => startGame(theme.value.trim()) }, "Begin the night"),
      el("button", { class: "btn btn--ghost btn--block", onClick: () => route("setup") }, "Change the table"),
    ),
    el("p", { class: "field__hint", text: `Costs roughly ${(0.02).toFixed(2)}–0.05 Pollen per game with the default models (${MODELS.text} + ${MODELS.speech} + ${MODELS.image}).` }),
  );
}

/* =========================================================================
   Game
   ========================================================================= */

async function startGame(theme) {
  state.abort?.abort();
  const controller = new AbortController();
  state.abort = controller;
  const signal = controller.signal;

  state.roles = dealRoles(state.players);
  state.cards = [];
  state.accusations = [];
  state.votes = {};
  state.tally = null;
  state.score = null;

  const stop = busy("The host is thinking", "Writing tonight's scenario…");
  try {
    state.scenario = await craftScenario(state.key, { players: state.players, theme }, { signal });
    state.cards = await craftCards(
      state.key,
      {
        players: state.players,
        scenario: state.scenario,
        roles: state.roles,
        culpritId: [...state.roles].find(([, r]) => r === "culprit")[0],
      },
      { signal },
    );
  } catch (error) {
    stop();
    return fail(error, "The host couldn't write tonight's scenario.");
  }
  stop();

  await dealPhase();
  if (state.abort === controller) await openingPhase();
}

function fail(error, fallbackMessage) {
  if (error?.name === "AbortError") return;
  const message = error instanceof PollinationsError ? error.message : fallbackMessage;
  toast(message, "error", 9000);
  if (error instanceof PollinationsError && /balance|Pollen/i.test(error.message)) {
    state.balance = null;
    paintWalletChip();
  }
}

/* --------------------------------------------------------- deal cards ---- */

async function dealPhase() {
  for (const [index, card] of state.cards.entries()) {
    const player = state.players.find((p) => p.id === card.playerId);
    const role = state.roles.get(card.playerId);

    let revealed = false;

    const dossier = el(
      "div",
      { class: "dossier" },
      el(
        "div",
        { class: "dossier__seal" },
        el("p", { class: "eyebrow", text: role === "culprit" ? "Sealed" : "Sealed" }),
        el("p", {
          class: "dossier__role",
          dataset: { role },
          text: role === "culprit" ? "You did it." : "You are innocent.",
        }),
      ),
      el(
        "div",
        { class: "dossier__body" },
        el("p", { class: "eyebrow", text: card.headline }),
        el("p", { class: "dossier__brief", text: card.brief }),
        el("p", { class: "dossier__brief", text: `Secret goal: ${card.objective}` }),
      ),
    );

    const peek = el("button", { class: "btn btn--ghost btn--block", text: "Hold to read" });
    const body = el("div", { style: "display:none" }, dossier);

    const reveal = () => {
      revealed = !revealed;
      body.style.display = revealed ? "block" : "none";
      peek.textContent = revealed ? "Hide the card" : "Hold to read";
    };
    peek.addEventListener("click", reveal);

    await curtain({
      eyebrow: `Seat ${index + 1} of ${state.cards.length}`,
      title: `Pass the phone to ${player.name}`,
      note: revealed
        ? "Make sure nobody else is looking, then read it aloud."
        : "Everyone else: look away. The card stays hidden until this player says so.",
      body: revealed ? null : el("div", { style: "width:min(560px,100%)" }, peek),
      actions: [{ label: revealed ? `I'm ${player.name}, hide it` : `I'm ${player.name}, ready`, value: true }],
    });

    // Force-hide before the curtain lifts so the card never flashes to the room.
    if (revealed) reveal();
  }
}

/* ------------------------------------------------------------ opening ---- */

async function openingPhase() {
  renderStage({
    step: 1,
    title: state.scenario.setting || "Tonight",
    narration: state.scenario.opener || state.scenario.incident,
  });

  const sceneHost = $("#scene-image");
  if (state.images) {
    paintImage(sceneHost, state.scenario.scene_prompt, "scene");
  }

  await state.speaker.say(state.scenario.opener || state.scenario.incident);

  const summary = el(
    "div",
    { class: "panel", style: "padding:var(--gap-4)" },
    el("p", { class: "eyebrow", text: "The incident" }),
    el("p", { class: "muted", text: state.scenario.incident }),
    el("p", { class: "muted", style: "margin-top:var(--gap-2)", text: state.scenario.stakes }),
  );
  $("#stage-extra").append(summary);

  await discussionPhase();
}

/* ---------------------------------------------------------- discussion ---- */

async function discussionPhase() {
  const clock = el("div", { class: "timer__clock", text: formatClock(DISCUSSION_SECONDS) });
  const fill = el("div", { class: "timer__fill" });
  const timerBox = el(
    "div",
    { class: "timer", dataset: { urgent: "false" } },
    el(
      "div",
      { class: "timer__row" },
      el(
        "div",
        {},
        el("p", { class: "eyebrow", text: "Discussion" }),
        el("p", { class: "field__hint", text: "Talk it out. Accusations come next." }),
      ),
      clock,
    ),
    el("div", { class: "timer__track" }, fill),
    el(
      "div",
      { class: "stack", style: "gap:var(--gap-2)" },
      el(
        "button",
        {
          class: "btn btn--ghost",
          onClick: (event) => {
            const timer = state.timer;
            if (!timer) return;
            timer.add(60);
            toast("A minute granted by the house.", "info", 2600);
            event.target.blur();
          },
        },
        "Add a minute",
      ),
      el(
        "button",
        {
          class: "btn btn--primary",
          onClick: () => {
            state.timer?.stop();
            state.timer = null;
            finishDiscussion();
          },
        },
        "Enough — let's accuse",
      ),
    ),
  );

  const extra = $("#stage-extra");
  extra.replaceChildren(timerBox);

  const pressureButton = el("button", { class: "btn btn--ghost", text: "Ask the host for a nudge" });
  pressureButton.addEventListener("click", async () => {
    pressureButton.disabled = true;
    const stop = busy("The host is weighing in");
    try {
      const line = await craftPressure(state.key, { scenario: state.scenario, elapsed: "half" });
      stop();
      await state.speaker.say(line);
      toast(line, "info", 8000);
    } catch (error) {
      stop();
      fail(error, "The host lost its nerve.");
    } finally {
      pressureButton.disabled = false;
    }
  });
  extra.append(pressureButton);

  let pressed = false;
  state.timer = countdown({
    seconds: DISCUSSION_SECONDS,
    onTick: (remaining, total) => {
      clock.textContent = formatClock(remaining);
      fill.style.width = `${(remaining / total) * 100}%`;
      timerBox.dataset.urgent = String(remaining <= 20);
      if (remaining <= 20 && !pressed) {
        pressed = true;
        state.speaker.say("Twenty seconds. Choose your suspect.");
      }
    },
    onDone: () => {
      state.timer = null;
      state.speaker.say("Time. Accusations, please.");
      finishDiscussion();
    },
  });
}

let finishing = false;
function finishDiscussion() {
  if (finishing) return;
  finishing = true;
  state.timer?.stop();
  state.timer = null;
  setTimeout(() => {
    finishing = false;
    accusationPhase();
  }, 60);
}

/* ---------------------------------------------------------- accusation ---- */

async function accusationPhase() {
  state.timer?.stop();

  renderStage({
    step: 2,
    title: "Accusations",
    narration: "One at a time, name the person you think did it — and say why. Nobody hears the reason but the host.",
  });

  for (const player of state.players) {
    const target = await pickTarget(
      `Pass the phone to ${player.name}`,
      "Who did it?",
      "Their reason stays private — the room only hears the host's verdict on it.",
      player.id,
    );
    if (target === null) return;

    const reasonBox = el("textarea", {
      class: "textarea",
      placeholder: "Because…",
      maxlength: "180",
      "aria-label": "Reason for your accusation",
    });

    await curtain({
      eyebrow: "Accusation",
      title: `${player.name}, why?`,
      note: "One line. Make it count — the host reads these aloud.",
      body: el("div", { class: "stack", style: "width:min(560px,100%);gap:var(--gap-3)" }, reasonBox),
      actions: [{ label: "Seal it", variant: "primary", value: true }],
    });

    state.accusations.push({
      playerId: player.id,
      targetId: target,
      reason: reasonBox.value.trim() || "I just don't trust them.",
    });
  }

  await awardsPhase();
}

/**
 * Shared "tap a seat" curtain used for both accusations and votes.
 * Resolves to the chosen player id, or null if the player backed out.
 */
function pickTarget(eyebrow, title, note, forPlayerId) {
  return curtain({
    eyebrow,
    title,
    note,
    choices: state.players.map((player) => {
      const isSelf = player.id === forPlayerId;
      return {
        value: player.id,
        label: player.name,
        sub: isSelf ? "that's you" : "tap to choose",
        disabled: isSelf,
        disabledReason: "You can't pick yourself",
        monogram: initials(player.name),
        tint: avatarTint(player.name),
      };
    }),
    actions: [{ label: "Back out", value: null }],
  });
}

/* -------------------------------------------------------------- awards ---- */

async function awardsPhase() {
  renderStage({
    step: 3,
    title: "The host weighs in",
    narration: "Accusations are sealed. The host has read them all and has opinions.",
  });

  const stop = busy("The host is reading the room", "Judging every accusation you just made…");
  let awards;
  try {
    const result = await judgeAccusations(state.key, {
      scenario: state.scenario,
      cards: state.cards.map((card) => ({
        playerName: state.players.find((p) => p.id === card.playerId).name,
        headline: card.headline,
      })),
      accusations: state.accusations.map((a) => ({
        targetName: state.players.find((p) => p.id === a.targetId).name,
        reason: a.reason,
      })),
    });
    awards = result;
  } catch (error) {
    stop();
    return fail(error, "The host couldn't reach a verdict on the accusations.");
  }
  stop();

  const list = el(
    "div",
    { class: "awards" },
    (awards.awards || []).slice(0, 3).map((award, index) =>
      el(
        "div",
        { class: "award", style: `animation-delay:${index * 90}ms` },
        el("span", { class: "award__icon", text: ["◆", "✦", "❖"][index] || "◆" }),
        el(
          "div",
          {},
          el("p", { class: "award__title", text: award.title || "Notable" }),
          el("p", { class: "award__body", text: award.line || "" }),
        ),
      ),
    ),
  );

  const extra = $("#stage-extra");
  extra.replaceChildren(list);
  if (awards.verdict_line) {
    extra.append(el("p", { class: "muted", style: "margin-top:var(--gap-3)", text: awards.verdict_line }));
  }

  setNarration(awards.verdict_line || "The host has made up its mind about you all.");
  await state.speaker.say(
    ...(awards.awards || []).map((award) => `${award.title}. ${award.line}`),
    awards.verdict_line || "",
  );

  await votePhase();
}

/* ---------------------------------------------------------------- vote ---- */

async function votePhase() {
  renderStage({
    step: 4,
    title: "The ballot",
    narration: "Now the only thing that counts. Majority of the whole table, not a plurality.",
  });

  for (const player of state.players) {
    const target = await pickTarget(
      `Pass the phone to ${player.name}`,
      "Cast your vote",
      "Sealed until everyone has voted. A tie at the top means the culprit walks.",
      player.id,
    );
    if (target === null) return;
    state.votes[player.id] = target;
  }

  await verdictPhase();
}

/* ------------------------------------------------------------- verdict ---- */

async function verdictPhase() {
  const culpritId = [...state.roles].find(([, r]) => r === "culprit")[0];
  const culprit = state.players.find((p) => p.id === culpritId);

  state.tally = resolveVote(state.players, state.votes, culpritId);
  state.score = scoreGame(state.players, state.roles, state.votes, state.tally);

  const topId = state.tally.caught ? culpritId : state.tally.topAccused;
  const topName = state.players.find((p) => p.id === topId)?.name;

  renderStage({
    step: 5,
    title: state.tally.caught ? "The room found them" : "The culprit walks",
    narration: state.tally.caught
      ? `${culprit.name} took the fall.`
      : `${topName} drew the most suspicion, and it wasn't enough.`,
  });

  const stop = busy("The host is writing the ending");
  let ending;
  try {
    ending = await craftVerdict(state.key, {
      scenario: state.scenario,
      culpritName: culprit.name,
      voteName: topName,
      votes: Object.fromEntries(
        Object.entries(state.votes).map(([voter, target]) => [
          state.players.find((p) => p.id === voter).name,
          state.players.find((p) => p.id === target).name,
        ]),
      ),
      tally: state.tally.counts,
      caught: state.tally.caught,
      roundSummary: state.accusations
        .map((a) => `${state.players.find((p) => p.id === a.playerId).name} blamed ${state.players.find((p) => p.id === a.targetId).name}`)
        .join("; "),
    });
  } catch (error) {
    stop();
    return fail(error, "The host couldn't write the ending.");
  }
  stop();

  const maxVotes = Math.max(1, ...state.tally.ranked.map(([, n]) => n));

  const summary = el(
    "div",
    { class: "panel", style: "padding:var(--gap-4)" },
    el("p", { class: "eyebrow", text: ending.headline || "Verdict" }),
    el(
      "div",
      { class: "tally", style: "margin-top:var(--gap-3)" },
      state.tally.ranked.map(([id, n]) => {
        const player = state.players.find((p) => p.id === id);
        const isCulprit = id === culpritId;
        return el(
          "div",
          { class: "tally__row", style: isCulprit ? "border-color:var(--blood-500)" : "" },
          el("span", { text: player.name + (isCulprit ? " — the culprit" : "") }),
          el("span", { class: "tally__count", text: String(n) }),
          el("div", { class: "tally__bar" }, el("span", { style: `width:${(n / maxVotes) * 100}%` })),
        );
      }),
    ),
  );

  const confession = el(
    "div",
    { class: "narration", dataset: { narration: "confession", speaking: "false" } },
    el("div", { class: "narration__speaker" }, el("span", { class: "narration__who", text: culprit.name })),
    el("div", { class: "narration__text" }, el("p", { text: ending.confession || "" })),
    el("div", { class: "narration__controls" }, speechToggle()),
  );

  const scoreboard = el(
    "div",
    { class: "awards", style: "margin-top:var(--gap-4)" },
    state.score.rows.map((row, index) =>
      el(
        "div",
        {
          class: "award",
          style: `animation-delay:${index * 70}ms`,
          dataset: row.role === "culprit" ? {} : { verdict: row.won ? "vindicated" : "" },
        },
        el("span", { class: "award__icon", text: row.won ? "✓" : "✕" }),
        el(
          "div",
          {},
          el("p", {
            class: "award__title",
            text: `${row.player.name} — ${row.role === "culprit" ? (row.won ? "got away with it" : "caught") : row.won ? "named them" : "was wrong"}`,
          }),
          el("p", {
            class: "award__body",
            text:
              row.role === "culprit"
                ? state.tally.caught
                  ? "The room saw through it."
                  : "Not a single vote landed."
                : row.votedCorrectly
                  ? "Read the room perfectly."
                  : `Voted for ${state.players.find((p) => p.id === state.votes[row.player.id])?.name}.`,
          }),
        ),
      ),
    ),
  );

  const extra = $("#stage-extra");
  extra.replaceChildren(summary, confession, scoreboard);

  if (state.images && ending.poster_prompt) {
    const poster = el("img", { class: "poster", alt: "Case file poster for tonight's verdict" });
    extra.append(el("div", { style: "margin-top:var(--gap-4)" }, poster));
    paintImage(poster, ending.poster_prompt, "poster");
  }

  extra.append(
    el(
      "div",
      { class: "stack", style: "gap:var(--gap-2);margin-top:var(--gap-5)" },
      el("button", { class: "btn btn--primary btn--lg", onClick: playAgain }, "Play another night"),
      el(
        "button",
        { class: "btn btn--ghost", onClick: () => route("setup") },
        "Change the table",
      ),
    ),
  );

  setNarration(ending.narration || "");
  await state.speaker.say(ending.narration, ending.confession, ending.sting);
}

function playAgain() {
  state.roles = dealRoles(state.players);
  state.cards = [];
  state.accusations = [];
  state.votes = {};
  state.tally = null;
  state.score = null;
  startGame(localStorage.getItem(THEME_STORAGE) || "");
}

/* =========================================================================
   Chrome helpers
   ========================================================================= */

function renderStage({ step, title, narration }) {
  const screen = $("#screen");
  screen.replaceChildren(
    el(
      "section",
      { class: "stage" },
      el(
        "div",
        { class: "stage__head" },
        el("h2", { class: "stage__title", text: title }),
        el("span", { class: "stage__progress", text: `Beat ${step} of 5` }),
      ),
      el(
        "div",
        { class: "narration", dataset: { narration: "host", speaking: "false" } },
        el(
          "div",
          { class: "narration__speaker" },
          el("span", {
            class: "chip__avatar",
            style: "background:linear-gradient(150deg,var(--brass-400),var(--blood-400))",
            text: "◈",
          }),
          el("span", { class: "narration__who", text: "The Host" }),
        ),
        el("div", { class: "narration__text" }, el("p", { text: narration })),
        el("div", { class: "narration__controls" }, speechToggle()),
      ),
      el("div", { id: "scene-image" }),
      el("div", { id: "stage-extra", class: "stack", style: "gap:var(--gap-4)" }),
    ),
  );
}

function setNarration(text) {
  const host = document.querySelector('[data-narration="host"] .narration__text');
  if (host) host.replaceChildren(el("p", { text }));
}

function speechToggle() {
  const button = el("button", {
    class: "speech-toggle",
    dataset: { on: String(!state.muted) },
    onClick: () => {
      state.muted = !state.muted;
      state.speaker.setMuted(state.muted);
      document.querySelectorAll(".speech-toggle").forEach((node) => {
        node.dataset.on = String(!state.muted);
        node.textContent = state.muted ? "🔇 Voice off" : "🔊 Voice on";
      });
    },
  });
  button.textContent = state.muted ? "🔇 Voice off" : "🔊 Voice on";
  return button;
}

async function paintImage(node, prompt, seedTag) {
  if (!node || !prompt) return;
  try {
    const url = await generateImage(state.key, `${prompt}. Seed ${seedTag}.`);
    node.replaceChildren(el("img", { class: "poster", src: url, alt: prompt.slice(0, 120) }));
  } catch {
    node.replaceChildren();
  }
}

/* -------------------------------------------------------------------------
   Wallet chip
   ------------------------------------------------------------------------- */

function paintWalletChip() {
  const chip = $("#wallet-chip");
  if (!chip) return;
  const live = Boolean(state.key && state.balance);
  chip.classList.toggle("pollen-dot--live", live);
  chip.textContent = state.balance
    ? `${state.balance.total.toFixed(2)} Pollen`
    : state.key
      ? "Key saved"
      : "No Pollen";
}

async function verifyKey({ quiet = false } = {}) {
  if (!state.key) {
    if (!quiet) toast("Paste a Pollinations key first.", "error");
    return;
  }
  const stop = busy("Checking your balance");
  try {
    state.balance = await fetchBalance(state.key);
    paintWalletChip();
    if (!quiet) toast(`${state.balance.total.toFixed(2)} Pollen ready to spend.`, "ok");
  } catch (error) {
    state.balance = null;
    paintWalletChip();
    if (!quiet) fail(error, "That key didn't work.");
  } finally {
    stop();
  }
}

/* =========================================================================
   Start
   ========================================================================= */

boot();