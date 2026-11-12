import assert from 'node:assert/strict';
import {singBoxConfig, mihomoConfig} from '../modules/subscriptions.js';

const base = {
  name: 'ABESS VPN - Demo Client',
  host: 'vpn.example.test',
  port: 443,
  uuid: 'ec6ba8e2-ae94-4f33-bda3-b935df6c6371',
  sni: 'tls.example.test',
  httpHost: 'front.example.test',
  path: '/abess-ws',
  transport: 'ws'
};

const ws = singBoxConfig(base);
assert.equal(ws.outbounds[0].type, 'vless');
assert.equal(ws.outbounds[0].uuid, base.uuid);
assert.equal(ws.outbounds[0].tls.server_name, base.sni);
assert.equal(ws.outbounds[0].transport.headers.Host, base.httpHost);
assert.equal(ws.outbounds[0].transport.path, base.path);

const mihomo = mihomoConfig(base);
assert.ok(mihomo.includes('type: vless'));
assert.ok(mihomo.includes('network: ws'));
assert.ok(mihomo.includes('front.example.test'));
assert.ok(mihomo.includes('rules:\n  - "MATCH,ABESS VPN"'));

const grpc = {...base, transport:'grpc', path:'/grpc-bridge'};
assert.equal(singBoxConfig(grpc).outbounds[0].transport.service_name, 'grpc-bridge');
assert.ok(mihomoConfig(grpc).includes('grpc-service-name: "grpc-bridge"'));

const tcp = {...base, transport:'tcp', port:80};
const tcpOut = singBoxConfig(tcp).outbounds[0];
assert.equal(tcpOut.tls, undefined);
assert.equal(tcpOut.transport, undefined);
assert.ok(mihomoConfig(tcp).includes('tls: false'));

for (const transport of ['xhttp', 'httpupgrade', 'unsupported']) {
  assert.throws(() => singBoxConfig({...base,transport}), /Transport non pris/);
  assert.throws(() => mihomoConfig({...base,transport}), /Transport non pris/);
}
assert.throws(() => singBoxConfig({...base,port:0}), /incomplet/);
console.log('Portable export regression tests passed.');
