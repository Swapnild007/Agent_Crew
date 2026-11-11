import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

test('owner approval, crash recovery, event replay, artifact, cancellation and access control', {timeout:30000}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'crew-test-'));
  const port=4337;
  const origin='http://127.0.0.1:'+port;
  const env={...process.env,AGENT_CREW_DATA:dir,PORT:String(port)};
  const password=randomBytes(24).toString('hex');
  const bootstrap=spawnSync(process.execPath,['server.mjs','bootstrap'],{input:password,env});
  assert.equal(bootstrap.status,0,bootstrap.stderr.toString());
  assert.notEqual(spawnSync(process.execPath,['server.mjs','bootstrap'],{input:password,env}).status,0);
  let child;
  async function start() {
    child=spawn(process.execPath,['server.mjs'],{env,stdio:['ignore','pipe','inherit']});
    for (let i=0;i<100;i++) {
      if (child.exitCode!==null) throw Error('Server exited during startup');
      try { await fetch(origin); return; } catch { await sleep(30); }
    }
    throw Error('Server did not start');
  }
  async function stop(signal='SIGTERM') {
    if (child && child.exitCode===null && child.signalCode===null) {
      const exited=once(child,'exit');
      child.kill(signal);
      await exited;
    }
  }
  t.after(async()=>{await stop(); rmSync(dir,{recursive:true,force:true});});
  await start();
  let cookie='';
  async function request(path,method='GET',body,headers={}) {
    return fetch(origin+'/api/v1'+path,{
      method,headers:{origin,'x-crew-request':'1','content-type':'application/json',cookie,...headers},
      body:body===undefined?undefined:JSON.stringify(body)
    });
  }
  assert.equal((await request('/workspace')).status,401);
  assert.equal((await request('/events')).status,401);
  assert.equal((await request('/agents','POST',{role:'Research',enabled:false,guidance:''})).status,401);
  assert.equal((await request('/skills/test','POST',{name:'sample',version:1})).status,401);
  assert.equal((await request('/missions','POST',{objective:'a'})).status,401);
  assert.equal((await request('/login','POST',{password},{origin:'https://different.invalid'})).status,403);
  assert.equal((await request('/login','POST',{password:'incorrect'})).status,401);
  const login=await request('/login','POST',{password});
  assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');
  assert.match(setCookie,/HttpOnly; SameSite=Strict/);
  cookie=setCookie.split(';')[0];
  assert.equal((await request('/settings','POST',{password:'wrong',paused:true})).status,403);
  assert.equal((await request('/agents','POST',{role:'Research',enabled:false,guidance:'',password:'wrong'})).status,403);
  assert.equal((await request('/agents','POST',{role:'Shell',enabled:true,guidance:'',password})).status,400);
  assert.equal((await request('/skills','POST',{name:'restricted',description:'invalid',tool:'run_shell'})).status,400);
  const workspace=await (await request('/workspace')).json();
  assert.equal((await request('/missions','POST',{objective:'Read outside allowlist',repository:'unknown'})).status,
    workspace.sandboxAvailable?403:503);
  const objective='<img src=x onerror=alert(1)> inspect quantities';
  const mission=await (await request('/missions','POST',{objective})).json();
  const path='/missions/'+mission.id;
  assert.equal(mission.objective,objective);
  assert.equal((await request(path+'/approve','POST')).status,409);
  assert.equal((await request(path+'/artifact')).status,404);
  async function waitFor(predicate) {
    for(let i=0;i<160;i++){
      const state=await (await request(path)).json();
      if(predicate(state)) return state;
      await sleep(75);
    }
    throw Error('Mission state did not arrive');
  }
  await waitFor(m=>m.step===1);
  await stop('SIGKILL');
  await start();
  await waitFor(m=>m.state==='awaiting_approval');
  assert.equal((await request(path+'/approve','POST',undefined,{'x-crew-request':'0'})).status,403);
  assert.equal((await request(path+'/approve','POST')).status,200);
  assert.equal((await request(path+'/approve','POST')).status,409);
  const completed=await waitFor(m=>m.state==='completed');
  assert.equal(completed.outcome,'verified_defect');
  const report=await (await request(path+'/artifact')).json();
  assert.equal(report.body.cases[1].actual,700);
  assert.equal(report.body.cases[1].expected,1900);
  assert.match(report.hash,/^[a-f0-9]{64}$/);
  const state=await (await request('/workspace')).json();
  const calls=state.events.filter(e=>e.mission===mission.id&&e.kind==='tool_invoked');
  assert.equal(calls.length,4);
  assert.equal(new Set(calls.map(e=>e.detail)).size,4);
  const cursor=calls[1].id;
  const stream=await request('/events','GET',undefined,{'Last-Event-ID':String(cursor)});
  const reader=stream.body.getReader();
  let replay='';
  while (!replay.includes('id: ')) replay+=new TextDecoder().decode((await reader.read()).value);
  assert.ok(Number(replay.match(/id: (\d+)/)[1])>cursor);
  await reader.cancel();
  const cancelled=await (await request('/missions','POST',{objective:'Cancel this mission'})).json();
  assert.equal((await request('/missions/'+cancelled.id+'/cancel','POST')).status,200);
  assert.equal((await (await request('/missions/'+cancelled.id)).json()).state,'cancelled');
  assert.equal((await request('/logout-all','POST',{password})).status,200);
  assert.equal((await request('/workspace')).status,401);
});
