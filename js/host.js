/**
 * The AI host.
 *
 * Everything the model is allowed to influence lives here: the scenario, the
 * private cards, the mid-game colour, the awards, and the closing narration.
 * Everything the model must *not* decide — who is the culprit, who voted for
 * whom, whether anyone wins — is handled by engine.js and only passed to the
 * model as settled fact to describe out loud.
 */

import { askJson, askText } from "./api.js";

const HOST_VOICE = `You are the host of a candlelit drawing-room party game called Cloak & Dagger.
You are theatrical, dry and a little menacing. You never use emoji, never use
markdown, never use bullet points, and you never speak in all caps. You keep
lines under 45 words so they land well when read aloud.`;

/**
 * Setting sparks. One is drawn per game and handed to the model as a strong
 * prior, which does two jobs: it stops consecutive nights drifting into the same
 * idea, and it varies the prompt text so a cached response can't hand back
 * last night's scenario verbatim.
 */
const SPARKS = [
  "a locked museum wing closed for a private viewing",
  "a lighthouse that has gone three nights without answering",
  "a members-only club with a guest book nobody admits to signing",
  "a country house sale where the catalogue is wrong",
  "a rehearsal room where the prop knife was swapped for a real one",
  "a hotel kitchen at 3am and a missing tray of silver",
  "a private rail carriage where one passenger boarded alone",
  "a botanical archive where a specimen has changed overnight",
  "a recording studio session that nobody can remember finishing",
  "a ski lodge with one boot missing and two rooms booked",
  "a regatta yacht where the logbook has two different hands",
  "a family vault opened over a disputed inheritance",
  "a shuttered seaside pier where the lights still come on",
  "an observatory whose latest plate shows someone who was never there",
  "a tailor's shop where a suit was collected by the wrong man",
  "a wine auction and one bottle that was never bid for",
];

