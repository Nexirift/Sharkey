/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import type { MiMeta } from '@/models/Meta.js';
import { Packed } from '@/misc/json-schema.js';
import type { NotesRepository } from '@/models/_.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { FanoutTimelineName, FanoutTimelineService } from '@/core/FanoutTimelineService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import { isPureRenote, isQuote, isRenote } from '@/misc/is-renote.js';
import { CacheService } from '@/core/CacheService.js';
import { isReply } from '@/misc/is-reply.js';
import { isInstanceMuted } from '@/misc/is-instance-muted.js';

type TimelineOptions = {
	untilId: string | null,
	sinceId: string | null,
	limit: number,
	allowPartial: boolean,
	me?: { id: MiUser['id'] } | undefined | null,
	useDbFallback: boolean,
	redisTimelines: FanoutTimelineName[],
	noteFilter?: (note: MiNote) => boolean,
	alwaysIncludeMyNotes?: boolean;
	ignoreAuthorFromBlock?: boolean;
	ignoreAuthorFromMute?: boolean;
	ignoreAuthorFromInstanceBlock?: boolean;
	excludeNoFiles?: boolean;
	excludeReplies?: boolean;
	excludeBots?: boolean;
	excludePureRenotes: boolean;
	includeMutedNotes?: boolean;
	ignoreAuthorFromUserSuspension?: boolean;
	ignoreAuthorFromUserSilence?: boolean;
	dbFallback: (untilId: string | null, sinceId: string | null, limit: number) => Promise<MiNote[]>,
};

