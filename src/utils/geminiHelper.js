const fetch = globalThis.fetch || require('node-fetch');
const config = require('../config');

// Danh sách Gemini API Keys để tự động luân phiên (load-balancing / failover)
let currentKeyIndex = 0;

function getApiKeys() {
  if (config.geminiApiKeys && config.geminiApiKeys.length > 0) {
    return config.geminiApiKeys;
  }
  if (process.env.GEMINI_API_KEYS) {
    return process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
  }
  if (process.env.GEMINI_API_KEY) {
    return [process.env.GEMINI_API_KEY.trim()];
  }
  return [];
}

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview'
];

/**
 * Gọi Gemini 3.5 Flash Lite & Gemini 3.6 Flash API với cơ chế tự động xoay vòng Key & Model khi gặp lỗi
 */
async function callGemini(prompt, temperature = 0.3) {
  const keys = getApiKeys();
  if (!keys || keys.length === 0) return null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(currentKeyIndex + attempt) % keys.length];

    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: temperature
            }
          })
        });

        if (res.status === 200) {
          currentKeyIndex = (currentKeyIndex + attempt) % keys.length;
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            try {
              return JSON.parse(text);
            } catch (e) {
              return null;
            }
          }
        }
      } catch (err) {
        // Tiếp tục thử model/key tiếp theo
      }
    }
  }

  return null;
}

/**
 * DJ AI gợi ý bài hát tiếp theo cho Autoplay (Khóa chuẩn ngôn ngữ, phong cách và vibe)
 */
async function getGeminiRecommendation(lastSongTitle, history = []) {
  const historyTitles = Array.isArray(history) ? history.map(h => typeof h === 'object' ? h.title : h).filter(Boolean).slice(0, 20) : [];
  const prompt = `Bạn là một DJ AI và chuyên gia thẩm âm hàng đầu. Người nghe vừa nghe xong bài hát: "${lastSongTitle}".
DANH SÁCH 20 BÀI HÁT VỪA PHÁT GẦN ĐÂY: ${JSON.stringify(historyTitles)}.
Hãy phân tích và gợi ý 1 BÀI HÁT TIẾP THEO HOÀN HẢO NHẤT theo các nguyên tắc sống còn sau:

1. KHÓA CHẶT 100% NGÔN NGỮ & QUỐC GIA (STRICT CULTURE/LANGUAGE LOCK - TUYỆT ĐỐI KHÔNG ĐƯỢC SAI LỆCH):
- NẾU BÀI VỪA NGHE LÀ NHẠC VIỆT (V-Pop, V-Indie, V-Rap, V-R&B, Ballad Việt, Vinahouse, Remix Việt...): BẮT BUỘC 100% bài tiếp theo PHẢI LÀ BÀI HÁT TIẾNG VIỆT do NGHỆ SĨ VIỆT NAM thể hiện (ví dụ: Vũ, Madihu, Grey D, Wren Evans, Chillies, Hoàng Dũng, MCK, HIEUTHUHAI, Suni Hạ Linh, Da LAB, MONO, Soobin...). TUYỆT ĐỐI CẤM nhảy sang K-Pop (BLACKPINK, BTS, NewJeans, ILLIT...), US-UK hay C-Pop!
- NẾU BÀI VỪA NGHE LÀ K-POP (Tiếng Hàn): BẮT BUỘC 100% bài tiếp theo là K-POP tiếng Hàn cùng vibe.
- NẾU BÀI VỪA NGHE LÀ US-UK (Tiếng Anh): BẮT BUỘC 100% bài tiếp theo là US-UK tiếng Anh cùng vibe.
- NẾU BÀI VỪA NGHE LÀ NHẠC HOA / C-POP: BẮT BUỘC 100% bài tiếp theo là C-Pop tiếng Trung cùng vibe.

2. ĐỒNG BỘ PHONG CÁCH, TEMPO & VIBE (THÔNG MINH THEO THỂ LOẠI):
- NẾU BÀI VỪA NGHE LÀ REMIX / VINAHOUSE / DANCE / EDM / NONSTOP / NHẠC QUẨY: BẮT BUỘC bài tiếp theo PHẢI LÀ BẢN REMIX / VINAHOUSE / QUẨY cực sung cùng năng lượng tương tự!
- Nếu bài vừa nghe là INDIE / ACOUSTIC / R&B CHILL: Bài tiếp theo phải là Indie/R&B/Chill êm dịu, thư thái tương tự.
- Nếu bài vừa nghe là BALLAD / SUY / BUỒN: Bài tiếp theo phải là Ballad sâu lắng, giàu cảm xúc.
- Nếu bài vừa nghe là HIP-HOP / RAP: Bài tiếp theo phải là Rap/Hip-hop cùng chất flow/vibe.

3. NGUYÊN TẮC CHỐNG LẶP BÀI (NGHIÊM NGẶT):
- TUYỆT ĐỐI KHÔNG gợi ý lại bất kỳ bài hát nào có trong danh sách 20 bài vừa phát gần đây!
- Không gợi ý các video tạp nham, livestream, video review/phản ứng, video parody/chế nhảm.

4. Trả về đúng định dạng JSON:
{
  "artist": "Tên ca sĩ / DJ Producer",
  "title": "Tên bài hát",
  "searchQuery": "Từ khóa tìm kiếm YouTube chuẩn nhất",
  "reason": "Lý do ngắn gọn vì sao bài này hợp"
}`;

  return await callGemini(prompt, 0.3);
}

