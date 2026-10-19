"""The film's single source of timing.

Reads the desk capture's marks and writes src/timeline.json, which both the
Remotion picture and the audio mix read. Every desk event's film time is derived
from the capture, so changing one segment reflows picture and sound together.

Usage: python3 -I film/studio/plan.py
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MARKS = json.load(open(os.path.join(ROOT, "film/capture/take1/marks.json")))
M = MARKS["marks"]

FPS = 30
DURATION = 76.0
BPM = 120  # one beat = 0.5 s, one bar = 2 s

# ---------------------------------------------------------------- stage layout (1920x1080)
LAYOUT = {
    "amara": {"x": 72, "y": 248, "w": 480, "h": 372},
    "jonas": {"x": 72, "y": 632, "w": 480, "h": 371},
    "desk": {"x": 648, "y": 248, "w": 1200, "h": 750},
    "headline": {"x": 72, "y": 60},
}
DESK_K = LAYOUT["desk"]["w"] / MARKS["css"][0]  # stage px per capture CSS px


def desk_point(css_x, css_y):
    d = LAYOUT["desk"]
    return [d["x"] + css_x * DESK_K, d["y"] + css_y * DESK_K]


# ---------------------------------------------------------------- desk footage: film time -> capture time
SEND1 = 5.5
SEND2 = 60.0
DECISION2 = 65.0  # the auto-approval lands on a beat
seg = []


def play(f0, f1, c0, rate=1.0):
    seg.append({"f0": f0, "f1": f1, "c0": c0, "rate": rate})


def hold(f0, f1, c):
    seg.append({"f0": f0, "f1": f1, "c0": c, "rate": 0.0})


hold(0.0, SEND1, M["act1_key"] - 0.4)                    # idle desk before the first request (hidden in the opening)
play(SEND1, 15.3, M["act1_key"])                       # request → policy → approval sent → reply
hold(15.3, 20.8, M["act1_key"] + (15.3 - SEND1))
play(20.8, 24.95, 12.2)                                  # Finance edit, re-check, card refresh
hold(24.95, 36.5, 12.2 + 4.15)
APPROVE = 36.5
play(APPROVE, 40.45, M["approve_key"])                   # Jonas's click → recorded → reply
hold(40.45, 50.4, M["approve_key"] + (40.45 - APPROVE))
play(50.4, 54.2, M["learn_key"])                         # Automatic Learning announces the rule
hold(54.2, SEND2, M["learn_key"] + (54.2 - 50.4))
play(SEND2, 60.6, M["act4_key"])                         # the next request
c_fast_end = M["act4_decision"] - 2.023                  # where 1x resumes, so the decision lands on DECISION2
fast_f1 = DECISION2 - (M["act4_decision"] - c_fast_end)
c_fast0 = M["act4_key"] + 0.6
play(60.6, fast_f1, c_fast0, (c_fast_end - c_fast0) / (fast_f1 - 60.6))
c_end = 35.15
play(fast_f1, fast_f1 + (c_end - c_fast_end), c_fast_end)
hold(fast_f1 + (c_end - c_fast_end), DURATION, c_end)
SPEED_CHIP = {"f0": 60.6, "f1": fast_f1, "label": f"{(c_fast_end - c_fast0) / (fast_f1 - 60.6):.1f}× speed"}


def film_at(c):
    """Film time at which capture time c is on screen (first playing segment that contains it)."""
    for s in seg:
        if s["rate"] == 0:
            continue
        c1 = s["c0"] + (s["f1"] - s["f0"]) * s["rate"]
        if s["c0"] - 1e-6 <= c <= c1 + 1e-6:
            return round(s["f0"] + (c - s["c0"]) / s["rate"], 3)
    raise ValueError(f"capture time {c} is not played")


ev = {k: film_at(M[k]) for k in [
    "request_row", "lookup_done", "policy_over", "waiting_step", "reply1", "edit_click", "edit_commit",
    "recheck", "card_refreshed", "approved", "reply_approved", "learned", "act4_row", "act4_policy",
    "act4_decision", "act4_reply"]}
ev["type_2"], ev["type_9"], ev["type_5"] = film_at(M["type_2"]), film_at(M["type_9"]), film_at(M["type_5"])

# ---------------------------------------------------------------- Teams side (drawn; cards are real SDK renders)
CARD_DIR = os.path.join(HERE, "public/cards")


def card(name):
    w, h = Image.open(os.path.join(CARD_DIR, f"teams-{name}-card.png")).size
    return {"src": f"cards/teams-{name}-card.png", "w": w, "h": h}


def approve_button(name):
    """Normalised centre of the purple Approve button in a rendered card."""
    im = Image.open(os.path.join(CARD_DIR, f"teams-{name}-card.png")).convert("RGB")
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if abs(r - 0x5B) < 12 and abs(g - 0x5F) < 12 and abs(b - 0xC7) < 14:
                xs.append(x)
                ys.append(y)
    return [(min(xs) + max(xs)) / 2 / w, (min(ys) + max(ys)) / 2 / h]


PROMPT1 = "I need to book a hotel in London for the AI Summit, 4 to 7 Nov, around £320 a night."
PROMPT2 = "Booking London again for the AI Summit follow-up workshop, 18 to 20 Nov, £335 a night."
REPLY_APPROVED = ("Good news, Amara: Jonas approved your London hotel at £295 a night (£885). "
                  "Finance adjusted the rate from £320. It's logged against CC-410 Field Engineering.")


def typing(start, end_chars, text):
    n = len(text)
    return {"start": start, "end": end_chars, "text": text, "cps": round(n / (end_chars - start), 2)}


TYPING = [typing(0.9, 5.05, PROMPT1), typing(56.5, 59.7, PROMPT2)]
TEAMS = [
    {"t": SEND1, "panel": "amara", "kind": "user", "text": PROMPT1},
    {"t": SEND1 + 0.35, "until": ev["reply1"], "panel": "amara", "kind": "thinking"},
    {"t": ev["waiting_step"] + 0.15, "panel": "jonas", "kind": "card", "card": card("approval"), "id": "jonas-card"},
    {"t": ev["reply1"] + 0.1, "panel": "amara", "kind": "card", "card": card("summary")},
    {"t": ev["card_refreshed"] + 0.1, "panel": "jonas", "kind": "swap", "card": card("approval-edited"), "id": "jonas-card"},
    {"t": APPROVE + 0.25, "panel": "jonas", "kind": "swap", "card": card("approval-decided"), "id": "jonas-card"},
    {"t": ev["reply_approved"] + 0.05, "panel": "amara", "kind": "bot", "text": REPLY_APPROVED},
    {"t": SEND2, "panel": "amara", "kind": "user", "text": PROMPT2},
    {"t": SEND2 + 0.35, "until": ev["act4_reply"], "panel": "amara", "kind": "thinking"},
    {"t": ev["act4_reply"] + 0.1, "panel": "amara", "kind": "card", "card": card("summary-learned")},
]
PULSES = [
    {"t": SEND1 + 0.05, "from": "amara", "to": "desk"},
    {"t": ev["waiting_step"] - 0.25, "from": "desk", "to": "jonas"},
    {"t": ev["reply1"] - 0.2, "from": "desk", "to": "amara"},
    {"t": ev["card_refreshed"] - 0.2, "from": "desk", "to": "jonas"},
    {"t": APPROVE + 0.05, "from": "jonas", "to": "desk"},
    {"t": ev["reply_approved"] - 0.2, "from": "desk", "to": "amara"},
    {"t": SEND2 + 0.05, "from": "amara", "to": "desk"},
    {"t": ev["act4_reply"] - 0.2, "from": "desk", "to": "amara"},
]

# ---------------------------------------------------------------- copy (two lines; line two lands with the answer)
HEADLINES = [
    {"in": 1.0, "out": 7.6, "l1": "Ask in Teams."},
    {"in": 8.4, "in2": ev["policy_over"], "out": 19.6, "l1": "Finance sees", "l2": "every step."},
    {"in": 20.4, "in2": ev["recheck"], "out": 29.6, "l1": "Fix a detail.", "l2": "The agent keeps up."},
    {"in": 30.4, "in2": APPROVE + 0.3, "out": 43.4, "l1": "Managers decide", "l2": "where they already work."},
    {"in": 44.2, "in2": 49.4, "out": 55.6, "l1": "It learns", "l2": "how your managers decide."},
    {"in": 56.2, "in2": DECISION2, "out": 67.0, "l1": "Next time,", "l2": "it decides and says why."},
]

# ---------------------------------------------------------------- camera: stage point (fx, fy) at screen (tx, ty), scale s
A, J, D = LAYOUT["amara"], LAYOUT["jonas"], LAYOUT["desk"]
WIDE = {"fx": 960, "fy": 540, "s": 1.0, "tx": 960, "ty": 540}
AMARA_ZOOM = {"fx": A["x"] + A["w"] / 2, "fy": A["y"] + A["h"] / 2, "s": 1.62, "tx": 960, "ty": 640}
AMARA_MED = {"fx": A["x"] + A["w"] / 2, "fy": A["y"] + A["h"] / 2, "s": 1.38, "tx": 760, "ty": 630}
JONAS_ZOOM = {"fx": J["x"] + J["w"] / 2, "fy": J["y"] + J["h"] / 2, "s": 1.62, "tx": 900, "ty": 640}


def desk_focus(css_x, css_y, s, tx=1080, ty=640):
    x, y = desk_point(css_x, css_y)
    return {"fx": x, "fy": y, "s": s, "tx": tx, "ty": ty}


CAMERA = [
    [0.0, AMARA_ZOOM], [6.3, AMARA_ZOOM], [8.3, WIDE],
    [9.0, WIDE], [10.4, desk_focus(880, 520, 1.42)], [12.0, desk_focus(880, 520, 1.42)], [13.1, WIDE],
    [19.8, WIDE], [20.9, desk_focus(1250, 330, 1.55, 1200, 600)], [22.6, desk_focus(1250, 330, 1.55, 1200, 600)], [23.5, WIDE],
    [29.9, WIDE], [31.6, JONAS_ZOOM], [36.85, JONAS_ZOOM], [38.0, WIDE],
    [50.3, WIDE], [51.6, desk_focus(1250, 380, 1.45, 1180, 620)], [55.4, desk_focus(1250, 380, 1.45, 1180, 620)],
    [56.6, AMARA_MED], [59.8, AMARA_MED], [61.0, desk_focus(880, 560, 1.38)], [65.5, desk_focus(880, 560, 1.38)], [66.5, WIDE],
    [67.4, WIDE], [70.2, {"fx": 960, "fy": 600, "s": 0.9, "tx": 960, "ty": 560}],
]

# ---------------------------------------------------------------- cursor paths (stage coordinates)
eb = MARKS["boxes"]["edit_rate"]
edit_target = desk_point(eb["x"] + eb["width"] * 0.6, eb["y"] + eb["height"] / 2)
jc = card("approval-edited")
CARD_W = 410
jonas_card_h = CARD_W * jc["h"] / jc["w"]
jonas_card_x = J["x"] + 14 + 36
jonas_card_top = J["y"] + J["h"] - 14 - jonas_card_h
bx, by = approve_button("approval-edited")
approve_target = [jonas_card_x + bx * CARD_W, jonas_card_top + by * jonas_card_h]
CURSORS = [
    {"in": ev["edit_click"] - 0.9, "at": ev["edit_click"] - 0.08, "click": ev["edit_click"], "out": ev["edit_commit"] + 0.6,
     "from": [D["x"] + D["w"] + 40, D["y"] + 560], "to": edit_target, "park": [D["x"] + D["w"] + 60, D["y"] + 640], "kind": "click"},
    {"in": 34.0, "at": 35.5, "click": APPROVE, "out": APPROVE + 0.3,
     "from": [J["x"] + J["w"] + 120, J["y"] + 120], "to": approve_target, "park": [J["x"] + J["w"] + 160, J["y"] + 300], "kind": "approve"},
]

# ---------------------------------------------------------------- learning montage and end card
MONTAGE = {
    "in": 43.9, "out": 50.5, "chip": 44.0,
    "stamps": [
        {"t": 45.0, "month": "Jul", "who": "Leo Fischer", "rate": 300, "id": "EXP-2019"},
        {"t": 46.0, "month": "Aug", "who": "Hana Sato", "rate": 350, "id": "EXP-2029"},
        {"t": 47.0, "month": "Sep", "who": "Amara Nwosu", "rate": 280, "id": "EXP-2036"},
        {"t": 48.0, "month": "Today", "who": "Amara Nwosu", "rate": 295, "id": "EXP-2037"},
    ],
    "line": [48.6, 49.3], "rule": 49.4, "cap": 350,
}
END = {"wash": 70.0, "title": 70.5, "stack": 71.2, "silence": 75.0,
       "stack_items": ["Microsoft Agent Framework", "Azure OpenAI", "Microsoft Teams", "AG-UI", "CopilotKit"]}

timeline = {
    "fps": FPS, "duration": DURATION, "bpm": BPM, "layout": LAYOUT, "deskK": DESK_K,
    "desk": {"src": "desk.mp4", "css": MARKS["css"], "segments": seg, "speedChip": SPEED_CHIP},
    "events": ev, "send": [SEND1, SEND2], "approve": APPROVE, "decision2": DECISION2,
    "typing": TYPING, "teams": TEAMS, "pulses": PULSES, "headlines": HEADLINES,
    "camera": CAMERA, "cursors": CURSORS, "cardW": CARD_W, "montage": MONTAGE, "end": END,
}
# ---------------------------------------------------------------- tighten: drop dead holds, remap every film time
# Each interval sits inside a held (frozen) desk segment with a static camera, so removing it only shortens a hold.
CUTS = [[16.6, 19.6], [26.5, 29.0], [40.5, 43.0]]  # whole and half beats, so on-beat moments stay on beats


def cut(t):
    shift = 0.0
    for a, b in CUTS:
        if t >= b:
            shift += b - a
        elif t > a:
            return round(a - shift, 3)
    return round(t - shift, 3)


def remap(tl):
    for sg in tl["desk"]["segments"]:
        sg["f0"], sg["f1"] = cut(sg["f0"]), cut(sg["f1"])
    tl["desk"]["segments"] = [sg for sg in tl["desk"]["segments"] if sg["f1"] > sg["f0"]]
    sc = tl["desk"]["speedChip"]
    sc["f0"], sc["f1"] = cut(sc["f0"]), cut(sc["f1"])
    tl["events"] = {k: cut(v) for k, v in tl["events"].items()}
    tl["send"] = [cut(v) for v in tl["send"]]
    tl["approve"], tl["decision2"] = cut(tl["approve"]), cut(tl["decision2"])
    for k in tl["typing"]:
        k["start"], k["end"] = cut(k["start"]), cut(k["end"])
    for e in tl["teams"]:
        e["t"] = cut(e["t"])
        if "until" in e:
            e["until"] = cut(e["until"])
    for p_ in tl["pulses"]:
        p_["t"] = cut(p_["t"])
    for h in tl["headlines"]:
        for k in ("in", "in2", "out"):
            if k in h:
                h[k] = cut(h[k])
    tl["camera"] = [[cut(t), c] for t, c in tl["camera"]]
    for c in tl["cursors"]:
        for k in ("in", "at", "click", "out"):
            c[k] = cut(c[k])
    m = tl["montage"]
    m["in"], m["out"], m["chip"], m["rule"] = cut(m["in"]), cut(m["out"]), cut(m["chip"]), cut(m["rule"])
    m["line"] = [cut(v) for v in m["line"]]
    for st in m["stamps"]:
        st["t"] = cut(st["t"])
    e = tl["end"]
    for k in ("wash", "title", "stack", "silence"):
        e[k] = cut(e[k])
    tl["duration"] = cut(tl["duration"])
    tl["cuts"] = CUTS
    return tl


timeline = remap(timeline)
ev = timeline["events"]
out = os.path.join(HERE, "src/timeline.json")
with open(out, "w") as f:
    json.dump(timeline, f, indent=1, ensure_ascii=False)
print("wrote", out)
print("desk events (film s):", json.dumps(ev))
print("speed chip:", SPEED_CHIP)
print("approve target:", [round(v) for v in approve_target], "edit target:", [round(v) for v in edit_target])
