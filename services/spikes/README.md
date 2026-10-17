# Spikes

Throwaway experiments against a2a-sdk 1.2.2 / A2A v1.0. Findings are summarized in `docs/HANDOFF.md`.
Not part of the product, excluded from lint and tests. Note: these use an earlier prediction-based
context format, not the current `ambient/schemas.py`.

- `01_extension_and_approval.py` — extension header negotiation, metadata validation, INPUT_REQUIRED approval round-trip
- `02_subscription_scope_chain.py` — streaming subscription Task, caller-scoped disclosure, Room→Desktop chaining,
  and the SubscribeToTask/GetTask bypass of executor-level permission checks
