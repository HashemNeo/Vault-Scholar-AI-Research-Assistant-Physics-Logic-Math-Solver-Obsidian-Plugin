// Repair the mis-inserted commands block in main.js (CRLF-safe).
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'main.js');
let src = fs.readFileSync(file, 'utf8');
const wasCRLF = src.includes('\r\n');
if (wasCRLF) src = src.replace(/\r\n/g, '\n');

// R1: drop the orphaned derive-math opener (8sp) + fix the over-indented block opener
const r1Target = "        this.addCommand({\n                    this.addCommand({\n            id: 'research-mode',";
const r1Replace = "        this.addCommand({\n            id: 'research-mode',";
if (!src.includes(r1Target)) {
    console.error('R1 target not found — already repaired or different corruption');
    process.exit(1);
}
src = src.replace(r1Target, r1Replace);

// R2: restore the derive-math opener before its (now dangling) id
const r2Target = "        });\n\n            id: 'derive-math',";
const r2Replace = "        });\n\n        this.addCommand({\n            id: 'derive-math',";
if (!src.includes(r2Target)) {
    console.error('R2 target not found — already repaired or different corruption');
    process.exit(1);
}
src = src.replace(r2Target, r2Replace);

if (wasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('✓ Repaired main.js');
</arg_value>
</write_to_file></tool_call>