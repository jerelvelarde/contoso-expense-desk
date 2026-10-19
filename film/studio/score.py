"""Score and foley for "Approvals That Learn", written to the cut.

Every note and hit is placed from src/timeline.json at sample precision, so the
music follows the picture: a four-note question when Amara asks, a held
suspended chord while the agent waits for Jonas, a stamp that resolves it, four
resolving stamps as the agent learns, and an instant resolution in the payoff.

Usage: python3 -I film/studio/score.py [variant]   (variants: A full, B lighter foley, C music only)
Writes out/audio/{music,foley,mix-<variant>}.wav at 48 kHz stereo (unnormalised).
"""
import json
import os
import random
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.expanduser("~/.claude/skills/making-launch-films/sound-kit/wav")
T = json.load(open(os.path.join(HERE, "src/timeline.json")))


def tc(t):
    """Map a time written against the uncut plan onto the tightened cut (same rule as plan.py)."""
    shift = 0.0
    for a, b in T.get("cuts", []):
        if t >= b:
            shift += b - a
        elif t > a:
            return a - shift
    return t - shift
SR = 48000
DUR = T["duration"]
N = int(DUR * SR)
VARIANT = sys.argv[1] if len(sys.argv) > 1 else "A"
rng = np.random.default_rng(20261019)

music = np.zeros((N, 2))
foley = np.zeros((N, 2))


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# F Lydian, MIDI numbers
F2, C3, F3, A3, C4, E4, F4, G4, A4, B4, C5, D5, E5, F5, G5, A5, C6, D6 = 41, 48, 53, 57, 60, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 84, 86
QUESTION = [A4, C5, E5, G5]          # rises and stops on the 2nd degree: unresolved
EDIT_Q = [F4, A4, C5, E5]            # a step lower, ends on the 7th: still unresolved
CHORDS = {
    "Fadd9": [F3, A3, C4, G4], "G/F": [F3, G4, B4, D5], "Am7": [A3, C4, E4, G4],
    "Fsus2": [F3, C4, G4], "Fmaj": [F3, A3, C4, F4, A4], "Fmaj9": [F3, A3, C4, E4, G4],
}


