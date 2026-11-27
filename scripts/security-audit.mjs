#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git","node_modules","dist","build","coverage",".next",".nuxt",".turbo",".cache",".venv","venv","target","vendor","out"]);
const binary = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|avi|sqlite3?|db|pyc|class|jar|wasm)$/i;
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if (ignored.has(e.name)) continue;
    const abs=path.join(dir,e.name), rel=path.relative(root,abs).replaceAll("\\","/");
    if (e.isDirectory()) walk(abs);
    else if (e.isFile() && !binary.test(e.name)) {
      try { const s=fs.statSync(abs); if (s.size<=2000000) files.push({rel,text:fs.readFileSync(abs,"utf8")}); } catch {}
    }
  }
}
walk(root);
const code=files.filter(f=>!/\.(md|txt|lock|svg)$/i.test(f.rel)).map(f=>"\n/* FILE:"+f.rel+" */\n"+f.text).join("\n");
const findings=[];
const add=(id,level,title,detail)=>findings.push({id,level,title,detail});
const has=(re,text=code)=>re.test(text);
const exists=re=>files.some(f=>re.test(f.rel));

const envs=files.filter(f=>/(^|\/)\.env(\.[^/]+)?$/i.test(f.rel)&&!/(example|sample|template|defaults?)$/i.test(f.rel));
if(envs.length)add(5,"FAIL","Real .env committed",envs.map(f=>f.rel).join(", "));
for(const [name,re] of [
 ["private key",/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
 ["AWS key",/\bAKIA[0-9A-Z]{16}\b/],
 ["GitHub token",/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
 ["OpenAI-style secret",/\bsk-[A-Za-z0-9_-]{32,}\b/]
]){
 const hit=files.find(f=>re.test(f.text)); if(hit)add(2,"FAIL","Secret material detected",name+" in "+hit.rel);
}
const pub=files.find(f=>/\.(?:js|jsx|ts|tsx|mjs|cjs|env|json|ya?ml)$/i.test(f.rel)&&/(?:VITE_|NEXT_PUBLIC_|REACT_APP_)[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE|PASSWORD|API_KEY)\s*[=:]/i.test(f.text));
if(pub)add(2,"FAIL","Secret-like public frontend variable",pub.rel);

const admin=has(/\b(admin|administrator|role|permission|rbac|privilege)\b/i);
const authz=has(/\b(authoriz|permission|rbac|roleGuard|requireRole|requireAdmin|policy|can\()\b/i);
add(1,admin&&!authz?"WARN":"INFO","Server-side admin + roles",admin?(authz?"Authorization markers found; verify denial tests.":"Privileged concepts found without clear authorization markers."):"No obvious privileged surface; confirm N/A.");

const business=has(/\b(price|pricing|quantity|qty|coupon|discount|checkout|payment|entitlement|quota)\b/i);
const validation=has(/\b(zod|joi|yup|pydantic|validator|validate|schema|serializer|constraint)\b/i);
add(3,business&&!validation?"WARN":"INFO","Critical business-rule validation",business?(validation?"Validation markers found; prove trusted-side recalculation.":"Critical values found without clear validation markers."):"No obvious commerce/entitlement logic; confirm N/A.");

const auth=has(/\b(login|signIn|signin|otp|one[-_ ]time|password reset|forgot password|token endpoint)\b/i);
const rate=has(/\b(rateLimit|rate_limit|throttl|limiter|slowDown|retryAfter|429)\b/i);
add(4,auth&&!rate?"WARN":"INFO","OTP/login abuse protection",auth?(rate?"Rate-limit markers found; verify behavior.":"Auth flow found without clear throttling markers."):"No auth flow found; confirm N/A.");

const injection=/(?:query|execute|raw)\s*\(\s*["'][^"']*["']\s*\+\s*(?:req|request|params|query|body)/i.test(code)||/(?:exec|execSync|spawn|system|popen)\s*\([^)]*(?:req\.|request\.|params\.|query\.|body\.)/i.test(code);
if(injection)add(5,"FAIL","Possible injection sink","Replace direct request-to-query/command construction with parameterized/allowlisted APIs.");
const xss=files.find(f=>/dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\(/i.test(f.text));
if(xss)add(5,"WARN","Potential XSS sink",xss.rel+" requires trusted sanitization/encoding.");
const upload=has(/\b(multer|upload|request\.files|req\.files|FileUpload|multipart|formidable|busboy)\b/i);
const uploadGuard=has(/\b(fileSize|maxFileSize|mime|mimetype|contentType|allowedTypes|allowlist|extension|filename|sanitize)\b/i);
add(5,upload&&!uploadGuard?"WARN":"INFO","SQL/XSS/uploads/env",upload&&!uploadGuard?"Upload handling lacks clear type/size/name validation markers.":"No additional high-confidence control-5 failure found.");

const cors=(/Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*["']/i.test(code)&&/Access-Control-Allow-Credentials["']?\s*[:=]\s*["']?true/i.test(code))||/cors\s*\(\s*\{[^}]*origin\s*:\s*["']\*["'][^}]*credentials\s*:\s*true/is.test(code);
if(cors)add(6,"FAIL","Credentialed wildcard CORS","Never combine credentials with wildcard origin.");
else add(6,"INFO","CSRF + CORS","No credentialed wildcard CORS found; cookie-auth state changes still need CSRF/origin proof.");

if(auth){
 const sess=has(/\b(HttpOnly|SameSite|Secure\b|session.*expir|token.*expir|rotate|revok|logout)\b/i);
 add(7,sess?"INFO":"WARN","Session/token security",sess?"Session/token markers found; verify lifecycle tests.":"Auth exists without clear secure-cookie/expiry/revocation markers.");
}else add(7,"INFO","Session/token security","No auth flow found; confirm N/A.");

const backend=has(/\b(express\(|fastapi|flask|django|http\.createServer|serve\(|app\.(get|post|put|patch|delete)|router\.(get|post|put|patch|delete))\b/i);
const headers=has(/\b(helmet\(|Content-Security-Policy|Strict-Transport-Security|X-Content-Type-Options|Referrer-Policy)\b/i);
add(8,backend&&!headers?"WARN":"INFO","HTTPS + security headers",backend&&!headers?"Server surface found without clear security-header markers.":"Verify deployed HTTPS and headers where applicable.");

for(const wf of files.filter(f=>/^\.github\/workflows\/.*\.ya?ml$/i.test(f.rel))){
 for(const line of wf.text.split(/\r?\n/)){
  const m=line.match(/^\s*uses:\s*([^#\s]+)@([^\s#]+)/);
  if(m&&!/^[0-9a-f]{40}$/i.test(m[2].replace(/["']/g,"")))add(9,"FAIL","Mutable GitHub Action",wf.rel+": "+m[1]+"@"+m[2]+" — pin to full SHA.");
 }
}
if(exists(/(^|\/)package\.json$/i)&&!exists(/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/i))add(9,"WARN","Dependency lockfile missing","Commit the ecosystem lockfile.");
add(9,"INFO","Supply chain","Workflow pinning/lockfile checks completed; run ecosystem vulnerability review too.");

const critical=admin||auth||business;
const logging=has(/\b(auditLog|audit_log|securityEvent|security_event|logger\.|logging\.|logSecurity|structured log)\b/i);
add(10,critical&&!logging?"WARN":"INFO","Security logging + alerting",critical&&!logging?"Sensitive flows found without clear audit/security logging markers.":"Verify logs exclude secrets and alerts exist.");

const leak=files.find(f=>/(?:res|response)\.(?:send|json)\s*\([^)]*(?:err\.stack|error\.stack|stackTrace)/i.test(f.text));
if(leak)add(11,"FAIL","Stack trace returned to client","Possible error leak in "+leak.rel);
else add(11,"INFO","Safe errors + fail closed","No direct stack-trace response sink found; verify negative paths deny by default.");

const untrusted=/fetch\s*\(\s*(?:req|request)\.(?:body|query|params)[^)]*(?:url|uri|target)/i.test(code)||/(?:redirect|location)\s*\(\s*(?:req|request)\.(?:body|query|params)/i.test(code)||/(?:sendFile|readFile|readFileSync|open)\s*\([^)]*(?:req|request)\.(?:body|query|params)/i.test(code);
if(untrusted)add(12,"FAIL","Untrusted URL/redirect/path sink","Add strict allowlisting/canonicalization and negative tests.");
else add(12,"INFO","SSRF / redirect / path traversal","No high-confidence direct request-to-URL/path sink found.");

const weak=files.find(f=>/\b(md5|sha1)\s*\(/i.test(f.text)&&!/test|fixture|legacy/i.test(f.rel));
add(13,weak?"WARN":"INFO","Crypto + data protection",weak?"Weak hash primitive reference in "+weak.rel:"No obvious weak crypto primitive; manual key/data protection review remains.");

const debug=files.find(f=>/\b(DEBUG\s*=\s*True|debug\s*:\s*true|app\.run\([^)]*debug\s*=\s*True)\b/i.test(f.text));
add(14,debug?"WARN":"INFO","Secure defaults + least privilege",debug?"Debug-enabled config found in "+debug.rel:"Verify runtime/cloud/database/API/CI permissions separately.");

const rank={FAIL:0,WARN:1,INFO:2};findings.sort((a,b)=>a.id-b.id||rank[a.level]-rank[b.level]);
console.log("\nSecurity Audit 14 — static repository gate\n");
for(const f of findings)console.log("["+f.level+"] #"+f.id+" "+f.title+"\n  "+f.detail);
const fails=findings.filter(f=>f.level==="FAIL"),warns=findings.filter(f=>f.level==="WARN");
console.log("\nSummary: "+fails.length+" FAIL, "+warns.length+" WARN/MANUAL.");
if(fails.length)process.exit(1);
