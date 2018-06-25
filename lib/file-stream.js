module.exports = FileStream

var inherits = require('inherits')
var stream = require('readable-stream')

inherits(FileStream, stream.Readable)

function FileStream(file, opts){
  stream.Readable.call(this, opts)
  console.log("new filestream: " + JSON.stringify(opts))
  this.file = file

  if(!opts) opts = {}

  this.start = opts.start ? opts.start : 0
  this.end = opts.end ? opts.end : file.length

}

FileStream.prototype._read = function(size){
  var self = this
  var end = Math.min(self.start + size, self.file.length)
  if(self.start == end){
    self.push(null)
    return
  }

  var startPiece = Math.floor(self.start / self.file.pieceLength)
  var endPiece = Math.floor(end / self.file.pieceLength)
  var currPiece = startPiece
  var startOffset = self.start - startPiece * self.file.pieceLength
  var ret = []

  // console.log(self.file.numPieces)
  // console.log(self.file.getPieceLength(startPiece))
  // console.log("filestream request: size: " + size 
  //             + ", startPiece: " + startPiece
  //             + ", endPiece: " + endPiece
  //             + ", currPiece: " + currPiece
  //             + ", startOffset: " + startOffset
  //             + ", end: " + end
  //             + ", start: " + self.start)
  var onPiece = function(piece){
    if(currPiece == startPiece){
      size -= piece.length - startOffset
      ret.push(piece.slice(startOffset, piece.length))
      if(size <= 0 || currPiece == self.file.numPieces-1){
        var buff = Buffer.concat(ret)
        self.start += buff.length
        self.push(buff)
        return
      }
    }else if(currPiece == endPiece){
      ret.push(piece.slice(0, Math.min(size, piece.length)))
      var buff = Buffer.concat(ret)
      self.start += buff.length
      self.push(Buffer.concat(ret))
      return
    }else{
      size -= piece.length
      ret.push(piece)
    }
    currPiece++;
    self.file.getPiece(currPiece, onPiece)
  }

  self.file.getPiece(startPiece, onPiece)

}