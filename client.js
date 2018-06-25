var Socket = require('simple-websocket')
var randombytes = require('randombytes')

var Protocol = require('./lib/protocol')
var Stream = require('./lib/stream')

var clientId = randombytes(20).toString('hex')
var streamElem = document.getElementById('stream')
var streams = {}

var host = 'localhost'
var wsPort = 8080

var infoInterval= null
var infoTime = 1000

function createWebSocketURL(port) {
  return "ws://" + window.location.hostname + ":" + wsPort
}

//get a list of videos from http server
window.onload = function(){
  var xhttp = new XMLHttpRequest()
  xhttp.onreadystatechange = function(){
    if (this.readyState == 4 && this.status == 200) {
      var info = JSON.parse(this.responseText)
      var streamList = document.getElementById('streamList')
      wsPort = info.wsPort
      for(var s in info.streams){
        var a = document.createElement('a')
        a.href = "#";
        (function(hash){
            a.addEventListener('click', function(){
            addStream(hash, wsPort)
          })
        })(info.streams[s]);
        a.innerHTML = s
        streamList.appendChild(a)
        var stats = document.createElement('a')
        stats.href = 'server_info?hash=' + info.streams[s]
        stats.target = '_blank'
        stats.innerHTML = ' (Server stats)'
        streamList.appendChild(stats)
        streamList.appendChild(document.createElement('br'))
      }
    }
  }
  xhttp.open("GET", "info", true)
  xhttp.send()
}


function addStream(infoHash, port){
  var streamElem = document.getElementById('stream')
  var infoElem = document.getElementById('streamInfo')
  streamElem.innerHTML = ""
  infoElem.innerHTML = ""
  clearInterval(infoInterval)
  if(streams.hasOwnProperty(infoHash)){
    infoInterval = setInterval(function(){
      displayInfo(infoElem, streams[infoHash])
    })
    streams[infoHash].file.appendTo(streamElem)
  }else{
    var origin = new Socket(createWebSocketURL('', port))
    origin.on('connect', function(){
      console.log("connected")
      stream = new Stream(clientId, infoHash)
      streams[infoHash] = stream
      stream.addOriginPeer(origin)
      stream.once('metadata', function(){
        infoInterval = setInterval(function(){
          displayInfo(infoElem, stream)
        }, infoTime)
        stream.file.appendTo(streamElem, {autoplay:true}, function(){
        })
      })
    })
  }
}

function displayInfo(elem, stream){
  var info = stream.getInfo()
  var peerInfo = ""
  for(var p in info.peers){
    peerInfo += "<tr><td>" + p + "</td>" + 
                               "<td>" + Math.floor(info.peers[p].downloaded / 1000000) + " MB</td>" +
                               "<td>" + Math.floor(info.peers[p].uploaded / 1000000) + " MB</td>" +
                               "<td>" + Math.floor(info.peers[p].downloadSpeed / 10000) + " KB/s</td>" +
                               "<td>" + Math.floor(info.peers[p].uploadSpeed / 10000) + " KB/s</td></tr>"
  }
  elem.innerHTML = "Total Size: " + info.size / 1000000 + "MB" +
              "<br />Downloaded: " + info.downloaded /1000000 + "MB" +
              "<br />Uploaded: " + info.uploaded /1000000 + "MB" +
              "<br />Download Speed: " + info.downloadSpeed /10000 + "KB/s" +
              "<br />Upload Speed: " + info.uploadSpeed /10000 + "KB/s" +
              "<br />Peers:<table>"+
              "<tr><td>ID</td>" +
              "<td>Downloaded</td>" +
              "<td>Uploaded</td>" +
              "<td>Download Speed</td>" +
              "<td>Upload Speed</td></tr>" +
              peerInfo
              +"</table>"

}
