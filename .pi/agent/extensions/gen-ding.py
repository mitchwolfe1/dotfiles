#!/usr/bin/env python3
"""Synthesize the 'DING' played by the pi ding extension (stdlib only).

Regenerate the sound after tuning the constants below:
    python3 ~/.pi/agent/extensions/gen-ding.py
The extension (ding.ts) loads ./ding.wav relative to itself, so no code
changes are needed after regenerating.
"""
import math
import struct
import wave

OUT = "/home/mitch/.pi/agent/extensions/ding.wav"

SR = 44100
DUR = 0.7               # seconds — snappy
F0 = 2093.0             # C7 — bright, clearly higher than the original C6

# Bell-like partials: (ratio of fundamental, relative amplitude, decay tau s).
# Inharmonic ratios give the metallic "DING" character; higher partials decay
# faster like a real struck bell. Taus are scaled to fit DUR.
PARTIALS = [
    (1.00, 0.65, 0.48),  # strike tone (body)
    (2.76, 0.22, 0.17),  # tierce-ish partial
    (5.40, 0.10, 0.08),  # quint-ish partial
    (8.93, 0.06, 0.05),  # shimmer, fast decay (the "tick" attack)
]
ATTACK = 0.004  # s — ramp up to avoid a click
TAIL = 0.05     # s — fade the very end to zero

N = int(SR * DUR)
samples = [0.0] * N
for ratio, amp, tau in PARTIALS:
    freq = F0 * ratio
    for i in range(N):
        t = i / SR
        samples[i] += amp * math.sin(2 * math.pi * freq * t) * math.exp(-t / tau)

for i in range(N):
    t = i / SR
    env = 1.0
    if t < ATTACK:
        env = t / ATTACK
    if t > DUR - TAIL:
        env = min(env, (DUR - t) / TAIL)
    samples[i] *= env

peak = max(abs(s) for s in samples) or 1.0
gain = 0.85 / peak

with wave.open(OUT, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s * gain)) * 32767)) for s in samples))

print(f"wrote {N/SR:.2f}s ({DUR}s target), {F0:.0f} Hz fundamental, peak={peak:.3f}")
