// One-time helper: fills in your GitHub username and name in the project files.
// Usage: node scripts/set-owner.js your-github-username "Your Name"
const fs = require('fs'), path = require('path');
const [user, name] = process.argv.slice(2);
if (!user || !name) { console.error('Usage: node scripts/set-owner.js <github-username> "<Your Name>"'); process.exit(1); }
const root = path.join(__dirname, '..'), skip = new Set(['.git', 'node_modules', 'screenshots']);
const want = f => /\.(md|ya?ml|xml|json)$/i.test(f) || ['Dockerfile', 'LICENSE'].includes(f);
let changed = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!want(e.name) || p === __filename) continue;
    const t = fs.readFileSync(p, 'utf8'), n = t.replace(/OWNER/g, user.toLowerCase()).replace(/YOUR NAME/g, name);
    if (n !== t) { fs.writeFileSync(p, n); changed++; console.log('updated ' + path.relative(root, p)); }
  }
})(root);
console.log(changed + ' file(s) updated.');
