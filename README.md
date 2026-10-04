# Cloak & Dagger

**An AI-hosted social-deduction party game for 4–12 players around one phone.**

Four to twelve friends, one table, one device. An AI host writes a fresh
conspiracy every night, deals each player a secret card, narrates the tension,
reads the accusations back and announces the verdict out loud. Exactly one
player did it.

Built on the [Pollinations](https://pollinations.ai) API.

---

## Play

**[Live at xxooxannn.github.io/cloak-and-dagger](https://xxooxannn.github.io/cloak-and-dagger/)**

You need a free Pollinations API key — grab one at
[enter.pollinations.ai/keys](https://enter.pollinations.ai/keys) and paste it
into the wallet panel. That's it: no account, no server, no build step.

## How a night goes

1. **Seat the table.** Enter names for 4–12 players.
2. **The host deals.** The phone passes around; each player privately reveals a
   sealed card — their role, one piece of private knowledge, and a secret goal.
   The screen hides itself again before anyone can glance.
3. **The opening.** The host describes the scene and the incident, then starts
   a three-minute discussion timer.
4. **Accusations.** One at a time, each player secretly names a suspect and
   gives one line of reasoning. Nobody hears anyone else's.
5. **The host weighs in.** It reads the sealed accusations anonymously and
   hands out awards for the sharpest reading and the most inventive lie.
6. **The ballot.** Everyone votes. A **strict majority** of the whole table is
   needed to convict — a plurality or a tie lets the culprit walk.
7. **The verdict.** The host announces the result, the culprit confesses, and
   a case-file poster is generated for the group.

## Fairness, and why the AI can't cheat

Every rule that decides a winner lives in [`js/engine.js`](js/engine.js), which
has no network or DOM code in it at all. Roles are dealt with a
cryptographically-seeded shuffle, votes are tallied in code, and the AI is only
ever handed the outcome as settled fact to narrate. It cannot leak the culprit
early, change who voted for whom, or hand anyone a win.

Accusations reach the model **anonymously** — it never learns who accused whom,
so it can't give the game away by how it reacts.

The rules are covered by tests: `npm test`.

## Cost

Roughly **0.02–0.05 Pollen** for a full game on the default models.

| Call | Model | Used for |
| --- | --- | --- |
| Scenario, cards, awards, verdict | `openai/gpt-5.4-nano` | Structure and prose |
| Narration | `qwen/qwen3-tts-instruct-flash` | The host's voice |
| Scene art, case-file poster | `tongyi-mai/z-image-turbo` | Illustration |

Model ids are constants at the top of [`js/api.js`](js/api.js) if you'd rather
trade cost for quality.

## Bring your own Pollen

There's no backend. Requests go straight from the browser to
`gen.pollinations.ai` with the host's own key, which lives in `sessionStorage`
and is never uploaded anywhere or seen by anyone else. That's the
[BYOP](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md)
model — the app costs its builder nothing to run.

For a public deployment with OAuth instead of paste-a-key, see
[Connect User Wallets](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md)
in the Pollinations repo.

## Accessibility

- Every spoken line is captioned on screen at the same time.
- Voice can be switched off entirely; the game plays identically in silence.
- Full keyboard support, visible focus rings, and `prefers-reduced-motion` respected.
- Works on a phone, which is how this is meant to be played.

## Running it locally

Any static file server works — it's plain ES modules, no bundler.

```bash
npm test          # game rule tests
npm run serve     # http://localhost:8080
```

## Layout

```
index.html          shell and chrome
css/base.css        design tokens, base layer
css/app.css         screens, cards, timer
js/api.js           Pollinations client (text, speech, images, balance)
js/engine.js        pure game rules — no DOM, no network
js/host.js          every prompt the AI host is allowed to run
js/ui.js            DOM helpers, overlays, speaker queue, countdown
js/main.js          screen router and game flow
test/engine.test.mjs
```

## Credits

Scenario writing, narration and art are generated with
[Pollinations](https://pollinations.ai). The rules engine, interface and art
direction are original to this repository.

MIT licensed.