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
REPOSITORY_TEST = os.environ.get('AGENT_CREW_REQUIRE_SANDBOX') == '1'


def wait_for_server():
    for _ in range(180):
        try:
            with urlopen(ORIGIN, timeout=1):
                return
        except OSError:
            time.sleep(.05)
    raise RuntimeError('Agent_Crew did not start')


with tempfile.TemporaryDirectory() as data:
    env = dict(os.environ, AGENT_CREW_DATA=data, PORT='4338', AGENT_CREW_PROVIDER='mock')
    subprocess.run(['node', 'server.mjs', 'bootstrap'], cwd=ROOT, env=env, input=PASSWORD, text=True, check=True)
    if REPOSITORY_TEST:
        git_dir = subprocess.check_output(['git', 'rev-parse', '--absolute-git-dir'], cwd=ROOT, text=True).strip()
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        subprocess.run(['node', 'server.mjs', 'repository', 'add', 'agent-crew', git_dir, revision], cwd=ROOT, env=env, check=True)
    server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env)
    try:
        wait_for_server()
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
            if REPOSITORY_TEST:
                page.set_viewport_size({'width': 1366, 'height': 880})
                page.get_by_role('link', name='Agent Studio').click()
                coordinator = page.locator('section').filter(has=page.get_by_role('heading', name='Coordinator', exact=True))
                coordinator.get_by_label('Role guidance').fill('Document findings from the approved commit.')
                coordinator.get_by_label('Confirm owner password').fill(PASSWORD)
                coordinator.get_by_role('button', name='Save agent settings').click()
                expect(coordinator.get_by_label('Confirm owner password')).to_have_value('')
                page.get_by_role('link', name='Skill Forge').click()
                page.get_by_role('button', name='Test permission').click()
                expect(page.get_by_role('status')).to_contain_text('Permission check passed')
                page.get_by_role('link', name='Mission Control').click()
                objective = 'Inspect README.md and documentation for the setup procedure'
                page.get_by_label('Review objective').fill(objective)
                page.get_by_label('Approved repository').select_option('agent-crew')
                page.get_by_role('button', name='Start repository investigation').click()
                page.get_by_role('link', name='Approval Center').click()
                inspect = page.get_by_role('button', name='Approve inspection')
                expect(inspect).to_be_visible()
                before = page.request.get(ORIGIN + '/api/v1/workspace').json()
                mission = next(item for item in before['missions'] if item['objective'] == objective)
                api_mission = ORIGIN + '/api/v1/missions/' + mission['id']
                assert mission['state'] == 'awaiting_approval'
                assert page.request.get(api_mission + '/graph').json()['nodes'] == []
                inspect.click()
                for _ in range(250):
                    graph = page.request.get(api_mission + '/graph').json()['nodes']
                    if len(graph) == 4:
                        assert any(node['state'] != 'done' for node in graph)
                        break
                    time.sleep(.04)
                else:
                    raise AssertionError('Dynamic graph was not persisted')
                server.kill()
                server.wait(timeout=10)
                server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env)
                wait_for_server()
                page.get_by_role('link', name='Mission Control').click()
                page.locator('section').filter(has_text=objective).get_by_role('button', name='Inspect').click()
                expect(page.get_by_text('evidence verified', exact=True)).to_be_visible(timeout=45000)
                graph_view = page.get_by_label('Mission dependency graph')
                expect(graph_view).to_be_visible()
                expect(graph_view.get_by_text('Verification', exact=True)).to_be_visible()
                graph_view.locator('summary').last.click()
                expect(graph_view.get_by_text('Depends on inventory, inspect, docs')).to_be_visible()
                expect(page.get_by_text('verification completed', exact=False).first).to_be_visible()
                result = page.request.get(api_mission + '/artifact').json()
                assert result['body']['revision'] == revision
                assert any(item['path'] == 'README.md' for item in result['body']['findings'])
                assert len(result['hash']) == 64
                events = page.request.get(ORIGIN + '/api/v1/workspace').json()['events']
                assert sum(item['mission'] == mission['id'] and item['kind'] == 'delegated' for item in events) == 1
                assert sum(item['mission'] == mission['id'] and item['kind'] == 'verification_completed' for item in events) == 1
                if shots:
                    page.screenshot(path=str(Path(shots) / 'repository-desktop.png'))
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
                if shots:
                    page.screenshot(path=str(Path(shots) / 'repository-mobile.png'))
                page.reload()
                expect(page.get_by_text('evidence verified', exact=True)).to_be_visible()
                print('Authorized Git repository workflow passed with deterministic provider and process restart')
            page.get_by_role('link', name='System Settings').click()
            page.get_by_role('button', name='Sign out').click()
            expect(page.get_by_role('heading', name='Sign in')).to_be_visible()
            assert not errors, errors
            browser.close()
            print('Chromium workflow passed at desktop and mobile widths')
    finally:
        if server.poll() is None:
            server.terminate()
            server.wait(timeout=10)
