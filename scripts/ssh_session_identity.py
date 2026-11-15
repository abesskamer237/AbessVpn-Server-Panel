"""Identify authenticated, unprivileged managed SSH sessions from procfs."""
import os,pwd,re
from pathlib import Path

USER=re.compile(r'^abv_[a-z0-9][a-z0-9_-]{2,27}$')
TITLE=re.compile(r'^sshd(?:-session)?: (abv_[a-z0-9_-]+)(?:@[a-zA-Z0-9./_-]+)?\s*$')
EXECUTABLES={'/usr/sbin/sshd','/usr/lib/openssh/sshd-session','/usr/libexec/openssh/sshd-session','/usr/lib/ssh/sshd-session'}
BOOT_TIME=int(next(l.split()[1] for l in Path('/proc/stat').read_text().splitlines() if l.startswith('btime ')))
CLOCK_TICKS=os.sysconf('SC_CLK_TCK')

def read_authenticated_process(pid,managed_gid,proc_root=Path('/proc'),lookup=pwd.getpwnam):
    p=proc_root/str(pid)
    if (p/'comm').read_text().strip() not in {'sshd','sshd-session'}:return None
    if str((p/'exe').readlink()) not in EXECUTABLES:return None
    cmd=(p/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace').strip()
    match=TITLE.fullmatch(cmd)
    # [priv], [net] and [preauth] describe monitors or unauthenticated
    # transports. A forwarding-only authenticated session can have no @suffix.
    if not match or not USER.fullmatch(match.group(1)):return None
    user=lookup(match.group(1))
    if user.pw_uid<1000 or user.pw_gid!=managed_gid:return None
    status=(p/'status').read_text().splitlines()
    uids=[int(v) for v in next(l.split()[1:] for l in status if l.startswith('Uid:'))]
    if len(uids)!=4 or any(uid!=user.pw_uid for uid in uids):return None
    stat=(p/'stat').read_text();fields=stat[stat.rindex(')')+2:].split()
    ticks=int(fields[19])
    return {'pid':pid,'uid':user.pw_uid,'username':user.pw_name,'startTicks':ticks,'startedAt':BOOT_TIME+ticks/CLOCK_TICKS}
