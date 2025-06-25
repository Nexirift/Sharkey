/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { CollapsedQueue } from '@/misc/collapsed-queue.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { EnvService } from '@/core/EnvService.js';
import { bindThis } from '@/decorators.js';
import type { MiInstance } from '@/models/Instance.js';

export type UpdateInstanceJob = {
	latestRequestReceivedAt: Date,
	shouldUnsuspend: boolean,
};

@Injectable()
export class CollapsedQueueService implements OnApplicationShutdown {
	// Moved from InboxProcessorService to allow access from ApInboxService
	public readonly updateInstanceQueue: CollapsedQueue<MiInstance['id'], UpdateInstanceJob>;

	private readonly logger: Logger;

	constructor(
		private readonly federatedInstanceService: FederatedInstanceService,
		private readonly envService: EnvService,

		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('collapsed-queue');
		this.updateInstanceQueue = new CollapsedQueue(
			this.envService.env.NODE_ENV !== 'test'
				? 60 * 1000 * 5
				: 0,
			(oldJob, newJob) => this.collapseUpdateInstance(oldJob, newJob),
			(id, job) => this.performUpdateInstance(id, job),
		);
	}

	@bindThis
	private collapseUpdateInstance(oldJob: UpdateInstanceJob, newJob: UpdateInstanceJob) {
		const latestRequestReceivedAt = oldJob.latestRequestReceivedAt < newJob.latestRequestReceivedAt
			? newJob.latestRequestReceivedAt
			: oldJob.latestRequestReceivedAt;
		const shouldUnsuspend = oldJob.shouldUnsuspend || newJob.shouldUnsuspend;
		return {
			latestRequestReceivedAt,
			shouldUnsuspend,
		};
	}

	@bindThis
	private async performUpdateInstance(id: string, job: UpdateInstanceJob) {
		await this.federatedInstanceService.update(id, {
			latestRequestReceivedAt: new Date(),
			isNotResponding: false,
			// もしサーバーが死んでるために配信が止まっていた場合には自動的に復活させてあげる
			suspensionState: job.shouldUnsuspend ? 'none' : undefined,
		});
	}

	async dispose() {
		await this.updateInstanceQueue.performAllNow().catch(err => this.logger.error(`Shutdown error in updateInstanceQueue: ${renderInlineError(err)}`));
	}

	async onApplicationShutdown() {
		await this.dispose();
	}
}
