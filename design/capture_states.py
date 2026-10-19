"""Walk the Expense Desk demo and screenshot every UI state.

Usage: python3 -I design/capture_states.py <out_dir> [base_url] [width] [height]
Needs the dashboard running (scripted agent mode) on base_url.
"""
import asyncio
import glob
import os
import sys

from playwright.async_api import async_playwright

OUT = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4620/"
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1440
H = int(sys.argv[4]) if len(sys.argv) > 4 else 900


def chromium_path():
    hits = sorted(glob.glob(os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell")))
    return hits[-1] if hits else None


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=chromium_path())
        page = await browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))

        async def shot(name, scroll=None):
            if scroll is not None:
                await page.evaluate(f"document.querySelector('main').scrollTop = {scroll}")
                await page.wait_for_timeout(250)
            await page.screenshot(path=os.path.join(OUT, f"{name}.png"))

        async def key(k, wait_ms):
            await page.keyboard.press(k)
            await page.wait_for_timeout(wait_ms)

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(800)
        await shot("01-idle")

        await page.mouse.click(W // 2, H // 2)
        await key("1", 1300)
        await shot("02-request-arrives")
        await page.wait_for_timeout(2600)
        await shot("03-lookup-and-policy")
        await page.wait_for_timeout(5500)
        # Where auto-scroll leaves the page on its own, as a recording would show it.
        await shot("04a-waiting-natural-scroll")
        await shot("04-waiting-on-manager", scroll=0)
        await shot("05-waiting-card", scroll=9999)

        await page.get_by_role("button", name="Edit Nightly rate").click()
        await page.wait_for_timeout(200)
        await shot("06a-editing-rate", scroll=None)
        await page.keyboard.type("295")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(500)
        await shot("06b-edit-syncing")
        await page.wait_for_timeout(2500)
        await shot("06c-edit-synced-top", scroll=0)
        await shot("06d-edit-synced-bottom", scroll=9999)

        await page.mouse.click(W // 2, 20)
        await key("2", 4500)
        await shot("07-approved-top", scroll=0)
        await shot("07b-approved-bottom", scroll=9999)

        await key("3", 1800)
        await shot("08-learned-announced")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        await page.get_by_role("button", name="1 learned rule").click()
        await page.wait_for_timeout(400)
        await shot("09-learned-popover")
        await page.keyboard.press("Escape")

        await page.mouse.click(W // 2, 20)
        await key("4", 9500)
        await shot("10-auto-approved-top", scroll=0)
        await shot("10b-auto-approved-bottom", scroll=9999)

        await shot("10c-tool-args-closed", scroll=0)
        await page.get_by_role("button", name="check_policy").first.click()
        await page.wait_for_timeout(400)
        await shot("10d-tool-args-open")

        await page.get_by_text("Edinburgh · Team offsite").click()
        await page.wait_for_timeout(600)
        await shot("11-history-rejected", scroll=0)

        await page.keyboard.press("d")
        await page.wait_for_timeout(400)
        await shot("12-demo-controls")

        await browser.close()
        with open(os.path.join(OUT, "errors.txt"), "w") as f:
            f.write("\n".join(errors) or "no console errors")
        print("captured to", OUT, "errors:", len(errors))


asyncio.run(main())
