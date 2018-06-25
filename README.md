# P2P VOD
Amos Newswanger <anewswan@u.rochester.edu>

A Node.js video streaming server.  The client side script allows different clients streaming
the same video to share pieces of the video to reduce load on the server.

## Running:
Running the server script requires Node.js 8.0 or higher.  The required dependencies are listed
in package.json.  You can install all the dependencies with 'npm install .'

To run the server, run 'nodejs server.js'
The client script has to be bundled into a single file.  There is a pre-bundled file in src/puclic.
You can bundle you own client script with browserify by running 'browserify client.js -o bundle.js'

When you run the server script, it will initiate an http server and a websocket server.The ports
can be changed by editing server.js.  Files in src/public will be served by the http server.  On startup,
it will generate metadata for any files in src/media. Files in src/public will be served by the http 
server, and files in src/media will be served by the websocket server with peer assisted dilivery.


