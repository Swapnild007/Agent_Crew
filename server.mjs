import { createServer } from 'node:http';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRuntime, digest, plan } from './runtime.mjs';
import { createProvider } from './provider.mjs';
import { readCredential, storeCredential } from './credentials.mjs';
import { createRepositoryInspector, identifier, redact } from './repository.mjs';
import { capabilities, createInvestigation } from './investigation.mjs';

process.umask(0o077);
const data = resolve(process.env.AGENT_CREW_DATA || 'data');
mkdirSync(data,{recursive:true,mode:0o700});
const db = new DatabaseSync(resolve(data,'crew.sqlite'));
chmodSync(resolve(data,'crew.sqlite'),0o600);
db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
const versions = ['schema.sql','migrations/002.sql'];
db.exec('BEGIN IMMEDIATE');
try {
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>versions.length) throw new Error('Database version is newer than this service');
  for(const migration of versions.slice(version))
    db.exec(readFileSync(new URL('./'+migration,import.meta.url),'utf8'));
  db.exec('COMMIT');
} catch(error) {
  db.exec('ROLLBACK');
  throw error;
}
const runtime = createRuntime(db,{repositoryMissions:true});
const owner = () => db.prepare('SELECT * FROM owner WHERE id=1').get();
const revoke = () => db.exec('DELETE FROM sessions');
const audit = (kind, detail) => runtime.event(null,kind,detail);
const passwordHash = (password,salt) => scryptSync(password,salt,64);
const verify = (input,record) => typeof input === 'string' && input.length <= 256 &&
  timingSafeEqual(passwordHash(input,record.salt),Buffer.from(record.hash,'hex'));

if (['bootstrap','rotate'].includes(process.argv[2])) {
  const rotate = process.argv[2] === 'rotate';
  const password = readFileSync(0,'utf8').replace(/\r?\n$/,'');
  if (password.length < 16 || password.length > 256) throw new Error('Use a password of 16–256 characters.');
  runtime.transaction(() => {
    if (Boolean(owner()) !== rotate) throw new Error(rotate ? 'Bootstrap the owner first.' : 'Owner already exists.');
    const salt = randomBytes(32).toString('hex');
    db.prepare('INSERT OR REPLACE INTO owner VALUES(1,?,?)').run(salt,passwordHash(password,salt).toString('hex'));
    revoke();
    db.exec('DELETE FROM auth_limit; DELETE FROM reauth_limit');
    audit(rotate ? 'owner_rotated' : 'owner_bootstrapped','Local owner command');
  });
  db.close();
  console.log(rotate ? 'Owner password rotated and sessions revoked.' : 'Owner account created.');
  process.exit(0);
}
if (!owner()) throw new Error('Bootstrap the owner account before startup.');
if(process.argv[2]==='store-openai-credential'){
  storeCredential(data,process.env.AGENT_CREW_SECRET_KEY,readFileSync(0,'utf8').replace(/\r?\n$/,''));
  audit('credential_rotated','Encrypted OpenAI credential stored through local owner command');
  db.close();
  console.log('Encrypted OpenAI credential stored.');
  process.exit(0);
}
const configuredKey=process.env.AGENT_CREW_PROVIDER==='openai'&&!process.env.AGENT_CREW_OPENAI_KEY
  ? readCredential(data,process.env.AGENT_CREW_SECRET_KEY) : undefined;
