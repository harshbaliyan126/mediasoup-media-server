const express = require('express');
const app = express();
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  CreateWebRtcTransportRequest,
} = require('mediasoup/node/lib/fbs/router');

app.get('/', (req, res) => {
  res.send('hello from mediasoup app!');
});

app.use('/sfu', express.static(path.join(__dirname, 'public')));

const httpServer = http.createServer(app);

httpServer.listen(3000, () => {
  console.log('server is listening on port 3000');
});

const io = new Server(httpServer);

const peers = io.of('/mediasoup');

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 8000,
    rtcMaxPort: 8020,
  });

  console.log(`worker pid: ${worker.pid}`);

  worker.on('died', (error) => {
    console.error('mediasoup worker died');
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

worker = createWorker();

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

peers.on('connection', async (socket) => {
  console.log(`a user connected ${socket.id}`);
  socket.emit('connection-success', { socketId: socket.id });

  socket.on('disconnect', () => {
    console.log(`a user disconnected ${socket.id}`);
  });

  router = await worker.createRouter({ mediaCodecs });

  socket.on('getRtpCapabilities', (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    console.log('rtpCapabilities', rtpCapabilities);
    ``;
    callback({ rtpCapabilities });
  });

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log('createWebRtcTransport', sender);
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });

  socket.on('transport-connect', async ({ dtlsParameters }) => {
    try {
      console.log('DTLS PARAMS', { dtlsParameters });
      await producerTransport.connect({ dtlsParameters });
    } catch (err) {
      console.log(err);
    }
  });

  socket.on(
    'transport-produce',
    async ({ kind, rtpParameters, appData }, callback) => {
      producer = await producerTransport.produce({ kind, rtpParameters });
      console.log('Producer ID: ', producer.id, producer.kind);

      producer.on('transportclose', () => {
        console.log('producer transport closed');
      });

      producer.on('transportclose', () => {
        console.log('transport for this producer closed');
        producer.close();
      });

      callback({ id: producer.id });
    }
  );

  socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
    try {
      console.log('DTLS PARAMS', { dtlsParameters });
      await consumerTransport.connect({ dtlsParameters });
    } catch (err) {
      console.log(err);
    }
  });

  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    try {
      if (router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on('transportclose', () => {
          console.log('consumer transport closed');
        });

        consumer.on('producerclose', () => {
          console.log('producer for this consumer closed');
        });

        const params = {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        callback({ params });
      }
    } catch (err) {
      console.log(err.message);
      callback({
        params: {
          error: err,
        },
      });
    }

    socket.on('consumer-resume', async () => {
      console.log('consumer resume');
      await consumer.resume();
    });
  });
});

const createWebRtcTransport = async (callback) => {
  try {
    const webRtcTransportOptions = {
      listenIps: [
        {
          ip: '127.0.0.1',
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    let transport = await router.createWebRtcTransport(webRtcTransportOptions);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('close', () => {
      console.log('transport closed');
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (err) {
    console.log(err);
    callback({ params: { error: err } });
  }
};
