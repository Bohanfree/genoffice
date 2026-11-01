Updates the fork to upstream v0.12.446 and adds a pinned Windows x64 adapter preserving:

- Official-document paragraph layout, preview, font substitution and restore.
- Word and Excel table beautification, preserved content/formulas and undo.
- Explicit PDF OCR, cancellation/resume and full-content local cache reuse. Opening a PDF does not start OCR.

This download is the enhancement source and compatibility recipe, with checksums. It is **not a complete application installer**. Fetch the pinned official Windows baseline separately, then generate and install the overlay using `bohan-enhancements/README.md`. Keep an application and user-data backup. The official executable and host archive remain unchanged.

Portable preservation tests and native Docs/Sheets/PDF renderer tests run before publication, along with exact overlay-hash and repatching guards. The old macOS adapters remain available. WebDAV backup is documented as a proposal and is not enabled in this release.

Revision 2 also fixes an upstream 446 PDF initialization error that blanked the view after recognizing or restoring cached OCR text. The native regression test executes the actual component hook sequence with a cached page.
