const { EventEmitter } = require('events')
const eos = require('end-of-stream')

const { rpc } = require('hyperdrive-daemon-client')
const messages = rpc.peersockets.messages
const log = require('../log').child({ component: 'peersockets' })

const PeerMessageTypes = messages.PeerMessage.Type

module.exports = class PeersocketsManager extends EventEmitter {
  constructor (networker, peers, peersockets, opts = {}) {
    super()
    this.networker = networker
    this.peers = peers
    this.peersockets = peersockets
    this.opts = opts
  }

  // RPC Methods

  async _rpcJoin (call) {
    log.debug('opening topic handle')
    const topicHandler = new TopicHandler(this.peersockets, this.peers, call)
    eos(call, () => topicHandler.close())
  }

  getHandlers () {
    return {
      join: this._rpcJoin.bind(this)
    }
  }
}

class TopicHandler {
  constructor (peersockets, peers, call) {
    this.call = call
    this.peersockets = peersockets
    this.peers = peers
    // Set when an open message is received
    this._topicName = null
    this._topic = null
    this.call.on('data', this._onmessage.bind(this))
  }

  _onmessage (msg) {
    switch (msg.getType()) {
      case PeerMessageTypes.OPEN:
        return this._onopen(msg.getOpen())
      case PeerMessageTypes.DATA:
        return this._ondata(msg.getData())
      default:
        log.warn({ type: msg.getType() }, 'received a message with an invalid type')
    }
  }

  _createPeerMessage (type) {
    const peerMessage = new messages.PeerMessage()
    peerMessage.setType(type)
    return peerMessage
  }

  _onopen (openMessage) {
    this._topicName = openMessage.getTopic()
    this._topic = this.peersockets.join(this._topicName, {
      onmessage: (remoteKey, msg) => {
        const alias = this.peers.getAlias(remoteKey)
        const peerMessage = this._createPeerMessage(PeerMessageTypes.DATA)
        const dataMessage = new messages.DataMessage()
        dataMessage.setMsg(msg)
        dataMessage.setAlias(alias)
        peerMessage.setData(dataMessage)
        this.call.write(peerMessage)
      }
    })
  }

  _ondata (dataMessage) {
    const alias = dataMessage.getAlias()
    const msg = dataMessage.getMsg()
    const remoteKey = this.peers.getKey(alias)
    if (!remoteKey) return
    this._topic.send(remoteKey, Buffer.from(msg))
  }

  close () {
    // TODO: Any cleanup needed here?
  }
}
