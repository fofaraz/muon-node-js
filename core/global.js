const axios = require('axios')
const Web3 = require('web3')
const web3Instance = new Web3()
const { toBaseUnit } = require('../utils/crypto')
const { timeout, floatToBN } = require('../utils/helpers')
const util = require('ethereumjs-util')
const ws = require('ws')
const ethSigUtil = require('eth-sig-util')
const {getBaseChain} = require('../utils/constants')
const {
  read: ethRead,
  call: ethCall,
  getTokenInfo: ethGetTokenInfo,
  getNftInfo: ethGetNftInfo,
  hashCallOutput: ethHashCallOutput
} = require('../utils/node-utils/eth')

const solana = require('../utils/node-utils/solana')

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const baseX = require('base-x');
const HEX = '0123456789abcdef';
const hex = baseX(HEX);
const bs58 = baseX(BASE58);

const { multiCall } = require('../utils/multicall')

function soliditySha3(params) {
  return web3Instance.utils.soliditySha3(...params)
}

global.MuonAppUtils = {
  axios,
  Web3,
  ws,
  timeout,
  hex,
  bs58,
  BN: Web3.utils.BN,
  toBN: Web3.utils.toBN,
  floatToBN,
  multiCall,
  ethRead,
  ethCall,
  ethGetTokenInfo,
  ethGetNftInfo,
  ethHashCallOutput,
  toBaseUnit,
  soliditySha3,
  ecRecover: util.ecrecover,
  recoverTypedSignature: ethSigUtil.recoverTypedSignature,
  recoverTypedMessage: ethSigUtil.recoverTypedMessage,

  getBaseChain,
  solana,
}
