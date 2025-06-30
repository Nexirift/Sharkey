<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only

Displays a placeholder for a muted note.
-->

<template>
<div ref="rootEl" :class="rootClass">
	<!-- The actual note (or whatever we're wrapping) will render here. -->
	<slot v-if="isExpanded"></slot>

	<!-- If hard muted, we want to hide *everything*, including the placeholders and controls to expand. -->
	<div v-else-if="!mute.hardMuted" :class="[$style.muted, $style.muteContainer, mutedClass]" @click.stop="expand">
		<!-- Mandatory CWs -->
		<I18n v-if="mute.noteMandatoryCW" :src="i18n.ts.noteIsFlaggedAs" tag="small">
			<template #cw>
				{{ mute.noteMandatoryCW }}
			</template>
		</I18n>
		<I18n v-if="mute.userMandatoryCW" :src="i18n.ts.userIsFlaggedAs" tag="small">
			<template #name>
				<MkUserName :user="note.user"/>
			</template>
			<template #cw>
				{{ mute.userMandatoryCW }}
			</template>
		</I18n>
		<I18n v-if="mute.instanceMandatoryCW" :src="i18n.ts.instanceIsFlaggedAs" tag="small">
			<template #name>
				{{ instanceName }}
			</template>
			<template #cw>
				{{ mute.instanceMandatoryCW }}
			</template>
		</I18n>

		<!-- Muted notes/threads -->
		<I18n v-if="mute.noteMuted" :src="i18n.ts.userSaysSomethingInMutedNote" tag="small">
			<template #name>
				<MkUserName :user="note.user"/>
			</template>
		</I18n>
		<I18n v-else-if="mute.threadMuted" :src="i18n.ts.userSaysSomethingInMutedThread" tag="small">
			<template #name>
				<MkUserName :user="note.user"/>
			</template>
		</I18n>

		<!-- Word mutes -->
		<template v-if="mutedWords">
			<I18n v-if="prefer.s.showSoftWordMutedWord" :src="i18n.ts.userSaysSomethingAbout" tag="small">
				<template #name>
					<MkUserName :user="note.user"/>
				</template>
				<template #word>
					{{ mutedWords }}
				</template>
			</I18n>
			<I18n v-else :src="i18n.ts.userSaysSomething" tag="small">
				<template #name>
					<MkUserName :user="note.user"/>
				</template>
			</I18n>
		</template>

		<!-- Sensitive mute -->
		<I18n v-if="mute.sensitiveMuted" :src="i18n.ts.userSaysSomethingSensitive" tag="small">
			<template #name>
				<MkUserName :user="note.user"/>
			</template>
		</I18n>
	</div>
</div>
</template>

<script setup lang="ts">
import * as Misskey from 'misskey-js';
import { computed, ref, useTemplateRef, defineExpose } from 'vue';
import { host } from '@@/js/config.js';
import type { Ref } from 'vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { checkMute } from '@/utility/check-word-mute.js';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	withHardMute?: boolean;
	dive?: boolean;
	mutedClass?: string | string[] | Record<string, boolean> | (string | string[] | Record<string, boolean>)[];
	expandedClass?: string | string[] | Record<string, boolean> | (string | string[] | Record<string, boolean>)[];
}>(), {
	withHardMute: true,
	dive: true,
	mutedClass: undefined,
	expandedClass: undefined,
});

const emit = defineEmits<{
	(type: 'expandMute', note: Misskey.entities.Note): void;
}>();

const expandNote = ref(false);

function expand() {
	expandNote.value = true;
	emit('expandMute', props.note);
}

const mute = checkMute(
	computed(() => props.note),
	computed(() => props.withHardMute),
	computed(() => props.dive),
);

const mutedWords = computed(() => mute.value.softMutedWords?.join(', '));
const isExpanded = computed(() => expandNote.value || !mute.value.hasMute);
const rootClass = computed(() => isExpanded.value ? props.expandedClass : undefined);

const instanceName = computed(() => {
	if (props.note.user.instance?.name) {
		if (props.note.user.instance.name.length <= 32) {
			return props.note.user.instance.name;
		}

		return `${props.note.user.instance.name.substring(0, 30)}...`;
	}

	return props.note.user.host ?? host;
});

const rootEl = useTemplateRef('rootEl');
defineExpose({
	rootEl: rootEl as Ref<HTMLElement | null>,
});
</script>

<style module lang="scss">
.muted {
	padding: 8px;
	text-align: center;
	opacity: 0.7;
	cursor: pointer;
}

.muted:hover {
	background: var(--MI_THEME-buttonBg);
}

.muteContainer > :not(:first-child) {
	margin-left: 0.75rem;

	&:before {
		content: "•";
		margin-right: 0.75rem;
		font-size: 1rem;
	}
}
</style>
