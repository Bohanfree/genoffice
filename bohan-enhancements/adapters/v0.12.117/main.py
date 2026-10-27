"""Pinned macOS 0.12.117 main-process SMB compatibility recipe."""
import hashlib

BASELINE_ASAR = '50dcf025a9ec39ddae20c77cf06dff77b2081cb5261eb9e3c07b19bc11c335be'
BASELINE_MAIN = 'fe29dcade3682dc9485d7275ac9075a779d5cd8cab37205a2061211d92701069'

ORIGINAL_SAVE = '    const result = saveArchiveResultSchema.parse(\n      await request2.client.saveArchive({\n        sourcePath: request2.sourcePath,\n        targetPath: temporaryTarget,\n        replacements,\n        removals: plan.removedEntries,\n        additions\n      })\n    );'
PATCHED_SAVE = '    const archiveRequest = {\n      sourcePath: request2.sourcePath,\n      targetPath: temporaryTarget,\n      replacements,\n      removals: plan.removedEntries,\n      additions\n    };\n    let archiveResult;\n    try {\n      archiveResult = await request2.client.saveArchive(archiveRequest);\n    } catch (error) {\n      // macOS F_FULLFSYNC is unsupported by some SMB servers. Keep the\n      // validated sibling-temp and atomic-promotion save path.\n      if (process.platform !== "darwin" || !/\\(os error 45\\)/.test(\n        error instanceof Error ? error.message : String(error)\n      )) throw error;\n      const localTarget = path.join(workDir, "smb-save-fallback.xlsx");\n      archiveResult = await request2.client.saveArchive({\n        ...archiveRequest,\n        targetPath: localTarget\n      });\n      const localResult = saveArchiveResultSchema.parse(archiveResult);\n      await promises.copyFile(localTarget, temporaryTarget);\n      const copiedManifest = manifestResultSchema.parse(\n        await request2.client.archiveManifest(temporaryTarget)\n      ).entries;\n      if (!manifestsEqual(localResult.afterEntries, copiedManifest)) {\n        throw new Error("The workbook copy failed validation while saving — aborted.");\n      }\n    }\n    const result = saveArchiveResultSchema.parse(archiveResult);'


def patch_main(source):
    if hashlib.sha256(source.encode('utf-8')).hexdigest() != BASELINE_MAIN:
        raise ValueError('Unsupported or already modified 0.12.117 main-process source.')
    if source.count(ORIGINAL_SAVE) != 1:
        raise ValueError('Expected exactly one packaged archive save anchor.')
    patched = source.replace(ORIGINAL_SAVE, PATCHED_SAVE, 1)
    original_lock = 'const RETRYABLE_RENAME_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);'
    if patched.count(original_lock) != 1:
        raise ValueError('Expected exactly one packaged rename retry-code anchor.')
    return patched.replace(original_lock, original_lock.replace('"EBUSY"]', '"EBUSY", "EAGAIN"]'), 1)
