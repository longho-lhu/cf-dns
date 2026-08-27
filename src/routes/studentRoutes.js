const express = require('express');
const router = express.Router();
const dns = require('dns').promises;
const db = require('../config/database');
const { requireApprovedStudent } = require('../middleware/authMiddleware');
const cloudflareService = require('../services/cloudflare');
const { isValidSubdomain, isValidIPv4, isValidIPv6, isValidHostname } = require('../utils/validator');

// Tất cả các route bên dưới bắt buộc phải là Sinh viên đã được duyệt (hoặc Admin)
router.use(requireApprovedStudent);

/**
 * Lấy danh sách bản ghi DNS của sinh viên hiện tại
 */
router.get('/records', (req, res) => {
  try {
    const userId = req.session.user.id;
    const records = db.prepare(`
      SELECT id, subdomain, full_domain as fullDomain, type, content, ttl, 
             proxied, cf_record_id as cfRecordId, cf_status as cfStatus, 
             description, created_at as createdAt, updated_at as updatedAt
      FROM dns_records
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);

    // Lấy thông tin Quota & Root domain
    const user = db.prepare('SELECT max_subdomains as maxSubdomains FROM users WHERE id = ?').get(userId);
    const rootDomainSetting = db.prepare("SELECT value FROM settings WHERE key = 'cf_root_domain'").get();
    const rootDomain = rootDomainSetting ? rootDomainSetting.value : 'fit.pro.vn';

    return res.json({
      success: true,
      data: {
        records,
        quota: {
          used: records.length,
          max: user.maxSubdomains
        },
        rootDomain
      }
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách bản ghi DNS:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách bản ghi' });
  }
});

/**
 * Tạo bản ghi DNS mới (Tạo Subdomain & Trỏ IP)
 * Body: { subdomain, type, content, proxied, ttl, description }
 */
router.post('/records', async (req, res) => {
  try {
    const userId = req.session.user.id;
    let { subdomain, type = 'A', content, proxied = false, ttl = 1, description = '' } = req.body;

    // 1. Kiểm tra đầu vào
    if (!subdomain || !content) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập đầy đủ tên Subdomain và Địa chỉ IP / Đích trỏ đến'
      });
    }

    subdomain = subdomain.trim().toLowerCase();
    type = type.trim().toUpperCase();
    content = content.trim();

    // 2. Validate định dạng Subdomain
    if (!isValidSubdomain(subdomain)) {
      return res.status(400).json({
        success: false,
        message: 'Tên subdomain không hợp lệ (chỉ chứa chữ cái thường, số và dấu gạch ngang, từ 2-63 ký tự)'
      });
    }

    // 3. Kiểm tra danh sách từ cấm (Reserved words)
    const reservedSetting = db.prepare("SELECT value FROM settings WHERE key = 'reserved_subdomains'").get();
    const reservedList = reservedSetting ? reservedSetting.value.split(',').map(s => s.trim().toLowerCase()) : [];

    if (reservedList.includes(subdomain)) {
      return res.status(400).json({
        success: false,
        message: `Tên subdomain "${subdomain}" là tên hệ thống đặc biệt và không được phép sử dụng!`
      });
    }

    // 4. Kiểm tra Quota của sinh viên
    const user = db.prepare('SELECT max_subdomains as maxSubdomains, username FROM users WHERE id = ?').get(userId);
    const count = db.prepare('SELECT COUNT(*) as count FROM dns_records WHERE user_id = ?').get(userId).count;

    if (count >= user.maxSubdomains) {
      return res.status(400).json({
        success: false,
        message: `Bạn đã đạt giới hạn tối đa (${user.maxSubdomains} subdomain). Vui lòng liên hệ Admin nếu cần thêm dung lượng.`
      });
    }

    // 5. Lấy root domain
    const rootDomainSetting = db.prepare("SELECT value FROM settings WHERE key = 'cf_root_domain'").get();
    const rootDomain = rootDomainSetting ? rootDomainSetting.value : 'fit.pro.vn';
    const fullDomain = `${subdomain}.${rootDomain}`;

    // 6. Kiểm tra xem subdomain đã được ai tạo chưa trong DB
    const existing = db.prepare('SELECT id, user_id FROM dns_records WHERE full_domain = ?').get(fullDomain);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Tên miền "${fullDomain}" đã có người đăng ký sử dụng!`
      });
    }

    // 7. Validate Content theo Type
    if (type === 'A') {
      if (!isValidIPv4(content)) {
        return res.status(400).json({ success: false, message: 'Địa chỉ IPv4 không đúng định dạng (VD: 103.1.2.3)' });
      }
    } else if (type === 'AAAA') {
      if (!isValidIPv6(content)) {
        return res.status(400).json({ success: false, message: 'Địa chỉ IPv6 không đúng định dạng' });
      }
    } else if (type === 'CNAME') {
      if (!isValidHostname(content)) {
        return res.status(400).json({ success: false, message: 'Hostname CNAME không đúng định dạng (VD: myapp.herokuapp.com)' });
      }
    } else if (type === 'TXT') {
      if (content.length > 255) {
        return res.status(400).json({ success: false, message: 'Nội dung bản ghi TXT không được vượt quá 255 ký tự' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'Loại bản ghi không được hỗ trợ (chỉ hỗ trợ A, AAAA, CNAME, TXT)' });
    }

    // 8. Gọi Cloudflare API để tạo bản ghi
    let cfRecordId = '';
    let cfStatus = 'synced';
    const cfConfig = cloudflareService.getCloudflareConfig();

    if (cfConfig.apiToken && cfConfig.zoneId) {
      try {
        const cfResult = await cloudflareService.createDnsRecord({
          type,
          name: fullDomain,
          content,
          ttl: proxied ? 1 : (Number(ttl) || 1),
          proxied: Boolean(proxied),
          comment: `User: ${user.username} (${userId})`
        });
        cfRecordId = cfResult.id;
      } catch (cfErr) {
        console.error('Cloudflare Create Error:', cfErr.message);
        return res.status(400).json({
          success: false,
          message: `Không thể tạo bản ghi trên Cloudflare: ${cfErr.message}`
        });
      }
    } else {
      cfStatus = 'pending_config'; // Chưa cấu hình Cloudflare
    }

    // 9. Lưu vào cơ sở dữ liệu
    const insertResult = db.prepare(`
      INSERT INTO dns_records (user_id, subdomain, full_domain, type, content, ttl, proxied, cf_record_id, cf_status, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      subdomain,
      fullDomain,
      type,
      content,
      Number(ttl) || 1,
      proxied ? 1 : 0,
      cfRecordId,
      cfStatus,
      description
    );

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'CREATE_DNS', ?, ?)
    `).run(
      userId,
      user.username,
      `Tạo subdomain ${fullDomain} -> ${content} (${type}, Proxied: ${proxied})`,
      clientIp
    );

    return res.status(201).json({
      success: true,
      message: `Đã tạo thành công tên miền ${fullDomain}!`,
      data: {
        id: insertResult.lastInsertRowid,
        subdomain,
        fullDomain,
        type,
        content,
        ttl: Number(ttl) || 1,
        proxied: Boolean(proxied),
        cfStatus
      }
    });
  } catch (error) {
    console.error('Lỗi tạo bản ghi DNS:', error);
    return res.status(500).json({ success: false, message: error.message || 'Lỗi xử lý tạo bản ghi DNS' });
  }
});

