<!--
SPDX-FileCopyrightText: puniko and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="hide" :class="$style.mod_player_disabled" @click="toggleVisible()">
	<div>
		<b><i class="ph-eye ph-bold ph-lg"></i> {{ i18n.ts.sensitive }}</b>
		<span>{{ i18n.ts.clickToShow }}</span>
	</div>
</div>

<div v-else :class="$style.mod_player_enabled">
	<div :class="$style.pattern_display" @click="togglePattern()" @scroll="scrollHandler" @scrollend="scrollEndHandle">
		<div v-if="patternHide" :class="$style.pattern_hide">
			<b><i class="ph-eye ph-bold ph-lg"></i> Pattern Hidden</b>
			<span>{{ i18n.ts.clickToShow }}</span>
		</div>
		<span :class="$style.patternShadowTop"></span>
		<span :class="$style.patternShadowBottom"></span>
		<div ref="sliceDisplay" :class="$style.slice_display">
			<canvas ref="sliceCanvas1" :class="$style.patternSlice"></canvas>
			<canvas ref="sliceCanvas2" :class="$style.patternSlice"></canvas>
			<canvas ref="sliceCanvas3" :class="$style.patternSlice"></canvas>
		</div>
	</div>
	<div :class="$style.controls">
		<input v-if="patternScrollSliderShow" ref="patternScrollSlider" v-model="patternScrollSliderPos" :class="$style.pattern_slider" type="range" min="0" max="100" step="0.01" style=""/>
		<button :class="$style.play" @click="playPause()">
			<i v-if="playing" class="ph-pause ph-bold ph-lg"></i>
			<i v-else class="ph-play ph-bold ph-lg"></i>
		</button>
		<button :class="$style.stop" @click="stop()">
			<i class="ph-stop ph-bold ph-lg"></i>
		</button>
		<input ref="progress" v-model="position" :class="$style.progress" type="range" min="0" max="1" step="0.1" @mousedown="initSeek()" @mouseup="performSeek()"/>
		<input v-model="player.context.gain.value" type="range" min="0" max="1" step="0.1"/>
		<a :class="$style.download" :title="i18n.ts.download" :href="module.url" :download="module.name" target="_blank">
			<i class="ph-download ph-bold ph-lg"></i>
		</a>
	</div>
	<i :class="$style.hide" class="ph-eye-slash ph-bold ph-lg" @click="toggleVisible()"></i>
</div>
</template>

<script lang="ts" setup>
const debug = console.debug;
const debugw = console.warn;
const debug_playPause = playPause;

