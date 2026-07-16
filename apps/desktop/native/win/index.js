// Resolver for the compiled Undertone win32 addon. Required lazily (and only on win32) by
// apps/desktop/src/native/win32/binding.ts. Kept as a tiny CommonJS shim so the .node artifact
// is never statically analyzed by bundlers and so a missing build surfaces a clear error at the
// seam rather than a mysterious MODULE_NOT_FOUND deep in a wrapper.
// This file must be CommonJS: it loads a native .node addon, which is CJS-only.
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// node-gyp emits build/Release/<target_name>.node.
module.exports = require('./build/Release/undertone_win.node');
