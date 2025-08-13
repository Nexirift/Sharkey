/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '@/core/CacheService.js';
import type { MiNote } from '@/models/Note.js';
import type { MiUser } from '@/models/User.js';
import { MiInstance } from '@/models/Instance.js';
import { bindThis } from '@/decorators.js';
import { Packed } from '@/misc/json-schema.js';
import { IdService } from '@/core/IdService.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import type { MiFollowing, NotesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';

/**
 * Visibility level for a given user towards a given post.
 */
export interface NoteVisibilityResult {
	/**
	 * Whether the user has access to view this post.
	 */
	accessible: boolean;

	/**
	 * If the user should be shown only a redacted version of the post.
	 * (see NoteEntityService.hideNote() for details.)
	 */
	redact: boolean;

	/**
	 * If false, the note should be visible by default. (normal case)
	 * If true, the note should be hidden by default. (Silences, mutes, etc.)
	 * If "timeline", the note should be hidden in timelines only. (following w/o replies)
	 */
	silence: boolean;
}

export interface NoteVisibilityFilters {
	/**
	 * If false, exclude replies to other users unless the "include replies to others in timeline" has been enabled for the note's author.
	 * If true (default), then replies are treated like any other post.
	 */
	includeReplies?: boolean;

	/**
	 * If true, treat the note's author as never being silenced. Does not apply to reply or renote targets, unless they're by the same author.
	 * If false (default), then silence is enforced for all notes.
	 */
	includeSilencedAuthor?: boolean;
}

@Injectable()
export class NoteVisibilityService {
	constructor(
		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		private readonly cacheService: CacheService,
		private readonly idService: IdService,
		private readonly federatedInstanceService: FederatedInstanceService,
	) {}

	@bindThis
	public async checkNoteVisibilityAsync(note: MiNote | Packed<'Note'>, user: string | PopulatedUser, opts?: { filters?: NoteVisibilityFilters, hint?: Partial<NoteVisibilityData> }): Promise<NoteVisibilityResult> {
		if (typeof(user) === 'string') {
			user = await this.cacheService.findUserById(user);
		}

		const populatedNote = await this.populateNote(note);
		const populatedData = await this.populateData(user, opts?.hint ?? {});

		return this.checkNoteVisibility(populatedNote, user, { filters: opts?.filters, data: populatedData });
	}

	private async populateNote(note: Packed<'Note'>, dive?: boolean): Promise<Packed<'Note'>>;
	private async populateNote(note: MiNote, dive?: boolean): Promise<PopulatedMiNote>;
	private async populateNote(note: MiNote | Packed<'Note'>, dive?: boolean): Promise<PopulatedNote>;
	private async populateNote(note: MiNote | Packed<'Note'>, dive = true): Promise<PopulatedNote> {
		// Packed<'Note'> is already fully loaded
		if (isPackedNote(note)) return note;

		// noinspection ES6MissingAwait
		return await awaitAll({
			...note,
			user: this.getNoteUser(note),
			renote: dive ? this.getNoteRenote(note) : null,
			reply: dive ? this.getNoteReply(note) : null,
		});
	}

	private async getNoteUser(note: MiNote): Promise<PopulatedMiNote['user']> {
		const user = note.user ?? await this.cacheService.findUserById(note.userId);
		return {
			...user,
			instance: user.instance ?? (user.host ? await this.federatedInstanceService.fetchOrRegister(user.host) : null),
		};
	}

	private async getNoteRenote(note: MiNote): Promise<PopulatedMiNote['renote']> {
		if (!note.renoteId) return null;

		const renote = note.renote ?? await this.notesRepository.findOneOrFail({
			where: { id: note.renoteId },
			relations: {
				user: {
					instance: true,
				},
			},
		});

		return await this.populateNote(renote, false);
	}

	private async getNoteReply(note: MiNote): Promise<PopulatedMiNote['reply']> {
		if (!note.replyId) return null;

		const reply = note.reply ?? await this.notesRepository.findOneOrFail({
			where: { id: note.replyId },
			relations: {
				user: {
					instance: true,
				},
			},
		});

		return await this.populateNote(reply, false);
	}

	@bindThis
	public async populateData(user: PopulatedUser, hint?: Partial<NoteVisibilityData>): Promise<NoteVisibilityData> {
		// noinspection ES6MissingAwait
		const [
			userBlockers,
			userFollowings,
			userMutedThreads,
			userMutedNotes,
			userMutedUsers,
			userMutedUserRenotes,
			userMutedInstances,
		] = await Promise.all([
			user ? (hint?.userBlockers ?? this.cacheService.userBlockedCache.fetch(user.id)) : null,
			user ? (hint?.userFollowings ?? this.cacheService.userFollowingsCache.fetch(user.id)) : null,
			user ? (hint?.userMutedThreads ?? this.cacheService.threadMutingsCache.fetch(user.id)) : null,
			user ? (hint?.userMutedNotes ?? this.cacheService.noteMutingsCache.fetch(user.id)) : null,
			user ? (hint?.userMutedUsers ?? this.cacheService.userMutingsCache.fetch(user.id)) : null,
			user ? (hint?.userMutedUserRenotes ?? this.cacheService.renoteMutingsCache.fetch(user.id)) : null,
			user ? (hint?.userMutedInstances ?? this.cacheService.userProfileCache.fetch(user.id).then(p => new Set(p.mutedInstances))) : null,
		]);

		return {
			userBlockers,
			userFollowings,
			userMutedThreads,
			userMutedNotes,
			userMutedUsers,
			userMutedUserRenotes,
			userMutedInstances,
		};
	}

