<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/mobile-footer-menu" :label="i18n.ts.mobileFooterMenu" icon="ti ti-list" :keywords="['bottom navbar', 'mobile', 'menu', 'footer']">
	<div class="_gaps_m">
		<FormSlot>
			<template #label>{{ i18n.ts.mobileFooterMenu }}</template>
			<MkContainer :showHeader="false">
				<Sortable
					v-model="items"
					itemKey="id"
					:animation="150"
					:handle="'.' + $style.itemHandle"
					@start="e => e.item.classList.add('active')"
					@end="e => e.item.classList.remove('active')"
				>
					<template #item="{element,index}">
						<div
							v-if="element.type === '-' || navbarItemDef[element.type]"
							:class="$style.item"
						>
							<button class="_button" :class="$style.itemHandle"><i class="ti ti-menu"></i></button>
							<i class="ti-fw" :class="[$style.itemIcon, navbarItemDef[element.type]?.icon]"></i><span :class="$style.itemText">{{ navbarItemDef[element.type]?.title ?? i18n.ts.divider }}</span>
							<button class="_button" :class="$style.itemRemove" @click="removeItem(index)"><i class="ti ti-x"></i></button>
						</div>
					</template>
				</Sortable>
			</MkContainer>
		</FormSlot>
		<div class="_buttons">
			<MkButton @click="addItem"><i class="ti ti-plus"></i> {{ i18n.ts.addItem }}</MkButton>
			<MkButton danger @click="reset"><i class="ti ti-reload"></i> {{ i18n.ts.default }}</MkButton>
			<MkButton primary class="save" @click="save"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
		</div>

	<MkInfo>{{ i18n.ts._settings.mobileFooterMenuInfo }}</MkInfo>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import FormSlot from '@/components/form/slot.vue';
import MkContainer from '@/components/MkContainer.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { navbarItemDef } from '@/navbar.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { prefer } from '@/preferences.js';
import { PREF_DEF } from '@/preferences/def.js';

const Sortable = defineAsyncComponent(() => import('vuedraggable').then(x => x.default));

const items = ref((prefer.s.mobileFooterMenu ?? PREF_DEF.mobileFooterMenu.default).map(x => ({
	id: Math.random().toString(),
	type: x,
})));

async function addItem() {
	const menu = Object.keys(navbarItemDef).filter(k => !(prefer.s.mobileFooterMenu ?? []).includes(k));
	const { canceled, result: item } = await os.select({
		title: i18n.ts.addItem,
		items: [...menu.map(k => ({
			value: k, text: navbarItemDef[k].title,
		})), {
			value: '-', text: i18n.ts.divider,
		}],
	});
	if (canceled) return;
	items.value = [...items.value, {
		id: Math.random().toString(),
		type: item,
	}];
}

function removeItem(index: number) {
	items.value.splice(index, 1);
}

async function save() {
	prefer.commit('mobileFooterMenu', items.value.map(x => x.type));
}

function reset() {
	items.value = PREF_DEF.mobileFooterMenu.default.map(x => ({
		id: Math.random().toString(),
		type: x,
	}));
}

definePage(() => ({
	title: i18n.ts.mobileFooterMenu,
	icon: 'ti ti-list',
}));
</script>

<style lang="scss" module>
.item {
	position: relative;
	display: block;
	line-height: 2.85rem;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
	color: var(--MI_THEME-navFg);
}

.itemIcon {
	position: relative;
	width: 32px;
	margin-right: 8px;
}

.itemText {
	position: relative;
	font-size: 0.9em;
}

.itemRemove {
	position: absolute;
	z-index: 10000;
	width: 32px;
	height: 32px;
	color: #ff2a2a;
	right: 8px;
	opacity: 0.8;
}

.itemHandle {
	cursor: move;
	width: 32px;
	height: 32px;
	margin: 0 8px;
	opacity: 0.5;
}
</style>
