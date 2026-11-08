//! Bounded, sequential SFTP v3 codec. No human-readable CLI/longname parsing.
//! Protocol: https://www.openssh.org/txt/draft-ietf-secsh-filexfer-02.txt
use std::io::{Read, Write};

pub type Result<T> = std::result::Result<T, String>;
const MAX_PACKET: usize = 1024 * 1024;
pub const MAX_ENTRIES: usize = 10_000;
pub const CHUNK: usize = 32_768;

pub fn name(value: &str) -> Result<()> {
    if value.is_empty() || value == "." || value == ".." || value.len() > 255
        || value.chars().any(|c| c.is_control() || c == '/' || c == '\\' || c == ':') {
        return Err("Invalid filename".into());
    }
    // Win32 aliases, device files and alternate streams must never become local targets.
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if value.ends_with([' ', '.']) || ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit())
        || value.contains(['<', '>', '"', '|', '?', '*']) {
        return Err("Filename is not portable".into());
    }
    Ok(())
}
pub fn path(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 16_384 || value.chars().any(|c| c.is_control())
        || value.contains('\\') || value.split('/').any(|part| part == "..") {
        return Err("Invalid remote path".into());
    }
    Ok(())
}
pub fn join(parent: &str, child: &str) -> Result<String> {
    path(parent)?;
    name(child)?;
    Ok(format!("{}/{child}", parent.trim_end_matches('/')))
}
pub fn u32b(out: &mut Vec<u8>, n: u32) { out.extend(n.to_be_bytes()); }
pub fn string(out: &mut Vec<u8>, bytes: &[u8]) { u32b(out, bytes.len() as u32); out.extend(bytes); }
pub struct Decoder<'a>(pub &'a [u8]);
impl<'a> Decoder<'a> {
    pub fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.0.len() { return Err("Truncated SFTP packet".into()); }
        let (a,b) = self.0.split_at(n); self.0 = b; Ok(a)
    }
    pub fn byte(&mut self) -> Result<u8> { Ok(self.take(1)?[0]) }
    pub fn uint(&mut self) -> Result<u32> { Ok(u32::from_be_bytes(self.take(4)?.try_into().unwrap())) }
    pub fn long(&mut self) -> Result<u64> { Ok(u64::from_be_bytes(self.take(8)?.try_into().unwrap())) }
    pub fn bytes(&mut self) -> Result<&'a [u8]> { let n = self.uint()? as usize; self.take(n) }
    pub fn text(&mut self) -> Result<String> { String::from_utf8(self.bytes()?.to_vec()).map_err(|_| "Non-UTF-8 filename is unsupported".into()) }
    pub fn end(&self) -> Result<()> { if self.0.is_empty() { Ok(()) } else { Err("Unexpected SFTP payload".into()) } }
}
#[derive(Clone, Debug, Default)]
pub struct Attrs { pub size: Option<u64>, pub permissions: Option<u32>, pub modified: Option<u32> }
impl Attrs {
    pub fn read(d: &mut Decoder<'_>) -> Result<Self> {
        let flags = d.uint()?;
        if flags & !0x8000000f != 0 { return Err("Unsupported SFTP attributes".into()); }
        let size = if flags & 1 != 0 { Some(d.long()?) } else { None };
        if flags & 2 != 0 { d.take(8)?; }
        let permissions = if flags & 4 != 0 { Some(d.uint()?) } else { None };
        let modified = if flags & 8 != 0 { d.uint()?; Some(d.uint()?) } else { None };
        if flags & 0x80000000 != 0 {
            let count = d.uint()?;
            if count > 1024 { return Err("Too many SFTP extensions".into()); }
            for _ in 0..count { d.bytes()?; d.bytes()?; }
        }
        Ok(Self { size, permissions, modified })
    }
    pub fn kind(&self) -> &'static str {
        match self.permissions.unwrap_or(0) & 0o170000 { 0o100000 => "file", 0o040000 => "directory", 0o120000 => "symlink", _ => "other" }
    }
}
pub struct Client<R, W> { reader: R, writer: W, id: u32 }
impl<R: Read, W: Write> Client<R,W> {
    pub fn new(reader: R, writer: W) -> Result<Self> {
        let mut c = Self { reader, writer, id: 0 };
        c.send(&[1,0,0,0,3])?;
        let p = c.receive()?; let mut d = Decoder(&p);
        if d.byte()? != 2 || d.uint()? != 3 { return Err("SFTP v3 required".into()); }
        while !d.0.is_empty() { d.bytes()?; d.bytes()?; }
        Ok(c)
    }
    fn send(&mut self, p: &[u8]) -> Result<()> {
        if p.is_empty() || p.len() > MAX_PACKET { return Err("SFTP packet limit".into()); }
        self.writer.write_all(&(p.len() as u32).to_be_bytes()).and_then(|_| self.writer.write_all(p)).and_then(|_| self.writer.flush()).map_err(|_| "SFTP write failed".into())
    }
    fn receive(&mut self) -> Result<Vec<u8>> {
        let mut len = [0;4]; self.reader.read_exact(&mut len).map_err(|_| "SFTP disconnected (check host trust and key/agent authentication)".to_string())?;
        let n = u32::from_be_bytes(len) as usize;
        if n == 0 || n > MAX_PACKET { return Err("SFTP packet limit".into()); }
        let mut p = vec![0;n]; self.reader.read_exact(&mut p).map_err(|_| "Truncated SFTP response".to_string())?; Ok(p)
    }
    pub fn request(&mut self, kind: u8, data: Vec<u8>) -> Result<Vec<u8>> {
        self.id = self.id.checked_add(1).ok_or("SFTP request limit")?;
        let mut p = vec![kind]; u32b(&mut p,self.id); p.extend(data); self.send(&p)?;
        let p = self.receive()?; let mut d = Decoder(&p); d.byte()?;
        if d.uint()? != self.id { return Err("SFTP response ID mismatch".into()); }
        Ok(p)
    }
    pub fn status(p: &[u8]) -> Result<u32> {
        let mut d = Decoder(p);
        if d.byte()? != 101 { return Err("Expected SFTP status".into()); }
        d.uint()?; let code = d.uint()?; d.bytes()?; d.bytes()?; d.end()?; Ok(code)
    }
    pub fn ok(p: &[u8]) -> Result<()> {
        let code = Self::status(p)?;
        if code == 0 { Ok(()) } else { Err(format!("SFTP status {code} (2: missing, 3: permission denied, 4: failure)")) }
    }
    fn payload(p: &[u8], kind: u8) -> Result<Decoder<'_>> {
        let mut d = Decoder(p);
        if d.byte()? != kind { if p.first() == Some(&101) { Self::ok(p)?; } return Err("Unexpected SFTP response".into()); }
        d.uint()?; Ok(d)
    }
    pub fn handle(&mut self, kind: u8, data: Vec<u8>) -> Result<Vec<u8>> {
        let p = self.request(kind,data)?; let mut d = Self::payload(&p,102)?;
        let handle = d.bytes()?.to_vec(); d.end()?; Ok(handle)
    }
    pub fn close(&mut self, handle: &[u8]) -> Result<()> {
        let mut b = vec![]; string(&mut b,handle); Self::ok(&self.request(4,b)?)
    }
    pub fn names(p: &[u8]) -> Result<Vec<(String,Attrs)>> {
        let mut d = Self::payload(p,104)?; let count = d.uint()? as usize;
        if count > MAX_ENTRIES { return Err("Directory entry limit (10000)".into()); }
        let mut entries = vec![];
        for _ in 0..count {
            let filename = d.text()?; d.bytes()?; // longname is explicitly untrusted and ignored.
            let attrs = Attrs::read(&mut d)?; entries.push((filename,attrs));
        }
        d.end()?; Ok(entries)
    }
    pub fn realpath(&mut self, path: &str) -> Result<String> {
        let mut b = vec![]; string(&mut b,path.as_bytes());
        let entries = Self::names(&self.request(16,b)?)?;
        if entries.len() != 1 { return Err("Invalid canonical path".into()); }
        let p = &entries[0].0; super::sftp_wire::path(p)?;
        if !p.starts_with('/') { return Err("Absolute remote path required".into()); }
        Ok(p.clone())
    }
    pub fn list(&mut self, path: &str) -> Result<Vec<(String,Attrs)>> {
        let mut b = vec![]; string(&mut b,path.as_bytes()); let h = self.handle(11,b)?;
        let mut entries = vec![];
        loop {
            let mut b = vec![]; string(&mut b,&h); let p = self.request(12,b)?;
            if p[0] == 101 && Self::status(&p)? == 1 { break; }
            for entry in Self::names(&p)? {
                if entry.0 == "." || entry.0 == ".." { continue; }
                // Unsupported names fail the whole listing, never normalize into another path.
                name(&entry.0)?; entries.push(entry);
                if entries.len() > MAX_ENTRIES { return Err("Directory entry limit (10000)".into()); }
            }
        }
        self.close(&h)?; Ok(entries)
    }
    pub fn lstat(&mut self, path: &str) -> Result<Attrs> {
        let mut b = vec![]; string(&mut b,path.as_bytes()); let p = self.request(7,b)?;
        let mut d = Self::payload(&p,105)?; let a = Attrs::read(&mut d)?; d.end()?; Ok(a)
    }
    /// Only a canonical parent and a validated single filename may reach callers.
    /// SFTP v3 RENAME has no overwrite flag: compliant servers reject an existing
    /// destination. We also LSTAT it first, but concurrent hostile writers can race.
    pub fn missing(&mut self, path: &str) -> Result<bool> {
        let mut b = vec![]; string(&mut b,path.as_bytes());
        let p = self.request(7,b)?;
        if p[0] == 101 {
            return match Self::status(&p)? {
                2 => Ok(true),
                code => Err(format!("SFTP status {code} checking destination")),
            };
        }
        let mut d = Self::payload(&p,105)?;
        Attrs::read(&mut d)?; d.end()?; Ok(false)
    }
    pub fn mkdir(&mut self, path: &str) -> Result<()> {
        let mut b = vec![]; string(&mut b,path.as_bytes());
        u32b(&mut b,0); // no attrs; server's umask controls new directory
        Self::ok(&self.request(14,b)?)
    }
    /// POSIX mode bits only. Never accept setuid, setgid or sticky flags.
    /// SFTP SETSTAT operates on a path and is NOT atomic with LSTAT.
    pub fn set_permissions(&mut self, path: &str, mode: u32) -> Result<()> {
        super::sftp_wire::path(path)?;
        if mode > 0o777 {return Err("Only ordinary 000–777 POSIX modes are supported".into());}
        let mut body = vec![];
        string(&mut body,path.as_bytes());
        u32b(&mut body,4); // SSH_FILEXFER_ATTR_PERMISSIONS, no other attrs
        u32b(&mut body,mode);
        Self::ok(&self.request(9,body)?) // SSH_FXP_SETSTAT
    }
    pub fn rename(&mut self, old: &str, new: &str) -> Result<()> {
        let mut b = vec![]; string(&mut b,old.as_bytes()); string(&mut b,new.as_bytes());
        Self::ok(&self.request(18,b)?)
    }
    pub fn remove(&mut self, path: &str, directory: bool) -> Result<()> {
        let mut b = vec![]; string(&mut b,path.as_bytes());
        Self::ok(&self.request(if directory {15} else {13},b)?)
    }
    pub fn open(&mut self, path: &str, flags: u32) -> Result<Vec<u8>> {
        let mut b = vec![]; string(&mut b,path.as_bytes()); u32b(&mut b,flags);
        // New files are private; remote existing permissions are never modified.
        u32b(&mut b,4); u32b(&mut b,0o600); self.handle(3,b)
    }
    pub fn read(&mut self, h: &[u8], offset: u64) -> Result<Option<Vec<u8>>> {
        let mut b = vec![]; string(&mut b,h); b.extend(offset.to_be_bytes()); u32b(&mut b,CHUNK as u32);
        let p = self.request(5,b)?;
        if p[0] == 101 && Self::status(&p)? == 1 { return Ok(None); }
        let mut d = Self::payload(&p,103)?; let bytes = d.bytes()?.to_vec(); d.end()?;
        if bytes.is_empty() || bytes.len() > CHUNK { return Err("Invalid SFTP data size".into()); }
        Ok(Some(bytes))
    }
    pub fn write(&mut self, h: &[u8], offset: u64, bytes: &[u8]) -> Result<()> {
        let mut b = vec![]; string(&mut b,h); b.extend(offset.to_be_bytes()); string(&mut b,bytes); Self::ok(&self.request(6,b)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    fn frame(p: &[u8]) -> Vec<u8> { let mut b = vec![]; u32b(&mut b,p.len() as u32); b.extend(p); b }
    #[test] fn paths_and_portable_names() {
        for s in ["..", ".", "a/b", "a\\b", "x:y", "NUL.txt", "COM1", "x.", "x\n", ""] { assert!(name(s).is_err(),"{s}"); }
        assert!(name("файл с пробелом.bin").is_ok());
        assert_eq!(join("/tmp", "a;$(x).bin").unwrap(),"/tmp/a;$(x).bin");
        assert!(path("/tmp/../etc").is_err());
    }
    #[test]
    fn chmod_is_bounded_setstat_without_other_attribute_flags() {
        let mut stream=frame(&[2,0,0,0,3]);
        let mut okay=vec![101]; u32b(&mut okay,1); u32b(&mut okay,0);
        string(&mut okay,b"ok");string(&mut okay,b"");
        stream.extend(frame(&okay));
        let mut c=Client::new(Cursor::new(stream),Vec::new()).unwrap();
        assert!(c.set_permissions("/tmp/file",0o4755).is_err());
        assert!(c.set_permissions("/tmp/file",0o1777).is_err());
        assert!(c.set_permissions("/tmp/../outside",0o644).is_err());
        c.set_permissions("/tmp/file",0o640).unwrap();
        let outgoing=c.writer;
        let mut packet=Decoder(&outgoing[9..]); // Skip SFTP INIT frame
        let payload_size=packet.uint().unwrap() as usize;
        assert_eq!(payload_size,packet.0.len());
        assert_eq!(packet.byte().unwrap(),9);
        assert_eq!(packet.uint().unwrap(),1);
        assert_eq!(packet.text().unwrap(),"/tmp/file");
        assert_eq!(packet.uint().unwrap(),4);
        assert_eq!(packet.uint().unwrap(),0o640);
        packet.end().unwrap();
    }
    #[test] fn mutations_use_sftp_v3_codes_and_validate_missing() {
        // Version then one LSTAT reply "no such file" for request ID 1.
        let mut bytes=frame(&[2,0,0,0,3]);
        let mut status=vec![101]; u32b(&mut status,1); u32b(&mut status,2);
        string(&mut status,b"missing"); string(&mut status,b"");
        bytes.extend(frame(&status));
        let mut c=Client::new(Cursor::new(bytes),Vec::new()).unwrap();
        assert!(c.missing("/tmp/not-there").unwrap());
        let outgoing=c.writer;
        // INIT, then LSTAT packet.
        assert_eq!(outgoing[4],1);
        let init_end=9;
        assert_eq!(outgoing[init_end+4],7);

        // MKDIR must send an empty ATTRS flags value.
        let mut stream=frame(&[2,0,0,0,3]);
        let mut okay=vec![101]; u32b(&mut okay,1); u32b(&mut okay,0);
        string(&mut okay,b""); string(&mut okay,b""); stream.extend(frame(&okay));
        let mut mkdir=Client::new(Cursor::new(stream),Vec::new()).unwrap();
        mkdir.mkdir("/tmp/newdir").unwrap();
        let outgoing=mkdir.writer; assert_eq!(outgoing[9+4],14);
        assert!(outgoing.ends_with(&[0,0,0,0]));
    }
    #[test] fn bounds_and_truncation() {
        for p in [vec![0;4], vec![0xff;4], frame(&[2,0,0]), frame(&[2,0,0,0,4])] {
            assert!(Client::new(Cursor::new(p),Vec::new()).is_err());
        }
        assert!(Decoder(&[0,0,0,99]).bytes().is_err());
    }
    #[test] fn response_ids_and_errors() {
        let mut stream = frame(&[2,0,0,0,3]); stream.extend(frame(&[101,0,0,0,2,0,0,0,3,0,0,0,0,0,0,0,0]));
        let mut c = Client::new(Cursor::new(stream),Vec::new()).unwrap(); assert!(c.request(7,vec![]).is_err());
        assert!(Client::<Cursor<Vec<u8>>,Vec<u8>>::ok(&[101,0,0,0,1,0,0,0,3,0,0,0,0,0,0,0,0]).is_err());
    }
    #[test] fn attributes_and_untrusted_longname() {
        let mut p = vec![104,0,0,0,1]; u32b(&mut p,1); string(&mut p,"тест.bin".as_bytes()); string(&mut p,b"this is NOT an ls record");
        u32b(&mut p,13); p.extend(123u64.to_be_bytes()); u32b(&mut p,0o100600); u32b(&mut p,1); u32b(&mut p,2);
        let e = Client::<Cursor<Vec<u8>>,Vec<u8>>::names(&p).unwrap(); assert_eq!(e[0].0,"тест.bin"); assert_eq!(e[0].1.size,Some(123)); assert_eq!(e[0].1.kind(),"file");
        p.push(0); assert!(Client::<Cursor<Vec<u8>>,Vec<u8>>::names(&p).is_err());
    }
}
