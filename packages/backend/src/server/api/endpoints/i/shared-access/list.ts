/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { SharedAccessTokensRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { Packed } from '@/misc/json-schema.js';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

export const meta = {
	requireCredential: true,
	secure: true,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: {
					type: 'string',
					optional: false, nullable: false,
				},
				user: {
					ref: 'UserLite',
					optional: false, nullable: false,
				},
				permissions: {
					type: 'array',
					optional: false, nullable: false,
					items: {
						type: 'string',
						optional: false, nullable: false,
					},
				},
			},
		},
		properties: {
			userId: {
				type: 'string',
				optional: false, nullable: false,
			},
			token: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},

	// 2 calls per second
	limit: {
		duration: 1000,
		max: 2,
	},
} as const;

export const paramDef = {} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.sharedAccessToken)
		private readonly sharedAccessTokensRepository: SharedAccessTokensRepository,

		private readonly userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const tokens = await this.sharedAccessTokensRepository.find({
				where: { granteeId: me.id },
				relations: { accessToken: true },
			});

			const users = tokens.map(token => token.accessToken!.userId);
			const packedUsers: Packed<'UserLite'>[] = await this.userEntityService.packMany(users, me);
			const packedUserMap = new Map<string, Packed<'UserLite'>>(packedUsers.map(u => [u.id, u]));

			return tokens.map(token => ({
				id: token.accessTokenId,
				permissions: token.accessToken!.permission,
				user: packedUserMap.get(token.accessToken!.userId) as Packed<'UserLite'>,
			}));
		});
	}
}
