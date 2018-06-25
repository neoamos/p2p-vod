module.exports = Stream

var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var SimplePeer = require('simple-peer')
var wrtc = require('wrtc')
var sha1 = require('simple-sha1')
var speedometer = require('speedometer')

var Peer = require('./peer')
var Protocol = require('./protocol')
var File = require('./file')

var MAX_REQUESTS = 5
var PIECE_TIMEOUT = 30000

inherits(Stream, EventEmitter)
function Stream(clientId, infoHash){

  EventEmitter.call(this)

  this.clientId = clientId
  this.infoHash = infoHash

  this.file = new File()
  this.file.stream = this
  this.metadata = false
  
  this.peers = {}
  this.origin = null
  this.knownPeers = {}
  this.unansweredWebRTCPeers = {}

  this.priority = []
  this.prioritize = this.sequentialPriority
  this.maxPriority = 0

  this.timeouts = []
  this.piece_cbs = {}

  this.downloadSpeed = speedometer()
  this.uploadSpeed = speedometer()
  this.downloaded = 0
  this.uploaded = 0
  this.totalServed = 0
  this.totalUp = 0
  this.totalDown = 0

}

Stream.prototype.generateMetadata = function(fileStr){
  var self = this
  self.file.on('metadata', function(){
    self.metadata = true
    self.infoHash = self.file.metadata.infoHash.toString('hex')
  })
  self.file.generateMetadata(fileStr)
}

Stream.prototype._createPeer = function(type, conn, initiator){
  var peer = new Peer(type)

  peer.conn = conn
  peer.protocol = new Protocol()
  conn.pipe(peer.protocol).pipe(conn)

  if(initiator){
    peer.protocol.once('bitfield', function(buf){
      peer.addBitfield(buf)
    })
    peer.protocol.handshake(this.infoHash, this.clientId)
  }
  return peer
}

Stream.prototype._webRTCOffer = function(peerId){
  var self = this
  var conn = new SimplePeer({initiator: true, wrtc: wrtc })

  conn.once('signal', function(data){
    //console.log('sending offer ' + data)
    self.origin.protocol.offer(peerId, self.clientId, data)
    self.unansweredWebRTCPeers[peerId] = conn
  })
  conn.once('connect', function(){
    var peer = self._createPeer('normal', this, true)
    peer.protocol.once('handshake', function(infoHash, peerId){
      peer.peerId = peerId
      self.addPeer(peer)
    })
  })
}

Stream.prototype._onWebRTCOffer = function(from, offer){
  var self = this
  var conn = new SimplePeer({wrtc: wrtc })
  //console.log('received offer from ' + from + ': ' + offer)
  conn.once('signal', function(data){
    self.origin.protocol.answer(from, self.clientId, data)
  })
  conn.once('connect', function(){
    var peer = self._createPeer('normal', this, false)
    peer.protocol.once('handshake', function(infoHash,  peerId){
      peer.peerId = peerId
      peer.protocol.handshake(infoHash, self.clientId)
      self.addPeer(peer)
    })
  })
  conn.signal(offer)
}

Stream.prototype._onWebRTCAnswer = function(from, answer){
  var self = this
  if(self.unansweredWebRTCPeers.hasOwnProperty(from)){
    var conn = self.unansweredWebRTCPeers[from]
    conn.signal(answer)
  }else{
    //console.log('Received unwanted webrtc answer from ' + from)
  }
}

Stream.prototype.addOriginPeer = function(conn){
  var self = this
  var peer = self._createPeer('origin', conn, true)

  peer.protocol.once('handshake', function(infoHash, peerId){
    peer.peerId = peerId
    self.origin = peer
    if(!this.metadata){
      peer.protocol.metadataRequest()
      peer.protocol.once('metadataResponse', function(metadata){
        self.metadata = true
        self.file.addMetadata(metadata, self.clientId)
        self.infoHash = metadata.infoHash.toString('hex')
        self.emit('metadata')
        self.initiatePriority()
        peer.protocol.peersRequest()
        self.addPeer(peer)
        self.tryRequest(peer)
      })
    }else{
      peer.protocol.peersRequest()
      self.addPeer(peer)
    }

  })

}

Stream.prototype.addPeer = function(peer){
  var self = this

  console.log("adding peer " + peer.peerId)
  peer.conn.on('close', function(){
    self.removePeer(peer)
  })

  peer.conn.on('error', function(err){
    self.removePeer(peer, err)
  })

  self.peers[peer.peerId] = peer
  self.addListeners(peer)
  peer.protocol.bitfield(self.file.bitfield.buffer)
  
}

Stream.prototype.removePeer = function(peer, err){
  console.log("removing peer " + peer.peerId)
  peer.protocol.removeAllListeners()
  peer.protocol.destroy()
  delete this.peers[peer.peerId]
  delete this.knownPeers[peer.peerId]
  delete this.unansweredWebRTCPeers[peer.peerId]
}

