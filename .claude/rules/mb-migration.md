---
paths:
  - "src/migrations/**"
  - "src/config/mbWebUrl.ts"
  - "docs/mb-data-migration.md"
---

# Legacy MB notice and data migration

Read this rule before you change the legacy MB notice, its backup export, or `mbWebUrl`.

`src/Root.tsx` (rendered by the `src/main.tsx` entry) mounts the workbench for ordinary hashes and lazily mounts `src/migrations/LegacyMbMigration.tsx` for case-insensitive `#MB-Web`/`#/mb-web`. The legacy notice offers a bounded, read-only backup of old notes and aliases and a configured fixed destination; it performs no auth probe or Core operation. Returning to the workbench runs its normal auth probe and fails closed if the probe is unavailable. The paper business application and its tests are in private `dikw-mbweb`, consuming exact npm `0.1.0`. The public build checks source, static assets, bundle modules and sourcemap paths against the former business boundary.
The legacy notice offers an explicit local JSON backup of old notes and paper
aliases; see `docs/mb-data-migration.md`. It never exports credentials, cache or
panel state, and never deletes old bytes. The private Settings/import/export UI
was retired by the maintainer; do not promise an import entry. Optional branding
`mbWebUrl` is a fixed HTTP(S) URL without credentials, query or fragment; legacy
URL state is never forwarded. Shared packages use public MIT cohort `0.1.2`;
the private application keeps its exact accepted registry cohort until a separate
dependency upgrade is verified and delivered.
