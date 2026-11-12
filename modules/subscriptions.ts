/**
 * Portable VLESS subscription exports for third-party clients.
 * Only transports with known mappings are supported. Never invent a working
 * proxy/listener on the remote VPS; these files describe an existing endpoint.
 */
export interface PortableVless {
  name: string;
  host: string;
  port: number;
  uuid: string;
  transport: string;
  sni: string;
  httpHost: string;
  path: string;
}

const supported = new Set(['tcp', 'ws', 'grpc']);
function validate(p: PortableVless): void {
  if (!supported.has(p.transport)) throw new Error('Transport non pris en charge par cet exporteur portable.');
  if (!p.host || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(p.uuid)) throw new Error('Profil VPN incomplet.');
}

/** Full sing-box config, ready for a local mixed proxy on 127.0.0.1:2080. */
export function singBoxConfig(p: PortableVless): Record<string, unknown> {
  validate(p);
  const transport = p.transport === 'ws'
    ? {type: 'ws', path: p.path, headers: {Host: p.httpHost}}
    : p.transport === 'grpc'
      ? {type: 'grpc', service_name: p.path.replace(/^\/+/, '')}
      : undefined;
  return {
    log: {level: 'warn'},
    inbounds: [{type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080}],
    outbounds: [{
      type: 'vless', tag: 'abess-vpn', server: p.host, server_port: p.port,
      uuid: p.uuid,
      ...(p.transport === 'tcp' ? {} : {tls: {enabled: true, server_name: p.sni, insecure: false}}),
      ...(transport ? {transport} : {})
    }, {type: 'direct', tag: 'direct'}],
    route: {final: 'abess-vpn'}
  };
}

/** Mihomo / Clash Meta YAML; JSON-quoted scalars are valid YAML strings. */
export function mihomoConfig(p: PortableVless): string {
  validate(p);
  const q = (x: string) => JSON.stringify(x);
  const name = q(p.name);
  const proxy = [
    '  - name: ' + name,
    '    type: vless',
    '    server: ' + q(p.host),
    '    port: ' + p.port,
    '    uuid: ' + q(p.uuid),
    '    udp: true',
    '    tls: ' + (p.transport === 'tcp' ? 'false' : 'true')
  ];
  if (p.transport !== 'tcp') proxy.push('    servername: ' + q(p.sni));
  if (p.transport === 'ws') {
    proxy.push('    network: ws', '    ws-opts:', '      path: ' + q(p.path),
      '      headers:', '        Host: ' + q(p.httpHost));
  } else if (p.transport === 'grpc') {
    proxy.push('    network: grpc', '    grpc-opts:', '      grpc-service-name: ' + q(p.path.replace(/^\/+/, '')));
  } else {
    proxy.push('    network: tcp');
  }
  return [
    'mixed-port: 7890', 'allow-lan: false', 'mode: rule',
    'proxies:', ...proxy,
    'proxy-groups:', '  - name: "ABESS VPN"', '    type: select',
    '    proxies:', '      - ' + name,
    'rules:', '  - "MATCH,ABESS VPN"', ''
  ].join('\n');
}
