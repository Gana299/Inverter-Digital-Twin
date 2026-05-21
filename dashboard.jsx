import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from "recharts";

const MODEL = {
  L: 2e-3,
  C: 10e-6,
  R: 0.5,
  Vdc: 400,
  fgrid: 50,
  fsw: 10000,
  dt: 1e-4,
};

function spwm(t, mIndex, fgrid, fsw) {
  const ref = mIndex * Math.sin(2 * Math.PI * fgrid * t);
  const carrier = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * fsw * t));
  return ref > carrier ? 1 : -1;
}

function stepInverter(state, t, params, faultType) {
  let { iL, vC, theta } = state;
  const { L, C, R, Vdc, fgrid, fsw, dt } = params;
  const Vgrid = 230 * Math.sqrt(2) * Math.sin(theta);
  const phaseErr = vC - Vgrid;
  const dTheta = 2 * Math.PI * fgrid + 0.5 * phaseErr * 0.01;
  const newTheta = theta + dTheta * dt;
  const mIndex = 0.85;
  const sw = spwm(t, mIndex, fgrid, fsw);
  const Vinv = sw * Vdc * 0.5;
  let Leff = L, Ceff = C, Reff = R;
  if (faultType === "inductor") Leff = L * 0.6;
  if (faultType === "capacitor") Ceff = C * 0.4;
  if (faultType === "resistance") Reff = R * 3;
  const diL = (Vinv - Reff * iL - vC) / Leff;
  const dvC = (iL - vC / 1000) / Ceff;
  return {
    iL: iL + diL * dt,
    vC: vC + dvC * dt,
    theta: newTheta,
    Vinv,
    Vgrid,
    sw,
  };
}

function calcTHD(samples) {
  if (samples.length < 32) return 0;
  const N = samples.length;
  const freqBin = (k) => {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      re += samples[n] * Math.cos(2 * Math.PI * k * n / N);
      im -= samples[n] * Math.sin(2 * Math.PI * k * n / N);
    }
    return Math.sqrt(re * re + im * im) / N;
  };
  const V1 = freqBin(1);
  let harmSum = 0;
  for (let k = 2; k <= 10; k++) harmSum += freqBin(k) ** 2;
  return V1 > 0 ? (Math.sqrt(harmSum) / V1) * 100 : 0;
}

