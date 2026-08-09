'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExperimentalWorkspace, createWorkspace } = require('../lib/experimental');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debug3-'));
fs.mkdirSync(path.join(root, 'Research'), { recursive: true });
fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\noriginal');
fs.writeFileSync(path.join(root, 'Research', 'B.md'), '# Note B\nbase');
const base = path.join(root, '.vault-scholar');
const ws = createWorkspace(root, base);

ws.create('quantum-bounce-simulation', 'sim');

const edits = [{ path: 'Research/A.md', content: '# Note A\nexperimental edit' }];
const res = ws.applyEdits('quantum-bounce-simulation', edits);
console.log('applyEdits result:', JSON.stringify(res));

// Now call apply() DIRECTLY and check
const directApply = ws.branches.apply('quantum-bounce-simulation');
console.log('direct apply result:', JSON.stringify(directApply));
console.log('vault A.md after direct apply:', JSON.stringify(fs.readFileSync(path.join(root, 'Research', 'A.md'), 'utf8')));

// Check where branch file lives
console.log('branchFile:', ws.branches.branchFile('quantum-bounce-simulation'));
console.log('workspaceFile:', ws.workspaceFileFor('quantum-bounce-simulation'));

// Load branch right now
const br = ws.branches.load('quantum-bounce-simulation');
console.log('branch.name:', br.name);
console.log('branch.files[A.md]:', br.files['Research/A.md']);
console.log('cas.getText:', ws.branches.cas.getText(br.files['Research/A.md']));
