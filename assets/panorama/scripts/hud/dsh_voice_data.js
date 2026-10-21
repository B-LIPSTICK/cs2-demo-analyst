"use strict";

// 占位语音数据（静态 VPK）。每次播放时由会话 VPK 覆盖（SearchPath 优先级更高）。
var DshVoiceData = {
	schemaVersion: 1,
	generated: false,
	holdTicks: 30,
	voicePacketCount: 0,
	malformedPacketCount: 0,
	pulsesBySlot: {},
	players: {},
	// 静音 HUD 默认 badge：静音选手显示头像与禁言标志；hide 则完全隐藏说话者。
	mutedSlots: [],
	muteMode: "badge"
};
