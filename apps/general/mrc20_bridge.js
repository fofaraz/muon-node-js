const { ethCall, soliditySha3, BN, bs58, solana, getBaseChain } = MuonAppUtils

const ABI_getTx = [
  {
    inputs: [{ internalType: 'uint256', name: '_txId', type: 'uint256' }],
    name: 'getTx',
    outputs: [
      { internalType: 'uint256', name: 'txId', type: 'uint256' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint256', name: 'fromChain', type: 'uint256' },
      { internalType: 'uint256', name: 'toChain', type: 'uint256' },
      { internalType: 'address', name: 'user', type: 'address' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

/**
 * Solana Mrc20Bridge account types
 */
const AccountTypes = {
  NotInitialized: 0,
  SettingsAccount: 1,
  SideContractInfo: 2,
  TokenInfoAccount: 3,
  DepositInfoAccount: 4,
  ClaimInfoAccount: 5
}

/**
 * Solana Mrc20Bridge DepositInfo storage account
 */
class DepositInfo {
  user = new Uint8Array();
  tokenId = new BN('0');
  txId = new BN('0');
  fromChain = new BN('0');
  toChain = new BN('0');
  amount = BigInt(0);
  timestamp = BigInt(0);

  get key(){
    return AccountTypes.DepositInfoAccount;
  }

  constructor(fields) {
    if (fields) {
      this.user = fields.user
      this.tokenId = fields.tokenId
      this.txId = fields.txId
      this.fromChain = fields.fromChain
      this.toChain = fields.toChain
      this.amount = fields.amount
      this.timestamp = fields.timestamp
    }
  }
}

/**
 * Borsh schema definition for DepositInfo
 */
export const DepositInfoSchema = new Map([
  [DepositInfo, {kind: 'struct', fields: [
      ['key', 'u8'],
      ['user', [32]],
      ['tokenId', 'u256'],
      ['txId', 'u256'],
      ['fromChain', 'u256'],
      ['toChain', 'u256'],
      ['amount', 'u64'],
      ['timestamp', 'u64']
    ]}],
]);

module.exports = {
  APP_NAME: 'mrc20_bridge',
  APP_ID: 5,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'claim':
        let { depositAddress, depositTxId, depositNetwork = 'eth' } = params
        if (!depositAddress) throw { message: 'Invalid contarct address' }

        const baseChain = getBaseChain(depositNetwork);

        if(baseChain === 'solana'){
          let result = await solana.getAccountInfo(depositNetwork, depositAddress);
          let data = solana.decodeAccountData(result, DepositInfoSchema, DepositInfo);
          // console.log(result)
          const programId = result.owner.toBase58()
          const user = bs58.encode(Buffer.from(data.user))
          return {
            solana: {
              programId,
              user,
            },
            // original: data,
            // key: data.key.toString(10),
            user: solana.pubkeyToEthAddress(user),
            tokenId: '0x'+data.tokenId.toString('hex'),
            txId: '0x'+data.txId.toString('hex'),
            fromChain: '0x'+data.fromChain.toString('hex'),
            toChain: '0x'+data.toChain.toString('hex'),
            amount: data.amount.toString(10),
            timestamp: data.timestamp.toString(10),
          };
        }
        else if(baseChain === 'ethereum') {
          if (!depositTxId)
            throw { message: 'Invalid deposit Tx Id' }
          let result = await ethCall(
            depositAddress,
            'getTx',
            [depositTxId],
            ABI_getTx,
            depositNetwork
          )
          return result
        }
        else {
          throw {message: `Unknown deposit network: ${depositNetwork}`}
        }
      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  hashRequestResult: function (request, result) {
    let { method } = request

    switch (method) {
      case 'claim':
        let { depositAddress, depositNetwork } = params
        let { txId, tokenId, amount, fromChain, toChain, user } = result
        if(depositNetwork.startsWith('sol-')){
          let {solana: {programId}} = result;
          depositAddress = solana.pubkeyToEthAddress(programId);
        }
        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'uint256', value: txId },
          { type: 'uint256', value: tokenId },
          { type: 'uint256', value: amount },
          { type: 'uint256', value: fromChain },
          { type: 'uint256', value: toChain },
          { type: 'address', value: user }
        ])

      default:
        return null
    }
  }
}
