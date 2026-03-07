# Desktop MVP Smoke

The smoke runner is `pnpm smoke`.

It exercises the desktop MVP flow through OpenAPI endpoints:
- create resume
- edit resume
- export resume JSON
- import resume JSON
- export resume PDF (or verify the expected graceful runtime-missing error)

Artifacts are written to `tests/.artifacts/` while the suite runs.
