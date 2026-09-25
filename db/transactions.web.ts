import type { SQLiteDatabase } from "expo-sqlite";

const transactionTails = new WeakMap<SQLiteDatabase, Promise<void>>();

/**
 * Expo web shares one SQLite connection. A concurrent BEGIN can roll back the
 * transaction already using it, so serialize complete transaction lifetimes.
 * Callbacks must use database statements directly, not start another queued transaction.
 */
export function withQueuedTransaction(
  database: SQLiteDatabase,
  task: () => Promise<void>,
): Promise<void> {
  const previous = transactionTails.get(database) ?? Promise.resolve();
  const transaction = previous.then(() => database.withTransactionAsync(task));
  const completion = transaction.catch(() => {});
  transactionTails.set(database, completion);
  void completion.then(() => {
    if (transactionTails.get(database) === completion) transactionTails.delete(database);
  });
  return transaction;
}
