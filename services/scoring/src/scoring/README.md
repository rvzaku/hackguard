"""HackGuard scoring sidecar package.

Modules:
- config          env-driven settings (incl. pinned model version/dir)
- contracts_gen   GENERATED from packages/contracts/openapi.json — do not edit
- preprocessing   payment→model feature mapping (shared with training)
- policy          published-prior timing factors (cited, deterministic)
- model_registry  versioned artifact loading, pinned by version
- inference       propensity + TreeSHAP + per-moment P(recover)
- api_models      sidecar-local request/response models
- main            FastAPI app (/healthz, /v1/score, /v1/score/moments)

Methodology: docs/MODEL.md. Training: models/propensity/train.py via
`npm run model:train` / `npm run model:train:full`.
"""
