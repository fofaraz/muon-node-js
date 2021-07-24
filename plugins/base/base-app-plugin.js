const BasePlugin = require('./base-plugin')
const Request = require('../../gateway/models/Request')
const Signature = require('../../gateway/models/Signature')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8arrays/from-string')
const uint8ArrayToString = require('uint8arrays/to-string')
const { getTimestamp, timeout } = require('../../utils/helpers')
const crypto = require('../../utils/crypto')
const { omit } = require('lodash')

const clone = (obj) => JSON.parse(JSON.stringify(obj))

class BaseAppPlugin extends BasePlugin {
  APP_NAME = null

  constructor(...args) {
    super(...args)

    /**
     * This is abstract class, so "new BaseAppPlugin()" is not allowed
     */
    // if (new.target === BaseAppPlugin) {
    //   throw new TypeError("Cannot construct abstract BaseAppPlugin instances directly");
    // }
  }

  async onStart() {
    console.log(`onStart app[${this.APP_NAME}] ...`, this.constructor)
    /**
     * Subscribe to app broadcast channel
     */
    let broadcastChannel = this.getBroadcastChannel()
    if (broadcastChannel) {
      await this.muon.libp2p.pubsub.subscribe(broadcastChannel)
      this.muon.libp2p.pubsub.on(
        broadcastChannel,
        this.__onBroadcastReceived.bind(this)
      )
    }
    /**
     * Remote call handlers
     */
    this.muon
      .getPlugin('remote-call')
      .on(
        `remote:app-${this.APP_NAME}-get-request`,
        this.__onRemoteWantRequest.bind(this)
      )
    this.muon
      .getPlugin('remote-call')
      .on(
        `remote:app-${this.APP_NAME}-request-sign`,
        this.__onRemoteSignRequest.bind(this)
      )
    this.muon
      .getPlugin('gateway-interface')
      .registerAppCall(
        this.APP_NAME,
        'request',
        this.__onRequestArrived.bind(this)
      )
  }

  getBroadcastChannel() {
    return this.APP_NAME ? `muon/${this.APP_NAME}/request/broadcast` : null
  }

  async __onRequestArrived(method, params, nSign) {
    let startedAt = getTimestamp()
    nSign = !!nSign
      ? parseInt(nSign)
      : parseInt(process.env.NUM_SIGN_TO_CONFIRM)
    let newRequest = new Request({
      app: this.APP_NAME,
      method: method,
      nSign,
      owner: process.env.SIGN_WALLET_ADDRESS,
      peerId: process.env.PEER_ID,
      data: {
        params
      },
      startedAt
    })

    if(this.onArrive){
      await this.onArrive(clone(newRequest));
    }

    let result = await this.onRequest(clone(newRequest))
    newRequest.data.result = result

    let resultHash = this.hashRequestResult(newRequest, result)
    let memWrite = this.getMemWrite(newRequest, result)
    if (!!memWrite) {
      newRequest.data.memWrite = memWrite
    }

    await newRequest.save()

    let sign = this.makeSignature(newRequest, result, resultHash)
    if (!!memWrite) {
      sign.memWriteSignature = memWrite.signature
    }
    new Signature(sign).save()

    this.broadcastNewRequest(newRequest)

    let [confirmed, signatures] = await this.isOtherNodesConfirmed(newRequest)

    if (confirmed) {
      newRequest['confirmedAt'] = getTimestamp()
    }

    let requestData = {
      confirmed,
      ...omit(newRequest._doc, [
        '__v'
        // 'data.memWrite'
      ]),
      signatures
    }

    if (confirmed) {
      newRequest.save()
      this.muon.getPlugin('memory').writeAppMem(requestData)
    }

    return requestData
  }

  /**
   * This method should response a Signature model object
   * @param request
   * @returns {Promise<void>} >> Response object
   */
  async processRemoteRequest(request) {
    let result = await this.onRequest(clone(request))

    let hash1 = await this.hashRequestResult(request, request.data.result)
    let hash2 = await this.hashRequestResult(request, result)

    if (hash1 === hash2) {
      let memWrite = this.getMemWrite(request, result)
      return [this.makeSignature(request, result, hash2), memWrite]
    } else {
      throw { message: 'Request not confirmed' }
    }
  }

  getMemWrite(request, result) {
    if (this.hasOwnProperty('onMemWrite')) {
      let memPlugin = this.muon.getPlugin('memory');
      let timestamp = request.startedAt
      let nSign = request.nSign
      let appMem = this.onMemWrite(request, result)
      if (!appMem) return
      let { ttl, data } = appMem

      let memWrite = {
        type: 'app',
        owner: this.APP_NAME,
        timestamp,
        ttl,
        nSign,
        data,
      }

      let hash = memPlugin.hashMemWrite(memWrite);
      let signature = crypto.sign(hash)
      return { ...memWrite, hash, signature }
    }
  }

  async memRead(query, options) {
    return this.muon.getPlugin('memory').readAppMem(this.APP_NAME, query, options)
  }

  async writeNodeMem(data, ttl=0) {
    this.muon.getPlugin('memory').writeNodeMem({ttl, data})
  }

