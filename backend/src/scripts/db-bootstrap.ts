/**
 * Creates the organisation, default departments and first Super Admin.
 * Safe in production and idempotent:
 *   SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='…' npm run db:bootstrap
 */
import { model, runDatabaseScript } from '../database/cli.js';
import { assertStrongPassword, bootstrapOrganization, configuredOrganization } from '../database/seed/bootstrap.js';

await runDatabaseScript('Bootstrap', async (app) => {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  if (!email) throw new Error('SEED_ADMIN_EMAIL is required.');
  const password = assertStrongPassword(process.env.SEED_ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD');
  const { org, created } = await bootstrapOrganization(
    {
      organizations: model(app, 'Organization'),
      departments: model(app, 'Department'),
      users: model(app, 'User'),
      counters: model(app, 'Counter'),
    },
    {
      orgName: configuredOrganization().name,
      orgSlug: configuredOrganization().slug,
      email,
      password,
      firstName: process.env.SEED_ADMIN_FIRST_NAME,
      lastName: process.env.SEED_ADMIN_LAST_NAME,
    },
  );
  console.log(`✔ Organisation "${org.name}" (slug: ${org.slug}) with 7 default departments`);
  console.log(created ? `✔ Created Super Admin ${email.toLowerCase()}` : `• Super Admin ${email.toLowerCase()} already exists — nothing changed`);
});
