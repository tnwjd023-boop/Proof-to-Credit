'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

test('CI runs the offline verification pipeline on main pushes and pull requests', () => {
  assert.equal(fs.existsSync(workflowPath), true, 'expected .github/workflows/ci.yml');

  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /^name: CI$/m);
  assert.match(workflow, /^  push:$/m);
  assert.match(workflow, /^      - main$/m);
  assert.match(workflow, /^  pull_request:$/m);
  assert.match(workflow, /^permissions:\s*\n  contents: read$/m);
  assert.match(workflow, /^    runs-on: ubuntu-latest$/m);
  assert.match(workflow, /^    timeout-minutes: 10$/m);
  assert.match(workflow, /^          node-version: 22$/m);
  assert.match(workflow, /^          cache: npm$/m);

  const commands = ['run: npm ci', 'run: npm run compile', 'run: npm test'];
  const positions = commands.map((command) => workflow.indexOf(command));
  assert.ok(positions.every((position) => position >= 0), 'expected install, test, and compile commands');
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    'CI must compile ignored artifacts before tests consume them',
  );

  assert.doesNotMatch(workflow, /secrets\./i);
  assert.doesNotMatch(workflow, /PRIVATE_KEY|RPC_URL|broadcast/i);
});
