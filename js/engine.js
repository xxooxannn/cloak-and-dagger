/**
 * Game rules for Cloak & Dagger.
 *
 * Deliberately free of DOM and network code: every rule that decides a winner
 * lives here so it can be read (and tested) on its own. The AI host narrates
 * and writes flavour, but it never decides who did what — that is all done by
 * the functions below, so a model can neither leak the culprit early nor
 * hand someone a win.
 */

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

/** Cryptographically-seeded Fisher-Yates. Roles are real stakes; don't be weak. */
function secureShuffle(items) {
  const array = [...items];
  const random = new Uint32Array(array.length);
  crypto.getRandomValues(random);
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = random[i] % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Pick one culprit at random from the seated players.
 * Returns a map of playerId -> "culprit" | "innocent".
 */
export function dealRoles(players) {
  if (players.length < MIN_PLAYERS) {
    throw new Error(`Need at least ${MIN_PLAYERS} players to deal a hand.`);
  }
  const [culprit] = secureShuffle(players);
  return new Map(players.map((p) => [p.id, p.id === culprit.id ? "culprit" : "innocent"]));
}

/**
 * Count ballots and decide whether the culprit was caught.
 *
 * A strict majority of *all* seated players must land on the culprit. A tie at
 * the top does not count: the culprit stays hidden and wins, which is what
 * makes the last few minutes of a game tense.
 */
export function resolveVote(players, votes, culpritId) {
  const counts = new Map(players.map((p) => [p.id, 0]));
  for (const targetId of Object.values(votes)) {
    if (counts.has(targetId)) counts.set(targetId, counts.get(targetId) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topId, topCount] = ranked[0];
  const tied = ranked.filter(([, n]) => n === topCount).length > 1;
  const culpritVotes = counts.get(culpritId) ?? 0;

  return {
    counts,
    ranked,
    tied,
    // The culprit needs more votes than half the room, so one quiet wrong
    // guess can't lose the game on a small table.
    caught: !tied && culpritVotes > players.length / 2,
    culpritVotes,
    topAccused: topId,
  };
}

/**
 * Per-player results for the final scoreboard.
 *
 * An innocent wins only by naming the culprit. Abstaining, or voting yourself
 * (which the UI blocks), is never a win.
 */
export function scoreGame(players, roles, votes, verdict) {
  const culpritId = [...roles].find(([, role]) => role === "culprit")[0];

  const rows = players.map((player) => {
    const isCulprit = roles.get(player.id) === "culprit";
    const votedCorrectly = !isCulprit && votes[player.id] === culpritId;

    return {
      player,
      role: isCulprit ? "culprit" : "innocent",
      votedCorrectly,
      won: isCulprit ? !verdict.caught : verdict.caught && votedCorrectly,
    };
  });

  return {
    rows,
    culpritId,
    innocents: rows.filter((row) => row.role === "innocent").length,
    winners: rows.filter((row) => row.won),
  };
}

/** Two-letter monogram for avatar chips. Handles single-word and CJK names. */
export function initials(name) {
  const cleaned = (name || "").trim();
  if (!cleaned) return "??";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return [...words[0]].slice(0, 2).join("").toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A stable 0-9999 seed from a name, so a player's chip colour and avatar stay
 * the same across the whole session without storing anything.
 */
export function seedFromName(name) {
  let hash = 2166136261;
  for (const char of String(name)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 10000;
}

/** Muted, readable avatar background derived from the same seed. */
export function avatarTint(name) {
  const seed = seedFromName(name);
  const hue = seed % 360;
  return `hsl(${hue} 34% 58%)`;
}