/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { FlashLikesRepository, MiAccessToken } from '@/models/_.js';
import type { } from '@/models/Blocking.js';
import type { MiUser } from '@/models/User.js';
import type { MiFlashLike } from '@/models/FlashLike.js';
import { bindThis } from '@/decorators.js';
import { FlashEntityService } from './FlashEntityService.js';

@Injectable()
export class FlashLikeEntityService {
	constructor(
		@Inject(DI.flashLikesRepository)
		private flashLikesRepository: FlashLikesRepository,

		private flashEntityService: FlashEntityService,
	) {
	}

	@bindThis
	public async pack(
		src: MiFlashLike['id'] | MiFlashLike,
		me?: { id: MiUser['id'] } | null | undefined,
		token?: MiAccessToken | null,
	) {
		const like = typeof src === 'object' ? src : await this.flashLikesRepository.findOneByOrFail({ id: src });

		return {
			id: like.id,
			flash: await this.flashEntityService.pack(like.flash ?? like.flashId, me, token),
		};
	}

	@bindThis
	public packMany(
		likes: any[],
		me: { id: MiUser['id'] },
		token?: MiAccessToken | null,
	) {
		return Promise.all(likes.map(x => this.pack(x, me, token)));
	}
}

