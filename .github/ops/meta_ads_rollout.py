"""Pinned HAAR Social Studio rollout; no Caddy, database replacement, or Meta writes."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.error

SOURCE_SHA = 'd59bc2bc10f7588b012a228d389c1dd3737c55e1'
EXPECTED_OLD_IMAGE = 'sha256:efc61b38b7cc4851fe965f105c6d8deaff2fd1a54a45140455baa2d6fb5e8818'
ROOT = Path('/opt/haar-social-studio')
APP = ROOT / 'app'
PROJECT = 'app'
IMAGE = 'haar-social-studio:meta-ads-' + SOURCE_SHA[:12]
BASE = 'http://127.0.0.1:3100'
PUBLIC = 'https://social.haarapp.tech'
GATES = {'META_ADS_WRITES_ENABLED': 'false', 'HAAR_TOOL_BEARER_TOKEN': '', 'HAAR_TOOL_ACTOR_ID': ''}


def locked_environment(source):
    lines, seen = [], set()
    for line in source.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Z_]+)\s*=', line)
        key = match.group(1) if match else None
        if key in GATES:
            if key not in seen:
                lines.append(key + '=' + GATES[key])
                seen.add(key)
        else:
            lines.append(line)
    lines.extend(key + '=' + value for key, value in GATES.items() if key not in seen)
    return '\n'.join(lines) + '\n'


def release_healthy(h):
    return (h.get('status') == 'ok' and h.get('database') == 'ok' and h.get('version') == '0.2.0'
            and h.get('features', {}).get('metaAds') is True
            and h.get('features', {}).get('adsExecutionEnabled') is False)


def data_preserved(before, after):
    return (all(before.get(k) == after.get(k) for k in ['ownerSignature', 'connectionSignature'])
            and all(after.get(k, -1) >= before[k] for k in ['products', 'media', 'posts']))


def out(*args):
    return subprocess.check_output(args, text=True).strip()


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def container(service):
    ids = out('docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + PROJECT,
              '--filter', 'label=com.docker.compose.service=' + service).split()
    if len(ids) != 1:
        raise RuntimeError('Expected exactly one existing ' + service + ' container')
    return json.loads(out('docker', 'inspect', ids[0]))[0]


def http(base, path):
    req = urllib.request.Request(base + path, headers={'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def wait_health(base, attempts):
    for _ in range(attempts):
        try:
            code, body = http(base, '/api/health')
            value = json.loads(body)
            if code == 200 and release_healthy(value):
                return value
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('Release health verification failed: ' + base)


def inventory(dbid):
    sql = """SELECT json_build_object(
      'ownerSignature', (SELECT md5(coalesce(string_agg(id||':'||email||':'||password_hash||':'||role, '|' ORDER BY id),'')) FROM users),
      'connectionSignature', (SELECT md5(coalesce(string_agg(id||':'||platform||':'||coalesce(account_id,'')||':'||coalesce(access_token_encrypted,''), '|' ORDER BY id),'')) FROM social_connections),
      'products',(SELECT count(*) FROM products),
      'media',(SELECT count(*) FROM media_assets),
      'posts',(SELECT count(*) FROM post_variants));"""
    result = subprocess.check_output(['docker','exec','-i',dbid,'sh','-c',
        'exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], input=sql, text=True)
    return json.loads(result)


def compose(directory, *args):
    return run('docker','compose','--project-name',PROJECT,'--project-directory',str(directory),
               '-f',str(directory/'docker-compose.yml'), *args)


def deploy(stamp, digest):
    if os.geteuid() != 0 or not re.fullmatch(r'\d+',stamp) or not re.fullmatch(r'[a-f0-9]{64}',digest):
        raise RuntimeError('Privileged deployment with pinned numeric run ID/digest required')
    os.umask(0o077)
    if APP.is_symlink() or not (APP/'.env').is_file():
        raise RuntimeError('Existing real application directory and environment required')
    before_app, before_db = container('app'), container('database')
    if before_app['Image'] != EXPECTED_OLD_IMAGE:
        raise RuntimeError('Current app image changed since preflight; refusing overwrite')
    labels = before_app['Config']['Labels']
    if labels.get('com.docker.compose.project.working_dir') != str(APP):
        raise RuntimeError('Unexpected current application project')
    mounts = {m['Destination']:m.get('Name') for m in before_app['Mounts']}
    dbmounts = {m['Destination']:m.get('Name') for m in before_db['Mounts']}
    if mounts.get('/app/data/uploads') != 'app_haar_social_uploads' or dbmounts.get('/var/lib/postgresql/data') != 'app_haar_social_postgres':
        raise RuntimeError('Unexpected persistence volumes; rollout blocked')
    if before_app['NetworkSettings']['Ports'].get('3000/tcp') != [{'HostIp':'127.0.0.1','HostPort':'3100'}]:
        raise RuntimeError('Unexpected existing port mapping')
    for p in ['docker-compose.override.yml','docker-compose.override.yaml','compose.override.yml','compose.override.yaml']:
        if (APP/p).exists():
            raise RuntimeError('Existing compose override requires separate review')
    code, body = http(BASE,'/api/health')
    if code != 200 or json.loads(body).get('status') != 'ok':
        raise RuntimeError('Existing app is not healthy')
    if shutil.disk_usage(APP).free < 4*1024**3:
        raise RuntimeError('At least 4 GiB free space required')
    archive = Path('/tmp/haar-meta-ads-'+stamp+'.tar.gz')
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Transferred archive checksum mismatch')
    release = ROOT/'rollouts'/('meta-ads-'+stamp)
    release.mkdir(parents=True, exist_ok=False, mode=0o700)
    candidate, previous, failed = release/'candidate', release/'previous-app', release/'failed-app'
    candidate.mkdir(mode=0o700)
    with tarfile.open(archive,'r:gz') as tf:
        for member in tf.getmembers():
            parts=Path(member.name).parts
            if not parts or parts[0]!='social-studio' or '..' in parts or member.issym() or member.islnk():
                raise RuntimeError('Unexpected archive entry')
            dest=candidate.joinpath(*parts[1:])
            if member.isdir():
                dest.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                if member.size > 3*1024**2 or dest.name == '.env':
                    raise RuntimeError('Unexpected archive file')
                dest.parent.mkdir(parents=True,exist_ok=True)
                with tf.extractfile(member) as inp, dest.open('xb') as output:
                    shutil.copyfileobj(inp,output)
                dest.chmod(member.mode & 0o755)
            else:
                raise RuntimeError('Special archive entry rejected')
    if (candidate/'docker-compose.yml').read_bytes() != (APP/'docker-compose.yml').read_bytes():
        raise RuntimeError('Compose layout differs; refusing volume/network migration')
    if json.loads((candidate/'package.json').read_text()).get('version') != '0.2.0':
        raise RuntimeError('Wrong application release')
    original_environment=(APP/'.env').read_text()
    (candidate/'.env').write_text(locked_environment(original_environment))
    (candidate/'.env').chmod(0o600)
    (candidate/'HAAR_DEPLOYED_SHA').write_text(SOURCE_SHA+'\n')
    print('Building candidate while existing application remains available.',flush=True)
    build_log = release/'build.log'
    with build_log.open('wb') as log:
        result=subprocess.run(['docker','build','-t',IMAGE,str(candidate)],stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:
        print('Candidate build failed; original app is still running. Build log retained on server.',flush=True)
        raise RuntimeError('Candidate image build failed')
    manifest=(candidate/'docker-compose.yml').read_text()
    if manifest.count('  app:\n    build: .') != 1:
        raise RuntimeError('Unexpected app build stanza')
    manifest=manifest.replace('  app:\n    build: .','  app:\n    image: '+IMAGE+'\n    build: .',1)
    (candidate/'docker-compose.yml').write_text(manifest)
    run('docker','compose','--project-name',PROJECT,'--project-directory',str(candidate),'-f',str(candidate/'docker-compose.yml'),'config',stdout=subprocess.DEVNULL)
    if container('app')['Id'] != before_app['Id'] or container('database')['Id'] != before_db['Id']:
        raise RuntimeError('Deployment changed during build; refusing to replace it')
    if (APP/'.env').read_text() != original_environment:
        raise RuntimeError('Environment changed during build; rollout blocked')
    before_inventory=inventory(before_db['Id'])
    with (release/'database-before.dump').open('wb') as backup:
        run('docker','exec',before_db['Id'],'sh','-c','exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"',stdout=backup)
    if (release/'database-before.dump').stat().st_size == 0:
        raise RuntimeError('Database backup was empty')
    moved_old=False
    try:
        APP.rename(previous)
        moved_old=True
        candidate.rename(APP)
        compose(APP,'up','-d','--no-deps','--no-build','app')
        local=wait_health(BASE,60)
        after_app, after_db=container('app'),container('database')
        if after_db['Id'] != before_db['Id']:
            raise RuntimeError('Database container changed unexpectedly')
        if {m['Destination']:m.get('Name') for m in after_app['Mounts']} != mounts:
            raise RuntimeError('Application persistence changed unexpectedly')
        after_inventory=inventory(after_db['Id'])
        if not data_preserved(before_inventory,after_inventory):
            raise RuntimeError('Existing credentials or business records changed')
        public=wait_health(PUBLIC,20)
        status_code,_=http(PUBLIC,'/api/meta/ads/status')
        mcp_code,_=http(PUBLIC,'/mcp')
        login_code,_=http(PUBLIC,'/login')
        ads_code,ads_html=http(PUBLIC,'/ads')
        if status_code != 401 or mcp_code != 503 or login_code != 200 or ads_code != 200:
            raise RuntimeError('Authentication or application route smoke check failed')
        js_paths=re.findall(r'src="(/assets/[^\"]+\.js)"',ads_html.decode())
        if not js_paths:
            raise RuntimeError('No application bundle found')
        js_code,bundle=http(PUBLIC,js_paths[0])
        if js_code != 200 or '광고 관리'.encode() not in bundle or b'/api/meta/ads' not in bundle:
            raise RuntimeError('New ads application bundle not served')
        report={'sourceSha':SOURCE_SHA,'version':'0.2.0','result':'deployed','localHealth':local,'publicHealth':public,'adsUnauthorizedStatus':status_code,'mcpDisabledStatus':mcp_code,'loginStatus':login_code,'adsPageStatus':ads_code,'adsBundleVerified':True,'databaseContainerPreserved':True,'mediaVolumePreserved':True,'ownerCredentialsPreserved':True,'snsConnectionCredentialsPreserved':True,'recordCountsNotDecreased':True,'adsExecutionEnabled':False,'mcpConfigured':False,'metaWritesPerformed':False,'paidAdLaunched':False,'rollbackDirectory':str(previous),'databaseBackupStoredOnServer':True}
        (release/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print('HAAR_ROLLOUT_REPORT='+json.dumps(report),flush=True)
    except BaseException:
        if moved_old:
            print('Verification failed; restoring previous application image and directory.',flush=True)
            if APP.exists(): APP.rename(failed)
            previous.rename(APP)
            compose(APP,'up','-d','--no-deps','--no-build','app')
            for _ in range(45):
                try:
                    code,data=http(BASE,'/api/health')
                    if code==200 and json.loads(data).get('status')=='ok':
                        print('Previous application health restored. Database and media volumes were not replaced.',flush=True)
                        break
                except (OSError,ValueError): pass
                time.sleep(2)
            else:
                print('ROLLBACK HEALTH UNCONFIRMED: operator attention required.',flush=True)
        raise

if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit('Expected run ID and archive SHA256')
    deploy(sys.argv[1],sys.argv[2])