/**
 * Cập nhật bản ghi DNS (Đổi IP trỏ tới, Bật/Tắt Proxy Cloudflare)
 * PUT /api/student/records/:id
 */
router.put('/records/:id', async (req, res) => {
  try {
    const recordId = req.params.id;
    const userId = req.session.user.id;
    let { content, proxied, ttl = 1, description } = req.body;

    // 1. Kiểm tra bản ghi có thuộc về user không
    const record = db.prepare('SELECT * FROM dns_records WHERE id = ? AND user_id = ?').get(recordId, userId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Bản ghi không tồn tại hoặc bạn không có quyền sửa' });
    }

    if (!content) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập địa chỉ đích mới' });
    }

    content = content.trim();

    // 2. Validate content theo Type
    if (record.type === 'A') {
      if (!isValidIPv4(content)) return res.status(400).json({ success: false, message: 'Địa chỉ IPv4 không hợp lệ' });
    } else if (record.type === 'AAAA') {
      if (!isValidIPv6(content)) return res.status(400).json({ success: false, message: 'Địa chỉ IPv6 không hợp lệ' });
    } else if (record.type === 'CNAME') {
      if (!isValidHostname(content)) return res.status(400).json({ success: false, message: 'Hostname CNAME không hợp lệ' });
    }

    const isProxied = proxied !== undefined ? Boolean(proxied) : Boolean(record.proxied);

    // 3. Cập nhật trên Cloudflare nếu có cf_record_id
    const cfConfig = cloudflareService.getCloudflareConfig();
    if (cfConfig.apiToken && cfConfig.zoneId && record.cf_record_id) {
      try {
        await cloudflareService.updateDnsRecord(record.cf_record_id, {
          type: record.type,
          name: record.full_domain,
          content,
          ttl: isProxied ? 1 : (Number(ttl) || record.ttl),
          proxied: isProxied,
          comment: `Updated by user ID: ${userId}`
        });
      } catch (cfErr) {
        console.error('Cloudflare Update Error:', cfErr.message);
        return res.status(400).json({
          success: false,
          message: `Không thể cập nhật trên Cloudflare: ${cfErr.message}`
        });
      }
    }

    // 4. Cập nhật Database
    db.prepare(`
      UPDATE dns_records 
      SET content = ?, proxied = ?, ttl = ?, description = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      content,
      isProxied ? 1 : 0,
      isProxied ? 1 : (Number(ttl) || record.ttl),
      description !== undefined ? description : record.description,
      recordId
    );

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'UPDATE_DNS', ?, ?)
    `).run(
      userId,
      req.session.user.username,
      `Cập nhật subdomain ${record.full_domain} -> ${content} (Proxied: ${isProxied})`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã cập nhật thành công bản ghi ${record.full_domain}!`
    });
  } catch (error) {
    console.error('Lỗi cập nhật DNS:', error);
    return res.status(500).json({ success: false, message: error.message || 'Lỗi cập nhật bản ghi DNS' });
  }
});

/**
 * Xóa bản ghi DNS
 * DELETE /api/student/records/:id
 */
router.delete('/records/:id', async (req, res) => {
  try {
    const recordId = req.params.id;
    const userId = req.session.user.id;

    // 1. Kiểm tra bản ghi thuộc về user
    const record = db.prepare('SELECT * FROM dns_records WHERE id = ? AND user_id = ?').get(recordId, userId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Bản ghi không tồn tại hoặc bạn không có quyền xóa' });
    }

    // 2. Xóa trên Cloudflare nếu có cf_record_id
    const cfConfig = cloudflareService.getCloudflareConfig();
    if (cfConfig.apiToken && cfConfig.zoneId && record.cf_record_id) {
      try {
        await cloudflareService.deleteDnsRecord(record.cf_record_id);
      } catch (cfErr) {
        console.warn('Lỗi khi xóa trên Cloudflare (tiếp tục xóa DB):', cfErr.message);
      }
    }

    // 3. Xóa trong DB
    db.prepare('DELETE FROM dns_records WHERE id = ?').run(recordId);

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'DELETE_DNS', ?, ?)
    `).run(
      userId,
      req.session.user.username,
      `Xóa subdomain ${record.full_domain}`,
      clientIp
    );

    return res.json({
      success: true,
      message: `Đã xóa thành công subdomain ${record.full_domain}!`
    });
  } catch (error) {
    console.error('Lỗi xóa DNS:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi xóa bản ghi DNS' });
  }
});

/**
 * Kiểm tra phân giải DNS thực tế của Subdomain (Check DNS Lookup)
 * GET /api/student/check-dns?domain=xxx.fit.pro.vn
 */
router.get('/check-dns', async (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp tên miền cần kiểm tra' });
    }

    const cleanDomain = domain.trim();

    try {
      const addresses = await dns.resolve4(cleanDomain);
      return res.json({
        success: true,
        domain: cleanDomain,
        resolved: true,
        ips: addresses,
        message: `Tên miền đã được phân giải thành công tới: ${addresses.join(', ')}`
      });
    } catch (dnsErr) {
      return res.json({
        success: true,
        domain: cleanDomain,
        resolved: false,
        ips: [],
        message: `Chưa thể phân giải DNS hoặc DNS chưa lan truyền tới máy chủ: ${dnsErr.code || dnsErr.message}`
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi kiểm tra DNS' });
  }
});

module.exports = router;
