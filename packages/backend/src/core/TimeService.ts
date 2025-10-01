/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { bindThis } from '@/decorators.js';

/**
 * Provides abstractions to access the current time.
 * Exists for unit testing purposes, so that tests can "simulate" any given time for consistency.
 */
@Injectable()
export abstract class TimeService<TTimer extends Timer = Timer> implements OnApplicationShutdown {
	protected readonly timers = new Map<symbol, TTimer>();

	protected constructor() {}

	/**
	 * Returns the current time, in milliseconds since the Unix epoch.
	 */
	public abstract get now(): number;

	/**
	 * Returns a new Date instance representing the current time.
	 */
	public get date(): Date {
		return new Date(this.now);
	}

	@bindThis
	public startTimer(callback: () => void, delay: number, opts?: { repeated?: boolean }): symbol {
		const timerId = Symbol();
		const repeating = opts?.repeated ?? false;

		const timer = this.startNativeTimer(timerId, repeating, callback, delay);
		this.timers.set(timerId, timer);

		return timerId;
	}

	protected abstract startNativeTimer(timerId: symbol, repeating: boolean, callback: () => void, delay: number): TTimer;

	/**
	 * Clears a registered timeout or interval.
	 * Returns true if the registration exists and was still active, false otherwise.
	 * Safe to call with invalid or expired IDs.
	 */
	@bindThis
	public stopTimer(id: symbol): boolean {
		const reg = this.timers.get(id);
		if (!reg) return false;

		this.stopNativeTimer(reg);
		this.timers.delete(id);
		return true;
	}

	protected abstract stopNativeTimer(reg: TTimer): void;

	/**
	 * Cleanup all handles and references.
	 * Safe to call multiple times.
	 *
	 * **Must be called before shutting down the app!**
	 */
	@bindThis
	public dispose(): void {
		for (const reg of this.timers.values()) {
			this.stopNativeTimer(reg);
		}
		this.timers.clear();
	}

	@bindThis
	onApplicationShutdown(): void {
		this.dispose();
	}
}

export interface Timer {
	timerId: symbol;
	repeating: boolean;
	delay: number;
	callback: () => void;
}

/**
 * Default implementation of TimeService, uses Date.now() as time source and setTimeout/setInterval for timers.
 */
@Injectable()
export class NativeTimeService extends TimeService<NativeTimer> implements OnApplicationShutdown {
	public get now(): number {
		return Date.now();
	}

	public constructor() {
		super();
	}

	protected startNativeTimer(timerId: symbol, repeating: boolean, callback: () => void, delay: number): NativeTimer {
		// Wrap the caller's callback to make sure we clean up the registration.
		const wrappedCallback = () => {
			this.timers.delete(timerId);
			callback();
		};

		const timeout = repeating
			? global.setInterval(wrappedCallback, delay)
			: global.setTimeout(wrappedCallback, delay);

		return { callback, timerId, repeating, delay, timeout };
	}

	protected stopNativeTimer(reg: NativeTimer): void {
		if (reg.repeating) {
			global.clearInterval(reg.timeout);
		} else {
			global.clearTimeout(reg.timeout);
		}
	}
}

export interface NativeTimer extends Timer {
	timeout: NodeJS.Timeout;
}
