/**
 * Validator Utilities
 */

// Kiểm tra định dạng Subdomain hợp lệ (chữ thường, số, dấu gạch ngang, dài từ 2-63 ký tự)
function isValidSubdomain(subdomain) {
  if (!subdomain || typeof subdomain !== 'string') return false;
  const regex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  return regex.test(subdomain.toLowerCase());
}

// Kiểm tra IPv4 hợp lệ
function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  return regex.test(ip.trim());
}

// Kiểm tra IPv6 hợp lệ
function isValidIPv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$|^([0-9a-fA-F]{1,4}:){1,7}:$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$/;
  return regex.test(ip.trim());
}

// Kiểm tra Hostname / CNAME hợp lệ
function isValidHostname(host) {
  if (!host || typeof host !== 'string') return false;
  const regex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  return regex.test(host.trim());
}

// Kiểm tra MSSV (Mã số sinh viên: chữ và số, tối thiểu 3 ký tự, không dấu cách)
function isValidMSSV(mssv) {
  if (!mssv || typeof mssv !== 'string') return false;
  const regex = /^[a-zA-Z0-9_-]{3,30}$/;
  return regex.test(mssv.trim());
}

module.exports = {
  isValidSubdomain,
  isValidIPv4,
  isValidIPv6,
  isValidHostname,
  isValidMSSV
};
