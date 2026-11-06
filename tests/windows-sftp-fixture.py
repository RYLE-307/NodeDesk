"""Independent loopback SSH/SFTP peer for native Windows client CI.

Linux tests use real OpenSSH/PAM. This peer exercises Windows client code and
keyboard-interactive callbacks, not Windows OpenSSH server/PAM compatibility.
Only generated disposable credentials are used; none are printed or in argv.
"""
import errno
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import paramiko

root = Path(sys.argv[1]).resolve()
root.mkdir(exist_ok=True)
home = root / 'remote'
home.mkdir()
secret = secrets.token_hex(24)
user = 'ndfixture'
(root / 'auth-user').write_text(user)
(root / 'auth-secret').write_text(secret)
key = paramiko.ECDSAKey.generate()
other = paramiko.ECDSAKey.generate()
public = f'{key.get_name()} {key.get_base64()}'
(root / 'trusted-gui').write_text(f'[127.0.0.1]:22229 {public}\n')
(root / 'changed').write_text(f'[127.0.0.1]:22229 {other.get_name()} {other.get_base64()}\n')
(root / 'revoked').write_text(f'@revoked [127.0.0.1]:22229 {public}\n')


class Auth(paramiko.ServerInterface):
    def get_allowed_auths(self, username):
        return 'keyboard-interactive,password'

    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL if username == user and secrets.compare_digest(password, secret) else paramiko.AUTH_FAILED

    def check_auth_interactive(self, username, submethods):
        self.username = username
        return paramiko.InteractiveQuery('Fixture', '', ('Password:', False))

    def check_auth_interactive_response(self, responses):
        return self.check_auth_password(self.username, responses[0]) if len(responses) == 1 else paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == 'session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED


class FS(paramiko.SFTPServerInterface):
    def path(self, path):
        candidate = (home / path.lstrip('/')).resolve()
        if not candidate.is_relative_to(home):
            raise OSError(errno.EACCES, 'Outside fixture')
        return candidate

    def canonicalize(self, path):
        return '/' + self.path(path).relative_to(home).as_posix().removeprefix('.')

    def list_folder(self, path):
        try:
            result = []
            for p in self.path(path).iterdir():
                attr = paramiko.SFTPAttributes.from_stat(p.lstat())
                attr.filename = p.name
                result.append(attr)
            return result
        except OSError as e:
            return paramiko.SFTPServer.convert_errno(e.errno)

    def stat(self, path):
        try:
            return paramiko.SFTPAttributes.from_stat(self.path(path).stat())
        except OSError as e:
            return paramiko.SFTPServer.convert_errno(e.errno)

    lstat = stat

    def open(self, path, flags, attr):
        try:
            fd = os.open(self.path(path), flags | getattr(os, 'O_BINARY', 0), 0o600)
            stream = os.fdopen(fd, 'r+b' if flags & os.O_RDWR else 'wb' if flags & os.O_WRONLY else 'rb')
            handle = paramiko.SFTPHandle(flags)
            handle.readfile = stream
            handle.writefile = stream
            return handle
        except OSError as e:
            return paramiko.SFTPServer.convert_errno(e.errno)

    def rename(self, old, new):
        try:
            # Fixture promises the v3 no-overwrite behavior tested by the client.
            os.link(self.path(old), self.path(new))
            os.unlink(self.path(old))
            return paramiko.SFTP_OK
        except OSError as e:
            return paramiko.SFTPServer.convert_errno(e.errno)

    def mkdir(self, path, attr):
        try:
            self.path(path).mkdir()
            return paramiko.SFTP_OK
        except OSError as e:
            return paramiko.SFTPServer.convert_errno(e.errno)

    def rmdir(self, path):
        try:
            self.path(path).rmdir()
            return paramiko.SFTP_OK
        except OSError as e:
            return paramiko.SFTPServer.convert_errno(e.errno)


def serve(client):
    transport = paramiko.Transport(client)
    transport.add_server_key(key)
    transport.set_subsystem_handler('sftp', paramiko.SFTPServer, FS)
    try:
        transport.start_server(server=Auth())
        while transport.is_active():
            time.sleep(0.05)
    except (EOFError, OSError, paramiko.SSHException):
        pass
    finally:
        transport.close()


with socket.socket() as listener:
    listener.bind(('127.0.0.1', 22229))
    listener.listen(16)
    (root / 'ready').touch()
    while True:
        client, _ = listener.accept()
        threading.Thread(target=serve, args=(client,), daemon=True).start()
