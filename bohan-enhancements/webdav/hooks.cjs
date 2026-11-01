'use strict';
const path = require('node:path');

// Only completed, allowlisted native operations can create a backup candidate.
// A renderer path must match its previously completed native open in bootstrap.cjs.
function createHooks({ observe, pending }) {
  return function completed(channel, event, args, result) {
    if (result == null || result === false || result.ok === false || result.canceled || result.cancelled || result.needsPassword || result.passwordRequired) return;
    const wc = event.sender;
    if (wc.isDestroyed?.()) return;
    const accept = (file, reason = 'save') => {
      if (typeof file === 'string' && path.isAbsolute(file)) observe(wc.id, file, reason);
    };
    if (['docs:open', 'docs:open-path', 'docs:open-decrypt', 'docs:consume-pending-open'].includes(channel)) {
      const opened = channel === 'docs:open-decrypt' ? result.result : result;
      if (opened?.path && opened.hash && opened.dataUrl) pending.set(wc.id, { path: opened.path, hash: opened.hash });
    } else if (channel === 'pdf:read-file') {
      if (typeof args[0] === 'string') pending.set(wc.id, { path: args[0] });
    } else if (['docs:save', 'docs:save-as', 'docs:save-new', 'docs:save-to'].includes(channel) && result.ok === true) {
      accept(result.path || args[0]);
    } else if (channel === 'pdf:save' && result.ok === true) {
      accept(args[0]?.targetPath || args[0]?.path);
    } else if (['slides:open', 'slides:open-path', 'slides:consume-pending-open'].includes(channel) && result.slides) {
      accept(result.path, 'open');
    } else if (['slides:save', 'slides:save-as', 'markdown:save', 'html:save'].includes(channel) && result.ok === true) {
      accept(result.path);
    } else if (['markdown:read-file', 'html:read-file'].includes(channel) && typeof result === 'string') {
      accept(args[0], 'open');
    }
  };
}
module.exports = { createHooks };
