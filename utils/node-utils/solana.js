const {
  AccountInfo,
  Keypair,
  Connection,
  PublicKey,
} = require('@solana/web3.js');
import * as borsh from "borsh";
const {utils: {keccak256, toChecksumAddress}} = require('web3');
const {nameToChainIdMap} = require('../constants')

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const baseX = require('base-x');
const HEX = '0123456789abcdef';
const hex = baseX(HEX);
const bs58 = baseX(BASE58);

const SOLANA_MAINNET_ID = nameToChainIdMap["sol-mainnet"]
const SOLANA_TESTNET_ID = nameToChainIdMap["sol-testnet"]
const SOLANA_DEVNET_ID = nameToChainIdMap["sol-devnet"]
const SOLANA_LOCALNET_ID = nameToChainIdMap["sol-local"]

const connections = {
  [SOLANA_MAINNET_ID]: null,
  [SOLANA_TESTNET_ID]: null,
  [SOLANA_DEVNET_ID]: null,
  [SOLANA_LOCALNET_ID]: null
}

function getRpcUrl(cluster) {
  if(nameToChainIdMap[cluster])
    cluster = nameToChainIdMap[cluster]

  const clusterRpcEndpoints = {
    [SOLANA_MAINNET_ID]: "https://api.mainnet-beta.solana.com",
    [SOLANA_TESTNET_ID]: "https://api.testnet.solana.com",
    [SOLANA_DEVNET_ID]: "https://api.devnet.solana.com",
    [SOLANA_LOCALNET_ID]: "http://localhost:8899",
  }

  if(!clusterRpcEndpoints[cluster])
    throw {message: `Unknown solana cluster ${cluster}.`}

  return clusterRpcEndpoints[cluster];
}

async function establishConnection(cluster) {
  const rpcUrl = getRpcUrl(cluster);
  return new Connection(rpcUrl, 'confirmed');
}

async function init() {
  connections[SOLANA_MAINNET_ID] = await establishConnection("sol-mainnet");
  connections[SOLANA_TESTNET_ID] = await establishConnection("sol-testnet");
  connections[SOLANA_DEVNET_ID] = await establishConnection("sol-devnet");
}
init();

function getClusterConnection(cluster) {
  if(nameToChainIdMap[cluster])
    cluster = nameToChainIdMap[cluster]
  return connections[cluster];
}

export async function getAccountInfo(cluster, address) {
  const publicKey = new PublicKey(address);
  return await getClusterConnection(cluster).getAccountInfo(publicKey);
}

export function decodeAccountData(accountInfo, schema, constructor) {
  return borsh.deserialize(
    schema,
    constructor,
    accountInfo.data
  )
}

export function pubkeyToEthAddress(pubkey) {
  let pubKeyBuffer = bs58.decode(pubkey);
  let pub_hash = keccak256(pubKeyBuffer)
  return toChecksumAddress('0x' + pub_hash.substr(-40));
}
