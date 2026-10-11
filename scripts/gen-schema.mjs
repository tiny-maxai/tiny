// Turns schema.sql into src/lib/schema.js so the Worker can create its own tables (no manual db:init step).
import fs from 'node:fs';
const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const stmts = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
fs.writeFileSync(new URL('../src/lib/schema.js', import.meta.url), '// Generated from schema.sql by scripts/gen-schema.mjs. Every statement is safe to run again.\nexport const STATEMENTS = ' + JSON.stringify(stmts, null, 2) + ';\n');
console.log(stmts.length + ' statements');
