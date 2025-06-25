/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { TimeService, type TimerHandle } from '@/global/TimeService.js';
import promiseLimit from 'promise-limit';

type Job<V> = {
	value: V;
	timer: TimerHandle;
};

// TODO: redis使えるようにする
export class CollapsedQueue<K, V> {
	private readonly limiter?: ReturnType<typeof promiseLimit<void>>;
	private jobs: Map<K, Job<V>> = new Map();

	constructor(
		public readonly name: string,
		protected readonly timeService: TimeService,
		private readonly timeout: number,
		private readonly collapse: (oldValue: V, newValue: V) => V,
		private readonly perform: (key: K, value: V) => Promise<void | unknown>,
		private readonly opts?: {
			onError?: (queue: CollapsedQueue<K, V>, error: unknown) => void | Promise<void>,
			onPerform?: (queue: CollapsedQueue<K, V>, key: K, value: V) => void | Promise<void>,
			concurrency?: number,
		},
	) {
		if (opts?.concurrency) {
			this.limiter = promiseLimit<void>(opts.concurrency);
		}
	}

	enqueue(key: K, value: V) {
		if (this.jobs.has(key)) {
			const old = this.jobs.get(key)!;
			const merged = this.collapse(old.value, value);
			this.jobs.set(key, { ...old, value: merged });
		} else {
			const timer = this.timeService.startTimer(() => {
				const job = this.jobs.get(key)!;
				this.jobs.delete(key);
				this._perform(key, job.value);
			}, this.timeout);
			this.jobs.set(key, { value, timer });
		}
	}

	delete(key: K) {
		const job = this.jobs.get(key);
		if (job) {
			clearTimeout(job.timer);
			this.jobs.delete(key);
		}
	}

	async performAllNow() {
		const entries = [...this.jobs.entries()];
		this.jobs.clear();
		for (const [_key, job] of entries) {
			this.timeService.stopTimer(job.timer);
		}
		return await Promise.allSettled(entries.map(([key, job]) => this._perform(key, job.value)));
	}

	private async _perform(key: K, value: V) {
		try {
			if (this.limiter) {
				await this.limiter(async () => {
					await this.perform(key, value);
				});
			} else {
				await this.perform(key, value);
			}
			await this.opts?.onPerform?.(this, key, value);
		} catch (err) {
			await this.opts?.onError?.(this, err);
			throw err;
		}
	}
}
