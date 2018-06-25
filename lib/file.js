module.exports = File

var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')

var fs = require('fs')
var FSChunkStore = require('fs-chunk-store')
var MemoryChunkStore = require('memory-chunk-store')
var ImmediateChunkStore = require('immediate-chunk-store')
var parallelLimit = require('run-parallel-limit')
var sha1 = require('simple-sha1')
var Bitfield = require('bitfield')
var render = require('render-media')

var Piece = require('./piece')
var FileStream = require('./file-stream')

inherits(File, EventEmitter)
function File(){
  EventEmitter.call(this)

  this.pieceLength = 16384
  this.fsConcurrency = 2

  this.metadata = null
  this.bitfield = null
  this.pieces = []
  this.store = null
  this.numPieces = null
  this.stream = null

  if(typeof window === 'undefined'){
    this._store = FSChunkStore
  }else{
    this._store = MemoryChunkStore
  }

}

File.prototype.generateMetadata = function(fileStr){
  var self = this
  this.name = fileStr

  self.stats = fs.statSync(fileStr)
  self.store = new ImmediateChunkStore( new this._store(self.pieceLength, {
      path : fileStr,
      length : self.stats.size
    })
  );

  self.numPieces = Math.ceil(this.stats.size/this.pieceLength)
  self.bitfield = new Bitfield(self.numPieces)
  self.length = self.stats.length
  for(let i = 0; i < self.numPieces; i++){
    self.bitfield.set(i)
  }

  for(let i = 0; i < self.numPieces; i++){
    self.pieces.push(new Piece(i))
  }

  //asynchrounously generate metadata object
  parallelLimit(this.pieces.map(function(piece, index){
    return function(cb){
      self.store.get(index, function(err, buf){
        sha1(buf, function(hash){
          piece.hash = hash
          cb(null)
        })
      })
    }
    }),
    self.fsConcurrency,
    function(err){
      self.metadata = {
        pieceLength : self.pieceLength,
        length : self.stats.size,
        hashes : self.pieces.map(function(piece, index){
          return new Buffer(piece.hash, 'hex')
        })
      }
      self.metadata.hashes = Buffer.concat(self.metadata.hashes)
      self.metadata.name = fileStr

      sha1(JSON.stringify(self.metadata.hashes),
          function(hash){
            self.metadata.infoHash = new Buffer(hash, 'hex')
            self.emit('metadata')
          }
      )
    }
  )

}

File.prototype.addMetadata = function(metadata, fileStr){
  var self = this
  self.metadata = metadata
  self.pieceLength = metadata.pieceLength
  self.numPieces = metadata.hashes.byteLength/20
  self.bitfield = new Bitfield(self.numPieces)
  self.name = metadata.name
  self.length = metadata.length

  for(let i = 0; i < self.numPieces; i++){
    self.pieces.push(new Piece(i))
    self.pieces[i].hash = self.metadata.hashes.slice(i*20, (i+1)*20).toString('hex')
  }

  self.store = new ImmediateChunkStore( new this._store(self.pieceLength, {
      path : 'media2/'+fileStr+'.mp4',
      length : self.metadata.length
    })
  );
}

File.prototype.getPieceLength = function(i){
  if(i==this.numPieces-1){
    return this.metadata.length-(this.numPieces-1)*this.pieceLength
  }else{
    return this.pieceLength
  }
}

File.prototype.createReadStream = function(opts){
  var self = this
  var fileStream = new FileStream(self, opts)
  return fileStream

}

File.prototype.appendTo = function(elem, opts, cb){
  render.append(this, elem, opts, cb)
}

File.prototype.getPiece = function(index, cb){
  var self = this
  if(self.bitfield.get(index)){
    self.store.get(index, function(err, buff){
      cb(buff)
    })
  }else{
    self.stream.prioritize(index)
    self.stream.piece_cbs[index] = cb
    self.stream.tryRequest(self.stream.origin)
  }
}


