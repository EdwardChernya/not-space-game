const { PeerServer } = require('peer');

const port = Number(process.env.PORT || 9000);

PeerServer({
  port,
  path: '/peerjs',
  debug: true
});

console.log(`PeerJS server listening on port ${port}`);
