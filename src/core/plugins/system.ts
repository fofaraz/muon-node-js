import CallablePlugin from './base/callable-plugin.js'
import {remoteApp, remoteMethod, appApiMethod, broadcastHandler} from './base/app-decorators.js'
import CollateralInfoPlugin from "./collateral-info";
import TssPlugin from "./tss-plugin";
import {AppContext, AppDeploymentInfo, AppRequest, JsonPublicKey, MuonNodeInfo} from "../../common/types";
import {soliditySha3} from '../../utils/sha3.js'
import * as TssModule from '../../utils/tss/index.js'
import AppContextModel from "../../common/db-models/app-context.js"
import AppTssConfigModel from "../../common/db-models/app-tss-config.js"
import * as NetworkIpc from '../../network/ipc.js'
import DistributedKey from "../../utils/tss/distributed-key.js";
import AppManager from "./app-manager.js";
import * as CoreIpc from '../ipc.js'
import {useOneTime} from "../../utils/tss/use-one-time.js";
import {logger} from '@libp2p/logger'
import {pub2json, timeout, uuid} from '../../utils/helpers.js'
import {bn2hex, toBN} from "../../utils/tss/utils.js";
import axios from 'axios'
import {MapOf} from "../../common/mpc/types";
import _ from 'lodash'
import TssParty from "../../utils/tss/party";
import BaseAppPlugin from "./base/base-app-plugin";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Rand = require('rand-seed').default;

const log = logger("muon:core:plugins:system");

const RemoteMethods = {
  GenerateAppTss: "generateAppTss",
  Undeploy: "undeploy",
  GetAppPublicKey: "getAppPubKey",
  StartAppTssReshare: "startAppTssReshare",
  AppAddNewParty: "appAddNewParty",
  ReshareAppTss: "reshareAppTss"
}

@remoteApp
class System extends CallablePlugin {
  APP_NAME = 'system'

  get collateralPlugin(): CollateralInfoPlugin {
    return this.muon.getPlugin('collateral');
  }

  get tssPlugin(): TssPlugin{
    return this.muon.getPlugin('tss-plugin');
  }

  get appManager(): AppManager{
    return this.muon.getPlugin('app-manager');
  }

  private async getAvailableNodes(): Promise<MuonNodeInfo[]> {
    const externalOnlineList = this.muon.configs.net.nodes?.onlineList;
    let availableIds: string[] = [];

    const isDeployer: {[index: string]: string} = this.collateralPlugin
      .filterNodes({isDeployer: true})
      .map(node => node.id)
      .reduce((obj, current) => (obj[current]=true, obj), {});

    if(externalOnlineList){
      let response = await axios.get(externalOnlineList).then(({data}) => data);
      let availables = response.result.filter(item => {
        /** active nodes that has uptime more than 1 hour */
        // return item.isDeployer || (item.active && item.status_is_ok && parseInt(item.uptime) > 60*60)
        return item.isDeployer || (
          item.active &&
          item.tests.peerInfo &&
          item.uptime >= 5*60 &&
          item.tests.healthy &&
          item.tests.responseTimeRank <= 2
        )
      })
      availableIds = availables.map(p => `${p.id}`)
    }
    else {
      const delegateRoutingUrl = this.muon.configs.net.routing?.delegate;
      if(!delegateRoutingUrl)
        throw `delegate routing url not defined to get available list.`
      let response = await axios.get(`${delegateRoutingUrl}/onlines`).then(({data}) => data);
      let thresholdTimestamp = Date.now() - 60*60*1000
      let availables = response.filter(item => {
        /** active nodes that has uptime more than 1 hour */
        return isDeployer[item.id] || (item.timestamp > thresholdTimestamp)
      })
      availableIds = availables.map(p => p.id)
    }

    const onlineNodes = this.collateralPlugin.filterNodes({list: availableIds, excludeSelf: true})
    const currentNodeInfo = this.collateralPlugin.getNodeInfo(process.env.PEER_ID!)
    return [
      currentNodeInfo!,
      ...onlineNodes
    ]
  }

