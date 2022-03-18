const {utils: {toBN, BN, isBN}} = require('web3');
var numberToBN = require('number-to-bn');
/**
 * chain ID contains 8 bytes of information.
 * bytes [0:1]: base chain identifier
 * bytes [2:7]: chain ID
 *
 */

const SOLANA_BASE_CHAIN_ID_INC = toBN('0x01').shln(56);

const nameToChainIdMap = {
  local: 'ganache',
  eth: 1, // Ethereum mainnet
  ropsten: 3, // Ethereum ropsten testnet
  rinkeby: 4, // Ethereum rinkeby testnet
  bsc: 56, // Binance Smart Chain mainnet
  bsctest: 97, // Binance Smart Chain testnet
  ftm: 250, // Fantom mainnet
  ftmtest: 4002, // Fantom testnet
  xdai: 100, // Xdai mainnet
  sokol: 77, // Xdai testnet
  polygon: 137, // polygon mainnet
  mumbai: 80001, // Polygon mumbai testnet
  fuji: 43113, // Avalanche Fuji Testnet
  avax: 43114, // Avalanche Mainnet
  arbitrumTestnet: 421611, //Arbitrum Testnet
  arbitrum: 42161, // Arbitrum
  metis: 1088, // Metis


  /**
   * Solana chain IDs
   * All chain IDs added with base increment
   * baseIncrement:
   */
  "sol-mainnet": "0x" + SOLANA_BASE_CHAIN_ID_INC.addn(101).toString('hex'),
  "sol-testnet": "0x" + SOLANA_BASE_CHAIN_ID_INC.addn(102).toString('hex'),
  "sol-devnet": "0x" + SOLANA_BASE_CHAIN_ID_INC.addn(103).toString('hex'),
  "sol-local": 'sol-local'
}

function getBaseChain(chainId) {
  if(nameToChainIdMap[chainId])
    chainId = nameToChainIdMap[chainId]
  try {
    chainId = numberToBN(chainId);
  }
  catch (e) {
    return null;
  }
  let baseChainIndex = '0x' + chainId.shrn(56).toBuffer('be').toString('hex');
  switch (baseChainIndex) {
    case '0x00':
      return 'ethereum';
    case '0x01':
      return 'solana';
    default:
      return null
  }
}

module.exports = {
  nameToChainIdMap,
  getBaseChain,
}
