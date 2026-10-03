# Shared server extraction verification

The third split increment adds the MIT-licensed `@opendikw/web-server` package.
The workbench now consumes its runtime, explicit outbound instrumentation and
optional Vite entries. The application entry retains ownership of listening and
shutdown. The MB application remains in the workbench during this increment;
its independent server profile is implemented and tested before extraction.

## Public boundary and retained behavior

The migration manifest records every existing auth, Agent, web-job and shared
server test destination. Existing assertions are retained, including #204 job
ownership and #205 sliding refresh, role changes, expiry and logout races. Auth
and Agent SQLite schemas remain unchanged.

A real HTTP integration fixture runs two independently configured runtimes,
an OIDC issuer, a Core HTTP server and an Anthropic-compatible streaming model.
It checks viewer/editor permissions, separate cookies and sessions, job ownership,
server-owned Core credentials, allowed upload/read operations and rejected MB
management, proposal, trace, unknown API and malformed-path requests. The
workbench retains its management routes. A separate Vite integration checks that
the MB guard runs before the Core proxy and sidecars.

Runtime imports do not register shutdown hooks or create application storage.
Each factory owns its auth SQLite store, Agent ORM and jobs. Agent initialization
is completed before simultaneous first requests. Closing aborts active Agent
and Core proxy requests, cancels jobs, drains pending handlers and releases the
SQLite connections; closing twice is safe.

Independent review identified a Core tool request that ignored the Agent abort
signal. The public integration test reproduced a hung shutdown before the fix.
Both page reads and retrieval now propagate the signal, and additional behavior
tests verify cancellation of waiting operations. The integration also confirms
that a hanging Core long-poll and Agent page read release their sockets on close.

The follow-up review identified concurrent turns overwriting a session's abort
controller and late admission after an awaited request body. Each session now
tracks all active turns, and shutdown cancellation remains active for late turns.
The public test runs two hanging reads in the same session; a separate partial
JSON request test verifies that shutdown disconnects unread bodies. The Core
proxy also rejects late requests after closure rather than opening new upstream
connections. Each regression failed before its corresponding fix.

## Package installation

The final deterministic run passes 94 Vitest files / 1,216 tests, with coverage
77.31% statements, 67.76% branches, 77.44% functions and 79.08% lines. Thresholds
remain 60/45/55/60. The final Windows coverage run uses one worker: a two-worker
run timed out in the existing ADK compaction and dependency-install-script
checks, and both checks passed separately without changing their timeout or
assertions. Lint, formatting, typecheck and production builds pass.
The browser suite passes 57 tests; two existing opt-in network cases are skipped.
Bundle gzip remains 277.4 KB entry JS / 280 KB, 1,853.1 KB total JS / 1,950 KB and
30.4 KB CSS / 35 KB. No gate, coverage or retry policy is weakened.

Actual tarballs are installed outside this repository. A standalone server
consumer has no React, UI package or Vite installed. It imports the runtime and
instrumentation, exercises HTTP and SQLite restart persistence, closes its
resources and removes its owned storage directory. Its declarations compile
under strict TypeScript 6 / NodeNext with `skipLibCheck: false`. The optional
Vite entry is separately compiled by a consumer with its own Vite installation.
The client and UI consumers still verify all public entries, reader assets,
Context permissions and theme behavior.

## Deployment verification limits

Dockerfiles install all workspace manifests before `npm ci` and copy compiled
package outputs into the production image. Local Docker Desktop does not answer
its engine API, so local production image execution and real Casdoor verification
remain pending. OIDC fixtures validate the protocol, roles and session behavior;
they are not reported as a real Casdoor deployment. The preceding UI increment
records both existing applications rendering a real, isolated Core base in light
and dark, including the unchanged reader assets and theme controls.

The shared packages are not published to npm in this increment. Registry
authentication and scope permissions are still required for the candidate
release and the private application's registry-only clone verification.
