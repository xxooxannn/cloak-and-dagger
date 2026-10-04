/**
 * Small DOM helpers and the three shared overlays (toast, busy, curtain).
 * No framework: the whole app is a handful of screens and a dependency-free
 * bundle keeps the Pages deploy trivial.
 */

export const $ = (selector, root = document) => root.querySelector(selector);

/** Create an element with attributes and children in one call. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : value);
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* -------------------------------------------------------------------------
   Toasts
   ------------------------------------------------------------------------- */

function toastRail() {
  let rail = $(".toast-rail");
  if (!rail) {
    rail = el("div", { class: "toast-rail", role: "status", "aria-live": "polite" });
    document.body.append(rail);
  }
  return rail;
}

export function toast(message, kind = "info", ms = 5200) {
  const node = el("div", { class: "toast", dataset: { kind } }, message);
  toastRail().append(node);
  setTimeout(() => {
    node.style.transition = "opacity .3s, transform .3s";
    node.style.opacity = "0";
    node.style.transform = "translateY(6px)";
    setTimeout(() => node.remove(), 320);
  }, ms);
  return node;
}

/* -------------------------------------------------------------------------
   Busy overlay — every wait says what it is actually waiting for
   ------------------------------------------------------------------------- */

export function busy(label, note = "") {
  const overlay = el(
    "div",
    { class: "busy", role: "alert", "aria-busy": "true" },
    el("div", { class: "busy__mark" }),
    el("p", { class: "busy__label", text: label }),
    note ? el("p", { class: "busy__note", text: note }) : null,
  );
  document.body.append(overlay);
  return () => overlay.remove();
}

/* -------------------------------------------------------------------------
   Curtain — pass-the-device privacy screen
   ------------------------------------------------------------------------- */

/**
 * Shows a full-screen gate and resolves when the player clears it.
 *
 * Resolves with the value of the action taken. When `choices` is given the
 * curtain renders tappable seats and resolves with the chosen choice's `value`
 * instead — that is how the accusation and vote screens collect an answer.
 */
export function curtain({ eyebrow, title, note, body, choices, actions = [] }) {
  // `note` may be a node (when a caller needs to update it in place) or a string.
  const noteNode = note instanceof Node ? note : note ? el("p", { class: "curtain__note", text: note }) : null;

  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === "Escape") close(null);
    };

    const choiceRow = choices
      ? el(
          "div",
          { class: "seats", style: "width:min(760px,100%)" },
          choices.map((choice) =>
            el(
              "button",
              {
                class: "chip",
                disabled: Boolean(choice.disabled),
                title: choice.disabled ? choice.disabledReason || "Unavailable" : choice.label,
                onClick: () => close(choice.value),
              },
              choice.avatar ||
                el(
                  "span",
                  {
                    class: "chip__avatar",
                    style: choice.tint ? `background:${choice.tint}` : "",
                  },
                  choice.monogram || "?",
                ),
              el(
                "div",
                { style: "min-width:0" },
                el("div", { class: "chip__name", text: choice.label }),
                el("div", { class: "chip__sub", text: choice.sub || "" }),
              ),
            ),
          ),
        )
      : null;

    const overlay = el(
      "div",
      { class: "curtain" },
      eyebrow ? el("p", { class: "eyebrow", text: eyebrow }) : null,
      el("h2", { class: "curtain__title", text: title }),
      noteNode,
      body || null,
      choiceRow,
      actions.length
        ? el(
            "div",
            { class: "curtain__actions" },
            actions.map((action) =>
              el(
                "button",
                {
                  class: `btn ${action.variant ? `btn--${action.variant}` : ""} btn--lg`,
                  onClick: () => close(action.value ?? true),
                },
                action.label,
              ),
            ),
          )
        : null,
    );

    document.body.append(overlay);
    document.addEventListener("keydown", onKey);
    overlay.querySelector(".btn, .chip:not(:disabled)")?.focus();
  });
}

/* -------------------------------------------------------------------------
   Speaker
   ------------------------------------------------------------------------- */

/**
 * Speaks queued lines and reports whether it is currently speaking, so the UI
 * can show a live indicator. Failures are swallowed: narration is flavour, and
 * a game must still be playable with the sound off or the audio route down.
 */
export function createSpeaker({ speak, voice, onStateChange, onVoiceFailure }) {
  let queue = [];
  let playing = false;
  let audio = null;
  let muted = false;
  let currentUrl = null;
  let warned = false;

  const setSpeaking = (value) => onStateChange?.(value);

  async function playNext() {
    if (playing) return;
    const line = queue.shift();
    if (line === undefined) {
      setSpeaking(false);
      return;
    }

    if (muted) {
      // Still pace the captions so the reading rhythm survives.
      await new Promise((r) => setTimeout(r, Math.min(line.length * 42, 5200)));
      return playNext();
    }

    playing = true;
    setSpeaking(true);

    try {
      const url = await speak(line, { voice });
      currentUrl = url;
      audio = new Audio(url);
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () => reject(new Error("audio playback failed"));
        audio.play().catch(reject);
      });
    } catch (error) {
      // Say something once if the voice itself is the problem (a paid-only
      // model on a free balance, say) rather than failing silently forever.
      if (!warned && /balance|pollen|402/i.test(error?.message || "")) {
        warned = true;
        onVoiceFailure?.(error);
      }
      // Silent fallback: pause a beat in place of the voice.
      await new Promise((r) => setTimeout(r, Math.min(line.length * 42, 5200)));
    } finally {
      playing = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
      audio = null;
    }

    playNext();
  }

  return {
    /** Queue lines; returns a promise that settles when the queue drains. */
    say(...lines) {
      const fresh = lines.flat().filter((line) => typeof line === "string" && line.trim());
      if (!fresh.length) return Promise.resolve();
      queue.push(...fresh);
      const done = new Promise((resolve) => {
        const check = setInterval(() => {
          if (!playing && queue.length === 0) {
            clearInterval(check);
            resolve();
          }
        }, 150);
      });
      playNext();
      return done;
    },
    get speaking() {
      return playing;
    },
    setMuted(value) {
      muted = value;
      if (value) {
        queue = [];
        if (audio) {
          audio.pause();
          audio = null;
        }
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
          currentUrl = null;
        }
        playing = false;
        setSpeaking(false);
      }
    },
    get muted() {
      return muted;
    },
    stop() {
      queue = [];
      if (audio) audio.pause();
    },
  };
}

/* -------------------------------------------------------------------------
   Countdown timer
   ------------------------------------------------------------------------- */

export function countdown({ seconds, onTick, onDone }) {
  const total = seconds;
  let remaining = seconds;
  let handle = null;

  const tick = () => {
    onTick?.(remaining, total);
    if (remaining <= 0) {
      clearInterval(handle);
      onDone?.();
      return;
    }
    remaining -= 1;
  };

  handle = setInterval(tick, 1000);
  onTick?.(remaining, total);

  return {
    stop() {
      clearInterval(handle);
    },
    add(secondsToAdd) {
      remaining = Math.min(total, remaining + secondsToAdd);
      onTick?.(remaining, total);
    },
  };
}

export function formatClock(seconds) {
  const clamped = Math.max(0, Math.round(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}