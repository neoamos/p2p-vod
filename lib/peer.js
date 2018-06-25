module.exports = Peer

var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var Bitfield = require('bitfield')


var Protocol = require('./protocol')

inherits(Peer, EventEmitter)


function Peer(type){
  EventEmitter.call(this)
  this.type = type
  this.choked = false
  this.interested = true

  this.amChoking = false
  this.amInterested = true

  this.outstandingRequests = 0

}

Peer.prototype.addBitfield = function(buffer){
  this.bitfield = new Bitfield(buffer)
}

Peer.prototype.getMaxOutstanding = function(pieceLength){
  return 1 + Math.ceil(this.protocol.downloadSpeed() / pieceLength)
}