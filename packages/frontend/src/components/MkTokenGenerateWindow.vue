<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="500"
	:height="600"
	:withOkButton="true"
	:okButtonDisabled="false"
	:canClose="false"
	@close="dialog?.close()"
	@closed="emit('closed')"
	@ok="ok()"
>
	<template #header>{{ title || i18n.ts.generateAccessToken }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<div v-if="information">
				<MkInfo warn>{{ information }}</MkInfo>
			</div>
			<div>
				<MkInput v-model="name">
					<template #label>{{ i18n.ts.name }}</template>
					<template #caption>{{ i18n.ts.accessTokenNameDescription }}</template>
				</MkInput>
			</div>

			<MkSelect v-if="$i?.isAdmin" v-model="rank">
				<template #label>{{ i18n.ts.overrideRank }}</template>
				<template #caption>{{ i18n.ts.overrideRankDescription }}</template>

				<option value="admin">{{ i18n.ts._ranks.admin }}</option>
				<option value="mod">{{ i18n.ts._ranks.mod }}</option>
				<option value="user">{{ i18n.ts._ranks.user }}</option>
			</MkSelect>

			<MkSelect v-else v-model="rank">
				<template #label>{{ i18n.ts.overrideRank }}</template>
				<template #caption>{{ i18n.ts.overrideRankDescription }}</template>

				<option value="mod">{{ i18n.ts._ranks.mod }}</option>
				<option value="user">{{ i18n.ts._ranks.user }}</option>
			</MkSelect>

			<MkFolder v-if="enableSharedAccess !== false" :defaultOpen="enableSharedAccess === true">
				<template #label>{{ i18n.ts.sharedAccess }}</template>
				<template #suffix>{{ grantees.length || i18n.ts.none }}</template>

				<div class="_gaps_s">
					<div>{{ i18n.ts.sharedAccessDescription }}</div>

					<MkButton primary @click="addGrantee">
						<i class="ti ti-plus"></i> {{ i18n.ts.addGrantee }}
					</MkButton>

					<div v-for="(grantee, i) of grantees" :key="grantee.id" :class="$style.grantee">
						<MkUserCardMini :user="grantee" :withChart="false"/>
						<button v-tooltip="i18n.ts.removeGrantee" class="_textButton" @click="() => removeGrantee(i)"><i class="ti ti-x"></i></button>
					</div>
				</div>
			</MkFolder>

			<MkFolder>
				<template #label>{{ i18n.ts.permission }}</template>
				<template #suffix>{{ permsCount || i18n.ts.none }}</template>

				<div class="_gaps_s">
					<div>{{ i18n.ts.permissionsDescription }}</div>

					<div class="_buttons">
						<MkButton inline @click="disableAll">{{ i18n.ts.disableAll }}</MkButton>
						<MkButton inline @click="enableAll">{{ i18n.ts.enableAll }}</MkButton>
					</div>

					<MkSwitch v-for="kind in Object.keys(permissionSwitches)" :key="kind" v-model="permissionSwitches[kind]">{{ i18n.ts._permissions[kind] }}</MkSwitch>
				</div>
			</MkFolder>

			<MkFolder v-if="iAmAdmin">
				<template #label>{{ i18n.ts.adminPermission }}</template>
				<template #suffix>{{ adminPermsCount || i18n.ts.none }}</template>

				<div class="_gaps_s">
					<div>{{ i18n.ts.adminPermissionsDescription }}</div>

					<div class="_buttons">
						<MkButton inline :disabled="rank !== 'admin'" @click="disableAllAdmin">{{ i18n.ts.disableAll }}</MkButton>
						<MkButton inline :disabled="rank !== 'admin'" @click="enableAllAdmin">{{ i18n.ts.enableAll }}</MkButton>
					</div>

					<MkSwitch
						v-for="kind in Object.keys(permissionSwitchesForAdmin)"
						:key="kind"
						v-model="permissionSwitchesForAdmin[kind]"
						:disabled="rank !== 'admin'"
					>
						{{ i18n.ts._permissions[kind] }}
					</MkSwitch>
				</div>
			</MkFolder>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef, ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkInput from './MkInput.vue';
