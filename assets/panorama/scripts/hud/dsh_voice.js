"use strict";

// CS2 Demo Analyst — 游戏内说话者语音 HUD（自研，独立实现）
//
// 数据: DshVoiceData（会话 VPK 注入: pulsesBySlot[slot] = [tick...]）
// 同步: 每 50ms 读 DemoController.GetDemoControllerState().nTick（实时，暂停/跳转/倍速对齐）
// 玩家: GameStateAPI（名字/阵营/头像），slot 对应 demo 实体索引-1
//
// 布局（仿 CS2 原生语音指示器）:
//   - 右下角，从下往上排：第一个人（最先说话的）在最低行，后续说话者向上堆
//   - 说完话消失；上方未说完的行位置不动（固定槽位 + 绝对定位）
//   - 新说话者优先占用空闲槽位，无空位则向上新增一行
var DshVoiceHud = (function () {
	var _started = false;
	var _players = []; // { slot, xuid, name, team }
	var _rows = []; // 槽位行: { slot(说话者实体槽), panel, avatar, name }
	var _rowCount = 0; // 当前已分配行数（动态增长，最多 10）
	var _MAX_ROWS = 10;

	function _Context() {
		return $.GetContextPanel();
	}

	function _Panel(id) {
		var ctx = _Context();
		return ctx ? ctx.FindChildTraverse(id) : null;
	}

	function _DemoController() {
		var list = _Panel("DshVoiceList");
		var panel = list && list.GetParent ? list.GetParent() : _Context();
		for (var depth = 0; panel && depth < 6; depth++) {
			if (panel.IsPlayingDemo || panel.GetDemoControllerState) return panel;
			panel = panel.GetParent ? panel.GetParent() : null;
		}
		return _Context();
	}

	function _VoiceData() {
		if (typeof DshVoiceData === "undefined" || !DshVoiceData) return null;
		if (Number(DshVoiceData.schemaVersion) !== 1 || !DshVoiceData.pulsesBySlot) return null;
		return DshVoiceData;
	}

	function _LatestAtOrBefore(ticks, tick) {
		if (!ticks || ticks.length === 0) return -1;
		var lo = 0, hi = ticks.length - 1, result = -1;
		while (lo <= hi) {
			var mid = (lo + hi) >> 1;
			if (Number(ticks[mid]) <= tick) {
				result = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return result;
	}

	function _SpeakingSlots(state, data) {
		var result = [];
		if (!state || !data || !isFinite(Number(state.nTick))) return result;
		var tick = Math.floor(Number(state.nTick));
		var hold = Math.max(1, Math.floor(Number(data.holdTicks || 30)));
		for (var key in data.pulsesBySlot) {
			if (!data.pulsesBySlot.hasOwnProperty(key)) continue;
			var slot = Number(key);
			if (!isFinite(slot) || slot < 0 || slot >= 64) continue;
			var ticks = data.pulsesBySlot[key];
			var idx = _LatestAtOrBefore(ticks, tick);
			if (idx < 0) continue;
			var age = tick - Number(ticks[idx]);
			if (age >= 0 && age <= hold) result.push(slot);
		}
		result.sort(function (a, b) { return a - b; });
		return result;
	}

	function _ReadPlayers() {
		var result = [];
		var data = null;
		try {
			data = GameStateAPI.GetPlayerDataJSO();
		} catch (e) {
			return result;
		}
		if (!data || !data.players) return result;
		var seen = {};
		for (var i = 0; i < data.players.length; i++) {
			var src = data.players[i];
			var xuid = src && src.xuid ? String(src.xuid) : "";
			if (!xuid || xuid === "0") continue;
			var slot = _ResolvePlayerSlot(xuid, src);
			if (slot < 0 || seen[slot]) continue;
			seen[slot] = true;
			var name = "";
			var team = "";
			try { name = GameStateAPI.GetPlayerName(xuid) || ""; } catch (e) {}
			try { team = GameStateAPI.GetPlayerTeamName(xuid) || ""; } catch (e) {}
			if (!name && src.name) name = String(src.name);
			result.push({ slot: slot, xuid: xuid, name: name, team: team });
		}
		result.sort(function (a, b) { return a.slot - b.slot; });
		return result;
	}

	/** slot 解析 fallback 链（与平台 demo 玩家表缺失情况兼容） */
	function _ResolvePlayerSlot(xuid, source) {
		var slot = -1;
		try { slot = Number(GameStateAPI.GetPlayerSlot(xuid)); } catch (e) { slot = -1; }
		if (isFinite(slot) && slot >= 0 && slot < 64) return Math.floor(slot);
		if (source) {
			var s1 = Number(source.slot);
			if (isFinite(s1) && s1 >= 0 && s1 < 64) return Math.floor(s1);
			var s2 = Number(source.player_slot);
			if (isFinite(s2) && s2 >= 0 && s2 < 64) return Math.floor(s2);
		}
		try {
			var stats = GameStateAPI.GetPlayerStatsJSO(xuid);
			var s3 = Number(stats && stats.slot);
			if (isFinite(s3) && s3 >= 0 && s3 < 64) return Math.floor(s3);
		} catch (e) {}
		try {
			if (GameStateAPI.GetPlayerXuidStringFromPlayerSlot) {
				for (var c = 0; c < 64; c++) {
					if (String(GameStateAPI.GetPlayerXuidStringFromPlayerSlot(c) || "") === xuid) return c;
				}
			}
		} catch (e) {}
		return -1;
	}

	function _TeamClass(team) {
		if (team === "TERRORIST") return "team-t";
		if (team === "CT") return "team-ct";
		return "team-spec";
	}

	function _PlayerForSlot(slot) {
		for (var i = 0; i < _players.length; i++) {
			if (_players[i].slot === slot) return _players[i];
		}
		return null;
	}

	// ─── 固定槽位行管理 ───
	// 布局: list 容器 flow-children: down（可靠），行的 DOM 顺序 = 视觉从上到下。
	// 说话顺序映射: 最新说话者总是被 MoveChildAfter 移到列表顶部 →
	//   第一个说话者在最底部，后续说话者依次向上堆（用户要求"从下往上排"）。
	// 行创建后始终保留占位（opacity 控制显隐）→ 说完消失时其他行不跳动；
	// 说话者说完释放槽位；新说话者优先占用空闲槽位（从底部起），无空位则向上新增行。

	/** 确保第 i 行存在 */
	function _EnsureRow(i) {
		if (_rows[i]) return _rows[i];
		var list = _Panel("DshVoiceList");
		if (!list) return null;
		var item = $.CreatePanel("Panel", list, "DshVoiceItem_" + i);
		if (!item || !item.BLoadLayoutSnippet || !item.BLoadLayoutSnippet("DshSpeakingRow")) {
			if (item) item.DeleteAsync(0);
			return null;
		}
		item.AddClass("dsh-voice-item");
		var row = {
			slot: -1, // 当前占用的说话者实体槽
			panel: item,
			avatar: item.FindChildTraverse("DshRowAvatar"),
			name: item.FindChildTraverse("DshRowName")
		};
		_rows[i] = row;
		return row;
	}

	/** 把行移到列表顶部（最新说话者排最上 → 最早的说话者沉底） */
	function _MoveRowToTop(i) {
		var list = _Panel("DshVoiceList");
		var row = _rows[i];
		if (!list || !row) return;
		try {
			var first = list.GetChild(0);
			if (first && first !== row.panel && list.MoveChildBefore) {
				list.MoveChildBefore(row.panel, first);
			}
		} catch (e) {
			$.Msg("[DshVoiceHud] move failed: " + e);
		}
	}

	/** 找空闲槽位（从底部起找第一个未被占用的行）；没有则尝试扩一行 */
	function _FindFreeRow() {
		for (var i = 0; i < _rowCount; i++) {
			if (_rows[i] && _rows[i].slot < 0) return i;
		}
		if (_rowCount < _MAX_ROWS) {
			var r = _EnsureRow(_rowCount);
			if (r) {
				_rowCount++;
				return _rowCount - 1;
			}
		}
		return -1;
	}

	/** 说话者是否已占用某行 */
	function _RowIndexForSlot(slot) {
		for (var i = 0; i < _rows.length; i++) {
			if (_rows[i] && _rows[i].slot === slot) return i;
		}
		return -1;
	}

	function _HideRow(i) {
		var row = _rows[i];
		if (!row) return;
		if (row.panel.BHasClass("visible")) row.panel.RemoveClass("visible");
		row.slot = -1;
	}

	function _ShowRow(i, slot, player) {
		var row = _EnsureRow(i);
		if (!row) return;
		var wasHidden = row.slot < 0;
		row.slot = slot;
		var displayName = player && player.name ? player.name : "Player " + (slot + 1);
		if (row.name && row.name.text !== displayName) row.name.text = displayName;
		var team = player ? player.team : "";
		row.panel.RemoveClass("team-t");
		row.panel.RemoveClass("team-ct");
		row.panel.RemoveClass("team-spec");
		row.panel.AddClass(_TeamClass(team));
		if (player && player.xuid && row.avatar && row.avatar.PopulateFromSteamID) {
			try { row.avatar.PopulateFromSteamID(player.xuid); } catch (e) {}
		}
		if (!row.panel.BHasClass("visible")) row.panel.AddClass("visible");
		// 新说话者（刚占用槽位）移到列表顶部 → 保持"最新说话者在上、最早的沉底"
		if (wasHidden) _MoveRowToTop(i);
	}

	/** 渲染：释放已停说的行 → 为新说话者分配槽位 → 更新内容 */
	function _Render(slots) {
		// ① 释放：已不在说话列表中的行隐藏、槽位清空
		for (var i = 0; i < _rows.length; i++) {
			if (_rows[i] && _rows[i].slot >= 0) {
				var still = false;
				for (var s = 0; s < slots.length; s++) {
					if (slots[s] === _rows[i].slot) { still = true; break; }
				}
				if (!still) _HideRow(i);
			}
		}
		// ② 分配：新说话者按 slots 升序，从底部起占用空闲槽位（先说者优先底部）
		for (var j = 0; j < slots.length; j++) {
			var slot = slots[j];
			if (_RowIndexForSlot(slot) >= 0) continue; // 已在显示
			var free = _FindFreeRow();
			if (free < 0) continue; // 无空位（最多 _MAX_ROWS 行）
			var player = _PlayerForSlot(slot);
			_ShowRow(free, slot, player);
		}
		// ③ 内容刷新（玩家名/阵营延迟解析时更新）
		for (var k = 0; k < _rows.length; k++) {
			if (_rows[k] && _rows[k].slot >= 0) {
				var p = _PlayerForSlot(_rows[k].slot);
				if (p) _ShowRow(k, _rows[k].slot, p);
			}
		}
	}

	function _Poll() {
		$.Schedule(0.05, _Poll);
		var data = null;
		var state = null;
		try {
			data = _VoiceData();
			var controller = _DemoController();
			if (controller && controller.GetDemoControllerState) {
				state = controller.GetDemoControllerState();
			}
			var slots = data && state ? _SpeakingSlots(state, data) : [];
			_Render(slots);
		} catch (e) {
			$.Msg("[DshVoiceHud] poll failed: " + e);
		}
	}

	// 玩家表低频刷新（50ms 轮询只算说话者；玩家信息 750ms 更新一次）
	function _SlowPoll() {
		$.Schedule(0.75, _SlowPoll);
		try {
			_players = _ReadPlayers();
			var data = _VoiceData();
			var controller = _DemoController();
			var state = controller && controller.GetDemoControllerState ? controller.GetDemoControllerState() : null;
			var slots = data && state ? _SpeakingSlots(state, data) : [];
			_Render(slots);
		} catch (e) {
			$.Msg("[DshVoiceHud] slow poll failed: " + e);
		}
	}

	function OnLoad() {
		if (_started) return;
		_started = true;
		_players = _ReadPlayers();
		$.Schedule(0.1, _Poll);
		$.Schedule(0.5, _SlowPoll);
		$.Msg("[DshVoiceHud] loaded");
	}

	return {
		OnLoad: OnLoad
	};
})();

$.Schedule(0.0, DshVoiceHud.OnLoad);
