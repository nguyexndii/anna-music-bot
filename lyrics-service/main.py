import re
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Anna Music - Lyrics Fallback Service", version="1.0.0")

# Chỉ mở CORS nội bộ cho Node.js server trên cùng VPS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1", "http://localhost", "http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

def parse_lrc(lrc_text: str) -> List[Dict[str, Any]]:
    """
    Phân tích cú pháp chuỗi .lrc thành mảng [{time, time_ms, text}, ...]
    Khớp định dạng chuẩn với hàm parseLrc bên lyricsHelper.js
    """
    if not lrc_text or not isinstance(lrc_text, str):
        return []
    result = []
    pattern = re.compile(r'\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)')
    for line in lrc_text.splitlines():
        m = pattern.match(line)
        if m:
            minutes = int(m.group(1))
            seconds = int(m.group(2))
            ms_str = m.group(3) or "0"
            ms = int(ms_str.ljust(3, '0')[:3])
            time_ms = minutes * 60000 + seconds * 1000 + ms
            text = m.group(4).strip()
            if text:
                result.append({
                    "time": time_ms,
                    "time_ms": time_ms,
                    "text": text
                })
    return result

def extract_plain_text(lrc_text: str) -> str:
    """
    Trích xuất toàn bộ lời văn bản thuần (bỏ timestamp) từ chuỗi .lrc
    """
    if not lrc_text or not isinstance(lrc_text, str):
        return ""
    lines = []
    pattern = re.compile(r'\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*')
    for line in lrc_text.splitlines():
        cleaned = pattern.sub('', line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "anna-lyrics-fallback"}

@app.get("/lyrics")
def get_lyrics(
    title: str = Query(..., description="Tên bài hát cần tìm"),
    artist: Optional[str] = Query("", description="Tên nghệ sĩ / ca sĩ"),
    duration: Optional[int] = Query(None, description="Thời lượng bài hát tính theo giây")
):
    """
    Endpoint lấy lời bài hát đa nguồn qua thư viện syncedlyrics (Musixmatch, NetEase, Genius, LRCLIB...)
    """
    clean_title = title.strip() if title else ""
    clean_artist = artist.strip() if artist else ""

    if not clean_title:
        return {
            "success": False,
            "syncedLyrics": None,
            "plainLyrics": "",
            "source": "syncedlyrics",
            "error": "Thiếu tham số title"
        }

    search_query = f"{clean_title} {clean_artist}".strip()

    try:
        import syncedlyrics

        # Tìm kiếm lời nhạc đa nguồn (cho phép trả về cả plain format nếu không có synced)
        lrc_content = syncedlyrics.search(search_query, allow_plain_format=True)
        if not lrc_content:
            return {
                "success": False,
                "syncedLyrics": None,
                "plainLyrics": "",
                "source": "syncedlyrics"
            }

        synced = parse_lrc(lrc_content)
        plain = extract_plain_text(lrc_content) if synced else lrc_content.strip()

        return {
            "success": True,
            "syncedLyrics": synced if len(synced) > 0 else None,
            "plainLyrics": plain,
            "source": "syncedlyrics"
        }
    except Exception as e:
        return {
            "success": False,
            "syncedLyrics": None,
            "plainLyrics": "",
            "source": "syncedlyrics",
            "error": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    # Chỉ bind 127.0.0.1, 1 worker siêu nhẹ dành riêng cho VPS 2GB RAM
    uvicorn.run("main:app", host="127.0.0.1", port=8787, workers=1)
