#!/usr/bin/env python3
import importlib.util,tempfile,time,unittest
from types import SimpleNamespace
from datetime import datetime,timezone
from pathlib import Path
spec=importlib.util.spec_from_file_location('guard',Path(__file__).with_name('ssh-session-guard.py'));g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
from ssh_session_identity import read_authenticated_process
class GuardTests(unittest.TestCase):
    def setUp(self):
        self.now=time.time();self.since=self.now-10
        self.policy={'format':'abess-ssh-ws-policy-v1','generatedAt':datetime.fromtimestamp(self.now,timezone.utc).isoformat(),'accounts':[{'id':'ssh_00000000-0000-0000-0000-000000000001','username':'abv_alice','enabled':True,'maxConnections':1,'enforcementMode':'enforce-new','enforcementSince':datetime.fromtimestamp(self.since,timezone.utc).isoformat()}]}
    def session(self,pid,start,user='abv_alice',uid=1001):return {'pid':pid,'uid':uid,'username':user,'startTicks':pid*100,'startedAt':start,'key':str(pid)}
    def test_existing_and_admin_sessions_preserved(self):
        sessions=[self.session(1,self.since-100),self.session(2,self.since-50),self.session(3,self.since+1),self.session(4,self.now,'root',0)]
        actions,over,mode=g.planned_actions(self.policy,sessions,self.now)
        self.assertEqual([a['pid'] for a in actions],[3]);self.assertEqual(over,1);self.assertEqual(mode,'enforce-new')
    def test_only_excess_new_sessions_are_selected(self):
        a=self.session(2,self.since+2);b=self.session(3,self.since+3)
        actions,_,_=g.planned_actions(self.policy,[a,b],self.now);self.assertEqual([x['pid'] for x in actions],[3])
        self.policy['accounts'][0]['enforcementMode']='audit'
        self.assertEqual(g.planned_actions(self.policy,[a,b],self.now)[0],[])
    def test_stale_policy_rejected(self):
        self.policy['generatedAt']=datetime.fromtimestamp(self.now-61,timezone.utc).isoformat()
        with self.assertRaises(ValueError):g.planned_actions(self.policy,[],self.now)
    def test_pid_reuse_and_root_cannot_be_signalled(self):
        item=self.session(5,self.now);sent=[]
        self.assertFalse(g.terminate_session(item,lambda _:dict(item,startTicks=99999),lambda *x:sent.append(x)))
        self.assertFalse(g.terminate_session(item,lambda _:dict(item,uid=0),lambda *x:sent.append(x)))
        self.assertEqual(sent,[])
        self.assertTrue(g.terminate_session(item,lambda _:dict(item),lambda *x:sent.append(x)))
        self.assertEqual(sent[0][0],5)
    def test_authenticated_forwarding_only_and_preauth_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);proc=root/'123';proc.mkdir()
            (proc/'comm').write_text('sshd\n');(proc/'exe').symlink_to('/usr/sbin/sshd')
            (proc/'stat').write_text('123 (sshd) '+' '.join(['S','1']+['0']*17+['12345']))
            account=SimpleNamespace(pw_name='abv_alice',pw_uid=1001,pw_gid=987)
            def read(title,uid=1001):
                (proc/'cmdline').write_bytes(title.encode()+b'\x00')
                (proc/'status').write_text('Uid:\t'+'\t'.join([str(uid)]*4)+'\n')
                return read_authenticated_process(123,987,root,lambda _:account)
            for title in ['sshd: abv_alice','sshd: abv_alice@notty']:
                self.assertEqual(read(title)['username'],'abv_alice')
            for title,uid in [('sshd: abv_alice [priv]',0),('sshd: abv_alice [net]',105),('sshd: abv_alice [preauth]',105),('sshd: abv_alice@notty',0),('sshd: abv_alice@notty',105)]:
                self.assertIsNone(read(title,uid))
            account.pw_gid=1
            self.assertIsNone(read('sshd: abv_alice'))
if __name__=='__main__':unittest.main()
