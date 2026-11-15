#!/usr/bin/env python3
"""
ABESS passive SSH-WSS traffic observer.

It DOES NOT proxy, redirect, block, terminate, or modify VPN traffic.
By default it reads kernel TCP counters for accepted SSH sockets and maps
OpenSSH session processes to managed accounts. It persists per-socket
high-water marks and reports cumulative received/acknowledged SSH transport
bytes. Optional packet mode observes WebSocket path secrets on port 8080.
Short connections closed between samples may be missed; forwarded sockets
are excluded to avoid counting the same tunnel payload a second time.

Linux/root only. Standard library only.
"""
from __future__ import annotations
import hashlib, json, os, re, socket, struct, subprocess, threading, time, urllib.request
from pathlib import Path
from typing import Dict, Tuple, Optional

PORT=int(os.environ.get("ABESS_OBSERVER_PORT","8080"))
POLICY=Path(os.environ.get("ABESS_POLICY_FILE","/var/lib/abess-ssh-ws/policy/gateway-policy.json"))
STATE=Path(os.environ.get("ABESS_STATE_FILE","/var/lib/abess-ssh-ws/state.json"))
NODE_KEY=Path(os.environ.get("ABESS_NODE_KEY_FILE","/etc/abess-ssh-ws/node-key"))
BOOTSTRAP=Path(os.environ.get("ABESS_NODE_BOOTSTRAP","/etc/abess-ssh-ws/node-bootstrap.json"))
STORE=Path(os.environ.get("ABESS_OBSERVER_STORE","/var/lib/abess-traffic-observer/usage.json"))
STATUS=Path(os.environ.get("ABESS_OBSERVER_STATUS","/var/lib/abess-traffic-observer/status.json"))
API=os.environ.get("ABESS_CONTROL_API","http://127.0.0.1:3000").rstrip("/")
MODE=os.environ.get("ABESS_OBSERVER_MODE","ssh-sockets")
SSH_PORTS={int(p) for p in os.environ.get("ABESS_SSH_PORTS","22,2222").split(",")}
socket_watermarks={}
socket_online={}
BOOT_ID=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
REPORT_EVERY=max(5,int(os.environ.get("ABESS_REPORT_EVERY","10")))
SECRET_RE=b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

lock=threading.Lock()
connections: Dict[Tuple[str,int,str,int],dict]={}
records: Dict[str,dict]={}
policy_by_hash: Dict[str,dict]={}
state_by_id: Dict[str,str]={}
stats={"startedAt":time.time(),"packets":0,"portPayloadBytes":0,"mappedConnections":0,"unmappedUpgrades":0,"lastReportAt":0.0,"lastReportOk":False,"lastError":""}

def atomic_json(path:Path,obj:dict):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+"."+str(os.getpid())+".tmp")
    tmp.write_text(json.dumps(obj,separators=(",",":")))
    os.chmod(tmp,0o600)
    os.replace(tmp,path)

def load_store():
    global records,socket_watermarks
    try:
        j=json.loads(STORE.read_text())
        if j.get("format")=="abess-passive-traffic-v1" and isinstance(j.get("accounts"),dict):
            records=j["accounts"]
            socket_watermarks=j.get("sockets",{})
    except Exception:
        records={}

def refresh_policy():
    global policy_by_hash,state_by_id
    try:
        p=json.loads(POLICY.read_text())
        nxt={}
        for a in p.get("accounts",[]):
            h=str(a.get("tokenHash",""))
            aid=str(a.get("id",""))
            if len(h)==64 and aid.startswith("ssh_"):
                nxt[h]=a
        policy_by_hash=nxt
    except Exception as e:
        stats["lastError"]="policy:"+str(e)[:120]
    try:
        s=json.loads(STATE.read_text())
        nxt={}
        for username,v in (s.get("state") or {}).items():
            aid=str((v or {}).get("id",""))
            if aid.startswith("ssh_"):
                nxt[aid]="active" if bool((v or {}).get("enabled")) else "blocked"
        state_by_id=nxt
    except Exception:
        pass

def node_identity():
    b=json.loads(BOOTSTRAP.read_text())
    node_id=str(b.get("id",""))
    key=NODE_KEY.read_text().strip()
    if not node_id or len(key)<32:
        raise RuntimeError("node identity unavailable")
    return node_id,key

def identify(path:bytes)->Optional[str]:
    prefix=b"/ssh-ws/"
    if not path.startswith(prefix):
        return None
    secret=path[len(prefix):].split(b"?",1)[0]
    if len(secret)!=43 or any(c not in SECRET_RE for c in secret):
        return None
    h=hashlib.sha256(secret).hexdigest()
    a=policy_by_hash.get(h)
    return str(a.get("id")) if a else None