const provider=createProvider({env:{...process.env,AGENT_CREW_OPENAI_KEY:process.env.AGENT_CREW_OPENAI_KEY||configuredKey}});
const inspector=createRepositoryInspector();
const investigation=createInvestigation(db,runtime,provider,inspector);
if(process.argv[2]==='repository'){
  const [action,name,path,revision]=process.argv.slice(3);
  try {
    if(action==='add'&&name&&path&&revision){
      const repo=await inspector.authorize(name,path,revision);
      runtime.transaction(()=>{
        db.prepare('INSERT INTO repositories VALUES(?,?,?,?,?)').run(repo.name,repo.git_dir,repo.revision,repo.device,repo.inode);
        audit('repository_authorized',repo.name+' · '+repo.revision);
      });
      console.log('Authorized '+name+' at '+revision);
    } else if(action==='remove'&&identifier.test(name||'')){
      if(!investigation.remove(name)) throw Error('Repository is not authorized');
      console.log('Revoked '+name);
    } else {
      throw Error('Use repository add NAME GIT_DIRECTORY COMMIT_SHA or repository remove NAME');
    }
  } catch(error) {
    console.error(error.code==='ERR_SQLITE_ERROR'?'Repository could not be saved':error.message);
    process.exitCode=1;
  }
  db.close();
  process.exit(process.exitCode||0);
}
const sandboxAvailable=await inspector.status();
const serializeMission=({lease,lease_until,plan_attempts,...publicFields})=>publicFields;
const port = Number(process.env.PORT || 4317);
const origin = 'http://127.0.0.1:'+port;
const cookie = 'crew_session';
const json = (res,status,value) => {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
};
const issue = (status,message) => Object.assign(new Error(message),{status});
function reauthenticate(password) {
  const now=Date.now();
  const limit=db.prepare('SELECT * FROM reauth_limit WHERE id=1').get();
  const attempts=limit?.until>now?limit.attempts:0;
  if(attempts>=5) throw issue(429,'Too many owner verification attempts');
  if(!verify(password,owner())){
    db.prepare('INSERT OR REPLACE INTO reauth_limit VALUES(1,?,?)').run(attempts+1,attempts?limit.until:now+300000);
    audit('reauth_denied','Invalid owner credentials');
    throw issue(403,'Incorrect owner password');
  }
  db.exec('DELETE FROM reauth_limit');
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw issue(415,'JSON required');
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) {
      req.resume();
      throw issue(413,'Request too large');
    }
    parts.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(parts));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch { throw issue(400,'Invalid JSON object'); }
}
function field(value,max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw issue(400,'Invalid text');
  return value.trim();
}
function session(req) {
  const token = (req.headers.cookie || '').split(';').map(item=>item.trim()).find(item=>item.startsWith(cookie+'='))?.slice(cookie.length+1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = digest(token);
  return db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash,Date.now())?.hash;
}
const staticFiles = new Map([
  ['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']]
].map(([route,[name,type]])=>[route,[readFileSync(new URL('./public/'+name,import.meta.url)),type]]));
const api = '/api/v1';
const streamCounts = new Map();
const recentEvents = db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT 150');
function stream(req,res,url) {
  let cursor = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw issue(400,'Invalid event cursor');
  const identity=session(req);
  const count=streamCounts.get(identity)||0;
  if(count>=4 || [...streamCounts.values()].reduce((a,b)=>a+b,0)>=24) throw issue(429,'Too many event subscriptions');
  streamCounts.set(identity,count+1);
  res.writeHead(200,{'Content-Type':'text/event-stream','X-Accel-Buffering':'no'});
  res.write(': connected\n\n');
  const timer = setInterval(()=>{
    if (!session(req) || res.writableLength > 512000) return res.end();
    for (const item of recentEvents.all(cursor)) {
      res.write('id: '+item.id+'\ndata: '+JSON.stringify(item)+'\n\n');
      cursor = item.id;
    }
  },500);
  res.on('close',()=>{
    clearInterval(timer);
    const remaining=streamCounts.get(identity)-1;
    if(remaining) streamCounts.set(identity,remaining);
    else streamCounts.delete(identity);
  });
}
async function route(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (req.headers.host !== '127.0.0.1:'+port) throw issue(403,'Invalid host');
  const url = new URL(req.url,origin);
  const path = url.pathname;
  const method = req.method;
  if (method === 'GET' && staticFiles.has(path)) {
    const [file,type] = staticFiles.get(path);
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});
    return res.end(file);
  }
  if (method !== 'GET' && (req.headers.origin !== origin || req.headers['x-crew-request'] !== '1')) throw issue(403,'Invalid request origin');
  if (path === api+'/login' && method === 'POST') {
    const {password} = await body(req);
    const now = Date.now();
    const limit = db.prepare('SELECT * FROM auth_limit WHERE id=1').get();
    const attempts = limit?.until > now ? limit.attempts : 0;
    if (attempts >= 5) throw issue(429,'Too many attempts. Try again in five minutes.');
    if (!verify(password,owner())) {
      db.prepare('INSERT OR REPLACE INTO auth_limit VALUES(1,?,?)').run(attempts+1,attempts ? limit.until : now+300000);
      audit('login_denied','Invalid owner credentials');
      throw issue(401,'Invalid owner credentials');
    }
    const token = randomBytes(32).toString('hex');
    db.exec('DELETE FROM auth_limit');
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
    db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token),now+1800000);
    audit('login','Owner session issued');
    res.setHeader('Set-Cookie',cookie+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800');
    return json(res,200,{ok:true});
  }
  const identity = session(req);
  if (!identity) throw issue(401,'Owner authentication required');
  async function ownerBody() {
    const input = await body(req);
    if (!session(req)) throw issue(401,'Owner session expired');
    return input;
  }
  if (path === api+'/events' && method === 'GET') return stream(req,res,url);
  if (path === api+'/workspace' && method === 'GET') {
    return json(res,200,{
      missions:db.prepare('SELECT * FROM missions ORDER BY created DESC').all().map(serializeMission),
      repositories:db.prepare('SELECT name,revision FROM repositories ORDER BY name').all(),
      agents:investigation.agentConfig(),
      provider:provider.status,
      sandboxAvailable,
      graph:url.searchParams.get('graph')?investigation.publicNodes(url.searchParams.get('graph')):[],
      events:db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 150').all(),
      artifacts:db.prepare('SELECT mission,hash FROM artifacts').all(),
      notes:db.prepare('SELECT * FROM notes ORDER BY created DESC').all(),
      skills:db.prepare('SELECT * FROM skills ORDER BY name,version DESC').all(),
      paused:Boolean(db.prepare('SELECT paused FROM settings WHERE id=1').get().paused),
      plan
    });
  }
  if (path === api+'/capabilities' && method === 'GET') return json(res,200,{plan,workflow:'bundled_receipt_review',agents:investigation.agentConfig(),workflows:['repository_investigation','bundled_receipt_review']});
  if (path === api+'/missions' && method === 'POST') {
    const input=await ownerBody();
    const objective=redact(field(input.objective,600));
    if(input.repository===undefined || input.repository==='') return json(res,201,serializeMission(runtime.create(objective)));
    const repository=field(input.repository,40);
    if(!identifier.test(repository)) throw issue(400,'Invalid repository name');
    if(!sandboxAvailable) throw issue(503,'Repository isolation unavailable');
    try { return json(res,201,serializeMission(investigation.create(objective,repository))); }
    catch(error) { throw issue(error.code==='repository_denied'?403:409,error.message); }
  }
  if (path === api+'/agents' && method==='POST') {
    const {role,enabled,guidance,password}=await ownerBody();
    if(!capabilities.some(item=>item.role===role)||typeof enabled!=='boolean'||typeof guidance!=='string'||guidance.length>500)
      throw issue(400,'Invalid agent configuration');
    reauthenticate(password);
    runtime.transaction(()=>{
      db.prepare('INSERT OR REPLACE INTO agent_settings VALUES(?,?,?)').run(role,Number(enabled),redact(guidance));
      audit('agent_configured',role+(enabled?' enabled':' disabled'));
    });
    return json(res,200,{ok:true});
  }
  const match = path.match(/^\/api\/v1\/missions\/([a-f0-9-]{36})(?:\/(approve|deny|cancel|artifact|graph))?$/);
  if (match) {
    const [,id,action] = match;
    const mission = runtime.get(id);
    if (!mission) throw issue(404,'Mission not found');
    if (!action && method === 'GET') return json(res,200,serializeMission(mission));
    if (action === 'graph' && method==='GET') return json(res,200,{nodes:investigation.publicNodes(id)});
    if (action === 'artifact' && method === 'GET') {
      const artifact = db.prepare('SELECT body,hash FROM artifacts WHERE mission=?').get(id);
      if (!artifact) throw issue(404,'Artifact not found');
      if (digest(artifact.body) !== artifact.hash) throw issue(500,'Artifact integrity check failed');
      return json(res,200,{...artifact,body:JSON.parse(artifact.body)});
    }
    if (['approve','deny','cancel'].includes(action) && method === 'POST') {
      const result = runtime.decide(id,action);
      if (!result) throw issue(409,'Action unavailable in current state');
      if(action==='cancel') investigation.abort(id);
      return json(res,200,serializeMission(result));
    }
  }
  if (path === api+'/notes' && method === 'POST') {
    const text = field((await ownerBody()).text,2000);
    db.prepare('INSERT INTO notes VALUES(?,?,?)').run(randomBytes(16).toString('hex'),text,Date.now());
    return json(res,201,{ok:true});
  }
  const note = path.match(/^\/api\/v1\/notes\/([a-f0-9]{32})$/);
  if (note && method === 'DELETE') {
    if (!db.prepare('DELETE FROM notes WHERE id=?').run(note[1]).changes) throw issue(404,'Note not found');
    return json(res,200,{ok:true});
  }
  if (path === api+'/skills' && method === 'POST') {
    const input = await ownerBody();
    const name = field(input.name,80);
    const skillTool=input.tool||'catalog_commit';
    if(!['catalog_commit','read_tracked_text','recheck_citations'].includes(skillTool)) throw issue(400,'Unknown read-only skill capability');
    const description = field(input.description,1000);
    runtime.transaction(()=>{
      const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 version FROM skills WHERE name=?').get(name).version;
      db.prepare('INSERT INTO skills(name,version,description,tool) VALUES(?,?,?,?)').run(name,version,description,skillTool);
      audit('skill_draft','Owner saved a skill draft');
    });
    return json(res,201,{ok:true});
  }
  if (path === api+'/skills/test' && method === 'POST') {
    const {name,version}=await ownerBody();
    if(typeof name!=='string'||!Number.isInteger(version)) throw issue(400,'Invalid skill version');
    const draft=db.prepare('SELECT * FROM skills WHERE name=? AND version=?').get(name,version);
    if(!draft) throw issue(404,'Skill draft not found');
    const grant=capabilities.find(item=>item.tool===draft.tool);
    if(!grant||grant.role==='Coordinator') throw issue(409,'Skill exceeds read-only policy');
    audit('skill_tested',grant.role+' · '+draft.tool+' · policy validation only');
    return json(res,200,{tool:draft.tool,role:grant.role,validated:true,execution:false});
  }
  if (path === api+'/settings' && method === 'POST') {
    const {paused,password} = await ownerBody();
    if (typeof paused !== 'boolean') throw issue(400,'Invalid pause state');
    reauthenticate(password);
    runtime.transaction(()=>{
      db.prepare('UPDATE settings SET paused=? WHERE id=1').run(Number(paused));
      audit(paused ? 'paused' : 'resumed','Owner changed dispatch state');
    });
    if(paused) investigation.abort();
    return json(res,200,{ok:true});
  }
  if (['/logout','/logout-all'].some(suffix=>path===api+suffix) && method==='POST') {
    if (path.endsWith('/logout-all')) {
      reauthenticate((await ownerBody()).password);
      revoke();
    } else db.prepare('DELETE FROM sessions WHERE hash=?').run(identity);
    audit('logout','Owner session revoked');
    res.setHeader('Set-Cookie',cookie+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res,200,{ok:true});
  }
  throw issue(404,'Route not found');
}
const server = createServer({requestTimeout:10000,headersTimeout:5000},(req,res)=>{
  route(req,res).catch(error=>{
    if (res.headersSent) return res.end();
    if (!error.status) console.error('Internal request failure',error.code || error.name);
    json(res,error.status||500,{error:error.status ? error.message : 'Internal request failure'});
  });
});
const timer = setInterval(()=>{
  try { runtime.tick(); } catch(error) { console.error('Dispatch failure',error.code||error.name); }
  if(sandboxAvailable) investigation.tick().catch(error=>console.error('Investigation dispatch failure',error.code||error.name));
},250);
server.listen(port,'127.0.0.1',()=>console.log('Agent_Crew listening at '+origin));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  clearInterval(timer);
  investigation.abort();
  server.closeAllConnections();
  server.close(()=>{ process.exitCode=0; });
});
