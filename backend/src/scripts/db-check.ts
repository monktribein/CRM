/**
 * Verifies the MongoDB connection configured in backend/.env:
 *   npm run db:check
 * Prints the host, database, server version and collection counts — never the
 * connection string or credentials.
 */
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { describeHosts } from '../database/connection.js';
import { runDatabaseScript } from '../database/cli.js';

await runDatabaseScript('Database check', async (app) => {
  const connection = app.get<Connection>(getConnectionToken());
  const admin = connection.db!.admin();
  await admin.ping();
  const info = await admin.serverInfo();
  const collections = (await connection.db!.listCollections().toArray()).map((c) => c.name).sort();
  console.log('\n✔ Connected to MongoDB');
  console.log(`  host:     ${describeHosts(process.env.MONGODB_URI ?? '')}`);
  console.log(`  database: ${connection.name}`);
  console.log(`  version:  ${String(info.version)}`);
  if (!collections.length) {
    console.log('  collections: none yet — run `npm run db:indexes`, then `npm run db:bootstrap`.');
  } else {
    for (const name of collections) {
      const count = await connection.db!.collection(name).estimatedDocumentCount();
      console.log(`  ${name.padEnd(22)} ${count}`);
    }
  }
  const [major] = String(info.version).split('.').map(Number);
  if ((major ?? 0) < 5) console.warn('\n⚠ MongoDB 5.0+ is required (reports use $dateTrunc).');
});
