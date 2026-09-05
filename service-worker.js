// GitHub Pages Service Worker
// 缓存策略：
// 1) 静态资源（字体 / 图片 / Icon 以及 /medias/files/ 目录下的“文件”）→ 缓存优先
// 2) 其余内容（HTML/CSS/JS/接口等）→ 网络优先：用户访问时即时加载最新内容，
//    成功后写入“运行时缓存”；断网时回退到已访问缓存或离线页。
const APP_VERSION = '2.1.0';

// 静态资源缓存：体积大、几乎不变，采用缓存优先
const STATIC_CACHE = `hayneko-static-${APP_VERSION}`;
// 运行时缓存：仅在用户访问过后才写入，用于离线回退
const RUNTIME_CACHE = `hayneko-runtime-${APP_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

const OFFLINE_URL = '/offline.html';

// 需要缓存的静态资源后缀：字体、图片、Icon（不含 JS/脚本，JS 归入“其余”按网络优先）
const STATIC_EXT_PATTERN = /\.(ttf|otf|woff|woff2|eot|jpg|jpeg|png|gif|webp|svg|ico|avif|bmp)$/i;
// medias/files 目录整体视为“文件”，不限后缀，一律按静态资源缓存
const FILES_DIR_PATTERN = /\/medias\/files\//i;

/* ---------------- 缓存策略辅助函数 ---------------- */

// 缓存优先：命中缓存直接返回；未命中才请求网络并写入缓存
async function cacheFirst(request, cacheName) {
	try {
		const cache = await caches.open(cacheName);
		const cached = await cache.match(request);
		if (cached) {
			return cached;
		}
		const response = await fetch(request);
		// 仅缓存成功的有效响应；写入失败不影响本次返回
		if (response && response.ok) {
			cache.put(request, response.clone()).catch(() => {});
		}
		return response;
	} catch (err) {
		// 缓存异常时退化为直接请求网络
		try {
			return await fetch(request);
		} catch (e) {
			return new Response('Resource not available', { status: 503 });
		}
	}
}

// 网络优先：用户访问时在线获取最新内容并写入运行时缓存；
// 网络失败时回退到已访问的缓存，页面导航最终回退到离线页。
async function networkFirst(request) {
	let cache = null;
	try {
		cache = await caches.open(RUNTIME_CACHE);
	} catch (err) {
		// 缓存不可用时仍正常访问网络
	}
	try {
		const response = await fetch(request);
		// 成功后写入缓存，供下次离线访问；写入失败不影响本次返回
		if (response && response.ok && cache) {
			cache.put(request, response.clone()).catch(() => {});
		}
		return response;
	} catch (err) {
		if (cache) {
			const cached = await cache.match(request).catch(() => null);
			if (cached) {
				return cached;
			}
		}
		// 页面导航断网时返回预缓存的离线页
		if (request.mode === 'navigate') {
			const offline = await caches.match(OFFLINE_URL).catch(() => null);
			if (offline) {
				return offline;
			}
		}
		return new Response('Network error', { status: 503 });
	}
}

/* ---------------- 生命周期 ---------------- */

self.addEventListener('install', (event) => {
	console.log('[Service Worker] Installing version:', APP_VERSION);
	// 仅预缓存离线页面，其余内容在用户访问时才加载并缓存
	event.waitUntil(
		caches.open(RUNTIME_CACHE).then((cache) => {
			console.log('[Service Worker] Caching offline page');
			return cache.add(OFFLINE_URL);
		}).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	console.log('[Service Worker] Activating version:', APP_VERSION);
	event.waitUntil(
		Promise.all([
			// 清理旧版本 / 不再使用的缓存
			caches.keys().then(cacheNames => {
				return Promise.all(
					cacheNames.map(cacheName => {
						if (!CURRENT_CACHES.includes(cacheName)) {
							console.log('[Service Worker] Deleting old cache:', cacheName);
							return caches.delete(cacheName);
						}
					})
				);
			}),
			self.clients.claim()
		])
	);
});

/* ---------------- 请求拦截 ---------------- */

self.addEventListener('fetch', (event) => {
	const { request } = event;

	// 仅拦截 GET 与 HTTP(S) 请求，其余（含浏览器扩展）直接放行
	if (request.method !== 'GET' || !request.url.startsWith('http')) {
		return;
	}

	const url = new URL(request.url);
	if (url.hostname === 'extensions' || url.protocol === 'chrome-extension:') {
		return;
	}

	// 1) 静态资源（字体 / 图片 / medias/files 目录）：缓存优先
	const isStatic =
		STATIC_EXT_PATTERN.test(url.pathname) || FILES_DIR_PATTERN.test(url.pathname);

	if (isStatic) {
		event.respondWith(cacheFirst(request, STATIC_CACHE));
		return;
	}

	// 2) 其余资源（HTML/CSS/JS/接口等）：网络优先，访问成功后写入缓存
	event.respondWith(networkFirst(request));
});

// 接收客户端消息以手动更新或清理缓存
self.addEventListener('message', (event) => {
	if (event.data.action === 'skipWaiting') {
		self.skipWaiting();
	}
	if (event.data.action === 'clearCache') {
		caches.keys().then(cacheNames => {
			Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
		});
	}
});