  @broadcastHandler
  async __broadcastHandler(data, callerInfo: MuonNodeInfo) {
    const {type, details} = data||{};
    switch (type) {
      case 'undeploy': {
        if(!callerInfo.isDeployer)
          return;
        const {appId, deploymentTimestamp} = details || {}
        this.__undeployApp({appId, deploymentTimestamp}, callerInfo)
          .catch(e => {})
        break;
      }
    }
  }

  @appApiMethod()
  getNetworkConfigs() {
    return this.muon.configs.net;
  }

  @appApiMethod({})
  async selectRandomNodes(seed, t, n): Promise<MuonNodeInfo[]> {
    const availableNodes = await this.getAvailableNodes();
    if(availableNodes.length < t){
      throw "Insufficient nodes for subnet creation";
    }
    if(availableNodes.length < n) {
      n = availableNodes.length;
    }

    // nodeId => MuonNodeInfo
    let availableNodesMap: MapOf<MuonNodeInfo> = {};
    availableNodes.map(node => availableNodesMap[node.id]=node);

    const rand = new Rand(seed);
    let selectedNodes: MuonNodeInfo[] = [], rndNode:number = 0;

    /** The available list may not be sorted by id */
    let maxId: number = availableNodes.reduce((max, n) => Math.max(max, parseInt(n.id)), 0)

    const selectedIds: string[] = []
    while(selectedIds.length != n){
      rndNode = Math.floor(rand.next() * maxId) + 1;

      // Only active ids will be added to selectedNodes.
      // The process works fine even if the available
      // nodes change during deployment, as long as the
      // updated nodes are not in the selected list.
      if(availableNodesMap[rndNode]){
        const currentId = availableNodesMap[rndNode].id;
        if(!selectedIds.includes(currentId)) {
          selectedIds.push(currentId);
          selectedNodes.push(availableNodesMap[rndNode]);
        }
      }
    }
    return selectedNodes;
  }

  getAppTssKeyId(appId, seed) {
    return `app-${appId}-tss-${seed}`
  }

  @appApiMethod({})
  getAppDeploymentInfo(appId: string, seed: string): AppDeploymentInfo {
    return this.appManager.getAppDeploymentInfo(appId, seed)
  }

  @appApiMethod({})
  getAppLastDeploymentInfo(appId: string): AppDeploymentInfo {
    const context = this.appManager.getAppLastContext(appId)
    return this.appManager.getAppDeploymentInfo(appId, context?.seed);
  }

  @appApiMethod({})
  async generateAppTss(appId, seed) {
    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App deployment info not found.`

    const generatorInfo = this.collateralPlugin.getNodeInfo(context.party.partners[0])!
    if(generatorInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
      return await this.__generateAppTss({appId, seed}, this.collateralPlugin.currentNodeInfo);
    }
    else {
      // TODO: if partner is not online
      return await this.remoteCall(
        generatorInfo.peerId,
        RemoteMethods.GenerateAppTss,
        {appId, seed},
        {timeout: 65e3}
      )
    }
  }

  @appApiMethod({})
  async reshareAppTss(appId, seed) {
    const newContext = this.appManager.getAppContext(appId, seed);
    if(!newContext)
      throw `App's new context not found.`

    const generatorInfo = this.collateralPlugin.getNodeInfo(newContext.party.partners[0])!
    if(generatorInfo.wallet === process.env.SIGN_WALLET_ADDRESS){
      return await this.__startAppTssReshare({appId, seed}, this.collateralPlugin.currentNodeInfo);
    }
    else {
      // TODO: if partner is not online
      return await this.remoteCall(
        generatorInfo.peerId,
        RemoteMethods.StartAppTssReshare,
        {appId, seed},
        {timeout: 65e3}
      )
    }
  }

  @appApiMethod({})
  async getAppTss(appId) {
    const context = await AppContextModel.findOne({appId}).exec();
    if(!context)
      throw `App deployment info not found.`
    const id = this.getAppTssKeyId(appId, context.seed)
    let key = await this.tssPlugin.getSharedKey(id)
    return key
  }

