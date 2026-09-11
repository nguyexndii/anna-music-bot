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
  // ── Lofi Quốc Tế Kinh Điển (Lofi Girl, Kudasai, Jinsang, Saib, Kupla, Purrple Cat, Ghibli) ──
  { artist: 'Lofi Girl', title: 'Lofi Girl - 1 A.M Study Session', searchQuery: 'Lofi Girl 1 A.M Study Session beats to relax study to instrumental', isVn: false },
  { artist: 'Lofi Girl', title: 'Lofi Girl - Morning Coffee', searchQuery: 'Lofi Girl Morning Coffee beats to relax study to instrumental', isVn: false },
  { artist: 'Lofi Girl', title: 'Lofi Girl - Sleepy Beats', searchQuery: 'Lofi Girl beats to sleep to instrumental', isVn: false },
  { artist: 'Lofi Girl', title: 'Lofi Girl - Cozy Winter Beats', searchQuery: 'Lofi Girl cozy winter beats to relax study to instrumental', isVn: false },
  { artist: 'Kudasai', title: 'Kudasai - The Girl I Haven\'t Met', searchQuery: 'Kudasai The Girl I Havent Met lofi instrumental', isVn: false },
  { artist: 'Kudasai', title: 'Kudasai - A Thousand Doors', searchQuery: 'Kudasai A Thousand Doors lofi hip hop instrumental', isVn: false },
  { artist: 'Kudasai', title: 'Kudasai - Technicolor', searchQuery: 'Kudasai Technicolor lofi chill instrumental', isVn: false },
  { artist: 'Jinsang', title: 'Jinsang - Affection', searchQuery: 'Jinsang Affection lofi hip hop instrumental', isVn: false },
  { artist: 'Jinsang', title: 'Jinsang - Feeling', searchQuery: 'Jinsang Feeling lofi instrumental', isVn: false },
  { artist: 'Jinsang', title: 'Jinsang - Egyptian Pools', searchQuery: 'Jinsang Egyptian Pools lofi beats instrumental', isVn: false },
  { artist: 'Jinsang', title: 'Jinsang - Summers Day', searchQuery: 'Jinsang Summers Day lofi instrumental', isVn: false },
  { artist: 'Idealism', title: 'Idealism - Lonely', searchQuery: 'Idealism Lonely lofi chill instrumental beats', isVn: false },
  { artist: 'Idealism', title: 'Idealism - Both of Us', searchQuery: 'Idealism Both of Us lofi chill beats instrumental', isVn: false },
  { artist: 'Idealism', title: 'Idealism - Nagashi', searchQuery: 'Idealism Nagashi lofi chill instrumental', isVn: false },
  { artist: 'Idealism', title: 'Idealism - Phantasm', searchQuery: 'Idealism Phantasm lofi instrumental', isVn: false },
  { artist: 'Kupla', title: 'Kupla - Kingdom in Blue', searchQuery: 'Kupla Kingdom in Blue lofi instrumental', isVn: false },
  { artist: 'Kupla', title: 'Kupla - Memory', searchQuery: 'Kupla Memory lofi instrumental', isVn: false },
  { artist: 'Kupla', title: 'Kupla - Roots', searchQuery: 'Kupla Roots lofi chillhop instrumental', isVn: false },
  { artist: 'Saib', title: 'Saib - In Your Arms', searchQuery: 'Saib In Your Arms chillhop lofi instrumental', isVn: false },
  { artist: 'Saib', title: 'Saib - Sakura Trees', searchQuery: 'Saib Sakura Trees lofi chillhop instrumental', isVn: false },
  { artist: 'Saib', title: 'Saib - Spike Spiegel', searchQuery: 'Saib Spike Spiegel jazzhop lofi instrumental', isVn: false },
  { artist: 'Purrple Cat', title: 'Purrple Cat - Bedtime Stories', searchQuery: 'Purrple Cat Bedtime Stories lofi chill beats instrumental', isVn: false },
  { artist: 'Purrple Cat', title: 'Purrple Cat - Moon Dance', searchQuery: 'Purrple Cat Moon Dance lofi chill beats instrumental', isVn: false },
  { artist: 'Purrple Cat', title: 'Purrple Cat - Distant Worlds', searchQuery: 'Purrple Cat Distant Worlds lofi instrumental', isVn: false },
  { artist: 'Tomppabeats', title: 'Tomppabeats - Far Away', searchQuery: 'Tomppabeats Far Away lofi hip hop instrumental', isVn: false },
  { artist: 'Tomppabeats', title: 'Tomppabeats - Harbor', searchQuery: 'Tomppabeats Harbor lofi hip hop instrumental', isVn: false },
  { artist: 'Ghibli Lofi', title: 'Spirited Away - One Summer\'s Day Lofi', searchQuery: 'Spirited Away One Summers Day lofi chillhop beats instrumental', isVn: false },
  { artist: 'Ghibli Lofi', title: 'Howl\'s Moving Castle - Merry Go Round Lofi', searchQuery: 'Howls Moving Castle Merry Go Round lofi chill beats instrumental', isVn: false },
  { artist: 'Ghibli Lofi', title: 'My Neighbor Totoro - Path of the Wind Lofi', searchQuery: 'My Neighbor Totoro Path of the Wind lofi instrumental beats', isVn: false },
  { artist: 'Coffee Shop Lofi', title: 'Rainy Cafe Piano & Vinyl Beats', searchQuery: 'coffee shop lofi chillhop boom bap beats instrumental', isVn: false },
  { artist: 'Coffee Shop Lofi', title: 'Morning Espresso Chill Beats', searchQuery: 'morning espresso lofi beats to study to instrumental', isVn: false },
  { artist: 'Tokyo Night Lofi', title: 'Shibuya Midnight Rain Lofi', searchQuery: 'shibuya midnight rain lofi hip hop beats instrumental', isVn: false },
  { artist: 'Tokyo Night Lofi', title: 'Tokyo Neon City Chillhop', searchQuery: 'tokyo midnight lofi hip hop chill instrumental', isVn: false },
  { artist: 'Cozy Bedroom Lofi', title: 'Warm Blanket & Gentle Rain', searchQuery: 'warm blanket rain lofi beats to sleep relax to instrumental', isVn: false },
  { artist: 'Sunset Lofi', title: 'Golden Hour Waves Chillhop', searchQuery: 'golden hour waves chill lofi instrumental beats', isVn: false },
  { artist: 'The Deli', title: 'The Deli - 5:32PM', searchQuery: 'The Deli 5:32PM lofi hip hop instrumental', isVn: false },
  { artist: 'Philanthrope', title: 'Philanthrope - Isolation', searchQuery: 'Philanthrope Isolation lofi beats instrumental', isVn: false }
];

