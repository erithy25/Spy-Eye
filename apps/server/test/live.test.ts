import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStreamAddress, redactStreamAddress } from '../src/intel/live.js';

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
