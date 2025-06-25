/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { CollapsedQueue } from '@/misc/collapsed-queue.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { EnvService } from '@/core/EnvService.js';
import { bindThis } from '@/decorators.js';
import type { MiInstance } from '@/models/Instance.js';
import { InternalEventService } from '@/core/InternalEventService.js';
import { MiUser } from '@/models/User.js';
import type { UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';

export type UpdateInstanceJob = {
	latestRequestReceivedAt?: Date,
	shouldUnsuspend?: boolean,
	additionalNotes?: number,
};

export type UpdateUserJob = {
	updatedAt?: Date,
	additionalNotes?: number,
};

@Injectable()
export class CollapsedQueueService implements OnApplicationShutdown {
	// Moved from InboxProcessorService to allow access from ApInboxService
	public readonly updateInstanceQueue: CollapsedQueue<MiInstance['id'], UpdateInstanceJob>;
	public readonly updateUserQueue: CollapsedQueue<MiUser['id'], UpdateUserJob>;

	private readonly logger: Logger;

	constructor(
		@Inject(DI.usersRepository)
		public readonly usersRepository: UsersRepository,

		private readonly federatedInstanceService: FederatedInstanceService,
		private readonly envService: EnvService,
		private readonly internalEventService: InternalEventService,

		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('collapsed-queue');

		const fiveMinuteInterval = this.envService.env.NODE_ENV !== 'test' ? 60 * 1000 * 5 : 0;
		const oneMinuteInterval = this.envService.env.NODE_ENV !== 'test' ? 60 * 1000 : 0;

		this.updateInstanceQueue = new CollapsedQueue(
			'updateInstance',
			fiveMinuteInterval,
			(oldJob, newJob) => ({
				latestRequestReceivedAt: maxDate(oldJob.latestRequestReceivedAt, newJob.latestRequestReceivedAt),
				shouldUnsuspend: oldJob.shouldUnsuspend || newJob.shouldUnsuspend,
				additionalNotes: (oldJob.additionalNotes ?? 0) + (newJob.additionalNotes ?? 0),
			}),
			(id, job) => this.federatedInstanceService.update(id, {
				latestRequestReceivedAt: job.latestRequestReceivedAt,
				isNotResponding: job.latestRequestReceivedAt ? false : undefined,
				suspensionState: job.shouldUnsuspend ? 'none' : undefined,
				notesCount: job.additionalNotes ? () => `"notesCount" + ${job.additionalNotes}` : undefined,
			}),
			{
				onError: this.onQueueError,
				concurrency: 2, // Low concurrency, this table is slow for some reason
			},
		);

		this.updateUserQueue = new CollapsedQueue(
			'updateUser',
			oneMinuteInterval,
			(oldJob, newJob) => ({
				updatedAt: maxDate(oldJob.updatedAt, newJob.updatedAt),
				additionalNotes: (oldJob.additionalNotes ?? 0) + (newJob.additionalNotes ?? 0),
			}),
			(id, job) => this.usersRepository.update({ id }, {
				updatedAt: job.updatedAt,
				notesCount: job.additionalNotes ? () => `"notesCount" + ${job.additionalNotes}` : undefined,
			}),
			{
				onError: this.onQueueError,
				concurrency: 4,
			},
		);

		this.internalEventService.on('localUserUpdated', this.onUserUpdated);
		this.internalEventService.on('remoteUserUpdated', this.onUserUpdated);
	}

	@bindThis
	async performAllNow() {
		this.logger.info('Persisting all collapsed queues...');

		await this.performQueue(this.updateInstanceQueue);
		await this.performQueue(this.updateUserQueue);

		this.logger.info('Persistence complete.');
	}

	@bindThis
	private async performQueue<K, V>(queue: CollapsedQueue<K, V>): Promise<void> {
		try {
			const results = await queue.performAllNow();

			const [succeeded, failed] = results.reduce((counts, result) => {
				counts[result.status === 'fulfilled' ? 0 : 1]++;
				return counts;
			}, [0, 0]);

			this.logger.debug(`Persistence completed for ${queue.name}: ${succeeded} succeeded and ${failed} failed`);
		} catch (err) {
			this.logger.error(`Persistence failed for ${queue.name}: ${renderInlineError(err)}`);
		}
	}

	@bindThis
	private onQueueError<K, V>(queue: CollapsedQueue<K, V>, error: unknown): void {
		this.logger.error(`Error persisting ${queue.name}: ${renderInlineError(error)}`);
	}

	@bindThis
	private onUserUpdated(data: { id: string }) {
		this.updateUserQueue.enqueue(data.id, { updatedAt: new Date() });
	}

	async onApplicationShutdown() {
		this.internalEventService.off('localUserUpdated', this.onUserUpdated);
		this.internalEventService.off('remoteUserUpdated', this.onUserUpdated);

		await this.performAllNow();
	}
}

function maxDate(first: Date, second: Date | undefined): Date;
function maxDate(first: Date | undefined, second: Date): Date;
function maxDate(first: Date | undefined, second: Date | undefined): Date | undefined;
// eslint requires a space here -_-

function maxDate(first: Date | undefined, second: Date | undefined): Date | undefined {
	if (first && second) {
		if (first.getTime() > second.getTime()) {
			return first;
		} else {
			return second;
		}
	} else if (first) {
		return first;
	} else if (second) {
		return second;
	} else {
		return undefined;
	}
}
