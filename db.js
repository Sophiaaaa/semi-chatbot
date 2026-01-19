const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "kpi_chatbot.db");
let db;

function getDb() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const _db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db = _db;
      initSchemaAndSeed(db)
        .then(() => resolve(db))
        .catch(reject);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initSchemaAndSeed(dbInstance) {
  await run(
    dbInstance,
    `CREATE TABLE IF NOT EXISTS personnel_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      update_month TEXT NOT NULL,
      product TEXT NOT NULL,
      org TEXT NOT NULL
    )`
  );
  
  await run(
    dbInstance,
    `CREATE TABLE IF NOT EXISTS machine_info (
      sn TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      customer_short_name TEXT,
      shipping_date TEXT,
      move_in_date TEXT,
      hardware_date TEXT,
      warranty_start_date TEXT,
      warranty_end_date TEXT
    )`
  );

  const rows = await all(dbInstance, "SELECT COUNT(*) AS count FROM personnel_detail");
  if (rows[0] && rows[0].count === 0) {
    const months = ["202510", "202511", "202512"];
    const products = ["ct", "sps", "es"];
    const orgs = ["psm", "非psm"];
    
    const stmt = dbInstance.prepare("INSERT INTO personnel_detail (employee_id, update_month, product, org) VALUES (?, ?, ?, ?)");
    
    dbInstance.serialize(() => {
        dbInstance.run("BEGIN TRANSACTION");
        for (let i = 0; i < 100; i += 1) {
            const employeeId = "E" + String(1000 + i);
            const month = months[i % months.length];
            const product = products[i % products.length];
            const org = orgs[i % orgs.length];
            stmt.run(employeeId, month, product, org);
        }
        dbInstance.run("COMMIT");
    });
    stmt.finalize();
  }
  
  const machineRows = await all(dbInstance, "SELECT COUNT(*) AS count FROM machine_info");
  if (machineRows[0] && machineRows[0].count === 0) {
      const products = ["ct", "sps", "es"];
      const customers = ["BYD", "CATL", "Tesla", "NIO"];
      
      const stmt = dbInstance.prepare(`
        INSERT INTO machine_info (
            sn, product, customer_short_name, 
            shipping_date, move_in_date, hardware_date, 
            warranty_start_date, warranty_end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      dbInstance.serialize(() => {
          dbInstance.run("BEGIN TRANSACTION");
          for (let i = 0; i < 50; i += 1) {
              const sn = "SN" + String(10000 + i);
              const product = products[i % products.length];
              const customer = customers[i % customers.length];
              // Simple random dates
              const dateStr = `2025-${String((i % 12) + 1).padStart(2, '0')}-15`;
              stmt.run(sn, product, customer, dateStr, dateStr, dateStr, dateStr, "2026-01-01");
          }
          dbInstance.run("COMMIT");
      });
      stmt.finalize();
  }
}

async function query(sql, params) {
  const dbInstance = await getDb();
  // Simple regex to convert MySQL-style placeholders (?) to SQLite compatible if needed.
  // Actually sqlite3 supports ? placeholders, so we are good.
  // But we need to handle bulk insert syntax if used elsewhere.
  // In server.js, queries are simple SELECTs with WHERE clauses using ?, so it should be fine.
  return await all(dbInstance, sql, params);
}

module.exports = {
  query,
};
