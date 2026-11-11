const screens = ['Mission Control','Mission Canvas','Agent Studio','Execution Terminal','Memory Vault','Skill Forge','Approval Center','Artifact Workspace','System Settings'];
const slug = name => name.toLowerCase().replaceAll(' ','-');
const main = document.querySelector('main');
const nav = document.querySelector('nav');
const indicator = document.querySelector('#connection');
const feedback = document.querySelector('#feedback');
let state, live, selected, filter = '', query = '', activeView, pendingRender = false;
let toastTimer, recoveryTimer, sessionEpoch=0;
const escape = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const label = value => value.replaceAll('_',' ');
const date = value => new Date(value).toLocaleString();
const title = (name,subtitle) => '<h1>'+name+'</h1><p class="lede">'+subtitle+'</p>';
const panel = content => '<section class="panel">'+content+'</section>';
const button = (text,action,id='',primary=false) => '<button type="button" data-action="'+action+'" data-id="'+id+'"'+(primary?' class="primary"':'')+'>'+text+'</button>';
const empty = text => '<p class="muted">'+text+'</p>';
const eventList = items => items.map(e=>'<details><summary>'+escape(label(e.kind))+' · <small>'+escape(date(e.created))+'</small></summary><pre>'+escape(e.detail)+'</pre></details>').join('') || empty('No matching events.');
async function api(path,method='GET',data) {
  const epoch=sessionEpoch;
  if(!navigator.onLine) throw Error('Offline. Reconnect to continue.');
  let result;
  try {
    result=await fetch('/api/v1'+path,{method,headers:{'X-Crew-Request':'1','Content-Type':'application/json'},
      body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)});
  } catch {
    throw Error('Connection unavailable. Reconnect and check the latest mission status.');
  }
  const payload = await result.json();
  if (result.status === 401 && path !== '/login' && epoch===sessionEpoch) showLogin(state?'Your session ended. Sign in again.':undefined);
  if (!result.ok) throw Error(payload.error);
  return payload;
}
function notify(message) {
  feedback.textContent = message;
  feedback.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>feedback.hidden=true,4500);
}
function showLogin(message='Open the Agent_Crew workspace with your owner password.') {
  sessionEpoch++;
  clearTimeout(recoveryTimer);
  live?.close();
  live = undefined;
  state = undefined;
  selected = undefined;
  activeView = undefined;
  nav.hidden = true;
  indicator.textContent = 'Owner access';
  main.innerHTML = title('Sign in',message)+
    panel('<form data-form="login"><label for="password">Owner password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="primary">Sign in</button></form>');
}
async function refresh(force=false) {
  const previousSelection=selected;
  const epoch=sessionEpoch;
  const next = await api('/workspace'+(selected?'?graph='+encodeURIComponent(selected):''));
  if(previousSelection!==selected||epoch!==sessionEpoch) return;
  if(!selected && next.missions[0]?.repository) {
    selected=next.missions[0].id;
    return refresh(force);
  }
  const previous = state;
  state = next;
  if (force || !previous || JSON.stringify(previous)!==JSON.stringify(next)) {
    if (force || !main.contains(document.activeElement)) render(force);
    else pendingRender = true;
  }
}
function connect() {
  if (!state||!navigator.onLine||live) return;
  const stream=new EventSource('/api/v1/events?after='+(state.events[0]?.id||0));
  live=stream;
  stream.onopen=()=>{
    indicator.textContent='● Event stream connected';
    refresh().catch(error=>notify(error.message));
  };
  stream.onmessage=()=>refresh().catch(error=>notify(error.message));
  stream.onerror=()=>{
    if(live!==stream) return;
    indicator.textContent=navigator.onLine?'Reconnecting':'Offline';
    if(stream.readyState===EventSource.CLOSED) live=undefined;
    if(navigator.onLine) scheduleRecovery();
  };
}
function scheduleRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer=setTimeout(()=>{
    if(state&&navigator.onLine) recover(false);
  },1800);
}
async function recover(force=true) {
  try {
    await refresh(force);
    connect();
    if(live?.readyState!==EventSource.OPEN) indicator.textContent='Reconnecting';
  } catch(error) {
    if(state) scheduleRecovery();
    else if(!main.querySelector('[data-form="login"]')){
      indicator.textContent=navigator.onLine?'Unavailable':'Offline';
      main.innerHTML=title('Workspace unavailable','Connect to your private network, then try again.')+
        panel(button('Retry connection','recover','',true));
    }
  }
}
window.addEventListener('offline',()=>{
  indicator.textContent='Offline';
  live?.close();
  live=undefined;
  clearTimeout(recoveryTimer);
});
window.addEventListener('online',()=>{
  indicator.textContent='Reconnecting';
  recover(false);
});
const missionRows = missions => missions.map(m=>panel('<div class="row"><div><strong>'+escape(m.objective)+'</strong><p class="status">'+escape(label(m.outcome||m.state))+'</p></div>'+button('Inspect','inspect',m.id)+'</div>')).join('');
function graphView(mission) {
  if(!mission.repository) return '<div class="steps">'+state.plan.map((step,index)=>panel('<div class="step"><strong>'+step.role+'</strong><p>'+step.task+'</p><small>'+(index ? 'Depends on '+state.plan[index-1].role : 'First step')+'</small><p class="status">'+(index<mission.step?'Executed':index===mission.step&&mission.state==='awaiting_approval'?'Awaiting approval':index===mission.step&&['queued','running'].includes(mission.state)?'Pending':'Unexecuted')+'</p></div>')).join('')+'</div>';
  const nodes=state.graph.filter(node=>node.mission===mission.id);
  if(!nodes.length) return panel(empty('The dependency plan appears after repository approval and planning.'));
  const depths=new Map();
  function depth(node) {
    if(!depths.has(node.id)) depths.set(node.id,node.depends.length ? 1+Math.max(...node.depends.map(id=>depth(nodes.find(item=>item.id===id)))) : 0);
    return depths.get(node.id);
  }
  const groups=Map.groupBy(nodes,depth);
  return '<div class="graph" aria-label="Mission dependency graph">'+[...groups].sort(([a],[b])=>a-b).map(([,items])=>
    '<div class="graph-level">'+items.map(node=>panel('<details data-node="'+escape(node.id)+'"><summary><strong>'+escape(node.role)+'</strong> · '+escape(label(node.state))+'</summary><p>'+escape(node.task)+'</p><small>'+escape(node.depends.length?'Depends on '+node.depends.join(', '):'Starts without dependencies')+'</small><p>Attempts '+node.attempts+'</p>'+(node.output?'<pre>'+escape(JSON.stringify(node.output,null,2))+'</pre>':'')+'</details>')).join('')+'</div>').join('')+'</div>';
}
const views = [
  () => {
    const missions=state.missions;
    const stats=[['Active',missions.filter(m=>['queued','running'].includes(m.state)).length],['Awaiting approval',missions.filter(m=>m.state==='awaiting_approval').length],['Completed',missions.filter(m=>m.state==='completed').length],['Total missions',missions.length]];
    return title('Mission Control','Investigate an approved Git revision and follow agent execution.')+
      '<div class="stats">'+stats.map(([name,count])=>'<div class="stat"><strong>'+count+'</strong>'+name+'</div>').join('')+'</div>'+
      panel('<h2>New mission</h2><form data-form="mission"><label for="objective">Review objective</label><textarea id="objective" name="objective" maxlength="600" required placeholder="What should the crew investigate?"></textarea>'+
        (state.sandboxAvailable&&state.repositories.length?'<label for="repository">Approved repository</label><select id="repository" name="repository" required>'+state.repositories.map(repo=>'<option value="'+escape(repo.name)+'">'+escape(repo.name)+' · '+escape(repo.revision.slice(0,12))+'</option>').join('')+'</select><button class="primary">Start repository investigation</button> ':'<p class="muted">'+(state.sandboxAvailable?'No approved repositories. Add one using the owner CLI.':'Repository isolation is unavailable.')+'</p>')+
        '<button name="intent" value="sample">Start sample review</button></form>')+
      '<h2>Missions</h2>'+(missionRows(missions)||empty('No missions yet.'));
  },
  () => {
    const mission=state.missions.find(m=>m.id===selected)||state.missions[0];
    return title('Mission Canvas','Inspect delegation, dependencies, and recorded evidence.')+(mission ?
      panel('<label for="mission-select">Mission</label><select id="mission-select">'+state.missions.map(m=>'<option value="'+m.id+'" '+(m.id===mission.id?'selected':'')+'>'+escape(m.objective)+'</option>').join('')+'</select><div class="row"><p class="status">'+escape(label(mission.outcome||mission.state))+'</p>'+(['queued','running','awaiting_approval'].includes(mission.state)?button('Cancel mission','cancel',mission.id):'')+'</div>')+
      graphView(mission)+
      panel('<h2>Mission evidence</h2>'+eventList(state.events.filter(e=>e.mission===mission.id))) : empty('Create a mission to inspect its plan.'));
  },
  () => title('Agent Studio','Configure role guidance and access to built-in capabilities.')+
    '<div class="split">'+state.agents.map((role,index)=>panel('<h2>'+role.role+'</h2><p>'+role.task+'</p><pre>'+role.tool+'</pre><form data-form="agent"><input type="hidden" name="role" value="'+role.role+'"><label class="check"><input type="checkbox" name="enabled" '+(role.enabled?'checked':'')+'> Enabled</label><label for="guidance-'+index+'">Role guidance</label><textarea id="guidance-'+index+'" name="guidance" maxlength="500">'+escape(role.guidance)+'</textarea><label for="agent-pass-'+index+'">Confirm owner password</label><input id="agent-pass-'+index+'" name="password" type="password" autocomplete="current-password" required><button>Save agent settings</button></form>')).join('')+'</div>',
  () => title('Execution Terminal','Read the persisted execution and security events.')+
    panel('<label for="event-filter">Event type</label><select id="event-filter"><option value="">All event types</option>'+[...new Set(state.events.map(e=>e.kind))].map(kind=>'<option value="'+escape(kind)+'" '+(kind===filter?'selected':'')+'>'+escape(label(kind))+'</option>').join('')+'</select>'+eventList(state.events.filter(e=>!filter||e.kind===filter))),
  () => title('Memory Vault','Search, save, export, and delete owner-authored notes.')+
    panel('<form data-form="note"><label for="note">New note</label><textarea id="note" name="text" maxlength="2000" required></textarea><button class="primary">Save note</button></form>')+
    panel('<form data-form="search"><label for="query">Search notes</label><input id="query" name="query" value="'+escape(query)+'"><button>Search</button> '+button('Export notes','export-notes')+'</form>')+
    (state.notes.filter(n=>n.body.toLowerCase().includes(query.toLowerCase())).map(n=>panel('<p>'+escape(n.body)+'</p><div class="row"><small>Owner note · '+escape(date(n.created))+'</small>'+button('Delete note','delete-note',n.id)+'</div>')).join('')||empty('No matching notes.')),
  () => title('Skill Forge','Save versioned skill drafts for review.')+
    panel('<form data-form="skill"><label for="name">Skill name</label><input id="name" name="name" maxlength="80" required><label for="description">Description</label><textarea id="description" name="description" maxlength="1000" required></textarea><label for="skill-tool">Requested read-only capability</label><select id="skill-tool" name="tool"><option value="catalog_commit">Inventory tracked files</option><option value="read_tracked_text">Read tracked text</option><option value="recheck_citations">Recheck citations</option></select><button class="primary">Save draft version</button></form>')+
    (state.skills.map(s=>panel('<h2>'+escape(s.name)+' · v'+s.version+'</h2><p>'+escape(s.description)+'</p><p><small>Draft · '+escape(s.tool)+'</small></p><button type="button" data-action="test-skill" data-name="'+escape(s.name)+'" data-version="'+s.version+'">Test permission</button>')).join('')||empty('No skill drafts.')),
  () => title('Approval Center','Review execution scope and decide whether the verifier may run.')+
    (state.missions.filter(m=>m.approval).map(m=>panel('<h2>'+escape(m.objective)+'</h2><p>'+(m.repository?'Inspect '+escape(m.repository)+' at '+escape(m.revision)+' using '+escape(m.provider)+'. '+(m.provider!=='mock'?'Approval sends the objective and selected redacted text to the configured inference provider.':'The deterministic provider processes evidence locally.'):'Run the bundled receipt calculator with fixed in-memory inputs. The sample uses no file writes or network.')+'</p><p class="status">'+escape(label(m.approval))+'</p><small>Expires '+escape(date(m.expires))+'</small>'+
      (m.state==='awaiting_approval'?'<p>'+button(m.repository?'Approve inspection':'Approve verification','approve',m.id,true)+button('Deny','deny',m.id)+'</p>':''))).join('')||empty('No approval requests.')),
  () => title('Artifact Workspace','Inspect and download verification evidence with its SHA-256 digest.')+
    (state.artifacts.map(a=>panel('<h2>'+escape(state.missions.find(m=>m.id===a.mission)?.objective)+'</h2><pre>'+a.hash+'</pre>'+button('Inspect evidence','artifact',a.mission)+button('Download JSON','download',a.mission)+'<div id="artifact-'+a.mission+'"></div>')).join('')||empty('Completed verification reports appear here.')),
  () => title('System Settings','Review runtime limits and control owner sessions.')+
    panel('<h2>Model provider</h2><p class="status">'+escape(state.provider.name)+' · '+escape(state.provider.model||'Model missing')+' · '+(state.provider.ready?'Configured':'Unavailable')+'</p><p>'+(state.provider.name==='openai'?'Mission budget '+(state.provider.maxBudget/1000000).toFixed(3)+' USD estimate · ':'')+state.provider.maxInput+' input / '+state.provider.maxOutput+' output tokens per request · '+(state.provider.timeout/1000)+'s timeout</p>'+(state.provider.daily?'<p>UTC daily reservations '+state.provider.usage.requests+' / '+state.provider.daily.requests+' requests and '+state.provider.usage.tokens+' / '+state.provider.daily.tokens+' tokens.</p>':'')+'<p>Provider and credentials are configured on the server. Repository isolation is '+(state.sandboxAvailable?'available.':'unavailable.')+'</p>')+
    panel('<h2>Dispatch is '+(state.paused?'paused':'enabled')+'</h2><form data-form="settings"><label for="reauth">Confirm owner password</label><input id="reauth" name="password" type="password" autocomplete="current-password" required><button name="intent" value="dispatch">'+(state.paused?'Resume dispatch':'Pause dispatch')+'</button><button name="intent" value="revoke">Revoke all sessions</button></form>')+
    panel('<h2>Current session</h2><p>'+ (state.accessMode==='codespaces'?'Codespaces HTTPS · Owner session expires 30 minutes after sign-in.':state.remoteAccess?'Private HTTPS · Owner session expires 30 minutes after sign-in.':'Local access · Owner session expires 30 minutes after sign-in.')+'</p>'+button('Sign out','logout'))
];
function render(force=false) {
  if (!state) return;
  pendingRender = false;
  const name=location.hash.slice(1);
  const index=Math.max(0,screens.findIndex(screen=>slug(screen)===name));
  const open=[...main.querySelectorAll('details')].map((detail,i)=>detail.open?i:-1).filter(i=>i>=0);
  nav.hidden=false;
  if (activeView!==index || force) nav.innerHTML=screens.map((screen,i)=>'<a href="#'+slug(screen)+'" '+(index===i?'aria-current="page"':'')+'>'+screen+'</a>').join('');
  main.innerHTML=views[index]();
  if (!force && activeView===index) {
    const details=main.querySelectorAll('details');
    for (const i of open) if(details[i]) details[i].open=true;
  }
  activeView=index;
  document.title='Agent_Crew · '+screens[index];
}
function download(name,data) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=name;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
main.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.target;
  const data=Object.fromEntries(new FormData(form));
  const kind=form.dataset.form;
  const submitter=event.submitter;
  if(submitter) submitter.disabled=true;
  try {
    if(kind==='login') { await api('/login','POST',data); sessionEpoch++; await refresh(true); connect(); return; }
    if(kind==='search') { query=data.query; render(true); return; }
    if(kind==='mission') {
      if(submitter?.value==='sample') delete data.repository;
      await api('/missions','POST',data);
    }
    if(kind==='agent') await api('/agents','POST',{...data,enabled:data.enabled==='on'});
    if(kind==='note') await api('/notes','POST',data);
    if(kind==='skill') await api('/skills','POST',data);
    if(kind==='settings') {
      if(submitter.value==='revoke') { await api('/logout-all','POST',data); showLogin(); return; }
      await api('/settings','POST',{...data,paused:!state.paused});
    }
    await refresh(true);
  } catch(error) { notify(error.message); }
  finally { if(submitter) submitter.disabled=false; }
});
main.addEventListener('click',async event=>{
  const control=event.target.closest('button[data-action]');
  if(!control) return;
  const {action,id}=control.dataset;
  control.disabled=true;
  try {
    if(action==='recover') { await recover(); return; }
    if(action==='inspect') { selected=id; location.hash='mission-canvas'; await refresh(true); return; }
    if(action==='test-skill') {
      const result=await api('/skills/test','POST',{name:control.dataset.name,version:Number(control.dataset.version)});
      notify('Permission check passed · '+result.role+' · '+result.tool);
      return;
    }
    if(action==='logout') { await api('/logout','POST'); showLogin(); return; }
    if(action==='export-notes') { download('agent-crew-notes.json',state.notes); return; }
    if(action==='delete-note') {
      if(!confirm('Delete this note?')) return;
      await api('/notes/'+id,'DELETE');
    }
    if(['approve','deny','cancel'].includes(action)) await api('/missions/'+id+'/'+action,'POST');
    if(['artifact','download'].includes(action)) {
      const report=await api('/missions/'+id+'/artifact');
      if(action==='download') download('verification-'+id+'.json',report);
      else document.querySelector('#artifact-'+id).innerHTML='<pre>'+escape(JSON.stringify(report.body,null,2))+'</pre>';
      return;
    }
    await refresh(true);
  } catch(error) { notify(error.message); }
  finally { control.disabled=false; }
});
main.addEventListener('change',event=>{
  if(event.target.id==='mission-select') { selected=event.target.value; refresh(true).then(()=>document.querySelector('#mission-select')?.focus()).catch(error=>notify(error.message)); }
  if(event.target.id==='event-filter') { filter=event.target.value; render(true); document.querySelector('#event-filter').focus(); }
});
main.addEventListener('focusout',()=>setTimeout(()=>{
  if(state && pendingRender && !main.contains(document.activeElement)) render();
},50));
window.addEventListener('hashchange',()=>render(true));
await recover();
