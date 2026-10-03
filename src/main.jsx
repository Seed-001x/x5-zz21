import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { formFor, hashSeed, stageIndexFor, developmentBlurb, STAGES } from "./shared/growth.js";
import "./style.css";

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// Seeded PRNG — VISUAL LAYOUT ONLY. Never drives organism state; the
// simulation is fully server-side and deterministic.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ageString(born) {
  const d = Math.max(0, Date.now() - born), s = Math.floor(d / 1000);
  const days = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${days}D ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
const timeStr = (ts) => new Date(ts).toLocaleTimeString();

// ---------------------------------------------------------------- neural net layout (seeded, visual only)
const rng = mulberry32(20261003);
const NODES = Array.from({ length: 42 }, () => ({ x: (rng() - .5) * 1.7, y: (rng() - .5) * 1.7 }));
const EDGES = [];
NODES.forEach((n, i) => {
  const dists = NODES.map((m, j) => ({ j, d: (n.x - m.x) ** 2 + (n.y - m.y) ** 2 }))
    .filter((e) => e.j !== i).sort((a, b) => a.d - b.d);
  dists.slice(0, 2).forEach((e) => { if (!EDGES.some(([a, b]) => (a === i && b === e.j) || (a === e.j && b === i))) EDGES.push([i, e.j]); });
});

