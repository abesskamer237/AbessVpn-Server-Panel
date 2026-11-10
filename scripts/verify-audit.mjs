import { Pool } from "pg";
import crypto from "node:crypto";
import { canonicalJson } from "../modules/store.ts";
const key = process.env.MASTER_SECRET;
if (!process.env.DATABASE_URL || !key || key.length < 32)
  throw new Error("DATABASE_URL and the stable MASTER_SECRET are required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const records = await pool.query(
    "SELECT event,previous_hash,hash FROM audit_events ORDER BY id",
  );
  let previous = "";
  for (const row of records.rows) {
    const hash = crypto
      .createHmac("sha256", key)
      .update(previous + canonicalJson(row.event))
      .digest("hex");
    if (row.previous_hash !== previous || row.hash !== hash)
      throw new Error("Audit integrity verification failed");
    previous = hash;
  }
  console.log(
    `Audit verified: ${records.rowCount} event(s). Anchor: ${previous}`,
  );
} finally {
  await pool.end();
}