/** A spark other than the one used last time, so nights stay visibly different. */
export function drawSpark(previous) {
  const fresh = SPARKS.filter((spark) => spark !== previous);
  const pool = fresh.length ? fresh : SPARKS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** A fresh premise sized to the table — bigger tables get tighter stories. */
export async function craftScenario(key, { players, theme, spark }, { signal } = {}) {
  const brief = theme || spark;
  return askJson(
    key,
    {
      signal,
      system: `${HOST_VOICE}

Reply with JSON only:
{
  "setting": "the place and time, one vivid sentence",
  "incident": "what happened, two sentences",
  "stakes": "why it matters tonight, one sentence",
  "opener": "2-4 sentences the host speaks to open the round",
  "scene_prompt": "a text-to-image prompt for a moody illustration of the setting, no text or lettering"
}`,
      prompt: `Write tonight's scenario for ${players.length} players seated in a room.

Tonight it is: ${brief || "somewhere you have not used before — choose the setting yourself and make it specific."}

Make the incident concrete and ambiguous — several people had motive and
access, and none of the evidence alone settles anything. Players will each get
a private card with one true fact, so a smart player should be able to piece
the picture together. Leave every player's guilt genuinely undecided.

Players: ${players.map((p) => p.name).join(", ")}.`,
    },
  );
}

/**
 * One private card per player. The role is re-derived from engine.js and passed
 * in, so the model writes the card but cannot change who did it.
 */
export async function craftCards(key, { players, scenario, roles, culpritId }, { signal } = {}) {
  const seatLines = players
    .map((p) => {
      const role = roles.get(p.id) === "culprit" ? "CULPRIT" : "INNOCENT";
      return `- ${p.id} (${p.name}): ${role}`;
    })
    .join("\n");

  const result = await askJson(
    key,
    {
      signal,
      system: `${HOST_VOICE}

Reply with JSON only:
{
  "cards": [
    {
      "playerId": "the id from the seat list",
      "headline": "3-6 words naming this player's angle",
      "brief": "2-3 sentences of private knowledge only this player has",
      "objective": "one sentence: this player's secret goal for the round"
    }
  ]
}

Every seat in the seat list must appear exactly once.`,
      prompt: `Scenario — setting: ${scenario.setting}
Incident: ${scenario.incident}
Stakes: ${scenario.stakes}

Seat list (ids and roles — these are fixed, never reassign them):
${seatLines}

Write a private card for every player.

The CULPRIT's brief should be their cover story: a plausible alibi that
contradicts the incident, phrased as if it exonerates them. Never state their
guilt and never tell them outright that they are suspected.
The INNOCENT's brief should be one true, concrete detail only they would know
— something that narrows the field without giving the game away.

Each innocent's objective must be about swaying other players, such as
"convince the table that <someone else> did it" or "stay off the ballot".
The culprit's objective is to survive the vote and point at someone else.

Players: ${players.map((p) => `${p.id}=${p.name}`).join(", ")}.
Culprit is ${culpritId}.`,
    },
  );

  const byId = new Map((result.cards || []).map((card) => [card.playerId, card]));
  // Guarantee a complete hand: any card the model dropped gets a plain fallback
  // rather than leaving a player without a secret.
  return players.map((player) => {
    const card = byId.get(player.id);
    const isCulprit = roles.get(player.id) === "culprit";
    return {
      playerId: player.id,
      headline: card?.headline || (isCulprit ? "A Straight Face" : "What You Saw"),
      brief:
        card?.brief ||
        (isCulprit
          ? "You have nothing to prove and everything to hide. Keep the room pointed at someone else."
          : "You noticed something small that night and have not mentioned it yet."),
      objective:
        card?.objective ||
        (isCulprit
          ? "Survive the vote, and put the heat on someone else."
          : "Read the room and commit to the person who fits."),
    };
  });
}

/** Mid-game pressure: a nudge to accuse before the timer runs out. */
export async function craftPressure(key, { scenario, elapsed }, { signal } = {}) {
  return askText(key, {
    signal,
    system: `${HOST_VOICE}

Speak in one or two sentences. No markdown, no stage directions, no emoji.
Do not mention a timer, a clock or numbers.`,
    prompt: `Setting: ${scenario.setting}
About ${elapsed} of the discussion has passed.

Nudge the room to commit to a suspect now. Put gentle pressure on whoever has
been quiet, without naming anyone.`,
  });
}

/**
 * Read the private accusations and hand out awards.
 *
 * Accusations are passed anonymously — the host never learns who accused whom,
 * so it cannot accidentally reveal the culprit by how it reacts.
 */
export async function judgeAccusations(key, { scenario, cards, accusations }, { signal } = {}) {
  const anonymous = accusations.map((a, index) => ({
    seat: `Accusation ${index + 1}`,
    target: a.targetName,
    reason: a.reason,
  }));

  const roster = cards
    .map((card) => `- ${card.playerName}: "${card.headline}"`)
    .join("\n");

  return askJson(
    key,
    {
      signal,
      system: `${HOST_VOICE}

Reply with JSON only:
{
  "awards": [
    {
      "title": "a short award name in title case, 2-3 words",
      "seat": "the Accusation N this is about",
      "line": "one sentence of commentary"
    }
  ],
  "verdict_line": "one sentence summing up how the room is doing"
}

Give at most three awards and each must go to a different seat.`,
      prompt: `Setting: ${scenario.setting}

What everyone was told:
${roster}

The table has gone round with these private accusations:

${anonymous.map((a) => `${a.seat} accuses ${a.target}: "${a.reason}"`).join("\n")}

Reward the sharpest reading, the most inventive theory, and the accusation most
likely to be a calculated lie. Be playful, never cruel, and never say whether an
accusation happens to be correct.`,
    },
  );
}

/**
 * Closing narration. Every fact here is already decided by the engine; the model
 * only performs it, which is what keeps the outcome honest.
 */
export async function craftVerdict(
  key,
  { scenario, culpritName, voteName, votes, tally, caught, roundSummary },
  { signal } = {},
) {
  const ballot = Object.entries(votes)
    .map(([voter, target]) => `${voter} voted for ${target}`)
    .join("\n");

  const count = [...tally.entries()]
    .map(([id, n]) => `${id} received ${n}`)
    .join("\n");

  return askJson(
    key,
    {
      signal,
      system: `${HOST_VOICE}

Reply with JSON only:
{
  "headline": "the outcome in 2-4 words, no exclamation marks",
  "narration": "2-4 sentences announcing the result and who it belongs to",
  "confession": "2-3 sentences from the culprit's own point of view, in character",
  "sting": "one closing line the host says as the scene fades",
  "poster_prompt": "a text-to-image prompt for a dramatic dossier poster. Include the short headline as the only text in the image."
}`,
      prompt: `Setting: ${scenario.setting}
Incident: ${scenario.incident}

Tonight's private accusations were: ${roundSummary}

The final ballot:
${ballot}

Tally — ${count}

${caught
  ? `The room found ${culpritName}. The townsfolk win.`
  : `The room did not find ${culpritName}. The culprit walks free.${voteName ? ` ${voteName} drew the most suspicion but not enough of it.` : ""}`}

Announce this result exactly as given. Do not change who won. Then give the
culprit's confession and a closing sting.`,
    },
  );
}