	@bindThis
	public checkNoteVisibility(note: PopulatedNote, user: PopulatedUser, opts: { filters?: NoteVisibilityFilters, data: NoteVisibilityData }): NoteVisibilityResult {
		// Copy note since we mutate it below
		note = {
			...note,
			renote: note.renote ? { ...note.renote } : null,
			reply: note.reply ? { ...note.reply } : null,
		} as PopulatedNote;

		this.syncVisibility(note);

		const accessible = this.isAccessible(note, user, opts.data);
		const redact = this.shouldRedact(note, user, opts.data);
		const silence = this.shouldSilence(note, user, opts.data, opts.filters);

		const baseVisibility = { accessible, redact, silence };

		// For boosts (pure renotes), we must recurse and pick the lowest common access level.
		if (isPopulatedBoost(note)) {
			const boostVisibility = this.checkNoteVisibility(note.renote, user, opts);
			return {
				accessible: baseVisibility.accessible && boostVisibility.accessible,
				redact: baseVisibility.redact || boostVisibility.redact,
				silence: baseVisibility.silence || boostVisibility.silence,
			};
		}

		return baseVisibility;
	}

	// Based on NoteEntityService.isVisibleForMe
	private isAccessible(note: PopulatedNote, user: PopulatedUser, data: NoteVisibilityData): boolean {
		// We can always view our own notes
		if (user?.id === note.userId) return true;

		// We can *never* view blocked notes
		if (data.userBlockers?.has(note.userId)) return false;

		if (note.visibility === 'specified') {
			return this.isAccessibleDM(note, user);
		} else if (note.visibility === 'followers') {
			return this.isAccessibleFO(note, user, data);
		} else {
			return true;
		}
	}

	private isAccessibleDM(note: PopulatedNote, user: PopulatedUser): boolean {
		// Must be logged in to view DM
		if (user == null) return false;

		// Can be visible to me
		if (note.visibleUserIds?.includes(user.id)) return true;

		// Otherwise invisible
		return false;
	}

	private isAccessibleFO(note: PopulatedNote, user: PopulatedUser, data: NoteVisibilityData): boolean {
		// Must be logged in to view FO
		if (user == null) return false;

		// Can be a reply to me
		if (note.reply?.userId === user.id) return true;

		// Can mention me
		if (note.mentions?.includes(user.id)) return true;

		// Can be visible to me
		if (note.visibleUserIds?.includes(user.id)) return true;

		// Can be followed by me
		if (data.userFollowings?.has(note.userId)) return true;

		// Can be two remote users, since we can't verify remote->remote following.
		if (note.userHost != null && user.host != null) return true;

		// Otherwise invisible
		return false;
	}

	// Based on NoteEntityService.treatVisibility
	@bindThis
	public syncVisibility(note: PopulatedNote): void {
		// Make followers-only
		if (note.user.makeNotesFollowersOnlyBefore && note.visibility !== 'specified' && note.visibility !== 'followers') {
			const followersOnlyBefore = note.user.makeNotesFollowersOnlyBefore * 1000;
			const createdAt = 'createdAt' in note
				? new Date(note.createdAt).getTime()
				: this.idService.parse(note.id).date.getTime();

			// I don't understand this logic, but I tried to break it out for readability
			const followersOnlyOpt1 = followersOnlyBefore <= 0 && (Date.now() - createdAt > 0 - followersOnlyBefore);
			const followersOnlyOpt2 = followersOnlyBefore > 0 && (createdAt < followersOnlyBefore);
			if (followersOnlyOpt1 || followersOnlyOpt2) {
				note.visibility = 'followers';
			}
		}

		// Recurse
		if (note.renote) {
			this.syncVisibility(note.renote);
		}
		if (note.reply) {
			this.syncVisibility(note.reply);
		}
	}

