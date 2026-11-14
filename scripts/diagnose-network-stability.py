#!/usr/bin/env python3
"""Aggregate read-only diagnostics. No endpoints, account names or secrets logged."""
import json,re,statistics,subprocess,time
from pathlib import Path

def counters(path,section):
    lines=Path(path).read_text().splitlines()
    for i,line in enumerate(lines):
        if line.startswith(section+':'):
            return dict(zip(line.split()[1:],map(int,lines[i+1].split()[1:])))
    return {}

def snapshot():
    ext=counters('/proc/net/netstat','TcpExt');tcp=counters('/proc/net/snmp','Tcp')
    return {**{k:ext.get(k,0) for k in ['ListenOverflows','ListenDrops','TCPBacklogDrop','TCPMemoryPressures','TCPTimeouts','TCPSynRetrans']},**{k:tcp.get(k,0) for k in ['InSegs','OutSegs','RetransSegs','EstabResets']}}

a=snapshot();time.sleep(5);b=snapshot()
print('TCP_DELTAS_5S='+json.dumps({k:b[k]-a[k] for k in a}))
for name in ['cpu','memory','io']:
    p=Path('/proc/pressure')/name
    if p.exists():print('PRESSURE_'+name.upper()+'='+p.read_text().strip().replace('\n',';'))
interfaces={line.split()[0] for line in Path('/proc/net/route').read_text().splitlines()[1:] if line.split()[1]=='00000000'}
for interface in interfaces:
    p=Path('/sys/class/net')/interface/'statistics'
    def net():return {k:int((p/k).read_text()) for k in ['rx_bytes','tx_bytes','rx_dropped','tx_dropped','rx_errors','tx_errors']}
    x=net();time.sleep(3);y=net()
    print('INTERFACE_3S='+json.dumps({k:y[k]-x[k] for k in x}))
    try:print('QDISC='+subprocess.check_output(['tc','-s','qdisc','show','dev',interface],text=True).strip())
    except (OSError,subprocess.CalledProcessError):pass
out=subprocess.check_output(['ss','-tinemH','state','established','( sport = :443 or sport = :22 or sport = :8080 )'],text=True)
groups={22:[],443:[],8080:[]};current=None
for line in out.splitlines():
    parts=line.split()
    if len(parts)>=4 and parts[0].isdigit() and ':' in parts[2]:
        try:port=int(parts[2].rsplit(':',1)[1])
        except ValueError:continue
        current={'recvq':int(parts[0]),'sendq':int(parts[1]),'text':line}
        if port in groups:groups[port].append(current)
    elif current is not None:current['text']+=' '+line
for port,items in groups.items():
    rtts=[];retrans=0;bbr=0
    for item in items:
        m=re.search(r'\brtt:([0-9.]+)',item['text'])
        if m:rtts.append(float(m[1]))
        m=re.search(r'\bretrans:\d+/(\d+)',item['text'])
        if m:retrans+=int(m[1])
        bbr+=bool(re.search(r'\bbbr\b',item['text']))
    print('SOCKETS_'+str(port)+'='+json.dumps({'count':len(items),'bbr':bbr,'medianRttMs':statistics.median(rtts) if rtts else None,'p95RttMs':sorted(rtts)[int((len(rtts)-1)*.95)] if rtts else None,'sendQueueBytes':sum(i['sendq'] for i in items),'recvQueueBytes':sum(i['recvq'] for i in items),'lifetimeRetransmissions':retrans}))
settings=subprocess.check_output(['/usr/sbin/sshd','-T'],text=True)
allow={'clientaliveinterval','clientalivecountmax','tcpkeepalive','compression','loglevel','usedns','maxstartups','maxsessions','rekeylimit'}
print('SSH_SETTINGS='+json.dumps({p[0]:' '.join(p[1:]) for l in settings.splitlines() if (p:=l.split()) and p[0] in allow}))
