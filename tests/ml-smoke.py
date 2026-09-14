"""Synthetic data checks program behaviour only; these are not avalanche validation."""
import importlib.util,subprocess,tempfile,json
from pathlib import Path
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
 tmp=Path(tmp);rng=np.random.default_rng(4);n=100
 df=pd.DataFrame({'label':[0,1]*(n//2),'spatial_block':['west']*50+['east']*50,'slope_deg':rng.uniform(10,50,n),'elevation_m':rng.uniform(1000,3000,n)})
 path=tmp/'synthetic.csv';df.to_csv(path,index=False)
 base=['python',str(ROOT/'ml/train_models.py'),'--data',str(path),'--output',str(tmp/'model'),'--features','slope_deg,elevation_m']
 result=subprocess.run(base+['--holdout-valley','missing'],capture_output=True,text=True);assert result.returncode!=0 and 'matches no rows' in result.stderr
 result=subprocess.run(base+['--holdout-valley','east'],capture_output=True,text=True);assert result.returncode==0,result.stderr
 metrics=json.loads((tmp/'model/metrics.json').read_text());assert all('average_precision' in m['holdout'] for m in metrics['results'].values())
 df['spatial_block']='one';df.to_csv(path,index=False)
 assert subprocess.run(base,capture_output=True).returncode!=0
spec=importlib.util.spec_from_file_location('dataset',ROOT/'ml/build_training_dataset.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Response:
 def raise_for_status(self):pass
 def json(self):return {'hourly':{'time':['2026-01-01T10:00','2026-01-01T11:00','2026-01-01T12:00'],'wind_direction_10m':[350,10,180],'snowfall':[None,None,100]}}
class Session:
 def get(self,*a,**k):return Response()
w=mod.fetch_weather(42.5,1.2,pd.Timestamp('2026-01-01T12:00Z'),Session())
assert np.isnan(w['snowfall_24h_cm'])
assert min(abs(w['wind_dir_mean_24h_deg']),abs(w['wind_dir_mean_24h_deg']-360))<1e-5
print('PASS: holdout guards, three-model synthetic training, missing precipitation, pre-event cutoff, circular wind mean')
