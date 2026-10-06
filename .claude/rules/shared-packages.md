---
paths:
  - "packages/*/package.json"
  - "packages/*/src/**"
  - "package.json"
  - "scripts/*{shared,package,registry}*.mjs"
  - ".github/workflows/publish-packages.yml"
  - "docs/shared-packages.md"
---

# Shared npm packages

Read this rule before you change a package under `packages/`, its version, or its publish flow.

The root is an npm workspace application. Shared browser protocols and tools live
in `packages/web-client` (MIT) and are consumed through `@opendikw/web-client`
subpath exports; do not import package source paths or restore copies under `src`.
Shared releases use `version:shared` to keep the three package/internal dependency
versions aligned, followed by a lockfile update and full verification. `publish:shared`
accepts only clean-commit verified artifacts; `verify:registry` validates downloaded
bytes and independent consumers. `.github/workflows/publish-packages.yml` uses npm
trusted publishing after authenticated bootstrap; see `docs/shared-packages.md`.

Dev, typecheck, test and build explicitly run `build:packages`; direct Vitest
iteration needs a package build after source changes. `verify:packages` installs
real tarballs in an independent consumer. Package source and migrated tests remain
in the root coverage/test discovery, with the existing thresholds unchanged.
