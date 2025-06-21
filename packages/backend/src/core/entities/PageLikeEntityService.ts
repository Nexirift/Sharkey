/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiAccessToken, PageLikesRepository } from '@/models/_.js';
import type { } from '@/models/Blocking.js';
import type { MiUser } from '@/models/User.js';
import type { MiPageLike } from '@/models/PageLike.js';
import { bindThis } from '@/decorators.js';
import { PageEntityService } from './PageEntityService.js';

@Injectable()
export class PageLikeEntityService {
	constructor(
		@Inject(DI.pageLikesRepository)
		private pageLikesRepository: PageLikesRepository,

		private pageEntityService: PageEntityService,
	) {
	}

	@bindThis
	public async pack(
		src: MiPageLike['id'] | MiPageLike,
		me?: { id: MiUser['id'] } | null | undefined,
		token?: MiAccessToken | null,
	) {
		const like = typeof src === 'object' ? src : await this.pageLikesRepository.findOneByOrFail({ id: src });

		return {
			id: like.id,
			page: await this.pageEntityService.pack(like.page ?? like.pageId, me, token),
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

