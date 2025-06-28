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
	<div v-else-if="!mute.hardMuted" :class="[$style.muted, mutedClass]" class="_gaps_s" @click.stop="expandNote = true">
		<!-- Mandatory CWs -->
		<I18n v-if="mute.userMandatoryCW" :src="i18n.ts.userIsFlaggedAs" tag="small">
			<template #name>
				<MkUserName :user="note.user"/>
			</template>
			<template #cw>
				{{ mute.userMandatoryCW }}
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
import type { Ref } from 'vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { checkMute } from '@/utility/check-word-mute';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	withHardMute?: boolean;
	mutedClass?: string | string[] | Record<string, boolean> | (string | string[] | Record<string, boolean>)[];
	expandedClass?: string | string[] | Record<string, boolean> | (string | string[] | Record<string, boolean>)[];
}>(), {
	withHardMute: true,
	mutedClass: undefined,
	expandedClass: undefined,
});

const expandNote = ref(false);

const mute = computed(() => checkMute(props.note, props.withHardMute));
const mutedWords = computed(() => mute.value.softMutedWords?.join(', '));
const isMuted = computed(() => mute.value.hardMuted || mutedWords.value || mute.value.userMandatoryCW || mute.value.noteMuted || mute.value.threadMuted || mute.value.sensitiveMuted);
const isExpanded = computed(() => expandNote.value || !isMuted.value);
const rootClass = computed(() => isExpanded.value ? props.expandedClass : undefined);

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
</style>
