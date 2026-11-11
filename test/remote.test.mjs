import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remotePolicy } from '../remote.mjs';

test('remote trust requires an exact tailnet hostname, owner and HTTPS loopback proxy',()=>{
  const origin='https://agent-crew.tailnet.ts.net';
  const env={AGENT_CREW_PUBLIC_ORIGIN:origin,AGENT_CREW_TAILSCALE_OWNER:'owner@example.invalid'};
  const policy=remotePolicy(env,4317);
  const request={socket:{remoteAddress:'127.0.0.1'},headers:{
    host:'127.0.0.1:4317','x-forwarded-host':'agent-crew.tailnet.ts.net',
    'x-forwarded-proto':'https','tailscale-user-login':'owner@example.invalid'
  }};
  assert.equal(policy.permit(request),true);
  assert.equal(policy.secure,true);
  assert.equal(policy.cookie,'__Host-crew_session');
  for(const [key,value] of Object.entries({
    'tailscale-user-login':'other@example.invalid','x-forwarded-host':'wrong.ts.net',
    'x-forwarded-proto':'http','tailscale-funnel-request':'?1',host:'unrelated.invalid'
  })) assert.equal(policy.permit({...request,headers:{...request.headers,[key]:value}}),false);
  assert.equal(policy.permit({...request,socket:{remoteAddress:'192.0.2.1'}}),false);
  assert.throws(()=>remotePolicy({...env,AGENT_CREW_PUBLIC_ORIGIN:'http://agent-crew.tailnet.ts.net'},4317));
  assert.throws(()=>remotePolicy({AGENT_CREW_PUBLIC_ORIGIN:origin},4317));
  assert.throws(()=>remotePolicy({...env,AGENT_CREW_PUBLIC_ORIGIN:origin+'/unexpected'},4317));
  const local=remotePolicy({},4317);
  assert.equal(local.permit(request),true);
  assert.equal(local.secure,false);
});

test('Codespaces origin is derived from platform settings and never grants an app session',()=>{
  const env={CODESPACES:'true',CODESPACE_NAME:'sample-qa',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'};
  const policy=remotePolicy(env,4317);
  assert.equal(policy.origin,'https://sample-qa-4317.app.github.dev');
  assert.equal(policy.cookie,'__Host-crew_session');
  const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'sample-qa-4317.app.github.dev'}};
  assert.equal(policy.permit(request),true);
  assert.equal(policy.permit({...request,headers:{host:'127.0.0.1:4317'}}),false);
  assert.equal(policy.permit({...request,headers:{host:'127.0.0.1:4317','x-forwarded-host':'sample-qa-4317.app.github.dev','x-forwarded-proto':'https'}}),true);
  assert.equal(policy.permit({...request,headers:{...request.headers,'x-forwarded-proto':'http'}}),false);
  assert.equal(policy.permit({...request,socket:{remoteAddress:'192.0.2.1'}}),false);
  assert.throws(()=>remotePolicy(env,9999));
  assert.throws(()=>remotePolicy({...env,GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'untrusted.example'},4317));
  assert.throws(()=>remotePolicy({...env,AGENT_CREW_PUBLIC_ORIGIN:'https://host.tailnet.ts.net'},4317));
});
