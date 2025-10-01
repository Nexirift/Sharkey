/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as Redis from 'ioredis';
import { In } from 'typeorm';
import type { MiUser } from '@/models/User.js';
import type { UserKeypairsRepository } from '@/models/_.js';
import type { MiUserKeypair } from '@/models/UserKeypair.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { CacheManagementService, type ManagedQuantumKVCache } from '@/core/CacheManagementService.js';
import { InternalEventService } from '@/core/InternalEventService.js';
import type { InternalEventTypes } from '@/core/GlobalEventService.js';

@Injectable()
export class UserKeypairService implements OnApplicationShutdown {
	public readonly userKeypairCache: ManagedQuantumKVCache<MiUserKeypair>;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.userKeypairsRepository)
		private userKeypairsRepository: UserKeypairsRepository,

		private readonly internalEventService: InternalEventService,

		cacheManagementService: CacheManagementService,
	) {
		this.userKeypairCache = cacheManagementService.createQuantumKVCache('userKeypair', {
			lifetime: 1000 * 60 * 60, // 1h
			fetcher: async userId => await this.userKeypairsRepository.findOneBy({ userId }),
			bulkFetcher: async userIds => await this.userKeypairsRepository.findBy({ userId: In(userIds) }).then(ks => ks.map(k => [k.userId, k])),
		});

		this.internalEventService.on('userChangeDeletedState', this.onUserDeleted);
	}

	@bindThis
	public async getUserKeypair(userId: MiUser['id']): Promise<MiUserKeypair> {
		return await this.userKeypairCache.fetch(userId);
	}

	@bindThis
	private async onUserDeleted(body: InternalEventTypes['userChangeDeletedState']): Promise<void> {
		await this.userKeypairCache.delete(body.id);
	}

	@bindThis
	public dispose(): void {
		this.internalEventService.off('userChangeDeletedState', this.onUserDeleted);
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
