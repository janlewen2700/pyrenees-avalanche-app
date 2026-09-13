#!/usr/bin/env python3
"""Train three avalanche baselines with leakage-resistant spatial / winter holdouts."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import joblib, numpy as np, pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NON_FEATURE={"label","label_kind","observed_at","lat","lon","x","y","source_event_id","source_url","spatial_block","valley_id","season_year","geometry","source"}

def read_table(path:Path): return pd.read_parquet(path) if path.suffix.lower() in {'.parquet','.pq'} else pd.read_csv(path)
def score(y,p):
    return {"average_precision":float(average_precision_score(y,p)),"brier":float(brier_score_loss(y,p)),"roc_auc":float(roc_auc_score(y,p)) if len(np.unique(y))>1 else None,"n":int(len(y)),"positives":int(np.sum(y))}

def make_models():
    return {
      "logistic":LogisticRegression(max_iter=2500,class_weight='balanced',C=.5),
      "random_forest":RandomForestClassifier(n_estimators=600,min_samples_leaf=4,class_weight='balanced_subsample',n_jobs=-1,random_state=42),
      "hist_gradient_boosting":HistGradientBoostingClassifier(max_iter=350,learning_rate=.05,max_leaf_nodes=31,l2_regularization=1.0,random_state=42)
    }

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--data',required=True,type=Path); ap.add_argument('--output',required=True,type=Path)
    ap.add_argument('--holdout-valley',help='Exact valley_id or spatial_block held out completely.')
    ap.add_argument('--holdout-season',type=int,help='season_year held out completely, e.g. 2024 for winter 2024/25.')
    a=ap.parse_args(); df=read_table(a.data)
    if 'label' not in df or df.label.nunique()<2: raise SystemExit('Need both label classes.')
    group_col='valley_id' if 'valley_id' in df else ('spatial_block' if 'spatial_block' in df else None)
    hold=np.zeros(len(df),dtype=bool); hold_notes=[]
    if a.holdout_valley:
        if not group_col: raise SystemExit('--holdout-valley requires valley_id or spatial_block.')
        hold |= df[group_col].astype(str).eq(str(a.holdout_valley)).to_numpy(); hold_notes.append(f'{group_col}={a.holdout_valley}')
    if a.holdout_season is not None:
        if 'season_year' not in df: raise SystemExit('--holdout-season requires season_year.')
        hold |= pd.to_numeric(df.season_year,errors='coerce').eq(a.holdout_season).to_numpy(); hold_notes.append(f'season_year={a.holdout_season}')
    # If no explicit holdout is supplied, reserve one entire spatial group as a development spatial holdout.
    if not hold.any() and group_col:
        counts=df.groupby(group_col).label.agg(['count','sum']); eligible=counts[(counts['sum']>0)&((counts['count']-counts['sum'])>0)]
        if len(eligible):
            chosen=str(eligible.sort_values('count',ascending=False).index[0]); hold=df[group_col].astype(str).eq(chosen).to_numpy(); hold_notes.append(f'auto {group_col}={chosen}')
    train=df.loc[~hold].copy(); test=df.loc[hold].copy()
    if train.label.nunique()<2: raise SystemExit('Training split lost a class; choose another holdout.')
    features=[c for c in df.columns if c not in NON_FEATURE]
    Xtr,ytr=train[features],train.label.astype(int).to_numpy(); Xte,yte=test[features],test.label.astype(int).to_numpy() if len(test) else (None,None)
    cat=[c for c in features if Xtr[c].dtype=='object']; num=[c for c in features if c not in cat]
    prep=ColumnTransformer([('num',Pipeline([('imp',SimpleImputer(strategy='median')),('scale',StandardScaler())]),num),('cat',Pipeline([('imp',SimpleImputer(strategy='most_frequent')),('oh',OneHotEncoder(handle_unknown='ignore',sparse_output=False))]),cat)])
    results={}; fitted={}
    for name,est in make_models().items():
        pipe=Pipeline([('prep',prep),('model',est)]); pipe.fit(Xtr,ytr); fitted[name]=pipe
        r={'train':score(ytr,pipe.predict_proba(Xtr)[:,1])}
        if len(test) and test.label.nunique()>=2: r['holdout']=score(yte,pipe.predict_proba(Xte)[:,1])
        else: r['holdout']={'warning':'No valid two-class holdout was available. Supply --holdout-valley and/or --holdout-season.'}
        results[name]=r
    rank=lambda n: results[n].get('holdout',{}).get('average_precision',results[n]['train']['average_precision'])
    best=max(results,key=rank); a.output.mkdir(parents=True,exist_ok=True)
    joblib.dump({'pipeline':fitted[best],'feature_columns':features,'model_name':best},a.output/'candidate.joblib')
    report={'warning':'Research only. A holdout score is not deployment approval. Validate on independent valleys AND winters before any public safety use.','holdout':hold_notes,'best_model':best,'results':results}
    (a.output/'metrics.json').write_text(json.dumps(report,indent=2)); print(json.dumps(report,indent=2))
if __name__=='__main__': main()
