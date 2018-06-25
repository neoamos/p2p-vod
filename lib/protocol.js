module.exports = Protocol


var stream = require('readable-stream')
var BSON = require('bson')
var inherits = require('inherits')
var speedometer = require('speedometer')

inherits(Protocol, stream.Duplex)


function Protocol(){
  if (!(this instanceof Protocol)) return new Protocol()
  stream.Duplex.call(this)

  this.bson = new BSON()

  this._parser = this._onHandshake
  this._handshakeSent = false;

  this.downloadSpeed = speedometer()
  this.uploadSpeed = speedometer()
  this.downloaded = 0
  this.uploaded = 0
  this.totalUp = 0
  this.totalDown = 0

  this.destroyed = false

}


Protocol.prototype._read = function(){}

Protocol.prototype._write = function(data, encoding, cb){
  this.totalDown += data.length
  this.emit('download', data.length)
  try{
    var message = this.bson.deserialize(data, {promoteBuffers:true});
  }catch (err) {
    this._debug("Invalid message received")
    cb(null)
  }

  this._parser(message)
  cb(null)

}

Protocol.prototype._push = function(message){
  //console.log("Sending: " + JSON.stringify(message) + ' to ' + this.peerId + ' size: ' + this.bson.calculateObjectSize(message) +'\n')
  messageBuffer = this.bson.serialize(message)
  this.emit('upload', messageBuffer.length)
  this.totalUp += messageBuffer.length
  this.push(messageBuffer)
}

Protocol.prototype.destroy = function(){
  this.destroyed = true
}

Protocol.prototype._onMessage = function(message){
  var size = this.bson.calculateObjectSize(message)
  //console.log("received: " + JSON.stringify(message) + ' froms ' + this.peerId + ' size: ' + size +'\n')
  switch(message.id){
    case(0):
      this.emit('choke')
      break;
    case(1):
      this.emit('unchoke')
      break;
    case(2):
      this.emit('interested')
      break;
    case(3):
      this.emit('notInterested')
      break;
    case(4):
      this.emit('have', message.index)
      break;
    case(5):
      this.emit('bitfield', message.bitfield)
      break;
    case(6):
      this.emit('request', message.index, message.begin, message.length)
      break;
    case(7):
      this.downloaded += message.piece.length
      this.downloadSpeed(message.piece.length)
      this.emit('piece', message.index, message.begin, message.piece)
      break;
    case(8):
      this.emit('cance', message.index, message.begin, message.length)
      break;
    case(50):
      this._onMetadataRequest()
      break;
    case(51):
      this._onMetadataResponse(message.metadata)
      break;
    case(60):
      this._onPeersRequest()
      break;
    case(61):
      this._onPeersResponse(message.peers)
      break;
    case(70):
      this._onOffer(message.to, message.from, message.offer)
      break;
    case(71):
      this._onAnswer(message.to, message.from, message.answer)
      break;

  }

}

Protocol.prototype._onHandshake = function(handshake){
  this.infoHash = handshake.infoHash.toString('hex')
  this.peerId = handshake.peerId.toString('hex')

  this._debug('Got handshake from ' + this.peerId + ' for ' + this.infoHash)
  this.emit('handshake', this.infoHash, this.peerId)

  this._parser = this._onMessage
}

Protocol.prototype.handshake = function(infoHash, peerId){
  if(this.destroyed) return
  message = {infoHash : new Buffer(infoHash, 'hex'), peerId: new Buffer(peerId, 'hex')}
  this._handshakeSent = true
  this._push(message)
}

Protocol.prototype.choke = function(){
  if(this.destroyed) return
  message = {id: 0}
  this._push(message)
}

Protocol.prototype.unchoke = function(){
  if(this.destroyed) return
  message = {id: 1}
  this._push(message)
}

Protocol.prototype.interested = function(){
  if(this.destroyed) return
  message = {id: 2}
  this._push(message)
}

Protocol.prototype.notInterested = function(){
  if(this.destroyed) return
  message = {id: 3}
  this._push(message)
}

Protocol.prototype.have = function(index){
  if(this.destroyed) return
  message = {id: 4, index : index}
  this._push(message)
}

Protocol.prototype.bitfield = function(bitfield){
  if(this.destroyed) return
  message = {id: 5, bitfield : bitfield}
  this._push(message)
}

Protocol.prototype.request = function(index, begin, length){
  if(this.destroyed) return
  message = {id: 6, index : index, begin : begin, length: length}
  this._push(message)
}

Protocol.prototype.piece = function(index, begin, piece){
  if(this.destroyed) return
  this.uploaded += piece.length
  this.uploadSpeed(piece.length)
  message = {id: 7, index : index, begin : begin, piece: piece}
  this._push(message)
}

Protocol.prototype.cancel = function(index, begin, length){
  if(this.destroyed) return
  message = {id: 8, index : index, begin : begin, length: length}
  this._push(message)
}

Protocol.prototype.metadataRequest = function(){
  if(this.destroyed) return
  message = {id: 50}
  this._push(message)
}

Protocol.prototype.peersRequest = function(){
  if(this.destroyed) return
  message = {id: 60}
  this._push(message)
}

Protocol.prototype.metadataResponse = function(metadata){
  if(this.destroyed) return
  message = {id: 51, metadata:  metadata}
  this._push(message)
}

Protocol.prototype.peersResponse = function(peers){
  if(this.destroyed) return
  message = {id: 61, peers: peers}
  this._push(message)
}

Protocol.prototype._onMetadataRequest = function(){
  this.emit('metadataRequest')
}

Protocol.prototype._onPeersRequest = function(){
  this.emit('peersRequest')
}

Protocol.prototype._onPeersResponse = function(peers){
  this.emit('peersResponse', peers)
}

Protocol.prototype._onMetadataResponse = function(metadata){
  this.emit('metadataResponse', metadata)
}

Protocol.prototype.offer = function(to, from, offer){
  if(this.destroyed) return
  message = {id: 70, to: to, from: from, offer: offer}
  this._push(message)
}

Protocol.prototype._onOffer = function(to, from, offer){
  this.emit('offer', to, from, offer)
}

Protocol.prototype.answer = function(to, from, answer){
  if(this.destroyed) return
  message = {id: 71, to: to, from: from, answer: answer}
  this._push(message)
}

Protocol.prototype._onAnswer = function(to, from, answer){
  this.emit('answer', to, from,  answer)
}

Protocol.prototype._debug = function(msg){
  //console.log(msg)
}

