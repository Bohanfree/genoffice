Revision 4 replaces opaque WebDAV backup trees with ordinary, directly usable document files to Windows GenOffice 0.12.446 while preserving:

- Official-document paragraph layout, preview, font substitution and restore.
- Word and Excel table beautification, preserved content/formulas and undo.
- Explicit PDF OCR, cancellation/resume and full-content local cache reuse. Opening a PDF does not start OCR.

After explicit setup, successful opens and saves queue saved-file snapshots in the background. Unchanged files are skipped, offline tasks survive restarts, and saves update the same original filename. Different sources with the same name receive numeric suffixes. Remote-edit conflicts retain remote content and local snapshots and stop that document's queue. Existing backups-v1 content remains untouched. Local originals, recovery storage and PDF OCR caches remain in place. The application menu provides backup status, retry, pause, exclusions and setup.

Every configuration run requires manual hidden password input; passwords are stored only in Windows Credential Manager, never ordinary configuration or this repository. No personal server settings are supplied. Backup is disabled until configured and enabled. Defaults: 512 MiB per file, 2 GiB pending snapshots, one upload at a time. No historical recent-file backfill, remote version deletion, two-way sync or OCR-result sync.

This download contains enhancement source, compatibility recipes, tests and checksums. It is **not a complete installer**. Obtain the pinned official Windows baseline separately and follow `bohan-enhancements/README.md` to generate/install all 21 overlay files. Back up the application and user data first. The Windows host/preloads are hash-pinned and minimally adapted for backup; the official executable is unchanged. Historical macOS adapters stay pinned and do not gain Windows WebDAV support.

Validation includes formatting preservation and undo, shipped Docs/Sheets/PDF behavior, exact overlay hashes and rejection of modified inputs, plus WebDAV protocol tests for offline restart, repeated saves, conflicts, same-name collisions, large binary lost-response recovery, schema migration and damaged snapshots. Release artifacts exclude official installers, user files, profiles, server settings and credentials.

Revision 2 also fixes an upstream 446 PDF initialization error that blanked the view after recognizing or restoring cached OCR text. The native regression test executes the actual component hook sequence with a cached page.
