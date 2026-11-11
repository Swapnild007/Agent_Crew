"""Run with Python Playwright and Chromium installed."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'http://127.0.0.1:4338'
PASSWORD = 'browser fixture local test password'

with tempfile.TemporaryDirectory() as data:
    env = dict(os.environ, AGENT_CREW_DATA=data, PORT='4338')
    subprocess.run(['node', 'server.mjs', 'bootstrap'], cwd=ROOT, env=env, input=PASSWORD, text=True, check=True)
    server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env)
    try:
        for _ in range(100):
            try:
                with urlopen(ORIGIN, timeout=1):
                    break
            except OSError:
                time.sleep(.05)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'))
            page = browser.new_page(viewport={'width': 1366, 'height': 880})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(ORIGIN)
            expect(page.get_by_role('heading', name='Sign in')).to_be_visible()
            page.get_by_label('Owner password').fill(PASSWORD)
            page.get_by_role('button', name='Sign in').click()
            expect(page.get_by_role('heading', name='Mission Control')).to_be_visible()
            page.get_by_label('Review objective').fill('Check how receipt totals handle line quantities')
            page.get_by_role('button', name='Start sample review').click()
            page.get_by_role('link', name='Approval Center').click()
            approval = page.get_by_role('button', name='Approve verification')
            expect(approval).to_be_visible(timeout=10000)
            approval.click()
            page.get_by_role('link', name='Artifact Workspace').click()
            evidence = page.get_by_role('button', name='Inspect evidence')
            expect(evidence).to_be_visible(timeout=10000)
            evidence.click()
            expect(page.get_by_text('"actual": 700', exact=False)).to_be_visible()
            page.get_by_role('link', name='Memory Vault').click()
            page.get_by_label('New note').fill('Quantity mismatch verified')
            page.get_by_role('button', name='Save note').click()
            expect(page.get_by_text('Quantity mismatch verified')).to_be_visible()
            page.get_by_role('link', name='Skill Forge').click()
            page.get_by_label('Skill name').fill('Receipt review')
            page.get_by_label('Description').fill('Compare line totals against documented requirements.')
            page.get_by_role('button', name='Save draft version').click()
            expect(page.get_by_role('heading', name='Receipt review · v1')).to_be_visible()
            for name in ['Mission Control', 'Mission Canvas', 'Agent Studio', 'Execution Terminal',
                         'Memory Vault', 'Skill Forge', 'Approval Center', 'Artifact Workspace', 'System Settings']:
                page.get_by_role('link', name=name, exact=True).click()
                expect(page.get_by_role('heading', name=name, exact=True)).to_be_visible()
            page.get_by_role('link', name='Mission Canvas').click()
            expect(page.get_by_text('verified defect', exact=True)).to_be_visible()
            page.reload()
            expect(page.get_by_text('verified defect', exact=True)).to_be_visible()
            shots = os.environ.get('AGENT_CREW_SCREENSHOTS')
            if shots:
                Path(shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(shots) / 'desktop.png'))
            page.set_viewport_size({'width': 390, 'height': 844})
            expect(page.get_by_role('heading', name='Mission Canvas')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
            if shots:
                page.screenshot(path=str(Path(shots) / 'mobile.png'))
            page.get_by_role('link', name='System Settings').click()
            page.get_by_role('button', name='Sign out').click()
            expect(page.get_by_role('heading', name='Sign in')).to_be_visible()
            assert not errors, errors
            browser.close()
            print('Chromium workflow passed at desktop and mobile widths')
    finally:
        server.terminate()
        server.wait(timeout=10)
