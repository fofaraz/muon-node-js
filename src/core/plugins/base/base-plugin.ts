import Muon from "../../muon";
import {MuonNodeInfo, NetConfigs} from "../../../common/types";
import NodeManagerPlugin from "../node-manager.js";
import {logger} from '@libp2p/logger'
import Events from 'events-async'
import {fromString as uint8ArrayFromString} from 'uint8arrays/from-string'
import {toString as uint8ArrayToString} from 'uint8arrays/to-string'
import * as SharedMem from '../../../common/shared-memory/index.js'

const log = logger('muon:core:plugins:base')

export default class BasePlugin extends Events{
  private readonly _muon;
  configs = {}

  constructor(muon, configs){
    super()
    this._muon = muon
    this.configs = {...configs}
  }

  /**
   * This method will call immediately after plugin create.
   * @returns {Promise<void>}
   */
  async onInit(){
  }

  /**
   * This method will be called immediately after Muon starts.
   * @returns {Promise<void>}
   */
  async onStart(){
    await this.registerBroadcastHandler()
  }

  get muon(): Muon {
    return this._muon;
  }

  get netConfigs():NetConfigs {
    return this.muon.configs.net;
  }

  get peerId(){
    throw "peerId moved to network module"
    // return this.muon.peerId;
  }

  get ConstructorName() {
    let superClass = Object.getPrototypeOf(this);
    return superClass.constructor.name
  }

  protected get BROADCAST_CHANNEL(){
    // @ts-ignore
    if(this.__broadcastHandlerMethod === undefined)
      return null;
    // @ts-ignore
    return `muon.core.${this.ConstructorName}.${this.__broadcastHandlerMethod}`
  }

  async registerBroadcastHandler(){
    let broadcastChannel = this.BROADCAST_CHANNEL
    /*eslint no-undef: "error"*/
    if (broadcastChannel) {
      if(process.env.VERBOSE) {
        log('Subscribing to broadcast channel %s', this.BROADCAST_CHANNEL)
      }
      this.muon.getPlugin('broadcast').subscribe(this.BROADCAST_CHANNEL);
      // @ts-ignore
      this.muon.getPlugin('broadcast').on(broadcastChannel, this[this.__broadcastHandlerMethod].bind(this))
    }
  }

  broadcast(data){
    // @ts-ignore
    if(this.__broadcastHandlerMethod === undefined) {
      throw `core.${this.ConstructorName} plugin is not declared broadcast handler`;
    }
    this.muon.getPlugin('broadcast')
        .broadcastToChannel(this.BROADCAST_CHANNEL, data)
        .catch(e => {
          log(`${this.ConstructorName}.broadcast %O`, e)
        })
  }

  broadcastToChannel(channel, data){
    this.muon.getPlugin('broadcast')
        .broadcastToChannel(channel, data)
        .catch(e => {
          log(`${this.ConstructorName}.broadcastToChannel %O`, e)
        })
  }

  sharedMemKey(key) {
    return `core.plugins.${this.ConstructorName}.${key}`
  }

  async setSharedMem(key, value) {
    return await SharedMem.set(this.sharedMemKey(key), value)
  }

  async getSharedMem(key) {
    return await SharedMem.get(this.sharedMemKey(key))
  }

  async clearSharedMem(key) {
    return await SharedMem.clear(this.sharedMemKey(key))
  }

  get currentNodeInfo(): MuonNodeInfo | undefined {
    const nodeManager: NodeManagerPlugin = this.muon.getPlugin('node-manager')
    return nodeManager.getNodeInfo(process.env.SIGN_WALLET_ADDRESS!)
  }
}