@Injectable()
export class FanoutTimelineEndpointService {
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.meta)
		private meta: MiMeta,

		private noteEntityService: NoteEntityService,
		private cacheService: CacheService,
		private fanoutTimelineService: FanoutTimelineService,
		private utilityService: UtilityService,
	) {
	}

	@bindThis
	async timeline(ps: TimelineOptions): Promise<Packed<'Note'>[]> {
		return await this.noteEntityService.packMany(await this.getMiNotes(ps), ps.me);
	}

	@bindThis
	async getMiNotes(ps: TimelineOptions): Promise<MiNote[]> {
		// 呼び出し元と以下の処理をシンプルにするためにdbFallbackを置き換える
		if (!ps.useDbFallback) ps.dbFallback = () => Promise.resolve([]);

		const ascending = ps.sinceId && !ps.untilId;
		const idCompare: (a: string, b: string) => number = ascending ? (a, b) => a < b ? -1 : 1 : (a, b) => a > b ? -1 : 1;

		const redisResult = await this.fanoutTimelineService.getMulti(ps.redisTimelines, ps.untilId, ps.sinceId);

		// TODO: いい感じにgetMulti内でソート済だからuniqするときにredisResultが全てソート済なのを利用して再ソートを避けたい
		const redisResultIds = Array.from(new Set(redisResult.flat(1))).sort(idCompare);

		let noteIds = redisResultIds.slice(0, ps.limit);
		const oldestNoteId = ascending ? redisResultIds[0] : redisResultIds[redisResultIds.length - 1];
		const shouldFallbackToDb = noteIds.length === 0 || ps.sinceId != null && ps.sinceId < oldestNoteId;

		if (!shouldFallbackToDb) {
			let filter = ps.noteFilter ?? (_note => true);

			if (ps.alwaysIncludeMyNotes && ps.me) {
				const me = ps.me;
				const parentFilter = filter;
				filter = (note) => note.userId === me.id || parentFilter(note);
			}

			if (ps.excludeNoFiles) {
				const parentFilter = filter;
				filter = (note) => note.fileIds.length !== 0 && parentFilter(note);
			}

			if (ps.excludeReplies) {
				const parentFilter = filter;
				filter = (note) => !isReply(note, ps.me?.id) && parentFilter(note);
			}

			if (ps.excludeBots) {
				const parentFilter = filter;
				filter = (note) => !note.user?.isBot && parentFilter(note);
			}

			if (ps.excludePureRenotes) {
				const parentFilter = filter;
				filter = (note) => (!isRenote(note) || isQuote(note)) && parentFilter(note);
			}

			if (ps.me) {
				const [
					userIdsWhoMeMuting,
					userIdsWhoMeMutingRenotes,
					userIdsWhoBlockingMe,
					userMutedInstances,
					myFollowings,
					myThreadMutings,
					myNoteMutings,
					me,
				] = await Promise.all([
					this.cacheService.userMutingsCache.fetch(ps.me.id),
					this.cacheService.renoteMutingsCache.fetch(ps.me.id),
					this.cacheService.userBlockedCache.fetch(ps.me.id),
					this.cacheService.userProfileCache.fetch(ps.me.id).then(p => new Set(p.mutedInstances)),
					this.cacheService.userFollowingsCache.fetch(ps.me.id).then(fs => new Set(fs.keys())),
					this.cacheService.threadMutingsCache.fetch(ps.me.id),
					this.cacheService.noteMutingsCache.fetch(ps.me.id),
					this.cacheService.findUserById(ps.me.id),
				]);

				const parentFilter = filter;
				filter = (note) => {
					if (isUserRelated(note, userIdsWhoBlockingMe, ps.ignoreAuthorFromBlock)) return false;
					if (isUserRelated(note, userIdsWhoMeMuting, ps.ignoreAuthorFromMute)) return false;
					if (!ps.ignoreAuthorFromMute && isRenote(note) && !isQuote(note) && userIdsWhoMeMutingRenotes.has(note.userId)) return false;
					if (isInstanceMuted(note, userMutedInstances)) return false;

					// Silenced users (when logged in)
					if (!ps.ignoreAuthorFromUserSilence && !myFollowings.has(note.userId)) {
						if (note.user?.isSilenced || note.user?.instance?.isSilenced) return false;
						if (note.reply?.user?.isSilenced || note.reply?.user?.instance?.isSilenced) return false;
						if (note.renote?.user?.isSilenced || note.renote?.user?.instance?.isSilenced) return false;
					}

					// Muted threads / posts
					if (!ps.includeMutedNotes) {
						if (myThreadMutings.has(note.threadId ?? note.id) || myNoteMutings.has(note.id)) return false;
						if (note.replyId && myNoteMutings.has(note.replyId)) return false;
						if (note.renote && (myThreadMutings.has(note.renote.threadId ?? note.renote.id) || myNoteMutings.has(note.renote.id))) return false;
					}

					// Invisible notes
					if (!this.noteEntityService.isVisibleForMeSync(note, me, myFollowings, userIdsWhoBlockingMe)) {
						return false;
					}

					return parentFilter(note);
				};
			}

			{
				const parentFilter = filter;
				filter = (note) => {
					if (!ps.ignoreAuthorFromInstanceBlock) {
						if (note.userInstance?.isBlocked) return false;
					}
					if (note.userId !== note.renoteUserId && note.renoteUserInstance?.isBlocked) return false;
					if (note.userId !== note.replyUserId && note.replyUserInstance?.isBlocked) return false;

					return parentFilter(note);
				};
			}

			{
				const parentFilter = filter;
				filter = (note) => {
					const noteJoined = note as MiNote & {
						renoteUser: MiUser | null;
						replyUser: MiUser | null;
					};
					if (!ps.ignoreAuthorFromUserSuspension) {
						if (note.user?.isSuspended) return false;
					}
					if (note.userId !== note.renoteUserId && noteJoined.renoteUser?.isSuspended) return false;
					if (note.userId !== note.replyUserId && noteJoined.replyUser?.isSuspended) return false;

					return parentFilter(note);
				};
			}

			{
				const parentFilter = filter;
				filter = (note) => {
					// Silenced users (when logged out)
					if (!ps.ignoreAuthorFromUserSilence && !ps.me) {
						if (note.user?.isSilenced || note.user?.instance?.isSilenced) return false;
						if (note.reply?.user?.isSilenced || note.reply?.user?.instance?.isSilenced) return false;
						if (note.renote?.user?.isSilenced || note.renote?.user?.instance?.isSilenced) return false;
					}

					return parentFilter(note);
				};
			}

			// This one MUST be last!
			{
				const parentFilter = filter;
				filter = (note) => {
					// If this is a boost, then first run all checks for the boost target.
					if (isPureRenote(note) && note.renote) {
						if (!parentFilter(note.renote)) {
							return false;
						}
					}

					// Either way, make sure to run the checks for the actual note too!
					return parentFilter(note);
				};
			}

			const redisTimeline: MiNote[] = [];
			let readFromRedis = 0;
			let lastSuccessfulRate = 1; // rateをキャッシュする？

			while ((redisResultIds.length - readFromRedis) !== 0) {
				const remainingToRead = ps.limit - redisTimeline.length;

				// DBからの取り直しを減らす初回と同じ割合以上で成功すると仮定するが、クエリの長さを考えて三倍まで
				const countToGet = Math.ceil(remainingToRead * Math.min(1.1 / lastSuccessfulRate, 3));
				noteIds = redisResultIds.slice(readFromRedis, readFromRedis + countToGet);

				readFromRedis += noteIds.length;

				const gotFromDb = await this.getAndFilterFromDb(noteIds, filter, idCompare);
				redisTimeline.push(...gotFromDb);
				lastSuccessfulRate = gotFromDb.length / noteIds.length;

				if (ps.allowPartial ? redisTimeline.length !== 0 : redisTimeline.length >= ps.limit) {
					// 十分Redisからとれた
					return redisTimeline.slice(0, ps.limit);
				}
			}

			// まだ足りない分はDBにフォールバック
			const remainingToRead = ps.limit - redisTimeline.length;
			let dbUntil: string | null;
			let dbSince: string | null;
			if (ascending) {
				dbUntil = ps.untilId;
				dbSince = noteIds[noteIds.length - 1];
			} else {
				dbUntil = noteIds[noteIds.length - 1];
				dbSince = ps.sinceId;
			}
			const gotFromDb = await ps.dbFallback(dbUntil, dbSince, remainingToRead);
			return [...redisTimeline, ...gotFromDb];
		}

		return await ps.dbFallback(ps.untilId, ps.sinceId, ps.limit);
	}

	private async getAndFilterFromDb(noteIds: string[], noteFilter: (note: MiNote) => boolean, idCompare: (a: string, b: string) => number): Promise<MiNote[]> {
		const query = this.notesRepository.createQueryBuilder('note')
			.where('note.id IN (:...noteIds)', { noteIds: noteIds })
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser')
			.leftJoinAndSelect('note.channel', 'channel')
			.leftJoinAndSelect('note.userInstance', 'userInstance')
			.leftJoinAndSelect('note.replyUserInstance', 'replyUserInstance')
			.leftJoinAndSelect('note.renoteUserInstance', 'renoteUserInstance')

			// These are used to ensure full data for boosted replies.
			// Without loading these relations, certain filters may fail open.
			.leftJoinAndSelect('renote.reply', 'renoteReply')
			.leftJoinAndSelect('renote.reply.user', 'renoteReplyUser')
			.leftJoinAndSelect('renote.replyUserInstance', 'renoteReplyUserInstance');

		const notes = (await query.getMany()).filter(noteFilter);

		notes.sort((a, b) => idCompare(a.id, b.id));

		return notes;
	}
}
