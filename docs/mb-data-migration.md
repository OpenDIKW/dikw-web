# MB local data migration

The current `#MB-Web` app remains available during the repository split. Its
header action **导出笔记与论文别名** downloads `dikw-mbweb-migration.json`.
This is an explicit local operation: it does not call Core, delete old data,
export credentials, or automatically move browser data between origins.

The JSON envelope has `schema: "dikw-mbweb-migration"`, `version: 1`, `notes`
and `paperNames`. Only the two existing local keys `dikw-mb.notes` and
`dikw-mb.paperNames` are read. A malformed note array or alias object is rejected
without modifying the original bytes. The file is limited to 10 MiB of UTF-8
and 10,000 notes.

In the independent private application, sign in to the intended account and
Core base, open Settings, select the file, review the counts, and explicitly
confirm importing it into that account. The target app validates every field,
keeps current records when IDs or alias paths collide, and makes repeated import
idempotent. Existing Wisdom provenance is retained. Import does not automatically
publish or archive notes in Core. Retain the original file and browser data as a
backup until the result has been checked.

Browser local storage belongs to an origin. Redirecting to the new app cannot
read the old origin's notes, which is why migration uses a downloaded file.
The private app partitions records by verified OIDC issuer, subject and a stable
public Core ID, so each target account must explicitly import its own file.

## Future legacy entry

Optional `mbWebUrl` in `/config.json` prepares the fixed destination for the
minimal legacy migration screen. It must be an absolute HTTP(S) URL without
credentials, query or fragment. An invalid value is treated as unconfigured.
The old page's query, fragment and credentials are never appended to this target.
The screen retains the export action even if no target has been configured.

The bridge is tested but is not mounted in this increment. Removing the old MB
business code waits for the private app's registry lockfile, CI, stable package
cohort, production image and migration acceptance. Public CI does not check out
the private repository or receive its credentials.
