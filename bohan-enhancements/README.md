# Bohan Office enhancements

Versioned enhancements for **macOS GenOffice 0.12.29 and 0.12.117**, maintained in the `bohan` branch of [Bohanfree/genoffice](https://github.com/Bohanfree/genoffice). The independent public-document skill stays at [genoffice-official-typeset-skill](https://github.com/Bohanfree/genoffice-official-typeset-skill).

## Supported baselines

| Adapter | Clean desktop package | Public upstream source baseline | Generated replacement files |
| --- | --- | --- | --- |
| `v0.12.29` | Official macOS 0.12.29 | GitHub `v0.12.29` | 12 renderer/helper files |
| `v0.12.117` | Official macOS 0.12.117 from the vendor's company CDN update feed | GitHub `v0.12.115` | 12 renderer/helper files + `app.asar` |

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

This release contains **enhancement source, versioned compatibility recipes, hash checks and tests**. All five packaged enhancements are applied through the overlay generator. A normal `npm run build:all` includes the fork's TypeScript SMB changes but does not inject the renderer enhancements; use the matching overlay recipe for those features. This release has no custom installer or update feed.

Recipes contain independently written feature logic, observable style values from fictional saved Office samples, and small Apache-2.0 upstream anchor excerpts. Release artifacts exclude official full installers, installed GenOffice bundles, generated or extracted `app.asar` archives, WPS program resources, user documents, settings, credentials and local backups. Generated overlay files are produced locally from the operator's clean official installation.

## Stage and install

Use Python 3.10+, a **clean original supported macOS app**, and a fresh output directory. Staging reads the app and creates a separate overlay without modifying the input. It detects the adapter from the exact renderer hashes; `--version` can require a particular adapter:

```sh
python3 bohan-enhancements/stage.py \
  --resources /path/to/clean/GenOffice.app/Contents/Resources \
  --output /path/to/new/bohan-overlay \
  --version 0.12.117
```

Unknown, mixed or already patched inputs are rejected before output creation. For 117, the generator also verifies the complete clean `app.asar`, changes only `out/main/index.js`, recalculates archive integrity records, verifies every other member is byte-for-byte unchanged, and checks the expected final archive hash. The resulting `bohan-overlay.json` records desktop-package version, public source baseline and each generated file's SHA-256.

Before installing, save open work and back up the entire current app plus the GenOffice user-data folder. Keep a clean copy of the new official app for generating a fresh overlay and a copy of the previous customized app for rollback. On macOS, first install and launch the clean official new version once, then quit it before applying the overlay. This establishes the official first-launch state before package resources are changed. Use Finder to copy **all files listed in the overlay manifest** to their matching paths under the new app's `Contents/Resources`, preserving filenames. The 117 list includes `app.asar` as well as renderer files. Do not copy the overlay manifest over an application resource. On macOS use Finder if package writes are protected; preserve the official executable, `Info.plist` and system security settings.

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