export default function InverterTwin() {
  const [running, setRunning] = useState(false);
  const [fault, setFault] = useState("none");
  const [waveData, setWaveData] = useState([]);
  const [metrics, setMetrics] = useState({ thd: 0, vRms: 0, iRms: 0, freq: 50, pll: "LOCKED" });
  const [faultAlert, setFaultAlert] = useState(null);
  const stateRef = useRef({ iL: 0, vC: 0, theta: 0 });
  const tRef = useRef(0);
  const bufferRef = useRef([]);
  const animRef = useRef(null);
  const tickRef = useRef(0);
  const WINDOW = 100;
  const STEPS_PER_FRAME = 20;

  const tick = useCallback(() => {
    const params = MODEL;
    let s = stateRef.current;
    const pts = [];
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      const next = stepInverter(s, tRef.current, params, fault === "none" ? null : fault);
      s = { iL: next.iL, vC: next.vC, theta: next.theta };
      tRef.current += params.dt;
      tickRef.current++;
      pts.push({
        t: +(tRef.current * 1000).toFixed(2),
        vout: +next.vC.toFixed(2),
        iout: +next.iL.toFixed(3),
        vgrid: +next.Vgrid.toFixed(2),
        vinv: +next.Vinv.toFixed(2),
      });
      bufferRef.current.push(next.vC);
      if (bufferRef.current.length > 200) bufferRef.current.shift();
    }
    stateRef.current = s;
    setWaveData(prev => [...prev, ...pts].slice(-WINDOW));
    if (tickRef.current % 10 === 0) {
      const buf = bufferRef.current;
      const thd = calcTHD(buf);
      const vRms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
      const iRms = Math.abs(s.iL) * 0.707;
      setMetrics({ thd: +thd.toFixed(2), vRms: +vRms.toFixed(1), iRms: +iRms.toFixed(3), freq: 50, pll: vRms > 100 ? "LOCKED" : "SEARCHING" });
      const nominalVrms = 230 * Math.sqrt(2) * 0.707;
      const residual = Math.abs(vRms - nominalVrms);
      if (fault !== "none" && residual > 30) {
        setFaultAlert(`FAULT DETECTED — Residual: ${residual.toFixed(1)} V | THD: ${thd.toFixed(1)}%`);
      } else if (fault === "none") {
        setFaultAlert(null);
      }
    }
    animRef.current = requestAnimationFrame(tick);
  }, [fault]);

  useEffect(() => {
    if (running) {
      animRef.current = requestAnimationFrame(tick);
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [running, tick]);

  const reset = () => {
    setRunning(false);
    stateRef.current = { iL: 0, vC: 0, theta: 0 };
    tRef.current = 0;
    tickRef.current = 0;
    bufferRef.current = [];
    setWaveData([]);
    setFaultAlert(null);
    setMetrics({ thd: 0, vRms: 0, iRms: 0, freq: 50, pll: "LOCKED" });
  };

  const faults = ["none", "inductor", "capacitor", "resistance"];
  const faultLabels = { none: "Healthy", inductor: "Inductor Fault", capacitor: "Capacitor Fault", resistance: "High ESR" };

  return (
    <div style={{ minHeight: "100vh", background: "#050a0f", fontFamily: "'Courier New', monospace", color: "#00ff88", padding: "0", backgroundImage: "radial-gradient(ellipse at 20% 50%, #001a0f 0%, transparent 60%)" }}>
      <div style={{ borderBottom: "1px solid #00ff8830", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#00ff8870", marginBottom: 2 }}>POWER ELECTRONICS RESEARCH LAB</div>
          <div style={{ fontSize: 20, fontWeight: "bold", letterSpacing: 2 }}>⚡ INVERTER DIGITAL TWIN</div>
        </div>
        <div style={{ padding: "4px 12px", borderRadius: 2, fontSize: 11, letterSpacing: 2, background: running ? "#00ff8820" : "#ff003320", border: `1px solid ${running ? "#00ff88" : "#ff0033"}`, color: running ? "#00ff88" : "#ff0033" }}>
          {running ? "● RUNNING" : "■ STOPPED"}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {faultAlert && (
          <div style={{ background: "#ff003315", border: "1px solid #ff0033", borderLeft: "4px solid #ff0033", padding: "10px 16px", marginBottom: 16, borderRadius: 2, fontSize: 12, color: "#ff4466" }}>
            ⚠ {faultAlert}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setRunning(r => !r)} style={{ padding: "10px 28px", background: running ? "#ff003320" : "#00ff8820", border: `1px solid ${running ? "#ff0033" : "#00ff88"}`, color: running ? "#ff0033" : "#00ff88", cursor: "pointer", fontSize: 12, letterSpacing: 2, fontFamily: "inherit", borderRadius: 2 }}>
            {running ? "■ STOP" : "▶ START"}
          </button>
          <button onClick={reset} style={{ padding: "10px 20px", background: "transparent", border: "1px solid #00ff8840", color: "#00ff8880", cursor: "pointer", fontSize: 12, fontFamily: "inherit", borderRadius: 2 }}>↺ RESET</button>
          <div style={{ marginLeft: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, letterSpacing: 2, color: "#00ff8860", alignSelf: "center" }}>INJECT FAULT:</span>
            {faults.map(f => (
              <button key={f} onClick={() => setFault(f)} style={{ padding: "6px 14px", fontSize: 10, fontFamily: "inherit", background: fault === f ? (f === "none" ? "#00ff8820" : "#ff550020") : "transparent", border: `1px solid ${fault === f ? (f === "none" ? "#00ff88" : "#ff5500") : "#00ff8830"}`, color: fault === f ? (f === "none" ? "#00ff88" : "#ff7733") : "#00ff8860", cursor: "pointer", borderRadius: 2 }}>
                {faultLabels[f]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "OUTPUT VRMS", value: `${metrics.vRms} V`, sub: "Target: 230 V" },
            { label: "OUTPUT IRMS", value: `${metrics.iRms} A`, sub: "Load current" },
            { label: "THD", value: `${metrics.thd}%`, sub: "IEEE limit: <5%", warn: metrics.thd > 5 },
            { label: "GRID FREQ", value: `${metrics.freq} Hz`, sub: "Nominal" },
            { label: "PLL STATUS", value: metrics.pll, sub: "Phase sync", warn: metrics.pll !== "LOCKED" },
          ].map(m => (
            <div key={m.label} style={{ background: "#0a1a12", border: `1px solid ${m.warn ? "#ff550060" : "#00ff8820"}`, borderTop: `2px solid ${m.warn ? "#ff5500" : "#00ff88"}`, padding: "14px 16px", borderRadius: 2 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#00ff8860", marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: "bold", color: m.warn ? "#ff7733" : "#00ff88" }}>{m.value}</div>
              <div style={{ fontSize: 9, color: "#00ff8840", marginTop: 4 }}>{m.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "#0a1a12", border: "1px solid #00ff8820", padding: "16px", borderRadius: 2 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8870", marginBottom: 12 }}>OUTPUT VOLTAGE vs GRID REFERENCE</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={waveData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#00ff8810" />
                <XAxis dataKey="t" tick={{ fill: "#00ff8840", fontSize: 9 }} tickLine={false} />
                <YAxis tick={{ fill: "#00ff8840", fontSize: 9 }} tickLine={false} domain={[-400, 400]} />
                <Line type="monotone" dataKey="vout" stroke="#00ff88" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="vgrid" stroke="#0088ff" dot={false} strokeWidth={1} strokeDasharray="4 2" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <span style={{ fontSize: 9, color: "#00ff88" }}>— Vout</span>
              <span style={{ fontSize: 9, color: "#0088ff" }}>-- Vgrid</span>
            </div>
          </div>

          <div style={{ background: "#0a1a12", border: "1px solid #00ff8820", padding: "16px", borderRadius: 2 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8870", marginBottom: 12 }}>INDUCTOR CURRENT iL(t)</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={waveData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#00ff8810" />
                <XAxis dataKey="t" tick={{ fill: "#00ff8840", fontSize: 9 }} tickLine={false} />
                <YAxis tick={{ fill: "#00ff8840", fontSize: 9 }} tickLine={false} />
                <ReferenceLine y={0} stroke="#00ff8830" />
                <Line type="monotone" dataKey="iout" stroke="#ffaa00" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <span style={{ fontSize: 9, color: "#ffaa00" }}>— iL Inductor Current (A)</span>
          </div>
        </div>

        <div style={{ background: "#0a1a12", border: "1px solid #00ff8820", padding: "16px", borderRadius: 2 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8870", marginBottom: 12 }}>INVERTER SWITCHING OUTPUT Vinv(t)</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={waveData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00ff8810" />
              <XAxis dataKey="t" tick={{ fill: "#00ff8840", fontSize: 9 }} tickLine={false} />
              <YAxis tick={{ fill: "#00ff8840", fontSize: 9 }} tickLine={false} domain={[-220, 220]} />
              <Line type="stepAfter" dataKey="vinv" stroke="#ff0055" dot={false} strokeWidth={1} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <span style={{ fontSize: 9, color: "#ff0055" }}>— Vinv switching output</span>
        </div>

        <div style={{ marginTop: 16, fontSize: 9, color: "#00ff8830", letterSpacing: 2, textAlign: "center" }}>
          SINGLE-PHASE FULL-BRIDGE VSI · LC FILTER · SPWM · EULER INTEGRATION · PLL GRID SYNC
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}*{box-sizing:border-box}`}</style>
    </div>
  );
}