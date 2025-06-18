/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EntityNotFoundError } from 'typeorm';
import { bindThis } from '@/decorators.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import type { InternalEventTypes } from '@/core/GlobalEventService.js';
import { MemoryKVCache, type MemoryCacheServices } from '@/misc/cache.js';
import { makeKVPArray, type KVPArray } from '@/misc/kvp-array.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { FetchFailedError } from '@/misc/errors/FetchFailedError.js';
import { KeyNotFoundError } from '@/misc/errors/KeyNotFoundError.js';

export interface QuantumKVOpts<T> {
	/**
	 * Memory cache lifetime in milliseconds.
	 */
	lifetime: number;

	/**
	 * Callback to fetch the value for a key that wasn't found in the cache.
	 * Return null/undefined or throw an error if no value exists for the given key.
	 * May be synchronous or async.
	 */
	fetcher: (key: string, cache: QuantumKVCache<T>) => T | null | undefined | Promise<T | null | undefined>;

	/**
	 * Optional callback to fetch the value for multiple keys that weren't found in the cache.
	 * Don't throw or return null if a key has no value; just omit it from the response.
	 * May be synchronous or async.
	 * If not provided, then the implementation will fall back on repeated calls to fetcher().
	 */
	bulkFetcher?: (keys: string[], cache: QuantumKVCache<T>) => Iterable<[key: string, value: T]> | Promise<Iterable<[key: string, value: T]>>;

	/**
	 * Optional callback when one or more values are changed (created, updated, or deleted) in the cache, either locally or elsewhere in the cluster.
	 * This is called *after* the cache state is updated.
	 * Implementations may be synchronous or async.
	 */
	onChanged?: (keys: string[], cache: QuantumKVCache<T>) => void | Promise<void>;

	/**
	 * Optional callback when all values are removed from the cache, either locally or elsewhere in the cluster.
	 * This is called *after* the cache state is updated.
	 * Implementations may be synchronous or async.
	 */
	onReset?: (cache: QuantumKVCache<T>) => void | Promise<void>;

	// TODO equality comparer
}

export interface QuantumCacheServices extends MemoryCacheServices {
	/**
	 * Event bus to attach to.
	 * This can be mocked for easier testing under DI.
	 */
	readonly internalEventService: InternalEventService;
}

/**
 * QuantumKVCache is a lifetime-bounded memory cache (like MemoryKVCache) with automatic cross-cluster synchronization via Redis.
 * All nodes in the cluster are guaranteed to have a *subset* view of the current accurate state, though individual processes may have different items in their local cache.
 * This ensures that a call to get() will never return stale data.
 */
export class QuantumKVCache<T> implements Iterable<readonly [key: string, value: T]> {
	private readonly internalEventService: InternalEventService;

	private readonly memoryCache: MemoryKVCache<T>;

	public readonly fetcher: QuantumKVOpts<T>['fetcher'];
	public readonly bulkFetcher: QuantumKVOpts<T>['bulkFetcher'];
	public readonly onChanged: QuantumKVOpts<T>['onChanged'];
	public readonly onReset: QuantumKVOpts<T>['onReset'];

	/**
	 * @param name Unique name of the cache - must be the same in all processes.
	 * @param services DI services - internalEventService is required
	 * @param opts Cache options
	 */
	constructor(
		// TODO validate to make sure this is unique
		public readonly name: string,
		services: QuantumCacheServices,
		opts: QuantumKVOpts<T>,
	) {
		// OK: we forward all management calls to the inner cache.
		// eslint-disable-next-line no-restricted-syntax
		this.memoryCache = new MemoryKVCache(name + ':mem', services, { lifetime: opts.lifetime });
		this.fetcher = opts.fetcher;
		this.bulkFetcher = opts.bulkFetcher;
		this.onChanged = opts.onChanged;
		this.onReset = opts.onReset;

		this.internalEventService = services.internalEventService;
		this.internalEventService.on('quantumCacheUpdated', this.onQuantumCacheUpdated, {
			// Ignore our own events, otherwise we'll immediately erase any set value.
			ignoreLocal: true,
		});
		this.internalEventService.on('quantumCacheReset', this.onQuantumCacheReset, {
			// Ignore our own events, otherwise we'll immediately erase any set value.
			ignoreLocal: true,
		});
	}

	/**
	 * The number of items currently in memory.
	 * This applies to the local subset view, not the cross-cluster cache state.
	 */
	public get size() {
		return this.memoryCache.size;
	}

	/**
	 * Iterates all [key, value] pairs in memory.
	 * This applies to the local subset view, not the cross-cluster cache state.
	 */
	@bindThis
	public *entries(): Generator<[key: string, value: T]> {
		for (const entry of this.memoryCache.entries) {
			yield [entry[0], entry[1].value];
		}
	}

	/**
	 * Iterates all keys in memory.
	 * This applies to the local subset view, not the cross-cluster cache state.
	 */
	@bindThis
	public *keys() {
		for (const entry of this.memoryCache.entries) {
			yield entry[0];
		}
	}

