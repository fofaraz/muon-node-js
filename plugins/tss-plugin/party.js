const TimeoutPromise = require('../../core/timeout-promise')

class TssParty {
  t = 0
  max = 0;
  id = null;
  partners = {}
  timeoutPromise = null;
  onlinePromise = null;

  constructor(t, max, id, timeout){
    this.t = t;
    this.max = max;
    this.id = id || `P${Date.now()}${Math.floor(Math.random()*9999999)}`
    this.partners = {
      [process.env.SIGN_WALLET_ADDRESS]: {
        wallet: process.env.SIGN_WALLET_ADDRESS,
      }
    }
    this.timeoutPromise = new TimeoutPromise(timeout, "Party join timeout", {resolveOnTimeout: true})
    this.onlinePromise = new TimeoutPromise()
  }

  static load(_party){
    let party = new TssParty(_party.t, _party.max, _party.id)
    party.partners = {};
    _party.partners.map(p => party.addPartner(p))
    party.timeoutPromise.resolve(party);
    return party;
  }

  cloneOnlinePart(){
    let newParty = new TssParty(this.t, this.max)
    newParty.partners = this.onlinePartners()
    newParty.timeoutPromise.resolve(newParty);
    return newParty;
  }

  /**
   * @param partner
   *
   */
  addPartner(partner){
    // if(this.partners[partner.wallet] === undefined)
    {
      this.partners[partner.wallet] = {
        ...partner
      }
      if(this.isFulfilled()) {
        this.timeoutPromise.resolve(this)
      }
    }
  }

  // setPeers(peers){
  //   let id2wallet = {}
  //   for(let wallet in this.partners){
  //     let {peerId} = this.partners[wallet]
  //     id2wallet[peerId] = wallet
  //   }
  //   peers.filter(p => !!p).map(peer => {
  //     if(peer.id === undefined)
  //       console.log({peer})
  //     let key = peer.id.toB58String()
  //     let wallet = id2wallet[key]
  //     this.partners[wallet].peer = peer
  //   })
  // }

  setWalletPeer(wallet, peer){
    if(this.partners[wallet] !== undefined) {
      this.partners[wallet].peer = peer
    }
    if(this.isOnline())
      this.onlinePromise.resolve(this);
  }

  hasEnoughPartners(){
    let {partners, t} = this;
    return Object.keys(partners).length >= t;
  }

  isFulfilled(){
    let {partners, t, max} = this;
    return Object.keys(partners).length >= max;
  }

  isOnline(){
    let {onlinePartners, t} = this;
    return Object.keys(onlinePartners).length >= t;
  }

  getPeers(){
    let peersWallet = Object.keys(this.partners).filter(wallet => wallet !== process.env.SIGN_WALLET_ADDRESS)
    return peersWallet.map(w => this.partners[w].peer).filter(p => !!p)
  }

  size(){
    return Object.keys(this.partners).length
  }

  makePoly(){
  }

  waitToFulfill(){
    return this.timeoutPromise.promise;
  }

  waitToGetOnline(){
    return this.onlinePromise.promise;
  }

  get onlinePartners(){
    let {partners} = this
    return Object.values(partners)
      .filter(p => (!!p.peer || p.wallet===process.env.SIGN_WALLET_ADDRESS))
      .reduce((obj, p) => {
        obj[p.wallet] = p
        return obj;
      }, {})
  }

  get walletIndexes(){
    let {partners} = this
    return Object.values(partners)
      .reduce((obj, p) => {
        obj[p.wallet] = p.wallet
        return obj;
      }, {})
  }
}

module.exports = TssParty;
