from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2500)

    # The fixed dock sits at y=818, h=72 — clip it precisely
    page.screenshot(path='/tmp/dock_strip.png', clip={"x": 0, "y": 810, "width": 1440, "height": 90})
    print("Dock strip taken")

    # Dump the dock's full outer HTML so we can see styles + content
    html = page.evaluate("""() => {
        const all = Array.from(document.querySelectorAll('*'));
        const fixed = all.find(el => {
            const s = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return (s.position === 'fixed' || s.position === 'sticky') && r.height > 50;
        });
        return fixed ? fixed.outerHTML.slice(0, 3000) : 'not found';
    }""")
    print("DOCK HTML:", html[:3000])

    # Also move mouse over it and screenshot
    page.mouse.move(720, 854)
    page.wait_for_timeout(600)
    page.screenshot(path='/tmp/dock_strip_hover.png', clip={"x": 0, "y": 810, "width": 1440, "height": 90})
    print("Dock strip hover taken")

    # Full page with hover
    page.screenshot(path='/tmp/full_hover.png')
    print("Full hover taken")

    browser.close()
