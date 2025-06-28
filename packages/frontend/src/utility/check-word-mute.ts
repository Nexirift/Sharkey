/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { inject } from 'vue';
import type { Ref } from 'vue';
import { $i } from '@/i';

export interface Mute {
	hardMuted?: boolean;
	softMutedWords?: string[];
	sensitiveMuted?: boolean;

	isSensitive?: boolean;

	threadMuted?: boolean;
	noteMuted?: boolean;

	noteMandatoryCW?: string | null;
	// TODO show this as a single block on user timelines
	userMandatoryCW?: string | null;
	instanceMandatoryCW?: string | null;
}

export function checkMute(note: Misskey.entities.Note, withHardMute?: boolean): Mute {
	const sensitiveMuted = isSensitiveMuted(note);

	// My own note
	if ($i && $i.id === note.userId) {
		return { sensitiveMuted };
	}

	const threadMuted = note.isMutingThread;
	const noteMuted = note.isMutingNote;
	const noteMandatoryCW = note.mandatoryCW;
	const userMandatoryCW = note.user.mandatoryCW;
	const instanceMandatoryCW = note.user.instance?.mandatoryCW;

	// Hard mute
	if (withHardMute && isHardMuted(note)) {
		return { hardMuted: true, sensitiveMuted, threadMuted, noteMuted, noteMandatoryCW, userMandatoryCW, instanceMandatoryCW };
	}

	// Soft mute
	const softMutedWords = isSoftMuted(note);
	if (softMutedWords.length > 0) {
		return { softMutedWords, sensitiveMuted, threadMuted, noteMuted, noteMandatoryCW, userMandatoryCW, instanceMandatoryCW };
	}

	// Other / no mute
	return { sensitiveMuted, threadMuted, noteMuted, noteMandatoryCW, userMandatoryCW, instanceMandatoryCW };
}

function isHardMuted(note: Misskey.entities.Note): boolean {
	if (!$i?.hardMutedWords.length) return false;

	return containsMutedWord($i.hardMutedWords, note);
}

function isSoftMuted(note: Misskey.entities.Note): string[] {
	if (!$i?.mutedWords.length) return [];

	return getMutedWords($i.mutedWords, note);
}

function isSensitiveMuted(note: Misskey.entities.Note): boolean {
	// 1. At least one sensitive file
	if (!note.files) return false;
	if (!note.files.some((v) => v.isSensitive)) return false;

	// 2. In a timeline
	const inTimeline = inject<boolean>('inTimeline', false);
	if (!inTimeline) return false;

	// 3. With sensitive files hidden
	const tl_withSensitive = inject<Ref<boolean> | null>('tl_withSensitive', null);
	return tl_withSensitive?.value === false;
}

function getMutedWords(mutedWords: (string | string[])[], note: Misskey.entities.Note): string[] {
	// Parse mutes
	const { regexMutes, patternMutes } = parseMutes(mutedWords);

	// Make sure we didn't filter them all out
	if (regexMutes.length < 1 && patternMutes.length < 1) {
		return [];
	}

	const matches = new Set<string>();

	// Expand notes into searchable test
	for (const text of expandNote(note)) {
		for (const pattern of patternMutes) {
			// Case-sensitive, non-boundary search for backwards compatibility
			if (pattern.every(word => text.includes(word))) {
				const muteLabel = pattern.join(' ');
				matches.add(muteLabel);
			}
		}

		for (const regex of regexMutes) {
			for (const match of text.matchAll(regex)) {
				matches.add(match[0]);
			}
		}
	}

	return Array.from(matches);
}

function containsMutedWord(mutedWords: (string | string[])[], note: Misskey.entities.Note): boolean {
	// Parse mutes
	const { regexMutes, patternMutes } = parseMutes(mutedWords);

	// Make sure we didn't filter them all out
	if (regexMutes.length < 1 && patternMutes.length < 1) {
		return false;
	}

	// Expand notes into searchable test
	for (const text of expandNote(note)) {
		for (const pattern of patternMutes) {
			// Case-sensitive, non-boundary search for backwards compatibility
			if (pattern.every(word => text.includes(word))) {
				return true;
			}
		}

		if (regexMutes.some(regex => text.match(regex))) {
			return true;
		}
	}

	return false;
}

function *expandNote(note: Misskey.entities.Note): Generator<string> {
	if (note.cw) yield note.cw;
	if (note.text) yield note.text;
	if (note.files) {
		for (const file of note.files) {
			if (file.comment) yield file.comment;
		}
	}
	if (note.poll) {
		for (const choice of note.poll.choices) {
			if (choice.text) yield choice.text;
		}
	}
	if (note.reply) {
		yield * expandNote(note.reply);
	}
	if (note.renote) {
		yield * expandNote(note.renote);
	}
}

function parseMutes(mutedWords: (string | string[])[]) {
	const regexMutes: RegExp[] = [];
	const patternMutes: string[][] = [];

	for (const mute of mutedWords) {
		if (Array.isArray(mute)) {
			if (mute.length > 0) {
				const filtered = mute.filter(keyword => keyword !== '');
				if (filtered.length > 0) {
					patternMutes.push(filtered);
				} else {
					console.warn('Skipping invalid pattern mute:', mute);
				}
			}
		} else {
			const parsed = mute.match(/^\/(.+)\/(.*)$/);
			if (parsed && parsed.length === 3) {
				try {
					const flags = parsed[2].includes('g') ? parsed[2] : `${parsed[2]}g`;
					regexMutes.push(new RegExp(parsed[1], flags));
				} catch {
					console.warn('Skipping invalid regexp mute:', mute);
				}
			}
		}
	}

	return { regexMutes, patternMutes };
}
