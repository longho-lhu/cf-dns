/**
 * Student Dashboard Logic
 */

let currentUser = null;
let currentRootDomain = 'fit.pro.vn';

// Tải thông tin người dùng hiện tại
async function loadUserProfile() {
  try {
    const res = await apiRequest('/api/auth/me');
    if (!res.success || !res.user) {
      window.location.href = '/login';
      return;
    }

    currentUser = res.user;

    // Nếu là Admin, chuyển sang trang Admin
    if (currentUser.role === 'admin') {
      window.location.href = '/admin';
      return;
    }

    // Hiển thị thông tin sinh viên
    document.getElementById('userFullName').textContent = currentUser.fullName;
    document.getElementById('userMeta').textContent = `MSSV: ${currentUser.username} | Lớp: ${currentUser.className || 'Chưa cập nhật'}`;
    document.getElementById('userAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();

    // Hiển thị Root domain
    if (currentUser.rootDomain) {
      currentRootDomain = currentUser.rootDomain;
      document.getElementById('statRootDomain').textContent = currentRootDomain;
      document.getElementById('addonRootDomain').textContent = `.${currentRootDomain}`;
      updateSubdomainPreview();
    }

    // Xử lý trạng thái tài khoản
    handleAccountStatus(currentUser.status);

    // Tải danh sách bản ghi nếu đã được duyệt
    if (currentUser.status === 'approved') {
      loadDnsRecords();
    }
  } catch (err) {
    console.error('Lỗi phiên đăng nhập:', err);
    window.location.href = '/login';
  }
}

// Xử lý trạng thái tài khoản
function handleAccountStatus(status) {
  const alertContainer = document.getElementById('accountStatusAlert');
  const btnCreate = document.getElementById('btnCreateSubdomain');
  const badgeContainer = document.getElementById('statStatusBadge');

  if (status === 'approved') {
    badgeContainer.innerHTML = `<span class="badge badge-approved">Đã Phê Duyệt ✅</span>`;
    alertContainer.style.display = 'none';
    if (btnCreate) btnCreate.disabled = false;
  } else if (status === 'pending') {
    badgeContainer.innerHTML = `<span class="badge badge-pending">Chờ Duyệt ⏳</span>`;
    alertContainer.className = 'alert alert-warning';
    alertContainer.innerHTML = `
      <div style="font-size: 1.4rem;">⏳</div>
      <div>
        <strong>Tài khoản đang chờ Ban Quản Trị / Giảng viên phê duyệt!</strong><br>
        Bạn đã đăng ký thành công. Tuy nhiên, tính năng tạo Subdomain và trỏ IP sẽ được mở ngay sau khi Admin duyệt tài khoản của bạn.
      </div>
    `;
    alertContainer.style.display = 'flex';
    if (btnCreate) {
      btnCreate.disabled = true;
      btnCreate.title = 'Tài khoản chưa được duyệt';
      btnCreate.style.opacity = '0.5';
    }

    // Hiển thị thông báo trong bảng
    document.getElementById('studentRecordsBody').innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
          ⏳ Tài khoản của bạn đang chờ phê duyệt từ Admin. Danh sách Subdomain sẽ hiển thị sau khi được kích hoạt.
        </td>
      </tr>
    `;
  } else if (status === 'rejected') {
    badgeContainer.innerHTML = `<span class="badge badge-rejected">Bị Từ Chối ❌</span>`;
    alertContainer.className = 'alert alert-danger';
    alertContainer.innerHTML = `
      <div style="font-size: 1.4rem;">❌</div>
      <div>
        <strong>Yêu cầu đăng ký tài khoản của bạn đã bị từ chối!</strong><br>
        Lý do / Ghi chú: ${currentUser.note || 'Vui lòng liên hệ Quản trị viên để biết thêm chi tiết.'}
      </div>
    `;
    alertContainer.style.display = 'flex';
    if (btnCreate) btnCreate.disabled = true;
  } else if (status === 'blocked') {
    badgeContainer.innerHTML = `<span class="badge badge-blocked">Tạm Khóa 🚫</span>`;
    alertContainer.className = 'alert alert-danger';
    alertContainer.innerHTML = `
      <div style="font-size: 1.4rem;">🚫</div>
      <div>
        <strong>Tài khoản của bạn đang bị tạm khóa!</strong><br>
        Vui lòng liên hệ Quản trị viên bộ môn CNTT để mở lại tài khoản.
      </div>
    `;
    alertContainer.style.display = 'flex';
    if (btnCreate) btnCreate.disabled = true;
  }
}

// Tải danh sách bản ghi DNS
async function loadDnsRecords() {
  try {
    const res = await apiRequest('/api/student/records');
    if (!res.success) throw new Error(res.message);

    const { records, quota, rootDomain } = res.data;

    if (rootDomain) {
      currentRootDomain = rootDomain;
      document.getElementById('statRootDomain').textContent = currentRootDomain;
      document.getElementById('addonRootDomain').textContent = `.${currentRootDomain}`;
    }

    // Cập nhật Quota
    document.getElementById('statUsed').textContent = quota.used;
    document.getElementById('statMax').textContent = quota.max;
    document.getElementById('recordCountBadge').textContent = `${records.length} bản ghi`;

    const percentage = Math.min(Math.round((quota.used / quota.max) * 100), 100);
    const pBar = document.getElementById('quotaProgressBar');
    pBar.style.width = `${percentage}%`;
    if (percentage >= 100) {
      pBar.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    } else if (percentage >= 80) {
      pBar.style.background = 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)';
    } else {
      pBar.style.background = 'var(--accent-gradient)';
    }

    renderRecordsTable(records);
  } catch (err) {
    console.error('Lỗi tải danh sách DNS:', err);
    document.getElementById('studentRecordsBody').innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #f87171; padding: 30px;">
          ❌ Không thể tải danh sách bản ghi: ${err.message}
        </td>
      </tr>
    `;
  }
}

// Hiển thị dữ liệu vào bảng
function renderRecordsTable(records) {
  const tbody = document.getElementById('studentRecordsBody');

  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">🌐</div>
            <h4 style="margin-bottom: 6px;">Bạn chưa có Subdomain nào</h4>
            <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 16px;">
              Bấm nút "Tạo Subdomain Mới" để cấp phát tên miền cho Server/VPS của bạn.
            </p>
            <button class="btn btn-primary btn-sm" onclick="openCreateModal()">➕ Tạo Tên Miền Đầu Tiên</button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map(rec => {
    const isProxied = Boolean(rec.proxied);
    const proxyBadge = isProxied
      ? `<span class="badge badge-cf-proxied" title="Lưu lượng đi qua CDN Cloudflare, tự bật SSL và ẩn IP gốc">☁️ Proxied (Bảo vệ)</span>`
      : `<span class="badge badge-cf-dns" title="Bản ghi DNS trỏ trực tiếp không qua proxy">☁️ DNS Only (Trỏ trực tiếp)</span>`;

    const encodedRecord = encodeURIComponent(JSON.stringify(rec));

    return `
      <tr>
        <td>
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">
            <a href="http://${rec.fullDomain}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline dotted;" title="Mở trong tab mới">
              ${rec.fullDomain}
            </a>
            <button class="btn btn-secondary btn-icon" style="width: 24px; height: 24px; margin-left: 6px; font-size: 0.75rem;" onclick="copyToClipboard('${rec.fullDomain}', 'tên miền')" title="Sao chép tên miền">📋</button>
          </div>
          ${rec.description ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">💬 ${rec.description}</div>` : ''}
        </td>
        <td>
          <span class="badge badge-type">${rec.type}</span>
        </td>
        <td>
          <span class="copy-badge" onclick="copyToClipboard('${rec.content}', 'địa chỉ đích')" title="Click để sao chép">
            ${rec.content} 📋
          </span>
        </td>
        <td>${proxyBadge}</td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${formatDate(rec.createdAt)}</td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm" onclick="checkDnsLookup('${rec.fullDomain}')" title="Kiểm tra phân giải DNS">
              🔍 Test
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openEditModal('${encodedRecord}')" title="Chỉnh sửa IP / Proxy">
              ✏️ Sửa
            </button>
            <button class="btn btn-danger btn-sm" onclick="handleDeleteRecord(${rec.id}, '${rec.fullDomain}')" title="Xóa Subdomain">
              🗑️ Xóa
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Live preview subdomain khi gõ
function updateSubdomainPreview() {
  const input = document.getElementById('subdomainInput');
  const preview = document.getElementById('previewFullDomain');
  if (!input || !preview) return;

  const val = input.value.trim().toLowerCase();
  preview.textContent = val ? `${val}.${currentRootDomain}` : `---.${currentRootDomain}`;
}

// Xử lý thay đổi Record Type
function handleRecordTypeChange() {
  const type = document.getElementById('recordType').value;
  const lbl = document.getElementById('lblRecordContent');
  const input = document.getElementById('recordContent');
  const hint = document.getElementById('hintRecordContent');
  const proxyContainer = document.getElementById('proxyOptionContainer');

  if (type === 'A') {
    lbl.innerHTML = 'Địa chỉ IPv4 Đích (Target IP) <span class="required">*</span>';
    input.placeholder = 'Ví dụ: 103.142.26.15';
    hint.textContent = 'Nhập địa chỉ IPv4 của máy chủ / VPS';
    proxyContainer.style.display = 'block';
  } else if (type === 'AAAA') {
    lbl.innerHTML = 'Địa chỉ IPv6 Đích <span class="required">*</span>';
    input.placeholder = 'Ví dụ: 2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    hint.textContent = 'Nhập địa chỉ IPv6';
    proxyContainer.style.display = 'block';
  } else if (type === 'CNAME') {
    lbl.innerHTML = 'Tên miền Đích (Target Hostname) <span class="required">*</span>';
    input.placeholder = 'Ví dụ: myapp.herokuapp.com hoặc cname.vercel-dns.com';
    hint.textContent = 'Nhập tên miền đích cần trỏ tới';
    proxyContainer.style.display = 'block';
  } else if (type === 'TXT') {
    lbl.innerHTML = 'Nội dung bản ghi TXT <span class="required">*</span>';
    input.placeholder = 'Ví dụ: v=spf1 include:... ~all hoặc mã xác thực';
    hint.textContent = 'Nhập nội dung chuỗi văn bản';
    proxyContainer.style.display = 'none'; // TXT không hỗ trợ proxy
  }
}

// Mở Modal Tạo
function openCreateModal() {
  if (currentUser && currentUser.status !== 'approved') {
    showToast('Tài khoản của bạn chưa được duyệt hoạt động!', 'warning');
    return;
  }
  document.getElementById('createRecordForm').reset();
  document.getElementById('recordType').value = 'A';
  handleRecordTypeChange();
  updateSubdomainPreview();
  openModal('createSubdomainModal');
}

// Xử lý Gửi Tạo Subdomain
async function handleCreateRecord(e) {
  e.preventDefault();
  const subdomain = document.getElementById('subdomainInput').value.trim().toLowerCase();
  const type = document.getElementById('recordType').value;
  const content = document.getElementById('recordContent').value.trim();
  const proxied = document.getElementById('recordProxied').checked;
  const ttl = parseInt(document.getElementById('recordTtl').value) || 1;
  const description = document.getElementById('recordDescription').value.trim();
  const submitBtn = document.getElementById('btnSubmitCreateRecord');

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Đang tạo trên Cloudflare...';

    const res = await apiRequest('/api/student/records', {
      method: 'POST',
      body: JSON.stringify({
        subdomain,
        type,
        content,
        proxied,
        ttl,
        description
      })
    });

    if (res.success) {
      showToast(res.message, 'success');
      closeModal('createSubdomainModal');
      loadDnsRecords();
    }
  } catch (err) {
    showToast(err.message || 'Lỗi khi tạo subdomain', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Xác Nhận Tạo Subdomain';
  }
}

// Mở Modal Sửa
function openEditModal(encodedRecord) {
  const rec = JSON.parse(decodeURIComponent(encodedRecord));
  document.getElementById('editRecordId').value = rec.id;
  document.getElementById('editFullDomain').value = rec.fullDomain;
  document.getElementById('editRecordType').value = rec.type;
  document.getElementById('editRecordContent').value = rec.content;
  document.getElementById('editRecordProxied').checked = Boolean(rec.proxied);
  document.getElementById('editRecordDescription').value = rec.description || '';

  const proxyCont = document.getElementById('editProxyContainer');
  proxyCont.style.display = rec.type === 'TXT' ? 'none' : 'block';

  openModal('editRecordModal');
}

// Xử lý Cập nhật Subdomain
async function handleUpdateRecord(e) {
  e.preventDefault();
  const recordId = document.getElementById('editRecordId').value;
  const content = document.getElementById('editRecordContent').value.trim();
  const proxied = document.getElementById('editRecordProxied').checked;
  const description = document.getElementById('editRecordDescription').value.trim();
  const submitBtn = document.getElementById('btnSubmitEditRecord');

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Đang đồng bộ Cloudflare...';

    const res = await apiRequest(`/api/student/records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify({
        content,
        proxied,
        description
      })
    });

    if (res.success) {
      showToast(res.message, 'success');
      closeModal('editRecordModal');
      loadDnsRecords();
    }
  } catch (err) {
    showToast(err.message || 'Lỗi cập nhật', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Lưu Thay Đổi';
  }
}

// Xử lý Xóa Subdomain
async function handleDeleteRecord(id, fullDomain) {
  if (!confirm(`⚠️ Bạn có chắc chắn muốn xóa tên miền "${fullDomain}" không?\nHành động này sẽ xóa ngay lập tức trên máy chủ DNS Cloudflare.`)) {
    return;
  }

  try {
    const res = await apiRequest(`/api/student/records/${id}`, {
      method: 'DELETE'
    });

    if (res.success) {
      showToast(res.message, 'success');
      loadDnsRecords();
    }
  } catch (err) {
    showToast(err.message || 'Lỗi xóa subdomain', 'error');
  }
}

// Kiểm tra DNS Lookup trực tuyến
async function checkDnsLookup(domain) {
  document.getElementById('checkDomainTarget').textContent = domain;
  const resBox = document.getElementById('checkDnsResult');
  resBox.innerHTML = `🔄 Đang truy vấn máy chủ DNS toàn cầu cho tên miền <strong>${domain}</strong>...`;
  openModal('checkDnsModal');

  try {
    const res = await apiRequest(`/api/student/check-dns?domain=${encodeURIComponent(domain)}`);
    if (res.resolved && res.ips.length > 0) {
      resBox.innerHTML = `
        <div style="color: #34d399; font-weight: 700; margin-bottom: 8px;">✅ Phân giải DNS thành công!</div>
        <div><strong>Danh sách IP trả về:</strong></div>
        <ul style="margin: 8px 0 0 20px;">
          ${res.ips.map(ip => `<li>${ip}</li>`).join('')}
        </ul>
        <div style="color: var(--text-muted); font-size: 0.78rem; margin-top: 10px;">
          💡 Lưu ý: Nếu bật Proxy Cloudflare, IP trả về sẽ là dải IP Anycast của Cloudflare để bảo vệ server của bạn.
        </div>
      `;
    } else {
      resBox.innerHTML = `
        <div style="color: #fbbf24; font-weight: 700; margin-bottom: 8px;">⏳ Đang cập nhật DNS</div>
        <div>${res.message}</div>
        <div style="color: var(--text-muted); font-size: 0.78rem; margin-top: 10px;">
          DNS thường mất từ vài giây đến 2 phút để lan truyền toàn mạng.
        </div>
      `;
    }
  } catch (err) {
    resBox.innerHTML = `<div style="color: #f87171;">❌ Lỗi truy vấn DNS: ${err.message}</div>`;
  }
}

// Đổi mật khẩu
async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;

  if (newPassword !== confirmNewPassword) {
    showToast('Mật khẩu mới không trùng khớp', 'error');
    return;
  }

  try {
    const res = await apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword })
    });

    if (res.success) {
      showToast(res.message, 'success');
      document.getElementById('changePasswordForm').reset();
      closeModal('changePasswordModal');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Đăng xuất
async function handleLogout() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất?')) return;
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  } catch (e) {
    window.location.href = '/login';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadUserProfile();

  const createRecordForm = document.getElementById('createRecordForm');
  if (createRecordForm) {
    createRecordForm.addEventListener('submit', handleCreateRecord);
  }

  const editRecordForm = document.getElementById('editRecordForm');
  if (editRecordForm) {
    editRecordForm.addEventListener('submit', handleUpdateRecord);
  }

  const changePasswordForm = document.getElementById('changePasswordForm');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', handleChangePassword);
  }
});
