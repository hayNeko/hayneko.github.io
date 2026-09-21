#!/usr/bin/env node
/**
 * check-i18n.mjs — 校验 HTML 里的 i18n-key 与各语言包是否一致
 *
 * 用法(无需依赖):  node scripts/check-i18n.mjs
 *
 * 检查内容:
 *   1. HTML 用到但某个语言包缺少的 key      → 错误(退出码 1)
 *   2. 各语言包之间 key 不一致              → 错误(退出码 1)
 *   3. key 里出现字面量点号(如 { "a.b": "x" } 而非 { a: { b: "x" } })
 *      —— 这种写法会被 collectKeys 拍平成 "a.b" 骗过检查 1, 但运行时的
 *      Internationalization.js#lookup 是按点号逐层下钻的, 实际取不到值 → 错误(退出码 1)
 *   4. 按运行时规则逐条解析, 结果不是字符串 → 错误(退出码 1)
 *   5. 各语言包里有、但 HTML 未使用的 key   → 提示(可能是 JS 动态使用的 key)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_DIR = join(ROOT, 'i18n');
/* archive/ 是历史归档(内含 dsh-terminal 旧站), 有自己的 i18n/, 不并入统计。
   prism-1.30.0 是第三方 vendor 目录。以 . 开头的目录(工作用临时目录)一并跳过。 */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.vscode', 'medias', 'archive', 'prism-1.30.0']);
const KEY_RE = /i18n-key\s*=\s*["']([^"']+)["']/g;

/** 递归收集文件 */
function walk(dir, filter, out = []) {
	for (const entry of readdirSync(dir)) {
		if (IGNORED_DIRS.has(entry) || entry.charAt(0) === '.') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, filter, out);
		else if (filter(entry)) out.push(full);
	}
	return out;
}

/** 把语言包拍平成点号路径的 key 集合(同时支持扁平键与嵌套对象) */
function collectKeys(obj, prefix = '', out = new Set()) {
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === 'object' && !Array.isArray(value)) collectKeys(value, path, out);
		else out.add(path);
	}
	return out;
}

/** 收集 HTML 中使用的 key(忽略 HTML 注释里的示例代码) */
function usedKeysInHtml() {
	const used = new Map(); // key -> 出现的文件
	for (const file of walk(ROOT, (name) => name.endsWith('.html'))) {
		const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
		for (const [, key] of html.matchAll(KEY_RE)) {
			if (!used.has(key)) used.set(key, new Set());
			used.get(key).add(relative(ROOT, file).replace(/\\/g, '/'));
		}
	}
	return used;
}

/**
 * 收集 JS 里以字符串形式引用的 key, 例如 i18n.t('contact.form.error.name')。
 * 这类 key 不在 HTML 里出现, 之前不会被校验 —— 漏翻译了也检查不出来。
 * 只认已知命名空间下的点号 key, 并且先剥掉注释, 避免误报。
 */
