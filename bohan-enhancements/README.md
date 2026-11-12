# Bohan Office enhancements

Versioned enhancements for **macOS ARM64 GenOffice 0.12.852** and **Windows x64 and macOS ARM64 GenOffice 0.12.446**, plus historical **macOS 0.12.29 and 0.12.117** adapters. Maintained in the `bohan` branch of [Bohanfree/genoffice](https://github.com/Bohanfree/genoffice). The independent public-document skill stays at [genoffice-official-typeset-skill](https://github.com/Bohanfree/genoffice-official-typeset-skill).

### macOS ARM64 0.12.852 update

The 852 adapter retains official-document layout, Word/Excel table beautification, manual PDF OCR with local cache, WebDAV cloud folders and history, and the macOS SMB save fallback. Generate its 25-file overlay from the clean upstream `GenOffice-0.12.852-arm64.dmg` (SHA-256 `7724ead484688d4bc061dbdfdf1326340b7fb8101c796d2760b2baf63721f52b`):

```sh
python3 bohan-enhancements/stage.py --version 0.12.852 --platform darwin-arm64 \
  --resources /path/to/clean/GenOffice.app/Contents/Resources \
  --output /path/to/new/bohan-overlay
```

The generated manifest pins the clean host, preloads and renderers, and the output hashes. This adapter targets macOS ARM64 only. Applying resources changes the vendor's signed bundle; a locally runnable build needs an appropriate local code signature, including its nested framework libraries. Changing the signing identity may require macOS Keychain authorization to reuse existing `safeStorage` credentials. Keep a complete closed-app and user-data backup before installing.

Local acceptance covered a clean staging run and rejection of modified inputs, portable and shipped-renderer tests, local DOCX/XLSX formatting and saving, PDF manual OCR, and the home cloud-folder entry. Refer to [RELEASE-0.12.852.md](RELEASE-0.12.852.md) for the tested scope.

### Local roaming copies retired (2026-11-12)

The earlier standalone macOS `GenOfficeRoaming` component copied opened documents into a fixed local folder and refreshed those copies after saves. This feature is retired in favor of WebDAV automatic upload and cloud history. Current fork overlays do not install or launch that component.

For an existing standalone installation, disable it by renaming `~/Library/Application Support/GenOfficeRoaming/config.json` to `config.disabled.json` while its cache service is stopped. Preserve the configuration contents and all existing document copies. The legacy startup hook requires `config.json` and skips the component when it is absent. If both configuration filenames already exist, preserve both and resolve them before renaming.

Future upgrades must preserve this disabled state: do not recreate the legacy configuration, reinstall its startup hook, or restart its cache service. WebDAV synchronization, pending-upload snapshots, unsaved-edit recovery, the Docs internal original archive and PDF OCR caches retain their existing behavior. Existing files in the former copy folder are kept until separately reviewed for cleanup. Local paths, document inventories and credentials are not included in this repository.

### macOS ARM64 0.12.446 update

The Mac ARM64 official package shares the exact pinned JavaScript host, renderers and preloads with Windows 446. `stage.py --version 0.12.446 --platform darwin-arm64` generates a 25-file overlay (`bohan-v0.12.446.7-macos.1`). It reuses the formatting, font alias, table, manual OCR, cloud folder, two-way sync and version history logic, and additionally carries the validated macOS SMB error-45 fallback and EAGAIN handling from 117. The existing Windows output remains unchanged; its PowerShell helpers are excluded from the Mac overlay.

On macOS, choose **WebDAV 云文档 → 配置 WebDAV（手动输入密码）**. The setup window shows the destination, account, an initially empty password field, and an explicit automatic-sync checkbox. Enter the password manually each time configuration is saved, then restart. Credentials use Electron `safeStorage` backed by macOS Keychain and are saved as ciphertext in a separate mode-0600 file; ordinary JSON configuration contains no password. Existing recovery and OCR caches remain local. Without configuration, cloud synchronization stays inactive.

The official DMG is obtained separately from the upstream `v0.12.446` release: `GenOffice-0.12.446-arm64.dmg`, SHA-256 `277b2de8909484dd960131d373330f129e27654570fd6b405a041c3ec7c4390a`. Keep the prior app and closed user-data backup. Launch the clean official version once, quit it, prepare the complete enhanced app outside `/Applications`, and use Finder to replace the installed app if macOS App Management blocks resource writes. Verify every installed manifest hash before use.

## Supported baselines

| Adapter | Clean desktop package | Public upstream source baseline | Generated replacement files |
| --- | --- | --- | --- |
| `v0.12.29` | Official macOS 0.12.29 | GitHub `v0.12.29` | 12 renderer/helper files |
| `v0.12.117` | Official macOS 0.12.117 from the vendor's company CDN update feed | GitHub `v0.12.115` | 12 renderer/helper files + `app.asar` |
| `v0.12.446` | Official Windows x64 0.12.446 | GitHub `v0.12.446` | 23 files: formatting/OCR renderers, pinned shell host/preload/renderer, 2 module preloads and 8 WebDAV helpers |
| `v0.12.446` | Official macOS ARM64 0.12.446 | GitHub `v0.12.446` | 25 files: formatting/OCR renderers, host, preloads and macOS WebDAV helpers |
| `v0.12.852` | Official macOS ARM64 0.12.852 | GitHub `v0.12.852` | 25 files: formatting/OCR renderers, host, preloads and macOS WebDAV helpers |

### Windows 0.12.446 update

Update this fork first, verify the new adapter, publish the recipe, then download the recipe from this fork before updating the installed application. Official application updates replace renderer customizations; apply the matching overlay before using the updated app.

The Windows adapter retains official-document formatting, Word/Excel table beautification and manual PDF OCR with local cache reuse. Native shipped Docs and Sheets helper tests pass against the Windows assets. The macOS-only 117 SMB host patch is not applied on Windows. Previous adapters stay pinned. The official installer is fetched separately from the vendor and is not redistributed here.

Pinned Windows x64 baseline:

- Version: `0.12.446`; source tag: `v0.12.446`.
- Installer: `https://cdn1.genspark.ai/user-upload-image/client/genoffice/GenOfficeSetup-v0.12.446.exe`.
- SHA-512 (base64): `FN50U5tW7RPYaourAiPKzl9n6DSRoA69Mjm4rvtiG3W4cPmwz/I5IJczCfSzuIcGQztoSJDLI+aPlLlpbb1nMw==`.

With Python 3.10+, generate the overlay from clean Windows resources:

```powershell
$env:PYTHONUTF8 = '1'
python bohan-enhancements/stage.py --version 0.12.446 --resources 'C:\path\to\clean\resources' --output 'C:\path\to\new\overlay'
```

Save and quit GenOffice, back up the installed app and its user-data directory, install the verified official baseline, quit it if the installer launches it, and copy all 23 manifest files to the matching `resources` paths. Verify destination SHA-256 values against `bohan-overlay.json`, then launch. Preserve the backup for rollback. `stage.py` never modifies the input app. The manifest records `platform: win32-x64`; other platforms and versions require separately pinned adapters.

Revision 7 adds the home WebDAV folder, content synchronization in both directions, safe conflicts and durable cloud history. See [WEBDAV-PLAN.md](WEBDAV-PLAN.md) for exact behavior and limits. Revision 6 fixes localized Chinese/English font-family detection for official-document layout. Revision 5 provides readable document backups with original filenames and a preset backup URL; see [WEBDAV-PLAN.md](WEBDAV-PLAN.md) for behavior and limits. It is disabled until configured. Open the application menu → **WebDAV 云文档 → 配置 WebDAV（手动输入密码）**. The requested backup URL is already supplied and displayed. Enter the account and manually enter the hidden password to enable backup; no URL or YES entry is required. Restart GenOffice. Every reconfiguration, including after an update or deployment, asks for the password again; the wizard never accepts it as an argument or imports it from a file. Ordinary restarts reuse Windows Credential Manager. This personal fork includes the requested default backup URL. It contains no account or password. Keep private user-data out of source control.

After opt-in, successful opens and saves queue immutable saved-file snapshots, retain local originals/recovery/OCR caches, deduplicate unchanged bytes and retry offline work after restart. The menu shows status and retry controls and supports pausing files or excluding folders. The destination contains ordinary documents under their original filenames; saves update the same file. Same-name documents get numeric suffixes. Remote edits stop that document's queue and retain the local snapshot. The previous backups-v1 tree is preserved. Only files opened or saved after opt-in, or subsequently changed files already mapped to the cloud, trigger new snapshots; there is no recent-file backfill. The default limits are 512 MiB per file and 2 GiB pending snapshots. Revision 7 checks mapped cloud documents on open and every 30 seconds, pulls changes only into closed unchanged local files, and provides version list/copy/restore. Deletion, rename and move are not propagated. Cloud history is kept in the hidden `.genoffice-history` system directory; the home folder lists ordinary documents only. Unsaved edits and OCR cache files are not uploaded.

### Historical 0.12.117 baseline

The vendor's update feed distributes **0.12.117**, while its latest public source/release tag at the time of this adaptation is **v0.12.115**. The fork merges that public source tag; the 117 overlay is separately pinned to the exact shipped macOS assets and archive hashes. It does not treat the public 115 source as an exact copy of the 117 package. The 29 adapter remains frozen for older installations.

| Feature | Entry | Behavior |
| --- | --- | --- |
| Official-document body layout | Docs → existing AI Format | WPS-style body template, paragraph-role preview, font substitution report, A4 margins, fixed 28 pt lines, preserve text, apply/restore |
| Spreadsheet table beautification | Sheets → Home → Styles | 10 classic styles, 7 themes, 0–5 header rows, banding, preserve/measure dimensions, preserve formulas/number formats/merges, one undo before save |
| Word table beautification | Docs → Table Design | Separate 10-style set, merged cells, paragraph/run formatting, preserve/measure dimensions, one undo before save |
| PDF opening performance | PDF → Home → Recognize scanned pages | Opening restores cached text only; explicit OCR, skip native/cached pages, cancel/resume, cache by full-content SHA-256 and original page number |
| SMB workbook saving, 117 adapter | Sheets → Save / Save As | On macOS `os error 45`, generate the archive locally, copy to a visible sibling temporary file, validate its ZIP entry manifest and use the existing replacement flow; classify `EAGAIN` as file occupancy |

The new host recipe retains upstream's non-hidden temporary-file naming. Permission failures and failed copy validation preserve the existing workbook. The same SMB behavior and regression tests are included in the fork's `xlsx-gateway` TypeScript source. The preserved 29 renderer adapter does not include a host archive patch.

## Delivery model

This release contains **enhancement source, versioned compatibility recipes, hash checks and tests**. Packaged enhancements, including Windows WebDAV backup, are applied through the overlay generator. A normal `npm run build:all` includes the fork's TypeScript SMB changes but does not inject these overlay features; use the matching overlay recipe. This release has no custom installer or update feed.

Recipes contain independently written feature logic, observable style values from fictional saved Office samples, and small Apache-2.0 upstream anchor excerpts. Release artifacts exclude official full installers, installed GenOffice bundles, generated or extracted `app.asar` archives, WPS program resources, user documents, settings, credentials and local backups. Generated overlay files are produced locally from the operator's clean official installation.

## Stage and install

Use Python 3.10+, a **clean original supported macOS app**, and a fresh output directory. Staging reads the app and creates a separate overlay without modifying the input. It detects the adapter from the exact renderer hashes; `--version` can require a particular adapter:

```sh
python3 bohan-enhancements/stage.py \
  --resources /path/to/clean/GenOffice.app/Contents/Resources \
  --output /path/to/new/bohan-overlay \
  --version 0.12.852 \
  --platform darwin-arm64
```

Unknown, mixed or already patched inputs are rejected before output creation. For 117, the generator also verifies the complete clean `app.asar`, changes only `out/main/index.js`, recalculates archive integrity records, verifies every other member is byte-for-byte unchanged, and checks the expected final archive hash. The resulting `bohan-overlay.json` records desktop-package version, public source baseline and each generated file's SHA-256.

The Windows 446 recipe independently pins its clean host archive and both affected preloads. It changes only the main ASAR member to install the backup service and observe successful native workbook operations. Docs/PDF preloads add an acknowledgement of a successfully parsed native open. Failed, cancelled and password-pending opens do not create snapshots. All other ASAR members are verified unchanged; the official executable stays intact.

Before installing, save open work and back up the entire current app plus the GenOffice user-data folder. Keep a clean copy of the new official app for generating a fresh overlay and a copy of the previous customized app for rollback. Launch the clean version using a separate test profile and quit it before preparing the enhanced application. Copy **all files listed in the overlay manifest** to their matching paths under a separate copy of the new app's `Contents/Resources`, preserving filenames. Do not copy the overlay manifest over an application resource. On macOS, replacing signed resources invalidates the upstream signature; validate the resulting local signature and startup before replacing the installed application.

Verify the installed files against the manifest and restart GenOffice. Use fictional local documents to check public-document layout/apply/restore, Word and Excel beautification/undo/save/reopen, and PDF manual OCR/cache reuse. Use a newly created test workbook on the actual SMB share to verify repeated save/reopen and visible output. Restore the backed-up app to roll back. Official application updates replace package resources, so generate and test a matching adapter before switching to another version.

## Tests

```sh
cd bohan-enhancements
npm ci --ignore-scripts --workspaces=false
node test.mjs
python3 tests/test-stage.py
```

Portable tests compare **300 Sheets + 300 Word style cells**, ProseMirror merged-cell behavior, preserved links/fonts/atoms/text, undo/redo, intervening edits, read-only guards, public-document rollback and refusal of unknown inputs. The default portable host test uses the retained 29 adapter; set `BOHAN_ADAPTER_VERSION=0.12.117` to exercise the new host recipe.

Optional local compatibility acceptance uses clean official assets and a staged PDF renderer, kept outside this repository:

```sh
BOHAN_BASELINE_RESOURCES=/path/to/clean/GenOffice.app/Contents/Resources \
  python3 tests/test-stage.py

BOHAN_ADAPTER_VERSION=0.12.117 \
BOHAN_DOCS_RENDERER=/path/to/clean/Resources/modules/docs/renderer/assets/index-CYNQkvnc.js \
BOHAN_SHEETS_RENDERER=/path/to/clean/Resources/modules/sheets/renderer/assets/index-CG8lQClX.js \
BOHAN_PDF_RENDERER=/path/to/overlay/modules/pdf/renderer/assets/index-wUHEIxfM.js \
  node test.mjs
```

For 29 native acceptance, omit `BOHAN_ADAPTER_VERSION` (or set `0.12.29`) and use `index-rnPExjWA.js` for clean Sheets and `index-DpDiqQ18.js` for staged PDF.

Local compatibility checks reproduce the pinned generated hashes and confirm the input remains unchanged, a second patch attempt is rejected, and a modified 117 host stops staging even when its renderers remain clean. Native Docs tests execute the shipped ProseMirror block reader with real heading, paragraph and protected-object nodes, distinguish the Mailings JSON reader, and feed the shipped Word bridge helpers through the merged-table preservation tests. Native Sheets tests execute the shipped style commands, formula listener, save journal, alignment serializer and undo batching methods. PDF tests cover full-content identity, cached/native-page skipping, cap/resume, cancellation and no automatic OCR on open. The fork's targeted SMB tests cover the local archive fallback, copied-manifest validation, file-occupancy handling and preservation of existing output on failure. `verification/` keeps sanitized application observations separately from portable tests.

WPS comparisons cover ten sampled blue classic styles per format. Other themes use Office HLS/tint reconstruction; sizing uses GenOffice-side text measurement. Native system OCR can still be slow when manually requested.

## Update with upstream

The fork's `main` follows the reviewed public upstream release; `bohan` carries enhancements and is the default branch. Keep synchronization separate from feature commits:

```sh
git remote add upstream https://github.com/genspark-ai/genoffice.git # once
git fetch upstream --tags
git switch bohan
git merge <reviewed-upstream-tag>
```

For each new desktop package, add a versioned adapter, inspect changed APIs/renderers and the packaged host, record clean and generated hashes, run preservation/undo/SMB tests, stage a clean app and perform application acceptance. Keep older adapters pinned. Merging upstream alone does not adapt a new desktop package.

Fork installers should use their own product branding, app identity and update feed, following upstream trademark guidance. Preserve the root Apache-2.0 license and the separate `ee/` licensing boundary. This release does not modify `ee/` or distribute an installer.
