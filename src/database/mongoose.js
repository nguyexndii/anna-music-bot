const mongoose = require('mongoose');
const config = require('../config');

/**
 * Kết nối tới MongoDB Atlas
 */
async function connectDatabase() {
  const mongoUri = config.mongoUri;
  if (!mongoUri) {
    console.log('ℹ️ MONGODB_URI chưa được cài trong .env -> Sử dụng file JSON làm Backend lưu trữ dự phòng.');
    return false;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('🍃 [MongoDB Atlas] Đã kết nối thành công tới Database!');
    return true;
  } catch (err) {
    console.error('❌ [MongoDB Atlas] Lỗi kết nối:', err.message);
    console.log('⚠️ Tự động chuyển sang sử dụng file JSON làm Backend dự phòng.');
    return false;
  }
}

module.exports = { connectDatabase };
