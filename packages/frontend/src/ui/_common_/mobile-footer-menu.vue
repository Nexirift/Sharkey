<script lang="ts" setup>
import { computed, ref, useTemplateRef, watch } from 'vue';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { mainRouter } from '@/router.js';
import { navbarItemDef } from '@/navbar.js';
import { prefer } from '@/preferences.js';

const drawerMenuShowing = defineModel<boolean>('drawerMenuShowing');
const widgetsShowing = defineModel<boolean>('widgetsShowing');

const rootEl = useTemplateRef('rootEl');

const displayedItems = computed(() => {
	// Get all items from the menu preference (same as desktop navbar)
	// Use prefer.r for reactivity instead of prefer.s
	return prefer.r.mobileFooterMenu.value.filter(item => {
		// Filter out dividers and items that shouldn't be shown
		if (item === '-') return false;
		const def = navbarItemDef[item];
		return def && def.show !== false;
	});
});

const itemCount = computed(() => displayedItems.value.length);

const menuIndicated = computed(() => {
	for (const def in navbarItemDef) {
		if (def === 'notifications') continue; // 通知は下にボタンとして表示されてるから
		if (navbarItemDef[def].indicated) return true;
	}
	return false;
});

const rootElHeight = ref(0);

const isInChat = computed(() => {
	return mainRouter.currentRoute.value.path.startsWith('/chat');
});

function handleItemClick(item: string) {
	const def = navbarItemDef[item];
	// Special handling for widgets
	if (item === 'widgets') {
		widgetsShowing.value = true;
		return;
	}
	if (def.to) {
		mainRouter.push(def.to);
	} else if (def.action) {
		def.action();
	}
}

watch(rootEl, () => {
	if (rootEl.value) {
		rootElHeight.value = rootEl.value.offsetHeight;
		window.document.body.style.setProperty('--MI-minBottomSpacing', 'var(--MI-minBottomSpacingMobile)');
	} else {
		rootElHeight.value = 0;
		window.document.body.style.setProperty('--MI-minBottomSpacing', '0px');
	}
}, {
	immediate: true,
});
</script>

<template>
<div>
	<div ref="rootEl" :class="$style.root" :style="{ '--item-count': itemCount }">
		<button v-for="item in displayedItems" :key="item" :class="$style.item" class="_button" @click="handleItemClick(item)">
			<div :class="$style.itemInner">
				<i :class="[$style.itemIcon, navbarItemDef[item].icon]"></i>
				<span v-if="navbarItemDef[item].indicated" :class="$style.itemIndicator" class="_blink">
					<span v-if="navbarItemDef[item].indicateValue" class="_indicateCounter" :class="$style.itemIndicateValueIcon">{{ navbarItemDef[item].indicateValue }}</span>
					<i v-else class="_indicatorCircle"></i>
				</span>
			</div>
		</button>
	</div>

	<button v-if="!isInChat" :class="$style.floatingPost" class="_button" @click="os.post()">
		<i class="ti ti-pencil"></i>
	</button>
</div>
</template>

<style lang="scss" module>
.root {
	position: relative;
	z-index: 1;
	padding-bottom: env(safe-area-inset-bottom, 0px);
	display: flex;
	overflow-x: auto;
	overflow-y: hidden;
	width: 100%;
	box-sizing: border-box;
	background: var(--MI_THEME-navBg);
	color: var(--MI_THEME-navFg);
	box-shadow: 0px 0px 6px 6px #0000000f;
	scrollbar-width: none;
	
	&::-webkit-scrollbar {
		display: none;
	}
}

.item {
	padding: 12px;
	flex: 1;
	min-width: max(60px, calc(100% / var(--item-count)));
	max-width: 120px;

	&:first-child {
		padding-left: 16px;
	}

	&:last-child {
		padding-right: 16px;
	}
}

.itemInner {
	position: relative;
	padding: 0;
	aspect-ratio: 1;
	width: 100%;
	max-width: 42px;
	margin: auto;
	align-content: center;
	border-radius: 100%;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&:active {
		background: var(--MI_THEME-panelHighlight);
	}
}

.itemIcon {
	font-size: 14px;
}

.itemIndicator {
	position: absolute;
	bottom: -4px;
	left: 0;
	right: 0;
	color: var(--MI_THEME-indicator);
	font-size: 10px;
	pointer-events: none;

	&:has(.itemIndicateValueIcon) {
		animation: none;
		font-size: 8px;
	}
}

.floatingPost {
	position: fixed;
	bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
	right: 16px;
	width: 56px;
	height: 56px;
	border-radius: 50%;
	background: linear-gradient(90deg, var(--MI_THEME-buttonGradateA), var(--MI_THEME-buttonGradateB));
	color: var(--MI_THEME-fgOnAccent);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	z-index: 1000;
	font-size: 20px;

	&:hover {
		background: linear-gradient(90deg, hsl(from var(--MI_THEME-accent) h s calc(l + 5)), hsl(from var(--MI_THEME-accent) h s calc(l + 5)));
	}

	&:active {
		background: linear-gradient(90deg, hsl(from var(--MI_THEME-accent) h s calc(l + 5)), hsl(from var(--MI_THEME-accent) h s calc(l + 5)));
	}
}
</style>
