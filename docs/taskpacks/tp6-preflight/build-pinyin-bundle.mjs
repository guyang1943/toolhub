// Build script: bundles scripts/vendor/tiny-pinyin/dist (CJS) into one browser IIFE.
// Run: node scripts/build-pinyin-bundle.mjs  ->  assets/vendor/pinyin.min.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'scripts/vendor/tiny-pinyin/dist');
const read = (p) => readFileSync(join(dist, p), 'utf8');

// dependency order: patchers -> dict -> core -> index -> browser
const files = ['patchers/56l.js', 'patchers/safari.js', 'dict.js', 'core.js', 'index.js', 'browser.js'];

let out = `(function (global) {\n'use strict';\nvar __mods = {};\nfunction __req(id) { return __mods[id]; }\nfunction __def(id, factory) {\n  var module = { exports: {} };\n  factory(module, module.exports, __req);\n  __mods[id] = module.exports;\n}\n`;
for (const f of files) {
  const id = './' + f.replace(/\.js$/, '');
  let src = read(f).replace(/^\s*'use strict';\s*/, '');
  src = src.replace(/require\(/g, '__req(');
  out += `\n__def('${id}', function (module, exports, require) {\n${src}\n});\n`;
}
out += `\nglobal.Pinyin = __mods['./browser'];\n})(typeof window !== 'undefined' ? window : this);\n`;

mkdirSync(join(root, 'assets/vendor'), { recursive: true });
writeFileSync(join(root, 'assets/vendor/pinyin.min.js'), out);
console.log('wrote assets/vendor/pinyin.min.js', out.length, 'bytes');
