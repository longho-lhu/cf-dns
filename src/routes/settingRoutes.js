const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAdmin } = require('../middleware/authMiddleware');
const cloudflareService = require('../services/cloudflare');

router.use(requireAdmin);

/**
 * Lấy danh sách cấu hình hệ thống
 */
router.get('/', (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value, description FROM settings").all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }

    // Mask Token khi trả về để bảo mật hiển thị
    const maskedToken = settings.cf_api_token 
      ? (settings.cf_api_token.length > 8 
          ? `${settings.cf_api_token.slice(0, 4)}...${settings.cf_api_token.slice(-4)}` 
          : '********')
      : '';

    return res.json({
      success: true,
      data: {
        ...settings,
        cf_api_token_masked: maskedToken,
        has_token: Boolean(settings.cf_api_token)
      }
    });
  } catch (error) {
    console.error('Lỗi tải cấu hình:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi tải cấu hình hệ thống' });
  }
});

/**
 * Cập nhật cấu hình hệ thống
 * Body: { cf_api_token, cf_zone_id, cf_root_domain, default_max_subdomains, reserved_subdomains }
 */
router.post('/', async (req, res) => {
  try {
    const { 
      cf_api_token, 
      cf_zone_id, 
      cf_root_domain, 
      default_max_subdomains, 
      reserved_subdomains 
    } = req.body;

    const updateSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)");

    // Chỉ cập nhật token nếu người dùng nhập token mới (không rỗng hoặc không phải placeholder)
    if (cf_api_token !== undefined && cf_api_token.trim() !== '') {
      updateSetting.run('cf_api_token', cf_api_token.trim());
    }

    if (cf_zone_id !== undefined) {
      updateSetting.run('cf_zone_id', cf_zone_id.trim());
    }

    if (cf_root_domain !== undefined && cf_root_domain.trim() !== '') {
      updateSetting.run('cf_root_domain', cf_root_domain.trim().toLowerCase());
    }

    if (default_max_subdomains !== undefined) {
      const quota = parseInt(default_max_subdomains) || 5;
      updateSetting.run('default_max_subdomains', quota.toString());
    }

    if (reserved_subdomains !== undefined) {
      updateSetting.run('reserved_subdomains', reserved_subdomains.trim().toLowerCase());
    }

    // Ghi audit log
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, ip_address)
      VALUES (?, ?, 'UPDATE_SETTINGS', 'Cập nhật cấu hình hệ thống & Cloudflare', ?)
    `).run(
      req.session.user.id,
      req.session.user.username,
      clientIp
    );

    return res.json({
      success: true,
      message: 'Cập nhật cấu hình hệ thống thành công!'
    });
  } catch (error) {
    console.error('Lỗi cập nhật cấu hình:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi lưu cấu hình' });
  }
});

/**
 * Kiểm tra kết nối Cloudflare với thông tin nhập thử
 * POST /api/settings/test-cloudflare
 */
router.post('/test-cloudflare', async (req, res) => {
  try {
    const { apiToken, zoneId } = req.body;
    const result = await cloudflareService.testConnection(apiToken, zoneId);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Lấy danh sách Zones từ Cloudflare để Admin chọn nhanh Zone ID
 * POST /api/settings/cloudflare-zones
 */
router.post('/cloudflare-zones', async (req, res) => {
  try {
    const { apiToken } = req.body;
    const zones = await cloudflareService.listZones(apiToken);
    return res.json({ success: true, data: zones });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
