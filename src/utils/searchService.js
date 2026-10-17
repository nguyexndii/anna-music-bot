const { Worker } = require('worker_threads');
const path = require('path');

// ─── 1. IN-MEMORY LRU SEARCH CACHE (Tối đa 200 từ khóa, TTL 15 phút) ─────────
const searchCache = new Map();
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCachedResults(cacheKey) {
  const cached = searchCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.time > CACHE_TTL_MS) {
    searchCache.delete(cacheKey);
    return null;
  }
  return cached.results;
}

function setCachedResults(cacheKey, results) {
  if (searchCache.size >= CACHE_MAX_SIZE) {
    // Xóa mục cũ nhất
    const firstKey = searchCache.keys().next().value;
    if (firstKey) searchCache.delete(firstKey);
  }
  searchCache.set(cacheKey, { time: Date.now(), results });
}

// ─── 2. IN-FLIGHT REQUEST COALESCING (Gộp các truy vấn trùng lặp) ─────────────
const inFlightSearches = new Map();

// ─── 3. CONCURRENCY LIMITER (Tối đa 2 tác vụ search chạy đồng thời) ───────────
const MAX_CONCURRENT_SEARCHES = 2;
let activeSearchesCount = 0;
const searchQueue = [];

function processNextInQueue() {
  if (activeSearchesCount >= MAX_CONCURRENT_SEARCHES || searchQueue.length === 0) {
    return;
  }
  const nextTask = searchQueue.shift();
  if (nextTask) {
    activeSearchesCount++;
    nextTask.run().finally(() => {
      activeSearchesCount--;
      processNextInQueue();
    });
  }
}

function enqueueSearch(runFn) {
  return new Promise((resolve, reject) => {
    searchQueue.push({
      run: async () => {
        try {
          const res = await runFn();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      }
    });
    processNextInQueue();
  });
}

// ─── 4. PERSISTENT WORKER THREAD MANAGER (Tự phục hồi nếu crash) ──────────────
let worker = null;
let currentTaskId = 0;
const pendingCallbacks = new Map();

function initWorker() {
  try {
    const workerScript = path.join(__dirname, 'searchWorker.js');
    worker = new Worker(workerScript);

    worker.on('message', (msg) => {
      const { id, results, alternateResults, alternateMode, query: workerQuery, limit: workerLimit, locale: workerLocale, error } = msg;
      const callback = pendingCallbacks.get(id);
      if (callback) {
        pendingCallbacks.delete(id);
        if (error) {
          callback.resolve([]);
        } else {
          // Lưu song song cả 2 chế độ vào bộ nhớ đệm RAM để đổi mode tức thì 0ms
          if (workerQuery) {
            const cleanQ = workerQuery.toLowerCase().trim();
            const curMode = callback.mode || 'official';
            const lim = workerLimit || 20;
            const loc = workerLocale || 'vi';

            if (Array.isArray(results) && results.length > 0) {
              setCachedResults(`${cleanQ}|${curMode}|${lim}`, results);
              setCachedResults(`${cleanQ}|${curMode}|${lim}|${loc}`, results);
            }
            if (Array.isArray(alternateResults) && alternateResults.length > 0 && alternateMode) {
              setCachedResults(`${cleanQ}|${alternateMode}|${lim}`, alternateResults);
              setCachedResults(`${cleanQ}|${alternateMode}|${lim}|${loc}`, alternateResults);
            }
          }
          callback.resolve(results || []);
        }
      }
    });

    worker.on('error', (err) => {
      console.warn('[SearchWorker Error]:', err.message);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[SearchWorker Notice] Worker thread thoát với mã ${code}. Đang tự động khởi động lại...`);
      }
      // Reject tất cả callback đang đợi
      for (const [id, cb] of pendingCallbacks.entries()) {
        cb.resolve([]);
      }
      pendingCallbacks.clear();
      worker = null;
      // Khởi động lại worker mới
      setTimeout(() => initWorker(), 500);
    });
  } catch (err) {
    console.error('[SearchWorker Init Error]:', err);
    worker = null;
  }
}

// Khởi tạo worker ngay khi nạp module
initWorker();

/**
 * Gửi yêu cầu tìm kiếm sang Worker Thread
 */
function sendToWorker(query, limit, mode, locale = 'vi') {
  return new Promise((resolve) => {
    if (!worker) {
      initWorker();
    }
    if (!worker) {
      return resolve([]);
    }

    const taskId = ++currentTaskId;
    const timeout = setTimeout(() => {
      if (pendingCallbacks.has(taskId)) {
        pendingCallbacks.delete(taskId);
        resolve([]);
      }
    }, 6500);

    pendingCallbacks.set(taskId, {
      mode,
      resolve: (results) => {
        clearTimeout(timeout);
        resolve(results);
      }
    });

    try {
      worker.postMessage({ id: taskId, query, limit, mode, locale });
    } catch (e) {
      clearTimeout(timeout);
      pendingCallbacks.delete(taskId);
      resolve([]);
    }
  });
}

/**
 * Hàm điều phối Tìm kiếm chính: Kiểm tra Cache -> Gộp Request -> Hàng đợi Concurrency -> Worker Thread
 */
async function executeSearch(query, limit = 20, mode = 'official', locale = 'vi') {
  if (!query || typeof query !== 'string') return [];
  const cleanQuery = query.trim().slice(0, 150);
  if (cleanQuery.length < 2 || cleanQuery.startsWith('-')) return [];

  const cacheKeyWithLocale = `${cleanQuery.toLowerCase()}|${mode}|${limit}|${locale}`;
  const cacheKeyGeneric = `${cleanQuery.toLowerCase()}|${mode}|${limit}`;

  // 1. Kiểm tra RAM Cache (0ms)
  const cached = getCachedResults(cacheKeyWithLocale) || getCachedResults(cacheKeyGeneric);
  if (cached) {
    return cached;
  }

  // 2. Request Coalescing (dùng chung Promise nếu đang có truy vấn giống hệt chạy)
  if (inFlightSearches.has(cacheKeyWithLocale)) {
    try {
      return await inFlightSearches.get(cacheKeyWithLocale);
    } catch (e) {
      return [];
    }
  }

  // 3. Thực thi qua Concurrency Limiter & Worker Thread
  const searchPromise = (async () => {
    try {
      const results = await enqueueSearch(() => sendToWorker(cleanQuery, limit, mode, locale));
      if (Array.isArray(results) && results.length > 0) {
        setCachedResults(cacheKeyWithLocale, results);
        setCachedResults(cacheKeyGeneric, results);
      }
      return results || [];
    } finally {
      inFlightSearches.delete(cacheKeyWithLocale);
    }
  })();

  inFlightSearches.set(cacheKeyWithLocale, searchPromise);

  try {
    return await searchPromise;
  } catch (err) {
    return [];
  }
}

module.exports = {
  executeSearch
};
