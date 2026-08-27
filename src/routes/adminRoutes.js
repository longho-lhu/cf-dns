const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { requireAdmin } = require('../middleware/authMiddleware');
const cloudflareService = require('../services/cloudflare');

// Tất cả route bên dưới bắt buộc quyền Quản trị viên
router.use(requireAdmin);

/**
 * Thống kê tổng quan hệ thống (Stats)
 */
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const pendingUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student' AND status = 'pending'").get().count;
    const approvedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student' AND status = 'approved'").get().count;
    const blockedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student' AND (status = 'blocked' OR status = 'rejected')").get().count;
    const totalRecords = db.prepare("SELECT COUNT(*) as count FROM dns_records").get().count;

    // Kiểm tra kết nối Cloudflare
    const cfStatus = await cloudflareService.testConnection();

    return res.json({
      success: true,
      data: {
        totalUsers,
        pendingUsers,
        approvedUsers,
        blockedUsers,
        totalRecords,
        cloudflare: cfStatus
      }
    });
  } catch (error) {
    console.error('Lỗi lấy thống kê:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi tải thống kê hệ thống' });
  }
});

/**
 * Lấy danh sách người dùng / sinh viên
 * Query: status (all/pending/approved/blocked), search (MSSV/Tên/Lớp)
 */
router.get('/users', (req, res) => {
  try {
    const { status, search } = req.query;

    let query = `
      SELECT u.id, u.username, u.full_name as fullName, u.class_name as className,
             u.role, u.status, u.max_subdomains as maxSubdomains, u.note,
             u.created_at as createdAt, u.updated_at as updatedAt,
             (SELECT COUNT(*) FROM dns_records WHERE user_id = u.id) as recordCount
      FROM users u
      WHERE u.role = 'student'
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` AND u.status = ?`;
      params.push(status);
    }

    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      query += ` AND (LOWER(u.username) LIKE ? OR LOWER(u.full_name) LIKE ? OR LOWER(u.class_name) LIKE ?)`;
      params.push(s, s, s);
    }

    query += ` ORDER BY 
      CASE WHEN u.status = 'pending' THEN 1 ELSE 2 END,
      u.created_at DESC
    `;

    const users = db.prepare(query).all(...params);

    return res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách sinh viên:', error);
    return res.status(500).json({ success: false, message: 'Lỗi tải danh sách người dùng' });
  }
});

/**
 * Phê duyệt tài khoản sinh viên (Approve)
 * POST /api/admin/users/:id/approve
 */
router.post('/users/:id/approve', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }

    db.prepare("UPDATE users SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId);

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'APPROVE_USER', ?, ?)
    `).run(
      req.session.user.id,
      req.session.user.username,
      `Phê duyệt tài khoản sinh viên: ${user.username} (${user.full_name} - ${user.class_name})`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã phê duyệt tài khoản sinh viên ${user.full_name} (${user.username})!`
    });
  } catch (error) {
    console.error('Lỗi phê duyệt:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi phê duyệt tài khoản' });
  }
});

/**
 * Từ chối phê duyệt tài khoản sinh viên (Reject)
 * POST /api/admin/users/:id/reject
 */
router.post('/users/:id/reject', (req, res) => {
  try {
    const userId = req.params.id;
    const { note } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }

    db.prepare("UPDATE users SET status = 'rejected', note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(note || 'Bị từ chối bởi Quản trị viên', userId);

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'REJECT_USER', ?, ?)
    `).run(
      req.session.user.id,
      req.session.user.username,
      `Từ chối tài khoản sinh viên: ${user.username} (${user.full_name})`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã từ chối tài khoản ${user.username}!`
    });
  } catch (error) {
    console.error('Lỗi từ chối:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi từ chối tài khoản' });
  }
});

/**
 * Khóa / Mở khóa tài khoản sinh viên
 * POST /api/admin/users/:id/toggle-status
 */
router.post('/users/:id/toggle-status', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }

    const newStatus = user.status === 'blocked' ? 'approved' : 'blocked';
    db.prepare("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newStatus, userId);

    const actionText = newStatus === 'blocked' ? 'Khóa' : 'Mở khóa';

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'TOGGLE_USER_STATUS', ?, ?)
    `).run(
      req.session.user.id,
      req.session.user.username,
      `${actionText} tài khoản: ${user.username}`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã ${actionText.toLowerCase()} tài khoản ${user.username}!`,
      newStatus
    });
  } catch (error) {
    console.error('Lỗi đổi trạng thái:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi đổi trạng thái' });
  }
});

/**
 * Đặt lại mật khẩu sinh viên (Reset Password)
 * POST /api/admin/users/:id/reset-password
 */
router.post('/users/:id/reset-password', (req, res) => {
  try {
    const userId = req.params.id;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên' });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(hashed, userId);

    return res.json({
      success: true,
      message: `Đã đổi mật khẩu cho sinh viên ${user.username} thành công!`
    });
  } catch (error) {
    console.error('Lỗi reset mật khẩu:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi reset mật khẩu' });
  }
});

/**
 * Cập nhật Quota số lượng subdomain tối đa cho sinh viên
 * PUT /api/admin/users/:id/quota
 */
router.put('/users/:id/quota', (req, res) => {
  try {
    const userId = req.params.id;
    const { maxSubdomains } = req.body;

    const quotaNum = parseInt(maxSubdomains);
    if (isNaN(quotaNum) || quotaNum < 0) {
      return res.status(400).json({ success: false, message: 'Hạn mức subdomain phải là số nguyên không âm' });
    }

    db.prepare("UPDATE users SET max_subdomains = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(quotaNum, userId);

    return res.json({
      success: true,
      message: `Đã cập nhật hạn mức subdomain thành ${quotaNum}`
    });
  } catch (error) {
    console.error('Lỗi cập nhật quota:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi cập nhật quota' });
  }
});

/**
 * Xóa tài khoản sinh viên (và xóa luôn toàn bộ DNS records liên quan trên Cloudflare)
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sinh viên' });
    }

    // Lấy tất cả DNS records của user để xóa trên Cloudflare
    const records = db.prepare("SELECT * FROM dns_records WHERE user_id = ?").all(userId);
    const cfConfig = cloudflareService.getCloudflareConfig();

    if (cfConfig.apiToken && cfConfig.zoneId) {
      for (const rec of records) {
        if (rec.cf_record_id) {
          try {
            await cloudflareService.deleteDnsRecord(rec.cf_record_id);
          } catch (e) {
            console.warn(`Lỗi khi xóa record ${rec.full_domain} trên Cloudflare:`, e.message);
          }
        }
      }
    }

    // Xóa user khỏi DB (sẽ tự động cascade xóa dns_records trong DB)
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'DELETE_USER', ?, ?)
    `).run(
      req.session.user.id,
      req.session.user.username,
      `Xóa vĩnh viễn tài khoản sinh viên: ${user.username} (${user.full_name})`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã xóa thành công tài khoản sinh viên ${user.username}!`
    });
  } catch (error) {
    console.error('Lỗi xóa sinh viên:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi xóa người dùng' });
  }
});

/**
 * Lấy toàn bộ danh sách bản ghi DNS của tất cả sinh viên
 * GET /api/admin/records
 */
router.get('/records', (req, res) => {
  try {
    const { search, type } = req.query;

    let query = `
      SELECT r.id, r.user_id as userId, r.subdomain, r.full_domain as fullDomain,
             r.type, r.content, r.ttl, r.proxied, r.cf_record_id as cfRecordId,
             r.cf_status as cfStatus, r.description, r.created_at as createdAt,
             u.username, u.full_name as fullName, u.class_name as className
      FROM dns_records r
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'all') {
      query += ` AND r.type = ?`;
      params.push(type.toUpperCase());
    }

    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      query += ` AND (LOWER(r.full_domain) LIKE ? OR LOWER(r.content) LIKE ? OR LOWER(u.username) LIKE ? OR LOWER(u.full_name) LIKE ?)`;
      params.push(s, s, s, s);
    }

    query += ` ORDER BY r.created_at DESC`;

    const records = db.prepare(query).all(...params);

    return res.json({
      success: true,
      data: records
    });
  } catch (error) {
    console.error('Lỗi lấy tất cả bản ghi:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách DNS toàn trường' });
  }
});