const KEY_NAMESPACES = /^(a11y|title|tab|header|nav|home|info|storage|lab|games|links|footer|dock|contact|gallery|tools|common|boot|toast)\./;
const JS_KEY_RE = /["']([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)["']/g;
/* 形如 contact.txt / about.md 的文件名会被上面的正则命中, 明确排除掉 */
const FILE_EXT_RE = /\.(txt|md|json|json5|mjs?|cjs|ts|css|html?|xml|ya?ml|toml|ini|hpp|hxx|h|c|cc|cpp|cs|java|py|rb|go|rs|sh|pdf|zip|gz|tar|jpe?g|png|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|map|log|dat|bin|exe|dll)$/i;

function usedKeysInJs() {
	const used = new Map();
	for (const file of walk(ROOT, (name) => name.endsWith('.js'))) {
		const src = readFileSync(file, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
		const rel = relative(ROOT, file).replace(/\\/g, '/');
		for (const [, key] of src.matchAll(JS_KEY_RE)) {
			if (!KEY_NAMESPACES.test(key) || FILE_EXT_RE.test(key)) continue;
			if (!used.has(key)) used.set(key, new Set());
			used.get(key).add(rel + ' (js)');
		}
	}
	return used;
}

/** HTML + JS 两处用到的 key 合并 */
function usedKeys() {
	const used = usedKeysInHtml();
	for (const [key, files] of usedKeysInJs()) {
		if (!used.has(key)) used.set(key, new Set());
		files.forEach((f) => used.get(key).add(f));
	}
	return used;
}

function loadPackages() {
	if (!existsSync(I18N_DIR)) {
		console.error(`✖ 找不到语言包目录: ${relative(ROOT, I18N_DIR)}`);
		process.exit(1);
	}
	return walk(I18N_DIR, (name) => name.endsWith('.json'))
		.map((file) => {
			const locale = relative(I18N_DIR, file).replace(/\.json$/i, '').replace(/\\/g, '/');
			try {
				const data = JSON.parse(readFileSync(file, 'utf8'));
				return { locale, file, data, keys: collectKeys(data) };
			} catch (err) {
				console.error(`✖ 语言包 JSON 解析失败: ${relative(ROOT, file)} — ${err.message}`);
				process.exit(1);
			}
		});
}

const used = usedKeys();
const packages = loadPackages();
let hasError = false;

console.log(`\n检查 ${used.size} 个 i18n-key / ${packages.length} 个语言包...\n`);

// 1. 缺失的 key
for (const { locale, keys } of packages) {
	const missing = [...used.keys()].filter((key) => !keys.has(key));
	if (missing.length) {
		hasError = true;
		console.error(`✖ [${locale}] 缺少 ${missing.length} 个翻译:`);
		for (const key of missing) console.error(`    ${key}  ← ${[...used.get(key)].join(', ')}`);
	} else {
		console.log(`✔ [${locale}] HTML 用到的 key 全部存在`);
	}
}

// 2. 语言包之间不一致
if (packages.length > 1) {
	const union = new Set(packages.flatMap((p) => [...p.keys]));
	for (const { locale, keys } of packages) {
		const onlyHere = [...union].filter((key) => !keys.has(key));
		const onlyOther = [...keys].filter((key) => packages.some((p) => !p.keys.has(key)));
		if (onlyHere.length || onlyOther.length) {
			hasError = true;
			console.error(`✖ [${locale}] 与其他语言包不一致:`);
			if (onlyHere.length) console.error(`    其他语言包有、这里没有: ${onlyHere.join(', ')}`);
			if (onlyOther.length) console.error(`    这里有、其他语言包没有: ${onlyOther.join(', ')}`);
		}
	}
}

// 3. key 里含字面量点号 —— 运行时 lookup 取不到
//    运行时是先 hasOwnProperty(messages, 整个key) 再逐层下钻,
//    所以 { "a.b": "x" } 既不是顶层键、也无法按 a -> b 下钻。
for (const { locale, keys } of packages) {
	const dotted = [...keys].filter((key) => key.split('.').some((segment) => segment.includes('.')));
	if (dotted.length) {
		hasError = true;
		console.error(`✖ [${locale}] ${dotted.length} 个 key 里含字面量点号(应写成嵌套对象):`);
		for (const key of dotted) console.error(`    ${key}`);
	}
}

// 4. 按运行时 lookup 规则逐条解析 HTML 用到的 key
function lookup(messages, key) {
	if (!messages || typeof key !== 'string' || !key) return undefined;
	if (Object.prototype.hasOwnProperty.call(messages, key)) return messages[key];
	if (key.indexOf('.') === -1) return undefined;
	return key.split('.').reduce((acc, part) => {
		if (acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, part)) return acc[part];
		return undefined;
	}, messages);
}

for (const { locale, data } of packages) {
	const broken = [...used.keys()].filter((key) => typeof lookup(data, key) !== 'string');
	if (broken.length) {
		hasError = true;
		console.error(`✖ [${locale}] ${broken.length} 个 key 在运行时解析不到字符串:`);
		for (const key of broken) console.error(`    ${key}  ← ${[...used.get(key)].join(', ')}`);
	} else {
		console.log(`✔ [${locale}] HTML 用到的 key 运行时全部可解析`);
	}
}

// 5. 未使用的 key(提示)
const allKeys = packages.length ? [...packages[0].keys] : [];
const unusedEverywhere = allKeys.filter((key) => packages.every((p) => p.keys.has(key)) && !used.has(key));
if (unusedEverywhere.length) {
	console.warn(`⚠ [提示] ${unusedEverywhere.length} 个 key 在所有语言包中都未被 HTML 使用(可能供 JS 动态调用):`);
	console.warn(`    ${unusedEverywhere.join(', ')}`);
}

console.log(hasError ? '\n结果: 存在问题 ✖\n' : '\n结果: 通过 ✔\n');
process.exit(hasError ? 1 : 0);
