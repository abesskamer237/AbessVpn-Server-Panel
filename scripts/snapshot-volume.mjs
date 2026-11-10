import fs from "node:fs";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
const [mode, source, target] = process.argv.slice(2);
const secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.MASTER_SECRET;
if (!secret || secret.length < 32)
  throw new Error("A backup encryption key is required in the environment.");
const key = crypto.createHash("sha256").update(secret).digest();
const magic = Buffer.from("ABESS-GCM1\n");
const temp = target + ".tmp-" + process.pid;
try {
  if (mode === "decrypt") {
    const size = fs.statSync(source).size;
    const fd = fs.openSync(source, "r");
    const header = Buffer.alloc(magic.length + 12);
    const tag = Buffer.alloc(16);
    fs.readSync(fd, header, 0, header.length, 0);
    fs.readSync(fd, tag, 0, 16, size - 16);
    fs.closeSync(fd);
    if (!header.subarray(0, magic.length).equals(magic))
      throw new Error("Invalid archive");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(magic.length),
    );
    decipher.setAuthTag(tag);
    await pipeline(
      fs.createReadStream(source, { start: header.length, end: size - 17 }),
      decipher,
      fs.createWriteStream(temp, { flags: "wx", mode: 0o600 }),
    );
  } else if (mode === "encrypt") {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    fs.writeFileSync(temp, Buffer.concat([magic, iv]), {
      flag: "wx",
      mode: 0o600,
    });
    let input;
    let child;
    let completion;
    if (source === "-") input = process.stdin;
    else {
      child = spawn("tar", ["czf", "-", "-C", source, "."], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      input = child.stdout;
      completion = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("Archive creation failed")),
        );
      });
    }
    await pipeline(
      input,
      cipher,
      fs.createWriteStream(temp, { flags: "a", mode: 0o600 }),
    );
    if (completion) await completion;
    fs.appendFileSync(temp, cipher.getAuthTag());
  } else
    throw new Error(
      "Usage: snapshot-volume.mjs encrypt <directory|-> <target> OR decrypt <archive> <target>",
    );
  fs.renameSync(temp, target);
} catch (error) {
  fs.rmSync(temp, { force: true });
  throw error;
}
