/**
 * Creates every collection and index declared in the schemas:
 *   npm run db:indexes            # create missing indexes (safe, idempotent)
 *   npm run db:indexes -- --sync  # also DROP indexes not declared in the schemas
 *
 * Use --sync after schema changes that rename or remove indexes.
 */
import { runDatabaseScript, model } from '../database/cli.js';
import { ALL_MODELS } from '../database/models.js';

const sync = process.argv.includes('--sync');

await runDatabaseScript('Index build', async (app) => {
  for (const { name } of ALL_MODELS) {
    const m = model(app, name);
    await m.createCollection().catch((err: { code?: number }) => {
      if (err.code !== 48) throw err; // 48 = NamespaceExists
    });
    if (sync) {
      const dropped = await m.syncIndexes();
      if (dropped.length) console.log(`  ${m.collection.name}: dropped ${dropped.join(', ')}`);
    } else {
      await m.createIndexes();
    }
    const indexes = await m.collection.indexes();
    console.log(`✔ ${m.collection.name.padEnd(20)} ${indexes.map((i) => i.name).join(', ')}`);
  }
});