import MkSwitch from './MkSwitch.vue';
import MkButton from './MkButton.vue';
import MkInfo from './MkInfo.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';
import { $i, iAmAdmin } from '@/i.js';
import MkFolder from '@/components/MkFolder.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import MkSelect from '@/components/MkSelect.vue';
import * as os from '@/os.js';

const props = withDefaults(defineProps<{
	title?: string | null;
	information?: string | null;
	initialName?: string | null;
	initialPermissions?: (typeof Misskey.permissions)[number][] | null;
	enableSharedAccess?: boolean | null;
}>(), {
	title: null,
	information: null,
	initialName: null,
	initialPermissions: null,
	enableSharedAccess: null,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
	(ev: 'done', result: { name: string | null, permissions: string[], grantees: string[], rank: string }): void;
}>();

const defaultPermissions = Misskey.permissions.filter(p => !p.startsWith('read:admin') && !p.startsWith('write:admin'));
const adminPermissions = Misskey.permissions.filter(p => p.startsWith('read:admin') || p.startsWith('write:admin'));

const dialog = useTemplateRef('dialog');
const name = ref(props.initialName);
const permissionSwitches = ref({} as Record<(typeof Misskey.permissions)[number], boolean>);
const permissionSwitchesForAdmin = ref({} as Record<(typeof Misskey.permissions)[number], boolean>);
const grantees = ref<Misskey.entities.User[]>([]);
const rank = ref<'admin' | 'mod' | 'user'>(
	$i?.isAdmin
		? 'admin'
		: $i?.isModerator
			? 'mod'
			: 'user');
const permsCount = computed(() => Object.values(permissionSwitches.value).reduce((sum, active) => active ? sum + 1 : sum, 0));
const adminPermsCount = computed(() => Object.values(permissionSwitchesForAdmin.value).reduce((sum, active) => active ? sum + 1 : sum, 0));

if (props.initialPermissions) {
	for (const kind of props.initialPermissions) {
		permissionSwitches.value[kind] = true;
	}
} else {
	for (const kind of defaultPermissions) {
		permissionSwitches.value[kind] = false;
	}

	if (iAmAdmin) {
		for (const kind of adminPermissions) {
			permissionSwitchesForAdmin.value[kind] = false;
		}
	}
}

function ok(): void {
	emit('done', {
		name: name.value,
		permissions: [
			...Object.keys(permissionSwitches.value).filter(p => permissionSwitches.value[p]),
			...((iAmAdmin && rank.value === 'admin') ? Object.keys(permissionSwitchesForAdmin.value).filter(p => permissionSwitchesForAdmin.value[p]) : []),
		],
		grantees: grantees.value.map(g => g.id),
		rank: rank.value,
	});
	dialog.value?.close();
}

function disableAll(): void {
	for (const p in permissionSwitches.value) {
		permissionSwitches.value[p] = false;
	}
}

function disableAllAdmin(): void {
	if (iAmAdmin) {
		for (const p in permissionSwitchesForAdmin.value) {
			permissionSwitchesForAdmin.value[p] = false;
		}
	}
}

function enableAll(): void {
	for (const p in permissionSwitches.value) {
		permissionSwitches.value[p] = true;
	}
}

function enableAllAdmin(): void {
	if (iAmAdmin) {
		for (const p in permissionSwitchesForAdmin.value) {
			permissionSwitchesForAdmin.value[p] = true;
		}
	}
}

async function addGrantee(): Promise<void> {
	const user = await os.selectUser({
		localOnly: true,
	});
	grantees.value.push(user);
}

function removeGrantee(index: number) {
	grantees.value.splice(index, 1);
}
</script>

<style module lang="scss">
.adminPermissions {
	margin: 8px -6px 0;
	padding: 24px 6px 6px;
	border: 2px solid var(--MI_THEME-error);
	border-radius: calc(var(--MI-radius) / 2);
}

.adminPermissionsHeader {
	margin: -34px 0 6px 12px;
	padding: 0 4px;
	width: fit-content;
	color: var(--MI_THEME-error);
	background: var(--MI_THEME-panel);
}

.grantee {
	display: flex;
	flex-direction: row;
	gap: var(--MI-marginHalf);
}
</style>
