"""Integration checks using an isolated file and test server; no external database writes."""
import concurrent.futures,json,os,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def call(port,path,method='GET',data=None,token='test-observer-token-long-enough'):
 req=urllib.request.Request(f'http://127.0.0.1:{port}{path}',data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','X-Observer-Token':token})
 try:
  with urllib.request.urlopen(req,timeout=20) as r:return r.status,r.headers,r.read()
 except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
def start(port,**extra):
 env={k:v for k,v in os.environ.items() if k not in ['DATABASE_URL','NODE_ENV','RENDER']};env.update(PORT=str(port),**extra)
 proc=subprocess.Popen(['node','server.js'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for _ in range(120):
  try:call(port,'/api/health');return proc
  except OSError:time.sleep(.1)
 proc.terminate();raise RuntimeError('Server did not start')
def stop(p):p.terminate();p.wait(timeout=10)
with tempfile.TemporaryDirectory(dir=ROOT) as temp:
 file=str(Path(temp)/'observations.json');p=start(3091,LOCAL_DATA_FILE=file)
 try:
  for path in ['/app.js','/translations.js','/hazard-model.js','/sw.js','/manifest.webmanifest','/assets/flags/aran.svg']:
   status,headers,body=call(3091,path);assert status==200 and not body.lstrip().startswith(b'<!DOCTYPE'),path
  assert call(3091,'/assets/missing.jpg')[0]==404
  assert call(3091,'/api/unknown')[0]==404
  body={'type':'trip_report','lat':42.5,'lng':1.2,'details':{'title':'Integration test','notes':'Test record','observedAt':'2026-01-01T12:00:00Z','aspect':'','elevation':None,'slope':None}}
  # Permanent events survive season filtering; use avalanche with valid categorical fields.
  body['type']='avalanche';body['details'].update(avalancheSize='2',avalancheCharacter='Wind slab',trigger='Natural')
  with concurrent.futures.ThreadPoolExecutor() as ex:
   results=list(ex.map(lambda _:call(3091,'/api/observations','POST',body),range(8)))
  assert all(r[0]==201 for r in results)
  saved=json.loads(call(3091,'/api/observations')[2]);assert len(saved['features'])==8
  id=saved['features'][0]['properties']['id']
  assert call(3091,f'/api/observations/{id}','DELETE',token='wrong-observer-token-long-enough')[0]==403
  invalid=json.loads(json.dumps(body));invalid['details']['slope']=91
  assert call(3091,'/api/observations','POST',invalid)[0]==400
 finally:stop(p)
 p=start(3091,LOCAL_DATA_FILE=file)
 try:assert len(json.loads(call(3091,'/api/observations')[2])['features'])==8
 finally:stop(p)
 p=start(3092,NODE_ENV='production',LOCAL_DATA_FILE=str(Path(temp)/'must-not-exist.json'))
 try:
  assert call(3092,'/api/health')[0]==503
  assert call(3092,'/api/observations')[0]==503
  assert call(3092,'/api/observations','POST',body)[0]==503
  assert not (Path(temp)/'must-not-exist.json').exists()
 finally:stop(p)
 p=start(3093,DATABASE_URL='postgresql://invalid:invalid@127.0.0.1:1/invalid',LOCAL_DATA_FILE=str(Path(temp)/'also-must-not-exist.json'))
 try:
  assert call(3093,'/api/observations','POST',body)[0]==503
  assert not (Path(temp)/'also-must-not-exist.json').exists()
 finally:stop(p)
print('PASS: static routing, unknown terrain, validation, concurrent writes, restart persistence, ownership, production/database failure guards')