	/**
	 * Iterates all values pairs in memory.
	 * This applies to the local subset view, not the cross-cluster cache state.
	 */
	@bindThis
	public *values() {
		for (const entry of this.memoryCache.entries) {
			yield entry[1].value;
		}
	}

	/**
	 * Creates or updates a value in the cache, and erases any stale caches across the cluster.
	 * Fires an onChanged event after the cache has been updated in all processes.
	 * Skips if the value is unchanged.
	 */
	@bindThis
	public async set(key: string, value: T): Promise<void> {
		if (this.memoryCache.get(key) === value) {
			return;
		}

		this.memoryCache.set(key, value);

		await this.internalEventService.emit('quantumCacheUpdated', { name: this.name, keys: [key] });

		if (this.onChanged) {
			await this.onChanged([key], this);
		}
	}

	/**
	 * Creates or updates multiple value in the cache, and erases any stale caches across the cluster.
	 * Fires an onChanged for each changed item event after the cache has been updated in all processes.
	 * Skips if all values are unchanged.
	 */
	@bindThis
	public async setMany(items: Iterable<readonly [key: string, value: T]>): Promise<void> {
		const changedKeys: string[] = [];

		for (const item of items) {
			if (this.memoryCache.get(item[0]) !== item[1]) {
				changedKeys.push(item[0]);
				this.memoryCache.set(item[0], item[1]);
			}
		}

		if (changedKeys.length > 0) {
			await this.internalEventService.emit('quantumCacheUpdated', { name: this.name, keys: changedKeys });

			if (this.onChanged) {
				await this.onChanged(changedKeys, this);
			}
		}
	}

	/**
	 * Adds a value to the local memory cache without notifying other process.
	 * Neither a Redis event nor onChanged callback will be fired, as the value has not actually changed.
	 * This should only be used when the value is known to be current, like after fetching from the database.
	 */
	@bindThis
	public add(key: string, value: T): void {
		this.memoryCache.set(key, value);
	}

	/**
	 * Adds multiple values to the local memory cache without notifying other process.
	 * Neither a Redis event nor onChanged callback will be fired, as the value has not actually changed.
	 * This should only be used when the value is known to be current, like after fetching from the database.
	 */
	@bindThis
	public addMany(items: Iterable<readonly [key: string, value: T]>): void {
		for (const [key, value] of items) {
			this.memoryCache.set(key, value);
		}
	}

	/**
	 * Gets a value from the local memory cache, or returns undefined if not found.
	 * Returns cached data only - does not make any fetches.
	 * TODO separate get/getMaybe
	 */
	@bindThis
	public get(key: string): T | undefined {
		return this.memoryCache.get(key);
	}

	/**
	 * Gets multiple values from the local memory cache; returning undefined for any missing keys.
	 * Returns cached data only - does not make any fetches.
	 * TODO don't return undefined, matching fetch
	 */
	@bindThis
	public getMany(keys: Iterable<string>): [key: string, value: T | undefined][] {
		const results: [key: string, value: T | undefined][] = [];
		for (const key of keys) {
			results.push([key, this.get(key)]);
		}
		return results;
	}

	/**
	 * Gets or fetches a value from the cache.
	 * Fires an onChanged event, but does not emit an update event to other processes.
	 */
	@bindThis
	public async fetch(key: string): Promise<T> {
		let value = this.memoryCache.get(key);
		if (value == null) {
			value = await this.callFetch(key);

			this.memoryCache.set(key, value);

			if (this.onChanged) {
				await this.onChanged([key], this);
			}
		}
		return value;
	}

	/**
	 * Gets or fetches a value from the cache, returning undefined if not found.
	 * Fires an onChanged event on success, but does not emit an update event to other processes.
	 */
	@bindThis
	public async fetchMaybe(key: string): Promise<T | undefined> {
		let value = this.memoryCache.get(key);
		if (value != null) {
			return value;
		}

		value = await this.callFetchMaybe(key);
		if (value == null) {
			return undefined;
		}

		this.memoryCache.set(key, value);

		if (this.onChanged) {
			await this.onChanged([key], this);
		}

		return value;
	}

	/**
	 * Gets or fetches multiple values from the cache.
	 * Missing / unmapped values are excluded from the response.
	 * Fires onChanged event, but does not emit any update events to other processes.
	 */
	@bindThis
	public async fetchMany(keys: Iterable<string>): Promise<KVPArray<T>> {
		const results: [key: string, value: T][] = [];
		const toFetch: string[] = [];

		// Spliterate into cached results / uncached keys.
		for (const key of keys) {
			const fromCache = this.get(key);
			if (fromCache) {
				results.push([key, fromCache]);
			} else {
				toFetch.push(key);
			}
		}

		// Fetch any uncached keys
		if (toFetch.length > 0) {
			const fetched = await this.bulkFetch(toFetch);

			// Add to cache and return set
			this.addMany(fetched);
			results.push(...fetched);

			// Emit event
			if (this.onChanged) {
				await this.onChanged(toFetch, this);
			}
		}

		return makeKVPArray(results);
	}

