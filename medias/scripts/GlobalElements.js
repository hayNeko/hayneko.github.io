// /medias/scripts/GlobalComponents.js

(function() {
	const components = {
		header: `
			<header class="body_header">
				<a href="/index.html" class="body_header_anchor not-link">
					<img class="body_header_logo protected-media" src="/medias/picures/avatarMikuHatsune.jpg" alt="Hayneko's blog" />
					<h1 class="body_header_title" data-i18n="title">Hayneko's blog</h1>
				</a>
				<button class="body_header_menu_login-button" id="body_header_menu_login-button" data-i18n="login" onclick="javascript:alert(' Login feature is not available yet \\n 登录功能尚未开放 \\n 登錄功能尚未開放 \\n ログイン機能はまだご利用いただけません \\n 로그인 기능은 아직 사용할 수 없습니다');">Login</button>
			</header>
		`, // ToggleMenu('dock_menu_header_login-menu');

		footer: `
			<footer class="body_footer">
				<p class="body_footer_text" data-i18n="body_footer_text-0">Hayneko. Created on Jan 10, 2026.</p>
				<p class="body_footer_text" data-i18n="body_footer_text-1">This site has been refactored 4 times.</p>
				<p class="body_footer_text" data-i18n="body_footer_text-translation_disclaimer">This site is translated into multiple languages, but the translations may not be accurate. Please refer to the original English/Chinese version for the most accurate information.</p>
				<a href="https://github.com/hayNeko" target="_blank" class="body_footer_link"><i class="fa-brands fa-github"></i>GitHub</a>
			</footer>
		`,

		dockMenus: `
			<div class="dock_menus">
				<div class="dock_contact-menu" id="dock_contact">
					<div class="dock_menu_header"><i class="fa-solid fa-comment"></i><span data-i18n="contact">Contact</span></div>
					<menu class="dock_menu_content">
						<li class="dock_menu_option" onclick="javascript:HandleDockClickEvent_Contact_Via('https:\\/\\/github.com/hayNeko');"><i class="fa-brands fa-github"></i><span data-i18n="contact-via-github">Contact me via GitHub</span></li>
						<li class="dock_menu_option" onclick="javascript:HandleDockClickEvent_Contact_Via('https:\\/\\/www.instagram.com/hayneko_dword/');"><i class="fa-brands fa-instagram"></i><span data-i18n="contact-via-instagram">Contact me via Instagram</span></li>
					</menu>
				</div>
				<div class="dock_language-menu" id="dock_language">
					<div class="dock_menu_header"><i class="fa-solid fa-globe"></i><span data-i18n="language">Language</span></div>
					<menu class="dock_menu_content">
						<li class="dock_menu_option" onclick="javascript:SetLanguage('en');window.location.reload();"><span>English</span><i class="fa-solid fa-check check-icon"></i></li>
						<li class="dock_menu_option" onclick="javascript:SetLanguage('zh-CN');window.location.reload();"><span>中文(简体)</span><i class="fa-solid fa-check check-icon"></i></li>
						<li class="dock_menu_option" onclick="javascript:SetLanguage('zh-TW');window.location.reload();"><span>中文(繁體)</span><i class="fa-solid fa-check check-icon"></i></li>
						<li class="dock_menu_option" onclick="javascript:SetLanguage('ja');window.location.reload();"><span>日本語</span><i class="fa-solid fa-check check-icon"></i></li>
						<li class="dock_menu_option" onclick="javascript:SetLanguage('ko');window.location.reload();"><span>한국어</span><i class="fa-solid fa-check check-icon"></i></li>
					</menu>
				</div>
				<div class="dock_search-menu" id="dock_search">
					<div class="dock_menu_header"><i class="fa-solid fa-magnifying-glass"></i><span data-i18n="search">Search</span></div>
					<menu class="dock_menu_content">
						<li><input id="dock_menu_search_input" type="text" placeholder="Search..." disabled style="cursor:not-allowed;"></li>
						<li><button data-i18n="search" disabled style="cursor:not-allowed;">Search (Not Available Yet)</button></li>
					</menu>
				</div>
				<div class="dock_tools-menu" id="dock_tools">
					<div class="dock_menu_header"><i class="fa-solid fa-wrench"></i><span data-i18n="tools">Tools</span></div>
					<div class="dock_menu_content">
						<div class="dock_tools_section">
							<h3 class="dock_tools_title" data-i18n="simulation">Simulation</h3>
							<ul class="dock_tools_list">
								<li><a href="/pages/physics-sim/phy-default/" target="_blank" class="not-link" data-i18n="physics-simulation">Physics Simulation</a></li>
								<li><a href="/pages/physics-sim/phy-ntlaw2/" target="_blank" class="not-link" data-i18n="physics-simulation-newton-second-law">Physics Simulation (Newton Second Law)</a></li>
								<li><a href="/pages/physics-sim/phy-lens/" target="_blank" class="not-link" data-i18n="physics-simulation-lens">Physics Simulation (Lens)</a></li>
							</ul>
							<h3 class="dock_tools_title" data-i18n="docs">Useful Docs</h3>
							<ul class="dock_tools_list">
								<li><a href="/medias/i386.pdf" target="_blank" class="not-link" data-i18n="docs-i386">INTEL 80386 MANUAL 1986</a></li>
							</ul>
						</div>
					</div>
				</div>
				<div class="dock_friendly-links-menu" id="dock_friendly-links">
					<div class="dock_menu_header"><i class="fa-solid fa-link"></i><span data-i18n="friendly-links">Friendly Links</span></div>
					<menu class="dock_menu_content"><li><p data-i18n="no-friendly-link">No friendly links available.</p></li></menu>
				</div>
			</div>
		`,

		dock: `
			<nav class="dock">
				<figure class="dock_avatar" id="avatar" onclick="javascript:HandleDockClickEvent_EmmitParticle();">
					<img src="/medias/picures/avatarMikuHatsune.jpg" alt="Hayneko's blog" class="protected-media">
				</figure>
				<p class="dock_boxes" id="home" data-i18n-tooltip="home" onclick="javascript:HandleDockClickEvent_Home();"><i class="fa-solid fa-house"></i></p>
				<p class="dock_boxes" id="album" data-i18n-tooltip="album" onclick="javascript:HandleDockClickEvent_Album();"><i class="fa-solid fa-image"></i></p>
				<p class="dock_boxes" id="storage" data-i18n-tooltip="storage" onclick="javascript:HandleDockClickEvent_Storage();"><i class="fa-solid fa-box-archive"></i></p>
				<p class="dock_boxes" id="friendly-links" data-i18n-tooltip="friendly-links" onclick="javascript:HandleDockClickEvent_FriendlyLinks(event);"><i class="fa-solid fa-link"></i></p>
				<p class="dock_boxes" id="projects" data-i18n-tooltip="projects" onclick="javascript:HandleDockClickEvent_Projects();"><i class="fa-solid fa-code"></i></p>
				<p class="dock_boxes" id="contact" data-i18n-tooltip="contact" onclick="javascript:HandleDockClickEvent_Contact(event);"><i class="fa-solid fa-comment"></i></p>
				<p class="dock_boxes" id="language" data-i18n-tooltip="language" onclick="javascript:HandleDockClickEvent_Language(event);"><i class="fa-solid fa-globe"></i></p>
				<p class="dock_boxes" id="theme" data-i18n-tooltip="switch-theme" onclick="javascript:HandleDockClickEvent_Theme();"><i class="fa-solid fa-moon"></i></p>
				<p class="dock_boxes" id="search" data-i18n-tooltip="search" onclick="javascript:HandleDockClickEvent_Search(event);"><i class="fa-solid fa-magnifying-glass"></i></p>
				<p class="dock_boxes" id="tools" data-i18n-tooltip="tools" onclick="javascript:HandleDockClickEvent_Tools(event);"><i class="fa-solid fa-wrench"></i></p>
			</nav>
		`
	};

	// 注入函数
	function injectComponents() {
		const body = document.body;
		const main = document.querySelector('main');

		// 插入 Header 到 body 最前面
		body.insertAdjacentHTML('afterbegin', components.header);


		// 插入 Footer、Dock Menus 和 Dock 到 body 最后面
		body.insertAdjacentHTML('beforeend', components.footer);
		body.insertAdjacentHTML('beforeend', components.dockMenus);
		body.insertAdjacentHTML('beforeend', components.dock);
	}

	// 立即执行注入
	injectComponents();
})();

// Global variables
let leaveMessage = "Miku! ";
let originalTitle = "Hayneko's blog";

// Initialize on page load
document.addEventListener("visibilitychange", function () {
	if (document.hidden) {
		document.title = " (>_<) " + leaveMessage + originalTitle;
	} else {
		document.title = originalTitle;
	}
});

document.addEventListener('DOMContentLoaded', async function() {
	// 初始化语言系统
	if (window.InitializeLanguageSystem) {
		await InitializeLanguageSystem();
		
		// 获取当前语言的离开消息
		if (window.LanguageManager && window.LanguageManager.GetCurrentLanguageData) {
			const langData = LanguageManager.GetCurrentLanguageData();
			leaveMessage = langData.translations['title_leave-message'] || "Miku! ";
			originalTitle = langData.translations['title'] || originalTitle;
		}
	}
	
	// 延迟初始化菜单系统
	setTimeout(() => {
		if (window.InitializeMenuSystem) {
			InitializeMenuSystem();
		}
	}, 100);
});