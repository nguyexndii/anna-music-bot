/**
 * Dynamic Lofi Discovery Engine (Khám Phá & Tìm Kiếm Nhạc Lofi Động)
 * 100% Miễn Phí, Tự Động, Không Gán Cứng, Tự Động Thích Ứng Theo Khung Giờ (Time-Aware)
 */

// Danh sách các kênh & nghệ sĩ Lofi / Chillhop chính chủ uy tín hàng đầu
const LOFI_CHANNELS_AND_ARTISTS = [
  'Lofi Girl',
  'Chillhop Music',
  'The Jazz Hop Café',
  'STEEZYASFUCK',
  'Purrple Cat',
  'In Your Chill',
  'Lofi Fruits Music',
  'Kudasai',
  'Jinsang',
  'Idealism',
  'Saib',
  'Kupla',
  'SwuM',
  'Closed on Sunday',
  'Elijah Who',
  'Nujabes style',
  'Rook1e',
  'Philanthrope',
  'Tomppabeats',
  'Studio Ghibli Lofi',
  'Coffee Shop Lofi',
  'Tokyo Night Chill',
  'Cozy Bedroom Lofi'
];

// Ma trận chủ đề âm nhạc theo khung giờ thực tế (Giờ Việt Nam UTC+7)
const TIME_VIBE_MATRIX = {
  // 05:00 - 08:59: Sáng sớm nhẹ nhàng, tỉnh táo đón bình minh
  morning: [
    'morning coffee lofi beats instrumental',
    'sunrise chillhop study beats 1 hour',
    'acoustic guitar lofi chill beats instrumental',
    'peaceful morning study session lofi mix',
    'fresh morning espresso lofi hip hop',
    'warm coffee shop lofi morning beats'
  ],
  // 09:00 - 16:59: Ban ngày làm việc, học tập, tập trung cao độ (Deep Focus / Coding)
  daytime: [
    'deep focus study session lofi hip hop mix 1 hour',
    'coding lofi beats to code to instrumental',
    'productive workday chillhop beats mix',
    'lofi hip hop beats to focus study 1 hour',
    'minimal study lofi instrumental mix',
    'ambient study session lofi beats to relax',
    'calm study beats 1 hour instrumental mix'
  ],
  // 17:00 - 19:59: Chiều tà, hoàng hôn, thư giãn sau giờ làm việc
  sunset: [
    'golden hour waves chillhop lofi mix',
    'sunset lofi hip hop mix 1 hour instrumental',
    'cozy afternoon lofi chillhop beats',
    'warm vinyl session lofi beats to relax',
    'evening walk lofi hip hop instrumental'
  ],
  // 20:00 - 23:59: Tối thư thái, đọc sách, cafe đêm ấm cúng
  evening: [
    'rainy cafe lofi jazzhop mix 1 hour',
    'late night study session lofi beats',
    'cozy bedroom rain lofi hip hop instrumental',
    'relaxing evening beats to unwind 1 hour',
    'tokyo midnight lofi chill mix instrumental',
    'soft piano lofi beats for cozy night'
  ],
  // 00:00 - 04:59: Đêm khuya tĩnh mịch, mất ngủ, thư giãn chìm vào giấc ngủ
  night: [
    'midnight rain lofi hip hop mix 1 hour instrumental',
    'insomnia deep focus dark ambient lofi beats',
    'late night rain beats to sleep study instrumental',
    'deep midnight lofi chill session 1 hour',
    'starry night lofi beats to fall asleep to',
    'shibuya midnight neon rain lofi mix'
  ]
};

// Từ khóa định vị độ dài & chất lượng
const QUALITY_MODIFIERS = [
  '1 hour mix instrumental',
  'beats to relax study to',
  'instrumental mix no vocals',
  'study session 1 hour',
  'chillhop mix instrumental'
];

/**
 * Xác định khung giờ hiện tại theo giờ Việt Nam (UTC+7)
 */
function getCurrentVibeSlot() {
  const vnHour = (new Date().getUTCHours() + 7) % 24;
  if (vnHour >= 5 && vnHour < 9) return 'morning';
  if (vnHour >= 9 && vnHour < 17) return 'daytime';
  if (vnHour >= 17 && vnHour < 20) return 'sunset';
  if (vnHour >= 20 && vnHour < 24) return 'evening';
  return 'night';
}

/**
 * Sinh chuỗi từ khóa tìm kiếm Lofi động thông minh
 * Kết hợp ngẫu nhiên Vibe khung giờ + Kênh/Nghệ sĩ + Bộ bổ nghĩa chất lượng
 * @param {Array} recentQueries - Danh sách các từ khóa đã dùng gần đây để tránh trùng lặp
 */
function getDynamicLofiSearchQuery(recentQueries = []) {
  const slot = getCurrentVibeSlot();
  const vibes = TIME_VIBE_MATRIX[slot] || TIME_VIBE_MATRIX.evening;

  // Lọc bỏ các vibe đã tìm gần nhất
  const recentStr = recentQueries.map(q => String(q).toLowerCase()).join(' ');
  const availableVibes = vibes.filter(v => !recentStr.includes(v.toLowerCase()));
  const chosenVibe = availableVibes.length > 0
    ? availableVibes[Math.floor(Math.random() * availableVibes.length)]
    : vibes[Math.floor(Math.random() * vibes.length)];

  const randomArtist = LOFI_CHANNELS_AND_ARTISTS[Math.floor(Math.random() * LOFI_CHANNELS_AND_ARTISTS.length)];
  const randomModifier = QUALITY_MODIFIERS[Math.floor(Math.random() * QUALITY_MODIFIERS.length)];

  // Luân phiên các mẫu cấu trúc câu tìm kiếm để YouTube trả về đa dạng nhất
  const templates = [
    `${randomArtist} ${chosenVibe}`,
    `${chosenVibe} ${randomModifier}`,
    `${randomArtist} ${randomModifier}`,
    `${chosenVibe} 2026`,
    `${randomArtist} lofi beats mix instrumental`
  ];

  const query = templates[Math.floor(Math.random() * templates.length)].trim();
  return {
    query,
    vibeSlot: slot,
    artist: randomArtist
  };
}

module.exports = {
  LOFI_CHANNELS_AND_ARTISTS,
  TIME_VIBE_MATRIX,
  getCurrentVibeSlot,
  getDynamicLofiSearchQuery
};
