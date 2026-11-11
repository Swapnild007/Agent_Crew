"""Exercise the HTTPS trust boundary with a touch/mobile Chromium profile."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import ssl
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HOST = 'agent-crew.qa.ts.net'
OWNER = 'owner@example.invalid'
PASSWORD = secrets.token_hex(24)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class TailnetProxy(BaseHTTPRequestHandler):
    """Test equivalent of Serve's HTTPS and header contract, with no external tailnet."""
    protocol_version = 'HTTP/1.1'

    def forward(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        headers = {
            key: self.headers[key] for key in ['Origin', 'Cookie', 'Content-Type', 'X-Crew-Request', 'Last-Event-ID']
            if key in self.headers
        }
        headers.update({'Host': self.headers['Host'], 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': self.headers['Host']})
        if self.server.login:
            headers['Tailscale-User-Login'] = self.server.login
        upstream = http.client.HTTPConnection('127.0.0.1', self.server.backend, timeout=22)
        try:
            upstream.request(self.command, self.path, body=data, headers=headers)
            reply = upstream.getresponse()
            stream = reply.getheader('Content-Type') == 'text/event-stream'
            self.send_response(reply.status)
            for key, value in reply.getheaders():
                if key.lower() not in ('transfer-encoding', 'connection', 'server', 'date', 'content-length'):
                    self.send_header(key, value)
            if stream:
                self.send_header('Transfer-Encoding', 'chunked')
                self.end_headers()
                while chunk := reply.read1(16384):
                    self.wfile.write(f'{len(chunk):x}\r\n'.encode() + chunk + b'\r\n')
                    self.wfile.flush()
                self.wfile.write(b'0\r\n\r\n')
            else:
                content = reply.read()
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        finally:
            upstream.close()

    do_GET = do_POST = do_DELETE = forward

    def log_message(self, *_):
        pass


def request(port, path, method='GET', headers=None, data=None):
    connection = http.client.HTTPSConnection('127.0.0.1', port, context=ssl._create_unverified_context(), timeout=5)
    request_headers = {'Host': f'{HOST}:{port}', **(headers or {})}
    try:
        connection.request(method, path, body=data, headers=request_headers)
        reply = connection.getresponse()
        return reply.status, dict(reply.getheaders()), reply.read()
    finally:
        connection.close()


def sign_in(page, origin):
    page.goto(origin)
    expect(page.get_by_role('heading', name='Sign in')).to_be_visible()
    page.get_by_label('Owner password').fill(PASSWORD)
    page.get_by_role('button', name='Sign in').tap()
    expect(page.get_by_role('heading', name='Mission Control')).to_be_visible()
    expect(page.locator('#connection')).to_contain_text('Event stream connected')


def navigate(page, name):
    page.get_by_role('link', name=name, exact=True).tap()
    expect(page.get_by_role('heading', name=name, exact=True)).to_be_visible()


def sample(page, objective):
    page.get_by_label('Review objective').fill(objective)
    page.get_by_role('button', name='Start sample review').tap()
    navigate(page, 'Approval Center')
    return page.locator('section').filter(has=page.get_by_role('heading', name=objective, exact=True))


with tempfile.TemporaryDirectory() as directory:
    temp = Path(directory)
    server = ThreadingHTTPServer(('127.0.0.1', 0), TailnetProxy)
    server.login = OWNER
    server.backend = free_port()
    origin = f'https://{HOST}:{server.server_port}'
    env = dict(os.environ, AGENT_CREW_DATA=str(temp / 'data'), PORT=str(server.backend),
               AGENT_CREW_PROVIDER='mock', AGENT_CREW_PUBLIC_ORIGIN=origin, AGENT_CREW_TAILSCALE_OWNER=OWNER)
    subprocess.run(['openssl', 'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1',
                    '-subj', f'/CN={HOST}', '-addext', f'subjectAltName=DNS:{HOST}',
                    '-keyout', str(temp / 'key.pem'), '-out', str(temp / 'cert.pem')],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(temp / 'cert.pem', temp / 'key.pem')
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    Thread(target=server.serve_forever, daemon=True).start()
    subprocess.run(['node', 'server.mjs', 'bootstrap'], cwd=ROOT, env=env, input=PASSWORD, text=True, check=True)
    repository = os.environ.get('AGENT_CREW_REQUIRE_SANDBOX') == '1'
    if repository:
        git_dir = subprocess.check_output(['git', 'rev-parse', '--absolute-git-dir'], cwd=ROOT, text=True).strip()
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        subprocess.run(['node', 'server.mjs', 'repository', 'add', 'agent-crew', git_dir, sha],
                       cwd=ROOT, env=env, check=True)
    app = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env)
    try:
        for _ in range(150):
            try:
                direct = http.client.HTTPConnection('127.0.0.1', server.backend, timeout=.5)
                direct.request('GET', '/api/v1/workspace')
                assert direct.getresponse().status == 403
                direct.close()
                break
            except OSError:
                time.sleep(.05)
        else:
            raise AssertionError('Remote-mode server did not start')
        with sync_playwright() as playwright:
            chromium = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'), args=[
                f'--host-resolver-rules=MAP {HOST} 127.0.0.1', '--no-proxy-server'])
            profile = {**playwright.devices['Pixel 7'], 'ignore_https_errors': True, 'accept_downloads': True}
            phone = chromium.new_context(**profile)
            page = phone.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin)
            assert page.evaluate('navigator.maxTouchPoints > 0 && window.isSecureContext')
            for path in ['/workspace', '/events', '/missions/12345678-1234-1234-1234-123456789abc/artifact']:
                assert request(server.server_port, '/api/v1' + path)[0] == 401
            assert json.loads(request(server.server_port, '/manifest.webmanifest')[2])['display'] == 'standalone'
            old_session = secrets.token_hex(32)
            with sqlite3.connect(temp / 'data' / 'crew.sqlite', timeout=5) as database:
                database.execute("INSERT INTO sessions(hash,expires,scope) VALUES(?,?,'local')",
                                 (hashlib.sha256(old_session.encode()).hexdigest(), int(time.time() * 1000) + 60000))
            assert request(server.server_port, '/api/v1/workspace',
                           headers={'Cookie': '__Host-crew_session=' + old_session})[0] == 401

            sign_in(page, origin)
            session = next(item for item in phone.cookies() if item['name'] == '__Host-crew_session')
            assert session['secure'] and session['httpOnly'] and session['sameSite'] == 'Strict' and session['path'] == '/'
            assert request(server.server_port, '/')[1]['Strict-Transport-Security'].startswith('max-age=')
            auth = {'Cookie': session['name'] + '=' + session['value']}
            server.login = 'nonowner@example.invalid'
            assert request(server.server_port, '/api/v1/workspace', headers={**auth, 'Tailscale-User-Login': OWNER})[0] == 403
            server.login = None
            assert request(server.server_port, '/api/v1/events', headers=auth)[0] == 403
            server.login = OWNER
            assert request(server.server_port, '/api/v1/missions', method='POST', headers={
                **auth, 'Origin': 'https://wrong.invalid', 'X-Crew-Request': '1', 'Content-Type': 'application/json'
            }, data=json.dumps({'objective': 'Unauthorized write'}))[0] == 403

            rejected = sample(page, 'Reject the sample review')
            rejected.get_by_role('button', name='Deny').tap(timeout=15000)
            expect(rejected.get_by_text('deny', exact=True)).to_be_visible()
            navigate(page, 'Mission Control')
            if repository:
                page.get_by_label('Review objective').fill('Inspect README.md and documentation')
                page.get_by_label('Approved repository').select_option('agent-crew')
                page.get_by_role('button', name='Start repository investigation').tap()
                navigate(page, 'Approval Center')
                page.get_by_role('button', name='Approve inspection').tap()
            else:
                sample(page, 'Inspect the sample receipt').get_by_role('button', name='Approve verification').tap()
            navigate(page, 'Execution Terminal')
            expect(page.locator('summary').filter(has_text='tool invoked').first).to_be_visible()
            phone.set_offline(True)
            expect(page.locator('#connection')).to_have_text('Offline')
            phone.set_offline(False)
            expect(page.locator('#connection')).to_contain_text('Event stream connected', timeout=15000)
            navigate(page, 'Mission Canvas')
            expect(page.get_by_text('evidence verified' if repository else 'verified defect', exact=True)).to_be_visible(timeout=45000)
            assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
            assert page.locator('nav a').first.evaluate('(link) => link.getBoundingClientRect().height >= 44')
            shots = os.environ.get('AGENT_CREW_SCREENSHOTS')
            if shots:
                Path(shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(shots) / 'android-mission.png'))
            navigate(page, 'Artifact Workspace')
            page.get_by_role('button', name='Inspect evidence').tap()
            expected = 'README.md' if repository else '"actual": 700'
            expect(page.get_by_text(expected, exact=False)).to_be_visible()
            with page.expect_download() as download:
                page.get_by_role('button', name='Download JSON').tap()
            result = json.loads(download.value.path().read_text())
            assert len(result['hash']) == 64
            if shots:
                page.screenshot(path=str(Path(shots) / 'android-evidence.png'))

            # Expire the active session in the test database without changing production TTL.
            with sqlite3.connect(temp / 'data' / 'crew.sqlite', timeout=5) as database:
                database.execute('UPDATE sessions SET expires=0')
            expect(page.get_by_role('heading', name='Sign in')).to_be_visible(timeout=15000)
            expect(page.get_by_text('Your session ended. Sign in again.')).to_be_visible()
            sign_in(page, origin)
            second = chromium.new_context(**profile).new_page()
            sign_in(second, origin)
            navigate(page, 'System Settings')
            page.get_by_label('Confirm owner password').fill(PASSWORD)
            page.get_by_role('button', name='Revoke all sessions').tap()
            expect(second.get_by_role('heading', name='Sign in')).to_be_visible(timeout=15000)
            sign_in(page, origin)
            navigate(page, 'System Settings')
            page.get_by_role('button', name='Sign out').tap()
            expect(page.get_by_role('heading', name='Sign in')).to_be_visible()
            assert request(server.server_port, '/api/v1/workspace')[0] == 401
            for expected_status in [401, 401, 401, 401, 401, 429]:
                assert request(server.server_port, '/api/v1/login', method='POST', headers={
                    'Origin': origin, 'X-Crew-Request': '1', 'Content-Type': 'application/json'
                }, data=json.dumps({'password': PASSWORD[1:]}))[0] == expected_status
            assert not errors, errors
            chromium.close()
            print('Private HTTPS mobile Chromium workflow passed, including offline recovery, expiry, revocation and download')
    finally:
        app.terminate()
        app.wait(timeout=10)
        server.shutdown()
        server.server_close()