def place(buf, t, sig, pan=0.0, gain=1.0):
    """Mix a mono signal into a stereo buffer at time t (constant-power pan, -1 left .. 1 right)."""
    i = int(round(t * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    s = sig[max(0, -i):]
    i = max(0, i)
    s = s[: len(buf) - i]
    a = (pan + 1) * np.pi / 4
    buf[i:i + len(s), 0] += s * np.cos(a) * gain
    buf[i:i + len(s), 1] += s * np.sin(a) * gain


def env_adsr(n, a=0.005, r=0.05):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def lowpass(x, cutoff):
    """One-pole low-pass (cheap, gentle)."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # short signals only
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


# ------------------------------------------------------------------ instruments

def piano(m, dur=2.4, vel=0.8):
    """Felt piano: inharmonic partials, high partials fade fast, soft hammer."""
    f = midi(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, 11):
        fk = f * k * np.sqrt(1 + 0.0004 * k * k)
        if fk > 7000:
            break
        amp = (1 / k ** 1.35) * (0.55 if fk > 2200 else 1.0)
        tau = 2.6 / (k ** 0.75) * (261.6 / f) ** 0.25
        out += amp * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)
    hammer = rng.standard_normal(int(0.006 * SR)) * np.linspace(1, 0, int(0.006 * SR)) * 0.08
    out[: len(hammer)] += hammer
    out *= env_adsr(n, 0.004, 0.25) * vel
    return out * 0.32


def marimba(m, vel=0.7):
    f = midi(m)
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    k = (440 / f) ** 0.3
    out = (np.sin(2 * np.pi * f * t) * np.exp(-t / (0.42 * k))
           + 0.22 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / (0.09 * k))
           + 0.05 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t / 0.03))
    click = rng.standard_normal(int(0.002 * SR)) * 0.05
    out[: len(click)] += click
    return out * env_adsr(n, 0.001, 0.08) * vel * 0.3


def pizz(m, vel=0.7, dur=0.9):
    """Karplus-Strong pluck."""
    f = midi(m)
    n = int(dur * SR)
    p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(n):
        v = buf[i % p]
        out[i] = v
        buf[i % p] = 0.996 * 0.5 * (v + buf[(i + 1) % p])
    return lowpass(out, 2400) * env_adsr(n, 0.002, 0.2) * vel * 0.45


def pad(notes, dur, attack=1.2, release=1.4, bright=2400, gain=0.12):
    """Warm string pad: detuned band-limited saws, slow envelope."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f0 = midi(m)
        for det in (-0.006, 0.0, 0.0055):
            f = f0 * (1 + det)
            ph = rng.uniform(0, 6.28)
            for k in range(1, int(bright / f) + 1):
                out += np.sin(2 * np.pi * f * k * t + ph * k) / k * (0.85 ** k)
    e = np.ones(n)
    na, nr = int(attack * SR), int(release * SR)
    e[:na] = np.linspace(0, 1, na) ** 1.6
    e[-nr:] *= np.linspace(1, 0, nr) ** 1.4
    return out * e * gain / max(1, len(notes))


def sub(m, dur=2.5, gain=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * midi(m) * t) * np.exp(-t / 0.9) * env_adsr(n, 0.01, 0.3) * gain


def boom(dur=3.0, gain=0.7):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 58 * np.exp(-t / 0.25) + 41
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.1) * env_adsr(n, 0.004, 0.5) * gain


def stamp(gain=1.0):
    """Soft rubber stamp, tuned to F: a low thud, a felt contact, a short body tone."""
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    thud = np.sin(2 * np.pi * np.cumsum(95 * np.exp(-t / 0.05) + 55) / SR) * np.exp(-t / 0.09)
    body = 0.45 * np.sin(2 * np.pi * midi(F3) * t) * np.exp(-t / 0.07)
    nz = rng.standard_normal(n) * np.exp(-t / 0.012) * 0.35
    return lowpass(thud + body + nz, 1800) * env_adsr(n, 0.001, 0.08) * gain * 0.8


def pen_tick(m=C6, gain=0.5):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * midi(m) * t) * np.exp(-t / 0.022) + 0.3 * np.sin(2 * np.pi * midi(m) * 2.7 * t) * np.exp(-t / 0.008)
    return s * env_adsr(n, 0.0008, 0.02) * gain * 0.35


def glass(gain=0.5, notes=(C6, G5)):
    """The pulse on the line: a soft glassy dyad."""
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * midi(m) * t) * np.exp(-t / 0.22) for m in notes)
    s += 0.25 * np.sin(2 * np.pi * midi(notes[0]) * 2.01 * t) * np.exp(-t / 0.08)
    return s * env_adsr(n, 0.003, 0.15) * gain * 0.18


def paper(gain=0.4):
    n = int(0.3 * SR)
    x = rng.standard_normal(n)
    x = lowpass(x, 3500) - lowpass(x, 700)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    return x * e * gain * 0.6


def kit(rel):
    with wave.open(os.path.join(KIT, rel)) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        if w.getnchannels() == 2:
            data = data.reshape(-1, 2).mean(axis=1)
    return data


# ------------------------------------------------------------------ the score

def question(t, notes=QUESTION, step=0.25, vel=0.75, hold=2.4):
    for i, m in enumerate(notes):
        last = i == len(notes) - 1
        place(music, t + i * step, piano(m, dur=hold if last else 1.4, vel=vel * (1.08 if last else 1)), pan=-0.15 + 0.1 * i)


def answer(t, vel=0.85, full=False):
    place(music, t - 0.12, piano(G5, 0.5, vel * 0.5), pan=0.1)   # grace note into the resolution
    place(music, t, piano(A5, 3.0, vel), pan=0.1)
    for m in CHORDS["Fmaj"]:
        place(music, t, piano(m, 3.2, vel * 0.42), pan=-0.2)
    place(music, t, sub(F2 + 12, 2.2, 0.28 if not full else 0.4))


