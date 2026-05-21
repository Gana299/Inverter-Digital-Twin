import numpy as np
import matplotlib.pyplot as plt

# ── Inverter Parameters ──────────────────────────
L   = 2e-3    # Filter inductance (H)
C   = 10e-6   # Filter capacitance (F)
R   = 0.5     # Parasitic resistance (Ω)
Vdc = 400     # DC bus voltage (V)
f   = 50      # Grid frequency (Hz)
dt  = 1e-4    # Timestep (s)
T   = 0.1     # Simulation time (s)

# ── SPWM Modulation ──────────────────────────────
def spwm(t, m=0.85, fgrid=50, fsw=10000):
    ref     = m * np.sin(2 * np.pi * fgrid * t)
    carrier = (2/np.pi) * np.arcsin(np.sin(2 * np.pi * fsw * t))
    return np.where(ref > carrier, 1, -1)

# ── State-Space Simulation ───────────────────────
def simulate(fault=None):
    steps  = int(T / dt)
    t_arr  = np.linspace(0, T, steps)
    iL     = np.zeros(steps)
    vC     = np.zeros(steps)

    Leff = L * 0.6 if fault == "inductor"   else L
    Ceff = C * 0.4 if fault == "capacitor"  else C
    Reff = R * 3.0 if fault == "resistance" else R

    for k in range(1, steps):
        sw      = spwm(t_arr[k])
        Vinv    = sw * Vdc * 0.5
        diL     = (Vinv - Reff * iL[k-1] - vC[k-1]) / Leff
        dvC     = (iL[k-1] - vC[k-1] / 1000)        / Ceff
        iL[k]   = iL[k-1] + diL * dt
        vC[k]   = vC[k-1] + dvC * dt

    return t_arr, iL, vC

# ── Plot ─────────────────────────────────────────
t, iL, vC = simulate(fault=None)

plt.figure(figsize=(12, 6))

plt.subplot(2, 1, 1)
plt.plot(t * 1000, vC, color='#00ff88', linewidth=1)
plt.title('Output Voltage Vout(t)')
plt.xlabel('Time (ms)')
plt.ylabel('Voltage (V)')
plt.grid(True, alpha=0.3)

plt.subplot(2, 1, 2)
plt.plot(t * 1000, iL, color='#ffaa00', linewidth=1)
plt.title('Inductor Current iL(t)')
plt.xlabel('Time (ms)')
plt.ylabel('Current (A)')
plt.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('waveforms.png')
plt.show()
print("Done! Waveforms saved.")