# WebDAV automatic document backup — Windows 0.12.446 revision 3

Implemented after explicit user opt-in on 2026-11-01. This supersedes the earlier design-only decision for this revision. Historical macOS adapters stay pinned and do not gain Windows WebDAV support.

## User-visible behavior

After the user enables automatic backup and configures a WebDAV destination, opening an existing file queues a background upload of its saved bytes. A successful save or Save As queues the latest saved version. Unsaved editor changes stay in local recovery storage. Opening and saving do not wait for the network. Keep the local original, autosave recovery and PDF OCR cache.

The application menu → WebDAV 备份 shows queue status, errors/conflicts, retry, global pause, current-file pause and directory exclusion/restoration. Automatic uploads remain disabled when configuration is absent. Pending snapshots survive restart. Pausing a file/folder leaves its existing queue local until resumed. There is no historical recent-file scan; only newly opened/saved files trigger snapshots.

## Configuration and passwords

Choose 配置 WebDAV（手动输入密码） in that menu, supply an HTTPS folder URL and account, enter the hidden password manually, type YES to enable, then restart. Every reconfiguration requires new manual password input, including after updates/deployments. Ordinary restarts reuse Windows Credential Manager. The wizard accepts no password argument and never imports a password from a file. Configuration JSON contains no password. No personal endpoint/account ships in the fork. Keep private user-data out of source control.

The credential helper's Read action is an internal parent-process pipe, not an interactive status command. The application's helper subprocess uses its own execution policy; it does not modify the machine or user execution-policy setting. Credentials never pass through renderer code.

## Data model and transfer

- Identify a document with a device-local mapping and stable opaque document ID; do not expose an absolute local path in remote names.
- Hash saved snapshots with SHA-256 to skip unchanged uploads. Snapshot the bytes first so edits during transfer cannot produce a mixed file.
- Store content versions separately from a small manifest containing original basename, bytes, content hash, version and capture time. Use device identity to avoid collisions between different devices.
- Remote namespace: `backups-v1/<device UUID>/<document UUID>/versions/<task UUID>-<sha256>.<extension>`, with conditional `latest.json`. Temporary uploads have task-specific names. Each retry cleans only its own abandoned object; failed transfers attempt bounded cleanup. Promote with MOVE where supported, otherwise conditional PUT. Publish the manifest only after content succeeds.
- Use ETag/If-Match for manifest updates. If the remote version changed, retain both versions and show a conflict instead of silently overwriting either one.
- Keep credentials in the operating-system credential store. Redact credentials and document content from logs. Never commit server settings or secrets.
- One upload at a time; retry from 10 seconds up to 5 minutes. Default caps: 512 MiB per file and 2 GiB pending snapshots. Full queue/unstable file errors appear in status; reopen/save after resolving them to retry capture. App exit waits for pending local captures, not the network. Keep 100 completed history entries locally and remove completed local snapshots; remote versions are never automatically deleted.
- The local queue uses atomic JSON writes and immutable SHA-256 snapshots. Startup cleans only its own unreferenced snapshot files. Damaged identifiers fail closed. Changing endpoint/account cannot redirect an existing pending queue; drain it before reconfiguration.
- ETag conflicts keep both the immutable remote version and local snapshot and block that document's later tasks. Retry never silently overwrites conflicts. A lost successful manifest response is reconciled only if the remote version/hash/device/document match that exact task. Missing ETags block subsequent updates.

## PDF OCR

Keep the existing full-content SHA-256 and original-page index. Remote OCR-result sync should be a separate optional feature after document backups are reliable. Opening a PDF continues to restore cached text only; recognition remains an explicit action.

## Integration and acceptance

The persistent queue and WebDAV client run in the main process. Hooks observe completed native opens/saves. Docs/PDF wait for their renderer to accept the native open, and the acknowledgement path must match the preceding native result. Sheets supplies the original CSV/XLS path through its successful workbook hook. Cancelled/failed/password-pending opens, attachments and recent-file registration never trigger uploads. Credentials stay in the main process and system store. HTTPS validation is required and redirects are not followed.

Verify offline open/save, duplicate opens, edits during upload, failed/partial uploads, restart recovery, Save As, same-name documents, large files, ETag conflicts and disabled/excluded documents. Confirm no upload occurs before opt-in and no automatic PDF OCR is introduced.

Protocol tests also cover A → B → A saves, MOVE fallback, lost commit responses, orphan cleanup, damaged snapshots/IDs, capacity limits and unsafe endpoints. Native acceptance uses fictional files and an isolated profile at an explicitly authorized destination. No runtime profile or server settings appear in release artifacts.

This is backup of saved original files, including originally encrypted files. Unsaved editor edits and PDF OCR caches are not uploaded. Remote restore UI, automatic old-version cleanup, two-way sync and OCR-cache sync remain deferred. Conflicts require manual comparison of retained versions.
