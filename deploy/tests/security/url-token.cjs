const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'dashboard/node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'dashboard/src/modules/auth/auth.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const storage = new Map([
  ['tracium_token', 'existing-session-placeholder'],
  ['tracium_email', 'victim@example.test'],
]);
const context = {
  exports: {}, URLSearchParams,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  window: {
    location: { search: '?token=attacker-session-placeholder', pathname: '/' },
    history: { replaceState() {} },
  },
};
vm.runInNewContext(compiled, context);
const token = context.exports.readInitialToken();
const confirmed = token === 'attacker-session-placeholder'
  && storage.get('tracium_token') === token
  && context.exports.readAccount().email === 'victim@example.test';
if (!confirmed) throw new Error('Previously observed session replacement behavior changed');
console.log(JSON.stringify({
  check: 'url_token_session_replacement', confirmed,
  existing_session_replaced: true, displayed_email_remains_previous_account: true,
  method: 'Current TypeScript executed in an isolated VM with fake browser storage; placeholder tokens only',
}));
