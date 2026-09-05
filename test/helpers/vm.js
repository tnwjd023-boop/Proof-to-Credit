'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Chain, Common, Hardfork } = require('@ethereumjs/common');
const { hexToBytes } = require('@ethereumjs/util');
const { VM } = require('@ethereumjs/vm');
const { Interface, toBeHex, zeroPadValue } = require('ethers');

const ARTIFACT_PATH = path.join(__dirname, '..', '..', 'artifacts', 'contracts.json');

function loadArtifact(name) {
  if (!fs.existsSync(ARTIFACT_PATH)) throw new Error('Missing artifacts; run node scripts/compile.js first');
  const bundle = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const artifact = bundle.contracts[name];
  if (!artifact) throw new Error(`Artifact not found: ${name}`);
  if (!artifact.deployedBytecode || artifact.deployedBytecode === '0x') {
    throw new Error(`Artifact has no deployed bytecode: ${name}`);
  }
  return artifact;
}

async function runPureLibrary(contractName, functionName, args) {
  const artifact = loadArtifact(contractName);
  const iface = new Interface(artifact.abi);
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Paris });
  const vm = await VM.create({ common });
  const result = await vm.evm.runCode({
    code: hexToBytes(artifact.deployedBytecode),
    data: hexToBytes(iface.encodeFunctionData(functionName, args)),
    gasLimit: 30_000_000n,
    isStatic: true,
  });
  if (result.exceptionError) throw new Error(`EVM revert: ${result.exceptionError.error}`);
  return iface.decodeFunctionResult(functionName, result.returnValue);
}

function replaceFirstWord(encoded, value) {
  return `${zeroPadValue(toBeHex(value), 32)}${encoded.slice(66)}`;
}

module.exports = { loadArtifact, replaceFirstWord, runPureLibrary };
