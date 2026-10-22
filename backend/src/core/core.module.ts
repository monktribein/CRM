import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CORE_MODELS } from '../database/models.js';
import { OrgReferencesService } from './org-references.service.js';
import { RefsService } from './refs.service.js';
import { ScopeService } from './scope.service.js';

/**
 * Registers the shared models once and exposes cross-cutting services
 * (authorisation scope, reference validation, display lookups).
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature(CORE_MODELS)],
  providers: [ScopeService, RefsService, OrgReferencesService],
  exports: [MongooseModule, ScopeService, RefsService, OrgReferencesService],
})
export class CoreModule {}
