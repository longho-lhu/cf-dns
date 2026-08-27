require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Đảm bảo thư mục data tồn tại
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'dns_system.db');
const db = new Database(dbPath);

// Bật Foreign Keys & WAL mode để tối ưu hiệu năng
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Khởi tạo các bảng
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      class_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'student',
      status TEXT NOT NULL DEFAULT 'pending',
      max_subdomains INTEGER DEFAULT 5,
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dns_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subdomain TEXT NOT NULL,
      full_domain TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'A',
      content TEXT NOT NULL,
      ttl INTEGER DEFAULT 1,
      proxied INTEGER DEFAULT 0,
      cf_record_id TEXT DEFAULT '',
      cf_status TEXT DEFAULT 'synced',
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default settings nếu chưa có
  const defaultSettings = [
    { key: 'cf_api_token', value: process.env.CLOUDFLARE_API_TOKEN || '', description: 'Cloudflare API Token' },
    { key: 'cf_zone_id', value: process.env.CLOUDFLARE_ZONE_ID || '', description: 'Cloudflare Zone ID' },
    { key: 'cf_root_domain', value: process.env.CLOUDFLARE_ROOT_DOMAIN || 'fit.pro.vn', description: 'Tên miền chính (Root domain)' },
    { key: 'default_max_subdomains', value: process.env.DEFAULT_MAX_SUBDOMAINS || '5', description: 'Số lượng subdomain tối đa mặc định cho mỗi sinh viên' },
    { key: 'reserved_subdomains', value: 'admin,api,mail,www,cpanel,webmail,ns,ns1,ns2,dns,ftp,ssh,root,dev,fit,portal,gateway,auth,login,support,vpn', description: 'Danh sách subdomain bị cấm tạo (phân cách bằng dấu phẩy)' }
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description)
    VALUES (@key, @value, @description)
  `);

  for (const s of defaultSettings) {
    insertSetting.run(s);
  }

  // Seed Admin mặc định hoặc cập nhật nếu chưa có
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'longthuong.1908';
  const adminName = process.env.ADMIN_NAME || 'Quản Trị Viên FIT';
  const hashedPassword = bcrypt.hashSync(adminPass, 10);

  const adminCheck = db.prepare("SELECT * FROM users WHERE username = ?").get(adminUser);
  if (!adminCheck) {
    db.prepare(`
      INSERT INTO users (username, password, full_name, class_name, role, status, max_subdomains)
      VALUES (?, ?, ?, 'Ban Quản Trị', 'admin', 'approved', 999)
    `).run(adminUser, hashedPassword, adminName);
    console.log(`[DB] Đã khởi tạo tài khoản Admin: Username=${adminUser}`);
  } else {
    // Luôn đảm bảo mật khẩu admin được cập nhật theo .env
    db.prepare("UPDATE users SET password = ?, full_name = ? WHERE username = ?").run(hashedPassword, adminName, adminUser);
  }
}

initDatabase();

module.exports = db;
