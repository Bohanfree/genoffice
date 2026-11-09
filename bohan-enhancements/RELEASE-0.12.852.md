# Bohan enhancements for GenOffice 0.12.852 on macOS ARM64

This source release adapts the existing official-document layout, Word and Excel table beautification, manual cached PDF OCR, WebDAV cloud folders and history, and macOS SMB save fallback to the official 0.12.852 ARM64 package.

The generator verifies the clean package's renderer, host archive, and affected preload hashes before producing a 25-file overlay and manifest. It rejects unknown, mixed, and already modified inputs. The PDF adapter uses the new renderer's byte-reading path and preserves manual-only OCR and cached-page reuse.

Local acceptance covered portable preservation, undo, WebDAV and credential tests; the shipped Docs/Sheets/PDF renderer tests; SMB fallback/error simulations; overlay hashes; and app-level formatting and saving of fictional DOCX/XLSX files plus manual OCR of a sample PDF. The cloud-folder entry appeared in the application. Reauthorize any existing macOS Keychain item if requested after the signing identity changes.

The release contains enhancement source, compatibility recipes and tests. Obtain the matching official macOS ARM64 package separately. Applying the overlay invalidates the official resource signature; validate an appropriate local signature and back up the old application and its user data before replacement. User documents, configuration, credentials, application bundles and official installers are excluded.
