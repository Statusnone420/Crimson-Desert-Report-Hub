import crypto from 'node:crypto';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const rowDigest = lines => digest([...lines].sort().join('\n') + (lines.length ? '\n' : ''));

// pg_dump --use-copy emits escaped values, so literal newlines delimit rows.
export function readTables(sql) {
  const lines = sql.split('\n');
  const tables = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, '');
    if (!line.startsWith('COPY ')) continue;
    const match = /^COPY "([a-z_][a-z0-9_]*)"\."([a-z_][a-z0-9_]*)" \(("[a-z_][a-z0-9_]*"(?:, "[a-z_][a-z0-9_]*")*)\) FROM stdin;$/.exec(line);
    if (!match) throw new Error('Unsupported COPY format; update the verifier before trusting this backup.');
    const rows = [];
    let terminated = false;
    for (index++; index < lines.length; index++) {
      const row = lines[index].replace(/\r$/, '');
      if (row === '\\.') { terminated = true; break; }
      rows.push(row);
    }
    if (!terminated) throw new Error('Unterminated COPY block.');
    tables.push({ schema: match[1], table: match[2], columns: match[3], rows: rows.length, sha256: rowDigest(rows) });
  }
  return tables;
}

export function requirePublicTables(tables, catalog) {
  const expected = catalog.tables.filter(t => t.schema === 'public').map(t => t.name).sort();
  const actual = tables.filter(t => t.schema === 'public').map(t => t.table).sort();
  if (!expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Application table coverage does not match the source catalog.');
  }
}

export function requireIsolatedContainer(metadata, runId) {
  if (metadata.Config?.Labels?.['crh.backup.run'] !== runId ||
      metadata.HostConfig?.NetworkMode !== 'none' ||
      !metadata.HostConfig?.AutoRemove ||
      Object.keys(metadata.HostConfig?.PortBindings ?? {}).length ||
      (metadata.Mounts ?? []).some(m => m.Type === 'bind')) {
    throw new Error('Restore container ownership or isolation check failed.');
  }
}
