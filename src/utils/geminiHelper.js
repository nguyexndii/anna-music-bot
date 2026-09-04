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

/**
 * Nhờ Gemini tìm bản nhạc Lofi KHÔNG LỜI (Instrumental Chill / Lofi Cafe Beats thư giãn) cho Chế độ 24/7
 */
async function getGemini247LofiTrack() {
  const themes = [
    'Lofi Girl beats to relax study to',
    'Chillhop Essentials jazzhop instrumental beats',
    'Coffee shop lofi acoustic piano chill beats',
    'Rainy night lofi hip hop study relax instrumental',
    'Tokyo street midnight lofi chill instrumental',
    'Ghibli inspired cozy relaxing lofi instrumental',
    'Deep sleep lofi ambient relaxing chill beats'
  ];
  const randomTheme = themes[Math.floor(Math.random() * themes.length)];

  const prompt = `Bạn là một DJ AI. Hãy gợi ý 1 bản nhạc Lofi Chill / Cafe Beats / Chillhop Instrumental KHÔNG LỜI theo chủ đề: "${randomTheme}" êm dịu, thư thái, dễ chịu nhất để phát nền 24/7 cho phòng Voice.

Yêu cầu chi tiết:
1. BẮT BUỘC LÀ NHẠC LOFI KHÔNG LỜI (Instrumental beats, Lofi study/relax beats, Cafe acoustic guitar/piano instrumental thuần túy).
2. Tuyệt đối không gợi ý bài hát có lời ca sĩ (no vocals, instrumental only).
3. Trả về đúng định dạng JSON:
{
  "artist": "Tên nghệ sĩ hoặc Kênh Lofi (ví dụ: Lofi Girl, Chillhop Music, Lofi Cafe, Feardog)",
  "title": "Tên bản nhạc Lofi",
  "searchQuery": "Từ khóa tìm kiếm YouTube chuẩn nhất (thêm chữ instrumental chill beats)"
}`;

  return await callGemini(prompt);
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