import { ref, nextTick, watch, onDeactivated, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import type { Ref } from 'vue';
import { i18n } from '@/i18n.js';
import { ChiptuneJsPlayer, ChiptuneJsConfig } from '@/utility/chiptune2.js';
import { isTouchUsing } from '@/utility/touch.js';
import { prefer } from '@/preferences.js';

const colours = {
	background: '#000000',
	foreground: {
		default: '#ffffff',
		quarter: '#ffff00',
		instr: '#80e0ff',
		volume: '#80ff80',
		fx: '#ff80e0',
		operant: '#ffe080',
	},
};

const CHAR_WIDTH = 6;
const CHAR_HEIGHT = 12;
const ROW_OFFSET_Y = 10;
const MAX_TIME_SPENT = 50;
const MAX_TIME_PER_ROW = 15;
const MAX_ROW_NUMBERS = 0xFF + 1;
const ROW_BUFFER = 26;
// It would be a great option for users to set themselves.
const MAX_CHANNEL_LIMIT = 0xFF;
const HALF_BUFFER = Math.floor(ROW_BUFFER / 2);

const props = defineProps<{
	module: Misskey.entities.DriveFile
}>();

interface CanvasDisplay {
	ctx: CanvasRenderingContext2D,
	html: HTMLCanvasElement,
	drawn: { top: number, bottom: number, left: number, right: number },
	range: { top: number, bottom: number },
	vPos: number,
	transform: { x: number, y: number },
	drawStart: number,
	channels: number,
}

const isSensitive = props.module.isSensitive;
const url = props.module.url;
let hide = ref((prefer.s.nsfw === 'force') ? true : isSensitive && (prefer.s.nsfw !== 'ignore'));
// Goto display function and set the default value there on the first frame.
// Yes, this is my solution to a problem. That or have a constant kicking round doing nothing of note.
let patternHide = ref(false);
let playing = ref(false);
let sliceDisplay = ref<HTMLDivElement>();
let sliceCanvas1 = ref();
let sliceCanvas2 = ref();
let sliceCanvas3 = ref();
let sliceWidth = 0;
let sliceHeight = 0;
let progress = ref<HTMLProgressElement>();
let position = ref(0);
let patternScrollSlider = ref<HTMLProgressElement>();
let patternScrollSliderShow = ref(false);
let patternScrollSliderPos = ref(0);
const player = ref(new ChiptuneJsPlayer(new ChiptuneJsConfig()));

let buffer = null;
let isSeeking = false;
let firstFrame = true;
let lastPattern = -1;
let lastDrawnRow = -1;
let numberRowCanvas = new OffscreenCanvas(2 * CHAR_WIDTH + 1, MAX_ROW_NUMBERS * CHAR_HEIGHT + 1);
let alreadyHiddenOnce = false;
let slices: CanvasDisplay[] = [];

const peft = {
	startTime: 0,
	patternTime: { current: 0, max: 0, initial: 0 },
	start: function() {
		this.startTime = performance.now();
	},
	end: function() {
		this.patternTime.current = performance.now() - this.startTime;
		if (this.patternTime.initial !== 0 && this.patternTime.current > this.patternTime.max) this.patternTime.max = this.patternTime.current;
		else if (this.patternTime.initial === 0) this.patternTime.initial = this.patternTime.current;
	},
	asses: function() {
		if (this.patternTime.initial !== 0 && !alreadyHiddenOnce) {
			const trackerTime = player.value.currentPlayingNode.getProcessTime();

			if (this.patternTime.initial + trackerTime.max > MAX_TIME_SPENT && trackerTime.max + this.patternTime.max > MAX_TIME_PER_ROW) {
				alreadyHiddenOnce = true;
				togglePattern();
				return;
			}
		}

		this.patternTime = { current: 0, max: 0, initial: 0 };
	},
};

function bakeNumberRow() {
	let ctx = numberRowCanvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
	ctx.font = '10px monospace';
	ctx.fillStyle = colours.background;
	ctx.fillRect( 0, 0, numberRowCanvas.width, numberRowCanvas.height );

	for (let i = 0; i <= MAX_ROW_NUMBERS; i++) {
		let rowText = i.toString(16);
		if (rowText.length === 1) rowText = '0' + rowText;

		ctx.fillStyle = colours.foreground.default;
		if (i % 4 === 0) ctx.fillStyle = colours.foreground.quarter;

		ctx.fillText(rowText, 0, 10 + i * 12);
	}
}

function setupSlice(r: Ref, channels: number) {
	let chtml = r.value as HTMLCanvasElement;
	chtml.width = sliceWidth;
	chtml.height = sliceHeight;
	let slice: CanvasDisplay = {
		ctx: chtml.getContext('2d', { alpha: false, desynchronized: false }) as CanvasRenderingContext2D,
		html: chtml,
		drawn: { top: 0, bottom: 0, left: 0, right: 0 },
		range: { top: -0xFFFFFFFF, bottom: -0xFFFFFFFF },
		vPos: -0xFFFFFFFF,
		channels,
		transform: { x: 0, y: 0 },
		drawStart: 0,
	};
	slice.ctx.font = '10px monospace';
	slice.ctx.imageSmoothingEnabled = false;
	slices.push(slice);
}

function setupCanvas() {
	if (sliceCanvas1.value && sliceCanvas2.value && sliceCanvas3.value) {
		let nbChannels = 0;
		if (player.value.currentPlayingNode) {
			nbChannels = player.value.currentPlayingNode.nbChannels;
			nbChannels = nbChannels > MAX_CHANNEL_LIMIT ? MAX_CHANNEL_LIMIT : nbChannels;
		}
		sliceWidth = numberRowCanvas.width + (14 * CHAR_WIDTH) * nbChannels + 2;
		sliceHeight = HALF_BUFFER * CHAR_HEIGHT;
		setupSlice(sliceCanvas1, nbChannels);
		setupSlice(sliceCanvas2, nbChannels);
		setupSlice(sliceCanvas3, nbChannels);
	} else {
		nextTick(() => {
			debugw('Jumped to the next tick, is Vue ok?');
			setupCanvas();
		});
	}
}

onMounted(() => {
	player.value.load(url).then((result) => {
		buffer = result;
		try {
			player.value.play(buffer);
			progress.value!.max = player.value.duration();
			bakeNumberRow();
			//populateCanvasSlices();
			setupCanvas();
			display(true);
		} catch (err) {
			console.warn(err);
		}
		player.value.stop();
	}).catch((error) => {
		console.error(error);
	});
});

function playPause() {
	player.value.addHandler('onRowChange', () => {
		progress.value!.max = player.value.duration();
		if (!isSeeking) {
			position.value = player.value.position() % player.value.duration();
		}
		display();
	});

	player.value.addHandler('onEnded', () => {
		stop();
	});

	if (player.value.currentPlayingNode === null) {
		player.value.play(buffer);
		player.value.seek(position.value);
		playing.value = true;
	} else {
		player.value.togglePause();
		playing.value = !player.value.currentPlayingNode.paused;
	}
}

function stop(noDisplayUpdate = false) {
	player.value.stop();
	playing.value = false;
	if (!noDisplayUpdate) {
		try {
			player.value.play(buffer);
			lastDrawnRow = -1;
			lastPattern = -1;
			display(true);
		} catch (err) {
			console.warn(err);
		}
	}
	player.value.stop();
	position.value = 0;
	player.value.handlers = [];
}

function initSeek() {
	isSeeking = true;
}

function performSeek(forceUpate = false) {
	const noNode = !player.value.currentPlayingNode;
	if (noNode) player.value.play(buffer);
	player.value.seek(position.value);
	if (!patternHide.value || forceUpate) display(true);
	if (noNode) player.value.stop();
	isSeeking = false;
}

function toggleVisible() {
	hide.value = !hide.value;
	if (!hide.value) {
		lastPattern = -1;
		lastDrawnRow = -1;
		nextTick(() => {
			playPause();
		});
	}
	nextTick(() => { stop(hide.value); });
}

function togglePattern() {
	patternHide.value = !patternHide.value;
	handleScrollBarEnable();

	if (player.value.getRow() === 0 && player.value.getPattern() === 0) {
		try {
			performSeek(true);
		} catch (err) {
			console.warn(err);
		}
		player.value.stop();
	}
}

function drawSlices(skipOptimizationChecks = false) {
	if (ROW_BUFFER <= 0) {
		lastDrawnRow = player.value.getPattern();
		lastPattern = player.value.getRow();
		return;
	}

	const pattern = player.value.getPattern();
	const row = player.value.getRow();
	const lower = row + HALF_BUFFER;
	const upper = row - HALF_BUFFER;
	const newDisplayTanslalation = -row * CHAR_HEIGHT;
	let curRow = row - HALF_BUFFER;

	if (pattern === lastPattern && !skipOptimizationChecks && row !== lastDrawnRow) {
		const rowDif = row - lastDrawnRow;
		const isRowDirPos = rowDif > 0;
		const rowDir = !isRowDirPos as unknown as number;
		const rowDirInv = 1 - 1 * rowDir;
		const norm = 1 - 2 * rowDir;
		const oneAndHalfBuf = HALF_BUFFER * 3;

		//debug('rowDif', rowDif, 'rowDir', rowDir, 'norm', norm, 'isRowDirPos', isRowDirPos);

		slices.forEach((sli) => {
			sli.vPos -= rowDif;
			if (sli.vPos <= 0 || sli.vPos >= oneAndHalfBuf) {
				sli.drawStart += oneAndHalfBuf * norm;
				sli.vPos = oneAndHalfBuf * rowDirInv;
				sli.transform.y += (oneAndHalfBuf * CHAR_HEIGHT) * norm;
				sli.html.style.transform = 'translateY(' + sli.transform.y + 'px)';
				sli.drawn = {
					top: 0xFFFFFFFF,
					bottom: -0xFFFFFFFF,
					left: -0xFFFFFFFF,
					right: -0xFFFFFFFF,
				};

				sli.ctx.fillStyle = colours.background;
				sli.ctx.fillRect(0, 0, sliceWidth, sliceHeight);
				sli.ctx.drawImage(numberRowCanvas, 0, -CHAR_HEIGHT * sli.drawStart);

				//debug(sli);
			}
			for (let i = 0; i < HALF_BUFFER; i++) {
				const newRow = sli.drawStart + i;

				if (sli.drawn.bottom >= newRow && sli.drawn.top <= newRow || newRow < upper || newRow < upper) continue;
				if (sli.drawn.top > newRow) sli.drawn.top = newRow;
				if (sli.drawn.bottom <= newRow) sli.drawn.bottom = newRow;

				drawRow(sli, newRow, pattern, (2 * CHAR_WIDTH), i * CHAR_HEIGHT + ROW_OFFSET_Y);
			}
		});
		//debug_playPause();
	} else {
		slices.forEach((sli, i) => {
			sli.drawStart = curRow;
			sli.vPos = HALF_BUFFER * (i + 1);
			sli.transform.y = -newDisplayTanslalation;
			sli.html.style.transform = 'translateY(' + sli.transform.y + 'px)';
			sli.drawn = {
				top: 0xFFFFFFFF,
				bottom: -0xFFFFFFFF,
				left: -0xFFFFFFFF,
				right: -0xFFFFFFFF,
			};

			sli.ctx.fillStyle = colours.background;
			sli.ctx.fillRect(0, 0, sliceWidth, sliceHeight);
			sli.ctx.drawImage(numberRowCanvas, 0, -CHAR_HEIGHT * curRow);

			for (let itter = 0; itter < HALF_BUFFER; itter++) {
				if (sli.drawn.top > curRow) sli.drawn.top = curRow;
				if (sli.drawn.bottom <= curRow) sli.drawn.bottom = curRow;
				drawRow(sli, curRow, pattern, (2 * CHAR_WIDTH), itter * CHAR_HEIGHT + ROW_OFFSET_Y);
				curRow++;
				if (curRow > lower) break;
			}
			//debug(sli);
		});
	}

	if (sliceDisplay.value) sliceDisplay.value.style.transform = 'translateY(' + newDisplayTanslalation + 'px)';

	lastDrawnRow = row;
	lastPattern = pattern;
}

function drawRow(slice: CanvasDisplay, row: number, pattern: number, drawX = (2 * CHAR_WIDTH), drawY = ROW_OFFSET_Y) {
	if (!player.value.currentPlayingNode) return false;
	if (row < 0 || row > player.value.getPatternNumRows(pattern) - 1) return false;
	const spacer = 11;
	const space = ' ';
	let seperators = '';
	let note = '';
	let instr = '';
	let volume = '';
	let fx = '';
	let op = '';
	for (let channel = 0; channel < slice.channels; channel++) {
		if (channel > 9) break;
		const part = player.value.getPatternRowChannel(pattern, row, channel);

		seperators += '|' + space.repeat( spacer + 2 );
		note += part.substring(0, 3) + space.repeat( spacer );
		instr += part.substring(4, 6) + space.repeat( spacer + 1 );
		volume += part.substring(6, 9) + space.repeat( spacer );
		fx += part.substring(10, 11) + space.repeat( spacer + 2 );
		op += part.substring(11, 13) + space.repeat( spacer + 1 );
	}

	//console.debug( 'seperators: ' + seperators + '\nnote: ' + note + '\ninstr: ' + instr + '\nvolume: ' + volume + '\nfx: ' + fx + '\nop: ' + op);

	//slice.ctx.fillStyle = '#ff00ff88';
	//slice.ctx.fillRect(0, drawY - CHAR_HEIGHT, 512, CHAR_HEIGHT);

	slice.ctx.fillStyle = colours.foreground.default;
	slice.ctx.fillText(seperators, drawX, drawY);

	slice.ctx.fillStyle = colours.foreground.default;
	slice.ctx.fillText(note, drawX + CHAR_WIDTH, drawY);

	slice.ctx.fillStyle = colours.foreground.instr;
	slice.ctx.fillText(instr, drawX + CHAR_WIDTH * 5, drawY);

	slice.ctx.fillStyle = colours.foreground.volume;
	slice.ctx.fillText(volume, drawX + CHAR_WIDTH * 7, drawY);

	slice.ctx.fillStyle = colours.foreground.fx;
	slice.ctx.fillText(fx, drawX + CHAR_WIDTH * 11, drawY);

	slice.ctx.fillStyle = colours.foreground.operant;
	slice.ctx.fillText(op, drawX + CHAR_WIDTH * 12, drawY);

	return true;
}

function display(skipOptimizationChecks = false) {
	if (!sliceDisplay.value || !sliceDisplay.value.parentElement) {
		stop();
		return;
	}

	if (patternHide.value && !skipOptimizationChecks) return;

	if (firstFrame) {
		// Changing it to false should enable pattern display by default.
		patternHide.value = false;
		handleScrollBarEnable();
		firstFrame = false;
	}

	const row = player.value.getRow();
	const pattern = player.value.getPattern();

	if ( row === lastDrawnRow && pattern === lastPattern && !skipOptimizationChecks) return;

	drawSlices(skipOptimizationChecks);
}

let suppressScrollSliderWatcher = false;

function scrollHandler() {
	suppressScrollSliderWatcher = true;

	if (!patternScrollSlider.value) return;
	if (!sliceDisplay.value) return;
	if (!sliceDisplay.value.parentElement) return;

	patternScrollSliderPos.value = (sliceDisplay.value.parentElement.scrollLeft) / (sliceWidth - sliceDisplay.value.parentElement.offsetWidth) * 100;
	patternScrollSlider.value.style.opacity = '1';
}

function scrollEndHandle() {
	suppressScrollSliderWatcher = false;

	if (!patternScrollSlider.value) return;
	patternScrollSlider.value.style.opacity = '';
}

function handleScrollBarEnable() {
	patternScrollSliderShow.value = (!patternHide.value && !isTouchUsing);
	if (patternScrollSliderShow.value !== true) return;

	if (!sliceDisplay.value || !sliceDisplay.value.parentElement) return;
	patternScrollSliderShow.value = (sliceWidth > sliceDisplay.value.parentElement.offsetWidth);
}

watch(patternScrollSliderPos, () => {
	if (suppressScrollSliderWatcher) return;
	if (!sliceDisplay.value) return;
	if (!sliceDisplay.value.parentElement) return;

	sliceDisplay.value.parentElement.scrollLeft = (sliceWidth - sliceDisplay.value.parentElement.offsetWidth) * patternScrollSliderPos.value / 100;
});

onDeactivated(() => {
	stop();
});

</script>

<style lang="scss" module>

.hide {
	border-radius: var(--MI-radius-sm) !important;
	background-color: black !important;
	color: var(--MI_THEME-indicator) !important;
	font-size: 12px !important;
}

.mod_player_enabled {
	position: relative;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	justify-content: center;

	> i {
		display: block;
		position: absolute;
		border-radius: var(--MI-radius-sm);
		background-color: var(--MI_THEME-fg);
		color: var(--MI_THEME-indicator);
		font-size: 14px;
		opacity: .5;
		padding: 3px 6px;
		text-align: center;
		cursor: pointer;
		top: 12px;
		right: 12px;
		z-index: 4;
	}

	> .pattern_display {
		width: 100%;
		height: 100%;
		overflow-x: scroll;
		overflow-y: hidden;
		background-color: black;
		text-align: center;
		max-height: 312px; /* magic_number = CHAR_HEIGHT * rowBuffer, needs to be in px */

		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
		}

		.slice_display {
			display: grid;
			position: relative;
			background-color: black;
			image-rendering: pixelated;

			.patternSlice {
				image-rendering: pixelated;
			}
		}

		.patternShadowTop {
			background: #00000080;
			width: 100%;
			height: calc(50% - 14px);
			translate: -50% -100%;
			top: calc(50% - 14px);
			position: absolute;
			pointer-events: none;
			z-index: 2;
			display: none;
		}

		.patternShadowBottom {
			background: #00000080;
			width: 100%;
			height: calc(50% - 27px);
			translate: -50% 0;
			top: calc(50% - 2px);
			position: absolute;
			pointer-events: none;
			z-index: 2;
			display: none;
		}

		.pattern_hide {
			display: flex;
			flex-direction: column;
			justify-content: center;
			align-items: center;
			background: rgba(64, 64, 64, 0.3);
			backdrop-filter: var(--MI-modalBgFilter);
			color: #fff;
			font-size: 12px;

			position: absolute;
			z-index: 4;
			width: 100%;
			height: 100%;

			> span {
				display: block;
			}
		}
	}

	> .controls {
		display: flex;
		width: 100%;
		background-color: var(--MI_THEME-bg);
		z-index: 5;

		> * {
			padding: 4px 8px;
		}

		> button, a {
			border: none;
			background-color: transparent;
			color: var(--MI_THEME-accent);
			cursor: pointer;

			&:hover {
				background-color: var(--MI_THEME-fg);
			}
		}

		> input[type=range] {
			height: 21px;
			-webkit-appearance: none;
			width: 90px;
			padding: 0;
			margin: 4px 8px;
			overflow-x: hidden;

			&.pattern_slider {
				position: absolute;
				width: calc( 100% - 8px * 2 );
				top: calc( 100% - 21px * 3 );
				opacity: 0%;
				transition: opacity 0.2s;

				&:hover {
					opacity: 100%;
				}
			}

			&:focus {
				outline: none;

				&::-webkit-slider-runnable-track {
					background: var(--MI_THEME-bg);
				}

				&::-ms-fill-lower, &::-ms-fill-upper {
					background: var(--MI_THEME-bg);
				}
			}

			&::-webkit-slider-runnable-track {
				width: 100%;
				height: 100%;
				cursor: pointer;
				border-radius: 0;
				animate: 0.2s;
				background: var(--MI_THEME-bg);
				border: 1px solid var(--MI_THEME-fg);
				overflow-x: hidden;
			}

			&::-webkit-slider-thumb {
				border: none;
				height: 100%;
				width: 14px;
				border-radius: 0;
				background: var(--MI_THEME-indicator);
				cursor: pointer;
				-webkit-appearance: none;
				box-shadow: calc(-100vw - 14px) 0 0 100vw var(--MI_THEME-accent);
				clip-path: polygon(1px 0, 100% 0, 100% 100%, 1px 100%, 1px calc(50% + 10.5px), -100vw calc(50% + 10.5px), -100vw calc(50% - 10.5px), 0 calc(50% - 10.5px));
				z-index: 1;
			}

			&::-moz-range-track {
				width: 100%;
				height: 100%;
				cursor: pointer;
				border-radius: 0;
				animate: 0.2s;
				background: var(--MI_THEME-bg);
				border: 1px solid var(--MI_THEME-fg);
			}

			&::-moz-range-progress {
				cursor: pointer;
				height: 100%;
				background: var(--MI_THEME-accent);
			}

			&::-moz-range-thumb {
				border: none;
				height: 100%;
				border-radius: 0;
				width: 14px;
				background: var(--MI_THEME-indicator);
				cursor: pointer;
			}

			&::-ms-track {
				width: 100%;
				height: 100%;
				cursor: pointer;
				border-radius: 0;
				animate: 0.2s;
				background: transparent;
				border-color: transparent;
				color: transparent;
			}

			&::-ms-fill-lower {
				background: var(--MI_THEME-accent);
				border: 1px solid var(--MI_THEME-fg);
				border-radius: 0;
			}

			&::-ms-fill-upper {
				background: var(--MI_THEME-bg);
				border: 1px solid var(--MI_THEME-fg);
				border-radius: 0;
			}

			&::-ms-thumb {
				margin-top: 1px;
				border: none;
				height: 100%;
				width: 14px;
				border-radius: 0;
				background: var(--MI_THEME-indicator);
				cursor: pointer;
			}

			&.progress {
				flex-grow: 1;
				min-width: 0;
			}
		}
	}
}

.mod_player_disabled {
	display: flex;
	justify-content: center;
	align-items: center;
	background: #111;
	color: #fff;

	> div {
		display: table-cell;
		text-align: center;
		font-size: 12px;

		> b {
			display: block;
		}
	}
}
</style>