/**
 * Tìm bài hát theo ngôn ngữ tự nhiên (Tâm trạng / Lời bài hát / Ngữ cảnh)
 */
async function parseNaturalMusicQuery(userQuery) {
  const prompt = `Bạn là một DJ AI thông minh và am hiểu sâu sắc mọi thể loại âm nhạc Việt Nam & Quốc tế.
Người dùng yêu cầu tìm nhạc bằng mô tả / câu hát / tâm trạng: "${userQuery}".
Hãy phân tích và chọn 1 bài hát chính xác, chất lượng cao nhất phù hợp với yêu cầu này.
Yêu cầu:
1. Nếu là một câu lời bài hát, tìm chính xác tên bài hát và ca sĩ thể hiện gốc.
2. Nếu là tâm trạng / không gian / thời điểm (ví dụ: nhạc làm việc, nhạc buồn đêm mưa, nhạc chill...), hãy chọn bài hát có gu âm nhạc tinh tế nhất.
3. Trả về đúng định dạng JSON:
{
  "artist": "Tên ca sĩ",
  "title": "Tên bài hát",
  "searchQuery": "Từ khóa tìm kiếm YouTube chuẩn nhất",
  "comment": "1 câu bình luận ngắn thú vị hoặc chia sẻ cảm xúc về bài này"
}`;

  return await callGemini(prompt);
}