	// Based on NoteEntityService.hideNote
	private shouldRedact(note: PopulatedNote, user: PopulatedUser, data: NoteVisibilityData): boolean {
		// Never redact our own notes
		if (user?.id === note.userId) return false;

		// Redact if sign-in required
		if (note.user.requireSigninToViewContents && !user) return true;

		// Redact if note has expired
		if (note.user.makeNotesHiddenBefore) {
			const hiddenBefore = note.user.makeNotesHiddenBefore * 1000;
			const createdAt = 'createdAt' in note
				? new Date(note.createdAt).getTime()
				: this.idService.parse(note.id).date.getTime();

			// I don't understand this logic, but I tried to break it out for readability
			const hiddenOpt1 = hiddenBefore <= 0 && (Date.now() - createdAt > 0 - hiddenBefore);
			const hiddenOpt2 = hiddenBefore > 0 && (createdAt < hiddenBefore);
			if (hiddenOpt1 || hiddenOpt2) return true;
		}

		// Redact if inaccessible.
		// We have to repeat the check in case note visibility changed in treatVisibility!
		if (!this.isAccessible(note, user, data)) {
			return true;
		}

		// Otherwise don't redact
		return false;
	}

	// Based on inconsistent logic from all around the app
	private shouldSilence(note: PopulatedNote, user: PopulatedUser, data: NoteVisibilityData, filters: NoteVisibilityFilters | undefined): boolean {
		if (this.shouldSilenceForMute(note, data)) {
			return true;
		}

		if (this.shouldSilenceForSilence(note, user, data, filters?.includeSilencedAuthor ?? false)) {
			return true;
		}

		if (!filters?.includeReplies && this.shouldSilenceForFollowWithoutReplies(note, user, data)) {
			return true;
		}

		return false;
	}

	private shouldSilenceForMute(note: PopulatedNote, data: NoteVisibilityData): boolean {
		// Silence if we've muted the thread
		if (data.userMutedThreads?.has(note.threadId ?? note.id)) return true;

		// Silence if we've muted the note
		if (data.userMutedNotes?.has(note.id)) return true;

		// Silence if we've muted the user
		if (data.userMutedUsers?.has(note.userId)) return true;

		// Silence if we've muted renotes from the user
		if (isPopulatedBoost(note) && data.userMutedUserRenotes?.has(note.userId)) return true;

		// Silence if we've muted the instance
		if (note.userHost && data.userMutedInstances?.has(note.userHost)) return true;

		// Otherwise don't silence
		return false;
	}

	private shouldSilenceForSilence(note: PopulatedNote, user: PopulatedUser, data: NoteVisibilityData, includeSilencedAuthor: boolean): boolean {
		// Don't silence if it's us
		if (note.userId === user?.id) return false;

		// Don't silence if we're following
		if (data.userFollowings?.has(note.userId)) return false;

		if (!includeSilencedAuthor) {
			// Silence if user is silenced
			if (note.user.isSilenced) return true;

			// Silence if user instance is silenced
			if (note.user.instance?.isSilenced) return true;
		}

		// Silence if renote is silenced
		if (note.renote && note.renote.userId !== note.userId && this.shouldSilenceForSilence(note.renote, user, data, false)) return true;

		// Silence if reply is silenced
		if (note.reply && note.reply.userId !== note.userId && this.shouldSilenceForSilence(note.reply, user, data, false)) return true;

		// Otherwise don't silence
		return false;
	}

	private shouldSilenceForFollowWithoutReplies(note: PopulatedNote, user: PopulatedUser, data: NoteVisibilityData): boolean {
		// Don't silence if it's not a reply
		if (!note.reply) return false;

		// Don't silence if it's a self-reply
		if (note.reply.userId === note.userId) return false;

		// Don't silence if it's a reply to us
		if (note.reply.userId === user?.id) return false;

		// Don't silence if it's our post
		if (note.userId === user?.id) return false;

		// Don't silence if we follow w/ replies
		if (user && data.userFollowings?.get(user.id)?.withReplies) return false;

		// Silence otherwise
		return true;
	}
}

export interface NoteVisibilityData {
	userBlockers: Set<string> | null;
	userFollowings: Map<string, Omit<MiFollowing, 'isFollowerHibernated'>> | null;
	userMutedThreads: Set<string> | null;
	userMutedNotes: Set<string> | null;
	userMutedUsers: Set<string> | null;
	userMutedUserRenotes: Set<string> | null;
	userMutedInstances: Set<string> | null;
}

export type PopulatedUser = Pick<MiUser, 'id' | 'host'> | null | undefined;

export type PopulatedNote = PopulatedMiNote | Packed<'Note'>;

type PopulatedMiNote = MiNote & {
	user: MiUser & {
		instance: MiInstance | null,
	}
	renote: PopulatedMiNote | null,
	reply: PopulatedMiNote | null,
};

function isPopulatedBoost(note: PopulatedNote): note is PopulatedNote & { renote: PopulatedNote } {
	return note.renoteId != null
		&& note.replyId == null
		&& note.text == null
		&& note.cw == null
		&& (note.fileIds == null || note.fileIds.length === 0);
}

function isPackedNote(note: MiNote | Packed<'Note'>): note is Packed<'Note'> {
	// Kind of a hack: determine whether it's packed by looking for property that doesn't exist in MiNote
	return 'isFavorited' in note;
}
