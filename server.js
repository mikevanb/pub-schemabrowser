// 'use strict'
var connect = require('connect');
var serveStatic = require('serve-static');
var fs = require('fs');
var zlib = require('zlib');
const crypto = require('crypto');
const hash = crypto.createHash('sha256');

var port = process.env.port || 8090;
var directory = __dirname + '\\www';
var app = connect();

console.log('Initializing');

var schemasString = zlib.gzipSync(fs.readFileSync(directory + '\\skypeschemas.js', 'utf8'));
hash.update(schemasString);
var etag = hash.digest('hex')
var schemasHeaders = {
  'Content-Type': 'application/json',
  'Content-Encoding': 'gzip',
  'Content-Length': schemasString.length,
  'Etag': etag
};

app.use('/skypeschemas.js', function (req, res, next) {
  var accept = req.headers['accept-encoding'];
  if (accept.indexOf('gzip') === -1) {
    res.statusCode = 406;
    res.end('Sorry, your browser is not supported :(');
    return;
  }
  var incomingEtag = req.headers['if-none-match'];
  if (incomingEtag === etag) {
    console.log('Got a request for matching ETag - returning 304');
    res.writeHead(304, schemasHeaders);
    res.end();
    return;
  }

  console.log('Serving the skypeschemas.js file: ' + JSON.stringify(schemasHeaders));
  res.writeHead(200, schemasHeaders);
  res.end(schemasString);
})

app.use(serveStatic(directory)).listen(port);

console.log('Serving ' + directory + ' at port ' + port);