def pulse(t0, t1, chords, vel=0.55, density=1.0):
    """Interlocking marimba eighth notes over a two-bar chord cycle."""
    beat = 60 / T["bpm"]
    pattern_a = [0, 2, 3, 2, 1, 2, 3, 2]
    i = 0
    t = t0
    while t < t1 - 1e-6:
        bar = int((t - t0) / (beat * 4))
        notes = CHORDS[chords[(bar // 2) % len(chords)]]
        top = sorted(notes)[1:] + [notes[0] + 12]
        m = top[pattern_a[i % 8] % len(top)]
        accent = 1.0 if i % 4 == 0 else 0.72
        if density >= 1 or i % 2 == 0:
            place(music, t, marimba(m + 12, vel * accent), pan=0.25 if i % 2 else -0.25)
        if i % 8 == 5:
            place(music, t, marimba(notes[0] + 12, vel * 0.5), pan=-0.35)
        t += beat / 2
        i += 1


def layer_pad(t0, t1, chord, **kw):
    place(music, t0, pad(CHORDS[chord] if isinstance(chord, str) else chord, t1 - t0, **kw))


ev = T["events"]
send1, send2 = T["send"]
approve, decision2 = T["approve"], T["decision2"]
stamps = [s["t"] for s in T["montage"]["stamps"]]

# I · Ask: silence, then the question on send
question(send1)
layer_pad(send1 + 0.5, tc(15.0), "Fsus2", attack=2.0, release=2.0, gain=0.09)
pulse(tc(8.0), tc(20.0), ["Fadd9", "G/F", "Am7", "Fsus2"], vel=0.5)
layer_pad(tc(14.0), tc(30.5), "Fadd9", attack=2.0, release=1.6, gain=0.07)
question(tc(21.0), EDIT_Q, vel=0.65, hold=2.0)                     # Fix a detail: a step lower, still open
pulse(tc(20.0), tc(29.6), ["Fadd9", "G/F"], vel=0.42, density=0.5)

# II · Wait: everything drops to one held suspended chord
layer_pad(tc(29.6), approve + 0.6, [F3, C4, G4, B4], attack=2.4, release=0.5, bright=2000, gain=0.13)
place(music, tc(30.5), piano(G5, 6.2, 0.5), pan=0.1)              # the open question, hanging
place(music, approve, stamp(1.1))
answer(approve, vel=0.9)
layer_pad(approve, tc(43.8), "Fmaj", attack=0.6, release=2.0, gain=0.08)
pulse(tc(38.0), tc(43.5), ["Fadd9", "Fmaj9"], vel=0.38, density=0.5)

# III · Learn: four approvals, each resolves and adds a layer
layer_pad(tc(43.4), tc(44.6), "Fmaj9", attack=0.9, release=0.6, gain=0.06)
for i, st in enumerate(stamps):
    place(music, st - 0.5, piano(E5, 0.6, 0.45))
    place(music, st - 0.25, piano(G5, 0.6, 0.5))
    place(music, st, stamp(0.85 + 0.05 * i))
    answer(st, vel=0.62 + 0.06 * i)
    if i >= 1:
        place(music, st, pizz(F2 + 12, 0.8))
        place(music, st + 0.5, pizz(C3 + 12, 0.6))
    if i >= 2:
        pulse(st, st + 1.0, ["Fmaj"], vel=0.42)
    if i >= 3:
        layer_pad(st, tc(50.8), "Fmaj9", attack=0.5, release=1.8, gain=0.1)
line0, line1 = T["montage"]["line"]
for k, m in enumerate([F5, A5, C6, E5 + 12, G5 + 12]):                # the rule draws: a slow shimmer
    place(music, line0 + k * 0.25, marimba(m, 0.45), pan=-0.4 + 0.2 * k)
layer_pad(tc(50.4), tc(60.3), "Fmaj9", attack=1.6, release=1.2, gain=0.06)
pulse(tc(52.0), tc(56.0), ["Fmaj9"], vel=0.3, density=0.5)

# Next time: the same question, answered at once
question(send2, vel=0.7, hold=1.4)
pulse(send2 + 1.0, decision2, ["Fadd9", "G/F"], vel=0.4)
answer(decision2, vel=0.95)
place(music, decision2, stamp(0.9))
silence_from, silence_to = decision2 + 0.5, decision2 + 1.0          # one beat of nothing
full_in = silence_to
for m in CHORDS["Fmaj9"]:
    place(music, full_in, piano(m, 3.4, 0.5))
place(music, full_in, boom(2.6, 0.45))
layer_pad(full_in, T["end"]["wash"] + 0.3, "Fmaj9", attack=0.3, release=0.8, gain=0.12)
pulse(full_in, T["end"]["wash"], ["Fmaj9", "Fadd9"], vel=0.55)
for t0 in np.arange(full_in, T["end"]["wash"], 2.0):
    place(music, t0, pizz(F2 + 12, 0.7))

# Coda: the final chord, ring-out, silent last second
end_hit = T["end"]["wash"]
place(music, end_hit, boom(4.5, 0.75))
for m in [F2 + 12, C3 + 12, F3, A3, C4, G4, A4, C5, E5]:
    place(music, end_hit, piano(m, 4.8, 0.55))
place(music, end_hit, pad([F3, A3, C4, E4, G4], 4.6, attack=0.05, release=3.6, gain=0.12))
place(music, end_hit + 0.5, marimba(A5 + 12, 0.35), pan=0.4)


# ------------------------------------------------------------------ foley from the timeline

def human_keys(chars, gap=(0.072, 0.10), seed=7):
    r = random.Random(seed)
    res, nxt = [], -1.0
    for t, ch in chars:
        if t >= nxt:
            res.append((t, "space" if ch == " " else "key"))
            nxt = t + r.uniform(*gap)
    return res


softkeys = [kit(f"typing-C/softkey-{i:02d}.wav") for i in range(1, 17)]
softspaces = [kit(f"typing-C/softspace-{i}.wav") for i in range(1, 5)]
enter = [kit("keys-special/enter-1.wav"), kit("keys-special/enter-2.wav")]
click = kit("clicks/click-1.wav")
release = kit("clicks/release-1.wav")
air = {k: kit(f"air/{k}.wav") for k in ["whoosh-1", "rise", "pull"]}
kr = random.Random(11)
typing_gain = 0.0 if VARIANT == "C" else (0.55 if VARIANT == "B" else 0.8)
tick_gain = 0.0 if VARIANT == "C" else (0.6 if VARIANT == "B" else 1.0)


def play_keys(start, end, text, pan=-0.2):
    n = len(text)
    chars = [(start + (end - start) * i / n, ch) for i, ch in enumerate(text)]
    last = None
    for t, kind in human_keys(chars):
        bank = softspaces if kind == "space" else softkeys
        choice = kr.choice([s for s in bank if s is not last] or bank)
        last = choice
        place(foley, t + kr.uniform(-0.004, 0.004), choice, pan=pan + kr.uniform(-0.08, 0.08), gain=typing_gain * 10 ** (kr.uniform(-1.1, 1.1) / 20))


for k in T["typing"]:
    play_keys(k["start"], k["end"], k["text"])
for s in T["send"]:
    place(foley, s, kr.choice(enter), pan=-0.2, gain=typing_gain * 1.2)
# Finance types 295 and presses Enter in the desk
for key in ["type_2", "type_9", "type_5"]:
    place(foley, ev[key], kr.choice(softkeys), pan=0.3, gain=typing_gain)
place(foley, ev["edit_commit"], enter[0], pan=0.3, gain=typing_gain * 1.1)
# cursor click on the rate (Jonas's approval is the stamp in the music)
for c in T["cursors"]:
    if c["kind"] == "click":
        place(foley, c["click"], click, pan=0.4, gain=0.7)
        place(foley, c["click"] + 0.09, release, pan=0.4, gain=0.45)
# a tuned pen tick for every step the agent lands in the desk
for key, m in [("lookup_done", C6), ("policy_over", D6), ("waiting_step", C6), ("recheck", D6),
               ("approved", C6), ("act4_policy", D6), ("act4_decision", C6)]:
    place(foley, ev[key], pen_tick(m, 0.9), pan=0.35, gain=tick_gain)
# the pulse along the line, panned in the direction it travels
for p in T["pulses"]:
    toward_desk = p["to"] == "desk"
    s = glass(0.9)
    half = len(s) // 2
    place(foley, p["t"], s[:half], pan=-0.5 if toward_desk else 0.5, gain=tick_gain)
    place(foley, p["t"] + 0.18, s[half:], pan=0.5 if toward_desk else -0.5, gain=tick_gain)
# cards arriving in Teams
for e in T["teams"]:
    if e["kind"] in ("card", "swap", "bot"):
        place(foley, e["t"], paper(0.5), pan=-0.45, gain=tick_gain * 0.8)
# air under the big moves
place(foley, tc(6.6), air["whoosh-1"], gain=0.35)
place(foley, T["montage"]["in"] - 0.3, air["rise"], gain=0.4)
place(foley, tc(67.4), air["pull"], gain=0.4)

# ------------------------------------------------------------------ reverb, ducking, mix

def reverb(x, seconds=1.9, damp=0.6, wet=0.22):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n) * np.exp(-t / damp)
        # darker tail: progressively smooth the noise
        k = np.exp(-2 * np.pi * 2500 / SR)
        sm = np.copy(noise)
        for i in range(1, n):
            sm[i] = (1 - k) * noise[i] + k * sm[i - 1]
        ir[:, ch] = sm
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    out = np.zeros_like(x)
    for ch in range(2):
        y = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir[:, ch], size), size)[: len(x)]
        out[:, ch] = y
    return x * (1 - wet) + out * wet * 3.0


