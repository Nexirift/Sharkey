/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbortError, FetchError } from 'node-fetch';
import { UnrecoverableError } from 'bullmq';
import { StatusError } from '@/misc/status-error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { CaptchaError, captchaErrorCodes } from '@/misc/captcha-error.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { ConflictError } from '@/misc/errors/ConflictError.js';

/**
 * Returns false if the provided value represents a "permanent" error that cannot be retried.
 * Returns true if the error is retryable, unknown (as all errors are retryable by default), or not an error object.
 * If the error cannot be readily identified as retryable, then recurses to the inner exception ("cause" property).
 */
export function isRetryableError(e: unknown): boolean {
	if (e instanceof AggregateError) return e.errors.every(inner => isRetryableError(inner));
	if (e instanceof StatusError) return e.isRetryable;
	if (e instanceof IdentifiableError) return e.isRetryable;
	if (e instanceof CaptchaError) {
		if (e.code === captchaErrorCodes.verificationFailed) return false;
		if (e.code === captchaErrorCodes.invalidParameters) return false;
		if (e.code === captchaErrorCodes.invalidProvider) return false;
		return true;
	}
	if (e instanceof FastifyReplyError) return false;
	if (e instanceof ConflictError) return true;
	if (e instanceof UnrecoverableError) return false;
	if (e instanceof AbortError) return true;
	if (e instanceof FetchError) return true; // TODO check status code?
	if (e instanceof SyntaxError) return false;
	if (e instanceof Error) {
		if (e.name === 'AbortError') return true;
		if (e.cause != null) return isRetryableError(e.cause);
	}

	// TODO aggregate errors (any permanent makes the whole thing permanent)
	// TODO "got" errors

	return true;
}
