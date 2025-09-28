/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { InstancesRepository, MiMeta } from '@/models/_.js';
import type { MiInstance } from '@/models/Instance.js';
import { IdService } from '@/core/IdService.js';
import { DI } from '@/di-symbols.js';
import { UtilityService } from '@/core/UtilityService.js';
import { bindThis } from '@/decorators.js';
import { CacheService } from '@/core/CacheService.js';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

@Injectable()
export class FederatedInstanceService {
	constructor(
		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		@Inject(DI.meta)
		private readonly meta: MiMeta,

		private utilityService: UtilityService,
		private idService: IdService,
		private readonly cacheService: CacheService,
	) {}

	@bindThis
	public async fetchOrRegister(host: string): Promise<MiInstance> {
		return this.cacheService.federatedInstanceCache.fetch(host);
		/*
		host = this.utilityService.toPuny(host);

		const cached = this.federatedInstanceCache.get(host);
		if (cached) return cached;

		let index = await this.instancesRepository.findOneBy({ host });
		if (index == null) {
			await this.instancesRepository.createQueryBuilder('instance')
				.insert()
				.values({
					id: this.idService.gen(),
					host,
					firstRetrievedAt: new Date(),
					isBlocked: this.utilityService.isBlockedHost(host),
					isSilenced: this.utilityService.isSilencedHost(host),
					isMediaSilenced: this.utilityService.isMediaSilencedHost(host),
					isAllowListed: this.utilityService.isAllowListedHost(host),
					isBubbled: this.utilityService.isBubbledHost(host),
				})
				.orIgnore()
				.execute();

			index = await this.instancesRepository.findOneByOrFail({ host });
		}

		await this.federatedInstanceCache.set(host, index);
		return index;
		 */
	}

	@bindThis
	public async fetch(host: string): Promise<MiInstance> {
		return this.cacheService.federatedInstanceCache.fetch(host);
		/*
		host = this.utilityService.toPuny(host);

		const cached = this.federatedInstanceCache.get(host);
		if (cached !== undefined) return cached;

		const index = await this.instancesRepository.findOneBy({ host });

		if (index == null) {
			await this.federatedInstanceCache.set(host, null);
			return null;
		} else {
			await this.federatedInstanceCache.set(host, index);
			return index;
		}
		*/
	}

	@bindThis
	public async update(id: MiInstance['id'], data: QueryDeepPartialEntity<MiInstance>): Promise<MiInstance> {
		const result = await this.instancesRepository.createQueryBuilder().update()
			.set(data)
			.where('id = :id', { id })
			.returning('*')
			.execute()
			.then((response) => {
				return response.raw[0] as MiInstance;
			});

		await this.cacheService.federatedInstanceCache.set(result.host, result);

		return result;
	}

	/**
	 * Gets all instances in the allowlist (meta.federationHosts).
	 */
	@bindThis
	public async getAllowList(): Promise<MiInstance[]> {
		const allowedHosts = new Set(this.meta.federationHosts);
		this.meta.blockedHosts.forEach(h => allowedHosts.delete(h));

		const instances = await this.cacheService.federatedInstanceCache.fetchMany(this.meta.federationHosts);
		return instances.map(i => i[1]);
	}

	/**
	 * Gets all instances in the denylist (meta.blockedHosts).
	 */
	@bindThis
	public async getDenyList(): Promise<MiInstance[]> {
		const instances = await this.cacheService.federatedInstanceCache.fetchMany(this.meta.blockedHosts);
		return instances.map(i => i[1]);
	}
}
