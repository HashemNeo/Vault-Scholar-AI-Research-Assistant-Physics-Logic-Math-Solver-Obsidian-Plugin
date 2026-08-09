'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CASStore } = require('../lib/cas');
const { ExperimentalWorkspace, createWorkspace } = require('../lib/experimental');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-'));
fs.mkdirSync(path.join(root, 'Research'), { recursive: true });
fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\noriginal');
fs.writeFileSync(path.join(root, 'Research', 'B.md'), '# Note B\nbase');
const base = path.join(root, '.vault-scholar');
const ws = createWorkspace(root, base);

const c = ws.create('testbranch', 'desc');
console.log('create ok:', c.ok);
console.log('snapshot id:', c.snapshot.id, 'fileCount:', c.snapshot.fileCount);
console.log('branch files keys:', Object.keys(c.branch.files));

const branchOnDisk = ws.branches.load('testbranch');
console.log('branch on disk files:', JSON.stringify(branchOnDisk.files));
const aHash = branchOnDisk.files['Research/A.md'];
console.log('A.md blob on disk:', ws.branches.cas.getText(aHash));

const newHash = ws.branches.cas.put('# Note A\nexperimental edit');
console.log('newHash:', newHash);
console.log('newContent blob:', ws.branches.cas.getText(newHash));

branchOnDisk.files['Research/A.md'] = newHash;
ws.branches.save(branchOnDisk);

const after = ws.branches.load('testbranch');
console.log('after save branch files:', JSON.stringify(after.files));
const afterHash = after.files['Research/A.md'];
console.log('after save blob:', ws.branches.cas.getText(afterHash));

const applied = ws.branches.apply('testbranch');
console.log('apply result:', applied);
console.log('vault A.md now:', JSON.stringify(fs.readFileSync(path.join(root, 'Research', 'A.md'), 'utf8')));
