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
 * Gọi Gemini API với cơ chế tự động xoay vòng Key & Model khi gặp lỗi
 * Hỗ trợ options.useSearchGrounding để kích hoạt Google Search Grounding
 */
async function callGemini(prompt, temperature = 0.3, options = {}) {
  const keys = getApiKeys();
  if (!keys || keys.length === 0) return null;

  const useSearch = Boolean(options.useSearchGrounding);

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(currentKeyIndex + attempt) % keys.length];

    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature
          }
        };

        if (useSearch) {
          // Bật Google Search Grounding
          requestBody.tools = [{ google_search: {} }];
        } else {
          requestBody.generationConfig.responseMimeType = 'application/json';
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (res.status === 200) {
          currentKeyIndex = (currentKeyIndex + attempt) % keys.length;
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            try {
              // Bóc tách JSON an toàn (phòng trường hợp text nằm trong markdown code block khi dùng search grounding)
              const cleanText = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();
              return JSON.parse(cleanText);
            } catch (e) {
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  return JSON.parse(jsonMatch[0]);
                } catch (e2) {}
              }
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
async function getGeminiRecommendation(lastSong, history = [], targetRegion = null) {
  const songTitle = typeof lastSong === 'object' ? (lastSong.title || '') : String(lastSong || '');
  const songArtist = typeof lastSong === 'object' ? (lastSong.artist || '') : '';
  const historyTitles = Array.isArray(history) ? history.map(h => typeof h === 'object' ? h.title : h).filter(Boolean).slice(0, 20) : [];

  const isLastSongRemix = /\b(remix|vinahouse|vinahey|nonstop|club\s*mix|bootleg|edm|dj|quẩy|house\s*lak)\b/i.test(songTitle);

  let regionInstruction = '';
  if (targetRegion === 'VI') {
    regionInstruction = `\n- BẮT BUỘC 100% BÀI TIẾP THEO LÀ NHẠC VIỆT NAM (V-Pop, V-Indie, V-Rap, Ballad Việt, Vinahouse...) do NGHỆ SĨ VIỆT NAM thể hiện (Vũ, Madihu, Grey D, Chillies, HIEUTHUHAI, MCK, Hoàng Dũng...). TUYỆT ĐỐI CẤM nhạc ngoại!`;
  } else if (targetRegion === 'KR') {
    regionInstruction = `\n- BẮT BUỘC 100% BÀI TIẾP THEO LÀ K-POP TIẾNG HÀN (NewJeans, BTS, BLACKPINK, IVE, aespa, IU, Taeyeon, TXT...). TUYỆT ĐỐI CẤM nhảy sang nhạc Việt hay nhạc khác!`;
  } else if (targetRegion === 'JP') {
    regionInstruction = `\n- BẮT BUỘC 100% BÀI TIẾP THEO LÀ J-POP TIẾNG NHẬT (Yoasobi, Ado, Kenshi Yonezu, Eve, Fujii Kaze...). TUYỆT ĐỐI CẤM nhảy sang nhạc Việt!`;
  } else if (targetRegion === 'CN') {
    regionInstruction = `\n- BẮT BUỘC 100% BÀI TIẾP THEO LÀ C-POP / NHẠC HOA TIẾNG TRUNG (Jay Chou, JJ Lin, G.E.M., Tiết Chi Khiêm...). TUYỆT ĐỐI CẤM nhảy sang nhạc Việt!`;
  } else if (targetRegion === 'INTL') {
    regionInstruction = `\n- BẮT BUỘC 100% BÀI TIẾP THEO LÀ NHẠC QUỐC TẾ / US-UK TIẾNG ANH (Taylor Swift, The Weeknd, Bruno Mars, Ed Sheeran, Ariana Grande, Billie Eilish, Post Malone, Dua Lipa, Charlie Puth...). TUYỆT ĐỐI CẤM GỢI Ý NHẠC VIỆT NAM, CA SĨ VIỆT NAM HOẶC BÀI CÓ LỜI TIẾNG VIỆT! Mọi gợi ý bài Việt Nam ở đây đều là SAI NGHIÊM TRỌNG!`;
  }

  const prompt = `Bạn là một DJ AI và chuyên gia thẩm âm hàng đầu thế giới. Người nghe vừa nghe xong bài hát: "${songTitle}"${songArtist ? ` của nghệ sĩ: "${songArtist}"` : ''}.
VÙNG QUỐC GIA/NGÔN NGỮ ĐÃ XÁC ĐỊNH CHO PHIÊN NÀY: ${targetRegion || 'Tự động theo bài'}.
DANH SÁCH 20 BÀI HÁT VỪA PHÁT GẦN ĐÂY: ${JSON.stringify(historyTitles)}.
Hãy phân tích và gợi ý 1 BÀI HÁT TIẾP THEO HOÀN HẢO NHẤT theo các nguyên tắc sống còn sau:

1. KHÓA CHẶT 100% NGÔN NGỮ & QUỐC GIA (STRICT REGION/CULTURE LOCK - TUYỆT ĐỐI KHÔNG ĐƯỢC SAI LỆCH):${regionInstruction || `
- Nếu bài vừa nghe là NHẠC VIỆT: 100% bài tiếp theo PHẢI LÀ NHẠC VIỆT NAM do nghệ sĩ Việt Nam thể hiện. Tuyệt đối cấm nhạc ngoại!
- Nếu bài vừa nghe là NHẠC QUỐC TẾ / US-UK (Tiếng Anh): 100% bài tiếp theo PHẢI LÀ NHẠC US-UK TIẾNG ANH. Tuyệt đối cấm nhạc Việt Nam!
- Nếu bài vừa nghe là K-POP: 100% bài tiếp theo là K-POP tiếng Hàn.
- Nếu bài vừa nghe là C-POP: 100% bài tiếp theo là C-POP tiếng Trung.`}

2. ĐỒNG BỘ PHONG CÁCH, TEMPO & VIBE (THÔNG MINH THEO THỂ LOẠI):
${isLastSongRemix ? `- BÀI VỪA PHÁT LÀ BẢN REMIX / VINAHOUSE / NHẠC QUẨY: BẮT BUỘC bài tiếp theo PHẢI LÀ BẢN REMIX / VINAHOUSE / DANCE / QUẨY CỰC SUNG cùng năng lượng tương tự! TUYỆT ĐỐI CẤM gợi ý bản ballad, acoustic, chill hay bài gốc chậm làm tụt mood người nghe!` : `- NẾU BÀI VỪA NGHE LÀ REMIX / VINAHOUSE / DANCE / EDM / NONSTOP / NHẠC QUẨY: BẮT BUỘC bài tiếp theo PHẢI LÀ BẢN REMIX / VINAHOUSE / QUẨY cực sung cùng năng lượng tương tự!
- Nếu bài vừa nghe là INDIE / ACOUSTIC / R&B CHILL: Bài tiếp theo phải là Indie/R&B/Chill êm dịu, thư thái tương tự.
- Nếu bài vừa nghe là BALLAD / SUY / BUỒN: Bài tiếp theo phải là Ballad sâu lắng, giàu cảm xúc.
- Nếu bài vừa nghe là HIP-HOP / RAP: Bài tiếp theo phải là Rap/Hip-hop cùng chất flow/vibe.`}

3. NGUYÊN TẮC CHỐNG LẶP BÀI VÀ KHÓA CHẶT TỪ KHÓA TÌM KIẾM:
- TUYỆT ĐỐI KHÔNG gợi ý lại bất kỳ bài hát nào có trong danh sách 20 bài vừa phát gần đây!
- TUYỆT ĐỐI KHÔNG GỢI Ý BẢN HÁT LIVE SÂN KHẤU (Live stage, Live concert, Liveshow, Fancam, Listening party, On stage, Hát live, Bản quay điện thoại, Demo).
${isLastSongRemix ? `- VÌ LÀ BẢN REMIX: Trong trường "searchQuery", TUYỆT ĐỐI KHÔNG GẮN 'official audio', BẮT BUỘC gắn kèm từ khóa "remix" hoặc tên DJ remix (ví dụ: "Cắt Đôi Nỗi Sầu Darrys Remix" hoặc "Tăng Duy Tân remix vinahouse") để tìm đúng bản nhạc bay/quẩy chuẩn nhất!` : `- BẮT BUỘC 100% PHẢI LÀ BẢN THU ÂM PHÒNG THU CHÍNH THỨC (Studio Master / Official Audio / Official MV / Album Track) có chất lượng âm thanh cao nhất.
- Trong trường "searchQuery", BẮT BUỘC gắn kèm "official audio" (hoặc "official mv", "official visualizer") vào sau tên bài hát và ca sĩ (ví dụ: "Thôi Em Đừng Đi MCK official audio") để hệ thống lấy đúng bản master chính thống chuẩn phòng thu.`}
- Không gợi ý các video tạp nham, livestream, video review/phản ứng, video parody/chế nhảm.

4. Trả về đúng định dạng JSON:
{
  "artist": "Tên ca sĩ / DJ Producer",
  "title": "Tên bài hát",
  "searchQuery": "${isLastSongRemix ? 'Từ khóa tìm kiếm YouTube chuẩn nhất kèm remix' : 'Từ khóa tìm kiếm YouTube chuẩn nhất kèm official audio'}",
  "reason": "Lý do ngắn gọn vì sao bài này hợp"
}`;

  const res = await callGemini(prompt, 0.3);
  if (res && isLastSongRemix && res.searchQuery) {
    if (!/\b(remix|vinahouse|vinahey|mix|dj|bootleg)\b/i.test(res.searchQuery)) {
      res.searchQuery = `${res.searchQuery} remix`.trim();
    }
  }
  return res;
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
3. Ưu tiên tuyệt đối bản thu phòng thu chính thức (Official Audio / Official MV), KHÔNG chọn các bản diễn live sân khấu/fancam/demo trừ khi người dùng ghi rõ chữ 'live'.
4. Trả về đúng định dạng JSON:
{
  "artist": "Tên ca sĩ",
  "title": "Tên bài hát",
  "searchQuery": "Từ khóa tìm kiếm YouTube chuẩn nhất kèm 'official audio'",
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
  { artist: 'Philanthrope', title: 'Philanthrope - Isolation', searchQuery: 'Philanthrope Isolation lofi beats instrumental', isVn: false },
  { artist: 'Potsu', title: 'Potsu - [I\'m closing my eyes]', searchQuery: 'Potsu Im closing my eyes lofi beats instrumental', isVn: false },
  { artist: 'Potsu', title: 'Potsu - Lovesick', searchQuery: 'Potsu Lovesick lofi hip hop chill beats instrumental', isVn: false },
  { artist: 'SwuM', title: 'SwuM - I Miss U', searchQuery: 'SwuM I Miss U lofi beats instrumental', isVn: false },
  { artist: 'SwuM', title: 'SwuM - Let It Go', searchQuery: 'SwuM Let It Go lofi hip hop instrumental', isVn: false },
  { artist: 'Closed on Sunday', title: 'Closed on Sunday - Autumn Leaves Lofi', searchQuery: 'Closed on Sunday Autumn Leaves lofi chill beats instrumental', isVn: false },
  { artist: 'Closed on Sunday', title: 'Closed on Sunday - Rain in Kyoto', searchQuery: 'Closed on Sunday Rain in Kyoto lofi beats instrumental', isVn: false },
  { artist: 'Elijah Who', title: 'Elijah Who - Skate', searchQuery: 'Elijah Who Skate lofi hip hop instrumental', isVn: false },
  { artist: 'Elijah Who', title: 'Elijah Who - Hello', searchQuery: 'Elijah Who Hello lofi beats instrumental', isVn: false },
  { artist: 'Nujabes', title: 'Nujabes - Aruarian Dance Lofi Tribute', searchQuery: 'Nujabes Aruarian Dance lofi chillhop instrumental beats', isVn: false },
  { artist: 'Nujabes', title: 'Nujabes - Feather Instrumental Lofi', searchQuery: 'Nujabes Feather instrumental lofi beats', isVn: false },
  { artist: 'Rook1e', title: 'Rook1e - I Fell in Love with You One Night in September', searchQuery: 'Rook1e I Fell in Love with You One Night in September lofi instrumental', isVn: false },
  { artist: 'Biosphere', title: 'Biosphere - Stranger', searchQuery: 'Biosphere Stranger lofi hip hop instrumental beats', isVn: false },
  { artist: 'Sarcastic Sounds', title: 'Sarcastic Sounds - I Don\'t Sleep', searchQuery: 'Sarcastic Sounds I Dont Sleep lofi instrumental beats', isVn: false },
  { artist: 'Wun Two', title: 'Wun Two - Rio', searchQuery: 'Wun Two Rio lofi boom bap beats instrumental', isVn: false },
  { artist: 'Kupla', title: 'Kupla - Twilight', searchQuery: 'Kupla Twilight lofi chillhop beats instrumental', isVn: false },
  { artist: 'Lofi Fruits Music', title: 'Lofi Fruits - Chill Afternoon Study', searchQuery: 'Lofi Fruits chill study beats lofi hip hop instrumental', isVn: false },
  { artist: 'ChilledCow Classics', title: 'ChilledCow - Midnight Snack Beats', searchQuery: 'midnight snack lofi hip hop beats to relax study to instrumental', isVn: false },
  { artist: 'Chillhop Music', title: 'Chillhop Essentials - Rainy Window Vibes', searchQuery: 'chillhop essentials rainy window lofi instrumental beats', isVn: false },

  // ─── BỘ SƯU TẬP LONG LOFI SESSIONS & 1 HOUR+ INSTRUMENTAL MIXES (25 PHÚT – 2 TIẾNG) ───
  { artist: 'Lofi Girl', title: '1 A.M Study Session - Lofi Hip Hop Mix [1 Hour]', searchQuery: '1 hour lofi mix instrumental study session beats', isVn: false, isLong: true },
  { artist: 'Lofi Girl', title: 'Late Night Study - Lofi Beats to Sleep / Chill to', searchQuery: 'late night study lofi beats to relax study 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Chillhop Music', title: 'Chillhop Essentials Summer Beats [1 Hour Instrumental]', searchQuery: 'chillhop essentials instrumental mix 1 hour', isVn: false, isLong: true },
  { artist: 'Chillhop Music', title: 'Chillhop Yearmix - Best Instrumental Beats', searchQuery: 'chillhop music best beats mix 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Rainy Lofi Cafe', title: 'Rainy Night Coffee Shop - 1 Hour Cozy Jazz Lofi Mix', searchQuery: 'coffee shop jazz lofi instrumental mix 1 hour', isVn: false, isLong: true },
  { artist: 'Rainy Lofi Cafe', title: 'Midnight Rain & Smooth Piano Lofi Study Session', searchQuery: 'late night rain lofi hip hop mix 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Studio Ghibli Lofi', title: 'Ghibli Studio Chillhop Beats to Study to [1 Hour]', searchQuery: 'studio ghibli lofi hip hop mix instrumental 1 hour', isVn: false, isLong: true },
  { artist: 'Studio Ghibli Lofi', title: 'Nostalgic Anime Lofi Piano & Rain Session', searchQuery: 'anime lofi hip hop mix instrumental study relax', isVn: false, isLong: true },
  { artist: 'Tokyo Night Chill', title: 'Shinjuku Midnight Neon - 1 Hour Tokyo Lofi Mix', searchQuery: 'tokyo midnight lofi chill mix 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Tokyo Night Chill', title: 'Akihabara Cyber Rain - Chill Lofi Hip Hop Beats', searchQuery: 'tokyo night lofi rain beats instrumental mix', isVn: false, isLong: true },
  { artist: 'Coffee Shop Vibes', title: 'Morning Coffee & Books - Warm Lofi Study Beats', searchQuery: 'morning coffee shop lofi beats to study to instrumental mix', isVn: false, isLong: true },
  { artist: 'Cozy Bedroom Lofi', title: 'Lazy Sunday Afternoon - Cozy Room Lofi Hip Hop', searchQuery: 'lazy sunday lofi beats mix 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Cozy Bedroom Lofi', title: 'Soft Blanket & Warm Tea - Relaxing Lofi Beats', searchQuery: 'relaxing lofi beats study session instrumental mix', isVn: false, isLong: true },
  { artist: 'Nujabes Tribute', title: 'Spirit of Nujabes - Samurai Champloo Lofi Chill Mix', searchQuery: 'nujabes style lofi hip hop mix 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Nujabes Tribute', title: 'Aruarian Dreams - Jazzy Lofi Hip Hop Beats Mix', searchQuery: 'jazzy lofi hip hop instrumental mix 1 hour study', isVn: false, isLong: true },
  { artist: 'Kyoto Rain Lofi', title: 'Rainy Day in Kyoto - Japanese Bamboo Garden Lofi Mix', searchQuery: 'japanese lofi hip hop mix 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Lofi Fruits Music', title: 'Lofi Fruits Study Session - 1 Hour Chill Hop Mix', searchQuery: 'lofi fruits study session 1 hour chill beats instrumental', isVn: false, isLong: true },
  { artist: 'Purrple Cat Mix', title: 'Purrple Cat - Cozy Winter Beats [Full Album Mix]', searchQuery: 'purrple cat lofi beats album mix instrumental', isVn: false, isLong: true },
  { artist: 'Purrple Cat Mix', title: 'Purrple Cat - Silent Night Lofi Chill Session', searchQuery: 'purrple cat lofi instrumental mix study', isVn: false, isLong: true },
  { artist: 'Kudasai Chill', title: 'Kudasai Full Beats Collection - Instrumental Mix', searchQuery: 'kudasai lofi beats mix instrumental study session', isVn: false, isLong: true },
  { artist: 'Jinsang Chillhop', title: 'Jinsang - Life & Transitions [Full Instrumental Mix]', searchQuery: 'jinsang lofi beats collection instrumental mix', isVn: false, isLong: true },
  { artist: 'Tomppabeats Mix', title: 'Tomppabeats - Harbor & Nostalgia Full Beat Tape', searchQuery: 'tomppabeats full beat tape instrumental lofi', isVn: false, isLong: true },
  { artist: 'Midnight Coding Lofi', title: 'Deep Focus Coding Session - Dark Ambient Lofi Mix', searchQuery: 'coding lofi beats to code to deep focus 1 hour instrumental', isVn: false, isLong: true },
  { artist: 'Midnight Coding Lofi', title: 'Cyberpunk Lo-Fi Chill Beats - Night Developer Mix', searchQuery: 'developer lofi study beats 1 hour instrumental mix', isVn: false, isLong: true },
  { artist: 'Autumn Study Lofi', title: 'Warm Autumn Leaves - 1 Hour Acoustic Lofi Guitar Mix', searchQuery: 'acoustic guitar lofi mix 1 hour instrumental relax', isVn: false, isLong: true },
  { artist: 'Sunset Beach Lofi', title: 'Golden Hour Ocean Waves - Sunset Lofi Chill Session', searchQuery: 'ocean waves lofi chillhop mix 1 hour instrumental', isVn: false, isLong: true }
];

/**
 * Trả về ngay lập tức (0ms) bản nhạc Lofi Study / Chillhop Quốc Tế KHÔNG LỜI cho Chế độ 24/7
 * 100% MIỄN PHÍ, KHÔNG PHỤ THUỘC GEMINI AI, KHÔNG LO LỖI QUOTA HAY TRỄ MẠNG
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
  const chosenTrack = pool[Math.floor(Math.random() * pool.length)];
  return chosenTrack;
}

/**
 * Lấy lời bài hát (Lyrics) thông minh qua Gemini AI kết hợp Google Search Grounding
 */
async function getSongLyrics(songTitle, artist = '') {
  const prompt = `Bạn là một trợ lý âm nhạc am hiểu sâu sắc mọi thể loại nhạc. Hãy tra cứu Google và cung cấp toàn bộ LỜI BÀI HÁT (Lyrics) CHÍNH XÁC và ĐẦY ĐỦ NHẤT cho bài hát: "${songTitle}" ${artist ? `của ca sĩ/nghệ sĩ: "${artist}"` : ''}.

Yêu cầu định dạng JSON:
{
  "title": "Tên bài hát chuẩn",
  "artist": "Tên ca sĩ / nghệ sĩ thể hiện",
  "lyrics": "Toàn bộ lời bài hát được trình bày đẹp mắt theo từng đoạn (Lời 1 / Verse 1, Điệp khúc / Chorus, Lời 2 / Verse 2, Bridge, Outro). Nếu bài không lời (Instrumental/Beat) hãy ghi '[Bài hát không có lời / Nhạc không lời]'. Nếu không thể tìm thấy lời, hãy để chuỗi rỗng."
}`;

  try {
    const res = await callGemini(prompt, 0.2, { useSearchGrounding: true });
    if (res && res.lyrics && res.lyrics.trim().length > 5 && !res.lyrics.includes('không thể tìm thấy lời')) {
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

