/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { In, IsNull, Not, Brackets, MoreThan } from 'typeorm';
import type { BlockingsRepository, FollowingsRepository, MutingsRepository, RenoteMutingsRepository, MiUserProfile, UserProfilesRepository, UsersRepository, MiFollowing, NoteThreadMutingsRepository, ChannelFollowingsRepository, UserListMembershipsRepository, UserListFavoritesRepository } from '@/models/_.js';
import type { MiLocalUser, MiRemoteUser, MiUser } from '@/models/User.js';
import type { MiUserListMembership } from '@/models/UserListMembership.js';
import { isLocalUser, isRemoteUser } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { InternalEventTypes } from '@/core/GlobalEventService.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import * as Acct from '@/misc/acct.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { TimeService } from '@/global/TimeService.js';
import {
	CacheManagementService,
	type ManagedMemoryKVCache,
	type ManagedQuantumKVCache,
} from '@/global/CacheManagementService.js';
import type { OnApplicationShutdown } from '@nestjs/common';

export interface FollowStats {
	localFollowing: number;
	localFollowers: number;
	remoteFollowing: number;
	remoteFollowers: number;
}

@Injectable()
export class CacheService implements OnApplicationShutdown {
	public readonly userByIdCache: ManagedQuantumKVCache<MiUser>;
	public readonly nativeTokenCache: ManagedQuantumKVCache<string>; // Token -> UserId
	public readonly userByAcctCache: ManagedQuantumKVCache<string>; // Acct -> UserId
	public readonly userProfileCache: ManagedQuantumKVCache<MiUserProfile>;
	public readonly userMutingsCache: ManagedQuantumKVCache<Set<string>>;
	public readonly userMutedCache: ManagedQuantumKVCache<Set<string>>;
	public readonly userBlockingCache: ManagedQuantumKVCache<Set<string>>;
	public readonly userBlockedCache: ManagedQuantumKVCache<Set<string>>; // NOTE: 「被」Blockキャッシュ
	public readonly userListMembershipsCache: ManagedQuantumKVCache<Map<string, MiUserListMembership>>;
	public readonly listUserMembershipsCache: ManagedQuantumKVCache<Map<string, MiUserListMembership>>;

	/**
	 * Maps user IDs (key) to the set of list IDs (value) that are favorited by that user
	 */
	public readonly userListFavoritesCache: ManagedQuantumKVCache<Set<string>>;

	/**
	 * Maps list IDs (key) to the set of user IDs (value) who have favorited this list.
	 */
	public readonly listUserFavoritesCache: ManagedQuantumKVCache<Set<string>>;

	/**
	 * Maps user IDs (key) to the set of user IDs (value) who's renotes are muted by that user.
	 */
	public readonly renoteMutingsCache: ManagedQuantumKVCache<Set<string>>;
	public readonly threadMutingsCache: ManagedQuantumKVCache<Set<string>>;
	public readonly noteMutingsCache: ManagedQuantumKVCache<Set<string>>;
	public readonly userFollowingsCache: ManagedQuantumKVCache<Map<string, Omit<MiFollowing, 'isFollowerHibernated'>>>;
	public readonly userFollowersCache: ManagedQuantumKVCache<Map<string, Omit<MiFollowing, 'isFollowerHibernated'>>>;
	public readonly hibernatedUserCache: ManagedQuantumKVCache<boolean>;
	public readonly userFollowStatsCache: ManagedMemoryKVCache<FollowStats>;
	public readonly userFollowingChannelsCache: ManagedQuantumKVCache<Set<string>>;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		@Inject(DI.blockingsRepository)
		private blockingsRepository: BlockingsRepository,

