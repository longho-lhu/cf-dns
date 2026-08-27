require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Khởi tạo Database
require('./src/config/database');

const authRoutes = require('./src/routes/authRoutes');
const studentRoutes = require('./src/routes/studentRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const settingRoutes = require('./src/routes/settingRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình bảo mật Helmet với Content Security Policy cho phép CDN
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https://*"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình Session
app.set('trust proxy', 1);
app.use(session({
  name: 'fit_dns_session',
  secret: process.env.SESSION_SECRET || 'c0ntr0l_d0m41n_f1t_s3cr3t_k3y_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
    httpOnly: true,
    sameSite: 'lax',
    secure: false // Đặt false để hoạt động trơn tru trên cả HTTP localhost và IP
  }
}));

// Rate Limiter cho API Authentication (chống brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 30, // tối đa 30 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu đăng nhập/đăng ký từ IP này. Vui lòng thử lại sau 15 phút!'
  }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Phục vụ file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Gắn các API Routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingRoutes);

// Điều hướng các trang HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Xử lý 404 cho API
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'API Endpoint không tồn tại' });
});

// Điều hướng các route khác về index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Xử lý lỗi toàn cục
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    success: false,
    message: 'Đã xảy ra lỗi máy chủ nội bộ. Vui lòng thử lại sau!'
  });
});

// Khởi động máy chủ
app.listen(PORT, () => {
  console.log('=====================================================');
  console.log(`🚀 FIT Cloudflare DNS System đang chạy tại: http://localhost:${PORT}`);
  console.log(`👤 Tài khoản Admin mặc định: Username=${process.env.ADMIN_USERNAME || 'admin'} | Password=${process.env.ADMIN_PASSWORD || 'Admin@123456'}`);
  console.log('=====================================================');
});
