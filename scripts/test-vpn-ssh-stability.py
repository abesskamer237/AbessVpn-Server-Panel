#!/usr/bin/env python3
"""Validate generated SSH configuration with OpenSSH before touching a VPS."""
import shutil,subprocess,sys,tempfile,unittest
from pathlib import Path

class SshStabilityTest(unittest.TestCase):
    def test_match_scoping_and_idempotence(self):
        sshd=shutil.which('sshd') or '/usr/sbin/sshd'
        if not Path(sshd).exists():self.skipTest('OpenSSH server is required')
        script=Path(__file__).with_name('stabilize-vpn-ssh.sh').read_text()
        generator=script.split("<<'PY'\n",1)[1].split('\nPY\n',1)[0]
        with tempfile.TemporaryDirectory() as directory:
            d=Path(directory);key=d/'host_key';original=d/'original';candidate=d/'candidate'
            subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-f',str(key)],check=True)
            original.write_text('HostKey '+str(key)+'\nClientAliveInterval 15\nClientAliveCountMax 9999\nPasswordAuthentication no\n')
            subprocess.run([sys.executable,'-c',generator,str(original),str(candidate)],check=True)
            subprocess.run([sshd,'-t','-f',str(candidate)],check=True)
            def settings(user):
                out=subprocess.check_output([sshd,'-T','-f',str(candidate),'-C','user='+user+',host=localhost,addr=127.0.0.1'],text=True)
                return dict(line.split(' ',1) for line in out.splitlines())
            self.assertEqual(settings('abv_test')['clientalivecountmax'],'6')
            self.assertEqual(settings('abv_test')['clientaliveinterval'],'30')
            self.assertEqual(settings('root')['clientalivecountmax'],'9999')
            self.assertEqual(settings('operator')['clientaliveinterval'],'15')
            self.assertEqual(settings('abv_test')['passwordauthentication'],'no')
            first=candidate.read_text()
            subprocess.run([sys.executable,'-c',generator,str(candidate),str(candidate)],check=True)
            self.assertEqual(candidate.read_text(),first)

if __name__=='__main__':unittest.main()
