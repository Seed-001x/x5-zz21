// server/blockchain.js — PLACEHOLDER for the future blockchain organ.
//
// DO NOT implement token economics here. This module only defines the shape
// blockchain data will one day take as sensory input.
//
// Design: the chain becomes part of the organism's ENVIRONMENT. Raw market
// observations are translated into a MARKET_EVENT { kind, magnitude,
// direction, source, novelty } and the organism's existing emotional/memory
// architecture decides what it means. A wallet may later become an entity
// in associative memory. No restrictions, punishment, or financial controls.

export const MARKET_EVENT_SHAPE = {
  type: 'MARKET_EVENT',
  fields: {
    kind: 'token_purchase | token_sale | large_holder_movement | new_holder | returning_wallet | liquidity_event | price_volatility | holder_growth | wallet_behavior',
    magnitude: 'number 0..1',
    direction: "'positive' | 'negative' | 'neutral'",
    source: 'string (e.g. wallet address) | null',
    novelty: 'number 0..1',
    observed_at: 'ISO timestamp',
  },
};

// Not wired to any chain. Validates shape and emits a namespaced event so
// the pipeline can be tested end-to-end later. All mappings are provisional.
export function ingestMarketEvent(raw, organism, record) {
  const problems = [];
  if (!raw || typeof raw !== 'object') problems.push('event must be an object');
  else {
    if (typeof raw.magnitude !== 'number') problems.push('magnitude must be a number');
    if (!['positive', 'negative', 'neutral'].includes(raw.direction)) problems.push('direction invalid');
  }
  if (problems.length) {
    record('MARKET_EVENT', { rejected: true, problems, placeholder: true });
    return { accepted: false, problems };
  }
  const mag = Math.min(1, Math.max(0, raw.magnitude));
  const s = organism.s;
  const clamp = (n) => Math.max(0, Math.min(1, n));
  if (raw.direction === 'negative') {
    s.threat = clamp(s.threat + 0.25 * mag);
    organism.noteCause('market event (placeholder): threat');
  } else if (raw.direction === 'positive') {
    s.reward = clamp(s.reward + 0.25 * mag);
    organism.noteCause('market event (placeholder): reward');
  }
  s.novelty = clamp(s.novelty + 0.15 * (raw.novelty ?? 0.5));
  record('MARKET_EVENT', {
    kind: raw.kind ?? 'unknown', magnitude: mag, direction: raw.direction,
    source: raw.source ?? null, novelty: raw.novelty ?? 0.5, placeholder: true,
  });
  return { accepted: true, placeholder: true };
}