// ---------------------------------------------------------------- Body
function Body({ state, bornAt, onObserve, nervous, apiRef }) {
  const ref = useRef(null);
  const pulses = useRef([]); // {edge:[a,b], t0, dur}
  apiRef.current = {
    pulse(kind) {
      const now = performance.now();
      const mk = (a, b) => pulses.current.push({ edge: [a, b], t0: now, dur: 900 });
      const neighbors = (i) => EDGES.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a));
      const byR = (dir) => NODES.map((n, i) => ({ i, r: n.x * n.x + n.y * n.y })).sort((a, b) => dir * (a.r - b.r))[0].i;
      if (kind === "in") { // stimulus: outer -> inward chain
        let cur = byR(-1);
        for (let h = 0; h < 3; h++) {
          const nb = neighbors(cur).sort((p, q) => (NODES[p].x ** 2 + NODES[p].y ** 2) - (NODES[q].x ** 2 + NODES[q].y ** 2))[0];
          if (nb == null) break;
          mk(cur, nb); cur = nb;
        }
      } else if (kind === "out") { // cognition: center -> outward
        let cur = byR(1);
        for (let h = 0; h < 3; h++) {
          const nb = neighbors(cur).sort((p, q) => (NODES[q].x ** 2 + NODES[q].y ** 2) - (NODES[p].x ** 2 + NODES[p].y ** 2))[0];
          if (nb == null) break;
          mk(cur, nb); cur = nb;
        }
      } else { // autonomous: short random walk
        let cur = Math.floor(rng() * NODES.length);
        for (let h = 0; h < 2; h++) {
          const opts = neighbors(cur);
          if (!opts.length) break;
          const nb = opts[Math.floor(rng() * opts.length)];
          mk(cur, nb); cur = nb;
        }
      }
      if (pulses.current.length > 40) pulses.current.splice(0, pulses.current.length - 40);
    }
  };

  useEffect(() => {
    const c = ref.current, ctx = c.getContext("2d");
    let raf, t = 0, last = performance.now();
    const draw = (now) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now; t += dt;
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const s = state.current || {};
      const ar = s.arousal ?? .2, stress = s.stress ?? .1, energy = s.energy ?? .7;
      const trust = s.trust ?? .3, valence = s.valence ?? .5;
      const resting = state.resting;
      // --- developmental morphology: the body plan is a pure function of
      // lived history (age, experience, emotional averages). Fallback computes
      // it client-side if an old server ever sends state without form.
      let form = s.form;
      if (!form || typeof form.lobes !== "number") {
        try { form = formFor(s.growth || {}, hashSeed(String(bornAt || 1))); } catch { form = null; }
      }
      const F = { lobes: 3, filaments: 22, vessels: 14, coreScale: 1, asymmetry: 0, wear: 0, hueDepth: 0, ridge: 0, seed: 1, dev: 0, ...(form || {}) };
      // Seeded, per-frame-stable idiosyncrasies: lobe phase, wear placement,
      // filament length jitter. Derived from the birth-timestamp seed — the
      // same organism always draws the same scars.
      const asymPhase = mulberry32(F.seed >>> 0)() * Math.PI * 2;
      const wearAngles = [];
      {
        const wr = mulberry32((F.seed ^ 0x9e3779b9) >>> 0);
        const nWear = Math.round(F.wear * 12);
        for (let i = 0; i < nWear; i++) wearAngles.push(wr() * Math.PI * 2);
      }
      const filJit = [];
      {
        const jr = mulberry32((F.seed ^ 0x85ebca6b) >>> 0);
        for (let i = 0; i < F.filaments; i++) filJit.push(0.85 + jr() * 0.3);
      }
      // state-driven movement parameters
      const breathRate = .8 + ar * 1.7 - (resting ? .45 : 0);
      const breathDepth = .045 * (.4 + energy * .8);
      const breath = Math.sin(t * breathRate) * breathDepth;
      const tension = stress; // membrane tension <- stress
      const openness = .92 + trust * .16; // body openness <- trust
      const lum = .35 + energy * .65 - (resting ? .18 : 0); // luminosity <- energy
      const ax = (s.attention?.x || 0) * 26 * (s.attention?.intensity || 0);
      const ay = (s.attention?.y || 0) * 18 * (s.attention?.intensity || 0);
      const cx = w / 2 + ax, cy = h / 2 + ay;
      const base = Math.min(w, h) * (.19 + breath) * (resting ? .94 : 1);
      const memAlpha = nervous ? .22 : 1; // nervous view: membrane goes transparent

      ctx.save(); ctx.translate(cx, cy);
      // --- membrane: layered, tension from stress, complexity from age ---
      // Lobe count grows with development (3 → 9); asymmetry and ridge are
      // weathering from a lived life, never decoration.
      for (let layer = 7; layer >= 0; layer--) {
        const r = base * (1 + layer * .07);
        ctx.beginPath();
        const pts = 110;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const n = Math.sin(a * F.lobes + t * .7) * .035
            + Math.sin(a * 7 - t * (1.1 + tension * 2.2)) * (.012 + tension * .03)
            + Math.sin(a * 11 + t * .5) * .008
            + F.asymmetry * Math.sin(a * 2 + asymPhase);
          const rx = r * (1 + n), ry = r * (openness + n * .7);
          const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        const warm = clamp((valence - .5) * 2, -1, 1);
        const deep = F.hueDepth; // color deepens with age — a patina, not a reskin
        ctx.fillStyle = `rgba(${90 + stress * 70 + warm * 22 - deep * 34},${150 + energy * 60 - deep * 44},${170 + ar * 70 - deep * 26},${(.016 + layer * .008) * memAlpha})`;
        const ridgeBoost = layer === 7 ? F.ridge * .14 : 0; // outermost ridge sharpens
        ctx.strokeStyle = `rgba(170,225,235,${(.045 + (7 - layer) * .022 + ridgeBoost) * memAlpha})`;
        ctx.lineWidth = .7; ctx.fill(); ctx.stroke();
      }
      // --- wear marks: scars of a hard life, at seeded positions ---
      if (wearAngles.length) {
        ctx.strokeStyle = `rgba(130,74,52,${(.22 + F.wear * .3) * memAlpha})`;
        ctx.lineWidth = 1.1;
        for (const wa of wearAngles) {
          ctx.beginPath();
          ctx.arc(0, 0, base * 1.28, wa, wa + .22);
          ctx.stroke();
        }
      }
      // --- vascular network: curved vessels with traveling pulses
      for (let i = 0; i < F.vessels; i++) {
        const a = (i / F.vessels) * Math.PI * 2 + .3;
        const pulse = (Math.sin(t * (1.4 + ar * 2.4) + i * 2.4) + 1) / 2;
        ctx.beginPath(); ctx.moveTo(0, 0);
        const r = base * (.3 + .6 * pulse);
        ctx.quadraticCurveTo(Math.cos(a + .9) * r * .45, Math.sin(a + .9) * r * .5, Math.cos(a) * r, Math.sin(a) * r * openness);
        ctx.strokeStyle = `rgba(150,215,225,${(.05 + pulse * .16) * memAlpha})`;
        ctx.lineWidth = .5 + pulse * .8; ctx.stroke();
      }
      // --- filaments: core to membrane (count grows with development)
      for (let i = 0; i < F.filaments; i++) {
        const a = (i / F.filaments) * Math.PI * 2 + t * .02;
        const pulse = (Math.sin(t * (1.2 + ar * 2.6) + i * 1.9) + 1) / 2;
        ctx.beginPath(); ctx.moveTo(0, 0);
        const r = base * (.25 + .7 * pulse) * (filJit[i] || 1);
        ctx.quadraticCurveTo(Math.cos(a + 1) * r * .4, Math.sin(a + 1) * r * .5, Math.cos(a) * r, Math.sin(a) * r * openness);
        ctx.strokeStyle = `rgba(190,240,245,${(.05 + pulse * .22) * memAlpha})`;
        ctx.lineWidth = .6 + pulse * .7; ctx.stroke();
      }
      // --- nervous system layer
      if (nervous) {
        const sc = base * 1.05;
        ctx.strokeStyle = "rgba(120,200,210,.20)"; ctx.lineWidth = .6;
        for (const [a, b] of EDGES) {
          ctx.beginPath(); ctx.moveTo(NODES[a].x * sc, NODES[a].y * sc);
          ctx.lineTo(NODES[b].x * sc, NODES[b].y * sc); ctx.stroke();
        }
        const nowMs = performance.now();
        pulses.current = pulses.current.filter((p) => nowMs - p.t0 < p.dur);
        for (const p of pulses.current) {
          const k = (nowMs - p.t0) / p.dur;
          const A = NODES[p.edge[0]], B = NODES[p.edge[1]];
          const x = (A.x + (B.x - A.x) * k) * sc, y = (A.y + (B.y - A.y) * k) * sc;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
          g.addColorStop(0, "rgba(220,255,255,.95)"); g.addColorStop(1, "rgba(120,220,230,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "rgba(200,240,245,.75)";
        for (const n of NODES) { ctx.beginPath(); ctx.arc(n.x * sc, n.y * sc, 1.6, 0, Math.PI * 2); ctx.fill(); }
      }
      // --- core (deepens with development)
      const core = base * (.16 * F.coreScale + .025 * Math.sin(t * 2.1));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, core * 3);
      g.addColorStop(0, `rgba(235,255,250,${.55 + lum * .3})`);
      g.addColorStop(1, "rgba(80,170,190,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, core * 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state, nervous]);

  return <canvas ref={ref} className="body" onMouseMove={(e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onObserve(((e.clientX - r.left) / r.width - .5) * 2, ((e.clientY - r.top) / r.height - .5) * 2);
  }} />;
}

// ---------------------------------------------------------------- state panel + waveform + why
const METRICS = ["valence", "arousal", "stress", "curiosity", "trust", "energy", "socialNeed", "novelty", "confidence", "fatigue", "stability", "dopamine", "serotonin", "cortisol", "oxytocin"];

function Waveform({ variable }) {
  const ref = useRef(null);
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch(`/api/history?variable=${variable}&limit=240`).then((r) => r.json()).then(setData).catch(() => setData([]));
  }, [variable]);
  useEffect(() => {
    if (!data || !ref.current) return;
    const c = ref.current, ctx = c.getContext("2d");
    const w = c.width = 220, h = c.height = 64;
    ctx.clearRect(0, 0, w, h);
    const vals = data.map((d) => d.value).filter((v) => v != null);
    if (!vals.length) { ctx.fillStyle = "#4a5f62"; ctx.font = "9px monospace"; ctx.fillText("no samples yet", 8, 32); return; }
    const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
    ctx.strokeStyle = "#7fd4d8"; ctx.lineWidth = 1; ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * w, y = h - 6 - ((v - lo) / span) * (h - 12);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#4a5f62"; ctx.font = "8px monospace";
    ctx.fillText(`min ${lo.toFixed(2)}  max ${hi.toFixed(2)}`, 6, h - 4);
  }, [data, variable]);
  return <canvas ref={ref} className="wave" />;
}

function StatePanel({ state }) {
  const [sel, setSel] = useState(null);
  const [why, setWhy] = useState(null);
  useEffect(() => {
    if (!sel) return;
    fetch(`/api/why/${sel}`).then((r) => r.json()).then(setWhy).catch(() => setWhy(null));
  }, [sel]);
  const s = state.current || {};
  return (
    <section className="glass state">
      {METRICS.map((k) => (
        <div key={k} onClick={() => setSel(sel === k ? null : k)} className={sel === k ? "sel" : ""}>
          <span>{k.toUpperCase()}</span><b>{Number(s[k] ?? 0).toFixed(3)}</b>
          <em style={{ width: `${clamp(s[k] ?? 0) * 100}%` }} />
        </div>
      ))}
      {sel && (
        <div className="why">
          <h4>WHY IS {sel.toUpperCase()} {Number(s[sel] ?? 0).toFixed(3)}?</h4>
          <Waveform variable={sel} />
          {(why?.causes || []).map((c, i) => (
            <p key={i}><small>{timeStr(c.t)}</small> {c.delta >= 0 ? "+" : ""}{c.delta.toFixed(4)} — {c.reason}</p>
          ))}
          {why && !why.causes?.length && <p><small>no recorded movements yet — homeostasis holding</small></p>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- memory constellation
function MemoryView() {
  const ref = useRef(null);
  const [mems, setMems] = useState([]);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    fetch("/api/snapshot").then((r) => r.json()).then((x) => setMems(x.memories || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    fetch(`/api/memories/${sel}`).then((r) => r.json()).then(setDetail).catch(() => setDetail(null));
  }, [sel]);
  const layout = useRef(new Map());
  const detailRef = useRef(null);
  const lastTouchSel = useRef(0);
  const touchStart = useRef(null);
  // nearest-node hit test; wider radius on coarse (touch) pointers
  const selectAt = (mx, my) => {
    const coarse = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer:coarse)").matches;
    const rad2 = (coarse ? 64 : 50) ** 2;
    let best = null, bd = 1e9;
    for (const m of mems) {
      const p = layout.current.get(m.id); if (!p) continue;
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) { bd = d; best = m.id; }
    }
    if (best && bd < rad2) setSel((prev) => (prev === best ? null : best));
  };
  const tapAt = (cx, cy, node) => {
    const r = node.getBoundingClientRect();
    selectAt(cx - r.left, cy - r.top);
  };
  // keep the detail visible when a node is selected on small screens
  useEffect(() => {
    if (sel && detailRef.current) {
      try { detailRef.current.scrollIntoView({ block: "nearest" }); } catch { /* noop */ }
    }
  }, [sel]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    let raf, t = 0;
    const draw = () => {
      t += .016;
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const pos = (m) => {
        if (!layout.current.has(m.id)) {
          const r2 = mulberry32(m.id * 7919 + 13);
          layout.current.set(m.id, { x: w * (.15 + r2() * .7), y: h * (.15 + r2() * .7), ph: r2() * 6.28 });
        }
        return layout.current.get(m.id);
      };
      // edges: shared associations
      ctx.strokeStyle = "rgba(120,190,200,.10)"; ctx.lineWidth = .6;
      for (let i = 0; i < mems.length; i++) for (let j = i + 1; j < mems.length; j++) {
        const a = new Set(mems[i].associations || []), b = new Set(mems[j].associations || []);
        if ([...a].some((x) => b.has(x))) {
          const pa = pos(mems[i]), pb = pos(mems[j]);
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
      }
      for (const m of mems) {
        const p = pos(m), imp = m.importance ?? .5;
        const tw = .6 + .4 * Math.sin(t * 1.3 + p.ph);
        const r = 2 + imp * 7 * tw;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        const warm = (m.valence ?? 0) >= 0;
        g.addColorStop(0, warm ? `rgba(190,240,235,${.35 + imp * .5})` : `rgba(240,190,180,${.35 + imp * .5})`);
        g.addColorStop(1, "rgba(120,200,210,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2); ctx.fill();
        if (sel === m.id) { ctx.strokeStyle = "#d7eeee"; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3 + 4, 0, Math.PI * 2); ctx.stroke(); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mems, sel]);
  return (
    <section className="glass memwrap">
      <canvas ref={ref} className="memcanvas"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
        }}
        onTouchEnd={(e) => {
          const s = touchStart.current; touchStart.current = null;
          if (!s) return;
          const t = e.changedTouches[0];
          if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) return; // drag/pinch, not a tap
          if (Date.now() - s.t > 300) return; // long-press, not a tap
          lastTouchSel.current = Date.now();
          tapAt(t.clientX, t.clientY, e.currentTarget);
        }}
        onClick={(e) => {
          if (Date.now() - lastTouchSel.current < 500) return; // synthetic click after touch
          tapAt(e.clientX, e.clientY, e.currentTarget);
        }} />
      {detail && (
        <article ref={detailRef} className="memdetail">
          <small>MEMORY #{detail.id} · {timeStr(detail.ts)}</small>
          <p>{detail.summary}</p>
          <span>V {Number(detail.valence ?? 0).toFixed(2)} · A {Number(detail.arousal ?? 0).toFixed(2)} · IMPORTANCE {Number(detail.importance ?? 0).toFixed(2)}</span>
          <span>SOURCE {detail.source} · assoc {(detail.associations || []).join(", ") || "—"}</span>
        </article>
      )}
      {!mems.length && <p className="empty">no memories yet — only the birth memory exists until it experiences something</p>}
    </section>
  );
}

// ---------------------------------------------------------------- events
function EventsView({ feed }) {
  return (
    <section className="glass events">
      {feed.slice().reverse().slice(0, 60).map((e, i) => (
        <article key={`${e.ts}-${i}`}>
          <small>{timeStr(e.ts)}</small>
          <p>{e.type}</p>
          {e.data?.text && <span>{String(e.data.text).slice(0, 120)}</span>}
          {e.data?.response && <span>→ {String(e.data.response).slice(0, 120)}</span>}
        </article>
      ))}
      {!feed.length && <p className="empty">listening…</p>}
    </section>
  );
}

// ---------------------------------------------------------------- app
function App() {
  const live = useRef({});
  const apiRef = useRef(null);
  const [snap, setSnap] = useState(null);
  const [mode, setMode] = useState("body");
  const [input, setInput] = useState("");
  const [reply, setReply] = useState(null);
  const [feed, setFeed] = useState([]);
  const [, rerender] = useState(0);
  const lastObserve = useRef(0);

  useEffect(() => {
    fetch("/api/snapshot").then((r) => r.json()).then((x) => { setSnap(x); live.current = x.state; live.resting = x.resting; });
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "state") { live.current = m.state; live.resting = m.resting; rerender((x) => x + 1); }
      if (m.type === "event") {
        setFeed((f) => [...f.slice(-120), m.event]);
        const t = m.event.type;
        if (t === "STIMULUS_RECEIVED" || t === "OBSERVER_DETECTED") apiRef.current?.pulse("in");
        else if (t === "COGNITION_COMPLETED") { apiRef.current?.pulse("out"); if (m.event.data?.response) setReply({ text: m.event.data.response, source: m.event.data.source }); }
        else if (t === "AUTONOMOUS_EVENT" || t === "REST_STARTED") apiRef.current?.pulse("auto");
      }
    };
    const onHide = () => { if (document.hidden) fetch("/api/observer-left", { method: "POST" }).catch(() => {}); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); ws.close(); };
  }, []);

  if (!snap) return <div className="boot">INITIALIZING OBSERVATION…</div>;
  const s = live.current;
  // Honest developmental readout — derived live from the organism's own
  // counters via the same pure functions the server uses.
  const dg = s.growth || {};
  let dStage = "NASCENT", dBlurb = "";
  try {
    dStage = STAGES[stageIndexFor(dg)].name.toUpperCase();
    dBlurb = developmentBlurb(dg);
  } catch { /* keep defaults */ }
  const observe = (x, y) => {
    const now = Date.now();
    if (now - lastObserve.current < 900) return;
    lastObserve.current = now;
    fetch("/api/observe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x, y, intensity: .25 }) }).catch(() => {});
  };
  const send = async () => {
    const t = input.trim(); if (!t) return;
    setInput(""); setReply({ text: "…", source: null });
    await fetch("/api/interact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
  };
  const labels = { body: "ORGANISM", nervous: "NERVOUS SYSTEM", state: "INTERNAL STATE", memory: "MEMORY", events: "EVENTS" };

  return (
    <main>
      <header>
        <b>X5-ZZ21</b><span>AGE {ageString(snap.bornAt)}</span><span>CYCLE {snap.cycles}</span>
        {live.resting && <span className="rest">RESTING</span>}
        <i>● LIVE</i>
      </header>
      <Body state={live} bornAt={snap.bornAt} onObserve={observe} nervous={mode === "nervous"} apiRef={apiRef} />
      <div className="drive">DOMINANT DRIVE<strong>{(s.dominantDrive || "observe").toUpperCase()}</strong></div>
      <div className="dev">DEVELOPMENT<strong>{dStage} · {dBlurb}</strong></div>
      <nav>
        {Object.keys(labels).map((x) => (
          <button key={x} className={mode === x ? "on" : ""} onClick={() => setMode(x)}>{labels[x]}</button>
        ))}
      </nav>
      {mode === "state" && <StatePanel state={live} />}
      {mode === "memory" && <MemoryView />}
      {mode === "events" && <EventsView feed={feed} />}
      <aside className="interact">
        {reply && <p className="reply">{reply.text}{reply.source && <small> · {reply.source === "llm" ? "language organ" : "fallback cognition"}</small>}</p>}
        <div>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="introduce stimulus…" />
          <button onClick={send}>TRANSMIT</button>
        </div>
      </aside>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
