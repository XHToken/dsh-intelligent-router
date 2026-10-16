#!/usr/bin/env node

/**
 * Post-build script to wrap client bundle in DSH's ModuleLoader format
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const clientBundlePath = resolve(process.cwd(), 'dist/client/index.js');
const pluginId = 'dsh-llm-router';

// Read the ES module bundle
let esModuleContent = readFileSync(clientBundlePath, 'utf-8');

// Remove source mapping comment (we'll add it back at the end)
const sourceMappingURLMatch = esModuleContent.match(/\/\/# sourceMappingURL=.+$/m);
if (sourceMappingURLMatch) {
  esModuleContent = esModuleContent.replace(sourceMappingURLMatch[0], '');
}

// Convert ES module imports to require() calls
let commonjsContent = esModuleContent
  // Handle aliased imports: import { jsx as jsx2 } from "..."
  .replace(/import\s+{\s*([^}]+)\s*}\s+from\s+["']([^"']+)["'];?/g, (match, imports, module) => {
    const importList = imports.split(',').map(s => {
      const trimmed = s.trim();
      // Handle "x as y" pattern
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        return `${asMatch[1]}: ${asMatch[2]}`;
      }
      return trimmed;
    }).filter(Boolean);
    return `const { ${importList.join(', ')} } = require("${module}");`;
  })
  // Handle default + named imports: import React, { useState } from "..."
  .replace(/import\s+(\w+)\s*,\s*{\s*([^}]+)\s*}\s+from\s+["']([^"']+)["'];?/g, (match, defaultImport, namedImports, module) => {
    const importList = namedImports.split(',').map(s => {
      const trimmed = s.trim();
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        return `${asMatch[1]}: ${asMatch[2]}`;
      }
      return trimmed;
    }).filter(Boolean);
    return `const ${defaultImport} = require("${module}");\nconst { ${importList.join(', ')} } = ${defaultImport};`;
  })
  // Handle default imports: import React from "..."
  .replace(/import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g, 'const $1 = require("$2");')
  // Convert export statements
  .replace(/export\s+function\s+(\w+)/g, 'function $1')
  .replace(/export\s+const\s+(\w+)/g, 'const $1')
  .replace(/export\s+{[^}]+};?/g, '')
  .replace(/export\s+default\s+/g, 'module.exports.default = ');

// Wrap in ModuleLoader format
let wrappedContent = `window.__ModuleLoader__.load({
  id: "${pluginId}",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    ${commonjsContent}

    // Export the apply function
    module.exports.apply = apply;
    module.exports.inject = inject;

    return module.exports;
  }
});
`;

// Add back source mapping comment if it existed
if (sourceMappingURLMatch) {
  wrappedContent += '\n' + sourceMappingURLMatch[0];
}

// Write the wrapped bundle
writeFileSync(clientBundlePath, wrappedContent, 'utf-8');

console.log('✅ Client bundle wrapped in ModuleLoader format');
