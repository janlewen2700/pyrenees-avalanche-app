# Avalanche ML research pipeline

This directory starts the **post-terrain** ML phase without pretending the model is already operational.

## Two different modelling problems

### A. Static terrain susceptibility / exposure

Predict whether terrain resembles known avalanche release/path/runout terrain using DEM-derived features, forest/roughness, historical mapped extents and expert terrain maps. CLPA/BDAC-style mapped extents are especially useful here even when an exact event date is unavailable.

### B. Dynamic avalanche activity

Predict the relative probability/rank of avalanche activity for a terrain cell/day using dated avalanche events plus recent weather/snow, official bulletin context and the static terrain features. EPA, dated BDAC observations and normalized community reports are much more useful here.

Do not train “EAWS danger per pixel”. The official regional bulletin remains a separate authoritative input/display context.

## Important sampling rule

“No avalanche recorded here” is **not** a trustworthy negative. Inventories are spatially and temporally incomplete. Use presence/background or carefully constructed pseudo-absence samples, keep an explicit `label_kind`, and validate against independent geography/time periods.

## Baseline model suite

`train_models.py` fits three deliberately different scikit-learn baselines:

- Logistic Regression — interpretable sanity check.
- Random Forest — nonlinear interactions and robust first tree baseline.
- Histogram Gradient Boosting — stronger nonlinear tabular baseline.

The script uses grouped cross-validation whenever `spatial_block` is present and reports ROC-AUC, average precision and Brier score. It saves the best calibrated-development candidate by average precision; this is **not** a deployment approval.

## Dataset build

`build_training_dataset.py` normalizes event/background CSVs and can enrich rows with Open-Meteo historical/reanalysis weather. It intentionally keeps raw timestamps, source IDs and provenance so leakage and inventory bias can be audited.

Suggested features include:

- static: elevation, slope, sin/cos aspect, curvature, ruggedness, release score, overhead score, runout proxy, forest fraction;
- dynamic weather: snowfall 24/72 h, rain 24 h, temperatures, warming, wind speed/gust/direction, solar radiation, snow depth;
- interaction: lee loading from wind direction × terrain aspect;
- bulletin: regional danger, problem type, affected aspects/elevation where machine-readable;
- observations: recent nearby avalanches/red flags with distance/time decay and confidence weights.

## Leakage-resistant validation

A random row split is not sufficient because neighbouring cells share terrain and weather. At minimum:

1. build 5–20 km `spatial_block` IDs;
2. hold out complete blocks/valleys;
3. perform a final **winter-season holdout** that the model never sees during tuning;
4. report performance separately by country/provider and danger level;
5. calibrate probabilities only after the ranking model is stable.

## Run

```bash
pip install -r requirements.txt
python build_training_dataset.py --events data/events.csv --background data/background.csv --out data/training.csv
python train_models.py --data data/training.csv --output models
```