  @appApiMethod({})
  async findAndGetAppPublicKey(appId: string, seed: string, keyId: string): Promise<JsonPublicKey> {
    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
    const appPartners: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      list: context.party.partners
    })

    let responses = await Promise.all(appPartners.map(node => {
      if(node.id === this.collateralPlugin.currentNodeInfo?.id) {
        return this.__getAppPublicKey({appId, seed, keyId}, this.collateralPlugin.currentNodeInfo)
          .catch(e => {
            log.error(e.message)
            return 'error'
          })
      }
      else {
        return this.remoteCall(
          node.peerId,
          RemoteMethods.GetAppPublicKey,
          {appId, seed, keyId}
        )
          .catch(e => {
            log.error(e.message)
            return 'error'
          })
      }
    }))

    console.log({
      appId,
      seed,
      responses
    })

    let counts: MapOf<number> = {}, max:string|null=null;
    for(const str of responses) {
      if(str === 'error')
        continue
      if(!counts[str])
        counts[str] = 1
      else
        counts[str] ++;
      if(!max || counts[str] > counts[max])
        max = str;
    }
    if(!max || counts[max] < context.party.t) {
      throw 'public key not found';
    }

    const publicKey = TssModule.keyFromPublic(max.replace("0x", ""), "hex")

    return pub2json(publicKey)
  }

  @appApiMethod({})
  async getDistributedKey(keyId) {
    let key = await this.tssPlugin.getSharedKey(keyId)
    if(!key)
      throw `Distributed key not found.`
    return key
  }

  async writeAppContextIntoDb(request, result) {
    let {method} = request
    let {appId} = request.data.params
    let {previousSeed, seed} = request.data.result
    const partners = result.selectedNodes

    await this.appManager.saveAppContext({
      appId,
      appName: this.muon.getAppNameById(appId),
      isBuiltIn: this.appManager.appIsBuiltIn(appId),
      previousSeed: method === 'tss-rotate' ? previousSeed : undefined,
      seed,
      party: {
        t: result.tssThreshold,
        max: result.maxGroupSize,
        partners,
      },
      rotationEnabled: result.rotationEnabled,
      ttl: result.ttl,
      pendingPeriod: result.pendingPeriod,
      expiration: result.expiration,
      deploymentRequest: request
    })

    return true
  }

  @appApiMethod({})
  async appDeploymentConfirmed(request: AppRequest, result) {
    /** store app context */
    try {
      const context = await this.writeAppContextIntoDb(request, result);
    }
    catch (e) {
      log.error("error on calling appDeploymentConfirmed %O", e)
      throw e
    }

    return true;
  }

  @appApiMethod({})
  async appKeyGenConfirmed(request: AppRequest) {
    const {
      data: {
        params: {appId},
        init: {id: keyId},
        result: {rotationEnabled, ttl, expiration, seed, publicKey},
      }
    } = request;

    /** check context exist */
    const context = await AppContextModel.findOne({appId}).exec();
    if(!context) {
      throw `App deployment info not found to process tss KeyGen confirmation.`
    }

    const currentNode = this.collateralPlugin.currentNodeInfo!;
    if(context.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?

      /** The current node can store the key only when it has participated in key generation. */
      if(request.data.init.keyGenerators.includes(currentNode.id)) {
        /** store tss key */
        let key: DistributedKey = await this.tssPlugin.getSharedKey(keyId)!
        await useOneTime("key", key.publicKey!.encode('hex', true), `app-${appId}-tss`)
        await this.appManager.saveAppTssConfig({
          appId: appId,
          seed,
          keyGenRequest: request,
          publicKey: pub2json(key.publicKey!),
          keyShare: bn2hex(key.share!),
          expiration,
        })
      }
      /** Otherwise, it should recover it's key. */
      else {
        for(let numTry = 3 ; numTry > 0 ; numTry--) {
          /** Wait for a moment in order to let the other nodes get ready. */
          await timeout(10000);
          try {
            const recovered = await this.tssPlugin.checkAppTssKeyRecovery(appId, seed);
            if(recovered) {
              log(`tss key recovered successfully.`)
              break;
            }
          }
          catch (e) {
            log.error('error when recovering tss key. %O', e)
          }
        }
      }
    }
    else {
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey: request.data.init.publicKey,
        expiration,
      })
    }
  }

  @appApiMethod({})
  async appReshareConfirmed(request: AppRequest) {
    const {
      data: {
        params: {appId},
        init: {id: reshareKeyId, keyGenerators},
        result: {expiration, seed, publicKey},
      }
    } = request;

    /** check context exist */
    const newContext = await this.appManager.getAppContext(appId, seed);
    if(!newContext) {
      throw `App new context not found in app reshare confirmation.`
    }

    const currentNode = this.collateralPlugin.currentNodeInfo!;
    if(newContext.party.partners.includes(currentNode.id)) {
      // TODO: check context has key or not ?

      const prevContext = await this.appManager.getAppContextAsync(appId, newContext.previousSeed, true)
      if(!prevContext) {
        throw `App previous context not found in app reshare confirmation.`
      }

      const overlapPartners = newContext.party.partners.filter(id => prevContext.party.partners.includes(id));
      /** The current node can reshare immediately if it is in the overlap partners. */
      if(
        /** Node in the overlap party */
        overlapPartners.includes(currentNode.id)
        /** Node has the old key */
        && this.appManager.appHasTssKey(appId, prevContext.seed)
        /** Node has participated in reshare key generation */
        && keyGenerators.includes(currentNode.id)
      ) {
        let reshareKey: DistributedKey = await this.tssPlugin.getSharedKey(reshareKeyId)!
        /**
         Mark the reshareKey as used for app TSS key.
         If anyone tries to use this key for a different purpose, it will cause an error.
         Likewise, if this key has been used for another purpose before, it will throw an error again.
         */
        await useOneTime("key", reshareKey.publicKey!.encode('hex', true), `app-${appId}-reshare`)

        const oldKey: DistributedKey = this.tssPlugin.getAppTssKey(appId, newContext.previousSeed)!
        if (!oldKey)
          throw `The old party's TSS key was not found.`
        /**
         Mark the oldKey as used for app TSS key.
         If anyone tries to use this key for a different purpose, it will cause an error.
         Likewise, if this key has been used for another purpose before, it will throw an error again.
         */
        await useOneTime("key", oldKey.publicKey!.encode('hex', true), `app-${appId}-tss`)


        const appParty = this.tssPlugin.getAppParty(appId, seed)!
        if (!appParty)
          throw `App party not found`;

        const hexSeed = "0x" + BigInt(seed).toString(16)
        let share = oldKey.share!.add(reshareKey.share!).sub(toBN(hexSeed)).umod(TssModule.curve.n!);

        /** store tss key */
        await this.appManager.saveAppTssConfig({
          appId: appId,
          seed,
          keyGenRequest: request,
          publicKey,
          keyShare: bn2hex(share),
          expiration,
        })
      }
      /** Otherwise, it has to wait and try to recover its key later. */
      else {
        log(`current node is not in the party overlap. it should recover the key.`)

        for(let numTry=3 ; numTry > 0 ; numTry--) {
          await timeout(10000);
          try {
            const recovered = await this.tssPlugin.checkAppTssKeyRecovery(appId, seed);
            if(recovered) {
              log(`tss key recovered successfully.`)
              break;
            }
          }
          catch (e) {
            log.error('error when recovering tss key. %O', e)
          }
        }
      }
    }
    else {
      await this.appManager.saveAppTssConfig({
        appId: appId,
        seed,
        keyGenRequest: request,
        publicKey,
        expiration,
      })
    }
  }

  @appApiMethod({})
  async undeployApp(appNameOrId: string) {
    let app = this.muon.getAppById(appNameOrId) || this.muon.getAppByName(appNameOrId);
    if(!app)
      throw `App not found by identifier: ${appNameOrId}`
    const appId = app.APP_ID

    /** check app to be deployed */
    const seeds = this.appManager.getAppSeeds(appId);

    /** check app context */
    let allContexts: AppContext[] = this.appManager.getAppAllContext(appId, true);

    /** most recent deployment time */
    const deploymentTimestamp = allContexts
      .map(ctx => ctx.deploymentRequest?.data.timestamp!)
      .sort((a, b) => b - a)[0]

    let appPartners: string[] = [].concat(
      // @ts-ignore
      ...allContexts.map(ctx => ctx.party.partners),
    )

    let deployers: string[] = this.collateralPlugin.filterNodes({isDeployer: true}).map(p => p.id)

    const partnersToCall: MuonNodeInfo[] = this.collateralPlugin.filterNodes({
      list: [
        ...deployers,
        ...appPartners
      ]
    })
    log(`removing app contexts from nodes %o`, partnersToCall.map(p => p.id))
    await Promise.all(partnersToCall.map(node => {
      if(node.wallet === process.env.SIGN_WALLET_ADDRESS) {
        return this.__undeployApp({appId, deploymentTimestamp}, this.collateralPlugin.currentNodeInfo)
          .catch(e => {
            log.error(`error when undeploy at current node: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
      else{
        return this.remoteCall(
          node.peerId,
          RemoteMethods.Undeploy,
          {appId, deploymentTimestamp}
        )
          .catch(e => {
            log.error(`error when undeploy at ${node.peerId}: %O`, e)
            return e?.message || "unknown error occurred"
          });
      }
    }))

    this.broadcast({type: "undeploy", details: {
        appId,
        deploymentTimestamp
    }})
  }

  @appApiMethod({})
  async getAppContext(appId, seed, tryFromNetwork:boolean=false) {
    return this.appManager.getAppContextAsync(appId, seed, tryFromNetwork)
  }

  @appApiMethod({})
  getAppTTL(appId: number): number {
    const tssConfigs = this.muon.configs.net.tss;
    const app: BaseAppPlugin = this.muon.getAppById(appId)
    return app.TTL ?? tssConfigs.defaultTTL;
  }

  /**
   * Remote methods
   */

  @remoteMethod(RemoteMethods.GenerateAppTss)
  async __generateAppTss({appId, seed}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});
    if(!callerInfo.isDeployer)
      throw `Only deployers can call System.__generateAppTss`;

    const context = this.appManager.getAppContext(appId, seed);
    if(!context)
      throw `App deployment info not found.`

    /** check key not created before */
    if(context.publicKey?.encoded) {
      throw `App context already has key`
    }

    const partyId = this.tssPlugin.getAppPartyId(context)

    await this.tssPlugin.createParty({
      id: partyId,
      t: context.party.t,
      partners: context.party.partners,//.map(wallet => this.collateralPlugin.getNodeInfo(wallet))
    });

    let key = await this.tssPlugin.keyGen({appId, seed}, {timeout: 65e3, lowerThanHalfN: true})

    return {
      id: key.id,
      publicKey: pub2json(key.publicKey!),
      generators: key.partners
    }
  }

  @remoteMethod(RemoteMethods.StartAppTssReshare)
  async __startAppTssReshare({appId, seed}, callerInfo) {
    // console.log(`System.__generateAppTss`, {appId});
    if(!callerInfo.isDeployer)
      throw `Only deployers can call System.__reshareAppTss`;

    const newContext: AppContext = this.appManager.getAppContext(appId, seed);
    if(!newContext)
      throw `App's new context not found.`

    const oldContext: AppContext = this.appManager.getAppContext(appId, newContext.previousSeed);
    if(!oldContext)
      throw `App's previous context not found.`

    log(`generating nonce for resharing app[${appId}] tss key`)
    const resharePartners = newContext.party.partners.filter(id => oldContext.party.partners.includes(id))
    let nonce = await this.tssPlugin.keyGen({appId, seed}, {
      id: `resharing-${uuid()}`,
      partners: _.uniq([
        this.collateralPlugin.currentNodeInfo!.id,
        ...resharePartners,
      ]),
      value: newContext.seed
    });
    log(`Nonce generated for resharing app[${appId}] tss key.`)

    return {
      id: nonce.id,
      /** The TSS key's publicKey will remain unchanged when it is reshared. */
      publicKey: oldContext.publicKey!.encoded,
      generators: nonce.partners
    }
  }

  @remoteMethod(RemoteMethods.Undeploy)
  async __undeployApp(data: {appId, deploymentTimestamp}, callerInfo) {
    if(!callerInfo.isDeployer)
      throw `Only deployer can call this method`;
    let {appId, deploymentTimestamp} = data;

    log(`deleting app from persistent db %s`, appId);
    /** get list of old contexts */
    const allContexts = await AppContextModel.find({appId})
    const deleteContextList: any[] = []

    for(let context of allContexts) {
      /** select context to be deleted */
      if(context.deploymentRequest.data.timestamp <= deploymentTimestamp) {
        deleteContextList.push(context)
      }
    }
    const seedsToDelete = deleteContextList.map(c => c.seed)
    await AppContextModel.deleteMany({
      $or: [
        /** for backward compatibility. old keys may not have this field. */
        {seed: { "$exists" : false }},
        {seed: {$in: seedsToDelete}},
      ]
    });

    await AppTssConfigModel.deleteMany({
      appId,
      $or: [
        /** for backward compatibility. old keys may not have this field. */
        {seed: { "$exists" : false }},
        {seed: {$in: seedsToDelete}},
      ]
    });
    log(`deleting app from memory of all cluster %s`, appId)
    CoreIpc.fireEvent({type: 'app-context:delete', data: {contexts: deleteContextList}})
  }

  @remoteMethod(RemoteMethods.GetAppPublicKey)
  async __getAppPublicKey(data: {appId: string, seed: string, keyId}, callerInfo) {
    const {appId, seed, keyId} = data;

    const context = this.appManager.getAppContext(appId, seed)
    if(!context)
      throw `App deployment info not found.`
    let key = await this.tssPlugin.getSharedKey(keyId)
    // let key = await this.tssPlugin.getAppTssKey(appId, seed)
    if(!key)
      throw `App tss key not found.`

    return "0x" + key.publicKey!.encode("hex", true)
  }

  @remoteMethod(RemoteMethods.AppAddNewParty)
  async __addNewPartyToOldParty(data: {appId: string, seed: string, previousSeed: string, nonce: string}, callerInfo) {
    const {appId, seed, previousSeed, nonce: nonceId} = data

    const nonce = await this.tssPlugin.getSharedKey(nonceId);

    let newContext: AppContext|undefined = this.appManager.getAppContext(appId, seed)
    if(!newContext) {
      const allAppContexts: AppContext[] = await this.appManager.queryAndLoadAppContext(appId, {seeds: [seed, previousSeed], includeExpired: true})
      newContext = allAppContexts.find(ctx => ctx.seed === seed);

      if(!newContext)
      throw `current context not found`
    }
    const oldContext: AppContext = this.appManager.getAppContext(appId, newContext.previousSeed)
    if(!oldContext)
      throw `previews context not found`

    if(this.appManager.appHasTssKey(appId, oldContext.seed))
      throw `The app already has a previous party's TSS key.`

    const oldKeyHoldersId: string[] = nonce.partners
      .filter(id => oldContext.party.partners.includes(id))
    const oldKeyHolders: MuonNodeInfo[] = this.collateralPlugin.filterNodes({list: oldKeyHoldersId})
    let previousKey: DistributedKey = await this.tssPlugin.recoverAppTssKey(
      appId,
      oldContext.seed,
      oldKeyHolders,
      nonce,
      newContext.seed
    )

    const keyGenRequest: AppRequest = oldContext.keyGenRequest as AppRequest

    await this.appManager.saveAppTssConfig({
      appId,
      seed: oldContext.seed,
      keyGenRequest,
      publicKey: pub2json(previousKey.publicKey!),
      keyShare: bn2hex(previousKey.share!),
      expiration: keyGenRequest.data.result.expiration,
    })

    return previousKey.toSerializable();
  }

}

export default System
