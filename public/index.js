const io = require('socket.io-client');
const localVideo = document.getElementById('localVideo');
const mediaSoupClient = require('mediasoup-client');

const socket = io('http://localhost:3000/mediasoup');

socket.on('connection-success', (data) => {
  console.log('connection-success', data);
});

let params = {
  encoding: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

const streamSuccess = async (stream) => {
  localVideo.srcObject = stream;
  console.log(stream);
  const track = stream.getVideoTracks()[0];
  console.log(track);
  params = {
    track,
    ...params,
  };
};

const getLocalStream = () => {
  console.log('getLocalStream');
  navigator.getUserMedia(
    {
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    },
    streamSuccess,
    (error) => {
      console.log(error.message);
    }
  );
};

const createDevice = async () => {
  try {
    device = new mediaSoupClient.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    console.log('RTP Capabilities', rtpCapabilities);
  } catch (err) {
    console.log(err);
    if (err.name === 'UnsupportedError') {
      console.log('browser not supported');
    }
  }
};

const getRtpCapabilities = async () => {
  socket.emit('getRtpCapabilities', (data) => {
    console.log(`Router RTP Capabilities`, data);
    rtpCapabilities = data.rtpCapabilities;
  });
};

const createSendTransport = async () => {
  console.log('createSendTransport');
  socket.emit('createWebRtcTransport', { sender: true }, ({ params }) => {
    if (params.error) {
      console.log(params.error);
      return;
    }

    console.log(params);

    producerTransport = device.createSendTransport(params);

    producerTransport.on(
      'connect',
      async ({ dtlsParameters }, callback, errback) => {
        try {
          await socket.emit('transport-connect', {
            dtlsParameters,
          });

          callback();
        } catch (err) {}
      }
    );

    producerTransport.on('produce', async (parameters, callback, errback) => {
      try {
        await socket.emit(
          'transport-produce',
          {
            transportId: producerTransport.id,
            kind: 'video',
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          },
          ({ id }) => {
            callback({ id });
          }
        );
      } catch (error) {
        errback(error);
      }
    });
  });
};

const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);

  producer.on('trackended', () => {
    console.log('trackended');
  });

  producer.on('transportclose', () => {
    console.log('transportclose');
  });
};

const createRecvTransport = async () => {
  await socket.emit(
    'createWebRtcTransport',
    { sender: false },
    ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      consumerTransport = device.createRecvTransport(params);

      consumerTransport.on(
        'connect',
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit('transport-recv-connect', {
              //transportId: consumerTransport.id,
              dtlsParameters,
            });

            callback();
          } catch (err) {
            console.log(err);
            errback(err);
          }
        }
      );

      console.log(params + 'superman');
    }
  );
};

const connectRecvTransport = async () => {
  await socket.emit(
    'consume',
    {
      rtpCapabilities: device.rtpCapabilities,
    },
    async ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      consumer = await consumerTransport.consume({
        id: params.id,
        kind: params.kind,
        producerId: params.producerId,
        rtpParameters: params.rtpParameters,
      });

      console.log(trakc);

      const { track } = consumer;

      remoteVideo.srcObject = new MediaStream([track]);

      socket.emit('consumer-resume');
    }
  );
};

btnLocalVideo.addEventListener('click', getLocalStream);
btnRtpCapabilities.addEventListener('click', getRtpCapabilities);
btnDevice.addEventListener('click', createDevice);
btnCreateSendTransport.addEventListener('click', createSendTransport);
btnConnectSendTransport.addEventListener('click', connectSendTransport);
btnRecvSendTransport.addEventListener('click', createRecvTransport);
btnConnectRecvTransport.addEventListener('click', connectRecvTransport);
