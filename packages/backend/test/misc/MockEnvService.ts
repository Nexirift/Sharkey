/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import process from 'node:process';
import { Injectable } from '@nestjs/common';
import { EnvService } from '@/core/EnvService.js';
import { CacheManagementService } from '@/core/CacheManagementService.js';
import { bindThis } from '@/decorators.js';

/**
 * Implementation of EnvService with support for mocking values.
 * Environment and package versions are loaded from their original sources, but can be overridden as-needed.
 */
@Injectable()
export class MockEnvService extends EnvService {
	private _env: Partial<Record<string, string>>;

	constructor(cacheManagementService: CacheManagementService) {
		super(cacheManagementService);
		this._env = process.env;
	}

	/**
	 * Gets the mocked environment.
	 * The returned object is "live" and can be modified without polluting the actual application environment.
	 */
	get env(): Partial<Record<string, string>> {
		return this._env;
	}

	/**
	 * Replaces the entire mocked environment.
	 * Pass undefined to restore the original un-mocked values.
	 */
	set env(value: Partial<Record<string, string>> | undefined) {
		if (value !== undefined) {
			this._env = value;
		} else {
			this._env = process.env;
		}
	}

	/**
	 * Overrides the version for a dependency.
	 * Pass a string or null to override the version, or pass undefined to clear the override and restore the original value.
	 */
	@bindThis
	public setDependencyVersion(dependency: string, version: string | null | undefined) {
		if (version !== undefined) {
			this.dependencyVersionCache.set(dependency, version);
		} else {
			this.dependencyVersionCache.delete(dependency);
		}
	}

	/**
	 * Resets the mock to initial values.
	 */
	@bindThis
	public mockReset(): void {
		this._env = process.env;
		this.dependencyVersionCache.clear();
	}
}
