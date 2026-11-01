import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH || "./plexus.db";
  const bundledPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.resolve(process.cwd(), dbPath);

  let resolvedPath = bundledPath;

  if (process.env.VERCEL) {
    // Vercel's project folder is read-only, /tmp is writable.
    resolvedPath = "/tmp/plexus.db";
    if (!fs.existsSync(resolvedPath) && fs.existsSync(bundledPath)) {
      fs.copyFileSync(bundledPath, resolvedPath);
    }
  } else {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  dbInstance = new Database(resolvedPath);
  dbInstance.pragma("journal_mode = WAL");

  initSchema(dbInstance);
  return dbInstance;
}