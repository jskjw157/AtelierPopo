import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';

// No directory/file exemption: each reviewed import or initiation AST node is
// pinned independently, including its exact occurrence count. Changes require review.
export const REVIEWED_TRANSPORT_BOUNDARIES = Object.freeze([
  Object.freeze({"file":"src/cafe24/auth.js","kind":"network_initiation","nodeSha256":"53ed39299012da81e3149f9c345327df7809a3e1b42bad979470503280e8ee95","occurrences":1,"reason":"Existing Cafe24 OAuth refresh transport; configured token URL, redirect denial.","testRefs":["test/cafe24-auth-client.test.js"]}),
  Object.freeze({"file":"src/cafe24/client.js","kind":"network_initiation","nodeSha256":"bf0ed130d6a836c89892163865da5eccaacfcf44ff184e235129b645e1a7dc19","occurrences":1,"reason":"Existing Cafe24 GET-only configured same-origin client; no new endpoint authority.","testRefs":["test/cafe24-auth-client.test.js"]}),
  Object.freeze({"file":"src/drive/auth.js","kind":"network_initiation","nodeSha256":"213b591f96d4092a621b5f550d247bcab3325efc8c319ecd01e7257dc9ec8906","occurrences":1,"reason":"Existing configured Google OAuth transport; outside SearchAd execution authority.","testRefs":["test/drive-auth.test.js"]}),
  Object.freeze({"file":"src/drive/auth.js","kind":"network_initiation","nodeSha256":"fbba12ad83dfd1b40b20b6ca051152238c0c1771ae53a843d369e350a0812614","occurrences":1,"reason":"Existing configured Google OAuth transport; outside SearchAd execution authority.","testRefs":["test/drive-auth.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"network_initiation","nodeSha256":"32a828fcb72be94e66c181e1a1d6ccfbf1a1a2fc3e2b180918ea8b8f69e892b6","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"85ee14ab2b3bed5eca676de97b9488fc71e6fd1a63f44591725cedb31962e556","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"a7fcd9a35e4e02a77c62f03db376152e40fd136efb623f9efeecb650658a4ae6","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"6803b39e6f6b60aa586bcdb398013dede248db934837ea74ef0ffe2134c7661c","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"7618df4aefbdfc59aad839e90300e078b4a45986a5e213fb52bc0935a396639e","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"2f567aa7fffad566056244164019553240a1a635186b4ccb81871c7d8dfa5a50","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"a6b174b55a6410a4c19feef68440b91fb146e800448c977abe5e2972a341a6b2","occurrences":2,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/http/server-v03.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/http/server-v04.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/http/server-v05.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/http/server.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/naver/auth.js","kind":"network_initiation","nodeSha256":"fb3ac0e49c2eb35339c809c6109ca13f8be1c3596213731db00ebad919d22303","occurrences":1,"reason":"Existing Naver Commerce token transport; outside SearchAd execution authority.","testRefs":["test/naver-auth.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"network_initiation","nodeSha256":"1af43af9454ee067e401950983580e4f8d3d43c25144a5438c4d123ad6b50a0b","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"3a7485050b6872dbeb0d8438b4607ae9bef556277c48810b3b74211e64c5433e","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"94a69aa7620cfc4bbb9a2dbccde4145d7c820122b9c589db3dad4968a0d41bd6","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"c3de1155d2e27c4dae7de78375f263d50af11573781329b8703d5e0ac464e69d","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"5d57db9ef3b4b6e5d3152878c1806d174025eda0eba68aa9ed363b9db7744454","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"f41ea7dc1caddedd7662faa7241b31245c48c6b99bdbea7f8993c5c6ea2b7051","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"b431475f8605e73d196ef005a71075f7dd1686aa40a2f268681e6f9c1f99985b","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/client.js","kind":"network_initiation","nodeSha256":"9b9df542a3fbf48b509b6fbf55e0d522b39117dc19fd385994ee676e999a6b35","occurrences":1,"reason":"SearchAd authenticated client transport entry; signatures, method retry and redirect contracts.","testRefs":["test/searchad-client.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"2f37ffd9238d68f09a1e17872bf626931a2ba0980e7b5f1e29af87b90fb897f9","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"ba26bf3307095936f5e92a37730dede69c386107e618e5517b2401bd3017bca8","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"74ec006b84c478db73daf74623b99de5a49abb6d4caf056c156e795fb9437414","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"2ba72bc1941e54deecc48691e3abc1753eb4dd5d8632eb80de94245d6b848592","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/postgres-account-send-fence.js","kind":"network_initiation","nodeSha256":"524a9dac5d6f19c2b086a4510ce2fe1cb4f0391c79d102e677a59331e71633db","occurrences":2,"reason":"Existing account-row transport initiation boundary; GET/HEAD observation and exact guarded mutation entry. Fence behavior is unchanged.","testRefs":["test/searchad-send-fence-method.test.js","test/postgres-searchad-application-send-fence.integration.test.js","test/postgres-searchad-suspend-send-fence.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/postgres-mutation-gateway.js","kind":"network_initiation","nodeSha256":"ec027e31f9a5edb119d4ce0737cb5b66fa35df45dbcc57ac5ced72a3b602b320","occurrences":1,"reason":"Private captured transport invocation inside the account fence; pins initiatedAt for report registration.","testRefs":["test/searchad-postgres-mutation-gateway.test.js","test/postgres-searchad-report-jobs.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/runtime-production.js","kind":"network_initiation","nodeSha256":"a97245dfab6b23870c6e67abfda85b20e0deb8b936dd3fa3d6bbe7abd6a7c020","occurrences":1,"reason":"Inventory-only transport wrapper: exact origin, credential-free URL, redirects denied; upstream read-only gateway classification remains required.","testRefs":["test/postgres-searchad-inventory-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/s3-storage.js","kind":"network_import","nodeSha256":"e4f376747ec2b6b536e72a8de5b5c53b421483dab91850a57aa91d62ade1533c","occurrences":1,"reason":"Exact report archive SDK import and put/get delegations; scoped object key/checksum and configured durable storage only.","testRefs":["test/searchad-reporting-ingestion.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/s3-storage.js","kind":"raw_client_delegation","nodeSha256":"73a347c690c12c79bc0424c85d4dd65d6299dc9c5c0ede5689d7e697ed1cc90d","occurrences":1,"reason":"Exact report archive SDK import and put/get delegations; scoped object key/checksum and configured durable storage only.","testRefs":["test/searchad-reporting-ingestion.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/s3-storage.js","kind":"raw_client_delegation","nodeSha256":"5adb1daa8ea54d0f98bf1be1352f00694b33cd9a45c55141cefa0d653de40611","occurrences":1,"reason":"Exact report archive SDK import and put/get delegations; scoped object key/checksum and configured durable storage only.","testRefs":["test/searchad-reporting-ingestion.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/spec-sync.js","kind":"network_initiation","nodeSha256":"fcca233c03a9154ff615c0519768f0e9e5b4da96053a1310eb9665d5360e95d8","occurrences":1,"reason":"Offline maintenance command fetchSource: pinned source size/git-blob hashes verified; never ad execution authority.","testRefs":["test/searchad-spec.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/transport/report-download.js","kind":"raw_client_delegation","nodeSha256":"b65f18a4e509f041e23b7594605c284ae7dee584a6dd8d9fe97bc6c5129327ee","occurrences":1,"reason":"Separate owned-job signed-download delegation: fixed path/origin/query, no redirects or retries, byte bound. Not a 127th operation.","testRefs":["test/searchad-reporting-ingestion.test.js","test/postgres-searchad-report-ingestion.integration.test.js"]}),
]);
const networkModule = /^(?:(?:node:)?(?:https?|http2|net|tls)$|(?:undici|axios|node-fetch|cross-fetch|got|superagent|ws|websocket|@aws-sdk\/client-s3)(?:\/|$))/;
const extensions = new Set(['.js', '.mjs', '.cjs']);
const digest = value => createHash('sha256').update(value).digest('hex');
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink()) throw new Error(`SEARCHAD_SCAN_SYMLINK_UNREVIEWED:${file}`);
    return entry.isDirectory() ? sourceFiles(file) : extensions.has(path.extname(file)) ? [file] : [];
  });
}
function inspect(source, ast) {
  const nodes=[];walk(ast,node=>nodes.push(node));
  const bindings=new Map(), constants=new Map(), imports=[], findings=[];
  const key=node=>node?.type==='Identifier' ? node.name : node?.type==='PrivateIdentifier' ? `#${node.name}` : node?.type==='ThisExpression' ? 'this' : node?.type==='MemberExpression' ? `${key(node.object)}.${property(node)}` : null;
  const literal=node=>node?.type==='Literal' ? node.value : node?.type==='Identifier' ? constants.get(node.name) : node?.type==='BinaryExpression' && node.operator==='+' ? (typeof literal(node.left)==='string' && typeof literal(node.right)==='string' ? literal(node.left)+literal(node.right) : undefined) : node?.type==='TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
  const property=node=>node.computed ? literal(node.property) : node.property?.type==='PrivateIdentifier' ? `#${node.property.name}` : node.property?.name;
  const signature=node=>{
    if(!node)return null;
    if(node.type==='ChainExpression'||node.type==='AwaitExpression')return signature(node.expression||node.argument);
    const assigned=bindings.get(key(node));if(assigned)return assigned;
    if(node.type==='Identifier') {
      if(['globalThis','window','global','self'].includes(node.name))return 'global';
      if(['fetch','fetchImpl','WebSocket','XMLHttpRequest'].includes(node.name))return 'network';
    }
    if(node.type==='NewExpression' && key(node.callee)==='PostgresAccountSendFence')return 'fence';
    if(node.type==='ImportExpression')return networkModule.test(literal(node.source)||'') ? 'network_module' : null;
    if(node.type==='CallExpression' && node.callee.type==='MemberExpression' && property(node.callee)==='bind')return signature(node.callee.object);
    if(node.type==='MemberExpression'){
      const owner=signature(node.object),name=property(node);
      if(owner==='fence' && name==='fetch')return 'approved_delegation';
      if(owner==='global' && (name===undefined||['fetch','WebSocket','XMLHttpRequest'].includes(name)))return 'network';
      if(owner==='network_module')return name==='createServer' ? 'inbound_server' : 'network';
      if(['bind','call','apply'].includes(name))return signature(node.object);
      if(['fetch','fetchImpl','#fetch'].includes(name))return 'network';
      if(name==='request' || (name==='send' && /client|socket/i.test(key(node.object)||'')))return 'raw_client';
    }
    return null;
  };
  function bind(pattern,value) {
    if(!pattern)return;
    if(pattern.type==='AssignmentPattern')return bind(pattern.left,value||signature(pattern.right));
    if(pattern.type==='ObjectPattern')for(const entry of pattern.properties){
      const name=entry.key?.name||entry.key?.value;
      bind(entry.value,['fetch','fetchImpl','WebSocket','XMLHttpRequest'].includes(name) ? 'network' : name==='request' ? 'raw_client' : value==='network_module' ? 'network' : null);
    }
    else if(value && key(pattern))bindings.set(key(pattern),value);
  }
  // Conservative fixed-point alias propagation; never assume name shadowing
  // makes a suspicious call safe. Approved gateway methods are not raw clients.
  for(let pass=0;pass<=nodes.length;pass++){
    const before=JSON.stringify([...bindings])+JSON.stringify([...constants]);
    for(const node of nodes){
      if(node.type==='ImportDeclaration'){
        if(networkModule.test(node.source.value))for(const spec of node.specifiers)bindings.set(spec.local.name,spec.type==='ImportNamespaceSpecifier'||spec.type==='ImportDefaultSpecifier' ? 'network_module' : spec.imported?.name==='createServer' ? 'inbound_server' : node.source.value==='@aws-sdk/client-s3' ? 'sdk_constructor' : 'network');
      }
      if(node.type==='VariableDeclarator'){
        const value=literal(node.init);if(node.id.type==='Identifier' && value!==undefined)constants.set(node.id.name,value);bind(node.id,signature(node.init));
        if(node.init?.type==='ObjectExpression' && key(node.id))for(const field of node.init.properties){const value=signature(field.value);if(value)bindings.set(`${key(node.id)}.${field.key?.name||field.key?.value}`,value);}
      }
      if(['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression'].includes(node.type))for(const param of node.params)bind(param,null);
      if(node.type==='AssignmentExpression')bind(node.left,signature(node.right));
    }
    if(before===JSON.stringify([...bindings])+JSON.stringify([...constants]))break;
  }
  function finding(node,kind,detail){findings.push({kind,line:node.loc.start.line,column:node.loc.start.column,nodeSha256:digest(source.slice(node.start,node.end)),detail});}
  for(const node of nodes){
    if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'){
      const values=node.declaration?.type==='VariableDeclaration' ? node.declaration.declarations.map(item=>item.id) : node.declaration ? [node.declaration] : (node.specifiers||[]).map(item=>item.local);
      if(values.some(value=>['global','network','network_module','raw_client'].includes(signature(value))))finding(node,'network_export','Exported network capability alias');
    }
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source){
      imports.push(node.source.value);if(networkModule.test(node.source.value))finding(node,'network_import',node.source.value);
    }
    if(node.type==='ImportExpression'){
      const target=literal(node.source);
      if(typeof target==='string')imports.push(target);
      if(typeof target!=='string'||networkModule.test(target))finding(node,'dynamic_network_import',typeof target==='string'?target:'unresolved dynamic import');
    }
    if(node.type==='CallExpression'||node.type==='NewExpression'){
      if(key(node.callee)==='require'){
        const target=literal(node.arguments[0]);if(typeof target==='string')imports.push(target);
        if(typeof target!=='string'||networkModule.test(target))finding(node,'network_require',target||'unresolved require');
      }
      let kind=signature(node.callee);
      if(key(node.callee)==='Reflect.apply')kind=signature(node.arguments[0]);
      if(['network','network_module','raw_client'].includes(kind))finding(node,kind==='raw_client'?'raw_client_delegation':'network_initiation',key(node.callee)||node.callee.type);
    }
  }
  return {imports,findings};
}