		@Inject(DI.renoteMutingsRepository)
		private renoteMutingsRepository: RenoteMutingsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.noteThreadMutingsRepository)
		private readonly noteThreadMutingsRepository: NoteThreadMutingsRepository,

		@Inject(DI.channelFollowingsRepository)
		private readonly channelFollowingsRepository: ChannelFollowingsRepository,

		@Inject(DI.userListMembershipsRepository)
		private readonly userListMembershipsRepository: UserListMembershipsRepository,

		@Inject(DI.userListFavoritesRepository)
		private readonly userListFavoritesRepository: UserListFavoritesRepository,

		private readonly internalEventService: InternalEventService,
		private readonly cacheManagementService: CacheManagementService,
		private readonly timeService: TimeService,
	) {
		//this.onMessage = this.onMessage.bind(this);

		this.userByIdCache = this.cacheManagementService.createQuantumKVCache('userById', {
			lifetime: 1000 * 60 * 5, // 5m
			fetcher: async (userId) => await this.usersRepository.findOneByOrFail({ id: userId }),
			bulkFetcher: async (userIds) => await this.usersRepository.findBy({ id: In(userIds) }).then(us => us.map(u => [u.id, u])),
		});

		this.nativeTokenCache = this.cacheManagementService.createQuantumKVCache('localUserByNativeToken', {
			lifetime: 1000 * 60 * 5, // 5m
			fetcher: async (token) => {
				const { id } = await this.usersRepository
					.createQueryBuilder('user')
					.select('user.id')
					.where({ token })
					.getOneOrFail() as { id: string };
				return id;
			},
			bulkFetcher: async (tokens) => {
				const users = await this.usersRepository
					.createQueryBuilder('user')
					.select('user.id')
					.addSelect('user.token')
					.where({ token: In(tokens) })
					.getMany() as { id: string, token: string }[];
				return users.map(u => [u.token, u.id]);
			},
		});

		this.userByAcctCache = this.cacheManagementService.createQuantumKVCache('userByAcct', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: async (acct) => {
				const parsed = Acct.parse(acct);
				const { id } = await this.usersRepository
					.createQueryBuilder('user')
					.select('user.id')
					.where({
						usernameLower: parsed.username.toLowerCase(),
						host: parsed.host ?? IsNull(),
					})
					.getOneOrFail();
				return id;
			},
			// No bulk fetcher for this
		});

		this.userProfileCache = this.cacheManagementService.createQuantumKVCache('userProfile', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: (key) => this.userProfilesRepository.findOneBy({ userId: key }),
			bulkFetcher: userIds => this.userProfilesRepository.findBy({ userId: In(userIds) }).then(ps => ps.map(p => [p.userId, p])),
		});

		this.userMutingsCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('userMutings', {
			lifetime: 1000 * 60 * 30, // 3m (workaround for mute expiration)
			fetcher: (key) => this.mutingsRepository.find({ where: { muterId: key }, select: ['muteeId'] }).then(xs => new Set(xs.map(x => x.muteeId))),
			bulkFetcher: muterIds => this.mutingsRepository
				.createQueryBuilder('muting')
				.select('"muting"."muterId"', 'muterId')
				.addSelect('array_agg("muting"."muteeId")', 'muteeIds')
				.where({ muterId: In(muterIds) })
				.andWhere(new Brackets(qb => qb
					.orWhere({ expiresAt: IsNull() })
					.orWhere({ expiresAt: MoreThan(this.timeService.date) })))
				.groupBy('muting.muterId')
				.getRawMany<{ muterId: string, muteeIds: string[] }>()
				.then(ms => ms.map(m => [m.muterId, new Set(m.muteeIds)])),
		});

		this.userMutedCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('userMuted', {
			lifetime: 1000 * 60 * 30, // 3m (workaround for mute expiration)
			fetcher: (key) => this.mutingsRepository.find({ where: { muteeId: key }, select: ['muterId'] }).then(xs => new Set(xs.map(x => x.muterId))),
			bulkFetcher: muteeIds => this.mutingsRepository
				.createQueryBuilder('muting')
				.select('"muting"."muteeId"', 'muteeId')
				.addSelect('array_agg("muting"."muterId")', 'muterIds')
				.where({ muteeId: In(muteeIds) })
				.andWhere(new Brackets(qb => qb
					.orWhere({ expiresAt: IsNull() })
					.orWhere({ expiresAt: MoreThan(this.timeService.date) })))
				.groupBy('muting.muteeId')
				.getRawMany<{ muteeId: string, muterIds: string[] }>()
				.then(ms => ms.map(m => [m.muteeId, new Set(m.muterIds)])),
		});

		this.userBlockingCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('userBlocking', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: (key) => this.blockingsRepository.find({ where: { blockerId: key }, select: ['blockeeId'] }).then(xs => new Set(xs.map(x => x.blockeeId))),
			bulkFetcher: blockerIds => this.blockingsRepository
				.createQueryBuilder('blocking')
				.select('"blocking"."blockerId"', 'blockerId')
				.addSelect('array_agg("blocking"."blockeeId")', 'blockeeIds')
				.where({ blockerId: In(blockerIds) })
				.groupBy('blocking.blockerId')
				.getRawMany<{ blockerId: string, blockeeIds: string[] }>()
				.then(ms => ms.map(m => [m.blockerId, new Set(m.blockeeIds)])),
		});

		this.userBlockedCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('userBlocked', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: (key) => this.blockingsRepository.find({ where: { blockeeId: key }, select: ['blockerId'] }).then(xs => new Set(xs.map(x => x.blockerId))),
			bulkFetcher: blockeeIds => this.blockingsRepository
				.createQueryBuilder('blocking')
				.select('"blocking"."blockeeId"', 'blockeeId')
				.addSelect('array_agg("blocking"."blockerId")', 'blockerIds')
				.where({ blockeeId: In(blockeeIds) })
				.groupBy('blocking.blockeeId')
				.getRawMany<{ blockeeId: string, blockerIds: string[] }>()
				.then(ms => ms.map(m => [m.blockeeId, new Set(m.blockerIds)])),
		});

		this.userListMembershipsCache = this.cacheManagementService.createQuantumKVCache<Map<string, MiUserListMembership>>('userListMemberships', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: async userId => await this.userListMembershipsRepository.findBy({ userId }).then(ms => new Map(ms.map(m => [m.userListId, m]))),
			bulkFetcher: async userIds => await this.userListMembershipsRepository
				.findBy({ userId: In(userIds) })
				.then(ms => ms
					.reduce((groups, m) => {
						let listsForUser = groups.get(m.userId);
						if (!listsForUser) {
							listsForUser = new Map();
							groups.set(m.userId, listsForUser);
						}
						listsForUser.set(m.userListId, m);
						return groups;
					}, new Map<string, Map<string, MiUserListMembership>>)),
		});

		this.listUserMembershipsCache = this.cacheManagementService.createQuantumKVCache<Map<string, MiUserListMembership>>('listUserMemberships', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: async userListId => await this.userListMembershipsRepository.findBy({ userListId }).then(ms => new Map(ms.map(m => [m.userId, m]))),
			bulkFetcher: async userListIds => await this.userListMembershipsRepository
				.findBy({ userListId: In(userListIds) })
				.then(ms => ms
					.reduce((groups, m) => {
						let usersForList = groups.get(m.userListId);
						if (!usersForList) {
							usersForList = new Map();
							groups.set(m.userListId, usersForList);
						}
						usersForList.set(m.userId, m);
						return groups;
					}, new Map<string, Map<string, MiUserListMembership>>)),
		});

		this.userListFavoritesCache = cacheManagementService.createQuantumKVCache<Set<string>>('userListFavorites', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: async userId => await this.userListFavoritesRepository.findBy({ userId }).then(fs => new Set(fs.map(f => f.userListId))),
			bulkFetcher: async userIds => await this.userListFavoritesRepository
				.createQueryBuilder('favorite')
				.select('"favorite"."userId"', 'userId')
				.addSelect('array_agg("favorite"."userListId")', 'userListIds')
				.where({ userId: In(userIds) })
				.groupBy('favorite.userId')
				.getRawMany<{ userId: string, userListIds: string[] }>()
				.then(fs => fs.map(f => [f.userId, new Set(f.userListIds)])),
		});

		this.listUserFavoritesCache = cacheManagementService.createQuantumKVCache<Set<string>>('listUserFavorites', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: async userListId => await this.userListFavoritesRepository.findBy({ userListId }).then(fs => new Set(fs.map(f => f.userId))),
			bulkFetcher: async userListIds => await this.userListFavoritesRepository
				.createQueryBuilder('favorite')
				.select('"favorite"."userListId"', 'userListId')
				.addSelect('array_agg("favorite"."userId")', 'userIds')
				.where({ userListId: In(userListIds) })
				.groupBy('favorite.userListId')
				.getRawMany<{ userListId: string, userIds: string[] }>()
				.then(fs => fs.map(f => [f.userListId, new Set(f.userIds)])),
		});

		this.renoteMutingsCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('renoteMutings', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: (key) => this.renoteMutingsRepository.find({ where: { muterId: key }, select: ['muteeId'] }).then(xs => new Set(xs.map(x => x.muteeId))),
			bulkFetcher: muterIds => this.renoteMutingsRepository
				.createQueryBuilder('muting')
				.select('"muting"."muterId"', 'muterId')
				.addSelect('array_agg("muting"."muteeId")', 'muteeIds')
				.where({ muterId: In(muterIds) })
				.groupBy('muting.muterId')
				.getRawMany<{ muterId: string, muteeIds: string[] }>()
				.then(ms => ms.map(m => [m.muterId, new Set(m.muteeIds)])),
		});

		this.threadMutingsCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('threadMutings', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: muterId => this.noteThreadMutingsRepository
				.find({ where: { userId: muterId, isPostMute: false }, select: { threadId: true } })
				.then(ms => new Set(ms.map(m => m.threadId))),
			bulkFetcher: muterIds => this.noteThreadMutingsRepository
				.createQueryBuilder('muting')
				.select('"muting"."userId"', 'userId')
				.addSelect('array_agg("muting"."threadId")', 'threadIds')
				.groupBy('"muting"."userId"')
				.where({ userId: In(muterIds), isPostMute: false })
				.getRawMany<{ userId: string, threadIds: string[] }>()
				.then(ms => ms.map(m => [m.userId, new Set(m.threadIds)])),
		});

		this.noteMutingsCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('noteMutings', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: muterId => this.noteThreadMutingsRepository
				.find({ where: { userId: muterId, isPostMute: true }, select: { threadId: true } })
				.then(ms => new Set(ms.map(m => m.threadId))),
			bulkFetcher: muterIds => this.noteThreadMutingsRepository
				.createQueryBuilder('muting')
				.select('"muting"."userId"', 'userId')
				.addSelect('array_agg("muting"."threadId")', 'threadIds')
				.groupBy('"muting"."userId"')
				.where({ userId: In(muterIds), isPostMute: true })
				.getRawMany<{ userId: string, threadIds: string[] }>()
				.then(ms => ms.map(m => [m.userId, new Set(m.threadIds)])),
		});

		this.userFollowingsCache = this.cacheManagementService.createQuantumKVCache<Map<string, Omit<MiFollowing, 'isFollowerHibernated'>>>('userFollowings', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: (key) => this.followingsRepository.findBy({ followerId: key }).then(xs => new Map(xs.map(f => [f.followeeId, f]))),
			bulkFetcher: followerIds => this.followingsRepository
				.findBy({ followerId: In(followerIds) })
				.then(fs => fs
					.reduce((groups, f) => {
						let group = groups.get(f.followerId);
						if (!group) {
							group = new Map();
							groups.set(f.followerId, group);
						}
						group.set(f.followeeId, f);
						return groups;
					}, new Map<string, Map<string, Omit<MiFollowing, 'isFollowerHibernated'>>>)),
		});

		this.userFollowersCache = this.cacheManagementService.createQuantumKVCache<Map<string, Omit<MiFollowing, 'isFollowerHibernated'>>>('userFollowers', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: followeeId => this.followingsRepository.findBy({ followeeId: followeeId }).then(xs => new Map(xs.map(x => [x.followerId, x]))),
			bulkFetcher: followeeIds => this.followingsRepository
				.findBy({ followeeId: In(followeeIds) })
				.then(fs => fs
					.reduce((groups, f) => {
						let group = groups.get(f.followeeId);
						if (!group) {
							group = new Map();
							groups.set(f.followeeId, group);
						}
						group.set(f.followerId, f);
						return groups;
					}, new Map<string, Map<string, Omit<MiFollowing, 'isFollowerHibernated'>>>)),
		});

		this.hibernatedUserCache = this.cacheManagementService.createQuantumKVCache<boolean>('hibernatedUsers', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: async userId => {
				const result = await this.usersRepository.findOne({
					where: { id: userId },
					select: { isHibernated: true },
				});
				return result?.isHibernated;
			},
			bulkFetcher: async userIds => {
				const results = await this.usersRepository.find({
					where: { id: In(userIds) },
					select: { id: true, isHibernated: true },
				});
				return results.map(({ id, isHibernated }) => [id, isHibernated]);
			},
			onChanged: async userIds => {
				// We only update local copies since each process will get this event, but we can have user objects in multiple different caches.
				// Before doing anything else we must "find" all the objects to update.
				const userObjects = new Map<string, MiUser[]>();
				const toUpdate: string[] = [];
				for (const uid of userIds) {
					const toAdd: MiUser[] = [];

					const userById = this.userByIdCache.get(uid);
					if (userById) toAdd.push(userById);

					if (toAdd.length > 0) {
						toUpdate.push(uid);
						userObjects.set(uid, toAdd);
					}
				}

				// In many cases, we won't have to do anything.
				// Skipping the DB fetch ensures that this remains a single-step synchronous process.
				if (toUpdate.length > 0) {
					const hibernations = await this.usersRepository.find({ where: { id: In(toUpdate) }, select: { id: true, isHibernated: true } });
					for (const { id, isHibernated } of hibernations) {
						const users = userObjects.get(id);
						if (users) {
							for (const u of users) {
								u.isHibernated = isHibernated;
							}
						}
					}
				}
			},
		});

		this.userFollowStatsCache = this.cacheManagementService.createMemoryKVCache<FollowStats>('followStats', 1000 * 60 * 10); // 10 minutes

		this.userFollowingChannelsCache = this.cacheManagementService.createQuantumKVCache<Set<string>>('userFollowingChannels', {
			lifetime: 1000 * 60 * 30, // 30m
			fetcher: (key) => this.channelFollowingsRepository.find({
				where: { followerId: key },
				select: ['followeeId'],
			}).then(xs => new Set(xs.map(x => x.followeeId))),
			// TODO bulk fetcher
		});

		this.internalEventService.on('usersUpdated', this.onUserEvent);
		this.internalEventService.on('userChangeSuspendedState', this.onUserEvent);
		this.internalEventService.on('userChangeDeletedState', this.onUserEvent);
		this.internalEventService.on('remoteUserUpdated', this.onUserEvent);
		this.internalEventService.on('localUserUpdated', this.onUserEvent);
		this.internalEventService.on('userUpdated', this.onUserEvent);
		this.internalEventService.on('userTokenRegenerated', this.onTokenEvent);
		this.internalEventService.on('follow', this.onFollowEvent);
		this.internalEventService.on('unfollow', this.onFollowEvent);
		// For these, only listen to local events because quantum cache handles the sync.
		this.internalEventService.on('followChannel', this.onChannelEvent, { ignoreRemote: true });
		this.internalEventService.on('unfollowChannel', this.onChannelEvent, { ignoreRemote: true });
		this.internalEventService.on('updateUserProfile', this.onProfileEvent, { ignoreRemote: true });
		this.internalEventService.on('userListMemberAdded', this.onListMemberEvent, { ignoreRemote: true });
		this.internalEventService.on('userListMemberUpdated', this.onListMemberEvent, { ignoreRemote: true });
		this.internalEventService.on('userListMemberRemoved', this.onListMemberEvent, { ignoreRemote: true });
		this.internalEventService.on('userListMemberBulkAdded', this.onListMemberEvent, { ignoreRemote: true });
		this.internalEventService.on('userListMemberBulkUpdated', this.onListMemberEvent, { ignoreRemote: true });
		this.internalEventService.on('userListMemberBulkRemoved', this.onListMemberEvent, { ignoreRemote: true });
	}

	@bindThis
	private async onUserEvent<E extends 'userChangeSuspendedState' | 'userChangeDeletedState' | 'remoteUserUpdated' | 'localUserUpdated' | 'usersUpdated' | 'userUpdated'>(body: InternalEventTypes[E], _: E, isLocal: boolean): Promise<void> {
		const ids = 'ids' in body ? body.ids : [body.id];
		if (ids.length === 0) return;

		// Update quantum caches
		if (isLocal) {
			// Contains IDs of all lists where this user is a member.
			const userListMemberships = this.listUserMembershipsCache
				.entries()
				.filter(e => ids.some(id => e[1].has(id)))
				.map(e => e[0])
				.toArray();

			await Promise.all([
				this.userByIdCache.deleteMany(ids),
				this.userProfileCache.deleteMany(ids),
				this.userMutingsCache.deleteMany(ids),
				this.userMutedCache.deleteMany(ids),
				this.userBlockingCache.deleteMany(ids),
				this.userBlockedCache.deleteMany(ids),
				this.renoteMutingsCache.deleteMany(ids),
				this.userFollowingsCache.deleteMany(ids),
				this.userFollowersCache.deleteMany(ids),
				this.hibernatedUserCache.deleteMany(ids),
				this.threadMutingsCache.deleteMany(ids),
				this.noteMutingsCache.deleteMany(ids),
				this.userListMembershipsCache.deleteMany(ids),
				this.listUserMembershipsCache.deleteMany(userListMemberships),
			]);
		}

		// Update other caches
		const users = await this.usersRepository.findBy({
			id: ids.length === 1 ? ids[0] : In(ids),
		});
		for (const id of ids) {
			const user = users.find(u => u.id === id);
			this.updateMkUserCaches({ id }, user ?? null);
		}
	}

	// This is here purely to help git line up MK's original code with our changes
	@bindThis
	private updateMkUserCaches(body: { id: string }, user: MiUser | null): void {
		{
			{
				{
					if (user == null) {
						this.userByIdCache.delete(body.id);
						for (const [k, v] of this.uriPersonCache.entries) {
							if (v.value?.id === body.id) {
								this.uriPersonCache.delete(k);
							}
						}
					} else {
						this.userByIdCache.set(user.id, user);
						for (const [k, v] of this.uriPersonCache.entries) {
							if (v.value?.id === user.id) {
								this.uriPersonCache.set(k, user);
							}
						}
						if (isLocalUser(user)) {
							this.localUserByNativeTokenCache.set(user.token!, user);
							this.localUserByIdCache.set(user.id, user);
						}
					}
				}
			}
		}
	}

	@bindThis
	private async onTokenEvent<E extends 'userTokenRegenerated'>(body: InternalEventTypes[E], _: E, isLocal: boolean): Promise<void> {
		{
			{
				{
					// Local instance is responsible for expanding these events into the appropriate Quantum events
					if (!isLocal) return;

					await Promise.all([
						this.nativeTokenCache.delete(body.oldToken),
						this.nativeTokenCache.set(body.newToken, body.id),
					]);
				}
			}
		}
	}

	@bindThis
	private async onFollowEvent<E extends 'follow' | 'unfollow'>(body: InternalEventTypes[E], type: E): Promise<void> {
		{
			// TODO should we filter for local/remote events?
			switch (type) {
				case 'follow': {
					const follower = this.userByIdCache.get(body.followerId);
					if (follower) follower.followingCount++;
					const followee = this.userByIdCache.get(body.followeeId);
					if (followee) followee.followersCount++;
					await Promise.all([
						this.userFollowingsCache.delete(body.followerId),
						this.userFollowersCache.delete(body.followeeId),
					]);
					this.userFollowStatsCache.delete(body.followerId);
					this.userFollowStatsCache.delete(body.followeeId);
					break;
				}
				case 'unfollow': {
					const follower = this.userByIdCache.get(body.followerId);
					if (follower) follower.followingCount--;
					const followee = this.userByIdCache.get(body.followeeId);
					if (followee) followee.followersCount--;
					await Promise.all([
						this.userFollowingsCache.delete(body.followerId),
						this.userFollowersCache.delete(body.followeeId),
					]);
					this.userFollowStatsCache.delete(body.followerId);
					this.userFollowStatsCache.delete(body.followeeId);
					break;
				}
			}
		}
	}

	@bindThis
	private async onChannelEvent<E extends 'followChannel' | 'unfollowChannel'>(body: InternalEventTypes[E]): Promise<void> {
		await this.userFollowingChannelsCache.delete(body.userId);
	}

	@bindThis
	private async onProfileEvent<E extends 'updateUserProfile'>(body: InternalEventTypes[E]): Promise<void> {
		await this.userProfileCache.delete(body.userId);
	}

	@bindThis
	private async onListMemberEvent<E extends 'userListMemberAdded' | 'userListMemberUpdated' | 'userListMemberRemoved' | 'userListMemberBulkAdded' | 'userListMemberBulkUpdated' | 'userListMemberBulkRemoved'>(body: InternalEventTypes[E]): Promise<void> {
		const userListIds = 'userListIds' in body ? body.userListIds : [body.userListId];
		await Promise.all([
			this.userListMembershipsCache.delete(body.memberId),
			this.listUserMembershipsCache.deleteMany(userListIds),
		]);
	}

	@bindThis
	public async findUserById(userId: MiUser['id']): Promise<MiUser> {
		return await this.userByIdCache.fetch(userId);
	}

	@bindThis
	public async findOptionalUserById(userId: MiUser['id']): Promise<MiUser | undefined> {
		return await this.userByIdCache.fetchMaybe(userId);
	}

	@bindThis
	public async findUserByAcct(acct: string | Acct.Acct): Promise<MiUser> {
		acct = typeof(acct) === 'string' ? acct : Acct.toString(acct);
		const id = await this.userByAcctCache.fetch(acct);
		return await this.findUserById(id);
	}

	@bindThis
	public async findOptionalUserByAcct(acct: string | Acct.Acct): Promise<MiUser | undefined> {
		acct = typeof(acct) === 'string' ? acct : Acct.toString(acct);

		const id = await this.userByAcctCache.fetchMaybe(acct);
		if (id == null) return undefined;

		return await this.findOptionalUserById(id);
	}

	@bindThis
	public async findLocalUserById(userId: MiUser['id']): Promise<MiLocalUser> {
		const user = await this.findUserById(userId);

		if (!isLocalUser(user)) {
			throw new IdentifiableError('aeac1339-2550-4521-a8e3-781f06d98656', 'User is not local');
		}

		return user;
	}

	@bindThis
	public async findOptionalLocalUserById(userId: MiUser['id']): Promise<MiLocalUser | undefined> {
		const user = await this.findOptionalUserById(userId);

		if (user && !isLocalUser(user)) {
			throw new IdentifiableError('aeac1339-2550-4521-a8e3-781f06d98656', 'User is not local');
		}

		return user;
	}

	@bindThis
	public async findRemoteUserById(userId: MiUser['id']): Promise<MiRemoteUser> {
		const user = await this.findUserById(userId);

		if (!isRemoteUser(user)) {
			throw new IdentifiableError('aeac1339-2550-4521-a8e3-781f06d98656', 'User is not remote');
		}

		return user;
	}

	@bindThis
	public async findOptionalRemoteUserById(userId: MiUser['id']): Promise<MiRemoteUser | undefined> {
		const user = await this.findOptionalUserById(userId);

		if (user && !isRemoteUser(user)) {
			throw new IdentifiableError('aeac1339-2550-4521-a8e3-781f06d98656', 'User is not remote');
		}

		return user;
	}

	@bindThis
	public async getFollowStats(userId: MiUser['id']): Promise<FollowStats> {
		return await this.userFollowStatsCache.fetch(userId, async () => {
			const stats = {
				localFollowing: 0,
				localFollowers: 0,
				remoteFollowing: 0,
				remoteFollowers: 0,
			};

			const followings = await this.followingsRepository.findBy([
				{ followerId: userId },
				{ followeeId: userId },
			]);

			for (const following of followings) {
				if (following.followerId === userId) {
					// increment following; user is a follower of someone else
					if (following.followeeHost == null) {
						stats.localFollowing++;
					} else {
						stats.remoteFollowing++;
					}
				} else if (following.followeeId === userId) {
					// increment followers; user is followed by someone else
					if (following.followerHost == null) {
						stats.localFollowers++;
					} else {
						stats.remoteFollowers++;
					}
				} else {
					// Should never happen
				}
			}

			// Infer remote-remote followers heuristically, since we don't track that info directly.
			const user = await this.findUserById(userId);
			if (user.host !== null) {
				stats.remoteFollowing = Math.max(0, user.followingCount - stats.localFollowing);
				stats.remoteFollowers = Math.max(0, user.followersCount - stats.localFollowers);
			}

			return stats;
		});
	}

	@bindThis
	public async getUsers(userIds: Iterable<string>): Promise<Map<string, MiUser>> {
		return new Map(await this.userByIdCache.fetchMany(userIds));
	}

	@bindThis
	public async isFollowing(follower: string | { id: string }, followee: string | { id: string }): Promise<boolean> {
		const followerId = typeof(follower) === 'string' ? follower : follower.id;
		const followeeId = typeof(followee) === 'string' ? followee : followee.id;

		// This lets us use whichever one is in memory, falling back to DB fetch via userFollowingsCache.
		return this.userFollowersCache.get(followeeId)?.has(followerId)
		?? (await this.userFollowingsCache.fetch(followerId)).has(followeeId);
	}

	/**
	 * Returns all hibernated followers.
	 */
	@bindThis
	public async getHibernatedFollowers(followeeId: string): Promise<MiFollowing[]> {
		const followers = await this.getFollowersWithHibernation(followeeId);
		return followers.filter(f => f.isFollowerHibernated);
	}

	/**
	 * Returns all non-hibernated followers.
	 */
	@bindThis
	public async getNonHibernatedFollowers(followeeId: string): Promise<MiFollowing[]> {
		const followers = await this.getFollowersWithHibernation(followeeId);
		return followers.filter(f => !f.isFollowerHibernated);
	}

	/**
	 * Returns follower relations with populated isFollowerHibernated.
	 * If you don't need this field, then please use userFollowersCache directly for reduced overhead.
	 */
	@bindThis
	public async getFollowersWithHibernation(followeeId: string): Promise<MiFollowing[]> {
		const followers = await this.userFollowersCache.fetch(followeeId);
		const hibernations = await this.hibernatedUserCache.fetchMany(followers.keys()).then(fs => fs.reduce((map, f) => {
			map.set(f[0], f[1]);
			return map;
		}, new Map<string, boolean>));
		return Array.from(followers.values()).map(following => ({
			...following,
			isFollowerHibernated: hibernations.get(following.followerId) ?? false,
		}));
	}

	/**
	 * Refreshes follower and following relations for the given user.
	 */
	@bindThis
	public async refreshFollowRelationsFor(userId: string): Promise<void> {
		const followings = await this.userFollowingsCache.refresh(userId);
		const followees = Array.from(followings.values()).map(f => f.followeeId);
		await this.userFollowersCache.deleteMany(followees);
	}

	@bindThis
	public clear(): void {
		this.cacheManagementService.clear();
	}

	@bindThis
	public dispose(): void {
		this.internalEventService.off('usersUpdated', this.onUserEvent);
		this.internalEventService.off('userChangeSuspendedState', this.onUserEvent);
		this.internalEventService.off('userChangeDeletedState', this.onUserEvent);
		this.internalEventService.off('remoteUserUpdated', this.onUserEvent);
		this.internalEventService.off('localUserUpdated', this.onUserEvent);
		this.internalEventService.off('userUpdated', this.onUserEvent);
		this.internalEventService.off('userTokenRegenerated', this.onTokenEvent);
		this.internalEventService.off('follow', this.onFollowEvent);
		this.internalEventService.off('unfollow', this.onFollowEvent);
		this.internalEventService.off('followChannel', this.onChannelEvent);
		this.internalEventService.off('unfollowChannel', this.onChannelEvent);
		this.internalEventService.off('updateUserProfile', this.onProfileEvent);
		this.internalEventService.off('userListMemberAdded', this.onListMemberEvent);
		this.internalEventService.off('userListMemberUpdated', this.onListMemberEvent);
		this.internalEventService.off('userListMemberRemoved', this.onListMemberEvent);
		this.internalEventService.off('userListMemberBulkAdded', this.onListMemberEvent);
		this.internalEventService.off('userListMemberBulkUpdated', this.onListMemberEvent);
		this.internalEventService.off('userListMemberBulkRemoved', this.onListMemberEvent);
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}
}
