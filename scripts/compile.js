'use strict';

const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

const ROOT = path.join(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const TEST_HELPERS = path.join(ROOT, 'test', 'helpers');
const OUTPUT = path.join(ROOT, 'artifacts', 'contracts.json');

function solidityFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return solidityFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.sol') ? [absolute] : [];
  });
}

function sourceName(absolute) {
  return path.relative(ROOT, absolute).replaceAll('\\', '/');
}

function compileContracts() {
  const sources = Object.fromEntries(
    [CONTRACTS, TEST_HELPERS]
      .flatMap((directory) => solidityFiles(directory))
      .map((absolute) => [sourceName(absolute), { content: fs.readFileSync(absolute, 'utf8') }]),
  );
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      viaIR: true,
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const messages = output.errors || [];
  for (const message of messages.filter((item) => item.severity !== 'error')) {
    console.warn(message.formattedMessage.trim());
  }
  const errors = messages.filter((item) => item.severity === 'error');
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join('\n'));

  const artifacts = { compiler: solc.version(), settings: input.settings, contracts: {} };
  for (const [file, contracts] of Object.entries(output.contracts || {})) {
    for (const [name, contract] of Object.entries(contracts)) {
      if (artifacts.contracts[name]) throw new Error(`Duplicate contract name: ${name}`);
      artifacts.contracts[name] = {
        sourceName: file,
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
        deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
      };
      console.log(`compiled ${name} (${file})`);
    }
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(artifacts, null, 2)}\n`);
  console.log(`artifacts written: ${OUTPUT}`);
  return artifacts;
}

if (require.main === module) {
  try {
    compileContracts();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { compileContracts };
