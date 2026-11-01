# WebDAV document backup — Windows 0.12.446 revision 5

## User-visible behavior

After explicit setup, opening a document backs up its saved bytes. A successful
save updates the same remotely named document. The configured destination contains
ordinary files such as `Report.docx`, `Budget.xlsx` and `Scan.pdf`, directly usable
by WebDAV clients. There are no new device/document UUID directories, version
trees or JSON manifests. A different source with the same filename gets a readable
suffix, for example `Report (2).docx`; the local mapping keeps that name on later saves.
Long basenames are shortened to fit a 220-byte UTF-8 component, preserving extension.

The experience is informed by a limited [REA analysis of WPS](verification/WPS-BACKUP-REFERENCE.md).
This is saved-document backup, not two-way cloud sync. Local originals, recovery
storage and manual PDF OCR caches remain. Unsaved edits and OCR caches are not uploaded.
No recent-file scan or bulk historical upload runs. Only successful opens/saves
capture new snapshots. Local deletion never deletes a remote backup.

The WebDAV menu shows status, retry, global/file pause and directory exclusions.
The status dialog identifies enhancement revision 5. Offline tasks survive restart.
The old `backups-v1` tree remains untouched. Local schema 1 queues are backed up
before conversion: pending snapshots resume under readable names, while old
manifest ETags and dedup hashes are cleared. Previously completed documents are
backed up in the new layout the next time they are opened or saved.

## Configuration and passwords

Choose WebDAV 备份 → 配置 WebDAV（手动输入密码）, use the displayed preset backup URL, enter the account and manually enter the
hidden password to enable, then restart. No URL or YES entry is required. The
personal fork supplies the user-requested default URL; operators may override it
with the explicit -Endpoint parameter.
Every reconfiguration, including during updates/deployment, requires new manual
password input. Ordinary restarts reuse Windows Credential Manager. The wizard
accepts no password argument or password file. JSON stores only the URL, account,
credential-store reference and backup preferences. The default destination URL ships in this personal fork at the user's request; accounts, passwords and private runtime settings do not. The helper's Read action is an internal parent-process pipe and must
never be used as an interactive status command. Credentials stay in the main process.
The helper's execution policy applies only to that subprocess.

## Transfer and collision handling

Capture and SHA-256 hash a stable local snapshot before uploading. Unchanged bytes
are skipped; A → B → A saves remain ordered. Only one upload runs at once. A new
remote file uses `If-None-Match: *`. A known file updates with `If-Match` and its
previous ETag. An existing same-name remote file is never adopted by a new source,
even if its bytes match; assign a numeric suffix instead. Assigned names and write
intent are persisted before writes.

After a disconnect/crash may have hidden a successful PUT, stream-download the
assigned file and compare its size and full SHA-256 before acknowledging it. This
also works for binary files larger than the small textual-response limit. A known
remote edit produces a conflict: keep the remote file and the durable local
snapshot, block later uploads for that document, and show it in status for manual
comparison. Retry never silently overwrites a conflict. Missing ETags prevent a
subsequent overwrite. PUT atomicity depends on the WebDAV server; incomplete or
uncertain writes retain local snapshots for recovery. No remote temporary objects
or old-version cleanup are needed.

Require HTTPS with certificate validation; do not follow redirects. Default limits
are 512 MiB per document and 2 GiB pending snapshots. Retry delays grow from 10 seconds
to 5 minutes. Queue errors remain visible. Exit waits for local captures, not the
network. Keep 100 completed receipts locally and remove only completed/orphaned
local snapshots. Destination/account changes cannot redirect pending queued bytes.

## Integration and validation

Native successful open/save hooks stay unchanged. Docs/PDF wait for renderer parse
acknowledgement; Sheets supplies the saved source path. Cancelled, failed or
password-pending opens do not trigger backup. PDF recognition remains manual.

Tests cover readable UTF-8 names, in-place updates, local and remote name collisions,
offline restart, A → B → A saves, snapshot isolation, conditional conflicts, large
binary lost-response recovery, schema migration, damaged queue/snapshots, capacity,
disabled/excluded documents, hook filtering and unsafe endpoints. The unchanged
formatting/OCR assets and pinned native compatibility checks protect the existing
enhancements. Release artifacts exclude vendor bundles, user documents, evidence
bundles, profiles, personal settings and credentials.
