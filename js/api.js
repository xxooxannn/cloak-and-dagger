/**
 * Pollinations API client.
 *
 * Every request is billed to the player's own key (Bring Your Own Pollen), so
 * there is no backend here and this app never spends anyone's Pollen but the
 * host's. Text runs through the OpenAI-compatible endpoint, speech through
 * `/v1/audio/speech`, and stills through `/v1/images/generations`.
 */

const BASE = "https://gen.pollinations.ai";

export const MODELS = {
  // Cheap and quick enough for the host's turn-taking, strong at structured output.
  text: "openai/gpt-5.4-nano",
  // openai/tts-1 is deliberate: it is one of only two speech models reachable
  // with Quest Pollen. The richer elevenlabs/qwen voices are paid-only and fail
  // with 402 for anyone playing on a free balance.
  speech: "openai/tts-1",
  // Fast, cheap, no per-image premium tier.
  image: "tongyi-mai/z-image-turbo",
};

/** Raised for any non-2xx response, carrying a message worth showing a player. */
export class PollinationsError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = "PollinationsError";
    this.status = status;
    this.detail = detail;
  }
}

function authHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** Pollinations reports problems as JSON, but proxies like plain text. */
async function readError(response) {
  const body = await response.text().catch(() => "");
  let detail = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body);
    detail =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.detail ||
      detail;
  } catch {
    /* keep the raw text */
  }

  // 402/403 on a Pollinations request almost always means "no Pollen left".
  if (response.status === 402) {
    return new PollinationsError(
      "Out of Pollen. Add some to this key at enter.pollinations.ai/keys and try again.",
      { status: 402, detail },
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new PollinationsError(
      "That API key was rejected. Check you pasted the full sk_ key.",
      { status: response.status, detail },
    );
  }
  return new PollinationsError(
    `Pollinations returned ${response.status}.`,
    { status: response.status, detail },
  );
}

async function post(key, path, body, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new PollinationsError(
      "Could not reach gen.pollinations.ai. Check your connection.",
      { detail: String(cause) },
    );
  }

  if (!response.ok) throw await readError(response);
  return response;
}

/**
 * Ask a text model for JSON matching `schema`, retrying once on bad output.
 * The retry matters: small models occasionally wrap JSON in prose or a fence.
 */
export async function askJson(key, { system, prompt, model = MODELS.text, signal }) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await post(
      key,
      "/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: attempt === 0 ? 0.9 : 0.6,
      },
      { signal },
    );

    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content ?? "";
    try {
      return JSON.parse(stripFence(raw));
    } catch {
      lastError = new PollinationsError("The model returned unreadable JSON.", {
        detail: raw.slice(0, 200),
      });
    }
  }
  throw lastError;
}

/** Same as askJson but for plain prose — used for the host's spoken lines. */
export async function askText(key, { system, prompt, model = MODELS.text, signal }) {
  const response = await post(
    key,
    "/v1/chat/completions",
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.85,
      max_tokens: 420,
    },
    { signal },
  );

  const payload = await response.json();
  return (payload?.choices?.[0]?.message?.content ?? "").trim();
}

/** Models sometimes emit ```json fences even when asked for raw JSON. */
function stripFence(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Synthesize one spoken line and resolve an object URL for an <audio> element.
 * `instructions` steers delivery on models that accept it (Gemini, Qwen instruct).
 */
export async function speak(key, text, { voice = "af_wonder", instructions, signal } = {}) {
  const response = await post(
    key,
    "/v1/audio/speech",
    {
      model: MODELS.speech,
      input: text,
      voice,
      response_format: "mp3",
      ...(instructions ? { instructions } : {}),
    },
    { signal },
  );

  const blob = await response.blob();
  if (!blob.size) {
    throw new PollinationsError("The host came back silent.", { detail: "empty audio" });
  }
  return URL.createObjectURL(blob);
}

/** Generate a still. Returns a Pollinations media URL so it stays cacheable. */
export async function generateImage(key, prompt, { model = MODELS.image, size = "1024x1024", signal } = {}) {
  const response = await post(
    key,
    "/v1/images/generations",
    { prompt, model, size, response_format: "url" },
    { signal },
  );

  const payload = await response.json();
  const url = payload?.data?.[0]?.url;
  if (!url) {
    throw new PollinationsError("The image came back empty.", {
      detail: JSON.stringify(payload).slice(0, 200),
    });
  }
  return url;
}

/** Reads the wallet so the host can see their Pollen before starting a game. */
export async function fetchBalance(key, { signal } = {}) {
  const response = await fetch(`${BASE}/account/balance`, {
    headers: { Authorization: `Bearer ${key}` },
    signal,
  });
  if (!response.ok) throw await readError(response);
  return response.json();
}