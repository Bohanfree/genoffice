# WebDAV automatic document backup — proposed, not implemented

Decision on 2026-11-01: update GenOffice and preserve existing enhancements first. Keep WebDAV at the design stage for this release.

## User-visible behavior

After the user enables automatic backup and configures a WebDAV destination, opening an existing file queues a background upload of its saved bytes. A successful save or Save As queues the latest saved version. Unsaved editor changes stay in local recovery storage. Opening and saving do not wait for the network. Keep the local original, autosave recovery and PDF OCR cache.

Show queued, uploading, backed up and failed states, with a retry action. Persist the queue across restarts. Offline work continues locally; reconnecting resumes pending uploads. Allow exclusions by directory and a per-document pause. Do not enable uploads merely because a WebDAV account has been entered.

## Data model and transfer

- Identify a document with a device-local mapping and stable opaque document ID; do not expose an absolute local path in remote names.
- Hash saved snapshots with SHA-256 to skip unchanged uploads. Snapshot the bytes first so edits during transfer cannot produce a mixed file.
- Store content versions separately from a small manifest containing original filename, media type, content hash, version and save time. Use device identity to avoid collisions between different devices.
- Upload to a unique temporary object, then promote it with MOVE where supported. Publish the manifest only after the content upload succeeds. Clean incomplete objects with a bounded retry policy.
- Use ETag/If-Match for manifest updates. If the remote version changed, retain both versions and show a conflict instead of silently overwriting either one.
- Keep credentials in the operating-system credential store. Redact credentials and document content from logs. Never commit server settings or secrets.
- Limit concurrent transfers, retry with backoff, cap queued storage, and provide configurable version retention. Do not delete remote versions in the first implementation.

## PDF OCR

Keep the existing full-content SHA-256 and original-page index. Remote OCR-result sync should be a separate optional feature after document backups are reliable. Opening a PDF continues to restore cached text only; recognition remains an explicit action.

## Integration and acceptance

Put the persistent queue and WebDAV client in the main process. Register hooks for a successfully opened local file and a successfully committed save across all modules. Registering a recent-file entry alone is insufficient: preview attempts and failed opens must not trigger uploads. Do not send local filesystem paths or credentials through the renderer API.

Verify offline open/save, duplicate opens, edits during upload, failed/partial uploads, restart recovery, Save As, same-name documents, large files, ETag conflicts and disabled/excluded documents. Confirm no upload occurs before opt-in and no automatic PDF OCR is introduced.