  async readNodeMem(query, options) {
    return this.muon.getPlugin('memory').readNodeMem(query, options)
  }

  async isOtherNodesConfirmed(newRequest) {
    let secondsToCheck = 0
    let confirmed = false
    let allSignatures = []
    let signers = {}

    while (!confirmed && secondsToCheck < 5) {
      await timeout(250)
      allSignatures = await Signature.find({ request: newRequest._id })
      signers = {}
      for (let sig of allSignatures) {
        let sigOwner = this.recoverSignature(newRequest, sig)
        if (!!sigOwner && sigOwner !== sig['owner']) continue

        signers[sigOwner] = true
      }

      if (Object.keys(signers).length >= newRequest.nSign) {
        confirmed = true
      }
      secondsToCheck += 0.25
    }

    return [
      confirmed,
      allSignatures
        .filter((sig) => Object.keys(signers).includes(sig['owner']))
        .map((sig) => ({
          owner: sig['owner'],
          timestamp: sig['timestamp'],
          result: sig['data'],
          signature: sig['signature'],
          memWriteSignature: sig['memWriteSignature']
        }))
    ]
  }

  async __onBroadcastReceived(msg) {
    let remoteCall = this.muon.getPlugin('remote-call')
    try {
      let data = JSON.parse(uint8ArrayToString(msg.data))
      if (data && data.type === 'new_request') {
        let peerId = PeerId.createFromCID(data.peerId)
        let peer = await this.muon.libp2p.peerRouting.findPeer(peerId)
        let request = await remoteCall.call(
          peer,
          `app-${this.APP_NAME}-get-request`,
          { _id: data._id }
        )
        if (request) {
          // console.log(`request info found: `, request)
          let [sign, memWrite] = await this.processRemoteRequest(request)
          await remoteCall.call(peer, `app-${this.APP_NAME}-request-sign`, {
            sign,
            memWrite
          })
        } else {
          // console.log(`request info not found "${data.id}"`)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  /**
   *
   * @param request
   * @returns {Promise<*[isVerified, expectedResult, actualResult]>}
   */
  async isVerifiedRequest(request) {
    let actualResult
    try {
      let {
        data: { result }
      } = request
      actualResult = await this.onRequest(clone(request))
      let verified = false
      if (actualResult) {
        let hash1 = this.hashRequestResult(request, result)
        let hash2 = this.hashRequestResult(request, actualResult)
        verified = hash1 === hash2
      }
      return [verified, request.data.result, actualResult]
    } catch (e) {
      return [false, request.data.result, actualResult]
    }
  }

  recoverSignature(request, sign) {
    let hash = this.hashRequestResult(request, sign.data)
    return crypto.recover(hash, sign.signature)
  }

  broadcastNewRequest(request) {
    let broadcastChannel = this.getBroadcastChannel()
    if (!broadcastChannel) return
    let data = {
      type: 'new_request',
      peerId: process.env.PEER_ID,
      _id: request._id
    }
    let dataStr = JSON.stringify(data)
    this.muon.libp2p.pubsub.publish(
      broadcastChannel,
      uint8ArrayFromString(dataStr)
    )
  }

  remoteMethodEndpoint(title) {
    return `app-${this.APP_NAME}-${title}`
  }

  remoteCall(peer, methodName, data) {
    let remoteCall = this.muon.getPlugin('remote-call')
    let remoteMethodEndpoint = this.remoteMethodEndpoint(methodName)
    return remoteCall.call(peer, remoteMethodEndpoint, data)
  }

  /**
   * hash parameters that smart contract need it.
   *
   * @param request
   * @param result
   * @returns {sha3 hash of parameters}
   */
  hashRequestResult(request, result) {
    return null
  }

  makeSignature(request, result, resultHash) {
    let signTimestamp = getTimestamp()
    let signature = crypto.sign(resultHash)
    return {
      request: request._id,
      owner: process.env.SIGN_WALLET_ADDRESS,
      timestamp: signTimestamp,
      data: result,
      signature
    }
  }

  /**
   * Remote call handlers
   * This methods will call from remote peer
   */

  async __onRemoteWantRequest(data) {
    try {
      // console.log('RemoteCall.getRequestData', data)
      let req = await Request.findOne({_id: data._id})
      return req
    }catch (e) {
      console.error(e);
    }
  }

  async __onRemoteSignRequest(data = {}) {
    // console.log('RemoteCall.requestSignature', {sign, memWrite})
    try {
      let {sign, memWrite} = data;
      let request = await Request.findOne({_id: sign.request})
      if (request) {
        // TODO: check response similarity
        let signer = this.recoverSignature(request, sign)
        if (signer && signer === sign.owner) {
          if (!!memWrite) {
            // TODO: validate memWright signature
            sign.memWriteSignature = memWrite.signature
          }
          let newSignature = new Signature(sign)
          await newSignature.save()
        } else {
          console.log('signature mismatch', {
            request: request._id,
            signer,
            sigOwner: sign.owner
          })
        }
      }
    }
    catch (e) {
      console.error(e);
    }
  }
}

module.exports = BaseAppPlugin
