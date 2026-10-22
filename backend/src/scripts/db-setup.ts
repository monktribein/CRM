/**
 * One-step database setup for a new environment:
 *   npm run db:setup
 *   1. creates all collections and indexes
 *   2. creates the organisation, default departments and the Super Admin
 *      from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (if set)
 *   3. outside production only, loads demo data into the SAME organisation
 *      when SEED_DEV_PASSWORD is set — so the admin can explore every screen
 * Every step is idempotent; re-running changes nothing.
 */
import { model, runDatabaseScript } from '../database/cli.js';
import { ALL_MODELS } from '../database/models.js';
import { assertStrongPassword, bootstrapOrganization, configuredOrganization, type BootstrapModels } from '../database/seed/bootstrap.js';
import { seedDevelopmentData } from '../database/seed/development.js';

await runDatabaseScript('Database setup', async (app) => {
  for (const { name } of ALL_MODELS) {
    const m = model(app, name);
    await m.createCollection().catch((err: { code?: number }) => {
      if (err.code !== 48) throw err;
    });
    await m.createIndexes();
  }
  console.log(`✔ ${ALL_MODELS.length} collections and their indexes are in place`);

  const target = configuredOrganization();
  const core: BootstrapModels = {
    organizations: model(app, 'Organization'),
    departments: model(app, 'Department'),
    users: model(app, 'User'),
    counters: model(app, 'Counter'),
  };

  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  if (email) {
    const { created } = await bootstrapOrganization(core, {
      orgName: target.name,
      orgSlug: target.slug,
      email,
      password: assertStrongPassword(process.env.SEED_ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD'),
      firstName: process.env.SEED_ADMIN_FIRST_NAME,
      lastName: process.env.SEED_ADMIN_LAST_NAME,
    });
    console.log(`${created ? '✔ Created' : '• Kept existing'} Super Admin ${email.toLowerCase()} in "${target.name}" (${target.slug})`);
  } else {
    console.log('• SEED_ADMIN_EMAIL not set — skipped creating the Super Admin');
  }

  if (process.env.NODE_ENV === 'production') {
    console.log('• Production: demo data is never loaded');
  } else if (process.env.SEED_DEV_PASSWORD) {
    const { summary } = await seedDevelopmentData(
      { ...core, projects: model(app, 'Project'), tasks: model(app, 'Task'), comments: model(app, 'Comment') },
      assertStrongPassword(process.env.SEED_DEV_PASSWORD, 'SEED_DEV_PASSWORD'),
      process.env.NODE_ENV,
      target,
    );
    console.log(`✔ Demo data in "${target.name}": +${summary.users} users, +${summary.projects} projects, +${summary.tasks} tasks, +${summary.comments} comments`);
  } else {
    console.log('• SEED_DEV_PASSWORD not set — skipped demo data');
  }
});
