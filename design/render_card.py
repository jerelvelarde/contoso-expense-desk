"""Render cards/approval-request.json with the Adaptive Cards SDK and screenshot it.

Usage: python3 -I design/render_card.py [all|name,name] [out_dir]
Names: approval, approval-edited, approval-decided, summary, summary-learned.
Writes teams-<name>-card.png into out_dir (default design/moodboard/refs).
Needs `npm --prefix design/tools install` once. Expands the template with
Microsoft's templating SDK (design/tools/expand-card.cjs), renders it with the
Adaptive Cards SDK, and screenshots it for the moodboard.
"""
import asyncio
import glob
import json
import os
import subprocess
import sys
import tempfile

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Named card states: (template, sample data). The film renders all of them.
APPROVAL_320 = {
    "requestId": "EXP-2037", "managerAadId": "jonas.lindqvist", "city": "London", "purpose": "AI Summit",
    "requesterName": "Amara Nwosu", "requesterFirstName": "Amara", "overBy": "£70", "dates": "4–7 Nov", "nights": 3,
    "nightlyRate": "£320", "total": "£960", "costCenter": "CC-410 Field Engineering", "ruleId": "HOTEL-LDN",
    "capPerNight": "£250", "updatedByFinance": False, "updatedFields": "",
}
PRESETS = {
    "approval": ("cards/approval-request.json", APPROVAL_320),
    "approval-edited": ("cards/approval-request.json", {**APPROVAL_320, "overBy": "£45", "nightlyRate": "£295", "total": "£885",
                        "updatedByFinance": True, "updatedFields": "nightly rate £320 → £295"}),
    "approval-decided": ("cards/approval-decided.json", {
        "outcomeLabel": "Approved", "outcomeColor": "good", "outcomeVerb": "approved", "city": "London", "purpose": "AI Summit",
        "requesterName": "Amara Nwosu", "requesterFirstName": "Amara", "dates": "4–7 Nov", "nights": 3,
        "nightlyRate": "£295", "total": "£885", "decidedBy": "Jonas Lindqvist", "decidedAt": "just now"}),
    "summary": ("cards/request-summary.json", {
        "city": "London", "purpose": "AI Summit", "statusLabel": "Waiting on Jonas", "statusColor": "warning",
        "dates": "4–7 Nov", "nights": 3, "nightlyRate": "£320", "total": "£960",
        "policySummary": "£70/night over the London cap (£250)", "learnedRuleId": "", "learnedRuleTitle": "",
        "nextStep": "I've sent this to Jonas Lindqvist to approve. I'll message you as soon as there's a decision.",
        "deskUrl": "https://expense-desk.contoso.example/requests/EXP-2037"}),
    "summary-learned": ("cards/request-summary.json", {
        "city": "London", "purpose": "AI Summit workshop", "statusLabel": "Approved", "statusColor": "good",
        "dates": "18–20 Nov", "nights": 2, "nightlyRate": "£335", "total": "£670",
        "policySummary": "Within the learned London limit (£350)", "learnedRuleId": "LR-01",
        "learnedRuleTitle": "London hotels are approved up to £350 a night.",
        "nextStep": "Managers have approved London hotels up to £350 a night, so I approved this one directly.",
        "deskUrl": "https://expense-desk.contoso.example/requests/EXP-2038"}),
}
NAMES = sys.argv[1].split(",") if len(sys.argv) > 1 and sys.argv[1] != "all" else list(PRESETS)
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "design/moodboard/refs")

HOST_CONFIG = {
    "fontFamily": "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    "fontSizes": {"small": 12, "default": 14, "medium": 16, "large": 20, "extraLarge": 24},
    "fontWeights": {"lighter": 300, "default": 400, "bolder": 600},
    "spacing": {"small": 4, "default": 8, "medium": 12, "large": 16, "extraLarge": 24, "padding": 16},
    "containerStyles": {
        "default": {"backgroundColor": "#FFFFFF", "foregroundColors": {
            "default": {"default": "#242424", "subtle": "#616161"},
            "accent": {"default": "#5B5FC7", "subtle": "#5B5FC7"},
            "good": {"default": "#237B4B", "subtle": "#237B4B"},
            "attention": {"default": "#C4314B", "subtle": "#C4314B"},
            "warning": {"default": "#835C00", "subtle": "#835C00"}}},
    },
    "actions": {"actionsOrientation": "horizontal", "buttonSpacing": 8, "showCard": {"actionMode": "inline"}},
    "factSet": {"title": {"weight": "bolder", "size": "default", "maxWidth": 120}, "value": {"size": "default"}, "spacing": 12},
}

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/adaptivecards@3.0.6/dist/adaptivecards.min.js"></script>
<style>
  body { margin: 0; padding: 32px; background: #f5f5f5; }
  #frame { width: 460px; border: 1px solid #e1dfdd; border-radius: 8px; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.08); overflow: hidden; }
  .ac-pushButton { font: 600 14px 'Segoe UI', -apple-system, sans-serif; height: 32px; padding: 0 16px; border-radius: 4px;
    border: 1px solid #d1d1d1; background: #fff; color: #242424; cursor: pointer; flex: 0 0 auto !important; }
  .ac-pushButton.style-positive { background: #5B5FC7; border-color: #5B5FC7; color: #fff; }
  .ac-actionSet { justify-content: flex-start !important; }
</style></head><body><div id="frame"></div></body></html>"""


def chromium_path():
    hits = sorted(glob.glob(os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell")))
    return hits[-1] if hits else None


def expand_template(template, data):
    with tempfile.TemporaryDirectory() as tmp:
        data_path = os.path.join(tmp, "data.json")
        out_path = os.path.join(tmp, "card.json")
        with open(data_path, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        subprocess.run(
            ["node", os.path.join(ROOT, "design/tools/expand-card.cjs"),
             os.path.join(ROOT, template), data_path, out_path],
            check=True,
        )
        with open(out_path) as f:
            return json.load(f)


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=chromium_path())
        for name in NAMES:
            template, data = PRESETS[name]
            card_json = expand_template(template, data)
            page = await browser.new_page(device_scale_factor=2)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_content(PAGE, wait_until="networkidle")
            result = await page.evaluate(
                """([expanded, hostConfig]) => {
                  const card = new AdaptiveCards.AdaptiveCard();
                  card.hostConfig = new AdaptiveCards.HostConfig(hostConfig);
                  const ctx = new AdaptiveCards.SerializationContext();
                  card.parse(expanded, ctx);
                  const el = card.render();
                  document.getElementById('frame').appendChild(el);
                  return Array.from({length: ctx.eventCount}, (_, i) => ctx.getEventAt(i).message);
                }""",
                [card_json, HOST_CONFIG],
            )
            await page.wait_for_timeout(250)
            out = os.path.join(OUT_DIR, f"teams-{name}-card.png")
            await page.locator("#frame").screenshot(path=out)
            await page.close()
            print(f"{name}: {out} · parse warnings: {result or 'none'} · page errors: {errors or 'none'}")
        await browser.close()


asyncio.run(main())
