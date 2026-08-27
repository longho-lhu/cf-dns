/**
 * Admin Dashboard Management Logic
 */

let currentAdminTab = 'pending';
let searchUserDebounce = null;
let searchDnsDebounce = null;

// Kiểm tra quyền Admin
async function checkAdminAuth() {
  try {
    const res = await apiRequest('/api/auth/me');
    if (!res.success || !res.user || res.user.role !== 'admin') {
      window.location.href = '/login';
      return;
    }

    document.getElementById('adminFullName').textContent = res.user.fullName || 'Quản Trị Viên';
    
    // Tải dữ liệu ban đầu
    loadAdminStats();
    loadPendingUsers();
  } catch (err) {
    window.location.href = '/login';
  }
}

// Chuyển Tab Admin
function switchAdminTab(tab) {
  currentAdminTab = tab;
  
  const tabs = ['pending', 'users', 'dns', 'settings', 'logs'];
  tabs.forEach(t => {
    const sec = document.getElementById(`sec${capitalize(t)}`);
    const btn = document.getElementById(`tabBtn${capitalize(t)}`);
    if (sec) sec.style.display = t === tab ? 'block' : 'none';
    if (btn) {
      if (t === tab) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  if (tab === 'pending') loadPendingUsers();
  else if (tab === 'users') loadAllUsers();
  else if (tab === 'dns') loadAllDnsRecords();
  else if (tab === 'settings') loadSettings();
  else if (tab === 'logs') loadAuditLogs();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Tải số liệu thống kê tổng quan
async function loadAdminStats() {
  try {
    const res = await apiRequest('/api/admin/stats');
    if (res.success && res.data) {
      const { pendingUsers, approvedUsers, totalRecords, cloudflare } = res.data;

      document.getElementById('statPendingCount').textContent = pendingUsers;
      document.getElementById('statApprovedCount').textContent = approvedUsers;
      document.getElementById('statTotalDnsCount').textContent = totalRecords;

      // Badge đếm ở Tab Chờ duyệt
      const pendingBadge = document.getElementById('pendingTabBadge');
      const pendingTitleBadge = document.getElementById('pendingCountTitleBadge');
      
      if (pendingUsers > 0) {
        pendingBadge.textContent = pendingUsers;
        pendingBadge.style.display = 'inline-block';
        pendingTitleBadge.textContent = `${pendingUsers} yêu cầu chờ duyệt`;
      } else {
        pendingBadge.style.display = 'none';
        pendingTitleBadge.textContent = '0 yêu cầu';
      }

      // Trạng thái Cloudflare
      const cfStatusEl = document.getElementById('statCfStatus');
      if (cloudflare.success) {
        cfStatusEl.innerHTML = `<span style="color: #34d399; font-weight: 700;">Đã Kết Nối ✅</span>`;
      } else {
        cfStatusEl.innerHTML = `<span style="color: #f87171; font-weight: 700;" title="${cloudflare.message}">Chưa cấu hình / Lỗi ⚠️</span>`;
      }
    }
  } catch (err) {
    console.error('Lỗi tải thống kê:', err);
  }
}

// =========================================================================
// TAB 1: SINH VIÊN CHỜ DUYỆT
// =========================================================================
async function loadPendingUsers() {
  const tbody = document.getElementById('pendingTableBody');
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px;">Đang tải danh sách chờ duyệt...</td></tr>`;

  try {
    const res = await apiRequest('/api/admin/users?status=pending');
    if (!res.success) throw new Error(res.message);

    const users = res.data;
    loadAdminStats(); // Cập nhật lại số đếm

    if (users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              <div class="empty-state-icon">🎉</div>
              <h4>Không có yêu cầu chờ phê duyệt</h4>
              <p style="color: var(--text-secondary); font-size: 0.88rem;">Tất cả sinh viên đăng ký đều đã được xử lý.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <span style="font-family: monospace; font-weight: 700; color: var(--accent-secondary);">${u.username}</span>
        </td>
        <td style="font-weight: 600;">${u.fullName}</td>
        <td><span class="badge badge-type">${u.className || 'Chưa rõ'}</span></td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${formatDate(u.createdAt)}</td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 8px;">
            <button class="btn btn-success btn-sm" onclick="approveUser(${u.id}, '${u.username}')">
              ✅ Duyệt Ngay
            </button>
            <button class="btn btn-danger btn-sm" onclick="openRejectModal(${u.id}, '${u.username}', '${u.fullName}')">
              ❌ Từ Chối
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#f87171;">Lỗi tải dữ liệu: ${err.message}</td></tr>`;
  }
}

// Phê duyệt tài khoản sinh viên
async function approveUser(id, username) {
  try {
    const res = await apiRequest(`/api/admin/users/${id}/approve`, { method: 'POST' });
    showToast(res.message || `Đã duyệt sinh viên ${username}`, 'success');
    loadPendingUsers();
    loadAdminStats();
  } catch (err) {
    showToast(err.message || 'Lỗi khi phê duyệt', 'error');
  }
}

// Mở modal từ chối
function openRejectModal(id, username, fullName) {
  document.getElementById('rejectUserId').value = id;
  document.getElementById('rejectUserName').textContent = `${fullName} (${username})`;
  document.getElementById('rejectReason').value = '';
  openModal('rejectUserModal');
}

// Gửi từ chối
async function submitRejectUser() {
  const id = document.getElementById('rejectUserId').value;
  const note = document.getElementById('rejectReason').value.trim();

  try {
    const res = await apiRequest(`/api/admin/users/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    showToast(res.message, 'success');
    closeModal('rejectUserModal');
    loadPendingUsers();
    loadAdminStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// TAB 2: QUẢN LÝ TOÀN BỘ SINH VIÊN
// =========================================================================
async function loadAllUsers() {
  const tbody = document.getElementById('allUsersTableBody');
  const status = document.getElementById('userStatusFilter').value;
  const search = document.getElementById('userSearchInput').value.trim();

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px;">Đang tải danh sách sinh viên...</td></tr>`;

  try {
    const res = await apiRequest(`/api/admin/users?status=${status}&search=${encodeURIComponent(search)}`);
    if (!res.success) throw new Error(res.message);

    const users = res.data;
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-secondary);">Không tìm thấy sinh viên phù hợp.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      let statusBadge = `<span class="badge badge-approved">Đã duyệt</span>`;
      if (u.status === 'pending') statusBadge = `<span class="badge badge-pending">Chờ duyệt</span>`;
      else if (u.status === 'rejected') statusBadge = `<span class="badge badge-rejected">Từ chối</span>`;
      else if (u.status === 'blocked') statusBadge = `<span class="badge badge-blocked">Đang khóa</span>`;

      const isBlocked = u.status === 'blocked';
      const blockBtnLabel = isBlocked ? '🔓 Mở Khóa' : '🔒 Khóa';

      return `
        <tr>
          <td><span style="font-family: monospace; font-weight: 700; color: var(--accent-secondary);">${u.username}</span></td>
          <td style="font-weight: 600;">${u.fullName}</td>
          <td><span class="badge badge-type">${u.className || '---'}</span></td>
          <td>${statusBadge}</td>
          <td><strong style="color: var(--accent-primary);">${u.recordCount}</strong> subdomain</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="openQuotaModal(${u.id}, '${u.username}', ${u.maxSubdomains})" title="Đổi hạn mức tối đa">
              📊 ${u.maxSubdomains} domain ✏️
            </button>
          </td>
          <td style="text-align: right;">
            <div style="display: inline-flex; gap: 6px;">
              ${u.status === 'pending' ? `<button class="btn btn-success btn-sm" onclick="approveUser(${u.id}, '${u.username}')">✅ Duyệt</button>` : ''}
              <button class="btn btn-secondary btn-sm" onclick="openResetPasswordModal(${u.id}, '${u.username}')" title="Reset mật khẩu">
                🔑 Reset Pass
              </button>
              <button class="btn btn-secondary btn-sm" onclick="toggleUserStatus(${u.id})">
                ${blockBtnLabel}
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteUserPermanently(${u.id}, '${u.username}')" title="Xóa tài khoản và toàn bộ tên miền">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#f87171;">Lỗi: ${err.message}</td></tr>`;
  }
}

function handleUserSearch() {
  clearTimeout(searchUserDebounce);
  searchUserDebounce = setTimeout(() => {
    loadAllUsers();
  }, 300);
}

// Đổi trạng thái khóa / mở khóa
async function toggleUserStatus(id) {
  try {
    const res = await apiRequest(`/api/admin/users/${id}/toggle-status`, { method: 'POST' });
    showToast(res.message, 'success');
    loadAllUsers();
    loadAdminStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Mở modal đổi Quota
function openQuotaModal(id, username, currentQuota) {
  document.getElementById('quotaUserId').value = id;
  document.getElementById('quotaUserLabel').textContent = username;
  document.getElementById('quotaNumberInput').value = currentQuota;
  openModal('quotaModal');
}

async function submitUserQuota() {
  const id = document.getElementById('quotaUserId').value;
  const maxSubdomains = document.getElementById('quotaNumberInput').value;

  try {
    const res = await apiRequest(`/api/admin/users/${id}/quota`, {
      method: 'PUT',
      body: JSON.stringify({ maxSubdomains })
    });
    showToast(res.message, 'success');
    closeModal('quotaModal');
    loadAllUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Mở modal reset password
function openResetPasswordModal(id, username) {
  document.getElementById('resetPassUserId').value = id;
  document.getElementById('resetPassUserLabel').textContent = username;
  document.getElementById('resetPassNewValue').value = '';
  openModal('resetPasswordModal');
}

async function submitResetUserPassword() {
  const id = document.getElementById('resetPassUserId').value;
  const newPassword = document.getElementById('resetPassNewValue').value;

  if (!newPassword || newPassword.length < 6) {
    showToast('Mật khẩu mới phải từ 6 ký tự trở lên', 'error');
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });
    showToast(res.message, 'success');
    closeModal('resetPasswordModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Xóa vĩnh viễn sinh viên
async function deleteUserPermanently(id, username) {
  if (!confirm(`⚠️ CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA VĨNH VIỄN sinh viên "${username}" không?\nTất cả Subdomain của sinh viên này sẽ bị xóa khỏi Cloudflare ngay lập tức!`)) {
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
    showToast(res.message, 'success');
    loadAllUsers();
    loadAdminStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// TAB 3: QUẢN LÝ TOÀN BỘ BẢN GHI DNS
// =========================================================================
async function loadAllDnsRecords() {
  const tbody = document.getElementById('allDnsTableBody');
  const type = document.getElementById('dnsTypeFilter').value;
  const search = document.getElementById('dnsSearchInput').value.trim();

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px;">Đang tải tất cả bản ghi DNS...</td></tr>`;

  try {
    const res = await apiRequest(`/api/admin/records?type=${type}&search=${encodeURIComponent(search)}`);
    if (!res.success) throw new Error(res.message);

    const records = res.data;
    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-secondary);">Không tìm thấy bản ghi nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => {
      const isProxied = Boolean(r.proxied);
      const proxyBadge = isProxied
        ? `<span class="badge badge-cf-proxied">☁️ Proxied</span>`
        : `<span class="badge badge-cf-dns">☁️ DNS Only</span>`;

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-primary);">
              <a href="http://${r.fullDomain}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline dotted;">
                ${r.fullDomain}
              </a>
              <button class="btn btn-secondary btn-icon" style="width: 22px; height: 22px; margin-left: 4px; font-size: 0.7rem;" onclick="copyToClipboard('${r.fullDomain}', 'tên miền')">📋</button>
            </div>
            ${r.description ? `<div style="font-size: 0.75rem; color: var(--text-muted);">${r.description}</div>` : ''}
          </td>
          <td><span class="badge badge-type">${r.type}</span></td>
          <td>
            <span class="copy-badge" onclick="copyToClipboard('${r.content}', 'IP')">${r.content} 📋</span>
          </td>
          <td>${proxyBadge}</td>
          <td>
            <div style="font-weight: 600; font-size: 0.88rem;">${r.fullName}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">MSSV: ${r.username} (${r.className || 'N/A'})</div>
          </td>
          <td style="font-size: 0.8rem; color: var(--text-secondary);">${formatDate(r.createdAt)}</td>
          <td style="text-align: right;">
            <button class="btn btn-danger btn-sm" onclick="adminDeleteDnsRecord(${r.id}, '${r.fullDomain}')" title="Xóa bản ghi này">
              🗑️ Xóa
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#f87171;">Lỗi: ${err.message}</td></tr>`;
  }
}

function handleDnsSearch() {
  clearTimeout(searchDnsDebounce);
  searchDnsDebounce = setTimeout(() => {
    loadAllDnsRecords();
  }, 300);
}

// Admin xóa bản ghi DNS
async function adminDeleteDnsRecord(id, fullDomain) {
  if (!confirm(`⚠️ Bạn có chắc chắn muốn xóa bản ghi "${fullDomain}" của sinh viên không?\nHệ thống sẽ xóa trực tiếp trên máy chủ Cloudflare.`)) {
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/records/${id}`, { method: 'DELETE' });
    showToast(res.message, 'success');
    loadAllDnsRecords();
    loadAdminStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// TAB 4: CẤU HÌNH CLOUDFLARE & HỆ THỐNG
// =========================================================================
async function loadSettings() {
  try {
    const res = await apiRequest('/api/settings');
    if (!res.success || !res.data) return;

    const s = res.data;
    if (s.has_token) {
      document.getElementById('cfgCfToken').placeholder = `Token hiện tại: ${s.cf_api_token_masked} (Nhập mới nếu muốn đổi)`;
    }
    document.getElementById('cfgCfZone').value = s.cf_zone_id || '';
    document.getElementById('cfgRootDomain').value = s.cf_root_domain || 'fit.pro.vn';
    document.getElementById('cfgDefaultQuota').value = s.default_max_subdomains || '5';
    document.getElementById('cfgReservedWords').value = s.reserved_subdomains || '';
  } catch (err) {
    console.error('Lỗi tải cấu hình:', err);
  }
}

// Lưu cấu hình
async function handleSaveSettings(e) {
  e.preventDefault();
  const token = document.getElementById('cfgCfToken').value.trim();
  const zoneId = document.getElementById('cfgCfZone').value.trim();
  const rootDomain = document.getElementById('cfgRootDomain').value.trim();
  const defaultQuota = document.getElementById('cfgDefaultQuota').value;
  const reservedWords = document.getElementById('cfgReservedWords').value.trim();
  const btn = document.getElementById('btnSaveSettings');

  try {
    btn.disabled = true;
    btn.innerHTML = 'Đang lưu cấu hình...';

    const payload = {
      cf_zone_id: zoneId,
      cf_root_domain: rootDomain,
      default_max_subdomains: defaultQuota,
      reserved_subdomains: reservedWords
    };

    if (token) {
      payload.cf_api_token = token;
    }

    const res = await apiRequest('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.success) {
      showToast(res.message, 'success');
      loadSettings();
      loadAdminStats();
    }
  } catch (err) {
    showToast(err.message || 'Lỗi lưu cấu hình', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 Lưu Cấu Hình Hệ Thống';
  }
}

// Kiểm tra kết nối Cloudflare
async function handleTestCloudflareConnection() {
  const token = document.getElementById('cfgCfToken').value.trim();
  const zoneId = document.getElementById('cfgCfZone').value.trim();
  const resultEl = document.getElementById('testConnectionResult');

  resultEl.innerHTML = `<span style="color: #60a5fa;">🔄 Đang kiểm tra kết nối tới Cloudflare API...</span>`;

  try {
    const res = await apiRequest('/api/settings/test-cloudflare', {
      method: 'POST',
      body: JSON.stringify({ apiToken: token || undefined, zoneId: zoneId || undefined })
    });

    if (res.success) {
      resultEl.innerHTML = `<span style="color: #34d399; font-weight: 700;">✅ ${res.message} ${res.zoneName ? `(Zone: ${res.zoneName})` : ''}</span>`;
    } else {
      resultEl.innerHTML = `<span style="color: #f87171; font-weight: 600;">❌ ${res.message}</span>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<span style="color: #f87171;">❌ Lỗi: ${err.message}</span>`;
  }
}

// Tự động lấy danh sách Zone ID
async function handleFetchZones() {
  const token = document.getElementById('cfgCfToken').value.trim();
  const dropdownGroup = document.getElementById('zoneSelectGroup');
  const dropdown = document.getElementById('zoneSelectDropdown');

  try {
    showToast('Đang truy vấn danh sách Zone từ Cloudflare...', 'info');
    const res = await apiRequest('/api/settings/cloudflare-zones', {
      method: 'POST',
      body: JSON.stringify({ apiToken: token || undefined })
    });

    if (res.success && res.data && res.data.length > 0) {
      dropdown.innerHTML = `<option value="">-- Chọn Zone từ danh sách (${res.data.length} tên miền) --</option>`;
      res.data.forEach(z => {
        dropdown.innerHTML += `<option value="${z.id}" data-domain="${z.name}">${z.name} (Status: ${z.status}) - ID: ${z.id}</option>`;
      });
      dropdownGroup.style.display = 'block';
      showToast(`Đã tìm thấy ${res.data.length} zone tên miền!`, 'success');
    } else {
      showToast('Không tìm thấy Zone nào hoặc Token chưa đủ quyền', 'warning');
    }
  } catch (err) {
    showToast(err.message || 'Lỗi khi lấy danh sách zone', 'error');
  }
}

function handleSelectZoneFromDropdown() {
  const dropdown = document.getElementById('zoneSelectDropdown');
  const selected = dropdown.options[dropdown.selectedIndex];
  if (selected && selected.value) {
    document.getElementById('cfgCfZone').value = selected.value;
    const domain = selected.getAttribute('data-domain');
    if (domain) {
      document.getElementById('cfgRootDomain').value = domain;
    }
    showToast(`Đã chọn Zone: ${domain}`, 'info');
  }
}

// =========================================================================
// TAB 5: NHẬT KÝ HOẠT ĐỘNG (AUDIT LOGS)
// =========================================================================
async function loadAuditLogs() {
  const tbody = document.getElementById('auditLogsTableBody');
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px;">Đang tải nhật ký...</td></tr>`;

  try {
    const res = await apiRequest('/api/admin/logs');
    if (!res.success) throw new Error(res.message);

    const logs = res.data;
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-secondary);">Chưa có nhật ký nào được ghi nhận.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">${formatDate(l.created_at)}</td>
        <td><strong style="font-family: monospace; color: var(--accent-secondary);">${l.username || 'System'}</strong></td>
        <td><span class="badge badge-type">${l.action}</span></td>
        <td style="font-size: 0.88rem;">${l.details || '---'}</td>
        <td style="font-family: monospace; font-size: 0.78rem; color: var(--text-muted);">${l.ip_address || '---'}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#f87171;">Lỗi: ${err.message}</td></tr>`;
  }
}

// Đổi mật khẩu Admin
async function handleAdminChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('adminCurrentPass').value;
  const newPassword = document.getElementById('adminNewPass').value;
  const confirmNewPassword = document.getElementById('adminConfirmPass').value;

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
      document.getElementById('adminChangePasswordForm').reset();
      closeModal('adminChangePasswordModal');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Đăng xuất Admin
async function handleAdminLogout() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi Bảng Quản Trị?')) return;
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  } catch (e) {
    window.location.href = '/login';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();

  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSaveSettings);
  }

  const adminChangePasswordForm = document.getElementById('adminChangePasswordForm');
  if (adminChangePasswordForm) {
    adminChangePasswordForm.addEventListener('submit', handleAdminChangePassword);
  }
});
