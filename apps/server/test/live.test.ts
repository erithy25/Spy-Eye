import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStreamAddress, redactStreamAddress, redactStreamText } from '../src/intel/live.js';

test('only network streams are accepted as stream addresses', () => {
  for (const ok of ['rtsp://cam.example/stream1', 'rtsps://10.0.0.5:322/live', 'https://host.example/hls/index.m3u8', 'srt://host.example:9000', 'tcp://127.0.0.1:9151', 'udp://239.0.0.1:1234']) {
    assert.notEqual(parseStreamAddress(ok), null, ok);
  }
  for (const bad of ['', 'file:///etc/passwd', '/dev/video0', 'C:\\video.mp4', 'video.mp4', 'javascript:alert(1)', 'rtsp://', 'ftp://host/x']) {
    assert.equal(parseStreamAddress(bad), null, bad);
  }
});

test('credentials and query strings never appear in the displayed address', () => {
  assert.equal(redactStreamAddress('rtsp://admin:geheim@cam.example:554/stream1?token=abc'), 'rtsp://cam.example:554/stream1');
  assert.equal(redactStreamAddress('tcp://127.0.0.1:9151'), 'tcp://127.0.0.1:9151');
  assert.equal(redactStreamAddress('not a url'), '');
});

test('an address that would make the node wait for a connection is refused', () => {
  for (const bad of ['tcp://0.0.0.0:9000?listen', 'tcp://0.0.0.0:9000?listen=1', 'srt://0.0.0.0:9000?mode=listener', 'srt://host.example:9000?mode=rendezvous', 'udp://0.0.0.0:1234?listen=1&x=y']) {
    assert.equal(parseStreamAddress(bad), null, bad);
  }
  for (const ok of ['srt://host.example:9000?streamid=cam1&mode=caller', 'tcp://127.0.0.1:9151?listen=0', 'udp://239.0.0.1:1234?pkt_size=1316']) {
    assert.notEqual(parseStreamAddress(ok), null, ok);
  }
});

test('a stream key in an RTMP address is not shown', () => {
  assert.equal(redactStreamAddress('rtmp://ingest.example/live/sk_3fa9c1e07b'), 'rtmp://ingest.example/live/…');
  assert.equal(redactStreamAddress('rtmps://user:pw@ingest.example:443/app/key/extra?token=1'), 'rtmps://ingest.example:443/app/…');
  assert.equal(redactStreamAddress('rtmp://ingest.example'), 'rtmp://ingest.example/');
  // Other protocols keep their path: it names the camera channel.
  assert.equal(redactStreamAddress('rtsp://cam.example/Streaming/Channels/101'), 'rtsp://cam.example/Streaming/Channels/101');
});

test('what ffmpeg reports about a failed stream is shown without credentials', () => {
  assert.equal(
    redactStreamText('rtsp://admin:geheim@10.0.0.5:554/stream1?token=abc: Connection refused'),
    'rtsp://10.0.0.5:554/stream1: Connection refused',
  );
  assert.equal(
    redactStreamText("[in#0 @ 0x55] Error opening input: 401 Unauthorized (https://user:pw@host.example/hls/index.m3u8?sig=XYZ)."),
    '[in#0 @ 0x55] Error opening input: 401 Unauthorized (https://host.example/hls/index.m3u8).',
  );
  assert.equal(redactStreamText('file:///etc/passwd: No such file'), '[Adresse]: No such file');
  assert.equal(redactStreamText('x'.repeat(1000)).length, 240);
  assert.equal(redactStreamText('Connection timed out'), 'Connection timed out');
});
