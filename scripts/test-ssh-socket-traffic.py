#!/usr/bin/env python3
import importlib.util,json,os,socket,subprocess,tempfile,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('observer',Path(__file__).with_name('ssh-ws-passive-traffic.py'))
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)
A='ssh_00000000-0000-0000-0000-000000000001'
B='ssh_00000000-0000-0000-0000-000000000002'

class TrafficTests(unittest.TestCase):
    def setUp(self):
        o.records={};o.socket_watermarks={};o.socket_online={}
        o.policy_by_hash={'hash':{'id':A,'username':'abv_alice','baselineUsedBytes':100},'other':{'id':B,'username':'abv_bob','baselineUsedBytes':0}}

    def test_only_accepted_managed_ssh_socket(self):
        text='''0 0 127.0.0.1:22 127.0.0.1:42100 users:(("sshd",pid=7,fd=4),("sshd",pid=8,fd=4)) uid:1001 ino:123
\t cubic bytes_sent:700 bytes_acked:600 bytes_received:400
0 0 192.0.2.1:42101 192.0.2.2:443 users:(("sshd",pid=8,fd=5)) ino:124
\t cubic bytes_sent:10000 bytes_acked:10000 bytes_received:9000
0 0 [::1]:22 [::1]:42102 users:(("sshd",pid=9,fd=4)) ino:125
\t cubic bytes_acked:222 bytes_received:333
0 0 127.0.0.1:22 127.0.0.1:42103 users:(("sshd",pid=10,fd=4)) ino:126
\t cubic bytes_acked:999 bytes_received:999
'''
        samples=list(o.ssh_socket_samples(text,{7:A,8:A,9:B}))
        self.assertEqual(len(samples),2)
        self.assertEqual(samples[0][2:],(400,600))
        self.assertEqual(samples[1][0],B)
        o.apply_socket_samples(samples+samples)
        self.assertEqual(o.records[A]['observedBytes'],1000)
        self.assertEqual(o.socket_online,{A:1,B:1})

    def test_restart_and_policy_feedback_do_not_double_count(self):
        o.apply_socket_samples([(A,'boot:socket',300,700)],now=100)
        self.assertEqual(o.records[A]['anchorBaseline']+o.records[A]['observedBytes'],1100)
        with tempfile.TemporaryDirectory() as directory:
            old=o.STORE;o.STORE=Path(directory)/'usage.json'
            o.atomic_json(o.STORE,{'format':'abess-passive-traffic-v1','accounts':o.records,'sockets':o.socket_watermarks})
            o.records={};o.socket_watermarks={};o.load_store();o.STORE=old
        o.policy_by_hash['hash']['baselineUsedBytes']=1100
        o.apply_socket_samples([(A,'boot:socket',300,700)],now=101)
        self.assertEqual(o.records[A]['observedBytes'],1000)
        o.apply_socket_samples([(A,'boot:socket',350,800)],now=102)
        self.assertEqual(o.records[A]['anchorBaseline']+o.records[A]['observedBytes'],1250)
        o.apply_socket_samples([(A,'boot:new-socket',10,20)],now=103)
        self.assertEqual(o.records[A]['observedBytes'],1180)
        o.apply_socket_samples([],now=104)
        self.assertEqual(o.socket_online,{})

    def test_live_kernel_counters(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen()
            port=listener.getsockname()[1]
            with socket.create_connection(('127.0.0.1',port)) as client:
                server,_=listener.accept()
                with server:
                    client.sendall(b'u'*12345);self.assertEqual(len(server.recv(20000)),12345)
                    server.sendall(b'd'*23456);self.assertEqual(len(client.recv(30000)),23456)
                    time.sleep(.1)
                    text=subprocess.check_output(o.ssh_socket_command({port}),text=True)
                    if 'bytes_received:' not in text:
                        self.skipTest('Host kernel omits TCP byte counters; run this test in Linux Docker.')
                    samples=list(o.ssh_socket_samples(text,{os.getpid():A},{port}))
                    self.assertEqual(len(samples),1)
                    self.assertEqual(samples[0][2],12345)
                    self.assertEqual(samples[0][3],23456)
                    o.apply_socket_samples(samples)
                    self.assertEqual(o.records[A]['observedBytes'],35801)

if __name__=='__main__':unittest.main()