/**
 * Nhờ Gemini tìm bản nhạc Lofi Study / Chillhop Quốc Tế KHÔNG LỜI cho Chế độ 24/7
 * Đảm bảo 100% không lời, phong phú đề tài, không bị lặp ít nhất 30 bài gần nhất
 */
async function getGemini247LofiTrack(recentHistory = []) {
  // Lọc bài fallback chưa từng phát trong ít nhất 30 bài gần nhất để chống trùng
  const availableFallbacks = CURATED_LOFI_TRACKS.filter(t => {
    return !recentHistory.slice(-30).some(h => {
      const hStr = typeof h === 'string' ? h.toLowerCase() : (h?.title || '').toLowerCase();
      const tTitle = t.title.toLowerCase();
      const cleanH = hStr.replace(/\[.*?\]|\(.*?\)|acoustic|guitar|piano|lofi|instrumental|beats|không lời|chill/gi, '').trim();
      const cleanT = tTitle.replace(/\[.*?\]|\(.*?\)|acoustic|guitar|piano|lofi|instrumental|beats|không lời|chill/gi, '').trim();
      return (cleanH.length >= 4 && cleanT.length >= 4 && (cleanH.includes(cleanT) || cleanT.includes(cleanH)));
    });
  });

  const pool = availableFallbacks.length > 0 ? availableFallbacks : CURATED_LOFI_TRACKS;
  const fallbackTrack = pool[Math.floor(Math.random() * pool.length)];

  try {
    const internationalThemes = [
      'Lofi Girl beats to relax and study to (warm hip hop boom-bap chillhop)',
      'Cozy rainy day coffee shop lofi beats with cassette tape crackle',
      'Studio Ghibli aesthetic cozy anime lofi chillhop instrumental',
      'Kudasai / Jinsang / Idealism style nostalgic vinyl lofi hip hop',
      'Late night Tokyo neon rain lofi jazzhop beats instrumental',
      'Warm autumn sweater fireplace cozy ambient lofi study beats',
      'Sleepy midnight bedroom lofi chillhop beats to relax / sleep to',
      'Spring breeze cherry blossom Japanese chillhop instrumental',
      'Sunset rooftop city skyline jazz lofi beats with soft rhodes piano',
      'Starry night astronomy ambient lofi hip hop instrumental',
      'Old library rainy window reading acoustic rhodes lofi beats',
      'Vintage cassette tape boom bap chill lofi beats to code / study to'
    ];

    const theme = internationalThemes[Math.floor(Math.random() * internationalThemes.length)];

    const avoidTitles = recentHistory.slice(-30).map(h => typeof h === 'string' ? h : (h?.title || '')).filter(Boolean);
    const avoidStr = avoidTitles.length > 0 ? `TUYỆT ĐỐI TRÁNH lặp lại 30 bài vừa phát gần đây: ${avoidTitles.join(', ')}.` : '';

    const prompt = `Bạn là một DJ AI quốc tế chuyên sâu về văn hoá âm nhạc Lofi Study Beats, Chillhop và Jazzhop toàn cầu.
Hãy gợi ý 1 bản nhạc Lofi Quốc Tế KHÔNG LỜI (Instrumental) theo phong cách: "${theme}" để phát nền 24/7 thư giãn và học bài trên phòng Voice Discord.
${avoidStr}

Yêu cầu cực kỳ nghiêm ngặt:
1. BẮT BUỘC 100% LÀ NHẠC KHÔNG LỜI (Instrumental beats, chillhop, jazzhop, vinyl crackle, rhodes, soft hip hop drums). TUYỆT ĐỐI KHÔNG CÓ GIỌNG HÁT.
2. TUYỆT ĐỐI KHÔNG chọn các bài solo piano cover hay guitar cover nhạc pop (như An Coong hay karaoke cover). Bắt buộc phải có nhịp beat lofi chill/study đặc trưng (Lofi Girl, Kudasai, Jinsang, Idealism, Saib, Kupla, Purrple Cat, Potsu, Tomppabeats, The Deli, SwuM, Closed on Sunday...).
3. Tạo ra sự đa dạng, mới lạ, phong phú liên tục giữa các nghệ sĩ Lofi quốc tế chất lượng cao.
4. Trả về đúng định dạng JSON:
{
  "artist": "Tên nghệ sĩ Lofi (ví dụ: Kudasai, Jinsang, Lofi Girl, Saib...)",
  "title": "Tên bài hát Lofi",
  "searchQuery": "cụm từ tìm kiếm chính xác trên YouTube để ra đúng bản nhạc Lofi không lời đó (kèm 'lofi beats' hoặc 'lofi instrumental')"
}`;

    const res = await callGemini(prompt, 0.8);
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
