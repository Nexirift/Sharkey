/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { AccessTokensRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

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
		@Inject(DI.accessTokensRepository)
		private readonly accessTokensRepository: AccessTokensRepository,

		private readonly userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me, token) => {
			const tokens = await this.accessTokensRepository
				.createQueryBuilder('token')
				.where(':meIdAsList <@ token.granteeIds', { meIdAsList: [me.id] })
				.getMany();

			const userIds = tokens.map(token => token.userId);
			const packedUsers = await this.userEntityService.packMany(userIds, me, { token });
			const packedUserMap = new Map(packedUsers.map(u => [u.id, u]));

			return tokens.map(token => ({
				id: token.id,
				permissions: token.permission,
				user: packedUserMap.get(token.userId),
			}));
		});
	}
}
