import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const database = new PGlite();
try {
  await database.exec(await readFile(new URL('../supabase/tests/bootstrap.sql', import.meta.url), 'utf8'));
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    await database.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  const { runDatabaseTests } = await import('../supabase/tests/security.mjs');
  const count = await runDatabaseTests(database, assert);
  console.log(`Database: ${count} assertions passed in isolated PostgreSQL (PGlite).`);
} catch (error) {
  console.error(`Database verification failed [${error.code ?? 'assertion'}]: ${error.message}`);
  if (error.where) console.error(error.where);
  if (error.position && error.query) console.error(error.query.slice(Math.max(0, Number(error.position) - 150), Number(error.position) + 150));
  process.exitCode = 1;
} finally {
  await database.close();
}