music = reverb(music)
foley_wet = reverb(foley, seconds=0.9, damp=0.25, wet=0.12)

# Music dips about 5.5 dB while someone types
duck = np.ones(N)
for k in T["typing"]:
    a, b = int((k["start"] - 0.3) * SR), int((k["end"] + 0.3) * SR)
    duck[a:b] = 10 ** (-5.5 / 20)
duck = np.convolve(duck, np.ones(int(0.25 * SR)) / int(0.25 * SR), mode="same")
music *= duck[:, None]

# The beat of silence before everything comes in: gated after the reverb, so it is a real breath
i0, i1, i2 = int(silence_from * SR), int((silence_to - 0.08) * SR), int(silence_to * SR)
music[i0:i1] *= (np.linspace(1, 0, i1 - i0) ** 2)[:, None]
music[i1:i2] = 0

# Silent last second
tail = int((T["end"]["silence"]) * SR)
fade = int(0.8 * SR)
for buf in (music, foley_wet):
    buf[tail - fade:tail] *= np.linspace(1, 0, fade)[:, None]
    buf[tail:] = 0

music_level = 1.0
foley_level = 1.0 if VARIANT == "A" else (0.75 if VARIANT == "B" else 0.0)
mix = music * music_level + foley_wet * foley_level
peak = np.abs(mix).max()
mix = mix / peak * 0.89

out = os.path.join(HERE, "out/audio")
os.makedirs(out, exist_ok=True)


def save(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


save(os.path.join(out, f"mix-{VARIANT}.wav"), mix)
if VARIANT == "A":
    save(os.path.join(out, "music.wav"), music / peak * 0.89)
    save(os.path.join(out, "foley.wav"), foley_wet / peak * 0.89)
print("wrote", os.path.join(out, f"mix-{VARIANT}.wav"), f"peak before normalise {peak:.2f}")
