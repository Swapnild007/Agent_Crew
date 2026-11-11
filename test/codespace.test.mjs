import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';

test('Codespaces image configuration forwards only the application port without elevated privileges',()=>{
  const config=JSON.parse(readFileSync(new URL('../.devcontainer/devcontainer.json',import.meta.url),'utf8'));
  assert.deepEqual(config.forwardPorts,[4317]);
  assert.equal(config.otherPortsAttributes.onAutoForward,'ignore');
  assert.equal(config.remoteUser,'node');
  assert.equal(config.privileged,undefined);
  assert.equal(config.capAdd,undefined);
  assert.equal(config.remoteEnv.AGENT_CREW_PROVIDER,'mock');
  assert.equal(config.runArgs,undefined);
});

test('Codespaces mode independently checks the app session and preserves an in-flight mission across restart', {timeout:30000}, async t=>{
  const data=mkdtempSync(join(tmpdir(),'crew-codespace-'));
  const port=4317, host='agent-crew-test-4317.app.github.dev', origin='https://'+host;
  const input=randomBytes(24).toString('hex');
  const env={...process.env,PORT:String(port),AGENT_CREW_DATA:data,AGENT_CREW_PROVIDER:'mock',
    CODESPACES:'true',CODESPACE_NAME:'agent-crew-test',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'};
  delete env.AGENT_CREW_PUBLIC_ORIGIN;
  delete env.AGENT_CREW_TAILSCALE_OWNER;
  delete env.AGENT_CREW_ALLOW_PAID;
  let child;
  async function stop(signal) {
    if(child&&child.exitCode===null&&child.signalCode===null) {
      const exited=once(child,'exit');
      child.kill(signal);
      await exited;
    }
  }
  t.after(async()=>{await stop('SIGTERM'); rmSync(data,{recursive:true,force:true});});
  assert.equal(spawnSync(process.execPath,['server.mjs','bootstrap'],{env,input}).status,0);
  assert.notEqual(spawnSync(process.execPath,['server.mjs'],{env:{...env,AGENT_CREW_PROVIDER:'cloudflare'},timeout:5000}).status,0);
  function send(path,method='GET',payload,extra={}) {
    const encoded=payload===undefined?null:JSON.stringify(payload);
    return new Promise((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port,path,method,
        headers:{Host:host,Origin:origin,'X-Crew-Request':'1','Content-Type':'application/json',
          ...(encoded?{'Content-Length':Buffer.byteLength(encoded)}:{}),...extra}},res=>{
        let body='';
        res.on('data',chunk=>body+=chunk);
        res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:res.headers['content-type']?.includes('json')?JSON.parse(body):body}));
      });
      req.on('error',reject);
      req.end(encoded);
    });
  }
  async function start() {
    child=spawn(process.execPath,['server.mjs'],{env,stdio:'ignore'});
    for(let i=0;i<100;i++){
      if(child.exitCode!==null) throw Error('Codespaces server stopped during startup');
      try { if((await send('/')).status===200) return; } catch {}
      await wait(40);
    }
    throw Error('Codespaces server did not start');
  }
  await start();
  assert.equal((await send('/api/v1/workspace')).status,401);
  assert.equal((await send('/api/v1/events')).status,401);
  assert.equal((await send('/api/v1/workspace','GET',undefined,{Host:'127.0.0.1:4317'})).status,403);
  const login=await send('/api/v1/login','POST',{password:input});
  assert.equal(login.status,200);
  const issued=login.headers['set-cookie'][0];
  assert.match(issued,/^__Host-crew_session=/);
  assert.match(issued,/; Secure/);
  const signed={Cookie:issued.split(';')[0]};
  const workspace=await send('/api/v1/workspace','GET',undefined,signed);
  assert.equal(workspace.body.accessMode,'codespaces');
  const repo=await send('/api/v1/missions','POST',{objective:'Check README',repository:'unknown'},signed);
  assert.equal(repo.status,workspace.body.sandboxAvailable?403:503);
  assert.equal((await send('/api/v1/missions','POST',{objective:'wrong origin'},{...signed,Origin:'https://example.invalid'})).status,403);
  const mission=(await send('/api/v1/missions','POST',{objective:'Persistent receipt mission'},signed)).body;
  await stop('SIGKILL');
  await start();
  const path='/api/v1/missions/'+mission.id;
  for(let i=0;i<120;i++){
    if((await send(path,'GET',undefined,signed)).body.state==='awaiting_approval') break;
    await wait(70);
  }
  assert.equal((await send(path+'/approve','POST',undefined,signed)).status,200);
  for(let i=0;i<100;i++){
    if((await send(path,'GET',undefined,signed)).body.state==='completed') break;
    await wait(60);
  }
  assert.equal((await send(path+'/artifact','GET',undefined,signed)).body.body.outcome,'verified_defect');
  assert.equal((await send(path+'/artifact')).status,401);
  assert.equal((await send('/api/v1/logout','POST',undefined,signed)).status,200);
  assert.equal((await send('/api/v1/workspace','GET',undefined,signed)).status,401);
});
