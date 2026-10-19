"""One continuous 2x take of Expense Desk through all four demo acts.

Usage: python3 -I film/capture/capture_desk.py <out_dir> [base_url]

Records a CDP screencast (browser-level 2x density), logs when each milestone
first appears on screen and where the edit cursor has to go, then writes a
constant-30-fps clip (desk.mp4) and marks.json in clip seconds.
"""
import asyncio
import base64
import glob
import json
import os
import subprocess
import sys
import time

from playwright.async_api import async_playwright

OUT = os.path.abspath(sys.argv[1])
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4620/"
W, H, DPR = 1440, 900, 2

# Text that marks each milestone, checked with textContent (no forced layout).
PROBES = {
    "request_row": "Read as",
    "lookup_done": "reports to Jonas Lindqvist",
    "policy_over": "Over the London hotel cap",
    "waiting": "card sent in Teams",
    "waiting_step": "Waiting on Jonas Lindqvist",
    "reply1": "I'll message you as soon as there's a decision",
    "synced": "Synced to the agent",
    "recheck": "Re-checked: still over the London cap",
    "card_refreshed": "The agent updated the card with Finance's edit",
    "approved": "Approved by Jonas Lindqvist",
    "reply_approved": "Good news, Amara",
    "learned": "New from Automatic Learning",
    "act4_row": "AI Summit workshop",
    "act4_lookup": "EXP-2038",
    "act4_policy": "Within learned limit",
    "act4_decision": "Approved under learned rule",
    "act4_reply": "You're all set, Amara",
}


def chromium_path():
    hits = sorted(glob.glob(os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell")))
    return hits[-1] if hits else None


async def main():
    frames_dir = os.path.join(OUT, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    frames = []  # (wall_time, path)
    marks = {}
    boxes = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=chromium_path(), args=[f"--force-device-scale-factor={DPR}", "--hide-scrollbars"])
        page = await browser.new_page(viewport={"width": W, "height": H})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1500)
        # Focus the page without leaving a focus ring on any control.
        await page.mouse.click(720, 28)

        cdp = await page.context.new_cdp_session(page)

        def on_frame(params):
            now = time.time()
            path = os.path.join(frames_dir, f"{len(frames):05d}.jpg")
            with open(path, "wb") as f:
                f.write(base64.b64decode(params["data"]))
            frames.append((now, path))
            asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]}))

        cdp.on("Page.screencastFrame", on_frame)
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W * DPR, "maxHeight": H * DPR, "everyNthFrame": 1})

        t0 = time.time()
        stop_polling = False

        async def poll():
            while not stop_polling:
                found = await page.evaluate(
                    "(probes) => Object.fromEntries(Object.entries(probes).map(([k, s]) => [k, document.body.textContent.includes(s)]))",
                    PROBES,
                )
                now = time.time()
                for k, ok in found.items():
                    if ok and k not in marks:
                        marks[k] = now
                await asyncio.sleep(0.04)

        poller = asyncio.ensure_future(poll())

        def mark(name):
            marks[name] = time.time()

        async def wait_for(key, timeout=30):
            end = time.time() + timeout
            while key not in marks and time.time() < end:
                await asyncio.sleep(0.03)
            if key not in marks:
                raise RuntimeError(f"milestone never appeared: {key}")

        # A frame to anchor the start, then a quiet idle hold.
        await page.mouse.move(1500, 600)
        await asyncio.sleep(2.0)

        # Act 1: Amara's request.
        mark("act1_key")
        await page.keyboard.press("1")
        await wait_for("reply1")
        await asyncio.sleep(2.2)

        # Finance edits the nightly rate (the film draws the cursor from these boxes).
        btn = page.get_by_role("button", name="Edit Nightly rate")
        boxes["edit_rate"] = await btn.bounding_box()
        mark("edit_click")
        await btn.click()
        await asyncio.sleep(0.35)
        for ch in "295":
            mark(f"type_{ch}")
            await page.keyboard.type(ch)
            await asyncio.sleep(0.16)
        await asyncio.sleep(0.25)
        mark("edit_commit")
        await page.keyboard.press("Enter")
        await wait_for("card_refreshed")
        await asyncio.sleep(2.4)

        # Act 2: Jonas approves (the film draws his click in Teams).
        await page.mouse.click(720, 28)
        mark("approve_key")
        await page.keyboard.press("2")
        await wait_for("reply_approved")
        await asyncio.sleep(2.2)

        # Act 3: Automatic Learning.
        mark("learn_key")
        await page.keyboard.press("3")
        await wait_for("learned")
        await asyncio.sleep(3.2)

        # Act 4: the next request, approved under the learned rule.
        mark("act4_key")
        await page.keyboard.press("4")
        await wait_for("act4_reply")
        await asyncio.sleep(3.5)

        stop_polling = True
        await poller
        await cdp.send("Page.stopScreencast")
        await asyncio.sleep(0.3)
        await browser.close()

    if not frames:
        raise SystemExit("no frames captured")
    start = frames[0][0]
    # Constant 30 fps: each frame holds until the next one painted.
    concat = os.path.join(OUT, "frames.txt")
    with open(concat, "w") as f:
        for i, (t, path) in enumerate(frames):
            nxt = frames[i + 1][0] if i + 1 < len(frames) else t + 0.5
            f.write(f"file '{path}'\nduration {max(nxt - t, 0.001):.4f}\n")
        f.write(f"file '{frames[-1][1]}'\n")
    clip = os.path.join(OUT, "desk.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat,
                    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14",
                    "-movflags", "+faststart", clip], check=True)
    rel = {k: round(v - start, 3) for k, v in sorted(marks.items(), key=lambda kv: kv[1])}
    meta = {"fps": 30, "css": [W, H], "dpr": DPR, "duration": round(frames[-1][0] - start + 0.5, 3),
            "frames": len(frames), "marks": rel, "boxes": boxes, "errors": errors, "t0_offset": round(t0 - start, 3)}
    with open(os.path.join(OUT, "marks.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps({"frames": len(frames), "duration": meta["duration"], "errors": errors}, indent=1))
    print(json.dumps(rel, indent=1))


asyncio.run(main())
