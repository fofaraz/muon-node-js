import {Router} from 'express';
import * as NetworkIpc from '../network/ipc.js'
import lodash from 'lodash'
import asyncHandler from 'express-async-handler'
import {getCommitId, readFileTail} from "../utils/helpers.js";

const NodeAddress = process.env.SIGN_WALLET_ADDRESS || null;
const PeerID = process.env.PEER_ID || null

const router = Router();

router.use('/', asyncHandler(async (req, res, next) => {
  const [netConfig, nodeInfo, multiAddress, uptime, commitId] = await Promise.all([
    NetworkIpc.getNetworkConfig({
      timeout: 1000,
    }).catch(e => null),
    NetworkIpc.getCurrentNodeInfo({
      timeout: 1000,
      timeoutMessage: "Getting current node info timed out"
    }).catch(e => null),
    NetworkIpc.getNodeMultiAddress({
      timeout: 1000,
    }).catch(e => null),
    NetworkIpc.getUptime({
      timeout: 1000,
    }).catch(e => null),
    getCommitId().catch(e => null)
  ]);

  let autoUpdateLogs: string|undefined = undefined;
  if(req.query.au !== undefined) {
    // @ts-ignore
    const n = parseInt(req.query.au) || 100;
    autoUpdateLogs = await readFileTail("auto-update.log", n);
  }

  let discordVerification=process.env.DISCORD_VERIFICATION;

  res.json({
    discordVerification,
    staker: nodeInfo ? nodeInfo.staker : undefined,
    address: NodeAddress,
    peerId: PeerID,
    networkingPort: process.env.PEER_PORT,
    node: {
      addedToNetwork: !!nodeInfo,
      staker: nodeInfo ? nodeInfo.staker : undefined,
      address: NodeAddress,
      peerId: PeerID,
      networkingPort: process.env.PEER_PORT,
      uptime,
      commitId,
      autoUpdateLogs,
      timestamp: Date.now()
    },
    managerContract: {
      network: netConfig?.nodeManager?.network,
      address: netConfig?.nodeManager?.address,
    },
    addedToNetwork: !!nodeInfo,
    network: {
      nodeInfo: nodeInfo ? lodash.omit(nodeInfo || {}, ['peerId', 'wallet', 'staker']) : undefined,
      address: multiAddress,
    }
  })
}))

export default router;