const CURATED_LOFI_TRACKS = [
  // ── Nhạc Việt Chill Không Lời (V-Pop Acoustic Guitar / Piano / Lofi Instrumental) ──
  { artist: 'V-Pop Lofi', title: 'Đi Để Trở Về (Acoustic Guitar Lofi)', searchQuery: 'đi để trở về acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Em Dạo Này (Lofi Guitar Chill)', searchQuery: 'em dạo này lofi guitar instrumental chill không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Nàng Thơ (Piano Lofi Instrumental)', searchQuery: 'nàng thơ piano lofi instrumental chill không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: '3107 (Lofi Chill Beats Không Lời)', searchQuery: '3107 lofi instrumental chill beats không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Có Chàng Trai Viết Lên Cây (Acoustic Chill)', searchQuery: 'có chàng trai viết lên cây acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Bước Qua Mùa Cô Đơn (Piano Lofi)', searchQuery: 'bước qua mùa cô đơn piano lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Sài Gòn Đau Lòng Quá (Acoustic Lofi)', searchQuery: 'sài gòn đau lòng quá acoustic lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Tháng Tư Là Lời Nói Dối Của Em (Piano Chill)', searchQuery: 'tháng tư là lời nói dối của em piano chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Một Triệu Khả Năng (Acoustic Lofi)', searchQuery: 'một triệu khả năng acoustic lofi instrumental chill không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Ánh Sao Và Bầu Trời (Lofi Beats)', searchQuery: 'ánh sao và bầu trời lofi instrumental chill beats không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Chuyện Đôi Ta (Acoustic Lofi Guitar)', searchQuery: 'chuyện đôi ta acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Cafe Sáng Sài Gòn (Lofi Chill Không Lời)', searchQuery: 'cafe sáng sài gòn lofi acoustic guitar chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Mưa Chiều Hà Nội (Rainy Lofi Beats)', searchQuery: 'mưa chiều hà nội lofi chill instrumental beats không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Bình Yên Nơi Đây (Acoustic Guitar Lofi)', searchQuery: 'bình yên nơi đây acoustic guitar lofi chill không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Hoàng Hôn Phố Cổ (Vietnam Lofi Beats)', searchQuery: 'hoàng hôn phố cổ lofi chill instrumental beats không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Vết Mưa (Piano Lofi Instrumental)', searchQuery: 'vết mưa piano lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Gió Vẫn Hát (Guitar Chill Beats)', searchQuery: 'gió vẫn hát guitar lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Ngày Chưa Giông Bão (Piano Chill)', searchQuery: 'ngày chưa giông bão piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Hương Mùa Hè (Acoustic Guitar Lofi)', searchQuery: 'hương mùa hè acoustic lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Tách Trà Chiều (Lofi Chill Việt Nam)', searchQuery: 'tách trà chiều lofi acoustic chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Cơn Mưa Ngang Qua (Piano Lofi Chill)', searchQuery: 'cơn mưa ngang qua piano lofi instrumental chill không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Em Gái Mưa (Piano Lofi Instrumental)', searchQuery: 'em gái mưa piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Chiều Hôm Ấy (Guitar Lofi Instrumental)', searchQuery: 'chiều hôm ấy guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Dấu Mưa (Piano Lofi Instrumental)', searchQuery: 'dấu mưa piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Nơi Này Có Anh (Acoustic Guitar Lofi)', searchQuery: 'nơi này có anh acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Phía Sau Một Cô Gái (Piano Lofi)', searchQuery: 'phía sau một cô gái piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Yêu Một Người Có Lẽ (Piano Lofi Chill)', searchQuery: 'yêu một người có lẽ piano lofi chill không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Lạ Lùng - Vũ (Acoustic Guitar Lofi)', searchQuery: 'lạ lùng vũ acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Đông Kiếm Em (Guitar Lofi Chill)', searchQuery: 'đông kiếm em guitar lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Mùa Hè Của Em (Acoustic Guitar Lofi)', searchQuery: 'mùa hè của em acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Anh Đã Quen Với Cô Đơn (Piano Lofi)', searchQuery: 'anh đã quen với cô đơn piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Tình Nào Không Như Tình Đầu (Piano Chill)', searchQuery: 'tình nào không như tình đầu piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Suýt Nữa Thì (Acoustic Guitar Lofi)', searchQuery: 'suýt nữa thì acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Hẹn Một Mai (Piano Lofi Chill)', searchQuery: 'hẹn một mai piano lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Bông Hoa Đẹp Nhất (Piano Instrumental)', searchQuery: 'bông hoa đẹp nhất piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Có Em Chờ (Acoustic Guitar Lofi)', searchQuery: 'có em chờ acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Mặt Trời Của Em (Acoustic Lofi Chill)', searchQuery: 'mặt trời của em acoustic lofi chill instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Thằng Điên (Acoustic Guitar Lofi)', searchQuery: 'thằng điên acoustic guitar lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: '24H (Piano Lofi Instrumental)', searchQuery: '24h piano lofi instrumental không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Bao Tiền Một Mớ Bình Yên (Acoustic Chill)', searchQuery: 'bao tiền một mớ bình yên acoustic guitar lofi không lời', isVn: true },
  { artist: 'V-Pop Lofi', title: 'Đi Về Nhà (Acoustic Guitar Lofi)', searchQuery: 'đi về nhà acoustic guitar lofi instrumental không lời', isVn: true },

  // ── Lofi Quốc Tế Kinh Điển (Lofi Girl, Kudasai, Jinsang, Purrple Cat, Ghibli) ──
  { artist: 'Lofi Girl', title: 'Lofi Girl - 1 A.M Study Session', searchQuery: 'Lofi Girl 1 A.M Study Session beats to relax study to instrumental', isVn: false },
  { artist: 'Lofi Girl', title: 'Lofi Girl - Morning Coffee', searchQuery: 'Lofi Girl Morning Coffee beats to relax study to instrumental', isVn: false },
  { artist: 'Lofi Girl', title: 'Lofi Girl - Sleepy Beats', searchQuery: 'Lofi Girl beats to sleep to instrumental', isVn: false },
  { artist: 'Kudasai', title: 'Kudasai - The Girl I Haven\'t Met', searchQuery: 'Kudasai The Girl I Havent Met lofi instrumental', isVn: false },
  { artist: 'Kudasai', title: 'Kudasai - A Thousand Doors', searchQuery: 'Kudasai A Thousand Doors lofi', isVn: false },
  { artist: 'Jinsang', title: 'Jinsang - Affection', searchQuery: 'Jinsang Affection lofi hip hop instrumental', isVn: false },
  { artist: 'Jinsang', title: 'Jinsang - Feeling', searchQuery: 'Jinsang Feeling lofi instrumental', isVn: false },
  { artist: 'Idealism', title: 'Idealism - Both of Us', searchQuery: 'Idealism Both of Us lofi chill', isVn: false },
  { artist: 'Idealism', title: 'Idealism - Nagashi', searchQuery: 'Idealism Nagashi lofi chill', isVn: false },
  { artist: 'Kupla', title: 'Kupla - Kingdom in Blue', searchQuery: 'Kupla Kingdom in Blue lofi instrumental', isVn: false },
  { artist: 'Kupla', title: 'Kupla - Memory', searchQuery: 'Kupla Memory lofi instrumental', isVn: false },
  { artist: 'Saib', title: 'Saib - In Your Arms', searchQuery: 'Saib In Your Arms chillhop', isVn: false },
  { artist: 'Saib', title: 'Saib - Sakura Trees', searchQuery: 'Saib Sakura Trees lofi chillhop', isVn: false },
  { artist: 'Purrple Cat', title: 'Purrple Cat - Bedtime Stories', searchQuery: 'Purrple Cat Bedtime Stories lofi chill beats', isVn: false },
  { artist: 'Purrple Cat', title: 'Purrple Cat - Moon Dance', searchQuery: 'Purrple Cat Moon Dance lofi', isVn: false },
  { artist: 'Purrple Cat', title: 'Purrple Cat - Distant Worlds', searchQuery: 'Purrple Cat Distant Worlds lofi', isVn: false },
  { artist: 'Tomppabeats', title: 'Tomppabeats - Far Away', searchQuery: 'Tomppabeats Far Away lofi instrumental', isVn: false },
  { artist: 'Tomppabeats', title: 'Tomppabeats - Harbor', searchQuery: 'Tomppabeats Harbor lofi instrumental', isVn: false },
  { artist: 'Ghibli Lofi', title: 'Spirited Away - One Summer\'s Day Lofi', searchQuery: 'Spirited Away One Summers Day lofi piano instrumental', isVn: false },
  { artist: 'Ghibli Lofi', title: 'Howl\'s Moving Castle - Merry Go Round Lofi', searchQuery: 'Howls Moving Castle Merry Go Round lofi piano instrumental', isVn: false },
  { artist: 'Ghibli Lofi', title: 'My Neighbor Totoro - Path of the Wind Lofi', searchQuery: 'My Neighbor Totoro Path of the Wind lofi instrumental', isVn: false },
  { artist: 'Coffee Shop Lofi', title: 'Rainy Cafe Piano Beats', searchQuery: 'coffee shop lofi acoustic piano chill beats instrumental', isVn: false },
  { artist: 'Coffee Shop Lofi', title: 'Morning Espresso Beats', searchQuery: 'morning espresso lofi beats to study to instrumental', isVn: false },
  { artist: 'Tokyo Night Lofi', title: 'Shibuya Midnight Rain', searchQuery: 'shibuya midnight rain lofi hip hop instrumental', isVn: false },
  { artist: 'Tokyo Night Lofi', title: 'Midnight City Beats', searchQuery: 'tokyo midnight lofi hip hop instrumental', isVn: false },
  { artist: 'Cozy Bedroom Lofi', title: 'Warm Blanket & Rain', searchQuery: 'warm blanket rain lofi beats to sleep relax to instrumental', isVn: false },
  { artist: 'Sunset Lofi', title: 'Golden Hour Waves', searchQuery: 'golden hour waves chill lofi instrumental beats', isVn: false },
  { artist: 'Autumn Leaves Lofi', title: 'Cozy Sweater & Tea', searchQuery: 'cozy sweater tea relaxing lofi instrumental', isVn: false }
];

