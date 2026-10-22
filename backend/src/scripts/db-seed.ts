/**
 * DEVELOPMENT ONLY — loads synthetic demo data into the configured database:
 *   SEED_DEV_PASSWORD='…' npm run db:seed
 * Refuses to run when NODE_ENV=production. Idempotent.
 */
import { model, runDatabaseScript } from '../database/cli.js';
import { assertStrongPassword, configuredOrganization } from '../database/seed/bootstrap.js';
import { DEV_ADMIN_EMAIL, seedDevelopmentData } from '../database/seed/development.js';

if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to load demo data: NODE_ENV=production. Use `npm run db:bootstrap` for production.');
  process.exit(1);
}

await runDatabaseScript('Development seed', async (app) => {
  const target = configuredOrganization();
  const password = assertStrongPassword(process.env.SEED_DEV_PASSWORD, 'SEED_DEV_PASSWORD');
  const { summary } = await seedDevelopmentData(
    {
      organizations: model(app, 'Organization'),
      departments: model(app, 'Department'),
      users: model(app, 'User'),
      counters: model(app, 'Counter'),
      projects: model(app, 'Project'),
      tasks: model(app, 'Task'),
      comments: model(app, 'Comment'),
    },
    password,
    process.env.NODE_ENV,
    target,
  );
  console.log(`✔ Development data ready in organisation "${target.name}" (slug: ${target.slug})`);
  console.log(`  created: ${summary.users} users, ${summary.projects} projects, ${summary.tasks} tasks, ${summary.comments} comments`);
  console.log(`  sign in as ${DEV_ADMIN_EMAIL} (or any seeded @example.com user) with SEED_DEV_PASSWORD`);
});
