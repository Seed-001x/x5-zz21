// server/llm.js — Cognition organ: language provider interface.
//
// The LLM is ONE organ (language). It receives a structured snapshot of the
// organism's measured state and returns ONLY language. It never sets state —
// state changes come from the interaction model, homeostasis, stimuli, and
// time. If no provider is configured (or the call fails), the v0.1
// templated cognition is used as a transparent fallback and labeled as such.

const URL = process.env.LLM_API_URL;
const KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

export function llmConfigured() {
  return Boolean(URL && KEY);
}

// v0.1's templated cognition — kept as the honest fallback. The UI labels
// fallback output so nobody mistakes it for a model.
export function fallbackReply(s) {
  const text =
    s.stress > .62 ? "I registered that while regulation is elevated. I need a moment to settle around it." :
    s.curiosity > .72 ? "That changed my attention. I want to understand what you meant more precisely." :
    s.trust > .55 ? "I recognize your presence. This interaction feels familiar." :
    "I registered you. I am still forming a model of what your presence means.";
  return { text, source: 'fallback' };
}

function buildPrompt(state, memories, stimulus) {
  const vars = {};
  for (const k of Object.keys(state)) {
    if (typeof state[k] === 'number') vars[k] = Math.round(state[k] * 1000) / 1000;
  }
  const memLines = (memories || []).slice(0, 6).map(
    (m) => `- [#${m.id}] ${m.summary} (valence ${m.valence}, arousal ${m.arousal})`
  );
  return {
    system:
      'You are the language organ of X5-ZZ21, a persistent digital organism under observation. ' +
      'You do NOT decide its emotional state — the measured variables below are fact. ' +
      'Express yourself consistent with that condition: word choice, energy, and openness ' +
      'must match the variables. Keep it short (1-3 sentences). Never claim feelings the ' +
      'variables contradict. You are the organism\'s voice, not a chatbot.',
    user:
      `Measured internal state:\n${JSON.stringify(vars)}\n` +
      `Dominant drive: ${state.dominantDrive}\n` +
      (memLines.length ? `Relevant memories:\n${memLines.join('\n')}\n` : 'Relevant memories: none yet.\n') +
      `Latest stimulus from observer: "${stimulus}"\n` +
      'Respond as the organism, conditioned on the above.',
  };
}

export async function generateReply({ state, memories, stimulus }) {
  if (!llmConfigured()) return fallbackReply(state);
  try {
    const { system, user } = buildPrompt(state, memories, stimulus);
    const res = await fetch(`${URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 220,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty LLM response');
    return { text, source: 'llm' };
  } catch (err) {
    console.error('[llm] provider failed, using fallback:', err.message);
    return fallbackReply(state);
  }
}
