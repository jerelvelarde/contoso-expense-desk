"""Check that a hosted demo build shows the presenter controls on load and can
be driven by clicking (no keyboard, no `?presenter`).

Usage: python3 -I deploy/check_controls.py <base_url>
Credentials for basic auth can be embedded in base_url (https://user:pass@host/).
Exits non-zero if the panel is missing, a click does not advance the demo, or
the page logs a console error.
"""
import asyncio
import glob
import os
import sys

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4630/"


def chromium_path():
    # Same lookup as design/capture_states.py; None lets Playwright pick its own.
    hits = sorted(glob.glob(os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell")))
    return hits[-1] if hits else None


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=chromium_path())
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))

        await page.goto(BASE, wait_until="networkidle")
        panel = page.get_by_text("Demo · stands in for Teams")
        try:
            await panel.wait_for(state="visible", timeout=5000)
        except Exception:
            await browser.close()
            print("FAIL: demo controls are not open on load. Was the build made with VITE_SHOW_DEMO_CONTROLS=true?")
            return 1

        await page.get_by_role("button", name="Amara asks for a London hotel").click()
        try:
            await page.get_by_text("Waiting on Jonas").first.wait_for(state="visible", timeout=20000)
        except Exception:
            await browser.close()
            print("FAIL: clicking step 1 in the controls did not bring a request to 'Waiting on Jonas'.")
            return 1

        await browser.close()
        if errors:
            print("FAIL: console errors:\n" + "\n".join(errors))
            return 1
        print("ok: controls open on load, clicking step 1 drives the demo, no console errors")
        return 0


sys.exit(asyncio.run(main()))
