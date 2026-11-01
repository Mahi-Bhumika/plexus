import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH || "./plexus.db";
  const resolvedPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.resolve(process.cwd(), dbPath);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new Database(resolvedPath);
  dbInstance.pragma("journal_mode = WAL");

  initSchema(dbInstance);
  return dbInstance;
}

function initSchema(db: Database.Database) {
  db.exec(`

    
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      manager_id TEXT
    );

    CREATE TABLE IF NOT EXISTS questionnaires (
      id TEXT PRIMARY KEY,
      customer TEXT,
      uploaded_at TEXT,
      total INTEGER
    );

    CREATE TABLE IF NOT EXISTS rfp_questions (
      id TEXT PRIMARY KEY,
      questionnaire_id TEXT,
      number INTEGER,
      question TEXT,
      answer TEXT,
      confidence REAL,
      status TEXT,
      source_ref TEXT,
      flag_reason TEXT,
      coverage TEXT,
      human_answer TEXT,
      reused_from_fix INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      assignee TEXT,
      due TEXT,
      source_event TEXT,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS access_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      app TEXT,
      risk TEXT,
      status TEXT,
      approver_id TEXT,
      requested_at TEXT,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      merchant TEXT,
      date TEXT,
      gst REAL,
      total REAL,
      category TEXT,
      policy_flag TEXT,
      duplicate_of TEXT,
      card_txn_id TEXT
    );

    CREATE TABLE IF NOT EXISTS saas_billing (
      tool TEXT,
      monthly_cost_inr REAL,
      owner TEXT,
      seats INTEGER
    );

    CREATE TABLE IF NOT EXISTS sso_logins (
      tool TEXT,
      user_id TEXT,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
      agent TEXT,
      action TEXT,
      status TEXT,
      confidence REAL,
      sources_json TEXT,
      trace_id TEXT,
      undo_state TEXT,
      payload_json TEXT
    );

    -- Fallback SQLite tables when Meko fails
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      text TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      conversation_id TEXT,
      input TEXT,
      output TEXT,
      plan TEXT,
      reasoning TEXT,
      created_at TEXT
    );
    
  `);
  // 2. Safely check for and add any missing columns dynamically
const cols = (
  db.prepare("PRAGMA table_info(rfp_questions)").all() as { name: string }[]
).map((c) => c.name);

for (const col of ["flag_reason", "coverage"]) {
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE rfp_questions ADD COLUMN ${col} TEXT`);
  }
}
}

export function seedDatabase(): void {
  const db = getDb();
  
  // Seed users if empty
  const userCount = db.prepare("SELECT count(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const insertUser = db.prepare("INSERT INTO users (id, name, role, manager_id) VALUES (?, ?, ?, ?)");
    insertUser.run("user_riya", "Riya Sharma", "founder", null);
    insertUser.run("user_karan", "Karan", "engineering manager", "user_riya");
    insertUser.run("user_meera", "Meera", "engineering", "user_karan");
    insertUser.run("user_arjun", "Arjun", "intern", "user_karan");
  }

  // Seed sample data directory check
  const dataDir = path.resolve(process.cwd(), "data");
  if (fs.existsSync(dataDir)) {
    // If seed files exist in data/, we can load them and label rows
  }
}
