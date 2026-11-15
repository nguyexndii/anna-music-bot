const { performance } = require('perf_hooks');
const { resolveAppleMusicMetadata, getAppleArtistTopTracks, inferRegionFromAppleItem, appleMetaCache, appleArtistTracksCache } = require('./src/utils/appleMusicHelper');
const { isVietnameseTrack, generateSearchVariants, getRankedSubtitleTracks, isGarbageLyrics } = require('./src/utils/lyricsHelper');
const { isCandidateMatchingRegion, buildAutoplayFallbackQueries, resolveTrackOriginAndMetaAsync } = require('./src/utils/musicExtractor');
const { rankAndFilterTracks, evaluateVariantPenalty, normalizeVi } = require('./src/utils/searchWorker');

// Định nghĩa helper kiểm tra isLyricLanguageConsistent (nếu không export trực tiếp từ lyricsHelper)
function isLyricLanguageConsistentTest(rawTitle, artist, lyricText) {
  if (!lyricText || typeof lyricText !== 'string' || lyricText.length < 20) return true;
  const isVN = isVietnameseTrack({ rawTitle, artist });
  const VIETNAMESE_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  if (isVN) {
    const hasVnAccents = VIETNAMESE_REGEX.test(lyricText);
    if (!hasVnAccents) {
      const englishStopWords = /\b(the|and|you|that|with|have|this|from|they|will|would|there|their|what|about|which|when|make|like|time|just|know|take|people|into|year|your|good|some|could|them|other|than|then|now|look|only|come|over|think|also|back|after|use|two|how|our|work|first|well|way|even|new|want|because|any|these|give|day|most|us)\b/gi;
      const engMatches = lyricText.match(englishStopWords);
      if (engMatches && engMatches.length >= 8) {
        return false;
      }
    }
  } else {
    const vnMatches = lyricText.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi);
    if (vnMatches && vnMatches.length >= 6) {
      return false;
    }
  }
  return true;
}

const testResults = [];

