# Bohan Office enhancements

Versioned enhancements for **macOS GenOffice 0.12.29**, maintained in the `bohan` branch of [Bohanfree/genoffice](https://github.com/Bohanfree/genoffice). The independent public-document skill stays at [genoffice-official-typeset-skill](https://github.com/Bohanfree/genoffice-official-typeset-skill).

| Feature                          | Entry                                | Behavior                                                                                                                                          |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official-document body layout    | Docs → existing AI Format            | WPS-style body template, paragraph-role preview, font substitution report, A4 margins, fixed 28 pt lines, preserve text, apply/restore            |
| Spreadsheet table beautification | Sheets → Home → Styles               | 10 classic styles, 7 themes, 0–5 header rows, banding, preserve/measure dimensions, preserve formulas/number formats/merges, one undo before save |
| Word table beautification        | Docs → Table Design                  | Separate 10-style set, merged cells, paragraph/run formatting, preserve/measure dimensions, one undo before save                                  |
| PDF opening performance          | PDF → Home → Recognize scanned pages | Opening restores cached text only; explicit OCR, skip native/cached pages, cancel/resume, cache by full-content SHA-256 and original page number  |

## Delivery model

This release contains the **tested enhancement source, compatibility recipes and tests**. Recipes compose the four features against pristine release assets and verify original and generated renderer hashes. The upstream TypeScript application build is unchanged: `npm run build:all` builds upstream without this overlay. This release has no custom installer or update feed.

The compatibility source is frozen for the verified macOS release. It contains independently written logic, observable style values from fictional saved Office samples, and small Apache-2.0 upstream anchor excerpts. It excludes WPS program files, installed GenOffice bundles, extracted app archives, personal documents and local backups.

## Stage and install

Use Python 3.10+, a **clean original macOS 0.12.29 app**, and a fresh output directory. Staging does not modify the app:

```sh
python3 bohan-enhancements/stage.py \
  --resources /path/to/GenOffice.app/Contents/Resources \
  --output /path/to/new/bohan-overlay
```

A different or already patched build is rejected. Output contains the replacement resources and `bohan-overlay.json` with per-file SHA-256 values. Keep the clean app as a rollback baseline.

Copy each generated `modules/<module>/renderer/assets` file to the matching app directory, preserving filenames. On macOS use Finder if package writes are protected. Verify files against `bohan-overlay.json`, then close/reopen affected document tabs. Save work before replacing resources. To revert, restore the three original renderers and remove only the added enhancement files. Application updates may replace resources; check the version before staging again.

## Tests

```sh
cd bohan-enhancements
npm ci --ignore-scripts
node test.mjs
python3 tests/test-stage.py
```

Portable tests compare **300 Sheets + 300 Word style cells**, ProseMirror merged-cell behavior, preserved links/fonts/atoms/text, undo/redo, intervening edits, read-only guards, public-document rollback and refusal of unknown inputs.

Optional local acceptance uses clean release assets and a staged PDF renderer, kept outside this repository:

```sh
BOHAN_BASELINE_RESOURCES=/path/to/clean/Resources python3 tests/test-stage.py
BOHAN_SHEETS_RENDERER=/path/to/clean/sheets/assets/index-rnPExjWA.js \
BOHAN_PDF_RENDERER=/path/to/overlay/modules/pdf/renderer/assets/index-DpDiqQ18.js \
node test.mjs
```

Local acceptance reproduced all three installed renderer hashes. Native Sheets tests cover formula preservation, style commands, alignment save/undo, sequential batches and journal guards. PDF tests cover content identity, cached/native-page skipping, cap/resume, cancellation and no automatic OCR on open. `verification/` contains sanitized earlier application observations, separately from new portable tests.

WPS comparisons cover ten sampled blue classic styles per format. Other themes use Office HLS/tint reconstruction; sizing uses GenOffice-side text measurement. Cloud styles and AI recommendations are outside this release. In the local PDF run, one of two pages produced cached text, which reopened and searched successfully. Native system OCR can still be slow when manually requested.

## Update with upstream

The fork's `main` follows upstream; `bohan` carries enhancements and is the default branch. Keep synchronization separate from feature commits:

```sh
git remote add upstream https://github.com/genspark-ai/genoffice.git # once
git fetch upstream --tags
git switch bohan
git merge <reviewed-upstream-tag>
```

For each new release, add an adapter directory, inspect changed APIs/renderers, record baseline hashes, run preservation/undo tests, stage a clean app and perform application acceptance. Keep older adapters pinned. Merging upstream does not itself adapt the new release.

Fork installers should use their own product branding, app identity and update feed, following upstream trademark guidance. Preserve the root Apache-2.0 license and the separate `ee/` licensing boundary. This release does not modify `ee/` or ship an installer.