Stream.prototype.addListeners = function(peer){
  var self = this
  peer.protocol.on('choke', function(){

  })

  peer.protocol.on('unchoke', function(){
    
  })

  peer.protocol.on('interested', function(){
    
  })

  peer.protocol.on('notInterested', function(){
    
  })

  peer.protocol.on('have', function(index){
    peer.bitfield.set(index)
    self.totalServed += self.file.getPieceLength(index)
  })

  peer.protocol.on('bitfield', function(bitfield){
    peer.addBitfield(bitfield)
    self.tryRequest(peer)
  })

  peer.protocol.on('request', function(index, begin, length){
    if(!peer.choked && self.file.bitfield.get(index)){
      self.uploadSpeed(length)
      self.uploaded += length
      self.file.store.get(index, function(err, buf){
        peer.protocol.piece(index, begin, buf.slice(begin, begin+length))
      })
    }
  })

  peer.protocol.on('piece', function(index, begin, piece){
    let length = self.file.getPieceLength(index)
    self.downloadSpeed(piece.length)
    self.downloaded += piece.length
    if(!self.file.bitfield.get(index)){
      if(piece.length == length){
        sha1(piece, function(hash){
          //console.log(hash + " vs " + self.file.pieces[index].hash)
          if(hash == self.file.pieces[index].hash){
            self.file.store.put(index, piece, function(err){
              gotPiece(piece)
            })
          }
        })
      }else{
        self.file.store.get(index, function(err, chunk){
          if(err){
            var chunk = new Buffer(self.file.getPieceLength(index))
          }
          let newChunk = Buffer.concat([chunk.slice(0, begin), 
                                        piece, 
                                        chunk.slice(begin+length, length)])
          self.file.store.put(index, newChunk, function(err){

          })
          sha1(newChunk, function(hash){
            //console.log(hash + " vs " + self.file.pieces[index].hash)
            if(hash == self.file.pieces[index].hash){
              gotPiece(newChunk)
            }
          })
        })
      }
      var gotPiece = function(buff){
        self.file.bitfield.set(index)
        peer.outstandingRequests--;
        clearTimeout(self.timeouts[index])
        if(self.piece_cbs.hasOwnProperty(index)){
          self.piece_cbs[index](buff)
        }
        for(p in self.peers){
          self.peers[p].protocol.have(index)
        }
        self.tryRequest(peer)
      }
    }
  })

  peer.protocol.on('cancel', function(index, begin, length){
    
  })

  peer.protocol.on('peersRequest', function(){
    //console.log("received peer request from " + peer.peerId)
    this.peersResponse(Object.keys(self.peers))
  })

  peer.protocol.on('peersResponse', function(peers){
    //console.log("Received peer list: " + peers)  
    for(p of peers){
      if(p != self.clientId){
        self._webRTCOffer(p)
      }
    }
  })

  peer.protocol.on('offer', function(to, from, offer){
    if(to != self.clientId){
      if(self.peers.hasOwnProperty(to)){
        self.peers[to].protocol.offer(to, from, offer)
      }
    }else{
      self._onWebRTCOffer(from, offer)
    }
  })

  peer.protocol.on('answer', function(to, from, answer){
    if(to != self.clientId){
      if(self.peers.hasOwnProperty(to)){
        self.peers[to].protocol.answer(to, from, answer)
      }
    }else{
      self._onWebRTCAnswer(from, answer)
    }
  })
  peer.protocol.on('metadataRequest', function(){
    if(self.metadata){
      peer.protocol.metadataResponse(self.file.metadata)
    }
  })

  self.totalUp += peer.protocol.totalUp
  self.totalDown += peer.protocol.totalDown
  peer.protocol.on('download', function(len){
    self.totalDown += len
  })
  peer.protocol.on('upload', function(len){
    self.totalUp += len
  })
}


Stream.prototype.tryRequest = function(peer){
  var self = this
  var maxOutstanding = peer.getMaxOutstanding(self.file.pieceLength)
  var index = 0
  


  for(var i = self.priority.length-1; i>=0; i--){
    if(peer.outstandingRequests >= maxOutstanding){
      break
    }
    if(peer.peerId == self.origin && i != self.maxPriority && self.getPeerAvailability(i) != 0){
      break
    }
    index = self.priority[i]
    if(self.file.bitfield.get(index)){
      self.priority.splice(i, 1)
    }else if(peer.bitfield.get(index)){
      peer.protocol.request(index, 0, self.file.getPieceLength(index))
      peer.outstandingRequests++;
      self.timeouts[index] = setTimeout(function(index){
        self.priority.push(index)
        self.prioritize()
        self.tryRequest(peer)
      }, PIECE_TIMEOUT, index);
      self.priority.splice(i, 1)
    }
  }

}

Stream.prototype.getPeerAvailability = function(index){
  var count = 0
  for(var p in peers){
    if(p != this.origin && p.bitfield.get(index)){
      count++;
    }
  }
  return count
}

Stream.prototype.sequentialPriority = function(maxPriority){
  var self = this
  self.maxPriority = maxPriority || self.maxPriority
  self.priority.sort(function(a, b){
    if(a < self.maxPriority && b >= self.maxPriority){
      return -1
    }else if(b < self.maxPriority && a >= self.maxPriority){
      return 1
    }else if(a < b){
      return 1
    }else{
      return -1
    }
  })
}

Stream.prototype.initiatePriority = function(){
  var self = this
  for(var i = 0; i < self.file.numPieces; i++){
    if(!self.file.bitfield.get(i)){
      self.priority.push(i)
    }
  }
  self.priority = self.priority.reverse()
}

Stream.prototype.getInfo = function(){

  var info = {
    size : this.file.length,
    downloadSpeed : this.downloadSpeed(),
    uploadSpeed : this.uploadSpeed(),
    downloaded : this.downloaded,
    uploaded : this.uploaded,
    peers : {}
  }
  for(var s in this.peers){
    info.peers[s] ={
      downloadSpeed :this.peers[s].protocol.downloadSpeed(),
      uploadSpeed : this.peers[s].protocol.uploadSpeed(),
      downloaded : this.peers[s].protocol.downloaded,
      uploaded : this.peers[s].protocol.uploaded
    }
  }
  return info
}
