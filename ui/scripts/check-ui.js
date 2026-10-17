// Checks that the script inside public/index.html is valid JavaScript.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('No inline script found in public/index.html'); process.exit(1); }
try { new vm.Script(m[1], { filename: 'public/index.html' }); console.log('UI script syntax OK'); }
catch (e) { console.error('UI script error: ' + e.message); process.exit(1); }
