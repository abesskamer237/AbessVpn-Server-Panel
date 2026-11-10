"""Local Docker integration test using the official Xray binary, not an Android test.
Only the disposable benchmark config permits private Docker destinations.
The production routing rules are never changed by this harness.
"""
import json, os, pathlib, secrets, shutil, subprocess, tempfile, time, urllib.request, uuid
root=pathlib.Path(tempfile.mkdtemp(prefix='abess-xray-traffic-'));root.chmod(0o755)
data=root/'data';data.mkdir()
prefix='abess-smoke-'+secrets.token_hex(4)
network=prefix; containers=[]; api=None
image=os.environ.get('XRAY_TEST_IMAGE','ghcr.io/xtls/xray-core:26.7.28')
password=secrets.token_hex(24)
env={**os.environ,'DATABASE_URL':'','ALLOW_INSECURE_TCP':'true','ALLOW_JSON_STORAGE':'true','NODE_ENV':'production','PORT':'3220','DATA_DIR':str(data),'VPN_DOMAIN':'vpn.example.test','ADMIN_EMAIL':'xray-test@example.test','ADMIN_INITIAL_PASSWORD':password,'MASTER_SECRET':secrets.token_hex(32),'TELEGRAM_BOT_TOKEN':''}
def cmd(args,**kwargs):return subprocess.check_output(args,text=True,**kwargs)
def request(route,body=None,token=None):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request('http://127.0.0.1:3220/api/v1/'+route,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 with urllib.request.urlopen(req,timeout=10) as response:return json.load(response)
def container(name,args):
 full=prefix+'-'+name
 cmd(['docker','run','--rm','-d','--name',full,'--network',network,'--network-alias',name]+args)
 containers.append(full);return full
try:
 log=open(root/'api.log','w');api=subprocess.Popen(['node','--import','tsx','server.ts'],env=env,stdout=log,stderr=log)
 for _ in range(100):
  if api.poll() is not None:raise RuntimeError('API startup failed')
  try:request('ping');break
  except OSError:time.sleep(.1)
 token=request('auth/login',{'email':env['ADMIN_EMAIL'],'password':password})['token']
 profile=request('admin/protocol-configs',{'name':'Traffic test','serverHost':'vpn.example.test','sniHost':'vpn.example.test','transport':'tcp','protocol':'vless'},token)['config']
 licence=request('admin/tokens',{'configurationId':profile['id'],'bandwidthGb':1,'days':1,'deviceLimit':1},token)
 records=json.loads((data/'tokens.json').read_text());records[0]['bandwidthUsedGb']=(1024**3-1024)/(1024**3);(data/'tokens.json').write_text(json.dumps(records))
 config=json.loads((data/'xray-config.json').read_text())
 assert any('fc00::/7' in rule.get('ip',[]) for rule in config['routing']['rules'])
 # Private benchmark network only. The real production file remains unchanged.
 config['routing']['rules']=[r for r in config['routing']['rules'] if 'ip' not in r]
 config['log']={'loglevel':'debug'}
 config_file=root/'benchmark-server.json';config_file.write_text(json.dumps(config));config_file.chmod(0o644)
 client={'log':{'loglevel':'debug'},'inbounds':[{'listen':'0.0.0.0','port':10809,'protocol':'http','settings':{}}],'outbounds':[{'protocol':'vless','settings':{'vnext':[{'address':'server','port':10050,'users':[{'id':licence['clientUuid'],'encryption':'none'}]}]},'streamSettings':{'network':'tcp','security':'none'}}]}
 client_file=root/'benchmark-client.json';client_file.write_text(json.dumps(client));client_file.chmod(0o644)
 cmd(['docker','network','create',network])
 web=container('web',['node:22-alpine','node','-e',"require('http').createServer((q,r)=>{r.setHeader('Connection','close');r.end('ABESS-XRAY-SMOKE'.repeat(8192))}).listen(8080,'0.0.0.0')"])
 web_ip=cmd(['docker','inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',web]).strip()
 for outbound in config['outbounds']:
  if outbound.get('tag')=='direct':outbound['settings']['finalRules']=[{'action':'allow','network':'tcp','ip':[web_ip+'/32'],'port':'8080'}]
 config_file.write_text(json.dumps(config))
 server=container('server',['--entrypoint','/usr/local/bin/xray','--mount',f'type=bind,src={config_file},dst=/config.json,readonly',image,'run','-c','/config.json'])
 client_container=container('client',['--entrypoint','/usr/local/bin/xray','--mount',f'type=bind,src={client_file},dst=/config.json,readonly',image,'run','-c','/config.json'])
 time.sleep(1)
 traffic="const net=require('net');let s=net.connect(10809,'client',()=>s.write(['GET http://web:8080/ HTTP/1.1','Host: web:8080','Connection: close','',''].join(String.fromCharCode(13,10))));let body='';s.on('data',c=>{body+=c;if(body.length>2048&&body.includes('ABESS-XRAY-SMOKE')){s.destroy();process.exit(0);}});s.on('error',()=>process.exit(2));s.on('end',()=>process.exit(body.includes('ABESS-XRAY-SMOKE')?0:3));setTimeout(()=>process.exit(4),8000).unref();"
 cmd(['docker','exec',web,'node','-e',traffic])
 snapshot=json.loads(cmd(['docker','exec',server,'/usr/local/bin/xray','api','statsquery','--server=127.0.0.1:10085','-pattern','user>>>']))
 assert sum(int(s.get('value',0)) for s in snapshot.get('stat',[]))>1024
 generation='official-xray-traffic-test';(data/'xray-ready').write_text(generation);snapshot.update(generation=generation,observedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()));(data/'xray-stats.json').write_text(json.dumps(snapshot))
 usage=request('client/telemetry',{'token':licence['token'],'deviceId':'TEST-DEVICE-TRAFFIC'})
 assert usage['status']=='quota_exceeded'
 revised=json.loads((data/'xray-config.json').read_text());assert not revised['inbounds'][0]['settings']['users']
 # Reload the generated no-user config and verify the old UUID no longer forwards.
 revised['routing']['rules']=[r for r in revised['routing']['rules'] if 'ip' not in r]
 for outbound in revised['outbounds']:
  if outbound.get('tag')=='direct':outbound['settings']['finalRules']=[{'action':'allow','network':'tcp','ip':[web_ip+'/32'],'port':'8080'}]
 cmd(['docker','rm','-f',server]);containers.remove(server);config_file.write_text(json.dumps(revised));config_file.chmod(0o644)
 server=container('server',['--entrypoint','/usr/local/bin/xray','--mount',f'type=bind,src={config_file},dst=/config.json,readonly',image,'run','-c','/config.json']);time.sleep(.5)
 denied=subprocess.run(['docker','exec',web,'node','-e',traffic],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=12)
 assert denied.returncode!=0,'exhausted UUID must no longer forward traffic'
 print('Official Xray passed: VLESS traffic, real counters, quota exhaustion and denied forwarding after reload.')
except Exception:
 debug=pathlib.Path('/tmp/abess-xray-debug');debug.mkdir(exist_ok=True)
 for name in containers:
  (debug/(name+'.log')).write_text(subprocess.run(['docker','logs',name],capture_output=True,text=True).stdout+subprocess.run(['docker','logs',name],capture_output=True,text=True).stderr)
 raise
finally:
 for name in reversed(containers):subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 if api:api.terminate();api.wait(timeout=12)
 shutil.rmtree(root)