	/**
	 * Returns true is a key exists in memory.
	 * This applies to the local subset view, not the cross-cluster cache state.
	 */
	@bindThis
	public has(key: string): boolean {
		return this.memoryCache.has(key);
	}

	/**
	 * Deletes a value from the cache, and erases any stale caches across the cluster.
	 * Fires an onChanged event after the cache has been updated in all processes.
	 */
	@bindThis
	public async delete(key: string): Promise<void> {
		this.memoryCache.delete(key);

		await this.internalEventService.emit('quantumCacheUpdated', { name: this.name, keys: [key] });

		if (this.onChanged) {
			await this.onChanged([key], this);
		}
	}
	/**
	 * Deletes multiple values from the cache, and erases any stale caches across the cluster.
	 * Fires an onChanged event for each key after the cache has been updated in all processes.
	 * Skips if the input is empty.
	 */
	@bindThis
	public async deleteMany(keys: Iterable<string>): Promise<void> {
		const deleted: string[] = [];

		for (const key of keys) {
			this.memoryCache.delete(key);
			deleted.push(key);
		}

		if (deleted.length === 0) {
			return;
		}

		await this.internalEventService.emit('quantumCacheUpdated', { name: this.name, keys: deleted });

		if (this.onChanged) {
			await this.onChanged(deleted, this);
		}
	}

	/**
	 * Refreshes the value of a key from the fetcher, and erases any stale caches across the cluster.
	 * Fires an onChanged event after the cache has been updated in all processes.
	 */
	@bindThis
	public async refresh(key: string): Promise<T> {
		const value = await this.callFetch(key);
		await this.set(key, value);
		return value;
	}

	@bindThis
	public async refreshMany(keys: Iterable<string>): Promise<KVPArray<T>> {
		const toFetch = Array.from(keys);
		const fetched = await this.bulkFetch(toFetch);
		await this.setMany(fetched);
		return makeKVPArray(fetched);
	}

	/**
	 * Erases all entries from the local memory cache.
	 * Does not send any events or update other processes.
	 */
	@bindThis
	public clear(): void {
		this.memoryCache.clear();
	}

	/**
	 * Erases all entries from the cache.
	 * Fires an onReset event and updates other processes.
	 */
	public async reset(): Promise<void> {
		this.clear();

		await this.internalEventService.emit('quantumCacheReset', { name: this.name });

		if (this.onReset) {
			await this.onReset(this);
		}
	}

	/**
	 * Removes expired cache entries from the local view.
	 * Does not send any events or update other processes.
	 */
	@bindThis
	public gc() {
		this.memoryCache.gc();
	}

	/**
	 * Erases all data and disconnects from the cluster.
	 * This *must* be called when shutting down to prevent memory leaks!
	 */
	@bindThis
	public dispose() {
		this.internalEventService.off('quantumCacheUpdated', this.onQuantumCacheUpdated);
		this.internalEventService.off('quantumCacheReset', this.onQuantumCacheReset);

		this.memoryCache.dispose();
	}

	@bindThis
	private async bulkFetch(keys: string[]): Promise<[key: string, value: T][]> {
		// Use the bulk fetcher if available.
		if (this.bulkFetcher) {
			try {
				const results = await this.bulkFetcher(keys, this);
				return Array.from(results);
			} catch (err) {
				throw new FetchFailedError(this.name, keys, renderInlineError(err), { cause: err });
			}
		}

		// Otherwise fall back to regular fetch.
		const results: [key: string, value: T][] = [];
		for (const key of keys) {
			const value = await this.callFetchMaybe(key);
			if (value != null) {
				results.push([key, value]);
			}
		}
		return results;
	}

	@bindThis
	private async onQuantumCacheUpdated(data: InternalEventTypes['quantumCacheUpdated']): Promise<void> {
		if (data.name === this.name) {
			for (const key of data.keys) {
				this.memoryCache.delete(key);
			}

			if (this.onChanged) {
				await this.onChanged(data.keys, this);
			}
		}
	}

	@bindThis
	private async callFetch(key: string): Promise<T> {
		const value = await this.callFetchMaybe(key);

		if (value == null) {
			throw new KeyNotFoundError(this.name, key);
		}

		return value;
	}

	@bindThis
	private async callFetchMaybe(key: string): Promise<T | undefined> {
		try {
			const value = await this.fetcher(key, this);
			return value ?? undefined;
		} catch (err) {
			if (err instanceof EntityNotFoundError) {
				return undefined;
			}

			throw new FetchFailedError(this.name, key, renderInlineError(err), { cause: err });
		}
	}

	@bindThis
	private async onQuantumCacheReset(data: InternalEventTypes['quantumCacheReset']): Promise<void> {
		if (data.name === this.name) {
			this.clear();

			if (this.onReset) {
				await this.onReset(this);
			}
		}
	}

	/**
	 * Iterates all [key, value] pairs in memory.
	 * This applies to the local subset view, not the cross-cluster cache state.
	 */
	[Symbol.iterator](): Iterator<[key: string, value: T]> {
		return this.entries();
	}
}

