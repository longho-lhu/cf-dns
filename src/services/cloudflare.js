const axios = require('axios');
const db = require('../config/database');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Lấy cấu hình Cloudflare mới nhất từ Database hoặc Env
 */
function getCloudflareConfig() {
  const tokenSetting = db.prepare("SELECT value FROM settings WHERE key = 'cf_api_token'").get();
  const zoneSetting = db.prepare("SELECT value FROM settings WHERE key = 'cf_zone_id'").get();
  const rootSetting = db.prepare("SELECT value FROM settings WHERE key = 'cf_root_domain'").get();

  return {
    apiToken: (tokenSetting ? tokenSetting.value : '') || process.env.CLOUDFLARE_API_TOKEN || '',
    zoneId: (zoneSetting ? zoneSetting.value : '') || process.env.CLOUDFLARE_ZONE_ID || '',
    rootDomain: (rootSetting ? rootSetting.value : '') || process.env.CLOUDFLARE_ROOT_DOMAIN || 'fit.pro.vn'
  };
}

/**
 * Tạo instance axios với Token Cloudflare
 */
function getAxiosClient(token) {
  const apiToken = token || getCloudflareConfig().apiToken;
  return axios.create({
    baseURL: CF_API_BASE,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });
}

/**
 * Kiểm tra kết nối Cloudflare API và Zone ID
 */
async function testConnection(customToken, customZoneId) {
  const config = getCloudflareConfig();
  const token = customToken !== undefined ? customToken : config.apiToken;
  const zoneId = customZoneId !== undefined ? customZoneId : config.zoneId;

  if (!token) {
    return { success: false, message: 'Chưa cấu hình Cloudflare API Token' };
  }

  try {
    const client = getAxiosClient(token);
    // 1. Kiểm tra Token
    const verifyRes = await client.get('/user/tokens/verify');
    if (!verifyRes.data || !verifyRes.data.success) {
      return { success: false, message: 'API Token không hợp lệ hoặc đã hết hạn' };
    }

    // 2. Nếu có zoneId, kiểm tra Zone
    if (zoneId) {
      const zoneRes = await client.get(`/zones/${zoneId}`);
      if (zoneRes.data && zoneRes.data.success) {
        return {
          success: true,
          message: 'Kết nối Cloudflare thành công!',
          zoneName: zoneRes.data.result.name,
          zoneStatus: zoneRes.data.result.status
        };
      } else {
        return { success: false, message: 'Không tìm thấy Zone ID hoặc không có quyền truy cập' };
      }
    }

    return {
      success: true,
      message: 'API Token hợp lệ (Chưa cung cấp hoặc kiểm tra Zone ID)'
    };
  } catch (error) {
    const errDetail = error.response?.data?.errors?.[0]?.message || error.message;
    return { success: false, message: `Lỗi kết nối Cloudflare: ${errDetail}` };
  }
}

/**
 * Lấy danh sách Zones từ Cloudflare (hỗ trợ Admin chọn nhanh)
 */
async function listZones(customToken) {
  const token = customToken || getCloudflareConfig().apiToken;
  if (!token) return [];

  try {
    const client = getAxiosClient(token);
    const res = await client.get('/zones?per_page=50');
    if (res.data && res.data.success) {
      return res.data.result.map(z => ({
        id: z.id,
        name: z.name,
        status: z.status
      }));
    }
    return [];
  } catch (error) {
    console.error('Lỗi khi lấy danh sách zones:', error.message);
    return [];
  }
}

/**
 * Tạo bản ghi DNS trên Cloudflare
 */
