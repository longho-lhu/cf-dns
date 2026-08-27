/**
 * Authentication Logic (Login & Register)
 */

function switchAuthTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const alertBox = document.getElementById('authAlert');

  if (alertBox) alertBox.style.display = 'none';

  if (tab === 'login') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    tabLoginBtn.classList.remove('active');
    tabRegisterBtn.classList.add('active');
  }
}

function displayAlert(message, type = 'danger') {
  const alertBox = document.getElementById('authAlert');
  if (!alertBox) return;

  alertBox.className = `alert alert-${type}`;
  alertBox.innerHTML = `<div>${message}</div>`;
  alertBox.style.display = 'flex';
}

// Xử lý Đăng Nhập
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitBtn = document.getElementById('loginSubmitBtn');

  if (!username || !password) {
    displayAlert('Vui lòng điền đầy đủ tên đăng nhập và mật khẩu!', 'danger');
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Đang xử lý đăng nhập...';

    const res = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (res.success) {
      showToast(res.message, 'success');
      
      // Chờ một chút để trình duyệt ghi nhận cookie session trước khi chuyển hướng
      setTimeout(() => {
        if (res.user.role === 'admin') {
          window.location.href = '/admin';
        } else {
          window.location.href = '/dashboard';
        }
      }, 200);
    }
  } catch (err) {
    displayAlert(err.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin!', 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Đăng Nhập Vào Hệ Thống';
  }
}

// Xử lý Đăng Ký
async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const fullName = document.getElementById('regFullName').value.trim();
  const className = document.getElementById('regClassName').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;
  const submitBtn = document.getElementById('registerSubmitBtn');

  if (!username || !fullName || !className || !password) {
    displayAlert('Vui lòng điền đầy đủ tất cả các trường thông tin!', 'danger');
    return;
  }

  if (password !== confirmPassword) {
    displayAlert('Mật khẩu nhập lại không trùng khớp!', 'danger');
    return;
  }

  if (password.length < 6) {
    displayAlert('Mật khẩu phải dài tối thiểu 6 ký tự!', 'danger');
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Đang gửi đăng ký...';

    const res = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        fullName,
        className,
        password,
        confirmPassword
      })
    });

    if (res.success) {
      showToast('Đăng ký thành công! Tài khoản đang chờ duyệt.', 'success');
      
      // Reset form đăng ký và chuyển sang tab đăng nhập
      document.getElementById('registerForm').reset();
      switchAuthTab('login');
      document.getElementById('loginUsername').value = username;

      displayAlert(`🎉 <strong>Đăng ký thành công!</strong><br>Mã số sinh viên <strong>${username}</strong> (${fullName}) đã được ghi nhận vào danh sách chờ duyệt của Quản trị viên.`, 'warning');
    }
  } catch (err) {
    displayAlert(err.message || 'Đăng ký không thành công. Vui lòng thử lại!', 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Gửi Đăng Ký Tài Khoản';
  }
}

// Kiểm tra xem user đã đăng nhập sẵn chưa
async function checkAuthSession() {
  try {
    const res = await apiRequest('/api/auth/me');
    if (res.success && res.user) {
      if (res.user.role === 'admin') {
        window.location.href = '/admin';
      } else {
        window.location.href = '/dashboard';
      }
    }
  } catch (e) {
    // Chưa đăng nhập, ở lại trang index
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }

  const tabLoginBtn = document.getElementById('tabLoginBtn');
  if (tabLoginBtn) {
    tabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
  }

  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  if (tabRegisterBtn) {
    tabRegisterBtn.addEventListener('click', () => switchAuthTab('register'));
  }
});
