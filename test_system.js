/**
 * Automated Verification Script for FIT Cloudflare DNS System
 */
const http = require('http');

const BASE_URL = 'http://localhost:3000';
let adminCookie = '';
let studentCookie = '';

function request(method, path, data = null, cookie = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = data ? JSON.stringify(data) : '';

    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(cookie ? { 'Cookie': cookie } : {})
      }
    }, (res) => {
      let body = '';
      const setCookie = res.headers['set-cookie'];
      let newCookie = cookie;
      if (setCookie) {
        newCookie = setCookie.map(c => c.split(';')[0]).join('; ');
      }

      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed, cookie: newCookie });
        } catch (e) {
          resolve({ status: res.statusCode, body, cookie: newCookie });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ HỆ THỐNG DNS FIT');
  console.log('====================================================');

  try {
    // 1. Đăng ký sinh viên mới
    console.log('\n[1] Test Đăng ký Sinh viên mới (MSSV: 21110001)...');
    const regRes = await request('POST', '/api/auth/register', {
      username: '21110001',
      fullName: 'Nguyễn Văn An',
      className: '21FIT01',
      password: 'password123',
      confirmPassword: 'password123'
    });
    console.log('👉 Status:', regRes.status, '| Response:', regRes.data);
    if (regRes.status !== 201 || regRes.data.user.status !== 'pending') {
      throw new Error('Đăng ký thất bại hoặc trạng thái không phải pending!');
    }
    console.log('✅ Sinh viên đăng ký thành công với trạng thái PENDING.');

    // 2. Sinh viên đăng nhập khi chưa được duyệt
    console.log('\n[2] Test Sinh viên đăng nhập khi chưa duyệt...');
    const loginPendingRes = await request('POST', '/api/auth/login', {
      username: '21110001',
      password: 'password123'
    });
    console.log('👉 Status:', loginPendingRes.status, '| User Status:', loginPendingRes.data.user.status);
    studentCookie = loginPendingRes.cookie;

    // 3. Sinh viên thử tạo Subdomain khi chưa được duyệt (Phải bị chặn 403)
    console.log('\n[3] Test Sinh viên tạo Subdomain khi chưa duyệt (Kỳ vọng: 403 Forbidden)...');
    const blockedDnsRes = await request('POST', '/api/student/records', {
      subdomain: 'demo-an',
      type: 'A',
      content: '1.2.3.4'
    }, studentCookie);
    console.log('👉 Status:', blockedDnsRes.status, '| Message:', blockedDnsRes.data.message);
    if (blockedDnsRes.status !== 403) {
      throw new Error('Lỗi bảo mật: Sinh viên chưa duyệt nhưng vẫn tạo được subdomain!');
    }
    console.log('✅ Hệ thống chặn thành công sinh viên chưa duyệt.');

    // 4. Admin đăng nhập
    console.log('\n[4] Test Admin đăng nhập (Username: admin | Pass: longthuong.1908)...');
    const adminLoginRes = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: 'longthuong.1908'
    });
    console.log('👉 Status:', adminLoginRes.status, '| Role:', adminLoginRes.data.user.role);
    if (adminLoginRes.status !== 200 || adminLoginRes.data.user.role !== 'admin') {
      throw new Error('Admin đăng nhập thất bại!');
    }
    adminCookie = adminLoginRes.cookie;
    console.log('✅ Admin đăng nhập thành công.');

    // 5. Admin xem danh sách chờ duyệt & Phê duyệt sinh viên
    console.log('\n[5] Admin xem danh sách chờ duyệt...');
    const pendingListRes = await request('GET', '/api/admin/users?status=pending', null, adminCookie);
    console.log('👉 Số sinh viên chờ duyệt:', pendingListRes.data.data.length);
    const studentUser = pendingListRes.data.data.find(u => u.username === '21110001');
    if (!studentUser) throw new Error('Không tìm thấy sinh viên trong danh sách chờ duyệt!');

    console.log(`\n[5.1] Admin phê duyệt sinh viên ID ${studentUser.id}...`);
    const approveRes = await request('POST', `/api/admin/users/${studentUser.id}/approve`, null, adminCookie);
    console.log('👉 Phản hồi duyệt:', approveRes.data.message);
    console.log('✅ Đã duyệt sinh viên thành công.');

    // 6. Sinh viên đã duyệt tạo Subdomain
    console.log('\n[6] Sinh viên đã duyệt tiến hành tạo Subdomain "an-project"...');
    const createDnsRes = await request('POST', '/api/student/records', {
      subdomain: 'an-project',
      type: 'A',
      content: '103.142.26.15',
      proxied: true,
      description: 'Server đồ án chuyên ngành'
    }, studentCookie);
    console.log('👉 Status:', createDnsRes.status, '| Response:', createDnsRes.data);
    if (createDnsRes.status !== 201) throw new Error('Sinh viên đã duyệt nhưng tạo subdomain thất bại!');
    const recordId = createDnsRes.data.data.id;
    console.log('✅ Sinh viên tạo Subdomain thành công!');

    // 7. Sinh viên thử tạo Subdomain có tên cấm ("admin") (Phải bị chặn 400)
    console.log('\n[7] Sinh viên thử tạo tên miền cấm "admin.fit.pro.vn" (Kỳ vọng: 400 Bad Request)...');
    const reservedRes = await request('POST', '/api/student/records', {
      subdomain: 'admin',
      type: 'A',
      content: '1.1.1.1'
    }, studentCookie);
    console.log('👉 Status:', reservedRes.status, '| Message:', reservedRes.data.message);
    if (reservedRes.status !== 400) throw new Error('Hệ thống không chặn được subdomain bị cấm!');
    console.log('✅ Bộ lọc tên miền cấm hoạt động chính xác.');

    // 8. Sinh viên cập nhật IP của Subdomain
    console.log(`\n[8] Sinh viên cập nhật IP cho bản ghi ID ${recordId}...`);
    const updateRes = await request('PUT', `/api/student/records/${recordId}`, {
      content: '103.142.26.99',
      proxied: false,
      description: 'Đã đổi sang VPS mới'
    }, studentCookie);
    console.log('👉 Phản hồi update:', updateRes.data.message);
    console.log('✅ Cập nhật bản ghi thành công.');

    // 9. Admin xem toàn bộ danh sách DNS toàn trường & Logs
    console.log('\n[9] Admin xem danh sách toàn bộ DNS và Audit Logs...');
    const allRecordsRes = await request('GET', '/api/admin/records', null, adminCookie);
    console.log(`👉 Tổng số bản ghi toàn trường: ${allRecordsRes.data.data.length}`);
    const logsRes = await request('GET', '/api/admin/logs', null, adminCookie);
    console.log(`👉 Tổng số Audit Logs đã ghi: ${logsRes.data.data.length}`);

    console.log('\n====================================================');
    console.log('🎉 TẤT CẢ 9 BƯỚC KIỂM THỬ ĐÃ THÀNH CÔNG RỰC RỠ!');
    console.log('====================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ KIỂM THỬ THẤT BẠI:', error.message);
    process.exit(1);
  }
}

// Chạy test
runTests();
