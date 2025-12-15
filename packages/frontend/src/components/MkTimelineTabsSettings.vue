<!--
SPDX-FileCopyrightText: nexirift pulsar team
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="500"
	:height="550"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._initialTutorial._timeline.customizeTabs }}</template>
	
	<div :class="$style.root">
		<MkInfo>{{ i18n.ts._initialTutorial._timeline.customizeTabsDescription }}</MkInfo>
		
		<MkSwitch v-model="prefer.r.timelineTabIconOnly.value">
			<template #label>{{ i18n.ts._initialTutorial._timeline.iconOnlyTabs }}</template>
			<template #caption>{{ i18n.ts._initialTutorial._timeline.iconOnlyTabsDescription }}</template>
		</MkSwitch>
		
		<MkContainer :showHeader="false">
			<Sortable
				v-model="items"
				itemKey="id"
				:animation="150"
				:handle="'.' + $style.itemHandle"
				@start="e => e.item.classList.add('active')"
				@end="e => e.item.classList.remove('active')"
			>
				<template #item="{element}">
					<div :class="[$style.item, { [$style.itemUnavailable]: !isTimelineAvailable(element.type) }]">
						<button class="_button" :class="$style.itemHandle"><i class="ti ti-menu"></i></button>
						<i class="ti-fw" :class="[$style.itemIcon, getTabIcon(element.type)]"></i>
						<span :class="$style.itemText">{{ getTabLabel(element.type) }}</span>
						<button 
							class="_button" 
							:class="[$style.itemButton, { [$style.itemButtonActive]: element.visible }]"
							@click="toggleVisibility(element.type, !element.visible)"
						>
							<i class="ti ti-eye" v-if="element.visible"></i>
							<i class="ti ti-eye-off" v-else></i>
						</button>
					</div>
				</template>
			</Sortable>
		</MkContainer>
		
		<div class="_buttons">
			<MkButton danger @click="reset"><i class="ti ti-reload"></i> {{ i18n.ts.default }}</MkButton>
			<MkButton primary @click="save"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, shallowRef } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkContainer from '@/components/MkContainer.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { PREF_DEF } from '@/preferences/def.js';
import { basicTimelineTypes, basicTimelineIconClass, isAvailableBasicTimeline, isBasicTimeline } from '@/timelines.js';
import type { BasicTimelineType } from '@/timelines.js';

const Sortable = defineAsyncComponent(() => import('vuedraggable').then(x => x.default));

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = shallowRef<InstanceType<typeof MkModalWindow>>();

const items = ref(
	(prefer.r.timelineTabs.value ?? PREF_DEF.timelineTabs.default).map(tab => ({
		id: tab.id,
		type: tab.id,
		visible: tab.visible,
	}))
);

function getTabIcon(type: string): string {
	if (isBasicTimeline(type)) {
		return basicTimelineIconClass(type as BasicTimelineType);
	}
	switch (type) {
		case 'lists':
			return 'ti ti-list';
		case 'antennas':
			return 'ti ti-antenna';
		case 'channels':
			return 'ti ti-device-tv';
		case 'following':
			return 'ph-user-check ph-bold ph-lg';
		default:
			return 'ti ti-home';
	}
}

function getTabLabel(type: string): string {
	if (isBasicTimeline(type)) {
		return i18n.ts._timelines[type] ?? type;
	}
	switch (type) {
		case 'lists':
			return i18n.ts.lists;
		case 'antennas':
			return i18n.ts.antennas;
		case 'channels':
			return i18n.ts.channel;
		case 'following':
			return i18n.ts.following;
		default:
			return type;
	}
}

function isTimelineAvailable(type: string): boolean {
	// Non-basic timelines (lists, antennas, etc.) are always available
	if (!isBasicTimeline(type)) {
		return true;
	}
	// Check if basic timeline is available based on user policies
	return isAvailableBasicTimeline(type as BasicTimelineType);
}

function toggleVisibility(type: string, visible: boolean) {
	const item = items.value.find(i => i.type === type);
	if (item) {
		item.visible = visible;
	}
}

async function save() {
	const tabs = items.value.map(item => ({
		id: item.type,
		visible: item.visible,
	}));
	
    prefer.r.timelineTabs.value = tabs; // investigate why this is required even when commit is used
	await prefer.commit('timelineTabs', tabs);
	dialog.value?.close();
}

async function reset() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.resetAreYouSure,
	});
	if (canceled) return;

	items.value = PREF_DEF.timelineTabs.default.map(tab => ({
		id: tab.id,
		type: tab.id as BasicTimelineType,
		visible: tab.visible,
	}));
}
</script>

<style lang="scss" module>
.root {
	padding: 24px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.item {
	position: relative;
	display: flex;
	align-items: center;
	line-height: 2.85rem;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
	color: var(--MI_THEME-navFg);
	
	&:global(.active) {
		z-index: 1;
	}
}

.itemUnavailable {
	opacity: 0.5;
}

.itemHandle {
	cursor: grab;
	width: 32px;
	height: 32px;
	margin: 0 8px;
	opacity: 0.5;
	
	&:active {
		cursor: grabbing;
	}
}

.itemIcon {
	position: relative;
	width: 32px;
	margin-right: 8px;
}

.itemText {
	position: relative;
	flex: 1;
	font-size: 0.9em;
}

.itemButton {
	width: 32px;
	height: 32px;
	margin-right: 8px;
	opacity: 0.5;
	
	&.itemButtonActive {
		opacity: 1;
		color: var(--MI_THEME-accent);
	}
	
	&:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
}
</style>
