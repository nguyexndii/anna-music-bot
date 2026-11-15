(function() {
  const WORD_ANNA = 'Anna';
  const WORD_MUSIC = 'Music';
  const avatarBox = document.getElementById('avatarBox');
  const txtAnna = document.getElementById('txtAnna');
  const txtSpace = document.getElementById('txtSpace');
  const txtMusic = document.getElementById('txtMusic');
  const cursor = document.getElementById('typeCursor');

  let typeInterval = null;
  let isPlaying = false;

  function playTypewriter() {
    if (!avatarBox || !txtAnna || !txtMusic || !cursor) return;
    if (isPlaying) return;
    isPlaying = true;

    clearInterval(typeInterval);
    txtAnna.textContent = '';
    txtSpace.textContent = '';
    txtMusic.textContent = '';
    avatarBox.style.opacity = '0';
    avatarBox.style.transform = 'scale(0.65)';
    cursor.style.opacity = '0';

    // 1. Avatar pop-in dứt khoát
    avatarBox.animate([
      { opacity: 0, transform: 'scale(0.6) translateY(6px)' },
      { opacity: 1, transform: 'scale(1.02) translateY(-1px)', offset: 0.75 },
      { opacity: 1, transform: 'scale(1) translateY(0)' }
    ], {
      duration: 450,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards'
    });

    // 2. Cursor xuất hiện đúng vị trí
    setTimeout(() => {
      if (!cursor) return;
      cursor.style.opacity = '1';

      // 3. Gõ từng chữ "Anna"
      let annaIdx = 0;
      typeInterval = setInterval(() => {
        if (!txtAnna) { clearInterval(typeInterval); return; }
        if (annaIdx < WORD_ANNA.length) {
          txtAnna.textContent += WORD_ANNA[annaIdx];
          annaIdx++;
        } else {
          clearInterval(typeInterval);
          if (txtSpace) txtSpace.textContent = ' ';

          // 4. Nghỉ nhịp gõ rồi gõ tiếp "Music"
          setTimeout(() => {
            let musicIdx = 0;
            typeInterval = setInterval(() => {
              if (!txtMusic) { clearInterval(typeInterval); return; }
              if (musicIdx < WORD_MUSIC.length) {
                txtMusic.textContent += WORD_MUSIC[musicIdx];
                musicIdx++;
              } else {
                clearInterval(typeInterval);
                isPlaying = false;
              }
            }, 85);
          }, 120);
        }
      }, 90);
    }, 360);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(playTypewriter, 100));
  } else {
    setTimeout(playTypewriter, 100);
  }
})();
