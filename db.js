require("dotenv").config({ override: true });
const mysql = require("mysql2/promise");

// Database configuration
const dbConfig = {
  host: process.env.MYSQL_HOST || process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT || "3306", 10),
  user: process.env.MYSQL_USER || process.env.DB_USER || "root",
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "root", // User provided password
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || "ServiceDX", // We will create this if it doesn't exist
  multipleStatements: true,
};

let pool;

function getPublicDbConfig() {
  const userSource = process.env.MYSQL_USER ? "MYSQL_USER" : (process.env.DB_USER ? "DB_USER" : "default");
  const databaseSource = process.env.MYSQL_DATABASE ? "MYSQL_DATABASE" : (process.env.DB_NAME ? "DB_NAME" : "default");
  const hostSource = process.env.MYSQL_HOST ? "MYSQL_HOST" : (process.env.DB_HOST ? "DB_HOST" : "default");
  const portSource = process.env.MYSQL_PORT ? "MYSQL_PORT" : (process.env.DB_PORT ? "DB_PORT" : "default");
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    sources: {
      host: hostSource,
      port: portSource,
      user: userSource,
      database: databaseSource,
    },
  };
}

async function getPool() {
  if (pool) return pool;
  
  console.log("Initializing MySQL database connection...");
  console.log(`Config: Host=${dbConfig.host}:${dbConfig.port}, User=${dbConfig.user}, DB=${dbConfig.database}`);
  
  // First connect without database to create it if needed
  try {
      const connection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
      });
    
      console.log("Connected to MySQL server. Checking database...");
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
      await connection.end();
    
      // Now create pool with database
      pool = mysql.createPool({
        ...dbConfig,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
    
      console.log("Database pool created. Seeding schema...");
      await initSchemaAndSeed(pool);
      console.log("Database initialization complete.");
      return pool;
  } catch (err) {
      console.error("FATAL: Database initialization failed:", err.message);
      if (err.code === 'ER_ACCESS_DENIED_ERROR') {
          console.error("Authentication Error: Please check your DB_PASSWORD in .env file.");
      }
      throw err;
  }
}

