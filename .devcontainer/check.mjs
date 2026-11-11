import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { remotePolicy } from '../remote.mjs';
import { createRepositoryInspector } from '../repository.mjs';

if(Number(process.versions.node.split('.')[0])!==24) throw new Error('Node 24 is required');
for(const binary of ['/usr/bin/git','/usr/bin/prlimit','/usr/bin/bwrap'])
  execFileSync(binary,['--version'],{stdio:'ignore'});
const policy=remotePolicy(process.env,Number(process.env.PORT||4317));
if(policy.kind!=='codespaces'||(process.env.AGENT_CREW_PROVIDER||'mock')!=='mock'||process.env.AGENT_CREW_ALLOW_PAID==='1')
  throw new Error('A Codespace and the deterministic provider are required');
const available=await createRepositoryInspector().status();
console.log(available?'Bubblewrap probe passed; repository tools may be enabled.':
  'Bubblewrap probe denied; repository execution remains disabled.');
console.log('Port 4317 must remain Private in the Codespaces Ports panel.');
if(process.argv.includes('--start')){
  const app=spawn(process.execPath,['server.mjs'],{stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.kill(signal));
  app.on('exit',code=>{process.exitCode=code??1;});
} else {
  console.log('Codespaces origin: '+policy.origin);
}
