/**
 * views/cs-range/i18n.js — DUST RANGE language layer
 *
 * The site engine owns locale selection (?lang / localStorage / browser). This
 * file only supplies game strings. Static nodes are translated by exact source
 * text; JS-driven text goes through CSRangeI18n.t() so a language switch does
 * not need a remount. Missing keys deliberately fall back to English.
 */
(function (global) {
	'use strict';

	var LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'];
	var MESSAGES = {
		'zh-CN': {
			'LOCAL / OFFLINE': '本地 / 离线',
			'TRAINING OPERATION': '训练行动',
			'A de_dust-inspired killing floor. Randomised robot squads, real weapon handling, one life per round. Clear every hostile before the clock runs out.': '一个受 de_dust 启发的击杀场。随机机器人小队、真实武器手感、每回合一条命。在倒计时结束前清除所有敌人。',
			'MAP': '地图', 'MODE': '模式', 'ELIMINATION': '歼灭', 'FIRST TO': '先到', '8 ROUNDS': '8 回合', 'HOSTILES': '敌人',
			'DEPLOY': '部署', 'PRACTICE RANGE': '练习靶场', 'CONTROLS': '操作', 'SETTINGS': '设置',
			'Mouse + keyboard recommended. All assets are generated in the browser — no downloads, no external services.': '推荐使用鼠标 + 键盘。所有资源均在浏览器内生成——无需下载，也不依赖外部服务。',
			'Click DEPLOY, then the field to lock the mouse.': '点击“部署”，然后点击战场以锁定鼠标。',
			'MISSION BRIEF': '任务简报',
			'Robots have overrun the training site. Eliminate the whole squad to take the round. Die and the round is lost. First side to eight rounds wins the operation.': '机器人占领了训练场。清除整支小队即可拿下回合；阵亡则回合失败。先赢下八回合的一方获胜。',
			'Every round spawns a random robot squad — scouts, troopers, heavies and snipers.': '每回合都会生成一支随机机器人小队——侦察兵、突击兵、重装兵和狙击手。',
			'Earn cash for kills and rounds. Press': '击杀和赢下回合可获得资金。按',
			'during buy time to shop.': '在购买时间打开商店。',
			'Headshots do four times damage. Robot heads pop. Use cover.': '爆头造成四倍伤害。机器人会被爆头。利用掩体。',
			'Defeated robots drop their weapon. Press': '被击败的机器人会掉落武器。按',
			'on the field to pick it up.': '在场上拾取。',
			'OPERATION SETUP': '行动设置', 'SET': '设置', 'BOT DIFFICULTY': '机器人难度', 'RECRUIT': '新兵', 'REGULAR': '普通', 'VETERAN': '老兵', 'ELITE': '精英',
			'SQUAD SIZE': '小队规模', 'AUTO': '自动', 'GRAPHICS': '画面', 'LOW': '低', 'BALANCED': '均衡', 'HIGH': '高',
			'MOUSE SENSITIVITY': '鼠标灵敏度', 'VOLUME': '音量', 'SERVICE RECORD': '服役记录', 'LOCAL': '本地', 'BEST MATCH': '最佳对局', 'ROUNDS WON': '获胜回合', 'MOST KILLS': '最多击杀',
			'RENDERER READY': '渲染器就绪', 'THREE.JS / PROCEDURAL ASSETS': 'THREE.JS / 程序化资源',
			'A fan-made tribute — not affiliated with Valve.': '粉丝自制作品——与 Valve 无关。',
			'SCORE': '得分', 'HITS': '命中', 'ACCURACY': '准确率', 'TARGETS': '靶数',
			'ROUND': '回合', 'BUY TIME': '购买时间', 'LIVE': '进行中', 'PRACTICE': '练习',
			'COUNTER-TERRORISTS': '反恐精英', 'ROBOT SQUAD': '机器人小队', 'FIRST TO 8': '先赢 8 回合',
			'HEADSHOT': '爆头', '4× DAMAGE': '4× 伤害', 'ELIMINATED BY': '击杀者', 'SPECTATING · ROUND ENDS IN': '观战中 · 回合结束倒计时', 'OPTIC // SCOPED': '瞄准镜 // 开镜',
			'MOVE': '移动', 'WALK': '慢走', 'CROUCH': '蹲下', 'JUMP': '跳跃', 'RELOAD': '换弹', 'BUY': '购买', 'PICK UP': '拾取', 'TAB': 'Tab',
			'BUY PHASE': '购买阶段', 'OPEN BUY MENU': '打开购买菜单', 'WEAPON DROP': '武器掉落', 'PRESS': '按', 'TO PICK UP': '拾取', 'FIRE': '开火',
			'ARMORY // BUY PHASE': '军械库 // 购买阶段', 'BUY MENU': '购买菜单', 'AVAILABLE': '可用',
			'NUMBER KEYS 1–9 · CLICK FOR SIDEARMS / GEAR': '数字键 1–9 · 点击购买副武器 / 装备',
			'PURCHASES ARE FINAL FOR THIS ROUND': '本回合购买不可撤销',
			'CLOSE': '关闭', 'OPERATION SUSPENDED': '行动暂停', 'PAUSED': '已暂停',
			'Mouse control is released. Your round is frozen — nothing moves until you resume.': '鼠标控制已释放。回合已冻结——恢复前不会移动。',
			'RESUME': '继续', 'SOUND: ON': '音效：开', 'EXIT TO GAMES': '退出到游戏页', 'KILLS': '击杀',
			'COUNTER-TERRORISTS WIN': '反恐精英胜利', 'All hostiles eliminated.': '所有敌人已被清除。', 'HEADSHOTS': '爆头', 'REWARD': '奖励',
			'NEXT ROUND IN 5': '下一回合 5 秒后', 'NEXT ROUND': '下一回合',
			'SCOREBOARD': '记分板', 'RELEASE TAB TO CLOSE': '松开 Tab 关闭', 'K / D / HS / PING': '击杀 / 死亡 / 爆头 / 延迟',
			'OPERATOR MANUAL': '操作手册', 'Move': '移动', 'Aim': '瞄准', 'Fire': '开火', 'Scope (scoped rifles)': '开镜（带镜步枪）',
			'Reload': '换弹', 'Pistol / primary / knife': '手枪 / 主武器 / 刀', 'Walk (quieter, steadier)': '慢走（更安静、更稳）',
			'Crouch': '蹲下', 'Jump': '跳跃', 'Buy menu': '购买菜单', 'Pick up dropped weapon': '拾取掉落武器', 'Scoreboard': '记分板',
			'Mute audio': '静音', 'Pause / release mouse': '暂停 / 释放鼠标', 'Toggle this manual': '打开/关闭本手册',
			'Robots use line-of-sight, flanking paths and randomised accuracy. Cover works both ways. Aim for the head — it does four times damage. Chickens wander the range; the Practice Range has a free armory and target boards.': '机器人会利用视线、侧翼路线和随机精度。掩体对双方都有效。瞄准头部——四倍伤害。鸡在靶场里游荡；练习靶场提供免费军械库和靶板。',
			'CLICK THE FIELD TO LOCK THE MOUSE': '点击战场以锁定鼠标', 'BACK': '返回',
			'OPERATION COMPLETE': '行动完成', 'VICTORY': '胜利', 'The training site is clear.': '训练场已清空。', 'ROUNDS': '回合', 'PLAY AGAIN': '再玩一次',
			'TURN THE DEVICE': '旋转设备', 'LANDSCAPE RECOMMENDED': '建议横屏', 'LOADING 3D ENGINE': '加载 3D 引擎',
			'Language': '语言',
			'ROUND {n}': '第 {n} 回合', 'BUY TIME — PRESS B TO OPEN THE ARMORY': '购买时间——按 B 打开军械库',
			'ROUND START': '回合开始', 'ELIMINATE THE ROBOT SQUAD': '清除机器人小队',
			'SHOOT THE TARGETS — B OPENS THE FREE ARMORY': '射击靶子——按 B 打开免费军械库',
			'NEXT ROUND IN {n}': '下一回合 {n} 秒后', 'ROBOT SQUAD WINS': '机器人小队胜利',
			'Time expired before the squad was eliminated.': '时间耗尽，小队未被清除。',
			'Eliminated by {name} ({weapon}).': '被 {name} 击杀（{weapon}）。',
			'Headshot by {name} ({weapon}).': '被 {name} 爆头（{weapon}）。',
			'HEADSHOT · ELIMINATED BY': '爆头 · 击杀者', 'TRY ANY WEAPON': '试用任意武器',
			'FREE ARMORY': '免费军械库', 'ARMORY // PRACTICE RANGE': '军械库 // 练习靶场', 'FREE SWAP · INFINITE RESERVE': '免费更换 · 无限备弹',
			'PLAYER': '玩家', 'YOU': '你', 'SIDEARM': '副武器', 'PRIMARY': '主武器', 'SECONDARY': '副武器', 'MELEE': '近战',
			'SOUND: OFF': '音效：关', 'ROUND OVER': '回合结束', 'MATCH OVER': '比赛结束',
			'FREE': '免费', 'OWNED': '已拥有', 'EQUIPPED': '已装备', 'NOT ENOUGH CASH': '资金不足',
			'DMG': '伤害', 'RPM': '射速', 'MAG': '弹匣', 'ARMOR': '护甲', 'HEAD': '头部', 'PROTECTED': '已保护',
			'RIFLE': '步枪', 'SNIPER': '狙击枪', 'SMG': '冲锋枪', 'SHOTGUN': '霰弹枪', 'PROTECTION': '防护',
			'KEVLAR + HELMET': '防弹衣 + 头盔',
			'Not enough cash.': '资金不足。', 'Armour is already full.': '护甲已满。', 'Armour refilled.': '护甲已补满。',
			'Kevlar + helmet equipped.': '防弹衣 + 头盔已装备。', 'Already equipped.': '已装备。',
			'{name} acquired.': '已获得 {name}。', '{name} loaded.': '{name} 已装填。', 'Picked up {name}.': '已拾取 {name}。', 'Picked up {name} ammo.': '已拾取 {name} 弹药。',
			'Buy time is over — the armory is locked.': '购买时间结束——军械库已锁定。',
			'Practice session — no scoreboard.': '练习模式——没有记分板。',
			'Mouse lock unavailable — free look is active. Click to fire.': '鼠标锁定不可用——已启用自由视角。点击开火。',
			'Audio muted.': '音频已静音。', 'Audio on.': '音频已开启。',
			'INITIALISING RENDERER': '初始化渲染器', 'DEFEAT': '失败', 'LANG': '语言', 'TAP TO PICK UP': '点击拾取', 'BUY [{n}]': '购买 [{n}]', 'B · FREE ARMORY': 'B · 免费军械库',
			'The training site is clear. Operation complete.': '训练场已清空。行动完成。',
			'The robot squad held the site. Regroup and try again.': '机器人小队守住了训练场。重整旗鼓再试一次。',
			'You were eliminated by the robot squad.': '你被机器人小队击杀了。', 'Dust Range main menu': '尘埃靶场主菜单', 'Back to games': '返回游戏页', 'Game HUD': '游戏 HUD', 'Tactical radar': '战术雷达', 'Match score': '比分', 'Open buy menu': '打开购买菜单', 'Close buy menu': '关闭购买菜单', 'Pause menu': '暂停菜单', 'Round result': '回合结果', 'Close scoreboard': '关闭记分板', 'Close controls': '关闭操作', 'Match result': '比赛结果', 'Bot difficulty': '机器人难度', 'Squad size': '小队规模', 'Graphics quality': '画面质量',
		},
		'zh-TW': {
			'LOCAL / OFFLINE': '本機 / 離線', 'TRAINING OPERATION': '訓練行動',
			'A de_dust-inspired killing floor. Randomised robot squads, real weapon handling, one life per round. Clear every hostile before the clock runs out.': '一個受 de_dust 啟發的擊殺場。隨機機器人小隊、真實武器手感、每回合一條命。在倒數結束前清除所有敵人。',
			'MAP': '地圖', 'MODE': '模式', 'ELIMINATION': '殲滅', 'FIRST TO': '先到', '8 ROUNDS': '8 回合', 'HOSTILES': '敵人',
			'DEPLOY': '部署', 'PRACTICE RANGE': '練習靶場', 'CONTROLS': '操作', 'SETTINGS': '設定',
			'Mouse + keyboard recommended. All assets are generated in the browser — no downloads, no external services.': '推薦使用滑鼠 + 鍵盤。所有資源皆在瀏覽器內生成——無需下載，也不依賴外部服務。',
			'Click DEPLOY, then the field to lock the mouse.': '點擊「部署」，然後點擊戰場以鎖定滑鼠。',
			'MISSION BRIEF': '任務簡報',
			'Robots have overrun the training site. Eliminate the whole squad to take the round. Die and the round is lost. First side to eight rounds wins the operation.': '機器人佔領了訓練場。清除整支小隊即可拿下回合；陣亡則回合失敗。先贏下八回合的一方獲勝。',
			'Every round spawns a random robot squad — scouts, troopers, heavies and snipers.': '每回合都會生成一支隨機機器人小隊——偵察兵、突擊兵、重裝兵和狙擊手。',
			'Earn cash for kills and rounds. Press': '擊殺和贏下回合可獲得資金。按',
			'during buy time to shop.': '在購買時間打開商店。',
			'Headshots do four times damage. Robot heads pop. Use cover.': '爆頭造成四倍傷害。機器人會被爆頭。利用掩體。',
			'Defeated robots drop their weapon. Press': '被擊敗的機器人會掉落武器。按',
			'on the field to pick it up.': '在場上拾取。',
			'OPERATION SETUP': '行動設定', 'SET': '設定', 'BOT DIFFICULTY': '機器人難度', 'RECRUIT': '新兵', 'REGULAR': '普通', 'VETERAN': '老兵', 'ELITE': '菁英',
			'SQUAD SIZE': '小隊規模', 'AUTO': '自動', 'GRAPHICS': '畫面', 'LOW': '低', 'BALANCED': '均衡', 'HIGH': '高',
			'MOUSE SENSITIVITY': '滑鼠靈敏度', 'VOLUME': '音量', 'SERVICE RECORD': '服役記錄', 'LOCAL': '本機', 'BEST MATCH': '最佳對局', 'ROUNDS WON': '獲勝回合', 'MOST KILLS': '最多擊殺',
			'RENDERER READY': '渲染器就緒', 'THREE.JS / PROCEDURAL ASSETS': 'THREE.JS / 程序化資源',
			'A fan-made tribute — not affiliated with Valve.': '粉絲自製作品——與 Valve 無關。',
			'SCORE': '得分', 'HITS': '命中', 'ACCURACY': '準確率', 'TARGETS': '靶數',
			'ROUND': '回合', 'BUY TIME': '購買時間', 'LIVE': '進行中', 'PRACTICE': '練習',
			'COUNTER-TERRORISTS': '反恐精英', 'ROBOT SQUAD': '機器人小隊', 'FIRST TO 8': '先贏 8 回合',
			'HEADSHOT': '爆頭', '4× DAMAGE': '4× 傷害', 'ELIMINATED BY': '擊殺者', 'SPECTATING · ROUND ENDS IN': '觀戰中 · 回合結束倒數', 'OPTIC // SCOPED': '瞄準鏡 // 開鏡',
			'MOVE': '移動', 'WALK': '慢走', 'CROUCH': '蹲下', 'JUMP': '跳躍', 'RELOAD': '換彈', 'BUY': '購買', 'PICK UP': '拾取', 'TAB': 'Tab',
			'BUY PHASE': '購買階段', 'OPEN BUY MENU': '開啟購買選單', 'WEAPON DROP': '武器掉落', 'PRESS': '按', 'TO PICK UP': '拾取', 'FIRE': '開火',
			'ARMORY // BUY PHASE': '軍械庫 // 購買階段', 'BUY MENU': '購買選單', 'AVAILABLE': '可用',
			'NUMBER KEYS 1–9 · CLICK FOR SIDEARMS / GEAR': '數字鍵 1–9 · 點擊購買副武器 / 裝備',
			'PURCHASES ARE FINAL FOR THIS ROUND': '本回合購買不可撤銷', 'CLOSE': '關閉',
			'OPERATION SUSPENDED': '行動暫停', 'PAUSED': '已暫停',
			'Mouse control is released. Your round is frozen — nothing moves until you resume.': '滑鼠控制已釋放。回合已凍結——恢復前不會移動。',
			'RESUME': '繼續', 'SOUND: ON': '音效：開', 'EXIT TO GAMES': '退出到遊戲頁', 'KILLS': '擊殺',
			'COUNTER-TERRORISTS WIN': '反恐精英勝利', 'All hostiles eliminated.': '所有敵人已被清除。', 'HEADSHOTS': '爆頭', 'REWARD': '獎勵',
			'NEXT ROUND IN 5': '下一回合 5 秒後', 'NEXT ROUND': '下一回合',
			'SCOREBOARD': '記分板', 'RELEASE TAB TO CLOSE': '鬆開 Tab 關閉', 'K / D / HS / PING': '擊殺 / 死亡 / 爆頭 / 延遲',
			'OPERATOR MANUAL': '操作手冊', 'Move': '移動', 'Aim': '瞄準', 'Fire': '開火', 'Scope (scoped rifles)': '開鏡（帶鏡步槍）',
			'Reload': '換彈', 'Pistol / primary / knife': '手槍 / 主武器 / 刀', 'Walk (quieter, steadier)': '慢走（更安靜、更穩）',
			'Crouch': '蹲下', 'Jump': '跳躍', 'Buy menu': '購買選單', 'Pick up dropped weapon': '拾取掉落武器', 'Scoreboard': '記分板',
			'Mute audio': '靜音', 'Pause / release mouse': '暫停 / 釋放滑鼠', 'Toggle this manual': '開啟/關閉本手冊',
			'Robots use line-of-sight, flanking paths and randomised accuracy. Cover works both ways. Aim for the head — it does four times damage. Chickens wander the range; the Practice Range has a free armory and target boards.': '機器人會利用視線、側翼路線和隨機精度。掩體對雙方都有效。瞄準頭部——四倍傷害。雞在靶場裡遊蕩；練習靶場提供免費軍械庫和靶板。',
			'CLICK THE FIELD TO LOCK THE MOUSE': '點擊戰場以鎖定滑鼠', 'BACK': '返回',
			'OPERATION COMPLETE': '行動完成', 'VICTORY': '勝利', 'The training site is clear.': '訓練場已清空。', 'ROUNDS': '回合', 'PLAY AGAIN': '再玩一次',
			'TURN THE DEVICE': '旋轉裝置', 'LANDSCAPE RECOMMENDED': '建議橫屏', 'LOADING 3D ENGINE': '載入 3D 引擎',
			'Language': '語言',
			'ROUND {n}': '第 {n} 回合', 'BUY TIME — PRESS B TO OPEN THE ARMORY': '購買時間——按 B 開啟軍械庫',
			'ROUND START': '回合開始', 'ELIMINATE THE ROBOT SQUAD': '清除機器人小隊',
			'SHOOT THE TARGETS — B OPENS THE FREE ARMORY': '射擊靶子——按 B 開啟免費軍械庫',
			'NEXT ROUND IN {n}': '下一回合 {n} 秒後', 'ROBOT SQUAD WINS': '機器人小隊勝利',
			'Time expired before the squad was eliminated.': '時間耗盡，小隊未被清除。',
			'Eliminated by {name} ({weapon}).': '被 {name} 擊殺（{weapon}）。',
			'Headshot by {name} ({weapon}).': '被 {name} 爆頭（{weapon}）。',
			'HEADSHOT · ELIMINATED BY': '爆頭 · 擊殺者', 'TRY ANY WEAPON': '試用任意武器',
			'FREE ARMORY': '免費軍械庫', 'ARMORY // PRACTICE RANGE': '軍械庫 // 練習靶場', 'FREE SWAP · INFINITE RESERVE': '免費更換 · 無限備彈',
			'PLAYER': '玩家', 'YOU': '你', 'SIDEARM': '副武器', 'PRIMARY': '主武器', 'SECONDARY': '副武器', 'MELEE': '近戰',
			'SOUND: OFF': '音效：關', 'ROUND OVER': '回合結束', 'MATCH OVER': '比賽結束',
			'FREE': '免費', 'OWNED': '已擁有', 'EQUIPPED': '已裝備', 'NOT ENOUGH CASH': '資金不足',
			'DMG': '傷害', 'RPM': '射速', 'MAG': '彈匣', 'ARMOR': '護甲', 'HEAD': '頭部', 'PROTECTED': '已保護',
			'RIFLE': '步槍', 'SNIPER': '狙擊槍', 'SMG': '衝鋒槍', 'SHOTGUN': '霰彈槍', 'PROTECTION': '防護',
			'KEVLAR + HELMET': '防彈衣 + 頭盔',
			'Not enough cash.': '資金不足。', 'Armour is already full.': '護甲已滿。', 'Armour refilled.': '護甲已補滿。',
			'Kevlar + helmet equipped.': '防彈衣 + 頭盔已裝備。', 'Already equipped.': '已裝備。',
			'{name} acquired.': '已獲得 {name}。', '{name} loaded.': '{name} 已裝填。', 'Picked up {name}.': '已拾取 {name}。', 'Picked up {name} ammo.': '已拾取 {name} 彈藥。',
			'Buy time is over — the armory is locked.': '購買時間結束——軍械庫已鎖定。',
			'Practice session — no scoreboard.': '練習模式——沒有記分板。',
			'Mouse lock unavailable — free look is active. Click to fire.': '滑鼠鎖定不可用——已啟用自由視角。點擊開火。',
			'Audio muted.': '音訊已靜音。', 'Audio on.': '音訊已開啟。',
			'INITIALISING RENDERER': '初始化渲染器', 'DEFEAT': '失敗', 'LANG': '語言', 'TAP TO PICK UP': '點擊拾取', 'BUY [{n}]': '購買 [{n}]', 'B · FREE ARMORY': 'B · 免費軍械庫',
			'The training site is clear. Operation complete.': '訓練場已清空。行動完成。',
			'The robot squad held the site. Regroup and try again.': '機器人小隊守住了訓練場。重整旗鼓再試一次。',
			'You were eliminated by the robot squad.': '你被機器人小隊擊殺了。', 'Dust Range main menu': '塵埃靶場主選單', 'Back to games': '返回遊戲頁', 'Game HUD': '遊戲 HUD', 'Tactical radar': '戰術雷達', 'Match score': '比分', 'Open buy menu': '開啟購買選單', 'Close buy menu': '關閉購買選單', 'Pause menu': '暫停選單', 'Round result': '回合結果', 'Close scoreboard': '關閉記分板', 'Close controls': '關閉操作', 'Match result': '比賽結果', 'Bot difficulty': '機器人難度', 'Squad size': '小隊規模', 'Graphics quality': '畫面品質',
		},
		'ja': {
			'LOCAL / OFFLINE': 'ローカル / オフライン', 'TRAINING OPERATION': '訓練作戦',
			'A de_dust-inspired killing floor. Randomised robot squads, real weapon handling, one life per round. Clear every hostile before the clock runs out.': 'de_dust に着想を得たキルフロア。ランダムなロボット分隊、リアルな武器操作、1ラウンド1ライフ。時間切れまでに敵を全滅させろ。',
			'MAP': 'マップ', 'MODE': 'モード', 'ELIMINATION': '殲滅', 'FIRST TO': '先取', '8 ROUNDS': '8ラウンド', 'HOSTILES': '敵',
			'DEPLOY': '展開', 'PRACTICE RANGE': '練習レンジ', 'CONTROLS': '操作', 'SETTINGS': '設定',
			'Mouse + keyboard recommended. All assets are generated in the browser — no downloads, no external services.': 'マウス + キーボード推奨。アセットはすべてブラウザ内生成。外部サービス不要。',
			'Click DEPLOY, then the field to lock the mouse.': '「展開」をクリックし、フィールドをクリックしてマウスをロック。',
			'MISSION BRIEF': 'ミッション概要',
			'Robots have overrun the training site. Eliminate the whole squad to take the round. Die and the round is lost. First side to eight rounds wins the operation.': 'ロボットが訓練場を占拠した。分隊を全滅させればラウンド獲得。死亡するとラウンド敗北。先に8ラウンド取った側の勝利。',
			'Every round spawns a random robot squad — scouts, troopers, heavies and snipers.': '毎ラウンド、ランダムなロボット分隊——スカウト、トルーパー、ヘビー、スナイパーが出現。',
			'Earn cash for kills and rounds. Press': 'キルとラウンドで資金を獲得。購入時間に',
			'during buy time to shop.': 'ショップを開く。',
			'Headshots do four times damage. Robot heads pop. Use cover.': 'ヘッドショットは4倍ダメージ。ロボットの頭は吹き飛ぶ。掩体を使え。',
			'Defeated robots drop their weapon. Press': '倒したロボットは武器を落とす。フィールドで',
			'on the field to pick it up.': '拾う。',
			'OPERATION SETUP': '作戦設定', 'SET': '設定', 'BOT DIFFICULTY': 'ボット難易度', 'RECRUIT': '新兵', 'REGULAR': '一般', 'VETERAN': 'ベテラン', 'ELITE': 'エリート',
			'SQUAD SIZE': '分隊規模', 'AUTO': '自動', 'GRAPHICS': 'グラフィック', 'LOW': '低', 'BALANCED': 'バランス', 'HIGH': '高',
			'MOUSE SENSITIVITY': 'マウス感度', 'VOLUME': '音量', 'SERVICE RECORD': '戦績', 'LOCAL': 'ローカル', 'BEST MATCH': 'ベストマッチ', 'ROUNDS WON': '勝利ラウンド', 'MOST KILLS': '最多キル',
			'RENDERER READY': 'レンダラー準備完了', 'THREE.JS / PROCEDURAL ASSETS': 'THREE.JS / プロシージャル素材',
			'A fan-made tribute — not affiliated with Valve.': 'ファンメイド作品——Valve とは無関係。',
			'SCORE': 'スコア', 'HITS': 'ヒット', 'ACCURACY': '命中率', 'TARGETS': 'ターゲット',
			'ROUND': 'ラウンド', 'BUY TIME': '購入時間', 'LIVE': '進行中', 'PRACTICE': '練習',
			'COUNTER-TERRORISTS': 'カウンター・テロリスト', 'ROBOT SQUAD': 'ロボット部隊', 'FIRST TO 8': '8ラウンド先取',
			'HEADSHOT': 'ヘッドショット', '4× DAMAGE': '4× ダメージ', 'ELIMINATED BY': '撃破者', 'SPECTATING · ROUND ENDS IN': '観戦中 · ラウンド終了まで', 'OPTIC // SCOPED': 'スコープ // スコープ中',
			'MOVE': '移動', 'WALK': '歩く', 'CROUCH': 'しゃがむ', 'JUMP': 'ジャンプ', 'RELOAD': 'リロード', 'BUY': '購入', 'PICK UP': '拾う', 'TAB': 'Tab',
			'BUY PHASE': '購入時間', 'OPEN BUY MENU': '購入メニューを開く', 'WEAPON DROP': '武器ドロップ', 'PRESS': '押す', 'TO PICK UP': '拾う', 'FIRE': '射撃',
			'ARMORY // BUY PHASE': 'アーマリー // 購入時間', 'BUY MENU': '購入メニュー', 'AVAILABLE': '購入可能',
			'NUMBER KEYS 1–9 · CLICK FOR SIDEARMS / GEAR': '数字キー 1–9 · サイドアーム / 装備をクリック',
			'PURCHASES ARE FINAL FOR THIS ROUND': 'このラウンドの購入は確定', 'CLOSE': '閉じる',
			'OPERATION SUSPENDED': '作戦停止', 'PAUSED': '一時停止',
			'Mouse control is released. Your round is frozen — nothing moves until you resume.': 'マウス操作は解除されました。ラウンドは停止中——再開するまで動きません。',
			'RESUME': '再開', 'SOUND: ON': 'サウンド：オン', 'EXIT TO GAMES': 'ゲームへ戻る', 'KILLS': 'キル',
			'COUNTER-TERRORISTS WIN': 'カウンター・テロリスト勝利', 'All hostiles eliminated.': '敵をすべて排除。', 'HEADSHOTS': 'ヘッドショット', 'REWARD': '報酬',
			'NEXT ROUND IN 5': '次のラウンドまで 5', 'NEXT ROUND': '次のラウンド',
			'SCOREBOARD': 'スコアボード', 'RELEASE TAB TO CLOSE': 'Tab を離して閉じる', 'K / D / HS / PING': 'キル / デス / HS / ピング',
			'OPERATOR MANUAL': '操作マニュアル', 'Move': '移動', 'Aim': '照準', 'Fire': '射撃', 'Scope (scoped rifles)': 'スコープ（スコープ付きライフル）',
			'Reload': 'リロード', 'Pistol / primary / knife': 'ピストル / メイン / ナイフ', 'Walk (quieter, steadier)': '歩く（静かで安定）',
			'Crouch': 'しゃがむ', 'Jump': 'ジャンプ', 'Buy menu': '購入メニュー', 'Pick up dropped weapon': '落ちた武器を拾う', 'Scoreboard': 'スコアボード',
			'Mute audio': 'ミュート', 'Pause / release mouse': '一時停止 / マウス解放', 'Toggle this manual': 'このマニュアルを切替',
			'Robots use line-of-sight, flanking paths and randomised accuracy. Cover works both ways. Aim for the head — it does four times damage. Chickens wander the range; the Practice Range has a free armory and target boards.': 'ロボットは視線、側面経路、ランダムな精度を使う。掩体は双方に有効。頭を狙え——4倍ダメージ。鶏がレンジを歩く。練習レンジは無料アーマリーとターゲット完備。',
			'CLICK THE FIELD TO LOCK THE MOUSE': 'フィールドをクリックしてマウスをロック', 'BACK': '戻る',
			'OPERATION COMPLETE': '作戦完了', 'VICTORY': '勝利', 'The training site is clear.': '訓練場は制圧された。', 'ROUNDS': 'ラウンド', 'PLAY AGAIN': 'もう一度',
			'TURN THE DEVICE': 'デバイスを回転', 'LANDSCAPE RECOMMENDED': '横向き推奨', 'LOADING 3D ENGINE': '3D エンジンを読み込み中',
			'Language': '言語',
			'ROUND {n}': 'ラウンド {n}', 'BUY TIME — PRESS B TO OPEN THE ARMORY': '購入時間——B でアーマリーを開く',
			'ROUND START': 'ラウンド開始', 'ELIMINATE THE ROBOT SQUAD': 'ロボット部隊を排除',
			'SHOOT THE TARGETS — B OPENS THE FREE ARMORY': 'ターゲットを撃て——B で無料アーマリー',
			'NEXT ROUND IN {n}': '次のラウンドまで {n}', 'ROBOT SQUAD WINS': 'ロボット部隊勝利',
			'Time expired before the squad was eliminated.': '時間切れ。分隊は排除されなかった。',
			'Eliminated by {name} ({weapon}).': '{name} に撃破された（{weapon}）。',
			'Headshot by {name} ({weapon}).': '{name} にヘッドショットされた（{weapon}）。',
			'HEADSHOT · ELIMINATED BY': 'ヘッドショット · 撃破者', 'TRY ANY WEAPON': '任意の武器を試す',
			'FREE ARMORY': '無料アーマリー', 'ARMORY // PRACTICE RANGE': 'アーマリー // 練習レンジ', 'FREE SWAP · INFINITE RESERVE': '無料交換 · 無限予備',
			'PLAYER': 'プレイヤー', 'YOU': 'あなた', 'SIDEARM': 'サイドアーム', 'PRIMARY': 'メイン', 'SECONDARY': 'サブ', 'MELEE': '近接',
			'SOUND: OFF': 'サウンド：オフ', 'ROUND OVER': 'ラウンド終了', 'MATCH OVER': '試合終了',
			'FREE': '無料', 'OWNED': '所持済み', 'EQUIPPED': '装備中', 'NOT ENOUGH CASH': '資金不足',
			'DMG': 'ダメージ', 'RPM': '連射速度', 'MAG': 'マガジン', 'ARMOR': 'アーマー', 'HEAD': '頭部', 'PROTECTED': '保護済み',
			'RIFLE': 'ライフル', 'SNIPER': 'スナイパー', 'SMG': 'SMG', 'SHOTGUN': 'ショットガン', 'PROTECTION': '防護',
			'KEVLAR + HELMET': 'ケブラー + ヘルメット',
			'Not enough cash.': '資金不足。', 'Armour is already full.': 'アーマーは満タン。', 'Armour refilled.': 'アーマーを補充。',
			'Kevlar + helmet equipped.': 'ケブラー + ヘルメットを装備。', 'Already equipped.': '装備済み。',
			'{name} acquired.': '{name} を入手。', '{name} loaded.': '{name} を装填。', 'Picked up {name}.': '{name} を拾った。', 'Picked up {name} ammo.': '{name} の弾薬を拾った。',
			'Buy time is over — the armory is locked.': '購入時間終了——アーマリーはロック。',
			'Practice session — no scoreboard.': '練習セッション——スコアボードなし。',
			'Mouse lock unavailable — free look is active. Click to fire.': 'マウスロック不可——フリールック有効。クリックで射撃。',
			'Audio muted.': '音声をミュート。', 'Audio on.': '音声オン。',
			'INITIALISING RENDERER': 'レンダラー初期化中', 'DEFEAT': '敗北', 'LANG': '言語', 'TAP TO PICK UP': 'タップして拾う', 'BUY [{n}]': '購入 [{n}]', 'B · FREE ARMORY': 'B · 無料アーマリー',
			'The training site is clear. Operation complete.': '訓練場は制圧された。作戦完了。',
			'The robot squad held the site. Regroup and try again.': 'ロボット部隊が訓練場を守り切った。立て直して再挑戦。',
			'You were eliminated by the robot squad.': 'ロボット部隊に撃破された。', 'Dust Range main menu': 'ダストレンジ メインメニュー', 'Back to games': 'ゲームへ戻る', 'Game HUD': 'ゲーム HUD', 'Tactical radar': 'タクティカルレーダー', 'Match score': 'マッチスコア', 'Open buy menu': '購入メニューを開く', 'Close buy menu': '購入メニューを閉じる', 'Pause menu': 'ポーズメニュー', 'Round result': 'ラウンド結果', 'Close scoreboard': 'スコアボードを閉じる', 'Close controls': '操作を閉じる', 'Match result': '試合結果', 'Bot difficulty': 'ボット難易度', 'Squad size': '分隊規模', 'Graphics quality': 'グラフィック品質',
		},
		'ko': {
			'LOCAL / OFFLINE': '로컬 / 오프라인', 'TRAINING OPERATION': '훈련 작전',
			'A de_dust-inspired killing floor. Randomised robot squads, real weapon handling, one life per round. Clear every hostile before the clock runs out.': 'de_dust에서 영감을 받은 킬 플로어. 무작위 로봇 분대, 실제 같은 무기 조작, 라운드당 한 번의 목숨. 제한 시간 전에 모든 적을 제거하세요.',
			'MAP': '맵', 'MODE': '모드', 'ELIMINATION': '섬멸', 'FIRST TO': '먼저', '8 ROUNDS': '8 라운드', 'HOSTILES': '적',
			'DEPLOY': '배치', 'PRACTICE RANGE': '연습 사격장', 'CONTROLS': '조작', 'SETTINGS': '설정',
			'Mouse + keyboard recommended. All assets are generated in the browser — no downloads, no external services.': '마우스 + 키보드 권장. 모든 에셋은 브라우저에서 생성—다운로드나 외부 서비스 없음.',
			'Click DEPLOY, then the field to lock the mouse.': '「배치」를 누른 뒤 필드를 클릭해 마우스를 잠그세요.',
			'MISSION BRIEF': '임무 브리핑',
			'Robots have overrun the training site. Eliminate the whole squad to take the round. Die and the round is lost. First side to eight rounds wins the operation.': '로봇이 훈련장을 점령했습니다. 분대를 모두 제거하면 라운드 승리. 사망하면 라운드 패배. 먼저 8라운드를 가져간 쪽이 승리.',
			'Every round spawns a random robot squad — scouts, troopers, heavies and snipers.': '라운드마다 무작위 로봇 분대—정찰병, 돌격병, 중장갑병, 저격수가 등장.',
			'Earn cash for kills and rounds. Press': '킬과 라운드로 자금을 획득. 구매 시간에',
			'during buy time to shop.': '상점을 여세요.',
			'Headshots do four times damage. Robot heads pop. Use cover.': '헤드샷은 4배 피해. 로봇 머리가 터진다. 엄폐물을 활용하세요.',
			'Defeated robots drop their weapon. Press': '쓰러진 로봇은 무기를 떨어뜨립니다. 필드에서',
			'on the field to pick it up.': '주우세요.',
			'OPERATION SETUP': '작전 설정', 'SET': '설정', 'BOT DIFFICULTY': '봇 난이도', 'RECRUIT': '신병', 'REGULAR': '일반', 'VETERAN': '베테랑', 'ELITE': '엘리트',
			'SQUAD SIZE': '분대 규모', 'AUTO': '자동', 'GRAPHICS': '그래픽', 'LOW': '낮음', 'BALANCED': '균형', 'HIGH': '높음',
			'MOUSE SENSITIVITY': '마우스 감도', 'VOLUME': '음량', 'SERVICE RECORD': '전적', 'LOCAL': '로컬', 'BEST MATCH': '최고 경기', 'ROUNDS WON': '승리 라운드', 'MOST KILLS': '최다 킬',
			'RENDERER READY': '렌더러 준비 완료', 'THREE.JS / PROCEDURAL ASSETS': 'THREE.JS / 절차적 에셋',
			'A fan-made tribute — not affiliated with Valve.': '팬 제작물—Valve와 무관.',
			'SCORE': '점수', 'HITS': '적중', 'ACCURACY': '정확도', 'TARGETS': '타깃',
			'ROUND': '라운드', 'BUY TIME': '구매 시간', 'LIVE': '진행 중', 'PRACTICE': '연습',
			'COUNTER-TERRORISTS': '카운터 테러리스트', 'ROBOT SQUAD': '로봇 부대', 'FIRST TO 8': '8라운드 선취',
			'HEADSHOT': '헤드샷', '4× DAMAGE': '4× 피해', 'ELIMINATED BY': '처치자', 'SPECTATING · ROUND ENDS IN': '관전 중 · 라운드 종료까지', 'OPTIC // SCOPED': '스코프 // 조준 중',
			'MOVE': '이동', 'WALK': '걷기', 'CROUCH': '앉기', 'JUMP': '점프', 'RELOAD': '재장전', 'BUY': '구매', 'PICK UP': '줍기', 'TAB': 'Tab',
			'BUY PHASE': '구매 시간', 'OPEN BUY MENU': '구매 메뉴 열기', 'WEAPON DROP': '무기 드롭', 'PRESS': '누르기', 'TO PICK UP': '줍기', 'FIRE': '발사',
			'ARMORY // BUY PHASE': '무기고 // 구매 시간', 'BUY MENU': '구매 메뉴', 'AVAILABLE': '구매 가능',
			'NUMBER KEYS 1–9 · CLICK FOR SIDEARMS / GEAR': '숫자 키 1–9 · 보조무기 / 장비 클릭',
			'PURCHASES ARE FINAL FOR THIS ROUND': '이번 라운드 구매는 확정', 'CLOSE': '닫기',
			'OPERATION SUSPENDED': '작전 중단', 'PAUSED': '일시정지',
			'Mouse control is released. Your round is frozen — nothing moves until you resume.': '마우스 조작이 해제되었습니다. 라운드가 정지—재개할 때까지 움직이지 않습니다.',
			'RESUME': '재개', 'SOUND: ON': '사운드: 켜짐', 'EXIT TO GAMES': '게임으로 나가기', 'KILLS': '킬',
			'COUNTER-TERRORISTS WIN': '카운터 테러리스트 승리', 'All hostiles eliminated.': '모든 적 제거.', 'HEADSHOTS': '헤드샷', 'REWARD': '보상',
			'NEXT ROUND IN 5': '다음 라운드까지 5', 'NEXT ROUND': '다음 라운드',
			'SCOREBOARD': '스코어보드', 'RELEASE TAB TO CLOSE': 'Tab을 놓아 닫기', 'K / D / HS / PING': '킬 / 데스 / HS / 핑',
			'OPERATOR MANUAL': '조작 설명서', 'Move': '이동', 'Aim': '조준', 'Fire': '발사', 'Scope (scoped rifles)': '스코프 (스코프 소총)',
			'Reload': '재장전', 'Pistol / primary / knife': '권총 / 주무기 / 나이프', 'Walk (quieter, steadier)': '걷기 (조용하고 안정)',
			'Crouch': '앉기', 'Jump': '점프', 'Buy menu': '구매 메뉴', 'Pick up dropped weapon': '떨어진 무기 줍기', 'Scoreboard': '스코어보드',
			'Mute audio': '음소거', 'Pause / release mouse': '일시정지 / 마우스 해제', 'Toggle this manual': '이 설명서 전환',
			'Robots use line-of-sight, flanking paths and randomised accuracy. Cover works both ways. Aim for the head — it does four times damage. Chickens wander the range; the Practice Range has a free armory and target boards.': '로봇은 시야, 측면 경로, 무작위 정확도를 사용합니다. 엄폐물은 양쪽 모두 유효. 머리를 노리세요—4배 피해. 닭이 사격장을 돌아다닙니다. 연습 사격장은 무료 무기고와 타깃을 제공.',
			'CLICK THE FIELD TO LOCK THE MOUSE': '필드를 클릭해 마우스 잠금', 'BACK': '뒤로',
			'OPERATION COMPLETE': '작전 완료', 'VICTORY': '승리', 'The training site is clear.': '훈련장이 정리되었습니다.', 'ROUNDS': '라운드', 'PLAY AGAIN': '다시 플레이',
			'TURN THE DEVICE': '기기 회전', 'LANDSCAPE RECOMMENDED': '가로 모드 권장', 'LOADING 3D ENGINE': '3D 엔진 로딩',
			'Language': '언어',
			'ROUND {n}': '라운드 {n}', 'BUY TIME — PRESS B TO OPEN THE ARMORY': '구매 시간—B로 무기고 열기',
			'ROUND START': '라운드 시작', 'ELIMINATE THE ROBOT SQUAD': '로봇 부대 제거',
			'SHOOT THE TARGETS — B OPENS THE FREE ARMORY': '타깃을 쏘세요—B로 무료 무기고',
			'NEXT ROUND IN {n}': '다음 라운드까지 {n}', 'ROBOT SQUAD WINS': '로봇 부대 승리',
			'Time expired before the squad was eliminated.': '시간 초과. 분대가 제거되지 않았습니다.',
			'Eliminated by {name} ({weapon}).': '{name}에게 처치됨 ({weapon}).',
			'Headshot by {name} ({weapon}).': '{name}에게 헤드샷 ({weapon}).',
			'HEADSHOT · ELIMINATED BY': '헤드샷 · 처치자', 'TRY ANY WEAPON': '아무 무기나 사용',
			'FREE ARMORY': '무료 무기고', 'ARMORY // PRACTICE RANGE': '무기고 // 연습 사격장', 'FREE SWAP · INFINITE RESERVE': '무료 교체 · 무한 예비',
			'PLAYER': '플레이어', 'YOU': '당신', 'SIDEARM': '보조무기', 'PRIMARY': '주무기', 'SECONDARY': '보조', 'MELEE': '근접',
			'SOUND: OFF': '사운드: 꺼짐', 'ROUND OVER': '라운드 종료', 'MATCH OVER': '경기 종료',
			'FREE': '무료', 'OWNED': '보유 중', 'EQUIPPED': '장착됨', 'NOT ENOUGH CASH': '자금 부족',
			'DMG': '피해', 'RPM': '연사', 'MAG': '탄창', 'ARMOR': '방어구', 'HEAD': '머리', 'PROTECTED': '보호됨',
			'RIFLE': '소총', 'SNIPER': '저격총', 'SMG': '기관단총', 'SHOTGUN': '산탄총', 'PROTECTION': '방어',
			'KEVLAR + HELMET': '케블라 + 헬멧',
			'Not enough cash.': '자금이 부족합니다.', 'Armour is already full.': '방어구가 가득 찼습니다.', 'Armour refilled.': '방어구 보충.',
			'Kevlar + helmet equipped.': '케블라 + 헬멧 장착.', 'Already equipped.': '이미 장착됨.',
			'{name} acquired.': '{name} 획득.', '{name} loaded.': '{name} 장전.', 'Picked up {name}.': '{name} 획득.', 'Picked up {name} ammo.': '{name} 탄약 획득.',
			'Buy time is over — the armory is locked.': '구매 시간 종료—무기고 잠김.',
			'Practice session — no scoreboard.': '연습 세션—스코어보드 없음.',
			'Mouse lock unavailable — free look is active. Click to fire.': '마우스 잠금 불가—자유 시점 활성. 클릭해 발사.',
			'Audio muted.': '오디오 음소거.', 'Audio on.': '오디오 켜짐.',
			'INITIALISING RENDERER': '렌더러 초기화 중', 'DEFEAT': '패배', 'LANG': '언어', 'TAP TO PICK UP': '탭하여 줍기', 'BUY [{n}]': '구매 [{n}]', 'B · FREE ARMORY': 'B · 무료 무기고',
			'The training site is clear. Operation complete.': '훈련장이 정리되었습니다. 작전 완료.',
			'The robot squad held the site. Regroup and try again.': '로봇 부대가 훈련장을 지켰습니다. 재정비 후 다시 시도하세요.',
			'You were eliminated by the robot squad.': '로봇 부대에게 제거되었습니다.', 'Dust Range main menu': '더스트 레인지 메인 메뉴', 'Back to games': '게임으로 돌아가기', 'Game HUD': '게임 HUD', 'Tactical radar': '전술 레이더', 'Match score': '경기 점수', 'Open buy menu': '구매 메뉴 열기', 'Close buy menu': '구매 메뉴 닫기', 'Pause menu': '일시정지 메뉴', 'Round result': '라운드 결과', 'Close scoreboard': '스코어보드 닫기', 'Close controls': '조작 닫기', 'Match result': '경기 결과', 'Bot difficulty': '봇 난이도', 'Squad size': '분대 규모', 'Graphics quality': '그래픽 품질',
		}
	};

	var SOURCE = {};
	var REVERSE = {};
	LOCALES.forEach(function (loc) {
		REVERSE[loc] = {};
		var dict = MESSAGES[loc] || {};
		Object.keys(dict).forEach(function (key) {
			SOURCE[key] = true;
			var value = dict[key];
			if (value && !REVERSE[loc][value]) REVERSE[loc][value] = key;
		});
	});
	/* the same English source strings are keys in every dictionary */
	Object.keys(MESSAGES['zh-CN']).forEach(function (key) { SOURCE[key] = true; });

	var textSources = new WeakMap();
	var attrSources = new WeakMap();

	function normalizeLocale(tag) {
		var v = String(tag == null ? '' : tag).trim().replace(/_/g, '-').toLowerCase();
		if (v.indexOf('zh-hant') === 0 || v.indexOf('zh-tw') === 0 || v.indexOf('zh-hk') === 0) return 'zh-TW';
		if (v.indexOf('zh') === 0) return 'zh-CN';
		if (v.indexOf('ja') === 0) return 'ja';
		if (v.indexOf('ko') === 0) return 'ko';
		if (v.indexOf('en') === 0) return 'en';
		return 'en';
	}

	function currentLocale() {
		var raw = null;
		if (global.i18n && typeof global.i18n.getLocale === 'function') {
			try { raw = global.i18n.getLocale(); } catch (e) { raw = null; }
		}
		if (!raw) raw = global.localRangeLocale || docLang();
		return normalizeLocale(raw);
	}

	function docLang() {
		return global.document && global.document.documentElement ? global.document.documentElement.lang : 'en';
	}

	function dictionary() {
		return MESSAGES[currentLocale()] || {};
	}

	function interpolate(value, params) {
		if (!params) return value;
		return String(value).replace(/\{(\w+)\}/g, function (whole, name) {
			return params[name] == null ? whole : String(params[name]);
		});
	}

	function lookup(template, params) {
		var dict = dictionary();
		var value = dict[template];
		if (value == null) value = template;
		return interpolate(value, params);
	}

	function translate(value, params) {
		var source = String(value == null ? '' : value);
		var dict = dictionary();
		if (dict[source] != null) return interpolate(dict[source], params);
		var m;
		if ((m = source.match(/^ROUND (\d+)$/))) return lookup('ROUND {n}', { n: m[1] });
		if ((m = source.match(/^NEXT ROUND IN (\d+)$/))) return lookup('NEXT ROUND IN {n}', { n: m[1] });
		if ((m = source.match(/^BUY\s+\[\s*(\d+)\s*\]$/))) return lookup('BUY [{n}]', { n: m[1] });
		if ((m = source.match(/^(\d+) FPS · (\d+) BOTS$/))) return source;
		if ((m = source.match(/^(.+) acquired\.$/))) return lookup('{name} acquired.', { name: m[1] });
		if ((m = source.match(/^(.+) loaded\.$/))) return lookup('{name} loaded.', { name: m[1] });
		if ((m = source.match(/^Picked up (.+) ammo\.$/))) return lookup('Picked up {name} ammo.', { name: m[1] });
		if ((m = source.match(/^Picked up (.+)\.$/))) return lookup('Picked up {name}.', { name: m[1] });
		if ((m = source.match(/^Eliminated by (.+) \((.+)\)\.$/))) return lookup('Eliminated by {name} ({weapon}).', { name: m[1], weapon: m[2] });
		if ((m = source.match(/^Headshot by (.+) \((.+)\)\.$/))) return lookup('Headshot by {name} ({weapon}).', { name: m[1], weapon: m[2] });
		return source;
	}

	function sourceFor(text) {
		if (SOURCE[text]) return text;
		var rev = REVERSE[currentLocale()] || {};
		if (rev[text]) return rev[text];
		for (var i = 0; i < LOCALES.length; i++) {
			if (REVERSE[LOCALES[i]] && REVERSE[LOCALES[i]][text]) return REVERSE[LOCALES[i]][text];
		}
		return null;
	}

	function apply(root) {
		if (!root || !root.nodeType) return;
		var walker = global.document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: function (node) {
				if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
				var p = node.parentNode;
				if (!p) return NodeFilter.FILTER_REJECT;
				var tag = p.nodeName;
				if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
				if (p.closest && p.closest('[data-csr-i18n-skip]')) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});
		var node;
		while ((node = walker.nextNode())) {
			var raw = node.nodeValue;
			var core = raw.replace(/\s+/g, ' ').trim();
			var source = textSources.get(node);
			if (!source) {
				source = sourceFor(core);
				if (!source) {
					var probe = translate(core);
					if (probe === core) continue;
					source = core;
				}
				textSources.set(node, source);
			}
			var lead = (raw.match(/^\s*/) || [''])[0];
			var trail = (raw.match(/\s*$/) || [''])[0];
			var nextValue = lead + translate(source) + trail;
			if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
		}
		var attrs = ['aria-label', 'placeholder', 'title', 'alt'];
		var els = root.querySelectorAll ? root.querySelectorAll('[aria-label],[placeholder],[title],[alt]') : [];
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			var stored = attrSources.get(el);
			if (!stored) { stored = {}; attrSources.set(el, stored); }
			for (var a = 0; a < attrs.length; a++) {
				var attr = attrs[a];
				if (!el.hasAttribute(attr)) continue;
				var original = stored[attr];
				if (!original) {
					original = el.getAttribute(attr);
					var attrSource = sourceFor(original);
					if (!attrSource) {
						var p = translate(original);
						if (p === original) continue;
						attrSource = original;
					}
					stored[attr] = attrSource;
				}
				var out = translate(stored[attr]);
				if (el.getAttribute(attr) !== out) el.setAttribute(attr, out);
			}
		}
	}

	function remember(node, source) {
		if (node && source != null && node.nodeType === 3) textSources.set(node, String(source));
	}

	function setLocale(loc) {
		global.localRangeLocale = normalizeLocale(loc);
		return global.localRangeLocale;
	}

	global.CSRangeI18n = {
		locales: LOCALES,
		getLocale: currentLocale,
		setLocale: setLocale,
		t: translate,
		apply: apply,
		remember: remember,
		translate: translate
	};
})(window);