async function createDnsRecord({ type, name, content, ttl = 1, proxied = false, comment = '' }) {
  const { apiToken, zoneId, rootDomain } = getCloudflareConfig();

  if (!apiToken || !zoneId) {
    throw new Error('Hệ thống chưa được cấu hình Cloudflare API Token hoặc Zone ID!');
  }

  const client = getAxiosClient(apiToken);
  
  // Tên đầy đủ trên Cloudflare (ví dụ: myapp.fit.pro.vn hoặc myapp)
  const fullRecordName = name.includes(rootDomain) ? name : `${name}.${rootDomain}`;

  // TXT hoặc bản ghi không hỗ trợ proxy -> tắt proxied
  const canProxy = ['A', 'AAAA', 'CNAME'].includes(type.toUpperCase());
  const actualProxied = canProxy ? Boolean(proxied) : false;

  const payload = {
    type: type.toUpperCase(),
    name: fullRecordName,
    content: content.trim(),
    ttl: actualProxied ? 1 : (Number(ttl) || 1), // Nếu proxied = true thì TTL bắt buộc là 1 (Auto)
    proxied: actualProxied,
    comment: comment || 'Created by FIT DNS Management'
  };

  try {
    const res = await client.post(`/zones/${zoneId}/dns_records`, payload);
    if (res.data && res.data.success) {
      return res.data.result; // Trả về object bản ghi gồm id, name, type, content, proxied,...
    }
    throw new Error(res.data?.errors?.[0]?.message || 'Không thể tạo bản ghi trên Cloudflare');
  } catch (error) {
    const errMsg = error.response?.data?.errors?.[0]?.message || error.message;
    throw new Error(`Cloudflare Error: ${errMsg}`);
  }
}

/**
 * Cập nhật bản ghi DNS trên Cloudflare
 */
async function updateDnsRecord(recordId, { type, name, content, ttl = 1, proxied = false, comment = '' }) {
  const { apiToken, zoneId, rootDomain } = getCloudflareConfig();

  if (!apiToken || !zoneId) {
    throw new Error('Hệ thống chưa được cấu hình Cloudflare API Token hoặc Zone ID!');
  }

  const client = getAxiosClient(apiToken);
  const fullRecordName = name.includes(rootDomain) ? name : `${name}.${rootDomain}`;
  const canProxy = ['A', 'AAAA', 'CNAME'].includes(type.toUpperCase());
  const actualProxied = canProxy ? Boolean(proxied) : false;

  const payload = {
    type: type.toUpperCase(),
    name: fullRecordName,
    content: content.trim(),
    ttl: actualProxied ? 1 : (Number(ttl) || 1),
    proxied: actualProxied,
    comment: comment || 'Updated by FIT DNS Management'
  };

  try {
    const res = await client.put(`/zones/${zoneId}/dns_records/${recordId}`, payload);
    if (res.data && res.data.success) {
      return res.data.result;
    }
    throw new Error(res.data?.errors?.[0]?.message || 'Không thể cập nhật bản ghi trên Cloudflare');
  } catch (error) {
    const errMsg = error.response?.data?.errors?.[0]?.message || error.message;
    throw new Error(`Cloudflare Error: ${errMsg}`);
  }
}

/**
 * Xóa bản ghi DNS trên Cloudflare
 */
async function deleteDnsRecord(recordId) {
  const { apiToken, zoneId } = getCloudflareConfig();

  if (!apiToken || !zoneId) {
    throw new Error('Hệ thống chưa được cấu hình Cloudflare API Token hoặc Zone ID!');
  }

  const client = getAxiosClient(apiToken);

  try {
    const res = await client.delete(`/zones/${zoneId}/dns_records/${recordId}`);
    if (res.data && res.data.success) {
      return true;
    }
    throw new Error(res.data?.errors?.[0]?.message || 'Không thể xóa bản ghi trên Cloudflare');
  } catch (error) {
    const errMsg = error.response?.data?.errors?.[0]?.message || error.message;
    // Nếu record không tồn tại trên Cloudflare (404), coi như đã xóa
    if (error.response?.status === 404) {
      return true;
    }
    throw new Error(`Cloudflare Error: ${errMsg}`);
  }
}

module.exports = {
  getCloudflareConfig,
  testConnection,
  listZones,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord
};