/**
 * Nhờ Gemini tìm bản nhạc Lofi KHÔNG LỜI cho Chế độ 24/7
 * Tỉ lệ: ~65% Nhạc Việt không lời (V-Pop Acoustic Guitar/Piano Lofi) và ~35% Lofi Quốc Tế kinh điển
 * Lưu trữ danh sách bài và đảm bảo không bị lặp ít nhất 25 bài gần nhất
 */
async function getGemini247LofiTrack(recentHistory = []) {
  const isVietnamese = Math.random() < 0.65; // 65% Nhạc Việt không lời, 35% Lofi quốc tế

  // Lọc bài fallback chưa từng phát trong ít nhất 25 bài gần nhất để chống trùng
  const availableFallbacks = CURATED_LOFI_TRACKS.filter(t => {
    return !recentHistory.slice(-25).some(h => {
      const hStr = typeof h === 'string' ? h.toLowerCase() : (h?.title || '').toLowerCase();
      const tTitle = t.title.toLowerCase();
      const cleanH = hStr.replace(/\[.*?\]|\(.*?\)|acoustic|guitar|piano|lofi|instrumental|beats|không lời|chill/gi, '').trim();
      const cleanT = tTitle.replace(/\[.*?\]|\(.*?\)|acoustic|guitar|piano|lofi|instrumental|beats|không lời|chill/gi, '').trim();
      return (cleanH.length >= 4 && cleanT.length >= 4 && (cleanH.includes(cleanT) || cleanT.includes(cleanH)));
    });
  });

  const preferredPool = availableFallbacks.filter(t => t.isVn === isVietnamese);
  const pool = preferredPool.length > 0 ? preferredPool : (availableFallbacks.length > 0 ? availableFallbacks : CURATED_LOFI_TRACKS);
  const fallbackTrack = pool[Math.floor(Math.random() * pool.length)];

  try {
    const vnThemes = [
      'Nhạc Việt chill không lời V-Pop acoustic guitar lofi thư giãn',
      'Piano lofi Việt Nam thư giãn êm dịu không lời nhẹ nhàng',
      'Cafe sáng mưa rơi nhạc Việt chill lofi acoustic guitar instrumental',
      'Nhạc Trịnh acoustic guitar không lời lofi thư giãn mộc mạc',
      'V-Pop Lofi acoustic không lời giai điệu êm dịu quán cafe',
      'Đêm muộn mưa rơi phố cổ nhạc Việt piano lofi chill không lời',
      'Nhạc không lời V-Pop acoustic guitar nhẹ nhàng thư thái',
      'Acoustic guitar lofi ballad Việt Nam không lời êm dịu'
    ];

    const foreignThemes = [
      'Lofi Girl beats to relax study to instrumental',
      'Ghibli anime cozy relaxing piano lofi instrumental',
      'Kudasai / Idealism chill lofi beats instrumental',
      'Coffee shop acoustic piano lofi chill beats instrumental',
      'Rainy night lofi hip hop study relax instrumental beats'
    ];

    const theme = isVietnamese
      ? vnThemes[Math.floor(Math.random() * vnThemes.length)]
      : foreignThemes[Math.floor(Math.random() * foreignThemes.length)];

    const avoidTitles = recentHistory.slice(-25).map(h => typeof h === 'string' ? h : (h?.title || '')).filter(Boolean);
    const avoidStr = avoidTitles.length > 0 ? `TUYỆT ĐỐI TRÁNH lặp lại 25 bài vừa phát gần đây: ${avoidTitles.join(', ')}.` : '';

    const prompt = `Bạn là một DJ AI chuyên về dòng nhạc Lofi Chillhop và Nhạc Việt Chill Không Lời.
Hãy gợi ý 1 bản nhạc ${isVietnamese ? 'NHẠC VIỆT KHÔNG LỜI (V-Pop Acoustic Guitar / Piano Lofi Instrumental)' : 'Lofi quốc tế không lời kinh điển'} theo chủ đề: "${theme}" để phát nền 24/7 cho phòng Voice Discord.
${avoidStr}

Yêu cầu cực kỳ nghiêm ngặt:
1. BẮT BUỘC 100% LÀ NHẠC KHÔNG LỜI (Instrumental beats, acoustic guitar, piano). TUYỆT ĐỐI KHÔNG CÓ LỜI HÁT.
2. ${isVietnamese ? 'BẮT BUỘC là các bản nhạc Việt Nam quen thuộc (V-Pop, Indie Việt, Nhạc Trịnh...) được chuyển thể sang Acoustic Guitar, Piano hoặc Lofi KHÔNG LỜI.' : 'BẮT BUỘC là Lofi quốc tế êm dịu không lời (Lofi Girl, Kudasai, Jinsang, Ghibli, Idealism...).'}
3. TUYỆT ĐỐI KHÔNG chọn nhạc có giọng hát, nhạc remix TikTok, EDM, Vinahouse, hoặc nhạc meme.
4. Trả về đúng định dạng JSON:
{
  "artist": "${isVietnamese ? 'V-Pop Lofi' : 'Tên nghệ sĩ Lofi'}",
  "title": "Tên bản nhạc không lời",
  "searchQuery": "${isVietnamese ? 'tên bài hát tiếng việt acoustic guitar lofi instrumental không lời' : 'tên bài lofi instrumental chill beats'}"
}`;

    const res = await callGemini(prompt, 0.4);
    if (res && res.searchQuery && !/khá\s*bảnh|kha\s*banh|meme|troll|chế|hài|bựa|vinahouse/i.test(res.searchQuery + ' ' + (res.title || ''))) {
      return res;
    }
  } catch (e) {
    console.warn('[Gemini 24/7 Lofi Error]:', e.message);
  }
  return fallbackTrack;
}

