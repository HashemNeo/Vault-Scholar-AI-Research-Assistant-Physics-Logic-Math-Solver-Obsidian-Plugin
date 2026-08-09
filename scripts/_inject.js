// One-shot injector for Vault Scholar integration (Evidence + Research Mode).
// Idempotent. Reads block modules then applies targeted insertions to main.js.
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'main.js');
let src = fs.readFileSync(file, 'utf8');
const out = [];

const { commandsBlock, anchor1 } = require('./inject/commands');
const { settingsBlock, anchor2 } = require('./inject/settings');
const { modalBlock, anchor3 } = require('./inject/modal');

if (src.indexOf("id: 'research-mode'") === -1) {
    const i1 = src.indexOf(anchor1);
    if (i1 === -1) throw new Error('ANCHOR 1 not found');
    // Insert before the exact line position; match single-line anchor only
    src = src.slice(0, i1) + commandsBlock + src.slice(i1);
    out.push('✓ commands');
} else out.push('• commands already present');

if (src.indexOf("h3', { text: '🔬 Research Mode' }") === -1) {
    const i2 = src.indexOf(anchor2);
    if (i2 === -1) throw new Error('ANCHOR 2 not found');
    src = src.slice(0, i2) + settingsBlock + src.slice(i2);
    out.push('✓ settings UI');
} else out.push('• settings UI already present');

if (src.indexOf("['🔬 Research Mode', 'research-mode']") === -1) {
    const i3 = src.indexOf(anchor3);
    if (i3 === -1) throw new Error('ANCHOR 3 not found');
    src = src.slice(0, i3) + modalBlock + src.slice(i3);
    out.push('✓ main modal actions');
} else out.push('• main modal already present');

fs.writeFileSync(file, src, 'utf8');
console.log(out.join('\n') + '\nDone.');