# Shared client extraction verification

The first application split increment extracts public client protocols and
browser utilities into `@opendikw/web-client`. Both existing frontends remain
available. Shared UI/server extraction, the private application, migration and
registry publication are subsequent increments.

## Baseline

Before implementation: 85 Vitest files / 1,136 tests passed; 57 Playwright tests
passed and two existing opt-in live tests were skipped. Initial concurrent cold
ADK initialization timed out in three tests; the isolated 29-test rerun and full
baseline rerun passed without changing tests or timeouts.

## Result

- Existing assertions in the 14 moved test files are retained. The
  [migration manifest](mbweb-test-migration.json) records source/destination paths.
- `npm run verify`: lint, format, typecheck, 87 Vitest files / 1,139 tests,
  coverage, browser/server builds, 57 Playwright tests and independent packed
  consumer all passed. The two existing optional live tests remain skipped.
- Coverage: statements 77.40%, branches 67.33%, functions 77.22%, lines 79.25%.
  Existing thresholds remain 60/45/55/60. Test-mode aliases resolve public
  client entries to source; production resolves compiled exports.
- Targeted Markdown source coverage: 83.49% statements, 67.12% branches,
  100% functions, 83.33% lines. Parser assertions remain counted after extraction.
- Bundle gzip: entry JS 277.5 KB / 280 KB; total JS 1,853.2 KB / 1,950 KB;
  CSS 30.4 KB / 35 KB.
- `verify:packages` installs the tarball outside the repository. It validates
  Node imports without DOM, HTTP headers/results, NDJSON, archive round-trip,
  browser cache fallback and NodeNext declarations. Package source deep imports
  are rejected by exports. Root React/Vite cannot satisfy fixture dependencies.
- Shared packages have MIT licensing and an explicit compiled-files allowlist.
  Docker copies the workspace manifest before installation and the compiled
  package into the runtime image beside its workspace link.
- Production npm audit has no HIGH/CRITICAL vulnerabilities.

The independent reviewer identified build ordering for live entry points,
parser source coverage and consumer isolation. All were accepted and fixed;
the second review passed with no new actionable findings. Browser regression
also exposed a mock matching an Agent package asset; the API matcher now checks
the actual `/agent/` pathname. Its response logic and assertions are retained.

Docker image execution and real Core/Casdoor integration are not claimed here.
Docker Desktop was started, but its engine had not become reachable locally.
Public CI's existing image build/Trivy job remains required. npm publication
awaits scope/account configuration and the later package release increment.
