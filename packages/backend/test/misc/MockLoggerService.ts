/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
import { Injectable } from '@nestjs/common';
import type { KEYWORD } from 'color-convert/conversions.js';
import type { Config } from '@/config.js';
import Logger, { type Console } from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';

/**
 * Mocked implementation of LoggerService.
 * Suppresses all log output to prevent console spam, and records calls for assertions.
 */
@Injectable()
export class MockLoggerService extends LoggerService {
	/**
	 * Mocked Console implementation.
	 * All logs from all logger instances will be sent here.
	 */
	public readonly console: jest.Mocked<Console> = {
		error: jest.fn(),
		warn: jest.fn(),
		info: jest.fn(),
		log: jest.fn(),
		debug: jest.fn(),
	};

	/**
	 * Controls the verbose flag for logger instances.
	 * Defaults to false (not verbose).
	 */
	public verbose: boolean;

	constructor(config?: Config) {
		config ??= { logging: { verbose: false } } as Config;
		super(config);
	}

	/**
	 * Resets the instance to initial state.
	 * Mocks are reset, and verbose flag is cleared.
	 */
	@bindThis
	public reset() {
		this.console.error.mockReset();
		this.console.warn.mockReset();
		this.console.info.mockReset();
		this.console.log.mockReset();
		this.console.debug.mockReset();

		this.verbose = false;
	}

	/**
	 * Asserts that no errors and/or warnings have been logged.
	 */
	@bindThis
	public assertNoErrors(opts?: { orWarnings?: boolean }): void {
		expect(this.console.error).not.toHaveBeenCalled();

		if (opts?.orWarnings) {
			expect(this.console.warn).not.toHaveBeenCalled();
		}
	}

	@bindThis
	getLogger(domain: string, color?: KEYWORD | undefined): Logger {
		return new Logger(domain, color, this.verbose, this.console);
	}
}