/** Recursively scans every source file (including future profitability/routes/
 * bootstraps), then follows relative imports even outside src. This is a static
 * regression check, not sandboxing or proof of live authorization. */
export function scanExecutionSources({root=process.cwd(),transportAllowlist=REVIEWED_TRANSPORT_BOUNDARIES}={}) {
  root=fs.realpathSync(path.resolve(root));
  const allowed=new Map();
  for(const boundary of transportAllowlist){
    if(!boundary || !/^src\/[A-Za-z0-9_./-]+\.(?:js|mjs|cjs)$/.test(boundary.file)||boundary.file.split('/').includes('..')||!['network_import','network_initiation','raw_client_delegation'].includes(boundary.kind)||!/^[a-f0-9]{64}$/.test(boundary.nodeSha256)||!Number.isInteger(boundary.occurrences)||boundary.occurrences<1||!boundary.reason||!boundary.testRefs?.length)throw new Error('SEARCHAD_TRANSPORT_BOUNDARY_INVALID');
    const id=`${boundary.file}:${boundary.kind}:${boundary.nodeSha256}`;
    if(allowed.has(id))throw new Error('SEARCHAD_TRANSPORT_BOUNDARY_INVALID');allowed.set(id,boundary);
  }
  const queue=sourceFiles(path.join(root,'src')),seen=new Set(),violations=[],reviewedTransportBoundaries=[],counts=new Map();
  if(!queue.length)violations.push({file:'src',kind:'source_missing',detail:'No executable source files found'});
  while(queue.length){
    const absolute=queue.shift();if(seen.has(absolute))continue;seen.add(absolute);
    const file=path.relative(root,absolute).split(path.sep).join('/');
    let result;
    try{const source=fs.readFileSync(absolute,'utf8');result=inspect(source,parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true}));}
    catch(error){violations.push({file,kind:'parse_error',line:error.loc?.line||null,detail:'Source could not be read or parsed'});continue;}
    for(const dependency of result.imports.filter(name=>name.startsWith('.'))){
      const target=path.resolve(path.dirname(absolute),dependency);
      if(!target.startsWith(root+path.sep)){violations.push({file,kind:'import_outside_root',detail:dependency});continue;}
      const resolved=[target,...['.js','.mjs','.cjs','/index.js'].map(suffix=>target+suffix)].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
      if(!resolved){violations.push({file,kind:'unresolved_local_import',detail:dependency});continue;}
      if(extensions.has(path.extname(resolved))){if(fs.realpathSync(resolved)!==resolved)violations.push({file,kind:'import_symlink_unreviewed',detail:dependency});else queue.push(resolved);}
    }
    for(const finding of result.findings){
      const id=`${file}:${finding.kind}:${finding.nodeSha256}`,boundary=allowed.get(id);
      counts.set(id,(counts.get(id)||0)+1);
      if(boundary && counts.get(id)<=boundary.occurrences)reviewedTransportBoundaries.push({file,...finding,reason:boundary.reason,testRefs:boundary.testRefs});
      else violations.push({file,...finding});
    }
  }
  for(const [id,boundary]of allowed){
    if(seen.has(path.join(root,boundary.file)) && counts.get(id)!==boundary.occurrences)violations.push({file:boundary.file,kind:'reviewed_boundary_changed',detail:'Reviewed AST node occurrence count changed',nodeSha256:boundary.nodeSha256});
  }
  return {scannedFiles:[...seen].map(file=>path.relative(root,file).split(path.sep).join('/')).sort(),violations,reviewedTransportBoundaries};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length && (args.length!==2||args[0]!=='--root'))throw new Error('Usage: searchad-execution-safety.mjs [--root directory]');
  const result=scanExecutionSources({root:args[1]||process.cwd()});
  console.log(JSON.stringify({ok:result.violations.length===0,scope:'all recursive src plus relative import closure',staticCheckOnly:true,...result},null,2));
  process.exitCode=result.violations.length ? 1 : 0;
}
