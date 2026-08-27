const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { requireAuth } = require('../middleware/authMiddleware');
const { isValidMSSV } = require('../utils/validator');

/**
 * Đăng ký tài khoản Sinh viên mới
 * Body: { username (MSSV), fullName, className, password, confirmPassword }
 */
router.post('/register', (req, res) => {
  try {
    const { username, fullName, className, password, confirmPassword } = req.body;

    // 1. Kiểm tra trường bắt buộc
    if (!username || !fullName || !className || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng điền đầy đủ thông tin: Mã số sinh viên, Họ tên, Lớp và Mật khẩu'
      });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanFullName = fullName.trim();
    const cleanClassName = className.trim().toUpperCase();

    // 2. Validate định dạng MSSV
    if (!isValidMSSV(cleanUsername)) {
      return res.status(400).json({
        success: false,
        message: 'Mã số sinh viên không hợp lệ (từ 3-30 ký tự chữ và số, không khoảng trắng)'
      });
    }

    // 3. Validate mật khẩu
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu phải có độ dài tối thiểu từ 6 ký tự trở lên'
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu xác nhận không khớp'
      });
    }

    // 4. Kiểm tra tài khoản đã tồn tại chưa
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Mã số sinh viên "${cleanUsername}" đã được đăng ký trên hệ thống!`
      });
    }

    // 5. Lấy quota mặc định từ settings
    const quotaSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_max_subdomains'").get();
    const maxSubdomains = quotaSetting ? parseInt(quotaSetting.value) || 5 : 5;

    // 6. Mã hóa mật khẩu và tạo user với trạng thái pending
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (username, password, full_name, class_name, role, status, max_subdomains)
      VALUES (?, ?, ?, ?, 'student', 'pending', ?)
    `).run(cleanUsername, hashedPassword, cleanFullName, cleanClassName, maxSubdomains);

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'REGISTER', 'Đăng ký tài khoản sinh viên mới', ?)
    `).run(result.lastInsertRowid, cleanUsername, clientIp);

    return res.status(201).json({
      success: true,
      message: 'Đăng ký thành công! Tài khoản của bạn đang ở trạng thái CHỜ DUYỆT. Vui lòng đợi Quản trị viên phê duyệt trước khi tạo tên miền.',
      user: {
        id: result.lastInsertRowid,
        username: cleanUsername,
        fullName: cleanFullName,
        className: cleanClassName,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Lỗi đăng ký:', error);
    return res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi trong quá trình xử lý đăng ký'
    });
  }
});

/**
 * Đăng nhập hệ thống
 * Body: { username, password }
 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập tên đăng nhập (MSSV) và mật khẩu'
      });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Tên đăng nhập hoặc mật khẩu không chính xác'
      });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Tên đăng nhập hoặc mật khẩu không chính xác'
      });
    }

    // Lưu session
    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      className: user.class_name,
      role: user.role,
      status: user.status
    };

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'LOGIN', 'Đăng nhập hệ thống', ?)
    `).run(user.id, user.username, clientIp);

    // Lưu session đồng bộ trước khi trả kết quả
    req.session.save((err) => {
      if (err) {
        console.error('Lỗi lưu session:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khởi tạo phiên đăng nhập' });
      }

      return res.json({
        success: true,
        message: user.status === 'approved' || user.role === 'admin' 
          ? 'Đăng nhập thành công!' 
          : 'Đăng nhập thành công, nhưng tài khoản của bạn chưa được duyệt hoạt động!',
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          className: user.class_name,
          role: user.role,
          status: user.status
        }
      });
    });
  } catch (error) {
    console.error('Lỗi đăng nhập:', error);
    return res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi trong quá trình đăng nhập'
    });
  }
});

/**
 * Đăng xuất
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Lỗi khi đăng xuất' });
    }
    res.clearCookie('fit_dns_session');
    return res.json({ success: true, message: 'Đã đăng xuất thành công' });
  });
});

/**
 * Lấy thông tin user hiện tại (Profile & Quota info)
 */
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, username, full_name as fullName, class_name as className, 
             role, status, max_subdomains as maxSubdomains, note, created_at as createdAt
      FROM users WHERE id = ?
    `).get(req.session.user.id);

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    // Đếm số subdomain hiện tại
    const recordCount = db.prepare('SELECT COUNT(*) as count FROM dns_records WHERE user_id = ?').get(user.id).count;

    // Lấy domain chính
    const rootDomainSetting = db.prepare("SELECT value FROM settings WHERE key = 'cf_root_domain'").get();
    const rootDomain = rootDomainSetting ? rootDomainSetting.value : 'fit.pro.vn';

    // Cập nhật lại session
    req.session.user.status = user.status;
    req.session.user.fullName = user.fullName;
    req.session.user.className = user.className;

    return res.json({
      success: true,
      user: {
        ...user,
        usedSubdomains: recordCount,
        rootDomain
      }
    });
  } catch (error) {
    console.error('Lỗi lấy thông tin cá nhân:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
});

/**
 * Đổi mật khẩu
 */
router.post('/change-password', requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }

    if (confirmNewPassword && newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới không trùng khớp' });
    }

    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác' });
    }

    const newHashed = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newHashed, req.session.user.id);

    return res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
  } catch (error) {
    console.error('Lỗi đổi mật khẩu:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi đổi mật khẩu' });
  }
});

module.exports = router;