/**
 * Admin xóa bản ghi DNS của bất kỳ sinh viên nào
 * DELETE /api/admin/records/:id
 */
router.delete('/records/:id', async (req, res) => {
  try {
    const recordId = req.params.id;
    const record = db.prepare("SELECT * FROM dns_records WHERE id = ?").get(recordId);

    if (!record) {
      return res.status(404).json({ success: false, message: 'Bản ghi không tồn tại' });
    }

    // Xóa trên Cloudflare
    const cfConfig = cloudflareService.getCloudflareConfig();
    if (cfConfig.apiToken && cfConfig.zoneId && record.cf_record_id) {
      try {
        await cloudflareService.deleteDnsRecord(record.cf_record_id);
      } catch (e) {
        console.warn('Lỗi xóa Cloudflare:', e.message);
      }
    }

    db.prepare("DELETE FROM dns_records WHERE id = ?").run(recordId);

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'ADMIN_DELETE_DNS', ?, ?)
    `).run(
      req.session.user.id,
      req.session.user.username,
      `Admin xóa subdomain: ${record.full_domain}`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã xóa subdomain ${record.full_domain} thành công!`
    });
  } catch (error) {
    console.error('Lỗi admin xóa DNS:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi xóa bản ghi' });
  }
});

/**
 * Lấy lịch sử Audit Logs
 * GET /api/admin/logs
 */
router.get('/logs', (req, res) => {
  try {
    const logs = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100").all();
    return res.json({ success: true, data: logs });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi khi tải nhật ký hoạt động' });
  }
});

module.exports = router;