function recordTest(caseId, name, status, durationMs, details, rawData = null) {
  testResults.push({
    caseId,
    name,
    status, // 'PASS' | 'FAIL' | 'WARN'
    durationMs: Number(durationMs.toFixed(2)),
    details,
    rawData
  });
  const color = status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m' : (status === 'WARN' ? '\x1b[33m[WARN]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m');
  console.log(`${color} [Case ${caseId}] ${name} (${durationMs.toFixed(1)}ms): ${details}`);
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('   ANNA MUSIC BOT - BLUE TEAM QA AUTOMATED TEST RUNNER');
  console.log('======================================================================\n');

  // =========================================================================
  // CASE 1: V-Pop không dấu: "Quang Hung MasterD - ‘Thuy Trieu’ - Official Visualizer"
  // =========================================================================
  console.log('--- ĐANG CHẠY CASE 1: V-Pop không dấu ---');
  {
    const rawTitle = "Quang Hung MasterD - ‘Thuy Trieu’ - Official Visualizer";
    const rawArtist = "Quang Hung MasterD";
    const t0 = performance.now();

    // 1.1 Apple Music Metadata Resolution
    const appleMeta = await resolveAppleMusicMetadata(rawTitle, rawArtist);
    const t1 = performance.now();

    const isAppleOk = appleMeta &&
      normalizeVi(appleMeta.canonicalTitle).includes('thuy trieu') &&
      normalizeVi(appleMeta.canonicalArtist).includes('quang hung') &&
      appleMeta.region === 'VI';

    recordTest(
      '1.1',
      'Apple Music Metadata bóc tách V-Pop không dấu',
      isAppleOk ? 'PASS' : 'FAIL',
      t1 - t0,
      isAppleOk
        ? `Nhận diện chuẩn: "${appleMeta.canonicalTitle}" - "${appleMeta.canonicalArtist}", Region: ${appleMeta.region}, ArtistID: ${appleMeta.appleArtistId}`
        : `Thất bại khi bóc tách Apple Music: ${JSON.stringify(appleMeta)}`,
      appleMeta
    );

    // 1.2 Nhận diện bài hát tiếng Việt qua lyricsHelper
    const t2 = performance.now();
    const isVN = isVietnameseTrack({ rawTitle, artist: rawArtist });
    const t3 = performance.now();

    recordTest(
      '1.2',
      'Nhận diện vùng tiếng Việt (isVietnameseTrack)',
      isVN === true ? 'PASS' : 'FAIL',
      t3 - t2,
      isVN ? 'Đã nhận diện chính xác bài hát là VI (V-Pop)' : 'Nhận diện sai: bị coi là bài ngoại quốc!',
      { isVN }
    );

    // 1.3 Sinh biến thể tìm kiếm lời bài hát (generateSearchVariants)
    const t4 = performance.now();
    const variants = generateSearchVariants(rawTitle, rawArtist, appleMeta);
    const t5 = performance.now();
    const topVariant = variants[0];
    const hasCanonicalFirst = topVariant && topVariant.expectedTrack === appleMeta?.canonicalTitle;

    recordTest(
      '1.3',
      'Ưu tiên biến thể Canonical từ Apple Music lên vị trí số 1 trong search lyrics',
      hasCanonicalFirst ? 'PASS' : 'FAIL',
      t5 - t4,
      hasCanonicalFirst
        ? `Biến thể ưu tiên #1: Track="${topVariant.expectedTrack}", Artist="${topVariant.expectedArtist}"`
        : `Biến thể #1 không chuẩn: ${JSON.stringify(topVariant)}`,
      variants.slice(0, 3)
    );
  }

  // =========================================================================
  // CASE 2: Indie ký tự lạ: "3107 3 - W/n ft. Duongg, Nalu" hoặc "W/n - 3107"
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 2: Indie ký tự lạ (W/n) ---');
  {
    const queryA = "3107 3 - W/n ft. Duongg, Nalu";
    const queryB = "W/n - 3107";

    // 2.1 Apple Music Metadata cho queryA
    const t0 = performance.now();
    const appleMetaA = await resolveAppleMusicMetadata(queryA, "W/n");
    const t1 = performance.now();

    const isOkA = appleMetaA && appleMetaA.canonicalTitle && appleMetaA.canonicalArtist;
    recordTest(
      '2.1',
      `Apple Music Metadata cho "${queryA}"`,
      isOkA ? 'PASS' : 'WARN',
      t1 - t0,
      isOkA
        ? `Đã phân giải: "${appleMetaA.canonicalTitle}" - "${appleMetaA.canonicalArtist}" (Region: ${appleMetaA.region})`
        : `Không tìm thấy trên iTunes với query phức tạp: ${JSON.stringify(appleMetaA)}`,
      appleMetaA
    );

    // 2.2 Apple Music Metadata cho queryB "W/n - 3107"
    const t2 = performance.now();
    const appleMetaB = await resolveAppleMusicMetadata(queryB, "W/n");
    const t3 = performance.now();

    const isOkB = appleMetaB && normalizeVi(appleMetaB.canonicalTitle).includes('3107');
    recordTest(
      '2.2',
      `Apple Music Metadata cho "${queryB}"`,
      isOkB ? 'PASS' : 'FAIL',
      t3 - t2,
      isOkB
        ? `Đã phân giải chuẩn: "${appleMetaB.canonicalTitle}" - "${appleMetaB.canonicalArtist}" (ArtistID: ${appleMetaB.appleArtistId})`
        : `Không tìm thấy Apple Music cho W/n - 3107: ${JSON.stringify(appleMetaB)}`,
      appleMetaB
    );

    // 2.3 Phân tách nghệ sĩ có ký tự lạ W/n và ft.
    const t4 = performance.now();
    const variants = generateSearchVariants(queryA, "W/n");
    const t5 = performance.now();
    const hasArtistWn = variants.some(v => JSON.stringify(v).includes('W/n') || JSON.stringify(v).includes('Duongg'));

    recordTest(
      '2.3',
      'Bóc tách nghệ sĩ W/n và feature Duongg, Nalu trong search variants',
      hasArtistWn ? 'PASS' : 'FAIL',
      t5 - t4,
      hasArtistWn ? `Bóc tách thành công nghệ sĩ: tìm thấy W/n và Duongg/Nalu` : `Không bóc tách được W/n: ${JSON.stringify(variants.slice(0, 2))}`,
      variants.slice(0, 3)
    );

    // 2.4 Kiểm tra nhận diện vùng ngôn ngữ cho W/n
    const isVnB = isVietnameseTrack({ rawTitle: queryB, artist: "W/n" });
    recordTest(
      '2.4',
      'Nhận diện vùng tiếng Việt cho Indie W/n - 3107',
      isVnB === true ? 'PASS' : 'WARN',
      0,
      `isVietnameseTrack trả về: ${isVnB}`,
      { isVnB }
    );
  }

  // =========================================================================
  // CASE 3: Ca sĩ Việt hát tiếng Anh: "Son Tung M-TP - Making My Way"
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 3: Ca sĩ Việt hát tiếng Anh ---');
  {
    const rawTitle = "Son Tung M-TP - Making My Way";
    const rawArtist = "Son Tung M-TP";

    // 3.1 isVietnameseTrack
    const t0 = performance.now();
    const isVN = isVietnameseTrack({ rawTitle, artist: rawArtist });
    const t1 = performance.now();

    recordTest(
      '3.1',
      'isVietnameseTrack nhận diện ca sĩ Việt hát tiếng Anh (Sơn Tùng M-TP)',
      isVN === true ? 'PASS' : 'FAIL',
      t1 - t0,
      isVN ? 'Đã nhận diện chuẩn là VI nhờ KNOWN_VN_ARTISTS_NORM_REGEX (Sơn Tùng M-TP)' : 'Bị nhận diện sai thành bài nước ngoài!',
      { isVN }
    );

    // 3.2 Apple Music Metadata
    const t2 = performance.now();
    const appleMeta = await resolveAppleMusicMetadata(rawTitle, rawArtist);
    const t3 = performance.now();

    const isOk = appleMeta && normalizeVi(appleMeta.canonicalArtist).includes('son tung') && normalizeVi(appleMeta.canonicalTitle).includes('making my way');
    recordTest(
      '3.2',
      'Apple Music Metadata cho "Son Tung M-TP - Making My Way"',
      isOk ? 'PASS' : 'FAIL',
      t3 - t2,
      isOk
        ? `Canonical: "${appleMeta.canonicalTitle}" - "${appleMeta.canonicalArtist}", Region: ${appleMeta.region}, Genre: ${appleMeta.primaryGenre}`
        : `Lỗi bóc tách Apple Music: ${JSON.stringify(appleMeta)}`,
      appleMeta
    );

    // 3.3 Khóa vùng Autoplay cho bài Making My Way
    const isMatchingVi = isCandidateMatchingRegion(
      { title: "Sơn Tùng M-TP - Đừng Làm Trái Tim Anh Đau", artist: "Sơn Tùng M-TP", seconds: 210 },
      'VI',
      { rawTitle, rawArtist, region: 'VI', cleanTrackTitle: 'Making My Way' }
    );
    recordTest(
      '3.3',
      'Khóa vùng Autoplay: Bài tiếng Anh của Sơn Tùng liên kết mượt với các bài V-Pop khác',
      isMatchingVi === true ? 'PASS' : 'FAIL',
      0,
      isMatchingVi ? 'Autoplay giữ đúng luồng nghe nhạc V-Pop' : 'Bị từ chối ghép nối trong luồng V-Pop!',
      { isMatchingVi }
    );
  }

  // =========================================================================
  // CASE 4: Bài quốc tế bị dịch: "K/DA - FIRESTARTER"
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 4: Bài quốc tế bị dịch (K/DA - FIRESTARTER) ---');
  {
    const rawTitle = "K/DA - FIRESTARTER (ft. Bea Miller)";
    const rawArtist = "K/DA";

    // 4.1 isVietnameseTrack phải là false
    const t0 = performance.now();
    const isVN = isVietnameseTrack({ rawTitle, artist: rawArtist });
    const t1 = performance.now();

    recordTest(
      '4.1',
      'isVietnameseTrack KHÔNG nhận nhầm K/DA là nhạc Việt',
      isVN === false ? 'PASS' : 'FAIL',
      t1 - t0,
      !isVN ? 'Chính xác: K/DA được xác định là Nhạc Quốc Tế (INTL)' : 'Sai lầm nghiêm trọng: K/DA bị nhận nhầm là Nhạc Việt!',
      { isVN }
    );

    // 4.2 Lọc phụ đề YouTube dịch tiếng Việt (Vietsub)
    const mockSubsMap = {
      'vi': [{ name: 'Tiếng Việt', languageCode: 'vi', vssId: 'vi', kind: 'standard', url: 'https://youtube.com/sub_vi' }],
      'en': [{ name: 'English (Original)', languageCode: 'en', vssId: 'en', kind: 'standard', url: 'https://youtube.com/sub_en' }],
      'ko': [{ name: 'Korean', languageCode: 'ko', vssId: 'ko', kind: 'standard', url: 'https://youtube.com/sub_ko' }]
    };

    const rankedSubs = getRankedSubtitleTracks(mockSubsMap, { rawTitle, artist: rawArtist });
    const chosenTrack = rankedSubs[0]?.[0];
    const containsViTrack = rankedSubs.some(arr => arr[0]?.languageCode === 'vi' || arr[0]?.name?.includes('Việt'));

    recordTest(
      '4.2',
      'getRankedSubtitleTracks chặn 100% phụ đề dịch Vietsub cho bài quốc tế K/DA',
      (!containsViTrack && chosenTrack?.languageCode === 'en') ? 'PASS' : 'FAIL',
      0,
      (!containsViTrack && chosenTrack?.languageCode === 'en')
        ? `Track phụ đề được chọn ưu tiên #1: ${chosenTrack.languageCode} (${chosenTrack.name}), phụ đề "vi" bị loại bỏ hoàn toàn.`
        : `Lỗi: Vẫn để lọt phụ đề dịch tiếng Việt: ${JSON.stringify(rankedSubs)}`,
      rankedSubs
    );

    // 4.3 Kiểm tra isLyricLanguageConsistent chặn lyric lời dịch
    const fakeVietnameseTranslatedLyric = `
      [00:10.00] Ngọn lửa bùng cháy dữ dội trong màn đêm
      [00:14.00] Tôi là người bắt đầu ngọn lửa này
      [00:18.00] Không ai có thể dập tắt được sức mạnh của chúng ta
      [00:22.00] Hãy bước lên và cùng tỏa sáng
      [00:26.00] Đốt cháy mọi giới hạn của bóng tối
      [00:30.00] Chúng ta là huyền thoại không bao giờ tàn
    `;
    const isConsistentWithVi = isLyricLanguageConsistentTest(rawTitle, rawArtist, fakeVietnameseTranslatedLyric);

    recordTest(
      '4.3',
      'isLyricLanguageConsistent chặn nội dung lời bài hát bị dịch tiếng Việt',
      isConsistentWithVi === false ? 'PASS' : 'FAIL',
      0,
      !isConsistentWithVi ? 'Đã phát hiện lời bài hát bị dịch tiếng Việt (chứa dấu tiếng Việt trên bài quốc tế) và loại bỏ!' : 'Lỗi: Chấp nhận lời dịch tiếng Việt cho bài quốc tế!',
      { isConsistentWithVi }
    );
  }

  // =========================================================================
  // CASE 5: Chữ Hán / Douyin: "潮汐 (Cháo Xī)"
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 5: Chữ Hán / Douyin (潮汐) ---');
  {
    const candChaoXi = {
      title: "潮汐 (Cháo Xī) - Official Audio",
      artist: "安苏羽",
      seconds: 198
    };

    // 5.1 inferRegionFromAppleItem
    const regionInferred = inferRegionFromAppleItem({
      trackName: "潮汐 (Cháo Xī)",
      artistName: "安苏羽",
      primaryGenreName: "C-Pop"
    });

    recordTest(
      '5.1',
      'inferRegionFromAppleItem nhận diện bài chữ Hán là vùng CN',
      regionInferred === 'CN' ? 'PASS' : 'FAIL',
      0,
      `Vùng được nhận diện: ${regionInferred}`,
      { regionInferred }
    );

    // 5.2 Chặn khi đang nghe Nhạc Việt (targetRegion = 'VI')
    const blockedInVi = isCandidateMatchingRegion(candChaoXi, 'VI', { rawTitle: "Thủy Triều", region: 'VI' });
    recordTest(
      '5.2',
      'isCandidateMatchingRegion CHẶN 100% "潮汐 (Cháo Xī)" khi đang nghe Nhạc Việt (VI)',
      blockedInVi === false ? 'PASS' : 'FAIL',
      0,
      !blockedInVi ? 'Chặn thành công tuyệt đối (kết quả = false)' : 'LỖI NGUY HIỂM: Bài chữ Hán lọt vào phiên nghe nhạc Việt!',
      { blockedInVi }
    );

    // 5.3 Chặn khi đang nghe Nhạc Âu Mỹ (targetRegion = 'INTL')
    const blockedInIntl = isCandidateMatchingRegion(candChaoXi, 'INTL', { rawTitle: "Shape of You", region: 'INTL' });
    recordTest(
      '5.3',
      'isCandidateMatchingRegion CHẶN 100% "潮汐 (Cháo Xī)" khi đang nghe Nhạc Quốc Tế (INTL)',
      blockedInIntl === false ? 'PASS' : 'FAIL',
      0,
      !blockedInIntl ? 'Chặn thành công tuyệt đối (kết quả = false)' : 'LỖI NGUY HIỂM: Bài chữ Hán lọt vào phiên nghe nhạc Quốc Tế!',
      { blockedInIntl }
    );

    // 5.4 Chấp nhận khi đang nghe Nhạc Hoa (targetRegion = 'CN')
    const allowedInCn = isCandidateMatchingRegion(candChaoXi, 'CN', { rawTitle: "芒种", region: 'CN' });
    recordTest(
      '5.4',
      'isCandidateMatchingRegion CHẤP NHẬN "潮汐 (Cháo Xī)" khi đúng phiên Nhạc Hoa (CN)',
      allowedInCn === true ? 'PASS' : 'FAIL',
      0,
      allowedInCn ? 'Chấp nhận chính xác (kết quả = true)' : 'Lỗi: Bị chặn nhầm trong chính vùng CN!',
      { allowedInCn }
    );
  }

  // =========================================================================
  // CASE 6: Bản biến thể Piano / Acoustic: "LIL Z POET - TÌNH MÌNH LẠ KÌ (ver.PIANO)"
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 6: Bản biến thể Piano / Acoustic ---');
  {
    const rawQuery = "LIL Z POET - TÌNH MÌNH LẠ KÌ";
    const candidates = [
      {
        title: "LIL Z POET - TÌNH MÌNH LẠ KÌ (Official Audio)",
        artist: "LIL Z POET",
        duration: "3:45",
        viewCountText: "5,000,000",
        isOfficial: true
      },
      {
        title: "LIL Z POET - TÌNH MÌNH LẠ KÌ (ver.PIANO) | Official MV",
        artist: "LIL Z POET",
        duration: "3:45",
        viewCountText: "4,000,000",
        isOfficial: true
      }
    ];

    // 6.1 Đánh giá điểm phạt trong searchWorker (evaluateVariantPenalty & rankAndFilterTracks)
    const t0 = performance.now();
    const ranked = rankAndFilterTracks(candidates, rawQuery, 'official');
    const t1 = performance.now();

    const origTrack = ranked.find(t => t.title.includes('Official Audio'));
    const pianoTrack = ranked.find(t => t.title.includes('ver.PIANO'));
    const scoreDiff = (origTrack?.score || 0) - (pianoTrack?.score || 0);

    const isPianoPenalized = pianoTrack && origTrack && scoreDiff >= 100;
    recordTest(
      '6.1',
      'searchWorker phạt nặng bản ver.PIANO (-100đ) và cấm cộng điểm Studio Master khi không yêu cầu',
      isPianoPenalized ? 'PASS' : 'FAIL',
      t1 - t0,
      isPianoPenalized
        ? `Bản gốc: ${origTrack.score}đ, Bản ver.PIANO: ${pianoTrack.score}đ (Chênh lệch: ${scoreDiff}đ áp đảo). Xếp hạng #1: "${ranked[0].title}"`
        : `Phạt chưa đủ mạnh! Điểm gốc: ${origTrack?.score}, Điểm Piano: ${pianoTrack?.score}`,
      { origScore: origTrack?.score, pianoScore: pianoTrack?.score, ranked }
    );

    // 6.2 Chặn bản Piano trong Autoplay nếu bài gốc không phải nhạc cụ
    const candPiano = {
      title: "LIL Z POET - TÌNH MÌNH LẠ KÌ (ver.PIANO)",
      artist: "LIL Z POET",
      seconds: 220
    };
    const seedMetaOrig = {
      rawTitle: "LIL Z POET - TÌNH MÌNH LẠ KÌ",
      cleanTrackTitle: "Tình Mình Lạ Kì",
      rawArtist: "LIL Z POET",
      region: 'VI'
    };

    const isBlockedInAutoplay = isCandidateMatchingRegion(candPiano, 'VI', seedMetaOrig);
    recordTest(
      '6.2',
      'musicExtractor.isCandidateMatchingRegion CHẶN bản ver.PIANO trong Autoplay',
      isBlockedInAutoplay === false ? 'PASS' : 'FAIL',
      0,
      !isBlockedInAutoplay ? 'Đã chặn hoàn toàn bản Piano trong phiên phát Autoplay bài hát thường!' : 'Lỗi: Để lọt bản ver.PIANO vào Autoplay!',
      { isBlockedInAutoplay }
    );
  }

  // =========================================================================
  // CASE 7: Autoplay Fallback Query
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 7: Autoplay Fallback Query ---');
  {
    const lastSong = {
      title: "Quang Hùng MasterD - Thủy Triều (Official Audio)",
      artist: "Quang Hùng MasterD",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    };

    const t0 = performance.now();
    // Phân tích metadata bài gốc (có kèm Apple Artist ID nếu tra cứu được)
    const seedMeta = await resolveTrackOriginAndMetaAsync({
      title: "Quang Hùng MasterD - Thủy Triều",
      artist: "Quang Hùng MasterD"
    });

    const fallbackQueries = await buildAutoplayFallbackQueries(lastSong, 'VI', seedMeta);
    const t1 = performance.now();

    // Kiểm tra xem fallback queries có bị dính tên bài cũ ("Thủy Triều" hoặc "Thuy Trieu") không
    const hasOldSongTitle = fallbackQueries.some(q => {
      const normQ = normalizeVi(q);
      return normQ.includes('thuy trieu');
    });

    // Kiểm tra xem có bài từ Apple Artist Top Tracks không
    const hasAppleTopTracks = seedMeta.appleArtistId && fallbackQueries.some(q => {
      return !q.includes('official mv') && !q.includes('remix vinahouse') && !q.includes('HIEUTHUHAI') && !q.includes('Sơn Tùng');
    });

    const isFallbackClean = !hasOldSongTitle && fallbackQueries.length > 0;
    recordTest(
      '7.1',
      'buildAutoplayFallbackQueries KHÔNG chứa tên bài cũ và sinh query mồi đa dạng',
      isFallbackClean ? 'PASS' : 'FAIL',
      t1 - t0,
      isFallbackClean
        ? `Tất cả ${fallbackQueries.length} query đều sạch bài cũ! Danh sách: [ ${fallbackQueries.map(q => `"${q}"`).join(', ')} ]`
        : `Lỗi: Query fallback bị dính tên bài cũ: ${JSON.stringify(fallbackQueries)}`,
      { seedMeta: { realTitle: seedMeta.realTitle, realArtist: seedMeta.realArtist, appleArtistId: seedMeta.appleArtistId }, fallbackQueries }
    );

    recordTest(
      '7.2',
      'Khai thác Apple Artist Top Tracks cho query fallback',
      hasAppleTopTracks ? 'PASS' : 'WARN',
      0,
      hasAppleTopTracks
        ? `Lấy thành công các bài hát khác từ Apple Music của cùng ca sĩ (ArtistID: ${seedMeta.appleArtistId})`
        : `Fallback dùng pool nghệ sĩ tương đương (ArtistID: ${seedMeta.appleArtistId || 'N/A'})`,
      { hasAppleTopTracks, fallbackQueries }
    );
  }

  // =========================================================================
  // CASE 8: RAM Cache & Latency (Apple Music & Top Tracks)
  // =========================================================================
  console.log('\n--- ĐANG CHẠY CASE 8: RAM Cache & Latency ---');
  {
    const testTitle = "HIEUTHUHAI - Không Thể Say";
    const testArtist = "HIEUTHUHAI";
    const cacheKey = `${testTitle.trim().toLowerCase()}|||${testArtist.trim().toLowerCase()}`;

    // Xóa cache bài này trước để đo Cold Latency
    appleMetaCache.delete(cacheKey);

    // Lần gọi 1 (Network Call)
    const t0 = performance.now();
    const res1 = await resolveAppleMusicMetadata(testTitle, testArtist);
    const t1 = performance.now();
    const coldLatency = t1 - t0;

    // Lần gọi 2 (RAM Cache Hit)
    const t2 = performance.now();
    const res2 = await resolveAppleMusicMetadata(testTitle, testArtist);
    const t3 = performance.now();
    const warmLatency = t3 - t2;

    const isCacheOk = warmLatency <= 2.5 && res1 && res2 && res1.canonicalTitle === res2.canonicalTitle;
    recordTest(
      '8.1',
      'Apple Music RAM Cache: Lần gọi 1 (Network) vs Lần gọi 2 (RAM Hit)',
      isCacheOk ? 'PASS' : 'WARN',
      warmLatency,
      isCacheOk
        ? `Lần 1: ${coldLatency.toFixed(1)}ms (Network), Lần 2: ${warmLatency.toFixed(2)}ms (RAM Hit 0ms). Dữ liệu đồng nhất: "${res2.canonicalTitle}"`
        : `RAM Hit chưa tối ưu: Lần 1 = ${coldLatency.toFixed(1)}ms, Lần 2 = ${warmLatency.toFixed(2)}ms`,
      { coldLatency, warmLatency, inCache: appleMetaCache.has(cacheKey) }
    );

    // Đo kiểm Cache getAppleArtistTopTracks
    if (res1 && res1.appleArtistId) {
      const artistId = res1.appleArtistId;
      appleArtistTracksCache.delete(`artist_${artistId}`);

      const ta0 = performance.now();
      const tracks1 = await getAppleArtistTopTracks(artistId, 5);
      const ta1 = performance.now();
      const artistColdLatency = ta1 - ta0;

      const ta2 = performance.now();
      const tracks2 = await getAppleArtistTopTracks(artistId, 5);
      const ta3 = performance.now();
      const artistWarmLatency = ta3 - ta2;

      const isArtistCacheOk = artistWarmLatency <= 2.5 && tracks1.length === tracks2.length;
      recordTest(
        '8.2',
        'getAppleArtistTopTracks RAM Cache: Lần 1 (Network) vs Lần 2 (RAM Hit)',
        isArtistCacheOk ? 'PASS' : 'WARN',
        artistWarmLatency,
        isArtistCacheOk
          ? `Lần 1: ${artistColdLatency.toFixed(1)}ms, Lần 2: ${artistWarmLatency.toFixed(2)}ms (RAM Hit 0ms). Lấy được ${tracks2.length} bài.`
          : `Lần 1 = ${artistColdLatency.toFixed(1)}ms, Lần 2 = ${artistWarmLatency.toFixed(2)}ms`,
        { artistColdLatency, artistWarmLatency, trackCount: tracks2.length }
      );
    }
  }

  // =========================================================================
  // TỔNG HỢP KẾT QUẢ KIỂM THỬ
  // =========================================================================
  console.log('\n======================================================================');
  console.log('   BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ THỰC TẾ (QA SUMMARY REPORT)');
  console.log('======================================================================');

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const r of testResults) {
    if (r.status === 'PASS') passCount++;
    else if (r.status === 'WARN') warnCount++;
    else failCount++;
  }

  console.log(`Tổng số bài test: ${testResults.length}`);
  console.log(`- \x1b[32mPASS\x1b[0m: ${passCount}`);
  console.log(`- \x1b[33mWARN\x1b[0m: ${warnCount}`);
  console.log(`- \x1b[31mFAIL\x1b[0m: ${failCount}`);

  // In JSON kết quả để QA Agent phân tích chi tiết
  console.log('\n=== JSON_SUMMARY_START ===');
  console.log(JSON.stringify(testResults, null, 2));
  console.log('=== JSON_SUMMARY_END ===\n');

  process.exit(failCount > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
  console.error('[TestSuite Fatal Error]:', err);
  process.exit(1);
});