def seq_new(conn:dict,direction:str,seq:int,n:int)->int:
    if n<=0:return 0
    key="hi_"+direction
    hi=conn.get(key)
    end=seq+n
    if hi is None:
        conn[key]=end
        return n
    if end<=hi:return 0
    add=end-max(seq,hi)
    conn[key]=end
    return max(0,add)

def parse_packet(frame:bytes):
    if len(frame)<54:return
    ethertype=struct.unpack("!H",frame[12:14])[0]
    off=14
    if ethertype==0x8100 and len(frame)>=58:
        ethertype=struct.unpack("!H",frame[16:18])[0];off=18
    if ethertype!=0x0800:return
    ip=frame[off:]
    if len(ip)<20 or ip[9]!=6:return
    ihl=(ip[0]&15)*4
    if len(ip)<ihl+20:return
    total=struct.unpack("!H",ip[2:4])[0]
    src=socket.inet_ntoa(ip[12:16]);dst=socket.inet_ntoa(ip[16:20])
    tcp=ip[ihl:]
    sport,dport,seq=struct.unpack("!HHI",tcp[:8])
    if sport!=PORT and dport!=PORT:return
    doff=((tcp[12]>>4)&15)*4
    plen=max(0,total-ihl-doff)
    payload=tcp[doff:doff+plen]
    if not payload:return
    stats["packets"]+=1;stats["portPayloadBytes"]+=len(payload)
    if dport==PORT:
        k=(src,sport,dst,dport);direction="up"
    else:
        k=(dst,dport,src,sport);direction="down"
    now=time.time()
    conn=connections.setdefault(k,{"buffer":b"","last":now,"account":None})
    conn["last"]=now
    if direction=="up" and conn["account"] is None and len(conn["buffer"])<8192:
        conn["buffer"]=(conn["buffer"]+payload)[:8192]
        if b"\r\n" in conn["buffer"]:
            first=conn["buffer"].split(b"\r\n",1)[0].split()
            if len(first)>=2 and first[0] in (b"GET",b"CONNECT"):
                aid=identify(first[1])
                if aid:
                    conn["account"]=aid
                    stats["mappedConnections"]+=1
                    rec=records.setdefault(aid,{"anchorBaseline":0,"observedBytes":0,"upBytes":0,"downBytes":0})
                    p=next((a for a in policy_by_hash.values() if a.get("id")==aid),None)
                    if p and not rec.get("anchorSet"):
                        rec["anchorBaseline"]=int(p.get("baselineUsedBytes",0) or 0);rec["anchorSet"]=True
                    # Do not count the HTTP upgrade request itself.
                    conn["hi_up"]=seq+len(payload)
                    return
                elif b"\r\n\r\n" in conn["buffer"]:
                    stats["unmappedUpgrades"]+=1
    aid=conn.get("account")
    if not aid:return
    add=seq_new(conn,direction,seq,len(payload))
    if add:
        rec=records.setdefault(aid,{"anchorBaseline":0,"observedBytes":0,"upBytes":0,"downBytes":0,"anchorSet":True})
        rec["observedBytes"]=int(rec.get("observedBytes",0))+add
        rec[direction+"Bytes"]=int(rec.get(direction+"Bytes",0))+add

def ssh_process_accounts(users):
    result={}
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():continue
        try:
            comm=(proc/"comm").read_text().strip()
            if not (comm=="sshd" or comm.startswith("sshd-")):continue
            cmd=(proc/"cmdline").read_bytes().replace(b"\x00",b" ").decode(errors="replace")
            match=re.search(r"sshd(?:-session)?: ([A-Za-z0-9_-]+)(?:@| \[)",cmd)
            if match and match.group(1) in users:result[int(proc.name)]=users[match.group(1)]
        except OSError:pass
    return result

def ssh_socket_samples(output,processes,ports=SSH_PORTS):
    """Read accepted SSH transport sockets only, never their forwarded sockets."""
    lines=output.splitlines()
    for i,line in enumerate(lines):
        columns=line.split()
        if len(columns)<4 or not re.search(r"pid=\d+",line):continue
        offset=0 if columns[0].isdigit() else 1
        if len(columns)<offset+4:continue
        local,peer=columns[offset+2:offset+4]
        try:port=int(local.rsplit(":",1)[1])
        except (ValueError,IndexError):continue
        if port not in ports:continue
        ids={processes[int(pid)] for pid in re.findall(r"pid=(\d+)",line) if int(pid) in processes}
        if len(ids)!=1:continue
        inode=re.search(r"\bino:(\d+)",line)
        if not inode:continue
        metrics=line+" "+(lines[i+1] if i+1<len(lines) and lines[i+1][:1].isspace() else "")
        values={key:int(value) for key,value in re.findall(r"\b(bytes_received|bytes_acked|bytes_sent):(\d+)",metrics)}
        if not values:continue
        yield (next(iter(ids)),BOOT_ID+":"+inode.group(1)+":"+local+":"+peer,
               values.get("bytes_received",0),values.get("bytes_acked",values.get("bytes_sent",0)))

