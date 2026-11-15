const { performance } = require('perf_hooks');
const { resolveAppleMusicMetadata, getAppleArtistTopTracks, inferRegionFromAppleItem, appleMetaCache } = require('./src/utils/appleMusicHelper');
const { isVietnameseTrack, generateSearchVariants, getRankedSubtitleTracks, generateVietnameseNumberVariants } = require('./src/utils/lyricsHelper');
const { isCandidateMatchingRegion, buildAutoplayFallbackQueries, detectTrackRegion, analyzeTrackOriginAndMeta } = require('./src/utils/musicExtractor');
const { rankAndFilterTracks, evaluateVariantPenalty, normalizeVi } = require('./src/utils/searchWorker');

const results = [];

function assertTest(id, name, condition, details, rawData = null) {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`[${status}] [${id}] ${name}: ${details}`);
  results.push({ id, name, status, details, rawData });
  return condition;
}

async function runBlindSuite() {
  console.log('======================================================================');
  console.log('   ANNA MUSIC BOT - 20+ BLIND TEST CASES AUTOMATED RUNNER');
  console.log('   (KIỂM THỬ THỰC CHIẾN ĐỐI KHÁNG - CHỐNG HỌC TỦ - PHÁ 5 BẪY NGẦM)');
  console.log('======================================================================\n');

  // -----------------------------------------------------------------------------------------
  // NHÓM 1: V-POP KHÔNG DẤU & NGHỆ DANH ĐẶC BIỆT (APPLE MUSIC API RESOLUTION)
  // -----------------------------------------------------------------------------------------
  console.log('--- ĐANG CHẠY NHÓM 1: V-Pop Không Dấu & Nghệ Danh Đặc Biệt ---');

  // TC-01: bui truong linh duong toi cho em ve
  const t01Start = performance.now();
  const meta01 = await resolveAppleMusicMetadata('buitruonglinh - duong toi cho em ve', 'buitruonglinh');
  const t01Time = (performance.now() - t01Start).toFixed(1);
  assertTest('TC-01', 'buitruonglinh duong toi cho em ve',
    meta01 && meta01.region === 'VI' && meta01.canonicalTitle.includes('Đường Tôi Chở Em Về'),
    `(${t01Time}ms) Khôi phục chuẩn: "${meta01?.canonicalTitle}" - "${meta01?.canonicalArtist}", Region: ${meta01?.region}`,
    meta01
  );

  // TC-02a: dangrangto tai vi sao
  const meta02a = await resolveAppleMusicMetadata('dangrangto - tai vi sao', 'dangrangto');
  const reg02a = detectTrackRegion('dangrangto - tai vi sao', 'dangrangto');
  assertTest('TC-02a', 'dangrangto tai vi sao',
    reg02a === 'VI' || (meta02a && meta02a.region === 'VI'),
    `Nhận diện vùng: detectTrackRegion=${reg02a}, AppleRegion=${meta02a?.region}`,
    { reg02a, meta02a }
  );

  // TC-02b: rhyder chiu cach minh noi thua
  const reg02b = detectTrackRegion('rhyder - chiu cach minh noi thua', 'rhyder');
  assertTest('TC-02b', 'rhyder chiu cach minh noi thua',
    reg02b === 'VI',
    `Nhận diện vùng V-Pop: detectTrackRegion=${reg02b}`,
    { reg02b }
  );

  // TC-03: 52Hz doi (prod. RIO)
  const meta03 = await resolveAppleMusicMetadata('52Hz - Doi (prod. RIO)', '52Hz');
  const reg03 = detectTrackRegion('52Hz - Doi (prod. RIO)', '52Hz');
  assertTest('TC-03', '52Hz doi (prod. RIO)',
    (reg03 === 'VI' || meta03?.region === 'VI') && meta03?.canonicalTitle.toUpperCase().includes('ĐỢI'),
    `Chuẩn hóa có dấu: "${meta03?.canonicalTitle}" - "${meta03?.canonicalArtist}", Region=${meta03?.region || reg03}`,
    meta03
  );

  // TC-04a: Wren Evans Call Me (Tên tiếng Anh 100% nhưng là V-Pop)
  const meta04a = await resolveAppleMusicMetadata('Wren Evans - Call Me (Official Audio)', 'Wren Evans');
  const reg04a = detectTrackRegion('Wren Evans - Call Me (Official Audio)', 'Wren Evans');
  assertTest('TC-04a', 'Wren Evans Call Me (Bẫy bài tiếng Anh)',
    meta04a?.region === 'VI' && meta04a?.canonicalArtist.includes('Wren Evans'),
    `Apple Music giữ đúng vùng VI: Region=${meta04a?.region}, Artist="${meta04a?.canonicalArtist}"`,
    meta04a
  );

  // TC-04b: HIEUTHUHAI Exit Sign
  const meta04b = await resolveAppleMusicMetadata('HIEUTHUHAI - Exit Sign', 'HIEUTHUHAI');
  assertTest('TC-04b', 'HIEUTHUHAI Exit Sign',
    meta04b?.region === 'VI' && meta04b?.canonicalArtist.includes('HIEUTHUHAI'),
    `Apple Music nhận chuẩn: "${meta04b?.canonicalTitle}" - "${meta04b?.canonicalArtist}", Region=${meta04b?.region}`,
    meta04b
  );

  // TC-05: Nguyen Van 10 MCK (Chuyển số thành chữ "Nguyễn Văn Mười")
  const numVars05 = generateVietnameseNumberVariants('Nguyen Van 10');
  const hasMuoi = numVars05.some(v => v.includes('mười'));
  assertTest('TC-05', 'Nguyen Van 10 -> Nguyễn Văn Mười',
    hasMuoi,
    `Sinh biến thể chữ số: [${numVars05.join(', ')}]`,
    numVars05
  );

  // -----------------------------------------------------------------------------------------
  // NHÓM 2: BẪY NHẬN NHẦM TỪ VỰNG (FALSE-POSITIVE REGEX TRAPS)
  // -----------------------------------------------------------------------------------------
  console.log('\n--- ĐANG CHẠY NHÓM 2: Bẫy Nhận Nhầm Từ Vựng (False-Positive Traps) ---');

  // TC-06a: Olivia Rodrigo deja vu (BẪY CHỮ VU)
  const reg06a = detectTrackRegion('Olivia Rodrigo - deja vu (Official Video)', 'Olivia RodrigoVEVO');
  const isVn06a = isVietnameseTrack('Olivia Rodrigo - deja vu (Official Video)', 'Olivia RodrigoVEVO');
  const meta06a = await resolveAppleMusicMetadata('Olivia Rodrigo - deja vu (Official Video)', 'Olivia Rodrigo');
  assertTest('TC-06a', 'Olivia Rodrigo deja vu (Bẫy chữ "Vu")',
    reg06a === 'INTL' && !isVn06a && meta06a?.region === 'INTL',
    `detectTrackRegion=${reg06a}, isVietnameseTrack=${isVn06a}, AppleRegion=${meta06a?.region}`,
    { reg06a, isVn06a, meta06a }
  );

  // TC-06b: Beyoncé - Deja Vu
  const reg06b = detectTrackRegion('Beyoncé - Deja Vu (Official Video)', 'BeyonceVEVO');
  assertTest('TC-06b', 'Beyoncé - Deja Vu',
    reg06b === 'INTL',
    `detectTrackRegion=${reg06b}`,
    { reg06b }
  );

  // TC-06c: Ca sĩ Vũ thật (Vũ. - Bước Qua Nhau)
  const reg06c = detectTrackRegion('Vũ. - Bước Qua Nhau (Official Audio)', 'Vũ.');
  const isVn06c = isVietnameseTrack('Vũ. - Bước Qua Nhau (Official Audio)', 'Vũ.');
  assertTest('TC-06c', 'Ca sĩ Vũ thật (Vũ. - Bước Qua Nhau)',
    reg06c === 'VI' && isVn06c,
    `Nhận diện chính xác nghệ sĩ Vũ: Region=${reg06c}, isVn=${isVn06c}`,
    { reg06c, isVn06c }
  );

  // TC-07: ROSÉ Bruno Mars APT (Bẫy chữ É trong ROSÉ và từ "của" trên YouTube)
  const meta07 = await resolveAppleMusicMetadata('ROSÉ & Bruno Mars - APT. (Official Music Video)', 'ROSÉ');
  const reg07 = detectTrackRegion('ROSÉ & Bruno Mars - APT. (Official Music Video)', 'ROSÉ');
  const subs07 = getRankedSubtitleTracks({
    vi: [{ ext: 'json3', url: 'https://yt.com/vi' }],
    en: [{ ext: 'json3', url: 'https://yt.com/en' }]
  }, { rawTitle: 'APT.', videoTitle: 'APT.', uploader: 'ROSÉ' });
  const isViBlocked07 = !subs07.some(s => s[0]?.url.includes('/vi'));
  assertTest('TC-07', 'ROSÉ Bruno Mars APT (Bẫy dấu É trong ROSÉ)',
    meta07?.region !== 'VI' && reg07 !== 'VI' && isViBlocked07,
    `AppleRegion=${meta07?.region}, detectTrackRegion=${reg07}, Đã chặn CC tiếng Việt: ${isViBlocked07}`,
    { meta07, reg07, isViBlocked07 }
  );

  // TC-08: ILLIT Magnetic & aespa Supernova (K-Pop)
  const reg08a = detectTrackRegion('ILLIT - Magnetic (Official MV)', 'HYBE LABELS');
  const reg08b = detectTrackRegion('aespa - Supernova (Official Video)', 'SMTOWN');
  assertTest('TC-08', 'ILLIT Magnetic & aespa Supernova',
    reg08a === 'KR' && reg08b === 'KR',
    `Khóa vùng K-Pop chuẩn: ILLIT=${reg08a}, aespa=${reg08b}`,
    { reg08a, reg08b }
  );

  // TC-09: YOASOBI Idol (J-Pop dính chữ tượng hình Kanji)
  const reg09 = detectTrackRegion('YOASOBI「アイドル」(Idol) Official Music Video', 'Ayase / YOASOBI');
  assertTest('TC-09', 'YOASOBI Idol (Không bị nhận nhầm sang CN)',
    reg09 === 'JP',
    `Nhận diện vùng J-Pop: detectTrackRegion=${reg09}`,
    { reg09 }
  );

  // TC-10: Taylor Swift Teardrops On My Guitar (Bẫy chữ Guitar trong tên gốc)
  const penalty10 = evaluateVariantPenalty(
    'Taylor Swift - Teardrops On My Guitar (Official Music Video)',
    normalizeVi('Taylor Swift - Teardrops On My Guitar (Official Music Video)'),
    'taylor swift',
    'taylor swift teardrops on my guitar',
    normalizeVi('taylor swift teardrops on my guitar'),
    'official'
  );
  assertTest('TC-10', 'Taylor Swift Teardrops On My Guitar',
    penalty10.penalty === 0 && !penalty10.isUnrequestedVariant,
    `Miễn trừ phạt biến thể cho bài gốc: Penalty=${penalty10.penalty}, isUnrequestedVariant=${penalty10.isUnrequestedVariant}`,
    penalty10
  );

  // TC-10b: Billy Joel Piano Man (Bẫy chữ Piano trong tên gốc)
  const penalty10b = evaluateVariantPenalty(
    'Billy Joel - Piano Man (Official Audio)',
    normalizeVi('Billy Joel - Piano Man (Official Audio)'),
    'billy joel',
    'billy joel piano man',
    normalizeVi('billy joel piano man'),
    'official'
  );
  assertTest('TC-10b', 'Billy Joel Piano Man',
    penalty10b.penalty === 0 && !penalty10b.isUnrequestedVariant,
    `Miễn trừ phạt biến thể cho bài gốc: Penalty=${penalty10b.penalty}`,
    penalty10b
  );

  // -----------------------------------------------------------------------------------------
  // NHÓM 3: CHẶN BIẾN THỂ NHẠC CỤ (PIANO / GUITAR / ACOUSTIC / COVER / LIVE)
  // -----------------------------------------------------------------------------------------
  console.log('\n--- ĐANG CHẠY NHÓM 3: Chặn Biến Thể Nhạc Cụ & Phạt Điểm ---');

  // TC-11: Tinh Minh La Ki Lil Z Poet (Khi người dùng KHÔNG gõ chữ piano)
  const tracks11 = [
    { title: 'Lil Z Poet - TÌNH MÌNH LẠ KÌ (ver.PIANO) | Official Video', views: 8000000, duration: '3:45' },
    { title: 'Lil Z Poet - TÌNH MÌNH LẠ KÌ (Official Audio)', views: 2000000, duration: '3:30' }
  ];
  const ranked11 = rankAndFilterTracks(tracks11, 'Tinh Minh La Ki Lil Z Poet', 'official');
  assertTest('TC-11', 'Tinh Minh La Ki Lil Z Poet (Bản Audio gốc xếp #1)',
    ranked11[0].title.includes('Official Audio') && ranked11[0].score > ranked11[1].score,
    `Bản gốc đứng #1 (${ranked11[0].score}đ), Bản ver.PIANO bị phạt xếp sau (${ranked11[1].score}đ)`,
    ranked11
  );

  // TC-12: Tinh Minh La Ki Lil Z Poet piano (Khi người dùng CHỦ ĐỘNG gõ chữ piano)
  const ranked12 = rankAndFilterTracks(tracks11, 'Tinh Minh La Ki Lil Z Poet piano', 'official');
  assertTest('TC-12', 'Tinh Minh La Ki Lil Z Poet piano (Chủ động chọn bản piano)',
    ranked12[0].title.includes('ver.PIANO'),
    `Phát đúng bản piano theo ý người dùng: Top 1="${ranked12[0].title}" (${ranked12[0].score}đ)`,
    ranked12
  );

  // TC-13: Hen Mot Mai Bui Anh Tuan (Phạt bản Cover Live phòng trà)
  const tracks13 = [
    { title: 'Hẹn Một Mai - Cover Live Acoustic Phòng Trà', views: 20000000, duration: '4:10' },
    { title: 'Bùi Anh Tuấn - Hẹn Một Mai (Official MV)', views: 5000000, duration: '4:05' }
  ];
  const ranked13 = rankAndFilterTracks(tracks13, 'Hen Mot Mai Bui Anh Tuan', 'official');
  assertTest('TC-13', 'Hen Mot Mai Bui Anh Tuan (Thắng áp lực 20M views)',
    ranked13[0].title.includes('Official MV'),
    `Bản Official MV gốc xếp #1 (${ranked13[0].score}đ) vượt qua bản Cover 20M view (${ranked13[1].score}đ)`,
    ranked13
  );

  // TC-14: Nang Tho Hoang Dung (Chặn bản Karaoke Beat Chuẩn)
  const tracks14 = [
    { title: 'Nàng Thơ - Karaoke Beat Chuẩn Tone Nam', views: 15000000, duration: '4:15' },
    { title: 'Hoàng Dũng - Nàng Thơ (Official MV)', views: 8000000, duration: '4:12' }
  ];
  const ranked14 = rankAndFilterTracks(tracks14, 'Nang Tho Hoang Dung', 'official');
  assertTest('TC-14', 'Nang Tho Hoang Dung (Chặn Karaoke)',
    ranked14[0].title.includes('Official MV'),
    `Bản Official MV đứng đầu (${ranked14[0].score}đ), Bản Karaoke bị phạt tụt hậu (${ranked14[1].score}đ)`,
    ranked14
  );

  // -----------------------------------------------------------------------------------------
  // NHÓM 4: AUTOPLAY CHUYỂN BÀI & LỜI BÀI HÁT NÂNG CAO
  // -----------------------------------------------------------------------------------------
  console.log('\n--- ĐANG CHẠY NHÓM 4: Autoplay Chuyển Bài & Lời Bài Hát Nâng Cao ---');

  // TC-15: Chặn bài chữ Hán 潮汐 (Cháo Xī) và chống lặp bài Thủy Triều
  const blocked15 = isCandidateMatchingRegion(
    { title: '潮汐', artist: '安苏羽', duration: '2:49', seconds: 169 },
    'VI',
    { realTitle: 'Thủy Triều', realArtist: 'Quang Hùng MasterD' }
  );
  const fallback15 = await buildAutoplayFallbackQueries(
    { title: 'Quang Hung MasterD - Thuy Trieu', artist: 'Quang Hung MasterD' },
    'VI',
    { realTitle: 'Thủy Triều', realArtist: 'Quang Hùng MasterD', appleArtistId: 1483574844 }
  );
  const normOldTitle = normalizeVi('Thuy Trieu');
  const isDupeOldTitle = fallback15.some(q => normalizeVi(q).includes(normOldTitle));
  assertTest('TC-15', 'Autoplay Thủy Triều (Chặn 潮汐 & Chống lặp bài cũ)',
    !blocked15 && !isDupeOldTitle,
    `Đã chặn đứng 100% bài 潮汐 (${!blocked15}), Không lặp lại bài cũ: [${fallback15.slice(0, 2).join(' | ')}]`,
    { blocked15, isDupeOldTitle, fallback15 }
  );

  // TC-16: W/n 3107 3 (Không biến đổi số 3 thành "ba")
  const numVars16 = generateVietnameseNumberVariants('W/n - 3107 3');
  const isMutated16 = numVars16.some(v => v.includes('3107 ba') || v.includes('ba mươi'));
  assertTest('TC-16', 'W/n 3107 3 (Bảo toàn số 3)',
    !isMutated16,
    `Giữ nguyên định dạng số 3 trong seri 3107: [${numVars16.join(', ')}]`,
    numVars16
  );

  // TC-17: SponsorBlock Intro Skip (Son Tung Chung Ta Cua Hien Tai)
  const meta17 = analyzeTrackOriginAndMeta({ title: 'Sơn Tùng M-TP - Chúng Ta Của Hiện Tại (Official Music Video)' });
  assertTest('TC-17', 'Sơn Tùng Chúng Ta Của Hiện Tại',
    meta17.region === 'VI',
    `Metadata sẵn sàng cho SponsorBlock kiểm tra intro kịch, Region=${meta17.region}`,
    meta17
  );

  // TC-18: Tăng Duy Tân Cắt Đôi Nỗi Sầu Remix (Giữ nguyên vibe Remix)
  const meta18 = analyzeTrackOriginAndMeta({ title: 'Tăng Duy Tân - Cắt Đôi Nỗi Sầu (Darrys Remix Vinahouse)' });
  const fallback18 = await buildAutoplayFallbackQueries(
    { title: 'Tăng Duy Tân - Cắt Đôi Nỗi Sầu (Darrys Remix Vinahouse)', artist: 'Tăng Duy Tân' },
    'VI',
    meta18
  );
  const hasRemix18 = fallback18.some(q => /remix|vinahouse/i.test(q));
  assertTest('TC-18', 'Tăng Duy Tân Cắt Đôi Nỗi Sầu Remix (Giữ vibe Vinahouse)',
    meta18.isRemix && hasRemix18,
    `Nhận diện isRemix=${meta18.isRemix}, Fallback queries giữ nguyên nhịp bay: [${fallback18.slice(0, 2).join(' | ')}]`,
    { meta18, fallback18 }
  );

  // TC-19: Ren Ran - Phi Điểu Và Ve Sầu (C-Pop tên phiên âm Hán-Việt)
  const reg19 = detectTrackRegion('Ren Ran - Phi Điểu Và Ve Sầu', 'Ren Ran');
  const blocked19InVi = isCandidateMatchingRegion(
    { title: 'Ren Ran - Phi Điểu Và Ve Sầu', artist: 'Ren Ran', seconds: 240 },
    'VI',
    { realTitle: 'Nàng Thơ', realArtist: 'Hoàng Dũng' }
  );
  assertTest('TC-19', 'Ren Ran - Phi Điểu Và Ve Sầu (C-Pop phiên âm)',
    reg19 === 'CN' && !blocked19InVi,
    `Nhận diện vùng CN=${reg19}, Đã chặn trong luồng V-Pop: ${!blocked19InVi}`,
    { reg19, blocked19InVi }
  );

  // -----------------------------------------------------------------------------------------
  // TỔNG HỢP VÀ KẾT LUẬN
  // -----------------------------------------------------------------------------------------
  console.log('\n======================================================================');
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  console.log(`KẾT QUẢ ĐO KIỂM BLIND TEST: ${passCount}/${results.length} PASS - ${failCount} FAIL`);
  console.log('======================================================================');

  if (failCount > 0) {
    console.error('CẢNH BÁO: Còn testcase thất bại! Cần rà soát lại.');
    process.exit(1);
  } else {
    console.log('XÁC NHẬN: Hệ thống đã vượt qua 100% tất cả 20+ testcases hiểm hóc nhất!');
    process.exit(0);
  }
}

runBlindSuite().catch(err => {
  console.error('Test Runner Error:', err);
  process.exit(1);
});
