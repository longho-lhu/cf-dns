const db = require('../config/database');

/**
 * Middleware kiểm tra đã đăng nhập chưa
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Vui lòng đăng nhập để tiếp tục'
    });
  }
  next();
}

/**
 * Middleware kiểm tra quyền Quản trị viên (Admin)
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Vui lòng đăng nhập quyền Quản trị viên'
    });
  }

  if (req.session.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Bạn không có quyền truy cập chức năng Quản trị'
    });
  }

  next();
}

/**
 * Middleware kiểm tra sinh viên đã được phê duyệt (Approved) hay chưa
 */
function requireApprovedStudent(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Vui lòng đăng nhập'
    });
  }

  // Admin luôn có quyền
  if (req.session.user.role === 'admin') {
    return next();
  }

  // Lấy thông tin trạng thái mới nhất từ database để đảm bảo tính real-time
  const user = db.prepare('SELECT status FROM users WHERE id = ?').get(req.session.user.id);

  if (!user) {
    req.session.destroy();
    return res.status(401).json({
      success: false,
      message: 'Tài khoản không tồn tại hoặc đã bị xóa'
    });
  }

  if (user.status === 'pending') {
    return res.status(403).json({
      success: false,
      status: 'pending',
      message: 'Tài khoản của bạn đang chờ Quản trị viên phê duyệt. Vui lòng liên hệ Admin hoặc đợi duyệt!'
    });
  }

  if (user.status === 'rejected') {
    return res.status(403).json({
      success: false,
      status: 'rejected',
      message: 'Tài khoản của bạn đã bị từ chối phê duyệt. Vui lòng liên hệ Quản trị viên!'
    });
  }

  if (user.status === 'blocked') {
    return res.status(403).json({
      success: false,
      status: 'blocked',
      message: 'Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Quản trị viên!'
    });
  }

  // Cập nhật lại session nếu có thay đổi
  req.session.user.status = user.status;
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireApprovedStudent
};
