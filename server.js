
var Socket = require('simple-websocket/server')
var randombytes = require('randombytes')
var fs = require('fs')
var express = require('express')

var Protocol = require('./lib/protocol')
var Stream = require('./lib/stream')
var Peer = require('./lib/peer')

var wsPort = 8080
var httpPort = 8090
var serverId = randombytes(20).toString('hex')
var streams = new Map()

//create a websocket server that peers can connect to to download files
var server = new Socket({port: wsPort})
console.log("created websocket server on port " + wsPort)
server.on('connection', function(socket){
  //console.log('received connection')
  peer = new Peer('client')
  peer.protocol = new Protocol()
  peer.conn = socket
  socket.pipe(peer.protocol).pipe(socket)
  peer.protocol.once('handshake', function(infoHash, peerId){
    peer.peerId = peerId
    peer.protocol.handshake(infoHash, serverId)
    streams[infoHash].addPeer(peer)
  })
})

//create an http server
var app = express()
app.use(express.static('public'));
app.get('/info', function(req, res){
  var response = {wsPort: wsPort, streams : {}}
  for(var s in streams){
    response['streams'][streams[s].file.name] = streams[s].infoHash
  }
  res.end(JSON.stringify(response))
})

app.get('/server_info', function(req, res){
  hash = req.query.hash
  if(hash){
    var stream = streams[hash]
    res.write("<html><body>Stats for " + stream.file.name + " (" + hash + "):<br />")
    res.write("Total served by origin: " + stream.uploaded / 1000000 + " MB<br />")
    res.write("Total served by everyone: " + stream.totalServed / 1000000 + " MB<br />")
    res.write("Total server upload bandwidth: " + stream.totalUp / 1000000 + " MB<br />")
    res.write("Total server download bandwidth: " + stream.totalDown / 1000000 + " MB")
    res.write('</html></body>')
  }
  res.end()
})

var server = app.listen(httpPort, function(){
  console.log("created http server on port " + httpPort + '\n')
})


function addStream(fileStr){
  var stream = new Stream(serverId)
  stream.generateMetadata(fileStr)
  stream.file.once('metadata', function(){
    console.log("ready to stream " + stream.file.name)
    streams[stream.infoHash] = stream
  })
}

//create a stream for each file in media
fs.readdir('media', function(err, files){
  if(!err){
    files.forEach(file => {
      addStream('media/' + file)
    });
  }
})