async function initSchemaAndSeed(pool) {
  const connection = await pool.getConnection();
  try {
    // Create dws_tas_roster table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS dws_tas_roster (
        st_EmpID VARCHAR(6) COMMENT '员工工号，6位数字',
        st_EmpNameCN VARCHAR(100) COMMENT '员工中文姓名',
        st_EmpNameEN VARCHAR(100) COMMENT '员工英文姓名',
        st_WorkLocation VARCHAR(100) COMMENT '员工工作地',
        dt_HireDate DATETIME COMMENT '员工被雇佣的开始日期',
        d_YearsOfService FLOAT COMMENT '员工已工作年数',
        st_EmpApproverName VARCHAR(100) COMMENT '员工的1级审批者',
        st_FinalApproverName VARCHAR(100) COMMENT '员工的2级审批者',
        st_EmpAvailable VARCHAR(1) COMMENT '在职状态：1=在职，0=离职',
        st_DeptName VARCHAR(100) COMMENT '员工的产品部门',
        st_LEOName VARCHAR(100) COMMENT '员工雇佣属性',
        st_EMPBand VARCHAR(1) COMMENT '正式员工的职群',
        st_OrgName VARCHAR(100) COMMENT '组织的名称',
        st_OrgPICID VARCHAR(6) COMMENT '组织负责人的工号',
        st_OrgPICName VARCHAR(100) COMMENT '组织负责人的中文姓名',
        st_WrMonth VARCHAR(8) COMMENT '数据的版本',
        st_ClassName VARCHAR(8) COMMENT '员工的职群类别'
      ) DEFAULT CHARSET=utf8mb4;
    `);

    // Create dws_wisdom_machine table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS dws_wisdom_machine (
        st_SN VARCHAR(100) NOT NULL COMMENT '机台sn号码',
        st_MachineWarrantyStatus VARCHAR(100) COMMENT '机台保修状态',
        st_MachineSWLHModel VARCHAR(100) COMMENT '机台对应的机型',
        st_MachineClusterFlag VARCHAR(100) COMMENT '机台本体标志',
        st_ProductLine VARCHAR(100) COMMENT '机台的产品部门',
        st_BP VARCHAR(100) COMMENT '客户简称',
        st_Fab VARCHAR(100) COMMENT '机台所在客户工厂名称Fab',
        st_BU VARCHAR(100) COMMENT '机台对应的BU',
        st_City VARCHAR(100) COMMENT '机台对应客户所在的城市',
        st_Site VARCHAR(100) COMMENT '机台所属的区域',
        st_MachineModelName VARCHAR(100) COMMENT '机台机型名称',
        dt_MachineFactoryShippingDate DATETIME COMMENT '机台从工厂运出的时间',
        dt_MachineMoveInDate DATETIME COMMENT '机台搬入到客户fab的时间',
        dt_MachineStartUpHardwareEndDate DATETIME COMMENT '机台装机结束的时间',
        dt_MachineWarrantyStartDate DATETIME COMMENT '机台维保开始的时间',
        dt_MachineWarrantyExpiryDate DATETIME COMMENT '机台维保结束的时间',
        st_WrMonth VARCHAR(8) COMMENT '数据的版本'
      ) DEFAULT CHARSET=utf8mb4;
    `);

    // Seed Roster Data
    const [rosterRows] = await connection.query("SELECT COUNT(*) as count FROM dws_tas_roster");
    if (rosterRows[0].count === 0) {
      console.log("Seeding dws_tas_roster...");
      const months = ["202510", "202511", "202512"];
      const depts = ["CT", "SPS", "ES", "3DI", "CERTAS"];
      const orgs = ["PSM", "非PSM"];
      const classNames = ["FE", "Sales", "Member", "Manager"];
      
      const values = [];
      for (let i = 0; i < 100; i++) {
        const empId = String(100000 + i);
        const nameCN = `员工${i}`;
        const dept = depts[i % depts.length];
        const org = orgs[i % orgs.length];
        const month = months[i % months.length];
        const className = classNames[i % classNames.length]; // mostly FE if we want matches
        // Let's force more FEs for better demo results
        const actualClassName = (i % 3 === 0) ? "Sales" : "FE"; 
        
        values.push([
          empId, nameCN, `Emp${i}`, "Shanghai", new Date(), 2.5, "Manager1", "Director1",
          "1", // Active
          dept,
          "L", // Local Formal
          "E", // Engineer Band
          org,
          "000001", "Boss",
          month,
          actualClassName
        ]);
      }
      
      const sql = `INSERT INTO dws_tas_roster (
        st_EmpID, st_EmpNameCN, st_EmpNameEN, st_WorkLocation, dt_HireDate, d_YearsOfService, 
        st_EmpApproverName, st_FinalApproverName, st_EmpAvailable, st_DeptName, st_LEOName, 
        st_EMPBand, st_OrgName, st_OrgPICID, st_OrgPICName, st_WrMonth, st_ClassName
      ) VALUES ?`;
      
      await connection.query(sql, [values]);
    }

    // Seed Machine Data
    const [machineRows] = await connection.query("SELECT COUNT(*) as count FROM dws_wisdom_machine");
    if (machineRows[0].count === 0) {
      console.log("Seeding dws_wisdom_machine...");
      const products = ["CT", "SPS", "ES", "3DI"];
      const customers = ["BYD", "CATL", "Tesla", "NIO"];
      
      const values = [];
      for (let i = 0; i < 50; i++) {
        const sn = "SN" + String(10000 + i);
        const product = products[i % products.length];
        const customer = customers[i % customers.length];
        const month = "202512"; // Latest version
        
        values.push([
          sn, "Active", "ModelX", "R", // R=Rig
          product, customer, "Fab1", "BU1", "Hefei", "Hefei Site", "ModelX-1000",
          new Date(), new Date(), new Date(), new Date(), new Date(),
          month
        ]);
      }

      const sql = `INSERT INTO dws_wisdom_machine (
        st_SN, st_MachineWarrantyStatus, st_MachineSWLHModel, st_MachineClusterFlag, 
        st_ProductLine, st_BP, st_Fab, st_BU, st_City, st_Site, st_MachineModelName, 
        dt_MachineFactoryShippingDate, dt_MachineMoveInDate, dt_MachineStartUpHardwareEndDate, 
        dt_MachineWarrantyStartDate, dt_MachineWarrantyExpiryDate, st_WrMonth
      ) VALUES ?`;
      
      await connection.query(sql, [values]);
    }

  } catch (e) {
    console.error("Init Schema Error:", e);
    throw e;
  } finally {
    connection.release();
  }
}

async function query(sql, params) {
  const p = await getPool();
  // Execute query
  const [rows] = await p.query(sql, params);
  return rows;
}

module.exports = {
  query,
  getPublicDbConfig,
};