def apply_socket_samples(samples,now=None):
    global socket_online
    now=time.time() if now is None else now
    online={};seen=set()
    for aid,key,up,down in samples:
        if key in seen:continue
        seen.add(key)
        previous=socket_watermarks.get(key,{})
        # Include already-active sessions on first observation. Persist the
        # high-water marks so observer restarts cannot bill those bytes twice.
        old_up=int(previous.get("up",0));old_down=int(previous.get("down",0))
        delta_up=max(0,up-old_up);delta_down=max(0,down-old_down)
        socket_watermarks[key]={"up":max(up,old_up),"down":max(down,old_down),"last":now}
        p=next((a for a in policy_by_hash.values() if a["id"]==aid),None)
        if not p:continue
        rec=records.setdefault(aid,{"anchorBaseline":int(p.get("baselineUsedBytes",0)),"observedBytes":0,"upBytes":0,"downBytes":0,"anchorSet":True})
        rec["observedBytes"]=int(rec.get("observedBytes",0))+delta_up+delta_down
        rec["upBytes"]=int(rec.get("upBytes",0))+delta_up
        rec["downBytes"]=int(rec.get("downBytes",0))+delta_down
        online[aid]=online.get(aid,0)+1
    socket_online=online
    for key in list(socket_watermarks):
        if now-float(socket_watermarks[key].get("last",0))>86400:del socket_watermarks[key]
    stats["mappedConnections"]=len(online)

def ssh_socket_command(ports=SSH_PORTS):
    # Kernel-side filtering avoids enumerating thousands of forwarded sockets.
    expression="( "+" or ".join("sport = :"+str(p) for p in sorted(ports))+" )"
    return ["ss","-tinpeH","state","established",expression]

def socket_loop():
    while True:
        try:
            with lock:refresh_policy();users={a["username"]:a["id"] for a in policy_by_hash.values()}
            processes=ssh_process_accounts(users)
            output=subprocess.check_output(ssh_socket_command(),text=True,timeout=5)
            with lock:apply_socket_samples(ssh_socket_samples(output,processes))
        except Exception as e:
            stats["lastError"]="ssh-sockets:"+type(e).__name__
        time.sleep(1)

def report_loop():
    while True:
        time.sleep(REPORT_EVERY)
        try:
            refresh_policy()
            now=time.time()
            with lock:
                for k in list(connections):
                    if now-connections[k].get("last",0)>90:
                        del connections[k]
                online={}
                for v in connections.values():
                    aid=v.get("account")
                    if aid:online[aid]=online.get(aid,0)+1
                if MODE=="ssh-sockets":online=dict(socket_online)
                reports=[]
                for h,a in policy_by_hash.items():
                    aid=str(a["id"])
                    rec=records.setdefault(aid,{"anchorBaseline":int(a.get("baselineUsedBytes",0) or 0),"observedBytes":0,"upBytes":0,"downBytes":0,"anchorSet":True})
                    used=int(rec.get("anchorBaseline",0))+int(rec.get("observedBytes",0))
                    reports.append({"id":aid,"state":state_by_id.get(aid,"blocked"),"usedBytes":used,"online":min(5000,online.get(aid,0))})
                atomic_json(STORE,{"format":"abess-passive-traffic-v1","updatedAt":time.time(),"accounts":records,"sockets":socket_watermarks})
            node_id,key=node_identity()
            body=json.dumps({"reports":reports}).encode()
            req=urllib.request.Request(API+"/api/v1/nodes/"+node_id+"/ssh-ws/status",data=body,method="POST",
                headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
            with urllib.request.urlopen(req,timeout=6) as r:
                if r.status!=200:raise RuntimeError("HTTP "+str(r.status))
            stats["lastReportAt"]=time.time();stats["lastReportOk"]=True;stats["lastError"]=""
        except Exception as e:
            stats["lastReportAt"]=time.time();stats["lastReportOk"]=False;stats["lastError"]=str(e)[:180]
        try:
            with lock:
                active=sum(socket_online.values()) if MODE=="ssh-sockets" else sum(1 for v in connections.values() if v.get("account"))
                atomic_json(STATUS,{"format":"abess-passive-traffic-status-v1","mode":MODE,**stats,"activeMappedConnections":active,"trackedAccounts":len(records)})
        except Exception:
            pass

def main():
    if os.geteuid()!=0:raise SystemExit("root required")
    load_store();refresh_policy()
    threading.Thread(target=report_loop,daemon=True).start()
    if MODE=="ssh-sockets":
        socket_loop()
        return
    s=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(0x0003))
    while True:
        frame=s.recv(65535)
        with lock:
            parse_packet(frame)

if __name__=="__main__":
    main()
