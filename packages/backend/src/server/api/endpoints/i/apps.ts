/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AccessTokensRepository, SharedAccessTokensRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

export const meta = {
	requireCredential: true,

	secure: true,

	res: {
		type: 'array',
		items: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					optional: false,
					format: 'misskey:id',
				},
				name: {
					type: 'string',
					optional: true,
				},
				createdAt: {
					type: 'string',
					optional: false,
					format: 'date-time',
				},
				lastUsedAt: {
					type: 'string',
					optional: true,
					format: 'date-time',
				},
				permission: {
					type: 'array',
					optional: false,
					uniqueItems: true,
					items: {
						type: 'string',
					},
				},
				grantees: {
					type: 'array',
					optional: false,
					items: {
						ref: 'UserLite',
					},
				},
				rank: {
					type: 'string',
					optional: false,
					nullable: true,
					enum: ['admin', 'mod', 'user'],
				},
			},
		},
	},

	// 2 calls per second
	limit: {
		duration: 1000,
		max: 2,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sort: { type: 'string', enum: ['+createdAt', '-createdAt', '+lastUsedAt', '-lastUsedAt'] },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		@Inject(DI.sharedAccessTokensRepository)
		private readonly sharedAccessTokenRepository: SharedAccessTokensRepository,

		private readonly userEntityService: UserEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me, at) => {
			const query = this.accessTokensRepository.createQueryBuilder('token')
				.where('token.userId = :userId', { userId: me.id })
				.leftJoinAndSelect('token.app', 'app');

			switch (ps.sort) {
				case '+createdAt': query.orderBy('token.id', 'DESC'); break;
				case '-createdAt': query.orderBy('token.id', 'ASC'); break;
				case '+lastUsedAt': query.orderBy('token.lastUsedAt', 'DESC'); break;
				case '-lastUsedAt': query.orderBy('token.lastUsedAt', 'ASC'); break;
				default: query.orderBy('token.id', 'ASC'); break;
			}

			const tokens = await query.getMany();

			return await Promise.all(tokens.map(async token => {
				// TODO inline this table into a column w/ GIN index
				const sharedTokens = await this.sharedAccessTokenRepository.find({
					where: { accessTokenId: token.id },
					relations: { grantee: true },
				});

				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				const grantees = await this.userEntityService.packMany(sharedTokens.map(t => t.grantee!), me, { token: at });

				return {
					id: token.id,
					name: token.name ?? token.app?.name,
					createdAt: this.idService.parse(token.id).date.toISOString(),
					lastUsedAt: token.lastUsedAt?.toISOString(),
					permission: token.app ? token.app.permission : token.permission,
					rank: token.rank,
					grantees,
				};
			}));
		});
	}
}