/**
 * Lấy lời bài hát (Lyrics) thông minh qua Gemini AI
 */
async function getSongLyrics(songTitle, artist = '') {
  const prompt = `Bạn là một trợ lý âm nhạc am hiểu sâu sắc mọi thể loại nhạc. Hãy cung cấp toàn bộ LỜI BÀI HÁT (Lyrics) CHÍNH XÁC và ĐẦY ĐỦ cho bài hát: "${songTitle}" ${artist ? `của ca sĩ/nghệ sĩ: "${artist}"` : ''}.

Yêu cầu định dạng JSON:
{
  "title": "Tên bài hát chuẩn",
  "artist": "Tên ca sĩ / nghệ sĩ thể hiện",
  "lyrics": "Toàn bộ lời bài hát được trình bày đẹp mắt theo từng đoạn (Lời 1 / Verse 1, Điệp khúc / Chorus, Lời 2 / Verse 2, Bridge, Outro). Nếu bài không lời (Instrumental/Beat) hãy ghi '[Bài hát không có lời / Nhạc không lời]'. Nếu không thể tìm thấy lời, hãy để chuỗi rỗng."
}`;

  try {
    const res = await callGemini(prompt, 0.2);
    if (res && res.lyrics && res.lyrics.trim().length > 5) {
      return res;
    }
  } catch (e) {
    console.warn('[Gemini Lyrics Error]:', e.message);
  }
  return null;
}

module.exports = {
  getApiKeys,
  callGemini,
  getGeminiRecommendation,
  parseNaturalMusicQuery,
  getGemini247LofiTrack,
  getSongLyrics
};
