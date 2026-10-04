# MB legacy local backup

`#MB-Web` (also `#/mb-web`, case-insensitive) opens a minimal Chinese notice.
**导出旧笔记与论文别名** downloads `dikw-mbweb-migration.json` as a local backup.
This is an explicit local operation: it does not call Core, delete old data,
export credentials, or automatically move browser data between origins.

The JSON envelope has `schema: "dikw-mbweb-migration"`, `version: 1`, `notes`
and `paperNames`. Only the two existing local keys `dikw-mb.notes` and
`dikw-mb.paperNames` are read. A malformed note array or alias object is rejected
without modifying the original bytes. The file is limited to 10 MiB of UTF-8
and 10,000 notes.

The maintainer explicitly retired the private app's Settings and import/export
UI in private PR #6. Its existing account-scoped notes and aliases remain intact.
There is no current import entry for this downloaded file. Retain it and the
original browser bytes as a backup; the notice does not promise an import UI.

Browser local storage belongs to an origin. Redirecting to the new app cannot
read the old origin's notes. This download does not move records between origins.
The private app partitions records by verified OIDC issuer, subject and a stable
public Core ID; unidentified legacy data is never assigned to the first user.

## Legacy entry

Optional `mbWebUrl` in `/config.json` provides the fixed destination for the
minimal legacy migration screen. It must be an absolute HTTP(S) URL without
credentials, query or fragment. An invalid value is treated as unconfigured.
The old page's query, fragment and credentials are never appended to this target.
The screen retains the export action even if no target has been configured.

The notice works without an auth probe or Core connection. It follows the
workbench's theme preference and uses Chinese document language; workbench
locale handling applies when navigating back. Source, static assets, bundled
modules and sourcemap paths are checked against the finite former business
boundary. Shared MB profiles and this exporter intentionally remain public.
Public CI does not check out the private repository or receive its credentials.
The transfer ledger is `docs/verification/mbweb-test-migration.json`.
